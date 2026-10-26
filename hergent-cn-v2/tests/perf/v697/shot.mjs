import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://127.0.0.1:5188'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const ITEM = {
  id: 1, product_id: 1621, product_name: '友芝友原味发酵乳', quantity: 10, unit_price: 200,
  amount: 2000, received_qty: 0, unit: '件', unit_label: '件', base_ratio: 1, base_qty: 10,
  batch_no: '20261026-1', expiry_date: '2026-11-20', production_date: '2026-10-20',
  barcode: '6900000000012', large_barcode: '', spec: '1×8',
}

const baseOrder = {
  id: 1, order_no: 'CD6970000001', supplier_id: 2886, supplier_name: '新希望',
  status: 'approved', order_date: '2026-10-26', audit_time: '2026-10-26 10:00:00',
  received_at: '', total_amount: 2000, received_amount: 0, paid_amount: 0,
  expected_date: '2026-10-30', handler: '张三', warehouse_id: 1, warehouse_name: '中转仓',
}
const basePay = {
  id: 1, order_no: 'CD6970000001', supplier_name: '新希望', status: 'approved',
  total_amount: 2000, received_amount: 0, paid_amount: 0, unpaid_amount: 0,
  prepaid_amount: 0, overpaid_amount: 0, pay_mode: 'prepay', prepay_cap: 2000,
  ap_exists: false, ap_amount: null, ap_paid_amount: null, ap_unpaid_amount: null,
  supplier_payable: 0, supplier_prepay: 0,
}

const SCENES = [
  {
    id: 1, tab: 'payments', file: 'v697-prepay.png',
    order: baseOrder, pay: { order: basePay, payments: [], settlements: [] },
    inb: { empty: true, reason: '这张单已确认但还没到货，没有入库单。', head: {}, items: [], summary: {} },
    clip: '.ipd-pay',
  },
  {
    id: 3, tab: 'payments', file: 'v697-pay.png',
    order: { ...baseOrder, status: 'received', received_amount: 2000, received_at: '2026-10-26 15:00:00' },
    pay: {
      order: { ...basePay, status: 'received', received_amount: 2000, unpaid_amount: 1500, prepaid_amount: 500, pay_mode: 'pay', prepay_cap: 1500, ap_exists: true, ap_amount: 2000, ap_paid_amount: 0, ap_unpaid_amount: 2000 },
      payments: [
        { id: 11, account: '现金', amount: 500, note: '下单先付 30%', operator_id: '1', operator_name: '张俊峰', category: '采购预付款', created_at: '2026-10-24 09:12:00' },
        { id: 12, account: '银行', amount: 500, note: '到货付一半', operator_id: '1', operator_name: '张俊峰', category: '采购付款', created_at: '2026-10-26 16:20:00' },
      ],
      settlements: [],
    },
    inb: { empty: false, derived: true, head: { inbound_no: 'RK6970000001', received_at: '2026-10-26 15:00:00' }, items: [{ ...ITEM, received_qty: 10, recv_amount: 2000, order_qty: 10, order_amount: 2000, diff_qty: 0 }], summary: { recv_qty: 10, recv_amount: 2000 } },
    clip: '.ipd-pay',
  },
  {
    id: 5, tab: 'payments', file: 'v697-overpaid.png',
    order: { ...baseOrder, status: 'received', received_amount: 2000 },
    pay: {
      order: { ...basePay, status: 'received', received_amount: 2000, unpaid_amount: 0, prepaid_amount: 2500, overpaid_amount: 500, pay_mode: 'none', prepay_cap: 0, ap_exists: true, ap_amount: 2000, ap_paid_amount: 0, ap_unpaid_amount: 2000 },
      payments: [{ id: 21, account: '现金', amount: 2500, note: '整批预付', operator_id: '1', operator_name: '张俊峰', category: '采购预付款', created_at: '2026-10-24 09:12:00' }],
      settlements: [],
    },
    inb: { empty: false, derived: true, head: { inbound_no: 'RK6970000001', received_at: '2026-10-26 15:00:00' }, items: [{ ...ITEM, received_qty: 10, recv_amount: 2000 }], summary: { recv_qty: 10, recv_amount: 2000 } },
    clip: '.ipd-info',
  },
  {
    id: 7, tab: 'inbound', file: 'v697-inbound-act.png',
    order: { ...baseOrder, status: 'draft', audit_time: '' },
    pay: { order: { ...basePay, status: 'draft', pay_mode: 'none' }, payments: [], settlements: [] },
    inb: { empty: true, reason: '这张单还是草稿，没有入库单。', head: {}, items: [], summary: {} },
    clip: '.tab-pane',
  },
]

const browser = await chromium.launch({ headless: true, executablePath: CHROME })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()

await page.goto(BASE + '/?__p=697s', { waitUntil: 'domcontentloaded' })
await sleep(2200)
if (!(await page.$('.topbar'))) {
  const d = page.getByRole('button', { name: /先看看演示效果/ })
  await d.first().waitFor({ timeout: 20000 })
  await d.first().click()
  await page.waitForSelector('.topbar', { timeout: 30000 })
  await sleep(1500)
}
await page.route('**/api/auth/perms-rev', (r) => r.abort()).catch(() => {})

for (const s of SCENES) {
  await page.unroute('**/api/psi/purchase-orders/**').catch(() => {})
  await page.route('**/api/psi/purchase-orders/**', async (route) => {
    const u = route.request().url()
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) })
    if (/\/payments$/.test(u)) return json(s.pay)
    if (/\/inbound$/.test(u)) return json(s.inb)
    if (/\/logs$/.test(u)) return json({ logs: [] })
    if (/\/attachments$/.test(u)) return json({ items: [], count: 0 })
    if (/\/neighbors$/.test(u)) return json({ prev: null, next: null })
    if (/\/purchase-orders\/\d+$/.test(u)) return json({ order: s.order, items: [ITEM], extra: {} })
    return json({})
  })
  await page.goto(BASE + '/#/inventory/purchase/' + s.id + '?tab=' + s.tab, { waitUntil: 'domcontentloaded' })
  await sleep(2400)
  const el = await page.$(s.clip)
  if (el) {
    await el.screenshot({ path: '/tmp/' + s.file })
    console.log('shot', s.file)
  } else {
    await page.screenshot({ path: '/tmp/' + s.file, fullPage: false })
    console.log('shot(full)', s.file, '— clip 未命中', s.clip)
  }
}

// 预付款弹窗单独截
await page.unroute('**/api/psi/purchase-orders/**').catch(() => {})
const a = SCENES[0]
await page.route('**/api/psi/purchase-orders/**', async (route) => {
  const u = route.request().url()
  const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) })
  if (/\/payments$/.test(u)) return json(a.pay)
  if (/\/inbound$/.test(u)) return json(a.inb)
  if (/\/logs$/.test(u)) return json({ logs: [] })
  if (/\/attachments$/.test(u)) return json({ items: [], count: 0 })
  if (/\/neighbors$/.test(u)) return json({ prev: null, next: null })
  if (/\/purchase-orders\/\d+$/.test(u)) return json({ order: a.order, items: [ITEM], extra: {} })
  return json({})
})
await page.goto(BASE + '/#/inventory/purchase/9?tab=payments', { waitUntil: 'domcontentloaded' })
await sleep(2400)
const btn = await page.$('.ipd-paybtn')
if (btn) {
  await btn.click()
  await sleep(600)
  const dlg = await page.$('.ipd-dlg')
  if (dlg) { await dlg.screenshot({ path: '/tmp/v697-dialog.png' }); console.log('shot v697-dialog.png') }
}

await browser.close()
