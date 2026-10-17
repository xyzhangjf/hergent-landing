<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>入库单</h2>
        <span class="page-sub">收货登记 · 确认收货后落 FEFO 批次与效期</span>
      </div>
      <div class="win-acts">
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
          <Icon name="refresh" :size="14" />刷新
        </button>
        <button class="btn btn-primary btn-sm" @click="openCreate">
          <Icon name="plus" :size="14" />新建入库单
        </button>
      </div>
    </div>

    <div v-if="capped" class="win-cap">
      <Icon name="alert" :size="14" />
      一次只加载最近 {{ CAP }} 张单据，当前已达上限 —— 更早的单据请稍后清理归档后查看。
    </div>

    <template v-if="!loading && !err">
      <div class="card kpi-strip cols-4">
        <div class="kpi">
          <div class="kpi-label">待收货</div>
          <div class="kpi-val val-warn">{{ cnt.draft }}</div>
          <div class="kpi-sub">已登记、未落库存</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">已收货</div>
          <div class="kpi-val val-ok">{{ cnt.received }}</div>
          <div class="kpi-sub">库存与批次已写入</div>
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

      <!-- 筛选：全在**本地**做（列表已一次拉全）⇒ 页签/计数/表格三者同源，不可能互相打架 -->
      <div class="card win-filter">
        <div class="win-f">
          <label class="win-lb">状态</label>
          <select v-model="f.status" class="input win-sel">
            <option value="">全部</option>
            <option v-for="o in STATUS" :key="o.value" :value="o.value">{{ o.text }}</option>
          </select>
        </div>
        <div class="win-f">
          <label class="win-lb">关键字</label>
          <input v-model.trim="f.keyword" class="input win-kw" placeholder="单号 / 供应商 / 备注" />
        </div>
        <div class="win-f">
          <label class="win-lb">仓库</label>
          <select v-model.number="f.warehouse_id" class="input win-sel">
            <option :value="0">全部仓库</option>
            <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
          </select>
        </div>
        <button class="btn btn-ghost btn-sm win-reset" @click="resetFilter">重置</button>
        <span class="win-cnt">共 <b>{{ view.length }}</b> 张</span>
      </div>

      <div v-if="!view.length" class="card">
        <div class="state-empty">
          <div class="se-ic"><Icon name="inbox" :size="22" /></div>
          <p>{{ hasFilter ? '当前条件下没有入库单。' : '还没有入库单。' }}</p>
          <button v-if="!hasFilter" class="btn btn-primary btn-sm" style="margin-top:12px" @click="openCreate">
            <Icon name="plus" :size="14" />新建入库单
          </button>
        </div>
      </div>

      <div v-else class="card win-card">
        <div class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>单号</th>
                <th>供应商</th>
                <th>入库仓库</th>
                <th>状态</th>
                <th>备注</th>
                <th>创建时间</th>
                <th>收货时间</th>
                <th style="width:150px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in pageRows" :key="r.id">
                <td class="seq-cell"><span class="seq-num">{{ offset + i + 1 }}</span></td>
                <td class="win-mono">{{ r.order_no || ('#' + r.id) }}</td>
                <td>{{ r.supplier_name || ('供应商#' + r.supplier_id) }}</td>
                <td>{{ whName(r.warehouse_id) }}</td>
                <td><span class="tag" :class="tagOf(r.status)">{{ textOf(r.status) }}</span></td>
                <td class="win-clip">{{ r.remark || '—' }}</td>
                <td class="win-time">{{ dt(r.created_at) }}</td>
                <td class="win-time">{{ r.received_at ? dt(r.received_at) : '—' }}</td>
                <td>
                  <div class="win-op">
                    <button v-if="r.status === 'draft'" class="win-op-btn" :disabled="busy"
                            @click="doReceive(r)">确认收货</button>
                    <button v-if="r.status === 'draft'" class="win-op-btn danger" :disabled="busy"
                            @click="doCancel(r)">取消</button>
                    <span v-if="r.status !== 'draft'" class="win-dash">—</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="pageCount > 1" class="win-pager">
          <span class="win-pg-cnt">共 {{ view.length }} 条 · 第 {{ page }} / {{ pageCount }} 页</span>
          <div class="win-pg-nums">
            <button class="win-pg" :disabled="page <= 1" @click="goPage(page - 1)">‹</button>
            <button v-for="p in pageNums" :key="p" class="win-pg" :class="{ on: p === page }"
                    @click="goPage(p)">{{ p }}</button>
            <button class="win-pg" :disabled="page >= pageCount" @click="goPage(page + 1)">›</button>
          </div>
          <select v-model.number="limit" class="input win-pg-size" @change="goPage(1)">
            <option v-for="s in PAGE_SIZES" :key="s" :value="s">{{ s }} 条/页</option>
          </select>
        </div>
      </div>

      <p class="win-foot">
        口径：「确认收货」逐行调用批次入库（FEFO 原语）把数量、<b>批次号</b>、<b>到期日</b>、成本写进库存；
        已收货的单据不可取消、也不可重复收货。若要把货退回供应商，请走采购退货单，不要在这里取消。
      </p>
    </template>

    <div v-else-if="loading" class="state-empty">加载中…</div>

    <div v-else class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <!-- 新建入库单 -->
    <WhDialog v-if="dlg" title="新建入库单" @close="dlg = false">
      <div class="win-form">
        <div class="win-frow">
          <div class="win-fld">
            <label class="win-lb">供应商 <span class="win-req">*</span></label>
            <SupplierCombo v-model="form.supplier_id" :suppliers="suppliers" placeholder="输入名称或编号搜索供应商" />
          </div>
          <div class="win-fld">
            <label class="win-lb">入库仓库</label>
            <select v-model.number="form.warehouse_id" class="input">
              <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </div>
        </div>
        <div class="win-frow">
          <div class="win-fld">
            <label class="win-lb">备注</label>
            <input v-model.trim="form.remark" class="input" placeholder="选填，如：冷链车 3 号到货" />
          </div>
        </div>
      </div>

      <WhItems ref="itemsRef" v-model="form.items" :products="products" class="win-items" />

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
/* 入库单（仓配管理 · 仓库作业）—— 数据源：`/api/inbound`（后端 v108 早已存在，5 个端点）。
   ------------------------------------------------------------------
   🔴 本页是 v465e（P1）**补登记**才第一次真正可用：后端路由一直在，
      但 `/api/inbound` 从未进 `server.py::_PATH_MODULE_MAP` ⇒ rbac 中间件按
      「未配置模块」fail-closed 403（旧前端那页实际是坏的，且界面上只显示「无权限」，
      看不出是路径问题）。本批只补映射，**没有复制一份后端实现**。

   🔴 计数口径：入库单**没有**后端 summary 端点（`/api/inbound` 也只回裸数组、无 total），
      所以本页**一次拉全**（`CAP` 条）后在本地做筛选 / 计数 / 分页 ——
      KPI 数字、状态筛选、表格行三者读的是**同一个数组** ⇒ 结构上不可能互相打架。
      命中上限时页头显式提示，不静默截断。

   🔴 供应商走 `SupplierCombo`（本地模糊搜名称/编号），不另造一个下拉 ——
      与进销存四个建单页的观感同源。 */
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { whApi } from '../../api/wh'
import { toast, confirm } from '../../store'
import WhDialog from './WhDialog.vue'
import WhItems from './WhItems.vue'
import SupplierCombo from '../inventory/new/SupplierCombo.vue'

