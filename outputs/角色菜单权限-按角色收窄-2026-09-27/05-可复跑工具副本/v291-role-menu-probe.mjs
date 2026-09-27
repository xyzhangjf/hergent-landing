/* v291 「不同角色只能看到自己有权限的页面」· 零写入真机探针
 *
 * 为什么要真机而不是读代码：
 *   本次改动的判据散布在 4 处（侧栏 24 个入口 / 路由守卫 / 命令面板 / 页内跳转），
 *   全部最终收敛到 `constants/pages.js`。读代码只能证明"我写了"，不能证明
 *   "**按角色的权限真的渲染成那样**" —— 而后者才是老板要的效果。
 *
 * 为什么可以零写入：
 *   全程用 `addScriptToEvaluateOnNewDocument` 在**文档任何脚本之前**把
 *   `/api/auth/permissions` 与其余 `/api/**` 桩掉（本机托管 dist），
 *   所以：① 不需要任何真实账号 ② 一个真实请求都不会发出 ③ 不碰生产库。
 *
 * 反例对照（本项目最硬的验证手法）：
 *   同一份探针跑**新旧两个 dist**，判据必须给出相反结果 —— 否则断言不算数。
 *     HG_DIST=<dist> HG_TAG=new  node v291-role-menu-probe.mjs
 *     HG_DIST=/tmp/v291-dist-prev-<ts> HG_TAG=old node v291-role-menu-probe.mjs
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const DIST = process.env.HG_DIST || '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/dist'
const TAG = process.env.HG_TAG || 'new'
const PORT = Number(process.env.HG_PORT || 8901)
const OUT = process.env.HG_OUT || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/角色菜单权限-按角色收窄-2026-09-27'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
}
function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0])
    if (p === '/' || !path.extname(p)) p = '/index.html'
    const f = path.join(DIST, p)
    if (!f.startsWith(DIST) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
      res.writeHead(404); res.end('nf'); return
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' })
    fs.createReadStream(f).pipe(res)
  })
  return new Promise(r => srv.listen(PORT, '127.0.0.1', () => r(srv)))
}

/* ---------- 8 个角色的真实模块集合（取自生产 `_DEFAULT_PERMS` / 实时权限矩阵） ---------- */
const ROLES = {
  admin:      ['*'],
  boss:       ['dashboard', 'ops-workbench', 'data', 'sales', 'buying', 'stock', 'accounts', 'crm',
               'marketing', 'hr', 'payroll', 'projects', 'perf', 'goals', 'reports', 'chat', 'tasks'],
  accountant: ['dashboard', 'accounts', 'reports', 'marketing', 'chat'],
  sales:      ['dashboard', 'ops-workbench', 'sales', 'buying', 'stock', 'crm', 'data', 'chat'],
  guide:      ['dashboard', 'ops-workbench', 'sales', 'buying', 'stock', 'crm', 'chat'],
  driver:     ['dashboard', 'stock', 'chat'],
  staff:      ['data', 'chat', 'stock'],
  supervisor: ['data', 'dashboard', 'chat']
}

/* ---------- v291 期望：改后（新产物）---------- */
const ALL12 = ['/workbench', '/forecast', '/rebate', '/loss-accounting', '/payroll', '/archive',
               '/price-channels', '/connect', '/bid-radar', '/cron', '/ai-hub', '/settings']
const EXPECT_NEW = {
  admin:      ALL12,
  boss:       ALL12,
  accountant: ['/workbench', '/rebate', '/loss-accounting', '/archive', '/price-channels', '/ai-hub'],
  sales:      ['/workbench', '/rebate', '/loss-accounting', '/archive', '/bid-radar', '/ai-hub'],
  supervisor: ['/workbench', '/forecast', '/rebate', '/loss-accounting', '/archive', '/ai-hub'],
  guide:      ['/workbench', '/ai-hub'],
  driver:     ['/workbench', '/ai-hub'],
  staff:      ['/workbench', '/ai-hub']
}
/* ---------- 反例：改前（旧产物）—— 只有 forecast / payroll 两条有门禁 ---------- */
const EXPECT_OLD = {
  admin:      ALL12,
  boss:       ALL12,
  accountant: ALL12.filter(p => !['/forecast', '/payroll'].includes(p)),
  sales:      ALL12.filter(p => !['/forecast', '/payroll'].includes(p)),
  supervisor: ALL12.filter(p => p !== '/payroll'),
  guide:      ALL12.filter(p => !['/forecast', '/payroll'].includes(p)),
  driver:     ALL12.filter(p => !['/forecast', '/payroll'].includes(p)),
  staff:      ALL12.filter(p => !['/forecast', '/payroll'].includes(p))
}
const EXPECT = TAG === 'old' ? EXPECT_OLD : EXPECT_NEW

