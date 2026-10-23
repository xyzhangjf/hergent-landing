<template>
  <ReportTable
    title="拜访计划"
    subtitle="销售 / 督导的周期性拜访排程"
    :columns="columns"
    :rows="rows"
    :loading="loading"
    :err="err"
    empty-hint="暂无拜访计划。当您在系统中录入销售拜访排程后，这里会按日期、拜访人展示列表。"
    @reload="load"
  >
    <template #footnote>
      <p>数据来源：后端 <code>visit_plans</code> 表（拜访计划）。当前 0 条，属真实业务状态。</p>
      <p>🔴 拜访记录（实际到店打卡）另见「数据报表 › 拜访记录」。本页为计划排程，二者配套使用。</p>
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
const columns = [
  { key: 'id', label: '编号' },
  { key: 'plan_date', label: '计划日期', fmt: 'date' },
  { key: 'salesperson', label: '拜访人' },
  { key: 'created_at', label: '创建时间', fmt: 'date' },
]

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.mktVisitPlans()
    rows.value = (d && Array.isArray(d.rows)) ? d.rows : []
  } catch (e) {
    err.value = '加载失败，请重试。'
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>
