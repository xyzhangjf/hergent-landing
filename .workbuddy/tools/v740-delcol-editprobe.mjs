/* 改单态删列：✕ 是否可点 / 点后列是否消失 / 保存载荷是否真的带上 hidden_customers
   —— 全程**不发保存请求**（fetch 拦截并把 body 抓下来），只在最后 reload 回服务端真相 */
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

await p.goto('https://hergent.cn/#/forecast', 6000)
await p.eval(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='改单');if(b)b.click()})()`)
await new Promise(r => setTimeout(r, 6000))

const qtyHeads = () => p.eval(`JSON.stringify([...document.querySelectorAll('.edit-tbl thead th.qty-th')].map(t=>({
  name: (t.querySelector('input.cell-cust')||{}).value || '',
  delVisible: (()=>{const d=t.querySelector('.col-del'); if(!d) return 'none'; const r=d.getBoundingClientRect(); return r.width>0&&r.height>0 ? 'visible' : 'zero-size'})(),
  rect: (()=>{const d=t.querySelector('.col-del'); if(!d) return null; const r=d.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})()
})))`)

/* 🔴 先把目标列滚进视口 —— 该列在 23 列的最右端（x≈3107），不滚是点不到的 */
await p.eval(`(function(){
  const t=[...document.querySelectorAll('.edit-tbl thead th.qty-th')].find(t=>(t.querySelector('input.cell-cust')||{}).value==='${TARGET}')
  if(t) t.scrollIntoView({block:'nearest', inline:'center'})
})()`)
await new Promise(r => setTimeout(r, 900))
const hs0 = JSON.parse(await qtyHeads())
const idx = hs0.findIndex(h => h.name === TARGET)
console.log('① 改单态客户列 ' + hs0.length + ' 个；目标下标=' + idx + '；✕=' + (hs0[idx] ? hs0[idx].delVisible : 'NA') + ' rect=' + JSON.stringify(hs0[idx] && hs0[idx].rect))

/* 拦截保存请求，只抓 body 不发出去 */
await p.eval(`(function(){
  window.__cap = null
  const orig = window.fetch
  window.fetch = function(u, o){
    const url = typeof u === 'string' ? u : (u && u.url) || ''
    if (url.indexOf('save-matrix') >= 0) {
      window.__cap = (o && o.body) || ''
      return Promise.resolve(new Response(JSON.stringify({success:true, saved_customers:0, new_rev:'probe'}), {status:200, headers:{'Content-Type':'application/json'}}))
    }
    return orig.apply(this, arguments)
  }
})()`)

/* 真实点击该列的 ✕ */
const r0 = hs0[idx].rect
if (!r0) { console.log('!! 目标列没有 ✕'); await b.close(); process.exit(1) }
const M = (t, x, y, btn = 'left', buttons = 1) => p.raw.send('Input.dispatchMouseEvent', { type: t, x, y, button: btn, buttons, clickCount: 1 })
const cx = Math.round(r0.x + r0.w / 2), cy = Math.round(r0.y + r0.h / 2)
await M('mouseMoved', cx, cy, 'none', 0); await M('mousePressed', cx, cy); await M('mouseReleased', cx, cy, 'left', 0)
await new Promise(r => setTimeout(r, 800))
const hs1 = JSON.parse(await qtyHeads())
console.log('② 点 ✕ 后：客户列 ' + hs1.length + ' 个；还含目标=' + hs1.some(h => h.name === TARGET) + '；toast=' +
  JSON.stringify(await p.eval(`((document.querySelector('.toast-wrap,.toast,.hg-toast')||{}).innerText||'').trim()`)))

/* 点保存（被拦截） */
await p.eval(`(function(){const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='保存');if(b&&!b.disabled)b.click()})()`)
await new Promise(r => setTimeout(r, 2500))
const cap = await p.eval(`window.__cap || ''`)
if (!cap) { console.log('③ 没抓到 save-matrix 请求（保存按钮可能被门禁挡住）'); }
else {
  const j = JSON.parse(cap)
  console.log('③ 保存载荷：customers=' + j.customers.length + ' 含目标=' + j.customers.includes(TARGET) +
    ' | hidden_customers=' + JSON.stringify(j.hidden_customers) +
    ' | rows=' + j.rows.length + ' | period_id=' + j.period_id)
  const qtyNonZero = j.rows.reduce((s, r) => s + Object.values(r.qty_by_unit || {}).filter(v => Number(v) > 0).length, 0)
  console.log('   载荷里非零数量格数=' + qtyNonZero + '（>0 说明是完整矩阵，不是空壳）')
}
await b.close()
