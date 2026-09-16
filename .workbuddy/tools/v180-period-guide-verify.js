// v180 真机验收：期次归属前置展示 / 归属不一致提示 / 期次软警告 / 名称解析条件覆盖 / 期次改名
//
// 两个阶段（用 HG_PHASE 切换），因为中间需要先在沙箱里把期次清空：
//   HG_PHASE=A  有期次：pick 步归属展示 · 查看往期时的归属不一致提示 · 新建期次软警告 ·
//               「按名称更新日期」条件出现与覆盖语义 · 历史期次页「修改」→ PATCH 真生效
//   HG_PHASE=B  无期次：pick 步「你现在还没有期次」+ 先建入口 · 导入回执条件引导 ·
//               引导里建期次后归属更新 · 再导一次引导**不再出现**（无噪音）
//
// ⚠️ 教训沿用（见 v179 脚本）：弹窗选择器一律用**具体类名**（`.imp-modal`），
//    禁用 `[class*=imp-]` —— 会先命中主表行上的 `.imp-tag`（在 #app 内，排在 Teleport
//    到 body 的弹窗之前），永远读到「导入」两个字。
// ⚠️ page.evaluate 的第一个参数传**字符串**会被当表达式求值 —— 一律传函数 + 参数数组。
const puppeteer = require('puppeteer-core')
const fs = require('fs')

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT
const OUT = process.env.HG_OUT || '/tmp/v180-shots'
const XLSX = process.env.HG_XLSX
const PHASE = (process.env.HG_PHASE || 'A').toUpperCase()

