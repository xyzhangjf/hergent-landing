<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="modal-overlay" @click.self="close"></div>
    </Transition>
    <Transition name="modal">
      <div v-if="open" class="modal-card" @keydown.enter="onFormEnter">
        <div class="modal-hd">
          <b>{{ title }}</b>
          <button class="btn-close" @click="close"><Icon name="close"/></button>
        </div>
        <div class="modal-body">
          <!-- 共用：规则名称 / 计算维度 / 目标度量 / 作用对象 -->
          <div class="form-row"><label>规则名称</label><input ref="formNameRef" v-model="form.rule_name" class="input" :placeholder="namePlaceholder"></div>
          <div class="form-grid2">
            <div class="form-row"><label>计算维度</label>
              <select v-model="form.dimension" class="input">
                <option v-for="d in dimensionOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
              </select>
            </div>
            <!-- v122：品牌目标只能按金额（后端亦强制），隐藏该选择器避免选了被拒 -->
            <div class="form-row" v-if="!isBrandForm"><label>目标度量</label>
              <select v-model="form.target_type" class="input">
                <option value="amount">下单金额（元）</option>
                <option value="quantity">销售数量（大单位）</option>
              </select>
            </div>
          </div>
          <div class="form-row"><label>作用对象</label>
            <input v-model="form.scope_name" class="input" :list="scopeListId" :placeholder="scopePlaceholder">
            <datalist :id="scopeListId">
              <option v-for="o in scopeDatalist" :key="o" :value="o"></option>
            </datalist>
            <span v-if="isBrandForm && form.scope_name && !brandOptions.includes(form.scope_name)" style="color:var(--dan);font-size:12px;margin-top:4px">该品牌不在档案中，请先在「档案管理 → 品牌档案」创建</span>
          </div>

          <!-- 按维度分流：品牌页 / 商品页 -->
          <BrandTargetForm
            v-if="isBrandForm"
            :form="form" :monthly-rows="monthlyRows" :brand-mode="brandMode" :monthly-on="monthlyOn"
            :monthly-sum-wan="monthlySumWan" :annual-target-wan="annualTargetWan" :annual-rate-pct="annualRatePct"
            :annual-rate-placeholder="annualRatePlaceholder" :monthly-filled-count="monthlyFilledCount"
            :legacy-notice="legacyNotice" :target-wan="targetWan" :rule-tiers="ruleTiers" :scale-options="scaleOptions"
            :arrival-preview="arrivalPreview" :auto-period-preview="autoPeriodPreview" :ap-missed-summary="apMissedSummary"
            :first-arrival-date="firstArrivalDate" :arrival-weekday="arrivalWeekday" :lead-err="leadErr"
            :lead-valid="leadValid" :is-order-wk="isOrderWk"
            @switch-mode="switchBrandMode"
            @update:annual-target="v => (annualTargetWan = v)"
            @update:annual-rate="v => (annualRatePct = v)"
            @clear-monthly="clearMonthly"
            @update:target-wan="v => (targetWan = v)"
            @add-tier="ruleTiers.push(emptyTier())" @remove-tier="i => ruleTiers.splice(i,1)"
            @lead-input="onLeadInput" @arrival-change="onArrivalChange"
            @toggle-wk="toggleOrderWk" @adopt="adoptSuggestion" @open-migrate="openMigrate"
          />
          <ProductTargetForm
            v-else
            :form="form" :target-wan="targetWan" :rule-tiers="ruleTiers" :scale-options="scaleOptions"
            @update:target-wan="v => (targetWan = v)"
            @add-tier="ruleTiers.push(emptyTier())" @remove-tier="i => ruleTiers.splice(i,1)"
          />

          <!-- 共用：生效期 / 优先级 / 启用 -->
          <div class="form-grid2">
            <div class="form-row"><label>生效开始</label><input v-model="form.effective_start" class="input" type="date"></div>
            <div class="form-row"><label>生效结束</label><input v-model="form.effective_end" class="input" type="date"></div>
          </div>
          <div class="form-grid2">
            <div class="form-row"><label>优先级</label><input v-model.number="form.priority" class="input" type="number" placeholder="数值越大越优先"></div>
            <div class="form-row"><label>启用</label>
              <select v-model.number="form.is_active" class="input">
                <option :value="1">启用</option>
                <option :value="0">停用</option>
              </select>
            </div>
          </div>
        </div>
        <div class="modal-ft">
          <button class="btn btn-ghost" @click="close">取消</button>
          <button class="btn btn-primary" @click="save">{{ editing ? '保存' : '创建' }}</button>
        </div>
      </div>
    </Transition>

    <!-- v121 合并：旧到货排程(arrival_*) → 报单节奏(order_*) 反推迁移 -->
    <div v-if="showMigrate" class="modal-overlay" @click.self="showMigrate=false"></div>
    <Transition name="modal">
      <div v-if="showMigrate" class="modal-card">
        <div class="modal-hd"><b>把旧的到货排程，换算成报单节奏</b><button class="btn-close" @click="showMigrate=false"><Icon name="close"/></button></div>
        <div class="modal-body">
          <p class="cf-tip">
            这条规则以前只配了「<b>货哪天到</b>」。现在统一成「<b>单哪天报</b>」—— 到货日由报单日自动推算，
            两处不会再算成两个结果。按你现有的设置反推如下：
          </p>
          <table class="tbl cf-tbl">
            <thead><tr><th>现在（到货语义）</th><th>换算后（报单语义）</th></tr></thead>
            <tbody>
              <tr>
                <td>{{ migrateInfo && migrateInfo.fromLabel }}</td>
                <td><b>{{ migrateInfo && migrateInfo.toLabel }}</b></td>
              </tr>
            </tbody>
          </table>
          <p class="cf-sol">注意：换算后 <b>到货次数可能变化</b>（「首次报单日 → 首次到货日」中间隔着 {{ migrateInfo && migrateInfo.lead }} 天提前期），
            均单会跟着变。请核对下方「未来期次预览」，确认节奏对得上再保存。</p>
        </div>
        <div class="modal-ft">
          <button class="btn" @click="showMigrate=false">以后再说</button>
          <button class="btn btn-primary" @click="applyMigrate">确认换算</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
