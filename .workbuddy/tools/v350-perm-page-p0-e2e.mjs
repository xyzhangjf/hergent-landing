/**
 * v350-perm-page-p0-e2e.mjs —— 生产真机只读验收（hergent.cn）
 *
 * 本轮（老板拍板「1.今天就上」）修的是权限页的 **2 个 P0 缺陷 + 1 个搜索泄漏**，
 * 全部**不改任何可见行为**，只堵住"自锁"和"静默丢输入"两条路。
 *
 * 要证的四件事，每条都必须**改前必失败**（否则断言没有判别力）：
 *
 *   A. **后端豁免生效**（打真接口，业务员真身份，不经任何桩）
 *      `GET /api/permissions/modules` 映射到 `hr` 且此前**未豁免** ⇒ 无 `hr` 的角色必 403。
 *      本批给它加了豁免 ⇒ 应 200。
 *      判别力自证（三条同时给）：
 *        · 业务员真值里**不含 hr**（⇒ 若未豁免，这条必然 403，不是"碰巧有权"）
 *        · `GET /api/dashboard/today-profit`（业务员无权、未豁免）**仍 403** ⇒ 403 机制本身是活的
 *        · `GET /api/role-permissions`（v199 老豁免）**仍 200** ⇒ 没有回归
 *
 *   B. **自我锁死已堵**（admin 视角，用后端真值喂渲染层）
 *      改前：详情视图对「老板」的「员工管理」不加锁 ⇒ 取消「查看」一个勾就能把自己锁在门外。
 *      改后：「老板」详情的 `hr`/`data` 行 **4 个勾 + 整行按钮全 disabled**。
 *      单变量对照：同一视图里「业务员」的这些行**不禁用**（证明不是"所有行都禁用了"）。
 *
 *   C. **切视图不再静默丢输入**（机制级判据，比 DOM 断言硬）
 *      改前：详情保存后 `loadPerms()` 整表重拉 ⇒ 批量总览里未保存的勾全丢。
 *      改后：只增量更新本角色 ⇒ **`GET /api/role-permissions` 的调用次数不增加**。
 *      双判据：同时断言"总览里刚勾的那格仍在 checked"。
 *
 *   D. **搜索泄漏已修**（+ 组头整组勾选作用于整组）
 *      改前：`moduleQuery` 跨视图共享 ⇒ 总览里搜"销售"，切到按角色配置只剩 1 行。
 *      改后：进详情视图时行数 = 全量（> 搜索命中数）。
 *      附带：搜"算工资"（核算组只命中 1 行）时点组头 ⇒ 被过滤掉的「货损核算」**也被勾上**。
 *
 * 🔴 只读纪律：唯一真实写动作 = 探针自身的 `POST /api/auth/login`（+ 末尾 logout）。
 *   `POST /api/role-permissions/detail` 由探测装置 `route.fulfill` 拦截，**不出网**。
 *   全程记账并打印非 GET 清单自证。
 *
 * 🔴 边界要说清（与 v349 同）：B/C/D 三段验的是**渲染与请求行为**，
 *   数据用**照抄后端常量与生产库的真值**喂进去 —— 因为探针只能用真实账号登录，
 *   而后端按**真实角色**鉴权（业务员打 `/api/role-permissions` 会 403）。
 *   A 段是货真价实的"打生产真接口"，不受此限制。
 */
import { chromium } from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/playwright/index.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
/* 🔴 账号说明（2026-10-01 实测）：提审账号 `mptest`（业务员）**已被限制为仅小程序登录**
   （`POST /api/auth/login` → 403「该账号只能在手机小程序登录」）—— v349 探针（09-30 深夜）
   时它还能 Web 登录，说明之后被改过。改用同为提审账号的 `mptestsp`（主管，tenant 1）。
   选它不影响判别力：主管真值同样**不含 `hr`**（A 段前提）且**无 `dashboard`**（A 段对照组）。 */
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const TAG = process.env.HG_TAG || 'v350'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/' + TAG + '-e2e-2026-10-01'
fs.mkdirSync(OUT, { recursive: true })

