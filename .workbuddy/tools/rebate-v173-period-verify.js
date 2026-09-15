/**
 * v173「达成填报」周期口径改造 · 真机验收
 *
 * 验的是：① 下拉是否真的没了 ② 只剩月份选择器 ③ 表格新增「周期」列且标出规则口径
 *          ④ 本月目标按规则自身口径取值（年度规则取 monthly_amounts 当月分解额）
 *          ⑤ 生效期过滤是否修好（原来年口径下 '2026-09' > '2026' 恒真 → 带生效起始日的规则消失）
 *          ⑥ 接口是否只发月度键
 *
 * 用法：
 *   HG_TOKEN=xxx HG_TENANT=9997 HG_BASE=https://hergent.cn \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node rebate-v173-period-verify.js
 */
const puppeteer = require('puppeteer-core')
const fs = require('fs')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9997'
const VW = parseInt(process.env.VW || '1440', 10)
const OUT = '/tmp/v173-period'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const probe = () => {
  const txt = el => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '')
  const card = document.querySelector('.achv-card')
  const tbl = card ? card.querySelector('table.tbl') : null
  const heads = tbl ? [...tbl.querySelectorAll('thead th')].map(x => (x.textContent || '').trim()) : []
  const rows = tbl ? [...tbl.querySelectorAll('tbody tr')].map(tr => {
    const tds = [...tr.querySelectorAll('td')]
    const cell = td => {
      const inp = td.querySelector('input')
      if (inp) return '{' + (String(inp.value) === '' ? '空' : String(inp.value)) + '}'
      return (td.textContent || '').replace(/\s+/g, ' ').trim()
    }
    const tags = [...tr.querySelectorAll('td .tag')].map(t => (t.textContent || '').trim())
    return { cells: tds.map(cell), tags }
  }) : []
  const bar = card ? card.querySelector('.achv-bar') : null
  const mo = card ? card.querySelector('.achv-month') : null
  const wrap = card ? card.querySelector('.table-wrap') : null
  const ycard = document.querySelector('.achv-year')
  const yrows = ycard ? [...ycard.querySelectorAll('tbody tr')] : []
  return {
    // 下拉是否彻底消失
    selectCountInCard: card ? card.querySelectorAll('select').length : -1,
    periodSelect: !!document.querySelector('.achv-period'),
    periodOptionsAnywhere: [...document.querySelectorAll('option')].map(o => o.value).filter(v => v === 'quarter' || v === 'year'),
    // 工具行
    barLabels: card ? [...card.querySelectorAll('.achv-lb')].map(e => (e.textContent || '').trim()) : [],
    barText: txt(bar),
    monthType: mo ? mo.getAttribute('type') : null,
    monthValue: mo ? mo.value : null,
    // 表格
    heads,
    rowCount: rows.length,
    rows,
    emptyText: card ? txt(card.querySelector('.state-empty')) : '',
    tableW: tbl ? Math.round(tbl.getBoundingClientRect().width) : null,
    wrapW: wrap ? Math.round(wrap.getBoundingClientRect().width) : null,
    scrollW: wrap ? wrap.scrollWidth : null,
    overflows: wrap ? wrap.scrollWidth > wrap.clientWidth + 1 : null,
    yTableVisible: !!(ycard && ycard.getBoundingClientRect().height > 0),
    yRowCount: yrows.length,
    yRow09: (() => {
      const r = yrows.find(tr => (tr.textContent || '').replace(/\s+/g, ' ').includes('9 月'))
      return r ? [...r.querySelectorAll('td')].map(td => (td.textContent || '').replace(/\s+/g, ' ').trim()) : null
    })(),
  }
}

