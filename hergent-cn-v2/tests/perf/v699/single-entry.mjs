/**
 * v699：验「分批到货 / 确认入库」在每个页签下**只有一个**入口（不重复）。
 *
 * 病历：v697 在「入库单」页签内加了操作条，但顶部动作区那两个按钮没做互斥
 * ⇒ 同屏两套「分批到货 / 确认入库」，老板第一反应是「哪个才是真的」。
 *
 * 判据（全部用用户可见字面量）：
 *   detail   页签 → 「确认入库」按钮 = 1（顶部），入库单操作条 = 0
 *   inbound  页签 → 「确认入库」按钮 = 1（页内操作条），顶部动作区不含它
 *   payments 页签 → 「确认入库」按钮 = 1（顶部，回到常规）
 */
import { chromium } from 'playwright'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN || ''
const OID = process.env.HG_OID || '178'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

if (!TOKEN) { console.error('缺少 HG_TOKEN'); process.exit(2) }

let PASS = 0
let FAIL = 0
function ck(name, ok, detail = '') {
  if (ok) { PASS++; console.log('  ✅ ' + name) }
  else { FAIL++; console.log('  ❌ ' + name + '  ' + detail) }
}

const browser = await chromium.launch({ headless: true, executablePath: CHROME })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
await ctx.addCookies([
  { name: 'erp_token', value: TOKEN, url: 'https://hergent.cn/' },
  { name: 'hergent_auth', value: '1', url: 'https://hergent.cn/' },
])
const page = await ctx.newPage()

async function goto(tabKey) {
  const url = tabKey === 'detail'
    ? `${BASE}/#/inventory/purchase/${OID}`
    : `${BASE}/#/inventory/purchase/${OID}?tab=${tabKey}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await sleep(3500)
}

/** 整页里文字为「确认入库」的按钮数量（minify 无所谓，文本是可见的） */
async function cnt(text) {
  return await page.getByRole('button', { name: new RegExp('^' + text + '$') }).count()
}

for (const tabKey of ['detail', 'payments', 'inbound']) {
  console.log(`\n[${tabKey}] 页签`)
  await goto(tabKey)
  const confirmN = await cnt('确认入库')
  const partialN = await cnt('分批到货')
  const actN = await page.locator('.ipd-inb-act').count()
  const topN = await page.locator('.ipd-acts button', { hasText: '确认入库' }).count()

  console.log(`  整页「确认入库」=${confirmN}  「分批到货」=${partialN}  入库操作条=${actN}  顶部动作区含确认入库=${topN}`)

  ck(`${tabKey}：「确认入库」只有 1 个`, confirmN === 1, `实际 ${confirmN}`)
  ck(`${tabKey}：「分批到货」只有 1 个`, partialN === 1, `实际 ${partialN}`)

  if (tabKey === 'inbound') {
    ck('inbound：操作条存在且为 1', actN === 1, `实际 ${actN}`)
    ck('inbound：顶部动作区不再有确认入库', topN === 0, `实际 ${topN}`)
    await page.locator('.ipd-inb-act').screenshot({ path: 'outputs/v699-单入口/inbound-操作条.png' })
  } else {
    ck(`${tabKey}：没有入库操作条`, actN === 0, `实际 ${actN}`)
    ck(`${tabKey}：顶部动作区有确认入库`, topN === 1, `实际 ${topN}`)
  }
}

// inbound 页签整页截图：老板肉眼能直接确认「上面那排没有重复按钮」
await goto('inbound')
await page.screenshot({ path: 'outputs/v699-单入口/inbound-整页.png' })
await goto('detail')
await page.screenshot({ path: 'outputs/v699-单入口/detail-整页.png' })

console.log('\n' + '='.repeat(62))
console.log(`通过 ${PASS} / 失败 ${FAIL}`)
console.log('='.repeat(62))
await browser.close()
process.exit(FAIL ? 1 : 0)
