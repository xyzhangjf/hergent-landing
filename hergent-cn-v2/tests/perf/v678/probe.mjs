/**
 * v678 探针：采购单列表「关联 / 操作」两列的换行与行高实测。
 *
 * 🔴 为什么要 stub 接口：演示租户在采购单表里**零行**
 *    （页面能进、筛选器都在，但 `purchase_orders` 是空的），真实页面渲染不出表格。
 *    这里用 Playwright `page.route` 顶上 `GET /api/psi/purchase-orders*`，
 *    喂 7 种状态各一行 —— 页面组件本身**完全走真实代码路径**，只有数据是假的。
 *    ⇒ 量到的行高/换行就是生产上的样子。
 *
 * 判据（而非"看着办"）：
 *   ① 行内按钮/链接的 `top` 去重后必须 = 1 ⇒ 单行（2 行就是换行）
 *   ② 操作列 / 关联列 `scrollWidth > clientWidth` ⇒ 内容被裁（静默截断）
 *   ③ 两种密度都要过：`html[data-density=compact]`（padding 2px）与默认（10px）。
 *      宽松档内容宽更小 —— 只在紧凑档过 = 上宽屏就裁字。
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://127.0.0.1:8903'
const OUT = process.env.OUT || 'tests/perf/v678'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ROWS = [
  { id: 901, order_no: 'CG2026102500901', status: 'draft',            supplier: '内蒙古蒙牛乳业（集团）股份有限公司低温事业部', warehouse: '东津仓', order_date: '2026-10-21', expected_date: '2026-10-23', total_amount: 128600, received_amount: 0, paid_amount: 0, unpaid: 128600, creator_name: '张俊峰', print_count: 0, note: '常温与低温混装，按车次分两批到' },
  { id: 902, order_no: 'CG2026102500902', status: 'pending_approval', supplier: '蒙牛高科乳制品（北京）有限公司', warehouse: '吾悦仓', order_date: '2026-10-22', expected_date: '2026-10-24', total_amount: 86200,  received_amount: 0, paid_amount: 0, unpaid: 86200,  creator_name: '程欢欢', print_count: 1, note: '' },
  { id: 903, order_no: 'CG2026102500903', status: 'confirmed',        supplier: '蒙牛乳业（唐山）有限责任公司',   warehouse: '东津仓', order_date: '2026-10-20', expected_date: '2026-10-22', total_amount: 54200,  received_amount: 0, paid_amount: 0, unpaid: 54200,  creator_name: '刘小顶', print_count: 2, note: '' },
  { id: 904, order_no: 'CG2026102500904', status: 'partial',          supplier: '蒙牛乳业（银川）有限公司',       warehouse: '东津仓', order_date: '2026-10-18', expected_date: '2026-10-20', total_amount: 97300,  received_amount: 50000, paid_amount: 30000, unpaid: 67300, creator_name: '张俊峰', print_count: 1, note: '缺 12 箱，已催' },
  { id: 905, order_no: 'CG2026102500905', status: 'received',         supplier: '蒙牛乳业（清远）有限公司',       warehouse: '吾悦仓', order_date: '2026-10-15', expected_date: '2026-10-17', total_amount: 112800, received_amount: 112800, paid_amount: 112800, unpaid: 0, creator_name: '程欢欢', print_count: 3, note: '' },
  { id: 906, order_no: 'CG2026102500906', status: 'cancelled',        supplier: '蒙牛乳业（尚志）有限责任公司',   warehouse: '东津仓', order_date: '2026-10-12', expected_date: '2026-10-14', total_amount: 34200,  received_amount: 0, paid_amount: 0, unpaid: 0, creator_name: '刘小顶', print_count: 0, note: '厂家缺货，整单取消' },
  { id: 907, order_no: 'CG2026102500907', status: 'returned',         supplier: '蒙牛乳业（保定）有限公司',       warehouse: '吾悦仓', order_date: '2026-10-10', expected_date: '2026-10-12', total_amount: 46800,  received_amount: 46800, paid_amount: 46800, unpaid: 0, creator_name: '张俊峰', print_count: 1, note: '' },
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()

await page.route('**/api/psi/purchase-orders**', (route) => {
  if (route.request().method() !== 'GET') return route.continue()
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      orders: ROWS,
      total: ROWS.length,
      counts: { '': 7, draft: 1, pending_approval: 1, confirmed: 1, partial: 1, received: 1, cancelled: 1, returned: 1 },
      summary: { order_amount: 560100, received_amount: 209600, paid_amount: 191100, unpaid_amount: 368100 },
    }),
  })
})

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
const demo = page.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 25000 })
await demo.first().click()
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(1200)
await page.evaluate(() => { location.hash = '#/inventory/purchase' })
await page.waitForSelector('.ipl-tbl tbody tr', { timeout: 20000 })
await sleep(800)

