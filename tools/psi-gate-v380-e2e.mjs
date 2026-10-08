/**
 * psi-gate-v380-e2e.mjs —— v380「进销存能力闸门」前端真机验收（只读）
 *
 * 验什么（开发计划 §二·0.8 的第 ④⑤ 条 + 「该放的没误伤」）：
 *   ① boss  ：侧栏**出现**「进销存」；冷启动深链 `/#/inventory` 进得去、页面真渲染
 *   ② 主管  ：真实登录（mptestsp）⇒ 侧栏**没有**「进销存」；深链**被守卫拦**（落回工作台 + 可见提示）
 *   ③ 导购  ：**同一枚主管令牌**，把 `/api/auth/permissions` 桩成 `role='guide'` 且
 *             权限**取超集（含 `inventory`）**、`custom_roles` 也含 `guide`
 *             ⇒ 侧栏仍**看不到**、深链仍**被拦**。
 *             🔴 这一相位专门验 `pages.js::/inventory` 的 **`lock: true`**：
 *                若没有 lock，「让位」档会放行（主管持 inventory 时会看到），这条就会翻红。
 *   ④ 判别力自证：同一枚选择器在 boss 侧栏必须**读得到**「进销存」（正例）
 *   ⑤ 零写入自证：全程无业务写请求（fetch/XHR 哨兵 + 「监控已安装」护栏）
 *
 * ⚠️ 「业务员」相位为何缺席：`mptest`（sales）是**仅小程序**账号，带 `X-Client: web`
 *    登录会被后端正确拒绝（403「该账号只能在手机小程序登录」）⇒ 网页端相位无法用它。
 *    故用 ③ 的「桩改身份」补第二个非 boss 角色（且更强：它验的是 lock，不只是名单）。
 *
 * 只读性：写动作仅 3 次登录（1 次 demo-login + 2 次 login），收尾逐一 logout 注销。
 * 用法：node tools/psi-gate-v380-e2e.mjs
 */
import { launch } from '../.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const R = []
const ok = (name, cond, extra = '') => { R.push({ name, ok: !!cond, extra }); console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '  → ' + extra : '')); return !!cond }
const nz = (s) => String(s == null ? '' : s).replace(/\s+/g, '')

async function call(method, path, token, body) {
  const h = { 'Content-Type': 'application/json', 'X-Client': 'web' }
  if (token) h.Authorization = 'Bearer ' + token
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  const txt = await res.text()
  let j = {}; try { j = JSON.parse(txt) } catch { /* ignore */ }
  return { status: res.status, json: j, text: txt }
}

const tok = (o) => o.access_token || o.token || ''

/* ---------------- 每个相位注入的脚本（单一 fetch 包装，避免"桩链式叠加"） ----------------
   ⚠️ 本函数返回值是**模板字符串**：内部一律用单引号，**禁止出现反引号**（会截断字符串）。 */
