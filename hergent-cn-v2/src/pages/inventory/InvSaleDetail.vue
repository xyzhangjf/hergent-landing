<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div>
        <h2>销售单详情</h2>
        <span class="page-sub">{{ o.order_no || ('#' + oid) }}</span>
      </div>
      <div class="isd-acts">
        <button class="btn btn-ghost btn-sm" @click="back">返回列表</button>
        <button v-if="canWrite && canSign" class="btn btn-primary btn-sm" :disabled="busy" @click="doSign">
          <Icon name="check" :size="14" />{{ busy ? '处理中…' : '确认签收' }}
        </button>
        <button v-if="canWrite && canDeliver" class="btn btn-primary btn-sm" :disabled="busy" @click="doDeliver">
          <Icon name="package" :size="14" />{{ busy ? '处理中…' : '发货' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="state-empty">加载中…</div>

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load">重试</button>
    </div>

    <template v-else-if="o.id">
      <div class="card isd-hd">
        <div class="isd-f"><span class="isd-lb">状态</span>
          <span class="tag" :class="tagOf(SO_STATUS, o.status)">{{ textOf(SO_STATUS, o.status) }}</span>
        </div>
        <div v-if="o.delivery_status" class="isd-f"><span class="isd-lb">配送</span>
          <span class="tag" :class="tagOf(DELIVERY_STATUS, o.delivery_status)">
            {{ textOf(DELIVERY_STATUS, o.delivery_status) }}
          </span>
        </div>
        <div class="isd-f"><span class="isd-lb">客户</span><span>{{ o.customer_name || '—' }}</span></div>
        <div class="isd-f"><span class="isd-lb">仓库</span><span>{{ warehouseName }}</span></div>
        <div class="isd-f"><span class="isd-lb">金额</span><b class="isd-amt">¥{{ fmtMoney(o.total_amount) }}</b></div>
        <div class="isd-f"><span class="isd-lb">出货方式</span><span>{{ orderTypeText(o.order_type) }}</span></div>
        <div class="isd-f"><span class="isd-lb">下单日期</span><span>{{ (o.order_date || '').slice(0, 10) || '—' }}</span></div>
        <div class="isd-f"><span class="isd-lb">交货日期</span><span>{{ (o.delivery_date || '').slice(0, 10) || '—' }}</span></div>
        <div v-if="o.delivery_address" class="isd-f isd-f-grow">
          <span class="isd-lb">交货地址</span><span>{{ o.delivery_address }}</span>
        </div>
        <div v-if="o.note" class="isd-f isd-f-grow"><span class="isd-lb">备注</span><span>{{ o.note }}</span></div>
      </div>

      <div v-if="statusHint" class="card isd-hint">
        <Icon name="lightbulb" :size="16" /><span>{{ statusHint }}</span>
      </div>

      <div class="card">
        <div class="isd-bar">
          <b>商品明细</b>
          <span class="isd-note">共 {{ items.length }} 行</span>
        </div>
        <div v-if="!items.length" class="state-empty">这张单没有明细。</div>
        <div v-else class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>商品</th>
                <th>规格</th>
                <th class="num">数量</th>
                <th>单位</th>
                <th class="num">单价</th>
                <th class="num">金额</th>
                <th>出库批次</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(it, i) in items" :key="it.id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ it.product_name || ('商品 ' + it.product_id) }}</td>
                <td>{{ it.spec || '—' }}</td>
                <td class="num">{{ fmtQty(it.quantity) }}</td>
                <td>{{ it.unit || '—' }}</td>
                <td class="num">¥{{ fmtMoney(it.unit_price) }}</td>
                <td class="num">¥{{ fmtMoney(it.amount) }}</td>
                <td>
                  <span v-if="it.batch_no">{{ it.batch_no }}</span>
                  <span v-else class="isd-note">发货后按最早到期批次生成</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