let pass = 0, fail = 0
const ok = (c, name, ev) => {
  if (c) { pass++; console.log('  ✅ ' + name + (ev !== undefined ? '　→ ' + ev : '')) }
  else { fail++; console.log('  ❌ ' + name + (ev !== undefined ? '　→ ' + ev : '')) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/* ---------- 生产真值（照抄后端常量 + 生产库，逐字） ---------- */
const BOSS = ['dashboard', 'data', 'sales', 'buying', 'stock', 'loss', 'accounts', 'crm', 'hr',
  'payroll', 'projects', 'goals', 'reports', 'chat', 'tasks', 'cron', 'bid', 'messages',
  'forecast', 'forecast-audit']
const SV_FULL = ['data', 'sales', 'stock', 'bid', 'messages', 'forecast', 'forecast-audit', 'loss']
const SALES = ['sales', 'buying', 'stock', 'crm', 'data', 'messages', 'loss']
const CR_T1 = ['supervisor', '库管']

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
  { id: 'forecast-audit', label: '预报审核与定稿', entries: [], feeds: [] },
]
const ROLES_BACKEND = {
  boss: { permissions: BOSS, end: { web: true, mini: false }, end_is_custom: false, end_locked_web: true },
  supervisor: { permissions: SV_FULL, end: { web: true, mini: true }, end_is_custom: false },
  sales: { permissions: SALES, end: { web: false, mini: true }, end_is_custom: false },
  库管: { permissions: ['stock', 'data', 'messages', 'loss'], end: { web: true, mini: false }, end_is_custom: false },
}
const mkDetail = (perms) => {
  const d = {}
  for (const m of MODULES_BACKEND) {
    const has = perms.includes(m.id)
    d[m.id] = { read: has, create: has, update: has, delete: has }
  }
  return d
}
const DETAIL_ROLES = {
  roles: {
    boss: { modules: mkDetail(BOSS), is_custom: false },
    supervisor: { modules: mkDetail(SV_FULL), is_custom: false },
    sales: { modules: mkDetail(SALES), is_custom: false },
    // C 段要保存的是**另一个角色**（见那里的注释）⇒ 必须给它一份与 `ROLES_BACKEND` 等价的明细，
    // 否则 `loadRoleDetail` 拿到空矩阵、保存出去就是"清空该角色"，断言会被这层噪音干扰。
    库管: { modules: mkDetail(['stock', 'data', 'messages', 'loss']), is_custom: true },
  },
}

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

const writes = []
const getHits = []           // 记录 GET 路径，用于 C 段的"调用次数"判据
page.on('request', (r) => {
  const u = r.url()
  if (r.method() === 'GET') {
    if (u.includes('/api/')) getHits.push(u.replace(BASE, '').split('?')[0])
    return
  }
  if (/\/api\/auth\/login/.test(u)) { writes.push('login(探针自身)'); return }
  if (/\/api\/auth\/logout/.test(u)) { writes.push('logout(探针自身)'); return }
  writes.push(r.method() + ' ' + u.replace(BASE, '') + '（探测装置拦截，未出网）')
})

const shot = async (tag) => { try { await page.screenshot({ path: OUT + '/' + TAG + '-' + tag + '.png' }) } catch (_) {} }

/* ==================== 登录（业务员真身份） ==================== */
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
const loginRes = await page.evaluate(async ([u, p]) => {
  const r = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client': 'web' },
    body: JSON.stringify({ username: u, password: p }),
  })
  const d = await r.json()
  if (!d.token) return 'NO:' + JSON.stringify(d).slice(0, 160)
  localStorage.setItem('hergent_v2_token', d.token)
  if (d.csrf_token) localStorage.setItem('hergent_v2_csrf', d.csrf_token)
  if (d.user) localStorage.setItem('hergent_v2_user', JSON.stringify(d.user))
  if (d.tenant_id) localStorage.setItem('hergent_v2_tenant', String(d.tenant_id))
  return 'OK:' + (d.user && d.user.role) + ':tenant' + d.tenant_id
}, [USER, PASS])
console.log('真账号登录（' + USER + '）: ' + loginRes)
ok(String(loginRes).startsWith('OK:'), '真账号登录', loginRes)
if (!String(loginRes).startsWith('OK:')) { await browser.close(); process.exit(1) }

