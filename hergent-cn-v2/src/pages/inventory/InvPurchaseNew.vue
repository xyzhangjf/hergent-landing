<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div>
        <h2>{{ copyId ? '复制采购单' : '新建采购单' }}</h2>
        <span class="page-sub">{{ copyId ? '按原单带出商品与价格，批次与到期日按这次到货重填' : '进货登记，到货后按这里的批次与到期日入库' }}</span>
      </div>
      <div class="ipn-acts">
        <button class="btn btn-ghost btn-sm" :disabled="saving" @click="back">返回列表</button>
      </div>
    </div>

    <!-- 表单头（对齐舟谱：*供应商 / *仓库 / 单据日期 / 预计到货 / 备注 0-500） -->
    <div class="card ipn-hd">
      <div class="ipn-f ipn-f-sup">
        <label class="ipn-lb">供应商 <span class="ipn-req">必填</span></label>
        <div class="ipn-sup-pick">
          <input v-model.trim="supKw" class="input ipn-kw" placeholder="输入名称搜索"
                 @keyup.enter="loadSuppliers" />
          <select v-model.number="form.supplier_id" class="input ipn-sel">
            <option :value="0" disabled>请选择供应商</option>
            <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
      </div>
      <div class="ipn-f">
        <label class="ipn-lb">入库仓库 <span class="ipn-req">必填</span></label>
        <select v-model.number="form.warehouse_id" class="input ipn-sel">
          <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
      </div>
      <div class="ipn-f">
        <label class="ipn-lb">单据日期</label>
        <input type="date" v-model="form.order_date" class="input ipn-date" />
      </div>
      <div class="ipn-f">
        <label class="ipn-lb">预计到货日期</label>
        <input type="date" v-model="form.expected_date" class="input ipn-date" />
      </div>
      <div class="ipn-f ipn-f-grow">
        <label class="ipn-lb">备注 <span class="ipn-cnt">{{ (form.note || '').length }}/500</span></label>
        <input v-model.trim="form.note" maxlength="500" class="input" placeholder="选填" />
      </div>
    </div>

    <!-- 供应商信息条（舟谱那一条「应付余额 / 预付余额」的位置；这里只放**真有的数据**） -->
    <div class="ipn-strip">
      <span class="ipn-si">
        <span class="ipn-sk">供应商</span>
        <b>{{ selSupplier ? selSupplier.name : '未选择' }}</b>
      </span>
      <span v-if="selSupplier && Number(selSupplier.credit_days) > 0" class="ipn-si">
        <span class="ipn-sk">账期</span><b>{{ Number(selSupplier.credit_days) }} 天</b>
      </span>
      <span class="ipn-si">
        <span class="ipn-sk">已录商品</span><b>{{ items.length }} 项</b>
      </span>
      <span class="ipn-si">
        <span class="ipn-sk">合计</span><b class="ipn-strip-amt">¥{{ fmtMoney(totalAmount) }}</b>
      </span>
    </div>

    <!-- 明细 -->
    <div class="card ipn-body">
      <div class="ipn-bar">
        <b>商品明细</b>
        <input v-model.trim="prodKw" class="input ipn-prod-kw" placeholder="输入商品名筛选下面的商品下拉" />
        <button class="btn btn-ghost btn-sm" @click="addRow()"><Icon name="plus" :size="14" />加一行</button>
      </div>

      <p class="ipn-tip">
        <Icon name="lightbulb" :size="14" />
        <span>{{ PSI_NOTES.unit }} {{ PSI_NOTES.expiry }}</span>
      </p>

      <div v-if="!items.length" class="state-empty">还没有明细，点右上角「加一行」开始。</div>

      <div v-else class="table-wrap">
        <table class="tbl ipn-tbl">
          <thead>
            <tr>
              <th class="seq-th">序号</th>
              <th class="ipn-c-prod">商品</th>
              <th class="ipn-c-code">条码</th>
              <th class="ipn-c-unit">单位</th>
              <th class="num ipn-c-ref">参考成本价</th>
              <th class="num ipn-c-price">采购价</th>
              <th class="num ipn-c-qty">订单数量</th>
              <th class="num ipn-c-amt">订单金额</th>
              <th class="ipn-c-batch">批次号 <span class="ipn-req">必填</span></th>
              <th class="ipn-c-date">到期日 <span class="ipn-req">必填</span></th>
              <th class="ipn-c-date">生产日期</th>
              <th class="ipn-c-op">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in items" :key="row.uid">
              <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
              <td class="ipn-c-prod">
                <select v-model.number="row.product_id" class="input ipn-in" @change="onPick(row)">
                  <option :value="0" disabled>请选择商品</option>
                  <option v-for="p in prodOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </td>
              <td class="ipn-c-code">{{ row.barcode || '—' }}</td>
              <td class="ipn-c-unit">
                <span v-if="row.unit" class="ipn-unit" :class="{ fallback: row.unitFromBase }"
                      :title="row.unitFromBase ? '商品档案里没设「报单单位」，按基础单位显示' : ''">{{ row.unit }}</span>
                <span v-else class="ipn-unit none">先选商品</span>
              </td>
              <td class="num ipn-c-ref">{{ row.purchase_price ? '¥' + fmtMoney(row.purchase_price) : '—' }}</td>
              <td class="ipn-c-price">
                <input v-model="row.unit_price" class="input ipn-in num" inputmode="decimal" placeholder="0.00" />
              </td>
              <td class="ipn-c-qty">
                <input v-model="row.quantity" class="input ipn-in num" inputmode="decimal" placeholder="0" />
              </td>
              <td class="num ipn-amt">¥{{ fmtMoney(rowAmount(row)) }}</td>
              <td class="ipn-c-batch">
                <input v-model.trim="row.batch_no" class="input ipn-in" placeholder="如 20261101" />
              </td>
              <td class="ipn-c-date"><input type="date" v-model="row.expiry_date" class="input ipn-in" /></td>
              <td class="ipn-c-date"><input type="date" v-model="row.production_date" class="input ipn-in" /></td>
              <td class="ipn-c-op">
                <button class="ipn-link" title="在这一行下面插一行" @click="insertAfter(i)">新增</button>
                <button class="ipn-link danger" title="删除这一行" @click="removeRow(i)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 底部动作条（对齐舟谱：合计在左、动作在右下）。
         🔴 sticky 贴住滚动容器底边；`margin-inline:-20px` 抵消 Shell 的 `.view-wrap{padding:20px}`
            ⇒ 动作条满宽。若那份 padding 改了，这里要跟着改（两处唯一的耦合点）。 -->
    <div class="ipn-bottom">
      <span class="ipn-total">合计 <b>¥{{ fmtMoney(totalAmount) }}</b></span>
      <span v-if="totalAmount >= 5000" class="ipn-warn">
        金额较大时，保存后会先进入「待审批」，审批通过才能确认入库。
      </span>
      <div class="ipn-save">
        <button class="btn btn-primary btn-sm ipn-save-main" :disabled="saving" @click="submit('save')">
          <Icon name="save" :size="14" />{{ saving ? '提交中…' : '保存' }}
        </button>
        <button class="btn btn-primary btn-sm ipn-save-caret" :disabled="saving"
                title="更多保存方式" @click.stop="saveOpen = !saveOpen">
          <span class="ipn-caret" :class="{ up: saveOpen }"></span>
        </button>
        <div v-if="saveOpen" class="ipn-menu" @click.stop>
          <button class="ipn-mi" @click="submit('save')">保存</button>
          <button class="ipn-mi" @click="submit('approve')">保存并审核</button>
          <button class="ipn-mi" @click="submit('new')">保存并新增下一张</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 新建采购单 —— 数据源：`POST /api/psi/purchase-orders`（委派既有建单逻辑）。
   ------------------------------------------------------------------
   🔴 「批次号 + 到期日」必填**不是 UI 偏好，是数据正确性的前提**：
      入库 `batch_in` 只在批次号非空时才按 (商品, 仓库, 批次号) **累加**同一行；
      批次号为空会**每行新建** ⇒ 同一批货入库两次会出现两行、数量对不上。
      到期日为空则该批次进入「无到期日」，临期预警与「先出最早到期」对它不生效。

   🔴 单位取商品档案的「报单单位」；档案没设时回落到基础单位并**显式标注**（不静默）。
      跨单位换算在这里**不做** —— 算不出就如实退回到档案的单位，避免悄悄写错量纲。

   🔴 v403 修掉一个「填了等于没填」：`expected_date` 以前**不在后端 Pydantic 模型里**，
      前端传了被 `extra='ignore'` 静默丢弃。本页把「单据日期 / 预计到货日期」都做成真实
      落库的字段（单据日期可由用户改，用来补录昨天的到货单）。

   ⚠️ 审批阈值（5000）在**后端**读 `system_config`；这里那句提示只用于「提前告知」，
      不参与任何判断（判断在后端，改了阈值这里不会错拦）。
   ⚠️ 「保存并审核」= 建单成功后再走**同一个审核原语**（`/batch` 的 approve），
      不在这里重写审核规则；审核失败（例如单据已被别人审过）会如实报出来。
   ⚠️ 舟谱的「可用库存 / 实际库存 / 行备注」三列**本版没有**：库存要按商品聚合
      （现有 `/api/psi/stock` 是批次级、且带 limit），行备注 `purchase_order_items`
      里没有对应列。宁可先不给，也不放一列永远空着或算错的数。 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { psiApi } from '../../api/psi'
