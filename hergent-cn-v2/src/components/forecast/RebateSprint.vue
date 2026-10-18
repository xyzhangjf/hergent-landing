<script setup>
/* ---- 返利冲刺看板（F4 从 Forecast.vue 抽离的懒加载叶子）----
   🔴 抽离铁律：函数体一字不改，只动「组件边界 + props/emits」。
   父组件保留 cross / prodMeta / editMode 等响应式源，本组件只通过 props 只读它们：
     period(=cross.period) · rows(=cross.rows) · prodMeta · editMode(看板折叠联动)。
   注册方式：父组件用 defineAsyncComponent 懒加载 ⇒ 首屏 Forecast chunk 不含它，
   仅当 cross.period 存在（选定期次）时才按需挂载并自取返利数据。
   样式随组件自含（本文件 <style scoped>）—— v558 从父级 Forecast.vue scoped 块整体搬入。
   🔴 教训（v558 修复的真实回归）：父级 <style> 是 **scoped**，而 scoped 的 data-v 属性
      **只打在子组件根元素上**，内部后代（.panel-hd / .panel-body / .sprint-tp / .progress /
      .sp-pace / .sprint-sum / .sprint-suggest / .sprint-prod 等）**拿不到父的 data-v**
      ⇒ F4 抽离后卡片内部样式**全部静默失效**，只剩根元素的边框/渐变还在（所以不易察觉）。
   ⇒ 判据：从 scoped 父组件抽离子组件时，**样式必须一起搬**，否则等于"抽走 DOM、留下 CSS"。 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import {api} from '../../api/client.js'
import {fmt} from '../../utils/forecast/format.js'
import {rowFinalQty} from '../../utils/forecast/calc.js'
import {amountValue} from '../../utils/forecast/calc.js'
import {ruleCoversMonth} from '../../components/rebate/useMonthlyAchv.js'
import {parseArrivalWeekdays} from '../../utils/forecast/date.js'
import {countWeekdayArrivalsInWindow} from '../../utils/forecast/date.js'
import {ARR_WEEKDAY_CN} from '../../utils/forecast/date.js'
// 🔴 v557 修复：本组件由 Forecast.vue 抽离而来，模板用到 <Icon>，但原 import 在父级，
//    抽离脚本只探测了 api/fmt/calc/date 等 helper，漏了 Icon ⇒ 组件未解析、箭头**从未渲染**
//    （项目无 unplugin-vue-components、main.js 也未全局注册 Icon，故必须显式 import）。
import Icon from '../Icon.vue'

const props = defineProps({
  period:    { type: Object,  default: null },
  rows:      { type: Array,   default: () => [] },
  editMode:  { type: Boolean, default: false },
  prodMeta:  { type: Object,  default: () => ({}) },
  /* v585：`card`（默认，页面顶部那张卡）| `bare`（页脚胶囊悬停浮层里的内容）。
     bare 只改**外壳**（去外边距/边框/渐变/折叠箭头、常展开），内部结构与数字完全不变
     —— 同一份模板，避免"两套看板各写一半"的漂移。 */
  variant:   { type: String,  default: 'card' },
})
/* v585：把摘要回传给父级页脚胶囊（SprintChip）。
   🔴 只回传、不重算：unmet / totalGap / orders / perOrder 全部是本组件已有的 computed，
      父级不得自己再算一份，否则胶囊与卡片会出现两个数（同屏两把尺子的典型来源）。 */
const emit = defineEmits(['summary'])
const isBare = computed(() => props.variant === 'bare')

/* ---- 返利冲刺看板（前置：下单时实时看品牌/商品目标达成、缺口、均单建议） ---- */
// v116 (L2)：全局默认到货周期（天）—— 规则未单独设到货周期时沿用；可在「目标与返利」设置里改，默认 2 天。
const rebateGlobalCadence = ref(2)
async function loadTenantParams() {
  try {
    const r = await api('/api/params')
    const d = (r && r.data) ? r.data : {}
    const c = parseInt(d.default_arrival_cadence_days, 10)
    rebateGlobalCadence.value = (Number.isFinite(c) && c > 0) ? c : 2
  } catch (e) { /* 取默认 2 */ }
}
const rebateRules = ref([])     // 活跃返利目标规则（品牌/商品维度）
/* v293：规则拉取失败的原因（空串 = 正常）。存在的唯一目的是把 R8 说的「静默失效」显式化 ——
   修前 403（角色没权限）与 200 空数组（真没配目标）**落到同一条空态提示**
   「尚未配置品牌 / 商品返利目标」，主管看到会以为是自己没配目标，
   实际是被模块权限挡住。两者的正确说法完全不同，必须分开。 */
const rebateRulesErr = ref('')
// 冲刺看板折叠态（A2 决策横幅）：默认折叠 —— 结论已由卡片内常显的「决策横幅」承载，明细按需展开。
// 编辑态自动折叠：同一块 360px 面板同时挡着「改单」进入点与编辑态「保存」，收起它一次缩短两段距离。
// v585：浮层形态（bare）反过来 —— 用户是主动悬停来"看面板"的，还折叠着等于什么都没看到 ⇒ 常展开；
//   且不跟随 editMode 收起（改单时正是最需要看缺口的时候）。
const rebateSprintOpen = ref(isBare.value === true)
watch(() => props.editMode, (v) => { if (v && !isBare.value) rebateSprintOpen.value = false })

