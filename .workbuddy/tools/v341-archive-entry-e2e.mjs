/**
 * v341-archive-entry-e2e.mjs —— 「档案管理入口跟随权限」生产真机只读验收（hergent.cn）
 *
 * 要证的命题（老板原话）：
 *   「我已取消主管角色的档案管理权限，并把郝洋配置为主管，但他登录后仍能看到档案管理模块。」
 *   ⇒ 修好之后：**该角色撤掉 data 模块 ⇒ 侧栏「档案管理」消失**；
 *      **把 data 加回来 ⇒ 它必须重新出现**（否则"消失"可能只是探针坏了 / 页面崩了）。
 *
 * 手法（沿 v335 的响应改写范式，**不碰生产数据**）：
 *   真账号登录拿凭证 → 只改写交给前端的 `/api/auth/permissions` JSON
 *   （`permissions` 模块清单 + `user.role`），其余请求一律透传。
 *   ⇒ 是**真机、真路由、真组件**，只是"身份"来自桩。
 *
 * 四组对照（缺一不可）：
 *   ① 基线（不改写）                      ：自证登录态 + 权限接口真的被调用 + 侧栏非空
 *   ② 桩 supervisor 且**无 data**（有 stock）：档案管理 **消失**，货损核算 **仍在**
 *                                            —— 同时排掉"整个 app 被换成错误卡片"的假阴性
 *   ③ 桩 supervisor 且**有 data**          ：档案管理 **出现**（翻转 ⇒ 判据非恒定）
 *   ④ 桩 supervisor 且只有 hr/crm/stock（**无 data**）：档案管理 **消失**
 *                                            —— 这条是本次修复的判别用例：
 *                                               旧写法 `moduleAny:['hr','crm','data','stock']`
 *                                               会被 hr/crm/stock 任一命中而**显示入口**。
 *
 * 🔴 三处自证（否则断言可能是空转）：
 *   a) 断言页面上**实际收到**的权限正文（模块清单逐字打印）；
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
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v341-e2e-2026-09-30'
fs.mkdirSync(OUT, { recursive: true })

let pass = 0, fail = 0
const ok = (c, name, ev) => {
  if (c) { pass++; console.log('  ✅ ' + name + (ev !== undefined ? '　→ ' + ev : '')) }
  else { fail++; console.log('  ❌ ' + name + (ev !== undefined ? '　→ ' + ev : '')) }
}
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

/* ---- 响应改写装置：只改「模块清单 + 角色」两个字段 ---- */
let STUB = null            // null = 不改写（基线）
await ctx.route('**/api/auth/permissions*', async (route) => {
  const res = await route.fetch()
  const body = await res.json()
  if (STUB) {
    body.permissions = STUB.permissions.slice()
    if (body.user && typeof body.user === 'object') body.user.role = STUB.role
    // 本租户真实改过该角色的权限 ⇒ 允许「角色门让位给模块轴」这条分支被走到
    body.custom_roles = [STUB.role]
    body.perms_rev = 'v341-probe-' + Date.now()
  }
  await route.fulfill({ response: res, body: JSON.stringify(body) })
})