/** 一次拉取上限。入库单量级小（一年几百张），拉全比"服务端分页 + 前端瞎算总数"诚实。
    ⚠️ 与出库单 / 其它出入库单同值 —— 三个兄弟页的「一次拉多少」不该各写一个数。 */
const CAP = 2000
const PAGE_SIZES = [20, 50, 100]

const STATUS = [
  { value: 'draft', text: '待收货' },
  { value: 'received', text: '已收货' },
  { value: 'cancelled', text: '已取消' },
]

const loading = ref(true)
const err = ref('')
const busy = ref(false)
const rows = ref([])
const suppliers = ref([])
const warehouses = ref([])
const products = ref([])

const f = ref({ status: '', keyword: '', warehouse_id: 0 })
const limit = ref(20)
const offset = ref(0)

const dlg = ref(false)
const saving = ref(false)
const itemsRef = ref(null)
const form = ref({ supplier_id: 0, warehouse_id: 1, remark: '', items: [] })

const capped = computed(() => rows.value.length >= CAP)

function textOf (s) {
  const o = STATUS.find(x => x.value === s)
  return o ? o.text : (s || '—')
}
function tagOf (s) {
  if (s === 'received') return 'ok'
  if (s === 'draft') return 'warn'
  return 'info'
}
function whName (id) {
  const w = warehouses.value.find(x => Number(x.id) === Number(id))
  return w ? w.name : (id ? `仓库#${id}` : '—')
}
/** 时间：`2026-10-11 09:20:31` → `2026-10-11 09:20`（到分钟；秒对业务无意义）。 */
function dt (s) {
  return String(s || '').replace('T', ' ').slice(0, 16)
}