/**
 * 目标规则表单弹窗（v122 拆分后的容器）
 *
 * 职责：持有表单状态与请求逻辑，按 dimension 渲染 品牌页 / 商品页。
 * 所有外部依赖（品牌档案 / 商品候选 / meta 枚举 / 全局默认节奏）一律由 props 传入，
 * 不复用父页作用域变量，便于独立灰度与回退。
 */
import Icon from '../Icon.vue'
import BrandTargetForm from './BrandTargetForm.vue'
import ProductTargetForm from './ProductTargetForm.vue'
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { toast } from '../../store'
import { rebateApi } from '../../api/modules'
import { api } from '../../api/client.js'
import {
  LEAD_MIN, LEAD_MAX, WK_LABEL, _addDaysISO, _diffDaysISO, _weekdayOf, isoLocal,
  emptyMonthlyRows, sumMonthlyWan, splitAnnualToMonths, buildMonthlyPayloads,
  fillMonthlyFromRule, parseRuleTiers, defaultForm, duplicateForm,
} from './useRebateTargetForm.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** 'create' | 'edit' | 'dup' */
  mode: { type: String, default: 'create' },
  /** 编辑/复制时的原始规则对象 */
  rule: { type: Object, default: null },
  presetDim: { type: String, default: 'brand' },
  brandOptions: { type: Array, default: () => [] },
  productNames: { type: Array, default: () => [] },
  /** { byName: Map, byBarcode: Map } —— 商品名 → 商品 ID */
  productRefs: { type: Object, default: () => ({ byName: new Map(), byBarcode: new Map() }) },
  scaleOptions: { type: Array, default: () => [] },
  dimensionOptions: { type: Array, default: () => [] },
  defaultCadence: { type: Number, default: 2 },
})
const emit = defineEmits(['close', 'saved', 'conflict'])

const currentYear = new Date().getFullYear()
const form = ref(defaultForm())
const editing = ref(false)
const ruleTiers = ref([])
const monthlyRows = ref(emptyMonthlyRows())
const legacyNotice = ref('')
const brandMode = ref('year')
const targetWan = ref(0)
const arrivalPreview = ref(null)
const autoPeriodPreview = ref(null)
const formNameRef = ref(null)
const showMigrate = ref(false)
const migrateInfo = ref(null)

