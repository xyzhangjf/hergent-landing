/**
 * v352 真机只读验证（生产）：主管(mptestsp, tenant_1) 补 `data` 之后，前端实际表现。
 *
 * 断三件事：
 *   ① 侧栏/抽屉出现「档案管理」入口（= 补 data 的**已知副作用**，必须让老板看见）
 *   ② 「预报订货管理」页**数据不再恒空**（补 data 前：入口在、数据 403、零报错）
 *   ③ 全程无 403（data 域接口）
 *
 * 🔴 只读：唯一出网写请求 = 探针自身的 POST /api/auth/login + 末尾 logout。
 * 用法：node .workbuddy/tools/v352-supervisor-data-e2e.mjs
 */
import { chromium } from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/playwright/index.mjs'
import fs from 'fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TAG = process.env.HG_TAG || 'v352-supervisor'
const USER = 'mptestsp'
const PASS = 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/' + TAG + '-2026-10-01'
fs.mkdirSync(OUT, { recursive: true })

let pass = 0, fail = 0
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log('  ✅ ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  [' + extra + ']' : '')) }
}

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

const writes = [], forbidden = [], dataHits = []
page.on('request', (r) => {
  const u = r.url()
  if (r.method() === 'GET') {
    if (u.includes('/api/')) dataHits.push(u.replace(BASE, '').split('?')[0])
    return
  }
  if (/\/api\/auth\/(login|logout)/.test(u)) { writes.push(r.method() + ' ' + u.replace(BASE, '')); return }
  writes.push('⚠️ 意外写请求 ' + r.method() + ' ' + u.replace(BASE, ''))
})
page.on('response', (r) => {
  if (r.status() === 403 && r.url().includes('/api/')) forbidden.push(r.url().replace(BASE, '').split('?')[0])
})

const shot = async (t) => { try { await page.screenshot({ path: OUT + '/' + TAG + '-' + t + '.png', fullPage: false }) } catch (_) {} }

/* ---------- 登录 ---------- */
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
console.log('\nA. 登录')
ok(String(loginRes).startsWith('OK:'), '真账号登录 ' + USER, loginRes)
if (!String(loginRes).startsWith('OK:')) { await browser.close(); process.exit(1) }

/* ---------- B. 后端权限真值 ---------- */
console.log('\nB. 后端权限真值（补 data 后）')
const perms = await page.evaluate(async () => {
  const tk = localStorage.getItem('hergent_v2_token')
  const r = await fetch('/api/auth/permissions', { headers: { Authorization: 'Bearer ' + tk, 'X-Client': 'web' } })
  return await r.json()
})
ok(Array.isArray(perms.permissions) && perms.permissions.includes('data'),
  '主管模块集含 data', JSON.stringify(perms.permissions))
ok(perms.permissions.includes('forecast') && perms.permissions.includes('sales'),
  '仍持有 预报订货管理 + 销售管理(目标与返利)')

/* ---------- C. 侧栏入口（含副作用） ---------- */
console.log('\nC. 侧栏入口（补 data 的已知副作用）')
await page.goto(BASE + '/#/workbench', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
const navText = await page.evaluate(() => document.body.innerText)
await shot('01-sidebar')
ok(navText.includes('预报订货管理'), '侧栏有「预报订货管理」')
ok(navText.includes('目标与返利'), '侧栏有「目标与返利」')
const hasArchive = navText.includes('档案管理')
console.log('     ↳ 副作用：补 data 后主管' + (hasArchive ? '【会】' : '【不会】') + '看到「档案管理」入口')
ok(hasArchive, '「档案管理」入口出现（= 需老板知情的连带效果）')

/* ---------- D. 预报订货管理页：数据是否不再恒空 ---------- */
console.log('\nD. 预报订货管理页（补 data 前：入口在、数据 403、零报错）')
forbidden.length = 0
await page.goto(BASE + '/#/forecast', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
const fcText = await page.evaluate(() => document.body.innerText)
await shot('02-forecast')
const fc403 = forbidden.slice()
console.log('     该页 403 接口:', fc403.length ? JSON.stringify(fc403) : '无')
ok(fc403.length === 0, '该页无 403（data 域已放行）')
const optCount = await page.evaluate(() => {
  const sel = document.querySelectorAll('select')
  for (const s of sel) { if (s.options && s.options.length > 1) return s.options.length }
  return 0
})
ok(optCount > 1, '期次/下拉有真实选项（不是只剩占位）', 'options=' + optCount)
ok(fcText.length > 300, '页面正文非空', 'len=' + fcText.length)

/* ---------- E. 目标与返利页 ---------- */
console.log('\nE. 目标与返利页')
forbidden.length = 0
await page.goto(BASE + '/#/rebate', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
const rbText = await page.evaluate(() => document.body.innerText)
await shot('03-rebate')
const rb403 = forbidden.slice()
console.log('     该页 403 接口:', rb403.length ? JSON.stringify(rb403) : '无')
ok(rbText.length > 300, '页面正文非空', 'len=' + rbText.length)

/* ---------- F. 只读自证 ----------
   🔴 白名单里那一条要说清：`/api/rebate-rules/simulate-batch` 是**纯试算、不落库**，
      而 `/rebate` 默认 tab（仪表盘）**一加载就会发它**，属**页面正常行为**、不是探针写入。
      ⚠️ 它目前**不在** `server._READ_ONLY_POST` 里（语义只读的 POST 被判成 `create`）——
      这是**本仓已知缺陷**（技能 §十七(7)，同族 `/rebate-contracts/simulate` 已登记、这条漏了）。
      这里放行是「**不把已知的假失败留成红灯**」，**不等于**认可该缺陷；修法必须单独一轮
      （`_READ_ONLY_POST` 另有 7 条语义只读 POST 待人工核定）。
      实证：本次实测它被调 4 次、全部 **200**（主管持 `sales` 全动作）——
      若哪天把 `sales` 收窄成只读，这页会**一打开就静默空白**。 */
console.log('\nF. 只读自证')
const READONLY_POST_RES = [/\/api\/rebate-rules\/simulate/]
const badWrites = writes.filter((w) =>
  !/^POST \/api\/auth\/(login|logout)$/.test(w) && !READONLY_POST_RES.some((re) => re.test(w)))
ok(badWrites.length === 0, '无意外写请求', 'bad=' + JSON.stringify(badWrites) + ' | all=' + JSON.stringify(writes))
ok(pageErrors.length === 0, '无 JS 报错', pageErrors.slice(0, 2).join(' | '))

console.log('\n' + '='.repeat(60))
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败')
console.log('截图: ' + OUT)
await page.evaluate(() => fetch('/api/auth/logout', {
  method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem('hergent_v2_token') },
}).catch(() => {}))
await browser.close()
process.exit(fail ? 1 : 0)
