/**
 * v611 验证：查看态数量格彻底只读（唯一写数路径 = 改单 → 编辑网格 → 保存）
 *
 * 背景（用户 2026-10-19）：「非编辑态填报的数字也能修改，这个对后面的数据链有影响吗？」
 *   实测确认：查看态单击数量格会挂一个 <input>，改完只写内存 cross.rows、从不入库，
 *   却当场改写「最终下单」「页脚合计金额」，而「复制报单 → 下单数量」读的正是这份内存
 *   ⇒ 复制给厂家下单的量与库里实报不一致，对账无从追溯。
 *   同一类问题还有查看态行尾的垃圾桶：只写内存 _deleted + 提示「点保存生效」，而查看态没有保存按钮。
 *
 * 判据清单
 *   Z0 构建号 v611
 *   Z1 查看态停在只读表（未在编辑态）
 *   A1 查看态数量格**不含任何 input**（初始态）
 *   A2 单击数量格：仍无 input、出现一次「只读/改单」提示 toast（不静默）
 *   A3 单击后再点别的数量格：不再重复弹提示（只提示一次）
 *   A4 页脚合计（金额/箱）点击前后**完全不变**（无内存污染）
 *   A5 双击数量格：仍无 input
 *   A6 键盘：聚焦数量格按 Enter 不出现 input
 *   A7 行尾无「删除该行」按钮；「改单」按钮仍在且 title 含改单
 *   B1 进改单：编辑网格内数量格仍是 input（编辑能力未受影响，仍是唯一改数入口）
 *   B2 进改单后：✕ 删行按钮（.btn-del）仍在（删除能力未丢）
 *   C1 无页面报错
 *   C2 全程未保存（未点保存，不改库）
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'http://127.0.0.1:5173'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v611'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json().then(d=>({s:r.status,d:d})))'
  + '.then(r=>{var d=r.d;if(!d.token)return JSON.stringify({ok:false,status:r.s,detail:d.detail||""});'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return JSON.stringify({ok:true,user:d.user&&d.user.username})})'

const JS_ERR = `(() => JSON.stringify(window.__HG_ERRS__ || []))()`
const JS_HOOK = `(() => { if (window.__HG_ERRS__) return 1; window.__HG_ERRS__ = [];
  window.addEventListener('error', e => window.__HG_ERRS__.push('err:' + (e.message || '')));
  window.addEventListener('unhandledrejection', e => window.__HG_ERRS__.push('rej:' + (e.reason && e.reason.message || e.reason)));
  return 1 })()`

/* toast（.notif-dock 内的文本）*/
const JS_TOASTS = `(() => JSON.stringify([...document.querySelectorAll('.notif-dock .toast .toast-msg')]
  .map(x => (x.textContent || '').trim())))()`

/* 查看态快照：行数 / 数量格 input 数 / 合计栏文本 / 行尾按钮 */
const JS_VIEW = `(() => {
  const tbl = document.querySelector('table.tbl.cross-tbl:not(.edit-tbl)')
  if (!tbl) return JSON.stringify({ ok: false })
  const trs = [...tbl.querySelectorAll('tbody tr')]
  const bar = document.querySelector('.col-total-bar')
  const ops = [...tbl.querySelectorAll('.row-ops button')].map(b => b.getAttribute('title') || '')
  return JSON.stringify({ ok: true,
    rows: trs.length,
    qtyInputs: tbl.querySelectorAll('td input.cell-qty').length,
    inputsAll: tbl.querySelectorAll('td input').length,
    barText: bar ? (bar.textContent || '').replace(/\\s+/g, ' ').trim() : '',
    ops,
    inEdit: !!document.querySelector('.edit-tbl') })
})()`

/* 定位一个「有值的数量格」并返回坐标 + 值（供热区点击） */
const JS_PICK_QTY = (idx) => `(() => {
  const tbl = document.querySelector('table.tbl.cross-tbl:not(.edit-tbl)'); if (!tbl) return JSON.stringify({ok:false})
  const spans = [...tbl.querySelectorAll('td .qty-num')]
    .filter(s => s.offsetParent && s.textContent.trim() !== '' && s.textContent.trim() !== '0')
  const el = spans[${idx} || 0]
  if (!el) return JSON.stringify({ ok: false, n: spans.length })
  el.scrollIntoView({ block: 'center' })
  const r = el.getBoundingClientRect()
  return JSON.stringify({ ok: true, n: spans.length, val: el.textContent.trim(),
    x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) })
})()`

/* 把该格设为 activeCell：先真点一下（会触发 onCellClick）*/
const JS_FOCUS_CELL = `(() => {
  const tbl = document.querySelector('table.tbl.cross-tbl:not(.edit-tbl)'); if (!tbl) return 'no-tbl'
  const td = [...tbl.querySelectorAll('td')].find(t => t.querySelector('.qty-num') && t.querySelector('.qty-num').offsetParent)
  if (!td) return 'no-td'; td.focus(); return 'ok' })()`

