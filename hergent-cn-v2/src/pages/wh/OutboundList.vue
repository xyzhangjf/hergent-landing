<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>出库单</h2>
        <span class="page-sub">仓库侧出库 · 过账按 FEFO 扣减库存（过期批次不可售）</span>
      </div>
      <div class="wob-acts">
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
          <Icon name="refresh" :size="14" />刷新
        </button>
        <button class="btn btn-primary btn-sm" @click="openCreate">
          <Icon name="plus" :size="14" />新建出库单
        </button>
      </div>
    </div>

    <div v-if="capped" class="wob-cap">
      <Icon name="alert" :size="14" />
      一次只加载最近 {{ CAP }} 张单据，当前已达上限 —— 更早的单据请稍后清理归档后查看。
    </div>

    <template v-if="!loading && !err">
      <div class="card kpi-strip cols-4">
        <div class="kpi">
          <div class="kpi-label">待出库</div>
          <div class="kpi-val val-warn">{{ cnt.draft }}</div>
          <div class="kpi-sub">草稿，库存未动</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">已出库</div>
          <div class="kpi-val val-ok">{{ cnt.issued }}</div>
          <div class="kpi-sub">库存已按 FEFO 扣减</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">已取消</div>
          <div class="kpi-val">{{ cnt.cancelled }}</div>
          <div class="kpi-sub">作废单据</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">单据合计</div>
          <div class="kpi-val">{{ rows.length }}</div>
          <div class="kpi-sub">本次加载范围内</div>
        </div>
      </div>

      <div class="card wob-filter">
        <div class="wob-f">
          <label class="wob-lb">状态</label>
          <select v-model="f.status" class="input wob-sel">
            <option value="">全部</option>
            <option v-for="o in STATUS" :key="o.value" :value="o.value">{{ o.text }}</option>
          </select>
        </div>
        <div class="wob-f">
          <label class="wob-lb">关键字</label>
          <input v-model.trim="f.keyword" class="input wob-kw" placeholder="单号 / 客户 / 备注" />
        </div>
        <div class="wob-f">
          <label class="wob-lb">发货仓库</label>
          <select v-model.number="f.warehouse_id" class="input wob-sel">
            <option :value="0">全部仓库</option>
            <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
          </select>
        </div>
        <button class="btn btn-ghost btn-sm wob-reset" @click="resetFilter">重置</button>
        <span class="wob-cnt">共 <b>{{ view.length }}</b> 张</span>
      </div>

      <div v-if="!view.length" class="card">
        <div class="state-empty">
          <div class="se-ic"><Icon name="inbox" :size="22" /></div>
          <p>{{ hasFilter ? '当前条件下没有出库单。' : '还没有出库单。' }}</p>
          <button v-if="!hasFilter" class="btn btn-primary btn-sm" style="margin-top:12px" @click="openCreate">
            <Icon name="plus" :size="14" />新建出库单
          </button>
        </div>
      </div>

      <div v-else class="card wob-card">
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>单号</th>
                <th>客户 / 领用方</th>
                <th>发货仓库</th>
                <th>状态</th>
                <th class="num">明细行</th>
                <th class="num">合计数量</th>
                <th>创建时间</th>
                <th>出库时间</th>
                <th style="width:140px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in pageRows" :key="r.id">
                <td class="seq-cell"><span class="seq-num">{{ offset + i + 1 }}</span></td>
                <td class="wob-mono">{{ r.order_no || ('#' + r.id) }}</td>
                <td>{{ r.customer_name || '—' }}</td>
                <td>{{ r.warehouse_name || ('仓库#' + r.warehouse_id) }}</td>
                <td><span class="tag" :class="tagOf(r.status)">{{ textOf(r.status) }}</span></td>
                <td class="num">{{ r.item_count || 0 }}</td>
                <td class="num">{{ fmtQty(r.total_qty) }}</td>
                <td class="wob-time">{{ dt(r.created_at) }}</td>
                <td class="wob-time">{{ r.issued_at ? dt(r.issued_at) : '—' }}</td>
                <td>
                  <div class="wob-op">
                    <button v-if="r.status === 'draft'" class="wob-op-btn" :disabled="busy"
                            @click="doIssue(r)">出库</button>
                    <button v-if="r.status === 'draft'" class="wob-op-btn danger" :disabled="busy"
                            @click="doCancel(r)">取消</button>
                    <span v-if="r.status !== 'draft'" class="wob-dash">—</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="pageCount > 1" class="wob-pager">
          <span class="wob-pg-cnt">共 {{ view.length }} 条 · 第 {{ page }} / {{ pageCount }} 页</span>
          <div class="wob-pg-nums">
            <button class="wob-pg" :disabled="page <= 1" @click="goPage(page - 1)">‹</button>
            <button v-for="p in pageNums" :key="p" class="wob-pg" :class="{ on: p === page }"
                    @click="goPage(p)">{{ p }}</button>
            <button class="wob-pg" :disabled="page >= pageCount" @click="goPage(page + 1)">›</button>
          </div>
          <select v-model.number="limit" class="input wob-pg-size" @change="goPage(1)">
            <option v-for="s in PAGE_SIZES" :key="s" :value="s">{{ s }} 条/页</option>
          </select>
        </div>
      </div>

      <p class="wob-foot">
        口径：过账时<b>按商品聚合一次预校验</b>可售库存，再逐行 FEFO 扣减；
        只要有<b>任一行不足</b>，整单不落、单据留在草稿（不会出现「一半出库」）。
        可售 = 未过期的批次；已过期批次要先走「其它出库单 → 报损」出账。
        本单据<b>不产生应收</b>，销售出库请走进销存的销售单。
      </p>
    </template>

    <div v-else-if="loading" class="state-empty">加载中…</div>

    <div v-else class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <WhDialog v-if="dlg" title="新建出库单" @close="dlg = false">
      <div class="wob-form">
        <div class="wob-frow">
          <div class="wob-fld">
            <label class="wob-lb">客户 / 领用方</label>
            <CustomerCombo v-model="form.customer_id" :customers="customers" placeholder="输入名称或编号搜索客户" />
          </div>
          <div class="wob-fld">
            <label class="wob-lb">发货仓库</label>
            <select v-model.number="form.warehouse_id" class="input">
              <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </div>
        </div>
        <div class="wob-frow">
          <div class="wob-fld">
            <label class="wob-lb">备注</label>
            <input v-model.trim="form.remark" class="input" placeholder="选填，如：门店自提 / 内部领用" />
          </div>
        </div>
      </div>

      <WhItems ref="itemsRef" v-model="form.items" :products="products"
               hint="过账时按 FEFO 从最早到期的可售批次扣减；已过期批次不可售，请改用「其它出库单 → 报损」。" />

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
/* 出库单（仓配管理 · 仓库作业）—— 数据源：`/api/wh/outbound`（v465e 新增，见 routers/wh.py）。
   ------------------------------------------------------------------
   🔴 与「销售出库」是**两张不同的单据**，不要合并：
      · 销售出库（进销存 `/api/psi/sale-orders/{id}/deliver`）：有来源单、算应收、走销售状态机；
      · 本页出库单：**无来源单、不产生应收**，纯仓库侧物料出门（内部领用 / 样品 / 门店自提）。
      把两者合成一个入口会让"这笔货到底要不要收钱"变得看不出。

   🔴 计数口径与入库单一致：**一次拉全 + 本地筛选/计数/分页**，KPI 与表格同一个数组。
      后端虽有 `/outbound/summary`，但**故意不用** —— 若 KPI 走服务端全量、表格走本地截断，
      同一屏就会显示"待出库 3 张"而表里只有 2 行（本项目定义的「同屏两个说法」）。
      （`api/wh.js` 里有同一段说明。）

   🔴 「出库」按钮 = POST `/outbound/{id}/issue`。后端两道防线：
      ① 按商品**聚合**预校验可售数（同一商品拆两行也能拦住）；
      ② 显式写事务（否则 `fefo_deduct` 内部的 `RELEASE SAVEPOINT` 会提交半单）。
      失败一律 400 + 人话（例如「库存不足 —— XX：需要 100，可用 60」）⇒ 直接 toast 原文。 */
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { whApi } from '../../api/wh'
import { toast } from '../../store'
import WhDialog from './WhDialog.vue'
import WhItems from './WhItems.vue'
import CustomerCombo from '../inventory/new/CustomerCombo.vue'

