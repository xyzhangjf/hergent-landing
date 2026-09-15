/**
 * 精确定论：.tag 里的文字到底有没有断行。
 * 用 Range.getClientRects() 数行数（换行的文字必有 >=2 个 line box）+ 量 chip 的 scrollWidth/clientWidth。
 */
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9997'
const VW = parseInt(process.env.VW || '1440', 10)
const sleep = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'] })
  const p = await b.newPage()
  await p.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t); localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'sbx', display_name: '验收' }))
  }, TOKEN, TENANT)
  await p.setViewport({ width: VW, height: 1000, deviceScaleFactor: 1 })
  await p.goto(`${BASE}/?cb=${Date.now()}#/rebate`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(7000)
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('.main-tab')].find(x => (x.textContent || '').indexOf('达成填报') >= 0)
    if (b) b.click()
  })
  await sleep(6000)

  const rep = await p.evaluate(() => {
    const tbl = document.querySelector('.achv-card table.tbl')
    const out = []
    tbl.querySelectorAll('tbody tr td .tag').forEach(t => {
      const tn = [...t.childNodes].find(n => n.nodeType === 3)
      let lines = 1, rects = 0
      if (tn) {
        const r = document.createRange(); r.selectNodeContents(tn)
        const rs = [...r.getClientRects()].filter(x => x.height > 1)
        rects = rs.length
        lines = new Set(rs.map(x => Math.round(x.top))).size
      }
      out.push({ text: (t.textContent || '').trim(), w: Math.round(t.getBoundingClientRect().width),
                 h: Math.round(t.getBoundingClientRect().height), lines, rects,
                 scrollW: t.scrollWidth, clientW: t.clientWidth,
                 cssWS: getComputedStyle(t).whiteSpace, wordBreak: getComputedStyle(t).wordBreak,
                 overflow: getComputedStyle(t).overflow })
    })
    return out
  })
  console.log(`\n===== .tag 文字换行精确定论  vw=${VW} =====`)
  rep.forEach(r => console.log('  ', JSON.stringify(r)))
  console.log('\n  有断行的 tag 数:', rep.filter(r => r.lines > 1).length, '/', rep.length)
  await p.screenshot({ path: '/tmp/v173-period/tag-lines.png', clip: { x: 240, y: 200, width: 800, height: 200 } })
  await b.close()
})()
