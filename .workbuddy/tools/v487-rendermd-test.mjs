/**
 * v487 本地逻辑探针（只读、零网络）：直接对真实 src/utils/md.js 的 renderMd 做单元断言。
 *
 * 覆盖：
 *   P2-③ 表格→图表：数值列≥2 且数据行≥3 时才出现「看图表」开关 + 内联 SVG 图表；
 *                    否则（数值列<2）不出现开关。
 *   P2-⑦ 内联控件：[[control: slider|...]] → <input type=range class=md-control-range>，
 *                   [[control: switch|...|on/off]] → <button class="md-switch [on]">。
 *   P1 回归：粗体/行内代码等既有行内格式不受影响。
 *
 * md.js 依赖 useCardTrigger.stripAllFences（仅首行 stripAllFences(src) 一处调用），
 * 用恒等 stub 即可，避免引入 Vue/Pinia 重依赖，保证纯 Node 可跑。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const MD_SRC = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/utils/md.js'
const TMP = '/tmp/v487-md-mod.mjs'

let src = readFileSync(MD_SRC, 'utf8')
// 去掉唯一的 import（stripAllFences 来自 useCardTrigger，纯 Node 跑需剥离）
src = src.replace(/^\s*import\s*\{[^}]*\}\s*from\s*['"][^'"]*['"]\s*$/m, '')
// 前置恒等 stub
src = "const stripAllFences = (s) => s\n" + src

writeFileSync(TMP, src, 'utf8')
const { renderMd } = await import(pathToFileURL(TMP).href)

const R = []
const ok = (name, cond, detail = '') => R.push({ name, pass: !!cond, detail: String(detail) })

const TABLE_OK = `| 月份 | 销量 | 退货 |
| --- | --- | --- |
| 1月 | 120 | 5 |
| 2月 | 135 | 8 |
| 3月 | 110 | 3 |`

const TABLE_NOCHART = `| 月份 | 销量 | 备注 |
| --- | --- | --- |
| 1月 | 120 | 好 |
| 2月 | 135 | 一般 |
| 3月 | 110 | 差 |`

const CTRL_SLIDER = `调一下参数：[[control: slider|温度|0|100|1|50]] 看看`
const CTRL_SW_ON = `开关状态：[[control: switch|自动续费|on]]`
const CTRL_SW_OFF = `开关状态：[[control: switch|自动续费|off]]`

// ---- P2-③ 表格→图表（正向）----
const r1 = renderMd(TABLE_OK)
ok('③ 数值列≥2+行≥3 → 出现「看图表」按钮', r1.includes('md-table-chart-toggle'), r1.slice(0, 80))
ok('③ 出现内联图表容器 md-table-chart', r1.includes('md-table-chart'))
ok('③ 图表含折线 polyline', r1.includes('polyline'))

// ---- P2-③（反向）----
const r2 = renderMd(TABLE_NOCHART)
ok('③ 数值列<2 → 不出现「看图表」按钮', !r2.includes('md-table-chart-toggle'))

// ---- P2-⑦ 滑块 ----
const r3 = renderMd(CTRL_SLIDER)
ok('⑦ 滑块渲染为 input.md-control-range', r3.includes('md-control-range'))
ok('⑦ 滑块初值 value="50"', r3.includes('value="50"'))
ok('⑦ 滑块 label=温度', r3.includes('data-label="温度"'))

// ---- P2-⑦ 开关 on/off ----
const r4 = renderMd(CTRL_SW_ON)
ok('⑦ 开关 on → class 含 on', r4.includes('md-switch on') && r4.includes('aria-checked="true"'))
const r5 = renderMd(CTRL_SW_OFF)
// 关态：class 含 md-switch（且不以 on 结尾）、aria-checked=false
ok('⑦ 开关 off → 无 on / aria-checked=false', r5.includes('md-switch') && r5.includes('aria-checked="false"') && !r5.includes('md-switch on'))

// ---- P1 回归：既有行内格式 ----
const r6 = renderMd('这是 **粗体** 与 `代码` 还有 *斜体*')
ok('回归 粗体仍渲染 <b>', r6.includes('<b>粗体</b>'))
ok('回归 行内代码仍渲染 <code>', r6.includes('<code class="md-code">代码</code>'))

console.log('\n===== v487 renderMd 单元断言 =====')
let n = 0
for (const r of R) {
  console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   ← ' + r.detail))
  n += r.pass ? 1 : 0
}
console.log('---- ' + n + '/' + R.length + ' 通过 ----')
process.exit(n === R.length ? 0 : 1)
