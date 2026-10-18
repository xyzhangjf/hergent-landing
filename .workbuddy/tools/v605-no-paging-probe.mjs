/**
 * v605 验证：分页机制整块撤除 —— 进改单直接显示全部行
 *
 * 用户原话：「不要搞那么复杂，不要上一页下一页，用户点击改单后直接显示全部」
 *
 * 判据清单
 *   Z0 构建号 v605
 *   A1 全量显示：可见行数 = aria-rowcount，且 rMin=0 / rMax=n-1（第一行到最后一行都在）
 *   A2 分页控件彻底消失：无「上一页/下一页」按钮、无 .es-pager/.pg-btn/.pg-info
 *   A3 页脚行未被改坏：.edit-summary 在、行高 ≤ 28、快捷键胶囊还在、右侧容器只装 2 件以内
 *   A4 表体仍是滚动盒：scrollHeight > clientHeight，滚到底后最后一行真的能看见
 *   B1 筛选仍生效（v-show 已改用 rowBaseShown）：勾「仅显示有报单」行数变少，取消后恢复
 *   B2 单元格编辑未受牵连：点一格输入 7 → 值变；Ctrl+Z → 回原值
 *   B3 全屏后仍全量（不是全屏又变回一页）+ 页脚可见
 *   Z8 进改单到全量可见的耗时（记录用，不做硬判据）
 *   Z9 零页面报错
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v605'
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
  window.__T_EDIT__ = performance.now()
  b.click(); return JSON.stringify({ ok: true })
})()`
const JS_CONFIRM = `(() => {
  const m = document.querySelector('.imp-modal, .modal, [role="dialog"]')
  if (!m) return JSON.stringify({ ok: false })
  const b = [...m.querySelectorAll('button')].find(x => /仍要|确定|进入|确认/.test(x.textContent || ''))
  if (!b) return JSON.stringify({ ok: false })
  b.click(); return JSON.stringify({ ok: true })
})()`

/* 整表状态：可见行（按 seq-cell 量，seq-cell 每行必有 ⇒ 不依赖客户列是否存在） */
const JS_STATE = `(() => {
  const tbl = document.querySelector('.edit-grid-wrap table.tbl')
  const wrap = document.querySelector('.edit-grid-wrap')
  const seqs = [...document.querySelectorAll('.edit-grid-wrap tbody td.seq-cell[data-r]')]
  const vis = seqs.filter(td => td.getBoundingClientRect().height > 0)
  const rs = [...new Set(vis.map(td => +td.getAttribute('data-r')))].sort((a,b)=>a-b)
  const sum = document.querySelector('.edit-summary')
  const esRight = document.querySelector('.edit-summary .es-right')
  const lastTr = [...document.querySelectorAll('.edit-grid-wrap tbody tr')]
    .filter(t => t.getBoundingClientRect().height > 0).pop()
  return JSON.stringify({
    ok: !!tbl && !!wrap,
    ariaRows: tbl ? +(tbl.getAttribute('aria-rowcount') || 0) : 0,
    domTrs: document.querySelectorAll('.edit-grid-wrap tbody tr').length,
    visRows: rs.length,
    rMin: rs.length ? rs[0] : null,
    rMax: rs.length ? rs[rs.length - 1] : null,
    lastSeq: lastTr ? (lastTr.querySelector('.seq-num') || { textContent: '' }).textContent.trim() : null,
    pagerBtns: [...document.querySelectorAll('button')].filter(b => /^(上一页|下一页)$/.test((b.textContent || '').trim())).length,
    esPager: document.querySelectorAll('.es-pager,.pg-btn,.pg-info').length,
    sumH: sum ? +sum.getBoundingClientRect().height.toFixed(1) : null,
    kbdChip: document.querySelectorAll('.edit-summary .kbd-chip').length,
    esRightKids: esRight ? esRight.children.length : 0,
    wrapScrollH: wrap ? wrap.scrollHeight : 0,
    wrapClientH: wrap ? wrap.clientHeight : 0,
    nodes: document.querySelectorAll('.edit-grid-wrap *').length,
    inEdit: !!document.querySelector('.edit-grid-wrap')
  })
})()`

/* 勾「仅显示有报单」（改 DOM 前先记当前状态） */
const JS_TOGGLE_ZERO = (want) => `(() => {
  const cbs = [...document.querySelectorAll('input[type="checkbox"]')]
  const hit = cbs.find(cb => {
    const lab = cb.closest('label') || cb.parentElement
    return lab && /仅显示有报单/.test(lab.textContent || '')
  })
  if (!hit) return JSON.stringify({ ok: false, total: cbs.length })
  if (hit.checked !== ${want}) hit.click()
  return JSON.stringify({ ok: true, checked: hit.checked })
})()`

