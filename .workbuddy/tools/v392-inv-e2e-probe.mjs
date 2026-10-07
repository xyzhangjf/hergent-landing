/**
 * v392 进销存 P0 八页 —— 只读真机验收探针（生产 hergent.cn）
 *
 * 验的是「计划 §七 P0 完成定义」的前端一半：**八页都能进，且只有 boss 能进**。
 *
 * 三个相位（缺一不可，见 hergent-e2e-readonly-probe 铁律 7）：
 *   P1 真实 boss 令牌 + 无桩      → 8 条深链**都要进得去**（不误伤）
 *   P2 同一令牌 + 桩改角色=sales  → 8 条深链**都要被弹回**（拦得住）
 *       桩把 permissions 给成 '*'、custom_roles 给成 ['sales']（超集 + 让位档都开着）
 *       ⇒ 仍然被拦 ⇒ 证明判据读的是**角色 + lock 硬锁**，不是模块权限
 *   P3 摘掉桩                   → 恢复能进（证明 P2 不是「深链永远被拒」的假阳性）
 *
 * 🔴 桩必须用 addInitScript（boot 期生效）：守卫在 `beforeEach` 里 `await ensureRoleLoaded()`
 *    拉 `/api/auth/permissions`，**导航后再打 window.fetch 根本打不进去**（同租户只拉一次）。
 * 🔴 每个相位都要断言「桩真的被调用过」（stubCalls >= 1），否则「没拦住」可能是桩没生效。
 * 🔴 深链必须写 `/#/xxx`（本项目是 createWebHashHistory）且带 `?__r=` 强制新文档
 *    —— 否则 addInitScript 不执行、localStorage 种子为空。
 *
 * 运行：
 *   V392_TOKEN=$(ssh root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   NODE_PATH=... node .workbuddy/tools/v392-inv-e2e-probe.mjs
 */
import fs from 'node:fs'
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.V392_TOKEN || ''
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v392-进销存八页-2026-10-07'
const TENANT = '1'

if (!TOKEN) {
  console.log('🔴 缺 V392_TOKEN 环境变量')
  process.exit(2)
}
fs.mkdirSync(OUT, { recursive: true })

const ROUTES = [
  ['/inventory', '进销存'],
  ['/inventory/purchase', '采购单'],
  ['/inventory/purchase/new', '新建采购单'],
  ['/inventory/purchase/1', '采购单详情'],
  ['/inventory/sale', '销售单'],
  ['/inventory/sale/new', '新建销售单'],
  ['/inventory/sale/1', '销售单详情'],
  ['/inventory/stock', '库存查询']
]

const PASS = []
const FAIL = []
const ok = (name, cond, detail = '') => {
  ;(cond ? PASS : FAIL).push(name)
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' | ' + detail : ''))
}
const section = (t) => console.log('\n' + '─'.repeat(76) + '\n' + t + '\n' + '─'.repeat(76))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// boot 期注入：桩 + localStorage 种子（两者都要在首个页面脚本之前）
const INIT = `
;(function(){
  try {
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(TENANT)});
    localStorage.setItem('hergent_v2_csrf', 'probe-csrf');
    localStorage.setItem('hergent_v2_user', JSON.stringify({ id: 2, username: 'boss', role: 'boss', roles: ['boss'], name: '老板' }));
  } catch (e) {}
})();
`

/** 桩：把 /api/auth/permissions 的 user.role 换成指定角色，权限给超集 */
const stub = (role) => `
;(function(){
  var of = window.fetch;
  window.__permStub = { n: 0, role: ${JSON.stringify(role)} };
  window.fetch = function(u, o){
    var s = (typeof u === 'string') ? u : ((u && u.url) || '');
    var p = of.apply(this, arguments);
    if (s.indexOf('/api/auth/permissions') < 0) return p;
    window.__permStub.n++;
    return p.then(function(r){
      return r.clone().json().then(function(b){
        b.user = b.user || {};
        b.user.role = ${JSON.stringify(role)};
        b.user.roles = [${JSON.stringify(role)}];
        b.permissions = ['*'];                 // 模块全放行 ⇒ 只剩角色不对
        b.custom_roles = ['sales','boss'];     // 让位档也开着 ⇒ 仍然必须被 lock 拦住
        b.permissions_detail = { inventory: ['read','create','update','delete'] };
        return new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
    });
  };
})();
`

