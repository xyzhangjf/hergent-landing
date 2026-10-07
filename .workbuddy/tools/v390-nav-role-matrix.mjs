#!/usr/bin/env node
/**
 * v390（2026-10-07）侧栏重构 · 逐角色渲染矩阵探针（纯 Node，无浏览器、无构建）
 *
 * 目的：把「哪个角色能看到侧栏的**哪一项** / 弹窗里的**哪个条目** / 哪个「＋」」
 *      算出来并**断言**，而不是靠肉眼看一遍。这是《侧边栏归类结构重规划》§七
 *      与技能 `hergent-nav-tab-restructure` 要求的"逐角色影响表"的**可执行版本**。
 *
 * 🔴 为什么不把逻辑抄进探针：抄一遍 = 第二份实现 ⇒ 测的是抄件、不是产品
 *    （本项目反复栽在"同一条规则抄多份"）。本探针**从真实源码里取出**再执行：
 *      · `constants/pages.js` 全文（剥掉两条 import 与依赖 store 的 `canSee` 壳）；
 *      · `Shell.vue` 的 `NAV` 字面量、`resolveNavItem` 函数体、
 *        `navItems` / `mnavItems` / `drawerGroups` 三个 computed 的**原始表达式**、
 *        `MNAV_PATHS`；
 *      · `store/index.js` 的 `canDo` 原始函数体（`permActs` 以 `{value}` 形态注入）；
 *      · 后端 `core.py` 的 `_DEFAULT_PERMS` / `_ALL_MODULES`（走 AST，不 import 后端）。
 *
 * 用法：
 *   node .workbuddy/tools/v390-nav-role-matrix.mjs           # 矩阵 + 断言
 *   node .workbuddy/tools/v390-nav-role-matrix.mjs --json    # 只出 JSON
 *
 * 退出码：0 = 全部断言通过；1 = 有失败。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')                    // laozhangai-product
const FE = path.join(REPO, 'hergent-cn-v2', 'src')
const ERP = process.env.HERGENT_ERP_DIR || '/Users/zhangjunfeng/Documents/hergent-erp'
const PY = process.env.V390_PY || '/Users/zhangjunfeng/.workbuddy/binaries/python/versions/3.13.12/bin/python3'

const PAGES_JS = path.join(FE, 'constants', 'pages.js')
const ROLES_JS = path.join(FE, 'constants', 'roles.js')
const STORE_JS = path.join(FE, 'store', 'index.js')
const SHELL = path.join(FE, 'components', 'Shell.vue')
const CORE_PY = path.join(ERP, 'server', 'core.py')

const JSON_ONLY = process.argv.includes('--json')
const PASS = [], FAIL = []
function check(name, ok, detail = '') {
  ;(ok ? PASS : FAIL).push(name)
  if (!JSON_ONLY) console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   [' + detail + ']' : ''))
  return ok
}

/* ------------------------------------------------------------------ 小工具 */
/** 抹掉 JS/Vue 注释（`//`、`/* *​/`、`<!-- -->`），保留字符串字面量。
 *  🔴 本仓注释刻意大量引用被禁止的写法本身（v390 在 NAV 注释里写了含花括号的样例）
 *     ⇒ 不剥会把注释算进括号配平，或把"注释里提到的样例"当成真实数据。 */
function stripComments(src) {
  let out = '', i = 0, quote = ''
  const n = src.length
  while (i < n) {
    const c = src[i], nxt = i + 1 < n ? src[i + 1] : ''
    if (quote) {
      out += c
      if (c === '\\') { if (nxt) { out += nxt; i += 2; continue } }
      else if (c === quote) quote = ''
      i += 1
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i += 1; continue }
    if (src.startsWith('<!--', i)) { const j = src.indexOf('-->', i + 4); i = j < 0 ? n : j + 3; out += ' '; continue }
    if (c === '/' && nxt === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; out += ' '; continue }
    if (c === '/' && nxt === '/') { const j = src.indexOf('\n', i); i = j < 0 ? n : j; continue }
    out += c; i += 1
  }
  return out
}

/** 从 `startIdx`（指向开括号）起取**配平**的整段（含括号）。 */
function balanced(src, startIdx, open, close) {
  let d = 0
  for (let i = startIdx; i < src.length; i++) {
    const c = src[i]
    if (c === open) d++
    else if (c === close) { d--; if (d === 0) return src.slice(startIdx, i + 1) }
  }
  throw new Error('括号不配平 @' + startIdx)
}

