<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>{{ detail ? (detail.order_no || (typeLabel + ' #' + detail.id)) : typeLabel }}</h2>
        <span class="page-sub">{{ detail ? subDetail : pageSub }}</span>
      </div>
      <div class="kt-acts">
        <template v-if="detail">
          <button class="btn btn-ghost btn-sm" @click="backToList">返回列表</button>
          <button class="btn btn-ghost btn-sm" :disabled="busy" @click="loadDetail(detail.id)">
            <Icon name="refresh" :size="14" />刷新
          </button>
          <button v-if="detail.status === 'draft'" class="btn btn-primary btn-sm"
                  :disabled="busy" @click="doConfirm">
            <Icon name="check" :size="14" />确认{{ isAsm ? '组装' : '拆卸' }}
          </button>
          <button v-if="detail.status === 'draft'" class="btn btn-ghost btn-sm"
                  :disabled="busy" @click="doVoid">
            <Icon name="trash" :size="14" />作废
          </button>
        </template>
        <template v-else>
          <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadList()">
            <Icon name="refresh" :size="14" />刷新
          </button>
          <button class="btn btn-primary btn-sm" :disabled="busy" @click="showCreate = !showCreate">
            <Icon name="plus" :size="14" />新建{{ typeLabel }}
          </button>
        </template>
      </div>
    </div>

    <!-- ==================== 列表模式 ==================== -->
    <template v-if="!detail">
      <template v-if="!loading && !err">
        <div class="card kpi-strip cols-4">
          <div class="kpi">
            <div class="kpi-label">草稿</div>
            <div class="kpi-val val-warn">{{ cnt.draft }}</div>
            <div class="kpi-sub">还没执行，可改可作废</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">已完成</div>
            <div class="kpi-val val-ok">{{ cnt.done }}</div>
            <div class="kpi-sub">库存已实际变动</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">已作废</div>
            <div class="kpi-val">{{ cnt.voided }}</div>
            <div class="kpi-sub">草稿期作废，未动库存</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">数量合计</div>
            <div class="kpi-val">{{ fmtQty(cnt.qty) }}</div>
            <div class="kpi-sub">{{ typeLabel }}最近 {{ LIST_LIMIT }} 单</div>
          </div>
        </div>

        <!-- 新建区 -->
        <div v-if="showCreate" class="card kt-new">
          <div class="kt-new-hd">
            <Icon name="plus" :size="14" />
            <span>新建{{ typeLabel }}</span>
            <span class="kt-new-sub">{{ isAsm ? '组件 → 组合品：组件被消耗，组合品被产出' : '组合品 → 组件：组合品被消耗，组件被产出' }}</span>
          </div>

          <div class="kt-new-row">
            <div class="kt-fld kt-fld-grow">
              <label class="kt-lb">{{ isAsm ? '产出的组合品' : '被拆的组合品' }}</label>
              <ProductCombo :row="headRow" :products="products" @pick="onPickHead" />
            </div>
            <div class="kt-fld">
              <label class="kt-lb">仓库</label>
              <select v-model.number="form.warehouse_id" class="input">
                <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
              </select>
            </div>
            <div class="kt-fld kt-fld-num">
              <label class="kt-lb">{{ isAsm ? '产出数量' : '拆解数量' }}</label>
              <input v-model.number="form.total_quantity" class="input kt-in" type="number" min="0" step="1" placeholder="0" />
            </div>
          </div>

          <div class="kt-items">
            <div class="kt-items-hd">
              <Icon name="list" :size="14" />
              <span>{{ isAsm ? '组件明细（会被消耗）' : '组件明细（会被产出）' }}</span>
              <button class="btn btn-ghost btn-sm kt-add-item" @click="addItemRow">
                <Icon name="plus" :size="13" />加一行
              </button>
            </div>
            <div v-if="!draft.items.length" class="kt-items-none">还没有组件明细，点「加一行」开始。</div>
            <div v-else class="table-wrap">
              <table class="tbl kt-mk-tbl">
                <thead>
                  <tr>
                    <th class="seq-th">序号</th>
                    <th style="width:44%">组件商品</th>
                    <th class="num" style="width:130px">数量</th>
                    <th class="num" style="width:150px">单位成本</th>
                    <th class="num" style="width:120px">小计</th>
                    <th style="width:60px">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(it, i) in draft.items" :key="it.uid">
                    <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                    <td>
                      <ProductCombo :row="it" :products="products" @pick="onPickItem" />
                    </td>
                    <td class="num">
                      <input v-model.number="it.quantity" class="input kt-in" type="number" min="0" step="1" placeholder="0" />
                    </td>
                    <td class="num">
                      <input v-model.number="it.unit_price" class="input kt-in" type="number" min="0" step="0.01" placeholder="0.00" />
                    </td>
                    <td class="num kt-dim">{{ fmtMoney(rowSub(it)) }}</td>
                    <td>
                      <button class="kt-del" title="删除这一行" @click="removeItemRow(i)">
                        <Icon name="trash" :size="14" />
                      </button>
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="2" class="kt-foot-lb">{{ isAsm ? '预计总成本' : '组件成本合计' }}</td>
                    <td class="num">{{ fmtQty(draftQty) }}</td>
                    <td></td>
                    <td class="num kt-foot-amt">{{ fmtMoney(draftCost) }}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div class="kt-new-row kt-new-row-2">
            <div class="kt-fld kt-fld-grow">
              <label class="kt-lb">备注（选填）</label>
              <input v-model.trim="form.note" class="input" maxlength="100" placeholder="如：整箱拆零 / 组合礼包" />
            </div>
          </div>

          <div class="kt-new-foot">
            <button class="btn btn-primary btn-sm" :disabled="busy || !canCreate" :title="createTitle" @click="doCreate">
              <Icon name="check" :size="14" />建立草稿
            </button>
            <button class="btn btn-ghost btn-sm" :disabled="busy" @click="cancelCreate">取消</button>
            <span class="kt-new-note">
              建出来是<b>草稿</b>，库存<b>不会</b>动；要动库存在明细页点「确认{{ isAsm ? '组装' : '拆卸' }}」。
            </span>
          </div>
        </div>

        <div v-if="!rows.length" class="card">
          <div class="state-empty">
            <div class="se-ic"><Icon name="inbox" :size="22" /></div>
            <p>还没有{{ typeLabel }}。</p>
            <p class="kt-empty-hint">点右上角「新建{{ typeLabel }}」建立草稿 —— 草稿阶段可以随便改，确认后才动库存。</p>
          </div>
        </div>

        <div v-else class="card kt-card">
          <div class="table-wrap freeze-list">
            <table class="tbl">
              <thead>
                <tr>
                  <th class="seq-th">序号</th>
                  <th>单号</th>
                  <th>{{ isAsm ? '产出的组合品' : '被拆的组合品' }}</th>
                  <th>状态</th>
                  <th class="num">数量</th>
                  <th>仓库</th>
                  <th>备注</th>
                  <th>创建时间</th>
                  <th>确认时间</th>
                  <th style="width:96px">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in rows" :key="r.id">
                  <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                  <td class="kt-mono">{{ r.order_no || ('#' + r.id) }}</td>
                  <td><div class="kt-name">{{ r.product_name || ('商品#' + r.product_id) }}</div></td>
                  <td><span class="tag" :class="statusTag(r.status)">{{ statusText(r.status) }}</span></td>
                  <td class="num">{{ fmtQty(r.total_quantity) }}</td>
                  <td class="kt-dim">{{ whName(r.warehouse_id) }}</td>
                  <td class="kt-dim">{{ r.note || '—' }}</td>
                  <td class="kt-time">{{ dt(r.created_at) }}</td>
                  <td class="kt-time">{{ r.confirmed_at ? dt(r.confirmed_at) : '—' }}</td>
                  <td>
                    <button class="kt-op" @click="openDetail(r.id)">
                      {{ r.status === 'draft' ? '处理' : '查看' }}
                    </button>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td class="ft-lb" colspan="4">本页合计</td>
                  <td class="num">{{ fmtQty(ktTotals) }}</td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <p class="kt-foot">
          口径：<b>{{ isAsm ? '组合' : '拆分' }}</b>是同一套单据的两个方向 ——
          {{ isAsm ? '「组件 → 组合品」：确认时<b>逐行扣减组件</b>，再<b>加上组合品</b>'
                   : '「组合品 → 组件」：确认时<b>扣减组合品</b>，再<b>逐行加上组件</b>' }}；
          确认是一次性生效的库存动作，草稿阶段不动库存，确认后不可改（只能另开一张反向单）。
          <b>成本</b>按明细行「数量 × 单位成本」合计，不含任何分摊与差异。
          <br />✅ <b>批次口径</b>：确认走批次感知的 <code>gross_deduct</code> ——
          行内<b>指定了批次号就只扣该批</b>，未指定则<b>按效期先扣临期</b>；
          组件库存不足时<b>明确报错并整单回滚</b>（不会留下扣了一半的单据，也不会静默夹 0）。
        </p>
      </template>

      <Skeleton v-else-if="loading" />

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
            <div class="kpi-val" :class="detail.status === 'draft' ? 'val-warn' : (detail.status === 'confirmed' ? 'val-ok' : '')">
              {{ statusText(detail.status) }}
            </div>
            <div class="kpi-sub">{{ detail.status === 'draft' ? '库存尚未变动' : (detail.status === 'confirmed' ? '库存已实际变动' : '未影响库存') }}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">{{ isAsm ? '产出数量' : '拆解数量' }}</div>
            <div class="kpi-val">{{ fmtQty(detail.total_quantity) }}</div>
            <div class="kpi-sub">{{ detail.product_name || ('商品#' + detail.product_id) }}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">组件行数</div>
            <div class="kpi-val">{{ items.length }}</div>
            <div class="kpi-sub">{{ isAsm ? '被消耗' : '被产出' }}</div>
          </div>
          <div class="kpi">
            <div class="kpi-label">组件成本合计</div>
            <div class="kpi-val">{{ fmtMoney(itemsCost) }}</div>
            <div class="kpi-sub">数量 × 单位成本</div>
          </div>
        </div>

        <div v-if="detail.status === 'draft'" class="kt-tip">
          <Icon name="lightbulb" :size="14" />
          这是<b>草稿</b>，库存还没动。点右上角「确认{{ isAsm ? '组装' : '拆卸' }}」才会真正扣加库存 —— 确认后不可撤。
        </div>
        <div v-else-if="detail.status === 'confirmed'" class="kt-lock">
          <Icon name="check" :size="14" />已执行，库存已变动，只能查看。
        </div>
        <div v-else class="kt-lock">
          <Icon name="close" :size="14" />已作废（草稿期作废，未影响库存）。
        </div>

        <div class="kt-meta">
          <span><b>{{ isAsm ? '产出组合品：' : '被拆组合品：' }}</b>{{ detail.product_name || ('商品#' + detail.product_id) }}</span>
          <span><b>仓库：</b>{{ whName(detail.warehouse_id) }}</span>
          <span><b>创建：</b>{{ dt(detail.created_at) }}</span>
          <span><b>确认：</b>{{ detail.confirmed_at ? dt(detail.confirmed_at) : '—' }}</span>
          <span v-if="detail.note"><b>备注：</b>{{ detail.note }}</span>
        </div>

        <div class="card kt-card">
          <div class="table-wrap">
            <table class="tbl kt-tbl">
              <thead>
                <tr>
                  <th class="seq-th">序号</th>
                  <th style="width:36%">组件商品</th>
                  <th>方向</th>
                  <th class="num">数量</th>
                  <th class="num">单位成本</th>
                  <th class="num">小计</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(it, i) in items" :key="it.id">
                  <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                  <td>
                    <div class="kt-name">{{ it.product_name || ('商品#' + it.product_id) }}</div>
                    <div v-if="it.product_spec" class="kt-spec">{{ it.product_spec }}</div>
                  </td>
                  <td class="kt-dim">{{ it.is_input ? '被消耗' : '被产出' }}</td>
                  <td class="num">{{ fmtQty(it.quantity) }}</td>
                  <td class="num kt-dim">{{ fmtMoney(it.unit_price) }}</td>
                  <td class="num">{{ fmtMoney(Number(it.quantity || 0) * Number(it.unit_price || 0)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
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
/* 组合单 / 拆分单（仓配管理 · 库存作业 · P2）—— 数据源：**既有** `/api/assembly`（v108）。
   ------------------------------------------------------------------
   🔴 一个组件参数化两次：`type='assemble'` → 「组合单」；`type='disassemble'` → 「拆分单」。
      两者是**同一张表（`kit_orders`）的两个方向**，列表/明细/确认/作废完全同构，
      只差「谁是产出、谁是消耗」和几处文案 ⇒ 拆两个文件必然漂移。

   🔴 **草稿 → 确认两段式**（与 P1 的入库单同范式）：
      建单只写 `kit_orders` + `kit_items`（`status='draft'`），**不碰库存**；
      点「确认」才在**一个事务**里逐行扣加库存并置为 `confirmed`。⇒ 有后果的动作必须二次确认。

   ⚠️ 后端 `POST /{aid}/confirm` 的返回**没有 data 信封**，且「非 draft」时是
      **HTTP 200 + `success:false`**（数据层直接 return 字典）⇒ `api()` 不会抛错，
      调用方**必须自己判 `r.success`**，否则会把「仅草稿可确认」当成功。
      本页因此在 `doConfirm` 里显式检查。

   ⚠️ `/api/assembly/list` **没有 type 参数** ⇒ 两个页面拉全量后各自本地按 `type` 筛。
      KPI 与表格读**同一个数组**（一次拉全 + 本地计数），不接 `/summary`（见 api/wh.js 注释）。

   ⚠️ 建单时后端会**静默丢掉** `quantity ≤ 0` 或 `product_id ≤ 0` 的明细行
      ⇒ 本页在前端就先把这类行过滤掉，并在没剩下有效行时拦住提交，
      不让用户以为"5 行都提交了"而实际只落了 3 行。 */

import Skeleton from '../../components/Skeleton.vue'
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { whApi } from '../../api/wh'
import { toast, confirm } from '../../store'
import ProductCombo from '../inventory/new/ProductCombo.vue'

const props = defineProps({
  /** 'assemble' = 组合单 · 'disassemble' = 拆分单 */
  type: { type: String, default: 'assemble' },
})

const LIST_LIMIT = 200

const isAsm = computed(() => props.type !== 'disassemble')
const typeLabel = computed(() => (isAsm.value ? '组合单' : '拆分单'))
const pageSub = computed(() => (isAsm.value
  ? '组件 → 组合品：先建草稿，确认时逐行扣组件、加组合品'
  : '组合品 → 组件：先建草稿，确认时扣组合品、逐行加组件'))

const loading = ref(true)
const err = ref('')
const busy = ref(false)
const rows = ref([])

const detail = ref(null)
const dLoading = ref(false)
const dErr = ref('')
const items = ref([])

const products = ref([])
const warehouses = ref([])

const showCreate = ref(false)
const form = ref({ warehouse_id: 1, total_quantity: null, note: '' })
const headRow = ref({ product_id: 0 })
let _uid = 0
const draft = ref({ items: [] })   // 行 = {uid, product_id, quantity, unit_price}

const cnt = computed(() => {
  const c = { draft: 0, done: 0, voided: 0, qty: 0 }
  rows.value.forEach(r => {
    if (r.status === 'draft') c.draft += 1
    else if (r.status === 'confirmed') c.done += 1
    else c.voided += 1
    if (r.status === 'confirmed') c.qty += Number(r.total_quantity || 0)
  })
  return c
})

const itemsCost = computed(() => items.value.reduce(
  (s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0), 0))

/** 只统计**有效行**（后端会静默丢掉 pid≤0 或 qty≤0 的行 ⇒ 前端先对齐口径）。 */
const validItems = computed(() => draft.value.items.filter(
  it => Number(it.product_id || 0) > 0 && Number(it.quantity || 0) > 0))
const draftQty = computed(() => validItems.value.reduce((s, it) => s + Number(it.quantity || 0), 0))
const draftCost = computed(() => validItems.value.reduce(
  (s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0), 0))

const canCreate = computed(() => Number(headRow.value.product_id || 0) > 0
  && Number(form.value.total_quantity || 0) > 0
  && validItems.value.length > 0)

const createTitle = computed(() => (canCreate.value ? '' : (
  Number(headRow.value.product_id || 0) <= 0 ? '请先选择' + (isAsm.value ? '产出的组合品' : '被拆的组合品')
    : Number(form.value.total_quantity || 0) <= 0 ? '请填写数量'
      : '至少要有 1 行有效的组件明细（商品与数量都要填）')))

const subDetail = computed(() => {
  const d = detail.value
  const base = statusText(d.status) + ' · ' + (d.product_name || ('商品#' + d.product_id))
  if (d.status === 'draft') return base + ' · 库存尚未变动'
  if (d.status === 'confirmed') return base + ' · ' + (d.confirmed_at ? dt(d.confirmed_at) + ' 执行' : '已执行')
  return base + ' · 未影响库存'
})

function statusText (s) {
  return s === 'draft' ? '草稿' : (s === 'confirmed' ? '已完成' : (s === 'voided' ? '已作废' : (s || '—')))
}
function statusTag (s) {
  return s === 'confirmed' ? 'ok' : (s === 'draft' ? 'warn' : '')
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
function rowSub (it) { return Number(it.quantity || 0) * Number(it.unit_price || 0) }

async function loadRefs () {
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
    const all = await whApi.kitList(LIST_LIMIT)
    rows.value = (Array.isArray(all) ? all : []).filter(r => (r.type || 'assemble') === props.type)
  } catch (e) {
    err.value = e.message || (typeLabel.value + '读取失败')
  } finally {
    loading.value = false
  }
}

async function loadDetail (aid) {
  dLoading.value = true
  dErr.value = ''
  try {
    const d = await whApi.kitGet(aid)
    if (!d || !d.id) throw new Error('单据不存在')
    detail.value = d
    items.value = Array.isArray(d.items) ? d.items : []
  } catch (e) {
    dErr.value = e.message || '明细读取失败'
  } finally {
    dLoading.value = false
  }
}

function openDetail (aid) {
  detail.value = { id: aid }
  items.value = []
  loadDetail(aid)
}
function backToList () {
  detail.value = null
  items.value = []
  loadList()
}

/* ---------------- 新建 ---------------- */
/* 组合品（单头）只记 product_id —— `kit_orders` 上没有它的单价字段，
   成本一律由**组件明细**的「数量 × 单位成本」合计得出（见明细页的 total_cost 口径）。
   所以这里刻意不做任何带出，免得让人以为单头也有价。 */
function onPickHead () { /* 单头无价可带，见上 */ }
function addItemRow () {
  _uid += 1
  draft.value.items = draft.value.items.concat([
    { uid: 'kti' + _uid, product_id: 0, quantity: null, unit_price: null },
  ])
}
function onPickItem (row, p) {
  if (!p) return
  const price = Number(p.purchase_price || p.cost_price || 0)
  draft.value.items = draft.value.items.map(it => (
    it.uid === row.uid ? { ...it, unit_price: price || it.unit_price } : it
  ))
}
function removeItemRow (i) {
  draft.value.items = draft.value.items.filter((_, k) => k !== i)
}
function cancelCreate () {
  showCreate.value = false
  headRow.value = { product_id: 0 }
  draft.value = { items: [] }
  form.value = { warehouse_id: form.value.warehouse_id, total_quantity: null, note: '' }
}

async function doCreate () {
  if (busy.value) return
  if (!canCreate.value) { toast(createTitle.value || '信息不完整', 'warn'); return }
  busy.value = true
  try {
    const body = {
      type: props.type,
      product_id: Number(headRow.value.product_id),
      warehouse_id: Number(form.value.warehouse_id || 1),
      total_quantity: Number(form.value.total_quantity || 0),
      note: form.value.note || '',
      /* 🔴 只送有效行：后端会静默丢 pid≤0 / qty≤0 的行，先在前端对齐，
         否则用户以为提交了 5 行、实际只落了 3 行。 */
      items: validItems.value.map(it => ({
        product_id: Number(it.product_id),
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price || 0),
      })),
    }
    const r = await whApi.kitCreate(body)
    if (!r || r.success === false) throw new Error((r && r.error) || '建单失败')
    toast('草稿已建立（库存未变动）', 'success')
    cancelCreate()
    openDetail(r.id)
  } catch (e) {
    toast(e.message || '建单失败', 'error')
  } finally {
    busy.value = false
  }
}

/* ---------------- 确认 / 作废 ---------------- */
async function doConfirm () {
  if (busy.value) return
  const d = detail.value
  const verb = isAsm.value ? '组装' : '拆卸'
  const msg = `确认${verb} ${d.order_no || ('#' + d.id)}？\n\n`
    + (isAsm.value
      ? `将逐行<b>扣减</b> ${items.value.length} 个组件的库存，并<b>加上</b>「${d.product_name || ('商品#' + d.product_id)}」× ${fmtQty(d.total_quantity)}。`
      : `将<b>扣减</b>「${d.product_name || ('商品#' + d.product_id)}」× ${fmtQty(d.total_quantity)}，并逐行<b>加上</b> ${items.value.length} 个组件的库存。`)
    + '\n\n这是实际库存变动，确认后本单不可修改。'
  /* ConfirmDialog 纯文本渲染，去掉 <b> 避免显示字面标签 */
  if (!await confirm(msg.replace(/<\/?b>/g, ''))) return
  busy.value = true
  try {
    const r = await whApi.kitConfirm(d.id)
    /* 🔴 后端非 draft 时是 200 + success:false ⇒ 必须自己判，否则会误报成功 */
    if (!r || r.success === false) throw new Error((r && r.error) || '仅草稿可确认')
    toast(`已${verb} —— 组件成本合计 ${fmtMoney(r.total_cost)}`, 'success')
    await loadDetail(d.id)
  } catch (e) {
    toast(e.message || `${verb}失败`, 'error')
  } finally {
    busy.value = false
  }
}

async function doVoid () {
  if (busy.value) return
  const d = detail.value
  if (!await confirm(`作废 ${d.order_no || ('#' + d.id)}？\n\n草稿作废不涉及库存，作废后不可恢复。`)) return
  busy.value = true
  try {
    await whApi.kitVoid(d.id)
    toast('已作废', 'success')
    await loadDetail(d.id)
  } catch (e) {
    toast(e.message || '作废失败', 'error')
  } finally {
    busy.value = false
  }
}

/* 本页合计：只对可见组合 / 拆分单行的「数量」求和。 */
const ktTotals = computed(() => rows.value.reduce((s, r) => s + Number(r.total_quantity || 0), 0))

onMounted(async () => {
  await Promise.allSettled([loadRefs(), loadList()])
})
defineExpose({ load: loadList })
</script>

<style scoped>
/* 页面私有类一律 `kt-` 前缀（仓配·组拆单）。 */
.kt-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }

.kt-card { padding: 0; overflow: hidden }
.kt-mono { font-variant-numeric: tabular-nums; font-weight: 500 }
.kt-time { font-size: 12px; color: var(--t3) }
.kt-dim { color: var(--t3); font-size: 12px }
.kt-spec { font-size: 11px; color: var(--t3); margin-top: 2px }
.kt-name { font-weight: 500 }

.kt-op {
  border: none; background: none; padding: 0; font-size: 13px;
  color: var(--p-dark); cursor: pointer; white-space: nowrap;
}
.kt-op:hover { text-decoration: underline }

.kt-foot { font-size: 12px; color: var(--t2); margin-top: 12px; line-height: 1.7 }
.kt-empty-hint { font-size: 12px; color: var(--t3); margin-top: 6px }

.kt-tip, .kt-lock {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 12px; padding: 8px 12px; font-size: 12px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
  background: var(--bg2); color: var(--t2);
}
.kt-tip { border-left: 3px solid var(--p) }
.kt-lock { border-left: 3px solid var(--ok); color: var(--ok) }

.kt-meta {
  display: flex; flex-wrap: wrap; gap: 18px;
  margin-bottom: 12px; font-size: 12px; color: var(--t2);
}
.kt-meta b { color: var(--t3); font-weight: 500 }

.kt-tbl { table-layout: fixed }
.kt-mk-tbl { table-layout: fixed }
.kt-in { width: 100%; height: 30px; padding: 0 8px; font-size: 13px; text-align: right; font-variant-numeric: tabular-nums }
.kt-del {
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; padding: 0; cursor: pointer; color: var(--t3);
}
.kt-del:hover { color: var(--dan) }

.kt-foot-lb { font-size: 12px; color: var(--t3); text-align: right }
.kt-foot-amt { font-weight: 600 }

/* 新建区 */
.kt-new { margin-bottom: 12px }
.kt-new-hd {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600; color: var(--t2); margin-bottom: 12px;
}
.kt-new-sub { font-size: 12px; font-weight: 400; color: var(--t3) }
.kt-new-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end }
.kt-new-row-2 { margin-top: 12px }
.kt-fld { display: flex; flex-direction: column; gap: 4px; min-width: 170px }
.kt-fld-grow { flex: 1; min-width: 240px }
.kt-fld-num { width: 140px; min-width: 120px }
.kt-lb { font-size: 12px; color: var(--t3); white-space: nowrap }

.kt-items {
  margin-top: 14px; padding-top: 12px;
  border-top: 1px dashed var(--border-subtle);
}
.kt-items-hd {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600; color: var(--t2); margin-bottom: 10px;
}
.kt-add-item { margin-left: auto }
.kt-items-none { font-size: 12px; color: var(--t3) }

.kt-new-foot {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}
.kt-new-note { font-size: 12px; color: var(--t3) }
</style>
