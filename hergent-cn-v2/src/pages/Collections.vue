<template>
  <div class="page">
    <div class="page-hd">
      <h2>催收跟进</h2>
      <span class="page-sub">谁欠我钱 · 欠了多久 · 下一步做什么</span>
    </div>

    <div class="card col-card">
      <div class="panel-hd">
        <b>催收队列</b>
        <span class="tag warn">按催收等级排序，先催最急的</span>
        <button class="btn btn-ghost btn-sm" @click="rebuildQueue">刷新队列</button>
      </div>

      <div v-if="colSummary" class="col-stats">
        <div class="col-stat"><b>¥{{ fmt(colSummary.total_amount) }}</b><span>未收总额</span></div>
        <div class="col-stat"><b>{{ colSummary.total_items }}</b><span>待跟进</span></div>
        <div class="col-stat warn"><b>{{ colSummary.promised }}</b><span>承诺中</span></div>
        <div class="col-stat bad"><b>{{ colSummary.disputed }}</b><span>争议</span></div>
        <div class="col-stat red"><b>{{ colSummary.escalated }}</b><span>需人工</span></div>
      </div>

      <div v-if="colLoading" class="state-empty">加载催收队列…</div>
      <div v-else-if="!colItems.length" class="state-empty">没有待催收的应收款</div>

      <div v-else class="col-list">
        <div v-for="it in colItems" :key="it.id" class="col-item" :class="{ esc: it.escalated, disp: it.status === 'disputed' }">
          <div class="col-main">
            <div class="col-top">
              <b>{{ it.contact_name }}</b>
              <span class="tag" :class="tierCls(it)">{{ it.tier_label }}</span>
              <span v-if="it.status === 'promised'" class="col-promise">承诺 {{ it.promised_date || '—' }}</span>
              <span v-if="it.status === 'disputed'" class="col-dispute">争议中</span>
              <span v-if="it.escalated" class="col-esc">需人工</span>
            </div>
            <div class="col-meta">
              <span class="col-amount">¥{{ fmt(it.amount) }}</span>
              <span>到期 {{ (it.due_date || '').slice(0, 10) }}</span>
              <span v-if="it.age_days > 0" class="val-bad">逾期 {{ it.age_days }} 天</span>
            </div>
            <div v-if="it.template" class="col-tmpl">{{ it.template }}</div>
            <div v-if="it.note" class="col-note">{{ it.note }}</div>
          </div>
          <div class="col-ops">
            <button class="btn btn-ghost btn-sm" @click="act(it, 'contacted', '')">已联系</button>
            <button class="btn btn-ghost btn-sm" @click="promise(it)">承诺付款</button>
            <button class="btn btn-ghost btn-sm" @click="act(it, 'disputed', '')">争议</button>
            <button class="btn btn-primary btn-sm" @click="act(it, 'resolved', '')">已解决</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { toast } from '../store'
import { collectionsApi } from '../api/modules'

const colItems = ref([])
const colSummary = ref(null)
const colLoading = ref(false)

function tierCls(it) {
  if (it.status === 'disputed') return 'bad'
  if (it.escalated) return 'warn'
  return 'info'
}

async function loadCols() {
  colLoading.value = true
  try {
    const [q, s] = await Promise.all([collectionsApi.queue(), collectionsApi.summary()])
    colItems.value = q.items || []
    colSummary.value = s
  } catch (e) {
    toast('催收队列加载失败：' + (e.message || ''), 'error')
  } finally {
    colLoading.value = false
  }
}

async function rebuildQueue() {
  try {
    await collectionsApi.rebuild()
    toast('队列已刷新', 'ok')
    loadCols()
  } catch (e) { toast('刷新失败：' + (e.message || ''), 'error') }
}

async function act(it, action, note) {
  try {
    await collectionsApi.action(it.id, { action, note })
    toast(action === 'resolved' ? '已解决' : '已记录', 'ok')
    loadCols()
  } catch (e) { toast('操作失败：' + (e.message || ''), 'error') }
}

async function promise(it) {
  const d = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  // 简单询问默认 7 天后
  try {
    await collectionsApi.action(it.id, { action: 'promised', promised_date: d, note: '承诺付款' })
    toast('已记录承诺（默认 7 天内）', 'ok')
    loadCols()
  } catch (e) { toast('操作失败：' + (e.message || ''), 'error') }
}

function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

onMounted(loadCols)
</script>

<style scoped>
.btn-sm{height:30px;padding:0 12px;font-size:12px}
.val-bad{color:var(--dan)}
.col-card{padding:18px}
.col-stats{display:flex;gap:12px;margin:14px 0;flex-wrap:wrap}
.col-stat{display:flex;flex-direction:column;align-items:center;background:var(--bg2);border-radius:10px;padding:10px 18px;min-width:76px}
.col-stat b{font-size:18px;font-weight:500;color:var(--t1)}
.col-stat span{font-size:11px;color:var(--t3);margin-top:2px}
.col-stat.warn b{color:#ff9500}
.col-stat.bad b{color:#ff3b30}
.col-stat.red b{color:#ff3b30;text-decoration:underline}
.col-list{display:flex;flex-direction:column;gap:10px}
.col-item{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border:1px solid var(--bd);border-radius:12px;padding:14px;background:var(--bg)}
.col-item.esc{border-color:rgba(255,59,48,.4);background:rgba(255,59,48,.04)}
.col-item.disp{border-color:rgba(255,149,0,.5)}
.col-main{flex:1;min-width:0}
.col-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.col-top b{font-size:14px}
.col-meta{display:flex;gap:14px;font-size:12px;color:var(--t2);margin-top:6px}
.col-amount{font-size:15px;font-weight:500;color:var(--t1)}
.col-tmpl{font-size:12px;color:var(--t2);background:var(--bg2);border-radius:8px;padding:8px 10px;margin-top:8px;line-height:1.6}
.col-note{font-size:11px;color:var(--t3);margin-top:6px}
.col-promise{font-size:11px;color:#34c759;background:rgba(52,199,89,.12);padding:2px 8px;border-radius:6px}
.col-dispute{font-size:11px;color:#ff9500;background:rgba(255,149,0,.15);padding:2px 8px;border-radius:6px}
.col-esc{font-size:11px;color:#ff3b30;background:rgba(255,59,48,.1);padding:2px 8px;border-radius:6px}
.col-ops{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
</style>
