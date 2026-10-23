<template>
  <ReportTable
    title="销售订单汇总表"
    subtitle="全部未取消销售订单的总体与收付款概览"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    empty-hint="本页是纯汇总视图：只有总体指标，没有明细表。"
    filterable
    @reload="load"
    @filter="onFilter"
  >
    <template #filters>
      <!-- v650：业务员维度。🔴 后端 /api/reports/sales 与 /api/reports/sales-trend **真实支持**
           salesperson（过滤 sale_orders.operator_id），所以这个控件不是"假筛选"——
           选了人，KPI 与月度趋势会一起变（同口径），实测全量 22505 单 → 程欢欢 3184 单。
           字典 = 订单里真实出现过的报单人（useSalespersons），不用员工档案（会漏人）。 -->
      <div class="card rpt-filter sos-filter">
        <label class="sos-fl">
          <span>业务员</span>
          <select v-model="selSalesperson" @change="onFilter(filter)">
            <option value="">全部业务员</option>
            <option v-for="s in salespersons" :key="s.id" :value="s.id">
              {{ s.name }}<template v-if="s.orders">（{{ s.orders }} 单）</template>
            </option>
          </select>
        </label>
        <span class="sos-hint">按报单人筛选：上方总体指标与月度趋势同为一人口径。</span>
      </div>
    </template>

    <template #chart>
      <!-- v648：本页纯汇总（无明细表），图就是主体内容。两张图都**不重算**数字：
           趋势由后端 /api/reports/sales-trend 按月聚合；回款结构只做「已收 / 未收」拆分，
           未收 = 总额 − 已收（与 KPI 同一份后端数字）。 -->
      <div class="sos-charts">
        <ChartLine
          title="月度销售趋势"
          :sub="trendSub"
          :labels="trendLabels"
          :series="trendSeries"
          :loading="trendLoading"
          :error="trendErr"
          :height="250"
          fmt="money"
          :empty="!trendLabels.length"
          empty-text="这段时间还没有销售订单"
          export-name="月度销售趋势"
          note="按订单日期所属月份统计未取消订单，与上方「销售总额」同源；金额单位：元。"
          @retry="loadTrend"
        />
        <ChartDonut
          title="回款结构"
          sub="已收与未收各占多少"
          :items="payItems"
          :loading="loading"
          :empty="!(Number(data.total_amount) > 0)"
          empty-text="这段时间还没有销售额，暂无回款结构"
          fmt="money"
          center-label="销售总额"
          export-name="销售回款结构"
          note="未收 = 销售总额 − 已收金额；未收为 0 表示已收清。"
        />
      </div>
    </template>

    <template #extra>
      <!-- 原「口径说明」卡：三条文一字未动，只换容器（骨架主表位没有可放说明的区域）。 -->
      <div class="card sos-card">
        <div class="sec-hd"><span>口径说明</span></div>
        <ul class="sos-note">
          <li>仅统计「未取消」状态的销售订单；金额单位：元。</li>
          <li>数据由后端 <code>/api/reports/sales</code> 算好，前端只读展示、不重算，与首页经营趋势同源。</li>
          <li>未收金额 = 销售总额 − 已收金额；若该值为正，代表仍有在途未回款。</li>
        </ul>
      </div>
    </template>
  </ReportTable>
</template>

<script setup>
/* 销售订单汇总表（数据报表）—— 数据源：GET /api/reports/sales（= db.report_sales_summary）。
   🔴 口径**不在前端重算**：订单数 / 总额 / 已收 / 折扣全部由后端给，前端只做展示格式化。
   🔴 本页**只读**、无「新建 / 编辑」入口：汇总是对订单的**结果**统计，改数据要去对应单据。
   v646：外壳收编进 ReportTable（KPI / 口径说明卡）。本页原本就没有明细表 ⇒ rows 恒为空，
      emptyHint 明说「纯汇总视图」，不假装有表、也不编造行。
   ✅ 开 `filterable`：/api/reports/sales 是**已支持** date_from/date_to 的端点（经营报表清单内），
      参数拼在 query 上交给后端算，前端绝不本地过滤。 */
