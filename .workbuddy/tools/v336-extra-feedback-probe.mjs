/**
 * v336-extra-feedback-probe.mjs —— 预报页「加单即时反馈」真机只读验收（v336 / v336b）
 *
 * 要证明的东西（用户 2026-09-30 拍板的方案 B）：
 *   「|加单|>0 且有人可分」⇒ 行内**立刻**长出「分摊」按钮（不弹窗）；
 *   「一个人都分不到」⇒ 加单格**立刻**变琥珀色 + 左侧竖条 + 角标「悬空」，
 *     悬停能说清「这 N 箱怎么来的 / 为什么加不上」。
 *
 * 🔴 本探针**绝不点保存**。所有动作（进改单 / 填加单格）都是**纯内存**的：
 *     加单格写的是 `r.extraQty`（草稿），不保存就零落库。
 *     `saveEdits()` 没有"无改动就短路"的分支 ⇒ 点一下就是真实生产写入 ⇒ 一律不点。
 *     并且用 fetch/XHR 打桩**取证**：整轮除登录外不得出现任何非 GET 的 /api 请求。
 *
 * 为什么不能用「页面内 fetch 带 token」代替：本轮验的是「用户填一格，眼睛看到什么」，
 *   必须走真实 DOM 与真实事件；页面内 fetch 只能证明接口通。
 *
 * 判据（任一不满足即 FAIL，退出码 1）：
 *   V1  能进入改单态（前置）                        V2  渲染出加单格 N>=1（前置）
 *   V3  反例：**空的**加单格不得带 xm-void/xm-short（判据要求 |extraQty|>0）—— 防恒真
 *   V9  反例：空格 title 必须恰为「可填负数 = 减单」（证明 title 随状态变，不是静态说明）
 *   V4  【核心】填 +6 后该格**立刻**有反馈（竖条/角标/分摊按钮 三者至少一）
 *   V5  【核心】悬空行：td 含 xm-void + 角标文本「悬空」+ class has-void + **无**分摊按钮
 *   V6  悬空成因分支**互斥**且带具体量：「挂不上人」与「本期没有人报过」不共存；前者必带箱数
 *   V7  分摊路径：有按钮行的 title 含「占比」与「分给」
 *   V10 视觉通道**真的渲染**：xm-void 的 box-shadow 非 none 且为琥珀色系；xm-alert 加粗
 *   V8  零写入自证：除 /api/auth/login 外无非 GET 的 /api 请求
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const OUT_DIR = process.env.HG_OUT
  || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v336-加单即时反馈-2026-09-30'
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)

let failed = false
const results = []
function ok(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail === undefined ? '' : String(detail) })
  log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (detail !== undefined ? ' | ' + detail : ''))
  if (!cond) failed = true
}

/* ---------------- 页面内脚本（全部是表达式字符串；内部一律用双引号） ---------------- */

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json().then(d=>({s:r.status,d:d})))'
  + '.then(r=>{var d=r.d;if(!d.token)return JSON.stringify({ok:false,status:r.s,detail:d.detail||d.message||""});'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return JSON.stringify({ok:true,user:(d.user&&d.user.username)||"",role:(d.user&&d.user.role)||"",tenant:d.tenant_id})})'

const JS_CLICK_SIDEBAR = '(()=>{var all=Array.from(document.querySelectorAll("a,div,span,li,button"));'
  + 'var hit=all.find(x=>/预报订[单货]管理/.test((x.innerText||"").trim())&&(x.innerText||"").trim().length<20);'
  + 'if(hit){hit.click();return (hit.innerText||"").trim()}return ""})()'

const JS_CLICK_EDIT = '(()=>{var bs=Array.from(document.querySelectorAll("button,.el-button,[role=button],a"));'
  + 'var b=bs.find(x=>/^改\\s*单$/.test((x.innerText||"").trim()));if(!b)return JSON.stringify({ok:false});'
  + 'b.click();return JSON.stringify({ok:true})})()'

