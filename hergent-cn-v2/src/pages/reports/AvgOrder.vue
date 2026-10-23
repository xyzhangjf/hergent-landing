<template>
  <ReportTable
    title="均单分析"
    subtitle="按月份 / 客户 / 品牌 · 只统计已送达、已签收的订单"
    :table-title="'均单明细（按销售额从高到低 · ' + dimName + '）'"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    empty-hint="该维度暂无数据。"
    @reload="load"
  >
    <template #extra>
      <!-- 维度页签：骨架表头没有控件插槽，原样放在 #extra；切换后上方主表随之重新取数。 -->
      <div class="card rpt-tabs-card">
        <div class="sec-hd rpt-sec">
          <span>维度切换（上方表格随之刷新）</span>
          <div class="rpt-tabs">
            <button v-for="t in tabs" :key="t.key"
                    class="btn btn-ghost btn-sm" :class="{ 'rpt-on': dim === t.key }"
                    @click="switchDim(t.key)">{{ t.name }}</button>
          </div>
        </div>
      </div>

      <!-- 原 tfoot「本页合计」：只对可见行的可加总列求和（订单数 / 销售额 / 销售件数）。 -->
      <div class="card rpt-tot">
        <div class="sec-hd"><span>本页合计</span></div>
        <div class="rpt-tot-row">
          <span class="rpt-tot-i"><i>订单数</i><b>{{ fmtInt(totalOrders) }}</b></span>
          <span class="rpt-tot-i"><i>销售额</i><b>{{ fmtMoney(totalRevenue) }}</b></span>
          <span class="rpt-tot-i"><i>销售件数</i><b>{{ fmtNum(totalQty) }}</b></span>
        </div>
      </div>
    </template>

    <template #footnote>
      口径：仅统计「已送达 / 已签收」的销售订单。
      <b>均单金额 = 销售额 ÷ 订单数</b>（两者同为已送达口径，前端不做除法以外的事）。
      🔴 后端 BI 自带的 <code>avg_order_value</code> 字段<b>未过滤订单状态</b>（把未送达订单也算进分母），
      与「销售额」口径不一致，会把均单算小 —— 本页<b>不采用</b>它，已登记为后端待修项。
      数据源 <code>POST /api/bi/pivot</code>。
    </template>
  </ReportTable>
</template>

<script setup>
/* 均单分析（数据报表 › 经营分析）—— 数据源：POST /api/bi/pivot。
   🔴 不新造后端：BI 引擎已提供 order_count / revenue / quantity 三个同口径指标，
      本页只是换 dimensions 做分组展示。
   🔴 均单不用后端 avg_order_value（口径混入未送达订单，见 api/modules.js 注释），
      改用 revenue ÷ order_count —— 分子分母同为「已送达/已签收」口径。
   🔴 本页只读、无「新建 / 编辑」入口：均单是销售的结果，不是可编辑对象。
   v646：外壳收编进 ReportTable（KPI / 列 / 行 / 口径脚注）；维度页签与原 tfoot 合计
      原样移入 #extra，取数与均单算法一字未动。
   🔴 不开 `filterable`：/api/bi/pivot 不支持 date_from/date_to，开了就是假筛选。 */
import ReportTable from '../../components/ReportTable.vue'
import { ref, computed, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const dim = ref('month')
const raw = ref([])

const tabs = [
  { key: 'month', name: '按月份', dim: 'month', label: '月份' },
  { key: 'customer', name: '按客户', dim: 'customer_name', label: '客户' },
  { key: 'brand', name: '按品牌', dim: 'brand', label: '品牌' },
]

const dimName = computed(() => (tabs.find(t => t.key === dim.value) || tabs[0]).label)

/* 维度列的标题随页签变，故 columns 用 computed；其余列固定。 */
const columns = computed(() => [
  { key: 'seq', label: '序号', cls: 'num' },
  { key: 'name', label: dimName.value },
  { key: 'order_count', label: '订单数', fmt: 'num', cls: 'num' },
  { key: 'revenue', label: '销售额', fmt: 'money', cls: 'num' },
  { key: 'quantity', label: '销售件数', fmt: 'num', cls: 'num' },
  { key: 'avg_order', label: '均单金额', fmt: 'money', cls: 'num' },
  { key: 'share', label: '占比' },
])

const rows = computed(() => {
  const list = [...(raw.value || [])]
  list.sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))
  return list.map((r, i) => ({
    ...r,
    seq: i + 1,
    name: nameOf(r),
    order_count: Number(r.order_count || 0),
    quantity: Number(r.quantity || 0),
    revenue: Number(r.revenue || 0),
    avg_order: avgOf(r),
    share: shareText(r.revenue),
  }))
})