/* ==================== A. 后端豁免（打真接口，无桩） ==================== */
console.log('\nA. 后端豁免 `/api/permissions/modules`（真接口 · 探针真身份 · 此时尚未装任何桩）')
const real = await page.evaluate(async () => {
  const tk = localStorage.getItem('hergent_v2_token')
  const tid = localStorage.getItem('hergent_v2_tenant')
  const H = { Authorization: 'Bearer ' + tk, 'X-Tenant-Id': String(tid), 'X-Client': 'web' }
  const hit = async (u) => {
    try {
      const r = await fetch(u, { headers: H })
      let j = null
      try { j = await r.json() } catch (_) {}
      return { status: r.status, perms: j && j.permissions, detail: j && (j.detail || j.message || j.error), mods: j && j.modules ? j.modules.length : null }
    } catch (e) { return { status: 'ERR', detail: String(e).slice(0, 120) } }
  }
  return {
    me: await hit('/api/auth/permissions'),
    modules: await hit('/api/permissions/modules'),
    dash: await hit('/api/dashboard/today-profit'),
    rolePerms: await hit('/api/role-permissions'),
  }
})
console.log('  探针账号真值 permissions = ' + JSON.stringify(real.me.perms))
ok(Array.isArray(real.me.perms), '前置：能读到自己的权限清单（探针真的登录成功）', 'HTTP ' + real.me.status)
ok(Array.isArray(real.me.perms) && !real.me.perms.includes('hr'),
  '🔴 判别力自证：探针账号（主管）真值**不含 `hr`**（⇒ 未豁免时该接口必然 403，不是"碰巧有权"）',
  JSON.stringify(real.me.perms))
ok(real.modules.status === 200,
  '🔴 目标A（正向）：`GET /api/permissions/modules` → **200**（豁免生效，权限页自己的依赖不再被它管的东西掐断）',
  'HTTP ' + real.modules.status + '，返回模块数=' + real.modules.mods)
ok(real.dash.status === 403,
  '🔴 目标A（对照①）：`GET /api/dashboard/today-profit` → **仍 403**（403 机制本身是活的，不是全局放行）',
  'HTTP ' + real.dash.status + '　' + (real.dash.detail || ''))
/* 🔴 这条断言的判据修正过（2026-10-01 实测踩到）：探针身份是**主管**，而该端点除"模块豁免"
   之外还有**端点自己的 `_admin` 兜底**（role ∈ {admin, boss}）⇒ 主管必然 403，与豁免无关。
   ⇒ 正确判据不是"返回 200"，而是"403 的**理由**不是模块判定"：
     豁免若失效，中间件会拦在前面，文案里会点名模块（v347 起 403 会说「没有『员工管理』的使用权限」）。
   实测确认：403 的 detail 就是「仅管理员」那句，且不含模块名 ⇒ 豁免确实生效、老豁免未回归。 */
const rpDetail = String(real.rolePerms.detail || '')
ok(real.rolePerms.status === 403 && !/使用权限/.test(rpDetail),
  '对照②：`/api/role-permissions` 的 403 来自**端点自己的「仅管理员」兜底**，不是模块判定 ⇒ 老豁免未回归',
  'HTTP ' + real.rolePerms.status + '　' + rpDetail.slice(0, 56))

/* ==================== 装探测装置（此后所有 /api 断言都基于真值注入） ==================== */
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
const stubJson = (route, payload) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify(payload),
})
await ctx.route('**/api/permissions/modules*', (route) => stubJson(route, { ok: true, modules: MODULES_BACKEND }))
await ctx.route('**/api/role-permissions**', (route) => {
  const u = route.request().url()
  if (u.includes('/detail')) {
    if (route.request().method() === 'POST') return stubJson(route, { ok: true, success: true })
    return stubJson(route, DETAIL_ROLES)
  }
  return stubJson(route, { ok: true, roles: ROLES_BACKEND })
})

let navSeq = 0
const loadRoute = async (h) => {
  navSeq++
  await page.goto(BASE + '/?v=' + TAG + '-' + navSeq + '#' + h, { waitUntil: 'networkidle' })
  await sleep(1800)
}
const openPermTab = async () => {
  await page.locator('button', { hasText: '权限' }).first().click()
  await sleep(1500)
}
/** 进「按角色配置」列表 → 点某角色的「配置权限」。 */
const openRoleDetail = async (roleName) => {
  await page.locator('.perm-role-table tbody tr').filter({ hasText: roleName }).first()
    .locator('button', { hasText: '配置权限' }).click()
  await sleep(1800)
}
/** 详情表里某模块行的 4 个勾选框。 */
const detailBoxes = (rowName) => page.locator('.perm-detail-table tbody tr').filter({ hasText: rowName })
  .first().locator('input[type=checkbox]')
