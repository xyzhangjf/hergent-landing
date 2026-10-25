/* v683 真机探针：开单单位可选 + 单位×价格联动 + 行高不回归
   —— 只走真实登录流程（点「先看看演示效果」由后端 Set-Cookie），不塞 token。

   用法: node tests/perf/v683/browser-v683.mjs [baseUrl]

   ⚠️ 演示租户的数据约束（实测）：只有 13 个商品，且**没有**一个商品配了两种不同
      单位名（唯一 large_ratio>1 的那个是「箱×12=箱」退化数据）。所以：
        · 「单位是下拉且能选」「行高不回归」→ 必验；
        · 「价格随档位变化」→ 只在真有 ≥2 个不同单位时才判，否则记 SKIP；
        · 商品档案页在演示租户被重定向（模块权限不足）⇒ 记 SKIP。
      价格联动本身由隔离租户 e2e（40 条断言）+ 契约组 ⑱ 覆盖，这里不重复。
*/
import { chromium } from 'playwright'
import fs from 'fs'

const BASE = process.argv[2] || 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rows = []
const say = (name, code, detail) => {
  rows.push({ name, code, detail })
  console.log(`  [${code}] ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`)
}

const PAGES = [
  ['采购订货单', '/inventory/purchase/new', 'ipn'],
  ['自提销售单', '/inventory/sale/self-pickup/new', 'isn'],
  ['调拨单', '/inventory/transfer/new', 'isn'],
]

const b = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } })
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
const demo = page.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 25000 })
await demo.first().click()
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(1500)

const build = await page.evaluate(() => window.__HG_BUILD__ || '')
say('构建号 = v683', build === 'v683' ? 'PASS' : 'FAIL', build)

/* 候选商品：优先「≥2 个不同单位名」，其次任意有单位配置的 */
const cands = await page.evaluate(async () => {
  const r = await fetch('/api/psi/refs?kind=products&keyword=&limit=2000', { credentials: 'include' })
  const j = await r.json()
  const list = (j && (j.products || (j.data && j.data.products))) || []
  const distinct = (p) => new Set((p.unit_options || []).map((o) => o.name || o)
    .filter((n) => n && String(n).trim())).size
  return list
    .map((p) => ({ name: p.name, d: distinct(p) }))
    .sort((a, x) => x.d - a.d)
    .slice(0, 6)
})
say('演示租户商品样本', cands.length ? 'PASS' : 'SKIP',
  cands.slice(0, 3).map((c) => `${c.name}(${c.d}档)`).join(' / '))

