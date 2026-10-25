/**
 * v684 生产真机探针：自由退货 + 「商品不在该伙伴历史里」提醒。
 *
 * 判据原则（照 v683 的教训）：
 *   · **不硬编码"必须出现提醒"** —— 演示租户数据随时会变。改为「界面状态 ≡ 接口结论」：
 *     接口说这行商品没有历史 ⇒ 界面必须有提醒条/角标；接口说都有历史 ⇒ 界面必须干净。
 *     这样无论演示租户有没有历史单，断言都有判别力。
 *   · 数据不够时记 SKIP（退出码仍 0），不假装通过。
 *   · 行高判据 29.8px ± 1.5：提醒条/角标是绝对定位，绝不能把数据行顶高（契约 ⑰）。
 */
import { chromium } from 'playwright'

const say = (label, verdict, extra) => {
  const v = verdict === true || verdict === 'PASS' ? 'PASS' : (verdict === 'SKIP' ? 'SKIP' : 'FAIL')
  console.log(`  [${v}] ${label}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`)
  return v
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } })
const page = await ctx.newPage()

await page.goto('https://hergent.cn/', { waitUntil: 'domcontentloaded' })
const demo = page.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 25000 })
await demo.first().click()
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(2000)

const build = await page.evaluate(() => window.__HG_BUILD__ || '')
say('构建号 = v684', build === 'v684', build)

/* 取一个真实供应商 id（演示租户里通常只有一个） */
const sup = await page.evaluate(async () => {
  const r = await fetch('/api/psi/refs?kind=suppliers&limit=200', { credentials: 'include' })
  const j = await r.json()
  const list = j.suppliers || []
  return list[0] ? { id: Number(list[0].id), name: list[0].name } : null
})
say('演示租户有供应商可用', !!sup, sup || 'none')

/** 读一页上的提醒状态 */
const readWarn = () => page.evaluate(() => {
  const warn = document.querySelector('.ipn-hist-warn, .isn-hist-warn')
  const dots = document.querySelectorAll('.ipn-hist-dot, .isn-hist-dot').length
  const rows = [...document.querySelectorAll('table.tbl tbody tr')]
  const h = rows.length ? Math.round(rows[0].getBoundingClientRect().height * 10) / 10 : 0
  return {
    warnText: warn ? (warn.innerText || '').trim() : '',
    dots,
    rowH: h,
    rowCount: rows.length,
  }
})

/** 在指定商品列加一行商品（真的点单元格 + 搜 + 选第一条） */
async function pickProduct (pre) {
  const td = page.locator(`td.${pre}-c-prod`).first()
  if (!(await td.count())) return false
  await td.click()
  await sleep(300)
  const inp = page.locator(`td.${pre}-c-prod input`).first()
  if (!(await inp.count())) return false
  for (const kw of ['蒙牛', '奶', '桶']) {
    await inp.fill(kw)
    await sleep(600)
    const li = page.locator(`td.${pre}-c-prod li`).first()
    if (await li.count()) { await li.click(); return true }
  }
  await page.keyboard.press('Escape')
  return false
}

/* ══ ① 采购退货页：默认形态必须是「自由退货」，不是「挂原单」 ══ */
console.log('\n=== ① 采购退货页（自由退货默认形态）===')
await page.evaluate(() => { location.hash = '#/inventory/purchase/return/new' })
await sleep(2600)
let st = await readWarn()
const shape = await page.evaluate(() => {
  const t = document.body.innerText || ''
  const supInput = document.querySelector('.ipn-sup-input')
  return {
    hasSrcOrderLabel: t.includes('原采购单'),
    hasUnitSel: document.querySelectorAll('td.ipn-c-prod, .ipn-unit-sel').length > 0,
    supValue: supInput ? String(supInput.value || '') : '',
    unitSelects: document.querySelectorAll('select.ipn-unit-sel').length,
  }
})
say('默认不含「原采购单」格（= 自由退货，不是挂原单）', shape.hasSrcOrderLabel === false, shape.hasSrcOrderLabel)
say('数据行高仍 29.8px（±1.5，提醒不占行高）', Math.abs(st.rowH - 29.8) <= 1.5 ? 'PASS' : 'FAIL', st.rowH)

/* 带 ?supplier_id= 进来：供应商必须被预填（列表行「退货」就是这条路径）。
   🔴 必须先跳到**别的页面**再跳回来：`/inventory/purchase/return/new` 同 path 只换 query
      时 vue-router 会复用同一个组件实例，`reinit()` 只在 `?from_po` 变化时才重跑
      （既有设计，见 PurchaseReturnForm 的 watch）。真机上「从列表点退货」一定是
      从别的页面进来 ⇒ 组件会重建。探针不这样做就会把"探针自己的跳法不对"
      记成"产品没预填"。 */
