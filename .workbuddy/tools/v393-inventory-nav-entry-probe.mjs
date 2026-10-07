/* ============================================================
   v393 探针：进销存侧栏入口（批次 6.1）到底"挂对了没"
   ------------------------------------------------------------
   为什么不能"看一眼代码"就交付：
     1) 入口挂错**不报错** —— 图标名写错 ⇒ `Icon.vue` 静默变齿轮；`create.module` 键写错
        ⇒ `canDo` fail-closed **把「＋」全藏掉**；path 写成别的模块 ⇒ 入口冒给不该看的人。
     2) 「角色轴」与「模块轴」是两条轴，肉眼分不出是哪条在拦。
     3) 手机抽屉的「＋」是一段**曾经被刻意留空的分支**（当初理由：唯一带 create 的条目
        属底部栏 ⇒ 永不进抽屉）⇒ 现在条目真进来了，那段模板到底会不会执行，只能实测。

   🔴 本探针不重写任何判据：
     · 权限判据 = 真 `pages.js`（`canSeePage` / `ruleFor` / `ADMIN_ROLES`）；
     · 条目数据 = 从 `Shell.vue` **源码正则抠出**的真 `const NAV`；
     · 收窄逻辑 = 从 `Shell.vue` **源码正则抠出**的真 `function resolveNavItem`。
     三者都在被验的真身里，探针只负责注入 `canSee` / `canDo` 两个替身。

   用法：
     node .workbuddy/tools/v393-inventory-nav-entry-probe.mjs

   🔴 判别力自证（**必须两步都跑**，只跑前者证明不了任何事）：
     # 反例：改动前的 Shell.vue —— 期望大面积红（实测 26 PASS / 13 FAIL）
     git show HEAD:hergent-cn-v2/src/components/Shell.vue > /tmp/Shell.head.vue
     SHELL_PATH=/tmp/Shell.head.vue node .workbuddy/tools/v393-inventory-nav-entry-probe.mjs
     # 正例：当前工作区 —— 期望 39 PASS / 0 FAIL
   ============================================================ */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = path.join(ROOT, 'hergent-cn-v2', 'src')

/* ❶ 最小 DOM 桩：`pages.js` 静态 import 了 `store`（内部读 localStorage）⇒ 原生 node 会崩。
      只补"读不到就崩"的那一个 API，不模拟任何业务行为。 */
const _mem = new Map()
globalThis.localStorage = {
  getItem: k => (_mem.has(k) ? _mem.get(k) : null),
  setItem: (k, v) => { _mem.set(k, String(v)) },
  removeItem: k => { _mem.delete(k) },
  clear: () => _mem.clear(),
}

/* ❷ 真 `pages.js` */
const pagesMod = await import(pathToFileURL(path.join(SRC, 'constants', 'pages.js')).href)
const { canSeePage, ruleFor, ADMIN_ROLES } = pagesMod

/* ❸ 从真源码抠真数据 / 真函数（不手抄）
   🔴 `SHELL_PATH` 环境变量用于**判别力自证**：拿改动前的 Shell.vue（git show HEAD:）跑同一批
      断言，**必须变红** —— 否则这些断言只是"恰好为真"，证明不了任何改动。 */
const shellPath = process.env.SHELL_PATH || path.join(SRC, 'components', 'Shell.vue')
const shellSrc = fs.readFileSync(shellPath, 'utf8')
console.log(`[src] ${shellPath}`)

const navMatch = shellSrc.match(/const NAV = \[[\s\S]*?\n\]/)
if (!navMatch) { console.error('!! 抠不出 `const NAV` —— 结果不可信'); process.exit(9) }
const NAV = new Function(navMatch[0] + '\nreturn NAV')()

const fnMatch = shellSrc.match(/function resolveNavItem\(it\) \{[\s\S]*?\n\}/)
if (!fnMatch) { console.error('!! 抠不出 `resolveNavItem` —— 结果不可信'); process.exit(9) }
const makeResolver = (canSee, canDo) =>
  new Function('canSee', 'canDo', fnMatch[0] + '\nreturn resolveNavItem')(canSee, canDo)

