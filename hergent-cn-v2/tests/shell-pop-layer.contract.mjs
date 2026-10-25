/**
 * 应用外壳浮层层级契约（v674）——「侧栏弹窗被页面按钮盖住」
 * ---------------------------------------------------------------------------
 * 症状：左侧导航的职能区弹窗（进销存 / 仓配管理 / 资金管理 / …）打开时，
 *   本期预报页的「品牌 / 到货周期 / 复制报单」整块浮在弹窗上面，弹窗条目点不到。
 *
 * 根因：`.sb-pop` 是 `Teleport to="body"` + `position:fixed`，写死 `z-index:30`；
 *   而 §1.7.1 的页面级阶梯把工具栏弹层容器 `.tb-pop` 定到 `--z-page-bar:1120`
 *   ⇒ 1120 ≫ 30，位置一重叠按钮必然压住导航弹窗。
 *
 * 真机重叠矩阵（演示租户，v673 生产）：
 *   1440×900 → 5 个职能区 × 「复制报单」
 *   1366×768 → 同上 5 个 × 「到货周期 + 复制报单」（工具行折行把按钮推到左侧）
 *
 * 🔴 本契约钉的是**档位关系**，不是某个数字：
 *      --z-page-bar(工具条) < --z-shell-pop(外壳浮层) < --z-page-modal-overlay(页面模态)
 *   任何一端挪动都必须重新审视——这就是"两套层级体系没对齐"的防复发网。
 * 🔴 反向约束：`--z-shell-pop` **不许被页面**（src/pages/**）引用。
 *   外壳档是给"从应用外壳长出来的非模态浮层"的；页面一借，层级语义立刻崩。
 *
 * 扫描纪律：断言前先剥 CSS 注释（本文件与源码注释里写满了 `z-index:30` 反面教材）。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const SRC = path.join(ROOT, 'src')

let pass = 0
let failed = 0
function ok (cond, label, extra) {
  if (cond) { pass++; console.log('     ✅ ' + label) }
  else { failed++; console.log('     ❌ ' + label + (extra ? '  → ' + extra : '')) }
}
const read = (p) => fs.readFileSync(p, 'utf8')
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

function walk (dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.vue') || e.name.endsWith('.css')) out.push(p)
  }
  return out
}

console.log('\n=== 应用外壳浮层层级契约（v674）===')

/* ---------- 1. 令牌定义与相对顺序 ---------- */
const varsRaw = read(path.join(SRC, 'styles/variables.css'))
const vars = stripCss(varsRaw)
const num = (name) => {
  const m = vars.match(new RegExp('--' + name + '\\s*:\\s*(\\d+)\\s*;'))
  return m ? Number(m[1]) : null
}
const zShell = num('z-shell-pop')
const zBar = num('z-page-bar')
const zModalOverlay = num('z-page-modal-overlay')

ok(zShell !== null, 'variables.css 定义了 --z-shell-pop', '未找到该令牌')
ok(zBar !== null && zModalOverlay !== null, 'variables.css 仍定义 --z-page-bar / --z-page-modal-overlay',
  '--z-page-bar=' + zBar + ' --z-page-modal-overlay=' + zModalOverlay)
ok(zShell !== null && zBar !== null && zShell > zBar,
  '外壳浮层高于页面工具条（--z-shell-pop > --z-page-bar）',
  '--z-shell-pop=' + zShell + ' vs --z-page-bar=' + zBar + ' ⇒ 按钮仍会盖住侧栏弹窗')
ok(zShell !== null && zModalOverlay !== null && zShell < zModalOverlay,
  '外壳浮层低于页面模态遮罩（--z-shell-pop < --z-page-modal-overlay）',
  '--z-shell-pop=' + zShell + ' vs --z-page-modal-overlay=' + zModalOverlay + ' ⇒ 确认框会被侧栏弹窗盖住')

/* ---------- 2. .sb-pop 必须用令牌，不许写死数字 ---------- */
const shellRaw = read(path.join(SRC, 'components/Shell.vue'))
const shell = stripCss(shellRaw)
const sbRule = shell.match(/\.sb-pop\s*\{[^}]*\}/)
ok(!!sbRule, 'Shell.vue 有 .sb-pop 规则块')
const sbZ = sbRule ? sbRule[0].match(/z-index\s*:\s*([^;}]+)/) : null
ok(!!sbZ, '.sb-pop 声明了 z-index')
ok(!!sbZ && /var\(\s*--z-shell-pop\s*\)/.test(sbZ[1]),
  '.sb-pop 的 z-index 用 var(--z-shell-pop)',
  sbZ ? '现在写的是：' + sbZ[1].trim() : '')
ok(!!sbZ && !/^\s*\d+\s*$/.test(sbZ[1]),
  '⛔ .sb-pop 不许写死数字档位（v674 之前的 z-index:30 就是这么被 1120 甩下的）',
  sbZ ? '现在写的是：' + sbZ[1].trim() : '')

/* ---------- 3. 反向约束：外壳档不许被页面借用 ---------- */
const pageFiles = walk(path.join(SRC, 'pages'))
const offenders = pageFiles.filter((f) => /--z-shell-pop/.test(stripCss(read(f))))
ok(offenders.length === 0,
  '⛔ 页面（src/pages/**）不得引用 --z-shell-pop（那是外壳专属档）',
  offenders.map((f) => path.relative(SRC, f)).join(', '))

/* 已知项（不是放行，是记录在案的边界）：
 *   `.tb-menu` / `.tb-menu-mask`（顶栏右上角菜单）仍是 50/40。
 *   它当前**不可能暴露**本缺陷：菜单占 `x∈[right-150, right]`、`y∈[44,244]`，
 *   而页面工具条在 `y≥259`（真机 1440/1366 两档实测），几何上永不重叠。
 *   之所以不顺手抬到 `--z-shell-pop`：它的 `.tb-menu-mask` 是 `inset:0` 的
 *   互斥遮罩，抬到 1122 会盖住页面已打开的 `.tb-pop-panel`(1101)，
 *   改变"顶栏菜单开着时点页面别处"的既有行为 —— 没有实际收益的行为变更不做。
 *   ⚠️ 一旦顶栏菜单将来会长到与页面浮层重叠，必须一并改用 `--z-shell-pop`。 */
const KNOWN_LOW = new Set(['.tb-menu', '.tb-menu-mask'])

const shellFiles = walk(path.join(SRC, 'components'))
const MENUISH = /\.(sb-pop|tb-menu|tb-menu-mask|sb-pop-[\w-]+)\s*\{/
const lowZ = []
for (const f of shellFiles) {
  const s = stripCss(read(f))
  const rules = s.match(/\.[a-zA-Z][\w-]*\s*\{[^}]*\}/g) || []
  for (const r of rules) {
    const sel = (r.match(/^\.[\w-]+/) || ['?'])[0]
    if (!MENUISH.test(sel + ' {')) continue
    if (KNOWN_LOW.has(sel)) continue
    if (!/position\s*:\s*(fixed|absolute)/.test(r)) continue
    const m = r.match(/z-index\s*:\s*(\d+)\s*[;}]/)
    if (!m) continue
    const v = Number(m[1])
    if (v > 0 && v < 1100) lowZ.push({ file: path.relative(SRC, f), sel, z: v })
  }
}
ok(lowZ.length === 0,
  '⛔ 外壳层菜单型浮层不得写死 <1100 的 z（会被 1120 的页面工具条盖住）',
  lowZ.map((x) => x.file + x.sel + ' z=' + x.z).join(' | '))

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + `  (${pass} pass / ${failed} failed)\n`)
process.exit(failed === 0 ? 0 : 1)
