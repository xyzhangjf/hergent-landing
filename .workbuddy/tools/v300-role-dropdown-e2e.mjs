/**
 * v300 员工档案「角色下拉动态值域」真机验收（打生产 hergent.cn）
 *
 * ── 为什么这样测才算数 ────────────────────────────────────────────
 * 1. 打**生产真站**、用**生产真构建产物**、走**真实路由**（hash 模式 `/#/archive/employees`）。
 * 2. 用**真账号** mptest（sales / tenant 1）登录 —— 拿真 token、真租户上下文。
 * 3. 🔴 **只 mock「车」，不 mock「被测对象」**：
 *    被测对象 = 角色下拉的**值域来源**（`GET /api/role-permissions`）。
 *    但 sales 对这页的两条数据都是 403（已实测：`/api/employees` 403、`/api/role-permissions` 403）
 *    ⇒ 表格空 ⇒ 「编辑」按钮根本不存在 ⇒ 弹窗打不开 ⇒ 什么都验不到。
 *    ⇒ 只把 `/api/employees` 换成**一行合成员工**（给弹窗当入口），
 *      **`/api/role-permissions` 一律放行到真后端**（反例 A）或显式 mock（正例 B）。
 *    本探针的结论因此限定为：**角色值域链路**是否真通，不覆盖员工列表本身。
 * 4. **双向对照**（只测"能选到自定义角色"是不够的）：
 *    · 反例 A（真实降级）：真后端对 sales 返回 **403** ⇒ 下拉**必须**仍是内置 8 项、
 *      且**不报错、不白屏**（= 改动前的行为，证明无回归）。
 *    · 正例 B（模拟 boss 视角）：回放**端点真实序列化产物**（不是手写 mock，见下方
 *      `PAYLOAD_FILE`）⇒ 下拉必须出现「库管（自定义角色 · …）」⇒ 证明**值域真的动态**。
 *    只做 B 不能证明"拉不到时不崩"；只做 A 不能证明"动态生效"。
 * 5. 判别串：
 *    · 「自定义角色」—— 本轮新增，旧构建 0 命中。
 *    · 「员工（仅小程序 · 」—— v300 新 label 形态（旧构建是写死的「员工（仅小程序）」无后缀）
 *      ⇒ 反例 A 里也必须命中，**证明线上跑的就是本轮构建**，而不是只证明"没坏"。
 * 6. **零写入**：全程监听非 GET 请求自证（只放行登录那一发 POST）。
 */
import { readFileSync } from 'node:fs'
import { chromium } from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/playwright/index.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptest'
// 🔴 凭据**不入库**：提审测试账号的密码一律从环境变量取，**不设默认值**。
//    权威源 = `.workbuddy/memory/` 当日日志（本仓私有）。
//    缺失即退出 —— 静默用一个"猜的密码"去登录生产，会把 401 伪装成"下拉坏了"。
const PASS = process.env.HG_PASS
if (!PASS) {
  console.error('[中止] 缺少 HG_PASS（提审测试账号 sales=mptest 的密码；见 .workbuddy/memory/ 当日日志）')
  process.exit(1)
}
const ARCHIVE = BASE + '/#/archive/employees'