const CAP = 2000
const PAGE_SIZES = [20, 50, 100]

const STATUS = [
  { value: 'draft', text: '待出库' },
  { value: 'issued', text: '已出库' },
  { value: 'cancelled', text: '已取消' },
]

const loading = ref(true)
const err = ref('')
const busy = ref(false)
const rows = ref([])
const customers = ref([])
const warehouses = ref([])
const products = ref([])

const f = ref({ status: '', keyword: '', warehouse_id: 0 })
const limit = ref(20)
const offset = ref(0)

const dlg = ref(false)
const saving = ref(false)
const itemsRef = ref(null)
const form = ref({ customer_id: 0, warehouse_id: 1, remark: '', items: [] })

const capped = computed(() => rows.value.length >= CAP)

function textOf (s) {
  const o = STATUS.find(x => x.value === s)
  return o ? o.text : (s || '—')
}
function tagOf (s) {
  if (s === 'issued') return 'ok'
  if (s === 'draft') return 'warn'
  return 'info'
}
function dt (s) { return String(s || '').replace('T', ' ').slice(0, 16) }
function fmtQty (n) {
  const v = Number(n || 0)
  return Number.isInteger(v) ? v.toLocaleString('zh-CN') : v.toFixed(2)
}

const cnt = computed(() => {
  const c = { draft: 0, issued: 0, cancelled: 0 }
  rows.value.forEach(r => { if (c[r.status] !== undefined) c[r.status] += 1 })
  return c
})

