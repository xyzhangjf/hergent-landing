// v210「单元格两态模型」离线不变量护栏
//
// 为什么必须有它：本次两条需求（单击全选 / 方向键跳格）**共用同一个判别变量 cellTyping**，
//   而这个变量在 4 个地方被读、在 4 个地方被写。任何一处判据写歪，症状都是**静默的**：
//     · 漏在 @focus 上传 $event ⇒ 某一列单击不全选（用户只会觉得「这一列怪怪的」）
//     · 把早退判据写回裸 `editing` ⇒ 方向键跳格整个功能消失（不报错、就是不跳）
//     · 判据漏 `&& editing`   ⇒ 拖框选之后方向键整体失效（不报错、就是不动）
//     · focusCell 里复位写到 nextTick 内 ⇒ F2 的语义被做反（变成单击）
//   所以最有价值的两条断言是：
//     C 段「模板里每个可编辑 input 的 @focus 都带 $event」——把「漏一列」变成机器可查；
//     D 段「早退判据必须是 `cellTyping.value && editing`」——把「功能整体消失」钉死。
//
// 做法：切片**真实源码**断言（不复刻实现，避免守卫与源码漂移），不 exec Vue。
//
// 用法：node .workbuddy/tools/v210-cell-typing-verify.mjs
import fs from 'fs'

const SRC = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue'
const src = fs.readFileSync(SRC, 'utf8')

let pass = 0
const fails = []
function ok(name, cond, extra) {
  if (cond) { pass++; return }
  fails.push(name + (extra ? '  → ' + extra : ''))
}
function eq(name, got, want) {
  ok(name, got === want, 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))
}

/* ---------- 0. 基础：模板 / 脚本分区，注释剥离 ---------- */
const tplStart = src.indexOf('<template>')
const tplEnd = src.lastIndexOf('</template>')
const tplRaw = src.slice(tplStart, tplEnd)
/* 模板注释剥离：判据不能匹配到注释里的字（本文件的注释写得非常长，最容易在这里自欺） */
const tpl = tplRaw.replace(/<!--[\s\S]*?-->/g, '')
/* 脚本区：去掉 // 行注释与 /* 块注释，避免“注释里提到过 cellTyping”被当成实现 */
const scriptRaw = src.slice(tplEnd)
const script = scriptRaw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')

/* ---------- 工具：按花括号配平抠出函数体 ---------- */
function sliceBrace(text, needle) {
  const i = text.indexOf(needle)
  if (i < 0) throw new Error('找不到：' + needle)
  let d = 0
  for (let j = text.indexOf('{', i); j < text.length; j++) {
    if (text[j] === '{') d++
    else if (text[j] === '}') { d--; if (d === 0) return text.slice(i, j + 1) }
  }
  throw new Error('花括号不配平：' + needle)
}
const has = (s, k) => s.indexOf(k) >= 0
/* 抠出**编辑表**那一段模板（只读表也有一套 input，判据必须限定在编辑表内） */
const editTblIdx = tpl.indexOf('edit-grid-wrap')
const editTbl = editTblIdx > 0 ? tpl.slice(editTblIdx, tpl.indexOf('</table>', editTblIdx)) : ''

/* ================= A. 两态模型本体 ================= */
ok('A1 cellTyping 已声明为 ref（跨函数共享的瞬态判别量）',
   /const cellTyping = ref\(false\)/.test(script))
ok('A2 🔴 cellTyping 不是普通 let（避免后人误以为它不需要响应式而改成裸变量）',
   !/let cellTyping\b/.test(script))

const focusFn = sliceBrace(script, 'function focusCell(')
ok('A3 focusCell 里复位两态：`cellTyping.value = !doSelect`（false⇒导航态 / false 的另一侧⇒输入态）',
   /cellTyping\.value = !doSelect/.test(focusFn))
/* 🔴 顺序断言：必须在 nextTick 之前 —— el.focus() 会同步触发 @focus(onFocusCell)，那里面要读它 */
{
  const iSet = focusFn.indexOf('cellTyping.value = !doSelect')
  const iTick = focusFn.indexOf('nextTick(')
  ok('A4 🔴 复位语句在 nextTick **之前**（否则 el.focus() 同步触发的 @focus 读到的是旧态 ⇒ F2 被做成单击）',
     iSet >= 0 && iTick >= 0 && iSet < iTick, 'set@' + iSet + ' nextTick@' + iTick)
}
ok('A5 导航态分支：全选（el.select 在 try 内）',
   /if \(doSelect && el\.select\) \{ try \{ el\.select\(\) \} catch \(e\) \{\} \}/.test(focusFn))
