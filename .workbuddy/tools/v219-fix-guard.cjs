#!/usr/bin/env node
/* v219 打磨⑤（保存前预检「一键修复」）的离线判据护栏 —— 纯 Node，不启浏览器、不连后端。
 *
 * 跑法：
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node \
 *       .workbuddy/tools/v219-fix-guard.cjs
 *
 * 为什么要这一层：`fixCandidate` 是**唯一**决定「哪些格会被自动改、改成什么」的函数。
 * 它的失败模式是「静默改错值」——不报错、界面照常，但用户的报单数量被改了。
 * 所以判据必须两道：
 *   A. 正向：每一类该修 / 不该修的情形逐条给期望值（**反向用例一条不能少** ——
 *      只断言「该修的能修」是恒真的绿，「不该修的没被修」才是这里真正要守的东西）。
 *   B. 反证：把源码按 6 处**变异**逐个改坏 ⇒ 上面任意一条必须变红。
 *      变异全绿 = 判据根本没在被测（红框不红比不红更危险）。
 *
 * 提取方式：从 Forecast.vue **原样**截出 HALF_MAP / toHalfNum / cellNumericMeta / fixCandidate
 * 四个符号（正则 + 花括号配平），再注入桩跑。不重写、不复制 —— 测的就是线上那份源码。
 */
'use strict'
const fs = require('fs')
const path = require('path')

const VUE = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue'
const SRC = fs.readFileSync(VUE, 'utf8')

let CHECKS = 0
const FAILS = []
function ok(cond, label) {
  CHECKS++
  if (!cond) FAILS.push(label)
  return !!cond
}

/* ---------- 源码截取 ---------- */
function grabFn(src, name) {
  const i = src.indexOf('function ' + name + '(')
  if (i < 0) throw new Error('未找到函数: ' + name)
  let j = src.indexOf('{', i)
  let depth = 0
  for (let k = j; k < src.length; k++) {
    const ch = src[k]
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(i, k + 1) }
  }
  throw new Error('花括号不配平: ' + name)
}
function grabConst(src, name) {
  const i = src.indexOf('const ' + name + ' = {')
  if (i < 0) throw new Error('未找到常量: ' + name)
  let j = src.indexOf('{', i)
  let depth = 0
  for (let k = j; k < src.length; k++) {
    const ch = src[k]
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(i, k + 1) }
  }
  throw new Error('花括号不配平: ' + name)
}

const HALF_MAP_SRC = grabConst(SRC, 'HALF_MAP')
const FN_TOHALF = grabFn(SRC, 'toHalfNum')
const FN_META = grabFn(SRC, 'cellNumericMeta')
const FN_FIX = grabFn(SRC, 'fixCandidate')

/* ---------- 桩 ---------- */
/* errKindOf 的桩**必须与源码 ERR_KINDS 同构** —— 否则测的是我另写的一套判据。
   下面第 0 组用例专门守这条：把源码里 ERR_KINDS 的 5 条 re 抽出来，逐条喂给桩，
   必须得到同一个 kind。 */
function mkErrKind() {
  return function errKindOf(msg) {
    if (/^数量过大/.test(msg)) return { k: 'over' }
    if (/^不能为负数/.test(msg)) return { k: 'neg' }
    if (/^必须为整数/.test(msg)) return { k: 'int' }
    if (/^必须是数字/.test(msg)) return { k: 'num' }
    if (/^商品名称必填/.test(msg)) return { k: 'name' }
    if (/^条码重复/.test(msg)) return { k: 'dup' }
    if (/^应为：/.test(msg)) return { k: 'enum' }
    return { k: 'other' }
  }
}

