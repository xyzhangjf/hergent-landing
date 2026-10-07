<template>
  <div class="rs">
    <!-- 说明 + 操作。口径来自 2026-10-04 用户原话，逐字对齐 —— 这是业务人唯一能自证对错的那句话。 -->
    <div class="rs-bar">
      <p class="rs-tip">
        返利结算<b>按月</b>走：<b>本月提交上月的核销资料，本月上账</b>。不同厂家节奏不一样 ——
        在这里给每个品牌配好，上面那条「本月结算日历」就会按你配的日子，告诉你这个月该做什么。
      </p>
      <div class="rs-bar-acts">
        <button class="btn btn-ghost" :disabled="loading" @click="load">刷新</button>
        <button v-if="canDoWrite" class="btn btn-primary" @click="openForm(null)">新增结算节奏</button>
      </div>
    </div>

    <!-- 本月结算日历：配置的**真实消费者**。没有它，本页就只是"填了没人看"的假配置。 -->
    <div v-if="calendar.length" class="card rs-cal">
      <div class="rs-cal-hd">
        <b>本月结算日历</b>
        <span class="rs-ym">{{ ymText }}</span>
      </div>
      <div class="rs-cal-rows">
        <div v-for="a in calendar" :key="a.schedule_id" class="rs-cal-row">
          <span class="rs-cal-brand">{{ a.scope_name }}</span>
          <span class="rs-cal-txt">
            <template v-if="a.need_doc">
              <b :class="{ bad: a.submit_overdue }">{{ dayNum(a.submit_due) }} 号前</b>
              提交 <b>{{ coverText(a.submit_cover) }}</b> 的核销资料
              <span class="rs-rest" :class="{ bad: a.submit_overdue }">{{ dueWords(a.submit_days) }}</span>
              <span class="rs-sep">·</span>
            </template>
            <template v-else>
              <span class="rs-nodoc">（无需提交核销资料）</span>
              <span class="rs-sep">·</span>
            </template>
            <b :class="{ bad: a.post_overdue }">{{ dayNum(a.post_due) }} 号</b>
            上账 <b>{{ coverText(a.post_cover) }}</b> 核销的返利
            <span class="rs-rest" :class="{ bad: a.post_overdue }">{{ dueWords(a.post_days) }}</span>
          </span>
        </div>
      </div>
      <p class="rs-cal-note">
        「核销」= 厂家确认的达成量；「上账」= 这笔返利进账的日子。日期按下面配置的节奏自动推算。
      </p>
    </div>
    <div v-else-if="!loading && items.length" class="card rs-cal rs-cal-off">
      <p class="rs-tip">本月结算日历暂无内容 —— 已配置的节奏都被停用了。</p>
    </div>

    <div v-if="loading && !loaded" class="rs-skel">
      <div class="skel-line" style="width:55%"></div>
      <div class="skel-line" style="width:78%;margin-top:8px"></div>
    </div>

    <div v-else-if="!items.length" class="state-empty">
      <p>还没有配置任何结算节奏。</p>
      <p class="rs-empty-sub">
        结算节奏 = 每个月「几号前交上月的核销资料」「几号上账」。<br>
        通常先配一条<b>默认</b>的（所有品牌都用它），个别厂家节奏不同再单独添加。
      </p>
      <button v-if="canDoWrite" class="btn btn-primary btn-sm" style="display:block;margin:12px auto 0" @click="openForm(null)">
        配第一条结算节奏
      </button>
    </div>

    <div v-else class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th>作用对象</th><th>结算周期</th><th>核销资料</th>
            <th>提交截止</th><th>上账</th><th>状态</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="it in items" :key="it.id" :class="{ 'rs-faded': !it.is_active }">
            <td>
              {{ it.scope_name || '—' }}
              <span v-if="it.scope_type === 'all'" class="rs-def">兜底</span>
            </td>
            <td>{{ it.cycle_label }}</td>
            <td>
              <span v-if="it.need_doc">{{ offsetText(it.submit_offset) }}</span>
              <span v-else class="rs-muted">不需要</span>
            </td>
            <td>
              <span v-if="it.need_doc">每月 {{ it.submit_day }} 号前</span>
              <span v-else class="rs-muted">—</span>
            </td>
            <td>{{ offsetText(it.post_offset) }} {{ it.post_day }} 号</td>
            <td>
              <span class="rs-st" :class="it.is_active ? 'on' : 'off'">{{ it.is_active ? '生效中' : '已停用' }}</span>
            </td>
            <td class="rs-acts">
              <button v-if="canDoUpdate" class="btn-mini" @click="openForm(it)">编辑</button>
              <button v-if="canDoUpdate" class="btn-mini" @click="toggleActive(it)">{{ it.is_active ? '停用' : '启用' }}</button>
              <button v-if="canDoDelete" class="btn-mini btn-danger" @click="removeOne(it)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="items.some(i => i.note)" class="rs-notes">
        <span v-for="i in items.filter(x => x.note)" :key="'n' + i.id" class="rs-note">
          <b>{{ i.scope_name }}</b>：{{ i.note }}
        </span>
      </p>
    </div>

    <!-- 新增 / 编辑弹窗 -->
    <Teleport to="body">
      <Transition name="fade"><div v-if="formOpen" class="rs-overlay" @click="formOpen = false"></div></Transition>
      <Transition name="pop">
        <div v-if="formOpen" class="rs-modal">
          <div class="rs-modal-hd">
            <b>{{ form.id ? '编辑结算节奏' : '新增结算节奏' }}</b>
            <button class="rs-x" @click="formOpen = false"><Icon name="close"/></button>
          </div>
          <div class="rs-modal-body">
            <div class="rs-grid">
              <label class="rs-fld rs-wide">
                <span>作用对象</span>
                <select v-model="form.scope" class="input">
                  <option value="__all__">默认（所有未单独配置的品牌）</option>
                  <option v-for="b in brandOptions" :key="b" :value="b">{{ b }}</option>
                </select>
              </label>

              <label class="rs-fld">
                <span>结算周期</span>
                <select v-model="form.cycle" class="input">
                  <option value="month">按月</option>
                  <option value="quarter">按季</option>
                  <option value="year">按年</option>
                </select>
              </label>

              <label class="rs-fld">
                <span>要提交核销资料吗</span>
                <select v-model="form.need_doc" class="input">
                  <option :value="1">要提交</option>
                  <option :value="0">不用提交（厂家直接上账）</option>
                </select>
              </label>

              <template v-if="form.need_doc === 1">
                <label class="rs-fld">
                  <span>提交的是哪个月的核销资料</span>
                  <select v-model.number="form.submit_offset" class="input">
                    <option :value="1">上月</option>
                    <option :value="0">本月</option>
                    <option :value="2">上上月</option>
                  </select>
                </label>
                <label class="rs-fld">
                  <span>每月几号前交齐</span>
                  <input v-model.number="form.submit_day" class="input" type="number" min="1" max="31" step="1">
                </label>
              </template>

              <label class="rs-fld">
                <span>上账的是哪个月</span>
                <select v-model.number="form.post_offset" class="input">
                  <option :value="0">提交的当月</option>
                  <option :value="1">提交的次月</option>
                </select>
              </label>
              <label class="rs-fld">
                <span>每月几号上账</span>
                <input v-model.number="form.post_day" class="input" type="number" min="1" max="31" step="1">
              </label>

              <label class="rs-fld rs-wide">
                <span>备注（可选）</span>
                <input v-model="form.note" class="input" placeholder="如：蒙牛低温走这个节奏，需附对账单">
              </label>
            </div>

            <!-- 实时预览：让用户**当场自证**配对了，而不是保存后到别处才发现配反 -->
            <div class="rs-preview">
              <span class="rs-pv-lbl">按上面配置，每个月是这样：</span>
              <span class="rs-pv-txt">{{ previewText }}</span>
            </div>
            <p class="rs-form-tip">
              没填过的地方用系统建议值起步（上月／5 号／当月／20 号），都可以改。
              若某月没有你填的日期（比如 2 月没有 31 号），按该月最后一天算。
            </p>
          </div>
          <div class="rs-modal-ft">
            <button class="btn btn-ghost" @click="formOpen = false">取消</button>
            <button class="btn btn-primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import Icon from '../Icon.vue'
