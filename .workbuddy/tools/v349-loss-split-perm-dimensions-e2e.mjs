/**
 * v349-loss-split-perm-dimensions-e2e.mjs —— 生产真机只读验收（hergent.cn）
 *
 * 老板本轮四项拍板：
 *   ① 走路线 A（改呈现）＋「经营看板默认也只给老板和管理员」
 *   ② AI 不放开
 *   ③ 货损核算单独一个开关（⇒ v349 从 `stock` 拆出窄模块 `loss`）
 *   ④ 「更多」保留折叠
 *
 * 要证的四件事：
 *   A. 权限页真的变成**四类维度**：①登录端 / ②是否可使用 AI / ③功能模块 / ④小程序端，
 *      且③的行 = **侧栏功能名**（不是后端模块名），`module: null` 的三页渲染成
 *      **只读说明「不在此配」**（不是可勾但不生效的假框）。
 *   B. **货损核算单独开关成立**（单变量对照）：主管持 stock+loss ⇒ 侧栏有「货损核算」；
 *      只去掉 `loss` ⇒ 「货损核算」消失，而「档案管理」仍在（证明不是把整个仓库关了）。
 *   C. **经营看板收紧生效**：无 `dashboard` 的角色（业务员）首页 **KPI 条不渲染**
 *      （不是"永远加载中"的空壳）；有 `dashboard` 的老板 ⇒ KPI 条渲染。
 *   D. 「更多」默认折叠：点开才见「采购管理」。
 *
 * 🔴 真值驱动（v345 教训：桩值能证机制、不能证存在）：
 *   角色与模块清单**全部照抄生产 `tenant_1.db::role_permissions`（v349 迁移落库后实测）**。
 *
 * 🔴 只读纪律：唯一写动作 = 探针自己发的 `POST /api/auth/login`（+ 末尾 logout），
 *   全程记账并打印非 GET 请求清单自证。
 */
import { chromium } from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/playwright/index.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptest'
const PASS = process.env.HG_PASS || 'Mptest@1'
const TAG = process.env.HG_TAG || 'v349'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/' + TAG + '-e2e-2026-09-30'
fs.mkdirSync(OUT, { recursive: true })

