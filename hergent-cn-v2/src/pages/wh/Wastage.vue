<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>{{ detail ? (detail.order.order_no || ('报损单 #' + detail.order.id)) : '损益单' }}</h2>
        <span class="page-sub">{{ detail ? subDetail : '口径即「报损单」：只记损失 · 一次性生效，立即扣库存并落账 · 撤销走「撤销」' }}</span>
      </div>
      <div class="wl-acts">
        <template v-if="detail">
          <button class="btn btn-ghost btn-sm" @click="backToList">返回列表</button>
          <button class="btn btn-ghost btn-sm" :disabled="dLoading" @click="loadDetail(detail.order.id)">
            <Icon name="refresh" :size="14" />刷新
          </button>
          <button v-if="detail.order.status === 'approved'" class="btn btn-ghost btn-sm"
                  :disabled="busy" @click="doReject">
            <Icon name="close" :size="14" />撤销报损
          </button>
        </template>
        <template v-else>
          <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadList()">
            <Icon name="refresh" :size="14" />刷新
          </button>
          <button class="btn btn-primary btn-sm" :disabled="busy" @click="showCreate = !showCreate">
            <Icon name="plus" :size="14" />新建报损单
          </button>
        </template>
      </div>
    </div>

    <!-- ==================== 列表模式 ==================== -->
    <template v-if="!detail">
      <template v-if="!loading && !err">
        <div class="card kpi-strip cols-4">
          <div class="kpi">
            <div class="kpi-label">已生效</div>
            <div class="kpi-val val-warn">{{ cnt.approved }}</div>
            <div class="kpi-sub">库存已扣、账已落</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">已撤销</div>
            <div class="kpi-val">{{ cnt.rejected }}</div>
            <div class="kpi-sub">库存已恢复、分录已冲销</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">净损失金额</div>
            <div class="kpi-val val-bad">{{ fmtMoney(cnt.loss) }}</div>
            <div class="kpi-sub">已生效单据的报损金额合计</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">单据合计</div>
            <div class="kpi-val">{{ total }}</div>
            <div class="kpi-sub">最近 {{ LIST_LIMIT }} 单</div>
          </div>
        </div>

        <!-- 新建区 -->
        <div v-if="showCreate" class="card wl-new">
          <div class="wl-new-hd">
            <Icon name="alert" :size="14" />
            <span>新建报损单</span>
            <span class="wl-new-sub">保存后<b>立即</b>扣减库存并生成会计凭证（没有"待审"这一步）</span>
          </div>

          <div class="wl-warn">
            <Icon name="alert" :size="14" />
            <span>这是<b>一次性生效</b>的库存 + 账务动作：保存即扣库存、即落分录。
              填错了要纠正，请到单据详情用「撤销报损」（会恢复库存并冲销分录）。</span>
          </div>

          <div class="wl-new-row">
            <div class="wl-fld">
              <label class="wl-lb">报损类型</label>
              <select v-model="form.type" class="input">
                <option v-for="t in types" :key="t.v" :value="t.v">{{ t.t }}</option>
              </select>
            </div>
            <div class="wl-fld">
              <label class="wl-lb">仓库</label>
              <select v-model.number="form.warehouse_id" class="input">
                <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
              </select>
            </div>
            <div class="wl-fld wl-fld-grow">
              <label class="wl-lb">备注（选填）</label>
              <input v-model.trim="form.note" class="input" maxlength="100" placeholder="如：临期过期报废 2026-10-11" />
            </div>
          </div>

          <div class="wl-items">
            <div class="wl-items-hd">
              <Icon name="list" :size="14" />
              <span>报损明细</span>
              <span class="wl-new-sub">单位成本留空 ⇒ 按库存批次成本自动取</span>
              <button class="btn btn-ghost btn-sm wl-add-item" @click="addRow">
                <Icon name="plus" :size="13" />加一行
              </button>
            </div>
            <div v-if="!draft.length" class="wl-items-none">还没有明细，点「加一行」开始。</div>
            <div v-else class="table-wrap">
              <table class="tbl wl-mk-tbl">
                <thead>
                  <tr>
                    <th class="seq-th">序号</th>
                    <th style="width:34%">商品</th>
                    <th class="num" style="width:120px">数量</th>
                    <th class="num" style="width:140px">单位成本</th>
                    <th style="width:140px">批次号</th>
                    <th style="width:130px">说明</th>
                    <th class="num" style="width:110px">预计损失</th>
                    <th style="width:56px">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(it, i) in draft" :key="it.uid">
                    <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                    <td><ProductCombo :row="it" :products="products" @pick="onPick" /></td>
                    <td class="num">
                      <input v-model.number="it.quantity" class="input wl-in" type="number" min="0" step="1" placeholder="0" />
                    </td>
                    <td class="num">
                      <input v-model.number="it.cost_price" class="input wl-in" type="number" min="0" step="0.01" placeholder="自动" />
                    </td>
                    <td>
                      <input v-model.trim="it.batch_no" class="input wl-in wl-in-txt" maxlength="30" placeholder="可留空" />
                    </td>
                    <td>
                      <input v-model.trim="it.note" class="input wl-in wl-in-txt" maxlength="30" placeholder="如：外箱破损" />
                    </td>
                    <td class="num wl-dim">{{ it.cost_price ? fmtMoney(rowLoss(it)) : '自动' }}</td>
                    <td>
                      <button class="wl-del" title="删除这一行" @click="removeRow(i)">
                        <Icon name="trash" :size="14" />
                      </button>
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="2" class="wl-foot-lb">合计（仅按已填成本的行走）</td>
                    <td class="num">{{ fmtQty(draftQty) }}</td>
                    <td colspan="3"></td>
                    <td class="num wl-foot-amt">{{ fmtMoney(draftLoss) }}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div class="wl-new-foot">
            <button class="btn btn-primary btn-sm" :disabled="busy || !canCreate" :title="createTitle" @click="doCreate">
              <Icon name="check" :size="14" />保存并立即生效
            </button>
            <button class="btn btn-ghost btn-sm" :disabled="busy" @click="cancelCreate">取消</button>
            <span class="wl-new-note">共 {{ valid.length }} 行有效明细</span>
          </div>
        </div>

        <div v-if="!rows.length" class="card">
          <div class="state-empty">
            <div class="se-ic"><Icon name="inbox" :size="22" /></div>
            <p>还没有报损单。</p>
            <p class="wl-empty-hint">点右上角「新建报损单」登记报废 —— 过期、破损、运输损耗、质量问题都走这里。</p>
          </div>
        </div>

        <div v-else class="card wl-card">
          <div class="table-wrap freeze-list">
            <table class="tbl">
              <thead>
                <tr>
                  <th class="seq-th">序号</th>
                  <th>单号</th>
                  <th>报损类型</th>
                  <th>状态</th>
                  <th>仓库</th>
                  <th class="num">报损金额</th>
                  <th>备注</th>
                  <th>操作人</th>
                  <th>创建时间</th>
                  <th style="width:96px">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in rows" :key="r.id">
                  <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                  <td class="wl-mono">{{ r.order_no || ('#' + r.id) }}</td>
                  <td>{{ typeLabel(r.type) }}</td>
                  <td><span class="tag" :class="r.status === 'approved' ? 'warn' : ''">{{ statusText(r.status) }}</span></td>
                  <td class="wl-dim">{{ whName(r.warehouse_id) }}</td>
                  <td class="num wl-amt">{{ fmtMoney(r.total_loss) }}</td>
                  <td class="wl-dim">{{ r.note || '—' }}</td>
                  <td class="wl-dim">{{ r.operator_id || '—' }}</td>
                  <td class="wl-time">{{ dt(r.created_at) }}</td>
                  <td><button class="wl-op" @click="openDetail(r.id)">查看</button></td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb" colspan="5">本页合计</td>
                <td class="num wl-amt">{{ fmtMoney(wlTotals) }}</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>

        <p class="wl-foot">
          口径：报损对象是<b>已经不能卖/不能用的货</b>（过期、破损、运输损耗、质量问题、丢失）——
          保存后<b>立即扣减库存</b>并生成会计凭证（借 成本/费用科目，贷 库存商品 1405），
          <b>没有"提交后待审"这一步</b>。凭证科目由报损类型决定，本页不重复维护：
          过期/破损 → 主营业务成本，运输损耗 → 销售费用，质量/丢失/其他 → 管理费用。
          <br />✅ <b>批次口径</b>：扣库存走批次感知的 <code>gross_deduct</code> ——
          行内<b>填了批次号就只扣该批</b>，未填则<b>按效期先扣临期</b>，
          并<b>逐笔记录批次明细</b>（撤销时货加回<b>原批次</b>，不会串批）；
          单批不够会跨批次，全部不够则<b>明确报错、整单不落库</b>。
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
            <div class="kpi-label">状态</div>
            <div class="kpi-val" :class="detail.order.status === 'approved' ? 'val-warn' : 'val-ok'">
              {{ statusText(detail.order.status) }}
            </div>
            <div class="kpi-sub">{{ detail.order.status === 'approved' ? '库存已扣、账已落' : '库存已恢复、分录已冲销' }}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">报损金额</div>
            <div class="kpi-val val-bad">{{ fmtMoney(detail.order.total_loss) }}</div>
            <div class="kpi-sub">按类型计入对应科目</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">明细行数</div>
            <div class="kpi-val">{{ items.length }}</div>
            <div class="kpi-sub">被报损的商品行</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">报损类型</div>
            <div class="kpi-val wl-type-val">{{ typeLabel(detail.order.type) }}</div>
            <div class="kpi-sub">{{ whName(detail.order.warehouse_id) }}</div>
          </div>
        </div>

        <div v-if="detail.order.status === 'approved'" class="wl-lock">
          <Icon name="check" :size="14" />已生效并落账。若要纠正，点右上角「撤销报损」——
          会恢复库存并生成冲销分录。
        </div>
        <div v-else class="wl-void">
          <Icon name="close" :size="14" />已撤销：库存已恢复、分录已冲销，单据只作历史留痕。
        </div>

        <div class="wl-meta">
          <span><b>单号：</b>{{ detail.order.order_no }}</span>
          <span><b>仓库：</b>{{ whName(detail.order.warehouse_id) }}</span>
          <span><b>操作人：</b>{{ detail.order.operator_id || '—' }}</span>
          <span><b>创建：</b>{{ dt(detail.order.created_at) }}</span>
          <span v-if="detail.order.note"><b>备注：</b>{{ detail.order.note }}</span>
        </div>

        <div class="card wl-card">
          <div class="table-wrap">
            <table class="tbl wl-tbl">
              <thead>
                <tr>
                  <th class="seq-th">序号</th>
                  <th style="width:34%">商品</th>
                  <th>数量</th>
                  <th class="num">单位成本</th>
                  <th class="num">损失金额</th>
                  <th>批次号</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(it, i) in items" :key="it.id">
                  <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                  <td><div class="wl-name">{{ it.product_name || ('商品#' + it.product_id) }}</div></td>
                  <td>{{ fmtQty(it.quantity) }}</td>
                  <td class="num wl-dim">{{ fmtMoney(it.cost_price) }}</td>
                  <td class="num wl-amt">{{ fmtMoney(it.loss_amount) }}</td>
                  <td class="wl-dim">{{ it.batch_no || '—' }}</td>
                  <td class="wl-dim">{{ it.note || '—' }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="4" class="wl-foot-lb">合计</td>
                  <td class="num wl-foot-amt">{{ fmtMoney(detail.order.total_loss) }}</td>
                  <td colspan="2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </template>

      <div v-else-if="dLoading" class="state-empty">加载中…</div>

      <div v-else class="state-error">
        <div class="se-ic"><Icon name="alert" :size="22" /></div>
        <p>{{ dErr }}</p>
        <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="loadDetail(detail.order.id)">重试</button>
      </div>
    </template>
  </div>
</template>

<script setup>
/* 损益单 = 报损单（仓配管理 · 库存作业 · P2）—— 数据源：**既有** `/api/wastage/*`（v92）。
   ------------------------------------------------------------------
   🔴 **不是** `/api/loss/*`：那是 AI 货损**核算域**（`/api/loss/recipe` 返回算法配方
      `threshold_days/pricing/near_loss_pct`），**没有单据列表**。真正的报损单在
      `domain/wastage_tracker.py` + `wastage_orders` / `wastage_order_items`，
      路由**内联在 `server.py`**（4075–4121），前缀 `/api/wastage` → 模块 `stock`（`server.py:737`）。
      实测 `GET /api/wastage/list` = **200**。

   🔴🔴 **本页最要紧的一件事：报损是「一次性生效」，没有待审环节。**
      `create_wastage_order()` 会**立即** `inventory_adjust(-qty)` 扣库存，
      并**直接写成 `status='approved'` 且过账 GL 分录**（`wastage_tracker.py:164`
      「Auto-post journal entry (wastage is immediate, not pending approval)」）。
      ⇒ 页面上：
        ① 「保存」按钮文案写成「保存并立即生效」，并在表单顶部放**显著警示条**；
        ② 保存前 `window.confirm` 二次确认；
        ③ 纠正走「撤销报损」（`POST /{wid}/reject`：恢复库存 + 冲销分录）。

   ⚠️ 返回形状与兄弟页不同，务必按实际来：
      · `GET /list` → `{orders: [...], total: n}`（**不是** data/items）⇒ 用 `wastageListRaw`。
      · `GET /{wid}` → `{order: {...}, items: [...]}`（**两层**，不是把 items 挂在订单上）。
      · `POST /create` → `{wastage_id, order_no, total_loss, item_count, type}`（**无** data 信封）；
        失败时返回 `{error: "..."}`,⚠️ 而**库存不足会让后端 `raise ValueError` ⇒ HTTP 500**
        （`wastage_tracker.py:134` 把业务错误抛成了异常）⇒ 本页要能优雅显示 500 而不是白屏。

   ℹ️ `/api/wastage/summary` 与 `/api/wastage/suggest-from-expiry` 曾因路由顺序（`/api/wastage/{wid}`
      注册在前）恒 422，v465i 已重排修好 —— 但**本页仍不接**：KPI 与表格必须读**同一个数组**
      （一次拉全 + 本地计数），接服务端汇总会让「KPI 说 5 单、表里 3 行」成为结构上可能的事
      （同 `wh.js` 里 assembly `/summary` 的处理口径）。

   ⚠️ 单位成本**故意允许留空**：后端在 `cost_price` 为空时会按库存批次成本自动取
      （`wastage_tracker.py:114-120`）。前端若用商品档案的进货价硬填，会与真实批次成本不一致，
      把「报损金额」算歪 ⇒ 留空 = 交给后端按真实成本取，是更准的口径。 */

import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { whApi } from '../../api/wh'
import { toast } from '../../store'
import ProductCombo from '../inventory/new/ProductCombo.vue'

const LIST_LIMIT = 100

const loading = ref(true)
const err = ref('')
const busy = ref(false)
const rows = ref([])
const total = ref(0)

const detail = ref(null)
const dLoading = ref(false)
const dErr = ref('')
const items = ref([])

const products = ref([])
const warehouses = ref([])
const types = ref([])

const showCreate = ref(false)
const form = ref({ type: 'expired', warehouse_id: 1, note: '' })
let _uid = 0
const draft = ref([])

const cnt = computed(() => {
  const c = { approved: 0, rejected: 0, loss: 0 }
  rows.value.forEach(r => {
    if (r.status === 'approved') { c.approved += 1; c.loss += Number(r.total_loss || 0) }
    else if (r.status === 'rejected') c.rejected += 1
  })
  return c
})

/** 只统计有效行（后端会跳过 quantity ≤ 0 的行 ⇒ 前端先对齐口径）。 */
const valid = computed(() => draft.value.filter(
  it => Number(it.product_id || 0) > 0 && Number(it.quantity || 0) > 0))
const draftQty = computed(() => valid.value.reduce((s, it) => s + Number(it.quantity || 0), 0))
const draftLoss = computed(() => valid.value.reduce((s, it) => s + rowLoss(it), 0))

const canCreate = computed(() => valid.value.length > 0)
const createTitle = computed(() => (canCreate.value ? '' : '至少要有 1 行有效明细（商品与数量都要填）'))

const subDetail = computed(() => {
  const o = detail.value.order
  return statusText(o.status) + ' · ' + typeLabel(o.type) + ' · '
    + (o.status === 'approved' ? '库存已扣、账已落' : '库存已恢复、分录已冲销')
})

function typeLabel (t) {
  const x = types.value.find(y => y.v === t)
  return x ? x.t : (t || '—')
}
function statusText (s) {
  return s === 'approved' ? '已生效' : (s === 'rejected' ? '已撤销' : (s === 'pending' ? '待处理' : (s || '—')))
}
function dt (s) { return String(s || '').replace('T', ' ').slice(0, 16) }
function fmtQty (n) {
  const v = Number(n || 0)
  return Number.isInteger(v) ? v.toLocaleString('zh-CN') : v.toFixed(2)
}
function fmtMoney (n) { return '¥' + Number(n || 0).toFixed(2) }
function whName (id) {
  const w = warehouses.value.find(x => Number(x.id) === Number(id))
  return w ? w.name : ('仓库#' + id)
}
function rowLoss (it) { return Number(it.quantity || 0) * Number(it.cost_price || 0) }

async function loadRefs () {
  types.value = whApi.wastageTypes()
  const [p, w] = await Promise.allSettled([whApi.products(), whApi.warehouses()])
  products.value = p.status === 'fulfilled' ? p.value : []
  warehouses.value = w.status === 'fulfilled' ? w.value : []
  if (warehouses.value.length && !warehouses.value.some(x => Number(x.id) === 1)) {
    form.value.warehouse_id = warehouses.value[0].id
  }
}

async function loadList () {
  loading.value = true
  err.value = ''
  try {
    const d = await whApi.wastageListRaw({ limit: LIST_LIMIT })
    rows.value = (d && Array.isArray(d.orders)) ? d.orders : []
    total.value = (d && Number(d.total)) || rows.value.length
  } catch (e) {
    err.value = e.message || '报损单读取失败'
  } finally {
    loading.value = false
  }
}

async function loadDetail (wid) {
  dLoading.value = true
  dErr.value = ''
  try {
    const d = await whApi.wastageGet(wid)
    if (!d || !d.order) throw new Error((d && d.error) || '报损单不存在')
    detail.value = d
    items.value = Array.isArray(d.items) ? d.items : []
  } catch (e) {
    dErr.value = e.message || '报损单明细读取失败'
  } finally {
    dLoading.value = false
  }
}

function openDetail (wid) {
  detail.value = { order: { id: wid } }
  items.value = []
  loadDetail(wid)
}
function backToList () {
  detail.value = null
  items.value = []
  loadList()
}

/* ---------------- 新建 ---------------- */
function addRow () {
  _uid += 1
  draft.value = draft.value.concat([
    { uid: 'wl' + _uid, product_id: 0, quantity: null, cost_price: null, batch_no: '', note: '' },
  ])
}
/* 选中商品后**不带出成本** —— 留空让后端按库存批次成本取（见文件头注释）。 */
function onPick () { /* 刻意不预填 cost_price */ }
function removeRow (i) {
  draft.value = draft.value.filter((_, k) => k !== i)
}
function cancelCreate () {
  showCreate.value = false
  draft.value = []
  form.value = { type: form.value.type, warehouse_id: form.value.warehouse_id, note: '' }
}

async function doCreate () {
  if (busy.value) return
  if (!canCreate.value) { toast(createTitle.value, 'warn'); return }
  const msg = `确认保存这张报损单？\n\n`
    + `共 ${valid.value.length} 行，按已填成本的预计损失 ${fmtMoney(draftLoss.value)}`
    + `（未填成本的行走后端自动取价，实际金额以保存结果为准）。\n\n`
    + `⚠️ 保存后【立即】扣减库存并生成会计凭证，没有"待审"这一步。\n`
    + `填错了要到单据详情用「撤销报损」恢复。`
  if (!window.confirm(msg)) return
  busy.value = true
  try {
    const r = await whApi.wastageCreate({
      type: form.value.type,
      warehouse_id: Number(form.value.warehouse_id || 1),
      note: form.value.note || '',
      items: valid.value.map(it => ({
        product_id: Number(it.product_id),
        quantity: Number(it.quantity),
        cost_price: Number(it.cost_price || 0),
        batch_no: it.batch_no || '',
        reason_code: '',
        note: it.note || '',
      })),
    })
    if (!r || r.error || r.wastage_id == null) throw new Error((r && r.error) || '报损单保存失败')
    toast(`报损单 ${r.order_no} 已生效 —— 损失 ${fmtMoney(r.total_loss)}（${r.item_count} 行）`, 'success')
    cancelCreate()
    openDetail(r.wastage_id)
  } catch (e) {
    toast(e.message || '报损单保存失败', 'error')
  } finally {
    busy.value = false
  }
}

async function doReject () {
  if (busy.value) return
  const o = detail.value.order
  if (!window.confirm(`撤销报损单 ${o.order_no}？\n\n会恢复库存并生成冲销分录（原分录不会被删除，另记一笔反向的）。\n撤销后本单不可恢复。`)) return
  busy.value = true
  try {
    const r = await whApi.wastageReject(o.id)
    if (r && r.error) throw new Error(r.error)
    toast('已撤销 —— 库存已恢复、分录已冲销', 'success')
    await loadDetail(o.id)
  } catch (e) {
    toast(e.message || '撤销失败', 'error')
  } finally {
    busy.value = false
  }
}

/* 本页合计：只对可见报损单行的「报损金额」求和。 */
const wlTotals = computed(() => rows.value.reduce((s, r) => s + Number(r.total_loss || 0), 0))

onMounted(async () => {
  await Promise.allSettled([loadRefs(), loadList()])
})
defineExpose({ load: loadList })
</script>

<style scoped>
/* 页面私有类一律 `wl-` 前缀（仓配·损益单/报损单）。 */
.wl-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }

.wl-card { padding: 0; overflow: hidden }
.wl-mono { font-variant-numeric: tabular-nums; font-weight: 500 }
.wl-time { font-size: 12px; color: var(--t3) }
.wl-dim { color: var(--t3); font-size: 12px }
.wl-amt { color: var(--dan); font-variant-numeric: tabular-nums; font-weight: 600 }
.wl-type-val { font-size: 15px }
.wl-name { font-weight: 500 }

.wl-op {
  border: none; background: none; padding: 0; font-size: 13px;
  color: var(--p-dark); cursor: pointer; white-space: nowrap;
}
.wl-op:hover { text-decoration: underline }

.wl-foot { font-size: 12px; color: var(--t2); margin-top: 12px; line-height: 1.7 }
.wl-empty-hint { font-size: 12px; color: var(--t3); margin-top: 6px }

.wl-lock, .wl-void {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 12px; padding: 8px 12px; font-size: 12px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
  background: var(--bg2); color: var(--t2);
}
.wl-lock { border-left: 3px solid var(--ok); color: var(--ok) }
.wl-void { border-left: 3px solid var(--t3); color: var(--t3) }

.wl-meta {
  display: flex; flex-wrap: wrap; gap: 18px;
  margin-bottom: 12px; font-size: 12px; color: var(--t2);
}
.wl-meta b { color: var(--t3); font-weight: 500 }

