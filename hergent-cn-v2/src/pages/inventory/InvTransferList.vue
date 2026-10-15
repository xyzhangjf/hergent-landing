<template>
  <div class="inv-page">
    <!-- v501：页头（`.page-hd` = 大标题 + 副标题 + 新建/刷新）**整块退役**，与采购 /
         销售两页同口径 —— 页面身份收归顶部标签栏（本页单入口，标签标题本来就不冲突）。
         「新建 / 刷新」下移到下方状态页签行右侧（`#actions` 插槽）。 -->

    <!-- 筛选：状态 + 创建日期区间 + 商品关键字（三项均为**后端过滤**，对齐采购/销售列表）。
         ⚠️ 不放「前端 filter」：本页服务端分页，前端过滤只作用于当前页行数 ⇒ 假结果。 -->
    <div class="card isl-filter">
      <div class="psi-frow">
        <!-- v498：「状态**下拉**」删除 —— 改由筛选区下方的**状态页签**承载（共享件
             StatusTabs，与采购 / 销售两页同款）。`TO_OPTIONS` 一并移除（无引用）。 -->
        <div class="psi-f">
          <label class="psi-lb">创建起</label>
          <input type="date" v-model="f.date_from" class="input psi-date" @change="onDateManual" />
        </div>
        <div class="psi-f">
          <label class="psi-lb">创建止</label>
          <input type="date" v-model="f.date_to" class="input psi-date" @change="onDateManual" />
        </div>
        <div class="psi-f psi-f-kw">
          <label class="psi-lb">商品</label>
          <input v-model.trim="f.keyword" class="input psi-kw" placeholder="商品名" @keyup.enter="load()" />
        </div>
        <!-- v496：快捷时间档（规范 §3.3）—— 与采购/销售列表同款五枚 chip；
             手动改上面两个日期框会经 onDateManual 清掉芯片高亮。 -->
        <QuickRangeChips :range="quickRange" @pick="pickRange" />
        <div class="psi-fbtns">
          <button class="btn btn-primary btn-sm" :disabled="loading" @click="load()">
            <Icon name="search" :size="14" />查询
          </button>
          <button class="btn btn-ghost btn-sm" @click="resetFilter">重置</button>
        </div>
      </div>
    </div>

    <!-- v498：状态页签（共享件 StatusTabs）。调拨只有 3 个状态值
         （draft / completed / cancelled；无退货 —— 老板 2026-10-11 口径），故只有三档。
         计数来自服务端 `counts`（`erp_db.transfer_order_counts`，v498 新增）。 -->
    <StatusTabs :tabs="tabs" :model-value="f.status" @pick="pickTab">
      <!-- v510：动作组收进页签行右侧（共享件 PsiListActions），顺序 导出 → 批量操作 → 新建 → 刷新。
           调拨单无批量接口 ⇒ showBatch=false；排序提示经 #status 插槽保留在左侧。 -->
      <template #actions>
        <PsiListActions
          :export-disabled="!rows.length"
          :show-batch="false"
          :show-new="canWrite"
          :new-disabled="!canWrite"
          :new-label="'新建' + title"
          :refresh-disabled="loading"
          @export="doExport"
          @new="() => go(newTo)"
          @refresh="load">
          <template #status>
            <!-- v478：排序显式提示（列被隐藏时表头指示器消失，顺序来历变看不见的状态） -->
            <span v-if="sortKey" class="psi-selinfo psi-sortinfo">
              按<b>{{ sortLabel }}</b>{{ sortDir === 'asc' ? '升序' : '降序' }}
              <button class="isl-link" @click="clearSort">清除</button>
            </span>
          </template>
        </PsiListActions>
      </template>
    </StatusTabs>

    <div v-if="loading" class="state-empty">加载中…</div>

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <div v-else-if="!rows.length" class="card">
      <div class="state-empty">
        <div class="se-ic"><Icon name="refresh" :size="22" /></div>
        <p>{{ hasFilter ? '当前条件下没有调拨单。' : '还没有调拨单。' }}</p>
        <button v-if="canWrite" class="btn btn-primary btn-sm" style="margin-top:12px" @click="go(newTo)">
          <Icon name="plus" :size="14" />新建{{ title }}
        </button>
      </div>
    </div>

    <div v-else class="card isl-card">
      <div class="table-wrap">
        <!-- v496：挂 .psi-tbl（全局固定布局 + nowrap/ellipsis，规范 §2.1）+ colgroup
             定宽（宽度唯一权威）+ 冻结序号/单号两列（--psi-frz-2 = 序号宽），与采购/销售
             列表同款。⚠️ 调拨**没有详情页** ⇒ 单号保持纯文本（有意差异 D6，不造死链接）。 -->
        <table class="tbl isl-tbl psi-tbl" :class="{ 'print-one': !!printOnly }"
               :style="{ '--psi-frz-2': SEQ_W + 'px' }">
          <colgroup>
            <col :style="{ width: SEQ_W + 'px' }" />
            <col v-for="c in visibleCols" :key="'cg-' + c.key" :style="{ width: c.w + 'px' }" />
            <col :style="{ width: OP_W + 'px' }" />
          </colgroup>
          <thead>
            <tr>
              <!-- 齿轮长在序号列表头格子里（与采购/销售列表同一处）。
                   v496：序号列同时是冻结位置 1（psi-frz-1，left:0）。 -->
              <th class="seq-th col-gear-th psi-frz psi-frz-1"><button class="col-cfg gear" @click.stop="openColMenu" title="列设置"><Icon name="settings" :size="15" /></button></th>
              <!-- v478：可排序列 = `SORTABLE`（除「备注」外全可点）。点击三态循环（降 → 升 → 取消），
                   由 `onSort()` 重新拉数据（**服务端排序**，非前端对当前页重排 —— 本页服务端分页，
                   对当前页重排"看着排好了"、一翻页就散架）。
                   指示器：未排 `sort`（中性）→ 升 `arrow-up` → 降 `arrow-down`。
                   v496：单号列同时是冻结位置 2（psi-frz-2，紧贴序号列右侧）。 -->
              <th v-for="c in visibleCols" :key="c.key"
                  :class="[{ num: c.num, 'isl-sh': canSort(c),
                             'psi-frz': c.key === 'order_no', 'psi-frz-2': c.key === 'order_no' }]"
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
                class="isl-row">
              <!-- 序号 = 服务端分页 ⇒ 必须 `offset + i + 1`。
                   v496：冻结位置 1。 -->
              <td class="seq-cell psi-frz psi-frz-1"><span class="seq-num">{{ offset + i + 1 }}</span></td>
              <td v-for="c in visibleCols" :key="c.key"
                  :class="{ num: c.num, 'psi-frz': c.key === 'order_no', 'psi-frz-2': c.key === 'order_no' }">
                <template v-if="c.key === 'order_no'">
                  <span class="isl-no">{{ r.order_no || ('#' + r.id) }}</span>
                </template>
                <template v-else-if="c.key === 'status'">
                  <span class="tag" :class="tagOf(TRANSFER_STATUS, r.status)">{{ textOf(TRANSFER_STATUS, r.status) }}</span>
                </template>
                <template v-else-if="c.key === 'quantity'">{{ r.quantity }}</template>
                <template v-else>{{ cellVal(r, c.key) }}</template>
              </td>
              <td class="isl-op">
                <div class="isl-ops">
                  <button class="isl-op-btn" :disabled="printing" @click.stop="rowPrint(r)">打印</button>
                  <!-- 过账是唯一真后端行内动作（草稿 → 已过账，真正移库）；调拨无退单 / 无取消接口 ⇒ 不摆这两类按钮 -->
                  <button v-if="r.status === 'draft'" class="isl-op-btn isl-op-go" :disabled="busyPost" @click.stop="rowPost(r)">过账</button>
                </div>
              </td>
            </tr>
          </tbody>
          <!-- v511（C）：本页合计 —— 跟随列设置，数量列落值、其余留空。
               后端不返回合计 ⇒ 客户端对当前页可见行求和；明确标注「本页合计」，不是全单。 -->
          <tfoot>
            <tr>
              <td class="psi-frz psi-frz-1 ft-lb">本页合计</td>
              <td v-for="c in visibleCols" :key="'ft-' + c.key"
                  :class="{ num: c.num,
                             'psi-frz': c.key === 'order_no', 'psi-frz-2': c.key === 'order_no' }">
                <template v-if="c.num">{{ pageTotals[c.key] }}</template>
              </td>
              <td class="ft-op"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <ColMenuPanel ref="panel" :col-list="COLS" :is-visible="isVisible" :toggle-col="toggleCol" :reset-cols="resetCols" />

      <!-- v501：分页器换共享件 `PsiPager`（与采购 / 销售两页同一条）。
           只有结构与样式换了：`total` / `pageNums` / `pageCount` 仍由本页 computed 算，
           翻页仍走本页 `goPage`，每页条数候选仍是本页 `PAGE_SIZES`。 -->
      <PsiPager :total="total" :from="pageFrom" :to="pageTo" :page="page"
                :page-nums="pageNums" :page-count="pageCount"
                :limit="limit" :sizes="PAGE_SIZES"
                @go="goPage" @size="onSize" />
    </div>
  </div>
