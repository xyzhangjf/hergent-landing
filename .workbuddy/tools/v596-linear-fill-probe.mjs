/**
 * v596 真机验证：拖动填充改「线性」—— 只沿主方向铺一行/一列，不再是矩形
 *   L1 纵向拖（带 +30px 横向漂移）⇒ 框只长高、宽度恒等于源格宽；只写该列；提示「第 a→b 行」不含「×N 列」
 *   L2 横向拖（带 +20px 纵向漂移）⇒ 框只长宽、高度恒等于行高；只写该行
 *   L3 45° 斜拖 ⇒ 仍然只有一轴在长（不是矩形）
 *   L4 L 形改向：先下 60px 锁纵向，再右 400px ⇒ 改判横向（框变回单行高）
 *   L5 单价列（非数量列）横向拖 ⇒ 框不横向长、不写入（不弹「已填充」噪音）
 *   L6 纵向拖全程 scrollLeft 不变（线性下另一轴不该自滚）
 *   L7 页面零报错
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v596-linear-fill'
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
  const rows = [...tbl.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td.qty-cell'))
  const tr = rows[${i}]
  if (!tr) return JSON.stringify({ ok: false, reason: 'no row', n: rows.length })
  const tds = tr.querySelectorAll('td.qty-cell')
  const td = tds[${j}]
  if (!td) return JSON.stringify({ ok: false, reason: 'no col', n: tds.length })
  const r = td.getBoundingClientRect()
  return JSON.stringify({ ok: true, n: rows.length, nq: tds.length, dr: td.getAttribute('data-r'), dc: td.getAttribute('data-c'),
    x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) })
})()`

/* 行 i 里**所有非数量的可编辑格**（有填充柄的那些编辑列：文本/数值/只读展示）——
   ⚠️ 独立「单价」td 模板里**没有** `.fill-handle`，从它拖不起来 ⇒ 别拿它做用例（v596 踩过）。
     这里列出候选，由调用方逐个点，以「填充柄真的出现」为准挑一个。 */
const JS_NONQTY = (i) => `(() => {
  const tbl = document.querySelector('table.edit-tbl')
  const rows = [...tbl.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td.qty-cell'))
  const tr = rows[${i}]; if (!tr) return JSON.stringify({ ok: false })
  const out = []
  ;[...tr.querySelectorAll('td[data-c]')].forEach(td => {
    if (td.classList.contains('qty-cell')) return
    const r = td.getBoundingClientRect()
    if (!r.width) return
    const inp = td.querySelector('input, .cell-ro')
    if (!inp) return
    out.push({ c: td.getAttribute('data-c'), cls: (inp.className || 'ro').slice(0, 24),
      x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) })
  })
  return JSON.stringify({ ok: true, list: out })
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
  return JSON.stringify({ ok: true,
    cLeft: +(r.left + w.clientLeft).toFixed(1), cRight: +(r.left + w.clientLeft + w.clientWidth).toFixed(1),
    scrollLeft: Math.round(w.scrollLeft), scrollTop: Math.round(w.scrollTop),
    innerW: innerWidth, innerH: innerHeight })
})()`

const JS_MARQ = `(() => {
  const mq = document.querySelector('.fill-marquee')
  if (!mq) return JSON.stringify({ ok: false })
  const r = mq.getBoundingClientRect()
  return JSON.stringify({ ok: true, left: +r.left.toFixed(1), top: +r.top.toFixed(1),
    w: +r.width.toFixed(1), h: +r.height.toFixed(1) })
})()`

const JS_TOAST = `(() => {
  const t = [...document.querySelectorAll('*')].filter(x => /已填充|已取消/.test(x.textContent || '') && x.children.length === 0)
  return JSON.stringify(t.map(x => (x.textContent || '').trim()).slice(-2))
})()`