import { toast, canDo } from '../../store'
import { rebateSettlementApi } from '../../api/modules'
import { api } from '../../api/client.js'

const items = ref([])
const calendar = ref([])
const brandOptions = ref([])
const loading = ref(false)
const loaded = ref(false)
const saving = ref(false)
const formOpen = ref(false)

/* 门禁用的模块是**接口的模块**（`/api/rebate-settlement` 归 `sales`），不是页面的模块 ——
   写错模块键会让整块按钮消失（fail-closed），见 store/index.js 上方那段。 */
const canDoWrite = computed(() => canDo('sales', 'create'))
const canDoUpdate = computed(() => canDo('sales', 'update'))
const canDoDelete = computed(() => canDo('sales', 'delete'))

function curYm() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const ym = ref(curYm())
const ymText = computed(() => {
  const [y, m] = ym.value.split('-')
  return `${y} 年 ${Number(m)} 月`
})

const EMPTY = {
  id: 0, scope: '__all__', cycle: 'month',
  submit_offset: 1, submit_day: 5, post_offset: 0, post_day: 20,
  need_doc: 1, note: '', is_active: 1,
}
const form = ref({ ...EMPTY })

/* 「上上月」这类词是给业务人看的，**不渲染内部数字**（submit_offset=1 不直接出现在界面）。 */
const OFFSET_TEXT = { 0: '本月', 1: '上月', 2: '上上月' }
function offsetText(n) { return OFFSET_TEXT[Number(n)] || '上月' }

