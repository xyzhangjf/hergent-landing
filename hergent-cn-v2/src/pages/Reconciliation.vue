<template>
  <div class="page">
    <div class="page-hd">
      <h2>对账工作流</h2>
      <span class="page-sub">读应收 → 匹配差异 → 确认对账</span>
    </div>

    <!-- 步骤指示器 -->
    <div class="rec-steps">
      <div class="rec-step" :class="{ on: step >= 1 }">① 选客户</div>
      <span class="rec-arrow">→</span>
      <div class="rec-step" :class="{ on: step >= 2 }">② 匹配对账</div>
      <span class="rec-arrow">→</span>
      <div class="rec-step" :class="{ on: step >= 3 }">③ 确认</div>
    </div>

    <!-- 步骤 1：欠款客户列表 -->
    <div v-if="step === 1" class="card rec-panel">
      <div class="panel-hd">
        <b>有欠款的客户</b>
        <span class="tag info">{{ customers.length }} 家</span>
      </div>
      <div v-if="loading" class="state-empty">加载中…</div>
      <div v-else-if="customers.length" class="table-wrap">
        <table class="tbl">
          <thead><tr><th>客户</th><th class="num">欠款总额</th><th class="num">应收条数</th><th></th></tr></thead>
          <tbody>
            <tr v-for="c in customers" :key="c.customer_id">
              <td>{{ c.customer_name }}</td>
              <td class="num val-warn">¥{{ fmt(c.ar_total) }}</td>
              <td class="num">{{ c.count }}</td>
              <td><button class="btn btn-primary btn-sm" @click="openCustomer(c)">去对账</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="state-empty">暂无欠款客户，账目清爽 👍</div>
    </div>

    <!-- 步骤 2/3：对账详情 -->
    <div v-else class="card rec-panel">
      <div class="panel-hd">
        <b>{{ cur.customer_name }} · 对账</b>
        <button class="btn btn-ghost" @click="backToList">← 返回</button>
      </div>

      <!-- 账目明细 -->
      <div class="rec-grid">
        <div>
          <div class="rec-sub">销售单 <span class="rec-sub-n">{{ detail.sale_orders.length }}</span></div>
          <div class="table-wrap">
            <table class="tbl">
              <thead><tr><th>单号</th><th>日期</th><th class="num">金额</th></tr></thead>
              <tbody>
                <tr v-for="(o, i) in detail.sale_orders" :key="i">
                  <td>{{ o.order_no || '—' }}</td>
                  <td>{{ o.order_date || '—' }}</td>
                  <td class="num">¥{{ fmt(o.total_amount) }}</td>
                </tr>
                <tr v-if="!detail.sale_orders.length"><td colspan="3" class="rec-empty">无销售单</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div class="rec-sub">收款 <span class="rec-sub-n">{{ detail.payments.length }}</span></div>
          <div class="table-wrap">
            <table class="tbl">
              <thead><tr><th>类型</th><th>日期</th><th class="num">金额</th></tr></thead>
              <tbody>
                <tr v-for="(p, i) in detail.payments" :key="i">
                  <td>{{ p.category || '收款' }}</td>
                  <td>{{ p.created_at || '—' }}</td>
                  <td class="num">¥{{ fmt(p.amount) }}</td>
                </tr>
                <tr v-if="!detail.payments.length"><td colspan="3" class="rec-empty">无收款记录</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 应收余额 -->
      <div class="rec-balance">
        系统应收余额 <b class="val-warn">¥{{ fmt(detail.ar_total) }}</b>
      </div>

      <!-- 匹配对账 -->
      <div class="rec-match">
        <label class="rec-label">客户声称欠款金额（对方报的数）</label>
        <div class="rec-match-row">
          <input v-model.number="claimAmount" class="input" type="number" placeholder="输入客户声称的金额">
          <button class="btn btn-primary" :disabled="claimAmount == null || matching" @click="doMatch">{{ matching ? '匹配中…' : '匹配对账' }}</button>
        </div>

        <div v-if="matchResult" class="rec-result" :class="matchResult.difference === 0 ? 'ok' : 'diff'">
          <div class="rec-result-row">客户声称：<b>¥{{ fmt(matchResult.statement_amount) }}</b></div>
          <div class="rec-result-row">系统算出：<b>¥{{ fmt(matchResult.system_total) }}</b></div>
          <div class="rec-result-row big">
            差异：<b :class="matchResult.difference === 0 ? 'val-ok' : 'val-bad'">¥{{ fmt(matchResult.difference) }}</b>
            <span v-if="matchResult.difference === 0" class="val-ok"> · 对得上 ✓</span>
            <span v-else class="val-bad"> · 有差异，需查明</span>
          </div>
          <button class="btn btn-primary" style="margin-top:12px" @click="doConfirm">确认对账（写入台账）</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { toast } from '../store'
