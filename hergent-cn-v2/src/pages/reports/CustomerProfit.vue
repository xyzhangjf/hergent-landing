<template>
  <ReportTable
    title="客户利润概览"
    subtitle="按客户的销额排行（利润口径暂不可用，详见下方提醒）"
    :table-title="'客户销额排行（由高到低 · ' + rows.length + ' 家）'"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    empty-hint="暂无客户销额数据。"
    @reload="load"
  >
    <template #extra>
      <!-- ⚠️ 为什么没有利润列：原文案整段保留 —— 这是本页「不画虚高利润」的诚实性依据，不许删。 -->
      <div class="card cpf-warn">
        <div class="cpf-warn-hd"><Icon name="alert" :size="14" /> 为什么没有「利润 / 毛利率」列？</div>
        <p>
          后端按客户算出的 <b>成本 / 利润 / 毛利率</b> 在当前生产数据下<b>不可信</b>：14 万余行已送达明细里
          <b>有进货价的行数 = 0</b> ⇒ 成本恒记为 0 ⇒ 利润恒等于销额、毛利率恒为 100%。
          因此本表<b>只列客户销额</b>，<b>不展示虚高的利润数字</b>。
          请先到「商品档案」补齐进货价，补齐后本页会自动启用利润口径。
        </p>
      </div>

      <!-- 原 tfoot「合计」。 -->
      <div class="card rpt-tot">
        <div class="sec-hd"><span>合计</span></div>
        <div class="rpt-tot-row">
          <span class="rpt-tot-i"><i>客户数</i><b>{{ rows.length }}</b></span>
          <span class="rpt-tot-i"><i>销额</i><b>{{ fmtMoney(totalRevenue) }}</b></span>
          <span class="rpt-tot-i"><i>占总额</i><b>100%</b></span>
        </div>
      </div>
    </template>

    <template #footnote>
      口径：数据源 <code>/api/reports/customer-profitability</code>，行 = 客户全字段 + 销额。
      销额 = 已送达 / 已签收订单 <code>total_amount</code> 求和（可信）；成本 / 利润 / 毛利率因缺进货价暂不可信，本页不展示。
      前端只读、不重算。
    </template>
  </ReportTable>
</template>

<script setup>
/* 客户利润概览（数据报表）—— 数据源：GET /api/reports/customer-profitability（返回数组，已按 profit 排好）。
   🔴 纪律（modules.js 注释逐字对齐）：`revenue` 可信，**cost / profit / margin 不可信**（生产进货价缺失 ⇒ 恒 0 / 100%）。
       ⇒ 本页**只列客户销额**，严禁把 profit/margin 当成真利润画出来。
   🔴 本页**只读**；补进货价去「商品档案」，补完后利润口径自动可用。
   v646：外壳收编进 ReportTable（KPI / 列 / 行 / 口径脚注）；警示卡与原 tfoot 合计移入 #extra。
   🔴 金额沿用原页精确元格式（fmt 'rmb'），不缩万元。
   🔴 不开 `filterable`：/api/reports/customer-profitability 不支持 date_from/date_to。 */
import ReportTable from '../../components/ReportTable.vue'
import Icon from '../../components/Icon.vue'
import { ref, computed, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const rawRows = ref([])

const columns = [
  { key: 'seq', label: '序号', cls: 'num' },
  { key: 'name', label: '客户' },
  { key: 'revenue', label: '销额', fmt: 'rmb', cls: 'num' },
  { key: 'share', label: '占总额', cls: 'num' },
]

const rows = computed(() => rawRows.value.map((r, i) => ({
  ...r,
  seq: i + 1,
  name: r.name || '—',
  revenue: Number(r.revenue || 0),
  share: pct(r.revenue),
})))

const totalRevenue = computed(() => rows.value.reduce((s, r) => s + Number(r.revenue || 0), 0))
const avgRevenue = computed(() => rows.value.length ? totalRevenue.value / rows.value.length : 0)

const kpis = computed(() => [
  { label: '客户数', value: String(rows.value.length), sub: '有销额的客户' },
  { label: '总销额', value: fmtMoney(totalRevenue.value), sub: '已送达 / 已签收订单' },
  { label: '平均销额', value: fmtMoney(avgRevenue.value), sub: '总销额 ÷ 客户数' },
  { label: '利润口径', value: '暂不可用', sub: '缺进货价' },
])

function fmtMoney (n) {
  const v = Number(n || 0)
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function pct (n) {
  const t = totalRevenue.value
  return t > 0 ? (Number(n || 0) / t * 100).toFixed(1) + '%' : '—'
}

async function load () {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.customerProfitability()
    rawRows.value = Array.isArray(d) ? d.map((r) => ({ ...r, revenue: Number(r.revenue || 0) })) : []
  } catch (e) {
    err.value = (e && e.message) || '客户销额读取失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
defineExpose({ load })
</script>

<style scoped>
/* 仅保留仍被引用的私有类（警示卡 / 合计卡挂在 #extra 插槽，插槽内容在本页作用域编译）。 */
.cpf-warn { border-left: 3px solid var(--war); margin-top: 14px; }
.cpf-warn-hd { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--warn); margin-bottom: 6px; }
.cpf-warn p { font-size: 12px; color: var(--t2); line-height: 1.7; margin: 0; }
.rpt-tot { margin-top: 14px; padding: 12px 14px; }
.rpt-tot-row { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 8px; }
.rpt-tot-i { display: flex; align-items: baseline; gap: 6px; font-size: 13px; }
.rpt-tot-i i { font-style: normal; color: var(--t2); }
.rpt-tot-i b { color: var(--t1); }
</style>