const isBrandForm = computed(() => !!form.value && form.value.dimension === 'brand')
const isBrandMonthly = computed(() => isBrandForm.value && form.value.target_type === 'amount')
/** 品牌 + 年度模式 = 走 12 个月分解 */
const monthlyOn = computed(() => isBrandMonthly.value && brandMode.value === 'year')
const title = computed(() => {
  if (editing.value) return isBrandForm.value ? '编辑品牌目标' : '编辑商品目标'
  return isBrandForm.value ? '创建品牌目标' : '创建商品目标'
})
const namePlaceholder = computed(() => isBrandForm.value ? '如 蒙牛低温2026年度目标' : '如 特仑苏9月目标')

/* ---------------- 12 个月分解 ---------------- */
const monthlySumWan = computed(() => sumMonthlyWan(monthlyRows.value))
const annualTargetWan = computed({
  get: () => (monthlySumWan.value > 0 ? monthlySumWan.value : ''),
  set: v => splitAnnualToMonths(monthlyRows.value, v),
})
const annualRatePct = computed({
  get: () => {
    const vals = monthlyRows.value.map(r => (r.ratePct == null || r.ratePct === '' ? null : Number(r.ratePct)))
    if (!vals.length || vals.some(v => v == null)) return ''
    return vals.every(v => Math.abs(v - vals[0]) < 1e-9) ? vals[0] : ''
  },
  set: v => {
    const n = (v === '' || v == null) ? null : Number(v)
    monthlyRows.value.forEach(r => { r.ratePct = n })
  },
})
const monthlyFilledCount = computed(() => monthlyRows.value.filter(r => Number(r.amtWan) > 0).length)
const annualRatePlaceholder = computed(() => {
  const mixed = monthlyRows.value.some(r => r.ratePct != null && r.ratePct !== '')
  return (annualRatePct.value === '' && mixed) ? '各月不同' : '如 10'
})
function clearMonthly() { monthlyRows.value = emptyMonthlyRows() }
function emptyTier() { return { from_pct: 0, to_pct: 0, rebate_rate: 0, rebate_amount: 0 } }

/** 年度 ⇄ 单期切换：不清空月度行，切回来数据还在（保存时才决定写不写月度分解） */
function switchBrandMode(m) {
  if (m === brandMode.value) return
  brandMode.value = m
  if (m === 'year') {
    form.value.period_type = 'year'
    if (!form.value.target_year) form.value.target_year = currentYear
  } else if (form.value.period_type === 'year') {
    form.value.period_type = 'month'
    targetWan.value = monthlySumWan.value || targetWan.value
  }
}

/* ---------------- 报单日 ↔ N ↔ 到货日 ---------------- */
const leadValid = computed(() => {
  const n = form.value.order_lead_days
  return Number.isInteger(n) && n >= LEAD_MIN && n <= LEAD_MAX
})
const leadErr = computed(() => {
  const f = form.value
  const raw = f.order_lead_days
  if (raw === null || raw === undefined || raw === '') {
    return f.order_first_date ? '「提前天数」没填，到货日算不出来 —— 填 0 表示当天到货' : ''
  }
  const n = Number(raw)
  if (!Number.isFinite(n)) return '提前天数须为数字'
  if (!Number.isInteger(n)) return '提前天数须为整数，不能填 ' + raw
  if (n < LEAD_MIN) return '提前天数不能为负（到货日不得早于报单日）'
  if (n > LEAD_MAX) return '提前天数最多 ' + LEAD_MAX + ' 天'
  return ''
})
const firstArrivalDate = computed(() => {
  const f = form.value
  if (!f.order_first_date || !leadValid.value) return ''
  return _addDaysISO(f.order_first_date, f.order_lead_days)
})
const arrivalWeekday = computed(() => _weekdayOf(firstArrivalDate.value))
function onLeadInput(e) {
  const raw = e.target.value
  if (raw === '' || raw === null) { form.value.order_lead_days = null; return }
  const n = Number(raw)
  form.value.order_lead_days = Number.isFinite(n) ? n : null
}
function onArrivalChange(e) {
  const f = form.value
  const v = e.target.value
  if (!v) { f.order_lead_days = null; return }
  if (!f.order_first_date) {
    toast('请先填「首次报单日」，才能反推提前天数', 'error')
    e.target.value = ''
    return
  }
  const diff = _diffDaysISO(f.order_first_date, v)
  if (diff == null) { toast('到货日格式不正确', 'error'); e.target.value = firstArrivalDate.value; return }
  if (diff < LEAD_MIN) { toast('到货日不能早于报单日（' + f.order_first_date + '）', 'error'); e.target.value = firstArrivalDate.value; return }
  if (diff > LEAD_MAX) { toast('提前天数最多 ' + LEAD_MAX + ' 天，当前是 ' + diff + ' 天', 'error'); e.target.value = firstArrivalDate.value; return }
  f.order_lead_days = diff
}
function isOrderWk(v) {
  return String(form.value.order_weekdays || '').split(',').map(s => s.trim()).filter(Boolean).includes(String(v))
}
function toggleOrderWk(v) {
  const cur = String(form.value.order_weekdays || '').split(',').map(s => s.trim()).filter(Boolean)
  const i = cur.indexOf(String(v))
  if (i >= 0) cur.splice(i, 1); else cur.push(String(v))
  form.value.order_weekdays = cur.sort((a, b) => Number(a) - Number(b)).join(',')
}
const apMissedSummary = computed(() => {
  const m = (autoPeriodPreview.value && autoPeriodPreview.value.missed) || []
  if (!m.length) return ''
  const head = m.slice(0, 4).map(x => `${x.name} ${x.cutoff}`).join('、')
  return head + (m.length > 4 ? ` 等 ${m.length} 次` : '')
})
function adoptSuggestion() {
  const s = autoPeriodPreview.value && autoPeriodPreview.value.suggestion
  if (s && s.suggested) form.value.order_first_date = s.suggested
}

