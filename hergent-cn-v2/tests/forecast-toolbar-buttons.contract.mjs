/* 预报页工具行（表头区域）控件契约。
 *
 * 需求沿革（三次反转，每次都必须同批改护栏，否则 npm test 会红且它红得对）：
 *   v753：老板要求把工具行常驻的「品牌筛选 / 新增客户」两个按钮改为右键上下文菜单，
 *         原按钮撤下、只留零尺寸定位锚点 `.tb-pop-anchor`。
 *   v754：品牌筛选恢复为可见按钮（老板找不到入口），右键菜单入口暂留。
 *   v755（本次）：① 「新增客户列」也恢复为可见按钮；② 两个按钮都有了 ⇒ 工具行右键菜单
 *         整体撤除（老板原话「现在有筛选品牌按钮了，右键点击表头可筛选品牌这个入口就不需要了」）。
 *
 * 判据（每条都带坏样本自证，否则等于空白支票）：
 *   A. 模板含 2 个可见品牌筛选按钮 `<button ref="brandBtn">`（查看 / 改单工具行各一），
 *      点击调用既有 toggleBrandPop()。
 *   B. 模板含 1 个可见「新增客户列」按钮 `<button ref="addColBtn">`（仅改单态——查看态不能加列），
 *      点击调用既有 toggleAddColPop()。
 *   C. 工具行右键菜单已整体撤除：无 `openTbCtx` / `tbCtx`，`.grid-ctl-row` 上无 `@contextmenu`。
 *   D. 🔴 **表体单元格右键 `onTbCtx` 不受影响**（这两件事同名不同物，撤 A 绝不能顺手删 B）：
 *      `onTbCtx` 是 v377 起的「表体右键路由」（单元格/行/列菜单），与工具行菜单无关。
 *   E. 无遗留零尺寸定位锚点 `.tb-pop-anchor`：按钮自带真实 getBoundingClientRect，
 *      positionTbPop 直接以按钮为锚点即可，锚点类留在模板里就是幽灵元素。
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
/** 剥注释：本文件注释与页面注释里就写着旧写法原文，不剥必假阳性。 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const code = strip(src)
const iScript = code.indexOf('<script')
const tpl = iScript > 0 ? code.slice(code.indexOf('<template>'), iScript) : code

console.log('A. 品牌筛选是可见按钮（查看态 + 改单态各一），点击触发 toggleBrandPop')
{
  const n = (tpl.match(/<button[^>]*ref="brandBtn"/g) || []).length
  ok(n === 2, '模板含 2 个可见品牌筛选按钮（查看 / 改单工具行各一）', `实测 ${n}`)
  ok(/<button[^>]*ref="brandBtn"[^>]*@click="toggleBrandPop"/.test(tpl),
    '品牌按钮 @click 指向既有 toggleBrandPop()（筛选逻辑不变）')
  // 坏样本自证：把两个品牌按钮的开标签还原成隐形锚点，判据必须报红
  const bad = tpl.replace(/<button([^>]*ref="brandBtn"[^>]*)>/g, '<span$1>')
  ok((bad.match(/<button[^>]*ref="brandBtn"/g) || []).length === 0,
    '坏样本（品牌按钮撤成隐形锚点）能被判否（护栏不是空转）')
}

console.log('B. 「新增客户列」是可见按钮（改单态一处），点击触发 toggleAddColPop')
{
  const n = (tpl.match(/<button[^>]*ref="addColBtn"/g) || []).length
  ok(n === 1, '模板含 1 个可见「新增客户列」按钮（仅改单态，查看态不可加列）', `实测 ${n}`)
  ok(/<button[^>]*ref="addColBtn"[^>]*@click="toggleAddColPop"/.test(tpl),
    '新增客户列按钮 @click 指向既有 toggleAddColPop()（加列逻辑不变）')
  const bad = tpl.replace(/<button([^>]*ref="addColBtn"[^>]*)>/g, '<span$1>')
  ok((bad.match(/<button[^>]*ref="addColBtn"/g) || []).length === 0,
    '坏样本（新增客户列按钮撤成隐形锚点）能被判否')
}

console.log('C. 工具行右键菜单已整体撤除（两个按钮都有了，右键入口重复）')
{
  ok(!/openTbCtx/.test(code), '无 openTbCtx（右键菜单打开函数已删）')
  ok(!/\btbCtx\b/.test(code), '无 tbCtx 状态 / 菜单模板（整体撤除，不留半套）')
  const n = (tpl.match(/<div[^>]*class="grid-ctl-row"[^>]*@contextmenu/g) || []).length
  ok(n === 0, '两个 .grid-ctl-row 都不再挂 @contextmenu', `实测 ${n}`)
  // 坏样本自证：把挂载加回去必须被判否
  const bad = tpl.replace('<div class="grid-ctl-row">',
    '<div class="grid-ctl-row" @contextmenu.prevent="openTbCtx">')
  ok((bad.match(/<div[^>]*class="grid-ctl-row"[^>]*@contextmenu/g) || []).length > 0,
    '坏样本（工具行重新挂上右键）能被判否')
}

console.log('D. 🔴 表体单元格右键 onTbCtx 不受影响（同名不同物，撤工具行菜单不得误删它）')
{
  ok(/@contextmenu\.prevent="onTbCtx"/.test(tpl),
    '表格仍挂 @contextmenu.prevent="onTbCtx"（v377 表体右键路由：单元格/行/列菜单）')
  ok(/function onTbCtx\(/.test(code), 'onTbCtx 函数定义仍在')
  // 坏样本自证：把它一起删掉必须被判否 —— 这正是"撤右键"最容易误伤的地方
  const bad = tpl.replace(/@contextmenu\.prevent="onTbCtx"/g, '')
  ok(!/@contextmenu\.prevent="onTbCtx"/.test(bad), '坏样本（表体右键被误删）能被判否')
}

console.log('E. 无遗留零尺寸锚点（按钮自带真实矩形，positionTbPop 直接以按钮为锚点）')
{
  ok(!/class="tb-pop-anchor"/.test(tpl), '模板中无 .tb-pop-anchor 幽灵元素')
  ok(!/\.tb-pop-anchor\s*\{/.test(code), 'CSS 中无 .tb-pop-anchor 死规则')
}

console.log('')
if (failed) { console.log(`❌ 失败 ${failed} 项`); process.exit(1) }
console.log('✅ forecast-toolbar-buttons: 全部通过')
process.exit(0)
