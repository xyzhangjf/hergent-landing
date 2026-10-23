<template>
  <ReportTable
    title="付款明细表"
    subtitle="付款计划与执行（period_payments）的逐笔明细"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    emptyHint="暂无付款明细数据。"
    @reload="load"
  >
    <template #footnote>
      数据源 <code>GET /api/reports/payment-detail</code>。金额单位元；余额 = 应付 − 已付，差额 = 计划与实际偏差。
      🔴 若显示「暂无数据」，说明当前账套尚未生成付款计划——是真实业务状态，并非接口异常。
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
  { key: 'period_start', label: '周期起', fmt: 'date' },
  { key: 'period_end', label: '周期止', fmt: 'date' },
  { key: 'supplier_name', label: '供应商' },
  { key: 'order_amount', label: '应付', fmt: 'money' },
  { key: 'paid_amount', label: '已付', fmt: 'money' },
  { key: 'balance', label: '余额', fmt: 'money' },
  { key: 'gap_amount', label: '差额', fmt: 'money' },
  { key: 'status', label: '状态' },
  { key: 'paid_at', label: '付款时间', fmt: 'date' },
]

const rows = computed(() => Array.isArray(raw.value.rows) ? raw.value.rows : [])
const total = computed(() => raw.value.total || {})
const kpis = computed(() => [
  { label: '付款笔数', value: fmtInt(total.value.count) },
  { label: '已付总额', value: fmtMoney(total.value.paid) },
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
    const d = await reportsApi.paymentDetail()
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
