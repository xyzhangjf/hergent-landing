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
          <!-- 共用：规则名称 / 目标度量 / 作用对象 -->
          <!-- v127：移除「计算维度」下拉 —— 维度由入口按钮（新建）或原记录（编辑）决定，
               不再暴露给用户：① 两个入口已拆分，下拉纯冗余；② 编辑时跨维度切换会被后端
               _normalize_by_dimension 静默清空 monthly_*（12 个月目标凭空消失）。 -->
          <div class="form-row"><label>规则名称</label><input ref="formNameRef" v-model="form.rule_name" class="input" :placeholder="namePlaceholder"></div>
          <div class="form-row" v-if="!isBrandForm"><label>目标度量</label>
            <select v-model="form.target_type" class="input">
              <option value="amount">下单金额（元）</option>
              <option value="quantity">销售数量（大单位）</option>
            </select>
          </div>
          <div class="form-row"><label>作用对象</label>
            <input v-model="form.scope_name" class="input" :list="scopeListId" :placeholder="scopePlaceholder">
            <datalist :id="scopeListId">
              <option v-for="o in scopeDatalist" :key="o" :value="o"></option>
            </datalist>
            <span v-if="isBrandForm && form.scope_name && !brandOptions.includes(form.scope_name)" style="color:var(--dan);font-size:12px;margin-top:4px">该品牌不在档案中，请先在「档案管理 → 品牌档案」创建</span>
          </div>

          <!-- v128：同一年份已有目标 —— 只提示 + 一键跳转编辑，不自动覆盖用户输入 -->
          <div v-if="yearHitsVisible" class="dup-warn year-hit">
            <Icon name="alert-triangle" />
            <div>
              <b>{{ form.target_year }} 年这个对象已经有目标了</b>
              <p v-for="r in yearHits" :key="r.id">
                「{{ r.rule_name || ('规则#' + r.id) }}」
                <template v-if="r.__summary.filledMonths">已填 {{ r.__summary.filledMonths }} 个月，合计</template>
                <template v-else>合计</template>
                <b>{{ fmtWan(r.__summary.totalWan) }} 万元</b>
              </p>
              <p class="dup-tip">同一年份、同一对象建议只保留一条目标，否则返利会被重复计算。要改就改原来这条。</p>
              <div class="yh-act">
                <button v-if="yearHits.length === 1" class="btn btn-primary btn-sm" @click="goEditExisting(yearHits[0])">编辑这条</button>
                <button v-for="r in yearHits" v-else :key="'e' + r.id" class="btn btn-sm" @click="goEditExisting(r)">编辑「{{ r.rule_name || ('#' + r.id) }}」</button>
                <button class="btn btn-ghost btn-sm" @click="dismissYearHits">仍然新建</button>
              </div>
            </div>
          </div>

          <!-- v125：保存前重复目标预检（年度 / 单期两个入口共用） -->
          <div v-if="dupWarn.length" class="dup-warn">
            <Icon name="alert-triangle" />
            <div>
              <b>这些月份已经有目标了</b>
              <p v-for="(c, i) in dupWarn" :key="i">
                「{{ c.rule_name || ('规则#' + c.id) }}」已占用
                <b>{{ (c.months || []).join('、') || '相同生效期' }}</b>
                <template v-if="c.months && c.months.length"> —— 同一品牌同一月份只能有一条目标，否则返利会被重复计算。</template>
              </p>
              <p class="dup-tip">请先停用或改期上面那条，再保存本条（停用后月份立即释放）。</p>
            </div>
          </div>

          <!-- 按维度分流：品牌页 / 商品页 -->
          <BrandTargetForm
            v-if="isBrandForm"
            :form="form" :monthly-rows="monthlyRows"
            :monthly-sum-wan="monthlySumWan" :annual-target-wan="annualTargetWan" :annual-rate-pct="annualRatePct"
            :annual-rate-placeholder="annualRatePlaceholder" :monthly-filled-count="monthlyFilledCount"
            :legacy-notice="legacyNotice" :rule-tiers="ruleTiers" :scale-options="scaleOptions"
            :arrival-preview="arrivalPreview" :auto-period-preview="autoPeriodPreview" :ap-missed-summary="apMissedSummary"
            :first-arrival-date="firstArrivalDate" :arrival-weekday="arrivalWeekday" :lead-err="leadErr"
            :lead-valid="leadValid" :is-order-wk="isOrderWk"
            @update:annual-target="v => (annualTargetWan = v)"
            @update:annual-rate="v => (annualRatePct = v)"
            @clear-monthly="clearMonthly"
            @add-tier="ruleTiers.push(emptyTier())" @remove-tier="i => ruleTiers.splice(i,1)"
            @add-month-tier="addMonthTier" @remove-month-tier="removeMonthTier"
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
  emptyMonthlyRows, sumMonthlyWan, splitAnnualToMonths, fillAnnualRateToMonths,
  buildMonthlyPayloads, fillMonthlyFromRule, parseRuleTiers, defaultForm, duplicateForm,
  ruleMonthlySummary, fmtWan,
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
  defaultCadence: { type: Number, default: 2 },
  /** v128：当前租户全部规则（父页 rules）—— 用于「该年份已有目标」提示，避免重复创建 */
  existingRules: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'saved', 'conflict', 'load-existing'])

