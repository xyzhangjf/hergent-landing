<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>{{ TITLE }}</h2>
        <span class="page-sub">{{ SUB }}</span>
      </div>
      <div class="woi-acts">
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
          <Icon name="refresh" :size="14" />刷新
        </button>
        <button class="btn btn-primary btn-sm" @click="openCreate">
          <Icon name="plus" :size="14" />新建{{ TITLE }}
        </button>
      </div>
    </div>

    <div v-if="capped" class="woi-cap">
      <Icon name="alert" :size="14" />
      一次只加载最近 {{ CAP }} 张单据，当前已达上限 —— 更早的单据请稍后清理归档后查看。
    </div>

    <template v-if="!loading && !err">
      <div class="card kpi-strip cols-4">
        <div class="kpi">
          <div class="kpi-label">待过账</div>
          <div class="kpi-val val-warn">{{ cnt.draft }}</div>
          <div class="kpi-sub">草稿，库存未动</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">已过账</div>
          <div class="kpi-val val-ok">{{ cnt.posted }}</div>
          <div class="kpi-sub">库存已调整</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">已作废</div>
          <div class="kpi-val">{{ cnt.cancelled }}</div>
          <div class="kpi-sub">作废单据</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">单据合计</div>
          <div class="kpi-val">{{ rows.length }}</div>
          <div class="kpi-sub">本次加载范围内</div>
        </div>
      </div>

      <div class="card woi-filter">
        <div class="woi-f">
          <label class="woi-lb">状态</label>
          <select v-model="f.status" class="input woi-sel">
            <option value="">全部</option>
            <option v-for="o in STATUS" :key="o.value" :value="o.value">{{ o.text }}</option>
          </select>
        </div>
        <div class="woi-f">
          <label class="woi-lb">原因</label>
          <select v-model="f.reason" class="input woi-sel">
            <option value="">全部</option>
            <option v-for="r in reasons" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>
        <div class="woi-f">
          <label class="woi-lb">关键字</label>
          <input v-model.trim="f.keyword" class="input woi-kw" placeholder="单号 / 备注" />
        </div>
        <div class="woi-f">
          <label class="woi-lb">仓库</label>
          <select v-model.number="f.warehouse_id" class="input woi-sel">
            <option :value="0">全部仓库</option>
            <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
          </select>
        </div>
        <button class="btn btn-ghost btn-sm woi-reset" @click="resetFilter">重置</button>
        <span class="woi-cnt">共 <b>{{ view.length }}</b> 张</span>
      </div>

      <div v-if="!view.length" class="card">
        <div class="state-empty">
          <div class="se-ic"><Icon name="inbox" :size="22" /></div>
          <p>{{ hasFilter ? '当前条件下没有单据。' : `还没有${TITLE}。` }}</p>
          <button v-if="!hasFilter" class="btn btn-primary btn-sm" style="margin-top:12px" @click="openCreate">
            <Icon name="plus" :size="14" />新建{{ TITLE }}
          </button>
        </div>
      </div>

      <div v-else class="card woi-card">
        <div class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>单号</th>
                <th>{{ direction === 'in' ? '入库原因' : '出库原因' }}</th>
                <th>仓库</th>
                <th>状态</th>
                <th class="num">明细行</th>
                <th class="num">合计数量</th>
                <th>备注</th>
                <th>创建时间</th>
                <th>过账时间</th>
                <th style="width:140px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in pageRows" :key="r.id">
                <td class="seq-cell"><span class="seq-num">{{ offset + i + 1 }}</span></td>
                <td class="woi-mono">{{ r.entry_no || ('#' + r.id) }}</td>
                <td><span v-if="r.reason" class="tag info">{{ r.reason }}</span><span v-else>—</span></td>
                <td>{{ r.warehouse_name || ('仓库#' + r.warehouse_id) }}</td>
                <td><span class="tag" :class="tagOf(r.status)">{{ textOf(r.status) }}</span></td>
                <td class="num">{{ r.item_count || 0 }}</td>
                <td class="num">{{ fmtQty(r.total_qty) }}</td>
                <td class="woi-clip">{{ r.remark || '—' }}</td>
                <td class="woi-time">{{ dt(r.created_at) }}</td>
                <td class="woi-time">{{ r.posted_at ? dt(r.posted_at) : '—' }}</td>
                <td>
                  <div class="woi-op">
                    <button v-if="r.status === 'draft'" class="woi-op-btn" :disabled="busy"
                            @click="doPost(r)">过账</button>
                    <button v-if="r.status === 'draft'" class="woi-op-btn danger" :disabled="busy"
                            @click="doCancel(r)">作废</button>
                    <span v-if="r.status !== 'draft'" class="woi-dash">—</span>
                  </div>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb" colspan="5">本页合计</td>
                <td class="num">{{ pageTotals.itemCount }}</td>
                <td class="num">{{ fmtQty(pageTotals.totalQty) }}</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div v-if="pageCount > 1" class="woi-pager">
          <span class="woi-pg-cnt">共 {{ view.length }} 条 · 第 {{ page }} / {{ pageCount }} 页</span>
          <div class="woi-pg-nums">
            <button class="woi-pg" :disabled="page <= 1" @click="goPage(page - 1)">‹</button>
            <button v-for="p in pageNums" :key="p" class="woi-pg" :class="{ on: p === page }"
                    @click="goPage(p)">{{ p }}</button>
            <button class="woi-pg" :disabled="page >= pageCount" @click="goPage(page + 1)">›</button>
          </div>
          <select v-model.number="limit" class="input woi-pg-size" @change="goPage(1)">
            <option v-for="s in PAGE_SIZES" :key="s" :value="s">{{ s }} 条/页</option>
          </select>
        </div>
      </div>

      <p class="woi-foot">{{ FOOT }}</p>
    </template>

    <div v-else-if="loading" class="state-empty">加载中…</div>

    <div v-else class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <WhDialog v-if="dlg" :title="`新建${TITLE}`" @close="dlg = false">
      <div class="woi-form">
        <div class="woi-frow">
          <div class="woi-fld">
            <label class="woi-lb">{{ direction === 'in' ? '入库原因' : '出库原因' }}</label>
            <select v-model="form.reason" class="input">
              <option v-for="r in reasons" :key="r" :value="r">{{ r }}</option>
            </select>
          </div>
          <div class="woi-fld">
            <label class="woi-lb">仓库</label>
            <select v-model.number="form.warehouse_id" class="input">
              <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </div>
        </div>
        <div class="woi-frow">
          <div class="woi-fld">
            <label class="woi-lb">备注</label>
            <input v-model.trim="form.remark" class="input" :placeholder="REMARK_PH" />
          </div>
        </div>
      </div>

      <WhItems ref="itemsRef" v-model="form.items" :products="products" :hint="ITEM_HINT" />

      <template #footer>
        <button class="btn btn-ghost btn-sm" :disabled="saving" @click="dlg = false">取消</button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存草稿' }}
        </button>
      </template>
    </WhDialog>
  </div>
