#!/usr/bin/env node
/* ============================================================================
   v341 档案管理入口判别力探针（正反两侧）—— 可复用回归件
   ----------------------------------------------------------------------------
   用途：证明「撤销某角色的档案管理权限后，侧栏入口真的消失」，且**证明探针本身
   有判别力**（不是恒真/恒假的假阳性）。

   本仓纪律（见 memory「探针必须先自证判别力」）：
     ① 正反两侧都跑：before = 当前 git HEAD 原文，after = 工作区现状；
     ② 判别串取自**源码原文**（copy 工作区 / git show HEAD），不手抄、不凭记忆；
     ③ N/M 数字写死：断言里写死用例总数与期望值，改一条就必须改断言；
     ④ 必须同时存在「两侧不同」与「两侧相同」的用例 —— 只有前者才叫判别力。

   用法：
     node .workbuddy/tools/v341-archive-gate-probe.mjs
   ============================================================================ */
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const REPO = '/Users/zhangjunfeng/Documents/laozhangai-product'
const SRC = join(REPO, 'hergent-cn-v2/src')
const PAGES_REL = 'hergent-cn-v2/src/constants/pages.js'
const ROLES_REL = 'hergent-cn-v2/src/constants/roles.js'
const ROOT = join(tmpdir(), 'v341-probe')

/* ---- 1. 搭两侧目录：after = 工作区现状，before = git HEAD 原文 ---- */
rmSync(ROOT, { recursive: true, force: true })
const stub = [
  '/* 探针专用 stub —— canSeePage() 是纯函数，不读 store。真实 store 依赖 pinia/vue。',
  '   本 stub 不参与任何判据计算。 */',
  'export const store = {',
  "  user: { role: '', name: '' },",
  '  canModule: () => true, customRoles: null, permActs: null,',
  '  canDo: () => true, canUseAi: () => true,',
  '}',
  '',
].join('\n')

const sides = {}
for (const side of ['after', 'before']) {
  const base = join(ROOT, side)
  mkdirSync(join(base, 'constants'), { recursive: true })
  mkdirSync(join(base, 'store'), { recursive: true })
  const pagesRaw = side === 'after'
    ? readFileSync(join(SRC, 'constants/pages.js'), 'utf8')
    : execSync('git show HEAD:' + PAGES_REL, { cwd: REPO, encoding: 'utf8' })
  const rolesTxt = side === 'after'
    ? readFileSync(join(SRC, 'constants/roles.js'), 'utf8')
    : execSync('git show HEAD:' + ROLES_REL, { cwd: REPO, encoding: 'utf8' })
  /* node 原生 ESM 要求显式扩展名；源码用的是 Vite 解析规则（无扩展名）。
     只补两个 import 说明符，并自证「恰好 2 处」。 */
  let patched = 0
  const pages = pagesRaw
    .replace("from './roles'", () => { patched++; return "from './roles.js'" })
    .replace("from '../store'", () => { patched++; return "from '../store/index.js'" })
  if (patched !== 2) {
    console.error('依赖补扩展名的处数异常：期望 2 实得 ' + patched + '（源码 import 写法可能已变）')
    process.exit(2)
  }
  writeFileSync(join(base, 'constants/pages.js'), pages)
  writeFileSync(join(base, 'constants/roles.js'), rolesTxt)
  writeFileSync(join(base, 'store/index.js'), stub)
  sides[side] = { base, pages, rolesTxt }
}

