import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://127.0.0.1:5188'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SCENES = {
  exempt: { ok: true, tier: 'free', credits_limit: 3000, credits_used: 59, credits_remaining: 2941, credits_pct: 2, exempt: true, exceeded: false, is_peak: false },
  warn: { ok: true, tier: 'free', credits_limit: 3000, credits_used: 2550, credits_remaining: 450, credits_pct: 85, exempt: false, exceeded: false, is_peak: false },
  normal: { ok: true, tier: 'free', credits_limit: 3000, credits_used: 59, credits_remaining: 2941, credits_pct: 2, exempt: false, exceeded: false, is_peak: false }
}
const which = process.argv[3] || 'normal'
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const p = await ctx.newPage()
await p.goto(BASE + '/?__p=694x', { waitUntil: 'domcontentloaded' })
await sleep(2200)
if (!(await p.$('.topbar'))) {
  await p.getByRole('button', { name: /先看看演示效果/ }).first().click()
  await p.waitForSelector('.topbar', { timeout: 30000 })
  await sleep(1200)
}
await ctx.route('**/api/ai/quota*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SCENES[which]) }))
await p.reload({ waitUntil: 'domcontentloaded' })
await sleep(2000)
await p.keyboard.press('Meta+k')
await sleep(1200)
await p.locator('.cp-foot-meta').screenshot({ path: `/tmp/v694-foot-${which}.png` })
await p.click('.cp-usage-btn')
await sleep(500)
const box = await p.evaluate(() => {
  const chip = document.querySelector('.cp-usage-btn'), menu = document.querySelector('.cp-usage-menu')
  if (!chip || !menu) return null
  const a = chip.getBoundingClientRect(), m = menu.getBoundingClientRect()
  return { x: Math.min(a.left, m.left) - 8, y: m.top - 6, width: (Math.max(a.right, m.right) - Math.min(a.left, m.left)) + 16, height: (a.bottom - m.top) + 24 }
})
await p.screenshot({ path: `/tmp/v694-menu-${which}.png`, clip: box })
console.log(which, 'done', JSON.stringify(box))
await b.close()
