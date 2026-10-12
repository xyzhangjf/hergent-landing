/**
 * v465k-wh-p3-local-probe.mjs —— 仓配管理 P3（配送作业 3 页落真身）**本地**只读探针
 *
 * 分工同前两批：本地打桩 fetch 证明「页面能被路由到、模板能渲染、字段取真值」；
 * 上线后再跑 live 探针打真后端。
 *
 * 🔴 本轮的**特殊价值**：P3 的后端**全是既有端点**（8 个），而上一轮盘点曾误判
 *    「`/api/delivery/list` = 404 ⇒ 配送单后端不存在、要按新建估工」。
 *    所以本探针的桩数据**照抄真实列契约**（不是凭印象编）：
 *      · `delivery/board`  = date/drivers[]/unassigned[]/route_count/total_tasks
 *                            drivers[].{driver,vehicle_name,plate,orders[],routes[],task_count,total_amount}
 *      · `delivery-tasks`  = `sale_orders` 全列 + `customer_name` / `vehicle_name` / `plate`（JOIN 别名）
 *      · `delivery-routes` = `delivery_routes` 全列 + `stops[]`（`erp_db` 里挂上去的数组）
 *      · `delivery_stops`  = id/route_id/stop_order/contact_name/address/order_ids/status/delivered_at
 *      · `vehicles`        = id/name/plate/type/driver/phone
 *    哪个字段拼错，页面会以「格子里是 `—` / `#1` / `0`」暴露出来。
 *
 * 🔴 反例自证：仓配区 20 项**至此全数落真身**（无占位页可当反例）⇒ 反例改用
 *    **数据报表区的占位页** `/reports/sales-order`。判据仍要求「真页三条判据套上去全数失败」，
 *    否则「不是占位骨架 / 有 KPI / 有数据行」可能对任何页面恒真 = 零判别力。
 *
 * 只读：只 GET 本地构建资源 + 打桩响应，零写请求、零生产流量。
 * 用法：node .workbuddy/tools/v465k-wh-p3-local-probe.mjs
 */
import { launch } from './lib/cdp-lite.mjs'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const DIST = process.env.DIST || '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/dist-v465k'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v465k-wh-p3'
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.log(`缺少构建产物：${DIST}/index.html（先跑 vite build --outDir ${DIST}）`)
  process.exit(2)
}
fs.mkdirSync(SHOT_DIR, { recursive: true })

