<template>
  <div class="page dash">
    <header class="dash-hd">
      <h1>经营趋势</h1>
      <p class="dash-sub">每次进入页面重新取数，金额按量级自动换算单位</p>
    </header>

    <!-- ============ 今日四个数 ============ -->
    <div v-if="kpiErr" class="card dash-err">
      <div class="dash-err-ti">今天的数没取回来</div>
      <div class="dash-err-msg">{{ kpiErr }}</div>
      <button type="button" class="btn btn-ghost btn-sm" @click="loadDash">
        <Icon name="refresh" :size="13" />重试
      </button>
    </div>
    <div v-else class="kpi-row">
      <div v-for="k in kpis" :key="k.key" class="card kpi">
        <div class="kpi-k">{{ k.k }}</div>
        <div class="kpi-v">
          <span class="kpi-num" :class="{ skel: kpiLoading }">{{ kpiLoading ? '—' : k.v }}</span>
          <span v-if="!kpiLoading && k.unit" class="kpi-u">{{ k.unit }}</span>
        </div>
        <div v-if="!kpiLoading && k.deltaText" class="kpi-d" :class="k.dir">{{ k.deltaText }}</div>
        <div v-else class="kpi-d">&nbsp;</div>
      </div>
    </div>

    <!-- ============ 近 7 天：销售与毛利 ============ -->
    <div class="card">
      <ChartLine
        title="近 7 天销售与毛利"
        :sub="dashLoadedAt"
        :labels="dashLabels"
        :series="dashSeries"
        :loading="kpiLoading"
        :error="kpiErr"
        :height="250"
        fmt="money"
        export-name="近7天销售与毛利"
        note="毛利按已送达 / 已签收的订单计算；未送达的订单只计销售额。"
        @retry="loadDash"
      />
    </div>

    <!-- ============ 近 7 天订单数 ============ -->
    <div class="card">
      <ChartBar
        title="近 7 天订单数"
        :labels="dashLabels"
        :series="orderSeries"
        :loading="kpiLoading"
        :error="kpiErr"
        :height="200"
        fmt="plain"
        export-name="近7天订单数"
        :ref-lines="orderRefLines"
        @retry="loadDash"
      />
    </div>

    <!-- ============ 需要「数据报表」权限的几块 ============ -->
    <template v-if="repOk">
      <div class="card">
        <ChartLine
          title="收支趋势"
          :sub="rangeSub"
          :labels="trendLabels"
          :series="trendSeries"
          :loading="trendLoading"
          :error="trendErr"
          :height="230"
          fmt="money"
          smooth
          export-name="收支趋势"
          note="收入与支出按单据发生日期归集，都从 0 起，两条线可以直接比高矮。"
          @retry="loadTrend"
        >
          <template #ctl>
            <div class="seg" role="group" aria-label="统计区间">
              <button
                v-for="d in rangeOpts" :key="d" type="button" class="seg-btn"
                :class="{ on: trendDays === d }" @click="setRange(d)"
              >近 {{ d }} 天</button>
            </div>
          </template>
        </ChartLine>
      </div>

      <div class="grid2">
        <div class="card">
          <ChartDonut
            title="品牌毛利结构"
            :sub="profitTotalText"
            :items="brandItems"
            :loading="profitLoading"
            :error="profitErr"
            :empty-text="pbEmptyText"
            :height="240"
            fmt="money"
            center-label="毛利合计"
            export-name="品牌毛利结构"
            note="按毛利金额排序；块数多于 6 个时，其余合并成「其他」。"
            @retry="loadProfit"
          />
        </div>
        <div class="card">
          <ChartHbar
            title="商品毛利排行"
            sub="前 8 名"
            :items="productItems"
            :loading="profitLoading"
            :error="profitErr"
            :empty-text="pbEmptyText"
            fmt="money"
            :total="profitTotal"
            export-name="商品毛利排行"
            @retry="loadProfit"
          />
        </div>
      </div>

      <div class="card">
        <ChartBar
          title="品类毛利对比"
          :labels="catLabels"
          :series="catSeries"
          :loading="profitLoading"
          :error="profitErr"
          :empty="pbPriceMissing"
          :empty-text="pbEmptyText"
          :height="240"
          fmt="money"
          export-name="品类毛利对比"
          @retry="loadProfit"
        />
      </div>

      <div class="card">
        <ChartHbar
          title="客户销额排行"
          :sub="custSub"
          :items="custItems"
          :loading="custLoading"
          :error="custErr"
          fmt="money"
          :name-w="168"
          export-name="客户销额排行"
          :note="custNote"
          @retry="loadCust"
        />
      </div>
    </template>

    <div v-else class="card dash-hint">
      <b>还有几张图没打开</b>
      <p>「收支趋势」「品牌毛利结构」「商品毛利排行」「品类毛利对比」「客户销额排行」读的是数据报表，当前账号还没有这块权限。需要的话，让管理员在「档案管理 › 组织相关 › 角色权限」里给对应角色勾上。</p>
    </div>
  </div>
