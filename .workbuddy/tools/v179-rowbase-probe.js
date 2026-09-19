// v179 主表行底 + 列映射确认：DOM 结构探测（只读，不点任何写操作）
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'e2e', display_name: '验证' }))
  }, TOKEN, TENANT)

  page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 160)) })
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)))

  await page.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await new Promise(r => setTimeout(r, 6000))
  console.log('URL:', page.url())

  const info = await page.evaluate(() => {
    const out = {}
    out.title = (document.querySelector('h1,h2,.page-title,.hd-title') || {}).textContent || ''
    const sel = document.querySelector('select')
    out.selects = [...document.querySelectorAll('select')].map(s => ({
      cls: s.className, n: s.options.length,
      cur: s.options[s.selectedIndex] ? s.options[s.selectedIndex].textContent : '',
      opts: [...s.options].map(o => o.textContent).slice(0, 12),
    }))
    out.toggles = [...document.querySelectorAll('label.tb-toggle')].map(l => l.textContent.trim())
    out.pname = document.querySelectorAll('.pname').length
    out.gridCtlRow = !!document.querySelector('.grid-ctl-row')
    out.ctlRowText = (document.querySelector('.grid-ctl-row') || {}).innerText || ''
    const btns = [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(Boolean)
    out.btns = btns.slice(0, 60)
    out.fileInputs = [...document.querySelectorAll('input[type=file]')].map(i => ({ cls: i.className, accept: i.accept }))
    out.bodyLen = document.body.innerText.length
    return out
  })
  console.log(JSON.stringify(info, null, 1))
  await browser.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
