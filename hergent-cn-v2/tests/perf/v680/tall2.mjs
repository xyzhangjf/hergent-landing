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
const tall = await page.evaluate(() => {
  const tr = document.querySelector('table.tbl tbody tr')
  const rowTop = tr.getBoundingClientRect().top
  const res = []
  tr.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect()
    const h = Math.round(r.height * 10) / 10
    res.push({ tag: el.tagName, cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 36), h, top: Math.round((r.top - rowTop) * 10) / 10, fs: getComputedStyle(el).fontSize, lh: getComputedStyle(el).lineHeight, mh: getComputedStyle(el).minHeight })
  })
  res.sort((a, b) => b.h - a.h)
  return res.slice(0, 12)
})
console.log(JSON.stringify(tall, null, 2))
await b.close()
