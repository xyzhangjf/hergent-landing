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
page.on('console', () => {})
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
const demo = page.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 25000 })
await demo.first().click()
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(1200)

const out = {}
for (const [name, route] of ROUTES) {
  await page.evaluate((h) => { location.hash = h }, route)
  await sleep(1800)
  const r = await page.evaluate(() => {
    const tbl = document.querySelector('table.tbl')
    if (!tbl) return { found: false }
    const tr = tbl.querySelector('tbody tr')
    if (!tr) return { found: true, rows: 0 }
    const cs = (el) => (el ? getComputedStyle(el) : null)
    const td = tr.querySelector('td')
    const tcs = cs(td)
    const input = tr.querySelector('input,select')
    const ics = cs(input)
    const opBtn = tr.querySelector('.btn-row-ic')
    const ocs = cs(opBtn)
    const th = tbl.querySelector('thead th')
    const thcs = cs(th)
    const cellSpan = tr.querySelector('.ipn-v,.isn-v,.isn-unit,span')
    const spcs = cs(cellSpan)
    const rect = tr.getBoundingClientRect()
    return {
      found: true,
      rows: tbl.querySelectorAll('tbody tr').length,
      rowH: Math.round(rect.height * 10) / 10,
      tdPadTB: tcs ? tcs.paddingTop + '/' + tcs.paddingBottom : null,
      tdPadLR: tcs ? tcs.paddingLeft + '/' + tcs.paddingRight : null,
      inputH: ics ? Math.round(parseFloat(ics.height) * 10) / 10 : null,
      inputFont: ics ? ics.fontSize : null,
      opBtnH: ocs ? Math.round(parseFloat(ocs.height) * 10) / 10 : null,
      thH: thcs ? Math.round(parseFloat(thcs.height) * 10) / 10 : null,
      thFont: thcs ? thcs.fontSize : null,
      cellFont: spcs ? spcs.fontSize : null,
      cellLH: spcs ? spcs.lineHeight : null,
    }
  })
  out[name] = r
  console.log(name, JSON.stringify(r))
}
await b.close()
import('fs').then((fs) => fs.writeFileSync('tests/perf/v680/measure.json', JSON.stringify(out, null, 2)))
console.log('done')
