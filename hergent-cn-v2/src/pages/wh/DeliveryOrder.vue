<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>配送单</h2>
        <span class="page-sub">{{ scopeText }} · {{ rows.length }} 单</span>
      </div>
      <div class="dvo-acts">
        <select v-model="scope" class="input dvo-scope" @change="onScopeChange">
          <option value="today">今日待配送</option>
          <option value="all">全部配送单（近 200 单）</option>
        </select>
        <input v-if="scope === 'today'" v-model="date" type="date" class="input dvo-date" @change="loadRows" />
        <select v-model="statusFilter" class="input dvo-status">
          <option value="">全部状态</option>
          <option v-for="s in statuses" :key="s.v" :value="s.v">{{ s.t }}</option>
        </select>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadRows">
          <Icon name="refresh" :size="14" />刷新
        </button>
      </div>
    </div>

    <Skeleton v-if="loading" />

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="loadRows">重试</button>
    </div>

    <template v-else>
      <div class="card kpi-strip cols-4">
        <div class="kpi">
          <div class="kpi-label">已分车</div>
          <div class="kpi-val val-warn">{{ cnt.assigned }}</div>
          <div class="kpi-sub">待配送</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">已送达</div>
          <div class="kpi-val">{{ cnt.delivered }}</div>
          <div class="kpi-sub">货已到、未签收</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">已签收</div>
          <div class="kpi-val val-ok">{{ cnt.signed }}</div>
          <div class="kpi-sub">配送完成</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">配送失败</div>
          <div class="kpi-val val-danger">{{ cnt.failed }}</div>
          <div class="kpi-sub">需重排或退回</div>
        </div>
      </div>

      <div class="card dvo-card">
        <div v-if="!viewRows.length" class="state-empty">
          {{ emptyText }}
          <div class="dvo-empty-hint">{{ emptyHint }}</div>
        </div>
        <div v-else class="table-wrap freeze-list">
          <table class="tbl dvo-tbl">
          <thead>
            <tr>
              <th style="width:120px">单号</th>
              <th>客户</th>
              <th style="width:200px">收货地址</th>
              <th style="width:90px">司机</th>
              <th style="width:110px">车辆</th>
              <th style="width:90px">金额</th>
              <th style="width:100px">配送状态</th>
              <th style="width:130px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in viewRows" :key="o.id">
              <td class="dvo-mono">{{ o.order_no || ('#' + o.id) }}</td>
              <td>{{ o.customer_name || ('客户 #' + o.customer_id) }}</td>
              <td class="dvo-addr">{{ o.delivery_address || o.address || '—' }}</td>
              <td>{{ o.driver_id || '—' }}</td>
              <td>{{ o.vehicle_name || '—' }}</td>
              <td class="dvo-mono">¥{{ money(o.total_amount) }}</td>
              <td><span class="badge" :class="statusCls(o.delivery_status)">{{ statusText(o.delivery_status) }}</span></td>
              <td class="dvo-op-cell">
                <button v-if="o.delivery_status === 'assigned'" class="dvo-op" :disabled="busy === o.id"
                        @click="mark(o, 'delivered')">标记送达</button>
                <button v-else-if="o.delivery_status === 'delivered'" class="dvo-op" :disabled="busy === o.id"
                        @click="mark(o, 'signed')">标记签收</button>
                <button v-else-if="o.delivery_status === 'signed'" class="dvo-op dvo-op-danger" :disabled="busy === o.id"
                        @click="mark(o, 'failed')">标记失败</button>
                <span v-else class="dvo-dim">—</span>
              </td>
            </tr>
          </tbody>
            <tfoot>
              <tr>
                <td class="ft-lb">本页合计</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td class="num dvo-mono">¥{{ money(dvoTotal) }}</td>
                <td></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p class="dvo-foot">
        口径：配送单的本体是<b>销售单</b>上的配送字段（<code>driver_id</code> / <code>vehicle_id</code> /
        <code>delivery_status</code>），不是独立单据表。
        <b>今日待配送</b>走 <code>/api/delivery-tasks</code>（后端 SQL 硬编码只取
        <code>delivery_status='assigned'</code> 且下单日期 = 所选日期）；
        <b>全部配送单</b>走 <code>/api/sale-orders</code>，本地按「有配送状态」筛
        —— 两个视图<b>各用各的端点</b>，不混用，否则会以为"今天只有 3 单"其实是别人已签收。
        <br />⚠️ <b>已知限制</b>：① <b>分车没有接口</b>（<code>assign_vehicle()</code> 未挂路由）
        ⇒ 本页只能推进状态，分车要在销售单侧完成；
        ② 「全部配送单」最多 <b>200 单</b>（销售单列表一次请求的上限），不是全量；
        ③ 司机在库里是<b>文本</b>，不是员工档案，重名/空格会被当成两个人；
        ④ 「全部」视图的<b>车辆列恒为 —</b>：<code>/api/sale-orders</code> 只 JOIN 客户表、
           不 JOIN 车辆表（<code>SELECT so.*</code> 没有别名）⇒ 那里没有车辆名，显示
           「车辆 #1」这种 ID 兜底是<b>伪信息</b>（老板不知道 #1 是谁），宁可留空。
      </p>
    </template>
  </div>
</template>

