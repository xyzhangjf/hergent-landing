/* v390 侧栏重构 · 真机渲染验收探针（零写入）
 *
 * 判据分为六相：
 *   相1 桌面侧栏 8 项（2 直达 + 6 职能区）+ 逐角色可见性
 *   相2 职能区弹窗：空列**不出现** / 条目顺序 / L1「＋」出现与否（按 canDo fail-closed）
 *   相3 高亮唯一性（/forecast 三条 to 同 path 不同 query ⇒ 必须只亮一条）
 *   相4 手机端（375px）：底部栏 3+1 项 / 抽屉路标 / 无重复无空列
 *   相5 权限页域页签 = 侧栏 8 项 1:1（+「更多」）+ 「经营趋势」行的 entries 与 note **可并存**
 *   相6 反例对照：同一份探针跑**旧 dist**，判据必须给出相反结果
 *
 * 为什么零写入：全程用 `addScriptToEvaluateOnNewDocument` 在文档脚本之前把 `/api/**` 桩掉，
 * 并用**本机托管的 dist**（不是生产），所以不需要任何真实账号、不碰生产库、不发一个真实请求。
 *
 * 用法：
 *   node v390-sidebar-render-probe.mjs                       # 新产物（dist-v390-1-4）
 *   HG_TAG=old HG_DIST=…/dist-v389-1-3b node …               # 反例（旧产物）
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = '/Users/zhangjunfeng/Documents/laozhangai-product'
const DIST = process.env.HG_DIST || ROOT + '/hergent-cn-v2/dist-v390-1-4'
const TAG = process.env.HG_TAG || 'new'
const PORT = Number(process.env.HG_PORT || 8913)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/* ---- 后端真实数据（从 hergent-erp/server/core.py 用 AST 抽出，形状与线上接口一致） ---- */
const J = (f) => JSON.parse(fs.readFileSync('/tmp/' + f, 'utf8'))
const PERM_MODULES = J('v390-perm-modules.json')      // GET /api/permissions/modules
const PERM_ROLES = J('v390-perm-roles.json')          // GET /api/role-permissions
const PERM_DETAIL = J('v390-perm-detail.json')        // GET /api/role-permissions/detail

/* ---- 逐角色模块集（= core._DEFAULT_PERMS） ---- */
const MODS = Object.fromEntries(Object.entries(PERM_ROLES.roles).map(([r, v]) => [r, v.permissions]))
/* 🔴 形状必须与后端**逐字一致**：`permissions_detail` 是 `{模块: [动作...]}`（dict of **array**），
   不是 `{模块: {动作:1}}`。踩过：写成对象后 `canDo` 的 `Array.isArray(permActs[module])` 为假
   ⇒ 走 fail-closed 分支 ⇒ 全班角色都判"没有 create" ⇒ A/B 两侧同结果（探针作废）。
   admin 的 `_DEFAULT_PERMS` 是 `['*']`，后端 `user_module_actions` 会把它收敛成
   `{"*": ["read","create","update","delete"]}`（见 core.user_module_actions），照抄。 */
const ALLACT = ['read', 'create', 'update', 'delete']
const detailOf = (mods) => Array.isArray(mods) && mods.length === 1 && mods[0] === '*'
  ? { '*': [...ALLACT] }
  : Object.fromEntries(mods.map(m => [m, [...ALLACT]]))
const READONLY = (mods) => (mods.length === 1 && mods[0] === '*'
  ? { '*': ['read'] }
  : Object.fromEntries(mods.map(m => [m, ['read']])))

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }

/* 页面级 chunk 一律换成空 Vue 组件 —— 页面模板会逐层读深字段，喂假数据必然抛错，
   而 ErrorBoundary 会把整个 #app 换成错误卡片 ⇒ 侧栏消失 ⇒ 探针读到 0 条（严重误判）。
   ⚠️ 例外：`Settings` 必须是真的（相5 要数域页签）。 */
const STUB_RE = /^(Workbench|Forecast|Rebate|Archive|ArchiveShell|Dashboard|LossWorkflow|LossAccounting|PayrollWorkflow|BidRadar|CronJobs|AiHub|ConnectCenter|RoleManage|DataFill|PriceChannels|Inventory|ZhoupuImport|ImportReceipt|ImportMapping|Login)-/.source
const STUB_MODULE = Buffer.from('export default { name: "ProbeStub", render() { return null } }')