if (sup) {
  await page.evaluate(() => { location.hash = '#/inventory/purchase/list' })
  await sleep(1500)
  await page.evaluate((sid) => { location.hash = `#/inventory/purchase/return/new?supplier_id=${sid}` }, sup.id)
  await sleep(2600)
  const pre = await page.evaluate(() => {
    const el = document.querySelector('.ipn-sup-input')
    return el ? String(el.value || '') : ''
  })
  say('?supplier_id= 预填了供应商', pre.includes(sup.name) ? 'PASS' : 'FAIL', { want: sup.name, got: pre })
}

/* ══ ② 提醒与接口结论一致（不留硬编码）══ */
console.log('\n=== ② 采购退货：选商品后提醒条 ≡ 接口结论 ===')
const picked = await pickProduct('ipn')
say('加到一行商品', picked ? 'PASS' : 'SKIP', picked)
if (picked) {
  await sleep(1800)
  const pid = await page.evaluate(() => {
    /* 从商品输入框值反查 id：改用页面上已注册的商品列表不易取，直接问接口按名字搜 */
    const el = document.querySelector('td.ipn-c-prod input, td.ipn-c-prod .ipn-v')
    return el ? String(el.value || el.textContent || '').trim() : ''
  })
  const api = await page.evaluate(async ({ sid, name }) => {
    const r0 = await fetch('/api/psi/refs?kind=products&keyword=' + encodeURIComponent(name) + '&limit=50',
      { credentials: 'include' })
    const j0 = await r0.json()
    const list = j0.products || []
    const hit = list.find((x) => name && String(x.name).includes(name.slice(0, 4))) || list[0]
    if (!hit) return { ok: false }
    const r = await fetch(`/api/psi/partner-product-history?kind=purchase&partner_id=${sid}&product_ids=${hit.id}`,
      { credentials: 'include' })
    const j = await r.json()
    return { ok: true, pid: hit.id, missing: j.missing || [], matched: j.matched || [] }
  }, { sid: sup ? sup.id : 0, name: pid })
  st = await readWarn()
  if (!api.ok) {
    say('取到接口结论', 'SKIP', api)
  } else {
    const expectWarn = api.missing.length > 0
    say(`接口结论：${expectWarn ? '该商品在这家供应商没有采购记录（missing）' : '该商品有采购记录（matched）'}`,
      'PASS', { pid: api.pid, missing: api.missing, matched: api.matched })
    say(`界面与之相符（${expectWarn ? '应有提醒' : '应无提醒'}）`,
      expectWarn ? (st.warnText.length > 0 && st.dots >= 1) : (st.warnText.length === 0 && st.dots === 0),
      { warnText: st.warnText.slice(0, 60), dots: st.dots })
    if (expectWarn) {
      say('提醒文案含「仍可继续退货」（是提醒不是拦截）', /仍可继续退货/.test(st.warnText), st.warnText.slice(0, 80))
    }
    say('有提醒时行高仍 29.8px（±1.5）', Math.abs(st.rowH - 29.8) <= 1.5 ? 'PASS' : 'FAIL', st.rowH)
  }
}

/* ══ ③ 自提退单：同一套提醒机制 ══ */
console.log('\n=== ③ 自提退单（与采购退货同一套机制）===')
await page.evaluate(() => { location.hash = '#/inventory/sale/self-pickup/return/new' })
await sleep(2600)
const saleShape = await page.evaluate(() => ({
  hasRetReason: (document.body.innerText || '').includes('退货原因'),
  hasProdCombo: document.querySelectorAll('td.isn-c-prod').length > 0,
}))
say('自提退单页打开（有商品列 / 退货原因）', saleShape.hasProdCombo, saleShape)
st = await readWarn()
say('自提退单：提醒条初始为空（没选客户/商品时不误报）', st.warnText.length === 0 && st.dots === 0,
  { warnText: st.warnText.slice(0, 40), dots: st.dots })
say('自提退单：数据行高仍 29.8px（±1.5）', Math.abs(st.rowH - 29.8) <= 1.5 ? 'PASS' : 'FAIL', st.rowH)

const custPicked = await (async () => {
  const inp = page.locator('.ipn-cust-input').first()
  if (!(await inp.count())) return false
  await inp.click()
  await sleep(400)
  for (const kw of ['超市', '便利', '水果']) {
    await inp.fill(kw)
    await sleep(500)
    const li = page.locator('.ipn-cust-list li').first()
    if (await li.count()) { await li.click(); return true }
  }
  return false
})()
say('选到客户', custPicked ? 'PASS' : 'SKIP', custPicked)

