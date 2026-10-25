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
const measure = () => page.evaluate(() => {
  const tr = document.querySelector('table.tbl tbody tr')
  const op = tr.querySelector('td.isn-c-op')
  const r = tr.getBoundingClientRect()
  return { rowH: Math.round(r.height * 10) / 10, opW: Math.round(op.getBoundingClientRect().width * 10) / 10, opScrollW: op.scrollWidth }
})
console.log('BEFORE', JSON.stringify(await measure()))
const candidates = [
  ['width:auto', '.isn-c-op{width:auto!important}'],
  ['nowrap', 'table.isn-tbl td.isn-c-op{white-space:nowrap!important}'],
  ['width72', '.isn-c-op{width:72px!important}'],
  ['width72+nowrap', '.isn-c-op{width:72px!important} table.isn-tbl td.isn-c-op{white-space:nowrap!important}'],
  ['width76+nowrap', '.isn-c-op{width:76px!important} table.isn-tbl td.isn-c-op{white-space:nowrap!important}'],
]
for (const [name, css] of candidates) {
  await page.addStyleTag({ content: css })
  await sleep(150)
  console.log(name, JSON.stringify(await measure()))
}
await b.close()
