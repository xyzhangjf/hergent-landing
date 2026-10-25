/**
 * 顶部导航栏高度契约（v675）——「顶部导航栏有一点点高」
 * ---------------------------------------------------------------------------
 * 反馈原话：「顶部导航栏我觉得有一点点高了，请稍微调矮一点」。
 *
 * 事实：高度只由 `variables.css` 的 `--topbar-h` 决定（`Shell.vue` 的
 *   `.topbar{height:var(--topbar-h)}` 是**唯一使用者**）。原先 56px，
 *   而栏内最高的三件都是 34px ——
 *     `.tb-btn`（铃铛/主题）34 / `.tb-copilot`（AI 胶囊）34 / `.wx-now`（天气胶囊）34
 *   ⇒ 56 − 34 = 22，上下各 11px。视觉上比栏内控件"松"一圈，这就是"高"的来源，
 *   不是字体大、也不是某个按钮撑高。
 * 定 48px：48 − 34 = 14 ⇒ 上下各 7px，与 20px 左右内边距成比例。
 *
 * 🔴 本契约钉的是**区间 + 唯一源**，不是单个魔数：
 *      --topbar-h ∈ [44, 52]，且「上下呼吸位」= (h − 34) / 2 ≥ 6px
 *   ⇒ 上界排除 56 这类"松档"（回退会红），下界排除 40 这类"贴边档"
 *     （34px 胶囊的 18px 圆角会被栏边切出一道平口）。
 *   中间值 46/50 不算违规 —— 微调不该被测试拦住，被拦住的是"悄悄回到松/贴两端"。
 *
 * 扫描纪律（踩过的坑）：断言前先剥 CSS 注释 ——
 *   variables.css 的注释里写满了 `56px` / `44` 这些反面教材，不剥必误判。
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

const H_MIN = 44
const H_MAX = 52
const CTRL_MAX = 34      // 栏内最高控件（三件并列 34px，实测）
/* .topbar 有 border-bottom:1px ⇒ 内容盒 = 高度 − 1。
   呼吸位必须按内容盒算：真机首跑拿 rect.bottom 当底，得出"上 6.5 下 7.5"的假不对称，
   误判 4 条（v675）。判据里同样扣掉，否则阈值与实际差 0.5px。 */
const BAR_BORDER = 1
const BREATH_MIN = 6     // 单侧最小呼吸位

console.log('\n=== 顶部导航栏高度契约（v675）===')

/* ---------- 1. 令牌：存在 · 落在区间 · 不许有第二处定义 ---------- */
const varsPath = path.join(SRC, 'styles/variables.css')
const vars = stripCss(read(varsPath))
const defs = [...vars.matchAll(/--topbar-h\s*:\s*([^;]+);/g)]
ok(defs.length === 1, 'variables.css 中 --topbar-h 恰好定义 1 次（唯一源）',
  defs.length === 0 ? '未找到该令牌' : `找到 ${defs.length} 处：` + defs.map((d) => d[1].trim()).join(' / '))

const raw = defs.length ? defs[0][1].trim() : ''
const m = raw.match(/^(\d+(?:\.\d+)?)px$/)
const H = m ? Number(m[1]) : null
ok(H !== null, '--topbar-h 是显式 px 数值', '现在写的是：' + raw)
ok(H !== null && H >= H_MIN && H <= H_MAX,
  `--topbar-h 落在 [${H_MIN}, ${H_MAX}]px`,
  `现在是 ${H}px ⇒ ${H > H_MAX ? '又回到"松"档（56 那档就是这么被反馈高的）' : '太矮，34px 胶囊贴边'}`)
ok(H !== null && (H - BAR_BORDER - CTRL_MAX) / 2 >= BREATH_MIN,
  `上下呼吸位 ≥ ${BREATH_MIN}px（= (--topbar-h − ${BAR_BORDER}px 边线 − ${CTRL_MAX}) / 2）`,
  H === null ? '' : `现在是 (${H} − ${BAR_BORDER} − ${CTRL_MAX}) / 2 = ${(H - BAR_BORDER - CTRL_MAX) / 2}px`)

/* 全仓不得有第二处定义（含同义改名，如 --header-h / --nav-h） */
const all = walk(SRC)
const dupDefs = []
for (const f of all) {
  if (path.resolve(f) === path.resolve(varsPath)) continue
  const s = stripCss(read(f))
  /* 结尾放宽到 `;` 或 `}`：单条规则的末位声明常写作 `--header-h:52px}`（无分号），
     只认 `;` 会漏检 —— 实测注入自证时正是这么漏的。 */
  for (const d of s.matchAll(/--(topbar-h|header-h|nav-h|navbar-h)\s*:\s*[^;}]+[;}]/g)) {
    dupDefs.push(path.relative(SRC, f) + ' → ' + d[0].trim())
  }
}
ok(dupDefs.length === 0, '⛔ 别处不得重复/改名定义顶栏高度（会与唯一源打架）', dupDefs.join(' | '))

/* ---------- 2. 唯一使用者必须走令牌，不许写死 px ---------- */
const shellPath = path.join(SRC, 'components/Shell.vue')
const shell = stripCss(read(shellPath))
const topRule = shell.match(/\.topbar\s*\{[^}]*\}/)
ok(!!topRule, 'Shell.vue 有 .topbar 规则块')
const hDecl = topRule ? topRule[0].match(/(?:^|[{;\s])height\s*:\s*([^;}]+)/) : null
ok(!!hDecl, '.topbar 声明了 height')
ok(!!hDecl && /var\(\s*--topbar-h\s*\)/.test(hDecl[1]),
  '.topbar 的 height 用 var(--topbar-h)',
  hDecl ? '现在写的是：' + hDecl[1].trim() : '')
ok(!!hDecl && !/^\s*\d+(?:\.\d+)?px\s*$/.test(hDecl[1]),
  '⛔ .topbar 不许写死 px 高度（写死的那一刻令牌就失效了）',
  hDecl ? '现在写的是：' + hDecl[1].trim() : '')

/* ---------- 3. 栏内控件不得比栏还高（换按钮时最容易被忽略） ---------- */
const ctrlRules = [
  { file: shellPath, sel: '.tb-btn' },
  { file: shellPath, sel: '.tb-copilot' },
  { file: shellPath, sel: '.tb-user' },
  { file: path.join(SRC, 'components/WeatherWidget.vue'), sel: '.wx-now' },
]
const tooTall = []
for (const { file, sel } of ctrlRules) {
  const s = stripCss(read(file))
  const re = new RegExp('\\' + sel + '\\s*\\{[^}]*\\}')
  const r = s.match(re)
  if (!r) { tooTall.push(path.relative(SRC, file) + sel + ' 规则未找到'); continue }
  const hm = r[0].match(/[{;\s]height\s*:\s*(\d+(?:\.\d+)?)px/)
  if (!hm) { tooTall.push(path.relative(SRC, file) + sel + ' 无 px 高度（无法校验）'); continue }
  const v = Number(hm[1])
  if (H !== null && v > H - BAR_BORDER - 2 * BREATH_MIN) tooTall.push(`${sel} ${v}px > ${H - BAR_BORDER - 2 * BREATH_MIN}px`)
}
ok(tooTall.length === 0,
  '⛔ 栏内控件高度必须 ≤ (--topbar-h − 两侧呼吸位)',
  tooTall.join(' | '))

console.log('\n' + (failed === 0 ? 'ALL PASS' : 'FAILED') + `  (${pass} pass / ${failed} failed)\n`)
process.exit(failed === 0 ? 0 : 1)
