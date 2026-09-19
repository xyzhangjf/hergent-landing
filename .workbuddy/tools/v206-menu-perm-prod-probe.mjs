/**
 * v206-menu-perm-prod-probe.mjs —— 生产真机验证「侧栏入口按权限隐藏」是否真的生效。
 *
 * 背景（用户 2026-09-19 拍板第 3 项「按权限隐藏」）：
 *   权限表已按租户分叉（v205），但前端侧栏**从未**调用 `/api/auth/permissions` ——
 *   于是「看得见『算工资』菜单、点进去 403」这个缺口一直在。v206 把权限接到前端：
 *     store.loadPerms() → canModule(m) ：null（未知/失败）= 不隐藏；[] = 隐藏。
 *
 * 四个场景（全部只读，不点保存、不动任何业务数据）：
 *   A 正例  demo_boss（boss / 租户 10）权限含 payroll  ⇒ 菜单**可见** + ⌘⇧K 能搜到
 *   B 负例  mptestsp（supervisor / 租户 1）权限 ['data','dashboard'] ⇒ 菜单**不可见** + 搜不到
 *   C 负例  mptest（sales / 租户 1）⇒ 菜单**不可见**
 *   D fail-open：拦截 `/api/auth/permissions` 使其失败 ⇒ 菜单**仍在**（一次接口抖动不能把菜单藏起来）
 *
 * 🔴 三条必做（否则会「空转通过」）：
 *   ① 断言当前加载的入口 chunk 就是本轮构建的 `index-DrowD83N.js`（别在旧包上验新功能）；
 *   ② D 场景必须断言**拦截真的发生了**（`Fetch.requestPaused` 计数 > 0），否则它什么都没测；
 *   ③ 负例必须同时断言「同一页里别的菜单项还在」（证明不是整页崩了而误判成"隐藏"）。
 *
 * 用法：/Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node \
 *         .workbuddy/tools/v206-menu-perm-prod-probe.mjs
 *   HG_BASE / HG_SHOT_DIR 可覆盖。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const SHOT_DIR = process.env.HG_SHOT_DIR
  || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/算工资菜单按权限隐藏-2026-09-19'
const WANT_ENTRY = process.env.HG_WANT_ENTRY || 'index-DrowD83N.js'
fs.mkdirSync(SHOT_DIR, { recursive: true })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const fails = []
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra !== undefined ? '  ' + extra : '')) }
  else { fail++; fails.push(label + (extra !== undefined ? '  ' + extra : '')); console.log('  ❌ ' + label + (extra !== undefined ? '  ' + extra : '')) }
}

/* ---------- 页面内登录（不点 UI：登录页有两个含「登录」的元素，按文本匹配会点错） ---------- */
const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json().then(d=>({s:r.status,d:d})))'
  + '.then(r=>{var d=r.d;if(!d.token)return JSON.stringify({ok:false,status:r.s,detail:d.detail||d.message||""});'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return JSON.stringify({ok:true,role:(d.user&&d.user.role)||"",tenant:d.tenant_id})})'

const JS_DEMO = 'fetch("/api/auth/demo-login",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})'
  + '.then(r=>r.json().then(d=>({s:r.status,d:d})))'
  + '.then(r=>{var d=r.d;if(!d.token)return JSON.stringify({ok:false,status:r.s,detail:d.detail||d.message||""});'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return JSON.stringify({ok:true,role:(d.user&&d.user.role)||"",tenant:d.tenant_id})})'

/* ---------- DOM 判据 ---------- */
/* 侧栏：`a.sb-item` 里文本含「算工资」的个数。同时返回全部条目名，供「别的菜单还在吗」对照。 */
const Q_SIDEBAR = `(()=>{const a=[...document.querySelectorAll('a.sb-item')];`
  + `const h=a.filter(x=>x.textContent.replace(/\\s+/g,'').includes('算工资'));`
  + `return JSON.stringify({total:a.length,hit:h.length,`
  + `titles:a.map(x=>x.textContent.trim()).filter(Boolean)})})()`

/* 手机抽屉：`.md-item` 同理（需先开抽屉） */
const Q_DRAWER = `(()=>{const a=[...document.querySelectorAll('a.md-item')];`
  + `const h=a.filter(x=>x.textContent.replace(/\\s+/g,'').includes('算工资'));`
  + `return JSON.stringify({total:a.length,hit:h.length,titles:a.map(x=>x.textContent.trim())})})()`

