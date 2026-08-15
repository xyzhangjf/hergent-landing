<template>
  <div class="page">
    <div class="page-hd">
      <h2>经营工作台</h2>
      <span class="page-sub">{{ todayStr }} · AI 晨报</span>
    </div>

    <!-- Bento 布局 -->
    <div class="bento">
      <!-- KPI 横条（顶部紧凑统计带） -->
      <div class="card kpi-strip">
        <div class="kpi" v-for="k in kpis" :key="k.label">
          <div class="kpi-label">{{ k.label }}</div>
          <div class="kpi-val" :class="k.cls">{{ k.val }}</div>
          <div class="kpi-sub">{{ k.sub }}</div>
        </div>
      </div>

      <!-- 今日经营要务（主块，占最大面积） -->
      <div class="card today-panel" v-if="todayCards.length">
        <div class="panel-hd">
          <b>今日经营要务</b>
          <span class="badge badge-blue">主动副驾 · 每日自动生成</span>
        </div>
        <div class="today-list">
          <div v-for="(c,i) in todayCards" :key="i" class="today-card" :class="'prio-' + (c.priority || 'info')">
            <span class="tag" :class="cardTag(c)">{{ cardTypeLabel(c.type) }}</span>
            <div class="tc-body">
              <div class="tc-title">{{ c.title }}</div>
              <div class="tc-text">{{ c.body }}</div>
            </div>
            <div class="tc-acts" v-if="c.actions && c.actions.length">
              <button v-for="a in c.actions" :key="a.label" class="btn btn-ghost" @click="cardAction(a)">{{ a.label }}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 近效期预警（右侧） -->
      <div class="card expiry-card" v-if="expiryData.length">
        <div class="panel-hd">
          <b>近效期预警</b>
          <span class="tag bad">{{ expiryData.length }} 条</span>
        </div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>商品</th><th>库存</th><th>效期</th><th>剩余</th><th>状态</th></tr></thead>
            <tbody>
              <tr v-for="e in expiryData.slice(0,6)" :key="e.product_id + '-' + (e.batch_no||'')">
                <td>{{ e.product_name || e.name || '—' }}</td>
                <td class="num">{{ e.quantity ?? e.stock ?? '—' }}</td>
                <td>{{ e.expiry_date || '—' }}</td>
                <td class="num">{{ e.days_left ?? '—' }}</td>
                <td><span class="tag" :class="expiryTag(e.days_left)">{{ expiryText(e.days_left) }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 7天趋势（右侧） -->
      <div class="card trend-card" v-if="trend.length">
        <div class="panel-hd"><b>近 7 天销售趋势</b><span class="tag info">{{ trendMaxLabel }}</span></div>
        <div class="trend-chart">
          <div v-for="(d,i) in trend" :key="i" class="tc-bar-wrap">
            <div class="tc-bar" :style="{height: barHeight(d.sales) + 'px'}"></div>
            <div class="tc-label">{{ d.date.slice(5) }}</div>
          </div>
        </div>
      </div>

      <!-- AI 晨报（底部整行） -->
      <div class="card report-panel">
        <div class="panel-hd"><b>AI 晨报</b><span class="badge badge-blue">Hermes</span></div>
        <div v-if="!aiText && !aiLoading" class="state-empty">
          <div class="se-ic">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M5 12H3M21 12h-3M6 6l-2-2M20 20l-2-2M6 18l-2 2M20 4l-2 2"/><circle cx="12" cy="12" r="4"/></svg>
          </div>
          <p>每天早上由 Hermes 生成经营晨报</p>
          <button class="btn btn-ghost" style="margin-top:12px" :disabled="aiLoading" @click="loadMorning">生成今日晨报</button>
        </div>
        <div v-if="aiLoading" class="ai-loading">
          <div class="skel-line" style="width:90%"></div>
          <div class="skel-line" style="width:70%;margin-top:8px"></div>
          <div class="skel-line" style="width:85%;margin-top:8px"></div>
          <div class="skel-line" style="width:60%;margin-top:8px"></div>
        </div>
        <div v-if="aiText && !aiLoading" class="ai-report" v-html="mdText"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { toast } from '../store'
import { hermesChat } from '../api/client'
import { dashboardApi, expiryApi, todayApi } from '../api/modules'

/* ---- 日期 ---- */
const todayStr = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })

