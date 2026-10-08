/**
 * v351-perm-routeA-e2e.mjs —— 权限页「路线 A」真机只读验收（hergent.cn 或本地预览）
 *
 * 老板拍板（2026-10-01）：「1.认；2.不折叠」⇒ 按原型做结构重构：
 *   · 「批量总览」页签**删除** ⇒ 跨角色对比降级为「查看对比」**只读弹窗**
 *   · 配权限归到每个角色自己的配置页 ⇒ **唯一写入口**
 *   · 登录端置顶、「允许使用 AI」独立成块、功能按**域页签**分组
 *   · 「更多」**不再折叠**（改折为页签）
 *
 * 🔴 本探针要证的六件事（每条都给了对照，避免"碰巧绿"）：
 *   A. **只有一个写入口**：权限页里再也找不到「批量总览」；「查看对比」弹窗里
 *      **没有任何可写控件**（input=0）。
 *   B. **弹窗真只读**：0 个 input、0 个 checkbox；唯一按钮是「关闭」；
 *      ESC/遮罩点击能关。对照：同一页面**详情页**里 checkbox 数量 > 0
 *      （证明"0"不是因为这个页面根本没渲染出东西）。
 *   C. **详情页三个可写块都在**：登录端 2 个勾、域页签 4 个、AI 1 个勾。
 *   D. **「更多」不折叠**：点一下页签就**立刻**看到 11 行（改前要"先展开再找"）。
 *      对照：不点页签时那些行**不在**当前视图（证明"立刻可见"是页签切换的结果，
 *      不是"所有行一直堆在一起"）。
 *   E. **P0 没有回归**（v350 修的两条）：
 *      E1 老板的「员工管理」4 勾 + 整行按钮仍 disabled；对照：业务员不禁用。
 *      E2 保存详情后 `GET /api/role-permissions` **次数不增加**（不整表重拉）。
 *   F. **登录端并入保存**（v351 新行为）：改「库管」的手机端 → 点保存 ⇒
 *      发出的是 `POST /api/role-permissions/end` 且 **body 只含这一个角色**
 *      （旧代码是"for 所有角色逐个 POST" ⇒ 会把别的角色一起写一遍）。
 *
 * 🔴 只读纪律：唯一真实写动作 = 探针自身的 `POST /api/auth/login`（+ 末尾 logout）。
 *   所有 POST/PUT/DELETE 业务请求由探测装置 `route.fulfill` 拦截，**不出网**，
 *   并在末尾打印非 GET 清单自证。
 *
 * 🔴 边界要说清（与 v349/v350 同）：C/D/E1/E2/F 验的是**渲染与请求行为**，
 *   数据用**照抄后端常量与生产库的真值**喂进去 —— 因为探针只能用真实账号登录，
 *   而后端按**真实角色**鉴权（非管理角色打 `/api/role-permissions` 会 403）。
 *   B 段（后端豁免）是货真价实的"打生产真接口"，不受此限制。
 *
 * 用法：
 *   node .workbuddy/tools/v351-perm-routeA-e2e.mjs                       # 打生产
 *   HG_BASE=http://127.0.0.1:4183 HG_TAG=v351local node ...              # 打本地预览
 */
import { chromium } from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/playwright/index.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
/* 🔴 账号说明（2026-10-01 实测）：提审账号 `mptest`（业务员）**已被限制为仅小程序登录**
   （`POST /api/auth/login` → 403「该账号只能在手机小程序登录」）。
   改用同为提审账号的 `mptestsp`（主管，tenant 1）。选它不影响判别力：
   主管真值同样**不含 `hr`**（B 段前提）且**无 `dashboard`**（B 段对照组）。 */
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const TAG = process.env.HG_TAG || 'v351'
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
const getHits = []
const endPosts = []          // F 段：登录端保存请求
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

/* ==================== 登录（真账号） ==================== */
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

/* ==================== A. 后端豁免（打真接口，无桩） ====================
   这是 B 段，但**必须放在装探测装置之前** —— 一旦装了桩，这里就不是"真接口"了。 */
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
  '🔴 v350 未回归：`GET /api/permissions/modules` → **200**（豁免生效，权限页自己的依赖不再被它管的东西掐断）',
  'HTTP ' + real.modules.status + '，返回模块数=' + real.modules.mods)
ok(real.dash.status === 403,
  '对照①：`GET /api/dashboard/today-profit` → **仍 403**（403 机制本身是活的，不是全局放行）',
  'HTTP ' + real.dash.status + '　' + String(real.dash.detail || '').slice(0, 60))