import { reconciliationApi } from '../api/modules'

const step = ref(1)
const customers = ref([])
const loading = ref(false)
const cur = ref({})
const detail = ref({ sale_orders: [], payments: [], ar_total: 0 })
const claimAmount = ref(null)
const matching = ref(false)
const matchResult = ref(null)

function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

async function loadCustomers() {
  loading.value = true
  try {
    const d = await reconciliationApi.customers()
    customers.value = d.customers || []
  } catch (e) {
    toast('加载客户失败：' + (e.message || ''), 'error')
  } finally {
    loading.value = false
  }
}

async function openCustomer(c) {
  cur.value = c
  claimAmount.value = null
  matchResult.value = null
  step.value = 2
  try {
    const d = await reconciliationApi.customerData(c.customer_id)
    detail.value = {
      sale_orders: d.sale_orders || [],
      payments: d.payments || [],
      ar_total: d.ar_total || 0,
    }
  } catch (e) {
    toast('加载账目失败：' + (e.message || ''), 'error')
  }
}

function backToList() {
  step.value = 1
  matchResult.value = null
}

async function doMatch() {
  if (claimAmount.value == null) return
  matching.value = true
  try {
    const d = await reconciliationApi.customerMatch({
      customer_id: cur.value.customer_id,
      amount: claimAmount.value,
    })
    matchResult.value = d
    step.value = 3
  } catch (e) {
    toast('匹配失败：' + (e.message || ''), 'error')
  } finally {
    matching.value = false
  }
}

async function doConfirm() {
  try {
    await reconciliationApi.customerConfirm({
      customer_id: cur.value.customer_id,
      customer_name: cur.value.customer_name,
      amount: matchResult.value.statement_amount,
      difference: matchResult.value.difference,
    })
    toast('已确认与 ' + cur.value.customer_name + ' 的对账', 'success')
    backToList()
    loadCustomers()
  } catch (e) {
    toast('确认失败：' + (e.message || ''), 'error')
  }
}

onMounted(loadCustomers)
</script>

<style scoped>
.page-hd{display:flex;align-items:baseline;gap:10px;margin-bottom:18px}
.page-hd h2{font-size:20px;font-weight:600}
.page-sub{font-size:12px;color:var(--t3)}

.rec-steps{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.rec-step{font-size:13px;color:var(--t3);padding:6px 12px;border-radius:16px;background:var(--bg2)}
.rec-step.on{color:var(--p-dark);background:var(--p-bg);font-weight:500}
.rec-arrow{color:var(--t3);font-size:12px}

.rec-panel{padding:18px}
.rec-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.rec-sub{font-size:13px;font-weight:500;color:var(--t1);margin-bottom:8px}
.rec-sub-n{font-size:12px;color:var(--t3);margin-left:4px}
.rec-empty{color:var(--t3);text-align:center;padding:10px}
.rec-balance{font-size:14px;color:var(--t1);padding:12px 14px;background:var(--bg2);border-radius:10px;margin-bottom:16px}
.rec-balance b{font-size:18px;margin-left:6px}

.rec-match{padding-top:4px}
.rec-label{display:block;font-size:13px;color:var(--t2);margin-bottom:8px}
.rec-match-row{display:flex;gap:10px;max-width:420px}
.rec-match-row .input{flex:1}
.rec-result{margin-top:16px;padding:14px;border-radius:12px;border:1px solid var(--border-subtle)}
.rec-result.ok{background:rgba(var(--suc-rgb),.06)}
.rec-result.diff{background:rgba(var(--dan-rgb),.05)}
.rec-result-row{font-size:13px;color:var(--t1);margin-bottom:6px}
.rec-result-row.big{font-size:15px;padding-top:8px;border-top:1px solid var(--border-subtle)}

.btn-sm{height:30px;padding:0 12px;font-size:12px}
.val-ok{color:var(--suc)}
.val-warn{color:var(--war)}
.val-bad{color:var(--dan)}

@media(max-width:768px){
  .rec-grid{grid-template-columns:1fr}
}
</style>
