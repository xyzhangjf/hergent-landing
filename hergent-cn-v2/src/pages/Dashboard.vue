<template>
  <div class="page">
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

  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { dashboardApi } from '../api/modules'

const dashData = ref(null)

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

function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

async function loadData() {
  try {
    dashData.value = await dashboardApi.todayProfit()
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
@media(max-width:1200px){.dual-grid{grid-template-columns:1fr}}
@media(max-width:768px){.trend-svg{height:180px}}
</style>
