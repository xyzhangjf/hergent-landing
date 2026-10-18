/**
 * v593 真机验证：拖动填充的实时视觉反馈
 *   D1 按住填充柄 ⇒ 立即出现虚线预览框，且恰好覆盖源格（1 格）
 *   D2 往下拖 2 行 ⇒ 虚线框随鼠标长大（高度 ≈ 3 行），期间光标为 crosshair
 *   D3 松手 ⇒ 框消失、3 格被写入、填充后范围成为选区（.range-sel）
 *   D4 再拖 2 行后按 Esc ⇒ 框消失且**不写入**（值保持 D3 结果）
 *   D5 页面零报错
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v593-fill-drag'
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

/** 目标格：第 i 行第 j 个数量格（只数「数据行」） */
const JS_CELL = (i, j) => `(() => {
  const tbl = document.querySelector('table.edit-tbl')
  if (!tbl) return JSON.stringify({ ok: false })
  const rows = [...tbl.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td.qty-cell input.cell-qty'))
  const tr = rows[${i}]
  if (!tr) return JSON.stringify({ ok: false, reason: 'no row', n: rows.length })
  const td = tr.querySelectorAll('td.qty-cell')[${j}]
  if (!td) return JSON.stringify({ ok: false, reason: 'no cell' })
  const r = td.getBoundingClientRect()
  return JSON.stringify({
    ok: true, n: rows.length,
    x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1),
    w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1),
    val: (td.querySelector('input') || {}).value ?? null
  })
})()`

const JS_HANDLE = `(() => {
  const h = document.querySelector('td.selected .fill-handle')
  if (!h) return JSON.stringify({ ok: false })
  const r = h.getBoundingClientRect()
  return JSON.stringify({ ok: true, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1), w: +r.width.toFixed(1) })
})()`

const JS_MARQUEE = `(() => {
  const tbl = document.querySelector('table.edit-tbl')
  const mq = document.querySelector('.fill-marquee')
  if (!mq) return JSON.stringify({ ok: false, exists: false })
  const w = mq.parentElement
  const r = mq.getBoundingClientRect()
  const cs = getComputedStyle(mq)
  const cell = tbl && tbl.querySelector('td.selected')
  const csCell = cell ? getComputedStyle(cell) : null
  return JSON.stringify({
    ok: true, exists: true,
    boxL: +r.left.toFixed(1), boxT: +r.top.toFixed(1), boxW: +r.width.toFixed(1), boxH: +r.height.toFixed(1),
    borderStyle: cs.borderTopStyle, pe: cs.pointerEvents, z: cs.zIndex,
    wrapFilling: w ? w.classList.contains('is-filling') : false,
    cellCursor: csCell ? csCell.cursor : null
  })
})()`

const JS_VALS = (i, n) => `(() => {
  const tbl = document.querySelector('table.edit-tbl')
  const rows = [...tbl.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td.qty-cell input.cell-qty'))
  const out = []
  for (let k = ${i}; k < ${i} + ${n}; k++) {
    const td = rows[k] && rows[k].querySelector('td.qty-cell')
    if (!td) { out.push(null); continue }
    out.push({ v: (td.querySelector('input') || {}).value ?? null, rangeSel: td.classList.contains('range-sel') })
  }
  return JSON.stringify(out)
})()`

const JS_TOAST = `(() => {
  const t = [...document.querySelectorAll('*')].filter(x => /已填充|已取消/.test(x.textContent || '') && x.children.length === 0)
  return JSON.stringify(t.map(x => (x.textContent || '').trim()).slice(-3))
})()`