/* ---------------- 异步预览（均单 / 未来 6 期） ---------------- */
let _apTimer = null
async function loadArrivalPreview() {
  const f = form.value
  const _tw = isBrandMonthly.value ? monthlySumWan.value : targetWan.value
  const tv = f.target_type === 'amount' ? (Number(_tw) || 0) * 10000 : (Number(f.target_value) || 0)
  const params = new URLSearchParams()
  params.set('order_mode', f.order_mode || 'interval')
  params.set('order_first_date', (f.order_first_date && leadValid.value) ? f.order_first_date : '')
  params.set('order_cadence_days', f.order_cadence_days ?? 2)
  params.set('order_weekdays', f.order_weekdays || '')
  params.set('order_lead_days', leadValid.value ? f.order_lead_days : 4)
  params.set('mode', f.arrival_mode || 'interval')
  if (f.arrival_first_dom) params.set('first_dom', f.arrival_first_dom)
  if (f.arrival_cadence_days) params.set('cadence_days', f.arrival_cadence_days)
  if (f.arrival_weekdays != null) params.set('weekdays', f.arrival_weekdays)
  if (f.arrival_count_override) params.set('override', f.arrival_count_override)
  params.set('target_value', tv)
  try {
    const r = await api('/api/rebate-rules/arrival-preview?' + params.toString())
    if (r) arrivalPreview.value = r
  } catch (e) { /* 预览失败不阻断编辑 */ }
}
let _opTimer = null
async function loadAutoPeriodPreview() {
  const f = form.value
  if (!f.auto_period_enabled && !f.order_first_date) { autoPeriodPreview.value = null; return }
  if (f.order_first_date && !leadValid.value) { autoPeriodPreview.value = null; return }
  const params = new URLSearchParams()
  if (editing.value && f.id) params.set('rule_id', f.id)
  if (f.scope_name) params.set('scope_name', f.scope_name)
  params.set('order_mode', f.order_mode || 'interval')
  if (f.order_first_date) params.set('order_first_date', f.order_first_date)
  params.set('order_cadence_days', f.order_cadence_days ?? 2)
  if (f.order_weekdays != null) params.set('order_weekdays', f.order_weekdays)
  params.set('order_lead_days', leadValid.value ? f.order_lead_days : 4)
  params.set('order_max_early_days', f.order_max_early_days ?? 1)
  params.set('auto_open_time', f.auto_open_time || '20:00')
  params.set('auto_close_time', f.auto_close_time || '10:00')
  params.set('supplier_deadline_time', f.supplier_deadline_time || '12:00')
  try {
    const r = await api('/api/rebate-rules/auto-period-preview?' + params.toString())
    if (r) autoPeriodPreview.value = r
  } catch (e) { /* 预览失败不阻断编辑 */ }
}
watch(
  () => [form.value.auto_period_enabled, form.value.order_mode, form.value.order_first_date,
         form.value.order_cadence_days, form.value.order_weekdays, form.value.order_lead_days,
         form.value.order_max_early_days, form.value.auto_open_time, form.value.auto_close_time,
         form.value.supplier_deadline_time, form.value.scope_name],
  () => {
    if (_opTimer) clearTimeout(_opTimer)
    _opTimer = setTimeout(loadAutoPeriodPreview, 300)
  }
)
watch(
  () => [form.value.arrival_mode, form.value.arrival_first_dom, form.value.arrival_cadence_days,
         form.value.arrival_weekdays, form.value.arrival_count_override, form.value.target_type, targetWan.value,
         form.value.target_value, monthlySumWan.value, form.value.order_mode, form.value.order_first_date,
         form.value.order_cadence_days, form.value.order_weekdays, form.value.order_lead_days],
  () => {
    if (_apTimer) clearTimeout(_apTimer)
    _apTimer = setTimeout(loadArrivalPreview, 300)
  }
)
onBeforeUnmount(() => {
  if (_apTimer) clearTimeout(_apTimer)
  if (_opTimer) clearTimeout(_opTimer)
})

