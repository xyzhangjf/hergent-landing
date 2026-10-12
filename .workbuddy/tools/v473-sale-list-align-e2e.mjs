/**
 * v473 销售单列表页 —— 「以采购单列表页为基准的四项能力对齐」真机验收探针
 *
 * ── 为什么打**本地隔离产物**（dist-v473）而不是生产 ─────────────────────────
 *   服务端的 v473（`offset` / `order_by` / `order_dir` / `exclude_status`）**尚未部署**。
 *   直连生产后端的话，点表头会看到「静默回落 so.id」、翻页会看到「内容不动」——
 *   那不是缺陷，是后端还没上，但看起来**极像前端没做对**。所以本探针把 `/api/**` 全部 mock，
 *   只在本地闭环证明**前端行为**：
 *     表头可点 / 请求真的带上正确的 `order_by`（含列 key → 后端键的映射）/ 三态循环 /
 *     排序 chip 与清除 / 筛选折叠 / 分页器（页码窗 + 条页 + 跳页 + offset）/ 导出 CSV /
 *     单张打印 / 「订单·退单」入口的 `exclude_status` / 同 path 换 query 真的重新拉 /
 *     零控制台报错。
 *   「后端真的会按这个键排、offset 真的不被丢弃」由 Python 探针单独证明：
 *     `.workbuddy/tools/v473-so-order-sort-probe.py`（HTTP 层 TestClient + 25 键 SQL 合法 +
 *     注入面闭合 + tiebreaker 无重无漏 + 前后端白名单交叉校验）。
 *   两侧合起来才是端到端 —— 接口契约由那份交叉校验（前端 SORT_KEY ⊆ 后端 _SO_ORDER_SQL）保证。
 *
 * ── 本文件规避的本机坑 ─────────────────────────────────────────────────────
 *   ① 模板串里**不能写反引号**；正则要写双反斜杠（`\\s` / `\\/`），否则量测全 undefined。
 *   ② 量测一律带 `err` 字段：NOT_FOUND 与"取到空值"必须能分开。
 *   ③ fetch 桩必须在 **boot 前**装（addInitScript），否则 permissions 早发完了。
 *   ④ H 段要验的是 `watch([_qType,_qKind])`（**同文档** hash 导航）⇒ 必须用
 *      `location.hash = ...` 触发 hashchange，**不能**用 `'/?__r=' + Date.now()` 强制 reload
 *      （那会重新挂载组件，恰好绕开 watch —— 验不到本轮修的那个缺陷）。
 *
 * 运行：
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v473-sale-list-align-e2e.mjs
 */
import { launch } from './lib/cdp-lite.mjs'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2'
const DIST = path.join(ROOT, process.argv[2] || 'dist-v473')
const SHOTS = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v473-sale-list'
try { fs.mkdirSync(SHOTS, { recursive: true }) } catch { /* ignore */ }

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function serve (dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0])
      if (p === '/' || !path.extname(p)) p = '/index.html'
      const f = path.join(dir, p)
      if (!f.startsWith(dir) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end('nf'); return }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' })
      fs.createReadStream(f).pipe(res)
    })
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}

/* 三行覆盖三种出货方式 / 两种状态 / 交货日期有与无：
   ⇒ 列设置里的 otype / odate / ddate 三列都「有值可显示」，且排序键各自不同。 */
const ORDERS = [
  { id: 201, order_no: 'SO-201', customer_name: '永辉超市', total_amount: 3200.5, status: 'signed',
    order_type: 'self_pickup', order_date: '2026-10-01', delivery_date: '2026-10-03' },
  { id: 202, order_no: 'SO-202', customer_name: '美廉超市', total_amount: 1500, status: 'draft',
    order_type: 'vehicle_sale', order_date: '2026-10-02', delivery_date: '2026-10-04' },
  { id: 203, order_no: 'SO-203', customer_name: '唐成分销', total_amount: 880, status: 'returned',
    order_type: 'transfer', order_date: '2026-10-03', delivery_date: '' },
]
const TOTAL = 230    // 故意 > limit(50) ⇒ 页码窗必须出现，且能验 offset

