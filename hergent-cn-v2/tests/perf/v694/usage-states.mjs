/**
 * v694 额度状态胶囊 —— 四种状态分支探针
 * ==========================================================================
 * 为什么要单独验：日常账号（demo）只会落在「额度充足」这一支，
 * 另外三支（豁免 / 接近上限 / 已用完 / 高峰）平时根本不出现 ——
 * 而**老板自己就是豁免账号**，他每天看到的是「不限额度」那一支。
 * 用 route 拦 `/api/ai/quota` 造四种数据，逐一验字面量与配色类。
 *
 * 用法：node tests/perf/v694/usage-states.mjs [BASE_URL]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://127.0.0.1:5188'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0
const ck = (label, ok, extra) => {
  if (ok) { pass++; console.log('    ✅ ' + label + (extra ? '  ← ' + extra : '')) }
  else { fail++; console.log('    ❌ ' + label + (extra ? '  ← ' + extra : '')) }
}

const CASES = [
  {
    name: '豁免账号（老板自己的 tenant 1）—— 不该出现',
    data: { ok: true, tier: 'free', credits_limit: 3000, credits_used: 59, credits_remaining: 2941, credits_pct: 2, exempt: true, exceeded: false, is_peak: false, peak_until_min: 0 },
    hidden: true
  },
  {
    name: '79%（阈值边界下方）—— 不该出现',
    data: { ok: true, tier: 'free', credits_limit: 3000, credits_used: 2370, credits_remaining: 630, credits_pct: 79, exempt: false, exceeded: false, is_peak: false, peak_until_min: 0 },
    hidden: true
  },
  {
    name: '85% + 高峰 —— 出现，琥珀 + 高峰提示',
    data: { ok: true, tier: 'free', credits_limit: 3000, credits_used: 2550, credits_remaining: 450, credits_pct: 85, exempt: false, exceeded: false, is_peak: true, peak_until_min: 95 },
    chip: /^已用 85%$/,
    state: 'warn',
    panel: [/还剩 450 积分/, /还能干 11 件这样的活/, /高峰/]
  },
  {
    name: '已用完 —— 出现，红色',
    data: { ok: true, tier: 'plus', credits_limit: 20000, credits_used: 20120, credits_remaining: 0, credits_pct: 100, exempt: false, exceeded: true, is_peak: false, peak_until_min: 0 },
    chip: /^额度已用完$/,
    state: 'danger',
    panel: [/还剩 0 积分/, /额度快用完了/]
  }
]

const main = async () => {
  const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  let browser
  try { browser = await chromium.launch({ headless: true, executablePath: CHROME }) }
  catch (_) { browser = await chromium.launch({ headless: true }) }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })

  // 先正常登录一次（拿到 cookie）
  const warm = await ctx.newPage()
  await warm.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await sleep(2200)
  if (!(await warm.$('.topbar'))) {
    const demo = warm.getByRole('button', { name: /先看看演示效果/ })
    await demo.first().waitFor({ timeout: 20000 })
    await demo.first().click()
    await warm.waitForSelector('.topbar', { timeout: 30000 })
  }
  await sleep(800)
  await warm.close()

  let current = null
  await ctx.route('**/api/ai/quota*', async (route) => {
    if (current) await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) })
    else await route.continue()
  })

  for (const c of CASES) {
    current = c.data
    console.log('\n━━━ ' + c.name)
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)))
    await page.goto(BASE + '/?__p=694s', { waitUntil: 'domcontentloaded' })
    await sleep(1800)
    await page.keyboard.press('Meta+k')
    await sleep(1100)

    const snap = await page.evaluate(() => {
      const btn = document.querySelector('.cp-usage-btn')
      const note = document.querySelector('.cp-foot-meta .cp-ai-note')
      const meta = document.querySelector('.cp-foot-meta')
      return {
        exists: !!(btn && btn.offsetHeight > 0),
        text: btn ? btn.innerText.trim() : '',
        cls: btn ? btn.className : '',
        title: btn ? (btn.getAttribute('title') || '') : '',
        note: note ? note.innerText.trim() : '',
        metaH: meta ? meta.getBoundingClientRect().height : 0
      }
    })

    if (c.hidden) {
      ck('胶囊不渲染（平时消失）', !snap.exists, snap.exists ? '仍显示 ' + snap.text : '已隐藏')
      ck('免责提示仍在', /内容由AI生成/.test(snap.note), snap.note)
      ck('footer 回到单行', snap.metaH <= 26, 'h=' + snap.metaH.toFixed(1))
      ck('无 JS 异常', errs.length === 0, errs.join('|') || '干净')
      await page.close()
      continue
    }

    ck('胶囊文案 = ' + c.chip.source.replace(/[\^$]/g, ''), c.chip.test(snap.text), 'got=' + JSON.stringify(snap.text))
    ck('配色类 .' + c.state, new RegExp('\\b' + c.state + '\\b').test(snap.cls), snap.cls)

    await page.click('.cp-usage-btn')
    await sleep(400)
    const panel = await page.evaluate(() => {
      const el = document.querySelector('.cp-usage-menu')
      return el && el.offsetHeight > 0 ? el.innerText.replace(/\n+/g, ' ') : ''
    })
    for (const re of c.panel) ck('明细含 ' + re.source, re.test(panel), panel.slice(0, 90))
    ck('无 JS 异常', errs.length === 0, errs.join('|') || '干净')
    await page.close()
  }

  await browser.close()
  console.log('\n' + (fail ? 'HAS FAILURE' : 'ALL PASS') + '  ' + pass + ' 通过 / ' + fail + ' 失败')
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('探针自身出错：', e); process.exit(2) })
