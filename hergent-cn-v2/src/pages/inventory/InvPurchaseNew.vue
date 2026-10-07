<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div>
        <h2>新建采购单</h2>
        <span class="page-sub">进货登记，到货后按这里的批次与到期日入库</span>
      </div>
      <div class="ipn-acts">
        <button class="btn btn-ghost btn-sm" :disabled="saving" @click="back">返回列表</button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="submit">
          <Icon name="save" :size="14" />{{ saving ? '提交中…' : '保存' }}
        </button>
      </div>
    </div>

    <!-- 表头信息 -->
    <div class="card ipn-hd">
      <div class="ipn-f">
        <label class="ipn-lb">供应商 <span class="ipn-req">必填</span></label>
        <input v-model.trim="supKw" class="input ipn-kw" placeholder="输入名称搜索供应商"
               @keyup.enter="loadSuppliers" />
        <select v-model.number="form.supplier_id" class="input ipn-sel">
          <option :value="0" disabled>请选择供应商</option>
          <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>
      <div class="ipn-f">
        <label class="ipn-lb">入库仓库</label>
        <select v-model.number="form.warehouse_id" class="input ipn-sel">
          <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
      </div>
      <div class="ipn-f">
        <label class="ipn-lb">预计到货日期</label>
        <input type="date" v-model="form.expected_date" class="input ipn-date" />
      </div>
      <div class="ipn-f ipn-f-grow">
        <label class="ipn-lb">备注</label>
        <input v-model.trim="form.note" class="input" placeholder="选填" />
      </div>
    </div>

    <!-- 明细 -->
    <div class="card ipn-body">
      <div class="ipn-bar">
        <b>商品明细</b>
        <input v-model.trim="prodKw" class="input ipn-prod-kw" placeholder="输入商品名筛选下面的商品下拉" />
        <button class="btn btn-ghost btn-sm" @click="addRow"><Icon name="plus" :size="14" />加一行</button>
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
              <th class="ipn-c-prod">商品</th>
              <th class="num ipn-c-qty">数量</th>
              <th class="ipn-c-unit">单位</th>
              <th class="num ipn-c-price">单价</th>
              <th class="num ipn-c-amt">金额</th>
              <th class="ipn-c-batch">批次号 <span class="ipn-req">必填</span></th>
              <th class="ipn-c-date">到期日 <span class="ipn-req">必填</span></th>
              <th class="ipn-c-date">生产日期</th>
              <th class="ipn-c-del"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in items" :key="i">
              <td>
                <select v-model.number="row.product_id" class="input ipn-in" @change="onPick(row)">
                  <option :value="0" disabled>请选择商品</option>
                  <option v-for="p in prodOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </td>
              <td><input v-model="row.quantity" class="input ipn-in num" inputmode="decimal" placeholder="0" /></td>
              <td>
                <span v-if="row.unit" class="ipn-unit" :class="{ fallback: row.unitFromBase }"
                      :title="row.unitFromBase ? '商品档案里没设「报单单位」，按基础单位显示' : ''">{{ row.unit }}</span>
                <span v-else class="ipn-unit none">先选商品</span>
              </td>
              <td><input v-model="row.unit_price" class="input ipn-in num" inputmode="decimal" placeholder="0.00" /></td>
              <td class="num ipn-amt">¥{{ fmtMoney(rowAmount(row)) }}</td>
              <td><input v-model.trim="row.batch_no" class="input ipn-in" placeholder="如 20261101" /></td>
              <td><input type="date" v-model="row.expiry_date" class="input ipn-in" /></td>
              <td><input type="date" v-model="row.production_date" class="input ipn-in" /></td>
              <td class="ipn-c-del">
                <button class="btn btn-icon btn-sm" title="删除这一行" @click="items.splice(i, 1)">
                  <Icon name="trash" :size="14" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="items.length" class="ipn-foot">
        <span class="ipn-total">合计 <b>¥{{ fmtMoney(totalAmount) }}</b></span>
        <span v-if="totalAmount >= 5000" class="ipn-warn">
          金额较大时，保存后会先进入「待审批」，审批通过才能确认入库。
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 新建采购单 —— 数据源：`POST /api/psi/purchase-orders`（委派既有建单逻辑）。
   🔴 「批次号 + 到期日」必填**不是 UI 偏好，是数据正确性的前提**：
      入库 `batch_in` 只在批次号非空时才按 (商品, 仓库, 批次号) **累加**同一行；
      批次号为空会**每行新建** ⇒ 同一批货入库两次会出现两行、数量对不上。
      到期日为空则该批次进入「无到期日」，临期预警与「先出最早到期」对它不生效。
   🔴 单位取商品档案的「报单单位」；档案没设时回落到基础单位并**显式标注**（不静默）。
      跨单位换算在这里**不做** —— 算不出就如实退回到档案的单位，避免悄悄写错量纲。
   ⚠️ 审批阈值（5000）在**后端**读 `system_config`；这里那句提示只用于「提前告知」，
      不参与任何判断（判断在后端，改了阈值这里不会错拦）。 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { psiApi } from '../../api/psi'
import { toast } from '../../store'
import { PSI_NOTES, fmtMoney } from '../../constants/psiLabels'

const router = useRouter()

const saving = ref(false)
const suppliers = ref([])
const warehouses = ref([])
const products = ref([])
const supKw = ref('')
const prodKw = ref('')

const form = ref({ supplier_id: 0, warehouse_id: 0, expected_date: '', note: '' })
const items = ref([])

const prodOptions = computed(() => {
  const k = prodKw.value.trim().toLowerCase()
  if (!k) return products.value
  return products.value.filter(p => (p.name || '').toLowerCase().includes(k))
})

