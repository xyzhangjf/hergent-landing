/**
 * v275-e2e.mjs —— 「路由级角色守卫」的真机只读验收
 *
 * 起因：入口能靠 `v-if` 藏起来，但**深链藏不住**（书签 / 历史 / 手敲 URL）。
 *       v275 给 `router/index.js` 加了 `meta.roles` 白名单守卫，本轮只落地
 *       `/zhoupu-import`（后端 `_guard()` 唯一一个"整页级拒绝"的页面）。
 *
 * 要证的事（七个相位）：
 *   0a. 未登录深链 ⇒ 仍被弹到登录页（守卫原有分支没被改坏）
 *   0b. 管理员（探针令牌 = users.id 1）深链 #/zhoupu-import ⇒ **放行** + 页面真的渲染（不误伤）
 *   1.  主管（真实登录 mptstsp）深链 ⇒ **被拦**：落回 #/workbench、弹出一条含「舟谱单据导入」的说明、
 *       URL 里的 `denied` 已被清掉（证明 Shell 消费掉了信号，不是把脏 query 留在地址栏）
 *   2.  反例对照 ①：主管**能进**的页面照常能进（/forecast、/connect）⇒ 没有连累
 *   3.  幂等：一趟文档里 `/api/auth/permissions` 只拉 1 次 ⇒ 守卫没有把"每次导航"变成"每次请求"
 *   4.  反例对照 ②（**本轮最锋利的一条**）：同一个管理员令牌，只把权限接口桩成
 *       `user.role='supervisor'` ⇒ 行为**翻转为拦截** ⇒ 证明判据读的是角色，不是令牌/账号
 *   5.  反例对照 ③④（fail-open 两条路径）：角色为空 / 权限接口 500 ⇒ 都要**放行**
 *       （"拉不到 ≠ 没权限"；否则一次接口抖动就能把老板挡在自己系统门外）
 *   6.  收尾：注销探针自己登录的主管会话（判据取接口回执 {"success":true}，不看状态码）
 *
 * 🔴 全程只读：不点保存、不点导入、不提交任何业务写动作。
 *    唯一的写是**本地** localStorage 种/清 token，以及一次真实登录（末尾注销）。
 *    所有桩都打在页面内 `window.fetch`，只影响这一个标签页。
 *
 * 🔴 三条探针方法学（本轮踩过/复用）：
 *    ① `page.goto` 换新文档会**抹掉装在旧文档上的桩** ⇒ 桩一律"先落到一个中立文档、
 *       再在**同一文档内**用 hash 导航"（SPA 不换文档），否则拦截数永远是 0，
 *       看起来像"请求没发出去"。
 *    ② toast 3 秒后自动消失 ⇒ 轮询取样必漏 ⇒ 用 MutationObserver 在它出现的**当拍**落账。
 *    ③ 想造"store 里角色为空"的起点，**只能靠新文档**：Pinia store 是全局单例，
 *       Shell 卸载不会清空它。所以流程是「清 token → hardGo 到 #/login（不是业务页，
 *       Shell 不挂载 ⇒ 不拉权限）→ 装桩 → 种回 token → hash 导航到目标路由」。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN || ''
const TENANT = process.env.HG_TENANT || '1'
const SUB_USER = process.env.HG_SUB_USER || 'mptestsp'
const SUB_PASS = process.env.HG_SUB_PASS || 'Mpsup@1'
const SHOT_DIR = process.env.HG_SHOT
  || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v275-路由级角色守卫-2026-09-25'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)

let pass = 0, fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; log('  ✅ ' + name + (extra != null ? '　→ ' + extra : '')) }
  else { fail++; log('  ❌ ' + name + (extra != null ? '　→ ' + extra : '')) }
  return !!cond
}
const nz = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()

/* ── 登录态：全部只在 localStorage 层面操作 ── */
const JS_SEED = (tok, tid) => 'localStorage.setItem("hergent_v2_token",' + JSON.stringify(tok) + ');'
  + 'localStorage.setItem("hergent_v2_tenant",' + JSON.stringify(tid) + ');"seeded"'