function dayNum(ds) {
  const n = parseInt(String(ds || '').slice(8, 10), 10)
  return Number.isFinite(n) ? n : '—'
}
function coverText(m) {
  const s = String(m || '')
  if (s.length < 7) return '—'
  const y = s.slice(0, 4), mo = Number(s.slice(5, 7))
  return Number(y) === new Date().getFullYear() ? `${mo} 月` : `${y} 年 ${mo} 月`
}
function dueWords(n) {
  if (n === null || n === undefined) return ''
  if (n > 0) return `还剩 ${n} 天`
  if (n === 0) return '就是今天'
  return `已过 ${-n} 天`
}

/* 弹窗里的实时预览句 —— 与后端 `_month_action().sentence` 同一套口径，
   但这里必须**跟着表单实时变**（后端那句要保存后才拿得到）⇒ 前端按同一规则拼。 */
const previewText = computed(() => {
  const f = form.value
  const cyc = { month: '按月', quarter: '按季', year: '按年' }[f.cycle] || '按月'
  const postAt = Number(f.post_offset) === 0 ? '当月' : '次月'
  if (Number(f.need_doc) === 1) {
    return `${cyc}结算：每月 ${f.submit_day} 号前提交${offsetText(f.submit_offset)}的核销资料，`
      + `每月 ${f.post_day} 号上账（上账的是${offsetText(Number(f.submit_offset) + Number(f.post_offset))}核销的返利，`
      + `即提交的${postAt}）。`
  }
  return `${cyc}结算：不用交核销资料，每月 ${f.post_day} 号直接上账`
})

async function loadBrands() {
  try {
    const r = await api('/api/brands?include_inactive=1')
    const arr = Array.isArray(r) ? r : (r.items || r.data || [])
    brandOptions.value = arr.map(b => String(b.name || '')).filter(Boolean)
  } catch (e) { /* 品牌加载失败不阻断页面：作用对象仍可选"默认" */ }
}

