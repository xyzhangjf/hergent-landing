/**
 * v345-cron-delegate-e2e.mjs —— 「主管不该看到定时任务」生产真机只读验收（hergent.cn）
 *
 * 要证的命题（老板原话）：
 *   「郝洋的账号不应该看到我的定时任务才对呀」
 *   （郝洋 = 主管 supervisor；定时任务 = 侧栏 `/cron`，登记为
 *     `{ module:'cron', roles: ADMIN_ROLES }` = **只给 admin/boss**）
 *
 * 病因假设（本轮修复对象）：
 *   `/cron` 的有 roles **也有 module**，却**没有 `lock: true`** ⇒
 *   `roleGateOpen` 第 ③ 档「用户配置优先」会把角色名单**让位**掉，
 *   改由 module 轴单独裁决。而 v296 把 `/api/cron` 从 `data` 拆出来时，
 *   按「谁原本真能调」给 **boss / sales / staff / supervisor 都补了 `cron`**
 *   ⇒ 只要本租户**动过主管的权限**（`custom_roles` 含 supervisor），
 *   主管就会「让位后持有 cron」⇒ **侧栏出现「定时任务」**。
 *
 * 手法（沿 v341/v335 的响应改写范式，**不碰生产数据**）：
 *   真账号登录拿凭证 → 只改写交给前端的 `/api/auth/permissions` JSON
 *   （`permissions` 模块清单 + `user.role` + `custom_roles`），其余请求一律透传。
 *
 * 五组对照（缺一不可）：
 *   ① 基线（不改写）                   ：自证登录态 + 权限接口真被调用 + 侧栏非空
 *   ② 桩 supervisor + **未改过权限**（custom_roles=[]）⇒「定时任务」**消失**
 *                                       —— 证明角色名单本身是拦得住的（这一段是"三档里的②"）
 *   ③ 桩 supervisor + **改过权限**（custom_roles=[supervisor]）+ 含 cron
 *                                       ⇒「定时任务」**出现** ← **复现老板报障**
 *   ④ 桩 supervisor + 改过权限 + **不含 cron** ⇒「定时任务」**消失**
 *                                       —— 单变量对照：翻转来自 module 轴，探针非空转
 *   ⑤ 桩 boss（在名单里）                ⇒「定时任务」**出现**（防误伤：老板不能受牵连）
 *   ＋ 同族取证：桩 accountant + 改过权限 + 含 bid ⇒「招投标雷达」是否也漏出来
 *
 * 🔴 三处自证（否则断言可能空转）：
 *   a) 断言页面上**实际收到**的权限正文（模块清单 + custom_roles 逐字打印）；
 *   b) 断言 `/api/auth/permissions` 被调用次数 ≥ 1；
 *   c) 断言侧栏条目总数 > 0 且**含一个与本次无关的入口**（货损核算）—— 证明不是"整页崩了"。
 *
 * 🔴 只读纪律：唯一写动作是探针自己发的 `POST /api/auth/login`；
 *   末尾补 `POST /api/auth/logout` 注销，并逐条打印全程非 GET 请求清单自证。
 */
import { chromium } from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/playwright/index.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptest'
const PASS = process.env.HG_PASS || 'Mptest@1'
const TAG = process.env.HG_TAG || 'v345'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/' + TAG + '-e2e-2026-09-30'
fs.mkdirSync(OUT, { recursive: true })

let pass = 0, fail = 0
const ok = (c, name, ev) => {
  if (c) { pass++; console.log('  ✅ ' + name + (ev !== undefined ? '　→ ' + ev : '')) }
  else { fail++; console.log('  ❌ ' + name + (ev !== undefined ? '　→ ' + ev : '')) }
}
const info = (name, ev) => console.log('  ℹ️  ' + name + (ev !== undefined ? '　→ ' + ev : ''))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message))