/* 当前入口 chunk —— 证明验的是本轮构建 */
const Q_ENTRY = `(()=>{const s=[...document.querySelectorAll('script[src]')].map(x=>x.getAttribute('src')).join(' ');`
  + `const m=s.match(/index-[A-Za-z0-9_-]+\\.js/);return m?m[0]:''})()`

/* 命令面板：⌘⇧K 唤起 → 输入「算工资」→ 数 `.cmd-item` 标题 */
const Q_PALETTE = `(async()=>{`
  + `window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,shiftKey:true,bubbles:true}));`
  + `await new Promise(r=>setTimeout(r,500));`
  + `const inp=document.querySelector('.cmd-input');`
  + `if(!inp)return JSON.stringify({opened:false});`
  + `const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;`
  + `set.call(inp,'算工资');inp.dispatchEvent(new Event('input',{bubbles:true}));`
  + `await new Promise(r=>setTimeout(r,500));`
  + `const items=[...document.querySelectorAll('.cmd-item')].map(e=>e.textContent.trim());`
  + `return JSON.stringify({opened:true,items:items,empty:!!document.querySelector('.cmd-empty')})})()`

/* 面板里的全部条目（空关键词）—— 供对照 */
const Q_PALETTE_ALL = `(async()=>{`
  + `const inp=document.querySelector('.cmd-input');`
  + `if(!inp)return JSON.stringify({opened:false});`
  + `const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;`
  + `set.call(inp,'');inp.dispatchEvent(new Event('input',{bubbles:true}));`
  + `await new Promise(r=>setTimeout(r,400));`
  + `return JSON.stringify({items:[...document.querySelectorAll('.cmd-item')].map(e=>e.textContent.trim())})})()`

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

const SCEN = [
  {
    id: 'A', name: '正例 boss（demo_boss / 租户 10，权限含 payroll）',
    login: JS_DEMO, expectMenu: true, expectPalette: true,
  },
  {
    id: 'B', name: '负例 supervisor（mptestsp / 租户 1，权限 2 项无 payroll）',
    login: JS_LOGIN('mptestsp', 'Mpsup@1'), expectMenu: false, expectPalette: false,
  },
  {
    id: 'C', name: '负例 sales（mptest / 租户 1，权限 7 项无 payroll）',
    login: JS_LOGIN('mptest', 'Mptest@1'), expectMenu: false, expectPalette: false,
  },
  {
    id: 'D', name: 'fail-open（mptestsp + 拦截 /api/auth/permissions）',
    login: JS_LOGIN('mptestsp', 'Mpsup@1'), blockPerms: true, expectMenu: true, expectPalette: true,
  },
]

const browser = await launch({})
console.log('入口要求：' + WANT_ENTRY)
console.log('='.repeat(78))

