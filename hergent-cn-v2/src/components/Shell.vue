<template>
  <div class="shell" :class="{resizing:resizing}">
    <!-- 顶部栏 -->
    <header class="topbar">
      <div class="tb-brand">
        <img class="tb-brand-logo" src="/favicon.svg" alt="Hergent" />
        <b>Hergent</b><span class="tb-sub">AI 经营副驾</span>
        <span v-if="store.demo" class="tb-demo">演示模式 · 模拟数据</span>
      </div>
      <div class="tb-ai">
        <WeatherWidget />
        <button class="tb-copilot" @click="openCopilot">
          <span class="tb-cp-ic">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>
          </span>
          <span class="tb-cp-txt">AI</span>
          <span class="tb-cp-k">⌘K</span>
        </button>
      </div>
      <div class="tb-right">
        <button class="tb-btn" @click="toggleTheme" title="切换主题">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
        </button>
        <div class="tb-user" @click.stop="toggleUserMenu">{{ store.user.name || '我' }}<svg class="tb-user-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></div>
        <div v-if="userMenuOpen" class="tb-menu-mask" @click="userMenuOpen=false"></div>
        <div v-if="userMenuOpen" class="tb-menu" @click.stop>
          <button class="tb-menu-item" @click="openProfile">修改资料</button>
          <button class="tb-menu-item danger" @click="doLogout">退出登录</button>
        </div>
      </div>
    </header>

    <!-- 顶部栏已集成品牌 + 天气 + 问 AI 副驾，不再单独占一行 -->

    <div class="body">
      <!-- 侧栏（桌面） -->
      <aside class="sidebar" :class="{collapsed:!store.ui.sidebarOpen}">
        <nav class="sb-nav">
          <router-link to="/workbench" class="sb-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><span>经营工作台</span></router-link>
          <router-link to="/forecast" class="sb-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 4-5"/></svg><span>预报订货管理</span></router-link>
          <router-link to="/rebate" class="sb-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg><span>目标与返利</span></router-link>

          <router-link to="/archive" class="sb-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg><span>档案管理</span></router-link>
          <router-link to="/connect" class="sb-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg><span>能力中心</span></router-link>
          <router-link to="/bid-radar" class="sb-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg><span>招投标雷达</span></router-link>

          <router-link to="/cron" class="sb-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg><span>定时任务</span></router-link>
          <router-link to="/settings" class="sb-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l-.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg><span>设置</span></router-link>
        </nav>
      </aside>

      <!-- 侧栏拖拽手柄（桌面、展开时可见） -->
      <div v-show="store.ui.sidebarOpen" class="sb-resizer" :class="{active:resizing}" @mousedown.prevent="startResize" title="拖动调整侧栏宽度"></div>

      <!-- 内容区 -->
      <main class="content">
        <router-view v-slot="{ Component }">
          <Transition name="page" mode="out-in">
            <component :is="Component" />
          </Transition>
        </router-view>
      </main>
    </div>

    <!-- 移动端底部 Tab -->
    <nav class="mnav">
      <router-link to="/workbench" class="mnav-item" @click="store.ui.mobileDrawer=false"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><span>工作台</span></router-link>
      <router-link to="/forecast" class="mnav-item" @click="store.ui.mobileDrawer=false"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 4-5"/></svg><span>预报</span></router-link>
      <router-link to="/rebate" class="mnav-item" @click="store.ui.mobileDrawer=false"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg><span>目标与返利</span></router-link>
      <button class="mnav-item" @click="store.ui.mobileDrawer=!store.ui.mobileDrawer"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg><span>更多</span></button>
    </nav>

    <!-- 移动端更多抽屉 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="store.ui.mobileDrawer" class="md-overlay" @click="store.ui.mobileDrawer=false"></div>
      </Transition>
      <Transition name="sheet">
        <div v-if="store.ui.mobileDrawer" class="md-sheet">
          <div class="md-grab"></div>
          <router-link to="/connect" class="md-item" @click="store.ui.mobileDrawer=false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>能力中心</router-link>
          <router-link to="/cron" class="md-item" @click="store.ui.mobileDrawer=false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>定时任务</router-link>
          <router-link to="/settings" class="md-item" @click="store.ui.mobileDrawer=false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>设置</router-link>
          <router-link to="/archive" class="md-item" @click="store.ui.mobileDrawer=false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>档案管理</router-link>
          <router-link to="/bid-radar" class="md-item" @click="store.ui.mobileDrawer=false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>招投标雷达</router-link>
        </div>
      </Transition>
    </Teleport>

    <!-- AI 副驾全局抽屉 -->
    <CopilotDrawer />

    <!-- 命令面板（⌘Shift+K） -->
    <CommandPalette v-model="cmdOpen" />

    <!-- 修改资料弹窗 -->
    <div v-if="profileOpen" class="pf-mask" @click.self="profileOpen=false">
      <div class="pf-modal">
        <div class="pf-hd">修改资料</div>
        <div class="pf-bd">
          <label class="pf-field">
            <span>显示昵称</span>
            <input v-model="profileForm.display_name" maxlength="20" placeholder="界面上显示的名字" />
          </label>
          <label class="pf-field">
            <span>登录账号</span>
            <input v-model="profileForm.username" maxlength="32" placeholder="登录时输入的账号" />
            <small>修改后，下次请用新账号登录</small>
          </label>
          <div v-if="profileMsg" class="pf-msg" :class="profileOk ? 'ok' : 'err'">{{ profileMsg }}</div>
        </div>
        <div class="pf-ft">
          <button class="pf-btn" @click="profileOpen=false">取消</button>
          <button class="pf-btn primary" :disabled="profileSaving" @click="saveProfile">{{ profileSaving ? '保存中…' : '保存' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { store, toast, setTheme } from '../store'
import { auth, api, resetTenantContext } from '../api/client'
import CopilotDrawer from './CopilotDrawer.vue'
import CommandPalette from './CommandPalette.vue'
import WeatherWidget from './WeatherWidget.vue'

const router = useRouter()

function toggleTheme() {
  setTheme(store.ui.theme === 'light' ? 'dark' : 'light')
}

function logout() {
  resetTenantContext()   // 清本地 tenant_id + hergent_tenant cookie，避免污染下一次登录
  auth.token = ''
  auth.user = null
  router.push('/login')
}

/* 用户菜单 + 修改资料 */
const userMenuOpen = ref(false)
const profileOpen = ref(false)
const profileSaving = ref(false)
const profileForm = ref({ display_name: '', username: '' })
const profileMsg = ref('')
const profileOk = ref(false)

function toggleUserMenu() { userMenuOpen.value = !userMenuOpen.value }
function openProfile() {
  userMenuOpen.value = false
  const u = auth.user || {}
  profileForm.value = { display_name: u.display_name || '', username: u.username || '' }
  profileMsg.value = ''
  profileOk.value = false
  profileOpen.value = true
}
function doLogout() { userMenuOpen.value = false; logout() }
async function saveProfile() {
  profileSaving.value = true
  profileMsg.value = ''
  try {
    const body = { display_name: profileForm.value.display_name, username: profileForm.value.username }
    await api('/api/auth/profile', { method: 'PUT', body })
    const u = auth.user || {}
    u.display_name = profileForm.value.display_name || u.display_name
    u.username = (profileForm.value.username || '').trim() || u.username
    auth.user = u
    store.user.name = u.display_name || u.username || '我'
    profileOk.value = true
    profileMsg.value = '已保存'
    toast('资料已更新')
    setTimeout(() => { profileOpen.value = false }, 700)
  } catch (e) {
    profileOk.value = false
    profileMsg.value = (e && e.message) ? e.message : '保存失败'
  } finally {
    profileSaving.value = false
  }
}

function openCopilot() {
  store.ui.copilotOpen = true
}

const cmdOpen = ref(false)

/* 快捷键：⌘K / Ctrl+K 唤起 AI 副驾；⌘Shift+K / Ctrl+Shift+K 唤起命令面板（均对输入框豁免） */
function onKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    const t = e.target
    const tag = t && t.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return
    e.preventDefault()
    if (e.shiftKey) cmdOpen.value = true
    else store.ui.copilotOpen = !store.ui.copilotOpen
  }
}

