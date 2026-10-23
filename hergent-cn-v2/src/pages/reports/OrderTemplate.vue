<template>
  <ReportTable
    title="订货模板"
    subtitle="为客户预设的常订商品组合，便于快速报单"
    :columns="columns"
    :rows="rows"
    :loading="loading"
    :err="err"
    empty-hint="暂无订货模板。当您在系统中为客户建立常订商品组合后，这里会按模板名、客户展示列表。"
    @reload="load"
  >
    <template #footnote>
      <p>数据来源：后端 <code>order_templates</code> 表（订货模板）。当前 0 条，属真实业务状态。</p>
      <p>🔴 该模块属于市场营销 / 访销运营能力，将与进销存报单流程打通，待录入数据后自动出数。</p>
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
  { key: 'name', label: '模板名称' },
  { key: 'customer_name', label: '适用客户' },
  { key: 'user_id', label: '创建人ID' },
]

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.mktOrderTemplates()
    rows.value = (d && Array.isArray(d.rows)) ? d.rows : []
  } catch (e) {
    err.value = '加载失败，请重试。'
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>
