/**
 * v325-ai-entry-perm-e2e.mjs —— 生产真机验证「AI 入口按 `chat` 权限收窄」。
 *
 * 需求：AI 消耗积分有成本 ⇒ 默认只给管理员/老板，其他角色保留权限页入口按需开通。
 * 前端配套：5 个 AI 入口统一走 `store.canUseAi()`（= `canModule('chat')`）。
 *   ① 顶部栏「AI」按钮   ② ⌘K 快捷键   ③ 命令面板「问 AI 副驾」条目
 *   ④ 工作台「AI 晨报」整卡   ⑤ 预报页右键「让 AI 分析这行」
 *
 * 三个场景（**全部零写入**：不点保存、不改生产数据、只在浏览器里改写响应）：
 *   A 正例      demo_boss（boss / 租户 10，**有 chat**）           ⇒ 按钮**可见** + 面板搜得到
 *   B 负例      demo_boss + 拦截并**改写** `/api/auth/permissions` 去掉 chat ⇒ 按钮**不可见** + 搜不到
 *   C fail-open 同 B 但让接口**失败**（模拟抖动）                   ⇒ 按钮**仍可见**
 *
 * 🔴 三条防「空转通过」：
 *   ① 断言加载的是本轮构建入口 `index-U8SsObio.js`（别在旧包上验新功能）；
 *   ② B/C 必须断言**拦截真的发生了**（`Fetch.requestPaused` 计数 > 0）；
 *   ③ B 必须同时断言「同一页里别的入口还在」（通知铃、侧栏条目）——
 *      否则整页崩了会被误判成"隐藏成功"。
 *
 * 用法：
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node \
 *     .workbuddy/tools/v325-ai-entry-perm-e2e.mjs
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const WANT_ENTRY = process.env.HG_WANT_ENTRY || 'index-U8SsObio.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const fails = []
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra !== undefined ? '  ' + extra : '')) }
  else { fail++; fails.push(label + (extra !== undefined ? '  ' + extra : '')); console.log('  ❌ ' + label + (extra !== undefined ? '  ' + extra : '')) }
}

/* ---------- 页面内登录（demo_boss，公开端点，不碰真实账号） ---------- */
const JS_DEMO = 'fetch("/api/auth/demo-login",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})'
  + '.then(r=>r.json().then(d=>({s:r.status,d:d})))'
  + '.then(r=>{var d=r.d;if(!d.token)return JSON.stringify({ok:false,status:r.s,detail:d.detail||d.message||""});'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return JSON.stringify({ok:true,role:(d.user&&d.user.role)||"",tenant:d.tenant_id})})'

/* 取真实 permissions 原文（用于 B 场景「改写但保持结构」） */
const JS_GET_PERMS = 'fetch("/api/auth/permissions",{headers:{Authorization:"Bearer "+(localStorage.getItem("hergent_v2_token")||"")}})'
  + '.then(r=>r.text())'

/* ---------- DOM 判据 ---------- */
const Q_ENTRY = `(()=>{const s=[...document.querySelectorAll('script[src]')].map(x=>x.getAttribute('src')).join(' ');`
  + `const m=s.match(/index-[A-Za-z0-9_-]+\\.js/);return m?m[0]:''})()`

/* AI 按钮 + 三个对照面（证明不是整页崩了） */
const Q_AI = `(()=>JSON.stringify({`
  + `ai:document.querySelectorAll('.tb-copilot').length,`
  + `aiText:(document.querySelector('.tb-copilot')||{}).textContent||'',`
  + `bell:document.querySelectorAll('.tb-bell').length,`
  + `themeBtn:document.querySelectorAll('.tb-btn').length,`
  + `sideItems:document.querySelectorAll('a.sb-item').length,`
  + `sideTitles:[...document.querySelectorAll('a.sb-item')].map(e=>e.textContent.trim())`
  + `}))()`

/* 命令面板：⌘⇧K 唤起 → 输入关键词 → 数条目 */
const Q_PALETTE = (kw) => `(async()=>{`
  + `window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,shiftKey:true,bubbles:true}));`
  + `await new Promise(r=>setTimeout(r,600));`
  + `const inp=document.querySelector('.cmd-input');`
  + `if(!inp)return JSON.stringify({opened:false});`
  + `const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;`
  + `set.call(inp,${JSON.stringify(kw)});inp.dispatchEvent(new Event('input',{bubbles:true}));`
  + `await new Promise(r=>setTimeout(r,600));`
  + `return JSON.stringify({opened:true,items:[...document.querySelectorAll('.cmd-item')].map(e=>e.textContent.trim())})})()`

const CLOSE_PALETTE = `(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return 1})()`

async function waitFor(page, expr, pred, ms = 15000, step = 400) {
  const t0 = Date.now()
  let last
  while (Date.now() - t0 < ms) {
    last = await page.eval(expr).catch(e => 'ERR ' + e.message)
    if (pred(last)) return last
    await sleep(step)
  }
  return last
}

/** 把 permissions 原文里的 chat 去掉，**保持原始结构**（不改形状）。 */
function stripChat(rawText) {
  let j
  try { j = JSON.parse(rawText) } catch { return null }
  const scrubbed = JSON.parse(JSON.stringify(j))
  const tgt = (scrubbed && scrubbed.data && scrubbed.data.permissions) ? scrubbed.data : scrubbed
  if (Array.isArray(tgt && tgt.permissions)) {
    const before = tgt.permissions.length
    tgt.permissions = tgt.permissions.filter(x => x !== 'chat')
    return { body: JSON.stringify(scrubbed), before, after: tgt.permissions.length }
  }
  return null
}

