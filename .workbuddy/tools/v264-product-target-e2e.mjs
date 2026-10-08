/**
 * v264-product-target-e2e.mjs —— 商品目标页**真机只读**验收
 *
 * 已完成的证据链（本轮之前）：
 *   ① 迁移：隔离库跑真 `init_db()` ×2 ⇒ 2 表 + 4 索引 + 2 补列 ✓
 *   ② 算法：10 组纯算法断言（含用户原例 150箱/15单/达成15 ⇒ 9箱）✓
 *   ③ 端到端：沙箱租户 29 项断言（含 `__列占位__` 金丝雀 / 档案外行）✓
 *   ④ 生产真实数据：只读副本上 per_case(袋)=40、per_case(包)=8 ✓
 * 本环补最后一跳：**页面上到底长什么样**。
 *
 * 🔴 全程只读：不点新建、不点保存、不点删除、不改任何数据。
 *    本脚本**唯一**的写动作是 localStorage 种 token（本地浏览器沙箱内，非服务端）。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v264-商品目标P0-2026-09-24'
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

/* ── 侧栏：把每一条导航项的文案列出来（证明入口真的被渲染，不是只 grep 到 bundle 里的字符串） ── */
const JS_NAV = '(()=>{var out=[];'
  + 'document.querySelectorAll(".sb-item,.md-item,#sidebar a,#sidebar button,[class*=sidebar] a").forEach(function(e){'
  + 'var t=(e.innerText||"").trim().replace(/\\s+/g," ");if(!t)return;'
  + 'out.push({cls:e.className,to:e.getAttribute("href")||"",t:t.slice(0,20)})});'
  + 'var seen={},uniq=[];out.forEach(function(o){var k=o.t;if(seen[k])return;seen[k]=1;uniq.push(o)});'
  + 'return JSON.stringify({n:uniq.length,items:uniq})})()'

/* ── 商品目标页骨架：口径条 / 工具栏 / 表头 / 行 ── */
const JS_PAGE = '(()=>{'
  + 'var cal=document.querySelector(".pt-caliber");'
  + 'var months=Array.from(document.querySelectorAll("input[type=month]")).map(function(e){return e.value});'
  + 'var sels=Array.from(document.querySelectorAll("select")).map(function(s,i){return {i:i,n:s.options.length,'
  + 'v:s.value,head:Array.from(s.options).slice(0,4).map(function(o){return (o.text||"").trim().slice(0,26)})}});'
  + 'var t=document.querySelector("table");var heads=[];'
  + 'if(t&&t.querySelector("thead tr"))heads=Array.from(t.querySelectorAll("thead tr th,thead tr td")).map(function(c){return (c.innerText||"").trim()});'
  + 'var rows=[];'
  + 'if(t)Array.from(t.querySelectorAll("tbody tr")).slice(0,6).forEach(function(tr){'
  + 'rows.push(Array.from(tr.querySelectorAll("td")).map(function(c){return (c.innerText||"").trim().replace(/\\s+/g," ").slice(0,22)}))});'
  + 'var btns=Array.from(document.querySelectorAll("button")).map(function(b){return (b.innerText||"").trim()}).filter(Boolean).slice(0,14);'
  + 'return JSON.stringify({url:location.href,caliber:cal?(cal.innerText||"").trim().replace(/\\s+/g," "):null,'
  + 'months:months,sels:sels,heads:heads,nrows:t?t.querySelectorAll("tbody tr").length:0,rows:rows,btns:btns,'
  + 'empty:(document.body.innerText||"").indexOf("暂无")>=0,bodyLen:(document.body.innerText||"").length})'
  + '})()'

/* ── 直接调接口（只读 GET），对照页面显示 ── */
/* 🔴 必须在**页面内**先 JSON.stringify：`page.eval` 的 `returnByValue` 对
   `Promise.<object>` 的结果会退化成 `"[object Object]"`，外层 JSON.parse 直接炸。 */
const JS_API = (url) => 'fetch(' + JSON.stringify(url) + ',{headers:{'
  + '"Authorization":"Bearer "+localStorage.getItem("hergent_v2_token"),'
  + '"X-CSRF-Token":(localStorage.getItem("hergent_v2_csrf")||"")}})'
  + '.then(function(r){return r.text().then(function(t){return JSON.stringify({s:r.status,t:t.slice(0,3000)})})})'

