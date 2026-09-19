// v179 对照实验：**原来的建单路径有没有被重构弄坏**。
//
// 为什么必须做：v179 的空数量验收（18/18 ALL_GREEN）只走了「客户列全空」这一条路 ——
//   第二遍循环里 `if (qty <= 0) continue` 把每一行都 continue 掉了 ⇒ **建单代码一行都没执行**。
//   而「把建档提到数量判断之前」正是重构了这一段，所以必须造一份**有数量**的文件再走一遍。
//
// 文件设计 /tmp/v179-regression.xlsx（161 行）：
//   · 第 2~6 行 刘善涛=10、第 3~7 行 美联保康=5（这两列在 report_mapping 里配过 → 应出明细）
//   · 其余行数量全空                    → 应只建档、无明细
//   · 追加 2 个全新条码商品（A 无数量 / B 刘善涛=8）→ 应新建档；B 出明细、A 不出
// 期望：明细 11 条；刘善涛合计 58、美联保康合计 25；回执走「导入成功：2 个客户」分支。
const puppeteer = require('puppeteer-core')
const fs = require('fs')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT
const OUT = process.env.HG_OUT || '/tmp/v179-shots'
const XLSX = process.env.HG_XLSX

const R = []
const ok = (id, cond, detail) => { R.push({ id, pass: !!cond, detail: String(detail == null ? '' : detail) }); console.log((cond ? 'PASS ' : 'FAIL ') + id + '  ' + detail) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const wait = async (fn, ms = 20000, step = 400) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v } catch (e) {} await sleep(step) }
  return null
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=2'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 2 })
  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_tenant', String(ten))
    localStorage.setItem('hergent_v2_user', JSON.stringify({ role: 'boss', username: 'e2e', display_name: '验证' }))
  }, TOKEN, TENANT)
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
  page.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 200)))

  await page.goto(`https://hergent.cn/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(6000)

  const picked = await page.evaluate(() => {
    const sel = document.querySelector('select.sel-period')
    if (!sel) return null
    const o = [...sel.options].find(x => /9月提审期/.test(x.textContent))
    if (!o) return null
    sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true }))
    return Number(o.value)
  })
  ok('R0 期次可选', !!picked, 'period_id=' + picked)
  await sleep(4500)

  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '导入'); b.click() })
  await sleep(1800)

  const modalText = () => page.evaluate(() => { const m = document.querySelector('.imp-modal'); return m ? m.innerText.replace(/\s+/g, ' ') : '' })

  const fi = await page.$('input[type=file]')
  ok('R1 找到文件输入框', !!fi)
  await fi.uploadFile(XLSX)
  const got = await wait(async () => { const t = await modalText(); return /确认导入/.test(t) ? t : null }, 30000)
  ok('R2 进入列映射确认', !!got && /共\s*28\s*列/.test(got), (got || '').slice(0, 90))
  await page.screenshot({ path: `${OUT}/5-对照实验-列映射确认-1440.png` })

  const clicked = await page.evaluate(() => {
    const m = document.querySelector('.imp-modal')
    const b = m && [...m.querySelectorAll('button')].find(x => /确认导入/.test(x.textContent || ''))
    if (!b) return false
    b.click(); return true
  })
  ok('R3 点确认导入', clicked)

  const done = await wait(async () => { const t = await modalText(); return /已建档|导入成功|异常/.test(t) ? t : null }, 120000)
  const flat = (done || '').replace(/\s+/g, ' ')
  console.log('回执全文:', flat.slice(0, 700))

  ok('R4 回执走「导入成功：N 个客户」分支（不再是「已建档但无报单」）',
     /导入成功：\s*2\s*个客户/.test(flat) && !/但没有生成任何报单/.test(flat),
     (flat.match(/导入成功：\s*\d+\s*个客户/) || ['(未命中)'])[0])
  ok('R5 商品档案：自动建档 2 个（两个回归新品）',
     /自动建档\s*2\s*个/.test(flat), (flat.match(/自动建档\s*\d+\s*个[^复]*/) || ['(未命中)'])[0].slice(0, 60))
  ok('R6 商品档案：复用已有 154 个',
     /复用已有\s*154\s*个/.test(flat), (flat.match(/复用已有\s*\d+\s*个/) || ['(未命中)'])[0])
  ok('R7 列出了 2 个新建商品名', /【回归】测试新品A/.test(flat) && /【回归】测试新品B/.test(flat),
     (flat.match(/新建：[^新]*/) || ['(未命中)'])[0].slice(0, 90))
  ok('R8 仍点名 19 个报单对象不在报单配置里', /19\s*个报单对象不在|共\s*19\s*个/.test(flat),
     (flat.match(/(?:有\s*)?19\s*个报单对象不在[^。]*/) || ['(未命中)'])[0].slice(0, 90))

  await page.screenshot({ path: `${OUT}/6-对照实验-回执-导入成功2个客户-1440.png` })

  // summary 契约：登记应累积到 156（154 + 2 个回归新品）
  const api = await page.evaluate(async (pid) => {
    const t = localStorage.getItem('hergent_v2_token')
    const r = await fetch(`/api/forecast-submissions/summary?period_id=${pid}`, { headers: { Authorization: 'Bearer ' + t } })
    const j = await r.json()
    const d = (j && j.data && j.data.imported_products) ? j.data : j
    const ip = (d && d.imported_products) || []
    const rows = (d && d.rows) || []
    const find = bc => ip.find(x => String(x.barcode) === bc) || null
    const a = find('6900000000001'), b = find('6900000000002')
    const rowOf = pid => (pid ? (rows.find(r => Number(r.product_id) === Number(pid)) || null) : null)
    return {
      imported: ip.length,
      hasNewA: !!a, hasNewB: !!b,
      aQty: a ? (rowOf(a.id) ? rowOf(a.id).total_qty : null) : null,
      bQty: b ? (rowOf(b.id) ? rowOf(b.id).total_qty : null) : null,
      reportRows: rows.length,
      reportQty: rows.reduce((s, x) => s + (x.total_qty || 0), 0),
    }
  }, picked)
  console.log('summary:', JSON.stringify(api))
  ok('R9 登记台账累积到 156（154 旧 + 2 个回归新品），新品 A/B 都在',
     api.imported === 156 && api.hasNewA && api.hasNewB,
     `imported=${api.imported} hasNewA=${api.hasNewA} hasNewB=${api.hasNewB}`)
  // 这一条是本轮重构的**核心语义**：建档与数量彻底解耦 ——
  //   新品A（客户列全空）必须已建档、但**不进报单**（bQty=null）；
  //   新品B（刘善涛=8）必须既建档、又进报单且数量正好 8。
  ok('R10 新品B 有量→进报单且数量=8；新品A 无量→已建档但不在报单行里',
     api.bQty === 8 && api.aQty === null,
     `新品A 数量=${api.aQty}（期望 null=无明细）  新品B 数量=${api.bQty}（期望 8）`)

  ok('R11 控制台零错误', errs.length === 0, errs.length ? errs.slice(0, 3).join(' || ') : '0 errors')

  const pass = R.filter(x => x.pass).length
  console.log(`\n===== ${pass}/${R.length} =====`)
  console.log(R.filter(x => !x.pass).map(x => '  FAIL ' + x.id + ' :: ' + x.detail).join('\n'))
  console.log(pass === R.length ? 'ALL_GREEN' : 'HAS_FAIL')
  await browser.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
