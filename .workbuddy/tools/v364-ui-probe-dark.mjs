/* v364 深色模式证据：强制 html.dark，重截 ② 本月到货面板（v362 栽过「深色下白块」） */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = 'https://hergent.cn'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/到货按月停单-v364-2026-10-02'
const smoke = fs.readFileSync('/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/hergent-forecast-smoke.mjs', 'utf8')
const USER = /HG_USER \|\| '([^']*)'/.exec(smoke)[1]
const PASS = /HG_PASS \|\| '([^']*)'/.exec(smoke)[1]
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const br = await launch({})
const page = await br.newPage()
await page.enable()
const ev = (e, a) => page.eval(e, a)

await page.goto(BASE + '/')
await sleep(3500)
await ev(`(async () => {
  const r = await fetch('/api/auth/login', {method:'POST',
    headers:{'Content-Type':'application/json','X-Client':'web'},
    body: JSON.stringify({username:${JSON.stringify(USER)},password:${JSON.stringify(PASS)}})})
  const d = await r.json()
  localStorage.setItem('hergent_v2_token', d.access_token || d.token || '')
  localStorage.setItem('hergent_v2_tenant', String(d.tenant_id || ''))
  localStorage.setItem('hergent_v2_user', JSON.stringify(d.user || {}))
})()`, true)
await page.goto(BASE + '/#/rebate')
await sleep(6000)

/* 强制深色：与 store.setTheme 同一条路径（html 上的 light/dark 类） */
const themed = await ev(`(() => {
  document.documentElement.classList.remove('light'); document.documentElement.classList.add('dark')
  return document.documentElement.className
})()`)
console.log('html.class =', themed)

await ev(`(() => { const b=[...document.querySelectorAll('button.main-tab')].find(x=>(x.innerText||'').trim()==='目标与返利'); if(b) b.click() })()`)
await sleep(2500)
await ev(`(() => {
  const tr=[...document.querySelectorAll('tr')].find(t=>(t.innerText||'').includes('蒙牛鲜奶'))
  const b=tr && [...tr.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='编辑'); if(b) b.click()
})()`)
await sleep(3000)
await ev(`(() => { const a=document.querySelector('.arr-stat'); if(a) a.scrollIntoView({block:'center'}) })()`)
await sleep(600)

/* 量一下三块的实际底色，证明**不是白块**（浅色底 = 本次要排除的缺陷） */
const colors = await ev(`(() => {
  const lum = (c) => { const m = c.match(/\\d+/g); if (!m) return null
    const [r,g,b] = m.map(Number); return Math.round((0.2126*r + 0.7152*g + 0.0722*b)) }
  const pick = (sel) => { const e = document.querySelector(sel); if (!e) return null
    const s = getComputedStyle(e); return { sel, bg: s.backgroundColor, color: s.color, lum: lum(s.backgroundColor) } }
  return { html: getComputedStyle(document.documentElement).backgroundColor,
           items: ['.arr-stat-i','.arr-day','.arr-day.off','.ap-skip-note','.arrival-block'].map(pick) }
})()`)
console.log(JSON.stringify(colors, null, 1))

const r = await ev(`(() => {
  const sels=['.arr-stat','.arr-days','.ap-skip-note']
  const els=sels.map(s=>document.querySelector(s)).filter(Boolean)
  els[0].scrollIntoView({block:'center'})
  const bs=els.map(e=>e.getBoundingClientRect())
  const x=Math.min(...bs.map(b=>b.x)), y=Math.min(...bs.map(b=>b.y))
  const x2=Math.max(...bs.map(b=>b.x+b.width)), y2=Math.max(...bs.map(b=>b.y+b.height))
  return {x:Math.max(0,x-14), y:Math.max(0,y-14), width:(x2-x)+28, height:(y2-y)+28}
})()`)
const res = await page.raw.send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } })
fs.writeFileSync(OUT + '/04-深色模式-本月到货面板.png', Buffer.from(res.result.data, 'base64'))
console.log('  [截图] ' + OUT + '/04-深色模式-本月到货面板.png')
console.log('页面错误:', page.errors.slice(0, 3))
await br.close()
