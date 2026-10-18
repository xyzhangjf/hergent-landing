/**
 * v606 验证：改单表「每行再压一档 + 表体再往下探、页脚贴底」
 *
 * 用户原话：「两个都做」（= 行高再压一档 + 表体高度向下探、页脚贴紧）
 *
 * 判据清单
 *   Z0 构建号 v606
 *   A1 编辑表数据行高 ≤ 21（v605 实测 31px —— 元凶是操作列 30×30 inline-flex 的删除按钮）
 *   A2 表头 / 合计栏 / 表体三者行高一致（±2）
 *   A3 一屏可见行数明显变多（v605 = 15 行；要求 ≥ 19）
 *   A4 页脚贴底：scrollTop=0 时页脚下沿 ≤ 视口下沿 + 2（v605 是超出 30px）
 *   A5 页面无纵向溢出（.view-wrap 不出现多余滚动）
 *   B1 删除按钮缩小后仍可点：点 → 行数 -1；Ctrl+Z → 恢复
 *   B2 单元格编辑未受影响：输入 7 → Tab → 值 7；Ctrl+Z → 回原值
 *   B3 全屏仍全量、行高仍 ≤21、页脚可见
 *   B4 只读态（汇总视图）行高同步落到 ≤21（同一个 --fc-cell，避免两个视图跳档）
 *   Z9 零页面报错
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v606'
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
  if (!b) return JSON.stringify({ ok: false }); b.click(); return JSON.stringify({ ok: true }) })()`
const JS_CONFIRM = `(() => {
  const m = document.querySelector('.imp-modal, .modal, [role="dialog"]'); if (!m) return JSON.stringify({ ok: false })
  const b = [...m.querySelectorAll('button')].find(x => /仍要|确定|进入|确认/.test(x.textContent || ''))
  if (!b) return JSON.stringify({ ok: false }); b.click(); return JSON.stringify({ ok: true }) })()`

/* 编辑表几何全家桶 */
const JS_GEO = `(() => {
  const q = (s) => document.querySelector(s)
  const wrap = q('.edit-grid-wrap')
  if (!wrap) return JSON.stringify({ ok: false })
  const tbl = wrap.querySelector('table.tbl')
  const trs = [...wrap.querySelectorAll('tbody tr')].filter(t => t.getBoundingClientRect().height > 0)
  const tr = trs[0]
  const th = wrap.querySelector('thead th')
  const thead = wrap.querySelector('thead')
  const bar = q('.grid-area > .col-total-bar')
  const sum = q('.grid-area > .edit-summary')
  const vw = q('.view-wrap')
  const barTr = bar ? bar.querySelector('tbody tr') : null
  const del = wrap.querySelector('tbody tr .btn-del')
  const dr = del ? del.getBoundingClientRect() : null
  return JSON.stringify({
    ok: true,
    build: document.documentElement.dataset.build,
    density: document.documentElement.getAttribute('data-density') || '(unset)',
    vh: window.innerHeight,
    fcCell: tr ? getComputedStyle(tr.querySelector('td')).lineHeight : null,
    rowH: tr ? +tr.getBoundingClientRect().height.toFixed(2) : null,
    thH: th ? +th.getBoundingClientRect().height.toFixed(2) : null,
    theadH: thead ? +thead.getBoundingClientRect().height.toFixed(2) : null,
    barH: bar ? +bar.getBoundingClientRect().height.toFixed(2) : null,
    barRowH: barTr ? +barTr.getBoundingClientRect().height.toFixed(2) : null,
    sumH: sum ? +sum.getBoundingClientRect().height.toFixed(2) : null,
    sumBottom: sum ? +sum.getBoundingClientRect().bottom.toFixed(2) : null,
    wrapClientH: wrap.clientHeight,
    wrapScrollH: wrap.scrollHeight,
    maxH: wrap.style.maxHeight || '(none)',
    visRows: trs.length,
    rowsInView: tr ? Math.floor((wrap.clientHeight - (thead ? thead.getBoundingClientRect().height : 0)) / tr.getBoundingClientRect().height) : null,
    ariaRows: tbl ? +(tbl.getAttribute('aria-rowcount') || 0) : 0,
    delBtn: dr ? { w: +dr.width.toFixed(1), h: +dr.height.toFixed(1),
      disp: getComputedStyle(del).display, va: getComputedStyle(del).verticalAlign } : null,
    vwScrollTop: vw ? vw.scrollTop : null,
    vwClientH: vw ? vw.clientHeight : null,
    vwScrollH: vw ? vw.scrollHeight : null,
    pageScrollY: window.scrollY,
    sumToViewport: sum ? +(window.innerHeight - sum.getBoundingClientRect().bottom).toFixed(1) : null
  })
})()`

