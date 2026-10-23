<template>
  <ReportTable
    title="客户销额排名"
    subtitle="按销售额排名的客户榜 · 只统计已送达、已签收的订单"
    :table-title="'客户销额排名（Top ' + rows.length + '）'"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    empty-hint="暂无客户销额数据。"
    @reload="load"
  >
    <template #filters>
      <!-- v649：客户维度筛选。🔴 后端 /api/bi/top、/api/bi/pivot 的 filters **真实支持**
           customer_id（_bi_where 里写死的白名单），所以这个控件不是"假筛选"。
           业务员维度暂未开放：so.operator_id 的可选列表还没有确认租户级接口，不猜。 -->
      <div class="card rpt-filter cr-filter">
        <label class="cr-fl">
          <span>客户</span>
          <select v-model="selCustomer" @change="load()">
            <option value="">全部客户</option>
            <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name || ('#' + c.id) }}</option>
          </select>
        </label>
        <label class="cr-fl">
          <span>业务员</span>
          <select v-model="selSalesperson" @change="load()">
            <option value="">全部业务员</option>
            <option v-for="s in salespersons" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <span class="cr-hint">按客户筛选后，排名表只留该客户；「头部集中度」的分母仍是全部客户销额（不随筛选变）。</span>
      </div>
    </template>

    <template #chart>
      <!-- v648：集中度一眼可见 —— 横条越长越依赖该客户。数据直接取后端 Top-N 结果，不重算。 -->
      <ChartHbar
        title="销额前 10 名客户"
        :sub="'上榜 ' + rows.length + ' 名 · 头部集中度 ' + fmtPct(topShare)"
        :items="revenueTop"
        :loading="loading"
        :empty="!revenueTop.length"
        empty-text="还没有可排行的客户销额"
        fmt="money"
        :total="totalRevenue"
        :name-w="132"
        export-name="客户销额前10名"
        note="占比 = 该客户销额 ÷ 全部客户销额（同口径相除）；只统计已送达 / 已签收订单。"
      />
    </template>

    <template #footnote>
      口径：仅统计「已送达 / 已签收」的销售订单；销售额 = 明细实际成交金额。
      头部集中度 = 上榜客户销额 ÷ 全部客户销额，反映销售对大客户的依赖程度。
      数据源 <code>POST /api/bi/top</code> + <code>POST /api/bi/pivot</code>。
    </template>
  </ReportTable>
</template>

<script setup>
/* 客户销额排名（数据报表）—— 数据源：POST /api/bi/top（排名）+ /api/bi/pivot（全部客户销额合计）。
   🔴 不新造后端：BI 引擎按 customer_name 维度对 revenue 做 Top-N。
   🔴 只读、前端不重算。
   v643：外壳收编进 ReportTable（KPI / 列 / 行 / 口径脚注），取数函数与口径一字未动。
   🔴 不开 `filterable`：/api/bi/top 与 /api/bi/pivot 均不支持 date_from/date_to，开了就是假筛选。 */