import { toast } from '../../store'
import { PSI_NOTES, fmtMoney } from '../../constants/psiLabels'

const router = useRouter()
const route = useRoute()

const saving = ref(false)
const saveOpen = ref(false)
const suppliers = ref([])
const warehouses = ref([])
const products = ref([])
const supKw = ref('')
const prodKw = ref('')

const copyId = Number((route.query && route.query.copy) || 0) || 0

function todayISO () {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const form = ref({
  supplier_id: 0, warehouse_id: 0,
  order_date: todayISO(), expected_date: '', note: '',
})
/* `uid` 只用于 `v-for` 的 key —— 用下标当 key 时，删中间一行会让后面所有行的
   DOM 复用错位（输入框内容跟着串行）。 */
let _uid = 0
const items = ref([])

const prodOptions = computed(() => {
  const k = prodKw.value.trim().toLowerCase()
  if (!k) return products.value
  return products.value.filter(p => (p.name || '').toLowerCase().includes(k))
})
const selSupplier = computed(() => suppliers.value.find(s => s.id === form.value.supplier_id) || null)
const totalAmount = computed(() => items.value.reduce((s, r) => s + rowAmount(r), 0))

function rowAmount (r) {
  const q = Number(r.quantity || 0)
  const p = Number(r.unit_price || 0)
  if (!q || !p) return 0
  return Math.round(q * p * 100) / 100
}

function blankRow () {
  return {
    uid: ++_uid, product_id: 0, quantity: '', unit: '', unitFromBase: false,
    unit_price: '', barcode: '', purchase_price: 0,
    batch_no: '', expiry_date: '', production_date: '',
  }
}
function addRow () { items.value.push(blankRow()) }
function insertAfter (i) { items.value.splice(i + 1, 0, blankRow()) }
function removeRow (i) { items.value.splice(i, 1) }

/** 从商品档案带出单位 / 条码 / 参考成本价（价格可改）。 */
function applyProduct (row) {
  const p = products.value.find(x => x.id === row.product_id)
  if (!p) { row.barcode = ''; row.purchase_price = 0; return }
  const ou = String(p.order_unit || '').trim()
  row.unit = ou || String(p.unit || '').trim()
  row.unitFromBase = !ou && !!row.unit
  row.barcode = String(p.barcode || '')
  row.purchase_price = Number(p.purchase_price || 0)
}
function onPick (row) {
  applyProduct(row)
  if (!row.unit_price && row.purchase_price > 0) row.unit_price = String(row.purchase_price)
}

async function loadSuppliers () {
  try {
    const d = await psiApi.refs('suppliers', supKw.value, 200)
    suppliers.value = d.suppliers || []
  } catch (e) {
    toast(e.message || '供应商读取失败', 'error')
  }
}

/* ---- 复制：按原单带出商品与价格。**批次三列刻意不带** ----------------------------
   🔴 复制一张旧单去买新的一批货，批次号/到期日一定是**新的** —— 沿用旧值会让
      这批货在库里被并进上次那个批次（批次号相同 ⇒ `batch_in` 累加），库存与效期都错。
      所以这里清空并要求重填，并显式告知用户（不静默）。 */
async function loadCopy (oid) {
  try {
    const d = await psiApi.getPurchase(oid)
    const o = d.order || {}
    form.value.supplier_id = Number(o.supplier_id || 0)
    form.value.warehouse_id = Number(o.warehouse_id || 0)
    form.value.note = o.note || ''
    items.value = (d.items || []).map(it => {
      const r = blankRow()
      r.product_id = Number(it.product_id || 0)
      r.quantity = it.quantity === null || it.quantity === undefined ? '' : String(it.quantity)
      r.unit_price = it.unit_price === null || it.unit_price === undefined ? '' : String(it.unit_price)
      r.unit = String(it.unit || '')
      applyProduct(r)
      return r
    })
    if (!items.value.length) addRow()
    toast('已按原单带出商品与价格；批次号和到期日要按这次到货重新登记', 'info')
  } catch (e) {
    toast(e.message || '原单读取失败', 'error')
    addRow()
  }
}

/* ---- 提交前校验：**逐项显式报错**，不静默放过任何一行 --------------------------
   ⚠️ 日期格式在这里也校验一次：后端会 400（脏日期会让按日期筛选与排序静默出错），
      但等到提交后才报错、还要用户回头找是哪一行，是没必要的往返。 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validate () {
  if (!form.value.supplier_id) return '请先选择供应商'
  if (!form.value.warehouse_id) return '请选择入库仓库'
  if (form.value.order_date && !DATE_RE.test(form.value.order_date)) return '单据日期格式不正确，请用日期选择器选'
  if (form.value.expected_date && !DATE_RE.test(form.value.expected_date)) return '预计到货日期格式不正确，请用日期选择器选'
  if (!items.value.length) return '请至少添加一行商品明细'
  for (let i = 0; i < items.value.length; i++) {
    const r = items.value[i]
    const at = `第 ${i + 1} 行`
    if (!r.product_id) return `${at}：请选择商品`
    if (!(Number(r.quantity) > 0)) return `${at}：数量要大于 0`
    if (Number(r.unit_price) < 0 || r.unit_price === '') return `${at}：请填写采购价`
    if (!String(r.batch_no || '').trim()) return `${at}：请填写批次号（同一批货靠它合并库存）`
    if (!String(r.expiry_date || '').trim()) return `${at}：请填写到期日`
    if (!DATE_RE.test(r.expiry_date)) return `${at}：到期日格式不正确，请用日期选择器选`
    if (r.production_date && !DATE_RE.test(r.production_date)) return `${at}：生产日期格式不正确`
  }
  return ''
}

function resetForNext () {
  const keep = { supplier_id: form.value.supplier_id, warehouse_id: form.value.warehouse_id,
    order_date: form.value.order_date, expected_date: form.value.expected_date, note: '' }
  form.value = keep
  items.value = [blankRow()]
  prodKw.value = ''
}

async function submit (mode) {
  saveOpen.value = false
  const bad = validate()
  if (bad) { toast(bad, 'warn'); return }
  if (saving.value) return
  saving.value = true
  try {
    const body = {
      supplier_id: form.value.supplier_id,
      warehouse_id: form.value.warehouse_id,
      order_date: form.value.order_date || '',
      expected_date: form.value.expected_date || '',
      note: form.value.note || '',
      items: items.value.map(r => ({
        product_id: r.product_id,
        quantity: Number(r.quantity),
        unit_price: Number(r.unit_price),
        unit: r.unit || '',
        batch_no: String(r.batch_no).trim(),
        expiry_date: r.expiry_date,
        production_date: r.production_date || '',
      })),
    }
    const r = await psiApi.createPurchase(body)
    const oid = r && (r.order_id || r.id)
    const no = (r && r.order_no) || oid || ''

    if (mode === 'approve') {
      /* 「保存并审核」：走**同一个审核原语**（不在这里重写规则）。
         审核失败必须如实说出来 —— 例如单据已被别人审过 / 已入库。 */
      let note = ''
      try {
        const b = await psiApi.batchPurchases('approve', [oid])
        const f = (b.results || []).find(x => !x.ok)
        if (b.ok_count) note = '，已审核'
        else note = `，但审核未成功：${(f && f.reason) || '未说明原因'}`
      } catch (e) {
        note = `，但审核未成功：${e.message || '接口报错'}`
      }
      toast(`采购单已保存（${no}）${note}`, note.includes('未成功') ? 'warn' : 'success')
    } else {
      toast(`采购单已保存（${no}）`, 'success')
    }

    if (mode === 'new') { resetForNext(); return }
    if (oid) router.replace('/inventory/purchase/' + oid)
    else router.replace('/inventory/purchase')
  } catch (e) {
    // 后端 detail 原样显示（例如「批次日期格式不正确：…」）
    toast(e.message || '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

function back () { router.push('/inventory/purchase') }
function onDocClick () { saveOpen.value = false }

onMounted(async () => {
  document.addEventListener('click', onDocClick)
  try {
    // 🔴 `kind` 只取本页真正要用的三类：拉 customers 会连 702 个客户的资料一起解密返回，
    //    开采购单根本用不到（少一次无谓的 PII 出库）。
    const d = await psiApi.refs('warehouses,suppliers,products', '', 500)
    warehouses.value = d.warehouses || []
    suppliers.value = d.suppliers || []
    products.value = d.products || []
    // 默认仓：优先 is_default，其次第一个（两个 is_default 时取 id 最小，仅作默认值，用户可改）
    const defs = warehouses.value.filter(w => w.is_default)
    const pick = (defs.length ? defs : warehouses.value).slice().sort((a, b) => a.id - b.id)[0]
    if (pick) form.value.warehouse_id = pick.id
  } catch (e) {
    toast(e.message || '基础资料读取失败', 'error')
  }
  if (copyId) await loadCopy(copyId)
  else addRow()
})
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<style scoped>
/* 🔴 竖排 + 底部条 `margin-top:auto` 两件套：目的是让底部动作条在**内容不足一屏时
   也钉在视口底部**（对齐舟谱：合计与保存在最底一行），内容超一屏时 `sticky bottom:0` 接管
   ⇒ 两种情况下位置都对。

   这里只需负责「本页是竖排容器」（`margin-top:auto` 在块布局里不生效，必须 flex）。
   真正让本页**长到一屏高**的是容器 `InventoryShell` 的 `.page{display:flex;flex-direction:column;
   min-height:100%}` + `.page > * { flex:1 1 auto }` —— 高度链的确定性在那一层打通。
   v403 实测：改前中间层高度 auto ⇒ 百分比链断开、动作条紧贴明细表（不在一屏底沿）；
   两处必须**成对**存在，只改一边就会退回原状。

   ⚠️ 若 `InventoryShell` 的容器契约改了（`.page` 不再是竖排 flex），这里要一起看。 */
.inv-page { display: flex; flex-direction: column; min-height: 100% }
.ipn-acts { display: flex; gap: 8px; flex-wrap: wrap }

/* 表单头 */
.ipn-hd { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 12px }
.ipn-f { display: flex; flex-direction: column; gap: 4px }
.ipn-f-grow { flex: 1; min-width: 180px }
.ipn-f-sup { min-width: 300px }
.ipn-lb { font-size: 12px; color: var(--t3) }
.ipn-req { color: var(--dan); font-size: 11px }
.ipn-cnt { color: var(--t3); font-variant-numeric: tabular-nums }
.ipn-sup-pick { display: flex; gap: 6px }
.ipn-kw { width: 130px; height: 32px }
.ipn-sel { min-width: 170px; height: 32px }
.ipn-date { height: 32px }

/* 供应商信息条（舟谱「应付/预付余额」的位置） */
.ipn-strip {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  margin-bottom: 12px; padding: 9px 16px;
  background: var(--p-bg); border: 1px solid var(--p-border);
  border-radius: var(--radius-md); font-size: 13px; color: var(--t1);
}
.ipn-si { display: inline-flex; align-items: center; gap: 6px }
.ipn-sk { color: var(--t3); font-size: 12px }
.ipn-strip-amt { color: var(--p-ink); font-variant-numeric: tabular-nums }

/* 明细卡 */
.ipn-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px }
.ipn-prod-kw { width: 240px; height: 32px; margin-left: auto }
.ipn-tip {
  display: flex; align-items: flex-start; gap: 6px;
  font-size: 12px; color: var(--t2); margin: 0 0 10px;
}
.ipn-tip svg { color: var(--p-dark); flex: none; margin-top: 1px }

.ipn-tbl { min-width: 1360px }
.ipn-c-prod { min-width: 260px }
.ipn-c-code { width: 116px; color: var(--t2); font-variant-numeric: tabular-nums }
.ipn-c-unit { width: 64px }
.ipn-c-ref { width: 96px; color: var(--t2) }
.ipn-c-price, .ipn-c-qty { width: 94px }
.ipn-c-amt { width: 104px }
.ipn-c-batch { width: 124px }
.ipn-c-date { width: 142px }
.ipn-c-op { width: 104px; white-space: nowrap }
.ipn-in { width: 100%; height: 30px }
.ipn-in.num { text-align: right; font-variant-numeric: tabular-nums }
.ipn-amt { font-variant-numeric: tabular-nums; white-space: nowrap }
.ipn-unit { font-size: 13px; color: var(--t1) }
/* 档案没设报单单位时的回落值 —— 用弱化色标注，不静默 */
.ipn-unit.fallback { color: var(--t3) }
.ipn-unit.none { color: var(--t3) }
.ipn-link {
  border: none; background: none; padding: 0; font-size: 13px;
  color: var(--p-dark); cursor: pointer;
}
.ipn-link + .ipn-link { margin-left: 10px }
.ipn-link:hover { text-decoration: underline }
.ipn-link.danger { color: var(--danger-txt) }

/* 底部动作条。四条外边距各司其职，缺一条都会退化成「浮在页面中间」：

   `margin-top:auto`  —— **短内容时的推底主力**：在竖排 flex 里吸走所有富余空间，
                         把动作条压到容器底边。块布局下 `auto` 无效，所以父级必须是 flex。
   `margin-inline:-20px` / `margin-bottom:-20px`
                      —— 与 Shell 的 `.view-wrap{padding:20px}`（Shell.vue:1165）**是一对**：
                         左右 -20px 让动作条满宽（不然左右各留 20px 白边）；
                         底部 -20px 让粘住时真的贴到滚动容器下沿、不留 20px 空隙
                         （`sticky` 的可移动范围被 containing block 限死，不给负底边距就贴不到底）。
                         那份 padding 改了这里必须跟着改 —— 两处唯一的耦合点。

   两种情形分工：内容不足一屏 ⇒ `margin-top:auto` 生效（靠 InventoryShell 打通的高度链）；
                内容超一屏   ⇒ `auto` 无富余空间可吸，`sticky bottom:0` 接管。 */
.ipn-bottom {
  position: sticky; bottom: 0; z-index: var(--z-sticky);
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin: auto -20px -20px -20px; padding: 12px 20px;
  background: var(--bg); border-top: 1px solid var(--border-subtle);
}
.ipn-total { font-size: 14px }
.ipn-total b { font-size: 18px; font-variant-numeric: tabular-nums }
.ipn-warn { font-size: 12px; color: var(--war) }
.ipn-save { position: relative; display: inline-flex; margin-left: auto }
.ipn-save-main { border-top-right-radius: 0; border-bottom-right-radius: 0 }
.ipn-save-caret {
  width: 28px; padding: 0; border-left: 1px solid rgba(255, 255, 255, .35);
  border-top-left-radius: 0; border-bottom-left-radius: 0;
}
.ipn-caret {
  width: 0; height: 0;
  border-left: 4px solid transparent; border-right: 4px solid transparent;
  border-top: 5px solid currentColor; transition: transform .15s;
}
.ipn-caret.up { transform: rotate(180deg) }
.ipn-menu {
  position: absolute; right: 0; bottom: calc(100% + 6px); z-index: var(--z-dropdown);
  min-width: 160px; padding: 4px;
  background: var(--bg); border: 1px solid var(--bd); border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}
.ipn-mi {
  display: block; width: 100%; padding: 8px 12px; border: none; background: none;
  border-radius: var(--radius-sm); text-align: left; font-size: 13px; color: var(--t1);
}
.ipn-mi:hover { background: var(--bg2) }

@media (max-width: 640px) {
  .ipn-hd { align-items: stretch }
  .ipn-f, .ipn-kw, .ipn-sel, .ipn-date { width: 100%; min-width: 0 }
  .ipn-sup-pick { flex-direction: column }
  .ipn-prod-kw { width: 100%; margin-left: 0 }
  .ipn-bottom { margin-inline: 0; padding-inline: 0 }
}
</style>
