/**
 * v274-e2e.mjs —— 「舟谱单据导入」入口从侧栏迁进「能力中心 › 连接器 › ERP 数据源」的**真机只读**验收
 *
 * 要证的八件事（八个相位，共 62 条断言）：
 *   A. 侧栏**已经没有**「舟谱单据导入」（撤入口），条目数 13→12，锚点条目仍在
 *   B. 能力中心「ERP 数据源」区**多出第三张卡**，状态「已接入」+ 副标题的数字**与接口逐字一致**
 *      ＋几何：三卡等宽 425px / 各占 1/3 栅格 / 副标题单行 / 三卡等高
 *   C. 点卡片不是死按钮：hash 真的切到 /zhoupu-import 且页面渲染出来
 *   D. 反例对照 ①（桩 connected=false）⇒ 卡片改口「未使用 / 去导入」
 *   E. 反例对照 ②（桩 reject）      ⇒ 卡片仍在、静默降级、0 新报错、不连累另两张卡
 *   F. 反例对照 ③（换角色 = 主管）  ⇒ **卡片不渲染**，而且**根本没发** source-status 请求
 *                                    （证明是判据把它藏了，不是页面没渲染 —— 另两张卡照常在）
 *   G. **零业务写入**地靶向验证 v271 的进度轮询修复（接回一个桩成「已完成」的任务 ⇒ 报告必须出来）
 *   H. 收尾：注销探针自己登录的会话（判据取接口回执 `{"success":true}`，不看状态码）
 *
 * 🔴 全程只读：不点保存、不点导入、不提交任何写动作。唯一写动作是**本地** localStorage 种 token。
 *    反例对照的桩打在页面内 `window.fetch`，只影响这一个标签页，刷新即还原。
 *    Phase G 用的是「刷新后接回没跑完的任务」入口 + status 桩，**不碰业务表**。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN || ''
const TENANT = process.env.HG_TENANT || '1'
const SUB_USER = process.env.HG_SUB_USER || 'mptestsp'
const SUB_PASS = process.env.HG_SUB_PASS || 'Mpsup@1'
const SHOT_DIR = process.env.HG_SHOT || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v274-舟谱入口迁移-2026-09-25'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)

let pass = 0, fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; log('  ✅ ' + name + (extra != null ? '　→ ' + extra : '')) }
  else { fail++; log('  ❌ ' + name + (extra != null ? '　→ ' + extra : '')) }
  return !!cond
}
const nz = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()

/* 用生产上现存的 boss 会话直接种登录态（不需要密码） */
const JS_SEED = (tok, tid) => 'localStorage.setItem("hergent_v2_token",' + JSON.stringify(tok) + ');'
  + 'localStorage.setItem("hergent_v2_tenant",' + JSON.stringify(tid) + ');"seeded"'

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO:"+JSON.stringify(d).slice(0,150);'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return "OK:"+(d.user&&d.user.role)})'

/* 页面内只读 GET —— 🔴 先在页面内 JSON.stringify，page.eval 的 returnByValue 对 Promise<object> 会退化 */
const JS_API = (url) => 'fetch(' + JSON.stringify(url) + ',{headers:{'
  + '"Authorization":"Bearer "+localStorage.getItem("hergent_v2_token")}})'
  + '.then(function(r){return r.text().then(function(t){return JSON.stringify({s:r.status,t:t.slice(0,3000)})})})'

/* ── 侧栏取证 ── */
const JS_SIDEBAR = '(()=>{var o={};'
  + 'o.items=[].map.call(document.querySelectorAll(".sb-item"),function(e){return (e.innerText||"").trim()});'
  + 'o.n=o.items.length;'
  + 'o.hasZhoupu=o.items.some(function(t){return t.indexOf("舟谱")>=0});'
  + 'o.hasArchive=o.items.some(function(t){return t.indexOf("档案管理")>=0});'
  + 'o.hasForecast=o.items.some(function(t){return t.indexOf("预报")>=0});'
  + 'o.hasConnect=o.items.some(function(t){return t.indexOf("能力中心")>=0});'
  + 'return JSON.stringify(o)})()'