</template>

<script setup>
/* 其它出入库单（仓配管理 · 仓库作业）—— v465e **新增**，数据源 `/api/wh/entries`。
   ------------------------------------------------------------------
   🔴 为什么入/出**共用同一个内核**（而不是抄两份页面）：
      两张单据除了 `direction`、原因候选、标题文案之外**逐字段相同**
      （表结构 `wh_stock_entries` 共用、端点共用、状态机 `draft→posted|cancelled` 共用）。
      抄两份 = 一份改了另一份漂移，而漂移的后果是**账实不符**（最贵的那类 bug）。
      落真身仍按「四步」：本内核 + `OtherIn.vue` / `OtherOut.vue` 两个薄壳各自占一条路由，
      `pages.js` 里也**各登记一行**（可见性判据按路径查表，不能让薄壳共用一行）。

   🔴 **入/出两个方向的口径差异是刻意的，不要"统一"掉**：
      · `in`  → `batch_in`：写数量 + **批次号 + 到期日 + 成本**（与采购入库同一条原语）；
      · `out` → `inventory_adjust(-qty)`：**不过滤效期** ⇒ 过期批次也能出账。
        这正是「报损」能成立的前提 —— 若给判成"不可售不能出"，
        过期奶就永远报不掉，只能烂在库存里（`wh_entry_post` 的注释写了同一件事）。

   🔴 计数口径同入库单/出库单：一次拉全 + 本地筛选/计数/分页（单一数据源）。 */
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { whApi } from '../../api/wh'
import { toast } from '../../store'
import WhDialog from './WhDialog.vue'
import WhItems from './WhItems.vue'

