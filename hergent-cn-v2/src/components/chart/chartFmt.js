/* ============================================================================
   chartFmt.js —— 图表的数字 / 单位格式化（v491）+ 量程取整
   ============================================================================
   🔴 本文件是「数字怎么显示」的**唯一源**：轴标签、柱顶标注、tooltip、图例汇总
      必须全部走这里，不许各写各的 —— 否则同屏两个同名数字对不上（本项目
      hergent-rebate-caliber-consistency 反复在修的那一族）。

   中文单位铁律（用户明确要求，面向不懂英文的业务人）：
     · `70pp`  ⇒ `70 个百分点`
     · `avg` / `mo` / `Δ` / `QoQ` 等一律展开成中文；
     · `%` / `¥` / `件` / `万` 有行业共识，可用（不要写成 `¥10k`）。
   ============================================================================ */

/** 千分位整数（不带单位）。null/NaN → '—'（"没有值"与"值是 0"必须可分） */
export function int(n) {
  if (n === null || n === undefined || n === '') return '—'
  const x = Number(n)
  if (!isFinite(x)) return '—'
  return x.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

/** 保留小数（自动去尾零）：1.50 → 1.5，3.00 → 3 */
export function dec(n, digits = 1) {
  if (n === null || n === undefined || n === '') return '—'
  const x = Number(n)
  if (!isFinite(x)) return '—'
  const s = x.toFixed(digits)
  return s.replace(/\.?0+$/, '') || '0'
}

/**
 * 金额的**紧凑写法**（不含 ¥）：自动在 元 / 万 / 亿 之间选。
 * 返回值里数字与单位是分开的，方便轴标签把单位抽到标题上。
 * @returns {{v: string, unit: ''|'万'|'亿'}}
 */
export function moneyParts(n) {
  const x = Number(n)
  if (!isFinite(x)) return { v: '—', unit: '' }
  const a = Math.abs(x)
  if (a >= 1e8) return { v: dec(x / 1e8, 2), unit: '亿' }
  if (a >= 1e4) return { v: dec(x / 1e4, 1), unit: '万' }
  return { v: int(x), unit: '' }
}

/** 金额紧凑串（含 ¥ 与单位），用于 tooltip / 标注：¥12.3万 */
export function money(n) {
  const { v, unit } = moneyParts(n)
  return v === '—' ? '—' : `¥${v}${unit}`
}

/** 数量紧凑串：12.3万 件 / 320 件 */
export function qty(n) {
  const x = Number(n)
  if (!isFinite(x)) return '—'
  const a = Math.abs(x)
  if (a >= 1e4) return `${dec(x / 1e4, 1)}万 件`
  return `${int(x)} 件`
}

/** 百分比。入参是**比例**（0.123 → '12.3%'）。null → '—'（不是 '0%'） */
export function pct(ratio, digits = 1) {
  if (ratio === null || ratio === undefined || ratio === '') return '—'
  const x = Number(ratio)
  if (!isFinite(x)) return '—'
  return `${(x * 100).toFixed(digits)}%`
}

/** 轴向数字：给定单位把数值换算成该单位的数（轴标签专用，不带单位后缀） */
export function axisNum(v, unit) {
  const x = Number(v) || 0
  if (!x) return '0'
  if (unit === '万' || unit === '亿') {
    const d = unit === '亿' ? 1e8 : 1e4
    const y = x / d
    return String(Math.abs(y) >= 100 ? Math.round(y) : Number(dec(y, 2)))
  }
  return int(x)
}

/** 按量程自动决定金额轴单位（让轴标签数字落在 2~4 位、好读） */
export function moneyUnit(max) {
  const a = Math.abs(Number(max) || 0)
  if (a >= 1e8) return '亿'
  if (a >= 1e4) return '万'
  return ''
}

/**
 * 量程取整（"好看刻度"）。
 * 🔴 唯一实现：本函数此前住在 `components/rebate/useMonthlyAchv.js`，
 *    v491 抽到这里（图表是它的通用消费者），那边改为**再导出** —— 不留两份。
 *    基数集 k∈{1,1.5,2,3,5,7.5,10}，除 3/5 段后仍是整洁数值。
 */
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

/** 量程下限：全是负值（如亏损趋势）时向下取整，否则一律 0 起（柱状图 0 起是硬规矩） */
export function niceMin(v) {
  const x = Number(v) || 0
  if (x >= 0) return 0
  const a = Math.abs(x)
  const exp = Math.floor(Math.log10(a))
  const base = Math.pow(10, exp)
  for (const k of [1, 1.5, 2, 3, 5, 7.5, 10]) {
    if (a <= k * base) return -k * base
  }
  return -10 * base
}

/** 均分刻度：返回 [{v, y}]，由量程与段数决定，坐标由调用方给（scales 由 chartGeom 提供） */
export function tickValues(min, max, segs) {
  const lo = Number(min) || 0
  const hi = Number(max) || 0
  const n = Number(segs) > 0 ? Number(segs) : 4
  const out = []
  for (let i = 0; i <= n; i++) out.push(lo + ((hi - lo) * i) / n)
  return out
}

/** 紧凑数字（图例汇总 / 环图中心用）：12345 → 1.2万 */
export function compact(n) {
  const x = Number(n)
  if (!isFinite(x)) return '—'
  const a = Math.abs(x)
  if (a >= 1e8) return `${dec(x / 1e8, 2)}亿`
  if (a >= 1e4) return `${dec(x / 1e4, 1)}万`
  return int(x)
}
