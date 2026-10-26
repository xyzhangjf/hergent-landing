/**
 * v694 底部信息条「状态胶囊」—— 生产/本地运行时探针
 * ==========================================================================
 * 背景：老板说常驻那句「本月 59 积分 · 还能跑约 73 件这样的活」放在输入框下面
 *      「看着太不协调」。v694 把它从**账本读数**降级为**状态**，数字收进明细卡。
 *
 * 验的是用户看得见的东西（变量名/类名会 minify，只有字面量与几何靠得住）：
 *   B1 构建号真的是 v694
 *   B2 旧的常驻读数元素 `.cp-quota-tip` 已不存在（防止「新旧两行同时在」）
 *   B3 免责提示与额度状态**在同一行**（中心 y 差 ≤ 6px）
 *   B4 常驻文案只给状态：不出现「积分 / 本月 / 件这样的活」这些账本词
 *   B5 悬停 title 里给全数字（鼠标党不必点开）
 *   B6 点胶囊 → 明细卡展开，含「本月 AI 额度」
 *   B7 再点一次 → 收起
 *   B8 点抽屉空白处 → 收起（点外部关闭）
 *   B9 明细卡里不出现 token 字样（产品红线：经销商看不懂）
 *   B10 整块高度仍是一行（≤ 26px），没有把 footer 顶高
 *   B11 无页面级 JS 异常
 *
 * 用法：node tests/perf/v694/usage-chip.mjs [BASE_URL]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://127.0.0.1:5188'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  ck('__HG_BUILD__ = v694', build === 'v694', 'got=' + build)

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
  ck('有 credits_limit', typeof q.credits_limit === 'number' && q.credits_limit > 0, 'limit=' + q.credits_limit + ' used=' + q.credits_used + ' exempt=' + q.exempt)

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

  console.log('\n[4] 结构：一行两端')
  const struct = await page.evaluate(() => {
    const tip = document.querySelector('.cp-quota-tip')
    const meta = document.querySelector('.cp-foot-meta')
    const note = meta ? meta.querySelector('.cp-ai-note') : null
    const chip = meta ? meta.querySelector('.cp-usage-btn') : null
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, cy: b.y + b.height / 2 } }
    return {
      oldTipVisible: !!(tip && tip.offsetHeight > 0),
      hasMeta: !!meta,
      metaH: meta ? meta.getBoundingClientRect().height : 0,
      note: r(note), chip: r(chip),
      chipText: chip ? chip.innerText.trim() : '',
      chipTitle: chip ? (chip.getAttribute('title') || '') : '',
      noteText: note ? note.innerText.trim() : ''
    }
  })
  ck('旧常驻读数 .cp-quota-tip 已消失', !struct.oldTipVisible, struct.oldTipVisible ? '新旧两行同时在' : '干净')
  ck('底部信息条 .cp-foot-meta 存在', struct.hasMeta)
  ck('免责提示仍在', /内容由AI生成/.test(struct.noteText), struct.noteText)
  ck('额度胶囊渲染', !!struct.chip, struct.chipText ? 'text=' + struct.chipText : '找不到 .cp-usage-btn')
  if (struct.note && struct.chip) {
    ck('两者同一行（中心 y 差 ≤ 6px）', Math.abs(struct.note.cy - struct.chip.cy) <= 6,
      'note.cy=' + struct.note.cy.toFixed(1) + ' chip.cy=' + struct.chip.cy.toFixed(1))
    ck('胶囊在右侧（chip.x > note.x + note.w * 0.5）', struct.chip.x > struct.note.x + struct.note.w * 0.5,
      'note.x=' + struct.note.x.toFixed(0) + ' w=' + struct.note.w.toFixed(0) + ' chip.x=' + struct.chip.x.toFixed(0))
  }
  ck('整块仍是一行（高 ≤ 26px）', struct.metaH <= 26, 'h=' + struct.metaH.toFixed(1))

  console.log('\n[5] 常驻文案：只给状态，不给账本')
  const t = struct.chipText
  ck('不出现「积分」', !/积分/.test(t), t)
  ck('不出现「本月」', !/本月/.test(t), t)
  ck('不出现「件这样的活」', !/件这样的活/.test(t), t)
  ck('是四种状态之一', /^(额度充足|额度已用完|不限额度|已用 \d+%)$/.test(t), t)

  console.log('\n[6] 悬停给全数字')
  ck('title 里有已用数字', /\d/.test(struct.chipTitle), struct.chipTitle)

  console.log('\n[7] 点开明细卡')
  let panel = ''
  if (struct.chip) {
    await page.click('.cp-usage-btn')
    await sleep(450)
    panel = await page.evaluate(() => {
      const el = document.querySelector('.cp-usage-menu')
      return el && el.offsetHeight > 0 ? el.innerText.trim() : ''
    })
    ck('明细卡展开', !!panel, panel ? panel.replace(/\n+/g, ' / ') : '没弹出来')
    ck('明细卡标题「本月 AI 额度」', /本月 AI 额度/.test(panel), panel.slice(0, 40))
    // 明细卡不得超出视口（右对齐向左展开，别被抽屉裁掉）
    const fit = await page.evaluate(() => {
      const el = document.querySelector('.cp-usage-menu')
      if (!el) return null
      const b = el.getBoundingClientRect()
      return { right: b.right, vw: window.innerWidth, left: b.left, bottom: b.bottom, vh: window.innerHeight }
    })
    ck('明细卡未溢出右侧', !!fit && fit.right <= fit.vw + 0.5, fit ? 'right=' + fit.right.toFixed(0) + ' vw=' + fit.vw : '')
    ck('明细卡未溢出左侧', !!fit && fit.left >= -0.5, fit ? 'left=' + fit.left.toFixed(0) : '')
    ck('明细卡在视口内（向上弹）', !!fit && fit.bottom <= fit.vh + 0.5, fit ? 'bottom=' + fit.bottom.toFixed(0) + ' vh=' + fit.vh : '')

    console.log('\n[8] 红线：明细卡不暴露 token')
    ck('无 token 字样', !/\btokens?\b/i.test(panel), 'ok')

    // 局部截图（含明细卡）
    await page.locator('.cp-foot-meta').screenshot({ path: '/tmp/v694-foot-open.png' }).catch(() => {})
  }

  console.log('\n[9] 收起：再点胶囊')
  await page.click('.cp-usage-btn')
  await sleep(400)
  const closed1 = await page.evaluate(() => {
    const el = document.querySelector('.cp-usage-menu')
    return !(el && el.offsetHeight > 0)
  })
  ck('再点一次收起', closed1)

  console.log('\n[10] 收起：点空白处')
  await page.click('.cp-usage-btn')
  await sleep(350)
  await page.mouse.click(700, 400)   // 抽屉左侧空白（聊天区）
  await sleep(450)
  const closed2 = await page.evaluate(() => {
    const el = document.querySelector('.cp-usage-menu')
    return !(el && el.offsetHeight > 0)
  })
  ck('点外部收起', closed2)

  console.log('\n[11] 运行期异常')
  ck('无页面级 JS 异常', errs.length === 0, errs.slice(0, 3).join(' | ') || '干净')

  // 收尾截图：默认态 footer 局部 + 全屏
  await page.locator('.cp-foot-meta').screenshot({ path: '/tmp/v694-foot.png' }).catch(() => {})
  await page.screenshot({ path: '/tmp/v694-full.png' })
  console.log('\n截图：/tmp/v694-foot.png  /tmp/v694-foot-open.png  /tmp/v694-full.png')

  await browser.close()
  console.log('\n' + (fail ? 'HAS FAILURE' : 'ALL PASS') + '  ' + pass + ' 通过 / ' + fail + ' 失败 / ' + skip + ' 跳过')
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('探针自身出错：', e); process.exit(2) })