/* 零写入取证：包住 fetch / XHR，只记录 /api 的非 GET 请求 */
const JS_PATCH_NET = '(()=>{window.__w=[];'
  + 'var _f=window.fetch;window.fetch=function(a,b){try{'
  + 'var m=((b&&b.method)||(a&&a.method)||"GET").toUpperCase();'
  + 'var u=typeof a==="string"?a:((a&&a.url)||"");'
  + 'if(m!=="GET"&&m!=="HEAD"&&m!=="OPTIONS"&&/\\/api\\//.test(u))window.__w.push(m+" "+u);'
  + '}catch(e){}return _f.apply(this,arguments)};'
  + 'var _o=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){try{'
  + 'var M=String(m||"GET").toUpperCase();'
  + 'if(M!=="GET"&&M!=="HEAD"&&M!=="OPTIONS"&&/\\/api\\//.test(String(u||"")))window.__w.push(M+" "+u);'
  + '}catch(e){}return _o.apply(this,arguments)};'
  + 'return "patched"})()'

/* 🔴 原生弹窗桩 —— 本探针最贵的一条（实测踩到）：
 *   `enterEdit()` 在「角色不在填报白名单」时会 `window.confirm(...)`（Forecast.vue:4146）。
 *   探针用 `mptestsp`（supervisor）**必然命中** ⇒ 无头 Chrome 里**没人应答原生弹窗**
 *   ⇒ 主线程被**同步挂住** ⇒ 点「改单」那次 `Runtime.evaluate` 45s 超时。
 *   症状极易误读成「页面卡死 / 我刚改的东西把编辑态搞崩了」——实际是**探针环境问题**。
 *   （佐证：仓库自带的冒烟脚本里也有 `window.confirm=()=>true` 这一行。）
 * 处置：装桩**并记录**原文（诚实：不静默吞掉），让「弹了什么」出现在日志里。 */
const JS_PATCH_DIALOG = '(()=>{window.__dlg=[];'
  + 'var _c=window.confirm;window.confirm=function(m){try{window.__dlg.push("confirm: "+String(m))}catch(e){}return true};'
  + 'var _a=window.alert;window.alert=function(m){try{window.__dlg.push("alert: "+String(m))}catch(e){}};'
  + 'var _p=window.prompt;window.prompt=function(m,d){try{window.__dlg.push("prompt: "+String(m))}catch(e){}return d==null?"":d};'
  + 'return "dialog-patched"})()'

/* 抖动兜底（技能同款）：CDP 偶发 eval 超时；错了就重试，别据此判产品缺陷 */
async function ev(page, expr, tag, tries = 3) {
  let last = null
  for (let i = 1; i <= tries; i++) {
    try { return await page.eval(expr) } catch (e) {
      last = e
      log('  （' + tag + ' 第 ' + i + '/' + tries + ' 次失败：' + (e && e.message) + ' —— 2s 后重试）')
      await sleep(2000)
    }
  }
  throw last
}

/* ⚠️ 「未填」必须按**逻辑**判，不能按空串判（实测：154 行的 `extraQty` 全渲染成 "0"）——
 *   页面判据是 `Math.abs(Number(extraQty)) < 1e-9`，所以 "0" 与 "" 是**同一态**。
 *   第一版我按 `val === ''` 筛 ⇒ 筛出 0 行 ⇒ V9 在空集上 `every` 恒真 ⇒ **假绿**。
 *   （V3 那条前置断言把它抓住了 —— 这就是「前置不成立必须显式失败」的价值。） */
const numOf = (v) => {
  const s = String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}
const isUnfilled = (x) => Math.abs(numOf(x.val)) < 1e-9