const hasFilter = computed(() => !!(f.value.status || f.value.keyword || f.value.warehouse_id))

const view = computed(() => {
  const kw = f.value.keyword.toLowerCase()
  return rows.value.filter(r => {
    if (f.value.status && r.status !== f.value.status) return false
    if (f.value.warehouse_id && Number(r.warehouse_id) !== Number(f.value.warehouse_id)) return false
    if (kw) {
      const hay = `${r.order_no || ''} ${r.customer_name || ''} ${r.remark || ''}`.toLowerCase()
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
function resetFilter () { f.value = { status: '', keyword: '', warehouse_id: 0 }; goPage(1) }

async function load () {
  loading.value = true
  err.value = ''
  try {
    rows.value = await whApi.outboundList({ limit: CAP })
    offset.value = 0
  } catch (e) {
    err.value = e.message || '出库单读取失败'
  } finally {
    loading.value = false
  }
}

async function loadRefs () {
  const [c, w, p] = await Promise.allSettled([
    whApi.customers(), whApi.warehouses(), whApi.products(),
  ])
  customers.value = c.status === 'fulfilled' ? c.value : []
  warehouses.value = w.status === 'fulfilled' ? w.value : []
  products.value = p.status === 'fulfilled' ? p.value : []
  if (w.status === 'fulfilled' && w.value.length && !w.value.some(x => Number(x.id) === 1)) {
    form.value.warehouse_id = w.value[0].id
  }
}

function openCreate () {
  if (!warehouses.value.length) { toast('仓库资料还没加载到，请稍后重试', 'warn'); return }
  form.value = { customer_id: 0, warehouse_id: form.value.warehouse_id || 1, remark: '', items: [] }
  dlg.value = true
}

async function save () {
  if (saving.value) return
  const items = itemsRef.value ? itemsRef.value.validItems() : []
  if (!items.length) { toast('请至少添加一行有效商品（商品与数量都要填）', 'warn'); return }
  saving.value = true
  try {
    const r = await whApi.outboundCreate({
      customer_id: Number(form.value.customer_id || 0),
      warehouse_id: Number(form.value.warehouse_id || 1),
      remark: form.value.remark || '',
      items,
    })
    toast(`已创建出库单 ${r.order_no || ('#' + r.id)}`, 'success')
    dlg.value = false
    await load()
  } catch (e) {
    toast(e.message || '创建出库单失败', 'error')
  } finally {
    saving.value = false
  }
}

async function doIssue (r) {
  if (busy.value) return
  if (!window.confirm(`确认出库 ${r.order_no || ('#' + r.id)}？\n\n`
    + '确认后按 FEFO 扣减库存，单据不可再取消。库存不足时整单不会出库。')) return
  busy.value = true
  try {
    await whApi.outboundIssue(r.id)
    toast('已出库，库存已扣减', 'success')
    await load()
  } catch (e) {
    /* 🔴 库存不足是**预期内的业务答复**（400 + 人话），原样显示 —— 不要改写成"操作失败" */
    toast(e.message || '出库失败', 'error')
  } finally {
    busy.value = false
  }
}

async function doCancel (r) {
  if (busy.value) return
  if (!window.confirm(`取消出库单 ${r.order_no || ('#' + r.id)}？`)) return
  busy.value = true
  try {
    await whApi.outboundCancel(r.id)
    toast('已取消', 'success')
    await load()
  } catch (e) {
    toast(e.message || '取消失败', 'error')
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await loadRefs()
  await load()
})
defineExpose({ load })
</script>

<style scoped>
/* 页面私有类一律 `wob-` 前缀（仓配·出库单）。 */
.wob-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }

.wob-cap {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 12px; padding: 8px 12px; font-size: 12px;
  border: 1px solid var(--border-subtle); border-left: 3px solid var(--war);
  border-radius: var(--radius-md); background: var(--bg2); color: var(--war);
}

.wob-filter { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px }
.wob-f { display: flex; align-items: center; gap: 8px }
.wob-lb { font-size: 12px; color: var(--t3); white-space: nowrap }
.wob-kw { min-width: 220px }
.wob-sel { min-width: 150px }
.wob-reset { margin-left: 4px }
.wob-cnt { margin-left: auto; font-size: 12px; color: var(--t3) }
.wob-cnt b { color: var(--p-ink); font-variant-numeric: tabular-nums }

.wob-card { padding: 0; overflow: hidden }
.wob-mono { font-variant-numeric: tabular-nums; font-weight: 500 }
.wob-time { font-size: 12px; color: var(--t3) }
.wob-dash { color: var(--t3) }

.wob-op { display: flex; flex-wrap: wrap; gap: 2px 10px; justify-content: flex-end }
.wob-op-btn {
  border: none; background: none; padding: 0; font-size: 13px;
  color: var(--p-dark); cursor: pointer; white-space: nowrap;
}
.wob-op-btn:hover { text-decoration: underline }
.wob-op-btn.danger { color: var(--danger-txt) }
.wob-op-btn:disabled { color: var(--t3); cursor: default; text-decoration: none }

.wob-pager {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 12px 14px; border-top: 1px solid var(--border-subtle);
}
.wob-pg-cnt { font-size: 12px; color: var(--t3); margin-right: auto }
.wob-pg-nums { display: inline-flex; align-items: center; gap: 4px }
.wob-pg {
  min-width: 28px; height: 28px; padding: 0 6px;
  border: 1px solid var(--bd); border-radius: var(--radius-sm);
  background: var(--bg); color: var(--t1); font-size: 13px; font-variant-numeric: tabular-nums;
}
.wob-pg:hover:not(:disabled) { border-color: var(--p); color: var(--p-dark) }
.wob-pg:disabled { opacity: .45; cursor: not-allowed }
.wob-pg.on { background: var(--p-dark); border-color: var(--p-dark); color: #fff }
.wob-pg-size { width: auto; height: 28px; padding: 0 8px; font-size: 13px; border-radius: var(--radius-sm) }

.wob-foot { font-size: 12px; color: var(--t2); margin-top: 12px; line-height: 1.7 }

.wob-form { display: flex; flex-direction: column; gap: 12px }
.wob-frow { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end }
.wob-fld { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 220px }
</style>
