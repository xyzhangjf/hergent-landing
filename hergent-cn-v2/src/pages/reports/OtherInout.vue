<template>
  <ReportTable
    title="其他出入库汇总表"
    subtitle="库存变动（inventory_logs）按变动类型的汇总"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    emptyHint="暂无库存变动数据。"
    @reload="load"
  >
    <template #footnote>
      数据源 <code>GET /api/reports/other-inout</code>。数量单位件、金额单位元。
      🔴 <b>opening</b>=期初建账（非业务出入库）；<b>adjust / other / loss / gain</b> 等=盘点调整、
      报损报溢、其他出入库等业务变动。本表把非采购 / 非销售的库存变动单列出来供核对。
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
  { key: 'change_type', label: '变动类型' },
  { key: 'cnt', label: '笔数', fmt: 'num' },
  { key: 'qty', label: '变动数量', fmt: 'num' },
  { key: 'amount', label: '金额', fmt: 'money' },
]

const rows = computed(() => Array.isArray(raw.value.rows) ? raw.value.rows : [])
const total = computed(() => raw.value.total || {})
const kpis = computed(() => [
  { label: '库存变动总笔数', value: fmtInt(total.value.count) },
  { label: '总变动数量', value: fmtNum(total.value.qty) },
])

function fmtMoney(v) {
  const n = Number(v || 0)
  if (Math.abs(n) >= 10000) return '¥' + (n / 10000).toFixed(1) + ' 万'
  return '¥' + n.toFixed(2)
}
function fmtInt(v) { return Number(v || 0).toLocaleString('zh-CN') }
function fmtNum(v) { return Number(v || 0).toLocaleString('zh-CN') }

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.otherInout()
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