async function loadRebateRules() {
  try {
    /* v364：必须带上**本期到货月** —— 随规则回来的 `arrival_month`（该月到货安排）
       默认按「今天所在月」算。10 月里打开 11 月的看板时两者不是同一个月，
       会把 10 月的次数当成 11 月的用（同屏两把尺子的典型来源）。 */
    const r = await api('/api/rebate-rules?arrival_ym=' + encodeURIComponent(rebateSprintMonth.value))
    const list = (r && r.data) ? r.data : (Array.isArray(r) ? r : [])
    rebateRules.value = (list || []).filter(x => x.is_active !== 0)
    rebateRulesErr.value = ''
  } catch (e) {
    rebateRules.value = []
    /* api() 会把 HTTP 状态挂到 error.status 上（见 src/api/client.js:237 的 err.status = res.status），
       403 即模块权限不足（后端 error_code=MODULE_DENIED）—— 那是"被挡住"，不是"没数据"。
       其余（超时 / 5xx / 网络）也各自说清，别再退回一句笼统的"尚未配置目标"。 */
    rebateRulesErr.value = (e && e.status === 403)
      ? '你的角色没有查看返利规则的权限，需要管理员在「档案管理 › 角色权限」里为该角色勾上「销售」模块'
      : ('返利规则读取失败：' + ((e && e.message) || '未知错误'))
  }
}

// 填报的达成数据（无 API / 手动上传客户在「目标与返利 → 达成填报」录入或 Excel 导入）
// 此前看板只按"本期预报"当达成，漏算已达成部分导致缺口偏大 —— 这里并入真实填报值。
const rebateAchievements = ref([])

// v116 (L1)：达成按「到货」归属 —— 冲刺月份取当前期次的到货月(arrival_date)，而非下单月(order_start)。
// 返利按实际到货月份统计，预报贡献也计入到货月，避免"下单月≠到货月"导致达成错位。
const rebateSprintMonth = computed(() => {
  const p0 = props.period
  const base0 = (p0 && (p0.arrival_date || p0.order_start || p0.name)) || ''
  const m = (base0 || '').slice(0, 7)
  return /^\d{4}-\d{2}$/.test(m) ? m : new Date().toISOString().slice(0, 7)
})
const sprintAchvMonth = computed(() => rebateSprintMonth.value)

async function loadRebateAchievements() {
  try {
    const list = await api('/api/rebate-achievements?month=' + encodeURIComponent(sprintAchvMonth.value))
    rebateAchievements.value = Array.isArray(list) ? list : []
  } catch (e) { rebateAchievements.value = [] }
}
// 期次切换导致到货月变化时，重新拉取该月填报达成（竞态由 loadAchievements 的 seq 机制同理保护）
// v364：同时重拉规则 —— 每条规则带回的 `arrival_month` 是**按月**的（该月到货次数 / 停单），
//   换期次＝换月份 ⇒ 不重拉就会拿旧月份的次数算「剩余到货次数」。
watch(rebateSprintMonth, () => { loadRebateAchievements(); loadRebateRules() })

// 冲刺月（＝到货月）的**月末日**（YYYY-MM-DD）。
// 返利按月计算 ⇒ 一个返利周期的自然终点就是当月最后一天，与「本月时间进度」「月度达成」
// 「达成桶」共用同一个月份口径（都锚 sprintAchvMonth / rebateSprintMonth）。
// v292（2026-09-27）新增：此前没有这个值，下游只能拿别的东西当截止日，见 rebateCampaignEnd。
const rebateSprintMonthEnd = computed(() => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(sprintAchvMonth.value || ''))
  if (!m) return ''
  // day=0 ⇒ 上个月的最后一天 = 本月月末（如 10 → 2026-10-31）。
  // ⚠️ 用本地时间构造，**不要**走 toISOString()：那是 UTC，月初/月末会各差一天。
  const last = new Date(Number(m[1]), Number(m[2]), 0)
  const p2 = n => (n < 10 ? '0' + n : String(n))
  return `${last.getFullYear()}-${p2(last.getMonth() + 1)}-${p2(last.getDate())}`
})

// 返利周期截止日 = **冲刺月的月末**。
//
// v292（2026-09-27）修正 —— 原实现取「全部活跃规则 effective_end 的字符串最大值」，两处错：
//   ① 候选集合错：对**全部**活跃规则取 max，既不按"本月适用"过滤、也不按品牌过滤
//      ⇒ 别的月份、别的品牌的配置会污染当前视图；
//   ② 语义错：它根本不是"本月返利周期"。规则里的「生效期」是**规则整体的启停窗口**
//      （有月度分解时完全不参与适用月份判定，见 domain/rebate_period.py::covered_months），
//      拿它当返利周期截止日 = 把两个不同的时间概念混成一个。
// 真实症状（生产实测）：把某规则的生效截止日从 09-30 改成 12-31，面板的「返利周期截止」
//   跟着跳到 12-31，「剩余到货次数」由 18 次变 48 次（均单被反向摊薄）；而返利明明按月算、
//   剩余到货次数也按月算 ⇒ 两个数字都错。
// 降级：月份都定不出来时才退回本期次的下单截止（比给一个跨年的假截止日诚实）。
const rebateCampaignEnd = computed(() => {
  return rebateSprintMonthEnd.value || (props.period && props.period.order_end) || null
})

// 本期还剩几次到货机会（按全局默认到货周期估算，供表头概览；各品牌精确值见 rebateSprint 每行）
// v292（2026-09-27）：窗口已关闭时返回 **0**，不再兜底成 1。
// 原兜底 `if (!endStr) return 1` / `if (daysLeft <= 0) return 1` 是"假余量"：看历史期次时
// 窗口早就过了，面板却显示「剩 1 次到货」，下游还据此算出一个"每单需报 ¥X"的建议
// —— 用户照着报单也追不回返利。**兜底只能用于「无法判断」，不能用于「已知为 0」。**
// 连月份都取不到时同样返回 0（不是"未知所以给 1"）：下游 `v-if="rebateSprintOrders > 0"`
// 会自然收起建议块，比显示一个编出来的 1 次诚实。
const rebateSprintOrders = computed(() => {
  const endStr = rebateCampaignEnd.value
  if (!endStr) return 0
  const end = new Date(endStr + 'T23:59:59')
  const daysLeft = Math.ceil((end - new Date()) / 86400000)
  if (daysLeft <= 0) return 0
  return Math.max(1, Math.ceil(daysLeft / rebateGlobalCadence.value))
})

