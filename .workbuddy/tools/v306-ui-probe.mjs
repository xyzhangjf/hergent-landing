/* v301 真机探针：在**真实浏览器 + 真实前端**里验证「副驾回复里的 MEDIA: 变成可下载文件卡」。
   非破坏性：只跑本地 dev server（/api 代理到生产后端），不改任何生产数据。
   payload 用**生产库导出的那条真实消息原文**（/tmp/v301-msg530.json），不是我手抄的。
   账号用提审测试号（sales 角色）—— 顺带证明「无 chat 权限的角色也能下载」。

   用法：
     cd hergent-cn-v2 && node_modules/.bin/vite --port 5199 --strictPort   （另开）
     MP_USER=mptest MP_PASS=... node .workbuddy/tools/v301-ui-probe.mjs
*/
import { createRequire } from 'node:module'
import fs from 'node:fs'

const PROJ = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2'
const require = createRequire(PROJ + '/package.json')
const { chromium } = require('playwright')

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:5199'
const USER = process.env.MP_USER || 'mptest'
const PASS = process.env.MP_PASS || ''
if (!PASS) { console.error('[中止] 缺 MP_PASS'); process.exit(2) }

const real = JSON.parse(fs.readFileSync('/tmp/v301-msg530.json', 'utf8'))
const REAL = real.content
const TEXT_ONLY = [
  '## 本次结论（纯文本回归件）',
  '',
  '| 项 | 值 |',
  '| --- | --- |',
  '| 报单 | 12 家 |',
  '',
  '- 第一点',
  '1. 第二点',
].join('\n')

const SID = 'v301-probe-session'
const TITLE = 'v301 探针 · MEDIA 文件卡'

let fail = 0
const chk = (ok, msg) => { if (!ok) fail++; console.log('  ' + (ok ? '✅' : '❌') + '  ' + msg) }

/* 🔴 本机 Playwright 只缓存了 chromium-1223，而装的 playwright 版本要 1234 ⇒ 直接复用
   系统已装的 Google Chrome（免下载、免代理，本机已有）。 */
const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({ headless: true, executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []
const failures = []
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
page.on('response', (r) => { if (r.status() >= 400) failures.push(r.status() + ' ' + r.url()) })
// PROBE_EXPECT=bug ⇒ 反例模式：断言「缺陷仍在」（打生产用）
const EXPECT = process.env.PROBE_EXPECT || 'fixed'

console.log('① 打开 ' + BASE)
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(1200)

// 登录（若已在登录页）
if (await page.locator('input[placeholder="用户名"]').count()) {
  console.log('   检测到登录页 → 用测试账号登录（' + USER + '）')
  await page.fill('input[placeholder="用户名"]', USER)
  await page.fill('input[placeholder="密码"]', PASS)
  await page.click('button.btn-primary.btn-block')
  await page.waitForTimeout(3500)
} else {
  console.log('   已是登录态')
}
chk(!(await page.locator('input[placeholder="用户名"]').count()), '登录成功（不再停在登录页）')

// 种一个会话：真实原文 + 纯文本回归件
console.log('\n② 种入会话（真实原文 ' + REAL.length + ' 字 + 纯文本回归件）')
await page.evaluate(({ sid, title, real, textOnly }) => {
  const sessions = [{
    id: sid, title, updated_at: Date.now(),
    messages: [
      { role: 'user', content: '（探针）两份稿子再发我一次' },
      { role: 'assistant', content: real },
      { role: 'assistant', content: textOnly },
    ],
  }]
  localStorage.setItem('hergent_chat_sessions_v1', JSON.stringify(sessions))
}, { sid: SID, title: TITLE, real: REAL, textOnly: TEXT_ONLY })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)

console.log('\n③ 打开副驾 → 历史会话 → 该会话')
await page.click('button.tb-copilot')
await page.waitForTimeout(700)
await page.click('button[title="历史会话"]')
await page.waitForTimeout(700)
const item = page.locator('.cp-hist-item', { hasText: 'v301 探针' }).first()
chk(await item.count() > 0, '历史列表里找到探针会话')
await item.click()
await page.waitForTimeout(1200)

const bubbles = page.locator('.msg.assistant .md')
console.log('\n④ 断言')
const n = await bubbles.count()
chk(n >= 2, 'assistant 气泡数 = ' + n + '（≥2）')
const allText = (await bubbles.allInnerTexts()).join('\n---\n')
if (EXPECT === 'bug') {
  // 反例对照：没有修复的那一端，路径必然裸在正文里、也不该有卡片
  chk(allText.includes('/opt/hermes-tenants/'), '反例：气泡里**裸着**服务器路径（缺陷复现）')
  console.log('   参考：MEDIA: 标记是否也裸在正文 = ' + allText.includes('MEDIA:'))
  chk((await page.locator('.msg-file').count()) === 0, '反例：**没有**任何文件卡（无从下载）')
  const shot0 = '/tmp/v301-ui-baseline.png'
  await page.screenshot({ path: shot0 })
  console.log('\n⑥ 反例截图：' + shot0)
  console.log('⑦ 失败请求：' + (failures.length ? failures.slice(0, 4).join(' | ') : '无'))
  await browser.close()
  console.log('\n' + (fail ? '🔴 反例断言失败 ' + fail : '🟢 反例成立：该端确实只显示路径、无下载入口'))
  process.exit(fail ? 1 : 0)
}
chk(!allText.includes('/opt/'), '气泡内**没有**服务器路径（原来就是它漏出来的）')
chk(!allText.includes('MEDIA:'), '气泡内**没有** MEDIA: 裸标记')

const cards = page.locator('.msg-file')
const cn = await cards.count()
chk(cn === 2, '文件卡数量 = ' + cn + '（期望 2）')
const names = await page.locator('.msg-file .cp-art-file-name').allInnerTexts()
chk(JSON.stringify(names) === JSON.stringify(['BP-想法梳理与开发计划-v1.docx', '25-BP正文-终版-v6.docx']),
  '卡片文件名 = ' + JSON.stringify(names))
const hrefs = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('href')))
chk(hrefs.every((h) => h && h.startsWith('/api/ai/media?path=')), '卡片 href 指向回源端点')
chk(hrefs.every((h) => decodeURIComponent(h).includes('/opt/hermes-tenants/hergent_t1/output/')),
  'href 里的路径经 URL 编码后正确还原')

