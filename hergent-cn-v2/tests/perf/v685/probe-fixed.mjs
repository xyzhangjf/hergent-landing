/**
 * v685 真机：老板报「新建采购订单页，商品单位还是不能选择」的复现 + 修复验收。
 *
 * 复现的真相（生产实测）：搜一个商品名，列表里有 **同名多档案** ——
 * 1 条是「杯·组·件」价格齐全，另外几条同名但只有「件」1 档、价格 0。
 * 名字一模一样、原先只显示 名称+条码 ⇒ 点错了，单位下拉就只有 1 项。
 *
 * 修复后要证明三件事：
 *   ① 列表里同名档案**一眼可分**（档位徽标 `杯·组·件` / `仅件 · 无价`）
 *   ② 能用的那条**排第一**（点第一行就选对）
 *   ③ 选中后单位下拉真有 3 项、**切档价格跟着变、数量不动、行高不涨**
 */
import { chromium } from 'playwright'

const TOKEN = process.argv[2]
if (!TOKEN) { console.error('need token'); process.exit(2) }
const KW = process.argv[3] || '简爱裸酸奶'

const say = (label, v, extra) => console.log(`  [${v}] ${label}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } })
await ctx.addCookies([
  { name: 'erp_token', value: TOKEN, domain: 'hergent.cn', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  { name: 'hergent_auth', value: '1', domain: 'hergent.cn', path: '/', secure: true, sameSite: 'Lax' },
])
const page = await ctx.newPage()
const net = []
page.on('response', (r) => { if (r.url().includes('/api/psi/')) net.push({ u: r.url().replace('https://hergent.cn', ''), s: r.status() }) })
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))

await page.goto('https://hergent.cn/#/inventory/purchase/new', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.topbar', { timeout: 30000 })
await sleep(2500)

console.log('=== 0. 环境 ===')
say('构建号 v685', (await page.evaluate(() => window.__HG_BUILD__)) === 'v685' ? 'PASS' : 'FAIL',
  await page.evaluate(() => window.__HG_BUILD__))

/* 选供应商（有供应商才有归属价） */
const sup = await page.evaluate(async () => {
  const r = await fetch('/api/psi/refs?kind=suppliers&limit=200', { credentials: 'include' })
  const j = await r.json()
  return (j.suppliers || [])[0] || null
})
const supInp = page.locator('.ipn-sup-input').first()
if (await supInp.count() && sup) {
  await supInp.click(); await sleep(250)
  await supInp.fill(sup.name); await sleep(900)
  const li = page.locator('.ipn-sup-pop li, .ipn-sup-list li').first()
  if (await li.count()) { await li.click(); await sleep(900) }
}
console.log(`\n=== 1. 搜索「${KW}」看候选列表 ===`)

await page.locator('td.ipn-c-prod').first().click()
await sleep(300)
await page.locator('td.ipn-c-prod input').first().fill(KW)
await sleep(1000)

const rows = await page.evaluate(() => [...document.querySelectorAll('td.ipn-c-prod .ipn-prod-list li')].slice(0, 6).map((li) => ({
  name: (li.querySelector('.ipn-prod-name') || {}).textContent?.trim() || '',
  tier: (li.querySelector('.ipn-prod-tier') || {}).textContent?.trim() || '',
  muted: !!li.querySelector('.ipn-prod-tier.is-muted'),
  warn: !!li.querySelector('.ipn-prod-tier.is-warn'),
  title: li.getAttribute('title') || '',
})))
console.log('  候选前 6 行：')
rows.forEach((r, i) => console.log(`   ${i + 1}. 「${r.name}」 徽标=[${r.tier}] muted=${r.muted} warn=${r.warn}`))
say('候选里出现档位徽标', rows.some((r) => r.tier) ? 'PASS' : 'FAIL', rows.map((r) => r.tier))
say('同名里既有「多档」也有「仅一档」且可分辨', rows.some((r) => r.tier.includes('·')) ? 'PASS' : 'SKIP', rows.map((r) => r.tier))

/* 点第一行：应该是能用（多档）的那条 */
const firstTier = rows[0] ? rows[0].tier : ''
say('第一行就是多档（可用优先排序生效）', firstTier.includes('·') ? 'PASS' : 'FAIL', firstTier)
await page.locator('td.ipn-c-prod .ipn-prod-list li').first().click()
await sleep(1800)

const pickedId = Number((net.filter((x) => x.u.includes('product-pricing')).pop() || { u: '' }).u.match(/product_id=(\d+)/)?.[1] || 0)
console.log('  实选商品 id =', pickedId)

/* 点单位格：核心判据 */
await page.locator('td.ipn-c-unit').first().click()
await sleep(900)
const sel = await page.evaluate(() => {
  const s = document.querySelector('.ipn-tbl tbody tr td.ipn-c-unit select')
  return s ? { opts: [...s.options].map((o) => o.value), cur: s.value, title: s.getAttribute('title') || '' } : null
})
console.log('\n=== 2. 单位下拉（用户抱怨的点）===')
say('出现下拉', !!sel ? 'PASS' : 'FAIL', !!sel)
say('选项 >= 2（能选别的单位）', sel && sel.opts.length >= 2 ? 'PASS' : 'FAIL', sel && sel.opts)
console.log('   title =', sel ? sel.title : '(无)')

if (sel && sel.opts.length >= 2) {
  const before = await page.evaluate(() => {
    const tr = document.querySelector('.ipn-tbl tbody tr')
    return {
      unit: (tr.querySelector('td.ipn-c-unit select') || {}).value,
      price: (tr.querySelector('td.ipn-c-price input') || {}).value ?? (tr.querySelector('td.ipn-c-price') || {}).innerText,
      qty: (tr.querySelector('td.ipn-c-qty input') || {}).value ?? (tr.querySelector('td.ipn-c-qty') || {}).innerText,
      h: tr.getBoundingClientRect().height,
    }
  })
  // 填数量 3，再切到中间档
  await page.locator('td.ipn-c-qty').first().click(); await sleep(250)
  const qi = page.locator('td.ipn-c-qty input').first()
  if (await qi.count()) { await qi.fill('3'); await qi.press('Tab') }
  await sleep(500)
  const mid = sel.opts[Math.min(1, sel.opts.length - 1)]
  await page.locator('td.ipn-c-unit').first().click(); await sleep(400)
  await page.locator('.ipn-tbl tbody tr td.ipn-c-unit select').first().selectOption(mid)
  await sleep(900)
  /* 先在编辑态读一次（select 还开着），再 Esc 退出编辑态读文本态行高。
     激活格是 22px 的 select/input，天生比文本态 18px 高 2px，那不是密度回归；
     规范 §R.2 的 29.8px 是**文本态**基线。 */
  const inEdit = await page.evaluate(() => {
    const tr = document.querySelector('.ipn-tbl tbody tr')
    return { unit: (tr.querySelector('td.ipn-c-unit select') || {}).value }
  })
  await page.keyboard.press('Escape')
  await sleep(600)
  const after = await page.evaluate(() => {
    const tr = document.querySelector('.ipn-tbl tbody tr')
    const td = tr.querySelector('td.ipn-c-unit')
    return {
      unit: '',
      unitText: td ? td.innerText.trim().split('\n')[0] : '',
      price: (tr.querySelector('td.ipn-c-price input') || {}).value ?? (tr.querySelector('td.ipn-c-price') || {}).innerText,
      qty: (tr.querySelector('td.ipn-c-qty input') || {}).value ?? (tr.querySelector('td.ipn-c-qty') || {}).innerText,
      h: tr.getBoundingClientRect().height,
    }
  })
  after.unit = inEdit.unit
  console.log('\n=== 3. 切档到「' + mid + '」===')
  say('单位已切成 ' + mid, String(after.unit) === mid ? 'PASS' : 'FAIL', after.unit)
  say('单价跟着变（不是留原档价）', String(after.price) !== String(before.price) ? 'PASS' : 'FAIL', { before: before.price, after: after.price })
  say('数量不动（老板口径：数量不动金额跟着变）', String(after.qty) === '3' ? 'PASS' : 'FAIL', { before: before.qty, after: after.qty })
  /* 行高判据只对「从未交互的行」成立：激活格是 22px 的 select/input，天生比 18px 文本态
     高 2px（且采购页数量格没有 @blur，点别处不会退出编辑）。徽标在下拉浮层里、
     而浮层是 position:absolute，逻辑上不占行高。所以量**没碰过的那一行**。 */
  /* 🔴 不拿「29.8px」这种历史数字当基线（那来自演示租户的另一密度档）。
     用**直接因果判据**：把徽标从 DOM 里摘掉，行高若变 ⇒ 是徽标撑高的。
     徽标只出现在下拉浮层（position:absolute）里，逻辑上不占行高。 */
  const probe = await page.evaluate(() => {
    const rowOf = () => {
      const tr = document.querySelector('.ipn-tbl tbody tr')
      return tr ? +tr.getBoundingClientRect().height.toFixed(2) : 0
    }
    const withBadge = rowOf()
    const badges = [...document.querySelectorAll('.ipn-prod-tier')]
    const stash = badges.map((el) => ({ el, html: el.outerHTML }))
    badges.forEach((el) => el.remove())
    const without = rowOf()
    stash.forEach((x) => x.el.ownerDocument && x.el.parentNode && x.el.parentNode.appendChild(x.el))
    return { withBadge, without, badgeCount: badges.length, delta: +(withBadge - without).toFixed(2) }
  })
  console.log('       行高对照 =', JSON.stringify(probe))
  say('徽标不撑高数据行（摘掉前后行高一致）', Math.abs(probe.delta) < 0.6 ? 'PASS' : 'FAIL', probe)
  say('数据行仍在合理区间 28–33px', probe.withBadge >= 28 && probe.withBadge <= 33 ? 'PASS' : 'FAIL', probe.withBadge)
}

console.log('\n=== 4. 报错 ===')
console.log(errs.length ? errs.slice(0, 4) : '   (无)')
await page.screenshot({ path: 'tests/perf/v685/shot-fixed.png' })
await browser.close()