<script setup>
/**
 * DeliveryOrder.vue —— 仓配管理 P3 · 配送单
 *
 * 🔴 数据真相：配送单**没有独立表**。它是 `sale_orders` 上的一组配送字段
 *    （`driver_id` / `vehicle_id` / `delivery_status` / `delivery_date` / `delivery_address`）。
 *    上一轮盘点说「P3 后端不存在、要按新建估工」是**错的** —— 端点一直在
 *    （`routers/vehicles.py` 的 `/api/delivery-tasks` 与 `routers/delivery.py`）。
 *
 * 两个视图各自一个端点，理由写在模板口径里：
 *   · `today` → `whApi.taskList(date)`      （后端只返 assigned）
 *   · `all`   → `whApi.saleOrders({limit})` 本地筛（含全部状态，含历史）
 *   混用会把「今天只有 3 单」当成事实 —— 那只是**还没送的** 3 单。
 */
import Skeleton from '../../components/Skeleton.vue'
import { ref, computed, onMounted } from 'vue'
import { whApi } from '../../api/wh.js'
import Icon from '../../components/Icon.vue'
import { toast } from '../../store'

const ALL_LIMIT = 200

function today () {
  const d = new Date()
  const z = n => ('0' + n).slice(-2)
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

const scope = ref('today')
const date = ref(today())
const statusFilter = ref('')
const loading = ref(false)
const err = ref('')
const busy = ref(0)
const rows = ref([])

const statuses = whApi.deliveryStatuses()

const scopeText = computed(() => (scope.value === 'today' ? `今日待配送 · ${date.value}` : '全部配送单（含历史）'))
const viewRows = computed(() => {
  if (!statusFilter.value) return rows.value
  return rows.value.filter(o => o.delivery_status === statusFilter.value)
})
const cnt = computed(() => {
  const c = { assigned: 0, delivered: 0, signed: 0, failed: 0 }
  rows.value.forEach(o => {
    const s = o.delivery_status
    if (s === 'assigned') c.assigned += 1
    else if (s === 'delivered') c.delivered += 1
    else if (s === 'signed') c.signed += 1
    else if (s === 'failed') c.failed += 1
  })
  return c
})
const emptyText = computed(() => (scope.value === 'today' ? `${date.value} 没有待配送的单` : '还没有纳入配送的销售单'))
const emptyHint = computed(() => (scope.value === 'today'
  ? '已送达 / 已签收的单不在这个视图里 —— 切到「全部配送单」看历史。'
  : '销售单要先分车（写车辆与司机）才会被算作配送单；分车在销售单侧完成。'))

function statusText (s) {
  const hit = statuses.find(x => x.v === s)
  return hit ? hit.t : (s || '未分车')
}
function statusCls (s) {
  const hit = statuses.find(x => x.v === s)
  return hit ? hit.cls : ''
}
function money (n) {
  return Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function onScopeChange () {
  statusFilter.value = ''
  loadRows()
}

async function loadRows () {
  loading.value = true
  err.value = ''
  try {
    if (scope.value === 'today') {
      rows.value = await whApi.taskList(date.value)
    } else {
      /* `SELECT so.*` ⇒ delivery_* 全在；`driver_id` 也是 so 的列。
         🔴 只筛「有配送状态」的单 —— 自提 / 调拨单没有配送状态，不该出现在配送单页。 */
      const all = await whApi.saleOrders({ limit: ALL_LIMIT })
      rows.value = (all || []).filter(o => !!o.delivery_status)
    }
  } catch (e) {
    err.value = e.message || '配送单读取失败'
    rows.value = []
  } finally {
    loading.value = false
  }
}

async function mark (o, status) {
  busy.value = o.id
  try {
    const r = await whApi.taskSetStatus(o.id, status)
    if (r && r.success === false) throw new Error('后端未接受该状态变更')
    toast(`已标记为「${statusText(status)}」`)
    await loadRows()
  } catch (e) {
    toast(e.message || '状态更新失败', 'error')
  } finally {
    busy.value = 0
  }
}

/* 本页合计：只对当前视图可见配送单的「金额」求和。 */
const dvoTotal = computed(() => viewRows.value.reduce((s, o) => s + Number(o.total_amount || 0), 0))
onMounted(loadRows)
</script>

<style scoped>
/* 页面私有类一律 `dvo-` 前缀（仓配·配送单），避免与兄弟页串味。 */
.dvo-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.dvo-scope { width: 190px }
.dvo-date { width: 150px }
.dvo-status { width: 120px }

.dvo-card { padding: 0; overflow: hidden }
.dvo-tbl { table-layout: fixed }
.dvo-mono { font-variant-numeric: tabular-nums; font-weight: 500 }
.dvo-addr { font-size: 12px; color: var(--t2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.dvo-dim { color: var(--t3); font-size: 12px }

.dvo-op-cell { white-space: nowrap }
.dvo-op {
  border: none; background: none; padding: 0; font-size: 13px;
  color: var(--p-dark); cursor: pointer; white-space: nowrap;
}
.dvo-op:hover { text-decoration: underline }
.dvo-op:disabled { color: var(--t3); cursor: not-allowed; text-decoration: none }
.dvo-op-danger { color: var(--dan) }

.dvo-empty-hint { font-size: 12px; color: var(--t3); margin-top: 6px }
.dvo-foot { font-size: 12px; color: var(--t2); margin-top: 12px; line-height: 1.7 }
</style>
