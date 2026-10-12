<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div>
        <h2>{{ title }}</h2>
        <span class="page-sub">{{ subTitle }}</span>
      </div>
      <div class="isl-acts">
        <button v-if="canWrite" class="btn btn-primary btn-sm" @click="go(newTo)">
          <Icon name="plus" :size="14" />新建{{ title }}
        </button>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
          <Icon name="refresh" :size="14" />刷新
        </button>
      </div>
    </div>

    <!-- 筛选：常用项一行 + 「更多选项」展开（对齐采购单列表的筛选形态）。
         为什么要把「出货方式 / 客户」收进折叠里：本页有 5 个筛选项挤在同一行，
         小屏会折成三行、把列表推到屏幕外。高频的只有「状态 + 下单日期」。 -->
    <div class="card isl-filter">
      <div class="isl-frow">
        <div class="isl-f">
          <label class="isl-lb">状态</label>
          <select v-model="f.status" class="input isl-sel" @change="load()">
            <option value="">全部状态</option>
            <option v-for="o in SO_OPTIONS" :key="o.value" :value="o.value">{{ o.text }}</option>
          </select>
        </div>
        <div class="isl-f">
          <label class="isl-lb">下单起</label>
          <input type="date" v-model="f.date_from" class="input isl-date" @change="load()" />
        </div>
        <div class="isl-f">
          <label class="isl-lb">下单止</label>
          <input type="date" v-model="f.date_to" class="input isl-date" @change="load()" />
        </div>
        <div class="isl-fbtns">
          <button class="btn btn-primary btn-sm" :disabled="loading" @click="load()">
            <Icon name="search" :size="14" />查询
          </button>
          <button class="btn btn-ghost btn-sm" @click="resetFilter">重置</button>
          <button class="btn btn-ghost btn-sm" :class="{ on: more }" @click="more = !more">
            更多选项<span class="isl-caret" :class="{ up: more }"></span>
          </button>
        </div>
      </div>

      <div v-if="more" class="isl-frow isl-frow-sub">
        <div class="isl-f">
          <label class="isl-lb">出货方式</label>
          <select v-model="f.order_type" class="input isl-sel" @change="load()">
            <option v-for="o in ORDER_TYPE_OPTIONS" :key="o.value" :value="o.value">{{ o.text }}</option>
          </select>
        </div>
        <div class="isl-f">
          <label class="isl-lb">客户</label>
          <select v-model.number="f.customer_id" class="input isl-sel" @change="load()">
            <option :value="0">全部客户</option>
            <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <!-- 🔴 这里**没有**「业务员」筛选，不是漏了：后端 `list_sale` 的 B1 数据隔离对
             `role=='sales'` 会**强制**把 `operator_id` 覆盖成本人（见 `routers/sales.py`）。
             放一个对销售员永远不生效的下拉框，就是造「选了没反应、零报错」的假控件
             —— 正是本仓反复付学费的那类。要加必须先解掉「销售员能不能看同事的单」这个业务问题。 -->
      </div>
    </div>

    <!-- 工具栏。⚠️ 本页**没有**「全选 / 批量操作」——不是遗漏：销售单没有审核流，
         后端也没有任何销售单批量接口（`psiApi.batchPurchases` 只对采购单）。造一排
         点了会 404 的批量按钮才是缺陷。 -->
    <div class="isl-tb">
      <div class="isl-tb-l">
        <span class="isl-selinfo">共 <b>{{ total }}</b> 张</span>
        <!-- v473：当前排序的**显式提示**。为什么必须有：排序键对应的列一旦被「列设置」
             隐藏，表头指示器就跟着消失 —— 顺序的来历就变成**看不见的状态**，用户会以为
             数据是乱的。这里常显「按 X 升/降序」，并给一键清除。 -->
        <span v-if="sortKey" class="isl-selinfo isl-sortinfo">
          按<b>{{ sortLabel }}</b>{{ sortDir === 'asc' ? '升序' : '降序' }}
          <button class="isl-link" @click="clearSort">清除</button>
        </span>
      </div>
      <div class="isl-tb-r">
        <button class="btn btn-ghost btn-sm" :disabled="!rows.length" @click="doExport">
          <Icon name="download" :size="14" />导出
        </button>
        <button class="btn btn-ghost btn-sm" :disabled="!rows.length || printing" @click="doPrint">
          <Icon name="print" :size="14" />打印
        </button>
      </div>
    </div>

    <div v-if="loading" class="state-empty">加载中…</div>

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <div v-else-if="!rows.length" class="card">
      <div class="state-empty">
        <div class="se-ic"><Icon name="receipt" :size="22" /></div>
        <p>{{ hasFilter ? '当前条件下没有销售单。' : '还没有销售单。' }}</p>
        <!-- v449：原来写死 `/inventory/sale/new`（不带 `type`）⇒ 在「车销退单」页签下
             点它会建出一张**自提订单**，而且看不出哪里不对。改成跟页签走（`newTo`），
             文案也跟页头一致（`新建车销退单`），而不是笼统的「新建销售单」。 -->
        <button v-if="canWrite" class="btn btn-primary btn-sm" style="margin-top:12px"
                @click="go(newTo)">
          <Icon name="plus" :size="14" />新建{{ title }}
        </button>
      </div>
    </div>

    <div v-else class="card isl-card">
      <div class="table-wrap">
        <table class="tbl isl-tbl" :class="{ 'print-one': !!printOnly }">
          <thead>
            <tr>
              <!-- 齿轮长在**序号列表头**格子里（§2.6.1：不放工具栏、不放别的表头列） -->
              <th class="seq-th col-gear-th"><button class="col-cfg gear" @click.stop="openColMenu" title="列设置"><Icon name="settings" :size="15" /></button></th>
              <!-- v473：可排序列 = `SORTABLE`。点击三态循环（降 → 升 → 取消），由 `onSort()`
                   重新拉数据（**服务端排序**，不是前端对当前页重排 —— 本页是服务端分页，
                   对当前 50 行重排「看着排好了」，一翻页就散架）。
                   指示器：未排 `sort`（中性 ⇅）→ 升 `arrow-up` → 降 `arrow-down`。 -->
              <th v-for="c in visibleCols" :key="c.key"
                  :class="[{ num: c.num, 'isl-sh': canSort(c) }]"
                  :aria-sort="ariaSortOf(c)"
                  :title="canSort(c) ? '点击排序：降序 → 升序 → 取消' : null"
                  @click="onSort(c)">
                {{ c.label }}<span v-if="canSort(c)" class="isl-sort-ind"><Icon :name="sortInd(c.key)" :size="12" /></span>
              </th>
              <th class="isl-op-hd"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="r.id"
                :class="{ 'print-target': printOnly === r.id }"
                class="isl-row" @click="go('/inventory/sale/' + r.id)">
              <!-- 序号 = 服务端分页 ⇒ 必须 `offset + i + 1`（写 i+1 第 2 页会从 1 重来） -->
              <td class="seq-cell"><span class="seq-num">{{ offset + i + 1 }}</span></td>
              <td v-for="c in visibleCols" :key="c.key" :class="{ num: c.num }">
                <template v-if="c.key === 'order_no'">
                  <span class="isl-no">{{ r.order_no || ('#' + r.id) }}</span>
                </template>
                <template v-else-if="c.key === 'customer'">{{ r.customer_name || '—' }}</template>
                <template v-else-if="c.key === 'total_amount'">¥{{ fmtMoney(r.total_amount) }}</template>
                <template v-else-if="c.key === 'status'">
                  <span class="tag" :class="tagOf(SO_STATUS, r.status)">{{ textOf(SO_STATUS, r.status) }}</span>
                </template>
                <template v-else>{{ cellVal(r, c.key) }}</template>
              </td>
              <td class="isl-op">
                <div class="isl-ops">
                  <button class="isl-op-btn" :disabled="printing" @click.stop="rowPrint(r)">打印</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <ColMenuPanel ref="panel" :col-list="COLS" :is-visible="isVisible" :toggle-col="toggleCol" :reset-cols="resetCols" />

      <div class="isl-pager">
        <span class="isl-pg-cnt">共 {{ total }} 张，第 {{ pageFrom }}–{{ pageTo }} 张</span>
        <div class="isl-pg-nums">
          <button class="isl-pg" :disabled="page <= 1" @click="goPage(page - 1)">‹</button>
          <button v-for="p in pageNums" :key="p" class="isl-pg" :class="{ on: p === page }"
                  @click="goPage(p)">{{ p }}</button>
          <button class="isl-pg" :disabled="page >= pageCount" @click="goPage(page + 1)">›</button>
        </div>
        <select v-model.number="limit" class="input isl-pg-size" @change="goPage(1)">
          <option v-for="s in PAGE_SIZES" :key="s" :value="s">{{ s }} 条/页</option>
        </select>
        <span class="isl-pg-jump">
          跳至
          <input v-model.number="jumpTo" class="input isl-pg-in" inputmode="numeric"
                 @keyup.enter="doJump" />
          页
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 销售单列表 —— 数据源：`GET /api/psi/sale-orders`。
   🔴 「出货方式」（自提 / 调拨 / 车销）筛选是**后端过滤**（v392 给
      `sale_order_list` 追加了 `order_type` 参数）。⚠️ 不要改成前端 filter：
      本页有 2.2 万张单、按页拉 50 行，前端过滤只会作用于当前这一页 ⇒ 用户会看到
      「筛选后还有 50 条」这种假结果。

   v473（2026-10-12）：以**采购单列表页为基准**补齐四项能力（排序 / 导出 / 打印 / 筛选折叠），
   并修掉「下一页是死的」这个既存缺陷。三件事的因果关系值得写下来：
     ① 服务端排序（表头点击 → `order_by` / `order_dir`）**必须先有能用的 offset**，
        否则「第 3 页按金额降序」拿到的是「第 3 页的原始顺序」；
     ② `offset` 原先被 FastAPI **静默丢弃**（`psi.py` 与 `list_sale` 都没声明它），
        所以既有前端的分页按钮一直在改文案、内容却不动；
     ③ 「订单」入口原先在**取回本页 50 行后**用 filter 剔退货行 ⇒ 每页显示不足 50 行而
        `total` 不减。改成服务端 `exclude_status`（同一件事只有一个说法）。
   ⚠️ 「列设置」本页 v432 起已有（`useColSettings` + `ColMenuPanel`），本轮**只扩列**、
      不换组件 —— 换面板会把用户已存的列配置（云端）丢掉一次。 */
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { useColSettings } from '../../composables/useColSettings.js'
import ColMenuPanel from '../../components/ColMenuPanel.vue'
import { downloadCsv, localDateStamp } from '../../utils/csv'
import { psiApi } from '../../api/psi'
import { canDo, toast } from '../../store'
import { SO_STATUS, ORDER_TYPE, ORDER_TYPE_OPTIONS, textOf, tagOf, fmtMoney } from '../../constants/psiLabels'
/* v449：`legacySalePath(type, kind)` 把旧入口的 `?type=&kind=` 解析成**拆分后的独立建单页**
   路径（未知组合 / 调拨退单落自提订单，并 `console.warn`）。列表页「＋」直接用它，
   不必再绕一圈旧路径 `/inventory/sale/new`（那条现在只是给旧书签用的重定向）。 */
