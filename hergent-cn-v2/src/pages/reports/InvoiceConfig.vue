<template>
  <ReportTable
    title="开票配置"
    subtitle="数电票开票参数（税号、开票平台账号、默认抬头等）"
    :columns="columns"
    :rows="rows"
    :loading="loading"
    :err="err"
    empty-hint="暂无开票配置。当您接入开票平台（发票云）并在系统中登记税号、开票账号等参数后，这里会列出当前配置项。"
    @reload="load"
  >
    <template #footnote>
      <p>数据来源：后端 <code>einvoice_config</code> 表（开票配置项）。</p>
      <p>🔴 每一项以 <code>config_key</code> 标识（如 <code>tax_no</code> 税号 / <code>platform</code> 开票平台），<code>config_json</code> 为参数详情，<code>is_active</code> 表示是否启用。</p>
      <p>⚠️ 本页为只读展示，暂不支持在线修改。配置开票平台属后续集成工作。</p>
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
  { key: 'config_key', label: '配置项' },
  { key: 'config_json', label: '参数内容' },
  { key: 'is_active', label: '是否启用' },
  { key: 'created_at', label: '创建时间', fmt: 'date' },
]

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.invoiceConfig()
    const data = d && d.rows ? d : { rows: [] }
    rows.value = Array.isArray(data.rows) ? data.rows : []
  } catch (e) {
    err.value = '配置加载失败，请重试。'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>
