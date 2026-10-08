/**
 * v335-button-gate-e2e.mjs —— 「页内按钮级门禁」真机验收（生产 hergent.cn）
 *
 * 为什么必须做这个探针（否则本轮等于没验）：
 *   生产 `/api/auth/permissions` 实测下发的是
 *   `{"dashboard":["read","create","update","delete"], … "data":[四个全动作] …}`
 *   —— 库库存的是**旧格式 list**，后端 `normalize_perms_shape` 把它展开成「全动作」。
 *   于是 `canDo()` **每个模块都返回 true** ⇒ 门禁今天**不隐藏任何按钮**。
 *   ⇒ 「零回归」与「门禁有效」会互相掩盖：页面一切正常，既可能是「门禁正确放行」，
 *     也可能是「门禁压根没生效」。**必须把后者的可能性排掉。**
 *
 * 做法：Playwright **响应改写** —— 只改交给前端的那份 JSON，把某些模块的动作收窄成只读，
 *   断言按钮真的消失。**不改生产数据**（见文末「零写入」一节的口径与取证）。
 *
 * 三组对照（缺一不可）：
 *   ① 基线（不改写）      ：按钮**在**        —— 证明门禁不过敏
 *   ② 收窄 `data`⇒read    ：`/data-fill` 的写按钮**消失**，`/rebate` 的**仍在**
 *                            —— 同时证明「门禁按**接口模块**判，不按**页面模块**判」
 *                               （`/data-fill` 页面模块 `stock`，页内写接口归 `data`）
 *   ③ 再收窄 `sales`⇒read ：`/rebate` 的写按钮**消失**
 *
 * 🔴 探针自身的两条纪律（本轮踩过）：
 *   a) **必须强制整页重载到指定路由**：先用 `page.reload()` 是错的 —— 它留在**上一次**的
 *      hash 上，于是"按钮消失"是"页面不对"造成的**假阳性**（第一版就栽在这，把好产品报成坏产品）。
 *      这里用 `?v=N#/hash`（查询串变化 ⇒ 必然整文档重载，hash 再定路由）。
 *   b) **每阶段自证刺激真的落地**：断言页面**实际收到**的 `permissions_detail` 形态（数字写死）。
 */
import { chromium } from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/playwright/index.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptest'
const PASS = process.env.HG_PASS || 'Mptest@1'

let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  ✅ ' + n + (e !== undefined ? '　→ ' + e : '')) } else { fail++; console.log('  ❌ ' + n + (e !== undefined ? '　→ ' + e : '')) } }
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
  if (/\/api\/auth\/login(\?|$)/.test(r.url())) return   // 探针自己发的登录 POST
  writes.push(r.method() + ' ' + r.url())
})
/* ---- 记账②：页面**实际收到**的 permissions 正文（自证刺激落地） ---- */
const permBodies = []
page.on('response', async (res) => {
  if (!/\/api\/auth\/permissions(\?|$)/.test(res.url())) return
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
  if (!d.token) return 'NO:' + JSON.stringify(d).slice(0, 120)
  localStorage.setItem('hergent_v2_token', d.token)
  if (d.csrf_token) localStorage.setItem('hergent_v2_csrf', d.csrf_token)
  if (d.user) localStorage.setItem('hergent_v2_user', JSON.stringify(d.user))
  if (d.tenant_id) localStorage.setItem('hergent_v2_tenant', String(d.tenant_id))
  return 'OK:' + (d.user && d.user.role) + ':' + d.tenant_id
}, [USER, PASS])
ok(String(loginRes).startsWith('OK:'), '真账号登录（' + USER + '）', loginRes)
if (!String(loginRes).startsWith('OK:')) { await browser.close(); process.exit(1) }

/* ---- 响应改写装置 ---- */
let NARROW = null          // null = 不改写（基线）
await ctx.route('**/api/auth/permissions*', async (route) => {
  const res = await route.fetch()
  const body = await res.json()
  if (NARROW) {
    const pd = (body.permissions_detail && typeof body.permissions_detail === 'object') ? body.permissions_detail : {}
    for (const k of Object.keys(NARROW)) if (k in pd) pd[k] = NARROW[k]
    body.permissions_detail = pd
  }
  await route.fulfill({ response: res, body: JSON.stringify(body) })
})

/* ---- 强制整页重载到指定 hash 路由（见文首 🔴a） ---- */
let navSeq = 100
const loadRoute = async (h) => {
  navSeq++
  await page.goto(BASE + '/?v=' + navSeq + '#' + h, { waitUntil: 'networkidle' })
  await sleep(1800)
}
const switchMainTab = async (label) => {
  await page.click('.main-tab:has-text("' + label + '")')
  await sleep(1200)
}

/* DOM 探针（选择器取自源码原文，不凭印象） */
const q = {
  dfFile:     () => page.locator('.df-file-btn').count(),                        // DataFill.vue 门禁：v-if canDo('data','create')
  dfTemplate: () => page.locator('button:has-text("下载模板")').count(),          // 未门禁 ⇒ 白屏对照组
  dfHeading:  () => page.locator('h2:has-text("库存效期补录")').count(),
  rbCreateB:  () => page.locator('button:has-text("创建品牌目标")').count(),       // Rebate.vue 门禁：v-if canDo('sales','create')
  rbCreateP:  () => page.locator('button:has-text("创建商品目标")').count(),
  rbCalc:     () => page.locator('.tb-right button:has-text("试算")').count(),    // 未门禁 ⇒ 白屏对照组
  rbCardH3:   () => page.locator('h3:has-text("品牌目标")').count(),
  sidebar:    () => page.locator('.sb-item').count(),
}
const lastPD = () => {
  const b = permBodies[permBodies.length - 1]
  return (b && b.permissions_detail && typeof b.permissions_detail === 'object') ? b.permissions_detail : {}
}
const ALL4 = '["read","create","update","delete"]'