import { legacySalePath } from './new/docTypes.js'

/* 🔴 列设置（齿轮）：替换「序号」表头，可选列默认全开，核心列恒显。
   v473：核心列（单号 / 客户 / 金额 / 状态）**进了本清单** —— 表头从写死的 `<th>` 改成
   `v-for="visibleCols"`，排序与导出都需要每列有稳定的 `key`。
   ⚠️ 加进 `core` 的列**不会**进 `colVis`（`useColSettings` 只给非 core 键建项）⇒ 云端
      已存的列配置（`{otype, odate, ddate}`）**逐字不受影响**，用户调过的显隐不丢。
   ⚠️ 可选列的 key 保持 `otype` / `odate` / `ddate` 不改名：它们 v449 就落云端了，改名等于
      把用户调好的配置静默丢一次（云端那份认不出新键 ⇒ 全按默认开）。后端排序键不同名，
      由下面 `SORT_KEY` 显式映射。 */
const COLS = [
  { key: 'order_no',     label: '单号',     core: true },
  { key: 'customer',     label: '客户',     core: true },
  { key: 'total_amount', label: '金额',     core: true,  num: true },
  { key: 'status',       label: '状态',     core: true },
  { key: 'otype',        label: '出货方式', core: false },
  { key: 'odate',        label: '下单日期', core: false },
  { key: 'ddate',        label: '交货日期', core: false },
]
const { isVisible, toggleCol, resetCols } = useColSettings('INV-SALE-LIST', COLS)
const visibleCols = computed(() => COLS.filter(c => isVisible(c.key)))
const panel = ref(null)
function openColMenu (e) { if (panel.value) panel.value.open(e) }

