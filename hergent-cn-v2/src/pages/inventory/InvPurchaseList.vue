<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div>
        <h2>{{ isReturn ? '采购退货单' : '采购单' }}</h2>
        <span class="page-sub">{{ isReturn ? '退给供应商的退货单据' : '向供应商进货的单据' }}</span>
      </div>
      <div class="ipl-acts">
        <button v-if="canWrite" class="btn btn-primary btn-sm" @click="goNew()">
          <Icon name="plus" :size="14" />{{ isReturn ? '新建采购退货单' : '新建采购单' }}
        </button>
      </div>
    </div>

    <!-- 筛选：常用项一行 + 「更多选项」展开（对齐舟谱工具栏） -->
    <div class="card ipl-filter">
      <div class="ipl-frow">
        <div class="ipl-f ipl-f-kw">
          <label class="ipl-lb">搜索</label>
          <input v-model.trim="f.keyword" class="input ipl-kw"
                 placeholder="单号 / 供应商 / 备注" @keyup.enter="load()" />
        </div>
        <div class="ipl-f">
          <label class="ipl-lb">供应商</label>
          <select v-model.number="f.supplier_id" class="input ipl-sel" @change="load()">
            <option :value="0">全部供应商</option>
            <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
        <div class="ipl-f">
          <label class="ipl-lb">单据日期从</label>
          <input type="date" v-model="f.date_from" class="input ipl-date" @change="load()" />
        </div>
        <div class="ipl-f">
          <label class="ipl-lb">至</label>
          <input type="date" v-model="f.date_to" class="input ipl-date" @change="load()" />
        </div>
        <div class="ipl-fbtns">
          <button class="btn btn-primary btn-sm" :disabled="loading" @click="load()">
            <Icon name="search" :size="14" />查询
          </button>
          <button class="btn btn-ghost btn-sm" @click="resetFilter">重置</button>
          <button class="btn btn-ghost btn-sm" :class="{ on: more }" @click="more = !more">
            更多选项<span class="ipl-caret" :class="{ up: more }"></span>
          </button>
        </div>
      </div>

      <div v-if="more" class="ipl-frow ipl-frow-sub">
        <div class="ipl-f">
          <label class="ipl-lb">入库仓库</label>
          <select v-model.number="f.warehouse_id" class="input ipl-sel" @change="load()">
            <option :value="0">全部仓库</option>
            <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
          </select>
        </div>
        <div v-if="creators.length" class="ipl-f">
          <label class="ipl-lb">创建人</label>
          <select v-model="f.creator" class="input ipl-sel" @change="load()">
            <option value="">全部创建人</option>
            <option v-for="u in creators" :key="u.id" :value="String(u.id)">{{ u.name }}</option>
          </select>
        </div>
        <label class="check-item ipl-chk-mark">
          <input type="checkbox" v-model="f.only_marked" @change="load()" />只看已标记
        </label>
      </div>
    </div>

    <!-- 状态页签（计数来自服务端 counts：忽略状态筛选、保留其它筛选 ⇒ 切页签数字不漂移） -->
    <div v-if="tabs.length > 1" class="main-tabs ipl-tabs">
      <button v-for="t in tabs" :key="t.value || 'all'" class="main-tab"
              :class="{ on: f.status === t.value }" @click="pickTab(t.value)">
        {{ t.text }}<span class="ipl-tabn">{{ t.count }}</span>
      </button>
    </div>

    <!-- 工具栏 -->
    <div class="ipl-tb">
      <div class="ipl-tb-l">
        <button class="btn btn-ghost btn-sm" :disabled="!rows.length" @click="selectAll">全选</button>
        <button class="btn btn-ghost btn-sm" :disabled="!rows.length" @click="invertSel">反选</button>
        <span class="ipl-selinfo">
          已选择 <b>{{ selected.length }}</b> 条
          <button v-if="selected.length" class="ipl-link" @click="selected = []">清空</button>
        </span>
      </div>
      <div class="ipl-tb-r">
        <button class="btn btn-ghost btn-sm" :disabled="!rows.length" @click="doExport">
          <Icon name="download" :size="14" />导出
        </button>
        <button class="btn btn-ghost btn-sm" :disabled="!rows.length" @click="doPrint()">
          <Icon name="print" :size="14" />打印
        </button>
        <div class="ipl-mw">
          <button class="btn btn-ghost btn-sm" :class="{ on: batchOpen }"
                  :disabled="!canWrite" @click.stop="toggleBatch">
            批量操作<span class="ipl-caret" :class="{ up: batchOpen }"></span>
          </button>
          <div v-if="batchOpen" class="ipl-menu" @click.stop>
            <button v-for="a in BATCH_ACTIONS" :key="a.op" class="ipl-mi"
                    :class="{ danger: a.danger }" @click="pickBatch(a)">{{ a.text }}</button>
          </div>
        </div>
        <button v-if="canWrite" class="btn btn-primary btn-sm" @click="goNew()">
          <Icon name="plus" :size="14" />新建
        </button>
      </div>
    </div>

    <!-- 批量结果（逐单回报：失败必须带原因，否则用户无法行动） -->
    <div v-if="lastBatch" class="ipl-result" :class="{ warn: lastBatch.fail_count }">
      <span class="ipl-rsum">
        {{ lastBatch.op_label }}：成功 <b>{{ lastBatch.ok_count }}</b> 张<template v-if="lastBatch.fail_count">，
        失败 <b class="dan">{{ lastBatch.fail_count }}</b> 张</template>
      </span>
      <ul v-if="lastBatch.fails.length" class="ipl-rlist">
        <li v-for="x in lastBatch.fails" :key="x.id">#{{ x.id }} — {{ x.reason || '未说明原因' }}</li>
      </ul>
      <button class="ipl-link" @click="lastBatch = null">知道了</button>
    </div>

    <div v-if="loading" class="state-empty">加载中…</div>

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <div v-else-if="!rows.length" class="card">
      <div class="state-empty">
        <div class="se-ic"><Icon name="inbox" :size="22" /></div>
        <p>{{ hasFilter || f.status ? '当前条件下没有单据。' : '还没有单据。' }}</p>
        <button v-if="canWrite && !isReturn" class="btn btn-primary btn-sm" style="margin-top:12px"
                @click="goNew()">
          <Icon name="plus" :size="14" />新建采购单
        </button>
      </div>
    </div>

    <div v-else class="card ipl-card">
      <div class="table-wrap">
        <table class="tbl ipl-tbl" :class="{ 'print-one': !!printOnly }">
          <thead>
            <tr>
              <th class="ipl-c-chk">
                <input ref="headChk" type="checkbox" :checked="allChecked" title="全选本页" @change="toggleAll" />
              </th>
              <th class="seq-th">序号</th>
              <th class="ipl-c-no">单据编号</th>
              <th class="ipl-c-sup">供应商</th>
              <th class="ipl-c-cat">供应商类别</th>
              <th class="num ipl-c-qty">订单数量</th>
              <th class="ipl-c-wh">仓库</th>
              <th class="ipl-c-st">状态</th>
              <th class="num ipl-c-amt">订单金额</th>
              <th class="num ipl-c-amt">入库金额</th>
              <th class="num ipl-c-pay">已结款</th>
              <th class="num ipl-c-pay">未结款</th>
              <th class="ipl-c-time">审核时间</th>
              <th class="ipl-c-time">单据日期</th>
              <th class="ipl-c-by">创建人</th>
              <th class="ipl-c-note">备注</th>
              <th class="num ipl-c-print">打印数</th>
              <th class="ipl-c-op">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="r.id"
                :class="{ 'print-target': printOnly === r.id, 'ipl-on': selected.includes(r.id) }">
              <td class="ipl-c-chk">
                <input type="checkbox" :value="r.id" v-model="selected" />
              </td>
              <td class="seq-cell"><span class="seq-num">{{ offset + i + 1 }}</span></td>
              <td class="ipl-c-no">
                <a class="ipl-link strong" @click.prevent="go('/inventory/purchase/' + r.id)"
                   :href="'#/inventory/purchase/' + r.id">{{ r.order_no || ('#' + r.id) }}</a>
                <span v-if="r.mark" class="ipl-mark" :title="'标记：' + r.mark">
                  <Icon name="target" :size="12" />
                </span>
              </td>
              <td class="ipl-c-sup">{{ r.supplier_name || '—' }}</td>
              <td class="ipl-c-cat">{{ r.supplier_category || '—' }}</td>
              <td class="num ipl-c-qty">{{ qtyText(r) }}</td>
              <td class="ipl-c-wh">{{ whName(r.warehouse_id) }}</td>
              <td class="ipl-c-st">
                <span class="tag" :class="tagOf(PO_STATUS, r.status)">{{ textOf(PO_STATUS, r.status) }}</span>
              </td>
              <td class="num ipl-c-amt">¥{{ fmtMoney(r.total_amount) }}</td>
              <td class="num ipl-c-amt">{{ moneyOrDash(r, r.received_amount) }}</td>
              <td class="num ipl-c-pay">¥{{ fmtMoney(r.paid_amount) }}</td>
              <td class="num ipl-c-pay">{{ unpaidText(r) }}</td>
              <td class="ipl-c-time">{{ (r.audit_time || '').slice(0, 10) || '—' }}</td>
              <td class="ipl-c-time">{{ (r.order_date || '').slice(0, 10) || '—' }}</td>
              <td class="ipl-c-by">{{ r.creator_name || '—' }}</td>
              <td class="ipl-c-note" :title="r.note || ''">{{ r.note || '—' }}</td>
              <td class="num ipl-c-print">{{ Number(r.print_count || 0) }}</td>
              <td class="ipl-c-op">
                <button class="ipl-link" :disabled="printing" @click="rowPrint(r)">打印</button>
                <button class="ipl-link" :disabled="!canWrite" @click="rowCopy(r)">复制</button>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="8" class="ipl-ft-lb">总计</td>
              <td class="num ipl-ft-num">¥{{ fmtMoney(summary.order_amount) }}</td>
              <td class="num ipl-ft-num">¥{{ fmtMoney(summary.received_amount) }}</td>
              <td class="num ipl-ft-num">¥{{ fmtMoney(summary.paid_amount) }}</td>
              <td class="num ipl-ft-num">¥{{ fmtMoney(summary.unpaid_amount) }}</td>
              <td colspan="6"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="ipl-pager">
        <span class="ipl-pg-cnt">共 {{ total }} 条记录</span>
        <div class="ipl-pg-nums">
          <button class="ipl-pg" :disabled="page <= 1" @click="goPage(page - 1)">‹</button>
          <button v-for="p in pageNums" :key="p" class="ipl-pg" :class="{ on: p === page }"
                  @click="goPage(p)">{{ p }}</button>
          <button class="ipl-pg" :disabled="page >= pageCount" @click="goPage(page + 1)">›</button>
        </div>
        <select v-model.number="limit" class="input ipl-pg-size" @change="goPage(1)">
          <option v-for="s in PAGE_SIZES" :key="s" :value="s">{{ s }} 条/页</option>
        </select>
        <span class="ipl-pg-jump">
          跳至
          <input v-model.number="jumpTo" class="input ipl-pg-in" inputmode="numeric"
                 @keyup.enter="doJump" />
          页
        </span>
      </div>
    </div>

    <!-- 批量操作的输入/确认浮层（标记内容 / 备注内容 / 危险动作确认） -->
    <div v-if="dlg.open" class="ipl-mask" @click.self="closeDlg">
      <div class="card ipl-dlg">
        <div class="ipl-dlg-hd">{{ dlg.title }}</div>
        <p v-if="dlg.msg" class="ipl-dlg-msg">{{ dlg.msg }}</p>
        <input v-if="dlg.needInput" v-model="dlg.value" class="input"
               :placeholder="dlg.ph" @keyup.enter="runDlg" />
        <div class="ipl-dlg-ft">
          <button class="btn btn-ghost btn-sm" :disabled="dlg.busy" @click="closeDlg">取消</button>
          <button class="btn btn-primary btn-sm" :disabled="dlg.busy" @click="runDlg">
            {{ dlg.busy ? '处理中…' : '确定' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 采购单列表 —— 数据源：`GET /api/psi/purchase-orders`（v403 重塑，对齐舟谱采购订单列表）。
   ------------------------------------------------------------------
   🔴 状态一律走 `psiLabels` 的中文映射，**不许出现 `received`/`draft` 这类英文值**。

   🔴 v403 三处**不能靠前端凑**的地方（都由服务端给）：
     1. 状态页签的计数 = 后端 `counts`。它**忽略状态筛选、保留其它筛选** ——
        前端拿当前页数据数一遍的话，切页签时所有数字会跟着变，页签就没意义了。
     2. 「采购单 / 采购退货单」的排除 = 后端 `exclude_status`。旧做法是
        **先分页再从当页 filter 掉 returned** ⇒ 每页少几行、`total` 对不上、翻页跳记录。
        服务端分页 + 客户端过滤必然错位，排除必须在 SQL 里做。
     3. 底部合计 = 后端 `summary`（对**全部匹配行**求和，不是只算当前页）。

   🔴 `has_items=false`（历史舟谱导入单只落了表头）的行：「订单数量 / 入库金额 / 未结款」
      是**真没有数据**，显示 `—` 而不是 `0` —— 后者会被读成「入库了 0 元、一分没欠」，
      是把「不知道」伪装成「是 0」。但「已结款」不躲：`paid_amount` 是库里的真实值，
      0 就是 0，藏起来反而会掩盖一笔真实付款。 */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { psiApi } from '../../api/psi'
import { canDo, toast } from '../../store'
import { PO_STATUS, textOf, tagOf, fmtMoney } from '../../constants/psiLabels'

const router = useRouter()
const route = useRoute()

/* 🔴 v395（2026-10-08）：侧栏「采购单 / 采购退货单」是**同一条 path、不同 query**，
   这里必须读 URL 预置筛选，否则点哪个进去都一样 ⇒ 入口就是假的。
   · `kind=return` → 只看已退货（`status='returned'`）；
   · `kind=order`  → 服务端**排除**已退货（`exclude_status='returned'`）。

   🔴 **必须是 computed + watch，不能在 setup 里取一次常量**（v403 真机探针抓出来的）：
   两个入口共用同一条路由记录 ⇒ 互相切换时 vue-router **复用同一个组件实例**（不会重跑
   `setup`）。写成一次性常量的话，从「采购单」点到「采购退货单」，`kind` 变了而页面纹丝不动
   —— 显示的还是上一批数据，且**零报错**。所以这里用 computed 跟随，并用 watch 重置筛选后重拉。 */
const kind = computed(() => String((route.query && route.query.kind) || ''))
const isReturn = computed(() => kind.value === 'return')
const excludeReturned = computed(() => kind.value === 'order')

const loading = ref(true)
const err = ref('')
const rows = ref([])
const total = ref(0)
const summary = ref({ order_amount: 0, received_amount: 0, paid_amount: 0, unpaid_amount: 0, count: 0 })
const counts = ref({})
const suppliers = ref([])
const warehouses = ref([])
const creators = ref([])

const limit = ref(20)
const offset = ref(0)
const jumpTo = ref('')
const selected = ref([])
const more = ref(false)
const batchOpen = ref(false)
const lastBatch = ref(null)
const printing = ref(false)
const printOnly = ref(0)
const headChk = ref(null)

const PAGE_SIZES = [20, 50, 100]

/** 筛选初值：退货单入口把状态钉在「已退货」（页签条也因此不渲染）。 */
function baseFilter () {
  return {
    status: isReturn.value ? 'returned' : '', supplier_id: 0, date_from: '', date_to: '',
    keyword: '', warehouse_id: 0, creator: '', only_marked: false,
  }
}
const f = ref(baseFilter())

/* 入口切换（采购单 ⇄ 采购退货单）⇒ 筛选归零 + 重拉。 */
watch(kind, () => { f.value = baseFilter(); load() })

const canWrite = computed(() => canDo('inventory', 'create'))
const allChecked = computed(() => rows.value.length > 0 && selected.value.length === rows.value.length)
const hasFilter = computed(() => !!(
  f.value.supplier_id || f.value.date_from || f.value.date_to || f.value.keyword ||
  f.value.warehouse_id || f.value.creator || f.value.only_marked
))
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))
const page = computed(() => Math.floor(offset.value / limit.value) + 1)

