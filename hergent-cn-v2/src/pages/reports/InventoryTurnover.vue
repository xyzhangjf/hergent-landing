<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>库存周转</h2>
        <span class="page-sub">近 {{ days }} 天销售成本 ÷ 当前库存 · 周转越快越好</span>
      </div>
      <div class="rpt-acts">
        <select class="btn btn-ghost btn-sm rpt-sel" v-model.number="days" @change="load()">
          <option :value="30">近 30 天</option>
          <option :value="60">近 60 天</option>
          <option :value="90">近 90 天</option>
          <option :value="180">近 180 天</option>
        </select>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load()">
          <Icon name="refresh" :size="14" />刷新
        </button>
      </div>
    </div>

    <Skeleton v-if="loading" />

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="load()">重试</button>
    </div>

    <template v-else>
      <div class="card kpi-strip cols-4">
        <div class="kpi">
          <div class="kpi-label">当前库存金额</div>
          <div class="kpi-val">{{ fmtMoney(s.stock_value) }}</div>
          <div class="kpi-sub">{{ s.sku_with_stock }} 个商品有库存记录</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">期间销售成本</div>
          <div class="kpi-val">{{ fmtMoney(s.period_cost) }}</div>
          <div class="kpi-sub">近 {{ days }} 天 · 已送达口径</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">周转天数</div>
          <div class="kpi-val" :class="daysClass(s.turnover_days)">{{ dayText(s.turnover_days) }}</div>
          <div class="kpi-sub">库存 ÷ 日均成本</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">周转次数</div>
          <div class="kpi-val">{{ s.turnover_times ? s.turnover_times + ' 次/年' : '—' }}</div>
          <div class="kpi-sub">365 ÷ 周转天数</div>
        </div>
      </div>

      <!-- ⚠️ 覆盖缺口：库存表只覆盖少数 SKU，其余算不出周转，不能静默当成「零库存」 -->
      <div v-if="s.sku_without_stock" class="card rpt-warn">
        <div class="rpt-warn-hd"><Icon name="alert" :size="14" /> 覆盖范围提醒</div>
        <p>
          只有 <b>{{ s.sku_with_stock }}</b> 个商品<b>既有库存记录、又有销量</b>，能算出周转天数；
          另有 <b>{{ s.sku_without_stock }}</b> 个有销量的商品<b>没有库存记录</b>，无法计算（分母为 0 无意义），
          已单独列在下方，<b>不能当成「库存为零、周转飞快」</b>。
          请先补录这些商品的库存，本表覆盖才会完整。
        </p>
      </div>

      <div class="card rpt-card">
        <div class="sec-hd rpt-sec">
          <span>可算周转的商品（按周转天数从慢到快）</span>
        </div>
        <div v-if="items.length" class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>商品</th>
                <th>品牌</th>
                <th class="num">当前库存</th>
                <th class="num">库存金额</th>
                <th class="num">期间成本</th>
                <th class="num">周转天数</th>
                <th class="num">周转次数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in items" :key="'t-' + i">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>
                  {{ r.name || '—' }}
                  <span v-if="r.no_cost" class="rpt-tag">缺进价</span>
                </td>
                <td>{{ r.brand || '—' }}</td>
                <td class="num">{{ fmtNum(r.stock_qty) }}{{ r.unit || '' }}</td>
                <td class="num">{{ fmtMoney(r.stock_value) }}</td>
                <td class="num">{{ fmtMoney(r.period_cost) }}</td>
                <td class="num" :class="daysClass(r.turnover_days)">{{ dayText(r.turnover_days) }}</td>
                <td class="num">{{ r.turnover_times ?? '—' }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb" colspan="3">本页合计</td>
                <td class="num">{{ fmtNum(tot1.stock_qty) }}</td>
                <td class="num">{{ fmtMoney(tot1.stock_value) }}</td>
                <td class="num">{{ fmtMoney(tot1.period_cost) }}</td>
                <td></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div v-else class="state-empty">暂无可算周转的商品（需同时有库存记录与销量）。</div>
      </div>

      <div v-if="noStock.length" class="card rpt-card">
        <div class="sec-hd rpt-sec">
          <span>有销量但无库存记录（{{ noStock.length }} 个 · 按期间成本从高到低）</span>
        </div>
        <div class="table-wrap freeze-list">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>商品</th>
                <th>品牌</th>
                <th class="num">期间销量</th>
                <th class="num">期间成本</th>
                <th class="num">周转天数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in noStock" :key="'n-' + i">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td>{{ r.name || '—' }}</td>
                <td>{{ r.brand || '—' }}</td>
                <td class="num">{{ fmtNum(r.sold_qty) }}{{ r.unit || '' }}</td>
                <td class="num">{{ fmtMoney(r.period_cost) }}</td>
                <td class="num">缺库存</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb" colspan="3">本页合计</td>
                <td class="num">{{ fmtNum(tot2.sold_qty) }}</td>
                <td class="num">{{ fmtMoney(tot2.period_cost) }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p class="rpt-foot">
        口径：只统计「已送达 / 已签收」；期间成本 = 销量 × 商品进货价；库存金额 = 库存量 × 成本价
        （<code>inventory.cost_price</code> 为空时回退商品进货价）；周转天数 = 库存金额 ÷ 日均销售成本；
        周转次数 = 365 ÷ 周转天数。前端<b>不重算</b>周转，全部读后端
        <code>GET /api/reports/inventory-turnover</code>。
        ⚠️ 周转天数用的是「当前库存」而非「平均库存」（系统暂无历史库存快照），读数会随盘点时点波动。
      </p>
    </template>
  </div>
</template>

<script setup>
/* 库存周转（数据报表 › 库存） —— 数据源：GET /api/reports/inventory-turnover（v507 新增端点）。
   🔴 周转**不在前端算**：后端统一口径（库存金额 ÷ 日均成本），前端只展示。
   🔴 无库存记录的商品**不参与**周转计算并单列 —— 否则「库存记录缺失」会被读成
      「库存为零 ⇒ 周转无限快」，这是比不显示更危险的假数字。
   🔴 本页只读。 */
import Skeleton from '../../components/Skeleton.vue'
import { ref, computed, onMounted } from 'vue'
import Icon from '../../components/Icon.vue'
import { reportsApi } from '../../api/modules'

const loading = ref(true)
const err = ref('')
const days = ref(90)
const s = ref({})
const items = ref([])
const noStock = ref([])

/* 低温奶短保：周转 > 7 天偏慢（红），> 3 天注意（黄），其余正常（绿） */
function daysClass(v) {
  if (v === null || v === undefined) return ''
  if (v > 7) return 'val-bad'
  if (v > 3) return 'val-warn'
  return 'val-ok'
}
function dayText(v) {
  return (v === null || v === undefined) ? '—' : (v.toFixed ? v.toFixed(1) : v) + ' 天'
}

function fmtMoney(v) {
  const n = Number(v || 0)
  if (Math.abs(n) >= 10000) return '¥' + (n / 10000).toFixed(1) + ' 万'
  return '¥' + n.toFixed(0)
}
function fmtNum(v) { return Number(v || 0).toFixed(0) }

async function load() {
  loading.value = true
  err.value = ''
  try {
    const d = await reportsApi.inventoryTurnover(days.value)
    s.value = (d && d.summary) || {}
    items.value = Array.isArray(d && d.items) ? d.items : []
    noStock.value = Array.isArray(d && d.no_stock_items) ? d.no_stock_items : []
  } catch (e) {
    err.value = (e && e.message) || '加载失败'
    s.value = {}; items.value = []; noStock.value = []
  } finally {
    loading.value = false
  }
}

/* 本页合计：可算周转表 / 无库存表各自对可见行的可加总列求和；周转天数 / 次数均为比率，不合计。 */
const tot1 = computed(() => {
  let stock_qty = 0, stock_value = 0, period_cost = 0
  for (const r of items.value) {
    stock_qty += Number(r.stock_qty || 0)
    stock_value += Number(r.stock_value || 0)
    period_cost += Number(r.period_cost || 0)
  }
  return { stock_qty, stock_value, period_cost }
})
const tot2 = computed(() => {
  let sold_qty = 0, period_cost = 0
  for (const r of noStock.value) {
    sold_qty += Number(r.sold_qty || 0)
    period_cost += Number(r.period_cost || 0)
  }
  return { sold_qty, period_cost }
})
onMounted(load)
</script>

<style scoped>
.rpt-acts { display: flex; gap: 8px; align-items: center; }
.rpt-sel { padding: 4px 8px; }
.rpt-card { margin-top: 14px; }
.rpt-sec { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.rpt-warn { margin-top: 14px; padding: 12px 14px; border-left: 3px solid var(--warn-amber); background: var(--bg2); }
.rpt-warn-hd { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--war); font-size: 13px; }
.rpt-warn p { margin: 6px 0 0; font-size: 12px; line-height: 1.9; color: var(--t2); }
.rpt-tag {
  display: inline-block; margin-left: 6px; padding: 0 5px; border-radius: 3px;
  background: var(--bg2); color: var(--war); font-size: 11px;
}
.rpt-foot { margin: 14px 2px 0; font-size: 12px; line-height: 1.9; color: var(--t2); }
.rpt-foot code { background: var(--bg2); padding: 1px 5px; border-radius: 4px; font-size: 11px; }
</style>