async function load() {
  loading.value = true
  try {
    const d = await rebateSettlementApi.list(ym.value)
    items.value = (d && d.items) || []
    calendar.value = (d && d.calendar) || []
    loaded.value = true
  } catch (e) {
    items.value = []
    calendar.value = []
    if (e && e.message) toast('结算节奏加载失败：' + e.message, 'err')
  } finally {
    loading.value = false
  }
}

function openForm(it) {
  form.value = it
    ? {
        id: it.id,
        scope: it.scope_type === 'all' ? '__all__' : (it.scope_key || ''),
        cycle: it.cycle || 'month',
        submit_offset: Number(it.submit_offset ?? 1),
        submit_day: Number(it.submit_day ?? 5),
        post_offset: Number(it.post_offset ?? 0),
        post_day: Number(it.post_day ?? 20),
        need_doc: Number(it.need_doc ?? 1),
        note: it.note || '',
        is_active: Number(it.is_active ?? 1),
      }
    : { ...EMPTY }
  formOpen.value = true
}

function payload() {
  const f = form.value
  const isAll = f.scope === '__all__'
  return {
    id: f.id || 0,
    scope_type: isAll ? 'all' : 'brand',
    scope_key: isAll ? '' : f.scope,
    scope_name: isAll ? '' : f.scope,
    cycle: f.cycle,
    submit_offset: Number(f.submit_offset || 0),
    submit_day: Number(f.submit_day || 1),
    post_offset: Number(f.post_offset || 0),
    post_day: Number(f.post_day || 1),
    need_doc: Number(f.need_doc) === 1 ? 1 : 0,
    note: f.note || '',
    is_active: Number(f.is_active ?? 1),
  }
}

function _day(v, label) {
  const n = Number(String(v == null ? '' : v).replace(/[，,、\s]/g, ''))
  if (!Number.isFinite(n) || n < 1 || n > 31) { toast(`${label}请填 1 到 31 之间的整数`, 'err'); return null }
  return Math.trunc(n)
}

async function save() {
  const p = payload()
  if (p.need_doc === 1) {
    const sd = _day(p.submit_day, '核销资料提交日')
    if (sd === null) return
    p.submit_day = sd
  }
  const pd = _day(p.post_day, '上账日')
  if (pd === null) return
  p.post_day = pd
  saving.value = true
  try {
    if (p.id) await rebateSettlementApi.update(p.id, p)
    else await rebateSettlementApi.create(p)
    toast('已保存', 'ok')
    formOpen.value = false
    await load()
  } catch (e) {
    toast(e.message || '保存失败', 'err')
  } finally {
    saving.value = false
  }
}

async function toggleActive(it) {
  try {
    await rebateSettlementApi.update(it.id, {
      scope_type: it.scope_type, scope_key: it.scope_key, scope_name: it.scope_name,
      cycle: it.cycle, submit_offset: it.submit_offset, submit_day: it.submit_day,
      post_offset: it.post_offset, post_day: it.post_day,
      need_doc: it.need_doc, note: it.note, is_active: it.is_active ? 0 : 1,
    })
    toast(it.is_active ? '已停用' : '已启用', 'ok')
    await load()
  } catch (e) {
    toast(e.message || '操作失败', 'err')
  }
}

async function removeOne(it) {
  const name = it.scope_type === 'all' ? '默认（所有未单独配置的品牌）' : it.scope_name
  if (!window.confirm(`删除这条结算节奏？\n\n作用对象：${name}\n删除后该品牌的结算日历会改用「默认」那条（若无默认则不显示）。`)) return
  try {
    await rebateSettlementApi.remove(it.id)
    toast('已删除', 'ok')
    await load()
  } catch (e) {
    toast(e.message || '删除失败', 'err')
  }
}

onMounted(() => { loadBrands(); load() })
</script>

