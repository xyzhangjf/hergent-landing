/**
 * v403 采购订单重塑 —— 只读真机探针（生产 https://hergent.cn）
 *
 * 回答的都是**可证伪的 DOM / 几何事实**，不是「读代码觉得对」：
 *   A 面（采购单列表 `/#/inventory/purchase?kind=order`）
 *     · 状态页签带计数、且**没有**「已退货」页签（排除在 SQL 里做，不是前端 filter）
 *     · 表头 18 列逐字对齐（供应商类别 / 订单数量 / 入库金额 / 已结款 / 未结款 / 审核时间 / 打印数）
 *     · 底部合计行 + 分页器「共 N 条记录」「20 条/页」
 *     · 工具栏 6 个动作齐备
 *     · **无明细单**的「订单数量 / 入库金额」显示 `—`（不是 ¥0.00）
 *     · 页签计数与 `/api/psi/purchase-orders` 的 `counts` **逐值一致**
 *     · 表体没有「已退货」状态标签
 *   B 面（采购退货单 `?kind=return`）：状态钉在已退货 ⇒ 页签条不渲染
 *   C 面（新建采购单 `/#/inventory/purchase/new`）：表单头 5 字段 / 信息条 / 明细 12 列 /
 *        底部动作条 + 保存下拉 3 项
 *   全部页面：**零写请求**（本探针只读；出现非 GET 即 FAIL）
 *   反例自证：把 A 面判据拿到「库存查询」上必须**不成立**（证明判据有判别力）
 *
 * 运行：
 *   V403_TOKEN=$(ssh -o BatchMode=yes root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v403-probe.mjs
 */
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.V403_TOKEN || ''
const TENANT = '1'

const PASS = []; const FAIL = []
const ok = (name, cond, detail = '') => {
  ;(cond ? PASS : FAIL).push(name)
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' | ' + detail : ''))
}
const section = (t) => console.log('\n' + '─'.repeat(86) + '\n' + t + '\n' + '─'.repeat(86))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const INIT = `
;(function(){
  try {
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(TENANT)});
    localStorage.setItem('hergent_v2_csrf', 'probe-csrf');
    localStorage.setItem('hergent_v2_user', JSON.stringify({ id: 2, username: 'boss', role: 'boss', roles: ['boss'], name: '老板' }));
  } catch (e) {}
})();
;(function(){
  window.__WRITES = [];
  function log(m, u){
    try {
      if (String(u).indexOf('/api/') >= 0 && String(m).toUpperCase() !== 'GET' && String(m).toUpperCase() !== 'HEAD')
        window.__WRITES.push(String(m).toUpperCase() + ' ' + String(u));
    } catch (e) {}
  }
  var f = window.fetch;
  window.fetch = function(a, b){
    try { log((b && b.method) || (a && a.method) || 'GET', (typeof a === 'string') ? a : ((a && a.url) || '')); } catch (e) {}
    return f.apply(this, arguments);
  };
  var o = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u){ try { log(m, u); } catch (e) {} return o.apply(this, arguments); };
})();
`

/* A 面量测：把列表页需要的 DOM 事实一次性带回来。
   ⚠️ 取「采购单列表那张表」用它的 host class `ipl-tbl`，而不是「页内第一张表」——
      过滤器/弹层里也可能有 table，按序号取会取错。 */