/* ---- KPI 数据 ---- */
const dashData = ref(null)
const expiryData = ref([])
const todayData = ref(null)

const todayCards = computed(() => todayData.value?.cards || [])

function cardTypeLabel(t) {
  return { churn_risk: '流失风险', low_stock: '库存预警', overdue_ar: '应收逾期', opportunity: '机会发现', expiry: '临期' }[t] || t
}
function cardTag(c) {
  if (c.priority === 'critical') return 'bad'
  if (c.priority === 'warning') return 'warn'
  return 'ok'
}
function cardAction(a) {
  if (a.type === 'view_detail' || a.type === 'view_supplier' || a.type === 'view_product') {
    toast('详情页开发中', 'info')
  } else {
    toast(a.label + '：功能完善中', 'info')
  }
}

const kpis = computed(() => {
  const d = dashData.value
  if (!d) return [
    { label: '今日销售额', val: '¥—', sub: '加载中', cls: '' },
    { label: '今日毛利', val: '¥—', sub: '', cls: '' },
    { label: '今日单数', val: '—', sub: '', cls: '' },
    { label: '今日回款', val: '¥—', sub: '', cls: '' },
    { label: '近效期预警', val: expiryData.value.length || '—', sub: expiryData.value.length ? '需处理' : '', cls: expiryData.value.length ? 'val-warn' : '' },
  ]
  return [
    { label: '今日销售额', val: '¥' + fmt(d.sales), sub: '', cls: '' },
    { label: '今日毛利', val: '¥' + fmt(d.profit), sub: d.sales > 0 ? '毛利率 ' + pct(d.profit, d.sales) : '', cls: d.profit >= 0 ? 'val-ok' : 'val-bad' },
    { label: '今日单数', val: d.orders, sub: d.orders > 0 ? '均价 ¥' + Math.round(d.sales / d.orders) : '', cls: '' },
    { label: '今日回款', val: '¥' + fmt(d.payment), sub: d.sales > 0 ? '回款率 ' + pct(d.payment, d.sales) : '', cls: '' },
    { label: '近效期预警', val: expiryData.value.length || 0, sub: expiryData.value.length ? '需处理' : '无预警', cls: expiryData.value.length ? 'val-warn' : 'val-ok' },
  ]
})

const trend = computed(() => dashData.value?.trend || [])
const trendMax = computed(() => Math.max(...trend.value.map(t => t.sales), 1))
const trendMaxLabel = computed(() => '峰值 ¥' + fmt(trendMax.value))

function barHeight(v) {
  return Math.max(4, (v / trendMax.value) * 80)
}

function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}
function pct(a, b) {
  if (!b) return '—'
  return Math.round((a / b) * 100) + '%'
}

/* ---- 近效期 ---- */
function expiryTag(days) {
  if (days == null) return ''
  if (days <= 0) return 'bad'
  if (days <= 7) return 'bad'
  if (days <= 14) return 'warn'
  return 'ok'
}
function expiryText(days) {
  if (days == null) return '—'
  if (days <= 0) return '已过期'
  if (days <= 7) return days + '天到期'
  if (days <= 14) return days + '天到期'
  return '安全'
}

/* ---- AI 晨报 ---- */
const aiText = ref('')
const aiLoading = ref(false)
const mdText = ref('')

function renderMd(t) {
  return t
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^- /gm, '<span style="color:var(--p-dark)">•</span> ')
    .replace(/\n/g, '<br>')
}

async function loadMorning() {
  aiLoading.value = true
  aiText.value = ''
  mdText.value = ''
  const msg = { role: 'user', content: '你是我的 AI 经营副驾。请基于当前业务数据，生成今天早上的经营晨报：今日待办、需要关注的风险（货损/返利）、建议动作。请用简洁的要点列出。' }
  let full = ''
  try {
    await hermesChat([msg], {
      onDelta: (d, f) => { full = f; aiText.value = f; mdText.value = renderMd(f) }
    })
  } catch (e) {
    aiText.value = '晨报生成失败：' + (e.message || 'Hermes 未连接')
    mdText.value = aiText.value
  } finally {
    aiLoading.value = false
  }
}

