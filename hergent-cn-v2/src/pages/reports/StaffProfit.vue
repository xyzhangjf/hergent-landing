<template>
  <ReportTable
    title="员工利润分析"
    subtitle="业务员龙虎榜 · 销售 / 回款 / 新客（利润口径待进货价补齐）"
    :table-title="'业务员' + tabLabel + '榜'"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    :empty-hint="'本月（' + (d.month || '—') + '）该榜暂无业绩数据 —— 后端对 0 值榜单返回空列表，这是诚实空态（不是「业绩为 ¥0」），待业务员产生对应业绩后自动出现。'"
    @reload="load"
  >
    <template #extra>
      <!-- 榜单页签：骨架表头没有控件插槽，原样放在 #extra；切换后上方主表随之切换榜单。 -->
      <div class="card spf-tabs-card">
        <div class="sec-hd spf-sec">
          <span>榜单切换（上方表格随之刷新）</span>
          <div class="spf-tabs">
            <button v-for="t in tabs" :key="t.key" class="btn btn-ghost btn-sm"
                    :class="{ 'spf-on': tab === t.key }" @click="tab = t.key">{{ t.name }}</button>
          </div>
        </div>
      </div>
    </template>

    <template #footnote>
      口径：数据源 <code>/api/reports/sales-leaderboard</code>，由后端按月聚合、各榜过滤 0 值取前 3。
      销额 / 回款额单位元。利润口径因商品档案进货价缺失暂不可信，本页展示业务员<b>业绩</b>（销额 / 回款 / 新客），不展示利润。前端只读、不重算。
    </template>
  </ReportTable>
</template>

<script setup>
/* 员工利润分析（数据报表）—— 数据源：GET /api/reports/sales-leaderboard（= db.get_sales_leaderboard）。
   返回 { month, has_data, top_sales[], top_payments[], top_new[] }，每榜为 {name,sales,orders,payments,new_custs,bound}，过滤 0 值、取前 3。
   🔴 利润口径因缺进货价暂不可信 ⇒ 本页展示业务员**业绩**（销额 / 回款 / 新客），不展示利润。
   🔴 后端对 0 值榜单返回空数组（「暂无」比「¥0」诚实），前端照实显示空态。
   🔴 本页**只读**。
   v646：外壳收编进 ReportTable（KPI / 列 / 行 / 空态 / 口径脚注）；榜单页签移入 #extra，
      取数与榜单汇总算法一字未动。
   🔴 金额沿用原页精确元格式（fmt 'rmb'），不缩万元。
   🔴 不开 `filterable`：/api/reports/sales-leaderboard 不支持 date_from/date_to，开了就是假筛选。 */
import ReportTable from '../../components/ReportTable.vue'
import { ref, computed, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const d = ref({ month: '', has_data: false, top_sales: [], top_payments: [], top_new: [] })
const tab = ref('sales')

const tabs = [
  { key: 'sales', name: '销售业绩' },
  { key: 'payments', name: '回款榜' },
  { key: 'new', name: '新客开拓' }
]

const columns = [
  { key: 'seq', label: '名次', cls: 'num' },
  { key: 'name', label: '业务员' },
  { key: 'sales', label: '销额', fmt: 'rmb', cls: 'num' },
  { key: 'orders', label: '订单数', fmt: 'num', cls: 'num' },
  { key: 'payments', label: '回款额', fmt: 'rmb', cls: 'num' },
  { key: 'new_custs', label: '新客数', fmt: 'num', cls: 'num' },
]

const activeList = computed(() => {
  if (tab.value === 'payments') return Array.isArray(d.value.top_payments) ? d.value.top_payments : []
  if (tab.value === 'new') return Array.isArray(d.value.top_new) ? d.value.top_new : []
  return Array.isArray(d.value.top_sales) ? d.value.top_sales : []
})

const rows = computed(() => activeList.value.map((r, i) => ({
  ...r,
  seq: i + 1,
  name: r.name || '—',
  sales: Number(r.sales || 0),
  orders: r.orders ?? '',
  payments: Number(r.payments || 0),
  new_custs: r.new_custs ?? '',
})))

const tabLabel = computed(() => {
  if (tab.value === 'payments') return '回款额'
  if (tab.value === 'new') return '新客数'
  return '销额'
})
const metricText = computed(() => {
  const list = activeList.value
  if (tab.value === 'new') {
    const n = list.reduce((s, r) => s + Number(r.new_custs || 0), 0)
    return n + ' 个'
  }
  const sum = list.reduce((s, r) => s + Number(tab.value === 'payments' ? r.payments : r.sales || 0), 0)
  return fmtMoney(sum)
})

const kpis = computed(() => [
  { label: '统计月份', value: d.value.month || '—', sub: '自然月' },
  { label: '上榜人数', value: String(rows.value.length), sub: '本榜有业绩者' },
  { label: tabLabel.value + '合计', value: metricText.value, sub: '本榜汇总' },
  { label: '利润口径', value: '暂不可用', sub: '缺进货价' },
])

function fmtMoney (n) {
  const v = Number(n || 0)
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function load () {
  loading.value = true
  err.value = ''
  try {
    const r = await reportsApi.salesLeaderboard()
    d.value = {
      month: r.month || '',
      has_data: !!r.has_data,
      top_sales: Array.isArray(r.top_sales) ? r.top_sales : [],
      top_payments: Array.isArray(r.top_payments) ? r.top_payments : [],
      top_new: Array.isArray(r.top_new) ? r.top_new : []
    }
  } catch (e) {
    err.value = (e && e.message) || '业务员业绩读取失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
defineExpose({ load })
</script>

<style scoped>
/* 仅保留仍被引用的私有类（页签卡挂在 #extra 插槽，插槽内容在本页作用域编译）。 */
.spf-sec { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.spf-tabs { display: flex; gap: 6px }
.spf-tabs .spf-on { background: var(--bg2); color: var(--t1); font-weight: 600 }
.spf-tabs-card { margin-top: 14px }
</style>
