/**
 * v677 补测：制造「标签放不下 ⇒ 出『更多』按钮」的场景
 * 验证两件最容易漏的事：
 *   ① `.tab-more-btn` 若没同步到 26px，会把整条重新撑回 37px（`.tab-item` 看着仍是矮的 ⇒ 肉眼假象）
 *   ② `.tab-more-menu` 的 top 若没跟条目同步，下拉与条之间会裂缝（期望缝 ≈ 6px）
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://127.0.0.1:8902'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
const demo = page.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 25000 })
await demo.first().click()
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(2000)

// 🔴 1 个标签永远出不了「更多」：measure() 里 `visCount = Math.max(1, n)` 保底留 1 条，
//    且 MORE_W=92 ⇒ strip 压到 90 时 avail=0、n=0 ⇒ 仍只留 1 条、hidden 为空。
//    ⇒ 必须先真的多开几个标签。演示租户侧栏只有 1 个 `a.sb-item`（其余是 sb-area-btn 弹层 +
//      进销存受能力闸门拦），所以走 hash 路由跳转（TabBar 语义就是"打开过哪些页"）。
//    ⚠️ 别用 `#/market`：实测跳过去标签会被清成 0（该页重定向重建了 tabs）。
for (const h of ['#/forecast', '#/rebate', '#/loss-accounting']) {
  await page.evaluate((x) => { location.hash = x }, h)
  await sleep(1600)
}
const openTabs = await page.locator('.tab-item').count()
const titles = await page.locator('.tab-item .tab-title').allInnerTexts()
console.log('已开标签数：', openTabs, JSON.stringify(titles))

// 压窄 .tb-strip 制造溢出，逼出「更多」
await page.addStyleTag({ content: '.tb-strip{flex:0 0 70px !important}' })
await sleep(500)

const hasMore = await page.locator('.tab-more-btn').count()
console.log('「更多」按钮是否出现：', hasMore > 0)

const r1 = await page.evaluate(() => {
  const bar = document.querySelector('.tabbar')
  const btn = document.querySelector('.tab-more-btn')
  const item = document.querySelector('.tab-item')
  return {
    tabbarH: +bar.getBoundingClientRect().height.toFixed(2),
    itemH: +item.getBoundingClientRect().height.toFixed(2),
    moreBtnH: btn ? +btn.getBoundingClientRect().height.toFixed(2) : null
  }
})
console.log('溢出态：', JSON.stringify(r1))

await page.locator('.tab-more-btn').click()
await sleep(350)

const r2 = await page.evaluate(() => {
  const btn = document.querySelector('.tab-more-btn')
  const menu = document.querySelector('.tab-more-menu')
  if (!menu) return { menu: null }
  const br = btn.getBoundingClientRect()
  const mr = menu.getBoundingClientRect()
  return {
    menuTopCss: getComputedStyle(menu).top,
    gapBtnToMenu: +(mr.top - br.bottom).toFixed(2),
    menuVisible: mr.height > 0
  }
})
console.log('下拉：', JSON.stringify(r2))

await page.screenshot({ path: 'tests/perf/v677/v677-more-open.png', clip: { x: 0, y: 0, width: 900, height: 460 } })

const fails = []
if (!hasMore) fails.push('没能制造出「更多」按钮（场景未成立）')
if (r1.moreBtnH === null) fails.push('「更多」按钮未渲染')
else if (Math.abs(r1.moreBtnH - 26) > 0.6) fails.push(`「更多」按钮 ${r1.moreBtnH}，应为 26（旧值 28 会把整条撑回 37）`)
if (Math.abs(r1.tabbarH - 35) > 0.6) fails.push(`溢出态整条高度 ${r1.tabbarH}，应仍为 35`)
if (r2.menu && (Math.abs(r2.gapBtnToMenu - 6) > 1.5)) fails.push(`下拉与条的缝 ${r2.gapBtnToMenu}px，应 ≈ 6px（top 没跟条目同步会裂开）`)

console.log('\n' + (fails.length === 0 ? '✅ ALL PASS' : '❌ FAILED\n - ' + fails.join('\n - ')))
await browser.close()
process.exit(fails.length === 0 ? 0 : 1)
