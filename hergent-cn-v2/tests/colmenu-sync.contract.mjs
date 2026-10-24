/* v669 契约：列设置面板的两个缺陷不许回退。
 *
 * 为什么需要它（两条都是「看着对、真实鼠标必现」的隐性缺陷，改动一眼看不出坏）：
 *   ① **全屏遮挡**：`.col-menu` 挂在 `.cross-card` 里，而全屏层 `.grid-area.is-fs` 是
 *      `position:fixed;inset:0;z-index:var(--z-page-fs=1000)` ⇒ 面板的 z 只要低于 1000，
 *      全屏时就被整块白底盖住。生产实测（v668）`elementFromPoint` 三点全命中 `div.pname`。
 *      ⇒ z 必须取变量表的页面级浮层档（`--z-page-overlay/--z-page-menu`），遮罩与本体**成对**。
 *   ② **勾选态不同步**：`@click.prevent` + 单向 `:checked`。Chrome 的 pre-click activation
 *      会在派发 click 之前翻转 `checked`，`preventDefault()` 又让它在派发结束后**还原** ——
 *      这个还原发生在 Vue 的 patch 之后，而 patch 只在 vnode prop 变化时写 DOM ⇒ 永久反相，
 *      只有重开面板（v-if 重建节点）才对齐。真实鼠标必现，JS 的 `el.click()` 不现（探针曾因此漏判）。
 *      ⇒ 一律 `@change`（不 prevent）+ `nextTick` 按状态回写。
 *
 * 只扫模板区（HTML 注释先剥掉）：本仓已有三次「扫全文把注释里的示例当真」的误报。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const CSS = path.join(ROOT, 'src/styles/col-menu.css')
const PANEL = path.join(ROOT, 'src/components/ColMenuPanel.vue')
const FC = path.join(ROOT, 'src/pages/Forecast.vue')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else { console.log('  ❌ ' + label + (extra ? ' ' + extra : '')); failed++ }
}
const read = (p) => fs.readFileSync(p, 'utf8')
/** 剥掉 HTML 注释与 JS/CSS 块注释，只留"会真正执行"的内容 */
const strip = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/* ── ① 层级：面板与遮罩必须成对抬到页面级浮层档 ── */
console.log('① 层级：全屏层(1000) 之上')
{
  const css = strip(read(CSS))
  const ov = css.match(/\.col-menu-overlay\s*\{[^}]*z-index:\s*([^;}]+)/)
  const mn = css.match(/\.col-menu\s*\{[^}]*z-index:\s*([^;}]+)/)
  ok(!!ov && /var\(--z-page-overlay/.test(ov[1]), '遮罩取 --z-page-overlay', ov ? `(${ov[1].trim()})` : '(没找到)')
  ok(!!mn && /var\(--z-page-menu\b/.test(mn[1]), '面板取 --z-page-menu', mn ? `(${mn[1].trim()})` : '(没找到)')
  // 反例：旧的 --z-sticky 档（600+10/11）一旦回来，全屏必然被盖
  ok(!/calc\(var\(--z-sticky[^)]*\)\s*\+\s*1[01]\)/.test(css), '不再使用 --z-sticky 派生档')
  // 令牌本身必须高于全屏层（变量表若改档，这里会先炸）
  const vars = strip(read(path.join(ROOT, 'src/styles/variables.css')))
  const fsZ = Number((vars.match(/--z-page-fs:\s*(\d+)/) || [])[1])
  const menuZ = Number((vars.match(/--z-page-menu:\s*(\d+)/) || [])[1])
  const ovZ = Number((vars.match(/--z-page-overlay:\s*(\d+)/) || [])[1])
  ok(fsZ > 0 && menuZ > fsZ, `--z-page-menu(${menuZ}) > --z-page-fs(${fsZ})`)
  ok(fsZ > 0 && ovZ > fsZ, `--z-page-overlay(${ovZ}) > --z-page-fs(${fsZ})`)
  ok(menuZ > ovZ, `面板(${menuZ}) > 遮罩(${ovZ})（本体压在自己的遮罩上）`)
}

/* ── ② 复选框：不许回到 `@click.prevent` + 单向 :checked ── */
console.log('② 复选框：@change + 状态回写')
{
  const fc = strip(read(FC))
  const panel = strip(read(PANEL))
  // `@click.prevent="toggleCol(...)"` 是缺陷写法本身 —— 两个文件都不许再出现
  ok(!/@click\.prevent\s*=\s*"\s*toggleCol\s*\(/.test(fc), 'Forecast.vue 不再用 @click.prevent="toggleCol(...)"')
  ok(!/@click\.prevent\s*=\s*"\s*toggleCol\s*\(/.test(panel), 'ColMenuPanel.vue 不再用 @click.prevent="toggleCol(...)"')
  // 必须有 @change 入口，且数量与「列设置复选框」出现次数一致（查看态 + 改单态 = 2）
  const fcBoxes = [...fc.matchAll(/<input[^>]*type="checkbox"[^>]*colVis\[/g)].length
  const fcChange = [...fc.matchAll(/@change="onColCheck\(/g)].length
  ok(fcBoxes >= 2, 'Forecast.vue 里列设置复选框 ≥2 处（查看态 + 改单态）', `(${fcBoxes})`)
  ok(fcChange === fcBoxes, '每一处都挂 @change="onColCheck(...)"', `(${fcChange}/${fcBoxes})`)
  ok(/@change="onCheck\(/.test(panel), 'ColMenuPanel.vue 挂 @change="onCheck(...)"')
  // 回写必须真的写 DOM（否则「状态没变但 DOM 被浏览器翻过」的残余情况没人纠正）
  const fcWrite = fc.match(/function\s+onColCheck\s*\([^)]*\)\s*\{[\s\S]*?\n\}/)
  ok(!!fcWrite && /nextTick\(/.test(fcWrite[0]) && /\.checked\s*=/.test(fcWrite[0]),
    'Forecast.vue::onColCheck 在 nextTick 里回写 el.checked')
  const pWrite = panel.match(/function\s+onCheck\s*\([^)]*\)\s*\{[\s\S]*?\n\}/)
  ok(!!pWrite && /nextTick\(/.test(pWrite[0]) && /\.checked\s*=/.test(pWrite[0]),
    'ColMenuPanel.vue::onCheck 在 nextTick 里回写 el.checked')
  // 回写的值必须来自状态（colVis / isVisible），不能写死
  ok(!!fcWrite && /colVis\.value\[[^\]]+\]\s*!==\s*false/.test(fcWrite[0]), 'Forecast 回写值取自 colVis（不写死）')
  ok(!!pWrite && /isVisible\(/.test(pWrite[0]), 'ColMenuPanel 回写值取自 isVisible（不写死）')
}

console.log(failed === 0 ? '\n  ALL PASS' : `\n  FAILED(${failed})`)
process.exit(failed === 0 ? 0 : 1)
