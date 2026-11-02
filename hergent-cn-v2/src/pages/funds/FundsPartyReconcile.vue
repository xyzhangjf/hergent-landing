<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h1>往来核销</h1>
        <span class="page-sub">逐笔核销客户应收 / 供应商应付：一笔预收可分拆冲多张单据，账本留痕可追溯。</span>
      </div>
      <div class="frc-acts">
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="reloadAll"><Icon name="refresh" :size="14" />刷新</button>
      </div>
    </div>

    <!-- 选择往来方 -->
    <div class="pr-toolbar">
      <div class="pr-seg">
        <button :class="['pr-seg-btn', { on: partyType === 'customer' }]" @click="switchParty('customer')">客户</button>
        <button :class="['pr-seg-btn', { on: partyType === 'supplier' }]" @click="switchParty('supplier')">供应商</button>
      </div>
      <select v-model="contactId" class="input pr-contact" @change="onContactChange">
        <option :value="0">请选择{{ partyType === 'customer' ? '客户' : '供应商' }}</option>
        <option v-for="c in contacts" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <span v-if="outstanding !== null" class="pr-out">当前往来余额：
        <b :class="{ neg: outstanding < 0 }">{{ fmtMoney(outstanding) }}</b></span>
    </div>

    <div v-if="!contactId" class="pr-empty">请先选择{{ partyType === 'customer' ? '客户' : '供应商' }}。</div>
    <!-- v726：换往来方后到新数据回来之间，给骨架而不是空表格（旧数据已在 onContactChange 清空） -->
    <div v-else-if="blankLoading" class="card">
      <Skeleton :rows="6" :widths="['6%','22%','16%','16%','20%','20%']" label="正在读取往来明细" />
    </div>

    <template v-else>
      <div class="pr-tabs">
        <button :class="['pr-tab', { on: tab === 'advance' }]" @click="tab = 'advance'">预收冲应收</button>
        <button :class="['pr-tab', { on: tab === 'cash' }]" @click="tab = 'cash'">收款核销</button>
      </div>

      <!-- 预收冲应收 -->
      <div v-if="tab === 'advance'" class="pr-cols">
        <div class="card pr-col">
          <div class="pr-col-hd">未核销单据（左列）</div>
          <table class="tbl">
            <thead><tr><th>单号</th><th class="num">未收</th><th class="num">本次核销</th></tr></thead>
            <tbody>
              <tr v-for="r in receivables" :key="r.id">
                <td>{{ r.order_no || ('#' + r.id) }}</td>
                <td class="num">{{ fmtMoney(openOf(r)) }}</td>
                <td class="num">
                  <input type="number" min="0" :max="openOf(r)" step="0.01" class="input pr-amt"
                         v-model.number="r.apply" @input="onAdvanceInput">
                </td>
              </tr>
              <tr v-if="!receivables.length"><td colspan="3" class="pr-nodata">无未核销单据</td></tr>
            </tbody>
            <tfoot><tr><td>合计</td><td class="num">{{ fmtMoney(sumApply) }}</td><td></td></tr></tfoot>
          </table>
        </div>

        <div class="card pr-col">
          <div class="pr-col-hd">可用预收（右列）</div>
          <table class="tbl">
            <thead><tr><th>预收单</th><th class="num">可用余额</th><th class="num">本次使用</th></tr></thead>
            <tbody>
              <tr v-for="a in advances" :key="a.id">
                <td>#{{ a.id }}</td>
                <td class="num">{{ fmtMoney(a.available) }}</td>
                <td class="num">
                  <input type="number" min="0" :max="a.available" step="0.01" class="input pr-amt"
                         v-model.number="a.use" @input="onAdvanceInput">
                </td>
              </tr>
              <tr v-if="!advances.length"><td colspan="3" class="pr-nodata">无可用预收</td></tr>
            </tbody>
            <tfoot><tr><td>合计</td><td></td><td class="num">{{ fmtMoney(sumUse) }}</td></tr></tfoot>
          </table>
        </div>
      </div>

      <!-- 收款核销 -->
      <div v-else class="card pr-col pr-col-full">
        <div class="pr-col-hd">未核销单据（逐单收款）</div>
        <table class="tbl">
          <thead><tr><th>单号</th><th class="num">未收</th><th class="num">本次收款</th></tr></thead>
          <tbody>
            <tr v-for="r in receivables" :key="r.id">
              <td>{{ r.order_no || ('#' + r.id) }}</td>
              <td class="num">{{ fmtMoney(openOf(r)) }}</td>
              <td class="num">
                <input type="number" min="0" :max="openOf(r)" step="0.01" class="input pr-amt" v-model.number="r.pay">
              </td>
            </tr>
            <tr v-if="!receivables.length"><td colspan="3" class="pr-nodata">无未核销单据</td></tr>
          </tbody>
          <tfoot><tr><td>合计</td><td></td><td class="num">{{ fmtMoney(sumPay) }}</td></tr></tfoot>
        </table>
      </div>

      <div class="pr-submit">
        <span v-if="diffHint" class="pr-diff">{{ diffHint }}</span>
        <button v-if="tab === 'advance'" class="btn btn-primary" :disabled="!canSubmitAdvance" @click="submitAdvance">
          <Icon name="check" :size="14" />提交核销（预收冲应收）
        </button>
        <button v-else class="btn btn-primary" :disabled="!canSubmitCash" @click="submitCash">
          <Icon name="check" :size="14" />提交收款核销
        </button>
      </div>

      <!-- 往来账本轨迹 -->
      <div class="card pr-ledger">
        <div class="pr-col-hd">往来账本轨迹（可追溯）</div>
        <table class="tbl">
          <thead><tr><th>日期</th><th>凭证</th><th>冲抵自</th><th class="num">金额</th><th class="num">余额</th><th>备注</th></tr></thead>
          <tbody>
            <tr v-for="l in ledger" :key="l.id">
              <td>{{ l.posting_date }}</td>
              <td>{{ voucherLabel(l) }}</td>
              <td>{{ l.against_voucher_no ? ('#' + l.against_voucher_no) : '—' }}</td>
              <td class="num" :class="{ neg: l.amount < 0 }">{{ fmtMoney(l.amount) }}</td>
              <td class="num">{{ fmtMoney(l.outstanding) }}</td>
              <td>{{ l.remark }}</td>
            </tr>
            <tr v-if="!ledger.length"><td colspan="6" class="pr-nodata">暂无账本记录</td></tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import Icon from '../../components/Icon.vue'
