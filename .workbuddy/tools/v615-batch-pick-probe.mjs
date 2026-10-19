/**
 * v615 验证：序号列复选框 + 工具栏「批量操作」（批量上架 / 批量撤下）。
 *
 * 用户的设计（本轮原话）：
 *   「在序号前面加一个复选框，可单选可多选，可通过品牌筛选，选中后做一个「批量操作」按钮，
 *    里面有批量上架和批量下架入口，点击后即完成上架或下架」
 *
 * 为什么换掉 v613/v614：那两个按钮的主语是「当前筛选出的全部行」——
 *   · 撤某品牌会连带撤掉**原本就在清单里**的同品牌商品；
 *   · 按钮数 = 候选总数（实测 156），手滑一下就是一次大批量动作，无法逐项复核。
 *   复选框把主语还给用户：筛选只决定「哪些行能被勾到」。
 *
 * 判据
 *   Z0 构建号 v615
 *   Z1 查看态就绪（有行、不在编辑态）
 *   S0 清单条数 == 改单网格行数（对齐，否则中止不写任何数据）
 *   A0 查看态**没有**复选框（只读收口不被破坏：v611 之后查看态不含任何可编辑控件）
 *   A1 编辑态每行都有复选框，且行高仍是 21±1（新增控件不得顶高数据行）
 *   A2 表头有全选复选框
 *   A3 真点 1 行复选框 → 工具栏出现「批量操作」，角标 = 1，且**没有**误触整行选择（无 .row-sel）
 *   A4 点开面板 → 两个条目 + 已选计数 1
 *   A5 点表头全选 → 角标 = 当前可见行数
 *   A6 再点表头 → 角标 0，按钮消失
 *   B1 搜索唯一商品 → 勾它 → 面板里「撤下」候选 = 1
 *   B2 执行撤下 → toast 含「小程序商品清单：移除 1 个」
 *   B3 fill-search 条数 = 基线 − 1 且不含该商品
 *   B4 该商品档案未被污染（spec/unit/sale_price 逐字一致）
 *   C1 勾一个「本期有报单数量」的行 → 撤下候选为 0（防 qty>0 自动加回），面板写明被跳过
 *   B5 复原：显示全部商品 → 搜该商品 → 勾选 → 批量上架 → 清单回基线
 *   D1 全程零页面报错
 *
 * ⚠️ 真实写入范围：只动 1 个商品（撤下 + 复原），且挑「名称唯一 + 数量全 0」的，
 *    不碰任何有报单数量的行。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v615'
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

const JS_HOOK = `(() => { if (window.__HG_ERRS__) return 1; window.__HG_ERRS__ = [];
  window.addEventListener('error', e => window.__HG_ERRS__.push('err:' + (e.message || '')));
  window.addEventListener('unhandledrejection', e => window.__HG_ERRS__.push('rej:' + (e.reason && e.reason.message || e.reason)));
  return 1 })()`
const JS_ERR = `(() => JSON.stringify(window.__HG_ERRS__ || []))()`

const JS_TOASTS = `(() => JSON.stringify([...document.querySelectorAll('.notif-dock .toast .toast-msg')]
  .map(x => (x.textContent || '').trim())))()`

const JS_GET = (url) => `(async () => {
  const t = localStorage.getItem('hergent_v2_token') || ''
  const r = await fetch(${JSON.stringify(url)}, { headers: { Authorization: 'Bearer ' + t } })
  let d = null
  try { d = await r.json() } catch (e) { d = null }
  return JSON.stringify({ s: r.status, d: d })
})()`

/* fill-search 的 limit 被后端 cap 到 200（data.py: min(limit,200)），本期 294 条 ⇒ 必须分页。 */
const JS_LIST_ALL = (pid) => `(async () => {
  const t = localStorage.getItem('hergent_v2_token') || ''
  let off = 0, all = [], total = -1
  for (let i = 0; i < 20; i++) {
    const r = await fetch('/api/products/fill-search?period_id=${pid}&limit=200&offset=' + off,
      { headers: { Authorization: 'Bearer ' + t } })
    let d = null
    try { d = await r.json() } catch (e) { d = null }
    const items = (d && (d.items || d.products)) || []
    if (total < 0) total = Number((d && d.total) || items.length)
    all = all.concat(items.map(x => ({ id: Number(x.id), name: String(x.name || '') })))
    off += items.length
    if (!items.length || off >= total) break
  }
  return JSON.stringify({ total, got: all.length, items: all })
})()`