const detailRowBtn = (rowName) => page.locator('.perm-detail-table tbody tr').filter({ hasText: rowName })
  .first().locator('button')

/* ==================== B. 自我锁死已堵 ==================== */
console.log('\nB. 自我锁死（详情视图对保护角色的必选模块上锁）')
STUB = { role: 'admin', permissions: ['*'], customRoles: CR_T1 }
await loadRoute('/settings')
await openPermTab()
await page.locator('button', { hasText: '按角色配置' }).first().click()
await sleep(1000)

await openRoleDetail('老板')
const bossHr = detailBoxes('员工管理')
const nHr = await bossHr.count()
ok(nHr === 4, '前置：老板详情里「员工管理」行有 4 个勾选框（查看/新增/修改/删除）', nHr + ' 个')
let allDisabled = true
for (let i = 0; i < nHr; i++) if (!(await bossHr.nth(i).isDisabled())) allDisabled = false
ok(allDisabled, '🔴 目标B（正向）：老板的「员工管理」4 个勾**全部 disabled**（改前零防护 ⇒ 取消「查看」一个勾即可自锁）',
  'disabled=' + allDisabled)
ok(await detailRowBtn('员工管理').isDisabled(),
  '🔴 目标B：老板的「整行全选」按钮**也 disabled**（改前点一下＝一键撤掉该行 4 个勾）',
  'disabled=' + await detailRowBtn('员工管理').isDisabled())
const bossData = detailBoxes('档案管理')
let dataAllDisabled = true
const nData = await bossData.count()
for (let i = 0; i < nData; i++) if (!(await bossData.nth(i).isDisabled())) dataAllDisabled = false
ok(dataAllDisabled, '老板的「档案管理」同样上锁（`hr` + `data` 两个必选模块都覆盖）', 'disabled=' + dataAllDisabled)
await shot('01-boss-detail-locked')

// 单变量对照：换一个非保护角色，同样的行应当**不禁用**
await page.locator('button', { hasText: '角色列表' }).first().click()
await sleep(1200)
await openRoleDetail('业务员')
const salesHr = detailBoxes('员工管理')
const nSalesHr = await salesHr.count()
let anyDisabled = false
for (let i = 0; i < nSalesHr; i++) if (await salesHr.nth(i).isDisabled()) anyDisabled = true
ok(nSalesHr >= 4 && !anyDisabled,
  '🔴 目标B（对照）：业务员的「员工管理」**不禁用**（证明上一条不是"全部行都禁用了"这种假绿）',
  'n=' + nSalesHr + ' 任一禁用=' + anyDisabled)
await shot('02-sales-detail-unlocked')

/* ==================== C. 切视图不再丢输入 ==================== */
console.log('\nC. 切视图静默丢输入（机制判据：`GET /api/role-permissions` 调用次数不因保存而增加）')
STUB = { role: 'admin', permissions: ['*'], customRoles: CR_T1 }
await loadRoute('/settings')
await openPermTab()
await page.locator('button', { hasText: '批量总览' }).first().click()
await sleep(2000)

// 矩阵表头定位「主管」列（列顺序 = 后端返回顺序，不能写死 index）
const colIdx = await page.evaluate(() => {
  const ths = [...document.querySelectorAll('table.tbl thead th')]
  return ths.findIndex(t => t.innerText.includes('主管'))
})
ok(colIdx > 0, '前置：矩阵表头里定位到「主管」列', 'colIdx=' + colIdx)

// 🔴 探针自身踩到的坑：「客户关系」在「更多」组里，而该组**默认折叠** ⇒ 行虽然 attached
//    但 `v-show` 隐藏，`check()` 会直接报 "Element is not visible"（`force:true` 也救不了）。
//    ⇒ 先展开。顺带也算验了「更多」的折叠是可展开的。
await page.locator('.pm-grp-lb').filter({ hasText: '更多' }).first().click()
await sleep(700)