</template>

<script setup>
/* 调拨单列表 —— 数据源：`GET /api/psi/transfer-orders`（真双仓 `transfer_orders` 表）。
   v449+ 新建：此前「调拨单」侧栏入口指向 `/inventory/sale?type=transfer`，那里出来的是
   `sale_orders` 里 `order_type='transfer'` 的**舟谱导入单**（单仓、与真实调拨不是同一批数据）。
   本页才是 `transfer_orders` 的真列表（与 `TransferOrderNew` 同源、归 `inventory` 模块）。

   🔴 与采购 / 销售列表的**有意差异**（不是遗漏、不是缺陷）：
     ① **服务端排序 + 日期/商品筛选**（v478 新增，对齐采购 v470 / 销售 v473）：表头可点击三态
        排序（降→升→取消，SQL 端做、tiebreaker `to_.id DESC`），筛选区新增「创建日期区间 +
        商品名」三项**后端过滤**。默认按后端 `ORDER BY to_.id DESC`（最新在前）。
        ⚠️ 「备注」列**不进**排序白名单（自由文本无意义）⇒ 该列表头不可点 = 有意差异（不是漏做）；
           若强行点会静默回落 id 排序，反而像是"点了没反应"的假控件。
     ② **没有批量操作**：调拨单没有审核流，后端也没有批量接口；造一排点了 404 的按钮才是缺陷。
     ③ **没有打印数**：后端无 `batchTransfers('print')` 这类计数接口，不造前端自增的假计数。
     ④ **行内动作只有「打印 / 过账」**：过账(`POST /complete`)是唯一真后端动作（草稿→已过账，
        真正移库）；调拨无退单、无取消接口 ⇒ 这两类按钮不摆（摆了 = 假控件）。
   除上述四点，本页**逐字复用**采购 / 销售列表的范式：列设置齿轮、服务端分页、导出跟随列设置、
   纯前端打印、空态 / 加载 / 错误态、分页器页码窗，保证三张列表页「看起来、用起来」一致。 */