/* ---------------- 旧到货排程 → 报单节奏 反推 ---------------- */
function openMigrate() {
  const f = form.value
  const lead = Number(f.order_lead_days ?? 4) || 0
  const mode = f.arrival_mode || 'interval'
  if (mode === 'weekday') {
    const awd = String(f.arrival_weekdays || '').split(',').map(s => s.trim()).filter(Boolean).map(Number)
    if (!awd.length) { toast('旧排程没填「到货星期」，无法反推，请直接填首次报单日', 'error'); return }
    const owd = awd.map(w => (((w - 1 - lead) % 7) + 7) % 7 + 1).sort((a, b) => a - b)
    migrateInfo.value = {
      mode: 'weekday', lead,
      fromLabel: '到货：每' + awd.map(w => '周' + (WK_LABEL[w] || w)).join('、'),
      toLabel: '报单：每' + owd.map(w => '周' + (WK_LABEL[w] || w)).join('、') + '（到货星期往前推 ' + lead + ' 天）',
      to: { mode: 'weekday', first_date: isoLocal(new Date()), cadence: null, weekdays: owd.join(',') },
    }
  } else {
    const cad = Number(f.arrival_cadence_days) || 0
    const fdom = Number(f.arrival_first_dom) || 1
    if (cad < 1) { toast('旧排程没填「到货周期」，无法反推，请直接填首次报单日', 'error'); return }
    const now = new Date()
    const y = now.getFullYear(), m = now.getMonth() + 1
    const lastDay = new Date(y, m, 0).getDate()
    const d = new Date(y, m - 1, Math.min(fdom, lastDay))
    d.setDate(d.getDate() - lead)
    migrateInfo.value = {
      mode: 'interval', lead,
      fromLabel: '到货：每月 ' + fdom + ' 号起、每 ' + cad + ' 天一次',
      toLabel: '报单：从 ' + isoLocal(d) + ' 起、每 ' + cad + ' 天一次（到货 = 报单 + ' + lead + ' 天）',
      to: { mode: 'interval', first_date: isoLocal(d), cadence: cad, weekdays: '' },
    }
  }
  showMigrate.value = true
}
function applyMigrate() {
  const t = migrateInfo.value && migrateInfo.value.to
  if (!t) return
  form.value.order_mode = t.mode
  form.value.order_first_date = t.first_date
  if (t.cadence) form.value.order_cadence_days = t.cadence
  if (t.weekdays != null) form.value.order_weekdays = t.weekdays
  showMigrate.value = false
  migrateInfo.value = null
  toast('已按旧排程反推报单节奏，请核对下方预览再保存', 'success')
}

/* ---------------- 作用对象 ---------------- */
const scopeDatalist = computed(() => {
  const d = form.value.dimension
  if (d === 'brand') return props.brandOptions
  if (d === 'product') return props.productNames
  return []
})
const scopeListId = computed(() => 'rebate-scope-' + (form.value.dimension || 'brand'))
const scopePlaceholder = computed(() => {
  const d = form.value.dimension
  if (d === 'brand') return '品牌名（空=全部品牌）'
  if (d === 'product') return '商品 ID 或名称（空=全部单品）'
  return '作用对象（空=全部）'
})
/** 商品名 → 商品 ID（填了名字但解析不出 ID，保存时会变成「作用于全部单品」） */
function resolveProductKey(key) {
  const s = String(key == null ? '' : key).trim()
  if (!s) return ''
  const { byName, byBarcode } = props.productRefs
  if (byName && byName instanceof Map && byName.has(s)) return String(byName.get(s))
  if (byBarcode && byBarcode instanceof Map && byBarcode.has(s)) return String(byBarcode.get(s))
  return s
}