<style scoped>
.rs{display:flex;flex-direction:column;gap:14px}
.rs-bar{display:flex;align-items:flex-start;gap:14px}
.rs-tip{font-size:12.5px;color:var(--t2);line-height:1.8;margin:0;flex:1}
.rs-bar-acts{display:flex;gap:8px;flex-shrink:0}
.rs-skel{padding:8px 0}
.rs-empty-sub{font-size:12.5px;color:var(--t3);max-width:600px;margin:6px auto 0;line-height:1.8}

.rs-cal{padding:14px 16px}
.rs-cal-off{background:var(--bg2)}
.rs-cal-hd{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px}
.rs-cal-hd b{font-size:14px}
.rs-ym{font-size:12px;color:var(--t3);font-variant-numeric:tabular-nums}
.rs-cal-rows{display:flex;flex-direction:column;gap:8px}
.rs-cal-row{display:flex;gap:12px;align-items:flex-start;padding:8px 10px;border-radius:10px;background:var(--bg2)}
.rs-cal-brand{flex-shrink:0;min-width:96px;font-size:12.5px;font-weight:600;color:var(--t1,#1f2328)}
.rs-cal-txt{font-size:12.5px;color:var(--t2);line-height:1.75}
.rs-cal-txt b{color:var(--t1,#1f2328);font-variant-numeric:tabular-nums}
.rs-cal-txt b.bad,.rs-rest.bad{color:var(--err-red,#d9534f)}
.rs-rest{margin-left:2px;color:var(--t3);font-size:12px}
.rs-sep{margin:0 6px;color:var(--t3)}
.rs-nodoc{color:var(--t3)}
.rs-cal-note{margin:10px 0 0;font-size:11.5px;color:var(--t3);line-height:1.7}

.rs-faded td{opacity:.6}
.rs-def{display:inline-block;margin-left:6px;padding:0 6px;border-radius:6px;font-size:11px;background:var(--p-bg);color:var(--p-dark)}
.rs-muted{color:var(--t3)}
.rs-st{display:inline-block;padding:1px 8px;border-radius:8px;font-size:11.5px;white-space:nowrap}
.rs-st.on{background:var(--ok-green-bg);color:var(--ok-green)}
.rs-st.off{background:var(--bg2);color:var(--t3)}
.rs-acts{white-space:nowrap;text-align:right}
.rs-notes{margin:10px 2px 0;display:flex;flex-direction:column;gap:3px}
.rs-note{font-size:11.5px;color:var(--t3);line-height:1.6}

.rs-overlay{position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:900}
.rs-modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:901;
  width:min(680px,92vw);max-height:88vh;overflow:auto;background:var(--bg);border-radius:16px;
  box-shadow:0 20px 60px rgba(0,0,0,.28);display:flex;flex-direction:column}
.rs-modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle)}
.rs-x{border:none;background:none;cursor:pointer;color:var(--t2);display:flex}
.rs-modal-body{padding:18px 20px}
.rs-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.rs-fld{display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--t2)}
.rs-fld .input{height:34px;font-size:13px}
.rs-wide{grid-column:1/-1}
.rs-preview{margin-top:14px;padding:10px 12px;border-radius:10px;background:var(--p-bg);display:flex;flex-direction:column;gap:4px}
.rs-pv-lbl{font-size:11.5px;color:var(--t3)}
.rs-pv-txt{font-size:13px;color:var(--p-dark);line-height:1.7}
.rs-form-tip{font-size:11.5px;color:var(--t3);margin:10px 0 0;line-height:1.7}
.rs-modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle)}
.fade-enter-active,.fade-leave-active{transition:opacity .16s ease}
.fade-enter-from,.fade-leave-to{opacity:0}
.pop-enter-active,.pop-leave-active{transition:opacity .16s ease,transform .16s ease}
.pop-enter-from,.pop-leave-to{opacity:0;transform:translate(-50%,-46%) scale(.97)}
@media (max-width:900px){
  .rs-grid{grid-template-columns:1fr}
  .rs-bar{flex-direction:column}
  .rs-cal-row{flex-direction:column;gap:4px}
}
</style>
