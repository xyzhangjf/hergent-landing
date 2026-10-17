<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>{{ detail ? (detail.take_no || ('盘点 #' + detail.id)) : '盘点单' }}</h2>
        <span class="page-sub">{{ detail ? subDetail : '按（商品 · 仓库）聚合快照账面数 · 逐行录实盘数 · 完成时统一落差异' }}</span>
      </div>
      <div class="wst-acts">
        <template v-if="detail">
          <button class="btn btn-ghost btn-sm" @click="backToList">返回列表</button>
          <button class="btn btn-ghost btn-sm" :disabled="busy" @click="loadDetail(detail.id)">
            <Icon name="refresh" :size="14" />刷新
          </button>
          <button v-if="detail.status === 'in_progress'" class="btn btn-primary btn-sm"
                  :disabled="busy || !detail.counted" @click="doFinalize"
                  :title="detail.counted ? '' : '还没有录入任何实盘数'">
            <Icon name="check" :size="14" />完成盘点
          </button>
        </template>
        <template v-else>
          <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadList()">
            <Icon name="refresh" :size="14" />刷新
          </button>
          <button class="btn btn-primary btn-sm" :disabled="busy" @click="doStart">
            <Icon name="plus" :size="14" />开始新盘点
          </button>
        </template>
      </div>
    </div>

    <!-- ==================== 列表模式 ==================== -->
    <template v-if="!detail">
      <template v-if="!loading && !err">
        <div class="card kpi-strip cols-4">
          <div class="kpi">
            <div class="kpi-label">进行中</div>
            <div class="kpi-val val-warn">{{ cnt.open }}</div>
            <div class="kpi-sub">还在录数，可继续</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">已完成</div>
            <div class="kpi-val val-ok">{{ cnt.done }}</div>
            <div class="kpi-sub">差异已落到库存</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">期次合计</div>
            <div class="kpi-val">{{ rows.length }}</div>
            <div class="kpi-sub">最近 {{ LIST_LIMIT }} 期内</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">差异项合计</div>
            <div class="kpi-val">{{ cnt.diff }}</div>
            <div class="kpi-sub">账面与实盘不一致的行数</div>
          </div>
        </div>

        <div v-if="!rows.length" class="card">
          <div class="state-empty">
            <div class="se-ic"><Icon name="inbox" :size="22" /></div>
            <p>还没有盘点期次。</p>
            <p class="wst-empty-hint">开始记账后的第一次盘点，点右上角「开始新盘点」即可 —— 系统会先给当前库存拍一张快照。</p>
            <button class="btn btn-primary btn-sm" style="margin-top:12px" @click="doStart">
              <Icon name="plus" :size="14" />开始新盘点
            </button>
          </div>
        </div>

        <div v-else class="card wst-card">
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th class="seq-th">序号</th>
                  <th>盘点单号</th>
                  <th>状态</th>
                  <th class="num">商品行数</th>
                  <th class="num">已录数</th>
                  <th class="num">差异项</th>
                  <th class="num">差异数量</th>
                  <th>创建时间</th>
                  <th>完成时间</th>
                  <th style="width:96px">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in rows" :key="r.id">
                  <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                  <td class="wst-mono">{{ r.take_no || ('#' + r.id) }}</td>
                  <td><span class="tag" :class="r.status === 'completed' ? 'ok' : 'warn'">{{ statusText(r.status) }}</span></td>
                  <td class="num">{{ r.item_count || 0 }}</td>
                  <td class="num">
                    {{ r.counted || 0 }}
                    <span class="wst-pct">/ {{ r.item_count || 0 }}</span>
                  </td>
                  <td class="num" :class="{ 'wst-bad': r.diff_count > 0 }">{{ r.diff_count || 0 }}</td>
                  <td class="num" :class="diffCls(r.diff_qty)">{{ fmtSigned(r.diff_qty) }}</td>
                  <td class="wst-time">{{ dt(r.created_at) }}</td>
                  <td class="wst-time">{{ r.completed_at ? dt(r.completed_at) : '—' }}</td>
                  <td>
                    <button class="wst-op" @click="openDetail(r.id)">
                      {{ r.status === 'in_progress' ? '继续盘点' : '查看' }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <p class="wst-foot">
          口径：开单时按<b>（商品 · 仓库）</b>聚合拍一张账面快照（含账面为 0 的组合）；
          录实盘数时可<b>补录账上还没有的货</b>（会现算账面数，账面记 0）。
          完成盘点时把每一行的差额一次性落到库存：<b>盘盈走入库、盘亏逐批扣减</b>，
          任一行落不下去则<b>整期不落</b>，期次仍可改数再完成。
        </p>
      </template>

      <div v-else-if="loading" class="state-empty">加载中…</div>

      <div v-else class="state-error">
        <div class="se-ic"><Icon name="alert" :size="22" /></div>
        <p>{{ err }}</p>
        <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="loadList()">重试</button>
      </div>
    </template>

    <!-- ==================== 明细模式 ==================== -->
    <template v-else>
      <template v-if="!dLoading && !dErr">
        <div class="card kpi-strip cols-4">
          <div class="kpi">
            <div class="kpi-label">商品行数</div>
            <div class="kpi-val">{{ detail.item_count || 0 }}</div>
            <div class="kpi-sub">快照里的（商品 · 仓库）组合</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">已录数</div>
            <div class="kpi-val" :class="detail.counted >= detail.item_count ? 'val-ok' : 'val-warn'">
              {{ detail.counted || 0 }}
            </div>
            <div class="kpi-sub">还差 {{ Math.max(0, (detail.item_count || 0) - (detail.counted || 0)) }} 行</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">差异项</div>
            <div class="kpi-val" :class="detail.diff_count ? 'val-bad' : 'val-ok'">{{ detail.diff_count || 0 }}</div>
            <div class="kpi-sub">实盘 ≠ 账面</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">差异数量</div>
            <div class="kpi-val" :class="diffCls(detail.diff_qty)">{{ fmtSigned(detail.diff_qty) }}</div>
            <div class="kpi-sub">正 = 盘盈，负 = 盘亏</div>
          </div>
        </div>

        <div class="wst-prog">
          <div class="wst-prog-bar"><i :style="{ width: progPct + '%' }"></i></div>
          <span class="wst-prog-txt">{{ detail.counted || 0 }} / {{ detail.item_count || 0 }} 已录（{{ progPct }}%）</span>
        </div>

        <div v-if="detail.status === 'completed'" class="wst-lock">
          <Icon name="check" :size="14" />本期已完成，差异已落到库存 —— 只能查看，不能再录数。
        </div>
        <div v-else-if="detail.status === 'in_progress'" class="wst-tip">
          <Icon name="lightbulb" :size="14" />在「实盘数」格里填数，按回车或点开别处即自动保存该行。
        </div>

        <div class="card wst-card">
          <div class="table-wrap">
            <table class="tbl wst-tbl">
              <thead>
                <tr>
                  <th class="seq-th">序号</th>
                  <th style="width:24%">商品</th>
                  <th>规格</th>
                  <th>单位</th>
                  <th>仓库</th>
                  <th class="num">账面数</th>
                  <th class="num" style="width:130px">实盘数</th>
                  <th class="num">差异</th>
                  <th class="num">成本</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(it, i) in items" :key="it.id" :class="{ 'wst-unfilled': isUnfilled(it) }">
                  <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                  <td>
                    <div class="wst-name">{{ it.product_name || ('商品#' + it.product_id) }}</div>
                    <div v-if="it.product_barcode" class="wst-bc">{{ it.product_barcode }}</div>
                  </td>
                  <td class="wst-dim">{{ it.product_spec || '—' }}</td>
                  <td class="wst-dim">{{ it.unit_label || '—' }}</td>
                  <td class="wst-dim">{{ it.warehouse_name || ('仓库#' + it.warehouse_id) }}</td>
                  <td class="num">{{ fmtQty(it.system_qty) }}</td>
                  <td class="num">
                    <input v-if="detail.status === 'in_progress'"
                           v-model.trim="edits[it.id]" class="input wst-in" :class="markCls(it.id)"
                           type="number" min="0" step="0.01" placeholder="未录"
                           @input="clearMark(it.id)" @keyup.enter="$event.target.blur()" @blur="saveRow(it)" />
                    <span v-else>{{ it.actual_qty == null ? '未录' : fmtQty(it.actual_qty) }}</span>
                  </td>
                  <td class="num" :class="diffCls(rowDiff(it))">{{ rowDiffText(it) }}</td>
                  <td class="num wst-dim">{{ fmtQty(it.cost_price) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-if="detail.status === 'in_progress'" class="card wst-add">
          <div class="wst-add-hd">
            <Icon name="plus" :size="14" />
            <span>补录账上还没有的货</span>
            <span class="wst-add-sub">账面记 0，填入实盘数即可 —— 不必先去入库</span>
          </div>
          <div class="wst-add-row">
            <div class="wst-add-fld wst-add-prod">
              <label class="wst-lb">商品</label>
              <ProductCombo :row="addRow" :products="products" />
            </div>
            <div class="wst-add-fld">
              <label class="wst-lb">仓库</label>
              <select v-model.number="addWh" class="input">
                <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
              </select>
            </div>
            <div class="wst-add-fld wst-add-qty">
              <label class="wst-lb">实盘数</label>
              <input v-model.number="addQty" class="input wst-in" type="number" min="0" step="0.01" placeholder="0" />
            </div>
            <button class="btn btn-primary btn-sm" :disabled="busy || !addRow.product_id || addQty === null || addQty === ''"
                    @click="doAddRow">
              补录
            </button>
          </div>
        </div>

        <p class="wst-foot">
          口径：「差异」= 实盘数 − 账面数。完成盘点时<b>盘盈按当前加权平均成本入库</b>
          （不编造批次号与效期），<b>盘亏逐批扣减</b>（同商品多批次时按最早到期优先，
          与出库 FEFO 同序）。同一（商品 · 仓库）只落一次差异，不会因为分了几批就多算。
        </p>
      </template>

      <div v-else-if="dLoading" class="state-empty">加载中…</div>

      <div v-else class="state-error">
        <div class="se-ic"><Icon name="alert" :size="22" /></div>
        <p>{{ dErr }}</p>
        <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="loadDetail(detail.id)">重试</button>
      </div>
    </template>
  </div>
</template>

<script setup>
/* 盘点单（仓配管理 · 仓库作业）—— 数据源：**自建** `/api/wh/stocktake`（v465e，见 routers/wh.py）。
   ------------------------------------------------------------------
   🔴 为什么不复用 legacy `/api/stock-take*`（本轮的方案修正，动手前实测得来）：
      立项时的计划是「盘点复用既有端点」。写页面前按纪律先读了
      `db/queries/inventory.py::stock_take_*` 并在**只读生产快照**上实测，
      发现 legacy 引擎在**批次级 inventory** 下必然算错：
        ① `stock_take_start` 按 inventory 行（= 批次行）建明细 ⇒ 同一商品出现 N 行；
        ② `stock_take_update` 的 WHERE **只有 product_id**（无 warehouse、无批次）
           ⇒ 录一次实盘数把该商品的所有行都改成同一个值；
        ③ `stock_take_finalize` 逐行 `inventory_adjust(diff)` ⇒ 同一商品的差额
           按批次数**放大 N 倍**，且都落在同一条批次行上。
      实测 tenant_1 快照：`inventory` 54 行 = 54 个 (商品,仓库)（还没有多批次），
      `stock_takes` / `stock_take_items` **均为 0 行** ⇒ 今天还没造成损失，
      但本模块的入库单/其它入库**立刻**会造出多批次行。
      ⇒ 改为自建两表 + 本组端点，**legacy 一个字符不改**（旧前端仍在用那套）。
      完整论证见 `server/db/queries/wh.py` 模块 docstring 与 `routers/wh.py` 头部。

   🔴 **录数必须带 warehouse_id**：本引擎按 `(take_id, product_id, warehouse_id)`
      三元定位/upsert。只传商品会在「同一商品多仓库」时改错行 —— 那正是 legacy 的缺陷。
      表上有同名唯一索引把这条约束落到数据库层。

   🔴 **差异一次性落**：`finalize` 在**一个事务**里逐行 `_apply_variance`，
      任一行返回 error ⇒ **整期不落**（不给「一半盘点落了一半没落」的中间态）。
      所以「完成盘点」是个有后果的动作，必须二次确认。

   🔴 计数同理与兄弟页一致：列表模式**一次拉全 + 本地计数**（KPI 与表格同一个数组）；
      明细模式的 KPI 直接取后端返回的实时统计（`_take_stats` 每次现算，不落冗余列）。 */
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { whApi } from '../../api/wh'
import { toast, confirm } from '../../store'
import ProductCombo from '../inventory/new/ProductCombo.vue'

const LIST_LIMIT = 50

const loading = ref(true)
const err = ref('')
const busy = ref(false)
const rows = ref([])

/* 明细模式：detail 非空即进入。同时用一个独立标志区分「正在拉明细」。 */
const detail = ref(null)
const dLoading = ref(false)
const dErr = ref('')
const items = ref([])
/** 每行实盘数输入值（key = 明细行 id）。与 `marks` 分开：重载只重置值，不动保存状态标记。 */
const edits = ref({})
/** 每行保存状态标记：'' | 'ok' | 'err'（用于输入框描边） */
const marks = ref({})

const products = ref([])
const warehouses = ref([])
const addRow = ref({ product_id: 0 })
const addWh = ref(1)
const addQty = ref(null)

const cnt = computed(() => {
  const c = { open: 0, done: 0, diff: 0 }
  rows.value.forEach(r => {
    if (r.status === 'completed') c.done += 1
    else c.open += 1
    c.diff += Number(r.diff_count || 0)
  })
  return c
})

const subDetail = computed(() => {
  const s = detail.value.status
  return statusText(s) + ' · ' + (s === 'completed'
    ? (detail.value.completed_at ? dt(detail.value.completed_at) + ' 完成' : '已完成')
    : '录完实盘数后点「完成盘点」')
})

const progPct = computed(() => {
  const t = Number(detail.value.item_count || 0)
  if (!t) return 0
  return Math.min(100, Math.round((Number(detail.value.counted || 0) / t) * 100))
})

function statusText (s) { return s === 'completed' ? '已完成' : '进行中' }
function dt (s) { return String(s || '').replace('T', ' ').slice(0, 16) }
function fmtQty (n) {
  const v = Number(n || 0)
  return Number.isInteger(v) ? v.toLocaleString('zh-CN') : v.toFixed(2)
}
function fmtSigned (n) {
  const v = Number(n || 0)
  if (!v) return '0'
  return (v > 0 ? '+' : '') + fmtQty(v)
}
function diffCls (n) {
  const v = Number(n || 0)
  return v > 0 ? 'wst-gain' : (v < 0 ? 'wst-loss' : '')
}
function markCls (id) {
  const m = marks.value[id]
  return m === 'ok' ? 'ok' : (m === 'err' ? 'err' : '')
}
function isUnfilled (it) { return it.actual_qty === null || it.actual_qty === undefined }
function rowDiff (it) {
  if (isUnfilled(it)) return 0
  return Number(it.actual_qty) - Number(it.system_qty || 0)
}
function rowDiffText (it) { return isUnfilled(it) ? '—' : fmtSigned(rowDiff(it)) }

function initEdits (list) {
  const m = {}
  list.forEach(it => {
    m[it.id] = (it.actual_qty === null || it.actual_qty === undefined) ? '' : String(it.actual_qty)
  })
  edits.value = m
}
function clearMark (id) {
  if (marks.value[id]) marks.value = { ...marks.value, [id]: '' }
}

async function loadRefs () {
  const [p, w] = await Promise.allSettled([whApi.products(), whApi.warehouses()])
  products.value = p.status === 'fulfilled' ? p.value : []
  warehouses.value = w.status === 'fulfilled' ? w.value : []
  if (warehouses.value.length && !warehouses.value.some(x => Number(x.id) === 1)) {
    addWh.value = warehouses.value[0].id
  } else {
    addWh.value = 1
  }
}

async function loadList () {
  loading.value = true
  err.value = ''
  try {
    rows.value = await whApi.stocktakeList(LIST_LIMIT)
  } catch (e) {
    err.value = e.message || '盘点期次读取失败'
  } finally {
    loading.value = false
  }
}

async function loadDetail (tid) {
  dLoading.value = true
  dErr.value = ''
  try {
    const t = await whApi.stocktakeGet(tid)
    if (!t || !t.id) throw new Error('盘点期次不存在')
    detail.value = t
    items.value = Array.isArray(t.items) ? t.items : []
    initEdits(items.value)
  } catch (e) {
    dErr.value = e.message || '盘点明细读取失败'
  } finally {
    dLoading.value = false
  }
}

function openDetail (tid) {
  detail.value = { id: tid }     // 先立壳，让明细模式的骨架先出现
  items.value = []
  marks.value = {}
  loadDetail(tid)
}
function backToList () {
  detail.value = null
  items.value = []
  edits.value = {}
  marks.value = {}
  loadList()
}

async function doStart () {
  if (busy.value) return
  if (!await confirm('开始新盘点？\n\n系统会给当前库存拍一张账面快照。'
    + '已经有一期进行中的盘点时，两期互不影响，但建议先把上一期关掉。')) return
  busy.value = true
  try {
    const r = await whApi.stocktakeStart()
    toast(`已开始盘点 ${r.take_no || ('#' + r.id)}（快照 ${r.item_count || 0} 项）`, 'success')
    openDetail(r.id)
  } catch (e) {
    toast(e.message || '开始盘点失败', 'error')
  } finally {
    busy.value = false
  }
}

async function saveRow (it) {
  if (busy.value) return
  const raw = (edits.value[it.id] ?? '').toString().trim()
  if (raw === '') return
  const num = Number(raw)
  if (!Number.isFinite(num) || num < 0) {
    marks.value = { ...marks.value, [it.id]: 'err' }
    toast('实盘数必须是不小于 0 的数字', 'error')
    return
  }
  /* 没改动就不打接口（避免每次光标离开都发一次请求） */
  if (it.actual_qty !== null && it.actual_qty !== undefined && Number(it.actual_qty) === num) return
  busy.value = true
  try {
    await whApi.stocktakeUpdate(detail.value.id, it.product_id, it.warehouse_id, num)
    marks.value = { ...marks.value, [it.id]: 'ok' }
    await loadDetail(detail.value.id)
  } catch (e) {
    marks.value = { ...marks.value, [it.id]: 'err' }
    toast(e.message || '录入失败', 'error')
  } finally {
    busy.value = false
  }
}

async function doAddRow () {
  if (busy.value) return
  const pid = Number(addRow.value.product_id || 0)
  if (!pid) { toast('请先选择商品', 'warn'); return }
  const num = Number(addQty.value)
  if (!Number.isFinite(num) || num < 0) { toast('实盘数必须是不小于 0 的数字', 'warn'); return }
  busy.value = true
  try {
    await whApi.stocktakeUpdate(detail.value.id, pid, Number(addWh.value || 1), num)
    toast('已补录', 'success')
    addRow.value = { product_id: 0 }
    addQty.value = null
    await loadDetail(detail.value.id)
  } catch (e) {
    toast(e.message || '补录失败', 'error')
  } finally {
    busy.value = false
  }
}

async function doFinalize () {
  if (busy.value) return
  const d = detail.value
  if (!d.counted) { toast('还没有录入任何实盘数', 'warn'); return }
  const msg = `确认完成盘点 ${d.take_no || ('#' + d.id)}？\n\n`
    + `已录 ${d.counted} / ${d.item_count} 行，其中 ${d.diff_count || 0} 行有差异。\n`
    + '完成后差异会立即写入库存（盘盈入库 / 盘亏扣减），本期不可再修改。'
    + (d.counted < d.item_count ? `\n\n⚠️ 还有 ${d.item_count - d.counted} 行没录数，这些行会按"无差异"处理。` : '')
  if (!await confirm(msg)) return
  busy.value = true
  try {
    const r = await whApi.stocktakeFinalize(d.id)
    toast(`盘点已完成 —— 调整 ${r.adjusted || 0} 项，盘盈 ${fmtQty(r.gain)}，盘亏 ${fmtQty(r.loss)}`, 'success')
    await loadDetail(d.id)
  } catch (e) {
    toast(e.message || '完成盘点失败', 'error')
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await Promise.allSettled([loadRefs(), loadList()])
})
defineExpose({ load: loadList })
</script>

<style scoped>
/* 页面私有类一律 `wst-` 前缀（仓配·盘点单）。 */
.wst-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }

.wst-card { padding: 0; overflow: hidden }
.wst-mono { font-variant-numeric: tabular-nums; font-weight: 500 }
.wst-time { font-size: 12px; color: var(--t3) }
.wst-dim { color: var(--t3); font-size: 12px }
.wst-pct { color: var(--t3); font-size: 12px }
.wst-bad { color: var(--dan); font-weight: 600 }

.wst-gain { color: var(--ok); font-variant-numeric: tabular-nums; font-weight: 600 }
.wst-loss { color: var(--dan); font-variant-numeric: tabular-nums; font-weight: 600 }

.wst-op {
  border: none; background: none; padding: 0; font-size: 13px;
  color: var(--p-dark); cursor: pointer; white-space: nowrap;
}
.wst-op:hover { text-decoration: underline }

.wst-foot { font-size: 12px; color: var(--t2); margin-top: 12px; line-height: 1.7 }
.wst-empty-hint { font-size: 12px; color: var(--t3); margin-top: 6px }

/* 进度 */
.wst-prog { display: flex; align-items: center; gap: 12px; margin-bottom: 12px }
.wst-prog-bar {
  flex: 1; height: 8px; border-radius: 999px; overflow: hidden;
  background: var(--bg2); border: 1px solid var(--border-subtle);
}
.wst-prog-bar i { display: block; height: 100%; background: var(--p); transition: width .2s }
.wst-prog-txt { font-size: 12px; color: var(--t3); font-variant-numeric: tabular-nums; white-space: nowrap }

.wst-lock, .wst-tip {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 12px; padding: 8px 12px; font-size: 12px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
  background: var(--bg2); color: var(--t2);
}
.wst-lock { border-left: 3px solid var(--ok); color: var(--ok) }
.wst-tip { border-left: 3px solid var(--p); color: var(--t2) }

.wst-tbl { table-layout: fixed }
.wst-tbl th { white-space: nowrap }
/* 输入框贴满格子、矮一档（50+ 行明细，默认 34px 会把表拉到两三屏） */
.wst-in { width: 100%; height: 30px; padding: 0 8px; font-size: 13px; text-align: right; font-variant-numeric: tabular-nums }
.wst-in.ok { border-color: var(--ok) }
.wst-in.err { border-color: var(--dan) }

.wst-name { font-weight: 500 }
.wst-bc { font-size: 11px; color: var(--t3); font-variant-numeric: tabular-nums; margin-top: 2px }

/* 未录数的行底色轻提示，扫描时一眼看出"还差哪些" */
.wst-unfilled { background: var(--bg2) }

.wst-add { margin-top: 12px }
.wst-add-hd {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600; color: var(--t2); margin-bottom: 10px;
}
.wst-add-sub { font-size: 12px; font-weight: 400; color: var(--t3) }
.wst-add-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end }
.wst-add-fld { display: flex; flex-direction: column; gap: 4px; min-width: 150px }
.wst-add-prod { flex: 1; min-width: 240px }
.wst-add-qty { width: 140px; min-width: 120px }
.wst-lb { font-size: 12px; color: var(--t3); white-space: nowrap }
</style>
