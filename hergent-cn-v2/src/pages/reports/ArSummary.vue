<template>
  <ReportTable
    title="应收账款汇总表"
    subtitle="按客户的应收余额汇总（仅应收账款）"
    table-title="按客户（余额 Top 50）"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    empty-hint="暂无应收数据。"
    filterable
    @reload="load"
    @filter="onFilter"
  >
    <template #footnote>
      <!-- ⚠️ 未核销提醒必须留着：骨架没有「警示卡」插槽，挂在脚注区继续显式展示，不静默。
           写法照 InvoiceConfig.vue 先例（脚注插槽内直接放带本页私有类的块级文案）。 -->
      <p v-if="showWarn" class="card ars-warn">
        <Icon name="alert" :size="14" />
        <b>数据完整性提醒：</b>当前 <b>{{ s.bill_count }}</b> 笔应收全部<b>未核销</b>（已收金额 = 0），
        应收余额 = 应收总额 <b>{{ fmtMoney(s.ar_balance) }}</b>。结合「账龄汇总表」可看每笔到期日 ——
        多为<b>历史挂账</b>，不能直接等同当期真实欠款。
        请核对回款后在「收款单」登记核销，本表自动修正。
      </p>
      <p>
        口径：仅统计 <code>type='ar'</code> 的应收单；金额单位元；余额 = 应收额 − 已收。
        数据由 <code>/api/reports/ar-summary</code> 算好，前端只读展示、不重算。
      </p>
    </template>
  </ReportTable>
</template>

<script setup>
/* 应收账款汇总表（数据报表）—— 数据源：GET /api/reports/ar-summary（v634 新增只读端点）。
   🔴 口径**不在前端重算**：总体 / 按客户全部由后端给。
   🔴 本页**只读**；做核销去「收款单」模块。
   ⚠️ 生产实测应收全部未核销（paid_amount=0）⇒ 应收余额＝应收总额，多为历史挂账，
      显式提醒、不得静默当成当期真实欠款（与账龄汇总表同口径纪律）。
   v643：外壳收编进 ReportTable（KPI / 列 / 行 / 口径脚注），取数函数与口径一字未动。
   ✅ 开 `filterable`：v651 后端已为 /api/reports/ar-summary 加上 date_from/date_to（按应收到期日 due_date），
      本页接上内置日期筛选条，参数拼 query 交给后端算，前端绝不本地过滤。 */
import ReportTable from '../../components/ReportTable.vue'
import Icon from '../../components/Icon.vue'
import { ref, computed, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const s = ref({ bill_count: 0, customer_count: 0, total_amount: 0, paid_amount: 0, ar_balance: 0 })
const byCustomer = ref([])

/* v651：日期筛选（后端 ar-summary 已支持 date_from/date_to，按应收到期日 due_date）。拼 query 给后端算，前端不本地过滤。 */
const filter = ref({ date_from: '', date_to: '' })
function qs() {
  const p = []
  if (filter.value.date_from) p.push('date_from=' + encodeURIComponent(filter.value.date_from))
  if (filter.value.date_to) p.push('date_to=' + encodeURIComponent(filter.value.date_to))
  return p.length ? '?' + p.join('&') : ''
}
function onFilter(r) { filter.value = { ...r }; load() }

const columns = [
  { key: 'seq', label: '序号', cls: 'num' },
  { key: 'name', label: '客户' },
  { key: 'bill_count', label: '笔数', fmt: 'num', cls: 'num' },
  { key: 'amount', label: '应收额', fmt: 'rmb', cls: 'num' },
  { key: 'ar_balance', label: '应收余额', fmt: 'rmb', cls: 'num' },
]

const rows = computed(() => byCustomer.value.map((r, i) => ({ ...r, seq: i + 1 })))

const kpis = computed(() => [
  { label: '应收笔数', value: s.value.bill_count, sub: '应收单据数' },
  { label: '客户数', value: s.value.customer_count, sub: '有应收的客户' },
  { label: '应收总额', value: fmtMoney(s.value.total_amount), sub: '账单金额合计' },
  { label: '已收金额', value: fmtMoney(s.value.paid_amount), sub: '已核销回款' },
  { label: '应收余额', value: fmtMoney(s.value.ar_balance), sub: '总额 − 已收' },
])

/* 全部未核销 ⇒ 余额＝总额，多为历史挂账，必须显式提醒（原「数据完整性提醒」卡）。 */
const showWarn = computed(() => s.value.bill_count && s.value.paid_amount === 0)

function fmtMoney (n) {
  const v = Number(n || 0)
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function load () {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.arSummary(qs())
    const sum = d.summary || {}
    s.value = {
      bill_count: Number(sum.bill_count || 0),
      customer_count: Number(sum.customer_count || 0),
      total_amount: Number(sum.total_amount || 0),
      paid_amount: Number(sum.paid_amount || 0),
      ar_balance: Number(sum.ar_balance || 0)
    }
    byCustomer.value = Array.isArray(d.by_customer) ? d.by_customer : []
  } catch (e) {
    err.value = (e && e.message) || '应收汇总读取失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
defineExpose({ load })
</script>

<style scoped>
/* 页面私有类一律 `ars-` 前缀；全局件复用，不重定义。
   仅保留仍被引用的 `.ars-warn` —— 它挂在 ReportTable 的 #footnote 插槽里，
   插槽内容在**本页**作用域编译，故这里的作用域样式照样生效。
   （原文案是「标题行 + 正文」两段，骨架脚注区只能放一段，故合并为一段、保留全部文字。） */
.ars-warn { border-left: 3px solid var(--war); margin-bottom: 10px; font-size: 12px; color: var(--t2); line-height: 1.7 }
</style>