/* ── 「ERP 数据源」区取证：三张卡的文本 + 几何 + 位置 ──
   锚点选择：**不写死"应该有 3 张"** —— 反例相位（主管）本来就该是 2 张。
   先取到那一区，再把卡逐个描述出来，由外层按相位分别断言。 */
const JS_CC = '(()=>{var o={};'
  + 'var secs=[].slice.call(document.querySelectorAll(".cc-section"));'
  + 'var erp=null;'
  + 'for(var i=0;i<secs.length;i++){var b=secs[i].querySelector(".panel-hd b");'
  + ' if(b&&(b.innerText||"").indexOf("ERP 数据源")>=0){erp=secs[i];break}}'
  + 'o.sectionFound=!!erp;'
  + 'o.head=erp?((erp.querySelector(".panel-hd")||{}).innerText||"").trim():"";'
  + 'var cards=erp?[].slice.call(erp.querySelectorAll(".cc-card")):[];'
  + 'o.cards=cards.map(function(c){'
  + ' var g=function(sel){var e=c.querySelector(sel);return e?(e.innerText||"").trim():""};'
  + ' var rc=c.getBoundingClientRect();'
  + ' var d=c.querySelector(".cc-desc"),dr=d?d.getBoundingClientRect():{height:0};'
  + ' var grid=erp.querySelector(".cc-grid"),gr=grid?grid.getBoundingClientRect():{width:0};'
  + ' return {name:g(".cc-name"),state:g(".cc-state"),desc:g(".cc-desc"),action:g(".cc-action"),'
  + '  title:c.getAttribute("title")||"",w:Math.round(rc.width),h:Math.round(rc.height),'
  + '  descH:Math.round(dr.height),descW:Math.round((d?d.getBoundingClientRect().width:0)),'
  + '  gridW:Math.round(gr.width),left:Math.round(rc.left),top:Math.round(rc.top),'
  + '  cls:c.className,opac:getComputedStyle(c).opacity};});'
  + 'o.n=o.cards.length;'
  + 'o.stubCalls=(window.__zStub||0);'
  + 'o.reqList=(window.__zReq||[]).slice(-40);'
  + 'o.sts=(window.__zSts||[]).map(function(x){return {p:x.p.replace(location.origin,""),s:x.s}});'
  + 'o.hash=location.hash;'
  + 'o.bodyLen=(document.body?document.body.innerText:"").length;'
  + 'o.errPage=/页面出错了|Something went wrong/.test(document.body?document.body.innerText:"");'
  + 'return JSON.stringify(o)})()'

/* 桩：三种模式
 *   'record' → 只记录，不拦截（用来证明"某请求确实发出去了 / 确实没发"）
 *   'fresh'  → 拦舟谱 source-status 返 connected=false
 *   'fail'   → 拦舟谱 source-status 直接 reject
 *
 * 🔴 **必须在"文档已经加载完、但目标组件还没挂载"的时刻装上**：
 *   `page.goto` 会换一个新文档，装在旧文档上的桩**随之消失**（实测拦截数 = 0，
 *   看起来像"请求没发出去"，其实是桩根本没生效）。所以流程一律是：
 *     ① hardGo 到一个中立路由（本页不请求这几条接口）
 *     ② 装桩
 *     ③ **hash 导航**到 #/connect（SPA 内跳转，不换文档）⇒ onMounted 在桩生效后才跑
 *   （本仓没有 <KeepAlive>，所以每次进 ConnectCenter 都会重新挂载、onMounted 会重跑。） */
const JS_PATCH = (mode) => '(function(){'
  + 'window.__zStub=0;window.__zReq=[];window.__zSts=[];'
  + 'if(!window.__origFetch){window.__origFetch=window.fetch;}'
  + 'window.fetch=function(u,o){'
  + 'var s=(typeof u==="string")?u:((u&&u.url)||"");'
  + 'try{window.__zReq.push(s);}catch(e){}'
  + 'if(' + JSON.stringify(mode) + '!=="record"&&s.indexOf("/api/import/zhoupu/source-status")>=0){'
  + 'window.__zStub++;'
  + (mode === 'fresh'
    ? 'return Promise.resolve(new Response(JSON.stringify({success:true,data:{connected:false,label:"舟谱 / 导出表",what:"x"}}),'
      + '{status:200,headers:{"Content-Type":"application/json"}}));'
    : 'return Promise.reject(new Error("stub-fail-network"));')
  + '}'
  + 'var pr=window.__origFetch.apply(this,arguments);'
  + 'if(pr&&pr.then){return pr.then(function(r){try{window.__zSts.push({p:s,s:r.status});}catch(e){};return r})}'
  + 'return pr;};'
  + 'return "patched:' + mode + '";})()'

