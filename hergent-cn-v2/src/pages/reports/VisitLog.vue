<template>
  <ReportTable
    title="拜访记录"
    subtitle="业务员拜访（visit_logs）的签到 / 签退明细"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    emptyHint="暂无拜访记录。"
    @reload="load"
  >
    <template #footnote>
      数据源 <code>GET /api/reports/visit-log</code>。时长单位分钟。
      🔴 本表有真实拜访数据；若某日无拜访，属正常业务节奏，并非接口异常。
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
  { key: 'contact_id', label: '客户' },
  { key: 'note', label: '拜访记录' },
  { key: 'operator_id', label: '拜访人' },
  { key: 'check_in_time', label: '签到', fmt: 'date' },
  { key: 'check_out_time', label: '签退', fmt: 'date' },
  { key: 'duration_min', label: '时长(分)', fmt: 'num' },
  { key: 'created_at', label: '提交时间', fmt: 'date' },
]

const rows = computed(() => Array.isArray(raw.value.rows) ? raw.value.rows : [])
const total = computed(() => raw.value.total || {})
const kpis = computed(() => [
  { label: '拜访次数', value: fmtInt(total.value.count) },
])

function fmtInt(v) { return Number(v || 0).toLocaleString('zh-CN') }

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.visitLog()
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
