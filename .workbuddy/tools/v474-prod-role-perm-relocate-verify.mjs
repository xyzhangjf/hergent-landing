/**
 * v474-prod-role-perm-relocate-verify.mjs —— 「角色权限」侧栏归位的**生产真机**只读探针
 *
 * 与本地探针的分工（同一套组合拳）：
 *   · 本地 `v474-nav-role-perm-relocate-verify.mjs` 打桩 `/api/auth/permissions` + 真渲染侧栏
 *     ⇒ 证「判据正确、DOM 真的按判据渲染」（含双反例自证判别力）；
 *   · 本探针**打真生产 https://hergent.cn + 真后端**，只在**一个字段**上做最小改写
 *     ⇒ 证「**已上线的那份产物**在真租户权限数据下也真的把入口放对了地方」。
 *
 * 🔴 为什么是「最小改写」而不是「整套打桩」：
 *   把 `/api/auth/permissions` 整个换成假响应，测的是**我编的那份假权限**，不是生产。
 *   这里让**真请求先发生**（包装 `window.fetch`），只把响应体里的 `user.role` / `user.roles`
 *   改成目标角色；`permissions`（模块集）与 `custom_roles`（本租户真实改过权限的角色）
 *   **一律保留服务端原值**。
 *
 * 🔴 本轮特有的三个验点（本地已验，这里要在**线上产物**上再验一遍）：
 *   ① 组织相关列真的多了「角色权限」，系统设置列真的少了它（整区无残留）；
 *   ② 非 boss 时该条目消失而**同列仍有员工档案**（不会露出空列 —— resolveNavItem 会整列丢掉，
 *      那样用户会报"档案管理里组织相关不见了"）；
 *   ③ 停在权限页时 `.sb-area.cur` **恰好只有「档案管理」**（高亮跟着入口走了，不是留在系统区）。
 *
 * 鉴权：1 次 `POST /api/auth/demo-login`（演示租户 / demo_boss，租户只读）。
 * 只读：只 GET 页面与资源；唯一的 POST 是公开的 demo-login。零写业务请求。
 *
 * 反例对照（判别力自证）：
 *   · `经营工作台` 每个用例都在 ⇒ 页面真渲染了，不是白屏被误读成"已隐藏"；
 *   · 「按后端真实角色」与「改写成 sales」**同一 token、同一租户、同一模块集**，
 *     只有 role 不同 ⇒ 差异只可能来自角色闸门；
 *   · 改写为 sales ＋ 塞进 `custom_roles`（「让位」第③档的前置条件）仍不可见。
 */
import { launch } from './lib/cdp-lite.mjs'
import https from 'node:https'

const BASE = 'https://hergent.cn/'
const TARGET = '角色权限'
const SIBLING = '员工档案'
const CONTROL = '经营工作台'

