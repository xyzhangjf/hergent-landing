<template>
  <ReportTable
    title="账户收支明细"
    subtitle="资金流水（fund_flow）的逐笔收支记录"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    emptyHint="暂无账户收支数据。"
    @reload="load"
  >
    <template #footnote>
      数据源 <code>GET /api/reports/account-flow</code>。金额单位元；余额 = 该笔后的账户余额。
      🔴 若显示「暂无数据」，说明当前账套尚未产生资金流水——是真实业务状态，并非接口异常。
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
  { key: 'doc_type', label: '单据类型' },
  { key: 'doc_no', label: '单据号' },
  { key: 'bill_date', label: '日期', fmt: 'date' },
  { key: 'party_name', label: '对方' },
  { key: 'account', label: '账户' },
  { key: 'amount', label: '金额', fmt: 'money' },
  { key: 'balance_after', label: '余额', fmt: 'money' },
  { key: 'remark', label: '备注' },
]

const rows = computed(() => Array.isArray(raw.value.rows) ? raw.value.rows : [])
const total = computed(() => raw.value.total || {})
const kpis = computed(() => [
  { label: '流水笔数', value: fmtInt(total.value.count) },
  { label: '发生额', value: fmtMoney(total.value.amount) },
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
    const d = await reportsApi.accountFlow()
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
