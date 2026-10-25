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
await page.evaluate(() => { location.hash = '/inventory/sale/self-pickup/new' })
await sleep(1800)
const info = await page.evaluate(() => {
  const tr = document.querySelector('table.tbl tbody tr')
  const td = tr.querySelector('td')
  const tbl = document.querySelector('table.tbl')
  const g = (el) => { const c = getComputedStyle(el); return { h: c.height, mh: c.minHeight, lh: c.lineHeight, fs: c.fontSize, va: c.verticalAlign, disp: c.display } }
  return {
    tr: g(tr), td: g(td), tbl: g(tbl),
    dataDensity: document.documentElement.getAttribute('data-density') || document.body.getAttribute('data-density') || 'none',
    tdCount: tr.children.length,
    rowOuter: tr.outerHTML.slice(0, 600),
  }
})
console.log(JSON.stringify(info, null, 2))
await b.close()
