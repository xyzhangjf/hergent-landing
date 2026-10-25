/**
 * v679 探针：采购单列表「页头控制区」纵向密度实测。
 *
 * 目的：把用户红框那块（筛选工具条 `.card.ipl-filter` + 状态页签行 `.psi-tabbar`）
 *      的**真实纵向构成**逐项量出来，而不是"看着挺松"。
 *
 * 🔴 这块不依赖数据：`.ipl-filter` 与 `.psi-tabbar` 都是无条件渲染
 *    （页签条条件 = `tabs.length>1 || 有 actions 插槽`，counts 全 0 也有 7 个页签）
 *    ⇒ 演示租户即使采购单 0 行，页头几何也和生产真身逐像素一致。无需 stub 接口。
 *
 * 输出（每个视口一份）：各块的 rect 高度 / 计算内距 / 块间间距 / 表格首行起点 y。
 * 判据：`waste = 页头总高 − 控件行高`（纯留白），越大越松。
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'https://hergent.cn'
const OUT = process.env.OUT || 'tests/perf/v679'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const VIEWPORTS = [
  { w: 1920, h: 1080 },
  { w: 1440, h: 900 },
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function measureAt (vp) {
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

  const data = await page.evaluate(() => {
    const r = (el) => {
      if (!el) return null
      const b = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1),
        h: +b.height.toFixed(1), w: +b.width.toFixed(1),
        padT: cs.paddingTop, padB: cs.paddingBottom, padL: cs.paddingLeft, padR: cs.paddingRight,
        marginB: cs.marginBottom, font: cs.fontSize, lineH: cs.lineHeight,
      }
    }
    const q = (s) => document.querySelector(s)
    const filt = q('.ipl-filter')
    const frow = q('.ipl-filter .psi-frow')
    const tabbar = q('.psi-tabbar')
    const tabs = q('.psi-tabbar .psi-tabs')
    const tab = q('.psi-tabbar .main-tab')
    const acts = q('.psi-tabbar .psi-acts')
    const tblCard = q('.ipl-list, .ipl-tbl')?.closest('.card') || q('.ipl-tbl')
    const hd = q('.ipl-filter')   // 起点参照
    const rects = { filt: r(filt), frow: r(frow), tabbar: r(tabbar), tabs: r(tabs), tab: r(tab), acts: r(acts), tblCard: r(tblCard) }
    // 块间间距
    let gapFiltToTabbar = null
    if (filt && tabbar) gapFiltToTabbar = +(tabbar.getBoundingClientRect().top - filt.getBoundingClientRect().bottom).toFixed(1)
    // 纯留白：页头总高 − 控件行高（筛选行 32 + 页签行 tab 高）
    let headerTotal = null, controlH = null
    if (filt && tabbar && tab) {
      headerTotal = +(tabbar.getBoundingClientRect().bottom - hd.getBoundingClientRect().top).toFixed(1)
      controlH = +(frow.getBoundingClientRect().height + tab.getBoundingClientRect().height).toFixed(1)
    }
    return {
      build: window.__HG_BUILD__,
      density: document.documentElement.dataset.density || '(默认)',
      devW: innerWidth,
      rects, gapFiltToTabbar, headerTotal, controlH,
      waste: (headerTotal != null && controlH != null) ? +(headerTotal - controlH).toFixed(1) : null,
    }
  })
  await ctx.close()
  return data
}

const out = {}
for (const vp of VIEWPORTS) {
  out[`${vp.w}x${vp.h}`] = await measureAt(vp)
}
await browser.close()
console.log(JSON.stringify(out, null, 2))
