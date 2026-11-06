/* ㊱·f　粘贴语义：**绝对覆盖**，不是累加（v792）
   ────────────────────────────────────────────────────────────────────────
   需求（2026-11-06 23:01，老张原话，逐条照抄）：
     「我希望做到的是 Excel 复制过来的数据完整覆盖系统里的数据，比如
       系统里现在是 6，excel 的数据是 0，那么复制粘贴到系统后，系统数据就变成 0，代表减单，从 6 减到 0；
       如果系统里现在是 6，excel 的数据是 6，那么复制粘贴到系统后，系统数据还是 6，代表不增不减，没有改单；
       如果系统里现在是 6，excel 的数据是 12，那么复制粘贴到系统后，系统数据也变成 12，代表加单，加了 6。」

   ⇒ 三条场景就是本文件的验收标准，**逐条实跑**（不是读代码猜）：
       A 段：写值这一半（write_stock 同理的「直接赋值」语义）—— 6→0 / 6→6 / 6→12，且**粘两次不翻倍**；
       B 段：显示这一半 —— 门店格显示值 = 报量 + 分摊叠加，粘贴必须把该格从分摊里**接管**出来，
              否则「系统里的数」和你粘进去的数不是同一个东西（负数那次报障的同一个根）。

   🔴 为什么要「接管」而不能只写 qtyByUnit：
      `qtyCellShown(r,store) = qtyByUnit[store] + allocOfStore(r,store)`（calc.js::allocOfStore）。
      只写前一半 ⇒ 粘 12 而屏幕显示 12+分摊；粘 0 而分摊把旧的量又顶回来。
      用户说的「系统里的数据」= 屏幕/保存后合计那个数，所以两半都得覆盖。

   🔴 本护栏防三种空白支票（本项目铁律）：
      ① 正则抽到空集 ⇒ 先断言抽出的函数体非空、且真的能在 vm 里跑出数；
      ② 只查唯一不查存在 ⇒ 「整体赋值」必须与「粘两次仍是同一个数」成对判
         （只判赋值符号的话，写成 `x = x + v` 也能过）；
      ③ 只写上限 ⇒ 每条关键判据都配坏样本（撤销修复即红）。 */

import fs from 'node:fs'
import vm from 'node:vm'
import { parseNumInput } from '../src/utils/forecast/format.js'
import { allocOfStore } from '../src/utils/forecast/calc.js'

const vue = fs.readFileSync(new URL('../src/pages/Forecast.vue', import.meta.url), 'utf8')
let pass = 0, fail = 0
function ok (cond, msg, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + msg + (extra ? ' ' + extra : '')) }
  else { fail++; console.log('  ❌ ' + msg + (extra ? ' ' + extra : '')) }
}
const stripComments = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
/* 抽函数体：按**花括号配平**截取。
   ⚠️ 不能用「首个行首顶格 }」——函数体里有对象字面量 `{ ... }` 时会被提前截断
      （v791 首跑就是这么挂的），截出来的半截函数在 vm 里要么语法错、要么静默少跑几行。 */
function extract (src, sig) {
  const s = src.indexOf(sig)
  if (s < 0) return ''
  const i = src.indexOf('{', s)
  if (i < 0) return ''
  let d = 0
  for (let k = i; k < src.length; k++) {
    const ch = src[k]
    if (ch === '{') d++
    else if (ch === '}') { d--; if (!d) return src.slice(s, k + 1) }
  }
  return ''
}

/* ── 把**真实**函数体搬进沙箱：writeCellVal + qtyCellTakeOver（不写桩版实现） ── */
const wcvSrc = extract(vue, 'function writeCellVal(')
const takeOverSrc = extract(vue, 'function qtyCellTakeOver(')
ok(wcvSrc.length > 400, '抽到 writeCellVal 真实函数体（防「抽空集」假绿）', `${wcvSrc.length} 字符`)
ok(takeOverSrc.length > 100, '抽到 qtyCellTakeOver 真实函数体', `${takeOverSrc.length} 字符`)
ok(/qtyByUnit\[store\]\s*=\s*parseNumInput\(v\)/.test(wcvSrc),
  'writeCellVal 对数量格是**整体赋值**（`= parseNumInput(v)`），不是 `+=`')