/* ── v473：服务端排序 ──────────────────────────────────────────────────────
   🔴 为什么排序键要**映射**而不是直接用列 key：列 key（`otype`/`odate`/`ddate`）是
      云端列配置的主键，不能动（见上）；而后端白名单 `_SO_ORDER_SQL` 用的是库里的**列名**
      （`order_type` / `order_date` / `delivery_date`）。两边各自命名、这里显式对上。
   🔴 `SORTABLE` 与后端 `_SO_ORDER_SQL` 必须**逐键一致**（前端 ⊆ 后端）。后端对未登记键
      会**静默回落 `so.id DESC`** ⇒ 少登记一个键的症状是「这一列点了没反应、零报错」，
      最难查的一类。后端侧取证脚本：`.workbuddy/tools/v473-so-order-sort-probe.py`。
   ⚠️ 排序**不进** `f`（筛选对象）：它是"怎么看"不是"看哪些" —— 混进筛选会被带进
      `hasFilter`（空结果文案会答错）、也会被「重置」清掉（用户等于白点）。 */
const SORT_KEY = {
  order_no: 'order_no',
  customer: 'customer',
  total_amount: 'total_amount',
  status: 'status',
  otype: 'order_type',
  odate: 'order_date',
  ddate: 'delivery_date',
}
const SORTABLE = new Set(Object.keys(SORT_KEY))
const sortKey = ref('')          // 后端键（如 `total_amount`）
const sortDir = ref('')          // '' | 'asc' | 'desc'
function canSort (c) { return SORTABLE.has(c.key) }
/** 表头指示器图标：未排 → 中性 `sort`（提示"这列能点"）；已排 → 升/降箭头。 */
function sortInd (colKey) {
  const k = SORT_KEY[colKey]
  if (!k || sortKey.value !== k) return 'sort'
  return sortDir.value === 'asc' ? 'arrow-up' : 'arrow-down'
}
function ariaSortOf (c) {
  if (!canSort(c) || sortKey.value !== SORT_KEY[c.key]) return 'none'
  return sortDir.value === 'asc' ? 'ascending' : 'descending'
}
function onSort (c) {
  if (!canSort(c)) return
  const k = SORT_KEY[c.key]
  // 三态循环：无 → 降序 → 升序 → 无。第一下给**降序**（与"新单在前"的默认观感一致）。
  if (sortKey.value !== k) { sortKey.value = k; sortDir.value = 'desc' }
  else if (sortDir.value === 'desc') { sortDir.value = 'asc' }
  else { sortKey.value = ''; sortDir.value = '' }
  load(true)
}
/* 排序提示里的列名：由后端键反查列 label。取不到（列定义被删）就退回键名 —— 不显示
   「未知列」这种编出来的字，但也不能什么都不显示（那又成了看不见的状态）。 */