import { ref, computed, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { useColSettings } from '../../composables/useColSettings.js'
import ColMenuPanel from '../../components/ColMenuPanel.vue'
import { downloadCsv, localDateStamp } from '../../utils/csv'
import { psiApi } from '../../api/psi'
import { canDo, toast } from '../../store'
import { TRANSFER_STATUS, textOf, tagOf } from '../../constants/psiLabels'
import { DOC_PATHS } from './new/docTypes.js'
/* v496：快捷时间档改共享件（进销存列表页统一设计规范 §3.3）—— 与采购/销售列表
   同一套芯片 + 同一套日期算法。 */
import { useQuickRange } from '../../composables/useQuickRange.js'
import QuickRangeChips from '../../components/QuickRangeChips.vue'
/* v498：状态页签共享件（与采购 / 销售两页同一条；样式在 psi-list.css 的 .psi-tabs）。 */
import StatusTabs from '../../components/StatusTabs.vue'
/* v501：分页器共享件（采购 / 销售 / 调拨三页同一条）。 */
import PsiPager from '../../components/PsiPager.vue'
/* v510：动作组共享件（导出 → 批量操作 → 新建 → 刷新；收进页签行右侧）。
   调拨单无批量接口 ⇒ showBatch 传 false。 */
import PsiListActions from '../../components/PsiListActions.vue'

/* 列设置（齿轮）。核心列（单号 / 状态）进本清单 `core:true` ⇒ 不进云端显隐配置、恒显；
   可选列 key 一旦定下就进云端，改名会丢用户已存配置（故保持稳定）。
   v496：每列补 `w`（列宽）—— 表格改 `table-layout:fixed` 后宽度权威在 `<colgroup>`
   （规范 §2.1），与采购/销售列表同构。 */
const COLS = [
  { key: 'order_no',     label: '单号',     core: true, w: 150 },
  { key: 'from_wh',      label: '调出仓',   core: false, w: 130 },
  { key: 'to_wh',        label: '调入仓',   core: false, w: 130 },
  { key: 'product_name', label: '商品',     core: false, w: 180 },
  { key: 'quantity',     label: '数量',     core: false, num: true, w: 80 },
  { key: 'status',       label: '状态',     core: true, w: 84 },
  { key: 'created_at',   label: '创建时间', core: false, w: 140 },
  { key: 'note',         label: '备注',     core: false, w: 160 },
]
const { isVisible, toggleCol, resetCols } = useColSettings('INV-TRANSFER-LIST', COLS)
const visibleCols = computed(() => COLS.filter(c => isVisible(c.key)))
/* v511（C）：客户端「本页合计」—— 后端 `/api/psi/transfer-orders` 不返回合计，
   这里对**当前页可见行**的数值列（数量）求和。⚠️ 是"本页"不是"全单"；明确写「本页合计」。 */
const pageTotals = computed(() => {
  const t = {}
  for (const c of COLS) if (c.num) t[c.key] = 0
  for (const r of rows.value) for (const c of COLS) if (c.num) t[c.key] += Number(r[c.key] || 0)
  return t
})
const panel = ref(null)
function openColMenu (e) { if (panel.value) panel.value.open(e) }
/* v496：序号列宽与全局序号列逐字一致（variables.css `table.tbl th.seq-th{width:46px}`）；
   冻结偏移 `--psi-frz-2` 也用它。操作列 120px = 「打印 + 过账」两枚按钮 + padding 的实测宽度。 */
const SEQ_W = 46
const OP_W = 120

/* ── v478：服务端排序 ──────────────────────────────────────────────────────
   🔴 排序键必须**映射**：列 key（云端列配置主键，不能改）≠ 后端白名单键（`_TRANSFER_ORDER_SQL`）。
      `SORTABLE` ⊆ 后端白名单，缺一个键 = 点了没反应零报错（最难查的一类）。
      `note` 不在 `SORTABLE`（自由文本不排，也不在后端白名单）⇒ 该列表头不点。
   🔴 排序在 SQL 里做：本页服务端分页，前端对当前页重排翻页即散架。
   ⚠️ 排序**不进** `f`：它是"怎么看"不是"看哪些"，混进 `f` 会被带进 `hasFilter`、被重置清掉。 */
const SORT_KEY = {
  order_no: 'order_no',
  product_name: 'product_name',
  quantity: 'quantity',
  status: 'status',
  created_at: 'created_at',
  from_wh: 'from_wh_name',
  to_wh: 'to_wh_name',
}
const SORTABLE = new Set(Object.keys(SORT_KEY))
const sortKey = ref('')
const sortDir = ref('')
function canSort (c) { return SORTABLE.has(c.key) }
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
  // 三态循环：无 → 降序 → 升序 → 无。第一下给**降序**（与"新单在前"默认观感一致）。
  if (sortKey.value !== k) { sortKey.value = k; sortDir.value = 'desc' }
  else if (sortDir.value === 'desc') { sortDir.value = 'asc' }
  else { sortKey.value = ''; sortDir.value = '' }
  load(true)
}
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
const loading = ref(true)
const err = ref('')
const rows = ref([])
const total = ref(0)
const counts = ref({})         // v498：状态页签计数（服务端 counts，见 tabs）
const printing = ref(false)
const printOnly = ref(0)
const busyPost = ref(false)

