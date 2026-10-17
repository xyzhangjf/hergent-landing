<template>
  <div class="page">
    <div class="page-hd split">
      <div><h2>银行流水对账</h2><span class="page-sub">{{ sub }}</span></div>
      <div class="fbk-acts"><button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()"><Icon name="refresh" :size="14" />刷新</button></div>
    </div>

    <Skeleton v-if="loading" />
    <div v-else-if="err" class="state-error"><div class="se-ic"><Icon name="alert" :size="22" /></div><p>{{ err }}</p><button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button></div>

    <template v-else>
      <!-- 银行类账户概览 -->
      <div class="card kpi-strip cols-3">
        <div class="kpi"><div class="kpi-label">银行账户数</div><div class="kpi-val">{{ banks.length }}</div><div class="kpi-sub">已建银行类账户</div></div>
        <div class="kpi"><div class="kpi-label">银行资金总额</div><div class="kpi-val val-ok">¥{{ fmtMoney(bankTotal) }}</div><div class="kpi-sub">全部银行账户余额合计</div></div>
        <div class="kpi"><div class="kpi-label">本期流水笔数</div><div class="kpi-val">{{ rows.length }}</div><div class="kpi-sub">筛选范围内已过账流水</div></div>
      </div>

      <!-- 筛选 -->
      <div class="card fbk-filter">
        <div class="fbk-frow">
          <label>银行账户
            <select v-model="f.account" class="input"><option value="">全部银行账户</option><option v-for="a in banks" :key="a.id" :value="a.name">{{ a.name }}</option></select>
          </label>
          <label>日期从<input type="date" v-model="f.date_from" class="input"></label>
          <label>日期到<input type="date" v-model="f.date_to" class="input"></label>
          <button class="btn btn-ghost btn-sm" @click="load()"><Icon name="search" :size="14" />查询</button>
        </div>
      </div>

      <!-- 银行账户卡片 -->
      <div v-if="banks.length" class="fbk-accts">
        <div v-for="a in banks" :key="a.id" class="fbk-acct" :class="{ 'fbk-on': f.account === a.name }" @click="f.account = (f.account === a.name ? '' : a.name); load()">
          <div class="fbk-acct-n">{{ a.name }}</div>
          <div class="fbk-acct-t">{{ a.bank_name || '—' }} · {{ a.account_no || '未填账号' }}</div>
          <div class="fbk-acct-b" :class="a.current_balance < 0 ? 'val-bad' : 'val-ok'">¥{{ fmtMoney(a.current_balance) }}</div>
        </div>
      </div>
      <div v-else class="card fbk-hint">还没有银行类账户。在「资金余额表」里新建账户时把类型选成「银行」，即可在此对账。</div>

      <!-- 流水 -->
      <div class="card fbk-card">
        <div v-if="!rows.length" class="state-empty">该账户 / 日期范围内暂无已过账流水。</div>
        <div v-else class="table-wrap freeze-list">
          <table class="tbl">
            <thead><tr><th class="seq-th">序号</th><th>日期</th><th>单据号</th><th>类型</th><th>对方</th><th>账户</th><th class="num">发生额</th><th class="num">余额</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="r.id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ r.bill_date }}</td><td>{{ r.doc_no }}</td><td>{{ fundDocLabel(r.doc_type) }}</td>
                <td>{{ r.party_name || '—' }}</td><td>{{ r.account }}</td>
                <td class="num" :class="r.amount >= 0 ? 'val-ok' : 'val-bad'">{{ r.amount >= 0 ? '+' : '' }}{{ fmtMoney(r.amount) }}</td>
                <td class="num">¥{{ fmtMoney(r.balance_after) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb">本页合计</td>
                <td></td><td></td><td></td><td></td><td></td>
                <td class="num">{{ pageTotals.amount >= 0 ? '+' : '' }}{{ fmtMoney(pageTotals.amount) }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p class="fbk-foot">说明：本表列出所有「银行类账户」的已过账资金流水，供与银行对账单逐笔勾对。期初 / 期末余额见上方账户卡片。</p>
      </div>
    </template>
  </div>
</template>

<script setup>
/* 资金管理 · 银行流水对账（第 7 张报表页）。
   🔴 复用全局件：.page/.page-hd/.card/.kpi-strip/.tbl/.state-*；私有类 fbk- 前缀。
   🔴 数据 = fundsApi.bankReconcile → `{ accounts: 银行类账户, flow: 已过账流水 }`。
   🔴 失败显式抛出：页面必显示 .state-error，不许 catch {} 吞。 */
import Skeleton from '../../components/Skeleton.vue'
import { ref, reactive, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { fundsApi } from '../../api/funds'
import { fmtMoney } from '../../constants/psiLabels'
import { fundDocLabel } from '../../constants/fundLabels'

const sub = '按银行账户归集的已过账流水，逐笔与银行对账单勾对'
const loading = ref(true), err = ref(''), banks = ref([]), rows = ref([])
const f = reactive({ account: '', date_from: '', date_to: '' })
/* v512：客户端「本页合计」—— 对当前页可见流水发生额求和（代数和）；余额列滚动余额，不合计。 */
const pageTotals = computed(() => {
  let amount = 0
  for (const r of rows.value) amount += Number(r.amount || 0)
  return { amount }
})

const bankTotal = computed(() => banks.value.reduce((s, a) => s + Number(a.current_balance || 0), 0))

async function load() {
  loading.value = true; err.value = ''
  try {
    const d = await fundsApi.bankReconcile({ ...f })
    banks.value = Array.isArray(d.accounts) ? d.accounts : []
    rows.value = Array.isArray(d.flow) ? d.flow : []
  } catch (e) { err.value = e.message || '加载失败' } finally { loading.value = false }
}
onMounted(load)
</script>

<style scoped>
.fbk-acts { display: flex; gap: 8px }
.fbk-filter { margin: 14px 0 }
.fbk-frow { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end }
.fbk-frow > label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--t2) }
.fbk-accts { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-bottom: 14px }
.fbk-acct { background: var(--bg1); border: 1px solid var(--bd); border-radius: 12px; padding: 12px 14px; cursor: pointer; transition: border-color .15s, box-shadow .15s }
.fbk-acct:hover { border-color: var(--brand, #2f6bff) }
.fbk-on { border-color: var(--brand, #2f6bff); box-shadow: 0 0 0 2px rgba(47,107,255,.12) }
.fbk-acct-n { font-size: 14px; font-weight: 600; color: var(--t1) }
.fbk-acct-t { font-size: 12px; color: var(--t2); margin: 4px 0 8px }
.fbk-acct-b { font-size: 16px; font-weight: 700 }
.fbk-hint { padding: 16px; color: var(--t2); font-size: 13px }
.fbk-card { padding: 0; overflow: hidden }
.fbk-foot { font-size: 12px; color: var(--t2); margin: 8px 2px 0 }
</style>