const sortLabel = computed(() => {
  const k = sortKey.value
  if (!k) return ''
  const col = COLS.find(c => SORT_KEY[c.key] === k)
  return col ? col.label : k
})
function clearSort () {
  sortKey.value = ''
  sortDir.value = ''
  load(true)
}

const router = useRouter()
const route = useRoute()

/* 🔴 v395（2026-10-08，v473 改为**响应式**）：单据类型**从 URL 读** —— 侧栏「自提订单 /
   自提退单 / 车销订单 / 车销退单 / 调拨单」五个入口是**同一条 path、不同 query**。
   v473 之前这一段是 setup 里的一次性常量 ⇒ **同 path 换 query 时组件被复用、
   `onMounted` 不再跑**，点侧栏另一个入口页面纹丝不动（零报错，最难查的一类）。
   改成 computed + `watch` 后，五个入口**逐一切换都真的重新筛选**（与采购单页 `watch(kind)` 同款）。
   · `type` → 出货方式（`ORDER_TYPE` 的键）；未知值忽略（不许把脏 query 带进筛选）；
   · `kind=return` → 该出货方式 **且 状态=退货**（服务端 `status='returned'`）；
   · `kind=order` → 服务端**排除**退货行（`exclude_status='returned'`）。 */
const _qType = computed(() => String((route.query && route.query.type) || ''))
const _qKind = computed(() => String((route.query && route.query.kind) || ''))
const _kindOrder = computed(() => _qKind.value === 'order')

