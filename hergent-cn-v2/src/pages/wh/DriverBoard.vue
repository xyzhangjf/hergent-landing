<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>司机任务看板</h2>
        <span class="page-sub">按日期把已分车的配送单按司机聚合 · {{ date }} · 共 {{ board.total_tasks || 0 }} 单</span>
      </div>
      <div class="dbd-acts">
        <input v-model="date" type="date" class="input dbd-date" @change="loadBoard" />
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadBoard">
          <Icon name="refresh" :size="14" />刷新
        </button>
      </div>
    </div>

    <Skeleton v-if="loading" />

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="loadBoard">重试</button>
    </div>

    <template v-else>
      <!-- KPI：与看板列读**同一个** board 响应，不另发汇总请求 -->
      <div class="card kpi-strip cols-4">
        <div class="kpi">
          <div class="kpi-label">配送任务</div>
          <div class="kpi-val">{{ board.total_tasks || 0 }}</div>
          <div class="kpi-sub">当日已分车的单数</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">司机数</div>
          <div class="kpi-val">{{ drivers.length }}</div>
          <div class="kpi-sub">已分配司机的列数</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">路线数</div>
          <div class="kpi-val">{{ board.route_count || 0 }}</div>
          <div class="kpi-sub">当日线路（含未绑定司机的）</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">未分配司机</div>
          <div class="kpi-val val-warn">{{ (board.unassigned || []).length }}</div>
          <div class="kpi-sub">已分车但没写司机</div>
        </div>
      </div>

      <!-- 看板：一列一司机，横向滚动（对齐旧前端 driver-board.js 的形态） -->
      <div v-if="!drivers.length && !(board.unassigned || []).length" class="card dbd-empty">
        <Icon name="package" :size="22" />
        <p>{{ date }} 暂无已分车的配送任务</p>
        <span class="dbd-empty-hint">
          配送单要先有「车辆 + 司机」才会出现在这里。分车在销售单侧完成 ——
          本页只负责看板与状态推进（既有后端没有分车接口，见下方口径说明）。
        </span>
      </div>

      <div v-else class="dbd-board">
        <div v-for="d in drivers" :key="d.driver" class="dbd-col">
          <div class="dbd-col-hd">
            <Icon name="users" :size="16" />
            <b>{{ d.driver }}</b>
            <span v-if="vehText(d)" class="dbd-veh">{{ vehText(d) }}</span>
          </div>
          <div class="dbd-col-sub">{{ d.task_count }} 单 · ¥{{ money(d.total_amount) }}</div>
          <div v-if="(d.routes || []).length" class="dbd-routes">
            <span v-for="r in d.routes" :key="r.id" class="badge badge-blue dbd-route">
              {{ r.name || ('路线 #' + r.id) }}<template v-if="r.stops">（{{ r.stops }} 站）</template>
            </span>
          </div>
          <div class="dbd-cards">
            <div v-for="o in d.orders" :key="o.id" class="dbd-card">
              <div class="dbd-card-hd">
                <span class="dbd-mono">{{ o.order_no || ('#' + o.id) }}</span>
                <span class="badge" :class="statusCls(o.delivery_status)">{{ statusText(o.delivery_status) }}</span>
              </div>
              <div class="dbd-cust">{{ o.customer_name || '客户 #' + o.customer_id }}</div>
              <div v-if="o.address" class="dbd-addr">{{ o.address }}</div>
              <div v-if="o.phone" class="dbd-addr">{{ o.phone }}</div>
              <div class="dbd-card-ft">
                <span class="dbd-amt">¥{{ money(o.total_amount) }}</span>
                <span class="dbd-btns">
                  <button v-if="o.delivery_status === 'assigned'" class="dbd-btn" :disabled="busy === o.id"
                          @click="mark(o, 'delivered')">
                    <Icon name="check" :size="12" />标记送达
                  </button>
                  <button v-else-if="o.delivery_status === 'delivered'" class="dbd-btn" :disabled="busy === o.id"
                          @click="mark(o, 'signed')">
                    <Icon name="check" :size="12" />标记签收
                  </button>
                  <button v-else-if="o.delivery_status === 'signed'" class="dbd-btn dbd-btn-fail" :disabled="busy === o.id"
                          @click="mark(o, 'failed')">
                    <Icon name="close" :size="12" />标记失败
                  </button>
                  <span v-else class="dbd-dim">{{ statusText(o.delivery_status) }}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- 未分配司机：与「有司机」的列并列，视觉上用虚线边框区分 -->
        <div v-if="(board.unassigned || []).length" class="dbd-col dbd-col-warn">
          <div class="dbd-col-hd">
            <Icon name="alert" :size="16" />
            <b>未分配司机</b>
            <span class="dbd-veh">{{ (board.unassigned || []).length }} 单</span>
          </div>
          <div class="dbd-col-sub">这些单已分车，但没写司机 ⇒ 不会出现在任何司机列里</div>
          <div class="dbd-cards">
            <div v-for="o in board.unassigned" :key="o.id" class="dbd-card">
              <div class="dbd-card-hd">
                <span class="dbd-mono">{{ o.order_no || ('#' + o.id) }}</span>
              </div>
              <div class="dbd-cust">{{ o.customer_name || '客户 #' + o.customer_id }}</div>
              <div v-if="o.address" class="dbd-addr">{{ o.address }}</div>
              <div class="dbd-card-ft">
                <span class="dbd-amt">¥{{ money(o.total_amount) }}</span>
                <span class="dbd-btns">
                  <button class="dbd-btn" :disabled="busy === o.id" @click="mark(o, 'delivered')">
                    <Icon name="check" :size="12" />标记送达
                  </button>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p class="dbd-foot">
        口径：看板只统计<b>已分车</b>（<code>delivery_status='assigned'</code>）且<b>下单日期 = 所选日期</b>的配送单，
        按司机分组；路线数取自当日线路表（含未绑定司机的线路，故它可能大于司机列数）。
        状态推进是<b>单向的</b>：已分车 → 已送达 → 已签收，失败只能从已签收回退标记。
        <br />⚠️ <b>已知限制</b>：分车（写车辆 + 司机）在既有后端<b>没有接口</b>
        （<code>erp_db.assign_vehicle()</code> 存在但没挂路由）⇒ 本页<b>只推状态、不能分车</b>，
        分车要在销售单侧完成。另一条：<code>driver_id</code> 在库里是<b>文本</b>（不是员工 ID），
        看板按文本精确分组 ⇒ 同一人写成「张三」和「张三 」会被算成两个司机。
      </p>
    </template>
  </div>