/** 状态计数 —— 与表格同源（都读 `rows`）。 */
const cnt = computed(() => {
  const c = { draft: 0, received: 0, cancelled: 0 }
  rows.value.forEach(r => { if (c[r.status] !== undefined) c[r.status] += 1 })
  return c
})

const hasFilter = computed(() => !!(f.value.status || f.value.keyword || f.value.warehouse_id))

/** 本地筛选（唯一实现；KPI 计数刻意**不**跟随筛选 —— 它答的是"全部单据里各状态几张"）。 */
const view = computed(() => {
  const kw = f.value.keyword.toLowerCase()
  return rows.value.filter(r => {
    if (f.value.status && r.status !== f.value.status) return false
    if (f.value.warehouse_id && Number(r.warehouse_id) !== Number(f.value.warehouse_id)) return false
    if (kw) {
      const hay = `${r.order_no || ''} ${r.supplier_name || ''} ${r.remark || ''}`.toLowerCase()
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
    /* 🔴 刻意**不传 status** —— 一次拉全，让 KPI / 筛选 / 表格同源（见文件头口径）。
       传了 status 就只剩一个状态的行，KPI 另外三个数字会变成 0（假数据）。 */
    rows.value = await whApi.inboundList({ limit: CAP })
    offset.value = 0
  } catch (e) {
    err.value = e.message || '入库单读取失败'
  } finally {
    loading.value = false
  }
}

async function loadRefs () {
  /* 三份基础资料并发拉；任一失败不阻塞列表（但**不静默** —— 建单时会缺选项） */
  const [s, w, p] = await Promise.allSettled([
    whApi.suppliers(), whApi.warehouses(), whApi.products(),
  ])
  suppliers.value = s.status === 'fulfilled' ? s.value : []
  warehouses.value = w.status === 'fulfilled' ? w.value : []
  products.value = p.status === 'fulfilled' ? p.value : []
  if (w.status === 'fulfilled' && w.value.length && !w.value.some(x => Number(x.id) === 1)) {
    /* 默认仓 1 可能不存在（多租户自建仓）⇒ 取第一个，避免建单时仓库下拉选到不存在的 id */
    form.value.warehouse_id = w.value[0].id
  }
}

function openCreate () {
  if (!suppliers.value.length) { toast('供应商资料还没加载到，请稍后重试', 'warn'); return }
  if (!warehouses.value.length) { toast('仓库资料还没加载到，请稍后重试', 'warn'); return }
  form.value = { supplier_id: 0, warehouse_id: form.value.warehouse_id || 1, remark: '', items: [] }
  dlg.value = true
}

async function save () {
  if (saving.value) return
  if (!Number(form.value.supplier_id)) { toast('请选择供应商', 'warn'); return }
  const items = itemsRef.value ? itemsRef.value.validItems() : []
  if (!items.length) { toast('请至少添加一行有效商品（商品与数量都要填）', 'warn'); return }
  saving.value = true
  try {
    const r = await whApi.inboundCreate({
      supplier_id: Number(form.value.supplier_id),
      warehouse_id: Number(form.value.warehouse_id || 1),
      remark: form.value.remark || '',
      items,
    })
    /* 🔴 该端点**没有 data 信封**，成功时 `api()` 返回整包 `{success, id, order_no}`；
       失败会走 HTTP 4xx ⇒ 抛 Error（不会走到这里）。所以这里只需读 order_no。 */
    toast(`已创建入库单 ${r.order_no || ('#' + r.id)}`, 'success')
    dlg.value = false
    await load()
  } catch (e) {
    toast(e.message || '创建入库单失败', 'error')
  } finally {
    saving.value = false
  }
}

async function doReceive (r) {
  if (busy.value) return
  if (!await confirm(`确认收货 ${r.order_no || ('#' + r.id)}？\n\n`
    + '确认后会把每行商品按批次号 / 到期日写入库存，单据不可再取消。')) return
  busy.value = true
  try {
    await whApi.inboundReceive(r.id)
    toast('已收货，库存与批次已更新', 'success')
    await load()
  } catch (e) {
    toast(e.message || '收货失败', 'error')
  } finally {
    busy.value = false
  }
}

async function doCancel (r) {
  if (busy.value) return
  if (!await confirm(`取消入库单 ${r.order_no || ('#' + r.id)}？`)) return
  busy.value = true
  try {
    await whApi.inboundCancel(r.id)
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
/* 页面私有类一律 `win-` 前缀（仓配·入库单）；全局件（.page/.card/.kpi-strip/.tbl/
   .seq-th/.num/.input/.tag/.state-empty/.state-error/.btn*）一律复用，不重定义。 */
.win-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }

.win-cap {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 12px; padding: 8px 12px; font-size: 12px;
  border: 1px solid var(--border-subtle); border-left: 3px solid var(--war);
  border-radius: var(--radius-md); background: var(--bg2); color: var(--war);
}

.win-filter { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px }
.win-f { display: flex; align-items: center; gap: 8px }
.win-lb { font-size: 12px; color: var(--t3); white-space: nowrap }
.win-kw { min-width: 220px }
.win-sel { min-width: 150px }
.win-reset { margin-left: 4px }
.win-cnt { margin-left: auto; font-size: 12px; color: var(--t3) }
.win-cnt b { color: var(--p-ink); font-variant-numeric: tabular-nums }

.win-card { padding: 0; overflow: hidden }
.win-tbl th, .win-tbl td { white-space: nowrap }
.win-mono { font-variant-numeric: tabular-nums; font-weight: 500 }
.win-time { font-size: 12px; color: var(--t3) }
.win-clip { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.win-dash { color: var(--t3) }

.win-op { display: flex; flex-wrap: wrap; gap: 2px 10px; justify-content: flex-end }
.win-op-btn {
  border: none; background: none; padding: 0; font-size: 13px;
  color: var(--p-dark); cursor: pointer; white-space: nowrap;
}
.win-op-btn:hover { text-decoration: underline }
.win-op-btn.danger { color: var(--danger-txt) }
.win-op-btn:disabled { color: var(--t3); cursor: default; text-decoration: none }

.win-pager {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 12px 14px; border-top: 1px solid var(--border-subtle);
}
.win-pg-cnt { font-size: 12px; color: var(--t3); margin-right: auto }
.win-pg-nums { display: inline-flex; align-items: center; gap: 4px }
.win-pg {
  min-width: 28px; height: 28px; padding: 0 6px;
  border: 1px solid var(--bd); border-radius: var(--radius-sm);
  background: var(--bg); color: var(--t1); font-size: 13px; font-variant-numeric: tabular-nums;
}
.win-pg:hover:not(:disabled) { border-color: var(--p); color: var(--p-dark) }
.win-pg:disabled { opacity: .45; cursor: not-allowed }
.win-pg.on { background: var(--p-dark); border-color: var(--p-dark); color: #fff }
.win-pg-size { width: auto; height: 28px; padding: 0 8px; font-size: 13px; border-radius: var(--radius-sm) }

.win-foot { font-size: 12px; color: var(--t2); margin-top: 12px; line-height: 1.7 }

/* 弹窗内的表单 */
.win-form { display: flex; flex-direction: column; gap: 12px }
.win-frow { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end }
.win-fld { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 220px }
.win-req { color: var(--dan) }
.win-items { margin-top: 14px }
</style>