/* 选区统计：总格数 / 行集合 / 列集合（列集合大小 = 1 说明真的只铺了一列） */
const JS_SEL = `(() => {
  const v = [...document.querySelectorAll('td.range-sel')]
  const rows = [...new Set(v.map(td => td.getAttribute('data-r')))]
  const cols = [...new Set(v.map(td => td.getAttribute('data-c')))]
  return JSON.stringify({ total: v.length, rows, cols })
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
  const key = (k, code, vk) => (async () => {
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk })
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk })
  })()
  /* 填一个可辨识的值并提交（Tab 提交、焦点右移） */
  const setVal = async (cell, val) => {
    await click1(cell.x, cell.y)
    await page.raw.send('Input.insertText', { text: val })
    await sleep(200)
    await key('Tab', 'Tab', 9)
    await sleep(300)
  }

  await page.goto(BASE, 3500)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 7000)
  await sleep(4000)
  log('构建号:', await page.eval(`(() => document.documentElement.dataset.build || '?')()`))
  log('改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(900)
  const cf = JSON.parse(await page.eval(JS_CONFIRM))
  if (cf.ok) await sleep(1600)

  const w0 = JSON.parse(await page.eval(JS_WRAP))
  log('容器:', JSON.stringify(w0))

  /* ── L1 纵向拖（带 +30px 横向漂移）：只长高 ───────────────────────── */
  const c1 = JSON.parse(await page.eval(JS_CELL(0, 0)))
  log('L1 源格:', JSON.stringify(c1))
  await setVal(c1, '66')
  await click1(c1.x, c1.y)
  const h1 = JSON.parse(await page.eval(JS_HANDLE))
  await moveNone(h1.x, h1.y)
  await down(h1.x, h1.y)
  await sleep(150)
  const sBefore = JSON.parse(await page.eval(JS_WRAP))
  await move(h1.x + 30, h1.y + c1.h * 3)
  await sleep(350)
  const m1 = JSON.parse(await page.eval(JS_MARQ))
  const sMid = JSON.parse(await page.eval(JS_WRAP))
  log('L1 拖动中框:', JSON.stringify(m1), '| 源格 w/h:', c1.w, c1.h)
  res.l1box = Math.abs(m1.w - c1.w) <= 2 && m1.h >= c1.h * 3.5
  await page.screenshot(OUT + '/L1-纵向拖动中.png')
  await up(h1.x + 30, h1.y + c1.h * 3)
  await sleep(700)
  const t1 = JSON.parse(await page.eval(JS_TOAST))
  const sl1 = JSON.parse(await page.eval(JS_SEL))
  log('L1 toast:', JSON.stringify(t1), '| 选区:', JSON.stringify(sl1))
  res.l1write = sl1.total === 4 && sl1.cols.length === 1 && sl1.rows.length === 4
  res.l1toast = /已填充\s*4\s*格（第\s*1→4\s*行）/.test(t1[t1.length - 1] || '')
  res.l1noscroll = sMid.scrollLeft === sBefore.scrollLeft
  await page.screenshot(OUT + '/L1-纵向填充后.png')

  /* ── L2 横向拖（带 +20px 纵向漂移）：只长宽 ───────────────────────── */
  const c2 = JSON.parse(await page.eval(JS_CELL(1, 0)))
  log('L2 源格:', JSON.stringify(c2))
  await setVal(c2, '55')
  await click1(c2.x, c2.y)
  const h2 = JSON.parse(await page.eval(JS_HANDLE))
  await moveNone(h2.x, h2.y)
  await down(h2.x, h2.y)
  await sleep(150)
  await move(h2.x + c2.w * 3, h2.y + 20)
  await sleep(350)
  const m2 = JSON.parse(await page.eval(JS_MARQ))
  log('L2 拖动中框:', JSON.stringify(m2))
  res.l2box = Math.abs(m2.h - c2.h) <= 2 && m2.w >= c2.w * 3.5
  await page.screenshot(OUT + '/L2-横向拖动中.png')
  await up(h2.x + c2.w * 3, h2.y + 20)
  await sleep(700)
  const t2 = JSON.parse(await page.eval(JS_TOAST))
  const sl2 = JSON.parse(await page.eval(JS_SEL))
  log('L2 toast:', JSON.stringify(t2), '| 选区:', JSON.stringify(sl2))
  res.l2write = sl2.total === 4 && sl2.rows.length === 1 && sl2.cols.length === 4
  res.l2toast = /已填充\s*4\s*格（第\s*2\s*行\s*×\s*4\s*列）/.test(t2[t2.length - 1] || '')
  await page.screenshot(OUT + '/L2-横向填充后.png')

  /* ── L3 45° 斜拖：只有一轴在长（不是矩形） ─────────────────────────── */
  const c3 = JSON.parse(await page.eval(JS_CELL(3, 1)))
  log('L3 源格:', JSON.stringify(c3))
  await setVal(c3, '44')
  await click1(c3.x, c3.y)
  const h3 = JSON.parse(await page.eval(JS_HANDLE))
  await moveNone(h3.x, h3.y)
  await down(h3.x, h3.y)
  await sleep(150)
  await move(h3.x + c3.w * 0.9, h3.y + c3.h * 3)      // 斜：横向 0.9 列、纵向 3 行
  await sleep(350)
  const m3 = JSON.parse(await page.eval(JS_MARQ))
  log('L3 斜拖框:', JSON.stringify(m3))
  const grewW = m3.w > c3.w + 6, grewH = m3.h > c3.h + 6
  res.l3 = grewH && !grewW                          // 纵向 3 行明确大于横向 0.9 列 ⇒ 应只纵向
  await page.screenshot(OUT + '/L3-斜拖.png')
  await up(h3.x + c3.w * 0.9, h3.y + c3.h * 3)
  await sleep(600)
  const sl3 = JSON.parse(await page.eval(JS_SEL))
  res.l3write = sl3.cols.length === 1
  log('L3 选区:', JSON.stringify(sl3))

  /* ── L4 L 形改向：先下 60px 锁纵向，再右 400px ⇒ 改判横向 ─────────── */
  const c4 = JSON.parse(await page.eval(JS_CELL(6, 0)))
  log('L4 源格:', JSON.stringify(c4))
  await setVal(c4, '33')
  await click1(c4.x, c4.y)
  const h4 = JSON.parse(await page.eval(JS_HANDLE))
  await moveNone(h4.x, h4.y)
  await down(h4.x, h4.y)
  await sleep(120)
  await move(h4.x + 3, h4.y + 60)                     // 明确向下 ⇒ 锁 'v'
  await sleep(200)
  const m4a = JSON.parse(await page.eval(JS_MARQ))
  await move(h4.x + 400, h4.y + 62)                   // 横向 400 > 纵向 62*2 ⇒ 应改判 'h'
  await sleep(300)
  const m4b = JSON.parse(await page.eval(JS_MARQ))
  log('L4 先下:', JSON.stringify(m4a), '⇒ 再右:', JSON.stringify(m4b))
  res.l4 = Math.abs(m4b.h - c4.h) <= 2 && m4b.w > c4.w * 3
  await page.screenshot(OUT + '/L4-L形改向.png')
  await up(h4.x + 400, h4.y + 62)
  await sleep(600)

  /* ── L5 非数量列横向拖：不横向长、不写入 ───────────────────────────
     挑一个**真的能拖**的编辑列（填充柄出现为准）；单价 td 没有 handle，不能当用例。 */
  const cand = JSON.parse(await page.eval(JS_NONQTY(1)))
  log('L5 非数量候选列:', JSON.stringify(cand))
  let picked = null, handle = null
  for (const it of ((cand && cand.list) || []).slice(0, 6)) {
    await click1(it.x, it.y)
    const hh = JSON.parse(await page.eval(JS_HANDLE))
    if (hh.ok) { picked = it; handle = hh; break }
  }
  log('L5 选中:', JSON.stringify(picked), '| 柄:', JSON.stringify(handle))
  if (picked && handle) {
    await moveNone(handle.x, handle.y)
    await down(handle.x, handle.y)
    await sleep(150)
    await move(handle.x + picked.w * 2.5, handle.y + 1)   // 只横向、纵向几乎不动
    await sleep(350)
    const mp = JSON.parse(await page.eval(JS_MARQ))
    log('L5 拖动中框:', JSON.stringify(mp), '| 候选格 w/h:', picked.w, picked.h)
    res.l5box = Math.abs(mp.w - picked.w) <= 2
    await up(handle.x + picked.w * 2.5, handle.y + 1)
    await sleep(600)
    const tp = JSON.parse(await page.eval(JS_TOAST))
    log('L5 toast:', JSON.stringify(tp))
    res.l5noop = !(tp[tp.length - 1] || '').includes('已填充')
    await page.screenshot(OUT + '/L5-非数量列横向禁止.png')
  } else res.l5box = res.l5noop = false

  const errs = (page.errors || []).filter(x => !/favicon|ResizeObserver/i.test(String(x)))
  log('页面错误:', JSON.stringify(errs.slice(-4)))
  res.l7 = errs.length === 0
} catch (e) {
  log('探针异常:', e && e.message)
  res.error = String(e && e.message)
} finally {
  if (browser) { try { await browser.close() } catch { /* ignore */ } }
}
log('\n=== 结果 ===')
const keys = ['l1box', 'l1write', 'l1toast', 'l1noscroll', 'l2box', 'l2write', 'l2toast', 'l3', 'l3write', 'l4', 'l5box', 'l5noop', 'l7']
for (const k of keys) log(k, res[k] ? 'PASS' : 'FAIL')
const allOk = keys.every((k) => res[k])
log(allOk ? 'ALL PASS' : 'HAS FAIL')
process.exit(0)