</template>

<script setup>
/* ============================================================================
   Dashboard.vue —— 「经营趋势」页（v491 重写）
   ============================================================================
   重写动机（按 v491 图表补齐计划）：
     ① 原页只有一张**手写**的折线（坐标、网格、面积、轴标签全是页面内联代码），
        而同一件事在别处还写着第二份 ⇒ 改一处忘一处。现在改用统一组件，
        "加一种图"从**加代码**变成**加配置**。
       ② 原页的数据加载是「空 catch」—— 接口挂了页面只剩骨架屏，
          老板会以为"今天没生意"。这是本项目「绝不静默失效」铁律的**反面样本**，
          本轮改成明确报错 + 重试。

   🔴 模块轴纪律（本页最容易踩的坑）：
      本页本身挂 `module: 'dashboard'`，而图表数据来自 `/api/reports/*`（归 `reports`）。
      两者今天**恰好同权**（持有 dashboard 的只有老板与管理员，两人都持 reports），
      但"恰好"不是"必然" ⇒ 报表那几块**一律加 `canModule('reports')` 门禁**，
      缺权限时给出**明确说明**，而不是让图去撞 403 变成一片空白（局部假入口）。
   ============================================================================ */
import { computed, onMounted, ref, watch } from 'vue'
import { dashboardApi, reportsApi } from '../api/modules'
import { store } from '../store'
import Icon from '../components/Icon.vue'
import ChartLine from '../components/chart/ChartLine.vue'
import ChartBar from '../components/chart/ChartBar.vue'
import ChartDonut from '../components/chart/ChartDonut.vue'
import ChartHbar from '../components/chart/ChartHbar.vue'
import { moneyParts, int } from '../components/chart/chartFmt'

/* ---------- 今日四个数 + 近 7 天趋势（数据源：本页自己的模块） ---------- */
const dash = ref(null)
const kpiLoading = ref(true)
const kpiErr = ref('')
const dashLoadedAt = ref('')

async function loadDash() {
  kpiLoading.value = true
  kpiErr.value = ''
  try {
    dash.value = await dashboardApi.todayProfit()
    dashLoadedAt.value = '刚取的数'
  } catch (e) {
    // 🔴 这里原来是空的 catch（静默）—— 现在把原因带出来
    kpiErr.value = (e && e.message) || '网络或服务暂时不通'
  } finally {
    kpiLoading.value = false
  }
}

const trendArr = computed(() => (dash.value && Array.isArray(dash.value.trend) ? dash.value.trend : []))
const dashLabels = computed(() => trendArr.value.map((d) => String(d.date || '').slice(5)))
const dashSeries = computed(() => [
  { name: '销售额', data: trendArr.value.map((d) => num(d.sales)), area: true },
  { name: '毛利', data: trendArr.value.map((d) => num(d.profit)), dashed: true },
])
const orderSeries = computed(() => [
  { name: '订单数', data: trendArr.value.map((d) => num(d.orders)) },
])
/** 订单数的参考线：这一段的日均（一眼看出哪天特别多 / 特别少） */
const orderRefLines = computed(() => {
  const arr = trendArr.value.map((d) => Number(d.orders) || 0)
  if (!arr.length) return []
  const avg = arr.reduce((s, v) => s + v, 0) / arr.length
  return [{ value: avg, label: `日均 ${Math.round(avg)} 单` }]
})

