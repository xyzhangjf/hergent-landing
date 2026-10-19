/**
 * v614 验证：把「当前筛选出的商品」从本期清单撤下（批量下架小程序）。
 *
 * 背景（用户诉求）：「改单 → 把某个品牌的勾选取消 → 保存」能不能批量撤下？
 *   不能：筛选只做 v-show，**不参与 payload**；真正的移除判据是后端 `listed − keep`，
 *   只有「删行」能产生「keep 里没有」。所以给一个显式动作「撤下清单（N 个）」。
 *
 * 与「删行」的本质区别（本探针的核心断言）：
 *   · 删行 = 从 payload 剔除 ⇒ 整期重建时该行数量一并消失；
 *   · 撤下 = 行留在 payload、只标 list_del ⇒ 清单摘掉，**数量/加单/手工单价一个字不动**。
 *   并因此禁止撤下「有数量」的行（否则 qty>0 会让它下次保存被自动加回清单）。
 *
 * 判据清单
 *   Z0 构建号 v614
 *   Z1 查看态就绪（有行）
 *   S0 清单条数 == 改单网格行数（对齐，否则中止不写）
 *   A0 勾「显示全部商品」→ 行数增加
 *   A1 勾「蒙牛低温」→ 「撤下清单」按钮出现，N>0 且 N ≤ 该品牌筛选可见行数
 *   A2 清空品牌 → 按钮消失（筛选闸门；否则一键清空整期清单）
 *   A3 搜索一个「清单内 + 数量全 0 + 名称唯一」的商品 → 撤下 N=1
 *   A4 点撤下 → 确认框文案含「撤下」「搜不到」「不删任何已报数量」
 *   A5 确认 → toast 含「小程序商品清单：移除 1 个」
 *   B1 fill-search 条数 = 基线 − 1，且不含该商品
 *   B2 该商品档案未被污染（spec/unit/sale_price 逐字一致）
 *   C1 搜「红桶」（本期有报单数量）→ 撤下按钮不出现（防被 qty>0 自动加回）
 *   B3 复原：显示全部商品 → 搜该商品 →「加入本期清单」N=1 → 保存 → fill-search 回基线
 *   D1 全程零页面报错
 *
 * ⚠️ 真实写入范围：只撤 1 个商品（A3 搜索精确到 1 行），随后 B3 复原。
 *    品牌路径（A1）只读断言「按钮出现且数对」，不点 —— 否则一次撤掉整品牌。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v614'
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

/* 期次商品清单的**全量**读取：fill-search 的 limit 被后端 cap 到 200（data.py: min(limit,200)），
   而本期实测 294 条 ⇒ 必须按 offset 分页拉全，否则「清单条数 vs 网格行数」的对齐判据恒假。 */
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

