<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div>
        <h2>新建销售单</h2>
        <span class="page-sub">出货登记，发货时按最早到期批次自动扣减</span>
      </div>
      <div class="isn-acts">
        <button class="btn btn-ghost btn-sm" :disabled="saving" @click="back">返回列表</button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="submit">
          <Icon name="save" :size="14" />{{ saving ? '提交中…' : '保存' }}
        </button>
      </div>
    </div>

    <!-- v395：退单入口先立，但后端**尚无退货单接口** ⇒ 明说，不让人以为建出来的是退货单 -->
    <div v-if="isReturn" class="state-empty isn-note">
      退货单功能开发中 —— 当前这张保存后是<b>普通销售单</b>，不是退单。
    </div>

    <div class="card isn-hd">
      <div class="isn-f">
        <label class="isn-lb">客户 <span class="isn-req">必填</span></label>
        <input v-model.trim="custKw" class="input isn-kw" placeholder="输入名称搜索客户"
               @keyup.enter="loadCustomers" />
        <select v-model.number="form.customer_id" class="input isn-sel">
          <option :value="0" disabled>请选择客户</option>
          <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>
      <!-- v395：出货方式 —— 由 URL 的 `?type=` 预置（见脚本处注释），仍可改。 -->
      <div class="isn-f">
        <label class="isn-lb">出货方式</label>
        <select v-model="form.order_type" class="input isn-sel">
          <option v-for="o in TYPE_OPTIONS" :key="o.value" :value="o.value">{{ o.text }}</option>
        </select>
      </div>
      <div class="isn-f">
        <label class="isn-lb">出货仓库</label>
        <select v-model.number="form.warehouse_id" class="input isn-sel">
          <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
      </div>
      <div class="isn-f">
        <label class="isn-lb">交货日期</label>
        <input type="date" v-model="form.delivery_date" class="input isn-date" />
      </div>
      <div class="isn-f">
        <label class="isn-lb">交货地址</label>
        <input v-model.trim="form.delivery_address" class="input isn-addr" placeholder="选填" />
      </div>
      <div class="isn-f isn-f-grow">
        <label class="isn-lb">备注</label>
        <input v-model.trim="form.note" class="input" placeholder="选填" />
      </div>
    </div>

    <div class="card">
      <div class="isn-bar">
        <b>商品明细</b>
        <input v-model.trim="prodKw" class="input isn-prod-kw" placeholder="输入商品名筛选下面的商品下拉" />
        <button class="btn btn-ghost btn-sm" @click="addRow"><Icon name="plus" :size="14" />加一行</button>
      </div>

      <p class="isn-tip">
        <Icon name="lightbulb" :size="14" />
        <span>数量按商品档案的「报单单位」填写，不用自己换算。发货时会按最早到期的批次自动扣减。</span>
      </p>

      <div v-if="!items.length" class="state-empty">还没有明细，点右上角「加一行」开始。</div>

      <div v-else class="table-wrap">
        <table class="tbl isn-tbl">
          <thead>
            <tr>
              <th class="isn-c-prod">商品</th>
              <th class="num isn-c-qty">数量</th>
              <th class="isn-c-unit">单位</th>
              <th class="num isn-c-price">单价</th>
              <th class="num isn-c-amt">金额</th>
              <th class="isn-c-del"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in items" :key="i">
              <td>
                <select v-model.number="row.product_id" class="input isn-in" @change="onPick(row)">
                  <option :value="0" disabled>请选择商品</option>
                  <option v-for="p in prodOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </td>
              <td><input v-model="row.quantity" class="input isn-in num" inputmode="decimal" placeholder="0" /></td>
              <td>
                <span v-if="row.unit" class="isn-unit" :class="{ fallback: row.unitFromBase }"
                      :title="row.unitFromBase ? '商品档案里没设「报单单位」，按基础单位显示' : ''">{{ row.unit }}</span>
                <span v-else class="isn-unit none">先选商品</span>
              </td>
              <td><input v-model="row.unit_price" class="input isn-in num" inputmode="decimal" placeholder="0.00" /></td>
              <td class="num isn-amt">¥{{ fmtMoney(rowAmount(row)) }}</td>
              <td class="isn-c-del">
                <button class="btn btn-icon btn-sm" title="删除这一行" @click="items.splice(i, 1)">
                  <Icon name="trash" :size="14" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="items.length" class="isn-foot">
        <span class="isn-total">合计 <b>¥{{ fmtMoney(totalAmount) }}</b></span>
      </div>
    </div>
  </div>