let browser, failed = false
try {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()

  log('=== 0. 登录 ===')
  await page.goto(BASE, 3500)
  const li = await page.eval(JS_LOGIN(USER, PASS))
  ok(li === 'OK', '登录 ' + USER, li)

  log('')
  log('=== 1. 导航到 /product-target ===')
  await page.goto(BASE + '/#/product-target', 6000)
  const pg = JSON.parse((await page.eval(JS_PAGE)) || '{}')
  log('  URL = ' + pg.url)
  ok(String(pg.url).includes('/product-target'), '路由生效（不是被重定向回首页）', pg.url)

  log('')
  log('=== 2. 侧栏入口 ===')
  const nav = JSON.parse((await page.eval(JS_NAV)) || '{"n":0,"items":[]}')
  const hit = (nav.items || []).filter(x => (x.t || '').includes('商品目标'))
  ok(hit.length > 0, '侧栏渲染出「商品目标」', hit.map(h => h.cls + '→' + (h.to || '?')).join(' | ') || ('未命中；侧栏共 ' + nav.n + ' 项'))

  log('')
  log('=== 3. 页面骨架 ===')
  ok(!!pg.caliber, '口径说明条 .pt-caliber 存在', pg.caliber ? pg.caliber.slice(0, 90) + '…' : 'null')
  ok((pg.months || []).length > 0, '月份选择器存在', JSON.stringify(pg.months))
  ok((pg.sels || []).length > 0, '存在 <select>（应为期次下拉）', JSON.stringify(pg.sels).slice(0, 400))
  log('  表头 = ' + JSON.stringify(pg.heads))
  log('  按钮 = ' + JSON.stringify(pg.btns))
  log('  行数 = ' + pg.nrows + '｜空状态文案 = ' + pg.empty + '｜正文长度 = ' + pg.bodyLen)
  /* 页面正文原样打出来 —— 空列表时的空状态文案是判断「列表区真的渲染了、只是没数据」
     还是「列表区整个没渲染（v-if 挂空）」的唯一依据。 */
  const txt = await page.eval('(document.querySelector("#app")||document.body).innerText')
  log('  ── 页面正文 ──')
  String(txt || '').split('\n').filter(Boolean).slice(0, 28).forEach(l => log('   | ' + l.slice(0, 110)))

  log('')
  log('=== 4. 直接打后端（只读 GET） ===')
  const rEmp = JSON.parse((await page.eval(JS_API('/api/product-targets/employees'))) || '{}')
  ok(rEmp.s === 200, 'GET /employees = 200（未登录会 401，未登记会 403）', 'status=' + rEmp.s + ' body=' + String(rEmp.t).slice(0, 160))

  const rProd = JSON.parse((await page.eval(JS_API('/api/product-targets/products?keyword=1449&limit=5'))) || '{}')
  ok(rProd.s === 200, 'GET /products?keyword=1449 = 200', 'status=' + rProd.s + ' body=' + String(rProd.t).slice(0, 200))

  const rList = JSON.parse((await page.eval(JS_API('/api/product-targets'))) || '{}')
  ok(rList.s === 200, 'GET /product-targets = 200', 'status=' + rList.s + ' body=' + String(rList.t).slice(0, 300))

  /* 真实期次清单 —— 用页面同款接口，确认有可选期次 */
  const rPer = JSON.parse((await page.eval(JS_API('/api/forecast/periods'))) || '{}')
  log('  GET /api/forecast/periods status=' + rPer.s + ' body=' + String(rPer.t).slice(0, 600))

  log('')
  log('=== 5. 均单目标接口（真实期次） ===')
  let pid = null
  try {
    const arr = JSON.parse(rPer.t)
    const list = Array.isArray(arr) ? arr : (arr.items || arr.data || arr.periods || [])
    const first = (list || []).find(x => x && (x.id || x.period_id))
    pid = first ? (first.id || first.period_id) : null
    log('  取到期次 id = ' + pid + '（' + (first && (first.name || first.period_name)) + '）')
  } catch (e) { log('  解析期次失败：' + e.message) }

  if (pid) {
    const rAvg = JSON.parse((await page.eval(JS_API('/api/product-targets/avg-target?period_id=' + pid + '&product_ids=1449'))) || '{}')
    ok(rAvg.s === 200, 'GET /avg-target?period_id=' + pid + '&product_ids=1449 = 200', '')
    log('  响应 = ' + String(rAvg.t).slice(0, 900))
  }

  log('')
  const errs = page.errors.slice()
  log('=== 6. 控制台错误 ' + errs.length + ' 条 ===')
  errs.slice(0, 10).forEach(e => log('   ' + e.slice(0, 200)))
  if (errs.length > 4) failed = true

  const body = await page.eval('document.body?document.body.innerText:""')
  ok(!/页面出错了/.test(body), '无兜底错误页')

  const SHOT = SHOT_DIR + '/v264-商品目标页-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '.png'
  try { await page.screenshot(SHOT); log('截图：' + SHOT) } catch { }

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