const JS_CLEAR = '(()=>{["hergent_v2_token","hergent_v2_user","hergent_v2_csrf"]'
  + '.forEach(function(k){try{localStorage.removeItem(k)}catch(e){}});return "cleared"})()'

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO:"+JSON.stringify(d).slice(0,150);'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return "OK:"+(d.user&&d.user.role)})'

/* ── toast 记录器 ──
 * toast 只活 3 秒（store.toast 里 setTimeout 3000 清空），轮询一秒读一次会漏掉
 * 恰好夹在两拍之间的那一条 ⇒ 用 MutationObserver 在出现的当拍落账。
 * 装一次即可（同一文档内一直有效）。 */
const JS_TOAST_WATCH = '(function(){if(window.__toasts)return "already";window.__toasts=[];'
  + 'var sn=function(){try{var t=document.querySelector(".toast");if(!t)return;'
  + 'var x=(t.innerText||"").replace(/\\s+/g," ").trim();'
  + 'if(x&&window.__toasts.indexOf(x)<0)window.__toasts.push(x);}catch(e){}};'
  + 'try{new MutationObserver(sn).observe(document.body,{childList:true,subtree:true,characterData:true});}catch(e){}'
  + 'return "watching"})()'

/* ── `/api/auth/permissions` 桩 ──
 *   'norole' → 200，但 `user.role` 是空串 ⇒ loadPerms 因 `if (r)` 不赋值 ⇒ store 里角色保持空
 *   'boom'   → 500 ⇒ 走 loadPerms 的 catch ⇒ perms 归 null ⇒ 角色保持空
 *   'sup'    → 200，`user.role='supervisor'`（权限给 `*` 避免引入无关 403）
 *   'record' → 只记录，不拦截
 * 前两种都用于验 **fail-open**；'sup' 用于验「判据读角色、不读令牌」。 */
const permBody = (mode) => {
  if (mode === 'norole') {
    return JSON.stringify({ success: true, data: {
      permissions: ['*'], user: { username: 'probe', display_name: 'probe', role: '' },
      plan: '', capabilities: null, tenant_id: Number(TENANT) || 1 } })
  }
  if (mode === 'sup') {
    return JSON.stringify({ success: true, data: {
      permissions: ['*'], user: { username: 'probe', display_name: 'probe', role: 'supervisor' },
      plan: '', capabilities: null, tenant_id: Number(TENANT) || 1 } })
  }
  return '{}'
}

const JS_PATCH_PERM = (mode) => '(function(){'
  + 'window.__pStub=0;window.__pReq=[];'
  + 'if(!window.__origFetch){window.__origFetch=window.fetch;}'
  + 'window.fetch=function(u,o){'
  + 'var s=(typeof u==="string")?u:((u&&u.url)||"");'
  + 'try{window.__pReq.push(s);}catch(e){}'
  + 'if(' + JSON.stringify(mode) + '!=="record"&&s.indexOf("/api/auth/permissions")>=0){'
  + 'window.__pStub++;'
  + (mode === 'boom'
    ? 'return Promise.resolve(new Response("{\\"detail\\":\\"stub-500\\"}",'
      + '{status:500,headers:{"Content-Type":"application/json"}}));'
    : 'return Promise.resolve(new Response(' + JSON.stringify(permBody(mode)) + ','
      + '{status:200,headers:{"Content-Type":"application/json"}}));')
  + '}'
  + 'return window.__origFetch.apply(this,arguments);};'
  + 'return "patched:' + mode + '";})()'

const JS_RESTORE = '(()=>{if(window.__origFetch){window.fetch=window.__origFetch}return "restored"})()'

/* ── 页面状态取证 ──
 * `permReqs` 取的是**当前文档**的资源计时条目 ⇒ 用来证明"守卫没有把每次导航都变成一次请求"。 */
