/* v189 真机验收：合计(箱) = 合计(小单位) ÷ 规格（规格 = 每箱小单位数，取规格串末位数量）
 *
 * 为什么必须用「改单元格但不保存」：
 *   生产期次 9 的 4 行各只有 1 件，且都小于 1 箱 ⇒ 新旧口径下 合计(箱) 都是 0，**不具判别力**。
 *   改单网格里把数量改成 80（商品「10g*5杯*8条」，报单单位=杯）：
 *     新口径 perCase = 5×8 = 40 ⇒ 80÷40 = **2 箱**
 *     旧口径 parseFloat('10g*5杯*8条') = 10 ⇒ 80÷10 = **8 箱**
 *   两个数字不会撞车 ⇒ 读到的 2 只可能来自新口径。
 *   ⚠️ 全程**不点保存**，页面关闭即丢 ⇒ 生产数据零写入。
 *
 * ⚠️ 三条实测踩过的坑（写进本文件，别再踩第四次）：
 *   ① **表尾是另一张 table** —— `tr.col-total` / `tr.foot-row` 都在 `div.col-total-bar > table` 里，
 *      用 `table.cross-tbl` 直接 `querySelector` 只会命中**主表**，取到 null ⇒ 数字全 NaN。
 *   ② **只读表是虚拟滚动** —— 158 行只渲染约 26 行，「表尾 == 渲染行之和」在只读态**恒不成立**；
 *      改单表用 v-show 全量渲染，逐行求和只能在**改单态**做。
 *   ③ **v-show 隐藏行的 `innerText` 是空串** —— 找行/读格必须用 `textContent`。
 *
 * 用法：NODE_PATH=<managed ws>/node_modules node forecast-boxes-v189-verify.js
 *   HG_USER / HG_PASS / HG_PERIOD / HG_SHOT_DIR 可覆盖
 */
const puppeteer = require('puppeteer-core')

const BASE = 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const PERIOD_ID = Number(process.env.HG_PERIOD || 9)
const EXEC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHOT = process.env.HG_SHOT_DIR || '/tmp'
const TARGET = '10g*5杯*8条'
const TARGET_SPEC = '10g*5杯*8条'
const TARGET_UNIT = '杯'
const NEW_QTY = 80
const sleep = ms => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
const failures = []
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ✅ ' + label) }
  else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); console.log('  ❌ ' + label + (detail ? '  [' + detail + ']' : '')) }
}
const num = s => { const m = String(s == null ? '' : s).replace(/[, ¥]/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN }

/* 规则镜像：**只用来算期望值**；被测对象是浏览器里跑的那份源码（已由本地断言证明两者同源） */
function perCase(spec, unit) {
  const segs = []
  const re = /(\d+(?:\.\d+)?)\s*([^\d\s*×xX·]*)/g
  let m
  while ((m = re.exec(String(spec == null ? '' : spec)))) { const n = parseFloat(m[1]); if (n > 0) segs.push({ n, u: String(m[2] || '').trim() }) }
  if (!segs.length) return 0
  const last = segs[segs.length - 1]
  if (segs.length === 1 && !last.u) return last.n
  if (!last.u) return last.n
  const u0 = String(unit == null ? '' : unit).trim()
  if (!u0 || u0 === last.u) return last.n
  const i = segs.findIndex(x => x.u === u0)
  if (i >= 0 && i < segs.length - 1) return segs.slice(i).reduce((p, x) => p * x.n, 1)
  return last.n
}

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  })
  const d = await r.json()
  if (!d.token) throw new Error('login failed: ' + JSON.stringify(d).slice(0, 200))
  return d
}

