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

    <!-- 筛选：仅「状态」一项。后端 `transfer_order_list` 只接受 status 过滤
         （日期 / 关键字后端暂无对应参数），不放假控件。 -->
    <div class="card isl-filter">
      <div class="isl-frow">
        <div class="isl-f">
          <label class="isl-lb">状态</label>
          <select v-model="f.status" class="input isl-sel" @change="load()">
            <option value="">全部状态</option>
            <option v-for="o in TO_OPTIONS" :key="o.value" :value="o.value">{{ o.text }}</option>
          </select>
        </div>
        <div class="isl-fbtns">
          <button class="btn btn-primary btn-sm" :disabled="loading" @click="load()">
            <Icon name="search" :size="14" />查询
          </button>
          <button class="btn btn-ghost btn-sm" @click="resetFilter">重置</button>
        </div>
      </div>
    </div>

    <div class="isl-tb">
      <div class="isl-tb-l">
        <span class="isl-selinfo">共 <b>{{ total }}</b> 张</span>
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
        <div class="se-ic"><Icon name="refresh" :size="22" /></div>
        <p>{{ hasFilter ? '当前条件下没有调拨单。' : '还没有调拨单。' }}</p>
        <button v-if="canWrite" class="btn btn-primary btn-sm" style="margin-top:12px" @click="go(newTo)">
          <Icon name="plus" :size="14" />新建{{ title }}
        </button>
      </div>
    </div>

    <div v-else class="card isl-card">
      <div class="table-wrap">
        <table class="tbl isl-tbl" :class="{ 'print-one': !!printOnly }">
          <thead>
            <tr>
              <!-- 齿轮长在序号列表头格子里（与采购/销售列表同一处） -->
              <th class="seq-th col-gear-th"><button class="col-cfg gear" @click.stop="openColMenu" title="列设置"><Icon name="settings" :size="15" /></button></th>
              <!-- 🔴 调拨单**没有排序**（后端 `transfer_order_list` 不支持 order_by）⇒ 表头不可点、
                   不摆排序指示器（摆了点了没反应 = 假控件）。默认按后端 `ORDER BY id DESC`（最新在前）。 -->
              <th v-for="c in visibleCols" :key="c.key" :class="{ num: c.num }">{{ c.label }}</th>
              <th class="isl-op-hd"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="r.id"
                :class="{ 'print-target': printOnly === r.id }"
                class="isl-row">
              <!-- 序号 = 服务端分页 ⇒ 必须 `offset + i + 1` -->
              <td class="seq-cell"><span class="seq-num">{{ offset + i + 1 }}</span></td>
              <td v-for="c in visibleCols" :key="c.key" :class="{ num: c.num }">
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
        </table>
      </div>

      <ColMenuPanel ref="panel" :col-list="COLS" :is-visible="isVisible" :toggle-col="toggleCol" :reset-cols="resetCols" />

      <div class="isl-pager">
        <span class="isl-pg-cnt">共 {{ total }} 张，第 {{ pageFrom }}–{{ pageTo }} 张</span>
        <div class="isl-pg-nums">
          <button class="isl-pg" :disabled="page <= 1" @click="goPage(page - 1)">‹</button>
          <button v-for="p in pageNums" :key="p" class="isl-pg" :class="{ on: p === page }" @click="goPage(p)">{{ p }}</button>
          <button class="isl-pg" :disabled="page >= pageCount" @click="goPage(page + 1)">›</button>
        </div>
        <select v-model.number="limit" class="input isl-pg-size" @change="goPage(1)">
          <option v-for="s in PAGE_SIZES" :key="s" :value="s">{{ s }} 条/页</option>
        </select>
        <span class="isl-pg-jump">
          跳至
          <input v-model.number="jumpTo" class="input isl-pg-in" inputmode="numeric" @keyup.enter="doJump" />
          页
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 调拨单列表 —— 数据源：`GET /api/psi/transfer-orders`（真双仓 `transfer_orders` 表）。
   v449+ 新建：此前「调拨单」侧栏入口指向 `/inventory/sale?type=transfer`，那里出来的是
   `sale_orders` 里 `order_type='transfer'` 的**舟谱导入单**（单仓、与真实调拨不是同一批数据）。
   本页才是 `transfer_orders` 的真列表（与 `TransferOrderNew` 同源、归 `inventory` 模块）。

   🔴 与采购 / 销售列表的**有意差异**（不是遗漏、不是缺陷）：
     ① **没有排序**：后端 `transfer_order_list` 只接受 `status/limit/offset`，**没有 `order_by`**
        参数（与采购 v470 / 销售 v473 的服务端排序不同）。⇒ 表头**不可点击排序**，
        不摆假的排序指示器（摆了点了没反应 = 假控件，正是本仓反复付学费的那种）。
        默认按后端 `ORDER BY id DESC`（最新在前）。
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

/* 列设置（齿轮）。核心列（单号 / 状态）进本清单 `core:true` ⇒ 不进云端显隐配置、恒显；
   可选列 key 一旦定下就进云端，改名会丢用户已存配置（故保持稳定）。 */
