/**
 * v602 验证：三件事
 *   A 三个筛选徽标「去掉图标、只留文字」（含全屏态不再收成图标）
 *   B Esc = 放弃本格修改（还原成进格前的值）
 *   C 编辑网格高度自适应：任意窗口高度下，表格底边（含横向滚动条）与合计栏都在视口内
 *
 * 判据清单
 *   Z0 构建号 v602
 *   A1 226 徽标内无 <svg>，文字完整
 *   A2 零报单徽标内无 <svg>，文字完整
 *   A3 全屏后徽标仍有文字（不是空框）、仍无 <svg>
 *   B1 改 99 → Esc ⇒ 值回原值 + 出现「已放弃本格修改」
 *   B2 进输入态不动 → Esc ⇒ 无 toast、值不变
 *   B3 改→Tab 提交→回该格→Esc ⇒ 仍是提交后的值（不回退到更早），无 toast
 *   C1 913 / C2 780 / C3 660：scrollTop=0 时 wrapBottom 与 totalBarBottom 均 ≤ innerH
 *   C4 660 下勾「仅显示有报单」触发徽标（工具行可能折行）后仍满足 C3
 *   Z9 零页面报错
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v602'
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

/* 第 i 个数据行的第 j 个数量格（含是否在视口内 —— CDP 对视口外坐标派发鼠标会静默无效） */
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

const JS_BADGES = `(() => {
  const row = document.querySelector('.grid-ctl-row')
  if (!row) return JSON.stringify({ ok: false })
  const out = []
  for (const b of row.querySelectorAll('.confirm-badge.filter.filter-act')) {
    const r = b.getBoundingClientRect()
    out.push({ text: (b.textContent || '').trim().slice(0, 24),
      nSvg: b.querySelectorAll('svg').length,
      textLen: (b.textContent || '').trim().length,
      w: +r.width.toFixed(1), h: +r.height.toFixed(1) })
  }
  return JSON.stringify({ ok: true, badges: out })
})()`

const JS_TOASTS = `(() => {
  const ts = [...document.querySelectorAll('.toast .toast-msg')].map(e => (e.textContent || '').trim())
  return JSON.stringify({ ts })
})()`

/* 视口内可见性：滚到页面顶后，表格底边与合计栏底边是否都在视口内 */
const JS_FIT = `(() => {
  const wrap = document.querySelector('.edit-grid-wrap')
  if (!wrap) return JSON.stringify({ ok: false })
  const vw = wrap.closest('.view-wrap')
  if (vw) vw.scrollTop = 0
  const bar = document.querySelector('.col-total-bar')
  const wr = wrap.getBoundingClientRect()
  const br = bar ? bar.getBoundingClientRect() : null
  return JSON.stringify({ ok: true, innerH: window.innerHeight,
    wrapBottom: +wr.bottom.toFixed(1), wrapH: +wr.height.toFixed(1),
    barBottom: br ? +br.bottom.toFixed(1) : null,
    maxH: getComputedStyle(wrap).maxHeight,
    scrollH: vw ? vw.scrollHeight : null, clientH: vw ? vw.clientHeight : null })
})()`

