<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>线路设置</h2>
        <span class="page-sub">车辆档案 {{ vehicles.length }} 台 · 线路 {{ rows.length }} 条<span v-if="date"> · {{ date }}</span></span>
      </div>
      <div class="rts-acts">
        <input v-model="date" type="date" class="input rts-date" @change="loadRows" />
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadAll">
          <Icon name="refresh" :size="14" />刷新
        </button>
        <button class="btn btn-ghost btn-sm" @click="showVehicle = !showVehicle">
          <Icon name="plus" :size="14" />车辆档案
        </button>
        <button class="btn btn-primary btn-sm" :disabled="busy" @click="showCreate = !showCreate">
          <Icon name="plus" :size="14" />新建线路
        </button>
      </div>
    </div>

    <!-- 车辆档案：建线路**必填** vehicle_id>0，而线上 vehicles 表是空的 ⇒ 必须能就地建车 -->
    <div v-if="showVehicle" class="card rts-new">
      <div class="rts-new-hd">
        <Icon name="package" :size="14" />
        <span>车辆档案</span>
        <span class="rts-new-sub">没有车辆就建不了线路（后端要求 vehicle_id &gt; 0）</span>
      </div>
      <div v-if="!vehicles.length" class="rts-hint-empty">当前还没有任何车辆，先在下面加一台。</div>
      <table v-else class="tbl rts-tbl">
        <thead>
          <tr>
            <th style="width:60px">ID</th>
            <th>车辆名称</th>
            <th style="width:120px">车牌</th>
            <th style="width:100px">类型</th>
            <th style="width:100px">默认司机</th>
            <th style="width:120px">电话</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in vehicles" :key="v.id">
            <td class="rts-mono">{{ v.id }}</td>
            <td>{{ v.name }}</td>
            <td class="rts-mono">{{ v.plate || '—' }}</td>
            <td>{{ v.type || '—' }}</td>
            <td>{{ v.driver || '—' }}</td>
            <td class="rts-mono">{{ v.phone || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div class="rts-new-row">
        <div class="rts-fld">
          <label class="rts-lb">车辆名称 <b class="rts-req">必填</b></label>
          <input v-model="vform.name" class="input" placeholder="如：鄂F12345 冷藏车" />
        </div>
        <div class="rts-fld">
          <label class="rts-lb">车牌</label>
          <input v-model="vform.plate" class="input" placeholder="鄂F12345" />
        </div>
        <div class="rts-fld">
          <label class="rts-lb">类型</label>
          <input v-model="vform.type" class="input" placeholder="冷藏 / 常温" />
        </div>
        <div class="rts-fld">
          <label class="rts-lb">默认司机</label>
          <input v-model="vform.driver" class="input" placeholder="张三" />
        </div>
        <div class="rts-fld">
          <label class="rts-lb">电话</label>
          <input v-model="vform.phone" class="input" />
        </div>
        <div class="rts-fld-acts">
          <button class="btn btn-primary btn-sm" :disabled="busy" @click="doCreateVehicle">
            <Icon name="save" :size="14" />保存车辆
          </button>
        </div>
      </div>
    </div>

    <!-- 新建线路 -->
    <div v-if="showCreate" class="card rts-new">
      <div class="rts-new-hd">
        <Icon name="plus" :size="14" />
        <span>新建线路</span>
        <span class="rts-new-sub">从当日待配送单里挑客户，按顺序串成一条线路</span>
      </div>
      <div class="rts-new-row">
        <div class="rts-fld">
          <label class="rts-lb">线路名称 <b class="rts-req">必填</b></label>
          <input v-model="form.name" class="input" placeholder="如：襄城线-上午" />
        </div>
        <div class="rts-fld">
          <label class="rts-lb">车辆 <b class="rts-req">必填</b></label>
          <select v-model.number="form.vehicle_id" class="input">
            <option :value="0">请选择车辆</option>
            <option v-for="v in vehicles" :key="v.id" :value="v.id">{{ v.name }}<template v-if="v.plate">（{{ v.plate }}）</template></option>
          </select>
        </div>
        <div class="rts-fld">
          <label class="rts-lb">司机</label>
          <input v-model="form.driver" class="input" placeholder="留空则取车辆默认司机" />
        </div>
        <div class="rts-fld">
          <label class="rts-lb">配送日期</label>
          <input v-model="form.date" type="date" class="input" />
        </div>
      </div>

      <div class="rts-pick">
        <div class="rts-pick-hd">
          <span>停靠点（{{ stops.length }}）</span>
          <span class="rts-new-sub">从下面勾选当日待配送单，按勾选顺序串成线路；顺序可用「优化排序」重排</span>
        </div>
        <div v-if="!tasks.length" class="rts-hint-empty">
          {{ form.date }} 没有待配送的单 —— 可换个日期，或先去销售单侧分车。
        </div>
        <div v-else class="rts-pick-list">
          <label v-for="t in tasks" :key="t.id" class="rts-pick-item">
            <input type="checkbox" :checked="isPicked(t.id)" @change="togglePick(t)" />
            <span class="rts-mono">{{ t.order_no || ('#' + t.id) }}</span>
            <span class="rts-pick-cust">{{ t.customer_name || ('客户 #' + t.customer_id) }}</span>
            <span class="rts-pick-addr">{{ t.delivery_address || t.address || '—' }}</span>
          </label>
        </div>
      </div>

      <div v-if="stops.length" class="rts-stop-preview">
        <div v-for="(s, i) in stops" :key="s.key" class="rts-stop-row">
          <span class="rts-stop-no">{{ i + 1 }}</span>
          <span class="rts-stop-name">{{ s.name }}</span>
          <span class="rts-stop-addr">{{ s.address || '—' }}</span>
          <button class="rts-op-danger" :disabled="busy" @click="removeStop(i)">移除</button>
        </div>
      </div>

      <div class="rts-new-acts">
        <button class="btn btn-ghost btn-sm" :disabled="busy" @click="cancelCreate">取消</button>
        <button class="btn btn-primary btn-sm" :disabled="busy" @click="doCreateRoute">
          <Icon name="check" :size="14" />创建线路
        </button>
      </div>
    </div>

    <div v-if="loading" class="state-empty">加载中…</div>

    <div v-else-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="loadAll">重试</button>
    </div>

    <template v-else>
      <div class="card kpi-strip cols-4">
        <div class="kpi">
          <div class="kpi-label">线路数</div>
          <div class="kpi-val">{{ rows.length }}</div>
          <div class="kpi-sub">当前筛选下</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">进行中</div>
          <div class="kpi-val val-warn">{{ cnt.pending }}</div>
          <div class="kpi-sub">还有未送达停靠点</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">已完成</div>
          <div class="kpi-val val-ok">{{ cnt.completed }}</div>
          <div class="kpi-sub">全部停靠点已送达</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">停靠点</div>
          <div class="kpi-val">{{ cnt.stops }}</div>
          <div class="kpi-sub">已送达 {{ cnt.done }}</div>
        </div>
      </div>

      <div v-if="!rows.length" class="card rts-empty">
        <Icon name="target" :size="22" />
        <p>还没有线路</p>
        <span class="rts-empty-hint">
          建线路需要：① 至少一台车辆（上面「车辆档案」里加）；② 当日有待配送的单（在销售单侧分车后才会出现）。
        </span>
      </div>

      <div v-else class="rts-list">
        <div v-for="r in rows" :key="r.id" class="card rts-route">
          <div class="rts-route-hd">
            <div>
              <b class="rts-route-name">{{ r.name }}</b>
              <span class="badge" :class="r.status === 'completed' ? 'badge-green' : 'badge-amber'">
                {{ r.status === 'completed' ? '已完成' : '进行中' }}
              </span>
            </div>
            <div class="rts-route-meta">
              <span>{{ r.driver || '未指派司机' }}</span>
              <span>{{ vehicleName(r.vehicle_id) }}</span>
              <span>{{ r.date || '—' }}</span>
              <span>{{ (r.stops || []).length }} 站</span>
              <button class="rts-op" :disabled="busy" @click="doOptimize(r)">优化排序</button>
            </div>
          </div>

          <table class="tbl rts-tbl">
            <thead>
              <tr>
                <th style="width:50px">序</th>
                <th>客户</th>
                <th style="width:220px">地址</th>
                <th style="width:100px">关联单号</th>
                <th style="width:90px">状态</th>
                <th style="width:100px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in (r.stops || [])" :key="s.id">
                <td class="rts-mono">{{ s.stop_order }}</td>
                <td>{{ s.contact_name || '—' }}</td>
                <td class="rts-addr">{{ s.address || '—' }}</td>
                <td class="rts-mono">{{ s.order_ids || '—' }}</td>
                <td>
                  <span class="badge" :class="s.status === 'delivered' ? 'badge-green' : 'badge-amber'">
                    {{ s.status === 'delivered' ? '已送达' : '待送达' }}
                  </span>
                </td>
                <td>
                  <button v-if="s.status !== 'delivered'" class="rts-op" :disabled="busy"
                          @click="doDeliver(r, s)">标记送达</button>
                  <span v-else class="rts-dim">{{ (s.delivered_at || '').slice(0, 16) }}</span>
                </td>
              </tr>
              <tr v-if="!(r.stops || []).length">
                <td colspan="6" class="rts-dim">这条线路还没有停靠点</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p class="rts-foot">
        口径：线路 = <code>delivery_routes</code> + <code>delivery_stops</code> 两张表，一条线路串多个客户，
        停靠点<b>逐个送达</b>；全部停靠点送达后线路自动置<b>已完成</b>（后端
        <code>delivery_stop_update</code> 里数出来的，不是前端判断）。
        停靠点的「关联单号」是 <code>order_ids</code> 文本串（逗号分隔），改单不会自动同步到线路。
        <br />⚠️ <b>已知限制</b>：① <b>停靠点没有 GPS 采集入口</b>，<code>lat/lng</code> 恒为 0 ⇒
        「优化排序」走的是<b>按地址字符串排序</b>的兜底分支，不是真实路径规划（要真规划必须先补坐标）；
        ② 线路里的停靠点<b>不能增减/改序</b>（后端只有新建与「整体重排」两个动作）⇒ 要改就另建一条；
        ③ 建线路<b>必填车辆</b>，而车辆档案目前只有「新建」没有「停用/删除」。
      </p>
    </template>
  </div>
</template>

<script setup>
/**
 * RouteSetup.vue —— 仓配管理 P3 · 线路设置（含车辆档案，因为建线路必须先有车）
 *
 * 端点（全部既有，后端零改动）：
 *   GET  /api/vehicles                      → 裸数组（复用 P0 的 `whApi.vehicles()`）
 *   POST /api/vehicles                      → {success,id}（Pydantic 校验 name 非空）
 *   GET  /api/delivery-routes?date=&status= → 数组，每条带 `stops[]`
 *   POST /api/delivery-routes               → {success,id}（校验 name 非空 + vehicle_id>0）
 *   POST /api/delivery-routes/{rid}/optimize→ {optimized, method?, stops?}（**形状随分支变**）
 *   POST /api/delivery-stops/{sid}/update   → {success}（全送达 ⇒ 线路自动 completed）
 *   GET  /api/delivery-tasks?date=          → 当日待配送单，用作停靠点候选
 *
 * 🔴 为什么本页要能建车辆：`delivery_route_create` 的 Pydantic 校验是 `vehicle_id: gt=0`，
 *    而生产 `vehicles` 表实测 **0 行** ⇒ 不给建车入口的话，「新建线路」永远点不动。
 */
import { ref, computed, onMounted, watch } from 'vue'
import { whApi } from '../../api/wh.js'
import Icon from '../../components/Icon.vue'
import { toast } from '../../store'

function today () {
  const d = new Date()
  const z = n => ('0' + n).slice(-2)
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

const date = ref('')
const loading = ref(false)
const err = ref('')
const busy = ref(false)

const vehicles = ref([])
const rows = ref([])
const tasks = ref([])

const showVehicle = ref(false)
const showCreate = ref(false)
const vform = ref({ name: '', plate: '', type: '', driver: '', phone: '' })
const form = ref({ name: '', vehicle_id: 0, driver: '', date: today() })
const stops = ref([])

const cnt = computed(() => {
  const c = { pending: 0, completed: 0, stops: 0, done: 0 }
  rows.value.forEach(r => {
    if (r.status === 'completed') c.completed += 1
    else c.pending += 1
    ;(r.stops || []).forEach(s => {
      c.stops += 1
      if (s.status === 'delivered') c.done += 1
    })
  })
  return c
})

function vehicleName (id) {
  const v = vehicles.value.find(x => Number(x.id) === Number(id))
  return v ? v.name : (id ? ('车辆 #' + id) : '未指定车辆')
}
function isPicked (id) {
  return stops.value.some(s => (s.order_ids || []).includes(Number(id)))
}
function togglePick (t) {
  if (isPicked(t.id)) {
    stops.value = stops.value.filter(s => !(s.order_ids || []).includes(Number(t.id)))
    return
  }
  stops.value = stops.value.concat([{
    key: 'S' + t.id,
    name: t.customer_name || ('客户 #' + t.customer_id),
    address: t.delivery_address || t.address || '',
    order_ids: [Number(t.id)],
  }])
}
function removeStop (i) {
  stops.value = stops.value.filter((_, idx) => idx !== i)
}
function cancelCreate () {
  showCreate.value = false
  form.value = { name: '', vehicle_id: 0, driver: '', date: today() }
  stops.value = []
}

async function loadRefs () {
  try {
    vehicles.value = await whApi.vehicles()
  } catch (e) {
    vehicles.value = []
  }
}
async function loadRows () {
  try {
    rows.value = await whApi.routeList(date.value)
  } catch (e) {
    err.value = e.message || '线路读取失败'
    rows.value = []
  }
}
async function loadTasks () {
  try {
    tasks.value = await whApi.taskList(form.value.date)
  } catch (e) {
    tasks.value = []
  }
}
async function loadAll () {
  loading.value = true
  err.value = ''
  await Promise.all([loadRefs(), loadRows()])
  if (showCreate.value) await loadTasks()
  loading.value = false
}

async function doCreateVehicle () {
  if (!vform.value.name.trim()) { toast('车辆名称必填', 'warn'); return }
  busy.value = true
  try {
    const r = await whApi.vehicleCreate({
      name: vform.value.name.trim(),
      plate: vform.value.plate, type: vform.value.type,
      driver: vform.value.driver, phone: vform.value.phone,
    })
    if (r && r.success === false) throw new Error('车辆创建失败')
    toast('车辆已保存')
    vform.value = { name: '', plate: '', type: '', driver: '', phone: '' }
    await loadRefs()
  } catch (e) {
    toast(e.message || '车辆保存失败', 'error')
  } finally {
    busy.value = false
  }
}

async function doCreateRoute () {
  if (!form.value.name.trim()) { toast('线路名称必填', 'warn'); return }
  if (!form.value.vehicle_id) { toast('必须先选车辆（没有车辆先在上面加一台）', 'warn'); return }
  if (!stops.value.length) { toast('至少要勾 1 个停靠点', 'warn'); return }
  busy.value = true
  try {
    const v = vehicles.value.find(x => Number(x.id) === Number(form.value.vehicle_id))
    const r = await whApi.routeCreate({
      name: form.value.name.trim(),
      vehicle_id: Number(form.value.vehicle_id),
      driver: form.value.driver || (v ? v.driver : ''),
      date: form.value.date,
      stops: stops.value.map(s => ({ name: s.name, address: s.address, order_ids: s.order_ids })),
      notes: '',
    })
    if (r && r.success === false) throw new Error('线路创建失败')
    toast(`线路已创建（${stops.value.length} 站）`)
    cancelCreate()
    showCreate.value = false
    await loadRows()
  } catch (e) {
    toast(e.message || '线路创建失败', 'error')
  } finally {
    busy.value = false
  }
}

async function doOptimize (r) {
  busy.value = true
  try {
    const res = await whApi.routeOptimize(r.id)
    /* 返回体**随分支变**：≤2 个点 → {optimized:false,message}；
       无坐标 → {optimized:true, method:'地址排序', stops}；有坐标 → 最近邻 + 新顺序。
       ⇒ 按**字段**判，不按形状判（否则第三种情况会被当成失败）。 */
    if (res && res.optimized === false) {
      toast(res.message || '无需优化', 'warn')
    } else {
      toast(res && res.method ? `已重排（${res.method}）` : '已重排')
      await loadRows()
    }
  } catch (e) {
    toast(e.message || '优化失败', 'error')
  } finally {
    busy.value = false
  }
}

async function doDeliver (r, s) {
  busy.value = true
  try {
    const res = await whApi.stopUpdate(s.id, 'delivered')
    if (res && res.success === false) throw new Error('停靠点更新失败')
    toast('已标记送达')
    await loadRows()
  } catch (e) {
    toast(e.message || '停靠点更新失败', 'error')
  } finally {
    busy.value = false
  }
}

/* 打开新建区时按当前日期拉一次候选单 —— 不提前拉，避免每进页面就多发一个请求 */
watch(() => showCreate.value, v => { if (v) loadTasks() })
watch(() => form.value.date, () => { if (showCreate.value) loadTasks() })

onMounted(loadAll)
</script>

<style scoped>
/* 页面私有类一律 `rts-` 前缀（仓配·线路设置），避免与兄弟页串味。 */
.rts-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.rts-date { width: 150px }

.rts-new { padding: 14px; margin-bottom: 12px }
.rts-new-hd { display: flex; align-items: center; gap: 6px; font-weight: 600; margin-bottom: 10px }
.rts-new-sub { font-size: 12px; color: var(--t3); font-weight: 400 }
.rts-new-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end }
.rts-fld { display: flex; flex-direction: column; gap: 4px; min-width: 150px }
.rts-fld-acts { margin-left: auto }
.rts-lb { font-size: 12px; color: var(--t2) }
.rts-req { color: var(--dan); font-weight: 400 }
.rts-new-acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px }

.rts-hint-empty { font-size: 12px; color: var(--t3); padding: 8px 0 }

.rts-pick { margin-top: 12px }
.rts-pick-hd { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 6px }
.rts-pick-list {
  display: flex; flex-direction: column; gap: 4px;
  max-height: 220px; overflow-y: auto; border: 1px solid var(--bd); border-radius: var(--radius-md); padding: 8px;
}
.rts-pick-item { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer }
.rts-pick-cust { font-weight: 500 }
.rts-pick-addr { font-size: 12px; color: var(--t3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }

.rts-stop-preview { margin-top: 10px; display: flex; flex-direction: column; gap: 4px }
.rts-stop-row {
  display: flex; align-items: center; gap: 8px; font-size: 13px;
  padding: 6px 8px; background: var(--bg2); border-radius: 6px;
}
.rts-stop-no { width: 20px; color: var(--t3) }
.rts-stop-name { font-weight: 500 }
.rts-stop-addr { font-size: 12px; color: var(--t3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }

.rts-list { display: flex; flex-direction: column; gap: 12px }
.rts-route { padding: 0; overflow: hidden }
.rts-route-hd {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 12px; border-bottom: 1px solid var(--bd); flex-wrap: wrap;
}
.rts-route-name { font-weight: 600; margin-right: 8px }
.rts-route-meta { display: flex; align-items: center; gap: 14px; font-size: 12px; color: var(--t2) }

.rts-tbl { table-layout: fixed }
.rts-mono { font-variant-numeric: tabular-nums }
.rts-addr { font-size: 12px; color: var(--t2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.rts-dim { color: var(--t3); font-size: 12px }

.rts-op {
  border: none; background: none; padding: 0; font-size: 13px;
  color: var(--p-dark); cursor: pointer; white-space: nowrap;
}
.rts-op:hover { text-decoration: underline }
.rts-op:disabled { color: var(--t3); cursor: not-allowed; text-decoration: none }
.rts-op-danger { border: none; background: none; padding: 0; font-size: 13px; color: var(--dan); cursor: pointer; margin-left: auto }

.rts-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 46px 20px; color: var(--t3); text-align: center;
}
.rts-empty p { margin: 0 }
.rts-empty-hint { font-size: 12px; color: var(--t3); line-height: 1.7; max-width: 560px }

.rts-foot { font-size: 12px; color: var(--t2); margin-top: 12px; line-height: 1.7 }
</style>
