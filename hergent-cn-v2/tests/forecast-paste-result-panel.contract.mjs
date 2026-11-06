/* ㊱·e　粘贴结果常驻展示（v786）+ 收起时机（v787）
   ────────────────────────────────────────────────────────────────────────
   需求（2026-11-06）：粘完不再只有「2.6s 后自动消失的主色框 + 自动消失的 toast」，
   改为「类 Excel 表格持续展示已粘贴结果，保留行列结构与数据」；保存前结果展示与主色框
   都不得自动收起。触发条件 / 成功判定 / 校验 / 保存行为不变。
   🔴 v787 口径反转（用户拍板「1.按下按钮即消失；2.取消也一起收起」）：
      v786 曾把 clearPasteResult() 挂在「保存成功」出口、且刻意不放 leaveEdit()；
      现在前移到 `saveEdits()` 开头（按下即清，不等成功）+ `leaveEdit()`（取消也清）。
      本护栏 E 段按新口径重写，旧断言「全文 1 处调用 / 取消不清」已作废，别改回去。

   🔴 本护栏防三种空白支票（本项目铁律）：
      ① 正则抽到空集 ⇒ 每条截取先断言片段非空；
      ② 只查唯一不查存在 ⇒ 高亮「不再定时清除」与「仍会置位」成对判；
      ③ 只写上限 ⇒ 每条关键判据都配坏样本（撤销修复即红）+ 真实源码对照组全绿。
   动态判据抽取**真实 setPasteResult 函数体**注入 vm 实跑 99 行（含 23 空白行、第 98 行 0）。
   静态判据一律剥注释（含 HTML 注释）——注释里逐字抄旧代码会自撞假红，v785 已踩过。 */

import fs from 'node:fs'
import vm from 'node:vm'

const vue = fs.readFileSync(new URL('../src/pages/Forecast.vue', import.meta.url), 'utf8')
let pass = 0, fail = 0
function ok (cond, msg, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + msg + (extra ? ' ' + extra : '')) }
  else { fail++; console.log('  ❌ ' + msg + (extra ? ' ' + extra : '')) }
}
const count = (s, re) => (s.match(re) || []).length
const stripComments = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
const vueCode = stripComments(vue)
/* 截到第一个「行首顶格 }」：函数体内的对象字面量右括号都是缩进的，不会提前截断。
   v785 首跑曾用「下一个 \nfunction 」截取，把 onMounted 一起截进 vm 直接崩掉。 */
const fnBody = (sig) => {
  const s = vue.indexOf(sig)
  if (s < 0) return ''
  const rest = vue.slice(s)
  const m = rest.match(/^\}/m)
  return m ? rest.slice(0, m.index + 1) : ''
}
const regionSeg = (vue.match(/function pasteRegion\(text\)[\s\S]*?\n\}/) || [''])[0]
const crossSeg = (vue.match(/function tryPasteCross\(block\)[\s\S]*?\n\}/) || [''])[0]
const onPasteSeg = (vue.match(/function onPaste\(e\)[\s\S]*?\n\}/) || [''])[0]

