/**
 * v693 P4 探针：执行计划卡片的「预计消耗」—— 用接口 mock 稳定触发
 * ==========================================================================
 * 为什么必须做运行时验证：这条功能的意义就是「花钱之前让你看见」。
 * 只验构建产物里有那串字，证明不了它在正确的位置、也没证明按钮没被锁死。
 *
 * 做法：拦截 `/api/ai/copilot/chat`，回一段带 ```proposal 围栏的假 SSE，
 * AI 就会"产出"一个 15 步执行计划。真实 AI 也能产出，但演示账号无法稳定触发，
 * 探针不能依赖模型脾气。
 *
 * 断言：
 *   A1 执行计划卡片出现（说明 mock 生效、围栏解析通）
 *   A2 卡片上有 `.cp-prop-cost`，且写明步数、积分、金额
 *   A3 文案含「执行后才计费」—— 明确「还没扣钱」
 *   A4 「执行计划」按钮**没有** disabled —— 只提醒不拦截（这是纪律，不是偏好）
 *   A5 高峰时段要出现「只要一半」的省钱提示
 *   A6 本轮额度没变化 ⇒ 气泡上**不显示**「本次约 N 积分」（轻问答/模拟不计费）
 *
 * 用法：node tests/perf/v693/plan-cost.mjs [BASE_URL]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0, skip = 0
const ck = (label, ok, extra) => {
  if (ok === 'SKIP') { skip++; console.log('    ⏭️  ' + label + (extra ? '  ← ' + extra : '')); return }
  if (ok) { pass++; console.log('    ✅ ' + label + (extra ? '  ← ' + extra : '')) }
  else { fail++; console.log('    ❌ ' + label + (extra ? '  ← ' + extra : '')) }
}

// 15 步计划：与实测那条货损任务同量级（15 轮 → 约 30 积分）
const STEPS = Array.from({ length: 15 }, (_, i) => ({
  action: '处理第 ' + (i + 1) + ' 批',
  target: '货损核算',
  detail: '按业务员汇总',
}))
const plan = {
  title: '写入 10 月调拨货损',
  rationale: '按调拨报表与销售结算回算，共 27 条明细。',
  steps: STEPS,
}
const reply = '好的，我先列一份执行计划，你确认后我再动数据。\n\n```proposal\n' +
  JSON.stringify(plan) + '\n```'

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

  // 拦截对话接口（只拦这一个，其它接口照常走真实后端）
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

  console.log('\n[1] 打开副驾并发一条')
  await page.keyboard.press('Meta+k')
  await sleep(800)
  if (!(await page.$('.cp-composer'))) {
    const btn = page.locator('button', { hasText: /AI/ }).first()
    try { await btn.click({ timeout: 3000 }) } catch (_) {}
    await sleep(800)
  }
  const box = page.locator('.cp-input').first()
  await box.fill('把昨天算的货损数据写入系统')
  await sleep(200)
  await page.locator('.cp-send').first().click()
  await sleep(2500)

  console.log('\n[2] 执行计划卡片')
  const card = await page.evaluate(() => {
    const el = document.querySelector('.cp-proposal')
    return el && el.offsetHeight > 0 ? { text: el.innerText.replace(/\s+/g, ' ').trim() } : null
  })
  ck('计划卡片渲染', !!card, card ? card.text.slice(0, 60) : '找不到 .cp-proposal')
  const costEl = await page.evaluate(() => {
    const el = document.querySelector('.cp-prop-cost')
    return el && el.offsetHeight > 0 ? el.innerText.replace(/\s+/g, ' ').trim() : ''
  })
  ck('卡片上有「预计消耗」一行', !!costEl, costEl || '找不到 .cp-prop-cost')
  ck('写明步数（15 步）', /15 步/.test(costEl), costEl)
  ck('写明积分（15 步 × 2 = 30）', /约 30 积分/.test(costEl), costEl)
  ck('写明金额（30 积分 = 3 毛）', /3 毛|0\.3 元/.test(costEl), costEl)
  ck('明确「执行后才计费」', /执行后才计费/.test(costEl), costEl)

  console.log('\n[3] 只提醒不拦截（硬纪律）')
  const btn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.cp-prop-btn')].find(x => /执行计划/.test(x.innerText))
    if (!b) return null
    return { disabled: b.disabled, aria: b.getAttribute('aria-disabled') }
  })
  ck('「执行计划」按钮存在', !!btn, btn ? 'found' : '找不到')
  ck('按钮未被禁用（提醒不是拦截）', btn && btn.disabled === false && btn.aria !== 'true', JSON.stringify(btn))

  console.log('\n[4] 高峰省钱提示')
  const peak = await page.evaluate(async () => {
    const r = await fetch('/api/ai/quota', { credentials: 'same-origin' })
    const j = await r.json()
    return { is_peak: !!j.is_peak, left: j.peak_until_min || 0 }
  })
  if (!peak.is_peak) {
    ck('非高峰时段 → 不出现「只要一半」', !/只要一半/.test(costEl), '现在闲时，符合预期')
  } else {
    ck('高峰时段 → 出现「只要一半」', /只要一半/.test(costEl), 'is_peak=' + peak.is_peak + ' 剩' + peak.left + '分钟')
  }

  console.log('\n[5] 模拟流量不计费')
  const cost = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.cp-cost')].filter(e => e.offsetHeight > 0)
    return els.map(e => e.innerText.trim())
  })
  ck('额度未变 ⇒ 不显示「本次约 N 积分」', cost.length === 0, cost.join(' | ') || '未显示（正确）')

  const shot = '/tmp/v693-plan-cost.png'
  await page.screenshot({ path: shot })
  console.log('\n截图：' + shot)

  await browser.close()
  console.log('\n' + (fail ? 'HAS FAILURE' : 'ALL PASS') + '  ' + pass + ' 通过 / ' + fail + ' 失败 / ' + skip + ' 跳过')
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('探针自身出错：', e); process.exit(2) })