/* 状态页签。顺序 = 业务流：草稿 → 待审批 → 已确认 → 已入库 → 部分入库 → 已退货 → 已取消。
   ⚠️ 每个页签都是**一个真实状态值**（1:1），不发明后端不支持/前端拼出来的复合状态。
   零值也照显（舟谱同样显示 `待审核(0)`）——「这一档现在是空的」本身是信息。 */
const TAB_DEFS = [
  { value: '', text: '全部' },
  { value: 'draft', text: '草稿' },
  { value: 'pending_approval', text: '待审批' },
  { value: 'confirmed', text: '已确认' },
  { value: 'received', text: '已入库' },
  { value: 'partial', text: '部分入库' },
  { value: 'returned', text: '已退货' },
  { value: 'cancelled', text: '已取消' },
]
const tabs = computed(() => {
  if (isReturn.value) return []                   // 退货单入口只有一种状态，页签条没有意义
  return TAB_DEFS
    .filter(t => !(excludeReturned.value && t.value === 'returned'))
    .map(t => ({ ...t, count: t.value ? (counts.value[t.value] || 0) : (counts.value.all || 0) }))
})

/* 批量操作菜单（对齐舟谱「批量操作 ▾」展开后的 7 项）。
   `input` = 需要先填内容；`danger` = 有业务后果，先弹确认。 */
