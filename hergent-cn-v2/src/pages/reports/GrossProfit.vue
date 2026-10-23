<template>
  <ReportTable
    title="毛利分析"
    subtitle="按品牌 / 品类 / 商品 三维度 · 只统计已送达、已签收的订单"
    :table-title="'毛利明细（按毛利从高到低 · ' + dimName + '）'"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    empty-hint="该维度暂无数据。"
    @reload="load"
  >
    <template #chart>
      <!-- v648：毛利结构（环形）+ 毛利额排行（横向条）。两张图都**只取后端给的 profit**，
           不重算、不换算 —— 与上方表格、首页三张毛利图同源。维度切换时图随之变（绑定 dim）。 -->
      <div class="gpa-charts">
        <ChartDonut
          :title="dimName + '毛利结构'"
          :sub="'共 ' + profitItems.length + ' 个' + dimName + ' · 其余合并为「其他」'"
          :items="profitItems"
          :loading="loading"
          :empty="!profitItems.length"
          empty-text="该维度还没有毛利数据"
          fmt="money"
          center-label="毛利合计"
          :export-name="'毛利结构-' + dimName"
          :note="'只统计已送达 / 已签收订单，与上方表格同一份后端数据；负毛利（亏本）的行画不进环形图，请看表格。'"
        />
        <ChartHbar
          :title="'毛利额前 10 名（' + dimName + '）'"
          sub="毛利从高到低"
          :items="profitTop"
          :loading="loading"
          :empty="!profitTop.length"
          empty-text="该维度还没有可排行的毛利数据"
          fmt="money"
          :total="total.profit"
          :name-w="132"
          :export-name="'毛利额排行-' + dimName"
          note="占比 = 该行毛利 ÷ 毛利合计；毛利率是比率，不做合计。"
        />
      </div>
    </template>

    <template #extra>
      <!-- 维度页签：骨架表头没有控件插槽，原样放在 #extra；切换后上方主表随之切换维度。 -->
      <div class="card gpa-tabs-card">
        <div class="sec-hd gpa-sec">
          <span>维度切换（上方表格随之刷新）</span>
          <div class="gpa-tabs">
            <button v-for="t in tabs" :key="t.key"
                    class="btn btn-ghost btn-sm" :class="{ 'gpa-on': dim === t.key }"
                    @click="dim = t.key">{{ t.name }}</button>
          </div>
        </div>
      </div>

      <!-- ⚠️ 进货价缺失：原文案整段保留。行内「缺进价」标改为商品名列尾注（骨架单元格只能放文本）。 -->
      <div v-if="missingCost.length" class="card gpa-warn">
        <div class="gpa-warn-hd"><Icon name="alert" :size="14" /> 数据完整性提醒</div>
        <p>
          有 <b>{{ missingCost.length }}</b> 个已产生销售的商品<b>未录入进货价</b>，成本按 0 计入，
          涉及销售额 <b>{{ fmtMoney(missingRevenue) }}</b> —— 这部分的毛利等于销售额，<b>毛利被虚高</b>。
          请到「商品档案」补录进货价，补录后本表自动修正。
        </p>
      </div>

      <!-- 原 tfoot「本页合计」：只对当前维度可见行的可加总列求和；毛利率为比率，不合计。 -->
      <div class="card gpa-tot">
        <div class="sec-hd"><span>本页合计</span></div>
        <div class="gpa-tot-row">
          <span class="gpa-tot-i"><i>销售额</i><b>{{ fmtMoney(rowTotals.revenue) }}</b></span>
          <span class="gpa-tot-i"><i>成本</i><b>{{ fmtMoney(rowTotals.cost) }}</b></span>
          <span class="gpa-tot-i"><i>毛利</i><b>{{ fmtMoney(rowTotals.profit) }}</b></span>
        </div>
      </div>
    </template>

    <template #footnote>
      口径：仅统计「已送达 / 已签收」的销售订单；收入 = 明细实际成交金额，成本 = 净销量 × 商品进货价
      （退货以负数量自然扣减）。与首页三张毛利图同源，均读 <code>/api/reports/profit-breakdown</code>，
      前端不重算 —— 避免出现「本页毛利 ≠ 首页毛利」的第二份实现。未送达订单不计入；排序由后端按毛利排好。
    </template>
  </ReportTable>
</template>