function build(cols, units, cells, max) {
  const body = [
    HALF_MAP_SRC + ';',
    FN_TOHALF,
    'const visibleCols = { value: __COLS };',
    'function unitCount(){ return __UNITS.length; }',
    'function readCellVal(r,c){ const row = __CELLS[r] || []; return row[c]; }',
    'const errKindOf = __EK;',
    'const qtyMax = __MAX;',
    FN_META,
    FN_FIX,
    'return { cellNumericMeta: cellNumericMeta, fixCandidate: fixCandidate };',
  ].join('\n')
  const f = new Function('__COLS', '__UNITS', '__CELLS', '__MAX', '__EK', body)
  return f(cols, units, cells, max, mkErrKind())
}

/* ---------- 环境工厂（供变异复用） ---------- */
function env() {
  const cols = [
    { key: 'name', label: '商品名称', edit: 'text' },
    { key: 'qty', label: '报单数量', edit: 'num', num: 'int' },
    { key: 'price', label: '分销价', edit: 'num' },          // 非整数数字列
  ]
  const units = [{ name: '客户A' }]
  const max = { value: 99999 }
  return { cols: cols, units: units, max: max, cells: [['x', '', '']] }
}

const MSG = {
  over: '数量过大（上限 99999）',
  neg: '不能为负数',
  int: '必须为整数',
  num: '必须是数字（当前值无法识别，如「12箱」请改为 12）',
  name: '商品名称必填（该行已填报数量）',
  dup: '条码重复（第 7 行 同品牌同名同规格）',
  enum: '应为：瓶/盒/箱 之一',
}

function runCase(box, e, ci, kind, val, want) {
  e.cells[0][ci] = val
  const g = build(e.cols, e.units, e.cells, e.max)
  let got
  try { got = g.fixCandidate(0, ci, MSG[kind]) } catch (err) { got = 'THROW:' + err.message }
  const gv = got === null || got === undefined ? null : (got && got.v !== undefined ? got.v : got)
  const isNull = got === null || got === undefined
  if (want === null) return isNull
  const wantV = typeof want === 'string' ? want : String(want)
  return !isNull && String(gv) === wantV
}

/* ---------- A. ERR_KINDS 桩同构 ---------- */
{
  const m = SRC.match(/const ERR_KINDS = \[([\s\S]*?)\n\]/)
  ok(!!m, 'A0 能从源码截到 ERR_KINDS')
  const pairs = []
  if (m) {
    const re = /\{ k: '([a-z]+)', label: '[^']*', re: \/\^([^/]+)\/ \}/g
    let x
    while ((x = re.exec(m[1])) !== null) pairs.push({ k: x[1], prefix: x[2] })
  }
  ok(pairs.length >= 7, 'A1 ERR_KINDS 至少截到 7 条（实际 ' + pairs.length + '）')
  const ek = mkErrKind()
  let same = 0
  pairs.forEach(function (p) {
    if (ek(p.prefix + '…').k === p.k) same++
    else FAILS.push('A2 桩与源码不同构: ' + p.k + ' ← 前缀「' + p.prefix + '」')
  })
  ok(same === pairs.length, 'A2 桩 errKindOf 与源码 ERR_KINDS 逐条同构（' + same + '/' + pairs.length + '）')
}

