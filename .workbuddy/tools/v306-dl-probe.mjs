/* v306 真机探针：**用户真实点击文件卡**这条链路能不能下载成功。
   🔴 为什么必须单独写一个：v306-ui-probe 的「真实下载」那一步是
      `page.evaluate(fetch(url, { Authorization }))` —— 那是**我在页面里手动带头**，
      和用户点链接完全是两码事。生产实测正是这个差别造成了「无法从网站上提取文件」的故障。
      ⇒ 本探针只做一件事：**点那张卡**，看 Chrome 的下载事件是成功还是失败，
        以及这一次请求到底带没带鉴权头、响应是什么状态码。

   用法：
     cd hergent-cn-v2 && node_modules/.bin/vite --port 5199 --strictPort   （另开；打生产则不需要）
     PROBE_BASE=https://hergent.cn PROBE_EXPECT=bug MP_USER=mptest MP_PASS=... node <本文件>

     PROBE_EXPECT=bug    ⇒ 断言「下载失败 + 401 + 请求不带 Authorization」（打修复前的端）
     PROBE_EXPECT=fixed  ⇒ 断言「下载成功 + 200 + 请求带 Authorization」（默认）
*/
import { createRequire } from 'node:module'
import fs from 'node:fs'

const PROJ = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2'
const require = createRequire(PROJ + '/package.json')
const { chromium } = require('playwright')

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:5199'
const USER = process.env.MP_USER || 'mptest'
const PASS = process.env.MP_PASS || ''
const EXPECT = process.env.PROBE_EXPECT || 'fixed'
if (!PASS) { console.error('[中止] 缺 MP_PASS'); process.exit(2) }

const SRC = '/tmp/v301-msg530.json'
if (!fs.existsSync(SRC)) { console.error('[中止] 缺生产原文样本 ' + SRC); process.exit(2) }
const REAL = JSON.parse(fs.readFileSync(SRC, 'utf8')).content

const SID = 'v306-dl-probe'
const TITLE = 'v306 探针 · 文件卡下载'
let fail = 0
const chk = (ok, msg) => { if (!ok) fail++; console.log('  ' + (ok ? '✅' : '❌') + '  ' + msg) }

const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({ headless: true, executablePath: CHROME })
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,        // 关键：必须显式开，否则下载事件不会被捕获
})
const page = await ctx.newPage()

const hits = []
const reqs = []
const errs = []

/* 记下这一次请求的真实面貌：有没有 Authorization 头、响应几几几。
   ⚠️ 必须挂在 **context** 级（并跟踪新开的页面）：修复前那张卡带 target="_blank"，
      点击后请求发生在**新页面**里，只监听原 page 会看到一个空数组（实测踩过）。 */
function attach(target) {
  target.on('response', (r) => {
    const u = r.url()
    if (u.includes('/api/ai/media') || u.includes('chat-attachment/download')) {
      hits.push({ status: r.status(), url: u.slice(0, 96) })
    }
  })
  target.on('request', (r) => {
    if (r.url().includes('/api/ai/media')) {
      const h = r.headers()
      reqs.push({ hasAuth: !!h['authorization'], hdrKeys: Object.keys(h).filter((k) => /auth|tenant|ck-|cookie/i.test(k)) })
    }
  })
  target.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
}
attach(ctx)
ctx.on('page', (p) => attach(p))
attach(page)

console.log('① 打开 ' + BASE + '（期望：' + EXPECT + '）')
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(1200)
if (await page.locator('input[placeholder="用户名"]').count()) {
  console.log('   登录页 → 用 ' + USER + ' 登录')
  await page.fill('input[placeholder="用户名"]', USER)
  await page.fill('input[placeholder="密码"]', PASS)
  await page.click('button.btn-primary.btn-block')
  await page.waitForTimeout(3500)
}
chk(!(await page.locator('input[placeholder="用户名"]').count()), '登录成功')

console.log('\n② 种入含文件卡的会话（生产库真实原文）')
await page.evaluate(({ sid, title, real }) => {
  localStorage.setItem('hergent_chat_sessions_v1', JSON.stringify([{
    id: sid, title, updated_at: Date.now(),
    messages: [
      { role: 'user', content: '（探针）两份稿子再发我一次' },
      { role: 'assistant', content: real },
    ],
  }]))
}, { sid: SID, title: TITLE, real: REAL })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)