ok('A6 输入态分支：光标落末尾（setSelectionRange 在 try 内 —— 数字输入框会抛 InvalidStateError）',
   /else if \(el\.setSelectionRange\) \{ try \{/.test(focusFn))

/* ================= B. 需求①：单击即全选 ================= */
const ofcFn = sliceBrace(script, 'function onFocusCell(')
ok('B1 onFocusCell 收 $event（没有它就没有 el 可 select）', /function onFocusCell\(r, c, e\)/.test(ofcFn))
ok('B2 🔴 全选**只在导航态**发生（`!cellTyping.value &&`）—— 漏了它 Q21 老病复发（想改一位数字变成整格重输）',
   /!cellTyping\.value && e && e\.target && e\.target\.select/.test(ofcFn))
ok('B3 全选在 try 内（照抄 focusCell 里已被生产验证的写法）',
   /try \{ e\.target\.select\(\) \} catch \(err\) \{\}/.test(ofcFn))

/* 🔴 C 段（本次最值钱的一条）：编辑表里**每一个**可编辑 input 的 @focus 都必须带 $event。
   漏一个 ⇒ 那一列单击不全选。这是纯静默的，只能机器查。 */
{
  const all = (editTbl.match(/@focus="onFocusCell\(/g) || []).length
  const withEv = (editTbl.match(/@focus="onFocusCell\([^"]*\$event\)"/g) || []).length
  ok('C1 编辑表内存在 @focus="onFocusCell(...)"', all > 0, 'count=' + all)
  eq('C2 🔴 每一个都得带 $event（漏一列 = 那一列单击不全选，静默）', withEv, all)
  ok('C3 列覆盖面齐（当前实现为 7 处：商品名/文本·下拉/文本/数字/各客户列/加单/单价）',
     all >= 7, 'count=' + all)
}
/* 反向：不得再有**没传 $event**的旧写法残留 */
ok('C4 无 @focus="onFocusCell(...)" 的旧式残留（无 $event）',
   !/@focus="onFocusCell\([^"]*\)"(?!.*\$event)/.test(editTbl) ||
   (editTbl.match(/@focus="onFocusCell\([^"]*\$event\)"/g) || []).length ===
   (editTbl.match(/@focus="onFocusCell\([^"]*\)"/g) || []).length)

/* ================= D. 需求②：方向键跨格跳转 ================= */
const gkFn = sliceBrace(script, 'function onGridKey(')
ok('D1 🔴 早退判据必须是 `cellTyping.value && editing`（写成裸 `editing &&` 就是老 bug：跳格功能整体不存在）',
   /if \(cellTyping\.value && editing && \(e\.key === 'ArrowDown'/.test(gkFn))
ok('D2 🔴 判据必须带 `&& editing` —— 漏了它拖框选（blur 掉输入框）之后方向键整体失效且不报错',
   /cellTyping\.value && editing &&/.test(gkFn))
ok('D3 放行集合仍覆盖 Home/End/PageUp/PageDown（不是只放行四个方向键）',
   /'Home' \|\| e\.key === 'End' \|\| e\.key === 'PageUp' \|\| e\.key === 'PageDown'/.test(gkFn))
/* 四个方向键的跳格分支必须都在早退 return **之后** —— 否则它们就是死代码 */
{
  const iGuard = gkFn.indexOf("if (cellTyping.value && editing && (e.key === 'ArrowDown'")
  const iGuardEnd = gkFn.indexOf('return', iGuard)
  const keys = ["e.key === 'ArrowDown'", "e.key === 'ArrowUp'", "e.key === 'ArrowLeft'", "e.key === 'ArrowRight'"]
  const afterGuard = (k) => {
    const i = gkFn.indexOf('} else if (' + k + ')')
    return i > iGuardEnd
  }
  ok('D4 🔴 四个方向键分支都在早退之后（否则永远是死代码 —— 这是老 bug 的形态）',
     keys.every(afterGuard), keys.map((k) => k + '=' + afterGuard(k)).join(' '))
  const jumpKeys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']
  const jumpOk = jumpKeys.every((k) => {
    const i = gkFn.indexOf("e.key === '" + k + "'", iGuardEnd)
    return i > 0 && gkFn.indexOf('focusCell(', i) > i
  })
  ok('D5 八个跳格键都在早退之后调用了 focusCell（跳格 = 换格 + 复位两态，唯一入口）', jumpOk)
}
/* Enter / Tab 也走 focusCell（换格后必须回到导航态） */
ok('D6 Enter 跳格走 focusCell', /e\.key === 'Enter'\) \{\s*e\.preventDefault\(\); r = Math\.min\(maxR, r \+ \(e\.shiftKey \? -1 : 1\)\); selectCell\(r, c\); focusCell\(r, c\)/.test(gkFn))
ok('D7 Tab 跳格走 focusCell', /selectCell\(r, c\); focusCell\(r, c\)\s*$/m.test(gkFn))

/* 进入输入态的三条路径 */
ok('D8 F2 = 进入**输入态**（{ select: false }）—— 原实现是 { select: true } = 与单击等价，白给',
   /e\.key === 'F2'\) \{\s*[\s\S]{0,200}?focusCell\(r, c, \{ select: false \}\)/.test(gkFn))
ok('D9 输入态下 Esc 先退回导航态（只换态、不回退内容 —— 不回退是有意为之，避免静默丢数据）',
   /if \(cellTyping\.value\) \{ cellTyping\.value = false; focusCell\(r, c, \{ select: true \}\); return \}/.test(gkFn))
const downFn = sliceBrace(script, 'function onCellDown(')
ok('D10 🔴 第二次点击判据 = 「按下时该输入框已是 activeElement」（不能用 selected 比对代替）',
   /document\.activeElement === t/.test(downFn) && /t\.tagName === 'INPUT'/.test(downFn))
ok('D11 onCellDown 里写入两态（每次按下都重算 ⇒ 陈旧值不可能活过一次点击）',
   /cellTyping\.value = !!\(/.test(downFn))
/* 拖框选自愈 */
const overFn = sliceBrace(script, 'function onCellOver(')
ok('D12 拖框选 blur 之后显式回到导航态', /cellTyping\.value = false/.test(overFn))

/* ================= E. 同路径修复：_pendingCell 每格一套 ================= */
ok('E1 🔴 缺陷修复：_pendingCell 换格即重记（原 `if (!_pendingCell)` 会让「先点后改」的那次改动既不进撤销栈、也不点亮状态条）',
   /if \(!_pendingCell \|\| _pendingCell\.r !== r \|\| _pendingCell\.c !== c\) \{/.test(script))
ok('E2 旧的裸判据已不存在（防止被改回去）',
   !/if \(!_pendingCell\) _pendingCell = \{/.test(script))

/* ================= F. 交叉不变量：一个变量裁决两态 ================= */
{
  /* 读了 cellTyping 的位置：focusCell(写) / onGridKey(读) / onFocusCell(读) / onCellDown(写) / onCellOver(写) */
  const readers = [['focusCell', focusFn], ['onGridKey', gkFn], ['onFocusCell', ofcFn], ['onCellDown', downFn], ['onCellOver', overFn]]
  const missing = readers.filter(([, body]) => !has(body, 'cellTyping')).map(([n]) => n)
  ok('F1 🔴 两态判别量被 5 处共读（裁决唯一；若某处另判一套必然互相打脸）', missing.length === 0, 'missing=' + missing.join(','))
  ok('F2 🔴 状态条 / 可撤销性仍由 pushCellSnap 唯一点亮（本改动不得绕开它自行改脏标记）',
     /function pushCellSnap\(r, c, oldVal, newVal\) \{\s*\n\s*dirtySinceSave\.value = true/.test(script))
}

/* ================= H. 需求②的连带缺陷：跳到的格子不得被粘性列/表头遮住 =================
   🔴 这条守的是「按了方向键，光标看不见」——v210 才新开出来的路径（改前方向键不跳格）。
      真机取证：End 把表格滚到 sl=2055 后，`scrollIntoView({inline:'nearest'})`（= 原生 focus 的
      最小滚动语义）把目标格停在滚动口左边缘 x=284..360，而粘性列占据 x=283..533
      ⇒ 命中测试 elementFromPoint 命中的是 `td.seq-cell`（不是 input）。 */
const clearFn = sliceBrace(script, 'function keepCellClear(')
ok('H1 存在 keepCellClear（跳格后把被粘性元素遮住的格子滚出来）', has(src, 'function keepCellClear('))
{
  const iFocus = focusFn.indexOf('el.focus()')
  const iCall = focusFn.indexOf('keepCellClear(el)')
  const iTick = focusFn.indexOf('nextTick(')
  ok('H2 🔴 它在 focusCell 里、且**在 nextTick 之内、el.focus() 之后**被调用（focus 才是产生遮挡的那一步）',
     iCall > iFocus && iCall > iTick, 'focus@' + iFocus + ' call@' + iCall + ' nextTick@' + iTick)
}
ok('H3 粘性格自身直接跳过（序号/商品名称按定义永远可见；对它补偿只会让页面无意义地漂移）',
   /if \(td && getComputedStyle\(td\)\.position === 'sticky'\) return/.test(clearFn))
ok('H4 🔴 冻结区边界是**量出来的**（遍历本行 sticky 格子取最大 right），不是写死像素',
   /for \(const cell of tr\.children\)/.test(clearFn) && /cr\.right > leftGuard/.test(clearFn))
ok('H5 🔴 leftGuard 不得被赋硬编码数字（写死 250px 会随列宽/表头变化而失效）',
   !/leftGuard = .*[0-9]{3}/.test(clearFn))
ok('H6 粘性表头下边界同样量出来（表头可能多行，取最大 bottom）',
   /wrap\.querySelectorAll\('thead th'\)/.test(clearFn) && /hr\.bottom > topGuard/.test(clearFn))
ok('H7 🔴 只在「确实被遮住」时才滚（两个方向都是条件分支，不能无条件滚 —— 否则相邻格之间跳转会不停抖动）',
   /if \(r\.left < leftGuard \+ M\) wrap\.scrollLeft -= /.test(clearFn)
   && /else if \(r\.right > wr\.right - M\) wrap\.scrollLeft \+= /.test(clearFn)
   && /if \(r\.top < topGuard \+ M\) wrap\.scrollTop -= /.test(clearFn)
   && /else if \(r\.bottom > wr\.bottom - M\) wrap\.scrollTop \+= /.test(clearFn))
ok('H8 找不到滚动容器时安全返回（focusCell 用的是**全局** input 选择器，可能选到本表之外的输入框）',
   /const wrap = el\.closest\('\.table-wrap'\)\s*\n\s*if \(!wrap\) return/.test(clearFn))

/* ================= G. 回归：不许碰坏已上线的东西 ================= */
ok('G1 v207 合计箱四函数仍在', ['function boxesOf', 'function rowBoxes', 'function boxMissing', 'function fmtBox'].every((k) => has(src, k)))
ok('G2 v208 退出编辑唯一收口 leaveEdit 仍在', has(script, 'function leaveEdit('))
ok('G3 v209 全屏让位判据 fsRowHosting 仍在（三条件齐全）',
   /const fsRowHosting = computed\(\(\) => gridFullscreen\.value && viewMode\.value === 'cross' && !crossLoading\.value\)/.test(script))
ok('G4 v201 状态条三态仍在', has(script, "text: '尚未修改'") && has(script, "text: '有未保存的改动'"))
ok('G5 编辑表 / 只读表仍是两张表（判据不得混用）',
   has(tpl, 'edit-grid-wrap') && has(tpl, 'cross-viewport'))
/* 只读表的内联编辑器（vFocus + @keydown.stop）**有意不改** —— 它是双击进入=编辑态，光标落定点才贴合 Excel。
   这条断言把「有意不改」写成机器可查，避免后人误以为漏改。 */
ok('G6 只读表内联编辑器未被本改动波及（vFocus 仍是只 focus 不 select）',
   /const vFocus = \{ mounted: el => \{ try \{ el\.focus\(\) \} catch \(e\) \{\} \} \}/.test(script))

/* ---------- 输出 ---------- */
console.log('\n===== v210 单元格两态不变量护栏 =====')
console.log('编辑表可编辑 input 数 = ' + (editTbl.match(/@focus="onFocusCell\(/g) || []).length
  + '（全部带 $event）')
if (fails.length) {
  console.log('\n❌ 失败 ' + fails.length + ' 项 / 共 ' + (pass + fails.length) + ' 项')
  fails.forEach((f) => console.log('   · ' + f))
  process.exit(1)
}
console.log('\n✅ 全部通过：' + pass + ' 项断言')