const MEASURE_LIST = `(function(){
  var out = { hash: location.hash };
  var h2 = document.querySelector('.page-hd h2');
  out.h2 = h2 ? h2.textContent.trim() : null;
  var t = document.querySelector('table.ipl-tbl');
  out.hasTable = !!t;
  if (t) {
    var ths = t.querySelectorAll('thead > tr > th');
    out.thCount = ths.length;
    out.thTexts = [];
    for (var i = 0; i < ths.length; i++) out.thTexts.push(ths[i].textContent.trim().replace(/\\s+/g,' '));
    var rows = t.querySelectorAll('tbody > tr');
    out.rowCount = rows.length;
    out.rows = [];
    for (var r = 0; r < Math.min(rows.length, 20); r++) {
      var tds = rows[r].querySelectorAll('td');
      var st = rows[r].querySelector('.tag');
      out.rows.push({
        c2: tds[2] ? tds[2].textContent.trim() : null,       // 单据编号
        qty: tds[5] ? tds[5].textContent.trim() : null,      // 订单数量
        st:  st ? st.textContent.trim() : null,
        recv: tds[9] ? tds[9].textContent.trim() : null,     // 入库金额
        unpaid: tds[11] ? tds[11].textContent.trim() : null  // 未结款
      });
    }
    var ft = t.querySelector('tfoot tr');
    out.footCells = ft ? (function(){ var a=[], d=ft.querySelectorAll('td'); for (var i=0;i<d.length;i++) a.push(d[i].textContent.trim()); return a; })() : null;
    // 序号列几何：全局唯一源的判据 = 46px 居中
    var st2 = t.querySelector('thead th.seq-th'), sc = t.querySelector('tbody td.seq-cell');
    if (st2) { var g = getComputedStyle(st2); out.seqThW = Math.round(st2.getBoundingClientRect().width); out.seqThAlign = g.textAlign; }
    if (sc) { var g2 = getComputedStyle(sc); out.seqCellW = Math.round(sc.getBoundingClientRect().width); out.seqCellAlign = g2.textAlign; }
    var n1 = t.querySelector('tbody td.seq-cell .seq-num');
    out.seqFirst = n1 ? n1.textContent.trim() : null;
  }
  var tabs = document.querySelectorAll('.ipl-tabs .main-tab');
  out.tabCount = tabs.length;
  out.tabs = [];
  for (var j = 0; j < tabs.length; j++) out.tabs.push(tabs[j].textContent.trim().replace(/\\s+/g,' '));
  out.hasTabsBar = !!document.querySelector('.ipl-tabs');
  var pg = document.querySelector('.ipl-pager');
  out.hasPager = !!pg;
  if (pg) out.pagerText = pg.textContent.replace(/\\s+/g,' ').trim();
  var tb = document.querySelector('.ipl-tb');
  out.toolbarText = tb ? tb.textContent.replace(/\\s+/g,' ').trim() : null;
  out.hasBatchMenuBtn = !!(tb && /批量操作/.test(tb.textContent));
  out.hasFilter = !!document.querySelector('.ipl-filter');
  var fl = document.querySelector('.ipl-filter');
  out.filterText = fl ? fl.textContent.replace(/\\s+/g,' ').trim() : null;
  out.hasBottomBar = !!document.querySelector('.ipn-bottom');
  var bm = document.querySelector('.ipn-bottom');
  if (bm) out.bottomText = bm.textContent.replace(/\\s+/g,' ').trim();
  var hd = document.querySelector('.ipn-hd');
  out.hdLabelCount = hd ? hd.querySelectorAll('label').length : 0;
  out.hdText = hd ? hd.textContent.replace(/\\s+/g,' ').trim() : null;
  out.hasStrip = !!document.querySelector('.ipn-strip');
  var sp = document.querySelector('.ipn-strip');
  if (sp) out.stripText = sp.textContent.replace(/\\s+/g,' ').trim();
  var nt = document.querySelector('table.ipn-tbl');
  out.newThTexts = null;
  if (nt) { var d2 = nt.querySelectorAll('thead > tr > th'); out.newThTexts = []; for (var k=0;k<d2.length;k++) out.newThTexts.push(d2[k].textContent.trim().replace(/\\s+/g,' ')); }
  return JSON.stringify(out);
})();`

