<template>
  <div class="page">
    <div class="page-hd">
      <h2>数据看板</h2>
      <span class="page-sub">深度分析 · 趋势对比 · 返利核销（今日经营概况见「经营工作台」）</span>
    </div>

    <!-- 趋势图 -->
    <div class="card chart-card">
      <div class="panel-hd">
        <b>近 7 天销售 / 毛利趋势</b>
        <div class="legend">
          <span class="lg-item"><i class="lg-dot dot-sales"></i>销售额</span>
          <span class="lg-item"><i class="lg-dot dot-profit"></i>毛利</span>
        </div>
      </div>
      <div class="chart-area" v-if="trend.length">
        <svg :viewBox="`0 0 ${chartW} ${chartH}`" class="trend-svg" preserveAspectRatio="none">
          <!-- 网格线 -->
          <line v-for="i in 4" :key="'g'+i" :x1="padL" :x2="chartW - padR" :y1="padT + (i-1) * gridStep" :y2="padT + (i-1) * gridStep" stroke="var(--border-subtle)" stroke-width="1" stroke-dasharray="3,3"/>
          <!-- Y 轴标签 -->
          <text v-for="i in 4" :key="'y'+i" :x="padL - 8" :y="padT + (i-1) * gridStep + 4" text-anchor="end" fill="var(--t3)" font-size="10">{{ yLabel(i) }}</text>
          <!-- 销售额折线 -->
          <polyline :points="salesPoints" fill="none" stroke="var(--p-dark)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
          <!-- 销售额面积 -->
          <polygon :points="salesAreaPoints" fill="var(--p-bg)"/>
          <!-- 毛利折线 -->
          <polyline :points="profitPoints" fill="none" stroke="var(--suc)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="4,2"/>
          <!-- 数据点 -->
          <circle v-for="(p,i) in salesCoords" :key="'c'+i" :cx="p.x" :cy="p.y" r="3" fill="var(--p-dark)"/>
          <!-- X 轴标签 -->
          <text v-for="(d,i) in trend" :key="'x'+i" :x="xCoord(i)" :y="chartH - padB + 16" text-anchor="middle" fill="var(--t3)" font-size="10">{{ d.date.slice(5) }}</text>
        </svg>
      </div>
      <div v-else class="state-empty"><div class="skel-line" style="width:80%;margin:20px auto"></div></div>
    </div>

    <div class="dual-grid">
      <!-- 返利达成环形图 -->
      <div class="card chart-card">
        <div class="panel-hd"><b>厂家返利达成</b><span class="tag info">{{ rebateData.length }} 个</span></div>
        <div v-if="rebateData.length" class="donut-area">
          <svg viewBox="0 0 200 200" class="donut-svg">
            <circle cx="100" cy="100" r="70" fill="none" stroke="var(--bg4)" stroke-width="20"/>
            <circle v-for="(r,i) in donutSegments" :key="i"
              cx="100" cy="100" r="70" fill="none"
              :stroke="r.color" stroke-width="20"
              :stroke-dasharray="r.dash"
              :stroke-dashoffset="r.offset"
              transform="rotate(-90 100 100)"
              style="transition:stroke-dasharray .5s"/>
            <text x="100" y="95" text-anchor="middle" fill="var(--t1)" font-size="24" font-weight="700">{{ avgAch }}%</text>
            <text x="100" y="115" text-anchor="middle" fill="var(--t3)" font-size="11">平均达成</text>
          </svg>
        </div>
        <div class="donut-legend" v-if="rebateData.length">
          <div v-for="(r,i) in rebateData.slice(0,6)" :key="r.contract_id" class="dl-item">
            <i class="dl-dot" :style="{background: donutColors[i % donutColors.length]}"></i>
            <span class="dl-name">{{ r.contact_name || '供应商#' + r.contact_id }}</span>
            <b>{{ r.achievement != null ? Math.round(r.achievement * 100) + '%' : '—' }}</b>
          </div>
        </div>
        <div v-else class="state-empty"><p>暂无返利数据</p></div>
      </div>

      <!-- 供应商返利明细 -->
      <div class="card chart-card">
        <div class="panel-hd"><b>返利进度明细</b><span class="tag info">{{ rebateData.length }} 家</span></div>
        <div class="rebate-list" v-if="rebateData.length">
          <div v-for="(r,i) in rebateData" :key="r.contract_id" class="rebate-row">
            <div class="rr-name">
              <i class="dl-dot" :style="{background: donutColors[i % donutColors.length]}"></i>
              {{ r.contact_name || ('供应商#' + r.contact_id) }}
            </div>
            <div class="rr-bar-wrap">
              <div class="rr-bar" :style="{width: (r.achievement != null ? Math.min(100, r.achievement * 100) : 0) + '%', background: donutColors[i % donutColors.length]}"></div>
            </div>
            <div class="rr-val">{{ r.achievement != null ? Math.round(r.achievement * 100) + '%' : '—' }}</div>
          </div>
        </div>
        <div v-else class="state-empty"><p>暂无返利数据</p></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { dashboardApi, auditApi } from '../api/modules'