const loading = ref(true)
const err = ref('')
const rows = ref([])
const total = ref(0)
const customers = ref([])
const more = ref(false)
const printing = ref(false)
const printOnly = ref(0)

/* 分页：服务端分页，`limit` 可调（默认 50 = v473 之前的固定值 ⇒ 首屏观感不变）。 */
const PAGE_SIZES = [20, 50, 100, 200]
const limit = ref(50)
const offset = ref(0)
const jumpTo = ref('')

/* 筛选初值随入口变（见上方 URL 读取口径） */
function baseFilter () {
  return {
    status: _qKind.value === 'return' ? 'returned' : '',
    order_type: ORDER_TYPE[_qType.value] ? _qType.value : '',
    customer_id: 0, date_from: '', date_to: '',
  }
}
const f = ref(baseFilter())

/* 页头随入口变（自提订单 / 车销退单 / 调拨单 …）—— 让人一眼确认筛选真的生效了，
   而不是点五个入口都看到同一张「销售单」。 */
const title = computed(() => {
  const t = f.value.order_type ? textOf(ORDER_TYPE, f.value.order_type, '') : ''
  const k = _qKind.value === 'return' ? '退单' : (_qKind.value === 'order' ? '订单' : '')
  return t ? `${t}${k}` : '销售单'
})
const subTitle = computed(() => title.value === '销售单'
  ? '出货台账' : `按「${title.value}」筛选的出货台账`)
/* 「＋」直达**本入口对应的那张独立建单页**（v449 拆页）。
   · 不再带 `?type=&kind=` 进新建页 —— 每个独立页面已经从 `DOC_TYPE` 常量知道自己是哪种单据，
     再手选一次反而会让人以为「进错了可以改」。
   · `transfer|return` 不给落点（调拨没有退单，老板拍板）⇒ 由 `legacySalePath` 兜到自提订单
     并打 `console.warn`，与旧链接的处理口径完全一致。 */
const newTo = computed(() => ({ path: legacySalePath(_qType.value, _qKind.value) }))

const canWrite = computed(() => canDo('inventory', 'create'))
const hasFilter = computed(() => !!(f.value.status || f.value.order_type || f.value.customer_id
  || f.value.date_from || f.value.date_to))
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))
const page = computed(() => Math.floor(offset.value / limit.value) + 1)
const pageFrom = computed(() => (total.value ? offset.value + 1 : 0))
const pageTo = computed(() => Math.min(offset.value + limit.value, total.value))