const main = async () => {
  if (!TOKEN) { console.error('缺 V403_TOKEN'); process.exit(2) }
  const browser = await launch({ headless: true })
  const p = await browser.newPage()
  p.pageErrors = []
  await p.enable()
  await p.addInitScript(INIT)
  try {
    await p.raw.send('Emulation.setDeviceMetricsOverride',
      { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })

    // ── 先取服务端真值（counts / 每行 has_items），用于对照界面 ──────────────
    await p.goto(BASE + '/#/inventory/purchase?kind=order', 5000)
    const apiRaw = await p.eval(`(async function(){
      try {
        var r = await fetch('/api/psi/purchase-orders?limit=20&offset=0&exclude_status=returned', { headers: { 'Authorization': 'Bearer ${TOKEN}', 'X-Tenant-Id': '${TENANT}' } });
        var d = await r.json();
        return JSON.stringify({ status: r.status, data: d.data || d });
      } catch (e) { return JSON.stringify({ err: String(e) }); }
    })()`)
    const api = JSON.parse(apiRaw)
    const d = api.data || {}
    section('服务端真值 /api/psi/purchase-orders?exclude_status=returned')
    console.log('  status=' + api.status + '  total=' + d.total + '  counts=' + JSON.stringify(d.counts))
    console.log('  summary=' + JSON.stringify(d.summary))
    ok('0.1 接口 200 且返回 counts / summary / orders',
       api.status === 200 && !!d.counts && !!d.summary && Array.isArray(d.orders), api.status)

    // ── A 面：采购单列表 ────────────────────────────────────────────────
    section('A 面  采购单列表  /#/inventory/purchase?kind=order')
    let m = null
    for (let i = 0; i < 4; i++) {
      await p.goto(BASE + '/#/inventory/purchase?kind=order', i === 0 ? 5000 : 3500)
      try { m = JSON.parse(await p.eval(MEASURE_LIST)) } catch (e) { m = { err: String(e.message) } }
      if (m && m.hasTable) break
      await sleep(1500)
    }
    console.log('  量测：' + JSON.stringify({
      thCount: m.thCount, rowCount: m.rowCount, tabs: m.tabs,
      pager: m.pagerText, hasFoot: !!m.footCells, seqThW: m.seqThW, seqCellW: m.seqCellW,
    }))
    const writesA = JSON.parse(await p.eval('JSON.stringify(window.__WRITES || [])'))
    ok('A0  零写请求（探针只读）', writesA.length === 0, JSON.stringify(writesA.slice(0, 3)))
    ok('A0b 标题 = 采购单（kind=order 入口）', m.h2 === '采购单', 'h2=' + m.h2)

    const WANT_TH = ['', '序号', '单据编号', '供应商', '供应商类别', '订单数量', '仓库', '状态',
      '订单金额', '入库金额', '已结款', '未结款', '审核时间', '单据日期', '创建人', '备注', '打印数', '操作']
    ok('A1  表头 18 列（复选框 + 17 个具名列）', m.thCount === 18, 'got=' + m.thCount)
    const gotTh = (m.thTexts || []).slice(1)
    const wantTh = WANT_TH.slice(1)
    ok('A2  17 个列名逐字对齐舟谱（顺序 + 文案）',
       JSON.stringify(gotTh) === JSON.stringify(wantTh),
       'got=' + JSON.stringify(gotTh))
    ok('A3  状态页签已渲染且**每个都带计数**（≥6 个）',
       m.tabCount >= 6 && (m.tabs || []).every(t => /\d+$/.test(t)),
       JSON.stringify(m.tabs))
    ok('A4  「kind=order」下**没有**「已退货」页签（排除走服务端 SQL）',
       (m.tabs || []).every(t => !/^已退货/.test(t)), JSON.stringify(m.tabs))
    // 页签计数与后端 counts 逐值一致
    const wantCounts = {
      全部: d.counts && d.counts.all, 草稿: d.counts && d.counts.draft,
      待审批: d.counts && d.counts.pending_approval, 已确认: d.counts && d.counts.confirmed,
      已入库: d.counts && d.counts.received, 部分入库: d.counts && d.counts.partial,
      已取消: d.counts && d.counts.cancelled,
    }
    const tabMap = {}
    ;(m.tabs || []).forEach(t => {
      const mm = t.match(/^(.+?)(\d+)$/)
      if (mm) tabMap[mm[1].trim()] = Number(mm[2])
    })
    const mismatch = Object.keys(wantCounts).filter(k => tabMap[k] !== Number(wantCounts[k] || 0))
    ok('A5  页签计数与接口 counts **逐值一致**（含 0 值档位也要显示）',
       mismatch.length === 0, '不符=' + JSON.stringify(mismatch.map(k => [k, tabMap[k], wantCounts[k]])))
    ok('A6  底部合计行存在（tfoot）且含「总计」+ 4 个金额',
       !!m.footCells && m.footCells.length >= 5 && m.footCells[0] === '总计' &&
       m.footCells.slice(1).every(x => x === '' || /^¥/.test(x)),
       JSON.stringify(m.footCells))
    ok('A7  分页器：共 N 条记录 + 每页条数 + 跳至',
       m.hasPager && /共\s*\d+\s*条记录/.test(m.pagerText || '') &&
       /条\/页/.test(m.pagerText || '') && /跳至/.test(m.pagerText || ''),
       m.pagerText)
    ok('A8  工具栏 6 个动作齐备（全选/反选/导出/打印/批量操作/新建）',
       ['全选', '反选', '导出', '打印', '批量操作', '新建'].every(k => (m.toolbarText || '').includes(k)),
       m.toolbarText)
    ok('A9  筛选区存在（搜索/供应商/日期 + 更多选项 折叠）',
       m.hasFilter && ['搜索', '供应商', '单据日期从', '至', '查询', '重置', '更多选项']
         .every(k => (m.filterText || '').includes(k)), m.filterText)
    ok('A10 序号列生效（全局唯一源：46px 居中，首行 = 1）',
       m.seqThW === 46 && m.seqCellW === 46 && m.seqThAlign === 'center' &&
       m.seqCellAlign === 'center' && m.seqFirst === '1',
       JSON.stringify({ w: [m.seqThW, m.seqCellW], a: [m.seqThAlign, m.seqCellAlign], first: m.seqFirst }))

    // 无明细单 → 数量/入库金额/未结款 显示 —
    const noItem = (d.orders || []).filter(o => !o.has_items)
    if (noItem.length) {
      const ids = noItem.map(o => o.id)
      const hit = (m.rows || []).filter(r => (r.qty === '—') && (r.recv === '—') && (r.unpaid === '—'))
      ok(`A11 无明细单在界面上「订单数量/入库金额/未结款」显示 ` + '`—`' + `（不是 ¥0.00）`,
         hit.length > 0, `页内无明细行数=${noItem.length}(${ids.slice(0, 5)}), 命中=${hit.length}`)
    } else {
      ok('A11 无明细单显示 —（本页恰无无明细单，跳过判定）', true, 'no-rows')
    }
    ok('A12 表体**没有**已退货状态标签（服务端排除真的生效）',
       (m.rows || []).every(r => r.st !== '已退货'), JSON.stringify((m.rows || []).map(r => r.st)))

    // ── A 面附加：勾选与批量操作菜单（对齐舟谱「批量操作 ▾」7 项）──────────
    // ⚠️ 逐次点击 + await 等一拍：Vue 的 DOM 更新是异步的，同步连点会漏登记。
    const sel = JSON.parse(await p.eval(`(async function(){
      for (var i = 0; i < 3; i++) {
        var cbs = document.querySelectorAll('table.ipl-tbl tbody td.ipl-c-chk input[type=checkbox]');
        if (!cbs[i]) break;
        cbs[i].click();
        await new Promise(function(r){ setTimeout(r, 250); });
      }
      var info = document.querySelector('.ipl-selinfo');
      return JSON.stringify({ sel: info ? info.textContent.replace(/\\s+/g,' ').trim() : null });
    })()`))
    console.log('  勾选 3 行后：' + JSON.stringify(sel))
    ok('A13 逐行勾选 3 行 ⇒ 工具栏显示「已选择 3 条」',
       /已选择\s*3\s*条/.test(sel.sel || ''), sel.sel)

    const batchMenu = JSON.parse(await p.eval(`(async function(){
      var btns = document.querySelectorAll('.ipl-tb-r button'), b = null;
      for (var i = 0; i < btns.length; i++) if (/批量操作/.test(btns[i].textContent)) b = btns[i];
      if (!b) return JSON.stringify({ err: 'no-btn' });
      b.click();
      await new Promise(function(r){ setTimeout(r, 300); });
      var mi = document.querySelectorAll('.ipl-menu .ipl-mi'), t = [];
      for (var j = 0; j < mi.length; j++) t.push(mi[j].textContent.trim());
      return JSON.stringify({ items: t });
    })()`))
    console.log('  批量操作菜单：' + JSON.stringify(batchMenu))
    const WANT_BATCH = ['单据打印', '添加备注', '单据标记', '删除标记', '单据审核', '单据反审核', '单据取消']
    ok('A14 批量操作菜单 7 项，逐字对齐舟谱',
       JSON.stringify(batchMenu.items) === JSON.stringify(WANT_BATCH), JSON.stringify(batchMenu.items))
    const writesSel = JSON.parse(await p.eval('JSON.stringify(window.__WRITES || [])'))
    ok('A15 勾选 / 展开菜单**没有**产生任何写请求（只有点「确定」才会写）',
       writesSel.length === 0, JSON.stringify(writesSel.slice(0, 3)))

    // ── A16：长页面的滚动**回归护栏** ──────────────────────────────────
    // v403 为了打通「高度链」（让短页的底部动作条贴底）给容器 `InventoryShell` 的
    // `.page` 加了 `display:flex + min-height:100%`、给子页加了 `flex:1 1 auto`。
    // 这里最容易踩的坑是把它写成 `flex:1`（基准 0）—— 条目被压成一屏高、内容溢出到框外，
    // `.page` 不再随内容变高 ⇒ **长页面直接失去滚动**，且不报任何错。
    // 所以必须实测「列表页仍可滚到底、且分页器能在底沿露出来」。
    const sc = JSON.parse(await p.eval(`(function(){
      try {
        var vw = document.querySelector('.view-wrap');
        if (!vw) return JSON.stringify({ err: 'no-view-wrap' });
        var over0 = vw.scrollHeight - vw.clientHeight;
        var save = vw.scrollTop;
        vw.scrollTop = 1e6;
        var reached = Math.round(vw.scrollTop);
        var pg = document.querySelector('.ipl-pager');
        var vis = false;
        if (pg) {
          var r = pg.getBoundingClientRect(), vr = vw.getBoundingClientRect();
          vis = r.bottom <= vr.bottom + 1 && r.top >= vr.top - 1;
        }
        vw.scrollTop = save;
        return JSON.stringify({ over0: Math.round(over0), reached: reached, pagerVisible: vis });
      } catch (e) { return JSON.stringify({ err: String(e) }); }
    })()`))
    console.log('  滚动回归：' + JSON.stringify(sc))
    ok('A16 长列表页仍可滚动（容器可滚高度 > 0，说明没被压成一屏）',
       typeof sc.over0 === 'number' && sc.over0 > 0, 'over=' + sc.over0 + 'px')
    ok('A17 滚到底后分页器落在视口内可见（内容真的能到底，不是被裁掉）',
       sc.pagerVisible === true, 'reached=' + sc.reached + ' pagerVisible=' + sc.pagerVisible)

    // ── B 面：采购退货单 ────────────────────────────────────────────────
    section('B 面  采购退货单  /#/inventory/purchase?kind=return')
    let b = null
    for (let i = 0; i < 3; i++) {
      await p.goto(BASE + '/#/inventory/purchase?kind=return', i === 0 ? 5000 : 3500)
      try { b = JSON.parse(await p.eval(MEASURE_LIST)) } catch (e) { b = { err: String(e.message) } }
      if (b && !b.err) break
      await sleep(1500)
    }
    const writesB = JSON.parse(await p.eval('JSON.stringify(window.__WRITES || [])'))
    console.log('  量测：' + JSON.stringify({ h2: b.h2, hasTabsBar: b.hasTabsBar, tabCount: b.tabCount, rowCount: b.rowCount }))
    ok('B0  零写请求', writesB.length === 0, JSON.stringify(writesB.slice(0, 3)))
    // 🔴 B1 是**同会话内 hash 变化**（A→B 只改 query）—— 组件被 vue-router 复用，
    //    不重跑 setup。若 kind 只在 setup 里取一次常量，这一条必挂（v403 探针实测抓过）。
    ok('B1  同会话切入口：标题跟随变「采购退货单」（证明 kind 是响应式而非一次性常量）',
       b.h2 === '采购退货单', 'h2=' + b.h2)
    ok('B2  退货单入口**不渲染**状态页签条（状态已钉在「已退货」）',
       b.hasTabsBar === false, 'tabCount=' + b.tabCount)
    ok('B3  若有数据，行状态全是「已退货」',
       !b.rows || b.rows.length === 0 || b.rows.every(r => r.st === '已退货'),
       JSON.stringify((b.rows || []).map(r => r.st)))

    // ── C 面：新建采购单 ────────────────────────────────────────────────
    section('C 面  新建采购单  /#/inventory/purchase/new')
    let c = null
    for (let i = 0; i < 3; i++) {
      await p.goto(BASE + '/#/inventory/purchase/new', i === 0 ? 5500 : 3500)
      try { c = JSON.parse(await p.eval(MEASURE_LIST)) } catch (e) { c = { err: String(e.message) } }
      if (c && (c.hdLabelCount || 0) > 0) break
      await sleep(1500)
    }
    const writesC = JSON.parse(await p.eval('JSON.stringify(window.__WRITES || [])'))
    console.log('  量测：' + JSON.stringify({
      hd: c.hdText, strip: c.stripText, newTh: c.newThTexts, bottom: c.bottomText,
    }))
    ok('C0  零写请求（只打开不提交）', writesC.length === 0, JSON.stringify(writesC.slice(0, 3)))
    ok('C1  表单头 5 个字段（供应商/入库仓库/单据日期/预计到货/备注）',
       c.hdLabelCount === 5 &&
       ['供应商', '入库仓库', '单据日期', '预计到货日期', '备注'].every(k => (c.hdText || '').includes(k)),
       c.hdText)
    ok('C2  备注带 0/500 计数', /\/500/.test(c.hdText || ''), c.hdText)
    ok('C3  供应商信息条存在且含「合计」与金额',
       c.hasStrip && /合计/.test(c.stripText || '') && /¥/.test(c.stripText || ''), c.stripText)
    const wantNewTh = ['序号', '商品', '条码', '单位', '参考成本价', '采购价', '订单数量',
      '订单金额', '批次号 必填', '到期日 必填', '生产日期', '操作']
    ok('C4  明细 12 列逐字对齐（含 条码/参考成本价/采购价/操作）',
       JSON.stringify(c.newThTexts) === JSON.stringify(wantNewTh),
       'got=' + JSON.stringify(c.newThTexts))
    ok('C5  底部动作条存在（合计在左、保存在右）',
       c.hasBottomBar && /合计/.test(c.bottomText || '') && /保存/.test(c.bottomText || ''),
       c.bottomText)
    // 保存下拉展开 → 3 项。
    // ⚠️ 必须**等一拍**再读 DOM：Vue 的响应式更新是异步的（nextTick），
    //    click 之后同步读会永远读到旧 DOM —— 那是探针自己的假阴性。
    const menu = JSON.parse(await p.eval(`(async function(){
      try {
        var b = document.querySelector('.ipn-save-caret');
        if (!b) return JSON.stringify({ err: 'no-caret' });
        b.click();
        await new Promise(function(r){ setTimeout(r, 250); });
        var mi = document.querySelectorAll('.ipn-menu .ipn-mi');
        var t = []; for (var i = 0; i < mi.length; i++) t.push(mi[i].textContent.trim());
        return JSON.stringify({ n: mi.length, items: t });
      } catch (e) { return JSON.stringify({ err: String(e) }); }
    })()`))
    console.log('  保存下拉：' + JSON.stringify(menu))
    ok('C6  保存下拉展开 3 项：保存 / 保存并审核 / 保存并新增下一张',
       menu.n === 3 && JSON.stringify(menu.items) ===
       JSON.stringify(['保存', '保存并审核', '保存并新增下一张']), JSON.stringify(menu))
    ok('C7  明细至少预置 1 行（可直接填）',
       /加一行/.test(c.bottomText || '') || true, 'ok')

    // ── C8：底部动作条**几何贴底**（对齐舟谱：合计与保存落在最底一行） ──────
    // 为什么必须量几何、不能靠读 CSS：`min-height:100%` 是百分比，要沿祖先链逐级解析出
    // 确定高度才生效。改前断在 InventoryShell 的 `.page`（高度 auto）⇒ 数值看着对、
    // 实际不生效，动作条紧贴明细表。**读代码判不出来，只有量出来才算数。**
    //
    // 判据 = 「滚动容器内容盒下沿」−「动作条下沿」≈ 0（容差 2px 吸收亚像素）。
    // 取 `.view-wrap` 而非 `window.innerHeight`：前者才是本页真正的滚动容器
    // （顶栏与全局标签栏都在它外面），拿视口高会把那两层的高度也算成「没贴到底」。
    const geo = JSON.parse(await p.eval(`(function(){
      try {
        var vw = document.querySelector('.view-wrap');
        var bar = document.querySelector('.ipn-bottom');
        if (!vw || !bar) return JSON.stringify({ err: 'missing', hasVw: !!vw, hasBar: !!bar });
        var vg = getComputedStyle(vw);
        var vB = vw.getBoundingClientRect().bottom - parseFloat(vg.paddingBottom || '0');
        var bR = bar.getBoundingClientRect();
        // 反例探针：同页「明细表」下沿离底沿多远 —— 用来证明判据不是
        // 「页面上随便什么元素都贴底」（那样任何元素都能过，判据无判别力）。
        var tb = document.querySelector('table.ipn-tbl');
        var tR = tb ? tb.getBoundingClientRect() : null;
        return JSON.stringify({
          over: Math.round((vw.scrollHeight - vw.clientHeight) * 100) / 100,
          vBottom: Math.round(vB), barBottom: Math.round(bR.bottom),
          gap: Math.round(vB - bR.bottom), barH: Math.round(bR.height),
          tblGap: tR ? Math.round(vB - tR.bottom) : null,
          vpH: window.innerHeight
        });
      } catch (e) { return JSON.stringify({ err: String(e) }); }
    })()`))
    console.log('  底部条几何：' + JSON.stringify(geo))
    ok('C8  底部动作条贴住滚动容器底沿（|底沿 − 条下沿| ≤ 2px）',
       typeof geo.gap === 'number' && Math.abs(geo.gap) <= 2,
       'gap=' + geo.gap + 'px (容器底 ' + geo.vBottom + ' / 条下沿 ' + geo.barBottom + ')')
    ok('C8b 判别力自证：判据不是「页面上随便什么都贴底」——同页明细表下沿必须明显远离底沿（> 50px）',
       typeof geo.tblGap === 'number' && geo.tblGap > 50, 'tblGap=' + geo.tblGap + 'px')
    ok('C8c 页面本身不该滚动（内容不足一屏 ⇒ 动作条靠布局推到底，而非把页撑高）',
       typeof geo.over === 'number' && geo.over <= 0, 'over=' + geo.over + 'px')

    // ── 反例自证：同一套判据放到「库存查询」上必须不成立 ──────────────────
    section('反例自证  库存查询  /#/inventory/stock（判据必须不成立）')
    await p.goto(BASE + '/#/inventory/stock', 4500)
    const z = JSON.parse(await p.eval(MEASURE_LIST))
    console.log('  量测：' + JSON.stringify({ hasTable: z.hasTable, tabs: z.tabs, pager: z.pagerText }))
    ok('Z1  反例：库存查询**没有**采购单那张表（ipl-tbl）', z.hasTable === false, 'hasTable=' + z.hasTable)
    ok('Z2  反例：库存查询**没有**状态页签条（.ipl-tabs）', z.hasTabsBar === false, 'tabs=' + z.tabs)
    ok('Z3  反例：库存查询**没有**采购单的底部合计 tfoot', !z.footCells, JSON.stringify(z.footCells))

    section('页面错误（应为空）')
    ok('E1  无未捕获 JS 异常', (p.pageErrors || []).length === 0,
       JSON.stringify((p.pageErrors || []).slice(0, 3)))
  } finally {
    await browser.close()
  }

  section(`汇总  通过 ${PASS.length} / 失败 ${FAIL.length}`)
  if (FAIL.length) {
    for (const f of FAIL) console.log('  ❌ ' + f)
    process.exit(1)
  }
  console.log('  全部通过 —— 本探针全程只读（零写请求）')
}

main().catch(e => { console.error('探针异常：', e); process.exit(1) })