/* 采集每一行加单格的**全部可见事实**（类名 / 值 / title / 角标 / 按钮 / 悬停行 / 计算样式） */
const JS_COLLECT = '(()=>{'
  + 'var tds=Array.from(document.querySelectorAll("td.pt-xmtd.extra"));'
  + 'var rows=tds.map(function(td,i){'
  + '  var inp=td.querySelector("input.cell-input");'
  + '  var b=td.querySelector("b.pt-xm-b");'
  + '  var btn=td.querySelector("button.pt-alloc-btn");'
  + '  var cs=inp?getComputedStyle(inp):null;'
  + '  var ts=getComputedStyle(td);'
  + '  return {i:i,'
  + '    r:Number(td.getAttribute("data-r")),'
  + '    tdCls:String(td.className||""),'
  + '    val:inp?String(inp.value==null?"":inp.value):null,'
  + '    inputCls:inp?String(inp.className||""):"",'
  + '    title:inp?String(inp.getAttribute("title")||""):"",'
  + '    badge:b?String((b.innerText||"").trim()):null,'
  + '    badgeCls:b?String(b.className||""):"",'
  + '    hasBtn:!!btn,'
  + '    btnTitle:btn?String(btn.getAttribute("title")||""):"",'
  + '    shadow:ts.boxShadow,'
  + '    color:cs?cs.color:"",'
  + '    weight:cs?cs.fontWeight:""};'
  + '});'
  + 'var de=document.documentElement;'
  + 'return JSON.stringify({count:tds.length, rows:rows,'
  + '  amber:getComputedStyle(de).getPropertyValue("--warn-amber").trim(),'
  + '  danger:getComputedStyle(de).getPropertyValue("--danger-txt").trim()})})()'

/* 往第 r 行的加单格填 v（纯内存：只改草稿字段，不保存） */
const JS_FILL = (r, v) => '(()=>{'
  + 'var td=document.querySelector(\'td.pt-xmtd.extra[data-r="' + r + '"]\');'
  + 'if(!td)return JSON.stringify({ok:false,why:"no-td"});'
  + 'var inp=td.querySelector("input.cell-input");'
  + 'if(!inp)return JSON.stringify({ok:false,why:"no-input"});'
  + 'inp.value=' + JSON.stringify(String(v)) + ';'
  + 'inp.dispatchEvent(new Event("input",{bubbles:true}));'
  + 'inp.dispatchEvent(new Event("change",{bubbles:true}));'
  + 'return JSON.stringify({ok:true,now:String(inp.value)})})()'