const SCEN = [
  { id: 'A', name: '正例 demo_boss（有 chat）⇒ 期望 AI 入口可见', mode: 'pass' },
  { id: 'B', name: '负例 拦截并改写 permissions 去掉 chat ⇒ 期望 AI 入口隐藏', mode: 'rewrite' },
  { id: 'C', name: 'fail-open 拦截 permissions 使其失败 ⇒ 期望 AI 入口仍在', mode: 'fail' },
]

const browser = await launch({})
console.log('入口要求：' + WANT_ENTRY)
console.log('='.repeat(78))

for (const s of SCEN) {
  console.log('\n### 场景 ' + s.id + ' — ' + s.name)
  const page = await browser.newPage()
  await page.enable()

  /* 1) 先落站 + 登录（不点 UI） */
  await page.goto(BASE + '/', 2500)
  const lg = await page.eval(JS_DEMO).catch(e => 'ERR ' + e.message)
  let li = {}
  try { li = JSON.parse(lg) } catch { /* ignore */ }
  ok('登录成功（demo_boss）', li.ok === true, JSON.stringify(li))

  /* 2) 取真实 permissions 原文（B 场景要用它改写） */
  let scrubbed = null
  if (s.mode === 'rewrite') {
    const raw = await page.eval(JS_GET_PERMS).catch(e => 'ERR ' + e.message)
    scrubbed = stripChat(raw)
    ok('取到真实 permissions 并成功剥离 chat', !!scrubbed,
       scrubbed ? ('chat: ' + scrubbed.before + ' 项 → ' + scrubbed.after + ' 项') : String(raw).slice(0, 160))
  }

  /* 3) 开拦截（必须在 reload 之前） */
  let intercepted = 0
  if (s.mode !== 'pass') {
    page.raw.onEvent((msg) => {
      if (msg.method === 'Fetch.requestPaused') {
        intercepted++
        const rid = msg.params.requestId
        if (s.mode === 'fail') {
          page.raw.send('Fetch.failRequest', { requestId: rid, errorReason: 'Failed' }).catch(() => {})
        } else if (scrubbed) {
          page.raw.send('Fetch.fulfillRequest', {
            requestId: rid,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
            body: Buffer.from(scrubbed.body).toString('base64'),
          }).catch(() => {})
        } else {
          page.raw.send('Fetch.continueRequest', { requestId: rid }).catch(() => {})
        }
      }
    })
    await page.raw.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/auth/permissions*' }] })
  }

  /* 4) 带 ?v= 重载（hash-only 导航不会重载文档 ⇒ 守卫/store 不会重跑） */
  await page.goto(BASE + '/?v=' + Date.now() + '#/workbench', 4000)

  const entry = await waitFor(page, Q_ENTRY, v => typeof v === 'string' && v.length > 0, 12000)
  ok('加载的是本轮构建', entry === WANT_ENTRY, String(entry))

  const ai = await waitFor(page, Q_AI, v => {
    try { return JSON.parse(v).sideItems > 3 } catch { return false }
  }, 15000)
  let a = {}
  try { a = JSON.parse(ai) } catch { /* ignore */ }
  console.log('    DOM: ' + JSON.stringify({ ai: a.ai, bell: a.bell, themeBtn: a.themeBtn, sideItems: a.sideItems }))

  if (s.mode === 'pass' || s.mode === 'fail') {
    ok('AI 顶部栏入口**可见**', a.ai === 1, 'ai=' + a.ai)
  } else {
    ok('AI 顶部栏入口**隐藏**', a.ai === 0, 'ai=' + a.ai)
  }
  /* 🔴 对照：别的入口必须还在（否则"隐藏成功"其实是整页崩了） */
  ok('对照：通知铃仍在', a.bell >= 1, 'bell=' + a.bell)
  ok('对照：侧栏条目 > 3 且含工作台', a.sideItems > 3, 'sideItems=' + a.sideItems)

  /* 5) 命令面板（⌘⇧K 不受 AI 权限影响，应始终能开） */
  const pal = await page.eval(Q_PALETTE('问 AI 副驾')).catch(e => 'ERR ' + e.message)
  let pj = {}
  try { pj = JSON.parse(pal) } catch { /* ignore */ }
  const palHit = Array.isArray(pj.items) ? pj.items.filter(t => t.includes('问 AI')).length : 0
  if (s.mode === 'pass' || s.mode === 'fail') {
    ok('命令面板搜得到「问 AI 副驾」', palHit >= 1, 'items=' + JSON.stringify(pj.items))
  } else {
    ok('命令面板**搜不到**「问 AI 副驾」', palHit === 0, 'items=' + JSON.stringify(pj.items))
  }
  await page.eval(CLOSE_PALETTE).catch(() => {})

  /* 6) 🔴 拦截计数（B/C 必须 > 0，否则本场景什么都没测） */
  if (s.mode !== 'pass') {
    await sleep(600)
    ok('拦截真的发生了（Fetch.requestPaused > 0）', intercepted > 0, 'intercepted=' + intercepted)
  } else {
    ok('正例未开启拦截（intercepted == 0）', intercepted === 0, 'intercepted=' + intercepted)
  }

  const errs = (page.errors || []).filter(e => e && !/favicon|Failed to load resource/i.test(String(e)))
  ok('控制台无报错', errs.length === 0, errs.slice(0, 3).join(' | '))

  await page.close?.().catch?.(() => {})
}

console.log('\n' + '='.repeat(78))
console.log('===== ' + pass + ' 通过 / ' + fail + ' 失败 =====')
if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '))
await browser.close().catch(() => {})
process.exit(fail === 0 ? 0 : 1)
