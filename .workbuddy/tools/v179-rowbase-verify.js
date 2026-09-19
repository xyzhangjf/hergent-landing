// v179 真机验收：主表行底（导入∪有报单） + 本批导入/已停用角标 + 显示全部商品开关 + 导入回执
//
// ⚠️ 2026-09-16 修正（首轮 6/13 的教训）：查看态主表是**虚拟滚动**（VSCROLL_MIN=80，ROW_H=34），
//    DOM 里天生只有窗口内 ~26 行。首轮把「DOM 行数」当成「逻辑行数」→ B1/B2/B3/C1 全假 FAIL。
//    正确出口有两个：
//      ① 逻辑行数 = .cross-viewport 的 scrollHeight / 34（滚动容器高度 = topSpacer + 行 + bottomSpacer）
//      ② 角标数量 = 滚动遍历整表、按 data-pid 去重收集（单屏只能看到窗口那几十行）
//    另：导入弹窗选择器**只能用 .imp-modal**。`[class*=imp-]` 会先命中主表行上的 `.imp-tag`（在 #app 内，
//    排在 Teleport 到 body 的弹窗之前）→ 永远读到「导入」两个字，D3/D5/D6 假 FAIL。
const puppeteer = require('puppeteer-core')
const fs = require('fs')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN
const TENANT = process.env.HG_TENANT
const OUT = process.env.HG_OUT || '/tmp/v179-shots'
const XLSX = process.env.HG_XLSX

