/* 「最终下单」= 报单合计 + 加单 —— 真机验收（隔离沙箱，全程只读）
 * ------------------------------------------------------------------
 * 用户口径（2026-09-15 订正）：最终下单 = 报单合计 + 加单，**不区分是否定稿**。
 * 本脚本验证三件事：
 *   ① 「加单」列在只读主表**有数**（修复前该列无渲染分支 → 单元格恒为空）
 *   ② 「最终下单」列 = 合计 + 加单（逐行对账）
 *   ③ 无 console error / 4xx
 *
 * 用法：
 *   HG_TOKEN=xxx HG_TENANT=9997 HG_BASE=http://127.0.0.1:5173 node forecast-final-qty-verify.js
 */
const puppeteer = require('puppeteer-core')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.HG_BASE || 'http://127.0.0.1:5173'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT || '9997'
const SHOT = process.env.HG_SHOT || '/tmp/final-qty-verify.png'
const sleep = ms => new Promise(r => setTimeout(r, ms))

/* 期望值来自沙箱造数：report_qty(后端 SUM) + extra_qty(写入 forecast_extra_qty)
   注意 name 用**商品主档名片段** —— 后端 summary 会以主档 name 覆盖提报快照名 */
const EXPECT = [
  { pid: 1523, name: '现代牧场鲜牛奶', qty: 684, extra: 100, final: 784 },
  { pid: 1556, name: '0蔗糖5连包', qty: 624, extra: 200, final: 824 },
  { pid: 1315, name: '阿慕乐奶皮子', qty: 516, extra: 50, final: 566 },
]

/* 页面内采集器：必须「普通函数 + 显式参数」（puppeteer 只序列化函数源码） */
function collect(arg) {
  const expects = arg.expects
  /* 页面上有多张 table（返利冲刺看板 + 主表）——必须锁定「含最终下单列」的那一张 */
  const tbl = [...document.querySelectorAll('table')].find(t =>
    [...t.querySelectorAll('thead th, thead td')].some(x => (x.textContent || '').trim() === '最终下单'))
  if (!tbl) return { err: '未找到含「最终下单」列的主表', out: [] }
  const ths = [...tbl.querySelectorAll('thead th, thead td')]
  const headText = ths.map(t => (t.textContent || '').trim().replace(/\s+/g, ''))
  const find = kw => headText.findIndex(t => t === kw)
  const idx = { qty: find('合计'), extra: find('加单'), final: find('最终下单') }
  const rows = [...tbl.querySelectorAll('tr.data-row')]
  const out = []
  for (const e of expects) {
    /* 按 product_id 定位（name 会撞上同系列近似名） */
    const tr = rows.find(r => { const td = r.querySelector('td[data-pid]'); return td && Number(td.dataset.pid) === e.pid })
    if (!tr) { out.push({ pid: e.pid, name: e.name, err: '未找到行' }); continue }
    const tds = [...tr.querySelectorAll('td')]
    const txt = i => (i >= 0 && tds[i]) ? (tds[i].textContent || '').trim() : null
    out.push({
      pid: e.pid, name: e.name,
      qty: txt(idx.qty), extra: txt(idx.extra), final: txt(idx.final),
      aria: (tr.getAttribute('aria-label') || '').slice(0, 110),
    })
  }
  const sels = [...document.querySelectorAll('select')].map(s => ({ v: s.value, t: s.options[s.selectedIndex] ? s.options[s.selectedIndex].text : '' }))
  const firstRows = rows.slice(0, 4).map(r => (r.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50))
  return {
    headText, idx, out, rowCount: rows.length, url: location.hash, sels, firstRows,
    tb: (document.querySelector('.toolbar') || { textContent: '' }).textContent.trim().replace(/\s+/g, ' ').slice(0, 130),
  }
}

const num = s => (s == null ? NaN : Number(String(s).replace(/[^\d.-]/g, '')))

