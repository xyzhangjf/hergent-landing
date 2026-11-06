/* ㊱·e　粘贴视觉反馈：**只保留网格主色高亮**（v790）
   ────────────────────────────────────────────────────────────────────────
   需求（2026-11-06 22:00，老张原话）：
     「在本期预报页面粘贴成功后，不需要展示我框出来的这个『区块粘贴』这个区域，
       仅保留网格中粘贴区域的品牌色高亮，让用户视觉上能够看到粘贴了哪些区域即可，
       其它交互逻辑不变。」
   ⇒ v786 的类 Excel 结果面板（标题/行列数/落点文字/表格）**整块删除**；
      `pasteResult` 状态、`setPasteResult()`、`.pr-*` 样式一并删除，不留死代码；
      `clearPasteResult()` 改名 `clearPasteLand()`（现在只清主色框）;
      粘贴的视觉反馈只剩 ① `.paste-land` 主色框 ② 粘贴成功 toast（行数/列数/落点）。
   触发条件 / 成功判定 / 校验 / 保存行为 / 收起时机**均不变**。

   🔴 口径反转记录（别按旧断言改回去）：
      v786「面板常驻」→ v787「按下保存或取消即收起」→ **v790「面板整个不要了」**。
      旧文件 forecast-paste-result-panel.contract.mjs 的 B/C/D 段（测表格结构、
      setPasteResult 实跑 99 行、四条出口写快照）全部作废，已替换为本文件 A 段
      「面板与快照代码必须不存在」的反向判据。

   🔴 本护栏防三种空白支票（本项目铁律）：
      ① 正则抽到空集 ⇒ 每条截取先断言片段非空；
      ② 只查唯一不查存在 ⇒ 「删掉了」必须与「高亮还在」成对判，
         否则把整个粘贴功能删光也能全绿；
      ③ 只写上限 ⇒ 每条关键判据都配坏样本（撤销修复即红）+ 真实源码对照组全绿。
   静态判据一律剥注释（含 HTML 注释）—— 注释里逐字抄旧代码/旧函数名会自撞假红。 */

import fs from 'node:fs'
import vm from 'node:vm'

const vue = fs.readFileSync(new URL('../src/pages/Forecast.vue', import.meta.url), 'utf8')
/* 高亮类真正画在格子上是在行组件里（ctx.pasteLandCls），不在页面模板里 ——
   跨文件判据必须一起读，否则「页面里把类删了但行组件还在画」这种半拉状态测不出来。 */
const row = fs.readFileSync(new URL('../src/components/forecast/ForecastRow.vue', import.meta.url), 'utf8')
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

/* ══════════════ A. 结果面板与快照代码：必须整体消失 ══════════════ */
console.log('\nA. 「区块粘贴」结果面板已整块删除（含状态/函数/样式，不留死代码）')
ok(vue.length > 10000 && vueCode.length > 10000,
  '源码读取成功且剥注释后仍是大文件（防「正则抽空集」假绿）')