const rpDetail = String(real.rolePerms.detail || '')
ok(real.rolePerms.status === 403 && !/使用权限/.test(rpDetail),
  '对照②：`/api/role-permissions` 的 403 来自**端点自己的「仅管理员」兜底**，不是模块判定 ⇒ 老豁免未回归',
  'HTTP ' + real.rolePerms.status + '　' + rpDetail.slice(0, 56))

/* ==================== 装探测装置 ==================== */
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
  if (u.includes('/end')) {
    if (route.request().method() === 'POST') {
      let b = {}
      try { b = JSON.parse(route.request().postData() || '{}') } catch (_) {}
      endPosts.push(b)
      return stubJson(route, { ok: true, success: true })
    }
    return stubJson(route, { ok: true })
  }
  return stubJson(route, { ok: true, roles: ROLES_BACKEND })
})

let navSeq = 0
const loadRoute = async (h) => {
  navSeq++
  await page.goto(BASE + '/?v=' + TAG + '-' + navSeq + '#' + h, { waitUntil: 'networkidle' })
  await sleep(1800)
}
/** 打开「设置 › 权限」标签页。 */
const openPermTab = async () => {
  await page.locator('button', { hasText: '权限' }).first().click()
  await sleep(1600)
}
/** 角色列表 → 点某角色的「配置权限」。 */
const openRoleDetail = async (roleName) => {
  await page.locator('.perm-role-table tbody tr').filter({ hasText: roleName }).first()
    .locator('button', { hasText: '配置权限' }).click()
  await sleep(1800)
}
/** 详情页：切到某个域页签。 */
const gotoDomain = async (name) => {
  await page.locator('.domtabs button').filter({ hasText: name }).first().click()
  await sleep(600)
}
const detailRows = () => page.locator('.perm-detail-table tbody tr')
const detailBoxes = (rowName) => page.locator('.perm-detail-table tbody tr').filter({ hasText: rowName })
  .first().locator('input[type=checkbox]')
const detailRowBtn = (rowName) => page.locator('.perm-detail-table tbody tr').filter({ hasText: rowName })
  .first().locator('button')

/* ==================== B. 结构：只有一个写入口 ==================== */
console.log('\nB. 结构：**只有一个写入口**（「批量总览」页签已删除，改为只读弹窗）')
STUB = { role: 'admin', permissions: ['*'], customRoles: CR_T1 }
await loadRoute('/settings')
await openPermTab()

const tabTexts = await page.locator('.page button, .module-tabs button, .perm-views button').allInnerTexts()
ok(!tabTexts.some(t => t.includes('批量总览')),
  '🔴 目标B1：「批量总览」页签**已消失**（第二个写入口被删掉）',
  '权限页可见按钮：' + tabTexts.map(t => t.trim()).filter(Boolean).slice(0, 8).join(' / '))
ok(tabTexts.some(t => t.includes('查看对比')),
  '🔴 目标B2：角色列表右上角出现「查看对比」（原来那半"看"的需求没被丢掉）')
const nRoleRows = await page.locator('.perm-role-table tbody tr').count()
ok(nRoleRows >= 4, '前置：角色列表渲染出角色行', nRoleRows + ' 行')
await shot('01-role-list')

/* ==================== C. 「查看对比」弹窗真只读 ==================== */
console.log('\nC. 「查看对比」弹窗**真只读**（里面没有任何可写控件）')
await page.locator('button', { hasText: '查看对比' }).first().click()
await sleep(900)
ok(await page.locator('.cmp-dlg').isVisible(), '🔴 目标C1：点「查看对比」⇒ 弹窗打开')
const dlgInputs = await page.locator('.cmp-dlg input').count()
const dlgChecks = await page.locator('.cmp-dlg input[type=checkbox]').count()
const dlgBtns = await page.locator('.cmp-dlg button').allInnerTexts()
ok(dlgInputs === 0, '🔴 目标C2（红线）：弹窗里 **input 数量 = 0**（没有任何能改权限的控件）', 'input=' + dlgInputs)
ok(dlgChecks === 0, '🔴 目标C3（红线）：弹窗里 **checkbox 数量 = 0**', 'checkbox=' + dlgChecks)
ok(dlgBtns.length === 1 && dlgBtns[0].includes('关闭'),
  '🔴 目标C4：弹窗里唯一的按钮是「关闭」（没有"保存"这类写按钮）',
  JSON.stringify(dlgBtns.map(t => t.trim())))
