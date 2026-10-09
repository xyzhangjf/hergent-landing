<template>
  <!-- 采购结算单（v408 P1-9）—— 一个供应商 + 一段时间，把若干已入库采购单（应付）
       与退货单（冲减）汇总成一张**对账单**。

       🔴 三个「不是」，写在这里免得后面被当成漏：
         · 不是**发票**（`ap_invoices` 是票，带税额与三单匹配，生产 0 行）；
         · 不是**付款**（付款走采购单详情的「登记付款」，本页**不碰钱**）；
         · 不是**应付台账**（`receivables` 每张采购单一行那个）。
       结算单只到「已确认」—— 「对账」与「出纳」是两件事，让一张单同时做两件事，
       同一笔钱就会有两条写入路径，迟早对不上。

       🔴 金额一律是**快照**：明细里的金额是「加进来那一刻」的源单金额，
         源单后来改了这里不变（对账单是历史事实）。界面**不许**拿源单现价去"校正"。 -->
  <div class="inv-page ips-page">
    <div class="ips-hd">
      <div>
        <h2 class="ips-title">采购结算</h2>
        <p class="ips-sub">按供应商汇总一段时间内的入库与退货，和供应商对账确认应付金额。</p>
      </div>
      <div class="ips-hd-acts">
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
          <Icon name="refresh" :size="14" />刷新
        </button>
        <button class="btn btn-primary btn-sm" :disabled="!canWrite" @click="openNew()">
          <Icon name="plus" :size="14" />新建结算单
        </button>
      </div>
    </div>

    <div class="card ips-filter">
      <label class="ips-fl">供应商
        <select v-model.number="f.supplier_id" class="input" @change="goPage(1)">
          <option :value="0">全部供应商</option>
          <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <label class="ips-fl">状态
        <select v-model="f.status" class="input" @change="goPage(1)">
          <option v-for="o in SETTLEMENT_STATUS_OPTIONS" :key="o.value" :value="o.value">{{ o.text }}</option>
        </select>
      </label>
    </div>

    <div v-if="loading" class="card"><div class="state-empty"><p>加载中…</p></div></div>
    <div v-else-if="err" class="card">
      <div class="state-empty">
        <div class="se-ic"><Icon name="alert" :size="22" /></div>
        <p>{{ err }}</p>
        <button class="btn btn-ghost btn-sm" style="margin-top:12px" @click="load()">重试</button>
      </div>
    </div>
    <div v-else-if="!rows.length" class="card">
      <div class="state-empty">
        <div class="se-ic"><Icon name="inbox" :size="22" /></div>
        <p>还没有结算单。</p>
        <button v-if="canWrite" class="btn btn-primary btn-sm" style="margin-top:12px" @click="openNew()">
          <Icon name="plus" :size="14" />新建结算单
        </button>
      </div>
    </div>

    <div v-else class="card ips-card">
      <div class="table-wrap">
        <table class="tbl ips-tbl">
          <!-- 列宽**权威来源**（table-layout:fixed ⇒ 声明值即硬值）。
               ⛔ 别在 scoped CSS 里再给这些列写 width —— 那就是第二个真相来源。 -->
          <colgroup>
            <col :style="{ width: SEQ_W + 'px' }" />
            <col v-for="c in visibleCols" :key="'cg-' + c.key" :style="{ width: c.w + 'px' }" />
            <col :style="{ width: OP_W + 'px' }" />
          </colgroup>
          <thead>
            <tr>
              <!-- 🔴 §2.6.1「一、」：齿轮长在**序号列表头**格子里、是该格**唯一**的按钮，
                   包在 `.th-in` 里。⛔ 不放工具栏、⛔ 不放别的表头列。 -->
              <th class="seq-th">
                <div class="th-in">
                  <button class="col-cfg gear" @click.stop="toggleColMenu" title="列设置"><Icon name="settings" /></button>
                </div>
              </th>
              <th v-for="c in visibleCols" :key="c.key" :class="[{ num: c.num }]">{{ c.label }}</th>
              <th class="ips-c-op">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="r.id">
              <!-- §2.6.1「二、」：序号 = 服务端分页 ⇒ 必须 `offset + i + 1` -->
              <td class="seq-cell"><span class="seq-num">{{ offset + i + 1 }}</span></td>
              <td v-for="c in visibleCols" :key="c.key" :class="[{ num: c.num }]">
                <template v-if="c.key === 'settle_no'">
                  <a class="ips-link strong" @click.prevent="openDetail(r)"
                     :href="'#/inventory/purchase-settlement'">{{ r.settle_no || ('#' + r.id) }}</a>
                </template>
                <template v-else-if="c.key === 'status'">
                  <span class="tag" :class="tagOf(SETTLEMENT_STATUS, r.status)">{{ textOf(SETTLEMENT_STATUS, r.status) }}</span>
                </template>
                <template v-else-if="MONEY_COLS.includes(c.key)">¥{{ fmtMoney(r[c.key]) }}</template>
                <template v-else>{{ cellVal(r, c.key) }}</template>
              </td>
              <td class="ips-c-op">
                <button class="ips-link" @click="openDetail(r)">查看</button>
              </td>
            </tr>
          </tbody>
          <!-- 合计行**跟随列设置**：每个可见列都出一格，金额列落值、其余留空。
               写死 colspan 会在列被隐藏/重排后错位。 -->
          <tfoot>
            <tr>
              <td class="ips-ft-lb">合计</td>
              <td v-for="c in visibleCols" :key="'ft-' + c.key"
                  :class="[{ num: c.num, 'ips-ft-num': MONEY_COLS.includes(c.key) }]">
                <template v-if="c.key === 'amount_purchase'">¥{{ fmtMoney(sum.purchase) }}</template>
                <template v-else-if="c.key === 'amount_return'">¥{{ fmtMoney(sum.ret) }}</template>
                <template v-else-if="c.key === 'amount_adjust'">¥{{ fmtMoney(sum.adjust) }}</template>
                <template v-else-if="c.key === 'amount_total'">¥{{ fmtMoney(sum.total) }}</template>
              </td>
              <td class="ips-c-op"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="ips-pager">
        <span class="ips-pg-cnt">共 {{ total }} 张结算单</span>
        <div class="ips-pg-nums">
          <button class="ips-pg" :disabled="page <= 1" @click="goPage(page - 1)">‹</button>
          <button v-for="p in pageNums" :key="p" class="ips-pg" :class="{ on: p === page }"
                  @click="goPage(p)">{{ p }}</button>
          <button class="ips-pg" :disabled="page >= pageCount" @click="goPage(page + 1)">›</button>
        </div>
      </div>
    </div>

    <!-- 列设置面板（UI-SPEC §2.6.1「三、」）——
         类名 / 结构与 `/forecast`、`/inventory/purchase` **逐字一致**，样式已上提全局。
         位置与限高由 `useColMenu` 按齿轮 `getBoundingClientRect()` 现算。 -->
    <div v-if="showColMenu" class="col-menu-overlay" @click="showColMenu = false"></div>
    <div v-if="showColMenu" ref="colMenuEl" class="col-menu" :style="colMenuStyle" @click.stop>
      <div class="col-menu-hd">
        <span>显示列（拖拽排序）</span>
        <button class="col-menu-x" @click="showColMenu = false" title="关闭"><Icon name="close" /></button>
      </div>
      <ul class="col-menu-list">
        <template v-for="(k, ci) in colOrder" :key="k">
          <li v-if="SET_COL_MAP[k]"
              :class="{ locked: k === FIXED_FROZEN, hidden: colVis[k] === false }"
              :draggable="k !== FIXED_FROZEN"
              @dragstart="onColDragStart(ci)" @dragover.prevent @drop="onColDrop(ci)">
            <span class="drag">⠿</span>
            <label><input type="checkbox" :checked="colVis[k] !== false" :disabled="k === FIXED_FROZEN"
                          @click.prevent="toggleCol(k)"> {{ SET_COL_MAP[k].label }}</label>
          </li>
        </template>
      </ul>
      <div class="col-menu-reset">
        <button class="btn btn-ghost btn-xs" @click="resetCols">恢复默认</button>
      </div>
    </div>

    <!-- ── 新建结算单 ──────────────────────────────────────────────
         两步：先选供应商 + 期间 ⇒ 列出**还没结算过**的单据 ⇒ 勾选 ⇒ 建单并加明细。
         🔴 为什么非要两步：加单据时会被**逐张**拒（已结算过 / 单据不存在 / 供应商不一致），
            一步建完就只能在「建不建这张单」与「哪些单据进了」之间二选一 —— 那正是静默丢弃的温床。 -->
    <div v-if="newOpen" class="ips-mask" @click.self="newOpen = false">
      <div class="card ips-dlg">
        <div class="ips-dlg-hd">新建结算单</div>

        <div class="ips-form">
          <label class="ips-fl">供应商
            <select v-model.number="nf.supplier_id" class="input" @change="loadCandidates">
              <option :value="0">请选择供应商</option>
              <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </label>
          <label class="ips-fl">单据日期从
            <input v-model="nf.date_from" class="input" type="date" @change="loadCandidates" />
          </label>
          <label class="ips-fl">到
            <input v-model="nf.date_to" class="input" type="date" @change="loadCandidates" />
          </label>
        </div>

        <div v-if="!nf.supplier_id" class="ips-hint">先选供应商，下面会列出这段时间里还没结算过的单据。</div>
        <div v-else-if="candLoading" class="ips-hint">正在查找可结算的单据…</div>
        <div v-else-if="!cands.length" class="ips-hint">
          这段时间里没有可结算的单据。<br />
          <span class="ips-hint-dim">只有**已入库**的采购单才能结算（没入库就结算 = 为没收到的货付钱）；
          已经进过别的结算单的也不会出现在这里。</span>
        </div>
        <template v-else>
          <div class="ips-cand-hd">
            <label class="ips-all">
              <input type="checkbox" :checked="allCandChecked" @change="toggleAllCand" />全选
            </label>
            <span class="ips-cand-sum">已选 {{ picked.length }} 张 · 合计 ¥{{ fmtMoney(pickedSum) }}</span>
          </div>
          <div class="ips-cand-wrap">
            <table class="tbl ips-cand-tbl">
              <thead>
                <tr>
                  <th style="width:36px"></th>
                  <th style="width:100px">类型</th>
                  <th style="width:140px">单据编号</th>
                  <th style="width:110px">日期</th>
                  <th style="width:110px" class="num">金额</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in cands" :key="c.ref_type + '-' + c.ref_id">
                  <td><input type="checkbox" :value="c" v-model="picked" /></td>
                  <td><span class="tag" :class="tagOf(SETTLEMENT_REF_TYPE, c.ref_type)">{{ textOf(SETTLEMENT_REF_TYPE, c.ref_type) }}</span></td>
                  <td>{{ c.doc_no || ('#' + c.ref_id) }}</td>
                  <td>{{ c.doc_date || '—' }}</td>
                  <td class="num">¥{{ fmtMoney(c.amount) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <div class="ips-dlg-ft">
          <button class="btn btn-ghost btn-sm" :disabled="busy" @click="newOpen = false">取消</button>
          <button class="btn btn-primary btn-sm" :disabled="busy || !picked.length" @click="doCreate">
            {{ busy ? '创建中…' : '创建结算单' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── 结算单详情 ────────────────────────────────────────────── -->
    <div v-if="det.open" class="ips-mask" @click.self="det.open = false">
      <div class="card ips-dlg ips-dlg-lg">
        <div class="ips-dlg-hd">
          {{ det.data.settle_no }}
          <span class="tag" :class="tagOf(SETTLEMENT_STATUS, det.data.status)">{{ textOf(SETTLEMENT_STATUS, det.data.status) }}</span>
        </div>
        <p class="ips-dlg-sub">
          供应商：{{ det.data.supplier_name || '—' }}
          <template v-if="det.data.period_from || det.data.period_to">
            · 结算期间：{{ det.data.period_from || '—' }} ~ {{ det.data.period_to || '—' }}
          </template>
        </p>

        <div class="ips-amt">
          <div class="ips-amt-i"><span>入库金额</span><b>¥{{ fmtMoney(det.data.amount_purchase) }}</b></div>
          <div class="ips-amt-i"><span>退货冲减</span><b class="minus">−¥{{ fmtMoney(det.data.amount_return) }}</b></div>
          <div class="ips-amt-i"><span>其它调整</span><b>{{ det.data.amount_adjust >= 0 ? '+' : '−' }}¥{{ fmtMoney(Math.abs(det.data.amount_adjust || 0)) }}</b></div>
          <div class="ips-amt-i total"><span>应付合计</span><b>¥{{ fmtMoney(det.data.amount_total) }}</b></div>
        </div>

        <div v-if="det.data.status === 'draft'" class="ips-adj">
          <label class="ips-fl">其它调整（可正可负，元）
            <input v-model.number="adjAmount" class="input" type="number" step="0.01" placeholder="0" />
          </label>
          <label class="ips-fl grow">说明
            <input v-model="adjNote" class="input" placeholder="例如：运费补差 / 返利抵扣 / 抹零" />
          </label>
          <button class="btn btn-ghost btn-sm" :disabled="busy" @click="doAdjust">保存调整</button>
        </div>

        <div class="ips-cand-wrap">
          <table class="tbl ips-cand-tbl">
            <thead>
              <tr>
                <th style="width:100px">类型</th>
                <th style="width:150px">单据编号</th>
                <th style="width:110px">日期</th>
                <th style="width:120px" class="num">金额</th>
                <th v-if="det.data.status === 'draft'" style="width:70px"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="it in det.items" :key="it.id">
                <td><span class="tag" :class="tagOf(SETTLEMENT_REF_TYPE, it.ref_type)">{{ textOf(SETTLEMENT_REF_TYPE, it.ref_type) }}</span></td>
                <td>{{ it.doc_no || ('#' + it.ref_id) }}</td>
                <td>{{ it.doc_date || '—' }}</td>
                <td class="num">¥{{ fmtMoney(it.amount) }}</td>
                <td v-if="det.data.status === 'draft'">
                  <button class="ips-link danger" :disabled="busy" @click="doDelItem(it)">移除</button>
                </td>
              </tr>
              <tr v-if="!det.items.length">
                <td :colspan="det.data.status === 'draft' ? 5 : 4" class="ips-empty-row">
                  这张结算单还没有任何单据。
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p v-if="det.data.status !== 'draft'" class="ips-hint">
          {{ det.data.status === 'void' ? '已作废的单据占用已经释放，可以重新进别的结算单。'
             : '已确认的结算单不能再改单据；要改请先作废。' }}
        </p>

        <div class="ips-dlg-ft">
          <button class="btn btn-ghost btn-sm" @click="det.open = false">关闭</button>
          <button v-if="det.data.status !== 'void'" class="btn btn-ghost btn-sm danger" :disabled="busy"
                  @click="doVoid">作废</button>
          <button v-if="det.data.status === 'draft'" class="btn btn-primary btn-sm" :disabled="busy"
                  @click="doConfirm">确认结算</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 采购结算单列表 —— 数据源：`GET /api/psi/purchase-settlements`（v408 P1-9 新增）。
   ------------------------------------------------------------------
   🔴 状态一律走 `psiLabels` 的中文映射，**不许出现 `draft`/`confirmed` 这类英文值**。

   🔴 金额是**快照**：明细里的金额是加进来那一刻的源单金额，源单后来改了这里不变。
      界面**不许**拿源单现价去"校正" —— 对账单是历史事实。

   🔴 列设置走 UI-SPEC §2.6.1（唯一实现 `useColMenu`），与 `/forecast`、`/inventory/purchase`
      逐字同构：**齿轮在序号列表头格内**、面板 `.col-menu` 结构一致、默认列 = 最小可用集。 */
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { psiApi } from '../../api/psi'
import { canDo, toast } from '../../store'
import { fmtMoney, textOf, tagOf, SETTLEMENT_STATUS, SETTLEMENT_STATUS_OPTIONS, SETTLEMENT_REF_TYPE } from '../../constants/psiLabels'
import { useColMenu } from '../../composables/useColMenu.js'
// v411（P2-4）：列设置云端持久化（换设备 / 清缓存不再丢列）。
import { useColPrefs } from '../../composables/useColPrefs.js'

const canWrite = computed(() => canDo('inventory', 'create'))

const loading = ref(true)
const err = ref('')
const rows = ref([])
const total = ref(0)
const suppliers = ref([])
const busy = ref(false)

const limit = ref(20)
const offset = ref(0)
const f = ref({ supplier_id: 0, status: '' })

const page = computed(() => Math.floor(offset.value / limit.value) + 1)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))
const pageNums = computed(() => {
  const out = []
  for (let p = Math.max(1, page.value - 2); p <= Math.min(pageCount.value, page.value + 2); p++) out.push(p)
  return out
})
/** 合计按**当前页可见行**算 —— 与列表口径一致（用户看到的就是这些行）。 */
const sum = computed(() => {
  const s = { purchase: 0, ret: 0, adjust: 0, total: 0 }
  rows.value.forEach(r => {
    s.purchase += Number(r.amount_purchase || 0)
    s.ret += Number(r.amount_return || 0)
    s.adjust += Number(r.amount_adjust || 0)
    s.total += Number(r.amount_total || 0)
  })
  return s
})

/* ── 列设置（UI-SPEC §2.6.1）────────────────────────────────────
   🔴 `SET_COLS` 是列定义**唯一源**：表头、列宽、行、合计行、面板全由它派生 ⇒
      **加一列不用改模板**（只在这里加一行）。
   `on: true` = 默认显示；缺省 = 收起（升级时老用户不会平白多出几列）。 */
const SET_COLS = [
  { key: 'settle_no',       label: '结算单号', w: 140, on: true },
  { key: 'supplier_name',   label: '供应商',   w: 150, on: true },
  { key: 'period',          label: '结算期间', w: 180, on: true },
  { key: 'item_count',      label: '单据数',   w: 80,  on: true, num: true },
  { key: 'amount_purchase', label: '入库金额', w: 120, on: true, num: true },
  { key: 'amount_return',   label: '退货冲减', w: 120, on: true, num: true },
  { key: 'amount_adjust',   label: '其它调整', w: 120, on: true, num: true },
  { key: 'amount_total',    label: '应付合计', w: 130, on: true, num: true },
  { key: 'status',          label: '状态',     w: 90,  on: true },
  { key: 'operator_name',   label: '创建人',   w: 100 },
  { key: 'confirm_by_name', label: '确认人',   w: 100 },
  { key: 'created_at',      label: '创建时间', w: 150 },
]
const SET_COL_MAP = Object.fromEntries(SET_COLS.map(c => [c.key, c]))
const MONEY_COLS = ['amount_purchase', 'amount_return', 'amount_adjust', 'amount_total']
const COL_STORAGE_KEY = 'hergent_settlement_cols_v1'
const SEQ_W = 46
const OP_W = 70
/** 单据编号恒可见、恒在最左：藏了它这张表就只剩金额，无法定位单据。 */
const FIXED_FROZEN = 'settle_no'

const { showColMenu, colMenuEl, colMenuStyle, toggleColMenu } = useColMenu()

function defaultColOrder () { return SET_COLS.map(c => c.key) }
function defaultColVis () {
  const v = {}
  SET_COLS.forEach(c => { v[c.key] = c.on === true })
  return v
}
const colOrder = ref(defaultColOrder())
const colVis = ref(defaultColVis())
const colDragFrom = ref(-1)

const visibleCols = computed(() => {
  const arr = colOrder.value
    .filter(k => SET_COL_MAP[k] && (k === FIXED_FROZEN || colVis.value[k] !== false))
    .map(k => SET_COL_MAP[k])
  const head = arr.filter(c => c.key === FIXED_FROZEN)
  return head.concat(arr.filter(c => c.key !== FIXED_FROZEN))
})

/** 只写 localStorage（**不触发云端推送**）—— 云端值落下来时用它回写本地缓存。 */
function _writeLocal () {
  try {
    localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(_colCfg()))
  } catch (e) { /* 隐私模式 / 配额满：列设置退化为「本次会话有效」，不打断列表使用 */ }
}
function _colCfg () { return { order: colOrder.value, vis: colVis.value } }
const colPrefs = useColPrefs('settlement', {
  // 🔴 与本地**逐字相同**则直接返回：省一次无谓的表格重排。
  apply: (cfg) => {
    if (JSON.stringify(_colCfg()) === JSON.stringify(cfg)) return
    applySaved(cfg)
    _writeLocal()
  },
  snapshot: _colCfg,
})
/** 把一份存下来的配置应用到界面。`saved` 为 null/非法 ⇒ 回默认。 */
function applySaved (saved) {
  const defOrder = defaultColOrder()
  if (saved && Array.isArray(saved.order) && saved.order.length) {
    const known = saved.order.filter(k => SET_COL_MAP[k])
    // 升级后**新登记的列**追加到末尾，沿用其默认可见性 ⇒ 老用户不会平白多出几列
    colOrder.value = known.concat(defOrder.filter(k => !known.includes(k)))
    const v = defaultColVis()
    Object.keys(v).forEach(k => { if (saved.vis && typeof saved.vis[k] === 'boolean') v[k] = saved.vis[k] })
    colVis.value = v
  } else {
    colOrder.value = defOrder
    colVis.value = defaultColVis()
  }
  colVis.value[FIXED_FROZEN] = true      // 冻结列恒可见（脏值兜底）
}
function loadCols () {
  let saved = null
  try { saved = JSON.parse(localStorage.getItem(COL_STORAGE_KEY) || 'null') } catch (e) { saved = null }
  applySaved(saved)
}
function persistCols () {
  _writeLocal()
  colPrefs.push(_colCfg())     // 云端（debounce，失败只留痕不打断）
}
loadCols()

function toggleCol (k) {
  if (k === FIXED_FROZEN) return
  colVis.value = { ...colVis.value, [k]: !(colVis.value[k] !== false) }
  persistCols()
}
function onColDragStart (ci) { colDragFrom.value = ci }
function onColDrop (ci) {
  const from = colDragFrom.value
  colDragFrom.value = -1
  if (from < 0 || from === ci) return
  const a = colOrder.value.slice()
  const [moved] = a.splice(from, 1)
  if (!moved) return
  a.splice(ci, 0, moved)
  colOrder.value = a
  persistCols()
}
function resetCols () {
  colOrder.value = defaultColOrder()
  colVis.value = defaultColVis()
  persistCols()
  toast('列设置已恢复默认', 'success')
}

/** 单元格取值。**缺值显示 `—`**（不是 `0`）：没有不等于「是零」。 */
function cellVal (r, k) {
  if (k === 'period') {
    const a = r.period_from || '', b = r.period_to || ''
    if (!a && !b) return '—'
    return (a || '—') + ' ~ ' + (b || '—')
  }
  const v = r[k]
  if (v === null || v === undefined || v === '') return '—'
  if (k === 'created_at') return String(v).replace('T', ' ').slice(0, 16)
  return String(v)
}

/* ── 数据 ─────────────────────────────────────────────────────── */
async function loadRefs () {
  try {
    const refs = await psiApi.refs('suppliers', '', 200)
    suppliers.value = (refs && refs.suppliers) || []
  } catch (e) { /* 供应商拉不到只影响筛选框，不阻断列表 */ }
}
async function load () {
  loading.value = true
  err.value = ''
  try {
    const d = await psiApi.listSettlements({
      supplier_id: f.value.supplier_id || 0,
      status: f.value.status || '',
      limit: limit.value,
      offset: offset.value,
    })
    rows.value = (d && d.rows) || []
    total.value = Number((d && d.total) || 0)
  } catch (e) {
    err.value = e.message || '结算单列表读取失败'
  } finally {
    loading.value = false
  }
}
function goPage (p) {
  offset.value = Math.max(0, (Math.min(Math.max(1, p), pageCount.value) - 1)) * limit.value
  load()
}

/* ── 新建 ─────────────────────────────────────────────────────── */
const newOpen = ref(false)
const candLoading = ref(false)
const cands = ref([])
const picked = ref([])
const nf = ref({ supplier_id: 0, date_from: '', date_to: '' })

const pickedSum = computed(() => {
  let s = 0
  picked.value.forEach(c => { s += (c.ref_type === 'purchase_return' ? -1 : 1) * Number(c.amount || 0) })
  return s
})
const allCandChecked = computed(() => cands.value.length > 0 && picked.value.length === cands.value.length)

function toggleAllCand () {
  picked.value = allCandChecked.value ? [] : cands.value.slice()
}
function openNew () {
  nf.value = { supplier_id: 0, date_from: '', date_to: '' }
  cands.value = []; picked.value = []
  newOpen.value = true
}
async function loadCandidates () {
  picked.value = []
  if (!nf.value.supplier_id) { cands.value = []; return }
  candLoading.value = true
  try {
    const d = await psiApi.settlementCandidates({
      supplier_id: nf.value.supplier_id,
      date_from: nf.value.date_from || '',
      date_to: nf.value.date_to || '',
    })
    // 🔴 后端已按「未被未作废结算单引用」过滤 ⇒ `taken` 恒 false；这里仍判一次，
    //    将来后端口径放宽时前端不会把已结算的单据混进去。
    cands.value = ((d && d.items) || []).filter(x => !x.taken)
  } catch (e) {
    toast(e.message || '可结算单据读取失败', 'error')
    cands.value = []
  } finally {
    candLoading.value = false
  }
}
async function doCreate () {
  if (!picked.value.length) return
  busy.value = true
  try {
    const r = await psiApi.createSettlement({
      supplier_id: nf.value.supplier_id,
      period_from: nf.value.date_from || '',
      period_to: nf.value.date_to || '',
    })
    const sid = r.settlement_id
    const res = await psiApi.addSettlementItems(sid, picked.value.map(c => ({
      ref_type: c.ref_type, ref_id: c.ref_id,
    })))
    const skipped = res.skipped || []
    if (skipped.length) {
      // 🔴 **部分成功要如实说**：静默丢几张单会让对账金额平白少一截且无人察觉
      toast(`已建 ${r.settle_no}，加了 ${res.added} 张；${skipped.length} 张没进去：${skipped[0].reason}`, 'error')
    } else {
      toast(`已建 ${r.settle_no}，加了 ${res.added} 张单据`, 'success')
    }
    newOpen.value = false
    await load()
  } catch (e) {
    toast(e.message || '创建结算单失败', 'error')
  } finally {
    busy.value = false
  }
}

/* ── 详情 ─────────────────────────────────────────────────────── */
const det = ref({ open: false, data: {}, items: [] })
const adjAmount = ref(0)
const adjNote = ref('')

async function openDetail (r) {
  det.value = { open: true, data: {}, items: [] }
  try {
    const d = await psiApi.getSettlement(r.id)
    det.value = { open: true, data: (d && d.settlement) || {}, items: (d && d.items) || [] }
    adjAmount.value = Number(det.value.data.amount_adjust || 0)
    adjNote.value = det.value.data.note || ''
  } catch (e) {
    toast(e.message || '结算单详情读取失败', 'error')
    det.value.open = false
  }
}
/** 详情刷新后**保留打开状态**（否则每次操作弹层都闪一下关掉）。 */
async function reloadDetail () {
  const d = await psiApi.getSettlement(det.value.data.id)
  det.value.data = (d && d.settlement) || {}
  det.value.items = (d && d.items) || []
}
async function doDelItem (it) {
  busy.value = true
  try {
    await psiApi.deleteSettlementItem(det.value.data.id, it.id)
    await reloadDetail()
    await load()
    toast('已移除', 'success')
  } catch (e) { toast(e.message || '移除失败', 'error') } finally { busy.value = false }
}
async function doAdjust () {
  busy.value = true
  try {
    await psiApi.setSettlementAdjust(det.value.data.id, Number(adjAmount.value || 0), adjNote.value)
    await reloadDetail()
    await load()
    toast('调整已保存', 'success')
  } catch (e) { toast(e.message || '保存调整失败', 'error') } finally { busy.value = false }
}
async function doConfirm () {
  // 🔴 空单确认 = 假账。后端也会拦，这里先拦一次是为了给出更贴近界面的提示。
  if (!det.value.items.length) { toast('这张结算单还没有任何单据，请先添加', 'error'); return }
  busy.value = true
  try {
    await psiApi.confirmSettlement(det.value.data.id)
    await reloadDetail()
    await load()
    toast('结算单已确认', 'success')
  } catch (e) { toast(e.message || '确认失败', 'error') } finally { busy.value = false }
}
async function doVoid () {
  busy.value = true
  try {
    await psiApi.voidSettlement(det.value.data.id, '')
    await reloadDetail()
    await load()
    toast('已作废，单据占用已释放', 'success')
  } catch (e) { toast(e.message || '作废失败', 'error') } finally { busy.value = false }
}

onMounted(() => {
  // v411：云端列配置优先，**刻意不 await**（不拖慢列表首屏；本地那份已由 loadCols 应用）
  colPrefs.syncFromCloud()
  loadRefs(); load()
})
</script>

<style scoped>
.ips-page { display: block }
.ips-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px }
.ips-title { margin: 0; font-size: 17px; font-weight: 600 }
.ips-sub { margin: 4px 0 0; font-size: 12px; color: var(--t3) }
.ips-hd-acts { display: flex; gap: 8px; flex: 0 0 auto }

