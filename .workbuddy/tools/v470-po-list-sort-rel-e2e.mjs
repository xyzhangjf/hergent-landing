/**
 * v470 采购订单列表页 —— 「表头排序 + 关联单据穿透」真机验收探针
 *
 * ── 为什么打**本地隔离产物**（dist-v470）而不是生产 ─────────────────────────
 *   服务端的 v470（`order_by`/`order_dir`）**尚未部署**。直连生产后端的话，点了表头
 *   会看到「静默回落 po.id」——那不是缺陷，是后端还没上，但看起来**极像前端没做对**。
 *   所以本探针把 `/api/**` 全部 mock，只在本地闭环证明**前端行为**：
 *     表头可点 / 请求真的带上 `order_by` / 关联链接落点正确 / 退货视图没有关联列 / 零报错。
 *   「后端真的会按这个键排」由 Python 探针单独证明：
 *     `.workbuddy/tools/v470-po-order-sort-probe.py`（27 键 SQL 合法 + 排序生效 + 反例判别力）。
 *   两侧合起来才是端到端 —— 接口契约由那份交叉校验（前后端白名单逐键一致）保证。
 *
 * ── 本文件规避的本机坑 ─────────────────────────────────────────────────────
 *   ① 模板串里**不能写反引号**；正则要写双反斜杠（`\\s` / `\\/`），否则 SyntaxError
 *      ⇒ 量测全 undefined ⇒ 打印空 `{}`，看着像"页面没渲染"，会误导好几轮。
 *   ② 只差 hash 的 Page.navigate = 同文档导航 ⇒ 必须 `'/?__r=' + Date.now() + hash`。
 *   ③ 量测一律带 `err` 字段：NOT_FOUND 与"取到空值"必须能分开。
 *   ④ `window.fetch` 桩必须在**boot 前**装（addInitScript），否则 permissions 早发完了。
 *
 * 运行：
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v470-po-list-sort-rel-e2e.mjs
 */
import { launch } from './lib/cdp-lite.mjs'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2'
const DIST = path.join(ROOT, process.argv[2] || 'dist-v470')
const SHOTS = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v470-po-list'
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

/* 三行覆盖三种状态：已入库(101) / 草稿(102) / 部分入库(103)。
   ⇒ 「退货」穿透链接应只在 101、103 出现（102 draft 没有可退量 = 假入口）。 */
const ORDERS = [
  {
    id: 101, order_no: 'PO-101', supplier_name: '蒙牛乳业', supplier_category: '厂家',
    item_count: 2, order_qty: 15, order_unit: '包', warehouse_id: 1, status: 'received',
    total_amount: 1000, received_amount: 1000, paid_amount: 200, audit_time: '2026-10-02',
    order_date: '2026-10-01', operator_id: '2', creator_name: '张俊峰', note: '',
    print_count: 1, source: 'manual', created_at: '2026-10-01', expected_date: '2026-09-01',
    mark: '', received_at: '2026-10-02', auditor_name: '老板', last_op_at: '', last_op_name: '',
    last_print_at: '', last_print_name: '', return_total: 0, has_items: true, extra: {},
  },
  {
    id: 102, order_no: 'PO-102', supplier_name: '武汉冷链', supplier_category: '经销商',
    item_count: 1, order_qty: 2, order_unit: '箱', warehouse_id: 1, status: 'draft',
    total_amount: 3000, received_amount: 0, paid_amount: 0, audit_time: '',
    order_date: '2026-10-02', operator_id: '2', creator_name: '张俊峰', note: '',
    print_count: 0, source: '', created_at: '2026-10-02', expected_date: '2030-01-01',
    mark: '加急', received_at: '', auditor_name: '', last_op_at: '', last_op_name: '',
    last_print_at: '', last_print_name: '', return_total: 0, has_items: true, extra: {},
  },
  {
    id: 103, order_no: 'PO-103', supplier_name: '蒙牛乳业', supplier_category: '厂家',
    item_count: 1, order_qty: 8, order_unit: '包', warehouse_id: 1, status: 'partial',
    total_amount: 2000, received_amount: 900, paid_amount: 0, audit_time: '2026-10-02',
    order_date: '2026-09-30', operator_id: '3', creator_name: '小李', note: '',
    print_count: 1, source: 'ai', created_at: '2026-09-30', expected_date: '2026-10-01',
    mark: '', received_at: '', auditor_name: '老板', last_op_at: '', last_op_name: '',
    last_print_at: '', last_print_name: '', return_total: 150, has_items: true, extra: {},
  },
]
const PA_LIST = {
  orders: ORDERS, total: ORDERS.length,
  counts: { all: 3, draft: 1, pending_approval: 0, confirmed: 0, received: 1, partial: 1, returned: 0, cancelled: 0 },
  summary: { order_amount: 6000, received_amount: 1900, paid_amount: 200, unpaid_amount: 1700, count: 3 },
}