/* 销售单详情 —— 数据源：`GET /api/psi/sale-orders/{id}` + `.../deliver` + `.../sign`。
   🔴 按钮判据**与后端状态前置逐字对齐**：
      `sale_order_deliver` 只接受 `status='draft'`；`sale_order_sign` 只接受 `'delivered'`。
      前端放宽（比如草稿就给「签收」）只会换来一次必然失败点击 + 一句后端报错。
   🔴 发货的后果要写清楚：**按最早到期批次扣减**（过期批次不可售，缺货会被拦），
      因为它会真实改变库存，且用户点之前看不到「会扣哪几个批次」。 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { psiApi } from '../../api/psi'
import { canDo, toast } from '../../store'
import {
  SO_STATUS, DELIVERY_STATUS, ORDER_TYPE, textOf, tagOf, fmtMoney,
} from '../../constants/psiLabels'

const route = useRoute()
const router = useRouter()

const oid = Number(route.params.id)
const loading = ref(true)
const err = ref('')
const busy = ref(false)
const o = ref({})
const items = ref([])
const warehouses = ref([])

const canWrite = computed(() => canDo('inventory', 'create'))
const canDeliver = computed(() => o.value.status === 'draft')
const canSign = computed(() => o.value.status === 'delivered')

const warehouseName = computed(() => {
  const w = warehouses.value.find(x => x.id === o.value.warehouse_id)
  return w ? w.name : ('仓库 ' + (o.value.warehouse_id || '—'))
})

function orderTypeText (v) { return textOf(ORDER_TYPE, v, '未标注') }

const statusHint = computed(() => {
  const s = o.value.status
  if (s === 'draft') return '还没发货。点「发货」后系统会按最早到期的批次扣减库存。'
  if (s === 'delivered') return '已发货、库存已扣减。客户收货后点「确认签收」生成应收账款。'
  if (s === 'signed') return '这一单已经完成：库存已出、应收已生成。'
  if (s === 'cancelled') return '这一张已取消。'
  if (s === 'returned') return '这一张已退货。'
  if (s === 'rejected') return '这一张被驳回了。'
  return ''
})

async function load () {
  loading.value = true
  err.value = ''
  try {
    const [d, refs] = await Promise.all([
      psiApi.getSale(oid),
      warehouses.value.length ? Promise.resolve(null) : psiApi.refs('warehouses'),
    ])
    o.value = (d && d.order) || {}
    items.value = (d && d.items) || []
    if (refs && Array.isArray(refs.warehouses)) warehouses.value = refs.warehouses
  } catch (e) {
    err.value = e.message || '销售单读取失败'
  } finally {
    loading.value = false
  }
}

async function doDeliver () {
  if (busy.value) return
  const ok = window.confirm(
    `确认这一单已经发货？\n\n` +
    `发货后系统会按【最早到期的批次】扣减库存，并生成出库记录。\n` +
    `已经过期的批次不能出库；如果可售库存不够，这一单会被拦下、不会扣减。\n\n` +
    `确定发货吗？`
  )
  if (!ok) return
  busy.value = true
  try {
    const r = await psiApi.deliverSale(oid)
    if (r && r.error) throw new Error(JSON.stringify(r).slice(0, 300))
    toast('已发货：库存已按最早到期批次扣减', 'success')
    await load()
  } catch (e) {
    // 库存不足时后端会带明细（哪几行缺多少），原样显示
    toast(e.message || '发货失败', 'error')
  } finally {
    busy.value = false
  }
}

async function doSign () {
  if (busy.value) return
  const ok = window.confirm(
    `确认客户已经签收？\n\n` +
    `签收后会生成这一单的应收账款，并按客户的账期算到期日。\n\n` +
    `确定签收吗？`
  )
  if (!ok) return
  busy.value = true
  try {
    const r = await psiApi.signSale(oid)
    if (r && r.error) throw new Error(JSON.stringify(r).slice(0, 300))
    toast('已签收：应收已生成', 'success')
    await load()
  } catch (e) {
    toast(e.message || '签收失败', 'error')
  } finally {
    busy.value = false
  }
}

function back () { router.push('/inventory/sale') }
function fmtQty (n) { return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) }
onMounted(load)
</script>

<style scoped>
.inv-page { display: block }
.isd-acts { display: flex; gap: 8px; flex-wrap: wrap }
.isd-hd { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 12px; align-items: baseline }
.isd-f { display: flex; flex-direction: column; gap: 4px }
.isd-f-grow { flex: 1; min-width: 200px }
.isd-lb { font-size: 12px; color: var(--t3) }
.isd-amt { font-size: 16px; font-variant-numeric: tabular-nums }

.isd-hint {
  display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
  border-left: 3px solid var(--p); font-size: 13px; color: var(--t1);
}
.isd-hint svg { color: var(--p-dark); flex: none }

.isd-bar { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap }
.isd-note { font-size: 12px; color: var(--t3) }

@media (max-width: 640px) {
  .isd-hd { gap: 14px }
}
</style>
