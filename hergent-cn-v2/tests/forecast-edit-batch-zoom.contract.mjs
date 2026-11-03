/* v746 契约：改单态「首批行数 / 安全线」必须跟着缩放算，且安全线优先于击键让路。
 *
 * 报障同族（v745 的续集）：「缩小网格后行数不够、下方大片留白」。
 * v745 修的是**只读态**虚拟滚动（`vsWindow`）；改单态不走虚拟滚动，走的是
 * 「首批 N 行 + 双 rAF 每批 24 行补齐」（v666，为治「点改单一卡 3 秒」）。
 * 但 `EDIT_FIRST_BATCH = 24` 是按 100% 一屏定的**定值**：
 *
 *   真机实测（生产 1600×900 期次 42）：编辑态每行 **21px**、容器高 **536px**
 *     · 100%：24 × 21 = 504px ≈ 一屏（原行为，够用）
 *     ·  50%：24 × 10.5 = 252px ⇒ 下方空 **284px（半屏多）**
 *   ⇒ 用户看到「缩小了反而更空」。
 *
 * 而且旧 `fillEditRows` 把「击键让路」放在最前面：
 *   `if (Date.now() - _lastGridTypeAt < 500) { nextFrame(step); return }`
 *   ⇒ 用户点完改单**直接在格子里打字**时，补齐被无限期挡回，下方空白**长期挂着**
 *     （不是闪一下）。这才是缩放后最刺眼的形态。
 *
 * 🔴 判据全部**行为化**：抽源码里真实的三个函数求值，谁把缩放从算式里拿掉就红。
 *   每条都带坏样本自证 —— 只打印 ✅ 的护栏等于没有护栏。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PAGE = path.join(ROOT, 'src/pages/Forecast.vue')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else { console.log('  ❌ ' + label + (extra ? ' ' + extra : '')); failed++ }
}

const src = fs.readFileSync(PAGE, 'utf8')
/** 剥注释：注释里就写着旧公式与实测数字，不剥必假阳性。 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const code = strip(src)

const ROW_H = Number((code.match(/const ROW_H = (\d+)/) || [])[1])
const FIRST = Number((code.match(/const EDIT_FIRST_BATCH = (\d+)/) || [])[1])
const CAP = Number((code.match(/const EDIT_FIRST_CAP = (\d+)/) || [])[1])
const SAFETY_CAP = Number((code.match(/const EDIT_SAFETY_CAP = (\d+)/) || [])[1])

console.log('① 源码结构：三个判定函数必须可抽取（抽不到＝被改写，护栏要同步）')
ok(Number.isFinite(ROW_H) && ROW_H > 0, `ROW_H 可读 = ${ROW_H}`)
ok(Number.isFinite(FIRST) && FIRST > 0, `EDIT_FIRST_BATCH 可读 = ${FIRST}`)
ok(Number.isFinite(CAP) && CAP >= FIRST, `EDIT_FIRST_CAP 可读 = ${CAP}（不得小于首批）`)
ok(Number.isFinite(SAFETY_CAP) && SAFETY_CAP >= CAP, `EDIT_SAFETY_CAP 可读 = ${SAFETY_CAP}`)

/** 按花括号配对抽出一个函数声明（比正则可靠：函数体内有嵌套块）。 */
function pickFn (name) {
  const i = src.indexOf(`function ${name}(`)
  if (i < 0) return ''
  let d = 0, j = i, started = false
  for (; j < src.length; j++) {
    const c = src[j]
    if (c === '{') { d++; started = true } else if (c === '}') { d--; if (started && d === 0) { j++; break } }
  }
  return src.slice(i, j)
}
const fnPer = pickFn('editRowsPerScreen')
const fnFirst = pickFn('editFirstBatch')
const fnFloor = pickFn('editSafetyFloor')
ok(!!fnPer && !!fnFirst && !!fnFloor, '抽到 editRowsPerScreen / editFirstBatch / editSafetyFloor')

