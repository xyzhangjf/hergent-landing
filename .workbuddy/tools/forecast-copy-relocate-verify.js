// v167「复制报单」下移真机验证：落点（卡片内表格工具行）+ 相邻品牌 + 弹层定位 + 互斥点击 + 容量
// 用隔离沙箱租户 9997 的令牌，全程只读（不点保存 / 不改任何数据）。
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9997'
const SHOT = process.env.HG_SHOT || '/tmp/v167-copy-relocate.png'

let PASS = 0, FAIL = 0
const ok = (c, m) => { c ? (PASS++, console.log('  PASS  ' + m)) : (FAIL++, console.log('  FAIL  ' + m)) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1680, height: 950, deviceScaleFactor: 1 })
  const errs = [], bad = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 110)) })

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'v167verify', display_name: '验证账号' }))
  }, TOKEN, TENANT)

  await page.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(5500)
  console.log('URL:', page.url())
  ok(!/#\/login/.test(page.url()), '登录态注入成功（未被弹回 /#/login）')

  // ── A. 工具栏：不该再有「复制报单」，且因腾出空间而更宽松 ──
  const tb = await page.evaluate(() => {
    const t = document.querySelector('.toolbar')
    if (!t) return null
    return {
      labels: [...t.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(Boolean),
      h: Math.round(t.getBoundingClientRect().height),
    }
  })
  ok(tb !== null, '主工具栏已渲染')
  if (tb) {
    ok(!tb.labels.some(x => x.includes('复制报单')), '工具栏已不含「复制报单」（当前：' + tb.labels.join(' / ') + '）')
    ok(tb.labels.some(x => x.includes('导出')), '工具栏仍保留「导出」（同段其它项未受影响）')
  }

  // ── B. 落点：卡片内的表格工具行，且紧邻品牌筛选 ──
  const ctl = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.grid-ctl-row')]
    const r = rows.find(x => x.getBoundingClientRect().height > 0)
    if (!r) return { found: rows.length, hit: false }
    const bs = [...r.querySelectorAll('button')]
    const pick = kw => bs.find(b => (b.textContent || '').includes(kw))
    const brand = pick('品牌'), copy = pick('复制报单')
    const rb = brand && brand.getBoundingClientRect(), rc = copy && copy.getBoundingClientRect()
    return {
      found: rows.length, hit: true,
      labels: bs.map(b => (b.textContent || '').trim().replace(/\s+/g, '')).filter(Boolean),
      brandText: brand ? (brand.textContent || '').trim().replace(/\s+/g, '') : null,
      hasCopy: !!copy,
      inCard: !!r.closest('.card'),
      cardCls: (r.closest('.card') || {}).className || null,
      brandRight: rb ? Math.round(rb.right) : null,
      copyLeft: rc ? Math.round(rc.left) : null,
      sameRow: (rb && rc) ? Math.abs(rb.top - rc.top) < 10 : false,
      rowH: Math.round(r.getBoundingClientRect().height),
    }
  })
  console.log('  工具行：', JSON.stringify(ctl))
  ok(ctl.hit, '表格工具行已渲染')
  ok(ctl.hasCopy === true, '「复制报单」出现在表格工具行（' + (ctl.labels || []).join(' / ') + '）')
  ok(ctl.inCard === true, '工具行位于 .card 内部（' + ctl.cardCls + '）—— 非页面级')
  ok(ctl.sameRow === true, '与「品牌」同一排（垂直对齐）')
  ok(ctl.brandRight !== null && ctl.copyLeft !== null && ctl.copyLeft >= ctl.brandRight,
     '顺序为「品牌」在前、「复制报单」紧随其后（品牌右 ' + ctl.brandRight + ' → 复制左 ' + ctl.copyLeft + '）')

  // ── C. 点击 → 弹层打开并贴合按钮下方 ──
  const clickIn = kw => page.evaluate((k) => {
    const r = [...document.querySelectorAll('.grid-ctl-row')].find(x => x.getBoundingClientRect().height > 0)
    const b = [...r.querySelectorAll('button')].find(x => (x.textContent || '').includes(k))
    if (!b) return false
    b.click(); return true
  }, kw)
  const state = () => page.evaluate(() => ({
    brand: !!document.querySelector('.tb-pop-panel.brand-pop'),
    copy: !!document.querySelector('.tb-pop-panel.copy-pop'),
  }))

  ok(await clickIn('复制报单'), '点击「复制报单」')
  await sleep(700)
  const pop = await page.evaluate(() => {
    const p = document.querySelector('.tb-pop-panel.copy-pop')
    const r = [...document.querySelectorAll('.grid-ctl-row')].find(x => x.getBoundingClientRect().height > 0)
    const btn = [...r.querySelectorAll('button')].find(x => (x.textContent || '').includes('复制报单'))
    if (!p || !btn) return { open: false }
    const rp = p.getBoundingClientRect(), rb = btn.getBoundingClientRect()
    return {
      open: true, top: Math.round(rp.top), left: Math.round(rp.left),
      btnBottom: Math.round(rb.bottom), gapY: Math.round(rp.top - rb.bottom),
      acts: [...p.querySelectorAll('.cp-act')].map(b => (b.textContent || '').trim()),
      disabled: [...p.querySelectorAll('.cp-act')].map(b => b.disabled),
      title: (p.querySelector('.cp-title') || {}).textContent || '',
      emptyShown: !!p.querySelector('.cp-empty'),
      okText: ((p.querySelector('.cp-tip.ok') || {}).textContent || '').trim(),
    }
  })
  ok(pop.open === true, '面板已打开')
  if (pop.open) {
    ok(pop.gapY >= -4 && pop.gapY <= 24, '面板贴在触发按钮下方（间距 ' + pop.gapY + 'px；按钮底 ' + pop.btnBottom + ' → 面板顶 ' + pop.top + '）')
    ok(/复制本期报单/.test(pop.title), '面板标题正确：' + pop.title.trim())
    ok(pop.acts.length === 2 && pop.acts.join('/').includes('厂家编码'), '面板动作按钮齐全：' + pop.acts.join(' / '))
    const allOff = pop.disabled.every(Boolean), allOn = pop.disabled.every(x => !x)
    ok((allOff && pop.emptyShown) || (allOn && pop.okText.length > 0),
       '动作可用性与数据口径一致（disabled=' + JSON.stringify(pop.disabled) +
       '，无单提示=' + pop.emptyShown + '，计数文案="' + pop.okText + '"）')
  }

  // ── D. 互斥点击：弹层开着时直接点另一个触发器，不该被遮罩吃掉 ──
  const s1 = await state()
  ok(s1.copy === true, '前置：复制面板开着')
  await clickIn('品牌')
  await sleep(600)
  const s2 = await state()
  ok(s2.brand === true && s2.copy === false, '复制面板开着时点「品牌」→ 直接切换（' + JSON.stringify(s2) + '）')
  ok(await clickIn('复制报单'), '再点回「复制报单」')
  await sleep(600)
  const s3 = await state()
  ok(s3.copy === true && s3.brand === false, '品牌面板开着时点「复制报单」→ 直接切换（' + JSON.stringify(s3) + '）')

  await page.screenshot({ path: SHOT })
  console.log('  截图：' + SHOT)

  // ── E. 容量：工具栏五视口仍单行；工具行未因新增按钮而撑高 ──
  await page.evaluate(() => document.body.click())
  await sleep(400)

  const cap = []
  for (const w of [1280, 1366, 1440, 1680, 1920]) {
    await page.setViewport({ width: w, height: 950, deviceScaleFactor: 1 })
    await sleep(500)
    const m = await page.evaluate(() => {
      const t = document.querySelector('.toolbar')
      const r = [...document.querySelectorAll('.grid-ctl-row')].find(x => x.getBoundingClientRect().height > 0)
      return {
        tb: t ? Math.round(t.getBoundingClientRect().height) : null,
        row: r ? Math.round(r.getBoundingClientRect().height) : null,
        rowW: r ? Math.round(r.getBoundingClientRect().width) : null,
      }
    })
    cap.push(w + ': toolbar=' + m.tb + ' row=' + m.row + '/' + m.rowW)
    ok(m.tb !== null && m.tb <= 72, '工具栏单行 @' + w + '：' + m.tb + 'px')
  }
  console.log('  容量：' + cap.join('  |  '))

  // ── F. v168：编辑态（改单）**不得**出现「复制报单」；品牌筛选应仍在 ──
  await page.setViewport({ width: 1680, height: 950, deviceScaleFactor: 1 })
  await sleep(400)
  const enterEdit = await page.evaluate(() => {
    const t = document.querySelector('.toolbar')
    const b = [...t.querySelectorAll('button')].find(x => /改单/.test(x.textContent || ''))
    if (!b) return false
    b.click(); return true
  })
  ok(enterEdit, '已点击工具栏「改单」进入编辑态')
  await sleep(3500)
  const edit = await page.evaluate(() => {
    const areas = [...document.querySelectorAll('.grid-area')]
    const rows = [...document.querySelectorAll('.grid-ctl-row')]
    const vis = rows.filter(x => x.getBoundingClientRect().height > 0)
    const btnTexts = vis.flatMap(r => [...r.querySelectorAll('button')].map(b => (b.textContent || '').trim().replace(/\s+/g, '')))
    return {
      editArea: areas.length,
      visibleRows: vis.length,
      ctlButtons: btnTexts,
      hasCopyBtn: btnTexts.some(x => x.includes('复制报单')),
      hasBrandBtn: btnTexts.some(x => x.includes('品牌')),
      copyPanelExists: !!document.querySelector('.tb-pop-panel.copy-pop'),
      brandPanelTelemounted: !!document.querySelector('.tb-pop-panel.brand-pop'),
      tableRows: document.querySelectorAll('.grid-area table tbody tr').length,
    }
  })
  console.log('  编辑态：', JSON.stringify(edit))
  ok(edit.visibleRows >= 1, '编辑态工具行已渲染')
  ok(edit.hasCopyBtn === false, '★ 编辑态**没有**「复制报单」（当前按钮：' + edit.ctlButtons.join(' / ') + '）')
  ok(edit.hasBrandBtn === true, '编辑态仍保留「品牌」筛选（改单时按品牌收窄视野仍有意义）')
  ok(edit.copyPanelExists === false, '编辑态 DOM 里也不存在复制面板')
  ok(edit.tableRows > 0, '编辑态矩阵渲染正常（' + edit.tableRows + ' 行）—— 模板结构未被改动破坏')
  await page.screenshot({ path: SHOT.replace(/\.png$/, '-edit.png') })

  console.log('\nCONSOLE_ERRORS:', JSON.stringify(errs.slice(0, 6)))
  console.log('HTTP>=400:', JSON.stringify(bad.slice(0, 6)))
  ok(errs.length === 0, 'console 无错误')
  ok(bad.length === 0, '无 HTTP>=400')
  console.log('\n结果：PASS=' + PASS + ' FAIL=' + FAIL)
  await browser.close()
  process.exit(FAIL ? 1 : 0)
})().catch(e => { console.error('FATAL', e); process.exit(2) })
