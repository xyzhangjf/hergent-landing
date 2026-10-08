/**
 * v265-e2e.mjs —— 两件事的**真机只读**验收
 *   ① 商品目标收进「预报订货管理」当第 4 个页签（原侧栏独立入口已撤 + 旧链 redirect）
 *   ② 审核台「销量数据新鲜度」告警条（数据停更时出现 / 新鲜时不出现）
 *
 * 🔴 全程只读：不点新建、不点保存、不点定稿、不改任何服务端数据。
 *    唯一的"桩"是在**页面内**替换 window.fetch（只影响这一个标签页，刷新即还原）。
 * 🔴 反例对照（本项目铁律）：正例反例必须**结果不同**，否则探针作废。
 *    ① 页签：点「商品目标」→ 必须出现 .target-panel；点「本期预报」→ 必须消失。
 *    ② 告警条：真实数据(stale) → 必须出现；桩成 fresh（且 items 非空）→ 必须消失。
 *       ⚠️ 桩必须返回**非空 items** —— 否则 auditState='empty'，告警条本来就不渲染，
 *          正反例同结果 = 探针作废（这个坑我第一版就踩了）。
 *
 * 相位：
 *   A（1-6）页签化：4 个页签 / 侧栏撤除 / URL 同步 / 默认不写参 / 旧链 redirect
 *   B（7-8）审核台数据新鲜度：真实 audit-period（stale）出现告警 ↔ 桩 fresh 消失
 *   C（9） 报单汇总权限（v267 修复后的期望）：业务员深链进预报页 ⇒ **0 次 403** +
 *          **常驻**无权限说明（点名字色 / 说明"不是系统故障"）+ 6 秒后仍在。
 *          🔴 对照 v265：那时是「1 次 403 + 一句误导性『交叉表加载失败』+ toast 消失后
 *             只剩空表与灰按钮 + 页面无任何常驻提示」——本相位就是那条缺陷的回归护栏。
 *   D（10）反例对照：主管账号走同一深链 ⇒ 侧栏入口**可见**、summary 请求**真的发出且非 403**、
 *          无权限说明**不出现**。没有这一半，C 的「说明出现了」无法区分"数据驱动"与"写死一坨"。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptest'
const PASS = process.env.HG_PASS || 'Mptest@1'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v265-商品目标页签与数据新鲜度-2026-09-24'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)

let pass = 0, fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; log('  ✅ ' + name + (extra ? '　→ ' + extra : '')) }
  else { fail++; log('  ❌ ' + name + (extra ? '　→ ' + extra : '')) }
  return !!cond
}
const nz = (s) => String(s == null ? '' : s).replace(/\s+/g, '')

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO:"+JSON.stringify(d).slice(0,150);'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'

/* ── 页签取证：4 个按钮的文字 + 哪个 on + hash ── */
const JS_TABS = '(()=>{'
  + 'var bs=document.querySelectorAll(".module-tabs button");'
  + 'var o=[];bs.forEach(function(b){o.push({t:(b.innerText||"").trim(),on:b.className.indexOf("on")>=0})});'
  + 'return JSON.stringify({n:bs.length,btns:o,hash:location.hash})})()'

/* ── 「商品目标」页签内取证：容器在不在 + 页头处理 + 内容渲染 ── */
const JS_TARGET = '(()=>{'
  + 'var p=document.querySelector(".target-panel");'
  + 'var o={panel:!!p,hash:location.hash};'
  + 'if(p){'
  + '  o.caliber=!!p.querySelector(".pt-caliber");'
  + '  o.tbar=!!p.querySelector(".pt-tbar");'
  + '  o.audit=!!p.querySelector(".pt-audit");'
  + '  var h2=p.querySelector(".page-hd h2");'
  + '  o.h2Exist=!!h2;'
  + '  o.h2Display=h2?getComputedStyle(h2).display:null;'          // 期望 none（与页签同名，藏掉）
  + '  var sub=p.querySelector(".page-sub");'
  + '  o.subText=sub?(sub.innerText||"").trim():null;'
  + '  o.subDisplay=sub?getComputedStyle(sub).display:null;'        // 期望可见（业务口径，保留）
  + '  var t=p.querySelector("table");'
  + '  o.hasTable=!!t;'
  + '  o.err=/页面出错了|加载失败/.test(p.innerText||"");'
  + '}'
  + 'return JSON.stringify(o)})()'

/* ── 侧栏取证（入口是否已撤） ── */
const JS_SIDEBAR = '(()=>{'
  + 'var items=document.querySelectorAll(".sb-item");'
  + 'var arr=[];items.forEach(function(a){arr.push((a.innerText||"").trim())});'
  + 'return JSON.stringify({n:items.length,items:arr,'
  + 'hasTarget:arr.some(function(x){return x.indexOf("商品目标")>=0}),'
  + 'hasForecast:arr.some(function(x){return x.indexOf("预报订货管理")>=0})})})()'

