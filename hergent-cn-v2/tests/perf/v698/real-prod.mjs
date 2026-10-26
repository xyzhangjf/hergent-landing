/**
 * v698：线上**真实**页面验收（不 mock）。
 *
 * 🔴 v697 的教训：上一批截图是用 route 拦截喂进去的假数据，全绿，
 *    但老板打开线上说「看不到入口」—— 因为生产真实状态值是 `confirmed`
 *    而不是我在 mock 里写的 `approved`，而 `received_amount` 历史单全是 0。
 *    ⇒ 本脚本**不拦截任何接口**，用老板真实会话直接开真实单据。
 *
 * 判据只用**用户可见字面量**（按钮文字），不用符号名（minify 后会改名）。
 */
import { chromium } from 'playwright'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN || ''
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

if (!TOKEN) {
  console.error('缺少 HG_TOKEN')
  process.exit(2)
}

let PASS = 0
let FAIL = 0
function ck(name, ok, detail = '') {
  if (ok) { PASS++; console.log('  ✅ ' + name) }
  else { FAIL++; console.log('  ❌ ' + name + '  ' + detail) }
}

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
})
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
})
/* 两个 cookie 缺一不可：
     erp_token    = 真凭证（httpOnly，后端 Set-Cookie 下发，JS 读不到）
     hergent_auth = '1' 标记 cookie（非 httpOnly，只表达「浏览器里有会话」）
   🔴 踩过的坑：只注 erp_token ⇒ 路由守卫 `auth.hasSession` 读的是 `hergent_auth`，
      恒 false ⇒ 直接跳回登录页，看起来像「部署没生效」。 */
await ctx.addCookies([
  { name: 'erp_token', value: TOKEN, url: 'https://hergent.cn/' },
  { name: 'hergent_auth', value: '1', url: 'https://hergent.cn/' },
])
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

async function openOrder(oid, tab) {
  await page.goto(`${BASE}/#/inventory/purchase/${oid}`, { waitUntil: 'domcontentloaded' })
  await sleep(3500)
  // 登录态自检：停在登录页就说明 cookie 没生效
  const isLogin = await page.locator('text=先看演示效果').count()
  if (isLogin) {
    console.log('  🛑 仍在登录页 —— cookie 未生效')
  }
  // tab 用可见文本点（tab 类名会随重构变，文本是用户看得见的，稳定）
  const tabBtn = page.getByText(tab, { exact: true }).first()
  if (await tabBtn.count()) {
    await tabBtn.click()
    await sleep(1800)
  }
  return page
}

async function shot(name, sel) {
  const el = sel ? page.locator(sel).first() : page
  if (sel && !(await el.count())) {
    console.log(`  ⚠️  截图目标 ${sel} 不存在，整页截图`)
    await page.screenshot({ path: `outputs/v698-真实线上/${name}.png`, fullPage: false })
    return
  }
  await (sel ? el : page).screenshot({ path: `outputs/v698-真实线上/${name}.png` })
}

// ── 1. 178（confirmed，已审待执行）→ 应出现「预付款」
console.log('\n[1] 单 178（生产真实状态 confirmed）→ 预付款入口')
await openOrder(178, '货款')
const t178 = (await page.locator('.ipd-pay').first().innerText().catch(() => '')).replace(/\s+/g, '')
console.log('  货款页片段：' + t178.slice(0, 200))
ck('178 出现「预付款」按钮', /预付款/.test(t178), t178.slice(0, 120))
await shot('1-真实-178预付款', '.ipd-pay')

// ── 2. 179（confirmed）
console.log('\n[2] 单 179（confirmed）→ 预付款入口')
await openOrder(179, '货款')
const t179 = (await page.locator('.ipd-pay').first().innerText().catch(() => '')).replace(/\s+/g, '')
ck('179 出现「预付款」按钮', /预付款/.test(t179), t179.slice(0, 120))

// ── 3. 11（received 老单，received_amount=0）→ 应出现「付款」
console.log('\n[3] 单 11（received 老单，入库金额历史未回填）→ 付款入口')
await openOrder(11, '货款')
const t11 = (await page.locator('.ipd-pay').first().innerText().catch(() => '')).replace(/\s+/g, '')
console.log('  货款页片段：' + t11.slice(0, 200))
ck('11 出现「付款」按钮', /付款/.test(t11), t11.slice(0, 120))
ck('11 入库金额已兜底（不是 ¥0.00）', !/入库金额¥0\.00/.test(t11), t11.slice(0, 160))
await shot('2-真实-11付款', '.ipd-pay')

// ── 4. 178 入库单 tab → 应有入库操作条
console.log('\n[4] 单 178 入库单 tab → 入库操作条')
await openOrder(178, '入库单')
const inbAct = await page.locator('.ipd-inb-act').first().innerText().catch(() => '')
const inbTxt = String(inbAct).replace(/\s+/g, '')
console.log('  入库单片段：' + inbTxt.slice(0, 200))
ck('178 入库单 tab 有操作条', inbTxt.length > 0, '(空)')
ck('178 出现「确认入库」按钮', /确认入库/.test(inbTxt), inbTxt.slice(0, 160))
await shot('3-真实-178入库操作条', '.ipd-inb-act')

console.log('\n页面错误：' + (errors.length ? errors.join(' | ') : '无'))
console.log('\n' + '='.repeat(62))
console.log(`通过 ${PASS} / 失败 ${FAIL}`)
console.log('='.repeat(62))

await browser.close()
process.exit(FAIL ? 1 : 0)
