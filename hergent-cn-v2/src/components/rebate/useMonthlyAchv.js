/**
 * 全年月度达成柱状图 · 纯逻辑层（无副作用，可单测）
 *
 * v123：仪表盘「全年月度达成」图表的数据组装。
 * 铁律：本层**不计算任何返利金额** —— 返利一律由后端 simulate-batch 产出，
 *       这里只负责「攒参数」和「回填结果」，杜绝前端镜像算法。
 *
 * 口径（2026-09-09 用户拍板）：
 *   ① 销量达成取「达成填报」rebate_achievements，不接销售订单 API；
 *   ② 目标没填的月份就是 0，不做任何插值/均分，用户自己会去填。
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

/** 规则在 (year, m) 月是否生效（与页面 ruleActiveInMonth 同口径） */
export function ruleActiveInMonth(rule, year, m) {
  if (!rule || rule.is_active === 0) return false
  const ms = new Date(Date.UTC(Number(year), Number(m) - 1, 1)).getTime()
  const me = new Date(Date.UTC(Number(year), Number(m), 0)).getTime()
  const s = rule.effective_start ? Date.parse(rule.effective_start + 'T00:00:00Z') : null
  const e = rule.effective_end ? Date.parse(rule.effective_end + 'T00:00:00Z') : null
  if (Number.isFinite(s) && s > me) return false
  if (Number.isFinite(e) && e < ms) return false
  return true
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
  let tSalesTarget = 0, tSalesAchv = 0

  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0')
    const mk = monthKey(y, m)
    let salesTarget = 0, salesAchv = 0
    const byBrand = {}
    const hitRules = []
    // 每条规则自己的 (目标, 达成) —— 试算必须按规则取值，
    // 若把月总达成喂给每条规则会跨品牌重复计提返利
    const ruleVals = {}

    for (const r of kept) {
      if (!ruleActiveInMonth(r, y, m)) continue
      const t = monthTargetOf(r, y, m)
      if (!(t > 0)) continue
      hitRules.push(r)
      salesTarget += t
      const nm = String(r.scope_name || r.scope_key || '')
      const a = achvMap.get(`${mk}::brand::${String(r.scope_key ?? '')}`)
      const v = a ? (measure === 'quantity' ? (Number(a.actual_qty) || 0) : (Number(a.actual_amount) || 0)) : 0
      salesAchv += v
      if (!byBrand[nm]) byBrand[nm] = { target: 0, achv: 0 }
      byBrand[nm].target += t
      byBrand[nm].achv += v
      ruleVals[r.id] = { target: t, achv: v }
    }

    if (salesTarget > 0 || salesAchv > 0) hasAny = true
    tSalesTarget += salesTarget
    tSalesAchv += salesAchv

    months.push({
      m,
      mm,
      key: mk,
      label: `${m}月`,
      salesTarget,
      salesAchv,
      rebateTarget: 0,   // 由 applySimResults 回填
      rebateAchv: 0,
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
    totals: { salesTarget: tSalesTarget, salesAchv: tSalesAchv, rebateTarget: 0, rebateAchv: 0 },
    excluded: { nonBrand, crossUnit },
  }
}

/**
 * 生成 simulate-batch 入参：每月每条规则两个试算（目标档 / 达成档）
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
      items.push({ rule_id: r.id, basis_value: Number(rv.achv) || 0, ref_date: mo.refDate })
      keys.push(`r${r.id}:m${mo.mm}:achv`)
    }
  }
  return { items, keys }
}

/**
 * 把后端试算结果回填进矩阵（唯一写入返利金额的地方）
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
  let tTarget = 0, tAchv = 0
  for (const mo of matrix.months) {
    let rt = 0, ra = 0
    for (const r of (mo.rules || [])) {
      rt += reb[`r${r.id}:m${mo.mm}:target`] || 0
      ra += reb[`r${r.id}:m${mo.mm}:achv`] || 0
    }
    mo.rebateTarget = rt
    mo.rebateAchv = ra
    tTarget += rt
    tAchv += ra
  }
  matrix.totals.rebateTarget = tTarget
  matrix.totals.rebateAchv = tAchv
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