const INIT = `
;(function(){
  try {
    /* 🔴 必须先预置登录态再去拦 fetch：boot 期的路由守卫只看 localStorage 里的 token，
       没有它会被直接重定向到 #/login —— 那时页面根本没到列表页，
       所有量测都会是 no-table / 请求数 0，看起来很像是"前端没渲染"（踩过一次）。 */
    localStorage.clear();
    localStorage.setItem('hergent_v2_token', 'V473-PROBE-NOT-REAL');
    localStorage.setItem('hergent_v2_tenant', '1');
    localStorage.setItem('hergent_v2_csrf', 'probe-csrf');
    localStorage.setItem('hergent_v2_user', JSON.stringify({ id: 2, username: 'boss', display_name: '老板', role: 'boss', roles: ['boss'] }));
  } catch (e) {}
})();
;(function(){
  window.__SALE_REQS = []; window.__ERRS = []; window.__DL = []; window.__DLNAME = '';
  window.addEventListener('error', function (e) { try { window.__ERRS.push('error: ' + (e.message || '')) } catch (_) {} });
  window.addEventListener('unhandledrejection', function (e) { try { window.__ERRS.push('reject: ' + String(e.reason)) } catch (_) {} });
  window.print = function () {};            // headless 下别真的走打印管线
  var _cou = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (b) {
    try { var fr = new FileReader(); fr.onload = function () { window.__DL.push({ text: String(fr.result).slice(0, 600) }); }; fr.readAsText(b); } catch (e) {}
    return _cou(b);
  };
  var _click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try { if (this.download) window.__DLNAME = this.download; } catch (e) {}
    return _click.apply(this, arguments);
  };

  function j(o) { return new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  var SALE = { orders: ${JSON.stringify(ORDERS)}, total: ${TOTAL} };
  var orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : ((input && input.url) || '');
    try {
      if (url.indexOf('/api/psi/sale-orders') >= 0 && url.indexOf('/pending') < 0) window.__SALE_REQS.push(url);
    } catch (e) {}
    if (/\\/api\\/auth\\/permissions/.test(url)) {
      return j({ user: { id: 2, username: 'boss', display_name: '老板', role: 'boss', roles: ['boss'] },
                 permissions: ['inventory', 'data'],
                 permissions_detail: { inventory: ['view', 'create', 'update', 'delete'], data: ['view'] },
                 custom_roles: [], perms_rev: 'probe-rev-1', tenant_id: 1, plan: 'free',
                 capabilities: { view: true, export: true } });
    }
    if (/\\/api\\/auth\\/me/.test(url)) { return j({ user: { id: 2, username: 'boss', display_name: '老板', role: 'boss' } }); }
    if (/\\/api\\/auth\\/perms-rev/.test(url)) { return j({ perms_rev: 'probe-rev-1' }); }
    if (/\\/api\\/psi\\/refs/.test(url)) {
      return j({ customers: [{ id: 1, name: '永辉超市' }, { id: 2, name: '美廉超市' }],
                 warehouses: [{ id: 1, name: '主仓' }] });
    }
    if (/\\/api\\/ui\\/col-prefs/.test(url)) { return j({ pref: null }); }
    if (/\\/api\\/psi\\/sale-orders/.test(url)) { return j(SALE); }
    if (/\\/api\\//.test(url)) { return j([]); }
    return orig(input, init);
  };
})();
`

const J = (p, expr) => p.eval(expr).then((s) => {
  try { return JSON.parse(s) } catch { return { err: 'non-json', raw: String(s).slice(0, 160) } }
})

/** 就绪判据：表格渲染出数据行（不只看 title —— SPA 的 title 一直在） */
const JS_READY = `(function(){
  var t = document.querySelector('table.isl-tbl');
  return JSON.stringify({ title: document.title || '', rows: t ? t.querySelectorAll('tbody>tr').length : 0,
                          hdr: document.querySelector('.page-hd h2') ? String(document.querySelector('.page-hd h2').textContent || '').trim() : '' });
})()`

