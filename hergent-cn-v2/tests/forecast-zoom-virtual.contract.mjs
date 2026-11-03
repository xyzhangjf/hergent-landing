/* v745 契约：表格缩放后，虚拟滚动的渲染窗口必须跟着变，否则缩小就「只渲染半屏 + 下面大片留白」。
 *
 * 报障原话：「点击缩放按钮缩小网格后，显示的行数最多只有 20 行，导致下方出现大量留白。」
 *
 * 根因（坐标系混用）：`.cross-tbl` 整体带 `zoom: gridZoom%`（模板内联），于是同一屏并存两套像素：
 *   · **缩放后**：容器 `scrollTop` / `scrollHeight`（容器 clientHeight 本身不变）
 *   · **未缩放**：`ROW_H` 等行高常量、`vsOffsets` 累加值、`vs-spacer` 的 height
 *     （spacer 在 zoom 内部，写未缩放值、渲染时被再压一次 —— 那是对的）
 *   旧代码把 `scrollTop + viewportH` 直接当成未缩放的"可见下沿" ⇒ 50% 时窗口只覆盖半个屏
 *   ⇒ 只挂一半行、下半屏全是 spacer 空白。
 *   `v581` 的注释里早写过同一族坑：「一旦与实际渲染高度不符，就会出现『只渲染 N 行 + 表体底部
 *   一大片空白』」—— 只是当时没把 zoom 算进"实际渲染高度"。
 *
 * 🔴 本护栏用**行为断言**（抽真实源码里的 lo/hi 表达式求值），不是查字符串：
 *   只要"缩放 50% 时窗口行数 ≥ 容器能放的行数"不成立就红。
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
/** 剥注释：注释里就写着旧写法与公式说明，不剥必假阳性。 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const code = strip(src)

const ROW_H = Number((code.match(/const ROW_H = (\d+)/) || [])[1])
const OVER = Number((code.match(/const OVER = (\d+)/) || [])[1])
const VSCROLL_MIN = Number((code.match(/const VSCROLL_MIN = (\d+)/) || [])[1])
const TOTAL = 187            // 截图实测「共 187 行」（> VSCROLL_MIN，走虚拟滚动）
const VH = 420               // 容器可视高（保守取小值；越小越容易暴露"窗口不够"）

const loM = code.match(/const lo = (.+)\n\s*const hi = (.+)\n/)
const loExpr = loM && loM[1].trim()
const hiExpr = loM && loM[2].trim()

console.log('① 源码结构：虚拟滚动的窗口边界必须可抽取（抽不到就说明被改写了，护栏要同步）')
ok(Number.isFinite(ROW_H) && ROW_H > 0, `ROW_H 可读 = ${ROW_H}`)
ok(Number.isFinite(OVER) && OVER >= 0, `OVER 可读 = ${OVER}`)
ok(Number.isFinite(VSCROLL_MIN), `VSCROLL_MIN 可读 = ${VSCROLL_MIN}`)
ok(!!loExpr && !!hiExpr, '抽到 vsWindow 的 lo / hi 表达式', loExpr ? `（lo: ${loExpr}）` : '')

/** 用**源码里的真实表达式**求 lo/hi；z/zoom/zs 三个别名都喂同一个值（防改名后抽不动）。 */
const buildCalc = (lo, hi) =>
  new Function('scrollTop', 'viewportH', 'OVER', 'ROW_H', 'z', 'zoom', 'zs',
    `return [${lo}, ${hi}]`)

/** 窗口渲染行数（复刻源码未改动的二分边界）。 */
function windowRows (calc, vh, z, st) {
  const [lo, hi] = calc({ value: st }, { value: vh }, OVER, ROW_H, z, z, z)
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error(`NaN 边界：lo=${lo} hi=${hi}`)
  const off = [0]
  for (let i = 0; i < TOTAL; i++) off.push(off[i] + ROW_H)
  let a = 0, b = TOTAL
  while (a < b) { const mid = (a + b) >> 1; if (off[mid + 1] < lo) a = mid + 1; else b = mid }
  const start = a
  a = start; b = TOTAL
  while (a < b) { const mid = (a + b) >> 1; if (off[mid] < hi) a = mid + 1; else b = mid }
  return a - start
}

const visibleRows = (z) => Math.floor(VH / (ROW_H * z))

console.log('② 行为断言：每个缩放档位，渲染窗口都必须 ≥ 容器能放的行数（否则就是留白）')
if (loExpr && hiExpr) {
  let calc
  try { calc = buildCalc(loExpr, hiExpr) } catch (e) { calc = null; ok(false, '表达式可求值', e.message) }
  if (calc) {
    // 顶部 / 中间 / 底部 三个滚动位置都验（底部最容易漏：spacer 会被压扁）
    const ZS = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 1.5, 2]
    for (const z of ZS) {
      const v = visibleRows(z)
      const maxSt = Math.max(0, TOTAL * ROW_H * z - VH)
      const spots = [
        ['顶部', 0],
        ['中间', Math.round(maxSt / 2)],
        ['底部', Math.round(maxSt)],
      ]
      const worst = Math.min(...spots.map(([, st]) => windowRows(calc, VH, z, st)))
      ok(worst >= v, `${(z * 100).toFixed(0)}% 铺满`,
        `能放 ${v} 行 · 最少渲染 ${worst} 行`)
    }
  }

  console.log('③ 坏样本自证：把坐标系换回旧写法（不除 z），50% 必须转红')
  {
    // 去掉表达式里的 `/ z`（含 `/ zoom` `/ zs` 等别名写法），即 v745 之前的旧公式
    const badLo = loExpr.replace(/\/\s*(z|zoom|zs)\b/g, '')
    const badHi = hiExpr.replace(/\/\s*(z|zoom|zs)\b/g, '')
    const changed = badLo !== loExpr || badHi !== hiExpr
    ok(changed, '坏样本确实改动了表达式（否则下面的判据无意义）')
    if (changed) {
      const badCalc = buildCalc(badLo, badHi)
      const v = visibleRows(0.5)
      const n = windowRows(badCalc, VH, 0.5, 0)
      ok(n < v, '旧写法在 50% 时窗口不足 ⇒ 判据会报错（不是恒真）',
        `能放 ${v} 行 · 只渲染 ${n} 行 · 留白 ${v - n} 行`)
    }
  }
}

console.log('④ 「滚到某商品」的落点也必须换算坐标系（同一族坑）')
{
  const seg = (code.match(/function scrollToIndex\(ri\) \{[\s\S]*?\n\}/) || [''])[0]
  ok(!!seg, '找到 scrollToIndex')
  ok(/\*\s*(z|zoomScale\(\))/.test(seg), '落点按 z 换算（off/h 是未缩放、scrollTop 是缩放后）')
  // 坏样本：把乘法去掉（旧写法），判据必须报错
  const bad = seg.replace(/\*\s*z\b/g, '').replace(/\*\s*zoomScale\(\)/g, '')
  ok(!/\*\s*(z|zoomScale\(\))/.test(bad), '坏样本：落点不换算时判据报错')
}

console.log('⑤ 改缩放不能让虚拟窗口停在越界位置（scrollHeight 会随 z 变）')
{
  ok(/watch\(gridZoom/.test(code), '存在 watch(gridZoom) 夹回滚动位置')
}

if (failed) {
  console.log(`\n❌ v745 缩放留白护栏：${failed} 条未通过`)
  process.exit(1)
}
console.log('\n✅ v745 缩放留白护栏全部通过')
