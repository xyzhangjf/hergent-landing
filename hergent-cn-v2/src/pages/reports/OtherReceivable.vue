<template>
  <ReportTable
    title="其他应收汇总表"
    subtitle="应收（receivables）中非销售应收（type≠ar）的明细与合计"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    emptyHint="暂无其他应收数据。"
    @reload="load"
  >
    <template #footnote>
      数据源 <code>GET /api/reports/other-receivable</code>。金额单位元。
      🔴 当前租户 receivables 181 笔<b>全部为销售应收（type='ar'）</b>，故其他应收为空属正常——
      不是接口异常，是尚未发生押金 / 借支 / 代垫等其他应收业务。
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
  { key: 'type', label: '类型' },
  { key: 'contact_id', label: '往来单位' },
  { key: 'amount', label: '金额', fmt: 'money' },
  { key: 'paid_amount', label: '已收', fmt: 'money' },
  { key: 'status', label: '状态' },
  { key: 'due_date', label: '到期日', fmt: 'date' },
  { key: 'created_at', label: '发生时间', fmt: 'date' },
]

const rows = computed(() => Array.isArray(raw.value.rows) ? raw.value.rows : [])
const total = computed(() => raw.value.total || {})
const kpis = computed(() => [
  { label: '笔数', value: fmtInt(total.value.count) },
  { label: '应收总额', value: fmtMoney(total.value.amount) },
  { label: '已收金额', value: fmtMoney(total.value.paid) },
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
    const d = await reportsApi.otherReceivable()
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