<script setup>
/* 毛利分析（数据报表）—— 数据源：GET /api/reports/profit-breakdown（= db.get_profit_report）。
   🔴 口径**不在前端重算**：收入 / 成本 / 毛利 / 毛利率全部由后端给，前端只做展示格式化。
      首页「品牌毛利结构 / 商品毛利排行 / 品类毛利对比」三张图读的是同一个后端函数，
      前端若自己算一遍就会分岔成第二份实现。
   🔴 本页**只读**、无「新建 / 编辑」入口：毛利是采购与销售的**结果**。
   ⚠️ 「缺进价 ⇒ 成本记 0 ⇒ 毛利虚高」是**数据问题、不是代码 bug**。
   v646：外壳收编进 ReportTable（KPI / 列 / 行 / 口径脚注）：
      · 商品维度的「品牌 / 品类」两列 vs 其他维度的「商品数」列 ⇒ columns 改 computed，随维度切换；
      · 维度页签、缺进价警示卡、原 tfoot 合计 ⇒ 移入 #extra；
      · 行内「缺进价」标无法在骨架单元格里渲染标签，改为商品名列尾注明示，判定函数 isMissingCost 一字未动。
   🔴 金额沿用原页精确元格式（fmt 'rmb'），不缩万元。
   🔴 不开 `filterable`：/api/reports/profit-breakdown 不支持 date_from/date_to。 */
