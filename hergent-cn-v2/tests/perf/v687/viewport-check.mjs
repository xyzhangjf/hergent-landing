/**
 * v687 视口自查：老板笔记本 1920 屏用浏览器 125% ⇒ CSS 视口 1536。
 * 这里在 1536 / 1280 / 1440 三个宽度下实测主要页面有没有横向溢出。
 *
 * 只读，不建单。演示租户列表页无单据 ⇒ 空态无表头，表格列宽测不到（输出里会标注）。
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ROUTES = [
  ['首页', '/'],
  ['采购订货单', '/inventory/purchase/new'],
  ['采购退货单', '/inventory/purchase/return/new'],
  ['自提销售单', '/inventory/sale/self-pickup/new'],
  ['车销销售单', '/inventory/sale/vehicle/new'],
  ['销售单列表', '/inventory/sale'],
  ['采购单列表', '/inventory/purchase'],
]

const WIDTHS = [
  [1536, 864, '100%×125%（1920 屏）'],
  [1440, 900, '100%（1440 屏）'],
  [1280, 800, '100%（1280 屏，最窄）'],
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })

for (const [w, h, note] of WIDTHS) {
  console.log(`\n${'='.repeat(56)}\n视口 ${w}×${h}  —— ${note}\n${'='.repeat(56)}`)
  const ctx = await browser.newContext({ viewport: { width: w, height: h } })
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  const demo = page.getByRole('button', { name: /先看看演示效果/ })
  await demo.first().waitFor({ timeout: 25000 })
  await demo.first().click()
  await page.waitForSelector('.topbar', { timeout: 30000 })
  await sleep(1500)

  for (const [label, route] of ROUTES) {
    await page.evaluate((r) => { location.hash = r }, route)
    await sleep(2200)
    const m = await page.evaluate(() => {
      const de = document.documentElement
      /* 视口级横向溢出：整页被撑宽（用户要横向拖动才能看全） */
      const pageOverflow = de.scrollWidth - de.clientWidth
      /* 找出真正把页面撑宽的元素（取最靠内、宽度仍超视口的那个） */
      let culprit = null
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width > de.clientWidth + 1 && r.height > 20) {
          const cs = getComputedStyle(el)
          if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue
          culprit = {
            tag: el.tagName.toLowerCase(),
            cls: (el.className || '').toString().slice(0, 60),
            w: Math.round(r.width),
          }
        }
      }
      /* 有固定宽度的表格是否超出自己的容器（列被挤爆的典型信号） */
      let tblSqueeze = null
      const tbl = document.querySelector('table')
      if (tbl) {
        const wrap = tbl.parentElement
        tblSqueeze = {
          tblW: Math.round(tbl.getBoundingClientRect().width),
          wrapW: Math.round(wrap.getBoundingClientRect().width),
          wrapOverflowX: getComputedStyle(wrap).overflowX,
          rows: tbl.querySelectorAll('tbody tr').length,
          ths: tbl.querySelectorAll('th').length,
        }
      }
      return { pageOverflow, culprit, tblSqueeze, url: location.hash }
    })

    const flag = m.pageOverflow > 0 ? '🔴 溢出' : '✅ 不溢出'
    let extra = ''
    if (m.tblSqueeze) {
      const t = m.tblSqueeze
      extra = ` ｜ 表格 ${t.tblW}px / 容器 ${t.wrapW}px（${t.wrapOverflowX}）`
      if (t.rows === 0) extra += ' 空态无数据'
    }
    console.log(`${flag}  ${label.padEnd(8)} 溢出 ${String(m.pageOverflow).padStart(3)}px${extra}`)
    if (m.culprit) console.log(`         ↳ 撑宽元素：<${m.culprit.tag} class="${m.culprit.cls}"> ${m.culprit.w}px`)
  }
  await ctx.close()
}

await browser.close()