const JS_STATE = '(()=>{var o={};'
  + 'var t=document.body?document.body.innerText:"";'
  + 'var g=function(s){var e=document.querySelector(s);return e?(e.innerText||"").trim():""};'
  + 'o.hash=location.hash;'
  + 'o.zpWrap=!!document.querySelector(".zp-wrap");'
  + 'o.zpTitle=g(".zp-title");'
  + 'o.sbN=document.querySelectorAll(".sb-item").length;'
  + 'o.sbItems=[].map.call(document.querySelectorAll(".sb-item"),function(e){return (e.innerText||"").trim()});'
  + 'o.hasLoginForm=!!document.querySelector("input[type=password]");'
  + 'o.toasts=(window.__toasts||[]).slice(-6);'
  + 'o.pStub=(window.__pStub||0);'
  + 'o.permReqs=performance.getEntriesByType("resource")'
  + '.filter(function(e){return e.name.indexOf("/api/auth/permissions")>=0}).length;'
  + 'o.errPage=/页面出错了|Something went wrong/.test(t);'
  + 'o.bodyLen=t.length;'
  + 'o.text=t.replace(/\\s+/g," ").slice(0,220);'
  + 'return JSON.stringify(o)})()'

let browser, failed = false
/* 强制真加载：只改 query 串 ⇒ 文档真的重新请求，桩与组件状态都不残留 */
const hardGo = async (page, hash, ms) => {
  await page.goto(BASE + '/?__r=' + Date.now() + hash, ms || 5000)
}
const state = async (page) => JSON.parse((await page.eval(JS_STATE)) || '{}')