const BATCH_ACTIONS = [
  { op: 'print', text: '单据打印' },
  { op: 'note', text: '添加备注', input: 'note', label: '备注内容', ph: '例如：已催货，周五到' },
  { op: 'mark', text: '单据标记', input: 'mark', label: '标记内容', ph: '例如：加急 / 待对账' },
  { op: 'unmark', text: '删除标记' },
  { op: 'approve', text: '单据审核' },
  { op: 'unapprove', text: '单据反审核' },
  { op: 'cancel', text: '单据取消', danger: true },
]

const whMap = computed(() => {
  const m = {}
  warehouses.value.forEach(w => { m[w.id] = w.name })
  return m
})
function whName (id) { return whMap.value[id] || '—' }

function qtyText (r) {
  if (!r.has_items) return '—'
  const q = Number(r.order_qty || 0)
  if (!q) return '0'
  const n = Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100)
  return r.order_unit ? `${n} ${r.order_unit}` : n
}
function moneyOrDash (r, v) { return r.has_items ? `¥${fmtMoney(v)}` : '—' }
/* 未结款 = 入库金额 − 已结款（与舟谱同口径：已结款 + 未结款 = **入库金额**）。
   入库金额未知 ⇒ 未结款也未知 ⇒ `—`（不能用「订单金额 − 已结款」代替：那是把还没入库
   的那部分当成欠款，凭空多算）。 */
