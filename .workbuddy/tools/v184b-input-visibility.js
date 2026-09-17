// v184b 体检：行内编辑输入框的**可见性**（边框/背景/尺寸）+ 高倍特写
// 目的：断言之外还要"看得见"——用户点开一格后必须能看出这里是可以打字的。
// 同时对照厂价列（本页既有的行内编辑范式），两者视觉语言应一致。
const puppeteer = require('puppeteer-core')
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9999'
const OUT = process.env.HG_OUT || '/tmp'
const sleep = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 950, deviceScaleFactor: 3 })
  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
  }, TOKEN, TENANT)
  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/archive/products', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(4000)

  // 点开一格 → 量输入框的可见属性
  // ⚠️ 必须**分两次 evaluate**：Vue 的渲染是异步的（nextTick），在同一个同步块里
  //    点完立刻查 `input` 必然拿不到（返回 no-input，看起来像「点了没反应」）。
  const clicked = await page.evaluate(() => {
    const t = document.querySelector('table.tbl')
    const ths = [...t.querySelectorAll('thead th')]
    const idx = ths.findIndex(x => x.textContent.trim() === '到货周期')
    const rows = [...t.querySelectorAll('tbody tr')]
    for (const tr of rows) {
      const sp = tr.children[idx] && tr.children[idx].querySelector('.pa-cyc-val, .pa-cyc-none')
      if (sp) { sp.click(); return sp.textContent.trim() }
    }
    return null
  })
  console.log('点开前的文案: ' + JSON.stringify(clicked))
  await sleep(500)
  const m = await page.evaluate(() => {
    const inp = document.querySelector('table.tbl input.pa-cyc-input')
    if (!inp) return { err: 'no-input' }
    const cs = getComputedStyle(inp)
    const r = inp.getBoundingClientRect()
    return {
      box: { w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: r.left, y: r.top },
      border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
      radius: cs.borderRadius, bg: cs.backgroundColor, color: cs.color,
      font: cs.fontSize + '/' + cs.fontFamily.split(',')[0],
      textAlign: cs.textAlign, type: inp.type, value: inp.value,
      placeholder: inp.placeholder || '(无)',
      hasGlobalInputClass: inp.classList.contains('input'),
    }
  })
  console.log('输入框实测:', JSON.stringify(m, null, 2))

  if (m.box) {
    const pad = 14
    await page.screenshot({
      path: OUT + '/04-编辑输入框特写.png',
      clip: { x: Math.max(0, m.box.x - pad), y: Math.max(0, m.box.y - pad), width: m.box.w + pad * 2, height: m.box.h + pad * 2 },
    })
    console.log('特写: ' + OUT + '/04-编辑输入框特写.png')
  }
  await browser.close()
})().catch(e => { console.error('FATAL', e); process.exit(2) })
