/* v740 验收：只读态右键菜单要有可点的「去改单里删列」；点它进改单；
   改单态点列头 ✕ 后必须弹出「点保存才生效」的提示。全程不点保存。 */
import { launch, CHROME_DEFAULT } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const TOKEN = (process.env.HG_TOKEN || fs.readFileSync('/tmp/probe_tok.txt', 'utf8')).trim()
const TARGET = process.env.HG_TARGET || '易胜玲'
const b = await launch({ headless: true, chromePath: CHROME_DEFAULT })
const p = await b.newPage(); await p.enable()
for (const c of [
  { name: 'erp_token', value: TOKEN, httpOnly: true },
  { name: 'hergent_auth', value: '1' }, { name: 'csrf_token', value: 'x' }, { name: 'hergent_tenant', value: '1' },
]) await p.raw.send('Network.setCookie', { ...c, domain: 'hergent.cn', path: '/', secure: true, sameSite: 'Lax' })
await p.raw.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false })
await p.goto('https://hergent.cn/#/forecast', 6500)

const build = await p.eval(`document.documentElement.dataset.build || (window.__HG_BUILD__||'')`)
console.log('① 线上版本 =', build)

/* 只读态右键目标列 */
const r = JSON.parse(await p.eval(`(function(){
  const th=[...document.querySelectorAll('.cross-viewport thead th')].find(t=>t.innerText.trim()==='${TARGET}')
  if(!th) return 'null'
  th.scrollIntoView({block:'nearest', inline:'center'})
  const b=th.getBoundingClientRect(); return JSON.stringify({x:b.x,y:b.y,w:b.width,h:b.height})
})()`))
const M = (t, x, y, btn = 'left', buttons = 1) => p.raw.send('Input.dispatchMouseEvent', { type: t, x, y, button: btn, buttons, clickCount: 1 })
if (!r) { console.log('找不到目标列'); await b.close(); process.exit(1) }
const x = Math.round(r.x + r.w / 2), y = Math.round(r.y + r.h / 2)
await M('mousePressed', x, y, 'right', 2); await M('mouseReleased', x, y, 'right', 0)
await new Promise(rr => setTimeout(rr, 600))
const menu = JSON.parse(await p.eval(`(function(){
  const m=[...document.querySelectorAll('.ctx-menu')].find(e=>e.getClientRects().length>0)
  if(!m) return JSON.stringify({open:false, n:document.querySelectorAll('.ctx-menu').length})
  return JSON.stringify({open:true, buttons:[...m.querySelectorAll('button')].map(b=>(b.innerText||'').trim()), note:(m.querySelector('.ctx-note')||{}).innerText||''})
})()`))
console.log('② 只读态右键菜单：', JSON.stringify(menu, null, 1))

/* 点「去改单里删列」 */
const clicked = await p.eval(`(function(){
  const m=[...document.querySelectorAll('.ctx-menu')].find(e=>e.getClientRects().length>0)
  if(!m) return 'no-menu'
  const b=[...m.querySelectorAll('button')].find(x=>/去改单里删列/.test(x.innerText||''))
  if(!b) return 'no-button'
  b.click(); return 'clicked'
})()`)
await new Promise(rr => setTimeout(rr, 6000))
const inEdit = await p.eval(`JSON.stringify({editMode:!!document.querySelector('.edit-tbl'), menuStillOpen:[...document.querySelectorAll('.ctx-menu')].some(e=>e.getClientRects().length>0)})`)
console.log('③ 点入口后：', clicked, inEdit)

/* 改单态点目标列的 ✕ */
await p.eval(`(function(){
  const t=[...document.querySelectorAll('.edit-tbl thead th.qty-th')].find(t=>(t.querySelector('input.cell-cust')||{}).value==='${TARGET}')
  if(t) t.scrollIntoView({block:'nearest', inline:'center'})
})()`)
await new Promise(rr => setTimeout(rr, 900))
const del = JSON.parse(await p.eval(`(function(){
  const t=[...document.querySelectorAll('.edit-tbl thead th.qty-th')].find(t=>(t.querySelector('input.cell-cust')||{}).value==='${TARGET}')
  if(!t) return 'null'
  const d=t.querySelector('.col-del'); if(!d) return JSON.stringify({noDel:true})
  const b=d.getBoundingClientRect()
  return JSON.stringify({x:Math.round(b.x+b.width/2), y:Math.round(b.y+b.height/2), w:b.width, h:b.height})
})()`))
if (!del || del.noDel) { console.log('④ 没找到 ✕', JSON.stringify(del)); await b.close(); process.exit(1) }
await M('mouseMoved', del.x, del.y, 'none', 0); await M('mousePressed', del.x, del.y); await M('mouseReleased', del.x, del.y, 'left', 0)
await new Promise(rr => setTimeout(rr, 800))
console.log('④ 点 ✕ 之后：' + await p.eval(`JSON.stringify({
  cols: document.querySelectorAll('.edit-tbl thead th.qty-th').length,
  still: [...document.querySelectorAll('.edit-tbl thead th.qty-th')].some(t=>(t.querySelector('input.cell-cust')||{}).value==='${TARGET}'),
  toast: ((document.querySelector('.toast-wrap,.toast,.hg-toast')||{}).innerText||'').replace(/\\s+/g,' ').trim()
})`))

/* 不加保存，直接退出（取消），避免任何写库 */
await p.eval(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='取消');if(b)b.click()})()`)
await new Promise(rr => setTimeout(rr, 1200))
console.log('⑤ 已点「取消」退出改单，未保存；当前客户列数=' + await p.eval(`document.querySelectorAll('.cross-viewport thead th.cust-col').length`))
await b.close()
