/**
 * reasoning-stream-probe.mjs —— 「深度思考（推理流）」渲染验收（只读）
 *
 * 🔴 为什么用桩：实测 **Hermes 目前不把模型的 `reasoning_content` 转发到对客户端的 SSE**
 *   （直连 DeepSeek 能看到逐字推理，但 Hermes 侧没透传）。所以这里**打桩注入**一段
 *   真实格式的推理帧，证明「前端这半边真的通」——不是又一条等不到数据的死路径。
 *   桩一旦撤掉即恢复真实网络；上游开始转发后无需再改前端。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/流式排查-2026-09-25'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
try { fs.mkdirSync(DIR, { recursive: true }) } catch { /* ignore */ }

let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  ✅ ' + n + (e ? '　→ ' + e : '')) } else { fail++; console.log('  ❌ ' + n + (e ? '　→ ' + e : '')) } }

const THINK = '用户问的是库存偏低的商品，我需要先用 check_inventory 拉实时库存，再和 safety_stock 比对，挑出低于安全库存的条目。注意这家客户有多个仓库，得按仓库分组再汇总。'
const ANSWER = '当前有 3 个 SKU 低于安全库存：0蔗糖5连包、0蔗糖草莓百利包、纯甄风味酸奶。建议优先补前两个。'

const JS_LOGIN = 'fetch("https://hergent.cn/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:"mptestsp",password:"Mpsup@1"})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO";'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'
const JS_OPEN = '(function(){var d=document.querySelector(".copilot");if(d)return "already";'
  + 'var b=document.querySelector(".tb-copilot");if(!b)return "no-btn";b.click();return "clicked"})()'

/* 桩：把 copilot 的 SSE 换成「先推理、后答案」的真实格式 */
const JS_STUB = '(function(){'
  + 'var RK=' + JSON.stringify(THINK) + ', AK=' + JSON.stringify(ANSWER) + ';'
  + 'function frame(o){return "data: "+JSON.stringify(o)+"\\n\\n";}'
  + 'var sse="";'
  + 'for(var i=0;i<RK.length;i+=8){sse+=frame({id:"c1",object:"chat.completion.chunk",model:"deepseek-flash",'
  + 'choices:[{index:0,delta:{content:null,reasoning_content:RK.slice(i,i+8)},finish_reason:null}]});}'
  + 'for(var k=0;k<AK.length;k+=8){sse+=frame({id:"c1",object:"chat.completion.chunk",model:"deepseek-flash",'
  + 'choices:[{index:0,delta:{content:AK.slice(k,k+8)},finish_reason:null}]});}'
  + 'sse+=frame({id:"c1",object:"chat.completion.chunk",choices:[{index:0,delta:{},finish_reason:"stop"}]});'
  + 'sse+="data: [DONE]\\n\\n";'
  + 'if(!window.__of){window.__of=window.fetch;}'
  + 'window.fetch=function(u,o){var s=(typeof u==="string")?u:((u&&u.url)||"");'
  + ' if(s.indexOf("/api/ai/copilot/chat")>=0){window.__stubbed++;'
  + '   return Promise.resolve(new Response(sse,{status:200,headers:{"Content-Type":"text/event-stream"}}));}'
  + ' return window.__of.apply(this,arguments);};window.__stubbed=0;return "stubbed"})()'

const JS_FILL = '(function(){var ta=document.querySelector(".cp-input");if(!ta)return "no-ta";'
  + 'var st=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;'
  + 'st.call(ta,"查库存");ta.dispatchEvent(new Event("input",{bubbles:true}));return "ok"})()'
const JS_SEND = '(function(){var b=document.querySelector(".cp-send");'
  + 'if(!b)return "no-btn";if(b.disabled)return "DISABLED";b.click();return "sent"})()'

const JS_ST = '(()=>{var o={};'
  + 'o.think=document.querySelectorAll(".msg-think").length;'
  + 'o.hdTxt=(document.querySelector(".mt-hd")||{}).innerText||"";'
  + 'o.bodyOpen=document.querySelectorAll(".mt-body").length;'
  + 'o.bodyTxt=(document.querySelector(".mt-body")||{}).innerText||"";'
  + 'o.mdLen=(document.querySelector(".msg.assistant .md")||{}).innerText?document.querySelector(".msg.assistant .md").innerText.length:0;'
  + 'o.stubbed=window.__stubbed||0;'
  + 'return JSON.stringify(o)})()'
const JS_CLICK_HD = '(function(){var b=document.querySelector(".mt-hd");if(!b)return "no";b.click();return "clicked"})()'

const b = await launch({ headless: true })
const p = await b.newPage()
await p.enable()
try {
  await p.goto(BASE + '/', 5000)
  await p.eval(JS_LOGIN)
  await p.goto(BASE + '/', 5000)
  await p.eval(JS_OPEN)
  await sleep(1200)
  console.log('打桩:', await p.eval(JS_STUB))
  await p.eval(JS_FILL)
  await sleep(400)
  console.log('发送:', await p.eval(JS_SEND))
  await sleep(2500)

  let s = JSON.parse(await p.eval(JS_ST))
  console.log('\n== 推理块已渲染 ==')
  ok(s.stubbed >= 1, '桩确实被调用（证明走的是被替换的流）', 'calls=' + s.stubbed)
  ok(s.think === 1, '出现「深度思考」块', 'think=' + s.think)
  ok(/深度思考/.test(s.hdTxt), '标题为「深度思考」', s.hdTxt.replace(/\s+/g, ' '))
  ok(new RegExp(String(THINK.length) + ' 字').test(s.hdTxt), '标题显示推理字数', s.hdTxt.replace(/\s+/g, ' '))
  ok(s.bodyOpen === 0, '默认折叠（正文未展开）', 'bodyOpen=' + s.bodyOpen)

  console.log('\n== 点开展开 ==')
  console.log('  点击:', await p.eval(JS_CLICK_HD))
  await sleep(400)
  s = JSON.parse(await p.eval(JS_ST))
  ok(s.bodyOpen === 1, '展开后正文出现', 'bodyOpen=' + s.bodyOpen)
  ok(s.bodyTxt.indexOf(THINK.slice(0, 12)) === 0, '正文内容 = 推理原文', s.bodyTxt.slice(0, 24) + '…')
  ok(s.mdLen > 0, '答案气泡同时也渲染了', 'mdLen=' + s.mdLen)
  await p.screenshot(DIR + '/深度思考-已展开.png')
  ok((p.errors || []).length === 0, '0 控制台报错', JSON.stringify((p.errors || []).slice(0, 3)))
} catch (e) {
  fail++; console.log('  ❌ 异常：' + (e && e.message ? e.message : e))
} finally {
  console.log('\n===== 推理流探针：PASS ' + pass + ' / FAIL ' + fail + ' =====')
  await b.close()
  process.exit(fail ? 1 : 0)
}