for (const [label, route, pre] of PAGES) {
  console.log(`\n=== ${label}  ${route} ===`)
  await page.evaluate((h) => { location.hash = h }, route)
  await sleep(2200)

  /* ① 加一行商品 */
  let picked = false
  for (const kw of cands.map((c) => c.name).concat(['奶', '箱'])) {
    const prodTd = page.locator(`td.${pre}-c-prod`).first()
    if (!(await prodTd.count())) break
    await prodTd.click()
    await sleep(250)
    const inp = page.locator(`td.${pre}-c-prod input`).first()
    if (!(await inp.count())) continue
    await inp.fill(kw)
    await sleep(500)
    const li = page.locator(`td.${pre}-c-prod li`).first()
    if (await li.count()) { await li.click(); picked = true; break }
    await page.keyboard.press('Escape')
    await sleep(150)
  }
  if (!picked) { say(`${label}：搜到商品`, 'SKIP', '演示租户未找到可用商品'); continue }
  await sleep(900)

  const readRow = () => page.evaluate((p) => {
    const tr = document.querySelector(`td.${p}-c-prod`)?.closest('tr')
    if (!tr) return null
    const txt = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ')
    const num = (s) => { const m = String(s).match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : 0 }
    const unitTd = tr.querySelector(`.${p}-c-unit`)
    const priceTd = tr.querySelector(`.${p}-c-price`)
    const qtyTd = tr.querySelector(`.${p}-c-qty`)
    const sel = unitTd?.querySelector('select')
    return {
      unitText: txt(unitTd),
      selected: sel ? sel.value : '',
      priceText: txt(priceTd?.querySelector(`.${p}-v`)),
      price: num(txt(priceTd?.querySelector(`.${p}-v`))),
      qty: qtyTd?.querySelector('input')?.value ?? txt(qtyTd?.querySelector(`.${p}-v`)),
      h: Math.round(tr.getBoundingClientRect().height * 10) / 10,
    }
  }, pre)

  const r0 = await readRow()
  if (!r0) { say(`${label}：读到行`, 'FAIL', null); continue }

  /* ② 点开单位格 → 必须是 <select>（不是只读文字） */
  const unitTd = page.locator(`td.${pre}-c-unit`).first()
  await unitTd.click()
  await sleep(320)
  const optValues = await page.locator(`td.${pre}-c-unit select option`)
    .evaluateAll((els) => els.map((e) => e.value))
  const distinctUnits = [...new Set(optValues)].filter(Boolean)
  say(`${label}：单位是可点开的下拉`, optValues.length >= 1 ? 'PASS' : 'FAIL',
    `选项 ${optValues.length} 个 / 去重 ${distinctUnits.length} 档`)
  say(`${label}：行高仍 29.8px（±1.5）`, Math.abs(r0.h - 29.8) <= 1.5 ? 'PASS' : 'FAIL', r0.h)
  if (distinctUnits.length < 2) {
    say(`${label}：切档后数量不动 / 单价随档变`, 'SKIP', '演示租户该商品只有一档单位')
    continue
  }

  /* ③ 填数量 2 → 切到最大档 → 数量必须不动、单价必须变 */
  await page.locator(`td.${pre}-c-qty`).first().click()
  await sleep(200)
  const qtyInp = page.locator(`td.${pre}-c-qty input`).first()
  if (await qtyInp.count()) { await qtyInp.fill('2'); await qtyInp.press('Tab') }
  await sleep(500)
  const before = await readRow()

  await unitTd.click()                       // 单位格被数量格切走了，重新打开
  await sleep(300)
  const selEl = page.locator(`td.${pre}-c-unit select`).first()
  if (!(await selEl.count())) { say(`${label}：单位下拉可再次打开`, 'FAIL', null); continue }
  await selEl.selectOption(distinctUnits[distinctUnits.length - 1])
  await sleep(900)
  const after = await readRow()

  say(`${label}：切到「${distinctUnits[distinctUnits.length - 1]}」后数量不变`,
    String(after.qty) === String(before.qty), `${before.qty} → ${after.qty}`)
  say(`${label}：单价随单位变化`, after.priceText !== before.priceText,
    `${before.priceText} → ${after.priceText}`)
  say(`${label}：切档后行高仍 29.8px（±1.5）`, Math.abs(after.h - 29.8) <= 1.5 ? 'PASS' : 'FAIL', after.h)
}

/* ④ 商品档案「默认开单单位」——演示租户无该模块权限，只记录不判红 */
console.log('\n=== 商品档案 · 默认开单单位 ===')
await page.evaluate(() => { location.hash = '/archive/products' })
await sleep(2600)
const arch = await page.evaluate(() => ({
  label: (document.body.innerText || '').includes('默认开单单位'),
  selects: [...document.querySelectorAll('select')].filter((el) =>
    [...el.options].some((o) => /跟随档案单位/.test(o.textContent))).length,
}))
if (arch.label || arch.selects) {
  say('档案页「默认开单单位」+ 三个跟随档案单位选项',
    arch.label && arch.selects >= 3 ? 'PASS' : 'FAIL', arch)
} else {
  say('档案页「默认开单单位」', 'SKIP', '演示租户被重定向（无档案模块权限），已由契约组 ⑱ 覆盖')
}

const fail = rows.filter((r) => r.code === 'FAIL')
console.log('\n' + '-'.repeat(64))
console.log(`RESULT: ${rows.filter((r) => r.code === 'PASS').length} PASS / ${fail.length} FAIL / ${rows.filter((r) => r.code === 'SKIP').length} SKIP`)
fs.writeFileSync(new URL('./browser-v683.json', import.meta.url), JSON.stringify({ base: BASE, rows }, null, 2))
await b.close()
process.exit(fail.length === 0 ? 0 : 1)