// 在「主管」列勾一个它原本没有的模块：「客户关系」(crm)
const crmRow = page.locator('table.tbl tbody tr').filter({ hasText: '客户关系' }).first()
const crmBox = crmRow.locator('td').nth(colIdx).locator('input[type=checkbox]')
const crmBefore = await crmBox.isChecked()
if (!crmBefore) await crmBox.check({ force: true })
await sleep(300)
ok((await crmBox.isChecked()) === true, '前置：在「批量总览」里给「主管 × 客户关系」打上勾（**尚未保存**）', 'checked=true')

const getCountBefore = getHits.filter(p => p === '/api/role-permissions').length
console.log('  保存前 `GET /api/role-permissions` 累计 = ' + getCountBefore)

/* 切到「按角色配置」→ 打开**另一个角色（库管）**的详情 → 保存（POST 被拦截，不出网）。
   🔴 为什么必须换角色：第一版这里保存的是「主管」自己 —— 而我在总览勾的正是「主管 × 客户关系」。
   保存该角色的详情，本来就该以详情为准（提交上去的 `perms` 里没有 crm ⇒ 保存后它就该没有），
   所以"勾没了"是**正确行为**，不是被重拉冲掉的 ⇒ 那条断言没有判别力（实测踩到）。
   改存「库管」后判据才成立：改前 `loadPerms()` 整表重拉会**连主管的本地改动一起冲掉**，
   改后只增量更新「库管」⇒ 主管那一格必须还在。 */
await page.locator('button', { hasText: '按角色配置' }).first().click()
await sleep(1200)
await openRoleDetail('库管')
await page.locator('button', { hasText: '保存' }).first().click()
await sleep(2500)

const getCountAfter = getHits.filter(p => p === '/api/role-permissions').length
console.log('  保存后 `GET /api/role-permissions` 累计 = ' + getCountAfter)
ok(getCountAfter === getCountBefore,
  '🔴 目标C（机制判据）：详情保存**没有**触发整表重拉（改前 `loadPerms(true)` 会 +1 ⇒ 另一个视图里未保存的勾全丢）',
  getCountBefore + ' → ' + getCountAfter)

const toastTxt = await page.locator('body').innerText()
ok(/权限已保存|已保存/.test(toastTxt), '前置：保存路径真的走通了（给出成功回执，不是"点了没反应"）',
  (/权限已保存/.test(toastTxt) ? '命中「权限已保存」' : '命中「已保存」'))

// 切回矩阵，刚勾的那格必须还在
await page.locator('button', { hasText: '角色列表' }).first().click()
await sleep(1000)
await page.locator('button', { hasText: '批量总览' }).first().click()
await sleep(1800)
const crmAfter = await page.locator('table.tbl tbody tr').filter({ hasText: '客户关系' }).first()
  .locator('td').nth(colIdx).locator('input[type=checkbox]').isChecked()
ok(crmAfter === true,
  '🔴 目标C（现象判据）：刚保存的是「库管」，切回总览后「主管 × 客户关系」那格**仍然勾着**（改前整表重拉会把它一起冲掉）',
  'checked=' + crmAfter)
await shot('03-matrix-kept-after-save')

/* ==================== D. 搜索 = 查找而非筛选 ==================== */
console.log('\nD. 搜索「淡化」而非「过滤」（行永远在 DOM ⇒ 组头勾选范围 ≡ 用户所见）')
STUB = { role: 'admin', permissions: ['*'], customRoles: CR_T1 }
await loadRoute('/settings')
await openPermTab()
await page.locator('button', { hasText: '批量总览' }).first().click()
await sleep(2000)

const countRows = () => page.locator('table.tbl tbody tr').filter({ has: page.locator('input[type=checkbox]') }).count()
const beforeSearch = await countRows()
ok(beforeSearch >= 15, '前置：未搜索时可勾行数 = 全量', '行数=' + beforeSearch)

const searchBox = page.locator('.tb-search input').first()
/* 🔴 这是**改前必失败**的判据：旧版直接拿搜索词 `filter` 行 ⇒ 搜「货损核算」后总览只剩 1 行；
   而 `permGroups` 被两个视图共用 ⇒ 切到「按角色配置」时把详情视图也一起砍成 1 行。 */