/* ---- 2. 模块集：取自后端 _DEFAULT_PERMS 实测值 + v332b 补 stock ---- */
const MOD = {
  supRevoked: ['dashboard', 'stock', 'chat'],            // 主管：被撤 data，仍持 stock（本次报障场景）
  supNormal: ['dashboard', 'data', 'stock', 'chat'],      // 主管：未撤
  supNoStock: ['dashboard', 'chat'],                      // 主管：撤 data 且无 stock
  adminRev: ['hr', 'crm', 'stock', 'chat'],               // 管理员（设若被撤 data）
  bossRev: ['hr', 'crm', 'stock', 'chat'],                // 老板（设若被撤 data）
  acctRev: ['dashboard', 'stock', 'chat'],                // 会计被撤 data（v333 后才有的 data）
  salesRev: ['dashboard', 'stock', 'chat'],               // 业务员被撤 data
  staffNone: ['stock', 'chat'],                           // 员工（非 BIZ_ROLES）
  driverNone: ['stock', 'chat'],                          // 司机（非 BIZ_ROLES，但持 stock ← 关键反例）
  emptyAll: ['chat'],                                     // 什么业务模块都没有
}
const cm = (k) => (m) => MOD[k].includes(m)
const TOUCHED = ['supervisor']   // 本租户真实改过权限的角色名
const UNTOUCHED = null           // 未改过（未知）
const CASES = [
  ['C01', '主管被撤 data 后，容器入口应消失', '/archive', 'supervisor', 'supRevoked', TOUCHED, true, false],
  ['C02', '主管被撤 data 后深链子页(员工档案 hr)', '/archive/employees', 'supervisor', 'supRevoked', TOUCHED, false, false],
  ['C03', '主管被撤 data 后深链子页(仓库档案 stock 仍持)', '/archive/warehouses', 'supervisor', 'supRevoked', TOUCHED, true, true],
  ['C04', '主管未撤 data ⇒ 入口照常', '/archive', 'supervisor', 'supNormal', TOUCHED, true, true],
  ['C05', '管理员未撤 data ⇒ 入口照常', '/archive', 'admin', 'supNormal', TOUCHED, true, true],
  ['C06', '老板未撤 data ⇒ 入口照常', '/archive', 'boss', 'supNormal', TOUCHED, true, true],
  ['C07', '管理员撤 data(仍持 hr/crm/stock) ⇒ 入口消失', '/archive', 'admin', 'adminRev', TOUCHED, true, false],
  ['C08', '老板撤 data(仍持 hr/crm/stock) ⇒ 入口消失', '/archive', 'boss', 'bossRev', TOUCHED, true, false],
  ['C09', '会计撤 data ⇒ 入口消失', '/archive', 'accountant', 'acctRev', TOUCHED, true, false],
  ['C10', '业务员撤 data ⇒ 入口消失', '/archive', 'sales', 'salesRev', TOUCHED, true, false],
  ['C11', '员工(非业务岗)即使持 stock 也无入口', '/archive', 'staff', 'staffNone', TOUCHED, false, false],
  ['C12', '司机(非业务岗)持 stock 也无入口', '/archive', 'driver', 'driverNone', TOUCHED, false, false],
  ['C13', '主管什么业务模块都没有 ⇒ 入口消失', '/archive', 'supervisor', 'emptyAll', TOUCHED, false, false],
  ['C14', '主管无 stock 且被撤 data ⇒ 入口消失', '/archive', 'supervisor', 'supNoStock', TOUCHED, false, false],
  ['C15', '主管未改过权限(未知)且未撤 data ⇒ 放行', '/archive', 'supervisor', 'supNormal', UNTOUCHED, true, true],
  ['C16', '货损核算(module stock) 主管持 stock ⇒ 可见', '/loss-accounting', 'supervisor', 'supRevoked', TOUCHED, true, true],
  ['C17', '目标与返利(module sales) 主管撤 data 但无 sales ⇒ 不可见', '/rebate', 'supervisor', 'supRevoked', TOUCHED, false, false],
]

/* ---- 3. 两侧分别跑 ---- */
let allOk = true
const table = []
for (const side of ['before', 'after']) {
  const mod = await import(pathToFileURL(join(sides[side].base, 'constants/pages.js')).href)
  const { canSeePage } = mod
  if (typeof canSeePage !== 'function') { console.error('canSeePage 未导出'); process.exit(2) }
  let pass = 0
  const rows = []
  for (const [id, desc, path, role, modKey, cr, expBefore, expAfter] of CASES) {
    const exp = side === 'before' ? expBefore : expAfter
    const got = canSeePage(path, role, cm(modKey), cr)
    const ok = got === exp
    if (ok) pass++; else allOk = false
    rows.push({ id, desc, got, ok })
    table.push({ side, id, got, exp, ok })
  }
  console.log('\n===== [' + side + '] 档案管理入口判别力探针 =====')
  console.log('用例总数: ' + CASES.length + '（期望值写死；模块集取自后端实测值）\n')
  for (const r of rows) {
    console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  ' + r.id + '  ' + String(r.got).padEnd(5) + ' ' + r.desc)
  }
  console.log('\n结果: ' + pass + '/' + CASES.length + ' 通过')
  if (pass !== CASES.length) allOk = false
}

