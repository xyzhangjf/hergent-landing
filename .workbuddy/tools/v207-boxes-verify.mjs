#!/usr/bin/env node
/* v207 箱口径护栏 —— 「合计(箱) 显示不了」的根因复现 + 修复后断言。
 *
 * 🔴 铁律：**切片真实源码 exec，不做复刻**。
 *    本脚本从 Forecast.vue 里按函数名抠出真正的实现（brace matching）后放进沙箱执行，
 *    因此源码一改、断言立刻跟着变；不会出现「复刻实现与源码漂移」那种假绿。
 *    （照抄一份实现进断言里，是这类护栏最常见的自欺形式。）
 *
 * 被测口径（用户 2026-09-13 拍板，2026-09-19 才发现实现反了）：
 *   ① 报单数量按**最小销售单位**录入（瓶/杯/组/袋）；
 *   ② 件数 = 数量 ÷ 每箱小单位数，**可为小数**（合计(箱) 同此）；
 *   ③ 取整只发生在「最终下单」= ceil(件数) + 加单，方向商品级、默认向上（厂商不拆零发货）。
 *
 * 用法：node .workbuddy/tools/v207-boxes-verify.mjs
 * 真实数据来源：生产只读库 tenant_1.db（期次 14 / 永辉东津店 / 单据 id 491）。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const SRC = path.join(ROOT, 'hergent-cn-v2/src/pages/Forecast.vue')
const src = fs.readFileSync(SRC, 'utf8')

/* ---------- 1. 从真实源码里抠函数（brace matching） ---------- */
function sliceFn(needle) {
  const i = src.indexOf(needle)
  if (i < 0) throw new Error('源码里找不到：' + needle)
  const b = src.indexOf('{', i)
  const nl = src.indexOf('\n', i)
  if (b < 0 || (nl >= 0 && nl < b)) return src.slice(i, nl < 0 ? src.length : nl).trim()
  let d = 0
  for (let j = b; j < src.length; j++) {
    const ch = src[j]
    if (ch === '{') d++
    else if (ch === '}') { d--; if (d === 0) return src.slice(i, j + 1) }
  }
  throw new Error('花括号不配平：' + needle)
}

const NEEDLES = [
  'function perCase(spec, unit)',
  'function boxesOf(total, spec, unit)',
  'function rowBoxes(r)',
  'function boxMissing(r)',
  'function boxText(r)',
  'function rowSum(r)',
  'function fmt(n)',
  'function fmtBox(n)',
  'function statFmt(key, n)',
  'const rowExtraQty',
  'const rowFinalQty',
  'function factoryPrice(r)',
  'function priceAuto(r)',
  'function priceInherit(r)',
  'function pricePerCase(r)',
  'function amountValue(r)',
]
const pieces = NEEDLES.map(n => sliceFn(n))

const bundle = pieces.join('\n') +
  '\nreturn { perCase, boxesOf, rowBoxes, boxMissing, boxText, rowSum, fmt, fmtBox, statFmt,' +
  ' rowExtraQty, rowFinalQty, factoryPrice, priceAuto, pricePerCase, amountValue }'
const M = new Function(bundle)()

/* 反证「确实是从源码抠的」：抠出来的实现必须含 v207 的关键语句 */
const joined = pieces.join('\n')
if (!/Math\.ceil\(rowBoxes\(r\) - 1e-9\)/.test(joined)) throw new Error('rowFinalQty 里没找到取整（源码可能已回退）')
if (!/Math\.round\(t \/ pc \* 1000\) \/ 1000/.test(joined)) throw new Error('boxesOf 里没找到 3 位小数换算')
if (/Math\.round\(total \/ pc\)/.test(joined)) throw new Error('boxesOf/rowBoxes 里仍有旧的 round(total/pc) 抹零')

/* ---------- 2. 断言脚手架 ---------- */
let pass = 0, fail = 0
const fails = []
function eq(label, got, want) {
  const ok = String(got) === String(want)
  if (ok) pass++; else { fail++; fails.push(`${label}: 得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}`) }
}
function truthy(label, v) { eq(label, !!v, true) }

/* ---------- 3. 真实数据（生产只读库 期次14 / 永辉东津店） ---------- */
const R1 = { product_id: 1161, spec: '185ml×24瓶', unit: '瓶', total: 3, factory_price: 0, purchase_price: 0 }
const R2 = { product_id: 1164, spec: '340G', unit: '瓶', total: 3, factory_price: 0, purchase_price: 0 }
const R3 = { product_id: 1205, spec: '135g*24杯', unit: '杯', total: 3, factory_price: 93.1, purchase_price: 0 }
const REAL = [R1, R2, R3]

/* ---------- 4. 旧实现（仅用于证明判别力，不参与修复后断言） ---------- */
const oldRowBoxes = (r) => {
  const pc = M.perCase(r.spec, r.unit)
  return (pc > 0 && r.total) ? Math.round(r.total / pc) : 0
}