const say = (c, s, extra) => { console.log('  ' + (c ? '✅' : '❌') + ' ' + s + (extra ? '  ' + extra : '')); return c }
let allOk = true
const chk = (c, s, extra) => { if (!say(c, s, extra)) allOk = false }

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
    protocolTimeout: 240000,
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
      try { body = (await r.text()).slice(0, 200) } catch (e) { body = '(unreadable)' }
      apiLog.push(r.request().method() + ' ' + u.split('hergent.cn')[1] + '  -> ' + body)
    }
  })

  await p.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'sbx_period', display_name: '口径验收' }))
  }, TOKEN, TENANT)
  await p.setViewport({ width: VW, height: 1000, deviceScaleFactor: 1 })

  console.log(`\n########## v173 达成填报 · 真机验收   tenant=${TENANT}  vw=${VW} ##########`)
  await p.goto(`${BASE}/?cb=${Date.now()}#/rebate`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(7000)
  const tabHit = await p.evaluate(() => {
    const b = [...document.querySelectorAll('.main-tab')].find(x => (x.textContent || '').indexOf('达成填报') >= 0)
    if (!b) return 'no-tab'
    b.click(); return 'clicked'
  })
  console.log('切到「达成填报」Tab:', tabHit)
  await sleep(6500)

  const setMonth = async v => {
    const r = await p.evaluate(val => {
      const el = document.querySelector('.achv-card .achv-month')
      if (!el) return 'no-input'
      el.value = val
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return 'set:' + val
    }, v)
    await sleep(4500)
    return r
  }

  const snaps = {}
  for (const m of ['2026-09', '2026-10', '2026-08']) {
    const how = await setMonth(m)
    const s = await p.evaluate(probe)
    snaps[m] = s
    await p.screenshot({ path: `${OUT}/month-${m}.png` })
    console.log(`\n================ 月份 = ${m}  (${how}) ================`)
    console.log('  工具行        :', s.barText)
    console.log('  月份输入 type :', s.monthType, '| value:', s.monthValue)
    console.log('  表头          :', s.heads.join(' | '))
    console.log('  行数          :', s.rowCount, s.emptyText ? '| 空态:' + s.emptyText : '')
    s.rows.forEach((r, i) => console.log(`    [${i + 1}] ${r.cells.join(' | ')}   tags=${JSON.stringify(r.tags)}`))
    console.log('  表格宽度      :', s.tableW, '/ 容器', s.wrapW, '| scrollW', s.scrollW, '| 横向溢出:', s.overflows)
  }

  console.log('\n================ 接口调用轨迹 ================')
  apiLog.forEach(x => console.log('  ' + x))

  console.log('\n================ 判定 ================')
  const s9 = snaps['2026-09'], s10 = snaps['2026-10'], s8 = snaps['2026-08']
  chk(s9.selectCountInCard === 0, '「周期口径」下拉已从达成填报卡片彻底移除', `(卡片内 select 数=${s9.selectCountInCard})`)
  chk(s9.periodSelect === false, '全站不存在 .achv-period 控件')
  chk(s9.periodOptionsAnywhere.length === 0, '全站不存在 按季/按年 的 option', JSON.stringify(s9.periodOptionsAnywhere))
  chk(s9.barLabels.length === 1 && s9.barLabels[0] === '填报月份', '工具行只剩一个「填报月份」标签', JSON.stringify(s9.barLabels))
  chk(s9.monthType === 'month', '月份控件是原生月份选择器（type=month）', String(s9.monthType))
  chk(s9.heads.includes('周期'), '表头新增「周期」列', s9.heads.join('|'))
  chk(s9.heads.includes('本月目标'), '目标列表头改为「本月目标」')
  chk(!s9.heads.includes('月度目标') && !s9.heads.includes('目标值'), '旧的「月度目标 / 目标值」措辞已消失')
  chk(!s9.overflows, '表格无横向溢出（新增一列后仍放得下）', `scrollW=${s9.scrollW} clientW=${s9.wrapW}`)

  // 行内容：按作用对象取行
  const pick = (s, name) => (s.rows || []).find(r => (r.cells[1] || '').includes(name))
  const row9 = pick(s9, '蒙牛低温'), row9b = pick(s9, '简爱')
  chk(!!row9, '2026-09 出现「蒙牛低温」规则行')
  chk(!!row9b, '2026-09 出现「简爱」规则行（生效期 2026-09 —— 旧实现在年口径下会因字符串比较恒真而消失）')
  if (row9) {
    chk(row9.tags.includes('年度'), '蒙牛低温行的「周期」= 年度', JSON.stringify(row9.tags))
    chk(row9.cells[3] === '¥674,000', '蒙牛低温 2026-09 本月目标 = 其 9 月分解额 ¥674,000', row9.cells[3])
  }
  if (row9b) chk(row9b.cells[3] === '¥80,000', '简爱 2026-09 本月目标 = ¥80,000', row9b.cells[3])

  const row10 = pick(s10, '蒙牛低温')
  chk(!!row10 && row10.cells[3] === '¥700,000', '2026-10：蒙牛低温目标随月份切到 ¥700,000（该月分解额）', row10 && row10.cells[3])
  chk(!pick(s10, '简爱'), '2026-10：简爱规则按生效期正确消失（旧实现在此口径下会显示）')
  const row8 = pick(s8, '蒙牛低温')
  chk(!!row8 && row8.cells[3] === '¥950,000', '2026-08：蒙牛低温目标 = ¥950,000', row8 && row8.cells[3])

  chk((apiLog.filter(x => x.startsWith('GET'))).every(
        x => /month=20\d\d-\d\d/.test(x) || /year=20\d\d/.test(x)),
      '所有达成读取请求只带月度键或年份（无 -Q 季键、无裸年份当月份键）')
  chk(!apiLog.some(x => /-Q\d/.test(x)), '没有任何请求出现过季度键')
  chk(apiLog.every(x => !/month=20\d\d(&|$|\s)/.test(x)), '没有任何请求把裸年份当月份键发出去')
  chk(s9.yTableVisible && s9.yRowCount === 12, '「全年月度对比」表仍在且为 12 行（未被本次改动波及）',
      `visible=${s9.yTableVisible} rows=${s9.yRowCount}`)

  console.log('\n  console 错误数:', errs.length)
  errs.slice(0, 6).forEach(e => console.log('    ' + e))
  chk(errs.length === 0, '控制台零错误')

  console.log('\n' + (allOk ? '=== ALL_GREEN ===' : '=== SOME_FAIL ==='))
  await b.close()
  process.exit(allOk ? 0 : 1)
})()
