#!/usr/bin/env node
/* v208 保存后退出编辑态 —— 离线护栏（结构 + 行为双证）。
 *
 * 🔴 铁律同 v207：**切片真实源码 exec，不做复刻**。
 *    从 Forecast.vue 按函数名抠出真实现（brace matching）放进沙箱跑；
 *    另对 saveEdits 做**顺序断言**（因为它依赖太多、无法整体 exec）。
 *
 * 用户拍板（原话）：
 *   「点击『保存』后，页面应回到带有『改单』按钮的状态，此行为与关闭期次无关……
 *     可继续点击『改单』，改完再次点击『保存』，支持反复修改，
 *     且每次修改都需记录并体现在修改日志中。」
 *
 * 三条不变量：
 *   ① 保存成功 ⇒ 退出编辑态（进入 leaveEdit 收口），且**不弹**「放弃本次编辑」确认；
 *   ② 保存成功 ⇒ 「记痕」发生在退出**之前**（否则刚退出就看日志会漏这条）；
 *   ③ 保存失败 ⇒ **停在编辑态**（数据不丢），不调用退出。
 *
 * 用法：node .workbuddy/tools/v208-save-exit-verify.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const SRC = path.join(ROOT, 'hergent-cn-v2/src/pages/Forecast.vue')
const src = fs.readFileSync(SRC, 'utf8')

/* 剥注释后再做**文本/顺序**断言 —— 这是本脚本第一版就踩过的坑：
   本文件里那些「说明为什么要这么改」的注释，自己会引号引到 `await loadEditGrid()` /
   `exitEditAfterSave()` 这些字样，直接拿原文做正则与 indexOf ⇒ 注释把断言带偏
   （实测：D5 报「仍有 await loadEditGrid()」、D1/D2 取到的是注释里的那处）。
   注意保留 URL 里的 `//`（`[^:]` 前缀），别把 `https://` 腰斩。 */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}
const clean = stripComments(src)

/* ---------- 1. 抠函数（brace matching，同 v207 范式） ---------- */
function sliceFn(needle) {
  const i = clean.indexOf(needle)
  if (i < 0) throw new Error('源码里找不到：' + needle)
  const b = clean.indexOf('{', i)
  const nl = clean.indexOf('\n', i)
  if (b < 0 || (nl >= 0 && nl < b)) return clean.slice(i, nl < 0 ? clean.length : nl).trim()
  let d = 0
  for (let j = b; j < clean.length; j++) {
    const ch = clean[j]
    if (ch === '{') d++
    else if (ch === '}') { d--; if (d === 0) return clean.slice(i, j + 1) }
  }
  throw new Error('花括号不配平：' + needle)
}

const leaveEditSrc = sliceFn('function leaveEdit()')
const exitEditSrc = sliceFn('function exitEdit()')
const afterSaveSrc = sliceFn('function exitEditAfterSave()')
const saveEditsSrc = sliceFn('async function saveEdits()')

/* 反证「确实是从源码抠的」—— 若源码回退成旧实现，这里立刻炸 */
if (!/editMode\.value = false/.test(leaveEditSrc)) throw new Error('leaveEdit 里没有退出编辑态')
if (!/window\.confirm/.test(exitEditSrc)) throw new Error('exitEdit 里没有二次确认（源码可能已改）')
if (/window\.confirm/.test(afterSaveSrc)) throw new Error('exitEditAfterSave 里竟有 confirm —— 这正是要防的坑')

/* ---------- 2. 行为断言：把三个函数放进沙箱跑 ---------- */
let pass = 0, fail = 0
const fails = []
function eq(label, got, want) {
  const ok = String(got) === String(want)
  if (ok) { pass++; console.log('  ✅ ' + label) }
  else { fail++; fails.push(label); console.log('  ❌ ' + label + '  期望=' + want + ' 实际=' + got) }
}
function ok(label, cond) { eq(label, !!cond, true) }

const refStub = (v) => ({ value: v })

/* 每个用例造一套全新环境（避免串味） */
function makeEnv(dirty, confirmAnswer) {
  const calls = { loadCross: 0, confirm: 0 }
  const env = {
    ref: refStub,
    editMode: refStub(true),
    loadingEdit: refStub(true),
    errListOpen: refStub(true),
    pagingOn: refStub(true),
    dirtySinceSave: refStub(dirty),
    loadCross: () => { calls.loadCross++ },
    window: { confirm: () => { calls.confirm++; return confirmAnswer } },
  }
  const bundle = leaveEditSrc + '\n' + exitEditSrc + '\n' + afterSaveSrc +
    '\nreturn { leaveEdit, exitEdit, exitEditAfterSave }'
  const fn = new Function('ref', 'editMode', 'loadingEdit', 'errListOpen', 'pagingOn',
    'dirtySinceSave', 'loadCross', 'window', bundle)
  const M = fn(env.ref, env.editMode, env.loadingEdit, env.errListOpen, env.pagingOn,
    env.dirtySinceSave, env.loadCross, env.window)
  return { M, env, calls }
}