.ips-filter { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; padding: 12px; margin-bottom: 12px }
.ips-fl { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--t3) }
.ips-fl.grow { flex: 1 1 160px }
.ips-fl .input { min-width: 130px }
.ips-form { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end }

.ips-card { padding: 0 }
.ips-tbl { min-width: 1100px }
.ips-c-op { width: 70px }
.ips-link { color: var(--brand); cursor: pointer; background: none; border: 0; padding: 0; font-size: 12px }
.ips-link.strong { font-weight: 600 }
.ips-link.danger { color: var(--bad) }
.ips-ft-lb { font-weight: 600 }
.ips-ft-num { font-variant-numeric: tabular-nums; font-weight: 600 }

.ips-pager { display: flex; align-items: center; gap: 12px; padding: 10px 12px }
.ips-pg-cnt { font-size: 12px; color: var(--t3) }
.ips-pg-nums { display: flex; gap: 4px; margin-inline-start: auto }
.ips-pg { min-width: 28px; height: 26px; border: 1px solid var(--bd); background: var(--bg);
          border-radius: var(--radius-md); cursor: pointer; font-size: 12px }
.ips-pg.on { background: var(--brand); color: #fff; border-color: var(--brand) }

.ips-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .45); z-index: var(--z-modal);
            display: flex; align-items: center; justify-content: center; padding: 20px }