for (const s of SCEN) {
  console.log('\n### 场景 ' + s.id + ' — ' + s.name)
  const page = await browser.newPage()
  await page.enable()

  let intercepted = 0
  if (s.blockPerms) {
    /* 拦住权限接口，模拟「接口抖动 / 502」 */
    page.raw.onEvent((msg) => {
      if (msg.method === 'Fetch.requestPaused') {
        intercepted++
        page.raw.send('Fetch.failRequest', { requestId: msg.params.requestId, errorReason: 'Failed' }).catch(() => {})
      }
    })
    await page.raw.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/auth/permissions*' }] })
  }

  // ① 先进站点拿到同源上下文，再页面内登录（cookie + localStorage 都落在真实浏览器里）
  await page.goto(BASE + '/', 2500)
  const lg = await page.eval(s.login).catch(e => 'ERR ' + e.message)
  let li = {}
  try { li = JSON.parse(lg) } catch { /* ignore */ }
  ok('登录成功', li.ok === true, JSON.stringify(li))

  // ② 带 ?v= 避免 hash-only 导航不重载文档（Router Guard 不重跑）
  await page.goto(BASE + '/?v=' + Date.now() + '#/workbench', 3500)
  const entry = await waitFor(page, Q_ENTRY, v => typeof v === 'string' && v.length > 0, 12000)
  ok('加载的是本轮构建', entry === WANT_ENTRY, String(entry))

  const sb = await waitFor(page, Q_SIDEBAR, v => { try { return JSON.parse(v).total > 3 } catch { return false } }, 15000)
  let sbj = {}
  try { sbj = JSON.parse(sb) } catch { /* ignore */ }
  ok('侧栏已渲染（条目数 > 3）', (sbj.total || 0) > 3, '条目数=' + sbj.total + ' ' + JSON.stringify(sbj.titles))
  if (s.expectMenu) ok('「算工资」入口**可见**', sbj.hit === 1, '命中=' + sbj.hit)
  else {
    ok('「算工资」入口**不可见**', sbj.hit === 0, '命中=' + sbj.hit)
    ok('（对照）其它业务入口仍在 ⇒ 不是整页崩', (sbj.total || 0) > 3, '条目数=' + sbj.total)
  }

  if (s.blockPerms) {
    ok('🔴 拦截真的发生了（否则本场景空转）', intercepted > 0, 'Fetch.requestPaused=' + intercepted)
    const probe = await page.eval('fetch("/api/auth/permissions").then(r=>"HTTP "+r.status).catch(e=>"FAILED")')
      .catch(e => 'ERR ' + e.message)
    ok('权限接口此刻确实取不到', String(probe).indexOf('FAILED') >= 0 || String(probe).indexOf('HTTP 5') >= 0, String(probe))
  }

  // ③ 手机抽屉入口（同一 canModule 的第二处接线）
  await page.raw.send('Emulation.setDeviceMetricsOverride',
    { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }).catch(() => {})
  await sleep(600)
  await page.eval(`(()=>{const b=[...document.querySelectorAll('.mnav-item')].find(x=>x.textContent.includes('更多'));if(b)b.click();return !!b})()`)
  await sleep(700)
  const dr = await page.eval(Q_DRAWER).catch(e => 'ERR ' + e.message)
  let drj = {}
  try { drj = JSON.parse(dr) } catch { /* ignore */ }
  if (drj.total) ok('手机抽屉「算工资」与侧栏一致', s.expectMenu ? drj.hit === 1 : drj.hit === 0, '命中=' + drj.hit + '/' + drj.total)
  else ok('手机抽屉已打开（有 md-item）', false, 'md-item=0，抽屉未渲染')
  await page.raw.send('Emulation.clearDeviceMetricsOverride').catch(() => {})
  await sleep(500)

  // ④ 命令面板（⌘⇧K）
  const pal = await page.eval(Q_PALETTE).catch(e => 'ERR ' + e.message)
  let pj = {}
  try { pj = JSON.parse(pal) } catch { /* ignore */ }
  ok('命令面板可唤起', pj.opened === true, JSON.stringify(pj).slice(0, 200))
  if (pj.opened) {
    const hitPay = (pj.items || []).some(t => t.indexOf('算工资') >= 0)
    ok(s.expectPalette ? '命令面板**能搜到**算工资' : '命令面板**搜不到**算工资',
      s.expectPalette ? hitPay : (!hitPay && pj.empty === true),
      '命中=' + (pj.items || []).length + ' ' + JSON.stringify(pj.items).slice(0, 160))
    const all = await page.eval(Q_PALETTE_ALL).catch(() => '{}')
    let aj = {}
    try { aj = JSON.parse(all) } catch { /* ignore */ }
    const hitAll = (aj.items || []).filter(t => t.indexOf('算工资') >= 0).length
    ok('空关键词时算工资条目数符合权限', s.expectPalette ? hitAll === 1 : hitAll === 0,
      '全部条目=' + (aj.items || []).length + ' 其中算工资=' + hitAll)
    if (!s.expectPalette) ok('（对照）面板里别的命令还在 ⇒ 不是面板坏了', (aj.items || []).length > 5, '条目=' + (aj.items || []).length)
  }
  await page.eval(CLOSE_PALETTE).catch(() => {})

  const shot = SHOT_DIR + '/v206-场景' + s.id + '-入口' + (s.expectMenu ? '可见' : '隐藏') + '.png'
  await page.screenshot(shot)
  console.log('  📷 ' + shot)

  const errs = page.errors.filter(e => !/favicon|ResizeObserver/i.test(e))
  ok('页面零 JS 异常', errs.length === 0, errs.slice(0, 3).join(' | '))

  console.log('  —— 场景 ' + s.id + ' 结束：本轮累计 ' + pass + ' 通过 / ' + fail + ' 失败')
}

await browser.close()
console.log('\n' + '='.repeat(78))
console.log('断言结果：' + pass + ' 通过 / ' + fail + ' 失败')
if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log('  ❌ ' + f)) }
process.exit(fail === 0 ? 0 : 1)
