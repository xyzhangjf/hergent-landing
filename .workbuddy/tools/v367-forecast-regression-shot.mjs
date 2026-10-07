/* v367 真机回归探针（只读）—— 证明上线后预报页正常渲染、无 JS 报错，
   并抓取表头以核对「差异」列与趋势列。
   🔴 绝不点击任何写按钮（保存/定稿/导入/删除）。 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = 'https://hergent.cn'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/artifacts/v367'
fs.mkdirSync(OUT, { recursive: true })

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
console.log('登录:', JSON.stringify(login))

await page.goto(BASE + '/#/forecast')
await new Promise(r => setTimeout(r, 7000))

const info = await page.eval(`(() => {
  const t = document.body.innerText || ''
  const ths = [...document.querySelectorAll('thead th')].map(e => (e.innerText||'').replace(/\\s+/g,' ').trim()).filter(Boolean)
  const thAlign = [...document.querySelectorAll('thead th')].slice(0, 40).map(e => {
    const cls = e.className || ''
    return /spark-th/.test(cls) ? { cls:'spark-th', txt:(e.innerText||'').trim(), align:getComputedStyle(e).textAlign } : null
  }).filter(Boolean)
  return {
    hash: location.hash,
    hasErrPage: t.includes('页面出错了') || t.includes('出错了'),
    errText: (t.match(/出错了[^\\n]{0,60}/) || [''])[0],
    thCount: ths.length,
    thsSample: ths.slice(0, 40),
    has差异: ths.some(x => x.includes('差异')),
    sparkTh: thAlign,
    toastCount: document.querySelectorAll('.toast').length,
    dockExists: !!document.querySelector('.notif-dock'),
  }
})()`)
console.log(JSON.stringify(info, null, 1).slice(0, 4000))
console.log('页面错误:', (page.errors || []).slice(0, 8))

await page.screenshot(OUT + '/forecast-回归.png')
console.log('截图:', OUT + '/forecast-回归.png')
await br.close()