let pass = 0, fail = 0
const ok = (c, name, ev) => {
  if (c) { pass++; console.log('  ✅ ' + name + (ev !== undefined ? '　→ ' + ev : '')) }
  else { fail++; console.log('  ❌ ' + name + (ev !== undefined ? '　→ ' + ev : '')) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/* ---------- 生产真值（v349 迁移落库后 tenant_1.db 实测，逐字照抄） ---------- */
const SV_FULL = ['data', 'sales', 'stock', 'bid', 'messages', 'forecast', 'forecast-audit', 'loss']
const SV_NOLOSS = ['data', 'sales', 'stock', 'bid', 'messages', 'forecast', 'forecast-audit']  // 单变量：只去掉 loss
// 业务员 v349 后：**无 dashboard**（本轮撤的）、**有 loss**（等价性补的）
const SALES = ['sales', 'buying', 'stock', 'crm', 'data', 'messages', 'loss']
const SALES_WITH_DASH = ['dashboard', 'sales', 'buying', 'stock', 'crm', 'data', 'messages', 'loss']
const BOSS = ['dashboard', 'data', 'sales', 'buying', 'stock', 'loss', 'accounts', 'crm', 'hr',
  'payroll', 'projects', 'goals', 'reports', 'chat', 'tasks', 'cron', 'bid', 'messages',
  'forecast', 'forecast-audit']
const CR_T1 = ['supervisor', '库管']

console.log('生产真值（照抄 tenant_1.db::role_permissions，v349 迁移后实测）：')
console.log('  主管 supervisor      = ' + JSON.stringify(SV_FULL))
console.log('  主管（只去 loss）     = ' + JSON.stringify(SV_NOLOSS))
console.log('  业务员 sales         = ' + JSON.stringify(SALES) + '  ← 无 dashboard')
console.log('  老板 boss            = ' + JSON.stringify(BOSS.slice(0, 6)) + ' …（有 dashboard）')
console.log('  custom_roles         = ' + JSON.stringify(CR_T1))

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

const writes = []
page.on('request', (r) => {
  if (r.method() === 'GET') return
  if (/\/api\/auth\/login(\?|$)/.test(r.url())) { writes.push('login(探针自身)'); return }
  if (/\/api\/auth\/logout(\?|$)/.test(r.url())) { writes.push('logout(探针自身)'); return }
  writes.push(r.method() + ' ' + r.url())
})
const permBodies = []
let permCallCount = 0
page.on('response', async (res) => {
  if (!/\/api\/auth\/permissions(\?|$)/.test(res.url())) return
  permCallCount++
  try { permBodies.push(await res.json()) } catch (_) {}
})

/* ---- 登录 ---- */
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
const loginRes = await page.evaluate(async ([u, p]) => {
  const r = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  })
  const d = await r.json()
  if (!d.token) return 'NO:' + JSON.stringify(d).slice(0, 160)
  localStorage.setItem('hergent_v2_token', d.token)
  if (d.csrf_token) localStorage.setItem('hergent_v2_csrf', d.csrf_token)
  if (d.user) localStorage.setItem('hergent_v2_user', JSON.stringify(d.user))
  if (d.tenant_id) localStorage.setItem('hergent_v2_tenant', String(d.tenant_id))
  return 'OK:' + (d.user && d.user.role) + ':' + d.tenant_id
}, [USER, PASS])
ok(String(loginRes).startsWith('OK:'), '真账号登录（' + USER + '）', loginRes)
if (!String(loginRes).startsWith('OK:')) { await browser.close(); process.exit(1) }

/* ---- 响应改写装置 ---- */
let STUB = null
await ctx.route('**/api/auth/permissions*', async (route) => {
  const res = await route.fetch()
  const ct = String((res.headers() || {})['content-type'] || '')
  if (!/json/i.test(ct)) { await route.fulfill({ response: res }); return }
  let body
  try { body = await res.json() } catch (_) { await route.fulfill({ response: res }); return }
  if (STUB) {
    body.permissions = STUB.permissions.slice()
    if (body.user && typeof body.user === 'object') body.user.role = STUB.role
    body.custom_roles = (STUB.customRoles || []).slice()
    body.perms_rev = TAG + '-probe-' + Date.now()
  }
  await route.fulfill({ response: res, body: JSON.stringify(body) })
})

/* ---- 响应改写装置②：权限页的两个数据源 ----
   🔴 为什么必须注入：这两个接口在后端归 **`hr`（员工管理）** 模块，
      而探针只能用真实账号 `mptest`（**业务员**）登录 —— 后端按**真实角色**鉴权，
      改写 `/api/auth/permissions` 只改了前端看到的那一侧，后端照样 403
      （实测：`GET /api/permissions/modules` → 403「没有「员工管理」的使用权限」）。
      ⇒ 本探针注入的是**照抄后端 `core.MODULE_LABEL` / `MODULE_IMPACT` 与生产
      `tenant_1.db::role_permissions` 的真值**，用来验证**渲染逻辑**（本轮改的正是呈现层）；
      后端接口本身本轮零改动。**边界要说清：这不是"读到了真实接口返回"，是"用真值喂渲染层"。 */