let browser = null

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const b = await launch()
  browser = b
  const page = await b.newPage()
  await page.enable()
  log('=== v336 加单即时反馈 · 真机只读验收 ===')
  log('浏览器已就绪')

  /* 1. 登录（页面内 fetch ⇒ cookie/localStorage 落在真实浏览器上下文） */
  await page.goto(BASE, 3500)
  const li = JSON.parse(await page.eval(JS_LOGIN(USER, PASS)))
  log('登录：' + JSON.stringify(li))
  if (!li.ok) { log('登录失败 ⇒ 后续判据不成立'); failed = true ; throw new Error('login failed') }

  /* 2. 进预报页（真实动作：点侧栏） */
  await page.goto(BASE + '/#/', 4000)
  const entered = await page.eval(JS_CLICK_SIDEBAR)
  log('点侧栏「预报订货管理」：' + (entered || '（未找到，回落 #/forecast）'))
  if (!entered) await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', 6000)
  await sleep(3000)
  log('URL: ' + (await page.eval('location.href')))

  /* 3. 打桩网络 + 原生弹窗（在进入改单态之前挂上，覆盖后续全部动作） */
  log('网络打桩：' + (await page.eval(JS_PATCH_NET)))
  log('弹窗打桩：' + (await page.eval(JS_PATCH_DIALOG)))
  /* ⚠️ 登录已经发生过：把它从台账里剔掉，只留「进入页面之后」的写请求 */
  await page.eval('(()=>{window.__w=[];return "cleared"})()')

  /* 4. 进改单态（⚠️ 必须走 `ev` 重试封装：这一步是唯一可能撞原生 confirm 的地方） */
  const ed = JSON.parse(await ev(page, JS_CLICK_EDIT, 'click-edit'))
  ok('V1 进入改单态（前置）', ed.ok, JSON.stringify(ed))
  await sleep(2200)
  /* 诚实记录：探针替用户点了「确定」的那些原生弹窗 —— 不静默吞掉 */
  const dlgs = JSON.parse(await page.eval('JSON.stringify(window.__dlg||[])'))
  if (dlgs.length) {
    log('⚠️ 进改单过程中弹出原生弹窗 ' + dlgs.length + ' 处（探针已自动应答「确定」，如实记录）：')
    dlgs.forEach(d => log('   ' + String(d).replace(/\s+/g, ' ').slice(0, 150)))
  } else log('进改单过程无原生弹窗')

  /* 5. 采集基线（未填任何加单） */
  const before = JSON.parse(await ev(page, JS_COLLECT, 'collect'))
  log('加单格数=' + before.count + '｜--warn-amber=' + JSON.stringify(before.amber)
      + '｜--danger-txt=' + JSON.stringify(before.danger))
  ok('V2 编辑网格渲染出加单格（前置）', before.count >= 1, 'count=' + before.count)
  if (before.count < 1) throw new Error('no extra cells')

  const empty0 = before.rows.filter(isUnfilled)
  ok('V3 反例基线：存在「未填」的加单格可做对照（按逻辑判：|值|<1e-9）',
     empty0.length >= 1, '未填行数=' + empty0.length + ' / 总行数=' + before.count)
  if (empty0.length < 1) throw new Error('没有任何未填的加单格 —— 对照与填值用例无从建立（禁止在空集上断言）')
  const dirty0 = empty0.filter(x => /xm-void|xm-short/.test(x.tdCls))
  ok('V3b 反例：**空的**加单格不得带 xm-void/xm-short（判据要求 |extraQty|>0）',
     dirty0.length === 0, '违规行=' + JSON.stringify(dirty0.map(x => x.r)))
  const badTitle = empty0.filter(x => !/^可填负数 = 减单$/.test(String(x.title).trim()))
  ok('V9 反例：空格 title 恰为「可填负数 = 减单」（证明 title 随状态变、不是静态说明）',
     badTitle.length === 0, '不符行=' + badTitle.map(x => x.r + ':' + JSON.stringify(x.title)).join(' / '))

  /* 6. 【核心】填 +6 ⇒ 该格必须**立刻**有反馈
   *    ⚠️ 取样要**确定性覆盖两条路**，别让"数据碰巧"决定报告：
   *      · 「无分摊按钮」的行 ⇒ 成员 < 2 ⇒ 大概率走**悬空**分支（V5）
   *      · 「有分摊按钮」的行 ⇒ 成员 ≥ 2 ⇒ 走**可分**分支（V7） */
  const candVoid = empty0.filter(x => !x.hasBtn)
  const candAlloc = empty0.filter(x => x.hasBtn)
  log('')
  log('候选行：无按钮(疑悬空)=' + candVoid.length + '｜有按钮(可分摊)=' + candAlloc.length)
  ok('V2b 前置：两类候选行都存在（V5 悬空路径与 V7 分摊路径都有样本）',
     candVoid.length >= 1 && candAlloc.length >= 1,
     '无按钮=' + candVoid.length + ' 有按钮=' + candAlloc.length)

  const target = candVoid[0] || empty0[0]
  log('-- 往第 r=' + target.r + ' 行（逻辑未填）填 +6（纯内存，不保存）--')
  const f1 = JSON.parse(await page.eval(JS_FILL(target.r, 6)))
  log('填值结果：' + JSON.stringify(f1))
  await sleep(700)
  const afterFill = JSON.parse(await ev(page, JS_COLLECT, 'collect'))
  const rowA = afterFill.rows.find(x => x.r === target.r)
  const feedback = rowA && (/xm-void|xm-short/.test(rowA.tdCls) || rowA.hasBtn || !!rowA.badge)
  ok('V4 【核心】填 +6 后该格立刻有反馈（竖条/角标/分摊按钮 三者至少一）',
     !!feedback, rowA ? ('tdCls="' + rowA.tdCls + '" badge=' + JSON.stringify(rowA.badge)
       + ' hasBtn=' + rowA.hasBtn) : 'row missing')
  ok('V4b 填值后 title 变成「本格：加 6 箱 …」（说明「这个数怎么来的」当场可见）',
     !!rowA && /^本格：加\s*6/.test(String(rowA.title).trim()),
     rowA ? JSON.stringify(String(rowA.title).slice(0, 60)) : 'row missing')

  /* 7. 再补填若干「无按钮」行 + 一个「有按钮」行，把两条分支都推到 */
  const more = candVoid.slice(1, 4).concat(candAlloc.slice(0, 1))
  for (const t of more) {
    await page.eval(JS_FILL(t.r, 3))
    await sleep(400)
  }
  await sleep(600)
  const afterAll = JSON.parse(await ev(page, JS_COLLECT, 'collect'))
  const filled = afterAll.rows.filter(x => Math.abs(numOf(x.val)) > 1e-9)
  log('已填加单的行数=' + filled.length + '（r=' + filled.map(x => x.r).join(',') + '）')

  /* 8. 悬空行的完整三件套（竖条 + 角标 + 无分摊按钮） */
  const voids = filled.filter(x => /xm-void/.test(x.tdCls))
  ok('V5a 存在「悬空」行可验（填入的某商品确实一个人都分不到）', voids.length >= 1,
     'void 行数=' + voids.length + '/' + filled.length + '（候选无按钮行已优先取样）')
  if (voids.length) {
    const v = voids[0]
    ok('V5b 悬空行 td 含 xm-void', /xm-void/.test(v.tdCls), v.tdCls)
    ok('V5c 悬空行角标文本 = 「悬空」', String(v.badge || '').trim() === '悬空', JSON.stringify(v.badge))
    ok('V5d 悬空行角标带 has-void 类（走琥珀色，不复用红色语义）', /has-void/.test(v.badgeCls), v.badgeCls)
    ok('V5e 悬空行**不出现**分摊按钮（一个人都分不到 ⇒ 无可分摊）', !v.hasBtn, 'hasBtn=' + v.hasBtn)
    ok('V5f 悬空行 input 带 xm-alert', /xm-alert/.test(v.inputCls), v.inputCls)
  }

  /* 9. 成因分支互斥 + 带具体量 */
  const voidTitles = filled.map(x => String(x.title)).filter(t => /分不到任何人头上/.test(t))
  const hasUnmapped = voidTitles.filter(t => /挂不上人/.test(t))
  const hasNobody = voidTitles.filter(t => /本期没有人报过这个商品/.test(t))
  ok('V6a 悬空文案里「挂不上人」与「本期没有人报过」**互斥**（同一行不得同时出现）',
     voidTitles.every(t => !(/挂不上人/.test(t) && /本期没有人报过这个商品/.test(t))),
     '样本=' + voidTitles.length + ' 挂不上人=' + hasUnmapped.length + ' 无人报过=' + hasNobody.length)
  ok('V6b 「挂不上人」分支必须带具体箱数（否则用户不知道有多少量挂了空）',
     hasUnmapped.every(t => /箱报单/.test(t)),
     hasUnmapped.length ? JSON.stringify(hasUnmapped[0].slice(0, 90)) : '（本轮未出现该分支）')
  ok('V6c 每条悬空文案都给出了「要让它生效」的可执行动作',
     voidTitles.every(t => /要让它生效/.test(t)), '样本=' + voidTitles.length)

  /* 10. 分摊路径 */
  const btns = afterAll.rows.filter(x => x.hasBtn)
  ok('V7a 存在「分摊」按钮行（有人可分 ⇒ 按方案 B 立即长出入口）', btns.length >= 1,
     '按钮行数=' + btns.length)
  if (btns.length) {
    const t = String(btns[0].btnTitle)
    /* ⚠️ 断言串必须**逐字取自源码原文**（`ptAllocBtnTitle`）——
     *   第一版我凭记忆写成「分给」⇒ 假 FAIL（源码是「分到各业务员」）。
     *   本轮真正的判据是：**依据被说出来**（'商品目标分解占比' 或 '本期各人报单量' 二选一），
     *   因为同屏两种依据含义相反（一个可改全期生效、一个只读），不说依据用户不知道能不能改。 */
    ok('V7b 按钮 title 说清**依据**与去向（含「分到各业务员」+「占比」+ 二选一的依据名）',
       /分到各业务员/.test(t) && /占比/.test(t)
       && (/商品目标分解占比/.test(t) || /本期各人报单量/.test(t)),
       JSON.stringify(t.slice(0, 110)))
  }

  /* 11. 视觉通道真的渲染（不是只有 class） */
  if (voids.length) {
    const v = voids[0]
    const amberRGB = (function (s) { // 从 computed color / shadow 里抽 rgb
      const m = String(s).match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const p = m[1].split(',').map(x => parseFloat(x))
      return { r: p[0], g: p[1], b: p[2] }
    })(v.shadow)
    ok('V10a xm-void 的左侧竖条**真的渲染**（box-shadow 非 none 且含 inset）',
       v.shadow !== 'none' && /inset/.test(v.shadow), JSON.stringify(v.shadow))
    ok('V10b 竖条颜色为**琥珀系**（红>绿>蓝 ⇒ 暖色；不是灰/黑/蓝）',
       !!amberRGB && amberRGB.r > amberRGB.g && amberRGB.g > amberRGB.b, JSON.stringify(amberRGB))
    ok('V10c 悬空格输入文字加粗（第二视觉通道，色觉障碍也读得到）',
       String(v.weight) === '600' || Number(v.weight) >= 600, 'fontWeight=' + v.weight)
  }

  /* 12. 减单（负数）仍走红色语义 —— 与琥珀严格分工 */
  const t2 = empty0.find(x => x.r !== target.r)
  if (t2) {
    await page.eval(JS_FILL(t2.r, -3)); await sleep(600)
    const after = JSON.parse(await ev(page, JS_COLLECT, 'collect'))
    const rowB = after.rows.find(x => x.r === t2.r)
    ok('V11 减单（填 -3）仍走红色语义：input 带 cell-minus（未被琥珀改写）',
       !!rowB && /cell-minus/.test(rowB.inputCls), rowB ? rowB.inputCls : 'missing')
  }

  /* 13. 零写入自证 */
  const writes = JSON.parse(await page.eval('JSON.stringify(window.__w||[])'))
  const realWrites = writes.filter(w => !/\/api\/auth\/login/.test(w))
  ok('V8 零写入自证：除登录外**没有任何**非 GET 的 /api 请求（绝不点保存）',
     realWrites.length === 0, '非GET请求=' + JSON.stringify(realWrites))

  /* 14. 截图存证 */
  const shot = OUT_DIR + '/真机-加单即时反馈-' + STAMP + '.png'
  try { await page.screenshot(shot); log('\n截图：' + shot) } catch (e) { log('截图失败（不影响判定）') }

  /* 15. 落一份取证 JSON */
  const dump = OUT_DIR + '/真机-采集事实-' + STAMP + '.json'
  fs.writeFileSync(dump, JSON.stringify({
    url: await page.eval('location.href'),
    amberVar: afterAll.amber, dangerVar: afterAll.danger,
    extraCellCount: afterAll.count,
    filledRows: filled.map(x => ({ r: x.r, val: x.val, tdCls: x.tdCls, badge: x.badge,
                                  hasBtn: x.hasBtn, title: x.title })),
    allocBtnRows: btns.map(x => ({ r: x.r, btnTitle: x.btnTitle })),
    writesApi: writes,
  }, null, 2), 'utf8')
  log('取证：' + dump)

  log('')
  log('--- 汇总 ---')
  results.forEach(r => log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name))
  log('结果：' + results.filter(r => r.pass).length + '/' + results.length + ' 通过')
}

try {
  await main()
} catch (e) {
  log('脚本异常：' + (e && e.message))
  failed = true
} finally {
  if (browser) { try { await browser.close() } catch (_) {} }
  log(failed ? '结论：❌ 未通过' : '结论：✅ 通过')
  process.exit(failed ? 1 : 0)
}
