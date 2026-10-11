<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div class="isn-hd-t">
        <h2>{{ cfg.title }}</h2>
        <span v-if="cfg.sub" class="page-sub">{{ cfg.sub }}</span>
      </div>
      <div class="isn-acts">
        <!-- 附件入口：本内核**刻意不给**。采购侧那一个靠
             `/api/psi/purchase-orders/{id}/attachments` 四个带归属校验的端点；
             销售这条路线**还没有**对应端点 ⇒ 放一个按钮就是假入口（点了必然失败）。 -->
        <button class="btn btn-ghost btn-sm" :disabled="saving" @click="back">返回列表</button>
        <button v-if="!cfg.isReturn" class="btn btn-primary btn-sm" :disabled="saving" @click="submit('save')">
          <Icon name="save" :size="14" />{{ saving ? '提交中…' : '保存' }}
        </button>
      </div>
    </div>

    <!-- ══ v449 表单头（订单 / 退单**同一形态**，只是标签与字段集按类型不同）═════════
         为什么退单不再有「原单选择」：老板口径（2026-10-11）原话 ——
         「退货单**不需要**选原采购单/销售单，**退货仓库要可以指定**」。
         旧实现里退货必须挂一张原销售单（后端 `return_order_create` 要用它取客户与
         仓库），于是整页被拆成两套分支；现在退货自己带「客户 + 退货仓库」，
         与订单是**同一个表单形态** ⇒ 一套模板 + 配置驱动，差异落在字段标签与提交端点上。
         ⚠️ 这一版**保留**的退单语义：库存回增、冲减客户应收、幂等键、退货原因。
            丢掉的只有「必须先挑原单」这一步（可退上限也就不存在了 —— 老板口径如此）。 -->
    <div class="isn-hd isn-hd-flat isn-hd-box">
      <div class="isn-f isn-f-cust">
        <label class="isn-lb"><span class="isn-req">*</span>客户</label>
        <!-- v450：客户选择换成与新建采购单「供应商」逐像素一致的 `CustomerCombo.vue`
             （搜索+选择合一的组合框：本地按名称/编号模糊匹配、下拉点选、打字清空旧选、
             失焦还原已选名、键盘 ↑/↓/Enter/Esc）。仅语义词「供应商→客户」不同，交互照搬。 -->
        <CustomerCombo v-model="form.customer_id" :customers="customers" />
      </div>
      <!-- 部门：舟谱建单头那一格 `*部门`。我方**选填**（后端 `sale_orders.department`
           是 TEXT，v88 迁移就有，但 v449 之前**没有任何调用方写过它** ⇒ 舟谱导入的
           单据上这格有值、手工建的单一直是空）。
           🔴 提交的是**部门名**（不是 `departments.id`）：销售单那一列就是 TEXT，
              与采购单的 `department_id`（INTEGER，存 id）**不是一回事** ——
              两页看起来同名、落库形态不同，别互抄。 -->
      <div v-if="cfg.hasDept" class="isn-f">
        <label class="isn-lb">部门</label>
        <select v-model="form.department" class="input isn-sel">
          <option value="">不指定</option>
          <option v-for="d in departments" :key="d.id" :value="d.name">{{ d.name }}</option>
        </select>
      </div>
      <div class="isn-f">
        <label class="isn-lb"><span class="isn-req">*</span>{{ cfg.whLabel }}</label>
        <select v-model.number="form.warehouse_id" class="input isn-sel">
          <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
      </div>
      <!-- 车销才有「送货司机」（自提没有，调拨走另一条内核）。 -->
      <div v-if="cfg.hasDriver" class="isn-f">
        <label class="isn-lb">送货司机</label>
        <select v-model="form.driver_id" class="input isn-sel">
          <option value="">不指定</option>
          <option v-for="u in users" :key="u.id" :value="String(u.id)">{{ u.name }}</option>
        </select>
      </div>
      <div class="isn-f">
        <label class="isn-lb">单据日期</label>
        <input type="date" v-model="form.order_date" class="input isn-date" />
      </div>
      <div v-if="!cfg.isReturn" class="isn-f">
        <label class="isn-lb">交货日期</label>
        <input type="date" v-model="form.delivery_date" class="input isn-date" />
      </div>
      <div v-if="!cfg.isReturn" class="isn-f">
        <label class="isn-lb">交货地址</label>
        <input v-model.trim="form.delivery_address" class="input isn-addr" />
      </div>
      <div class="isn-f isn-f-grow">
        <label class="isn-lb">备注</label>
        <input v-model.trim="form.note" maxlength="200" class="input isn-note-in" />
      </div>
    </div>

    <!-- 说明行**必须在表单头之外**（规范 §2.2）：留在框里会把那一格撑高 ⇒ 框不再等高。 -->
    <p class="isn-hint">{{ cfg.hint }}</p>

    <div v-if="selCustomer" class="isn-strip">
      <span class="isn-si">
        <span class="isn-sk">客户</span><b>{{ selCustomer.name }}</b>
      </span>
      <span class="isn-si">
        <span class="isn-sk">信用额度</span>
        <b class="isn-strip-amt">{{ Number(selCustomer.credit_limit) > 0 ? '¥' + fmtMoney(selCustomer.credit_limit) : '—' }}</b>
      </span>
      <span v-if="Number(selCustomer.credit_days) > 0" class="isn-si">
        <span class="isn-sk">账期</span><b>{{ Number(selCustomer.credit_days) }} 天</b>
      </span>
      <span class="isn-si">
        <span class="isn-sk">已录商品</span><b>{{ filledRows.length }} 项</b>
      </span>
      <span class="isn-si">
        <span class="isn-sk">{{ cfg.isReturn ? '退货合计' : '合计' }}</span>
        <b class="isn-strip-amt">¥{{ fmtMoney(totalAmount) }}</b>
      </span>
    </div>

    <div class="isn-body">
      <div class="isn-bar">
        <b>{{ cfg.tblTitle }}</b>
        <span class="isn-cnt">{{ filledRows.length }} 项</span>
        <input v-model.trim="prodKw" class="input isn-prod-kw" placeholder="输入商品名筛选下面的商品下拉" />
        <button class="btn btn-ghost btn-sm" @click="addRow"><Icon name="plus" :size="14" />加一行</button>
      </div>

      <p class="isn-tip">
        <Icon name="lightbulb" :size="14" />
        <span>{{ cfg.tip }}</span>
      </p>

      <div v-if="!items.length" class="state-empty">还没有明细，点右上角「加一行」开始。</div>

      <div v-else class="table-wrap">
        <table class="tbl isn-tbl">
          <thead>
            <tr>
              <th class="seq-th col-gear-th"><button class="col-cfg gear" @click.stop="openColMenu" title="列设置"><Icon name="settings" :size="15" /></button></th>
              <!-- 必填三列（商品 / 数量 / 单价）打红 `*`，判据 = `validate()` 里实际拦的字段。 -->
              <th class="isn-c-prod" :style="wStyle('prod')"><span class="isn-req">*</span>商品<ColResizeHandle col="prod" :start="startResize" :reset="resetColW" /></th>
              <th class="num isn-c-qty" :style="wStyle('qty')"><span class="isn-req">*</span>数量<ColResizeHandle col="qty" :start="startResize" :reset="resetColW" /></th>
              <th class="isn-c-unit" v-if="isVisible('unit')" :style="wStyle('unit')">单位<ColResizeHandle col="unit" :start="startResize" :reset="resetColW" /></th>
              <th class="num isn-c-price" :style="wStyle('price')"><span class="isn-req">*</span>{{ cfg.priceLabel }}<ColResizeHandle col="price" :start="startResize" :reset="resetColW" /></th>
              <th class="num isn-c-amt" v-if="isVisible('amt')" :style="wStyle('amt')">金额<ColResizeHandle col="amt" :start="startResize" :reset="resetColW" /></th>
              <th class="isn-c-del"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in items" :key="row.uid">
              <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
              <td>
                <select v-model.number="row.product_id" class="input isn-in" @change="onPick(row)">
                  <option :value="0" disabled></option>
                  <option v-for="p in prodOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </td>
              <td>
                <input v-model="row.quantity" class="input isn-in num" inputmode="decimal" placeholder="0" />
              </td>
              <td v-if="isVisible('unit')">
                <span v-if="row.unit" class="isn-unit" :class="{ fallback: row.unitFromBase }"
                      :title="row.unitFromBase ? '商品档案里没设「报单单位」，按基础单位显示' : ''">{{ row.unit }}</span>
                <span v-else class="isn-unit none"></span>
              </td>
              <td>
                <input v-model="row.unit_price" class="input isn-in num" inputmode="decimal" placeholder="0.00" />
              </td>
              <td class="num isn-amt" v-if="isVisible('amt')">¥{{ fmtMoney(rowAmount(row)) }}</td>
              <td class="isn-c-del">
                <button class="btn-row-ic danger" title="删除这一行" @click="removeRow(i)">
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
      <span class="isn-total">{{ cfg.isReturn ? '退货合计' : '合计' }} <b>¥{{ fmtMoney(totalAmount) }}</b></span>
      <input v-if="cfg.isReturn" v-model.trim="reason" maxlength="200" class="input isn-ret-reason"
             placeholder="退货原因（选填，如：破损 / 临期 / 多订）" />
      <div class="isn-save">
        <button v-if="!cfg.isReturn" class="btn btn-ghost btn-sm" :disabled="saving" @click="submit('new')">保存并新增</button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="submit('save')">
          <Icon name="save" :size="14" />{{ saving ? '提交中…' : cfg.saveLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 销售侧建单内核 —— 一个组件承载**四个独立页面**：
     自提订单 / 车销订单 / 自提退单 / 车销退单
   （由 7 个薄页面分别以 `type` 传入自己的配置，见 `docTypes.js`。）

   🔴 v449（2026-10-11）**退货形态变了**：老板口径「退货单不需要选原销售单，
      退货仓库要可以指定」⇒ 原来的「原销售单 + 可退预览 + 只读客户/仓库」那一整块
      **整体撤掉**，改为与订单**同一个表单形态**（客户 + 仓库 + 明细）。
      后端配套：`db.queries.sales.return_order_create` 支持 `sale_order_id=0`
      （独立退货单），端点 `POST /api/psi/sale-return-orders`。
      ⚠️ 老端点 `POST /api/psi/sale-orders/{oid}/return`（挂原单、带可退上限）
         **保留未动** —— 旧深链与 RMA 仍在用，两条并存、语义不同。

   🔴 四种类型的**真实差异**（不再是运行期 v-if 混在一张表上）：
      · 车销的订单与退单都有「送货司机」（`driver_id`）；
      · 退单的仓库叫「退货仓库」、有「退货原因」、走另一个端点；
      · 出货方式（`order_type`）由配置写死并**真的提交**（后端 v449 起才透传，
        此前界面选什么都不落库 —— 见 `routers/sales.py::create_sale` 的注释）。
   🔴 **不传 `status`**：后端空状态 = 草稿，而「发货」只接受草稿状态的单。
   🔴 **信用额度校验一律交给后端**（它读实时应收与客户档案，前端拿不到）
      ⇒ 这里只把后端那句原因原样显示。
   🔴 **幂等键**：进页面生成一次，提交成功后作废；退货每次成功后**立刻换键**
      （不换会被后端当成重放 ⇒ 静默什么都不做）。 */
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '../../../components/Icon.vue'
import ColMenuPanel from '../../../components/ColMenuPanel.vue'
import { useColSettings } from '../../../composables/useColSettings.js'
import { useColResize } from '../../../composables/useColResize.js'
import ColResizeHandle from '../../../components/ColResizeHandle.vue'
import { psiApi } from '../../../api/psi'
import { toast } from '../../../store'
import { fmtMoney } from '../../../constants/psiLabels'
import { saleDocConfig } from './docTypes.js'
import CustomerCombo from './CustomerCombo.vue'

const props = defineProps({
  /* 类型键，见 `docTypes.js` 的 `SALE_DOC_TYPES`。 */
  type: { type: String, required: true },
})
const router = useRouter()

const cfg = computed(() => saleDocConfig(props.type))

/* 列设置：录入网格，商品 / 数量 / 单价 / 删除为录入必需（core）；单位、金额为派生列，可隐藏。
   云端偏好键 = `inv-sale-new`（与拆分前**同一个键**）⇒ 用户已保存的列显隐原样保留。 */
const DOC_COLS = [
  { key: 'prod', label: '商品', core: true },
  { key: 'qty', label: '数量', core: true },
  { key: 'unit', label: '单位', core: false },
  { key: 'price', label: '单价', core: true },
  { key: 'amt', label: '金额', core: false },
]
const { isVisible, toggleCol, resetCols } = useColSettings('inv-sale-new', DOC_COLS)
const panel = ref(null)
function openColMenu (e) { if (panel.value) panel.value.open(e) }
const { wStyle, startResize, resetColW } = useColResize('inv-sale-new', DOC_COLS)

const saving = ref(false)
const customers = ref([])
const warehouses = ref([])
const products = ref([])
const users = ref([])
/* 部门下拉。⚠️ 后端读不到时**不返回这个键**（不是空数组）⇒ 一律 `Array.isArray` 判存在。 */
const departments = ref([])
const prodKw = ref('')
const reason = ref('')

const form = ref({
  customer_id: 0, warehouse_id: 0, driver_id: '',
  order_date: '', delivery_date: '', delivery_address: '', note: '',
  /* 部门名（TEXT），**不是** departments.id —— 见模板里那格注释。 */
  department: '',
})

/* `uid` 只用于 `v-for` 的 key —— 用下标当 key 时，删中间一行会让后面所有行的
   DOM 复用错位（输入框内容跟着串行）。 */
let _uid = 0
const items = ref([])

function todayISO () {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/* 幂等键：一次「会话」的标识；提交成功后作废（见文件头 🔴）。 */
let idemKey = newIdemKey()
function newIdemKey (salt = 'sale') {
  return `psi-${salt}-` + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

const prodOptions = computed(() => {
  const k = prodKw.value.trim().toLowerCase()
  if (!k) return products.value
  return products.value.filter(p => (p.name || '').toLowerCase().includes(k))
})
const selCustomer = computed(() =>
  customers.value.find(c => Number(c.id) === Number(form.value.customer_id)) || null)
/** 只把**填过商品**的行算作有效行：空行是给用户预备的，不参与校验、不提交、不计项数。 */
const filledRows = computed(() => items.value.filter(r => Number(r.product_id) > 0))
const totalAmount = computed(() => items.value.reduce((s, r) => s + rowAmount(r), 0))

function rowAmount (r) {
  const q = Number(r.quantity || 0)
  const p = Number(r.unit_price || 0)
  return (q && p) ? Math.round(q * p * 100) / 100 : 0
}

/** v444：建单页明细表的**出厂预设空行数**（规范 §4.1 —— 采购 / 销售两页必须同值）。 */
const PRESET_ROWS = 15

function blankRow () {
  return { uid: ++_uid, product_id: 0, quantity: '', unit: '', unitFromBase: false, unit_price: '' }
}
function addRow () { items.value.push(blankRow()) }
function removeRow (i) { items.value.splice(i, 1) }

function onPick (row) {
  const p = products.value.find(x => Number(x.id) === Number(row.product_id))
  if (!p) return
  const ou = String(p.order_unit || '').trim()
  row.unit = ou || String(p.unit || '').trim()
  row.unitFromBase = !ou && !!row.unit
  // 客户专属价由后端在建单时套用；这里只是给个**默认值**让用户少填一次（可改）。
  if (!row.unit_price && Number(p.sale_price || 0) > 0) row.unit_price = String(p.sale_price)
}

function validate () {
  if (!form.value.customer_id) return '请先选择客户'
  if (!form.value.warehouse_id) return `请选择${cfg.value.whLabel}`
  if (!filledRows.value.length) return '请至少添加一行商品明细'
  const rows = filledRows.value
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const at = `第 ${items.value.indexOf(r) + 1} 行`
    if (!(Number(r.quantity) > 0)) return `${at}：数量要大于 0`
    if (r.unit_price === '' || Number(r.unit_price) < 0) return `${at}：请填写${cfg.value.priceLabel}`
  }
  return ''
}

async function submit (act = 'save') {
  const bad = validate()
  if (bad) { toast(bad, 'warn'); return }
  if (saving.value) return
  saving.value = true
  try {
    const lines = filledRows.value.map(r => ({
      product_id: r.product_id,
      quantity: Number(r.quantity),
      unit_price: Number(r.unit_price),
    }))
    if (cfg.value.isReturn) {
      const body = {
        customer_id: form.value.customer_id,
        warehouse_id: form.value.warehouse_id,
        driver_id: cfg.value.hasDriver ? (form.value.driver_id || '') : '',
        order_type: cfg.value.orderType || '',
        order_date: form.value.order_date || '',
        note: form.value.note || '',
        reason: reason.value.trim(),
        idempotency_key: idemKey,
        items: lines,
      }
      const r = await psiApi.createSaleReturn(body)
      idemKey = newIdemKey(cfg.value.idemSalt)
      reason.value = ''
      toast(`退货单已生成${r && r.return_id ? '（#' + r.return_id + '）' : ''}`, 'success')
      if (act === 'new') {
        items.value = []
        for (let i = 0; i < PRESET_ROWS; i++) items.value.push(blankRow())
        form.value.note = ''
      }
      return
    }
    const body = {
      customer_id: form.value.customer_id,
      warehouse_id: form.value.warehouse_id,
      driver_id: cfg.value.hasDriver ? (form.value.driver_id || '') : '',
      delivery_date: form.value.delivery_date || '',
      delivery_address: form.value.delivery_address || '',
      // v449：出货方式由**页面类型**决定，并真的提交（后端 v449 起才透传）。
      order_type: cfg.value.orderType || 'self_pickup',
      order_date: form.value.order_date || '',
      note: form.value.note || '',
      idempotency_key: idemKey,
      items: lines,
    }
    /* 部门：只有**订单**传（退单那张表没有这一列，见 `docTypes.js` 的「已知差距」）。
       ⚠️ 传的是**部门名**，不是 `departments.id` —— `sale_orders.department` 是 TEXT，
          与采购单的 `department_id`(INTEGER) 不是一回事。
       🔴 空串不传：后端「空则不写列」⇒ 建单 SQL 与改动前逐字一致。 */
    if (cfg.value.hasDept && form.value.department) {
      body.department = form.value.department
    }
    const r = await psiApi.createSale(body)
    idemKey = newIdemKey()
    const oid = r && (r.order_id || r.id)
    toast(`${cfg.value.shortTitle}已保存（${(r && r.order_no) || oid || ''}）`, 'success')
    if (act === 'new') {
      items.value = []
      for (let i = 0; i < PRESET_ROWS; i++) items.value.push(blankRow())
      form.value.delivery_address = ''
      form.value.note = ''
      return
    }
    if (oid) router.replace('/inventory/sale/' + oid)
    else router.replace(cfg.value.listPath)
  } catch (e) {
    // 后端原因原样显示（例如「超信用额度（可用¥…，本次¥…）」）
    toast(e.message || '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

function back () {
  router.push({ path: cfg.value.listPath, query: cfg.value.listQuery || {} })
}

/**
 * 基础资料 —— **按需拉**，不整表拉。
 *
 * 🔴 为什么要拼 `kinds` 而不是一律 `all`：`all` 会把 702 个客户的资料一起解密返回
 *    （`customers` 是 PII），退单 / 自提这类根本用不到 `users` 的类型没必要多跑一次
 *    大查询。
 * ⚠️ `users` / `departments` 主库或租户库读不到时后端**不返回该键**（不是空数组）
 *    ⇒ 一律 `Array.isArray()` 判存在。**不要**拿 `hr_employees` 顶替 `users`
 *    （两表编号不同，同 id 会显示成另一个人，选出来归属是错的且零报错）。
 */
async function loadRefs () {
  try {
    const kinds = ['warehouses', 'customers', 'products']
    if (cfg.value.hasDriver) kinds.push('users')
    if (cfg.value.hasDept) kinds.push('departments')
    const d = await psiApi.refs(kinds.join(','), '', 500)
    warehouses.value = d.warehouses || []
    customers.value = d.customers || []
    products.value = d.products || []
    users.value = Array.isArray(d.users) ? d.users : []
    departments.value = Array.isArray(d.departments) ? d.departments : []
    const defs = warehouses.value.filter(w => w.is_default)
    const pick = (defs.length ? defs : warehouses.value).slice().sort((a, b) => a.id - b.id)[0]
    if (pick) form.value.warehouse_id = pick.id
  } catch (e) {
    toast(e.message || '基础资料读取失败', 'error')
  }
}

function reset () {
  /* ⚠️ 仓库**保留**上次选的（连开几张单通常同一个仓，与采购建单页一致）；
     其余清空。部门也一样：进页面时为空，连开下一张时留在 `form` 上不清（见 `submit`）。 */
  form.value = {
    customer_id: 0, warehouse_id: form.value.warehouse_id || 0, driver_id: '',
    order_date: todayISO(), delivery_date: todayISO(), delivery_address: '', note: '',
    department: '',
  }
  prodKw.value = ''
  reason.value = ''
  items.value = []
  for (let i = 0; i < PRESET_ROWS; i++) items.value.push(blankRow())
  idemKey = newIdemKey(cfg.value.idemSalt)
}

/* 🔴 换类型（`/inventory/sale/...` 的多个薄页面共用本内核实例时）必须**重置**：
   否则会带着上一个类型的客户 / 明细一路提交，而且零报错。 */
watch(() => props.type, () => { reset(); loadRefs() })
onMounted(() => { reset(); loadRefs() })
</script>

<style scoped>
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
.isn-prod-kw { width: 240px; height: 32px; margin-left: auto }
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
.isn-c-del { width: 44px }
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
  .isn-prod-kw { width: 100%; margin-left: 0 }
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

/* ══ v449（销售侧拆分）→ v450（客户选择统一组合框）════════════════════════════
   框式头里 `.isn-hd-box .isn-f .input { width: auto }`（特异性 0,3,0 + scoped 属性）会**吃掉**
   组合框内部 `.ipn-cust-input { width:100% }`（0,1,0）—— 必须**显式写回**，否则组合框
   在框式头里会塌成 auto（与采购单页「供应商」同一个坑，见 `PurchaseOrderForm.vue`
   的 `.ipn-hd-box .ipn-f .ipn-sup-combo/.ipn-sup-input`）。
   v450：客户格（自提订单/退单、车销订单/退单 四页共用本内核）换成 `CustomerCombo.vue`，
   与新建采购单「供应商」逐像素一致；这里照搬那两行父作用域规则（语义词 `sup→cust`）
   让组合框在框里撑满。
   ⚠️ `.isn-f-so`（原先给「原销售单」格的 420px）与 `.isn-tbl.isn-ret-tbl`（退货表
      min-width 900px）随 v449 撤掉「选原单 + 独立退货明细表」而**不再被使用**；
      规则留着不删（删它们不影响任何渲染，而留下能让人看出"这里曾经是什么"）。 */
.isn-hd-box .isn-f .ipn-cust-combo { flex: 1; min-width: 0 }
.isn-hd-box .isn-f .ipn-cust-input { width: 100% }
</style>
