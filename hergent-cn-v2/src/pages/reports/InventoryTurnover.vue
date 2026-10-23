<template>
  <ReportTable
    title="库存周转"
    :subtitle="'近 ' + days + ' 天销售成本 ÷ 当前库存 · 周转越快越好'"
    :table-title="'可算周转的商品（按周转天数从慢到快 · ' + rows.length + ' 个）'"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    empty-hint="暂无可算周转的商品（需同时有库存记录与销量）。"
    @reload="load"
  >
    <template #chart>
      <!-- v648：周转**越慢越要看见** —— 横条取周转天数最长的 10 个商品（低温奶短保，>7 天偏慢）。
           🔴 天数用 fmt="plain" 展示（不是金额、不是数量）；阈值 3 / 7 天写在 note 里，不画假安全线。 -->
      <ChartHbar
        title="周转最慢的前 10 个商品"
        :sub="'单位：天 · 低温奶短保，超过 7 天算偏慢（共 ' + slowTop.length + ' 个可算周转）'"
        :items="slowTop"
        :loading="loading"
        :empty="!slowTop.length"
        empty-text="暂无可算周转的商品"
        fmt="plain"
        :name-w="150"
        export-name="库存周转最慢前10"
        note="周转天数 = 当前库存 ÷ 期间日均成本，数值越大越慢：超过 3 天要留意，超过 7 天算偏慢。缺进价的商品算不出成本，不进本图。"
      />
    </template>

    <template #extra>
      <!-- 期间选择：骨架表头没有控件插槽，原样放在 #extra；切换后整页重新取数。 -->
      <div class="card rpt-tabs-card">
        <div class="sec-hd rpt-sec">
          <span>统计区间（切换后整页重新计算）</span>
          <select class="btn btn-ghost btn-sm rpt-sel" v-model.number="days" @change="load()">
            <option :value="30">近 30 天</option>
            <option :value="60">近 60 天</option>
            <option :value="90">近 90 天</option>
            <option :value="180">近 180 天</option>
          </select>
        </div>
      </div>

      <!-- ⚠️ 覆盖缺口：原文案整段保留。 -->
      <div v-if="s.sku_without_stock" class="card rpt-warn">
        <div class="rpt-warn-hd"><Icon name="alert" :size="14" /> 覆盖范围提醒</div>
        <p>
          只有 <b>{{ s.sku_with_stock }}</b> 个商品<b>既有库存记录、又有销量</b>，能算出周转天数；
          另有 <b>{{ s.sku_without_stock }}</b> 个有销量的商品<b>没有库存记录</b>，无法计算（分母为 0 无意义），
          已单独列在下方，<b>不能当成「库存为零、周转飞快」</b>。
          请先补录这些商品的库存，本表覆盖才会完整。
        </p>
      </div>

      <!-- 主表（可算周转）原 tfoot 合计 -->
      <div class="card rpt-tot">
        <div class="sec-hd"><span>主表合计</span></div>
        <div class="rpt-tot-row">
          <span class="rpt-tot-i"><i>当前库存</i><b>{{ fmtNum(tot1.stock_qty) }}</b></span>
          <span class="rpt-tot-i"><i>库存金额</i><b>{{ fmtMoney(tot1.stock_value) }}</b></span>
          <span class="rpt-tot-i"><i>期间成本</i><b>{{ fmtMoney(tot1.period_cost) }}</b></span>
        </div>
      </div>

      <!-- 第二张表：有销量但无库存记录（原样保留，骨架只承载主表） -->
      <div v-if="noStock.length" class="card rpt-card">
        <div class="sec-hd rpt-sec">
          <span>有销量但无库存记录（{{ noStock.length }} 个 · 按期间成本从高到低）</span>
        </div>
        <div class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>商品</th>
                <th>品牌</th>
                <th class="num">期间销量</th>
                <th class="num">期间成本</th>
                <th class="num">周转天数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in noStock" :key="'n-' + i">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ r.name || '—' }}</td>
                <td>{{ r.brand || '—' }}</td>
                <td class="num">{{ fmtNum(r.sold_qty) }}{{ r.unit || '' }}</td>
                <td class="num">{{ fmtMoney(r.period_cost) }}</td>
                <td class="num">缺库存</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb" colspan="3">本页合计</td>
                <td class="num">{{ fmtNum(tot2.sold_qty) }}</td>
                <td class="num">{{ fmtMoney(tot2.period_cost) }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </template>

    <template #footnote>
      口径：只统计「已送达 / 已签收」；期间成本 = 销量 × 商品进货价；库存金额 = 库存量 × 成本价
      （<code>inventory.cost_price</code> 为空时回退商品进货价）；周转天数 = 库存金额 ÷ 日均销售成本；
      周转次数 = 365 ÷ 周转天数。前端<b>不重算</b>周转，全部读后端
      <code>GET /api/reports/inventory-turnover</code>。
      ⚠️ 周转天数用的是「当前库存」而非「平均库存」（系统暂无历史库存快照），读数会随盘点时点波动。
    </template>
  </ReportTable>
</template>

<script setup>
/* 库存周转（数据报表 › 库存） —— 数据源：GET /api/reports/inventory-turnover（v507 新增端点）。
   🔴 周转**不在前端算**：后端统一口径（库存金额 ÷ 日均成本），前端只展示。
   🔴 无库存记录的商品**不参与**周转计算并单列 —— 否则「库存记录缺失」会被读成
      「库存为零 ⇒ 周转无限快」，这是比不显示更危险的假数字。
   🔴 本页只读。
   v646：外壳收编进 ReportTable（KPI / 主表 / 口径脚注）：
      · 期间下拉、覆盖缺口警示卡、第二张「无库存记录」表 ⇒ 原样移入 #extra；
      · 原周转天数单元格的红/黄/绿是按行算的、骨架列 cls 是静态的，改成独立的「周转评价」
        文本列承接同一组阈值（低温奶短保：>7 天偏慢、>3 天注意、其余正常），判定未变；
      · 原行内「缺进价」标改为商品名列尾注。
   🔴 不开 `filterable`：该端点只接受 days，不支持 date_from/date_to，开了就是假筛选。 */
import ReportTable from '../../components/ReportTable.vue'
import Icon from '../../components/Icon.vue'
import ChartHbar from '../../components/chart/ChartHbar.vue'
import { ref, computed, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const days = ref(90)
const s = ref({})
const items = ref([])
const noStock = ref([])

const columns = [
  { key: 'seq', label: '序号', cls: 'num' },
  { key: 'name', label: '商品' },
  { key: 'brand', label: '品牌' },
  { key: 'stock_qty_txt', label: '当前库存', cls: 'num' },
  { key: 'stock_value', label: '库存金额', fmt: 'money', cls: 'num' },
  { key: 'period_cost', label: '期间成本', fmt: 'money', cls: 'num' },
  { key: 'turnover_days_txt', label: '周转天数', cls: 'num' },
  { key: 'turnover_flag', label: '周转评价', cls: 'num' },
  { key: 'turnover_times', label: '周转次数', cls: 'num' },
]

const rows = computed(() => items.value.map((r, i) => ({
  ...r,
  seq: i + 1,
  name: (r.name || '—') + (r.no_cost ? '（缺进价）' : ''),
  brand: r.brand || '—',
  stock_qty_txt: fmtNum(r.stock_qty) + (r.unit || ''),
  stock_value: Number(r.stock_value || 0),
  period_cost: Number(r.period_cost || 0),
  turnover_days_txt: dayText(r.turnover_days),
  turnover_flag: flagText(r.turnover_days),
  turnover_times: r.turnover_times ?? '',
})))

/* v648：横条数据 —— 周转天数**从长到短**取前 10（最慢的排最上面，老板要先看见它们）。
   🔴 turnover_days 为 null / 非数字 = 算不出周转（缺进价或缺库存），一律剔除，
      绝不填 0 —— 填 0 会被读成"周转飞快"，正好把最该管的商品藏起来。 */
const slowTop = computed(() => items.value
  .map(r => ({ label: r.name || '—', value: Number(r.turnover_days) }))
  .filter(x => Number.isFinite(x.value))
  .sort((a, b) => b.value - a.value)
  .slice(0, 10)
  .map(x => ({ label: x.label, value: Math.round(x.value * 10) / 10 })))

/* 低温奶短保：周转 > 7 天偏慢（红），> 3 天注意（黄），其余正常（绿） */
function daysClass(v) {
  if (v === null || v === undefined) return ''
  if (v > 7) return 'val-bad'
  if (v > 3) return 'val-warn'
  return 'val-ok'
}
function dayText(v) {
  return (v === null || v === undefined) ? '—' : (v.toFixed ? v.toFixed(1) : v) + ' 天'
}
/* 骨架单元格无法按行上色，用同阈值换算成文字列承接，结论不变。 */
function flagText(v) {
  const c = daysClass(v)
  if (c === 'val-bad') return '偏慢'
  if (c === 'val-warn') return '注意'
  return '正常'
}

const kpis = computed(() => [
  { label: '当前库存金额', value: fmtMoney(s.value.stock_value), sub: `${s.value.sku_with_stock ?? 0} 个商品有库存记录` },
  { label: '期间销售成本', value: fmtMoney(s.value.period_cost), sub: `近 ${days.value} 天 · 已送达口径` },
  { label: '周转天数', value: dayText(s.value.turnover_days), sub: '库存 ÷ 日均成本' },
  { label: '周转次数', value: s.value.turnover_times ? s.value.turnover_times + ' 次/年' : '—', sub: '365 ÷ 周转天数' },
])

function fmtMoney(v) {
  const n = Number(v || 0)
  if (Math.abs(n) >= 10000) return '¥' + (n / 10000).toFixed(1) + ' 万'
  return '¥' + n.toFixed(0)
}
function fmtNum(v) { return Number(v || 0).toFixed(0) }

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.inventoryTurnover(days.value)
    s.value = (d && d.summary) || {}
    items.value = Array.isArray(d && d.items) ? d.items : []
    noStock.value = Array.isArray(d && d.no_stock_items) ? d.no_stock_items : []
  } catch (e) {
    err.value = (e && e.message) || '加载失败'
    s.value = {}; items.value = []; noStock.value = []
  } finally {
    loading.value = false
  }
}

