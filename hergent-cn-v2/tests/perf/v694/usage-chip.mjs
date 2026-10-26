/**
 * v694 底部信息条 —— 生产/本地运行时探针
 * ==========================================================================
 * 背景两版：
 *   ① 老板说「本月 59 积分 · 还能跑约 73 件这样的活」常驻在输入框下面太不协调
 *      ⇒ 改成状态胶囊 + 点开明细；
 *   ② 老板又说「可以只在 ≥80% 才出现，平时完全消失」
 *      ⇒ 现行口径：**低于 80% 整块不渲染**。
 *
 * 验的是用户看得见的东西（类名会 minify，只有字面量与几何靠得住）：
 *   ── 平时（demo 账号，pct≈0）──
 *   B1 构建号 v694
 *   B2 接口有数据
 *   B3 副驾打得开
 *   B4 旧的常驻读数 `.cp-quota-tip` 已不存在（不许新旧两行并存）
 *   B5 额度胶囊**不存在**（这就是「平时完全消失」）
 *   B6 footer 只剩免责一件，且单件居中（没有留个空洞在那）
 *   B7 footer 高度 ≤ 26px（还是一行，没被顶高）
 *   ── 临界（拦接口造 85%）──
 *   B8 胶囊出现，文案「已用 85%」
 *   B9 上方横幅出现，且**不重复百分比**（横幅说后果，胶囊给读数）
 *   B10 免责与胶囊同一行（中心 y 差 ≤ 6px）
 *   B11 点开明细卡：还剩 / 已用 / 还能干几件 / 恢复日期俱全
 *   B12 明细卡不出视口
 *   B13 明细卡不暴露 token
 *   B14 再点收起 / B15 点外部收起
 *   B16 无页面级 JS 异常
 *
 * 用法：node tests/perf/v694/usage-chip.mjs [BASE_URL]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://127.0.0.1:5188'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const Q_CRITICAL = {
  ok: true, tier: 'free', credits_limit: 3000, credits_used: 2550, credits_remaining: 450,
  credits_pct: 85, exempt: false, exceeded: false, is_peak: false, peak_until_min: 0
}

let pass = 0, fail = 0, skip = 0
const ck = (label, ok, extra) => {
  if (ok === 'SKIP') { skip++; console.log('    ⏭️  ' + label + (extra ? '  ← ' + extra : '')); return }
  if (ok) { pass++; console.log('    ✅ ' + label + (extra ? '  ← ' + extra : '')) }
  else { fail++; console.log('    ❌ ' + label + (extra ? '  ← ' + extra : '')) }
}

const main = async () => {
  const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  let browser
  try { browser = await chromium.launch({ headless: true, executablePath: CHROME }) }
  catch (_) { browser = await chromium.launch({ headless: true }) }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))

  console.log('\n━━━ 打开 ' + BASE)
  await page.goto(BASE + '/?__p=694', { waitUntil: 'domcontentloaded' })
  await sleep(2500)

  if (!(await page.$('.topbar'))) {
    const demo = page.getByRole('button', { name: /先看看演示效果/ })
    await demo.first().waitFor({ timeout: 20000 })
    await demo.first().click()
    await page.waitForSelector('.topbar', { timeout: 30000 })
    await sleep(1500)
  }

  console.log('\n[1] 构建号')
  const build = await page.evaluate(() => window.__HG_BUILD__ || '')
  ck('__HG_BUILD__ = v694（允许 v694b 这类小版本后缀）', build.startsWith('v694'), 'got=' + build)

  console.log('\n[2] 配额接口')
  const quota = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/ai/quota', { credentials: 'same-origin' })
      const j = await r.json()
      return { status: r.status, data: j || {} }
    } catch (e) { return { status: 0, data: {}, err: String(e) } }
  })
  const q = quota.data || {}
  ck('接口 200', quota.status === 200, 'status=' + quota.status)
  ck('有 credits_limit', typeof q.credits_limit === 'number' && q.credits_limit > 0,
    'limit=' + q.credits_limit + ' used=' + q.credits_used + ' pct=' + q.credits_pct + ' exempt=' + q.exempt)

  console.log('\n[3] 打开副驾')
  await page.keyboard.press('Meta+k')
  await sleep(1200)
  let open = await page.$$eval('.cp-composer', (els) => els.filter(e => e.offsetHeight > 0).length).catch(() => 0)
  if (!open) {
    const btn = page.locator('button', { hasText: /AI/ }).first()
    try { await btn.click({ timeout: 3000 }) } catch (_) {}
    await sleep(1000)
    open = await page.$$eval('.cp-composer', (els) => els.filter(e => e.offsetHeight > 0).length).catch(() => 0)
  }
  ck('副驾输入框可见', open > 0, 'cp-composer=' + open)

  console.log('\n[4] 平时（pct=' + (q.credits_pct || 0) + '%）：应当完全消失')
  const struct = await page.evaluate(() => {
    const tip = document.querySelector('.cp-quota-tip')
    const meta = document.querySelector('.cp-foot-meta')
    const note = meta ? meta.querySelector('.cp-ai-note') : null
    const chip = meta ? meta.querySelector('.cp-usage-btn') : null
    const rec = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 } }
    return {
      oldTip: !!(tip && tip.offsetHeight > 0),
      hasMeta: !!meta,
      meta: rec(meta), note: rec(note), chip: rec(chip),
      chipText: chip ? chip.innerText.trim() : '',
      noteText: note ? note.innerText.trim() : ''
    }
  })
  ck('旧常驻读数 .cp-quota-tip 已消失', !struct.oldTip, struct.oldTip ? '新旧同时存在' : '干净')
  ck('底部信息条 .cp-foot-meta 存在', struct.hasMeta)
  ck('免责提示仍在', /内容由AI生成/.test(struct.noteText), struct.noteText)

  const shouldHide = !q.exempt && !q.exceeded && (q.credits_pct || 0) < 80
  if (shouldHide) {
    ck('额度胶囊**不渲染**（平时完全消失）', struct.chip === null, struct.chipText ? '仍显示 ' + struct.chipText : '已隐藏')
    if (struct.meta && struct.note) {
      ck('免责单件居中（没有留空洞）', Math.abs(struct.note.cx - struct.meta.cx) <= 8,
        'note.cx=' + struct.note.cx.toFixed(1) + ' meta.cx=' + struct.meta.cx.toFixed(1))
    }
    ck('整块仍是一行（高 ≤ 26px）', struct.meta.h <= 26, 'h=' + struct.meta.h.toFixed(1))
  } else {
    ck('该账号已临界，跳过「平时隐藏」断言', 'SKIP', 'exempt=' + q.exempt + ' pct=' + q.credits_pct)
  }

  /* ─────── 临界态：拦接口造 85%，验出现 + 交互 ─────── */
  console.log('\n[5] 临界（造 85%）：应当出现')
  await ctx.route('**/api/ai/quota*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Q_CRITICAL) }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(2000)
  await page.keyboard.press('Meta+k')
  await sleep(1200)

  const crit = await page.evaluate(() => {
    const meta = document.querySelector('.cp-foot-meta')
    const note = meta ? meta.querySelector('.cp-ai-note') : null
    const chip = meta ? meta.querySelector('.cp-usage-btn') : null
    const warn = document.querySelector('.cp-quota-warn')
    const rec = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { y: b.y, h: b.height, cy: b.y + b.height / 2, right: b.right, left: b.left } }
    return {
      chipText: chip ? chip.innerText.trim() : '',
      chipCls: chip ? chip.className : '',
      chipTitle: chip ? (chip.getAttribute('title') || '') : '',
      note: rec(note), chip: rec(chip),
      metaH: meta ? meta.getBoundingClientRect().height : 0,
      warn: warn && warn.offsetHeight > 0 ? warn.innerText.trim() : ''
    }
  })
  ck('胶囊出现', !!crit.chipText, crit.chipText || '没出现')
  ck('文案 = 已用 85%', /^已用 85%$/.test(crit.chipText), crit.chipText)
  ck('配色类 .warn', /\bwarn\b/.test(crit.chipCls), crit.chipCls)
  ck('上方横幅出现', !!crit.warn, crit.warn)
  ck('横幅不重复百分比（胶囊才给读数）', !/%/.test(crit.warn), crit.warn)
  ck('悬停 title 带明细引导', /\d/.test(crit.chipTitle), crit.chipTitle)
  if (crit.note && crit.chip) {
    ck('与免责同一行（中心 y 差 ≤ 6px）', Math.abs(crit.note.cy - crit.chip.cy) <= 6,
      'note.cy=' + crit.note.cy.toFixed(1) + ' chip.cy=' + crit.chip.cy.toFixed(1))
  }
  ck('整块仍是一行（高 ≤ 26px）', crit.metaH <= 26, 'h=' + crit.metaH.toFixed(1))

  console.log('\n[6] 点开明细卡')
  await page.click('.cp-usage-btn')
  await sleep(450)
  const panel = await page.evaluate(() => {
    const el = document.querySelector('.cp-usage-menu')
    return el && el.offsetHeight > 0 ? el.innerText.replace(/\n+/g, ' ') : ''
  })
  ck('明细卡展开', !!panel, panel.slice(0, 100))
  ck('有「本月 AI 额度」标题', /本月 AI 额度/.test(panel), '')
  ck('有剩余积分', /还剩\s*450\s*积分/.test(panel), '')
  ck('有已用与额度（千分位）', /2,550/.test(panel) && /3,000/.test(panel), '')
  ck('有「还能干几件活」推演', /还能干\s*11\s*件/.test(panel), '')
  ck('有恢复日期', /每月 1 日自动恢复额度/.test(panel), '')
  const fit = await page.evaluate(() => {
    const el = document.querySelector('.cp-usage-menu')
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { right: b.right, left: b.left, bottom: b.bottom, vw: window.innerWidth, vh: window.innerHeight }
  })
  ck('未溢出右侧', !!fit && fit.right <= fit.vw + 0.5, fit ? 'right=' + fit.right.toFixed(0) + ' vw=' + fit.vw : '')
  ck('未溢出左侧', !!fit && fit.left >= -0.5, fit ? 'left=' + fit.left.toFixed(0) : '')
  ck('向上弹在视口内', !!fit && fit.bottom <= fit.vh + 0.5, fit ? 'bottom=' + fit.bottom.toFixed(0) : '')
  ck('明细卡不暴露 token', !/\btokens?\b/i.test(panel), 'ok')

  console.log('\n[7] 收起')
  await page.click('.cp-usage-btn')
  await sleep(400)
  ck('再点一次收起', await page.evaluate(() => {
    const el = document.querySelector('.cp-usage-menu')
    return !(el && el.offsetHeight > 0)
  }))
  await page.click('.cp-usage-btn')
  await sleep(350)
  await page.mouse.click(700, 400)
  await sleep(450)
  ck('点外部收起', await page.evaluate(() => {
    const el = document.querySelector('.cp-usage-menu')
    return !(el && el.offsetHeight > 0)
  }))

  console.log('\n[8] 运行期异常')
  ck('无页面级 JS 异常', errs.length === 0, errs.slice(0, 3).join(' | ') || '干净')

  await page.locator('.cp-foot-meta').screenshot({ path: '/tmp/v694b-foot.png' }).catch(() => {})
  await page.click('.cp-usage-btn').catch(() => {})
  await sleep(400)
  const box = await page.evaluate(() => {
    const chip = document.querySelector('.cp-usage-btn'), menu = document.querySelector('.cp-usage-menu')
    if (!chip || !menu) return null
    const a = chip.getBoundingClientRect(), m = menu.getBoundingClientRect()
    return { x: Math.min(a.left, m.left) - 8, y: m.top - 6, width: (Math.max(a.right, m.right) - Math.min(a.left, m.left)) + 16, height: (a.bottom - m.top) + 24 }
  })
  if (box) await page.screenshot({ path: '/tmp/v694b-menu.png', clip: box })
  console.log('\n截图：/tmp/v694b-foot.png  /tmp/v694b-menu.png')

  await browser.close()
  console.log('\n' + (fail ? 'HAS FAILURE' : 'ALL PASS') + '  ' + pass + ' 通过 / ' + fail + ' 失败 / ' + skip + ' 跳过')
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('探针自身出错：', e); process.exit(2) })