let pass = 0, fail = 0
const ok = (c, n, e) => {
  if (c) { pass++; console.log('  ✅ ' + n + (e !== undefined ? '　→ ' + e : '')) }
  else { fail++; console.log('  ❌ ' + n + (e !== undefined ? '　→ ' + e : '')) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/* 合成员工行：字段与 `employeeApi.list` 真产出一致（含 salary_structure JSON 串），
   只用来让「编辑」按钮存在；弹窗里用到的字段都给全，避免 undefined 渲染异常。 */
const FAKE_EMP = {
  id: 900001,
  name: '探针-合成员工',
  employee_no: 'PROBE-1',
  position: '业务员',
  hire_date: '2026-01-01',
  salary_structure: JSON.stringify({ base_salary: 5000 }),
  is_active: 1,
  warehouse_id: 0,
  store_ids: [],
  has_account: true,
  account_user_id: 900001,
  account_username: 'probe-acct',
  account_role: 'sales',
  account_roles: '',
  account_active: true,
}

/* 🔴 正例 B 的 mock **不是手写的** —— 它读的是「后端端点原样序列化产物」落盘文件：
 *   `outputs/权限双链治理-2026-09-27/10-端点真实payload-tenant1.json`
 *   生成方式（只读）：
 *     scp .workbuddy/tools/v300-role-perms-payload-probe.py root@47.113.224.140:/tmp/
 *     ssh root@47.113.224.140 'runuser -u hergent -- /usr/bin/python3 /tmp/v300-role-perms-payload-probe.py'
 *   那份探针跑的就是 `server.py::get_role_perms` 第 1116-1122 行的组装逻辑。
 *   ⇒ 喂给前端的，就是**老板登录后真会收到的那份 JSON**，不是我编的。
 *   ⚠️ 若文件缺失**直接报错退出**：绝不允许回退成手写 mock（那就什么都没证明）。 */
const PAYLOAD_FILE = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/权限双链治理-2026-09-27/10-端点真实payload-tenant1.json'
let REAL_PAYLOAD
try {
  REAL_PAYLOAD = JSON.parse(readFileSync(PAYLOAD_FILE, 'utf8'))
} catch (e) {
  console.error('✗ 读不到真实 payload 文件：' + PAYLOAD_FILE)
  console.error('  先生成它（见文件头注释里的那两条命令）。缺失即中止 —— 手写 mock 不作数。')
  process.exit(2)
}
if (!REAL_PAYLOAD.roles || !REAL_PAYLOAD.roles['库管']) {
  console.error('✗ payload 里没有「库管」自定义角色 —— 前提不成立，中止。')
  process.exit(2)
}
console.log('')
console.log('mock 源 = 端点真实 payload（tenant_' + REAL_PAYLOAD.tenant_id + '，'
  + Object.keys(REAL_PAYLOAD.roles).length + ' 个角色，'
  + '自定义 = ' + JSON.stringify(Object.entries(REAL_PAYLOAD.roles)
    .filter(([, v]) => v.is_custom).map(([k]) => k)) + '）')

function login(page) {
  return page.evaluate(async ([u, p]) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p }),
    })
    const d = await r.json()
    if (!d.token) return 'NO:' + JSON.stringify(d).slice(0, 140)
    localStorage.setItem('hergent_v2_token', d.token)
    if (d.csrf_token) localStorage.setItem('hergent_v2_csrf', d.csrf_token)
    if (d.user) localStorage.setItem('hergent_v2_user', JSON.stringify(d.user))
    if (d.tenant_id) localStorage.setItem('hergent_v2_tenant', String(d.tenant_id))
    return 'OK:' + (d.user && d.user.role) + ':tid=' + d.tenant_id
  }, [USER, PASS])
}

/** 打开员工档案 → 点第一行「编辑」→ 读弹窗里角色下拉的 option 文本数组。 */
async function openEditAndReadOptions(page) {
  await page.goto(ARCHIVE, { waitUntil: 'networkidle' })
  const btn = page.locator('.df-ops button', { hasText: '编辑' }).first()
  await btn.waitFor({ timeout: 20000 })
  await btn.click()
  await page.waitForSelector('.df-modal .acc-role', { timeout: 15000 })
  await sleep(400)   // 等 Transition + roleCatalog 的 Promise 落地后的响应式重渲染
  return page.$$eval('.df-modal .acc-role option', els => els.map(e => e.textContent.trim()))
}

/** 统一装监听：非 GET 一律记下来（登录那发 POST 放行）。 */
function watchWrites(page) {
  const writes = []
  page.on('request', (r) => {
    if (r.method() === 'GET') return
    if (/\/api\/auth\/login(\?|$)/.test(r.url())) return
    writes.push(r.method() + ' ' + r.url().replace(BASE, ''))
  })
  return writes
}

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })

/* ══════════ 反例 A：真实现状（不拦 /api/role-permissions ⇒ sales 真 403） ══════════ */
console.log('')
console.log('【反例 A】真实降级路径（/api/role-permissions 放行到真后端 ⇒ 403）')
const pA = await ctx.newPage()
const errA = []
pA.on('pageerror', e => errA.push(e.message))
const rolePermA = []
pA.on('response', (res) => {
  if (/\/api\/role-permissions(\?|$)/.test(res.url())) rolePermA.push(res.status())
})
const writesA = watchWrites(pA)
/* 只 mock 员工列表（当"车"）；带 predicate 精确匹配，绝不误伤 /api/employees/active */
await pA.route((url) => url.pathname === '/api/employees', async (route) => {
  await route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([FAKE_EMP]),
  })
})

await pA.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
const lA = await login(pA)
ok(String(lA).startsWith('OK:'), '真账号登录', lA)