let pass = 0, fail = 0
const ok = (c, n, e) => {
  if (c) { pass++; console.log('  ✅ ' + n + (e !== undefined ? '　→ ' + e : '')) }
  else { fail++; console.log('  ❌ ' + n + (e !== undefined ? '　→ ' + e : '')) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

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
 *  `overrideRole` —— 改 `user.role` / `user.roles`
 *  `yieldHole`   —— 再把该角色塞进 `custom_roles`（「本租户曾给这个角色改过权限」）。
 *    生产 demo 租户 `custom_roles` 恒为 `[]`（租户只读），所以「让位」那条路必须在这一层补出来，
 *    否则"lock/module:null 挡得住让位"在真机上根本没被验过。
 *
 * 🔴🔴 **为什么这里绝对不能用正则**（本探针第一版就踩了，且踩得很隐蔽）：
 *   本函数返回的是一段**模板字面量**。在里面写 `url.replace(/^https?:\/\/[^/]+/, '')`
 *   时，模板字面量会把 `\/` 当成转义、折叠成 `/` ⇒ 展开后变成 `url.replace(/^https?:/ , /[^/]+/ , '')`
 *   ⇒ **整个注入脚本语法错误（SyntaxError: Unexpected token '^'）**
 *   ⇒ 脚本被浏览器**整段丢弃**（语法错误发生在解析阶段，不是运行阶段）
 *   ⇒ 连同一段里的 `localStorage.setItem(token)` 都没执行 ⇒ **页面根本没登录**
 *   ⇒ 侧栏不存在 ⇒ 探针给出的是一堆「对照项不在 / 条目缺失」的**假失败**，
 *      而真正病因（一个转义）藏在 `page.errors` 里没人看。
 *   ⇒ 现在这段刻意**不用任何反斜杠**（纯 indexOf 手撕），并在末尾写 `window.__probeInit='ok'`，
 *      由 `open()` 断言它 —— 让这类错误**当场炸出来**，而不是伪装成十条 ❌。
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
    // 🔴 纯 indexOf 手撕 origin/query —— 本段**不得出现反斜杠**（见上方说明）
    var path = url;
    var h = path.indexOf('://');
    if (h >= 0) { var s = path.indexOf('/', h + 3); path = (s >= 0) ? path.slice(s) : '/'; }
    var q = path.indexOf('?');
    if (q >= 0) path = path.slice(0, q);
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
  window.__probeInit = 'ok';
})();
`
}

const READ_BASE = `(function(){
  var nav = document.querySelector('.sb-nav');
  var items = nav ? Array.prototype.slice.call(nav.querySelectorAll('.sb-item span')).map(function(e){return e.textContent.trim()}) : [];
  var areas = nav ? Array.prototype.slice.call(nav.querySelectorAll('.sb-area-btn span')).map(function(e){return e.textContent.trim()}) : [];
  var ps = window.__probe && window.__probe.permsSeen;
  return JSON.stringify({
    hasNav: !!nav, items: items, areas: areas,
    /* 🔴 注入自检：不是 'ok' 就说明 addInitScript 整段没执行（多半是语法错误）
       ⇒ 页面根本没登录，下面所有断言都会是假失败。必须单独判一次并立刻停。 */
    probeInit: window.__probeInit || null,
    roleSeen: ps && ps.user && ps.user.role,
    rolesSeen: ps && ps.user && ps.user.roles,
    customRoles: ps && ps.custom_roles,
    permsCount: ps && Array.isArray(ps.permissions) ? ps.permissions.length : null
  });
})()`

/** 点开某个职能区的弹窗（合成 click 触发 Vue 的 @click，弹窗是 Teleport 到 body 的） */
const OPEN_AREA = (area) => `(function(){
  var bs = Array.prototype.slice.call(document.querySelectorAll('.sb-area-btn'));
  var b = bs.filter(function(x){ return (x.textContent||'').indexOf(${JSON.stringify(area)}) >= 0 })[0];
  if (!b) return 'NOT_FOUND';
  b.click();
  return 'clicked';
})()`

/** 读弹窗：列标题 → 条目（名 + href） */
const READ_POP = `(function(){
  var cols = [];
  Array.prototype.slice.call(document.querySelectorAll('.sb-pop-col')).forEach(function(c){
    var hd = c.querySelector('.sb-pop-hd');
    var items = Array.prototype.slice.call(c.querySelectorAll('.sb-pop-item')).map(function(a){
      return { name:(a.textContent||'').trim(), href:a.getAttribute('href')||'' };
    });
    cols.push({ label: hd ? hd.textContent.trim() : '', items: items });
  });
  return JSON.stringify(cols);
})()`

/** 各职能区是否高亮（cur）+ 标签栏当前标题 */
const READ_CUR = `(function(){
  var areas = Array.prototype.slice.call(document.querySelectorAll('.sb-area')).map(function(a){
    var sp = a.querySelector('.sb-area-btn span');
    return { name: sp ? sp.textContent.trim() : '', cur: a.classList.contains('cur') };
  });
  var t = document.querySelector('.tab-item.on .tab-title');
  var card = Array.prototype.slice.call(document.querySelectorAll('.panel-hd b')).filter(function(x){ return /角色/.test(x.textContent) })[0];
  return JSON.stringify({ areas: areas, tabTitle: t ? t.textContent.trim() : '', cardTitle: card ? card.textContent.trim() : '', hash: location.hash });
})()`

const browser = await launch({ headless: true })

async function open(page, hash) {
  let d = {}, errs = []
  try {
    await page.goto(BASE + (hash || '#/workbench'), 8000)
    /* 🔴 等待必须**够长**：v472 那支 goto 后立刻读（它只断言一级项，而一级项在权限回来前就会渲染）；
       本轮要读 `custom_roles` 与弹窗内容，必须等 `/api/auth/permissions` 真回来。
       1200ms 实测不够（读到的 role 是 undefined）⇒ 2500ms，并轮询等 `.sb-nav` 真出现。 */
    let ready = false
    for (let i = 0; i < 12 && !ready; i++) {
      await sleep(400)
      ready = await page.eval(`(function(){return !!document.querySelector('.sb-nav .sb-item')})()`)
    }
    await sleep(1200)
    d = JSON.parse(await page.eval(READ_BASE))
    errs = page.errors || []
  } catch (e) {
    d = { hasNav: false, items: [] }
    errs = [(e && e.message) || String(e)]
  }
  return { d, errs }
}
async function readArea(page, area) {
  const r = await page.eval(OPEN_AREA(area))
  if (r !== 'clicked') return { err: r, cols: [] }
  /* 轮询等弹窗列真渲染出来（Vue 的 Teleport 是下一 tick 才进 DOM）*/
  let cols = []
  for (let i = 0; i < 12; i++) {
    await sleep(250)
    cols = JSON.parse(await page.eval(READ_POP))
    if (cols.length) break
  }
  await page.eval(`(function(){var b=[].slice.call(document.querySelectorAll('.sb-area-btn')).filter(function(x){return x.getAttribute('aria-expanded')==='true'})[0]; if(b) b.click();})()`)
  await sleep(250)
  return { err: cols.length ? null : 'POP_EMPTY', cols }
}
async function runCase(label, { overrideRole = null, yieldHole = false } = {}) {
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(initScript(overrideRole, yieldHole))
  const { d, errs } = await open(page)
  let arch, sys
  try {
    arch = await readArea(page, '档案管理')
    sys = await readArea(page, '系统')
  } catch (e) {
    arch = { err: String(e), cols: [] }; sys = { err: String(e), cols: [] }
  }
  const orgCol = (arch.cols || []).find(c => c.label === '组织相关') || null
  const setCol = (sys.cols || []).find(c => c.label === '系统设置') || null
  const archNames = (arch.cols || []).flatMap(c => c.items.map(i => i.name))
  const sysNames = (sys.cols || []).flatMap(c => c.items.map(i => i.name))
  return { label, d, errs, orgCol, setCol, archNames, sysNames, archErr: arch.err, sysErr: sys.err }
}

/* 🔴 全局熔断：注入脚本没跑起来就别往下测了 —— 否则每个用例都会输出十条
   「对照项不在 / 条目缺失」，把**一个转义 bug**伪装成"产品功能全坏"。 */
let initBroken = false
function guardInit(d, errs) {
  if (d.probeInit === 'ok') return true
  initBroken = true
  console.log('  ❌ 注入自检失败：addInitScript 未执行（probeInit=' + JSON.stringify(d.probeInit) + '）')
  console.log('     ⇒ 页面未登录，下面所有断言都不可信，本轮中止。')
  if (errs && errs.length) console.log('     page.errors: ' + errs.slice(0, 3).join(' | '))
  return false
}

console.log('\nA. 生产真机 —— 「角色权限」的落位与角色收敛（真后端 + 只改 role 字段）')
const cases = [
  { label: '按后端真实角色（demo 租户）', overrideRole: null,  expectSee: true },
  { label: '改写为 boss',                 overrideRole: 'boss',      expectSee: true },
  { label: '改写为 admin',                overrideRole: 'admin',     expectSee: true },
  { label: '改写为 sales',                overrideRole: 'sales',     expectSee: false },
  { label: '改写为 accountant',           overrideRole: 'accountant',expectSee: false },
  { label: '改写为 supervisor',           overrideRole: 'supervisor',expectSee: false },
  { label: '改写为 sales ＋ 让位前置条件', overrideRole: 'sales',     expectSee: false, yieldHole: true },
]
for (const c of cases) {
  const r = await runCase(c.label, { overrideRole: c.overrideRole, yieldHole: c.yieldHole })
  console.log(`\n  ── ${c.label} ──`)
  console.log(`     probeInit=${r.d.probeInit} role=${r.d.roleSeen} custom_roles=${JSON.stringify(r.d.customRoles)} 模块数=${r.d.permsCount}`)
  console.log(`     档案管理各列：${(r.archNames || []).join('、') || '(无)'}`)
  console.log(`     系统各列：${(r.sysNames || []).join('、') || '(无)'}`)
  if (!guardInit(r.d, r.errs)) break
  ok((r.d.items || []).includes(CONTROL), `对照组「${CONTROL}」在（页面真渲染了）`)
  ok(!r.archErr, '「档案管理」弹窗能打开', r.archErr || 'ok')

  const orgNames = r.orgCol ? r.orgCol.items.map(i => i.name) : []
  ok(orgNames.includes(TARGET) === c.expectSee,
    `「组织相关」列${c.expectSee ? '**含**' : '**不含**'}「${TARGET}」`,
    orgNames.join('、') || '（该列不存在）')
  if (c.expectSee) {
    const t = (r.orgCol ? r.orgCol.items : []).find(i => i.name === TARGET)
    ok(!!t && /#\/settings\?tab=perm$/.test(t.href), `「${TARGET}」指向 #/settings?tab=perm`, t ? t.href : '缺条目')
  }
  ok(orgNames.includes(SIBLING) || !c.expectSee,
    `同列仍含「${SIBLING}」（不会露出空列）`, orgNames.join('、') || '（该列不存在）')

  /* 🔴 「系统」区对**非管理岗整区不存在**（AI 能力 / 连接与集成 / 自动化 / 系统设置 / 打印
     五列全是 ADMIN_ROLES 页 ⇒ `resolveNavItem` 把每列都过滤空、整区返回 null）。
     所以不能对非 boss 断言"系统设置列剩 4 项" —— 那是**我探针的断言写错了**，
     且它会掩盖更强的真相：非 boss 连「系统」这个区都摸不到。 */
  const hasSystem = (r.d.areas || []).includes('系统')
  if (c.expectSee) {
    ok(hasSystem, '「系统」区存在（管理岗可见）', (r.d.areas || []).join('、'))
    const setNames = r.setCol ? r.setCol.items.map(i => i.name) : []
    ok(setNames.length === 4, '「系统设置」列剩 4 项', setNames.join('、') || '（列不存在）')
    ok(!r.sysNames.includes(TARGET), `「系统」区任何一列都**没有**「${TARGET}」（归位生效）`, r.sysNames.join('、'))
  } else {
    ok(!hasSystem, `「系统」区对 ${c.overrideRole} **整区不存在**（比"某一项不可见"更强）`,
      '侧栏区: ' + ((r.d.areas || []).join('、') || '（无）'))
    ok(!r.sysNames.includes(TARGET), `「系统」区任何一列都没有「${TARGET}」`, r.sysNames.join('、') || '（该区本就不可见）')
  }

  if (c.yieldHole) {
    ok(Array.isArray(r.d.customRoles) && r.d.customRoles.includes('sales'),
      '「让位」前置条件确已送达（custom_roles 含 sales）—— 否则这条断言是空的', JSON.stringify(r.d.customRoles))
  }
  ok(r.errs.length === 0, '零 console 错误', r.errs.length ? r.errs.slice(0, 2).join(' | ') : '0')
}

