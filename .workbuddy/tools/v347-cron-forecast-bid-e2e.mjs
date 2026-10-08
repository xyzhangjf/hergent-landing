/**
 * v347-cron-forecast-bid-e2e.mjs —— 生产真机只读验收（hergent.cn）
 *
 * 要证的三件事（老板原话）：
 *   ① 「郝洋的账号不应该看到我的定时任务才对呀」 → 主管**看不见**「定时任务」
 *      （v345 断了入口/深链，v347 撤了数据层 `cron`）
 *   ② 「『招投标雷达』要给主管看」                → 主管**看得见**「招投标雷达」
 *      （v347 把 supervisor 写进 `/bid-radar` 的 roles，隐式让位改显式）
 *   ③ 「『预报订货管理』漏给库管 → 修」            → 库管**看不见**「预报订货管理」
 *      （v347 把 `/api/forecast` 从 `data` 拆到窄模块 `forecast`）
 *
 * 外加一条**边界**断言（不是老板要求，是本批改动自带的回归风险）：
 *   ④ 库管深链进 `/forecast` ⇒ 页内 `/api/forecast/*` 必须 403，且页面必须给出
 *      **常驻**说明（`Forecast.vue::forecastDenied` 横幅）—— 不许是「有页头、有按钮、
 *      没有任何期次」的**无说明空壳**（静默失效），也不许渲染出假数据。
 *      为什么必须验：v347 之前库管持 `data`，`loadPeriods()` 是 200 —— 这条空壳路径
 *      是**本批拆模块新引入**的（它把 catch 的静默从"不会发生"变成了"会发生"）。
 *
 * 🔴 真值驱动（v345 学到的教训：「桩值能证机制、不能证存在」）：
 *   本探针的所有角色/模块清单**全部照抄生产 `role_permissions` 实测值**
 *   （v347 迁移后的真值），不凭想象编。
 *
 * 🔴 只读纪律：唯一写动作是探针自己发的 `POST /api/auth/login`（+ 末尾 logout），
 *   全程记账并打印非 GET 请求清单自证。
 */
import { chromium } from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/playwright/index.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptest'
const PASS = process.env.HG_PASS || 'Mptest@1'
const TAG = process.env.HG_TAG || 'v347'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/' + TAG + '-e2e-2026-09-30'
fs.mkdirSync(OUT, { recursive: true })

