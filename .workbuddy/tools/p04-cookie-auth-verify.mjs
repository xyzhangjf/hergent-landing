/**
 * P0-4 (v628) 真机验收探针：会话凭证是否真的已从 localStorage 迁到 httpOnly Cookie。
 *
 * 判据（缺一即算没做成）：
 *   ① localStorage 里**不再有** hergent_v2_token / hergent_v2_csrf（XSS 偷不到凭证）
 *   ② document.cookie 里**看不到** erp_token（httpOnly 生效 —— 这是本次的安全收益本身）
 *   ③ document.cookie 里**看得到** hergent_auth=1（前端靠它判登录态）
 *   ④ 全程 fetch **没有任何一个** Authorization: Bearer 头（老通道确实关闭了）
 *   ⑤ 点「演示」登录后**不会**被路由守卫弹回 #/login（守卫认 cookie 而不是 localStorage）
 *   ⑥ 无 JS 运行时错误
 *
 * 🔴 与旧探针的根本差别：旧探针靠 `addInitScript` 往 localStorage 塞 token 来"登录"，
 *    P0-4 之后这条路**已经不通**（前端不再读它）—— 所以本探针改走真实登录流程
 *    （点演示按钮，让后端自然 Set-Cookie）。这一点本身就是要验证的对象。
 */
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const R = []
const ok = (name, cond, detail = '') => R.push({ name, pass: !!cond, detail: String(detail) })

const browser = await launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.enable()

  // ① 请求头记录器：统计有多少次请求带 Authorization（应为 0）
  const initSrc = `
    window.__hdr = { total: 0, bearer: 0 };
    (function () {
      const _f = window.fetch;
      window.fetch = function (...a) {
        try {
          const h = (a[1] || {}).headers || {};
          let has = false;
          if (typeof Headers !== 'undefined' && h instanceof Headers) has = h.has('Authorization');
          else if (h) has = !!(h.Authorization || h.authorization);
          if (has) window.__hdr.bearer++;
          window.__hdr.total++;
        } catch (e) {}
        return _f.apply(this, a);
      };
    })();
  `
  await page.addInitScript(initSrc)

  await page.goto(BASE + '/#/login', 5000)

  // ② 真实登录：点「先看看演示效果（免注册）」—— 后端会自然下发全部 cookie
  const clicked = await page.eval(`
    (function () {
      const b = [...document.querySelectorAll('button')]
        .find(x => (x.textContent || '').includes('先看看演示效果'));
      if (!b) return false;
      b.click();
      return true;
    })()
  `)
  ok('登录页找到「演示」按钮', clicked)

  await new Promise(r => setTimeout(r, 6000))   // 等登录往返 + 路由跳转

  const state = await page.eval(`(function () {
    return {
      hash: location.hash,
      lsToken: localStorage.getItem('hergent_v2_token'),
      lsCsrf: localStorage.getItem('hergent_v2_csrf'),
      lsKeys: Object.keys(localStorage).filter(k => /token|csrf/i.test(k)),
      cookie: document.cookie,
      hdr: window.__hdr || null,
      bodyLen: (document.body.innerText || '').length,
    };
  })()`)

  ok('① localStorage 已无 hergent_v2_token', state.lsToken === null, '实际=' + state.lsToken)
  ok('① localStorage 已无 hergent_v2_csrf', state.lsCsrf === null, '实际=' + state.lsCsrf)
  ok('① 无其它 token/csrf 残留键', state.lsKeys.length === 0, JSON.stringify(state.lsKeys))

  ok('② erp_token 对 JS 不可见（httpOnly 生效）', !/erp_token=/.test(state.cookie),
     'cookie=' + state.cookie.slice(0, 160))
  ok('③ hergent_auth=1 可见（前端登录态判据）', /hergent_auth=1/.test(state.cookie))
  ok('③ csrf_token 可见（供写操作回传）', /csrf_token=/.test(state.cookie))

  ok('④ 全程无 Bearer 请求头', state.hdr && state.hdr.bearer === 0,
     JSON.stringify(state.hdr))
  ok('④ 确实发过请求（计数有效）', state.hdr && state.hdr.total > 0, JSON.stringify(state.hdr))

  ok('⑤ 未被弹回登录页（守卫认 cookie）', state.hash !== '#/login', 'hash=' + state.hash)
  ok('⑤ 页面有实际内容（非白屏）', state.bodyLen > 200, '文本长度=' + state.bodyLen)

  ok('⑥ 无 JS 运行时错误', page.errors.length === 0, page.errors.slice(0, 3).join(' | '))

  console.log('\n=== P0-4 真机验收 ===')
  let fail = 0
  for (const r of R) {
    if (!r.pass) fail++
    console.log(`${r.pass ? '✅' : '🔴'} ${r.name}${r.detail ? '   → ' + r.detail : ''}`)
  }
  console.log(`\n合计 ${R.length} 项，失败 ${fail} 项`)
  if (fail) process.exitCode = 1
} finally {
  await browser.close()
}