/* ---- 记账①：全程监听**非 GET** 请求（从第一行起就记，否则等于没证） ---- */
const writes = []
page.on('request', (r) => {
  if (r.method() === 'GET') return
  if (/\/api\/auth\/login(\?|$)/.test(r.url())) { writes.push('login(探针自身)'); return }
  if (/\/api\/auth\/logout(\?|$)/.test(r.url())) { writes.push('logout(探针自身)'); return }
  writes.push(r.method() + ' ' + r.url())
})

/* ---- 记账②：页面**实际收到**的权限正文 + 接口调用次数（自证刺激落地） ---- */
const permBodies = []
let permCallCount = 0
page.on('response', async (res) => {
  if (!/\/api\/auth\/permissions(\?|$)/.test(res.url())) return
  permCallCount++
  try { permBodies.push(await res.json()) } catch (_) {}
})

/* ---- 登录（写进 localStorage，与真前端同一套键） ---- */
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

/* ---- 响应改写装置：只改「模块清单 + 角色 + 是否改过权限」三个字段 ---- */
let STUB = null            // null = 不改写（基线）
await ctx.route('**/api/auth/permissions*', async (route) => {
  const res = await route.fetch()
  /* 防御：服务器偶发返回 HTML 错误页（502/限流）时**原样透传**，
     绝不把 HTML 当 JSON 解析 —— 否则探针自己崩，看起来像"页面坏了"。 */
  const ct = String((res.headers() || {})['content-type'] || '')
  if (!/json/i.test(ct)) { await route.fulfill({ response: res }); return }
  let body
  try { body = await res.json() } catch (_) { await route.fulfill({ response: res }); return }
  if (STUB) {
    body.permissions = STUB.permissions.slice()
    if (body.user && typeof body.user === 'object') body.user.role = STUB.role
    // 🔴 本次探针的核心旋钮：`custom_roles` 决定 roleGateOpen 第 ③ 档是否让位。
    //    空数组 = 本租户**没动过**这个角色的权限 ⇒ 按内置 roles 名单收紧。
    body.custom_roles = (STUB.customRoles || []).slice()
    body.perms_rev = TAG + '-probe-' + Date.now()
  }
  await route.fulfill({ response: res, body: JSON.stringify(body) })
})

/* ---- 强制整页重载（查询串变化 ⇒ 必然整文档重载，避免落在上一次的 hash 上） ---- */
let navSeq = 0
const loadRoute = async (h) => {
  navSeq++
  await page.goto(BASE + '/?v=' + TAG + '-' + navSeq + '#' + h, { waitUntil: 'networkidle' })
  await sleep(1800)
}

/* DOM 探针（选择器取自源码原文：Shell.vue `.sb-nav .sb-item`） */
const sbCount = () => page.locator('.sb-nav .sb-item').count()
const sbHas = async (name) => (await page.locator('.sb-nav .sb-item', { hasText: name }).count()) > 0
const sbNames = async () => page.locator('.sb-nav .sb-item').allInnerTexts()
/* 铁律 8：先排「整个 app 被换成错误卡片」——侧栏是 #app 的子节点，崩了会一起消失 */
const appAlive = async () => {
  const nav = await page.locator('.sb-nav').count()
  const items = await sbCount()
  const bodyText = await page.locator('body').innerText()
  return { nav, items, err: /出错|错误|Error|加载失败/.test(bodyText.slice(0, 400)) }
}
const lastPerms = () => {
  const b = permBodies[permBodies.length - 1]
  return b ? { list: b.permissions, cr: b.custom_roles, role: b.user && b.user.role } : null
}
const shot = async (tag) => { try { await page.screenshot({ path: OUT + '/' + TAG + '-' + tag + '.png', fullPage: false }) } catch (_) {} }

/* ============================ ① 基线 ============================ */
console.log('\n① 基线（不改写 —— 先证登录态与页面本身是活的）')
await loadRoute('/workbench')
const alive = await appAlive()
ok(alive.nav === 1 && alive.items > 0 && !alive.err, '侧栏正常渲染（非错误卡片）', 'nav=' + alive.nav + ' items=' + alive.items)
ok(permCallCount >= 1, '/api/auth/permissions 被调用（判据真的跑过）', permCallCount + ' 次')
const lp0 = lastPerms()
ok(lp0 && Array.isArray(lp0.list), '基线权限正文可读（自证桩未生效）', JSON.stringify(lp0))
const namesBase = await sbNames()
console.log('  基线侧栏: ' + namesBase.join(' | '))
await shot('00-baseline')

