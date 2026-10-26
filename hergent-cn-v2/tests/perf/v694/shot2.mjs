import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://127.0.0.1:5188'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const Q = {
  normal: { ok: true, tier: 'free', credits_limit: 3000, credits_used: 59, credits_remaining: 2941, credits_pct: 2, exempt: false, exceeded: false, is_peak: false },
  warn: { ok: true, tier: 'free', credits_limit: 3000, credits_used: 2550, credits_remaining: 450, credits_pct: 85, exempt: false, exceeded: false, is_peak: false }
}
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const p = await ctx.newPage()
await p.goto(BASE + '/?__p=694shot', { waitUntil: 'domcontentloaded' })
await sleep(2300)
if (!(await p.$('.topbar'))) {
  await p.getByRole('button', { name: /先看看演示效果/ }).first().click()
  await p.waitForSelector('.topbar', { timeout: 30000 })
  await sleep(1300)
}
let scene = 'normal'
await ctx.route('**/api/ai/quota*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Q[scene]) }))
await p.reload({ waitUntil: 'domcontentloaded' })
await sleep(2000)
await p.keyboard.press('Meta+k')
await sleep(1300)

// 平时态：输入框下沿 + footer 一整条
const grab = async (name) => {
  const box = await p.evaluate(() => {
    const meta = document.querySelector('.cp-foot-meta')
    const warn = document.querySelector('.cp-quota-warn')
    if (!meta) return null
    const m = meta.getBoundingClientRect()
    const w = warn && warn.offsetHeight > 0 ? warn.getBoundingClientRect() : null
    const top = w ? w.top : m.top
    return { x: m.left - 140, y: top - 14, width: m.width + 280, height: (m.bottom - top) + 26 }
  })
  if (box) await p.screenshot({ path: `/tmp/v694b-${name}.png`, clip: box })
  return box
}
console.log('normal', JSON.stringify(await grab('strip-normal')))

// 切临界态
scene = 'warn'
await p.reload({ waitUntil: 'domcontentloaded' })
await sleep(2000)
await p.keyboard.press('Meta+k')
await sleep(1300)
console.log('warn', JSON.stringify(await grab('strip-warn')))
await p.click('.cp-usage-btn')
await sleep(500)
const mbox = await p.evaluate(() => {
  const chip = document.querySelector('.cp-usage-btn'), menu = document.querySelector('.cp-usage-menu')
  const a = chip.getBoundingClientRect(), m = menu.getBoundingClientRect()
  return { x: Math.min(a.left, m.left) - 10, y: m.top - 8, width: (Math.max(a.right, m.right) - Math.min(a.left, m.left)) + 20, height: (a.bottom - m.top) + 28 }
})
await p.screenshot({ path: '/tmp/v694b-menu2.png', clip: mbox })
console.log('menu', JSON.stringify(mbox))
await b.close()