const iconSrc = fs.readFileSync(path.join(SRC, 'components', 'Icon.vue'), 'utf8')
const iconStart = iconSrc.indexOf('const ICONS')
const iconBody = iconSrc.slice(iconStart, iconSrc.indexOf('\n}', iconStart))
const ICON_KEYS = new Set(
  [...iconBody.matchAll(/^\s{2}'?([A-Za-z][A-Za-z0-9-]*)'?\s*:/gm)].map(m => m[1])
)

const mnavMatch = shellSrc.match(/const MNAV_PATHS = \[[^\]]*\]/)
const MNAV_PATHS = mnavMatch
  ? mnavMatch[0].match(/'([^']+)'/g).map(s => s.slice(1, -1))
  : null
if (!MNAV_PATHS) { console.error('!! 抠不出 `MNAV_PATHS`'); process.exit(9) }

const PASS = [], FAIL = []
function ok (name, cond, detail = '') {
  ;(cond ? PASS : FAIL).push(name)
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' | ' + detail : ''}`)
}

/* ❹ 三档模块轴替身（隔离"是哪条轴在拦"） */
const canModAll = () => true                  // 模块全开 ⇒ 只剩角色轴在起作用
const canModInv = m => m === 'inventory'      // 只有进销存能力
const canModNone = () => false                // 什么能力都没有

const ZONE = NAV.find(x => x.key === 'psi')
const colOf = (zone, label) => (zone.groups || []).find(g => g.label === label)
const pathsOf = (zone, label) => (colOf(zone, label) || { items: [] }).items.map(i => i.path)

console.log('\n── ① NAV 结构（进销存区） ──')
ok('①.1 NAV 里存在 key=psi 的进销存区', !!ZONE)
ok('①.2 闸门锚点 path = /inventory', ZONE && ZONE.path === '/inventory', ZONE && ZONE.path)
ok('①.3 一级项图标 package 在 Icon.vue 里存在', ICON_KEYS.has('package'))
ok('①.4 列标题序列 = 采购/销售/库存/往来/其他',
  ZONE && ZONE.groups.map(g => g.label).join(',') === '采购,销售,库存,往来,其他',
  ZONE && ZONE.groups.map(g => g.label).join(','))
ok('①.5 采购列 = [/inventory/purchase]', pathsOf(ZONE, '采购').join(',') === '/inventory/purchase',
  pathsOf(ZONE, '采购').join(','))
ok('①.6 销售列 = [/inventory/sale]', pathsOf(ZONE, '销售').join(',') === '/inventory/sale',
  pathsOf(ZONE, '销售').join(','))
ok('①.7 库存列 = [/inventory/stock, /data-fill]',
  pathsOf(ZONE, '库存').join(',') === '/inventory/stock,/data-fill',
  pathsOf(ZONE, '库存').join(','))
ok('①.8 往来列仍是空数组（页面没做 ⇒ 不许先立空标题）',
  pathsOf(ZONE, '往来').length === 0, String(pathsOf(ZONE, '往来').length))
ok('①.9 其他列 = [/inventory]（工作台）', pathsOf(ZONE, '其他').join(',') === '/inventory',
  pathsOf(ZONE, '其他').join(','))

console.log('\n── ② L1 双入口（create） ──')
const purchase = (colOf(ZONE, '采购') || { items: [] }).items[0] || {}
const sale = (colOf(ZONE, '销售') || { items: [] }).items[0] || {}
ok('②.1 采购单 create.to = /inventory/purchase/new',
  purchase.create && purchase.create.to === '/inventory/purchase/new',
  purchase.create && purchase.create.to)
ok('②.2 采购单 create.module = inventory（键取自 /api/psi 的归属模块）',
  purchase.create && purchase.create.module === 'inventory', purchase.create && purchase.create.module)
ok('②.3 销售单 create.to = /inventory/sale/new',
  sale.create && sale.create.to === '/inventory/sale/new', sale.create && sale.create.to)
ok('②.4 销售单 create.module = inventory',
  sale.create && sale.create.module === 'inventory', sale.create && sale.create.module)
const createsInZone = (ZONE.groups || []).flatMap(g => g.items).filter(i => i.create)
ok('②.5 本区内恰 2 处 create（采购单 / 销售单）—— 无第三处',
  createsInZone.length === 2, String(createsInZone.length))

console.log('\n── ③ 图标名全部在库（写错会静默变齿轮） ──')
const allIcons = NAV.flatMap(x => x.groups ? [x.icon, ...x.groups.flatMap(g => g.items.map(i => i.icon))] : [x.icon])
const missing = [...new Set(allIcons)].filter(n => !ICON_KEYS.has(n))
ok('③.1 NAV 里每个 icon 名都存在', missing.length === 0, missing.join(','))
ok('③.2 双入口右半区用的 plus 在库（模板硬编码的图标名）', ICON_KEYS.has('plus'))

console.log('\n── ④ 文案无英文枚举 ──')
const latin = []
for (const it of [purchase, sale]) {
  if (/[A-Za-z]/.test(it.name || '')) latin.push(it.name)
  if (/[A-Za-z]/.test((it.create || {}).title || '')) latin.push(it.create.title)
}
ok('④.1 新条目的 name / create.title 不含拉丁字母', latin.length === 0, latin.join(','))

console.log('\n── ⑤ 权限：8 条子路由继承 /inventory（v392 的硬约束③：不改 pages.js） ──')
const base = ruleFor('/inventory')
const SUBS = ['/inventory/purchase', '/inventory/purchase/new', '/inventory/purchase/123',
  '/inventory/sale', '/inventory/sale/new', '/inventory/sale/456', '/inventory/stock']
const badInherit = SUBS.filter(p => {
  const r = ruleFor(p)
  return !(r && base && r.module === base.module && r.lock === base.lock
    && r.title === base.title && JSON.stringify(r.roles) === JSON.stringify(base.roles))
})
ok('⑤.1 7 条子路由逐字继承 /inventory（module/lock/title/roles）',
  badInherit.length === 0, badInherit.join(','))
ok('⑤.2 基准行确为 module=inventory + lock=true + ADMIN_ROLES',
  base && base.module === 'inventory' && base.lock === true
  && JSON.stringify(base.roles) === JSON.stringify(ADMIN_ROLES),
  base && JSON.stringify(base.roles))
ok('⑤.3 /data-fill 挂的是**宽模块** stock（所以闸门必须存在）',
  (ruleFor('/data-fill') || {}).module === 'stock',
  ((ruleFor('/data-fill') || {}).module))

console.log('\n── ⑥ 收窄（跑真 resolveNavItem） ──')
const ROLES = ['admin', 'boss', 'supervisor', 'accountant', 'sales', 'distributor', 'guide', 'driver', 'staff']
const resolveFor = (role, canMod, canDo = () => true, custom = null) =>
  makeResolver(p => canSeePage(p, role, canMod, custom), canDo)

const seenByAll = resolveFor('boss', canModAll)(ZONE)
ok('⑥.1 boss + 模块全开 ⇒ 进销存区可见', !!seenByAll)
ok('⑥.2 可见后剩 4 列（往来空列被过滤掉）',
  seenByAll && seenByAll.groups.length === 4,
  seenByAll && String(seenByAll.groups.length) + ':' + seenByAll.groups.map(g => g.label).join(','))
ok('⑥.3 可见后共 5 条', seenByAll && seenByAll.groups.flatMap(g => g.items).length === 5,
  seenByAll && String(seenByAll.groups.flatMap(g => g.items).length))
ok('⑥.4 canDo=true ⇒ 2 处 create 存活',
  seenByAll && seenByAll.groups.flatMap(g => g.items).filter(i => i.create).length === 2)
const noCreate = resolveFor('boss', canModAll, () => false)(ZONE)
ok('⑥.5 🔴 canDo=false ⇒ 2 处 create 被置 null（只读角色看不到「＋」）',
  noCreate && noCreate.groups.flatMap(g => g.items).filter(i => i.create).length === 0)

const roleAxis = ROLES.map(r => {
  const v = resolveFor(r, canModAll)(ZONE)
  return `${r}:${v ? '可见' : '—'}`
})
ok('⑥.6 角色轴：admin/boss 可见，其余 7 角色**全部不可见**',
  resolveFor('admin', canModAll)(ZONE) && resolveFor('boss', canModAll)(ZONE)
  && ROLES.filter(r => r !== 'admin' && r !== 'boss').every(r => resolveFor(r, canModAll)(ZONE) === null),
  roleAxis.join(' '))
ok('⑥.7 模块轴：boss + 只有 inventory ⇒ 可见',
  !!resolveFor('boss', canModInv)(ZONE))
ok('⑥.8 模块轴：boss + 什么模块都没有 ⇒ 不可见（证明 module 轴真在起作用）',
  resolveFor('boss', canModNone)(ZONE) === null)
ok('⑥.9 自定义角色让位也进不来（lock=true）',
  resolveFor('custom_x', canModAll, () => true, ['custom_x'])(ZONE) === null)
ok('⑥.10 老板真实改过权限（customRoles=全角色）仍进不来（lock 的语义）',
  resolveFor('sales', canModAll, () => true, ROLES)(ZONE) === null)

console.log('\n── ⑦ 判别力自证（反例必须与原行为不同，否则本探针是空转） ──')
/* ⑦.1-2：把「闸门锚点」摘掉，看同一份数据会不会冒到业务员侧栏。
   这一步同时回答"path 闸门到底是不是必要的" —— 不是，就不该留在注释里当理由。 */
const ZONE_NO_GATE = { ...ZONE, path: undefined }
ok('⑦.1 反例：业务员**能看见** `/data-fill`（⇒ 闸门若不写，区会冒出来）',
  canSeePage('/data-fill', 'sales', canModAll, null) === true,
  String(canSeePage('/data-fill', 'sales', canModAll, null)))
ok('⑦.2 反例：摘掉 path 后，业务员**会看到**这个叫「进销存」的区；写了 path 就看不到',
  resolveFor('sales', canModAll)(ZONE_NO_GATE) !== null && resolveFor('sales', canModAll)(ZONE) === null)
ok('⑦.3 反例：不存在的路径 `/inventoryx` **不**继承（判据不是"任何路径都命中"）',
  ruleFor('/inventoryx') === null)
ok('⑦.4 正例：业务员手敲 `/inventory/purchase` 也被守卫拦（继承生效）',
  pagesMod.pageRoleAllowed('/inventory/purchase', 'sales', null) === false)
ok('⑦.5 正例：boss 手敲 `/inventory/purchase` 放行',
  pagesMod.pageRoleAllowed('/inventory/purchase', 'boss', null) === true)

console.log('\n── ⑧ 手机抽屉可达性（批次 6.1 同时补了「＋」） ──')
ok('⑧.1 采购单/销售单**不在**底部栏名单里（⇒ 抽屉里会出现）',
  !MNAV_PATHS.includes('/inventory/purchase') && !MNAV_PATHS.includes('/inventory/sale'),
  MNAV_PATHS.join(','))
ok('⑧.2 底部栏仍是 3 项（批次 6.2「手机底部栏放进销存项」未做，本探针只记事实）',
  MNAV_PATHS.length === 3, String(MNAV_PATHS.length))
ok('⑧.3 抽屉模板确实渲染了 `it.create` → `.md-item-new`',
  /class="md-item-new"[\s\S]{0,200}?it\.create/.test(shellSrc) || /v-if="it\.create"[\s\S]{0,120}?md-item-new/.test(shellSrc))
ok('⑧.4 抽屉里带 create 的条目恰为 2 条（采购单 / 销售单）',
  NAV.find(x => x.key === 'psi').groups.flatMap(g => g.items)
    .filter(i => i.create && !MNAV_PATHS.includes(i.path)).length === 2)

console.log('\n' + '='.repeat(72))
console.log(`PASS ${PASS.length} / FAIL ${FAIL.length}`)
if (FAIL.length) { for (const f of FAIL) console.log('  ❌ ' + f) } else { console.log('  全绿 ✅') }
console.log('='.repeat(72))
process.exit(FAIL.length ? 1 : 0)