let pass = 0, fail = 0
const ok = (c, name, ev) => {
  if (c) { pass++; console.log('  ✅ ' + name + (ev !== undefined ? '　→ ' + ev : '')) }
  else { fail++; console.log('  ❌ ' + name + (ev !== undefined ? '　→ ' + ev : '')) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/* ---------- 生产真值（照抄 `tenant_1.db::role_permissions`，v347 迁移落库后实测） ---------- */
// 🔴 主管**没有 `data`**（老板 09-30 撤掉了）、**没有 `cron`**（v347 撤的）、有 `bid`/`forecast`。
//    这份清单必须与库里一致 —— 桩值与真值不一致时，证的是机制、不是存在（v345 的教训）。
const SV = ['dashboard', 'sales', 'stock', 'bid', 'messages', 'forecast', 'forecast-audit']
const KU = ['dashboard', 'stock', 'data', 'messages']   // 库管：持 data、**无 forecast**
const BOSS = ['dashboard', 'data', 'sales', 'buying', 'stock', 'accounts', 'crm', 'hr', 'payroll',
  'projects', 'goals', 'reports', 'chat', 'tasks', 'cron', 'bid', 'messages', 'forecast', 'forecast-audit']
const CR_T1 = ['supervisor', '库管']   // 生产 custom_roles 实测值

console.log('生产真值（照抄 role_permissions，不凭想象）：')
console.log('  主管 supervisor = ' + JSON.stringify(SV))
console.log('  库管          = ' + JSON.stringify(KU))
console.log('  老板 boss     = ' + JSON.stringify(BOSS.slice(0, 8)) + ' …')
console.log('  custom_roles  = ' + JSON.stringify(CR_T1))

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

/* ---- 记账①：全程非 GET 请求 ---- */
const writes = []
page.on('request', (r) => {
  if (r.method() === 'GET') return
  if (/\/api\/auth\/login(\?|$)/.test(r.url())) { writes.push('login(探针自身)'); return }
  if (/\/api\/auth\/logout(\?|$)/.test(r.url())) { writes.push('logout(探针自身)'); return }
  writes.push(r.method() + ' ' + r.url())
})

/* ---- 记账②：权限正文 + 调用次数（自证刺激落地） ---- */
const permBodies = []
let permCallCount = 0
const bad4xx = []
page.on('response', async (res) => {
  const u = res.url()
  if (res.status() >= 400 && /\/api\//.test(u)) bad4xx.push(res.status() + ' ' + u.replace(BASE, ''))
  if (!/\/api\/auth\/permissions(\?|$)/.test(u)) return
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

let navSeq = 0
const loadRoute = async (h) => {
  navSeq++
  await page.goto(BASE + '/?v=' + TAG + '-' + navSeq + '#' + h, { waitUntil: 'networkidle' })
  await sleep(1800)
}
const sbCount = () => page.locator('.sb-nav .sb-item').count()
const sbHas = async (name) => (await page.locator('.sb-nav .sb-item', { hasText: name }).count()) > 0
const sbNames = async () => page.locator('.sb-nav .sb-item').allInnerTexts()
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
const hashNow = () => page.url().replace(/^[^#]*#?/, '')
const shot = async (tag) => { try { await page.screenshot({ path: OUT + '/' + TAG + '-' + tag + '.png', fullPage: false }) } catch (_) {} }

/* ============================ ① 基线 ============================ */
console.log('\n① 基线（不改写 —— 先证登录态与页面本身是活的）')
await loadRoute('/workbench')
const alive = await appAlive()
ok(alive.nav === 1 && alive.items > 0 && !alive.err, '侧栏正常渲染（非错误卡片）', 'nav=' + alive.nav + ' items=' + alive.items)
ok(permCallCount >= 1, '/api/auth/permissions 被调用（判据真的跑过）', permCallCount + ' 次')
const lp0 = lastPerms()
ok(lp0 && Array.isArray(lp0.list), '基线权限正文可读（自证桩未生效）', JSON.stringify(lp0))
console.log('  基线侧栏: ' + (await sbNames()).join(' | '))
await shot('00-baseline')

/* ============ ② 主管（真值）：招投标雷达要看得见、定时任务看不见 ============ */
console.log('\n② 主管真值（无 data、无 cron、有 bid + forecast）')
STUB = { role: 'supervisor', permissions: SV, customRoles: CR_T1 }
await loadRoute('/workbench')
const lp2 = lastPerms()
ok(lp2 && JSON.stringify(lp2.list) === JSON.stringify(SV), '自证：页面收到的模块清单 = 主管真值', JSON.stringify(lp2 && lp2.list))
ok(lp2 && lp2.role === 'supervisor', '自证：身份已改写为 supervisor', lp2 && lp2.role)
const alive2 = await appAlive()
ok(alive2.nav === 1 && alive2.items > 0, '侧栏仍在渲染（不是整页崩了）', 'items=' + alive2.items)
console.log('  主管侧栏: ' + (await sbNames()).join(' | '))
ok((await sbHas('招投标雷达')) === true, '🔴 目标②：「招投标雷达」**看得见**（老板要求）', String(await sbHas('招投标雷达')))
ok((await sbHas('预报订货管理')) === true, '主管仍看得见「预报订货管理」（他在 FORECAST_SUMMARY_ROLES）', String(await sbHas('预报订货管理')))
ok((await sbHas('定时任务')) === false, '🔴 目标①：「定时任务」**看不见**（郝洋报障）', String(await sbHas('定时任务')))
ok((await sbHas('货损核算')) === true, '对照：同页「货损核算」仍在（stock 在 ⇒ 不是把菜单全藏了）', String(await sbHas('货损核算')))
await shot('01-supervisor')

/* 深链：主管敲 #/cron ⇒ 必须被拦（不该落在定时任务页） */
await loadRoute('/cron')
ok(!/\/cron/.test(hashNow()), '🔴 深链：主管敲 `#/cron` 被拦回（hash 不再是 /cron）', 'hash=' + (hashNow() || '(空)'))
await shot('02-supervisor-deeplink-cron')

/* ============ ③ 库管（真值）：预报订货管理看不见 ============ */
console.log('\n③ 库管真值（持 data、**无 forecast**、无 bid/cron）')
STUB = { role: '库管', permissions: KU, customRoles: CR_T1 }
await loadRoute('/workbench')
const lp3 = lastPerms()
ok(lp3 && JSON.stringify(lp3.list) === JSON.stringify(KU), '自证：页面收到的模块清单 = 库管真值', JSON.stringify(lp3 && lp3.list))
ok(lp3 && lp3.role === '库管', '自证：身份已改写为「库管」', lp3 && lp3.role)
const alive3 = await appAlive()
ok(alive3.nav === 1 && alive3.items > 0, '侧栏仍在渲染（不是整页崩了）', 'items=' + alive3.items)
console.log('  库管侧栏: ' + (await sbNames()).join(' | '))
ok((await sbHas('预报订货管理')) === false, '🔴 目标③：库管**看不见**「预报订货管理」（v347 拆模块）', String(await sbHas('预报订货管理')))
ok((await sbHas('档案管理')) === true, '对照：库管仍看得见「档案管理」（他持 data ⇒ 不是把他封死了）', String(await sbHas('档案管理')))
ok((await sbHas('定时任务')) === false, '库管也看不见「定时任务」', String(await sbHas('定时任务')))
await shot('03-库管')

/* 深链：库管敲 #/forecast
   🔴 **预期能进容器** —— 这不是漏洞，是两道刻意的设计叠加：
     ① 守卫（`router/index.js::beforeEach`）调 `pageRoleAllowed`，而它**只判角色轴**
        （`roleGateOpen`），**不判 module 轴**。v291 的取舍：在守卫里按模块拦，会把
        "接口抖一下"放大成"整页打不开"。
     ② 库管在本租户的 `custom_roles` 里 ⇒ `roleGateOpen` 第 ③ 档**让位** ⇒ 放行。
        （对比 v345 的 `/cron`：它加了 `lock` ⇒ 不让位 ⇒ 角色轴判 ⇒ 拦得住。）
   ✅ 而真正管住它的是**数据层**：v347 把 `/api/forecast/*` 拆到 `forecast` 模块，
      库管不持有 ⇒ 页内每个请求都 403 ⇒ 进去也是空页 + 明确报"没有预报订货的使用权限"。
   ⚠️ 所以下面断言的是「能进 + 数据全 403」，**不是**「深链被拦」—— 后者是产品刻意不做的事。 */
const badBefore = bad4xx.length
await loadRoute('/forecast')
console.log('  深链 hash: ' + (hashNow() || '(空)'))
ok(/\/forecast/.test(hashNow()), '深链能进容器（守卫按"让位"放行 —— 与"入口消失"不矛盾）', 'hash=' + hashNow())
await sleep(1200)
const fcDenied = bad4xx.slice(badBefore).filter((x) => /403 .*\/api\/forecast(\/|\?|$)/.test(x))
ok(fcDenied.length > 0,
  '🔴 但页内 `/api/forecast/*` 请求 **403**（数据层已关 ⇒ 真进去也是空页）',
  fcDenied.slice(0, 3).join(' ｜ ') || '（零 403 ⇒ 数据层没关住，这才是真缺陷）')
const kuBodyText = await page.locator('body').innerText()
/* ⚠️ v347 首跑这一条曾用「正文里有没有『权限不足』字样」判 —— **判据本身是错的**：
   本页的拒绝态不是后端那句 403 文案，而是一条**页内常驻横幅**（`.gate-bar`，由
   `Forecast.vue::forecastDenied` 驱动，文案是业务口径，不出现状态码）。
   按"字样"判会把一条**已经正确实现**的说明判成失败（首跑实测：页面确实渲染了横幅，
   我却在正则里找后端那句不存在的文案）。改为**按元素判**：横幅在不在、里面有没有点名模块。 */
const deniedBar = page.locator('.gate-bar', { hasText: '预报订货管理' })
const deniedN = await deniedBar.count()
ok(deniedN > 0,
  '🔴 页面上给出了「你的角色没有「预报订货管理」的权限」的**常驻**说明（不是白屏、不是假数据）',
  deniedN > 0
    ? (await deniedBar.first().innerText()).replace(/\s+/g, ' ').slice(0, 130)
    : ('实得 0 条 —— 页面是无说明的空壳；正文首段: ' + kuBodyText.replace(/\s+/g, ' ').slice(0, 110)))
/* 反向自查：既然期次接口 403 了，页面上就**不该有**任何真实期次 ——
   否则说明"权限被拒"与"渲染了数据"同时成立，那才是真缺陷（假数据比白屏更坏）。 */
const periodOpts = await page.locator('.sel-period option').count()
ok(periodOpts <= 1, '同一页没有渲染出任何期次（只剩「— 选择期次 —」占位 ⇒ 不存在"看起来有数据"）',
  periodOpts + ' 个 option')
await shot('04-库管-deeplink-forecast')

/* ============ ④ 单变量对照：把 forecast 还给库管 ⇒ 必须重新出现 ============ */
console.log('\n④ 单变量对照：库管 + 只**多给 forecast 一个模块**')
STUB = { role: '库管', permissions: ['dashboard', 'stock', 'data', 'messages', 'forecast'], customRoles: CR_T1 }
await loadRoute('/workbench')
ok((await sbHas('预报订货管理')) === true,
  '🔴 单变量对照：「预报订货管理」**重新出现**（⇒ 翻转来自 module 轴，不是"库管被无条件封死"）',
  String(await sbHas('预报订货管理')))
await shot('05-库管-给forecast')

/* ============ ⑤ 防误伤：老板必须三样全看得见 ============ */
console.log('\n⑤ 防误伤：老板真值')
STUB = { role: 'boss', permissions: BOSS, customRoles: CR_T1 }
await loadRoute('/workbench')
console.log('  老板侧栏: ' + (await sbNames()).join(' | '))
ok((await sbHas('预报订货管理')) === true, '老板仍看得见「预报订货管理」', String(await sbHas('预报订货管理')))
ok((await sbHas('定时任务')) === true, '老板仍看得见「定时任务」（他自己的）', String(await sbHas('定时任务')))
ok((await sbHas('招投标雷达')) === true, '老板仍看得见「招投标雷达」', String(await sbHas('招投标雷达')))
await shot('06-boss')

/* ============ ⑥ 自证收尾 ============ */
console.log('\n⑥ 只读自证')
ok(writes.every((w) => /^login|^logout/.test(w)), '全程非 GET 请求只有登录/注销（零业务写入）', JSON.stringify(writes))
const badFiltered = bad4xx.filter((x) => !/401|403/.test(x))
ok(badFiltered.length === 0, '无 4xx/5xx 异常请求（401/403 属探针预期的权限拒绝）', badFiltered.slice(0, 5).join(' | ') || '（无）')
ok(pageErrors.length === 0, '零 console/page error', pageErrors.slice(0, 3).join(' | ') || '（无）')

await page.evaluate(async () => {
  const t = localStorage.getItem('hergent_v2_token')
  if (t) await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: '{}' })
})
await browser.close()

console.log('\n==================================================')
console.log('总判定: ' + (fail === 0 ? '✅ 全绿' : '❌ 有失败项') + '（' + pass + ' 通过 / ' + fail + ' 失败）')
console.log('截图目录: ' + OUT)
process.exit(fail ? 1 : 0)
