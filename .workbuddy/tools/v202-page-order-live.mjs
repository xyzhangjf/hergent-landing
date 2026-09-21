#!/usr/bin/env node
/* v202 真机断言：**页面显示的商品行序 == 后端下发的导入模板行序**
 *
 * 用户诉求：「导入后系统中的商品名称排列顺序与导入模板中的商品名称顺序完全保持一致，
 *   不受其他排序规则影响。」
 *
 * 为什么不能只靠「离线单测 + 后端 API 对比」：
 *   ① 行底顺序由前端 `buildRowBase` 决定，离线单测是**复刻**实现（可能漂移）；
 *   ② 前端拿到 summary 后还要经过 `rowBase.map` → `sortedRows` → `renderModel` → DOM 四层，
 *      任何一层重排，离线全绿也照样错；
 *   ③ 项目铁律：动过 Forecast.vue 就必须真机跑。
 *
 * 做法（不写任何数据）：
 *   ① 拦截前端真实发出的请求，拿到它调 summary 的**准确参数**（不硬编码期次）
 *   ② 用同一 URL 再取一次数据 → `imported_products` 的顺序 = 该期次的导入模板序
 *   ③ 读主表 DOM 里商品行的名称，与上面逐行比对
 * 判据：P9a 行数足够  P9b 逐行前缀一致  P9c 首行一致
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/客户列删除被恢复排查-2026-09-19'
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = s => console.log(s)
const strip = s => String(s || '').replace(/\s+/g, '')

let pass = 0, fail = 0
const ok = (c, label, extra = '') => {
  if (c) { pass++; log('  PASS  ' + label + (extra ? '  ' + extra : '')) }
  else { fail++; log('  FAIL  ' + label + (extra ? '  ' + extra : '')) }
}

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json().then(d=>({s:r.status,d:d})))'
  + '.then(r=>{var d=r.d;if(!d.token)return JSON.stringify({ok:false,status:r.s});'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return JSON.stringify({ok:true,user:(d.user&&d.user.username)||"",tenant:d.tenant_id})})'

const JS_PATCH = '(()=>{if(window.__reqs)return "already";window.__reqs=[];var of=window.fetch;'
  + 'window.fetch=function(){try{var a=arguments[0];var u=(typeof a==="string")?a:(a&&a.url)||"";'
  + 'if(u.indexOf("/forecast-submissions/summary")>=0)window.__reqs.push(u);}catch(e){}'
  + 'return of.apply(this,arguments)};return "patched"})()'

const JS_CLICK_SIDEBAR = '(()=>{var all=Array.from(document.querySelectorAll("a,div,span,li,button"));'
  + 'var hit=all.find(x=>/预报订[单货]管理/.test((x.innerText||"").trim())&&(x.innerText||"").trim().length<20);'
  + 'if(hit){hit.click();return (hit.innerText||"").trim()}return ""})()'

/* 取前端调 summary 的 URL（最后一条） */
const JS_SUM_URL = '(window.__reqs||[]).slice(-1)[0]||""'

/* 用同一 URL 再取一次 → imported_products 的顺序（= 该期次的导入模板序）
   🔴 必须带前端同款鉴权头（`Authorization: Bearer` + `X-Tenant-Id`，见 src/api/client.js）。
      首版裸 fetch 拿回 `imported_products: []` —— 后端按「无 token」处理，**不报错、只给空**，
      于是 P9a 假红。教训：**复现前端请求时，鉴权头也要一起复现**，否则「空结果」与「真没数据」长得一样。 */
const JS_EXPECT = '(async()=>{var u=(window.__reqs||[]).slice(-1)[0];if(!u)return JSON.stringify({err:"no-url"});'
  + 'var tk=localStorage.getItem("hergent_v2_token")||"";var tn=localStorage.getItem("hergent_v2_tenant")||"";'
  + 'var h={};if(tk)h["Authorization"]="Bearer "+tk;if(tn)h["X-Tenant-Id"]=String(tn);'
  + 'var r=await fetch(u,{headers:h});var d=await r.json();'
  + 'var ip=(d&&d.imported_products)||[];'
  + 'return JSON.stringify({n:ip.length,names:ip.map(function(x){return x.name||""})})})()'

