/**
 * v472-prod-boss-gate-verify.mjs —— 「四区开发期只给 boss」的**生产真机**只读探针
 *
 * 与本地探针的分工（同一套组合拳）：
 *   · 本地探针 `v472-dev-boss-gate-verify.mjs` 打桩 `/api/auth/permissions` + 加载
 *     `vite dev` 的**产品真源** ⇒ 证「判据正确、DOM 真的按判据渲染」（99 行 × 9 角色穷举）；
 *   · 本探针**打真生产 https://hergent.cn + 真后端**，只在**一个字段**上做最小改写
 *     ⇒ 证「**已上线的那份产物**在真租户权限数据下也真的按角色收敛」。
 *
 * 🔴 为什么是「最小改写」而不是「整套打桩」：
 *   把 `/api/auth/permissions` 整个换成假响应，测的是**我编的那份假权限**，不是生产；
 *   本探针让**真请求先发生**（`route` 语义用 fetch 包装实现），只把响应体里的
 *   `user.role` / `user.roles` 改成目标角色，`permissions`（模块集）
 *   与 `custom_roles`（本租户真实改过权限的角色）**一律保留服务端原值** ——
 *   于是「第③档让位」的前置条件由**真数据**决定，`lock: true` 挡不挡得住才是真判据。
 *
 * 鉴权：1 次 `POST /api/auth/demo-login`（演示租户 / demo_boss，租户只读）。
 * 只读：只 GET 页面与资源；唯一的 POST 是公开的 demo-login。零写业务请求。
 *
 * 反例对照（判别力自证）：
 *   ① `经营工作台` 在每个用例里都必须在 ⇒ 证明页面真渲染了，不是空白页被误读成"已隐藏"；
 *   ② 「按后端真实角色」用例与「改写成 sales」用例**同一 token、同一租户、同一权限集**，
 *      只有 role 不同 ⇒ 两者差异只可能来自角色闸门，不可能来自别的。
 */
import { launch } from './lib/cdp-lite.mjs'
import https from 'node:https'

const BASE = 'https://hergent.cn/'
const AREAS = ['仓配管理', '资金管理', '市场营销', '数据报表']
const CONTROL = '经营工作台'

let pass = 0, fail = 0
const ok = (c, n, e) => {
  if (c) { pass++; console.log('  ✅ ' + n + (e !== undefined ? '　→ ' + e : '')) }
  else { fail++; console.log('  ❌ ' + n + (e !== undefined ? '　→ ' + e : '')) }
}

