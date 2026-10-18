/**
 * v594 真机验证：拖动填充「边缘自动滚动」+ 提示带行号
 *   E1 按住填充柄拖到表格下边缘**外侧**并停住不动 ⇒ 滚动容器自动下滚、框持续变高
 *   E2 继续拖到底（滚不动为止）⇒ 终点行号 = 表尾附近，且框高 ≈ 行数 × 行高
 *   E3 松手 ⇒ 提示文案为「已填充 N 格（第 A→B 行）」，且被填格数 = B−A+1
 *   E4 拖到上边缘外侧 ⇒ 反向自动滚动（scrollTop 变小）
 *   E5 松开后 rAF 停止（再等 400ms，scrollTop 不再变化 —— 防"松手了还在滚"）
 *   E6 页面零报错
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v594-fill-autoscroll'
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

const JS_CELL = (i, j) => `(() => {
  const tbl = document.querySelector('table.edit-tbl')
  if (!tbl) return JSON.stringify({ ok: false })
  const rows = [...tbl.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td.qty-cell input.cell-qty'))
  const tr = rows[${i}]
  if (!tr) return JSON.stringify({ ok: false, reason: 'no row', n: rows.length })
  const td = tr.querySelectorAll('td.qty-cell')[${j}]
  if (!td) return JSON.stringify({ ok: false })
  const r = td.getBoundingClientRect()
  return JSON.stringify({ ok: true, n: rows.length, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1), h: +r.height.toFixed(1), row: ${i} + 1 })
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
  const th = w.querySelector('thead')
  const tbl = w.querySelector('table.edit-tbl')
  const rows = tbl ? [...tbl.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td.qty-cell')) : []
  return JSON.stringify({
    ok: true, top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
    cTop: +(r.top + w.clientTop).toFixed(1), cBottom: +(r.top + w.clientTop + w.clientHeight).toFixed(1),
    scrollTop: Math.round(w.scrollTop), scrollH: w.scrollHeight, clientH: w.clientHeight,
    thead: th ? th.offsetHeight : 0, rows: rows.length, innerH: innerHeight
  })
})()`

const JS_MARQUEE = `(() => {
  const mq = document.querySelector('.fill-marquee')
  if (!mq) return JSON.stringify({ ok: false })
  const r = mq.getBoundingClientRect()
  return JSON.stringify({ ok: true, h: +r.height.toFixed(1), t: +r.top.toFixed(1), b: +r.bottom.toFixed(1) })
})()`

const JS_TOAST = `(() => {
  const t = [...document.querySelectorAll('*')].filter(x => /已填充|已取消/.test(x.textContent || '') && x.children.length === 0)
  return JSON.stringify(t.map(x => (x.textContent || '').trim()).slice(-2))
})()`

const JS_COUNT_FILLED = `(() => {
  const v = [...document.querySelectorAll('td.range-sel')]
  return JSON.stringify({ rangeSel: v.length })
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

  // 源格：第 1 行，第 1 个数量列；先写个可辨识的值
  const c0 = JSON.parse(await page.eval(JS_CELL(0, 0)))
  await click1(c0.x, c0.y)
  await page.raw.send('Input.insertText', { text: '55' })
  await sleep(250)
  await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await sleep(350)
  await click1(c0.x, c0.y)
  const h = JSON.parse(await page.eval(JS_HANDLE))
  const w0 = JSON.parse(await page.eval(JS_WRAP))
  log('源格:', JSON.stringify(c0), '| 填充柄:', JSON.stringify(h))
  log('容器:', JSON.stringify(w0))

  // E1 按到表格下边缘**外侧**（分页器上方一点）并停住
  await moveNone(h.x, h.y)
  await down(h.x, h.y)
  await sleep(200)
  /* 真实用户拖不到视口外：拖到**屏幕最下沿**（这也是最常见的动作） */
  const outY = Math.min(w0.cBottom + 30, w0.innerH - 6)
  await move(h.x, outY)
  await sleep(120)
  const m1a = JSON.parse(await page.eval(JS_MARQUEE))
  const s1a = JSON.parse(await page.eval(JS_WRAP))
  await sleep(700)                        // 不再移动鼠标，靠 rAF 自己滚
  const m1b = JSON.parse(await page.eval(JS_MARQUEE))
  const s1b = JSON.parse(await page.eval(JS_WRAP))
  log('E1 停住 0.12s:', JSON.stringify({ h: m1a.h, scroll: s1a.scrollTop }))
  log('E1 停住 0.82s:', JSON.stringify({ h: m1b.h, scroll: s1b.scrollTop }))
  res.e1 = m1b.h > m1a.h + 20 && s1b.scrollTop > s1a.scrollTop + 20
  await page.screenshot(OUT + '/E1-边缘自动滚动中.png')

  // E2 继续按住等它滚到底（重表下帧率低，不能只固定等，要轮询到不再变化）
  let s2 = JSON.parse(await page.eval(JS_WRAP))
  for (let i = 0; i < 45; i++) {
    await sleep(200)
    const nx = JSON.parse(await page.eval(JS_WRAP))
    if (nx.scrollTop === s2.scrollTop) break
    s2 = nx
  }
  const m2 = JSON.parse(await page.eval(JS_MARQUEE))
  log('E2 滚到底:', JSON.stringify({ boxH: m2.h, scrollTop: s2.scrollTop, max: s2.scrollH - s2.clientH }))
  const boxRows = m2.h / c0.h
  res.e2 = s2.scrollTop >= (s2.scrollH - s2.clientH) - 3 && boxRows > 8
  await page.screenshot(OUT + '/E2-滚到底.png')

  // E3 松手：提示文案 + 实际填充格数
  await up(h.x, m2.b - 8)
  await sleep(700)
  const toast = JSON.parse(await page.eval(JS_TOAST))
  const cnt = JSON.parse(await page.eval(JS_COUNT_FILLED))
  const msg = toast[toast.length - 1] || ''
  const mm = msg.match(/已填充\s*(\d+)\s*格（第\s*(\d+)→(\d+)\s*行）/)
  log('E3 toast:', JSON.stringify(toast), '| rangeSel:', JSON.stringify(cnt))
  const rowsInMsg = mm ? (parseInt(mm[3]) - parseInt(mm[2]) + 1) : -1
  res.e3 = !!mm && parseInt(mm[1]) === rowsInMsg && rowsInMsg >= 9 && cnt.rangeSel >= rowsInMsg
  await page.screenshot(OUT + '/E3-填充后.png')

  // E4 向上拖：反向自动滚动
  await sleep(400)
  const wNow = JSON.parse(await page.eval(JS_WRAP))
  const cellNow = JSON.parse(await page.eval(JS_CELL(0, 0)))
  // 先抓一个当前可见的格子当源（滚到底后第 0 行已经不可见，用可见区的第一行）
  const visibleFirst = await page.eval(`(() => {
    const tbl = document.querySelector('table.edit-tbl')
    const w = document.querySelector('.edit-grid-wrap')
    const wr = w.getBoundingClientRect()
    const th = w.querySelector('thead')
    const lo = wr.top + w.clientTop + (th ? th.offsetHeight : 0) + 6
    const hi = Math.min(wr.top + w.clientTop + w.clientHeight, innerHeight) - 10
    const rows = [...tbl.querySelectorAll('tbody tr')].filter(tr => {
      const td = tr.querySelector('td.qty-cell'); if (!td) return false
      const r = td.getBoundingClientRect(); return r.top >= lo && r.bottom <= hi
    })
    const td = rows[0] && rows[0].querySelector('td.qty-cell')
    if (!td) return JSON.stringify({ ok: false })
    const r = td.getBoundingClientRect()
    return JSON.stringify({ ok: true, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) })
  })()`)
  const vf = JSON.parse(visibleFirst)
  log('E4 可见源格:', JSON.stringify(vf), '| 当前 scrollTop:', wNow.scrollTop)
  await click1(vf.x, vf.y)
  const h2 = JSON.parse(await page.eval(JS_HANDLE))
  await moveNone(h2.x, h2.y)
  await down(h2.x, h2.y)
  await sleep(150)
  log('E4 填充柄:', JSON.stringify(h2), '| 按下后框:', await page.eval(JS_MARQUEE))
  const wA = JSON.parse(await page.eval(JS_WRAP))
  await move(h2.x, wA.cTop + wA.thead - 30)   // 拖到表头下缘之上（上边界外侧）
  await sleep(800)
  const wB = JSON.parse(await page.eval(JS_WRAP))
  log('E4 反向滚动:', wA.scrollTop, '→', wB.scrollTop)
  res.e4 = wB.scrollTop < wA.scrollTop - 20
  await up(h2.x, wA.cTop + wA.thead + 20)
  await sleep(600)
  await page.screenshot(OUT + '/E4-向上填充.png')

  // E5 松手后 rAF 必须停：再等 400ms 滚动不应继续
  const wC = JSON.parse(await page.eval(JS_WRAP))
  await sleep(450)
  const wD = JSON.parse(await page.eval(JS_WRAP))
  log('E5 松手后 scrollTop:', wC.scrollTop, '→', wD.scrollTop)
  res.e5 = Math.abs(wD.scrollTop - wC.scrollTop) <= 1

  const errs = (page.errors || []).filter(x => !/favicon|ResizeObserver/i.test(String(x)))
  log('页面错误:', JSON.stringify(errs.slice(-4)))
  res.e6 = errs.length === 0
} catch (e) {
  log('探针异常:', e && e.message)
  res.error = String(e && e.message)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
}
log('\n=== 结果 ===')
for (const k of ['e1', 'e2', 'e3', 'e4', 'e5', 'e6']) log(k, res[k] ? 'PASS' : 'FAIL')
process.exit(0)