/* 沙箱：只给「这具函数体真正读到的外部名字」，其余一律不给（读不到就当场炸，不静默） */
function makeSandbox () {
  const cross = { value: { rows: [], units: [{ name: '吾悦' }] } }
  const ctx = {
    cross,
    visibleCols: { value: [{ key: 'name', edit: 'text' }] },   // 1 个主档列 ⇒ 数量列从 c=1 起
    unitCount: () => 1,
    parseNumInput,
    calcInputKey: () => '',
  }
  vm.createContext(ctx)
  vm.runInContext(takeOverSrc + '\n' + wcvSrc, ctx)
  ctx.__cross = cross
  return ctx
}

/* 一轮「粘贴」：种子系统值 → 写入 → 返回行对象（含分摊叠加后的**屏幕值**） */
function pasteOnce (seedQty, pasteVal, alloc) {
  const ctx = makeSandbox()
  const r = { product_id: 1, qtyByUnit: { '吾悦': seedQty } }
  if (alloc) r.allocByStore = { '吾悦': alloc }
  ctx.__cross.value.rows = [r]
  const wrote = vm.runInContext('writeCellVal(0, 1, __V)', Object.assign(ctx, { __V: pasteVal }))
  r.__wrote = wrote
  return r
}
const shown = (r) => (Number(r.qtyByUnit['吾悦']) || 0) + allocOfStore(r, '吾悦')

/* ══════════════ A. 三条场景：写进去的就是 Excel 那个数 ══════════════ */
console.log('\nA. 绝对覆盖（老张三条场景，逐条实跑）')
const a1 = pasteOnce(6, '0')
ok(a1.__wrote === true && a1.qtyByUnit['吾悦'] === 0,
  '系统 6 + Excel 0 ⇒ 系统变 0（减单，从 6 减到 0）', `实际=${a1.qtyByUnit['吾悦']}`)
const a2 = pasteOnce(6, '6')
ok(a2.qtyByUnit['吾悦'] === 6, '系统 6 + Excel 6 ⇒ 还是 6（不增不减，没有改单）', `实际=${a2.qtyByUnit['吾悦']}`)
const a3 = pasteOnce(6, '12')
ok(a3.qtyByUnit['吾悦'] === 12, '系统 6 + Excel 12 ⇒ 变 12（加单，加了 6）', `实际=${a3.qtyByUnit['吾悦']}`)

/* 空白格：Excel 里那格是空的 ⇒ 等于 0（这一期不报）。与「粘 0」同义。 */
const a4 = pasteOnce(6, '')
ok(a4.qtyByUnit['吾悦'] === 0, '系统 6 + Excel 空白 ⇒ 变 0（空白与 0 同义，不清留旧值）',
  `实际=${a4.qtyByUnit['吾悦']}`)

/* 🔴 反累加（这条才是「覆盖」与「叠加」的分水岭）：同一格连粘两次同样的数，结果必须还是那个数。
   写成 `qtyByUnit[store] += v` 会得到 24 —— 那就是「粘 12 变 12+6」的老毛病。 */
const ctxTwice = makeSandbox()
const rTwice = { product_id: 1, qtyByUnit: { '吾悦': 6 } }
ctxTwice.__cross.value.rows = [rTwice]
vm.runInContext('writeCellVal(0, 1, "12")', ctxTwice)
vm.runInContext('writeCellVal(0, 1, "12")', ctxTwice)
ok(rTwice.qtyByUnit['吾悦'] === 12, '同一格连粘两次 12 ⇒ 仍是 12（不是 24，证明是覆盖不是累加）',
  `实际=${rTwice.qtyByUnit['吾悦']}`)
/* 再从 12 粘回 6：减单方向也要灵。 */
vm.runInContext('writeCellVal(0, 1, "6")', ctxTwice)
ok(rTwice.qtyByUnit['吾悦'] === 6, '从 12 再粘 6 ⇒ 回到 6（加单/减单两个方向都覆盖）')

/* 坏样本自证①：把赋值改成累加 ⇒ 上面那条「连粘两次」必须翻红。 */
const badAdd = wcvSrc.replace(/qtyByUnit\[store\]\s*=\s*parseNumInput\(v\)/,
  'qtyByUnit[store] = (Number(rw.qtyByUnit[store]) || 0) + parseNumInput(v)')
