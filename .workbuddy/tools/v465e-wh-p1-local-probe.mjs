/**
 * v465e-wh-p1-local-probe.mjs —— 仓配管理 P1（仓库作业 6 页落真身）**本地**只读探针
 *
 * 为什么是「本地」而不是打生产：本轮用户明确要求「开发完成后不提交、不部署，
 * 保留在本地待命」⇒ 生产上还没有这 6 页，打生产只能证明"还没上线"。
 * 于是改为打**本地构建产物**（`vite build --outDir /tmp/v465e-fe`）+ **打桩 fetch**，
 * 断言的是「这 6 页在真实构建产物里能被路由到、能挂载、模板能渲染、零运行时错误」。
 *
 * 🔴 打桩不是"美化结果"，而是**唯一能在无后端时把页面推到"正常态"的手段**：
 *    不打桩 ⇒ 守卫 `loadPerms()` 失败会 fail-open（放行）、页面进 `.state-error`，
 *    那时"零 console 错误"变成弱断言（错误态本身就把页面吞了）。
 *    打桩后页面走的是**正常骨架分支**：KPI 条 / 筛选栏 / 空态 / 分页器全部真实渲染。
 *
 * 🔴 **反例自证**（判据有效性的证据，不是装饰）：同一模块里仍在占位的 `/wh/pnl`
 *    必须落在「开发中」骨架（`.ph-card`）且**没有** `.page-hd h2` 之外的业务控件。
 *    若判据把占位页也判成"已落真身"，整个探针就没有判别力。
 *
 * 只读：只 GET 静态资源（本地），零写请求、零生产流量。
 * 用法：node .workbuddy/tools/v465e-wh-p1-local-probe.mjs
 */
import { launch } from './lib/cdp-lite.mjs'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const DIST = process.env.DIST || '/tmp/v465e-fe'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v465e-wh-p1'
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.log(`缺少构建产物：${DIST}/index.html（先跑 vite build --outDir ${DIST}）`)
  process.exit(2)
}
fs.mkdirSync(SHOT_DIR, { recursive: true })

/* ---------------- 极简静态服务器（只服务构建产物） ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.map': 'application/json',
}
const server = http.createServer((req, res) => {
  const u = decodeURIComponent((req.url || '/').split('?')[0])
  let f = path.join(DIST, u === '/' ? 'index.html' : u)
  if (!f.startsWith(DIST)) { res.writeHead(403); return res.end() }
  try {
    const buf = fs.readFileSync(f)
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' })
    res.end(buf)
  } catch {
    // 静态资源找不到 ⇒ 不是 SPA 路由问题（hash 路由不产生新请求），直接 404
    res.writeHead(404); res.end('not found')
  }
})
const PORT = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)))
const BASE = `http://127.0.0.1:${PORT}/`
console.log(`静态服务器 ${BASE}  →  ${DIST}`)

/* ---------------- boot 期注入：token + 打桩 fetch ----------------
   🔴 必须走 `addInitScript`（在**文档的任何脚本之前**执行）：`store.loadPerms()` 是
      boot 期发的请求，导航完再改 `window.fetch` 就打不进去了（v267 踩过）。 */
const INIT = `
(function(){
  try { localStorage.setItem('hergent_v2_token','probe-local-token'); } catch(e){}
  try { localStorage.setItem('hergent_v2_tenant','1'); } catch(e){}
  var ROUTES = [
    ['/api/auth/permissions', {
      permissions: ['*','stock','data','crm','inventory','funds','hr','payroll','loss','ai'],
      user: { role:'boss', roles:['boss'], display_name:'本地探针' },
      plan:'pro', capabilities:{}, perms_rev:'probe',
      custom_roles: [],
      permissions_detail: { '*': ['*'] }
    }],
    ['/api/auth/perms-rev', { perms_rev:'probe' }],
    ['/api/wms/cross-dock', { warehouse_id:1, inbound_items:0, outbound_items:0,
                              cross_dock_opportunities:0, opportunities:[] }],
    /* 给两条仓库 + 一个商品：不是为了"好看"，而是为了让**下拉有选项**——
       select 无选项时是空框，看不出宽度对不对（v465e 修过一个「下拉吃满整行」的
       CSS 问题，正是靠这里有选项才量得出来）。 */
    ['/api/warehouses', { data: [
      { id:1, name:'总仓' }, { id:2, name:'低温二仓' }
    ] }],
    ['/api/products', { items: [
      { id:1, name:'蒙牛特仑苏纯牛奶', spec:'250ml×12', unit:'箱', barcode:'6901000001' },
      { id:2, name:'蒙牛纯甄酸牛奶',   spec:'200g×12',  unit:'箱', barcode:'6901000002' }
    ], total: 2 }],
    /* 🔴 联系人必须给：openCreate() 的前置检查是「供应商没加载到就拦住并 toast」——
       桩不给数据时弹窗**压根不会开**（这正是它该有的行为，不是 bug）。
       第一版探针就栽在这：点得到按钮、却以为"弹窗坏了"。 */
    ['/api/contacts', { items: [
      { id:11, name:'东津门店', code:'C001' }, { id:12, name:'吾悦门店', code:'C002' },
      { id:21, name:'蒙牛乳业湖北', code:'S001' }, { id:22, name:'恒滋食品', code:'S002' }
    ], total: 4 }],
    ['/api/expiry/forecast', { data: [] }],
    ['/api/vehicles', { data: [] }],
    ['/api/inventory/low-stock', { data: [] }]
  ];
  window.__probe = { calls: [] };
  window.fetch = function(input, init){
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    var path = url.replace(/^https?:\\/\\/[^/]+/, '').split('?')[0];
    window.__probe.calls.push(path);
    var body = null;
    for (var i=0;i<ROUTES.length;i++){ if (path === ROUTES[i][0]) { body = ROUTES[i][1]; break; } }
    if (body === null) body = { ok:true, success:true, data: [], items: [], total: 0 };
    return Promise.resolve(new Response(JSON.stringify(body),
      { status: 200, headers: { 'content-type': 'application/json' } }));
  };
})();
`

