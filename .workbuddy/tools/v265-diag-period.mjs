/**
 * v265-diag-period.mjs —— 纯诊断（只读）：把「选期次 → 审核按钮解禁」这条链**逐环打印**，
 * 找出哪一环断了。不修任何东西，不改服务端数据。
 *
 * 链：① select DOM 选中 → ② Vue v-model 收到 change → ③ onPeriodChange 跑
 *     → ④ loadCross() 发请求 → ⑤ cross.value.period 被赋值 → ⑥ 按钮 disabled=false
 *
 * 为什么要逐环：上一版探针直接「点一下 select + 等 3.5s」就读结论，结果按钮仍 disabled，
 * 但从读数上看不出是「事件没到 Vue」还是「loadCross 抛了」。这两者的修法完全不同。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptest'
const PASS = process.env.HG_PASS || 'Mptest@1'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO:"+JSON.stringify(d).slice(0,150);'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'

/* 装监听：change 计数 + fetch 记账（都在页面内，只影响本标签页） */
const JS_INSTALL = '(function(){'
  + 'window.__chg=0;window.__reqs=[];window.__errs=[];'
  + 'window.addEventListener("error",function(e){window.__errs.push(String(e.message||e))});'
  + 'window.addEventListener("unhandledrejection",function(e){'
  + '  window.__errs.push("REJ:"+String((e.reason&&e.reason.message)||e.reason))});'
  + 'var s=document.querySelector(".sel-period");'
  + 'if(!s) return "nosel";'
  + 's.addEventListener("change",function(){window.__chg++;'
  + '  window.__chgDetail={value:s.value,model:"_modelValue" in s?String(s._modelValue):"(none)",'
  + '    selIdx:s.selectedIndex,txt:(s.options[s.selectedIndex]||{}).text};});'
  + 'if(!window.__origFetch){window.__origFetch=window.fetch;}'
  + 'window.fetch=function(u,o){'
  + '  var url=(typeof u==="string")?u:((u&&u.url)||"");'
  + '  var rec={u:url};'
  + '  var pr=window.__origFetch.apply(this,arguments);'
  + '  pr.then(function(r){rec.status=r.status;window.__reqs.push(rec);'
  + '    if(r.status>=400){try{r.clone().text().then(function(t){rec.body=String(t).slice(0,300)})}catch(e){}}}'
  + '  ).catch(function(e){'
  + '    rec.status="ERR:"+String(e&&e.message||e);window.__reqs.push(rec)});'
  + '  return pr;};'
  + 'return "installed:n="+s.options.length;'
  + '})()'

/* 选期次（与上一版探针同一写法，但保留中间态供比对） */
const JS_PICK = '(function(){'
  + 'var s=document.querySelector(".sel-period");'
  + 'if(!s) return "nosel";'
  + 'var before={v:s.value,idx:s.selectedIndex};'
  + 'var j=-1;'
  + 'for(var k=1;k<s.options.length;k++){ if(s.options[k].value){ j=k; break; } }'
  + 'if(j<0) return "nofill";'
  + 's.value=s.options[j].value;'
  + 'var after={v:s.value,idx:s.selectedIndex};'
  + 's.dispatchEvent(new Event("change",{bubbles:true}));'
  + 'return JSON.stringify({before:before,after:after,optVal:s.options[j].value,optTxt:s.options[j].text});'
  + '})()'

/* 全量读数 */
const JS_STATE = '(function(){'
  + 'var o={};'
  + 'o.chg=window.__chg||0;o.chgDetail=window.__chgDetail||null;'
  + 'o.reqs=(window.__reqs||[]).map(function(r){return r.status+" "+r.u'
  + '  +((r.body)?("\\n      BODY: "+r.body):"")}).slice(-25);'
  + 'o.errs=(window.__errs||[]).slice(-8);'
  + 'var s=document.querySelector(".sel-period");'
  + 'o.sel=s?{v:s.value,idx:s.selectedIndex,txt:(s.options[s.selectedIndex]||{}).text,'
  + '  model:("_modelValue" in s)?String(s._modelValue):"(none)"}:null;'
  + 'var bs=document.querySelectorAll("button");'
  + 'for(var i=0;i<bs.length;i++){if((bs[i].innerText||"").indexOf("AI智能建议")>=0){'
  + '  o.btn={disabled:bs[i].disabled}}}'
  + 'o.toasts=[];'
  + 'var ts=document.querySelectorAll("[class*=toast],[class*=Toast],[class*=msg],[class*=Msg]");'
  + 'ts.forEach(function(t){var x=(t.innerText||"").trim();if(x&&x.length<300)o.toasts.push(x.slice(0,120))});'
  + 'o.toastHtml=(function(){var c=document.querySelector("#toasts,#toast,.toast-wrap,.toasts");'
  + '  return c?String(c.outerHTML).slice(0,400):"(no-toast-container)"})();'
  + 'o.crossRows=(document.querySelectorAll(".cv-table tbody tr,.grid-table tbody tr")||[]).length;'
  + 'o.body=(document.body.innerText||"").replace(/\\s+/g," ").slice(0,300);'
  + 'return JSON.stringify(o)})()'

let browser
try {
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()

  log('=== 0. 登录 ' + USER + ' ===')
  await page.goto(BASE, 3500)
  const li = await page.eval(JS_LOGIN(USER, PASS))
  log('  登录：' + li)
  if (li !== 'OK') throw new Error('登录失败')

  log('')
  log('=== 1. 打开 #/forecast 并等期次列表加载 ===')
  await page.goto(BASE + '/#/forecast', 9000)
  const inst = await page.eval(JS_INSTALL)
  log('  装监听：' + inst)

  log('')
  log('=== 2. 选期次（DOM + change 事件）===')
  const pk = await page.eval(JS_PICK)
  log('  pick：' + pk)

  log('')
  log('=== 3a. 选期次后 **1 秒**（toast 还没自动消失）===')
  await sleep(1000)
  log('  ' + (await page.eval(JS_STATE)))

  log('')
  log('=== 3. 等 6 秒，读全量状态 ===')
  await sleep(6000)
  const st = await page.eval(JS_STATE)
  log('  ' + st)

  log('')
  log('=== 4. 再等 6 秒（排除"只是慢"）===')
  await sleep(6000)
  const st2 = await page.eval(JS_STATE)
  log('  ' + st2)

  log('')
  log('=== 5. 页面 errors ===')
  page.errors.slice(0, 10).forEach(e => log('   ' + String(e).slice(0, 200)))
  log('  共 ' + page.errors.length + ' 条')
} catch (e) {
  log('❌ 异常：' + (e && e.message ? e.message : e))
} finally {
  try { if (browser) await browser.close() } catch { }
}