const SO_OPTIONS = ['draft', 'confirmed', 'delivered', 'signed', 'rejected', 'returned', 'cancelled']
  .map(v => ({ value: v, text: textOf(SO_STATUS, v) }))

/* 未知出货方式也必须是中文（不许回落英文值） */
function orderTypeText (v) { return textOf(ORDER_TYPE, v, '未标注') }

async function load (resetPage = true) {
  if (resetPage) offset.value = 0
  loading.value = true
  err.value = ''
  try {
    const p = { ...f.value, limit: limit.value, offset: offset.value }
    /* v473：排序（服务端）。未排序时这两个键**一个都不加** ⇒ 后端回落 `so.id DESC`，
       与 v473 之前逐字一致（老行为零变化）。 */
    if (sortKey.value) { p.order_by = sortKey.value; p.order_dir = sortDir.value }
    /* v473：「订单」入口排除退货行改由**服务端**做（原先是对本页 50 行 filter ⇒ 每页
       显示不足 50 行而 `total` 不减）。 */
    if (_kindOrder.value) p.exclude_status = 'returned'
    const [d, refs] = await Promise.all([
      psiApi.listSales(p),
      customers.value.length ? Promise.resolve(null) : psiApi.refs('customers', '', 200),
    ])
    rows.value = d.orders || []
    total.value = Number(d.total || 0)
    if (refs && Array.isArray(refs.customers)) customers.value = refs.customers
  } catch (e) {
    err.value = e.message || '销售单读取失败'
  } finally {
    loading.value = false
  }
}

function resetFilter () {
  f.value = { status: '', order_type: '', customer_id: 0, date_from: '', date_to: '' }
  sortKey.value = ''
  sortDir.value = ''
  load()
}

/* 入口切换（自提订单 ⇄ 自提退单 ⇄ 车销退单 …）⇒ 筛选归零 + 重拉。**排序也一并归零**：
   同一个排序键在两个视图里可能语义不同，带着它过去会让新视图一进来就是"莫名其妙的顺序"。
   ⚠️ 必须 `watch` 而不是 setup 里读一次：五个入口是**同 path 不同 query**，组件会被复用。 */
watch([_qType, _qKind], () => {
  f.value = baseFilter()
  sortKey.value = ''
  sortDir.value = ''
  load()
})

/* ---- 分页 ---- */
function goPage (p) {
  const n = Math.min(Math.max(1, p), pageCount.value)
  offset.value = (n - 1) * limit.value
  load(false)
}
function doJump () {
  const n = parseInt(jumpTo.value, 10)
  jumpTo.value = ''
  if (!Number.isFinite(n)) return
  goPage(n)
}
/* 分页器的页码窗（当前页居中，最多 7 个） */
const pageNums = computed(() => {
  const n = pageCount.value, cur = page.value
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1)
  let s = Math.max(1, cur - 3)
  s = Math.min(s, n - 6)
  return Array.from({ length: 7 }, (_, i) => s + i)
})

/* ---- 单元格取值（**导出与表格共用同一套口径**，避免「同屏两个说法」）----
   ⚠️ 空值一律 `''` ⇒ 模板显示 `—`（**不**显示 `0` / 「无」）：本仓铁律「没有 ≠ 是零」。 */
function colText (r, k) {
  switch (k) {
    case 'order_no': return r.order_no || ('#' + r.id)
    case 'customer': return r.customer_name || ''
    case 'total_amount': return Number(r.total_amount || 0)
    case 'status': return textOf(SO_STATUS, r.status)
    case 'otype': return orderTypeText(r.order_type)
    case 'odate': return (r.order_date || '').slice(0, 10)
    case 'ddate': return (r.delivery_date || '').slice(0, 10)
  }
  return ''
}
function cellVal (r, k) {
  const t = colText(r, k)
  return (t === '' || t === null || t === undefined) ? '—' : t
}

