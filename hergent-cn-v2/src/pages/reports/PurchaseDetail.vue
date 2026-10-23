<template>
  <ReportTable
    title="采购订单明细"
    subtitle="采购订单逐单列表（与「采购汇总表」同源，排除已取消）"
    table-title="采购订单明细"
    :columns="columns"
    :rows="rows"
    :loading="loading"
    :err="err"
    :empty-hint="emptyHint"
    filterable
    @reload="load"
    @filter="onFilter"
  />
</template>

<script setup>
/* 采购订单明细（v640b）—— 数据源 GET /api/reports/purchase-detail（= purchase_orders，与 purchaseSummary 同源）。 */
import ReportTable from '../../components/ReportTable.vue'
import { ref, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const rows = ref([])
const emptyHint = ref('暂无采购订单数据。')

const STATUS = {
  draft: '草稿', pending: '待处理', approved: '已审核', confirmed: '已确认',
  partial: '部分收货', received: '已收货', issued: '已下发', cancelled: '已取消',
}

const columns = [
  { key: 'order_no', label: '订单号' },
  { key: 'supplier', label: '供应商' },
  { key: 'order_date', label: '下单日期', fmt: 'date' },
  { key: 'total_amount', label: '金额(元)', fmt: 'rmb', cls: 'num' },
  { key: 'paid_amount', label: '已付(元)', fmt: 'rmb', cls: 'num' },
  { key: 'status', label: '状态' },
]

function mapRow(r) {
  return { ...r, status: STATUS[r.status] || r.status || '—' }
}

/* v643：日期筛选（后端 /api/reports/purchase-detail 已支持 date_from/date_to）。 */
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
    const d = await reportsApi.purchaseDetail(qs())
    const list = Array.isArray(d) ? d : (d.rows || [])
    rows.value = list.map(mapRow)
    if (!rows.value.length) emptyHint.value = '暂无采购订单数据（或当前筛选无匹配）。'
  } catch (e) {
    err.value = (e && e.message) || '采购订单明细读取失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
defineExpose({ load })
</script>
