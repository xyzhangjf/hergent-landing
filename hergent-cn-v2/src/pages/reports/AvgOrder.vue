<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>均单分析</h2>
        <span class="page-sub">按月份 / 客户 / 品牌 · 只统计已送达、已签收的订单</span>
      </div>
      <div class="rpt-acts">
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
      <div class="card kpi-strip cols-4">
        <div class="kpi">
          <div class="kpi-label">订单数</div>
          <div class="kpi-val">{{ fmtInt(totalOrders) }}</div>
          <div class="kpi-sub">已送达 / 已签收</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">销售额</div>
          <div class="kpi-val">{{ fmtMoney(totalRevenue) }}</div>
          <div class="kpi-sub">订单金额合计</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">均单金额</div>
          <div class="kpi-val">{{ fmtMoney(avgOrder) }}</div>
          <div class="kpi-sub">销售额 ÷ 订单数</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">均单件数</div>
          <div class="kpi-val">{{ fmtNum(avgQty) }}</div>
          <div class="kpi-sub">销售件数 ÷ 订单数</div>
        </div>
      </div>

      <div class="card rpt-card">
        <div class="sec-hd rpt-sec">
          <span>均单明细（按销售额从高到低）</span>
          <div class="rpt-tabs">
            <button v-for="t in tabs" :key="t.key"
                    class="btn btn-ghost btn-sm" :class="{ 'rpt-on': dim === t.key }"
                    @click="switchDim(t.key)">{{ t.name }}</button>
          </div>
        </div>

        <div v-if="rows.length" class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>{{ dimName }}</th>
                <th class="num">订单数</th>
                <th class="num">销售额</th>
                <th class="num">销售件数</th>
                <th class="num">均单金额</th>
                <th class="num">占比</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="dim + '-' + i">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ nameOf(r) }}</td>
                <td class="num">{{ fmtInt(r.order_count) }}</td>
                <td class="num">{{ fmtMoney(r.revenue) }}</td>
                <td class="num">{{ fmtNum(r.quantity) }}</td>
                <td class="num">{{ fmtMoney(avgOf(r)) }}</td>
                <td class="num">{{ shareText(r.revenue) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="state-empty">该维度暂无数据。</div>
      </div>

      <p class="rpt-foot">
        口径：仅统计「已送达 / 已签收」的销售订单。
        <b>均单金额 = 销售额 ÷ 订单数</b>（两者同为已送达口径，前端不做除法以外的事）。
        🔴 后端 BI 自带的 <code>avg_order_value</code> 字段<b>未过滤订单状态</b>（把未送达订单也算进分母），
        与「销售额」口径不一致，会把均单算小 —— 本页<b>不采用</b>它，已登记为后端待修项。
        数据源 <code>POST /api/bi/pivot</code>。
      </p>
    </template>
  </div>
</template>

<script setup>
/* 均单分析（数据报表 › 经营分析）—— 数据源：POST /api/bi/pivot。
   🔴 不新造后端：BI 引擎已提供 order_count / revenue / quantity 三个同口径指标，
      本页只是换 dimensions 做分组展示。
   🔴 均单不用后端 avg_order_value（口径混入未送达订单，见 api/modules.js 注释），
      改用 revenue ÷ order_count —— 分子分母同为「已送达/已签收」口径。
   🔴 本页只读、无「新建 / 编辑」入口：均单是销售的结果，不是可编辑对象。 */
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const dim = ref('month')
const raw = ref([])

const tabs = [
  { key: 'month', name: '按月份', dim: 'month', label: '月份' },
  { key: 'customer', name: '按客户', dim: 'customer_name', label: '客户' },
  { key: 'brand', name: '按品牌', dim: 'brand', label: '品牌' },
]

const dimName = computed(() => (tabs.find(t => t.key === dim.value) || tabs[0]).label)

const rows = computed(() => {
  const list = [...(raw.value || [])]
  list.sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))
  return list
})

const totalOrders = computed(() => rows.value.reduce((s, r) => s + Number(r.order_count || 0), 0))
const totalRevenue = computed(() => rows.value.reduce((s, r) => s + Number(r.revenue || 0), 0))
const totalQty = computed(() => rows.value.reduce((s, r) => s + Number(r.quantity || 0), 0))
const avgOrder = computed(() => (totalOrders.value ? totalRevenue.value / totalOrders.value : 0))
const avgQty = computed(() => (totalOrders.value ? totalQty.value / totalOrders.value : 0))

/** 每行的均单 = 该行销售额 ÷ 该行订单数（同口径相除，不是重算业务口径） */
function avgOf(r) {
  const n = Number(r.order_count || 0)
  return n ? Number(r.revenue || 0) / n : 0
}

function nameOf(r) {
  const t = tabs.find(x => x.key === dim.value) || tabs[0]
  const v = r[t.dim]
  return (v === null || v === undefined || v === '') ? '未分类' : String(v)
}

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
function fmtNum(v) { return Number(v || 0).toFixed(1) }

async function load() {
  loading.value = true
  err.value = ''
  try {
    const t = tabs.find(x => x.key === dim.value) || tabs[0]
    const d = await reportsApi.biPivot({
      dimensions: [t.dim],
      measures: ['order_count', 'revenue', 'quantity'],
      filters: {},
      limit: 200,
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
.rpt-acts { display: flex; gap: 8px; align-items: center; }
.rpt-card { margin-top: 14px; }
.rpt-sec { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.rpt-tabs { display: flex; gap: 6px; }
.rpt-on { background: var(--bg2); color: var(--t1); font-weight: 600; }
.rpt-foot {
  margin: 14px 2px 0; font-size: 12px; line-height: 1.9; color: var(--t2);
}
.rpt-foot code {
  background: var(--bg2); padding: 1px 5px; border-radius: 4px; font-size: 11px;
}
</style>
