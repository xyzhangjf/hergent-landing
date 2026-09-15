/**
 * v173 · 达成填报表「tag 断行」修法试算
 * 逐候选注入 CSS，量 ①是否还断行 ②表格是否横向溢出。三种视口全跑，选出代价最小且不溢出的。
 */
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9997'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const CANDIDATES = [
  { id: 'A-现状', css: '' },
  { id: 'B-只加nowrap', css: '.achv-card .tbl .tag{white-space:nowrap}' },
  { id: 'C-nowrap+列最小宽', css: '.achv-card .tbl .tag{white-space:nowrap}.achv-card .tbl th{white-space:nowrap}' },
  { id: 'D-缩chip内边距', css: '.achv-card .tbl .tag{padding:0 5px}' },
  { id: 'E-nowrap+缩输入框', css: '.achv-card .tbl .tag{white-space:nowrap}.achv-card .num-input{width:100px}' },
]

const measure = () => {
  const card = document.querySelector('.achv-card')
  const wrap = card.querySelector('.table-wrap')
  const tbl = card.querySelector('table.tbl')
  const ths = [...tbl.querySelectorAll('thead th')]
  let wrapN = 0
  tbl.querySelectorAll('tbody td .tag').forEach(t => {
    const tn = [...t.childNodes].find(n => n.nodeType === 3)
    if (!tn) return
    const r = document.createRange(); r.selectNodeContents(tn)
    if (new Set([...r.getClientRects()].filter(x => x.height > 1).map(x => Math.round(x.top))).size > 1) wrapN++
  })
  return {
    overflow: wrap.scrollWidth - wrap.clientWidth,
    tableW: Math.round(tbl.getBoundingClientRect().width),
    wrapW: wrap.clientWidth,
    wrapN,
    cols: ths.map(th => Math.round(th.getBoundingClientRect().width)).join(','),
    colNames: ths.map(th => (th.textContent || '').replace(/\s+/g, '')).join('|'),
  }
}

;(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'] })
  const results = {}
  for (const vw of [1440, 1280, 1024]) {
    const p = await b.newPage()
    await p.evaluateOnNewDocument((t, ten) => {
      localStorage.setItem('hergent_v2_token', t); localStorage.setItem('hergent_v2_tenant', String(ten))
      localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'sbx', display_name: '验收' }))
    }, TOKEN, TENANT)
    await p.setViewport({ width: vw, height: 1000, deviceScaleFactor: 1 })
    await p.goto(`${BASE}/?cb=${Date.now()}#/rebate`, { waitUntil: 'networkidle2', timeout: 60000 })
    await sleep(7000)
    await p.evaluate(() => {
      const b = [...document.querySelectorAll('.main-tab')].find(x => (x.textContent || '').indexOf('达成填报') >= 0)
      if (b) b.click()
    })
    await sleep(6000)
    console.log(`\n########## vw=${vw} ##########`)
    for (const c of CANDIDATES) {
      await p.evaluate(css => {
        document.getElementById('v173cand')?.remove()
        if (!css) return
        const s = document.createElement('style'); s.id = 'v173cand'; s.textContent = css
        document.head.appendChild(s)
      }, c.css)
      await sleep(450)
      const m = await p.evaluate(measure)
      results[`${vw}|${c.id}`] = m
      console.log(`  ${c.id.padEnd(16)} 断行tag=${m.wrapN}  溢出=${m.overflow}px  表宽=${m.tableW}/${m.wrapW}  列宽=${m.cols}`)
    }
    await p.close()
  }
  console.log('\n列名顺序:', Object.values(results)[0].colNames)
  console.log('\n===== 结论 =====')
  for (const c of CANDIDATES) {
    if (c.id === 'A-现状') continue
    const lines = [1440, 1280, 1024].map(vw => {
      const m = results[`${vw}|${c.id}`]
      return `${vw}: 断行${m.wrapN} 溢出${m.overflow}`
    })
    const ok = [1440, 1280, 1024].every(vw => results[`${vw}|${c.id}`].wrapN === 0 && results[`${vw}|${c.id}`].overflow <= 1)
    console.log(`  ${ok ? '✅' : '❌'} ${c.id}  ${lines.join(' | ')}`)
  }
  await b.close()
})()