function unpaidText (r) {
  if (!r.has_items) return '—'
  return `¥${fmtMoney(Number(r.received_amount || 0) - Number(r.paid_amount || 0))}`
}

async function load (resetPage = true) {
  if (resetPage) offset.value = 0
  loading.value = true
  err.value = ''
  try {
    const p = { ...f.value, limit: limit.value, offset: offset.value }
    if (excludeReturned.value) p.exclude_status = 'returned'
    const d = await psiApi.listPurchases(p)
    rows.value = d.orders || []
    total.value = Number(d.total || 0)
    counts.value = d.counts || {}
    summary.value = d.summary || {}
    selected.value = []          // 换页/换筛选 ⇒ 选择作废（否则会对着看不见的行做批量操作）
    lastBatch.value = null
  } catch (e) {
    err.value = e.message || '采购单读取失败'
  } finally {
    loading.value = false
    await nextTick()
    syncHead()
  }
}

async function loadBase () {
  try {
    const refs = await psiApi.refs('warehouses,suppliers,users', '', 200)
    warehouses.value = refs.warehouses || []
    suppliers.value = refs.suppliers || []
    /* 🔴 创建人下拉的选项必须来自**后端主库 users**（`operator_id` 存的就是用户 id）。
       拿员工档案顶替是错的 —— `users` 与 `hr_employees` 是**两套编号**（实测
       users id=2 是张俊峰、hr_employees id=2 是王老板，id=7 才是张俊峰）⇒ 同一个 id
       会显示成另一个人，选出来的归属是错的却零报错。后端读不到主库时**不返回 `users` 键**，
       这里保持空数组 ⇒ 页面把这一项藏起来（比放一个假下拉诚实）。 */
    creators.value = Array.isArray(refs.users) ? refs.users : []
  } catch (e) {
    // 基础资料拉不到不阻塞列表 —— 但要说出来，不静默
    toast(e.message || '基础资料读取失败', 'error')
  }
}

