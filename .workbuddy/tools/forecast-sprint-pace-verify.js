/* v181 真机验收：返利冲刺看板「进度条 vs 时间进度」对比文案
 *
 * MODE=before → 改动前基线：进度单元格内**没有**对比文案（.sp-pace 计数应为 0），
 *                但进度条 / 时间进度虚线照常渲染（证明取到的是真模块、不是没渲染）
 * MODE=after  → 验收：三态文案渲染 + 差值数值独立复算一致 + 与进度条红绿同源 +
 *                空间不足时降级为进度条 hover 提示 + 运行期零报错
 *
 * 用法: HG_TOKEN=<t> HG_TENANT=9998 MODE=after node forecast-sprint-pace-verify.js
 *      复跑（不想弄脏仓库 outputs/）时用 HG_OUT=/tmp/shots 改输出目录。
 */
const puppeteer = require('puppeteer-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const OUT = process.env.HG_OUT || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9998'
const MODE = process.env.MODE || 'after'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const results = []
function ok(cond, label, extra) {
  results.push({ pass: !!cond, label })
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '   [' + extra + ']' : ''))
}
function info(m) { console.log('  · ' + m) }

/* 浏览器内：采集冲刺看板进度列（含对比文案 / 进度条 / 虚线 / 行金额） */
function snap() {
  const card = document.querySelector('.sprint-card')
  if (!card) return { err: 'no .sprint-card' }
  const tbl = card.querySelector('table.tbl')
  if (!tbl) return { err: 'no table.tbl' }
  const ths = [...tbl.querySelectorAll('thead th')].map(t => (t.textContent || '').trim())
  const pIdx = ths.indexOf('进度')
  const tpEl = card.querySelector('.sprint-tp')
  const body = card.querySelector('.panel-body')
  const rows = [...tbl.querySelectorAll('tbody tr')].map((tr, i) => {
    const tds = [...tr.children]
    const td = tds[pIdx]
    if (!td) return { i, err: 'no td' }
    const bar = td.querySelector('.sp-bar')
    const prog = td.querySelector('.progress')
    const mark = td.querySelector('.sp-bar-mark')
    const pace = td.querySelector('.sp-pace')
    const iEl = prog ? prog.querySelector('i') : null
    const txt = el => (el && el.textContent ? el.textContent.trim() : '')
    return {
      i,
      obj: txt(tds[1]),
      target: txt(tds[3]), reported: txt(tds[4]), contrib: txt(tds[5]),
      fillStyleW: iEl ? iEl.style.width : null,
      barCls: prog ? prog.className : null,
      tpFrac: mark ? parseFloat(mark.style.left) / 100 : null,
      barW: bar ? Math.round(bar.getBoundingClientRect().width) : -1,
      tdW: Math.round(td.getBoundingClientRect().width),
      barTitle: bar ? (bar.getAttribute('title') || '') : '',
      pace: pace ? {
        text: txt(pace),
        cls: pace.className,
        k: pace.dataset.k,
        visible: getComputedStyle(pace).visibility !== 'hidden',
        scrollW: pace.scrollWidth,
        clientW: pace.clientWidth,
        color: getComputedStyle(pace).color,
        fontSize: getComputedStyle(pace).fontSize,
      } : null,
    }
  })
  return {
    ok: true,
    pIdx,
    tpText: tpEl ? tpEl.textContent.trim().replace(/\s+/g, '') : null,
    bodyVisible: body ? getComputedStyle(body).display !== 'none' : null,
    nPace: card.querySelectorAll('.sp-pace').length,
    nRows: rows.length,
    rows,
  }
}

/* 浏览器内：把进度列压窄 / 复原，并触发一次 resize 让组件重算「放得下」 */
function squeeze(mode) {
  const card = document.querySelector('.sprint-card')
  const tbl = card.querySelector('table.tbl')
  const ths = [...tbl.querySelectorAll('thead th')].map(t => (t.textContent || '').trim())
  const pIdx = ths.indexOf('进度')
  const tds = [...tbl.querySelectorAll('tbody tr')].map(tr => tr.children[pIdx])
  tds.forEach(td => {
    if (!td) return
    if (mode === 'narrow') { td.style.maxWidth = '64px'; td.style.minWidth = '64px' }
    else { td.style.maxWidth = ''; td.style.minWidth = '' }
  })
  window.dispatchEvent(new Event('resize'))
  return tds.length
}