/* ── 配置页签 / 审核台取证 ── */
const JS_CONFIG = '(()=>{var c=document.querySelector(".config-panel");'
  + 'return JSON.stringify({panel:!!c,hash:location.hash})})()'

const JS_AUDIT = '(()=>{'
  + 'var m=document.querySelector(".audit-modal");'
  + 'var s=document.querySelector(".audit-stale");'
  + 'var o={modal:!!m,stale:!!s,hash:location.hash};'
  + 'if(s){o.text=(s.innerText||"").replace(/\\s+/g," ").trim();'
  + '  var cs=getComputedStyle(s),rc=s.getBoundingClientRect();'
  + '  o.bg=cs.backgroundColor;o.fg=cs.color;o.visible=rc.width>0&&rc.height>0;'
  + '  o.top=Math.round(rc.top);}'
  + 'var sum=document.querySelector(".audit-sum");'
  + 'o.sum=sum?(sum.innerText||"").replace(/\\s+/g," ").trim():null;'
  + 'o.err=/页面出错了|加载失败/.test(document.body?document.body.innerText:"");'
  + 'return JSON.stringify(o)})()'

/* ── 无权限常驻说明取证（v267）── */
const JS_DENIED = '(()=>{'
  + 'var d=document.querySelector(".denied-state");'
  + 'var o={denied:!!d,hash:location.hash};'
  + 'if(d){'
  + '  o.text=(d.innerText||"").replace(/\\s+/g," ").trim();'
  + '  o.visible=(function(){var rc=d.getBoundingClientRect();return rc.width>0&&rc.height>0})();'
  + '  var hd=d.querySelector(".denied-hd");'
  + '  o.hdColor=hd?getComputedStyle(hd).color:null;'
  + '  o.hdBg=hd?getComputedStyle(hd).backgroundColor:null;'
  + '}'
  + 'var bs=document.querySelectorAll("button");'
  + 'for(var i=0;i<bs.length;i++){if((bs[i].innerText||"").indexOf("AI智能建议")>=0){o.aiBtn={disabled:bs[i].disabled}}}'
  + 'o.rows=document.querySelectorAll("table tbody tr").length;'
  + 'o.tabs=document.querySelectorAll(".module-tabs button").length;'
  + 'o.err=/页面出错了|加载失败/.test(document.body?document.body.innerText:"");'
  + 'return JSON.stringify(o)})()'

/* ── toast / 消息条读取 ── */
const JS_TOASTS = '(()=>{var o=[];'
  + 'var ts=document.querySelectorAll("[class*=toast],[class*=msg]");'
  + 'ts.forEach(function(t){var x=(t.innerText||"").trim();if(x&&x.length<300)o.push(x.slice(0,140))});'
  + 'return JSON.stringify(o)})()'

/* ── 装 fetch 记账（计 403 次数 + 某接口请求数）── */
const JS_CAP = (frag, key) => '(function(){'
  + 'if(!window.__rawFetch){window.__rawFetch=window.fetch;}'
  + 'window.__cap={c403:0,hit:0};'
  + 'window.fetch=function(u,o){var s=(typeof u==="string")?u:((u&&u.url)||"");'
  + '  if(s.indexOf(' + JSON.stringify(frag) + ')>=0){window.__cap.hit++;}'
  + '  var pr=window.__rawFetch.apply(this,arguments);'
  + '  if(pr&&pr.then){pr.then(function(r){if(r.status===403){window.__cap.c403++;}}).catch(function(){})}'
  + '  return pr;};'
  + 'return "armed"})()'
const JS_CAP_READ = '(()=>JSON.stringify({c403:window.__cap.c403,hit:window.__cap.hit}))()'

/* ── 点按钮（按文字） ── */
const JS_CLICK = (sel, text) => '(()=>{var bs=document.querySelectorAll(' + JSON.stringify(sel) + ');'
  + 'for(var i=0;i<bs.length;i++){var t=(bs[i].innerText||"").trim();'
  + 'if(t.indexOf(' + JSON.stringify(text) + ')>=0){bs[i].click();return "clicked:"+t}}'
  + 'return "notfound"})()'

/* ── 桩：把 audit-period 的 sales_freshness 换成 fresh，但**items 保持非空** ──
   为什么要非空：auditState 由 items.length 决定；空 items ⇒ 'empty' 分支 ⇒ 告警条本来就不渲染，
   那样"消失了"什么都证明不了（正反例同结果 = 探针作废）。 */
