<template>
  <div class="page">
    <div class="page-hd split">
      <div><h2>资金余额表</h2><span class="page-sub">各资金账户当前余额（过账后实时更新）</span></div>
      <div class="fb-acts"><button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()"><Icon name="refresh" :size="14" />刷新</button></div>
    </div>

    <Skeleton v-if="loading" />
    <div v-else-if="err" class="state-error"><div class="se-ic"><Icon name="alert" :size="22" /></div><p>{{ err }}</p><button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button></div>

    <template v-else>
      <div class="card kpi-strip cols-2">
        <div class="kpi"><div class="kpi-label">账户数</div><div class="kpi-val">{{ accounts.length }}</div><div class="kpi-sub">已建资金账户</div></div>
        <div class="kpi"><div class="kpi-label">资金总额</div><div class="kpi-val val-ok">¥{{ fmtMoney(total) }}</div><div class="kpi-sub">全部账户余额合计</div></div>
      </div>
      <div class="card fb-card">
        <div v-if="!accounts.length" class="state-empty">还没有资金账户。收款单 / 付款单需要先选择账户。</div>
        <div v-else class="table-wrap freeze-list">
          <table class="tbl">
            <thead><tr><th class="seq-th">序号</th><th>账户</th><th>类型</th><th>开户行</th><th class="num">期初余额</th><th class="num">当前余额</th></tr></thead>
            <tbody>
              <tr v-for="(a, i) in accounts" :key="a.id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ a.name }}</td><td>{{ a.type }}</td><td>{{ a.bank_name || '—' }}</td>
                <td class="num">¥{{ fmtMoney(a.opening_balance) }}</td>
                <td class="num" :class="a.current_balance < 0 ? 'val-bad' : 'val-ok'">¥{{ fmtMoney(a.current_balance) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb">本页合计</td>
                <td></td><td></td><td></td>
                <td class="num">¥{{ fmtMoney(pageTotals.opening) }}</td>
                <td class="num">¥{{ fmtMoney(pageTotals.current) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import Skeleton from '../../components/Skeleton.vue'
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { fundsApi } from '../../api/funds'
import { fmtMoney } from '../../constants/psiLabels'

const loading = ref(true), err = ref(''), accounts = ref([]), total = ref(0)
/* v512：客户端「本页合计」—— 后端余额表不返回合计，对当前页可见账户期初 / 当前余额求和。 */
const pageTotals = computed(() => {
  let opening = 0, current = 0
  for (const a of accounts.value) {
    opening += Number(a.opening_balance || 0)
    current += Number(a.current_balance || 0)
  }
  return { opening, current }
})
async function load() {
  loading.value = true; err.value = ''
  try {
    const d = await fundsApi.balance()
    accounts.value = Array.isArray(d.accounts) ? d.accounts : []
    total.value = Number(d.total || 0)
  } catch (e) { err.value = e.message || '加载失败' } finally { loading.value = false }
}
onMounted(load)
</script>

<style scoped>
.fb-acts { display: flex; gap: 8px }
.fb-card { padding: 0; overflow: hidden }
</style>