function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0])
    if (p === '/' || !path.extname(p)) p = '/index.html'
    const f = path.join(DIST, p)
    if (!f.startsWith(DIST) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end('nf'); return }
    if (/^\/assets\//.test(p) && new RegExp(STUB_RE).test(path.basename(p))) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); res.end(STUB_MODULE); return
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' })
    fs.createReadStream(f).pipe(res)
  })
  return new Promise(r => srv.listen(PORT, '127.0.0.1', () => r(srv)))
}

/* ---- 桩：登录态 + 逐接口回真实数据 ---- */
function INIT(role, opt = {}) {
  const mods = MODS[role] || []
  const acts = opt.acts || detailOf(mods)
  const customRoles = opt.customRoles === undefined ? [] : opt.customRoles
  const permStatus = opt.permStatus || 200
  return `(() => {
  var ROLE = ${JSON.stringify(role)};
  var PERMS = ${JSON.stringify(mods.includes('*') ? ['*'] : mods)};
  var ACTS = ${JSON.stringify(acts)};
  var CUSTOM = ${JSON.stringify(customRoles)};
  var PS = ${permStatus};
  try {
    localStorage.setItem('hergent_v2_token', 'V390-PROBE-NOT-REAL');
    localStorage.setItem('hergent_v2_tenant', '1');
    localStorage.setItem('hergent_v2_user', JSON.stringify({ id: 1, username: 'probe', display_name: '探针', role: ROLE, roles: [ROLE] }));
  } catch (e) {}
  var MD = ${JSON.stringify(PERM_MODULES)};
  var RL = ${JSON.stringify(PERM_ROLES)};
  var DT = ${JSON.stringify(PERM_DETAIL)};
  function j(o) { return new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  var orig = window.fetch.bind(window);
  window.__stubHit = {};
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : ((input && input.url) || '');
    var hit = function (k) { window.__stubHit[k] = (window.__stubHit[k] || 0) + 1; };
    if (/\\/api\\/auth\\/permissions/.test(url)) {
      hit('perm');
      if (PS !== 200) return new Response('boom', { status: PS });
      return j({ user: { id: 1, username: 'probe', display_name: '探针', role: ROLE, roles: [ROLE] },
                 permissions: PERMS, permissions_detail: ACTS, custom_roles: CUSTOM,
                 perms_rev: 'probe-rev-1', tenant_id: 1, plan: 'free',
                 capabilities: { view: true, export: true } });
    }
    if (/\\/api\\/auth\\/perms-rev/.test(url)) { hit('rev'); return j({ perms_rev: 'probe-rev-1' }); }
    if (/\\/api\\/auth\\/me/.test(url)) { hit('me'); return j({ user: { id: 1, username: 'probe', display_name: '探针', role: ROLE } }); }
    if (/\\/api\\/role-permissions\\/detail/.test(url)) { hit('detail'); return j(DT); }
    if (/\\/api\\/role-permissions/.test(url)) { hit('roles'); return j(RL); }
    if (/\\/api\\/permissions\\/modules/.test(url)) { hit('modules'); return j(MD); }
    if (/\\/api\\//.test(url)) { hit('other'); return j([]); }
    return orig(input, init);
  };
})()`
}

/* ---- 页面内取数 ---- */
const READ_NAV = `(() => {
  const nav = document.querySelector('.sb-nav');
  if (!nav) return JSON.stringify({ err: 'no .sb-nav' });
  const out = [];
  for (const el of Array.from(nav.children)) {
    if (el.matches('a.sb-item')) out.push({ kind: 'link', name: (el.textContent||'').trim(), href: el.getAttribute('href') });
    else if (el.matches('.sb-area')) out.push({ kind: 'area', name: (el.querySelector('.sb-area-btn')||{}).textContent?.trim() || '', open: el.classList.contains('open') });
  }
  return JSON.stringify(out);
})()`

const OPEN_AREA = (name) => `(() => {
  const a = Array.from(document.querySelectorAll('.sb-nav .sb-area')).find(x => {
    const t = x.querySelector('.sb-area-btn'); return t && t.textContent.includes(${JSON.stringify(name)});
  });
  if (!a) return 'no-area';
  a.querySelector('.sb-area-btn').click();
  return 'clicked';
})()`

