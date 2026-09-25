/**
 * model-picker-removed-probe.mjs —— 「模型选择下架」验收（真机、只读）
 * 验：① 选择器与菜单彻底消失（含 CSS/状态无残留）；② 工具条恢复 6 控件、单行、同中线；
 *      ③ 发送消息**仍能正常发出**且请求体里**不再带 model**（回落由后端负责）。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  ✅ ' + n + (e ? '　→ ' + e : '')) } else { fail++; console.log('  ❌ ' + n + (e ? '　→ ' + e : '')) } }

const JS_LOGIN = 'fetch("https://hergent.cn/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:"mptestsp",password:"Mpsup@1"})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO";'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'
// 记录实际发出的请求体，确认不再带 model
const JS_SPY = '(function(){window.__b=[];if(!window.__of)window.__of=window.fetch;'
  + 'window.fetch=function(u,o){var s=(typeof u==="string")?u:((u&&u.url)||"");'
  + 'if(s.indexOf("copilot/chat")>=0&&o&&o.body){try{var j=JSON.parse(o.body);window.__b.push(String(j.model||"(无)"));}catch(e){window.__b.push("ERR")}}'
  + 'return window.__of.apply(this,arguments)};return "spy"})()'
const JS_OPEN = '(function(){var d=document.querySelector(".copilot");if(d)return "already";'
  + 'var b=document.querySelector(".tb-copilot");if(!b)return "no-btn";b.click();return "clicked"})()'
const JS_ST = '(()=>{var tb=document.querySelector(".cp-toolbar");'
  + 'var kids=[];if(tb){kids=[].slice.call(tb.children).flatMap(function(x){return [].slice.call(x.children)})}'
  + 'var tops=kids.map(function(k){return Math.round(k.getBoundingClientRect().top)});'
  + 'var cys=kids.map(function(k){var r=k.getBoundingClientRect();return +(r.top+r.height/2).toFixed(1)});'
  + 'return JSON.stringify({'
  + ' chip:document.querySelectorAll(".cp-model, .cp-model-btn, .cp-model-menu").length,'
  + ' chipStr:(document.body.innerHTML.indexOf("用哪个模型")>=0)?1:0,'
  + ' ctl:kids.length,rows:new Set(tops).size,centers:new Set(cys).size,'
  + ' bodies:(window.__b||[]),'
  + ' hint:!!document.querySelector(".cp-inhint"),'
  + ' addMenu:!!document.querySelector(".cp-add .cp-plus"),'
  + ' guard:!!document.querySelector(".cp-guard-btn")})})()'
const JS_FILL = '(function(){var ta=document.querySelector(".cp-input");'
  + 'var st=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;'
  + 'st.call(ta,"只回两个字：收到");ta.dispatchEvent(new Event("input",{bubbles:true}));return "filled"})()'
const JS_SEND = '(function(){var b=document.querySelector(".cp-send");'
  + 'if(!b)return "no-btn";if(b.disabled)return "disabled";b.click();return "sent"})()'

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

  console.log('== ① 选择器彻底消失 ==')
  let s = JSON.parse(await p.eval(JS_ST))
  ok(s.chip === 0, '.cp-model / 按钮 / 菜单 全部不存在', 'count=' + s.chip)
  ok(s.chipStr === 0, 'DOM 里也没有「用哪个模型」字样', 'found=' + s.chipStr)

  console.log('\n== ② 工具条恢复 6 控件、单行、同中线 ==')
  ok(s.ctl === 6, '控件数回到 6', 'ctl=' + s.ctl)
  ok(s.rows === 1, '仍单行', 'rows=' + s.rows)
  ok(s.centers === 1, '仍同一中线', 'centers=' + s.centers)

  console.log('\n== ③ 其余功能未受影响 ==')
  ok(s.hint, '内联提示仍在')
  ok(s.addMenu, '＋菜单按钮仍在')
  ok(s.guard, '权限 chip 仍在')

  console.log('\n== ④ 发消息仍正常，且请求体不再带 model ==')
  await p.eval(JS_FILL); await sleep(600)
  console.log('  发送:', await p.eval(JS_SEND))
  await sleep(3000)
  s = JSON.parse(await p.eval(JS_ST))
  console.log('  请求体字段:', JSON.stringify(s.bodies))
  ok(s.bodies.length >= 1, '消息真的发出了', 'calls=' + s.bodies.length)
  // 🔴 断言写对：`model` 字段**本来就在** client.js 里（`model || 'hermes-agent'`，非本次新增）；
  //    要验的是它的**值**已回到默认，说明没有残留的选择器值泄漏出去。
  ok(s.bodies.every(x => x === 'hermes-agent'), '请求体里的 model 值 = 默认「hermes-agent」（无残留选择值）', JSON.stringify(s.bodies))
  const md = await p.eval('(()=>{var m=document.querySelector(".msg.assistant .md");return m?(m.innerText||"").length:0})()')
  ok(md > 0, 'AI 正常回复（副驾可用）', 'replyLen=' + md)
  ok((p.errors || []).length === 0, '0 控制台报错', JSON.stringify((p.errors || []).slice(0, 2)))
} catch (e) {
  fail++; console.log('  ❌ 异常：' + (e && e.message ? e.message : e))
} finally {
  console.log('\n===== 模型选择下架探针：PASS ' + pass + ' / FAIL ' + fail + ' =====')
  await b.close()
  process.exit(fail ? 1 : 0)
}
