<template>
  <ReportTable
    title="考勤统计"
    subtitle="员工考勤（attendance）的打卡记录"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    emptyHint="暂无考勤数据。"
    @reload="load"
  >
    <template #footnote>
      数据源 <code>GET /api/reports/attendance</code>。
      🔴 若显示「暂无数据」，说明当前账套尚未录入考勤打卡——是真实业务状态，并非接口异常。
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
  { key: 'employee_name', label: '员工' },
  { key: 'date', label: '日期', fmt: 'date' },
  { key: 'clock_in', label: '上班', fmt: 'date' },
  { key: 'clock_out', label: '下班', fmt: 'date' },
  { key: 'status', label: '状态' },
  { key: 'note', label: '备注' },
]

const rows = computed(() => Array.isArray(raw.value.rows) ? raw.value.rows : [])
const total = computed(() => raw.value.total || {})
const kpis = computed(() => [
  { label: '考勤记录数', value: fmtInt(total.value.count) },
])

function fmtInt(v) { return Number(v || 0).toLocaleString('zh-CN') }

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.attendanceReport()
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
