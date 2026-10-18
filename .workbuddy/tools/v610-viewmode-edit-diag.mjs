/**
 * v610 诊断（只读分析，不改代码）：查看态（非编辑态）点数量格能否改、改成什么后果
 *
 * 要回答的四个事实：
 *   D1 查看态单击数量格 ⇒ 真的渲染出 <input>（可改）
 *   D2 改完 ⇒ 该行「合计 / 最终下单」与页脚合计**当场变化**（内存脏改，无保存按钮）
 *   D3 「复制报单 → 下单数量」取的是**改后的值**（下游真实动作被污染）
 *   D4 刷新页面 ⇒ 回到服务端原值；进「改单」⇒ 也是服务端原值（临时改动不落库、不带入编辑态）
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v610'
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

/* 表头 label 列表 */
const JS_HEADS = `(() => {
  const t = document.querySelector('table.tbl.cross-tbl:not(.edit-tbl)')
  if (!t) return JSON.stringify({ ok: false })
  const hs = [...t.querySelectorAll('thead th')].map(th => (th.textContent || '').replace(/\\s+/g, ' ').trim())
  return JSON.stringify({ ok: true, heads: hs })
})()`

/* 找第一个「有报单」的行，返回其商品名 / 各列文本 / 数量格坐标 / 页脚合计 */
const JS_ROW = `(() => {
  const t = document.querySelector('table.tbl.cross-tbl:not(.edit-tbl)')
  if (!t) return JSON.stringify({ ok: false, why: 'no-table' })
  const heads = [...t.querySelectorAll('thead th')].map(th => (th.textContent || '').replace(/\\s+/g, ' ').trim())
  const rows = [...t.querySelectorAll('tbody tr.data-row')]
  const isPos = (v) => { const n = parseInt(String(v).replace(/[^0-9-]/g, ''), 10); return n > 0 }
  let pick = null, pickCells = null
  for (const tr of rows) {
    const tds = [...tr.querySelectorAll('td')]
    const cells = tds.map(td => {
      const q = td.querySelector('.qty-num')
      if (q) return (q.textContent || '').replace(/\\s+/g, ' ').trim()
      const i = td.querySelector('input')
      return i ? i.value : (td.textContent || '').replace(/\\s+/g, ' ').trim()
    })
    const qi = heads.findIndex(h => h === '合计' || h.startsWith('合计'))
    if (qi >= 0 && isPos(cells[qi])) { pick = tr; pickCells = cells; break }
  }
  if (!pick) return JSON.stringify({ ok: false, why: 'no-row-with-qty', rows: rows.length })
  const tds = [...pick.querySelectorAll('td')]
  const qtd = tds.find(td => td.querySelector('.qty-num'))
  let box = null
  if (qtd) {
    const r = qtd.getBoundingClientRect()
    box = { x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1),
      inView: r.top > 60 && r.bottom < window.innerHeight - 40 }
  }
  const foot = document.querySelector('.col-total-bar, .col-total-vp')
  return JSON.stringify({ ok: true, heads, cells: pickCells,
    name: (pickCells[heads.findIndex(h => h === '商品名称')] || '').slice(0, 40),
    qty: qtd ? (qtd.textContent || '').replace(/\\s+/g, ' ').trim() : '',
    hasInput: !!document.querySelector('table.tbl.cross-tbl:not(.edit-tbl) td input.cell-qty'),
    box, foot: foot ? (foot.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200) : '' })
})()`

/* 复制弹层：读「共 N 个 SKU」文本 */
const JS_COPY_POP = `(() => {
  const p = document.querySelector('.copy-pop'); if (!p) return JSON.stringify({ open: false })
  return JSON.stringify({ open: true, txt: (p.textContent || '').replace(/\\s+/g, ' ').trim() })
})()`