/** `direction` 由薄壳页写死传入（`OtherIn.vue` → 'in' / `OtherOut.vue` → 'out'）。 */
const props = defineProps({
  direction: { type: String, required: true, validator: v => v === 'in' || v === 'out' },
})

const CAP = 2000
const PAGE_SIZES = [20, 50, 100]

const isIn = computed(() => props.direction === 'in')
const TITLE = computed(() => (isIn.value ? '其它入库单' : '其它出库单'))
const SUB = computed(() => (isIn.value
  ? '非采购来源入库 · 归还 / 盘盈 / 样品退回等 · 过账落批次与效期'
  : '非销售去向出库 · 领用 / 盘亏 / 报损等 · 过账不过滤效期'))
const FOOT = computed(() => (isIn.value
  ? '口径：非采购来源的入库（归还、盘盈、样品退回等）。过账调用批次入库原语，'
    + '数量、批次号、到期日、成本一并写入库存，与采购入库同一条链路；已过账的单据不可作废。'
  : '口径：非销售去向的出库（领用、盘亏、报损、样品等）。过账按「不过滤效期」调整库存 —— '
    + '这正是报损能成立的前提，过期批次也能出账；库存不足时整单拦住。'
    + '销售出库请走进销存的销售单（那笔要算应收，本单据不算）。'))
const REMARK_PH = computed(() => (isIn.value ? '选填，如：客户退回未开封样品' : '选填，如：6 月批次过期报损'))
const ITEM_HINT = computed(() => (isIn.value
  ? '过账时按批次入库：批次号与到期日会原样写进库存（出库 FEFO 与效期预警都依赖它）。'
  : '过账时按实物库存扣减，不过滤效期 —— 过期批次也能出账（报损场景）。'))

const STATUS = [
  { value: 'draft', text: '待过账' },
  { value: 'posted', text: '已过账' },
  { value: 'cancelled', text: '已作废' },
]

const loading = ref(true)
const err = ref('')
const busy = ref(false)
const rows = ref([])
const reasons = ref([])
const warehouses = ref([])
const products = ref([])

const f = ref({ status: '', reason: '', keyword: '', warehouse_id: 0 })
const limit = ref(20)
const offset = ref(0)

const dlg = ref(false)
const saving = ref(false)
const itemsRef = ref(null)
const form = ref({ reason: '', warehouse_id: 1, remark: '', items: [] })

const capped = computed(() => rows.value.length >= CAP)

function textOf (s) {
  const o = STATUS.find(x => x.value === s)
  return o ? o.text : (s || '—')
}
function tagOf (s) {
  if (s === 'posted') return 'ok'
  if (s === 'draft') return 'warn'
  return 'info'
}
function dt (s) { return String(s || '').replace('T', ' ').slice(0, 16) }
function fmtQty (n) {
  const v = Number(n || 0)
  return Number.isInteger(v) ? v.toLocaleString('zh-CN') : v.toFixed(2)
}

