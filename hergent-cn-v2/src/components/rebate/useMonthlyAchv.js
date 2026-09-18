/**
 * 全年月度达成柱状图 · 纯逻辑层（无副作用，可单测）
 *
 * v123：仪表盘「全年月度达成」图表的数据组装。
 * 铁律：本层**不计算任何返利金额** —— 这里只负责「攒参数」和「回填结果」，杜绝前端镜像算法。
 *
 * 口径（v160 更新）：
 *   ① 销量达成取「达成填报」rebate_achievements，不接销售订单 API；
 *   ② 目标没填的月份就是 0，不做任何插值/均分，用户自己会去填。
 *
 * 口径（v186 生效期）：哪个月适用由 ruleCoversMonth() 唯一判定 ——
 *   **有月度分解的规则，适用月份就是分解本身**，生效期不再逐月裁剪。
 *   只要某月有目标，那根柱子就始终画得出来（未填报时为灰轨道），
 *   不因"生效期只写了一个月"而整根消失。
 *   ③ **返利柱＝实际返利**（rebate_achievements.actual_rebate，人工填报 / Excel /
 *      Hermes 经 API·MCP 回写三源同字段），不再用「按达成率推算的预估返利」。
 *      灰轨道（返利柱的目标位）仍是后端 simulate-batch 按 100% 目标档推算的「预估应返」，
 *      于是返利柱的达成率 = 实际返利 ÷ 预估应返 —— 分母仍是后端算法，前端不碰。
 */

export const MONTH_KEYS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']