/* ---------- 桩：登录态 + 按角色回权限 ---------- */
function INIT(role, permStatus = 200) {
  const perms = ROLES[role]
  return `(() => {
  var ROLE = ${JSON.stringify(role)};
  var PERMS = ${JSON.stringify(perms)};
  var PERM_STATUS = ${permStatus};
  try {
    localStorage.setItem('hergent_v2_token', 'V291-PROBE-TOKEN-NOT-REAL');
    localStorage.setItem('hergent_v2_tenant', '1');
    localStorage.setItem('hergent_v2_user', JSON.stringify({ id: 1, username: 'probe', display_name: '探针', role: ROLE, roles: [ROLE] }));
  } catch (e) {}
  function j(o) {
    return new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  var orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : ((input && input.url) || '');
    if (/\\/api\\/auth\\/permissions/.test(url)) {
      if (PERM_STATUS !== 200) return new Response('boom', { status: PERM_STATUS });
      return j({ user: { id: 1, username: 'probe', display_name: '探针', role: ROLE, roles: [ROLE] },
                 permissions: PERMS, tenant_id: 1, plan: 'free',
                 capabilities: { view: true, export: true } });
    }
    if (/\\/api\\/auth\\/me/.test(url)) {
      return j({ user: { id: 1, username: 'probe', display_name: '探针', role: ROLE, roles: [ROLE] } });
    }
    /* 其余 /api/** 一律回空数组：JS 里 [].anyProp === undefined，比 {} 更不容易炸 */
    if (/\\/api\\//.test(url)) return j([]);
    return orig(input, init);
  };
})()`
}

/* ---------- 页面内：读侧栏实际渲染出的条目 ---------- */
const READ_MENU = `(() => {
  const items = Array.from(document.querySelectorAll('aside.sidebar .sb-item, .sb-nav .sb-item'));
  const hrefs = items.map(a => (a.getAttribute('href') || '').replace(/^#/, '')).filter(Boolean);
  return JSON.stringify({ hrefs, texts: items.map(a => (a.textContent || '').trim()) });
})()`

let pass = 0, fail = 0
const fails = []
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra !== undefined ? '  [' + extra + ']' : '')) }
  else { fail++; fails.push(label + '  [' + extra + ']'); console.log('  ❌ ' + label + (extra !== undefined ? '  [' + extra + ']' : '')) }
}

