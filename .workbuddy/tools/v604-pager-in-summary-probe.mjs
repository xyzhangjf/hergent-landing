/**
 * v604 验证：分页控件从「表格下方独占一行」并进页脚「合计」行最右 + 删掉页脚「显示全部」
 *
 * 判据清单
 *   Z0 构建号 v604
 *   A1 `.edit-summary .es-pager` 存在，= 2 按钮 + 1 页码；按钮高 22±1.5、字号 12
 *   A2 与「合计」同一行：pager 顶底完全落在 .edit-summary 的矩形内；页脚行高 ≤ 28（未被顶高）
 *   A3 在这一行的最右：没有任何兄弟元素右边界越过它；且它右边界贴齐页脚内边界（差 ≤ 2）
 *   A4 旧那一行真的没了：.pager / .pager-info 各 0 个，页面上无文案为「显示全部」的按钮
 *   B1 点「下一页」：页码 1→2，且表格首行内容变化（真翻页，不是只改数字）
 *   B2 第 1 页「上一页」禁用
 *   B3 一路点到末页：页码 = N/N，且「下一页」禁用
 *   B4 全屏改单：分页仍在视口内可见、可点（页脚在 .grid-area 内 ⇒ 全屏不被遮）
 *   Z9 零页面报错
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v604'
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

/* 分页块几何 + 旧入口取证 + 首行内容 */
const JS_PAGER = `(() => {
  const sum = document.querySelector('.edit-summary')
  const pg = document.querySelector('.edit-summary .es-pager')
  if (!pg || !sum) return JSON.stringify({ ok: false, hasSum: !!sum, hasPg: !!pg })
  const r = pg.getBoundingClientRect(), sr = sum.getBoundingClientRect()
  const btns = [...pg.querySelectorAll('button')]
  const br = btns.map(b => b.getBoundingClientRect())
  const padR = parseFloat(getComputedStyle(sum).paddingRight) || 0
  /* 最右判据：本行内没有任何兄弟元素越过它 */
  const over = [...sum.children].filter(el => el !== pg && el.getBoundingClientRect().right > r.right + 1)
                     .map(el => (el.className || el.tagName) + ':' + el.getBoundingClientRect().right.toFixed(1))
  const vis = [...document.querySelectorAll('.edit-grid-wrap td.qty-cell[data-r]')]
    .filter(td => td.getBoundingClientRect().height > 0)
    .map(td => +td.getAttribute('data-r'))
  const rMin = vis.length ? Math.min(...vis) : null
  const firstRow = document.querySelector('.edit-grid-wrap tbody tr')
  return JSON.stringify({
    ok: true,
    pageText: (pg.querySelector('.pg-info') || { textContent: '' }).textContent.trim(),
    btns: btns.length,
    btnTexts: btns.map(b => (b.textContent || '').trim()),
    disabled: btns.map(b => !!b.disabled),
    btnH: br.length ? +Math.max(...br.map(x => x.height)).toFixed(1) : null,
    btnFont: btns.length ? getComputedStyle(btns[0]).fontSize : null,
    pgW: +r.width.toFixed(1), pgH: +r.height.toFixed(1),
    pgTop: +r.top.toFixed(1), pgBottom: +r.bottom.toFixed(1),
    sumTop: +sr.top.toFixed(1), sumBottom: +sr.bottom.toFixed(1),
    sumH: +sr.height.toFixed(1), padR,
    rightGap: +((sr.right - padR) - r.right).toFixed(1),
    over,
    inView: r.top > 0 && r.bottom < window.innerHeight,
    oldPager: document.querySelectorAll('.pager').length,
    oldInfo: document.querySelectorAll('.pager-info').length,
    showAllBtn: [...document.querySelectorAll('button')].filter(b => (b.textContent || '').trim() === '显示全部').length,
    firstRow: firstRow ? (firstRow.textContent || '').trim().slice(0, 46) : null,
    rMin, visRows: vis.length
  })
})()`