/* ---- 导出（当前页 / 跟随列设置）----
   🔴 导出**跟随列设置**（顺序 + 显隐）—— 表里看到什么就导出什么。写死一份固定列会出现
      「表里没有的列被导出」与「表里有的列导不出」两个说法，而「同屏两个说法互相打脸」
      正是本仓一类专项缺陷。取值一律走 `colText`（唯一口径）。
   ⚠️ 本页**没有**行选择（后端无销售单批量接口，见工具栏注释）⇒ 「导出勾选」这一支不存在，
      导出范围 = 当前页全部行。这一点必须在按钮的 `title` 里说清，否则用户会以为
      导出的是「筛选后的 2.2 万张」。
   ⚠️ CSV 的转义 / BOM / 文件名日期戳走 `utils/csv.js`（v408 上提的唯一实现）——
      文件名日期戳用 `localDateStamp()`（**本地时区**），不用 `toISOString()`：后者是 UTC，
      北京时间凌晨 0–8 点导出的文件会标成前一天，用户按文件名归档会以为导错了。 */
function doExport () {
  const list = rows.value
  if (!list.length) return
  const cols = visibleCols.value
  if (!cols.length) { toast('当前没有可导出的列，请先在列设置里勾选', 'warn'); return }
  const head = cols.map(c => c.label)
  const body = list.map(r => cols.map(c => colText(r, c.key)))
  downloadCsv(`${title.value}-${localDateStamp()}.csv`, [head, ...body])
}

/* ---- 打印（浏览器打印，纯前端）----
   🔴 与采购单列表的**唯一差异**：采购单有「打印数」列（后端 `batchPurchases('print')` 记数），
      销售单**没有**这个后端能力 ⇒ 这里不调任何接口、也不显示打印数。⛔ 不要为了"对齐"
      造一个前端自增的假计数：刷新即归零，那一列等于假的。
   打印由 `window.print()` 完成，`@media print` 决定纸上留什么（见文件末）。 */
async function doPrint () {
  if (printing.value) return
  printing.value = true
  try {
    printOnly.value = 0
    await nextTick()
    window.print()
  } finally {
    printing.value = false
  }
}
async function rowPrint (r) {
  if (printing.value) return
  printing.value = true
  try {
    printOnly.value = r.id
    await nextTick()
    window.print()
    setTimeout(() => { printOnly.value = 0 }, 800)
  } finally {
    printing.value = false
  }
}
function go (p) { router.push(p) }
onMounted(load)
</script>

<style scoped>
.inv-page { display: block }
.isl-acts { display: flex; gap: 8px; flex-wrap: wrap }
.isl-filter { margin-bottom: 12px }
.isl-frow { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap }
.isl-frow-sub { margin-top: 12px }
.isl-f { display: flex; flex-direction: column; gap: 4px }
.isl-lb { font-size: 12px; color: var(--t3) }
.isl-sel { min-width: 130px; height: 32px }
.isl-date { height: 32px }
.isl-fbtns { display: flex; align-items: center; gap: 8px; margin-left: auto }

/* 「更多选项」的下拉箭头（无 chevron 图标，用 CSS 三角） */
.isl-caret {
  width: 0; height: 0; margin-left: 2px;
  border-left: 4px solid transparent; border-right: 4px solid transparent;
  border-top: 5px solid currentColor; transition: transform .15s;
}
.isl-caret.up { transform: rotate(180deg) }

/* 工具栏：左「共 N 张 + 排序说明」，右「导出 / 打印」 */
.isl-tb {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin: 0 0 12px;
}
.isl-tb-l, .isl-tb-r { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap }
.isl-selinfo { font-size: 12px; color: var(--t2) }
.isl-selinfo b { color: var(--p-ink); font-variant-numeric: tabular-nums }
.isl-sortinfo { display: inline-flex; align-items: center; gap: 4px }
.isl-link {
  border: none; background: none; padding: 0 2px; cursor: pointer;
  color: var(--p-dark); font-size: 12px; text-decoration: underline;
}

