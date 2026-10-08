/**
 * v405 —— 「入口可达性」静态推演（不重写判据：加载**真实** pages.js + 抠 **真实** Shell.vue 函数）
 *
 * 为什么需要它：生产上 accountant / supervisor 等角色**没有活跃会话**（token 供给器按真实
 * session 取）⇒ 无法用真机探针验"只读角色能不能进主表"。而本次补「本期预报」直达条目的
 * **全部动机**就是这个。⇒ 用源码级推演回答，判据一律**取自源码**，不手抄。
 *
 * 三条硬判据：
 *   ① 4 条子页条目的 `path` 是否**同一个**'/forecast' ⇒ 若同，则可见性**必然一致**
 *      （`resolveNavItem` 只按 `canSee(x.path)` 收窄）⇒ 实测"对每个角色，4 条结果全等"。
 *   ② 能被 `canSee` 放行的角色集合 == `FORECAST_SUMMARY_ROLES`（真实 roles.js）。
 *   ③ `showInDrawer`（从 Shell.vue **抠出原文**）对 4 条的判定：
 *      3 条带 `tab` ⇒ true（进手机抽屉）；无 `tab` 的 `summary` ⇒ false（归底部栏，不重复）。
 *
 * 运行：NODE_PATH=... node .workbuddy/tools/v405-nav-reach-probe.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '../../hergent-cn-v2/src')
const PASS = [], FAIL = []
const ok = (n, c, d = '') => { (c ? PASS : FAIL).push(n); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + n + (d ? ' | ' + d : '')) }
const section = (t) => console.log('\n' + '─'.repeat(78) + '\n' + t + '\n' + '─'.repeat(78))

/* ── 1. 加载**真实** pages.js（两处加载期适配，与技能 §4.3 同法）──────────────── */
const pagesSrc = fs.readFileSync(path.join(SRC, 'constants/pages.js'), 'utf8')
const tmpName = '__probe_pages_v405.mjs'
let adapted = pagesSrc
  .replace("import { store } from '../store'", 'const store = globalThis.__STORE__')
  .replace("from './roles'", "from './roles.js'")
if (adapted === pagesSrc) { console.error('!! 适配失败（pages.js 的 import 形态变了）⇒ 结果不可信'); process.exit(9) }
fs.writeFileSync(path.join(SRC, 'constants', tmpName), adapted + '\nexport { PAGE_RULES as __PAGE_RULES }\n')

let mod
try {
  globalThis.__STORE__ = { user: { role: '' }, canModule: null, customRoles: null }
  mod = await import(new URL('./' + tmpName, new URL('file://' + path.join(SRC, 'constants') + '/')))
} finally {
  fs.unlinkSync(path.join(SRC, 'constants', tmpName))   // 临时件绝不留在仓库
  console.log('（临时适配文件已删除）')
}
const { canSeePage, PAGE_RULES } = mod

/* ── 2. 从 Shell.vue 抠出**真实** NAV / MNAV_PATHS / EXPLODED_PATHS / showInDrawer ── */
const shell = fs.readFileSync(path.join(SRC, 'components/Shell.vue'), 'utf8')
function grablit(re, name) {
  const m = shell.match(re)
  if (!m) { console.error('!! 抠不到 ' + name + ' ⇒ 结果不可信'); process.exit(9) }
  return eval('(' + m[0].replace(new RegExp('^const ' + name + '\\s*=\\s*'), '').replace(/;\s*$/, '') + ')')
}
const NAV = grablit(/const NAV = \[[\s\S]*?\n\]/, 'NAV')
const MNAV_PATHS = grablit(/const MNAV_PATHS = \[[^\]]*\]/, 'MNAV_PATHS')
const EXPLODED_PATHS = grablit(/const EXPLODED_PATHS = \[[^\]]*\]/, 'EXPLODED_PATHS')
const mShow = shell.match(/function showInDrawer\(x\)\s*\{([\s\S]*?)\n\}/)
if (!mShow) { console.error('!! 抠不到 showInDrawer ⇒ 结果不可信'); process.exit(9) }
const showInDrawer = new Function('MNAV_PATHS', 'EXPLODED_PATHS', 'x', mShow[1])

const fc = NAV.find((x) => x.key === 'forecast')
if (!fc) { console.error('!! NAV 里没有 forecast 区'); process.exit(9) }
const items = fc.groups.flatMap((g) => g.items)

