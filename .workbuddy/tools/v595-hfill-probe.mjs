/**
 * v595 真机验证：拖动填充「横向」—— 横向自动滚动 + 只在数量区内扩散
 *   H1 按住填充柄拖到容器右边缘外侧并停住 ⇒ scrollLeft 变大、虚线框变宽（横向自滚）
 *   H2 滚到最右 ⇒ 框的右边界不超过**最后一个报单单元列**（夹取生效）
 *   H3 松手 ⇒ 提示「已填充 N 格（… × M 列）」；所有被选中格（.range-sel）都是数量格
 *   H4 向右再向左：向左拖进冻结列区 ⇒ 框左边界停在**第一个报单单元列**，不跳回商品名/档案列
 *   H5 松手后 scrollLeft 不再变化（rAF 真停）
 *   H6 页面零报错
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v595-hfill'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json().then(d=>({s:r.status,d:d})))'
  + '.then(r=>{var d=r.d;if(!d.token)return JSON.stringify({ok:false,status:r.s,detail:d.detail||""});'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return JSON.stringify({ok:true})})'

const JS_ENTER_EDIT = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('改单') && x.offsetParent !== null)
  if (!b) return JSON.stringify({ ok: false })
  b.click(); return JSON.stringify({ ok: true })
})()`

const JS_CONFIRM = `(() => {
  const m = document.querySelector('.imp-modal, .modal, [role="dialog"]')
  if (!m) return JSON.stringify({ ok: false })
  const b = [...m.querySelectorAll('button')].find(x => /仍要|确定|进入|确认/.test(x.textContent || ''))
  if (!b) return JSON.stringify({ ok: false })
  b.click(); return JSON.stringify({ ok: true })
})()`

/* 取第 i 个数据行的第 j 个数量格 */
const JS_CELL = (i, j) => `(() => {
  const tbl = document.querySelector('table.edit-tbl')
  if (!tbl) return JSON.stringify({ ok: false })
  const rows = [...tbl.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td.qty-cell'))
  const tr = rows[${i}]
  if (!tr) return JSON.stringify({ ok: false, reason: 'no row', n: rows.length })
  const tds = tr.querySelectorAll('td.qty-cell')
  const td = tds[${j}]
  if (!td) return JSON.stringify({ ok: false, reason: 'no col', n: tds.length })
  const r = td.getBoundingClientRect()
  return JSON.stringify({ ok: true, n: rows.length, nq: tds.length, dc: td.getAttribute('data-c'),
    x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) })
})()`

const JS_HANDLE = `(() => {
  const h = document.querySelector('td.selected .fill-handle')
  if (!h) return JSON.stringify({ ok: false })
  const r = h.getBoundingClientRect()
  return JSON.stringify({ ok: true, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) })
})()`

const JS_WRAP = `(() => {
  const w = document.querySelector('.edit-grid-wrap')
  if (!w) return JSON.stringify({ ok: false })
  const r = w.getBoundingClientRect()
  return JSON.stringify({
    ok: true,
    cLeft: +(r.left + w.clientLeft).toFixed(1), cRight: +(r.left + w.clientLeft + w.clientWidth).toFixed(1),
    cTop: +(r.top + w.clientTop).toFixed(1), cBottom: +(r.top + w.clientTop + w.clientHeight).toFixed(1),
    scrollLeft: Math.round(w.scrollLeft), scrollW: w.scrollWidth, clientW: w.clientWidth,
    scrollTop: Math.round(w.scrollTop), scrollH: w.scrollHeight, clientH: w.clientHeight,
    innerW: innerWidth, innerH: innerHeight
  })
})()`

const JS_MARQ = `(() => {
  const mq = document.querySelector('.fill-marquee')
  if (!mq) return JSON.stringify({ ok: false })
  const r = mq.getBoundingClientRect()
  return JSON.stringify({ ok: true, left: +r.left.toFixed(1), right: +r.right.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) })
})()`

/* 第 1 个与最后 1 个数量格的几何 + 冻结列右边界（用于判断夹取是否生效） */
const JS_BOUNDS = `(() => {
  const tbl = document.querySelector('table.edit-tbl')
  const w = document.querySelector('.edit-grid-wrap')
  if (!tbl || !w) return JSON.stringify({ ok: false })
  const qty = [...tbl.querySelectorAll('td.qty-cell')].filter(td => td.getBoundingClientRect().width > 0)
  if (!qty.length) return JSON.stringify({ ok: false, reason: 'no qty' })
  const first = qty[0].getBoundingClientRect(), last = qty[qty.length - 1].getBoundingClientRect()
  let fr = 0
  w.querySelectorAll('thead .seq-th, thead th.frozen').forEach(el => { const r = el.getBoundingClientRect(); if (r.width && r.right > fr) fr = r.right })
  return JSON.stringify({ ok: true, firstL: +first.left.toFixed(1), firstC: qty[0].getAttribute('data-c'),
    lastR: +last.right.toFixed(1), lastC: qty[qty.length - 1].getAttribute('data-c'), frozenR: +fr.toFixed(1) })
})()`