function resetFilter () { f.value = baseFilter(); load() }
function pickTab (v) { f.value.status = v; load() }
function goNew () {
  router.push(isReturn.value ? '/inventory/purchase/new?kind=return' : '/inventory/purchase/new')
}
function go (p) { router.push(p) }

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

/* ---- 选择 ---- */
function selectAll () { selected.value = rows.value.map(r => r.id) }
function invertSel () {
  const s = new Set(selected.value)
  selected.value = rows.value.map(r => r.id).filter(id => !s.has(id))
}
function toggleAll (e) { selected.value = e.target.checked ? rows.value.map(r => r.id) : [] }
/* 表头复选框的「部分选中」态只能通过 DOM 属性表达（无对应 HTML 属性），
   漏了它会出现「3 选 1 但表头看着像是全选」的误读。 */
function syncHead () {
  if (headChk.value) {
    headChk.value.indeterminate = selected.value.length > 0 && selected.value.length < rows.value.length
  }
}
watch(selected, syncHead, { deep: true })

/* ---- 批量操作 ---- */
const dlg = ref({ open: false, title: '', msg: '', needInput: false, ph: '', value: '', busy: false, action: null })

function toggleBatch () {
  if (!canWrite.value) return
  batchOpen.value = !batchOpen.value
}
function pickBatch (a) {
  batchOpen.value = false
  if (!selected.value.length) { toast('请先勾选要操作的单据', 'warn'); return }
  if (a.input) {
    dlg.value = { open: true, title: `${a.text}（${selected.value.length} 张）`, msg: '',
      needInput: true, ph: a.ph, value: '', busy: false, action: () => runBatch(a.op, { [a.input]: dlg.value.value }) }
    return
  }
  if (a.danger) {
    dlg.value = { open: true, title: `确认${a.text}？`, msg: `将${a.text}已勾选的 ${selected.value.length} 张单据。已入库的单据不会被取消，需要走退货单。`,
      needInput: false, ph: '', value: '', busy: false, action: () => runBatch(a.op, {}) }
    return
  }
  runBatch(a.op, {})
}
function closeDlg () { if (!dlg.value.busy) dlg.value.open = false }
async function runDlg () {
  const fn = dlg.value.action
  if (!fn) return
  dlg.value.busy = true
  try { await fn() } finally { dlg.value.busy = false }
}