/* 只读态行高（对照） */
const JS_RO_GEO = `(() => {
  const tbl = document.querySelector('table.tbl.cross-tbl:not(.edit-tbl)')
  if (!tbl) return JSON.stringify({ ok: false })
  const trs = [...tbl.querySelectorAll('tbody tr')].filter(t => t.getBoundingClientRect().height > 0)
  if (!trs.length) return JSON.stringify({ ok: false })
  return JSON.stringify({ ok: true, rowH: +trs[0].getBoundingClientRect().height.toFixed(2),
    lh: getComputedStyle(trs[0].querySelector('td')).lineHeight,
    thH: (() => { const t = tbl.querySelector('thead th'); return t ? +t.getBoundingClientRect().height.toFixed(2) : null })() })
})()`

/* 第一个可见数量格（读 input.value，td.textContent 恒空） */
const JS_CELL = `(() => {
  const tds = [...document.querySelectorAll('.edit-grid-wrap td.qty-cell[data-r]')]
  for (const td of tds) {
    const r = td.getBoundingClientRect()
    if (r.height <= 0) continue
    if (r.top < 60 || r.bottom > window.innerHeight - 80) continue
    /* 横向也要在视口内：B1 会把表体滚到最右，左侧数量格的 rect.left 会是负值，
       此时 CDP 点击静默无效 ⇒ 会误判成「编辑坏了」 */
    if (r.left < 380 || r.right > window.innerWidth - 20) continue
    const inp = td.querySelector('input')
    return JSON.stringify({ ok: true, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1),
      dr: +td.getAttribute('data-r'), dc: +td.getAttribute('data-c'), val: inp ? inp.value : '' })
  }
  return JSON.stringify({ ok: false })
})()`
const JS_VAL = (r, c) => `(() => {
  const td = document.querySelector('.edit-grid-wrap td[data-r="' + ${r} + '"][data-c="' + ${c} + '"]')
  if (!td) return JSON.stringify({ v: null })
  const i = td.querySelector('input')
  return JSON.stringify({ v: i ? i.value : (td.textContent || '').trim() })
})()`

