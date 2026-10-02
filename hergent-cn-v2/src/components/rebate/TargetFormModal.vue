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
            :arrival-preview="arrivalPreview" :skips-dirty="skipsDirty" :skip-effect="skipEffect"
            :first-arrival-date="firstArrivalDate" :arrival-weekday="arrivalWeekday" :lead-err="leadErr"
            :lead-valid="leadValid" :is-order-wk="isOrderWk"
            @update:annual-target="v => (annualTargetWan = v)"
            @update:annual-rate="v => (annualRatePct = v)"
            @clear-monthly="clearMonthly"
            @add-tier="ruleTiers.push(emptyTier())" @remove-tier="i => ruleTiers.splice(i,1)"
            @add-month-tier="addMonthTier" @remove-month-tier="removeMonthTier"
            @lead-input="onLeadInput" @arrival-change="onArrivalChange"
            @toggle-wk="toggleOrderWk" @open-migrate="openMigrate"
            @toggle-skip="toggleSkip" @reset-skips="resetSkips" @align-count="alignCount"
          />
          <ProductTargetForm
            v-else
            :form="form" :target-wan="targetWan" :rule-tiers="ruleTiers" :scale-options="scaleOptions"
            @update:target-wan="v => (targetWan = v)"
            @add-tier="ruleTiers.push(emptyTier())" @remove-tier="i => ruleTiers.splice(i,1)"
          />

          <!-- 共用：生效期 / 优先级 / 启用 -->
          <!-- v292（2026-09-27）文案修正：这两个日期是**规则整体的启停窗口**，不决定
               "它在哪几个月生效" —— 带「月度分解」的规则由分解的月份决定适用月份，
               生效期完全不参与（见 domain/rebate_period.py::covered_months）。
               旧文案「生效结束」极易被读成"这个目标只算到这一天"：实际事故是把它填成
               09-30 期待"10 月不再生效"，而 10 月照常生效（要停用只能改下面的「启用」开关）；
               它唯一被误用的地方是返利冲刺看板的周期截止日（v292 已改为当月月末）。
               改成「规则启用日 / 规则停用日」并补一行说明，让字段名自己说清边界。 -->
          <div class="form-grid2">
            <div class="form-row"><label>规则启用日</label><input v-model="form.effective_start" class="input" type="date"></div>
            <div class="form-row"><label>规则停用日</label><input v-model="form.effective_end" class="input" type="date"></div>
          </div>
          <div class="cf-tip">这两个日期只管这条规则整体的启用 / 停用，<b>不决定它在哪几个月生效</b>；某个月是否参与返利，请看上方「月度分解」里有没有填这个月。要整条停用，请把下面的「启用」改为停用。</div>
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
          <!-- 已经保存成功了就不再给「取消」（那会让人以为还能撤掉这次保存） -->
          <button v-if="!(skipEffect && skipEffect.length)" class="btn btn-ghost" @click="close">取消</button>
          <!-- v365：保存后如果「停单/取消停单」顺带改变了期次，面板会**留在原地**把回执给用户看
               （关掉了就等于没说过 —— 这条回执的价值恰恰在于"用户几周后才会发现期次少了一期"，
                一闪而过或根本不显示都等于没提醒）。此时主按钮变成「关闭」。 -->
          <button v-if="skipEffect && skipEffect.length" class="btn btn-primary" @click="close">
            关闭
          </button>
          <button v-else class="btn btn-primary" @click="save">{{ editing ? '保存' : '创建' }}</button>
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
const formNameRef = ref(null)
const showMigrate = ref(false)
const migrateInfo = ref(null)

/* ---------------- v364：本月到货「停单 / 次数」——按月作用域 ----------------
   🔴 这两个状态**不属于规则本身**，而是「规则 × 某个月」的一条记录
      （后端 rebate_arrival_skips，唯一索引 rule_id+ym）。
      为什么不能继续塞进 form：以前它是规则上的列 `arrival_count_override` —— **永久列**，
      10 月填的次数会一路生效到 11、12 月，用户想回到系统推算只能每月手动改一次；
      而"停一单"这件事则完全没地方表达（旧列只有"几次"，没有"哪一天"）。
      用户原话：「改动的这个规则只保持到这个月，下个月自动以系统推算为准。」
      ⇒ 按月存是唯一能满足它的数据模型，所以它天然不是表单字段。 */
