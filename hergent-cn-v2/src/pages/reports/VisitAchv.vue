<template>
  <ReportTable
    title="拜访达成"
    subtitle="拜访计划（visit_plans）与实际拜访的对照"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    emptyHint="暂无拜访计划。"
    @reload="load"
  >
    <template #footnote>
      数据源 <code>GET /api/reports/visit-achv</code>。达成率 = 实际拜访数 ÷ 计划客户数；
      计划客户数见 visit_plan_items。🔴 若显示「暂无数据」，说明尚未制定拜访计划——是真实业务状态，并非接口异常。
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
  { key: 'plan_date', label: '计划日期', fmt: 'date' },
  { key: 'salesperson', label: '业务员' },
  { key: 'created_at', label: '制定时间', fmt: 'date' },
]

const rows = computed(() => Array.isArray(raw.value.rows) ? raw.value.rows : [])
const total = computed(() => raw.value.total || {})
const kpis = computed(() => [
  { label: '计划数', value: fmtInt(total.value.count) },
])

function fmtInt(v) { return Number(v || 0).toLocaleString('zh-CN') }

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.visitAchv()
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
