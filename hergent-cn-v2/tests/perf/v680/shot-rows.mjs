import { chromium } from 'playwright'
const BASE = 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
const demo = page.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 25000 })
await demo.first().click()
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(1200)
async function shot(route, file) {
  await page.evaluate((h) => { location.hash = h }, route)
  await sleep(1800)
  const box = await page.evaluate(() => {
    const tr = document.querySelector('table.tbl tbody tr')
    const r = tr.getBoundingClientRect()
    return { x: Math.max(0, r.left - 4), y: Math.max(0, r.top - 4), width: r.width + 8, height: r.height + 8 }
  })
  await page.screenshot({ path: file, clip: box })
  console.log(file, JSON.stringify(box))
}
await shot('/inventory/purchase/new', 'tests/perf/v680/row-baseline.png')
await shot('/inventory/sale/self-pickup/new', 'tests/perf/v680/row-sale.png')
await shot('/inventory/transfer/new', 'tests/perf/v680/row-transfer.png')
await b.close()
