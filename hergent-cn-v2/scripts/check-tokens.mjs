#!/usr/bin/env node
/* ============================================================================
   设计令牌护栏（P1/v717 建立）
   ----------------------------------------------------------------------------
   拦住「新发明一个颜色」这件事，而不是回过头去骂存量。

   背景：v716 评审实测 `src/**`（不含 variables.css）里有 199+ 个硬编码色值、
   563 次出现，同一个系统里 `#06b6d4`（品牌青）和 `#2f6bff`（另一个蓝）并存，
   用户会以为来自两个产品。存量一次清不完，但**新增必须拦住**，否则清了也白清。

   判据（不是"看见 # 就报错"，那样没人会用它）：
     每个文件的**允许色值集合**记录在 `scripts/ui-token-baseline.json`。
     - 文件不在 baseline 里、却出现任何 hex 颜色        → 报错（新文件必须走令牌）
     - 文件在 baseline 里、但用了集合外的**新**色值     → 报错（不许发明新颜色）
     - 用了集合内的旧色值                             → 放行（存量，分批清）
     - `#fff/#ffffff/#000` 及其带 alpha 的写法         → 永远放行（结构性白/黑，不值得令牌化）
     清了存量就把 baseline 里那一项删掉（`--update` 会自动做），集合只减不增。

   用法：
     node scripts/check-tokens.mjs            # 检查，有违规 exit 1
     node scripts/check-tokens.mjs --update   # 按当前代码重写 baseline（清完存量后用）
     node scripts/check-tokens.mjs --list     # 打印 baseline 全量，便于分批清理

   接入：`npm run build` 前自动跑（package.json 的 prebuild）。
   ============================================================================ */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const BASELINE = join(ROOT, 'scripts', 'ui-token-baseline.json')
const TOKEN_FILE = 'src/styles/variables.css'

/** 结构性白/黑：永远放行。它们是"没有颜色"，不是"某个色号"。 */
const STRUCTURAL = new Set([
  'fff', 'ffffff', '000', '000000',
  'ffffff00', '00000000',
])

const HEX = /#([0-9a-fA-F]{3,8})\b/g

/* ── 剥离注释再扫 ──────────────────────────────────────────────────────────
   🔴 v719 实测的假阳性：`<!-- #356：异常预警区 -->`、`// #357 目标分解` 这类**任务号**
      是 3 位十六进制（356/354/355/357 全是合法 hex 字符），会被 HEX 当成颜色收进来 ——
      单个文件就此虚报 4 条，而它一个颜色都没写。同理注释里"浅色 #854F0B / 深色 #e2b274"
      这类说明文字也不是用色。
   护栏的可信度取决于它不冤枉人：一条假阳性就会让人想整体关掉它。
   ⇒ 先剥三类注释（HTML / 块 / 行），再匹配。行注释用 `(^|\s)//` 且排除 `://`（URL 不剥）。 */
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

/* ── 豁免：图表调色板 ───────────────────────────────────────────────────────
   护栏的目的是拦「随手写一个颜色当文字色/边界色」，不是拦「图表定义柱体配色」。
   这两个文件里的色值是**配色数据**（一组同权重系列色），不是样式层绕过令牌：
   - 它们是多色系列，天然不能收敛到单一语义令牌；
   - 取的是「与 --war/--dan 警示语义分开」的大面积填色，用警示色铺柱体会刺眼；
   - 两者都自带浅/深两套取值（LossDashboard 的 --c-* 在 html.dark 里重取），
     各自的取舍在源码里都有成段注释。
   🔴 豁免名单**只许缩小**：往这里加文件前先问「这是不是一组系列配色」，
      单个颜色不许借这个口子进来。 */
const EXEMPT = {
  'src/components/LossDashboard.vue':
    '图表调色板 --c-*(12 个)，html.dark 内另有整套深色取值，见文件头三段说明',
  'src/components/rebate/MonthlyAchvChart.vue':
    '图表调色板 C 常量(fill/deep/lbl 五组)，v491 已决策「高度调优过 12 轮、不碰配色避免回归」',
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(vue|css)$/.test(name)) out.push(p)
  }
  return out
}

function collect() {
  /** @type {Map<string, Set<string>>} 相对路径 → 该文件出现过的色值 */
  const found = new Map()
  for (const abs of walk(SRC)) {
    const rel = relative(ROOT, abs).split('\\').join('/')
    if (rel === TOKEN_FILE) continue
    if (EXEMPT[rel]) continue
    const src = stripComments(readFileSync(abs, 'utf8'))
    const vals = new Set()
    for (const m of src.matchAll(HEX)) {
      const v = m[1].toLowerCase()
      // 颜色后必须紧跟非十六进制字符，避免把 #fff 里的 f 和后面单词粘一起
      if (STRUCTURAL.has(v)) continue
      vals.add(v)
    }
    if (vals.size) found.set(rel, vals)
  }
  return found
}