/* ---------- B. 正向用例 ---------- */
const CE = { name: 0, int: 1, price: 2, unit: 3 }
const CASES = [
  /* -- over：超出上限 ⇒ 截到上限（目标值由文案「上限 {max}」唯一确定） -- */
  ['B01 over(int列) 120000 ⇒ 99999', CE.int, 'over', 120000, '99999'],
  ['B02 over(单位列) 120000 ⇒ 99999', CE.unit, 'over', 120000, '99999'],
  ['B03 over 已是上限 99999 ⇒ 不修（无可改）', CE.int, 'over', 99999, null],
  ['B04 over 字符串 "100000" ⇒ 99999', CE.int, 'over', '100000', '99999'],

  /* -- num：串里唯一数字 ⇒ 取出那个数字（文案自己承诺「如「12箱」请改为 12」） -- */
  ['B05 num "12箱" ⇒ 12', CE.int, 'num', '12箱', '12'],
  ['B06 num 全角 "１２箱" ⇒ 12', CE.int, 'num', '１２箱', '12'],
  ['B07 num 全角+中文句号 "１２。５" ⇒ 12.5（非整列）', CE.price, 'num', '１２。５', '12.5'],
  ['B08 num 千分位 "1,200盒" ⇒ 1200', CE.int, 'num', '1,200盒', '1200'],
  ['B09 num "约12箱" ⇒ 12', CE.int, 'num', '约12箱', '12'],
  ['B10 num "12 箱"（含空格）⇒ 12', CE.int, 'num', '12 箱', '12'],

  /* -- num 的三条**不可修**（反向，一条都不能少） -- */
  ['B11 num 无数字 "箱" ⇒ 不修（归零是业务决定）', CE.int, 'num', '箱', null],
  ['B12 num 无数字 "abc" ⇒ 不修', CE.int, 'num', 'abc', null],
  ['B13 num 多数字 "12箱24瓶" ⇒ 不修（无法判定哪个是数量）', CE.int, 'num', '12箱24瓶', null],
  ['B14 num 带负号 "-5箱" ⇒ 不修（符号有语义）', CE.int, 'num', '-5箱', null],
  ['B15 num 带正号 "+12箱" ⇒ 不修', CE.int, 'num', '+12箱', null],
  ['B16 num "12.5箱" 在**整数列** ⇒ 不修（修完仍是红的=假修复）', CE.int, 'num', '12.5箱', null],
  ['B17 num 数学减号 "−5箱"（U+2212）⇒ 不修', CE.int, 'num', '−5箱', null],

  /* -- 其余四类一律不修（文案没给目标值） -- */
  ['B18 neg 负数 ⇒ 不修', CE.int, 'neg', -5, null],
  ['B19 int 非整数 ⇒ 不修（12.5 → 12 还是 13？）', CE.int, 'int', 12.5, null],
  ['B20 name 名称必填 ⇒ 不修', CE.name, 'name', '', null],
  ['B21 dup 条码重复 ⇒ 不修', CE.name, 'dup', '6901234567890', null],
  ['B22 enum 取值不在候选中 ⇒ 不修', CE.name, 'enum', '瓶', null],

  /* -- 列类型守卫：非数字列一律不进（否则会把商品名当数量改） -- */
  ['B23 文本列（商品名称）传 over ⇒ 不修', CE.name, 'over', '某商品', null],
]

CASES.forEach(function (c) {
  const e = env()
  ok(runCase(null, e, c[1], c[2], c[3], c[4]), c[0])
})

/* 超上限时的「非整数上限」守卫：把上限设成 100.5 看是否还敢修（不该修） */
{
  const e = env()
  e.max.value = 100.5
  const g = build(e.cols, e.units, e.cells, e.max)
  const r = g.fixCandidate(0, CE.int, MSG.over)
  ok(r === null || r === undefined, 'B24 上限非整数时 int 列不修（防写出 "100.5" 二次报错）')
}

/* ---------- C. 变异反证：改坏源码 ⇒ 必须有一条变红 ---------- */
function mutate(pairs) {
  let s = SRC
  for (const p of pairs) {
    if (s.indexOf(p[0]) < 0) throw new Error('变异锚点未命中: ' + p[0])
    s = s.replace(p[0], p[1])
  }
  return s
}
function rebuildFrom(srcText) {
  const hm = grabConst(srcText, 'HALF_MAP')
  const th = grabFn(srcText, 'toHalfNum')
  const mt = grabFn(srcText, 'cellNumericMeta')
  const fx = grabFn(srcText, 'fixCandidate')
  return function (cols, units, cells, max) {
    const body = [
      hm + ';',
      th,
      'const visibleCols = { value: __COLS };',
      'function unitCount(){ return __UNITS.length; }',
      'function readCellVal(r,c){ const row = __CELLS[r] || []; return row[c]; }',
      'const errKindOf = __EK;',
      'const qtyMax = __MAX;',
      mt, fx,
      'return { cellNumericMeta: cellNumericMeta, fixCandidate: fixCandidate };',
    ].join('\n')
    return new Function('__COLS', '__UNITS', '__CELLS', '__MAX', '__EK', body)(cols, units, cells, max, mkErrKind())
  }
}

