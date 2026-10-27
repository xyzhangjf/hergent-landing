/**
 * 副驾角色头像线上真身探针（不 mock）
 * 目的：老板报「副驾头像回退到火箭图标」。要拿到三件事：
 *   ① 浏览器里 <img> 的 src 到底是什么
 *   ② 该请求的 HTTP 状态码 / 内容类型
 *   ③ 图片是否真的解码成功（naturalWidth > 0）
 */
import { chromium } from 'playwright'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TOKEN = process.env.HG_TOKEN
const BASE = 'https://hergent.cn'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const b = await chromium.launch({ headless: true, executablePath: CHROME })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addCookies([
  { name: 'erp_token', value: TOKEN, url: BASE + '/' },
  { name: 'hergent_auth', value: '1', url: BASE + '/' }
])

const p = await ctx.newPage()
const avReqs = []
p.on('response', async (r) => {
  const u = r.url()
  if (u.includes('/avatar')) {
    let len = 0
    try { len = (await r.body()).length } catch { }
    avReqs.push({ url: u.replace(BASE, ''), status: r.status(), type: r.headers()['content-type'], bytes: len })
  }
})

await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await sleep(4000)
console.log('URL:', p.url())
console.log('build:', (await p.content()).match(/data-build="([^"]*)"/)?.[1])

// 打开副驾：点右上角入口（胶囊/按钮）
let opened = false
const btn = p.locator('.tb-copilot').first()
if (await btn.count()) {
  try { await btn.click({ timeout: 3000 }); opened = true } catch { }
}
if (!opened) {
  await p.keyboard.press('Meta+k')
  opened = true
}
await sleep(3000)
console.log('打开副驾:', opened, '| .copilot:', await p.locator('.copilot').count())

// 顶栏头像
const img = p.locator('.cp-ai-img-png').first()
const hasImg = await img.count()
console.log('--- 顶栏 .cp-ai-img-png ---')
if (hasImg) {
  const info = await img.evaluate(el => ({
    src: el.getAttribute('src'),
    curSrc: el.currentSrc,
    naturalWidth: el.naturalWidth,
    naturalHeight: el.naturalHeight,
    complete: el.complete,
    display: getComputedStyle(el).display
  }))
  console.log(JSON.stringify(info))
} else {
  const span = await p.locator('.cp-ai-img').first().innerHTML().catch(() => '(无)')
  console.log('没有 img，容器内容：', span)
}

// 「将由 X 回答」行 + 消息头像
for (const sel of ['.cp-who-av', '.cp-role-av', '.msg-avatar']) {
  const c = await p.locator(sel).count()
  const html = c ? (await p.locator(sel).first().innerHTML()).slice(0, 160) : ''
  console.log(`${sel} x${c}:`, html)
}

console.log('--- avatar 网络请求 ---')
avReqs.forEach(r => console.log(' ', r.status, r.type, r.bytes + 'B', r.url))

await p.screenshot({ path: 'outputs/avatar-probe.png', fullPage: false })
await b.close()