/* 主表商品行：跳过合计行 / 空行；商品名是第 2 格（第 1 格是序号） */
const JS_DOM = '(()=>{var tb=document.querySelectorAll("table.cross-tbl tbody tr");var out=[];'
  + 'for(var i=0;i<tb.length;i++){var tds=tb[i].querySelectorAll("td");if(tds.length<3)continue;'
  + 'var idx=(tds[0].innerText||"").trim();var nm=(tds[1].innerText||"").replace(/\\s+/g," ").trim();'
  + 'if(!/^\\d+$/.test(idx))continue;if(!nm)continue;out.push(nm)}'
  + 'return JSON.stringify({domRows:tb.length,names:out})})()'

let browser
try {
  fs.mkdirSync(OUT, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()
  log('=== v202 真机断言：页面行序 == 导入模板行序 ===')
  await page.goto(BASE, 3500)
  const li = JSON.parse(await page.eval(JS_LOGIN(USER, PASS)))
  log('登录: ' + JSON.stringify(li))
  await page.eval(JS_PATCH)
  await page.goto(BASE + '/#/', 4000)
  const entered = await page.eval(JS_CLICK_SIDEBAR)
  if (!entered) await page.goto(BASE + '/#/forecast', 5000)
  await sleep(4500)

  const sumUrl = await page.eval(JS_SUM_URL)
  log('前端调用的 summary: ' + (sumUrl || '(未捕获)'))

  const exp = JSON.parse(await page.eval(JS_EXPECT))
  const dom = JSON.parse(await page.eval(JS_DOM))
  log(`后端导入序 ${exp.n || 0} 个 ｜ DOM 商品行 ${dom.names.length} 个（表格总行 ${dom.domRows}）`)

  ok(!exp.err && exp.n > 0, 'P9a 该期次确有导入登记（前端同一参数取回）', `${exp.n} 个`)
  ok(dom.names.length > 0, 'P9b 页面渲染出了商品行', `${dom.names.length} 行`)

  // DOM 只渲染**可视区**（虚拟滚动），故只比对前 min(N) 行
  const N = Math.min(exp.names.length, dom.names.length, 20)
  let mismatch = []
  for (let i = 0; i < N; i++) {
    const a = strip(dom.names[i]), b = strip(exp.names[i])
    // 两侧都可能被 CSS/省略号截断 ⇒ 用「较短者的前 10 字」做前缀比对
    const k = Math.min(10, a.length, b.length)
    if (!k || a.slice(0, k) !== b.slice(0, k)) mismatch.push({ i, dom: a.slice(0, 18), api: b.slice(0, 18) })
  }
  ok(N >= 5, 'P9c 可比对行数足够', `${N} 行`)
  ok(mismatch.length === 0,
    `P9d 页面行序 == 后端导入序（前 ${N} 行逐行一致）`,
    mismatch.length ? '首个不一致: ' + JSON.stringify(mismatch[0]) : `首行「${dom.names[0].slice(0, 16)}」`)
  if (mismatch.length) log('        全部不一致: ' + JSON.stringify(mismatch.slice(0, 6)))

  ok(strip(dom.names[0]).slice(0, 10) === strip(exp.names[0]).slice(0, 10),
    'P9e 页面首行 == 模板首行', `「${(exp.names[0] || '').slice(0, 20)}」`)

  const shot = OUT + '/v202-页面行序-真机-' + STAMP + '.png'
  try { await page.screenshot(shot); log('截图: ' + shot) } catch {}
  ok((page.errors || []).length === 0, 'P9f console 零错误', String((page.errors || []).length))
} catch (e) {
  fail++
  console.error('断言脚本异常: ' + e.message)
} finally {
  try { await browser?.close() } catch {}
}

log('\n== 结果 ==')
log(`  PASS=${pass}  FAIL=${fail}`)
process.exit(fail ? 1 : 0)