const CASES = [
  { name: '入库单', hash: '#/wh/inbound', title: '入库单', land: '.win-acts', real: true },
  { name: '出库单', hash: '#/wh/outbound', title: '出库单', land: '.wob-acts', real: true },
  { name: '盘点单', hash: '#/wh/stocktake', title: '盘点单', land: '.wst-acts', real: true },
  { name: '出入库策略', hash: '#/wh/strategy', title: '出入库策略', land: '.wsp-panels', real: true },
  { name: '其它入库单', hash: '#/wh/other-in', title: '其它入库单', land: '.woi-acts', real: true },
  { name: '其它出库单', hash: '#/wh/other-out', title: '其它出库单', land: '.woi-acts', real: true },
  /* 反例自证：同模块、**仍是占位页** ⇒ 必须落在「开发中」骨架，而不是真页 */
  { name: '损益单（仍是占位）', hash: '#/wh/pnl', title: '损益单', land: '.ph-card', real: false },
]

let pass = 0, fail = 0
const browser = await launch({ headless: true })
for (const c of CASES) {
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(INIT)
  try {
    await page.goto(BASE + c.hash, 3000)
    const raw = await page.eval(`(function(){
      var h2 = document.querySelector('.page-hd h2');
      var root = document.querySelector('.page, .ph-card');
      var classes = [];
      if (root) { var it = root.querySelectorAll('*'); }
      return JSON.stringify({
        href: location.href,
        h2: h2 ? h2.textContent.trim() : '',
        hasPage: !!document.querySelector('.page'),
        hasLandmark: !!document.querySelector(${JSON.stringify(c.land)}),
        hasPhCard: !!document.querySelector('.ph-card'),
        hasErrState: !!document.querySelector('.state-error'),
        errText: ((document.querySelector('.state-error')||{}).innerText||'').slice(0,120),
        kpi: document.querySelectorAll('.kpi-strip .kpi').length,
        tblRows: document.querySelectorAll('table.tbl tbody tr').length,
        emptyState: !!document.querySelector('.state-empty'),
        selW: (function(){ var s=document.querySelector('.wsp-sel'); return s ? Math.round(s.getBoundingClientRect().width) : -1; })(),
        phText: (function(){
          var s=document.querySelector('.wsp-p .ipn-v.is-ph');
          if(!s) return '';
          try { return getComputedStyle(s,'::before').content || ''; } catch(e){ return ''; }
        })(),
        barNoteNextLine: (function(){
          var b=document.querySelector('.wsp-bar'), n=document.querySelector('.wsp-bar-note'), s=document.querySelector('.wsp-sel');
          if(!b||!n||!s) return null;
          return n.getBoundingClientRect().top > s.getBoundingClientRect().bottom - 2;
        })(),
        probeCalls: (window.__probe && window.__probe.calls.length) || 0
      });
    })()`)
    const d = JSON.parse(raw)
    const errs = page.errors || []
    const checks = [
      ['标题逐字命中', d.h2 === c.title],
      [`页根渲染`, d.hasPage],
      [`关键地标在(${c.land})`, d.hasLandmark],
      ['零 console 错误', errs.length === 0],
    ]
    if (c.real) {
      checks.push(['不是占位骨架', d.hasPhCard === false])
      checks.push(['未落入错误态（打桩后应走正常分支）', d.hasErrState === false])
      checks.push(['boot 期确已发出接口请求（桩被打到）', d.probeCalls > 0])
    } else {
      checks.push(['确为占位骨架', d.hasPhCard === true])
    }
    if (c.hash === '#/wh/strategy') {
      /* 钉住 v465e 修掉的那个布局问题：全局 `.input{width:100%}` 让这个下拉吃掉整行、
         把右侧说明挤到下一行。加 `flex:none` + 显式宽度后应稳定在 220px 且说明同排。 */
      checks.push([`仓库下拉宽度受控（实测 ${d.selW}px，应 ≈220）`, d.selW > 200 && d.selW < 245])
      checks.push(['说明文字与下拉同排（没被挤到下一行）', d.barNoteNextLine === false])
      checks.push([`商品未选中时有可见占位文案（实测 "${d.phText}"）`, d.phText.includes('点击搜索商品')])
    }
    const bad = checks.filter(x => !x[1]).map(x => x[0])
    const ok = bad.length === 0
    ok ? pass++ : fail++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}   ${d.href.replace(BASE, '')}`)
    console.log(`      h2="${d.h2}" KPI=${d.kpi} 表格行=${d.tblRows} 空态=${d.emptyState} `
      + `占位卡=${d.hasPhCard} 错误态=${d.hasErrState} 桩请求=${d.probeCalls}`)
    if (d.hasErrState && d.errText) console.log(`      错误态文案：${d.errText}`)
    if (bad.length) console.log(`      ✗ ${bad.join(' / ')}`)
    if (errs.length) console.log(`      console: ${errs.slice(0, 3).join(' | ')}`)
    await page.screenshot(path.join(SHOT_DIR, `${c.name}.png`)).catch(() => {})
  } catch (e) {
    fail++
    console.log(`FAIL  ${c.name}  异常: ${e.message}`)
  }
}
/* ---------------- 弹窗用例：新建入库单（验 WhDialog + WhItems + ProductCombo 真挂载）
   🔴 为什么必须单独一例：`WhDialog.vue` / `WhItems.vue` 是**四张单据共用**的组件
      （入/出库单 + 其它出入库），它们上面的「零 console 错误」在列表页里**覆盖不到**
      —— 列表页根本不渲染弹窗。不点开就等于这两个组件没被验证过。 */
{
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(INIT)
  try {
    await page.goto(BASE + '#/wh/inbound', 3000)
    const opened = await page.eval(`(function(){
      var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      var b = btns.filter(function(x){ return x.textContent.indexOf('新建入库单') >= 0 })[0];
      if (!b) return 'no-button';
      b.click();
      return 'clicked';
    })()`)
    await new Promise(r => setTimeout(r, 900))
    /* 轮询等弹窗出现（`openCreate` 是同步置 `dlg=true`，但要等 Vue 下一帧渲染） */
    for (let i = 0; i < 20; i++) {
      if (await page.eval('!!document.querySelector(".whd-dlg")')) break
      await new Promise(r => setTimeout(r, 150))
    }
    const raw = await page.eval(`(function(){
      var dlg = document.querySelector('.whd-dlg');
      var tbl = document.querySelector('.whi-tbl');
      var sel = document.querySelector('.whd-dlg select');
      var ph = document.querySelector('.whi .ipn-v.is-ph');
      return JSON.stringify({
        opened: ${JSON.stringify(opened)},
        hasDlg: !!dlg,
        dlgTitle: ((document.querySelector('.whd-title')||{}).textContent||'').trim(),
        rows: tbl ? tbl.querySelectorAll('tbody tr').length : -1,
        whOptions: sel ? sel.querySelectorAll('option').length : -1,
        prodPh: ph ? (getComputedStyle(ph,'::before').content||'') : '',
        hasFooterSave: !!Array.prototype.slice.call(document.querySelectorAll('.whd-ft button'))
                          .filter(function(x){ return x.textContent.indexOf('保存草稿') >= 0 }).length,
        hasErr: !!document.querySelector('.state-error')
      });
    })()`)
    const d = JSON.parse(raw)
    const errs = page.errors || []
    const checks = [
      ['列表页有「新建入库单」按钮', d.opened === 'clicked'],
      ['弹窗已渲染', d.hasDlg === true],
      ['弹窗标题正确', d.dlgTitle === '新建入库单'],
      ['明细表默认 1 行（WhItems 的「至少一行」保证）', d.rows === 1],
      [`仓库下拉有选项（实测 ${d.whOptions}）`, d.whOptions >= 2],
      [`商品格显示占位「选择商品」（实测 "${d.prodPh}"）`, d.prodPh.includes('选择商品')],
      ['页脚有「保存草稿」', d.hasFooterSave === true],
      ['列表页未落入错误态', d.hasErr === false],
      ['零 console 错误', errs.length === 0],
    ]
    const bad = checks.filter(x => !x[1]).map(x => x[0])
    const ok = bad.length === 0
    ok ? pass++ : fail++
    console.log(`${ok ? 'PASS' : 'FAIL'}  新建入库单弹窗（WhDialog + WhItems + ProductCombo）`)
    console.log(`      标题="${d.dlgTitle}" 明细行=${d.rows} 仓库选项=${d.whOptions} 商品占位="${d.prodPh}"`)
    if (bad.length) console.log(`      ✗ ${bad.join(' / ')}`)
    if (errs.length) console.log(`      console: ${errs.slice(0, 3).join(' | ')}`)
    await page.screenshot(path.join(SHOT_DIR, '新建入库单弹窗.png')).catch(() => {})
  } catch (e) {
    fail++
    console.log(`FAIL  新建入库单弹窗  异常: ${e.message}`)
  }
}

await browser.close()
server.close()
console.log(`\n===== 汇总：PASS ${pass} / FAIL ${fail} =====`)
console.log(`截图：${SHOT_DIR}`)
process.exit(fail ? 1 : 0)