function num(v) { return v === null || v === undefined || v === '' ? null : Number(v) }

/** 今日四个数与"较昨日"。
 *  ⚠️ 用 --suc/--dan（经营口径：涨是好事）而**不是** --chart-up/--chart-down
 *     （那是行情口径的涨红跌绿，用在这里会把"生意变好"染成警告色）。 */
const kpis = computed(() => {
  const t = (dash.value && dash.value.trend || [])
  const cur = t[t.length - 1] || {}
  const prev = t[t.length - 2] || {}
  const defs = [
    { key: 'sales', k: '今日销售额', raw: cur.sales, prev: prev.sales, money: true },
    { key: 'profit', k: '今日毛利', raw: cur.profit, prev: prev.profit, money: true },
    { key: 'payment', k: '今日回款', raw: cur.payment, prev: prev.payment, money: true },
    { key: 'orders', k: '今日订单数', raw: cur.orders, prev: prev.orders, money: false },
  ]
  return defs.map((d) => {
    const v = Number(d.raw)
    let vText = '—'
    let unit = ''
    if (isFinite(v)) {
      if (d.money) {
        const { v: vv, unit: u2 } = moneyParts(v)
        vText = vv
        unit = u2 ? u2 + '元' : '元'
      } else {
        vText = int(v)
        unit = '单'
      }
    }
    // 较昨日：两侧都有有效值、且昨日非 0 才算（否则"从 0 到 1"会显示成无穷大增长）
    let deltaText = ''
    let dir = ''
    const p = Number(d.prev)
    if (isFinite(v) && isFinite(p) && p !== 0) {
      const r = (v - p) / Math.abs(p)
      dir = r > 0 ? 'up' : r < 0 ? 'down' : ''
      const sign = r > 0 ? '+' : ''
      deltaText = `较昨日 ${sign}${(r * 100).toFixed(0)}%`
    }
    return { key: d.key, k: d.k, v: vText, unit, deltaText, dir }
  })
})

/* ---------- 收支趋势（需 reports 权限） ---------- */
const repOk = computed(() => !!store.canModule && store.canModule('reports'))
const trendDays = ref(7)
const rangeOpts = [7, 14, 30]
const trend = ref(null)
const trendLoading = ref(false)
const trendErr = ref('')

async function loadTrend() {
  if (!repOk.value) return
  trendLoading.value = true
  trendErr.value = ''
  try {
    trend.value = await reportsApi.trend(trendDays.value)
  } catch (e) {
    trendErr.value = (e && e.message) || '网络或服务暂时不通'
  } finally {
    trendLoading.value = false
  }
}
function setRange(d) {
  if (trendDays.value === d) return
  trendDays.value = d
  loadTrend()
}
const rangeSub = computed(() => `近 ${trendDays.value} 天`)
const trendLabels = computed(() => (trend.value && trend.value.labels) || [])
const trendSeries = computed(() => [
  { name: '收入', data: (trend.value && trend.value.income || []).map(num), area: true },
  { name: '支出', data: (trend.value && trend.value.expense || []).map(num) },
])

/* ---------- 利润结构（需 reports 权限） ---------- */
const profit = ref(null)
const profitLoading = ref(false)
const profitErr = ref('')

async function loadProfit() {
  if (!repOk.value) return
  profitLoading.value = true
  profitErr.value = ''
  try {
    profit.value = await reportsApi.profitBreakdown()
  } catch (e) {
    profitErr.value = (e && e.message) || '网络或服务暂时不通'
  } finally {
    profitLoading.value = false
  }
}

const profitTotal = computed(() => {
  const t = Number(profit.value && profit.value.total_profit)
  return isFinite(t) ? t : 0
})
const profitTotalText = computed(() => {
  if (!profit.value) return ''
  // 全 0 时不显示「合计 0元」—— 那会被读成"一分没赚"，而真相是"价没录、算不出来"。
  // 空着，由下方图内的说明把原因讲清楚（见 pbEmptyText）。
  if (!(profitTotal.value > 0)) return ''
  const { v, unit } = moneyParts(profitTotal.value)
  return `合计 ${v}${unit}元`
})
const brandItems = computed(() =>
  ((profit.value && profit.value.by_brand) || [])
    .map((b) => ({ label: b.brand || '未分类', value: Number(b.profit) || 0 }))
    .filter((b) => b.value > 0))
