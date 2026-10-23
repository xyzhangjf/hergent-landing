<template>
  <ReportTable
    title="费用单汇总表"
    subtitle="费用单（expense_orders）的明细与合计"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    emptyHint="暂无费用单数据。"
    filterable
    @reload="load"
    @filter="onFilter"
  >
    <template #chart>
      <!-- v648：费用结构。按「类型」分组求和（类型为空才回落费用类别）。
           🔴 账套里没有费用单时是**空态**，不是接口故障 —— 不编造任何分类。 -->
      <ChartDonut
        title="费用结构"
        :sub="feeSub"
        :items="feeItems"
        :loading="loading"
        :empty="!feeItems.length"
        empty-text="当前账套还没有费用单，暂无结构可分析"
        fmt="money"
        center-label="费用总额"
        export-name="费用结构"
        note="按费用单类型分组求和；只统计当前查询范围内的单据，金额单位元。"
      />
    </template>

    <template #footnote>
      数据源 <code>GET /api/reports/fee-summary</code>。金额单位元。
      🔴 若显示「暂无数据」，说明当前账套尚未录入费用单——是真实业务状态，并非接口异常。
    </template>
  </ReportTable>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'
import ReportTable from '../../components/ReportTable.vue'
import ChartDonut from '../../components/chart/ChartDonut.vue'

const loading = ref(true)
const err = ref('')
const raw = ref({ rows: [], total: {} })

/* v651：日期筛选（后端 fee-summary 已支持 date_from/date_to，按 order_date）。拼 query 给后端算，前端不本地过滤。 */
const filter = ref({ date_from: '', date_to: '' })
function qs() {
  const p = []
  if (filter.value.date_from) p.push('date_from=' + encodeURIComponent(filter.value.date_from))
  if (filter.value.date_to) p.push('date_to=' + encodeURIComponent(filter.value.date_to))
  return p.length ? '?' + p.join('&') : ''
}
function onFilter(r) { filter.value = { ...r }; load() }

const columns = [
  { key: 'order_no', label: '单号' },
  { key: 'type', label: '类型' },
  { key: 'category_id', label: '费用类别' },
  { key: 'amount', label: '金额', fmt: 'money' },
  { key: 'paid_amount', label: '已付', fmt: 'money' },
  { key: 'status', label: '状态' },
  { key: 'order_date', label: '日期', fmt: 'date' },
]

const rows = computed(() => Array.isArray(raw.value.rows) ? raw.value.rows : [])
const total = computed(() => raw.value.total || {})
/* v648：费用结构。**只做分组求和**（同一列加总，不改变口径），不重算总额。
   类型字段为空时回落到「费用类别 N」，避免出现一整块叫「空」的扇区。 */
const feeItems = computed(() => {
  const m = new Map()
  for (const r of rows.value) {
    const key = String(r.type || '').trim() || ('费用类别 ' + (r.category_id ?? '—'))
    m.set(key, (m.get(key) || 0) + Number(r.amount || 0))
  }
  return [...m.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
})
const feeSub = computed(() => feeItems.value.length
  ? `共 ${feeItems.value.length} 类 · 合计 ${fmtMoney(total.value.amount)}`
  : '暂无分类数据')

const kpis = computed(() => [
  { label: '单据数', value: fmtInt(total.value.count) },
  { label: '费用总额', value: fmtMoney(total.value.amount) },
  { label: '已付金额', value: fmtMoney(total.value.paid) },
])

function fmtMoney(v) {
  const n = Number(v || 0)
  if (Math.abs(n) >= 10000) return '¥' + (n / 10000).toFixed(1) + ' 万'
  return '¥' + n.toFixed(2)
}
function fmtInt(v) { return Number(v || 0).toLocaleString('zh-CN') }

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.feeSummary(qs())
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