const totalOrders = computed(() => rows.value.reduce((s, r) => s + Number(r.order_count || 0), 0))
const totalRevenue = computed(() => rows.value.reduce((s, r) => s + Number(r.revenue || 0), 0))
const totalQty = computed(() => rows.value.reduce((s, r) => s + Number(r.quantity || 0), 0))
const avgOrder = computed(() => (totalOrders.value ? totalRevenue.value / totalOrders.value : 0))
const avgQty = computed(() => (totalOrders.value ? totalQty.value / totalOrders.value : 0))

/** 每行的均单 = 该行销售额 ÷ 该行订单数（同口径相除，不是重算业务口径） */
function avgOf(r) {
  const n = Number(r.order_count || 0)
  return n ? Number(r.revenue || 0) / n : 0
}

function nameOf(r) {
  const t = tabs.find(x => x.key === dim.value) || tabs[0]
  const v = r[t.dim]
  return (v === null || v === undefined || v === '') ? '未分类' : String(v)
}

function shareText(v) {
  const t = totalRevenue.value
  return t > 0 ? (Number(v || 0) / t * 100).toFixed(1) + '%' : '—'
}

const kpis = computed(() => [
  { label: '订单数', value: fmtInt(totalOrders.value), sub: '已送达 / 已签收' },
  { label: '销售额', value: fmtMoney(totalRevenue.value), sub: '订单金额合计' },
  { label: '均单金额', value: fmtMoney(avgOrder.value), sub: '销售额 ÷ 订单数' },
  { label: '均单件数', value: fmtNum(avgQty.value), sub: '销售件数 ÷ 订单数' },
])

function fmtMoney(v) {
  const n = Number(v || 0)
  if (Math.abs(n) >= 10000) return '¥' + (n / 10000).toFixed(1) + ' 万'
  return '¥' + n.toFixed(0)
}
function fmtInt(v) { return Number(v || 0).toLocaleString('zh-CN') }
function fmtNum(v) { return Number(v || 0).toFixed(1) }

async function load() {
  loading.value = true
  err.value = ''
  try {
    const t = tabs.find(x => x.key === dim.value) || tabs[0]
    const d = await reportsApi.biPivot({
      dimensions: [t.dim],
      measures: ['order_count', 'revenue', 'quantity'],
      filters: {},
      limit: 200,
    })
    raw.value = Array.isArray(d) ? d : (d && Array.isArray(d.rows) ? d.rows : [])
  } catch (e) {
    err.value = (e && e.message) || '加载失败'
    raw.value = []
  } finally {
    loading.value = false
  }
}

function switchDim(k) {
  if (dim.value === k) return
  dim.value = k
  raw.value = []
  load()
}

onMounted(load)
</script>

<style scoped>
/* 仅保留仍被引用的私有类（页签 / 合计卡挂在 #extra 插槽，插槽内容在本页作用域编译）。 */
.rpt-sec { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.rpt-tabs { display: flex; gap: 6px; }
.rpt-on { background: var(--bg2); color: var(--t1); font-weight: 600; }
.rpt-tabs-card { margin-top: 14px; }
.rpt-tot { margin-top: 14px; padding: 12px 14px; }
.rpt-tot-row { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 8px; }
.rpt-tot-i { display: flex; align-items: baseline; gap: 6px; font-size: 13px; }
.rpt-tot-i i { font-style: normal; color: var(--t2); }
.rpt-tot-i b { color: var(--t1); }
</style>
