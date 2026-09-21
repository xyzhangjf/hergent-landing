<template>
  <Teleport to="body">
    <Transition name="ito-fade">
      <div v-if="warnOpen" class="ito-mask" role="alertdialog" aria-modal="true" aria-labelledby="ito-title">
        <div class="ito-card">
          <div class="ito-ic">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          </div>
          <div id="ito-title" class="ito-title">即将自动退出</div>
          <div class="ito-desc">
            您已连续 <b>{{ idleMinutes }}</b> 分钟无操作。为保护账号安全，将在
            <b class="ito-sec">{{ countdown }}</b> 秒后自动退出登录。
          </div>
          <div class="ito-actions">
            <button class="ito-btn" @click="logoutNow">立即退出</button>
            <button class="ito-btn primary" @click="stayActive">继续使用</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
/* ============================================================
   IdleTimeout —— 空闲自动登出（体验层）
   · 空闲达到 idleMinutes（默认 30）后自动登出；
   · 到期前 warnSeconds（默认 60）秒弹窗倒计时，可点「继续使用」续期；
   · 多标签页通过 localStorage 共享「最近活动时间」，任一标签活跃即不登出；
   · 安全兜底在后端 core._lookup_user_by_token（SESSION_IDLE_MINUTES），本组件只负责体验。
   ============================================================ */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { auth, api } from '../api/client'

const props = defineProps({
  idleMinutes: { type: Number, default: 30 },
  warnSeconds: { type: Number, default: 60 }
})
const emit = defineEmits(['timeout'])

const LS_KEY = 'hergent_last_active'
const countdown = ref(props.warnSeconds)
const warnOpen = ref(false)

let lastActive = Date.now()
let timer = null
let fired = false

const idleMs = () => Math.max(1, props.idleMinutes) * 60 * 1000
const warnMs = () => Math.min(props.warnSeconds, Math.max(1, props.idleMinutes) * 60) * 1000

/** 记录一次活动（1 秒节流，避免 mousemove/scroll 高频写入） */
function markActive(force = false) {
  const now = Date.now()
  if (!force && now - lastActive < 1000) return
  lastActive = now
  try { localStorage.setItem(LS_KEY, String(now)) } catch (_) { /* 隐私模式：忽略 */ }
}

function tick() {
  if (!auth.token) return
  const remain = idleMs() - (Date.now() - lastActive)
  if (remain <= 0) {
    warnOpen.value = false
    if (!fired) { fired = true; emit('timeout') }
    return
  }
  if (remain <= warnMs()) {
    countdown.value = Math.max(1, Math.ceil(remain / 1000))
    warnOpen.value = true
  } else if (warnOpen.value) {
    warnOpen.value = false
  }
}

/** 点「继续使用」：重置本地计时 + 拉一次已鉴权请求刷新服务端 last_activity */
function stayActive() {
  warnOpen.value = false
  fired = false
  markActive(true)
  countdown.value = props.warnSeconds
  api('/api/auth/me', { method: 'GET', silent401: true }).catch(() => {})
}

function logoutNow() {
  warnOpen.value = false
  if (fired) return
  fired = true
  markActive(true)
  emit('timeout')
}

const EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll', 'click']
const onActivity = () => markActive()

/* 跨标签页同步：仅当别处的时间更新更晚时才采纳，防止旧标签把计时器往回拨 */
function onStorage(e) {
  if (e.key !== LS_KEY || !e.newValue) return
  const v = Number(e.newValue)
  if (v > lastActive) {
    lastActive = v
    if (warnOpen.value && idleMs() - (Date.now() - lastActive) > warnMs()) warnOpen.value = false
  }
}

/* 后台标签页的 setInterval 会被节流：回到前台时立即补算一次 */
function onVisibility() { if (document.visibilityState === 'visible') tick() }

onMounted(() => {
  markActive(true)
  EVENTS.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }))
  window.addEventListener('storage', onStorage)
  document.addEventListener('visibilitychange', onVisibility)
  timer = setInterval(tick, 1000)
})

onBeforeUnmount(() => {
  EVENTS.forEach(ev => window.removeEventListener(ev, onActivity))
  window.removeEventListener('storage', onStorage)
  document.removeEventListener('visibilitychange', onVisibility)
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.ito-mask{position:fixed;inset:0;z-index:9998;background:rgba(15,23,42,.42);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:20px}
.ito-card{width:100%;max-width:392px;background:var(--bg);color:var(--t1);border:1px solid var(--border-subtle);border-radius:16px;padding:24px 24px 18px;box-shadow:var(--shadow-lg);text-align:center}
.ito-ic{display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;background:rgba(var(--war-rgb),.14);color:var(--war);margin-bottom:12px}
.ito-title{font-size:16px;font-weight:600;margin-bottom:8px}
.ito-desc{font-size:13px;line-height:1.75;color:var(--t2)}
.ito-desc b{color:var(--t1);font-weight:600}
.ito-sec{display:inline-block;min-width:1.6em;font-variant-numeric:tabular-nums;color:var(--war)}
.ito-actions{display:flex;gap:10px;margin-top:20px}
.ito-btn{flex:1;height:38px;border:1px solid var(--bd);background:var(--bg);color:var(--t1);border-radius:10px;font-size:13px;cursor:pointer;transition:all .15s}
.ito-btn:hover{border-color:var(--p);color:var(--p-dark)}
.ito-btn.primary{background:var(--p-dark);border-color:var(--p-dark);color:#fff}
.ito-btn.primary:hover{filter:brightness(1.06);color:#fff}

.ito-fade-enter-active,.ito-fade-leave-active{transition:opacity .18s ease}
.ito-fade-enter-from,.ito-fade-leave-to{opacity:0}
</style>