const num = s => { const m = String(s == null ? '' : s).replace(/[^\d.]/g, ''); return m ? parseFloat(m) : 0 }

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1680, height: 950, deviceScaleFactor: 1 })
  const errs = [], bad = []
  page.on('pageerror', e => errs.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)) })
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 110)) })

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'sbx_verify', display_name: '沙箱只读账号' }))
  }, TOKEN, TENANT)
  await page.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(8000)

  console.log('\n=== A. 展开返利冲刺看板 ===')
  const opened = await page.evaluate(() => {
    const card = document.querySelector('.sprint-card')
    if (!card) return 'no-card'
    const b = card.querySelector('.panel-hd .imp-x')
    if (!b) return 'no-btn'
    const body = card.querySelector('.panel-body')
    if (body && getComputedStyle(body).display !== 'none') return 'already-open'
    b.click(); return 'clicked'
  })
  ok(opened === 'clicked' || opened === 'already-open', '冲刺看板展开', opened)
  if (opened === 'no-card' || opened === 'no-btn') { await browser.close(); process.exit(1) }
  await sleep(1500)

  const S0 = await page.evaluate(snap)
  if (S0.err) { console.log('  FATAL: ' + S0.err); await browser.close(); process.exit(1) }
  info(`进度列 c=${S0.pIdx} · ${S0.nRows} 行 · 页头「${S0.tpText}」· .sp-pace 计数=${S0.nPace}`)
  S0.rows.forEach(r => info(`  行${r.i + 1} ${r.obj} 目标=${r.target} 达成=${r.reported} 贡献=${r.contrib} 条=${r.fillStyleW} ${r.barCls} 虚线=${r.tpFrac}`))
  ok(S0.nRows > 0, '进度列渲染出数据行')
  ok(S0.rows.every(r => r.barCls), '每行都有进度条（模块正常渲染）')
  ok(S0.rows.some(r => r.tpFrac != null), '时间进度虚线存在（说明当期=当月，比较有意义）')

  if (MODE === 'before') {
    console.log('\n=== B(before). 改动前：进度单元格内没有对比文案 ===')
    ok(S0.nPace === 0, '进度单元格内无 .sp-pace 元素（改动前基线）', 'nPace=' + S0.nPace)
    ok(S0.rows.every(r => !r.pace), '每行都没有对比文案节点')
    console.log('\n结果：PASS ' + results.filter(r => r.pass).length + ' / FAIL ' + results.filter(r => !r.pass).length)
    await browser.close()
    return
  }

  console.log('\n=== B. 文案已渲染（三态之一）===')
  const RE = /^(落后时间进度|超过时间进度) \d+(\.\d)? 个百分点$|^与时间进度持平$/
  ok(S0.nPace === S0.nRows, '每行都渲染了对比文案节点', `nPace=${S0.nPace} nRows=${S0.nRows}`)
  S0.rows.forEach(r => {
    ok(r.pace && RE.test(r.pace.text), `行${r.i + 1}「${r.obj}」文案格式合规`, r.pace ? r.pace.text : '(无)')
  })

  console.log('\n=== C. 差值数值独立复算（不读组件状态，只用表内金额 + 虚线位置）===')
  S0.rows.forEach(r => {
    if (!r.pace || r.tpFrac == null) return
    const ach = num(r.target) > 0 ? (num(r.reported) + num(r.contrib)) / num(r.target) : 0
    const pp = (ach - r.tpFrac) * 100
    const near = Math.abs(pp) < 0.05
    const want = near ? 'even' : (pp > 0 ? 'ahead' : 'behind')
    const got = /^超过/.test(r.pace.text) ? 'ahead' : (/^落后/.test(r.pace.text) ? 'behind' : 'even')
    const m = r.pace.text.match(/([\d.]+)/)
    const shownPp = m && got !== 'even' ? parseFloat(m[1]) : 0
    info(`  行${r.i + 1} 达成=${(ach * 100).toFixed(3)}% 时间进度=${(r.tpFrac * 100).toFixed(3)}% 真实差=${pp.toFixed(3)}pp 文案=${r.pace.text}`)
    ok(got === want, `行${r.i + 1} 状态方向正确（期望 ${want}）`, 'got=' + got)
    if (got !== 'even') {
      ok(Math.abs(shownPp - Math.abs(pp)) <= 0.06, `行${r.i + 1} 差值数值准确（真实 ${Math.abs(pp).toFixed(2)} → 显示 ${shownPp}）`)
    }
  })

  console.log('\n=== D. 与进度条红绿同源（同一份判定，不得出现「文案说落后、进度条是绿」）===')
  S0.rows.forEach(r => {
    if (!r.pace) return
    const behind = /^落后/.test(r.pace.text)
    const red = /red/.test(r.barCls || '')
    ok(behind === red, `行${r.i + 1} 文案与进度条着色一致（落后=${behind} 红=${red}）`)
  })

  console.log('\n=== E. 空间充足 → 直接显示（不截断）===')
  const vis = S0.rows.filter(r => r.pace && r.pace.visible)
  info(`可见 ${vis.length}/${S0.nPace} · 列宽=${S0.rows[0] ? S0.rows[0].tdW : -1}px`)
  vis.forEach(r => ok(r.pace.scrollW <= r.pace.clientW, `行${r.i + 1} 文案完整显示未截断`, `scroll=${r.pace.scrollW} client=${r.pace.clientW}`))
  ok(vis.length > 0, '至少有一行空间充足、直接显示了文案', vis.length + ' 行')

  console.log('\n=== F. 空间不足 → 隐藏文案，改由进度条 hover 提示 ===')
  await page.evaluate(squeeze, 'narrow')
  await sleep(900)
  const S1 = await page.evaluate(snap)
  info(`压窄后：列宽=${S1.rows[0] ? S1.rows[0].tdW : -1}px · 文案可见 ${S1.rows.filter(r => r.pace && r.pace.visible).length}/${S1.nPace}`)
  ok(S1.rows.every(r => !r.pace || !r.pace.visible), '压窄后所有行文案均隐藏（不再显示半截文字）')
  ok(S1.rows.some(r => /个百分点|持平/.test(r.barTitle)), '隐藏后进度条挂上了 hover 提示', (S1.rows.find(r => r.barTitle) || {}).barTitle)
  const hovered = S1.rows.find(r => /个百分点|持平/.test(r.barTitle))
  if (hovered && hovered.pace) ok(hovered.barTitle.indexOf(hovered.pace.text) === 0, 'hover 提示以该行文案开头（口径一致）', hovered.barTitle)
  if (hovered && hovered.pace && hovered.tpFrac != null) {
    const tpShown = S0.tpText ? (S0.tpText.match(/([\d.]+)%/) || [])[1] : null
    ok(!!tpShown && hovered.barTitle.indexOf('时间进度 ' + tpShown + '%') >= 0,
      'hover 里的「时间进度」与页头同源同值', `页头=${tpShown}% hover=${hovered.barTitle}`)
  }
  await page.evaluate(squeeze, 'restore')
  await sleep(900)
  const S2 = await page.evaluate(snap)
  ok(S2.rows.filter(r => r.pace && r.pace.visible).length === vis.length, '复原宽度后文案可见性回到原状（自适应可逆）')
  ok(S2.rows.every(r => !r.barTitle), '文案可见时进度条不再挂冗余 hover 提示')

  console.log('\n=== G. 运行期健康 ===')
  ok(errs.length === 0, '零 console/page 错误', errs.slice(0, 3).join(' | '))
  ok(bad.length === 0, '无 4xx/5xx 资源请求', bad.slice(0, 3).join(' | '))

  await page.screenshot({ path: OUT + '/v181-进度条时间进度对比.png', fullPage: false })
  console.log('\n结果：PASS ' + results.filter(r => r.pass).length + ' / FAIL ' + results.filter(r => !r.pass).length)
  await browser.close()
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
