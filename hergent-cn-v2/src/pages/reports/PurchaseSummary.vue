<template>
  <ReportTable
    title="采购汇总表"
    subtitle="采购订单总体、按状态、按供应商的汇总（排除已作废）"
    table-title="按状态"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    empty-hint="暂无状态分布数据。"
    filterable
    @reload="load"
    @filter="onFilter"
  >
    <template #extra>
      <!-- 第二张表：按供应商（Top 20）—— 原样保留，骨架只承载主表。 -->
      <div class="card pps-card">
        <div class="sec-hd"><span>按供应商（Top 20）</span></div>
        <div v-if="bySupplier.length" class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr><th>供应商</th><th class="num">单数</th><th class="num">采购额</th><th class="num">未付额</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in bySupplier" :key="r.sid">
                <td>{{ r.name }}</td>
                <td class="num">{{ r.order_count }}</td>
                <td class="num">{{ fmtMoney(r.total_amount) }}</td>
                <td class="num" :class="r.unpaid_amount > 0 ? 'val-warn' : 'val-ok'">{{ fmtMoney(r.unpaid_amount) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="state-empty">暂无供应商采购数据。</div>
      </div>
    </template>

    <template #footnote>
      口径：统计 <code>/api/reports/purchase-summary</code>，排除「已作废」采购单；金额单位元。
      当前生产数据已付金额全为 0（货款尚未在系统中登记支付），故未付额＝采购额，这是**真实数据状态、非系统错误**，
      待出纳在「付款单」登记后自动修正。前端只读展示、不重算。
    </template>
  </ReportTable>
</template>

<script setup>
/* 采购汇总表（数据报表）—— 数据源：GET /api/reports/purchase-summary（v634 新增只读端点）。
   🔴 口径**不在前端重算**：总体 / 按状态 / 按供应商全部由后端算好。
   🔴 本页**只读**；改采购数据去「采购订单」模块，不在此凭空加。
   ⚠️ 生产实测已付金额全为 0 ⇒ 未付＝总额，是真实状态（付款单未登记），显式说明、不静默掩盖。
   v646：外壳收编进 ReportTable（KPI / 主表=按状态 / 口径脚注）；「按供应商」表移入 #extra，
      取数与状态映射一字未动。
   🔴 金额沿用原页精确元格式（fmt 'rmb'），不缩万元。
   ✅ 开 `filterable`：v643 后端已为 /api/reports/purchase-summary 加上 date_from/date_to（按 order_date），
      本页 v651 接上内置日期筛选条，参数拼 query 交给后端算，前端绝不本地过滤。 */
import ReportTable from '../../components/ReportTable.vue'
import { ref, computed, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const s = ref({ order_count: 0, total_amount: 0, paid_amount: 0, unpaid_amount: 0, received_amount: 0 })
const byStatus = ref([])
const bySupplier = ref([])

/* v651：日期筛选（后端 purchase-summary 已支持 date_from/date_to，按 order_date）。拼 query 给后端算，前端不本地过滤。 */
const filter = ref({ date_from: '', date_to: '' })
function qs() {
  const p = []
  if (filter.value.date_from) p.push('date_from=' + encodeURIComponent(filter.value.date_from))
  if (filter.value.date_to) p.push('date_to=' + encodeURIComponent(filter.value.date_to))
  return p.length ? '?' + p.join('&') : ''
}
function onFilter(r) { filter.value = { ...r }; load() }

const statusMap = { draft: '草稿', confirmed: '已确认', received: '已收货', cancelled: '已作废', audit: '待审核' }
function statusText (st) { return statusMap[st] || st || '未知' }

const columns = [
  { key: 'status_txt', label: '状态' },
  { key: 'cnt', label: '单数', fmt: 'num', cls: 'num' },
  { key: 'amount', label: '金额', fmt: 'rmb', cls: 'num' },
]

const rows = computed(() => byStatus.value.map((r) => ({
  ...r,
  status_txt: statusText(r.status),
  cnt: Number(r.cnt || 0),
  amount: Number(r.amount || 0),
})))

const kpis = computed(() => [
  { label: '采购单数', value: String(s.value.order_count), sub: '有效订单（不含作废）' },
  { label: '采购总额', value: fmtMoney(s.value.total_amount), sub: '订单金额合计' },
  { label: '已付金额', value: fmtMoney(s.value.paid_amount), sub: '已付货款' },
  { label: '未付金额', value: fmtMoney(s.value.unpaid_amount), sub: '总额 − 已付' },
])

function fmtMoney (n) {
  const v = Number(n || 0)
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function load () {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.purchaseSummary(qs())
    const sum = d.summary || {}
    s.value = {
      order_count: Number(sum.order_count || 0),
      total_amount: Number(sum.total_amount || 0),
      paid_amount: Number(sum.paid_amount || 0),
      unpaid_amount: Number(sum.unpaid_amount || 0),
      received_amount: Number(sum.received_amount || 0)
    }
    byStatus.value = Array.isArray(d.by_status) ? d.by_status : []
    bySupplier.value = Array.isArray(d.by_supplier) ? d.by_supplier : []
  } catch (e) {
    err.value = (e && e.message) || '采购汇总读取失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
defineExpose({ load })
</script>

<style scoped>
/* 仅保留仍被引用的私有类（第二张表挂在 #extra 插槽，插槽内容在本页作用域编译）。 */
.pps-card { margin-top: 14px }
</style>
