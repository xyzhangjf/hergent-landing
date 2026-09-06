<template>
  <div class="page">
    <div class="page-hd">
      <div>
        <h2>客户档案</h2>
        <span class="page-sub">管理客户/门店主档 · 支持手动录入、Excel 导入与外部 ERP 同步</span>
      </div>
      <div class="sync-wrap">
        <span class="sync-state" :class="connState">{{ connLabel }}</span>
        <button class="btn btn-ghost btn-sm" :disabled="syncBusy" @click="onSync">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          {{ syncBusy ? '同步中…' : '同步' }}
        </button>
      </div>
    </div>

    <div class="card df-panel">
      <div class="panel-hd">
        <b>客户档案管理</b>
        <span class="tag info">P1 规划中 · 下列能力即将上线</span>
      </div>
      <p class="df-tip">客户档案用于预报、对账、返利等场景。本期先打通「外部 ERP 同步」入口，完整管理界面（新增 / 编辑 / Excel 导入 / 详情）将在 P1 交付。</p>
      <ul class="plan-list">
        <li><b>同步外部客户</b> —— 已连接畅捷通/金蝶后，点上方「同步」即可拉取客户与门店（<span class="ok-text">当前可用</span>）。</li>
        <li>手动新增 / 编辑客户（名称、电话、类型、地址、结算方式、账期）。</li>
        <li>Excel 批量导入客户（复用通用导入管线，自动去重）。</li>
        <li>客户维度经营看板（销量、应收、返利）。</li>
      </ul>
    </div>

    <!-- 未连接提醒弹窗 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="remindOpen" class="df-overlay" @click="remindOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="remindOpen" class="df-modal">
          <div class="df-modal-hd"><b>尚未连接 ERP</b><button class="df-x" @click="remindOpen = false"><Icon name="close"/></button></div>
          <div class="df-modal-body">
            <p class="df-tip">「同步」需要先把你的 ERP（畅捷通 / 金蝶）接入 Hergent。</p>
            <p class="df-tip">请前往 <b>能力中心</b> 完成授权连接后，再来点「同步」。</p>
          </div>
          <div class="df-modal-ft">
            <button class="btn btn-ghost" @click="remindOpen = false">知道了</button>
            <button class="btn btn-primary" @click="goConnect">去能力中心</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import Icon from '../components/Icon.vue'
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api/client'
import { toast } from '../store'

const router = useRouter()
const chanjetLinked = ref(false)
const kingdeeLinked = ref(false)
const syncBusy = ref(false)
const remindOpen = ref(false)

const connState = computed(() => (chanjetLinked.value || kingdeeLinked.value) ? 'linked' : 'unlinked')
const connLabel = computed(() => {
  if (chanjetLinked.value && kingdeeLinked.value) return '畅捷通 + 金蝶 已连接'
  if (chanjetLinked.value) return '畅捷通 已连接'
  if (kingdeeLinked.value) return '金蝶 已连接'
  return '未连接 ERP'
})

async function probeConnectors() {
  try { const s = await api('/api/datasources/v2/chanjet/status'); chanjetLinked.value = !!s.connected } catch { chanjetLinked.value = false }
  try { const s = await api('/api/datasources/v2/kingdee/status'); kingdeeLinked.value = !!s.connected } catch { kingdeeLinked.value = false }
}

async function onSync() {
  if (!chanjetLinked.value && !kingdeeLinked.value) { remindOpen.value = true; return }
  syncBusy.value = true
  try {
    const jobs = []
    if (chanjetLinked.value) jobs.push(api('/api/datasources/v2/chanjet/sync', { method: 'POST', body: { objects: ['customers', 'products', 'suppliers'] } }))
    if (kingdeeLinked.value) jobs.push(api('/api/datasources/v2/kingdee/sync', { method: 'POST', body: { objects: ['customers', 'products', 'suppliers', 'inventory', 'sales_orders', 'purchase_orders'] } }))
    await Promise.all(jobs)
    toast('已同步客户/商品档案', 'ok')
  } catch (e) { toast(e.message || '同步失败', 'err') }
  finally { syncBusy.value = false }
}

function goConnect() { remindOpen.value = false; router.push('/connect') }

onMounted(probeConnectors)
</script>

<style scoped>
.page-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600}
.page-sub{font-size:12px;color:var(--t3)}
.sync-wrap{display:flex;align-items:center;gap:8px;flex-shrink:0}
.sync-state{font-size:11.5px;padding:3px 10px;border-radius:10px;background:var(--bg2);color:var(--t3);white-space:nowrap}
.sync-state.linked{background:rgba(var(--suc-rgb),.12);color:var(--suc)}
.sync-state.unlinked{background:rgba(var(--war-rgb),.12);color:var(--war)}

.df-panel{padding:18px;margin-bottom:14px}
.df-tip{font-size:12.5px;color:var(--t2);margin:4px 0 14px;line-height:1.7}
.plan-list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:10px;font-size:13px;color:var(--t1);line-height:1.6}
.plan-list li::marker{color:var(--p)}
.ok-text{color:var(--suc);font-weight:500}

.df-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:980}
.df-modal{position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);width:min(420px,92vw);background:var(--bg);border-radius:16px;z-index:990;box-shadow:0 16px 48px rgba(0,0,0,.18)}
.df-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle)}
.df-modal-hd b{font-size:15px;color:var(--t1)}
.df-x{border:none;background:none;font-size:14px;color:var(--t3);cursor:pointer}
.df-modal-body{padding:18px 20px;display:flex;flex-direction:column;gap:12px}
.df-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle)}
</style>