</template>

<script setup>
/**
 * DriverBoard.vue —— 仓配管理 P3 · 司机任务看板
 *
 * 数据源：`GET /api/delivery/board?date=`（**既有**端点，后端零改动）。
 *   → `{date, drivers:[{driver, vehicle_name, plate, orders[], routes[], task_count, total_amount}],
 *        unassigned:[…], route_count, total_tasks}`
 *   🔴 返回的是**聚合结果不是数组**：KPI 与看板列必须读**同一个响应**（一次请求），
 *      否则会出现「KPI 说 5 单、看板里 3 张卡」这种结构性不一致。
 *
 * 形态对齐旧前端 `static/js/modules/driver-board.js`（司机列 + 未分配列 + 四 KPI），
 * 但改成**页面**而不是弹窗，并把旧前端写死的 `bg-info/bg-ok` 换成本前端的
 * `badge-blue/badge-green/badge-red`（旧那套在本前端是空样式）。
 *
 * ⚠️ 本页**只读 + 状态推进**，不做分车 —— 理由见模板里 `dbd-foot` 的口径说明。
 */
import Skeleton from '../../components/Skeleton.vue'
import { ref, computed, onMounted } from 'vue'
import { whApi } from '../../api/wh.js'
import Icon from '../../components/Icon.vue'
import { toast } from '../../store'