onMounted(() => {
  if (auth.user) store.user.name = auth.user.display_name || auth.user.name || auth.user.username || '我'
  window.addEventListener('keydown', onKeydown)
  /* 恢复用户上次拖拽保存的侧栏宽度 */
  try {
    const saved = parseFloat(localStorage.getItem('hergent_sidebar_w'))
    if (!isNaN(saved) && saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) {
      document.documentElement.style.setProperty('--sidebar-w', saved + 'px')
    }
  } catch (_) {}
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', stopResize)
})

/* ---- 侧栏拖拽调宽 ---- */
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 420
const resizing = ref(false)
let _startX = 0
let _startW = 0

function _sidebarW() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')
  const n = parseFloat(v)
  return isNaN(n) ? 248 : n
}
function startResize(e) {
  if (!store.ui.sidebarOpen) return
  resizing.value = true
  _startX = e.clientX
  _startW = _sidebarW()
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', stopResize)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}
function onResizeMove(e) {
  let w = _startW + (e.clientX - _startX)
  if (w < SIDEBAR_MIN) w = SIDEBAR_MIN
  if (w > SIDEBAR_MAX) w = SIDEBAR_MAX
  document.documentElement.style.setProperty('--sidebar-w', w + 'px')
}
function stopResize() {
  if (!resizing.value) return
  resizing.value = false
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', stopResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  try { localStorage.setItem('hergent_sidebar_w', getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) } catch (_) {}
}
</script>

<style scoped>
.shell{display:flex;flex-direction:column;height:100vh;background:radial-gradient(1200px 420px at 72% -8%,rgba(6,182,212,.07),transparent 60%),var(--bg2)}
.topbar{height:var(--topbar-h);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 20px;background:var(--glass-bg);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border-bottom:1px solid var(--glass-border);flex-shrink:0;z-index:10}
.tb-demo{margin-left:10px;font-size:11px;background:rgba(255,149,0,.15);color:#b76e00;padding:2px 10px;border-radius:8px}
.tb-brand{display:flex;align-items:center;gap:8px}
.tb-brand-logo{width:22px;height:22px;border-radius:5px;display:block}
.tb-brand b{font-size:16px;font-weight:600;letter-spacing:.2px}
.tb-sub{font-size:12px;color:var(--t3);padding:3px 8px;border-radius:8px;background:var(--p-bg);color:var(--p-dark)}
.tb-right{display:flex;align-items:center;gap:8px}
.tb-btn{width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:none;background:none;border-radius:8px;color:var(--t2)}
.tb-btn:hover{background:var(--bg2);color:var(--p-dark)}
.tb-user{height:32px;display:flex;align-items:center;padding:0 12px;border-radius:16px;background:var(--p-bg);color:var(--p-dark);font-size:13px;font-weight:500;cursor:pointer}

.tb-ai{display:flex;align-items:center;gap:12px}
.tb-copilot{display:flex;align-items:center;gap:8px;height:34px;padding:0 7px 0 11px;border:1px solid transparent;border-radius:18px;background:var(--p-bg);color:var(--p-dark);font-size:13px;font-weight:500;cursor:pointer;transition:all .15s}
.tb-copilot:hover{background:var(--p);color:#fff;box-shadow:0 4px 14px rgba(6,182,212,.22)}
.tb-cp-ic{display:flex;align-items:center;justify-content:center}
.tb-cp-k{padding:2px 7px;border-radius:8px;background:rgba(6,182,212,.14);font-size:11px;font-weight:500}

.body{flex:1;display:flex;overflow:hidden;position:relative}
.sidebar{width:var(--sidebar-w);flex-shrink:0;display:flex;flex-direction:column;background:var(--glass-bg);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border-right:1px solid var(--glass-border);transition:width .2s}
/* 拖拽时关闭过渡，保证实时跟手 */
.shell.resizing .sidebar{transition:none}
.sb-resizer{position:absolute;top:0;bottom:0;left:var(--sidebar-w);width:8px;margin-left:-4px;cursor:col-resize;z-index:12}
.sb-resizer::after{content:"";position:absolute;top:0;bottom:0;left:50%;width:2px;transform:translateX(-50%);background:transparent;transition:background .15s}
.sb-resizer:hover::after,.sb-resizer.active::after{background:var(--p)}
.sb-nav{flex:1;overflow-y:auto;padding:12px 10px}
.sb-item{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;border-radius:10px;color:var(--t2);text-decoration:none;font-size:13px;transition:all .15s}
.sb-item:hover{background:var(--bg);color:var(--t1)}
.sb-item.router-link-active{background:var(--p-bg);color:var(--p-dark);font-weight:500}

.md-group-hd{font-size:11px;font-weight:500;color:var(--t3);padding:14px 20px 4px;letter-spacing:.8px}

.content{flex:1;overflow-y:auto;padding:20px;background:var(--bg)}

.page-enter-active,.page-leave-active{transition:opacity .18s,transform .18s}
.page-enter-from{opacity:0;transform:translateY(6px)}
.page-leave-to{opacity:0}

.mnav{display:none}
.md-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:900}
.md-sheet{position:fixed;left:0;right:0;bottom:0;background:var(--glass-bg-strong);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border-radius:16px 16px 0 0;padding:8px 0 calc(12px + env(safe-area-inset-bottom));z-index:901}
.md-grab{width:36px;height:4px;border-radius:2px;background:var(--bd);margin:6px auto 10px}
.md-item{display:flex;align-items:center;gap:12px;width:100%;padding:14px 20px;border:none;background:none;font-size:15px;color:var(--t1);text-align:left}
.md-item:active{background:var(--bg4)}
.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
.sheet-enter-active,.sheet-leave-active{transition:transform .25s ease}
.sheet-enter-from,.sheet-leave-to{transform:translateY(100%)}

.tb-user-caret{margin-left:5px;opacity:.7;transition:transform .15s}
.tb-menu-mask{position:fixed;inset:0;z-index:40}
.tb-menu{position:absolute;top:44px;right:18px;background:var(--bg);border:1px solid var(--glass-border);border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.14);padding:6px;min-width:150px;z-index:50}
.tb-menu-item{display:block;width:100%;text-align:left;padding:9px 12px;border:none;background:none;border-radius:8px;color:var(--t1);font-size:13px;cursor:pointer;transition:background .15s}
.tb-menu-item:hover{background:var(--bg2)}
.tb-menu-item.danger{color:var(--dan)}

.pf-mask{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
.pf-modal{width:380px;max-width:92vw;background:var(--bg);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden}
.pf-hd{padding:16px 20px;font-size:15px;font-weight:600;color:var(--t1);border-bottom:1px solid var(--border-subtle)}
.pf-bd{padding:18px 20px;display:flex;flex-direction:column;gap:14px}
.pf-field{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--t2)}
.pf-field input{height:38px;padding:0 12px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--bg2);color:var(--t1);font-size:14px;outline:none}
.pf-field input:focus{border-color:var(--p)}
.pf-field small{color:var(--t3);font-size:11px}
.pf-msg{font-size:12px}
.pf-msg.ok{color:var(--suc)}
.pf-msg.err{color:var(--dan)}
.pf-ft{padding:14px 20px;display:flex;justify-content:flex-end;gap:10px;border-top:1px solid var(--border-subtle)}
.pf-btn{height:36px;padding:0 18px;border-radius:10px;border:1px solid var(--border-subtle);background:var(--bg2);color:var(--t1);font-size:13px;cursor:pointer;transition:all .15s}
.pf-btn:hover{background:var(--bg3)}
.pf-btn.primary{background:var(--p);border-color:var(--p);color:#fff}
.pf-btn.primary:hover{opacity:.92}
.pf-btn:disabled{opacity:.6;cursor:default}

@media(max-width:768px){
  .sidebar{display:none}
  .sb-resizer{display:none}
  .tb-sub{display:none}
  .tb-cp-k{display:none}
  .wx{display:none}
  .mnav{display:flex;position:fixed;bottom:0;left:0;right:0;height:calc(56px + env(safe-area-inset-bottom));background:var(--glass-bg-strong);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);border-top:1px solid var(--glass-border);z-index:800;padding-bottom:env(safe-area-inset-bottom)}
  .mnav-item{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border:none;background:none;color:var(--t3);font-size:11px}
  .mnav-item.router-link-active{color:var(--p-dark)}
  .content{padding:14px 12px calc(72px + env(safe-area-inset-bottom))}
}
</style>