const JS_TOAST = `(() => {
  const t = [...document.querySelectorAll('*')].filter(x => /已填充|已取消/.test(x.textContent || '') && x.children.length === 0)
  return JSON.stringify(t.map(x => (x.textContent || '').trim()).slice(-2))
})()`

/* 被选中格统计：总数 / 其中数量格 / 落在非数量列上的（应为 0） */
const JS_SEL = `(() => {
  const v = [...document.querySelectorAll('td.range-sel')]
  const qty = v.filter(td => td.classList.contains('qty-cell'))
  const bad = v.filter(td => !td.classList.contains('qty-cell')).map(td => td.className).slice(0, 4)
  return JSON.stringify({ total: v.length, qty: qty.length, bad })
})()`

/* 诊断：整个第 i 行里哪些格出现了刚才填的值（用来证明没污染单价/加单） */
const JS_ROWVAL = (i, val) => `(() => {
  const tbl = document.querySelector('table.edit-tbl')
  const rows = [...tbl.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td.qty-cell'))
  const tr = rows[${i}]; if (!tr) return JSON.stringify({ ok: false })
  const hit = []
  ;[...tr.querySelectorAll('td')].forEach(td => {
    const inp = td.querySelector('input')
    const v = inp ? String(inp.value) : String(td.textContent || '').trim()
    if (v !== '' && v.indexOf(${JSON.stringify(val)}) >= 0) hit.push({ c: td.getAttribute('data-c'), qty: td.classList.contains('qty-cell'), cls: td.className.slice(0, 40), v })
  })
  return JSON.stringify({ ok: true, hit })
})()`