const currentYear = new Date().getFullYear()
const form = ref(defaultForm())
const editing = ref(false)
const ruleTiers = ref([])
const monthlyRows = ref(emptyMonthlyRows())
const legacyNotice = ref('')
const targetWan = ref(0)
const arrivalPreview = ref(null)
const autoPeriodPreview = ref(null)
const formNameRef = ref(null)
const showMigrate = ref(false)
const migrateInfo = ref(null)

const isBrandForm = computed(() => !!form.value && form.value.dimension === 'brand')
const isBrandMonthly = computed(() => isBrandForm.value && form.value.target_type === 'amount')
/** v126：品牌维度恒走月表（年度 = 铺满 12 格，单期 = 只填 1 格），不再有第二种口径 */
const monthlyOn = computed(() => isBrandMonthly.value)
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

/* ---------------- v125：重复目标预检（不落库） ----------------
   后端判重口径 = 覆盖月份交集（跨「年度 / 单期」口径），前端只负责提示，不镜像算法。
   编辑态带 id，后端会排除自身。 */
const dupWarn = ref([])
const _dupSeq = ref(0)
async function runPrecheck() {
  const f = form.value
  if (!props.open) { dupWarn.value = []; return }
  const seq = ++_dupSeq.value
  const monthly = buildMonthlyPayloads(monthlyRows.value)
  const payload = {
    id: editing.value ? f.id : 0,
    rule_name: f.rule_name || '预检',
    dimension: f.dimension,
    target_type: f.target_type,
    scope_key: f.scope_key || f.scope_name || '',
    scope_name: f.scope_name || '',
    period_type: monthlyOn.value ? 'year' : (f.period_type || 'month'),
    target_value: Number(f.target_value) || 1,
    target_year: Number(f.target_year) || currentYear,
    trigger_mode: monthlyOn.value ? 'on_target' : (f.trigger_mode || 'on_target'),
    trigger_threshold: f.trigger_threshold || 1,
    rebate_basis: monthlyOn.value ? 'rate' : (f.rebate_basis || 'rate'),
    rebate_rate: Number(f.rebate_rate) || 0.01,
    effective_start: f.effective_start || '',
    effective_end: f.effective_end || '',
    monthly_amounts: monthlyOn.value ? monthly.monthlyAmounts : {},
    monthly_rates: monthlyOn.value ? monthly.monthlyRates : {},
    monthly_tiers: monthlyOn.value ? monthly.monthlyTiers : {},
  }
  // 年度模式未填月度金额时后端按「全年 12 个月」判定（与落库口径一致），故不跳过，
  // 选完品牌即可提示"这个品牌今年已经有单期目标了"。
  try {
    // 注意：api() 会自己 JSON.stringify，这里必须传对象（传字符串会被二次序列化）
    const d = await api('/api/rebate-rules/precheck', { method: 'POST', body: payload })
    if (seq !== _dupSeq.value) return  // 丢弃过期响应
    dupWarn.value = (d && d.success && Array.isArray(d.conflicts)) ? d.conflicts : []
  } catch (e) {
    if (seq === _dupSeq.value) dupWarn.value = []
  }
}
let _dupTimer = null
watch(
  () => [
    props.open,
    form.value.dimension,
    form.value.target_type,
    form.value.scope_name,
    form.value.target_year,
    form.value.effective_start,
    form.value.effective_end,
    monthlyRows.value.map(r => `${r.amtWan || 0}`).join(','),
  ],
  () => {
    if (!props.open) { dupWarn.value = []; return }
    clearTimeout(_dupTimer)
    _dupTimer = setTimeout(runPrecheck, 400)
  },
)
onBeforeUnmount(() => clearTimeout(_dupTimer))

