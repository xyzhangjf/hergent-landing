<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>{{ title }}</h2>
        <span class="page-sub">{{ subtitle }}</span>
      </div>
      <div class="gr-acts">
        <select v-if="hasDateFilters" class="btn btn-ghost btn-sm gr-sel" :value="quick" @change="onQuick($event.target.value)">
          <option value="all">全部时间</option>
          <option value="7">近 7 天</option>
          <option value="30">近 30 天</option>
          <option value="month">本月</option>
          <option value="lastmonth">上月</option>
          <option value="year">今年</option>
          <option value="custom">自定义…</option>
        </select>
        <template v-if="hasDateFilters && showCustom">
          <input type="date" class="gr-date" v-model="dateFrom" />
          <span class="gr-tilde">~</span>
          <input type="date" class="gr-date" v-model="dateTo" />
        </template>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
          <Icon name="rotate-ccw" :size="14" />刷新
        </button>
        <button class="btn btn-ghost btn-sm" :disabled="loading || !rows.length" @click="exportCsv()">导出 CSV</button>
      </div>
    </div>

    <Skeleton v-if="loading && !rows.length" />

    <!-- ① 未配置：这条路径的报表还没写 SQL。诚实说明，不假装"没数据"。 -->
    <div v-else-if="notConfigured" class="card gr-hollow">
      <div class="gr-hollow-ic"><Icon name="bar-chart" :size="22" /></div>
      <h3>这张报表还没有配数据口径</h3>
      <p class="gr-hollow-desc">
        报表引擎已经就绪，但「{{ title }}」的具体 SQL 还没写。
        <b>这不是"没有数据"，而是"还没定义怎么取数"</b> —— 两者看起来一样，含义完全不同。
      </p>
      <p class="gr-hollow-foot">
        补齐方式：在 <code>report_definitions</code> 里加一条定义即可，<b>不需要改后端代码、也不需要改这个页面</b>。
      </p>
    </div>

    <!-- ② 本产品没有这个模块：报表在、功能没启用。不是"没配口径"，也不是"没数据"。 -->
    <div v-else-if="unavailable" class="card gr-hollow">
      <div class="gr-hollow-ic"><Icon name="help-circle" :size="22" /></div>
      <h3>本产品还没有这个模块</h3>
      <p class="gr-hollow-desc">{{ reason || '本产品尚未提供该报表所需的业务模块。' }}</p>
      <p class="gr-hollow-foot">
        这张报表的入口是预留的：等对应模块上线、录了数据，它会自动开始出数，
        <b>不需要改代码、也不需要重新配置</b>。
      </p>
    </div>

    <!-- ③ 无权查看：这个账号的角色没有该报表的数据权限（后端 403）。诚实说明，不白屏也不假装"没数据"。 -->
    <div v-else-if="denied" class="card gr-hollow">
      <div class="gr-hollow-ic"><Icon name="lock" :size="22" /></div>
      <h3>你没有查看这张报表的权限</h3>
      <p class="gr-hollow-desc">
        报表「{{ title }}」需要相应的数据权限，当前账号的角色尚未开通，所以看不到内容。
        <b>这不是"没有数据"，而是"还没有被授权查看"</b> —— 两者看起来都是空，含义完全不同。
      </p>
      <p class="gr-hollow-foot">
        如需开通，请联系系统管理员在后台为你的角色分配对应模块权限。
      </p>
    </div>

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert-triangle" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <template v-else>
      <!-- 概览：合计直接来自后端（对**完整结果集**求和，不是当前 5000 行之和） -->
      <div v-if="kpiCols.length" class="card kpi-strip" :class="'cols-' + Math.min(4, kpiCols.length)">
        <div v-for="c in kpiCols" :key="'k-' + c.key" class="kpi">
          <div class="kpi-label">{{ c.label }}</div>
          <div class="kpi-val">{{ fmtOf(c, totals[c.key]) }}</div>
          <div class="kpi-sub">{{ kpiSub(c) }}</div>
        </div>
      </div>

      <!-- 截断提示：必须显式，不能静默只给一部分 -->
      <div v-if="truncated" class="card gr-warn">
        <div class="gr-warn-hd"><Icon name="alert-triangle" :size="14" /> 结果超出显示上限</div>
        <p>
          本报表共 <b>{{ fmtInt(rowCount) }}</b> 行，页面只显示前 <b>{{ fmtInt(maxRows) }}</b> 行。
          上方与表尾的<b>合计是全部 {{ fmtInt(rowCount) }} 行算出来的</b>（不是这 {{ fmtInt(maxRows) }} 行之和），
          所以合计会对得上，但明细看不全。要看到具体单据，请缩小日期范围或用上方筛选。
        </p>
      </div>

      <!-- 图：配了图才出现。没配图的报表**不留空白等图** —— 空框看着像没加载完。
           顺序刻意放在截断提示**之后**：那张提示是"数看不全"的警告，不能被人当装饰略过。 -->
      <component
        :is="chartComp"
        v-if="hasChart"
        class="gr-fig"
        :title="chartCfg.title || title"
        :sub="chartSub"
        :loading="loading"
        :error="chartErr"
        :fmt="chartFmt"
        :note="chartNote"
        :export-name="(chartCfg.title || title) + '-图表'"
        v-bind="chartProps"
        @retry="load"
      />

      <div class="card gr-card">
        <div class="sec-hd gr-sec">
          <span>{{ title }}<span class="gr-cnt">{{ rows.length ? '共 ' + fmtInt(rowCount) + ' 行' : '无数据' }}</span></span>
          <span v-if="elapsedMs" class="gr-cost">{{ elapsedMs }} 毫秒</span>
        </div>

        <div v-if="rows.length" class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th
                  v-for="c in columns"
                  :key="'h-' + c.key"
                  :class="clsOf(c)"
                  :style="[c.width ? { width: c.width, 'min-width': c.width } : null, nowrapOf(c) ? { 'white-space': 'nowrap' } : null]"
                >{{ c.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="'r-' + i">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td
                  v-for="c in columns"
                  :key="'c-' + i + '-' + c.key"
                  :class="clsOf(c)"
                  :style="nowrapOf(c) ? { 'white-space': 'nowrap' } : null"
                  :title="cellTitle(c, r)"
                >{{ fmtOf(c, r[c.key]) }}</td>
              </tr>
            </tbody>
            <tfoot v-if="hasTotals">
              <tr>
                <td class="ft-lb" :colspan="labelSpan">合计（全部 {{ fmtInt(rowCount) }} 行）</td>
                <td
                  v-for="c in afterLabelCols"
                  :key="'t-' + c.key"
                  :class="clsOf(c)"
                  :style="nowrapOf(c) ? { 'white-space': 'nowrap' } : null"
                >{{ totals[c.key] !== undefined ? fmtOf(c, totals[c.key]) : '' }}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div v-else class="state-empty">
          {{ hasDateFilters ? '当前日期范围内没有数据。换一个区间试试。' : '这张报表暂时没有数据。' }}
        </div>
      </div>

      <p v-if="note" class="gr-foot">{{ note }}</p>
      <p class="gr-foot gr-foot-dim">
        数据由报表引擎按 <code>report_definitions</code> 里的定义直接查询生成，前端<b>不做任何二次计算</b>；
        所有筛选值都走数据库参数绑定。
      </p>
    </template>
  </div>
</template>

<script setup>
/* 通用报表页（阶段 4 / M3-3，v723）
   ────────────────────────────────────────────────────────────────
   同一个组件服务 /reports/* 下所有配置驱动的报表：列定义、筛选项、合计列、
   口径说明**全部从后端拿**，页面里不写任何一张报表的字段名。

   🔴 三条纪律（都是本项目踩过的坑）：
   1. **未配置 ≠ 没数据**。后端 404 时显示"还没配口径"，不显示空表格 ——
      否则老板会以为生意是 0。
   2. **截断必须说**。后端最多返回 5000 行；少给了就要明写"共 N 行，显示前 5000"，
      不然明细看不全却无从得知。
   3. **合计来自后端**。后端对**完整结果集**做 SUM，所以截断时合计仍是全量。
      前端只用 `totals`，绝不自己对 rows 求和 —— 那样截断时合计会变成"本页合计"，
      而界面上看不出来差别，这是最危险的一类静默错误。

   数据源：GET /api/reports/def/{name}/data（routers/report_engine.py）
   路由：由 router/index.js 按 constants/pages.js::REPORT_PAGES 批量挂载，
        meta.reportName 传参 —— 新增报表只需加一行配置。
*/
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '../../components/Icon.vue'
import Skeleton from '../../components/Skeleton.vue'
import { reportEngineApi } from '../../api/modules'
/* 图表：**复用项目既有组件**（v491 那套，1283 行），不引 echarts/chart.js。
   四个组件接口分两族：
     ChartLine / ChartBar  → labels + series[{name,data}]
     ChartHbar / ChartDonut → items[{label,value}]
   后端返回的是 ERPNext 的 chart 结构（datasets[{name,values}]），在 chartProps 里映射。 */
import ChartLine from '../../components/chart/ChartLine.vue'
import ChartBar from '../../components/chart/ChartBar.vue'
import ChartHbar from '../../components/chart/ChartHbar.vue'
import ChartDonut from '../../components/chart/ChartDonut.vue'

const route = useRoute()

const loading = ref(true)
const err = ref('')
const notConfigured = ref(false)
/* 「本产品没这个模块」与「还没配口径」是两件事（v725）：
   前者是"有这个报表，但你还没用上对应功能"（物料、门店库存上报），
   后者是"有这个报表，但没人写过取数规则"。对老板的判断完全不同 ——
   一个是"这功能我还没用到"，一个是"系统还没做好"。所以分成两个状态。 */
const unavailable = ref(false)
const reason = ref('')
/* v705f（2026-10-31）：无权限查看态。账号角色没有该报表的数据权限时（后端 403），
   显示「无权查看」而非白屏 / "加载失败" —— 二者含义完全不同，用户曾被静默误导。
   后端模块门（module:'reports'）才是真边界，本态只是把"被挡住"这件事说清楚。 */
const denied = ref(false)
const columns = ref([])
const rows = ref([])
const totals = ref({})
const rowCount = ref(0)
const truncated = ref(false)
const maxRows = ref(5000)
const note = ref('')
const elapsedMs = ref(0)
/* 图表数据（v726）。null = 这张报表没配图；{error} = 配了但没画出来。
   两种"没图"必须分开：前者不该出现任何占位，后者必须说清原因。 */
const chart = ref(null)
const title = ref((route.meta && route.meta.title) || '报表')
const subtitle = ref('加载中…')
const filters = ref([])

const dateFrom = ref('')
const dateTo = ref('')
const quick = ref('all')
const showCustom = ref(false)

const name = computed(() => (route.meta && route.meta.reportName) || '')

const dateKeys = computed(() => {
  // 老定义写 `type:'date'`、新定义写 `fieldtype:'Date'`，ft() 两种都认
  return filters.value.filter(f => ft(f) === 'Date').map(f => f.key)
})
const hasDateFilters = computed(() => dateKeys.value.length >= 2)

/* 概览卡：最多 4 张。
   🔴 排序按「金额 → 百分比 → 小数 → 整数」而不是后端给的合计顺序。
   两个理由（都是真机截图逼出来的）：
   ① 「客户利润概览」的合计顺序是 订单数/销量/销售额/成本/毛利/毛利率，
      取前 4 个恰好把**毛利**挤掉 —— 而毛利才是老板打开这张报表要看的数；
   ② 「销售订单汇总」的合计里有「明细行 139,419」，那是条数不是业务量，
      却占了一张卡。按类型排（Int 最后）就能让它自然沉底。 */
const KPI_RANK = { Currency: 0, Percent: 1, Float: 2, Int: 3 }
const kpiCols = computed(() => {
  const ks = Object.keys(totals.value || {})
  if (!ks.length) return []
  const cols = ks.map(k => columns.value.find(x => x.key === k) || { key: k, label: k, fieldtype: 'Float' })
  return cols
    .slice()
    .sort((a, b) => (KPI_RANK[ft(a)] === undefined ? 9 : KPI_RANK[ft(a)]) - (KPI_RANK[ft(b)] === undefined ? 9 : KPI_RANK[ft(b)]))
    .slice(0, 4)
})

const hasTotals = computed(() => Object.keys(totals.value || {}).length > 0)

/* ══════════════════════════════════════════════════════════════════
   图表（v726）

   数据来自后端 `chart` 字段，结构照 ERPNext
   （`dashboard_chart.py:283` 的 `{labels, datasets:[{name, values}]}`）。
   这里只做两件事：选组件、把 datasets 映射成各组件认识的形状。
   **任何聚合都在后端做**（跑在完整结果集上）——
   前端绝不拿 `rows` 自己算，那 5000 行是截断过的。
   ══════════════════════════════════════════════════════════════════ */
const chartComp = computed(() => {
  const t = chart.value && chart.value.type
  if (t === 'line') return ChartLine
  if (t === 'bar') return ChartBar
  if (t === 'hbar') return ChartHbar
  if (t === 'donut') return ChartDonut
  return null
})
const chartCfg = computed(() => chart.value || {})
const chartErr = computed(() => (chart.value && chart.value.error) || '')
/* 有 error 时也要渲染 —— 组件会显示「图没出来 + 原因 + 重试」。
   静默不显示会让人以为这张报表本来就没图。 */
const hasChart = computed(() => !!chartComp.value)
const chartFmt = computed(() => chartCfg.value.fmt || 'money')
const chartSub = computed(() => (rows.value.length ? '共 ' + fmtInt(rowCount.value) + ' 行' : ''))
const chartNote = computed(() => {
  const c = chartCfg.value
  const bits = []
  if (c.unit_hint) bits.push(c.unit_hint)
  if (c.note) bits.push(c.note)
  /* 🔴 折线图纵轴不从 0 起，必须写出来（v726 真机截图逼出来的）：
     1-9 月销售额在 61 万–112 万之间，从 0 起画出来是一条几乎水平的直线 ——
     图就白画了。所以折线改成自动缩放，但**声明**它不从 0 起：
     不声明的话，7% 的波动看起来会像翻了一倍，那是另一种骗人。
     柱状/条形/环形仍然从 0 起 —— 长度和角度编码必须从 0，
     否则"这根柱是那根的两倍长"就是假的。 */
  if (c.type === 'line') bits.push('纵轴未从 0 起（看走势，不用来比绝对高低）')
  return bits.join('；')
})
const chartLabels = computed(() => chartCfg.value.labels || [])
/* 后端给的是 ERPNext 的 `values`，组件要 `data`；两种都认，防以后换形状时炸 */
const chartSeries = computed(() => (chartCfg.value.datasets || []).map(d => ({
  name: d.name || '',
  data: (d.values || d.data || []).map(v => Number(v) || 0),
})))
/* Hbar / Donut 吃 items[{label,value}]：只画第一个系列（多系列画不了饼） */
const chartItems = computed(() => {
  const s = chartSeries.value[0]
  if (!s) return []
  return chartLabels.value.map((lb, i) => ({ label: String(lb), value: Number(s.data[i]) || 0 }))
})
const chartTotal = computed(() => chartItems.value.reduce((a, b) => a + (Number(b.value) || 0), 0))
/* 两族组件的 props 不同，统一在这里拼，模板里 v-bind 一次搞定 */
const chartProps = computed(() => {
  const t = chartCfg.value.type
  if (t === 'hbar') {
    /* nameW 放宽到 168（组件默认 116）：报表现有的商品名动辄 20+ 字
       （「蒙牛低脂高钙原味CD圆周杯90g*16杯*6组（单杯）」），116px 只能露出
       「蒙牛低脂高钙原味CD…」—— 老板认不出是哪个品，排行就白排了。
       走 prop 不改编组件默认值：Dashboard / 返利的横条图标签短，不该跟着变。 */
    return { items: chartItems.value, total: 0, nameW: 168 }
  }
  if (t === 'donut') {
    return { items: chartItems.value, total: chartTotal.value }
  }
  if (t === 'line') {
    // 折线看走势：纵轴不从 0 起（图注已写明），否则 61万→112万 会被压成一条直线
    return { labels: chartLabels.value, series: chartSeries.value, zeroBase: false }
  }
  // 柱子：ChartBar 本身就是零基线（长度编码必须从 0 起），它没有 zeroBase 这个 prop，
  // 不要多传 —— 多传会作为 attribute 落到根元素上
  return { labels: chartLabels.value, series: chartSeries.value }
})

/* 合计行：第一列写「合计（全部 N 行）」，占掉所有**非合计**的前置列 */
const firstTotalIdx = computed(() => {
  if (!hasTotals.value) return -1
  return columns.value.findIndex(c => totals.value[c.key] !== undefined)
})
const labelSpan = computed(() => (firstTotalIdx.value <= 0 ? 1 : firstTotalIdx.value + 1))
const afterLabelCols = computed(() => {
  if (!hasTotals.value) return []
  const i = firstTotalIdx.value
  return i < 0 ? [] : columns.value.slice(i)
})

function fmtInt(v) {
  const n = Number(v || 0)
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

/* 列类型：统一到 ERPNext 的 fieldtype 体系（v725）
   ────────────────────────────────────────────────────────────────
   后端现在按 fieldtype 输出（`Currency` / `Percent` / `Int` …），但 0006/0007 的
   老定义还是 `money` / `num` / `int` 这套。两套都要认 —— 否则老报表的金额列
   会突然失去千分位和右对齐，看起来很像是"报表坏了"。
   所以这里做一次归一化，之后全站只认 fieldtype。 */
const FT_ALIAS = {
  text: 'Data', data: 'Data', string: 'Data',
  int: 'Int', integer: 'Int',
  num: 'Float', number: 'Float', float: 'Float', decimal: 'Float',
  money: 'Currency', currency: 'Currency', amount: 'Currency',
  pct: 'Percent', percent: 'Percent',
  date: 'Date', datetime: 'Datetime',
  select: 'Select', link: 'Link', check: 'Check',
}
const FT_CANON = ['Data', 'Int', 'Float', 'Currency', 'Percent', 'Date', 'Datetime', 'Select', 'Link', 'Check', 'Text']

function ft(c) {
  if (!c) return 'Data'
  const raw = String(c.fieldtype || c.type || 'Data')
  if (FT_ALIAS[raw.toLowerCase()]) return FT_ALIAS[raw.toLowerCase()]
  const found = FT_CANON.find(x => x.toLowerCase() === raw.toLowerCase())
  return found || 'Data'
}

/* 按 fieldtype 格式化。金额带 ¥ 与两位小数；百分比两位；整数不带小数；
   Float 最多两位（数量 3,923,462 这种要保持看得清）。 */
function fmtOf(c, v) {
  if (v === null || v === undefined || v === '') return '—'
  const t = ft(c)
  const n = Number(v)
  switch (t) {
    case 'Currency':
      return isFinite(n)
        ? '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : String(v)
    case 'Int':
      return isFinite(n) ? fmtInt(n) : String(v)
    case 'Float':
      return isFinite(n) ? n.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : String(v)
    case 'Percent':
      return isFinite(n) ? n.toFixed(2) + '%' : String(v)
    case 'Date':
      return String(v).slice(0, 10)
    case 'Datetime':
      return String(v).slice(0, 16).replace('T', ' ')
    default:
      return String(v)
  }
}

function isNumericFt(c) {
  const t = ft(c)
  return t === 'Int' || t === 'Float' || t === 'Currency' || t === 'Percent'
}

/* 对齐：后端会按 fieldtype 给默认 align；老定义没给就在这里兜底，
   否则老报表的金额列会全部左对齐，看起来像是"坏了"。 */
function alignOf(c) {
  if (c && c.align) return c.align
  if (isNumericFt(c)) return 'right'
  const t = ft(c)
  if (t === 'Date' || t === 'Datetime' || t === 'Select' || t === 'Check') return 'center'
  return 'left'
}
function clsOf(c) {
  const a = alignOf(c)
  return a === 'right' ? 'num' : (a === 'center' ? 'gr-c' : '')
}

/* 🔴 数字与日期一律不换行（v725 真机截图抓到）：
   调拨合并后有 9 列，宽度不够时浏览器把「2026-09-23」压成「2026-09-\n23」，
   把金额断在逗号前后 —— 比列宽不齐更难读，而且会让人以为数据坏了。
   文本列（客户/商品/备注）保持可换行，那是它们应有的行为。 */
function nowrapOf(c) {
  const t = ft(c)
  return t === 'Date' || t === 'Datetime' || isNumericFt(c)
}

function cellTitle(c, r) {
  const raw = r[c.key]
  if (raw === null || raw === undefined) return ''
  const shown = fmtOf(c, raw)
  return String(raw) !== shown ? String(raw) : ''
}

function kpiSub(c) {
  return rowCount.value ? '全部 ' + fmtInt(rowCount.value) + ' 行合计' : ''
}

/* ---- 快捷区间 ---- */
function ymd(d) {
  const p = n => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
function setQuickRange(k) {
  const now = new Date()
  if (k === 'all') { dateFrom.value = ''; dateTo.value = ''; return }
  if (k === 'month') {
    dateFrom.value = ymd(new Date(now.getFullYear(), now.getMonth(), 1))
    dateTo.value = ymd(now); return
  }
  if (k === 'lastmonth') {
    const s = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const e = new Date(now.getFullYear(), now.getMonth(), 0)
    dateFrom.value = ymd(s); dateTo.value = ymd(e); return
  }
  if (k === 'year') {
    dateFrom.value = ymd(new Date(now.getFullYear(), 0, 1))
    dateTo.value = ymd(now); return
  }
  const days = Number(k) || 30
  const s = new Date(now.getTime() - (days - 1) * 86400000)
  dateFrom.value = ymd(s); dateTo.value = ymd(now)
}
function onQuick(k) {
  quick.value = k
  showCustom.value = (k === 'custom')
  if (k !== 'custom') {
    setQuickRange(k)
    load()
  }
}

/* ---- 加载 ---- */
async function loadMeta() {
  try {
    const m = await reportEngineApi.defMeta(name.value)
    title.value = m.title || title.value
    if (m.kind === 'unavailable') {
      unavailable.value = true
      reason.value = m.reason || ''
      note.value = m.note || ''
      subtitle.value = '本产品未启用该模块'
      return false
    }
    columns.value = Array.isArray(m.columns) ? m.columns : []
    filters.value = Array.isArray(m.filters) ? m.filters : []
    note.value = m.note || ''
    maxRows.value = m.max_rows || 5000
    subtitle.value = (m.module ? '报表 · ' : '') + '配置驱动'
    return true
  } catch (e) {
    if (e && e.status === 404) {
      notConfigured.value = true
      subtitle.value = '报表定义尚未配置'
      return false
    }
    if (e && e.status === 403) {
      denied.value = true
      subtitle.value = '无权查看该报表'
      return false
    }
    err.value = (e && e.message) || '加载报表定义失败'
    return false
  }
}

async function load() {
  loading.value = true
  err.value = ''
  // 换筛选条件时先清旧图：留着上一段时间的走势图配新表格，是最容易让人读错的一种错
  chart.value = null
  try {
    if (!columns.value.length) {
      const okMeta = await loadMeta()
      if (!okMeta) return
    }
    const qs = new URLSearchParams()
    for (const f of filters.value) {
      const k = f.key
      if (!k) continue
      let v = ''
      if (k === 'date_from') v = dateFrom.value
      else if (k === 'date_to') v = dateTo.value
      else if (f.default !== undefined) v = f.default
      if (v !== '' && v !== null && v !== undefined) qs.set(k, v)
    }
    const d = await reportEngineApi.defData(name.value, qs.toString())
    if (d && d.kind === 'unavailable') {
      unavailable.value = true
      reason.value = d.reason || ''
      note.value = d.note || ''
      subtitle.value = '本产品未启用该模块'
      return
    }
    rows.value = Array.isArray(d.rows) ? d.rows : []
    if (Array.isArray(d.columns) && d.columns.length) columns.value = d.columns
    totals.value = d.totals || {}
    rowCount.value = d.row_count || rows.value.length
    truncated.value = !!d.truncated
    elapsedMs.value = d.elapsed_ms || 0
    note.value = d.note || note.value
    maxRows.value = d.max_rows || maxRows.value
    chart.value = d.chart || null
    subtitle.value = '共 ' + fmtInt(rowCount.value) + ' 行' + (truncated.value ? ' · 已截断' : '')
  } catch (e) {
    if (e && e.status === 404) {
      notConfigured.value = true
      subtitle.value = '报表定义尚未配置'
    } else if (e && e.status === 403) {
      denied.value = true
      subtitle.value = '无权查看该报表'
    } else {
      err.value = (e && e.message) || '加载失败'
      rows.value = []
      totals.value = {}
    }
  } finally {
    loading.value = false
  }
}

/* ---- 导出 CSV（带 BOM，Excel 打开不乱码）---- */
function exportCsv() {
  if (!rows.value.length) return
  const head = ['序号'].concat(columns.value.map(c => c.label))
  const lines = [head.map(csvCell).join(',')]
  rows.value.forEach((r, i) => {
    const line = [String(i + 1)].concat(columns.value.map(c => {
      const v = r[c.key]
      if (v === null || v === undefined) return ''
      if (isNumericFt(c)) {
        const n = Number(v)
        return isFinite(n) ? String(n) : String(v)
      }
      return String(v)
    }))
    lines.push(line.map(csvCell).join(','))
  })
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  const stamp = new Date().toISOString().slice(0, 10)
  a.download = `${title.value}_${stamp}.csv`
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
}
function csvCell(v) {
  const s = String(v === null || v === undefined ? '' : v)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/* 🔴 v723 真机实测抓到的缺陷（本组件复用 29 条路由时必然出现）：
   原来只清了 columns/rows/totals，**没清 title**。
   ⇒ 从「客户销额排名」切到未配置的「汇总报表」时，未配置卡片里写的是
     「「客户销额排名」的具体 SQL 还没写」——**张冠李戴**，而 h2 也跟着错。
   更阴的是它只在「上一张配了、下一张没配」时出现：配了的那张会由 loadMeta 用
   服务端 title 覆盖回来，把问题盖住。所以必须**按页面重置全部展示态**，
   而不是按"看起来会变的那几个字段"重置。 */
function resetForRoute() {
  title.value = (route.meta && route.meta.title) || '报表'
  subtitle.value = '加载中…'
  columns.value = []; rows.value = []; totals.value = {}; filters.value = []
  notConfigured.value = false; err.value = ''
  unavailable.value = false; reason.value = ''
  denied.value = false
  rowCount.value = 0; truncated.value = false; maxRows.value = 5000
  note.value = ''; elapsedMs.value = 0
  // 图也要重置：上一个页面的走势图留下来配新表格，比"没图"更误导（v723 title 同族坑）
  chart.value = null
  dateFrom.value = ''; dateTo.value = ''; quick.value = 'all'; showCustom.value = false
}

/* 同一组件复用于多条路由：路径变化时整套重新加载（否则切页会留着上一张报表的列） */
watch(() => route.fullPath, () => {
  if ((route.meta && route.meta.reportName) !== name.value) return
  resetForRoute()
  load()
})

onMounted(load)
</script>

<style scoped>
.gr-acts { display: flex; gap: 8px; align-items: center; flex-wrap: wrap }
.gr-sel { padding: 4px 8px }
.gr-date {
  padding: 4px 8px; font-size: 12.5px; border-radius: 6px;
  border: 1px solid var(--line, #dcdfe6); background: var(--bg1, #fff); color: var(--t1);
}
.gr-tilde { color: var(--t3); font-size: 12px }
.gr-c { text-align: center }
.gr-card { margin-top: 14px }
/* 图表外壳自带卡片样式，这里只补与明细表之间的间距 */
.gr-fig { margin-top: 14px }
.gr-sec { display: flex; align-items: center; justify-content: space-between; gap: 12px }
.gr-cnt { margin-left: 10px; font-size: 12px; font-weight: 400; color: var(--t3) }
.gr-cost { font-size: 11.5px; color: var(--t3) }
.gr-warn { margin-top: 14px; padding: 12px 14px; border-left: 3px solid var(--warn-amber, #d99a2b); background: var(--bg2) }
.gr-warn-hd { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--war, #b8791a); font-size: 13px }
.gr-warn p { margin: 6px 0 0; font-size: 12px; line-height: 1.9; color: var(--t2) }
.gr-foot { margin: 14px 2px 0; font-size: 12px; line-height: 1.9; color: var(--t2) }
.gr-foot-dim { color: var(--t3) }
.gr-foot code { background: var(--bg2); padding: 1px 5px; border-radius: 4px; font-size: 11px }
.gr-hollow { padding: 28px 24px; max-width: 720px; text-align: center }
.gr-hollow-ic { color: var(--t3); margin-bottom: 6px }
.gr-hollow h3 { font-size: 15px; font-weight: 600; color: var(--t1); margin-bottom: 10px }
.gr-hollow-desc { font-size: 13px; color: var(--t2); line-height: 1.9; margin-bottom: 10px }
.gr-hollow-foot { font-size: 12px; color: var(--t3); line-height: 1.8 }
.gr-hollow code { background: var(--bg2); padding: 1px 5px; border-radius: 4px }
</style>
