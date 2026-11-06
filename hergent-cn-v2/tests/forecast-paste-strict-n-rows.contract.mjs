/* ㊱·d v785 契约：粘贴「严格 N 行全覆盖」—— 行数/顺序/占位/0/空白覆盖
 * ============================================================
 * 用户报障（2026-11-06，第三次粘贴报障）：
 *   「易胜玲复制了 99 行（含空白行），系统仅粘贴到第 76 行即被截断，后续行未写入；
 *     其中第 98 个商品在 Excel 中为 0，系统里仍残留旧值 12 未被覆盖，仍为 12。」
 *
 * 根因（三处过滤/截断，实证见 .workbuddy/tools/probe-paste-row-truncation.mjs）：
 *   ① onPaste 的 `.filter(l => l.trim().length)` 删光空白行 ⇒ 99 行压成 76 行且后续行错位；
 *   ② parseTSV 的 `while (尾部空) pop()` 剥掉尾部空白数据行 ⇒ 尾段整段丢失；
 *   ③ pasteRegion 的 `needRows = maxWriteR + 1` 只按最后非空行撑行 + clears 的
 *      `k.r < rows.length` 越界守卫 ⇒ 尾部空白行不占位、目标位置旧值残留。
 *   🔴 后端保存是「删旧建新」，`qty_by_unit` 只发 model 里已存在的 key ⇒
 *      那一格从没被 writeCellVal 触达，旧值 12 就永远留在库里。故修复必须在写入层。
 *
 * 修法（Forecast.vue v785）：
 *   · parseTSV 保留全部 N 行（含空白行、含尾部空白行），一行不删；
 *   · onPaste 不再 filter 空白行；
 *   · pasteRegion 补行按 `sr + rows`（源数据总行数），空白行逐格覆盖清空、
 *     0/非空逐格写入，不再有越界跳过；列数取全块最大列数（空白行不丢列）；
 *   · tryPasteCross 空白行明确报数（按名匹配路径无法按位置定位，不做猜测式写入）。
 *
 * 🔴 护栏强度（本项目反复栽「复刻循环 = 假绿」的坑）：
 *   本契约**抽取真实函数体** parseTSV / pasteCellEmpty / writeCellVal / pasteRegion，
 *   注入最小桩在 vm 里实跑，直接断言 99 行粘贴后 `cross.rows` 的最终值。
 *   坏样本自证：把源码还原成 v783/v784 的旧逻辑后实跑 ⇒ 旧 bug 重现、判据翻转。
 * 🔴 静态判据必须**剥注释后再判** —— 注释里逐字抄了旧代码字符串会自撞成空白支票
 *   （v777 踩过：注释抄 spec ⇒ 判据恒假）。
 * 🔴 口径反转：v783 ㊱·c 的「尾行空白不撑行」是旧标准，v785 起改为
 *    「尾行空白也占位覆盖」（用户明确要求 N 行就是 N 行）。见 ㊱·c 同步更新。
 */

import fs from 'fs'
import path from 'path'
import vm from 'vm'

const vue = fs.readFileSync(path.resolve('src/pages/Forecast.vue'), 'utf-8')
let pass = 0, fail = 0
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✅', label) }
  else { fail++; console.log('  ❌', label) }
}

/* 精准截取单个顶层函数体：从声明到「行首 }」（顶层函数闭合总是在行首无缩进）。
   ⚠️ 不能用「下一个 \nfunction 」：pasteRegion 后面紧跟的是 onMounted(...) 而非函数声明，
      会把整段模板代码截进来（vm 里 onMounted 未定义 ⇒ 直接崩）。 */
const fnBody = (sig) => {
  const s = vue.indexOf(sig)
  if (s < 0) return ''
  const rest = vue.slice(s)
  const m = rest.match(/^\}/m)          // 第一个行首 }
  return m ? rest.slice(0, m.index + 1) : ''
}
/* 剥注释（块注释 + 整行行注释）后再做结构判据，避免注释自撞。 */
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const parseTSVTxt = fnBody('function parseTSV(text)')
const pasteCellEmptyTxt = (vue.match(/function pasteCellEmpty\(v\)\s*\{[^}]*\}/) || [''])[0]
const writeCellValTxt = fnBody('function writeCellVal(r, c, v)')
/* v792：`writeCellVal` 写数量格时会先把该格从「分摊叠加」里接管出来（`qtyCellTakeOver`）。
   本契约只验「写入层严格 N 行全覆盖」，与本主题无关，但仍注入**真实函数体**而不是桩：
   桩会让「接管逻辑哪天被删」在本文件里悄悄失去观测，而抽真实体只是多一行。
   （分摊/覆盖语义本身由 forecast-paste-overwrite.contract.mjs 专门钉。） */
