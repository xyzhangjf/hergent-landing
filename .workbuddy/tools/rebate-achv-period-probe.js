/**
 * 达成填报「周期口径」按钮评估取证（2026-09-15）
 *
 * 目的：实测三种口径（按月 / 按季 / 按年）下「达成填报」表格实际渲染出什么 ——
 *       行数、规则行是否出现、目标值列取值、表头措辞。
 *       用于判断这个下拉是否还有保留价值、以及它是否把用户带进了错误的存储桶。
 *
 * 用法：
 *   HG_TOKEN=xxx HG_TENANT=9997 HG_BASE=https://hergent.cn \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node rebate-achv-period-probe.js
 *
 * 输出：/tmp/achv-period/*.png + 三口径表格文本
 */
const puppeteer = require('puppeteer-core')
const fs = require('fs')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9997'
const VW = parseInt(process.env.VW || '1440', 10)
const OUT = '/tmp/achv-period'
const sleep = ms => new Promise(r => setTimeout(r, ms))

// 只序列化函数源码 → 普通函数 + 无闭包
const probe = () => {
  const txt = el => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null)
  const card = document.querySelector('.achv-card')
  const sel = document.querySelector('.achv-period')
  const mo = document.querySelector('.achv-month')
  const tbl = card ? card.querySelector('table.tbl') : null
  const heads = tbl ? [...tbl.querySelectorAll('thead th')].map(x => (x.textContent || '').trim()) : null
  const rows = tbl ? [...tbl.querySelectorAll('tbody tr')].map(tr =>
    [...tr.querySelectorAll('td')].map(td => {
      const inp = td.querySelector('input')
      if (inp) return '{' + (String(inp.value) === '' ? '空' : String(inp.value)) + '}'
      return (td.textContent || '').replace(/\s+/g, ' ').trim()
    })) : null
  // 全年月度对比表
  const ycard = document.querySelector('.achv-year')
  const yrows = ycard ? [...ycard.querySelectorAll('tbody tr')].map(tr =>
    [...tr.querySelectorAll('td')].map(td => (td.textContent || '').replace(/\s+/g, ' ').trim())) : null
  const isVisible = el => el ? (el.getBoundingClientRect().height > 0) : false
  return {
    hasSel: !!sel,
    periodValue: sel ? sel.value : null,
    periodOptions: sel ? [...sel.options].map(o => o.value + '=' + o.text) : null,
    periodLabel: card ? txt([...card.querySelectorAll('.achv-lb')].find(x => (x.textContent || '').includes('周期口径'))) : null,
    monthValue: mo ? mo.value : null,
    monthPlaceholder: mo ? mo.getAttribute('placeholder') : null,
    barText: card ? txt(card.querySelector('.achv-bar')) : null,
    heads,
    rows,
    rowCount: rows ? rows.length : 0,
    emptyText: card ? txt(card.querySelector('.state-empty')) : null,
    yTableVisible: isVisible(ycard),
    yRowCount: yrows ? yrows.length : 0,
    barH: card && card.querySelector('.achv-bar') ? Math.round(card.querySelector('.achv-bar').getBoundingClientRect().height) : null,
  }
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
    protocolTimeout: 240000
  })
  const p = await b.newPage()
  const errs = []
  const apiLog = []
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()) })
  p.on('response', async r => {
    const u = r.url()
    if (u.indexOf('rebate-achievements') >= 0) {
      let body = ''
      try { body = (await r.text()).slice(0, 700) } catch (e) { body = '(unreadable)' }
      apiLog.push(r.request().method() + ' ' + u.replace(BASE, '') + '  -> ' + body)
    }
  })

  await p.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'sbx_period', display_name: '口径验收' }))
  }, TOKEN, TENANT)
  await p.setViewport({ width: VW, height: 980, deviceScaleFactor: 1 })

  console.log(`\n########## 达成填报「周期口径」取证  ${BASE}  tenant=${TENANT}  vw=${VW} ##########`)
  await p.goto(`${BASE}/?cb=${Date.now()}#/rebate`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(7000)

  // 切到「达成填报」Tab
  const tabHit = await p.evaluate(() => {
    const b = [...document.querySelectorAll('.main-tab')].find(x => (x.textContent || '').indexOf('达成填报') >= 0)
    if (!b) return 'no-tab'
    b.click(); return 'clicked'
  })
  console.log('切 Tab:', tabHit)
  await sleep(6000)

  const results = {}
  for (const pv of ['month', 'quarter', 'year']) {
    const set = await p.evaluate((v) => {
      const s = document.querySelector('.achv-period')
      if (!s) return 'no-select'
      s.value = v
      s.dispatchEvent(new Event('change', { bubbles: true }))
      return 'set:' + v
    }, pv)
    await sleep(5200)
    const snap = await p.evaluate(probe)
    results[pv] = snap
    await p.screenshot({ path: `${OUT}/period-${pv}.png` })
    console.log('\n================ 口径 = ' + pv + ' (' + set + ') ================')
    console.log('  下拉当前值     :', snap.periodValue, '| 选项:', (snap.periodOptions || []).join(', '))
    console.log('  时间键输入框值 :', JSON.stringify(snap.monthValue), '| placeholder:', snap.monthPlaceholder)
    console.log('  工具行文本     :', snap.barText)
    console.log('  表头           :', (snap.heads || []).join(' | '))
    console.log('  行数           :', snap.rowCount)
    if (snap.emptyText) console.log('  空态           :', snap.emptyText)
    ;(snap.rows || []).forEach((r, i) => console.log('    [' + (i + 1) + '] ' + r.join(' | ')))
    console.log('  全年对比表     : 可见=' + snap.yTableVisible + ' 行数=' + snap.yRowCount)
  }

  console.log('\n================ 接口调用轨迹（rebate-achievements） ================')
  apiLog.forEach(x => console.log('  ' + x))

  console.log('\n================ 判定 ================')
  const m = results.month, q = results.quarter, y = results.year
  const say = (c, s) => console.log('  ' + (c ? '✅' : '❌') + ' ' + s)
  say(m.rowCount > 0, '按月：表格有行（' + m.rowCount + ' 行）')
  say((m.heads || []).includes('月度目标'), '按月：第 3 列表头为「月度目标」')
  say(q.rowCount === m.rowCount, '按季：行数与按月一致（' + q.rowCount + ' vs ' + m.rowCount + '）')
  say(y.rowCount === m.rowCount, '按年：行数与按月一致（' + y.rowCount + ' vs ' + m.rowCount + '）')
  say((q.heads || []).includes('目标值') && !(q.heads || []).includes('月度目标'), '按季：表头退化为「目标值」')
  say((y.heads || []).includes('目标值') && !(y.heads || []).includes('月度目标'), '按年：表头退化为「目标值」')
  const qRows = JSON.stringify(q.rows), yRows = JSON.stringify(y.rows)
  say(qRows !== yRows || q.monthValue !== y.monthValue, '按季 vs 按年：表格内容或时间键不同（季=' + q.monthValue + ' 年=' + y.monthValue + '）')
  say(true, '年/季口径下时间键为文本输入（placeholder=' + q.monthPlaceholder + '/' + y.monthPlaceholder + '）')
  console.log('\n  console 错误数:', errs.length)
  errs.slice(0, 12).forEach(e => console.log('    ' + e))
  console.log('\n截图目录: ' + OUT)
  await b.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
