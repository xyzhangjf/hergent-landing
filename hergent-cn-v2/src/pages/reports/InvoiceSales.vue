<template>
  <ReportTable
    title="销项发票台账"
    subtitle="已开具给客户的发票（数电票）"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    empty-hint="暂无销项发票。当您在系统中开具或导入销售发票后，这里会按发票号、购方、金额、税额、状态展示台账。"
    @reload="load"
  >
    <template #footnote>
      <p>数据来源：后端 <code>einvoices</code> 表（数电票台账）。金额单位「元」，表格中 ≥1 万自动缩写为「万」。</p>
      <p>🔴 状态含 <code>scanned</code>（已扫描待开）/ <code>issued</code>（已开具）/ <code>red-flushed</code>（已红冲）；<code>red_flush_of</code> 有值表示这张是某张蓝票的红冲票。</p>
      <p>⚠️ 本页为只读台账，不发起开票。实际向税务局开具数电票需对接发票云（航信/百望/第三方），属后续集成，当前阶段先沉淀发票记录。</p>
    </template>
  </ReportTable>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import ReportTable from '../../components/ReportTable.vue'
import { reportsApi } from '../../api/modules.js'

const loading = ref(false)
const err = ref('')
const rows = ref([])
const kpis = ref([])
const columns = [
  { key: 'invoice_no', label: '发票号码' },
  { key: 'invoice_type', label: '票种' },
  { key: 'customer_name', label: '购方名称' },
  { key: 'invoice_date', label: '开票日期', fmt: 'date' },
  { key: 'total_amount', label: '金额(不含税)', fmt: 'money' },
  { key: 'tax_amount', label: '税额', fmt: 'money' },
  { key: 'amount_with_tax', label: '价税合计', fmt: 'money' },
  { key: 'status', label: '状态' },
  { key: 'red_flush_of', label: '红冲来源' },
]

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.invoiceSales()
    const data = d && d.rows ? d : { rows: [], summary: {} }
    rows.value = Array.isArray(data.rows) ? data.rows : []
    const s = data.summary || {}
    kpis.value = [
      { label: '发票张数', value: (s.count || 0) + ' 张' },
      { label: '价税合计', value: fmtMoney(s.total_with_tax || 0) },
      { label: '税额合计', value: fmtMoney(s.total_tax || 0) },
    ]
  } catch (e) {
    err.value = '发票数据加载失败，请重试。'
  } finally {
    loading.value = false
  }
}

function fmtMoney(n) {
  const v = Number(n || 0)
  return Math.abs(v) >= 10000 ? '¥' + (v / 10000).toFixed(1) + ' 万' : '¥' + v.toFixed(2)
}

onMounted(load)
</script>