/* ── 统一桩（v265 建 / v267 修）─────────────────────────────────────────
   🔴 为什么要桩 —— 诚实说明，不是"为了让测试过"。

   **约束（2026-09-24 实测，两个提审测试账号各缺一半，没有任何账号两样都有）**：

   | 账号 | 角色 | `/auth/permissions` | `forecast-submissions/summary` | `forecast-audit/*` |
   |---|---|---|---|---|
   | `mptest`   | sales      | `[…,stock,data]`    | **403** | ✅ 200 |
   | `mptestsp` | supervisor | `[data,dashboard]`  | ✅ 200 | **403**（缺「库存」模块） |

   ⇒ 审核台（归 `stock` 模块 + `forecast_submissions` 的角色白名单）**只能由 老板/管理员 打通**。
     本探针没有老板账号，所以只能用 `mptest`（有 stock、缺汇总权限）并**把"页面状态"桩出来**：

   · `/api/auth/permissions` → 返回 `role='boss'`：
     **只为让前端的角色门禁放行**（`summaryDenied`）。注意它**不影响后端**——
     后端按租户库里的角色表独立裁决，所以下面 summary 仍然会 403、仍须桩。
   · `/api/forecast-submissions/summary` → 最小合法空表：
     **只为让 `cross.period` 成立**（`loadCross` 是 `Promise.all`，它 403 会让整函数 reject）。

   🔴 **audit-period 绝不桩**（`withFresh=false` 时）：相位 7 的全部判据
      （`101 天` / `2026-06-15` / 窗口 `2026-05-16~06-15` / `level=stale`）**都来自真接口**。
      探针另有一条断言盯着这件事：相位 7 里 `__stubCalls.audit` 必须 **== 0**
      —— 「正例的读数一次都没被桩拦过」。没有这条断言，整个正例都不可信。

   ⚠️ 相位 8 的 `withFresh=true` 才桩 audit-period，且**只**改 `sales_freshness`、
      保持 `items` 非空（空 items ⇒ `auditState='empty'` ⇒ 告警条本来就不渲染，
      正反例同结果 = 探针作废）。 */
const JS_BOOT_STUB = '(function(){'
  + 'window.__stubCalls={perm:0,summary:0,audit:0};'
  /* fresh 只在相位 8 打开：boot 期先设 false，相位 8 在**点击之前**置真。
     这样同一份 boot 脚本服务两个相位，不必注入两份（叠两份会互相覆盖，见 cdp-lite 注释）。 */
  + 'window.__stubFresh=false;'
  + 'if(!window.__rawFetch){window.__rawFetch=window.fetch.bind(window);}'
  + 'var J=function(o){return new Response(JSON.stringify(o),'
  + '  {status:200,headers:{"Content-Type":"application/json"}})};'
  + 'window.fetch=function(u,o){'
  + 'var s=(typeof u==="string")?u:((u&&u.url)||"");'
  + 'if(s.indexOf("/api/auth/permissions")>=0){'
  + 'window.__stubCalls.perm++;'
  + 'return Promise.resolve(J({permissions:["*"],plan:"pro",capabilities:null,'
  + 'user:{id:1,username:"stub",display_name:"桩账号",role:"boss",roles:["boss"]}}));}'
  + 'if(s.indexOf("/api/forecast-submissions/summary")>=0){'
  + 'window.__stubCalls.summary++;'
  + 'return Promise.resolve(J({ok:true,rows:[],all_units:[],confirmed:null,'
  + 'imported_products:[],matrix_rev:"",matrix_at:"",matrix_by:""}));}'
  + 'if(window.__stubFresh&&s.indexOf("/api/forecast-audit/audit-period")>=0){'
  + 'window.__stubCalls.audit++;'
  + 'return Promise.resolve(J({success:true,'
  + 'period:{start:"2026-09-24",end:"2026-09-25"},rebate_hint:null,'
  + 'sales_freshness:{level:"fresh",label:"销量数据最新到 2026-09-24（0 天前）",max_date:"2026-09-24",'
  + 'min_date:"2026-04-02",days_stale:0,order_count:9999,window_start:"2026-08-25",window_end:"2026-09-24",'
  + 'window_days:30,stale:false},'
  + 'summary:{sku_count:1,total_requested:1,total_suggested:1,missing_count:0,excess_count:0},'
  + 'items:[{product_id:1,name:"桩商品",spec:"",unit:"件",avg_daily_sales:1,current_stock:10,'
  + 'days_of_cover:10,safety_stock:7,lead_time_days:4,coverage_days:6,required_stock:13,'
  + 'suggested_qty:3,requested_qty:1,verdict:"与系统建议基本吻合",data_stale_days:0}]}));}'
  + 'return window.__rawFetch.apply(this,arguments);};'
  + 'return "boot-stubbed";})()'

/* ── 先选期次 ──
   审核按钮是 `:disabled="!cross.period"`，而 `cross.period` 只有在用户**从下拉里选中**某个
   期次之后才有值（下拉里"显示"第一项 ≠ 已选中它）。disabled 按钮上的 `.click()`
   **不触发 handler**，「点了没反应」在探针里长得跟"功能坏了"一模一样 —— 必须先把这变量隔离掉。 */
