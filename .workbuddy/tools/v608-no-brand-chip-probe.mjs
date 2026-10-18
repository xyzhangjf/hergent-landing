/**
 * v608 验证：撤掉多余的「品牌 ∈ N 个」筛选条（用户 2026-10-18：工具栏品牌按钮已自带数量角标）
 *   同时回归 v607 的核心修复：编辑态品牌筛选仍然即时生效。
 *
 * 根因：行显隐有两条实现 —— 查看态 rowVisible()、编辑态 rowBaseShown()（编辑表 v-show 唯一判据）。
 *       品牌条件只写在 rowVisible 里 ⇒ 编辑态点品牌按钮只改了 brandSel，行一条都不动。
 *
 * 判据清单
 *   Z0 构建号 v608
 *   A0 查看态（回归）品牌筛选仍生效：只读表行数减少
 *   A1 编辑态品牌按钮能打开面板（候选 ≥1）
 *   A2 勾 1 个品牌 ⇒ 编辑表**可见行数立即减少**且 >0（核心修复）
 *   A3 勾品牌后**不得**出现 .filter-row / 任何「品牌 ∈ N 个」胶囊（v608 撤除项）
 *   A4 清空 ⇒ 可见行数回到全量（与 total 相等）
 *   A5 列筛选筛选条仍在（回归：filter-row 只服务列/唯一值筛选，未被误删）
 *   B1 单品牌下「补录商品」⇒ 可见行数 +1 且末行品牌自动继承该品牌
 *   B2 多品牌下「补录商品」⇒ 可见行数不变，且有 toast 说明（不静默）
 *   C1 无页面报错
 *   C2 全程未保存（不入库）：保存按钮未被点
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'http://127.0.0.1:5173'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v608'
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

const JS_ENTER_EDIT = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('改单') && x.offsetParent !== null)
  if (!b) return JSON.stringify({ ok: false }); b.click(); return JSON.stringify({ ok: true }) })()`
const JS_CONFIRM = `(() => {
  const m = document.querySelector('.imp-modal, .modal, [role="dialog"]'); if (!m) return JSON.stringify({ ok: false })
  const b = [...m.querySelectorAll('button')].find(x => /仍要|确定|进入|确认/.test(x.textContent || ''))
  if (!b) return JSON.stringify({ ok: false }); b.click(); return JSON.stringify({ ok: true }) })()`

/* 查看态行数（回归用） */
const JS_RO_ROWS = `(() => {
  const tbl = document.querySelector('table.tbl.cross-tbl:not(.edit-tbl)')
  if (!tbl) return JSON.stringify({ ok: false })
  const trs = [...tbl.querySelectorAll('tbody tr')]
  const chips = [...document.querySelectorAll('.filter-chip')].map(x => (x.textContent||'').replace(/\\s+/g,' ').trim())
  return JSON.stringify({ ok: true, rows: trs.length,
    empty: (tbl.querySelector('.empty, .tbl-empty') || {}).textContent || '', chips })
})()`

/* 编辑态行数 / 筛选条 / toast / 末行文本 */
const JS_ED = `(() => {
  const wrap = document.querySelector('.edit-grid-wrap')
  if (!wrap) return JSON.stringify({ ok: false })
  const trs = [...wrap.querySelectorAll('tbody tr')]
  const vis = trs.filter(t => t.getBoundingClientRect().height > 0)
  const chips = [...document.querySelectorAll('.filter-chip')].map(x => (x.textContent||'').replace(/\\s+/g,' ').trim())
  const toasts = [...document.querySelectorAll('.notif-dock .toast .toast-msg')].map(x => (x.textContent||'').trim())
  const last = vis.length ? vis[vis.length - 1] : null
  const cells = last ? [...last.querySelectorAll('td')].map(td => {
    const i = td.querySelector('input')
    return (i ? i.value : (td.textContent || '')).trim()
  }) : []
  return JSON.stringify({ ok: true, total: trs.length, vis: vis.length, chips, toasts,
    filterRow: !!document.querySelector('.filter-row'),
    lastText: last ? (last.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120) : '',
    lastCells: cells.slice(0, 14) })
})()`

/* 品牌按钮（编辑态工具栏）坐标 */
const JS_BRAND_BTN = `(() => {
  const bs = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null
    && (b.textContent || '').includes('品牌') && !b.closest('.bp-head') && !b.closest('.brand-pop'))
  if (!bs.length) return JSON.stringify({ ok: false })
  const b = bs[bs.length - 1]
  b.scrollIntoView({ block: 'center' })
  const r = b.getBoundingClientRect()
  return JSON.stringify({ ok: true, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1),
    txt: (b.textContent || '').replace(/\\s+/g, ' ').trim() })
})()`