const productItems = computed(() =>
  ((profit.value && profit.value.products) || [])
    .filter((p) => Number(p.profit) > 0)
    .slice(0, 8)
    .map((p) => ({ label: p.name || '未命名', value: Number(p.profit) || 0 })))
const catSeries = computed(() => [{
  name: '毛利',
  data: ((profit.value && profit.value.by_category) || []).map((c) => Number(c.profit) || 0),
}])
const catLabels = computed(() =>
  ((profit.value && profit.value.by_category) || []).map((c) => c.category || '未分类'))

/* ---------- 客户销额排行（需 reports 权限） ----------
   🔴 为什么是「销额」而不是「利润」—— 这一条是实测出来的，不是取名偏好：
      `get_customer_profitability()` 的口径是 `profit = revenue − cost`，而
      `cost = Σ(明细数量 × products.purchase_price)`。生产 tenant 1 实测：
      **已送达 / 已签收的 14.2 万行明细里，有进货价的行数 = 0**（473 个商品中
      同时有售价+进货价的只有 56 个，且这 56 个一单没卖过）⇒ `cost` 恒为 0
      ⇒ `profit` 恒等于 `revenue`。照原样画一张「利润排行」，就是把**销售额冒充成利润**，
      比不画更糟（老板会拿它当毛利去定价）。
      ⇒ 只取它**真实可信**的那一半：`revenue`（= 订单 `total_amount` 求和，真数）。
      等商品档案的进货价补齐、后端成本口径成立之后，再把「利润」加回来。
      另：`margin` 字段同理是被 0 成本抬成 100% 的，一律不展示。 */
const CUST_TOP = 10
const cust = ref(null)
const custLoading = ref(false)
const custErr = ref('')

async function loadCust() {
  if (!repOk.value) return
  custLoading.value = true
  custErr.value = ''
  try {
    const rows = await reportsApi.customerProfitability()
    cust.value = Array.isArray(rows) ? rows : []
  } catch (e) {
    custErr.value = (e && e.message) || '网络或服务暂时不通'
  } finally {
    custLoading.value = false
  }
}

/** 后端已按销额降序排好，前端只做**展示层**的事：
    取销额为正的前 N 名（零销额的客户进了横向条没有信息量，只会把榜拉长）。 */
const custItems = computed(() =>
  (cust.value || [])
    .filter((c) => Number(c.revenue) > 0)
    .slice(0, CUST_TOP)
    .map((c) => ({ label: c.name || '未命名客户', value: Number(c.revenue) || 0 })))
const custSub = computed(() => (custItems.value.length ? `前 ${custItems.value.length} 名` : ''))
const custNote = computed(() => {
  if (!cust.value || !cust.value.length) return ''
  const soldTotal = cust.value.filter((c) => Number(c.revenue) > 0).length
  return `按已送达 / 已签收订单的销售额排名（共 ${soldTotal} 个客户有销额）。` +
    '这里只排销额：商品档案的进货价多数还没录，毛利暂时算不出来（现在算出来的「毛利」会等于销售额，不能当毛利用）。'
})

/* ---------- 毛利三图的「跨源一致性」提示 ----------
   🔴 为什么需要这一段：`/reports/profit-breakdown` 的收入是
      `Σ(商品销量 × products.sale_price)`、成本是 `Σ(商品销量 × purchase_price)`，
      两个价都没录时它**只能返回全 0**。于是「品牌毛利结构 / 商品毛利排行 / 品类毛利对比」
      三张图在生产上是空的 —— 但**空的原因有两种，含义完全相反**：
        ① 这段时间真没卖货          ⇒ 「还没有数据」是对的；
        ② 卖了货，只是没录售价/进货价 ⇒ 说「还没有数据」就是**假话**，
           老板会以为系统坏了，甚至以为毛利真的是 0。
      判据用**本页已有的真实销售额**（来自 `dashboard.py` 的订单金额）：卖过货却算出 0
      ⇒ 只可能是②。这是跨源对账，不是复算 —— 前端不重算任何金额。 */