const PAGE_SIZES = [20, 50, 100, 200]
const limit = ref(50)
const offset = ref(0)
/* v501：`jumpTo` 删除 —— 「跳至」输入框的状态随分页器搬进共享件 `PsiPager`。 */

function baseFilter () { return { status: '', date_from: '', date_to: '', keyword: '' } }
const f = ref(baseFilter())

/* v496：快捷时间档（规范 §3.3，共享 composable）。quickRange 只用于芯片高亮，
   真实值落在 f.date_from/date_to；手动改日期框走 onDateManual 清高亮。 */
const { quickRange, setDateRange, clearDateRange, onDateManual, pickRange } = useQuickRange(f, load)

const title = '调拨单'
const subTitle = '双仓调拨台账（调出仓 → 调入仓）'
const newTo = { path: DOC_PATHS.transferOrder }

const canWrite = computed(() => canDo('inventory', 'create'))
const hasFilter = computed(() => !!(f.value.status || f.value.date_from || f.value.date_to || f.value.keyword))
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))
const page = computed(() => Math.floor(offset.value / limit.value) + 1)
const pageFrom = computed(() => (total.value ? offset.value + 1 : 0))
const pageTo = computed(() => Math.min(offset.value + limit.value, total.value))

/* v498：状态页签档位（替换原「状态下拉」的 `TO_OPTIONS`）。
   ⚠️ 三个档位 = `TRANSFER_STATUS` 的**全部**取值（调拨无退货，老板 2026-10-11 口径）
      ⇒ 不发明第四档；零值照显（「这一档是空的」本身是信息）。 */