;(async () => {
  let PASS = 0, FAIL = 0
  const ok = (c, m) => { c ? (PASS++, console.log('  PASS  ' + m)) : (FAIL++, console.log('  FAIL  ' + m)) }

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1680, height: 950, deviceScaleFactor: 1 })
  const errs = [], bad = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 110)) })

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'v170verify', display_name: '最终下单验收' }))
  }, TOKEN, TENANT)

  await page.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(6000)
  ok(!/#\/login/.test(page.url()), '登录态注入成功（未被弹回 /#/login）')

  /* 显式选中期次 9（沙箱造数所在窗口），不依赖页面默认选中态 */
  const picked = await page.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => (o.text || '').includes('选择期次')))
    if (!s) return 'no-select'
    const target = [...s.options].find(o => (o.text || '').includes('提审期'))
      || [...s.options].find(o => o.value && o.value !== '0')
    if (!target) return 'no-option'
    s.value = target.value
    s.dispatchEvent(new Event('change', { bubbles: true }))
    return 'picked:' + target.value + ':' + target.text
  })
  console.log('期次选择:', picked)
  ok(/^picked:9:/.test(picked), '已选中期次 9「9月提审期-开放填报」')
  await sleep(5500)

  const r = await page.evaluate(collect, { expects: EXPECT })
  console.log('\n表头:', JSON.stringify(r.headText))
  console.log('列索引:', JSON.stringify(r.idx), ' 首屏行数:', r.rowCount)
  console.log('下拉框:', JSON.stringify(r.sels).slice(0, 300))
  console.log('工具栏:', r.tb)
  console.log('首屏前 6 行:'); (r.firstRows || []).forEach(x => console.log('   ', x))

  ok(r.idx.extra >= 0, '「加单」列存在于表头')
  ok(r.idx.final >= 0, '「最终下单」列存在于表头')

  /* 主表是虚拟滚动（只渲染视口内行）→ 分段下滚把目标行采出来 */
  const seen = new Map()
  const harvest = part => (part.out || []).forEach(x => { if (!x.err) seen.set(x.pid, x) })
  harvest(r)
  await page.mouse.move(840, 520)
  for (let s = 0; s < 36 && seen.size < EXPECT.length; s++) {
    await page.mouse.wheel({ deltaY: 420 })
    await sleep(420)
    if (s % 3 === 2) harvest(await page.evaluate(collect, { expects: EXPECT }))
  }
  harvest(await page.evaluate(collect, { expects: EXPECT }))
  console.log('滚动采样命中:', [...seen.keys()].join(', ') || '（无）')

  console.log('\n═══ 逐行对账（合计 / 加单 / 最终下单）═══')
  for (const e of EXPECT) {
    const g = seen.get(e.pid)
    if (!g) { ok(false, `${e.name}：滚动采样未命中`); continue }
    console.log(`  ${e.name.padEnd(14)} 合计=${String(g.qty).padStart(6)}  加单=${String(g.extra).padStart(6)}  最终下单=${String(g.final).padStart(6)}   [期望 ${e.qty} / ${e.extra} / ${e.final}]`)
    ok(num(g.qty) === e.qty, `${e.name} 合计 = ${e.qty}`)
    ok(num(g.extra) === e.extra, `${e.name} 加单列**有数**且 = ${e.extra}（修复前该列为空）`)
    ok(num(g.final) === e.final, `${e.name} 最终下单 = 合计+加单 = ${e.final}`)
    ok(new RegExp('最终下单 ' + e.final + '，').test(g.aria), `${e.name} aria-label 同口径（${g.aria.slice(0, 46)}…）`)
  }

  await page.screenshot({ path: SHOT })
  /* 横滚到最右，把「加单 / 最终下单 / 单价(厂价) / 下单金额」四列拍下来（视觉影响评估用） */
  await page.evaluate(() => {
    const sc = [...document.querySelectorAll('div')].find(e => e.scrollWidth > e.clientWidth + 50 && e.querySelector('table'))
    if (sc) sc.scrollLeft = sc.scrollWidth
    return !!sc
  })
  await sleep(1500)
  const SHOT2 = SHOT.replace(/\.png$/, '-right.png')
  await page.screenshot({ path: SHOT2 })
  console.log('\n截图:', SHOT, '|', SHOT2)
  console.log('\nconsole errors:', errs.length ? errs.slice(0, 5) : '无')
  console.log('4xx/5xx:', bad.length ? bad.slice(0, 5) : '无')
  ok(errs.filter(e => !/favicon|404/i.test(e)).length === 0, '无 JS 运行时错误')

  console.log(`\n结果: ${PASS} PASS / ${FAIL} FAIL`)
  await browser.close()
  process.exit(FAIL ? 1 : 0)
})()
