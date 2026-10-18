/** 诊断：拖动到边缘时 elementFromPoint 到底命中了什么 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
const BASE = process.env.HG_BASE || 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json()).then(d=>{localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "ok"})'
const browser = await launch()
const page = await browser.newPage()
await page.enable()
const send = (t, x, y, b) => page.raw.send('Input.dispatchMouseEvent', { type: t, x, y, button: b, clickCount: 1 })
try {
  await page.goto(BASE, 3500)
  await page.eval(JS_LOGIN('mptestsp', 'Mpsup@1'))
  await page.goto(BASE + '/#/forecast', 7000)
  await sleep(4000)
  await page.eval(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('改单')&&x.offsetParent!==null); b&&b.click(); return 1 })()`)
  await sleep(900)
  await page.eval(`(() => { const m=document.querySelector('.imp-modal,.modal,[role="dialog"]'); if(!m)return 0; const b=[...m.querySelectorAll('button')].find(x=>/仍要|确定|进入|确认/.test(x.textContent||'')); b&&b.click(); return 1 })()`)
  await sleep(1600)
  const geo = await page.eval(`(() => {
    const w = document.querySelector('.edit-grid-wrap'); const r = w.getBoundingClientRect()
    const tbl = document.querySelector('table.edit-tbl')
    const rows = [...tbl.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td.qty-cell'))
    const td = rows[0].querySelectorAll('td.qty-cell')[0]
    const t = td.getBoundingClientRect()
    return JSON.stringify({ innerH: innerHeight, innerW: innerWidth, docH: document.documentElement.scrollHeight,
      wrTop: +r.top.toFixed(1), wrBottom: +r.bottom.toFixed(1), clientH: w.clientHeight, clientTop: w.clientTop,
      cTop: +(r.top + w.clientTop).toFixed(1), cBottom: +(r.top + w.clientTop + w.clientHeight).toFixed(1),
      cellX: +(t.left + t.width/2).toFixed(1), cellY: +(t.top + t.height/2).toFixed(1),
      handle: (() => { const h=td.querySelector('.fill-handle'); if(!h) return null; const q=h.getBoundingClientRect(); return [ +(q.left+q.width/2).toFixed(1), +(q.top+q.height/2).toFixed(1) ] })() })
  })()`)
  console.log('geo:', geo)
  const g = JSON.parse(geo)
  await send('mouseMoved', g.cellX, g.cellY, 'none')
  await send('mousePressed', g.cellX, g.cellY, 'left')
  await sleep(200)
  const hx = g.handle ? g.handle[0] : g.cellX + 45, hy = g.handle ? g.handle[1] : g.cellY + 15
  await send('mouseReleased', g.cellX, g.cellY, 'left')
  await sleep(300)
  // 重新按在填充柄上
  await send('mouseMoved', hx, hy, 'none')
  await send('mousePressed', hx, hy, 'left')
  await sleep(200)
  await send('mouseMoved', hx, g.cBottom + 40, 'left')
  await sleep(1200)
  const diag = await page.eval(`(() => {
    const w = document.querySelector('.edit-grid-wrap'); const r = w.getBoundingClientRect()
    const cBottom = r.top + w.clientTop + w.clientHeight
    const out = []
    for (const dy of [-60, -30, -20, -12, -4, 4, 12, 30]) {
      const y = cBottom + dy
      const el = document.elementFromPoint(1223, y)
      out.push({ dy, y: Math.round(y), tag: el ? el.tagName : null, cls: el ? String(el.className).slice(0, 40) : null,
        r: el && el.closest ? (el.closest('td[data-r]') ? el.closest('td[data-r]').getAttribute('data-r') + '/' + el.closest('td[data-r]').getAttribute('data-c') : null) : null })
    }
    return JSON.stringify({ innerH: innerHeight, cBottom: +cBottom.toFixed(1), scrollTop: Math.round(w.scrollTop), probes: out })
  })()`)
  console.log('diag:', diag)
  const mq = await page.eval(`(() => { const m=document.querySelector('.fill-marquee'); if(!m) return 'none'; const r=m.getBoundingClientRect(); return JSON.stringify({h:+r.height.toFixed(1),t:+r.top.toFixed(1),b:+r.bottom.toFixed(1)}) })()`)
  console.log('marquee:', mq)
} catch (e) {
  console.log('err', e && e.message)
} finally { await browser.close() }
process.exit(0)