/* ---------------- v128：同一年份已有目标 —— 提示 + 一键编辑（不自动覆盖） ----------------
   只提示、不灌数据：用户可能确实想给别的品牌再建一条，自动带出会让人以为在新建、实际在改旧的。
   匹配口径：维度相同 + 年份相同 + 作用对象（scope_key / scope_name 任一命中）+ 只看启用中的规则。 */
const yearHitDismissed = ref(false)
const yearHits = computed(() => {
  if (editing.value) return []          // 编辑/复制态不提示（提示的是自己）
  const f = form.value
  const y = Number(f.target_year)
  if (!y) return []
  const mine = [f.scope_key, f.scope_name]
    .map(s => String(s == null ? '' : s).trim()).filter(Boolean)
  if (!mine.length) return []           // 还没填作用对象 → 无从判断，不打扰
  return (props.existingRules || []).filter(r => {
    if (Number(r.is_active) !== 1) return false
    if (r.dimension !== f.dimension) return false
    if (Number(r.target_year || 0) !== y) return false
    const theirs = [r.scope_key, r.scope_name]
      .map(s => String(s == null ? '' : s).trim()).filter(Boolean)
    return theirs.some(s => mine.indexOf(s) >= 0)
  }).map(r => ({ ...r, __summary: ruleMonthlySummary(r) }))
})
const yearHitsVisible = computed(() => !yearHitDismissed.value && yearHits.value.length > 0)
// 换了维度 / 作用对象 / 年份 → 提示条重新生效（否则 dismiss 后换品牌就再也不提示了）
watch(
  () => [form.value.dimension, form.value.scope_name, form.value.target_year],
  () => { yearHitDismissed.value = false },
)
function goEditExisting(r) { emit('load-existing', r) }
function dismissYearHits() { yearHitDismissed.value = true }

