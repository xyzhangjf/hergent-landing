<template>
    <!-- v691：骨架走公共 Modal；回车提交仍绑在正文容器上（Enter 在输入框里冒泡到它） -->
    <Modal guard-close :show="open" :width="580" :title="title" @close="close">
        <div class="cf-body" @keydown.enter="onFormEnter">
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
          <!-- v702：作用对象统一为**供应商**（原为品牌名 / 商品名纯文本输入）。
               🔴 为什么换：返利目标在实务上按「厂家户头」谈与结算 —— 生产 38 个供应商
                  里「福宝低温 / 滋低温 / 蒙牛鲜奶（7579）」各自是独立户头，而品牌档案只有 4 条、
                  且「蒙牛低温」这种词对不上任何一个供应商 ⇒ 用品牌当作用对象，目标挂不到真实户头上。
               🔴 新建可多选（各自独立成一条目标，见 scopeNote 与 save() 的扇出）；
                  编辑只允许单选 —— 一条已有记录改成多选等于"一条变多条"，删除语义无人表达。 -->
          <div class="form-row"><label>作用对象（供应商）</label>
            <SupplierPicker v-model="selectedSups" :suppliers="supplierOptions"
                            :multiple="!editing"
                            :placeholder="editing ? '选择这条目标的供应商' : '点击选择供应商（可多选）'">
            </SupplierPicker>
            <div class="sp-note" :class="{ 'sp-note-link': legacyScope }">{{ scopeNote }}</div>
          </div>

          <!-- v128：同一年份已有目标 —— 只提示 + 一键跳转编辑，不自动覆盖用户输入 -->
          <div v-if="yearHitsVisible" class="dup-warn year-hit">
            <Icon name="alert-triangle" />
            <div>
              <b>{{ form.target_year }} 年这个对象已经有目标了</b>
              <p v-for="r in yearHits" :key="r.id">
                「{{ r.rule_name || ('规则#' + r.id) }}」
                <span class="yh-scope">对象：{{ r.scope_name || '全部供应商' }}</span>
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
        <template #footer>
          <!-- 已经保存成功了就不再给「取消」（那会让人以为还能撤掉这次保存） -->
          <button v-if="!(skipEffect && skipEffect.length)" class="btn btn-ghost" @click="close">取消</button>
          <!-- v365：保存后如果「停单/取消停单」顺带改变了期次，面板会**留在原地**把回执给用户看
               （关掉了就等于没说过 —— 这条回执的价值恰恰在于"用户几周后才会发现期次少了一期"，
                一闪而过或根本不显示都等于没提醒）。此时主按钮变成「关闭」。 -->
          <button v-if="skipEffect && skipEffect.length" class="btn btn-primary" @click="close">
            关闭
          </button>
          <button v-else class="btn btn-primary" @click="save">{{ editing ? '保存' : '创建' }}</button>
        </template>
    </Modal>

    <!-- v121 合并：旧到货排程(arrival_*) → 报单节奏(order_*) 反推迁移 -->
    <Modal guard-close :show="showMigrate" :width="580" title="把旧的到货排程，换算成报单节奏"
           @close="showMigrate = false">
        <div class="cf-body">
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
        <template #footer>
          <button class="btn" @click="showMigrate=false">以后再说</button>
          <button class="btn btn-primary" @click="applyMigrate">确认换算</button>
        </template>
    </Modal>
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
import Modal from '../Modal.vue'
import BrandTargetForm from './BrandTargetForm.vue'
import ProductTargetForm from './ProductTargetForm.vue'
import SupplierPicker from './SupplierPicker.vue'
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
  /** v702：作用对象候选 = 供应商（contacts type='supplier'）。由父页一次性传入。 */
  supplierOptions: { type: Array, default: () => [] },
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
  /* v702：新建多选供应商时**不做实时预检** —— 预检只吃一个 scope，拿第一个去问会把
     "其余几个也行/不行"混成一个结论。多选的冲突改在提交后按条回报（save() 里逐个 create，
     409 会落进 _failed 并点名供应商）。 */
  if (!editing.value && selectedSups.value.length > 1) { dupWarn.value = []; return }
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
/* 🔴 v702：预检 watch 已**下移**到 `selectedSups` 定义之后（见「作用对象（供应商）」段末）。
   原因：Vue 3 的 watch 对 **getter 函数**会 `effect.run()` 立即求值取 oldValue ⇒
   在 `const selectedSups` 之前引用它就是 TDZ，表现为**整页白屏且控制台没有显眼报错**
   （本仓 v701 为同一个病付过一次代价，不要再犯）。 */
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
  /* v702：匹配口径跟着作用对象走 —— 已选供应商时用「供应商 id / 名称」两者任一命中。
     id 命中的场景：以前选过同一供应商但后来改了它的名字。 */
  const mine = []
  selectedSups.value.forEach(s => { mine.push(String(s.id)); mine.push(String(s.name || '')) })
  if (legacyScope.value) {
    mine.push(String(legacyScope.value.key || ''))
    mine.push(String(legacyScope.value.name || ''))
  }
  const mineStr = mine.map(s => String(s == null ? '' : s).trim()).filter(Boolean)
  if (!mineStr.length) return []           // 还没填作用对象 → 无从判断，不打扰
  return (props.existingRules || []).filter(r => {
    if (Number(r.is_active) !== 1) return false
    if (r.dimension !== f.dimension) return false
    if (Number(r.target_year || 0) !== y) return false
    const theirs = [r.scope_key, r.scope_name]
      .map(s => String(s == null ? '' : s).trim()).filter(Boolean)
    return theirs.some(s => mineStr.indexOf(s) >= 0)
  }).map(r => ({ ...r, __summary: ruleMonthlySummary(r) }))
})
const yearHitsVisible = computed(() => !yearHitDismissed.value && yearHits.value.length > 0)
// 「换了对象就重新提示」的 watch 同样下移到 selectedSups 之后（TDZ，同上）。
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
    // 🔴 v368（老板拍板）：排除判定已从「全停才排除」改为「**任一品牌停 ⇒ 整期不建**」。
    //    ⇒ 四种情形**必须**分开说，合并任何一种都会让界面与后端结论相反：
    //      skip+excluded   不再自动新建（并交代谁跟着一起停了）
    //      restore+excluded **仍不建**（还有别的品牌那天停着 —— 要点名是谁）
    //      restore+!excluded 会恢复自动新建
    //      skip+!excluded  理论上不存在（打了就必中），留着当护栏，不许静默吞掉
    const off = (p.skipped_brands || []).filter(Boolean)
    if (p.effect === 'restore') {
      if (!p.excluded) {
        lines.push(`${who} 会恢复自动新建${tail}。`)
      } else {
        lines.push(`${who} 仍不会自动新建：「${off.join('、') || '其它品牌'}」那天仍标记不到货`
          + '（只要有任一品牌不到货，这一期就整期不建）。')
      }
      return
    }
    if (!p.excluded) {
      // 护栏：v368 下打了就必中，走到这里说明后端口径又变了 ⇒ 说"照建"并点名，不许装作没事。
      lines.push(`${who}仍会按期建：${still.join('、')}那天还有货到${tail}。`)
      return
    }
    const act = '不再自动新建'
    let t2
    if (p.existed) {
      // v368：已建好的期次现在有「一键作废」入口了 —— 指引必须跟着改，不能再说"手工关单"
      t2 = `但这一期已经建好了（期次#${p.period_id}），系统不会去动它 —— 不需要的话，到期次列表里「一键作废」`
    } else if (p.window === 'past') {
      t2 = '它的填报窗口已经过了，本来也不会再自动建 —— 需要的话请手工新建'
    } else if (p.window === 'open') {
      t2 = '它的填报窗口正开着，但系统没建它'
    } else {
      t2 = `它将在 ${p.open_at} 打开填报，届时不会自动建表`
    }
    lines.push(`${who} ${act}，${t2}。`)
    // v368：如实交代「谁其实有货、但跟着这一期一起不建」—— 判据改成"任一停就不建"之后，
    //       不说这句用户会以为"另一个品牌也不到货"，那就是界面与事实相反。
    if (still.length) {
      lines.push(`注意：「${still.join('、')}」${p.arrival_date}那天其实有货到，`
        + '但只要有任一品牌不到货，这一期就整期不建 —— 要给它们单独报单，请手动新建期次。')
    }
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

