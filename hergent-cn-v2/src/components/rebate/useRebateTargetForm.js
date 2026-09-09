/**
 * 品牌/商品目标表单 —— 共用纯逻辑层（v122 拆分）
 *
 * 只放「无副作用、可单测」的工具与数据工厂：
 *   ① 日期/星期工具（v121b 三字段联动，19 例单测已覆盖）
 *   ② 12 个月分解的组装 / 回填 / 均分
 *   ③ 阶梯档位解析
 *   ④ 新建表单默认值工厂
 *
 * 状态与请求一律留在 TargetFormModal.vue —— 这里不 import api、不碰 toast，
 * 保证本文件可在 node 下直接跑单测。
 */

export const MONTHS_12 = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']

/** 提前天数 N 的合法区间（到货日 = 报单日 + N，N 不得为负；上限防止手滑填 365） */
export const LEAD_MIN = 0
export const LEAD_MAX = 30

/** 星期显示用（getUTCDay(): 0=日） */
export const WD_CN = { 0: '日', 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六' }
/** 报单星期 chips 用（存储语义 1=周一 … 7=周日，与后端 order_weekdays 一致） */
export const WK_LABEL = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' }

export const WEEKDAY_OPTIONS = [
  { value: 1, label: '周一' }, { value: 2, label: '周二' }, { value: 3, label: '周三' },
  { value: 4, label: '周四' }, { value: 5, label: '周五' }, { value: 6, label: '周六' }, { value: 7, label: '周日' },
]

/* ---------------- 日期工具（一律 Date.UTC，避开本地时区与夏令时） ---------------- */

/** 解析 YYYY-MM-DD；非法（含 2/30）返回 null —— 月末天数自动含闰年 */
export function _parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? '' : s).trim())
  if (!m) return null
  const y = +m[1], mo = +m[2], d = +m[3]
  if (mo < 1 || mo > 12 || d < 1) return null
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  if (d > last) return null
  return { y, mo, d }
}

/** YYYY-MM-DD + n 天（n 可为负） */
export function _addDaysISO(s, n) {
  const p = _parseISO(s)
  if (!p) return ''
  const dt = new Date(Date.UTC(p.y, p.mo - 1, p.d) + Math.trunc(n) * 86400000)
  return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0')
}

/** b - a，单位天；任一非法返回 null */
export function _diffDaysISO(a, b) {
  const pa = _parseISO(a), pb = _parseISO(b)
  if (!pa || !pb) return null
  return Math.round((Date.UTC(pb.y, pb.mo - 1, pb.d) - Date.UTC(pa.y, pa.mo - 1, pa.d)) / 86400000)
}

/** '周一' … '周日' */
export function _weekdayOf(s) {
  const p = _parseISO(s)
  if (!p) return ''
  return '周' + WD_CN[new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()]
}

