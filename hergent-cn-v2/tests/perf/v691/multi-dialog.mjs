/**
 * v691 多弹窗穷举探针（受控）
 * ==========================================================================
 * `all-pages.mjs` 每页只验**第一个**能打开的弹窗 —— 但 EmployeeArchive 一页有 5 个、
 * ConnectCenter 4 个、ReportMapping 4 个、RoleManage 3 个。只验第一个等于
 * 「5 个里验了 1 个还对外说这页过了」，不诚实。
 *
 * 本文件把每页**所有「新建 / 添加 / 创建 / 录入 / 开单」类**按钮逐个点开、逐个量。
 * 只点这一类是刻意收窄的：
 *   · 「新建」类按钮是幂等的（只打开空表单，不写库）
 *   · 「编辑 / 删除 / 结账 / 重算」类会改数据或依赖已有数据行 ⇒ 一律不点
 *     （探针误删生产数据是比漏验严重得多的事故）
 *
 * 判据与 all-pages.mjs 完全一致（A2 宽度 / A3 圆角 / A4 层级 / A5 遮罩 / A6 标题 /
 * A7 正文 / A9 浮层），输出「每页 × 每个弹窗」一张清单，任一 FAIL 即退出码 1。
 *
 * 用法：node tests/perf/v691/multi-dialog.mjs [BASE_URL]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://127.0.0.1:5173'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0
const findings = []
const say = (scope, label, v, extra) => {
  if (v === 'PASS') { pass++; return }
  fail++
  const msg = `❌ ${scope} · ${label}` + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : '')
  console.log('    ' + msg)
  findings.push(msg)
}

const MEASURE = () => {
  const vis = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(vis)
  if (!dialogs.length) return null
  const panel = dialogs.sort((a, b) =>
    (Number(getComputedStyle(b).zIndex) || 0) - (Number(getComputedStyle(a).zIndex) || 0))[0]
  const cs = getComputedStyle(panel)
  const box = panel.getBoundingClientRect()
  const z = Number(cs.zIndex) || 0
  let mask = null
  for (const el of document.querySelectorAll('div')) {
    if (el === panel || el.contains(panel) || !vis(el)) continue
    const s = getComputedStyle(el)
    if (s.position !== 'fixed') continue
    const r = el.getBoundingClientRect()
    if (r.width >= innerWidth - 2 && r.height >= innerHeight - 2) {
      const bg = s.backgroundColor
      if (bg && !/^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/.test(bg)) { mask = true; break }
    }
  }
  const floats = []
  for (const b of document.querySelectorAll('.tb-pop,.tb-pop-below')) {
    if (!vis(b)) continue
    if ((Number(getComputedStyle(b).zIndex) || 0) > z) floats.push(String(b.className))
  }
  return {
    w: Math.round(box.width), radius: cs.borderRadius, z, mask,
    title: (() => { const b = panel.querySelector('b,h3,h2'); return b ? (b.textContent || '').trim() : '' })(),
    textLen: (panel.innerText || '').trim().length,
    inputs: panel.querySelectorAll('input:not([type=hidden]),select,textarea').length,
    floats,
  }
}

/* 只收「新建」类按钮 —— 见文件头注释里为什么不扩大范围 */
const NEW_BTNS = () => {
  const vis = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  // 顶栏 / 页签条 / 侧边栏里也有「新建…」，那属于别页，必须排除
  const inNav = (el) => !!el.closest('.topbar,.tb-strip,.sb-item,.sb-area,.tabs,.ui-modal-card,[role=dialog]')
  const pat = /新\s*建|新\s*增|添\s*加|创\s*建|录\s*入|开\s*单/
  return [...document.querySelectorAll('button')]
    .filter((b) => vis(b) && !b.disabled && !inNav(b))
    .map((b) => (b.textContent || '').trim())
    .filter((t) => t && t.length <= 20 && pat.test(t))
    .filter((t, i, a) => a.indexOf(t) === i)
}

const clickByText = (txt) => {
  const vis = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const inNav = (el) => !!el.closest('.topbar,.tb-strip,.sb-item,.sb-area,.tabs,.ui-modal-card,[role=dialog]')
  const b = [...document.querySelectorAll('button')]
    .filter((x) => vis(x) && !x.disabled && !inNav(x) && (x.textContent || '').trim() === txt)[0]
  if (!b) return false
  b.click()
  return true
}

const forceClose = async (page) => {
  for (let i = 0; i < 4; i++) {
    if (!(await page.evaluate(MEASURE))) return
    await page.keyboard.press('Escape')
    await sleep(220)
  }
  if (await page.evaluate(MEASURE)) {
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role=dialog]')].pop()
      d?.querySelector('button[aria-label="关闭"]')?.click()
    })
    await sleep(250)
  }
}