ok(!/paste-result-panel/.test(vueCode), '模板里不再有 .paste-result-panel 容器')
ok(!/pasteResult/.test(vueCode), '`pasteResult` 状态已删除（不是只把模板 v-if 关掉）')
ok(!/setPasteResult\s*\(/.test(vueCode), '`setPasteResult()` 函数与全部调用点已删除')
ok(!/pr-tbl|pr-blank|pr-wrap|pr-seq|pr-span|pr-hint/.test(vueCode),
  '面板专属样式类（.pr-*）全部清除，未留死 CSS')
ok(!/inPasteLand/.test(vueCode), '顺带清掉的死函数 inPasteLand 不再存在（原来只有定义、零调用）')
ok(!/label:\s*'区块粘贴'/.test(vueCode) && !/\{\{\s*pasteResult\.label\s*\}\}/.test(vueCode),
  '「区块粘贴」标题不再渲染（面板标题与快照 label 双路都断）')
ok(!/<table class="pr-tbl">/.test(vueCode), '不再用表格展示粘贴结果')
/* 坏样本：把面板塞回模板 ⇒ 必须有判据翻红。 */
const badPanel = vueCode.replace('<div v-if="editMode && errListOpen"',
  '<div class="info-panel paste-result-panel"><table class="pr-tbl"></table></div>\n          <div v-if="editMode && errListOpen"')
ok(/paste-result-panel/.test(badPanel) && !/paste-result-panel/.test(vueCode),
  '坏样本（把结果面板塞回模板）能被判否 ⇒ 撤销修复即红')

/* 同时确认「不展示面板」没有顺手把相邻面板删掉（误伤自检）。 */
ok(/class="info-panel err-panel"/.test(vueCode), '相邻的「查错」面板仍在（删除未误伤兄弟节点）')
ok(/class="info-panel paste-fit-panel"|class="info-panel/.test(vueCode), '编辑态其它 info-panel 仍在')

/* ══════════════ B. 主色框：仍是唯一视觉锚点，且不自动收起 ══════════════ */
console.log('\nB. 主色框（pasteLand）成为唯一视觉反馈，仍不自动收起')
const markTxt = stripComments(fnBody('function markPasteLand (r0, c0, r1, c1)'))
ok(markTxt.length > 20, 'markPasteLand 函数体截取非空（防「正则抽空集」假绿）')
ok(/const pasteLand = ref\(/.test(vueCode), 'pasteLand 状态仍在')
ok(!/setTimeout/.test(markTxt), 'markPasteLand 内不起 setTimeout 自动清除高亮')
ok(!/PASTE_LAND_MS|_pasteLandTimer/.test(vueCode), '2.6s 定时器常量与句柄未回收（已整体移除）')
ok(/nextTick\(\(\) =>/.test(markTxt) && /pasteLand\.value = \{ r0, c0, r1, c1/.test(markTxt),
  '高亮仍会置位（不是把功能删了冒充「只留高亮」）')
ok(/pasteLand, pasteLandCls,/.test(vueCode),
  'pasteLandCls 仍通过 rowCtx 下发给行组件（页面侧接线未断）')
ok(count(row, /ctx\.pasteLandCls\(/g) === 2,
  '行组件两个渲染位（普通列 td + 数量列 qty-cell）都还在调 pasteLandCls，实测 '
  + count(row, /ctx\.pasteLandCls\(/g) + ' 处')
ok(/ctx\.pasteLandCls\(ri, ctx\.visibleCols\.length \+ ui\)/.test(row),
  '低温奶数量列（报单主战场）同样上高亮，不是只有普通列亮')
const badMark = markTxt.replace('function markPasteLand (r0, c0, r1, c1) {',
  'function markPasteLand (r0, c0, r1, c1) {\n  setTimeout(() => { pasteLand.value = { r0: -1 } }, 2600)')
ok(/setTimeout/.test(badMark) && !/setTimeout/.test(markTxt),
  '坏样本（还原 2.6s 定时器）能被判否 ⇒ 撤销修复即红')

/* ══════════════ C. pasteLandCls 真实函数体实跑：边界 / 内部 / 外部 / 已清 ══════════════ */
console.log('\nC. pasteLandCls 实跑：内部淡底 / 四边描边 / 框外无色 / 清空后全无色')
const clsTxt = fnBody('function pasteLandCls (r, c)')
ok(clsTxt.length > 50, 'pasteLandCls 函数体截取非空（防「正则抽空集」假绿）')
function runCls (code, land) {
  const sb = { pasteLand: { value: land } }
  vm.createContext(sb)
  vm.runInContext(code + '\nthis.__cls = pasteLandCls;', sb)
  return sb.__cls
}
const land = { r0: 2, c0: 3, r1: 5, c1: 6, k: 1 }   // 4 行 × 4 列的一片
const cls = runCls(clsTxt, land)
ok(cls(3, 4) === 'paste-land', '内部格只有淡底（不逐格描边，8×5 以上才不会糊成一片）')
ok(cls(2, 4) === 'paste-land edge' && cls(5, 4) === 'paste-land edge',
  '上下边界格带 edge 描边')
ok(cls(3, 3) === 'paste-land edge' && cls(3, 6) === 'paste-land edge',
  '左右边界格带 edge 描边（整片看起来是一个框）')
ok(cls(2, 3) === 'paste-land edge' && cls(5, 6) === 'paste-land edge',
  '四个角同样是边界格（不漏角）')
ok(cls(1, 4) === '' && cls(6, 4) === '' && cls(3, 2) === '' && cls(3, 7) === '',
  '框外（上下左右各差一行/列）一律无色，不多亮一格')
const clsCleared = runCls(clsTxt, { r0: -1, c0: -1, r1: -1, c1: -1, k: 2 })
ok(clsCleared(2, 3) === '' && clsCleared(0, 0) === '',
  '清空后（r0=-1）整表无色（保存/取消后不会再亮）')
const badCls = clsTxt.replace(
  "return (r === p.r0 || r === p.r1 || c === p.c0 || c === p.c1) ? 'paste-land edge' : 'paste-land'",
  "return 'paste-land edge'")
ok(runCls(badCls, land)(3, 4) === 'paste-land edge' && cls(3, 4) === 'paste-land',
  '坏样本（内部格也描边）能被判否 ⇒ 撤销修复即红')

/* ══════════════ D. 三件套：扩渲染 → 标落点 → 滚到眼前（缺一即静默） ══════════════ */
console.log('\nD. 区块粘贴三件套齐全且顺序不变（删了面板后这是唯一反馈链）')
ok(regionSeg.length > 100, 'pasteRegion 函数体截取非空（防「正则抽空集」假绿）')
ok(/ensureRowsRendered\(_rEnd\)/.test(regionSeg) && /markPasteLand\(sr, sc, _rEnd, _cEnd\)/.test(regionSeg)
  && /scrollRowIntoView\(sr\)/.test(regionSeg),
  '扩渲染 / 标落点 / 滚到眼前 三件事都在（成对判存在性，防「删功能冒充精简」）')
ok(/ensureRowsRendered\(_rEnd\)\s*\n\s*markPasteLand\(sr, sc, _rEnd, _cEnd\)\s*\n\s*scrollRowIntoView\(sr\)/.test(regionSeg),
  '顺序严格是「先扩渲染 → 再标 → 最后滚」（先滚会滚个空，落点 td 还没挂载）')
ok(!/setPasteResult|pasteResult/.test(regionSeg), '主路径里不再穿插结果快照调用（面板已删）')
const badRegion = regionSeg.replace(/\s*markPasteLand\(sr, sc, _rEnd, _cEnd\)/, '')
ok(/markPasteLand\(sr, sc, _rEnd, _cEnd\)/.test(regionSeg)
  && !/markPasteLand\(sr, sc, _rEnd, _cEnd\)/.test(badRegion),
  '坏样本（删掉标落点）能被判否 ⇒ 撤销修复即红')

/* ══════════════ E. 收起时机：clearPasteLand 恰好 2 处（按下保存 / 取消） ══════════════ */
console.log('\nE. 收起时机（v787 口径不变，仅改名 clearPasteResult → clearPasteLand）')
const clearTxt = stripComments(fnBody('function clearPasteLand ()'))
const leaveTxt = stripComments(fnBody('function leaveEdit()'))
const saveTxt = stripComments(fnBody('async function saveEdits(opts = {})'))
ok(clearTxt.length > 20 && leaveTxt.length > 20 && saveTxt.length > 1000,
  'clearPasteLand / leaveEdit / saveEdits 片段截取非空（防「正则抽空集」假绿）')
ok(count(vueCode, /clearPasteLand\(\)/g) === 2,
  '全文恰好 2 处调用：saveEdits 开头 + leaveEdit（口径只写一处，不多不少），实测 '
  + count(vueCode, /clearPasteLand\(\)/g) + ' 处')
ok(!/clearPasteResult/.test(vueCode), '旧名 clearPasteResult 已无残留调用（改名改干净）')
ok(/function exitEditAfterSave\(\) \{ leaveEdit\(\) \}/.test(vueCode),
  '保存成功出口只调 leaveEdit（不出现第三处清理口径）')
ok(/function leaveEdit\(\) \{\s*\n\s*clearPasteLand\(\)/.test(leaveTxt),
  '「取消改单」走 leaveEdit() ⇒ 主色框收起')
const clearIdx = saveTxt.indexOf('clearPasteLand()')
const firstReturnIdx = saveTxt.indexOf('return')
ok(clearIdx > 0 && clearIdx < firstReturnIdx,
  'saveEdits 里 clearPasteLand() 在第一个 return 之前 ⇒ 按下保存即清，不依赖保存成功')
/* 函数体的 `{` 要用 `) {` 定位：`indexOf('{')` 会先命中默认参数 `opts = {}` 的花括号。 */
const saveBodyOpen = saveTxt.indexOf(') {') + 2
ok(saveBodyOpen > 1 && saveTxt.slice(saveBodyOpen + 1, clearIdx).trim() === '',
  'clearPasteLand() 是 saveEdits 函数体第一条可执行语句（所有提前 return 的守卫同样会清）')
ok(/pasteLand\.value = \{ r0: -1/.test(clearTxt) && !/pasteResult/.test(clearTxt),
  '收起只做主色框一件事（结果状态已不存在，不残留半套清理）')

/* 真实函数体实跑：造「已粘贴」状态 → 分别走「按下保存」与「取消」，断言框都没了。 */
const saveHeadTxt = saveTxt.replace(/^async function saveEdits/, 'function saveEdits')
  .slice(0, clearIdx + 'clearPasteLand()'.length) + '\n  return\n}'
function lifecycle (head = saveHeadTxt, leave = leaveTxt) {
  const sb = {
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
  ok(s.pasteLand.value.r0 === 0, '前置状态确实处于「已粘贴」（主色框亮着）')
  s.__save()
  ok(s.pasteLand.value.r0 === -1, '实跑：按下「保存」的瞬间（不等回执）主色框就没了')
}
{
  const s = lifecycle()
  s.__leave()
  ok(s.pasteLand.value.r0 === -1 && s.editMode.value === false,
    '实跑：点「取消改单」走 leaveEdit() 也收起，且照常退出编辑态')
  s.editMode.value = true
  ok(s.pasteLand.value.r0 === -1, '取消后再进编辑态不会重现上次的主色框')
}
{
  const badHead = saveHeadTxt.replace('clearPasteLand()', '')
  const s = lifecycle(badHead)
  s.__save()
  ok(s.pasteLand.value.r0 === 0 && saveHeadTxt.includes('clearPasteLand()'),
    '坏样本实跑：撤掉 saveEdits 里的 clear ⇒ 按下保存框还亮着（撤销即红）')
}
{
  const badLeave = leaveTxt.replace('clearPasteLand()', '')
  const s = lifecycle(saveHeadTxt, badLeave)
  s.__leave()
  ok(s.pasteLand.value.r0 === 0 && leaveTxt.includes('clearPasteLand()'),
    '坏样本实跑：撤掉 leaveEdit 里的 clear ⇒ 取消后框还亮着（撤销即红）')
}

/* ══════════════ F. toast 仍是文字反馈（面板没了，这条不能跟着丢） ══════════════ */
console.log('\nF. 粘贴成功 toast 保留：行数 / 列数 / 落点（唯一文字确认）')
ok(/toast\(`已粘贴 \$\{rows\} 行 × \$\{useCols\} 列/.test(regionSeg),
  '主路径 toast 仍报「已粘贴 N 行 × M 列」（行数列数是核对粘贴是否完整的唯一凭据）')
ok(/落点 \$\{_span\}/.test(regionSeg),
  'toast 仍报落点（商品名 + 客户列名，人话坐标）')
ok(/已用主色框标出/.test(regionSeg),
  'toast 文案仍指向主色框（与「只留高亮」的新实现一致，不误导用户去找面板）')
ok(/逐行全覆盖/.test(regionSeg),
  'toast 仍标注「逐行全覆盖」（v785 严格 N 行口径的可见凭据）')

/* ══════════════ G. 样式：高亮动画保留，面板样式清零 ══════════════ */
console.log('\nG. 样式：.paste-land 动画保留，.pr-* 清零')
ok(/:deep\(td\.paste-land\)/.test(vueCode) && /@keyframes pasteLandPulse/.test(vueCode),
  '既有 .paste-land 高亮样式与脉冲动画原样保留（未顺手改掉）')
ok(!/\.pr-wrap\{/.test(vueCode) && !/\.pr-tbl/.test(vueCode) && !/\.pr-span\{/.test(vueCode),
  '面板样式规则（含 sticky 表头/行号列/空白格淡底）全部删除')

console.log(`\nRESULT: ${fail ? 'FAILED (' + fail + ')' : 'ALL PASS'}  pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
