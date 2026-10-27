<template>
  <ReportTable
    title="调拨订单明细"
    subtitle="调拨订单逐单列表（与「调拨汇总表」同源）"
    table-title="调拨订单明细"
    :columns="columns"
    :rows="rows"
    :loading="loading"
    :err="err"
    :empty-hint="emptyHint"
    filterable
    :breadcrumb="breadcrumb"
    persist-key="transfer-detail"
    @reload="load"
    @filter="onFilter"
  >
    <!-- v701：调拨**没有**下一层可下探，这一点明说，不留"为什么别人的单号能点我点不了"的疑惑。
         事实根据（生产实测）：`transfer_orders` 一行就是**一个商品**（含 product_name /
         quantity / from_wh / to_wh），没有「单头 + 明细」两层；且路由里没有 transfer/:id
         详情页（v449 注释明确写着不要写）。所以本页就是末级。 -->
    <template #footnote>
      调拨单一行就是一个商品，同一调拨单号可能出现多行——本页已经是最终明细，没有下一层可展开。
    </template>
  </ReportTable>
</template>

<script setup>
/* 调拨订单明细（v640b）—— 数据源 GET /api/reports/transfer-detail（= transfer_orders，与 transferSummary 同源）。 */
import ReportTable from '../../components/ReportTable.vue'
import { ref, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const rows = ref([])
const emptyHint = ref('暂无调拨订单数据。')

const STATUS = {
  draft: '草稿', confirmed: '已确认', in_transit: '在途', completed: '已完成', cancelled: '已取消',
}

/* v701：下探路径。本页是末级（调拨单没有详情页，行即商品明细），故不加 `drill` 列。 */
const breadcrumb = [
  { label: '数据报表' },
  { label: '调拨订单明细' },
]

const columns = [
  /* 🔴 v701：这里**故意不给** `drill`。调拨无详情页（路由注释：别写 transfer/:id），
     而行本身已经带商品名/数量/仓库 —— 再加一层"点进去看什么"就是空转。
     若将来加了调拨详情页，这里补 `drill: 'transfer'` 并在 ReportTable 的 DRILL_BASE 登记即可。 */
  { key: 'order_no', label: '调拨单号' },
  { key: 'product_name', label: '商品' },
  { key: 'from_wh', label: '调出仓' },
  { key: 'to_wh', label: '调入仓' },
  { key: 'quantity', label: '数量', fmt: 'num', cls: 'num' },
  { key: 'handling_fee', label: '手续费(元)', fmt: 'rmb', cls: 'num' },
  { key: 'status', label: '状态' },
  { key: 'created_at', label: '创建时间', fmt: 'date' },
]

function mapRow(r) {
  return { ...r, status: STATUS[r.status] || r.status || '—' }
}

/* v643：日期筛选（后端 /api/reports/transfer-detail 已支持 date_from/date_to，按 created_at）。 */
const filter = ref({ date_from: '', date_to: '' })
function qs() {
  const p = []
  if (filter.value.date_from) p.push('date_from=' + encodeURIComponent(filter.value.date_from))
  if (filter.value.date_to) p.push('date_to=' + encodeURIComponent(filter.value.date_to))
  return p.length ? '?' + p.join('&') : ''
}
function onFilter(r) { filter.value = { ...r }; load() }

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.transferDetail(qs())
    const list = Array.isArray(d) ? d : (d.rows || [])
    rows.value = list.map(mapRow)
    if (!rows.value.length) emptyHint.value = '暂无调拨订单数据（或当前筛选无匹配）。'
  } catch (e) {
    err.value = (e && e.message) || '调拨订单明细读取失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
defineExpose({ load })
</script>