/** 用**源码里的真实函数体**求值；editMaxH 用 {value} 桩、zoomScale 由外部注入。 */
function build (h, z) {
  const body = `
    const EDIT_FIRST_BATCH = ${FIRST}, EDIT_FIRST_CAP = ${CAP}, EDIT_SAFETY_CAP = ${SAFETY_CAP};
    const ROW_H = ${ROW_H};
    function zoomScale() { return __z() }
    ${fnPer}
    ${fnFirst}
    ${fnFloor}
    return { per: editRowsPerScreen, first: editFirstBatch, floor: editSafetyFloor }
  `
  return new Function('editMaxH', '__z', body)({ value: h }, () => z)
}

const H = 536          // 真机实测：改单态容器高
const TOTAL = 187      // 真机实测：本期商品行数
const PER_ROW = ROW_H  // CSS zoom 不改布局像素 ⇒ 每行实高 = ROW_H × z

console.log('② 100% 档必须与 v666 逐值一致（不动默认表现）')
{
  const f = build(H, 1)
  ok(f.first() === FIRST, `100% 首批仍 = ${FIRST} 行`, `实际 ${f.first()}`)
  ok(f.floor(TOTAL) === FIRST, `100% 安全线仍 = ${FIRST}（不改补齐节奏）`, `实际 ${f.floor(TOTAL)}`)
}

console.log('③ 缩小档：安全线必须能铺满容器（否则就是报障的留白）')
{
  for (const z of [0.9, 0.8, 0.67, 0.5, 0.4]) {
    const f = build(H, z)
    const floor = f.floor(TOTAL)
    const cover = floor * PER_ROW * z
    ok(cover + 1e-6 >= H, `${(z * 100).toFixed(0)}% 安全线铺满`,
      `${floor} 行 × ${(PER_ROW * z).toFixed(1)}px = ${cover.toFixed(0)}px ≥ ${H}px`)
  }
}

console.log('④ 首批行数随缩小变大，但受成本上限约束（不能回到 500ms+ 长任务）')
{
  const a = build(H, 1).first()
  const b = build(H, 0.5).first()
  ok(b > a, '50% 首批 > 100% 首批', `${a} → ${b}`)
  ok(b <= CAP, `首批 ≤ 上限 ${CAP} 行`, `实际 ${b}`)
  let over = 0
  for (const z of [0.9, 0.8, 0.67, 0.5, 0.4, 0.33]) if (build(H, z).first() > CAP) over++
  ok(over === 0, '所有档位首批都不超过上限（首帧长任务可控）')
}

console.log('⑤ 高度还没量到时必须回退成旧行为（不能算错）')
{
  const f = build(0, 0.5)
  ok(f.first() === FIRST && f.floor(TOTAL) === FIRST,
    'editMaxH=0 ⇒ 首批与安全线都 = 旧常量（等于 v666 行为）',
    `first=${f.first()} floor=${f.floor(TOTAL)}`)
}

console.log('⑥ 总行数少于安全线时取总行数（不能 slice 越界 / 显示不存在的行）')
{
  const f = build(H, 0.4)
  ok(f.floor(10) === 10, 'floor(10) = 10', `实际 ${f.floor(10)}`)
  ok(f.floor(0) === 0, 'floor(0) = 0（无数据不补）', `实际 ${f.floor(0)}`)
}