async function runBatch (op, extra) {
  const ids = [...selected.value]
  if (!ids.length) { toast('请先勾选要操作的单据', 'warn'); return }
  try {
    const d = await psiApi.batchPurchases(op, ids, extra)
    const fails = (d.results || []).filter(x => !x.ok)
    lastBatch.value = { op_label: d.op_label || op, ok_count: Number(d.ok_count || 0),
      fail_count: Number(d.fail_count || 0), fails }
    dlg.value.open = false
    if (d.fail_count) {
      toast(`${d.op_label}：成功 ${d.ok_count} 张，失败 ${d.fail_count} 张 —— 失败原因见列表上方`, 'warn')
    } else {
      toast(`${d.op_label}完成：${d.ok_count} 张`, 'success')
    }
    await load(false)             // 状态/标记/备注都变了，重拉当前页（计数与合计一并更新）
  } catch (e) {
    toast(e.message || '批量操作失败', 'error')
  }
}

/* ---- 打印（只记数 + 浏览器打印）----
   🔴 「打印数」必须落库：只在前端打印不记数的话刷新就归 0，那一列等于假的。
      真正的打印由 `window.print()` 完成，这里只负责把计数更新到最新值。 */
async function bumpPrint (ids) {
  try {
    const d = await psiApi.batchPurchases('print', ids)
    const c = (d && d.counts) || {}
    rows.value.forEach(r => {
      const v = c[r.id]
      if (v !== undefined && v !== null) r.print_count = v
    })
  } catch (e) {
    toast(e.message || '打印计数未记录', 'error')
  }
}
async function doPrint () {
  const ids = selected.value.length ? [...selected.value] : rows.value.map(r => r.id)
  if (!ids.length) return
  await bumpPrint(ids)
  printOnly.value = 0
  await nextTick()
  window.print()
}
async function rowPrint (r) {
  if (printing.value) return
  printing.value = true
  try {
    await bumpPrint([r.id])
    printOnly.value = r.id
    await nextTick()
    window.print()
    setTimeout(() => { printOnly.value = 0 }, 800)
  } finally {
    printing.value = false
  }
}
function rowCopy (r) { router.push(`/inventory/purchase/new?copy=${r.id}`) }