const optsA = await openEditAndReadOptions(pA)
console.log('    下拉 option：')
optsA.forEach((t, i) => console.log('      [' + i + '] ' + t))
ok(rolePermA.length >= 1, '确实请求了 /api/role-permissions（证明这是真路径）', '命中 ' + rolePermA.length + ' 次')
ok(rolePermA.length > 0 && rolePermA.every(s => s === 403),
  '该端点对 sales 返回 403（后端真值，非缺陷）', JSON.stringify(rolePermA))
ok(optsA.length === 8, '【降级】下拉 = 内置 8 项（与改动前一致 ⇒ 无回归）', '实得 ' + optsA.length)
ok(optsA.every(t => !/自定义角色/.test(t)), '【降级】不出现「自定义角色」条目')
ok(optsA.some(t => t.indexOf('员工（仅小程序 · ') === 0),
  '【构建在线上】出现 v300 新 label 形态「员工（仅小程序 · …）」',
  JSON.stringify(optsA.filter(t => /^员工/.test(t))))
ok(errA.length === 0, '【降级】零 pageerror', errA.join(' | ') || '无')
ok(writesA.length === 0, '【降级】零写入（全程无非 GET 请求）', writesA.join(' , ') || '无')
await pA.close()

/* ══════════ 正例 B：模拟「本租户有自定义角色」的视角 ⇒ 值域必须动态 ══════════ */
console.log('')
console.log('【正例 B】动态值域（mock /api/role-permissions，返回含「库管」的响应）')
const pB = await ctx.newPage()
const errB = []
pB.on('pageerror', e => errB.push(e.message))
const writesB = watchWrites(pB)
let mockServed = 0
await pB.route((url) => url.pathname === '/api/employees', async (route) => {
  await route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([FAKE_EMP]),
  })
})
await pB.route('**/api/role-permissions', async (route) => {
  mockServed++
  // 逐字回放端点真实产物（含 tenant_1 真有的 `supervisor` 被标 is_custom 这一细节）
  await route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(REAL_PAYLOAD),
  })
})

await pB.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
const lB = await login(pB)
ok(String(lB).startsWith('OK:'), '真账号登录（同一个 context）', lB)

const optsB = await openEditAndReadOptions(pB)
console.log('    下拉 option：')
optsB.forEach((t, i) => console.log('      [' + i + '] ' + t))
ok(mockServed >= 1, 'mock 真的被命中（否则本段什么都没证明）', '命中 ' + mockServed + ' 次')
ok(optsB.length === 9, '【动态】下拉 = 8 内置 + 1 自定义 = 9 项', '实得 ' + optsB.length)
ok(optsB.some(t => t.indexOf('库管（自定义角色') === 0),
  '【动态】出现「库管（自定义角色 · …）」', optsB.filter(t => /库管/.test(t)).join(' | '))
ok(optsB.indexOf(optsB.filter(t => /库管/.test(t))[0]) === 8,
  '【动态】自定义角色排在**内置之后**（第 9 位），不与内置混排')
ok(optsB.filter(t => /^管理员|^老板|^员工|^主管|^业务员|^导购|^司机|^会计/.test(t)).length === 8,
  '【动态】内置 8 项仍在（值域是"追加"而非"替换"）')
/* 🔴 这一条是读真实 payload 才想到的坑：tenant_1 里 `supervisor` 的 `is_custom` 也是 true，
   但它是**内置角色**。若前端用 `is_custom` 当「是不是自定义角色」的判据，
   内置主管会被**重复列一遍**（名字也重复）。实测数据正好带这个陷阱 ⇒ 必须断言没重复。 */
ok(optsB.filter(t => /^主管/.test(t)).length === 1,
  '【动态】内置「主管」只出现 1 次（真数据里它 is_custom=true ⇒ 证明判据用的是"名字是否内置"而非 is_custom）',
  '实得 ' + optsB.filter(t => /^主管/.test(t)).length + ' 次')
ok(errB.length === 0, '【动态】零 pageerror', errB.join(' | ') || '无')
ok(writesB.length === 0, '【动态】零写入（全程无非 GET 请求）', writesB.join(' , ') || '无')
await pB.close()

/* ══════════ 汇总 ══════════ */
await browser.close()
console.log('')
console.log('='.repeat(62))
console.log('通过 ' + pass + ' / 失败 ' + fail)
console.log('（结论范围：角色下拉的值域链路；不含员工列表本身）')
process.exit(fail ? 1 : 0)
