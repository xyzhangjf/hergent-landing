export const ARR_WEEKDAY_CN = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' }
export function parseArrivalWeekdays(raw) {
  if (!raw) return []
  const items = Array.isArray(raw) ? raw : String(raw).split(',').map(s => s.trim()).filter(Boolean)
  const out = []
  for (const it of items) {
    const v = parseInt(it, 10)
    if (!isNaN(v) && v >= 1 && v <= 7 && out.indexOf(v) === -1) out.push(v)
  }
  return out.sort((a, b) => a - b)
}
// 统计 [今天, endStr] 闭区间内命中到货星期的天数（JS getDay: 0=周日..6=周六 → 存值 1=周一..7=周日）
export function countWeekdayArrivalsInWindow(weekdays, endStr) {
  if (!weekdays.length || !endStr) return 0
  const set = new Set(weekdays)
  const end = new Date(endStr + 'T23:59:59')
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  let cnt = 0
  for (let d = new Date(now); d <= end; d.setDate(d.getDate() + 1)) {
    const jsDow = d.getDay()
    const stored = jsDow === 0 ? 7 : jsDow
    if (set.has(stored)) cnt++
  }
  return cnt
}

export function addDaysStr(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!m) return String(iso || '')
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  d.setDate(d.getDate() + Number(n || 0))
  return fmtDate(d)
}

// 把期次名里的「M月D日」整体后移 n 天。名称里不带年份 ⇒ 只回写月日（跨年由 Date 自行滚动），
// 年份只用于解析基准，取源期次的下单开始年。
export function shiftPeriodNameDates(text, n, baseIso) {
  const s = String(text || '')
  if (!n) return s
  const _y = /^(\d{4})-/.exec(String(baseIso || ''))
  const baseYear = _y ? Number(_y[1]) : new Date().getFullYear()
  return s.replace(/(\d{1,2})月(\d{1,2})[日号]/g, (whole, mo, dd) => {
    const d = new Date(baseYear, Number(mo) - 1, Number(dd))
    if (isNaN(d.getTime())) return whole
    d.setDate(d.getDate() + n)
    return `${d.getMonth() + 1}月${d.getDate()}日`
  })
}

export function fmtDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parsePeriodDates(text) {
  if (!text) return []
  const out = []
  const re = /((\d{4})[-/.年\s]*)?(\d{1,2})[-月.\/](\d{1,2})(?:日|号)?/g
  let m
  while ((m = re.exec(text)) !== null) {
    const year = m[2] ? parseInt(m[2], 10) : new Date().getFullYear()
    const month = parseInt(m[3], 10)
    const day = parseInt(m[4], 10)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      out.push({ year, month, day })
    }
  }
  const dedup = []
  for (const d of out) {
    const last = dedup[dedup.length - 1]
    if (!last || last.year !== d.year || last.month !== d.month || last.day !== d.day) dedup.push(d)
  }
  return dedup
}