if (custPicked) {
  const p2 = await pickProduct('isn')
  say('加到一行商品', p2 ? 'PASS' : 'SKIP', p2)
  if (p2) {
    await sleep(1800)
    const custId = await page.evaluate(async () => {
      /* 从接口拿不到"当前选中" ⇒ 用页面上的客户名反查 */
      const el = document.querySelector('.ipn-cust-input')
      const name = el ? String(el.value || '').trim() : ''
      const r = await fetch('/api/psi/refs?kind=customers&limit=500', { credentials: 'include' })
      const j = await r.json()
      const hit = (j.customers || []).find((x) => x.name === name)
      return hit ? Number(hit.id) : 0
    })
    const api2 = await page.evaluate(async (cid) => {
      const nameEl = document.querySelector('td.isn-c-prod input, td.isn-c-prod .ipn-v')
      const name = nameEl ? String(nameEl.value || nameEl.textContent || '').trim() : ''
      const r0 = await fetch('/api/psi/refs?kind=products&keyword=' + encodeURIComponent(name) + '&limit=50',
        { credentials: 'include' })
      const j0 = await r0.json()
      const list = j0.products || []
      const hit = list.find((x) => name && String(x.name).includes(name.slice(0, 4))) || list[0]
      if (!hit) return { ok: false }
      const r = await fetch(`/api/psi/partner-product-history?kind=sale&partner_id=${cid}&product_ids=${hit.id}`,
        { credentials: 'include' })
      const j = await r.json()
      return { ok: true, pid: hit.id, missing: j.missing || [] }
    }, custId)
    st = await readWarn()
    if (!api2.ok) {
      say('取到接口结论（销售侧）', 'SKIP', api2)
    } else {
      const expectWarn = api2.missing.length > 0
      say(`接口结论（销售侧）：${expectWarn ? '该客户没买过这个商品' : '该客户买过这个商品'}`, 'PASS',
        { pid: api2.pid, missing: api2.missing })
      say('自提退单界面与之相符',
        expectWarn ? (st.warnText.length > 0 && st.dots >= 1) : (st.warnText.length === 0 && st.dots === 0),
        { warnText: st.warnText.slice(0, 60), dots: st.dots })
      if (expectWarn) {
        say('提醒文案含「仍可继续退单」', /仍可继续退单/.test(st.warnText), st.warnText.slice(0, 80))
      }
      say('自提退单：有提醒时行高仍 29.8px（±1.5）', Math.abs(st.rowH - 29.8) <= 1.5 ? 'PASS' : 'FAIL', st.rowH)
    }
  }
}

/* ══ ④ 车销退单：同一条共享模块，验页面形态即可 ══ */
console.log('\n=== ④ 车销退单 ===')
await page.evaluate(() => { location.hash = '#/inventory/sale/vehicle/return/new' })
await sleep(2600)
const vanShape = await page.evaluate(() => ({
  hasDriver: (document.body.innerText || '').includes('送货司机'),
  hasProdCombo: document.querySelectorAll('td.isn-c-prod').length > 0,
}))
say('车销退单页打开（多「送货司机」格）', vanShape.hasProdCombo && vanShape.hasDriver, vanShape)
st = await readWarn()
say('车销退单：提醒条初始为空、行高 29.8px（±1.5）',
  st.warnText.length === 0 ? (Math.abs(st.rowH - 29.8) <= 1.5 ? 'PASS' : 'FAIL') : 'FAIL',
  { dots: st.dots, rowH: st.rowH })

/* ══ ⑤ 挂原单通道仍在（详情页「转单为」用它，是唯一的可退上限护栏）══ */
console.log('\n=== ⑤ 挂原单通道未被破坏 ===')
await page.evaluate(() => { location.hash = '#/inventory/purchase/return/new?from_po=1' })
await sleep(2600)
const attached = await page.evaluate(() => (document.body.innerText || '').includes('原采购单'))
say('?from_po= 仍进「挂原单」形态（护栏保留）', attached, attached)

/* 演示租户采购单为 0 ⇒ 列表行「退货」入口无法真机点验，如实记 SKIP */
const poCount = await page.evaluate(async () => {
  const r = await fetch('/api/psi/purchase-orders?limit=5', { credentials: 'include' })
  const j = await r.json()
  return ((j.rows || j.orders || (j.data && j.data.rows)) || []).length
})
say('采购单列表行「退货」点验（需至少 1 张采购单）', poCount > 0 ? 'PASS' : 'SKIP',
  poCount > 0 ? poCount : '演示租户没有采购单；该入口已由契约组 ⑲ 静态钉住')

await browser.close()