const READ_POP = `(() => {
  const pop = document.querySelector('.sb-pop');
  if (!pop) return JSON.stringify({ err: 'no .sb-pop' });
  const heads = Array.from(pop.querySelectorAll('.sb-pop-hd')).map(x => x.textContent.trim());
  const rows = Array.from(pop.querySelectorAll('.sb-pop-row')).map(r => {
    const it = r.querySelector('.sb-pop-item');
    const nw = r.querySelector('.sb-pop-new');
    return { name: it ? it.textContent.trim() : '', href: it ? it.getAttribute('href') : '',
             cur: it ? it.classList.contains('cur') : false,
             create: nw ? { text: nw.textContent.trim(), title: nw.getAttribute('title'), href: nw.getAttribute('href') } : null };
  });
  return JSON.stringify({ heads, rows });
})()`

const READ_CLOSE_POP = `(() => { const b=document.querySelector('.sb-pop'); if(b){ const o=b.parentElement; } document.body.click(); return 'ok'; })()`

const READ_MOBILE = `(() => {
  const mnav = Array.from(document.querySelectorAll('.mnav .mnav-item')).map(x => (x.textContent||'').trim());
  const sheet = document.querySelector('.md-sheet');
  const hd = sheet ? Array.from(sheet.querySelectorAll('.md-group-hd')).map(x => x.textContent.trim()) : [];
  const items = sheet ? Array.from(sheet.querySelectorAll('.md-item')).map(x => (x.textContent||'').trim()) : [];
  return JSON.stringify({ mnav, hd, items });
})()`

const READ_TABS = `(() => {
  const t = Array.from(document.querySelectorAll('.domtabs button')).map(b => ({
    txt: (b.textContent || '').replace(/[0-9]+$/, '').trim(),
    raw: (b.textContent || '').trim()
  }));
  const tr = Array.from(document.querySelectorAll('.perm-detail-table tbody tr'));
  const names = tr.map(r => { const l = r.querySelector('.pm-mod-lb'); return l ? l.textContent.trim() : ''; });
  return JSON.stringify({ tabs: t, rows: names });
})()`

const READ_ROW_DETAIL = (rowName) => `(() => {
  const tr = Array.from(document.querySelectorAll('.perm-detail-table tbody tr'))
    .find(r => { const l = r.querySelector('.pm-mod-lb'); return l && l.textContent.trim() === ${JSON.stringify(rowName)}; });
  if (!tr) return JSON.stringify({ err: 'no row ' + ${JSON.stringify(rowName)} });
  const notes = Array.from(tr.querySelectorAll('.pm-mod-pages')).map(x => x.textContent.trim());
  const cbs = tr.querySelectorAll('input[type=checkbox]').length;
  return JSON.stringify({ notes, checkboxCount: cbs, fixed: !!tr.querySelector('.pm-mod-fixed') });
})()`