/* ① 干净文档 → ② 装桩 → ③ SPA 内跳进能力中心（onMounted 才会在桩生效后触发） */
const openConnect = async (page, mode, ms) => {
  await hardGo(page, '#/workbench', 6000)
  const p = await page.eval(JS_PATCH(mode))
  await page.eval('location.hash="#/connect"')
  await sleep(ms || 7000)
  return p
}

/* 截图前把「ERP 数据源」那一区滚到视口里 —— 否则截到的是页面顶部的「连接手机」，
   等于没拍到本次的交付物（第一版探针就是这么截的）。 */
const JS_SCROLL_CC = '(()=>{var secs=[].slice.call(document.querySelectorAll(".cc-section"));'
  + 'for(var i=0;i<secs.length;i++){var b=secs[i].querySelector(".panel-hd b");'
  + 'if(b&&(b.innerText||"").indexOf("ERP 数据源")>=0){secs[i].scrollIntoView({block:"center"});return "scrolled"}}'
  + 'return "no-section"})()'

/* ── v271 轮询修复的**靶向**验证 ──
 * 用页面自带的「刷新后接回没跑完的任务」入口（sessionStorage.hergent_zhoupu_job），
 * 把 status 接口桩成一个**已完成**的任务 ⇒ 页面必须渲染出报告。
 *
 * 🔴 这个相位能**精确判别** raw 契约的缺陷：
 *     `poll()` 里是 `const d = (r && r.data) || null; if (!d) return`。
 *     · 若 `zhoupuApi.status` 缺 `raw:true`（改前的状态）⇒ `api()` 把 data 解包掉
 *       ⇒ `r.data` 恒 undefined ⇒ `d` 恒 null ⇒ **每一拍都 return，永远不 resolve**
 *       ⇒ 页面一直停在「正在读取」、报告永不出现。
 *     · 加了 `raw:true` ⇒ `r` 是整包 ⇒ `r.data` 是报告 ⇒ 正常渲染。
 *     ⇒ 断言"报告出现了"就等于断言"轮询能走到完成"，且**不写任何业务数据**
 *       （全程没有上传文件、没有 execute）。 */
const STUB_JOB = JSON.stringify({
  success: true,
  data: {
    id: 'deadbeefdeadbeef', kind: 'preview', status: 'done', phase: '读完了',
    lines_done: 1234, lines_total: 1234, orders_done: 7, orders_total: 7,
    error: null, percent: 100, elapsed_sec: 3.2,
    result: {
      kind: 'zhoupu_sale', label: '舟谱销售结算明细表', sheet: 'Sheet1', header_row: 6,
      date_from: '2026-09-01', date_to: '2026-09-24',
      stats: { orders_total: 7, orders_created: 7, orders_existed: 0, orders_failed: 0,
               orders_empty: 0, orders_blocked: 0, lines_total: 1234, lines_created: 1234,
               lines_skipped: 0, commits: 1 },
      missing: [], warnings: [], columns: [], token: '0000000000000000'
    }
  }
})

const JS_PATCH_JOB = '(function(){'
  + 'window.__jStub=0;window.__jReq=[];'
  + 'if(!window.__origFetch){window.__origFetch=window.fetch;}'
  + 'window.fetch=function(u,o){'
  + 'var s=(typeof u==="string")?u:((u&&u.url)||"");'
  + 'try{window.__jReq.push(s);}catch(e){}'
  + 'if(s.indexOf("/api/import/zhoupu/status/")>=0){window.__jStub++;'
  + 'return Promise.resolve(new Response(' + JSON.stringify(STUB_JOB)
  + ',{status:200,headers:{"Content-Type":"application/json"}}));}'
  + 'return window.__origFetch.apply(this,arguments);};'
  + 'return "patched:job";})()'

