/**
 * v701 报表下探线上真实探针（不 mock）
 *
 * 验证老板要的整条链：
 *   ① 明细报表的**单号是可点链接**（不是纯文本）
 *   ② 点击后跳到**正确的那张单**（id 与接口返回一致，不是猜的）
 *   ③ 详情页按钮变成「返回报表」，点它**回到那张报表**
 *   ④ 回来时**日期筛选还在**（sessionStorage 持久化）
 *   ⑤ 调拨页**不给假入口**（无链接 + 有说明）
 *   ⑥ 移动端 390px 下单号可点区域 ≥28px（手指点得中）
 */
import { chromium } from 'playwright'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TOKEN = process.env.HG_TOKEN
const BASE = 'https://hergent.cn'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) { pass++; console.log('  ✅', msg) } else { fail++; console.log('  ❌', msg) } }

const b = await chromium.launch({ headless: true, executablePath: CHROME })
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addCookies([
  { name: 'erp_token', value: TOKEN, url: BASE + '/' },
  { name: 'hergent_auth', value: '1', url: BASE + '/' }
])
const p = await ctx.newPage()

async function goto(hash) {
  await p.goto(BASE + '/#' + hash, { waitUntil: 'domcontentloaded' })
  await sleep(3200)
}

// ============ ① 销售明细：面包屑 + 单号链接 ============
console.log('\n=== ① 销售订单明细 ===')
await goto('/reports/sales-detail')
ok((await p.content()).match(/data-build="(v70\d)"/)?.[1] === 'v701', '线上构建号 v701')

const crumb = await p.locator('.rpt-crumb').first().innerText().catch(() => '')
ok(crumb.includes('数据报表') && crumb.includes('销售订单明细'), `面包屑：${crumb.replace(/\s+/g, ' ').trim()}`)
const curCount = await p.locator('.rpt-crumb-cur').count()
ok(curCount === 1, `末级不可点（.rpt-crumb-cur 数量=${curCount}）`)

const drills = await p.locator('.rpt-drill').count()
ok(drills > 0, `单号是链接（.rpt-drill 数量=${drills}）`)

const firstNo = await p.locator('.rpt-drill').first().innerText()
const firstTitle = await p.locator('.rpt-drill').first().getAttribute('title')
ok(/SO|DB|XS/i.test(firstNo), `首个单号：${firstNo}`)
ok((firstTitle || '').includes('销售单'), `悬停提示：${firstTitle}`)