let browser
const log = (...a) => console.log(...a)
const res = {}
try {
  fs.mkdirSync(OUT, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()
  const move = (x, y) => page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' })
  const moveNone = (x, y) => page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  const down = (x, y) => page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  const up = (x, y) => page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  const click1 = async (x, y) => { await moveNone(x, y); await down(x, y); await up(x, y); await sleep(400) }
  const key = async (k, code, vk) => {
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk })
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk })
  }

  await page.goto(BASE, 3500)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 7000)
  await sleep(4000)
  log('构建号:', await page.eval(`(() => document.documentElement.dataset.build || '?')()`))
  log('改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(900)
  const c = JSON.parse(await page.eval(JS_CONFIRM))
  if (c.ok) await sleep(1600)

  // 选一个数量格（第 2 行第 1 个数量列），先写一个可辨识的值
  const c0 = JSON.parse(await page.eval(JS_CELL(1, 0)))
  log('源格:', JSON.stringify(c0))
  await click1(c0.x, c0.y)
  await page.raw.send('Input.insertText', { text: '77' })
  await sleep(300)
  await key('Tab', 'Tab', 9)
  await sleep(400)
  await click1(c0.x, c0.y)
  const h = JSON.parse(await page.eval(JS_HANDLE))
  log('填充柄:', JSON.stringify(h))
  await page.screenshot(OUT + '/D0-拖动前.png')

  // D1 按住填充柄：立即出框，覆盖源格
  await moveNone(h.x, h.y)
  await down(h.x, h.y)
  await sleep(250)
  const m1 = JSON.parse(await page.eval(JS_MARQUEE))
  log('D1 按住:', JSON.stringify(m1))
  res.d1 = m1.exists && m1.borderStyle === 'dashed' && m1.pe === 'none' && m1.wrapFilling === true
    && Math.abs(m1.boxH - c0.h) <= 2 && Math.abs(m1.boxW - c0.w) <= 2

  // D2 往下拖 2 行
  const c2 = JSON.parse(await page.eval(JS_CELL(3, 0)))
  await move(c2.x, c2.y)
  await sleep(250)
  const m2 = JSON.parse(await page.eval(JS_MARQUEE))
  log('D2 拖到第4行:', JSON.stringify(m2))
  const hRows = m2.boxH / c0.h
  res.d2 = m2.exists && hRows >= 2.6 && hRows <= 3.4 && m2.cellCursor === 'crosshair'
  await page.screenshot(OUT + '/D2-拖动中.png')

  // D3 松手
  await up(c2.x, c2.y)
  await sleep(600)
  const m3 = JSON.parse(await page.eval(JS_MARQUEE))
  const v3 = JSON.parse(await page.eval(JS_VALS(1, 3)))
  log('D3 松手后框:', JSON.stringify(m3), '值:', JSON.stringify(v3))
  log('   toast:', await page.eval(JS_TOAST))
  res.d3 = m3.exists === false && v3.every(x => x && String(x.v) === '77') && v3.every(x => x.rangeSel === true)
  await page.screenshot(OUT + '/D3-填充后.png')

  // D4 再拖后 Esc 取消：不应写入
  const c3 = JSON.parse(await page.eval(JS_CELL(1, 0)))
  await click1(c3.x, c3.y)
  const h2 = JSON.parse(await page.eval(JS_HANDLE))
  await moveNone(h2.x, h2.y)
  await down(h2.x, h2.y)
  await sleep(150)
  const c5 = JSON.parse(await page.eval(JS_CELL(5, 0)))
  await move(c5.x, c5.y)
  await sleep(250)
  const m4 = JSON.parse(await page.eval(JS_MARQUEE))
  await key('Escape', 'Escape', 27)
  await sleep(300)
  await up(c5.x, c5.y)
  await sleep(500)
  const m5 = JSON.parse(await page.eval(JS_MARQUEE))
  const v5 = JSON.parse(await page.eval(JS_VALS(4, 2)))
  log('D4 Esc 前框高:', m4.boxH, '| Esc 后:', JSON.stringify(m5), '| 值:', JSON.stringify(v5))
  log('   toast:', await page.eval(JS_TOAST))
  res.d4 = m4.exists && m5.exists === false && v5.every(x => x && String(x.v) !== '77')

  const errs = (page.errors || []).filter(x => !/favicon|ResizeObserver/i.test(String(x)))
  log('页面错误:', JSON.stringify(errs.slice(-4)))
  res.d5 = errs.length === 0
} catch (e) {
  log('探针异常:', e && e.message)
  res.error = String(e && e.message)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
}
log('\n=== 结果 ===')
for (const k of ['d1', 'd2', 'd3', 'd4', 'd5']) log(k, res[k] ? 'PASS' : 'FAIL')
process.exit(0)
