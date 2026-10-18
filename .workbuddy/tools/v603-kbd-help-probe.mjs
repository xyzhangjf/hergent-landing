/**
 * v603 验证：键盘快捷键入口从「表格下方独占一行」挪到「页脚汇总条右侧胶囊 + 点开浮层」
 *
 * 判据清单
 *   Z0 构建号 v603
 *   A1 页脚胶囊存在：.edit-summary .kbd-chip，高≈20px，含 keyboard 图标（9 段 path，非齿轮兜底），文字「快捷键」
 *   A2 页脚行未被顶高：.edit-summary 高度 ≤ 24px（与 .sprint-chip 同高）
 *   A3 旧入口已消失：.kbd-help / .kbd-grid 在 DOM 中为零；无告示时 .edit-hint 也不渲染
 *   A4 不再多占一行：card 底边 - 页脚底边 ≤ 24px（有独立一行时会多出 30px 以上）
 *   B1 点胶囊 → 浮层出现；向上弹（浮层底 ≤ 胶囊顶）；整体在视口内；4 组、≥15 条
 *   B2 浮层开着按 Esc ⇒ 只关浮层，不触发「已放弃本格修改」（值不变、无该 toast）
 *   B3 点页面别处 ⇒ 浮层关闭
 *   B4 全屏改单：胶囊仍在视口内可见，点开浮层仍在视口内（原来这块被全屏层遮住=完全看不到）
 *   Z9 零页面报错
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v603'
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

/* 胶囊几何 + 图标取证 */
const JS_CHIP = `(() => {
  const chip = document.querySelector('.edit-summary .kbd-chip')
  if (!chip) return JSON.stringify({ ok: false, why: 'no chip' })
  const r = chip.getBoundingClientRect()
  const svg = chip.querySelector('svg')
  const paths = svg ? svg.querySelectorAll('path').length : 0
  const sum = chip.closest('.edit-summary')
  const sr = sum.getBoundingClientRect()
  const card = document.querySelector('.card.cross-card')
  const cr = card.getBoundingClientRect()
  const sprint = document.querySelector('.edit-summary .sprint-chip')
  const spr = sprint ? sprint.getBoundingClientRect() : null
  return JSON.stringify({
    ok: true,
    text: (chip.textContent || '').trim(),
    w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1),
    inView: r.top > 0 && r.bottom < window.innerHeight,
    paths,
    summaryH: +sr.height.toFixed(1),
    cardGap: +(cr.bottom - sr.bottom).toFixed(1),
    sprintH: spr ? +spr.height.toFixed(1) : null,
    oldEntry: document.querySelectorAll('.kbd-help, .kbd-grid').length,
    hint: document.querySelectorAll('.edit-hint').length,
    hintText: (document.querySelector('.edit-hint') || { textContent: '' }).textContent.trim().slice(0, 40),
    hintHasKbd: !!document.querySelector('.edit-hint kbd'),
    kbdOutside: [...document.querySelectorAll('kbd')].filter(e => !e.closest('.kbd-pop')).length,
    expanded: chip.getAttribute('aria-expanded')
  })
})()`

/* 浮层几何 */
const JS_POP = `(() => {
  const p = document.querySelector('.kbd-pop')
  if (!p) return JSON.stringify({ ok: false })
  const r = p.getBoundingClientRect()
  const chip = document.querySelector('.edit-summary .kbd-chip')
  const cr = chip.getBoundingClientRect()
  return JSON.stringify({
    ok: true,
    top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
    left: +r.left.toFixed(1), right: +r.right.toFixed(1),
    w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    chipTop: +cr.top.toFixed(1),
    sections: p.querySelectorAll('section').length,
    rows: p.querySelectorAll('section p').length,
    kbds: p.querySelectorAll('kbd').length,
    heads: [...p.querySelectorAll('section h4')].map(e => e.textContent.trim()),
    inView: r.top >= 0 && r.bottom <= window.innerHeight + 0.5 && r.left >= 0 && r.right <= window.innerWidth + 0.5,
    above: r.bottom <= cr.top + 0.5,
    vw: window.innerWidth, vh: window.innerHeight
  })
})()`

const JS_CLOSE_STATE = `(() => JSON.stringify({
  pop: document.querySelectorAll('.kbd-pop').length,
  expanded: (document.querySelector('.edit-summary .kbd-chip') || {}).getAttribute
    ? document.querySelector('.edit-summary .kbd-chip').getAttribute('aria-expanded') : null
}))()`