const JS_JOB_VIEW = '(()=>{var t=document.body?document.body.innerText:"";'
  + 'var g=function(s){var e=document.querySelector(s);return e?(e.innerText||"").trim():""};'
  + 'return JSON.stringify({stubCalls:(window.__jStub||0),reqs:(window.__jReq||[]).slice(-10),'
  + 'running:/正在读取|正在导入/.test(t),hasReport:t.indexOf("共读到")>=0,'
  + 'runBar:!!document.querySelector(".zp-running"),'
  + 'hasYear:/1,234/.test(t)&&/行明细/.test(t),'
  + 'pickVisible:!!document.querySelector(".zp-wrap"),'
  + 'text:t.replace(/\\s+/g," ").slice(0,400)})})()'

const has = (list, frag) => (list || []).some(x => String(x).indexOf(frag) >= 0)
const doneOf = (sts, frag) => (sts || []).filter(x => String(x.p).indexOf(frag) >= 0)

let browser, failed = false
/* 强制真加载：只改 query 串 ⇒ 文档真的重新请求，桩与组件状态都不会残留 */
const hardGo = async (page, hash, ms) => {
  await page.goto(BASE + '/?__r=' + Date.now() + hash, ms || 5000)
}

try {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()

  log('=== 0. 准备登录态 ===')
  if (!TOKEN) throw new Error('缺少 HG_TOKEN（生产 boss 会话 token）')
  await page.goto(BASE, 3500)
  const seeded = await page.eval(JS_SEED(TOKEN, TENANT))
  ok(seeded === 'seeded', '已种入 boss 会话 token（未用密码）', seeded)

  /* ══════════════════════ Phase A：侧栏 ══════════════════════ */
  log('')
  log('=== 1. 侧栏：舟谱那条必须已经不在了 ===')
  await hardGo(page, '#/workbench', 6000)
  const sb = JSON.parse((await page.eval(JS_SIDEBAR)) || '{}')
  log('  侧栏条目（' + sb.n + '）：' + JSON.stringify(sb.items))
  ok(!sb.hasZhoupu, '侧栏里搜不到「舟谱」（入口已撤）', 'hasZhoupu=' + sb.hasZhoupu)
  ok(sb.n === 12, '侧栏条目数 = 12（撤掉后由 13 变 12）', '实测 ' + sb.n)
  ok(sb.hasArchive && sb.hasConnect, '锚点仍在：「档案管理」「能力中心」都在 ⇒ 侧栏本身正常渲染')
  ok(sb.hasForecast, '「预报订货管理」在（另一个 v267 角色判据未被误伤）')

  /* ══════════════════════ Phase B：真实数据面 ══════════════════════ */
  log('')
  log('=== 2. 能力中心：真实数据面（读数必须与接口逐字一致）===')
  const pB = await openConnect(page, 'record')
  ok(pB === 'patched:record', '已装上记录器（只记录不拦截）', pB)
  const apiRaw = await page.eval(JS_API('/api/import/zhoupu/source-status'))
  const api = JSON.parse(JSON.parse(apiRaw).t)
  log('  接口读数：' + JSON.stringify(api.data))
  const d = api.data || {}
  ok(JSON.parse(apiRaw).s === 200 && d.connected === true, '接口 200 且 connected=true')

  const cc = JSON.parse((await page.eval(JS_CC)) || '{}')
  log('  ERP 数据源区：' + cc.head)
  cc.cards.forEach((c, i) => log('   卡' + (i + 1) + '：' + c.name + ' | ' + c.state + ' | ' + c.desc + ' | ' + c.action
    + ' | w=' + c.w + ' descH=' + c.descH))
  ok(cc.sectionFound, '找到「ERP 数据源」区', cc.head)
  ok(cc.cards.length === 3, '这一区有 3 张卡（畅捷通 / 金蝶 / 舟谱）', cc.cards.length)
  ok(cc.cards[2] && nz(cc.cards[2].name) === '舟谱 / 导出表', '第 3 张是「舟谱 / 导出表」（位置在金蝶之后）',
    cc.cards[2] && cc.cards[2].name)
  ok(cc.cards[2] && nz(cc.cards[2].state) === '已接入', '状态标签 = 已接入', cc.cards[2] && cc.cards[2].state)

  const lastAt = String(d.last_at || '')
  const m = lastAt.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/)
  const expectDay = m ? (Number(m[2]) + '月' + Number(m[3]) + '日 ' + m[4]) : lastAt.slice(0, 16)
  const expectOrders = Number(d.last_orders_created || 0).toLocaleString('zh-CN')
  const expectDesc = '上次 ' + expectDay + ' · ' + expectOrders + ' 张单'
  ok(nz(cc.cards[2].desc) === expectDesc, '副标题 = 由接口现算的「上次 时间 · 张数」',
    JSON.stringify(cc.cards[2].desc) + ' vs ' + JSON.stringify(expectDesc))
  ok(cc.cards[2].title.indexOf(d.last_kind_label) >= 0, 'tooltip 里带接口给的形态名',
    JSON.stringify(cc.cards[2].title.slice(0, 60)))
  ok(cc.cards[2].title.indexOf('明细 ' + Number(d.last_lines_created).toLocaleString('zh-CN')) >= 0,
    'tooltip 里的明细行数与接口一致')
  ok(/再导一份/.test(cc.cards[2].action), '按钮文案 = 再导一份（已接入态）', cc.cards[2].action)

  /* 几何：三卡等宽 + 副标题单行（长了会把同一行的另两张卡顶高） */
  const ws = cc.cards.map(c => c.w)
  ok(Math.max(...ws) - Math.min(...ws) <= 2, '三张卡等宽（栅格没被撑歪）', JSON.stringify(ws))
  ok(cc.cards.every(c => c.w / (c.gridW / 3) >= 0.9), '每张卡占住 1/3 栅格（无视觉塌陷）',
    JSON.stringify(cc.cards.map(c => Math.round(c.w / (c.gridW / 3) * 100) + '%')))
  const oneLine = cc.cards[2].descH
  ok(oneLine > 0 && oneLine <= 22, '舟谱卡副标题是**单行**（<=22px）', 'descH=' + oneLine + 'px')
  ok(cc.cards[1].h === cc.cards[2].h && cc.cards[0].h === cc.cards[1].h,
    '三张卡等高（副标题没把这一行顶高）', JSON.stringify(cc.cards.map(c => c.h)))

  /* 主功能未连累 */
  ok(has(cc.reqList, '/api/datasources/v2/chanjet/status'), '畅捷通状态请求照常发出')
  ok(has(cc.reqList, '/api/datasources/v2/kingdee/status'), '金蝶状态请求照常发出')
  const cj = doneOf(cc.sts, '/api/datasources/v2/chanjet/status')
  const kd = doneOf(cc.sts, '/api/datasources/v2/kingdee/status')
  const zs = doneOf(cc.sts, '/api/import/zhoupu/source-status')
  ok(cj.length && cj.every(x => x.s === 200), '畅捷通状态 200', JSON.stringify(cj))
  ok(kd.length && kd.every(x => x.s === 200), '金蝶状态 200', JSON.stringify(kd))
  ok(zs.length >= 1 && zs.every(x => x.s === 200), '舟谱状态接口被调用且 200', JSON.stringify(zs))
  ok(!cc.errPage, '无兜底错误页')

  const SHOT_A = SHOT_DIR + '/01-能力中心-舟谱数据源卡-真实数据.png'
  await page.eval(JS_SCROLL_CC); await sleep(500)
  try { await page.screenshot(SHOT_A); log('  截图：' + SHOT_A) } catch { }

  /* ══════════════════════ Phase C：点卡片不是死按钮 ══════════════════════ */
  log('')
  log('=== 3. 点卡片：路由真的切过去且页面渲染出来（不是死按钮）===')
  const clicked = await page.eval('(()=>{var secs=[].slice.call(document.querySelectorAll(".cc-section"));'
    + 'var erp=null;for(var i=0;i<secs.length;i++){var b=secs[i].querySelector(".panel-hd b");'
    + 'if(b&&(b.innerText||"").indexOf("ERP 数据源")>=0){erp=secs[i];break}}'
    + 'var c=erp?erp.querySelectorAll(".cc-card")[2]:null;if(!c)return "no-card";c.click();return "clicked"})()')
  ok(clicked === 'clicked', '第 3 张卡可点击', clicked)
  await sleep(4500)
  const after = JSON.parse((await page.eval(JS_CC)) || '{}')
  ok(after.hash.indexOf('/zhoupu-import') >= 0, 'hash 已切到 /zhoupu-import', after.hash)
  const pageTxt = await page.eval('(()=>{var e=document.querySelector(".zp-wrap,.page,.zp-card");'
    + 'return JSON.stringify({len:document.body.innerText.length,'
    + 'hasSelect:/选择文件|上传|读取这份表/.test(document.body.innerText),'
    + 'hasTitle:document.body.innerText.indexOf("舟谱")>=0})})()')
  const pt = JSON.parse(pageTxt || '{}')
  ok(pt.hasSelect, '导入页真的渲染了（有选文件/读取这份表字样）', JSON.stringify(pt))
  ok(after.reqList.length >= 0 && !after.errPage, '期间无兜底错误页')
  const SHOT_B = SHOT_DIR + '/02-点卡片直达导入页.png'
  try { await page.screenshot(SHOT_B); log('  截图：' + SHOT_B) } catch { }

  const errA = page.errors.length
  ok(errA === 0, 'Phase A/B/C 全程控制台 0 报错', errA + ' 条')
  if (errA > 0) page.errors.slice(0, 6).forEach(e => log('   ' + String(e).slice(0, 200)))

  /* ══════════════════════ Phase D：反例 ①（桩 connected=false）══════════════════════ */
  log('')
  log('=== 4. 反例对照 ①：桩成「没导过」⇒ 卡片必须改口「未使用 / 去导入」===')
  const p1 = await openConnect(page, 'fresh')
  ok(p1 === 'patched:fresh', '已装上 fresh 桩', p1)
  const cc2 = JSON.parse((await page.eval(JS_CC)) || '{}')
  ok(cc2.stubCalls >= 1, '**桩确实被调用过**（否则"卡片变了"可能是页面压根没渲染）', '拦截 ' + cc2.stubCalls + ' 次')
  ok(cc2.n === 3, '卡片仍在（不是消失了）', cc2.n)
  ok(cc2.cards[2] && nz(cc2.cards[2].state) === '未使用', '状态改口「未使用」', cc2.cards[2] && cc2.cards[2].state)
  ok(cc2.cards[2] && /去导入/.test(cc2.cards[2].action), '按钮改口「去导入」', cc2.cards[2] && cc2.cards[2].action)
  ok(cc2.cards[2] && nz(cc2.cards[2].desc).indexOf('上传舟谱导出') >= 0, '副标题换成说明文案',
    cc2.cards[2] && cc2.cards[2].desc)
  ok(!cc2.errPage && cc2.bodyLen > 200, '页面正常（桩只改了这一张卡的说法）')
  const SHOT_C = SHOT_DIR + '/03-对照-未导过时卡片改口.png'
  await page.eval(JS_SCROLL_CC); await sleep(500)
  try { await page.screenshot(SHOT_C); log('  截图：' + SHOT_C) } catch { }

  /* ══════════════════════ Phase E：反例 ②（桩 reject）══════════════════════ */
  log('')
  log('=== 5. 反例对照 ②：桩成「接口失败」⇒ 静默降级、不炸页面 ===')
  const errD = page.errors.length
  const p2 = await openConnect(page, 'fail')
  ok(p2 === 'patched:fail', '已换成失败桩', p2)
  const cc3 = JSON.parse((await page.eval(JS_CC)) || '{}')
  ok(cc3.stubCalls >= 1, '失败桩确实被调用过', '拦截 ' + cc3.stubCalls + ' 次')
  ok(cc3.n === 3, '接口失败时卡片**仍然渲染**（不是整区消失）', cc3.n)
  ok(cc3.cards[2] && nz(cc3.cards[2].state) === '未使用',
    '读数退回「未使用」（与"真的没导过"同一降级路径，不编数字）', cc3.cards[2] && cc3.cards[2].state)
  const cj3 = doneOf(cc3.sts, '/api/datasources/v2/chanjet/status')
  const kd3 = doneOf(cc3.sts, '/api/datasources/v2/kingdee/status')
  ok(cj3.length && cj3.every(x => x.s === 200) && kd3.length && kd3.every(x => x.s === 200),
    '另两张卡的请求照常 200 ⇒ 舟谱这条失败没连累它们', JSON.stringify([cj3, kd3]))
  ok(!cc3.errPage, '无兜底错误页')
  const errE = page.errors.length - errD
  ok(errE === 0, 'Phase E 新增 0 报错（已 catch）', errE + ' 条')
  if (errE > 0) page.errors.slice(errD).slice(0, 6).forEach(e => log('   ' + String(e).slice(0, 200)))
  const SHOT_D = SHOT_DIR + '/04-对照-接口失败时静默降级.png'
  await page.eval(JS_SCROLL_CC); await sleep(500)
  try { await page.screenshot(SHOT_D); log('  截图：' + SHOT_D) } catch { }

  /* ══════════════════════ Phase F：反例 ③（换角色 = 主管）══════════════════════ */
  log('')
  log('=== 6. 反例对照 ③：换成一个**不能导入**的角色 ⇒ 卡片不渲染，且根本没发那条请求 ===')
  const errF0 = page.errors.length
  await page.eval('localStorage.removeItem("hergent_v2_token");localStorage.removeItem("hergent_v2_csrf");localStorage.removeItem("hergent_v2_user")')
  await hardGo(page, '#/login', 5000)
  const li = await page.eval(JS_LOGIN(SUB_USER, SUB_PASS))
  log('  登录结果：' + li)
  ok(String(li).indexOf('OK') === 0, '以主管账号登录成功', li)
  const subRole = String(li).split(':')[1] || ''
  const pF = await openConnect(page, 'record', 8000)
  ok(pF === 'patched:record', '已装上记录器（证明"没发那条请求"是真的没发）', pF)
  const cc4 = JSON.parse((await page.eval(JS_CC)) || '{}')
  log('  该角色 = ' + subRole + '｜这一区卡数 = ' + cc4.n + '：' + JSON.stringify(cc4.cards.map(c => c.name)))
  ok(subRole && ['admin', 'boss'].indexOf(subRole) < 0, '该账号确实不是 admin/boss（否则这组对照没意义）', subRole)
  ok(cc4.sectionFound, '「ERP 数据源」区照常渲染（证明页面本身是好的，不是整页没出来）')
  ok(cc4.n === 2, '只有 2 张卡 ⇒ 舟谱卡被**判据**藏掉了', cc4.n)
  ok(!cc4.cards.some(c => nz(c.name).indexOf('舟谱') >= 0), '这 2 张里没有舟谱',
    JSON.stringify(cc4.cards.map(c => c.name)))
  ok(has(cc4.reqList, '/api/datasources/v2/chanjet/status'),
    '畅捷通状态请求照常发出（页面主路径正常）')
  ok(!has(cc4.reqList, '/api/import/zhoupu/source-status'),
    '**没有**发舟谱 source-status 请求 ⇒ 是提前 return 掉的，不是"请求了但没渲染"',
    JSON.stringify(doneOf(cc4.sts, 'zhoupu')))
  /* ⚠️ 这里**不是**"两张卡各占 1/2"：`.cc-grid` 是固定 `repeat(3,1fr)`
     ⇒ 只有 2 张时第 3 格留空，每张仍是 1/3 宽。第一版探针按"自动收拢 1/2"断言，
     实测 65% 报红 —— **是断言写错，不是缺陷**（卡片等宽、不塌陷才是要证的）。 */
  ok(cc4.n === 2 && cc4.cards.every(c => c.w / (c.gridW / 3) >= 0.9),
    '两张卡等宽且各占 1/3 栅格（第 3 格留空是固定三列的预期表现，不是塌陷）',
    JSON.stringify(cc4.cards.map(c => Math.round(c.w / (c.gridW / 3) * 100) + '%')))
  const SHOT_E = SHOT_DIR + '/05-对照-主管角色看不到这张卡.png'
  await page.eval(JS_SCROLL_CC); await sleep(500)
  try { await page.screenshot(SHOT_E); log('  截图：' + SHOT_E) } catch { }
  const errF = page.errors.length - errF0
  ok(errF === 0, 'Phase F 新增 0 报错', errF + ' 条')

  /* ══════════════════════ Phase G：v271 轮询修复的靶向验证 ══════════════════════ */
  log('')
  log('=== 7. v271 轮询修复靶向验证（零业务写入）：接回一个「已完成」的任务 ⇒ 报告必须出来 ===')
  const errG0 = page.errors.length
  await hardGo(page, '#/workbench', 6000)
  const pG = await page.eval(JS_PATCH_JOB)
  ok(pG === 'patched:job', '已装上 status 桩', pG)
  await page.eval('sessionStorage.setItem("hergent_zhoupu_job",JSON.stringify({kind:"preview",id:"deadbeefdeadbeef"}))')
  await page.eval('location.hash="#/zhoupu-import"')
  await sleep(9000)
  const jv = JSON.parse((await page.eval(JS_JOB_VIEW)) || '{}')
  log('  页面文本：' + jv.text)
  log('  期间请求：' + JSON.stringify((jv.reqs || []).map(x => String(x).replace(/^https?:\/\/[^/]+/, ''))))
  ok(jv.stubCalls >= 1, 'status 桩确实被调用过（真的走了轮询）', '拦截 ' + jv.stubCalls + ' 次')
  ok(!jv.running, '页面**已离开**「正在读取」状态 ⇒ 轮询 resolve 了'
    + '（若 status 缺 raw:true，这里会永远停在「正在读取…」）', 'running=' + jv.running)
  ok(!jv.runBar, '进度卡片已收起（busy/prog 都回到空）', 'runBar=' + jv.runBar)
  ok(jv.hasReport, '报告区渲染出来了（「共读到 … 行明细 / … 张单」）')
  ok(jv.hasYear, '报告数字取自接口回执（1,234 行明细 / 7 张单）', JSON.stringify(jv.text.slice(0, 140)))
  await page.eval('sessionStorage.removeItem("hergent_zhoupu_job")')
  const SHOT_F = SHOT_DIR + '/06-接回任务-轮询修复已生效.png'
  try { await page.screenshot(SHOT_F); log('  截图：' + SHOT_F) } catch { }
  const errG = page.errors.length - errG0
  ok(errG === 0, 'Phase G 新增 0 报错', errG + ' 条')

  /* ══════════ 收尾：注销 Phase F 那次登录留下的会话 ══════════
   * 🔴 为什么必须做：Phase F 用 mptestsp/Mpsup@1 真登录 ⇒ 后端**在 sessions 表插一行**
   *    （routers/auth.py:151）。不注销的话，每跑一次探针就在生产库多留一个未过期会话。
   *    令牌那条有 probe_token.py 的 insert/delete 成对留痕，登录这条没有 ⇒ 就是**静默残留**。
   *    `POST /api/auth/logout` 存在（routers/auth.py:271），这里直接调它。
   *
   * 🔴 断言必须**看响应体**，不能只看状态码：
   *    ① 只断言 `2xx` 是**假通过**的经典写法 —— 前端 SPA 有 `try_files … /index.html`
   *       兜底，任何未知路径都可能回 200（HTML）。本仓实测 `/api/auth/logout` 未带 body
   *       时被我自己误测成 404，也是"状态码不等于结论"的同一类教训。
   *    ② 也不能拿"生产库 session 数变没变"当判据 —— 那个账号（提审测试号 mptestsp）
   *       **有外部在用**（实测 1 分钟内自己涨了 2 行），读数会被污染。
   *       判据只认接口自己的回执：`{"success":true}`。 */
  log('')
  log('=== 8. 收尾：注销探针自己登录的会话 ===')
  const lo = await page.eval('fetch("/api/auth/logout",{method:"POST",headers:{'
    + '"Authorization":"Bearer "+(localStorage.getItem("hergent_v2_token")||"")}})'
    + '.then(function(r){return r.text().then(function(t){return "HTTP:"+r.status+" "+t.slice(0,80)})})'
    + '.catch(function(e){return "ERR:"+e.message})')
  log('  logout → ' + lo)
  ok(/^HTTP:2\d\d \{"success":true\}/.test(String(lo)),
    '已注销（接口回执 success:true，不是只看状态码）', lo)

  log('')
  log('────────────────────────────')
  log('通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  if (fail > 0) failed = true
} catch (e) {
  log('脚本异常：' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e))
  failed = true
} finally {
  if (browser) { try { await browser.close() } catch { } }
  process.exit(failed ? 1 : 0)
}
