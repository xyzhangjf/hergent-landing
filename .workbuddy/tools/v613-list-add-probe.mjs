/**
 * v613 验证：把「当前筛选出的商品」显式加入本期清单（批量上架到小程序）。
 *
 * 背景（用户设想）：「改单 → 筛选品牌（如新希望）→ 保存」能不能把该品牌商品上架到小程序？
 *   原答案：不能，且零提示 —— ①行底默认只放清单内商品，清单外的勾品牌也筛不出来；
 *   ②即便勾「显示全部商品」调出来，保存也只认 qty>0 或 is_new 的行。
 *   v613 给出显式动作：勾品牌后出现「加入本期清单（N 个）」，一点即标记 + 立即保存。
 *
 * 判据清单
 *   Z0 构建号 v613
 *   Z1 查看态就绪（有行）
 *   S0 期次要与清单对齐：fill-search(period) 条数 == 改单网格行数（否则中止，不写任何数据）
 *   A0 勾「显示全部商品」→ 行数变为全量档案（> 基线）
 *   A1 勾一个品牌 → 出现「加入本期清单」按钮，N 与「该品牌未在清单的商品数」一致（±2 容忍停用/档案外行）
 *   A2 清空品牌 → 按钮消失（候选归零）→ 证明它跟随筛选，不是常驻
 *   A3 搜索一个不在清单的唯一商品 → 按钮 N=1
 *   A4 点按钮 → 确认弹窗文案点名「1 个商品」「不产生任何报单数量」
 *   A5 确认 → 保存回执含「小程序商品清单：新增 1 个」
 *   B1 fill-search 立刻含该商品，条数 = 基线 + 1
 *   B2 该商品在报单明细里**没有数量**（上架 ≠ 报单）
 *   B3 商品档案未被污染（规格/单位/售价逐字一致）
 *   C1 复原：再进改单删掉该行 → 保存 → fill-search 回到基线
 *   D1 全程零页面报错
 *
 * ⚠️ 真实写入范围：只写 1 个商品（A3 用搜索精确到 1 行），随后 C1 复原。
 *    品牌路径（A1）只读断言「按钮出现且数对」，不点 —— 避免一次上架整品牌再逐个删。
 *    两条路径点击后走的是**同一个** addShownToList / saveEdits / 后端 eligible，链路等价。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v613'
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
    inEdit: !!document.querySelector('.edit-tbl') })
})()`

const JS_EDIT_ROWS = `(() => {
  const wrap = document.querySelector('.edit-grid-wrap'); if (!wrap) return JSON.stringify({ ok: false })
  const trs = [...wrap.querySelectorAll('tbody tr')]
  const vis = trs.filter(t => t.getBoundingClientRect().height > 0)
  return JSON.stringify({ ok: true, total: trs.length, vis: vis.length })
})()`

const JS_ENTER_EDIT = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('改单') && x.offsetParent !== null)
  if (!b) return JSON.stringify({ ok: false }); b.click(); return JSON.stringify({ ok: true }) })()`

/* 通用确认：优先全局 ConfirmDialog（.ui-cd-danger），再退旧 modal */
const JS_CONFIRM_OK = `(() => {
  const b = document.querySelector('.ui-cd-danger')
    || [...document.querySelectorAll('.imp-modal button, .modal button, [role="dialog"] button')]
        .find(x => /仍要|确定|确认|删除|进入/.test(x.textContent || ''))
  if (!b) return JSON.stringify({ ok: false })
  if (b.disabled) return JSON.stringify({ ok: false, why: 'disabled' })
  b.click(); return JSON.stringify({ ok: true }) })()`

const JS_SHOW_ALL = `(() => {
  const lab = [...document.querySelectorAll('label.tb-toggle')].find(l => (l.textContent || '').includes('显示全部商品'))
  if (!lab) return JSON.stringify({ ok: false, why: 'no-label' })
  const inp = lab.querySelector('input[type=checkbox]')
  if (!inp) return JSON.stringify({ ok: false, why: 'no-input' })
  if (!inp.checked) inp.click()
  return JSON.stringify({ ok: true, checked: inp.checked })
})()`

