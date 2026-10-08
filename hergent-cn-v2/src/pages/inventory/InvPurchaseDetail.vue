<template>
  <div class="inv-page">
    <div class="page-hd split">
      <div>
        <h2>采购单详情</h2>
        <span class="page-sub">{{ o.order_no || ('#' + oid) }}</span>
      </div>
      <div class="ipd-acts">
        <button class="btn btn-ghost btn-sm" @click="back">返回列表</button>
        <button v-if="canWrite && canReceive" class="btn btn-ghost btn-sm" :disabled="busy"
                @click="showRecv = !showRecv">
          <Icon name="inbox" :size="14" />分批到货
        </button>
        <button v-if="canWrite && canConfirm" class="btn btn-primary btn-sm" :disabled="busy" @click="doConfirm">
          <Icon name="check" :size="14" />{{ busy ? '处理中…' : '确认入库' }}
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
      <!-- 表头信息 -->
      <div class="card ipd-hd">
        <div class="ipd-f"><span class="ipd-lb">状态</span>
          <span class="tag" :class="tagOf(PO_STATUS, o.status)">{{ textOf(PO_STATUS, o.status) }}</span>
        </div>
        <div class="ipd-f"><span class="ipd-lb">供应商</span><span>{{ o.supplier_name || '—' }}</span></div>
        <div class="ipd-f"><span class="ipd-lb">仓库</span><span>{{ warehouseName }}</span></div>
        <div class="ipd-f"><span class="ipd-lb">金额</span><b class="ipd-amt">¥{{ fmtMoney(o.total_amount) }}</b></div>
        <div class="ipd-f"><span class="ipd-lb">下单日期</span><span>{{ (o.order_date || '').slice(0, 10) || '—' }}</span></div>
        <div class="ipd-f"><span class="ipd-lb">预计到货</span><span>{{ o.expected_date || '—' }}</span></div>
        <div v-if="o.note" class="ipd-f ipd-f-grow"><span class="ipd-lb">备注</span><span>{{ o.note }}</span></div>
      </div>

      <!-- 状态说明：告诉用户「现在能不能入库、为什么不能」 -->
      <div v-if="statusHint" class="card ipd-hint">
        <Icon name="lightbulb" :size="16" /><span>{{ statusHint }}</span>
      </div>

      <!-- 分批到货面板（默认收起） -->
      <div v-if="showRecv && canReceive" class="card ipd-recv">
        <div class="ipd-recv-hd">
          <b>分批到货</b>
          <span class="ipd-note">填这次实际到了多少，可以分几次填完。</span>
        </div>
        <div class="table-wrap">
          <table class="tbl">
            <thead>
              <tr><th class="seq-th">序号</th><th>商品</th><th class="num">订购</th><th class="num">已到</th><th class="num">这次到货</th></tr>
            </thead>
            <tbody>
              <tr v-for="(g, i) in recvGroups" :key="g.product_id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ g.name }}</td>
                <td class="num">{{ fmtQty(g.ordered) }}</td>
                <td class="num">{{ fmtQty(g.received) }}</td>
                <td><input v-model="recv[g.product_id]" class="input ipd-in num" inputmode="decimal" placeholder="0" /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="ipd-recv-ft">
          <span class="ipd-note">这次到货只增加在库数量；批次号与到期日以「确认入库」时登记的为准。</span>
          <button class="btn btn-ghost btn-sm" @click="showRecv = false">取消</button>
          <button class="btn btn-primary btn-sm" :disabled="busy" @click="doReceive">提交到货</button>
        </div>
      </div>

      <!-- 明细 -->
      <div class="card">
        <div class="ipd-bar">
          <b>商品明细</b>
          <span class="ipd-note">共 {{ items.length }} 行</span>
        </div>
        <div v-if="!items.length" class="state-empty">这张单没有明细。</div>
        <div v-else class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>商品</th>
                <th class="num">数量</th>
                <th>单位</th>
                <th class="num">单价</th>
                <th class="num">金额</th>
                <th>批次号</th>
                <th>到期日</th>
                <th>生产日期</th>
                <th class="num">已到货</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(it, i) in items" :key="it.id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ it.product_name || ('商品 ' + it.product_id) }}</td>
                <td class="num">{{ fmtQty(it.quantity) }}</td>
                <td>{{ it.unit || '—' }}</td>
                <td class="num">¥{{ fmtMoney(it.unit_price) }}</td>
                <td class="num">¥{{ fmtMoney(it.amount) }}</td>
                <td>
                  <span v-if="it.batch_no">{{ it.batch_no }}</span>
                  <span v-else class="tag warn">未登记</span>
                </td>
                <td>
                  <span v-if="it.expiry_date">{{ it.expiry_date }}</span>
                  <span v-else class="tag warn">未登记</span>
                </td>
                <td>{{ it.production_date || '—' }}</td>
                <td class="num">{{ fmtQty(it.received_qty) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
/* 采购单详情 —— 数据源：`GET /api/psi/purchase-orders/{id}` + `.../confirm` + `.../receive`。
   🔴 入库动作的**后果预告**写在确认框里（批次/效期登记 + 生成应付 + 不可撤销），
      因为它是本模块里最不可逆的一步 —— 用户点之前必须知道会发生什么。
   ⚠️ 「分批到货」只调整在库数量，**不登记批次与到期日**（那是「确认入库」的职责）——
      界面上写明，避免用户以为分批到货也把效期补齐了。 */
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { psiApi } from '../../api/psi'
import { canDo, toast } from '../../store'
import { PO_STATUS, textOf, tagOf, PSI_NOTES, fmtMoney } from '../../constants/psiLabels'

const route = useRoute()
const router = useRouter()

const oid = Number(route.params.id)
const loading = ref(true)
const err = ref('')
const busy = ref(false)
const o = ref({})
const items = ref([])
const warehouses = ref([])
const showRecv = ref(false)
const recv = ref({})

const canWrite = computed(() => canDo('inventory', 'create'))
/* 判据与后端逐字对齐：`purchase_order_confirm` 只接受 `status IN ('draft','approved')` */
const canConfirm = computed(() => ['draft', 'approved'].includes(o.value.status))
const canReceive = computed(() => ['draft', 'approved', 'partial'].includes(o.value.status))

const warehouseName = computed(() => {
  const w = warehouses.value.find(x => x.id === o.value.warehouse_id)
  return w ? w.name : ('仓库 ' + (o.value.warehouse_id || '—'))
})

const statusHint = computed(() => {
  const s = o.value.status
  if (s === 'received') return '这批货已经入库，库存和应付都已生成。'
  if (s === 'cancelled') return '这张单已取消，不能再入库。'
  if (s === 'returned') return '这张单已退货。'
  if (s === 'pending_approval') return '这张单还在等审批。审批通过后才能确认入库。'
  if (s === 'partial') return '已经到过一部分货。剩下的到齐后点「确认入库」把批次与到期日补齐。'
  return ''
})

/* 分批到货：按**商品**聚合（后端按 (order_id, product_id) 找行，同一商品多行只会更新第一行
   ⇒ 前端先把多行合并成一项，语义才与后端一致，不会出现「填了没生效」）。 */
const recvGroups = computed(() => {
  const m = new Map()
  for (const it of items.value) {
    const k = it.product_id
    if (!m.has(k)) m.set(k, { product_id: k, name: it.product_name || ('商品 ' + k), ordered: 0, received: 0 })
    const g = m.get(k)
    g.ordered += Number(it.quantity || 0)
    g.received = Math.max(g.received, Number(it.received_qty || 0))
  }
  return [...m.values()]
})

async function load () {
  loading.value = true
  err.value = ''
  try {
    const [d, refs] = await Promise.all([
      psiApi.getPurchase(oid),
      warehouses.value.length ? Promise.resolve(null) : psiApi.refs('warehouses'),
    ])
    o.value = (d && d.order) || {}
    items.value = (d && d.items) || []
    if (refs && Array.isArray(refs.warehouses)) warehouses.value = refs.warehouses
  } catch (e) {
    err.value = e.message || '采购单读取失败'
  } finally {
    loading.value = false
  }
}

async function doConfirm () {
  if (busy.value) return
  const withBatch = items.value.filter(it => it.batch_no && it.expiry_date).length
  const noBatch = items.value.length - withBatch
  const ok = window.confirm(
    `确认这一单的货已经到齐并入库？\n\n` +
    `${PSI_NOTES.confirmIn}\n\n` +
    (noBatch
      ? `⚠️ 有 ${noBatch} 行明细没有登记批次号或到期日 —— 入库后这些库存进不了临期预警和「先出最早到期」。\n\n`
      : `本单 ${withBatch} 行明细都已登记批次号与到期日。\n\n`) +
    `确定入库吗？`
  )
  if (!ok) return
  busy.value = true
  try {
    const r = await psiApi.confirmPurchase(oid)
    if (r && r.error) throw new Error(r.error)
    toast('已入库：库存增加、应付已生成', 'success')
    await load()
  } catch (e) {
    toast(e.message || '入库失败', 'error')
  } finally {
    busy.value = false
  }
}

async function doReceive () {
  if (busy.value) return
  const list = recvGroups.value
    .map(g => ({ product_id: g.product_id, quantity: Number(recv.value[g.product_id] || 0) }))
    .filter(x => x.quantity > 0)
  if (!list.length) { toast('请填写这次到货的数量', 'warn'); return }
  busy.value = true
  try {
    const r = await psiApi.receivePurchase(oid, { items: list })
    if (r && r.error) throw new Error(r.error)
    toast('已记录这次到货', 'success')
    recv.value = {}
    showRecv.value = false
    await load()
  } catch (e) {
    toast(e.message || '到货登记失败', 'error')
  } finally {
    busy.value = false
  }
}

function back () { router.push('/inventory/purchase') }
function fmtQty (n) { return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) }
onMounted(load)
</script>

<style scoped>
.inv-page { display: block }
.ipd-acts { display: flex; gap: 8px; flex-wrap: wrap }
.ipd-hd { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 12px; align-items: baseline }
.ipd-f { display: flex; flex-direction: column; gap: 4px }
.ipd-f-grow { flex: 1; min-width: 200px }
.ipd-lb { font-size: 12px; color: var(--t3) }
.ipd-amt { font-size: 16px; font-variant-numeric: tabular-nums }

.ipd-hint {
  display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
  border-left: 3px solid var(--p); font-size: 13px; color: var(--t1);
}
.ipd-hint svg { color: var(--p-dark); flex: none }

.ipd-recv { margin-bottom: 12px }
.ipd-recv-hd { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap }
.ipd-recv-ft { display: flex; align-items: center; gap: 8px; padding-top: 12px; flex-wrap: wrap }
.ipd-in { height: 30px; width: 110px }
.ipd-in.num { text-align: right; font-variant-numeric: tabular-nums }

.ipd-bar { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap }
.ipd-note { font-size: 12px; color: var(--t3) }
.ipd-recv-ft .ipd-note { margin-right: auto }

@media (max-width: 640px) {
  .ipd-hd { gap: 14px }
  .ipd-recv-ft .ipd-note { width: 100%; margin-right: 0 }
}
</style>