/* ---- 初始化加载 ---- */
async function loadData() {
  try {
    const d = await dashboardApi.todayProfit()
    dashData.value = d
  } catch (e) { /* 后端未启动时静默 */ }
  try {
    const e = await expiryApi.scan()
    // expiry-scan 返回 {expired:[], near:[], safe:[]} 或 {items:[]}
    const items = e.items || [...(e.expired||[]), ...(e.near||[]), ...(e.warning||[])]
    expiryData.value = items
  } catch (e) { /* 静默 */ }
  try {
    const t = await todayApi.get()
    todayData.value = t
  } catch (e) { /* 静默 */ }
}

onMounted(loadData)
</script>

<style scoped>
.page-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600}
.page-sub{font-size:12px;color:var(--t3)}
.bento{display:grid;grid-template-columns:repeat(12,1fr);gap:14px;grid-auto-flow:dense}

/* KPI 横条（顶部紧凑统计带） */
.kpi-strip{grid-column:1/-1;display:grid;grid-template-columns:repeat(5,1fr);padding:6px 0}
.kpi-strip .kpi{padding:8px 18px;border-right:1px solid var(--border-subtle);transition:background .15s}
.kpi-strip .kpi:first-child{padding-left:20px}
.kpi-strip .kpi:last-child{border-right:none}
.kpi-strip .kpi:hover{background:var(--bg2)}
.kpi-label{font-size:12px;color:var(--t3);margin-bottom:6px}
.kpi-val{font-size:22px;font-weight:600;margin-bottom:2px;font-variant-numeric:tabular-nums;letter-spacing:-.3px}
.kpi-val.val-ok{color:var(--suc)}
.kpi-val.val-warn{color:var(--war)}
.kpi-val.val-bad{color:var(--dan)}
.kpi-sub{font-size:12px;color:var(--t3)}

/* Bento 模块布局 */
.today-panel{grid-column:span 8;grid-row:span 2;padding:18px;min-height:280px}
.expiry-card{grid-column:span 4;padding:16px}
.trend-card{grid-column:span 4;padding:16px}
.report-panel{grid-column:1/-1;padding:16px}

.today-list{display:flex;flex-direction:column;gap:10px}
.today-card{position:relative;display:flex;align-items:flex-start;gap:12px;padding:14px 16px 14px 18px;border:1px solid var(--border-subtle);border-radius:14px;background:var(--bg);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
.today-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-md);border-color:var(--bd)}
.today-card::before{content:'';position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:0 2px 2px 0}
.today-card.prio-critical::before{background:var(--dan)}
.today-card.prio-warning::before{background:var(--war)}
.today-card.prio-info::before{background:var(--p)}
.today-card .tag{flex-shrink:0;margin-top:1px;white-space:nowrap}
.tc-body{flex:1;min-width:0}
.tc-title{font-size:13.5px;font-weight:500;color:var(--t1);margin-bottom:3px;letter-spacing:.1px}
.tc-text{font-size:12.5px;color:var(--t2);line-height:1.55}
.tc-acts{flex-shrink:0;display:flex;gap:6px}
.tc-acts .btn{height:28px;padding:0 12px;font-size:12px;border-radius:8px}
.trend-chart{display:flex;align-items:flex-end;gap:8px;height:120px;padding-top:10px}
.tc-bar-wrap{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px}
.tc-bar{width:100%;max-width:36px;border-radius:4px 4px 0 0;background:linear-gradient(180deg,var(--p) 0%,var(--p-dark) 100%);transition:height .4s ease}
.tc-label{font-size:11px;color:var(--t3)}
.ai-report{font-size:13px;color:var(--t1);line-height:1.8;max-height:none;overflow-y:auto}
.ai-loading{padding:12px 0}

@media(max-width:1200px){
  .bento{grid-template-columns:repeat(6,1fr)}
  .today-panel{grid-column:span 6;grid-row:span 1}
  .expiry-card{grid-column:span 3}
  .trend-card{grid-column:span 3}
  .kpi-strip{grid-template-columns:repeat(3,1fr)}
  .kpi-strip .kpi:nth-child(3){border-right:none}
}
@media(max-width:768px){
  .bento{grid-template-columns:1fr}
  .today-panel,.expiry-card,.trend-card,.report-panel{grid-column:1/-1;grid-row:auto}
  .kpi-strip{grid-template-columns:repeat(2,1fr)}
  .kpi-strip .kpi:nth-child(odd){border-right:1px solid var(--border-subtle)}
  .kpi-strip .kpi:nth-child(even){border-right:none}
  .kpi-val{font-size:18px}
  .trend-chart{height:80px}
}
</style>