/* ---- 导出（当前勾选，未勾选则导出当前页）---- */
function csvCell (v) {
  const s = String(v === null || v === undefined ? '' : v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function doExport () {
  const list = selected.value.length
    ? rows.value.filter(r => selected.value.includes(r.id))
    : rows.value
  if (!list.length) return
  const head = ['单据编号', '供应商', '供应商类别', '订单数量', '仓库', '状态', '订单金额',
    '入库金额', '已结款', '未结款', '审核时间', '单据日期', '创建人', '备注', '打印数']
  const body = list.map(r => [
    r.order_no || r.id, r.supplier_name || '', r.supplier_category || '',
    r.has_items ? (Number(r.order_qty || 0) + (r.order_unit ? ` ${r.order_unit}` : '')) : '',
    whName(r.warehouse_id),
    textOf(PO_STATUS, r.status), Number(r.total_amount || 0),
    r.has_items ? Number(r.received_amount || 0) : '',
    Number(r.paid_amount || 0),
    r.has_items ? Number(r.received_amount || 0) - Number(r.paid_amount || 0) : '',
    (r.audit_time || '').slice(0, 10), (r.order_date || '').slice(0, 10),
    r.creator_name || '', r.note || '', Number(r.print_count || 0),
  ])
  const csv = [head, ...body].map(row => row.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `采购单-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/* 分页器的页码窗（当前页居中，最多 7 个） */
const pageNums = computed(() => {
  const n = pageCount.value, cur = page.value
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1)
  let s = Math.max(1, cur - 3)
  s = Math.min(s, n - 6)
  return Array.from({ length: 7 }, (_, i) => s + i)
})

function onDocClick () { batchOpen.value = false }
onMounted(async () => {
  document.addEventListener('click', onDocClick)
  await loadBase()
  await load()
})
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<style scoped>
.inv-page { display: block }
.ipl-acts { display: flex; gap: 8px; flex-wrap: wrap }

/* 筛选 */
.ipl-filter { margin-bottom: 12px }
.ipl-frow { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap }
.ipl-frow-sub { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border-subtle) }
.ipl-f { display: flex; flex-direction: column; gap: 4px }
.ipl-lb { font-size: 12px; color: var(--t3) }
.ipl-f-kw { min-width: 220px }
.ipl-kw { height: 32px }
.ipl-sel { min-width: 150px; height: 32px }
.ipl-date { height: 32px }
.ipl-fbtns { display: flex; align-items: center; gap: 8px; margin-left: auto }
.ipl-chk-mark { align-self: flex-end; height: 32px; margin-left: auto }

/* 「更多选项 / 批量操作」的下拉箭头（无 chevron 图标，用 CSS 三角） */
.ipl-caret {
  width: 0; height: 0; margin-left: 2px;
  border-left: 4px solid transparent; border-right: 4px solid transparent;
  border-top: 5px solid currentColor; transition: transform .15s;
}
.ipl-caret.up { transform: rotate(180deg) }

/* 状态页签：复用全局 .main-tabs / .main-tab，这里只加计数小胶囊 */
.ipl-tabs { flex-wrap: wrap }
.ipl-tabn {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 17px; padding: 0 5px; margin-left: 6px;
  border-radius: 9px; background: var(--bg4); color: var(--t2);
  font-size: 11px; font-weight: 600; line-height: 1;
}
.main-tab.on .ipl-tabn { background: var(--p-bg); color: var(--p-ink) }

/* 工具栏 */
.ipl-tb {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin: 0 0 12px;
}
.ipl-tb-l, .ipl-tb-r { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap }
.ipl-selinfo { font-size: 12px; color: var(--t2) }
.ipl-selinfo b { color: var(--p-ink); font-variant-numeric: tabular-nums }
.ipl-mw { position: relative }
.ipl-menu {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: var(--z-dropdown);
  min-width: 150px; padding: 4px;
  background: var(--bg); border: 1px solid var(--bd); border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}
.ipl-mi {
  display: block; width: 100%; padding: 8px 12px; border: none; background: none;
  border-radius: var(--radius-sm); text-align: left; font-size: 13px; color: var(--t1);
}
.ipl-mi:hover { background: var(--bg2) }
.ipl-mi.danger { color: var(--danger-txt) }
.ipl-mi.danger:hover { background: var(--danger-bg) }

.ipl-link {
  border: none; background: none; padding: 0; font-size: 13px;
  color: var(--p-dark); cursor: pointer;
}
.ipl-link:hover { text-decoration: underline }
.ipl-link.strong { font-weight: 500; font-variant-numeric: tabular-nums }
.ipl-link:disabled { color: var(--t3); cursor: default; text-decoration: none }
.ipl-c-op .ipl-link + .ipl-link { margin-left: 10px }

/* 批量结果条 */
.ipl-result {
  display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap;
  margin: 0 0 12px; padding: 10px 14px;
  border: 1px solid var(--border-subtle); border-left: 3px solid var(--suc);
  border-radius: var(--radius-md); background: var(--bg2); font-size: 13px;
}
.ipl-result.warn { border-left-color: var(--war) }
.ipl-rsum b { font-variant-numeric: tabular-nums }
.ipl-rsum .dan, .ipl-rlist { color: var(--danger-txt) }
.ipl-rlist { margin: 0; padding-left: 18px; width: 100% }
.ipl-result .ipl-link { margin-left: auto }

/* 表格 */
.ipl-card { padding: 0; overflow: hidden }
.ipl-tbl { min-width: 1700px }
.ipl-c-chk { width: 36px; text-align: center }
.ipl-c-no { width: 130px }
/* 供应商/类别名可能很长 ⇒ 省略号，不换行（换行会把行高撑成两行，整表失去节奏） */
.ipl-c-sup { width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ipl-c-cat { width: 96px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.ipl-c-qty { width: 104px }
.ipl-c-wh { width: 88px }
/* 🔴 状态徽标与日期必须 nowrap：窄列下「草稿」「已入库」「2026-07-23」会被折断成两行 */
.ipl-c-st { width: 84px; white-space: nowrap }
.ipl-c-amt { width: 104px }
.ipl-c-pay { width: 96px }
.ipl-c-time { width: 108px; white-space: nowrap }
.ipl-c-by { width: 84px }
.ipl-c-note { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--t2) }
.ipl-c-print { width: 64px }
.ipl-c-op { width: 96px; white-space: nowrap }
.ipl-tbl td.num { font-variant-numeric: tabular-nums }
.ipl-on { background: var(--p-bg) }
.ipl-mark { display: inline-flex; margin-left: 4px; color: var(--war); vertical-align: middle }

.ipl-tbl tfoot td {
  padding: 10px 14px; background: var(--bg2); font-weight: 600;
  border-top: 1px solid var(--bd); font-variant-numeric: tabular-nums;
}
.ipl-ft-lb { text-align: center; color: var(--t1) }
.ipl-ft-num { color: var(--t1) }

/* 分页器（对齐舟谱：共 N 条记录 + 页码 + 每页条数 + 跳至） */
.ipl-pager {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 12px 14px; border-top: 1px solid var(--border-subtle);
}
.ipl-pg-cnt { font-size: 12px; color: var(--t3); margin-right: auto }
.ipl-pg-nums { display: inline-flex; align-items: center; gap: 4px }
.ipl-pg {
  min-width: 28px; height: 28px; padding: 0 6px;
  border: 1px solid var(--bd); border-radius: var(--radius-sm);
  background: var(--bg); color: var(--t1); font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.ipl-pg:hover:not(:disabled) { border-color: var(--p); color: var(--p-dark) }
.ipl-pg:disabled { opacity: .45; cursor: not-allowed }
.ipl-pg.on { background: var(--p-dark); border-color: var(--p-dark); color: #fff }
.ipl-pg-size { width: auto; height: 28px; padding: 0 8px; font-size: 13px; border-radius: var(--radius-sm) }
.ipl-pg-jump { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--t3) }
.ipl-pg-in { width: 52px; height: 28px; padding: 0 6px; text-align: center; border-radius: var(--radius-sm) }

/* 批量操作浮层 */
.ipl-mask {
  position: fixed; inset: 0; z-index: var(--z-modal);
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .35);
}
.ipl-dlg { width: min(400px, 92vw); padding: 18px }
.ipl-dlg-hd { font-size: var(--fs-h4); font-weight: 600; margin-bottom: 10px }
.ipl-dlg-msg { font-size: 13px; color: var(--t2); margin-bottom: 12px }
.ipl-dlg .input { margin-bottom: 14px }
.ipl-dlg-ft { display: flex; justify-content: flex-end; gap: 8px }

/* 打印：只留数据表；单张打印时只留那一行。合计行在打印稿里略去（复选框/操作列被隐藏，
   tfoot 的 colspan 会错位 ⇒ 与其印一行错位的数字，不如不印）。 */
@media print {
  .page-hd, .ipl-filter, .ipl-tabs, .ipl-tb, .ipl-result, .ipl-pager, .ipl-mask { display: none !important }
  .ipl-card { border: none; box-shadow: none }
  .ipl-card .table-wrap { overflow: visible; border: none; border-radius: 0 }
  .ipl-tbl { min-width: 0; width: 100% }
  .ipl-c-chk, .ipl-c-op { display: none !important }
  .ipl-tbl tfoot, .ipl-mark { display: none !important }
  .ipl-tbl.print-one tbody tr:not(.print-target) { display: none !important }
  .ipl-on { background: transparent !important }
}

@media (max-width: 640px) {
  .ipl-frow { align-items: stretch }
  .ipl-f, .ipl-kw, .ipl-sel, .ipl-date { width: 100%; min-width: 0 }
  .ipl-fbtns { margin-left: 0 }
  .ipl-chk-mark { margin-left: 0 }
}
</style>