/* ---------------- 打开 / 关闭 / 保存 ---------------- */
watch(() => props.open, (v) => { if (v) init() })

function init() {
  const r = props.rule
  showMigrate.value = false
  migrateInfo.value = null
  if (props.mode === 'edit' && r) {
    editing.value = true
    form.value = { ...r }
    if (form.value.target_year == null) form.value.target_year = currentYear
    if (form.value.target_unit == null) form.value.target_unit = ''
    ruleTiers.value = parseRuleTiers(r.tiers_json)
    targetWan.value = (Number(r.target_value) || 0) / 10000
    arrivalPreview.value = null
    const { mode, notice } = fillMonthlyFromRule(monthlyRows.value, r, { isBrandMonthly: form.value.dimension === 'brand' && form.value.target_type === 'amount' })
    brandMode.value = mode
    legacyNotice.value = notice
    loadArrivalPreview()
  } else if (props.mode === 'dup' && r) {
    editing.value = false
    form.value = duplicateForm(r, { defaultCadence: props.defaultCadence, currentYear })
    targetWan.value = (Number(r.target_value) || 0) / 10000
    arrivalPreview.value = null
    ruleTiers.value = parseRuleTiers(r.tiers_json)
    const { mode, notice } = fillMonthlyFromRule(monthlyRows.value, r, { isBrandMonthly: form.value.dimension === 'brand' && form.value.target_type === 'amount' })
    brandMode.value = mode
    legacyNotice.value = notice
  } else {
    editing.value = false
    form.value = defaultForm({ presetDim: props.presetDim, defaultCadence: props.defaultCadence, currentYear })
    targetWan.value = 0
    arrivalPreview.value = null
    ruleTiers.value = []
    legacyNotice.value = ''
    brandMode.value = 'year'
    monthlyRows.value = emptyMonthlyRows()
  }
  autoPeriodPreview.value = null
  nextTick(() => formNameRef.value && formNameRef.value.focus())
}

function close() { emit('close') }

function onFormEnter(e) {
  if (e.target && e.target.tagName === 'BUTTON') return
  save()
}