let pass = 0, fail = 0
let createCountFull = -1      // 相2 A/B：全动作权限下「＋」的个数（必须为 1）
const fails = []
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra !== undefined ? '  [' + extra + ']' : '')) }
  else { fail++; fails.push(label + '  [' + extra + ']'); console.log('  ❌ ' + label + (extra !== undefined ? '  [' + extra + ']' : '')) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const NAV_NEW = ['经营工作台', '预报订单管理', '进销存', '目标与返利', '核算', '经营分析', '档案管理', '系统']
const TABS_NEW = ['工作台', '预报订单', '进销存', '返利', '核算', '分析', '档案', '系统', '更多']

async function main() {
  console.log('=== v390 侧栏重构 · 真机渲染验收 [' + TAG + '] ===')
  console.log('dist = ' + DIST + '\n')
  const srv = await serve()
  const browser = await launch({ headless: true, port: PORT + 1 })
  const page = await browser.newPage()
  await page.enable()
  const base = 'http://127.0.0.1:' + PORT
  const shots = []
  const shot = async (n) => { const p = ROOT + '/outputs/侧栏重构-v390-2026-10-07/' + TAG + '-' + n + '.png'; fs.mkdirSync(path.dirname(p), { recursive: true }); await page.screenshot(p); shots.push(p); return p }

  /* 桌面视口 */
  await page.raw.send('Emulation.setDeviceMetricsOverride', { width: 1512, height: 950, deviceScaleFactor: 1, mobile: false })

  /* ==================== 相1：桌面侧栏逐角色 ==================== */
  console.log('──── 相1：桌面侧栏 8 项 + 逐角色可见性 ────')
  const navs = {}
  for (const role of Object.keys(MODS)) {
    const id = await page.addInitScript(INIT(role))
    await page.goto(base + '/?r=' + role + '#/workbench', 2600)
    let raw = '[]'
    for (let i = 0; i < 12; i++) {
      raw = await page.eval(READ_NAV)
      if (JSON.parse(raw).length > 0 && i >= 3) break
      await sleep(400)
    }
    await page.removeInitScript(id)
    navs[role] = JSON.parse(raw)
    console.log('  【' + role + '】' + navs[role].map(x => x.name + (x.kind === 'area' ? '›' : '')).join(' '))
    ok(role + ' 侧栏无 console 错误', page.errors.length === 0, page.errors.slice(0, 2).join(' | '))
    page.errors.length = 0
  }
  const namesOf = (r) => navs[r].map(x => x.name)
  if (TAG === 'new') {
    ok('admin 一级项 = 8 项且名称/顺序与 NAV 一致', eq(namesOf('admin'), NAV_NEW), namesOf('admin').join(' '))
    ok('boss  一级项 = 8 项且名称/顺序与 NAV 一致', eq(namesOf('boss'), NAV_NEW), namesOf('boss').join(' '))
    ok('直达项恰 2 个（经营工作台 / 目标与返利）',
       eq(navs.boss.filter(x => x.kind === 'link').map(x => x.name), ['经营工作台', '目标与返利']),
       JSON.stringify(navs.boss.filter(x => x.kind === 'link').map(x => x.href)))
    ok('职能区恰 6 个', navs.boss.filter(x => x.kind === 'area').length === 6, navs.boss.filter(x => x.kind === 'area').length)
    ok('「进销存」只对 admin/boss 可见（窄闸门 module:inventory）',
       namesOf('admin').includes('进销存') && namesOf('boss').includes('进销存') &&
       !['accountant', 'sales', 'guide', 'driver', 'staff', 'supervisor', 'distributor'].some(r => namesOf(r).includes('进销存')),
       ['accountant', 'sales', 'guide', 'supervisor'].map(r => r + ':' + namesOf(r).includes('进销存')).join(' '))
    ok('sales 看不到「预报订单管理」（无 forecast 模块，但它有 data）', !namesOf('sales').includes('预报订单管理'), namesOf('sales').join(' '))
    ok('accountant 可见「预报订单管理」+「核算」+「档案管理」',
       namesOf('accountant').includes('预报订单管理') && namesOf('accountant').includes('核算') && namesOf('accountant').includes('档案管理'), namesOf('accountant').join(' '))
    ok('guide（仅 workbench 透传）侧栏只剩 1 项', namesOf('guide').length === 1, namesOf('guide').join(' '))
  } else {
    ok('[反例] 旧产物**没有** 8 项平铺', !eq(namesOf('boss'), NAV_NEW), namesOf('boss').join(' '))
    /* ⚠️ 措辞要准：旧产物**有**一个叫「进销存」的入口，但它是**平铺直达项**（`.sb-item` 链接），
       不是职能区（`.sb-area`）。判别点是 `kind`，不是"名字在不在" ——
       第一版写成"看不到进销存"直接假红，属于判据写错而不是产物有问题。 */
    const oldPsi = navs.boss.find(x => x.name === '进销存')
    ok('[反例] 旧产物的「进销存」是平铺直达项（不是职能区）', !!oldPsi && oldPsi.kind === 'link', JSON.stringify(oldPsi))
    /* ⚠️ v388 已经把「档案管理」升级成职能区 ⇒ 旧产物有 **1 个** 职能区，不是 0 个。
       第一版写成 `=== 0` 直接假红（判据写错，不是产物有问题）。
       ⇒ 反例的正确形态是「**边界值相反**」：旧 1 个 → 新 6 个。 */
    const oldAreas = navs.boss.filter(x => x.kind === 'area').map(x => x.name)
    ok('[反例] 旧产物只有 1 个职能区（v388 只升级了档案管理）', eq(oldAreas, ['档案管理']), oldAreas.join(','))
  }
  await shot('01-侧栏-boss')

  /* ==================== 相2：弹窗 / 空列 / L1 ＋ ==================== */
  console.log('\n──── 相2：职能区弹窗 · 空列 · L1「＋」────')
  {
    const id = await page.addInitScript(INIT('boss'))
    await page.goto(base + '/?p=boss-pop#/workbench', 2600)
    await sleep(600)
    /* 进销存：区内三条子项挂**宽模块** stock ⇒ 若不设 path 闸门，业务员也会看到这个区。
       这里验的是**渲染结果**：采购/销售/往来三列 items 为空 ⇒ 必须不出现 */
    const c1 = await page.eval(OPEN_AREA('进销存'))
    await sleep(500)
    const pop = JSON.parse(await page.eval(READ_POP))
    await page.removeInitScript(id)
    console.log('    进销存 表头 = ' + JSON.stringify(pop.heads || null))
    console.log('    进销存 条目 = ' + JSON.stringify((pop.rows || []).map(r => r.name)))
    ok('点开「进销存」弹窗出现', TAG !== 'new' ? c1 === 'no-area' : (c1 === 'clicked' && !pop.err), c1)
    if (TAG === 'new') {
      ok('进销存 空列不出现（只剩 库存 / 其他）', eq(pop.heads, ['库存', '其他']), (pop.heads || []).join(','))
      ok('进销存 条目 = 库存效期补录 / 进销存总览', eq((pop.rows || []).map(r => r.name), ['库存效期补录', '进销存总览']), (pop.rows || []).map(r => r.name).join(','))
      ok('进销存 两条都无「＋」（这两条本身不是"新建"入口）', (pop.rows || []).every(r => !r.create), JSON.stringify((pop.rows || []).map(r => !!r.create)))
    } else {
      ok('[反例] 旧产物点不出「进销存」职能区（它是直达项，没有 .sb-area）', c1 === 'no-area', c1)
    }
    await shot('02-进销存弹窗')
  }
  {
    const id = await page.addInitScript(INIT('boss'))
    await page.goto(base + '/?p=boss-forecast#/workbench', 2600)
    await sleep(600)
    await page.eval(OPEN_AREA('预报订单管理'))
    await sleep(500)
    const pop = JSON.parse(await page.eval(READ_POP))
    await page.removeInitScript(id)
    const rowsF = pop.rows || []
    console.log('    预报订单管理 表头 = ' + JSON.stringify(pop.heads || null) + ' 条目 = ' + JSON.stringify(rowsF.map(r => r.name)))
    if (TAG === 'new') {
      ok('预报订单管理 条目顺序 = 历史期次/报单配置/商品目标', eq(rowsF.map(r => r.name), ['历史期次', '报单配置', '商品目标']), rowsF.map(r => r.name).join(','))
      ok('条目 href 带页内页签（?tab=）', rowsF.every(r => /\?tab=/.test(r.href || '')), JSON.stringify(rowsF.map(r => r.href)))
      const withNew = rowsF.filter(r => r.create)
      createCountFull = withNew.length
      ok('boss 档 A：「历史期次」带「＋」且 title 正确', withNew.length === 1 && withNew[0].name === '历史期次' && /新建本期预报/.test(withNew[0].create.title || ''), JSON.stringify(withNew.map(r => r.name + ':' + r.create.title)))
    } else {
      ok('[反例] 旧产物侧栏无「＋」（没有 create 双入口概念）', rowsF.length === 0 || rowsF.every(r => !r.create), JSON.stringify(rowsF.map(r => !!r.create)))
    }
    await shot('03-预报订单管理弹窗')
  }
  {
    /* A/B：同一角色、同一入口，只把 data 的动作轴收成只读 ⇒ 「＋」必须消失（fail-closed） */
    const id = await page.addInitScript(INIT('boss', { acts: READONLY(MODS.boss) }))
    await page.goto(base + '/?p=boss-ro#/workbench', 2600)
    await sleep(600)
    await page.eval(OPEN_AREA('预报订单管理'))
    await sleep(500)
    const pop = JSON.parse(await page.eval(READ_POP))
    await page.removeInitScript(id)
    const rowsRO = pop.rows || []
    const n = rowsRO.filter(r => r.create).length
    console.log('    只读动作轴下「＋」数 = ' + n + ' / 条目数 = ' + rowsRO.length)
    if (TAG === 'new') {
      ok('动作轴只给 read ⇒ 条目仍在、但「＋」为 0（fail-closed 生效）', rowsRO.length === 3 && n === 0, n)
      ok('同一份权限下条目名不变（证明收的是按钮不是入口）', eq(rowsRO.map(r => r.name), ['历史期次', '报单配置', '商品目标']), rowsRO.map(r => r.name).join(','))
      /* 🔴 A/B 必须**两条一起看**：全动作 1 个 vs 只读 0 个。
         只验"只读时为 0"没有判别力 —— 探针 payload 形状写错时两边都是 0，会假绿
         （本轮真的踩到：payload 用了对象而非数组 ⇒ 两侧都是 0 ⇒ 第一条假绿）。 */
      ok('A/B 对照：全动作 1 个 vs 只读 0 个（两侧结果必须相反）',
         createCountFull === 1 && n === 0, 'full=' + createCountFull + ' read=' + n)
    } else {
      ok('[反例] 旧产物连职能区都没有 ⇒ 这两条（条目仍在 / A-B 相反）无从成立',
         rowsRO.length === 0 && createCountFull === -1, 'rows=' + rowsRO.length + ' full=' + createCountFull)
    }
  }

  /* ==================== 相3：高亮唯一 ==================== */
  console.log('\n──── 相3：高亮唯一性（同一 path 三条 to）────')
  {
    const id = await page.addInitScript(INIT('boss'))
    await page.goto(base + '/?p=hl#/forecast?tab=config', 3000)
    await sleep(800)
    await page.eval(OPEN_AREA('预报订单管理'))
    await sleep(500)
    const pop = JSON.parse(await page.eval(READ_POP))
    await page.removeInitScript(id)
    const cur = (pop.rows || []).filter(r => r.cur).map(r => r.name)
    console.log('    /forecast?tab=config 下 .cur 条目 = ' + JSON.stringify(cur))
    if (TAG === 'new') {
      ok('高亮恰 1 条（不是三条一起亮）', cur.length === 1, JSON.stringify(cur))
      ok('高亮的是「报单配置」', cur[0] === '报单配置', cur.join(','))
    } else {
      ok('[反例] 旧产物没有职能区高亮（.cur 机制不存在）', cur.length === 0, JSON.stringify(cur))
    }
    await shot('04-高亮唯一')
  }

  /* ==================== 相4：手机端 ==================== */
  console.log('\n──── 相4：手机端 375px ────')
  {
    await page.raw.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true })
    const id = await page.addInitScript(INIT('boss'))
    await page.goto(base + '/?p=m1#/workbench', 2800)
    await sleep(600)
    const m0 = JSON.parse(await page.eval(READ_MOBILE))
    console.log('    底部栏 = ' + JSON.stringify(m0.mnav.filter(x => x !== '更多')))
    /* 首项与末项两版相同；**第二项**是判别点 —— 旧产物的文案是「预报订**货**管理」。 */
    if (TAG === 'new') {
      ok('底部栏 = 3 个路径项 + 「更多」', eq(m0.mnav, ['经营工作台', '预报订单管理', '目标与返利', '更多']), m0.mnav.join(' '))
    } else {
      ok('[反例] 旧产物底部栏第二项仍是旧名「预报订货管理」', eq(m0.mnav, ['经营工作台', '预报订货管理', '目标与返利', '更多']), m0.mnav.join(' '))
    }
    await page.eval(`(() => { const b = Array.from(document.querySelectorAll('.mnav .mnav-item')).find(x => x.textContent.includes('更多')); if (b) b.click(); return 'ok'; })()`)
    await sleep(600)
    const m1 = JSON.parse(await page.eval(READ_MOBILE))
    await page.removeInitScript(id)
    console.log('    抽屉路标 = ' + JSON.stringify(m1.hd))
    console.log('    抽屉条目 = ' + JSON.stringify(m1.items))
    ok('抽屉出现且有条目', m1.items.length > 0, m1.items.length)
    ok('抽屉无空路标（无组名的组不渲染标题）', !m1.hd.includes(''), JSON.stringify(m1.hd))
    ok('抽屉条目无重复', new Set(m1.items).size === m1.items.length, m1.items.length + '/' + new Set(m1.items).size)
    ok('底部栏三项不出现在抽屉里', !m1.items.includes('经营工作台') && !m1.items.includes('预报订单管理') && !m1.items.includes('目标与返利'), JSON.stringify(m1.items.filter(x => ['经营工作台', '预报订单管理', '目标与返利'].includes(x))))
    if (TAG === 'new') {
      ok('抽屉路标 = 职能区自己的名字（8 项平铺后当路标）', m1.hd.includes('进销存') && m1.hd.includes('档案管理'), JSON.stringify(m1.hd))
      ok('手机端本轮无「＋」（刻意不做，避免死分支）', !m1.items.some(x => x.includes('创建')), JSON.stringify(m1.items.filter(x => x.includes('创建'))))
    }
    await shot('05-手机抽屉')
    await page.raw.send('Emulation.setDeviceMetricsOverride', { width: 1512, height: 950, deviceScaleFactor: 1, mobile: false })
  }

  /* ==================== 相5：权限页域页签 ==================== */
  console.log('\n──── 相5：权限页域页签 = 侧栏 8 项 1:1 ────')
  {
    const id = await page.addInitScript(INIT('boss'))
    await page.goto(base + '/?p=perm#/settings', 3000)
    await sleep(900)
    const clicked = await page.eval(`(() => {
      const b = Array.from(document.querySelectorAll('.module-tabs button')).find(x => x.textContent.trim() === '权限');
      if (!b) return 'no-tab';
      b.click(); return 'ok';
    })()`)
    await sleep(900)
    const cr = await page.eval(`(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === '配置权限');
      if (!b) return 'no-role-btn';
      b.click(); return 'ok';
    })()`)
    await sleep(1200)
    const d = JSON.parse(await page.eval(READ_TABS))
    console.log('    域页签 = ' + JSON.stringify(d.tabs.map(t => t.raw)))
    await page.removeInitScript(id)
    ok('进到权限页 → 角色列表 → 详情（两步都点到）', clicked === 'ok' && cr === 'ok', clicked + '/' + cr)
    if (TAG === 'new') {
      ok('域页签 = 8 项 + 「更多」（9 个）', d.tabs.length === 9, d.tabs.length)
      ok('页签短名逐项同序 = 侧栏 8 项', eq(d.tabs.map(t => t.txt), TABS_NEW), d.tabs.map(t => t.txt).join(' / '))
    } else {
      ok('[反例] 旧产物域页签不是 9 个', d.tabs.length !== 9, d.tabs.length + ' 个：' + d.tabs.map(t => t.raw).join(','))
    }
    /* 切到「分析」域，验「经营趋势」行 */
    await page.eval(`(() => {
      const b = Array.from(document.querySelectorAll('.domtabs button')).find(x => x.textContent.trim().startsWith('分析'));
      if (b) b.click(); return 'ok';
    })()`)
    await sleep(700)
    const rd = JSON.parse(await page.eval(READ_ROW_DETAIL('经营趋势')))
    console.log('    「经营趋势」行 = ' + JSON.stringify(rd))
    await shot('06-权限页-分析域')
    if (TAG === 'new') {
      ok('「经营趋势」行存在（行名已改）', !rd.err, JSON.stringify(rd).slice(0, 120))
      ok('该行 entries 与 note **可并存**（两条都在）',
         (rd.notes || []).some(t => /首页的今日销售额/.test(t)) && (rd.notes || []).some(t => /今日待办/.test(t)),
         JSON.stringify(rd.notes))
      ok('该行可勾（4 个动作复选框）', rd.checkboxCount === 4, rd.checkboxCount)
    } else {
      ok('[反例] 旧产物没有「经营趋势」行（叫「经营看板」）', !!rd.err, JSON.stringify(rd).slice(0, 120))
    }
  }

  await browser.close()
  srv.close()

  console.log('\n\n========== 汇总 [' + TAG + '] ==========')
  console.log('通过 ' + pass + ' / 失败 ' + fail)
  if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log('  - ' + f)) }
  console.log('截图：' + shots.length + ' 张')
  shots.forEach(s => console.log('  ' + s))
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error('探针崩溃：', e); process.exit(2) })
