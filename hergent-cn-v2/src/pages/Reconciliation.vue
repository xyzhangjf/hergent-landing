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

    <!-- 催收跟进（AR Agent 闭环） -->
    <div class="card col-card">
      <div class="panel-hd">
        <b>催收跟进</b>
        <span class="tag warn">对完账，还能持续要回来</span>
        <button class="btn btn-ghost btn-sm" @click="rebuildQueue">刷新队列</button>
      </div>

      <div v-if="colSummary" class="col-stats">
        <div class="col-stat"><b>{{ fmt(colSummary.total_amount) }}</b><span>未收总额</span></div>
        <div class="col-stat"><b>{{ colSummary.total_items }}</b><span>待跟进</span></div>
        <div class="col-stat warn"><b>{{ colSummary.promised }}</b><span>承诺中</span></div>
        <div class="col-stat bad"><b>{{ colSummary.disputed }}</b><span>争议</span></div>
        <div class="col-stat red"><b>{{ colSummary.escalated }}</b><span>需人工</span></div>
      </div>

      <div v-if="colLoading" class="state-empty">加载催收队列…</div>
      <div v-else-if="!colItems.length" class="state-empty">没有待催收的应收款</div>

      <div v-else class="col-list">
        <div v-for="it in colItems" :key="it.id" class="col-item" :class="{ esc: it.escalated, disp: it.status === 'disputed' }">
          <div class="col-main">
            <div class="col-top">
              <b>{{ it.contact_name }}</b>
              <span class="tag" :class="tierCls(it)">{{ it.tier_label }}</span>
              <span v-if="it.status === 'promised'" class="col-promise">承诺 {{ it.promised_date || '—' }}</span>
              <span v-if="it.status === 'disputed'" class="col-dispute">争议中</span>
              <span v-if="it.escalated" class="col-esc">需人工</span>
            </div>
            <div class="col-meta">
              <span class="col-amount">¥{{ fmt(it.amount) }}</span>
              <span>到期 {{ (it.due_date || '').slice(0, 10) }}</span>
              <span v-if="it.age_days > 0" class="val-bad">逾期 {{ it.age_days }} 天</span>
            </div>
            <div v-if="it.template" class="col-tmpl">{{ it.template }}</div>
            <div v-if="it.note" class="col-note">{{ it.note }}</div>
          </div>
          <div class="col-ops">
            <button class="btn btn-ghost btn-sm" @click="act(it, 'contacted', '')">已联系</button>
            <button class="btn btn-ghost btn-sm" @click="promise(it)">承诺付款</button>
            <button class="btn btn-ghost btn-sm" @click="act(it, 'disputed', '')">争议</button>
            <button class="btn btn-primary btn-sm" @click="act(it, 'resolved', '')">已解决</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { toast } from '../store'
import { reconciliationApi, collectionsApi } from '../api/modules'

const step = ref(1)
const customers = ref([])
const loading = ref(false)
const cur = ref({})
const detail = ref({ sale_orders: [], payments: [], ar_total: 0 })
const claimAmount = ref(null)
const matching = ref(false)
const matchResult = ref(null)

/* ---- 催收跟进 ---- */
const colItems = ref([])
const colSummary = ref(null)
const colLoading = ref(false)

function tierCls(it) {
  if (it.status === 'disputed') return 'bad'
  if (it.escalated) return 'warn'
  return 'info'
}

async function loadCols() {
  colLoading.value = true
  try {
    const [q, s] = await Promise.all([collectionsApi.queue(), collectionsApi.summary()])
    colItems.value = q.items || []
    colSummary.value = s
  } catch (e) {
    toast('催收队列加载失败：' + (e.message || ''), 'error')
  } finally {
    colLoading.value = false
  }
}

async function rebuildQueue() {
  try {
    await collectionsApi.rebuild()
    toast('队列已刷新', 'ok')
    loadCols()
  } catch (e) { toast('刷新失败：' + (e.message || ''), 'error') }
}

async function act(it, action, note) {
  try {
    await collectionsApi.action(it.id, { action, note })
    toast(action === 'resolved' ? '已解决' : '已记录', 'ok')
    loadCols()
  } catch (e) { toast('操作失败：' + (e.message || ''), 'error') }
}

async function promise(it) {
  const d = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  // 简单询问默认 7 天后
  try {
    await collectionsApi.action(it.id, { action: 'promised', promised_date: d, note: '承诺付款' })
    toast('已记录承诺（默认 7 天内）', 'ok')
    loadCols()
  } catch (e) { toast('操作失败：' + (e.message || ''), 'error') }
}

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

onMounted(() => { loadCustomers(); loadCols() })
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
/* 催收跟进 */
.col-card{margin-top:16px;padding:18px}
.col-stats{display:flex;gap:12px;margin:14px 0;flex-wrap:wrap}
.col-stat{display:flex;flex-direction:column;align-items:center;background:var(--bg2);border-radius:10px;padding:10px 18px;min-width:76px}
.col-stat b{font-size:18px;font-weight:500;color:var(--t1)}
.col-stat span{font-size:11px;color:var(--t3);margin-top:2px}
.col-stat.warn b{color:#ff9500}
.col-stat.bad b{color:#ff3b30}
.col-stat.red b{color:#ff3b30;text-decoration:underline}
.col-list{display:flex;flex-direction:column;gap:10px}
.col-item{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border:1px solid var(--bd);border-radius:12px;padding:14px;background:var(--bg)}
.col-item.esc{border-color:rgba(255,59,48,.4);background:rgba(255,59,48,.04)}
.col-item.disp{border-color:rgba(255,149,0,.5)}
.col-main{flex:1;min-width:0}
.col-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.col-top b{font-size:14px}
.col-meta{display:flex;gap:14px;font-size:12px;color:var(--t2);margin-top:6px}
.col-amount{font-size:15px;font-weight:500;color:var(--t1)}
.col-tmpl{font-size:12px;color:var(--t2);background:var(--bg2);border-radius:8px;padding:8px 10px;margin-top:8px;line-height:1.6}
.col-note{font-size:11px;color:var(--t3);margin-top:6px}
.col-promise{font-size:11px;color:#34c759;background:rgba(52,199,89,.12);padding:2px 8px;border-radius:6px}
.col-dispute{font-size:11px;color:#ff9500;background:rgba(255,149,0,.15);padding:2px 8px;border-radius:6px}
.col-esc{font-size:11px;color:#ff3b30;background:rgba(255,59,48,.1);padding:2px 8px;border-radius:6px}
.col-ops{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
</style>