const R = []
const ok = (id, cond, detail) => {
  R.push({ id, pass: !!cond })
  console.log((cond ? 'PASS ' : 'FAIL ') + id + '  ' + String(detail == null ? '' : detail).slice(0, 400))
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const wait = async (fn, ms = 20000, step = 350) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v } catch (e) {} await sleep(step) }
  return null
}
const T = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()

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
  page.on('console', m => { if (m.type() === 'error') errs.push(T(m.text()).slice(0, 200)) })
  page.on('pageerror', e => errs.push('PAGEERROR ' + T(String(e)).slice(0, 200)))

  const shot = n => page.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {})

  // ---------- 页面内小工具 ----------
  const apiPeriods = () => page.evaluate(async () => {
    const t = localStorage.getItem('hergent_v2_token')
    const tn = localStorage.getItem('hergent_v2_tenant')
    const r = await fetch('/api/forecast/periods', { headers: { Authorization: 'Bearer ' + t, 'X-Tenant-Id': String(tn) } })
    return await r.json()
  })
  const openImport = async () => {
    await page.click('button[title="从 Excel 导入预报订单汇总表"]')
    await wait(() => page.$('.imp-modal'))
    await sleep(500)
  }
  const closeImport = async () => {
    const x = await page.$('.imp-modal .imp-x')
    if (x) { await x.click(); await sleep(400) }
  }
  const ownNodes = () => page.evaluate(() => [...document.querySelectorAll('.imp-modal .imp-own')]
    .map(p => ({ text: p.innerText.replace(/\s+/g, ' ').trim(), cls: p.className })))
  const npWarn = () => page.evaluate(() => [...document.querySelectorAll('.card.new-period .np-warn li')]
    .map(li => li.innerText.replace(/\s+/g, ' ').trim()))
  const npDates = () => page.evaluate(() => [...document.querySelectorAll('.card.new-period .np-row input')].map(i => i.value))
  const npHasDateBtn = () => page.evaluate(() => !!document.querySelector('.card.new-period button[title*="按名称里的日期重算"]'))
  // 用原生 setter + input 事件驱动 v-model / @input（直接改 .value 不会触发 Vue）
  const setInputAt = (sel, idx, val) => page.evaluate((s, i, v) => {
    const el = document.querySelectorAll(s)[i]
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return el.value
  }, sel, idx, val)
  const toastText = () => page.evaluate(() => { const t = document.querySelector('.toast'); return t ? t.innerText.replace(/\s+/g, ' ').trim() : '' })
  const tabs = async label => page.evaluate(l => {
    const b = [...document.querySelectorAll('.module-tabs button')].find(x => x.textContent.trim() === l)
    if (b) { b.click(); return true } return false
  }, label)
  const histRows = () => page.evaluate(() => [...document.querySelectorAll('.history-tbl tbody tr')].map(tr => {
    const tds = [...tr.querySelectorAll('td')]
    const btns = [...tr.querySelectorAll('button')].map(b => b.textContent.trim())
    return { name: (tds[0] ? tds[0].innerText.trim() : ''), status: (tds[6] ? tds[6].innerText.trim() : ''), btns }
  }))
  const clickHistRename = name => page.evaluate(n => {
    const tr = [...document.querySelectorAll('.history-tbl tbody tr')].find(t => t.innerText.includes(n))
    if (!tr) return false
    const b = [...tr.querySelectorAll('button')].find(x => x.textContent.trim() === '修改')
    if (!b) return false
    b.click(); return true
  }, name)

  await page.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(6000)

  // =====================================================================
  if (PHASE === 'A') {
    // ---------------- A 归属展示 + 口径同源 ----------------
    const opts = await page.$$eval('select.sel-period option', os => os.map(o => ({ id: Number(o.value), name: o.textContent.trim() })))
    const auth = await apiPeriods()
    const cur = auth.current || {}
    ok('A1 期次下拉 ≥2 项', opts.length >= 2, JSON.stringify(opts))
    ok('A2 后端 current 有值（归属口径的权威来源）', !!cur.id, 'current=' + JSON.stringify(cur))

    await openImport()
    const o1 = await ownNodes()
    ok('A3 pick 步出现「本期归属」且非告警态', o1.length >= 1 && /本期归属/.test(o1[0].text) && !/warn/.test(o1[0].cls), JSON.stringify(o1))
    ok('A4 归属名 = 后端 current.name', !!cur.name && o1.length >= 1 && o1[0].text.includes(cur.name), `展示=${o1[0] ? o1[0].text : ''} / current=${cur.name}`)
    await shot('A-pick-own')

    // ---------------- B 查看往期 → 归属不一致必须被点出来 ----------------
    // ⚠️ 必须排除占位项（id=0「— 选择期次 —」）：首轮就是选了它 ⇒ curPeriod=0 ⇒
    //    loadCross 回退到「今日报单」(id=0) ⇒ viewed=0 ⇒ 不一致提示不成立，B1/B2 假 FAIL。
    const other = opts.find(p => Number(p.id) > 0 && Number(p.id) !== Number(cur.id))
    ok('B0 存在另一个真实期次可切换', !!other, JSON.stringify(other || null))
    await closeImport()
    await setInputAt('select.sel-period', 0, String(other ? other.id : 0))
    await sleep(4500)
    await openImport()
    const o2 = await ownNodes()
    const mism = o2.filter(x => /你正在查看的是/.test(x.text))
    ok('B1 归属不一致提示出现（查看往期时）', mism.length >= 1 && /warn/.test(mism[0].cls), JSON.stringify(o2))
    ok('B2 提示里同时点名「正在看的」与「实际归属」', mism.length >= 1 && mism[0].text.includes(other ? other.name : '') && mism[0].text.includes(cur.name), mism.length ? mism[0].text : '（无）')
    // 修复点：归属不再随下拉漂移 —— 第一条仍是后端 current，而不是正在查看的那期
    const first = o2[0]
    const ownedOk = !!cur.name && first && first.text.includes(cur.name) && !first.text.includes(other ? other.name : '@@')
    ok('B3 归属口径不随「查看往期」漂移（修复点）', ownedOk, JSON.stringify(first))
    await shot('B-pick-mismatch')
    await closeImport()
    await setInputAt('select.sel-period', 0, String(cur.id))
    await sleep(4000)

    // ---------------- C 新建期次：软警告 + 名称解析条件覆盖 ----------------
    await page.click('button[title^="新建期次"]')
    await wait(() => page.$('.card.new-period'))
    await sleep(400)
    const w1 = await npWarn()
    ok('C1 默认窗口与既有期次重叠 → 软警告出现', w1.some(x => /窗口重叠/.test(x)), JSON.stringify(w1))

    await setInputAt('.card.new-period .np-row input', 0, cur.name)   // 与既有期次同名
    await sleep(300)
    const w2 = await npWarn()
    ok('C2 同名软警告出现', w2.some(x => /已有同名期次/.test(x)), JSON.stringify(w2))

    // 名称带日期 → 自动只填空字段；窗口随之改变 → 重叠警告应消失
    await setInputAt('.card.new-period .np-row input', 0, '8月25日报单-8月29日到货')
    await sleep(300)
    const d3 = await npDates()
    ok('C3 名称解析自动补日期（只填空字段）', d3[1] === '2026-08-25' && d3[2] === '2026-08-25' && d3[3] === '2026-08-29', JSON.stringify(d3))
    ok('C3b 「按名称更新日期」按钮出现（名称含日期）', await npHasDateBtn(), '')
    const w3 = await npWarn()
    ok('C3c 窗口改到 8 月后不再与既有期次重叠', !w3.some(x => /窗口重叠/.test(x)), JSON.stringify(w3))

    // 手改一个日期 → 再动名称，手改值**不许**被静默覆盖（v180 的 P2 核心）
    await setInputAt('.card.new-period .np-row input', 1, '2026-09-01')
    await sleep(200)
    await setInputAt('.card.new-period .np-row input', 0, '8月25日报单-8月29日到货')
    await sleep(300)
    const d4 = await npDates()
    ok('C4 手改过的日期不被名称解析覆盖', d4[1] === '2026-09-01', JSON.stringify(d4))

    // 显式点按钮 → 允许覆盖
    await page.click('.card.new-period button[title*="按名称里的日期重算"]')
    await sleep(500)
    const d5 = await npDates()
    const tt5 = await toastText()
    ok('C5 显式「按名称更新日期」覆盖手改值', d5[1] === '2026-08-25' && /已按名称更新日期/.test(tt5), JSON.stringify(d5) + ' toast=' + tt5)
    await shot('C-newperiod-warn')

    await setInputAt('.card.new-period .np-row input', 0, '无日期名称')
    await sleep(300)
    ok('C6 名称无日期时按钮消失且不清空已填日期', !(await npHasDateBtn()) && (await npDates())[1] === '2026-08-25', '')
    await page.click('button[title^="新建期次"]')   // 关闭表单
    await sleep(400)

    // ---------------- D 历史期次页「修改」→ PATCH 真生效 ----------------
    ok('D0 切到「历史期次」页', await tabs('历史期次'), '')
    await wait(() => page.$('.history-tbl tbody tr'))
    await sleep(800)
    const rows = await histRows()
    const openRow = rows.find(r => /进行中/.test(r.status))
    const closedRow = rows.find(r => /已关闭/.test(r.status))
    ok('D1 期次列表 ≥2 行', rows.length >= 2, JSON.stringify(rows.map(r => [r.name, r.status, r.btns])))
    ok('D2 open 期次有「修改」，已关闭期次没有', !!openRow && openRow.btns.includes('修改') && !!closedRow && !closedRow.btns.includes('修改'),
      `open=${openRow ? JSON.stringify(openRow.btns) : '-'} closed=${closedRow ? JSON.stringify(closedRow.btns) : '-'}`)

    const target = openRow ? openRow.name : cur.name
    ok('D3 点开「修改」→ 弹窗出现且带出原值', await clickHistRename(target) && !!(await wait(() => page.$('.pe-modal'))), '')
    await sleep(400)
    const peVal = await page.$eval('.pe-modal .pe-grid input', i => i.value)
    ok('D4 弹窗预填 = 该期次当前名称', peVal === target, `弹窗=${peVal} 期望=${target}`)
    const NEWNAME = target + '（改名验收）'
    await setInputAt('.pe-modal .pe-grid input', 0, NEWNAME)
    await sleep(300)
    await page.evaluate(() => { const b = [...document.querySelectorAll('.pe-modal button')].find(x => x.textContent.trim() === '保存'); b.click() })
    await sleep(1500)
    const ttD = await toastText()
    ok('D5 保存成功并提示改动处数', /已保存（改动 1 处）/.test(ttD), 'toast=' + ttD)
    await shot('D-period-edit')
    const okGone = await wait(async () => !(await page.$('.pe-modal')), 6000)
    const rows2 = await histRows()
    ok('D6 弹窗关闭且列表刷新出新名称', !!okGone && rows2.some(r => r.name === NEWNAME), JSON.stringify(rows2.map(r => r.name)))

    // 改名确实落库（用后端权威读回，而不是只看界面）
    const auth2 = await apiPeriods()
    const back = (auth2.periods || []).find(p => Number(p.id) === Number(cur.id))
    ok('D7 后端读回的名称已变（PATCH 真生效）', !!back && back.name === NEWNAME, back ? back.name : '（未找到）')

    // 归属展示随之更新
    await tabs('本期预报')
    await sleep(1200)
    await openImport()
    const o3 = await ownNodes()
    ok('D8 pick 步归属名跟着改名更新', o3.length >= 1 && o3[0].text.includes(NEWNAME), JSON.stringify(o3[0] || null))
    await closeImport()
  }

  // =====================================================================
  if (PHASE === 'B') {
    ok('E0 上传文件存在', !!XLSX && fs.existsSync(XLSX), XLSX)
    await openImport()
    const o1 = await ownNodes()
    ok('E1 无期次时 pick 步转为告警并给出「先建一个期次」入口',
      o1.length >= 1 && /warn/.test(o1[0].cls) && /你现在还没有期次/.test(o1[0].text)
      && await page.evaluate(() => [...document.querySelectorAll('.imp-modal button')].some(b => b.textContent.includes('先建一个期次'))),
      JSON.stringify(o1))
    await shot('E-pick-noperiod')

    // ---- 真实导入（走 UI 上传真实文件） ----
    const fi = await page.$('input[type=file]')
    await fi.uploadFile(XLSX)
    await wait(() => page.$('.imp-modal .imp-matrix'), 40000)
    await sleep(1200)
    await page.click('.imp-ft .btn-primary')
    const done = await wait(async () => page.evaluate(() => {
      const m = document.querySelector('.imp-modal')
      if (!m) return false
      const txt = m.innerText
      return /现在新建期次/.test(txt) || /导入成功|已建档|没有可导入的内容/.test(txt)
    }), 120000, 800)
    ok('E2 导入走到完成步', !!done, '')
    const hasGuide = await page.evaluate(() => [...document.querySelectorAll('.imp-modal button')].some(b => b.textContent.includes('现在新建期次')))
    const modalTxt = await page.evaluate(() => { const m = document.querySelector('.imp-modal'); return m ? m.innerText.replace(/\s+/g, ' ').trim() : '' })
    ok('E3 未归到期次 → 回执出现条件引导（而不是静默）', hasGuide && /这次导入没有归到任何期次/.test(modalTxt), T(modalTxt).slice(0, 260))
    await shot('E-done-guide')

    // ---- 引导入口建期次 ----
    await page.evaluate(() => { const b = [...document.querySelectorAll('.imp-modal button')].find(x => x.textContent.includes('现在新建期次')); b.click() })
    await wait(() => page.$('.card.new-period'))
    await sleep(500)
    const impClosed = !(await page.$('.imp-modal'))
    await setInputAt('.card.new-period .np-row input', 0, 'v180-新建-9月16日报单-9月20日到货')
    await sleep(400)
    const d = await npDates()
    ok('E4 引导入口打开新建表单（导入弹窗已收起）', impClosed && !!d[0] && !!d[1] && !!d[2], JSON.stringify(d))
    await page.evaluate(() => { const b = [...document.querySelectorAll('.card.new-period button')].find(x => x.textContent.trim() === '创建'); b.click() })
    await sleep(2500)
    const tt = await toastText()
    const auth = await apiPeriods()
    const created = (auth.periods || []).find(p => /v180-新建/.test(p.name || ''))
    ok('E5 期次创建成功并落库', /期次已创建/.test(tt) && !!created, 'toast=' + tt + ' id=' + (created ? created.id : '-'))
    await shot('E-period-created')

    // ---- 归属随新期次更新 ----
    await openImport()
    const o2 = await ownNodes()
    ok('E6 新建后 pick 步归属=新期次（不再是告警态）',
      o2.length >= 1 && !/warn/.test(o2[0].cls) && /v180-新建/.test(o2[0].text), JSON.stringify(o2[0] || null))

    // ---- 再导一次：归属正常时**不许**再出现引导（无噪音） ----
    const fi2 = await page.$('input[type=file]')
    await fi2.uploadFile(XLSX)
    await wait(() => page.$('.imp-modal .imp-matrix'), 40000)
    await sleep(1200)
    await page.click('.imp-ft .btn-primary')
    await wait(async () => page.evaluate(() => {
      const m = document.querySelector('.imp-modal'); if (!m) return false
      return /导入成功|已建档|没有可导入的内容|现在新建期次/.test(m.innerText)
    }), 120000, 800)
    await sleep(1200)
    const hasGuide2 = await page.evaluate(() => [...document.querySelectorAll('.imp-modal button')].some(b => b.textContent.includes('现在新建期次')))
    ok('E7 归属正常时引导块不出现（无噪音）', !hasGuide2, '')
    await shot('E-done-noguide')
  }

  ok('Z1 控制台零错误', errs.length === 0, errs.slice(0, 4).join(' || '))

  const bad = R.filter(x => !x.pass)
  console.log('\n==== PHASE ' + PHASE + ' SUMMARY: ' + (R.length - bad.length) + '/' + R.length + ' PASS ====')
  if (bad.length) console.log('FAILED: ' + bad.map(x => x.id).join(', '))
  await browser.close()
  process.exit(bad.length ? 1 : 0)
})().catch(e => { console.error('FATAL ' + e.stack); process.exit(2) })