const PROBE = `JSON.stringify({
  href: location.href,
  tabs: [].slice.call(document.querySelectorAll('.main-tabs .main-tab, .main-tabs > *')).map(function(e){return (e.innerText||'').replace(/\\s+/g,'')}).slice(0,8),
  hasTabs: !!document.querySelector('.main-tabs'),
  h1: ((document.querySelector('h1')||{}).innerText||'').replace(/\\s+/g,' ').slice(0,40),
  body: ((document.body.innerText||'').replace(/\\s+/g,' ')).slice(0,300),
  errBoundary: !!document.querySelector('.err-boundary, .error-boundary, .app-error'),
  stubCalls: (window.__permStub && window.__permStub.n) || 0
})`

const read = async (p) => JSON.parse(await p.eval(PROBE))

const hardGo = async (p, hash, ms = 9000) =>
  p.goto(BASE + '/?__r=' + Date.now() + hash, ms)

const main = async () => {
  const browser = await launch({ headless: true, extraArgs: ['--no-proxy-server'] })
  const p = await browser.newPage()
  await p.enable()

  // 先落一次种子（localStorage 同源持久，后续所有导航都带着）
  await p.goto(BASE + '/?__r=seed', 6000)
  await p.eval(`localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', '1');
    localStorage.setItem('hergent_v2_csrf', 'probe-csrf');
    localStorage.setItem('hergent_v2_user', JSON.stringify({id:2,username:'boss',role:'boss',roles:['boss'],name:'老板'}));`)
  const seed = await read(p)
  console.log('种子后 href =', seed.href)

  // ─────────────────────────────────────────── P1 真实 boss
  section('P1 真实 boss 令牌（无桩）—— 8 条深链都要进得去（不误伤）')
  await p.eval(`localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)})`)
  for (const [path, title] of ROUTES) {
    await hardGo(p, '#' + path)
    const r = await read(p)
    const landed = r.href.includes('#' + path)
    ok(`P1 ${path} 落在目标路由`, landed, r.href.split('#')[1] || r.href)
    ok(`P1 ${path} 容器页签渲染`, r.hasTabs, 'tabs=' + JSON.stringify(r.tabs))
    ok(`P1 ${path} 无兜底错误页`, !r.errBoundary)
    if (path === '/inventory') {
      ok('P1 /inventory 出现四页签（工作台/采购单/销售单/库存查询）',
        ['工作台', '采购单', '销售单', '库存查询'].every(t => r.tabs.join('|').includes(t)),
        JSON.stringify(r.tabs))
    }
  }
  await hardGo(p, '#/inventory')
  await p.screenshot(OUT + '/01-工作台-boss.png')

  // ─────────────────────────────────────────── P2 桩改角色
  section('P2 同一令牌 + 桩改角色=sales（权限给超集）—— 8 条深链都要被弹回')
  const idStub = await p.addInitScript(stub('sales'))
  let stubSeen = 0
  for (const [path] of ROUTES) {
    await hardGo(p, '#' + path)
    const r = await read(p)
    stubSeen = Math.max(stubSeen, r.stubCalls)
    ok(`P2 ${path} 被弹回工作台`, r.href.includes('/workbench'), r.href.split('#')[1] || r.href)
    ok(`P2 ${path} 目标页未渲染`, !r.href.includes('#' + path))
  }
  ok('P2 ★ 桩真的被调用过（否则「没拦住」可能是桩没生效）', stubSeen >= 1, 'stubCalls=' + stubSeen)
  await p.screenshot(OUT + '/02-门禁-sales被拦.png')
  await p.removeInitScript(idStub)

  // ─────────────────────────────────────────── P3 摘桩恢复
  section('P3 摘掉桩 —— 必须恢复能进（证明 P2 不是「深链永远被拒」）')
  for (const path of ['/inventory', '/inventory/stock']) {
    await hardGo(p, '#' + path)
    const r = await read(p)
    ok(`P3 ${path} 恢复可进`, r.href.includes('#' + path) && r.hasTabs, r.href.split('#')[1] || r.href)
  }
  await hardGo(p, '#/inventory/stock')
  await p.screenshot(OUT + '/03-库存查询-boss.png')

  await hardGo(p, '#/inventory/purchase')
  await p.screenshot(OUT + '/04-采购单列表-boss.png')
  await hardGo(p, '#/inventory/sale')
  await p.screenshot(OUT + '/05-销售单列表-boss.png')

  console.log('\n' + '='.repeat(76))
  console.log(`  PASS ${PASS.length} / FAIL ${FAIL.length}`)
  FAIL.forEach(f => console.log('   FAIL: ' + f))
  console.log('  控制台错误 ' + p.errors.length + ' 条：' + JSON.stringify(p.errors.slice(0, 6)))
  console.log('='.repeat(76))
  await browser.close()
  process.exit(FAIL.length ? 1 : 0)
}

main().catch(async (e) => {
  console.log('🔴 探针自身异常：' + (e && e.message))
  process.exit(3)
})