const TAB_DEFS = [
  { value: '', text: '全部' },
  { value: 'draft', text: textOf(TRANSFER_STATUS, 'draft') },
  { value: 'completed', text: textOf(TRANSFER_STATUS, 'completed') },
  { value: 'cancelled', text: textOf(TRANSFER_STATUS, 'cancelled') },
]
const tabs = computed(() => TAB_DEFS.map(
  t => ({ ...t, count: t.value ? (counts.value[t.value] || 0) : (counts.value.all || 0) })))
function pickTab (v) { f.value.status = v; load() }

async function load (resetPage = true) {
  if (resetPage) offset.value = 0
  loading.value = true
  err.value = ''
  try {
    const p = { status: f.value.status, limit: limit.value, offset: offset.value }
    /* v478：日期/商品筛选（后端过滤）。空值不加键 ⇒ 后端回落"不筛"。 */
    if (f.value.date_from) p.date_from = f.value.date_from
    if (f.value.date_to) p.date_to = f.value.date_to
    if (f.value.keyword) p.keyword = f.value.keyword
    /* v478：服务端排序。未排序时两个键都不加 ⇒ 后端回落 `to_.id DESC`（旧行为零变化）。 */
    if (sortKey.value) { p.order_by = sortKey.value; p.order_dir = sortDir.value }
    const d = await psiApi.listTransfers(p)
    rows.value = d.rows || []
    /* 🔴 优先用后端 `total`（v449+ 已补的真总数）；旧 `count` 只是本页行数（≤limit），
       用它当总数会让分页器永远只有 1 页。两者都兼容。 */
    total.value = Number(d.total != null ? d.total : d.count || 0)
    /* v498：状态页签计数（后端 v498 起随响应返回；忽略 status、保留日期/关键字筛选
       ⇒ 切页签各档数字不漂移）。拿不到给 `{}` ⇒ 页签显示 0（可降级，不报错）。 */
    counts.value = d.counts || {}
  } catch (e) {
    err.value = e.message || '调拨单读取失败'
  } finally {
    loading.value = false
  }
}

function resetFilter () {
  f.value = baseFilter()
  sortKey.value = ''
  sortDir.value = ''
  quickRange.value = ''          // v496：重置一并清芯片高亮（规范 §3.3）
  load()
}