const totalAmount = computed(() => items.value.reduce((s, r) => s + rowAmount(r), 0))

function rowAmount (r) {
  const q = Number(r.quantity || 0)
  const p = Number(r.unit_price || 0)
  if (!q || !p) return 0
  return Math.round(q * p * 100) / 100
}

function addRow () {
  items.value.push({
    product_id: 0, quantity: '', unit: '', unitFromBase: false, unit_price: '',
    batch_no: '', expiry_date: '', production_date: '',
  })
}

/** 选商品后带出单位与参考进价（档案里的值，可改）。 */
function onPick (row) {
  const p = products.value.find(x => x.id === row.product_id)
  if (!p) return
  const ou = String(p.order_unit || '').trim()
  row.unit = ou || String(p.unit || '').trim()
  row.unitFromBase = !ou && !!row.unit
  if (!row.unit_price && Number(p.purchase_price || 0) > 0) row.unit_price = String(p.purchase_price)
}

async function loadSuppliers () {
  try {
    const d = await psiApi.refs('suppliers', supKw.value, 200)
    suppliers.value = d.suppliers || []
  } catch (e) {
    toast(e.message || '供应商读取失败', 'error')
  }
}

/* ---- 提交前校验：**逐项显式报错**，不静默放过任何一行 --------------------------
   ⚠️ 日期格式在这里也校验一次：后端会 400（脏日期会让排序与临期档位静默出错），
      但等到提交后才报错、还要用户回头找是哪一行，是没必要的往返。 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validate () {
  if (!form.value.supplier_id) return '请先选择供应商'
  if (!form.value.warehouse_id) return '请选择入库仓库'
  if (!items.value.length) return '请至少添加一行商品明细'
  for (let i = 0; i < items.value.length; i++) {
    const r = items.value[i]
    const at = `第 ${i + 1} 行`
    if (!r.product_id) return `${at}：请选择商品`
    if (!(Number(r.quantity) > 0)) return `${at}：数量要大于 0`
    if (Number(r.unit_price) < 0 || r.unit_price === '') return `${at}：请填写单价`
    if (!String(r.batch_no || '').trim()) return `${at}：请填写批次号（同一批货靠它合并库存）`
    if (!String(r.expiry_date || '').trim()) return `${at}：请填写到期日`
    if (!DATE_RE.test(r.expiry_date)) return `${at}：到期日格式不正确，请用日期选择器选`
    if (r.production_date && !DATE_RE.test(r.production_date)) return `${at}：生产日期格式不正确`
  }
  return ''
}

async function submit () {
  const bad = validate()
  if (bad) { toast(bad, 'warn'); return }
  if (saving.value) return
  saving.value = true
  try {
    const body = {
      supplier_id: form.value.supplier_id,
      warehouse_id: form.value.warehouse_id,
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
    /* ⚠️ 建单接口**不返回状态**（审批判定在后端读配置）⇒ 这里不猜状态，
       统一提示「已保存」，真实状态由详情页从库里读出来显示。 */
    toast(`采购单已保存（${(r && r.order_no) || oid || ''}）`, 'success')
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

onMounted(async () => {
  addRow()
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
})
</script>

<style scoped>
.inv-page { display: block }
.ipn-acts { display: flex; gap: 8px; flex-wrap: wrap }
.ipn-hd { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 12px }
.ipn-f { display: flex; flex-direction: column; gap: 4px }
.ipn-f-grow { flex: 1; min-width: 160px }
.ipn-lb { font-size: 12px; color: var(--t3) }
.ipn-req { color: var(--dan); font-size: 11px }
.ipn-kw { width: 190px; height: 32px }
.ipn-sel { min-width: 170px; height: 32px }
.ipn-date { height: 32px }

.ipn-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px }
.ipn-prod-kw { width: 240px; height: 32px; margin-left: auto }
.ipn-tip {
  display: flex; align-items: flex-start; gap: 6px;
  font-size: 12px; color: var(--t2); margin: 0 0 10px;
}
.ipn-tip svg { color: var(--p-dark); flex: none; margin-top: 1px }

.ipn-tbl { min-width: 1000px }
.ipn-c-prod { min-width: 260px }
.ipn-c-qty, .ipn-c-price, .ipn-c-amt { width: 90px }
.ipn-c-unit { width: 70px }
.ipn-c-batch { width: 130px }
.ipn-c-date { width: 140px }
.ipn-c-del { width: 44px }
.ipn-in { width: 100%; height: 30px }
.ipn-in.num { text-align: right; font-variant-numeric: tabular-nums }
.ipn-amt { font-variant-numeric: tabular-nums; white-space: nowrap }
.ipn-unit { font-size: 13px; color: var(--t1) }
/* 档案没设报单单位时的回落值 —— 用弱化色标注，不静默 */
.ipn-unit.fallback { color: var(--t3) }
.ipn-unit.none { color: var(--t3) }

.ipn-foot { display: flex; align-items: center; gap: 12px; padding-top: 12px; flex-wrap: wrap }
.ipn-total { font-size: 14px; margin-left: auto }
.ipn-total b { font-size: 18px; font-variant-numeric: tabular-nums }
.ipn-warn { font-size: 12px; color: var(--war); width: 100%; text-align: right }

@media (max-width: 640px) {
  .ipn-hd { align-items: stretch }
  .ipn-f, .ipn-kw, .ipn-sel, .ipn-date { width: 100%; min-width: 0 }
  .ipn-prod-kw { width: 100%; margin-left: 0 }
}
</style>