// v186：规则适用月份判据统一走 ruleCoversMonth（共享谓词，与后端同源）。
//   原本地 ruleEffectiveInMonth 按生效期逐月裁剪 —— 年度规则「12 个月分解齐全、
//   生效期只写 9 月」时会把 8 月整个判掉：既少一行冲刺行，也让图表的 8 月目标柱消失。

// v118 (L2细化)：到货模式感知的星期解析与剩余窗口计数
// 与后端 domain/arrival_schedule.py 同一契约：arrival_weekdays 存 "2,6"，1=周一..7=周日


// 按「填报达成 + 本期预报贡献」聚合各规则的实际达成、缺口、建议均单
const rebateSprint = computed(() => {
  // v116 (L1)：本期月份按「到货月」归属（arrival_date 优先），而非下单月；与 sprintAchvMonth 一致
  const p0 = props.period
  const base0 = (p0 && (p0.arrival_date || p0.order_start || p0.name)) || ''
  const sprintMonth = /^\d{4}-\d{2}$/.test((base0 || '').slice(0, 7)) ? base0.slice(0, 7) : new Date().toISOString().slice(0, 7)
  // 仅纳入「本期月份有目标可言」的启用规则（ruleCoversMonth，与仪表盘 / 全年图表同源）。
  // v186：原来按生效期逐月裁剪 —— 年度规则 12 个月分解齐全而生效期只写一个月时，
  //   本期即使"当月分解有目标"也会被整行剔除。当月分解无值的情况仍由下方
  //   monthly_amounts[mm2] 的守卫兜住（"没设当月目标却显示"不会回来）。
  const sprintY = Number(sprintMonth.slice(0, 4))
  const sprintM = Number(sprintMonth.slice(5, 7))
  const rules = (rebateRules.value || []).filter(x => x.is_active !== 0 && ruleCoversMonth(x, sprintY, sprintM))
  /* v585：编辑态「删除行」是软删（`_deleted=true`），页面所有合计都走 liveRows 过滤掉它们。
     本看板此前直接遍历 props.rows ⇒ **删掉一行后「本期预报贡献」不变、缺口纹丝不动**，
     用户会以为删除没生效，或者以为缺口算错了。与 liveRows 同口径过滤。 */
  const rows = (props.rows || []).filter(r => !r._deleted)
  const meta = props.prodMeta || {}
  // 到货截止日 → 剩余天数（用于按各品牌到货周期算剩余到货次数）
  const endStr = rebateCampaignEnd.value
  const daysLeft = (() => {
    if (!endStr) return 0
    const d = Math.ceil((new Date(endStr + 'T23:59:59') - new Date()) / 86400000)
    return d
  })()
  // 冲刺月的天数 —— 用于把「整月到货次数」折算到剩余窗口（见下方 arrival_count_override）。
  // 与 rebateSprintMonthEnd 同月，day=0 取月末；取不到月份时按 30 天（只是个折算分母，不参与判断）。
  const daysInSprintMonth = (() => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(sprintMonth || ''))
    return m ? new Date(Number(m[1]), Number(m[2]), 0).getDate() : 30
  })()
  // 填报达成查表：维度 + 作用对象 → 达成记录（已按到货月加载）
  const achvMap = new Map()
  for (const a of (rebateAchievements.value || [])) {
    achvMap.set(`${a.dimension}::${String(a.scope_key ?? '')}`, a)
  }
  const out = []
  for (const rule of rules) {
    const dim = rule.dimension
    const scope = String(rule.scope_key ?? '')
    let contrib = 0
    const products = []
    for (const r of rows) {
      let match = false
      if (dim === 'brand') {
        const b = (meta[r.product_id] && meta[r.product_id].brand) || r.brand || ''
        match = (b || '').toString() === scope
      } else if (dim === 'product') {
        match = String(r.product_id) === scope
      }
      if (!match) continue
      const fq = rowFinalQty(r)
      const amt = amountValue(r) || 0
      if (rule.target_type === 'quantity') contrib += fq
      else contrib += amt
      products.push({ name: r.name, contrib: amt, qty: fq })
    }
    // 填报达成：金额型规则取金额，数量型规则取数量
    const av = achvMap.get(`${dim}::${scope}`)
    const reported = av
      ? (rule.target_type === 'quantity' ? (Number(av.actual_qty) || 0) : (Number(av.actual_amount) || 0))
      : 0
    // 阶段2: 品牌目标两层结构 —— 规则带 monthly_amounts(月度金额分解)时，当月目标取该月值；
    // 该月未配置金额 = 该月无目标（跳过行，避免把年框当单月目标误导）；老规则回退 target_value。
    const mm2 = sprintMonth.slice(5, 7)
    const isMonthlyRule = !!(rule.monthly_amounts && Object.keys(rule.monthly_amounts).length)
    if (isMonthlyRule && (rule.monthly_amounts[mm2] == null || Number(rule.monthly_amounts[mm2]) <= 0)) continue
    const mAmt = isMonthlyRule ? Number(rule.monthly_amounts[mm2]) : null
    const target = (mAmt != null && mAmt > 0) ? mAmt : (Number(rule.target_value) || 0)
    const achieved = reported + contrib            // 达成 = 已填报 + 本期预报贡献（均按到货月归属）
    const gap = Math.max(0, target - achieved)
    // v118 (L2细化)：尊重 arrival_mode —— 按间隔天数 / 按固定星期 分别计算剩余到货次数与建议均单
    // v292（2026-09-27）：把「窗口已关闭」提到分支**之前**判定，所有分支共用同一个结论。
    // 为什么必须这样：weekday 分支写的是 `Math.max(1, countWeekdayArrivalsInWindow(...))`，
    // 而窗口已过时那个函数返回 0 ⇒ 被 Math.max 抬回 1 —— 与 interval 分支的
    // `daysLeft > 0 ? ... : 1` 一样，都是**把"已知为 0"粉饰成 1**。分开写就有两处兜底要维护。
    const windowClosed = !endStr || daysLeft <= 0
    const mode = rule.arrival_mode || 'interval'
    let cadenceLabel, orders
    if (mode === 'weekday') {
      const wds = parseArrivalWeekdays(rule.arrival_weekdays)
      orders = windowClosed ? 0
        : (wds.length
            ? Math.max(1, countWeekdayArrivalsInWindow(wds, endStr))
            : Math.max(1, Math.ceil(daysLeft / (rebateGlobalCadence.value || 2))))
      cadenceLabel = wds.length ? `每周 ${wds.length} 次（${wds.map(w => '周' + ARR_WEEKDAY_CN[w]).join('、')}）` : '未设星期'
    } else {
      const cadence = (Number(rule.arrival_cadence_days) > 0) ? Number(rule.arrival_cadence_days) : rebateGlobalCadence.value
      orders = windowClosed ? 0 : Math.max(1, Math.ceil(daysLeft / cadence))
      cadenceLabel = `${cadence} 天/次`
    }
    // v292（2026-09-27）：面板次数与品牌配置的到货安排打通（配了必须看得见）。
    // v364（2026-10-02）换口径 —— 原来读规则上的 **永久列** `arrival_count_override`，两处错：
    //   ① 它是"永久"的：10 月填 15 次会一路生效到 11、12 月（11 月系统推算只有 15/16），
    //      用户想回到系统推算只能每月手动改一次；
    //   ② 它只有"几次"、没有"哪一天" ⇒ 用户在「到货节奏」里点的**停单本页完全看不出来**
    //      （停了单、剩余次数与建议均单却纹丝不动）。
    //   改为读后端随规则带回的 `arrival_month`（**该月**的到货安排，按 arrival_ym 指定月份），
    //   取 `effective_count` —— 与「到货节奏」面板算均单用的是**同一个数**
    //   （后端 arrival_summary：eff = 该月显式次数 else 日历天数），两处口径因此不可能打架。
    // 折算方式沿用 v292：整月次数 × 剩余天数占比，收敛到 [有剩余天数就至少 1, 整月次数]。
    //   `am.ym === sprintMonth` 是护栏：宁可退回按周期估算，也不拿别个月的次数冒充本月。
    const am = rule.arrival_month
    const ovRaw = (am && am.ym === sprintMonth) ? Number(am.effective_count) : NaN
    const ovFromConfig = Number.isFinite(ovRaw) && ovRaw > 0
    // 是否**用户手动调整过**该月（停过单 / 填过次数）—— 只用来决定摘要里要不要点名，
    // 与上面"用哪个月的数字"是两件事（后者每个品牌都成立，前者只有少数品牌成立）。
    const ovManual = !!(am && am.ym === sprintMonth
      && (am.count_source === 'override' || (am.skipped || []).length))
    if (ovFromConfig) {
      orders = windowClosed ? 0 : Math.min(ovRaw, Math.max(1, Math.round(ovRaw * daysLeft / daysInSprintMonth)))
      const _sk = (am.skipped || []).length
      cadenceLabel = `整月 ${ovRaw} 次（${am.count_source === 'override' ? '手动填的次数' : '系统推算'}`
        + (_sk ? `，已停 ${_sk} 天` : '') + '）'
    }
    const perOrder = orders > 0 ? gap / orders : gap
    const ach = target > 0 ? achieved / target : 0
    // A+C：优先加单按"本期贡献额"降序取前 3，但先过滤掉 contrib===0 的无效项
    // （无报单或缺失进货价 → 推¥0 无意义且误导）；若匹配品全无有效贡献，top 为空 → 模板显"本期尚未报单"提示
    const top = products.filter(p => p.contrib > 0).sort((a, b) => b.contrib - a.contrib).slice(0, 3)
    const topEmpty = top.length === 0
    out.push({
      key: rule.id,
      dimLabel: dim === 'brand' ? '品牌' : '商品',
      name: rule.scope_name || scope,
      target, targetType: rule.target_type,
      reported, contrib, achieved, gap, perOrder, ach, top, topEmpty,
      cadenceLabel, orders,
      // v292 / v364：本行的剩余次数是否来自你在「到货节奏」里**手动调整过**的到货安排
      // —— 用于在摘要里点明"这几个数字来自你的配置"，否则用户改了配置看不出面板跟着变。
      ovFromConfig: ovManual
    })
  }
  return out
})