const MODULES_BACKEND = [
  { id: 'dashboard', label: '经营看板', entries: ['经营趋势'], feeds: [] },
  { id: 'data', label: '档案管理', entries: ['档案管理', '品牌档案', '商品档案'], feeds: ['舟谱单据导入'] },
  { id: 'sales', label: '销售管理', entries: ['目标与返利'], feeds: [] },
  { id: 'buying', label: '采购管理', entries: [], feeds: [] },
  { id: 'stock', label: '仓库管理', entries: ['货损计算工作流', '库存效期补录', '仓库档案'], feeds: [] },
  { id: 'loss', label: '货损核算', entries: ['货损核算'], feeds: [] },
  { id: 'accounts', label: '收付款', entries: [], feeds: [] },
  { id: 'crm', label: '客户关系', entries: ['客户档案'], feeds: [] },
  { id: 'hr', label: '员工管理', entries: ['员工档案'], feeds: [] },
  { id: 'payroll', label: '算工资', entries: ['算工资'], feeds: [] },
  { id: 'projects', label: '项目管理', entries: [], feeds: [] },
  { id: 'goals', label: '经营目标', entries: [], feeds: [] },
  { id: 'reports', label: '数据报表', entries: [], feeds: [] },
  { id: 'chat', label: 'AI功能（消耗积分）', entries: ['产出与用量', 'AI 团队'], feeds: ['AI 引擎'] },
  { id: 'tasks', label: '任务与项目', entries: [], feeds: [] },
  { id: 'cron', label: '定时任务', entries: ['定时任务'], feeds: [] },
  { id: 'bid', label: '招投标雷达', entries: ['招投标雷达'], feeds: [] },
  { id: 'messages', label: '消息通知', entries: [], feeds: [] },
  { id: 'forecast', label: '预报订货管理', entries: ['预报订货管理'], feeds: [] },
  { id: 'forecast-audit', label: '预报审核与定稿', entries: [], feeds: ['预报订货管理'] },
]
const ROLES_BACKEND = {
  boss: { permissions: BOSS, end: { web: true, mini: false }, end_is_custom: false, end_locked_web: true },
  supervisor: { permissions: SV_FULL, end: { web: true, mini: true }, end_is_custom: false },
  sales: { permissions: SALES, end: { web: false, mini: true }, end_is_custom: false },
  库管: { permissions: ['stock', 'data', 'messages', 'loss'], end: { web: true, mini: false }, end_is_custom: false },
}
const stubJson = (route, payload) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify(payload),
})
await ctx.route('**/api/permissions/modules*', (route) => stubJson(route, { ok: true, modules: MODULES_BACKEND }))
await ctx.route('**/api/role-permissions*', (route) => stubJson(route, { ok: true, roles: ROLES_BACKEND }))

let navSeq = 0
const loadRoute = async (h) => {
  navSeq++
  await page.goto(BASE + '/?v=' + TAG + '-' + navSeq + '#' + h, { waitUntil: 'networkidle' })
  await sleep(1800)
}
const sbHas = async (name) => (await page.locator('.sb-nav .sb-item', { hasText: name }).count()) > 0
const sbNames = async () => page.locator('.sb-nav .sb-item').allInnerTexts()
const shot = async (tag) => { try { await page.screenshot({ path: OUT + '/' + TAG + '-' + tag + '.png', fullPage: false }) } catch (_) {} }
const lastPerms = () => {
  const b = permBodies[permBodies.length - 1]
  return b ? { list: b.permissions, role: b.user && b.user.role } : null
}

/* ==================== ① 基线 ==================== */
console.log('\n① 基线（不改写 —— 先证登录态与页面本身是活的）')
await loadRoute('/workbench')
ok(permCallCount >= 1, '/api/auth/permissions 被调用（判据真的跑过）', permCallCount + ' 次')
ok((await page.locator('.sb-nav').count()) === 1, '侧栏正常渲染', 'nav=' + await page.locator('.sb-nav').count())
console.log('  基线侧栏: ' + (await sbNames()).join(' | '))
await shot('00-baseline')

