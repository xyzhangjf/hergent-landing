<template>
  <!-- v242 报单自动化 —— 从「创建品牌目标」弹窗的 ③ 区迁来（报单配置页）。
       折叠头**不展开也能看到**当前状态与下次动作（验收 A7）。 -->
  <div class="card ap-card">
    <div class="ap-hd" @click="open = !open">
      <b>报单自动化</b>
      <span class="ap-sub">到点自动建表 / 到点自动关单 —— 按品牌方的报单节奏走</span>
      <span class="ap-chip" :class="form.enabled ? 'on' : 'off'">{{ form.enabled ? '自动' : '手动' }}</span>
      <span v-if="form.enabled && state.brand" class="ap-meta">基准「{{ state.brand }}」</span>
      <span v-if="live" class="ap-meta ap-strong">{{ live }}</span>
      <span v-if="!form.enabled && state.occupied_by" class="ap-warnchip">已被「{{ state.occupied_by }}」占用</span>
      <span class="ap-toggle">{{ open ? '收起' : '展开' }}</span>
    </div>

    <div v-if="open" class="ap-body">
      <p class="ap-tip">
        报单是<b>按品牌方排产节点</b>走的：<b>只能提前、不能延后</b>。开启后系统在「开放填报」时刻
        自动建表、「自动关单」时刻自动关单；中间到「厂家下单截止」这段留给经理改单、你付款 ——
        系统只在该时点提醒，<b>不会替你去厂家系统下单</b>。全系统<b>同一时间只能有一个品牌</b>开启自动建表。
      </p>

      <div class="ap-grid">
        <div class="field">
          <label>模式</label>
          <div class="seg">
            <button type="button" :class="['seg-btn', !form.enabled ? 'on' : '']" :disabled="busy" @click="setEnabled(0)">手动建表</button>
            <button type="button" :class="['seg-btn', form.enabled ? 'on' : '']" :disabled="busy" @click="setEnabled(1)">自动建表</button>
          </div>
        </div>
        <div class="field">
          <label>以哪个品牌的报单节奏为准<span class="ap-hint">决定哪天开、哪天关</span></label>
          <select v-model.number="form.rule_id" class="ap-sel" :disabled="busy">
            <option :value="0">请选择…</option>
            <option v-for="c in state.candidates" :key="c.rule_id" :value="c.rule_id">
              {{ c.brand }}（首次报单日 {{ c.order_first_date }}）
            </option>
          </select>
        </div>
        <div class="field">
          <label>开放填报<span class="ap-hint">报单日前一天</span></label>
          <input v-model="form.auto_open_time" type="time" class="ap-in" :disabled="!form.enabled || busy">
        </div>
        <div class="field">
          <label>自动关单<span class="ap-hint">报单日当天</span></label>
          <input v-model="form.auto_close_time" type="time" class="ap-in" :disabled="!form.enabled || busy">
        </div>
        <div class="field">
          <label>厂家下单截止<span class="ap-hint">须晚于自动关单</span></label>
          <input v-model="form.supplier_deadline_time" type="time" class="ap-in" :disabled="!form.enabled || busy">
        </div>
      </div>

      <!-- 只读节奏镜像 + 「改节奏」直达入口。
           v242b（用户反馈「只能选、没有把手」）：节奏仍以品牌页为**唯一真相源**，
           但这里给出直达该品牌表单的深链，不必自己回想「该去哪改」。 -->
      <div v-if="!state.candidates.length" class="ap-mirror ap-mirror-warn">
        还没有品牌配好「报单节奏」—— 报单自动化是「按品牌方的排产节点开表 / 关表」，
        必须先有一个品牌填好「首次报单日 + 周期或星期」。
        <a class="ap-edit" href="#/rebate">去「目标与返利」创建品牌目标 →</a>
      </div>
      <div v-else-if="cadenceText" class="ap-mirror">基准「{{ editBrand }}」的报单节奏：{{ cadenceText }}<a class="ap-edit" :href="editHref">改「{{ editBrand }}」的报单节奏 →</a></div>
      <div v-else class="ap-mirror ap-mirror-warn">
        所选品牌还没填「首次报单日」—— 它是「哪天开表 / 哪天关单」的基准，没有它无法自动开表。
        <a class="ap-edit" :href="editHref">去配「{{ editBrand }}」的节奏 →</a>
      </div>

      <div v-for="(w, i) in (state.warnings || [])" :key="i" class="ap-warn">⚠ {{ w }}</div>

      <div v-if="state.preview && state.preview.length" class="ap-prev">
        <div class="ap-prev-hd">
          <span>未来 {{ state.preview.length }} 期</span>
          <span v-if="live" class="ap-strong">{{ live }}</span>
        </div>
        <table class="ap-tbl">
          <thead><tr><th>报单日</th><th>开放 → 关单</th><th>到货</th><th>本期应报</th></tr></thead>
          <tbody>
            <tr v-for="p in state.preview" :key="p.order_date">
              <td>{{ p.order_date }}</td>
              <td class="ap-dim">{{ p.open_date }} {{ times.open }} → {{ p.close_date }} {{ times.close }}</td>
              <td>{{ p.arrival_date }}</td>
              <td>
                <span v-for="b in p.brand_detail" :key="b.name" class="ap-brand">{{ b.name }}<i v-if="b.early_days"> 提前{{ b.early_days }}天</i></span>
                <span v-if="!p.brand_detail.length" class="ap-dim">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="ap-mirror ap-mirror-warn">
        暂无可编排的期次：需要有品牌配好「报单节奏」（首次报单日 + 周期/星期）。
      </div>

      <div class="ap-actions">
        <button class="btn btn-primary" :disabled="busy || !dirty" @click="save">
          {{ busy ? '保存中…' : '保存' }}
        </button>
        <span v-if="state.dry_run" class="ap-warnchip">演练中：只记日志，不实际建表/关单</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { autoPeriodApi } from '../../api/modules'
