<template>
  <div class="page">
    <div class="page-hd split">
      <div><h2>资金流水账</h2><span class="page-sub">所有已过账资金单据的流水记录（收正付负）</span></div>
      <div class="ff-acts"><button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()"><Icon name="refresh" :size="14" />刷新</button></div>
    </div>

    <div v-if="loading" class="state-empty">加载中…</div>
    <div v-else-if="err" class="state-error"><div class="se-ic"><Icon name="alert" :size="22" /></div><p>{{ err }}</p><button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button></div>

    <template v-else>
      <div class="card ff-filter">
        <div class="ff-frow">
          <label>账户
            <select v-model="f.account" class="input"><option value="">全部</option><option v-for="a in accounts" :key="a.id" :value="a.name">{{ a.name }}</option></select>
          </label>
          <label>日期从<input type="date" v-model="f.date_from" class="input"></label>
          <label>日期到<input type="date" v-model="f.date_to" class="input"></label>
          <button class="btn btn-ghost btn-sm" @click="load()"><Icon name="search" :size="14" />查询</button>
        </div>
      </div>
      <div class="card ff-card">
        <div v-if="!rows.length" class="state-empty">暂无资金流水。</div>
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
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { fundsApi } from '../../api/funds'
import { fmtMoney } from '../../constants/psiLabels'
import { fundDocLabel } from '../../constants/fundLabels'

const loading = ref(true), err = ref(''), rows = ref([]), accounts = ref([])
const f = reactive({ account: '', date_from: '', date_to: '' })
/* v512：客户端「本页合计」—— 后端流水账不返回合计，对当前页可见行发生额求和（代数和，收正付负）。
   ⚠️ 余额列是滚动余额，绝不合计（与 v511 资金台账同口径）。 */
const pageTotals = computed(() => {
  let amount = 0
  for (const r of rows.value) amount += Number(r.amount || 0)
  return { amount }
})
async function load() {
  loading.value = true; err.value = ''
  try {
    const [fl, al] = await Promise.all([fundsApi.flow({ ...f }), fundsApi.accounts()])
    rows.value = Array.isArray(fl.items) ? fl.items : []
    accounts.value = Array.isArray(al.items) ? al.items : []
  } catch (e) { err.value = e.message || '加载失败' } finally { loading.value = false }
}
onMounted(load)
</script>

<style scoped>
.ff-acts { display: flex; gap: 8px }
.ff-filter { margin: 14px 0 }
.ff-frow { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end }
.ff-frow > label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--t2) }
.ff-card { padding: 0; overflow: hidden }
</style>
