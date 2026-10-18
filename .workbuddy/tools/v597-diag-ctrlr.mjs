/**
 * v597 诊断：Ctrl+R 为什么没生效（focus / 分支可达性）
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
const BASE = 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const JS_LOGIN = 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"mptestsp",password:"Mpsup@1"})}).then(r=>r.json()).then(d=>{localStorage.setItem("hergent_v2_token",d.token);if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return JSON.stringify({ok:!!d.token})})'

const browser = await launch()
const page = await browser.newPage()
await page.enable()
const moveNone = (x, y) => page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
const down = (x, y) => page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
const up = (x, y) => page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
const click1 = async (x, y) => { await moveNone(x, y); await down(x, y); await up(x, y); await sleep(400) }
const key = async (k, code, vk, modifiers = 0) => {
  await page.raw.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers })
  await page.raw.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers })
}
const JS_CELL = (i, j) => `(() => {
  const tbl = document.querySelector('table.edit-tbl')
  const rows = [...tbl.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('td.qty-cell'))
  const td = rows[${i}].querySelectorAll('td.qty-cell')[${j}]
  const r = td.getBoundingClientRect()
  return JSON.stringify({ dr: td.getAttribute('data-r'), dc: td.getAttribute('data-c'),
    x: +(r.left + r.width/2).toFixed(1), y: +(r.top + r.height/2).toFixed(1) })
})()`
const ACTIVE = `(() => { const a = document.activeElement; return JSON.stringify({ tag: a && a.tagName, cls: a && a.className && String(a.className).slice(0,40), inTbl: !!(a && a.closest && a.closest('table.edit-tbl')) }) })()`

await page.goto(BASE, 3500)
console.log('login', await page.eval(JS_LOGIN))
await page.goto(BASE + '/#/forecast', 7000)
await sleep(4000)
await page.eval(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('改单')&&x.offsetParent!==null); if(b)b.click(); return 1 })()`)
await sleep(1000)
const cf = await page.eval(`(() => { const m=document.querySelector('.imp-modal,.modal,[role="dialog"]'); if(!m) return JSON.stringify({ok:false}); const b=[...m.querySelectorAll('button')].find(x=>/仍要|确定|进入|确认/.test(x.textContent||'')); if(!b) return JSON.stringify({ok:false}); b.click(); return JSON.stringify({ok:true}) })()`)
console.log('confirm', cf)
await sleep(1600)

const a = JSON.parse(await page.eval(JS_CELL(4, 0)))
const b = JSON.parse(await page.eval(JS_CELL(4, 3)))
console.log('cells', a, b)
await click1(a.x, a.y)
await page.raw.send('Input.insertText', { text: '77' })
await sleep(150)
await key('Tab', 'Tab', 9)
await sleep(300)
console.log('active after tab', await page.eval(ACTIVE))

await moveNone(a.x, a.y); await down(a.x, a.y)
await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y, button: 'left' })
await sleep(250)
await up(b.x, b.y)
await sleep(400)
console.log('active after drag', await page.eval(ACTIVE))
console.log('rangeSel', await page.eval(`(() => document.querySelectorAll('td.range-sel').length)()`))
console.log('sel td', await page.eval(`(() => { const t=document.querySelector('td.selected'); return t ? t.getAttribute('data-r')+','+t.getAttribute('data-c') : 'none' })()`))

// 用页面内合成事件先证明分支存在
console.log('synthetic', await page.eval(`(() => {
  const tbl = document.querySelector('table.edit-tbl')
  const ev = new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', metaKey: true, bubbles: true, cancelable: true })
  tbl.dispatchEvent(ev)
  return JSON.stringify({ prevented: ev.defaultPrevented })
})()`))
await sleep(600)
console.log('toasts', await page.eval(`(() => JSON.stringify([...document.querySelectorAll('*')].filter(x=>x.children.length===0&&/已向右|只在报单|请先框选/.test(x.textContent||'')).map(x=>x.textContent.trim()).slice(-3)))()`))
console.log('row values', await page.eval(`(() => {
  const tbl=document.querySelector('table.edit-tbl')
  const rows=[...tbl.querySelectorAll('tbody tr')].filter(tr=>tr.querySelector('td.qty-cell'))
  return JSON.stringify([...rows[4].querySelectorAll('td.qty-cell')].slice(0,6).map(td=>(td.querySelector('input')||{}).value))
})()`))

// 再试真实 Meta+R
await key('r', 'KeyR', 82, 4)
await sleep(700)
console.log('after real meta+r toasts', await page.eval(`(() => JSON.stringify([...document.querySelectorAll('*')].filter(x=>x.children.length===0&&/已向右|只在报单|请先框选/.test(x.textContent||'')).map(x=>x.textContent.trim()).slice(-3)))()`))

await browser.close()
