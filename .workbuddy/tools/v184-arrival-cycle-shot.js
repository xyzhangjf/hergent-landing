// v184 截图：查看态「到货周期」固定列（给交付说明用）
// 用法: HG_TOKEN=<token> HG_TENANT=9999 NODE_PATH=<ws>/node_modules node v184-arrival-cycle-shot.js
const puppeteer = require('puppeteer-core')
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9999'
const sleep = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 2 })
  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
  }, TOKEN, TENANT)
  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(6500)

  // 给固定列加一层高亮，便于在截图里一眼看到（仅截图用，不改产品代码）
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.cross-tbl')].find(tb => tb.getAttribute('role') === 'grid')
    if (!t) return
    t.querySelectorAll('td.fc-cycle, th.fc-cycle').forEach(el => {
      el.style.outline = '2px solid #e11d48'
      el.style.outlineOffset = '-2px'
    })
  })
  await sleep(300)
  const box = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.cross-tbl')].find(tb => tb.getAttribute('role') === 'grid')
    const th = t.querySelector('thead th.fc-cycle')
    const r = th.getBoundingClientRect()
    return { x: +r.left.toFixed(0), y: +r.top.toFixed(0), w: +r.width.toFixed(0) }
  })
  console.log('高亮列位置 =', JSON.stringify(box))
  await page.screenshot({ path: '/tmp/v184-view-mode.png' })
  await page.screenshot({ path: '/tmp/v184-col-zoom.png', clip: { x: Math.max(0, box.x - 300), y: Math.max(0, box.y - 10), width: 760, height: 620 } })
  console.log('截图: /tmp/v184-view-mode.png , /tmp/v184-col-zoom.png')
  await browser.close()
})().catch(e => { console.error('FATAL', e); process.exit(2) })