function seedJs(token, user, tenant, csrf, stub) {
  return `
try {
  localStorage.setItem('hergent_v2_token', ${JSON.stringify(token)});
  localStorage.setItem('hergent_v2_user', ${JSON.stringify(JSON.stringify(user || {}))});
  ${tenant ? "localStorage.setItem('hergent_v2_tenant', " + JSON.stringify(String(tenant)) + ');' : ''}
  ${csrf ? "localStorage.setItem('hergent_v2_csrf', " + JSON.stringify(String(csrf)) + ');' : ''}
} catch (e) {}

/* ① toast 账本：只在"出现的当拍"落账（轮询会漏）
   🔴 observe(document) —— 不能用 document.documentElement：文档起点时它还可能是 null，
      被下面的 try 吞掉 ⇒ 观察器根本没装上（本轮实测踩过，表现是"提示一条都读不到"）。 */
window.__toasts = [];
try {
  var rec = function () {
    var els = document.querySelectorAll('[class*="toast"]');
    for (var i = 0; i < els.length; i++) {
      var x = (els[i].textContent || '').replace(/\\s+/g, ' ').trim();
      if (x && window.__toasts.indexOf(x) < 0) window.__toasts.push(x);
    }
  };
  new MutationObserver(rec).observe(document, { childList: true, subtree: true, characterData: true });
  document.addEventListener('DOMContentLoaded', rec);
} catch (e) { window.__toastObsErr = String(e); }

/* ② 零写入哨兵 + ③ 权限桩（**同一个** fetch 包装） */
window.__WRITES = [];
window.__PERM_STUB = ${JSON.stringify(stub || null)};
window.__PERM_CALLS = 0;
(function () {
  function logWrite(m, u) {
    try {
      if (String(u).indexOf('/api/') >= 0 && String(m || 'GET').toUpperCase() !== 'GET') {
        window.__WRITES.push(String(m).toUpperCase() + ' ' + String(u));
      }
    } catch (e) {}
  }
  var f0 = window.fetch;
  window.fetch = function (a, b) {
    var u = (typeof a === 'string') ? a : ((a && a.url) || '');
    logWrite((b && b.method) || (a && a.method) || 'GET', u);
    var pr = f0.apply(this, arguments);
    var S = window.__PERM_STUB;
    if (S && u.indexOf('/api/auth/permissions') >= 0) {
      window.__PERM_CALLS++;
      return pr.then(function (r) {
        return r.json().then(function (j) {
          j.user = Object.assign({}, j.user, { role: S.role, roles: S.roles });
          var set = {};
          (j.permissions || []).forEach(function (m) { set[m] = 1; });
          (S.addModules || []).forEach(function (m) { set[m] = 1; });
          j.permissions = Object.keys(set);
          j.custom_roles = (j.custom_roles || []).concat(S.customRoles || []);
          return new Response(JSON.stringify(j), { status: 200, headers: { 'Content-Type': 'application/json' } });
        });
      });
    }
    return pr;
  };
  var o0 = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { logWrite(m, u); return o0.apply(this, arguments) };
})();

/* ④ 原生弹窗桩：无头页无人应答 confirm 会把主线程挂死 */
window.__dlg = [];
window.confirm = function (m) { window.__dlg.push('confirm:' + m); return true };
window.alert = function (m) { window.__dlg.push('alert:' + m) };
`
}

const SNAPSHOT = `JSON.stringify({
  href: location.href,
  loggedIn: !!localStorage.getItem('hergent_v2_token'),
  nav: [...document.querySelectorAll('.sb-nav .sb-item')].map(function (a) { return (a.textContent || '').trim() }),
  dock: [...document.querySelectorAll('.notif-dock')].map(function (t) { return (t.textContent || '').trim() }),
  toasts: window.__toasts || [],
  toastObsErr: window.__toastObsErr || '',
  permCalls: window.__PERM_CALLS || 0,
  writes: window.__WRITES || [],
  armed: Array.isArray(window.__WRITES),
  h2: [...document.querySelectorAll('h2')].map(function (h) { return (h.textContent || '').trim() }),
  gate: (document.querySelector('.inv-v') || {}).textContent || ''
})`

async function probe(browser, label, token, user, tenant, csrf, stub) {
  console.log('\n===== 相位 ' + label + ' =====')
  const page = await browser.newPage()
  await page.enable()
  const sid = await page.addInitScript(seedJs(token, user, tenant, csrf, stub))
  // 🔴 冷启动深链必须让 URL **真的不同**（只改 hash 不产生新文档 ⇒ 种下的 localStorage 是空的）
  await page.goto(BASE + '/?__r=' + Date.now() + '#/inventory', 1600)
  const early = JSON.parse(await page.eval(SNAPSHOT))          // 提示还活着（~1.6s）
  await new Promise(r => setTimeout(r, 7500))                   // 等页面稳定
  const late = JSON.parse(await page.eval(SNAPSHOT))
  await page.screenshot('/tmp/v380-' + label + '.png')
  await page.removeInitScript(sid)
  return { early, late, dlg: late.dlg || [] }
}

