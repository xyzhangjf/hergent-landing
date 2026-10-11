<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div class="isn-hd-t">
        <h2>{{ cfg.title }}</h2>
        <span v-if="cfg.sub" class="page-sub">{{ cfg.sub }}</span>
      </div>
      <div class="isn-acts">
        <button class="btn btn-ghost btn-sm" :disabled="busy" @click="back">返回</button>
      </div>
    </div>

    <!-- ══ 表单头（框式字段，与销售 / 采购建单页**同一个形态**）════════════════════
         🔴 与舟谱「创建调拨订单」的**有意差异**（老板 2026-10-11 口径 +
            `transfer_orders` 表的真实列）：
            · 舟谱有 `*搬运费` —— 我方**没有这一列** ⇒ 不放。放一个填了不落库的
              输入框就是**假入口**（用户填了、保存了、什么也没发生，且零报错）。
            · 舟谱有 `司机` —— 我方**没有这一列**，且调拨是仓到仓的内部移动、
              不由司机决定归属 ⇒ 不放。
            · 舟谱有 `*经办人` —— 我方由**服务端**从登录身份写 `transfer_orders.operator_id`
              （客户端传什么都不采信）⇒ 不放输入框，改为在读数条里如实显示。
            · 舟谱有 `单据日期` —— 我方 `transfer_orders` 只有 `created_at`
              （写库时取当天）⇒ **只读显示今天**，不做可选日期的假输入。
         三格「假输入」全部撤掉是**有意的取舍**：宁可少一格，也不要一格填了没用。 -->
    <div class="isn-hd isn-hd-flat isn-hd-box">
      <div class="isn-f">
        <label class="isn-lb"><span class="isn-req">*</span>调出仓库</label>
        <select v-model.number="form.from_warehouse_id" class="input isn-sel">
          <option :value="0" disabled>请选择调出仓库</option>
          <option v-for="w in warehouses" :key="w.id" :value="w.id"
                  :disabled="w.id === form.to_warehouse_id">
            {{ w.name }}<template v-if="w.id === form.to_warehouse_id">（已是调入仓）</template>
          </option>
        </select>
      </div>
      <!-- 方向提示：两个下拉之间放一个 `→`，免得看错哪边是调出。
           ⚠️ 不套 `.isn-f`（那是**字段框**，箭头进去会变成"一个装着箭头的空框"）；
              也不用图标 —— 图标库里没有箭头字形，而 `→` 是全站文案规范里允许保留的符号。 -->
      <div class="isn-arrow">→</div>
      <div class="isn-f">
        <label class="isn-lb"><span class="isn-req">*</span>调入仓库</label>
        <select v-model.number="form.to_warehouse_id" class="input isn-sel">
          <option :value="0" disabled>请选择调入仓库</option>
          <option v-for="w in warehouses" :key="w.id" :value="w.id"
                  :disabled="w.id === form.from_warehouse_id">
            {{ w.name }}<template v-if="w.id === form.from_warehouse_id">（已是调出仓）</template>
          </option>
        </select>
      </div>
      <div class="isn-f">
        <label class="isn-lb">单据日期</label>
        <input :value="form.order_date" class="input isn-date" readonly
               title="调拨单按保存当天记录，不能选别的日期" />
      </div>
      <div class="isn-f isn-f-grow">
        <label class="isn-lb">备注</label>
        <input v-model.trim="form.note" maxlength="200" class="input isn-note-in" />
      </div>
    </div>

    <p v-if="cfg.hint" class="isn-hint">{{ cfg.hint }}</p>

    <!-- 读数条：只放**真有的数据**。单据日期那一格是只读的（见表单头注释）。 -->
    <div class="isn-strip">
      <span class="isn-si">
        <span class="isn-sk">调拨方向</span>
        <b>{{ fromWhName }} → {{ toWhName }}</b>
      </span>
      <span class="isn-si">
        <span class="isn-sk">已录商品</span><b>{{ filledRows.length }} 项</b>
      </span>
      <span class="isn-si">
        <span class="isn-sk">单据日期</span><b>{{ form.order_date || '—' }}</b>
      </span>
    </div>

    <!-- 已保存、还没过账的提示条。**必须显眼**：调拨单列表页还没有（见下），
         离开本页就没法再找回这张草稿了 —— 不提示就是在制造一张找不到的单。 -->
    <div v-if="draft && !done" class="isn-at-bar">
      <b>已保存，还没过账</b>
      <span>单号 {{ draft.order_no }} —— 库存**一动没动**，要点右边的「过账」才会真的移库。</span>
      <button class="btn btn-primary btn-sm" :disabled="busy" @click="post">
        <Icon name="check" :size="14" />{{ busy ? '处理中…' : '过账' }}
      </button>
    </div>

    <div v-if="done" class="isn-at-bar ok">
      <b>已过账</b>
      <span>调拨单 {{ draft.order_no }} 的货已经移过去了（调出仓减少、调入仓增加）。</span>
      <button class="btn btn-ghost btn-sm" @click="resetAll">再开一张</button>
    </div>

    <div class="isn-body">
      <div class="isn-bar">
        <b>{{ cfg.tblTitle }}</b>
        <span class="isn-cnt">{{ filledRows.length }} 项</span>
      </div>

      <p v-if="cfg.tip" class="isn-tip">
        <Icon name="lightbulb" :size="14" />
        <span>{{ cfg.tip }}</span>
      </p>

      <div v-if="!items.length" class="state-empty">还没有明细，点击任意行末尾的 + 按钮添加一行。</div>

      <div v-else class="table-wrap">
        <table class="tbl isn-tbl">
          <thead>
            <tr>
              <th class="seq-th col-gear-th"><button class="col-cfg gear" @click.stop="openColMenu" title="列设置"><Icon name="settings" :size="15" /></button></th>
              <th class="isn-c-prod" :style="wStyle('prod')"><span class="isn-req">*</span>商品<ColResizeHandle col="prod" :start="startResize" :reset="resetColW" /></th>
              <th class="num isn-c-qty" :style="wStyle('qty')"><span class="isn-req">*</span>数量<ColResizeHandle col="qty" :start="startResize" :reset="resetColW" /></th>
              <th class="isn-c-unit" v-if="isVisible('unit')" :style="wStyle('unit')">单位<ColResizeHandle col="unit" :start="startResize" :reset="resetColW" /></th>
              <th class="isn-c-op">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in items" :key="row.uid" :data-uid="row.uid">
              <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
              <td class="isn-c-prod">
                <ProductCombo :row="row" :products="products" @pick="onPick" />
              </td>
              <td>
                <input v-model="row.quantity" class="input isn-in num" inputmode="decimal" placeholder="0" />
              </td>
              <td v-if="isVisible('unit')" class="isn-c-unit">
                <span v-if="row.unit" class="isn-unit" :class="{ fallback: row.unitFromBase }"
                      :title="row.unitFromBase ? '商品档案里没设「报单单位」，按基础单位显示' : ''">{{ row.unit }}</span>
                <span v-else class="isn-unit none"></span>
                <div v-if="row.convText" class="isn-conv">{{ row.convText }}</div>
              </td>
              <td class="isn-c-op">
                <button class="btn-row-ic" title="在下面插入一行" :disabled="busy" @click="insertAfter(i)">
                  <Icon name="plus" :size="14" />
                </button>
                <button class="btn-row-ic danger" title="删除这一行" :disabled="busy" @click="removeRow(i)">
                  <Icon name="trash" :size="14" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <ColMenuPanel ref="panel" :col-list="DOC_COLS" :is-visible="isVisible" :toggle-col="toggleCol" :reset-cols="resetCols" />
    </div>

    <div class="isn-bottom">
      <!-- 🔴 这里**不做**跨商品的数量合计：不同商品的小单位不同（袋 / 瓶 / 盒），
           加起来是一个没有意义的数字（同一个坑在销售退货的可退量注释里写过）。
           舟谱底栏显示「合计」—— 我方改成「已录商品 N 项」，宁少一个数字也不编一个。 -->
      <span class="isn-total">已录商品 <b>{{ filledRows.length }}</b> 项</span>
      <div class="isn-save">
        <template v-if="draft && !done">
          <button class="btn btn-ghost btn-sm" @click="resetAll">再开一张</button>
          <button class="btn btn-primary btn-sm" :disabled="busy" @click="post">
            <Icon name="check" :size="14" />{{ busy ? '过账中…' : '过账' }}
          </button>
        </template>
        <template v-else-if="done">
          <button class="btn btn-ghost btn-sm" @click="back">返回</button>
          <button class="btn btn-primary btn-sm" @click="resetAll">再开一张</button>
        </template>
        <template v-else>
          <button class="btn btn-ghost btn-sm" :disabled="busy" @click="saveDraft">
            {{ busy ? '处理中…' : '仅保存草稿' }}
          </button>
          <button class="btn btn-primary btn-sm" :disabled="busy" @click="saveAndPost">
            <Icon name="check" :size="14" />{{ busy ? '处理中…' : '保存并过账' }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 调拨建单内核（v449）—— 一个组件承载**一种**单据：调拨单。
   老板 2026-10-11 口径：**调拨不需要调拨退单**（舟谱也没有这个类型）
   ⇒ 这里只有一种配置；`type` prop 留着是为了和另外两个内核同形，
     将来真要加类型只需在 `docTypes.js` 里加一条配置。

   🔴 为什么调拨**不能**用销售建单内核（虽然拆分前它就是 `?type=transfer`）：
      `sale_orders` 只有**一个** `warehouse_id`，「调出 → 调入」表达不了 ——
      拆分前那个入口建出来的是「一张 `order_type='transfer'` 的销售单，
      只有一个仓库」，名不副实。真正的双仓通道是 `transfer_orders`
      （`from_warehouse_id` / `to_warehouse_id`），走
      `POST /api/psi/transfer-orders`（v449 新端点，归 `inventory` 模块）。

   🔴 **两步动作，不是一个**（这是本页与其它建单页最大的不同）：
      ① 建单 = 只是落一条 `status='draft'` 的调拨单，**库存一动没动**；
      ② 过账 = 逐行「调出仓 −数量 / 调入仓 +数量」，同一笔事务
         （`POST /api/psi/transfer-orders/{id}/complete`）。
      为什么不做成「保存即过账」一步：过账会真动两个仓的库存、且**不可撤销**
      （没有反向单据），必须让操作员明确按第二次。界面上把这两步写成
      「保存并过账」（一次点两下）与「仅保存草稿」（留着稍后过账）两种走法。

   🔴 **已知差距（本轮有意不做，登记在案）**：调拨单**没有列表页** ——
      `transfer_orders` 目前只有列表接口（`GET /api/psi/transfer-orders`），
      没有页面在读它。所以「仅保存草稿」之后离开本页，那张草稿在界面上
      **再也找不回来**（只能从接口过账）。界面已经把这件事说出来（草稿提示条），
      但根治要新建一个调拨单列表页 + 决定「251 张舟谱导入的 `order_type=transfer`
      销售单」与「新建的双仓调拨单」这两套数据怎么同屏（是合并展示还是分区），
      那是产品决策，得老板拍板 ⇒ 不在本轮擅自定。

   反例对照（为什么 `from == to` 要在前端拦一次）：后端也拦（400「调出仓库与
   调入仓库不能是同一个」），前端拦只是为了少一次往返 —— 唯一强制仍在后端。 */
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '../../../components/Icon.vue'
import ProductCombo from './ProductCombo.vue'
import ColMenuPanel from '../../../components/ColMenuPanel.vue'
import { useColSettings } from '../../../composables/useColSettings.js'
import { useColResize } from '../../../composables/useColResize.js'
import ColResizeHandle from '../../../components/ColResizeHandle.vue'
import { psiApi } from '../../../api/psi'
import { toast } from '../../../store'
import { transferDocConfig, TRANSFER_DOC_TYPES } from './docTypes.js'

const props = defineProps({
  type: { type: String, default: TRANSFER_DOC_TYPES.TRANSFER_ORDER },
})
const router = useRouter()
const cfg = computed(() => transferDocConfig(props.type))

/* 列设置：**新的云端偏好键** `inv-transfer-new`。
   🔴 为什么不复用 `inv-sale-new`：那是另一种单据的列（有单价 / 金额），
      共用一份偏好会让「调拨表显隐」和「销售表显隐」互相顶掉。 */
const DOC_COLS = [
  { key: 'prod', label: '商品', core: true },
  { key: 'qty', label: '数量', core: true },
  { key: 'unit', label: '单位', core: false },
]
const { isVisible, toggleCol, resetCols } = useColSettings('inv-transfer-new', DOC_COLS)
const panel = ref(null)
function openColMenu (e) { if (panel.value) panel.value.open(e) }
const { wStyle, startResize, resetColW } = useColResize('inv-transfer-new', DOC_COLS)

const busy = ref(false)
const warehouses = ref([])
const products = ref([])
/** 已建但未过账的调拨单 `{id, order_no}`；非空 ⇒ 底部动作切成「过账 / 再开一张」。 */
const draft = ref(null)
const done = ref(false)

const form = ref({
  from_warehouse_id: 0, to_warehouse_id: 0, note: '', order_date: '',
})

let _uid = 0
const items = ref([])

function todayISO () {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const filledRows = computed(() => items.value.filter(r => Number(r.product_id) > 0))
const whName = (id) => (warehouses.value.find(w => Number(w.id) === Number(id)) || {}).name || '—'
const fromWhName = computed(() => (form.value.from_warehouse_id ? whName(form.value.from_warehouse_id) : '未选'))
const toWhName = computed(() => (form.value.to_warehouse_id ? whName(form.value.to_warehouse_id) : '未选'))

/** v444 规范 §4.1：建单页明细表的**出厂预设空行数**（三个建单内核必须同值）。 */
const PRESET_ROWS = 15

function blankRow () {
  return { uid: ++_uid, product_id: 0, quantity: '', unit: '', unitFromBase: false, unitOptions: [], convText: '', baseUnit: '', barcode: '' }
}
function insertAfter (i) {
  const r = blankRow()
  items.value.splice(i + 1, 0, r)
  scrollRowIntoView(r.uid)
}
function removeRow (i) { items.value.splice(i, 1) }
function scrollRowIntoView (uid) {
  nextTick(() => {
    const el = document.querySelector(`.isn-tbl tbody tr[data-uid="${uid}"]`)
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

/** 从商品档案带出单位 / 条码 / 换算式提示（调拨单无价格列，不取 purchase_price）。
    与采购单 applyProduct 同规则：默认档 = order_unit 命中的档位；没设 / 没命中 ⇒ 小档；
    已有单位（复制旧单 / 编辑）且在档位内则保留，不被档案默认值顶掉。 */
function applyProduct (row) {
  const p = products.value.find(x => x.id === row.product_id)
  if (!p) {
    row.unitOptions = []; row.convText = ''; row.baseUnit = ''; row.barcode = ''
    row.unit = ''; row.unitFromBase = false
    return
  }
  row.unitOptions = Array.isArray(p.unit_options) ? p.unit_options : []
  row.convText = String(p.conv_text || '')
  row.baseUnit = String(p.unit || '')
  const ou = String(p.order_unit || '').trim()
  const hit = row.unitOptions.find(o => o.name === ou)
  const keep = row.unit && row.unitOptions.some(o => o.name === row.unit)
  if (!keep) {
    row.unit = hit ? hit.name : (row.unitOptions[0] ? row.unitOptions[0].name : '')
    row.unitFromBase = !hit && !!row.unit
  }
  row.barcode = String(p.barcode || '')
}
function onPick (row) {
  applyProduct(row)
}

function validate () {
  if (!form.value.from_warehouse_id) return '请选择调出仓库'
  if (!form.value.to_warehouse_id) return '请选择调入仓库'
  if (Number(form.value.from_warehouse_id) === Number(form.value.to_warehouse_id)) {
    return '调出仓库与调入仓库不能是同一个'
  }
  if (!filledRows.value.length) return '请至少添加一行调拨明细'
  const rows = filledRows.value
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!(Number(r.quantity) > 0)) {
      return `第 ${items.value.indexOf(r) + 1} 行：数量要大于 0`
    }
  }
  return ''
}

function buildBody () {
  return {
    from_warehouse_id: Number(form.value.from_warehouse_id),
    to_warehouse_id: Number(form.value.to_warehouse_id),
    note: form.value.note || '',
    /* ⚠️ `product_name` 一起带上：后端 `_parse_doc_items` 那一族用它拼错误提示
       （「「蒙牛纯甄」的调拨数量要大于 0」），不带就只能显示「商品 123」。
       `unit_price` **不传** —— 调拨是内部移库，我方明细表没有价格列。 */
    items: filledRows.value.map(r => ({
      product_id: r.product_id,
      product_name: (products.value.find(p => Number(p.id) === Number(r.product_id)) || {}).name || '',
      quantity: Number(r.quantity),
    })),
  }
}

/** 第一步：落一张草稿调拨单。成功 ⇒ `draft` 就位（**不跳页**，见文件头）。 */
async function saveDraft () {
  const bad = validate()
  if (bad) { toast(bad, 'warn'); return false }
  if (busy.value) return false
  busy.value = true
  try {
    const r = await psiApi.createTransfer(buildBody())
    /* 🔴 幂等：`transfer_order_create` **没有**幂等键（`_gen_no("TF")` 每次都是新单号）
       ⇒ 重复点击会落下两张草稿。所以这里**立刻**把按钮切成「过账」，
         并在 `busy` 期间禁用 —— 这是本页唯一的防重手段，不能省。 */
    draft.value = { id: r && (r.id || r.order_id), order_no: (r && r.order_no) || '' }
    toast(`调拨单已保存（${draft.value.order_no || '#' + draft.value.id}），还没过账`, 'success')
    return true
  } catch (e) {
    toast(e.message || '保存失败', 'error')
    return false
  } finally {
    busy.value = false
  }
}

/** 第二步：过账（真的移库）。 */
async function post () {
  if (!draft.value || busy.value) return
  busy.value = true
  try {
    await psiApi.completeTransfer(draft.value.id)
    done.value = true
    toast(`调拨单 ${draft.value.order_no || ''} 已过账，库存已移动`, 'success')
  } catch (e) {
    /* 过账失败后端会给人话（如「调出仓库存不足」）—— 原样显示。
       ⚠️ 失败时 `draft` **保持不变**：那张草稿还在、还能改完库存再试一次
          （后端过账走同一笔事务，失败即整体回滚，**不会**留下半截调拨）。 */
    toast(e.message || '过账失败', 'error')
  } finally {
    busy.value = false
  }
}

async function saveAndPost () {
  const ok = await saveDraft()
  if (ok) await post()
}

function resetAll () {
  draft.value = null
  done.value = false
  form.value = {
    /* 调出 / 调入仓**保留**（连开几张多半同一对仓），备注清空。 */
    from_warehouse_id: form.value.from_warehouse_id || 0,
    to_warehouse_id: form.value.to_warehouse_id || 0,
    note: '',
    order_date: todayISO(),
  }
  items.value = []
  for (let i = 0; i < PRESET_ROWS; i++) items.value.push(blankRow())
}

function back () {
  /* 🔴 调拨单列表页还不存在（见文件头「已知差距」）⇒ 退回销售单列表的调拨视图
     —— 那是**当前唯一**能看到「舟谱导入的调拨类单据」的地方。
     新建的双仓调拨单不在那张列表里（两套数据），所以这里会在 toast 里说清楚。 */
  if (draft.value && !done.value) {
    toast('这张调拨单还是草稿。调拨单列表页还没做，离开后暂时找不回来。', 'warn')
  }
  router.push({ path: cfg.value.listPath, query: { type: 'transfer', kind: 'order' } })
}

async function loadRefs () {
  try {
    const d = await psiApi.refs('warehouses,products', '', 500)
    warehouses.value = d.warehouses || []
    products.value = d.products || []
    const defs = warehouses.value.filter(w => w.is_default)
    const pick = (defs.length ? defs : warehouses.value).slice().sort((a, b) => a.id - b.id)[0]
    if (pick) form.value.from_warehouse_id = pick.id
  } catch (e) {
    toast(e.message || '基础资料读取失败', 'error')
  }
}

onMounted(() => { resetAll(); loadRefs() })
</script>

<style scoped>
/* 🔴 本样式块与 `SaleDocForm.vue` 的 `.isn-*` 块**逐字节相同**（抽取自 v448 的
   `InvSaleNew.vue`）—— 目的是让调拨页与销售 / 采购建单页在字号 / 行高 / 内距 /
   控件宽高上**共用同一份数值**（《进销存建单页开发规范》§R 的视觉基准）。
   ⚠️ 为什么是**复制**而不是抽成一个共享 css 文件：`<style scoped>` 编译后会给每条
      规则加上 `[data-v-xxx]`（特异性 0,2,0）；抽成全局文件后掉回 (0,1,0)
      ⇒ 会被其它全局规则盖住 —— §R 的基准会**静默漂移**，而且只在某些页面看得出来。
      复制能保证特异性一模一样。
   ⚠️ 代价：改 §R 基准时要同时改两份（或更多）。**改之前先 grep 一遍 `.isn-`**，
      确认还有哪些文件带着这一块。
   本文件**额外**加的是末尾那几条（`.isn-arrow` 方向符号 + `.isn-at-bar` 草稿提示条
   —— 后者销售页不需要，因为销售刚建出来的单在列表里找得到）。 */
/* 🔴 竖排 + 底部条两件套：目的是让底部动作条在**内容不足一屏时也钉在视口底部**
   （对齐舟谱：合计与保存在最底一行），内容超一屏时由页内滚动区接管。
   高度链 = InventoryShell 的 `.page{display:flex;flex-direction:column;min-height:100%}`
   ＋ 本页的 `.inv-page`；两处必须**成对**存在，只改一边就会退回原状
   （v403 实测：中间层高度 auto ⇒ 百分比链断开、动作条紧贴明细表）。
   ⚠️ 若 `InventoryShell` 的容器契约改了（`.page` 不再是竖排 flex），这里要一起看。 */
.inv-page { display: flex; flex-direction: column; min-height: 100% }
/* 让 `.isn-body` 成为**唯一占满剩余高度**的滚动容器，表格在内部滚动；
   其它兄弟元素只取内容高度，不再分走空间（覆盖 Shell 的 `:deep(*)` 的 `flex:1 1 auto`）。
   这样新增行永远落在 `.isn-body` 滚动区内，不会被底部合计条盖住。 */
.inv-page > .page-hd,
.inv-page > .isn-hd,
.inv-page > .isn-strip,
.inv-page > .isn-bottom { flex: 0 0 auto }
.isn-acts { display: flex; gap: 8px; flex-wrap: wrap }
.isn-body {
  display: flex; flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.isn-body > .isn-bar,
.isn-body > .isn-tip,
.isn-body > .state-empty,
.isn-body > .state-error { flex: 0 0 auto }
.isn-body > .table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 0;
  border-radius: 0;
}

/* 页头单行 —— 标题与副标题回到**同一基线行**（全局 `.page-hd` 的「内联 / 堆叠」
   由模板结构分派：外面包一层 div 就会回落到两行，故这里只给内层容器定对齐）。 */
.isn-hd-t { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0 }

/* 表单头。标签与框**同行**（v438 定的口径）：每格由「12px 标签 + 4px 间距 + 32px 框
   ≈ 48px」压到 32px，且一行能并更多字段 —— 紧凑感就来自这里。 */
.isn-hd { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px }
/* 去卡片包裹：页面底 `.content{background:var(--bg)}` 与 `.card{background:var(--bg)}`
   同色 —— 那个框本来只是 border+shadow，去掉不影响配色（深色同理）。
   scoped 属性把特异性抬到 0,2,0 > 全局 `.card` 的 0,1,0，覆盖必然生效（无需 !important）。 */
.isn-hd-flat { padding: 0; background: transparent; border: 0; border-radius: 0; box-shadow: none }
/* 🔴 `flex: none` 是**必需的**：少了它，`flex-shrink` 会把没有 min-width 的格挤窄，
   格内的「标签 + 控件」随即被 `flex-wrap` **拆成上下两行**。改成 flex:none 后，
   宽度放不下时整格换行，永不把标签与框拆开。 */
.isn-f { display: flex; flex-direction: row; align-items: center; gap: 6px; flex-wrap: wrap; flex: none }
.isn-f-grow { flex: 1; min-width: 160px }
/* 退货模式「原销售单」格必须**给死宽度**：它带一句 `.isn-hint`（`flex-basis:100%`），
   百分比基会把这一格的 max-content 撑得很宽，而 `.isn-f` 是 `flex:none`（不再回缩）
   ⇒ 右侧会留一大片空白，把后面「客户 / 退货仓库 / 原单状态」推到半屏外。 */
.isn-f-so { width: 380px }
.isn-lb { font-size: 12px; color: var(--t3); white-space: nowrap; flex: none }
/* 必填标记：用**红 `*`**（对齐舟谱的 `*供应商：`）—— 每个必填格省下 2 个字的宽度，
   一行更容易并下全部字段。**不用**「必填」两个字，也**不写**「选填」（无 `*` 即选填）。 */
.isn-req { color: var(--dan); font-size: 13px; line-height: 1; margin-right: 2px }

/* ══ 框式字段（复刻舟谱建单头）═════════════════════════════════════════════
   舟谱建单头那排是「**一个描边框**里左边标签、右边值」，不是「标签在框外、旁边再放一个框」。
   这里把 `.isn-f` 本身做成那个框：
     · 框 = 底色 + 1px 描边 + 圆角 + 左右内距，标签与值都是框内的 flex 子项；
     · 框内控件**必须去掉自己的边框 / 底色 / 内距** —— 否则「框里再套一个框」。
       🔴 全局 `.input` 是 `width:100%`：在横排框里会解析成「撑满整框」并把标签挤出去
          ⇒ 这里一律 `width:auto`，宽度由各控件自己的类显式给。
     · 高度：框内控件收到 30px ⇒ 框 = 30 + 上下 1px 边框 = **32px**，与全站输入框同高。
     · 聚焦高亮**上移到框**（`:focus-within`）；框内控件的 focus 环要关掉，
       否则一大一小两层环。
     · 标签的冒号（`*供应商：`）由 `::after` 生成，**不改模板文案**。
   🔴 v448 起**退单模式也挂**（原先刻意不挂，理由已随本轮作废：那排有只读格 ——
      处理方式见下方 `.isn-ro` 的规则）。同一个建单页的两种模式 / 同一批退单入口
      必须是同一套界面。 */
.isn-hd-box .isn-f {
  flex-wrap: nowrap;
  padding: 0 6px 0 10px; gap: 4px;
  background: var(--bg3); border: 1px solid var(--bd); border-radius: var(--radius-sm);
}
.isn-hd-box .isn-f:focus-within { border-color: var(--p-dark); box-shadow: 0 0 0 3px var(--p-bg) }
.isn-hd-box .isn-lb::after { content: '：' }
.isn-hd-box .isn-f .input {
  width: auto; min-width: 0; height: 30px; padding: 0 2px;
  border: 0; border-radius: 0; background: transparent; box-shadow: none;
}
.isn-hd-box .isn-f .input:focus { border-color: transparent; box-shadow: none }
/* 框内控件宽度（覆盖全局 `.input{width:100%}`——见上）。
   112 / 120 是**实测**值：本租户仓名「东津仓」3 字、日期串「2026/10/10」
   都在此宽度内完整显示；再窄会把日期控件的日历图标挤掉。 */
.isn-hd-box .isn-f .isn-kw { width: 112px }
.isn-hd-box .isn-f .isn-sel { width: 112px }
.isn-hd-box .isn-f .isn-date { width: 120px }
.isn-hd-box .isn-f .isn-addr { width: 150px }
.isn-hd-box .isn-f .isn-note-in { flex: 1; width: auto; min-width: 120px }

/* 退货模式的说明（v448：由「原销售单」格内**移到表单头外**）。
   留在框里会把那一格撑到 120px 高、四个框永远不等高；移出后表单头 = 四个 32px 等高的框。
   `max-width` 由 340 放到 900：它现在占整行，不必再挤在 380px 的格里反复换行。
   `-6px` 上边距抵掉表单头那 12px 的下外边距，让说明贴着它说明的那个头。 */
.isn-hint { font-size: 11px; color: var(--t3); line-height: 1.4; max-width: 900px; margin: -6px 0 12px }
.isn-hint b { color: var(--t2) }
/* 只读值（退货模式的客户 / 退货仓库 / 原单状态）：由原单带出，**改不了**
   （刻意不用 disabled input —— 那会让人以为点开能改）。
   v448：退单头改框式后，它**进框成为「值」** —— 与框内控件同款（30px 高 / 无边框 /
   无底色 / 内距 `0 2px` / 14px），只差不能输入。
   🔴 撤掉原先的 `1px dashed + --bg2` 虚线框：那套「虚框 = 不可改」是**自造语义**，
      放进框式头更像「少画了一半的框」。「不可改」交回它该在的地方 ——
      点不动、没有下拉箭头。
   `min-width: 112px` = §R.4 里下拉的宽度：**不取下限的话**格宽由值的长短决定
   （没选原单时值是 `—`，整格只有 74px；一选中又被撑宽）⇒ 表头跟着来回跳。
   `max-width` + 省略号：客户 / 仓名长度不可控，别让它把这一格撑爆。 */
.isn-ro {
  display: flex; align-items: center; height: 30px; padding: 0 2px;
  min-width: 112px; max-width: 260px; flex: none;
  font-size: 14px; color: var(--t1); background: transparent; border: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* 「原销售单」格宽度放宽到 420px：框式头有 16px 左右内距，且框内控件收掉了全局
   `.input` 的 `width:100%`，380px 装不下「标签 + 搜索框 + 下拉」。
   v448：说明行已挪到框外 ⇒ 这一格与其余三格同是 32px 等高，不再需要 `flex-wrap: wrap`。 */
.isn-hd-box .isn-f-so { width: 420px }
/* 🔴 框式头里 `.isn-hd-box .isn-f .input { width: auto }`（0,3,0）会**吃掉**
   `.isn-kw{width:130px}` / `.isn-sel{min-width:140px}`（0,1,0）⇒ 显式写回。
   只限定在「原销售单」格：订单模式那排（含「出货方式」下拉 `.isn-sel`）一个都不动。 */
.isn-hd-box .isn-f-so .isn-kw { width: 130px }
.isn-hd-box .isn-f-so .isn-sel { width: 200px; min-width: 0 }
/* 退货模式「原销售单」搜索框 + 下拉：仍是两框并列 */
.isn-pick { display: flex; gap: 6px }
.isn-kw { width: 130px; height: 32px }
.isn-sel { min-width: 140px; height: 32px }
.isn-date { width: 140px; height: 32px }
.isn-addr { width: 180px; height: 32px }
.isn-note-in { flex: 1; min-width: 140px; height: 32px; padding: 0 10px }

/* 读数条（舟谱「应付/预付余额」那条的位置）—— 品牌色浅底 + 细边 + 圆角 */
.isn-strip {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  margin-bottom: 12px; padding: 9px 16px;
  background: var(--p-bg); border: 1px solid var(--p-border);
  border-radius: var(--radius-md); font-size: 13px; color: var(--t1);
}
.isn-si { display: inline-flex; align-items: center; gap: 6px }
.isn-sk { color: var(--t3); font-size: 12px }
.isn-strip-amt { color: var(--p-ink); font-variant-numeric: tabular-nums }

/* 明细工具条 */
.isn-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px }
.isn-cnt { color: var(--t3); font-variant-numeric: tabular-nums; flex: none }
.isn-tip { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; color: var(--t2); margin: 0 0 10px }
.isn-tip svg { color: var(--p-dark); flex: none; margin-top: 1px }
.isn-tip b { color: var(--t1) }
/* 退货明细的工具条（全部可退 / 清零）：推到右侧，不与标题挤在一起 */
.isn-ret-quick { display: flex; gap: 8px; margin-left: auto }
/* 退货明细列少（9 列 vs 销售单 7 列）⇒ 表宽给个下限，避免列被压扁 */
/* 退货明细列少（9 列 vs 销售单 8 列 + 换算，表更窄）⇒ 表宽小一档。
   🔴 v448 提权重到 `.isn-tbl.isn-ret-tbl`：原先写单类 `.isn-ret-tbl`（0,1,0），
      在文件里排在 `.isn-tbl { min-width: 720px }`（同为 0,1,0）**之前** ⇒ 被静默吃掉，
      退货表实际按 720px 渲染（"小一档"从未生效）。同权重靠顺序取胜是隐式的 ——
      谁把这两条换个位置就又翻回去，故用两个类把意图写死。 */
.isn-tbl.isn-ret-tbl { min-width: 900px }
.isn-ret-unit { width: 72px; color: var(--t2) }
/* 底部「退货原因」：吃掉左侧以外的空白，把右侧的保存按钮顶到最右 */
.isn-ret-reason { flex: 1; min-width: 220px; height: 32px }

/* ══ v447：明细表内距**对齐基准**（「新建采购订单」）════════════════════════════
   本页原先**一条内距规则都没有** ⇒ 落到全局 `table.tbl th/td{padding:10px 14px}`，
   真机实测数据行高被顶到 **62.6px**（基准 31.8）、表头 46.5（基准 38.5），
   同屏只放得下 14.99 行 vs 基准 21.12 行 —— 少 6 行。
   🔴 选择器**必须**带 `table.isn-tbl`：写成 `.isn-tbl td` 的 specificity (0,1,1)
      低于全局 `table.tbl td` (0,1,2) ⇒ 静默不生效（这一条与采购建单页同源）。
   🔴 `td.seq-cell` 那条是**与全局 `table.tbl td.seq-cell`(0,2,2) 打平手**后靠
      「页面样式后加载」才赢的 —— 采购建单页也是这么做的（实测 2px 4px 生效）。
      去掉它就退回全局的 `padding:6px 4px`，序号列会自己被顶高、把整行撑起来。 */
table.isn-tbl th { padding: 4px 8px }
table.isn-tbl td { padding: 2px 8px }
table.isn-tbl td.seq-cell { padding: 2px 4px }
/* 🔴 紧凑档必须**在本页再收一档**（同采购建单页）：全局
   `[data-density="compact"] table.tbl td{padding:4px 10px}` = (0,2,2) 压过上面的
   `table.isn-tbl td` (0,1,2) ⇒ 只写普通档的话，开关一打开本页反而比基准更松（半截生效）。 */
[data-density="compact"] table.isn-tbl th { padding: 3px 8px }
[data-density="compact"] table.isn-tbl td { padding: 1px 8px }
[data-density="compact"] .isn-in { height: 20px }

/* 明细表列宽。数量 / 单价 / 金额等宽数字 + 右对齐，成列才好扫读。 */
.isn-tbl { min-width: 720px }
.isn-c-prod { min-width: 280px }
.isn-c-qty, .isn-c-price, .isn-c-amt { width: 110px }
.isn-c-unit { width: 76px }
.isn-c-stk { width: 86px; font-variant-numeric: tabular-nums; white-space: nowrap }
.isn-c-op { width: 64px }
table.isn-tbl th.isn-c-op, table.isn-tbl td.isn-c-op { position: sticky; right: 0; z-index: 2 }
table.isn-tbl th.isn-c-op { background: var(--bg2) }
table.isn-tbl tbody tr:hover td.isn-c-op { background: var(--bg2) }
/* v447：与采购建单页 `.ipn-in` **逐值对齐**（明细格控件高 28 → 22）。
   原值 28px 是本页单独写的，比基准高 6px —— 真机实测它把数据行顶到 62.6px
   （基准 31.8），同屏少放 6 行。字号 / 内距 / 圆角三项同采购页：
   不写就继承全局 `.input`（14px / `0 14px` / radius-md=12），本页 CSS 里看不到这些数。
   `padding` 取 3px 与采购页同值（1px 真边框 + 3px = 4px 内容内距，与 `.ipn-v` 的 4px 对齐）。 */
.isn-in { width: 100%; height: 22px; font-size: 13px; padding: 0 3px; border-radius: var(--radius-sm) }
/* v444：**撤掉**明细表输入框的底色 —— 全局 `.input{background:var(--bg3)}` 在 15 行 × 7 列
   铺下来是满屏灰底方块，压过了数据本身（老板原话：「全屏输入框给人感觉确实有点压抑」）。
   🔴 必须**显式写 transparent** 而不是把规则删掉：删了会让输入框退回全局 `.input` 的
      灰底 —— 那正是「样式看着改了、实际没生效」的静默失效。
   「哪里能填」改由 hover / focus 时的描边承载，不再靠底色。
   与采购建单页同一口径（`InvPurchaseNew.vue` 的 `.ipn-in` / `.ipn-v` 两条）。 */
table.isn-tbl .isn-in:not(:focus) { background: transparent; border-color: transparent }
/* ══ v445：明细表输入框「默认无框」（与采购建单页 `.ipn-in` 完全同一口径）════════
   🔴 只切 `border-color` 为 transparent、**不改 border 宽度**：盒模型一字不变 ⇒
   hover ⇄ focus 切换零尺寸抖动、表格行零位移（写 `border:none` 会让输入框缩 2px）。
   🔴 「默认透明」specificity (0,3,1) 会压过全局 `.input.err`(0,2,0) ⇒ 错误红框会被
   一起变没，故 `.err` / `:disabled` / `[readonly]` 三条必须在下面显式写回。 */
table.isn-tbl tr:hover .isn-in:not(:focus):not(:disabled):not([readonly]) { border-color: var(--bd) }
table.isn-tbl .isn-in:focus { border-color: var(--p-dark); box-shadow: 0 0 0 3px var(--p-bg) }
/* 禁用 / 只读：永不浮框（退货明细「退货数量」无可退量时是 disabled，浮框=假承诺） */
table.isn-tbl .isn-in:disabled,
table.isn-tbl .isn-in[readonly] { border-color: transparent; box-shadow: none }
/* 校验错误：红框默认可见；focus 的外发光也要写回红色，否则被上面的青光盖住 */
table.isn-tbl .isn-in.err,
table.isn-tbl .isn-in.err:focus { border-color: var(--dan) }
table.isn-tbl .isn-in.err:focus { box-shadow: 0 0 0 3px var(--dan-bg) }
.isn-in.num { text-align: right; font-variant-numeric: tabular-nums }
.isn-amt { font-variant-numeric: tabular-nums; white-space: nowrap }
/* 换算 / 原单数量小字：它是解释不是数据，弱化色 + 不换行（不加 nowrap 会在窄列里
   断成两行，把行高顶起来）。 */
.isn-conv { font-size: 11px; color: var(--t3); white-space: nowrap }
.isn-unit { font-size: 13px; color: var(--t1) }
/* 档案没设报单单位时的回落值 —— 用弱化色标注，不静默 */
.isn-unit.fallback, .isn-unit.none { color: var(--t3) }

/* 底部动作条：普通 flex 项，由 `.inv-page` 布局推到 `.isn-body` 下方
   （不用 sticky —— `.isn-body` 自己滚动占满剩余高度，动作条自然落在它下面，
   也不会盖住表格最后一行）。负边距用于抵消 Shell 的 `.view-wrap{padding:20px}`。 */
.isn-bottom {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  flex: 0 0 auto;
  margin: auto -20px -20px -20px; padding: 4px 20px;
  background: var(--bg); border-top: 1px solid var(--border-subtle);
}
.isn-total { font-size: 14px }
.isn-total b { font-size: 18px; font-variant-numeric: tabular-nums }
.isn-save { position: relative; display: inline-flex; gap: 8px; margin-left: auto }

@media (max-width: 640px) {
  .isn-hd { align-items: stretch }
  .isn-f, .isn-kw, .isn-sel, .isn-date, .isn-addr { width: 100%; min-width: 0 }
  .isn-pick { flex-direction: column }
  .isn-bottom { margin-inline: 0; padding-inline: 0 }
  /* 窄屏下框内控件要跟着撑满 —— 不写这几条，上面框式规则的定宽特异性更高
     （`.isn-hd-box .isn-f .isn-sel` 0,3,0 > `.isn-sel` 0,1,0），会把媒体查询的
     「全宽」顶掉，留下 112px 的短框 + 右半行空白。 */
  .isn-hd-box .isn-f { width: 100% }
  .isn-hd-box .isn-f .isn-sel,
  .isn-hd-box .isn-f .isn-date,
  .isn-hd-box .isn-f .isn-kw,
  .isn-hd-box .isn-f .isn-addr { width: auto; flex: 1; min-width: 0 }
}

/* ══ v449（销售侧拆分）══════════════════════════════════════════════════════
   框式头里 `.isn-hd-box .isn-f .input { width: auto }`（特异性 0,3,0）会**吃掉**
   `.isn-kw { width:130px }` / `.isn-sel { min-width:140px }`（0,1,0）—— 必须**显式写回**，
   否则「客户」格里的搜索框与下拉会塌成 auto（v448 在「原销售单」格上踩过同一个坑）。
   `.isn-f-cust` = 客户格（搜索框 + 下拉两件）。
   ⚠️ `.isn-f-so`（原先给「原销售单」格的 420px）与 `.isn-tbl.isn-ret-tbl`（退货表
      min-width 900px）随 v449 撤掉「选原单 + 独立退货明细表」而**不再被使用**；
      规则留着不删（删它们不影响任何渲染，而留下能让人看出"这里曾经是什么"）。 */
.isn-hd-box .isn-f-cust .isn-kw { width: 130px }
.isn-hd-box .isn-f-cust .isn-sel { width: 200px; min-width: 0 }

/* ---- 调拨页**额外**的两条（不在 §R 共享块里）-------------------------------- */

/* 「调出 → 调入」之间的方向符号。
   `align-self:center` 让它对着两个**字段框**的中线（框高 32px），不是文字基线。 */
.isn-arrow { flex: none; align-self: center; font-size: 15px; line-height: 1; color: var(--t3); padding: 0 2px }

/* 草稿 / 已过账提示条（调拨页专用）。
   为什么不是 `.isn-strip`：那条是**读数**（已有的数据）；这条是**动作提示** ——
   有一件事还没做完。所以底色用品牌浅底 + 右侧跟一个动作按钮，看起来像"待办"。
   `.ok` 变体退回中性底色：过账已经完成，不该继续用"待办"的视觉。 */
.isn-at-bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-bottom: 12px; padding: 9px 16px;
  background: var(--p-bg); border: 1px solid var(--p-dark); border-radius: var(--radius-md);
  font-size: 13px; color: var(--t1);
}
.isn-at-bar > b { flex: none }
.isn-at-bar > span { flex: 1; min-width: 200px; color: var(--t2) }
.isn-at-bar > .btn { flex: none }
.isn-at-bar.ok { background: var(--bg2); border-color: var(--bd) }

</style>