const COLS = [
  { key: 'order_no',     label: '单号',     core: true },
  { key: 'from_wh',      label: '调出仓',   core: false },
  { key: 'to_wh',        label: '调入仓',   core: false },
  { key: 'product_name', label: '商品',     core: false },
  { key: 'quantity',     label: '数量',     core: false, num: true },
  { key: 'status',       label: '状态',     core: true },
  { key: 'created_at',   label: '创建时间', core: false },
  { key: 'note',         label: '备注',     core: false },
]
const { isVisible, toggleCol, resetCols } = useColSettings('INV-TRANSFER-LIST', COLS)
const visibleCols = computed(() => COLS.filter(c => isVisible(c.key)))
const panel = ref(null)
function openColMenu (e) { if (panel.value) panel.value.open(e) }

const router = useRouter()
const loading = ref(true)
const err = ref('')
const rows = ref([])
const total = ref(0)
const printing = ref(false)
const printOnly = ref(0)
const busyPost = ref(false)

const PAGE_SIZES = [20, 50, 100, 200]
const limit = ref(50)
const offset = ref(0)
const jumpTo = ref('')

function baseFilter () { return { status: '' } }
const f = ref(baseFilter())

const title = '调拨单'
const subTitle = '双仓调拨台账（调出仓 → 调入仓）'
const newTo = { path: DOC_PATHS.transferOrder }

const canWrite = computed(() => canDo('inventory', 'create'))
const hasFilter = computed(() => !!f.value.status)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))
const page = computed(() => Math.floor(offset.value / limit.value) + 1)
const pageFrom = computed(() => (total.value ? offset.value + 1 : 0))
const pageTo = computed(() => Math.min(offset.value + limit.value, total.value))

const TO_OPTIONS = ['draft', 'completed', 'cancelled'].map(v => ({ value: v, text: textOf(TRANSFER_STATUS, v) }))

async function load (resetPage = true) {
  if (resetPage) offset.value = 0
  loading.value = true
  err.value = ''
  try {
    const p = { status: f.value.status, limit: limit.value, offset: offset.value }
    const d = await psiApi.listTransfers(p)
    rows.value = d.rows || []
    /* 🔴 优先用后端 `total`（v449+ 已补的真总数）；旧 `count` 只是本页行数（≤limit），
       用它当总数会让分页器永远只有 1 页。两者都兼容。 */
    total.value = Number(d.total != null ? d.total : d.count || 0)
  } catch (e) {
    err.value = e.message || '调拨单读取失败'
  } finally {
    loading.value = false
  }
}

function resetFilter () { f.value = baseFilter(); load() }

/* ---- 分页（服务端分页） ---- */
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

/* ---- 打印（纯前端 `window.print()`）---- 没有打印数（后端无计数接口）。 */
async function doPrint () {
  if (printing.value) return
  printing.value = true
  try { printOnly.value = 0; await nextTick(); window.print() } finally { printing.value = false }
}
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
.inv-page { display: block }
.isl-acts { display: flex; gap: 8px; flex-wrap: wrap }
.isl-filter { margin-bottom: 12px }
.isl-frow { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap }
.isl-f { display: flex; flex-direction: column; gap: 4px }
.isl-lb { font-size: 12px; color: var(--t3) }
.isl-sel { min-width: 130px; height: 32px }
.isl-fbtns { display: flex; align-items: center; gap: 8px; margin-left: auto }

.isl-tb { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 0 0 12px }
.isl-tb-l, .isl-tb-r { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap }
.isl-selinfo { font-size: 12px; color: var(--t2) }
.isl-selinfo b { color: var(--p-ink); font-variant-numeric: tabular-nums }

.isl-card { padding-bottom: 0 }
.isl-row { cursor: default }
.isl-no { font-variant-numeric: tabular-nums }
.isl-op { color: var(--p-dark); white-space: nowrap }
.isl-op-hd { width: 1% }
.isl-ops { display: inline-flex; align-items: center; gap: 6px }
.isl-op-btn {
  border: 1px solid var(--bd); background: var(--bg); color: var(--p-dark);
  border-radius: var(--radius-sm); padding: 2px 8px; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.isl-op-btn:hover:not(:disabled) { border-color: var(--p); color: var(--p-ink) }
.isl-op-btn:disabled { opacity: .45; cursor: not-allowed }
.isl-op-go { border-color: var(--p); color: var(--p-ink) }

.isl-pager { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 14px; border-top: 1px solid var(--border-subtle) }
.isl-pg-cnt { font-size: 12px; color: var(--t3); margin-right: auto }
.isl-pg-nums { display: inline-flex; align-items: center; gap: 4px }
.isl-pg { min-width: 28px; height: 28px; padding: 0 6px; border: 1px solid var(--bd); border-radius: var(--radius-sm); background: var(--bg); color: var(--t1); font-size: 13px; cursor: pointer; font-variant-numeric: tabular-nums }
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
  .isl-tbl { min-width: 0; width: 100%; table-layout: auto }
  .isl-op-hd, .isl-op { display: none !important }
  /* 齿轮按钮必须在纸上消失：它是交互控件，印出来读者点不动。 */
  .isl-tbl thead .col-cfg { display: none !important }
  .isl-tbl.print-one tbody tr:not(.print-target) { display: none !important }
}

@media (max-width: 640px) {
  .isl-frow { align-items: stretch }
  .isl-f, .isl-sel { width: 100%; min-width: 0 }
  .isl-fbtns { margin-left: 0 }
}
</style>