import ReportTable from '../../components/ReportTable.vue'
import Icon from '../../components/Icon.vue'
import ChartDonut from '../../components/chart/ChartDonut.vue'
import ChartHbar from '../../components/chart/ChartHbar.vue'
import { ref, computed, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const data = ref({ by_brand: [], by_category: [], products: [], total_revenue: 0, total_cost: 0, total_profit: 0 })

const tabs = [
  { key: 'brand', name: '按品牌' },
  { key: 'category', name: '按品类' },
  { key: 'product', name: '按商品' }
]
const dim = ref('brand')

const dimName = computed(() => {
  if (dim.value === 'brand') return '品牌'
  if (dim.value === 'category') return '品类'
  return '商品'
})

/* 商品维度多出「品牌 / 品类」两列；品牌 / 品类维度则多出「商品数」列。 */
const columns = computed(() => {
  const head = [{ key: 'seq', label: '序号', cls: 'num' }, { key: 'name', label: dimName.value }]
  const mid = dim.value === 'product'
    ? [{ key: 'brand', label: '品牌' }, { key: 'category', label: '品类' }]
    : [{ key: 'count', label: '商品数', fmt: 'num', cls: 'num' }]
  return [
    ...head,
    ...mid,
    { key: 'revenue', label: '销售额', fmt: 'rmb', cls: 'num' },
    { key: 'cost', label: '成本', fmt: 'rmb', cls: 'num' },
    { key: 'profit', label: '毛利', fmt: 'rmb', cls: 'num' },
    { key: 'margin_txt', label: '毛利率', cls: 'num' },
  ]
})

const total = computed(() => ({
  revenue: Number(data.value.total_revenue || 0),
  cost: Number(data.value.total_cost || 0),
  profit: Number(data.value.total_profit || 0)
}))

const rawRows = computed(() => {
  const d = data.value
  if (dim.value === 'brand') return Array.isArray(d.by_brand) ? d.by_brand : []
  if (dim.value === 'category') return Array.isArray(d.by_category) ? d.by_category : []
  return Array.isArray(d.products) ? d.products : []
})

const rows = computed(() => rawRows.value.map((r, i) => ({
  ...r,
  seq: i + 1,
  name: nameOf(r),
  count: r.count ?? '',
  revenue: Number(r.revenue || 0),
  cost: Number(r.cost || 0),
  profit: Number(r.profit || 0),
  margin_txt: pctText(r.margin),
})))

/* v648：图表数据 —— 只做**排序 + 截取**，不动任何数字（排序不改变口径，重算才会）。
   🔴 环形图画不了负值：负毛利（亏本）的行不进环形，请看上方表格，绝不把它抹成 0 或绝对值。 */
const profitSorted = computed(() => rows.value
  .map(r => ({ label: r.name || '—', value: Number(r.profit || 0) }))
  .sort((a, b) => b.value - a.value))
const profitItems = computed(() => profitSorted.value.filter(x => x.value > 0))
const profitTop = computed(() => profitSorted.value.slice(0, 10))

/* 有销售但没进货价 ⇒ 成本记 0、毛利 = 销售额（虚高）。只在商品维度可判（品牌/品类已聚合）。 */
function isMissingCost (r) {
  return Number(r.revenue || 0) > 0 && !(Number(r.purchase_price || 0) > 0)
}
const missingCost = computed(() => (Array.isArray(data.value.products) ? data.value.products : []).filter(isMissingCost))
const missingRevenue = computed(() => missingCost.value.reduce((s, r) => s + Number(r.revenue || 0), 0))

const kpis = computed(() => [
  { label: '销售额', value: fmtMoney(total.value.revenue), sub: '明细实际成交金额' },
  { label: '成本', value: fmtMoney(total.value.cost), sub: '净销量 × 进货价' },
  { label: '毛利', value: fmtMoney(total.value.profit), sub: '销售额 − 成本' },
  { label: '毛利率', value: marginText(total.value.revenue, total.value.profit), sub: '毛利 ÷ 销售额' },
])

/* 原行内「缺进价」标：骨架单元格只能放文本，改为在商品名后标注，判定逻辑不变。 */
function nameOf (r) {
  const suffix = (dim.value === 'product' && isMissingCost(r)) ? '（缺进价）' : ''
  if (dim.value === 'brand') return (r.brand || '未分类') + suffix
  if (dim.value === 'category') return (r.category || '未分类') + suffix
  return (r.name || '—') + suffix
}
/* 金额：¥ + 千分位 + 2 位小数（单位元）。毛利率后端已给 1 位小数，只补 %，不重算。 */
function fmtMoney (n) {
  const v = Number(n || 0)
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function pctText (n) {
  return Number(n || 0).toFixed(1) + '%'
}
function marginText (revenue, profit) {
  const r = Number(revenue || 0)
  return r > 0 ? (Number(profit || 0) / r * 100).toFixed(1) + '%' : '—'
}

async function load () {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.profitBreakdown()
    data.value = {
      by_brand: Array.isArray(d.by_brand) ? d.by_brand : [],
      by_category: Array.isArray(d.by_category) ? d.by_category : [],
      products: Array.isArray(d.products) ? d.products : [],
      total_revenue: Number(d.total_revenue || 0),
      total_cost: Number(d.total_cost || 0),
      total_profit: Number(d.total_profit || 0)
    }
  } catch (e) {
    err.value = (e && e.message) || '毛利分析读取失败'
  } finally {
    loading.value = false
  }
}

/* 本页合计：只对当前维度可见行的可加总列求和（销售额 / 成本 / 毛利）；毛利率为比率，不合计。 */
const rowTotals = computed(() => {
  let revenue = 0, cost = 0, profit = 0
  for (const r of rows.value) {
    revenue += Number(r.revenue || 0)
    cost += Number(r.cost || 0)
    profit += Number(r.profit || 0)
  }
  return { revenue, cost, profit }
})
onMounted(load)
defineExpose({ load })
</script>

<style scoped>
/* 仅保留仍被引用的私有类（页签 / 警示卡 / 合计卡挂在 #extra，插槽内容在本页作用域编译）。 */
/* v648 图表位：结构（环形）+ 排行（横向条）并排，窄屏堆叠。 */
.gpa-charts { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; margin-top: 14px }
@media (max-width: 1100px) { .gpa-charts { grid-template-columns: minmax(0, 1fr) } }
.gpa-sec { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap }
.gpa-tabs { display: flex; gap: 6px }
.gpa-tabs .gpa-on { background: var(--bg2); color: var(--t1); font-weight: 600 }
.gpa-tabs-card { margin-top: 14px }
.gpa-warn { border-left: 3px solid var(--war); margin-top: 14px }
.gpa-warn-hd { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--warn); margin-bottom: 6px }
.gpa-warn p { font-size: 12px; color: var(--t2); line-height: 1.7; margin: 0 }
.gpa-tot { margin-top: 14px; padding: 12px 14px }
.gpa-tot-row { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 8px }
.gpa-tot-i { display: flex; align-items: baseline; gap: 6px; font-size: 13px }
.gpa-tot-i i { font-style: normal; color: var(--t2) }
.gpa-tot-i b { color: var(--t1) }
</style>
