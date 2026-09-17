// v184b 交付截图：商品档案页「到货周期」列（查看态 + 行内编辑态 + 列特写）
// 用法：HG_TOKEN=... HG_TENANT=9999 NODE_PATH=<ws>[:<repo>/node_modules] node <本文件>
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
  await page.setViewport({ width: 1600, height: 950, deviceScaleFactor: 2 })
  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
  }, TOKEN, TENANT)
  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/archive/products', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(4000)

  // ① 查看态：本页同时含已设（+N天）与未设（未设）两种态
  await page.screenshot({ path: OUT + '/01-档案页到货周期列.png' })
  console.log('① ' + OUT + '/01-档案页到货周期列.png')

  // ② 列特写：整列 + 表头
  const box = await page.evaluate(() => {
    const t = document.querySelector('table.tbl')
    const th = [...t.querySelectorAll('thead th')].find(x => x.textContent.trim() === '到货周期')
    if (!th) return null
    const r = th.getBoundingClientRect()
    const rows = t.querySelectorAll('tbody tr')
    const last = rows[Math.min(rows.length - 1, 11)].getBoundingClientRect()
    return { x: Math.max(0, r.left - 46), y: Math.max(0, r.top - 26), width: r.width + 300, height: Math.min(520, last.bottom - r.top + 26) }
  })
  if (box) {
    await page.screenshot({ path: OUT + '/02-到货周期列特写.png', clip: box })
    console.log('② ' + OUT + '/02-到货周期列特写.png')
  }

  // ③ 行内编辑态（找一行有值的点开，并已填好输入）
  const clicked = await page.evaluate(() => {
    const t = document.querySelector('table.tbl')
    const th = [...t.querySelectorAll('thead th')].find(x => x.textContent.trim() === '到货周期')
    const idx = [...t.querySelectorAll('thead th')].indexOf(th)
    const rows = [...t.querySelectorAll('tbody tr')]
    for (let i = 0; i < rows.length; i++) {
      const td = rows[i].children[idx]
      const sp = td && td.querySelector('.pa-cyc-val, .pa-cyc-none')
      if (sp) { sp.click(); return { i, was: sp.textContent.trim() } }
    }
    return null
  })
  await sleep(400)
  await page.screenshot({ path: OUT + '/03-行内编辑态.png' })
  console.log('③ ' + OUT + '/03-行内编辑态.png  ' + JSON.stringify(clicked))
  await browser.close()
})().catch(e => { console.error('FATAL', e); process.exit(2) })