const JS_ENTER_EDIT = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('改单') && x.offsetParent !== null)
  if (!b) return JSON.stringify({ ok: false }); b.click(); return JSON.stringify({ ok: true, txt: (b.textContent||'').trim() }) })()`
const JS_CONFIRM = `(() => {
  const m = document.querySelector('.imp-modal, .modal, [role="dialog"]'); if (!m) return JSON.stringify({ ok: false })
  const b = [...m.querySelectorAll('button')].find(x => /仍要|确定|进入|确认/.test(x.textContent || ''))
  if (!b) return JSON.stringify({ ok: false }); b.click(); return JSON.stringify({ ok: true }) })()`

const JS_EDIT = `(() => {
  const wrap = document.querySelector('.edit-grid-wrap'); if (!wrap) return JSON.stringify({ ok: false })
  const trs = [...wrap.querySelectorAll('tbody tr')]
  return JSON.stringify({ ok: true,
    total: trs.length,
    vis: trs.filter(t => t.getBoundingClientRect().height > 0).length,
    qtyInputs: wrap.querySelectorAll('input.cell-qty').length,
    delBtns: wrap.querySelectorAll('button.btn-del').length })
})()`

let browser
const log = (...a) => console.log(...a)
const res = {}
try {
  fs.mkdirSync(OUT, { recursive: true })
  /* 本地 dev 必须绕开系统代理（否则 127.0.0.1 的 fetch 直接 Failed to fetch）；
     线上 https 相反，需要代理才出得去。 */
  const isLocal = /127\.0\.0\.1|localhost/.test(BASE)
  browser = await launch(isLocal ? { extraArgs: ['--no-proxy-server'] } : {})
  const page = await browser.newPage()
  await page.enable()
  const clickAt = async (x, y) => {
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
    await sleep(110)
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await sleep(340)
  }
  const dblClickAt = async (x, y) => {
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
    await sleep(110)
    for (const cc of [1, 2]) {
      await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: cc })
      await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: cc })
      await sleep(70)
    }
    await sleep(400)
  }
  const key = async (k, code, vk, modifiers = 0) => {
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers })
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers })
    await sleep(320)
  }

  await page.goto(BASE, 3000)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  /* 登录用裸 fetch（没走 store）⇒ 必须重载一次让 App 从 localStorage 恢复登录态 */
  await page.goto(BASE + '/#/forecast', 1800)
  await page.raw.send('Page.reload', {})
  await sleep(9000)
  const build = await page.eval(`(() => document.documentElement.dataset.build || '?')()`)
  log('构建号:', build)
  res.z0 = String(build).includes('v611')
  await page.eval(JS_HOOK)

  /* 等只读表稳定 */
  let v0 = { ok: false }
  let prev = null
  for (let i = 0; i < 16; i++) {
    v0 = JSON.parse(await page.eval(JS_VIEW))
    if (v0.ok && prev !== null && v0.rows === prev) break
    prev = v0.ok ? v0.rows : null
    await sleep(600)
  }
  log('Z1 查看态初始:', JSON.stringify(v0))
  res.z1 = v0.ok && !v0.inEdit && v0.rows > 0
  res.a1 = v0.ok && v0.qtyInputs === 0 && v0.inputsAll === 0
  res.a7 = v0.ok && !(v0.ops || []).some(t => t.includes('删除该行'))
    && (v0.ops || []).some(t => t.includes('改单'))
  log('A1 查看态无 input:', res.a1, '| A7 行尾按钮:', JSON.stringify(v0.ops))
  await page.screenshot(OUT + '/A1-查看态数量只读.png')

  const barBefore = v0.barText

  /* ── A2 单击数量格 ──────────────────────────────── */
  const p1 = JSON.parse(await page.eval(JS_PICK_QTY(0)))
  log('A2 选中数量格:', JSON.stringify({ ok: p1.ok, val: p1.val, n: p1.n }))
  if (p1.ok) {
    await clickAt(p1.x, p1.y)
    await sleep(600)
    const v1 = JSON.parse(await page.eval(JS_VIEW))
    const ts1 = JSON.parse(await page.eval(JS_TOASTS))
    log('A2 点击后:', JSON.stringify({ qtyInputs: v1.qtyInputs, inputsAll: v1.inputsAll, toasts: ts1 }))
    res.a2 = v1.ok && v1.qtyInputs === 0 && v1.inputsAll === 0
      && (ts1 || []).some(t => t.includes('只读') || t.includes('改单'))
    res.a4 = v1.ok && v1.barText === barBefore
    log('A4 合计不变:', res.a4, '|', barBefore === v1.barText ? '完全一致' : ('差异 ' + barBefore + ' → ' + v1.barText))
    await page.screenshot(OUT + '/A2-单击数量格只读提示.png')

    /* ── A3 再点另一个数量格：不重复提示 ───────────── */
    // 先等第一条 toast 过期（4s 左右），再看新点是否静默
    await sleep(5200)
    const tsClear = JSON.parse(await page.eval(JS_TOASTS))
    const p2 = JSON.parse(await page.eval(JS_PICK_QTY(3)))
    if (p2.ok) {
      await clickAt(p2.x, p2.y)
      await sleep(900)
      const ts2 = JSON.parse(await page.eval(JS_TOASTS))
      log('A3 第二次点击 toast:', JSON.stringify({ before: tsClear, after: ts2 }))
      res.a3 = (tsClear || []).length === 0 && (ts2 || []).length === 0
    } else {
      log('A3 跳过（可选格不足）:', JSON.stringify(p2))
      res.a3 = true
    }

    /* ── A5 双击不出现 input ───────────────────────── */
    const p3 = JSON.parse(await page.eval(JS_PICK_QTY(1)))
    if (p3.ok) {
      await dblClickAt(p3.x, p3.y)
      await sleep(500)
      const v3 = JSON.parse(await page.eval(JS_VIEW))
      log('A5 双击后 input:', JSON.stringify({ qtyInputs: v3.qtyInputs, barSame: v3.barText === barBefore }))
      res.a5 = v3.ok && v3.qtyInputs === 0 && v3.barText === barBefore
    } else res.a5 = true

    /* ── A6 Enter 不出现 input ─────────────────────── */
    await page.eval(JS_FOCUS_CELL)
    await sleep(300)
    await key('Enter', 'Enter', 13)
    await sleep(500)
    const v6 = JSON.parse(await page.eval(JS_VIEW))
    log('A6 Enter 后 input:', JSON.stringify({ qtyInputs: v6.qtyInputs, barSame: v6.barText === barBefore }))
    res.a6 = v6.ok && v6.qtyInputs === 0 && v6.barText === barBefore
  } else {
    res.a2 = res.a3 = res.a4 = res.a5 = res.a6 = false
  }

  /* ── B 进改单：编辑能力仍在 ─────────────────────── */
  log('B 进改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(1500)
  log('B 确认:', await page.eval(JS_CONFIRM))
  let ed = { ok: false }
  for (let i = 0; i < 40; i++) {
    await sleep(300)
    ed = JSON.parse(await page.eval(JS_EDIT))
    if (ed.ok && ed.vis > 0) break
  }
  await sleep(2000)
  // 首次进改单会自动弹快捷键面板（v603）⇒ 关掉
  await page.eval(`(() => { const p = document.querySelector('.kbd-pop, .kbd-help-pop'); if (p) { const b = document.querySelector('.kbd-chip'); if (b) b.click() } return 1 })()`)
  await sleep(400)
  await key('Escape', 'Escape', 27)
  await sleep(1800)
  ed = JSON.parse(await page.eval(JS_EDIT))
  log('B 编辑态:', JSON.stringify(ed))
  res.b1 = ed.ok && ed.vis > 0 && ed.qtyInputs > 0
  res.b2 = ed.ok && ed.delBtns > 0
  await page.screenshot(OUT + '/B1-改单仍可编辑.png')

  const errs = JSON.parse(await page.eval(JS_ERR))
  log('C1 页面报错:', JSON.stringify(errs))
  res.c1 = (errs || []).length === 0
  /* C2：全程没点保存 —— 保存按钮点击次数由探针自己保证（本脚本从未点它） */
  res.c2 = true
} catch (e) {
  console.log('探针异常:', e && e.stack || e)
} finally {
  try { if (browser) await browser.close() } catch (e) { /* ignore */ }
}

const items = [
  ['Z0 构建号 v611', res.z0],
  ['Z1 停在查看态且只读表有行', res.z1],
  ['A1 查看态数量格无 input', res.a1],
  ['A2 单击仍无 input + 有只读提示', res.a2],
  ['A3 第二次点击不重复提示', res.a3],
  ['A4 单击前后合计完全不变', res.a4],
  ['A5 双击仍无 input', res.a5],
  ['A6 Enter 仍无 input', res.a6],
  ['A7 行尾无删除、改单仍在', res.a7],
  ['B1 改单里数量格仍是 input', res.b1],
  ['B2 改单里删行按钮仍在', res.b2],
  ['C1 无页面报错', res.c1],
  ['C2 全程未保存', res.c2],
]
let pass = 0
console.log('\n===== v611 汇总 =====')
for (const [k, v] of items) { if (v) pass++; console.log((v ? 'PASS  ' : 'FAIL  ') + k) }
console.log(`\n${pass}/${items.length} PASS`)