const R = []
const ok = (id, cond, detail) => { R.push({ id, pass: !!cond, detail: String(detail == null ? '' : detail) }); console.log((cond ? 'PASS ' : 'FAIL ') + id + '  ' + detail) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const wait = async (fn, ms = 15000, step = 400) => {
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

  await page.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(6000)

  // 选「9月提审期-开放填报」（沙箱里登记挂的就是它）；顺带捕获 period_id（= option 的 value）
  const picked = await page.evaluate(() => {
    const sel = document.querySelector('select.sel-period')
    if (!sel) return null
    const o = [...sel.options].find(x => /9月提审期/.test(x.textContent))
    if (!o) return { err: [...sel.options].map(x => x.textContent) }
    sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true }))
    return { text: o.textContent, period_id: Number(o.value) }
  })
  ok('A1 期次可选', !!picked && !picked.err, JSON.stringify(picked))
  const PERIOD_ID = picked && picked.period_id ? picked.period_id : 0
  await sleep(4500)

  // ---- 观测器：控制条文案 + 虚拟滚动窗口的「逻辑行数」 ----
  // 逻辑行数只认 **spacer 法**：topSpacer + 当前渲染行 + bottomSpacer = 全部行
  //   （vsWindow 的定义式，精确；需 groupBy='none' 才成立，故额外断言 grp===0）。
  // ⚠️ 不可用 scrollHeight/34 —— 实测 .cross-viewport 的 scrollHeight 被撑到 6412，
  //   而内容真值是 158×34=5372，据此算会得出 189 这种假数字。
  const snap = () => page.evaluate(() => {
    const ctl = document.querySelector('.grid-ctl-row')
    const txt = ctl ? ctl.innerText.replace(/\s+/g, ' ') : ''
    const m = txt.match(/另有\s*(\d+)\s*个在售商品未显示/)
    const vp = document.querySelector('.cross-viewport')
    let logical = null, rendered = 0, grp = 0, scrollHeight = 0, top = 0, bot = 0
    if (vp) {
      const tbl = vp.querySelector('table.cross-tbl')
      scrollHeight = vp.scrollHeight
      rendered = vp.querySelectorAll('tr.data-row').length
      grp = vp.querySelectorAll('tr.grp-head').length
      if (tbl) {
        const sp = tbl.querySelectorAll('tr.vs-spacer')
        top = sp[0] ? (parseFloat(sp[0].style.height) || 0) : 0
        bot = sp[1] ? (parseFloat(sp[1].style.height) || 0) : 0
      }
      logical = Math.round((top + bot) / 34) + rendered
    }
    return { ctl: txt, hidden: m ? Number(m[1]) : null, logical, rendered, grp, top, bot, scrollHeight }
  })

  // ---- 观测器：滚动遍历整表，按 data-pid 去重收集角标 ----
  const scanGrid = () => page.evaluate(async () => {
    const vp = document.querySelector('.cross-viewport')
    if (!vp) return null
    const seen = {}
    const scan = () => {
      vp.querySelectorAll('tr.data-row').forEach(tr => {
        const td = tr.querySelector('td[data-pid]')
        if (!td) return
        const pid = td.getAttribute('data-pid')
        if (!pid || pid === 'null') return
        const prev = seen[pid] || { imp: false, off: false }
        seen[pid] = { imp: prev.imp || !!tr.querySelector('.imp-tag'), off: prev.off || !!tr.querySelector('.off-tag') }
      })
    }
    vp.scrollTop = 0
    await new Promise(r => setTimeout(r, 160))
    scan()
    const H = Math.max(80, vp.clientHeight)
    const stepPx = Math.floor(H * 0.6)
    const max = vp.scrollHeight
    for (let y = stepPx; y <= max; y += stepPx) {
      vp.scrollTop = y
      await new Promise(r => setTimeout(r, 130))
      scan()
    }
    vp.scrollTop = max
    await new Promise(r => setTimeout(r, 160))
    scan()
    vp.scrollTop = 0
    await new Promise(r => setTimeout(r, 120))
    const pids = Object.keys(seen)
    return {
      logical: Math.round(max / 34), renderedNow: vp.querySelectorAll('tr.data-row').length,
      seenRows: pids.length,
      imp: pids.filter(p => seen[p].imp).length,
      off: pids.filter(p => seen[p].off).length,
      impPids: pids.filter(p => seen[p].imp),
      offPids: pids.filter(p => seen[p].off),
      allPids: pids,
    }
  })

  // ---- A2：后端登记台账（summary 契约）与库内一致 ----
  const api = await page.evaluate(async (pid) => {
    const t = localStorage.getItem('hergent_v2_token')
    try {
      const r = await fetch(`/api/forecast-submissions/summary?period_id=${pid}`, { headers: { Authorization: 'Bearer ' + t } })
      const j = await r.json()
      const d = (j && j.data && (j.data.imported_products || j.data.rows)) ? j.data : j
      const ip = (d && d.imported_products) || []
      return {
        status: r.status, keys: Object.keys(j || {}).slice(0, 8),
        imported: ip.length,
        inactive: ip.filter(x => Number(x.is_active) === 0).length,
        ids: ip.map(x => String(x.id)),
      }
    } catch (e) { return { err: String(e) } }
  }, PERIOD_ID)
  ok('A2 后端登记台账已带行返回', api && api.imported === 154, JSON.stringify({ status: api.status, imported: api.imported, inactive: api.inactive }))

  let s = await snap()
  console.log('初始快照(默认行底):', JSON.stringify(s))
  const g1 = await scanGrid()
  console.log('滚动收集(默认行底):', JSON.stringify({ logical: g1.logical, seenRows: g1.seenRows, imp: g1.imp, off: g1.off, offPids: g1.offPids }))

  ok('B0 默认不分组（spacer 法成立的前提）', s.grp === 0, `grp-head 行数=${s.grp}`)
  const inSaleShown = g1.seenRows - g1.off   // 行底里真正来自「在售档案」的行
  ok('B1 行底收窄到「导入∪有报单」= 158 行', s.logical === 158,
     `逻辑行数=${s.logical}（spacer 法；rendered=${s.rendered} top=${s.top} bottom=${s.bot}）`)
  ok('B2 本批导入角标覆盖全部 154 个登记商品', g1.imp === 154, `带「导入」角标的商品 ${g1.imp} 个（登记 154）；遍历到 ${g1.seenRows} 行`)
  ok('B3 已停用角标已渲染', g1.off === 5, `带「已停用」角标的商品 ${g1.off} 个（档案外被本期引用 5 个）pid=${JSON.stringify(g1.offPids)}`)
  ok('B4 「显示全部商品」开关存在', /显示全部商品/.test(s.ctl), s.ctl.slice(0, 90))
  // 口径自洽：「另有 N 个**在售**商品未显示」的被减数只能是行底里来自在售档案的行。
  //   旧实现用 rows.length（含 5 个档案外行）当被减数 → 少报 5（显示 127、真值 132）。
  ok('B5 「另有 N 个在售商品未显示」口径正确（N = 285 − 行底里的在售行）',
     s.hidden === 285 - inSaleShown,
     `角标=${s.hidden}  应为 285 − ${inSaleShown} = ${285 - inSaleShown}`)

  await page.screenshot({ path: `${OUT}/1-主表行底-本批导入与有报单-1440.png` })

  // 切「显示全部商品」→ 行底回到全量在售档案
  await page.evaluate(() => {
    const l = [...document.querySelectorAll('label.tb-toggle')].find(x => /显示全部商品/.test(x.textContent))
    l.querySelector('input').click()
  })
  await sleep(5000)
  const s2 = await snap()
  console.log('开全量后:', JSON.stringify(s2))
  const g2 = await scanGrid()
  console.log('滚动收集(开全量):', JSON.stringify({ logical: g2.logical, seenRows: g2.seenRows, imp: g2.imp, off: g2.off }))
  // 勾选必须**立刻**换行底（否则是假旋钮）。真机可观测证据 = 遍历到的行数从 158 变成 290。
  ok('C1 勾上后行底回到全量在售档案（285 在售 + 5 档案外 = 290 行）',
     s2.hidden === null && g2.seenRows === 290,
     `逻辑行数=${s2.logical}  遍历到 ${g2.seenRows} 行  未显示角标=${s2.hidden}`)
  await page.screenshot({ path: `${OUT}/2-勾显示全部商品-回到全量档案-1440.png` })

  const prev = new Set(g1.allPids)
  const missing = [...prev].filter(p => !new Set(g2.allPids).has(p))
  ok('C2 勾上后原 158 行一个不少（是超集）', missing.length === 0,
     `原 ${prev.size} 行中缺失 ${missing.length} 行 ${missing.length ? JSON.stringify(missing.slice(0, 8)) : ''}`)

  // 切回默认
  await page.evaluate(() => {
    const l = [...document.querySelectorAll('label.tb-toggle')].find(x => /显示全部商品/.test(x.textContent))
    l.querySelector('input').click()
  })
  await sleep(3500)

  // ---- 导入回执（沙箱内真实导入）----
  const openImp = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '导入')
    if (!b) return false
    b.click(); return true
  })
  ok('D1 打开导入弹窗', openImp, String(openImp))
  await sleep(1800)

  // ⚠️ 只用 .imp-modal —— 不用 [class*=imp-]
  const modalText = () => page.evaluate(() => {
    const m = document.querySelector('.imp-modal')
    return m ? m.innerText.replace(/\s+/g, ' ') : ''
  })

  const fi = await page.$('input[type=file]')
  ok('D2 找到文件输入框', !!fi, fi ? 'ok' : 'null')
  if (fi) {
    await fi.uploadFile(XLSX)
    const got = await wait(async () => {
      const t = await modalText()
      return /确认导入/.test(t) ? t : null
    }, 30000)
    ok('D3 进入列映射确认步骤', !!got && /共\s*\d+\s*列/.test(got), (got || '').slice(0, 170))
    await page.screenshot({ path: `${OUT}/3-导入-列映射确认-1440.png` })

    const clicked = await page.evaluate(() => {
      const m = document.querySelector('.imp-modal')
      if (!m) return false
      const b = [...m.querySelectorAll('button')].find(x => /确认导入/.test(x.textContent || ''))
      if (!b) return false
      b.click(); return true
    })
    ok('D4 点确认导入', clicked, String(clicked))

    const done = await wait(async () => {
      const t = await modalText()
      return /已建档|导入成功|异常/.test(t) ? t : null
    }, 120000)
    const flat = (done || '').replace(/\s+/g, ' ')
    ok('D5 回执出现且不再是绿色「导入成功：0 个客户」', !!done && !/导入成功：0\s*个客户/.test(flat), flat.slice(0, 260))
    ok('D6 回执点明「已建档 / 更新 154 个商品，但没有生成任何报单」',
       /已建档\s*\/\s*更新\s*154\s*个商品，但没有生成任何报单/.test(flat),
       flat.slice(0, 200))
    ok('D7 回执点名「19 个报单对象不在报单配置里」',
       /19\s*个报单对象不在/.test(flat), (flat.match(/有\s*19\s*个报单对象不在[^。]*/) || [''])[0].slice(0, 120))
    await page.screenshot({ path: `${OUT}/4-导入回执-已建档但无报单-1440.png` })
  }

  ok('E1 控制台零错误', errs.length === 0, errs.length ? errs.slice(0, 3).join(' || ') : '0 errors')

  const pass = R.filter(x => x.pass).length
  console.log(`\n===== ${pass}/${R.length} =====`)
  console.log(R.filter(x => !x.pass).map(x => '  FAIL ' + x.id + ' :: ' + x.detail).join('\n'))
  console.log(pass === R.length ? 'ALL_GREEN' : 'HAS_FAIL')
  await browser.close()
})().catch(e => { console.error('FATAL', e); process.exit(1) })