import ReportTable from '../../components/ReportTable.vue'
import ChartHbar from '../../components/chart/ChartHbar.vue'
import { ref, computed, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'
import { whApi } from '../../api/wh'
import { useSalespersons } from '../../composables/useSalespersons'

const loading = ref(true)
const err = ref('')
const rawRows = ref([])
const totalRevenue = ref(0)

const columns = [
  { key: 'seq', label: '排名', cls: 'num' },
  { key: 'customer_name', label: '客户' },
  { key: 'revenue', label: '销售额', fmt: 'money', cls: 'num' },
  { key: 'share', label: '占全部销额', cls: 'num' },
]

/* 排名序号 = 渲染次序（后端已按 revenue 排好）；占比 = 该行销额 ÷ 全部客户销额（同口径相除）。 */
const rows = computed(() => rawRows.value.map((r, i) => ({
  ...r,
  seq: i + 1,
  customer_name: r.customer_name || '未分类',
  share: shareText(r.revenue),
})))

/* v648：横条数据 —— 后端已按 revenue 排好，这里只截取前 10，不重排不重算。 */
const revenueTop = computed(() => rawRows.value
  .slice(0, 10)
  .map(r => ({ label: r.customer_name || '未分类', value: Number(r.revenue || 0) })))

const topRevenue = computed(() => rawRows.value.reduce((s, r) => s + Number(r.revenue || 0), 0))
const topShare = computed(() =>
  totalRevenue.value > 0 ? Math.round(1000 * topRevenue.value / totalRevenue.value) / 10 : 0)

const kpis = computed(() => [
  { label: '上榜客户数', value: fmtInt(rows.value.length), sub: '有销额的客户（前 20 名）' },
  { label: '上榜客户总销额', value: fmtMoney(topRevenue.value), sub: `Top ${rows.value.length}` },
  { label: '头部集中度', value: fmtPct(topShare.value), sub: '上榜 ÷ 全部客户销额' },
])

function shareText(v) {
  const t = totalRevenue.value
  return t > 0 ? (Number(v || 0) / t * 100).toFixed(1) + '%' : '—'
}
function fmtMoney(v) {
  const n = Number(v || 0)
  if (Math.abs(n) >= 10000) return '¥' + (n / 10000).toFixed(1) + ' 万'
  return '¥' + n.toFixed(0)
}
function fmtInt(v) { return Number(v || 0).toLocaleString('zh-CN') }
function fmtPct(v) { const n = Number(v || 0); return (n > 0 ? n : 0).toFixed(1) + '%' }

/* v649：客户维度筛选。🔴 分母（全部客户销额）**不跟着筛选变** —— 否则筛一个客户
   集中度就变 100%，那是个自证的假指标。所以 pivot 始终传空 filters。
   v650：再加业务员维度（salesperson → so.operator_id，_bi_where 白名单真支持）。
   客户与业务员是 AND 关系（同一份 filters 一起发给后端）。 */
const customers = ref([])
const selCustomer = ref('')
const selSalesperson = ref('')
const { salespersons, loadSalespersons } = useSalespersons()
const fTop = computed(() => {
  const f = {}
  if (selCustomer.value) f.customer_id = Number(selCustomer.value)
  if (selSalesperson.value) f.salesperson = selSalesperson.value
  return f
})

async function loadCustomers() {
  try {
    const list = await whApi.customers(800)
    customers.value = Array.isArray(list) ? list.filter(c => c && c.id) : []
  } catch (_) {
    customers.value = []   // 字典取不到就只留「全部客户」，不卡住主流程
  }
}

async function load() {
  loading.value = true
  err.value = ''
  try {
    const [top, all] = await Promise.all([
      reportsApi.biTopN({ dimension: 'customer_name', measure: 'revenue', n: 20, direction: 'desc', filters: fTop.value }),
      reportsApi.biPivot({ dimensions: ['customer_name'], measures: ['revenue'], filters: {}, limit: 300 }),
    ])
    const topArr = Array.isArray(top) ? top : []
    const allArr = Array.isArray(all) ? all : (all && Array.isArray(all.rows) ? all.rows : [])
    rawRows.value = topArr
    totalRevenue.value = allArr.reduce((s, r) => s + Number(r.revenue || 0), 0)
  } catch (e) {
    err.value = (e && e.message) || '加载失败'
    rawRows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => { loadCustomers(); loadSalespersons(); load() })
</script>

<style scoped>
/* v649：维度筛选条（客户下拉）。沿用骨架筛选卡的版式语言，不新造一套。 */
.cr-filter { display: flex; align-items: center; gap: 10px; flex-wrap: wrap }
.cr-fl { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--t2) }
.cr-fl select {
  min-width: 160px; padding: 5px 8px; font-size: 12px; color: var(--t1);
  background: var(--bg); border: 1px solid var(--bd); border-radius: 6px;
}
.cr-hint { font-size: 11px; color: var(--t3); line-height: 1.6 }
</style>