.ips-dlg { width: 560px; max-width: 100%; max-height: 86vh; overflow: auto; padding: 16px }
.ips-dlg-lg { width: 720px }
.ips-dlg-hd { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px }
.ips-dlg-sub { margin: 6px 0 0; font-size: 12px; color: var(--t3) }
.ips-dlg-ft { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px }
.ips-hint { margin: 12px 0 0; font-size: 12px; color: var(--t3); line-height: 1.7 }
.ips-hint-dim { color: var(--t4) }

.ips-cand-hd { display: flex; align-items: center; gap: 12px; margin-top: 12px; font-size: 12px }
.ips-all { display: flex; align-items: center; gap: 6px; cursor: pointer }
.ips-cand-sum { color: var(--t3); margin-inline-start: auto; font-variant-numeric: tabular-nums }
.ips-cand-wrap { max-height: 300px; overflow: auto; margin-top: 8px; border: 1px solid var(--bd);
                 border-radius: var(--radius-md) }
.ips-cand-tbl { min-width: 100%; font-size: 12px }
.ips-empty-row { text-align: center; color: var(--t3); padding: 18px 0 }

.ips-amt { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0 }
.ips-amt-i { flex: 1 1 120px; border: 1px solid var(--bd); border-radius: var(--radius-md); padding: 8px 10px }
.ips-amt-i span { display: block; font-size: 12px; color: var(--t3) }
.ips-amt-i b { font-size: 16px; font-variant-numeric: tabular-nums }
.ips-amt-i .minus { color: var(--ok) }
.ips-amt-i.total { border-color: var(--brand) }
.ips-amt-i.total b { color: var(--brand) }
.ips-adj { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 12px }
</style>
