/**
 * v299-cron-bridge-browser-probe.mjs —— 定时任务修复的**真机浏览器栈**验收（生产 hergent.cn）
 *
 * 为什么要单独跑浏览器这一层（python/urllib 已验过接口）：
 *   浏览器栈会额外经过 CORS、鉴权头拼接、`fetch` 封装、以及真实构建产物 ——
 *   这些是 urllib 验不到的（历史上出现过"脚本通、浏览器 401"的形态）。
 *
 * 断言设计（正反两侧都要）：
 *   ① 登录 hergent.cn 正常 ⇒ 重启后站点健康（服务重启是本轮修复的一部分）
 *   ② 带 token GET /api/cron/jobs ⇒ 200 + ok:true + jobs.length===1
 *      🔴 关键：断言正文**不含** `Traceback` —— 这正是修复前的故障形态（200 但正文是 traceback）
 *   ③ 不带 token 同 URL ⇒ 401（闸门仍在，没有被修复顺手放宽）
 *   ④ 全程零 pageerror（沙箱改动没有连累前端）
 *
 * ⚠️ 诚实边界：本轮**未**做「定时任务」页的 UI 渲染截图验证 ——
 *    该页 `roles = ['admin','boss']`，而提审账号 mptest 是 sales，无权限进入；老板账号凭据不在探针手上。
 *    前端本轮**零改动**，渲染路径为 `jobs = (r && r.jobs) || []`（接口已返回 1 条）。
 * 零写入：全程只有 GET + 一次 login POST。
 */
import { chromium } from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/playwright/index.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptest'
const PASS = process.env.HG_PASS || 'Mptest@1'
let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  ✅ ' + n + (e !== undefined ? '　→ ' + e : '')) } else { fail++; console.log('  ❌ ' + n + (e !== undefined ? '　→ ' + e : '')) } }

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

/* 零写入自证：除探针自己发的 login 外，不允许任何非 GET */
const writes = []
page.on('request', (r) => {
  if (r.method() === 'GET') return
  if (/\/api\/auth\/login(\?|$)/.test(r.url())) return
  writes.push(r.method() + ' ' + r.url())
})

console.log('== ① 打开站点 ==')
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 })
ok(true, '页面已加载', await page.title())

console.log('== ② 登录（真账号）==')
const login = await page.evaluate(async ({ u, p }) => {
  const r = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  })
  return { status: r.status, body: await r.text() }
}, { u: USER, p: PASS })
ok(login.status === 200, '登录 HTTP=200', login.status)
let token = ''
try { token = JSON.parse(login.body).token || '' } catch (_) {}
ok(!!token, '拿到 token', token ? token.slice(0, 10) + '…' : '(空)')

console.log('== ③ 带 token GET /api/cron/jobs ==')
const withTok = await page.evaluate(async (t) => {
  const r = await fetch('/api/cron/jobs', { headers: { Authorization: 'Bearer ' + t } })
  return { status: r.status, body: await r.text() }
}, token)
ok(withTok.status === 200, 'HTTP=200（修复前也是 200 —— 所以这一条**单独不足以**证明修好）', withTok.status)
ok(!/Traceback/.test(withTok.body), '正文**不含** Traceback（修复前的故障形态已消失）')
let jobs = null
try { jobs = JSON.parse(withTok.body) } catch (_) {}
ok(!!jobs && jobs.ok === true, '正文 ok === true（修复前是 ok:false + error 里塞 traceback）')
ok(Array.isArray(jobs && jobs.jobs), '有 jobs 数组')
ok(!!jobs && jobs.jobs.length === 1, 'jobs.length === 1（与 SSH 直跑 / 探针 B 的真值一致）', jobs && jobs.jobs.map(j => j.name).join(','))
ok(!!jobs && jobs.jobs[0] && jobs.jobs[0].id === '853f2e208ae2', '任务 id 与权威数据一致', jobs && jobs.jobs[0] && jobs.jobs[0].id)

console.log('== ④ 反例：不带 token ⇒ 必须 401（闸门没被放宽）==')
const noTok = await page.evaluate(async () => {
  const r = await fetch('/api/cron/jobs')
  return { status: r.status, body: (await r.text()).slice(0, 120) }
})
ok(noTok.status === 401, '未认证 ⇒ HTTP=401', noTok.status)

console.log('== ⑤ 零写入 / 零 pageerror ==')
ok(writes.length === 0, '全程非 GET 请求数 = 0', writes.length ? writes.join(' | ') : '0')
ok(pageErrors.length === 0, '全程 pageerror = 0', pageErrors.length ? pageErrors[0] : '0')

await browser.close()
console.log('\n' + (fail ? '❌' : '✅') + `  ${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