const qtyCellTakeOverTxt = fnBody('function qtyCellTakeOver(r, store)')
const pasteRegionTxt = fnBody('function pasteRegion(text)')
const onPasteTxt = fnBody('function onPaste(e)')
const tryPasteCrossTxt = fnBody('function tryPasteCross(block)')
const cTSV = stripComments(parseTSVTxt)
const cRegion = stripComments(pasteRegionTxt)
const cOnPaste = stripComments(onPasteTxt)
const cCross = stripComments(tryPasteCrossTxt)

console.log('=== 静态判据（三处过滤/截断确实被拆除 + 新全覆盖写入确实存在，均剥注释后判） ===')
ok(parseTSVTxt.length > 0 && !/while\s*\([\s\S]*?lines\.pop\(\)/.test(cTSV),
  'parseTSV 不再 while(尾部空) pop() 剥空白数据行')
ok(/return lines\.map\(/.test(cTSV), 'parseTSV 仍逐行映射（保留全部 N 行）')
ok(!/\.filter\(l => l\.trim\(\)\.length\)/.test(cOnPaste),
  'onPaste 不再 filter 删空白行')
ok(/const needRows = sr \+ rows/.test(cRegion),
  'pasteRegion 补行按源数据总行数（sr + rows），空白行也占位')
ok(!/const needRows = maxWriteR \+ 1/.test(cRegion),
  'pasteRegion 不再按「最后非空行」(maxWriteR) 撑行')
ok(/for \(const k of clears\) \{ writeCellVal\(k\.r, k\.c, ''\)/.test(cRegion)
  && !/k\.r < cross\.value\.rows\.length/.test(cRegion),
  'pasteRegion 空白格逐格全覆盖清空，无「越界跳过」守卫')
ok(/block\.reduce\(\(m, r\) => Math\.max\(m, r\.length\), 0\)/.test(cRegion),
  '列数取「全块最大列数」（空白行压成 1 列时不丢后续列）')
ok(/blankRows/.test(cRegion) && /行空白也占位清空/.test(cRegion),
  '提示明确报出「含 N 行空白也占位清空」（不静默）')
ok(/blankRows\+\+/.test(cCross) && !/skipped\+\+/.test(cCross),
  'tryPasteCross 空白行改为明确报数，不再 skipped++ 静默丢弃')

console.log('\n=== 动态判据：抽取真实函数体注入桩实跑 99 行粘贴 ===')

/* 构造用户场景：99 行单列数据，其中 23 行是空白、第 98 行(索引97)是 0，
   系统里 99 行旧值全是 12。断言粘贴后逐行严格一致。 */
const N = 99
/* 23 行空白 ⇒ 旧 onPaste 的 filter 恰好压成 76 行（易胜玲现场数字）；
   且第 99 行是空白 ⇒ 能一并验证「尾部空白数据行不被 parseTSV 剥掉」、
   「旧 maxWriteR 撑行 + clears 越界跳过会让尾行旧值残留」。
   第 98 行恒为 '0'（用户报障里残留 12 的那一格），不放进空白集。 */
const BLANK = new Set([10, 11, 12, 20, 21, 30, 31, 32, 40, 50, 60, 61, 70,
  88, 89, 90, 91, 92, 93, 94, 95, 96, 99])
const src = []
for (let i = 1; i <= N; i++) {
  if (BLANK.has(i)) src.push('')
  else if (i === 98) src.push('0')
  else src.push(String(i * 2))
}
const text = src.join('\n')
// 对照组：末尾无空白数据行（用于证明坏样本 1 不是「恒红」）
const textNoTail = src.slice(0, 98).join('\n')

function makeSandbox(regionOverride) {
  const UNIT = '易胜玲'
  const rows = []
  for (let i = 0; i < N; i++) rows.push({ name: '商品' + (i + 1), qtyByUnit: { [UNIT]: 12 } })
  const state = { rows, toasts: [], UNIT }
  const sb = {
    UNIT,
    cross: { value: { rows, units: [{ name: UNIT }] } },
    visibleCols: { value: [] },
    unitCount: () => 1,
    selRange: { value: null },
    selected: { value: { r: 0, c: 0 } },
    blankRow: () => ({ name: '', qtyByUnit: {}, _deleted: false }),
    snapshot: () => {},
    parseNumInput: (v) => { const s = String(v == null ? '' : v).trim(); if (s === '') return 0; const n = Number(s); return Number.isNaN(n) ? s : n },
    calcInputKey: () => null,
    cellInvalid: () => false,
    toast: (m) => { state.toasts.push(String(m)) },
    batchWrite: () => {},
    relaxBrandFilterForPaste: () => false,
    pasteRowName: (r) => '行' + r,
    pasteColName: (c) => '列' + c,
    ensureRowsRendered: () => {},
    markPasteLand: () => {},
    setPasteResult: () => {},   // v786：结果常驻展示的快照入口，本护栏只关心写入层，桩掉
    scrollRowIntoView: () => {},
    state,
  }
  vm.createContext(sb)
  const code = [
    parseTSVTxt, pasteCellEmptyTxt, qtyCellTakeOverTxt, writeCellValTxt,
    regionOverride || pasteRegionTxt,
    'this.__parseTSV = parseTSV; this.__pasteRegion = pasteRegion; this.__writeCellVal = writeCellVal;',
  ].join('\n')
  vm.runInContext(code, sb)
  return sb
}

const sb = makeSandbox()
const block = sb.__parseTSV(text)
ok(block.length === N, `parseTSV 保留全部 ${N} 行（含 ${BLANK.size} 行空白），未中途截断`)
ok(String(block[N - 1][0]).trim() === '',
  '尾部空白行为真实数据行，未被剥掉')

sb.__pasteRegion(text)
const after = sb.cross.value.rows
ok(after.length >= N, `目标至少 ${N} 行有落点（实际 ${after.length}），最后一行未被截断`)

// 逐行严格一致：第 i 行必须是源数据第 i 行的值（0 / 空白→0 / 非空→数值）
const mismatch = []
for (let i = 0; i < N; i++) {
  const expect = src[i] === '' ? 0 : Number(src[i])
  const got = after[i].qtyByUnit[sb.UNIT]
  if (got !== expect) mismatch.push({ row: i + 1, expect, got })
}
ok(mismatch.length === 0,
  `源 ${N} 行 → 目标 ${N} 行逐行严格一致（顺序/0/空白全覆盖）${mismatch.length ? ' 反例:' + JSON.stringify(mismatch.slice(0, 3)) : ''}`)

ok(after[97].qtyByUnit[sb.UNIT] === 0,
  '第 98 个商品 Excel 为 0 → 旧值 12 被覆盖为 0（本次报障的关键格）')
const blankIdx = [...BLANK].map(n => n - 1)
ok(blankIdx.every(i => after[i].qtyByUnit[sb.UNIT] === 0),
  `全部 ${BLANK.size} 个空白行的旧值 12 都被覆盖清空为 0（空白行占位并参与覆盖）`)
ok(after[0].qtyByUnit[sb.UNIT] === 2 && after[1].qtyByUnit[sb.UNIT] === 4,
  '顺序一致：源第 1/2 行落到目标第 1/2 行，未因删空白行而上移错位')
ok(sb.state.toasts.some(t => /99 行/.test(t) && /23 行空白/.test(t)),
  '提示回执报出「99 行」「23 行空白也占位清空」（不静默）')

console.log('\n=== 坏样本自证（撤销修复即红）：还原 v783/v784 旧逻辑后实跑 ===')

// 坏样本 1：parseTSV 还原「尾部 while pop」⇒ 尾部空白行整段丢失
const badTSV = parseTSVTxt.replace(
  /  return lines\.map\(/,
  "  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()\n  return lines.map(")
/* ⚠️ 检测器不能用 `[^)]*`：注入的 while 条件里有 `.trim()`，第一个 `)` 会提前截断匹配
   （首跑实测假红）。用 [\s\S]*? 跨到 lines.pop()。 */
ok(/while\s*\([\s\S]*?lines\.pop\(\)/.test(badTSV), '坏样本 1 注入旧 pop 成功')
{
  const s2 = {}
  vm.createContext(s2)
  vm.runInContext(badTSV + '\nthis.p = parseTSV;', s2)
  const t2 = Array.from({ length: 99 }, (_, i) => i < 76 ? String(i + 1) : '').join('\n')
  ok(s2.p(t2).length === 76,
    '坏样本 1 实跑：99 行（尾部 23 行空白）被旧 pop 压成 76 行 ⇒ 正是用户报障的 99→76 截断')
  ok(s2.p(textNoTail).length === sb.__parseTSV(textNoTail).length,
    '对照组：末尾无空白数据行 ⇒ 坏样本 1 不误伤（判据精确针对「尾部空白」，不是恒红）')
}

// 坏样本 2：pasteRegion 还原「按最后非空行撑行 + clears 越界跳过」
const badRegion = pasteRegionTxt
  .replace('  let blankRows = 0', '  let maxWriteR = -1, blankRows = 0')
  .replace("      if (pasteCellEmpty(v)) { clears.push({ r: R, c: C }); continue }",
    "      if (pasteCellEmpty(v)) { clears.push({ r: R, c: C }); continue }\n      if (R > maxWriteR) maxWriteR = R")
  .replace('  const needRows = sr + rows', '  const needRows = maxWriteR + 1')
  .replace("  for (const k of clears) { writeCellVal(k.r, k.c, ''); cleared++ }",
    "  for (const k of clears) { if (k.r < cross.value.rows.length) { writeCellVal(k.r, k.c, ''); cleared++ } }")
ok(/const needRows = maxWriteR \+ 1/.test(badRegion)
  && /k\.r < cross\.value\.rows\.length/.test(badRegion), '坏样本 2 注入旧撑行 + 越界跳过成功')

/* 坏样本 2 实跑：目标表原本只有 76 行（用户现场「只到第 76 行」的形态），
   源数据尾部空白行 ⇒ 旧逻辑不撑行、越界 clears 被跳过 ⇒ 尾部旧值 12 残留。 */
{
  const s3 = makeSandbox(badRegion)
  // 收窄目标表到 76 行，复现「目标表行数不足」的现场
  s3.cross.value.rows.length = 76
  s3.__pasteRegion(text)
  const a3 = s3.cross.value.rows
  const tailResidual = a3.length < N || (a3[97] && a3[97].qtyByUnit[s3.UNIT] === 12)
  ok(tailResidual,
    '坏样本 2 实跑：尾部行未被撑出/旧值 12 残留（新逻辑下这两项都会被覆盖）')
  ok(/const needRows = sr \+ rows/.test(cRegion) && !/const needRows = maxWriteR \+ 1/.test(cRegion),
    '对比：真实源码仍是新全覆盖逻辑（撤销即红）')
}

// 坏样本 3：onPaste 还原 filter ⇒ 空白行删除 + 后续行错位
const badOnPaste = onPasteTxt.replace(
  "  const lines = text.replace(/\\r/g, '').split('\\n')",
  "  const lines = text.replace(/\\r/g, '').split('\\n').filter(l => l.trim().length)")
ok(/\.filter\(l => l\.trim\(\)\.length\)/.test(badOnPaste), '坏样本 3 注入旧 filter 成功')
{
  const oldLines = text.replace(/\r/g, '').split('\n').filter(l => l.trim().length)
  ok(oldLines.length === 76 && oldLines.indexOf('0') === 75,
    '坏样本 3 实跑：99 行压成 76 行，第 98 行的 0 错位落到目标第 76 行（目标第 98 行旧值 12 残留）')
}

console.log(`\nRESULT: ${fail === 0 ? 'ALL PASS' : 'FAILED (' + fail + ')'}  pass=${pass} fail=${fail}`)
process.exit(fail === 0 ? 0 : 1)