const skips = ref({ skip_dates: '', count_override: null })
/** 打开面板时的快照 —— 只用来判断"用户动过没有"（决定保存时要不要写这张表） */
const loadedSkips = ref({ skip_dates: '', count_override: null })
/**
 * v365：**保存后**由后端回执的「这次停单让哪几期的报单期次不再自动新建」。
 *   🔴 必须由后端算、不由前端推 —— 到货日↔期次是「期次.arrival_date == 停单日」的
 *      等值关系，且期次的报单窗口**可能落在上一个月**（到货 10-05 ⇒ 报单窗口 9/30~10/01）。
 *      前端看不到「本租户有没有开自动建表」「这一期是不是已经建好了」，自己推必然说错。
 *   改动未落库时**立刻清空**（别拿旧结论当现状）。
 */
const skipEffect = ref([])
/** 面板对应的自然月（与后端 arrival-preview / arrival-skips 的缺省口径一致 = 今天所在月） */
const ymNow = computed(() => {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
})
const skipsDirty = computed(() => {
  const a = skips.value || {}, b = loadedSkips.value || {}
  return String(a.skip_dates || '') !== String(b.skip_dates || '')
    || (a.count_override ?? null) !== (b.count_override ?? null)
})

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
  /* v364：本月到货安排（停单日 + 次数覆盖）**按月**传，不再走 f.arrival_count_override 那个永久列。
     · skip_dates **空串也要传** —— 后端用 `is not None` 判断"显式传了"，空串 = 显式清掉停单；
       不传的话后端会去读库里已存的记录，预览就会和表单上正在编辑的状态不一致。
     · override 只在真的填了数字时传（缺省 -1 = 无覆盖）。 */
  params.set('skip_dates', String(skips.value.skip_dates || ''))
  const _co = skips.value.count_override
  if (_co != null && Number(_co) > 0) params.set('override', String(_co))
  params.set('target_value', tv)
  try {
    const r = await api('/api/rebate-rules/arrival-preview?' + params.toString())
    if (r) arrivalPreview.value = r
  } catch (e) { /* 预览失败不阻断编辑 */ }
}
watch(
  () => [form.value.arrival_mode, form.value.arrival_first_dom, form.value.arrival_cadence_days,
         form.value.arrival_weekdays, skips.value.skip_dates, skips.value.count_override,
         form.value.target_type, targetWan.value,
         form.value.target_value, monthlySumWan.value, form.value.order_mode, form.value.order_first_date,
         form.value.order_cadence_days, form.value.order_weekdays, form.value.order_lead_days],
  () => {
    if (_apTimer) clearTimeout(_apTimer)
    _apTimer = setTimeout(loadArrivalPreview, 300)
  }
)
onBeforeUnmount(() => {
  if (_apTimer) clearTimeout(_apTimer)
})

/* ---------------- v364：本月到货停单（点日期）/ 恢复系统推算 / 按日历对齐次数 ---------------- */
/** 该月停单日：CSV ↔ 数组的**唯一**转换口（两处各写一遍 split 就会漂移） */
function skipList(s) {
  return String((s && s.skip_dates) || '').split(',').map(x => x.trim()).filter(Boolean)
}
/** 立刻重算预览，不等 300ms 防抖 —— 点日期是离散动作，等防抖只让人觉得"点了没反应" */
function _refreshNow() {
  if (_apTimer) clearTimeout(_apTimer)
  loadArrivalPreview()
}
/**
 * 点一下某天 = 这一天不进货 / 再点一下恢复。
 * 🔴 **不改节奏**：停掉 10-05，10-07 照常到（用户原话：「不会因为停单而改变」）——
 *    后端 apply_month_skips 只从日历里剔除这一天，不重排后续日期。
 */
function toggleSkip(d) {
  const cur = skipList(skips.value)
  const i = cur.indexOf(d)
  if (i >= 0) cur.splice(i, 1); else cur.push(d)
  cur.sort()
  skips.value = { ...skips.value, skip_dates: cur.join(',') }
  skipEffect.value = []      // v365：改动还没落库 ⇒ 立刻撤掉上一版的影响说明（别拿旧结论当现状）
  _refreshNow()
}
/** 恢复系统推算：停单日与次数覆盖一起清掉（= 后端删该月记录的效果），**只对本月** */
function resetSkips() {
  skips.value = { skip_dates: '', count_override: null }
  skipEffect.value = []
  _refreshNow()
}
/**
 * 「次数」与「日历」对不上时，采信**日历**（停了几天的天数才是真的）。
 * 存量迁移过来的旧值只有次数、没有哪一天 ⇒ 用户改报单周期后两者必然打架，
 * 这个按钮给一条明确的收敛路径，而不是让用户自己猜"以哪个为准"。
 */