console.log('\n③ 打开副驾 → 历史会话 → 该会话')
await page.click('button.tb-copilot')
await page.waitForTimeout(700)
await page.click('button[title="历史会话"]')
await page.waitForTimeout(700)
const item = page.locator('.cp-hist-item', { hasText: 'v306 探针' }).first()
chk(await item.count() > 0, '找到探针会话')
await item.click()
await page.waitForTimeout(1200)

const card = page.locator('.msg-file').first()
chk(await card.count() > 0, '文件卡存在')
const name = await card.locator('.cp-art-file-name').innerText()
console.log('   卡片文件名：' + name)

console.log('\n④ **真实点击**这张卡（模拟老板的操作，不是我在页面里 fetch）')
const dlPromise = page.waitForEvent('download', { timeout: 25000 }).catch(() => null)
await card.click()
const dl = await dlPromise

let dlInfo = { got: false }
if (dl) {
  dlInfo.got = true
  dlInfo.suggested = dl.suggestedFilename()
  dlInfo.failure = await dl.failure()            // null = 成功
  try {
    const p = await dl.path()
    dlInfo.path = p
    dlInfo.size = p ? fs.statSync(p).size : 0
  } catch (e) { dlInfo.pathErr = String(e).slice(0, 90) }
}
await page.waitForTimeout(800)

console.log('\n⑤ 读数')
console.log('   下载事件：' + JSON.stringify(dlInfo))
console.log('   本次请求：' + JSON.stringify(reqs))
console.log('   端点响应：' + JSON.stringify(hits))
if (errs.length) console.log('   页面异常：' + errs.slice(0, 3).join(' | '))

const status = hits.length ? hits[0].status : 0
const sentAuth = reqs.length ? reqs[0].hasAuth : null

if (EXPECT === 'bug') {
  /* ⚠️ 为什么这里不用「捕获这次请求的头/状态码」当判据：导航型下载（浏览器下载管理器接管）
     不经过页面的 Network 域，CDP 根本不上报（实测 hits/reqs 空数组）。
     ⇒ 改成两段等价且可观测的证据：
        (a) 真实点击 → Chrome 下载失败（老板看到的那一条）
        (b) 用**裸链形态**（不带任何鉴权头）请求同一 URL → 401（解释为什么失败） */
  chk(!dl || dlInfo.failure, '反例：真实点击 → Chrome 下载**失败**（failure = ' + (dl ? dlInfo.failure : '未开始') + '）')
  const href = await card.getAttribute('href')
  const anon = await page.evaluate(async (u) => {
    // credentials:'omit' = 裸 <a href> 的请求形态：不带 Cookie、不带 Authorization
    const r = await fetch(u, { credentials: 'omit' })
    return { status: r.status, ct: (r.headers.get('content-type') || '').slice(0, 44) }
  }, href)
  chk(anon.status === 401, '反例机制：裸链形态请求同一 URL = ' + anon.status + ' / ' + anon.ct)
  console.log('   （参考：CDP 不上报导航型下载的请求，故本次捕获 = ' + JSON.stringify(hits) + '）')
  console.log('\n' + (fail ? '🔴 反例断言失败 ' + fail : '🟢 反例成立：修复前点击卡片必然下载失败（与老板截图一致）'))
} else {
  chk(status === 200, '端点回 200（实际 ' + status + '）—— 匿名请求同一 URL 是 401，故 200 即证明这次带了鉴权')
  console.log('   （参考：请求头 hasAuth = ' + sentAuth + '；CDP 对 fetch 的头上报不稳定，硬判据用状态码）')
  chk(!!dl, 'Chrome 捕获到下载事件')
  chk(dl ? dlInfo.failure === null : false, '下载未失败（failure = ' + dlInfo.failure + '）')
  chk(dlInfo.size === 45452, '落地文件字节 = ' + dlInfo.size + '（期望 45452）')
  chk(dlInfo.suggested === 'BP-想法梳理与开发计划-v1.docx', '落地文件名 = ' + dlInfo.suggested)
  console.log('\n' + (fail ? '🔴 失败 ' + fail + ' 项' : '🟢 真机下载链路全绿'))
}

await browser.close()
process.exit(fail ? 1 : 0)