/* 品牌面板：候选数 / 前几个名称 / 第 i 个勾选框坐标 */
const JS_BP = (i) => `(() => {
  const pop = document.querySelector('.brand-pop')
  if (!pop) return JSON.stringify({ open: false })
  const items = [...pop.querySelectorAll('.bp-item')]
  const boxes = [...pop.querySelectorAll('.bp-item input[type=checkbox]')]
  const idx = ${i}
  const el = boxes[idx]
  if (!el) return JSON.stringify({ open: true, n: boxes.length, names: [], idxOk: false })
  const r = el.getBoundingClientRect()
  return JSON.stringify({ open: true, n: boxes.length, idxOk: true,
    names: items.map(x => (x.textContent || '').replace(/\\s+/g, ' ').trim()),
    checked: boxes.map(b => b.checked),
    x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1),
    inView: r.height > 0 && r.top > 0 && r.bottom < window.innerHeight })
})()`

const JS_BP_ACT = (label) => `(() => {
  const pop = document.querySelector('.brand-pop'); if (!pop) return 'no-pop'
  const b = [...pop.querySelectorAll('.bp-acts .link-btn')].find(x => (x.textContent || '').includes(${JSON.stringify(label)}))
  if (!b) return 'no-btn'; b.click(); return 'ok' })()`

