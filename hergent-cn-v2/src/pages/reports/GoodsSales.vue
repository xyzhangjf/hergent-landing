<template>
  <ReportTable
    title="商品销售分析"
    subtitle="按商品 / 品牌 / 品类的销售拆解 · 只统计已送达、已签收的订单"
    :table-title="'销售拆解（按销售额从高到低 · ' + dimName + '）'"
    :columns="columns"
    :rows="rows"
    :loading="loading"
    :err="err"
    empty-hint="该维度暂无数据。"
    @reload="load"
  >
    <template #extra>
      <!-- 维度页签：骨架表头没有控件插槽，原样放在 #extra；切换后上方主表随之重新取数。 -->
      <div class="card rpt-tabs-card">
        <div class="sec-hd rpt-sec">
          <span>维度切换（上方表格随之刷新）</span>
          <div class="rpt-tabs">
            <button v-for="t in tabs" :key="t.key"
                    class="btn btn-ghost btn-sm" :class="{ 'rpt-on': dim === t.key }"
                    @click="switchDim(t.key)">{{ t.name }}</button>
          </div>
        </div>
      </div>

      <!-- 原 tfoot「本页合计」：只对可见行的可加总列求和；占比为比率，不合计。 -->
      <div class="card rpt-tot">
        <div class="sec-hd"><span>本页合计</span></div>
        <div class="rpt-tot-row">
          <span class="rpt-tot-i"><i>订单数</i><b>{{ fmtInt(totals.order_count) }}</b></span>
          <span class="rpt-tot-i"><i>销售额</i><b>{{ fmtMoney(totals.revenue) }}</b></span>
          <span class="rpt-tot-i"><i>销售件数</i><b>{{ fmtNum(totals.quantity) }}</b></span>
          <span class="rpt-tot-i"><i>毛利</i><b>{{ fmtMoney(totals.profit) }}</b></span>
        </div>
      </div>
    </template>

    <template #footnote>
      口径：仅统计「已送达 / 已签收」的销售订单；收入 = 明细实际成交金额，毛利 = 收入 − 净销量 × 进货价。
      🔴 商品档案若<b>未录入进货价</b>，毛利记 0、该行毛利率显示为 0，属数据缺失而非真实零毛利，不静默掩饰。
      数据源 <code>POST /api/bi/pivot</code>。
    </template>
  </ReportTable>
</template>

<script setup>
/* 商品销售分析（数据报表）—— 数据源：POST /api/bi/pivot，切换 dimensions 做分组。
   🔴 不新造后端：BI 引擎已支持 product_name / brand / category 维度。
   🔴 只读、前端不重算；毛利口径同毛利分析页，缺进货价时显式提示。
   v646：外壳收编进 ReportTable（列 / 行 / 口径脚注）；维度页签与原 tfoot 合计移入 #extra，
      取数与合计算法一字未动（原页本就没有 KPI 条，不擅自新增）。
   🔴 不开 `filterable`：/api/bi/pivot 不支持 date_from/date_to，开了就是假筛选。 */
import ReportTable from '../../components/ReportTable.vue'
import { ref, computed, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const dim = ref('product_name')
const raw = ref([])

const tabs = [
  { key: 'product_name', name: '按商品', label: '商品' },
  { key: 'brand', name: '按品牌', label: '品牌' },
  { key: 'category', name: '按品类', label: '品类' },
]

const dimName = computed(() => (tabs.find(t => t.key === dim.value) || tabs[0]).label)

const columns = computed(() => [
  { key: 'seq', label: '序号', cls: 'num' },
  { key: 'name', label: dimName.value },
  { key: 'order_count', label: '订单数', fmt: 'num', cls: 'num' },
  { key: 'revenue', label: '销售额', fmt: 'money', cls: 'num' },
  { key: 'quantity', label: '销售件数', fmt: 'num', cls: 'num' },
  { key: 'profit', label: '毛利', fmt: 'money', cls: 'num' },
  { key: 'share', label: '占比', cls: 'num' },
])

const rows = computed(() => {
  const list = [...(raw.value || [])]
  list.sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))
  return list.map((r, i) => ({
    ...r,
    seq: i + 1,
    name: nameOf(r),
    order_count: Number(r.order_count || 0),
    revenue: Number(r.revenue || 0),
    quantity: Number(r.quantity || 0),
    profit: Number(r.profit || 0),
    share: shareText(r.revenue),
  }))
})

const totals = computed(() => {
  const rs = rows.value
  return {
    revenue: rs.reduce((s, r) => s + Number(r.revenue || 0), 0),
    quantity: rs.reduce((s, r) => s + Number(r.quantity || 0), 0),
    order_count: rs.reduce((s, r) => s + Number(r.order_count || 0), 0),
    profit: rs.reduce((s, r) => s + Number(r.profit || 0), 0),
  }
})

function nameOf(r) {
  const v = r[dim.value]
  return (v === null || v === undefined || v === '') ? '未分类' : String(v)
}
function shareText(v) {
  const t = totals.value.revenue
  return t > 0 ? (Number(v || 0) / t * 100).toFixed(1) + '%' : '—'
}
function fmtMoney(v) {
  const n = Number(v || 0)
  if (Math.abs(n) >= 10000) return '¥' + (n / 10000).toFixed(1) + ' 万'
  return '¥' + n.toFixed(0)
}
function fmtInt(v) { return Number(v || 0).toLocaleString('zh-CN') }
function fmtNum(v) { return Number(v || 0).toFixed(1) }

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.biPivot({
      dimensions: [dim.value],
      measures: ['order_count', 'revenue', 'quantity', 'profit'],
      filters: {},
      limit: 300,
    })
    raw.value = Array.isArray(d) ? d : (d && Array.isArray(d.rows) ? d.rows : [])
  } catch (e) {
    err.value = (e && e.message) || '加载失败'
    raw.value = []
  } finally {
    loading.value = false
  }
}

function switchDim(k) {
  if (dim.value === k) return
  dim.value = k
  raw.value = []
  load()
}

onMounted(load)
</script>

<style scoped>
/* 仅保留仍被引用的私有类（页签 / 合计卡挂在 #extra 插槽，插槽内容在本页作用域编译）。 */
.rpt-sec { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.rpt-tabs { display: flex; gap: 6px; }
.rpt-on { background: var(--bg2); color: var(--t1); font-weight: 600; }
.rpt-tabs-card { margin-top: 14px; }
.rpt-tot { margin-top: 14px; padding: 12px 14px; }
.rpt-tot-row { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 8px; }
.rpt-tot-i { display: flex; align-items: baseline; gap: 6px; font-size: 13px; }
.rpt-tot-i i { font-style: normal; color: var(--t2); }
.rpt-tot-i b { color: var(--t1); }
</style>
