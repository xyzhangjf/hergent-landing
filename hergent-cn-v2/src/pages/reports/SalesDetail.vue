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
    :breadcrumb="breadcrumb"
    persist-key="sales-detail"
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

/* v701：下探路径。第一级「数据报表」是侧栏分组，没有独立首页 ⇒ 只做文字不做链接
   （给它一个点了会 404 的地址，等于假入口）。末级就是本页，组件会渲染成不可点。 */
const breadcrumb = [
  { label: '数据报表' },
  { label: '销售订单明细' },
]

const columns = [
  /* v701：订单号可点 → 该单详情页（/inventory/sale/:id）。
     🔴 前提是后端 `/api/reports/sales-detail` 已返回 `s.id`（v701 补）。
        没有 id 时 ReportTable 会自动退回纯文本，不会拼出错误地址。 */
  { key: 'order_no', label: '订单号', drill: 'sale' },
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
