/**
 * stream-render-probe.mjs —— 副驾「流式输出 + 过程回复」渲染取证（只读，真机）
 *
 * 只回答一个问题：**老板在屏幕上到底看到了什么、什么时候看到的**。
 *  每 400ms 采样一次：助手气泡文本长度 / 三个点是否还在 / 工具步骤数 / 卡片是否出现。
 * 产出时间线，用于区分：
 *   A 流没到（文本长度一直是 0，直到最后才跳变）
 *   B 流到了但被渲染逻辑藏住（长度增长但气泡不显示）
 *   C 过程回复根本没数据（工具步骤数恒 0）
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const QUESTION = process.env.HG_Q || '查一下当前库存，哪些商品库存偏低？'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const JS_LOGIN = 'fetch("https://hergent.cn/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:"mptestsp",password:"Mpsup@1"})})'
  + '.then(function(r){return r.text().then(function(t){return {s:r.status,t:t}})})'
  + '.then(function(w){if(w.s!==200||w.t.charAt(0)==="<")return "RAW:"+w.s+":"+w.t.slice(0,120);'
  + 'return JSON.parse(w.t)})'
  + '.then(d=>{if(typeof d==="string")return d;if(!d.token)return "NO";'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'

const JS_SPY = '(function(){window.__ev=[];window.__urls=[];'
  + 'if(!window.__of){window.__of=window.fetch;}'
  + 'window.fetch=function(u,o){var s=(typeof u==="string")?u:((u&&u.url)||"");window.__urls.push(s);'
  + 'var pr=window.__of.apply(this,arguments);return pr};return "spy"})()'

const JS_OPEN = '(function(){var d=document.querySelector(".copilot");if(d)return "already";'
  + 'var b=document.querySelector(".tb-copilot");if(!b)return "no-btn";b.click();return "clicked"})()'

const JS_FILL = (q) => '(function(){var ta=document.querySelector(".cp-input");if(!ta)return "no-ta";'
  + 'var st=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;'
  + 'st.call(ta,' + JSON.stringify(q) + ');ta.dispatchEvent(new Event("input",{bubbles:true}));return "ok"})()'

const JS_SEND = '(function(){var b=document.querySelector(".cp-send");'
  + 'if(!b)return "no-btn";if(b.disabled)return "DISABLED";b.click();return "sent"})()'

/** 采样：这条回复现在在屏幕上长什么样 */
const JS_SAMPLE = '(()=>{'
  + 'var ms=document.querySelectorAll(".msg.assistant");'
  + 'var last=ms.length?ms[ms.length-1]:null;'
  + 'var md=last?last.querySelector(".md"):null;'
  + 'var o={msgs:document.querySelectorAll(".msg").length,'
  + '   aiMsgs:ms.length,'
  + '   typing:!!document.querySelector(".msg.assistant .typing"),'
  + '   mdLen:md?(md.innerText||"").length:0,'
  + '   tools:document.querySelectorAll(".msg-tools .cp-tool").length,'
  + '   toolsBlock:document.querySelectorAll(".msg-tools").length,'
  + '   progress:document.querySelectorAll(".msg-progress").length,'
  + '   card:document.querySelectorAll(".rc").length,'
  + '   steps:document.querySelectorAll(".cp-steps, .psteps").length,'
  + '   err:(document.querySelector(".cp-err")||{}).innerText||""};'
  + 'return JSON.stringify(o)})()'

const b = await launch({ headless: true })
const p = await b.newPage()
await p.enable()
try {
  await p.goto(BASE + '/', 5000)
  const lr = await p.eval(JS_LOGIN)
  console.log('login:', lr)
  await p.goto(BASE + '/', 5000)
  await p.eval(JS_SPY)
  console.log('open:', await p.eval(JS_OPEN))
  await sleep(1200)
  await p.eval(JS_FILL(QUESTION))
  await sleep(400)
  console.log('send:', await p.eval(JS_SEND))

  console.log('\n  t(s)  typing  mdLen  tools  progress  card  err')
  let prevMd = -1
  for (let i = 0; i < 150; i++) {                 // 最多 60s
    const s = JSON.parse(await p.eval(JS_SAMPLE))
    const t = (i * 0.4).toFixed(1)
    const changed = s.mdLen !== prevMd
    if (changed || i % 5 === 0) {
      console.log(`  ${t.padStart(5)}   ${s.typing ? '●  ' : '   '}   ${String(s.mdLen).padStart(5)}  ${String(s.tools).padStart(3)}   ${String(s.progress).padStart(4)}     ${String(s.card).padStart(2)}   ${s.err ? s.err.slice(0, 30) : ''}${changed ? '   ← 文本变化' : ''}`)
      prevMd = s.mdLen
    }
    if (!s.typing && s.mdLen > 0 && i > 6) break   // 出完字且点已消失 ⇒ 结束
    await sleep(400)
  }
  const urls = await p.eval('JSON.stringify((window.__urls||[]).filter(function(u){return u.indexOf("hermes")>=0||u.indexOf("copilot/chat")>=0}))')
  console.log('\n请求端点:', urls)
  console.log('errors:', (p.errors || []).slice(0, 3))
  await p.screenshot('/Users/zhangjunfeng/Documents/laozhangai-product/outputs/流式排查-2026-09-25/最终画面.png')
} finally {
  await b.close()
}