/* ---------------- 作用对象（供应商） ----------------
   v702：作用对象从「品牌名 / 商品名纯文本」改为**供应商多选**。
   🔴 数据层仍沿用 scope_key / scope_name 两个字段（后端返利计算、月度锁、判重
      都按 (月份, 维度, 作用对象) 三元组匹配）⇒ 供应商落地方式 = scope_key 存**供应商主键**、
      scope_name 存供应商名称。这样后端**一行都不用改**，计算链路零风险。
   🔴 多选不合并成一条：选 N 个就生成 N 条独立规则（老板拍板口径）。
      合并口径要求把匹配键从单值改成多值，会牵动达成导入 / 月度锁 / 判重 / 冲刺看板 5 处。 */
const selectedSups = ref([])
/** 老规则的作用对象（品牌名）在供应商档案里找不到同名户头 ⇒ 原样保留、只提示不改写 */
const legacyScope = ref(null)

function _supOfHit(h) {
  return {
    id: h.id, name: String(h.name || '').trim(),
    code: String(h.code || '').trim(),
    category: String(h.supplier_category || '').trim(),
  }
}
/** 按 id → 名称精确 的顺序把已有规则的 scope 映射回供应商；都对不上就落 legacyScope */
function fillScopeFromRule(r) {
  selectedSups.value = []
  legacyScope.value = null
  const key = String((r && r.scope_key) == null ? '' : r.scope_key).trim()
  const name = String((r && r.scope_name) == null ? '' : r.scope_name).trim()
  if (!key && !name) return                 // 空 = 全部供应商，与现状一致
  const pool = props.supplierOptions || []
  let hit = key ? pool.find(s => String(s.id) === key) : null
  if (!hit && name) hit = pool.find(s => String(s.name || '').trim() === name)
  if (!hit && key && !/^\d+$/.test(key)) hit = pool.find(s => String(s.name || '').trim() === key)
  if (hit) selectedSups.value = [_supOfHit(hit)]
  else legacyScope.value = { key, name: name || key }
}