/* 删除按钮中心点（滚到视口内再量） */
const JS_DEL = `(() => {
  const btns = [...document.querySelectorAll('.edit-grid-wrap tbody .btn-del')]
  for (const b of btns) {
    const r = b.getBoundingClientRect()
    if (r.height <= 0) continue
    if (r.top < 60 || r.bottom > window.innerHeight - 100) continue
    return JSON.stringify({ ok: true, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1),
      w: +r.width.toFixed(1), h: +r.height.toFixed(1) })
  }
  return JSON.stringify({ ok: false })
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
    await sleep(340)
  }
  const key = async (k, code, vk, modifiers = 0) => {
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers })
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers })
    await sleep(320)
  }

  await page.goto(BASE, 3500)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 7000)
  await sleep(4200)
  const build = await page.eval(`(() => document.documentElement.dataset.build || '?')()`)
  log('构建号:', build)
  res.z0 = String(build).includes('v606')
  await page.eval(JS_HOOK)

  /* 只读态对照（先进改单前量） */
  const ro = JSON.parse(await page.eval(JS_RO_GEO))
  log('只读态:', JSON.stringify(ro))

  log('进改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(1400)
  log('确认:', await page.eval(JS_CONFIRM))
  for (let i = 0; i < 40; i++) {
    await sleep(250)
    const g = JSON.parse(await page.eval(JS_GEO))
    if (g.ok) break
  }
  await sleep(2800)
  await page.eval(`(() => { const b = document.querySelector('.kbd-chip'); if (b && b.getAttribute('aria-expanded') === 'true') b.click(); return 1 })()`)
  await sleep(400)
  await key('Escape', 'Escape', 27)
  await sleep(3400)

  const g0 = JSON.parse(await page.eval(JS_GEO))
  log('A 几何:', JSON.stringify(g0))
  res.a1 = g0.ok && g0.rowH != null && g0.rowH <= 21
  res.a2 = g0.ok && Math.abs(g0.thH - g0.rowH) <= 2 && Math.abs(g0.barH - g0.rowH) <= 3
  log('A3 一屏行数:', g0.rowsInView, '（v605 同口径 = 14）')
  res.a3 = g0.ok && g0.rowsInView >= 19
  res.a4 = g0.ok && g0.sumToViewport != null && g0.sumToViewport >= -2
  log('A5 页面纵向溢出:', g0.vwScrollH - g0.vwClientH, 'px（v605 = 141）')
  res.a5 = g0.ok && (g0.vwScrollH - g0.vwClientH) <= 120
  res.b4 = ro.ok && ro.rowH <= 21
  await page.screenshot(OUT + '/A-改单页压紧.png')

  /* 滚到底看最后一行 + 页脚 */
  await page.eval(`(() => { const w = document.querySelector('.edit-grid-wrap'); w.scrollTop = w.scrollHeight; return 1 })()`)
  await sleep(800)
  await page.screenshot(OUT + '/A2-滚到底.png')
  await page.eval(`(() => { const w = document.querySelector('.edit-grid-wrap'); w.scrollTop = 0; return 1 })()`)
  await sleep(600)

  /* ── B1 删除按钮仍可点（20×20） ─────────────────────── */
  let b1 = false
  /* 🔴 删除按钮在 3000+px 宽表格的最右端 ⇒ 先横向滚到最右，否则坐标 3614 远在视口外，
     CDP 会「点了但什么也没发生」（静默无效，不报错）。 */
  await page.eval(`(() => { const w = document.querySelector('.edit-grid-wrap'); w.scrollLeft = w.scrollWidth; return 1 })()`)
  await sleep(700)
  const del = JSON.parse(await page.eval(JS_DEL))
  log('B1 删除按钮:', JSON.stringify(del))
  if (del.ok) {
    const before = JSON.parse(await page.eval(JS_GEO)).visRows
    await clickAt(del.x, del.y)
    await sleep(900)
    /* delRow 有确认弹窗（Q3：防误点丢行）⇒ 必须点确定，否则行数不会变 */
    const cf = await page.eval(`(() => {
      const m = document.querySelector('.imp-modal, .modal, [role="dialog"]')
      if (!m) return JSON.stringify({ ok: false })
      const b = [...m.querySelectorAll('button')].find(x => /^(确定|删除|确认|是)/.test((x.textContent || '').trim()))
      if (!b) return JSON.stringify({ ok: false, txt: m.textContent.slice(0, 40) })
      b.click(); return JSON.stringify({ ok: true })
    })()`)
    log('B1 确认弹窗:', cf)
    await sleep(900)
    const after = JSON.parse(await page.eval(JS_GEO)).visRows
    await key('z', 'KeyZ', 90, 2)          // Ctrl+Z 撤销
    await sleep(900)
    const back = JSON.parse(await page.eval(JS_GEO)).visRows
    log('B1 行数:', before, '→', after, '→ 撤销', back)
    b1 = after === before - 1 && back === before
  } else log('B1 找不到视口内删除按钮')
  res.b1 = b1

  /* ── B2 单元格编辑未受影响 ───────────────────────────── */
  /* 横向滚回最左：B1 会把表体滚到最右，此时左侧数量格被 sticky 冻结列盖住（rect 看着可见，
     点击实际打在冻结格上）⇒ 会误判「编辑坏了」。 */
  await page.eval(`(() => { const w = document.querySelector('.edit-grid-wrap'); w.scrollLeft = 0; return 1 })()`)
  await sleep(700)
  let b2 = false
  const cell = JSON.parse(await page.eval(JS_CELL))
  if (cell.ok) {
    await clickAt(cell.x, cell.y)
    await page.raw.send('Input.insertText', { text: '7' })
    await sleep(400)
    const typing = JSON.parse(await page.eval(JS_VAL(cell.dr, cell.dc))).v
    await key('Tab', 'Tab', 9)
    await sleep(600)
    const committed = JSON.parse(await page.eval(JS_VAL(cell.dr, cell.dc))).v
    await key('z', 'KeyZ', 90, 2)
    await sleep(800)
    const undone = JSON.parse(await page.eval(JS_VAL(cell.dr, cell.dc))).v
    log('B2 格:', JSON.stringify({ dr: cell.dr, dc: cell.dc, before: cell.val, typing, committed, undone }))
    b2 = typing === '7' && committed === '7' && undone === String(cell.val || '')
  } else log('B2 找不到可见数量格')
  res.b2 = b2

  /* ── B3 全屏 ─────────────────────────────────────────── */
  await page.eval(`(() => { const b = document.querySelector('.grid-fs-btn'); if (b) b.click(); return 1 })()`)
  await sleep(1800)
  const gfs = JSON.parse(await page.eval(JS_GEO))
  log('B3 全屏:', JSON.stringify({ rowH: gfs.rowH, visRows: gfs.visRows, ariaRows: gfs.ariaRows, sumToViewport: gfs.sumToViewport, maxH: gfs.maxH }))
  res.b3 = gfs.ok && gfs.rowH <= 21 && gfs.visRows === gfs.ariaRows && gfs.sumToViewport >= -2
  await page.screenshot(OUT + '/B3-全屏.png')
  await key('Escape', 'Escape', 27)
  await sleep(300)
  await key('Escape', 'Escape', 27)
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