/* ---- 分页（服务端分页） ---- */
function goPage (p) {
  const n = Math.min(Math.max(1, p), pageCount.value)
  offset.value = (n - 1) * limit.value
  load(false)
}
/* v501：「跳至」输入框随分页器搬进共享件 `PsiPager`，本页 `jumpTo` / `doJump` 随之删除。
   改每页条数必须回到第 1 页（offset 还停在第 N 页而总页数已变 ⇒ 会落在空白页）。 */
function onSize (n) {
  limit.value = n
  goPage(1)
}
const pageNums = computed(() => {
  const n = pageCount.value, cur = page.value
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1)
  let s = Math.max(1, cur - 3)
  s = Math.min(s, n - 6)
  return Array.from({ length: 7 }, (_, i) => s + i)
})

/* ---- 单元格取值（**导出与表格共用同一套口径**，避免「同屏两个说法」）----
   ⚠️ 空值一律返回 '' ⇒ 模板显示 '—'（**不**显示 0 / 「无」）：本仓铁律「没有 ≠ 是零」。 */
function colText (r, k) {
  switch (k) {
    case 'order_no': return r.order_no || ('#' + r.id)
    case 'from_wh': return r.from_wh_name || ''
    case 'to_wh': return r.to_wh_name || ''
    case 'product_name': return r.product_name || ''
    case 'quantity': return Number(r.quantity || 0)
    case 'status': return textOf(TRANSFER_STATUS, r.status)
    case 'created_at': return (r.created_at || '').slice(0, 16)
    case 'note': return r.note || ''
  }
  return ''
}
function cellVal (r, k) {
  const t = colText(r, k)
  return (t === '' || t === null || t === undefined) ? '—' : t
}

/* ---- 导出（跟随列设置，范围 = 当前页全部行）----
   文件名日期戳用 `localDateStamp()`（本地时区，非 UTC）。调拨无行选择 ⇒ 没有「导出勾选」一支。 */
function doExport () {
  const list = rows.value
  if (!list.length) return
  const cols = visibleCols.value
  if (!cols.length) { toast('当前没有可导出的列，请先在列设置里勾选', 'warn'); return }
  const head = cols.map(c => c.label)
  const body = list.map(r => cols.map(c => colText(r, c.key)))
  downloadCsv(`${title}-${localDateStamp()}.csv`, [head, ...body])
}

/* ---- 打印（纯前端 `window.print()`）---- 没有打印数（后端无计数接口）。
   v510：工具栏批量打印入口已移除（与采购 / 销售页同口径），仅保留操作列逐行 `rowPrint`。 */
async function rowPrint (r) {
  if (printing.value) return
  printing.value = true
  try { printOnly.value = r.id; await nextTick(); window.print(); setTimeout(() => { printOnly.value = 0 }, 800) } finally { printing.value = false }
}

/* ---- 过账（草稿 → 已过账，真正移库）---- 唯一真后端行内动作；带确认（动了库存不可逆）。 */
async function rowPost (r) {
  if (busyPost.value || r.status !== 'draft') return
  if (!window.confirm(`确认过账调拨单 #${r.order_no || r.id}？\n\n过账将立刻在调出仓减库存、调入仓加库存，同一事务，不可撤销。`)) return
  busyPost.value = true
  try {
    await psiApi.completeTransfer(r.id)
    toast('调拨单已过账', 'success')
    await load(false)
  } catch (e) {
    toast(e.message || '过账失败', 'error')
  } finally {
    busyPost.value = false
  }
}

function go (p) { router.push(p) }
onMounted(load)
</script>

<style scoped>
/* v511：`.inv-page` 撑满 `.view-wrap` 高度（flex 列），让下方 `.isl-card` 能 flex:1 占满
   剩余空间、再由 `.table-wrap` 自己滚动 ⇒ 表头 / 合计行冻结。三列表页同口径。 */