const JS_STATE = `(function(){
  try {
    var tbl = document.querySelector('table.isl-tbl');
    if (!tbl) return JSON.stringify({ err: 'no-table' });
    var ths = tbl.querySelectorAll('thead th');
    var sh = 0, labels = [];
    for (var i = 0; i < ths.length; i++) {
      if (ths[i].classList.contains('isl-sh')) { sh++; labels.push(String(ths[i].textContent || '').replace(/\\s+/g, ' ').trim()); }
    }
    var chipEl = document.querySelector('.isl-sortinfo');
    var cntEl = document.querySelector('.isl-pg-cnt');
    var morBtn = null;
    var bs = document.querySelectorAll('.isl-fbtns .btn');
    for (var k = 0; k < bs.length; k++) { if (String(bs[k].textContent || '').indexOf('更多选项') >= 0) morBtn = bs[k]; }
    var flabels = [];
    var ls = document.querySelectorAll('.isl-filter .isl-lb');
    for (var m = 0; m < ls.length; m++) flabels.push(String(ls[m].textContent || '').trim());
    return JSON.stringify({
      err: '',
      rows: tbl.querySelectorAll('tbody>tr').length,
      thTotal: ths.length,
      shCount: sh, shLabels: labels,
      indCount: tbl.querySelectorAll('thead th.isl-sh .isl-sort-ind svg.ico').length,
      gear: tbl.querySelectorAll('thead th.col-gear-th .col-cfg').length,
      chip: chipEl ? String(chipEl.textContent || '').replace(/\\s+/g, ' ').trim() : null,
      chipClear: chipEl ? chipEl.querySelectorAll('button').length : 0,
      pgNums: document.querySelectorAll('.isl-pg-nums .isl-pg').length,
      pgSizes: document.querySelectorAll('.isl-pg-size option').length,
      pgJump: !!document.querySelector('.isl-pg-in'),
      pgCnt: cntEl ? String(cntEl.textContent || '').replace(/\\s+/g, ' ').trim() : null,
      moreBtn: !!morBtn,
      subRow: !!document.querySelector('.isl-frow-sub'),
      filterLabels: flabels,
      printOne: tbl.classList.contains('print-one'),
      printTgt: tbl.querySelectorAll('tbody>tr.print-target').length,
      dlBtns: document.querySelectorAll('.isl-tb-r .btn').length,
      opBtns: document.querySelectorAll('.isl-ops .isl-op-btn').length
    });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

/** 通用点击：按选择器 + 文案定位（不按索引 —— 索引会在列变化时漂移） */
const JS_CLICK = (sel, text) => `(function(){
  try {
    var els = document.querySelectorAll(${JSON.stringify(sel)});
    for (var i = 0; i < els.length; i++) {
      if (String(els[i].textContent || '').indexOf(${JSON.stringify(text)}) >= 0) {
        els[i].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return JSON.stringify({ err: '', idx: i });
      }
    }
    return JSON.stringify({ err: 'not-found', sel: ${JSON.stringify(sel)}, text: ${JSON.stringify(text)} });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

const JS_LAST_REQ = `(function(){
  var a = window.__SALE_REQS || [];
  return JSON.stringify({ n: a.length, last: a.length ? a[a.length - 1] : '' });
})()`

const JS_DL = `(function(){
  var a = window.__DL || [];
  return JSON.stringify({ n: a.length, name: window.__DLNAME || '',
                          text: a.length ? a[a.length - 1].text : '' });
})()`

const JS_COLMENU = `(function(){
  try {
    var lis = document.querySelectorAll('.col-menu .col-menu-list li');
    var locked = 0, opts = [];
    for (var i = 0; i < lis.length; i++) {
      if (lis[i].classList.contains('locked')) locked++;
      else opts.push(String(lis[i].textContent || '').replace(/\\s+/g, ' ').trim());
    }
    return JSON.stringify({ err: '', total: lis.length, locked: locked, opts: opts });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

/** 切换某个可选列的勾选（点 label 里的 checkbox） */
const JS_TOGGLE_COL = (label) => `(function(){
  try {
    var lis = document.querySelectorAll('.col-menu .col-menu-list li');
    for (var i = 0; i < lis.length; i++) {
      if (String(lis[i].textContent || '').indexOf(${JSON.stringify(label)}) >= 0) {
        var cb = lis[i].querySelector('input[type=checkbox]');
        if (!cb) return JSON.stringify({ err: 'no-checkbox' });
        cb.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return JSON.stringify({ err: '', wasChecked: !!cb.checked });
      }
    }
    return JSON.stringify({ err: 'li-not-found', label: ${JSON.stringify(label)} });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

const PASS = []; const FAIL = []
const ok = (name, cond, detail = '') => {
  ;(cond ? PASS : FAIL).push(name)
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  | ' + detail : ''))
}
const section = (t) => console.log('\n' + '─'.repeat(92) + '\n' + t + '\n' + '─'.repeat(92))

async function hardLoad (p, hash, wait0 = 6000) {
  let m = null
  for (let i = 0; i < 5; i++) {
    await p.goto('http://127.0.0.1:' + p.__port + '/?__r=' + Date.now() + hash, i === 0 ? wait0 : 4000)
    m = await J(p, JS_READY)
    if (m && m.rows > 0) break
    await sleep(1000)
  }
  return m
}

const main = async () => {
  if (!fs.existsSync(DIST)) { console.error('产物目录不存在：' + DIST); process.exit(2) }
  const r = await serve(DIST)
  const browser = await launch({ headless: true })
  const p = await browser.newPage()
  p.__port = r.port
  await p.enable()
  await p.addInitScript(INIT)
  await p.raw.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })

  /* ══ A 渲染 + 可排序表头 + 列设置 ══════════════════════════════════════ */
  section('A 销售单列表 · 渲染 + 全部数据列可排序 + 齿轮')
  const m = await hardLoad(p, '#/inventory/sale')
  console.log('  列表行数=' + (m && m.rows) + '  页头=' + JSON.stringify(m && m.hdr))
  await p.screenshot(SHOTS + '/A1-列表.png').catch(() => {})

  const s0 = await J(p, JS_STATE)
  if (s0.err) { ok('A  表格渲染取到值', false, s0.err) } else {
    console.log('  可排序表头=' + s0.shCount + ' / 表头总数=' + s0.thTotal + '  指示器=' + s0.indCount +
                '  页码窗=' + s0.pgNums + '  条页选项=' + s0.pgSizes + '  行内按钮=' + s0.opBtns)
    console.log('  可排序列=' + JSON.stringify(s0.shLabels))
    console.log('  默认筛选标签=' + JSON.stringify(s0.filterLabels))
    ok('A  列表渲染 3 行（mock 数据）', s0.rows === 3, String(s0.rows))
    /* 表头 = 齿轮(序号) + 7 数据列 + 操作列 = 9 */
    ok('A  表头总数 = 1 齿轮 + 7 数据列 + 1 操作 = 9', s0.thTotal === 9, String(s0.thTotal))
    /* SORTABLE = COLS 全部 7 键 ⇒ 默认视图下每个数据列都可排 */
    ok('A  **全部数据列都可排**（th.isl-sh == 表头总数 - 2 个非数据列）', s0.shCount === s0.thTotal - 2,
      s0.shCount + ' vs ' + (s0.thTotal - 2))
    ok('A  **每个可排序列都带中性指示器**（用户能看出"这列能点"）', s0.indCount === s0.shCount,
      s0.indCount + ' / ' + s0.shCount)
    ok('A  未排序时无排序提示 chip', s0.chip === null, String(s0.chip))
    ok('A  齿轮在序号列表头格子里（§2.6.1：不进工具栏）', s0.gear === 1, String(s0.gear))
    ok('A  行内操作按钮 = 3 个（每行一个「打印」）', s0.opBtns === 3, String(s0.opBtns))
    ok('A  工具栏右侧 = 导出 + 打印 两个按钮', s0.dlBtns === 2, String(s0.dlBtns))
    await p.screenshot(SHOTS + '/A2-表头指示器.png').catch(() => {})
  }

  /* ══ B 服务端排序三态 + **列 key → 后端键映射** ═════════════════════════ */
  section('B 点击表头 ⇒ 请求带 order_by / order_dir（**服务端**排序）')
  const c1 = await J(p, JS_CLICK('table.isl-tbl thead th', '金额'))
  ok('B  找到「金额」表头并点击', !c1.err, c1.err || ('idx=' + c1.idx))
  await sleep(900)
  let rq = await J(p, JS_LAST_REQ)
  console.log('  请求 #' + rq.n + ' → ' + rq.last)
  ok('B  第一次点击 ⇒ `order_by=total_amount`', rq.last.includes('order_by=total_amount'), rq.last)
  ok('B  第一次点击 ⇒ `order_dir=desc`（默认降序）', rq.last.includes('order_dir=desc'), rq.last)

  const s1 = await J(p, JS_STATE)
  ok('B  **排序提示 chip 出现**（排序列被隐藏时顺序来历仍可见）', !!s1.chip, String(s1.chip))
  ok('B  chip 含列名 + 方向 + 清除按钮',
    String(s1.chip).includes('金额') && String(s1.chip).includes('降序') && s1.chipClear === 1,
    String(s1.chip) + ' / 按钮 ' + s1.chipClear)
  await p.screenshot(SHOTS + '/B1-排序chip.png').catch(() => {})

  await J(p, JS_CLICK('table.isl-tbl thead th', '金额'))
  await sleep(900)
  rq = await J(p, JS_LAST_REQ)
  console.log('  请求 #' + rq.n + ' → ' + rq.last)
  ok('B  第二次点击 ⇒ `order_dir=asc`（降 → 升）',
    rq.last.includes('order_by=total_amount') && rq.last.includes('order_dir=asc'), rq.last)

  await J(p, JS_CLICK('table.isl-tbl thead th', '金额'))
  await sleep(900)
  rq = await J(p, JS_LAST_REQ)
  console.log('  请求 #' + rq.n + ' → ' + rq.last)
  ok('B  第三次点击 ⇒ **不再带** `order_by`（三态循环回到无排序）', !rq.last.includes('order_by'), rq.last)
  ok('B  取消排序后 chip 消失', (await J(p, JS_STATE)).chip === null)

  /* 🔴 本段是 v473 最容易静默失效的一环：**列 key ≠ 后端列名**。
     列 key 是云端列配置的主键（`otype`/`odate`/`ddate`，v449 就在用，不能改名），
     而后端白名单用的是库里的列名（`order_type`/`order_date`/`delivery_date`）。
     少了 `SORT_KEY` 这层映射，症状就是**点了没反应、零报错**。 */
  const MAP_CASES = [
    ['下单日期', 'order_date'],      // 列 key `odate` → 后端 `order_date`（映射）
    ['交货日期', 'delivery_date'],   // 列 key `ddate` → 后端 `delivery_date`（映射）
    ['出货方式', 'order_type'],      // 列 key `otype` → 后端 `order_type`（映射）
    ['客户', 'customer'],            // 同名，但后端指向 JOIN 进来的 c.name
    ['单号', 'order_no'],
  ]
  for (const [label, key] of MAP_CASES) {
    const c = await J(p, JS_CLICK('table.isl-tbl thead th', label))
    await sleep(800)
    const q = await J(p, JS_LAST_REQ)
    ok(`B  「${label}」⇒ \`order_by=${key}\`（列 key → 后端键映射）`,
      !c.err && q.last.includes('order_by=' + key), c.err || q.last)
  }
  await J(p, JS_CLICK('.isl-sortinfo button', '清除'))
  await sleep(800)
  const qc = await J(p, JS_LAST_REQ)
  ok('B  点 chip 的「清除」⇒ 请求不再带 order_by', !qc.last.includes('order_by'), qc.last)

  /* ══ C 筛选折叠 ═══════════════════════════════════════════════════════ */
  section('C 筛选折叠（常用项一行 + 「更多选项」）')
  const sC0 = await J(p, JS_STATE)
  ok('C  默认**不展开**「更多选项」（出货方式 / 客户 收起）', !sC0.subRow, 'subRow=' + sC0.subRow)
  ok('C  默认筛选 = 状态 + 下单起 + 下单止（高频项留在一行）',
    JSON.stringify(sC0.filterLabels) === JSON.stringify(['状态', '下单起', '下单止']),
    JSON.stringify(sC0.filterLabels))
  const q0 = await J(p, JS_LAST_REQ)
  ok('C  默认请求**不带** order_type / customer_id（空值不发参数）',
    !q0.last.includes('order_type=') && !q0.last.includes('customer_id='), q0.last)

  await J(p, JS_CLICK('.isl-fbtns .btn', '更多选项'))
  await sleep(400)
  const sC1 = await J(p, JS_STATE)
  ok('C  点「更多选项」⇒ 展开出货方式 / 客户', sC1.subRow &&
    sC1.filterLabels.includes('出货方式') && sC1.filterLabels.includes('客户'),
    JSON.stringify(sC1.filterLabels))
  await p.screenshot(SHOTS + '/C1-更多选项展开.png').catch(() => {})
  await J(p, JS_CLICK('.isl-fbtns .btn', '更多选项'))
  await sleep(400)
  ok('C  再点一次 ⇒ 收起', !(await J(p, JS_STATE)).subRow)

  /* ══ D 分页器（v473 修的「下一页是死的」在**前端**这一侧）═════════════ */
  section('D 分页器：页码窗 + 条/页 + 跳页 + offset 真的变')
  const sD = await J(p, JS_STATE)
  ok('D  页码窗出现（‹ 1 2 3 4 5 › = 7 个按钮）', sD.pgNums === 7, String(sD.pgNums))
  ok('D  「条/页」下拉有 4 档（20/50/100/200）', sD.pgSizes === 4, String(sD.pgSizes))
  ok('D  有「跳至 __ 页」输入框', sD.pgJump === true, String(sD.pgJump))
  ok('D  计数文案含总数与区间', /共 230 张/.test(String(sD.pgCnt)) && /第 1–50 张/.test(String(sD.pgCnt)),
    String(sD.pgCnt))

  await J(p, JS_CLICK('.isl-pg-nums .isl-pg', '2'))
  await sleep(900)
  const q2 = await J(p, JS_LAST_REQ)
  console.log('  请求 #' + q2.n + ' → ' + q2.last)
  ok('D  点第 2 页 ⇒ `offset=50`（**下一页不是死的**）', q2.last.includes('offset=50'), q2.last)
  const sD2 = await J(p, JS_STATE)
  ok('D  第 2 页计数区间随之变化（第 51–100 张）', /第 51–100 张/.test(String(sD2.pgCnt)), String(sD2.pgCnt))

  await J(p, JS_CLICK('.isl-pg-nums .isl-pg', '3'))
  await sleep(900)
  const q3 = await J(p, JS_LAST_REQ)
  console.log('  请求 #' + q3.n + ' → ' + q3.last)
  ok('D  点第 3 页 ⇒ `offset=100`', q3.last.includes('offset=100'), q3.last)
  await p.screenshot(SHOTS + '/D1-分页.png').catch(() => {})

  /* 排序 + 分页共存（v473 的核心价值：**服务端**排序才有意义）。
     ⚠️ 点表头会 `load(true)` ⇒ **页码回到第 1 页**是刻意的（`offset=0` 时 `qs()` 不发参数），
        否则「第 3 页重新按金额排」拿到的是「排序后第 3 页」——用户以为自己还在看原来的位置。 */
  await J(p, JS_CLICK('table.isl-tbl thead th', '金额'))
  await sleep(900)
  const q4 = await J(p, JS_LAST_REQ)
  ok('D  点排序 ⇒ 页码回到第 1 页（offset 归零，不带着旧页码）',
    q4.last.includes('order_by=total_amount') && !q4.last.includes('offset='), q4.last)
  await J(p, JS_CLICK('.isl-pg-nums .isl-pg', '2'))
  await sleep(900)
  const q5 = await J(p, JS_LAST_REQ)
  ok('D  **排序 + 翻页共存**：同一请求同时带 order_by 与 offset=50',
    q5.last.includes('order_by=total_amount') && q5.last.includes('offset=50'), q5.last)

  /* ══ E 导出 CSV（跟随列设置）═══════════════════════════════════════════ */
  section('E 导出：跟随列设置 + 文件名本地日期戳')
  await J(p, JS_CLICK('.isl-pg-nums .isl-pg', '1'))
  await sleep(700)
  await J(p, JS_CLICK('.isl-tb-r .btn', '导出'))
  await sleep(700)
  const dl = await J(p, JS_DL)
  console.log('  下载文件名=' + JSON.stringify(dl.name))
  console.log('  CSV 首行=' + JSON.stringify(String(dl.text).split('\r\n')[0]))
  ok('E  点「导出」触发了一次下载', dl.n >= 1, 'n=' + dl.n)
  ok('E  文件名含页头文案 + `YYYY-MM-DD` 日期戳（本地时区，非 UTC）',
    /销售单-\d{4}-\d{2}-\d{2}\.csv/.test(String(dl.name)), String(dl.name))
  const lines = String(dl.text).replace(/^\ufeff/, '').split('\r\n').filter((x) => x.length)
  ok('E  CSV 表头 = 当前可见的 7 列（表里看到什么就导出什么）',
    lines[0] === '单号,客户,金额,状态,出货方式,下单日期,交货日期', JSON.stringify(lines[0]))
  ok('E  CSV 行数 = 表头 + 3 行数据', lines.length === 4, 'lines=' + lines.length)

  /* 关掉一列 ⇒ 导出的列也跟着少一列（唯一口径 `visibleCols`） */
  await J(p, JS_CLICK('table.isl-tbl thead th.col-gear-th button', ''))
  await sleep(500)
  const cm = await J(p, JS_COLMENU)
  ok('E  齿轮打开列设置面板：7 列 = 4 固定 + 3 可选', cm.total === 7 && cm.locked === 4,
    'total=' + cm.total + ' locked=' + cm.locked + ' opts=' + JSON.stringify(cm.opts))
  await p.screenshot(SHOTS + '/E1-列设置.png').catch(() => {})
  await J(p, JS_TOGGLE_COL('交货日期'))
  await sleep(400)
  await J(p, JS_CLICK('.col-menu-x', ''))
  await sleep(400)
  const sE = await J(p, JS_STATE)
  ok('E  取消勾选「交货日期」⇒ 表头少一列（8 个）', sE.thTotal === 8, 'thTotal=' + sE.thTotal)
  await J(p, JS_CLICK('.isl-tb-r .btn', '导出'))
  await sleep(700)
  const dl2 = await J(p, JS_DL)
  const l2 = String(dl2.text).replace(/^\ufeff/, '').split('\r\n').filter((x) => x.length)
  ok('E  **导出跟随列设置**：隐藏的列不再出现在 CSV 里',
    l2[0] === '单号,客户,金额,状态,出货方式,下单日期', JSON.stringify(l2[0]))
  ok('E  导出列数 = 6（与表头一致）', l2[0].split(',').length === 6, String(l2[0].split(',').length))

  /* ══ F 打印 ═══════════════════════════════════════════════════════════ */
  section('F 打印：整表 + 单行（`print-one` / `print-target`）')
  await J(p, JS_CLICK('table.isl-tbl thead th.col-gear-th button', ''))
  await sleep(300)
  await J(p, JS_TOGGLE_COL('交货日期'))
  await sleep(300)
  await J(p, JS_CLICK('.col-menu-x', ''))
  await sleep(300)
  const k = await J(p, JS_CLICK('.isl-ops .isl-op-btn', '打印'))
  await sleep(500)
  const sF = await J(p, JS_STATE)
  ok('F  点行内「打印」⇒ 表格进入单张模式（`print-one`）', !k.err && sF.printOne, k.err || ('printOne=' + sF.printOne))
  ok('F  且只有 1 行被标为打印目标（`print-target`）', sF.printTgt === 1, String(sF.printTgt))
  await p.screenshot(SHOTS + '/F1-单张打印.png').catch(() => {})
  await sleep(900)
  ok('F  打印结束后退出单张模式', !(await J(p, JS_STATE)).printOne)

  await J(p, JS_CLICK('.isl-tb-r .btn', '打印'))
  await sleep(400)
  ok('F  工具栏「打印」= 整表打印（不进入单张模式）', !(await J(p, JS_STATE)).printOne)

  /* ══ G 入口 × 请求参数（URL 驱动 + `exclude_status`）════════════════════ */
  section('G 入口驱动：订单/退单/车销 ⇒ 请求参数正确（v473 把前端 filter 挪到服务端）')
  const mG1 = await hardLoad(p, '#/inventory/sale?type=self_pickup&kind=order')
  let qG = await J(p, JS_LAST_REQ)
  console.log('  🚚 订单入口 请求 → ' + qG.last)
  ok('G  「订单」入口 ⇒ 服务端 `exclude_status=returned`（原先在前端对本页 filter）',
    qG.last.includes('exclude_status=returned'), qG.last)
  ok('G  「订单」入口 ⇒ `order_type=self_pickup`', qG.last.includes('order_type=self_pickup'), qG.last)
  ok('G  「订单」入口 ⇒ **不带** `status`（订单不是靠 status 筛的）', !/[?&]status=/.test(qG.last), qG.last)
  ok('G  页头标题 = 「自提订单」', String(mG1.hdr).includes('自提订单'), String(mG1.hdr))

  const mG2 = await hardLoad(p, '#/inventory/sale?type=self_pickup&kind=return')
  qG = await J(p, JS_LAST_REQ)
  console.log('  🚚 退单入口 请求 → ' + qG.last)
  ok('G  「退单」入口 ⇒ `status=returned` + `order_type=self_pickup`',
    qG.last.includes('status=returned') && qG.last.includes('order_type=self_pickup'), qG.last)
  ok('G  页头标题 = 「自提退单」', String(mG2.hdr).includes('自提退单'), String(mG2.hdr))
  await p.screenshot(SHOTS + '/G1-退单入口.png').catch(() => {})

  /* 🔴 本段验的是 v473 修的**第二个既有缺陷**：五个入口是**同 path 不同 query**，
     v473 之前 URL 只在 setup 里读一次 ⇒ 组件被复用、`onMounted` 不再跑 ⇒ 换入口页面纹丝不动。
     ⚠️ 必须用**同文档 hash 导航**（`location.hash = ...`）触发 —— 用 `'/?__r='` 强制 reload
     会重新挂载组件，恰好绕开 `watch`，验不到这个修复。 */
  const nBefore = (await J(p, JS_LAST_REQ)).n
  await p.eval("(function(){ location.hash = '#/inventory/sale?type=vehicle_sale'; return 'ok' })()")
  await sleep(1500)
  const qH = await J(p, JS_LAST_REQ)
  const mH = await J(p, JS_READY)
  console.log('  同文档切入口：请求 ' + nBefore + ' → ' + qH.n + ' ; 页头=' + JSON.stringify(mH.hdr))
  ok('G  **同 path 换 query 真的重新拉数据**（watch 生效，`onMounted` 不会跑）', qH.n > nBefore,
    nBefore + ' → ' + qH.n)
  ok('G  请求参数跟着换成 `order_type=vehicle_sale`', qH.last.includes('order_type=vehicle_sale'), qH.last)
  ok('G  页头标题跟着变成「车销」', String(mH.hdr).includes('车销'), String(mH.hdr))
  await p.screenshot(SHOTS + '/G2-同path换query.png').catch(() => {})

  /* ══ H 零控制台报错 ═══════════════════════════════════════════════════ */
  section('H 零控制台报错')
  const errs = (await J(p, `(function(){ return JSON.stringify(window.__ERRS || []); })()`)) || []
  console.log('  报错 = ' + JSON.stringify(errs.slice(0, 5)))
  ok('H  全程**零控制台报错**', errs.length === 0, JSON.stringify(errs.slice(0, 3)))

  const dump = {
    probe: 'v473-sale-list-align', at: new Date().toISOString(),
    listA: s0, sortB1: s1, filterC: { before: sC0, after: sC1 },
    pagerD: { first: sD, page2: sD2 }, exportE: { first: { name: dl.name, head: lines[0] }, colmenu: cm, afterHide: l2[0] },
    printF: sF, entryG: { nBefore, nAfter: qH.n }, errors: errs,
  }
  try {
    fs.writeFileSync(SHOTS + '/measurements.json', JSON.stringify(dump, null, 2))
    console.log('\n  量测原始数据 → outputs/v473-sale-list/measurements.json')
  } catch { /* ignore */ }

  console.log('\n' + '='.repeat(92))
  console.log('  PASS ' + PASS.length + '   FAIL ' + FAIL.length)
  if (FAIL.length) { console.log('  FAILED:'); FAIL.forEach((f) => console.log('   - ' + f)) }
  console.log('  VERDICT: ' + (FAIL.length ? 'HAS_FAIL' : 'ALL_PASS'))
  console.log('='.repeat(92))
  try { await browser.close() } catch { /* ignore */ }
  try { r.srv.close() } catch { /* ignore */ }
  process.exit(FAIL.length ? 1 : 0)
}

main().catch((e) => { console.error('探针异常：', e); process.exit(2) })
