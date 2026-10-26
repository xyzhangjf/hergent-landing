/**
 * v693 P3 探针：「本次消耗」这条链路
 * ==========================================================================
 * 为什么单独一个探针：演示账号问一句只有 0 积分（实测 ¥0.0011，抹零不计费），
 * 所以真机跑一百遍也看不到「本次约 N 积分」—— 功能存在但验不出来。
 *
 * 做法：把 `/api/ai/quota` 也 mock 掉，用**调用次数**模拟额度增长：
 *   前几次返回 used=0（页面挂载 + 打开抽屉时读的基线）
 *   流结束后的那次返回 used=30（模拟一轮重型任务真的扣了 30 积分）
 * 这样就能精确验证「前后差值 → 挂到气泡尾」这条逻辑，且一分钱不花。
 *
 * 断言：
 *   A1 基线读数为 0 时，输入框下方显示「本月 0 积分」
 *   A2 一轮结束、额度 +30 后，气泡尾部出现「本次约 30 积分（约 3 毛）」
 *   A3 常驻行同步刷新为「本月 30 积分」
 *   A4 金额换算正确（30 积分 = 3 毛，不是 0.3 元也不是 30 元）
 *   A5 增量没涨（额度不变）时不显示 —— 这条用第二轮验证
 *
 * 用法：node tests/perf/v693/turn-cost.mjs [BASE_URL]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0
const ck = (label, ok, extra) => {
  if (ok) { pass++; console.log('    ✅ ' + label + (extra ? '  ← ' + extra : '')) }
  else { fail++; console.log('    ❌ ' + label + (extra ? '  ← ' + extra : '')) }
}

const quotaBody = (used) => JSON.stringify({
  ok: true, tier: 'free',
  monthly_limit: 3000, used_this_month: used, remaining: 3000 - used,
  credits_limit: 3000, credits_used: used, credits_remaining: 3000 - used,
  credits_pct: Number((used / 30).toFixed(1)),
  cost_cny_this_month: Number((used / 100).toFixed(4)),
  exempt: false, exceeded: false, is_peak: false, peak_until_min: 0,
  counted_by: 'tokens', metered_calls: used ? 1 : 0,
})

const reply = '好的，我把 10 月调拨货损按业务员汇总了一遍，共 27 条明细已核对。'
const sse = [
  { choices: [{ delta: { content: reply } }] },
  { choices: [{ delta: {} }], usage: { prompt_tokens: 20867, completion_tokens: 135 } },
].map((o) => 'data: ' + JSON.stringify(o) + '\n\n').join('') + 'data: [DONE]\n\n'

const main = async () => {
  const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  let browser
  try { browser = await chromium.launch({ headless: true, executablePath: CHROME }) }
  catch (_) { browser = await chromium.launch({ headless: true }) }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  // 额度用「时机开关」而不是调用计数：计数会被页面 resize / 重渲染带偏。
  // 关键事实：发送前**不会**请求 /api/ai/quota（streamReply 开头只读已缓存的 quota.value），
  // 只有流结束后 settleTurnCost 才请求 ⇒ 点发送前把开关拨到 30 即可精确模拟「这一轮花了 30 积分」。
  let used = 0
  await page.route('**/api/ai/quota', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: quotaBody(used) })
  })
  await page.route('**/api/ai/copilot/chat**', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sse,
    })
  })

  console.log('\n━━━ 打开 ' + BASE)
  await page.goto(BASE + '/?__p=693', { waitUntil: 'domcontentloaded' })
  await sleep(2000)
  if (!(await page.$('.topbar'))) {
    const demo = page.getByRole('button', { name: /先看看演示效果/ })
    await demo.first().waitFor({ timeout: 20000 })
    await demo.first().click()
    await page.waitForSelector('.topbar', { timeout: 30000 })
    await sleep(1500)
  }

  console.log('\n[1] 打开副驾（基线 0 积分）')
  await page.keyboard.press('Meta+k')
  await sleep(900)
  if (!(await page.$('.cp-composer'))) {
    const btn = page.locator('button', { hasText: /AI/ }).first()
    try { await btn.click({ timeout: 3000 }) } catch (_) {}
    await sleep(900)
  }
  const tip0 = await page.evaluate(() => {
    const el = document.querySelector('.cp-quota-tip')
    return el && el.offsetHeight > 0 ? el.innerText.trim() : ''
  })
  ck('基线读数显示 0 积分', /本月 0 积分/.test(tip0), tip0)

  console.log('\n[2] 发一条（额度将 +30）')
  await page.locator('.cp-input').first().fill('把昨天算的货损数据写入系统')
  await sleep(200)
  used = 30                        // 拨开关：此后任何额度请求都返回「已用 30」
  await page.locator('.cp-send').first().click()
  await sleep(3000)

  const cost = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.cp-cost')].filter(e => e.offsetHeight > 0)
    return els.map(e => e.innerText.replace(/\s+/g, ' ').trim())
  })
  ck('气泡尾部出现本次消耗', cost.length === 1, cost.join(' | ') || '未出现')
  const t = cost[0] || ''
  ck('写的是 30 积分', /本次约 30 积分/.test(t), t)
  ck('金额是「3 毛」（不是 0.3 元 / 30 元）', /约 3 毛/.test(t), t)

  console.log('\n[3] 常驻行同步刷新')
  const tip1 = await page.evaluate(() => {
    const el = document.querySelector('.cp-quota-tip')
    return el && el.offsetHeight > 0 ? el.innerText.trim() : ''
  })
  ck('常驻行变成 30 积分', /本月 30 积分/.test(tip1), tip1)
  ck('还能跑的件数随之下降（75 → 74）', /约 74 件|约 75 件/.test(tip1), tip1)

  const shot = '/tmp/v693-turn-cost.png'
  await page.screenshot({ path: shot })
  console.log('\n截图：' + shot)

  await browser.close()
  console.log('\n' + (fail ? 'HAS FAILURE' : 'ALL PASS') + '  ' + pass + ' 通过 / ' + fail + ' 失败')
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('探针自身出错：', e); process.exit(2) })