</template>

<script setup>
/* 新建销售单 —— 数据源：`POST /api/psi/sale-orders`（委派既有建单逻辑）。
   🔴 **信用额度校验一律交给后端**（计划 §七 页面 6）：判据是「客户账期含『赊』且
      未清应收 + 本单金额 > 信用额度」，它读的是**实时**应收与客户档案 —— 前端拿不到
      （`/api/psi/refs` 只投影信用上限，不含未清应收）⇒ 前端自己算必然算错，且会出现
      「界面说没超、后端 400」这种最伤信任的组合。这里只负责把后端那句原因原样显示。
   🔴 **不传 `status`**：后端空状态 = 草稿，而「发货」只接受草稿状态的单
      （`sale_order_deliver` 的状态前置）。前端擅自传别的值会让新单无法发货。
   🔴 **幂等键**：进页面生成一次，提交成功后作废 ⇒ 双击/网络重试不会开出两张单。 */
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { psiApi } from '../../api/psi'
import { toast } from '../../store'
import { fmtMoney, ORDER_TYPE, ORDER_TYPE_OPTIONS } from '../../constants/psiLabels'

const router = useRouter()
const route = useRoute()

/* 🔴 v395（2026-10-08）：出货方式**从 URL 预置** —— 侧栏「自提订单 / 车销订单 /
   调拨单」右侧的「＋」带 `?type=`，进来就选好了，不用每次手选（后端默认
   `order_type='self_pickup'`；不预置的话，从车销入口新建的单会落到自提名下）。
   ⚠️ 退单入口（`kind=return`）目前**没有后端退货单接口** ⇒ 明说，不静默建普通单。 */
const _qType = String((route.query && route.query.type) || '')
const isReturn = String((route.query && route.query.kind) || '') === 'return'
/* 新建页的「出货方式」选项 = 词表全档（**不含**筛选用的「全部方式」那一项） */
const TYPE_OPTIONS = Object.entries(ORDER_TYPE).map(([value, v]) => ({ value, text: v.text }))

const saving = ref(false)
const customers = ref([])
const warehouses = ref([])
const products = ref([])
const custKw = ref('')
const prodKw = ref('')

const form = ref({
  customer_id: 0, warehouse_id: 0,
  delivery_date: '', delivery_address: '', note: '',
  /* 未知 `type` 一律落回自提（与后端默认值一致，不把脏 query 传下去） */
  order_type: ORDER_TYPE[_qType] ? _qType : 'self_pickup',
})
const items = ref([])

