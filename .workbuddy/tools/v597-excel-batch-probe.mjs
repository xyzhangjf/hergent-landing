/**
 * v597 真机验证：第一批「更像 Excel」五项
 *   P0 构建号 = v597
 *   P1 复制后出现蚂蚁线（几何与源格逐像素一致）
 *   P2 Esc 取消复制：蚂蚁线消失、toast 提示、**选区不被清掉**
 *   P3 数量列右对齐（td + input 的 computed text-align，且数字用 tabular-nums）
 *   P4 数字清洗：键入 `66箱` / `¥1,200` 提交后 → 66 / 1200；`1.5` 不许被洗成 15
 *   P5 Ctrl+R 向右填充：选区整行被源列值填满，且**页面没有被浏览器刷新**
 *   P6 双击填充柄：向下填到「已报数量的末行」，提示带行号区间
 *   P7 页面零报错
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v597-excel-batch'
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

/* 表格里第 i 个「数据行」的第 j 个数量格（只数带 qty-cell 的行） */
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
  return JSON.stringify({ ok: true, n: rows.length, nq: tds.length,
    dr: td.getAttribute('data-r'), dc: td.getAttribute('data-c'),
    x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1),
    w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    left: +r.left.toFixed(1), top: +r.top.toFixed(1) })
})()`

const JS_HANDLE = `(() => {
  const h = document.querySelector('td.selected .fill-handle')
  if (!h) return JSON.stringify({ ok: false })
  const r = h.getBoundingClientRect()
  return JSON.stringify({ ok: true, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) })
})()`

const JS_ANT = `(() => {
  const m = document.querySelector('.copy-marquee')
  if (!m) return JSON.stringify({ ok: false })
  const r = m.getBoundingClientRect()
  const cs = getComputedStyle(m)
  return JSON.stringify({ ok: true, left: +r.left.toFixed(1), top: +r.top.toFixed(1),
    w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    anim: cs.animationName, pe: cs.pointerEvents })
})()`

const JS_ALIGN = `(() => {
  const td = document.querySelector('td.qty-cell')
  if (!td) return JSON.stringify({ ok: false })
  const inp = td.querySelector('input.cell-qty')
  const a = getComputedStyle(td).textAlign
  const b = inp ? getComputedStyle(inp).textAlign : ''
  const fv = inp ? getComputedStyle(inp).fontVariantNumeric : ''
  const ptd = document.querySelector('td.num.calc.price')
  const pin = ptd ? ptd.querySelector('input.cell-price') : null
  return JSON.stringify({ ok: true, td: a, input: b, fv,
    priceInput: pin ? getComputedStyle(pin).textAlign : '',
    nameAlign: (() => { const n = document.querySelector('td .pname'); return n ? getComputedStyle(n.parentElement).textAlign : '' })() })
})()`

/* 读某个 (r,c) 格当前 input 值 */
const JS_VAL = (r, c) => `(() => {
  const td = document.querySelector('td[data-r="${r}"][data-c="${c}"]')
  if (!td) return JSON.stringify({ ok: false })
  const inp = td.querySelector('input')
  return JSON.stringify({ ok: true, v: inp ? inp.value : (td.textContent || '').trim() })
})()`

/* 读第 i 个数据行、第 j 个数量格的 input 值 */
const JS_RC = (i, j) => `(() => {
  const tbl = document.querySelector('table.edit-tbl')
  const rows = [...tbl.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td.qty-cell'))
  const tr = rows[${i}]; if (!tr) return JSON.stringify({ ok: false })
  const td = tr.querySelectorAll('td.qty-cell')[${j}]; if (!td) return JSON.stringify({ ok: false })
  return JSON.stringify({ ok: true, v: (td.querySelector('input') || {}).value })
})()`

/* 第 i 个数据行**所有数量格**的当前值（行内横向铺开的断言用） */
const JS_ROW = (i) => `(() => {
  const tbl = document.querySelector('table.edit-tbl')
  const rows = [...tbl.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td.qty-cell'))
  const tr = rows[${i}]; if (!tr) return JSON.stringify({ ok: false })
  const vals = [...tr.querySelectorAll('td.qty-cell')].map(td => Number((td.querySelector('input') || {}).value) || 0)
  return JSON.stringify({ ok: true, n: vals.length, vals })
})()`

/* 最后一个「任一数量格 > 0」的数据行下标 + 该列在每一行的值（用于双击填充断言） */
const JS_COL_STATE = (j) => `(() => {
  const tbl = document.querySelector('table.edit-tbl')
  const rows = [...tbl.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td.qty-cell'))
  const col = []
  let lastQty = -1
  rows.forEach((tr, i) => {
    const tds = tr.querySelectorAll('td.qty-cell')
    const vals = [...tds].map(td => Number((td.querySelector('input') || {}).value) || 0)
    col.push(vals[${j}] == null ? 0 : vals[${j}])
    if (vals.some(v => v > 0)) lastQty = i
  })
  return JSON.stringify({ ok: true, n: rows.length, lastQty, col })
})()`

const JS_TOASTS = `(() => {
  const t = [...document.querySelectorAll('*')].filter(x => x.children.length === 0
    && /已填充|已取消|已向右|取消复制|只在报单|还没有已填/.test(x.textContent || ''))
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
  const moveNone = (x, y) => page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  const move = (x, y) => page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' })
  const down = (x, y, clickCount = 1) => page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount })
  const up = (x, y, clickCount = 1) => page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount })
  const click1 = async (x, y) => { await moveNone(x, y); await down(x, y); await up(x, y); await sleep(400) }
  const dblclick = async (x, y) => {
    await click1(x, y)
    await sleep(60)
    await down(x, y, 2); await up(x, y, 2)
    await sleep(700)
  }
  const key = (k, code, vk, modifiers = 0) => (async () => {
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers })
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers })
  })()
  const setVal = async (cell, val) => {
    await click1(cell.x, cell.y)
    await page.raw.send('Input.insertText', { text: val })
    await sleep(200)
    await key('Tab', 'Tab', 9)
    await sleep(350)
  }

  await page.goto(BASE, 3500)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  try {
    await page.raw.send('Browser.grantPermissions', {
      origin: BASE, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
    })
    log('剪贴板权限: granted')
  } catch (e) { log('剪贴板权限: 授权失败（将走 execCommand 兜底）', e.message) }

  await page.goto(BASE + '/#/forecast', 7000)
  await sleep(4000)
  const build = await page.eval(`(() => document.documentElement.dataset.build || '?')()`)
  log('构建号:', build)
  res.p0 = String(build).includes('v597')

  log('改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(900)
  const cf = JSON.parse(await page.eval(JS_CONFIRM))
  if (cf.ok) await sleep(1600)

  /* ── P3 右对齐（先量，纯样式） ───────────────────────────────── */
  const al = JSON.parse(await page.eval(JS_ALIGN))
  log('P3 对齐:', JSON.stringify(al))
  res.p3 = al.ok && al.td === 'right' && al.input === 'right' && al.fv === 'tabular-nums'

  /* ── P4 数字清洗：键入后提交 ─────────────────────────────────── */
  const c0 = JSON.parse(await page.eval(JS_CELL(0, 0)))
  await setVal(c0, '66箱')
  const v1 = JSON.parse(await page.eval(JS_VAL(c0.dr, c0.dc)))
  const c1 = JSON.parse(await page.eval(JS_CELL(1, 0)))
  await setVal(c1, '¥1,200')
  const v2 = JSON.parse(await page.eval(JS_VAL(c1.dr, c1.dc)))
  const c2 = JSON.parse(await page.eval(JS_CELL(2, 0)))
  await setVal(c2, '1.5')
  const v3 = JSON.parse(await page.eval(JS_VAL(c2.dr, c2.dc)))
  log('P4 清洗: 66箱 →', v1.v, '| ¥1,200 →', v2.v, '| 1.5 →', v3.v)
  res.p4 = v1.v === '66' && v2.v === '1200' && v3.v === '1.5'

  /* ── P1 蚂蚁线 ─────────────────────────────────────────────── */
  await click1(c0.x, c0.y)
  await key('c', 'KeyC', 67, 4)          // Meta+C（macOS）
  await sleep(600)
  const ant = JSON.parse(await page.eval(JS_ANT))
  log('P1 蚂蚁线:', JSON.stringify(ant), '| 源格:', c0.left, c0.top, c0.w, c0.h)
  res.p1 = ant.ok && Math.abs(ant.left - c0.left) <= 2 && Math.abs(ant.top - c0.top) <= 2
    && Math.abs(ant.w - c0.w) <= 2 && Math.abs(ant.h - c0.h) <= 2
    && String(ant.anim).startsWith('copyAnts') && ant.pe === 'none'
  await page.screenshot(OUT + '/P1-蚂蚁线.png')

  /* ── P2 Esc 取消复制 + 选区保留 ─────────────────────────────── */
  await key('Escape', 'Escape', 27)
  await sleep(400)
  const ant2 = JSON.parse(await page.eval(JS_ANT))
  const t2 = JSON.parse(await page.eval(JS_TOASTS))
  const selKept = await page.eval(`(() => !!document.querySelector('td.selected'))()`)
  log('P2 Esc 后:', JSON.stringify(ant2), '| toast:', JSON.stringify(t2), '| 选区还在:', selKept)
  res.p2 = !ant2.ok && t2.some(s => s.includes('已取消复制')) && selKept === true

  /* ── P5 Ctrl+R 向右填充（且页面不得刷新） ────────────────────── */
  const r5 = JSON.parse(await page.eval(JS_CELL(4, 0)))
  await setVal(r5, '77')
  await page.eval(`(() => { window.__probe_mark = 1; return 1 })()`)
  await click1(r5.x, r5.y)
  const r5b = JSON.parse(await page.eval(JS_CELL(4, 3)))
  await moveNone(r5.x, r5.y); await down(r5.x, r5.y)
  await move(r5b.x, r5b.y)
  await sleep(200)
  await up(r5b.x, r5b.y)
  await sleep(400)
  const selN = await page.eval(`(() => document.querySelectorAll('td.range-sel').length)()`)
  await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82, modifiers: 4 })
  await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82, modifiers: 4 })
  await sleep(700)
  const notReloaded = await page.eval(`(() => window.__probe_mark === 1)()`)
  const row5 = JSON.parse(await page.eval(JS_ROW(4)))
  const t5 = JSON.parse(await page.eval(JS_TOASTS))
  log('P5 选区格数:', selN, '| 未刷新:', notReloaded, '| 第 5 行前 6 格:', JSON.stringify(row5.vals.slice(0, 6)), '| toast:', JSON.stringify(t5))
  res.p5 = notReloaded === true && row5.vals[0] === 77 && row5.vals[1] === 77 && row5.vals[2] === 77 && row5.vals[3] === 77
  res.p5toast = t5.some(s => s.includes('已向右填充'))
  await page.screenshot(OUT + '/P5-向右填充.png')

  /* ── P6 双击填充柄（向下填到已报数量末行） ──────────────────── */
  /* 找一个「本格为空、但下面还有已报数量」的行，双击它的填充柄 */
  const colState = JSON.parse(await page.eval(JS_COL_STATE(1)))
  let targetRow = -1
  for (let i = 0; i < colState.n; i++) {
    if ((colState.col[i] || 0) === 0 && i < colState.lastQty) { targetRow = i; break }
  }
  log('P6 末个已报行:', colState.lastQty, '| 目标空行:', targetRow)
  let p6 = false
  if (targetRow >= 0) {
    const tc = JSON.parse(await page.eval(JS_CELL(targetRow, 1)))
    /* 先给源格一个可辨识的值：空值填充"成功"但等于什么都没变，测不出东西（第一轮就踩在这）。 */
    await setVal(tc, '88')
    await click1(tc.x, tc.y)
    const hb = JSON.parse(await page.eval(JS_HANDLE))
    await dblclick(hb.x, hb.y)
    const after = JSON.parse(await page.eval(JS_COL_STATE(1)))
    const t6 = JSON.parse(await page.eval(JS_TOASTS))
    log('P6 双击后前几格:', JSON.stringify(after.col.slice(0, 8)), '| toast:', JSON.stringify(t6))
    const filled = after.col.slice(targetRow, colState.lastQty + 1)
    p6 = filled.length > 1 && filled.every(v => v === 88)
    res.p6 = p6 && t6.some(s => /已填充\s*\d+\s*格（第/.test(s))
    await page.screenshot(OUT + '/P6-双击填充.png')
  } else {
    log('P6 找不到合适的空行（下面没有已报数量）')
    res.p6 = false
  }

  res.p7 = (page.errors || []).length === 0
  log('P7 页面报错:', JSON.stringify(page.errors || []))

  for (const k of ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p5toast', 'p6', 'p7']) log(k.toUpperCase(), res[k] ? 'PASS' : 'FAIL')
  const all = Object.values(res).every(Boolean)
  log(all ? '\n=== 全部 PASS ===' : '\n=== 存在 FAIL ===')
  process.exit(all ? 0 : 1)
} catch (e) {
  console.error('探针异常:', e && e.stack || e)
  process.exit(2)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
}