/* 静态服务：把构建产物当本地站点跑（不碰生产） */
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0])
  if (p === '/' || p.startsWith('/#')) p = '/index.html'
  const f = path.join(DIST, p)
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    /* SPA 回退：hash 路由下任何路径都回 index.html */
    const idx = path.join(DIST, 'index.html')
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(fs.readFileSync(idx))
    return
  }
  const ext = path.extname(f)
  const ct = ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/html'
  res.writeHead(200, { 'content-type': ct })
  res.end(fs.readFileSync(f))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}/`

/* ---------------- 桩数据（照抄后端真实列契约） ---------------- */
const TASKS = [
  { id: 1001, order_no: 'SO20261012001', customer_id: 7, customer_name: '永辉超市襄城店',
    address: '襄城区檀溪路 1 号', phone: '13900000001', total_amount: 1280.5,
    delivery_status: 'assigned', vehicle_id: 1, driver_id: '张三', vehicle_name: '冷藏车一号', plate: '鄂F12345',
    order_date: '2026-10-12 09:10:00', delivery_address: '襄城区檀溪路 1 号' },
  { id: 1002, order_no: 'SO20261012002', customer_id: 8, customer_name: '美廉宜城店',
    address: '宜城市振兴大道 8 号', phone: '13900000002', total_amount: 640,
    delivery_status: 'assigned', vehicle_id: 0, driver_id: '', vehicle_name: null, plate: null,
    order_date: '2026-10-12 09:20:00', delivery_address: '宜城市振兴大道 8 号' },
]
const BOARD = {
  date: '2026-10-12',
  drivers: [{
    driver: '张三', vehicle_name: '冷藏车一号', plate: '鄂F12345',
    orders: [TASKS[0]],
    routes: [{ id: 5, name: '襄城线-上午', status: 'pending', stops: 2 }],
    task_count: 1, total_amount: 1280.5,
  }],
  unassigned: [TASKS[1]],
  route_count: 1,
  total_tasks: 2,
}
const SALES = { orders: [
  { ...TASKS[0] },
  { ...TASKS[1], delivery_status: 'delivered' },
  { id: 1003, order_no: 'SO20261011009', customer_id: 9, customer_name: '中百仓储樊城店',
    total_amount: 2150, delivery_status: 'signed', vehicle_id: 1, driver_id: '张三',
    delivery_address: '樊城区长征路 22 号', order_date: '2026-10-11 15:00:00' },
  { id: 1004, order_no: 'SO20261011010', customer_id: 10, customer_name: '好邻居高新店',
    total_amount: 380, delivery_status: 'failed', vehicle_id: 1, driver_id: '张三',
    delivery_address: '高新区创业路 3 号', order_date: '2026-10-11 16:00:00' },
  /* 自提单：没有 delivery_status ⇒ 不该出现在「全部配送单」里（页内按此筛） */
  { id: 1005, order_no: 'SO20261011011', customer_id: 11, customer_name: '自提客户', total_amount: 120, delivery_status: '' },
], total: 5 }
const ROUTES = [{
  id: 5, name: '襄城线-上午', driver: '张三', vehicle_id: 1, date: '2026-10-12',
  status: 'pending', stops: '', notes: '', created_at: '2026-10-12 08:00:00',
  stops: [
    { id: 11, route_id: 5, stop_order: 1, contact_name: '永辉超市襄城店', address: '襄城区檀溪路 1 号',
      order_ids: '1001', status: 'pending', delivered_at: null, note: '', lat: 0, lng: 0 },
    { id: 12, route_id: 5, stop_order: 2, contact_name: '美廉宜城店', address: '宜城市振兴大道 8 号',
      order_ids: '1002', status: 'delivered', delivered_at: '2026-10-12 10:30:00', note: '', lat: 0, lng: 0 },
  ],
}]
const VEHICLES = [
  { id: 1, name: '冷藏车一号', plate: '鄂F12345', type: '冷藏', driver: '张三', phone: '13900000001' },
]

const STUB = `
(function(){
  /* 🔴 必须先塞 token：登录守卫在 boot 期就判，没有 token 会被重定向到 #/login
     ⇒ 所有用例都会变成"标题不命中 + 地标不在"，看起来像页面坏了，其实是探针没进门（v465k 踩过）。 */
  try { localStorage.setItem('hergent_v2_token','probe-local-token'); } catch(e){}
  try { localStorage.setItem('hergent_v2_tenant','1'); } catch(e){}
  var TASKS = ${JSON.stringify(TASKS)};
  var BOARD = ${JSON.stringify(BOARD)};
  var SALES = ${JSON.stringify(SALES)};
  var ROUTES = ${JSON.stringify(ROUTES)};
  var VEHICLES = ${JSON.stringify(VEHICLES)};
  var ROUTES_OUT = ${JSON.stringify(ROUTES)};

  var ROUTES_TABLE = [
    ['/api/auth/permissions', {
      permissions: ['*','stock','data','sales','crm','inventory','funds','hr','payroll','loss','ai'],
      user: { role:'boss', roles:['boss'], display_name:'本地探针' },
      plan:'pro', capabilities:{}, perms_rev:'probe',
      custom_roles: [], permissions_detail: { '*': ['*'] }
    }],
    ['/api/auth/perms-rev', { perms_rev:'probe' }],
    ['/api/delivery/board', BOARD],
    ['/api/delivery-tasks', TASKS],
    ['/api/sale-orders', SALES],
    ['/api/delivery-routes', ROUTES_OUT],
    ['/api/vehicles', VEHICLES],
    ['/api/warehouses', { data: [ { id:1, name:'总仓' } ] }],
    ['/api/products', { items: [ { id:1, name:'蒙牛特仑苏纯牛奶', spec:'250ml×12', unit:'箱' } ], total: 1 }],
    ['/api/expiry/forecast', { data: [] }],
    ['/api/inventory/low-stock', { data: [] }],
    ['/api/ai/sessions', { items: [] }],
    ['/api/weather', { data: {} }]
  ];
  window.__probe = { calls: [], unmatched: [], writes: [] };
  window.fetch = function(input, init){
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    var p = url.replace(/^https?:\\/\\/[^/]+/, '').split('?')[0];
    window.__probe.calls.push(p);
    var method = (init && init.method) || 'GET';
    if (method !== 'GET') window.__probe.writes.push([method, p]);
    var body = null;
    for (var i=0;i<ROUTES_TABLE.length;i++){ if (p === ROUTES_TABLE[i][0]) { body = ROUTES_TABLE[i][1]; break; } }
    if (body === null) { window.__probe.unmatched.push(p); body = { ok:true, success:true, data: [], items: [], total: 0 }; }
    return Promise.resolve(new Response(JSON.stringify(body),
      { status: 200, headers: { 'content-type': 'application/json' } }));
  };
})();
`

const CASES = [
  /* 反例放第一个（兼基线）：数据报表区的占位页 —— 仓配区已无占位页可当反例 */
  { name: '数据报表占位页（反例）', hash: '#/reports/sales-order', title: '销售订单汇总表', land: '.ph-card', real: false },
  { name: '司机任务看板', hash: '#/wh/driver-board', title: '司机任务看板', land: '.dbd-board', real: true,
    asserts: [
      ['看板渲染出司机列（按 driver 聚合）', d => d.text.includes('张三')],
      ['车辆信息取 vehicle_name + plate', d => d.text.includes('冷藏车一号') && d.text.includes('鄂F12345')],
      ['未分配列出现（桩有 1 单未分配司机）', d => d.text.includes('未分配司机')],
      ['路线徽标取 routes[].name', d => d.text.includes('襄城线-上午')],
      ['KPI「配送任务」= total_tasks 2', d => d.kpiVals[0] === '2'],
      ['KPI「未分配司机」= 1', d => d.kpiVals[3] === '1'],
      ['只拉 board 一次（KPI 与看板同源，不另发汇总）', d => d.boardCalls === 1],
    ] },
  { name: '配送单-今日待配送', hash: '#/wh/delivery', title: '配送单', land: '.dvo-tbl', real: true,
    asserts: [
      ['单号取真字段 order_no', d => d.cells[0] === 'SO20261012001'],
      ['客户名取 JOIN 别名 customer_name', d => d.cells[1] === '永辉超市襄城店'],
      ['司机取 driver_id', d => d.cells[3] === '张三'],
      ['未分车的单司机格为「—」', d => d.rowText(1).includes('—')],
      ['KPI「已分车」= 2（今日视图全是 assigned）', d => d.kpiVals[0] === '2'],
    ] },
  { name: '配送单-全部（切视图）', hash: '#/wh/delivery', title: '配送单', land: '.dvo-tbl', real: true,
    /* 切到「全部配送单」：验证**另一个端点**被真的换掉，而不是只换个标签 */
    before: `var s=document.querySelector('.dvo-scope'); s.value='all'; s.dispatchEvent(new Event('change'));`,
    asserts: [
      ['切视图后走 /api/sale-orders（不是 delivery-tasks）', d => d.saleCalls >= 1],
      ['自提单被筛掉（delivery_status 为空的不算配送单）', d => !d.text.includes('SO20261011011')],
      ['已签收单出现在全部视图', d => d.text.includes('SO20261011009')],
      ['车辆列恒为 —（sale-orders 不 JOIN 车辆表，不许显示「车辆 #1」伪信息）',
        d => d.rowText(2).indexOf('车辆 #') < 0 && d.rowText(2).includes('—')],
      ['KPI「已签收」= 1', d => d.kpiVals[2] === '1'],
      ['KPI「配送失败」= 1', d => d.kpiVals[3] === '1'],
    ] },
  { name: '线路设置', hash: '#/wh/route-setup', title: '线路设置', land: '.rts-list', real: true,
    asserts: [
      ['线路名取 name', d => d.text.includes('襄城线-上午')],
      ['车辆名经 vehicle_id 关联（不是 #1）', d => d.text.includes('冷藏车一号')],
      ['停靠点取 stops[]（2 站）', d => d.text.includes('永辉超市襄城店') && d.text.includes('美廉宜城店')],
      ['停靠点状态取 status（已送达/待送达）', d => d.text.includes('已送达') && d.text.includes('待送达')],
      ['关联单号取 order_ids', d => d.text.includes('1001')],
      ['停靠点行数 = 2', d => d.tblRows === 2],
    ] },
]

let pass = 0, fail = 0
const browser = await launch({ headless: true })
for (const c of CASES) {
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(STUB)
  let d = {}, errs = []
  try {
    await page.goto(BASE + c.hash, 3500)
    if (c.before) {
      await page.eval(`(function(){ ${c.before} })()`)
      await new Promise(r => setTimeout(r, 1200))
    }
    const raw = await page.eval(`(function(){
      var q = function(s){ return document.querySelector(s); };
      var txt = (q('.page')||{}).innerText || '';
      var rows = Array.prototype.slice.call(document.querySelectorAll('table.tbl tbody tr'));
      var tr = rows[0];
      return JSON.stringify({
        href: location.href,
        h2: (q('.page-hd h2')||{}).textContent ? q('.page-hd h2').textContent.trim() : '',
        hasPage: !!q('.page'),
        hasLandmark: !!q(${JSON.stringify(c.land)}),
        hasPhCard: !!q('.ph-card'),
        hasErrState: !!q('.state-error'),
        errText: ((q('.state-error')||{}).innerText||'').slice(0,140),
        kpi: document.querySelectorAll('.kpi-strip .kpi').length,
        kpiVals: Array.prototype.slice.call(document.querySelectorAll('.kpi-strip .kpi-val'))
                   .map(function(e){ return e.textContent.trim(); }),
        tblRows: rows.length,
        text: txt,
        cells: tr ? Array.prototype.slice.call(tr.querySelectorAll('td'))
                    .map(function(td){ return td.textContent.replace(/\\s+/g,' ').trim(); }) : [],
        rowText: rows.map(function(r){ return r.textContent.replace(/\\s+/g,' ').trim(); }),
        calls: (window.__probe && window.__probe.calls) || [],
        unmatched: (window.__probe && window.__probe.unmatched) || [],
        writes: (window.__probe && window.__probe.writes) || []
      });
    })()`)
    d = JSON.parse(raw)
    /* 🔴 先存数组再改写成取值函数 —— 直接 `d.rowText = i => d.rowText[i]` 会**自引用**成 undefined
       （赋值后 d.rowText 已是函数，`[i]` 取不到）⇒ 那条断言恒假，看起来像页面缺字段。 */
    const rowTexts = d.rowText
    d.rowText = i => (rowTexts[i] || '')
    d.boardCalls = d.calls.filter(x => x === '/api/delivery/board').length
    d.saleCalls = d.calls.filter(x => x === '/api/sale-orders').length
    errs = page.errors || []
    await page.screenshot(`${SHOT_DIR}/${c.name.replace(/[（）]/g, '')}.png`, { fullPage: false })
  } catch (e) {
    d = { href: '(异常)', h2: '', hasPage: false, hasLandmark: false, hasPhCard: null, hasErrState: null,
          kpi: 0, kpiVals: [], tblRows: 0, text: '', cells: [], rowText: () => '', calls: [], unmatched: [], writes: [] }
    d.boardCalls = 0; d.saleCalls = 0
    errs = [(e && e.message) || String(e)]
  }
  const checks = [
    ['标题逐字命中', d.h2 === c.title],
    ['页根渲染', d.hasPage === true],
    [`关键地标在(${c.land})`, d.hasLandmark === true],
    ['零 console 错误', errs.length === 0],
  ]
  if (c.real === false) {
    checks.push(['确为占位骨架（反例自证）', d.hasPhCard === true])
    const realCriteria = [
      ['不是占位骨架', d.hasPhCard === false],
      [`KPI 条渲染（≥3，实测 ${d.kpi}）`, d.kpi >= 3],
      [`列表有数据行（>0，实测 ${d.tblRows}）`, d.tblRows > 0],
    ]
    const failed = realCriteria.filter(x => !x[1]).map(x => x[0])
    checks.push([`判别力：真页判据套在占位页上须全数失败（失败 ${failed.length}/3）`, failed.length === 3])
  } else {
    checks.push(['不是占位骨架', d.hasPhCard === false])
    checks.push(['未落入错误态', d.hasErrState === false])
    checks.push(['boot 期确已发出接口请求（桩被打到）', d.calls.length > 0])
    checks.push(['探针零写请求（只读约束）', d.writes.length === 0])
    ;(c.asserts || []).forEach(a => {
      let ok = false
      try { ok = !!a[1](d) } catch (e) { ok = false }
      checks.push([a[0], ok])
    })
  }
  const bad = checks.filter(x => !x[1]).map(x => x[0])
  const ok = bad.length === 0
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}   ${String(d.href).replace(BASE, '')}`)
  console.log(`      h2="${d.h2}" 地标=${d.hasLandmark} 占位=${d.hasPhCard} 错误态=${d.hasErrState} errs=${errs.length} 请求=${d.calls.length} 次`)
  if (bad.length) {
    console.log(`      未过：${bad.join(' / ')}`)
    if (errs.length) console.log(`      errs：${errs.slice(0, 2).join(' | ')}`)
    if (d.hasErrState) console.log(`      错误态文案：${d.errText}`)
  }
}
await browser.close()
server.close()
console.log(`\n===== 汇总：PASS ${pass} / FAIL ${fail} =====`)
console.log(`截图：${SHOT_DIR}`)
process.exit(fail ? 1 : 0)