async function save() {
  const f = form.value
  if (monthlyOn.value) {
    f.target_value = Math.round(monthlySumWan.value * 10000)
  } else if (f.target_type === 'amount') {
    f.target_value = Math.round((Number(targetWan.value) || 0) * 10000)
  }
  const monthly = buildMonthlyPayloads(monthlyRows.value)
  if (monthlyOn.value) {
    const _ty = Number(f.target_year)
    if (!_ty || !Number.isInteger(_ty) || _ty < 2000 || _ty > 2100) {
      toast('请填写目标年度（2000-2100），12 个月分解要知道是哪一年', 'error'); return
    }
    if (!Object.keys(monthly.monthlyAmounts).length) {
      toast('请至少填写一个月的目标金额 —— 可以只在「全年目标」填一个数，自动均分到 12 个月', 'error'); return
    }
    if (!Object.keys(monthly.monthlyRates).length) {
      toast('请至少填写一个月的返利率 —— 可以只在「全年返利率」填一个数，12 个月统一', 'error'); return
    }
    f.monthly_amounts = monthly.monthlyAmounts
    f.monthly_rates = Object.keys(monthly.monthlyRates).length ? monthly.monthlyRates : {}
    f.target_value = Object.values(monthly.monthlyAmounts).reduce((s, v) => s + (Number(v) || 0), 0)
    targetWan.value = f.target_value / 10000
    f.period_type = 'year'
    f.trigger_mode = 'on_target'
    f.rebate_basis = 'rate'
    f.trigger_threshold = 1
    f.tiers_json = ''
    const _r1 = monthlyRows.value.find(r => r.ratePct != null && Number(r.ratePct) > 0)
    f.rebate_rate = _r1 ? Math.round(Number(_r1.ratePct) * 1000) / 100000 : 0
  } else {
    f.monthly_amounts = {}
    f.monthly_rates = {}
  }
  if (!f.rule_name) { toast('请填写规则名称', 'error'); return }
  if (!f.target_value || f.target_value <= 0) { toast('目标值必须 > 0', 'error'); return }
  if (f.order_mode === 'weekday' && !f.order_weekdays) { toast('请选择至少一个报单星期', 'error'); return }
  if (f.order_first_date && !leadValid.value) {
    toast(leadErr.value || '「提前天数」须为 0~30 的整数', 'error'); return
  }
  if (f.trigger_mode === 'on_target' && f.rebate_basis === 'rate' && (f.rebate_rate < 0 || f.rebate_rate > 1)) { toast('返利比例须 0~1', 'error'); return }
  if (f.dimension === 'brand' && f.scope_name && !props.brandOptions.includes(f.scope_name)) { toast('品牌「' + f.scope_name + '」不在品牌档案中，请先创建', 'error'); return }
  if (f.dimension === 'brand' && f.scope_name) f.scope_key = f.scope_name.trim()
  if (f.dimension === 'product' && f.scope_name) f.scope_key = resolveProductKey(f.scope_name)
  if (f.trigger_mode === 'tiered') {
    const tiers = ruleTiers.value
      .filter(t => (Number(t.from_pct) || 0) > 0 || (Number(t.to_pct) || 0) > 0 || (Number(t.rebate_rate) || 0) > 0 || (Number(t.rebate_amount) || 0) > 0)
      .map(t => ({
        from_pct: (Number(t.from_pct) || 0) / 100,
        to_pct: (Number(t.to_pct) || 0) === 0 ? 999 : (Number(t.to_pct) || 0) / 100,
        rebate_rate: Number(t.rebate_rate) || 0,
        rebate_amount: Number(t.rebate_amount) || 0,
      }))
      .sort((a, b) => a.from_pct - b.from_pct)
    if (!tiers.length) { toast('阶梯模式必须至少配置一档', 'error'); return }
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i]
      if (!(t.from_pct < t.to_pct)) { toast('第 ' + (i + 1) + ' 档：起始达成率必须小于结束达成率', 'error'); return }
      if (f.rebate_basis === 'rate' && !(t.rebate_rate > 0 && t.rebate_rate <= 1)) { toast('第 ' + (i + 1) + ' 档：返利比例须在 (0,1] 之间', 'error'); return }
      if (f.rebate_basis === 'fixed' && t.rebate_amount <= 0) { toast('第 ' + (i + 1) + ' 档：固定金额须大于 0', 'error'); return }
    }
    f.tiers_json = JSON.stringify(tiers)
  } else {
    f.tiers_json = ''
  }
  try {
    if (editing.value) {
      await rebateApi.update(f.id, f)
    } else {
      await rebateApi.create(f)
    }
    toast(editing.value ? '已保存' : '已创建', 'success')
    close()
    emit('saved')
  } catch (e) {
    if (e.status === 409 && e.payload && Array.isArray(e.payload.conflicts) && e.payload.conflicts.length) {
      emit('conflict', {
        dimension: f.dimension,
        scopeName: f.scope_name || f.scope_key || '全部',
        conflicts: e.payload.conflicts,
      })
    } else {
      toast('操作失败: ' + (e.message || ''), 'error')
    }
  }
}
</script>

<style scoped>
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1000}
.modal-card{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:580px;max-width:92vw;max-height:88vh;overflow-y:auto;background:var(--bg);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);z-index:1001}
.modal-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-subtle)}
.modal-hd b{font-size:16px}
.btn-close{border:none;background:none;font-size:18px;color:var(--t3);cursor:pointer}
.modal-body{padding:20px;display:flex;flex-direction:column;gap:14px}
.modal-ft{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--border-subtle);position:sticky;bottom:0;background:var(--bg);z-index:2}
.form-row{display:flex;flex-direction:column;gap:6px}
.form-row label{font-size:12px;font-weight:500;color:var(--t2)}
.form-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.cf-tip{font-size:13px;color:var(--t2);line-height:1.6;margin:0 0 12px}
.cf-tbl{width:100%;margin-bottom:12px}
.cf-sol{font-size:12.5px;color:var(--t3);line-height:1.7;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:10px 12px;margin:0}
.cf-sol b{color:var(--t1)}
.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
.modal-enter-active,.modal-leave-active{transition:all .25s ease}
.modal-enter-from,.modal-leave-to{opacity:0;transform:translate(-50%,-46%)}
@media(max-width:768px){ .form-grid2{grid-template-columns:1fr} .modal-card{width:94vw} }
</style>
