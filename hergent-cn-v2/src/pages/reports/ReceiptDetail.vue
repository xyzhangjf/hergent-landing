<template>
  <ReportTable
    title="收款明细表"
    subtitle="收款流水（payment_receipts）的逐笔明细"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    emptyHint="暂无收款明细数据。"
    @reload="load"
  >
    <template #footnote>
      数据源 <code>GET /api/reports/receipt-detail</code>。金额单位元；已核销 = 已冲销应收，未核销 = 待冲销。
      🔴 若显示「暂无数据」，说明当前账套尚未登记收款——是真实业务状态，并非接口异常。
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
  { key: 'method', label: '收款方式' },
  { key: 'paid_at', label: '收款时间', fmt: 'date' },
  { key: 'allocated_amount', label: '已核销', fmt: 'money' },
  { key: 'unapplied_amount', label: '未核销', fmt: 'money' },
  { key: 'created_at', label: '登记时间', fmt: 'date' },
]

const rows = computed(() => Array.isArray(raw.value.rows) ? raw.value.rows : [])
const total = computed(() => raw.value.total || {})
const kpis = computed(() => [
  { label: '收款笔数', value: fmtInt(total.value.count) },
  { label: '收款总额', value: fmtMoney(total.value.amount) },
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
    const d = await reportsApi.receiptDetail()
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
