/** v678 尺寸探针：量操作列里「文字按钮」的真实盒高与 td 内边距，
 *  用来给 ⋯ 按钮定高（它不能比文字高，否则整行被它顶高 —— 那就白改了）。 */
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://127.0.0.1:8903'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ROWS = [{ id: 901, order_no: 'CG901', status: 'draft', supplier: '蒙牛', warehouse: '东津仓', order_date: '2026-10-21', total_amount: 1, received_amount: 0, paid_amount: 0, unpaid: 1, creator_name: '张俊峰', print_count: 0 }]
const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.route('**/api/psi/purchase-orders**', (route) => {
  if (route.request().method() !== 'GET') return route.continue()
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orders: ROWS, total: 1, counts: {}, summary: {} }) })
})
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
const demo = p.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 25000 }); await demo.first().click()
await p.waitForSelector('.topbar', { timeout: 30000 }); await sleep(1000)
await p.evaluate(() => { location.hash = '#/inventory/purchase' })
await p.waitForSelector('.ipl-tbl tbody tr', { timeout: 20000 }); await sleep(600)
console.log(JSON.stringify(await p.evaluate(() => {
  const tr = document.querySelector('.ipl-tbl tbody tr')
  const td = tr.querySelector('.ipl-c-op')
  const btn = td.querySelector('.ipl-op-btn')
  const cs = getComputedStyle(td)
  const bs = getComputedStyle(btn)
  const cell = [...tr.children].find((c) => c.classList.contains('amount') || c.classList.contains('num'))
  return {
    rowH: +tr.getBoundingClientRect().height.toFixed(2),
    tdPad: `${cs.paddingTop}/${cs.paddingBottom}`,
    tdH: +td.getBoundingClientRect().height.toFixed(2),
    btnH: +btn.getBoundingClientRect().height.toFixed(2),
    btnFont: bs.fontSize, btnLH: bs.lineHeight,
    density: document.documentElement.dataset.density || '(default)',
    rowPadTop: getComputedStyle(td).paddingTop,
  }
}), null, 1))
await b.close()
