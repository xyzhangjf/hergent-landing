import { chromium } from 'playwright'
const BASE = 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ROUTES = [
  ['采购订货单(基准)', '/inventory/purchase/new'],
  ['采购退货单', '/inventory/purchase/return/new'],
  ['自提订单', '/inventory/sale/self-pickup/new'],
  ['自提退单', '/inventory/sale/self-pickup/return/new'],
  ['车销订单', '/inventory/sale/vehicle/new'],
  ['车销退单', '/inventory/sale/vehicle/return/new'],
  ['调拨单', '/inventory/transfer/new'],
]
const b = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } })
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
const demo = page.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 25000 })
await demo.first().click()
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(1200)
for (const [name, route] of ROUTES) {
  await page.evaluate((h) => { location.hash = h }, route)
  await sleep(1700)
  const r = await page.evaluate(() => {
    const tbl = document.querySelector('table.tbl')
    if (!tbl) return null
    const ths = [...tbl.querySelectorAll('thead th')].map((th) => ({
      c: (th.className || '').replace(/seq-th|col-gear-th|isn-c-|ipn-c-|num/g, '').replace(/col-gear-th|seq-th/g, '') || th.innerText.trim().slice(0, 4),
      w: Math.round(th.getBoundingClientRect().width),
      t: th.innerText.trim().slice(0, 6),
    }))
    const tr = tbl.querySelector('tbody tr')
    return { ths, rowH: Math.round(tr.getBoundingClientRect().height * 10) / 10, tableW: Math.round(tbl.getBoundingClientRect().width) }
  })
  console.log('== ' + name + ' rowH=' + r.rowH + ' tableW=' + r.tableW)
  console.log('   ' + r.ths.map((x) => `${x.t || x.c}:${x.w}`).join('  '))
}
await b.close()