/** 取 `const NAME = computed( <这里> )` 里那一段**表达式原文**，并按给定自由变量**就地求值**。 */
function evalComputed(code, name, freeNames, freeVals) {
  const dIdx = code.indexOf('const ' + name + ' = computed(')
  if (dIdx < 0) throw new Error('找不到 const ' + name + ' = computed(')
  const pIdx = code.indexOf('computed(', dIdx) + 'computed('.length - 1
  const argText = balanced(code, pIdx, '(', ')').slice(1, -1)
  // ⚠️ 末尾的 `()` 不能省：`computed(() => …)` 的参数是一个**箭头函数**，
  //    只 `return (…)` 会把函数本身返回回来（本轮实测踩到：`navItems.map is not a function`）。
  const fn = new Function('computed', ...freeNames, 'return (' + argText + ')()')
  return fn((f) => f(), ...freeVals)
}

/* ------------------------------------------------------------------ 载入真实源码 */
const shellSrc = fs.readFileSync(SHELL, 'utf8')
const shellCode = stripComments(shellSrc)

// NAV 字面量（纯字面量，无函数调用 ⇒ 直接求值；这一步本身就是"NAV 必须保持字面量"的护栏）
const navIdx = shellCode.indexOf('const NAV = [')
if (navIdx < 0) throw new Error('Shell.vue 里找不到 `const NAV = [`')
const NAV = new Function('return (' + balanced(shellCode, shellCode.indexOf('[', navIdx), '[', ']') + ')')()
const MNAV_PATHS = new Function('return (' +
  balanced(shellCode, shellCode.indexOf('[', shellCode.indexOf('const MNAV_PATHS = [')), '[', ']') + ')')()
const NAV_ITEM_NAMES = NAV.map((it) => it.name)

// resolveNavItem 的**真函数体**
function extractFnBody(code, sig) {
  const i = code.indexOf(sig)
  if (i < 0) throw new Error('找不到 ' + sig)
  return balanced(code, code.indexOf('{', i), '{', '}').slice(1, -1)
}
const RNI_BODY = extractFnBody(shellCode, 'function resolveNavItem(')
/* ⚠️ `resolveNavItem` 把 `canSee` / `canDo` 当**形参**（真实代码里它们是模块级自由变量）
   ⇒ 取出来的函数必须**按上下文绑一次**再用，直接塞进 `computed` 会因为
   `canSee is not a function` 炸掉（本轮实测踩到）。 */
const makeResolveNavItem = (body) => new Function('canSee', 'canDo', 'it', body)
const bindRni = (body, canSee, canDo) => {
  const f = makeResolveNavItem(body)
  return (it) => f(canSee, canDo, it)
}

// store 的 canDo 真函数体
const canDoBody = extractFnBody(stripComments(fs.readFileSync(STORE_JS, 'utf8')), 'function canDo(module, action)')
const canDoReal = new Function('permActs', 'module', 'action', canDoBody)

// pages.js：剥掉 import + 依赖 store 的 `canSee` 壳，落到临时 .mjs 再 import
const pagesSrc = fs.readFileSync(PAGES_JS, 'utf8')
let pagesTmp = pagesSrc
  .replace(/^import .*from '\.\/roles'$/m, '')
  .replace(/^import .*from '\.\.\/store'$/m, '')
const csIdx = pagesTmp.indexOf('export function canSee(path) {')
if (csIdx < 0) throw new Error('pages.js 里找不到 canSee 壳')
const csBrace = pagesTmp.indexOf('{', csIdx)
pagesTmp = pagesTmp.slice(0, csIdx) +
  pagesTmp.slice(csBrace + balanced(pagesTmp, csBrace, '{', '}').length)
const tmpPages = path.join(os.tmpdir(), 'v390-pages-' + process.pid + '.mjs')
fs.writeFileSync(tmpPages, 'import { roleIn, normRole, FORECAST_SUMMARY_ROLES, ZHOUPU_IMPORT_ROLES } from ' +
  JSON.stringify(ROLES_JS) + '\n' + pagesTmp)