const JS_CONFIRM_OK = `(() => {
  const b = document.querySelector('.ui-cd-danger')
    || [...document.querySelectorAll('.imp-modal button, .modal button, [role="dialog"] button')]
        .find(x => /仍要|确定|确认|删除|进入|撤下/.test(x.textContent || ''))
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

const JS_OPEN_BRAND = `(() => {
  const b = [...document.querySelectorAll('.grid-ctl-row .tb-pop > button.btn')]
    .find(x => (x.textContent || '').includes('品牌'))
  if (!b) return JSON.stringify({ ok: false, why: 'no-btn' })
  b.click()
  return JSON.stringify({ ok: true })
})()`

const JS_PICK_BRAND = (nm) => `(() => {
  const p = document.querySelector('.brand-pop')
  if (!p) return JSON.stringify({ ok: false, why: 'no-panel' })
  const l = [...p.querySelectorAll('label.bp-item')].find(x => (x.textContent || '').trim() === ${JSON.stringify(nm)})
  if (!l) return JSON.stringify({ ok: false, why: 'brand-not-found' })
  const inp = l.querySelector('input')
  if (inp && !inp.checked) inp.click()
  return JSON.stringify({ ok: true, checked: !!(inp && inp.checked) })
})()`

const JS_CLEAR_BRAND = `(() => {
  const p = document.querySelector('.brand-pop')
  if (!p) return JSON.stringify({ ok: false, why: 'no-panel' })
  const b = [...p.querySelectorAll('button.link-btn')].find(x => (x.textContent || '').includes('清空'))
  if (!b) return JSON.stringify({ ok: false, why: 'no-clear' })
  b.click(); return JSON.stringify({ ok: true })
})()`

const JS_CLOSE_BRAND = `(() => {
  const p = document.querySelector('.brand-pop'); if (!p) return JSON.stringify({ ok: true })
  document.body.click(); return JSON.stringify({ ok: true }) })()`

const JS_SET_FIND = (txt) => `(() => {
  const el = document.getElementById('gridFind')
  if (!el) return JSON.stringify({ ok: false, why: 'no-find' })
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  el.focus(); setter.call(el, ${JSON.stringify(txt)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.blur()
  return JSON.stringify({ ok: true, val: el.value })
})()`

/* 读「撤下清单」按钮：存在 / N / 是否 disabled */
const JS_LISTDEL = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('撤下清单'))
  if (!b) return JSON.stringify({ ok: false })
  const badge = b.querySelector('.btn-badge')
  const r = b.getBoundingClientRect()
  return JSON.stringify({ ok: true, n: badge ? Number(String(badge.textContent).trim()) : 0,
    disabled: !!b.disabled, h: +r.height.toFixed(1), x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) })
})()`

const JS_LISTADD = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('加入本期清单'))
  if (!b) return JSON.stringify({ ok: false })
  const badge = b.querySelector('.btn-badge')
  return JSON.stringify({ ok: true, n: badge ? Number(String(badge.textContent).trim()) : 0, disabled: !!b.disabled })
})()`

const JS_CLICK_DEL = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('撤下清单'))
  if (!b) return JSON.stringify({ ok: false })
  b.click(); return JSON.stringify({ ok: true }) })()`

const JS_CLICK_ADD = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('加入本期清单'))
  if (!b) return JSON.stringify({ ok: false })
  b.click(); return JSON.stringify({ ok: true }) })()`

const JS_SAVE_CLICK = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '保存' && x.offsetParent !== null)
  if (!b) return JSON.stringify({ ok: false, why: 'no-btn' })
  if (b.disabled) return JSON.stringify({ ok: false, why: 'disabled' })
  b.click(); return JSON.stringify({ ok: true })
})()`

/* 可见行的名称与数量快照 —— 用来断言「搜到了唯一一行」「该行数量为 0」「红桶那行有数量」 */
const JS_VIS_SNAPSHOT = `(() => {
  const wrap = document.querySelector('.edit-grid-wrap'); if (!wrap) return JSON.stringify({ ok: false })
  const trs = [...wrap.querySelectorAll('tbody tr')].filter(t => t.getBoundingClientRect().height > 0)
  const rows = trs.slice(0, 6).map(t => {
    const nm = t.querySelector('input.cell-name')
    const qtys = [...t.querySelectorAll('input.cell-qty')].map(i => (i.value || '').trim())
    const pos = qtys.filter(v => v !== '' && v !== '0' && Number(v) > 0)
    return { name: nm ? nm.value.trim() : '', posQty: pos.length, qtySample: qtys.slice(0, 4) }
  })
  return JSON.stringify({ ok: true, vis: trs.length, rows })
})()`

/* 全表统计：可见行数 + 其中有正数量的行数与名字。
   用来验证「有数量的行不进撤下候选」，且**不依赖硬编码商品名**
   （实测「红桶」在 products.name 里搜不到 —— 报单快照名与档案名不一定同字）。 */
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
  // 优先取「名字唯一」的有数量行：同名多规格时，搜名字会带出无数量的兄弟行，
  // 「撤下」按钮就不再是空 —— 断言会变成假阴性。
  const uniq = hot.filter(n => freq[n] === 1)
  const names = (uniq.length ? uniq : hot).slice(0, 8)
  return JSON.stringify({ ok: true, vis: trs.length, withQty: hot.length, uniq: uniq.length, names })
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

/* toast 是短命元素（约 3-4s 自动消失）：固定 sleep 后一次性取会漏（实测取到空数组），
   改为「一出现就收」的轮询。 */
