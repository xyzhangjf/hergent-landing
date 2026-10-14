<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>毛利分析</h2>
        <span class="page-sub">按品牌 / 品类 / 商品 三维度 · 只统计已送达、已签收的订单</span>
      </div>
      <div class="gpa-acts">
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
          <Icon name="refresh" :size="14" />刷新
        </button>
      </div>
    </div>

    <div v-if="loading" class="state-empty">加载中…</div>

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <template v-else>
      <!-- 顶部概览：销售额 / 成本 / 毛利 / 毛利率 -->
      <div class="card kpi-strip cols-4">
        <div class="kpi">
          <div class="kpi-label">销售额</div>
          <div class="kpi-val">{{ fmtMoney(total.revenue) }}</div>
          <div class="kpi-sub">明细实际成交金额</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">成本</div>
          <div class="kpi-val">{{ fmtMoney(total.cost) }}</div>
          <div class="kpi-sub">净销量 × 进货价</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">毛利</div>
          <div class="kpi-val" :class="total.profit >= 0 ? 'val-ok' : 'val-bad'">{{ fmtMoney(total.profit) }}</div>
          <div class="kpi-sub">销售额 − 成本</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">毛利率</div>
          <div class="kpi-val">{{ marginText(total.revenue, total.profit) }}</div>
          <div class="kpi-sub">毛利 ÷ 销售额</div>
        </div>
      </div>

      <!-- ⚠️ 进货价缺失：成本按 0 计 ⇒ 这部分毛利 = 销售额（虚高），必须显式告知而不是静默展示 -->
      <div v-if="missingCost.length" class="card gpa-warn">
        <div class="gpa-warn-hd"><Icon name="alert" :size="14" /> 数据完整性提醒</div>
        <p>
          有 <b>{{ missingCost.length }}</b> 个已产生销售的商品<b>未录入进货价</b>，成本按 0 计入，
          涉及销售额 <b>{{ fmtMoney(missingRevenue) }}</b> —— 这部分的毛利等于销售额，<b>毛利被虚高</b>。
          请到「商品档案」补录进货价，补录后本表自动修正。
        </p>
      </div>

      <div class="card gpa-card">
        <div class="sec-hd gpa-sec">
          <span>毛利明细（按毛利从高到低）</span>
          <div class="gpa-tabs">
            <button v-for="t in tabs" :key="t.key"
                    class="btn btn-ghost btn-sm" :class="{ 'gpa-on': dim === t.key }"
                    @click="dim = t.key">{{ t.name }}</button>
          </div>
        </div>

        <div v-if="rows.length" class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>{{ dimName }}</th>
                <th v-if="dim === 'product'">品牌</th>
                <th v-if="dim === 'product'">品类</th>
                <th v-if="dim !== 'product'" class="num">商品数</th>
                <th class="num">销售额</th>
                <th class="num">成本</th>
                <th class="num">毛利</th>
                <th class="num">毛利率</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="dim + '-' + i">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>
                  {{ nameOf(r) }}
                  <span v-if="dim === 'product' && isMissingCost(r)" class="gpa-tag">缺进价</span>
                </td>
                <td v-if="dim === 'product'">{{ r.brand || '—' }}</td>
                <td v-if="dim === 'product'">{{ r.category || '—' }}</td>
                <td v-if="dim !== 'product'" class="num">{{ r.count ?? '—' }}</td>
                <td class="num">{{ fmtMoney(r.revenue) }}</td>
                <td class="num">{{ fmtMoney(r.cost) }}</td>
                <td class="num" :class="Number(r.profit || 0) >= 0 ? 'val-ok' : 'val-bad'">{{ fmtMoney(r.profit) }}</td>
                <td class="num">{{ pctText(r.margin) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="state-empty">该维度暂无数据。</div>
      </div>

      <p class="gpa-foot">
        口径：仅统计「已送达 / 已签收」的销售订单；收入 = 明细实际成交金额，成本 = 净销量 × 商品进货价
        （退货以负数量自然扣减）。与首页三张毛利图同源，均读 <code>/api/reports/profit-breakdown</code>，
        前端不重算 —— 避免出现「本页毛利 ≠ 首页毛利」的第二份实现。未送达订单不计入；排序由后端按毛利排好。
      </p>
    </template>
  </div>
</template>

<script setup>
/* 毛利分析（数据报表）—— 数据源：GET /api/reports/profit-breakdown（= db.get_profit_report）。
   🔴 口径**不在前端重算**：收入 / 成本 / 毛利 / 毛利率全部由后端给，前端只做展示格式化。
      首页「品牌毛利结构 / 商品毛利排行 / 品类毛利对比」三张图读的是同一个后端函数，
      前端若自己算一遍就会分岔成第二份实现。
   🔴 本页**只读**、无「新建 / 编辑」入口：毛利是采购与销售的**结果**，
      改数据要去商品档案（补进货价）或对应单据，不在这里凭空加。
   ⚠️ 「缺进价 ⇒ 成本记 0 ⇒ 毛利虚高」是**数据问题、不是代码 bug**（生产 473 个商品里
      相当一部分没录入进货价）。故显式提醒 + 行内打「缺进价」标，不静默把虚高数字当真。 */
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const data = ref({ by_brand: [], by_category: [], products: [], total_revenue: 0, total_cost: 0, total_profit: 0 })

const tabs = [
  { key: 'brand', name: '按品牌' },
  { key: 'category', name: '按品类' },
  { key: 'product', name: '按商品' }
]
const dim = ref('brand')

const dimName = computed(() => {
  if (dim.value === 'brand') return '品牌'
  if (dim.value === 'category') return '品类'
  return '商品'
})

const total = computed(() => ({
  revenue: Number(data.value.total_revenue || 0),
  cost: Number(data.value.total_cost || 0),
  profit: Number(data.value.total_profit || 0)
}))

const rows = computed(() => {
  const d = data.value
  if (dim.value === 'brand') return Array.isArray(d.by_brand) ? d.by_brand : []
  if (dim.value === 'category') return Array.isArray(d.by_category) ? d.by_category : []
  return Array.isArray(d.products) ? d.products : []
})

/* 有销售但没进货价 ⇒ 成本记 0、毛利 = 销售额（虚高）。只在商品维度可判（品牌/品类已聚合）。 */
function isMissingCost (r) {
  return Number(r.revenue || 0) > 0 && !(Number(r.purchase_price || 0) > 0)
}
const missingCost = computed(() => (Array.isArray(data.value.products) ? data.value.products : []).filter(isMissingCost))
const missingRevenue = computed(() => missingCost.value.reduce((s, r) => s + Number(r.revenue || 0), 0))

function nameOf (r) {
  if (dim.value === 'brand') return r.brand || '未分类'
  if (dim.value === 'category') return r.category || '未分类'
  return r.name || '—'
}
/* 金额：¥ + 千分位 + 2 位小数（单位元）。毛利率后端已给 1 位小数，只补 %，不重算。 */
function fmtMoney (n) {
  const v = Number(n || 0)
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function pctText (n) {
  return Number(n || 0).toFixed(1) + '%'
}
function marginText (revenue, profit) {
  const r = Number(revenue || 0)
  return r > 0 ? (Number(profit || 0) / r * 100).toFixed(1) + '%' : '—'
}

async function load () {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.profitBreakdown()
    data.value = {
      by_brand: Array.isArray(d.by_brand) ? d.by_brand : [],
      by_category: Array.isArray(d.by_category) ? d.by_category : [],
      products: Array.isArray(d.products) ? d.products : [],
      total_revenue: Number(d.total_revenue || 0),
      total_cost: Number(d.total_cost || 0),
      total_profit: Number(d.total_profit || 0)
    }
  } catch (e) {
    err.value = (e && e.message) || '毛利分析读取失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
defineExpose({ load })
</script>

<style scoped>
/* 页面私有类一律 `gpa-` 前缀（数据报表·毛利分析）；全局件（.page/.page-hd/.card/.kpi-strip/
   .table-wrap/.tbl/.num/.sec-hd/.state-empty/.state-error/.btn/.val-ok/.val-bad）一律复用，不重定义。 */
.gpa-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.gpa-card { margin-bottom: 14px }
.gpa-sec { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap }
.gpa-tabs { display: flex; gap: 6px }
.gpa-tabs .gpa-on { background: var(--bg2); color: var(--t1); font-weight: 600 }
.gpa-warn { border-left: 3px solid var(--war); margin-bottom: 14px }
.gpa-warn-hd { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--warn); margin-bottom: 6px }
.gpa-warn p { font-size: 12px; color: var(--t2); line-height: 1.7; margin: 0 }
.gpa-tag { display: inline-block; margin-left: 6px; padding: 0 6px; font-size: 11px; border-radius: 8px; background: var(--warn-amber-bg); color: var(--warn) }
.gpa-foot { font-size: 12px; color: var(--t2); margin-top: 4px; line-height: 1.7 }
</style>