// 纯文本回归件：markdown 仍渲染、且不受影响
const mdHtml = (await bubbles.evaluateAll((els) => els.map((e) => e.innerHTML)))[1] || ''
chk(mdHtml.includes('<table class="md-table">') && mdHtml.includes('<ul>') && mdHtml.includes('<ol>'),
  '纯文本消息的 markdown（表格/无序/有序）仍正常渲染')

// 真实下载：用页面里的 token 直接打回源端点
console.log('\n⑤ 真实下载（页面上下文里带 token 打 /api/ai/media）')
const dl = await page.evaluate(async (href) => {
  const tok = localStorage.getItem('hergent_v2_token') || ''
  const r = await fetch(href, { headers: { Authorization: 'Bearer ' + tok } })
  const b = await r.blob()
  return { status: r.status, size: b.size, cd: r.headers.get('content-disposition') || '' }
}, hrefs[0])
chk(dl.status === 200 && dl.size > 1000,
  'HTTP ' + dl.status + ' / ' + dl.size + ' 字节 / ' + dl.cd.slice(0, 46))

const shot = '/tmp/v301-ui-proof.png'
await page.screenshot({ path: shot, fullPage: false })
console.log('\n⑥ 截图：' + shot)
console.log('⑦ 失败请求（含既有 RBAC 403，用于判定是否与我这次改动有关）：')
console.log('   ' + (failures.length ? failures.slice(0, 6).join('\n   ') : '无'))
// 只断言「与本次端点相关」的加载失败为 0；其余 403 属既有 RBAC（sales 角色），
// 用 PROBE_EXPECT=bug 打生产做对照可证其**与本次改动无关**。
const mine = failures.filter((f) => f.includes('/api/ai/media'))
chk(mine.length === 0, '与回源端点相关的加载失败 = ' + mine.length)
chk(errs.filter((e) => /ai\/media/.test(e)).length === 0, '控制台无与回源端点相关的报错')

await browser.close()
console.log('\n' + (fail ? '🔴 失败 ' + fail + ' 项' : '🟢 真机验证全部通过'))
process.exit(fail ? 1 : 0)
