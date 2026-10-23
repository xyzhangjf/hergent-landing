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
    @reload="load"
    @filter="onFilter"
  />
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

const columns = [
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