/* 幂等键：本页一次「会话」的标识；提交成功/失败都不复用同一次点击之外的语义 */
let idemKey = newIdemKey()
function newIdemKey () {
  return 'psi-sale-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

const prodOptions = computed(() => {
  const k = prodKw.value.trim().toLowerCase()
  if (!k) return products.value
  return products.value.filter(p => (p.name || '').toLowerCase().includes(k))
})
const totalAmount = computed(() => items.value.reduce((s, r) => s + rowAmount(r), 0))

function rowAmount (r) {
  const q = Number(r.quantity || 0)
  const p = Number(r.unit_price || 0)
  return (q && p) ? Math.round(q * p * 100) / 100 : 0
}

function addRow () {
  items.value.push({
    product_id: 0, quantity: '', unit: '', unitFromBase: false, unit_price: '',
  })
}

function onPick (row) {
  const p = products.value.find(x => x.id === row.product_id)
  if (!p) return
  const ou = String(p.order_unit || '').trim()
  row.unit = ou || String(p.unit || '').trim()
  row.unitFromBase = !ou && !!row.unit
  if (!row.unit_price && Number(p.sale_price || 0) > 0) row.unit_price = String(p.sale_price)
}

async function loadCustomers () {
  try {
    const d = await psiApi.refs('customers', custKw.value, 200)
    customers.value = d.customers || []
  } catch (e) {
    toast(e.message || '客户读取失败', 'error')
  }
}

function validate () {
  if (!form.value.customer_id) return '请先选择客户'
  if (!form.value.warehouse_id) return '请选择出货仓库'
  if (!items.value.length) return '请至少添加一行商品明细'
  for (let i = 0; i < items.value.length; i++) {
    const r = items.value[i]
    const at = `第 ${i + 1} 行`
    if (!r.product_id) return `${at}：请选择商品`
    if (!(Number(r.quantity) > 0)) return `${at}：数量要大于 0`
    if (r.unit_price === '' || Number(r.unit_price) < 0) return `${at}：请填写单价`
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
      customer_id: form.value.customer_id,
      warehouse_id: form.value.warehouse_id,
      delivery_date: form.value.delivery_date || '',
      delivery_address: form.value.delivery_address || '',
      order_type: form.value.order_type || 'self_pickup',
      note: form.value.note || '',
      idempotency_key: idemKey,
      items: items.value.map(r => ({
        product_id: r.product_id,
        quantity: Number(r.quantity),
        unit_price: Number(r.unit_price),
      })),
    }
    const r = await psiApi.createSale(body)
    idemKey = newIdemKey()                      // 本次已落地，换键避免后续误复用
    const oid = r && (r.order_id || r.id)
    toast(`销售单已保存（${(r && r.order_no) || oid || ''}）`, 'success')
    if (oid) router.replace('/inventory/sale/' + oid)
    else router.replace('/inventory/sale')
  } catch (e) {
    // 后端原因原样显示（例如「超信用额度（可用¥…，本次¥…）」）
    toast(e.message || '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

function back () { router.push('/inventory/sale') }
onMounted(async () => {
  addRow()
  try {
    // 拉 customers 是本页必需的（要选客户）；不要把 products 的 limit 调太小，否则下拉选不到人
    const d = await psiApi.refs('warehouses,customers,products', '', 500)
    warehouses.value = d.warehouses || []
    customers.value = d.customers || []
    products.value = d.products || []
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
.isn-acts { display: flex; gap: 8px; flex-wrap: wrap }
/* v395：退单入口的「开发中」说明条（明说，不静默建普通单） */
.isn-note { margin-bottom: 12px; text-align: left }
.isn-note b { color: var(--t1) }
.isn-hd { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 12px }
.isn-f { display: flex; flex-direction: column; gap: 4px }
.isn-f-grow { flex: 1; min-width: 160px }
.isn-lb { font-size: 12px; color: var(--t3) }
.isn-req { color: var(--dan); font-size: 11px }
.isn-kw { width: 190px; height: 32px }
.isn-sel { min-width: 170px; height: 32px }
.isn-date { height: 32px }
.isn-addr { width: 220px; height: 32px }

.isn-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px }
.isn-prod-kw { width: 240px; height: 32px; margin-left: auto }
.isn-tip { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; color: var(--t2); margin: 0 0 10px }
.isn-tip svg { color: var(--p-dark); flex: none; margin-top: 1px }

.isn-tbl { min-width: 720px }
.isn-c-prod { min-width: 280px }
.isn-c-qty, .isn-c-price, .isn-c-amt { width: 100px }
.isn-c-unit { width: 76px }
.isn-c-del { width: 44px }
.isn-in { width: 100%; height: 30px }
.isn-in.num { text-align: right; font-variant-numeric: tabular-nums }
.isn-amt { font-variant-numeric: tabular-nums; white-space: nowrap }
.isn-unit { font-size: 13px; color: var(--t1) }
.isn-unit.fallback, .isn-unit.none { color: var(--t3) }

.isn-foot { display: flex; padding-top: 12px }
.isn-total { font-size: 14px; margin-left: auto }
.isn-total b { font-size: 18px; font-variant-numeric: tabular-nums }

@media (max-width: 640px) {
  .isn-hd { align-items: stretch }
  .isn-f, .isn-kw, .isn-sel, .isn-date, .isn-addr { width: 100%; min-width: 0 }
  .isn-prod-kw { width: 100%; margin-left: 0 }
}
</style>