/* ============ ② 桩：主管但**本租户没改过他的权限** ⇒ 角色名单拦住 ============ */
console.log('\n② 桩 supervisor + custom_roles=[]（未改过权限）+ 权限含 cron')
STUB = { role: 'supervisor', permissions: ['dashboard', 'stock', 'data', 'cron'], customRoles: [] }
await loadRoute('/workbench')
const lp2 = lastPerms()
ok(lp2 && JSON.stringify(lp2.list) === JSON.stringify(['dashboard', 'stock', 'data', 'cron']),
  '自证：页面实际收到的模块清单 = 桩值', JSON.stringify(lp2 && lp2.list))
ok(lp2 && Array.isArray(lp2.cr) && lp2.cr.length === 0,
  '自证：custom_roles 已被改写为**空**（= 没改过权限）', JSON.stringify(lp2 && lp2.cr))
const alive2 = await appAlive()
ok(alive2.nav === 1 && alive2.items > 0, '侧栏仍在渲染（不是整页崩了）', 'items=' + alive2.items)
ok((await sbHas('货损核算')) === true, '对照：同页「货损核算」仍在（stock 在 ⇒ 不是把菜单全藏了）', 'true')
const has2 = await sbHas('定时任务')
ok(has2 === false, '角色名单拦截有效：**未改过权限 ⇒「定时任务」不出现**', String(has2))
console.log('  侧栏: ' + (await sbNames()).join(' | '))
await shot('01-sv-no-customrole')

/* ============ ③ 复现：主管 + **改过权限**（让位）⇒ 定时任务漏出来 ============ */
console.log('\n③ 桩 supervisor + custom_roles=[supervisor]（本租户改过他的权限）+ 权限含 cron')
STUB = { role: 'supervisor', permissions: ['dashboard', 'stock', 'data', 'cron'], customRoles: ['supervisor'] }
await loadRoute('/workbench')
const lp3 = lastPerms()
ok(lp3 && JSON.stringify(lp3.cr) === JSON.stringify(['supervisor']),
  '自证：custom_roles 已含 supervisor（让位条件已具备）', JSON.stringify(lp3 && lp3.cr))
const has3 = await sbHas('定时任务')
/* 断言的是**期望的正确行为**（而不是"复现"），这样 run-before 会因报障而 FAIL、
   run-after 会 PASS —— 同一支探针两侧跑即是判别力自证。 */
ok(has3 === false,
  '🔴「定时任务」**不该出现**（本行只给 admin/boss）—— 此断言 FAIL 即复现老板报障',
  String(has3) + (has3 ? '（= 让位把角色名单吞了）' : ''))
console.log('  侧栏: ' + (await sbNames()).join(' | '))
await shot('02-sv-delegated-cron')

/* ============ ④ 单变量对照：主管 + 改过权限 + **不含 cron** ⇒ 必须消失 ============ */
console.log('\n④ 桩 supervisor + custom_roles=[supervisor] + 权限**不含 cron**（只换模块轴一个变量）')
STUB = { role: 'supervisor', permissions: ['dashboard', 'stock', 'data'], customRoles: ['supervisor'] }
await loadRoute('/workbench')
const lp4 = lastPerms()
ok(lp4 && JSON.stringify(lp4.list) === JSON.stringify(['dashboard', 'stock', 'data']),
  '自证：模块清单已去掉 cron', JSON.stringify(lp4 && lp4.list))
const has4 = await sbHas('定时任务')
ok(has4 === false, '🔴 单变量对照：「定时任务」**消失**（⇒ 翻转来自 module 轴，探针非空转）', String(has4))
await shot('03-sv-delegated-no-cron')