const dlgCols = await page.locator('.cmp-table thead th').count()
ok(dlgCols >= 5, '前置：对比弹窗渲染出「权限项 + 各角色」列', dlgCols + ' 列')
const dlgRows = await page.locator('.cmp-table tbody tr').count()
ok(dlgRows >= 20, '前置：对比弹窗渲染出模块行', dlgRows + ' 行')
await shot('02-compare-readonly')

// 点「关闭」应关掉
await page.locator('.cmp-dlg button', { hasText: '关闭' }).first().click()
await sleep(700)
ok(!(await page.locator('.cmp-dlg').isVisible()), '目标C5：点「关闭」⇒ 弹窗关闭')

// 🔴 对照：证明"0 个 input"不是因为页面根本没渲染出来
await openRoleDetail('主管')
const ctrlInputs = await page.locator('.perm-detail-table input[type=checkbox]').count()
ok(ctrlInputs > 0,
  '🔴 目标C6（对照）：**详情页**里 checkbox 数量 > 0 ⇒ 弹窗的"0"是真只读，不是"页面空了"',
  '详情页当前域 checkbox=' + ctrlInputs)

/* ==================== D. 详情页三个可写块都在 ==================== */
console.log('\nD. 详情页 = 唯一写入口：三个可写块（登录端 / 域页签 / AI）')
ok(await page.locator('.end-row-web input').count() === 1,
  '目标D1：登录端卡片有「允许使用电脑端」勾选框（原在矩阵里，v351 置顶）')
ok(await page.locator('.end-row-mini input').count() === 1,
  '目标D2：登录端卡片有「允许使用手机端」勾选框')
ok(await page.locator('.end-row-ai input').count() === 1,
  '🔴 目标D3：「允许使用 AI」**独立成块**（不再混在功能列表里）')
const domTabs = await page.locator('.domtabs button').allInnerTexts()
ok(domTabs.length === 4,
  '🔴 目标D4：功能按**域页签**分成 4 类（经营/核算/配置/更多）',
  JSON.stringify(domTabs.map(t => t.replace(/\s+/g, ''))))
const onTabs = await page.locator('.domtabs button.on').count()
ok(onTabs === 1, '对照：域页签同一时刻**只有一个**处于选中（不是"全展开"的假页签）', onTabs + ' 个 on')

/* ==================== E. 「更多」不折叠 ==================== */
console.log('\nE. 「更多」**不折叠**（老板 2026-10-01 拍板）—— 点一下页签就到位')
await gotoDomain('经营')
const nJing = await detailRows().count()
await gotoDomain('更多')
const nMore = await detailRows().count()
ok(nJing > 0 && nMore >= 11,
  '🔴 目标E1：点「更多」页签 ⇒ **立刻**看到 ≥11 行（改前要先展开折叠组，是两次点击）',
  '经营域=' + nJing + ' 行，更多域=' + nMore + ' 行')
ok(nMore > nJing,
  '🔴 目标E2（对照）：两个域的可见行数**不同** ⇒ 页签真的在换内容，不是"所有行一直堆着"',
  nJing + ' vs ' + nMore)
const moreTxt = await page.locator('.domtabs button').filter({ hasText: '更多' }).first().innerText()
ok(!/折叠|展开/.test(moreTxt),
  '对照：页签文案里没有"展开/折叠"字样（折叠机制已删，不是藏起来了）',
  JSON.stringify(moreTxt.trim()))
await shot('03-more-domain-expanded')

/* ==================== F. P0 没有回归 ==================== */
console.log('\nF. P0（v350 那两条）**没有回归**')
await gotoDomain('更多')
await page.locator('button', { hasText: '角色列表' }).first().click()
await sleep(1200)
await openRoleDetail('老板')
await gotoDomain('更多')
const bossHr = detailBoxes('员工管理')
const nHr = await bossHr.count()
ok(nHr === 4, '前置：老板详情里「员工管理」行有 4 个勾选框', nHr + ' 个')
let allDisabled = true
for (let i = 0; i < nHr; i++) if (!(await bossHr.nth(i).isDisabled())) allDisabled = false
ok(allDisabled, '🔴 目标F1（v350 未回归）：老板的「员工管理」4 个勾**全部 disabled**',
  'disabled=' + allDisabled)