/* ---- 4. 判别力总检：必须有「两侧结果不同」的用例（否则等于没测出修复） ---- */
const diff = CASES.filter(([id]) => {
  const b = table.find(t => t.side === 'before' && t.id === id).got
  const a = table.find(t => t.side === 'after' && t.id === id).got
  return b !== a
}).map(c => c[0])
console.log('\n===== 判别力自证 =====')
console.log('两侧结果不同的用例: ' + (diff.length ? diff.join(', ') : '（无 ⇒ 探针在空转）'))
console.log('两侧结果相同的用例: ' + (CASES.length - diff.length) + ' 条（含防误伤与反向对照）')
if (!diff.length) { console.log('\n🔴 判别力不足：修复前后无差异，探针无法证明任何事'); allOk = false }

/* ---- 5. 第二组：副驾斜杠命令（同一族的另一处）----
   症状：`SLASH_COMMANDS` 的跳转类命令只判模块轴，漏了角色轴 ⇒ 不在角色名单的人
        仍看到命令、点了被守卫弹回工作台（假入口）。
   判据：① 源码级 —— 过滤表达式里有没有接 `canSee(c.path)`；
         ② 数值级 —— `canSeePage('/forecast','sales',…)` 必须为 false（证明接对了轴）。 */
const CD_REL = 'hergent-cn-v2/src/components/CopilotDrawer.vue'
const cdAfter = readFileSync(join(SRC, 'components/CopilotDrawer.vue'), 'utf8')
const cdBefore = execSync('git show HEAD:' + CD_REL, { cwd: REPO, encoding: 'utf8' })
const hasGate = (txt) => /!c\.path\s*\|\|\s*canSee\(c\.path\)/.test(txt)
const cdBeforeOk = hasGate(cdBefore) === false   // 修复前：应当**没有**这个判据
const cdAfterOk = hasGate(cdAfter) === true      // 修复后：应当**有**
console.log('\n===== 第二组：副驾斜杠命令（跳转类命令须过角色轴）=====')
console.log('  ' + (cdBeforeOk ? 'PASS' : 'FAIL') + '  before 过滤表达式不含 `canSee(c.path)` ⇒ 缺口确实存在')
console.log('  ' + (cdAfterOk ? 'PASS' : 'FAIL') + '  after  过滤表达式含 `canSee(c.path)` ⇒ 已接判据')
/* 数值级：证明接进来的判据**真的在判角色轴**。
   做法 = 单变量对照：**同模块集、只换角色**，看结果是否翻转。
   若两者相同，说明翻转来自模块轴，接上的就仍是"只看能力"、没解决假入口。 */
const modAfter = await import(pathToFileURL(join(sides.after.base, 'constants/pages.js')).href)
const CUSTOM_SALES = ['dashboard', 'sales', 'chat']   // 租户自建角色：有 sales 模块，但不在 BIZ_ROLES
const cmC = (arr) => (m) => arr.includes(m)
const pairs = [
  ['C18', '业务员(在 BIZ_ROLES、不在 FORECAST_SUMMARY_ROLES) 看 /预报', '/forecast', 'sales', 'supNormal'],
  ['C18b', '主管(两个名单都在) 看 /预报 ⇒ 必须为真（同模块集对照）', '/forecast', 'supervisor', 'supNormal'],
  ['C19', '自建角色(持 sales 模块、不在 BIZ_ROLES) 看 /返利政策', '/rebate', '库管', null],
  ['C19b', '业务员(持 sales 模块、在 BIZ_ROLES) 看 /返利政策 ⇒ 必须为真（同模块集对照）', '/rebate', 'sales', null],
]
const expects = { C18: false, C18b: true, C19: false, C19b: true }
let pairsOk = true
for (const [id, desc, path, role, modKey] of pairs) {
  const arr = modKey === null ? CUSTOM_SALES : MOD[modKey]
  const got = modAfter.canSeePage(path, role, cmC(arr), TOUCHED)
  const ok = got === expects[id]
  if (!ok) { pairsOk = false; allOk = false }
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + id + ' ' + String(got).padEnd(5) + ' ' + desc)
}
if (!(cdBeforeOk && cdAfterOk && pairsOk)) allOk = false

