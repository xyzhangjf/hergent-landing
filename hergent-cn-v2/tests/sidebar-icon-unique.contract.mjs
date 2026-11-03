/* v747 契约：侧栏一级区（L1）的图标必须**互不相同**，且图标名必须真实存在。
 *
 * 报障原话：「侧边栏『经营分析和数据报表』前面的图标是一样的」
 *
 * 根因：`Shell.vue` 的 NAV 里 `analytics`（经营分析）与 `reports`（数据报表）都写了
 *   `icon: 'bar-chart'`。渲染不报错、点击都正常 ⇒ 功能测全绿，只有**看**才看得出来。
 *   这类缺陷的共性：**同一位置的两个并列项形状相同**，用户只能靠读字区分。
 *
 * 🔴 三条判据，缺一条就有一类缺陷能溜过去：
 *   ① **唯一性**：L1 图标不得重复（撞图标就是本条要防的病）
 *   ② **存在性**：图标名必须在 `Icon.vue::ICONS` 里 —— 🔴 写错**不会报错**，
 *      `paths` 兜底 `|| ICONS.settings` 会**静默渲染成齿轮**（v453 教训）。
 *      只查唯一性的话，把两个都改成 `foo-bar` 也能"全唯一通过"，实为两个齿轮。
 *   ③ **跨处一致**：⌘K 命令面板里「数据报表」组的图标必须与侧栏那个区一致 ——
 *      同一概念两处图标不同，比撞图标更难向用户解释。
 *   ④ **解析自检**：抽到的区数必须 ≥ 10。若正则失效抽成空集，①②③ 会**全票通过**，
 *      这是"冻结数用不满也报错"的同一条纪律。
 *
 * 全部判据都是**纯函数**（输入源码字符串），下面用坏样本逐条自证会红。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SHELL = path.join(ROOT, 'src/components/Shell.vue')
const ICON = path.join(ROOT, 'src/components/Icon.vue')
const PALETTE = path.join(ROOT, 'src/components/CommandPalette.vue')

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else { console.log('  ❌ ' + label + (extra ? ' ' + extra : '')); failed++ }
}

/** 剥注释：注释里写着旧图标名与教训，不剥必假阳性/假阴性。 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* 区级条目形如：`key: 'reports', name: '数据报表', icon: 'file-text', path: ...`
   子项是 `{ path: ..., name: ..., icon: ... }`（无 key）⇒ 用 `key:` 前缀天然只命中 L1。 */
const L1_RE = /key:\s*'([a-z-]+)'\s*,\s*name:\s*'([^']+)'\s*,\s*icon:\s*'([a-z-]+)'/g

const parseL1 = (shellSrc) => {
  const code = strip(shellSrc)
  const out = []
  let m
  L1_RE.lastIndex = 0
  while ((m = L1_RE.exec(code))) out.push({ key: m[1], name: m[2], icon: m[3] })
  return out
}

/** Icon.vue 的 ICONS 键（单行 key 与多行数组都覆盖：取 `  name:` 开头的键名）。 */
const parseIconNames = (iconSrc) => {
  const code = strip(iconSrc)
  const block = (code.match(/const ICONS\s*=\s*\{([\s\S]*?)\n\}/) || [])[1] || ''
  const names = new Set()
  for (const line of block.split('\n')) {
    const m = line.match(/^\s{2}'?([a-z][a-z0-9-]*)'?\s*:/)
    if (m) names.add(m[1])
  }
  return names
}

/** ⌘K 里「数据报表」组的图标。 */
const parsePaletteReportsIcon = (pSrc) => {
  const code = strip(pSrc)
  const m = code.match(/group:\s*'数据报表'\s*,\s*icon:\s*'([a-z-]+)'/)
  return m ? m[1] : null
}

/* ---------------- 判据 ---------------- */

/** ① 唯一性 → 返回撞车的 [icon, [区名...]] 列表 */
const dupIcons = (l1) => {
  const by = new Map()
  for (const r of l1) {
    if (!by.has(r.icon)) by.set(r.icon, [])
    by.get(r.icon).push(r.name)
  }
  return [...by.entries()].filter(([, names]) => names.length > 1)
}

/** ② 存在性 → 返回 Icon.vue 里查不到的图标名 */
const missingIcons = (l1, iconNames) => l1.filter(r => !iconNames.has(r.icon))

/* ---------------- 真实源码 ---------------- */

const shellSrc = fs.readFileSync(SHELL, 'utf8')
const iconSrc = fs.readFileSync(ICON, 'utf8')
const paletteSrc = fs.readFileSync(PALETTE, 'utf8')

const L1 = parseL1(shellSrc)
const ICON_NAMES = parseIconNames(iconSrc)