/** 月末日 'YYYY-MM-DD'（Date.UTC 避免时区漂移） */
export function monthEndISO(year, m) {
  const mm = String(m).padStart(2, '0')
  const d = new Date(Date.UTC(Number(year), Number(m), 0))
  return `${year}-${mm}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** 'YYYY-MM' */
export function monthKey(year, m) {
  return `${year}-${String(m).padStart(2, '0')}`
}

/**
 * 规则归属年份：target_year > 生效期年份 > 当前年。
 * 与后端 domain/rebate_period.rule_year 同口径（年份判断是防"2027 年套 2026 年目标"的关键）。
 */
export function ruleYear(rule) {
  const ty = Number(rule && rule.target_year)
  if (Number.isFinite(ty) && ty >= 2000 && ty <= 2100) return ty
  const s = String((rule && rule.effective_start) || '')
  if (/^\d{4}/.test(s)) return Number(s.slice(0, 4))
  return new Date().getFullYear()
}

/** 月份 'YYYY-MM' 与 [effective_start, effective_end](''=无界) 是否有交集。
 *  与后端 domain/rebate_period.month_in_range **逐字同源**（含 'MM-31' / 'MM-01' 的字符串比较技巧）。 */
function effOverlapsMonth(rule, y, m) {
  const ym = monthKey(y, m)
  const s = String((rule && rule.effective_start) || '').trim()
  const e = String((rule && rule.effective_end) || '').trim()
  if (s && (ym + '-31') < s) return false
  if (e && (ym + '-01') > e) return false
  return true
}

/**
 * 规则在 (year, m) 月是否**有目标可言** —— 生效期门禁的**唯一实现**（v186）。
 *
 * 与后端 domain/rebate_period.rule_covers_month / covered_months 逐字同源：
 *   · 年度规则 / 带月度分解 ⇒ 「分解里有这一格」（年份也要对齐）；
 *     生效期**不再逐月裁剪** —— 年度规则的适用月份就是它的月度分解本身。
 *   · 单期规则（无分解）⇒ 该月与生效期有交集。
 *
 * 此前这条门禁在 5 处各写了一遍（本文件的 ruleActiveInMonth、Rebate.vue 的两份
 * ruleEffectiveInMonth + 本地 ruleActiveInMonth、Forecast.vue 的 ruleEffectiveInMonth），
 * 口径一分叉就出现同屏自相矛盾。**新增消费方一律调用本函数，勿再本地另写。**
 *
 * ⚠️ 为什么必须与 covered_months 同口径：后端 monthly_view() 对**分解里没有的月份**
 *    会回退到顶层 target_value（年度总额），那个月就会拿"全年目标"比"单月达成"
 *    ⇒ 永不触发。所以"分解里没有的月份"必须在这里判为**不适用**，不能交给下游兜底。
 *
 * 真实事故（tenant_1「蒙牛低温2026年目标」）：12 个月分解齐全（合计 868.4 万），
 * 生效期却只写了 2026-09 ⇒ 旧口径下 11 个月的目标柱整根不画、8 月已填报的
 * 达成 32.4 万与实际返利 13.1 万被整个系统丢弃。
 */
export function ruleCoversMonth(rule, year, m) {
  if (!rule || rule.is_active === 0) return false
  const y = Number(year)
  const mo = Number(m)
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return false
  const amounts = parseMonthly(rule.monthly_amounts)
  const hasMonthly = Object.keys(amounts).length > 0
  if (hasMonthly || rule.period_type === 'year') {
    // 无分解的年度规则：没有逐月信息可用，仍按生效期判断（放行 12 个月会把年度总额当每月目标）
    if (!hasMonthly) return effOverlapsMonth(rule, y, mo)
    if (ruleYear(rule) !== y) return false
    return Object.prototype.hasOwnProperty.call(amounts, String(mo).padStart(2, '0'))
  }
  return effOverlapsMonth(rule, y, mo)
}

/** 解析 JSON 月度分解（monthly_amounts / monthly_rates），失败返回 {} */
export function parseMonthly(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw || {}
  try {
    const v = JSON.parse(String(raw))
    return v && typeof v === 'object' ? v : {}
  } catch (e) {
    return {}
  }
}

/**
 * 规则在 (year, m) 月的销量目标
 * - 年度规则（period_type=year 且有月度分解）→ monthly_amounts['MM']
 * - 单期月规则 → target_value，归位到 effective_start 所在月（按自然月，不按天分摊）
 * - 年度规则但缺该月分解 → 0（不臆测均分）
 */
export function monthTargetOf(rule, year, m) {
  if (!rule) return 0
  if (rule.period_type === 'year') {
    const ma = parseMonthly(rule.monthly_amounts)
    const v = ma[String(m).padStart(2, '0')]
    return Number(v) || 0
  }
  // 单期（month / quarter / custom）：整额落在生效起始月
  const startM = rule.effective_start ? Number(String(rule.effective_start).slice(5, 7)) : null
  if (startM && startM !== Number(m)) return 0
  return Number(rule.target_value) || 0
}

/**
 * 构建全年 12 月矩阵（不含返利）
 * @param {object} p
 * @param {number|string} p.year
 * @param {Array}  p.rules          rebate_target_rules 列表
 * @param {Array}  p.achievements   rebate_achievements 列表（全年，period_month='YYYY-MM'）
 * @param {Array}  p.brandSel       选中的品牌名数组；空数组 = 全部品牌
 * @returns {object} { year, months, totals, excluded, hasAny, measure }
 */
export function buildYearMatrix({ year, rules = [], achievements = [], brandSel = [] }) {
  const y = Number(year)
  const sel = (brandSel || []).filter(Boolean)
  const selSet = new Set(sel)

  // 只看品牌维度规则；商品/其它维度不计入（品牌筛选语义下无处安放）
  const brandRules = (rules || []).filter(r => r && r.dimension === 'brand')
  const nonBrand = (rules || []).length - brandRules.length

  // 品牌过滤
  const inScope = brandRules.filter(r => {
    if (!selSet.size) return true
    const nm = String(r.scope_name || r.scope_key || '')
    return selSet.has(nm) || selSet.has(String(r.scope_key || ''))
  })

  // 跨度量红线：金额与件数不可相加，只取多数度量那一组
  let nAmount = 0, nQty = 0
  for (const r of inScope) (r.target_type === 'quantity' ? nQty++ : nAmount++)
  const measure = nQty > nAmount ? 'quantity' : 'amount'
  const kept = inScope.filter(r => (r.target_type === 'quantity' ? 'quantity' : 'amount') === measure)
  const crossUnit = inScope.length - kept.length

  // 达成入表：period_month + dimension + scope_key
  const achvMap = new Map()
  for (const a of (achievements || [])) {
    if (!a) continue
    const k = `${a.period_month}::${a.dimension}::${String(a.scope_key ?? '')}`
    achvMap.set(k, a)
  }

  const months = []
  let hasAny = false
  let tSalesTarget = 0, tSalesAchv = 0, tActualRebate = 0

  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0')
    const mk = monthKey(y, m)
    let salesTarget = 0, salesAchv = 0, actualRebate = 0
    const byBrand = {}
    const hitRules = []
    // 每条规则自己的 (目标, 达成) —— 试算必须按规则取值，
    // 若把月总达成喂给每条规则会跨品牌重复计提返利
    const ruleVals = {}

    for (const r of kept) {
      if (!ruleCoversMonth(r, y, m)) continue
      const t = monthTargetOf(r, y, m)
      if (!(t > 0)) continue
      hitRules.push(r)
      salesTarget += t
      const nm = String(r.scope_name || r.scope_key || '')
      const a = achvMap.get(`${mk}::brand::${String(r.scope_key ?? '')}`)
      const v = a ? (measure === 'quantity' ? (Number(a.actual_qty) || 0) : (Number(a.actual_amount) || 0)) : 0
      // v160：实际返利与度量无关（永远是元），不受 amount/quantity 口径切换影响
      const ar = a ? (Number(a.actual_rebate) || 0) : 0
      salesAchv += v
      actualRebate += ar
      if (!byBrand[nm]) byBrand[nm] = { target: 0, achv: 0, actualRebate: 0 }
      byBrand[nm].target += t
      byBrand[nm].achv += v
      byBrand[nm].actualRebate += ar
      ruleVals[r.id] = { target: t, achv: v }
    }

    if (salesTarget > 0 || salesAchv > 0 || actualRebate > 0) hasAny = true
    tSalesTarget += salesTarget
    tSalesAchv += salesAchv
    tActualRebate += actualRebate

    months.push({
      m,
      mm,
      key: mk,
      label: `${m}月`,
      salesTarget,
      salesAchv,
      actualRebate,
      rebateTarget: 0,   // 由 applySimResults 回填（100% 目标档的预估应返）
      byBrand,
      rules: hitRules,
      ruleVals,
      refDate: monthEndISO(y, m),
    })
  }

  return {
    year: y,
    measure,
    months,
    hasAny,
    totals: { salesTarget: tSalesTarget, salesAchv: tSalesAchv, rebateTarget: 0, actualRebate: tActualRebate },
    excluded: { nonBrand, crossUnit },
  }
}

/**
 * 生成 simulate-batch 入参：每月每条规则一次试算（**只算目标档**）
 *
 * v160：达成档的试算没用了 —— 返利柱的填充值已改成「实际返利」（人工/Excel/Hermes 录入），
 * 不再由「按达成率推算的预估返利」充当。试算只用于产出返利柱的灰轨道（100% 目标档预估应返）。
 * 请求量随之减半。
 * @returns {{ items: Array, keys: Array }} keys 与 items 同序，形如 'r12:m08:target'
 */
export function buildSimItems(matrix) {
  const items = []
  const keys = []
  for (const mo of (matrix?.months || [])) {
    for (const r of (mo.rules || [])) {
      const rv = (mo.ruleVals || {})[r.id] || {}
      items.push({ rule_id: r.id, basis_value: Number(rv.target) || 0, ref_date: mo.refDate })
      keys.push(`r${r.id}:m${mo.mm}:target`)
    }
  }
  return { items, keys }
}

/**
 * 把后端试算结果回填进矩阵（本图**唯一**写入返利金额的地方，且只写灰轨道）
 * @param {object} matrix  buildYearMatrix 的产物（会被就地修改）
 * @param {Array}  results simulate-batch 的 results（与 keys 同序）
 * @param {Array}  keys    buildSimItems 产出的 keys
 */
export function applySimResults(matrix, results = [], keys = []) {
  if (!matrix) return matrix
  const reb = {}
  results.forEach((r, i) => {
    const k = keys[i]
    if (!k || !r || r.ok === false) return
    reb[k] = Number(r.rebate) || 0
  })
  let tTarget = 0
  for (const mo of matrix.months) {
    let rt = 0
    for (const r of (mo.rules || [])) {
      rt += reb[`r${r.id}:m${mo.mm}:target`] || 0
    }
    mo.rebateTarget = rt
    tTarget += rt
  }
  matrix.totals.rebateTarget = tTarget
  return matrix
}

/** 加权达成率（合计达成 ÷ 合计目标），不是算术平均 */
export function rate(achv, target) {
  const t = Number(target) || 0
  if (t <= 0) return null
  return (Number(achv) || 0) / t
}

/** 双轴量程：向上取整到「好看」的刻度（1/2/5 × 10^n） */
export function niceMax(v) {
  const x = Number(v) || 0
  if (x <= 0) return 1
  const exp = Math.floor(Math.log10(x))
  const base = Math.pow(10, exp)
  for (const k of [1, 1.5, 2, 3, 5, 7.5, 10]) {
    if (x <= k * base) return k * base
  }
  return 10 * base
}