const cnt = computed(() => {
  const c = { draft: 0, posted: 0, cancelled: 0 }
  rows.value.forEach(r => { if (c[r.status] !== undefined) c[r.status] += 1 })
  return c
})

const hasFilter = computed(() => !!(f.value.status || f.value.reason || f.value.keyword || f.value.warehouse_id))

const view = computed(() => {
  const kw = f.value.keyword.toLowerCase()
  return rows.value.filter(r => {
    if (f.value.status && r.status !== f.value.status) return false
    if (f.value.reason && (r.reason || '') !== f.value.reason) return false
    if (f.value.warehouse_id && Number(r.warehouse_id) !== Number(f.value.warehouse_id)) return false
    if (kw) {
      const hay = `${r.entry_no || ''} ${r.remark || ''}`.toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  })
})

const pageCount = computed(() => Math.max(1, Math.ceil(view.value.length / limit.value)))
const page = computed(() => Math.floor(offset.value / limit.value) + 1)
const pageRows = computed(() => view.value.slice(offset.value, offset.value + limit.value))
const pageNums = computed(() => {
  const n = pageCount.value, cur = page.value
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1)
  let s = Math.max(1, cur - 3)
  s = Math.min(s, n - 6)
  return Array.from({ length: 7 }, (_, i) => s + i)
})
function goPage (p) {
  const n = Math.min(Math.max(1, p), pageCount.value)
  offset.value = (n - 1) * limit.value
}
function resetFilter () { f.value = { status: '', reason: '', keyword: '', warehouse_id: 0 }; goPage(1) }

async function load () {
  loading.value = true
  err.value = ''
  try {
    /* 只按 direction 过滤（服务端），状态/原因/仓库全在本地 —— KPI 与表格同源 */
    rows.value = await whApi.entryList({ direction: props.direction, limit: CAP })
    offset.value = 0
  } catch (e) {
    err.value = e.message || '单据读取失败'
  } finally {
    loading.value = false
  }
}

async function loadRefs () {
  const [rs, w, p] = await Promise.allSettled([
    whApi.entryReasons(props.direction), whApi.warehouses(), whApi.products(),
  ])
  reasons.value = rs.status === 'fulfilled' ? rs.value : []
  warehouses.value = w.status === 'fulfilled' ? w.value : []
  products.value = p.status === 'fulfilled' ? p.value : []
  if (w.status === 'fulfilled' && w.value.length && !w.value.some(x => Number(x.id) === 1)) {
    form.value.warehouse_id = w.value[0].id
  }
  if (reasons.value.length) form.value.reason = reasons.value[0]
}

function openCreate () {
  if (!warehouses.value.length) { toast('仓库资料还没加载到，请稍后重试', 'warn'); return }
  if (!reasons.value.length) { toast('调整原因还没加载到，请稍后重试', 'warn'); return }
  form.value = {
    reason: reasons.value[0],
    warehouse_id: form.value.warehouse_id || 1,
    remark: '',
    items: [],
  }
  dlg.value = true
}

async function save () {
  if (saving.value) return
  const items = itemsRef.value ? itemsRef.value.validItems() : []
  if (!items.length) { toast('请至少添加一行有效商品（商品与数量都要填）', 'warn'); return }
  saving.value = true
  try {
    const r = await whApi.entryCreate({
      direction: props.direction,
      warehouse_id: Number(form.value.warehouse_id || 1),
      reason: form.value.reason || '',
      remark: form.value.remark || '',
      items,
    })
    toast(`已创建${TITLE.value} ${r.entry_no || ('#' + r.id)}`, 'success')
    dlg.value = false
    await load()
  } catch (e) {
    toast(e.message || '创建失败', 'error')
  } finally {
    saving.value = false
  }
}