ok(badAdd !== wcvSrc && /\+ parseNumInput\(v\)/.test(badAdd), '坏样本构造成功（累加版函数体）')
{
  const ctx = makeSandbox()
  vm.runInContext(takeOverSrc + '\n' + badAdd, ctx)
  const r = { product_id: 1, qtyByUnit: { '吾悦': 6 } }
  ctx.__cross.value.rows = [r]
  vm.runInContext('writeCellVal(0, 1, "12")', ctx)
  vm.runInContext('writeCellVal(0, 1, "12")', ctx)
  ok(r.qtyByUnit['吾悦'] === 30, '坏样本（累加版）连粘两次跑出 30（6+12+12）⇒ 撤销修复即红，判据不是永真',
    `坏样本实际=${r.qtyByUnit['吾悦']}`)
}

/* ══════════════ B. 分摊叠加：粘贴必须「接管」这一格 ══════════════ */
console.log('\nB. 门店格显示值 = 报量 + 分摊 ⇒ 粘贴要把它接管出来')
/* 复现负数报障那次的形态：qtyByUnit=-6、分摊 +6 ⇒ 屏幕显示 0，用户以为系统里是 0。 */
const pre = { product_id: 1, qtyByUnit: { '吾悦': -6 }, allocByStore: { '吾悦': 6 } }
ok(shown(pre) === 0, '前置复现：报量 -6 + 分摊 +6 ⇒ 屏幕显示 0（负数被分摊遮住）',
  `屏幕=${shown(pre)}`)

const b1 = pasteOnce(0, '12', 6)      // 系统里那格"看着是 6"（报量 0 + 分摊 6），粘 12
ok(allocOfStore(b1, '吾悦') === 0, '粘贴后该格已接管：分摊不再叠加（allocOfStore = 0）',
  `实际=${allocOfStore(b1, '吾悦')}`)
ok(shown(b1) === 12, '粘贴 12 后**屏幕显示 = 12**（不是 12+分摊）', `屏幕=${shown(b1)}`)
ok(b1.__wrote === true, '接管后写入仍然成功（接管不吞掉本次粘贴）')

/* 粘 0 的形态：分摊必须一并让位，否则「粘 0 还是显示 6」 */
const b2 = pasteOnce(0, '0', 6)
ok(shown(b2) === 0, '系统"看着是 6"（报量 0 + 分摊 6）+ 粘 0 ⇒ 屏幕变 0（减到 0）', `屏幕=${shown(b2)}`)

/* 只接管被粘的那一格，同行别的门店不受影响 */
{
  const ctx = makeSandbox()
  ctx.__cross.value.units = [{ name: '吾悦' }, { name: '唐成' }]
  ctx.unitCount = () => 2
  const r = {
    product_id: 1,
    qtyByUnit: { '吾悦': 0, '唐成': 0 },
    allocByStore: { '吾悦': 6, '唐成': 4 }
  }
  ctx.__cross.value.rows = [r]
  vm.runInContext('writeCellVal(0, 1, "12")', ctx)     // 只写第 0 个数量列 = 吾悦
  ok(allocOfStore(r, '吾悦') === 0 && allocOfStore(r, '唐成') === 4,
    '只接管被粘的那一格（吾悦），同行唐成的分摊原样保留',
    `吾悦=${allocOfStore(r, '吾悦')} 唐成=${allocOfStore(r, '唐成')}`)
  ok(shown(r) === 12 && (r.qtyByUnit['唐成'] + allocOfStore(r, '唐成')) === 4,
    '未粘的唐成格子显示值不变（4）')
}

/* 坏样本自证②：删掉接管调用 ⇒ 「粘 12 显示 12」必须翻红（会显示成 18）。 */
const badNoTake = wcvSrc.replace(/^\s*qtyCellTakeOver\(rw,\s*store\)\s*$/m, '')
ok(badNoTake !== wcvSrc, '坏样本构造成功（删掉 qtyCellTakeOver 调用）')
{
  const ctx = makeSandbox()
  vm.runInContext(takeOverSrc + '\n' + badNoTake, ctx)
  const r = { product_id: 1, qtyByUnit: { '吾悦': 0 }, allocByStore: { '吾悦': 6 } }
  ctx.__cross.value.rows = [r]
  vm.runInContext('writeCellVal(0, 1, "12")', ctx)
  ok(shown(r) === 18, '坏样本（不接管）确实显示成 18 ⇒ 撤销修复即红', `坏样本屏幕=${shown(r)}`)
}