function alignCount() {
  skips.value = { ...skips.value, count_override: null }
  skipEffect.value = []
  _refreshNow()
}
/** 读该规则**本月**已存的到货安排。读不到就按"本月没调过"（与面板缺省显示一致），不阻断编辑。 */
async function loadMonthSkips(rid) {
  if (!rid) { loadArrivalPreview(); return }
  const [_y, _m] = ymNow.value.split('-').map(Number)
  try {
    const r = await rebateApi.arrivalSkips(rid, _y, _m)
    // skip_dates_stored = 库里**原样存的那串**（不是 summary.skipped：后者只含"确实落在
    // 当前系统日历里"的日子，回读会丢，再存一次就把用户停的那天悄悄抹掉）。
    const sd = (r && r.skip_dates_stored) || ''
    const co = (r && r.count_override != null) ? Number(r.count_override) : null
    skips.value = { skip_dates: sd, count_override: co }
    loadedSkips.value = { skip_dates: sd, count_override: co }
  } catch (e) {
    /* 读失败（表未就绪 / 网络）：按"本月没调过"显示。真正保存时后端会**明确报错**，
       不会静默吞掉用户的改动 —— 所以这里不提示也不阻断。 */
  }
  loadArrivalPreview()
}
/**
 * 把本月调整落库。返回 `{err, affected}`：`err` 空串 = 成功；`affected` = 后端回执的
 * 「哪几期的报单期次（不再 / 恢复）自动新建」。
 * 🔴 `count_override` 只在**确实存在或确实被清掉**时才带这个键：后端用 `in body` 判断
 *    "动没动"，不传 = 保留原值。否则用户点一下停单日，就会把迁移来的「15 次」静默抹成
 *    按日历算的 16 次。
 */
async function saveMonthSkips(rid) {
  if (!skipsDirty.value) return { err: '', affected: null }
  if (!rid) return { err: '规则编号没拿到，请重新打开这条规则再保存一次', affected: null }
  const [_y, _m] = ymNow.value.split('-').map(Number)
  const _coNow = skips.value.count_override
  const _coWas = loadedSkips.value.count_override
  const body = {
    year: _y,
    month: _m,
    skip_dates: String(skips.value.skip_dates || ''),
  }
  if (_coNow != null || _coWas != null) {
    body.count_override = (_coNow != null && Number(_coNow) > 0) ? Number(_coNow) : null
  }
  try {
    const res = await rebateApi.saveArrivalSkips(rid, body)
    loadedSkips.value = { ...skips.value }
    return { err: '', affected: (res && res.affected_periods) || null }
  } catch (e) {
    return { err: (e && e.message) || '未知错误', affected: null }
  }
}

/**
 * v365：把「这次调整让哪几期的报单期次不再自动新建」翻成人话。
 * 🔴 为什么必须说：停单的直觉后果只有「少一次到货」，真实后果还包含「那一期的报单窗口
 *    不会再自动开」—— 用户看不到这一层，几周后只会发现「期次怎么少了一期」而无从追溯。
 * 🔴 同时如实区分「还有没有实际影响」：期次已建好 / 填报窗口已过 ⇒ 明说不影响，
 *    别把已经无关的事渲染成"已排除"，那是制造虚假的紧张感。
 */