import ReportTable from '../../components/ReportTable.vue'
import ChartLine from '../../components/chart/ChartLine.vue'
import ChartDonut from '../../components/chart/ChartDonut.vue'
import { ref, computed, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'
import { useSalespersons } from '../../composables/useSalespersons'

const loading = ref(true)
const err = ref('')
const data = ref({ count: 0, total_amount: 0, total_received: 0, total_discount: 0 })

/* 纯汇总页：无明细列、无明细行，保留空数组即可（骨架据此走空态 + 不启用导出）。 */
const columns = []
const rows = []

const unpaid = computed(() => Number(data.value.total_amount || 0) - Number(data.value.total_received || 0))

const kpis = computed(() => [
  { label: '订单数', value: String(data.value.count), sub: '未取消订单' },
  { label: '销售总额', value: fmtMoney(data.value.total_amount), sub: '订单成交金额合计' },
  { label: '已收金额', value: fmtMoney(data.value.total_received), sub: '客户已付回款' },
  { label: '未收金额', value: fmtMoney(unpaid.value), sub: unpaid.value > 0 ? '总额 − 已收（仍有在途）' : '总额 − 已收（已收清）' },
])

function fmtMoney (n) {
  const v = Number(n || 0)
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/* v646：日期筛选（照 SalesDetail.vue 写法）—— 拼 query 给后端算，前端不本地过滤。
   v650：加 salesperson（业务员），后端 /reports/sales 与 /reports/sales-trend 均已支持。 */
const filter = ref({ date_from: '', date_to: '' })
const selSalesperson = ref('')
const { salespersons, loadSalespersons } = useSalespersons()

function qs() {
  const p = []
  if (filter.value.date_from) p.push('date_from=' + encodeURIComponent(filter.value.date_from))
  if (filter.value.date_to) p.push('date_to=' + encodeURIComponent(filter.value.date_to))
  if (selSalesperson.value) p.push('salesperson=' + encodeURIComponent(selSalesperson.value))
  return p.length ? '?' + p.join('&') : ''
}
function onFilter(r) { filter.value = { ...r }; load() }

/* v648：月度销售趋势。🔴 **后端算、前端只画** —— 与 /reports/sales 同源（sale_orders +
   status!='cancelled'），按月聚合。筛选区间变了必须跟着重拉，否则图与 KPI 不是同一段数。 */
const TREND_MONTHS = 12
const trend = ref({ labels: [], amount: [], count: [] })
const trendLoading = ref(false)
const trendErr = ref('')

const trendLabels = computed(() => trend.value.labels || [])
const trendSeries = computed(() => [
  { name: '销售额', data: (trend.value.amount || []).map(Number), area: true },
])
const trendSub = computed(() => {
  const n = trendLabels.value.length
  if (!n) return '暂无月度数据'
  return `${trendLabels.value[0]} ~ ${trendLabels.value[n - 1]} · 共 ${n} 个月有订单`
})

/* 回款结构：只把后端给的「总额 / 已收」拆成两块，未收 = 总额 − 已收（与 KPI 同一个数）。 */
const payItems = computed(() => {
  const received = Number(data.value.total_received || 0)
  const rest = Math.max(0, Number(data.value.total_amount || 0) - received)
  return [
    { label: '已收金额', value: received },
    { label: '未收金额', value: rest },
  ]
})

async function loadTrend () {
  trendLoading.value = true
  trendErr.value = ''
  try {
    const d = await reportsApi.salesTrend({
      months: TREND_MONTHS,
      date_from: filter.value.date_from,
      date_to: filter.value.date_to,
      salesperson: selSalesperson.value,
    })
    trend.value = {
      labels: Array.isArray(d.labels) ? d.labels : [],
      amount: Array.isArray(d.amount) ? d.amount : [],
      count: Array.isArray(d.count) ? d.count : [],
    }
  } catch (e) {
    trendErr.value = (e && e.message) || '销售趋势读取失败'
    trend.value = { labels: [], amount: [], count: [] }
  } finally {
    trendLoading.value = false
  }
}

async function load () {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.salesSummary(qs())
    data.value = {
      count: Number(d.count || 0),
      total_amount: Number(d.total_amount || 0),
      total_received: Number(d.total_received || 0),
      total_discount: Number(d.total_discount || 0)
    }
  } catch (e) {
    err.value = (e && e.message) || '销售订单汇总读取失败'
  } finally {
    loading.value = false
    loadTrend()
  }
}

onMounted(() => { load(); loadSalespersons() })
defineExpose({ load })
</script>

<style scoped>
/* 仅保留仍被引用的私有类（口径说明卡挂在 #extra 插槽，插槽内容在本页作用域编译）。 */
.sos-charts { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 14px; margin-top: 14px }
@media (max-width: 1100px) { .sos-charts { grid-template-columns: minmax(0, 1fr) } }
.sos-card { margin-top: 14px }
.sos-note { margin: 0; padding-left: 18px; font-size: 12px; color: var(--t2); line-height: 1.8 }
.sos-note code { background: var(--bg2); padding: 1px 5px; border-radius: 4px; font-size: 11px }
/* v650：业务员筛选条（与 CustomerRank 同一版式语言）。 */
.sos-filter { display: flex; align-items: center; gap: 10px; flex-wrap: wrap }
.sos-fl { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--t2) }
.sos-fl select {
  min-width: 170px; padding: 5px 8px; font-size: 12px; color: var(--t1);
  background: var(--bg); border: 1px solid var(--bd); border-radius: 6px;
}
.sos-hint { font-size: 11px; color: var(--t3); line-height: 1.6 }
</style>