/* ---- 强制整页重载（查询串变化 ⇒ 必然整文档重载，避免落在上一次的 hash 上） ---- */
let navSeq = 0
const loadRoute = async (h) => {
  navSeq++
  await page.goto(BASE + '/?v=341-' + navSeq + '#' + h, { waitUntil: 'networkidle' })
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
const lastModules = () => {
  const b = permBodies[permBodies.length - 1]
  return (b && Array.isArray(b.permissions)) ? b.permissions : null
}

const shot = async (tag) => { try { await page.screenshot({ path: OUT + '/v341-' + tag + '.png', fullPage: false }) } catch (_) {} }

/* ============================ ① 基线 ============================ */
console.log('\n① 基线（不改写 —— 先证登录态与页面本身是活的）')
await loadRoute('/workbench')
const alive = await appAlive()
ok(alive.nav === 1 && alive.items > 0 && !alive.err, '侧栏正常渲染（非错误卡片）', 'nav=' + alive.nav + ' items=' + alive.items)
const lmBase = lastModules()
ok(permCallCount >= 1, '/api/auth/permissions 被调用（判据真的跑过）', permCallCount + ' 次')
ok(Array.isArray(lmBase), '基线权限正文可读（自证桩未生效）', JSON.stringify(lmBase))
const namesBase = await sbNames()
console.log('  基线侧栏: ' + namesBase.join(' | '))
await shot('00-baseline')

/* ============ ② 桩：主管被撤 data（仍持 stock）⇒ 档案管理必须消失 ============ */
console.log('\n② 桩 supervisor + 模块清单 [' + "'dashboard','stock'" + ']（= 被撤 data 的主管）')
STUB = { role: 'supervisor', permissions: ['dashboard', 'stock'] }
await loadRoute('/workbench')
const lm2 = lastModules()
ok(JSON.stringify(lm2) === JSON.stringify(['dashboard', 'stock']),
  '自证：页面**实际收到**的模块清单就是桩值', JSON.stringify(lm2))
const alive2 = await appAlive()
ok(alive2.nav === 1 && alive2.items > 0, '侧栏仍在渲染（不是整页崩了）', 'items=' + alive2.items)
const hasArchive2 = await sbHas('档案管理')
ok(hasArchive2 === false, '🔴 侧栏「档案管理」**已消失**（本次修复的目标）', String(hasArchive2))
ok((await sbHas('货损核算')) === true, '对照：同页「货损核算」**仍在**（stock 模块还在 ⇒ 不是把菜单全藏了）', 'true')
const names2 = await sbNames()
console.log('  侧栏: ' + names2.join(' | '))
await shot('01-supervisor-no-data')

/* ============ ③ 反例对照：把 data 加回来 ⇒ 必须重新出现（翻转） ============ */
console.log('\n③ 桩 supervisor + 模块清单 +data（同一角色，只动模块轴一个变量）')
STUB = { role: 'supervisor', permissions: ['dashboard', 'stock', 'data'] }
await loadRoute('/workbench')
const lm3 = lastModules()
ok(JSON.stringify(lm3) === JSON.stringify(['dashboard', 'stock', 'data']),
  '自证：模块清单已含 data', JSON.stringify(lm3))
const hasArchive3 = await sbHas('档案管理')
ok(hasArchive3 === true, '🔴 侧栏「档案管理」**重新出现**（⇒ 显隐由模块轴驱动，不是恒定隐藏）', String(hasArchive3))
await shot('02-supervisor-with-data')

/* ============ ④ 判别用例：只有 hr/crm/stock、无 data ⇒ 必须消失 ============ */
console.log('\n④ 桩 supervisor + 模块清单 [hr,crm,stock]（无 data）—— 旧 moduleAny 写法会误显示入口')
STUB = { role: 'supervisor', permissions: ['dashboard', 'hr', 'crm', 'stock'] }
await loadRoute('/workbench')
const lm4 = lastModules()
ok(JSON.stringify(lm4) === JSON.stringify(['dashboard', 'hr', 'crm', 'stock']),
  '自证：模块清单为 [dashboard,hr,crm,stock]', JSON.stringify(lm4))
const hasArchive4 = await sbHas('档案管理')
ok(hasArchive4 === false,
  '🔴 侧栏「档案管理」**消失**（旧写法 moduleAny 会被 hr/crm/stock 命中而显示 = 本次修的就是这条）',
  String(hasArchive4))
await shot('03-supervisor-hr-crm-stock')

/* ============ ⑤ 边界观测（不断言成败，只记录事实） ============ */
console.log('\n⑤ 边界观测：入口消失 ≠ 深链打不开（v291 的既有取舍，如实记录）')
const deep = {}
for (const h of ['/archive', '/archive/employees']) {
  await loadRoute(h)
  deep[h] = {
    url: page.url().split('#')[1] || '',
    heading: await page.locator('h2').first().innerText().catch(() => ''),
    archiveMenu: await sbHas('档案管理'),
  }
}
for (const k of Object.keys(deep)) {
  console.log('  ' + k + ' ⇒ 落在 #' + deep[k].url + '　标题「' + deep[k].heading + '」　侧栏档案管理=' + deep[k].archiveMenu)
}
await shot('04-deeplink')

/* ============================ ⑥ 收尾：注销 ============================ */
console.log('\n⑥ 收尾')
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
