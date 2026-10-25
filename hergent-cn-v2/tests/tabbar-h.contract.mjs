/**
 * 全局标签栏高度契约（v677）——「把全局标签栏调矮一点」
 * ---------------------------------------------------------------------------
 * 先明确这块是什么（老板问过它叫什么）：**全局标签栏** = 顶栏正下方那一行
 * 「[⟳] 采购单 × ｜ [⟳] 本期预报 × ｜ …」，语义 = 我打开过哪些页（对齐舟谱），
 * 组件 `components/TabBar.vue`、状态 `composables/useTabs.js`、标题源 `constants/tabTitles.js`。
 * ⚠️ 别与另外三样混：`--topbar-h` 那条是**应用外壳顶栏**（v675）；
 *   `.sb-item` 那条是**侧栏模块条目**（v676/v677）；页面内部的「全部/草稿/已确认」是 `StatusTabs`。
 *
 * 高度构成（整条 = 条目高 + 上下 padding + 底边线 1px）：
 *   v676 及以前：条目 28 + padding 6×2 + 1 = **41px**
 *   v677       ：条目 26 + padding 4×2 + 1 = **35px**（-6px）
 *
 * 🔴 本契约钉三件事，缺一条就会出现"改了但没全改"的假修复：
 *   ① **三处条目高度必须相等**（`.tab-item` / `.tab-more-btn` / `.tab-more-item`）——
 *      「更多」按钮是 `.tabbar` 的 flex 子项，它若仍是 28 就会把整条重新撑到 37px，
 *      而 `.tab-item` 看着是矮的 ⇒ 最容易被误判成"已经改好了"。
 *   ② **推算整条高度落在 [33, 39]**，且 `.tabbar` 不许写死 `height`（同 `.sb-item` 的纪律）。
 *   ③ **`.tab-more-menu` 的 `top` 必须跟条目高同步**（= 条目高 + 6 间隙，容差 ±2）——
 *      它是相对 `.tab-more` 的 `position:absolute`，条目变矮而 top 不改，下拉与条之间会裂开。
 *
 * 🔴 下限 26px：`.tab-ic` 是 16×16、条目 `border-radius:8px` 的圆角要高度 ≥16 才不被切平；
 *   26 − 16 = 10 ⇒ 上下各 5px，已是 12.5px 字号下的合理下限。再矮只能减字号（中文会不可读）。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const SRC = path.join(ROOT, 'src')
const BAR = path.join(SRC, 'components/TabBar.vue')

let pass = 0
let failed = 0
function ok (cond, label, extra) {
  if (cond) { pass++; console.log('     ✅ ' + label) }
  else { failed++; console.log('     ❌ ' + label + (extra ? '  → ' + extra : '')) }
}
const read = (p) => fs.readFileSync(p, 'utf8')
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

const H_MIN = 33
const H_MAX = 39
const ITEM_MIN = 26
const ITEM_MAX = 30
// 条目高 + 这条之间留的缝（`.tab-more-menu` 的 top 相对 `.tab-more` 顶边）
const MENU_GAP = 6
/* 🔴 容差必须写 1 而不是 2：旧值 top:34（条目还是 28 时的正确值）与新值 32 只差 2px，
   容差 2 会让"改了条目高、忘了改 top"这一手**静默通过**（自证时实测漏检过）。 */
const MENU_TOL = 1
const BORDER = 1

console.log('\n=== 全局标签栏高度契约（v677）===')

const s = stripCss(read(BAR))

const ruleOf = (sel) => {
  const m = s.match(new RegExp('\\' + sel.replace(/[.]/g, '.') + '\\s*\\{[^}]*\\}'))
  return m ? m[0] : null
}
const declIn = (rule, name) => {
  if (!rule) return null
  const m = rule.match(new RegExp('[{;\\s]' + name + '\\s*:\\s*([^;}]+)'))
  return m ? m[1].trim() : null
}
const pxOf = (v) => {
  if (!v) return null
  const m = /^(\d+(?:\.\d+)?)px$/.exec(v.trim())
  return m ? Number(m[1]) : null
}