const JS_PICK_PERIOD = `(() => {
  const t = localStorage.getItem('hergent_v2_token') || ''
  return fetch('/api/forecast/periods', { headers: { Authorization: 'Bearer ' + t } })
    .then(r => r.json()).then(d => {
      const list = (d && (d.items || d.periods || d)) || []
      const today = new Date().toISOString().slice(0, 10)
      const arr = Array.isArray(list) ? list : []
      const open = arr.filter(p => String(p.status || '') === 'open')
      const inWin = open.filter(p => (p.order_start || '') <= today && (p.order_end || '') >= today)
      const pick = inWin[0] || open[0] || null
      return JSON.stringify({ ok: !!pick, n: arr.length, open: open.length,
        id: pick && pick.id, start: pick && pick.order_start, end: pick && pick.order_end,
        status: pick && pick.status })
    })
})()`

const JS_VIEW_ROWS = `(() => {
  const tbl = document.querySelector('table.tbl.cross-tbl:not(.edit-tbl)')
  return JSON.stringify({ ok: !!tbl, rows: tbl ? tbl.querySelectorAll('tbody tr').length : 0,
    inEdit: !!document.querySelector('.edit-tbl'),
    picks: tbl ? tbl.querySelectorAll('.row-pick').length : 0 })
})()`

/* 编辑网格骨架：总行 / 可见行 / 复选数 / 表头复选 / 行高 */
const JS_EDIT_ROWS = `(() => {
  const wrap = document.querySelector('.edit-grid-wrap'); if (!wrap) return JSON.stringify({ ok: false })
  const trs = [...wrap.querySelectorAll('tbody tr')]
  const vis = trs.filter(t => t.getBoundingClientRect().height > 0)
  const pickTotal = wrap.querySelectorAll('tbody tr .row-pick').length
  const hd = wrap.querySelector('thead .seq-th .row-pick')
  const rowH = vis.length ? +vis[0].getBoundingClientRect().height.toFixed(1) : 0
  return JSON.stringify({ ok: true, total: trs.length, vis: vis.length,
    pickTotal, hasHd: !!hd, rowH })
})()`