async function doPost (r) {
  if (busy.value) return
  const verb = isIn.value ? '入库' : '出库'
  if (!window.confirm(`确认过账 ${r.entry_no || ('#' + r.id)}？\n\n`
    + `确认后按「其它${verb}」调整库存，单据不可再作废。`)) return
  busy.value = true
  try {
    await whApi.entryPost(r.id)
    toast(`已过账，库存已调整`, 'success')
    await load()
  } catch (e) {
    toast(e.message || '过账失败', 'error')
  } finally {
    busy.value = false
  }
}

async function doCancel (r) {
  if (busy.value) return
  if (!window.confirm(`作废 ${r.entry_no || ('#' + r.id)}？`)) return
  busy.value = true
  try {
    await whApi.entryCancel(r.id)
    toast('已作废', 'success')
    await load()
  } catch (e) {
    toast(e.message || '作废失败', 'error')
  } finally {
    busy.value = false
  }
}

/* 本页合计：只对当前页可见行的可加总列求和（明细行 + 合计数量）。 */
const pageTotals = computed(() => {
  let itemCount = 0, totalQty = 0
  for (const r of pageRows.value) {
    itemCount += Number(r.item_count || 0)
    totalQty += Number(r.total_qty || 0)
  }
  return { itemCount, totalQty }
})
onMounted(async () => {
  await loadRefs()
  await load()
})
defineExpose({ load })
</script>

<style scoped>
/* 页面私有类一律 `woi-` 前缀（仓配·其它出入库；两个方向共用）。 */
.woi-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }

.woi-cap {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 12px; padding: 8px 12px; font-size: 12px;
  border: 1px solid var(--border-subtle); border-left: 3px solid var(--war);
  border-radius: var(--radius-md); background: var(--bg2); color: var(--war);
}

.woi-filter { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px }
.woi-f { display: flex; align-items: center; gap: 8px }
.woi-lb { font-size: 12px; color: var(--t3); white-space: nowrap }
.woi-kw { min-width: 200px }
.woi-sel { min-width: 140px }
.woi-reset { margin-left: 4px }
.woi-cnt { margin-left: auto; font-size: 12px; color: var(--t3) }
.woi-cnt b { color: var(--p-ink); font-variant-numeric: tabular-nums }

.woi-card { padding: 0; overflow: hidden }
.woi-mono { font-variant-numeric: tabular-nums; font-weight: 500 }
.woi-time { font-size: 12px; color: var(--t3) }
.woi-clip { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.woi-dash { color: var(--t3) }

.woi-op { display: flex; flex-wrap: wrap; gap: 2px 10px; justify-content: flex-end }
.woi-op-btn {
  border: none; background: none; padding: 0; font-size: 13px;
  color: var(--p-dark); cursor: pointer; white-space: nowrap;
}
.woi-op-btn:hover { text-decoration: underline }
.woi-op-btn.danger { color: var(--danger-txt) }
.woi-op-btn:disabled { color: var(--t3); cursor: default; text-decoration: none }

.woi-pager {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 12px 14px; border-top: 1px solid var(--border-subtle);
}
.woi-pg-cnt { font-size: 12px; color: var(--t3); margin-right: auto }
.woi-pg-nums { display: inline-flex; align-items: center; gap: 4px }
.woi-pg {
  min-width: 28px; height: 28px; padding: 0 6px;
  border: 1px solid var(--bd); border-radius: var(--radius-sm);
  background: var(--bg); color: var(--t1); font-size: 13px; font-variant-numeric: tabular-nums;
}
.woi-pg:hover:not(:disabled) { border-color: var(--p); color: var(--p-dark) }
.woi-pg:disabled { opacity: .45; cursor: not-allowed }
.woi-pg.on { background: var(--p-dark); border-color: var(--p-dark); color: #fff }
.woi-pg-size { width: auto; height: 28px; padding: 0 8px; font-size: 13px; border-radius: var(--radius-sm) }

.woi-foot { font-size: 12px; color: var(--t2); margin-top: 12px; line-height: 1.7 }

.woi-form { display: flex; flex-direction: column; gap: 12px }
.woi-frow { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end }
.woi-fld { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 220px }
</style>