console.log('⑦ 安全线必须**优先于**击键让路（否则打字时空白长期挂着 —— 报障的刺眼形态）')
{
  const step = (code.match(/const step = \(\) => \{[\s\S]*?\n  \}/) || [''])[0]
  ok(!!step, '找到 fillEditRows 的 step')
  /* 精确判据：**「击键让路」那一行的条件里必须带 needFloor 守卫**。
     旧写法是 `if (Date.now() - _lastGridTypeAt < 500) { nextFrame(step); return }` —— 无条件让路，
     用户点完改单直接在格子里打字时，补齐被无限期挡回 ⇒ 下方空白一直挂着。 */
  const idleM = step.match(/if \(([^\n]*_lastGridTypeAt[^\n]*)\) \{ nextFrame\(step\)/)
  const idleCond = idleM ? idleM[1].trim() : ''
  ok(!!idleM, '找到「击键让路」那一行', idleCond ? `（条件：${idleCond}）` : '')
  ok(/!needFloor/.test(idleCond), '让路条件带 needFloor 守卫（未铺满一屏时不让路）')
  ok(/\?\s*floor\b/.test(step), '未达安全线时一步补到 floor（不是每帧只 +1 批，要好几帧才铺满）')
  // 坏样本：把守卫去掉 = v746 之前的无条件让路 ⇒ 上面那条必须失效
  const badCond = idleCond.replace(/!needFloor\s*&&\s*/, '')
  ok(badCond !== idleCond && !/!needFloor/.test(badCond),
    '坏样本：去掉守卫后判据会报错（不是恒真）')
}

console.log('⑧ 量到容器高 / 缩放变化后必须补一次（首批早于 editMaxH 量到的时序兜底）')
{
  ok(/function _topUpEditRowsForZoom/.test(code), '存在 _topUpEditRowsForZoom')
  const applyH = (code.match(/function _applyEditHeight\(wrap\) \{[\s\S]*?\n\}/) || [''])[0]
  ok(/_topUpEditRowsForZoom\(\)/.test(applyH), '_applyEditHeight 里调了（高度量到即补）')
  const wz = (code.match(/watch\(gridZoom, \(\) => \{[\s\S]*?\n\}\)/) || [''])[0]
  ok(/_topUpEditRowsForZoom\(\)/.test(wz), 'watch(gridZoom) 里调了（改单态缩放后补）')
  const topUp = pickFn('_topUpEditRowsForZoom')
  ok(/editRenderCount\.value >= t\) return/.test(topUp) || /editRenderCount\.value >= \w+\) return/.test(topUp),
    '_topUp 对「已全渲染 / 已铺满」提前返回（不白建行）')
  ok(/editSafetyFloor/.test(topUp), '_topUp 用 editSafetyFloor 决定补到几行')
}

console.log('⑨ 坏样本自证：把缩放从安全线算式里拿掉（= v746 前的定值做法），50% 必须转红')
{
  const badFloor = fnFloor
    .replace(/const floor = Math\.max\(EDIT_FIRST_BATCH, Math\.min\(EDIT_SAFETY_CAP, editRowsPerScreen\(\) \+ 1\)\)/, 'const floor = EDIT_FIRST_BATCH')
  ok(badFloor !== fnFloor, '坏样本确实改动了安全线算式（否则下面的判据无意义）')
  if (badFloor !== fnFloor) {
    const body = `
      const EDIT_FIRST_BATCH = ${FIRST}, EDIT_FIRST_CAP = ${CAP}, EDIT_SAFETY_CAP = ${SAFETY_CAP};
      const ROW_H = ${ROW_H};
      function zoomScale() { return 0.5 }
      ${fnPer}
      ${badFloor}
      return editSafetyFloor
    `
    const bad = new Function('editMaxH', body)({ value: H })(TOTAL)
    const cover = bad * PER_ROW * 0.5
    ok(cover < H, '定值安全线在 50% 时铺不满 ⇒ 判据会报错（不是恒真）',
      `只补到 ${bad} 行 × ${(PER_ROW * 0.5).toFixed(1)}px = ${cover.toFixed(0)}px < ${H}px，空 ${(H - cover).toFixed(0)}px`)
  }
}

if (failed) {
  console.log(`\n❌ v746 改单态首批行数护栏：${failed} 条未通过`)
  process.exit(1)
}
console.log('\n✅ v746 改单态首批行数护栏全部通过')