const pagesMod = await import(url.pathToFileURL(tmpPages).href)
fs.unlinkSync(tmpPages)
const { canSeePage } = pagesMod

// 后端 _DEFAULT_PERMS / _ALL_MODULES（AST，不 import 后端）
const dumpPy = `
import ast, sys, json
t = ast.parse(open(sys.argv[1], encoding='utf-8').read())
def lit(name):
    for n in ast.walk(t):
        if isinstance(n, ast.Assign) and any(getattr(x, 'id', None) == name for x in n.targets):
            return ast.literal_eval(n.value)
print(json.dumps({'roles': lit('_DEFAULT_PERMS'), 'allModules': lit('_ALL_MODULES')}))
`
const be = JSON.parse(execFileSync(PY, ['-c', dumpPy, CORE_PY], { encoding: 'utf8' }))
const DEFAULT_PERMS = be.roles
const ALL_MODULES = be.allModules
const ROLES = Object.keys(DEFAULT_PERMS)

/* ------------------------------------------------------------------ 模拟一次渲染 */
/** 造一个角色的上下文：`canSee`（走真实 `canSeePage`）+ `canDo`（走真实函数体）。 */
function ctxOf(role, modules, customRoles) {
  const mods = modules || []
  const canModule = (m) => mods.includes('*') || mods.includes(m)
  const permActs = {}
  for (const m of mods) {
    if (m === '*') permActs['*'] = ['read', 'create', 'update', 'delete']
    else permActs[m] = ['read', 'create', 'update', 'delete']
  }
  const paRef = Object.keys(permActs).length ? { value: permActs } : { value: null }
  const canDo = (m, a) => canDoReal(paRef, m, a)
  const canSee = (p) => canSeePage(p, role, canModule, customRoles)
  const rni = bindRni(RNI_BODY, canSee, canDo)
  const navItems = evalComputed(shellCode, 'navItems', ['NAV', 'resolveNavItem'], [NAV, rni])
  const mnavItems = evalComputed(shellCode, 'mnavItems', ['NAV', 'MNAV_PATHS', 'canSee'], [NAV, MNAV_PATHS, canSee])
  const drawerGroups = evalComputed(shellCode, 'drawerGroups', ['NAV', 'resolveNavItem', 'MNAV_PATHS'], [NAV, rni, MNAV_PATHS])
  return { role, modules: mods, customRoles, canSee, canDo, navItems, mnavItems, drawerGroups }
}

const AXES = [
  { key: 'A', label: '默认权限（租户未改）', mk: (role) => ({ modules: DEFAULT_PERMS[role] || [], customRoles: null }) },
  { key: 'B', label: '让位全开（全模块 + 已改权限）', mk: () => ({ modules: ALL_MODULES.slice(), customRoles: null }) },
  { key: 'C', label: '最小模块（专测「＋」门禁）', mk: () => ({ modules: ['forecast'], customRoles: null }) },
]
// B/C 两档要让「让位」这一档真正生效（customRoles 必须含该角色，否则角色轴照旧收紧）
for (const ax of AXES) {
  const orig = ax.mk
  ax.mk = (role) => { const r = orig(role); if (ax.key !== 'A') r.customRoles = [role]; return r }
}

const MATRIX = {}
for (const ax of AXES) {
  MATRIX[ax.key] = {}
  for (const role of ROLES) {
    const { modules, customRoles } = ax.mk(role)
    MATRIX[ax.key][role] = ctxOf(role, modules, customRoles)
  }
}

/* ------------------------------------------------------------------ 断言 */
const flatPaths = (ctx) => ctx.navItems.map((it) => (it.groups ? it.name + '›' : it.path))
const allPaths = (ctx) => {
  const out = []
  for (const it of ctx.navItems) {
    if (it.groups) { for (const g of it.groups) for (const x of g.items) out.push(x.path) }
    else out.push(it.path)
  }
  return out
}

if (!JSON_ONLY) {
  console.log('══ v390 侧栏逐角色渲染矩阵 ══')
  console.log(`角色 ${ROLES.length} 个：${ROLES.join(', ')}\n`)
  for (const ax of AXES) {
    console.log(`── 档 ${ax.key}：${ax.label} ──`)
    for (const role of ROLES) {
      const c = MATRIX[ax.key][role]
      console.log('   ' + role.padEnd(12) + (flatPaths(c).join(' ') || '（空）'))
    }
    console.log('')
  }
  console.log('══ 断言 ══')
}