import Skeleton from '../../components/Skeleton.vue'
import { partyLedgerApi } from '../../api/partyLedger'
import { fmtMoney } from '../../constants/psiLabels'

const partyType = ref('customer')
const contactId = ref(0)
const contacts = ref([])
const receivables = ref([])
const advances = ref([])
const ledger = ref([])
const tab = ref('advance')
const loading = ref(false)
const outstanding = ref(null)

const openOf = (r) => Math.round((parseFloat(r.amount) - parseFloat(r.paid_amount || 0)) * 100) / 100

const sumApply = computed(() => receivables.value.reduce((s, r) => s + (parseFloat(r.apply) || 0), 0))
const sumUse = computed(() => advances.value.reduce((s, a) => s + (parseFloat(a.use) || 0), 0))
const sumPay = computed(() => receivables.value.reduce((s, r) => s + (parseFloat(r.pay) || 0), 0))

// 预收冲应收：两列合计必须相等
const diffHint = computed(() => {
  if (tab.value !== 'advance') return ''
  if (sumApply.value === 0 && sumUse.value === 0) return ''
  const d = Math.round((sumApply.value - sumUse.value) * 100) / 100
  if (Math.abs(d) < 0.005) return ''
  return '本次核销（' + fmtMoney(sumApply.value) + '）与本次使用预收（' + fmtMoney(sumUse.value) + '）必须相等'
})
const canSubmitAdvance = computed(() => sumApply.value > 0 && Math.abs(sumApply.value - sumUse.value) < 0.005)
const canSubmitCash = computed(() => sumPay.value > 0)

/* v726：只在「一块数据都还没有」时出骨架。
   已选客户点「刷新」时旧数据仍在，那属于「刷新中」，不该把内容换成骨架。 */
const blankLoading = computed(() =>
  loading.value && !receivables.value.length && !advances.value.length && !ledger.value.length)

async function loadContacts() {
  try {
    const res = await partyLedgerApi.contacts(partyType.value)
    contacts.value = (res && res.items) || []
  } catch (e) {
    contacts.value = []
  }
}

async function reloadAll() {
  if (!contactId.value) return
  loading.value = true
  try {
    const [un, lg] = await Promise.all([
      partyLedgerApi.unreconciled(partyType.value, contactId.value),
      partyLedgerApi.list(partyType.value, contactId.value),
    ])
    receivables.value = (un.receivables || []).map(r => ({ ...r, apply: 0, pay: 0 }))
    advances.value = (un.advances || []).map(a => ({ ...a, use: 0 }))
    ledger.value = (lg && lg.items) || []
    outstanding.value = ledger.value.length
      ? Math.round(ledger.value[0].outstanding * 100) / 100 : 0
  } catch (e) {
    alert('取数失败：' + (e.message || e))
  } finally {
    loading.value = false
  }
}

function onContactChange() {
  outstanding.value = null
  /* 🔴 v726：换往来方必须**立刻清空**这三份数据。
     原实现只清 `outstanding`，新数据回来前表格里仍是**上一个客户**的未收单据和账本 ——
     那是一句关于别人的结论，比空白危险得多（差点被当成这个客户的账核销掉）。 */
  receivables.value = []
  advances.value = []
  ledger.value = []
  if (contactId.value) reloadAll()
}

