/* 真机验收：返利冲刺看板「进度」列（文案 + 进度条 + 时间进度虚线）
 *
 * MODE=before → v181 改动前基线：进度单元格内**没有**任何文案（.sp-pace 计数应为 0），
 *                但进度条 / 时间进度虚线照常渲染（证明取到的是真模块、不是没渲染）
 * MODE=after  → v183 验收：文案＝「达成率 X%」（**不再**标注与时间进度的差值）+
 *                达成率数值独立复算一致 + 配色与进度条同源 +
 *                页头时间进度与行内虚线同源（这是「用户能一眼看出超前/落后」的前提）+
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

/* 制造「文案放不下」的状态。
   ⚠️ 不能靠压 td：table-layout:auto 把列宽**下限**顶在 max(td 自带 min-width:110px, 文案 min-content) 上，
   td 的 max-width 对列宽无效 —— 实测给它 64px，列宽仍是 102.8px（= 文案 74.8 + padding 28），文案恰好放得下。
   v181/182 用压 td 能触发，是因为当时文案 212px 本身就超过该下限；v183 文案缩短到 74.8px 后就压不出来了。
   ⇒ 直接约束 `.sp-pace` 自身宽度，才是「空间不足」的等价模拟（等价于列宽被外部锁死）。 */
function squeeze(mode) {
  const card = document.querySelector('.sprint-card')
  const spans = card.querySelectorAll('table.tbl tbody .sp-pace')
  spans.forEach(s => { s.style.maxWidth = (mode === 'narrow') ? '64px' : '' })
  window.dispatchEvent(new Event('resize'))
  return spans.length
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
  // 页头时间进度（1 位小数）—— 用户据以目视对比的基准值，C / D2 两段共用
  const tpPct = (() => { const m = (S0.tpText || '').match(/([\d.]+)%/); return m ? parseFloat(m[1]) : null })()
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

  console.log('\n=== B. 文案已渲染（v183：只有「达成率 X%」）===')
  const RE = /^达成率 \d+(\.\d)?%$/
  ok(S0.nPace === S0.nRows, '每行都渲染了文案节点', `nPace=${S0.nPace} nRows=${S0.nRows}`)
  S0.rows.forEach(r => {
    ok(r.pace && RE.test(r.pace.text), `行${r.i + 1}「${r.obj}」文案格式合规`, r.pace ? r.pace.text : '(无)')
  })
  // 冗余信息必须真删净：**表格行内**不得再出现对比口径字样。
  // ⚠️ 范围只限 tbody —— 页头「虚线＝时间进度…超前/落后」是虚线与配色的**图例**（承载口径），必须保留。
  const legacyRow = await page.evaluate(() => {
    const out = []
    document.querySelectorAll('.sprint-card table.tbl tbody tr').forEach(tr => {
      const t = tr.innerText + ' ' + [...tr.querySelectorAll('[title]')].map(e => e.getAttribute('title')).join(' ')
      const m = t.match(/落后时间进度|超过时间进度|与时间进度持平/g)
      if (m) out.push(...m)
    })
    return out
  })
  ok(legacyRow.length === 0, '表格行内已无「落后/超过时间进度 X%」（每行冗余判语删净）', legacyRow.slice(0, 3).join(',') || '无')
  // 图例本身必须仍在 —— 删掉它，「虚线＝什么」就没人解释了
  const legend = await page.evaluate(() => {
    const e = document.querySelector('.sprint-card .sprint-tp')
    return e ? (e.getAttribute('title') || '') : ''
  })
  ok(/虚线/.test(legend), '页头「虚线＝时间进度」图例仍在（承载口径，不可随手删）', legend.slice(0, 40))

  console.log('\n=== C. 达成率数值独立复算（不读组件状态，只用表内金额）===')
  S0.rows.forEach(r => {
    if (!r.pace) return
    const ach = num(r.target) > 0 ? (num(r.reported) + num(r.contrib)) / num(r.target) : 0
    const m = r.pace.text.match(/([\d.]+)/)
    const shown = m ? parseFloat(m[1]) : NaN
    const got = r.pace.cls.indexOf('pace-ahead') >= 0 ? 'ahead'
      : (r.pace.cls.indexOf('pace-behind') >= 0 ? 'behind' : 'even')
    const want = tpPct == null ? '(不可比)'
      : (Math.abs(ach * 100 - tpPct) < 0.05 ? 'even' : (ach * 100 > tpPct ? 'ahead' : 'behind'))
    info(`  行${r.i + 1} ${r.target} 达成 ${r.reported}+${r.contrib} → 达成率 ${(ach * 100).toFixed(3)}% · 色=${got} · 文案=${r.pace.text}`)
    ok(Math.abs(shown - ach * 100) <= 0.06, `行${r.i + 1} 达成率数值准确（真实 ${(ach * 100).toFixed(2)}% → 显示 ${shown}%）`)
    ok(got === want, `行${r.i + 1} 配色方向正确（期望 ${want}）`, 'got=' + got)
  })

  console.log('\n=== D. 文字色与进度条红绿同源（同一份判定，不得出现「色说落后、条是绿」）===')
  S0.rows.forEach(r => {
    if (!r.pace) return
    const behind = r.pace.cls.indexOf('pace-behind') >= 0
    const red = /red/.test(r.barCls || '')
    ok(behind === red, `行${r.i + 1} 文字色与进度条着色一致（落后=${behind} 红=${red}）`)
  })

  console.log('\n=== D2. 「一眼看出超前/落后」的前提：页头时间进度 = 行内虚线 = 真实日期进度 ===')
  // 用户判据已改为「文案只给达成率，读者自己与时间进度比」⇒ 时间进度本身必须准确才是真前提。
  // 这里从零用系统日期复算（不读组件状态），并核页头与虚线彼此同源。
  const realFrac = await page.evaluate(() => {
    const n = new Date()
    return n.getDate() / new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()
  })
  const markFrac = (S0.rows.find(r => r.tpFrac != null) || {}).tpFrac
  if (markFrac == null) {
    info(`  当期到货月不是本月（页头「${S0.tpText}」）→ 虚线不渲染，本段跳过（属正常分支）`)
  } else {
    info(`  真实日期进度=${(realFrac * 100).toFixed(3)}% · 页头=${S0.tpText} · 虚线=${(markFrac * 100).toFixed(3)}%`)
    ok(Math.abs(markFrac - realFrac) <= 0.005, '行内虚线位置 = 真实日期进度（不是写死的）')
    ok(tpPct != null && Math.abs(tpPct - realFrac * 100) <= 0.1, `页头时间进度 = 真实日期进度（1 位小数）`, `页头 ${tpPct}% vs 真实 ${(realFrac * 100).toFixed(2)}%`)
    ok(tpPct != null && Math.abs(tpPct / 100 - markFrac) <= 0.005, '页头时间进度与行内虚线同源（用户据以目视对比的两个东西必须一致）')
  }

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
  // 被约束后 scrollW 不再被 clientW 抬平 ⇒ 这才是文案的**自然宽**（未截断时 scrollW==clientW，量不出文字宽）
  const nat = (S1.rows[0] && S1.rows[0].pace) ? S1.rows[0].pace.scrollW : null
  if (nat != null && S0.rows[0]) {
    info(`  文案自然宽=${nat}px · 占完整列宽(${S0.rows[0].tdW}px)的 ${Math.round(nat / S0.rows[0].tdW * 100)}% ⇒ ` +
      (nat < S0.rows[0].tdW ? '有余量，常见宽度下必然直接显示' : '⚠️ 已超过列宽'))
  }
  ok(S1.rows.every(r => !r.pace || !r.pace.visible), '压窄后所有行文案均隐藏（不再显示半截文字）')
  ok(S1.rows.some(r => /^达成率 /.test(r.barTitle)), '隐藏后进度条挂上了 hover 提示', (S1.rows.find(r => r.barTitle) || {}).barTitle)
  const hovered = S1.rows.find(r => /^达成率 /.test(r.barTitle))
  if (hovered && hovered.pace) {
    ok(hovered.barTitle === hovered.pace.text, 'hover 提示与该行文案逐字一致（同源，不是第二套文案）', hovered.barTitle)
  }
  if (nat != null && S0.rows[0]) {
    ok(nat < S0.rows[0].tdW, '文案自然宽 < 列宽（有余量 ⇒ 常见宽度下不会截断，降级几乎不会触发）', `${nat} < ${S0.rows[0].tdW}`)
  }
  await page.evaluate(squeeze, 'restore')
  await sleep(900)
  const S2 = await page.evaluate(snap)
  ok(S2.rows.filter(r => r.pace && r.pace.visible).length === vis.length, '复原宽度后文案可见性回到原状（自适应可逆）')
  ok(S2.rows.every(r => !r.barTitle), '文案可见时进度条不再挂冗余 hover 提示')

  console.log('\n=== G. 运行期健康 ===')
  ok(errs.length === 0, '零 console/page 错误', errs.slice(0, 3).join(' | '))
  ok(bad.length === 0, '无 4xx/5xx 资源请求', bad.slice(0, 3).join(' | '))

  require('fs').mkdirSync(OUT, { recursive: true })   // HG_OUT 指向新目录时不必手工建
  await page.screenshot({ path: OUT + '/v183-冲刺达成率文案.png', fullPage: false })
  console.log('\n结果：PASS ' + results.filter(r => r.pass).length + ' / FAIL ' + results.filter(r => !r.pass).length)
  await browser.close()
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