const sprintTotalGap = computed(() => rebateSprint.value.reduce((s, x) => s + x.gap, 0))
const sprintTotalGapPerOrder = computed(() => rebateSprintOrders.value > 0 ? sprintTotalGap.value / rebateSprintOrders.value : 0)
// v292 / v364：哪些品牌的剩余次数用的是你**手动调整过**的到货安排（停过单 / 填过次数）。
// 在摘要里如实点出来 —— 修前这个配置在本页完全不生效，用户改了也看不出面板有任何变化，
// 无法分辨"是我没配对"还是"系统没读"。空串 = 一个都没调过 ⇒ 这段文案整句不出现（不留常态噪音）。
const sprintOverrideNames = computed(() =>
  rebateSprint.value.filter(s => s.ovFromConfig).map(s => s.name).join('、'))
// 决策横幅（A2）：未达标对象数 —— 唯一实现，模板里不再重复 filter 表达式
const unmetSprintCount = computed(() => rebateSprint.value.filter(s => s.gap > 0).length)

/* v585：页脚胶囊的摘要 —— 唯一出口。
   父级（Forecast.vue → SprintChip）只读这里回传的值，**不另算一份**；
   编辑态改数量会重建 rebateSprint ⇒ 本 computed 重算 ⇒ emit ⇒ 胶囊与面板同一帧一致。 */
const sprintSummaryOut = computed(() => ({
  rules: rebateSprint.value.length,
  unmet: unmetSprintCount.value,
  totalGap: sprintTotalGap.value,
  orders: rebateSprintOrders.value,
  perOrder: sprintTotalGapPerOrder.value,
  err: rebateRulesErr.value || '',
}))
watch(sprintSummaryOut, (v) => emit('summary', v), { immediate: true })

