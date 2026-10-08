// 自动生成：新旧实现差分测试（勿手改）
const WARN_ABS = 1500
const fmt = (v) => String(v)
// 故意用「不缓存」的 computed 垫片：强制每次访问都重算，把 WeakMap 同步逻辑压到极限
const computed = (fn) => ({ get value(){ return fn() } })
const cross = { value: { rows: [] } }
const visibleCols = { value: [] }
const unitCount = () => 0

/* ===== 旧实现（前缀 old，避免与新实现撞名） ===== */
function oldRowSum(r) {
  return Object.values(r.qtyByUnit || {}).reduce((s, v) => s + (parseInt(v) || 0), 0)
}
function oldRowWarn(r) {
  if (!r) return ''
  if (r.safety_stock > 0 && oldRowSum(r) < r.safety_stock) return 'low'
  if (r.expiry_days > 0 && r.expiry_days <= 7) return 'short'
  return ''
}
function oldHeatStyle(r, uname) {
  const v = parseInt(r.qtyByUnit[uname]) || 0
  if (v < 100) return {}
  if (r.ai != null && v > r.ai) return { background: 'var(--danger-bg)', color: 'var(--danger-txt)' }
  if (v >= WARN_ABS) return { background: 'var(--warn-amber-bg)', color: 'var(--warn-amber)' }
  if (v >= 500) return { background: 'var(--heat-3-bg)', color: 'var(--heat-3-txt)' }
  return { background: 'var(--heat-2-bg)', color: 'var(--heat-2-txt)' }
}
function oldHeatTitle(r, uname) {
  const v = parseInt(r.qtyByUnit[uname]) || 0
  if (v < 100) return ''
  if (r.ai != null && v > r.ai) return '红色：本格订量已超过该商品 AI 周预测总量（' + fmt(r.ai) + r.unit + '），疑似填错或严重积压，请核对'
  if (v >= WARN_ABS) return '琥珀色：大单，留意是否会导致库存积压'
  return ''
}

/* ===== 新实现（前缀 new） ===== */
function newRowSum(r) {
  return Object.values(r.qtyByUnit || {}).reduce((s, v) => s + (parseInt(v) || 0), 0)
}
const _rowSumByObj = new WeakMap()
const newRowSumArr = computed(() => {
  const list = cross.value.rows || []
  const out = new Array(list.length)
  for (let i = 0; i < list.length; i++) { out[i] = newRowSum(list[i]); _rowSumByObj.set(list[i], out[i]) }
  return out
})
function newRowSumOf(r) {
  const snap = newRowSumArr.value            // 注册依赖，并保证 WeakMap 与当前世代同步
  const hit = _rowSumByObj.get(r)
  return hit === undefined ? newRowSum(r) : hit
}
function newRowWarn(r) {
  if (!r) return ''
  if (r.safety_stock > 0 && newRowSumOf(r) < r.safety_stock) return 'low'
  if (r.expiry_days > 0 && r.expiry_days <= 7) return 'short'
  return ''
}
const _heatMemo = new WeakMap()
function newHeatOf(r, uname) {
  const raw = r.qtyByUnit[uname]
  const ai = r.ai, unit = r.unit
  let m = _heatMemo.get(r); if (!m) { m = new Map(); _heatMemo.set(r, m) }
  const hit = m.get(uname)
  if (hit && hit.raw === raw && hit.ai === ai && hit.unit === unit) return hit
  const v = parseInt(raw) || 0
  let style = {}, title = ''
  if (v >= 100) {
    if (ai != null && v > ai) {
      style = { background: 'var(--danger-bg)', color: 'var(--danger-txt)' }
      title = '红色：本格订量已超过该商品 AI 周预测总量（' + fmt(ai) + unit + '），疑似填错或严重积压，请核对'
    } else if (v >= WARN_ABS) {
      style = { background: 'var(--warn-amber-bg)', color: 'var(--warn-amber)' }
      title = '琥珀色：大单，留意是否会导致库存积压'
    } else if (v >= 500) {
      style = { background: 'var(--heat-3-bg)', color: 'var(--heat-3-txt)' }
    } else {
      style = { background: 'var(--heat-2-bg)', color: 'var(--heat-2-txt)' }
    }
  }
  const obj = { raw: raw, ai: ai, unit: unit, v: v, style: style, title: title }
  m.set(uname, obj)
  return obj
}