// P1 空列 / 空弹窗绝不出现
{
  let bad = []
  for (const ax of AXES) for (const role of ROLES) {
    for (const it of MATRIX[ax.key][role].navItems) {
      if (it.groups) {
        if (!it.groups.length) bad.push(`${ax.key}/${role}: 区「${it.name}」groups 为空`)
        for (const g of it.groups) if (!g.items.length) bad.push(`${ax.key}/${role}: 「${it.name} › ${g.label}」空列`)
      } else if (!it.path) bad.push(`${ax.key}/${role}: 扁平项无 path`)
    }
  }
  check('P1 空列 / 空弹窗一个都不出现（全 9 角色 × 3 档）', !bad.length, bad.slice(0, 4).join('; '))
}

// P2/P3 进销存（lock:true）只给 admin / boss —— 两个直达档都不得漏
{
  const leak = []
  for (const ax of AXES) for (const role of ROLES) {
    const seen = allPaths(MATRIX[ax.key][role]).includes('/inventory') ||
      MATRIX[ax.key][role].navItems.some((it) => it.name === '进销存')
    if (seen && role !== 'admin' && role !== 'boss') leak.push(`${ax.key}/${role}`)
  }
  check('P2 进销存区任何档位都只给 admin / boss（`lock:true` 让位也放不开）',
    !leak.length, leak.join(', '))
  check('P3 boss 确实看得到进销存区（判据不是靠"谁都看不到"蒙对）',
    MATRIX.A.boss.navItems.some((it) => it.name === '进销存'),
    'boss 档 A：' + flatPaths(MATRIX.A.boss).join(' '))
}

// P4 区闸门（∩ 而非 ∪）：区内条目可见 ≠ 区可见
{
  // 反例前提：档 B 下 accountant / sales / supervisor 各自**确实**能看到 /data-fill
  //   （有 stock + 在 BIZ_ROLES + 让位）⇒ 若区少了 `/inventory` 闸门，就叫"进销存"漏给他们。
  const premise = ['accountant', 'sales', 'supervisor'].map((r) => ({
    r, item: MATRIX.B[r].canSee('/data-fill'),
  }))
  const premiseOk = premise.every((x) => x.item)
  const breach = ['accountant', 'sales', 'supervisor'].filter((r) =>
    MATRIX.B[r].navItems.some((it) => it.name === '进销存'))
  check('P4 反例前提成立：档 B 下 会计/业务员/主管**确实**能看到区内条目 /data-fill',
    premiseOk, premise.map((x) => x.r + '=' + x.item).join(' '))
  check('P5 即便如此，「进销存」区也没漏给他们（区闸门与条目闸门是 ∩，不是 ∪）',
    !breach.length, breach.join(', '))
}

// P6 变异自证：抹掉区闸门 ⇒ P5 必须转红（判据有判别力）
{
  const mutated = RNI_BODY.replace('if (it.path && !canSee(it.path)) return null', '')
  const leaked = ['accountant', 'sales', 'supervisor'].filter((role) => {
    const c = ctxOf(role, ALL_MODULES.slice(), [role])
    const rniMut = bindRni(mutated, c.canSee, c.canDo)
    return evalComputed(shellCode, 'navItems', ['NAV', 'resolveNavItem'], [NAV, rniMut])
      .some((it) => it.name === '进销存')
  })
  check('P6 变异自证：抹掉 `resolveNavItem` 的区闸门 ⇒ 进销存立刻漏给 3 个角色（判据有判别力）',
    mutated !== RNI_BODY && leaked.length === 3, '抹掉后漏出: ' + (leaked.join(', ') || '（无 ⇒ 判据失效）'))
}