console.log('\nB. 高亮归位 + 标签栏/卡片标题（真机，停在权限页）')
if (initBroken) {
  await browser.close()
  console.log('\n==== 注入脚本未执行，本轮中止（不是产品问题，是探针问题） ====')
  process.exit(2)
}
{
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(initScript(null))
  await page.goto(BASE + '#/settings?tab=perm', 8000)
  await sleep(2600)
  const cur = JSON.parse(await page.eval(READ_CUR))
  const initState = JSON.parse(await page.eval(`(function(){return JSON.stringify({i: window.__probeInit || null, nav: !!document.querySelector('.sb-nav')})})()`))
  const curNames = (cur.areas || []).filter(a => a.cur).map(a => a.name)
  console.log(`     probeInit=${initState.i} 侧栏=${initState.nav}`)
  console.log(`     高亮区：${curNames.join('、') || '(无)'}　标签栏=${cur.tabTitle}　卡片=${cur.cardTitle}`)
  ok(initState.i === 'ok' && initState.nav, '注入自检通过 + 侧栏已渲染（否则下面全是假失败）')
  ok(cur.hash === '#/settings?tab=perm', '真的停在 #/settings?tab=perm（深链没被改）', cur.hash)
  ok(curNames.includes('档案管理'), '「档案管理」区高亮', curNames.join('、'))
  ok(!curNames.includes('系统'), '「系统」区**不**高亮（否则一个功能两处高亮）', curNames.join('、'))
  ok(curNames.length === 1, '恰好一个区高亮', curNames.join('、'))
  ok(cur.tabTitle === TARGET, `标签栏标题 = ${TARGET}`, cur.tabTitle)
  ok(cur.cardTitle === TARGET, `页面卡片标题 = ${TARGET}`, cur.cardTitle)
  ok((page.errors || []).length === 0, '零 console 错误', (page.errors || []).slice(0, 2).join(' | ') || '0')
}

console.log('\nC. 深链守卫 —— 非 boss 敲 #/settings?tab=perm 必须被弹回（真机）')
for (const role of ['sales', 'accountant']) {
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(initScript(role))
  await page.goto(BASE + '#/settings?tab=perm', 8000)
  await sleep(2600)
  const h = JSON.parse(await page.eval('(function(){return JSON.stringify({hash:location.hash})})()'))
  ok(h.hash !== '#/settings?tab=perm', `${role} 深链被守卫弹回`, '当前 hash=' + h.hash)
}

await browser.close()
console.log(`\n==== v474 角色权限侧栏归位（生产真机）：${pass} 通过 / ${fail} 失败 ====`)
process.exit(fail ? 1 : 0)