/* ---------- 5. 复现：修复前全是 0 ---------- */
const oldBoxes = REAL.reduce((s, r) => s + oldRowBoxes(r), 0)
const oldFinal = REAL.reduce((s, r) => s + oldRowBoxes(r), 0)  // 旧 rowFinalQty = rowBoxes + 加单，加单为 0
eq('复现｜旧实现 合计(箱) 合计', oldBoxes, 0)
eq('复现｜旧实现 最终下单 合计', oldFinal, 0)
console.log('\n【复现】期次14 永辉东津店：合计(小单位)=9，旧实现的合计(箱)=0 —— 与用户报障逐字一致')

/* ---------- 6. 修复后：真实行逐行 ---------- */
console.log('\n【修复后】逐行（真实档案规格）')
console.log('  pid   规格            单位  合计(小单位)  每箱小单位数   合计(箱)      最终下单   单元格显示')
const pcWant = { 1161: 24, 1164: 340, 1205: 24 }
const boxWant = { 1161: 0.125, 1164: 0.009, 1205: 0.125 }
REAL.forEach(r => {
  const pc = M.perCase(r.spec, r.unit)
  const bx = M.rowBoxes(r)
  const fq = M.rowFinalQty(r)
  console.log('  ' + String(r.product_id).padEnd(6) + String(r.spec).padEnd(16) + String(r.unit).padEnd(6) +
    String(r.total).padEnd(14) + String(pc).padEnd(15) + String(bx).padEnd(13) + String(fq).padEnd(11) + M.boxText(r))
  eq(`perCase(${r.spec}, ${r.unit})`, pc, pcWant[r.product_id])
  eq(`rowBoxes(pid=${r.product_id})`, bx, boxWant[r.product_id])
  eq(`rowFinalQty(pid=${r.product_id}) = ceil(箱)`, fq, 1)
  truthy(`boxMissing(pid=${r.product_id}) 为假（有规格）`, !M.boxMissing(r))
})

const newBoxes = REAL.reduce((s, r) => s + M.rowBoxes(r), 0)
const newFinal = REAL.reduce((s, r) => s + M.rowFinalQty(r), 0)
eq('修复后｜合计(箱) 合计（= 0.125 + 0.009 + 0.125）', Math.round(newBoxes * 1000) / 1000, 0.259)
eq('修复后｜最终下单 合计（3 行各取整为 1 箱）', newFinal, 3)
truthy('修复后｜合计(箱) 不再是 0', newBoxes > 0)

/* 下单金额：修复前恒为 0，修复后按「取整后的箱数 × 厂价/箱」算。
   ⚠️ 换算链要写清楚，别把「元/件」当「元/箱」：pid1205 档案 fp=93.1 是**元/件（每杯）**，
      「单价(厂价/箱)」= 93.1 × 24（杯/箱）= 2234.4 元/箱。
      v190 的「归一化到分」在这里正好生效：93.1×24 原值是 2234.3999999999996，
      不归一会让「界面上写着 2234.40、金额却是 2234.3999… 累出来的」。 */
eq('修复前｜pid1205 下单金额（0 箱 × 单价）', (oldRowBoxes(R3) * M.pricePerCase(R3)) || 0, 0)
eq('修复后｜pid1205 单价(厂价/箱) = 93.1 元/件 × 24 杯/箱', M.pricePerCase(R3), 2234.4)
eq('修复后｜pid1205 下单金额 = 1 箱 × 2234.4', M.amountValue(R3), 2234.4)
truthy('归一化到分｜93.1×24 的原始浮点是 2234.3999999999996，已被归到 2234.4',
  (93.1 * 24) !== 2234.4 && M.pricePerCase(R3) === 2234.4)
eq('修复后｜pid1161 缺价 ⇒ 金额为 null（显示「缺价」而非 0）', M.amountValue(R1), null)

