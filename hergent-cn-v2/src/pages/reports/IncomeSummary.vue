<template>
  <ReportTable
    title="收入汇总表"
    subtitle="收入单（income_orders）的明细与合计"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    emptyHint="暂无收入单数据。"
    filterable
    @reload="load"
    @filter="onFilter"
  >
    <template #footnote>
      数据源 <code>GET /api/reports/income-summary</code>。金额单位元。
      🔴 若显示「暂无数据」，说明当前账套尚未录入收入单——是真实业务状态，并非接口异常。
    </template>
  </ReportTable>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'
import ReportTable from '../../components/ReportTable.vue'

const loading = ref(true)
const err = ref('')
const raw = ref({ rows: [], total: {} })

/* v651：日期筛选（后端 income-summary 已支持 date_from/date_to，按 order_date）。拼 query 给后端算，前端不本地过滤。 */
const filter = ref({ date_from: '', date_to: '' })
function qs() {
  const p = []
  if (filter.value.date_from) p.push('date_from=' + encodeURIComponent(filter.value.date_from))
  if (filter.value.date_to) p.push('date_to=' + encodeURIComponent(filter.value.date_to))
  return p.length ? '?' + p.join('&') : ''
}
function onFilter(r) { filter.value = { ...r }; load() }

const columns = [
  { key: 'order_no', label: '单号' },
  { key: 'type', label: '类型' },
  { key: 'category_id', label: '收入类别' },
  { key: 'amount', label: '金额', fmt: 'money' },
  { key: 'received_amount', label: '已收', fmt: 'money' },
  { key: 'status', label: '状态' },
  { key: 'order_date', label: '日期', fmt: 'date' },
]

const rows = computed(() => Array.isArray(raw.value.rows) ? raw.value.rows : [])
const total = computed(() => raw.value.total || {})
const kpis = computed(() => [
  { label: '单据数', value: fmtInt(total.value.count) },
  { label: '收入总额', value: fmtMoney(total.value.amount) },
  { label: '已收金额', value: fmtMoney(total.value.received) },
])

function fmtMoney(v) {
  const n = Number(v || 0)
  if (Math.abs(n) >= 10000) return '¥' + (n / 10000).toFixed(1) + ' 万'
  return '¥' + n.toFixed(2)
}
function fmtInt(v) { return Number(v || 0).toLocaleString('zh-CN') }

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.incomeSummary(qs())
    raw.value = (d && typeof d === 'object') ? d : { rows: [], total: {} }
  } catch (e) {
    err.value = (e && e.message) || '加载失败'
    raw.value = { rows: [], total: {} }
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>
