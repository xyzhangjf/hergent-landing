<template>
  <ReportTable
    title="进项发票台账"
    subtitle="供应商开给本公司的发票（用于采购成本核算与抵扣）"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    empty-hint="暂无进项发票。当您录入或导入供应商发票后，这里会按发票号、供应商、金额、税额、勾兑状态展示台账。"
    @reload="load"
  >
    <template #footnote>
      <p>数据来源：后端 <code>ap_invoices</code> 表（进项发票）。金额单位「元」，表格中 ≥1 万自动缩写为「万」。</p>
      <p>🔴 <code>match_status</code> 表示这张进项票与采购单的勾兑状态（如 <code>unmatched</code> 未勾兑 / <code>matched</code> 已勾兑），用于核算进项税抵扣。</p>
      <p>⚠️ 本页为只读台账，不发起勾兑。实际勾兑与抵扣计算属后续集成。</p>
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
  { key: 'supplier_name', label: '供应商' },
  { key: 'invoice_date', label: '开票日期', fmt: 'date' },
  { key: 'total_amount', label: '价税合计', fmt: 'money' },
  { key: 'tax_amount', label: '税额', fmt: 'money' },
  { key: 'match_status', label: '勾兑状态' },
]

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.invoicePurchase()
    const data = d && d.rows ? d : { rows: [], summary: {} }
    rows.value = Array.isArray(data.rows) ? data.rows : []
    const s = data.summary || {}
    kpis.value = [
      { label: '发票张数', value: (s.count || 0) + ' 张' },
      { label: '价税合计', value: fmtMoney(s.total_amount || 0) },
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