/* ---------- 7. 规格 / 单位 / 边界 ---------- */
console.log('\n【边界与对照】')
const row = (spec, unit, total, extra) => Object.assign({ spec, unit, total }, extra ? { extra_qty: extra } : {})
const CASES = [
  // ① 恰为一箱：不能被 1e-9 护栏误判成 2 箱
  ['C1 整箱 24/24', row('185ml×24瓶', '瓶', 24), 1, 1],
  // ② 不足一箱：箱数保留小数，最终下单向上取 1
  ['C2 5/24 = 0.208 箱', row('185ml×24瓶', '瓶', 5), 0.208, 1],
  // ③ 3 箱：跨过 1 箱后仍为整数
  ['C3 72/24 = 3 箱', row('185ml×24瓶', '瓶', 72), 3, 3],
  // ④ 层级规格：1 箱 = 12 组 = 96 杯（unit 比末位更细 ⇒ 相乘）
  ['C4 96/96 = 1 箱（8杯×12组）', row('90g*8杯*12组', '杯', 96), 1, 1],
  // ⑤ 末位无单位：'500g*12' 的 12 即每箱数
  ['C5 6/12 = 0.5 箱', row('500g*12', '瓶', 6), 0.5, 1],
  // ⑥ 缺规格：不换算、不当 1
  ['C6 缺规格', row('', '瓶', 12), 0, 0],
  // ⑦ 无报单：真 0，不算缺规格
  ['C7 无报单', row('185ml×24瓶', '瓶', 0), 0, 0],
]
CASES.forEach(([label, r, wantBox, wantFinal]) => {
  const bx = M.rowBoxes(r), fq = M.rowFinalQty(r)
  console.log('  ' + label.padEnd(28) + ' 合计(箱)=' + String(bx).padEnd(9) + ' 最终下单=' + String(fq).padEnd(5) + ' 显示=' + M.boxText(r))
  eq(label + ' ｜合计(箱)', bx, wantBox)
  eq(label + ' ｜最终下单', fq, wantFinal)
})
truthy('C1 整箱 24/24 未被 1e-9 护栏误升为 2 箱', M.rowFinalQty(row('185ml×24瓶', '瓶', 24)) === 1)
truthy('C6 缺规格 ⇒ boxMissing 为真', M.boxMissing(row('', '瓶', 12)))
eq('C6 缺规格 ⇒ 单元格显示', M.boxText(row('', '瓶', 12)), '缺规格')
truthy('C7 无报单 ⇒ boxMissing 为假（0 就是 0，不是数据缺）', !M.boxMissing(row('185ml×24瓶', '瓶', 0)))
eq('C7 无报单 ⇒ 单元格显示', M.boxText(row('185ml×24瓶', '瓶', 0)), '0')

/* 加单叠加：最终下单 = ceil(箱) + 加单（加单不进 ceil） */
eq('加单｜0.125 箱 + 加单 2 = 3', M.rowFinalQty(row('185ml×24瓶', '瓶', 3, 2)), 3)
eq('加单｜2 箱 + 加单 1 = 3（不能被取整多算）', M.rowFinalQty(row('185ml×24瓶', '瓶', 48, 1)), 3)

/* ---------- 8. 浮点护栏的必要性（经验证据，不是「我觉得」） ---------- */
let floatHits = 0
const floatSample = []
for (let pc = 1; pc <= 400; pc++) {
  for (let t = 1; t <= 4000; t++) {
    const q = t / pc
    if (q % 1 === 0 && Math.ceil(q) !== q) { floatHits++; if (floatSample.length < 3) floatSample.push(`${t}/${pc}=${q}`) }
  }
}
console.log('\n【浮点护栏】1..400 箱规 × 1..4000 数量 中有 ' + floatHits + ' 组「整除但 Math.ceil 会多算 1 箱」' +
  (floatSample.length ? '，如 ' + floatSample.join('、') : ''))
console.log('  ⇒ ' + (floatHits > 0 ? 'Math.ceil(x - 1e-9) 的护栏是必要的（否则这些会凭空多一箱）' : '本区间未命中，护栏为防御性保留'))

/* ---------- 9. 显示格式（显示层的二次抹零也必须被堵住） ---------- */
console.log('\n【格式】')
const strip = (s) => String(s).replace(/,/g, '')
eq('fmtBox(0.125) 不抹零', strip(M.fmtBox(0.125)), '0.125')
eq('fmtBox(0.259) 不抹零', strip(M.fmtBox(0.259)), '0.259')
eq('fmtBox(3) 不长出小数尾巴', M.fmtBox(3), '3')
truthy('旧的 maximumFractionDigits: 0 会把 0.125 显示成 0（这正是「没显示」的显示层成因）',
  (0.125).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) === '0')
eq('fmt(292.08) 金额按分显示', strip(M.fmt(292.08)), '292.08')
// ⚠️ 千分位：浏览器与 Node 都按分组输出，断言前统一去逗号，不把「分组」当被测口径。
eq('fmt(3840) 整数金额不带小数尾巴', strip(M.fmt(3840)), '3840')
truthy('fmt(3840) 有千分位', String(M.fmt(3840)).includes(','))
eq('statFmt("boxes", 0.125) 与单元格同精度', strip(M.statFmt('boxes', 0.125)), '0.125')
eq('statFmt("amount", 0.125) 金额仍 2 位', strip(M.statFmt('amount', 0.125)), '0.13')

/* ---------- 10. 汇总 ---------- */
console.log('\n' + '='.repeat(72))
console.log(fail === 0 ? `✅ 全部通过：${pass} 项断言` : `❌ ${fail} 项失败 / 共 ${pass + fail} 项`)
if (fail) { fails.forEach(f => console.log('   ✗ ' + f)); process.exit(1) }
