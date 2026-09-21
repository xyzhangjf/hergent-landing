/**
 * v222-render-dump.mjs —— 精查：切到期次后表格到底渲染了什么
 * 只读。判据：① 有多少张表 / 多少行 ② 行里有没有 1164 ③ 若无，看接口层是否本来就没有该行
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO";'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'

const JS_SHAPE = '(()=>{var o={tables:[],tabs:[],btns:[]};'
  + 'document.querySelectorAll("table").forEach(function(t,i){'
  + 'var b=t.querySelectorAll("tbody tr");'
  + 'o.tables.push({i:i,rows:b.length,first:b.length?(b[0].innerText||"").replace(/\\s+/g," ").slice(0,180):""})});'
  + 'document.querySelectorAll("[class*=tab],[role=tab]").forEach(function(e){'
  + 'var t=(e.innerText||"").trim();if(t&&t.length<16)o.tabs.push(t)});'
  + 'document.querySelectorAll("button").forEach(function(e){'
  + 'var t=(e.innerText||"").trim();if(t&&t.length<14)o.btns.push(t)});'
  + 'o.tabs=Array.from(new Set(o.tabs));o.btns=Array.from(new Set(o.btns));'
  + 'return JSON.stringify(o).slice(0,2500)})()'

const JS_PICK = (want) => '(()=>{var s=document.querySelector("select.sel-period")||document.querySelector("select");'
  + 'if(!s)return "NO_SELECT";for(var j=0;j<s.options.length;j++){var o=s.options[j];'
  + 'if(String(o.value)===' + JSON.stringify(String(want)) + '){s.value=o.value;'
  + 's.dispatchEvent(new Event("change",{bubbles:true}));return "OK->"+o.value}}return "OPT_NOT_FOUND"})()'

const JS_PROBE1164 = '(()=>{var re=/340G|新希望/;'
  + 'var trs=Array.from(document.querySelectorAll("table tbody tr"));'
  + 'var hit=trs.find(function(tr){return re.test(tr.innerText||"")});'
  + 'return JSON.stringify({totalRows:trs.length,found:!!hit,'
  + 'cells:hit?Array.from(hit.querySelectorAll("td")).map(function(c){return (c.innerText||"").trim().replace(/\\s+/g," ")}):[],'
  + 'head:Array.from(document.querySelectorAll("table thead tr")).map(function(h){return Array.from(h.querySelectorAll("th,td")).map(function(c){return (c.innerText||"").trim()})})})'
  + '.slice(0,3000)})()'

let browser
try {
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()
  await page.goto(BASE, 3500)
  log('登录 ' + await page.eval(JS_LOGIN(USER, PASS)))
  await page.goto(BASE + '/#/forecast', 6000)
  await sleep(5000)

  log('初始形态：' + await page.eval(JS_SHAPE))
  log('')
  log('选期次 14：' + await page.eval(JS_PICK(14)))
  await sleep(7000)
  log('期次 14 形态：' + await page.eval(JS_SHAPE))
  log('')
  log('1164 定位：' + await page.eval(JS_PROBE1164))

  /* 切「填报」/其它标签再试（末尾无副作用） */
  log('')
  log('== 再切期次 15 对照 ==')
  log(await page.eval(JS_PICK(15)))
  await sleep(6000)
  log('期次 15 形态：' + await page.eval(JS_SHAPE))
  log('1164 定位：' + await page.eval(JS_PROBE1164))

  const errs = page.errors.slice()
  log('错误 ' + errs.length + ' 条'); errs.slice(0, 6).forEach(e => log('   ' + e.slice(0, 170)))
} catch (e) { log('异常：' + (e && e.message)) }
finally { if (browser) { try { await browser.close() } catch { } } }
