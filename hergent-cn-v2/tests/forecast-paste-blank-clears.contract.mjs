/* ㊱·c v783 契约：粘贴时「空白 / 0」单元格覆盖清空（反转 v379 的「空格一律跳过」）
 * ============================================================
 * 用户报障（2026-11-06）：从 Excel 把某商品的报单数据改成 0 或空白，粘贴进系统时，
 *   若该商品系统里当前值不是 0/空白，则这一格粘贴不进去（系统保留旧值）。
 *
 * 根因：v379 当年刻意让粘贴的「空格」一律不覆盖（防静默清零）。但本表空白语义本就是
 *   「这一期不报」，改单时把某商品清空/改成空白，本意就是「这期清零」，结果被故意跳过，
 *   系统静默留着旧值 —— 用户以为粘上了实际没变（漏订货 / 错订货）。0 本身会写入，
 *   但用户在 Excel 里常用「清空单元格」得到的是真·空白（不是 0），于是被跳过。
 *
 * 修法（反转 v379，Forecast.vue::pasteRegion + tryPasteCross）：
 *   · 空白也覆盖清空 —— qty 列置 0、文本/计算列置空，与 Excel 习惯一致；
 *   · 不再静默：提示里明确报出「清空了几格」（v379 当年真正怕的是静默清零，报出来即非事故）。
 *
 * 🔴🔴 v785 口径反转（用户 2026-11-06 明确要求，覆盖上面 v783 的「尾行不撑行」）：
 *   「从 Excel 复制 N 行（包含空白行）后，粘贴到系统必须完整写入同样的 N 行；空白行与空白
 *    单元格同样占位并参与覆盖，不得被过滤、不得中途截断、不得保留目标位置原有的旧值。」
 *   v783 的「补行只按最后非空行(maxWriteR)算 + clears 越界跳过」正是 99→76 截断与
 *   「第 98 个商品 0 没覆盖旧值 12」的根因 ⇒ 已改为 `needRows = sr + rows`。
 *   🔴 本契约只负责「空白/0 覆盖清空」这一语义；严格 N 行全覆盖的**强护栏**见 ㊱·d
 *     （forecast-paste-strict-n-rows.contract.mjs，抽取真实函数体注入桩实跑）。
 *   ⚠️ 口径变了必须同步反转旧坏样本/旧判据，否则护栏会拿旧标准判错正确修改（v780 教训）。
 *
 * 🔴 护栏要点：
 *   · 静态判据必须三态：① 旧「跳过」模式确实消失（撤销即红）；
 *     ② 新「收集为 clears + 写空」模式确实出现；③ 提示文案从「原值保留」改为「清空 N 个空白格」。
 *   · 动态判据抽取**真实纯函数** parseTSV / pasteCellEmpty 实跑新循环：0 进 writes、空白进 clears、
 *     N 行即 N 行（空白行也占位）。
 *   · 坏样本：把 pasteRegion / tryPasteCross 的新循环还原成旧的「跳过」后，
 *     旧模式重现 + 新模式消失 ⇒ 上面的静态判据必然翻转（撤销即红）。 */

import fs from 'fs'
import path from 'path'
import vm from 'vm'

const vue = fs.readFileSync(path.resolve('src/pages/Forecast.vue'), 'utf-8')
let pass = 0, fail = 0
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✅', label) }
  else { fail++; console.log('  ❌', label) }
}

/* 精准截取单个顶层函数体：到「行首 }」为止。
   ⚠️ 不能用「下一个 \nfunction 」：pasteRegion 后面紧跟的是 onMounted(...) 等非函数语句，
      会把一大段无关代码（含注释）截进来，静态判据容易被注释自撞成空白支票。 */
const fnBody = (sig) => {
  const s = vue.indexOf(sig)
  if (s < 0) return ''
  const rest = vue.slice(s)
  const m = rest.match(/^\}/m)
  return m ? rest.slice(0, m.index + 1) : ''
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const regionTxt = fnBody('function pasteRegion(text)')
const crossTxt = fnBody('function tryPasteCross(block)')
const cRegion = stripComments(regionTxt)
const cCross = stripComments(crossTxt)

console.log('=== 静态判据（pasteRegion：旧跳过消失 + 新覆盖出现 + 提示反转） ===')
ok(!/pasteCellEmpty\(v\)\)\s*\{\s*skipped\+\+;\s*continue/.test(regionTxt),
  'pasteRegion 不再「空白 → skipped++ 跳过」')
ok(/pasteCellEmpty\(v\)\)\s*\{\s*clears\.push/.test(regionTxt),
  'pasteRegion 空白改为 collects 进 clears')
