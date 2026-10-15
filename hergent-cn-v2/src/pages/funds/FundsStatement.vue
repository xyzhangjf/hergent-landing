<template>
  <div class="page">
    <div class="page-hd split">
      <div><h2>{{ title }}</h2><span class="page-sub">{{ sub }}</span></div>
      <div class="fs-acts"><button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()"><Icon name="refresh" :size="14" />刷新</button></div>
    </div>

    <div v-if="loading" class="state-empty">加载中…</div>
    <div v-else-if="err" class="state-error"><div class="se-ic"><Icon name="alert" :size="22" /></div><p>{{ err }}</p><button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button></div>

    <template v-else>
      <div class="card fs-filter">
        <div class="fs-frow">
          <label>日期从<input type="date" v-model="f.date_from" class="input"></label>
          <label>日期到<input type="date" v-model="f.date_to" class="input"></label>
          <button class="btn btn-ghost btn-sm" @click="load()"><Icon name="search" :size="14" />查询</button>
        </div>
      </div>
      <div class="card fs-card">
        <div v-if="!rows.length" class="state-empty">暂无对账数据。先建立并过账对应的收/付款单据。</div>
        <div v-else class="table-wrap freeze-list">
          <table class="tbl">
            <thead><tr><th class="seq-th">序号</th><th>{{ partyLabel }}名称</th><th class="num">单据数</th><th class="num">应收</th><th class="num">应付</th><th class="num">期末余额</th><th class="fd-op">明细</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="r.party_id || r.party_name" :class="{ 'fs-open': openRow === i }" @click="toggle(i)">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ r.party_name }}</td>
                <td class="num">{{ r.doc_count }}</td>
                <td class="num val-ok">¥{{ fmtMoney(r.receivable) }}</td>
                <td class="num val-bad">¥{{ fmtMoney(r.payable) }}</td>
                <td class="num" :class="r.balance >= 0 ? 'val-ok' : 'val-bad'">¥{{ fmtMoney(r.balance) }}</td>
                <td class="fd-op"><Icon :name="openRow === i ? 'chevron-down' : 'chevron-right'" :size="14" /></td>
              </tr>
              <tr v-if="openRow === i && rows[openRow]" class="fs-detail">
                <td colspan="7">
                  <div class="table-wrap">
                    <table class="tbl">
                      <thead><tr><th>单号</th><th>日期</th><th>类型</th><th class="num">金额</th><th>状态</th></tr></thead>
                      <tbody>
                        <tr v-for="d in rows[openRow].docs" :key="d.id">
                          <td>{{ d.doc_no }}</td><td>{{ d.bill_date }}</td><td>{{ fundDocLabel(d.doc_type) }}</td>
                          <td class="num">¥{{ fmtMoney(d.amount) }}</td><td><span class="tag" :class="fundStatusTag(d.status)">{{ fundStatusText(d.status) }}</span></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb">本页合计</td>
                <td></td>
                <td class="num">{{ pageTotals.doc_count }}</td>
                <td class="num">¥{{ fmtMoney(pageTotals.receivable) }}</td>
                <td class="num">¥{{ fmtMoney(pageTotals.payable) }}</td>
                <td class="num">¥{{ fmtMoney(pageTotals.balance) }}</td>
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
import { useRoute } from 'vue-router'
import Icon from '../../components/Icon.vue'
import { fundsApi } from '../../api/funds'
import { fmtMoney } from '../../constants/psiLabels'
import { fundDocLabel, fundStatusText, fundStatusTag } from '../../constants/fundLabels'

const route = useRoute()
const partyType = computed(() => route.meta.partyType || 'customer')
const partyLabel = computed(() => (partyType.value === 'supplier' ? '供应商' : '客户'))
/* 🔴 标题可被路由 `meta.title` 覆盖（如「供应商对账明细」复用本引擎、显示不同名）。
   缺省按对方类型给默认名，保证「客户对账单 / 供应商对账单」两入口正确。 */
const title = computed(() => route.meta.title || (partyType.value === 'supplier' ? '供应商对账单' : '客户对账单'))
const sub = computed(() => `按${partyLabel.value}归集的应收 / 应付与期末余额（已过账单据）`)

const loading = ref(true), err = ref(''), rows = ref([]), openRow = ref(-1)
const f = reactive({ date_from: '', date_to: '' })
/* v512：客户端「本页合计」—— 后端对账单不返回合计，对当前页可见行单据数 / 应收 / 应付 / 期末余额求和。 */
const pageTotals = computed(() => {
  let doc_count = 0, receivable = 0, payable = 0, balance = 0
  for (const r of rows.value) {
    doc_count += Number(r.doc_count || 0)
    receivable += Number(r.receivable || 0)
    payable += Number(r.payable || 0)
    balance += Number(r.balance || 0)
  }
  return { doc_count, receivable, payable, balance }
})
function toggle(i) { openRow.value = openRow.value === i ? -1 : i }
async function load() {
  loading.value = true; err.value = ''
  try {
    const d = partyType.value === 'supplier'
      ? await fundsApi.supplierStatement({ ...f })
      : await fundsApi.customerStatement({ ...f })
    rows.value = Array.isArray(d.items) ? d.items : []
  } catch (e) { err.value = e.message || '加载失败' } finally { loading.value = false }
}
onMounted(load)
</script>

<style scoped>
.fs-acts { display: flex; gap: 8px }
.fs-filter { margin: 14px 0 }
.fs-frow { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end }
.fs-frow > label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--t2) }
.fs-card { padding: 0; overflow: hidden }
.fs-detail td { background: var(--bg2); padding: 10px 14px }
</style>
