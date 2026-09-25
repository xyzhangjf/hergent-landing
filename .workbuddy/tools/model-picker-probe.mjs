/**
 * model-picker-probe.mjs —— 「模型选择」端到端验收（真机）
 * 最关键的一条：**选「专业版」后，SSE 里回来的 model 字段必须真的变成 deepseek-v4-pro**
 *   —— 只验证 UI 文案变化是不够的（那可能只是个假控件）。
 * 另外验：菜单内容/说明、持久化、与其它下拉互斥、工具条仍单行且同中线。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/输入框对比-2026-09-25'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
try { fs.mkdirSync(DIR, { recursive: true }) } catch { /* ignore */ }
let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  ✅ ' + n + (e ? '　→ ' + e : '')) } else { fail++; console.log('  ❌ ' + n + (e ? '　→ ' + e : '')) } }

const JS_LOGIN = 'fetch("https://hergent.cn/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:"mptestsp",password:"Mpsup@1"})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO";'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'localStorage.removeItem("hergent_chat_model");return "OK"})'
const JS_SPY = '(function(){window.__m=[];if(!window.__of)window.__of=window.fetch;'
  + 'window.fetch=function(u,o){var s=(typeof u==="string")?u:((u&&u.url)||"");'
  + 'if(s.indexOf("copilot/chat")>=0&&o&&o.body){try{window.__m.push(JSON.parse(o.body).model||"?")}catch(e){window.__m.push("ERR")}}'
  + 'return window.__of.apply(this,arguments)};return "spy"})()'
const JS_OPEN = '(function(){var d=document.querySelector(".copilot");if(d)return "already";'
  + 'var b=document.querySelector(".tb-copilot");if(!b)return "no-btn";b.click();return "clicked"})()'
const JS_ST = '(()=>{var c=document.querySelector(".cp-model-btn");var m=document.querySelector(".cp-model-menu");'
  + 'var tb=document.querySelector(".cp-toolbar");'
  + 'var kids=[];if(tb){kids=[].slice.call(tb.children).flatMap(function(x){return [].slice.call(x.children)})}'
  + 'var tops=kids.map(function(k){return Math.round(k.getBoundingClientRect().top)});'
  + 'var cys=kids.map(function(k){var r=k.getBoundingClientRect();return +(r.top+r.height/2).toFixed(1)});'
  + 'return JSON.stringify({label:c?c.innerText.replace(/\\s+/g," ").trim():"",menu:!!m,'
  + ' hd:m?(m.querySelector(".cp-role-menu-hd")||{}).innerText||"":"",'
  + ' items:m?[].slice.call(m.querySelectorAll(".cp-role-item")).map(function(e){return e.innerText.replace(/\\s+/g," ").trim()}):[],'
  + ' on:m?(function(){var o=m.querySelector(".cp-role-item.on .cp-role-item-name");return o?o.innerText.trim():""})():"",'
  + ' ls:localStorage.getItem("hergent_chat_model"),ctl:kids.length,rows:new Set(tops).size,centers:new Set(cys).size,'
  + ' sent:(window.__m||[])})})()'
const JS_CLICK = '(function(){var b=document.querySelector(".cp-model-btn");if(!b)return "no";b.click();return "ok"})()'
const JS_PICK = (i) => '(function(){var m=document.querySelector(".cp-model-menu");if(!m)return "no-menu";'
  + 'var it=m.querySelectorAll(".cp-role-item")[' + i + '];if(!it)return "no-item";it.click();return "ok"})()'
const JS_FILL = '(function(){var ta=document.querySelector(".cp-input");if(!ta)return "no-ta";'
  + 'var st=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;'
  + 'st.call(ta,"只回两个字：收到");ta.dispatchEvent(new Event("input",{bubbles:true}));return "filled"})()'
const JS_SEND = '(function(){var b=document.querySelector(".cp-send");'
  + 'if(!b)return "no-btn";if(b.disabled)return "still-disabled";b.click();return "sent"})()'

const b = await launch({ headless: true })
const p = await b.newPage()
await p.enable()
try {
  await p.goto(BASE + '/', 5000)
  await p.eval(JS_LOGIN)
  await p.goto(BASE + '/', 5000)
  await p.eval(JS_SPY)
  await p.eval(JS_OPEN)
  await sleep(1600)

  console.log('== ① 模型 chip 与菜单 ==')
  let s = JSON.parse(await p.eval(JS_ST))
  ok(/标准版/.test(s.label), 'chip 默认显示「标准版」', s.label)
  ok(s.ctl === 7, '工具条控件数（+模型 = 7）', 'ctl=' + s.ctl)
  ok(s.rows === 1, '工具条仍**单行**不换行', 'rows=' + s.rows)
  ok(s.centers === 1, '所有控件仍**同一中线**', 'centers=' + s.centers)
  await p.eval(JS_CLICK); await sleep(350)
  s = JSON.parse(await p.eval(JS_ST))
  ok(s.menu, '点开后菜单出现')
  ok(/用哪个模型/.test(s.hd), '菜单标题为「用哪个模型」', s.hd)
  ok(s.items.length === 2, '两项模型', JSON.stringify(s.items))
  ok(s.items.some(x => /更强的核算/.test(x)), '带人话说明（不是只给模型 id）')
  await p.screenshot(DIR + '/模型选择-菜单.png')

  console.log('\n== ② 选「专业版」并**验证请求里真的换了模型** ==')
  await p.eval(JS_PICK(1)); await sleep(300)
  s = JSON.parse(await p.eval(JS_ST))
  ok(/专业版/.test(s.label), 'chip 变为「专业版」', s.label)
  ok(s.ls === 'deepseek-v4-pro', 'localStorage 已持久化', s.ls)
  console.log('  填入:', await p.eval(JS_FILL)); await sleep(600)
  console.log('  发送:', await p.eval(JS_SEND))
  await sleep(3000)
  s = JSON.parse(await p.eval(JS_ST))
  console.log('  浏览器实际发出的 model:', JSON.stringify(s.sent))
  ok(s.sent.includes('deepseek-v4-pro'), '**请求体里 model = deepseek-v4-pro**（不是假控件）', JSON.stringify(s.sent))

  console.log('\n== ③ 与其它下拉互斥 + 点外关闭 ==')
  const JS_CLICK_ROLE = '(function(){var b=document.querySelector(".cp-role");if(!b)return "no";b.click();return "ok"})()'
  await p.eval(JS_CLICK); await sleep(250)
  await p.eval(JS_CLICK_ROLE); await sleep(300)
  s = JSON.parse(await p.eval(JS_ST))
  ok(!s.menu, '打开「团队」下拉后，模型菜单已收起')
  await p.eval(JS_CLICK); await sleep(250)
  await p.eval('(function(){var t=document.querySelector(".cp-input");'
    + 't.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));return "ok"})()')
  await sleep(300)
  s = JSON.parse(await p.eval(JS_ST))
  ok(!s.menu, '点输入框（菜单外）后模型菜单收起')
  ok((p.errors || []).length === 0, '0 控制台报错', JSON.stringify((p.errors || []).slice(0, 2)))
} catch (e) {
  fail++; console.log('  ❌ 异常：' + (e && e.message ? e.message : e))
} finally {
  console.log('\n===== 模型选择探针：PASS ' + pass + ' / FAIL ' + fail + ' =====')
  await b.close()
  process.exit(fail ? 1 : 0)
}