/* ─────────────────────────────────────────────────────────────────────────────
   v720 · 图标尺寸白名单
   ─────────────────────────────────────────────────────────────────────────────
   由来：`<Icon :size="N">` 曾出现 11 档（11/12/13/14/15/16/17/18/20/22/26），
   而 `.ico{width:16px;height:16px}` 又把它们**全部压平成 16px** ⇒ 声明与渲染脱节，
   「八档尺寸」只是一纸空文。v720 去掉那条硬压并收敛到 4 档 {14,16,18,22}。
   这条护栏守的就是「别再长回第八档」—— 新写 15px / 20px 直接构建失败。
   为什么是这 4 档：14 = 正文/工具栏（占比最大），16 = 控件内固定档，
   18 = 分区标题，22 = 空态大图标（`.se-ic` 48×48 容器内）。 */
const ICON_SIZES = new Set(['14', '16', '18', '22'])
function checkIconSizes() {
  const bad = []
  const re = /<Icon\b[^>]*?\bsize\s*=\s*"(\d+)"/g
  for (const abs of walk(SRC)) {
    if (!abs.endsWith('.vue')) continue
    const rel = relative(ROOT, abs).split('\\').join('/')
    for (const m of stripComments(readFileSync(abs, 'utf8')).matchAll(re)) {
      if (!ICON_SIZES.has(m[1])) bad.push({ rel, v: m[1] })
    }
  }
  return bad
}

/* ─────────────────────────────────────────────────────────────────────────────
   v724 · 圆角护栏
   ─────────────────────────────────────────────────────────────────────────────
   由来：全站圆角曾散成 **14 档字面量**（2/3/4/5.5/8/11/12/14/16/18/20/22/24/99/999），
   其中 11/18/20/5.5px 全是「把元素半高写死」的胶囊 —— 元素一改高，胶囊就不成立了。
   v724 收敛到 9 档令牌（hair/2xs/xs/sm/md/lg/xl/pill/circle，定义见 variables.css）。

   判据：`border-radius` 的值只许由三样东西组成 —— `var(--radius-*)` 令牌、`0`、`inherit`。
   把这三样剥掉后还剩任何字符（裸 px、裸 %、calc…）⇒ 构建失败。

   为什么允许 `0`：直角是刻意选择（表格单元格、紧贴相邻元素的一侧），不是「忘了令牌」。
   为什么单独留 `--radius-hair:2px`：1-3px 是「柔化 1px 边缘」不是「组件圆角」，
   4px 圆角落在 8×8 图例点上就是半圆了，合并这两档是错的。
   为什么有 `--radius-pill`：胶囊的正确表达是「不管多高都半圆」，写死 11px 只是个巧合。 */
const RADIUS_OK = new Set([
  '--radius', '--radius-hair', '--radius-2xs', '--radius-xs', '--radius-sm',
  '--radius-md', '--radius-lg', '--radius-xl', '--radius-pill', '--radius-circle',
])
const RADIUS_DECL = /border-radius\s*:\s*([^;}]+)/g
const RADIUS_TOKEN = /var\(\s*(--radius[A-Za-z0-9-]*)\s*\)/g

function checkRadius() {
  const bad = []
  for (const abs of walk(SRC)) {
    const rel = relative(ROOT, abs).split('\\').join('/')
    const src = stripComments(readFileSync(abs, 'utf8'))
    for (const m of src.matchAll(RADIUS_DECL)) {
      const val = m[1].trim()
      const rest = val
        .replace(RADIUS_TOKEN, (full, name) => (RADIUS_OK.has(name) ? '' : '\u0000UNKNOWN:' + name))
        .replace(/\b0(?:px)?\b/g, '')
        .replace(/\binherit\b/g, '')
        /* `!important` 是优先级声明、不是取值；`0 !important` 是完全合法的直角写法。
           少写这一条会让护栏第一跑就冤枉一个正确的地方 —— 假阳性一次就没人信它了。 */
        .replace(/!\s*important/gi, '')
        .trim()
      if (rest) bad.push({ rel, val })
    }
  }
  return bad
}