/** v126：给某一个月加一档 / 删一档（月级阶梯） */
function addMonthTier(mm) {
  const row = monthlyRows.value.find(r => r.mm === mm)
  if (!row) return
  row.tiers = Array.isArray(row.tiers) ? row.tiers : []
  row.tiers.push(emptyTier())
}
function removeMonthTier({ mm, i }) {
  const row = monthlyRows.value.find(r => r.mm === mm)
  if (row && Array.isArray(row.tiers)) row.tiers.splice(i, 1)
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
// v128：弹窗内「编辑这条」会就地切到 edit 模式（open 不变），靠这个 watch 重新初始化
watch(() => [props.mode, props.rule && props.rule.id], () => { if (props.open) init() })

function init() {
  const r = props.rule
  showMigrate.value = false
  migrateInfo.value = null
  yearHitDismissed.value = false
  if (props.mode === 'edit' && r) {
    editing.value = true
    form.value = { ...r }
    if (form.value.target_year == null) form.value.target_year = currentYear
    if (form.value.target_unit == null) form.value.target_unit = ''
    ruleTiers.value = parseRuleTiers(r.tiers_json)
    targetWan.value = (Number(r.target_value) || 0) / 10000
    arrivalPreview.value = null
    const { notice } = fillMonthlyFromRule(monthlyRows.value, r, { isBrandMonthly: form.value.dimension === 'brand' && form.value.target_type === 'amount' })
    legacyNotice.value = notice
    loadArrivalPreview()
  } else if (props.mode === 'dup' && r) {
    editing.value = false
    form.value = duplicateForm(r, { defaultCadence: props.defaultCadence, currentYear })
    targetWan.value = (Number(r.target_value) || 0) / 10000
    arrivalPreview.value = null
    ruleTiers.value = parseRuleTiers(r.tiers_json)
    const { notice } = fillMonthlyFromRule(monthlyRows.value, r, { isBrandMonthly: form.value.dimension === 'brand' && form.value.target_type === 'amount' })
    legacyNotice.value = notice
  } else {
    editing.value = false
    form.value = defaultForm({ presetDim: props.presetDim, defaultCadence: props.defaultCadence, currentYear })
    targetWan.value = 0
    arrivalPreview.value = null
    ruleTiers.value = []
    legacyNotice.value = ''
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
    if (!Object.keys(monthly.monthlyAmounts).length) {
      toast('请至少填写一个月的目标金额 —— 可以只在「全年目标」填一个数，自动均分到 12 个月', 'error'); return
    }
    // v126：阶梯模式下返利由各月档位承载，不再要求每月返利率
    if (f.trigger_mode !== 'tiered' && !Object.keys(monthly.monthlyRates).length) {
      toast('请至少填写一个月的返利率 —— 可以只在「全年返利率」填一个数，12 个月统一', 'error'); return
    }
    if (f.trigger_mode === 'tiered' && !Object.keys(monthly.monthlyTiers).length
        && !(ruleTiers.value || []).length) {
      toast('阶梯模式：请配置「默认档位」，或给某个月单独配档位', 'error'); return
    }
    f.monthly_amounts = monthly.monthlyAmounts
    f.monthly_rates = Object.keys(monthly.monthlyRates).length ? monthly.monthlyRates : {}
    f.monthly_tiers = Object.keys(monthly.monthlyTiers).length ? monthly.monthlyTiers : {}
    f.target_value = Object.values(monthly.monthlyAmounts).reduce((s, v) => s + (Number(v) || 0), 0)
    targetWan.value = f.target_value / 10000
    f.period_type = 'year'
    f.rebate_basis = 'rate'
    if (f.trigger_mode !== 'tiered') {
      f.trigger_mode = 'on_target'
      f.trigger_threshold = 1
      f.tiers_json = ''
      const _r1 = monthlyRows.value.find(r => r.ratePct != null && Number(r.ratePct) > 0)
      f.rebate_rate = _r1 ? Math.round(Number(_r1.ratePct) * 1000) / 100000 : 0
    }
  } else {
    f.monthly_amounts = {}
    f.monthly_rates = {}
    f.monthly_tiers = {}
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
    // v126：档位可以全部下沉到月（monthly_tiers），顶层只作「未配月份」的回退，
    // 因此顶层为空但月表有档位是合法的。
    const _hasMonthTiers = Object.keys(monthly.monthlyTiers || {}).length > 0
    if (!tiers.length && !_hasMonthTiers) {
      toast('阶梯模式：请配置「默认档位」，或给某个月单独配档位', 'error'); return
    }
    if (tiers.length) {
      for (let i = 0; i < tiers.length; i++) {
        const t = tiers[i]
        if (!(t.from_pct < t.to_pct)) { toast('第 ' + (i + 1) + ' 档：起始达成率必须小于结束达成率', 'error'); return }
        if (f.rebate_basis === 'rate' && !(t.rebate_rate > 0 && t.rebate_rate <= 1)) { toast('第 ' + (i + 1) + ' 档：返利比例须在 (0,1] 之间', 'error'); return }
        if (f.rebate_basis === 'fixed' && t.rebate_amount <= 0) { toast('第 ' + (i + 1) + ' 档：固定金额须大于 0', 'error'); return }
      }
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
        // v125：冲突月份（跨「年度/单期」口径）
        monthsText: [...new Set(e.payload.conflicts.flatMap(c => c.months || []))].sort().join('、'),
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
/* v125：重复目标预检提示（黄底，与红色硬错误区分：只是提醒，保存仍由后端裁决） */
.dup-warn{display:flex;gap:8px;align-items:flex-start;margin:2px 0 8px;padding:8px 10px;border-radius:8px;
  background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.4);font-size:12.5px;color:var(--t2);line-height:1.6}
.dup-warn svg,.dup-warn .icon{width:15px;height:15px;flex:none;margin-top:2px;color:#b45309}
.dup-warn b{color:var(--t1)}
.dup-warn p{margin:2px 0}
.dup-warn .dup-tip{color:var(--t3)}
/* v128：同年份已存在提示（蓝底，与「月份被占用」的黄底区分 —— 这个可以一键跳编辑） */
.year-hit{background:rgba(59,130,246,.08);border-color:rgba(59,130,246,.45)}
.year-hit svg,.year-hit .icon{color:#1d4ed8}
.yh-act{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.cf-tbl{width:100%;margin-bottom:12px}
.cf-sol{font-size:12.5px;color:var(--t3);line-height:1.7;background:var(--bg2);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:10px 12px;margin:0}
.cf-sol b{color:var(--t1)}
.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
.modal-enter-active,.modal-leave-active{transition:all .25s ease}
.modal-enter-from,.modal-leave-to{opacity:0;transform:translate(-50%,-46%)}
@media(max-width:768px){ .form-grid2{grid-template-columns:1fr} .modal-card{width:94vw} }
</style>
