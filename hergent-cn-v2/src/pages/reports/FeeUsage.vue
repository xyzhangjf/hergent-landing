<template>
  <ReportTable
    title="费用使用记录"
    subtitle="费用申请（expense_requests）的使用明细"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    emptyHint="暂无费用使用记录。"
    @reload="load"
  >
    <template #footnote>
      数据源 <code>GET /api/reports/fee-usage</code>。金额单位元。
      🔴 若显示「暂无数据」，说明当前账套尚未提交费用申请——是真实业务状态，并非接口异常。
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

const columns = [
  { key: 'contact_id', label: '往来单位' },
  { key: 'amount', label: '金额', fmt: 'money' },
  { key: 'category', label: '类别' },
  { key: 'note', label: '说明' },
  { key: 'status', label: '状态' },
  { key: 'operator_id', label: '操作人' },
  { key: 'created_at', label: '提交时间', fmt: 'date' },
]

const rows = computed(() => Array.isArray(raw.value.rows) ? raw.value.rows : [])
const total = computed(() => raw.value.total || {})
const kpis = computed(() => [
  { label: '记录数', value: fmtInt(total.value.count) },
  { label: '金额', value: fmtMoney(total.value.amount) },
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
    const d = await reportsApi.feeUsage()
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
