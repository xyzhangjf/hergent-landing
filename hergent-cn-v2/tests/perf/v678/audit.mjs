/**
 * v678 全站排查探针：找出「行内动作多到折行 ⇒ 行高被撑高」的单元格。
 *
 * 判据（一条，不靠肉眼）：
 *   对每个 `tbody tr` 的每个 `td`，取内部**可交互元素**（button / a / .tag 图标按钮）
 *   的 `getBoundingClientRect().top`，去重后 > 1 ⇒ 该格折成多行 ⇒ 行高被撑。
 *   （`top` 去重比量高度可靠：`line-height`、padding、图标基线都会干扰高度，但
 *     同一基线渲染的元素 top 必然相同。）
 *
 * 输出：按"折行格数"降序，附该格文本前 40 字 + 行高，便于逐个判断是不是本次要修的形态。
 * 用法：ROUTES='#/forecast?tab=history,#/rebate' node tests/perf/v678/audit.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://127.0.0.1:8903'
const ROUTES = (process.env.ROUTES || '#/forecast?tab=history,#/rebate,#/settings,#/inventory/sale,#/inventory/transfer').split(',')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
const demo = page.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 25000 })
await demo.first().click()
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(1500)

const report = []
for (const r of ROUTES) {
  await page.evaluate((h) => { location.hash = h }, r)
  await sleep(2600)
  const found = await page.evaluate(() => {
    const out = []
    const rows = [...document.querySelectorAll('tbody tr')]
    for (const tr of rows) {
      const cells = [...tr.children].filter((c) => c.tagName === 'TD')
      for (const td of cells) {
        const kids = [...td.querySelectorAll('button, a, input, .tag, .btn-mini, .btn-row-ic, .ipl-op-btn')]
          .filter((k) => {
            const b = k.getBoundingClientRect()
            return b.height > 0 && b.width > 0
          })
        if (kids.length < 2) continue
        const tops = new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top)))
        if (tops.size > 1) {
          out.push({
            rowH: +tr.getBoundingClientRect().height.toFixed(1),
            n: kids.length,
            lines: tops.size,
            cls: td.className || '(td)',
            txt: td.innerText.replace(/\s+/g, ' ').trim().slice(0, 44),
          })
        }
      }
    }
    return { total: rows.length, hits: out }
  })
  report.push({ route: r, ...found })
}

for (const r of report) {
  const lines = r.hits.reduce((a, h) => a + h.lines, 0)
  console.log(`\n=== ${r.route}｜${r.total} 行｜折行格 ${r.hits.length} 个（合计 ${lines} 行）===`)
  for (const h of r.hits.slice(0, 12)) {
    console.log(`  ✗ 行高 ${h.rowH}px｜${h.n} 个控件折 ${h.lines} 行｜td.${h.cls}｜${h.txt}`)
  }
  if (!r.hits.length) console.log('  ✅ 无折行')
}
const badRoutes = report.filter((r) => r.hits.length)
console.log(`\n${badRoutes.length ? '🔴 有折行的页面：' + badRoutes.map((r) => r.route).join(' / ') : '✅ 本次巡查的路由全部单行'}`)
await browser.close()