const ensureLogin = async (page) => {
  if (await page.$('.topbar')) return false
  const demo = page.getByRole('button', { name: /先看看演示效果/ })
  await demo.first().waitFor({ timeout: 20000 })
  await demo.first().click()
  await page.waitForSelector('.topbar', { timeout: 30000 })
  return true
}

const ROUTES = [
  ['/archive/brands',    'BrandArchive'],
  ['/archive/suppliers', 'SupplierArchive'],
  ['/archive/customers', 'CustomerArchive'],
  ['/archive/warehouses','WarehouseArchive'],
  ['/archive/employees', 'EmployeeArchive'],
  ['/archive/prices',    'PriceChannels'],
  ['/mkt/promotions',    'Promotions'],
  ['/funds/receipt',     'FundsDoc'],
  ['/cron',              'CronJobs'],
  ['/roles',             'RoleManage'],
  ['/forecast',          'Forecast'],
  ['/wh/inbound',        'InboundList（WhDialog）'],
  ['/wh/outbound',       'OutboundList（WhDialog）'],
  ['/loss-accounting?tab=fill', 'LossAccounting'],
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
const page = await ctx.newPage()
let navSeq = 0
const table = []

try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  const demo = page.getByRole('button', { name: /先看看演示效果/ })
  await demo.first().waitFor({ timeout: 30000 })
  await demo.first().click()
  await page.waitForSelector('.topbar', { timeout: 30000 })
  await sleep(1200)

  for (const [route, name] of ROUTES) {
    navSeq += 1
    await page.goto(BASE + '/?__m=' + navSeq + '#' + route, { waitUntil: 'domcontentloaded' })
    await sleep(1500)
    if (await ensureLogin(page)) {
      navSeq += 1
      await page.goto(BASE + '/?__m=' + navSeq + '#' + route, { waitUntil: 'domcontentloaded' })
      await sleep(1500)
    }
    await sleep(2000)

    const btns = await page.evaluate(NEW_BTNS)
    const lgToken = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--radius-lg').trim())
    console.log(`\n━━━ ${route}   ${name}   新建类按钮 ${btns.length} 个：${JSON.stringify(btns)}`)

    for (const t of btns) {
      const clicked = await page.evaluate(clickByText, t)
      if (!clicked) continue
      await sleep(750)
      const m = await page.evaluate(MEASURE)
      if (!m) { await forceClose(page); continue }      // 该按钮不是弹窗触发器（跳转/展开）

      const scope = `${name}「${t}」`
      table.push({ page: name, by: t, title: m.title, w: m.w, z: m.z })
      console.log(`    · ${t} → 「${m.title}」 ${m.w}px  z=${m.z}  输入${m.inputs}  正文${m.textLen}字`)
      say(scope, 'A2 宽度在 380–1000', m.w >= 380 && m.w <= 1000 ? 'PASS' : 'FAIL', m.w)
      say(scope, 'A3 圆角 = --radius-lg', m.radius === lgToken ? 'PASS' : 'FAIL', { got: m.radius })
      say(scope, 'A4 层级 ≥ 1125', m.z >= 1125 ? 'PASS' : 'FAIL', m.z)
      say(scope, 'A5 有遮罩', m.mask ? 'PASS' : 'FAIL')
      say(scope, 'A6 标题非空', m.title ? 'PASS' : 'FAIL', m.title)
      say(scope, 'A7 正文 ≥ 10 字', m.textLen >= 10 ? 'PASS' : 'FAIL', m.textLen)
      say(scope, 'A9 无浮层压在弹窗上', m.floats.length === 0 ? 'PASS' : 'FAIL', m.floats)

      /* 关闭语义：刚打开没输入过 ⇒ ESC 应一次关掉（guardClose 不该误伤） */
      await page.keyboard.press('Escape')
      await sleep(420)
      const still = await page.evaluate(MEASURE)
      say(scope, 'A10 未输入时 ESC 一次能关', !still ? 'PASS' : 'FAIL', still ? still.title : '')
      await forceClose(page)
    }
  }
} catch (e) {
  fail++
  console.log('\n💥 探针异常：' + e.message)
}

console.log('\n══════════ 弹窗清单 ══════════')
for (const r of table) {
  console.log(`  ${r.page.padEnd(22)} 「${r.by}」 → 「${r.title}」 ${String(r.w).padStart(4)}px  z=${r.z}`)
}
console.log(`\n共量到 ${table.length} 个弹窗｜PASS ${pass} / FAIL ${fail}`)
if (findings.length) { console.log('\n失败项：'); findings.forEach((f) => console.log('  ' + f)) }

await browser.close()
process.exit(fail ? 1 : 0)