const JS_OPEN_BRAND = `(() => {
  const b = [...document.querySelectorAll('.grid-ctl-row .tb-pop > button.btn')]
    .find(x => (x.textContent || '').includes('品牌'))
  if (!b) return JSON.stringify({ ok: false, why: 'no-btn' })
  b.click()
  return JSON.stringify({ ok: true })
})()`

const JS_BRAND_ITEMS = `(() => {
  const p = document.querySelector('.brand-pop')
  if (!p) return JSON.stringify({ ok: false, why: 'no-panel' })
  const items = [...p.querySelectorAll('label.bp-item')]
    .map(l => { const i = l.querySelector('input'); return { name: (l.textContent || '').trim(), checked: !!(i && i.checked) } })
  return JSON.stringify({ ok: true, items })
})()`

/* 点 label 而不是 input：label 的隐式激活对「点 label 非控件区域」生效，不会二次 toggle */
const JS_PICK_BRAND = (nm) => `(() => {
  const p = document.querySelector('.brand-pop')
  if (!p) return JSON.stringify({ ok: false, why: 'no-panel' })
  const l = [...p.querySelectorAll('label.bp-item')].find(x => (x.textContent || '').trim() === ${JSON.stringify(nm)})
  if (!l) return JSON.stringify({ ok: false, why: 'brand-not-found' })
  const inp = l.querySelector('input')
  const before = !!(inp && inp.checked)
  if (inp && !before) inp.click()
  const after = !!(inp && inp.checked)
  return JSON.stringify({ ok: true, before, after })
})()`

const JS_CLEAR_BRAND = `(() => {
  const p = document.querySelector('.brand-pop')
  if (!p) return JSON.stringify({ ok: false, why: 'no-panel' })
  const b = [...p.querySelectorAll('button.link-btn')].find(x => (x.textContent || '').includes('清空'))
  if (!b) return JSON.stringify({ ok: false, why: 'no-clear' })
  b.click(); return JSON.stringify({ ok: true })
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

const JS_LISTADD = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('加入本期清单'))
  if (!b) return JSON.stringify({ ok: false })
  const badge = b.querySelector('.btn-badge')
  const r = b.getBoundingClientRect()
  return JSON.stringify({ ok: true, n: badge ? Number(String(badge.textContent).trim()) : 0,
    disabled: !!b.disabled, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) })
})()`

const JS_CD_TEXT = `(() => {
  const e = document.querySelector('.ui-cd-text')
  const title = document.querySelector('.ui-cd-title')
  return JSON.stringify({ ok: !!e, text: e ? e.textContent : '', title: title ? title.textContent : '' })
})()`