const JS_PICK_PERIOD = [
  '(function(){',
  '  var sels=document.querySelectorAll("select");',
  '  var best=null;',
  '  for(var i=0;i<sels.length;i++){',
  '    var s=sels[i];',
  '    if(s.options.length>1 && /报单期次|到货/.test(s.innerText||"")){ best=s; break; }',
  '  }',
  '  if(!best) return "nosel";',
  '  for(var j=1;j<best.options.length;j++){',
  '    if(best.options[j].value){',
  '      best.value=best.options[j].value;',
  '      best.dispatchEvent(new Event("change",{bubbles:true}));',
  '      return "picked:"+best.options[best.selectedIndex].text;',
  '    }',
  '  }',
  '  return "nofill";',
  '})()'
].join('')

let browser, failed = false
const go = async (page, hash, ms) => {
  await page.eval('location.hash=' + JSON.stringify(hash))
  await sleep(ms || 4500)
}
/* 🔴 v265 修：**必须能强制真加载**。
   `page.goto(BASE + '/#/forecast')` 在"当前已经在 #/forecast"时是**纯 fragment 导航**——
   浏览器不会重新加载文档，于是上一相位在页面里装的 fetch 桩、以及上一相位留下的
   `cross.value`（含已赋值的 period）**全部残留到下一相位**。
   实测后果：相位 9 想验"业务员 403 ⇒ 按钮灰掉"，读到的却是相位 8 桩出来的
   `disabled=false / 表格 7 行` —— 一条**假失败**，而它掩盖的恰恰是真缺陷。
   改根查询串（`?__r=<ts>`）即可强制整文档重新加载；hash 路由不受根查询串影响。 */
const hardGo = async (page, hash, ms) => {
  await page.goto(BASE + '/?__r=' + Date.now() + hash, ms || 9000)
}

