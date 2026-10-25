/**
 * 侧栏条目高度契约（v676）——「侧边栏各功能模块的导航栏也有点高」
 * ---------------------------------------------------------------------------
 * 反馈原话：「顶部导航栏也有点高，就是侧边栏各功能模块的导航栏」。
 *
 * 事实：侧栏一级模块（`Shell.vue` 的 `.sb-item`，12 项）高度 = **line-height + 上下 padding**，
 *   从来没设过 `height`。改前 `padding:9px 10px` + 13px/行高 1.6 ⇒ **38.8px**，
 *   而职能区按钮（`.sb-item.sb-area-btn`）因为一条 `.sb-area-btn{font:inherit}`（**font 简写**）
 *   把 font-size 冲回 body 的 14px ⇒ 行高 22.4 ⇒ **40.4px**。
 *   ⇒ 同一列里两种行高（38.8 / 40.4），且 12 项吃掉 485px。
 *
 * v676 修法（三件事，缺一条就再分叉）：
 *   ① `.sb-item` 显式 `line-height:20px` —— 不写的话平铺项走继承 1.6、
 *      `<button>` 走 UA 的 `line-height:normal`，仍是两种行高（实测 34.8 / 32，更参差）；
 *   ② `.sb-area-btn` 的 `font:inherit` 改 `font-family:inherit` —— 只换字体族，字号交回 `.sb-item`；
 *   ③ 纵向 padding 9 → 7 ⇒ 20 + 14 = **34px**，12 项 408px（省 77px）。
 *
 * 🔴 本契约钉「高度必须由 line-height + padding 推出来、且两种条目归一」，不钉某个魔数：
 *      推算高度 ∈ [37, 40]，纵向 padding ∈ [6, 9]，行高 ∈ [18, 22]px。
 *   这样 6.5→7 之类的微调不会被拦，被拦的是"回到松档 / 又分叉 / 写死 height"。
 *
 * v677（2026-10-25）：老板看 34px 觉得太挤，要求**恢复到 v676 之前的高度** ⇒
 *   `padding` 7 → 9、`line-height` 20px → 1.6(=20.8px) ⇒ 回到 **38.8px**。
 *   ⚠️ 只恢复高度、**不回滚 v676 的两个缺陷修复**（行高仍显式、`.sb-area-btn` 仍是
 *      `font-family:inherit`）—— 否则又会回到"平铺 38.8 / 职能区 40.4"的混排。
 *   ⇒ 故本契约的高度区间跟着上移到 [37, 40]；若再往回收（如 34），需同步改这里，
 *      不许为了过测试而放宽到把"松档"也放进来。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const SRC = path.join(ROOT, 'src')
const SHELL = path.join(SRC, 'components/Shell.vue')

let pass = 0
let failed = 0
function ok (cond, label, extra) {
  if (cond) { pass++; console.log('     ✅ ' + label) }
  else { failed++; console.log('     ❌ ' + label + (extra ? '  → ' + extra : '')) }
}
const read = (p) => fs.readFileSync(p, 'utf8')
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

const H_MIN = 37
const H_MAX = 40
const PAD_MIN = 6
const PAD_MAX = 9

console.log('\n=== 侧栏条目高度契约（v676 建 / v677 恢复高度）===')

const shell = stripCss(read(SHELL))

/* ---------- 1. .sb-item 规则：显式字号 + 显式行高 + 不写死 height ---------- */
const itemRule = shell.match(/\.sb-item\s*\{[^}]*\}/)
ok(!!itemRule, 'Shell.vue 有 .sb-item 规则块')
const rule = itemRule ? itemRule[0] : ''
const decl = (name) => {
  const m = rule.match(new RegExp('[{;\\s]' + name + '\\s*:\\s*([^;}]+)'))
  return m ? m[1].trim() : null
}