ok(/for \(const k of clears\)\s*\{[\s\S]{0,140}?writeCellVal\(k\.r, k\.c, ''\)/.test(regionTxt),
  'pasteRegion 对 clears 逐格 writeCellVal(…, \'\') 清空')
/* v785 反转：补行按源数据总行数（sr + rows），空白行也占位；
   且旧 maxWriteR 撑行必须确实消失（撤销即红）。 */
ok(/const needRows = sr \+ rows/.test(cRegion),
  'pasteRegion 补行按源数据总行数（sr + rows），空白行也占位')
ok(!/const needRows = maxWriteR \+ 1/.test(cRegion),
  'pasteRegion 不再按「最后非空行」(maxWriteR) 撑行（旧口径已反转）')
ok(/清空 \$\{cleared\} 个空白格/.test(vue), '提示文案改为「清空 N 个空白格」')
ok(!/跳过 \$\{skipped\} 个空格（原值保留）/.test(vue), '旧「跳过 N 个空格（原值保留）」已移除')

console.log('\n=== 静态判据（tryPasteCross 同步反转） ===')
ok(!/pasteCellEmpty\(v\)\)\s*\{\s*blank\+\+;\s*return/.test(crossTxt),
  'tryPasteCross 不再「空白 → blank++ 跳过」')
ok(/const isNew = ri < 0/.test(crossTxt), 'tryPasteCross 区分新/旧商品行（isNew）')
ok(/if \(pasteCellEmpty\(v\)\)\s*\{\s*if \(!isNew\)\s*\{\s*writeCellVal\(ri, c, ''\)/.test(crossTxt),
  'tryPasteCross 旧商品行的空白也 writeCellVal(ri, c, \'\') 清空（新行默认已是 0 不计）')
ok(!/blank \? ` · 跳过 \$\{blank\} 个空格（原值保留）`/.test(vue), 'tryPasteCross 旧空白提示已移除')

console.log('\n=== 动态判据（抽取真实纯函数实跑新循环） ===')
const seg = (vue.match(/function parseTSV\(text\)\s*\{[\s\S]*?\n\}/) || [''])[0]
  + (vue.match(/function pasteCellEmpty\(v\)\s*\{[^}]*\}/) || [''])[0]
const sandbox = {}
vm.createContext(sandbox)
vm.runInContext(seg + '\nthis.parseTSV = parseTSV; this.pasteCellEmpty = pasteCellEmpty;', sandbox)
const { parseTSV, pasteCellEmpty } = sandbox

// 复刻 pasteRegion 的新循环（用真实纯函数）
function simulateNewLoop(blockText) {
  const block = parseTSV(blockText)
  const writes = [], clears = []
  for (let i = 0; i < block.length; i++)
    for (let j = 0; j < block[i].length; j++) {
      const v = block[i][j]
      const R = i, C = j
      if (pasteCellEmpty(v)) { clears.push({ r: R, c: C }); continue }
      writes.push({ r: R, c: C, v })
    }
  /* v785：N 行就是 N 行，不再按最后非空行截断（严格版见 ㊱·d 真实函数体实跑） */
  return { writes, clears, needRows: block.length }
}

const col = ['30', '0', '25', '', '10'].join('\n')   // 一格 0、一格空白，其余有数
const r = simulateNewLoop(col)
ok(r.writes.some(w => w.v === '0'), '复制来的 "0" 进入 writes（会被写入/置 0）')
ok(r.clears.length === 1 && r.clears[0].r === 3, '复制来的空白进入 clears（会被清空，不再静默跳过）')
ok(r.writes.length === 4, '其余 4 个有数值的格进入 writes')
ok(r.needRows === 5, '补行按源数据总行数（5 行），N 行就是 N 行')

// v785 反转：尾行整行空白同样占位并参与覆盖，不得被剥掉
const trailing = ['30', '0', '', ''].join('\n')
const r2 = simulateNewLoop(trailing)
ok(r2.needRows === 4 && r2.clears.length === 2,
  '尾行整行空白同样占位并覆盖清空（needRows=4、清空 2 格；v783 旧标准 2 已反转）')

// v785 反转：整列全空白不再是「空块丢弃」，而是逐格占位覆盖清空，且提示会报数（不静默）
const allBlank = ['', '', ''].join('\n')
const r3 = simulateNewLoop(allBlank)
ok(parseTSV(allBlank).length === 3, '真实 parseTSV 保留全空白的 3 行（不再 pop 剥行）')
ok(r3.writes.length === 0 && r3.clears.length === 3,
  '整列全空白逐格占位覆盖清空（3 格），不再被当作空块静默丢弃')

console.log('\n=== 坏样本自证（撤销修复即红） ===')
const badRegion = regionTxt.replace(
  /if \(pasteCellEmpty\(v\)\) \{ clears\.push\(\{ r: R, c: C \}\); continue \}/,
  'if (pasteCellEmpty(v)) { skipped++; continue }')
ok(/pasteCellEmpty\(v\)\)\s*\{\s*skipped\+\+;\s*continue/.test(badRegion)
   && !/pasteCellEmpty\(v\)\)\s*\{\s*clears\.push/.test(badRegion),
  '坏样本：pasteRegion 还原成「跳过」后，旧模式重现 + 新模式消失（撤销即红）')
const badCross = crossTxt.replace(
  /if \(pasteCellEmpty\(v\)\) \{ if \(!isNew\) \{ writeCellVal\(ri, c, ''\); cleared\+\+ \} return \}/,
  'if (pasteCellEmpty(v)) { blank++; return }')
ok(/pasteCellEmpty\(v\)\)\s*\{\s*blank\+\+;\s*return/.test(badCross)
   && !/if \(pasteCellEmpty\(v\)\)\s*\{\s*if \(!isNew\)/.test(badCross),
  '坏样本：tryPasteCross 还原成「跳过」后，旧模式重现 + 新模式消失（撤销即红）')

console.log(`\nRESULT: ${fail === 0 ? 'ALL PASS' : 'FAILED (' + fail + ')'}  pass=${pass} fail=${fail}`)
process.exit(fail === 0 ? 0 : 1)
