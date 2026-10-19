/**
 * v612 验证：在「改单」里补录商品 → 保存 → **小程序报单页立刻能看到**（新增同步进本期商品清单），
 * 以及「删行 → 保存」会把它从清单移除（用户 2026-10-19 拍板选 B）。
 *
 * 背景（用户原话）：「我想增加报单商品，增加后小程序实时可以看到，正确的路径是什么」
 *   小程序报单页 `/api/products/fill-search` **只读** `forecast_import_products`（本期商品清单），
 *   而 save-matrix 此前只写报单明细、从不写清单 ⇒ Web 端补录的商品，小程序永远搜不到。
 *
 * 判据清单
 *   Z0 构建号 v612
 *   Z1 查看态就绪（有行）
 *   S0 期次与清单对齐：fill-search(period) 条数 == 改单网格行数（否则选错期次 ⇒ 立即中止，不写任何数据）
 *   S1 候选商品：在售档案里、**不在**本期清单、名称唯一、有售价/规格（便于断言"没被清零"）
 *   A1 进入改单 → 点「补录商品」→ 末行名称格写入候选名
 *   A2 点「保存」→ 出现保存成功 toast
 *   B1 保存回执点名「小程序商品清单：新增 1 个」
 *   B2 fill-search 里出现该商品，且总数 = 基线 +1
 *   B3 该商品在清单**末尾**（sort_no 递增，与 Web 端新增行排最后一致）
 *   B4 商品档案未被污染（售价/规格/单位与保存前逐字一致）
 *   C1 重新进改单 → 找到该行 → 删除（确认）→ 保存
 *   C2 回执点名「移除 1 个」
 *   C3 fill-search 里该商品消失，且总数回到基线
 *   D1 全程零页面报错
 *   D2 结束时档案仍与开始时一致
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v612'
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

const JS_TOASTS = `(() => JSON.stringify([...document.querySelectorAll('.notif-dock .toast .toast-msg')]
  .map(x => (x.textContent || '').trim())))()`

/* 通用带 token 的 GET（Bearer 免 CSRF） */
const JS_GET = (url) => `(async () => {
  const t = localStorage.getItem('hergent_v2_token') || ''
  const r = await fetch(${JSON.stringify(url)}, { headers: { Authorization: 'Bearer ' + t } })
  let d = null
  try { d = await r.json() } catch (e) { d = null }
  return JSON.stringify({ s: r.status, d: d })
})()`

/* 期次：优先「今天落在窗口内且 open」的那一期 */
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
const JS_CONFIRM = `(() => {
  const m = document.querySelector('.imp-modal, .modal, [role="dialog"]'); if (!m) return JSON.stringify({ ok: false })
  const b = [...m.querySelectorAll('button')].find(x => /仍要|确定|进入|确认/.test(x.textContent || ''))
  if (!b) return JSON.stringify({ ok: false }); b.click(); return JSON.stringify({ ok: true }) })()`