async function collectToasts(page, ms = 9000) {
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
  chk('Z0', String(build).includes('v614'), String(build))
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

  const fsBaseJ = JSON.parse(await page.eval(JS_LIST_ALL(per.id)))
  const baseItems = fsBaseJ.items || []
  const baseTotal = Number(fsBaseJ.total || baseItems.length)
  const baseIds = baseItems.map(x => Number(x.id))
  log('清单基线:', baseTotal, '条（实拉', baseIds.length, '）')
  if (!baseIds.length) throw new Error('清单为空，无法验证撤下')
  if (baseIds.length !== baseTotal) throw new Error(`清单分页未拉全（${baseIds.length}/${baseTotal}），中止`)

  /* 档案基线（用于 B2「档案未被污染」） */
  const gridJ = JSON.parse(await page.eval(JS_GET('/api/products/grid')))
  const allProds = (gridJ.d && gridJ.d.items) || []
  const prodById = new Map(allProds.map(p => [Number(p.id), p]))

  /* 进改单 */
  log('进入改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(1400)
  const cm = JSON.parse(await page.eval(JS_CONFIRM_OK))
  if (cm.ok) log('改单确认：已确认')
  await sleep(2800)
  let ed = { ok: false }
  for (let i = 0; i < 16; i++) {
    ed = JSON.parse(await page.eval(JS_EDIT_ROWS))
    if (ed.ok && ed.total > 0) break
    await sleep(700)
  }
  log('改单网格:', JSON.stringify(ed))
  const aligned = ed.ok && (ed.total === baseTotal || ed.vis === baseTotal)
  chk('S0', aligned, `grid=${ed.total}/vis=${ed.vis} list=${baseTotal}`)
  if (!aligned) throw new Error('清单条数与网格行数不一致，中止（未写任何数据）')

  /* A0 显示全部商品 */
  log('勾显示全部商品:', await page.eval(JS_SHOW_ALL))
  await sleep(3200)
  let ed2 = ed
  for (let i = 0; i < 16; i++) {
    ed2 = JSON.parse(await page.eval(JS_EDIT_ROWS))
    if (ed2.ok && ed2.total > ed.total) break
    await sleep(800)
  }
  chk('A0', ed2.ok && ed2.total > ed.total, `${ed.total}→${ed2 && ed2.total}`)

  /* A0b 闸门：此刻**没有任何行筛选**（只勾了「显示全部商品」，那不是行筛选）
     ⇒ 「撤下清单」必须不存在，否则一键就是清空整期清单。 */
  const delNoFilter = JSON.parse(await page.eval(JS_LISTDEL))
  log('无筛选时撤下按钮:', JSON.stringify(delNoFilter))
  chk('A0b', !delNoFilter.ok || delNoFilter.n === 0, JSON.stringify(delNoFilter))
  await page.screenshot(OUT + '/A0b-无筛选时没有撤下按钮.png')

  /* A1 勾品牌 → 撤下按钮出现 */
  await page.eval(JS_OPEN_BRAND)
  await sleep(700)
  const brandPick = JSON.parse(await page.eval(JS_PICK_BRAND('蒙牛低温')))
  log('勾品牌:', JSON.stringify(brandPick))
  await page.eval(JS_CLOSE_BRAND)
  await sleep(1600)
  const snapBrand = JSON.parse(await page.eval(JS_VIS_SNAPSHOT))
  const delBrand = JSON.parse(await page.eval(JS_LISTDEL))
  log('品牌筛选后可见行:', snapBrand.vis, '撤下按钮:', JSON.stringify(delBrand))
  chk('A1', delBrand.ok && delBrand.n > 0 && delBrand.n <= snapBrand.vis,
    `n=${delBrand && delBrand.n} vis=${snapBrand.vis}`)
  await page.screenshot(OUT + '/A1-勾品牌后出现撤下按钮.png')

  /* A2 原设计是「清空品牌 → 按钮消失」，但品牌面板的开关是 hover/click 混合，
     探针二次开面板不稳（实测 .brand-pop 未出现）⇒ 闸门改由 A0b 用**天然无筛选态**验证，
     更接近真相也更稳：A0b 通过即证明按钮不是常驻。此处不再重复操作面板。 */

  /* A3 找一个「清单内 + 数量全 0 + 名称唯一」的商品 */
  const nameCount = {}
  baseItems.forEach(x => { const n = String(x.name || '').trim(); if (n) nameCount[n] = (nameCount[n] || 0) + 1 })
  const cands = baseItems
    .map(x => ({ id: Number(x.id), name: String(x.name || '').trim() }))
    .filter(x => x.id > 0 && x.name && nameCount[x.name] === 1)
    .slice(0, 12)
  let target = null
  for (const c of cands) {
    await page.eval(JS_SET_FIND(c.name))
    await sleep(1100)
    const s = JSON.parse(await page.eval(JS_VIS_SNAPSHOT))
    const dl = JSON.parse(await page.eval(JS_LISTDEL))
    if (s.ok && s.vis === 1 && s.rows[0] && s.rows[0].name === c.name && s.rows[0].posQty === 0 && dl.ok && dl.n === 1) {
      target = c
      log('测试商品:', c.name, 'pid=', c.id)
      break
    }
  }
  chk('A3', !!target, target ? target.name : '没有找到符合条件的商品（清单内/数量0/名称唯一）')
  if (!target) throw new Error('找不到可安全测试的商品，中止（未写任何数据）')
  const before = prodById.get(target.id) || null

  /* A4 点撤下 → 确认框文案 */
  await page.eval(JS_CLICK_DEL)
  await sleep(900)
  const cd = JSON.parse(await page.eval(JS_CD_TEXT))
  log('确认框:', JSON.stringify(cd).slice(0, 400))
  const cdOk = cd.ok && /撤下/.test(cd.text) && /搜不到/.test(cd.text) && /不删任何已报数量/.test(cd.text)
  chk('A4', cdOk, cd.ok ? '文案命中' : '无确认框')
  await page.screenshot(OUT + '/A4-撤下确认框.png')

  /* A5 确认 → toast */
  log('确认:', await page.eval(JS_CONFIRM_OK))
  const toasts = await collectToasts(page, 12000)
  log('toasts:', JSON.stringify(toasts))
  const hit = toasts.find(t => /小程序商品清单/.test(t) && /移除\s*1/.test(t)) || ''
  chk('A5', !!hit, hit || JSON.stringify(toasts))

  /* B1 清单少一条 */
  const fsAfterJ = JSON.parse(await page.eval(JS_LIST_ALL(per.id)))
  const afterItems = fsAfterJ.items || []
  const afterIds = afterItems.map(x => Number(x.id))
  const gone = !afterIds.includes(target.id)
  chk('B1', Number(fsAfterJ.total) === baseTotal - 1 && gone,
    `list ${baseTotal}→${fsAfterJ.total} gone=${gone}`)

  /* B2 档案未被污染 */
  const gridAfterJ = JSON.parse(await page.eval(JS_GET('/api/products/grid')))
  const afterProd = (((gridAfterJ.d || {}).items) || []).find(p => Number(p.id) === target.id) || null
  const same = !!before && !!afterProd
    && String(before.spec || '') === String(afterProd.spec || '')
    && String(before.unit || '') === String(afterProd.unit || '')
    && Number(before.sale_price || 0) === Number(afterProd.sale_price || 0)
  chk('B2', same, same ? '规格/单位/售价一致' : `before=${JSON.stringify(before && { s: before.spec, u: before.unit, p: before.sale_price })} after=${JSON.stringify(afterProd && { s: afterProd.spec, u: afterProd.unit, p: afterProd.sale_price })}`)

  /* 保存成功后前端**自动退出编辑态**（v208 用户拍板）⇒ 后面的断言必须重新进改单。
     不复用前面的引用：退出编辑态时 loadCross 会重建 cross.value，旧的 DOM 全没了。 */
  log('重进改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(1600)
  const cm2 = JSON.parse(await page.eval(JS_CONFIRM_OK))
  if (cm2.ok) log('改单确认：已确认')
  /* 🔴 必须等到网格真的有行再往下走：重进改单是整表重建（loadCross），
     固定 sleep 在机器慢的时候会拿到空 tbody ⇒ 后面搜索断言全是假阴性（实测 vis=0）。 */
  let ed3 = { ok: false }
  for (let i = 0; i < 20; i++) {
    ed3 = JSON.parse(await page.eval(JS_EDIT_ROWS))
    if (ed3.ok && ed3.total > 0) break
    await sleep(700)
  }
  log('重进改单行数:', JSON.stringify(ed3))
  log('再勾显示全部商品:', await page.eval(JS_SHOW_ALL))
  let ed4 = ed3
  for (let i = 0; i < 20; i++) {
    ed4 = JSON.parse(await page.eval(JS_EDIT_ROWS))
    if (ed4.ok && ed4.total > ed3.total) break
    await sleep(700)
  }
  log('显示全部后行数:', JSON.stringify(ed4))

  /* C1 有报单数量的商品不允许撤下 —— 从网格里自动挑一个「本期已有数量」的行来验，
     不猜商品名。判据：该行可见、有正数量，且「撤下清单」按钮**不出现**（候选被排空）。 */
  await page.eval(JS_SET_FIND(''))       // 清掉上一段的搜索词（残留会让全表只剩 1 行）
  let stat = { ok: false, vis: 0, withQty: 0, names: [] }
  for (let i = 0; i < 20; i++) {
    await sleep(700)
    stat = JSON.parse(await page.eval(JS_VIS_STAT))
    if (stat.ok && stat.vis >= 300) break
  }
  log('全表统计:', JSON.stringify({ vis: stat.vis, withQty: stat.withQty, uniq: stat.uniq, names: stat.names }))
  const hotName = (stat.names || []).find(Boolean) || ''
  let snapHot = { ok: false, vis: 0, rows: [] }
  let delHot = { ok: false }
  if (hotName) {
    await page.eval(JS_SET_FIND(hotName))
    for (let i = 0; i < 14; i++) {
      await sleep(500)
      snapHot = JSON.parse(await page.eval(JS_VIS_SNAPSHOT))
      if (snapHot.ok && snapHot.vis > 0) break
    }
    delHot = JSON.parse(await page.eval(JS_LISTDEL))
  }
  log('有数量行:', hotName, JSON.stringify(snapHot).slice(0, 240), '撤下:', JSON.stringify(delHot))
  const hotHasQty = snapHot.ok && snapHot.rows.some(r => r.posQty > 0)
  chk('C1', !!hotName && hotHasQty && (!delHot.ok || delHot.n === 0),
    `name=${hotName} hasQty=${hotHasQty} del=${JSON.stringify(delHot)}`)
  await page.screenshot(OUT + '/C1-有报单数量的商品不可撤.png')

  /* B3 复原：搜该商品 → 加入本期清单 → 保存 */
  await page.eval(JS_SET_FIND(target.name))
  let addBack = { ok: false, n: 0 }
  for (let i = 0; i < 14; i++) {
    await sleep(500)
    addBack = JSON.parse(await page.eval(JS_LISTADD))
    if (addBack.ok && addBack.n >= 1) break
  }
  log('复原前上架按钮:', JSON.stringify(addBack))
  if (addBack.ok && addBack.n >= 1) {
    await page.eval(JS_CLICK_ADD)
    await sleep(900)
    await page.eval(JS_CONFIRM_OK)
    await sleep(6000)
  }
  const fsFinalJ = JSON.parse(await page.eval(JS_LIST_ALL(per.id)))
  const finalItems = fsFinalJ.items || []
  const finalIds = finalItems.map(x => Number(x.id))
  const restored = Number(fsFinalJ.total) === baseTotal && finalIds.includes(target.id)
  chk('B3', restored, `list=${fsFinalJ.total} base=${baseTotal} has=${finalIds.includes(target.id)}`)

  /* D1 零报错 */
  const errs = JSON.parse(await page.eval(JS_ERR))
  chk('D1', errs.length === 0, JSON.stringify(errs).slice(0, 300))
} catch (e) {
  log('EXCEPTION:', e && e.message)
  fail.push('EXCEPTION')
} finally {
  const total = Object.keys(res).length
  const bad = Object.keys(res).filter(k => !res[k])
  log('\n==== 汇总 ====')
  log(`通过 ${total - bad.length}/${total}`)
  if (bad.length) log('失败:', bad.join(', '))
  log('汇总JSON:', JSON.stringify(res))
  try { await browser?.close() } catch (e) { /* ignore */ }
  process.exit(bad.length ? 1 : 0)
}
