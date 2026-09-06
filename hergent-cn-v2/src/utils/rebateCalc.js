/**
 * 返利计算常量与展示辅助（v113）
 *
 * ⚠️ 口径铁律：本文件**不含任何返利算法**。
 * 算法唯一实现在后端 server/domain/rebate_calc.py，前端一律通过
 *   - POST /api/rebate-rules/simulate-batch   （规则）
 *   - POST /api/rebate-contracts/simulate     （合同，What-if 快照）
 *   - GET  /api/rebate-contracts/{id}/calc-detail
 * 拿到结果后只做渲染。此前 Rebate.vue 里的 computeRebateFront 与后端是双份实现，
 * 必然漂移（v112 R40 已记录在案），v113 起彻底删除。
 *
 * 本文件只放：枚举常量、默认值归一化、算式链 / 档位的展示格式化。
 * 常量与 server/domain/rebate_calc.py 顶部一一对应，改动必须双边同步；
 * 契约用例见 server/tests/fixtures/rebate_cases.json（前后端共用同一份）。
 */

export const SCALE_GRADUATED = 'graduated'
export const SCALE_NON_GRADUATED = 'non_graduated'
export const SCALE_TYPES = [SCALE_GRADUATED, SCALE_NON_GRADUATED]

export const SCALE_TYPE_LABELS = {
  [SCALE_GRADUATED]: '累进（分档计算）',
  [SCALE_NON_GRADUATED]: '全量按档（命中档对全部金额计价）',
}

/** 给业务看的白话释义（阶梯计法是最常见的返利争议根因，UI 必须讲清差异） */
export const SCALE_TYPE_HINTS = {
  [SCALE_GRADUATED]:
    '按落进每一档的金额分别计价再相加。例：目标 10 万，档位 80%~100% 返 2%、100%~120% 返 3%，' +
    '做到 11 万时 = 2万×2% + 1万×3% = 700 元。',
  [SCALE_NON_GRADUATED]:
    '命中哪一档，就把**全部**达成金额按那一档的比例计一次。上例同样是 11 万，' +
    '命中 100%~120% 档，= 11万×3% = 3300 元。',
}

export const ROUNDING_HALF_UP = 'half_up'
export const ROUNDING_UP = 'up'
export const ROUNDING_DOWN = 'down'
export const ROUNDING_MODES = [ROUNDING_HALF_UP, ROUNDING_UP, ROUNDING_DOWN]

export const ROUNDING_MODE_LABELS = {
  [ROUNDING_HALF_UP]: '四舍五入',
  [ROUNDING_UP]: '向上进位',
  [ROUNDING_DOWN]: '向下舍去',
}

/** 默认值必须与后端一致（rule 默认全量按档，contract 默认累进，保持历史行为） */
export const DEFAULT_SCALE_TYPE_RULE = SCALE_NON_GRADUATED
export const DEFAULT_SCALE_TYPE_CONTRACT = SCALE_GRADUATED
export const DEFAULT_ROUNDING_MODE = ROUNDING_HALF_UP
export const DEFAULT_ROUNDING_DIGITS = 2

export const SCALE_OPTIONS = SCALE_TYPES.map((v) => ({ value: v, label: SCALE_TYPE_LABELS[v] }))
export const ROUNDING_OPTIONS = ROUNDING_MODES.map((v) => ({ value: v, label: ROUNDING_MODE_LABELS[v] }))

/** 归一化计法：非法值回落到按来源的默认（老数据 / 未配置列时兼容） */
export function scaleTypeOf(obj, source = 'rule') {
  const v = String((obj && obj.scale_type) || '').trim()
  if (SCALE_TYPES.includes(v)) return v
  return source === 'contract' ? DEFAULT_SCALE_TYPE_CONTRACT : DEFAULT_SCALE_TYPE_RULE
}

/** 归一化舍入策略 → { mode, digits, label } */
export function roundingOf(obj) {
  const mode = String((obj && obj.rounding_mode) || '').trim()
  let digits = Number(obj && obj.rounding_digits)
  if (!Number.isFinite(digits) || digits < 0 || digits > 6) digits = DEFAULT_ROUNDING_DIGITS
  const m = ROUNDING_MODES.includes(mode) ? mode : DEFAULT_ROUNDING_MODE
  return { mode: m, digits, label: `${ROUNDING_MODE_LABELS[m]}·${digits} 位` }
}

export function scaleLabel(obj, source = 'rule') {
  return SCALE_TYPE_LABELS[scaleTypeOf(obj, source)] || scaleTypeOf(obj, source)
}

/* ---------------- 展示格式化（与后端 _money / _pct 对齐） ---------------- */

/** 千分位 + 固定小数位，与后端 f"{v:,.{digits}f}" 同形 */
export function fmtMoney(v, digits = 2) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0.' + '0'.repeat(digits)
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** 小数 → 百分比文本，与后端 f"{v*100:.{digits}f}%" 同形 */
export function fmtPct(v, digits = 2) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return (n * 100).toFixed(digits) + '%'
}

/** 档位上界文本：0 / 空 / 末档 视为无上界，显示「以上」 */
export function tierToText(t) {
  if (!t) return '—'
  if (t.to == null || t.to_infinite) return '以上'
  return fmtMoney(t.to, 2)
}

/** 把后端 steps[] 渲染成表格行（透明化算式面板用） */
export function stepsRows(steps) {
  return (steps || []).map((s, i) => ({
    idx: i,
    key: s.key,
    label: s.label,
    text: s.text,
    value: s.value,
    isTotal: s.key === 'total',
    isRounding: s.key === 'rounding',
  }))
}

/** 把后端 tiers[] 渲染成档位表行（规则用达成率档，合同用金额档） */
export function tierRows(tiers, source = 'rule') {
  return (tiers || []).map((t) => ({
    index: t.index,
    range: source === 'contract'
      ? `${fmtMoney(t.from, 2)} ~ ${tierToText(t)}`
      : `${fmtPct(t.from, 0)} ~ ${t.to == null || t.to_infinite ? '以上' : fmtPct(t.to, 0)}`,
    rate: source === 'contract' ? fmtPct(t.rate, 2) : (t.rate ? fmtPct(t.rate, 2) : `¥${fmtMoney(t.amount, 2)}`),
    rebate: t.rebate,
    hit: !!t.hit,
    note: t.note || '',
  }))
}

/**
 * 达成率 → 语义色（对标 SAP/D365 的三段式：未达标琥珀 / 达标绿 / 超额蓝）
 * 返回 'under' | 'ok' | 'over'
 */
export function achLevel(ach) {
  const a = Number(ach)
  if (!Number.isFinite(a)) return 'under'
  if (a >= 1.2) return 'over'
  if (a >= 1) return 'ok'
  return 'under'
}

/** 同比 / 环比箭头文案；diff 为正向上 */
export function deltaText(diff, opts = {}) {
  const d = Number(diff)
  if (!Number.isFinite(d) || Math.abs(d) < 1e-9) return { arrow: 'flat', text: '持平', cls: '' }
  const up = d > 0
  return {
    arrow: up ? 'up' : 'down',
    text: `${up ? '↑' : '↓'} ${Math.abs(d).toFixed(opts.digits ?? 1)}${opts.unit || ''}`,
    cls: (opts.inverse ? !up : up) ? 'val-ok' : 'val-warn',
  }
}