const args = new Set(process.argv.slice(2))
const current = collect()
const iconBad = checkIconSizes()
const radiusBad = checkRadius()
if (args.has('--update')) {
  const obj = {}
  for (const k of [...current.keys()].sort()) obj[k] = [...current.get(k)].sort()
  writeFileSync(BASELINE, JSON.stringify(obj, null, 2) + '\n', 'utf8')
  const n = Object.values(obj).reduce((a, b) => a + b.length, 0)
  console.log(`已写入 ${BASELINE}`)
  console.log(`  文件 ${Object.keys(obj).length} 个 / 色值 ${n} 条`)
  process.exit(0)
}

if (args.has('--list')) {
  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}
  const rows = Object.entries(base).map(([f, cs]) => [f, cs.length])
  rows.sort((a, b) => b[1] - a[1])
  console.log('待清理的硬编码色（文件 → 色值数）：')
  for (const [f, c] of rows) console.log(`  ${String(c).padStart(3)}  ${f}`)
  console.log(`\n合计 ${rows.length} 个文件 / ${rows.reduce((a, b) => a + b[1], 0)} 条`)
  const ex = Object.entries(EXEMPT)
  if (ex.length) {
    console.log(`\n豁免（图表调色板，不计入待清）：`)
    for (const [f, why] of ex) console.log(`  ${f}\n    ${why}`)
  }
  process.exit(0)
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}
const violations = []

for (const [file, vals] of current) {
  const allowed = new Set(base[file] || [])
  if (!base[file]) {
    violations.push({ file, kind: 'new-file', vals: [...vals].sort() })
    continue
  }
  const added = [...vals].filter(v => !allowed.has(v)).sort()
  if (added.length) violations.push({ file, kind: 'new-color', vals: added })
}

if (!violations.length && !iconBad.length && !radiusBad.length) {
  const files = Object.keys(base).length
  const total = Object.values(base).reduce((a, b) => a + b.length, 0)
  console.log(`✓ 设计令牌护栏通过（存量待清：${files} 个文件 / ${total} 条，见 --list）`)
  console.log(`✓ 图标尺寸护栏通过（允许 ${[...ICON_SIZES].join(' / ')} 四档）`)
  console.log(`✓ 圆角护栏通过（只许 --radius-* / 0 / inherit）`)
  process.exit(0)
}

if (radiusBad.length) {
  console.error('\n✗ 圆角护栏：出现了令牌之外的 border-radius\n')
  for (const b of radiusBad) console.error(`  ${b.rel}\n    border-radius: ${b.val}`)
  console.error('\n圆角只分 9 档（定义见 src/styles/variables.css）：')
  console.error('  hair 2px 指示条/图例点/把手（柔化 1px 边，不要并进 2xs）')
  console.error('  2xs 4px 单元格/小标签　xs 6px 小控件　sm 8px 按钮输入（主档）')
  console.error('  md 12px 卡片　lg 16px 大卡片/面板　xl 22px 弹窗')
  console.error('  pill 999px 胶囊（不管多高都半圆）　circle 50% 正圆')
  console.error('\n不要在局部写死 px —— 元素高度一变，写死的半高就不再是胶囊了。\n')
}

if (iconBad.length) {
  console.error('\n✗ 图标尺寸护栏：出现了白名单之外的 <Icon :size>\n')
  for (const b of iconBad) console.error(`  ${b.rel}  → ${b.v}`)
  console.error(`\n只允许 ${[...ICON_SIZES].join(' / ')} 四档：`)
  console.error('  14 = 正文/工具栏｜16 = 控件内固定档｜18 = 分区标题｜22 = 空态大图标')
  console.error('尺寸梯度是「视觉节奏」的一部分，随手写 15/20 会让同屏图标大小不一。\n')
}

if (violations.length) {
  console.error('\n✗ 设计令牌护栏：出现了新的硬编码色值\n')
  for (const v of violations) {
    console.error(`  ${v.file}`)
    console.error(`    ${v.kind === 'new-file' ? '新文件直接用 hex（应从 variables.css 取令牌）' : '新增了 baseline 之外的色值'}`)
    console.error(`    ${v.vals.map(x => '#' + x).join(', ')}\n`)
  }
  console.error('改法（按顺序选一个）：')
  console.error('  1) 用已有令牌：background:var(--p-dark) / color:var(--st-ok-txt) / border:1px solid var(--bd)')
  console.error('  2) 确实缺语义色 ⇒ 在 src/styles/variables.css 的 :root 与 :root.dark 里各加一个令牌，再来引用')
  console.error('  3) 只是把存量挪了位置/改了大小写 ⇒ 跑 `node scripts/check-tokens.mjs --update`')
  console.error('\n不要直接往 baseline 里手塞色值 —— 那等于把护栏拆了。\n')
}
process.exit(1)