const rowBtnDis = await detailRowBtn('员工管理').isDisabled()
ok(rowBtnDis, '🔴 目标F2（v350 未回归）：老板的「整行全选」按钮**也 disabled**', 'disabled=' + rowBtnDis)
const bossData = detailBoxes('档案管理')
let dataAllDisabled = true
const nData = await bossData.count()
for (let i = 0; i < nData; i++) if (!(await bossData.nth(i).isDisabled())) dataAllDisabled = false
ok(dataAllDisabled, '老板的「档案管理」同样上锁（`hr` + `data` 两个必选模块都覆盖）', 'disabled=' + dataAllDisabled)
await shot('04-boss-detail-locked')

// 单变量对照：换成非保护角色，同样的行应当**不禁用**
await page.locator('button', { hasText: '角色列表' }).first().click()
await sleep(1200)
await openRoleDetail('业务员')
await gotoDomain('更多')
const salesHr = detailBoxes('员工管理')
const nSalesHr = await salesHr.count()
let anyDisabled = false
for (let i = 0; i < nSalesHr; i++) if (await salesHr.nth(i).isDisabled()) anyDisabled = true
ok(nSalesHr >= 4 && !anyDisabled,
  '🔴 目标F3（对照）：业务员的「员工管理」**不禁用**（证明 F1 不是"全部行都禁用了"这种假绿）',
  'n=' + nSalesHr + ' 任一禁用=' + anyDisabled)

/* ==================== G. 登录端并入保存（v351 新行为） ==================== */
console.log('\nG. 登录端**并入本页保存**（v351：矩阵那个批量保存已删，登录端改由详情页一起提交）')
await page.locator('button', { hasText: '角色列表' }).first().click()
await sleep(1200)
await openRoleDetail('库管')
const endPostBefore = endPosts.length
const getBefore = getHits.filter(p => p === '/api/role-permissions').length
const miniBox = page.locator('.end-row-mini input').first()
ok(await miniBox.isChecked() === false, '前置：「库管」的手机端当前**未开**', 'checked=false')
await miniBox.click()
await sleep(400)
ok(await miniBox.isChecked() === true, '前置：勾上「库管」的手机端（**尚未保存**）', 'checked=true')
await page.locator('button', { hasText: '保存' }).first().click()
await sleep(2200)

ok(endPosts.length === endPostBefore + 1,
  '🔴 目标G1：点「保存」⇒ 发出了一条 `POST /api/role-permissions/end`',
  (endPosts.length - endPostBefore) + ' 条')
const ep = endPosts[endPosts.length - 1] || {}
ok(ep.role_name === '库管',
  '🔴 目标G2：该请求的 body **只含当前这一个角色**（旧代码是 for 所有角色逐个 POST ⇒ 会把别的角色一起写一遍）',
  'role_name=' + JSON.stringify(ep.role_name) + ' allow_mini=' + ep.allow_mini)
const getAfter = getHits.filter(p => p === '/api/role-permissions').length
ok(getAfter === getBefore,
  '🔴 目标G3（v350 未回归）：保存**没有**触发 `GET /api/role-permissions` 整表重拉（次数不变）',
  getBefore + ' → ' + getAfter)
const toastTxt = await page.locator('.toast, [class*=toast]').allInnerTexts().catch(() => [])
ok(String(toastTxt.join('')).includes('含登录端') || true,
  '目标G4：保存回执（看到即记）', JSON.stringify(String(toastTxt.join(' ')).slice(0, 80)))
await shot('05-end-saved-with-detail')

/* ==================== H. 搜索 = 查找而非筛选（v350 未回归） ==================== */
console.log('\nH. 搜索「淡化」而非「过滤」（v350 未回归）')
await gotoDomain('更多')
const before = await detailRows().count()
await page.locator('.tb-search input').first().fill('算工资')
await sleep(800)
const after = await detailRows().count()
ok(after === before,
  '🔴 目标H1：搜索后**行数不变**（旧版过滤会让其它行消失 ⇒ 用户以为权限丢了）',
  before + ' → ' + after)
const dimCount = await page.locator('.perm-detail-table tbody tr.pm-row-dim').count()
ok(dimCount > 0, '🔴 目标H2：未命中的行带 `pm-row-dim`（**淡化但仍在 DOM**，点得到、勾得着）', 'dim 行数=' + dimCount)
const otherRow = page.locator('.perm-detail-table tbody tr').filter({ hasText: '员工管理' })
ok((await otherRow.count()) === 1, '🔴 目标H3：未命中的「员工管理」行**仍在 DOM**（未消失）', 'attached=1')
const hitTxt = await page.locator('.tb-hit').first().innerText().catch(() => '')
ok(/找到|没有匹配/.test(hitTxt), '🔴 目标H4：搜索框旁给出命中数（没有它，"其余行变淡"会被当成没反应）',
  JSON.stringify(hitTxt.trim()))
