<template>
  <div class="page">
    <div class="page-hd split">
      <div>
        <h2>告警规则</h2>
        <span class="page-sub">系统级监控规则：命中后记入下方「告警历史」 · 只有老板 / 管理员可改</span>
      </div>
      <div class="ar-acts">
        <button class="btn btn-primary btn-sm" :disabled="loading" @click="openCreate()">
          <Icon name="plus" :size="14" />新建规则
        </button>
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadAll()">
          <Icon name="refresh" :size="14" />刷新
        </button>
      </div>
    </div>

    <div v-if="err" class="state-error">
      <div class="se-ic"><Icon name="alert" :size="22" /></div>
      <p>{{ err }}</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="loadAll()">重试</button>
    </div>

    <Skeleton v-else-if="loading" />

    <template v-else>
      <!-- KPI 概览条 -->
      <div class="card kpi-strip">
        <div class="kpi">
          <div class="kpi-label">规则总数</div>
          <div class="kpi-val">{{ rules.length }}</div>
          <div class="kpi-sub">已配置</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">启用中</div>
          <div class="kpi-val val-ok">{{ activeCount }}</div>
          <div class="kpi-sub">正在评估</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">待处理告警</div>
          <div class="kpi-val" :class="pendingCount ? 'val-warn' : ''">{{ pendingCount }}</div>
          <div class="kpi-sub">{{ pendingCount ? '需确认或处理' : '暂无待处理' }}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">严重告警</div>
          <div class="kpi-val" :class="criticalCount ? 'val-warn' : ''">{{ criticalCount }}</div>
          <div class="kpi-sub">{{ criticalCount ? '需要尽快处理' : '无严重告警' }}</div>
        </div>
      </div>

      <!-- 规则列表 -->
      <div class="card ar-card">
        <div class="panel-hd">
          <b>监控规则</b>
          <span class="page-sub">
            {{ pushConfigured ? '命中后记入历史并推送企业微信' : '命中后记入下方历史（企业微信推送未配置）' }}
          </span>
        </div>

        <div v-if="!rules.length" class="ar-empty">
          <p class="ar-empty-note">还没有任何告警规则。</p>
          <p class="ar-empty-guide">
            点右上角「新建规则」加第一条：选一个监控指标、设好阈值与比较条件，
            以后每 5 分钟自动评估一次，命中就记一条历史。
          </p>
        </div>

        <div v-else class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>规则名称</th>
                <th>监控指标</th>
                <th>触发条件</th>
                <th>严重程度</th>
                <th>优先级</th>
                <th>状态</th>
                <th class="ar-op">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rules" :key="r.id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td class="ar-name">{{ r.name }}</td>
                <td>{{ metricLabel(r.metric) }}</td>
                <td class="ar-cond">{{ condText(r) }}</td>
                <td>
                  <span class="ar-badge" :class="sevClass(r.severity)">{{ sevLabel(r.severity) }}</span>
                </td>
                <td>{{ prioLabel(r.priority) }}</td>
                <td>
                  <span class="ar-badge" :class="r.is_active ? 'on' : 'off'">
                    {{ r.is_active ? '启用中' : '已停用' }}
                  </span>
                </td>
                <td class="ar-op">
                  <button class="btn-row-ic" title="编辑" @click="openEdit(r)"><Icon name="edit" :size="14" /></button>
                  <button class="btn-row-ic" :title="r.is_active ? '停用' : '启用'" @click="doToggle(r)">
                    <Icon :name="r.is_active ? 'bell-off' : 'bell'" :size="14" />
                  </button>
                  <button class="btn-row-ic danger" title="删除" @click="doRemove(r)"><Icon name="trash" :size="14" /></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 告警历史 -->
      <div class="card ar-card">
        <div class="panel-hd">
          <b>告警历史</b>
          <span class="page-sub">规则命中后自动记在这里 · 确认表示「我知道了」，解决表示「已处理完」</span>
        </div>

        <div v-if="!history.length" class="ar-empty">
          <p class="ar-empty-note">还没有触发过告警。</p>
          <p class="ar-empty-guide">这说明当前各项指标都在安全范围内 —— 不用管它，真出问题时这里会立刻出现记录。</p>
        </div>

        <div v-else class="table-wrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="seq-th">序号</th>
                <th>触发时间</th>
                <th>告警内容</th>
                <th>严重程度</th>
                <th>状态</th>
                <th class="ar-op">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(h, i) in history" :key="h.id">
                <td class="seq-cell"><span class="seq-num">{{ i + 1 }}</span></td>
                <td class="ar-time">{{ h.created_at || '—' }}</td>
                <td class="ar-msg">{{ histText(h) }}</td>
                <td>
                  <span class="ar-badge" :class="sevClass(h.severity)">{{ sevLabel(h.severity) }}</span>
                </td>
                <td>
                  <span class="ar-badge" :class="h.resolved ? 'on' : (h.acknowledged ? 'ok' : 'warn')">
                    {{ h.resolved ? '已解决' : (h.acknowledged ? '已确认' : '待处理') }}
                  </span>
                </td>
                <td class="ar-op">
                  <button v-if="!h.acknowledged && !h.resolved" class="btn btn-ghost btn-sm" @click="doAck(h)">确认</button>
                  <button v-if="!h.resolved" class="btn btn-ghost btn-sm" @click="doResolve(h)">标记已解决</button>
                  <span v-if="h.resolved" class="ar-muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- 新建 / 编辑弹窗（用共享 Modal.vue：Teleport + 页面级模态层级 + ESC + 焦点陷阱） -->
    <Modal :show="showForm" :title="editing ? '编辑告警规则' : '新建告警规则'" :width="520" @close="closeForm()">
      <div v-if="formErr" class="state-error ar-form-err"><p>{{ formErr }}</p></div>

      <label class="ar-fld">
        <span class="ar-lab">规则名称<span class="isn-req">*</span></span>
        <input v-model.trim="form.name" class="input" data-autofocus placeholder="如：数据库体积超限" />
      </label>

      <label class="ar-fld">
        <span class="ar-lab">监控指标<span class="isn-req">*</span></span>
        <select v-model="form.metric" class="input">
          <option v-for="m in metrics" :key="m.key" :value="m.key">{{ m.label }}（{{ m.unit }}）</option>
        </select>
      </label>

      <div class="ar-row">
        <label class="ar-fld">
          <span class="ar-lab">比较条件<span class="isn-req">*</span></span>
          <select v-model="form.condition" class="input">
            <option v-for="c in conditions" :key="c.key" :value="c.key">{{ c.label }}</option>
          </select>
        </label>
        <label class="ar-fld">
          <span class="ar-lab">阈值<span class="isn-req">*</span></span>
          <input v-model="form.threshold" class="input num" placeholder="如 1024" />
          <span class="ar-hint">单位：{{ currentUnit || '—' }}</span>
        </label>
      </div>

      <div class="ar-fld">
        <span class="ar-lab">严重程度</span>
        <div class="ar-chips">
          <button v-for="s in SEVERITIES" :key="s.key" type="button" class="ar-chip"
                  :class="{ on: form.severity === s.key }" @click="form.severity = s.key">{{ s.label }}</button>
        </div>
      </div>

      <div class="ar-fld">
        <span class="ar-lab">优先级</span>
        <div class="ar-chips">
          <button v-for="p in PRIORITIES" :key="p.value" type="button" class="ar-chip"
                  :class="{ on: form.priority === p.value }" @click="form.priority = p.value">{{ p.label }}</button>
        </div>
        <span class="ar-hint">数字越大越优先（当前 {{ form.priority }}）</span>
      </div>

      <label class="ar-fld">
        <label class="ar-chk"><input type="checkbox" v-model="form.is_active" /><span>启用这条规则（不勾则只留配置、不参与评估）</span></label>
      </label>

      <template #footer>
        <button class="btn btn-ghost btn-sm" :disabled="saving" @click="closeForm()">取消</button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="save()">
          <Icon name="save" :size="14" />{{ saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
/* 告警规则管理（P1-4，v633）—— 数据源：/api/alerts/*（后端 v88 告警管理 API）。
 *
 * 🔴 本页存在的理由：v88 那套告警引擎**端点在、db 函数不在**（`alert_rule_list/create/
 *    update/delete` 在仓库里根本没有定义 ⇒ 一调必 500），规则只能靠直写 SQL 播种、
 *    管理界面端到端不可用。本轮补齐数据层 + 端点守卫后，规则终于可以由界面维护。
 *
 * 🔴 权限：8 个端点**全部**挂后端 `_admin`（role∈admin/boss）⇒ 非管理岗即使拿到
 *    本页深链也拿不到数据（fail-closed）。前端**不另写一份角色判据** —— 那是第二份真相。
 *
 * 🔴 指标与比较条件**由后端下发**（`GET /api/alerts/metrics`，唯一源 = `alerting.ALERT_METRICS`）：
 *    本页**不硬编码**指标清单，否则后端加指标前端就得同步改（两处真相来源 = 迟早漂移）。
 *
 * 🔴 数字的单位跟着口径走：阈值与实际值都带上后端给的单位（MB / 元 / 个 / 批 / 次），
 *    比较条件显示中文（大于 / 小于 …），**不把 "gt"、"db_size_mb" 这类英文键露给用户**。
 */
import Skeleton from '../components/Skeleton.vue'
import Icon from '../components/Icon.vue'
import Modal from '../components/Modal.vue'
import { ref, computed, onMounted } from 'vue'
import { api } from '../api/client.js'
import { alertsApi } from '../api/modules.js'
import { toast, confirm } from '../store'
import { fmt, cleanNumText } from '../utils/forecast/format.js'

const loading = ref(true)
const err = ref('')
const rules = ref([])
const history = ref([])
const metrics = ref([])
const conditions = ref([])
const pushConfigured = ref(false)

const showForm = ref(false)
const editing = ref(null)          // null = 新建；对象 = 编辑
const saving = ref(false)
const formErr = ref('')

/* 严重程度：DB 里存英文键，界面一律中文。 */
const SEVERITIES = [
  { key: 'warning', label: '提醒' },
  { key: 'critical', label: '严重' },
  { key: 'info', label: '提示' },
]
/* 优先级：数字越大越优先。给老板的是「高 / 中 / 低」，存的是数字。 */
const PRIORITIES = [
  { value: 10, label: '高' },
  { value: 5, label: '中' },
  { value: 1, label: '低' },
]

const emptyForm = () => ({
  name: '', metric: '', condition: 'gt', threshold: '',
  severity: 'warning', priority: 5, is_active: 1,
})
const form = ref(emptyForm())

const activeCount = computed(() => rules.value.filter(r => r.is_active).length)
const pendingCount = computed(() => history.value.filter(h => !h.resolved && !h.acknowledged).length)
const criticalCount = computed(() => history.value.filter(h => !h.resolved && h.severity === 'critical').length)

/* ---- 展示辅助（全部中文 + 带单位） ---- */
function metricLabel (key) {
  const m = metrics.value.find(x => x.key === key)
  return m ? m.label : '未知指标'
}
function metricUnit (key) {
  const m = metrics.value.find(x => x.key === key)
  return m ? m.unit : ''
}
function condLabel (key) {
  const c = conditions.value.find(x => x.key === key)
  return c ? c.label : '超出设定值'
}
function currentUnit () { return metricUnit(form.value.metric) }

function sevLabel (s) {
  const hit = SEVERITIES.find(x => x.key === s)
  return hit ? hit.label : '提醒'
}
function sevClass (s) {
  if (s === 'critical') return 'crit'
  if (s === 'info') return 'info'
  return 'warn'
}
function prioLabel (p) {
  const hit = PRIORITIES.find(x => x.value === Number(p))
  return hit ? hit.label + '（' + p + '）' : String(p)
}
function condText (r) {
  return condLabel(r.rule_condition) + ' ' + fmt(r.threshold) + ' ' + metricUnit(r.metric)
}
/* 历史行的 `message` 是机器串（内含英文指标键与英文条件）⇒ 界面自己拼中文句子 */
function histText (h) {
  const rule = rules.value.find(r => r.id === h.rule_id)
  const name = rule ? rule.name : '（规则已删除）'
  const unit = metricUnit(h.metric)
  return name + '：' + metricLabel(h.metric) + ' ' + condLabel(rule ? rule.rule_condition : 'gt')
    + ' ' + fmt(h.threshold) + ' ' + unit + '（实际 ' + fmt(h.current_value) + ' ' + unit + '）'
}

/* ---- 数据 ---- */
async function loadAll () {
  loading.value = true
  err.value = ''
  try {
    // 🔴 指标目录必须一起成功：它缺失 ⇒ 界面只能显示英文键 ⇒ 宁可整页报错也不给半懂不懂的界面
    const cat = await alertsApi.metrics()
    metrics.value = (cat && cat.metrics) || []
    conditions.value = (cat && cat.conditions) || []
    if (!metrics.value.length) throw new Error('监控指标目录为空，请稍后重试')
    const rs = await alertsApi.rules()
    rules.value = Array.isArray(rs) ? rs : []
    const hs = await alertsApi.history(50)
    history.value = Array.isArray(hs) ? hs : []
    try {
      const st = await api('/api/notify/wecom/status')
      pushConfigured.value = !!(st && st.configured)
    } catch (_) { pushConfigured.value = false }
  } catch (e) {
    err.value = (e && e.message) || '告警规则读取失败'
    rules.value = []
    history.value = []
  } finally {
    loading.value = false
  }
}

function openCreate () {
  editing.value = null
  form.value = emptyForm()
  if (metrics.value.length) form.value.metric = metrics.value[0].key
  formErr.value = ''
  showForm.value = true
}
function openEdit (r) {
  editing.value = r
  form.value = {
    name: r.name || '', metric: r.metric || '', condition: r.rule_condition || 'gt',
    threshold: r.threshold == null ? '' : String(r.threshold),
    severity: r.severity || 'warning', priority: Number(r.priority || 0), is_active: r.is_active ? 1 : 0,
  }
  formErr.value = ''
  showForm.value = true
}
function closeForm () { showForm.value = false; editing.value = null }

function validate () {
  const f = form.value
  if (!f.name) return '请填写规则名称'
  if (!f.metric) return '请选择监控指标'
  if (!f.condition) return '请选择比较条件'
  const t = Number(cleanNumText(f.threshold))
  if (f.threshold === '' || f.threshold == null || Number.isNaN(t)) return '请填写阈值（填数字）'
  return ''
}

async function save () {
  const v = validate()
  if (v) { formErr.value = v; return }
  saving.value = true
  formErr.value = ''
  try {
    const payload = {
      name: form.value.name,
      metric: form.value.metric,
      condition: form.value.condition,
      threshold: Number(cleanNumText(form.value.threshold)),
      severity: form.value.severity,
      priority: Number(form.value.priority) || 0,
      is_active: form.value.is_active ? 1 : 0,
    }
    if (editing.value) await alertsApi.update(editing.value.id, payload)
    else await alertsApi.create(payload)
    toast(editing.value ? '规则已更新' : '规则已创建', 'ok')
    closeForm()
    await loadAll()
  } catch (e) {
    formErr.value = (e && e.message) || '保存失败'
  } finally {
    saving.value = false
  }
}

async function doToggle (r) {
  try {
    await alertsApi.update(r.id, { is_active: r.is_active ? 0 : 1 })
    toast(r.is_active ? '已停用' : '已启用', 'ok')
    await loadAll()
  } catch (e) {
    toast((e && e.message) || '启停失败', 'err')
  }
}

async function doRemove (r) {
  const ok = await confirm('确定删除规则「' + (r.name || '') + '」？已产生的告警历史会保留。')
  if (!ok) return
  try {
    await alertsApi.remove(r.id)
    toast('已删除', 'ok')
    await loadAll()
  } catch (e) {
    toast((e && e.message) || '删除失败', 'err')
  }
}

async function doAck (h) {
  try {
    await alertsApi.acknowledge(h.id)
    toast('已确认', 'ok')
    await loadAll()
  } catch (e) {
    toast((e && e.message) || '确认失败', 'err')
  }
}

async function doResolve (h) {
  try {
    await alertsApi.resolve(h.id)
    toast('已标记为解决', 'ok')
    await loadAll()
  } catch (e) {
    toast((e && e.message) || '操作失败', 'err')
  }
}

onMounted(loadAll)
</script>

<style scoped>
/* 页面私有类一律 `ar-` 前缀；全局件（.page/.page-hd/.card/.kpi-strip/.kpi/.panel-hd/.table-wrap/
   .tbl/.seq-th/.seq-cell/.seq-num/.btn-row-ic/.input/.num/.state-error/.se-ic/.btn/.btn-sm/
   .btn-primary/.btn-ghost）一律复用，不重定义。 */
.ar-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
.ar-card { margin-top: 14px }
.ar-op { white-space: nowrap; text-align: right }
.ar-name { max-width: 240px }
/* 🔴 flex 行里可能超长的文本必须 min-width:0，否则长规则名会把整列撑爆（v629 纪律） */
.ar-cond, .ar-msg { min-width: 0; word-break: break-word }
.ar-time { white-space: nowrap; color: var(--t2) }
.ar-muted { color: var(--t3); font-size: 12px }
.ar-badge { display: inline-block; padding: 1px 9px; border-radius: 9px; font-size: 12px; font-weight: 400; white-space: nowrap }
.ar-badge.on { background: var(--ok-green-bg); color: var(--ok) }
.ar-badge.ok { background: var(--ok-green-bg); color: var(--ok) }
.ar-badge.off { background: var(--bg2); color: var(--t3) }
.ar-badge.warn { background: rgba(255, 149, 0, .14); color: #b26a00 }
.ar-badge.crit { background: rgba(255, 59, 48, .12); color: var(--dan) }
.ar-badge.info { background: var(--bg2); color: var(--t2) }
.ar-empty { padding: 28px 4px }
.ar-empty-note { font-size: 13px; color: var(--t2); margin: 0 }
.ar-empty-guide { font-size: 12px; color: var(--t1); margin: 8px 0 0; line-height: 1.8 }

/* 弹窗内表单 */
.ar-form-err { padding: 8px 10px; margin-bottom: 12px }
.ar-fld { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px }
.ar-lab { font-size: 12px; color: var(--t2) }
.isn-req { color: var(--dan); margin-left: 2px }
.ar-hint { font-size: 11.5px; color: var(--t3) }
.ar-row { display: flex; gap: 12px }
.ar-row .ar-fld { flex: 1; min-width: 0 }
.ar-chips { display: flex; flex-wrap: wrap; gap: 8px }
.ar-chip { padding: 5px 12px; border: 1px solid var(--bd); border-radius: 16px; background: var(--bg2); color: var(--t2); font-size: 12px; cursor: pointer; transition: all .15s }
.ar-chip:hover { border-color: var(--p-dark); color: var(--p-dark) }
.ar-chip.on { background: var(--p-bg); border-color: var(--p-dark); color: var(--p-dark); font-weight: 500 }
.ar-chk { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12.5px; color: var(--t1) }
.ar-chk input { accent-color: var(--p) }
</style>