function demoLogin() {
  return new Promise((resolve, reject) => {
    const body = '{}'
    const req = https.request(BASE + 'api/auth/demo-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, res => {
      let t = ''
      res.on('data', c => (t += c))
      res.on('end', () => {
        try { resolve(JSON.parse(t)) } catch (e) { reject(new Error('demo-login 解析失败: ' + t.slice(0, 200))) }
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

const login = await demoLogin()
if (!login.token) { console.log('!! demo-login 未返回 token'); process.exit(2) }
console.log(`demo-login ok：tenant=${login.tenant_id} user=${login.user && login.user.username} role=${login.user && login.user.role}`)

/** 注入：写 token/tenant + 包装 fetch（真请求先发生，只改 role 字段）
 *
 *  `overrideRole`   —— 改 `user.role` / `user.roles`
 *  `yieldHole`      —— 再把该角色塞进 `custom_roles`（= 「本租户曾给这个角色改过权限」）。
 *    这是 `roleGateOpen` **第③档「让位」**的前置条件，也是 v345 `/cron` 活洞的复现姿势：
 *    只加 `roles` 不加 `lock` 的收紧，会被这一档**整个越过**。
 *    🔴 生产 demo 租户 `custom_roles` 恒为 `[]`（且租户只读、改不了），所以必须在这一层
 *      把前置条件**补出来**，否则"lock 挡得住让位"这条在真机上**根本没被验过**。
 */
function initScript(overrideRole, yieldHole = false) {
  const patch = overrideRole
    ? `if (j && j.user) { j.user.role = ${JSON.stringify(overrideRole)}; j.user.roles = [${JSON.stringify(overrideRole)}]; }
          ${yieldHole ? `if (j && Array.isArray(j.custom_roles) && j.custom_roles.indexOf(${JSON.stringify(overrideRole)}) < 0) { j.custom_roles = j.custom_roles.concat([${JSON.stringify(overrideRole)}]); }` : ''}`
    : '/* 不改写 */'
  return `
(function(){
  try{
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(login.token)});
    localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(String(login.tenant_id))});
  }catch(e){}
  window.__probe = { permsSeen: null };
  var of = window.fetch;
  window.fetch = function(input, init){
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    var path = url.replace(/^https?:\\/\\/[^/]+/, '').split('?')[0];
    var p = of.apply(this, arguments);
    if (path === '/api/auth/permissions') {
      return p.then(function(res){
        return res.text().then(function(t){
          var j = null; try { j = JSON.parse(t); } catch(e){}
          window.__probe.permsSeen = j;
          ${patch}
          return new Response(JSON.stringify(j), { status: res.status, headers: { 'content-type':'application/json' } });
        });
      });
    }
    return p;
  };
})();
`
}

const READ = `(function(){
  var nav = document.querySelector('.sb-nav');
  var items = nav ? Array.prototype.slice.call(nav.querySelectorAll('.sb-item span')).map(function(e){return e.textContent.trim()}) : [];
  var ps = window.__probe && window.__probe.permsSeen;
  return JSON.stringify({
    href: location.href,
    hasNav: !!nav,
    items: items,
    roleSeen: ps && ps.user && ps.user.role,
    rolesSeen: ps && ps.user && ps.user.roles,
    customRoles: ps && ps.custom_roles,
    permsCount: ps && Array.isArray(ps.permissions) ? ps.permissions.length : null
  });
})()`

const browser = await launch({ headless: true })

async function run(label, { overrideRole = null, hash = '#/workbench', yieldHole = false } = {}) {
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(initScript(overrideRole, yieldHole))
  let d = {}, errs = []
  try {
    await page.goto(BASE + hash, 7000)
    d = JSON.parse(await page.eval(READ))
    errs = page.errors || []
  } catch (e) {
    d = { href: '(异常) ' + ((e && e.message) || String(e)), hasNav: false, items: [] }
    errs = [(e && e.message) || String(e)]
  }
  return { label, d, errs }
}

console.log('\nA. 生产真机 —— 侧栏四区对「角色」的收敛（真后端 + 只改 role 字段）')
const cases = [
  { label: '按后端真实角色（demo 租户）', overrideRole: null, expectAreas: null },
  { label: '改写为 boss',                 overrideRole: 'boss',       expectAreas: true },
  { label: '改写为 sales',                overrideRole: 'sales',      expectAreas: false },
  { label: '改写为 accountant',           overrideRole: 'accountant', expectAreas: false },
  { label: '改写为 admin',                overrideRole: 'admin',      expectAreas: false },
  { label: '改写为 supervisor',           overrideRole: 'supervisor', expectAreas: false },
  { label: '改写为 sales ＋ 触发「让位」前置条件', overrideRole: 'sales', expectAreas: false, yieldHole: true },
  { label: '改写为 accountant ＋ 触发「让位」前置条件', overrideRole: 'accountant', expectAreas: false, yieldHole: true },
]

let realRole = null
for (const c of cases) {
  const { d, errs } = await run(c.label, { overrideRole: c.overrideRole, yieldHole: c.yieldHole })
  const items = d.items || []
  const seen = AREAS.filter(a => items.includes(a))
  if (c.overrideRole === null) realRole = d.roleSeen
  console.log(`\n  ── ${c.label} ──`)
  console.log(`     role=${d.roleSeen} roles=${JSON.stringify(d.rolesSeen)} custom_roles=${JSON.stringify(d.customRoles)} 模块数=${d.permsCount}`)
  console.log(`     侧栏一级项：${items.join(' / ') || '(无)'}`)
  ok(items.includes(CONTROL), `对照组「${CONTROL}」在（页面真渲染了）`)
  if (c.expectAreas === true) {
    const miss = AREAS.filter(a => !items.includes(a))
    ok(miss.length === 0, 'boss 侧栏含全部四区', miss.length ? '缺: ' + miss.join('、') : AREAS.join('、'))
  } else if (c.expectAreas === false) {
    ok(seen.length === 0, `${c.overrideRole} 侧栏无四区任一`, seen.length ? '泄漏: ' + seen.join('、') : '四区全不可见')
  } else {
    console.log(`     （后端真实角色 = ${d.roleSeen}；四区可见情况：${seen.length ? seen.join('、') : '全不可见'}）`)
  }
  if (c.yieldHole) {
    ok(Array.isArray(d.customRoles) && d.customRoles.includes(c.overrideRole),
      `「让位」前置条件确已送达（custom_roles 含 ${c.overrideRole}）—— 否则这条断言是空的`,
      JSON.stringify(d.customRoles))
  }
  ok(errs.length === 0, '零 console 错误', errs.length ? errs.slice(0, 2).join(' | ') : '0')
}

console.log('\nB. 深链守卫 —— 直接敲 #/wh/inbound（真机）')
{
  const { d, errs } = await run('sales 深链', { overrideRole: 'sales', hash: '#/wh/inbound' })
  const h = String(d.href || '').split('#')[1] || ''
  console.log(`     改写 sales 后敲 #/wh/inbound ⇒ 落到 #${h}`)
  ok(!h.startsWith('/wh'), 'sales 深链 #/wh/inbound 被守卫弹回', '当前 hash=#' + h)
  ok(errs.length === 0, '深链用例零 console 错误', errs.length ? errs.slice(0, 2).join(' | ') : '0')

  const { d: d2 } = await run('boss 深链对照', { overrideRole: 'boss', hash: '#/wh/inbound' })
  const h2 = String(d2.href || '').split('#')[1] || ''
  console.log(`     改写 boss 后敲 #/wh/inbound ⇒ 落到 #${h2}`)
  ok(h2.startsWith('/wh'), '对照：boss 深链不被弹回（证明弹回是角色闸门干的，不是路由坏了）', '当前 hash=#' + h2)
}

await browser.close()
console.log(`\n==== v472 生产真机验收：${pass} 通过 / ${fail} 失败 ====`)
console.log(`（后端 demo 租户真实角色 = ${realRole}）`)
process.exit(fail ? 1 : 0)