try {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()

  log('=== 0. 准备 ===')
  if (!TOKEN) throw new Error('缺少 HG_TOKEN（探针令牌：probe_token.py insert 产出的 sbxui-*）')
  await page.goto(BASE, 3500)

  /* ══════════════ Phase 0a：未登录深链 ⇒ 仍弹登录页（旧分支回归） ══════════════ */
  log('')
  log('=== 1. 未登录深链 #/zhoupu-import ⇒ 必须弹到登录页（守卫原有分支没被改坏）===')
  await page.eval(JS_CLEAR)
  await hardGo(page, '#/zhoupu-import', 6000)
  const s0 = await state(page)
  log('  hash=' + s0.hash + ' hasLoginForm=' + s0.hasLoginForm)
  ok(String(s0.hash).indexOf('/login') >= 0, '未登录被弹到登录页', 'hash=' + s0.hash)
  ok(s0.zpWrap === false, '舟谱导入页**没有**渲染出来（没绕过守卫）', 'zpWrap=' + s0.zpWrap)
  ok(!s0.errPage, '没有兜底错误页')

  /* ══════════════ Phase 0b：管理员深链 ⇒ 放行（不误伤）══════════════ */
  log('')
  log('=== 2. 管理员深链 #/zhoupu-import ⇒ **放行**且页面真的渲染（不误伤老板）===')
  const errA0 = page.errors.length
  await page.eval(JS_SEED(TOKEN, TENANT))
  await hardGo(page, '#/zhoupu-import', 8000)
  const sA = await state(page)
  log('  hash=' + sA.hash + ' zpWrap=' + sA.zpWrap + ' 标题=' + sA.zpTitle
    + ' permReqs=' + sA.permReqs + ' toasts=' + JSON.stringify(sA.toasts))
  log('  管理员侧栏（' + sA.sbN + '）：' + JSON.stringify(sA.sbItems))
  ok(sA.hash === '#/zhoupu-import', 'URL 停在 /zhoupu-import（没被弹走）', 'hash=' + sA.hash)
  ok(sA.zpWrap === true, '舟谱导入页真的挂载了（.zp-wrap 在）')
  ok(nz(sA.zpTitle) === '舟谱单据导入', '页面标题 = 舟谱单据导入', sA.zpTitle)
  ok(sA.permReqs >= 1, '守卫确实等过权限接口（不是说"没触发判据"）', '本档 ' + sA.permReqs + ' 次')
  ok((sA.toasts || []).length === 0, '没有弹出任何拒绝提示（本来就该放行）', JSON.stringify(sA.toasts))
  ok(sA.sbN === 12, '侧栏正常渲染（12 项）', 'sbN=' + sA.sbN)
  ok(!sA.errPage, '没有兜底错误页')
  try { await page.screenshot(SHOT_DIR + '/01-管理员深链直达-不误伤.png'); log('  截图 01') } catch { }
  ok(page.errors.length - errA0 === 0, '本相位新增 0 报错', (page.errors.length - errA0) + ' 条')

  /* ══════════════ Phase 1：主管深链 ⇒ 被拦（核心新功能）══════════════ */
  log('')
  log('=== 3. 主管深链 #/zhoupu-import ⇒ **被拦** + 有一条看得见的说明 ===')
  const errB0 = page.errors.length
  const lg = await page.eval(JS_LOGIN(SUB_USER, SUB_PASS))
  ok(/^OK:/.test(String(lg)), '主管账号已真实登录并把 token 落进 localStorage', lg)
  await hardGo(page, '#/workbench', 7000)          // 新文档 ⇒ 按主管身份加载、Shell 挂载时拉真实权限
  const sB0 = await state(page)
  log('  主管落地：hash=' + sB0.hash + ' sbN=' + sB0.sbN + ' permReqs=' + sB0.permReqs)
  ok(sB0.sbN >= 10, '主管的外壳已挂载（侧栏在）⇒ 权限已进入加载流程', 'sbN=' + sB0.sbN)

  await page.eval(JS_TOAST_WATCH)
  await page.eval('location.hash="#/zhoupu-import"')   // SPA 内导航 ⇒ 守卫触发
  /* 🔴 截图必须赶在 toast 消失前拍（它只活 3 秒）。第一版在 +3.5s 处拍，
     结果是「页面对了、提示没了」—— 等于没拍到本轮最该给人看的那一样东西。 */
  await sleep(950)
  try { await page.screenshot(SHOT_DIR + '/02-主管深链被拦-提示文案.png'); log('  截图 02（提示在场）') } catch { }
  await sleep(350)
  const sB1 = await state(page)     // 中间态：只记录，不拿它当判据（toast 活 3 秒，取样时机不可靠）
  log('  +1.3s 中间态：hash=' + sB1.hash + ' toasts=' + JSON.stringify(sB1.toasts))
  await sleep(2200)
  const sB2 = await state(page)
  log('  toast=' + JSON.stringify(sB2.toasts))
  log('  最终 hash=' + sB2.hash + ' zpWrap=' + sB2.zpWrap)
  ok(sB2.hash === '#/workbench', '被弹回经营工作台（不是停在原地、也不是白屏）', 'hash=' + sB2.hash)
  ok(String(sB2.hash).indexOf('denied') < 0, 'URL 里的 denied 已被清掉（没把脏 query 留在地址栏）',
    'hash=' + sB2.hash)
  ok((sB2.toasts || []).some(x => String(x).indexOf('舟谱单据导入') >= 0),
    '弹出了点名「舟谱单据导入」的说明（拒绝是看得见的）', JSON.stringify(sB2.toasts))
  ok((sB2.toasts || []).some(x => String(x).indexOf('访问权限') >= 0),
    '说明文案讲的是"访问权限"这件事')
  ok(sB2.zpWrap === false, '舟谱导入页**没有**渲染（拦截是真生效，不是渲染完再弹走）')
  /* 🔴 主管的侧栏是 **11** 项，不是管理员的 12 项 —— 差的那一项是「算工资」
     （`v-if="store.canModule('payroll')"`，主管没有 payroll 模块权限）。
     这个数必须按"当前登录角色"算，不能照抄管理员的 12（本探针第一版就是这么写错的，
     报红的那一条是断言写错、不是产品缺陷）。所以这里同时把条目清单打出来自证。 */
  log('  主管侧栏（' + sB2.sbN + '）：' + JSON.stringify(sB2.sbItems))
  ok(sB2.sbN === 11, '被拦之后外壳照常（主管侧栏 11 项 = 管理员 12 项少掉无权限的「算工资」）',
    'sbN=' + sB2.sbN + ' items=' + JSON.stringify(sB2.sbItems))
  ok(!sB2.errPage, '没有兜底错误页')

  /* ══════════════ Phase 2：反例对照 ①——主管能进的照常能进 ══════════════ */
  log('')
  log('=== 4. 反例对照①：主管**能进**的页面不受影响（没连累）===')
  /* 只数「访问权限」类提示：/forecast、/connect 自己也会弹别的 toast（数据加载等），
     按总数比对会把那些算进来 ⇒ 判据要贴着"守卫有没有误拦"这一件事。 */
  const nDenyBefore = (sB2.toasts || []).filter(x => String(x).indexOf('访问权限') >= 0).length
  await page.eval('location.hash="#/forecast"')
  await sleep(3000)
  const sC1 = await state(page)
  log('  #/forecast → hash=' + sC1.hash + ' zpWrap=' + sC1.zpWrap)
  ok(sC1.hash === '#/forecast', '主管能进 /forecast（该页没有 meta.roles，不被守卫波及）', 'hash=' + sC1.hash)
  await page.eval('location.hash="#/connect"')
  await sleep(3500)
  const sC2 = await state(page)
  log('  #/connect → hash=' + sC2.hash)
  ok(sC2.hash === '#/connect', '主管能进 /connect', 'hash=' + sC2.hash)
  ok((sC2.toasts || []).filter(x => String(x).indexOf('访问权限') >= 0).length === nDenyBefore,
    '这两次导航**没有**新增任何"无权限"提示（守卫只拦名单内的页面）',
    'toasts=' + JSON.stringify(sC2.toasts))

  /* ══════════════ Phase 3：幂等 —— 一次文档只拉一次权限 ══════════════ */
  log('')
  log('=== 5. 幂等：`/api/auth/permissions` 在一趟文档里只该拉 1 次 ===')
  log('  本档 permReqs=' + sC2.permReqs + '（期间发生过：初载 + 被拦的深链 + /forecast + /connect）')
  ok(sC2.permReqs === 1, '权限接口只拉了 1 次（守卫命中 store 缓存，没把每次导航变成每次请求）',
    '实测 ' + sC2.permReqs + ' 次')
  ok(sC2.pStub === 0 || sC2.pStub == null, '主管这一段全程没有装过桩（读的是真实权限）', 'pStub=' + sC2.pStub)

  /* ══════════════ Phase 4：收尾①——注销主管会话 ══════════════ */
  log('')
  log('=== 6. 收尾①：注销探针自己登录的主管会话（回执为准，不看状态码）===')
  const lo = await page.eval('fetch("/api/auth/logout",{method:"POST",headers:{'
    + '"Authorization":"Bearer "+(localStorage.getItem("hergent_v2_token")||"")}})'
    + '.then(function(r){return r.text().then(function(t){return "HTTP:"+r.status+" "+t.slice(0,80)})})'
    + '.catch(function(e){return "ERR:"+e.message})')
  log('  logout → ' + lo)
  ok(/^HTTP:2\d\d \{"success":true\}/.test(String(lo)),
    '主管会话已注销（接口回执 success:true）', lo)
  const errB1 = page.errors.length - errB0
  ok(errB1 === 0, 'Phase 1~4 合计新增 0 报错', errB1 + ' 条')

  /* ══════════════ Phase 5：三条桩对照（本轮最锋利的一组）══════════════
   * 每轮都从"新文档 + 无 token + 停在 #/login"起步：
   *   Pinia store 是全局单例，Shell 卸载**不清空**它 ⇒ 想要"store 里角色为空"，
   *   只能换一个新文档；而 #/login 是唯一"有守卫放行、又不会挂载 Shell（因此不拉权限）"的落点。
   *   ⇒ 清 token → hardGo #/login → 装桩 → 种回 token → hash 到目标路由。 */
  const permCase = async (mode, expectAllow, shotName) => {
    log('')
    log('--- 桩模式 ' + mode + '（期望：' + (expectAllow ? '放行' : '拦截') + '）---')
    const e0 = page.errors.length
    await page.eval(JS_CLEAR)
    await hardGo(page, '#/login', 6500)
    const s0 = await state(page)
    ok(s0.hasLoginForm === true && String(s0.hash).indexOf('/login') >= 0,
      '起点已在登录页、且外壳未挂载 ⇒ store 里角色必然是空的',
      'hash=' + s0.hash + ' 有密码框=' + s0.hasLoginForm)
    ok(s0.permReqs === 0, '这个文档还没请求过权限接口（"未知"状态是干净的）', 'permReqs=' + s0.permReqs)
    const p = await page.eval(JS_PATCH_PERM(mode))
    ok(p === 'patched:' + mode, 'permissions 桩已装上', p)
    await page.eval(JS_TOAST_WATCH)
    await page.eval(JS_SEED(TOKEN, TENANT))
    await page.eval('location.hash="#/zhoupu-import"')
    /* 同样赶在 toast 消失（3 秒窗口）前拍 —— 否则"被拦"的对照组也拍不到那句提示。 */
    await sleep(950)
    if (shotName) {
      try { await page.screenshot(SHOT_DIR + '/' + shotName); log('  截图 ' + shotName + '（提示在场）') } catch { }
    }
    await sleep(2850)
    const s = await state(page)
    log('  hash=' + s.hash + ' zpWrap=' + s.zpWrap + ' pStub=' + s.pStub
      + ' toasts=' + JSON.stringify(s.toasts))
    ok(s.pStub >= 1, '守卫**确实请求了**权限接口（桩被调用 ≥1 次，不是"没跑判据"）',
      '拦截 ' + s.pStub + ' 次')
    if (expectAllow) {
      ok(s.hash === '#/zhoupu-import' && s.zpWrap === true,
        '**放行**：落在舟谱导入页', 'hash=' + s.hash + ' zpWrap=' + s.zpWrap)
      ok((s.toasts || []).length === 0, '没有弹拒绝提示', JSON.stringify(s.toasts))
    } else {
      ok(s.hash === '#/workbench', '**被拦**：弹回经营工作台', 'hash=' + s.hash)
      ok(s.zpWrap === false, '舟谱导入页没有渲染')
      ok((s.toasts || []).some(x => String(x).indexOf('访问权限') >= 0),
        '弹出了"没有访问权限"的说明', JSON.stringify(s.toasts))
    }
    await page.eval(JS_RESTORE)
    ok(page.errors.length - e0 === 0, '本相位新增 0 报错', (page.errors.length - e0) + ' 条')
    return s
  }

  log('')
  log('=== 7. 反例对照②③④：判据读的是**角色**，不是令牌；未知一律放行 ===')
  log('  （同一个管理员令牌，三种桩 ⇒ 行为必须随"权限接口报的角色"翻转）')

  /* ② 最锋利：令牌是管理员，但权限接口说他是主管 ⇒ 必须被拦 */
  await permCase('sup', false, '05-对照-令牌是管理员但角色是主管时被拦.png')
  /* ③ 角色为空（接口正常但没给角色）⇒ 未知 ⇒ 放行 */
  await permCase('norole', true, '03-对照-角色未知时放行.png')
  /* ④ 权限接口 500 ⇒ 拉不到 ⇒ 放行（"拉不到 ≠ 没权限"） */
  await permCase('boom', true, '04-对照-权限接口失败仍放行.png')

  /* ══════════════ Phase 6：本地收尾 ══════════════ */
  log('')
  log('=== 8. 收尾②：清掉本地登录态（probe 令牌留给 probe_token.py delete 成对留痕）===')
  const cl = await page.eval(JS_CLEAR)
  ok(cl === 'cleared', '本地 token 已清', cl)

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