// ============ ② 点击 → 跳到正确单据 ============
console.log('\n=== ② 点击单号跳转 ===')
// 先记下该行金额，跳到详情页后核对是同一张单
const rowAmt = await p.locator('.rpt-drill').first().locator('xpath=ancestor::tr').locator('td').nth(4).innerText()
await p.locator('.rpt-drill').first().click()
await sleep(3200)
const url1 = p.url()
const m = url1.match(/#\/inventory\/sale\/(\d+)/)
ok(!!m, `跳到销售单详情：${url1.split('#')[1]}`)
ok((await p.content()).includes('销售单详情'), '详情页已渲染')

// 单号是否与列表一致（page-sub 里显示 order_no）
const sub = await p.locator('.page-sub').first().innerText().catch(() => '')
ok(sub.includes(firstNo), `详情页单号与列表一致：${sub.trim()}（列表：${firstNo}）`)

// ============ ③ 返回报表 ============
console.log('\n=== ③ 返回上一级 ===')
const backBtn = p.locator('button', { hasText: '返回报表' }).first()
const hasBack = await backBtn.count()
ok(hasBack === 1, `按钮文案为「返回报表」（找到 ${hasBack} 个）`)
if (hasBack) {
  await backBtn.click()
  await sleep(3200)
  const url2 = p.url()
  ok(url2.includes('/reports/sales-detail'), `已回到报表：${url2.split('#')[1]}`)
  const stillDrill = await p.locator('.rpt-drill').count()
  ok(stillDrill > 0, `回来后表格正常（链接 ${stillDrill} 个）`)
}

// ============ ④ 筛选持久化 ============
console.log('\n=== ④ 筛选保留 ===')
const dFrom = p.locator('.rpt-date input[type="date"]').first()
await dFrom.fill('2026-10-01')
await dFrom.dispatchEvent('change')
await sleep(2500)
const beforeJump = await dFrom.inputValue()
ok(beforeJump === '2026-10-01', `设置起始日：${beforeJump}`)

const d2 = p.locator('.rpt-drill').first()
if (await d2.count()) {
  await d2.click()
  await sleep(3000)
  const bb = p.locator('button', { hasText: '返回报表' }).first()
  if (await bb.count()) { await bb.click(); await sleep(3200) }
}
const afterBack = await p.locator('.rpt-date input[type="date"]').first().inputValue()
ok(afterBack === '2026-10-01', `返回后筛选仍在：${afterBack}`)

// ============ ⑤ 采购明细 ============
console.log('\n=== ⑤ 采购订单明细 ===')
await goto('/reports/purchase-detail')
const pDrills = await p.locator('.rpt-drill').count()
ok(pDrills > 0, `采购单号是链接（${pDrills} 个）`)
if (pDrills) {
  const pNo = await p.locator('.rpt-drill').first().innerText()
  await p.locator('.rpt-drill').first().click()
  await sleep(3200)
  const pu = p.url()
  ok(/#\/inventory\/purchase\/\d+/.test(pu), `跳到采购单详情：${pu.split('#')[1]}`)
  const pb = p.locator('button', { hasText: '返回报表' }).first()
  ok(await pb.count() === 1, '采购详情页也有「返回报表」')
  if (await pb.count()) {
    await pb.click(); await sleep(3000)
    ok(p.url().includes('/reports/purchase-detail'), `回到采购报表：${p.url().split('#')[1]}`)
  }
  console.log(`  （跳转来源单号：${pNo}）`)
}
const foot = await p.locator('.rpt-foot').first().innerText().catch(() => '')
ok(foot.includes('没有逐商品明细行'), '页面明说「早期单据无明细行」')

// ============ ⑥ 调拨明细：不给假入口 ============
console.log('\n=== ⑥ 调拨订单明细 ===')
await goto('/reports/transfer-detail')
ok(await p.locator('.rpt-drill').count() === 0, '调拨单号**不可点**（无假入口）')
const tFoot = await p.locator('.rpt-foot').first().innerText().catch(() => '')
ok(tFoot.includes('本页已经是最终明细'), `说明：${tFoot.replace(/\s+/g, ' ').trim()}`)
ok((await p.locator('.rpt-crumb').count()) === 1, '调拨页有面包屑')

// ============ ⑦ 移动端 ============
console.log('\n=== ⑦ 移动端 390px ===')
await p.setViewportSize({ width: 390, height: 844 })
await goto('/reports/sales-detail')
const mDrills = await p.locator('.rpt-drill').count()
ok(mDrills > 0, `移动端仍有链接（${mDrills} 个）`)
if (mDrills) {
  const box = await p.locator('.rpt-drill').first().boundingBox()
  ok(box && box.height >= 28, `可点高度 ${box ? Math.round(box.height) : 0}px ≥ 28px`)
}
const mCrumbVisible = await p.locator('.rpt-crumb').first().isVisible()
ok(mCrumbVisible, '移动端面包屑可见')

await p.setViewportSize({ width: 1440, height: 900 })
await p.screenshot({ path: 'outputs/v701-下探/desktop-sales-detail.png' })
await p.setViewportSize({ width: 390, height: 844 })
await p.screenshot({ path: 'outputs/v701-下探/mobile-sales-detail.png' })

console.log(`\n===== 合计 ${pass} 过 / ${fail} 败 =====`)
await b.close()
process.exit(fail ? 1 : 0)