const JS_ENTER_EDIT = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('改单') && x.offsetParent !== null)
  if (!b) return JSON.stringify({ ok: false }); b.click(); return JSON.stringify({ ok: true }) })()`

const JS_CONFIRM_OK = `(() => {
  const b = document.querySelector('.ui-cd-danger')
    || [...document.querySelectorAll('.imp-modal button, .modal button, [role="dialog"] button')]
        .find(x => /仍要|确定|确认|删除|进入|撤下|上架/.test(x.textContent || ''))
  if (!b) return JSON.stringify({ ok: false })
  if (b.disabled) return JSON.stringify({ ok: false, why: 'disabled' })
  b.click(); return JSON.stringify({ ok: true }) })()`

const JS_CD_TEXT = `(() => {
  const e = document.querySelector('.ui-cd-text')
  const title = document.querySelector('.ui-cd-title')
  return JSON.stringify({ ok: !!e, text: e ? e.textContent : '', title: title ? title.textContent : '' })
})()`

const JS_SHOW_ALL = `(() => {
  const lab = [...document.querySelectorAll('label.tb-toggle')].find(l => (l.textContent || '').includes('显示全部商品'))
  if (!lab) return JSON.stringify({ ok: false, why: 'no-label' })
  const inp = lab.querySelector('input[type=checkbox]')
  if (!inp) return JSON.stringify({ ok: false, why: 'no-input' })
  if (!inp.checked) inp.click()
  return JSON.stringify({ ok: true, checked: inp.checked })
})()`

const JS_SET_FIND = (txt) => `(() => {
  const el = document.getElementById('gridFind')
  if (!el) return JSON.stringify({ ok: false, why: 'no-find' })
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  el.focus(); setter.call(el, ${JSON.stringify(txt)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.blur()
  return JSON.stringify({ ok: true, val: el.value })
})()`

/* 「批量操作」按钮状态 */
const JS_BATCH_BTN = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('批量操作'))
  if (!b) return JSON.stringify({ ok: false })
  const badge = b.querySelector('.btn-badge')
  const r = b.getBoundingClientRect()
  return JSON.stringify({ ok: true, n: badge ? Number(String(badge.textContent).trim()) : 0,
    disabled: !!b.disabled, h: +r.height.toFixed(1),
    x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) })
})()`

/* 面板内容：两个条目的候选数 + 提示文案 */
const JS_BATCH_PANEL = `(() => {
  const p = document.querySelector('.batch-pop')
  if (!p) return JSON.stringify({ ok: false })
  const items = [...p.querySelectorAll('.batch-item')].map(b => ({
    label: (b.querySelector('.bi-t') || {}).textContent || '',
    n: Number(((b.querySelector('b') || {}).textContent || '0').trim()),
    disabled: !!b.disabled,
    x: 0, y: 0,
  }))
  const rects = [...p.querySelectorAll('.batch-item')].map(b => {
    const r = b.getBoundingClientRect()
    return { x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) }
  })
  items.forEach((it, i) => { it.x = rects[i].x; it.y = rects[i].y })
  return JSON.stringify({ ok: true, n: items.length, items,
    head: (p.querySelector('.bp-head') || {}).textContent || '',
    tips: [...p.querySelectorAll('.bp-tip')].map(t => (t.textContent || '').trim()) })
})()`

/* 第 idx 个可见行复选框的坐标 + 该行名称/是否有数量 */
const JS_ROW_PICK_RECT = (idx) => `(() => {
  const wrap = document.querySelector('.edit-grid-wrap'); if (!wrap) return JSON.stringify({ ok: false })
  const trs = [...wrap.querySelectorAll('tbody tr')].filter(t => t.getBoundingClientRect().height > 0)
  const t = trs[${idx}]
  if (!t) return JSON.stringify({ ok: false, why: 'no-row', vis: trs.length })
  const cb = t.querySelector('.row-pick')
  if (!cb) return JSON.stringify({ ok: false, why: 'no-pick' })
  const r = cb.getBoundingClientRect()
  const nm = t.querySelector('input.cell-name')
  const qtys = [...t.querySelectorAll('input.cell-qty')].map(i => (i.value || '').trim())
  const pos = qtys.filter(v => v !== '' && v !== '0' && Number(v) > 0)
  return JSON.stringify({ ok: true, vis: trs.length,
    x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1),
    name: nm ? nm.value.trim() : '', posQty: pos.length, checked: cb.checked })
})()`

const JS_HDR_PICK_RECT = `(() => {
  const cb = document.querySelector('.edit-grid-wrap thead .seq-th .row-pick')
  if (!cb) return JSON.stringify({ ok: false })
  const r = cb.getBoundingClientRect()
  return JSON.stringify({ ok: true, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1),
    checked: cb.checked, indeterminate: !!cb.indeterminate })
})()`

/* 选中行里是否有「整行被铺蓝」（误触行轴选择） */
const JS_ROW_SEL_COUNT = `(() => {
  const wrap = document.querySelector('.edit-grid-wrap')
  return JSON.stringify({ ok: !!wrap, n: wrap ? wrap.querySelectorAll('tbody tr.row-sel').length : 0 })
})()`

/* 全表统计：可见行里「有正数量」且名字唯一的行（不硬编码商品名 —— 档案名与报单快照名可能不同字） */
const JS_VIS_STAT = `(() => {
  const wrap = document.querySelector('.edit-grid-wrap'); if (!wrap) return JSON.stringify({ ok: false })
  const trs = [...wrap.querySelectorAll('tbody tr')].filter(t => t.getBoundingClientRect().height > 0)
  const info = trs.map(t => {
    const nm = t.querySelector('input.cell-name')
    const name = nm ? nm.value.trim() : ''
    const qtys = [...t.querySelectorAll('input.cell-qty')].map(i => (i.value || '').trim())
    const pos = qtys.some(v => v !== '' && v !== '0' && Number(v) > 0)
    return { name, pos }
  })
  const freq = {}
  info.forEach(x => { if (x.name) freq[x.name] = (freq[x.name] || 0) + 1 })
  const hot = info.filter(x => x.pos).map(x => x.name).filter(Boolean)
  const uniq = hot.filter(n => freq[n] === 1)
  return JSON.stringify({ ok: true, vis: trs.length, withQty: hot.length, uniq: uniq.length,
    names: (uniq.length ? uniq : hot).slice(0, 6) })
})()`

const JS_SAVE_CLICK = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '保存' && x.offsetParent !== null)
  if (!b) return JSON.stringify({ ok: false, why: 'no-btn' })
  if (b.disabled) return JSON.stringify({ ok: false, why: 'disabled' })
  b.click(); return JSON.stringify({ ok: true })
})()`

let browser
const log = (...a) => console.log(...a)
const res = {}
const fail = []
const chk = (name, cond, detail = '') => {
  res[name] = !!cond
  if (cond) log('PASS', name, detail)
  else { fail.push(name); log('FAIL', name, detail) }
}

/* 真派发鼠标事件（CDP）：`.click()` 不会走 mousedown，测不出「点复选框会不会连带选整行」。 */
async function realClick (page, x, y) {
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

async function collectToasts (page, ms = 9000) {
  const seen = new Set()
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const arr = JSON.parse(await page.eval(JS_TOASTS))
    arr.forEach(t => seen.add(t))
    if (seen.size) break
    await sleep(250)
  }
  return [...seen]
}

async function waitEdit (page, minTotal = 1, tries = 18) {
  let ed = { ok: false }
  for (let i = 0; i < tries; i++) {
    ed = JSON.parse(await page.eval(JS_EDIT_ROWS))
    if (ed.ok && ed.total >= minTotal) break
    await sleep(700)
  }
  return ed
}

try {
  fs.mkdirSync(OUT, { recursive: true })
  const isLocal = /127\.0\.0\.1|localhost/.test(BASE)
  browser = await launch(isLocal ? { extraArgs: ['--no-proxy-server'] } : {})
  const page = await browser.newPage()
  await page.enable()

  await page.goto(BASE, 3000)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 1800)
  await page.raw.send('Page.reload', {})
  await sleep(9000)
  const build = await page.eval(`(() => document.documentElement.dataset.build || '?')()`)
  log('构建号:', build)
  chk('Z0', String(build).includes('v615'), String(build))
  await page.eval(JS_HOOK)

  let v = { ok: false }
  for (let i = 0; i < 16; i++) {
    v = JSON.parse(await page.eval(JS_VIEW_ROWS))
    if (v.ok && v.rows > 0) break
    await sleep(700)
  }
  chk('Z1', v.ok && v.rows > 0 && !v.inEdit, JSON.stringify(v))
  /* A0：查看态只读收口（v611）不得被本轮新增控件破坏 —— 查看态存在任何 .row-pick 即回归 */
  chk('A0', v.ok && v.picks === 0, `view picks=${v.picks}`)

  const per = JSON.parse(await page.eval(JS_PICK_PERIOD))
  log('期次:', JSON.stringify(per))
  if (!per.ok) throw new Error('没有可用的进行中期次，中止（不写任何数据）')

  const fsBaseJ = JSON.parse(await page.eval(JS_LIST_ALL(per.id)))
  const baseItems = fsBaseJ.items || []
  const baseTotal = Number(fsBaseJ.total || baseItems.length)
  const baseIds = baseItems.map(x => Number(x.id))
  log('清单基线:', baseTotal, '条（实拉', baseIds.length, '）')
  if (!baseIds.length) throw new Error('清单为空，无法验证撤下')
  if (baseIds.length !== baseTotal) throw new Error(`清单分页未拉全（${baseIds.length}/${baseTotal}），中止`)

  const gridJ = JSON.parse(await page.eval(JS_GET('/api/products/grid')))
  const allProds = (gridJ.d && gridJ.d.items) || []
  const prodById = new Map(allProds.map(p => [Number(p.id), p]))

  log('进入改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(1400)
  const cm = JSON.parse(await page.eval(JS_CONFIRM_OK))
  if (cm.ok) log('改单确认：已确认')
  await sleep(2800)
  const ed = await waitEdit(page)
  log('改单网格:', JSON.stringify(ed))
  const aligned = ed.ok && (ed.total === baseTotal || ed.vis === baseTotal)
  chk('S0', aligned, `grid=${ed.total}/vis=${ed.vis} list=${baseTotal}`)
  if (!aligned) throw new Error('清单条数与网格行数不一致，中止（未写任何数据）')
  /* A1：每行一个复选框 + 行高不变（新增控件不得顶高数据行，v606 的坑） */
  chk('A1', ed.pickTotal === ed.total && ed.rowH > 19.5 && ed.rowH < 22.5,
    `picks=${ed.pickTotal}/${ed.total} rowH=${ed.rowH}`)
  chk('A2', ed.hasHd, `hasHd=${ed.hasHd}`)

  /* A3：真点第 1 个可见行的复选框 */
  const r0 = JSON.parse(await page.eval(JS_ROW_PICK_RECT(0)))
  log('第 1 可见行:', JSON.stringify(r0))
  if (!r0.ok) throw new Error('拿不到行复选框坐标')
  await realClick(page, r0.x, r0.y)
  await sleep(900)
  const btn1 = JSON.parse(await page.eval(JS_BATCH_BTN))
  const selRows = JSON.parse(await page.eval(JS_ROW_SEL_COUNT))
  log('勾 1 行后按钮:', JSON.stringify(btn1), '整行选中数:', JSON.stringify(selRows))
  chk('A3', btn1.ok && btn1.n === 1 && selRows.n === 0,
    `n=${btn1 && btn1.n} rowSel=${selRows.n} h=${btn1 && btn1.h}`)
  await page.screenshot(OUT + '/A3-勾选一行后出现批量操作.png')

  /* A4：面板内容 */
  await realClick(page, btn1.x, btn1.y)
  await sleep(900)
  const pan1 = JSON.parse(await page.eval(JS_BATCH_PANEL))
  log('面板:', JSON.stringify(pan1).slice(0, 400))
  chk('A4', pan1.ok && pan1.n === 2 && /已选 1 个/.test(pan1.head || ''),
    `n=${pan1.n} head=${pan1.head}`)
  await page.screenshot(OUT + '/A4-批量操作面板.png')

  /* 关面板（点遮罩） */
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 8, y: 8, button: 'left', clickCount: 1 })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 8, y: 8, button: 'left', clickCount: 1 })
  await sleep(700)

  /* A5：表头全选 = 当前可见行数 */
  const hd = JSON.parse(await page.eval(JS_HDR_PICK_RECT))
  log('表头复选框:', JSON.stringify(hd))
  await realClick(page, hd.x, hd.y)
  await sleep(1100)
  const btnAll = JSON.parse(await page.eval(JS_BATCH_BTN))
  const edAll = JSON.parse(await page.eval(JS_EDIT_ROWS))
  log('全选后:', JSON.stringify(btnAll), 'vis=', edAll.vis)
  /* 表头全选 = 当前**可见**行数（A3 手勾的那一行本来就在可见行里，不额外多算） */
  chk('A5', btnAll.ok && btnAll.n === edAll.vis, `n=${btnAll && btnAll.n} vis=${edAll.vis}`)

  /* A6：再点一次 → 全部取消，按钮消失 */
  const hd2 = JSON.parse(await page.eval(JS_HDR_PICK_RECT))
  await realClick(page, hd2.x, hd2.y)
  await sleep(1100)
  const btnZero = JSON.parse(await page.eval(JS_BATCH_BTN))
  const edZero = JSON.parse(await page.eval(JS_EDIT_ROWS))
  log('取消全选后:', JSON.stringify(btnZero))
  /* 表头全选只取消「可见行」；A3 手勾的那一行也在可见行里 ⇒ 一并被取消 */
  chk('A6', !btnZero.ok || btnZero.n === 0, `btn=${JSON.stringify(btnZero)}`)

  /* ===== B：一次真实撤下 + 复原 ===== */
  const nameCount = {}
  baseItems.forEach(x => { const n = String(x.name || '').trim(); if (n) nameCount[n] = (nameCount[n] || 0) + 1 })
  const cands = baseItems
    .map(x => ({ id: Number(x.id), name: String(x.name || '').trim() }))
    .filter(x => x.id > 0 && x.name && nameCount[x.name] === 1)
    .slice(0, 14)
  let target = null
  for (const c of cands) {
    await page.eval(JS_SET_FIND(c.name))
    /* 搜索后渲染是下一帧生效：固定 sleep 会读到 vis=0（v614 踩过），这里轮询 */
    let rr = { ok: false, vis: 0 }
    for (let i = 0; i < 12; i++) {
      await sleep(400)
      rr = JSON.parse(await page.eval(JS_ROW_PICK_RECT(0)))
      if (rr.ok && rr.vis === 1) break
    }
    if (rr.ok && rr.vis === 1 && rr.posQty === 0 && rr.name === c.name) { target = c; break }
  }
  log('撤下目标:', JSON.stringify(target))
  if (!target) throw new Error('找不到「名称唯一 + 数量全 0」的清单内商品，中止（未写任何数据）')

  const rt = JSON.parse(await page.eval(JS_ROW_PICK_RECT(0)))
  await realClick(page, rt.x, rt.y)
  await sleep(900)
  const btnT = JSON.parse(await page.eval(JS_BATCH_BTN))
  await realClick(page, btnT.x, btnT.y)
  await sleep(900)
  const panT = JSON.parse(await page.eval(JS_BATCH_PANEL))
  const delItem = (panT.items || []).find(x => /撤下/.test(x.label))
  log('目标行面板:', JSON.stringify(panT).slice(0, 380))
  chk('B1', panT.ok && delItem && delItem.n === 1 && !delItem.disabled,
    `del=${JSON.stringify(delItem)}`)

  await realClick(page, delItem.x, delItem.y)
  await sleep(900)
  const cd1 = JSON.parse(await page.eval(JS_CD_TEXT))
  log('撤下确认框:', JSON.stringify(cd1).slice(0, 300))
  const cdOk = /撤下/.test(cd1.text || '') && /搜不到/.test(cd1.text || '')
  await page.eval(JS_CONFIRM_OK)
  const toasts = await collectToasts(page)
  log('toasts:', JSON.stringify(toasts))
  const hitRemove = toasts.find(t => /小程序商品清单/.test(t) && /移除\s*1/.test(t)) || ''
  chk('B2', cdOk && !!hitRemove, `cd=${cdOk} toast=${hitRemove || JSON.stringify(toasts)}`)

  await sleep(2600)
  const fsAfterJ = JSON.parse(await page.eval(JS_LIST_ALL(per.id)))
  const afterItems = fsAfterJ.items || []
  const afterIds = afterItems.map(x => Number(x.id))
  const gone = !afterIds.includes(target.id)
  chk('B3', afterItems.length === baseTotal - 1 && gone, `list ${baseTotal}→${afterItems.length} gone=${gone}`)

  const gridJ2 = JSON.parse(await page.eval(JS_GET('/api/products/grid')))
  const p2 = ((gridJ2.d && gridJ2.d.items) || []).find(x => Number(x.id) === target.id) || {}
  const p0 = prodById.get(target.id) || {}
  const same = String(p2.spec || '') === String(p0.spec || '')
    && String(p2.unit || '') === String(p0.unit || '')
    && Number(p2.sale_price || 0) === Number(p0.sale_price || 0)
  chk('B4', !!p2.id && same, `spec=${p2.spec}/${p0.spec} unit=${p2.unit}/${p0.unit} price=${p2.sale_price}/${p0.sale_price}`)

  /* ===== C1：有数量的行不能撤 ===== */
  log('重进改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(1400)
  const cm2 = JSON.parse(await page.eval(JS_CONFIRM_OK))
  if (cm2.ok) log('改单确认：已确认')
  await sleep(2800)
  await waitEdit(page)
  /* 🔴 搜索框（#gridFind）的状态**跨编辑态保留**：B5 那轮搜过目标商品，重进改单后
     仍然生效 ⇒ 只剩 1 行可见，后面的「找有数量的行」必然一条都找不到（实测 vis=1）。
     必须先清空，再统计。 */
  log('清空搜索:', await page.eval(JS_SET_FIND('')))
  await sleep(1200)
  log('再勾显示全部商品:', await page.eval(JS_SHOW_ALL))
  await sleep(3200)
  const stat = JSON.parse(await page.eval(JS_VIS_STAT))
  log('全表统计:', JSON.stringify({ vis: stat.vis, withQty: stat.withQty, uniq: stat.uniq }))
  if (stat.ok && stat.names && stat.names.length) {
    const hotName = stat.names[0]
    await page.eval(JS_SET_FIND(hotName))
    let rh = { ok: false, vis: 0 }
    for (let i = 0; i < 12; i++) {
      await sleep(400)
      rh = JSON.parse(await page.eval(JS_ROW_PICK_RECT(0)))
      if (rh.ok && rh.vis === 1) break
    }
    log('有数量行:', JSON.stringify(rh))
    if (rh.ok && rh.vis === 1) {
      await realClick(page, rh.x, rh.y)
      await sleep(900)
      const btnH = JSON.parse(await page.eval(JS_BATCH_BTN))
      await realClick(page, btnH.x, btnH.y)
      await sleep(900)
      const panH = JSON.parse(await page.eval(JS_BATCH_PANEL))
      const dH = (panH.items || []).find(x => /撤下/.test(x.label))
      log('有数量行的面板:', JSON.stringify(panH).slice(0, 380))
      chk('C1', rh.posQty > 0 && panH.ok && dH && dH.n === 0 && /已有人报单/.test((panH.tips || []).join('')),
        `posQty=${rh.posQty} delN=${dH && dH.n} tips=${JSON.stringify(panH.tips)}`)
      await page.screenshot(OUT + '/C1-有数量的行不可撤.png')
      /* 关面板 + 清选择，进入复原 */
      await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 8, y: 8, button: 'left', clickCount: 1 })
      await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 8, y: 8, button: 'left', clickCount: 1 })
      await sleep(700)
    } else {
      chk('C1', false, '找不到有数量的唯一行')
    }
  } else {
    chk('C1', false, '全表没有有数量的行')
  }

  /* ===== B5：复原（批量上架回清单）===== */
  await page.eval(JS_SHOW_ALL)
  await sleep(1200)
  await page.eval(JS_SET_FIND(target.name))
  let rr2 = { ok: false, vis: 0 }
  for (let i = 0; i < 14; i++) {
    await sleep(450)
    rr2 = JSON.parse(await page.eval(JS_ROW_PICK_RECT(0)))
    if (rr2.ok && rr2.vis >= 1) break
  }
  log('复原目标行:', JSON.stringify(rr2))
  if (!rr2.ok || rr2.vis < 1) throw new Error('复原失败：搜索后找不到该商品行')
  await realClick(page, rr2.x, rr2.y)
  await sleep(900)
  const btnA = JSON.parse(await page.eval(JS_BATCH_BTN))
  log('复原阶段按钮:', JSON.stringify(btnA))
  if (!btnA.ok) throw new Error('复原失败：勾选后没有出现批量操作按钮')
  await realClick(page, btnA.x, btnA.y)
  await sleep(900)
  const panA = JSON.parse(await page.eval(JS_BATCH_PANEL))
  const addItem = (panA.items || []).find(x => /上架/.test(x.label))
  log('复原面板:', JSON.stringify(panA).slice(0, 380))
  if (!addItem || addItem.n !== 1) throw new Error('复原失败：上架候选不是 1 个 ' + JSON.stringify(addItem))
  await realClick(page, addItem.x, addItem.y)
  await sleep(900)
  await page.eval(JS_CONFIRM_OK)
  const toasts2 = await collectToasts(page)
  log('复原 toasts:', JSON.stringify(toasts2))
  await sleep(2600)
  const fsFinalJ = JSON.parse(await page.eval(JS_LIST_ALL(per.id)))
  const finalIds = (fsFinalJ.items || []).map(x => Number(x.id))
  chk('B5', finalIds.length === baseTotal && finalIds.includes(target.id),
    `list=${finalIds.length} base=${baseTotal} has=${finalIds.includes(target.id)}`)

  const errs = JSON.parse(await page.eval(JS_ERR))
  chk('D1', errs.length === 0, JSON.stringify(errs).slice(0, 300))

  const passN = Object.values(res).filter(Boolean).length
  log(`\n=== ${passN}/${Object.keys(res).length} PASS ===`)
  if (fail.length) log('FAILED:', fail.join(', '))
  fs.writeFileSync(OUT + '/result.json', JSON.stringify({ res, fail }, null, 1))
  await browser.close()
  process.exit(fail.length ? 1 : 0)
} catch (e) {
  log('FATAL', e && e.message)
  console.log(JSON.stringify(res))
  try { if (browser) await browser.close() } catch (e2) {}
  process.exit(2)
}