try {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()

  log('=== 0. 登录 ' + USER + ' ===')
  await page.goto(BASE, 3500)
  const li = await page.eval(JS_LOGIN(USER, PASS))
  ok(li === 'OK', '登录 ' + USER, li)
  if (li !== 'OK') throw new Error('登录失败，后续无从验证')

  /* ═══════ Phase A：页签化（372）═══════ */
  log('')
  log('=== 1. 预报页 4 个页签 ===')
  await page.goto(BASE + '/#/forecast', 6500)
  const t0 = JSON.parse((await page.eval(JS_TABS)) || '{}')
  log('  页签读数：n=' + t0.n + '｜' + JSON.stringify(t0.btns) + '｜hash=' + t0.hash)
  ok(t0.n === 4, '页签数 == 4（本期预报 / 历史期次 / 报单配置 / 商品目标）', 'n=' + t0.n)
  const texts = (t0.btns || []).map(b => b.t)
  ok(texts.some(x => x.indexOf('商品目标') >= 0), '含「商品目标」页签', texts.join(' | '))
  ok((t0.btns || [])[0] && t0.btns[0].on, '默认落在「本期预报」（第一个 on）', JSON.stringify(t0.btns[0]))

  log('')
  log('=== 2. 侧栏入口（v267 新判据）：业务员**看不到**「预报订货管理」===')
  const sb = JSON.parse((await page.eval(JS_SIDEBAR)) || '{}')
  log('  侧栏 ' + sb.n + ' 条：' + (sb.items || []).join(' / ').slice(0, 200))
  ok(sb.hasTarget === false, '侧栏**已无**「商品目标」独立入口（v264/v265 撤除）', '（撤掉才消掉两个"目标"的困惑）')
  // v267：业务员拿到的是「必然 403 的假入口」⇒ 撤掉。正例（入口该在）见相位 10 主管账号。
  ok(sb.hasForecast === false, '**业务员侧栏已无「预报订货管理」**（假入口已撤）', '正例见相位 10')

  log('')
  log('=== 3. 点「商品目标」→ 页签切换 + URL 同步 ===')
  const c1 = await page.eval(JS_CLICK('.module-tabs button', '商品目标'))
  ok(c1.indexOf('clicked') === 0, '点到「商品目标」页签', c1)
  await sleep(4200)
  const tg = JSON.parse((await page.eval(JS_TARGET)) || '{}')
  log('  页签内容读数：' + JSON.stringify(tg))
  ok(tg.panel === true, '.target-panel 容器已挂载')
  ok(/tab=target/.test(String(tg.hash)), 'URL 同步为 ?tab=target', tg.hash)
  ok(tg.caliber === true, '口径条渲染（组件真的在跑，不是空壳）')
  ok(tg.tbar === true, '工具栏渲染（新建目标/期次选择都在）')
  ok(tg.h2Exist === true && tg.h2Display === 'none', '与页签同名的 <h2> 已隐藏（不重复标题）', 'display=' + tg.h2Display)
  ok(nz(tg.subText) === '按月设总量·分解到人·期次自动认领', '副标题**保留**（业务口径，页签上看不到）', tg.subText)
  ok(tg.subDisplay !== 'none', '副标题可见', 'display=' + tg.subDisplay)
  ok(tg.audit === true, '映射对账告警条仍在（16 个列名未配）')
  ok(!tg.err, '商品目标页无兜底错误态')
  await page.screenshot(SHOT_DIR + '/01-预报页-商品目标页签.png')

  log('')
  log('=== 4. 点「报单配置」→ 配置页签（反例：商品目标容器必须消失）===')
  const c2 = await page.eval(JS_CLICK('.module-tabs button', '报单配置'))
  ok(c2.indexOf('clicked') === 0, '点到「报单配置」页签', c2)
  await sleep(3500)
  const cf = JSON.parse((await page.eval(JS_CONFIG)) || '{}')
  const tg2 = JSON.parse((await page.eval(JS_TARGET)) || '{}')
  ok(cf.panel === true, '.config-panel 已挂载', cf.hash)
  ok(/tab=config/.test(String(cf.hash)), 'URL 同步为 ?tab=config', cf.hash)
  ok(tg2.panel === false, '**反例**：商品目标容器已卸载（v-if 互斥，不是叠着）', 'panel=' + tg2.panel)

  log('')
  log('=== 5. 点「本期预报」→ 默认页签**不写** URL 参数 ===')
  const c3 = await page.eval(JS_CLICK('.module-tabs button', '本期预报'))
  ok(c3.indexOf('clicked') === 0, '点到「本期预报」页签', c3)
  await sleep(3500)
  const t3 = JSON.parse((await page.eval(JS_TABS)) || '{}')
  const cf3 = JSON.parse((await page.eval(JS_CONFIG)) || '{}')
  ok(!/tab=/.test(String(t3.hash)), '默认页签时 hash 不带 tab 参数（保持 /forecast 干净）', t3.hash)
  ok(cf3.panel === false, '**反例**：配置容器已卸载', 'panel=' + cf3.panel)

  log('')
  log('=== 6. 旧链 #/product-target → redirect 到 ?tab=target ===')
  await go(page, '#/product-target', 5000)
  const t4 = JSON.parse((await page.eval(JS_TABS)) || '{}')
  const tg4 = JSON.parse((await page.eval(JS_TARGET)) || '{}')
  ok(/tab=target/.test(String(t4.hash)) || /tab=target/.test(String(tg4.hash)),
    '旧链被 redirect 到 ?tab=target（书签/历史不会白屏）', 'hash=' + t4.hash)
  ok(tg4.panel === true, 'redirect 后商品目标页签真的渲染了', 'panel=' + tg4.panel)
  const on4 = (t4.btns || []).filter(b => b.on).map(b => b.t)
  ok(on4.some(x => x.indexOf('商品目标') >= 0), '对应页签高亮正确', on4.join(','))

  /* ═══════ Phase B：审核台数据新鲜度（★2）═══════ */
  log('')
  log('=== 7. 审核台：「销量数据新鲜度」告警条（audit-period 走**真接口** = 停更 101 天）===')
  /* 🔴 桩必须在**导航之前**注入（boot 期），不能导航后再改 window.fetch：
     `store.loadPerms()` 在 boot 期拉 `/api/auth/permissions` 并把 `user.role` 落进 store，
     **同一租户只拉一次（有缓存）** ⇒ 导航后再装桩的话，`__stubCalls.perm` 恒 0、页面停在旧角色，
     读起来像「桩写错了」，其实**是时机错了**（v267 第一版就踩了这个，白查一轮）。 */
  const stubId = await page.addInitScript(JS_BOOT_STUB)
  ok(!!stubId, 'boot 期注入桩（perms→boss + summary 空表）—— 早于任何页面脚本', stubId ? 'id=' + stubId : '注入失败')
  await hardGo(page, '#/forecast', 11000)
  const pk = await page.eval(JS_PICK_PERIOD)
  log('  选期次：' + pk)
  ok(String(pk).indexOf('picked') === 0, '选中一个进行中的期次（审核按钮才会启用）', pk)
  await sleep(4000)
  // 🔴 中间态断言：先把「按钮为什么可点」隔离出来 —— 上一版探针就是漏了这一步，
  //    结果「点了没反应」长得跟「功能坏了」一模一样，白查一轮。
  const gate = await page.eval('(()=>{var o={stub:null,btn:null};'
    + 'o.stub=(window.__stubCalls)||null;'
    + 'var bs=document.querySelectorAll("button");'
    + 'for(var i=0;i<bs.length;i++){if((bs[i].innerText||"").indexOf("AI智能建议")>=0){o.btn={disabled:bs[i].disabled}}}'
    + 'var s=document.querySelector(".sel-period");'
    + 'o.sel=s?s.value:null;'
    + 'var d=document.querySelector(".denied-state");o.denied=!!d;'
    + 'o.body=(document.body.innerText||"").replace(/\\s+/g," ").slice(0,150);'
    + 'return JSON.stringify(o)})()')
  log('  闸门读数：' + String(gate).slice(0, 400))
  const g = JSON.parse(gate || '{}')
  const gs = g.stub || {}
  ok(Number(gs.perm) >= 1, 'perms 桩被调用过（前端角色门禁已放行 —— 它**不影响后端**）', '拦截 ' + gs.perm + ' 次')
  ok(Number(gs.summary) >= 1, 'summary 桩被调用过（否则"页面能开"是别的原因，不算数）', '拦截 ' + gs.summary + ' 次')
  ok(g.denied === false, '页面**没有**走到无权限态（这一态留给相位 9 的真实业务员）', 'denied=' + g.denied)
  ok(g.btn && g.btn.disabled === false, '审核按钮已解禁（cross.period 已被 loadCross 赋值）', 'disabled=' + (g.btn ? g.btn.disabled : 'null'))
  const c4 = await page.eval(JS_CLICK('button', 'AI智能建议'))
  ok(c4.indexOf('clicked') === 0, '点到「AI智能建议」（开审核台）', c4)
  await sleep(7000)
  /* 🔴 正例自证：audit-period **一次都没被桩拦过** ⇒ 下面所有读数都来自真接口。
     没有这一条，「101 天」这种数字完全可能是桩里写死的（本项目铁律：正反例必须可分辨）。 */
  const st7 = JSON.parse((await page.eval('(()=>JSON.stringify(window.__stubCalls||{}))()')) || '{}')
  ok(Number(st7.audit) === 0, '**正例自证**：audit-period 未被桩拦过（读数全部来自真接口）', '拦截 ' + st7.audit + ' 次')
  const a1 = JSON.parse((await page.eval(JS_AUDIT)) || '{}')
  log('  审核台读数：modal=' + a1.modal + '｜stale=' + a1.stale + '｜visible=' + a1.visible
    + '｜bg=' + a1.bg + '｜fg=' + a1.fg)
  log('  告警文案：' + String(a1.text).slice(0, 220))
  log('  汇总条：' + String(a1.sum).slice(0, 140))
  ok(a1.modal === true, '审核台弹窗已打开')
  ok(a1.stale === true, '**告警条出现了**（数据停更 ⇒ 必须提示，不能装作正常）')
  ok(String(a1.text).indexOf('已停更') >= 0, '文案含「已停更」', '')
  ok(String(a1.text).indexOf('101 天') >= 0, '文案含真实天数「101 天」（与接口读数逐字一致）')
  ok(String(a1.text).indexOf('2026-06-15') >= 0, '文案含数据最新日期 2026-06-15')
  ok(String(a1.text).indexOf('不是最近 30 天') >= 0, '明说「统计窗口不是最近 30 天」（这才是关键误导点）')
  ok(String(a1.text).indexOf('2026-05-16') >= 0, '给出窗口起点 2026-05-16')
  ok(a1.visible === true, '告警条可见（非 display:none 的幽灵）', 'top=' + a1.top)
  ok(!a1.err, '无兜底错误页')
  await page.screenshot(SHOT_DIR + '/02-审核台-销量数据已停更101天.png')

  log('')
  log('=== 8. **反例对照**：把 audit-period 也桩成 fresh（items 保持非空）⇒ 告警条必须消失 ===')
  await hardGo(page, '#/forecast', 11000)   // boot 桩（perms + summary）自动重新生效
  const fr = await page.eval('(function(){window.__stubFresh=true;return String(window.__stubFresh)})()')
  ok(fr === 'true', '在同一份 boot 桩上打开 fresh 开关（不另注入第二份 —— 叠两份会互相覆盖）', fr)
  const pk2 = await page.eval(JS_PICK_PERIOD)
  log('  选期次：' + pk2)
  ok(String(pk2).indexOf('picked') === 0, '选中期次（按钮解禁的前置）', pk2)
  await sleep(4000)
  const gate2 = await page.eval('(()=>{var o={stub:null,btn:null};'
    + 'o.stub=(window.__stubCalls)||null;'
    + 'var bs=document.querySelectorAll("button");'
    + 'for(var i=0;i<bs.length;i++){if((bs[i].innerText||"").indexOf("AI智能建议")>=0){o.btn={disabled:bs[i].disabled}}}'
    + 'return JSON.stringify(o)})()')
  const g2 = JSON.parse(gate2 || '{}')
  const g2s = g2.stub || {}
  ok(Number(g2s.summary) >= 1, 'summary 桩被调用过（反例同样只在"页面可用"时才成立）', '拦截 ' + g2s.summary + ' 次')
  ok(g2.btn && g2.btn.disabled === false, '审核按钮已解禁', 'disabled=' + (g2.btn ? g2.btn.disabled : 'null'))
  const c5 = await page.eval(JS_CLICK('button', 'AI智能建议'))
  ok(c5.indexOf('clicked') === 0, '桩生效后再开审核台', c5)
  await sleep(6000)
  const a2 = JSON.parse((await page.eval(JS_AUDIT)) || '{}')
  const calls = await page.eval('String((window.__stubCalls&&window.__stubCalls.audit)||0)')
  ok(Number(calls) >= 1, 'audit-period 桩**确实被调用过**（否则"消失"是假绿）', '拦截 ' + calls + ' 次')
  log('  桩后读数：modal=' + a2.modal + '｜stale=' + a2.stale + '｜sum=' + String(a2.sum).slice(0, 100))
  ok(a2.modal === true, '审核台照常打开（桩没弄坏主流程）')
  ok(a2.stale === false, '**告警条消失**（数据新鲜时不打扰）')
  ok(a2.sum !== null, '审核台主体照常渲染（桩数据已进入表格）', String(a2.sum).slice(0, 80))
  ok(!a2.err, '无兜底错误页')
  await page.screenshot(SHOT_DIR + '/03-对照-数据新鲜时告警条不出现.png')

  // 控制台口径：cdp-lite 只收 `console.error` 与未捕获异常（403 网络响应不计入）。
  const errN = page.errors.length
  ok(errN === 0, '控制台 0 报错（Phase A 页签化 + Phase B 审核台）', errN + ' 条')
  if (errN) page.errors.slice(0, 8).forEach(e => log('   ' + String(e).slice(0, 200)))

  /* ═══════ Phase C：缺陷已修（v267）—— 业务员深链进预报页 ═══════
     v265 这条相位是**给缺陷留证**，当时的读数（已成历史，留档对照）：
       403 出现 1 次｜toast「交叉表加载失败: 仅管理员 / 老板 / 主管可查看报单汇总」｜
       6 秒后 toast 消失、表格空、按钮永久 disabled、页面无任何常驻提示、0 报错。
     v267 修完后**同一条相位的期望整体反转**：
       · 403 次数必须 **0** —— 按角色预判，那个注定失败的请求根本不再发出；
       · 不能出现「交叉表加载失败」（把权限说成故障的措辞已消除）；
       · 必须有**常驻**说明 `.denied-state`，且 6 秒后仍在；
       · 文案必须点名「你的角色是业务员」并明说「不是系统故障」。
     🔴 反例对照（相位 10）：同一个深链换主管账号 ⇒ 该说明**必须不出现**。
        没有这一半，「说明出现了」可能只是模板里写死的一坨。 */
  log('')
  log('=== 9. 缺陷已修：业务员深链进预报页 = 常驻说明（0 次 403、不再说「加载失败」）===')
  /* 🔴 必须**先摘掉 boot 桩**再导航：`Page.addScriptToEvaluateOnNewDocument` 对该 page 的
     **所有后续导航**持续生效 ⇒ 不摘的话，本相位会被喂成 "boss 角色 + 空汇总表"，
     「0 次 403 / 常驻说明」这些判据全部变成假绿（桩把要验的东西直接抹平了）。 */
  await page.removeInitScript(stubId)
  ok(true, '已摘掉 boot 桩（后续相位回到真实角色：业务员）')
  await hardGo(page, '#/forecast', 11000)
  const cap = await page.eval(JS_CAP('/api/forecast-submissions/summary'))
  ok(cap === 'armed', '取证钩子已装（计 403 次数 + summary 请求数）', cap)
  await sleep(6500)   // 给 loadCross 足够时间把该跑的都跑完
  const cp0 = JSON.parse((await page.eval(JS_CAP_READ)) || '{}')
  const d9 = JSON.parse((await page.eval(JS_DENIED)) || '{}')
  const t9 = JSON.parse((await page.eval(JS_TOASTS)) || '[]')
  log('  请求读数：summary 请求 ' + cp0.hit + ' 次｜其中 403 ' + cp0.c403 + ' 次')
  log('  说明读数：denied=' + d9.denied + '｜visible=' + d9.visible
    + '｜hdColor=' + d9.hdColor + '｜hdBg=' + d9.hdBg + '｜表格行=' + d9.rows
    + '｜页签数=' + d9.tabs + '｜AI按钮=' + JSON.stringify(d9.aiBtn))
  log('  说明文案：' + String(d9.text).slice(0, 240))
  log('  toast：' + JSON.stringify(t9))
  ok(Number(cp0.c403) === 0, '**0 次 403**（按角色预判提前拦掉，不再白打一条注定失败的请求）', cp0.c403 + ' 次')
  ok(Number(cp0.hit) === 0, 'summary 请求数 = 0（连发都没发）', cp0.hit + ' 次')
  ok(d9.denied === true, '**常驻说明出现了**（.denied-state）')
  ok(d9.visible === true, '常驻说明可见（非 display:none 的幽灵）')
  ok(String(d9.text).indexOf('你的角色不能查看报单汇总') >= 0, '标题说清「不能查看报单汇总」')
  ok(String(d9.text).indexOf('业务员') >= 0, '点名当前角色（业务员）—— 而不是让用户自己猜')
  ok(String(d9.text).indexOf('管理员 / 老板 / 主管') >= 0, '列出「谁能看」（指向可行动的人）')
  ok(String(d9.text).indexOf('不是系统故障') >= 0, '明说「不是系统故障」（这是当初被误读成故障的那一点）')
  ok(!(t9 || []).some(t => t.indexOf('加载失败') >= 0), '**没有**「交叉表加载失败」这种误导措辞', JSON.stringify(t9))
  ok(d9.err === false, '页面正文无「加载失败」字样（toast 消失后也不残留误导）')
  await page.screenshot(SHOT_DIR + '/04-业务员-无汇总权限常驻说明.png')

  log('')
  log('  --- 9b. 6 秒后再读一次：证明这条说明是**常驻**的（v265 时 here 是空的）---')
  await sleep(6000)
  const d9b = JSON.parse((await page.eval(JS_DENIED)) || '{}')
  const t9b = JSON.parse((await page.eval(JS_TOASTS)) || '[]')
  log('  6 秒后：denied=' + d9b.denied + '｜toast=' + JSON.stringify(t9b))
  ok(d9b.denied === true && d9b.visible === true, '**6 秒后说明仍在**（对比 v265：那时只剩空表 + 灰按钮）')
  await page.screenshot(SHOT_DIR + '/05-业务员-无权限说明常驻6秒后.png')

  /* ═══════ Phase D：**反例对照** —— 主管账号走同一条深链 ═══════
     主管（role=supervisor）在后端 `SUMMARY_ROLES` 白名单里 ⇒ 侧栏入口应**可见**、
     summary 应 **200**、那条无权限说明应**不出现**。
     为什么必须有这一半：「说明出现了」单独看无法区分「数据驱动」与「模板里写死的一坨」——
     两者在业务员那一侧的结果完全一样。用主管跑同一个 URL，结果必须相反。
     ⚠️ 只读：本相位不点任何写按钮。 */
  log('')
  log('=== 10. **反例对照**：主管账号（在白名单里）走同一个深链 ===')
  await hardGo(page, '#/workbench', 7000)
  const li2 = await page.eval(JS_LOGIN('mptestsp', 'Mpsup@1'))
  ok(li2 === 'OK', '换登主管 mptestsp', li2)
  await hardGo(page, '#/forecast', 11000)
  const cap2 = await page.eval(JS_CAP('/api/forecast-submissions/summary'))
  ok(cap2 === 'armed', '取证钩子已装（主管这一轮）', cap2)
  /* ⚠️ 钩子必须在**请求发生之前**装好。boot 期的 loadCross 早在 `hardGo` 里就跑完了
     （钩子那时还不存在）⇒ 必须先钩、再**主动触发一次真实重载**。
     这里用「改期次」——它走的是 `onPeriodChange → loadCross`，与用户手点下拉**同一条链**，
     既不引入桩、也不碰任何写接口。v267 第一版漏了这一步 ⇒ 读到 hit=0 的**假失败**。 */
  const pk10 = await page.eval(JS_PICK_PERIOD)
  ok(String(pk10).indexOf('picked') === 0, '改期次以触发一次真实 loadCross（钩子才能记账）', pk10)
  await sleep(6000)
  const cpb = JSON.parse((await page.eval(JS_CAP_READ)) || '{}')
  const sb2 = JSON.parse((await page.eval(JS_SIDEBAR)) || '{}')
  const d10 = JSON.parse((await page.eval(JS_DENIED)) || '{}')
  log('  主管侧栏：' + (sb2.items || []).join(' / ').slice(0, 200))
  log('  请求读数：summary 请求 ' + cpb.hit + ' 次｜其中 403 ' + cpb.c403 + ' 次')
  log('  说明读数：denied=' + d10.denied + '｜表格行=' + d10.rows + '｜页签数=' + d10.tabs
    + '｜AI按钮=' + JSON.stringify(d10.aiBtn))
  ok(sb2.hasForecast === true, '**反例**：主管侧栏**有**「预报订货管理」（入口存在性确由角色驱动）')
  ok(Number(cpb.hit) >= 1, '主管这一轮**真的发了** summary 请求（对比业务员的 0 次）', cpb.hit + ' 次')
  ok(Number(cpb.c403) === 0, '主管的 summary **没有** 403（后端白名单确实放他过）', cpb.c403 + ' 次')
  ok(d10.denied === false, '**反例**：主管进去**没有**无权限说明（说明由角色驱动，非写死）')
  ok(d10.tabs === 4, '页签照常 4 个（同一页面、不同权限，不是两套页面）', 'n=' + d10.tabs)
  await page.screenshot(SHOT_DIR + '/06-对照-主管有权限时入口可见且无该说明.png')

  const errN2 = page.errors.length
  ok(errN2 === 0, '控制台全程 0 报错（Phase A–D）', errN2 + ' 条')
  if (errN2) page.errors.slice(0, 8).forEach(e => log('   ' + String(e).slice(0, 200)))
} catch (e) {
  failed = true
  log('❌ 探针异常：' + (e && e.message ? e.message : e))
} finally {
  try { if (browser) await browser.close() } catch { }
}

log('')
log('════════ 断言 ' + pass + ' 项通过 / ' + fail + ' 项失败 ════════')
process.exit(failed || fail ? 1 : 0)