await searchBox.fill('货损核算')
await sleep(900)
const afterSearch = await countRows()
ok(afterSearch === beforeSearch,
  '🔴 目标D（核心）：搜索后**行数不变**（旧版"过滤"会让总览只剩 1 行，并把详情视图一起砍掉）',
  beforeSearch + ' → ' + afterSearch)

const hitTip = await page.locator('.tb-hit').first().innerText().catch(() => '')
ok(/找到\s*\d+\s*个/.test(hitTip), '搜索框旁给出命中数（否则"其余行变淡"会被当成搜索没反应）', hitTip)

// 未命中的行：淡化，但**仍在 DOM**
const otherRow = page.locator('table.tbl tbody tr').filter({ hasText: '算工资' }).first()
ok((await otherRow.count()) === 1, '🔴 未命中的「算工资」行**仍在 DOM**（淡化，不是消失）', 'attached=1')
const dimCls = await otherRow.getAttribute('class')
ok(/pm-row-dim/.test(dimCls || ''), '🔴 未命中的行带 `pm-row-dim`（淡下去，但点得到、勾得着）', 'class=' + dimCls)

/* 组头勾选：作用范围 ≡ 用户所见。
   「核算」组 = [货损核算(loss), 算工资(payroll)]，主管**有 loss、无 payroll** ⇒
   搜「货损核算」后点组头，若「算工资」跟着变，说明作用范围是整组；
   而它**就摆在用户眼前**（只是淡的）⇒ 不存在"静默改掉看不见的行"。 */
const grpBox = page.locator('tr.pm-grp').filter({ hasText: '核算' }).first()
  .locator('td').nth(colIdx).locator('input[type=checkbox]')
await grpBox.check({ force: true })
await sleep(600)
const otherChecked = await otherRow.locator('td').nth(colIdx).locator('input[type=checkbox]').isChecked()
ok(otherChecked === true,
  '🔴 目标D（附带）：搜索态下点组头 ⇒ 淡化着的「算工资」也被勾上（用户看得见它，只是淡）',
  'checked=' + otherChecked)
await shot('04-search-dim-not-filter')

// 详情视图：行数全量（不受总览搜索词影响）
await page.locator('button', { hasText: '按角色配置' }).first().click()
await sleep(1200)
await openRoleDetail('主管')
const detailRowCount = await page.locator('.perm-detail-table tbody tr').filter({ has: page.locator('input[type=checkbox]') }).count()
ok(detailRowCount >= 15,
  '🔴 目标D（对照）：带着搜索词进详情视图，**行数仍是全量**（旧版会只剩 1 行）',
  '详情可勾行数=' + detailRowCount)
await shot('05-detail-full-rows')

// 回总览：搜索词仍在、行数仍全量（是"淡化"，不是"把搜索清空了"）
await page.locator('button', { hasText: '角色列表' }).first().click()
await sleep(1000)
await page.locator('button', { hasText: '批量总览' }).first().click()
await sleep(1800)
const qVal = await page.locator('.tb-search input').first().inputValue()
const matrixAfter = await countRows()
ok(qVal === '货损核算' && matrixAfter === beforeSearch,
  '🔴 目标D（对照）：回到总览，搜索词**仍在**、行数**仍全量**（是淡化，不是把搜索清空）',
  '词="' + qVal + '" 行数=' + matrixAfter)
await shot('06-matrix-still-dim')

/* ==================== E. 只读自证 + 零报错 ==================== */
console.log('\nE. 只读自证')
const bizWrites = writes.filter(w => !/login\(探针自身\)|logout\(探针自身\)/.test(w))
ok(bizWrites.every(w => /探测装置拦截/.test(w)),
  '全程无业务写请求出网（唯一的数据写入 POST 被探测装置拦截）', JSON.stringify(bizWrites.slice(-3)))
ok(pageErrors.length === 0, '页面零 JS 报错', pageErrors.slice(0, 2).join(' | ') || '0 条')

console.log('\n' + '='.repeat(74))
console.log('总判定: ' + (fail === 0 ? '✅ 全绿' : '❌ 有失败') + '（' + pass + ' 通过 / ' + fail + ' 失败）')
console.log('截图目录: ' + OUT)
await browser.close()
process.exit(fail ? 1 : 0)