/* 本页合计：可算周转表 / 无库存表各自对可见行的可加总列求和；周转天数 / 次数均为比率，不合计。 */
const tot1 = computed(() => {
  let stock_qty = 0, stock_value = 0, period_cost = 0
  for (const r of items.value) {
    stock_qty += Number(r.stock_qty || 0)
    stock_value += Number(r.stock_value || 0)
    period_cost += Number(r.period_cost || 0)
  }
  return { stock_qty, stock_value, period_cost }
})
const tot2 = computed(() => {
  let sold_qty = 0, period_cost = 0
  for (const r of noStock.value) {
    sold_qty += Number(r.sold_qty || 0)
    period_cost += Number(r.period_cost || 0)
  }
  return { sold_qty, period_cost }
})
onMounted(load)
</script>

<style scoped>
/* 仅保留仍被引用的私有类（期间选择 / 警示卡 / 合计卡 / 第二张表挂在 #extra，插槽在本页作用域编译）。 */
.rpt-sel { padding: 4px 8px; }
.rpt-tabs-card { margin-top: 14px; }
.rpt-sec { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.rpt-card { margin-top: 14px; }
.rpt-warn { margin-top: 14px; padding: 12px 14px; border-left: 3px solid var(--warn-amber); background: var(--bg2); }
.rpt-warn-hd { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--war); font-size: 13px; }
.rpt-warn p { margin: 6px 0 0; font-size: 12px; line-height: 1.9; color: var(--t2); }
.rpt-tot { margin-top: 14px; padding: 12px 14px; }
.rpt-tot-row { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 8px; }
.rpt-tot-i { display: flex; align-items: baseline; gap: 6px; font-size: 13px; }
.rpt-tot-i i { font-style: normal; color: var(--t2); }
.rpt-tot-i b { color: var(--t1); }
</style>
