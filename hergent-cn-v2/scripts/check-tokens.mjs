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

/* ─────────────────────────────────────────────────────────────────────────────
   v727 · 字号护栏
   ─────────────────────────────────────────────────────────────────────────────
   由来：v724 收圆角时「为什么它能一次到位」的答案是**有 prebuild 检查**。
   对照字号：11 档令牌早就定义好了，但全站仍写 **1961 处 `font-size:12px` 这类字面量**，
   令牌采纳率 5% ⇒ 改令牌只有 5% 的页面跟着变。间距更差：令牌采纳 ~18 处 / 0%。
   ⇒ 缺的不是令牌，是「令牌被使用」。这条护栏补的就是这个缺口。

   判据：`font-size` 的值只许是 `var(--fs-*)`。放行三类：
     · `0`            —— 消除行内空白符（`font-size:0` 后子元素再设字号），不是"字号"
     · em / rem / %   —— 相对字号（markdown 标题层级 `1.45em`），语义是"相对父级"
     · inherit/initial/unset —— 显式重置
   裸 px 一律失败。令牌改名/改值时不在这里改，去 variables.css。 */
const FS_DECL = /(?<![\w-])font-size\s*:\s*([^;{}"'<>]+)/g
const FS_TOKEN = /var\(\s*--fs-[A-Za-z0-9-]*\s*\)/g

function checkFontSizes () {
  const bad = []
  for (const abs of walk(SRC)) {
    if (!/\.(vue|css)$/.test(abs)) continue
    const rel = relative(ROOT, abs).split('\\').join('/')
    for (const m of stripComments(readFileSync(abs, 'utf8')).matchAll(FS_DECL)) {
      const val = m[1].trim()
      const rest = val
        .replace(FS_TOKEN, '')
        /* `max(11px,.9em)` / `clamp(...)` 是**自适应**写法（不小于可读下限、又跟随父级），
           里面的 px 不是"挑了个字号档"。同理 `var(--td-fs, 12px)` 的兜底值。 */
        .replace(/(max|min|clamp)\([^()]*(?:\([^()]*\)[^()]*)*\)/gi, '')
        .replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '')
        .replace(/!\s*important/gi, '')
        .replace(/(inherit|initial|unset)/gi, '')
        .replace(/^-?0(?:px)?$/g, '')
        .replace(/^-?\d+(?:\.\d+)?(em|rem|%)$/gi, '')
        .trim()
      if (rest) bad.push({ rel, val })
    }
  }
  return bad
}

/* ─────────────────────────────────────────────────────────────────────────────
   v728 · 行高护栏
   ─────────────────────────────────────────────────────────────────────────────
   由来：全站原本 **0 个行高令牌**，475 处声明散在 21 种取值里。真正的病不是"值太多"
   （倍数只有 12 种），而是**同一字号配了太多种行高** —— 12px 提示文字用过 23 种，
   折算出来从 12px 到 25px 都有。同一张卡片里两行说明文字，一行松一行紧。

   判据：只许 `var(--lh-*)`，另放行三类**不是行高**的写法 ——
     · `0`      消除内联元素空白符 / 图标对齐的技巧（不是"行高为 1"，归一会错位）
     · `normal` 让浏览器算（UA ≈1.2），只出现在 `<button>` 复位类规则里
     · `var(--fc-cell…)` / `calc(…)`  图表单元格尺寸，是布局量不是文字行高

   ⚠️ 这条护栏只能拦住"新增裸值"，不能替你判断"这个位置该用哪档" ——
      后者要看它是单行控件（none）、表格密排（tight）、还是多行说明（normal/relaxed）。 */
const LH_DECL = /(?<![\w-])line-height\s*:\s*([^;{}"'<>]+)/g
const LH_TOKEN = /var\(\s*--lh-[A-Za-z0-9-]*\s*\)/g

/* ─────────────────────────────────────────────────────────────────────────────
   v730 · 「用行高当高度」的冻结清单
   -----------------------------------------------------------------------------
   v728 起这条被判为技术债（靠 `height:15px;line-height:15px` 把单行文字撑到容器高），
   但只"放行并计数" ⇒ 每次跑护栏都打印「放行 25 处，P1 应改 flex」，一年都还是 25。
   v730 把它清到 0 待办：13 处改成 flex 居中，剩下 12 处是**真的不能改**，
   按文件冻结数量（不是按选择器字符串 —— 提取选择器在 `:deep()` / 合并规则上不稳）。

   🔴 为什么这 12 处不能改 flex 居中：
     A. `.ipn-v` 文本态 × 10（明细格）—— 同块有 `white-space:nowrap` + `overflow:hidden`
        + `text-overflow:ellipsis`。改成 flex 容器后文本成为**匿名 flex item**，
        而 `text-overflow` 只作用于块容器自己的行盒 ⇒ **省略号消失**，长商品名被硬裁
        （那正是 v417j 加 ellipsis 要解决的「把表格推出横向滚动」）。要改必须先包内层 span。
     B. `<select>` 系 × 2（`.hd-sel` / `.cm-sel·.cm-in·.scheme-name-ipt`）——
        原生下拉不吃 `align-items`（UA 内部渲染 popup，不参与 flex 布局），
        `line-height` 本来就是它唯一的垂直居中手段。
   🔴 新增的同类写法会被判失败 —— 冻结的是**这 12 处**，不是这个模式。 */
const LH_AS_HEIGHT_FROZEN = new Map([
  ['src/pages/inventory/InvPurchaseNew.vue', 2],   // A：.ipn-v 主档 18 + compact 16
  ['src/pages/inventory/new/ProductCombo.vue', 2], // A
  ['src/pages/inventory/new/PurchaseOrderForm.vue', 2], // A
  ['src/pages/inventory/new/PurchaseReturnForm.vue', 2], // A
  ['src/pages/wh/Strategy.vue', 1],  // A：:deep(.ipn-v) 覆盖成输入框外观
  ['src/pages/wh/WhItems.vue', 1],   // A：同上
  ['src/pages/EmployeeArchive.vue', 1], // B：.hd-sel
  ['src/styles/col-menu.css', 1],       // B：.cm-sel / .cm-in / .scheme-name-ipt 合并规则
])

function checkLineHeights () {
  const bad = []
  const frozenSeen = new Map()
  const overFrozen = []
  for (const abs of walk(SRC)) {
    if (!/\.(vue|css)$/.test(abs)) continue
    const rel = relative(ROOT, abs).split('\\').join('/')
    const src = stripComments(readFileSync(abs, 'utf8'))
    /* 逐**规则块**扫，而不是逐声明 —— 判"用行高当高度"必须同块看 height。 */
    for (const blk of src.matchAll(/\{([^{}]*)\}/g)) {
      const body = blk[1]
      const m = /(?:^|;|\s)line-height\s*:\s*([^;}]+)/.exec(body)
      if (!m) continue
      const val = m[1].trim()

      const rest = val
        .replace(LH_TOKEN, '')
        .replace(/var\(\s*--fc-cell[^()]*(?:\([^()]*\)[^()]*)*\)/g, '')
        .replace(/calc\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '')
        .replace(/!\s*important/gi, '')
        .replace(/^-?0(?:\.0+)?(?:px)?$/g, '')
        .replace(/^(normal|inherit|initial|unset)$/gi, '')
        .trim()
      if (!rest) continue

      /* 「用行高当高度」是一种**技术债**，但它不是文字行距：
         `height:32px;line-height:32px` / `min-height:16px;line-height:16px` /
         `min-height:38px;line-height:36px`（差 2px 是上下边框）——
         这类靠 line-height 把单行文字撑到容器高，硬套成倍数会立刻错位。
         常见于输入框、圆形图标、紧凑密度档单元格。放行并计数，P1 应改成 flex 居中。 */
      const hn = /(?:^|;|\s)(?:min-)?height\s*:\s*(\d+(?:\.\d+)?)px/.exec(body)
      const ln = /^(\d+(?:\.\d+)?)px$/.exec(val.replace(/!\s*important/i, '').trim())
      if (hn && ln && Math.abs(parseFloat(hn[1]) - parseFloat(ln[1])) <= 2) {
        const seen = (frozenSeen.get(rel) || 0) + 1
        frozenSeen.set(rel, seen)
        const cap = LH_AS_HEIGHT_FROZEN.get(rel) || 0
        if (seen > cap) overFrozen.push({ rel, val: `${hn[0].trim()} 撑 ${ln[1]}px（同块 height 与 line-height 等值）` })
        continue
      }

      bad.push({ rel, val })
    }
  }
  /* 冻结清单里**用不满**也算问题：说明那处被顺手删了或写法变了，
     清单该同步收缩，否则它会慢慢变成"允许这个文件里出现 N 处"的空白支票。 */
  const shrunk = [...LH_AS_HEIGHT_FROZEN].filter(([rel, cap]) => (frozenSeen.get(rel) || 0) < cap)
  if (shrunk.length) bad.push({ rel: shrunk.map(([r]) => r).join(', '), val: `冻结清单数量对不上（实际少了，请同步收缩 LH_AS_HEIGHT_FROZEN）` })
  for (const o of overFrozen) {
    bad.push({ rel: o.rel, val: `${o.val} —— 靠 line-height 撑高度，改 flex：display:flex;align-items:center;justify-content:center + line-height:var(--lh-none)` })
  }
  const frozenTotal = [...frozenSeen].reduce((a, [, n]) => a + n, 0)
  if (frozenTotal) console.log(`  · 行高：${frozenTotal} 处「用 line-height 当高度」已冻结（10 处明细格文本态有 ellipsis、2 处原生 select，见 LH_AS_HEIGHT_FROZEN）`)
  return bad
}

/* ─────────────────────────────────────────────────────────────────────────────
   v729 · 行高**阶梯**护栏（不是用法护栏，是"别再扩张档位"）
   ----------------------------------------------------------------------------
   由来：v728 建了 11 档（0.1 步长），每个引用都合规，但 1.5/1.6/1.7 三档相邻 ——
   13px 下相差 1.3px，测不出来也看不出来，却把同类文字分成了三种。
   v729 把 6 个过渡档按语义并入 5 档，并在这里**锁死档位**。
   🔴 上一版的教训：只拦「没走令牌」会把令牌本身的数量当成好事。
      给了 11 档，下一个人的选择成本比没有令牌时更高。 */
const LH_RAMP = new Map([
  ['--lh-none', 1],
  ['--lh-title', 1.2],
  ['--lh-tight', 1.4],
  ['--lh-normal', 1.6],
  ['--lh-loose', 1.8],
])
function checkLineHeightRamp () {
  const css = stripComments(readFileSync(join(ROOT, TOKEN_FILE), 'utf8'))
  const seen = new Map()
  for (const m of css.matchAll(/(--lh-[a-z]+)\s*:\s*(\d+(?:\.\d+)?)\s*;/g)) seen.set(m[1], parseFloat(m[2]))
  const bad = []
  for (const [k, v] of seen) {
    if (!LH_RAMP.has(k)) bad.push({ k, v, why: '新增档位' })
    else if (LH_RAMP.get(k) !== v) bad.push({ k, v, why: `值应保持 ${LH_RAMP.get(k)}` })
  }
  for (const k of LH_RAMP.keys()) if (!seen.has(k)) bad.push({ k, v: null, why: '档位被删' })
  return bad
}

/* ─────────────────────────────────────────────────────────────────────────────
   v730 · 字号**阶梯**护栏（与 `checkLineHeightRamp` 同性质：锁档位，不只锁用法）
   -----------------------------------------------------------------------------
   由来：`checkFontSizes()` 只拦「没用令牌」。令牌本身可以是 12 档、步长 1px ——
   每一条引用都合规，但 15/16/17 三档相邻，肉眼分不出，却把同类文字切成了三种。
   v730 收掉两个：
     · `--fs-h2` 20px ≡ `--fs-xl` 20px —— **同值两个名字**，共存了几个月没人发现
     · `--fs-h3` 17px 只有 4 处，夹在 lg 16 与 stat 18 之间
   🔴 所以这条护栏除了锁名字/值，还多查一条 **同值检测**：
      两个 `--fs-*` 值是同一个数 ⇒ 报错。这比"档位太多"更难发现 ——
      用的人只会想"我该用 h2 还是 xl"，而答案永远是"都一样"。 */
const FONT_RAMP = new Map([
  ['--fs-xs', 11],
  ['--fs-sm', 12],
  ['--fs-base', 13],
  ['--fs-md', 14],
  ['--fs-body-m', 15], // v732 从 --fs-h4 拆出：**只给移动端 body**，UI 规则里出现就报错
  ['--fs-lg', 16],
  ['--fs-stat', 18],
  ['--fs-xl', 20],
  ['--fs-num', 22],
  ['--fs-h1', 24],
  ['--fs-num-lg', 26],
])
function checkFontRamp () {
  const css = stripComments(readFileSync(join(ROOT, TOKEN_FILE), 'utf8'))
  const seen = new Map()
  for (const m of css.matchAll(/(--fs-[a-z0-9-]+)\s*:\s*(\d+(?:\.\d+)?)px\s*;/g)) seen.set(m[1], parseFloat(m[2]))
  const bad = []
  for (const [k, v] of seen) {
    if (!FONT_RAMP.has(k)) bad.push({ k, v, why: '新增档位' })
    else if (FONT_RAMP.get(k) !== v) bad.push({ k, v, why: `值应保持 ${FONT_RAMP.get(k)}px` })
  }
  for (const k of FONT_RAMP.keys()) if (!seen.has(k)) bad.push({ k, v: null, why: '档位被删' })
  const byVal = new Map()
  for (const [k, v] of seen) byVal.set(v, [...(byVal.get(v) || []), k])
  for (const [v, ks] of byVal) if (ks.length > 1) bad.push({ k: ks.join(' ≡ '), v, why: `同值 ${v}px，同一件事两个名字（用的人只会问"该用哪个"，答案都一样）` })
  return bad
}

/* ─────────────────────────────────────────────────────────────────────────────
   v732 · `--fs-body-m` 只能用在移动端 body 上
   ─────────────────────────────────────────────────────────────────────────────
   由来：`--fs-h4` 15px 之所以是债，不是"多了个档"，而是**一个名字两个语义**
   （四级标题 / 移动端正文字号）。机械归并必伤一头：改 16 则 375px 正文变宽 6.7%
   换行全变，改 14 则二十处标题缩水。所以拆成两个名字 —— 但**拆开之后必须防止再合回去**。
   这一条守的就是"拆开"这个状态：body-m 出现在任何一条 UI 规则里 ⇒ 语义又开始混了。
   （判据只管"出现在哪"，不管值 —— 值由 checkFontRamp 锁。） */
function checkMobileBodyOnly () {
  const bad = []
  const ALLOW = /^body\s*\{[^}]*font-size\s*:\s*var\(--fs-body-m\)/
  for (const abs of walk(SRC)) {
    if (!/\.(vue|css)$/.test(abs)) continue
    const rel = relative(ROOT, abs).split('\\').join('/')
    const lines = stripComments(readFileSync(abs, 'utf8')).split('\n')
    lines.forEach((ln, i) => {
      if (!ln.includes('var(--fs-body-m)')) return
      if (rel === TOKEN_FILE && ALLOW.test(ln.trim())) return
      bad.push({ rel, line: i + 1, text: ln.trim().slice(0, 110) })
    })
  }
  return bad
}

/* ─────────────────────────────────────────────────────────────────────────────
   v727 · 间距护栏
   ─────────────────────────────────────────────────────────────────────────────
   由来：`gap/padding/margin` 的间距字面量共 **5037 处 / 43 个值**，其中
   仅 41% 落在 4 栅格上，45% 卡在两档之间（6/10/14/18），14% 是 1/3/5/7/9 这类微调。
   相邻模块从 6px 到 10px 差 4px（+67%）—— 这正是"看起来不整齐"最直接的来源。

   v727 做了两件事：① 把 2/4/6/8/10/12/14/16/18/20/24/32 起成 12 档令牌
   （`-h` 后缀的是**过渡档**，只为了先让 86% 有名字，P1 归一时删）；② 4199 处字面量
   机械替换成令牌（值不变，零视觉变化）。

   判据（不是"全部禁止" —— 那会让 700 处微调没处去）：
     · 出现了**12 档之内**的裸 px      ⇒ 失败（该用令牌，现已 0 处）
     · 出现了 **OFFGRID_ALLOWED 之外**的值 ⇒ 失败（不许再发明新值）
   放行 `calc(...)` / `var(--x, 兜底)` 内部的值：那是运算，不是间距档。 */
const SP_PROPS = [
  'gap', 'row-gap', 'column-gap',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
]
const SP_DECL = new RegExp('(?<![\\w-])(' + SP_PROPS.join('|') + ')\\s*:\\s*([^;{}\"\'<>]+)', 'g')
const SP_12 = new Set([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 32])
/* 1px = 细边线（柔化 1px 的边不是间距档）；3/5/7/9/11/13 = 微调；15+ = 页面级留白。
   这份集合是**技术债清单**（P1 归一时只删不增），也是"不许发明 17px"的红线。 */
const OFFGRID_ALLOWED = new Set([
  1, 1.5, 3, 5, 7, 9, 11, 13, 15,
  20.8, 22, 26, 28, 30, 34, 36, 38, 38.8, 40,
  42, 44, 46, 48, 60, 62, 72, 80, 96,
])
const SP_PX = /(?<![\w.\-])(\d+(?:\.\d+)?)px/g

function checkSpacing () {
  const bad = []
  for (const abs of walk(SRC)) {
    if (!/\.(vue|css)$/.test(abs)) continue
    const rel = relative(ROOT, abs).split('\\').join('/')
    for (const m of stripComments(readFileSync(abs, 'utf8')).matchAll(SP_DECL)) {
      /* 先摘掉 var(...)，避免把 `var(--x, 8px)` 的兜底值当成裸 px；
         再摘 calc(...)，避免把 `calc(72px + env(...))` 的运算项算成间距。 */
      const body = m[2]
        .replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '')
        .replace(/calc\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '')
      for (const n of body.matchAll(SP_PX)) {
        const v = parseFloat(n[1])
        if (SP_12.has(v)) bad.push({ rel, prop: m[1], v, why: 'sp12' })
        else if (!OFFGRID_ALLOWED.has(v)) bad.push({ rel, prop: m[1], v, why: 'new' })
      }
    }
  }
  return bad
}

const args = new Set(process.argv.slice(2))
const current = collect()
const iconBad = checkIconSizes()
const radiusBad = checkRadius()
const fsBad = checkFontSizes()
const spBad = checkSpacing()
const lhBad = checkLineHeights()
const lhRampBad = checkLineHeightRamp()
const fontRampBad = checkFontRamp()
const mobileBodyBad = checkMobileBodyOnly()
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

if (!violations.length && !iconBad.length && !radiusBad.length && !fsBad.length && !spBad.length && !lhBad.length && !lhRampBad.length && !fontRampBad.length && !mobileBodyBad.length) {
  const files = Object.keys(base).length
  const total = Object.values(base).reduce((a, b) => a + b.length, 0)
  console.log(`✓ 设计令牌护栏通过（存量待清：${files} 个文件 / ${total} 条，见 --list）`)
  console.log(`✓ 图标尺寸护栏通过（允许 ${[...ICON_SIZES].join(' / ')} 四档）`)
  console.log(`✓ 圆角护栏通过（只许 --radius-* / 0 / inherit）`)
  console.log(`✓ 字号护栏通过（只许 var(--fs-*) / 0 / em·rem·%）`)
  console.log(`✓ 间距护栏通过（12 档必须走令牌；离群值不许新增）`)
  console.log(`✓ 行高护栏通过（只许 var(--lh-*) / 0 / normal）`)
  console.log(`✓ 行高阶梯通过（5 档：1 / 1.2 / 1.4 / 1.6 / 1.8）`)
  console.log(`✓ 字号阶梯通过（11 档：11 / 12 / 13 / 14 / 15 / 16 / 18 / 20 / 22 / 24 / 26，无同值重名）`)
  console.log(`✓ 移动端正文隔离通过（--fs-body-m 只出现在 @media 的 body 规则里）`)
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

if (lhBad.length) {
  console.error('\n✗ 行高护栏：出现了 var(--lh-*) 之外的 line-height\n')
  for (const b of lhBad.slice(0, 15)) console.error(`  ${b.rel}\n    line-height: ${b.val}`)
  if (lhBad.length > 15) console.error(`  …… 另有 ${lhBad.length - 15} 处`)
  console.error('\n行高 5 档（variables.css，v729 归一，档位已锁）：')
  console.error('  1 单行控件 | 1.2 标题·大数字 | 1.4 密排·表格 | 1.6 正文 | 1.8 长段落')
  console.error('\n允许例外：0（消除内联空白符，不是"行高为 1"）、normal（UA 算）、')
  console.error('  var(--fc-cell)/calc()（图表单元格尺寸，不是文字行距）。')
  console.error('选哪档看这个元素是"单行控件 / 表格密排 / 多行正文"。\n')
}

if (lhRampBad.length) {
  console.error('\n✗ 行高阶梯：variables.css 的 --lh-* 档位被改动\n')
  for (const b of lhRampBad) console.error(`  ${b.k}: ${b.v ?? '（已删除）'}  ← ${b.why}`)
  console.error('\n阶梯锁死为 5 档（v729 决策，理由见 variables.css 该段注释）：')
  console.error('  --lh-none 1　--lh-title 1.2　--lh-tight 1.4　--lh-normal 1.6　--lh-loose 1.8')
  console.error('要从 11 档退回来的教训：档位越多，选择越随意，1.3px 的差别只有机器看得出。\n')
}

if (fontRampBad.length) {
  console.error('\n✗ 字号阶梯：variables.css 的 --fs-* 档位被改动\n')
  for (const b of fontRampBad) console.error(`  ${b.k}: ${b.v ?? '（已删除）'}  ← ${b.why}`)
  console.error('\n阶梯锁死为 11 档（v732 决策，理由见 variables.css 该段注释）：')
  console.error('  11 xs / 12 sm / 13 base / 14 md / 15 body-m(仅移动端 body) / 16 lg')
  console.error('  18 stat / 20 xl / 22 num / 24 h1 / 26 num-lg')
  console.error('🔴 字号归并与行高风险不同档：行高只影响垂直，字号会改变**文字宽度** ⇒')
  console.error('   换行、截断、表格列宽。改任何一档都要同时跑 1440 与 375 两套视觉回归。\n')
}

if (mobileBodyBad.length) {
  console.error('\n✗ --fs-body-m 用到了 UI 规则上\n')
  for (const b of mobileBodyBad) console.error(`  ${b.rel}:${b.line}\n    ${b.text}`)
  console.error('\n--fs-body-m(15px) 是**移动端正文基准**，只许出现一次：')
  console.error('  @media(max-width:768px){ body{font-size:var(--fs-body-m)} }')
  console.error('UI 用途请用 --fs-md 14（正文/输入框）或 --fs-lg 16（标题/行内数值）。')
  console.error('这条守的是 v732 把 --fs-h4 拆开的成果 —— 一旦 body-m 回到 UI 规则里，「一个名字两个语义」就复活了。\n')
}

if (fsBad.length) {
  console.error('\n✗ 字号护栏：出现了 var(--fs-*) 之外的 font-size\n')
  for (const b of fsBad) console.error(`  ${b.rel}\n    font-size: ${b.val}`)
  console.error('\n字号只分 11 档（定义见 src/styles/variables.css）：')
  console.error('  11 角标/密集表格（中文下限）　12 提示　13 表格/控件　14 正文/输入框')
  console.error('  15 移动端正文（只有 body 能用）　16 标题/行内数值　18 成块统计值')
  console.error('  20 页头　22 KPI 数值　24 主标题　26 大数值')
  console.error('\n允许例外：0（消除空白符）、1.45em（markdown 相对层级）。')
  console.error('改档位请去 variables.css 改令牌值，不要就地写 px —— 就地写只有这一处跟着变。\n')
}

if (spBad.length) {
  console.error('\n✗ 间距护栏：出现不该出现的间距字面量\n')
  const sp12 = spBad.filter((b) => b.why === 'sp12')
  const spNew = spBad.filter((b) => b.why === 'new')
  if (sp12.length) {
    console.error(`  【用令牌】以下 ${sp12.length} 处用了 12 档之内的裸 px：`)
    for (const b of sp12.slice(0, 12)) console.error(`    ${b.rel}  ${b.prop}:${b.v}px`)
    if (sp12.length > 12) console.error(`    …… 另有 ${sp12.length - 12} 处`)
  }
  if (spNew.length) {
    console.error(`  【新值】以下 ${spNew.length} 处发明了 OFFGRID_ALLOWED 之外的值：`)
    for (const b of spNew.slice(0, 12)) console.error(`    ${b.rel}  ${b.prop}:${b.v}px`)
    if (spNew.length > 12) console.error(`    …… 另有 ${spNew.length - 12} 处`)
  }
  console.error('\n间距 12 档（variables.css）：')
  console.error('  2  4  6  8  10  12  14  16  18  20  24  32')
  console.error('  其中 -h 后缀（2/6/10/14/18）是**过渡档**，P1 归一时删。')
  console.error('\n取值请用 var(--sp-1) … var(--sp-7) 或 var(--sp-hN)。')
  console.error('确实需要新档位 ⇒ 先在 variables.css 定义，再改这里允许集合（只增一次，写清理由）。\n')
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