async function main() {
  console.log('=== v291 角色菜单门禁探针 [' + TAG + '] ===')
  console.log('dist = ' + DIST + '\n')
  const srv = await serve()
  const browser = await launch({ headless: true, port: PORT + 1 })
  const page = await browser.newPage()
  await page.enable()

  const base = 'http://127.0.0.1:' + PORT

  /* 🔴 釜底抽薪：把**页面级 chunk** 换成空 Vue 组件（实测踩坑后的结论，别省）。
     为什么不能靠"给业务接口编假数据"：
       页面模板会一层层读深字段（如 Workbench 的 `loopStatus.acceptance.loop_proposals_total`），
       补了一层还有下一层；而且赋值处常有 `d.data ? d.data : null` 这类 guard
       ⇒ 连 `{data:[]}` 都会被折成 `[]`。
       页面一抛错，**ErrorBoundary 会把整个 `#app` 替换成错误卡片** ——
       侧栏跟着消失，探针读到 0 条菜单，看起来像"门禁把菜单全藏了"（**严重误判**）。
     ⇒ 让页面 chunk 返回空组件，Shell（侧栏 / 命令面板 / 守卫）就是完全真实的，
       被测对象（入口门禁）不受任何业务数据干扰。 */
  const STUB_MODULE = Buffer.from(
    'export default { name: "ProbeStubPage", render() { return null } }'
  ).toString('base64')
  await page.raw.send('Fetch.enable', {
    patterns: [{ urlPattern: '*Workbench*', requestStage: 'Request' },
               { urlPattern: '*CronJobs*', requestStage: 'Request' },
               { urlPattern: '*AiHub*', requestStage: 'Request' }]
  })
  page.raw.onEvent((msg) => {
    if (msg.method !== 'Fetch.requestPaused') return
    const { requestId, request } = msg.params
    if (/Workbench|CronJobs|AiHub/.test(request.url)) {
      page.raw.send('Fetch.fulfillRequest', {
        requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }],
        body: STUB_MODULE
      }).catch(() => {})
    } else {
      page.raw.send('Fetch.continueRequest', { requestId }).catch(() => {})
    }
  })

  const results = {}

  /* ========== 用例 1：8 个角色的侧栏条目 ========== */
  for (const role of Object.keys(ROLES)) {
    const ident = await page.addInitScript(INIT(role))
    /* 🔴 必须在 **hash 之前** 变化 URL（`/?r=`）才会重新加载文档 ——
       只改 `#/workbench` 属于同文档导航，脚本（含桩与 store 初始化）不会重跑。 */
    await page.goto(base + '/?r=' + role + '#/workbench', 2600)
    let raw = '{"hrefs":[]}'
    for (let i = 0; i < 12; i++) {          // 轮询：等权限回来 + 菜单重渲染
      raw = await page.eval(READ_MENU)
      const n = (JSON.parse(raw).hrefs || []).length
      if (n > 0 && i >= 3) break
      await sleep(400)
    }
    await page.removeInitScript(ident)
    const got = JSON.parse(raw)
    results[role] = got.hrefs
    const exp = EXPECT[role]
    const missing = exp.filter(x => !got.hrefs.includes(x))
    const extra = got.hrefs.filter(x => !exp.includes(x))
    console.log('\n【' + role + '】期望 ' + exp.length + ' 条 / 实测 ' + got.hrefs.length + ' 条')
    console.log('   实测：' + got.hrefs.join(' '))
    ok(role + ' 菜单条数与名单完全一致', missing.length === 0 && extra.length === 0,
       missing.length ? ('缺: ' + missing.join(' ')) : (extra.length ? ('多: ' + extra.join(' ')) : 'ok'))
    ok(role + ' 无 console 错误', page.errors.length === 0, page.errors.slice(0, 2).join(' | '))
    page.errors.length = 0
  }

  /* ========== 用例 2：深链拦截（手敲 URL 进不去） ========== */
  console.log('\n===== 用例 2：深链（员工手敲 #/cron）=====')
  const ident2 = await page.addInitScript(INIT('staff'))
  await page.goto(base + '/?d=staff#/cron', 2600)
  /* ⚠️ 不要断言 URL 里还留着 `?denied=` —— Shell.vue 的 watch 会**主动把它清掉**
     （注释写明"不清的话刷新/回退/把链接转给别人都会再弹一次"）。清掉是**正确行为**。
     所以判据改成两条：① 最终落点不是 /cron；② 提示**点名了**被拒的页面（不静默）。
     提示只显示 3 秒 ⇒ 用轮询抓，别用固定 sleep。 */
  let toastTxt = ''
  for (let i = 0; i < 22; i++) {
    toastTxt = await page.eval("(() => { const el = document.querySelector('[class*=toast]'); return el ? el.textContent.trim() : ''; })()")
    if (toastTxt) break
    await sleep(200)
  }
  const after = await page.eval('JSON.stringify({ href: location.href, hash: location.hash })')
  await page.removeInitScript(ident2)
  const a = JSON.parse(after)
  console.log('   最终 URL = ' + a.href)
  console.log('   页面提示 = ' + JSON.stringify(toastTxt))
  ok('员工深链 #/cron 被拦（没停在 /cron）', !/#\/cron/.test(a.hash), a.hash)
  ok('落回工作台', /#\/workbench/.test(a.hash), a.hash)
  ok('拒绝看得见（弹提示点名页面）', /权限/.test(toastTxt), toastTxt)

  /* ========== 用例 3：接口抖动不误伤（fail-open） ========== */
  console.log('\n===== 用例 3：权限接口 500 时不可把老板的菜单藏掉 =====')
  const ident3 = await page.addInitScript(INIT('boss', 500))
  await page.goto(base + '/?f=1#/workbench', 3000)
  await sleep(1200)
  const raw3 = await page.eval(READ_MENU)
  await page.removeInitScript(ident3)
  const g3 = JSON.parse(raw3)
  console.log('   实测 ' + g3.hrefs.length + ' 条：' + g3.hrefs.join(' '))
  ok('拉不到权限时全量显示（fail-open，不藏菜单）', g3.hrefs.length === 12, g3.hrefs.length + ' 条')

  await page.eval('1')
  await browser.close()
  srv.close()

  /* ---------- 汇总 ---------- */
  console.log('\n\n========== 汇总 [' + TAG + '] ==========')
  console.log('通过 ' + pass + ' / 失败 ' + fail)
  if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log('  - ' + f)) }

  const lines = []
  lines.push('# v291 真机探针原始输出 [' + TAG + ']   dist=' + DIST)
  lines.push('')
  lines.push('| 角色 | 期望 | 实测 | 侧栏条目 |')
  lines.push('|---|---|---|---|')
  for (const role of Object.keys(ROLES)) {
    const got = results[role] || []
    lines.push('| ' + role + ' | ' + EXPECT[role].length + ' | ' + got.length + ' | ' + got.join(' ') + ' |')
  }
  lines.push('')
  lines.push('用例 2 深链 #/cron（staff）：最终 hash = ' + a.hash)
  lines.push('用例 2 页面提示：' + toastTxt)
  lines.push('用例 3 权限接口 500（boss）：实测 ' + g3.hrefs.length + ' 条菜单（期望 12 = fail-open）')
  lines.push('')
  lines.push('通过 ' + pass + ' / 失败 ' + fail)
  if (fails.length) { lines.push('失败项：'); fails.forEach(f => lines.push('  - ' + f)) }
  fs.writeFileSync(path.join(OUT, '探针-' + TAG + '-原始输出.txt'), lines.join('\n'), 'utf8')
  console.log('\n（原始输出已写入 ' + path.join(OUT, '探针-' + TAG + '-原始输出.txt') + '）')
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error('探针崩溃：', e); process.exit(2) })