;(async () => {
  const sess = await login()
  console.log(`账号 ${USER} · tenant=${sess.tenant_id} · role=${sess.user && sess.user.role} · 期次 ${PERIOD_ID}`)

  const browser = await puppeteer.launch({
    executablePath: EXEC, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1700,1100'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1700, height: 1100 })
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  page.on('dialog', async d => { try { await d.accept() } catch (e) {} })

  await page.evaluateOnNewDocument((t, u, ten) => {
    localStorage.setItem('hergent_v2_token', t)
    localStorage.setItem('hergent_v2_user', JSON.stringify(u || {}))
    if (ten) localStorage.setItem('hergent_v2_tenant', String(ten))
  }, sess.token, sess.user, sess.tenant_id)

  await page.goto(`${BASE}/?cb=${Date.now()}#/forecast`, { waitUntil: 'networkidle2', timeout: 90000 })
  await page.waitForSelector('table.cross-tbl', { timeout: 30000 }).catch(() => {})
  await sleep(3500)

  const url = page.url()
  ok(/#\/forecast/.test(url), '导航未被守卫踢回登录页', url)
  if (!/#\/forecast/.test(url)) { await browser.close(); process.exit(1) }

  await page.select('select.sel-period', String(PERIOD_ID)).catch(() => {})
  await sleep(4000)

  /* ---------- [1] 只读汇总表 ---------- */
  console.log('\n[1] 只读汇总表：「合计(小单位)」/「合计(箱)」列与表尾（表尾在 .col-total-bar 的独立 table 里）')
  const ro = await page.evaluate(() => {
    const main = document.querySelector('table.cross-tbl')
    const bar = document.querySelector('.col-total-bar')
    if (!main) return { err: '主表未渲染' }
    const heads = Array.from(main.querySelectorAll('thead th')).map(th => (th.textContent || '').replace(/\s+/g, '').trim())
    const map = {}
    heads.forEach((h, i) => { if (!(h in map)) map[h] = i })
    const ftr = bar ? bar.querySelector('tbody tr') : null
    const fcells = ftr ? Array.from(ftr.querySelectorAll('td')).map(td => (td.textContent || '').trim()) : []
    const pin = document.querySelector('.pin')
    const note = document.querySelector('.cross-amt-note')
    return {
      nCol: heads.length, map, fCells: fcells,
      renderedRows: main.querySelectorAll('tbody tr.data-row').length,
      pin: pin ? (pin.textContent || '').replace(/\s+/g, ' ').trim() : '',
      note: note ? (note.textContent || '').replace(/\s+/g, ' ').trim() : '',
    }
  })
  ok(!!ro.map, '主表已渲染', JSON.stringify(ro.err || ''))
  const iQ = ro.map && ro.map['合计(小单位)']
  const iB = ro.map && ro.map['合计(箱)']
  ok(iQ !== undefined, '存在列「合计(小单位)」')
  ok(iB !== undefined, '存在列「合计(箱)」')
  ok(!!ro.fCells && ro.fCells.length === ro.nCol, '表尾列数与表头一致（可按下标对齐取数）', `footer=${ro.fCells && ro.fCells.length} head=${ro.nCol}`)
  const roQ = num(ro.fCells[iQ])
  const roB = num(ro.fCells[iB])
  console.log(`     只读表尾 合计(小单位)=${roQ} 合计(箱)=${roB}（该期渲染 ${ro.renderedRows} 行 · 虚拟滚动）`)
  const pinQ = num(String(ro.pin).split('合计(小单位)')[1])
  const pinB = num(String(ro.pin).split('合计(箱)')[1])
  ok(/合计\(小单位\)/.test(ro.pin) && /合计\(箱\)/.test(ro.pin), '页头汇总条并列显示两个口径（自证）', String(ro.pin).slice(0, 80))
  ok(pinQ === roQ && pinB === roB, '页头汇总条与表尾逐字同源', `pin ${pinQ}/${pinB} vs foot ${roQ}/${roB}`)
  ok(/每箱小单位数/.test(ro.note), '页面注记写明「规格 = 每箱小单位数」', String(ro.note).slice(0, 110))
  await page.screenshot({ path: SHOT + '/v189-1-readonly.png' })

  /* ---------- [2] 进改单：全量渲染，可做逐行求和 ---------- */
  console.log('\n[2] 改单网格：表尾 == 逐行求和（改单表用 v-show 全量渲染，才可做这件事）')
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => /改单/.test(b.textContent || ''))
    if (btn) btn.click()
  })
  await page.waitForFunction(() => {
    const b = document.querySelector('.col-total-bar')
    return !!(b && b.querySelector('tbody tr.foot-row') && b.querySelectorAll('tbody tr').length >= 1)
  }, { timeout: 60000 }).catch(() => {})
  await sleep(3000)

  const g1 = await page.evaluate(() => {
    const main = document.querySelector('table.cross-tbl.edit-tbl')
    const bar = document.querySelector('.col-total-bar')
    const ftr = bar ? bar.querySelector('tbody tr.foot-row') : null
    const pick = (root, sel) => { const e = root && root.querySelector(sel); return e ? (e.textContent || '').trim() : null }
    const rows = Array.from(main.querySelectorAll('tbody tr')).map(tr => ({
      name: (tr.querySelector('input.cell-name') || {}).value || '',
      sum: (tr.querySelector('td.num.calc.sum') || {}).textContent || '0',
      boxes: (tr.querySelector('td.num.calc.boxes') || {}).textContent || '0',
    }))
    return {
      nRows: rows.length, rows,
      footSum: pick(ftr, 'td.num.calc.sum'), footBoxes: pick(ftr, 'td.num.calc.boxes'),
      summary: (document.querySelector('.edit-summary') || {}).textContent || '',
      hasNoteInEdit: !!document.querySelector('.cross-amt-note'),
    }
  })
  const before = (g1.rows || []).find(r => (r.name || '').includes(TARGET)) || null
  console.log(`     改动前该行：合计(小单位)=${before ? num(before.sum) : '—'} 合计(箱)=${before ? num(before.boxes) : '—'}`)
  const sumQ = g1.rows.reduce((s, r) => s + (num(r.sum) || 0), 0)
  const sumB = g1.rows.reduce((s, r) => s + (num(r.boxes) || 0), 0)
  console.log(`     改单 ${g1.nRows} 行｜逐行求和 小单位=${sumQ} 箱=${sumB}｜表尾 小单位=${num(g1.footSum)} 箱=${num(g1.footBoxes)}`)
  ok(num(g1.footBoxes) === sumB, '改单表尾「合计(箱)」== 逐行「合计(箱)」之和（同源）', `${num(g1.footBoxes)} vs ${sumB}`)
  ok(num(g1.footSum) === sumQ, '改单表尾「合计(小单位)」== 逐行「合计(小单位)」之和（同源）', `${num(g1.footSum)} vs ${sumQ}`)
  ok(num(g1.footBoxes) === roB, '只读表尾「合计(箱)」== 改单表尾「合计(箱)」（两态同源）', `${roB} vs ${num(g1.footBoxes)}`)
  ok(num(g1.footSum) === roQ, '只读表尾「合计(小单位)」== 改单表尾（两态同源）', `${roQ} vs ${num(g1.footSum)}`)
  const sB0 = num(String(g1.summary).split('合计(箱)')[1])
  ok(sB0 === num(g1.footBoxes), '编辑态汇总条「合计(箱)」== 改单表尾（同屏口径同源）', `summary ${sB0} vs foot ${num(g1.footBoxes)}`)
  ok(/合计\(小单位\)/.test(g1.summary) && /合计\(箱\)/.test(g1.summary), '编辑态汇总条并列显示两个口径', String(g1.summary).replace(/\s+/g, ' ').slice(0, 110))

  /* ---------- [3] 判别性实验：改一个单元格（不保存） ---------- */
  console.log(`\n[3] 判别性实验：把「${TARGET}」数量改成 ${NEW_QTY}（**不保存**）`)
  const setRes = await page.evaluate((tname, qty) => {
    const main = document.querySelector('table.cross-tbl.edit-tbl')
    if (!main) return { err: '编辑网格未出现' }
    const trs = Array.from(main.querySelectorAll('tbody tr'))
    // 🔴 必须按 `input.cell-name` 的 **value** 找行 —— 商品名在 <input> 里，
    //    而 input 的 value **不参与 textContent** ⇒ 用 textContent 找必然 0 命中（实测踩过）。
    const nameOf = tr => { const i = tr.querySelector('input.cell-name'); return i ? String(i.value || '') : '' }
    const tr = trs.find(x => nameOf(x).includes(tname))
    if (!tr) return { err: '找不到商品行 ' + tname, rows: trs.length, sample: trs.slice(0, 3).map(nameOf) }
    const inp = tr.querySelector('input.cell-input.cell-qty')
    if (!inp) return { err: '该行没有数量输入框' }
    inp.value = String(qty)
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    return { okSet: true, rows: trs.length, name: nameOf(tr) }
  }, TARGET, NEW_QTY)
  ok(setRes.okSet === true, `已把「${TARGET}」的数量改为 ${NEW_QTY}（未保存）`, JSON.stringify(setRes))
  await sleep(1800)

  const g2 = await page.evaluate((tname) => {
    const main = document.querySelector('table.cross-tbl.edit-tbl')
    const bar = document.querySelector('.col-total-bar')
    const ftr = bar ? bar.querySelector('tbody tr.foot-row') : null
    const pick = (root, sel) => { const e = root && root.querySelector(sel); return e ? (e.textContent || '').trim() : null }
    const trs = Array.from(main.querySelectorAll('tbody tr'))
    const rows = trs.map(tr => ({
      name: (tr.querySelector('input.cell-name') || {}).value || '',
      sum: (tr.querySelector('td.num.calc.sum') || {}).textContent || '0',
      boxes: (tr.querySelector('td.num.calc.boxes') || {}).textContent || '0',
      price: (tr.querySelector('td.num.calc.price') || {}).textContent || '',
    }))
    const t = rows.find(r => (r.name || '').includes(tname))
    return {
      rows, target: t || null,
      footSum: pick(ftr, 'td.num.calc.sum'), footBoxes: pick(ftr, 'td.num.calc.boxes'),
      summary: (document.querySelector('.edit-summary') || {}).textContent || '',
    }
  }, TARGET)

  const expNew = Math.round(NEW_QTY / perCase(TARGET_SPEC, TARGET_UNIT))
  const expOld = Math.round(NEW_QTY / parseFloat(TARGET_SPEC))
  ok(!!g2.target, `改单网格里定位到「${TARGET}」行`)
  if (g2.target) {
    console.log(`     该行 合计(小单位)=${num(g2.target.sum)} 合计(箱)=${num(g2.target.boxes)}（${g2.target.price.trim()}）`)
    console.log(`     期望：新口径 round(${num(g2.target.sum)} ÷ ${perCase(TARGET_SPEC, TARGET_UNIT)}) = ${expNew} 箱｜旧口径 round(${num(g2.target.sum)} ÷ ${parseFloat(TARGET_SPEC)}) = ${expOld} 箱`)
    // 意图断言：不是「等于 80」（该行别的客户列可能本来就有量），而是「恰好增加了 80」——
    //   匹配意图而不是匹配写死的原话（实测：该行另有 1 件，故行合计 = 81）。
    if (before) {
      ok(num(g2.target.sum) - num(before.sum) === NEW_QTY, `该行 合计(小单位) 恰好增加 ${NEW_QTY}（${num(before.sum)} → ${num(g2.target.sum)}）`,
        String(num(g2.target.sum) - num(before.sum)))
    }
    ok(num(g2.target.boxes) === Math.round(num(g2.target.sum) / perCase(TARGET_SPEC, TARGET_UNIT)),
      `该行 合计(箱) = round(行合计小单位 ÷ 每箱 ${perCase(TARGET_SPEC, TARGET_UNIT)}) = ${num(g2.target.boxes)}`, String(g2.target.boxes))
    ok(num(g2.target.boxes) === expNew, `该行 合计(箱) = 新口径 ${expNew} 箱`, String(g2.target.boxes))
    ok(num(g2.target.boxes) !== expOld, `该行 合计(箱) ≠ 旧口径 ${expOld} 箱 ⇒ 线上跑的确实是新口径（判别性成立）`)
  }
  const sumB2 = g2.rows.reduce((s, r) => s + (num(r.boxes) || 0), 0)
  const sumQ2 = g2.rows.reduce((s, r) => s + (num(r.sum) || 0), 0)
  console.log(`     改单逐行求和 小单位=${sumQ2} 箱=${sumB2}｜表尾 小单位=${num(g2.footSum)} 箱=${num(g2.footBoxes)}`)
  ok(num(g2.footBoxes) === sumB2 && sumB2 === expNew, `表尾「合计(箱)」== 逐行之和 == ${expNew}`, `${num(g2.footBoxes)} / ${sumB2}`)
  ok(num(g2.footSum) === sumQ2, '表尾「合计(小单位)」== 逐行之和（改动后仍同源）', `${num(g2.footSum)} vs ${sumQ2}`)
  ok(num(String(g2.summary).split('合计(箱)')[1]) === num(g2.footBoxes), '编辑态汇总条「合计(箱)」随行改动同步（同源）',
    `summary ${num(String(g2.summary).split('合计(箱)')[1])} vs foot ${num(g2.footBoxes)}`)
  ok(!g2.rows.some(r => num(r.sum) > 0 && num(r.boxes) === 0 && num(r.sum) >= 40), '不存在「小单位≥40 却 0 箱」的旧口径症状（每箱数被误取成净含量时会这样）')
  await page.screenshot({ path: SHOT + '/v189-2-editgrid.png' })

  const realErrs = errs.filter(e => !/403|401|Failed to load resource|net::ERR/.test(e))
  ok(realErrs.length === 0, '无 JS 运行时报错', realErrs.slice(0, 3).join(' | '))

  console.log('\n   ⚠️ 全程未点「保存」—— 生产数据零写入（页面关闭即丢草稿）')
  console.log('\n' + '='.repeat(64))
  console.log(`真机验收：通过 ${pass} / 失败 ${fail}`)
  if (fail) { console.log('失败项：'); failures.forEach(f => console.log('  · ' + f)) }
  await browser.close()
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('PROBE FAILED:', e && e.stack || e); process.exit(2) })