.isl-card { padding-bottom: 0 }
.isl-row { cursor: pointer }
.isl-no { font-variant-numeric: tabular-nums }
.isl-op { color: var(--p-dark); white-space: nowrap }
.isl-op-hd { width: 1% }
/* 行内操作按钮（v473：单张打印）。⚠️ 销售单**没有**审核 / 取消 / 复制这类行内动作
   —— 后端没有对应接口，摆出来就是点了会报错的假按钮。 */
.isl-ops { display: inline-flex; align-items: center; gap: 6px }
.isl-op-btn {
  border: 1px solid var(--bd); background: var(--bg); color: var(--p-dark);
  border-radius: var(--radius-sm); padding: 2px 8px; font-size: 12px; cursor: pointer;
  white-space: nowrap;
}
.isl-op-btn:hover:not(:disabled) { border-color: var(--p); color: var(--p-ink) }
.isl-op-btn:disabled { opacity: .45; cursor: not-allowed }

/* v473：可排序列的表头 —— 手型 + 指示器 */
.isl-tbl thead th.isl-sh { cursor: pointer; user-select: none; white-space: nowrap }
.isl-tbl thead th.isl-sh:hover { color: var(--p-dark) }
.isl-sort-ind { display: inline-flex; vertical-align: middle; margin-left: 3px; color: var(--t3) }
.isl-tbl thead th.isl-sh:hover .isl-sort-ind { color: var(--p-ink) }
.isl-sort-ind svg.ico { width: 12px; height: 12px }

.isl-pager {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 12px 14px; border-top: 1px solid var(--border-subtle);
}
.isl-pg-cnt { font-size: 12px; color: var(--t3); margin-right: auto }
.isl-pg-nums { display: inline-flex; align-items: center; gap: 4px }
.isl-pg {
  min-width: 28px; height: 28px; padding: 0 6px;
  border: 1px solid var(--bd); border-radius: var(--radius-sm);
  background: var(--bg); color: var(--t1); font-size: 13px;
  cursor: pointer; font-variant-numeric: tabular-nums;
}
.isl-pg:hover:not(:disabled) { border-color: var(--p); color: var(--p-dark) }
.isl-pg:disabled { opacity: .45; cursor: not-allowed }
.isl-pg.on { background: var(--p-dark); border-color: var(--p-dark); color: #fff }
.isl-pg-size { width: auto; height: 28px; padding: 0 8px; font-size: 13px; border-radius: var(--radius-sm) }
.isl-pg-jump { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--t3) }
.isl-pg-in { width: 52px; height: 28px; padding: 0 6px; text-align: center; border-radius: var(--radius-sm) }

/* 打印：只留数据表；单张打印时只留那一行。 */
@media print {
  .page-hd, .isl-filter, .isl-tb, .isl-pager, .col-menu, .col-menu-overlay { display: none !important }
  .isl-card { border: none; box-shadow: none; padding-bottom: 0 }
  .isl-card .table-wrap { overflow: visible; border: none; border-radius: 0 }
  /* 打印稿一次性摊开 ⇒ 回到 auto 布局按纸张宽度收缩 */
  .isl-tbl { min-width: 0; width: 100%; table-layout: auto }
  .isl-op-hd, .isl-op { display: none !important }
  /* 🔴 齿轮按钮与排序指示器必须在纸上消失：它们是**交互控件/状态**，印出来读者点不动，
     只会以为"这列坏了"。采购单列表的 print CSS 漏了这一条（齿轮会随序号列印到纸上），
     本页不复制该瑕疵。 */
  .isl-tbl thead .col-cfg, .isl-tbl .isl-sort-ind { display: none !important }
  .isl-tbl.print-one tbody tr:not(.print-target) { display: none !important }
}

@media (max-width: 640px) {
  .isl-frow { align-items: stretch }
  .isl-f, .isl-sel, .isl-date { width: 100%; min-width: 0 }
  .isl-fbtns { margin-left: 0 }
}
</style>