async function main() {
  const demo = await call('POST', '/api/auth/demo-login', null, {})
  if (demo.status !== 200 || !tok(demo.json)) throw new Error('demo-login 失败：' + demo.status)
  const bossTok = tok(demo.json)
  const supR = await call('POST', '/api/auth/login', null, { username: 'mptestsp', password: 'Mpsup@1' })
  const supTok = tok(supR.json)
  if (!supTok) throw new Error('mptestsp 登录失败：' + supR.status + ' ' + supR.text.slice(0, 120))
  console.log('令牌：boss(demo/t10)=%s 主管(t1)=%s', !!bossTok, !!supTok)

  // ③ 桩改身份：role=guide，权限**超集（含 inventory）**，custom_roles 含 guide ⇒ 专验 lock
  const GUIDE_STUB = {
    role: 'guide', roles: ['guide'], customRoles: ['guide'],
    addModules: ['inventory'],
  }

  const browser = await launch({ headless: true })
  let A, B, C
  try {
    A = await probe(browser, 'boss', bossTok, demo.json.user, demo.json.tenant_id, '', null)
    B = await probe(browser, 'supervisor', supTok, supR.json.user, supR.json.tenant_id, supR.json.csrf_token, null)
    C = await probe(browser, 'guide-stub', supTok, supR.json.user, supR.json.tenant_id, supR.json.csrf_token, GUIDE_STUB)
  } finally {
    await browser.close()
  }

  console.log('\n===== 断言 =====')
  console.log('\n-- 前置（不通过则后面全是假结论）--')
  ok('三个相位都处于已登录状态', A.late.loggedIn && B.late.loggedIn && C.late.loggedIn,
    A.late.loggedIn + '/' + B.late.loggedIn + '/' + C.late.loggedIn)
  ok('① boss **到达了**目标深链（href 带 #/inventory）',
    /#\/inventory/.test(A.late.href), 'A=' + A.late.href)
  ok('②③ 两个非 boss **已离开**目标深链（否则等于守卫没跑，②③ 全是假阴性）',
    !/#\/inventory/.test(B.late.href) && !/#\/inventory/.test(C.late.href),
    'B=' + B.late.href + ' C=' + C.late.href)
  ok('③ 权限桩**真的被调用过**（否则该相位等于没桩）', C.late.permCalls >= 1, 'permCalls=' + C.late.permCalls)
  ok('①② 相位**没有**被桩污染（permCalls 应为 0）',
    A.late.permCalls === 0 && B.late.permCalls === 0, A.late.permCalls + '/' + B.late.permCalls)
  ok('toast 观察器安装成功（无异常）',
    !A.late.toastObsErr && !B.late.toastObsErr, 'A=' + (A.late.toastObsErr || 'ok'))

  console.log('\n-- ① boss：应放行 --')
  ok('boss 侧栏**出现**「进销存」', A.late.nav.includes('进销存'), '侧栏 ' + A.late.nav.length + ' 项：' + JSON.stringify(A.late.nav))
  ok('boss 深链 `/#/inventory` **没被弹走**', /#\/inventory/.test(A.late.href), A.late.href)
  ok('boss 页面真渲染（标题=进销存 且 闸门状态非空）',
    A.late.h2.includes('进销存') && nz(A.late.gate).length > 0, 'h2=' + JSON.stringify(A.late.h2) + ' 闸门=' + nz(A.late.gate))

  console.log('\n-- ② 主管（真实登录）：应拦住 --')
  ok('主管侧栏**没有**「进销存」', !B.late.nav.includes('进销存'), '侧栏 ' + B.late.nav.length + ' 项：' + JSON.stringify(B.late.nav))
  ok('主管深链 `/#/inventory` **被弹回工作台**',
    !/#\/inventory/.test(B.late.href) && /#\/workbench/.test(B.late.href), B.late.href)
  const bHint = B.early.toasts.concat(B.late.toasts, B.early.dock, B.late.dock).filter(t => t && t.indexOf('进销存') >= 0)
  ok('主管看到**可见提示**（含「进销存」字样，不是静默弹走）', bHint.length > 0,
    JSON.stringify(bHint) + ' | toasts=' + JSON.stringify(B.early.toasts.concat(B.late.toasts)))
  ok('主管页面上**没有**进销存页内容', !B.late.h2.includes('进销存'), 'h2=' + JSON.stringify(B.late.h2))

  console.log('\n-- ③ 导购（同令牌、桩改身份、权限超集含 inventory）：仍应拦住 ⇒ 验 lock --')
  ok('导购侧栏**没有**「进销存」（权限超集也放不开）', !C.late.nav.includes('进销存'), '侧栏 ' + C.late.nav.length + ' 项：' + JSON.stringify(C.late.nav))
  ok('导购深链 `/#/inventory` **被弹回工作台**',
    !/#\/inventory/.test(C.late.href) && /#\/workbench/.test(C.late.href), C.late.href)
  ok('导购页面**没有**进销存页内容', !C.late.h2.includes('进销存'), 'h2=' + JSON.stringify(C.late.h2))
  ok('导购没有拿到「闸门状态」（说明 /api/psi/meta 没被成功调用）',
    nz(C.late.gate).length === 0, '闸门=' + nz(C.late.gate))

  console.log('\n-- ④ 判别力自证（正例必须有，否则 ②③ 的"读不到"可能是探针瞎了）--')
  ok('同一选择器在 boss 侧栏**读得到**「进销存」', A.late.nav.includes('进销存'), 'boss nav 含该项')
  ok('boss 侧栏项数 > 主管侧栏项数（两角色侧栏确实不同源）', A.late.nav.length > B.late.nav.length,
    'boss=' + A.late.nav.length + ' 主管=' + B.late.nav.length)
  ok('主管与导购侧栏项数相同（同门槛同结果）', B.late.nav.length === C.late.nav.length,
    '主管=' + B.late.nav.length + ' 导购=' + C.late.nav.length)
  ok('两个非 boss 侧栏都保留了与本次无关的入口（排除"菜单被整块藏了"）',
    B.late.nav.includes('经营工作台') && C.late.nav.includes('经营工作台'),
    JSON.stringify(B.late.nav.slice(0, 3)))

  console.log('\n-- ⑤ 零写入自证 --')
  const WRITE_RISK = /save|matrix|bulk|upsert|import|execute|close|delete|create|submit|update|password|logout/i
  const allW = [].concat(A.late.writes, B.late.writes, C.late.writes).filter(w => WRITE_RISK.test(w))
  ok('写监控已安装（缺它下面的"0 条"恒真）',
    A.late.armed && B.late.armed && C.late.armed, A.late.armed + '/' + B.late.armed + '/' + C.late.armed)
  ok('★ 零写入：全程未发出业务写请求', allW.length === 0, allW.length ? JSON.stringify(allW) : '0 条')

  console.log('\n===== 收尾注销 =====')
  for (const [lb, tk] of [['boss(demo)', bossTok], ['supervisor', supTok]]) {
    const r = await call('POST', '/api/auth/logout', tk, {})
    let body = {}; try { body = JSON.parse(r.text) } catch { /* ignore */ }
    ok('注销 ' + lb + ' 回执 success=true（判据取响应体，不看状态码）', body.success === true, 'status=' + r.status)
  }

  const fail = R.filter(x => !x.ok).length
  console.log('\n============================================')
  console.log('通过 ' + (R.length - fail) + ' 项，失败 ' + fail + ' 项（共 ' + R.length + '）')
  console.log('============================================')
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error('探针异常：', (e && e.message) || e); process.exit(2) })