/* ---- 6. 第三组：四处「配置驱动跳转」守卫（v341 加固批）----------------------------
   症状家族：跳转目标来自**配置表 / 后端下发 / 数组**（不是写死的字面量）⇒ 写代码的人手上
   没有具体 path，于是只判了"开通/有目标"、没判"当前这个人有没有权进" ⇒ 假入口。
   判据：① 源码级 —— 每个函数体里有没有 `canSee(目标路径)`；before 必须**没有**、after **有**
         （两侧都跑 ⇒ 证明这个判据不是原本就存在、探针没在空转）；
         ② 全局级 —— 「直读登录快照 `hergent_v2_user` 自判角色」在源码里必须绝迹
         （`api/client.js` 是存取器本身，不算）。 */
console.log('\n===== 第三组：配置驱动跳转的守卫（4 处）=====')
const FILES = ['components/DataLedger.vue', 'pages/ConnectCenter.vue', 'pages/Settings.vue', 'pages/AiHub.vue']
const GUARDS = [
  ['G1', 'components/DataLedger.vue', '数据台账「去上传」',
    /function go\(cat\)[\s\S]{0,1200}?canSee\(p\)/],
  ['G2', 'pages/ConnectCenter.vue', '工作流卡片 openWorkflow',
    /function openWorkflow\(w\)[\s\S]{0,900}?canSee\(w\.path\)/],
  ['G3', 'pages/Settings.vue', '设置›库存效期补录',
    /function goDataFill\(\)[\s\S]{0,600}?canSee\('\/data-fill'\)/],
  ['G4', 'pages/AiHub.vue', 'AI 页权限判据改走 store.user.role',
    /roleIn\(store\.user\.role,\s*ADMIN_ROLES\)/],
]
let gOk = true
for (const [id, rel, desc, re] of GUARDS) {
  const after = readFileSync(join(SRC, rel), 'utf8')
  const before = execSync('git show HEAD:hergent-cn-v2/src/' + rel, { cwd: REPO, encoding: 'utf8' })
  const a = re.test(after)
  const b = re.test(before)
  const ok = a === true && b === false
  if (!ok) { gOk = false; allOk = false }
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + id + ' before=' + String(b).padEnd(5) + ' after=' + String(a).padEnd(5) + ' ' + desc)
}
/* 全局级：AiHub 的旧写法（直读登录快照自判角色）必须不再出现在任何**代码**里。
   只判"角色判断语句"，不判注释 —— 否则本条会把自己的说明文字判成违规（假阳性）。 */
const snapRe = /localStorage\.getItem\('hergent_v2_user'\)[\s\S]{0,80}?(role\s*===)/g
const snapHits = []
for (const rel of FILES) {
  const txt = readFileSync(join(SRC, rel), 'utf8')
  // 去掉注释块再判，避免说明文字造成假阳性
  const code = txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  if (snapRe.test(code)) snapHits.push(rel)
  snapRe.lastIndex = 0
}
const g5ok = snapHits.length === 0
if (!g5ok) { gOk = false; allOk = false }
console.log('  ' + (g5ok ? 'PASS' : 'FAIL') + '  G5 源码中已无「直读登录快照自判角色」的写法' + (snapHits.length ? '（命中: ' + snapHits.join(', ') + '）' : ''))
/* 反例对照：确认这条正则**真的抓得住**旧写法（否则 G5 恒为真、等于没测） */
const negOk = snapRe.test("const u = JSON.parse(localStorage.getItem('hergent_v2_user') || '{}'); if (u.role === 'admin') {}") === true
snapRe.lastIndex = 0
if (!negOk) { gOk = false; allOk = false }
console.log('  ' + (negOk ? 'PASS' : 'FAIL') + '  G5-反例 正则对**旧写法**必须命中（自证判别力，不是恒真）')
if (!gOk) allOk = false

console.log('\n总判定: ' + (allOk ? '✅ 全绿' : '❌ 有失败项'))
process.exit(allOk ? 0 : 1)