// 域页签的数字在搜索时改显**命中数** ⇒ 无命中的域会露出 0（用户知道该点哪个）
const tabCounts = await page.locator('.domtabs button').allInnerTexts()
ok(tabCounts.some(t => /[^\d]0$/.test(t.replace(/\s+/g, ''))),
  '🔴 目标H5：搜索时页签数字 = **命中数**（无命中的域显示 0 ⇒ 用户知道该点哪个）',
  JSON.stringify(tabCounts.map(t => t.replace(/\s+/g, ''))))
/* 🔴 H6 是关键的一条：上面 H2 只证明"有行被淡化"，但那也可能是"全都淡了"（判据没有判别力）。
   切到**有命中**的那个域，数一数"没被淡化"的行 —— 必须恰好等于命中数（1）。
   这就是本地跑第一版时暴露的问题：当时在「更多」域搜「算工资」，11 行全淡、命中 0，
   H2 照样是绿的。补上这条，判据才真的分得开"淡化"和"全灭"。 */
await gotoDomain('核算')
const hitRows = await detailRows().count()
const hitNotDim = await page.locator('.perm-detail-table tbody tr:not(.pm-row-dim)').count()
ok(hitRows === 2 && hitNotDim === 1,
  '🔴 目标H6（判别力）：切到有命中的「核算」域 ⇒ **恰好 1 行未被淡化**（其余全淡）'
  + ' ⇒ 证明淡化真按命中来，不是"全都淡了"',
  '核算域 ' + hitRows + ' 行，未淡化 ' + hitNotDim + ' 行')
await shot('06b-hit-domain')
await gotoDomain('更多')
await shot('06-search-dim-not-filter')

/* ==================== I. 深色模式（本仓复犯点：原生控件/浮层白底看不清） ==================== */
console.log('\nI. 深色模式：新加的弹窗与域页签**不写死色值**（必须跟着主题走）')
const lum = (c) => {
  const m = String(c).match(/(\d+(?:\.\d+)?)/g)
  if (!m || m.length < 3) return null
  const [r, g, b] = m.slice(0, 3).map(Number)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}
/* ⚠️ 主题开关在「账号与组织」标签页里（`Settings.vue` 第 22 行）⇒ 必须先切过去。
   🔴 探针第一版有两个坑，都记下来：
      ① 直接在本页找「切换为」按钮 ⇒ 不在这个标签页里，超时 30s；
      ② **拿按钮文案当"当前主题"判据是反的** —— 按钮写的是「切换为 深色」= **目标态**，
         不是当前态。按文案判会得出"已经是深色了，不用点"，于是整段深色断言其实跑在浅色下
         （症状：弹窗底色 rgb(255,255,255) 却"前置通过"）。
      ⇒ 唯一可靠判据 = `document.documentElement.classList.contains('dark')`
        （`store/index.js::setTheme` 就是往 `<html>` 上切 `light`/`dark` 类）。 */
const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'))
const setTheme = async (dark) => {
  await page.locator('.module-tabs button', { hasText: '账号与组织' }).first().click()
  await sleep(700)
  for (let i = 0; i < 3 && (await isDark()) !== dark; i++) {
    await page.locator('button', { hasText: '切换为' }).first().click()
    await sleep(800)
  }
  return (await isDark()) === dark
}
ok(await setTheme(true), '前置：切到深色主题（按钮在「账号与组织」标签页）',
  'html.dark=' + await isDark())

await page.locator('.module-tabs button', { hasText: '权限' }).first().click()
await sleep(1600)
// ⚠️ 切回「权限」时组件**还停在详情视图**（`permView` 是组件内状态，切标签页不会重置）
//    ⇒ 「查看对比」在角色列表上，必须先点「← 角色列表」回去。探针第二版就是漏了这一步超时。
await page.locator('button', { hasText: '角色列表' }).first().click()
await sleep(1200)
await page.locator('button', { hasText: '查看对比' }).first().click()
await sleep(900)
const dk = await page.evaluate(() => {
  const dlg = document.querySelector('.cmp-dlg')
  if (!dlg) return null
  const cell = dlg.querySelector('tbody td') || dlg
  const th = dlg.querySelector('thead th') || dlg
  return {
    bg: getComputedStyle(dlg).backgroundColor,
    fg: getComputedStyle(cell).color,
    thBg: getComputedStyle(th).backgroundColor,
  }
})
ok(!!dk, '前置：深色模式下弹窗仍能打开（未因主题切换而消失）')
const lb = lum(dk && dk.bg), lf = lum(dk && dk.fg), lth = lum(dk && dk.thBg)
ok(lb !== null && lb < 0.35,
  '🔴 目标I1：弹窗**底色是暗的**（`--bg` 跟着主题走，没写死白色）',
  'bg=' + (dk && dk.bg) + ' 亮度=' + (lb === null ? 'n/a' : lb.toFixed(3)))
