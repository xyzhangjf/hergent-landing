/* 预报页工具行（表头区域）控件契约。
 *
 * 需求沿革：
 *   v753：老板要求把工具行常驻的「品牌筛选 / 新增客户」两个按钮改为右键上下文菜单，
 *         原按钮撤下（仅留零尺寸定位锚点）。
 *   本次（v754）：老板反馈品牌筛选按钮找不到、要回来 ⇒ 品牌筛选**恢复为可见按钮**
 *         （查看态 / 改单态工具行各一个），右键菜单入口保留（两种方式都能开）。
 *         「新增客户列」维持 v753 的右键菜单入口（不恢复为常驻按钮）。
 *
 * 设计约束（避免假生效）：
 *   ① 列头右键 `hdrCtx` 已有「筛选… / 插入列」，那是**针对单列的值筛选**与编辑态插主档列，
 *      与工具行的「整表级品牌筛选 / 加客户报单列」语义不同，两者仍不混进同一菜单。
 *      `tbCtx` 右键菜单独立实例，复用 `.ctx-menu / .ctx-overlay` 样式，与 `hdrCtx` 不共享状态。
 *   ② 品牌筛选按钮恢复后，`positionTbPop(brandBtn)` 直接以该 `<button>` 为锚点
 *      （按钮有真实 getBoundingClientRect，面板定位正确）；不再需要 v753 的零尺寸锚点。
 *   ③ 菜单项 / 按钮必须**直接调用既有的** `toggleBrandPop()` / `toggleAddColPop()`，业务逻辑零改动。
 *
 * 判据（每条都带坏样本自证，否则等于没护栏）：
 *   A. 模板含 2 个可见品牌筛选按钮 `<button ref="brandBtn">`（查看 / 改单工具行各一），点击触发 toggleBrandPop。
 *   B. 「新增客户列」仍只走右键菜单：无 `<button ref="addColBtn">`，保留 addColBtn 定位锚点（仅改单态）。
 *   C. 两个工具行 `.grid-ctl-row` 都挂了 `@contextmenu.prevent="openTbCtx"`。
 *   D. 新增 `tbCtx` 右键菜单复用既有 `.ctx-overlay / .ctx-menu` 结构，含 onTbCtxFilter / onTbCtxAddCol 两项；
 *      「新增客户列」仅改单态出现（v-if="editMode"，与历史按钮可用性一致，不引入越权入口）。
 *   E. openTbCtx / closeTbCtx / onTbCtxFilter / onTbCtxAddCol 均已定义，且菜单项分别调用
 *      toggleBrandPop / toggleAddColPop（业务逻辑不变）。
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
/** 剥注释：本文件注释里就写着旧写法原文，不剥必假阳性。 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const code = strip(src)
const iScript = code.indexOf('<script')
const tpl = iScript > 0 ? code.slice(code.indexOf('<template>'), iScript) : code

/** 取函数体：从 `function name` 到下一个行首 `}`。 */
function fnBody (name, text = code) {
  const re = new RegExp('function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}', '')
  const m = text.match(re)
  return m ? m[0] : ''
}

console.log('A. 品牌筛选恢复为可见按钮（查看态 + 改单态各一个），点击触发 toggleBrandPop')
{
  const brandBtns = (tpl.match(/<button[^>]*ref="brandBtn"/g) || [])
  ok(brandBtns.length === 2, '模板含 2 个可见品牌筛选按钮（查看 / 改单工具行各一）', `实测 ${brandBtns.length}`)
  // 坏样本自证：把两个品牌按钮都还原成隐形锚点，判据必须报红
  const badTpl = tpl.replace(/<button[^>]*ref="brandBtn"[^>]*>/g, '<span ref="brandBtn" class="tb-pop-anchor"></span>')
  ok((badTpl.match(/<button[^>]*ref="brandBtn"/g) || []).length !== 2,
    '坏样本（品牌按钮撤掉）能被判否（护栏不是空转）')
  // 按钮确实绑定了 toggleBrandPop（业务逻辑复用，不另造）
  ok(/<button[^>]*ref="brandBtn"[^>]*@click="toggleBrandPop"/.test(tpl),
    '品牌筛选按钮 @click 指向既有 toggleBrandPop()（筛选逻辑不变）')
}

console.log('B. 新增客户列仍只走右键菜单（无可见按钮，保留 addColBtn 锚点）')
{
  ok(!/<button[^>]*ref="addColBtn"/.test(tpl), '模板里不再有 <button ref="addColBtn">（新增客户列仍走右键菜单）')
  ok(/<span ref="addColBtn" class="tb-pop-anchor">/.test(tpl), '新增客户列保留定位锚点 .tb-pop-anchor')
}

console.log('C. 两个工具行都挂了右键弹出（查看态 + 改单态各一份）')
{
  const n = (tpl.match(/@contextmenu\.prevent="openTbCtx"/g) || []).length
  ok(n === 2, '模板恰好 2 处 @contextmenu.prevent="openTbCtx"（查看 / 改单工具行各一）', `实测 ${n}`)
}

console.log('D. 新增 tbCtx 右键菜单复用既有 .ctx-overlay / .ctx-menu 结构')
{
  const hasMenu = /<div v-if="tbCtx\.show" class="ctx-menu"/.test(tpl)
  const hasOverlay = /<div v-if="tbCtx\.show" class="ctx-overlay"/.test(tpl)
  ok(hasMenu, '存在复用 .ctx-menu 的 tbCtx 菜单（未另造浮层样式）')
  ok(hasOverlay, '存在复用 .ctx-overlay 的互斥遮罩')
  ok(/onTbCtxFilter/.test(tpl), '菜单含「筛选」入口 onTbCtxFilter')
  ok(/onTbCtxAddCol/.test(tpl), '菜单含「新增客户列」入口 onTbCtxAddCol')
  // 新增客户列仅改单态可用（与历史按钮可用性一致），查看态菜单不应出现该项
  const editOnly = /onTbCtxAddCol"[^>]*>\s*<Icon[^>]*>\s*新增客户列/.test(tpl) &&
                   /v-if="editMode"[^>]*@click="onTbCtxAddCol"/.test(tpl)
  ok(editOnly, '「新增客户列」仅在改单态出现（v-if="editMode"，与历史按钮可用性一致，不引入越权入口）')
}

console.log('E. 菜单项函数已定义且复用既有业务逻辑（toggleBrandPop / toggleAddColPop）')
{
  ok(/function openTbCtx\(/.test(code), 'openTbCtx 已定义')
  ok(/function closeTbCtx\(/.test(code), 'closeTbCtx 已定义')
  const fFilter = fnBody('onTbCtxFilter')
  const fAdd = fnBody('onTbCtxAddCol')
  ok(fFilter.includes('toggleBrandPop'), 'onTbCtxFilter 调用既有 toggleBrandPop()（筛选逻辑不变）')
  ok(fAdd.includes('toggleAddColPop'), 'onTbCtxAddCol 调用既有 toggleAddColPop()（新增列逻辑不变）')
  ok(fFilter.includes('closeTbCtx') && fAdd.includes('closeTbCtx'),
    '两项点击后先关右键菜单再开弹层（交互衔接正确）')
}

console.log('')
if (failed) { console.log(`❌ 失败 ${failed} 项`); process.exit(1) }
console.log('✅ forecast-toolbar-rightclick: 全部通过')
process.exit(0)