const measure = () => page.evaluate(() => {
  const lines = (el) => {
    if (!el) return null
    const kids = [...el.children].filter((c) => c.getBoundingClientRect().height > 0)
    const tops = new Set(kids.map((c) => Math.round(c.getBoundingClientRect().top)))
    return { n: kids.length, lines: tops.size }
  }
  const rows = [...document.querySelectorAll('.ipl-tbl tbody tr')]
  return {
    build: window.__HG_BUILD__,
    density: document.documentElement.dataset.density || '(默认)',
    tdPad: getComputedStyle(document.querySelector('.ipl-tbl tbody tr td.ipl-c-op')).padding,
    rows: rows.map((tr) => {
      const op = tr.querySelector('.ipl-c-op')
      const rel = tr.querySelector('.ipl-c-rel')
      const opIn = op && op.querySelector('.ipl-op')
      const relIn = rel && rel.querySelector('.ipl-rel')
      const r = tr.getBoundingClientRect()
      return {
        no: (tr.querySelector('a.ipl-link.strong') || {}).textContent || '',
        h: +r.height.toFixed(1),
        op: op ? { txt: op.innerText.replace(/\s+/g, ' ').trim(), ...lines(opIn), cw: op.clientWidth, sw: op.scrollWidth } : null,
        rel: rel ? { txt: rel.innerText.replace(/\s+/g, ' ').trim(), ...lines(relIn), cw: rel.clientWidth, sw: rel.scrollWidth } : null,
      }
    }),
    opColW: +document.querySelector('th.ipl-c-op').getBoundingClientRect().width.toFixed(1),
    relColW: +document.querySelector('th.ipl-c-rel').getBoundingClientRect().width.toFixed(1),
    tableW: document.querySelector('.ipl-tbl').scrollWidth,
  }
})

const bad = []
for (const d of ['compact', '']) {
  await page.evaluate((v) => {
    if (v) document.documentElement.dataset.density = v
    else delete document.documentElement.dataset.density
  }, d)
  await sleep(500)
  const r = await measure()
  // 把「操作」列滚进视口后再截图/再量（内容宽与滚动无关，这里只是让截图能看见）
  await page.evaluate(() => { const w = document.querySelector('.ipl-tbl').parentElement; w.scrollLeft = w.scrollWidth })
  await sleep(200)
  const r2 = await measure()
  console.log(`\n── 密度 ${r.density}｜td padding ${r.tdPad}｜op 列 ${r2.opColW}px｜关联列 ${r2.relColW}px｜表宽 ${r2.tableW}px ──`)
  for (const x of r2.rows) {
    const opLine = x.op ? `${x.op.lines} 行 ${x.op.sw}/${x.op.cw}` : '-'
    const relLine = x.rel ? `${x.rel.lines} 行 ${x.rel.sw}/${x.rel.cw}` : '-'
    console.log(`  ${x.no}  h=${x.h}  op[${opLine}] ${x.op ? x.op.txt : ''}  rel[${relLine}] ${x.rel ? x.rel.txt : ''}`)
    if (x.op && x.op.lines > 1) bad.push(`${x.no} op 换行`)
    if (x.rel && x.rel.lines > 1) bad.push(`${x.no} rel 换行`)
    if (x.op && x.op.sw > x.op.cw) bad.push(`${x.no} op 溢出 ${x.op.sw}>${x.op.cw}`)
    if (x.rel && x.rel.sw > x.rel.cw) bad.push(`${x.no} rel 溢出 ${x.rel.sw}>${x.rel.cw}`)
  }
  const hs = [...new Set(r2.rows.map((x) => x.h))]
  console.log(`  行高集合 ${JSON.stringify(hs)}`)
  await page.screenshot({ path: `${OUT}/${process.env.SHOT || 'shot'}-${r.density === '(默认)' ? 'loose' : 'compact'}.png`, clip: { x: 620, y: 150, width: 1300, height: 520 } })
}

console.log(`\n${bad.length ? '🔴 ' + bad.length + ' 处不合格：\n  ' + bad.join('\n  ') : '✅ 两档密度全部单行、无溢出'}`)
await browser.close()
process.exit(bad.length ? 1 : 0)