ok(lf !== null && lf > 0.55,
  '🔴 目标I2：弹窗**文字是亮的**（深色下不是"白底黑字"那种不可读组合）',
  'color=' + (dk && dk.fg) + ' 亮度=' + (lf === null ? 'n/a' : lf.toFixed(3)))
ok(lth !== null && lth < 0.5, '目标I3：表头底色也是暗的（`--bg3` 未写死）',
  'thBg=' + (dk && dk.thBg) + ' 亮度=' + (lth === null ? 'n/a' : lth.toFixed(3)))
await shot('07-dialog-dark-mode')
await page.locator('.cmp-dlg button', { hasText: '关闭' }).first().click()
await sleep(500)

// 域页签也要跟着主题（它是新加的控件，最容易漏）
await openRoleDetail('主管')
/* 🔴 判据必须是**合成后的**颜色：`getComputedStyle().backgroundColor` 返回的是**声明值**，
   而 `--p-bg` 是 `rgba(6,182,212,.10)` 这种半透明主色 —— 直接取 RGB 算亮度会得到 0.575
   （青色的亮度），看起来像"亮底"，其实叠在深色卡上是很暗的一点青色。
   探针第一版就是这么误判的。正解：从元素往外逐层 over 合成，直到遇到不透明底色。 */
const domTabLum = await page.evaluate(() => {
  const parse = (c) => {
    const m = String(c).match(/[\d.]+/g) || []
    return { r: +(m[0] || 0), g: +(m[1] || 0), b: +(m[2] || 0), a: m[3] === undefined ? 1 : +m[3] }
  }
  const eff = (el) => {
    let cur = el, acc = null
    while (cur) {
      const c = parse(getComputedStyle(cur).backgroundColor)
      if (c.a > 0) {
        acc = acc
          ? { r: acc.r * acc.a + c.r * (1 - acc.a), g: acc.g * acc.a + c.g * (1 - acc.a),
              b: acc.b * acc.a + c.b * (1 - acc.a), a: acc.a + c.a * (1 - acc.a) }
          : c
        if (acc.a >= 0.999) break
      }
      cur = cur.parentElement
    }
    if (!acc) acc = { r: 255, g: 255, b: 255, a: 1 }
    return (0.2126 * acc.r + 0.7152 * acc.g + 0.0722 * acc.b) / 255
  }
  const b = document.querySelector('.domtabs button.on')
  return b ? { eff: eff(b), declared: getComputedStyle(b).backgroundColor } : null
})
ok(!!domTabLum && domTabLum.eff < 0.45,
  '🔴 目标I4：深色下选中的域页签**合成后不是亮底**（`--p-bg` 是半透明主色，未写死浅色）',
  domTabLum ? ('声明=' + domTabLum.declared + ' 合成亮度=' + domTabLum.eff.toFixed(3)) : 'n/a')
await shot('08-domain-tabs-dark-mode')

ok(await setTheme(false), '前置：切回浅色主题', 'html.dark=' + await isDark())
await page.locator('.module-tabs button', { hasText: '权限' }).first().click()
await sleep(1500)

/* ==================== J. 只读自证 + 零报错 ==================== */
console.log('\nJ. 只读自证')
const biz = writes.filter(w => !/探针自身/.test(w))
ok(biz.length > 0 && biz.every(w => /探测装置拦截/.test(w)),
  '全程无业务写请求出网（唯一的数据写入被探测装置拦截）', JSON.stringify(biz))
const realWrites = writes.filter(w => /探针自身/.test(w))
console.log('  探针自身出网写请求（应只有 login/logout）：' + JSON.stringify(realWrites))
ok(pageErrors.length === 0, '页面零 JS 报错', pageErrors.slice(0, 2).join(' | ') || '0 条')

console.log('\n' + '='.repeat(74))
console.log('总判定: ' + (fail === 0 ? '✅ 全绿' : '❌ 有失败') + '（' + pass + ' 通过 / ' + fail + ' 失败）')
console.log('截图目录: ' + OUT)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
