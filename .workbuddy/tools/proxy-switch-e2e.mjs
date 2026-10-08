/**
 * proxy-switch-e2e.mjs —— 副驾后端代理层·前端开关 路由验证（只读）
 *
 * 要证：开关 **打开** ⇒ 请求打到 `/api/ai/copilot/chat`（不再打 `/hermes`）；
 *       开关 **关闭** ⇒ 仍然打 `/hermes`（既有链路零影响，回归）。
 *
 * 说明：本账号（supervisor）没有 chat 模块权限 ⇒ 代理会 403，但这正是我们想验的
 *      **路由**（URL 被请求过即可），不代表功能可用；功能面已在后端单独验过。
 * 🔴 只读：唯一写是 localStorage（token + 开关）。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/副驾代理层-2026-09-24'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)
try { fs.mkdirSync(SHOT_DIR, { recursive: true }) } catch { /* ignore */ }

let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; log('  ✅ ' + n + (e ? '　→ ' + e : '')) } else { fail++; log('  ❌ ' + n + (e ? '　→ ' + e : '')) } }

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO";'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'

/* 记录所有 fetch 的 URL（不拦截，只旁路记录） */
const JS_SPY = '(function(){window.__urls=[];if(!window.__of){window.__of=window.fetch;}'
  + 'window.fetch=function(u,o){try{var s=(typeof u==="string")?u:((u&&u.url)||"");window.__urls.push(s);}catch(_){}'
  + 'return window.__of.apply(this,arguments);};return "spy"})()'

const JS_OPEN = '(function(){var d=document.querySelector(".copilot");if(d)return "already";'
  + 'var b=document.querySelector(".tb-copilot");if(!b)return "no-btn";b.click();return "clicked"})()'

/* 🔴 必须「填值 → 等一拍 → 再点」：草稿为空时 .cp-send 是 disabled 的，
   同一个 tick 内填完就 click 会点到禁用态上（实测踩过）。 */
const JS_FILL = '(function(){var ta=document.querySelector(".cp-input");if(!ta)return "no-ta";'
  + 'var st=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;'
  + 'st.call(ta,"只回复两个字：收到");ta.dispatchEvent(new Event("input",{bubbles:true}));return "filled"})()'
const JS_CLICK = '(function(){var btn=document.querySelector(".cp-send");'
  + 'if(!btn)return "no-btn";if(btn.disabled)return "DISABLED";btn.click();return "sent"})()'

const JS_URLS = '(function(){return JSON.stringify({urls:(window.__urls||[]).slice(),'
  + 'proxy:(window.__urls||[]).filter(function(u){return u.indexOf("/api/ai/copilot/chat")>=0}).length,'
  + 'hermes:(window.__urls||[]).filter(function(u){return u.indexOf("/hermes")>=0}).length})})()'

const browser = await launch({ headless: true })
const page = await browser.newPage()
await page.enable()
try {
  await page.goto(BASE + '/', 5000)
  const lr = await page.eval(JS_LOGIN(USER, PASS))
  if (String(lr).slice(0, 2) === 'NO') throw new Error('登录失败')
  await page.goto(BASE + '/', 5000)
  await page.eval(JS_SPY)
  await page.eval(JS_OPEN)
  await sleep(800)

  log('== 开关打开（hergent_copilot_proxy=1）==')
  await page.eval('localStorage.setItem("hergent_copilot_proxy","1");"on"')
  await page.eval(JS_FILL)
  await sleep(400)
  log('  click: ' + await page.eval(JS_CLICK))
  await sleep(3000)
  let s = JSON.parse(await page.eval(JS_URLS))
  ok(s.proxy >= 1, '请求打到代理端点 /api/ai/copilot/chat', 'proxy=' + s.proxy)
  ok(s.hermes === 0, '不再直连 /hermes', 'hermes=' + s.hermes)
  await page.screenshot(SHOT_DIR + '/01-开关打开-走代理.png')

  log('\n== 开关关闭（回归：仍走既有 /hermes）==')
  await page.eval('localStorage.removeItem("hergent_copilot_proxy");"off"')
  await page.eval('window.__urls=[];"reset"')
  await page.eval(JS_FILL)
  await sleep(400)
  log('  click: ' + await page.eval(JS_CLICK))
  await sleep(3500)
  s = JSON.parse(await page.eval(JS_URLS))
  ok(s.hermes >= 1, '关闭后仍走既有 /hermes 链路（回归安全）', 'hermes=' + s.hermes)
  ok(s.proxy === 0, '关闭后不再打代理端点', 'proxy=' + s.proxy)
  await page.screenshot(SHOT_DIR + '/02-开关关闭-走既有链路.png')

  log('\n== 控制台 ==')
  ok((page.errors || []).length === 0, '全程 0 控制台报错',
    (page.errors || []).length ? JSON.stringify(page.errors.slice(0, 3)) : '')
} catch (e) {
  fail++; log('  ❌ 探针异常：' + (e && e.message ? e.message : e))
} finally {
  log('\n===== 代理层前端开关探针：PASS ' + pass + ' / FAIL ' + fail + ' =====')
  log('截图目录：' + SHOT_DIR)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