console.log('\n【A. leaveEdit —— 退出编辑态的唯一收口】')
{
  const { M, env, calls } = makeEnv(false, true)
  M.leaveEdit()
  eq('A1 editMode → false（只读态 ⇒ 「改单」按钮 v-if="!editMode" 出现）', env.editMode.value, false)
  eq('A2 loadingEdit → false', env.loadingEdit.value, false)
  eq('A3 errListOpen → false（v174：收起查错面板）', env.errListOpen.value, false)
  eq('A4 pagingOn → false（Q7：复位分页）', env.pagingOn.value, false)
  eq('A5 loadCross 被调用 1 次（回到只读）', calls.loadCross, 1)
  eq('A6 loadCross 被调用、且**不被 await**（同步返回 ⇒ 其异常不会冒泡进 saveEdits 的 catch）',
     /(^|\s)loadCross\(\)/.test(leaveEditSrc) && !/await\s+loadCross/.test(leaveEditSrc), true)
}

console.log('\n【B. exitEditAfterSave —— 保存成功路径：永不确认】')
{
  const { M, env, calls } = makeEnv(true, false)   // 故意把 dirty 置真、confirm 设为「取消」
  M.exitEditAfterSave()
  eq('B1 即便 dirty=true，confirm 也**一次都不弹**', calls.confirm, 0)
  eq('B2 仍然退出编辑态（不受 confirm 返回值影响）', env.editMode.value, false)
  eq('B3 loadCross 仍被调用', calls.loadCross, 1)
}

console.log('\n【C. exitEdit —— 用户主动取消路径：dirty 才确认】')
{
  const { M, env, calls } = makeEnv(false, true)
  M.exitEdit()
  eq('C1 无未保存改动 ⇒ 不弹确认', calls.confirm, 0)
  eq('C2 直接退出', env.editMode.value, false)
}
{
  const { M, env, calls } = makeEnv(true, true)    // dirty + 用户点「确定」
  M.exitEdit()
  eq('C3 有改动 ⇒ 弹确认 1 次', calls.confirm, 1)
  eq('C4 用户点确定 ⇒ 退出', env.editMode.value, false)
}
{
  const { M, env, calls } = makeEnv(true, false)   // dirty + 用户点「取消」
  M.exitEdit()
  eq('C5 有改动 ⇒ 弹确认 1 次', calls.confirm, 1)
  eq('C6 用户点取消 ⇒ **不退出**（停留在编辑态）', env.editMode.value, true)
  eq('C7 用户点取消 ⇒ 不触发 loadCross', calls.loadCross, 0)
}

/* ---------- 3. saveEdits 顺序断言（文本级，因为它依赖太多无法整体 exec） ---------- */
console.log('\n【D. saveEdits —— 顺序与分支】')
const iExit = saveEditsSrc.lastIndexOf('exitEditAfterSave()')
const iCatch = saveEditsSrc.indexOf('} catch (e) {')
const iSnap = saveEditsSrc.lastIndexOf('lastSavedSnap.value = clone(cross.value)')
const iAudit = saveEditsSrc.lastIndexOf('recordAudit(')

ok('D1 saveEdits 里调用了 exitEditAfterSave()', iExit > 0)
ok('D2 该调用出现在 catch 之前（= 成功路径上）', iExit > 0 && iCatch > 0 && iExit < iCatch)
ok('D3 基线快照在退出**之前**取（否则 clone 到只读态对象、基线残缺）',
   iSnap > 0 && iExit > 0 && iSnap < iExit)
ok('D4 记痕在退出**之前**（用户要求「每次修改都需记录」，先记痕再离开）',
   iAudit > 0 && iExit > 0 && iAudit < iExit)
ok('D5 saveEdits 成功路径**不再**保持编辑态（无 await loadEditGrid()）',
   !/await\s+loadEditGrid\(\)/.test(saveEditsSrc))
{
  const tail = iCatch > 0 ? saveEditsSrc.slice(iCatch) : ''
  ok('D6 失败分支（catch 之内）不调用 exitEditAfterSave ⇒ 停在编辑态、数据不丢',
     tail.length > 0 && !/exitEditAfterSave/.test(tail))
  ok('D7 失败分支不重载网格（保留用户正在改的内容）',
     tail.length > 0 && !/loadEditGrid\(\)/.test(tail))
}
ok('D8 recordAudit 仍是 await（否则与随后的退出构成竞态，刚退出查日志会漏这条）',
   /await\s+recordAudit\(/.test(saveEditsSrc))
{
  /* recordAudit 失败不得阻断保存（用户视角：数据存进去了才是第一位） */
  const def = sliceFn('async function recordAudit(')
  ok('D9 recordAudit 内部自带 catch（失败只告警、不抛出 ⇒ 不阻断保存）',
     /catch/.test(def) && !/throw/.test(def))
}

/* ---------- 4. 汇总 ---------- */
console.log('\n' + '='.repeat(72))
if (fail === 0) {
  console.log('✅ 全部通过：' + pass + ' 项断言')
  process.exit(0)
} else {
  console.log('❌ 失败 ' + fail + ' 项 / 共 ' + (pass + fail) + ' 项')
  fails.forEach(f => console.log('   · ' + f))
  process.exit(1)
}