function today () {
  const d = new Date()
  const z = n => ('0' + n).slice(-2)
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

const date = ref(today())
const loading = ref(false)
const err = ref('')
const busy = ref(0)
const board = ref({ drivers: [], unassigned: [], route_count: 0, total_tasks: 0 })

const drivers = computed(() => board.value.drivers || [])
const STATUS = whApi.deliveryStatuses()

function statusText (s) {
  const hit = STATUS.find(x => x.v === s)
  return hit ? hit.t : (s || '未分车')
}
function statusCls (s) {
  const hit = STATUS.find(x => x.v === s)
  return hit ? hit.cls : ''
}
function vehText (d) {
  return [d.vehicle_name, d.plate].filter(Boolean).join(' · ')
}
function money (n) {
  return Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function loadBoard () {
  loading.value = true
  err.value = ''
  try {
    const r = await whApi.boardGet(date.value)
    board.value = r || { drivers: [], unassigned: [], route_count: 0, total_tasks: 0 }
  } catch (e) {
    err.value = e.message || '司机任务看板读取失败'
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
    await loadBoard()
  } catch (e) {
    toast(e.message || '状态更新失败', 'error')
  } finally {
    busy.value = 0
  }
}

onMounted(loadBoard)
</script>

<style scoped>
/* 页面私有类一律 `dbd-` 前缀（仓配·司机任务看板），避免与兄弟页串味。 */
.dbd-acts { display: flex; align-items: center; gap: 8px }
.dbd-date { width: 160px }

.dbd-board { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 8px }
.dbd-col {
  min-width: 290px; max-width: 310px; flex: 0 0 auto;
  background: var(--bg2); border: 1px solid var(--bd); border-radius: var(--radius-md); padding: 12px;
}
/* 未分配列用虚线 + 警示色，让"待处理"一眼可见 */
.dbd-col-warn { border-style: dashed; border-color: var(--dan) }

.dbd-col-hd { display: flex; align-items: center; gap: 6px; margin-bottom: 6px }
.dbd-col-hd b { font-weight: 600 }
.dbd-veh { font-size: 12px; color: var(--t3); margin-left: auto }
.dbd-col-sub { font-size: 12px; color: var(--t3); margin-bottom: 8px }
.dbd-routes { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px }
.dbd-route { margin: 0 }

.dbd-cards { display: flex; flex-direction: column; gap: 8px }
.dbd-card {
  background: var(--bg); border: 1px solid var(--bd);
  border-radius: 10px; padding: 10px;
}
.dbd-card-hd { display: flex; align-items: center; gap: 6px }
.dbd-mono { font-variant-numeric: tabular-nums; font-size: 12px; color: var(--t3) }
.dbd-cust { font-weight: 600; margin-top: 4px }
.dbd-addr { font-size: 12px; color: var(--t3); margin-top: 2px }
.dbd-card-ft { display: flex; align-items: center; margin-top: 8px; gap: 8px }
.dbd-amt { font-weight: 600; color: var(--p-dark) }
.dbd-btns { margin-left: auto }

.dbd-btn {
  display: inline-flex; align-items: center; gap: 4px;
  border: 1px solid var(--bd); background: none; border-radius: 6px;
  padding: 3px 8px; font-size: 12px; color: var(--p-dark); cursor: pointer; white-space: nowrap;
}
.dbd-btn:hover { background: var(--p-bg) }
.dbd-btn:disabled { color: var(--t3); cursor: not-allowed; background: none }
.dbd-btn-fail { color: var(--dan) }
.dbd-btn-fail:hover { background: rgba(var(--dan-rgb), .08) }
.dbd-dim { font-size: 12px; color: var(--t3) }

.dbd-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 46px 20px; color: var(--t3); text-align: center;
}
.dbd-empty p { margin: 0 }
.dbd-empty-hint { font-size: 12px; color: var(--t3); line-height: 1.7; max-width: 560px }

.dbd-foot { font-size: 12px; color: var(--t2); margin-top: 12px; line-height: 1.7 }
</style>
