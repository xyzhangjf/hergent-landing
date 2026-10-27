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
    :breadcrumb="breadcrumb"
    persist-key="purchase-detail"
    @reload="load"
    @filter="onFilter"
  >
    <!-- v701：把「部分历史单没有明细行」写在页面上，而不是让老板点进去看到空表再猜。
         多数采购单来自舟谱导入，导入的是**单头金额**，没有逐商品行；
         点进单据真身看到空白，是本就没有记录，不是加载失败。 -->
    <template #footnote>
      点单号进入该采购单的完整单据（含审批、入库、付款）；早期导入的采购单只有单据金额、
      没有逐商品明细行，进去后商品表为空属正常。
    </template>
  </ReportTable>
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

/* v701：下探路径。第一级是侧栏分组（无独立首页）⇒ 只做文字不做链接。 */
const breadcrumb = [
  { label: '数据报表' },
  { label: '采购订单明细' },
]

const columns = [
  /* v701：订单号可点 → /inventory/purchase/:id（与该单的预付/入库/付款同一页）。
     依赖后端返回 `p.id`（v701 补）；没 id 时组件自动退回纯文本。 */
  { key: 'order_no', label: '订单号', drill: 'purchase' },
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