/* 点「补录商品」：真点（按钮在工具栏，需先滚到可见） */
const JS_ADD_ROW = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('补录商品') && x.offsetParent !== null)
  if (!b) return JSON.stringify({ ok: false, why: 'no-btn' })
  b.scrollIntoView({ block: 'center' })
  const r = b.getBoundingClientRect()
  return JSON.stringify({ ok: true, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) })
})()`

/* 末行名称格赋名（v-model 需要原生 setter + input 事件；@change 进撤销栈） */
const JS_SET_LAST_NAME = (nm) => `(() => {
  const wrap = document.querySelector('.edit-grid-wrap'); if (!wrap) return JSON.stringify({ ok: false, why: 'no-wrap' })
  const trs = [...wrap.querySelectorAll('tbody tr')].filter(t => t.getBoundingClientRect().height > 0)
  const tr = trs[trs.length - 1]; if (!tr) return JSON.stringify({ ok: false, why: 'no-row' })
  const inp = tr.querySelector('input.cell-name'); if (!inp) return JSON.stringify({ ok: false, why: 'no-input' })
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  inp.focus()
  setter.call(inp, ${JSON.stringify(nm)})
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  inp.dispatchEvent(new Event('change', { bubbles: true }))
  inp.blur()
  return JSON.stringify({ ok: true, val: inp.value, rows: trs.length })
})()`

const JS_SAVE_BTN = `(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '保存' && x.offsetParent !== null)
  if (!b) return JSON.stringify({ ok: false, why: 'no-btn' })
  b.scrollIntoView({ block: 'center' })
  const r = b.getBoundingClientRect()
  return JSON.stringify({ ok: true, disabled: !!b.disabled, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) })
})()`

/* 在改单里删掉指定名称的那一行：点该行 .btn-del（需横向滚到最右） */
const JS_DEL_ROW = (nm) => `(() => {
  const wrap = document.querySelector('.edit-grid-wrap'); if (!wrap) return JSON.stringify({ ok: false, why: 'no-wrap' })
  const sc = wrap.querySelector('.edit-scroll') || wrap
  sc.scrollLeft = sc.scrollWidth
  const trs = [...wrap.querySelectorAll('tbody tr')].filter(t => t.getBoundingClientRect().height > 0)
  const tr = trs.find(t => {
    const i = t.querySelector('input.cell-name')
    return i && i.value.trim() === ${JSON.stringify(nm)}
  })
  if (!tr) return JSON.stringify({ ok: false, why: 'row-not-found', n: trs.length })
  const b = tr.querySelector('button.btn-del'); if (!b) return JSON.stringify({ ok: false, why: 'no-del' })
  b.scrollIntoView({ block: 'center' })
  const r = b.getBoundingClientRect()
  return JSON.stringify({ ok: true, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) })
})()`

const JS_CONFIRM_DEL = `(() => {
  const m = document.querySelector('.imp-modal, .modal, [role="dialog"]'); if (!m) return JSON.stringify({ ok: false })
  const b = [...m.querySelectorAll('button')].find(x => /确定|确认|删除/.test(x.textContent || ''))
  if (!b) return JSON.stringify({ ok: false }); b.click(); return JSON.stringify({ ok: true }) })()`

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
  const clickAt = async (x, y) => {
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
    await sleep(110)
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await sleep(360)
  }

  await page.goto(BASE, 3000)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 1800)
  await page.raw.send('Page.reload', {})
  await sleep(9000)
  const build = await page.eval(`(() => document.documentElement.dataset.build || '?')()`)
  log('构建号:', build)
  chk('Z0', String(build).includes('v612'), String(build))
  await page.eval(JS_HOOK)

  let v = { ok: false }
  for (let i = 0; i < 16; i++) {
    v = JSON.parse(await page.eval(JS_VIEW_ROWS))
    if (v.ok && v.rows > 0) break
    await sleep(700)
  }
  chk('Z1', v.ok && v.rows > 0 && !v.inEdit, JSON.stringify(v))
  await page.screenshot(OUT + '/Z1-查看态.png')

  const per = JSON.parse(await page.eval(JS_PICK_PERIOD))
  log('期次:', JSON.stringify(per))
  if (!per.ok) throw new Error('没有可用的进行中期次，中止（不写任何数据）')

  const fsBase = JSON.parse(await page.eval(JS_GET(`/api/products/fill-search?period_id=${per.id}&limit=800`)))
  const baseItems = (fsBase.d && (fsBase.d.items || fsBase.d.products)) || []
  const baseIds = baseItems.map(x => Number(x.id))
  log('清单基线:', baseIds.length, '条')
  await page.screenshot(OUT + '/S0-清单基线.png')

  /* ── 进改单，核对清单条数 == 网格行数（防止选错期次就动手） ── */
  log('进入改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(1200)
  const cm = JSON.parse(await page.eval(JS_CONFIRM))
  if (cm.ok) { log('改单确认弹窗：已确认'); await sleep(2600) } else await sleep(2600)
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

  /* ── 选候选商品：在售档案里、不在清单、名称唯一、有售价/规格 ── */
  const grid = JSON.parse(await page.eval(JS_GET('/api/products/grid')))
  const all = (grid.d && grid.d.items) || []
  const nameCount = {}
  all.forEach(p => { const n = String(p.name || '').trim(); nameCount[n] = (nameCount[n] || 0) + 1 })
  const cand = (Number(process.env.HG_CAND) > 0
    ? all.find(p => Number(p.id) === Number(process.env.HG_CAND))
    : null) || all.find(p => Number(p.id) > 0 && !baseIds.includes(Number(p.id))
    && String(p.name || '').trim() && nameCount[String(p.name).trim()] === 1
    && Number(p.sale_price) > 0 && String(p.spec || '').trim())
  if (!cand) throw new Error('找不到合适的候选商品（在售、不在清单、名称唯一、有售价与规格）')
  const before = { id: Number(cand.id), name: String(cand.name).trim(), spec: String(cand.spec || ''), unit: String(cand.unit || ''), sale: Number(cand.sale_price) }
  log('S1 候选:', JSON.stringify(before))
  chk('S1', true, `pid=${before.id}`)

  /* ── A1 补录 ── */
  const addBtn = JSON.parse(await page.eval(JS_ADD_ROW))
  if (addBtn.ok) await clickAt(addBtn.x, addBtn.y)
  await sleep(1200)
  const setName = JSON.parse(await page.eval(JS_SET_LAST_NAME(before.name)))
  log('A1 末行名称格:', JSON.stringify(setName))
  const ed2 = JSON.parse(await page.eval(JS_EDIT_ROWS))
  chk('A1', setName.ok && setName.val === before.name && ed2.total === ed.total + 1,
    `rows=${ed.total}→${ed2 && ed2.total}`)
  await page.screenshot(OUT + '/A1-补录商品行.png')

  /* ── A2 保存 ── */
  const sb = JSON.parse(await page.eval(JS_SAVE_BTN))
  log('保存按钮:', JSON.stringify(sb))
  if (sb.ok && !sb.disabled) await clickAt(sb.x, sb.y)
  await sleep(1200)
  /* 保存前可能弹「有 N 行缺少商品名称」——本次不会；并发冲突才会弹 */
  const c2 = JSON.parse(await page.eval(JS_CONFIRM))
  if (c2.ok) { log('保存确认弹窗：已确认'); await sleep(900) }
  let ts = []
  for (let i = 0; i < 20; i++) {
    ts = JSON.parse(await page.eval(JS_TOASTS))
    if ((ts || []).some(t => t.includes('已保存') || t.includes('保存失败') || t.includes('冲突'))) break
    await sleep(600)
  }
  log('A2 保存 toast:', JSON.stringify(ts))
  chk('A2', (ts || []).some(t => t.includes('已保存')), JSON.stringify(ts))
  chk('B1', (ts || []).some(t => t.includes('小程序商品清单') && t.includes('新增 1')),
    (ts || []).filter(t => t.includes('清单')).join(' | '))
  await page.screenshot(OUT + '/B1-保存回执含清单变更.png')

  /* ── B2 小程序侧（fill-search）立刻可见 ── */
  await sleep(1500)
  const fs1 = JSON.parse(await page.eval(JS_GET(`/api/products/fill-search?period_id=${per.id}&limit=800`)))
  const items1 = (fs1.d && (fs1.d.items || fs1.d.products)) || []
  const ids1 = items1.map(x => Number(x.id))
  const pos = ids1.indexOf(before.id)
  log('B2 清单条数:', ids1.length, '| 候选位置:', pos, '/', ids1.length - 1)
  chk('B2', pos >= 0 && ids1.length === baseIds.length + 1, `${baseIds.length}→${ids1.length} pos=${pos}`)
  chk('B3', pos === ids1.length - 1, `pos=${pos} last=${ids1.length - 1}`)

  const grid2 = JSON.parse(await page.eval(JS_GET('/api/products/grid')))
  const p2 = ((grid2.d && grid2.d.items) || []).find(x => Number(x.id) === before.id) || {}
  const same = String(p2.spec || '') === before.spec && String(p2.unit || '') === before.unit
    && Number(p2.sale_price) === before.sale
  log('B4 档案对比:', JSON.stringify({ spec: p2.spec, unit: p2.unit, sale: p2.sale_price }))
  chk('B4', same && String(p2.name).trim() === before.name, JSON.stringify({ spec: p2.spec, unit: p2.unit, sale: p2.sale_price }))
  await page.screenshot(OUT + '/B2-小程序清单已含新商品.png')

  /* ── C 删行 → 清单移除 ── */
  const edNow = JSON.parse(await page.eval(JS_VIEW_ROWS))
  log('保存后回到查看态:', JSON.stringify(edNow))
  log('再次进入改单:', await page.eval(JS_ENTER_EDIT))
  await sleep(1400)
  const c3 = JSON.parse(await page.eval(JS_CONFIRM))
  if (c3.ok) { log('改单确认弹窗：已确认'); }
  await sleep(3000)
  const del = JSON.parse(await page.eval(JS_DEL_ROW(before.name)))
  log('C1 定位待删行:', JSON.stringify(del))
  if (del.ok) await clickAt(del.x, del.y)
  await sleep(900)
  const cd = JSON.parse(await page.eval(JS_CONFIRM_DEL))
  log('删除确认:', JSON.stringify(cd))
  await sleep(900)
  const sb2 = JSON.parse(await page.eval(JS_SAVE_BTN))
  if (sb2.ok && !sb2.disabled) await clickAt(sb2.x, sb2.y)
  await sleep(1200)
  const c4 = JSON.parse(await page.eval(JS_CONFIRM))
  if (c4.ok) await sleep(900)
  let ts2 = []
  for (let i = 0; i < 20; i++) {
    ts2 = JSON.parse(await page.eval(JS_TOASTS))
    if ((ts2 || []).some(t => t.includes('已保存') || t.includes('保存失败'))) break
    await sleep(600)
  }
  log('C1 删除后保存 toast:', JSON.stringify(ts2))
  const removedTip = (ts2 || []).some(t => t.includes('小程序商品清单') && t.includes('移除 1'))
  chk('C1', del.ok && (ts2 || []).some(t => t.includes('已保存')), JSON.stringify(del))
  chk('C2', removedTip, (ts2 || []).filter(t => t.includes('清单')).join(' | '))

  await sleep(1500)
  const fs2 = JSON.parse(await page.eval(JS_GET(`/api/products/fill-search?period_id=${per.id}&limit=800`)))
  const ids2 = ((fs2.d && (fs2.d.items || fs2.d.products)) || []).map(x => Number(x.id))
  log('C3 清单条数:', ids2.length, '| 候选仍在:', ids2.includes(before.id))
  chk('C3', !ids2.includes(before.id) && ids2.length === baseIds.length, `${ids2.length} vs ${baseIds.length}`)
  await page.screenshot(OUT + '/C3-删行后清单已移除.png')

  const grid3 = JSON.parse(await page.eval(JS_GET('/api/products/grid')))
  const p3 = ((grid3.d && grid3.d.items) || []).find(x => Number(x.id) === before.id) || {}
  chk('D2', String(p3.spec || '') === before.spec && String(p3.unit || '') === before.unit
    && Number(p3.sale_price) === before.sale, JSON.stringify({ spec: p3.spec, unit: p3.unit, sale: p3.sale_price }))

  const errs = JSON.parse(await page.eval(JS_ERR))
  chk('D1', (errs || []).length === 0, JSON.stringify(errs))
} catch (e) {
  log('EXCEPTION', e && e.message)
  fail.push('EXC')
} finally {
  const total = Object.keys(res).length + (fail.includes('EXC') ? 1 : 0)
  log('\n结果:', Object.values(res).filter(Boolean).length + '/' + total, '通过',
    fail.length ? ('｜失败：' + fail.join('、')) : '')
  if (fail.includes('EXC')) process.exitCode = 1
  try { await browser.close() } catch (e) { /* 已关闭 */ }
}
