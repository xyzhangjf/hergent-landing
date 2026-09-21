#!/usr/bin/env node
/* v202 侦察探针 v2：拦截前端**真实**发出的请求（拿到它调 summary 的准确参数），
   并读主表实际 DOM 行。不写任何数据。 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/客户列删除被恢复排查-2026-09-19'
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = s => console.log(s)

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json().then(d=>({s:r.status,d:d})))'
  + '.then(r=>{var d=r.d;if(!d.token)return JSON.stringify({ok:false,status:r.s});'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return JSON.stringify({ok:true,user:(d.user&&d.user.username)||"",tenant:d.tenant_id})})'

/* 注入 fetch 拦截器：记录所有 /api/ 请求（方法 + URL），供我们看见前端真实调用的参数 */
const JS_PATCH_FETCH = '(()=>{if(window.__reqs)return "already";window.__reqs=[];'
  + 'var of=window.fetch;window.fetch=function(){try{var a=arguments[0];var u=(typeof a==="string")?a:(a&&a.url)||"";'
  + 'var m=(arguments[1]&&arguments[1].method)||"GET";'
  + 'if(u.indexOf("/api/")>=0)window.__reqs.push(m+" "+u);}catch(e){}return of.apply(this,arguments)};'
  + 'return "patched"})()'
const JS_REQS = '(window.__reqs||[]).slice(-25).join("\\n")'

const JS_CLICK_SIDEBAR = '(()=>{var all=Array.from(document.querySelectorAll("a,div,span,li,button"));'
  + 'var hit=all.find(x=>/预报订[单货]管理/.test((x.innerText||"").trim())&&(x.innerText||"").trim().length<20);'
  + 'if(hit){hit.click();return (hit.innerText||"").trim()}return ""})()'

/* 主表：行数 + 每行前 4 格文本（判断哪一格才是商品名） */
const JS_GRID = '(()=>{var tb=document.querySelectorAll("table.cross-tbl tbody tr");'
  + 'var out=[];for(var i=0;i<Math.min(tb.length,20);i++){'
  + 'var tds=tb[i].querySelectorAll("td");var a=[];'
  + 'for(var j=0;j<Math.min(tds.length,4);j++)a.push((tds[j].innerText||"").replace(/\\s+/g," ").trim().slice(0,26));'
  + 'out.push(a.join(" ⎪ "))}'
  + 'return JSON.stringify({domRows:tb.length,cells:out})})()'

/* 是否有虚拟滚动 / 一共多少行（页面内的提示文案） */
const JS_HINT = '(()=>{var t=(document.body.innerText||"").replace(/\\s+/g," ");'
  + 'var m=t.match(/(共\\s*\\d+\\s*行|\\d+\\s*\\/\\s*\\d+\\s*行|显示\\s*\\d+\\s*行|另有[^。]{0,24})/g)||[];'
  + 'var sc=document.querySelectorAll("[class*=scroll],[class*=virtual],[class*=vt]").length;'
  + 'return JSON.stringify({hints:m.slice(0,8),scrollish:[].constructor.name&&sc})})()'

let browser
try {
  fs.mkdirSync(OUT, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()
  log('=== v202 侦察 v2 ===')
  await page.goto(BASE, 3500)
  log('登录: ' + (await page.eval(JS_LOGIN(USER, PASS))))
  log('注入拦截器: ' + (await page.eval(JS_PATCH_FETCH)))
  await page.goto(BASE + '/#/', 4000)
  const entered = await page.eval(JS_CLICK_SIDEBAR)
  log('点侧栏: ' + (entered || '（回落 #/forecast）'))
  if (!entered) await page.goto(BASE + '/#/forecast', 5000)
  await sleep(4500)

  log('\n--- 前端真实发出的请求（末25条）---')
  log(await page.eval(JS_REQS))
  log('\n--- 提示文案 / 滚动容器 ---')
  log(await page.eval(JS_HINT))
  log('\n--- 主表 DOM（行数 + 前 20 行前 4 格）---')
  log(await page.eval(JS_GRID))

  const shot = OUT + '/v202-页面行序-侦察2-' + STAMP + '.png'
  try { await page.screenshot(shot); log('\n截图: ' + shot) } catch (e) { log('截图失败: ' + e.message) }
  log('console 错误数: ' + (page.errors || []).length)
} catch (e) {
  console.error('探针失败: ' + e.message)
  process.exitCode = 1
} finally {
  try { await browser?.close() } catch {}
}