/* ==================== ② 货损核算单独开关（单变量对照） ==================== */
console.log('\n② 货损核算单独开关（主管真值 · 单变量：只去掉 `loss`）')
STUB = { role: 'supervisor', permissions: SV_FULL, customRoles: CR_T1 }
await loadRoute('/workbench')
const lp2 = lastPerms()
ok(lp2 && JSON.stringify(lp2.list) === JSON.stringify(SV_FULL), '自证：页面收到的模块清单 = 主管真值（含 loss）', JSON.stringify(lp2 && lp2.list))
console.log('  主管侧栏: ' + (await sbNames()).join(' | '))
ok((await sbHas('货损核算')) === true, '🔴 目标③ - 正向：主管持 `loss` ⇒ 侧栏**有**「货损核算」', String(await sbHas('货损核算')))

STUB = { role: 'supervisor', permissions: SV_NOLOSS, customRoles: CR_T1 }
await loadRoute('/workbench')
const lp2b = lastPerms()
ok(lp2b && JSON.stringify(lp2b.list) === JSON.stringify(SV_NOLOSS), '自证：只去掉了 `loss`（其余逐项不变 ⇒ 单变量）', JSON.stringify(lp2b && lp2b.list))
console.log('  去掉 loss 后侧栏: ' + (await sbNames()).join(' | '))
ok((await sbHas('货损核算')) === false, '🔴 目标③ - 反向：只去掉 `loss` ⇒ 「货损核算」**消失**（此前要连关 3 页）', String(await sbHas('货损核算')))
ok((await sbHas('档案管理')) === true, '对照：同一份权限下「档案管理」仍在（他持 data ⇒ 不是把整个仓库关了）', String(await sbHas('档案管理')))
await shot('01-supervisor-noloss')

/* ==================== ③ 经营看板收紧（首页 KPI 条） ==================== */
console.log('\n③ 经营看板默认只给老板和管理员（首页 KPI 条按 `canModule(dashboard)` 显隐）')
STUB = { role: 'sales', permissions: SALES, customRoles: CR_T1 }
await loadRoute('/workbench')
const lp3 = lastPerms()
ok(lp3 && JSON.stringify(lp3.list) === JSON.stringify(SALES), '自证：业务员真值（**无 dashboard**、有 loss）', JSON.stringify(lp3 && lp3.list))
const kpiSales = await page.locator('.kpi-strip').count()
ok(kpiSales === 0, '🔴 目标①：业务员（无「经营看板」）首页 **KPI 条不渲染** —— 不是"永远加载中"的空壳', 'kpi-strip 出现 ' + kpiSales + ' 次')
const loadingTxt = await page.locator('body').innerText()
ok(!/加载中/.test(loadingTxt.slice(0, 600)), '对照：首页没有残留「加载中」字样（无说明空壳已被消除）', '命中=' + /加载中/.test(loadingTxt.slice(0, 600)))
await shot('02-sales-no-dashboard')

STUB = { role: 'sales', permissions: SALES_WITH_DASH, customRoles: CR_T1 }
await loadRoute('/workbench')
const kpiWith = await page.locator('.kpi-strip').count()
ok(kpiWith === 1, '🔴 单变量对照：只加回 `dashboard` ⇒ KPI 条**出现**（证明上一条是它造成的）', 'kpi-strip 出现 ' + kpiWith + ' 次')
await shot('03-sales-with-dashboard')

STUB = { role: 'boss', permissions: BOSS, customRoles: CR_T1 }
await loadRoute('/workbench')
const kpiBoss = await page.locator('.kpi-strip').count()
ok(kpiBoss === 1, '老板（有「经营看板」）首页 KPI 条正常渲染（防误伤）', 'kpi-strip 出现 ' + kpiBoss + ' 次')
await shot('04-boss')