import { toast } from '../../store'

const open = ref(true)
const busy = ref(false)
const state = reactive({
  enabled: 0, rule_id: 0, brand: '', occupied_by: '',
  times: { open: '20:00', close: '10:00', supplier: '12:00' },
  cadence: null, candidates: [], next: null, preview: [], warnings: [], dry_run: 0,
})
const form = reactive({
  enabled: 0, rule_id: 0,
  auto_open_time: '20:00', auto_close_time: '10:00', supplier_deadline_time: '12:00',
})

const times = computed(() => state.times || {})
const dirty = computed(() => {
  if ((state.enabled ? 1 : 0) !== form.enabled) return true
  if (!form.enabled) return false
  return state.rule_id !== form.rule_id
    || times.value.open !== form.auto_open_time
    || times.value.close !== form.auto_close_time
    || times.value.supplier !== form.supplier_deadline_time
})
const live = computed(() => {
  const n = state.next
  if (!n || !form.enabled) return ''
  return n.window_open ? `填报中 · 下次关单 ${n.close_at}` : `下次开表 ${n.open_at}`
})
function fmtCadence(c) {
  if (!c || !String(c.order_first_date || '').trim()) return ''
  const wd = String(c.order_weekdays || '').split(',').filter(Boolean).join('、')
  const mode = c.order_mode === 'weekday' ? (wd ? `每周${wd}` : '按固定星期（未选）')
                                          : `每 ${c.order_cadence_days || 0} 天`
  return `${mode} · 首次报单日 ${c.order_first_date} · 到货 +${c.order_lead_days || 0} 天`
}
/* 当前被「指」的那条品牌规则：优先用户选的，其次当前承载者，再次唯一候选。
   用它同时驱动：节奏镜像文案 + 「改节奏」深链。 */
const selCand = computed(() => {
  const id = form.rule_id || state.rule_id
    || (state.candidates[0] ? state.candidates[0].rule_id : 0)
  return (state.candidates || []).find(c => c.rule_id === id) || null
})
const editBrand = computed(() => (selCand.value && selCand.value.brand) || state.brand || '')
const editHref = computed(() => selCand.value
  ? `#/rebate?edit_rule=${selCand.value.rule_id}` : '#/rebate')
const cadenceText = computed(() => fmtCadence(selCand.value))

function apply(d) {
  if (!d) return
  Object.keys(state).forEach(k => { if (k in d) state[k] = d[k] })
  form.enabled = d.enabled ? 1 : 0
  form.rule_id = d.rule_id || 0
  const t = d.times || {}
  form.auto_open_time = t.open || '20:00'
  form.auto_close_time = t.close || '10:00'
  form.supplier_deadline_time = t.supplier || '12:00'
}

async function load() {
  try { apply(await autoPeriodApi.get()) } catch (e) { toast(e.message || '加载失败', 'err') }
}

function setEnabled(v) {
  if (form.enabled === v) return
  form.enabled = v
  if (v === 1) {
    if (!form.rule_id) {
      if (state.rule_id) form.rule_id = state.rule_id
      else if (state.candidates.length === 1) form.rule_id = state.candidates[0].rule_id
    }
    open.value = true
  }
}