/* 点某个分页按钮（按文字定位，先滚进视口 —— CDP 对视口外坐标派发鼠标事件静默无效） */
const JS_BTN_CENTER = (txt) => `(() => {
  const b = [...document.querySelectorAll('.edit-summary .es-pager button')].find(x => (x.textContent||'').trim() === ${JSON.stringify(txt)})
  if (!b) return JSON.stringify({ ok: false })
  b.scrollIntoView({ block: 'center' })
  const r = b.getBoundingClientRect()
  return JSON.stringify({ ok: true, x: +(r.left + r.width/2).toFixed(1), y: +(r.top + r.height/2).toFixed(1),
    disabled: !!b.disabled, inView: r.top > 0 && r.bottom < window.innerHeight })
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
  const key = async (k, code, vk) => {
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk })
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk })
    await sleep(280)
  }
  const clickBtn = async (txt) => {
    const c = JSON.parse(await page.eval(JS_BTN_CENTER(txt)))
    if (!c.ok) return c
    await clickAt(c.x, c.y)
    return c
  }

  await page.goto(BASE, 3500)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 7000)
  await sleep(4200)
  const build = await page.eval(`(() => document.documentElement.dataset.build || '?')()`)
  log('构建号:', build)
  res.z0 = String(build).includes('v604')
  await page.eval(JS_HOOK)

  log('进改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(1200)
  log('确认:', await page.eval(JS_CONFIRM))
  await sleep(5200)

  /* 首次进编辑会自动弹快捷键面板（Q28/v603 遗留）——先收掉再测 */
  await page.eval(`(() => { const b = document.querySelector('.kbd-chip'); if (b && b.getAttribute('aria-expanded') === 'true') b.click(); return 1 })()`)
  await sleep(400)
  await key('Escape', 'Escape', 27)
  await sleep(3400)   // 等可能的 toast 自然消失

  /* ── A 位置与形态 ─────────────────────────────────────── */
  const p0 = JSON.parse(await page.eval(JS_PAGER))
  log('A 分页块:', JSON.stringify(p0))
  res.a1 = !!p0.ok && p0.btns === 2 && /^\d+ \/ \d+$/.test(p0.pageText || '')
    && p0.btnH != null && Math.abs(p0.btnH - 22) <= 1.5 && p0.btnFont === '12px'
  res.a2 = !!p0.ok && p0.pgTop >= p0.sumTop - 1 && p0.pgBottom <= p0.sumBottom + 1 && p0.sumH <= 28
  res.a3 = !!p0.ok && p0.over.length === 0 && Math.abs(p0.rightGap) <= 2
  log('A3 右侧:', JSON.stringify({ rightGap: p0.rightGap, over: p0.over }))
  res.a4 = !!p0.ok && p0.oldPager === 0 && p0.oldInfo === 0 && p0.showAllBtn === 0
  await page.eval(`(() => { const s = document.querySelector('.edit-summary'); if (s) s.scrollIntoView({ block: 'center' }); return 1 })()`)
  await sleep(700)
  await page.screenshot(OUT + '/A-页脚分页.png')

  /* ── B 翻页 ───────────────────────────────────────────── */
  const first1 = p0.firstRow
  const page1 = p0.pageText
  res.b2 = !!p0.ok && p0.disabled[0] === true        // 第 1 页「上一页」禁用

  const c2 = await clickBtn('下一页')
  await sleep(900)
  const p1 = JSON.parse(await page.eval(JS_PAGER))
  log('B1 第 2 页:', JSON.stringify({ page: p1.pageText, rMin: p1.rMin, rMinPrev: p0.rMin, visRows: p1.visRows, disabled: p1.disabled, click: c2 }))
  res.b1 = !!p1.ok && p1.pageText !== page1 && p1.rMin != null && p0.rMin != null && p1.rMin > p0.rMin
  await page.screenshot(OUT + '/B-第2页.png')

  /* B3 一路点到末页（最多 60 次，防死循环） */
  const total = parseInt(String(p1.pageText).split('/')[1], 10) || 1
  let guard = 0
  while (guard++ < 60) {
    const st = JSON.parse(await page.eval(JS_PAGER))
    if (st.disabled && st.disabled[1]) break
    const c = await clickBtn('下一页')
    if (!c.ok || c.disabled) break
    await sleep(420)
  }
  const last = JSON.parse(await page.eval(JS_PAGER))
  log('B3 末页:', JSON.stringify({ page: last.pageText, disabled: last.disabled, total, clicks: guard }))
  res.b3 = !!last.ok && last.pageText === (total + ' / ' + total) && last.disabled[1] === true

  /* 回到第 1 页，避免影响后续（截图/全屏判断） */
  for (let i = 0; i < 3; i++) { await clickBtn('上一页'); await sleep(300) }
  await page.eval(`(() => { const s = document.querySelector('.edit-summary'); if (s) s.scrollIntoView({ block: 'center' }); return 1 })()`)
  await sleep(500)

  /* ── B4 全屏 ──────────────────────────────────────────── */
  await page.eval(`(() => { const b = document.querySelector('.grid-fs-btn'); if (b) b.click(); return 1 })()`)
  await sleep(1700)
  await page.eval(`(() => { const s = document.querySelector('.edit-summary'); if (s) s.scrollIntoView({ block: 'nearest' }); return 1 })()`)
  await sleep(700)
  const fsg = JSON.parse(await page.eval(JS_PAGER))
  const fsClick = await clickBtn('下一页')
  await sleep(900)
  const fs2 = JSON.parse(await page.eval(JS_PAGER))
  log('B4 全屏:', JSON.stringify({ inView: fsg.inView, page: fsg.pageText, afterClick: fs2.pageText, click: fsClick }))
  res.b4 = !!fsg.ok && fsg.inView === true && !!fs2.ok && fs2.pageText !== fsg.pageText
  await page.screenshot(OUT + '/B4-全屏.png')
  await key('Escape', 'Escape', 27)
  await sleep(900)

  const errs = JSON.parse(await page.eval(JS_ERR))
  log('页面报错:', JSON.stringify(errs))
  res.z9 = Array.isArray(errs) && errs.length === 0
} catch (e) {
  log('探针异常:', e && e.stack || e)
  res.z9 = false
} finally {
  try { if (browser) await browser.close() } catch (e) {}
}

const keys = Object.keys(res).sort()
log('\n===== 汇总 =====')
for (const k of keys) log(k.toUpperCase(), res[k] ? 'PASS' : 'FAIL')
log('PASS', keys.filter(k => res[k]).length, '/', keys.length)