/* 可见的第一个数量格坐标（滚进视口后再量） */
const JS_CELL = `(() => {
  const tds = [...document.querySelectorAll('.edit-grid-wrap td.qty-cell[data-r]')]
  for (const td of tds) {
    const r = td.getBoundingClientRect()
    if (r.height <= 0) continue
    td.scrollIntoView({ block: 'center', inline: 'center' })
    const r2 = td.getBoundingClientRect()
    if (r2.top < 120 || r2.bottom > window.innerHeight - 60) continue
    /* 数量格内部是 <input> ⇒ td.textContent 恒为空，必须读 input.value */
    const inp = td.querySelector('input')
    return JSON.stringify({ ok: true, x: +(r2.left + r2.width / 2).toFixed(1), y: +(r2.top + r2.height / 2).toFixed(1),
      dr: +td.getAttribute('data-r'), dc: +td.getAttribute('data-c'),
      val: inp ? String(inp.value) : (td.textContent || '').trim() })
  }
  return JSON.stringify({ ok: false })
})()`
const JS_VAL = (r, c) => `(() => {
  const td = document.querySelector('.edit-grid-wrap td.qty-cell[data-r="${r}"][data-c="${c}"]')
  if (!td) return JSON.stringify({ ok: false })
  const inp = td.querySelector('input')
  return JSON.stringify({ ok: true, v: inp ? String(inp.value) : (td.textContent || '').trim() })
})()`

const JS_SCROLL_END = `(() => {
  const wrap = document.querySelector('.edit-grid-wrap')
  if (!wrap) return JSON.stringify({ ok: false })
  wrap.scrollTop = wrap.scrollHeight
  return JSON.stringify({ ok: true, top: wrap.scrollTop })
})()`
const JS_LAST_ROW_BOX = `(() => {
  const rows = [...document.querySelectorAll('.edit-grid-wrap tbody tr')]
  const tr = rows.filter(t => t.getBoundingClientRect().height > 0).pop()
  if (!tr) return JSON.stringify({ ok: false })
  const r = tr.getBoundingClientRect()
  const wrap = document.querySelector('.edit-grid-wrap').getBoundingClientRect()
  return JSON.stringify({ ok: true, top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
    wrapTop: +wrap.top.toFixed(1), wrapBottom: +wrap.bottom.toFixed(1),
    seq: (tr.querySelector('.seq-num') || { textContent: '' }).textContent.trim(),
    inWrap: r.top >= wrap.top - 2 && r.bottom <= wrap.bottom + 2,
    inViewport: r.bottom > 0 && r.top < window.innerHeight })
})()`

const JS_ERR = `(() => JSON.stringify(window.__HG_ERRS__ || []))()`
const JS_HOOK = `(() => { if (window.__HG_ERRS__) return 1; window.__HG_ERRS__ = [];
  window.addEventListener('error', e => window.__HG_ERRS__.push('err:' + (e.message || '')));
  window.addEventListener('unhandledrejection', e => window.__HG_ERRS__.push('rej:' + (e.reason && e.reason.message || e.reason)));
  return 1 })()`