/* ④ 解析自检（必须最先：抽成空集时后面全票通过，等于空白支票） */
ok(L1.length >= 10, `解析自检：抽到 ${L1.length} 个侧栏一级区（要求 ≥ 10）`)
ok(ICON_NAMES.size >= 40, `解析自检：抽到 ${ICON_NAMES.size} 个图标名（要求 ≥ 40）`)

/* ① 唯一性 */
const dups = dupIcons(L1)
ok(dups.length === 0, '侧栏一级区图标互不重复',
  dups.length ? '撞车：' + dups.map(([ic, ns]) => `${ic} ← ${ns.join(' / ')}`).join('；') : `（${L1.length} 个区全唯一）`)

/* ② 存在性 */
const miss = missingIcons(L1, ICON_NAMES)
ok(miss.length === 0, '侧栏一级区图标名都存在于 Icon.vue（写错会静默变齿轮）',
  miss.length ? '查不到：' + miss.map(r => `${r.name}→${r.icon}`).join('、') : '')

/* ③ 跨处一致：⌘K 的「数据报表」组 == 侧栏 reports 区 */
const shellReports = L1.find(r => r.key === 'reports')
const palIcon = parsePaletteReportsIcon(paletteSrc)
ok(!!shellReports && palIcon === shellReports.icon,
  '⌘K「数据报表」组图标与侧栏一致',
  `侧栏=${shellReports ? shellReports.icon : '(未找到 reports 区)'} / ⌘K=${palIcon || '(未找到)'}`)

/* ---------------- 坏样本自证 ---------------- */
console.log('  —— 坏样本自证（每条都必须变红，否则护栏是假的）——')

/* 样本 A：把 reports 改回 bar-chart（正是本次报障的原始状态） */
{
  const bad = shellSrc.replace(
    /key:\s*'reports',\s*name:\s*'数据报表',\s*icon:\s*'[a-z-]+'/,
    "key: 'reports', name: '数据报表', icon: 'bar-chart'")
  const l1 = parseL1(bad)
  const d = dupIcons(l1)
  ok(d.length === 1 && d[0][0] === 'bar-chart' && d[0][1].length === 2,
    '坏样本 A：reports 改回 bar-chart ⇒ 唯一性判据报红',
    d.length ? `抓到 ${d[0][1].join(' / ')}` : '❗没抓到（判据失效）')
}

/* 样本 B：改成一个不存在的图标名 ⇒ 唯一性可能仍"通过"，必须靠存在性拦住 */
{
  const bad = shellSrc.replace(
    /key:\s*'reports',\s*name:\s*'数据报表',\s*icon:\s*'[a-z-]+'/,
    "key: 'reports', name: '数据报表', icon: 'report-doc'")
  const l1 = parseL1(bad)
  const m = missingIcons(l1, ICON_NAMES)
  ok(m.length === 1 && m[0].icon === 'report-doc',
    '坏样本 B：不存在的图标名 ⇒ 存在性判据报红（否则会静默变齿轮）',
    m.length ? `抓到 ${m[0].name}→${m[0].icon}` : '❗没抓到（判据失效）')
  ok(dupIcons(l1).length === 0,
    '坏样本 B 反证：此样本唯一性仍"通过" ⇒ 单靠唯一性拦不住拼写错')
}

/* 样本 C：解析失效（NAV 全删）⇒ 解析自检必须报红 */
{
  const l1 = parseL1('const NAV = []')
  ok(l1.length === 0, '坏样本 C：正则抽不到区时返回空集（该态由 ④ 解析自检拦住）')
  ok(!(l1.length >= 10), '坏样本 C 反证：空集会触发解析自检失败，不会静默全通过')
}

/* 样本 D：⌘K 图标与侧栏不一致 ⇒ ③ 报红 */
{
  const badP = paletteSrc.replace(
    /group:\s*'数据报表',\s*\/\*[\s\S]*?\*\/\s*icon:\s*'[a-z-]+'/,
    "group: '数据报表', icon: 'bar-chart'")
  const badP2 = badP === paletteSrc
    ? paletteSrc.replace(/group:\s*'数据报表',\s*icon:\s*'[a-z-]+'/, "group: '数据报表', icon: 'bar-chart'")
    : badP
  const pi = parsePaletteReportsIcon(badP2)
  ok(pi === 'bar-chart' && shellReports && pi !== shellReports.icon,
    '坏样本 D：⌘K 改回 bar-chart ⇒ 跨处一致判据报红',
    `侧栏=${shellReports && shellReports.icon} / ⌘K=${pi}`)
}

/* ---------------- 结论 ---------------- */
if (failed) {
  console.log(`\n❌ sidebar-icon-unique: ${failed} 条不通过`)
  process.exit(1)
}
console.log('\n✅ sidebar-icon-unique: 全部通过')
