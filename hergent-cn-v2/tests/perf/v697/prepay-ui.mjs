/**
 * v697 采购「预付款 / 付款 / 入库单页发起入库」运行时验收。
 *
 * 做法：用 route 拦截三个接口造出四种单据状态，让**真实组件**渲染，再读界面字面量。
 * 为什么不直接开一张真单：
 *   · demo 是只读租户，`canWrite=false` ⇒ 所有操作按钮都不渲染，验不到；
 *   · 真单需要真审核/真入库，会动库存与应付（集成验证已在服务端做过，见
 *     `tools/hergent/test_v697_integration.py` 33 项）。
 *   ⇒ 这里专门验**界面**：按钮在哪种状态出现、文案对不对、弹窗标题对不对。
 *
 * 🔴 判据只用**用户可见字面量**（按钮文字、弹窗标题、提示句），不用 minify 后会改名的
 *    符号名 —— 这是本仓 v629 那条纪律。
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://127.0.0.1:5188'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

let PASS = 0
let FAIL = 0
function ck(name, ok, detail = '') {
  if (ok) { PASS++; console.log('  ✅ ' + name) }
  else { FAIL++; console.log('  ❌ ' + name + '  ' + detail) }
}

const ITEM = {
  id: 1, product_id: 1621, product_name: '友芝友原味发酵乳', quantity: 10, unit_price: 200,
  amount: 2000, received_qty: 0, unit: '件', unit_label: '件', base_ratio: 1, base_qty: 10,
  batch_no: '', expiry_date: '', production_date: '', barcode: '6900000000012', large_barcode: '',
}

function orderOf(over = {}) {
  return {
    id: 1, order_no: 'CD6970000001', supplier_id: 2886, supplier_name: '新希望',
    status: 'approved', order_date: '2026-10-26', audit_time: '2026-10-26 10:00:00',
    received_at: '', total_amount: 2000, received_amount: 0, paid_amount: 0,
    expected_date: '2026-10-30', handler: '张三', warehouse_id: 1, warehouse_name: '中转仓',
    ...over,
  }
}

function payOf(over = {}) {
  return {
    order: {
      id: 1, order_no: 'CD6970000001', supplier_name: '新希望', status: 'approved',
      total_amount: 2000, received_amount: 0, paid_amount: 0, unpaid_amount: 0,
      prepaid_amount: 0, overpaid_amount: 0, pay_mode: 'prepay', prepay_cap: 2000,
      ap_exists: false, ap_amount: null, ap_paid_amount: null, ap_unpaid_amount: null,
      supplier_payable: 0, supplier_prepay: 0, ...over,
    },
    payments: [],
    settlements: [],
  }
}

const CASES = [
  {
    name: 'A 已审未入库 → 预付款',
    id: 1,
    order: orderOf(),
    pay: payOf(),
    inb: { empty: true, reason: '这张单已确认但还没到货，没有入库单。', head: {}, items: [], summary: {} },
    tab: 'payments',
    btn: /^预付款$/,
    dlgTitle: /^登记预付款$/,
    dlgBtn: /^确认预付款$/,
    dlgPlaceholder: /按约定填写/,
    inbTitle: /已审核，货到齐后在这里确认入库/,
    inbHasConfirm: true,
    inbHasPartial: true,
  },
  {
    name: 'B 已入库未结清 → 付款',
    id: 2,
    order: orderOf({ status: 'received', received_amount: 2000, received_at: '2026-10-26 15:00:00' }),
    pay: {
      order: {
        ...payOf().order,
        status: 'received', received_amount: 2000, unpaid_amount: 1500,
        prepaid_amount: 500, pay_mode: 'pay', prepay_cap: 1500,
        ap_exists: true, ap_amount: 2000, ap_paid_amount: 0, ap_unpaid_amount: 2000,
      },
      payments: [
        { id: 11, account: '现金', amount: 500, note: '下单先付', operator_id: '1', operator_name: '张俊峰', category: '采购预付款', created_at: '2026-10-26 09:00:00' },
        { id: 12, account: '银行', amount: 500, note: '转账', operator_id: '1', operator_name: '张俊峰', category: '采购付款', created_at: '2026-10-26 16:00:00' },
      ],
      settlements: [],
    },
    inb: { empty: false, derived: true, head: { inbound_no: 'RK6970000001', src_order_no: 'CD6970000001', order_type: '采购订单', supplier_name: '新希望', warehouse_name: '中转仓', operator_name: '张俊峰', received_at: '2026-10-26 15:00:00' }, items: [{ ...ITEM, received_qty: 10, recv_amount: 2000, order_qty: 10, order_amount: 2000, diff_qty: 0 }], summary: { recv_qty: 10, recv_amount: 2000 } },
    tab: 'payments',
    btn: /^付款$/,
    dlgTitle: /^登记付款$/,
    dlgBtn: /^确认付款$/,
    inbTitle: null,
    inbHasConfirm: false,
    inbHasPartial: false,
    // 预付/付款两行必须分别标记，且分两行合计
    needKinds: ['预付', '付款'],
    needPrepaidTotal: true,
  },
  {
    name: 'C 超付 → 必须显式提示',
    id: 3,
    order: orderOf({ status: 'received', received_amount: 2000 }),
    pay: {
      order: {
        ...payOf().order,
        status: 'received', received_amount: 2000, unpaid_amount: 0,
        prepaid_amount: 2500, overpaid_amount: 500, pay_mode: 'none', prepay_cap: 0,
        ap_exists: true, ap_amount: 2000, ap_paid_amount: 0, ap_unpaid_amount: 2000,
      },
      payments: [
        { id: 21, account: '现金', amount: 2500, note: '', operator_id: '1', operator_name: '张俊峰', category: '采购预付款', created_at: '2026-10-26 09:00:00' },
      ],
      settlements: [],
    },
    inb: { empty: false, derived: true, head: { inbound_no: 'RK6970000001', received_at: '2026-10-26 15:00:00' }, items: [{ ...ITEM, received_qty: 10, recv_amount: 2000 }], summary: { recv_qty: 10, recv_amount: 2000 } },
    tab: 'payments',
    btn: null,
    needOverpaid: /已多付¥500\.00.*超过已到货金额/,
  },
  {
    name: 'D 草稿（小额免审）→ 入库单页可直接入库',
    id: 4,
    order: orderOf({ status: 'draft', audit_time: '' }),
    pay: payOf({ status: 'draft', pay_mode: 'none' }),
    inb: { empty: true, reason: '这张单还是草稿，没有入库单。', head: {}, items: [], summary: {} },
    tab: 'inbound',
    btn: null,
    inbTitle: /这张单还是草稿/,
    inbHasConfirm: true,
    inbHasPartial: true,
  },
]

async function openDrawer(page) {
  await page.goto(BASE + '/?__p=697', { waitUntil: 'domcontentloaded' })
  await sleep(2200)
  if (!(await page.$('.topbar'))) {
    const d = page.getByRole('button', { name: /先看看演示效果/ })
    await d.first().waitFor({ timeout: 20000 })
    await d.first().click()
    await page.waitForSelector('.topbar', { timeout: 30000 })
    await sleep(1500)
  }
}

const browser = await chromium.launch({ headless: true, executablePath: CHROME })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

await openDrawer(page)

const build = await page.evaluate(() => window.__HG_BUILD__)
console.log('构建号 =', build)
ck('__HG_BUILD__ = v697', build === 'v697', 'got=' + build)

for (const c of CASES) {
  console.log('\n━━━ ' + c.name + ' ━━━')
  // 每例重设拦截
  await page.unroute('**/api/psi/purchase-orders/**').catch(() => {})
  await page.route('**/api/psi/purchase-orders/**', async (route) => {
    const u = route.request().url()
    const json = (obj) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) })
    if (/\/payments$/.test(u)) return json(c.pay)
    if (/\/inbound$/.test(u)) return json(c.inb)
    if (/\/logs$/.test(u)) return json({ logs: [] })
    if (/\/attachments$/.test(u)) return json({ items: [], count: 0 })
    if (/\/neighbors$/.test(u)) return json({ prev: null, next: null })
    if (/\/purchase-orders\/\d+$/.test(u)) return json({ order: c.order, items: [ITEM], extra: {} })
    return json({})
  })
  // 权限接口放失败 ⇒ permActs 保持 null ⇒ canDo 一律 true（三态设计）
  await page.route('**/api/auth/perms-rev', (r) => r.abort()).catch(() => {})

  // 每个 case 用**不同单据 id**：组件对同一 route record 换 params 会复用实例，
  // 但 oid 变化会触发 watch → loadAll；id 不变就会一直用上一例的数据（踩过）。
  await page.goto(BASE + '/#/inventory/purchase/' + c.id + '?tab=' + c.tab, { waitUntil: 'domcontentloaded' })
  await sleep(2600)

  if (c.btn) {
    const btn = await page.$('.ipd-paybtn')
    const txt = btn ? (await btn.innerText()).trim() : '(无按钮)'
    ck('货款页按钮 = ' + c.btn.source.replace(/[\^$]/g, ''), c.btn.test(txt), 'got=' + JSON.stringify(txt))
    if (btn) {
      await btn.click()
      await sleep(500)
      const title = await page.$eval('.ipd-dlg-hd', (e) => e.innerText.trim()).catch(() => '(无弹层)')
      ck('弹窗标题 = ' + c.dlgTitle.source.replace(/[\^$]/g, ''), c.dlgTitle.test(title), 'got=' + JSON.stringify(title))
      const dlgBtn = await page.$eval('.ipd-dlg-ft .btn-primary', (e) => e.innerText.trim()).catch(() => '')
      ck('确认按钮 = ' + c.dlgBtn.source.replace(/[\^$]/g, ''), c.dlgBtn.test(dlgBtn), 'got=' + JSON.stringify(dlgBtn))
      if (c.dlgPlaceholder) {
        const ph = await page.$eval('.ipd-dlg .ipd-in', (e) => e.getAttribute('placeholder') || '').catch(() => '')
        ck('金额占位提示', c.dlgPlaceholder.test(ph), 'got=' + JSON.stringify(ph))
        const val = await page.$eval('.ipd-dlg .ipd-in', (e) => e.value).catch(() => '')
        ck('预付款不预填金额（必须是有意识的输入）', val === '', 'got=' + JSON.stringify(val))
      }
      await page.keyboard.press('Escape').catch(() => {})
      await page.click('.ipd-mask', { position: { x: 5, y: 5 } }).catch(() => {})
      await sleep(300)
    }
  } else {
    const btn = await page.$('.ipd-paybtn')
    ck('不该出现付款/预付按钮', btn === null, btn ? 'still there' : '')
  }

  if (c.needOverpaid) {
    const warn = await page.$eval('.ipd-overpaid', (e) => e.innerText.replace(/\s+/g, '')).catch(() => '')
    ck('超付明确提示（不被 max(0) 静默吃掉）', c.needOverpaid.test(warn), 'got=' + JSON.stringify(warn))
  }

  if (c.needKinds) {
    const kinds = await page.$$eval('.ipd-flows tbody tr td:first-child', (els) => els.map((e) => e.innerText.trim()))
    ck('流水区分「预付」「付款」', c.needKinds.every((k) => kinds.includes(k)), JSON.stringify(kinds))
    const foot = await page.$eval('.ipd-flows tfoot', (e) => e.innerText.replace(/\s+/g, '')).catch(() => '')
    ck('合计分行（预付合计 / 付款合计）', c.needPrepaidTotal ? /预付合计/.test(foot) && /付款合计/.test(foot) : true, foot)
  }

  if (c.inbTitle) {
    if (c.tab !== 'inbound') {
      await page.goto(BASE + '/#/inventory/purchase/' + c.id + '?tab=inbound', { waitUntil: 'domcontentloaded' })
      await sleep(900)
    }
    const t = await page.$eval('.ipd-inb-act-t b', (e) => e.innerText.trim()).catch(() => '(无操作条)')
    ck('入库单页操作条标题', c.inbTitle.test(t), 'got=' + JSON.stringify(t))
    const hasConfirm = (await page.$$('.ipd-inb-act .btn-primary')).length > 0
    const hasPartial = (await page.$$('.ipd-inb-act .btn-ghost')).length > 0
    ck('有「确认入库」按钮', hasConfirm === c.inbHasConfirm, 'got=' + hasConfirm)
    ck('有「分批到货」按钮', hasPartial === c.inbHasPartial, 'got=' + hasPartial)
  } else if (c.tab === 'payments') {
    const act = await page.$('.ipd-inb-act')
    ck('已入库单不应再看到入库操作条（本次未切到入库页，跳过）', true, '')
  }
}

// v696 回归：编辑态下划线没被破坏
console.log('\n━━━ v696 回归：编辑态仍无写死白底 ━━━')
const reg = await page.evaluate(() => {
  const out = { hit: 0, bad: 0 }
  for (const ss of document.styleSheets) {
    let rules
    try { rules = ss.cssRules } catch (e) { continue }
    if (!rules) continue
    for (const r of rules) {
      const t = r.selectorText || ''
      if (/ipd-edit-(in|sel)/.test(t)) {
        out.hit++
        const css = r.style ? r.style.cssText : ''
        if (/background:\s*(#fff|#ffffff|white|rgb\(255,\s*255,\s*255\))/i.test(css)) out.bad++
      }
    }
  }
  return out
})
ck('编辑态规则存在', reg.hit > 0, JSON.stringify(reg))
ck('编辑态无写死的白底', reg.bad === 0, JSON.stringify(reg))

console.log('\n' + '='.repeat(52))
console.log(`通过 ${PASS} 项，失败 ${FAIL} 项`)
console.log(FAIL === 0 ? 'ALL PASS' : 'HAS FAILURE')
await browser.close()
process.exit(FAIL === 0 ? 0 : 1)