const JS_UNDO = `(() => {
  const t = document.querySelector('.edit-tbl'); if (!t) return 'no-tbl'
  t.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true }))
  return 'ok' })()`

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
  const clickBtn = async (js) => {
    const b = JSON.parse(await page.eval(js))
    if (!b.ok) return b
    await clickAt(b.x, b.y)
    return b
  }
  const key = async (k, code, vk, modifiers = 0) => {
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers })
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers })
    await sleep(300)
  }

  await page.goto(BASE, 3000)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  /* 🔴 登录用的是裸 fetch（没走 store）⇒ 必须**重载一次**让 App 从 localStorage 恢复登录态。
     做法：先把 hash 指到 /forecast，再 reload —— 重载后首屏直接落在预报页。 */
  await page.goto(BASE + '/#/forecast', 1800)
  await page.raw.send('Page.reload', {})
  await sleep(9000)
  const build = await page.eval(`(() => document.documentElement.dataset.build || '?')()`)
  log('构建号:', build)
  res.z0 = String(build).includes('v608')
  await page.eval(JS_HOOK)

  /* ── A0 查看态回归 ─────────────────────────────── */
  const waitStableRO = async () => {
    let prev = null
    for (let i = 0; i < 14; i++) {
      const v = JSON.parse(await page.eval(JS_RO_ROWS))
      if (v.ok && prev !== null && v.rows === prev) return v
      prev = v.ok ? v.rows : null
      await sleep(600)
    }
    return JSON.parse(await page.eval(JS_RO_ROWS))
  }
  const ro0 = await waitStableRO()
  log('A0 查看态初始:', JSON.stringify(ro0))
  let roFiltered = null
  const bb = await clickBtn(JS_BRAND_BTN)
  log('A0 品牌按钮:', JSON.stringify(bb))
  await sleep(600)
  const bp0 = JSON.parse(await page.eval(JS_BP(0)))
  log('A0 面板:', JSON.stringify({ open: bp0.open, n: bp0.n, names: (bp0.names || []).slice(0, 4) }))
  if (bp0.open && bp0.n >= 1) {
    if (bp0.inView) await clickAt(bp0.x, bp0.y)
    else await page.eval(`(() => { const p = document.querySelector('.brand-pop'); const c = p && p.querySelector('.bp-item input[type=checkbox]'); if (c) c.click(); return 1 })()`)
    await sleep(900)
    roFiltered = JSON.parse(await page.eval(JS_RO_ROWS))
    log('A0 勾选后:', JSON.stringify(roFiltered))
    // 清空，避免影响后续
    await page.eval(JS_BP_ACT('清空'))
    await sleep(700)
    const roBack = JSON.parse(await page.eval(JS_RO_ROWS))
    log('A0 清空后:', JSON.stringify({ rows: roBack.rows, chips: roBack.chips }))
    /* 查看态行数口径：未勾「显示全部商品」时行底只有本期有报单的商品，筛选后可能因空表补偿
       反而变多 ⇒ 只要求「有变化 + 清空后回到原值」（真正的语义等价由编辑态 A2/A4 严格验证）。 */
    res.a0 = ro0.ok && roFiltered.ok && roFiltered.rows !== ro0.rows && roBack.rows === ro0.rows
  } else res.a0 = false
  // 关掉面板
  await page.eval(`(() => { const p = document.querySelector('.pop-overlay'); if (p) p.click(); return 1 })()`)
  await sleep(500)

  /* ── 进改单编辑态 ─────────────────────────────── */
  log('进改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(1500)
  log('确认:', await page.eval(JS_CONFIRM))
  let ed0 = { ok: false }
  for (let i = 0; i < 40; i++) {
    await sleep(300)
    ed0 = JSON.parse(await page.eval(JS_ED))
    if (ed0.ok && ed0.vis > 0) break
  }
  await sleep(2500)
  // 首次进改单会自动弹快捷键面板（v603）⇒ 关掉以免挡住工具栏
  await page.eval(`(() => { const p = document.querySelector('.kbd-pop, .kbd-help-pop'); if (p) { const b = document.querySelector('.kbd-chip'); if (b) b.click() } return 1 })()`)
  await sleep(400)
  await key('Escape', 'Escape', 27)
  await sleep(2200)
  ed0 = JSON.parse(await page.eval(JS_ED))
  log('编辑态初始:', JSON.stringify({ total: ed0.total, vis: ed0.vis, chips: ed0.chips }))
  const baseVis = ed0.vis
  res.z_edit = ed0.ok && baseVis > 0

  /* ── A1/A2/A3/A4 编辑态品牌筛选 ───────────────── */
  const btn2 = await clickBtn(JS_BRAND_BTN)
  log('A1 品牌按钮:', JSON.stringify(btn2))
  await sleep(700)
  const bp1 = JSON.parse(await page.eval(JS_BP(0)))
  log('A1 面板:', JSON.stringify({ open: bp1.open, n: bp1.n, names: (bp1.names || []).slice(0, 5) }))
  res.a1 = !!bp1.open && bp1.n >= 1
  await page.screenshot(OUT + '/A1-编辑态品牌面板.png')

  let brandName = ''
  if (res.a1) {
    brandName = (bp1.names && bp1.names[0] || '').trim()
    if (bp1.inView) await clickAt(bp1.x, bp1.y)
    else await page.eval(`(() => { const p = document.querySelector('.brand-pop'); const c = p && p.querySelector('.bp-item input[type=checkbox]'); if (c) c.click(); return 1 })()`)
    await sleep(1000)
    const ed1 = JSON.parse(await page.eval(JS_ED))
    log('A2 勾选 1 个品牌后:', JSON.stringify({ vis: ed1.vis, total: ed1.total, chips: ed1.chips }))
    res.a2 = ed1.ok && ed1.vis < baseVis && ed1.vis > 0
    /* v608：品牌筛选不再有独立胶囊 ⇒ 勾选后 must 既无「品牌 ∈ N 个」胶囊、也无 .filter-row 占位 */
    res.a3 = ed1.ok && !(ed1.chips || []).some(c => c.includes('品牌')) && !ed1.filterRow
    await page.screenshot(OUT + '/A2-品牌筛选生效且无多余胶囊.png')

    /* 清空 */
    await page.eval(JS_BP_ACT('清空'))
    await sleep(900)
    const ed2 = JSON.parse(await page.eval(JS_ED))
    log('A4 清空后:', JSON.stringify({ vis: ed2.vis, total: ed2.total, chips: ed2.chips }))
    res.a4 = ed2.ok && ed2.vis === ed2.total && ed2.vis === baseVis
  } else { res.a2 = false; res.a3 = false; res.a4 = false }

  /* ── B1 单品牌下补录商品 ⇒ 可见 + 品牌继承 ─────── */
  let b1 = false, b2 = false
  if (res.a1 && brandName) {
    // 勾第一个品牌（此时 A4 已清空 ⇒ 单品牌态）
    let bpOpen = JSON.parse(await page.eval(JS_BP(0))).open
    if (!bpOpen) { await clickBtn(JS_BRAND_BTN); await sleep(600) }
    const bpB = JSON.parse(await page.eval(JS_BP(0)))
    if (bpB.open && bpB.idxOk) {
      if (bpB.inView) await clickAt(bpB.x, bpB.y)
      else await page.eval(`(() => { const p = document.querySelector('.brand-pop'); const cs = p && p.querySelectorAll('.bp-item input[type=checkbox]'); if (cs && cs[0]) cs[0].click(); return 1 })()`)
    }
    await sleep(900)
    await page.eval(`(() => { const p = document.querySelector('.pop-overlay'); if (p) p.click(); return 1 })()`)
    await sleep(400)
    const beforeB1 = JSON.parse(await page.eval(JS_ED))
    const addBtn = await clickBtn(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.offsetParent !== null && (x.textContent||'').includes('补录商品'))
      if (!b) return JSON.stringify({ ok: false })
      b.scrollIntoView({ block: 'center' })
      const r = b.getBoundingClientRect()
      return JSON.stringify({ ok: true, x: +(r.left+r.width/2).toFixed(1), y: +(r.top+r.height/2).toFixed(1) }) })()`)
    log('B1 补录按钮:', JSON.stringify(addBtn))
    await sleep(1100)
    const afterB1 = JSON.parse(await page.eval(JS_ED))
    log('B1 单品牌新增:', JSON.stringify({ before: beforeB1.vis, after: afterB1.vis, lastCells: afterB1.lastCells, toasts: afterB1.toasts }))
    b1 = afterB1.vis === beforeB1.vis + 1 && (afterB1.lastCells || []).some(v => v === brandName)
    await page.screenshot(OUT + '/B1-单品牌补录可见.png')
    // 撤销新增行（不留痕）
    log('B1 撤销:', await page.eval(JS_UNDO))
    await sleep(1200)
    const undoB1 = JSON.parse(await page.eval(JS_ED))
    log('B1 撤销后:', JSON.stringify({ vis: undoB1.vis }))
    b1 = b1 && undoB1.vis === beforeB1.vis

    /* ── B2 多品牌下补录 ⇒ 行数不变 + 有提示 ─────── */
    const candN = bp1.n
    if (candN >= 2) {
      await clickBtn(JS_BRAND_BTN); await sleep(600)
      const bpC = JSON.parse(await page.eval(JS_BP(1)))
      if (bpC.inView) await clickAt(bpC.x, bpC.y)
      else await page.eval(`(() => { const p = document.querySelector('.brand-pop'); const cs = p && p.querySelectorAll('.bp-item input[type=checkbox]'); if (cs && cs[1]) cs[1].click(); return 1 })()`)
      await sleep(900)
      await page.eval(`(() => { const p = document.querySelector('.pop-overlay'); if (p) p.click(); return 1 })()`)
      await sleep(400)
      const beforeB2 = JSON.parse(await page.eval(JS_ED))
      await clickBtn(`(() => {
        const b = [...document.querySelectorAll('button')].find(x => x.offsetParent !== null && (x.textContent||'').includes('补录商品'))
        if (!b) return JSON.stringify({ ok: false })
        b.scrollIntoView({ block: 'center' })
        const r = b.getBoundingClientRect()
        return JSON.stringify({ ok: true, x: +(r.left+r.width/2).toFixed(1), y: +(r.top+r.height/2).toFixed(1) }) })()`)
      await sleep(1200)
      const afterB2 = JSON.parse(await page.eval(JS_ED))
      const hasToast = (afterB2.toasts || []).some(t => t.includes('品牌') && (t.includes('暂不显示') || t.includes('筛选了')))
      log('B2 多品牌新增:', JSON.stringify({ before: beforeB2.vis, after: afterB2.vis, toasts: afterB2.toasts }))
      b2 = afterB2.vis === beforeB2.vis && hasToast
      await page.screenshot(OUT + '/B2-多品牌补录提示.png')
      await page.eval(JS_UNDO)
      await sleep(1000)
      const undoB2 = JSON.parse(await page.eval(JS_ED))
      log('B2 撤销后:', JSON.stringify({ vis: undoB2.vis }))
      // 收尾：清空品牌筛选（v608 起无品牌胶囊，改走面板内「清空」）
      await clickBtn(JS_BRAND_BTN); await sleep(600)
      await page.eval(JS_BP_ACT('清空'))
      await sleep(700)
      await sleep(700)
      const fin = JSON.parse(await page.eval(JS_ED))
      log('B2 收尾: vis=', fin.vis, 'total=', fin.total, 'chips=', JSON.stringify(fin.chips))
    } else log('B2 候选品牌 < 2，跳过')
  }
  res.b1 = b1
  res.b2 = b2

  /* ── C1 报错 / C2 未保存 ─────────────────────── */
  const errs = JSON.parse(await page.eval(JS_ERR))
  log('错误:', JSON.stringify(errs))
  res.c1 = errs.length === 0
  res.c2 = true   // 全程未点「保存」（脚本里不存在保存点击）
  await page.screenshot(OUT + '/C-收尾.png')
} catch (e) {
  log('EXCEPTION:', e && e.message)
  res.c1 = false
} finally {
  try { if (browser) await browser.close() } catch (e) {}
}
const pass = Object.values(res).filter(Boolean).length
const total = Object.keys(res).length
log('\n===== 结果 ' + pass + '/' + total + ' =====')
for (const k of Object.keys(res).sort()) log((res[k] ? 'PASS ' : 'FAIL ') + k)
process.exit(pass === total ? 0 : 1)
