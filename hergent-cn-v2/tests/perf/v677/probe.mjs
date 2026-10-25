/**
 * v677 真机探针：侧栏条目（恢复 38.8）+ 全局标签栏（收矮 35）
 * 用法：本地 dist 服务已起 → node tests/perf/v677/probe.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://127.0.0.1:8902'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
// 真实登录流程：后端 Set-Cookie 的 httpOnly token，不能用 JS 注入
const demo = page.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 25000 })
await demo.first().click()
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(2000)

const measure = () =>
  page.evaluate(() => {
    const px = (v) => parseFloat(v) || 0
    const bar = document.querySelector('.tabbar')
    const bs = bar ? getComputedStyle(bar) : null
    const br = bar ? bar.getBoundingClientRect() : null
    const items = [...document.querySelectorAll('.tab-item')].map((el) => {
      const r = el.getBoundingClientRect()
      return { t: el.innerText.trim().slice(0, 6), h: +r.height.toFixed(2) }
    })
    const moreBtn = document.querySelector('.tab-more-btn')
    const sb = [...document.querySelectorAll('.sb-item')].map((el) => {
      const r = el.getBoundingClientRect()
      return { t: el.innerText.trim().slice(0, 6), h: +r.height.toFixed(2) }
    })
    const menu = document.querySelector('.tab-more-menu')
    return {
      build: window.__HG_BUILD__,
      topbarH: +document.querySelector('.topbar').getBoundingClientRect().height.toFixed(2),
      tabbar: bar
        ? {
            h: +br.height.toFixed(2),
            pad: bs.padding,
            borderBottom: bs.borderBottomWidth,
            itemH: [...new Set(items.map((i) => i.h))],
            itemCount: items.length,
            moreBtnH: moreBtn ? +moreBtn.getBoundingClientRect().height.toFixed(2) : null,
            menuTop: menu ? getComputedStyle(menu).top : null,
            fontSize: getComputedStyle(document.querySelector('.tab-item')).fontSize
          }
        : null,
      sidebar: {
        count: sb.length,
        heights: [...new Set(sb.map((i) => i.h))],
        fontSize: [...new Set([...document.querySelectorAll('.sb-item')].map((e) => getComputedStyle(e).fontSize))],
        padTop: [...new Set([...document.querySelectorAll('.sb-item')].map((e) => getComputedStyle(e).paddingTop))],
        lh: [...new Set([...document.querySelectorAll('.sb-item')].map((e) => getComputedStyle(e).lineHeight))],
        total: +sb.reduce((a, b) => a + b.h, 0).toFixed(1)
      }
    }
  })

const before = await measure()
console.log('\n=== 当前（v677）===')
console.log(JSON.stringify(before, null, 1))

await page.screenshot({ path: 'tests/perf/v677/v677-after.png', clip: { x: 0, y: 0, width: 1000, height: 420 } })

// ── A/B：运行时注回 v676 的旧值 ──
await page.addStyleTag({
  content: `.tabbar{padding:6px 20px !important}
            .tab-item{height:28px !important}
            .tab-more-btn{height:28px !important}
            .sb-item{padding:7px 10px !important;line-height:20px !important}`
})
await sleep(450) // .sb-item 有 transition:all .15s，必须等过渡结束
const old = await measure()
console.log('\n=== A/B 注回 v676 旧值 ===')
console.log(JSON.stringify({ tabbarH: old.tabbar && old.tabbar.h, tabbarItemH: old.tabbar && old.tabbar.itemH, sidebarHeights: old.sidebar.heights, sidebarTotal: old.sidebar.total }, null, 1))
await page.screenshot({ path: 'tests/perf/v677/v677-before.png', clip: { x: 0, y: 0, width: 1000, height: 420 } })

// ── 判定 ──
const fails = []
if (before.build !== 'v677') fails.push(`build 号不是 v677：${before.build}`)
if (!before.tabbar) fails.push('没找到 .tabbar（标签没开或组件没渲染）')
else {
  const b = before.tabbar
  if (Math.abs(b.h - 35) > 0.6) fails.push(`标签栏高度 ${b.h}，应为 35`)
  if (b.itemH.length !== 1 || Math.abs(b.itemH[0] - 26) > 0.6) fails.push(`条目高度 ${JSON.stringify(b.itemH)}，应统一 26`)
  if (b.moreBtnH !== null && Math.abs(b.moreBtnH - 26) > 0.6) fails.push(`「更多」按钮 ${b.moreBtnH}，应与条目同为 26`)
  if (b.pad !== '4px 20px') fails.push(`.tabbar padding 是 ${b.pad}，应为 4px 20px`)
}
const sh = before.sidebar
if (sh.heights.length !== 1) fails.push(`侧栏条目高度不唯一：${JSON.stringify(sh.heights)}`)
else if (Math.abs(sh.heights[0] - 38.8) > 0.7) fails.push(`侧栏条目 ${sh.heights[0]}，应恢复 38.8`)
if (sh.fontSize.length !== 1) fails.push(`侧栏字号有 ${sh.fontSize.length} 种：${JSON.stringify(sh.fontSize)}`)

console.log('\n=== A/B 对照 ===')
console.log(`标签栏：旧 ${old.tabbar && old.tabbar.h} → 新 ${before.tabbar && before.tabbar.h}`)
console.log(`侧栏条目：旧 ${JSON.stringify(old.sidebar.heights)} → 新 ${JSON.stringify(before.sidebar.heights)}（总 ${old.sidebar.total} → ${sh.total}）`)
console.log('\n' + (fails.length === 0 ? '✅ ALL PASS' : '❌ FAILED\n - ' + fails.join('\n - ')))

await browser.close()
process.exit(fails.length === 0 ? 0 : 1)