/* ---------- 1. .tabbar：纵向 padding + 不许写死 height ---------- */
const barRule = ruleOf('.tabbar')
ok(!!barRule, 'TabBar.vue 有 .tabbar 规则块')
const barPad = declIn(barRule, 'padding')
// `padding:4px 20px` 是简写 ⇒ 直接取首个数值当纵向值（parseFloat 不会因为后面还有 "20px" 而失败）
const barPadY = barPad ? parseFloat(barPad) : null
ok(barPadY !== null && barPadY >= 3 && barPadY <= 6,
  '`.tabbar` 纵向 padding 落在 3–6px', `现在是：${barPad}`)
ok(declIn(barRule, 'height') === null,
  '⛔ `.tabbar` 不许写死 height（高度必须由条目高 + padding 推出来）',
  '当前写了 height:' + declIn(barRule, 'height'))

/* ---------- 2. 三处条目高度必须相等 ---------- */
const heights = {}
for (const sel of ['.tab-item', '.tab-more-btn', '.tab-more-item']) {
  const r = ruleOf(sel)
  ok(!!r, `TabBar.vue 有 ${sel} 规则块`)
  const h = pxOf(declIn(r, 'height'))
  ok(h !== null && h >= ITEM_MIN && h <= ITEM_MAX,
    `${sel} 高度落在 ${ITEM_MIN}–${ITEM_MAX}px（16px 图标 + 圆角余量）`,
    `现在是：${declIn(r, 'height')}`)
  heights[sel] = h
}
const uniq = [...new Set(Object.values(heights).filter((v) => v !== null))]
ok(uniq.length === 1,
  '⛔ 三处条目高度必须**完全相等**（`.tab-item` / `.tab-more-btn` / `.tab-more-item`）',
  '现在是：' + JSON.stringify(heights) + ' ⇒ 最高的那个会把整条撑回去')

/* ---------- 3. 推算整条高度 ---------- */
const itemH = heights['.tab-item']
if (itemH !== null && barPadY !== null) {
  const total = itemH + barPadY * 2 + BORDER
  ok(total >= H_MIN && total <= H_MAX, `推算整条高度 ${H_MIN}–${H_MAX}px（条目 + 2×paddingY + 1px 底边线）`,
    `现在 = ${itemH} + ${barPadY} × 2 + ${BORDER} = ${total}px`)
}

/* ---------- 4. 「更多」下拉的 top 必须跟条目同步 ---------- */
const menuRule = ruleOf('.tab-more-menu')
ok(!!menuRule, 'TabBar.vue 有 .tab-more-menu 规则块')
const menuTop = pxOf(declIn(menuRule, 'top'))
if (itemH !== null) {
  const want = itemH + MENU_GAP
  ok(menuTop !== null && Math.abs(menuTop - want) <= MENU_TOL,
    `\`.tab-more-menu\` 的 top ≈ 条目高 + ${MENU_GAP}px（±${MENU_TOL}）`,
    `现在 top:${declIn(menuRule, 'top')}，期望 ≈ ${want}px ⇒ 条目变矮而 top 没跟会裂缝`)
}

/* ---------- 5. 别处不许覆写标签栏尺寸 ---------- */
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.vue') || e.name.endsWith('.css')) out.push(p)
  }
  return out
}
const offenders = []
for (const f of walk(SRC)) {
  if (path.resolve(f) === path.resolve(BAR)) continue
  const t = stripCss(read(f))
  for (const m of t.matchAll(/\.(?:tabbar|tab-item|tab-more-btn)\b[^{,]*\{[^}]*\}/g)) {
    offenders.push(path.relative(SRC, f) + ' → ' + m[0].slice(0, 60))
  }
}
ok(offenders.length === 0, '⛔ 标签栏尺寸只许在 TabBar.vue（别在页面里覆写 .tabbar/.tab-item）', offenders.join(' | '))

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + `  (${pass} pass / ${failed} failed)\n`)
process.exit(failed === 0 ? 0 : 1)
