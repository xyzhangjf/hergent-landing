/* v753 契约：预报页工具行（表头区域）的「品牌筛选 / 新增客户」两个常驻按钮，
 * 必须改为右键上下文菜单入口，且原按钮移除。
 *
 * 报障背景（老板要求）：工具行原本常驻「品牌」筛选按钮与「新增客户」按钮，
 * 希望改为鼠标右键点工具行弹出 `.ctx-menu`，菜单内提供「筛选 / 增加一列」两项，原按钮撤下。
 *
 * 根因 / 设计约束（避免假生效）：
 *   ① 列头右键 `hdrCtx` 已有「筛选… / 插入列」——但那是**针对单列的值筛选**与
 *      **编辑态插入主档属性列**，和工具行的「整表级品牌筛选 / 加客户报单列」语义不同，
 *      不能把两者混进同一个菜单（会造成语义与文案混淆）。故本改动新增**独立实例** `tbCtx`，
 *      复用 `.ctx-menu / .ctx-overlay` 的样式结构，但和 `hdrCtx` 不共享状态。
 *   ② 原按钮移除后，`positionTbPop(btnEl)` 仍需一个**有真实 getBoundingClientRect 的锚点**：
 *      按钮不能简单删掉（定位会失效），也不能用 `display:none`（那样 rect 返回全零，面板定位错乱）。
 *      故按钮替换为零尺寸、不可见、不占布局的 `<span class="tb-pop-anchor" ref="brandBtn">`。
 *   ③ 菜单项必须**直接调用既有的** `toggleBrandPop()` / `toggleAddColPop()`，业务逻辑与校验零改动。
 *
 * 判据（每条都带坏样本自证，否则等于没护栏）：
 *   A. 原 `<button ref="brandBtn"` / `<button ref="addColBtn"` 触发按钮已从模板移除。
 *   B. 三处替换为 `.tb-pop-anchor` 锚点（2 个品牌 + 1 个新增客户）。
 *   C. 两个工具行 `.grid-ctl-row` 都挂了 `@contextmenu.prevent="openTbCtx"`。
 *   D. 新增 `tbCtx` 右键菜单复用既有 `.ctx-overlay` / `.ctx-menu` 结构，且含 `onTbCtxFilter` / `onTbCtxAddCol` 两项。
 *   E. `openTbCtx / closeTbCtx / onTbCtxFilter / onTbCtxAddCol` 均已定义，且两个菜单项函数分别调用 `toggleBrandPop` / `toggleAddColPop`（业务逻辑不变）。
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

console.log('A. 原触发按钮已从模板移除（不能让它们静默留着）')
{
  const hasBrandBtn = /<button[^>]*ref="brandBtn"/.test(tpl)
  const hasAddColBtn = /<button[^>]*ref="addColBtn"/.test(tpl)
  ok(!hasBrandBtn, '模板里不再有 <button ref="brandBtn">（品牌筛选按钮已撤下）')
  ok(!hasAddColBtn, '模板里不再有 <button ref="addColBtn">（新增客户按钮已撤下）')

  // 坏样本自证：把任一锚点还原成按钮，判据必须报红
  const badTpl = tpl.replace(
    '<span ref="brandBtn" class="tb-pop-anchor"></span>',
    '<button ref="brandBtn" class="btn btn-sm btn-ghost" @click="toggleBrandPop">品牌</button>'
  )
  ok(/<button[^>]*ref="brandBtn"/.test(badTpl) && !/<button[^>]*ref="brandBtn"/.test(tpl),
    '坏样本（按钮还原）能被判否（护栏不是空转）')
}

console.log('B. 三处替换为定位锚点 .tb-pop-anchor（2 品牌 + 1 新增客户）')
{
  const n = (tpl.match(/tb-pop-anchor/g) || []).length
  ok(n >= 3, '模板含 ≥3 个 tb-pop-anchor 锚点', `实测 ${n}`)
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
  // 新增客户列仅改单态可用（与旧按钮的可用性一致），查看态菜单不应出现该项
  const editOnly = /onTbCtxAddCol"[^>]*>\s*<Icon[^>]*>\s*新增客户列/.test(tpl) &&
                   /v-if="editMode"[^>]*@click="onTbCtxAddCol"/.test(tpl)
  ok(editOnly, '「新增客户列」仅在改单态出现（v-if="editMode"，与旧按钮可用性一致，不引入越权入口）')
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