/** 提交用：作用对象 → [{ key, name }]。返回单元素空值 = 不指定（全部供应商） */
function scopeTargets() {
  if (selectedSups.value.length) {
    /* 🔴 key 用**供应商名称**而不是主键 id —— 这不是偷懒，是被上下游锁定的：
       ① 后端 `validate_rule` 对 `dimension == 'brand'` 会强制 `scope_key = scope_name`
          （`routers/rebate_rules.py:1125`），传 id 进去也会被覆盖；
       ② 返利计算按 `(月份, 维度, scope_key)` 把**规则**与**达成**配对，而达成记录
          （rebate_achievements）的 scope_key 是 Excel 导入的名称原文 ⇒ 规则侧若用 id，
          两边**永远配不上**，返利一笔都算不出来。
       所以这里与后端保持同一口径，参数名仍叫 key（字段名没变，语义=作用对象标识）。 */
    return selectedSups.value.map(s => ({ key: String(s.name), name: String(s.name) }))
  }
  if (legacyScope.value) {
    return [{ key: legacyScope.value.key || '', name: legacyScope.value.name || '' }]
  }
  return [{ key: '', name: '' }]
}

/** 页面提示：当前所选供应商 + 范围 + 生效规则 */
const scopeNote = computed(() => {
  if (legacyScope.value) {
    const nm = legacyScope.value.name || legacyScope.value.key
    return `原作用对象是「${nm}」，供应商档案里没有同名户头，当前未绑定供应商。`
      + '不改也能按原样保存；要挂到真实户头上，请点上方选成供应商。'
  }
  const arr = selectedSups.value
  if (!arr.length) {
    return editing.value
      ? '未选供应商 = 这条目标作用于全部供应商（与保存前一致）。'
      : '未选供应商 = 这条目标作用于全部供应商。要限定对象，请点上方选择。'
  }
  const names = arr.map(s => s.name).join('、')
  if (editing.value) {
    return `作用对象：${names}。编辑时只能保留一个供应商；要给多个供应商同时设目标，请用「创建」分别建。`
  }
  if (arr.length === 1) {
    return `作用对象：${names}。保存后生成 1 条目标，只有这个供应商的达成会算进来。`
  }
  return `已选 ${arr.length} 个供应商：${names}。`
    + `保存后各自生成 1 条独立目标（共 ${arr.length} 条），目标值各为同一个数、互不影响，之后可分别调整 ——`
    + ' 不是这几家合计。'
})

