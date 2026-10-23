<template>
  <ReportTable
    title="促销 ROI 分析"
    :subtitle="'零价出库（买赠为主）成本盘点 · 近 ' + days + ' 天'"
    table-title="赠品成本 TOP 商品（按成本从高到低，前 20）"
    :columns="columns"
    :rows="rows"
    :kpis="kpis"
    :loading="loading"
    :err="err"
    :empty-hint="'近 ' + days + ' 天没有零价出库记录。'"
    @reload="load"
  >
    <template #chart>
      <!-- v648：赠品成本排行 —— 哪几个商品吃掉促销预算，一眼看见。后端已按成本排好，只截前 10。
           🔴 这是**成本**不是"投入产出比"：本账套没有活动投入额，算不出真实 ROI，
              所以标题不写 ROI，不编造一个比率。 -->
      <ChartHbar
        title="赠品成本前 10 名商品"
        :sub="'近 ' + days + ' 天 · 零价出库（买赠为主）'"
        :items="costTop"
        :loading="loading"
        :empty="!costTop.length"
        empty-text="这段时间没有零价出库记录"
        fmt="money"
        :name-w="150"
        export-name="赠品成本前10名"
        note="成本 = 赠品数量 × 商品进货价；缺进货价的商品成本记 0，会排在后面而不是被隐藏。"
      />
    </template>

    <template #extra>
      <!-- 期间选择：骨架表头没有控件插槽，原样放在 #extra；切换后整页重新取数。 -->
      <div class="card pro-tabs-card">
        <div class="sec-hd pro-sec">
          <span>统计区间（切换后整页重新计算）</span>
          <select class="btn btn-ghost btn-sm pro-sel" v-model.number="days" @change="load()">
            <option :value="30">近 30 天</option>
            <option :value="90">近 90 天</option>
            <option :value="180">近 180 天</option>
            <option :value="365">近 365 天</option>
          </select>
        </div>
      </div>

      <!-- 零价出库成本拆分：已打标 / 未打标（2026-10 起新单强制打标；历史单未追补，诚实单列） -->
      <div class="card pro-card pro-split">
        <div class="sec-hd pro-sec"><span>零价出库成本拆分（已标 / 未标）</span></div>
        <div class="pro-split-rows">
          <div class="pro-split-row">
            <span class="pro-split-k">已打标成本</span>
            <span class="pro-split-v">{{ fmtWan(gift.tagged?.total_cost) }}</span>
            <span class="pro-split-s">（{{ fmtNum(gift.tagged?.item_count) }} 行 · 已选出库原因）</span>
          </div>
          <div class="pro-split-row">
            <span class="pro-split-k">未打标成本</span>
            <span class="pro-split-v">{{ fmtWan(gift.untagged?.total_cost) }}</span>
            <span class="pro-split-s">（{{ fmtNum(gift.untagged?.item_count) }} 行 · 含历史未追补单）</span>
          </div>
        </div>
      </div>

      <!-- 主表原 tfoot 合计 -->
      <div class="card pro-tot">
        <div class="sec-hd"><span>主表合计（前 20 行）</span></div>
        <div class="pro-tot-row">
          <span class="pro-tot-i"><i>数量（件）</i><b>{{ fmtNum(rowTotals.qty) }}</b></span>
          <span class="pro-tot-i"><i>成本（元）</i><b>{{ fmtMoney(rowTotals.cost) }}</b></span>
        </div>
      </div>

      <!-- 表 2：促销活动对比（activities 空 ⇒ 诚实空态：没有 ≠ 是零） -->
      <div class="card pro-card">
        <div class="sec-hd pro-sec">
          <span>
            促销活动对比
            <span v-if="activities.length" class="pro-tag">非因果</span>
          </span>
        </div>
        <div v-if="activities.length" class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>活动名</th>
                <th>类型</th>
                <th>时间</th>
                <th class="num">前 14 天销量</th>
                <th class="num">活动中销量</th>
                <th class="num">后 14 天销量</th>
                <th class="num">成交额</th>
                <th class="num">毛利</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(a, i) in activities" :key="'a-' + i">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ a.name || '—' }}</td>
                <td>{{ a.promo_type || '—' }}</td>
                <td>{{ actRange(a) }}</td>
                <td class="num">{{ fmtNum(a.before?.qty) }}</td>
                <td class="num">{{ fmtNum(a.during?.qty) }}</td>
                <td class="num">{{ fmtNum(a.after?.qty) }}</td>
                <td class="num">{{ fmtMoney(a.during?.amount) }}</td>
                <td class="num" :class="Number(a.during?.profit || 0) >= 0 ? 'val-ok' : 'val-bad'">{{ fmtMoney(a.during?.profit) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb" colspan="4">本页合计</td>
                <td class="num">{{ fmtNum(actTotals.pre_qty) }}</td>
                <td class="num">{{ fmtNum(actTotals.during_qty) }}</td>
                <td class="num">{{ fmtNum(actTotals.post_qty) }}</td>
                <td class="num">{{ fmtMoney(actTotals.revenue) }}</td>
                <td class="num">{{ fmtMoney(actTotals.profit) }}</td>
              </tr>
            </tfoot>
          </table>
          <p class="pro-note">
            前 / 后销量为活动窗口前后 14 天对比，<b>不是因果结论</b>——季节性等同类因素未剥离。
          </p>
        </div>
        <div v-else class="pro-empty">
          <p class="pro-empty-note">{{ activityNote }}</p>
          <p class="pro-empty-guide">在营销中心的促销活动页创建买赠 / 特价活动后，这里自动出现对比数据。</p>
        </div>
      </div>
    </template>

    <template #footnote>
      口径：{{ giftNote }}仅统计已送达 / 已签收订单；成本口径与库存周转报表同源；已标 / 未标拆分见上方卡片，本页不做归因增量测算。
    </template>
  </ReportTable>
</template>

<script setup>
/* 促销 ROI 分析（数据报表 P2-1，v536）—— 数据源：GET /api/promotion-impact。
   🔴 口径**不在前端重算**：gift_cost 的单数 / 行数 / 总成本 / by_product 明细全部由后端给，
      前端只做展示格式化（与 GrossProfit / InventoryTurnover 同一纪律）。
   🔴 老板业务现实是**买赠为主**：生产促销活动 0 条 ⇒ `activities` 空数组是**诚实空态**
     （没有 ≠ 是零），必须展示 activity_note 全文 + 引导句，不准编造活动数据。
   🔴 零价出库 ≠ 赠品：它是「赠品 ∪ 内部领用 ∪ 其他零价出库单」的混合，系统未打标无法拆分
     —— 页面文案与脚注都必须如实说明，不许把它包装成「促销让利」。
   🔴 本页**只读**、无新建 / 编辑入口；无图表无导出（与现有四张报表页严格对齐）。
   v646：外壳收编进 ReportTable（KPI / 主表=赠品成本 TOP 商品 / 口径脚注）；
      期间下拉、已标未标拆分卡、第二张活动对比表（含其空态与合计）⇒ 原样移入 #extra，
      取数、TOP20 截断、两项合计算法一字未动。
   🔴 金额沿用原页精确元格式（fmt 'rmb'），不缩万元（KPI 仍走原万元口径 fmtWan）。
   🔴 不开 `filterable`：/api/promotion-impact 只接受 days，不支持 date_from/date_to。 */
import ReportTable from '../../components/ReportTable.vue'
import ChartHbar from '../../components/chart/ChartHbar.vue'
import { ref, computed, onMounted } from 'vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const days = ref(90)
const gift = ref({ order_count: 0, item_count: 0, total_cost: 0, by_product: [], tagged: {}, untagged: {} })
const activities = ref([])
const activityNote = ref('')
const giftNote = ref('')

const columns = [
  { key: 'seq', label: '序号', cls: 'num' },
  { key: 'name', label: '商品' },
  { key: 'qty', label: '数量（件）', fmt: 'num', cls: 'num' },
  { key: 'cost', label: '成本（元）', fmt: 'rmb', cls: 'num' },
]

/* by_product 后端已按成本排好，前端只截前 20 行展示。 */
const rows = computed(() => {
  const list = Array.isArray(gift.value.by_product) ? gift.value.by_product : []
  return list.slice(0, 20).map((r, i) => ({
    ...r,
    seq: i + 1,
    name: r.name || '—',
    qty: Number(r.qty || 0),
    cost: Number(r.cost || 0),
  }))
})

/* v648：横条数据 —— 后端 by_product 已按成本从高到低排好，这里只截前 10，不重排。 */
const costTop = computed(() => {
  const list = Array.isArray(gift.value.by_product) ? gift.value.by_product : []
  return list.slice(0, 10).map(r => ({ label: r.name || '—', value: Number(r.cost || 0) }))
})

/* 本页合计：只对可见行（前 20）的可加总列求和（数量 / 成本）。 */
const rowTotals = computed(() => {
  let qty = 0, cost = 0
  for (const r of rows.value) {
    qty += Number(r.qty || 0)
    cost += Number(r.cost || 0)
  }
  return { qty, cost }
})

/* 活动对比表本页合计：销量 / 成交额 / 毛利可加总；前后对比本身不合计成任何结论。
   字段口径（后端定稿契约）：前/中/后销量 = before/during/after.qty；
   成交额 / 毛利 = during.amount / during.profit（活动期口径）。 */
const actTotals = computed(() => {
  let pre_qty = 0, during_qty = 0, post_qty = 0, revenue = 0, profit = 0
  for (const a of activities.value) {
    pre_qty += Number(a.before?.qty || 0)
    during_qty += Number(a.during?.qty || 0)
    post_qty += Number(a.after?.qty || 0)
    revenue += Number(a.during?.amount || 0)
    profit += Number(a.during?.profit || 0)
  }
  return { pre_qty, during_qty, post_qty, revenue, profit }
})

const kpis = computed(() => [
  { label: '零价出库单数', value: fmtNum(gift.value.order_count) + ' 单', sub: '赠品 ∪ 内部领用 ∪ 其他零价出库（未打标）' },
  { label: '零价明细行数', value: fmtNum(gift.value.item_count) + ' 行', sub: '按商品明细行计' },
  { label: '零价出库成本', value: fmtWan(gift.value.total_cost), sub: '数量 × 进价（批次成本优先、档案进价回落）' },
  { label: '促销活动数', value: activities.value.length + ' 个', sub: activities.value.length ? '系统内促销活动记录' : '未启用（诚实空态）' },
])

function fmtNum (n) {
  return Number(n || 0).toLocaleString('zh-CN')
}
/* 金额（元）：¥ + 千分位 + 2 位小数。 */
function fmtMoney (n) {
  const v = Number(n || 0)
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
/* 万元口径（KPI 用）：≥1 万显示万元保留 1 位小数；否则显示元（2 位小数）。 */
function fmtWan (n) {
  const v = Number(n || 0)
  if (Math.abs(v) >= 10000) return '¥' + (v / 10000).toFixed(1) + ' 万'
  return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' 元'
}
/* 活动时间窗：后端字段名未定稿，start/end 双候选 + 缺失降级，不白屏。 */
function actRange (a) {
  const s = a.start_date || a.start || ''
  const e = a.end_date || a.end || ''
  if (s && e) return s + ' ~ ' + e
  return s || e || '—'
}

async function load () {
  loading.value = true
  err.value = ''
  try {
    const d = (await reportsApi.promoImpact(days.value)) || {}
    const g = d.gift_cost || {}
    gift.value = {
      order_count: Number(g.order_count || 0),
      item_count: Number(g.item_count || 0),
      total_cost: Number(g.total_cost || 0),
      by_product: Array.isArray(g.by_product) ? g.by_product : [],
      tagged: g.tagged || {},
      untagged: g.untagged || {}
    }
    activities.value = Array.isArray(d.activities) ? d.activities : []
    activityNote.value = String(d.activity_note || '')
    giftNote.value = String(g.note || '')
  } catch (e) {
    err.value = (e && e.message) || '促销 ROI 分析读取失败'
    gift.value = { order_count: 0, item_count: 0, total_cost: 0, by_product: [], tagged: {}, untagged: {} }
    activities.value = []
    activityNote.value = ''
    giftNote.value = ''
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<style scoped>
/* 仅保留仍被引用的私有类（期间选择 / 拆分卡 / 合计卡 / 第二张表挂在 #extra，插槽在本页作用域编译）。 */
.pro-sel { padding: 4px 8px }
.pro-tabs-card { margin-top: 14px }
.pro-card { margin-top: 14px }
.pro-split { margin-top: 14px; padding: 12px 14px }
.pro-split-rows { display: flex; flex-direction: column; gap: 8px; margin-top: 8px }
.pro-split-row { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap }
.pro-split-k { font-size: 13px; color: var(--t1); min-width: 92px }
.pro-split-v { font-size: 15px; font-weight: 600; color: var(--t1) }
.pro-split-s { font-size: 12px; color: var(--t3) }
.pro-sec { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap }
.pro-tag {
  display: inline-block; margin-left: 6px; padding: 0 6px; font-size: 11px; font-weight: 400;
  border-radius: 8px; background: var(--warn-amber-bg); color: var(--warn);
}
.pro-empty { padding: 6px 2px }
.pro-empty-note { font-size: 12px; color: var(--t2); line-height: 1.9; margin: 0 }
.pro-empty-guide { font-size: 12px; color: var(--t1); line-height: 1.9; margin: 8px 0 0 }
.pro-note { font-size: 12px; color: var(--t2); line-height: 1.8; margin: 10px 2px 0 }
.pro-tot { margin-top: 14px; padding: 12px 14px }
.pro-tot-row { display: flex; flex-wrap: wrap; gap: 20px; margin-top: 8px }
.pro-tot-i { display: flex; align-items: baseline; gap: 6px; font-size: 13px }
.pro-tot-i i { font-style: normal; color: var(--t2) }
.pro-tot-i b { color: var(--t1) }
</style>