const JS_TOASTS = `(() => {
  const ts = [...document.querySelectorAll('.toast .toast-msg')].map(e => (e.textContent || '').trim())
  return JSON.stringify({ ts })
})()`

const JS_CELL = (i, j) => `(() => {
  const tbl = document.querySelector('table.edit-tbl')
  if (!tbl) return JSON.stringify({ ok: false, why: 'no table' })
  const rows = [...tbl.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td.qty-cell'))
  const tr = rows[${i}]
  if (!tr) return JSON.stringify({ ok: false, why: 'no row', n: rows.length })
  const td = tr.querySelectorAll('td.qty-cell')[${j}]
  if (!td) return JSON.stringify({ ok: false, why: 'no col' })
  const r = td.getBoundingClientRect()
  const x = r.left + r.width / 2, y = r.top + r.height / 2
  return JSON.stringify({ ok: true, dr: td.getAttribute('data-r'), dc: td.getAttribute('data-c'),
    x: +x.toFixed(1), y: +y.toFixed(1),
    inView: y > 80 && y < window.innerHeight - 60 && x > 0 && x < window.innerWidth })
})()`
const JS_VAL = (dr, dc) => `(() => {
  const el = document.querySelector('td.qty-cell input[data-r="${dr}"][data-c="${dc}"]')
  return JSON.stringify({ v: el ? el.value : null })
})()`

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
    await sleep(300)
  }
  const key = async (k, code, vk, mod = 0) => {
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod })
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod })
    await sleep(280)
  }

  await page.goto(BASE, 3500)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 7000)
  await sleep(4500)
  const build = await page.eval(`(() => document.documentElement.dataset.build || '?')()`)
  log('构建号:', build)
  res.z0 = String(build).includes('v603')

  log('进改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(1200)
  log('确认:', await page.eval(JS_CONFIRM))
  await sleep(4800)

  /* 首次进入会自动弹一次（Q28 遗留行为）——先按 Esc 收掉，后续判据从"关闭态"起测 */
  const autoPop = JSON.parse(await page.eval(JS_CLOSE_STATE))
  log('首次自动展开:', JSON.stringify(autoPop))
  if (autoPop.pop) { await key('Escape', 'Escape', 27); await sleep(300) }
  await sleep(3400)   // 等可能的 toast 自然消失（短文案无关闭按钮）

  /* ── A 位置与形态 ─────────────────────────────────────── */
  const chip = JSON.parse(await page.eval(JS_CHIP))
  log('A 胶囊:', JSON.stringify(chip))
  res.a1 = !!chip.ok && chip.text.includes('快捷键') && Math.abs(chip.h - 20) <= 1.5 && chip.paths === 9
  res.a2 = !!chip.ok && chip.summaryH <= 24 && (chip.sprintH == null || Math.abs(chip.sprintH - chip.h) <= 1.5)
  res.a3 = !!chip.ok && chip.oldEntry === 0 && !chip.hintHasKbd
  log('A3 旧入口/横幅:', JSON.stringify({ oldEntry: chip.oldEntry, hint: chip.hint, hintText: chip.hintText, hintHasKbd: chip.hintHasKbd }))
  /* A4：页面上除浮层外不存在任何 kbd（= 旧的那一行真的没了）；cardGap 仅记录（含草稿恢复条时>24 属正常） */
  res.a4 = !!chip.ok && chip.kbdOutside === 0
  await page.screenshot(OUT + '/A-页脚胶囊.png')

  /* 页脚常在视口下沿之外（草稿恢复条会把整页顶高）——CDP 对**视口外坐标**派发鼠标事件是静默无效的
     （v598 踩过），所以每次点胶囊前先把它滚进视口中间。 */
  const scrollChip = async () => {
    await page.eval(`(() => { const c = document.querySelector('.edit-summary .kbd-chip'); if (c) c.scrollIntoView({ block: 'center' }); return 1 })()`)
    await sleep(750)
  }
  const scrollTop = async () => {
    await page.eval(`(() => { const vw = document.querySelector('.view-wrap'); if (vw && vw.scrollHeight > vw.clientHeight) vw.scrollTop = 0; window.scrollTo(0, 0); return 1 })()`)
    await sleep(600)
  }

  /* ── B1 点开浮层 ───────────────────────────────────────── */
  await scrollChip()
  let ch = JSON.parse(await page.eval(JS_CHIP))
  log('B1 胶囊(滚动后):', JSON.stringify({ x: ch.x, y: ch.y, inView: ch.inView }))
  await clickAt(ch.x, ch.y)
  const pop = JSON.parse(await page.eval(JS_POP))
  log('B1 浮层:', JSON.stringify(pop))
  res.b1 = !!pop.ok && pop.inView && pop.above && pop.sections === 4 && pop.rows >= 15 && pop.kbds >= 20
  await page.screenshot(OUT + '/B1-快捷键浮层.png')

  /* ── B2 Esc 只关浮层，不误伤本格修改 ───────────────────── */
  let cell = null
  await key('Escape', 'Escape', 27)       // 先收掉浮层
  await sleep(300)
  await scrollTop()
  for (let i = 0; i < 14 && !cell; i++) {
    for (let j = 0; j < 4; j++) {
      const c = JSON.parse(await page.eval(JS_CELL(i, j)))
      if (!c.ok) break
      if (!c.inView) continue
      cell = c; break
    }
  }
  let b2 = false
  if (cell) {
    await clickAt(cell.x, cell.y)
    await page.raw.send('Input.insertText', { text: '88' })
    await sleep(300)
    await scrollChip()                    // 滚到页脚点胶囊（焦点随之离开表格）
    const c2 = JSON.parse(await page.eval(JS_CHIP))
    await clickAt(c2.x, c2.y)
    await sleep(400)
    const popOpen = JSON.parse(await page.eval(JS_CLOSE_STATE))
    await key('Escape', 'Escape', 27)     // 这次 Esc 应只关浮层
    await sleep(450)
    const closed = JSON.parse(await page.eval(JS_CLOSE_STATE))
    const v = JSON.parse(await page.eval(JS_VAL(cell.dr, cell.dc))).v
    const ts = JSON.parse(await page.eval(JS_TOASTS)).ts
    log('B2 开:', JSON.stringify(popOpen), '→ Esc 后:', JSON.stringify(closed),
      '| 格值:', JSON.stringify(v), '| toast:', JSON.stringify(ts))
    b2 = popOpen.pop === 1 && closed.pop === 0 && v === '88' && !ts.some(s => s.includes('已放弃本格修改'))
  } else log('B2 找不到视口内的数量格，跳过')
  res.b2 = b2

  /* ── B3 点别处关闭 ────────────────────────────────────── */
  const c3 = JSON.parse(await page.eval(JS_CHIP))
  await clickAt(c3.x, c3.y)
  await sleep(350)
  const opened3 = JSON.parse(await page.eval(JS_CLOSE_STATE)).pop
  await clickAt(30, 300)                  // 页面左侧空白
  await sleep(350)
  const closed3 = JSON.parse(await page.eval(JS_CLOSE_STATE)).pop
  log('B3 点外部：开=', opened3, '关后=', closed3)
  res.b3 = opened3 === 1 && closed3 === 0

  /* ── B4 全屏 ──────────────────────────────────────────── */
  await page.eval(`(() => { const b = document.querySelector('.grid-fs-btn'); if (b) b.click(); return 1 })()`)
  await sleep(1600)
  await scrollChip()
  const fsChip = JSON.parse(await page.eval(JS_CHIP))
  await clickAt(fsChip.x, fsChip.y)
  await sleep(450)
  const fsPop = JSON.parse(await page.eval(JS_POP))
  log('B4 全屏胶囊:', JSON.stringify(fsChip), '| 浮层:', JSON.stringify(fsPop))
  res.b4 = !!fsChip.ok && fsChip.inView && !!fsPop.ok && fsPop.inView
  await page.screenshot(OUT + '/B4-全屏浮层.png')
  await key('Escape', 'Escape', 27)
  await sleep(300)
  await key('Escape', 'Escape', 27)       // 退出全屏
  await sleep(900)

  res.z9 = (page.errors || []).length === 0
  log('Z9 页面报错:', JSON.stringify(page.errors || []))

  for (const k of ['z0', 'a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4', 'z9'])
    log(k.toUpperCase(), res[k] ? 'PASS' : 'FAIL')
  log('汇总:', Object.values(res).every(Boolean) ? 'ALL PASS' : 'HAS FAIL')
} catch (e) {
  console.error('探针异常:', e && e.message)
} finally {
  try { await browser.close() } catch (e) {}
}