async function save() {
  if (form.enabled === 1 && !form.rule_id) {
    toast('请先选择「以哪个品牌的报单节奏为准」', 'err'); return
  }
  busy.value = true
  try {
    apply(await autoPeriodApi.save({
      enabled: form.enabled,
      rule_id: form.rule_id,
      auto_open_time: form.auto_open_time,
      auto_close_time: form.auto_close_time,
      supplier_deadline_time: form.supplier_deadline_time,
    }))
    toast(form.enabled ? '已开启报单自动化' : '已切换为手动建表', 'ok')
  } catch (e) {
    toast(e.message || '保存失败', 'err')
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.ap-card{margin-bottom:12px;padding:0;overflow:hidden}
.ap-hd{display:flex;align-items:center;gap:10px;padding:11px 16px;cursor:pointer;flex-wrap:wrap}
.ap-hd b{font-size:13px;color:var(--t1)}
.ap-sub{font-size:12px;color:var(--t3)}
.ap-toggle{margin-left:auto;color:var(--p);font-size:12px}
.ap-chip{font-size:11px;padding:1px 8px;border-radius:10px;font-weight:500}
.ap-chip.on{background:rgba(var(--p-rgb),.12);color:var(--p-dark)}
.ap-chip.off{background:var(--bg2, #f3f4f6);color:var(--t3)}
.ap-meta{font-size:12px;color:var(--t2)}
.ap-strong{font-size:12px;color:var(--p-dark);font-weight:500}
.ap-warnchip{font-size:12px;color:var(--war);background:rgba(var(--war-rgb),.12);border:1px solid rgba(var(--war-rgb),.35);padding:1px 8px;border-radius:10px}
.ap-body{padding:0 16px 14px;border-top:1px solid var(--border-subtle)}
.ap-tip{font-size:12.5px;color:var(--t2);line-height:1.65;margin:12px 0}
.ap-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;padding:2px 0 6px}
.ap-grid .field{display:flex;flex-direction:column;gap:5px}
.ap-grid .field label{font-size:12px;color:var(--t2)}
.ap-hint{font-size:11px;color:var(--t3);margin-left:4px}
.ap-sel,.ap-in{padding:7px 10px;border:1px solid var(--bd);border-radius:var(--radius-sm);background:var(--bg2);color:var(--t1);font-size:13px;outline:none;font-family:inherit}
.ap-sel:focus,.ap-in:focus{border-color:var(--p)}
.ap-sel:disabled,.ap-in:disabled{opacity:.55;cursor:not-allowed}
.seg{display:inline-flex;border:1px solid var(--bd);border-radius:var(--radius-sm);overflow:hidden;width:max-content}
.seg-btn{padding:6px 14px;border:0;background:transparent;cursor:pointer;font-size:13px;color:var(--t2);font-family:inherit}
.seg-btn.on{background:var(--p);color:#fff}
.seg-btn:disabled{opacity:.6;cursor:not-allowed}
.ap-mirror{margin:6px 0;font-size:12px;color:var(--p-dark);background:rgba(var(--p-rgb),.06);border-radius:var(--radius-xs, 6px);padding:6px 9px;line-height:1.55}
.ap-mirror-warn{color:var(--war);background:rgba(var(--war-rgb),.08)}
.ap-edit{margin-left:8px;color:var(--p-dark);text-decoration:none;border-bottom:1px dashed var(--p);font-size:12px;white-space:nowrap}
.ap-warn{margin:6px 0;font-size:12px;color:var(--danger,#c0392b);background:rgba(192,57,43,.08);border-radius:var(--radius-xs, 6px);padding:6px 9px;line-height:1.55}
.ap-prev{margin-top:10px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:10px;background:var(--bg2)}
.ap-prev-hd{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--t3);margin-bottom:8px}
.ap-tbl{width:100%;border-collapse:collapse;font-size:12px}
.ap-tbl th{text-align:left;color:var(--t3);font-weight:500;padding:4px 6px;border-bottom:1px solid var(--border-subtle)}
.ap-tbl td{padding:5px 6px;border-bottom:1px solid var(--border-subtle);vertical-align:middle}
.ap-dim{color:var(--t3);font-size:11px}
.ap-brand{display:inline-block;background:rgba(var(--p-rgb),.12);color:var(--p-dark);border-radius:var(--radius-xs, 4px);padding:1px 6px;margin:1px 4px 1px 0;font-size:11px}
.ap-brand i{font-style:normal;opacity:.7;margin-left:2px}
.ap-actions{display:flex;align-items:center;gap:10px;margin-top:12px}
@media(max-width:640px){ .ap-grid{grid-template-columns:1fr} }
</style>
