<template>
  <ReportTable
    title="销售订单明细"
    subtitle="销售订单逐单列表（与「销售订单汇总表」同源，排除已取消）"
    table-title="销售订单明细"
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
/* 销售订单明细（v640b）—— 数据源 GET /api/reports/sales-detail（= sale_orders，与 salesSummary 同源）。
   🔴 口径不在前端重算；状态由后端给，前端只做中文映射展示。 */
import ReportTable from '../../components/ReportTable.vue'
import { ref, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const rows = ref([])
const emptyHint = ref('暂无销售订单数据。')

const STATUS = {
  draft: '草稿', pending: '待处理', approved: '已审核', confirmed: '已确认',
  signed: '已签收', delivered: '已发货', shipped: '已出库', cancelled: '已取消',
}
const DELIVERY = { pending: '待发货', shipped: '已发货', received: '已签收', '' : '' }
const INVOICE = { none: '未开票', done: '已开票', partial: '部分开票', '' : '' }

const columns = [
  { key: 'order_no', label: '订单号' },
  { key: 'customer', label: '客户' },
  { key: 'order_date', label: '下单日期', fmt: 'date' },
  { key: 'total_amount', label: '金额(元)', fmt: 'rmb', cls: 'num' },
  { key: 'received_amount', label: '已收(元)', fmt: 'rmb', cls: 'num' },
  { key: 'status', label: '状态' },
  { key: 'delivery_status', label: '发货' },
  { key: 'invoice_status', label: '发票' },
]

function mapRow(r) {
  return {
    ...r,
    status: STATUS[r.status] || r.status || '—',
    delivery_status: DELIVERY[r.delivery_status] ?? (r.delivery_status || '—'),
    invoice_status: INVOICE[r.invoice_status] ?? (r.invoice_status || '—'),
  }
}

/* v643：日期筛选。🔴 后端 /api/reports/sales-detail 已支持 date_from/date_to 才敢开
   `filterable`；参数拼在 query 上，绝不在前端本地过滤（口径必须后端算）。 */
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
    const d = await reportsApi.salesDetail(qs())
    const list = Array.isArray(d) ? d : (d.rows || [])
    rows.value = list.map(mapRow)
    if (!rows.value.length) emptyHint.value = '暂无销售订单数据（或当前筛选无匹配）。'
  } catch (e) {
    err.value = (e && e.message) || '销售订单明细读取失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
defineExpose({ load })
</script>