/* ══════════════ A. 主色框：不再自动收起 ══════════════ */
console.log('\nA. 主色框生命周期（撤掉定时器，仍正常置位）')
const markTxt = stripComments(fnBody('function markPasteLand (r0, c0, r1, c1)'))
ok(markTxt.length > 20, 'markPasteLand 函数体截取非空（防「正则抽空集」假绿）')
ok(!/setTimeout/.test(markTxt), 'markPasteLand 内不再起 setTimeout 自动清除高亮')
ok(!/PASTE_LAND_MS|_pasteLandTimer/.test(vueCode), '2.6s 定时器常量与句柄已从源码整体移除')
ok(/nextTick\(\(\) =>/.test(markTxt) && /pasteLand\.value = \{ r0, c0, r1, c1/.test(markTxt),
  '高亮仍会置位（不是把功能删了冒充「不自动收起」）')
const badMark = markTxt.replace('function markPasteLand (r0, c0, r1, c1) {',
  'function markPasteLand (r0, c0, r1, c1) {\n  setTimeout(() => { pasteLand.value = { r0: -1 } }, 2600)')
ok(/setTimeout/.test(badMark) && !/setTimeout/.test(markTxt),
  '坏样本（还原 2.6s 定时器）能被判否 ⇒ 撤销修复即红')

/* ══════════════ B. 类 Excel 结果面板 ══════════════ */
console.log('\nB. 结果面板：行列结构 + 数据 + 空白格占位')
/* 必须从 <div v-if=...> 起截：若从 class= 起截，v-if 在同一行前半段会被截掉 ⇒ 判据假红。 */
const ps = vue.indexOf('<div v-if="editMode && pasteResult"')
const pe = vue.indexOf('<!-- v174：查错结果面板', ps)
const panelTxt = ps >= 0 && pe > ps ? vue.slice(ps, pe) : ''
const panelCode = stripComments(panelTxt)
ok(panelTxt.length > 100, '结果面板模板片段截取非空（防「正则抽空集」假绿）')
ok(/v-if="editMode && pasteResult"/.test(panelCode), '面板由 pasteResult 驱动，且只在编辑态展示')
ok(/<table class="pr-tbl">/.test(panelCode), '以真实 <table> 渲染（类 Excel 表格，不是列表/toast）')
ok(/v-for="\(h, j\) in pasteResult\.heads"/.test(panelCode), '列标题逐列渲染，保留列结构')
ok(/v-for="\(r, i\) in pasteResult\.cells"/.test(panelCode) && /\{\{ i \+ 1 \}\}/.test(panelCode),
  '数据逐行渲染 + Excel 式行号（空白行也占一行）')
ok(/'pr-blank': v === ''/.test(panelCode) && /\{\{ v \}\}/.test(panelCode),
  '空白格原样占位（淡底标记），数值格显示实际值')
ok(!/imp-x|@click="[^"]*pasteResult\s*=\s*null/.test(panelTxt),
  '面板没有手动关闭按钮 ⇒ 保存前不会收起/隐藏/清除')
ok(/保存前持续展示/.test(panelCode) && /「取消」/.test(panelCode),
  '面板明确告知「保存前持续展示 · 点保存或取消即收起」（与 v787 代码口径一致）')
ok(/\{\{ pasteResult\.rows \}\} 行 × \{\{ pasteResult\.cols \}\} 列/.test(panelCode),
  '表头回执行列数（中文单位，不用英文缩写）')

/* ══════════════ C. 真实快照函数实跑 99 行 ══════════════ */
console.log('\nC. setPasteResult 实跑：99 行 / 23 空白行 / 第 98 行 0')
const setTxt = fnBody('function setPasteResult (block, meta = {})')
ok(setTxt.length > 100, 'setPasteResult 函数体截取非空（防「正则抽空集」假绿）')
const N = 99
const BLANK = new Set([10, 11, 12, 20, 21, 30, 31, 32, 40, 50, 60, 61, 70, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86])
const src = []
for (let i = 1; i <= N; i++) {
  if (BLANK.has(i)) src.push('')
  else if (i === 98) src.push('0')
  else src.push(String(i * 2))
}
const block = src.map(s => [s])
function runSet (code, b, meta) {
  const sb = { pasteResult: { value: null }, pasteColName: (c) => '客户列' + (c + 1) }
  vm.createContext(sb)
  vm.runInContext(code + '\nthis.__set = setPasteResult;', sb)
  sb.__set(b, meta)
  return sb.pasteResult.value
}
const R = runSet(setTxt, block, { useCols: 1, sc: 0, span: '落点A→B', label: '区块粘贴' })
ok(!!R, '真实函数产出快照对象（不是恒空）')
ok(R.rows === N && R.cells.length === N,
  `源 ${N} 行 ⇒ 面板 ${N} 行，空白行一行不删（实际 ${R && R.rows}）`)
ok(R.cols === 1 && R.heads.length === 1 && R.heads[0] === '客户列1',
  '列结构保留：列标题用目标客户列名（可核对「贴到哪一列」）')
ok(R.cells[97][0] === '0', '第 98 个商品的 0 原样展示（不被当空值吞掉）')
ok(R.cells[9][0] === '', '中间空白行保留为整行空白格（占位并参与覆盖）')
/* 99 行样例第 99 行是 198（与 99→76 报障样例一致），单独用「尾部连续空白」样例钉死尾行。 */
const tailBlock = [['2'], ['0'], [''], ['']]
const tailR = runSet(setTxt, tailBlock, { useCols: 1, sc: 0 })
ok(tailR.rows === 4 && tailR.cells[2][0] === '' && tailR.cells[3][0] === '',
  '尾部连续空白行同样占位保留（Excel 末行空白是真实第 N 行，不剥不截）')
ok(R.cells[0][0] === '2' && R.cells[1][0] === '4',
  '顺序一致：第 1/2 行仍是源数据第 1/2 行，未上移错位')
ok(R.label === '区块粘贴' && R.span === '落点A→B', '快照带上路径标签与落点说明')
/* 坏样本：把「原样 slice」还原成旧版「filter 删空白行」⇒ 99→76、第 98 行错位。 */
const badSetTxt = setTxt.replace(
  'const src = (Array.isArray(block) ? block : []).slice(meta.startRow || 0)',
  "const src = (Array.isArray(block) ? block : []).filter(r => (r || []).some(c => String(c == null ? '' : c).trim()))")
ok(/\.slice\(meta\.startRow \|\| 0\)/.test(setTxt) && !/\.slice\(meta\.startRow \|\| 0\)/.test(badSetTxt),
  '坏样本注入「旧 filter 删空白行」成功（静态判据翻转）')
const badR = runSet(badSetTxt, block, { useCols: 1, sc: 0 })
ok(badR.rows === 76 && R.rows === 99,
  '坏样本实跑 99→76 且真实源码保持 99 ⇒ 撤销修复即红（对照组全绿）')
ok(badR.cells[97] === undefined || badR.cells[97][0] !== '0',
  '坏样本里第 98 行的 0 因删空白行错位／丢失（正是本轮要防的旧病）')
const badTail = runSet(badSetTxt, tailBlock, { useCols: 1, sc: 0 })
ok(badTail.rows === 2 && tailR.rows === 4,
  '坏样本实跑：尾部空白行被旧 filter 整段删掉，真实源码保留（对照组）')

/* ══════════════ D. 四条「粘贴成功」出口都接上快照 ══════════════ */
console.log('\nD. 既有粘贴成功出口接入（不改触发条件 / 成功判定）')
ok(regionSeg.length > 100 && /setPasteResult\(block, \{ useCols, sc, span: _span/.test(regionSeg),
  '区块粘贴 pasteRegion 成功后写快照（主路径，99 行报障走这条）')
ok(/setPasteResult\(block, \{ useCols, sc, label: '单值铺满选区' \}\)/.test(regionSeg),
  '1×1 单值铺满选区分支同样写快照')
ok(crossSeg.length > 100 && /setPasteResult\(dataRows, \{ heads: head/.test(crossSeg),
  '按客户列粘贴 tryPasteCross 成功后写快照（用源表头作列标题）')
ok(onPasteSeg.length > 100 && /setPasteResult\(lines\.map\(/.test(onPasteSeg),
  '商品主档粘贴成功后写快照')
ok(/ensureRowsRendered\(_rEnd\)\s*\n\s*markPasteLand\(sr, sc, _rEnd, _cEnd\)\s*\n\s*scrollRowIntoView\(sr\)\s*\n\s*setPasteResult\(/.test(regionSeg),
  '快照写在既有「扩渲染→标落点→滚到眼前」三件套之后，未打乱顺序')
const badRegion = regionSeg.replace(/setPasteResult\(block, \{ useCols, sc, span: _span[^\n]*\n/, '')
ok(/setPasteResult\(block, \{ useCols, sc, span: _span/.test(regionSeg)
  && !/setPasteResult\(block, \{ useCols, sc, span: _span/.test(badRegion),
  '坏样本（删掉主路径快照调用）能被判否 ⇒ 撤销修复即红')

/* ══════════════ E. 收起时机：按下保存即清 + 取消也清（v787） ══════════════ */
console.log('\nE. 收起时机（v787）：按下「保存」即清，「取消」也一起收起')
const clearTxt = stripComments(fnBody('function clearPasteResult ()'))
const leaveTxt = stripComments(fnBody('function leaveEdit()'))
const saveTxt = stripComments(fnBody('async function saveEdits(opts = {})'))
ok(clearTxt.length > 20 && leaveTxt.length > 20 && saveTxt.length > 1000,
  'clearPasteResult / leaveEdit / saveEdits 片段截取非空（防「正则抽空集」假绿）')
ok(count(vueCode, /clearPasteResult\(\)/g) === 2,
  '全文恰好 2 处调用：saveEdits 开头 + leaveEdit（口径只写一处，不多不少），实测 '
  + count(vueCode, /clearPasteResult\(\)/g) + ' 处')
ok(/function exitEditAfterSave\(\) \{ leaveEdit\(\) \}/.test(vueCode),
  '保存成功出口不再直接清（收起已前移，不出现第三处口径）')
ok(/function leaveEdit\(\) \{\s*\n\s*clearPasteResult\(\)/.test(leaveTxt),
  '「取消改单」走 leaveEdit() ⇒ 结果与主色框一并收起')
const clearIdx = saveTxt.indexOf('clearPasteResult()')
const firstReturnIdx = saveTxt.indexOf('return')
ok(clearIdx > 0 && clearIdx < firstReturnIdx,
  'saveEdits 里 clearPasteResult() 在第一个 return 之前 ⇒ 按下保存即清，不依赖保存成功')
/* 函数体的 `{` 要用 `) {` 定位：`indexOf('{')` 会先命中默认参数 `opts = {}` 的花括号。 */
const saveBodyOpen = saveTxt.indexOf(') {') + 2
ok(saveBodyOpen > 1 && saveTxt.slice(saveBodyOpen + 1, clearIdx).trim() === '',
  'clearPasteResult() 是 saveEdits 函数体第一条可执行语句（所有提前 return 的守卫同样会清）')
ok(/pasteResult\.value = null/.test(clearTxt) && /pasteLand\.value = \{ r0: -1/.test(clearTxt),
  '收起时同时结束结果展示状态与清空主色框（同步，不是只关一个）')

/* 真实函数体实跑：造出「已粘贴」状态 → 分别走「按下保存」与「取消」，断言两者都被清。
   saveEdits 只截到 clear 调用为止并补 return（后面几万字符全是保存业务，与本判据无关，
   注入 vm 会崩）—— 保留的是**真实签名 + 真实第一条语句**，不是仿写一份。 */
const saveHeadTxt = saveTxt.replace(/^async function saveEdits/, 'function saveEdits')
  .slice(0, clearIdx + 'clearPasteResult()'.length) + '\n  return\n}'
function lifecycle (head = saveHeadTxt, leave = leaveTxt) {
  const sb = {
    pasteResult: { value: { rows: 99, cols: 1, cells: [['2']], heads: ['客户列1'], label: '区块粘贴', span: '' } },
    pasteLand: { value: { r0: 0, c0: 0, r1: 98, c1: 0, k: 1 } },
    editMode: { value: true }, loadingEdit: { value: false }, errListOpen: { value: true },
    clearCopyMark: () => {}, loadCross: () => {},
  }
  vm.createContext(sb)
  vm.runInContext(clearTxt + '\n' + leave + '\n' + head + '\n'
    + 'this.__save = saveEdits; this.__leave = leaveEdit;', sb)
  return sb
}
{
  const s = lifecycle()
  ok(s.pasteResult.value !== null && s.pasteLand.value.r0 === 0,
    '前置状态确实处于「已粘贴」（主色框亮、结果表在）')
  s.__save()
  ok(s.pasteResult.value === null && s.pasteLand.value.r0 === -1,
    '实跑：按下「保存」的瞬间（不等成功/失败回执）结果与主色框就都没了')
}
{
  const s = lifecycle()
  s.__leave()
  ok(s.pasteResult.value === null && s.pasteLand.value.r0 === -1 && s.editMode.value === false,
    '实跑：点「取消改单」走 leaveEdit() 也一起收起，且照常退出编辑态')
  s.editMode.value = true
  ok(s.pasteResult.value === null,
    '取消后再进编辑态不会重现上一次结果表（v786 已知限制已修）')
}
/* 坏样本自证：分别撤掉两处 clear，动态判据必须翻红；还原 v786 旧口径，静态判据必须翻红。 */
{
  const badHead = saveHeadTxt.replace('clearPasteResult()', '')
  const s = lifecycle(badHead)
  s.__save()
  ok(s.pasteResult.value !== null && saveHeadTxt.includes('clearPasteResult()'),
    '坏样本实跑：撤掉 saveEdits 里的 clear ⇒ 按下保存结果仍在（撤销即红）')
}
{
  const badLeave = leaveTxt.replace('clearPasteResult()', '')
  const s = lifecycle(saveHeadTxt, badLeave)
  s.__leave()
  ok(s.pasteResult.value !== null && leaveTxt.includes('clearPasteResult()'),
    '坏样本实跑：撤掉 leaveEdit 里的 clear ⇒ 取消后结果重现（撤销即红）')
}
{
  const badCaliber = vueCode.replace('function exitEditAfterSave() { leaveEdit() }',
    'function exitEditAfterSave() { clearPasteResult(); leaveEdit() }')
  ok(!/function exitEditAfterSave\(\) \{ leaveEdit\(\) \}/.test(badCaliber)
    && /function exitEditAfterSave\(\) \{ leaveEdit\(\) \}/.test(vueCode),
  '坏样本（还原 v786「仅保存成功后清」）能被判否')
}
const badClear = clearTxt.replace(/pasteLand\.value = \{ r0: -1[^\n]*\n/, '')
ok(/pasteLand\.value = \{ r0: -1/.test(clearTxt) && !/pasteLand\.value = \{ r0: -1/.test(badClear),
  '坏样本（只关结果、不关主色框）能被判否')

/* ══════════════ F. 样式自包含 ══════════════ */
console.log('\nF. 样式：只新增本面板规则')
ok(/\.pr-wrap\{max-height:[^}]*overflow:auto/.test(vueCode), '长表内置滚动（99 行不把页面撑爆）')
ok(/\.pr-tbl thead th\{position:sticky/.test(vueCode) && /\.pr-tbl \.pr-seq\{position:sticky/.test(vueCode),
  '表头与行号列 sticky，滚到第 98 行仍看得见「这是第几行哪一列」')
ok(/\.pr-tbl td\.pr-blank\{/.test(vueCode), '空白格有独立淡底样式，视觉上确实占位')
ok(/:deep\(td\.paste-land\)/.test(vueCode) && /@keyframes pasteLandPulse/.test(vueCode),
  '既有 .paste-land 高亮样式与动画原样保留（未顺手改掉）')

console.log(`\nRESULT: ${fail ? 'FAILED (' + fail + ')' : 'ALL PASS'}  pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