const fsRaw = decl('font-size')
const fsPx = fsRaw && /^(\d+(?:\.\d+)?)px$/.exec(fsRaw) ? Number(RegExp.$1) : null
ok(fsPx !== null, '.sb-item 显式声明 font-size（px）', '现在是：' + fsRaw)

const lhRaw = decl('line-height')
ok(lhRaw !== null, '⛔ .sb-item 必须显式声明 line-height（否则平铺项 1.6 / button 走 UA normal ⇒ 两种行高）',
  '现在没有声明 ⇒ 平铺项与职能区按钮会分叉')
let lhPx = null
if (lhRaw) {
  if (/^\d+(?:\.\d+)?px$/.test(lhRaw)) lhPx = parseFloat(lhRaw)
  else if (/^\d+(?:\.\d+)?$/.test(lhRaw) && fsPx) lhPx = parseFloat(lhRaw) * fsPx
  else if (lhRaw === 'normal') lhPx = null
}
ok(lhPx !== null && lhPx >= 18 && lhPx <= 22,
  'line-height 落在 18–22px（按 px 或「倍数 × font-size」折算）',
  `现在是：${lhRaw} ⇒ ${lhPx === null ? '无法折算（normal 会让 button 与 a 分叉）' : lhPx + 'px'}`)

const padRaw = decl('padding')
const padY = padRaw ? parseFloat((padRaw.match(/^(\d+(?:\.\d+)?)px/) || [])[1]) : null
ok(padY !== null && padY >= PAD_MIN && padY <= PAD_MAX,
  `纵向 padding 落在 ${PAD_MIN}–${PAD_MAX}px`,
  `现在是：${padRaw}`)

ok(decl('height') === null, '⛔ .sb-item 不许写死 height（字号/行高一变就会把文字挤出去）',
  '现在是：height:' + decl('height'))

if (padY !== null && lhPx !== null) {
  const h = lhPx + padY * 2
  ok(h >= H_MIN && h <= H_MAX, `推算行高 ${H_MIN}–${H_MAX}px（line-height + 2 × paddingY）`,
    `现在 = ${lhPx} + ${padY} × 2 = ${h}px ⇒ ${h > H_MAX ? '又回到"松"档' : '太矮，16px 图标贴上下边'}`)
}

/* ---------- 2. .sb-area-btn 不许再把字号冲回继承值 ---------- */
const btnRule = shell.match(/\.sb-area-btn\s*\{[^}]*\}/)
ok(!!btnRule, 'Shell.vue 有 .sb-area-btn 规则块')
const btn = btnRule ? btnRule[0] : ''
ok(!/(^|[{;\s])font\s*:\s*inherit/.test(btn),
  '⛔ .sb-area-btn 不许写 `font:inherit`（简写会连 font-size 一起重置 ⇒ 职能区条目比平铺项高 1.6px）',
  '现在仍是 font:inherit')
ok(/font-family\s*:\s*inherit/.test(btn),
  '.sb-area-btn 只继承 font-family（把 button 的 UA 字体换掉即可）',
  '现在没有 font-family:inherit')
ok(!/(^|[{;\s])font-size\s*:/.test(btn),
  '⛔ .sb-area-btn 不许另设 font-size（第二来源，改一处必漏一处）',
  '现在又在 .sb-area-btn 上设了 font-size')

/* ---------- 3. 别处不许改条目高度 ---------- */
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
  if (path.resolve(f) === path.resolve(SHELL)) continue
  const s = stripCss(read(f))
  for (const m of s.matchAll(/\.sb-item[^{,]*\{[^}]*\}/g)) offenders.push(path.relative(SRC, f) + ' → ' + m[0].slice(0, 60))
}
ok(offenders.length === 0, '⛔ 侧栏条目样式只许在 Shell.vue（别在页面里覆写 .sb-item）', offenders.join(' | '))

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + `  (${pass} pass / ${failed} failed)\n`)
process.exit(failed === 0 ? 0 : 1)
