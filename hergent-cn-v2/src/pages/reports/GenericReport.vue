<template>
  <div class="gen-report">
    <!-- 加载中 -->
    <div v-if="loadingDef" class="rp-state">报表配置加载中…</div>

    <!-- 拉取配置失败 -->
    <div v-else-if="defErr" class="rp-state rp-err">
      <Icon name="alert-triangle" :size="18" />
      <span>{{ defErr }}</span>
    </div>

    <!-- 未启用（kind=unavailable）：有这张报表，但本产品未提供依赖的模块 -->
    <div v-else-if="def && def.kind === 'unavailable'" class="rp-state rp-unavail">
      <Icon name="lock" :size="18" />
      <div>
        <div class="rp-title">{{ def.title || name }}</div>
        <div class="rp-reason">{{ def.reason || '本产品尚未提供该报表所需的业务模块' }}</div>
      </div>
    </div>

    <!-- 未配置口径：报表存在，但没有 SQL / 列定义 -->
    <div v-else-if="def && isUnconfigured" class="rp-state rp-unconf">
      <Icon name="file-question" :size="18" />
      <div>
        <div class="rp-title">{{ def.title || name }}</div>
        <div class="rp-reason">这张报表还没有配数据口径（诚实的未配置态，不是「没数据」）。</div>
        <div v-if="def.note" class="rp-note">{{ def.note }}</div>
      </div>
    </div>

    <!-- 正常报表 -->
    <div v-else-if="def" class="rp-body">
      <div class="rp-head">
        <div class="rp-titles">
          <h2>{{ def.title || name }}</h2>
          <span v-if="def.note" class="rp-defnote">{{ def.note }}</span>
        </div>
        <button class="btn btn-primary btn-sm" :disabled="loadingData" @click="run">
          <Icon name="search" :size="14" /> 查询
        </button>
      </div>

      <!-- 筛选条件 -->
      <div v-if="def.filters && def.filters.length" class="rp-filters card">
        <div v-for="f in def.filters" :key="f.key" class="rp-filter">
          <label>{{ f.label || f.key }}</label>
          <input
            v-if="f.fieldtype === 'Date'"
            type="date" class="ipt" v-model="filters[f.key]" :placeholder="f.default || ''"
          />
          <input
            v-else class="ipt" v-model="filters[f.key]" :placeholder="f.default || ''"
          />
        </div>
      </div>

      <!-- 查询中 -->
      <div v-if="loadingData" class="rp-state">报表数据加载中…</div>

      <!-- 数据错误 -->
      <div v-else-if="dataErr" class="rp-state rp-err">
        <Icon name="alert-triangle" :size="18" /><span>{{ dataErr }}</span>
      </div>

      <!-- 结果 -->
      <template v-else-if="data">
        <!-- 截断提示（诚实） -->
        <div v-if="data.truncated" class="rp-warn">
          ⚠️ 结果超过 {{ data.max_rows }} 行，已截断显示前 {{ data.returned }} 行；
          合计仍为完整结果集（不受截断影响）。
        </div>

        <!-- 图表（锦上添花，失败不阻塞） -->
        <div v-if="data.chart && !data.chart.error" class="rp-chart card">
          <component
            :is="chartComponent"
            :title="data.chart.title || def.title"
            :sub="(data.chart.note || '') + (data.chart.unit_hint ? ' · ' + data.chart.unit_hint : '')"
            :items="chartItems"
            :fmt="data.chart.fmt || 'qty'"
            :total="chartTotal"
            :name-w="140"
            :loading="false"
            :empty="!chartItems.length"
            empty-text="该维度还没有可画的数据"
          />
        </div>
        <div v-else-if="data.chart && data.chart.error" class="rp-warn">
          图表未生成：{{ data.chart.error }}
        </div>

        <!-- 数据表 -->
        <div class="rp-table-wrap card">
          <table class="rp-table">
            <thead>
              <tr>
                <th v-for="col in tableColumns" :key="col.key"
                    :class="alignClass(col.fieldtype)" :style="col.width ? { width: col.width + 'px' } : null">
                  {{ col.label || col.key }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in data.rows" :key="i">
                <td v-for="col in tableColumns" :key="col.key"
                    :class="alignClass(col.fieldtype)">
                  {{ fmtVal(row[col.key], col.fieldtype) }}
                </td>
              </tr>
              <tr v-if="!data.rows.length">
                <td :colspan="tableColumns.length" class="rp-empty">该筛选条件下暂无数据。</td>
              </tr>
            </tbody>
            <tfoot v-if="hasTotals">
              <tr>
                <td v-for="col in tableColumns" :key="col.key"
                    :class="alignClass(col.fieldtype)">
                  <template v-if="col.key === firstColKey">合计</template>
                  <template v-else-if="col.key in data.totals">{{ fmtVal(data.totals[col.key], col.fieldtype) }}</template>
                  <template v-else>—</template>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div class="rp-foot">
          共 {{ data.row_count }} 行（本页 {{ data.returned }} 行）；
          耗时 {{ data.elapsed_ms }} 毫秒。
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { reportEngineApi } from '../../api/modules'
import Icon from '../../components/Icon.vue'
import ChartHbar from '../../components/chart/ChartHbar.vue'
import ChartDonut from '../../components/chart/ChartDonut.vue'

const route = useRoute()
const name = computed(() => route.meta && route.meta.reportName ? route.meta.reportName : (route.params.name || ''))

const def = ref(null)
const defErr = ref('')
const loadingDef = ref(false)
const data = ref(null)
const dataErr = ref('')
const loadingData = ref(false)
const filters = reactive({})

const isUnconfigured = computed(() =>
  !def.value || !Array.isArray(def.value.columns) || def.value.columns.length === 0)

const tableColumns = computed(() => {
  const cols = (data.value && data.value.columns) || (def.value && def.value.columns) || []
  return cols
})
const firstColKey = computed(() => (tableColumns.value[0] ? tableColumns.value[0].key : ''))

const hasTotals = computed(() =>
  data.value && data.value.totals && Object.keys(data.value.totals).length > 0)

const chartComponent = computed(() => {
  const t = data.value && data.value.chart && data.value.chart.type
  if (t === 'donut') return ChartDonut
  return ChartHbar // bar/hbar/line 统一降级为横向排行条（ranked），info 不丢
})
const chartItems = computed(() => {
  const c = data.value && data.value.chart
  if (!c || !c.labels || !c.datasets || !c.datasets.length) return []
  const ds = c.datasets[0]
  return c.labels.map((l, i) => ({ name: String(l), value: ds.data ? ds.data[i] : 0 }))
})
const chartTotal = computed(() => chartItems.value.reduce((s, it) => s + (Number(it.value) || 0), 0))

function alignClass(ft) {
  if (ft === 'Currency' || ft === 'Float' || ft === 'Int' || ft === 'Percent' || ft === 'Duration') {
    return 'num'
  }
  return ''
}

function fmtVal(v, ft) {
  if (v === null || v === undefined || v === '') return '—'
  if (ft === 'Currency') {
    const n = Number(v)
    if (isNaN(n)) return v
    return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (ft === 'Percent') {
    const n = Number(v)
    if (isNaN(n)) return v
    return n.toFixed(2) + '%'
  }
  if (ft === 'Int') {
    const n = Number(v)
    if (isNaN(n)) return v
    return Math.round(n).toLocaleString('zh-CN')
  }
  if (ft === 'Float') {
    const n = Number(v)
    if (isNaN(n)) return v
    return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return v
}

async function loadDef() {
  loadingDef.value = true
  defErr.value = ''
  def.value = null
  data.value = null
  // 清空筛选
  for (const k of Object.keys(filters)) delete filters[k]
  try {
    const d = await reportEngineApi.getDef(name.value)
    def.value = d
    // 初始化筛选默认值
    for (const f of (d.filters || [])) {
      filters[f.key] = f.default !== undefined && f.default !== null ? f.default : ''
    }
    if (d.kind !== 'unavailable' && !isUnconfigured.value) {
      await run()
    }
  } catch (e) {
    defErr.value = (e && e.message) ? e.message : '报表配置加载失败'
  } finally {
    loadingDef.value = false
  }
}

async function run() {
  if (!name.value) return
  loadingData.value = true
  dataErr.value = ''
  try {
    const res = await reportEngineApi.getData(name.value, { ...filters })
    data.value = res
  } catch (e) {
    dataErr.value = (e && e.message) ? e.message : '报表数据加载失败'
  } finally {
    loadingData.value = false
  }
}

onMounted(loadDef)
watch(() => name.value, loadDef)
</script>

<style scoped>
.gen-report { padding: 16px; max-width: 1200px; margin: 0 auto; }
.rp-state { padding: 28px; text-align: center; color: #6b7280; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.rp-state.rp-err { color: #dc2626; }
.rp-unavail, .rp-unconf { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; padding: 20px; flex-direction: row; text-align: left; }
.rp-title { font-weight: 600; color: #1f2937; margin-bottom: 4px; }
.rp-reason { color: #92400e; font-size: 13px; }
.rp-note { color: #9ca3af; font-size: 12px; margin-top: 4px; }
.rp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; gap: 12px; }
.rp-titles { display: flex; flex-direction: column; }
.rp-titles h2 { margin: 0; font-size: 18px; }
.rp-defnote { color: #9ca3af; font-size: 12px; margin-top: 2px; }
.rp-filters { display: flex; flex-wrap: wrap; gap: 12px; padding: 14px; margin-bottom: 12px; }
.rp-filter { display: flex; flex-direction: column; gap: 4px; }
.rp-filter label { font-size: 12px; color: #6b7280; }
.ipt { height: 32px; border: 1px solid #d1d5db; border-radius: 6px; padding: 0 8px; font-size: 13px; min-width: 160px; }
.rp-warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 8px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
.rp-chart { padding: 14px; margin-bottom: 12px; }
.rp-table-wrap { padding: 0; overflow-x: auto; margin-bottom: 10px; }
.rp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.rp-table th, .rp-table td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; white-space: nowrap; }
.rp-table th { background: #fafafa; color: #374151; font-weight: 600; text-align: left; }
.rp-table th.num, .rp-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.rp-table tfoot td { font-weight: 600; background: #f9fafb; border-top: 2px solid #e5e7eb; }
.rp-empty { text-align: center; color: #9ca3af; padding: 24px; }
.rp-foot { color: #9ca3af; font-size: 12px; }
.btn { display: inline-flex; align-items: center; gap: 4px; border: 1px solid #d1d5db; background: #fff; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
.btn-primary { background: #2563eb; color: #fff; border-color: #2563eb; }
.btn-sm { padding: 5px 10px; font-size: 12px; }
.btn:disabled { opacity: 0.6; cursor: default; }
</style>