section('① 结构与唯一源核对')
console.log('  forecast 区名 = ' + fc.name + ' | 锚点 path = ' + fc.path + ' | 列 = ' + JSON.stringify(fc.groups.map((g) => g.label)))
console.log('  条目：' + items.map((x) => (x.tab || '(无 tab)') + '→' + x.name).join('  ·  '))
ok('①a 条目数 = 4', items.length === 4, String(items.length))
ok('①b 4 条 path 全等（= 可见性必然同源）', new Set(items.map((x) => x.path)).size === 1, JSON.stringify([...new Set(items.map((x) => x.path))]))
ok('①c 首条无 tab（= 落默认子页 summary）', !items[0].tab && items[0].name === '本期预报', JSON.stringify(items[0]))
ok('①d EXPLODED_PATHS 含 /forecast（v405 补）', EXPLODED_PATHS.includes('/forecast'), JSON.stringify(EXPLODED_PATHS))
ok('①e MNAV_PATHS 含 /forecast（底部栏 = summary 入口）', MNAV_PATHS.includes('/forecast'), JSON.stringify(MNAV_PATHS))

section('② 角色轴：谁能看见本区（真实 canSeePage + 真实 FORECAST_SUMMARY_ROLES）')
const ALL = ['admin', 'boss', 'supervisor', 'accountant', 'staff', 'sales', 'distributor', 'guide', 'driver']
const canMod = () => true                    // 模块轴全开 ⇒ 隔离出「角色轴」这一条
const rows = ALL.map((r) => {
  const res = items.map((x) => canSeePage(x.path, r, canMod, null))
  return { role: r, area: canSeePage('/forecast', r, canMod, null), same: new Set(res).size === 1, res }
})
const seeRoles = rows.filter((r) => r.area).map((r) => r.role)
console.log('  可见角色：' + JSON.stringify(seeRoles))
console.log('  不可见  ：' + JSON.stringify(rows.filter((r) => !r.area).map((r) => r.role)))
ok('②a 可见角色集合 == FORECAST_SUMMARY_ROLES 的 4 个', JSON.stringify(seeRoles.sort()) === JSON.stringify(['accountant', 'admin', 'boss', 'supervisor']), JSON.stringify(seeRoles))
ok('②b 每个角色下 4 条结果**全等**（不存在"进得去却少一条"）', rows.every((r) => r.same), JSON.stringify(rows.filter((r) => !r.same).map((r) => r.role)))
ok('②c 落在"不可见"角色的区块整体不渲染（区域闸门生效）', rows.filter((r) => !r.area).every((r) => r.res.every((v) => v === false)))

section('③ 手机抽屉：showInDrawer（函数体抠自 Shell.vue 原文）')
const dw = items.map((x) => ({ name: x.name, tab: x.tab || '', show: showInDrawer(MNAV_PATHS, EXPLODED_PATHS, x) }))
dw.forEach((x) => console.log('    ' + (x.show ? '进抽屉' : '归底部栏') + '  ' + x.name + (x.tab ? '（tab=' + x.tab + '）' : '（无 tab）')))
ok('③a 三个带 tab 的子页进抽屉', dw.filter((x) => x.tab).every((x) => x.show), JSON.stringify(dw.filter((x) => x.tab).map((x) => x.name)))
ok('③b 无 tab 的「本期预报」归底部栏（抽屉里不重复）', dw.filter((x) => !x.tab).every((x) => !x.show), JSON.stringify(dw.filter((x) => !x.tab).map((x) => x.name)))
const sHistory = items.find((x) => x.tab === 'history')
ok('③c 「＋」（create）只挂在历史期次那一条上（其显示另受 canDo 收口）',
  !!sHistory.create && items.filter((x) => x.create).length === 1, JSON.stringify(items.filter((x) => x.create).map((x) => x.name)))

section('④ 反证（判据不是恒真）')
const bogus = { path: '/forecast', tab: 'ZZ_NOT_EXIST' }
ok('④a 构造一个 tab 非空的虚构条目 ⇒ showInDrawer 判 true（证明 ③b 的 false 来自"无 tab"而非函数恒假）',
  showInDrawer(MNAV_PATHS, EXPLODED_PATHS, bogus) === true)
ok('④b 构造一个不在任何名单里的 path ⇒ 判 true（证明 ③a 的判据不是"什么都 false"）',
  showInDrawer(MNAV_PATHS, EXPLODED_PATHS, { path: '/zz-nowhere' }) === true)
ok('④c canSeePage 对未登记路径放行（fail-open 语义未变）', canSeePage('/zz-nowhere', 'sales', canMod, null) === true)
ok('④d 未登记 ≠ 有权限：真实登记页对 sales 仍为 false', canSeePage('/forecast', 'sales', canMod, null) === false)

section('汇总')
console.log('PASS ' + PASS.length + ' / FAIL ' + FAIL.length)
if (FAIL.length) { console.log('失败项：'); FAIL.forEach((f) => console.log('  - ' + f)) }
process.exit(FAIL.length ? 1 : 0)