let browser
const log = (...a) => console.log(...a)
const res = {}
try {
  fs.mkdirSync(OUT, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()
  const moveNone = (x, y) => page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  const move = (x, y) => page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' })
  const down = (x, y) => page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  const up = (x, y) => page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  const click1 = async (x, y) => { await moveNone(x, y); await down(x, y); await up(x, y); await sleep(400) }

  await page.goto(BASE, 3500)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 7000)
  await sleep(4000)
  log('构建号:', await page.eval(`(() => document.documentElement.dataset.build || '?')()`))
  log('改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(900)
  const c = JSON.parse(await page.eval(JS_CONFIRM))
  if (c.ok) await sleep(1600)

  // 源格：第 1 行、第 1 个报单单元列，写个可辨识的值 66
  const c0 = JSON.parse(await page.eval(JS_CELL(0, 0)))
  log('源格:', JSON.stringify(c0))
  await click1(c0.x, c0.y)
  await page.raw.send('Input.insertText', { text: '66' })
  await sleep(250)
  await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await sleep(350)
  await click1(c0.x, c0.y)
  const h = JSON.parse(await page.eval(JS_HANDLE))
  const w0 = JSON.parse(await page.eval(JS_WRAP))
  const b0 = JSON.parse(await page.eval(JS_BOUNDS))
  log('填充柄:', JSON.stringify(h))
  log('容器:', JSON.stringify(w0))
  log('边界:', JSON.stringify(b0))

  // ── H1 向右拖到容器右边缘外侧并停住 ⇒ 横向自动滚动 + 框变宽
  await moveNone(h.x, h.y)
  await down(h.x, h.y)
  await sleep(200)
  const outX = Math.min(w0.cRight + 40, w0.innerW - 6)
  await move(outX, h.y)
  await sleep(120)
  const m1a = JSON.parse(await page.eval(JS_MARQ))
  const s1a = JSON.parse(await page.eval(JS_WRAP))
  await sleep(800)
  const m1b = JSON.parse(await page.eval(JS_MARQ))
  const s1b = JSON.parse(await page.eval(JS_WRAP))
  log('H1 停住 0.12s:', JSON.stringify({ w: m1a.w, scrollLeft: s1a.scrollLeft }))
  log('H1 停住 0.92s:', JSON.stringify({ w: m1b.w, scrollLeft: s1b.scrollLeft }))
  res.h1 = m1b.w > m1a.w + 40 && s1b.scrollLeft > s1a.scrollLeft + 20
  await page.screenshot(OUT + '/H1-横向自动滚动中.png')

  // ── H2 继续按住滚到底（轮询到不再变化）
  let s2 = JSON.parse(await page.eval(JS_WRAP))
  for (let i = 0; i < 45; i++) {
    await sleep(200)
    const nx = JSON.parse(await page.eval(JS_WRAP))
    if (nx.scrollLeft === s2.scrollLeft) break
    s2 = nx
  }
  const m2 = JSON.parse(await page.eval(JS_MARQ))
  const b2 = JSON.parse(await page.eval(JS_BOUNDS))
  log('H2 滚到最右:', JSON.stringify({ scrollLeft: s2.scrollLeft, max: s2.scrollW - s2.clientW, boxR: m2.right }))
  log('H2 边界:', JSON.stringify(b2))
  res.h2 = m2.right <= b2.lastR + 2 && m2.right > b2.lastR - 12
  await page.screenshot(OUT + '/H2-横向滚到底.png')

  // ── H3 松手：提示 + 选中格必须全是数量格
  await up(m2.right - 6, h.y)
  await sleep(800)
  const toast = JSON.parse(await page.eval(JS_TOAST))
  const sel = JSON.parse(await page.eval(JS_SEL))
  const rowHit = JSON.parse(await page.eval(JS_ROWVAL(0, '66')))
  const msg = toast[toast.length - 1] || ''
  log('H3 toast:', JSON.stringify(toast), '| 选中:', JSON.stringify(sel))
  log('H3 第1行含 66 的格:', JSON.stringify(rowHit))
  const mm = msg.match(/已填充\s*(\d+)\s*格（[^）]*×\s*(\d+)\s*列）/)
  res.h3 = !!mm && parseInt(mm[2]) >= 2 && sel.total > 0 && sel.bad.length === 0 && sel.qty === sel.total
  await page.screenshot(OUT + '/H3-横向填充后.png')

  // ── H5 松手后不再横滚（此刻仍停在最右，是唯一能测出"rAF 没停"的时机）
  await sleep(450)
  const wC0 = JSON.parse(await page.eval(JS_WRAP))
  await sleep(500)
  const wD0 = JSON.parse(await page.eval(JS_WRAP))
  log('H5 松手后 scrollLeft:', wC0.scrollLeft, '→', wD0.scrollLeft)
  res.h5 = wC0.scrollLeft > 0 && Math.abs(wD0.scrollLeft - wC0.scrollLeft) <= 1

  // ── H4 向左：用中间的数量列做源，拖进冻结列区 ⇒ 左边界停在第一个数量列
  await sleep(300)
  // 先横向滚回最左，保证第 1/2 个数量列可见
  await page.eval(`(() => { document.querySelector('.edit-grid-wrap').scrollLeft = 0; return '1' })()`)
  await sleep(400)
  const cM = JSON.parse(await page.eval(JS_CELL(0, 2)))
  log('H4 源格(第3个单元列):', JSON.stringify(cM))
  if (cM.ok) {
    await click1(cM.x, cM.y)
    const h3 = JSON.parse(await page.eval(JS_HANDLE))
    const w3 = JSON.parse(await page.eval(JS_WRAP))
    const b3 = JSON.parse(await page.eval(JS_BOUNDS))
    await moveNone(h3.x, h3.y)
    await down(h3.x, h3.y)
    await sleep(180)
    await move(Math.max(w3.cLeft - 60, 2), h3.y)          // 指针推到容器左侧外（落在冻结列上）
    await sleep(700)
    const m3 = JSON.parse(await page.eval(JS_MARQ))
    const b4 = JSON.parse(await page.eval(JS_BOUNDS))
    log('H4 向左拖到冻结区 ⇒ 框:', JSON.stringify(m3), '| 首个数量列 left:', b4.firstL, '| 冻结列右:', b4.frozenR)
    res.h4 = m3.left >= b4.firstL - 2 && m3.left > b4.frozenR + 2
    await page.screenshot(OUT + '/H4-向左夹取.png')
    await up(m3.left + 6, h3.y)
    await sleep(500)
  } else res.h4 = false

  const errs = (page.errors || []).filter(x => !/favicon|ResizeObserver/i.test(String(x)))
  log('页面错误:', JSON.stringify(errs.slice(-4)))
  res.h6 = errs.length === 0
} catch (e) {
  log('探针异常:', e && e.message)
  res.error = String(e && e.message)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
}
log('\n=== 结果 ===')
for (const k of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) log(k, res[k] ? 'PASS' : 'FAIL')
process.exit(0)
