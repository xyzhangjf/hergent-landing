/* 「目标与返利 › 仪表盘」审查取证（2026-09-18）
 *
 * 只读：走 POST /api/auth/demo-login 拿演示租户（tenant 10，只读）令牌，
 * 直接对生产 https://hergent.cn 截图 + 量取客观数字。
 * 不写任何数据，不需要账号密码。
 *
 * 产出：OUT 目录下 png + measure.json
 * 用法：HG_OUT=... node rebate-dashboard-audit-shot.js
 */
const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer-core')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = process.env.HG_OUT
  || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/目标与返利-仪表盘审查-2026-09-18'
// 注意：必须用「是否设置过」判断 —— 用 `||` 时 `HG_PROXY=`(空串) 会被静默回落到默认代理，
// 表现为 net::ERR_PROXY_CONNECTION_FAILED，看起来像"站点不可达"。
const PROXY = process.env.HG_PROXY !== undefined
  ? process.env.HG_PROXY
  : 'http://127.0.0.1:63932'
const SITE = process.env.HG_SITE || 'https://hergent.cn'
const sleep = ms => new Promise(r => setTimeout(r, ms))

fs.mkdirSync(OUT, { recursive: true })

/* 页面内测量：文本节点数 / 字数 / 区块盒模型 / 列表行高 / 每行数字个数 */
function measureFn() {
  const vis = el => {
    if (!el) return false
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 1 && r.height > 1
  }
  const txt = el => (el.textContent || '').replace(/\s+/g, ' ').trim()

  // 🔴 判据修正：原先只收「无子元素的叶子」会**漏掉** `.mac-legend` / `.rr-meta` 这类
  //    「span 里套 <i>/<b>」的节点（图例 4 条、行内 5 个指标全被算漏，64 节点是低估）。
  //    正确口径 = 元素**自身**的直接文本节点非空（不论有没有子元素）。
  const own = el => [...el.childNodes]
    .filter(n => n.nodeType === 3).map(n => n.textContent).join(' ')
    .replace(/\s+/g, ' ').trim()
  const leaves = []
  document.querySelectorAll('.page *').forEach(el => {
    if (!vis(el)) return
    const t = own(el)
    if (t) leaves.push({ t, tag: el.tagName.toLowerCase(), cls: String(el.className || '') })
  })
  const chars = leaves.reduce((s, x) => s + x.t.length, 0)
  // 说明性文案（口径/图例/读图说明）与数据性文案分开计数 —— 前者与数据量无关，
  // 是「每件事说两遍」的观测口径
  const isNote = x => /＝|=|口径|图例|视图|统计|柱高|条形|灰轨道|深色段|虚线|作用|说明/.test(x.t)
  const notes = leaves.filter(isNote)

  const box = sel => {
    const el = document.querySelector(sel)
    if (!vis(el)) return null
    const r = el.getBoundingClientRect()
    return { h: Math.round(r.height), w: Math.round(r.width) }
  }

  // 达成列表
  const rows = [...document.querySelectorAll('.dash-rank .rank-row')].filter(vis)
  const rowBoxes = rows.map(r => {
    const rr = r.getBoundingClientRect()
    const meta = [...r.querySelectorAll('.rr-meta > span')].filter(vis).map(txt)
    return {
      h: Math.round(rr.height),
      text: txt(r),
      meta,
      numGroups: (txt(r).match(/[¥]?[\d,]+(?:\.\d+)?/g) || []).length,
      zeroCount: (txt(r).match(/(?:^|[^\d.])0(?:\.0)?%?(?![\d])/g) || []).length,
    }
  })

  // KPI
  const kpis = [...document.querySelectorAll('.dash-kpi > *')].filter(vis).map(el => ({
    cls: el.className, t: txt(el).slice(0, 40),
  }))

  // 图表
  const legends = [...document.querySelectorAll('.mac-legend .lg-item')].filter(vis).map(txt)
  const secs = [...document.querySelectorAll('.mac-sec')].filter(vis).map(s => ({
    title: txt(s.querySelector('.sec-hd b') || { textContent: '' }),
    unit: txt(s.querySelector('.sec-u') || { textContent: '' }),
    note: txt(s.querySelector('.sec-note') || { textContent: '' }),
    h: Math.round(s.getBoundingClientRect().height),
    bars: s.querySelectorAll('rect.track').length,
    fills: s.querySelectorAll('rect.track ~ rect').length,
    labels: s.querySelectorAll('text.bar-lb').length,
  }))

  return {
    leafCount: leaves.length,
    charCount: chars,
    noteCount: notes.length,
    noteChars: notes.reduce((s, x) => s + x.t.length, 0),
    notes: notes.map(x => ({ t: x.t, cls: x.cls })),
    regions: {
      page: box('.page'),
      dashCard: box('.dash-card'),
      head: box('.dash-hd'),
      kpi: box('.dash-kpi'),
      chart: box('.dash-chart'),
      anom: box('.dash-anom'),
      rank: box('.dash-rank'),
      chartSub: box('.mac-sub'),
      chartFt: box('.mac-ft'),
      rankHd: box('.rank-hd'),
    },
    kpis,
    rowCount: rows.length,
    rowBoxes,
    rowSumH: rowBoxes.reduce((s, x) => s + x.h, 0),
    legends,
    secs,
    texts: leaves.map(x => x.t),
  }
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--ignore-certificate-errors',
      ...(PROXY ? ['--proxy-server=' + PROXY] : ['--no-proxy-server'])],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1560, height: 1000, deviceScaleFactor: 1 })
  page.on('dialog', d => d.accept())

  await page.goto(SITE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  // 演示只读登录
  const login = await page.evaluate(async () => {
    const r = await fetch('/api/auth/demo-login', { method: 'POST' })
    const d = await r.json()
    localStorage.setItem('hergent_v2_token', d.token || '')
    localStorage.setItem('hergent_v2_tenant', String(d.tenant_id || ''))
    localStorage.setItem('hergent_v2_user', JSON.stringify(d.user || null))
    return { ok: r.ok, tenant: d.tenant_id, user: d.user }
  })
  console.log('demo-login:', JSON.stringify(login))

  await page.goto(SITE + '/#/rebate', { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(3500)

  const m = await page.evaluate(measureFn)
  fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify(m, null, 1), 'utf8')

  await page.screenshot({ path: path.join(OUT, 'A-全页-1560.png'), fullPage: true })
  const card = await page.$('.dash-card')
  if (card) await card.screenshot({ path: path.join(OUT, 'B-仪表盘卡-1560.png') })
  const chart = await page.$('.dash-chart')
  if (chart) await chart.screenshot({ path: path.join(OUT, 'C-图表-1560.png') })

  await page.setViewport({ width: 1024, height: 900, deviceScaleFactor: 1 })
  await sleep(1200)
  await page.screenshot({ path: path.join(OUT, 'D-窄屏-1024.png'), fullPage: true })
  if (chart) await chart.screenshot({ path: path.join(OUT, 'E-图表-1024.png') })

  console.log('leafCount =', m.leafCount, ' charCount =', m.charCount)
  console.log('regions   =', JSON.stringify(m.regions))
  console.log('rows      =', m.rowCount, ' sumH =', m.rowSumH, JSON.stringify(m.rowBoxes))
  console.log('kpis      =', JSON.stringify(m.kpis, null, 0))
  console.log('legends   =', JSON.stringify(m.legends))
  console.log('secs      =', JSON.stringify(m.secs))
  await browser.close()
})().catch(e => { console.error('FAIL', e && e.message); process.exit(1) })
