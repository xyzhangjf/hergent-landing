<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>促销 ROI 分析</h2>
        <span class="page-sub">零价出库（买赠为主）成本盘点 · 近 {{ days }} 天</span>
      </div>
      <div class="pro-acts">
        <select class="btn btn-ghost btn-sm pro-sel" v-model.number="days" @change="load()">
          <option :value="30">近 30 天</option>
          <option :value="90">近 90 天</option>
          <option :value="180">近 180 天</option>
          <option :value="365">近 365 天</option>
        </select>
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
      <!-- 顶部概览：零价出库单数 / 明细行数 / 成本 / 促销活动数 -->
      <div class="card kpi-strip cols-4">
        <div class="kpi">
          <div class="kpi-label">零价出库单数</div>
          <div class="kpi-val">{{ fmtNum(gift.order_count) }} 单</div>
          <div class="kpi-sub">赠品 ∪ 内部领用 ∪ 其他零价出库（未打标）</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">零价明细行数</div>
          <div class="kpi-val">{{ fmtNum(gift.item_count) }} 行</div>
          <div class="kpi-sub">按商品明细行计</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">零价出库成本</div>
          <div class="kpi-val">{{ fmtWan(gift.total_cost) }}</div>
          <div class="kpi-sub">数量 × 进价（批次成本优先、档案进价回落）</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">促销活动数</div>
          <div class="kpi-val">
            {{ activities.length }} 个
            <span v-if="!activities.length" class="pro-badge">未启用</span>
          </div>
          <div class="kpi-sub">系统内促销活动记录</div>
        </div>
      </div>

      <!-- 表 1：赠品成本 TOP 商品（by_product，前 20 行 + 本页合计） -->
      <div class="card pro-card">
        <div class="sec-hd pro-sec">
          <span>赠品成本 TOP 商品（按成本从高到低，前 20）</span>
        </div>
        <div v-if="topProducts.length" class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>商品</th>
                <th class="num">数量（件）</th>
                <th class="num">成本（元）</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in topProducts" :key="'p-' + i">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ r.name || '—' }}</td>
                <td class="num">{{ fmtNum(r.qty) }}</td>
                <td class="num">{{ fmtMoney(r.cost) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb" colspan="2">本页合计</td>
                <td class="num">{{ fmtNum(rowTotals.qty) }}</td>
                <td class="num">{{ fmtMoney(rowTotals.cost) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div v-else class="state-empty">近 {{ days }} 天没有零价出库记录。</div>
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

      <p class="pro-foot">
        口径：{{ giftNote }}仅统计已送达 / 已签收订单；成本口径与库存周转报表同源；本页不做归因增量测算——让利额中客户建档价、临期折价、门店等级价混合，系统未打标。
      </p>
    </template>
  </div>
</template>

<script setup>
/* 促销 ROI 分析（数据报表 P2-1，v536）—— 数据源：GET /api/promotion-impact。
   🔴 口径**不在前端重算**：gift_cost 的单数 / 行数 / 总成本 / by_product 明细全部由后端给，
      前端只做展示格式化（与 GrossProfit / InventoryTurnover 同一纪律）。
   🔴 老板业务现实是**买赠为主**：生产促销活动 0 条 ⇒ `activities` 空数组是**诚实空态**
     （没有 ≠ 是零），必须展示 activity_note 全文 + 引导句，不准编造活动数据。
   🔴 零价出库 ≠ 赠品：它是「赠品 ∪ 内部领用 ∪ 其他零价出库单」的混合，系统未打标无法拆分
     —— 页面文案与脚注都必须如实说明，不许把它包装成「促销让利」。
   🔴 本页**只读**、无新建 / 编辑入口；无图表无导出（与现有四张报表页严格对齐）。 */
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const days = ref(90)
const gift = ref({ order_count: 0, item_count: 0, total_cost: 0, by_product: [] })
const activities = ref([])
const activityNote = ref('')
const giftNote = ref('')

/* by_product 后端已按成本排好，前端只截前 20 行展示。 */
const topProducts = computed(() => {
  const list = Array.isArray(gift.value.by_product) ? gift.value.by_product : []
  return list.slice(0, 20)
})

/* 本页合计：只对可见行（前 20）的可加总列求和（数量 / 成本）。 */
const rowTotals = computed(() => {
  let qty = 0, cost = 0
  for (const r of topProducts.value) {
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
      by_product: Array.isArray(g.by_product) ? g.by_product : []
    }
    activities.value = Array.isArray(d.activities) ? d.activities : []
    activityNote.value = String(d.activity_note || '')
    giftNote.value = String(g.note || '')
  } catch (e) {
    err.value = (e && e.message) || '促销 ROI 分析读取失败'
    gift.value = { order_count: 0, item_count: 0, total_cost: 0, by_product: [] }
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
/* 页面私有类一律 `pro-` 前缀（数据报表·促销ROI分析）；全局件（.page/.page-hd/.card/.kpi-strip/
   .table-wrap/.tbl/.num/.seq-th/.seq-cell/.ft-lb/.sec-hd/.state-empty/.state-error/.btn/.val-ok/.val-bad）
   一律复用，不重定义。 */
.pro-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.pro-sel { padding: 4px 8px }
.pro-card { margin-top: 14px }
.pro-sec { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap }
.pro-badge {
  display: inline-block; margin-left: 6px; padding: 0 6px; font-size: 11px; font-weight: 400;
  border-radius: 8px; background: var(--bg2); color: var(--t3);
}
.pro-tag {
  display: inline-block; margin-left: 6px; padding: 0 6px; font-size: 11px; font-weight: 400;
  border-radius: 8px; background: var(--warn-amber-bg); color: var(--warn);
}
.pro-empty { padding: 6px 2px }
.pro-empty-note { font-size: 12px; color: var(--t2); line-height: 1.9; margin: 0 }
.pro-empty-guide { font-size: 12px; color: var(--t1); line-height: 1.9; margin: 8px 0 0 }
.pro-note { font-size: 12px; color: var(--t2); line-height: 1.8; margin: 10px 2px 0 }
.pro-foot { font-size: 12px; color: var(--t2); margin-top: 4px; line-height: 1.7 }
</style>