// P7 「＋」（L1 双入口）只给有 data.create 的角色
{
  const findHist = (ctx) => {
    const area = ctx.navItems.find((it) => it.name === '预报订单管理')
    if (!area) return null
    return area.groups.flatMap((g) => g.items).find((x) => x.name === '历史期次') || null
  }
  const cA = MATRIX.A.boss
  const histA = findHist(cA)
  const histC = ROLES.map((r) => ({ r, h: findHist(MATRIX.C[r]) }))
  const visibleC = histC.filter((x) => x.h)
  check('P7 档 A：boss 的「历史期次」条目带「＋」（有 data.create ⇒ 不该被藏）',
    !!histA && !!histA.create, histA ? JSON.stringify(histA.create) : '（找不到条目）')
  check('P8 档 C（只给 forecast 模块）：所有看到该条目的角色，「＋」都被收掉（fail-closed）',
    visibleC.length > 0 && visibleC.every((x) => x.h.create === null),
    '看到条目 %d 个角色，其中带＋的 %d 个'.replace('%d', visibleC.length)
      .replace('%d', visibleC.filter((x) => x.h.create).length))
}

// P9 变异自证：抹掉 canDo 过滤 ⇒ 「＋」立刻漏给无 data 的角色
{
  const mutated = RNI_BODY.replace(
    ".map(x => (x.create && !canDo(x.create.module, 'create')) ? { ...x, create: null } : x)", '')
  const leaked = ROLES.filter((role) => {
    const c = ctxOf(role, ['forecast'], [role])
    if (!c.navItems.find((it) => it.name === '预报订单管理')) return false   // 该角色档 C 下看不到该区 ⇒ 不参与
    const rniMut = bindRni(mutated, c.canSee, c.canDo)
    const nav = evalComputed(shellCode, 'navItems', ['NAV', 'resolveNavItem'], [NAV, rniMut])
    const area = nav.find((it) => it.name === '预报订单管理')
    if (!area) return false
    const h = area.groups.flatMap((g) => g.items).find((x) => x.name === '历史期次')
    return !!(h && h.create)
  })
  check('P9 变异自证：抹掉 `canDo` 过滤 ⇒ 「＋」立刻漏给无 data 的角色（判据有判别力）',
    mutated !== RNI_BODY && leaked.length > 0,
    '抹掉后漏出: ' + (leaked.join(', ') || '（无 ⇒ 判据失效）'))
}

// P10 三个渲染面同源：底部栏 ⊂ NAV 且都过 canSee；抽屉不重复底部栏三项
{
  const bad = []
  for (const ax of AXES) for (const role of ROLES) {
    const c = MATRIX[ax.key][role]
    for (const m of c.mnavItems) if (!c.canSee(m.path)) bad.push(`${ax.key}/${role}: 底部栏 ${m.path} 未过 canSee`)
    for (const g of c.drawerGroups) for (const it of g.items) {
      if (MNAV_PATHS.includes(it.path)) bad.push(`${ax.key}/${role}: 抽屉重复底部栏 ${it.path}`)
      if (!c.canSee(it.path)) bad.push(`${ax.key}/${role}: 抽屉 ${it.path} 未过 canSee`)
    }
  }
  check('P10 底部栏 / 抽屉与侧栏同源：都过 canSee、抽屉不重复底部栏三项', !bad.length, bad.slice(0, 4).join('; '))
}

// P11 NAV 一级项名与权限页组名一致（与 python 护栏同一条契约，这里再证一次可执行性）
check('P11 NAV 一级项 = 8 项（2 直达 + 6 职能区）', NAV.filter((it) => !it.groups).length === 2 &&
  NAV.filter((it) => it.groups).length === 6, NAV_ITEM_NAMES.join(' / '))

/* ------------------------------------------------------------------ 收口 */
if (JSON_ONLY) {
  console.log(JSON.stringify({
    roles: ROLES,
    navNames: NAV_ITEM_NAMES,
    matrix: Object.fromEntries(AXES.map((ax) => [ax.key, Object.fromEntries(
      ROLES.map((r) => [r, MATRIX[ax.key][r].navItems.map((it) => it.groups
        ? { area: it.name, items: it.groups.flatMap((g) => g.items.map((x) => ({ name: x.name, path: x.path, create: !!x.create }))) }
        : { path: it.path, name: it.name })])),
    ])),
    pass: PASS.length, fail: FAIL.length, failures: FAIL,
  }, null, 2))
} else {
  console.log('\n' + '-'.repeat(62))
  console.log(`断言 ${PASS.length}/${PASS.length + FAIL.length} 通过`)
  if (FAIL.length) { console.log('失败项:'); for (const f of FAIL) console.log('   - ' + f) }
}
process.exit(FAIL.length ? 1 : 0)
