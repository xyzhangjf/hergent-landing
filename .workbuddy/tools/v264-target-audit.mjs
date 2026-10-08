/**
 * v264-target-audit.mjs —— 商品目标管理「到底能不能用」的只读核查探针
 *
 * 为什么写它：2026-09-25 审计发现生产 4 个库的 `product_targets` **全是 0 行**。
 * 0 行有两种截然不同的成因，必须分开：
 *   A. 功能好着呢，只是老板还没开始建目标（⇒ 结论是"等他用"，不是"去修"）
 *   B. 页面压根进不去 / 按钮点不动 / 弹窗开不了（⇒ 结论是"必须修"，而且他会以为"没做好"）
 * 本探针只回答**一个**问题：**照着正常人的操作路径走一遍，走不走得通**。
 *
 * 覆盖：
 *   1. 登录（mptestsp / supervisor —— 在 FORECAST_SUMMARY_ROLES 名单内）
 *   2. 旧路由 `#/product-target` 是否按 v265 的承诺 **redirect 到 `#/forecast?tab=target`**
 *      （v265 说「保留 redirect，不能直接删」—— 这里验证那句话是真的）
 *   3. 商品目标页签渲染：口径条 / 月份选择器 / 期次下拉 / 列表或空态
 *   4. **点「新建」→ 弹窗真的打开**，且能看到「选人双栏」与「Σ占比」这些核心控件
 *      （这是 0 行数据最可能的堵点：能看不能建 = 用户试一次就放弃）
 *   5. 只读接口连通性：/employees /products /（若拿得到期次）/avg-target
 *   6. 控制台报错数
 *
 * 🔴 全程只读：**不点保存、不点删除、不改任何数据**。点「新建」只打开弹窗，
 *    随即 Esc 关掉。唯一写动作是 localStorage 种 token（浏览器沙箱内）+ 收尾 logout。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const SHOT_DIR = process.env.HG_SHOT || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v264-商品目标审计-2026-09-25'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)

let pass = 0, fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; log('  ✅ ' + name + (extra ? '　→ ' + extra : '')) }
  else { fail++; log('  ❌ ' + name + (extra ? '　→ ' + extra : '')) }
  return !!cond
}

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO:"+JSON.stringify(d).slice(0,150);'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'

/* 页签条 / 面板骨架 */
const JS_TABS = '(()=>{'
  + 'var btns=Array.from(document.querySelectorAll(".module-tabs button,button")).map(function(b){return (b.innerText||"").trim()});'
  + 'return JSON.stringify({hash:location.hash,hasCaliber:!!document.querySelector(".pt-caliber"),'
  + 'hasPanel:!!document.querySelector(".target-panel"),tabs:btns.slice(0,10)})})()'

/* 商品目标面板内部的骨架（口径条 / 月份 / 期次 / 空态 / 按钮） */
const JS_PANEL = '(()=>{'
  + 'var cal=document.querySelector(".pt-caliber");'
  + 'var months=Array.from(document.querySelectorAll("input[type=month]")).map(function(e){return e.value});'
  + 'var sels=Array.from(document.querySelectorAll("select")).map(function(s){return {n:s.options.length,v:s.value,'
  + 'head:Array.from(s.options).slice(0,3).map(function(o){return (o.text||"").trim().slice(0,24)})}});'
  + 'var t=document.querySelector(".target-panel table");'
  + 'var heads=(t&&t.querySelector("thead tr"))?Array.from(t.querySelectorAll("thead tr th,thead tr td")).map(function(c){return (c.innerText||"").trim()}):[];'
  + 'var btns=Array.from(document.querySelectorAll(".target-panel button")).map(function(b){return (b.innerText||"").trim()}).filter(Boolean);'
  + 'var txt=(document.querySelector(".target-panel")||document.body).innerText||"";'
  + 'return JSON.stringify({caliber:cal?(cal.innerText||"").trim().replace(/\\s+/g," ").slice(0,140):null,'
  + 'months:months,sels:sels,heads:heads,nrows:t?t.querySelectorAll("tbody tr").length:0,btns:btns,'
  + 'empty:/暂无|还没有|没有商品目标/.test(txt),txtLen:txt.length,'
  + 'snippet:txt.split("\\n").filter(Boolean).slice(0,14).map(function(s){return s.trim().slice(0,70)})})})()'