/** Date → 本地 YYYY-MM-DD（反推迁移时用，用户看到的是本地日期） */
export function isoLocal(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/** 万元展示：>=100 取整加千分位，否则保留 2 位 */
export function fmtWan(n) {
  const v = Number(n) || 0
  return v >= 100 ? Math.round(v).toLocaleString() : (Math.round(v * 100) / 100).toString()
}

/* ---------------- 12 个月分解 ---------------- */

/** 空表（12 行：金额 / 返利率 / 月级阶梯档位 均为空） */
export function emptyMonthlyRows() {
  return MONTHS_12.map(mm => ({ mm, amtWan: null, ratePct: null, tiers: [] }))
}

/** 月合计（万元） */
export function sumMonthlyWan(rows) {
  const s = (rows || []).reduce((a, r) => a + (Number(r.amtWan) || 0), 0)
  return Math.round(s * 100) / 100
}

/**
 * v126：全年一次性录入 → 均分 12 个月（余数补 12 月）；只动金额，不动返利率。
 * 这只是**快捷铺开**，不是另一种口径 —— 铺完仍可逐月改。
 */
export function splitAnnualToMonths(rows, inputWan) {
  const totalWan = Number(inputWan) || 0
  rows.forEach(r => { r.amtWan = null })
  if (totalWan <= 0) return
  const base = Math.floor(totalWan * 100 / 12) / 100
  let used = 0
  for (let i = 0; i < 12; i++) {
    const isLast = i === 11
    const v = isLast ? Math.round((totalWan - used) * 100) / 100 : base
    rows[i].amtWan = v
    used = Math.round((used + v) * 100) / 100
  }
}

/** v126：全年返利率 → 铺满 12 个月（同样是快捷铺开，可逐月覆盖） */
export function fillAnnualRateToMonths(rows, inputPct) {
  const pct = (inputPct === '' || inputPct == null) ? null : Number(inputPct)
  if (pct == null || Number.isNaN(pct)) return
  for (const r of (rows || [])) r.ratePct = Math.round(pct * 100) / 100
}

/**
 * v126：组装落库 JSON —— 金额(元) / 返利率(小数) / 月级阶梯，只含有值的月份。
 * 三者同构，合起来就是后端那张 12 行的月表。
 */
export function buildMonthlyPayloads(rows) {
  const monthlyAmounts = {}
  const monthlyRates = {}
  const monthlyTiers = {}
  for (const r of (rows || [])) {
    if (r.amtWan != null && Number(r.amtWan) > 0) monthlyAmounts[r.mm] = Math.round(Number(r.amtWan) * 10000)
    if (r.ratePct != null && Number(r.ratePct) > 0) monthlyRates[r.mm] = Math.round(Number(r.ratePct) * 1000) / 100000
    const ts = buildTiersPayload(r.tiers)
    if (ts.length) monthlyTiers[r.mm] = ts
  }
  return { monthlyAmounts, monthlyRates, monthlyTiers }
}

/**
 * 编辑回填：服务端 monthly_amounts/rates/tiers → UI（万元 / % / 档位数组）
 * 返回 { mode, notice }；rows 被就地填充。
 *
 * v126：单期规则也归一进月表 —— 按生效期所在月落一格。这样「年度」与「单期」
 * 在 UI 上只是「填了 12 格还是 1 格」，编辑任何一条看到的都是同一张月表。
 */
export function fillMonthlyFromRule(rows, r, { isBrandMonthly = true } = {}) {
  const out = { mode: 'year', notice: '' }
  rows.splice(0, rows.length, ...emptyMonthlyRows())
  if (!r) return out
  const amts = r.monthly_amounts || {}
  const rates = r.monthly_rates || {}
  const tiers = r.monthly_tiers || {}
  const hasMonthly = Object.keys(amts).length > 0
  out.mode = (hasMonthly || r.period_type === 'year') ? 'year' : 'single'
  for (const row of rows) {
    if (amts[row.mm] != null) row.amtWan = Math.round(Number(amts[row.mm]) / 100) / 100
    if (rates[row.mm] != null) row.ratePct = Math.round(Number(rates[row.mm]) * 100000) / 1000
    if (Array.isArray(tiers[row.mm]) && tiers[row.mm].length) row.tiers = parseRuleTiers(tiers[row.mm])
  }
  const tvWan = (Number(r.target_value) || 0) / 10000
  if (out.mode === 'year' && !hasMonthly && isBrandMonthly && tvWan > 0) splitAnnualToMonths(rows, tvWan)
  if (out.mode === 'single' && isBrandMonthly && tvWan > 0) {
    const mm = String(r.effective_start || r.effective_end || '').slice(5, 7)
    const row = rows.find(x => x.mm === mm)
    if (row) row.amtWan = Math.round(tvWan * 100) / 100
  }
  return out
}

/* ---------------- 阶梯档位 ---------------- */

/** v126：UI 档位（整数百分比）→ 落库档位（小数达成率 + 小数返利率） */
export function buildTiersPayload(tiers) {
  return (tiers || []).map(t => ({
    from_pct: (Number(t.from_pct) || 0) / 100,
    to_pct: (Number(t.to_pct) || 0) > 0 ? (Number(t.to_pct) || 0) / 100 : 999,
    rebate_rate: Number(t.rebate_rate) || 0,
    rebate_amount: Number(t.rebate_amount) || 0,
  })).filter(t => t.rebate_rate > 0 || t.rebate_amount > 0)
}

/** v126：档位摘要（月表「档位」列用）—— "80~100%:3% / 100%~:5%" */
export function tierText(tiers, basis = 'rate') {
  const ts = (tiers || []).filter(t => basis === 'rate'
    ? (Number(t.rebate_rate) || 0) > 0 : (Number(t.rebate_amount) || 0) > 0)
  if (!ts.length) return ''
  return ts.map(t => {
    const hi = (Number(t.to_pct) || 0) > 0 ? `${t.to_pct}%` : '以上'
    const v = basis === 'rate' ? `${Math.round((Number(t.rebate_rate) || 0) * 1000) / 10}%`
      : `${Math.round(Number(t.rebate_amount) || 0)}元`
    return `${t.from_pct}~${hi}:${v}`
  }).join(' / ')
}

/** 落库 tiers_json（小数达成率）→ UI 档位（整数百分比；to_pct=0 表示无上限） */
export function parseRuleTiers(raw) {
  try {
    const a = typeof raw === 'string' ? JSON.parse(raw) : (raw || [])
    if (!Array.isArray(a)) return []
    return a.map(t => ({
      from_pct: Math.round((Number(t.from_pct) || 0) * 100),
      to_pct: (Number(t.to_pct) || 0) >= 100 ? 0 : Math.round((Number(t.to_pct) || 0) * 100),
      rebate_rate: Number(t.rebate_rate) || 0,
      rebate_amount: Number(t.rebate_amount) || 0,
    }))
  } catch (e) { return [] }
}

/* ---------------- 表单默认值 ---------------- */

/**
 * 新建规则默认值。
 * - 商品目标多数按金额 → 商品/品牌一律默认 amount（v122 拍板）
 * - 报单节奏默认沿用真实业务节奏：每 2 天报单、提前 4 天到货、最多提前 1 天
 * - 三时点 20:00 开放 → 10:00 关单 → 12:00 厂家截止
 */
export function defaultForm({ presetDim = 'brand', defaultCadence = 2, currentYear = new Date().getFullYear() } = {}) {
  return {
    rule_name: '',
    dimension: presetDim || 'brand',
    target_type: 'amount',
    scope_key: '', scope_name: '',
    period_type: presetDim === 'brand' ? 'year' : 'month',
    target_value: 0,
    trigger_mode: 'on_target', trigger_threshold: 1,
    target_year: currentYear, target_unit: '',
    tiers_json: '', rebate_basis: 'rate', rebate_rate: 0, rebate_amount: 0,
    effective_start: '', effective_end: '', priority: 0, is_active: 1,
    scale_type: 'non_graduated', rounding_mode: 'half_up', rounding_digits: 2,
    // 旧到货语义（v121 起 UI 不再编辑，保留只为未迁移老规则的回退口径）
    arrival_cadence_days: defaultCadence || 2, arrival_base_dow: '',
    arrival_mode: 'interval', arrival_first_dom: 1, arrival_weekdays: '', arrival_count_override: null,
    // v121 报单语义（唯一节奏源）
    order_mode: 'interval', order_cadence_days: 2, order_weekdays: '', order_first_date: '',
    order_lead_days: 4, order_max_early_days: 1, auto_period_enabled: 0,
    auto_open_time: '20:00', auto_close_time: '10:00', supplier_deadline_time: '12:00',
  }
}

/** 「复制规则」：保留原配置，清空 id 与生效期，名称加「副本」 */
export function duplicateForm(r, { defaultCadence = 2, currentYear = new Date().getFullYear() } = {}) {
  return {
    rule_name: (r.rule_name || '规则') + '（副本）',
    dimension: r.dimension, target_type: r.target_type,
    scope_key: r.scope_key || '', scope_name: r.scope_name || '',
    period_type: r.period_type, target_value: r.target_value,
    target_year: r.target_year ?? currentYear, target_unit: r.target_unit || '',
    trigger_mode: r.trigger_mode, trigger_threshold: r.trigger_threshold,
    tiers_json: r.tiers_json || '', rebate_basis: r.rebate_basis,
    rebate_rate: r.rebate_rate, rebate_amount: r.rebate_amount,
    effective_start: '', effective_end: '', priority: r.priority || 0, is_active: 1,
    scale_type: r.scale_type || 'non_graduated', rounding_mode: r.rounding_mode || 'half_up',
    rounding_digits: r.rounding_digits || 2,
    arrival_cadence_days: r.arrival_cadence_days || 0, arrival_base_dow: r.arrival_base_dow || '',
    arrival_mode: r.arrival_mode || 'interval', arrival_first_dom: r.arrival_first_dom || 1,
    arrival_weekdays: r.arrival_weekdays || '', arrival_count_override: r.arrival_count_override ?? null,
    order_mode: r.order_mode || 'interval', order_cadence_days: r.order_cadence_days || 2,
    order_weekdays: r.order_weekdays || '', order_first_date: r.order_first_date || '',
    order_lead_days: r.order_lead_days ?? 4, order_max_early_days: r.order_max_early_days ?? 1,
    auto_period_enabled: r.auto_period_enabled || 0,
    auto_open_time: r.auto_open_time || '20:00', auto_close_time: r.auto_close_time || '10:00',
    supplier_deadline_time: r.supplier_deadline_time || '12:00',
  }
}
