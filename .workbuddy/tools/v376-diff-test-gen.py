# -*- coding: utf-8 -*-
# 从「改动前」与「改动后」两个版本的 Forecast.vue 里抽出真实函数体，
# 生成差分测试（同样输入下新旧实现必须逐位相同）。
import io, re, json, sys

OLD = io.open('/tmp/Forecast.vue.bak-before-v374', encoding='utf-8').read()
NEW = io.open('/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue', encoding='utf-8').read()

def extract_func(src, sig):
    i = src.find(sig)
    if i < 0:
        raise SystemExit('NOT FOUND: ' + sig)
    j = src.find('{', i)
    d = 0
    k = j
    while k < len(src):
        c = src[k]
        if c == '{': d += 1
        elif c == '}':
            d -= 1
            if d == 0: return src[i:k + 1]
        k += 1
    raise SystemExit('UNBALANCED: ' + sig)

def extract_const_arrow(src, sig):
    i = src.find(sig)
    if i < 0:
        raise SystemExit('NOT FOUND: ' + sig)
    j = src.find('(', i)
    # 找到与 ( 配对的 )，再取到该语句行尾
    d = 0; k = j
    while k < len(src):
        c = src[k]
        if c == '(': d += 1
        elif c == ')':
            d -= 1
            if d == 0: break
        k += 1
    end = src.find('\n', k)
    return src[i:end]

old_bits = {
    'rowSum':   extract_func(OLD, 'function rowSum(r) {'),
    'rowWarn':  extract_func(OLD, 'function rowWarn(r) {'),
    'heatStyle': extract_func(OLD, 'function heatStyle(r, uname) {'),
    'heatTitle': extract_func(OLD, 'function heatTitle(r, uname) {'),
}
new_bits = {
    'rowSum':   extract_func(NEW, 'function rowSum(r) {'),
    'rowWarn':  extract_func(NEW, 'function rowWarn(r) {'),
    'rowSumArr': extract_const_arrow(NEW, 'const rowSumArr = computed('),
    'rowSumOf': extract_func(NEW, 'function rowSumOf(r) {'),
    'heatOf':   extract_func(NEW, 'function heatOf(r, uname) {'),
}

js = []
js.append('// 自动生成：新旧实现差分测试（勿手改）')
js.append('const WARN_ABS = 1500')
js.append('const fmt = (v) => String(v)')
js.append('// 故意用「不缓存」的 computed 垫片：强制每次访问都重算，把 WeakMap 同步逻辑压到极限')
js.append('const computed = (fn) => ({ get value(){ return fn() } })')
js.append('const cross = { value: { rows: [] } }')
js.append('const visibleCols = { value: [] }')
js.append('const unitCount = () => 0')
js.append('')
def rename_old(src, pairs):
    for a, b in pairs:
        src = re.sub(r'\b' + a + r'\b', b, src)
    return src

old_bits['rowSum'] = rename_old(old_bits['rowSum'], [('rowSum', 'oldRowSum')])
old_bits['rowWarn'] = rename_old(old_bits['rowWarn'], [('rowWarn', 'oldRowWarn'), ('rowSum', 'oldRowSum')])
old_bits['heatStyle'] = rename_old(old_bits['heatStyle'], [('heatStyle', 'oldHeatStyle')])
old_bits['heatTitle'] = rename_old(old_bits['heatTitle'], [('heatTitle', 'oldHeatTitle')])

js.append('/* ===== 旧实现（前缀 old，避免与新实现撞名） ===== */')
js.append(old_bits['rowSum'])
js.append(old_bits['rowWarn'])
js.append(old_bits['heatStyle'])
js.append(old_bits['heatTitle'])
js.append('')
js.append('/* ===== 新实现（前缀 new） ===== */')
nb = new_bits
nb['rowSum'] = rename_old(nb['rowSum'], [('rowSum', 'newRowSum')])
nb['rowSumArr'] = rename_old(nb['rowSumArr'], [('rowSumArr', 'newRowSumArr'), ('rowSum', 'newRowSum')])
nb['rowSumOf'] = rename_old(nb['rowSumOf'], [('rowSumOf', 'newRowSumOf'), ('rowSumArr', 'newRowSumArr'), ('rowSum', 'newRowSum')])
nb['rowWarn'] = rename_old(nb['rowWarn'], [('rowWarn', 'newRowWarn'), ('rowSumOf', 'newRowSumOf')])
nb['heatOf'] = rename_old(nb['heatOf'], [('heatOf', 'newHeatOf')])
js.append(nb['rowSum'])
js.append('const _rowSumByObj = new WeakMap()')
js.append(nb['rowSumArr'])
js.append(nb['rowSumOf'])
js.append(nb['rowWarn'])
js.append('const _heatMemo = new WeakMap()')
js.append(nb['heatOf'])
js.append('')
js.append('''
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
''')

out = '/tmp/v375-diff-test.mjs'
io.open(out, 'w', encoding='utf-8').write('\n'.join(js))
print('WROTE ' + out)
print('抽出：旧 %d 个函数 / 新 %d 个' % (len(old_bits), len(new_bits)))