.inv-page { display: flex; flex-direction: column; min-height: 0; height: 100% }
/* v501：`.isl-acts`（页头动作组）随 `.page-hd` 一起删除 —— 新建 / 刷新已并入页签行右侧。 */
/* 筛选
   🔴 v501：筛选行 / 标签 / 控件尺寸 / 按钮组的样式已上提 `psi-list.css`（`.psi-frow` /
      `.psi-f` / `.psi-lb` / `.psi-sel` / `.psi-date` / `.psi-kw` / `.psi-fbtns`），
      三页唯一出处 ⇒ 这里不再留第二份（原 `.isl-f-kw{margin-left:4px}` 一并删除：
      它只是给商品框补的手动偏移，共享尺寸统一后不再需要）。
      本页只剩筛选卡外壳 `.isl-filter`。 */
.isl-filter { margin-bottom: 12px }
/* 工具栏：v510 工具栏 `.psi-tb` 已退役，动作组收进页签行右侧（共享件 PsiListActions）；
   排序提示（`.psi-selinfo` / `.psi-sortinfo`）经 #status 插槽注入。 */

.isl-card { padding-bottom: 0 }
/* v496：固定布局 + colgroup 定宽（规范 §2.1）。min-width = 序号46 + 八列定宽 + 操作120
   之和（1220px）—— 窄屏由 .table-wrap 横向滚动，列不被内容撑宽。 */
.isl-tbl { min-width: 1220px }
.isl-row { cursor: default }
.isl-no { font-variant-numeric: tabular-nums; font-weight: 500 }
/* v478：可排序列表头 —— 手型 + 指示器（对齐销售列表 v473） */
.isl-tbl thead th.isl-sh { cursor: pointer; user-select: none; white-space: nowrap }
.isl-tbl thead th.isl-sh:hover { color: var(--p-dark) }
.isl-sort-ind { display: inline-flex; vertical-align: middle; margin-left: 3px; color: var(--t3) }
.isl-tbl thead th.isl-sh:hover .isl-sort-ind { color: var(--p-ink) }
.isl-sort-ind svg.ico { width: 12px; height: 12px }
.isl-op { color: var(--p-dark); white-space: nowrap }
/* v496：删 `.isl-op-hd{width:1%}` —— 操作列宽进 colgroup（OP_W=120），宽度唯一权威。 */
.isl-ops { display: inline-flex; align-items: center; gap: 6px }
.isl-op-btn {
  border: 1px solid var(--bd); background: var(--bg); color: var(--p-dark);
  border-radius: var(--radius-sm); padding: 2px 8px; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.isl-op-btn:hover:not(:disabled) { border-color: var(--p); color: var(--p-ink) }
.isl-op-btn:disabled { opacity: .45; cursor: not-allowed }
.isl-op-go { border-color: var(--p); color: var(--p-ink) }

/* 分页器
   🔴 v501：整段删除 —— 改共享件 `PsiPager.vue`，样式随 `psi-list.css` 的 `.psi-pager`。 */

/* 打印：只留数据表；单张打印时只留那一行。 */
@media print {
  /* v501：`.page-hd` 已删除，`.isl-tb` / `.isl-pager` 已换共享件 ⇒ 三者隐藏规则
     都在 `psi-list.css`（三页唯一出处）。这里只留本页外壳。 */
  .isl-filter, .col-menu, .col-menu-overlay { display: none !important }
  .isl-card { border: none; box-shadow: none; padding-bottom: 0 }
  .isl-card .table-wrap { overflow: visible; border: none; border-radius: 0 }
  .isl-tbl { min-width: 0; width: 100%; table-layout: auto }
  .isl-op-hd, .isl-op { display: none !important }
  /* 齿轮按钮必须在纸上消失：它是交互控件，印出来读者点不动。 */
  .isl-tbl thead .col-cfg, .isl-tbl .isl-sort-ind { display: none !important }
  /* v511：本页合计行在打印稿里略去（只印当前页部分行、合计没有全局含义，且冻结列回静态后
     合计行再钉底反而错位）。与采购页 `.ipl-tbl tfoot` 同口径。 */
  .isl-tbl tfoot { display: none !important }
  .isl-tbl.print-one tbody tr:not(.print-target) { display: none !important }
}

/* v501：窄屏规则随共享类一起上提 `psi-list.css`（三页唯一出处）——
   本页已无私有的筛选控件需要窄屏规则，故整段删除。 */
</style>