let browser
const log = (...a) => console.log(...a)
const res = {}
try {
  fs.mkdirSync(OUT, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()
  const clickAt = async (x, y) => {
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
    await sleep(110)
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await sleep(320)
  }
  const key = async (k, code, vk, modifiers = 0) => {
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers })
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers })
    await sleep(300)
  }

  await page.goto(BASE, 3500)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 7000)
  await sleep(4200)
  const build = await page.eval(`(() => document.documentElement.dataset.build || '?')()`)
  log('构建号:', build)
  res.z0 = String(build).includes('v605')
  await page.eval(JS_HOOK)

  log('进改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(1200)
  log('确认:', await page.eval(JS_CONFIRM))
  /* 轮询等表格真正出现（顺便量「确认 → 首个可见行」的耗时；全量渲染是否卡人看这个数） */
  const tClick = Date.now()
  let firstSeen = -1
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    const st = JSON.parse(await page.eval(JS_STATE))
    if (st.visRows > 0) { firstSeen = Date.now() - tClick; break }
  }
  log('Z8 确认→首个可见行:', firstSeen, 'ms')
  await sleep(2600)

  /* 首次进编辑会自动弹快捷键面板（v603 遗留）——先收掉 */
  await page.eval(`(() => { const b = document.querySelector('.kbd-chip'); if (b && b.getAttribute('aria-expanded') === 'true') b.click(); return 1 })()`)
  await sleep(400)
  await key('Escape', 'Escape', 27)
  await sleep(3400)   // 等 toast 自然消失

  /* ── A 全量显示 ───────────────────────────────────────── */
  const s0 = JSON.parse(await page.eval(JS_STATE))
  log('A 状态:', JSON.stringify(s0))
  res.a1 = !!s0.ok && s0.ariaRows > 0 && s0.visRows === s0.ariaRows && s0.rMin === 0 && s0.rMax === s0.ariaRows - 1
  res.a2 = !!s0.ok && s0.pagerBtns === 0 && s0.esPager === 0
  res.a3 = !!s0.ok && s0.sumH != null && s0.sumH <= 28 && s0.kbdChip === 1 && s0.esRightKids <= 2
  await page.eval(`(() => { const s = document.querySelector('.edit-summary'); if (s) s.scrollIntoView({ block: 'center' }); return 1 })()`)
  await sleep(700)
  await page.screenshot(OUT + '/A-页脚无分页.png')

  /* ── A4 表体仍能滚到最后一行 ─────────────────────────── */
  const sc = JSON.parse(await page.eval(JS_SCROLL_END))
  await sleep(700)
  const lastBox = JSON.parse(await page.eval(JS_LAST_ROW_BOX))
  log('A4 滚到底:', JSON.stringify({ sc, lastBox, scrollable: s0.wrapScrollH > s0.wrapClientH }))
  res.a4 = !!lastBox.ok && lastBox.seq === String(s0.ariaRows) && s0.wrapScrollH > s0.wrapClientH && lastBox.inViewport
  await page.screenshot(OUT + '/A4-最后一行.png')

  /* ── B1 筛选仍生效 ───────────────────────────────────── */
  await page.eval(`(() => { const w = document.querySelector('.edit-grid-wrap'); if (w) w.scrollTop = 0; return 1 })()`)
  await sleep(500)
  const tz = await page.eval(JS_TOGGLE_ZERO(true))
  await sleep(1200)
  const sOn = JSON.parse(await page.eval(JS_STATE))
  await page.eval(JS_TOGGLE_ZERO(false))
  await sleep(1200)
  const sOff = JSON.parse(await page.eval(JS_STATE))
  log('B1 勾选:', tz, '| 开:', sOn.visRows, '关:', sOff.visRows, '全量:', s0.visRows)
  res.b1 = !!sOn.ok && sOn.visRows < s0.visRows && sOff.visRows === s0.visRows

  /* ── B2 单元格编辑未受牵连 ───────────────────────────── */
  await page.eval(`(() => { const w = document.querySelector('.edit-grid-wrap'); if (w) w.scrollTop = 0; return 1 })()`)
  await sleep(600)
  let b2 = false
  const cell = JSON.parse(await page.eval(JS_CELL))
  if (cell.ok) {
    await clickAt(cell.x, cell.y)
    await page.raw.send('Input.insertText', { text: '7' })
    await sleep(400)
    const v1 = JSON.parse(await page.eval(JS_VAL(cell.dr, cell.dc))).v
    await key('Tab', 'Tab', 9)             // 先提交（撤销栈按「已提交的编辑」入栈）
    await sleep(500)
    const v1b = JSON.parse(await page.eval(JS_VAL(cell.dr, cell.dc))).v
    await key('z', 'KeyZ', 90, 2)          // Ctrl+Z
    await sleep(800)
    const v2 = JSON.parse(await page.eval(JS_VAL(cell.dr, cell.dc))).v
    log('B2 格:', JSON.stringify({ dr: cell.dr, dc: cell.dc, before: cell.val, typing: v1, committed: v1b, afterUndo: v2 }))
    b2 = v1b === '7' && v2 === String(cell.val || '')
  } else log('B2 找不到可见数量格')
  res.b2 = b2

  /* ── B3 全屏仍全量 ───────────────────────────────────── */
  await page.eval(`(() => { const b = document.querySelector('.grid-fs-btn'); if (b) b.click(); return 1 })()`)
  await sleep(1800)
  const fsOn = JSON.parse(await page.eval(JS_STATE))
  await page.eval(`(() => { const s = document.querySelector('.edit-summary'); if (s) s.scrollIntoView({ block: 'center' }); return 1 })()`)
  await sleep(700)
  const fsSum = JSON.parse(await page.eval(`(() => {
    const s = document.querySelector('.edit-summary'); if (!s) return JSON.stringify({ ok: false })
    const r = s.getBoundingClientRect()
    return JSON.stringify({ ok: true, visRows: [...document.querySelectorAll('.edit-grid-wrap tbody td.seq-cell[data-r]')].filter(td => td.getBoundingClientRect().height > 0).length,
      inView: r.top >= 0 && r.bottom <= window.innerHeight, h: +r.height.toFixed(1) })
  })()`))
  log('B3 全屏:', JSON.stringify({ fsOn: { visRows: fsOn.visRows, ariaRows: fsOn.ariaRows, pagerBtns: fsOn.pagerBtns }, fsSum }))
  res.b3 = !!fsSum.ok && fsSum.inView && fsSum.visRows === s0.ariaRows
  await page.screenshot(OUT + '/B3-全屏.png')
  await key('Escape', 'Escape', 27)
  await sleep(300)
  await key('Escape', 'Escape', 27)   // 退出全屏
  await sleep(1000)

  const errs = JSON.parse(await page.eval(JS_ERR))
  log('错误:', JSON.stringify(errs))
  res.z9 = errs.length === 0
} catch (e) {
  log('EXCEPTION:', e && e.message)
  res.z9 = false
} finally {
  try { if (browser) await browser.close() } catch (e) {}
}
const pass = Object.values(res).filter(Boolean).length
const total = Object.keys(res).length
log('\n===== 结果 ' + pass + '/' + total + ' =====')
for (const k of Object.keys(res).sort()) log((res[k] ? 'PASS ' : 'FAIL ') + k)
process.exit(pass === total ? 0 : 1)