const INIT = `
;(function(){
  try {
    localStorage.setItem('hergent_v2_token', 'V469-PROBE-NOT-REAL');
    localStorage.setItem('hergent_v2_tenant', '1');
    localStorage.setItem('hergent_v2_csrf', 'probe-csrf');
    localStorage.setItem('hergent_v2_user', JSON.stringify({ id: 2, username: 'boss', display_name: '老板', role: 'boss', roles: ['boss'] }));
    localStorage.removeItem('hergent_purchase_cols_v1');
  } catch (e) {}
})();
;(function(){
  window.__PO_REQS = []; window.__ERRS = [];
  window.addEventListener('error', function (e) { try { window.__ERRS.push('error: ' + (e.message || '')) } catch (_) {} });
  window.addEventListener('unhandledrejection', function (e) { try { window.__ERRS.push('reject: ' + String(e.reason)) } catch (_) {} });

  function j(o) { return new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  var PA_LIST = ${JSON.stringify(PA_LIST)};
  var orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : ((input && input.url) || '');
    try { if (url.indexOf('/api/psi/purchase-orders') >= 0) window.__PO_REQS.push(url); } catch (e) {}
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
      return j({ warehouses: [{ id: 1, name: '主仓' }], suppliers: [{ id: 1, name: '蒙牛乳业' }],
                 users: [{ id: 2, name: '张俊峰' }, { id: 3, name: '小李' }], departments: [{ id: 1, name: '低温部' }] });
    }
    if (/\\/api\\/psi\\/purchase-custom-fields/.test(url)) {
      return j({ columns: { module: 'purchase_orders', system: [], custom: [] } });
    }
    if (/\\/api\\/psi\\/purchase-orders/.test(url)) { return j(PA_LIST); }
    if (/\\/api\\/ui\\/col-prefs/.test(url)) { return j({ pref: null }); }
    if (/\\/api\\//.test(url)) { return j([]); }
    return orig(input, init);
  };
})();
`

const J = (p, expr) => p.eval(expr).then((s) => {
  try { return JSON.parse(s) } catch { return { err: 'non-json', raw: String(s).slice(0, 120) } }
})

const JS_READY = `(function(){
  var t = document.querySelector('table.ipl-tbl');
  return JSON.stringify({ title: document.title || '', rows: t ? t.querySelectorAll('tbody>tr').length : 0 });
})()`