/* v181：1 位小数、整数不带 .0 —— 「时间进度百分比」与「达成率」共用同一格式化，
   保证两者同精度（同屏口径同源，勿各写一套）。 */
function paceNum(v) {
  const r = Math.round(Number(v) * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

// 冲刺看板：时间进度（口径＝本期「到货月」，与 rebateSprintMonth / 后端达成归属完全一致）
// 算法与「目标与返利 → 仪表盘」timeProgress 同源：过去月=100% / 未来月=0% / 当月=今日 ÷ 该月总天数
const sprintTimeProgress = computed(() => {
  const [yy, mm] = String(sprintAchvMonth.value || '').split('-').map(Number)
  if (!yy || !mm) return { frac: 0, pct: 0, pct1: '0', shown: false }
  const totalDays = new Date(yy, mm, 0).getDate()          // 该月总天数（mm 为 1-based）
  const now = new Date()
  const curY = now.getFullYear(), curM = now.getMonth() + 1
  let frac
  if (yy < curY || (yy === curY && mm < curM)) frac = 1
  else if (yy > curY || (yy === curY && mm > curM)) frac = 0
  else frac = Math.min(1, now.getDate() / totalDays)
  // v181：pct1 是 1 位小数版（页头与 hover 提示用）—— 与进度条文案的差值同精度，可互相对账
  return { frac, pct: Math.round(frac * 100), pct1: paceNum(frac * 100), shown: frac > 0 && frac < 1 }   // 虚线只在当月有意义
})

/* v183：本函数**只负责配色判定**，不再产出文案 ——
   用户判据：面板页头已常显「本月时间进度」、进度条上还有虚线标记，读者自己一比就知道超前/落后
   ⇒「落后时间进度 X%」这类差值文案是冗余，删掉，只留「达成率 X%」（见 sprintAchText）。
   ⚠️ 但配色必须仍走这里：颜色与进度条同源，才能保证同一行的「数」与「色」不互相矛盾。
   此前 sprintBarClass 单独写了一份 `ach >= frac`，会让差 0.03 个百分点的一行出现
   「进度条判绿、文案写落后」的自相矛盾 —— 勿再复制第二份判定。
   pp 取 1 位小数的**真实差值**（不是先把两个百分比各自取整再相减）。 */
const PACE_EPS = 0.05       // 低于 0.05 个百分点视为持平
function sprintPaceOf(ach) {
  const tp = sprintTimeProgress.value
  if (ach == null || !(tp.frac > 0)) return null     // 到货月尚未开始 → 不做比较（颜色走中性）
  const pp = (Number(ach) - tp.frac) * 100           // 正 = 超前，负 = 落后
  if (Math.abs(pp) < PACE_EPS) return { state: 'even', pp: 0, cls: 'pace-even' }
  const ahead = pp > 0
  return { state: ahead ? 'ahead' : 'behind', pp, cls: ahead ? 'pace-ahead' : 'pace-behind' }
}

/* v183：进度单元格的文案 —— 只有「达成率 X%」（1 位小数，与页头时间进度同精度）。
   ⚠️ 达成率与时间进度**无关**：到货月尚未开始时（frac = 0）也必须显示。
   （v181/182 曾把文案挂在 sprintPaceOf 上，而它 frac=0 时返回 null ⇒ 那时连达成率一起消失。） */
function sprintAchText(ach) {
  return ach == null ? '' : '达成率 ' + paceNum(Number(ach) * 100) + '%'
}

// 冲刺进度条着色：达成 ≥ 时间进度 → 绿（超前时间进度）；未达 → 红（落后时间进度）
// 与「目标与返利 → 仪表盘 → 返利目标达成」的 paceCls 同口径（v151 起两处统一）
// 到货月尚未开始时（frac<=0）→ 返回空，走中性青，不做"0 达成也判绿"的误判
// v181：改为复用 sprintPaceOf（持平时按「未落后」处理 → 绿，与原 ach>=frac 的边界行为一致）
function sprintBarClass(ach) {
  const p = sprintPaceOf(ach)
  return p ? (p.state === 'behind' ? 'red' : 'green') : ''
}

// 每行的进度单元格展示信息：文案 + 配色类（模板按 key 一次取到，避免在模板里重复调用函数）
const sprintPaceMap = computed(() => {
  const m = {}
  rebateSprint.value.forEach(s => {
    const p = sprintPaceOf(s.ach)
    m[s.key] = { text: sprintAchText(s.ach), cls: p ? p.cls : '' }
  })
  return m
})

/* v181：「文案放不放得下」按**真实列宽**判定。
   （v183 文案缩短为「达成率 X%」= 74px 后，这条降级路径已基本走不到 —— 进度列 1680px 下 168px、
   文案只占 44%，必定放得下。保留它作防御：列宽被外部锁死时仍能优雅降级，不是死代码。）
   ⚠️ 判据必须是「溢出」`scrollWidth > clientWidth`，不是「scrollWidth 等于文字自然宽」——
   浏览器在未溢出时把 scrollWidth 抬平到 clientWidth，所以量不出文字宽（要量文字宽得先约束宽度）。
   放不下 → visibility:hidden（保留占位，行高不跳动）并把同一句文案挂到进度条的 title 上。 */
const paceFits = ref({})
function measureSprintPace() {
  const out = {}
  document.querySelectorAll('.sprint-card .sp-pace').forEach(el => {
    out[el.dataset.k] = el.scrollWidth <= el.clientWidth
  })
  paceFits.value = out
}
// 仅在文案确实放不下时才挂 hover 提示（文字已可见时不再重复提示；提示内容＝同一句文案）
function paceHint(s) {
  const p = sprintPaceMap.value[s.key]
  return (p && p.text && paceFits.value[s.key] === false) ? p.text : ''
}
// 列宽随窗口变化（RO 不可用：v-show 折叠期间宽度为 0 会误判）→ resize 与数据/展开态变化时重测
onMounted(() => {
  nextTick(measureSprintPace)
  window.addEventListener('resize', measureSprintPace)
})
onBeforeUnmount(() => window.removeEventListener('resize', measureSprintPace))
watch([rebateSprint, rebateSprintOpen, sprintTimeProgress], () => { nextTick(measureSprintPace) })


// F4：本看板自拥数据加载（原由父组件 onMounted 触发，现随卡片挂载自取）
onMounted(() => { loadTenantParams(); loadRebateRules(); loadRebateAchievements() })
</script>

<template>
    <div v-if="period" class="card sprint-card is-pinned" :class="{ 'is-bare': isBare }">
      <div class="panel-hd">
        <b><Icon name="bar-chart"/> 返利冲刺看板</b>
        <span class="tag hot">副驾建议</span>
        <span class="tag info" v-if="period">本期 · {{ period.name }}</span>
        <!-- 时间进度：与下方进度条的虚线标记同源（口径＝本期到货月），右对齐到本行最右侧 -->
        <span class="sprint-tp" v-if="rebateSprint.length" :title="sprintTimeProgress.shown ? '虚线＝时间进度：进度条超过虚线＝超前，短于虚线＝落后时间进度' : ''">本月时间进度：<b>{{ sprintTimeProgress.pct1 }}%</b></span>
        <!-- v557：做成「侧边栏同款」箭头 —— 与 Shell.vue .sb-caret 一致：
             永远同一个 chevron-right，展开时 rotate(90deg) 朝下（不换图标）；
             静息 opacity .55 与侧边栏等权，hover 提到 1 给出可点反馈。 -->
        <span class="sprint-toggle" :class="{'is-open': rebateSprintOpen}" @click.stop="rebateSprintOpen = !rebateSprintOpen" :title="rebateSprintOpen ? '收起明细' : '展开看达成率、缺口与建议均单'" :aria-label="rebateSprintOpen ? '收起明细' : '展开明细'">
          <Icon name="chevron-right" :size="16"/>
        </span>
      </div>
      <!-- 决策横幅（A2）：看板结论的常驻摘要行 —— 折叠/展开都在，明细只在展开时出现。
           四个数字全部取自既有 computed，且与展开态明细表共用同一个 fmt()（单位同源，勿在摘要上开第二套） -->
      <div v-if="rebateSprint.length" class="sprint-banner">
        <template v-if="unmetSprintCount">
          <b>{{ unmetSprintCount }}</b> 个品牌未达标
          <span class="sep">·</span>总缺口 <b class="val-warn">¥{{ fmt(sprintTotalGap) }}</b>
          <!-- v292：窗口已关闭（剩 0 次）时不再显示「均单需报 ¥0」——
               分母为 0 得出的均单是算式产物，不是业务含义。直接把"已无机会"说出来。 -->
          <template v-if="rebateSprintOrders > 0">
            <span class="sep">·</span>剩 <b>{{ rebateSprintOrders }}</b> 次到货
            <span class="sep">·</span>均单需报 <b class="val-warn">¥{{ fmt(sprintTotalGapPerOrder) }}</b>
          </template>
          <template v-else>
            <span class="sep">·</span><b class="val-warn">本月到货窗口已结束</b>，缺口无法再追补
          </template>
        </template>
        <template v-else>
          <b>{{ rebateSprint.length }}</b> 个品牌目标<span class="val-ok">全部达成</span>
          <span class="sep">·</span>本月时间进度 <b>{{ sprintTimeProgress.pct1 }}%</b>
        </template>
      </div>
      <!-- v293：取数失败（403 等）时在**常显位置**给出原因 —— 折叠状态下也要能看见。
           否则用户默认看到的是"有标题、没内容"的空卡片，点开才发现是空的，与静默失效无异。
           复用 .sprint-banner（同为常显结论行），零新增 CSS。 -->
      <div v-if="rebateRulesErr" class="sprint-banner">
        <b class="val-warn">返利数据未能读取</b>
        <span class="sep">·</span>{{ rebateRulesErr }}
      </div>
      <div v-show="rebateSprintOpen" class="panel-body">
        <template v-if="rebateSprint.length">
          <p class="sprint-sum">
            <template v-if="rebateSprintOrders > 0">
              本期（返利周期截止 <b>{{ rebateCampaignEnd || (period && period.order_end) }}</b>，即当月最后一天）按默认到货周期（每 {{ rebateGlobalCadence }} 天）约剩 <b>{{ rebateSprintOrders }}</b> 次到货机会；各品牌到货周期不同，下表按各自周期算「建议均单」<template v-if="sprintOverrideNames">；<b>{{ sprintOverrideNames }}</b> 按你在「到货节奏」里对本月到货的调整（停单 / 次数）折算</template>。
              要补齐以下返利目标缺口，<b>均单需报 ¥{{ fmt(sprintTotalGapPerOrder) }}</b>（按默认周期估算）。
            </template>
            <!-- v292：窗口已关闭时不再说「约剩 0 次到货机会 / 均单需报 ¥0」——
                 那种句子读起来像"还有机会但不用报"，实际是"这个月已经没有机会了"。 -->
            <template v-else>
              本期到货窗口已结束（返利周期截止 <b>{{ rebateCampaignEnd }}</b>）—— <b class="val-warn">本月已无到货机会</b>，剩余缺口无法再靠报单追补；下表仅供复盘。
            </template>
            <span class="muted">（达成按到货月份归属 = 已填报达成 + 本期预报贡献；未填报可在「目标与返利 → 达成填报」补录或 Excel 导入）</span>
          </p>
          <div class="table-wrap">
            <table class="tbl">
              <thead>
                <tr><th>维度</th><th>目标对象</th><th>到货周期</th><th class="num">目标</th><th class="num">已达成(填报)</th><th class="num">本期预报贡献</th><th class="num">距目标还差</th><th class="num">建议均单</th><th>进度</th></tr>
              </thead>
              <tbody>
                <tr v-for="s in rebateSprint" :key="s.key">
                  <td>{{ s.dimLabel }}</td>
                  <td>{{ s.name }}</td>
                  <td>{{ s.cadenceLabel }}</td>
                  <td class="num">¥{{ fmt(s.target) }}<template v-if="s.targetType === 'quantity'"> / 件</template></td>
                  <td class="num">{{ s.reported > 0 ? '¥' + fmt(s.reported) : '—' }}</td>
                  <td class="num">¥{{ fmt(s.contrib) }}</td>
                  <td class="num"><b :class="s.gap > 0 ? 'val-warn' : 'val-ok'">{{ s.gap > 0 ? fmt(s.gap) : '已达成' }}</b></td>
                  <td class="num" v-if="s.gap > 0">¥{{ fmt(s.perOrder) }}</td>
                  <td class="num" v-else>—</td>
                  <td style="min-width:110px">
                    <!-- v183：文案＝「达成率 X%」（不再标注与时间进度的差值）；
                         空间不足时（paceHint 非空）整条进度条挂 hover 提示，文案与提示同源 -->
                    <div class="sp-bar" :title="paceHint(s)">
                      <div class="progress" :class="sprintBarClass(s.ach)"><i :style="{width: Math.min(100, s.ach * 100) + '%'}"></i></div>
                      <span v-if="sprintTimeProgress.shown" class="sp-bar-mark" :style="{left: (sprintTimeProgress.frac * 100) + '%'}" title="时间进度"></span>
                    </div>
                    <span v-if="sprintPaceMap[s.key] && sprintPaceMap[s.key].text" class="sp-pace" :class="[sprintPaceMap[s.key].cls, paceFits[s.key] === false ? 'is-hidden' : '']" :data-k="s.key">{{ sprintPaceMap[s.key].text }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="sprint-suggest" v-if="rebateSprintOrders > 0">
            <b>系统建议：</b>
            <ul>
              <template v-for="s in rebateSprint" :key="'sg' + s.key">
                <li v-if="s.gap > 0">
                  为「{{ s.name }}」补齐返利，剩余 <b>{{ s.orders }}</b> 次到货（{{ s.cadenceLabel }}）中每单需报 <b>¥{{ fmt(s.perOrder) }}</b>；优先加单：
                  <template v-if="!s.topEmpty"><span v-for="p in s.top" :key="p.name" class="sprint-prod">{{ p.name }}（本期已报 ¥{{ fmt(p.contrib) }}）</span></template>
                  <span v-else class="sprint-prod-empty">本期该品牌尚未报单，暂无可推荐加单（先报单或补全商品进货价后再生成建议）</span>
                </li>
              </template>
            </ul>
          </div>
        </template>
        <!-- v293：403（角色没权限）**不能**复用下面那条「尚未配置品牌 / 商品返利目标」的空态 ——
             那会让主管以为是自己没配目标，是把用户往错方向引。这里只复述原因 + 给出期望，
             具体原因与行动指引已由上方那条常显行承载。 -->
        <p v-else-if="rebateRulesErr" class="hint">
          <b class="val-warn">{{ rebateRulesErr }}</b> —— 处理完这里会自动出现；
          已填报的达成数据不受影响，不会丢。
        </p>
        <p v-else class="hint">尚未配置品牌 / 商品返利目标。去「目标与返利」页创建目标后，这里会在你下单时实时显示达成率、缺口与建议均单；实际达成可在「达成填报」补录或 Excel 导入。</p>
      </div>
    </div>
</template>

<style scoped>
/* 返利冲刺看板展开/收起控件 —— 定稿(v557)：做成「侧边栏同款」箭头。
   🔴 真 bug（v557 修复）：抽离时漏了 `import Icon`，且项目既无 unplugin-vue-components、
      main.js 也未全局注册 Icon ⇒ <Icon> 未解析 ⇒ **箭头从未渲染**（v552/553 用户看到的
      "奇怪的圆/丑图标"实为空圆圈；v554/556 去掉容器后则完全空白）。此前所有样式调整都无效。
   规格（对齐 Shell.vue `.sb-caret` @1503-1504）：
     · 永远同一个 chevron-right，展开时 rotate(90deg) 朝下 —— 与侧边栏折叠箭头同机制；
     · 零 background / 零 border / 零 border-radius（用户明确拒绝圆形与圆角矩形容器）；
     · color 继承(var(--t2)) + 静息 opacity:.55（与侧边栏等权），hover 提至 1；
     · 16px（Forecast .exp-chev 同尺寸），padding:6px 仅扩点击热区、不产生可见形状。 */
.sprint-card .panel-hd{ gap:8px }
.sprint-card .panel-hd .sprint-toggle{
  margin-left:auto;
  flex:0 0 auto;
  display:inline-flex;align-items:center;justify-content:center;
  padding:6px;
  color:var(--t2);
  opacity:.55;
  background:none;
  border:none;
  cursor:pointer;user-select:none;
  transition:opacity .15s ease,transform .15s ease;
}
.sprint-card .panel-hd .sprint-toggle:hover{ opacity:1 }
/* 展开态：同一个 chevron-right 顺时针转 90° ⇒ 朝下（与侧边栏 .sb-caret 完全一致） */
.sprint-card .panel-hd .sprint-toggle.is-open{ transform:rotate(90deg) }
.sprint-card .panel-hd .sprint-toggle :deep(svg.ico){width:18px;height:18px;vertical-align:middle}

.sprint-card{}
.sprint-card.is-pinned{margin:14px 0 4px;border:1px solid var(--p);box-shadow:0 2px 12px rgba(6,182,212,.14);background:linear-gradient(180deg,color-mix(in srgb,var(--p) 6%,var(--bg2)) 0%,var(--bg2) 60px)}
.sprint-card.is-pinned .panel-hd{border-bottom:1px dashed var(--border-subtle);padding-bottom:10px;margin-bottom:0}
.tag.hot{background:var(--dan-bg);color:var(--dan);font-weight:600}
/* 决策横幅（A2）：一行承载「未达标数 / 总缺口 / 剩余到货机会 / 均单需报」，折叠与展开都常显 */
.sprint-banner{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:9px 16px;font-size:var(--fs-sm);line-height:1.5;color:var(--t2)}
.sprint-banner b{color:var(--t1);font-variant-numeric:tabular-nums}
/* 数值状态色复用既有 .val-warn / .val-ok（见本文件 L6799-6800），不另造色类；
   因 .sprint-banner b 优先级更高，需显式压过，故写成 b.val-warn */
.sprint-banner b.val-warn{color:var(--war)}
.sprint-banner .sep{color:var(--t3)}
/* 虚线挂到明细区自己这一侧（border-top）—— 它能随 v-show 一起隐藏。
   若改挂在 .sprint-banner 的 border-bottom 上，折叠时会留下一条悬空线。 */
.sprint-card .panel-body{padding-top:10px;border-top:1px dashed var(--border-subtle)}
/* 冲刺看板：行内时间进度（右对齐到页头行最右侧）+ 进度条上的时间进度虚线标记
   （虚线范式与仪表盘 .rr-bar-mark 一致：橙色 2px dashed，超出条形上下各 3px） */
.sprint-card .sprint-tp{margin-left:auto;margin-right:2px;font-size:var(--fs-sm);color:var(--t3);white-space:nowrap}
.sprint-card .sprint-tp b{color:var(--war);font-size:var(--fs-base);font-variant-numeric:tabular-nums}
.sp-bar{position:relative}
/* 仅冲刺面板加高到 12px：让时间进度虚线可读（实测行高 41px 由文字行盒决定，加高不改变行高）；
   仪表盘参照为 16px，此表更紧凑故取 12px。不波及「厂家返利」表（仍 6px） */
.sprint-card .progress{height:12px}
.sp-bar-mark{position:absolute;top:-3px;bottom:-3px;width:0;border-left:2px dashed var(--war);z-index:2;pointer-events:none}
/* v181：进度「与时间进度对比」文案（v183 起内容改为「达成率 X%」）。
   ⚠️ v183 文案缩短后它**不再撑宽该列**：实测 1680px 下列宽 168px、文案自然宽仅 74px（占 44%）。
   （v181/182 的长文案 212px 曾把该列撑到 240px、其余各列各缩 ~7px；文案变短后该副作用消失。）
   ⚠️ table-layout:auto 会把该列宽度**下限**顶在 max(td 自带 min-width:110px, 文案 min-content) 上，
   给 td 设 max-width 是无效的（实测设 64px、列宽仍为 102.8px）⇒ 要复现「放不下」只能约束本元素自身宽度。
   放不下时用 visibility:hidden（不是 display:none）保留占位 —— 行高不跳动、显隐不引起表格重排。 */
.sprint-card .sp-pace{display:block;width:100%;margin-top:3px;font-size:var(--fs-sm);line-height:1.25;
  white-space:nowrap;overflow:hidden;font-variant-numeric:tabular-nums}
.sprint-card .sp-pace.is-hidden{visibility:hidden}
.sprint-card .sp-pace.pace-behind{color:var(--dan)}
.sprint-card .sp-pace.pace-ahead{color:var(--suc)}
.sprint-card .sp-pace.pace-even{color:var(--t3)}
/* 时间语义着色：达成未达时间进度=红，已超前=绿（复用全局 .progress>i 的绿/琥珀范式） */
.sprint-card .progress.red>i{background:var(--dan)}
.sprint-sum{margin:0 0 12px;font-size:13px;color:var(--t2);line-height:1.7}
.sprint-sum b{color:var(--t1)}
.sprint-sum .muted{color:var(--t3);font-size:var(--fs-sm)}
.sprint-suggest{margin-top:12px;font-size:13px;color:var(--t2);line-height:1.8}
.sprint-suggest ul{margin:6px 0 0;padding-left:18px}
.sprint-suggest li{margin:4px 0}
.sprint-prod{display:inline-block;margin:0 8px 0 4px;padding:1px 8px;background:var(--bg3);border-radius:var(--radius-md);font-size:12px;color:var(--t2)}
.sprint-prod-empty{margin-left:4px;padding:1px 8px;font-size:12px;color:var(--warn-amber);background:color-mix(in srgb,var(--warn-amber) 10%,transparent);border-radius:var(--radius-md)}
.sprint-card.is-pinned .panel-hd svg.ico{vertical-align:-3px}
/* 数值状态色：模板里直接用裸 .val-warn / .val-ok（缺口/均单告警、全部达成）。
   ⚠️ 父级 Forecast.vue scoped 块里也有同名裸类，但 scoped 那份**只对父组件自己的 DOM 生效**，
      本组件拿不到 ⇒ 这里必须自带一份，否则告警色会静默丢失（v558 修复）。 */
.val-ok{color:var(--suc)}
.val-warn{color:var(--war)}

/* ===== v585：浮层形态（bare）=====
   只剥「卡片外壳」，内部版式与数字一处不动 —— 浮层里看到的就是同一块看板。
   🔴 特异性统一写 .sprint-card.is-pinned.is-bare（0,3,0），压过 .is-pinned 那几条（0,2,0）；
     不依赖书写顺序（scoped 会给两边各追加一个 [data-v]，比值不变）。 */
.sprint-card.is-pinned.is-bare{margin:0;border:0;border-radius:0;box-shadow:none;background:none}
/* 折叠箭头在浮层里隐藏：内容是主动悬停唤出的，还留着"再折起来"只会有两种误读
   （以为浮层没加载完 / 手滑点掉后以为坏了）。 */
.sprint-card.is-pinned.is-bare .panel-hd .sprint-toggle{display:none}
.sprint-card.is-pinned.is-bare .panel-hd{padding-bottom:8px}
/* 决策横幅横向内距归零：浮层自身已有 14px 内距，否则数字右移一截、与明细表左边缘不齐。 */
.sprint-card.is-pinned.is-bare .sprint-banner{padding:8px 0}
</style>