const JS_TOGGLE = (word) => `(() => {
  const l = [...document.querySelectorAll('.grid-ctl-row .tb-toggle')].find(x => (x.textContent||'').includes(${JSON.stringify(word)}))
  if (!l) return JSON.stringify({ ok: false })
  l.querySelector('input').click()
  return JSON.stringify({ ok: true, on: l.querySelector('input').checked })
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
    await sleep(120)
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await sleep(260)
  }
  const key = async (k, code, vk, mod = 0) => {
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod })
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mod })
    await sleep(260)
  }

  await page.goto(BASE, 3500)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 7000)
  await sleep(4500)
  const build = await page.eval(`(() => document.documentElement.dataset.build || '?')()`)
  log('构建号:', build)
  res.z0 = String(build).includes('v602')

  log('进改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(1200)
  log('确认:', await page.eval(JS_CONFIRM))
  await sleep(4500)

  /* ── A1/A2 徽标无图标 ─────────────────────────────────────── */
  const b0 = JSON.parse(await page.eval(JS_BADGES))
  log('A 徽标:', JSON.stringify(b0.badges))
  const b226 = (b0.badges || []).find(b => b.text.includes('另有'))
  res.a1 = !!b226 && b226.nSvg === 0 && b226.text.includes('个在售商品未显示')
  await page.screenshot(OUT + '/A-徽标只留文字.png')

  /* ── B1 改值 → Esc 还原 ───────────────────────────────────── */
  let cell = null
  for (let i = 0; i < 14 && !cell; i++) {
    for (let j = 0; j < 5; j++) {
      const c = JSON.parse(await page.eval(JS_CELL(i, j)))
      if (!c.ok) break
      if (!c.inView) continue
      cell = c; break
    }
  }
  let b1 = false, b2 = false, b3 = false
  if (cell) {
    const v0 = JSON.parse(await page.eval(JS_VAL(cell.dr, cell.dc))).v
    log('B 测试格:', cell.dr + '/' + cell.dc, '| 原值:', JSON.stringify(v0))
    await clickAt(cell.x, cell.y)          // 单击 ⇒ 进输入态并全选
    await page.raw.send('Input.insertText', { text: '99' })
    await sleep(260)
    const v1 = JSON.parse(await page.eval(JS_VAL(cell.dr, cell.dc))).v
    await key('Escape', 'Escape', 27)
    await sleep(420)
    const v2 = JSON.parse(await page.eval(JS_VAL(cell.dr, cell.dc))).v
    const t1 = JSON.parse(await page.eval(JS_TOASTS)).ts
    log('B1 原值', JSON.stringify(v0), '→ 改 99 后', JSON.stringify(v1), '→ Esc 后', JSON.stringify(v2), '| toast:', JSON.stringify(t1))
    b1 = v1 === '99' && v2 === v0 && t1.some(s => s.includes('已放弃本格修改'))
    res.b1 = b1

    /* ── B2 不动内容直接 Esc ⇒ 无 toast ─────────────────────── */
    /* ⚠️「已放弃本格修改」是短文案 ⇒ 非 sticky ⇒ **没有关闭按钮**（.toast-x 只给 sticky 渲染），
       点不掉。等它自然消失（3000 + 8×30 = 3240ms），才能干净地断言"这次没有新 toast"。 */
    await sleep(3700)
    const cleared = JSON.parse(await page.eval(JS_TOASTS)).ts
    await key('F2', 'F2', 113)
    await sleep(300)
    await key('Escape', 'Escape', 27)
    await sleep(420)
    const v3 = JSON.parse(await page.eval(JS_VAL(cell.dr, cell.dc))).v
    const t2 = JSON.parse(await page.eval(JS_TOASTS)).ts
    log('B2 清空后 toast:', JSON.stringify(cleared), '| F2→Esc 后值:', JSON.stringify(v3), '| toast:', JSON.stringify(t2))
    b2 = v3 === v0 && !t2.some(s => s.includes('已放弃本格修改'))
    res.b2 = b2

    /* ── B3 已提交的改动不被 Esc 回退 ───────────────────────── */
    /* ⚠️ 必须换一行（B1 那格已被改成 99 且刚还原，别把它当基线）；
       ⚠️ 每次操作前**重新取坐标** —— Tab 会滚动表格，旧坐标会点到隔壁格（v598 踩过）。 */
    const cv = JSON.parse(await page.eval(JS_CELL(1, 0)))
    if (cv.ok && cv.inView) {
      await clickAt(cv.x, cv.y)
      await page.raw.send('Input.insertText', { text: '77' })
      await sleep(240)
      await key('Tab', 'Tab', 9)            // 提交并下移
      await sleep(420)
      const vc = JSON.parse(await page.eval(JS_VAL(cv.dr, cv.dc))).v
      const cv2 = JSON.parse(await page.eval(JS_CELL(1, 0)))   // 重取坐标
      await clickAt(cv2.x, cv2.y)
      await sleep(240)
      await key('Escape', 'Escape', 27)
      await sleep(420)
      const vc2 = JSON.parse(await page.eval(JS_VAL(cv.dr, cv.dc))).v
      const t3 = JSON.parse(await page.eval(JS_TOASTS)).ts
      log('B3 提交后值:', JSON.stringify(vc), '| 回格 Esc 后:', JSON.stringify(vc2),
        '| toast:', JSON.stringify(t3), '| 格:', cv.dr + '/' + cv.dc)
      b3 = vc === '77' && vc2 === '77' && !t3.some(s => s.includes('已放弃本格修改'))
      res.b3 = b3
    } else log('B3 找不到可用格，跳过')
  } else log('B 找不到视口内的数量格')

  /* ── A2/A3 零报单徽标 + 全屏 ─────────────────────────────── */
  await page.eval(JS_TOGGLE('仅显示有报单'))
  await sleep(1500)
  const b1b = JSON.parse(await page.eval(JS_BADGES))
  const z = (b1b.badges || []).find(b => b.text.includes('零报单'))
  log('A2 零报单徽标:', JSON.stringify(z))
  res.a2 = !!z && z.nSvg === 0 && z.text.includes('个零报单')
  await page.screenshot(OUT + '/A2-零报单仅文字.png')
  /* 复原：取消「仅显示有报单」，让行数回到全量 —— 否则表格只有 132px 高，
     C 那三档等于在"矮表格"上测，验不到"撑满 maxHeight 时底边是否越界"。 */
  await page.eval(JS_TOGGLE('仅显示有报单'))
  await sleep(1600)

  /* 全屏：徽标不能变成空框 */
  await page.eval(`(() => { const b = document.querySelector('.grid-fs-btn'); if (b) b.click(); return 1 })()`)
  await sleep(1400)
  const bFs = JSON.parse(await page.eval(JS_BADGES))
  log('A3 全屏徽标:', JSON.stringify(bFs.badges))
  res.a3 = (bFs.badges || []).length > 0 && bFs.badges.every(b => b.nSvg === 0 && b.textLen >= 4)
  await page.screenshot(OUT + '/A3-全屏徽标有文字.png')
  await key('Escape', 'Escape', 27)   // 退出全屏
  await sleep(1200)

  /* ── C 高度自适应：三档视口 ─────────────────────────────── */
  const fitOf = async (h) => {
    await page.raw.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: h, deviceScaleFactor: 1, mobile: false })
    await sleep(1100)
    const f = JSON.parse(await page.eval(JS_FIT))
    log(`C 视口 ${h}:`, JSON.stringify(f))
    return f
  }
  const c1 = await fitOf(913)
  const c2 = await fitOf(780)
  const c3 = await fitOf(660)
  const okFit = (f) => f.ok && f.wrapBottom <= f.innerH + 1 && (f.barBottom == null || f.barBottom <= f.innerH + 1)
  res.c1 = okFit(c1); res.c2 = okFit(c2); res.c3 = okFit(c3)
  await page.screenshot(OUT + '/C-660视口.png')

  /* ── C4 徽标折行后仍贴合 ─────────────────────────────────── */
  await page.eval(JS_TOGGLE('仅显示有报单'))   // 勾上 ⇒ 出现「已隐藏 N 个零报单」⇒ 工具行可能折行
  await sleep(1800)
  const c4 = JSON.parse(await page.eval(JS_FIT))
  const bArr = JSON.parse(await page.eval(JS_BADGES))
  log('C4 660 徽标折行后:', JSON.stringify(c4), '| 徽标:', JSON.stringify(bArr.badges))
  res.c4 = okFit(c4)
  await page.screenshot(OUT + '/C4-徽标折行后.png')

  await page.raw.send('Emulation.clearDeviceMetricsOverride')
  res.z9 = (page.errors || []).length === 0
  log('Z9 页面报错:', JSON.stringify(page.errors || []))

  for (const k of ['z0', 'a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3', 'c4', 'z9'])
    log(k.toUpperCase(), res[k] ? 'PASS' : 'FAIL')
  log('汇总:', Object.values(res).every(Boolean) ? 'ALL PASS' : 'HAS FAIL')
} catch (e) {
  console.error('探针异常:', e && e.message)
} finally {
  try { await browser.close() } catch (e) {}
}