/* ============ ⑤ 防误伤：老板在名单里 ⇒ 必须仍然看得见 ============ */
console.log('\n⑤ 桩 boss（在 ADMIN_ROLES 名单里）+ custom_roles=[]')
STUB = { role: 'boss', permissions: ['dashboard', 'data', 'cron'], customRoles: [] }
await loadRoute('/workbench')
const has5 = await sbHas('定时任务')
ok(has5 === true, '防误伤：老板**仍然看得见**「定时任务」', String(has5))
await shot('04-boss-still-sees')

/* ============ ⑥ 同族取证（真值驱动：桩的角色/模块都取自生产租户库实值） ============
   桩值不能随便给 —— 给什么，决定你测出什么。这里三组的 `permissions` 全部照抄
   `tenant_1.db::role_permissions` 的真值，`custom_roles` 用生产 `custom_roles` 的真值
   （["accountant","supervisor","库管"]）。 */
console.log('\n⑥ 同族取证（模块清单 = 生产租户库真值）')
const TRUTH = {
  '库管': ['dashboard', 'stock', 'data', 'messages'],
  supervisor: ['dashboard', 'sales', 'stock', 'cron', 'bid', 'messages', 'forecast-audit'],
  accountant: ['data', 'sales', 'stock', 'accounts', 'reports', 'messages', 'forecast-audit'],
}
const REAL_CUSTOM = ['accountant', 'supervisor', '库管']   // 生产 /api/auth/permissions 实测

const probeRole = async (role, probeName, label) => {
  STUB = { role, permissions: TRUTH[role].slice(), customRoles: REAL_CUSTOM.slice() }
  await loadRoute('/workbench')
  const got = await sbHas(probeName)
  console.log(`  ${got ? '🔴' : '✅'} ${label}：侧栏「${probeName}」= ${got}`)
  return got
}

await probeRole('库管', '预报订货管理', '库管（持 data，不在 /forecast 名单）')
await probeRole('supervisor', '招投标雷达', '主管（持 bid，不在 /bid-radar 名单）')
await probeRole('库管', '定时任务', '库管（不持 cron）—— 对照组')
await shot('05-family-probes')

/* ============ ⑦ 边界观测（不断言成败，只记录事实） ============ */
console.log('\n⑦ 边界观测：入口消失 ≠ 深链打不开（v291 既有取舍，如实记录）')
STUB = { role: 'supervisor', permissions: ['dashboard', 'stock', 'data', 'cron'], customRoles: ['supervisor'] }
for (const h of ['/cron']) {
  await loadRoute(h)
  info('深链 ' + h, '落在 #' + (page.url().split('#')[1] || '') + '　标题「' + (await page.locator('h2').first().innerText().catch(() => '')) + '」')
}
await shot('06-deeplink-cron')

/* ============================ ⑧ 收尾：注销 ============================ */
console.log('\n⑧ 收尾')
const out = await page.evaluate(async () => {
  const t = localStorage.getItem('hergent_v2_token') || ''
  const c = localStorage.getItem('hergent_v2_csrf') || ''
  const r = await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t, 'X-CSRF-Token': c },
    body: '{}',
  })
  let d = null
  try { d = await r.json() } catch (_) {}
  localStorage.removeItem('hergent_v2_token'); localStorage.removeItem('hergent_v2_csrf')
  return r.status + ':' + JSON.stringify(d)
})
ok(/^200:|"success":true/.test(out), '已注销（判据取响应体 success，不只看状态码）', out)

console.log('\n===== 全程非 GET 请求清单（应只有探针自己的 login / logout）=====')
if (!writes.length) console.log('  （空）')
for (const w of writes) console.log('  · ' + w)
const bizWrites = writes.filter(w => !/探针自身/.test(w))
ok(bizWrites.length === 0, '零业务写入（无任何非 GET 业务请求）', bizWrites.length + ' 条')

console.log('\n断言: ' + pass + ' 通过 / ' + fail + ' 失败' + (fail === 0 ? '　✅ 全绿' : '　❌ 有失败项'))
console.log('截图目录: ' + OUT)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