/* ==================== ④ 权限页四类维度（管理员视角） ==================== */
console.log('\n④ 权限页四类维度 + 只读固定行 + 「更多」折叠（管理员视角）')
STUB = { role: 'admin', permissions: ['*'], customRoles: CR_T1 }
await loadRoute('/settings')
await page.locator('button', { hasText: '权限' }).first().click()
await sleep(1200)
// 🔴 权限 tab 默认是「按角色配置」（角色列表），四类维度矩阵在**「批量总览」**子视图里
//    （v334 三步式：列表 → 详情；批量总览是保留的旧横向矩阵）。不切视图 ⇒ 断言会全绿不了。
await page.locator('button', { hasText: '批量总览' }).first().click()
await sleep(2000)
// 🔴 取文本**必须限定在权限表内**：`body.innerText()` 会把侧栏的「档案管理 / 设置」等
//    一起算进来 ⇒ 行名断言变成假阳性（实测踩过：侧栏就有 10 个同名项）。
const matrix = page.locator('table').filter({ hasText: '登录端' }).first()
const permTxt = await matrix.innerText()
ok(permTxt.length > 50, '权限矩阵已渲染（「批量总览」子视图）', permTxt.length + ' 字符')
ok(/①\s*登录端/.test(permTxt), '维度①「登录端 · 这个角色从哪儿登录」在', '命中=' + /①\s*登录端/.test(permTxt))
ok(/②\s*是否可使用 AI/.test(permTxt), '🔴 维度②「是否可使用 AI」**独立成段**（不再混在 20 行模块里）', '命中=' + /②\s*是否可使用 AI/.test(permTxt))
ok(/③\s*功能模块/.test(permTxt), '维度③「功能模块」在', '命中=' + /③\s*功能模块/.test(permTxt))

// ③ 的行必须是**侧栏功能名**（老板认的名字），不是后端模块名
const ROW_NAMES = ['经营工作台', '经营看板', '预报订货管理', '目标与返利', '招投标雷达',
  '货损核算', '算工资', '档案管理', 'AI 引擎', '定时任务', '设置']
const missing = ROW_NAMES.filter(n => !permTxt.includes(n))
ok(missing.length === 0, '🔴 侧栏 10 项功能 + 经营看板 **全部出现在权限页行里**', missing.length ? '缺: ' + missing.join('、') : '11/11 齐全')

// 只读固定行：三页 module:null ⇒ 显示「不在此配」说明，不画可勾的框
const fixedMarks = await page.locator('.pm-fixed-mark').count()
ok(fixedMarks >= 3, '🔴 `module: null` 的三页渲染成**只读说明「不在此配」**（不给假勾选框）', '不在此配 ×' + fixedMarks)
ok(/它是登录后的落地页/.test(permTxt), '「经营工作台」说明了为什么不能关（不是让它凭空消失）', '命中=' + /它是登录后的落地页/.test(permTxt))

// ④ 「更多」默认折叠
const buyRow = page.locator('tr', { hasText: '采购管理' }).first()
const buyVisibleBefore = await buyRow.isVisible().catch(() => false)
ok(buyVisibleBefore === false, '🔴 目标④：「更多（子页面与数据权限）」**默认折叠** ⇒ 「采购管理」不可见', '可见=' + buyVisibleBefore)
await page.locator('.pm-grp-lb').filter({ hasText: '更多' }).first().click({ timeout: 15000 })
await sleep(700)
const buyVisibleAfter = await buyRow.isVisible().catch(() => false)
ok(buyVisibleAfter === true, '点击组头后展开 ⇒ 「采购管理」可见（折叠是真的可展开，不是隐藏了）', '可见=' + buyVisibleAfter)
await shot('05-perm-four-dimensions')

/* ==================== ⑤ 只读自证 + 零报错 ==================== */
console.log('\n⑤ 只读自证')
ok(writes.filter(w => !/login\(探针自身\)|logout\(探针自身\)/.test(w)).length === 0,
  '全程无业务写请求（唯一非 GET 是探针自身的 login）', JSON.stringify(writes.slice(-4)))
ok(pageErrors.length === 0, '页面零 JS 报错', pageErrors.slice(0, 2).join(' | ') || '0 条')

console.log('\n' + '='.repeat(70))
console.log('总判定: ' + (fail === 0 ? '✅ 全绿' : '❌ 有失败') + '（' + pass + ' 通过 / ' + fail + ' 失败）')
await browser.close()
process.exit(fail ? 1 : 0)
