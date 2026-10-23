<template>
  <ReportTable
    title="汇总报表"
    subtitle="按月份的经营汇总 · 只统计已送达、已签收的订单"
    table-title="月度汇总（按销售额从高到低）"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    empty-hint="暂无月度汇总数据。"
    @reload="load"
  >
    <template #extra>
      <!-- 原 tfoot「合计」：与 KPI 同源（KPI 就是这些合计），保留为独立一行便于与表体对照。 -->
      <div class="card rpt-tot">
        <div class="sec-hd"><span>合计</span></div>
        <div class="rpt-tot-row">
          <span class="rpt-tot-i"><i>订单数</i><b>{{ fmtInt(totals.order_count) }}</b></span>
          <span class="rpt-tot-i"><i>销售额</i><b>{{ fmtMoney(totals.revenue) }}</b></span>
          <span class="rpt-tot-i"><i>销售件数</i><b>{{ fmtNum(totals.quantity) }}</b></span>
          <span class="rpt-tot-i"><i>成本</i><b>{{ fmtMoney(totals.cost) }}</b></span>
          <span class="rpt-tot-i"><i>毛利</i><b>{{ fmtMoney(totals.profit) }}</b></span>
        </div>
      </div>
    </template>

    <template #footnote>
      口径：仅统计「已送达 / 已签收」的销售订单；收入 = 明细实际成交金额，成本 = 净销量 × 商品进货价。
      🔴 商品档案若<b>未录入进货价</b>，成本记 0、毛利随之虚高 —— 此时毛利率仅供参考、不代表真实盈利。
      数据源 <code>POST /api/bi/pivot</code>。
    </template>
  </ReportTable>
</template>

<script setup>
/* 汇总报表（数据报表）—— 数据源：POST /api/bi/pivot。
   🔴 不新造后端：BI 引擎按月维度聚合 order_count / revenue / quantity / cost / profit / margin_pct。
   🔴 只读、前端不重算：毛利与毛利率由后端按 soi.amount − 进货价 给出，前端只做展示格式化。
   🔴 缺进货价 ⇒ 成本记 0 ⇒ 毛利虚高，须显式提示，不静默当真盈利。
   v646：外壳收编进 ReportTable（KPI / 列 / 行 / 口径脚注）；原 tfoot 合计移入 #extra，
      取数与合计算法一字未动。
   🔴 不开 `filterable`：/api/bi/pivot 不支持 date_from/date_to，开了就是假筛选。 */
import ReportTable from '../../components/ReportTable.vue'
import { ref, computed, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const raw = ref([])

const columns = [
  { key: 'seq', label: '序号', cls: 'num' },
  { key: 'month', label: '月份' },
  { key: 'order_count', label: '订单数', fmt: 'num', cls: 'num' },
  { key: 'revenue', label: '销售额', fmt: 'money', cls: 'num' },
  { key: 'quantity', label: '销售件数', fmt: 'num', cls: 'num' },
  { key: 'cost', label: '成本', fmt: 'money', cls: 'num' },
  { key: 'profit', label: '毛利', fmt: 'money', cls: 'num' },
  { key: 'margin_pct_txt', label: '毛利率', cls: 'num' },
]

const rows = computed(() => {
  const list = [...(raw.value || [])]
  list.sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))
  return list.map((r, i) => ({
    ...r,
    seq: i + 1,
    month: r.month || '未分类',
    order_count: Number(r.order_count || 0),
    revenue: Number(r.revenue || 0),
    quantity: Number(r.quantity || 0),
    cost: Number(r.cost || 0),
    profit: Number(r.profit || 0),
    margin_pct_txt: fmtPct(r.margin_pct),
  }))
})

const totals = computed(() => {
  const rs = rows.value
  const sum = (k) => rs.reduce((s, r) => s + Number(r[k] || 0), 0)
  const rev = sum('revenue')
  const cost = sum('cost')
  const margin = rev > 0 ? Math.round(1000 * (rev - cost) / rev) / 10 : 0
  return {
    revenue: rev,
    cost,
    profit: rev - cost,
    quantity: sum('quantity'),
    order_count: sum('order_count'),
    margin_pct: margin,
  }
})

const kpis = computed(() => [
  { label: '总销售额', value: fmtMoney(totals.value.revenue), sub: '已送达 / 已签收' },
  { label: '总订单数', value: fmtInt(totals.value.order_count), sub: '笔' },
  { label: '总销售件数', value: fmtNum(totals.value.quantity), sub: '件' },
  { label: '平均毛利率', value: fmtPct(totals.value.margin_pct), sub: '销售额加权' },
])

function fmtMoney(v) {
  const n = Number(v || 0)
  if (Math.abs(n) >= 10000) return '¥' + (n / 10000).toFixed(1) + ' 万'
  return '¥' + n.toFixed(0)
}
function fmtInt(v) { return Number(v || 0).toLocaleString('zh-CN') }
function fmtNum(v) { return Number(v || 0).toFixed(1) }
function fmtPct(v) { const n = Number(v || 0); return (n > 0 ? n : 0).toFixed(1) + '%' }

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.biPivot({
      dimensions: ['month'],
      measures: ['order_count', 'revenue', 'quantity', 'cost', 'profit', 'margin_pct'],
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

onMounted(load)
</script>

<style scoped>
/* 仅保留仍被引用的私有类（合计卡挂在 #extra 插槽，插槽内容在本页作用域编译）。 */
.rpt-tot { margin-top: 14px; padding: 12px 14px; }
.rpt-tot-row { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 8px; }
.rpt-tot-i { display: flex; align-items: baseline; gap: 6px; font-size: 13px; }
.rpt-tot-i i { font-style: normal; color: var(--t2); }
.rpt-tot-i b { color: var(--t1); }
</style>