/* 🔴 这两个 watch 必须留在 `selectedSups` / `legacyScope` 定义**之后** ——
   Vue 3 的 watch 对 getter 会立即 `effect.run()` 取 oldValue，写在定义前就是 TDZ，
   症状是整页白屏、控制台无显眼报错（见文件上半「预检 watch 已下移」那段注释）。 */

/* 🔴 候选（供应商列表）由父页**异步**加载，而 init() 在弹窗打开瞬间就跑完。
   深链打开（?edit_rule=N）/ 父页首屏还没拉完供应商时，init() 会拿着空候选去匹配 ⇒
   「简爱」这种本来能精确对上的对象被**永久**判成「未绑定」（init 只跑一次、不会重试）。
   ⇒ 候选到位后补一次匹配。只在「还没选过任何供应商且正处于未绑定」时重试，
     绝不覆盖用户已经改过的选择。 */
watch(() => (props.supplierOptions || []).length, (n, o) => {
  if (!props.open || !n || n === o) return
  if (selectedSups.value.length) return
  if (!legacyScope.value) return
  const { key, name } = legacyScope.value
  fillScopeFromRule({ scope_key: key, scope_name: name })
})

/* 换作用对象 / 年份 → 「该年已有目标」提示条重新生效 */
watch(
  () => [form.value.dimension, form.value.scope_name, form.value.target_year,
    selectedSups.value.map(s => s.id).join(','), legacyScope.value && legacyScope.value.key],
  () => { yearHitDismissed.value = false },
)

