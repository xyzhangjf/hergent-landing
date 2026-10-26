import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://127.0.0.1:5188'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const p = await ctx.newPage()
await p.goto(BASE + '/?__p=694', { waitUntil: 'domcontentloaded' })
await sleep(2200)
if (!(await p.$('.topbar'))) {
  await p.getByRole('button', { name: /先看看演示效果/ }).first().click()
  await p.waitForSelector('.topbar', { timeout: 30000 })
  await sleep(1500)
}
await p.keyboard.press('Meta+k')
await sleep(1200)

// 1) 默认态：footer 局部（3x 放大看清）
await p.locator('.cp-foot-meta').screenshot({ path: '/tmp/v694-foot2.png' })

// 2) 明细卡打开：截胶囊上方 300x300 区域
await p.click('.cp-usage-btn')
await sleep(500)
const box = await p.evaluate(() => {
  const chip = document.querySelector('.cp-usage-btn')
  const menu = document.querySelector('.cp-usage-menu')
  if (!chip || !menu) return null
  const a = chip.getBoundingClientRect(), m = menu.getBoundingClientRect()
  return { x: Math.min(a.left, m.left) - 8, y: m.top - 6, width: (Math.max(a.right, m.right) - Math.min(a.left, m.left)) + 16, height: (a.bottom - m.top) + 24 }
})
await p.screenshot({ path: '/tmp/v694-menu.png', clip: box })

// 3) 抽屉整体（看它与输入框的关系）
await p.screenshot({ path: '/tmp/v694-drawer.png' })
console.log(JSON.stringify(box))
await b.close()