const dashData = ref(null)
const rebateData = ref([])

// 图表常量
const chartW = 680
const chartH = 240
const padL = 50, padR = 20, padT = 20, padB = 30
const gridStep = (chartH - padT - padB) / 3

const trend = computed(() => dashData.value?.trend || [])
const maxVal = computed(() => Math.max(...trend.value.map(t => Math.max(t.sales, t.profit)), 1))

// 趋势图坐标计算
function xCoord(i) {
  const usable = chartW - padL - padR
  return padL + (usable / Math.max(1, trend.value.length - 1)) * i
}
function yCoord(v) {
  const usable = chartH - padT - padB
  return padT + usable - (v / maxVal.value) * usable
}

const salesCoords = computed(() => trend.value.map((d, i) => ({ x: xCoord(i), y: yCoord(d.sales) })))
const salesPoints = computed(() => salesCoords.value.map(p => `${p.x},${p.y}`).join(' '))
const salesAreaPoints = computed(() => {
  if (!salesCoords.value.length) return ''
  const last = salesCoords.value[salesCoords.value.length - 1]
  const first = salesCoords.value[0]
  return `${first.x},${chartH - padB} ` + salesPoints.value + ` ${last.x},${chartH - padB}`
})
const profitPoints = computed(() => trend.value.map((d, i) => `${xCoord(i)},${yCoord(d.profit)}`).join(' '))

function yLabel(i) {
  const v = maxVal.value * (1 - (i - 1) / 3)
  if (v >= 10000) return (v / 10000).toFixed(1) + '万'
  return Math.round(v)
}

// 返利环形图
const donutColors = ['#06b6d4', '#34c759', '#ff9f0a', '#ff3b30', '#5856d6', '#af52de']
const avgAch = computed(() => {
  const items = rebateData.value.filter(r => r.achievement != null)
  if (!items.length) return '—'
  return Math.round(items.reduce((s, r) => s + r.achievement, 0) / items.length * 100)
})
const donutSegments = computed(() => {
  const items = rebateData.value.slice(0, 6)
  const circumference = 2 * Math.PI * 70
  let offset = 0
  return items.map((r, i) => {
    const ach = Math.min(1, r.achievement || 0)
    const len = (ach / items.length) * circumference
    const seg = { color: donutColors[i % donutColors.length], dash: `${len} ${circumference}`, offset: -offset }
    offset += len
    return seg
  })
})

function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

async function loadData() {
  try {
    dashData.value = await dashboardApi.todayProfit()
  } catch (e) { /* 静默 */ }
  try {
    const d = await auditApi.rebateSummary()
    rebateData.value = d.data || d || []
  } catch (e) { /* 静默 */ }
}

onMounted(loadData)
</script>

<style scoped>
.page-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600}
.page-sub{font-size:12px;color:var(--t3)}
.chart-card{padding:16px;margin-bottom:14px}
.legend{display:flex;gap:14px}
.lg-item{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t2)}
.lg-dot{width:10px;height:10px;border-radius:3px;display:inline-block}
.dot-sales{background:var(--p-dark)}
.dot-profit{background:var(--suc);opacity:.6}
.chart-area{width:100%}
.trend-svg{width:100%;height:240px}
.dual-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.donut-area{display:flex;justify-content:center;padding:10px}
.donut-svg{width:180px;height:180px}
.donut-legend{display:flex;flex-direction:column;gap:6px;padding:0 8px}
.dl-item{display:flex;align-items:center;gap:8px;font-size:12px}
.dl-dot{width:8px;height:8px;border-radius:2px;flex-shrink:0}
.dl-name{flex:1;color:var(--t2)}
.dl-item b{color:var(--t1);font-variant-numeric:tabular-nums}

/* 返利进度明细 */
.rebate-list{display:flex;flex-direction:column;gap:12px;padding:6px 2px}
.rebate-row{display:flex;align-items:center;gap:10px}
.rr-name{width:96px;flex-shrink:0;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rr-bar-wrap{flex:1;height:8px;border-radius:4px;background:var(--bg4);overflow:hidden}
.rr-bar{height:100%;border-radius:4px;transition:width .5s}
.rr-val{width:46px;text-align:right;font-size:12px;font-weight:600;color:var(--t1);font-variant-numeric:tabular-nums}

@media(max-width:1200px){.dual-grid{grid-template-columns:1fr}}
@media(max-width:768px){.trend-svg{height:180px}}
</style>