/* 点「新建」按钮：按文本匹配，返回是否点到 */
const JS_CLICK_NEW = '(function(){var bs=Array.from(document.querySelectorAll(".target-panel button"));'
  + 'var b=bs.find(function(x){var t=(x.innerText||"").trim();return t.indexOf("新建")>=0||t.indexOf("新 建")>=0});'
  + 'if(!b)return "NOBTN";b.click();return "CLICKED:"+(b.innerText||"").trim()})()'

/* 弹窗骨架：是否打开 + 两块选人区 + Σ占比提示 */
const JS_MODAL = '(()=>{'
  + 'var m=document.querySelector(".modal,.pt-modal,.modal-mask,[class*=modal]");'
  + 'var open=!!m&&(m.offsetParent!==null||m.getBoundingClientRect().height>0);'
  + 'var txt=(m?m.innerText:"")||"";'
  + 'var inputs=Array.from(document.querySelectorAll(".modal input,[class*=modal] input")).map(function(i){return {t:i.type,ph:i.placeholder||"",v:i.value||""}});'
  + 'var btns=Array.from(document.querySelectorAll(".modal button,[class*=modal] button")).map(function(b){return (b.innerText||"").trim()}).filter(Boolean);'
  + 'return JSON.stringify({open:open,txtLen:txt.length,sum:/合计|Σ|占比|%/.test(txt),'
  + 'nInputs:inputs.length,btns:btns.slice(0,8),'
  + 'snippet:txt.split("\\n").filter(Boolean).slice(0,16).map(function(s){return s.trim().slice(0,64)})})})()'

const JS_API = (url) => 'fetch(' + JSON.stringify(url) + ',{headers:{'
  + '"Authorization":"Bearer "+localStorage.getItem("hergent_v2_token"),'
  + '"X-CSRF-Token":(localStorage.getItem("hergent_v2_csrf")||"")}})'
  + '.then(function(r){return r.text().then(function(t){return JSON.stringify({s:r.status,t:t.slice(0,2500)})})})'

