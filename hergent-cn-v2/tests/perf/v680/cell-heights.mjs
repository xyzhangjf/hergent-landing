import { chromium } from 'playwright'
const BASE = 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } })
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
const demo = page.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 25000 })
await demo.first().click()
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(1200)
const targets = [
  ['采购订货单(基准)', '/inventory/purchase/new'],
  ['自提订单', '/inventory/sale/self-pickup/new'],
  ['调拨单', '/inventory/transfer/new'],
]
for (const [name, route] of targets) {
  await page.evaluate((h) => { location.hash = h }, route)
  await sleep(1800)
  const cells = await page.evaluate(() => {
    const tr = document.querySelector('table.tbl tbody tr')
    if (!tr) return null
    return [...tr.children].map((td) => {
      const inner = td.firstElementChild
      const cs = getComputedStyle(td)
      return {
        cls: td.className,
        h: Math.round(td.getBoundingClientRect().height * 10) / 10,
        padTB: cs.paddingTop + '/' + cs.paddingBottom,
        childH: inner ? Math.round(inner.getBoundingClientRect().height * 10) / 10 : null,
        childCls: inner ? inner.className : null,
        childTag: inner ? inner.tagName : null,
        text: (td.innerText || '').replace(/\s+/g, ' ').slice(0, 24),
      }
    })
  })
  console.log('==== ' + name + ' ====')
  if (cells) cells.forEach((c) => console.log(JSON.stringify(c)))
}
await b.close()
