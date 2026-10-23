<template>
  <ReportTable
    title="线上收款流水"
    subtitle="收款流水中线上渠道（payment_receipts，method 含 online/微信/支付宝）的明细"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    emptyHint="暂无线上收款数据。"
    @reload="load"
  >
    <template #footnote>
      数据源 <code>GET /api/reports/online-receipt</code>。金额单位元；仅取收款方式中识别为线上渠道的记录。
      🔴 若显示「暂无数据」，说明当前账套尚未登记线上渠道收款——是真实业务状态，并非接口异常。
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
  { key: 'contact_name', label: '客户' },
  { key: 'amount', label: '金额', fmt: 'money' },
  { key: 'method', label: '渠道' },
  { key: 'paid_at', label: '收款时间', fmt: 'date' },
  { key: 'created_at', label: '登记时间', fmt: 'date' },
]

const rows = computed(() => Array.isArray(raw.value.rows) ? raw.value.rows : [])
const total = computed(() => raw.value.total || {})
const kpis = computed(() => [
  { label: '线上收款笔数', value: fmtInt(total.value.count) },
  { label: '线上收款额', value: fmtMoney(total.value.amount) },
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
    const d = await reportsApi.onlineReceipt()
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
