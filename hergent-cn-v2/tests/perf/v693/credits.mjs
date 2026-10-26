/**
 * v693 积分与成本 —— 生产运行时探针
 * ==========================================================================
 * 验的是**用户能不能看见**，不是代码有没有写：
 *   A1 构建号真的是 v693（改完没重新部署，这里就会露出来）
 *   A2 副驾打得开（Cmd+K），输入框区渲染
 *   A3 `/api/ai/quota` 真返回积分字段，且数字自洽
 *   A4 输入框下方那行读数是**业务单位**（「还能跑约 N 件这样的活」），不是 token
 *   A5 副驾里**不出现** token 字样 —— 经销商看不懂，这是产品红线
 *   A6 额度阈值横幅：只在 >=80% 或超限时出现（不该无条件冒出来）
 *
 * 为什么 P4（执行计划预计消耗）不在本探针里：它要等 AI 真产出一个
 * 多步执行计划，演示账号无法稳定触发。改用两条静态判据替代（见报告）：
 * 构建产物含「执行后才计费」字面量 + 模板 `v-if="planCredits(m)"` 存在。
 *
 * 用法：node tests/perf/v693/credits.mjs [BASE_URL]
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

const main = async () => {
  /* 🔴 优先用系统 Chrome：本机 playwright 版本要求的 chromium-1234 没下下来，
     而 `npx playwright install` 会走本地代理超时（踩过）。系统 Chrome 一样跑。 */
  const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const launchOpts = { headless: true }
  let browser
  try {
    browser = await chromium.launch({ ...launchOpts, executablePath: CHROME })
  } catch (_) {
    browser = await chromium.launch(launchOpts)
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))

  console.log('\n━━━ 打开 ' + BASE)
  await page.goto(BASE + '/?__p=693', { waitUntil: 'domcontentloaded' })
  await sleep(2000)

  // 演示账号登录（与 v691 探针同一套自愈逻辑）
  if (!(await page.$('.topbar'))) {
    const demo = page.getByRole('button', { name: /先看看演示效果/ })
    await demo.first().waitFor({ timeout: 20000 })
    await demo.first().click()
    await page.waitForSelector('.topbar', { timeout: 30000 })
    await sleep(1500)
  }

  /* A1 ── 构建号 */
  console.log('\n[1] 构建号')
  const build = await page.evaluate(() => window.__HG_BUILD__ || '')
  ck('__HG_BUILD__ = v693', build === 'v693', 'got=' + build)

  /* A3 ── 配额接口（先拿数据，再判 UI 该不该有） */
  console.log('\n[2] 配额接口')
  const quota = await page.evaluate(async () => {
    try {
      // v628 起凭证是 httpOnly Cookie，同源 fetch 自动带上 ——
      // 不要去 localStorage 找 token（那里只有 user 与 tenant，没有凭证）。
      const r = await fetch('/api/ai/quota', { credentials: 'same-origin' })
      const j = await r.json()
      return { status: r.status, ok: !!(j && j.ok), data: j }
    } catch (e) { return { status: 0, ok: false, err: String(e) } }
  })
  ck('接口 200', quota.status === 200, 'status=' + quota.status)
  const q = quota.data || {}
  ck('返回 credits_limit（积分额度）', typeof q.credits_limit === 'number' && q.credits_limit > 0, 'limit=' + q.credits_limit)
  ck('返回 credits_used（已用积分）', typeof q.credits_used === 'number', 'used=' + q.credits_used)
  ck('credits_pct 自洽', typeof q.credits_pct === 'number' &&
     Math.abs(q.credits_pct - Math.min(100, (q.credits_used || 0) * 100 / (q.credits_limit || 1))) < 0.2,
     'pct=' + q.credits_pct)
  ck('tenant 1 豁免标记存在', typeof q.exempt === 'boolean', 'exempt=' + q.exempt)
  ck('额度是 3000（free 档新值，不是旧的 200000 字符）', q.credits_limit === 3000, 'limit=' + q.credits_limit)
  ck('返回 is_peak（峰谷标记，供执行卡片提示省钱）', typeof q.is_peak === 'boolean', 'is_peak=' + q.is_peak)
  ck('返回 peak_until_min（高峰还剩几分钟）', typeof q.peak_until_min === 'number', 'left=' + q.peak_until_min)
  if (q.is_peak) ck('高峰时剩余分钟数在合理区间', q.peak_until_min > 0 && q.peak_until_min <= 180, 'left=' + q.peak_until_min)

  /* A2 ── 打开副驾 */
  console.log('\n[3] 副驾抽屉')
  await page.keyboard.press('Meta+k')
  await sleep(900)
  let open = await page.$$eval('.cp-composer', (els) => els.filter(e => e.offsetHeight > 0).length).catch(() => 0)
  if (!open) {
    // 兜底：点顶栏的 AI 按钮
    const btn = page.locator('button', { hasText: /AI/ }).first()
    try { await btn.click({ timeout: 3000 }) } catch (_) {}
    await sleep(900)
    open = await page.$$eval('.cp-composer', (els) => els.filter(e => e.offsetHeight > 0).length).catch(() => 0)
  }
  ck('副驾输入框可见', open > 0, 'cp-composer=' + open)

  /* A4 ── 输入框下方那行读数 */
  console.log('\n[4] 额度读数（业务单位）')
  const tip = await page.evaluate(() => {
    const el = document.querySelector('.cp-quota-tip')
    return el && el.offsetHeight > 0 ? el.innerText.trim() : ''
  })
  if (!q.credits_limit) {
    ck('读数存在', 'SKIP', '账号无配额数据')
  } else {
    ck('读数元素渲染', !!tip, tip ? 'text=' + tip : '找不到 .cp-quota-tip')
    ck('用「件这样的活」说话（业务单位）', /件这样的活|额度已用完|额度快用完/.test(tip), tip)
    ck('带积分读数', /积分/.test(tip), tip)
    // 额度充足时必须是「还能跑约 N 件」，不能是警告口径
    if (!q.exceeded && q.credits_pct < 80) {
      ck('额度充足 → 正数口径', /还能跑约 \d+ 件/.test(tip), tip)
    }
  }

  /* A6 ── 阈值横幅不该无条件出现 */
  console.log('\n[5] 阈值横幅')
  const warn = await page.evaluate(() => {
    const el = document.querySelector('.cp-quota-warn')
    return el && el.offsetHeight > 0 ? el.innerText.trim() : ''
  })
  const shouldWarn = !q.exempt && (q.exceeded || (q.credits_pct || 0) >= 80)
  ck(shouldWarn ? '应出现横幅' : '不应出现横幅（未到 80%）',
     shouldWarn ? !!warn : !warn, 'warn=' + JSON.stringify(warn))

  /* A5 ── 红线：副驾里不许出现 token 字样 */
  console.log('\n[6] 红线：不暴露 token')
  const leak = await page.evaluate(() => {
    const root = document.querySelector('.copilot') || document.body
    const txt = (root.innerText || '')
    const hits = []
    const re = /\btokens?\b|token 数|消耗.*token/gi
    let m
    while ((m = re.exec(txt)) && hits.length < 5) hits.push(m[0])
    return [...new Set(hits)]
  })
  ck('副驾区无 token 字样', leak.length === 0, leak.join(', ') || '干净')

  /* 兜底：页面级 JS 异常 */
  console.log('\n[7] 运行期异常')
  ck('无页面级 JS 异常', errs.length === 0, errs.slice(0, 3).join(' | ') || '干净')

  // 截图留证
  const shot = '/tmp/v693-credits.png'
  await page.screenshot({ path: shot, fullPage: false })
  console.log('\n截图：' + shot)

  await browser.close()
  console.log('\n' + (fail ? 'HAS FAILURE' : 'ALL PASS') + '  ' + pass + ' 通过 / ' + fail + ' 失败 / ' + skip + ' 跳过')
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('探针自身出错：', e); process.exit(2) })