/* ============================ ① 基线 ============================ */
console.log('\n① 基线（不改写 —— 门禁不该过敏）')
await loadRoute('/data-fill')
ok(await q.dfHeading() === 1, '/data-fill 正常渲染（h2 库存效期补录）', await q.dfHeading())
ok(await q.dfFile() === 1, '「选择文件」按钮**在**（data/create 已授权）', await q.dfFile())
const pdb = lastPD()
ok(Array.isArray(pdb.data) && pdb.data.length === 4, '自证：基线 data = 4 个动作（刺激未生效）', JSON.stringify(pdb.data))

await loadRoute('/rebate')
await switchMainTab('目标与返利')
ok(await q.rbCardH3() === 1, '/rebate 目标与返利 tab 正常渲染（h3 品牌目标）', await q.rbCardH3())
ok(await q.rbCreateB() === 1 && await q.rbCreateP() === 1, '两个入口按钮**都在**（sales/create 已授权）',
   await q.rbCreateB() + ' + ' + await q.rbCreateP())
const sbBase = await q.sidebar()
console.log('  基线侧栏条目数：' + sbBase)
ok(JSON.stringify(lastPD().sales) === ALL4, '自证：基线 sales = 4 个动作', JSON.stringify(lastPD().sales))

/* ==================== ② 收窄 data ⇒ read（只读） ==================== */
console.log('\n② 收窄 data ⇒ ["read"]（改写响应）')
NARROW = { data: ['read'] }
await loadRoute('/data-fill')
const pda = lastPD()
ok(JSON.stringify(pda.data) === '["read"]', '自证：页面**实际收到**的 data 只剩 read', JSON.stringify(pda.data))
ok(JSON.stringify(pda.sales) === ALL4, '自证：sales 未被牵连', JSON.stringify(pda.sales))
ok(await q.dfHeading() === 1 && await q.dfTemplate() >= 1,
   '页面未白屏（标题在 + 未门禁的「下载模板」按钮在）', await q.dfHeading() + ' / ' + await q.dfTemplate())
ok(await q.dfFile() === 0, '★ `data/create` 被收窄 ⇒「选择文件」按钮**消失**', await q.dfFile())
ok(await q.sidebar() === sbBase, '入口未被误藏（本页页面模块是 stock，不在 data 轴上）', await q.sidebar() + ' == ' + sbBase)

await loadRoute('/rebate')
await switchMainTab('目标与返利')
ok(await q.rbCreateB() === 1 && await q.rbCreateP() === 1,
   '★ 对照组：`sales` 未收窄 ⇒ /rebate 两个按钮**仍在**（跨模块不塌陷）',
   await q.rbCreateB() + ' + ' + await q.rbCreateP())

/* ==================== ③ 再收窄 sales ⇒ read ==================== */
console.log('\n③ 再收窄 sales ⇒ ["read"]')
NARROW = { data: ['read'], sales: ['read'] }
await loadRoute('/rebate')
await switchMainTab('目标与返利')
ok(JSON.stringify(lastPD().sales) === '["read"]', '自证：页面**实际收到**的 sales 只剩 read', JSON.stringify(lastPD().sales))
ok(await q.rbCardH3() === 1 && await q.rbCalc() >= 1,
   '/rebate 未白屏（入口卡片标题在 + 未门禁的「试算」按钮在）', await q.rbCardH3() + ' / ' + await q.rbCalc())
ok(await q.rbCreateB() === 0 && await q.rbCreateP() === 0,
   '★ `sales/create` 被收窄 ⇒ 两个入口按钮**都消失**', await q.rbCreateB() + ' + ' + await q.rbCreateP())

/* ============================ 零写入 ============================ */
console.log('\n零写入自证（从脚本第一行起就已在记）')
/* 口径（必须说清，否则这条断言是假的）：
   探针自己**从不发非 GET**；唯一出现的非 GET 来自**被测页面自身**的
   `POST /api/rebate-rules/simulate-batch` —— 后端 `routers/rebate_rules.py:2059` 是
   **批量返利试算**（文档原文：「把返利算法唯一留在后端」；同族 `/simulate` 注明「What-if 用，不落库」）
   ⇒ 纯计算、零落库。故判据 = 「非 GET 的**去重集合** ⊆ {simulate-batch}」，而不是"一条都没有"。 */
const PAGE_READONLY_POST = '/api/rebate-rules/simulate-batch'
/* 归一成**路径**再比 —— 否则 `https://host/path` 与 `/path` 永不相等，
   判据会恒报失败（第一版就栽在这：看起来像"有越权写入"，其实是探针自己比错了）。 */
const distinct = [...new Set(writes.map(w => {
  const u = w.split(' ')[1]
  try { return new URL(u).pathname } catch (_) { return u.split('?')[0] }
}))]
const offList = distinct.filter(u => u !== PAGE_READONLY_POST)
console.log('  页面自身发出的只读 POST：' + writes.filter(w => w.includes(PAGE_READONLY_POST)).length + ' 次 ' + PAGE_READONLY_POST)
console.log('  非 GET 去重集合：' + JSON.stringify(distinct))
ok(offList.length === 0, '除页面自身的只读试算 POST 外，**没有任何**非 GET 请求',
   offList.length ? JSON.stringify(offList) : '0 个')

console.log('\n' + '='.repeat(64))
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败')
await browser.close()
process.exit(fail ? 1 : 0)
