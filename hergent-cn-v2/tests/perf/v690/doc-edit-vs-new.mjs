/**
 * v690 补充探针：单据「新增建单页」 vs 「详情页内联编辑」的控件规格对比（只读）
 * ==========================================================================
 * 采购单有两个编辑入口：
 *   ① 列表/详情的「编辑」→ /inventory/purchase/new?edit=id  ← 与新增同一页
 *   ② 详情页的「铅笔」→ startEdit() 在信息带里**内联**改 6 个表头字段
 * 第 ② 条是独立的一套控件，与建单页不是同一套样式。本探针量它。
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const b = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } })
const page = await ctx.newPage()

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
const d = page.getByRole('button', { name: /先看看演示效果/ })
await d.first().waitFor({ timeout: 25000 }); await d.first().click()
await page.waitForSelector('.topbar', { timeout: 30000 }); await sleep(1500)

/** 量一组控件的可见规格 */
const probe = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return null
  const cs = getComputedStyle(el)
  const r = el.getBoundingClientRect()
  return {
    h: Math.round(r.height), w: Math.round(r.width),
    radius: cs.borderRadius, border: cs.borderColor, borderW: cs.borderWidth,
    fs: cs.fontSize, pad: cs.padding, bg: cs.backgroundColor,
  }
}, sel)

console.log('=== A. 新增建单页的表头控件 ===')
await page.evaluate(() => { location.hash = '/inventory/purchase/new' })
await sleep(4000)
const addSel = await probe('.ipn-sel')
const addLb = await probe('.ipn-lb')
console.log('  下拉 .ipn-sel :', JSON.stringify(addSel))
console.log('  标签 .ipn-lb  :', JSON.stringify(addLb))

console.log('\n=== B. 详情页内联编辑的控件 ===')
await page.evaluate(() => { location.hash = '/inventory/purchases' })
await sleep(3500)
// 打开第一张单
const opened = await page.evaluate(() => {
  const tr = document.querySelector('tbody tr')
  if (!tr) return false
  const link = tr.querySelector('a, .psi-link, [class*="link"]')
  if (link) { link.click(); return true }
  const td = tr.querySelector('td')
  if (td) { td.click(); return true }
  return false
})
await sleep(3000)
let hash = await page.evaluate(() => location.hash)
console.log('  当前路由:', hash)

// 找铅笔（编辑表头）
const pencil = await page.evaluate(() => {
  const b2 = [...document.querySelectorAll('button')].find((x) => /编辑表头字段/.test(x.getAttribute('title') || ''))
  if (!b2) return false
  b2.click()
  return true
})
await sleep(1200)
if (!pencil) {
  console.log('  ⏭️  没有铅笔按钮（单子不处于可编辑状态）—— 跳过')
} else {
  for (const s of ['.ipd-edit-sel', '.ipd-edit-in', '.ipd-edit-in-sm', '.ipd-lb']) {
    console.log(`  ${s.padEnd(16)}:`, JSON.stringify(await probe(s)))
  }
}

console.log('\n=== C. 结论对照 ===')
console.log('  建单页 .ipn-sel  高', addSel && addSel.h, '圆角', addSel && addSel.radius, '边框', addSel && addSel.border)
await b.close()