const pbZero = computed(() => {
  const p = profit.value
  return !!p && Number(p.total_revenue) === 0 && Number(p.total_cost) === 0
})
/** 「确实卖过货」的证据 —— 用**本页另一张图的真数**，不要用近 7 天趋势：
 *  实测（2026-10-13）`/api/dashboard/today-profit` 的近 7 天是**整排 0**
 *  （那一周真没单）⇒ 拿它当判据，判据本身就是 0，什么也证不了。
 *  而「客户销额排行」的 `revenue` 是**全期已送达订单金额求和**，与 profit-breakdown
 *  同为全期口径、可直接对照：它非零而 profit-breakdown 全零 ⇒ 只可能是价没录。 */
const anyCustomerSales = computed(() => (cust.value || []).some((c) => Number(c.revenue) > 0))
const pbPriceMissing = computed(() => pbZero.value && anyCustomerSales.value)
const pbEmptyText = computed(() =>
  pbPriceMissing.value
    ? '毛利暂时算不出来：商品档案里的售价 / 进货价还没录全（本页下方「客户销额排行」是真实订单金额，说明确实卖过货）。把商品档案的售价与进货价补齐后，这几张图会自动有数。'
    : '这段时间还没有数据')

/* ---------- 生命周期 ---------- */
onMounted(() => {
  loadDash()
  if (repOk.value) { loadTrend(); loadProfit(); loadCust() }
})
/* 🔴 权限是异步拉回来的：onMounted 那一刻 canModule 可能还是"未知"（判据为假），
   所以必须在它变真之后再补一次 —— 否则老板会看到"没有权限"的提示一闪而过不消失。 */
watch(repOk, (ok) => {
  if (ok && !trend.value && !trendLoading.value) loadTrend()
  if (ok && !profit.value && !profitLoading.value) loadProfit()
  if (ok && !cust.value && !custLoading.value) loadCust()
})
</script>

<style scoped>
.dash{display:flex;flex-direction:column;gap:14px}
.dash-hd h1{font-size:18px;font-weight:600;color:var(--t1)}
.dash-sub{font-size:12px;color:var(--t3);margin-top:2px}

.kpi-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
@media(max-width:1000px){.kpi-row{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:560px){.kpi-row{grid-template-columns:1fr}}
.kpi{display:flex;flex-direction:column;gap:4px;min-width:0}
.kpi-k{font-size:12px;color:var(--t3)}
.kpi-v{display:flex;align-items:baseline;gap:3px;min-width:0}
.kpi-num{font-size:24px;font-weight:600;color:var(--t1);font-variant-numeric:tabular-nums;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kpi-num.skel{color:var(--t3)}
.kpi-u{font-size:12px;color:var(--t3);flex:none}
.kpi-d{font-size:12px;color:var(--t3);min-height:18px}
/* 经营口径：涨用成功绿、跌用危险红（不是行情的涨红跌绿 —— 那会把"生意变好"染成警告色） */
.kpi-d.up{color:var(--suc)}
.kpi-d.down{color:var(--dan)}

.grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}
@media(max-width:900px){.grid2{grid-template-columns:1fr}}

.dash-err{display:flex;flex-direction:column;align-items:flex-start;gap:6px;color:var(--danger-txt)}
.dash-err-ti{font-weight:500}
.dash-err-msg{font-size:12px;color:var(--t2)}
.dash-hint b{font-size:14px;font-weight:500;color:var(--t1)}
.dash-hint p{font-size:12px;color:var(--t2);margin-top:6px;line-height:1.8}

/* 区间切换（沿用全站分段按钮的长相） */
.seg{display:inline-flex;border:1px solid var(--bd);border-radius:8px;overflow:hidden}
.seg-btn{padding:4px 12px;font-size:12px;background:transparent;border:0;color:var(--t2)}
.seg-btn + .seg-btn{border-left:1px solid var(--bd)}
.seg-btn.on{background:var(--p);color:#fff}
</style>
