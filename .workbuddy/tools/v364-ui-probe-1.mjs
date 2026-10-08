/* v364 界面层真机探针 —— 第 1 阶段：侦察 #/rebate 的 DOM（只读，不点任何写按钮） */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = 'https://hergent.cn'
const smoke = fs.readFileSync('/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/hergent-forecast-smoke.mjs', 'utf8')
const USER = /HG_USER \|\| '([^']*)'/.exec(smoke)[1]
const PASS = /HG_PASS \|\| '([^']*)'/.exec(smoke)[1]

const br = await launch({})
const page = await br.newPage()
await page.enable()
await page.goto(BASE + '/')
await new Promise(r => setTimeout(r, 3500))

const login = await page.eval(`(async () => {
  const r = await fetch('/api/auth/login', {method:'POST',
    headers:{'Content-Type':'application/json','X-Client':'web'},
    body: JSON.stringify({username:${JSON.stringify(USER)},password:${JSON.stringify(PASS)}})})
  const d = await r.json()
  if (!r.ok) return {ok:false, status:r.status, d}
  localStorage.setItem('hergent_v2_token', d.access_token || d.token || '')
  localStorage.setItem('hergent_v2_tenant', String(d.tenant_id || d.tenant || ''))
  localStorage.setItem('hergent_v2_user', JSON.stringify(d.user || {}))
  return {ok:true, tenant_id:d.tenant_id, role:(d.user||{}).role, name:(d.user||{}).name}
})()`, true)
console.log('登录:', JSON.stringify(login, null, 1))

await page.goto(BASE + '/#/rebate')
await new Promise(r => setTimeout(r, 6000))

const info = await page.eval(`(() => {
  const t = document.body.innerText || ''
  const btns = [...document.querySelectorAll('button,a')].map(b => (b.innerText||'').trim()).filter(Boolean)
  const rows = [...document.querySelectorAll('tr')].map(tr => (tr.innerText||'').replace(/\\s+/g,' ').trim()).slice(0,14)
  return { path: location.hash, title: document.title,
           hasErr: t.includes('页面出错了'),
           menus: [...document.querySelectorAll('nav *')].map(e=>(e.innerText||'').trim()).filter(x=>x&&x.length<12).slice(0,25),
           tabs: [...document.querySelectorAll('.pg-tabs *,.tab *,[class*=tab]')].map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,20),
           btnSample: [...new Set(btns)].slice(0,45), rows }
})()`)
console.log(JSON.stringify(info, null, 1).slice(0, 3500))
console.log('页面错误:', page.errors.slice(0, 5))
fs.writeFileSync('/tmp/v364-shot-stage1.png', await page.screenshot())
await br.close()