.wl-tbl, .wl-mk-tbl { table-layout: fixed }
.wl-tbl th { white-space: nowrap }
.wl-in { width: 100%; height: 30px; padding: 0 8px; font-size: 13px; text-align: right; font-variant-numeric: tabular-nums }
.wl-in-txt { text-align: left }
.wl-del {
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; padding: 0; cursor: pointer; color: var(--t3);
}
.wl-del:hover { color: var(--dan) }

.wl-foot-lb { font-size: 12px; color: var(--t3); text-align: right }
.wl-foot-amt { font-weight: 600; color: var(--dan) }

/* 新建区 */
.wl-new { margin-bottom: 12px }
.wl-new-hd {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600; color: var(--t2); margin-bottom: 10px;
}
.wl-new-sub { font-size: 12px; font-weight: 400; color: var(--t3) }

/* 显著警示条：报损是一次性生效的库存+账务动作 */
.wl-warn {
  display: flex; align-items: flex-start; gap: 8px;
  margin-bottom: 14px; padding: 9px 12px; font-size: 12px; line-height: 1.6;
  border: 1px solid var(--border-subtle); border-left: 3px solid var(--dan);
  border-radius: var(--radius-md); background: var(--bg2); color: var(--t2);
}
.wl-warn :deep(svg) { flex: none; margin-top: 2px; color: var(--dan) }

.wl-new-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end }
.wl-fld { display: flex; flex-direction: column; gap: 4px; min-width: 170px }
.wl-fld-grow { flex: 1; min-width: 240px }
.wl-lb { font-size: 12px; color: var(--t3); white-space: nowrap }

.wl-items {
  margin-top: 14px; padding-top: 12px;
  border-top: 1px dashed var(--border-subtle);
}
.wl-items-hd {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 13px; font-weight: 600; color: var(--t2); margin-bottom: 10px;
}
.wl-add-item { margin-left: auto }
.wl-items-none { font-size: 12px; color: var(--t3) }

.wl-new-foot {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}
.wl-new-note { font-size: 12px; color: var(--t3) }
</style>