let browser, failed = false
try {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()

  log('=== 0. 登录 ===')
  await page.goto(BASE, 3500)
  const li = await page.eval(JS_LOGIN(USER, PASS))
  ok(li === 'OK', '登录 ' + USER + '（supervisor，在 FORECAST_SUMMARY_ROLES 内）', li)
  const who = await page.eval('(function(){try{var u=JSON.parse(localStorage.getItem("hergent_v2_user")||"{}");'
    + 'return JSON.stringify({name:u.name||u.username,role:u.role})}catch(e){return "?"}})()')
  log('  当前身份 = ' + who)

  log('')
  log('=== 1. 旧路由 #/product-target（v265 承诺 redirect 到 #/forecast?tab=target）===')
  await page.goto(BASE + '/#/product-target', 7000)
  const t1 = JSON.parse((await page.eval(JS_TABS)) || '{}')
  log('  hash = ' + t1.hash + ' | 有 .target-panel = ' + t1.hasPanel)
  ok(String(t1.hash).includes('tab=target'), '旧链没有白屏，落到了 ?tab=target', 'hash=' + t1.hash)
  ok(t1.hasPanel === true, '商品目标面板已挂载（.target-panel 存在）')

  log('')
  log('=== 2. 页签条：商品目标是不是真页签 ===')
  ok((t1.tabs || []).some(x => String(x).includes('商品目标')),
    '页签条里能看见「商品目标」', JSON.stringify(t1.tabs))

  log('')
  log('=== 3. 面板骨架（能不能看懂、能不能操作）===')
  const p1 = JSON.parse((await page.eval(JS_PANEL)) || '{}')
  ok(!!p1.caliber, '口径说明条 .pt-caliber 存在', String(p1.caliber || '').slice(0, 100))
  ok((p1.months || []).length > 0, '月份选择器存在', JSON.stringify(p1.months))
  ok((p1.sels || []).length > 0, '期次下拉存在', JSON.stringify(p1.sels).slice(0, 300))
  log('  表头   = ' + JSON.stringify(p1.heads))
  log('  按钮   = ' + JSON.stringify(p1.btns))
  log('  行数   = ' + p1.nrows + '｜空态文案 = ' + p1.empty + '｜正文长度 = ' + p1.txtLen)
  log('  ── 面板正文（前 14 行）──')
  ;(p1.snippet || []).forEach(l => log('   | ' + l))
  ok((p1.btns || []).some(b => String(b).includes('新建')), '有「新建」入口（否则用户建不了目标）',
    JSON.stringify(p1.btns))

  log('')
  log('=== 4. 点「新建」→ 弹窗开不开（0 行数据最可能的堵点）===')
  const clicked = await page.eval(JS_CLICK_NEW)
  log('  点击结果 = ' + clicked)
  await sleep(1200)
  const m1 = JSON.parse((await page.eval(JS_MODAL)) || '{}')
  ok(String(clicked).startsWith('CLICKED'), '点到了「新建」按钮', clicked)
  ok(m1.open === true, '弹窗真的打开了', 'open=' + m1.open + ' txtLen=' + m1.txtLen)
  ok(m1.nInputs > 0, '弹窗里有输入框', 'n=' + m1.nInputs)
  ok(m1.sum === true, '弹窗里有占比/合计相关提示（Σ=100 的可视依据）', '')
  log('  弹窗按钮 = ' + JSON.stringify(m1.btns))
  log('  ── 弹窗正文（前 16 行）──')
  ;(m1.snippet || []).forEach(l => log('   | ' + l))
  try { await page.screenshot(SHOT_DIR + '/01-商品目标页-新建弹窗.png'); log('  截图 01-商品目标页-新建弹窗.png') } catch { }

  /* Esc 关掉弹窗 —— 不保存、不落库 */
  await page.eval('(function(){document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));return 1})()')
  await sleep(600)

  log('')
  log('=== 5. 只读接口连通性 ===')
  const rEmp = JSON.parse((await page.eval(JS_API('/api/product-targets/employees'))) || '{}')
  ok(rEmp.s === 200, 'GET /employees = 200（未登记模块会 403）', 'status=' + rEmp.s + ' ' + String(rEmp.t).slice(0, 120))
  const rProd = JSON.parse((await page.eval(JS_API('/api/product-targets/products?keyword=1449&limit=5'))) || '{}')
  ok(rProd.s === 200, 'GET /products?keyword=1449 = 200', 'status=' + rProd.s)
  const rList = JSON.parse((await page.eval(JS_API('/api/product-targets'))) || '{}')
  ok(rList.s === 200, 'GET /product-targets = 200', 'status=' + rList.s + ' 行数段=' + String(rList.t).slice(0, 160))
  log('  /product-targets 实测读数 = ' + String(rList.t).slice(0, 400))

  log('')
  log('=== 6. 控制台报错 ===')
  const errs = page.errors.slice()
  log('  共 ' + errs.length + ' 条')
  errs.slice(0, 8).forEach(e => log('   ' + e.slice(0, 180)))
  ok(errs.length === 0, '全程 0 控制台报错', errs.length + ' 条')

  const body = await page.eval('document.body?document.body.innerText:""')
  ok(!/页面出错了/.test(body), '无兜底错误页')

  try { await page.screenshot(SHOT_DIR + '/02-商品目标页-全貌.png'); log('  截图 02-商品目标页-全貌.png') } catch { }

  log('')
  log('=== 7. 收尾：注销本次登录（不留多余 session）===')
  const lo = await page.eval('fetch("/api/auth/logout",{method:"POST",headers:{'
    + '"Authorization":"Bearer "+(localStorage.getItem("hergent_v2_token")||"")}})'
    + '.then(function(r){return r.text().then(function(t){return "HTTP:"+r.status+" "+t.slice(0,60)})})'
    + '.catch(function(e){return "ERR:"+e.message})')
  log('  logout → ' + lo)
  ok(/HTTP:2\d\d/.test(String(lo)), '已注销（生产不留多余会话）', lo)

  log('')
  log('────────────────────────────')
  log('通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  if (fail > 0) failed = true
} catch (e) {
  log('脚本异常：' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e))
  failed = true
} finally {
  if (browser) { try { await browser.close() } catch { } }
  process.exit(failed ? 1 : 0)
}