/* 顺序：必须先接管、再写值（反过来的话「已接管判定」读的还是旧的，虽然当前实现两种顺序都成立，
   但先接管表达了意图：这一格从现在起由用户说了算）。 */
{
  const iTake = wcvSrc.indexOf('qtyCellTakeOver(rw, store)')
  const iWrite = wcvSrc.indexOf('qtyByUnit[store] = parseNumInput(v)')
  ok(iTake > 0 && iWrite > 0 && iTake < iWrite, '顺序：先接管分摊，再写值')
}

/* ══════════════ C. 所有主动写入走同一入口（不许有第二条累加实现） ══════════════ */
console.log('\nC. 写入入口唯一性（粘贴/填充/清空/全部走 writeCellVal）')
const code = stripComments(vue)
ok(/function pasteRegion[\s\S]{0,4000}writeCellVal\(/.test(code), '区块粘贴（pasteRegion）走 writeCellVal')
ok(/function tryPasteCross[\s\S]{0,6000}writeCellVal\(/.test(code), '按客户列粘贴（tryPasteCross）走 writeCellVal')
ok(/function batchWrite[\s\S]{0,1500}writeCellVal\(/.test(code), '单值铺满选区（batchWrite）走 writeCellVal')
ok(/function clearRange[\s\S]{0,1200}writeCellVal\(/.test(code), 'Delete 清空（clearRange）走 writeCellVal')
/* 反向：全仓不许出现对 qtyByUnit 的**累加写**（`+=` / `x = x + ...`）。
   历史 v109 的「qtyByUnit[units[0].name] += s」正是这个坑，注释里点名过。 */
ok(!/qtyByUnit\[[^\]]+\]\s*\+=/.test(code), '源码里没有对 qtyByUnit 的 `+=` 累加写（反累加守则）')

/* ══════════════ D. 落库侧：0 与空都落成「这一格为 0」 ══════════════ */
console.log('\nD. 落库语义（后端 save_matrix：先清本期『导入』再原样重建）')
const pyPath = new URL('../../.workbuddy/remote-erp/routers/forecast_submissions.py', import.meta.url)
if (!fs.existsSync(pyPath)) {
  console.log('  ⚠️ 跳过：本机没有生产后端镜像（.workbuddy/remote-erp/…），D 段未验（**不算通过**）')
} else {
  const py = fs.readFileSync(pyPath, 'utf8')
  const iDel = py.indexOf('DELETE FROM forecast_submissions WHERE {_import_cond}')
  const iLoop = py.indexOf('for cname in customers:')
  ok(iDel > 0 && iLoop > 0 && iDel < iLoop,
    '幂等清理在写入之前（先删掉本期全部『导入』行，再按本次 payload 重建 ⇒ 旧值不会残留）')
  ok(/if qty is None or qty == 0:\s*\n\s*continue/.test(py),
    '数量 0 不落明细行（结合上面的先删后建 ⇒ 该格就是 0，不是「没填、保留旧值」）')
  ok(/qty < 0:\s*\n\s*adj_items\.append/.test(py),
    '负数差额落 `主管调整` 单（减单可追溯，门店自报行分毫不动）')
  ok(/s\.role !== '导入' && s\.role !== '主管调整'/.test(vue),
    '前端「非导入量」排除主管调整（否则减单会被自己的产物吃掉、越存越回弹）')
  /* 坏样本：把先删后建改成只增不删 ⇒ 「旧值残留」判据应翻红 */
  const badNoDel = py.replace(/DELETE FROM forecast_submissions WHERE \{_import_cond\}/, 'SELECT 1')
  ok(!/DELETE FROM forecast_submissions WHERE \{_import_cond\}/.test(badNoDel),
    '坏样本（去掉幂等删除）可被判否 ⇒ 「先删后建」判据不是永真')
}

console.log(`\n${fail ? '❌' : '✅'} 粘贴覆盖契约：${pass} 通过 / ${fail} 失败\n`)
process.exit(fail ? 1 : 0)