const JS_CLICK_ADD = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('加入本期清单'))
  if (!b) return JSON.stringify({ ok: false })
  b.click(); return JSON.stringify({ ok: true })
})()`

/* 删掉名称匹配的那一行 */
const JS_DEL_ROW = (nm) => `(() => {
  const wrap = document.querySelector('.edit-grid-wrap'); if (!wrap) return JSON.stringify({ ok: false, why: 'no-wrap' })
  const sc = wrap.querySelector('.edit-scroll') || wrap
  sc.scrollLeft = sc.scrollWidth
  const trs = [...wrap.querySelectorAll('tbody tr')].filter(t => t.getBoundingClientRect().height > 0)
  const tr = trs.find(t => { const i = t.querySelector('input.cell-name'); return i && i.value.trim() === ${JSON.stringify(nm)} })
  if (!tr) return JSON.stringify({ ok: false, why: 'row-not-found', n: trs.length })
  const b = tr.querySelector('button.btn-del'); if (!b) return JSON.stringify({ ok: false, why: 'no-del' })
  b.click(); return JSON.stringify({ ok: true })
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
  chk('Z0', String(build).includes('v613'), String(build))
  await page.eval(JS_HOOK)

  let v = { ok: false }
  for (let i = 0; i < 16; i++) {
    v = JSON.parse(await page.eval(JS_VIEW_ROWS))
    if (v.ok && v.rows > 0) break
    await sleep(700)
  }
  chk('Z1', v.ok && v.rows > 0 && !v.inEdit, JSON.stringify(v))

  const per = JSON.parse(await page.eval(JS_PICK_PERIOD))
  log('期次:', JSON.stringify(per))
  if (!per.ok) throw new Error('没有可用的进行中期次，中止（不写任何数据）')

  const fsBase = JSON.parse(await page.eval(JS_GET(`/api/products/fill-search?period_id=${per.id}&limit=200`)))
  const baseItems = (fsBase.d && (fsBase.d.items || fsBase.d.products)) || []
  const baseIds = baseItems.map(x => Number(x.id))
  log('清单基线:', baseIds.length, '条')
  if (baseIds.length >= 200) throw new Error('清单已到 limit 上限（200），本探针的条数断言会失真，中止')

  /* ── 进改单并核对对齐 ── */
  log('进入改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(1400)
  const cm = JSON.parse(await page.eval(JS_CONFIRM_OK))
  if (cm.ok) log('改单确认：已确认')
  await sleep(2600)
  let ed = { ok: false }
  for (let i = 0; i < 14; i++) {
    ed = JSON.parse(await page.eval(JS_EDIT_ROWS))
    if (ed.ok && ed.total > 0) break
    await sleep(700)
  }
  log('改单网格:', JSON.stringify(ed))
  const aligned = ed.ok && (ed.total === baseIds.length || ed.vis === baseIds.length)
  chk('S0', aligned, `grid=${ed.total}/vis=${ed.vis} list=${baseIds.length}`)
  if (!aligned) throw new Error('清单条数与网格行数不一致 —— 选错期次或清单未对齐，中止（未写任何数据）')

  /* ── A0 显示全部商品 ── */
  log('勾显示全部商品:', await page.eval(JS_SHOW_ALL))
  await sleep(3200)
  let ed2 = { ok: false }
  for (let i = 0; i < 14; i++) {
    ed2 = JSON.parse(await page.eval(JS_EDIT_ROWS))
    if (ed2.ok && ed2.total > ed.total) break
    await sleep(800)
  }
  log('全量行数:', JSON.stringify(ed2))
  chk('A0', ed2.ok && ed2.total > ed.total, `${ed.total}→${ed2 && ed2.total}`)
  await page.screenshot(OUT + '/A0-显示全部商品.png')

  /* ── A1 勾品牌 → 读按钮 N，与「该品牌未在清单的商品数」比对 ── */
  const grid = JSON.parse(await page.eval(JS_GET('/api/products/grid')))
  const all = (grid.d && grid.d.items) || []
  const byBrand = {}
  all.forEach(p => {
    const b = String(p.brand || '').trim()
    if (!b) return
    if (!byBrand[b]) byBrand[b] = { total: 0, miss: 0, missIds: [] }
    byBrand[b].total++
    if (!baseIds.includes(Number(p.id))) { byBrand[b].miss++; byBrand[b].missIds.push(Number(p.id)) }
  })
  /* 选「有未在清单商品」且数量最小的品牌（真机写入只做 1 个，见 A3） */
  const brandCand = Object.entries(byBrand).filter(([, o]) => o.miss > 0)
    .sort((a, b) => a[1].miss - b[1].miss)
  log('品牌候选（按未在清单件数升序前 6）:', JSON.stringify(brandCand.slice(0, 6).map(([n, o]) => [n, o.miss, o.total])))
  const brand = brandCand.length ? brandCand[0][0] : ''
  log('A1 选用品牌:', brand, '预期未在清单:', brand ? byBrand[brand].miss : 0)

  await page.eval(JS_OPEN_BRAND)
  await sleep(700)
  const bi = JSON.parse(await page.eval(JS_BRAND_ITEMS))
  log('品牌面板:', bi.ok ? bi.items.length + ' 项' : JSON.stringify(bi))
  if (brand) {
    log('勾选品牌:', await page.eval(JS_PICK_BRAND(brand)))
    await sleep(900)
    await page.eval(JS_OPEN_BRAND)   // 关闭面板（toggle）
    await sleep(900)
    const la = JSON.parse(await page.eval(JS_LISTADD))
    log('A1 按钮:', JSON.stringify(la))
    const expect = byBrand[brand].miss
    chk('A1', la.ok && la.n > 0 && Math.abs(la.n - expect) <= 2, `N=${la.n} expect=${expect}`)
    await page.screenshot(OUT + '/A1-勾品牌后出现加入清单按钮.png')

    /* ── A2 清空品牌 → 按钮消失 ── */
    await page.eval(JS_OPEN_BRAND)
    await sleep(700)
    await page.eval(JS_CLEAR_BRAND)
    await sleep(900)
    await page.eval(JS_OPEN_BRAND)
    await sleep(900)
    const la0 = JSON.parse(await page.eval(JS_LISTADD))
    log('A2 清空品牌后按钮:', JSON.stringify(la0))
    chk('A2', !la0.ok || la0.n === 0, JSON.stringify(la0))
  } else {
    chk('A1', false, '没有「有未在清单商品」的品牌（清单已覆盖全部在售品牌？）')
    chk('A2', false, 'skipped')
    await page.eval(JS_OPEN_BRAND)
    await sleep(500)
  }

  /* ── A3 搜索精确到 1 个不在清单的商品 ── */
  const nameCount = {}
  all.forEach(p => { const n = String(p.name || '').trim(); nameCount[n] = (nameCount[n] || 0) + 1 })
  const cand = (Number(process.env.HG_CAND) > 0
    ? all.find(p => Number(p.id) === Number(process.env.HG_CAND))
    : null) || all.find(p => Number(p.id) > 0 && !baseIds.includes(Number(p.id))
    && String(p.name || '').trim() && nameCount[String(p.name).trim()] === 1
    && Number(p.sale_price) > 0 && String(p.spec || '').trim())
  if (!cand) throw new Error('找不到合适的候选商品（在售、不在清单、名称唯一、有售价与规格）')
  const target = { id: Number(cand.id), name: String(cand.name).trim(), spec: String(cand.spec || ''), unit: String(cand.unit || ''), sale: Number(cand.sale_price) }
  log('A3 候选:', JSON.stringify(target))

  log('搜索:', await page.eval(JS_SET_FIND(target.name)))
  await sleep(1400)
  const la3 = JSON.parse(await page.eval(JS_LISTADD))
  log('A3 按钮:', JSON.stringify(la3))
  chk('A3', la3.ok && la3.n === 1, JSON.stringify(la3))

  /* ── A4 点按钮 → 确认弹窗文案 ── */
  await page.eval(JS_CLICK_ADD)
  await sleep(900)
  const cd = JSON.parse(await page.eval(JS_CD_TEXT))
  log('A4 确认文案:', JSON.stringify(cd))
  chk('A4', cd.ok && cd.text.includes('1 个商品') && cd.text.includes('不产生任何报单数量'), cd.text.slice(0, 80))
  await page.screenshot(OUT + '/A4-加入清单确认框.png')

  const okBtn = JSON.parse(await page.eval(JS_CONFIRM_OK))
  log('A4 确认:', JSON.stringify(okBtn))
  await sleep(1200)

  /* 保存前可能弹「有 N 行缺少名称」——本次不会；冲突才会 */
  const c3 = JSON.parse(await page.eval(JS_CONFIRM_OK))
  if (c3.ok) { log('保存附加确认：已确认'); await sleep(900) }
  let ts = []
  for (let i = 0; i < 24; i++) {
    ts = JSON.parse(await page.eval(JS_TOASTS))
    if ((ts || []).some(t => t.includes('已保存') || t.includes('保存失败') || t.includes('冲突'))) break
    await sleep(600)
  }
  log('A5 保存 toast:', JSON.stringify(ts))
  chk('A5', (ts || []).some(t => t.includes('已保存') && t.includes('小程序商品清单') && t.includes('新增 1')), JSON.stringify(ts))
  await page.screenshot(OUT + '/A5-保存回执.png')

  /* ── B1 fill-search 立刻可见 ── */
  await sleep(1500)
  const fs1 = JSON.parse(await page.eval(JS_GET(`/api/products/fill-search?period_id=${per.id}&limit=200`)))
  const items1 = (fs1.d && (fs1.d.items || fs1.d.products)) || []
  const ids1 = items1.map(x => Number(x.id))
  log('B1 清单条数:', ids1.length, '| 目标位置:', ids1.indexOf(target.id))
  chk('B1', ids1.includes(target.id) && ids1.length === baseIds.length + 1, `${baseIds.length}→${ids1.length}`)

  /* ── B2 上架 ≠ 报单：该商品在明细里没有数量 ── */
  const sm = JSON.parse(await page.eval(JS_GET(
    `/api/forecast-submissions/summary?start=${per.start || ''}&end=${per.end || ''}&period_id=${per.id}`)))
  const srows = (sm.d && sm.d.rows) || []
  const hit = srows.find(r => Number(r.product_id) === target.id)
  const q = hit ? Number(hit.total_qty || hit.qty || 0) : 0
  log('B2 明细里该商品:', JSON.stringify(hit ? { pid: hit.product_id, qty: q } : null))
  chk('B2', q === 0, `qty=${q}`)

  /* ── B3 档案未污染 ── */
  const grid2 = JSON.parse(await page.eval(JS_GET('/api/products/grid')))
  const p2 = ((grid2.d && grid2.d.items) || []).find(x => Number(x.id) === target.id) || {}
  const same = String(p2.spec || '') === target.spec && String(p2.unit || '') === target.unit
    && Number(p2.sale_price) === target.sale
  log('B3 档案对比:', JSON.stringify({ spec: p2.spec, unit: p2.unit, sale: p2.sale_price }))
  chk('B3', same, JSON.stringify({ spec: p2.spec, unit: p2.unit, sale: p2.sale_price }))

  /* ── C1 复原：删该行 → 保存 → 清单回到基线 ── */
  await page.eval(JS_SET_FIND(''))          // 清搜索，避免行被隐藏导致找不到
  await sleep(800)
  log('再进改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(1400)
  const c4 = JSON.parse(await page.eval(JS_CONFIRM_OK))
  if (c4.ok) log('改单确认（复原）：已确认')
  await sleep(2600)
  let ed3 = { ok: false }
  for (let i = 0; i < 14; i++) {
    ed3 = JSON.parse(await page.eval(JS_EDIT_ROWS))
    if (ed3.ok && ed3.total > 0) break
    await sleep(700)
  }
  log('复原态网格:', JSON.stringify(ed3))
  const del = JSON.parse(await page.eval(JS_DEL_ROW(target.name)))
  log('C1 删行:', JSON.stringify(del))
  await sleep(900)
  const cd2 = JSON.parse(await page.eval(JS_CONFIRM_OK))
  if (cd2.ok) log('C1 删行确认：已确认')
  await sleep(900)
  log('C1 保存:', await page.eval(JS_SAVE_CLICK))
  await sleep(1200)
  const c5 = JSON.parse(await page.eval(JS_CONFIRM_OK))
  if (c5.ok) { log('保存确认（复原）：已确认'); await sleep(900) }
  let ts2 = []
  for (let i = 0; i < 24; i++) {
    ts2 = JSON.parse(await page.eval(JS_TOASTS))
    if ((ts2 || []).some(t => t.includes('已保存') || t.includes('保存失败'))) break
    await sleep(600)
  }
  log('C1 复原 toast:', JSON.stringify(ts2))
  await sleep(1500)
  const fs2 = JSON.parse(await page.eval(JS_GET(`/api/products/fill-search?period_id=${per.id}&limit=200`)))
  const ids2 = ((fs2.d && (fs2.d.items || fs2.d.products)) || []).map(x => Number(x.id))
  log('C1 清单复原:', ids2.length, '基线:', baseIds.length)
  chk('C1', ids2.length === baseIds.length && !ids2.includes(target.id), `${ids2.length} vs ${baseIds.length}`)
  await page.screenshot(OUT + '/C1-复原后清单.png')

  const errs = JSON.parse(await page.eval(JS_ERR))
  log('页面报错:', JSON.stringify(errs))
  chk('D1', (errs || []).length === 0, JSON.stringify(errs))

  log('\n=== 结果 ===', JSON.stringify(res, null, 1))
  const total = Object.keys(res).length
  log(`通过 ${total - fail.length}/${total}`)
  if (fail.length) { log('失败项:', fail.join(', ')); process.exitCode = 1 }
} catch (e) {
  log('EXCEPTION', e && (e.stack || e.message))
  process.exitCode = 2
} finally {
  if (browser) { try { await browser.close() } catch (_) {} }
}