function switchParty(t) {
  partyType.value = t
  contactId.value = 0
  receivables.value = []
  advances.value = []
  ledger.value = []
  outstanding.value = null
  loadContacts()
}

// 预收冲应收：单笔输入不超过未收 / 可用余额
function onAdvanceInput() {
  for (const r of receivables.value) {
    if ((parseFloat(r.apply) || 0) > openOf(r)) r.apply = openOf(r)
  }
  for (const a of advances.value) {
    if ((parseFloat(a.use) || 0) > parseFloat(a.available || 0)) a.use = a.available
  }
}

async function submitAdvance() {
  const items = []
  for (const r of receivables.value) {
    const amt = parseFloat(r.apply) || 0
    if (amt > 0) items.push({ ref_type: partyType.value === 'customer' ? 'ar' : 'ap', ref_id: r.id, amount: amt })
  }
  for (const a of advances.value) {
    const amt = parseFloat(a.use) || 0
    if (amt > 0) items.push({ ref_type: partyType.value === 'customer' ? 'pre_ar' : 'pre_ap', ref_id: a.id, amount: amt })
  }
  if (!items.length) return
  try {
    await partyLedgerApi.writeoff({
      type: partyType.value === 'customer' ? 'ar_ar' : 'ap_ap',
      contact_id: contactId.value,
      items,
      note: '预收冲应收',
    })
    alert('核销成功')
    await reloadAll()
  } catch (e) {
    alert('核销失败：' + (e.message || e))
  }
}

async function submitCash() {
  const calls = []
  for (const r of receivables.value) {
    const amt = parseFloat(r.pay) || 0
    if (amt > 0) {
      calls.push(partyLedgerApi.payment({
        contact_id: contactId.value,
        amount: amt,
        pay_type: partyType.value === 'customer' ? 'ar' : 'ap',
        ref_type: partyType.value === 'customer' ? 'sale_order' : 'purchase',
        ref_id: r.id,
        note: '收款核销',
      }))
    }
  }
  if (!calls.length) return
  try {
    await Promise.all(calls)
    alert('收款成功')
    await reloadAll()
  } catch (e) {
    alert('收款失败：' + (e.message || e))
  }
}

function voucherLabel(l) {
  const map = { sales_invoice: '销售应收', purchase_invoice: '采购应付', payment: '收款', writeoff: '核销', advance: '预收/预付' }
  return map[l.voucher_type] || l.voucher_type
}

watch(partyType, () => { loadContacts() })

loadContacts()
</script>

<style scoped>
.pr-toolbar { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-4); flex-wrap: wrap; }
.pr-seg { display: inline-flex; border: 1px solid var(--bd); border-radius: var(--radius-sm); overflow: hidden; }
/* v723：`background:#fff` → `var(--bg)`。写死白底在深色下是白底 + 白字（--t1）= **1:1**，
   整个按钮的文字直接消失。同类坑 CopilotDrawer.vue 的注释里早已记过，这里又犯一次。 */
.pr-seg-btn { padding: var(--sp-h6) var(--sp-4); border: 0; background: var(--bg); cursor: pointer; font-size:var(--fs-base); }
/* v723：`--c-primary` 别名到 `--chart-1`（**图表调色板色**），深色下是亮蓝 ⇒ 白字 1.81。
   品牌实心底一律用 `--p-solid`（5.36）。 */
.pr-seg-btn.on { background: var(--p-solid); color: #fff; }
.pr-contact { min-width: 200px; }
.pr-out { color: var(--t3); font-size:var(--fs-base); }
.pr-out b { color: var(--t1); }
.pr-out b.neg { color: var(--dan); }
.pr-empty { color: var(--t3); padding: 40px; text-align: center; }
.pr-tabs { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-3); }
.pr-tab { padding: var(--sp-h6) var(--sp-4); border: 1px solid var(--bd); background: var(--bg); border-radius: var(--radius-sm); cursor: pointer; font-size:var(--fs-base); }
.pr-tab.on { background: var(--p-bg); border-color: var(--c-primary); color: var(--c-primary); }
.pr-cols { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-4); }
.pr-col-full { margin-top: var(--sp-3); }
.pr-col-hd { font-weight: 600; margin-bottom: var(--sp-2); font-size:var(--fs-base); color: var(--t2); }
.pr-amt { width: 110px; }
.pr-nodata { color: var(--t3); text-align: center; padding: var(--sp-5); }
.pr-submit { margin: var(--sp-4) 0; display: flex; align-items: center; gap: var(--sp-3); }
.pr-diff { color: var(--dan); font-size:var(--fs-base); }
.pr-ledger { margin-top: var(--sp-4); }
.num { text-align: right; }
.neg { color: var(--dan); }
</style>