/* 保存前重复目标预检（debounce 400ms，只提示不拦截） */
watch(
  () => [
    props.open,
    form.value.dimension,
    form.value.target_type,
    form.value.scope_name,
    form.value.target_year,
    form.value.effective_start,
    form.value.effective_end,
    selectedSups.value.map(s => s.id).join(','),
    monthlyRows.value.map(r => `${r.amtWan || 0}`).join(','),
  ],
  () => {
    if (!props.open) { dupWarn.value = []; return }
    clearTimeout(_dupTimer)
    _dupTimer = setTimeout(runPrecheck, 400)
  },
)



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
    // v702：作用对象回显 —— 按 id / 名称精确匹配供应商；对不上则落 legacyScope 只提示
    fillScopeFromRule(r)
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
    // 复制出来的对象跟着原件的供应商走（不是"全部"）—— 否则复制出来会静默变成全供应商目标
    fillScopeFromRule(form.value)
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
    // v702：新建从"未选供应商"起步（= 全部），并清掉上一条规则残留的已选/老口径
    selectedSups.value = []
    legacyScope.value = null
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
  /* v702：作用对象的取值统一在下方提交段按「已选供应商 / 老口径 / 全部」三态写回
     scope_key+scope_name —— 这里不再做品牌档案校验，也不再按商品名反解商品 ID
     （作用对象已不是品牌/商品，再校验旧候选表就是拿错表拦人）。 */
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
  /* v702：作用对象落库。
     编辑 / 单选 → 1 条，直接写 scope_key+scope_name；
     新建多选 → **扇出**成 N 条独立规则（名称加「· 供应商名」后缀），
       目标值/月度分解/阶梯/报单节奏原样复制，各自独立、互不影响。 */
  const _targets = scopeTargets()
  const _fanout = !editing.value && _targets.length > 1
  const _baseName = String(f.rule_name || '').trim()
  try {
    let _rid = 0
    /** 扇出时逐个落库，部分失败也要如实报（不能"看着成功其实只建了一条"） */
    const _created = []
    const _failed = []
    if (editing.value) {
      f.scope_key = _targets[0].key
      f.scope_name = _targets[0].name
      await rebateApi.update(f.id, f)
      _rid = Number(f.id) || 0
    } else if (!_fanout) {
      f.scope_key = _targets[0].key
      f.scope_name = _targets[0].name
      const res = await rebateApi.create(f)
      // create 返回 {"success":true,"id":N,"rule":{...}}（api() 不解 data 层 ⇒ 直接取 id）
      _rid = Number((res && (res.id || (res.rule && res.rule.id))) || 0)
    } else {
      for (const t of _targets) {
        const body = { ...f, scope_key: t.key, scope_name: t.name, rule_name: `${_baseName} · ${t.name}` }
        try {
          const res = await rebateApi.create(body)
          const id = Number((res && (res.id || (res.rule && res.rule.id))) || 0)
          _created.push({ name: t.name, id })
          if (!_rid) _rid = id
        } catch (e2) {
          _failed.push({ name: t.name, reason: (e2 && e2.message) || '未知错误' })
        }
      }
      if (!_created.length) {
        throw new Error('一个都没建成 —— ' + _failed.map(x => x.name + '：' + x.reason).join('；'))
      }
    }
    /* v364：本月到货调整**单独**落库（只写这一个月）。
       为什么放在规则保存**之后**：新建时此刻才拿到 rule_id。
       为什么失败**不回滚**规则：用户填的是一整张目标表，不能因为"停单这一栏没存下"
       整表白填 —— 但必须**明确告诉他哪部分没存下**，不能静默。
       （后端在数据表未就绪时返回 503 而不是假装成功，就是为了让这句话有意义。）
       v702：扇出时**每条规则都要写** —— 停单是 rule × 月 的记录，只写第一条会让
       其余几条静默沿用系统推算（用户以为都停了）。 */
    const _skipIds = _fanout ? _created.map(c => c.id) : [_rid]
    let _skipErr = ''
    for (const _sid of _skipIds) {
      // eslint-disable-next-line no-await-in-loop
      const _r = await saveMonthSkips(_sid)
      if (_r.err && !_skipErr) _skipErr = _r.err
      if (!_r.err) skipEffect.value = _skipEffectLines(_r.affected)
    }
    if (_skipErr) {
      toast('规则已保存；本月到货调整没保存成功：' + _skipErr, 'error')
    } else if (_fanout) {
      if (_failed.length) {
        toast(`已建 ${_created.length} 条，${_failed.length} 条没建成：`
          + _failed.map(x => x.name + '（' + x.reason + '）').join('；'), 'error')
      } else {
        // 扇出的回执要说清「是 N 条不是 1 条」，否则用户回列表会以为重复了
        toast(`已为 ${_created.length} 个供应商各建 1 条目标（共 ${_created.length} 条）`, 'success')
      }
    } else {
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
/* v691：弹窗骨架统一由 components/Modal.vue 提供；本页只保留弹窗内排版 */
.cf-body{display:flex;flex-direction:column;gap:14px}
.form-row{display:flex;flex-direction:column;gap:6px}
.form-row label{font-size:12px;font-weight:500;color:var(--t2)}
.form-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.cf-tip{font-size:13px;color:var(--t2);line-height:1.6;margin:0 0 12px}
/* v702：作用对象说明 —— 选中范围与生效规则（"多选=几条独立目标，不是合计"）就靠这块说清 */
.sp-note{font-size:12px;line-height:1.65;color:var(--t2);padding:6px 8px;border-radius:7px;
  background:var(--bg2);border:1px solid var(--bd)}
.sp-note-link{color:#b45309;background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.4)}
.yh-scope{color:var(--t3);font-size:12px;margin-left:2px}
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
@media(max-width:768px){ .form-grid2{grid-template-columns:1fr} }
</style>