function _skipEffectLines(af) {
  if (!af || !af.computed) return []
  const list = af.affected || []
  if (!list.length) {
    if (af.brand_joins === false) {
      return ['该品牌还没填「首次报单日」，所以停单只影响到货次数和均单，'
        + '不会影响报单期次（期次是按品牌报单节奏自动建的）。']
    }
    return ['本月停的这几天不在报单期次序列上，不影响自动建期次。']
  }
  const lines = []
  list.forEach(p => {
    const who = `${p.arrival_date} 到货的那一期（报单日 ${p.order_date}）`
    const still = (p.still_arriving || []).filter(Boolean)
    const tail = p.existed
      ? `（期次#${p.period_id} 已经建好了）`
      : '（它会在填报窗口打开时自动建出来）'
    // 🔴 取消停单（effect=restore）要用「恢复」的措辞，而且**不能**再劝用户去别的品牌点掉 ——
    //    他刚做的动作就是把停单取消掉，还叫他去点掉另一个品牌是彻底的反向指引。
    //    后端已按「摘掉这一条规则之后」算结论（不是"取消前"），所以这里的 p.excluded 是
    //    **取消之后**的事实：只要还有任一品牌那天送货，这一期就会照建。
    if (p.effect === 'restore') {
      if (!p.excluded) {
        lines.push(`${who} 会恢复自动新建：${still.join('、')}那天有货到${tail}。`)
      } else {
        lines.push(`${who} 仍不会自动新建：那天所有品牌都没货到。`)
      }
      return
    }
    // 🔴 必须按后端的**最终结论** p.excluded 分支：只停了部分品牌时这一期**照建**。
    //    若只看「有没有被列进 affected」就说"不再自动新建"，就与后端结论相反。
    if (!p.excluded) {
      lines.push(`${who}仍会按期建：${still.join('、')}那天还有货到${tail}。`
        + `要让这一天整批都不建，请到「${still.join('、')}」的到货节奏里也点掉 ${p.arrival_date}。`)
      return
    }
    const act = '不再自动新建'
    let t2
    if (p.existed) {
      t2 = `但这一期已经建好了（期次#${p.period_id}），系统不会去动它 —— 要作废请手工关单`
    } else if (p.window === 'past') {
      t2 = '它的填报窗口已经过了，本来也不会再自动建 —— 需要的话请手工新建'
    } else if (p.window === 'open') {
      t2 = '它的填报窗口正开着，但系统没建它'
    } else {
      t2 = `它将在 ${p.open_at} 打开填报，届时不会自动建表`
    }
    lines.push(`${who} ${act}，${t2}。`)
  })
  if (!af.auto_enabled) {
    lines.push('⚠ 当前是「手动建表」模式，自动建期次本来就没在跑；'
      + '切回「自动建表」之后上面的结论才起作用。')
  }
  return lines
}

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
// v365：每次打开都清掉上一版「停单影响期次」回执 —— 面板是常驻组件（父层只切 open），
//   不清的话下次打开会看到**上一次停单**的结论，而库里的状态可能早变了（界面骗人）。
watch(() => props.open, (v) => { if (v) { skipEffect.value = []; init() } })
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
    /* v364：`arrival_count_override` 是规则上的**永久**列，已被"按月"的口径取代
       （后端也在启动期把它迁移到本月记录并清空）。这里显式置 null，保证即使某个老租户
       库里还残留着值，保存时也不会把它再写回去、重新变成跨月生效的坑。 */
    form.value.arrival_count_override = null
    ruleTiers.value = parseRuleTiers(r.tiers_json)
    targetWan.value = (Number(r.target_value) || 0) / 10000
    arrivalPreview.value = null
    // 本月停单先按"没调过"起步（预览立刻出系统推算），再异步补上库里已存的那份
    skips.value = { skip_dates: '', count_override: null }
    loadedSkips.value = { skip_dates: '', count_override: null }
    const { notice } = fillMonthlyFromRule(monthlyRows.value, r, { isBrandMonthly: form.value.dimension === 'brand' && form.value.target_type === 'amount' })
    legacyNotice.value = notice
    loadMonthSkips(r.id)
  } else if (props.mode === 'dup' && r) {
    editing.value = false
    form.value = duplicateForm(r, { defaultCadence: props.defaultCadence, currentYear })
    targetWan.value = (Number(r.target_value) || 0) / 10000
    arrivalPreview.value = null
    // 复制的是"规则"，**不复制本月停单** —— 停单是本月的事实，不是规则的一部分。
    // （新规则此刻还没有 id，本来也无处可存；保存时若用户点过日历会随 save 一起落库。）
    skips.value = { skip_dates: '', count_override: null }
    loadedSkips.value = { skip_dates: '', count_override: null }
    ruleTiers.value = parseRuleTiers(r.tiers_json)
    const { notice } = fillMonthlyFromRule(monthlyRows.value, r, { isBrandMonthly: form.value.dimension === 'brand' && form.value.target_type === 'amount' })
    legacyNotice.value = notice
  } else {
    editing.value = false
    form.value = defaultForm({ presetDim: props.presetDim, defaultCadence: props.defaultCadence, currentYear })
    targetWan.value = 0
    arrivalPreview.value = null
    skips.value = { skip_dates: '', count_override: null }
    loadedSkips.value = { skip_dates: '', count_override: null }
    ruleTiers.value = []
    legacyNotice.value = ''
    monthlyRows.value = emptyMonthlyRows()
  }
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
  // v282（2026-09-26）：允许「只配到货节奏、不设返利目标」的品牌规则，与后端 validate_rule 同口径。
  //   为什么需要：报单页的「均单目标」提示要求「该品牌有启用的到货规则」，而到货规则只能挂在
  //   品牌规则上；但经销商手里往往只有部分品牌有厂商下发的返利目标 ⇒ 原校验会**逼用户编一个假目标**。
  //   两条约束（缺一不可）：① 确实配了节奏 ② 返利率为 0（不产生任何返利金额）。
  const _hasRhythm = !!String(f.order_first_date || '').trim()
    || Number(f.order_cadence_days || 0) > 0
    || !!String(f.order_weekdays || '').trim()
    || Number(f.arrival_cadence_days || 0) > 0
    || !!String(f.arrival_weekdays || '').trim()
  if (!f.target_value || f.target_value <= 0) {
    if (!_hasRhythm) {
      toast('目标值必须 > 0（若这条规则只用来配「到货节奏」，请先填「首次报单日」或报单周期）', 'error')
      return
    }
    if (Number(f.rebate_rate || 0) > 0 || Number(f.rebate_amount || 0) > 0) {
      toast('没填目标值时不能设返利 —— 请把返利比例/金额改为 0', 'error')
      return
    }
  }
  if (f.order_mode === 'weekday' && !f.order_weekdays) { toast('请选择至少一个报单星期', 'error'); return }
  if (f.order_first_date && !leadValid.value) {
    toast(leadErr.value || '「提前天数」须为 0~30 的整数', 'error'); return
  }
  // v360：比例返利**允许填 0**（= 本月确实没有返利），但**留空 / 非数字仍然拦**。
  //   🔴 这条「空值」判据只能在前端做：后端 `_coerce_num('', 0)` 与 `float('0')` 都得到 0，
  //      光看后端根本无法把「没填」与「显式填 0」分开（故 defaultForm 的初值特意用 ''，
  //      见 useRebateTargetForm.js 的注释）。后端另有一条同源判据 `_is_num_like` 兜底直连 API。
  //   为什么只判单值模式（!monthlyOn）：月度分解下 f.rebate_rate 是「最早非零月」的**投影值**，
  //      由月表算出（下方 monthlyOn 分支），不是用户直接填的那一格 —— 在那里判空会误报。
  //   月度模式下的「空」由月表门槛负责：「请至少填写一个月的返利率」（只认真正填过的月）。
  if (f.trigger_mode === 'on_target' && f.rebate_basis === 'rate') {
    const _rr = f.rebate_rate
    const _rrBlank = (_rr === '' || _rr == null)
    if (!monthlyOn.value && (_rrBlank || isNaN(Number(_rr)))) {
      toast('请填写返利值 —— 本月确实没有返利请填 0，不要留空', 'error'); return
    }
    if (!_rrBlank && (Number(_rr) < 0 || Number(_rr) > 1)) {
      toast('返利比例须 0~1（如 0.02 = 2%；填 0 = 本月无返利）', 'error'); return
    }
  }
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
    let _rid = 0
    if (editing.value) {
      await rebateApi.update(f.id, f)
      _rid = Number(f.id) || 0
    } else {
      const res = await rebateApi.create(f)
      // create 返回 {"success":true,"id":N,"rule":{...}}（api() 不解 data 层 ⇒ 直接取 id）
      _rid = Number((res && (res.id || (res.rule && res.rule.id))) || 0)
    }
    /* v364：本月到货调整**单独**落库（只写这一个月）。
       为什么放在规则保存**之后**：新建时此刻才拿到 rule_id。
       为什么失败**不回滚**规则：用户填的是一整张目标表，不能因为"停单这一栏没存下"
       整表白填 —— 但必须**明确告诉他哪部分没存下**，不能静默。
       （后端在数据表未就绪时返回 503 而不是假装成功，就是为了让这句话有意义。） */
    const _skipRes = await saveMonthSkips(_rid)
    if (_skipRes.err) {
      toast('规则已保存；本月到货调整没保存成功：' + _skipRes.err, 'error')
    } else {
      /* v365：停单还会改变「系统会不会自动建那一期」，用户看不到这一层 ——
         把后端回执留在面板上（不是一闪而过的 toast）。 */
      skipEffect.value = _skipEffectLines(_skipRes.affected)
      toast(editing.value ? '已保存' : '已创建', 'success')
    }
    emit('saved')
    /* v365：有回执就**不关面板** —— 让用户看完再自己关（主按钮此时是「关闭」）。
       没有回执时保持原来的行为（保存完即关）。 */
    if (!skipEffect.value.length) close()
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