/* ===== 差分测试 ===== */
function rnd(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 }
const R = rnd(20261004)
const UNITS = ['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8', 'u9', 'u10', 'u11']
const POOL = ['', '0', '12', '99', '100', '499', '500', '1499', '1500', '2000', '3000', 'abc', '12.5', '1,200', null, undefined, '007']
let fails = []
let n = 0

for (let it = 0; it < 400; it++) {
  const qty = {}
  for (let u = 0; u < 12; u++) {
    const p = POOL[Math.floor(R() * POOL.length)]
    if (p !== null && p !== undefined) qty[UNITS[u]] = p
  }
  const r = {
    qtyByUnit: qty,
    safety_stock: [0, 0, 500, 1200, 3000][Math.floor(R() * 5)],
    expiry_days: [0, 3, 7, 8, 30][Math.floor(R() * 5)],
    ai: [null, null, 800, 2000, 5000][Math.floor(R() * 5)],
    unit: ['包', '箱', ''][Math.floor(R() * 3)]
  }
  cross.value.rows = [r]

  const oSum = oldRowSum(r), nSum = newRowSumOf(r)
  n++
  if (oSum !== nSum) fails.push(['rowSum', JSON.stringify(qty), oSum, nSum])

  const oWarn = oldRowWarn(r), nWarn = newRowWarn(r)
  n++
  if (oWarn !== nWarn) fails.push(['rowWarn', JSON.stringify(qty), oWarn, nWarn])

  for (const u of UNITS) {
    const os = oldHeatStyle(r, u), ns = newHeatOf(r, u).style
    const ot = oldHeatTitle(r, u), nt = newHeatOf(r, u).title
    n += 2
    if (JSON.stringify(os) !== JSON.stringify(ns)) fails.push(['heatStyle:' + u, JSON.stringify(qty), os, ns])
    if (ot !== nt) fails.push(['heatTitle:' + u, JSON.stringify(qty), ot, nt])
  }

  // 陈旧性测试：改一个格子的值，必须立刻反映（缓存不能返回旧色）
  const u0 = UNITS[0]
  r.qtyByUnit[u0] = '2500'
  const expect = oldHeatStyle(r, u0)
  const got = newHeatOf(r, u0).style
  const expectT = oldHeatTitle(r, u0)
  const gotT = newHeatOf(r, u0).title
  n += 2
  if (JSON.stringify(expect) !== JSON.stringify(got)) fails.push(['STALE heatStyle', u0, expect, got])
  if (expectT !== gotT) fails.push(['STALE heatTitle', u0, expectT, gotT])

  const oSum2 = oldRowSum(r), nSum2 = newRowSumOf(r)
  n++
  if (oSum2 !== nSum2) fails.push(['STALE rowSum', u0, oSum2, nSum2])
  const oWarn2 = oldRowWarn(r), nWarn2 = newRowWarn(r)
  n++
  if (oWarn2 !== nWarn2) fails.push(['STALE rowWarn', u0, oWarn2, nWarn2])

  // ai 变化也必须失效
  r.ai = 100
  n += 2
  if (JSON.stringify(oldHeatStyle(r, u0)) !== JSON.stringify(newHeatOf(r, u0).style)) fails.push(['STALE-AI heatStyle'])
  if (oldHeatTitle(r, u0) !== newHeatOf(r, u0).title) fails.push(['STALE-AI heatTitle'])
}

// 边界：空 qtyByUnit / 非本表对象（rowSumOf 必须退回 rowSum）
const bare = { qtyByUnit: {}, safety_stock: 0, expiry_days: 0, ai: null, unit: '' }
cross.value.rows = [bare]
n += 3
if (newRowSumOf(bare) !== oldRowSum(bare)) fails.push(['empty rowSum'])
const outside = { qtyByUnit: { u0: '3000' }, safety_stock: 0, expiry_days: 0, ai: null, unit: '箱' }
if (newRowSumOf(outside) !== oldRowSum(outside)) fails.push(['outside-row fallback'])
if (newHeatOf(outside, 'u0').style.background !== oldHeatStyle(outside, 'u0').background) fails.push(['outside-row heat'])

console.log('断言数 = ' + n)
console.log('失败数 = ' + fails.length)
fails.slice(0, 8).forEach(f => console.log('  FAIL ' + JSON.stringify(f, null, 0)))
process.exit(fails.length ? 1 : 0)