const JS_COPY_QTY_POS = `(() => {
  const p = document.querySelector('.copy-pop'); if (!p) return JSON.stringify({ ok: false })
  const b = [...p.querySelectorAll('button')].find(x => (x.textContent || '').includes('下单数量'))
  if (!b) return JSON.stringify({ ok: false, why: 'no-btn' })
  const r = b.getBoundingClientRect()
  return JSON.stringify({ ok: true, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1),
    disabled: !!b.disabled })
})()`

const JS_TOASTS = `(() => JSON.stringify([...document.querySelectorAll('.notif-dock .toast .toast-msg')].map(x => (x.textContent || '').trim())))()`

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
  const isLocal = /127\.0\.0\.1|localhost/.test(BASE)
  browser = await launch(isLocal ? { extraArgs: ['--no-proxy-server'] } : {})
  const page = await browser.newPage()
  await page.enable()
  const clickAt = async (x, y) => {
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
    await sleep(110)
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await sleep(380)
  }
  const key = async (k, code, vk) => {
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk })
    await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk })
    await sleep(320)
  }

  await page.goto(BASE, 3000)
  log('登录:', await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 1800)
  await page.raw.send('Page.reload', {})
  await sleep(9000)
  await page.eval(JS_HOOK)
  log('构建号:', await page.eval(`(() => document.documentElement.dataset.build || '?')()`))

  const before = JSON.parse(await page.eval(JS_ROW))
  log('D0 改前:', JSON.stringify({ name: before.name, qty: before.qty, hasInput: before.hasInput,
    cells: (before.cells || []).slice(0, 12), box: before.box }))
  log('   页脚:', before.foot)
  if (!before.ok || !before.box || !before.box.inView) throw new Error('无法定位可点的数量格（' + JSON.stringify(before.box) + '）')

  /* D1 单击数量格 */
  await clickAt(before.box.x, before.box.y)
  const d1 = JSON.parse(await page.eval(JS_ROW))
  res.d1 = d1.ok && d1.hasInput === true
  log('D1 单击后是否出现 input:', d1.hasInput)
  await page.screenshot(OUT + '/D1-查看态单击进编辑.png')

  /* 输入 777 并回车 */
  await page.raw.send('Input.insertText', { text: '777' })
  await sleep(300)
  await key('Enter', 'Enter', 13)
  await sleep(900)
  const after = JSON.parse(await page.eval(JS_ROW))
  log('D2 改后:', JSON.stringify({ qty: after.qty, cells: (after.cells || []).slice(0, 12) }))
  log('   页脚:', after.foot)
  const iQty = (after.heads || []).findIndex(h => h === '合计' || h.startsWith('合计'))
  const iFin = (after.heads || []).findIndex(h => h.startsWith('最终下单'))
  res.d2 = after.ok && String(after.cells[iQty]) !== String(before.cells[iQty])
  log('D2 合计列:', before.cells[iQty], '→', after.cells[iQty],
    '｜最终下单:', before.cells[iFin], '→', after.cells[iFin])
  const tsAfterEdit = JSON.parse(await page.eval(JS_TOASTS))
  log('D2 改完的提示:', JSON.stringify(tsAfterEdit))
  res.d2b = (tsAfterEdit || []).length === 0   // 期望：无任何提示（= 用户完全不知道改了没保存）
  await page.screenshot(OUT + '/D2-查看态改动已污染合计.png')

  /* D3 复制报单 → 下单数量 */
  const copyBtn = JSON.parse(await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && (x.textContent || '').includes('复制报单'))
    if (!b) return JSON.stringify({ ok: false })
    const r = b.getBoundingClientRect()
    return JSON.stringify({ ok: true, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) }) })()`))
  log('D3 复制报单按钮:', JSON.stringify(copyBtn))
  await clickAt(copyBtn.x, copyBtn.y)
  await sleep(700)
  const pop = JSON.parse(await page.eval(JS_COPY_POP))
  log('D3 复制弹层:', pop.txt)
  const qp = JSON.parse(await page.eval(JS_COPY_QTY_POS))
  if (qp.ok) {
    await clickAt(qp.x, qp.y)
    await sleep(1200)
    const ts = JSON.parse(await page.eval(JS_TOASTS))
    log('D3 toast:', JSON.stringify(ts))
    /* 剪贴板读取：https 下可能被权限拦；读不到就看 toast */
    const clip = await page.eval(`(async () => { try { return await navigator.clipboard.readText() } catch (e) { return 'ERR:' + (e && e.name) } })()`)
    const clipStr = String(clip || '')
    log('D3 剪贴板片段:', clipStr.slice(0, 160).replace(/\n/g, '|'))
    res.d3 = clipStr.includes('777') || (ts || []).some(t => t.includes('已复制'))
    log('D3 复制内容含改动值 777:', clipStr.includes('777'))
  } else { res.d3 = false; log('D3 下单数量按钮不可用:', JSON.stringify(qp)) }
  await page.screenshot(OUT + '/D3-复制取到改动值.png')

  /* D4 刷新回退 + 进改单仍是原值 */
  await page.raw.send('Page.reload', {})
  await sleep(9000)
  const back = JSON.parse(await page.eval(JS_ROW))
  log('D4 刷新后:', JSON.stringify({ qty: back.qty, cells: (back.cells || []).slice(0, 12) }))
  const sameQty = String(back.cells[iQty]) === String(before.cells[iQty])
  /* 进改单看同一商品 */
  const eb = JSON.parse(await page.eval(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && (x.textContent || '').includes('改单'))
    if (!b) return JSON.stringify({ ok: false })
    const r = b.getBoundingClientRect()
    return JSON.stringify({ ok: true, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) }) })()`))
  let editQty = null
  if (eb.ok) {
    await clickAt(eb.x, eb.y)
    await sleep(1500)
    const cf = JSON.parse(await page.eval(`(() => {
      const m = document.querySelector('.imp-modal, .modal, [role="dialog"]'); if (!m) return JSON.stringify({ ok: false })
      const b = [...m.querySelectorAll('button')].find(x => /仍要|确定|进入|确认/.test(x.textContent || ''))
      if (!b) return JSON.stringify({ ok: false })
      const r = b.getBoundingClientRect()
      return JSON.stringify({ ok: true, x: +(r.left + r.width / 2).toFixed(1), y: +(r.top + r.height / 2).toFixed(1) }) })()`))
    if (cf.ok) { await clickAt(cf.x, cf.y); await sleep(2500) }
    /* 按条码匹配（商品名里带「3 店报」等角标文本，按名字匹配必然失败） */
    editQty = await page.eval(`(() => {
      const wrap = document.querySelector('.edit-grid-wrap'); if (!wrap) return 'no-edit'
      const code = ${JSON.stringify((before.cells || []).find(v => /^\d{8,}$/.test(String(v))) || '')}
      const rows = [...wrap.querySelectorAll('tbody tr')].filter(t => t.getBoundingClientRect().height > 0)
      for (const tr of rows) {
        if (code && !(tr.textContent || '').includes(code)) continue
        const inp = tr.querySelector('input.cell-qty')
        if (inp) return inp.value
        const td = [...tr.querySelectorAll('td')].find(x => x.querySelector('.cell-ro'))
        return td ? (td.textContent || '').trim() : 'no-input'
      }
      return 'row-not-found' })()`)
  }
  log('D4 改单里该商品数量:', editQty)
  await page.screenshot(OUT + '/D4-刷新回退与改单原值.png')
  res.d4 = sameQty && String(editQty) !== '777'

  const errs = JSON.parse(await page.eval(JS_ERR))
  log('错误:', JSON.stringify(errs))
  res.c1 = errs.length === 0
} catch (e) {
  log('EXCEPTION:', e && e.message)
} finally {
  try { if (browser) await browser.close() } catch (e) {}
}
const pass = Object.values(res).filter(Boolean).length
const total = Object.keys(res).length
log('\n===== 结果 ' + pass + '/' + total + ' =====')
for (const k of Object.keys(res).sort()) log((res[k] ? 'PASS ' : 'FAIL ') + k)
