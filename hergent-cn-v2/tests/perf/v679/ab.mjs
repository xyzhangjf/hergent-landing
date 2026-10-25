/**
 * v679 A/B 探针：把 v679 的三处密度改动**运行时注入**线上 v678 页面，
 * 同页前后各量一次 ⇒ 得到"纯改动"造成的精确差值（排除环境差异）。
 *
 * 注入的 CSS 与 v679 源码逐字一致（variables.css 的筛选卡内距 / psi-list.css 的
 * `.psi-tabbar .main-tab` 与 `.psi-frow` gap）。截图并存，供人工比对。
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'https://hergent.cn'
const OUT = process.env.OUT || 'tests/perf/v679'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const INJECT = `
.card.ipl-filter, .card.isl-filter, .card.is-filter,
.card.fc-filter, .card.ff-filter, .card.fd-filter, .card.fbk-filter, .card.fs-filter,
.card.wob-filter, .card.woi-filter, .card.wsa-filter, .card.win-filter, .card.wvs-filter { padding: 10px 14px; }
.psi-tabbar .main-tab { padding: 7px 12px; font-size: 13px; }
.psi-frow { gap: 10px; }
.psi-tabbar { margin: 0 0 10px; }
`

const measure = (page) => page.evaluate(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { h: +b.height.toFixed(1), top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), padT: cs.paddingTop, padB: cs.paddingBottom } }
  const filt = document.querySelector('.ipl-filter')
  const tabbar = document.querySelector('.psi-tabbar')
  const frow = document.querySelector('.ipl-filter .psi-frow')
  const tab = document.querySelector('.psi-tabbar .main-tab')
  let headerTotal = null, waste = null
  if (filt && tabbar && frow && tab) {
    headerTotal = +(tabbar.getBoundingClientRect().bottom - filt.getBoundingClientRect().top).toFixed(1)
    waste = +(headerTotal - frow.getBoundingClientRect().height - tab.getBoundingClientRect().height).toFixed(1)
  }
  return { build: window.__HG_BUILD__, filt: r('.ipl-filter'), frow: r('.ipl-filter .psi-frow'), tabbar: r('.psi-tabbar'), tab: r('.psi-tabbar .main-tab'), headerTotal, waste }
})

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results = {}

for (const vp of [{ w: 1920, h: 1080 }, { w: 1440, h: 900 }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  const demo = page.getByRole('button', { name: /先看看演示效果/ })
  await demo.first().waitFor({ timeout: 25000 })
  await demo.first().click()
  await page.waitForSelector('.topbar', { timeout: 30000 })
  await sleep(1200)
  await page.evaluate(() => { location.hash = '#/inventory/purchase' })
  await page.waitForSelector('.ipl-filter', { timeout: 20000 })
  await sleep(800)

  const before = await measure(page)
  const el = await page.$('.ipl-filter')
  await el.screenshot({ path: `${OUT}/ab-${vp.w}-before.png` })

  await page.addStyleTag({ content: INJECT })
  await sleep(300)
  const after = await measure(page)
  await el.screenshot({ path: `${OUT}/ab-${vp.w}-after.png` })

  results[`${vp.w}x${vp.h}`] = { before, after, delta: {
    filterH: +(after.filt.h - before.filt.h).toFixed(1),
    tabH: +(after.tab.h - before.tab.h).toFixed(1),
    headerTotal: +(after.headerTotal - before.headerTotal).toFixed(1),
    waste: +(after.waste - before.waste).toFixed(1),
  } }
  await ctx.close()
}
await browser.close()
console.log(JSON.stringify(results, null, 2))