const JS_STATE = `(function(){
  try {
    var tbl = document.querySelector('table.ipl-tbl');
    if (!tbl) return JSON.stringify({ err: 'no-table' });
    var ths = tbl.querySelectorAll('thead th');
    var sh = 0, labels = [];
    for (var i = 0; i < ths.length; i++) {
      if (ths[i].classList.contains('ipl-sh')) {
        sh++; labels.push(String(ths[i].textContent || '').replace(/\\s+/g, ' ').trim());
      }
    }
    var chipEl = document.querySelector('.ipl-sortinfo');
    return JSON.stringify({
      err: '', rows: tbl.querySelectorAll('tbody>tr').length,
      thTotal: ths.length,
      shCount: sh, shLabels: labels.slice(0, 5),
      indCount: tbl.querySelectorAll('thead th.ipl-sh .ipl-sort-ind svg.ico').length,
      arrowUp: tbl.querySelectorAll('thead th.ipl-sh .ipl-sort-ind .ico').length,
      relTh: tbl.querySelector('thead th.ipl-c-rel') ? String(tbl.querySelector('thead th.ipl-c-rel').textContent || '').trim() : null,
      relTd: tbl.querySelectorAll('tbody td.ipl-c-rel').length,
      overdue: tbl.querySelectorAll('tbody .ipl-overdue').length,
      chip: chipEl ? String(chipEl.textContent || '').replace(/\\s+/g, ' ').trim() : null
    });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

const JS_REL_LINKS = `(function(){
  try {
    var tds = document.querySelectorAll('table.ipl-tbl tbody td.ipl-c-rel');
    if (!tds.length) return JSON.stringify({ err: 'no-rel-cell', cells: [] });
    var out = [];
    for (var i = 0; i < tds.length; i++) {
      var as = tds[i].querySelectorAll('a');
      var links = [];
      for (var k = 0; k < as.length; k++) links.push({ text: String(as[k].textContent || '').trim(), href: as[k].getAttribute('href') });
      out.push({ row: i, links: links });
    }
    return JSON.stringify({ err: '', cells: out });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

const JS_CLICK_TH = (label) => `(function(){
  try {
    var ths = document.querySelectorAll('table.ipl-tbl thead th');
    for (var i = 0; i < ths.length; i++) {
      if (String(ths[i].textContent || '').indexOf(${JSON.stringify(label)}) >= 0) {
        ths[i].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return JSON.stringify({ err: '', idx: i });
      }
    }
    return JSON.stringify({ err: 'th-not-found', label: ${JSON.stringify(label)} });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

const JS_LAST_REQ = `(function(){
  var a = window.__PO_REQS || [];
  return JSON.stringify({ n: a.length, last: a.length ? a[a.length - 1] : '' });
})()`

const PASS = []; const FAIL = []
const ok = (name, cond, detail = '') => {
  ;(cond ? PASS : FAIL).push(name)
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  | ' + detail : ''))
}
const section = (t) => console.log('\n' + '─'.repeat(90) + '\n' + t + '\n' + '─'.repeat(90))

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

  /* ══ A 列表渲染 + 可排序表头 ══════════════════════════════════════════════ */
  section('A 采购订单列表 · 渲染 + 表头可选排序')
  const m = await hardLoad(p, '#/inventory/purchase')
  console.log('  列表行数=' + m.rows + '  title=' + JSON.stringify(m.title))
  await p.screenshot(SHOTS + '/A1-列表.png').catch(() => {})

  const s0 = await J(p, JS_STATE)
  if (s0.err) { ok('A  表格渲染取到值', false, s0.err) } else {
    console.log('  可排序表头数=' + s0.shCount + '/ 表头总数=' + s0.thTotal + ' 指示器图标=' + s0.indCount + ' 关联列 td=' + s0.relTd + ' 逾期标记=' + s0.overdue)
    console.log('  可排序列示例=' + JSON.stringify(s0.shLabels))
    ok('A  列表渲染 3 行（mock 数据）', s0.rows === 3, String(s0.rows))
    /* 自洽判据（不硬编码列数）：表头 = 复选框 + 序号 + 数据列… + 关联 + 操作，
       减去 4 个非数据列即为数据列数。`SORTABLE` 覆盖了全部 26 个静态列 key
       ⇒ 默认视图下**每一个数据列都该可排**。 */
    ok('A  **全部数据列都可排**（th.ipl-sh == 表头总数 - 4 个非数据列）',
      s0.shCount === s0.thTotal - 4, s0.shCount + ' vs ' + (s0.thTotal - 4) + '（表头 ' + s0.thTotal + '）')
    ok('A  **每个可排序列都带中性指示器**（用户能看出"这列能点"）', s0.indCount === s0.shCount,
      s0.indCount + ' / ' + s0.shCount)
    ok('A  未排序时无排序提示 chip', s0.chip === null, '未排序不应有排序提示 chip')
    /* ⚠️ 这条**不是**"逾期功能正常"的证明，而是一条事实判据：逾期标记长在「预计到货」列里，
       而该列 `on` 缺省（默认收起）⇒ 默认视图**不该**出现任何逾期标记。若这里 >0，
       说明默认列集被改过（或标记跑到了别的列），那是另一回事。逾期标记本身的验收在 v467。 */
    ok('A  默认视图无逾期标记（「预计到货」列默认收起 ⇒ 该项本就不渲染）',
      s0.overdue === 0, String(s0.overdue))
  }

  /* ══ B 点击排序 ⇒ 请求真的带上 order_by / order_dir（服务端排序） ═════════ */
  section('B 点击表头 ⇒ 请求带 order_by（**服务端**排序，不是前端重排当前页）')
  const c1 = await J(p, JS_CLICK_TH('订单金额'))
  ok('B  找到「订单金额」表头并点击', !c1.err, c1.err || ('idx=' + c1.idx))
  await sleep(900)
  let rq = await J(p, JS_LAST_REQ)
  console.log('  请求 #' + rq.n + ' → ' + rq.last)
  ok('B  第一次点击 ⇒ `order_by=total_amount`', rq.last.includes('order_by=total_amount'), rq.last)
  ok('B  第一次点击 ⇒ `order_dir=desc`（默认降序）', rq.last.includes('order_dir=desc'), rq.last)

  const s1 = await J(p, JS_STATE)
  ok('B  **排序提示 chip 出现**（排序列被隐藏时顺序来历仍可见）', !!s1.chip, String(s1.chip))
  ok('B  chip 文案含列名与方向', String(s1.chip).includes('订单金额') && String(s1.chip).includes('降序'), String(s1.chip))
  ok('B  已排序列的指示器仍是图标（存在）', s1.indCount === s1.shCount, s1.indCount + ' / ' + s1.shCount)

  const c2 = await J(p, JS_CLICK_TH('订单金额'))
  await sleep(900)
  rq = await J(p, JS_LAST_REQ)
  console.log('  请求 #' + rq.n + ' → ' + rq.last)
  ok('B  第二次点击 ⇒ `order_dir=asc`（降 → 升）', rq.last.includes('order_by=total_amount') && rq.last.includes('order_dir=asc'), rq.last)

  const c3 = await J(p, JS_CLICK_TH('订单金额'))
  await sleep(900)
  rq = await J(p, JS_LAST_REQ)
  console.log('  请求 #' + rq.n + ' → ' + rq.last)
  ok('B  第三次点击 ⇒ **不再带** `order_by`（三态循环回到无排序）', !rq.last.includes('order_by'), rq.last)
  const s2 = await J(p, JS_STATE)
  ok('B  取消排序后 chip 消失', s2.chip === null, String(s2.chip))

  /* ══ C 关联单据穿透列 ════════════════════════════════════════════════════ */
  section('C 关联单据穿透（入库 / 货款 → 详情页 tab；退货 → 退货建单页）')
  ok('C  表头含「关联」列', s0.relTh === '关联', String(s0.relTh))
  ok('C  每行都有关联格', s0.relTd === 3, String(s0.relTd))

  const rel = await J(p, JS_REL_LINKS)
  if (rel.err) { ok('C  取到关联链接', false, rel.err) } else {
    const row0 = rel.cells[0] || { links: [] }
    console.log('  第 1 行链接 = ' + JSON.stringify(row0.links))
    const inb = row0.links.find((x) => x.text === '入库')
    const pay = row0.links.find((x) => x.text === '货款')
    const ret = row0.links.find((x) => x.text === '退货')
    ok('C  「入库」落到详情页 `?tab=inbound`（派生 tab，非独立单据页）',
      !!inb && inb.href === '#/inventory/purchase/101?tab=inbound', inb ? inb.href : 'missing')
    ok('C  「货款」落到详情页 `?tab=payments`',
      !!pay && pay.href === '#/inventory/purchase/101?tab=payments', pay ? pay.href : 'missing')
    ok('C  「退货」落到既有退货建单页 + `from_po`（带服务端可退上限）',
      !!ret && ret.href === '#/inventory/purchase/return/new?from_po=101', ret ? ret.href : 'missing')

    /* 退货入口只在「有可退量」的行出现：101 received ✓ / 102 draft ✗ / 103 partial ✓ */
    const withRet = rel.cells.filter((c) => c.links.some((x) => x.text === '退货')).length
    ok('C  **「退货」只在 已入库/部分入库 行出现**（草稿行不给假入口）', withRet === 2, withRet + ' / 3 行')
    const allHaveInb = rel.cells.every((c) => c.links.some((x) => x.text === '入库'))
    ok('C  每行都有「入库」「货款」（下游视图恒可达）', allHaveInb, '缺行数=' + rel.cells.filter((c) => !c.links.some((x) => x.text === '入库')).length)
  }

  /* ══ D 退货单视图：不该有关联列 ═════════════════════════════════════════ */
  section('D 采购退货单视图 · 不出现「关联」列（那批行本身就是退货单，没有"下游"）')
  const m2 = await hardLoad(p, '#/inventory/purchase?kind=return')
  console.log('  退货视图行数=' + m2.rows)
  const s3 = await J(p, JS_STATE)
  ok('D  退货视图关联表头**不存在**', s3.relTh === null, String(s3.relTh))
  ok('D  退货视图关联格**一个都没有**', s3.relTd === 0, String(s3.relTd))
  await p.screenshot(SHOTS + '/D1-退货视图.png').catch(() => {})

  /* ══ E 零控制台报错（能抓 `canSort is not defined` 这类模板绑定错） ═════ */
  section('E 零控制台报错')
  const errs = (await J(p, `(function(){ return JSON.stringify(window.__ERRS || []); })()`)) || []
  console.log('  报错 = ' + JSON.stringify(errs.slice(0, 5)))
  ok('E  全程**零控制台报错**', errs.length === 0, JSON.stringify(errs.slice(0, 3)))

  const dump = { probe: 'v470', at: new Date().toISOString(), listA: s0, sortB1: s1, sortB3: s2, rel, retView: s3, errors: errs }
  try {
    fs.writeFileSync(SHOTS + '/measurements.json', JSON.stringify(dump, null, 2))
    console.log('\n  量测原始数据 → outputs/v470-po-list/measurements.json')
  } catch { /* ignore */ }

  console.log('\n' + '='.repeat(90))
  console.log('  PASS ' + PASS.length + '   FAIL ' + FAIL.length)
  if (FAIL.length) { console.log('  FAILED:'); FAIL.forEach((f) => console.log('   - ' + f)) }
  console.log('  VERDICT: ' + (FAIL.length ? 'HAS_FAIL' : 'ALL_PASS'))
  console.log('='.repeat(90))
  try { await browser.close() } catch { /* ignore */ }
  try { r.srv.close() } catch { /* ignore */ }
  process.exit(FAIL.length ? 1 : 0)
}

main().catch((e) => { console.error('探针异常：', e); process.exit(2) })