const MUTANTS = [
  {
    name: 'M1 删掉「带符号」守卫',
    pairs: [["    if (/^[+-]/.test(s.trim())) return null\n", '']],
    probe: ['B14 "-5箱"', function (g, e) { return !runCaseG(g, e, CE.int, 'num', '-5箱', null) }],
  },
  {
    name: 'M2 多数字守卫放宽成「取第一个」',
    pairs: [['if (ms.length !== 1) return null', 'if (ms.length < 1) return null']],
    probe: ['B13 "12箱24瓶"', function (g, e) { return !runCaseG(g, e, CE.int, 'num', '12箱24瓶', null) }],
  },
  {
    name: 'M3 去掉 isInt 二次校验',
    pairs: [['if (meta.isInt && !Number.isInteger(n)) return null', '']],
    probe: ['B16 "12.5箱"（整数列）', function (g, e) { return !runCaseG(g, e, CE.int, 'num', '12.5箱', null) }],
  },
  {
    name: 'M4 去掉「值没变就不修」守卫',
    pairs: [['if (raw === cand) return null', '']],
    probe: ['B03 over 已是上限', function (g, e) { return !runCaseG(g, e, CE.int, 'over', 99999, null) }],
  },
  {
    name: 'M5 over 不再取上限（写成 max+1）',
    pairs: [['cand = String(qtyMax.value)', 'cand = String(Number(qtyMax.value) + 1)']],
    probe: ['B01 over ⇒ 99999', function (g, e) { return !runCaseG(g, e, CE.int, 'over', 120000, '99999') }],
  },
  {
    name: 'M6 无数字时改成归零（凭空造值）',
    /* ⚠️ 必须**跨两行**替换：只改守卫那一行、把 `cand = ms[0]` 留着的话，
       length===0 时 `cand` 会被紧接着的 `ms[0]`（undefined）覆盖 ⇒ 变异自动失效、
       看起来「变异没被抓到」而其实是变异没生效。第一版就踩了这个坑。 */
    pairs: [['    if (ms.length !== 1) return null\n    cand = ms[0]',
      "    if (ms.length === 0) { cand = '0' } else { cand = ms[0] }"]],
    probe: ['B11 "箱" 不该被归零', function (g, e) { return !runCaseG(g, e, CE.int, 'num', '箱', null) }],
  },
]

function runCaseG(g, e, ci, kind, val, want) {
  e.cells[0][ci] = val
  let got
  try { got = g.fixCandidate(0, ci, MSG[kind]) } catch (err) { got = 'THROW:' + err.message }
  const isNull = got === null || got === undefined
  if (want === null) return isNull
  const gv = got && got.v !== undefined ? got.v : got
  return !isNull && String(gv) === String(want)
}

MUTANTS.forEach(function (m) {
  let mkBuild
  try { mkBuild = rebuildFrom(mutate(m.pairs)) } catch (err) {
    FAILS.push('M0 变异构造失败 ' + m.name + ': ' + err.message)
    return
  }
  const e = env()
  const g = mkBuild(e.cols, e.units, e.cells, e.max)
  let caught = false
  try { caught = m.probe[1](g, e) } catch (err) { caught = true }
  ok(caught, 'C 变异被抓到：' + m.name + ' ⇒ ' + m.probe[0] + ' 变红')
})

/* ---------- 输出 ---------- */
console.log('检查项 ' + CHECKS + ' 条，失败 ' + FAILS.length + ' 条')
if (FAILS.length) {
  console.log('\n--- FAIL ---')
  FAILS.forEach(function (f, i) { console.log((i + 1) + '. ' + f) })
  console.log('\nRESULT: FAIL')
  process.exit(1)
}
console.log('RESULT: PASS')
