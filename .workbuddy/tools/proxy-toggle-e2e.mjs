/**
 * proxy-toggle-e2e.mjs —— 副驾「自动降级 / 直连通道」用户开关验收（真机、只读）
 *
 * 要证（用户视角）：
 *   ① 开关**默认开启**，按钮显示「自动降级」，发消息走代理
 *   ② 点一下 ⇒ 变「直连通道」，发消息走既有 /hermes
 *   ③ 再点一下 ⇒ 回到「自动降级」，又走代理
 *   ⇒ 用户不用懂技术、不用改 localStorage，自己就能开/关。
 *
 * 🔴 只读：唯一写是 localStorage（token + 开关）。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/副驾代理层-2026-09-24'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)
try { fs.mkdirSync(SHOT_DIR, { recursive: true }) } catch { /* ignore */ }

let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; log('  ✅ ' + n + (e ? '　→ ' + e : '')) } else { fail++; log('  ❌ ' + n + (e ? '　→ ' + e : '')) } }

const JS_LOGIN = 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:"mptestsp",password:"Mpsup@1"})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO";'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'

const JS_SPY = '(function(){window.__urls=[];if(!window.__of){window.__of=window.fetch;}'
  + 'window.fetch=function(u,o){try{var s=(typeof u==="string")?u:((u&&u.url)||"");window.__urls.push(s);}catch(_){}'
  + 'return window.__of.apply(this,arguments);};return "spy"})()'

const JS_OPEN = '(function(){var d=document.querySelector(".copilot");if(d)return "already";'
  + 'var b=document.querySelector(".tb-copilot");if(!b)return "no-btn";b.click();return "clicked"})()'

const JS_BTN = '(function(){var b=document.querySelector(".cp-proxy-btn");'
  + 'return JSON.stringify({has:!!b,label:b?b.textContent.trim():null,'
  + 'on:b?b.classList.contains("on"):null,'
  + 'pref:localStorage.getItem("hergent_copilot_proxy")})})()'

const JS_CLICK_BTN = '(function(){var b=document.querySelector(".cp-proxy-btn");if(!b)return "no-btn";b.click();return "clicked"})()'

const JS_FILL = '(function(){var ta=document.querySelector(".cp-input");if(!ta)return "no-ta";'
  + 'var st=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;'
  + 'st.call(ta,"只回复两个字：收到");ta.dispatchEvent(new Event("input",{bubbles:true}));return "filled"})()'
const JS_SEND = '(function(){var btn=document.querySelector(".cp-send");'
  + 'if(!btn)return "no-btn";if(btn.disabled)return "DISABLED";btn.click();return "sent"})()'

const JS_URLS = '(function(){var u=(window.__urls||[]);return JSON.stringify({'
  + 'proxy:u.filter(function(x){return x.indexOf("/api/ai/copilot/chat")>=0}).length,'
  + 'hermes:u.filter(function(x){return x.indexOf("/hermes")>=0}).length})})()'

const browser = await launch({ headless: true })
const page = await browser.newPage()
await page.enable()

async function sendOnce(tag) {
  await page.eval('window.__urls=[];"reset"')
  await page.eval(JS_FILL)
  await sleep(400)
  const r = await page.eval(JS_SEND)
  await sleep(4000)
  const u = JSON.parse(await page.eval(JS_URLS))
  log(`  [${tag}] send=${r} proxy=${u.proxy} hermes=${u.hermes}`)
  return u
}

try {
  await page.goto(BASE + '/', 5000)
  const lr = await page.eval(JS_LOGIN)
  if (String(lr).slice(0, 2) === 'NO') throw new Error('登录失败')
  await page.goto(BASE + '/', 5000)
  await page.eval(JS_SPY)
  await page.eval(JS_OPEN)
  await sleep(1200)

  log('== ① 默认态 ==')
  let b = JSON.parse(await page.eval(JS_BTN))
  ok(b.has, '开关按钮存在', JSON.stringify(b))
  ok(b.label === '自动降级' && b.on === true, '默认开启，按钮显示「自动降级」', b.label)
  let u = await sendOnce('默认')
  ok(u.proxy >= 1 && u.hermes === 0, '默认走代理', `proxy=${u.proxy} hermes=${u.hermes}`)
  await page.screenshot(SHOT_DIR + '/P2-开关-默认开启.png')

  log('\n== ② 点一下关闭 ==')
  await page.eval(JS_CLICK_BTN)
  await sleep(500)
  b = JSON.parse(await page.eval(JS_BTN))
  ok(b.label === '直连通道' && b.on === false, '按钮变为「直连通道」', b.label)
  ok(b.pref === '0', '偏好已持久化（localStorage=0）', String(b.pref))
  u = await sendOnce('关闭后')
  ok(u.hermes >= 1 && u.proxy === 0, '关闭后走既有 /hermes（不再走代理）', `proxy=${u.proxy} hermes=${u.hermes}`)
  await page.screenshot(SHOT_DIR + '/P2-开关-关闭为直连.png')

  log('\n== ③ 再点一下开回来 ==')
  await page.eval(JS_CLICK_BTN)
  await sleep(500)
  b = JSON.parse(await page.eval(JS_BTN))
  ok(b.label === '自动降级' && b.on === true, '按钮回到「自动降级」', b.label)
  u = await sendOnce('再开启')
  ok(u.proxy >= 1 && u.hermes === 0, '重新走代理', `proxy=${u.proxy} hermes=${u.hermes}`)
  await page.screenshot(SHOT_DIR + '/P2-开关-重新开启.png')

  log('\n== 控制台 ==')
  ok((page.errors || []).length === 0, '全程 0 控制台报错',
    (page.errors || []).length ? JSON.stringify((page.errors || []).slice(0, 3)) : '')
} catch (e) {
  fail++; log('  ❌ 探针异常：' + (e && e.message ? e.message : e))
} finally {
  log('\n===== 代理层用户开关探针：PASS ' + pass + ' / FAIL ' + fail + ' =====')
  log('截图目录：' + SHOT_DIR)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
