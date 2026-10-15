<template>
  <div class="page">
    <div class="page-hd split">
      <div><h2>员工欠款</h2><span class="page-sub">内部费用（借款）减内部收入后的未冲销净额</span></div>
      <div class="fsd-acts"><button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()"><Icon name="refresh" :size="14" />刷新</button></div>
    </div>

    <div v-if="loading" class="state-empty">加载中…</div>
    <div v-else-if="err" class="state-error"><div class="se-ic"><Icon name="alert" :size="22" /></div><p>{{ err }}</p><button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button></div>

    <template v-else>
      <div class="card fsd-card">
        <div v-if="!rows.length" class="state-empty">没有员工欠款。内部费用单（借款）被内部收入单冲销后会在此归零。</div>
        <div v-else class="table-wrap freeze-list">
          <table class="tbl">
            <thead><tr><th class="seq-th">序号</th><th>员工</th><th class="num">借款</th><th class="num">已还</th><th class="num">欠款</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="r.staff">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ r.staff }}</td>
                <td class="num">¥{{ fmtMoney(r.fee) }}</td>
                <td class="num val-ok">¥{{ fmtMoney(r.income) }}</td>
                <td class="num val-bad">¥{{ fmtMoney(r.debt) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb">本页合计</td>
                <td></td>
                <td class="num">¥{{ fmtMoney(pageTotals.fee) }}</td>
                <td class="num">¥{{ fmtMoney(pageTotals.income) }}</td>
                <td class="num">¥{{ fmtMoney(pageTotals.debt) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { fundsApi } from '../../api/funds'
import { fmtMoney } from '../../constants/psiLabels'

const loading = ref(true), err = ref(''), rows = ref([])
/* v512：客户端「本页合计」—— 后端员工欠款不返回合计，对当前页可见行借款 / 已还 / 欠款求和。 */
const pageTotals = computed(() => {
  let fee = 0, income = 0, debt = 0
  for (const r of rows.value) {
    fee += Number(r.fee || 0)
    income += Number(r.income || 0)
    debt += Number(r.debt || 0)
  }
  return { fee, income, debt }
})
async function load() {
  loading.value = true; err.value = ''
  try { const d = await fundsApi.staffDebt(); rows.value = Array.isArray(d.items) ? d.items : [] }
  catch (e) { err.value = e.message || '加载失败' } finally { loading.value = false }
}
onMounted(load)
</script>

<style scoped>
.fsd-acts { display: flex; gap: 8px }
.fsd-card { padding: 0; overflow: hidden }
</style>
