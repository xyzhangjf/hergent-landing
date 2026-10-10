/**
 * v444 进销存建单页 —— **四项改动**的真机探针（生产 https://hergent.cn，boss 登录态）
 *
 * 验的是《进销存建单页开发规范-v441.md》本轮新增的 §4.1 / §4.5 / §4.6 / §7.4
 * 落到**真实浏览器**上的可证伪事实，不是「读代码觉得对」：
 *
 *   A 明细表**出厂 15 行**（规范 §4.1）：销售订单表 / 采购订单表的 tbody 行数 === 15
 *   B 明细表必填项**红 `*`**（规范 §4.5）：订单表 3 枚（商品 / 数量·订单数量 / 单价·采购价）、
 *     退货表 1 枚（退货数量）；且**与表单头「客户 / 供应商」同一枚类、同一个色值**
 *     —— 这是「统一使用与供应商项相同的红心标记」这句话唯一的机械判据。
 *   C 明细表输入框**无底色**（规范 §4.6）：格内 input 的 computed background 必须是
 *     透明；**表单头里的输入框仍是有底色的**（反例自证：证明只撤了明细表，没撤一片）
 *   D 列宽**可拖动**（规范 §4.5/§7.4）：合成 mousedown→mousemove→mouseup ⇒ th 真的变宽、
 *     再拖窄、双击复位；宽度写进 localStorage；序号列**没有**手柄（反例自证）
 *   E 零控制台报错 + 零写请求
 *
 * ── 探针自己会判错的坑（本文件已规避）────────────────────────────────────
 *   ① 只差 hash 的 `Page.navigate` 在 Chrome 是**同文档导航** ⇒ 文档不重载、
 *      Vue 不重建 ⇒ 必须给文档 URL 加一次性 query `'/?__r=' + Date.now() + hash`。
 *   ② 合成拖动的 mousemove/mouseup 必须派发到 **document**（实现就挂在那里），
 *      派发到手柄自己收不到 ⇒ 会误判成"拖不动"。
 *   ③ 拖动是**响应式**写入 style ⇒ 派发完要等一帧再量宽度，否则量到旧值。
 *   ④ 「无底色」的判据是 `rgba(0, 0, 0, 0)`（transparent 的计算值），
 *      不能用 `background === 'transparent'`（computed 里是 rgba 形式）。
 *
 * 运行：
 *   V444_TOKEN=$(ssh -o BatchMode=yes root@47.113.224.140 \
 *       'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v444-psi-new-e2e.mjs
 */
import { launch } from './lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TOKEN = process.env.V444_TOKEN || ''
const TENANT = process.env.V444_TENANT || '1'
/* 🔴 这份 user 必须与 `TOKEN` 是**同一个账号**：前端拿 localStorage 里的
   `role` 判路由/菜单权限，而 API 请求用的是 token —— 两者不一致时页面会
   直接被踢到 `#/login`，表现为「量测 {}」（所有字段 undefined），极具迷惑性。
   换令牌时**必须**跟着改这里（或用 V444_USER_JSON 覆盖）。 */
const USER_JSON = process.env.V444_USER_JSON ||
  JSON.stringify({ id: 1, username: 'admin', role: 'admin', roles: ['admin'], name: '管理员' })
const SHOTS = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v444-psi-new'
try { fs.mkdirSync(SHOTS, { recursive: true }) } catch { /* ignore */ }

const PASS = []; const FAIL = []; const SKIP = []
const ok = (name, cond, detail = '') => {
  ;(cond ? PASS : FAIL).push(name)
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  | ' + detail : ''))
}
const skip = (name, why) => { SKIP.push(name); console.log('  SKIP  ' + name + '  | ' + why) }
const section = (t) => console.log('\n' + '─'.repeat(90) + '\n' + t + '\n' + '─'.repeat(90))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/* ── 注入：token + 写请求监听 + 控制台报错收集 ─────────────────────────────── */
const INIT = `
;(function(){
  try {
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(TENANT)});
    localStorage.setItem('hergent_v2_csrf', 'probe-csrf');
    localStorage.setItem('hergent_v2_user', ${JSON.stringify(USER_JSON)});
  } catch (e) {}
})();
;(function(){
  window.__WRITES = []; window.__ERRS = [];
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
  window.addEventListener('error', function(e){ try { window.__ERRS.push('error: ' + (e.message || '')) } catch(_){} });
  window.addEventListener('unhandledrejection', function(e){ try { window.__ERRS.push('reject: ' + String(e.reason)) } catch(_){} });
})();
`

/* ── 量测：本轮四项改动的可证伪事实 ───────────────────────────────────────── */
const MEASURE = `(function(){
  try {
    var h = location.hash;
    var isPur = h.indexOf('/purchase/') >= 0;
    var isRet = /kind=return/.test(h);
    var root = isPur ? 'ipn' : 'isn';
    var q = function(s){ return document.querySelector(s); };
    var qa = function(s){ return document.querySelectorAll(s); };
    var out = { hash: h, isPur: isPur, isRet: isRet, root: root, errs: (window.__ERRS || []).slice() };
    var h2 = q('.page-hd h2'); out.title = h2 ? h2.textContent.trim() : null;

    var ot = q('table.' + root + '-tbl:not(.' + root + '-ret-tbl)');
    var rt = q('table.' + root + '-ret-tbl');
    var tbl = ot || rt;

    /* ── A 出厂行数 ─────────────────────────────────────────────────────── */
    out.ordRows = ot ? ot.querySelectorAll('tbody>tr').length : -1;
    out.retRows = rt ? rt.querySelectorAll('tbody>tr').length : -1;

    /* ── B 必填红心 ─────────────────────────────────────────────────────── */
    /* 表头里的红心：th > .<root>-req。逐列记住「哪一列带红心」，用于与校验口径对账。 */
    function reqOf (t) {
      if (!t) return null;
      var ths = t.querySelectorAll('thead>tr>th'); var a = [];
      for (var i = 0; i < ths.length; i++) {
        var r = ths[i].querySelector('.' + root + '-req');
        if (r) a.push({ th: ths[i].textContent.replace(/[\\s*]/g, ''), color: getComputedStyle(r).color });
      }
      return a;
    }
    out.ordReq = reqOf(ot);
    out.retReq = reqOf(rt);
    /* 表单头里的红心（"供应商"/"客户"）—— 红心必须**与它同一枚类、同一个色**。 */
    var hdReq = qa('.' + root + '-hd .' + root + '-req');
    out.hdReqN = hdReq.length;
    out.hdReqCls = hdReq.length ? hdReq[0].className : null;
    out.hdReqColor = hdReq.length ? getComputedStyle(hdReq[0]).color : null;

    /* ── C 输入框底色 ───────────────────────────────────────────────────── */
    function bg (el) { return el ? getComputedStyle(el).backgroundColor : null }
    var cellIn = tbl ? tbl.querySelector('tbody .' + root + '-in') : null;
    out.cellInBg = bg(cellIn);
    out.cellInTag = cellIn ? cellIn.tagName : null;
    /* 采购页的"文本态"格（.ipn-v）也是可编辑格，一并验。 */
    var v = isPur && tbl ? tbl.querySelector('tbody .ipn-v') : null;
    out.cellVBg = bg(v);
    /* 反例：表单头的**框**（表头分组 .<root>-hd-box 里的 .<root>-f，就是「供应商 / 客户」那一格）
       **应当仍有底色** var(--bg3) —— v436「与供应商输入框相同的背景色」指的就是它。
       🔴 判据必须量**框**而不是框里的 input：框里的 input 本来就是透明的
          （底色由框提供），量它会得到"两处都透明 ⇒ 反例不成立"的假结论。 */
    var hdF = q('.' + root + '-hd-box .' + root + '-f');
    out.hdBoxBg = bg(hdF);
    out.hdInBg = bg(q('.' + root + '-hd .input'));

    /* ── D 列宽拖动 ─────────────────────────────────────────────────────── */
    out.handleN = tbl ? tbl.querySelectorAll('thead .col-rsz').length : -1;
    out.seqHasHandle = tbl && tbl.querySelector('thead th.seq-th')
      ? !!tbl.querySelector('thead th.seq-th .col-rsz') : null;
    /* 拖动手柄所在列的初始宽（用于拖动前后的比较） */
    var firstTh = tbl ? tbl.querySelector('thead>tr>th:nth-child(2)') : null;
    out.firstThTxt = firstTh ? firstTh.textContent.replace(/[\\s*]/g, '') : null;
    out.firstThW = firstTh ? Math.round(firstTh.getBoundingClientRect().width) : -1;
    out.firstThHasHandle = firstTh ? !!firstTh.querySelector('.col-rsz') : null;
    var lsKey = 'hergent_colw_' + (isPur ? 'purchase-new' : 'inv-sale-new') + (isRet ? '-ret' : '');
    out.lsKey = lsKey;
    out.lsRaw = localStorage.getItem(lsKey);
    return JSON.stringify(out);
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

/* ── 交互：合成一次列宽拖动（mousedown → mousemove × N → mouseup）─────────────
   🔴 mousemove / mouseup 必须派发到 document —— useColResize 就是把监听挂在那里
      （手柄只有 7px 宽，挂在手柄上鼠标一拖出去就断了）。派发到手柄自己会收不到，
      那样会误判成"拖动没实现"。 */
const JS_DRAG = (nth, dx) => `(async function(){
  var tbl = document.querySelector('table.ipn-tbl:not(.ipn-ret-tbl)')
         || document.querySelector('table.isn-tbl:not(.isn-ret-tbl)')
         || document.querySelector('table.ipn-ret-tbl')
         || document.querySelector('table.isn-ret-tbl');
  if (!tbl) return JSON.stringify({ err: 'no-table' });
  var ths = tbl.querySelectorAll('thead>tr>th');
  var th = ths[${nth}];
  if (!th) return JSON.stringify({ err: 'no-th', nth: ${nth}, total: ths.length });
  var h = th.querySelector('.col-rsz');
  if (!h) return JSON.stringify({ err: 'no-handle', nth: ${nth} });
  var r = h.getBoundingClientRect();
  var x0 = Math.round(r.left + r.width / 2), y0 = Math.round(r.top + r.height / 2);
  var before = Math.round(th.getBoundingClientRect().width);
  h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x0, clientY: y0 }));
  await new Promise(function(r2){ setTimeout(r2, 60) });
  for (var i = 1; i <= 4; i++) {
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x0 + ${dx} * i / 4, clientY: y0 }));
    await new Promise(function(r2){ setTimeout(r2, 40) });
  }
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x0 + ${dx}, clientY: y0 }));
  await new Promise(function(r2){ setTimeout(r2, 350) });   /* 等 Vue 把 style 写回 DOM */
  var after = Math.round(th.getBoundingClientRect().width);
  return JSON.stringify({ nth: ${nth}, th: th.textContent.replace(/[\\s*]/g, ''),
    before: before, after: after, delta: after - before, want: ${dx},
    inlineW: th.style.width || '', inlineMinW: th.style.minWidth || '' });
})()`

/* ── 交互：双击手柄复位该列 ────────────────────────────────────────────────── */
const JS_DBL_RESET = (nth) => `(async function(){
  var tbl = document.querySelector('table.ipn-tbl:not(.ipn-ret-tbl)')
         || document.querySelector('table.isn-tbl:not(.isn-ret-tbl)')
         || document.querySelector('table.ipn-ret-tbl')
         || document.querySelector('table.isn-ret-tbl');
  if (!tbl) return JSON.stringify({ err: 'no-table' });
  var th = tbl.querySelectorAll('thead>tr>th')[${nth}];
  if (!th) return JSON.stringify({ err: 'no-th' });
  var h = th.querySelector('.col-rsz');
  if (!h) return JSON.stringify({ err: 'no-handle' });
  h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await new Promise(function(r){ setTimeout(r, 350) });
  return JSON.stringify({ nth: ${nth}, after: Math.round(th.getBoundingClientRect().width),
    inlineW: th.style.width || '' });
})()`

/* ── 交互：选客户（销售订单模式）—— 只为把页面推到"已就绪"态，不是本轮判据 ── */
const JS_PICK_CUSTOMER = `(async function(){
  var flds = document.querySelectorAll('.isn-hd-box .isn-f');
  for (var i = 0; i < flds.length; i++) {
    var lb = flds[i].querySelector('.isn-lb');
    if (lb && lb.textContent.replace(/[\\s*]/g, '') === '客户') {
      var sel = flds[i].querySelector('select.isn-sel');
      if (sel && sel.options.length > 1) {
        sel.value = sel.options[1].value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(function(r){ setTimeout(r, 1200) });
        return JSON.stringify({ ok: true });
      }
    }
  }
  return JSON.stringify({ err: 'no-customer' });
})()`

/* ── 交互：点一下采购页的「采购价」格，把它激活成 input ────────────────────
   🔴 为什么要点：v417j 起采购明细表是「点哪格哪格才是输入框」，默认态 tbody 里
      **一个 input 都没有**（全是 .ipn-v 文本态）⇒ 不交互就量 `.ipn-in` 会得到 null，
      那是设计如此，不是缺陷。销售页是常驻 input（select/input），不需要这一步。 */
const JS_ACTIVATE_PRICE = `(async function(){
  var td = document.querySelector('table.ipn-tbl:not(.ipn-ret-tbl) tbody td.ipn-c-price');
  if (!td) return JSON.stringify({ err: 'no-price-cell' });
  td.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise(function(r){ setTimeout(r, 600) });
  var inp = td.querySelector('input.ipn-in');
  return JSON.stringify({ ok: !!inp, tag: inp ? inp.tagName : null });
})()`

const J = (p, expr) => p.eval(expr).then(JSON.parse)

async function hardLoad (p, hash, wait0 = 7000) {
  let m = null
  for (let i = 0; i < 5; i++) {
    /* 🔴 文档 URL 必须带一次性 query：只差 hash 的导航在 Chrome 里是**同文档导航**，
       文档不重载、Vue 不重建 ⇒ 量到的是上一个入口的残留 DOM。 */
    await p.goto(BASE + '/?__r=' + Date.now() + hash, i === 0 ? wait0 : 4500)
    m = await J(p, MEASURE)
    if (m && m.title) break
    await sleep(1200)
  }
  return m
}

const RED = /^rgb\(255,\s*(59|69),\s*(48|58)\)$/   /* --dan：浅色 #ff3b30 / 深色 #ff453a */

const main = async () => {
  const browser = await launch({ headless: true })
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(INIT)
  await p.raw.send('Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })

  const errsSeen = []
  const pages = [
    { name: '自提订单', hash: '#/inventory/sale/new?type=self_pickup&kind=order', pur: false, ret: false },
    { name: '新建采购单', hash: '#/inventory/purchase/new?kind=order', pur: true, ret: false },
  ]

  section('A 明细表出厂 15 行（规范 §4.1）')
  for (const c of pages) {
    const m = await hardLoad(p, c.hash)
    await p.screenshot(SHOTS + '/A-' + c.name + '.png').catch(() => {})
    console.log('  [' + c.name + '] title=' + JSON.stringify(m.title) + ' 行数=' + m.ordRows)
    ok(`A  ${c.name}：明细表出厂 **15 行**空行`, m.ordRows === 15, '实际 ' + m.ordRows + ' 行')
    ok(`A  ${c.name}：页面标题正确`, m.title === (c.pur ? '新建采购单' : '新建自提订单'), String(m.title))
    errsSeen.push(...(m.errs || []))
  }

  section('B 明细表必填项红 `*` —— 与表单头「供应商 / 客户」同一枚标记（规范 §4.5）')
  for (const c of pages) {
    const m = await hardLoad(p, c.hash)
    const want = c.pur ? ['商品', '采购价', '订单数量'] : ['商品', '数量', '单价']
    const got = (m.ordReq || []).map(x => x.th)
    console.log('  [' + c.name + '] 表头红心 = ' + JSON.stringify(got) +
      '  表单头红心 ' + m.hdReqN + ' 枚（类 ' + m.hdReqCls + ' / 色 ' + m.hdReqColor + '）')
    ok(`B  ${c.name}：明细表必填 **3 列**打了红 *，且逐字为 ${want.join('/')}`,
      JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got))
    ok(`B  ${c.name}：红心与表单头是**同一枚类**（${c.pur ? '.ipn-req' : '.isn-req'}）`,
      m.hdReqCls === (c.pur ? 'ipn-req' : 'isn-req'), String(m.hdReqCls))
    ok(`B  ${c.name}：红心色值 = --dan 红（与表单头同色）`,
      (m.ordReq || []).every(x => RED.test(x.color)) && RED.test(String(m.hdReqColor)),
      JSON.stringify((m.ordReq || []).map(x => x.color)) + ' vs 表单头 ' + m.hdReqColor)
    ok(`B  ${c.name}：非必填列（金额 / 单位 / 条码…）**没有**被误打红心`,
      (m.ordReq || []).length === 3, '红心数 ' + (m.ordReq || []).length)
    errsSeen.push(...(m.errs || []))
  }

  section('C 明细表输入框撤掉底色（规范 §4.6）')
  for (const c of pages) {
    const m = await hardLoad(p, c.hash)
    let cellBg = m.cellInBg, tag = m.cellInTag
    if (c.pur && cellBg === null) {
      /* 采购页默认态没有 input ⇒ 激活一格再量（见 JS_ACTIVATE_PRICE 的说明） */
      const act = await J(p, JS_ACTIVATE_PRICE)
      const mb = await J(p, MEASURE)
      cellBg = mb.cellInBg; tag = mb.cellInTag
      console.log('    激活「采购价」格 → ' + JSON.stringify(act) + ' ⇒ input 底色=' + cellBg)
    }
    console.log('  [' + c.name + '] 格内控件底色=' + cellBg + '（<' + tag + '>）' +
      (c.pur ? '  .ipn-v 底色=' + m.cellVBg : '') + '  表单头框底色=' + m.hdBoxBg)
    ok(`C  ${c.name}：明细表格内输入控件**无底色**（transparent）`,
      cellBg === 'rgba(0, 0, 0, 0)', String(cellBg))
    if (c.pur) {
      ok(`C  ${c.name}：文本态格 .ipn-v 同样**无底色**`,
        m.cellVBg === 'rgba(0, 0, 0, 0)', String(m.cellVBg))
    }
    /* 反例自证：只撤明细表。表单头的**框**（供应商 / 客户那一格）必须仍有底色
       var(--bg3)，否则说明撤过头了 —— 用户要的是"明细表不压抑"，不是"全页无底色"。 */
    ok(`C  ${c.name}：反例 —— 表单头框**仍有底色** var(--bg3)（说明只撤了明细表）`,
      !!m.hdBoxBg && m.hdBoxBg !== 'rgba(0, 0, 0, 0)', String(m.hdBoxBg))
    errsSeen.push(...(m.errs || []))
  }

  section('D 列宽拖动（规范 §4.5 / §7.4）')
  for (const c of pages) {
    const m = await hardLoad(p, c.hash)
    ok(`D  ${c.name}：可拖列都挂了手柄（采购 11 列 / 销售 5 列）`,
      m.handleN === (c.pur ? 11 : 5), '手柄 ' + m.handleN + ' 个')
    ok(`D  ${c.name}：反例 —— 序号列（齿轮入口）**没有**手柄`,
      m.seqHasHandle === false, String(m.seqHasHandle))

    /* 拖宽 +80 */
    const d1 = await J(p, JS_DRAG(1, 80))
    console.log('  [' + c.name + '] 拖宽 → ' + JSON.stringify(d1))
    ok(`D  ${c.name}：向右拖 80px ⇒ 列宽真的变宽（Δ≈80，容差 8）`,
      d1.err ? false : Math.abs(d1.delta - 80) <= 8, JSON.stringify(d1))
    ok(`D  ${c.name}：宽度写成了 **width + min-width 两条**内联样式（少一条会被 CSS 的 min-width 挡住拖不动）`,
      !!d1.inlineW && d1.inlineW === d1.inlineMinW, d1.inlineW + ' / ' + d1.inlineMinW)

    /* 再拖窄 −60 */
    const d2 = await J(p, JS_DRAG(1, -60))
    console.log('  [' + c.name + '] 拖窄 → ' + JSON.stringify(d2))
    ok(`D  ${c.name}：向左拖 60px ⇒ 列宽真的变窄（拖宽不是单向的）`,
      d2.err ? false : Math.abs(d2.delta + 60) <= 8, JSON.stringify(d2))

    /* 落盘 */
    const m2 = await J(p, MEASURE)
    ok(`D  ${c.name}：宽度落 localStorage（${m2.lsKey}）`,
      !!m2.lsRaw && /"prod"/.test(m2.lsRaw), String(m2.lsRaw))

    /* 双击复位 */
    const r1 = await J(p, JS_DBL_RESET(1))
    const m3 = await J(p, MEASURE)
    console.log('  [' + c.name + '] 双击复位 → ' + JSON.stringify(r1) + ' ls=' + m3.lsRaw)
    ok(`D  ${c.name}：双击手柄 ⇒ 该列回到默认宽（内联 width 清掉）`,
      r1.inlineW === '', JSON.stringify(r1))
    ok(`D  ${c.name}：复位后本地存储里该列也被清掉`,
      !m3.lsRaw || !/"prod"/.test(m3.lsRaw), String(m3.lsRaw))

    await p.screenshot(SHOTS + '/D-' + c.name + '.png').catch(() => {})
    errsSeen.push(...(m3.errs || []))
  }

  section('E 退货明细表：红心 + 列宽同样生效')
  {
    /* 销售自提退单：生产上能扫到真的可退单（v441 实测第 1 张即得 10 行） */
    const m = await hardLoad(p, '#/inventory/sale/new?type=self_pickup&kind=return')
    const sel = await p.eval(`(async function(){
      var s = document.querySelector('.isn-f-so select.isn-sel');
      if (!s || s.options.length < 2) return JSON.stringify({ err: 'no-option' });
      s.value = s.options[1].value;
      s.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(function(r){ setTimeout(r, 2600) });
      return JSON.stringify({ ok: true, picked: s.options[1].textContent.replace(/\\s+/g,' ').trim() });
    })()`).then(JSON.parse)
    const m2 = await J(p, MEASURE)
    console.log('  [自提退单] 选单=' + JSON.stringify(sel) + ' 退货表行数=' + m2.retRows +
      ' 红心=' + JSON.stringify(m2.retReq) + ' 手柄=' + m2.handleN)
    if (m2.retRows > 0) {
      ok('E  退货明细表：必填列（退货数量）打红 *，且**只此一列**',
        JSON.stringify((m2.retReq || []).map(x => x.th)) === JSON.stringify(['退货数量']) &&
        RED.test((m2.retReq || [])[0] ? (m2.retReq || [])[0].color : ''),
        JSON.stringify(m2.retReq))
      ok('E  退货明细表：8 个可拖列都挂了手柄', m2.handleN === 8, '手柄 ' + m2.handleN + ' 个')
      const d = await J(p, JS_DRAG(1, 70))
      console.log('    退货表拖动 → ' + JSON.stringify(d))
      ok('E  退货明细表：列宽同样可拖（Δ≈70）', d.err ? false : Math.abs(d.delta - 70) <= 8, JSON.stringify(d))
    } else {
      skip('E  退货明细表红心/列宽', '本业态生产上退货表 0 行（无可退单），无法量测')
    }
    await p.screenshot(SHOTS + '/E-自提退单.png').catch(() => {})
    errsSeen.push(...(m2.errs || []))
  }

  section('F 零写请求 + 零控制台报错')
  const tail = await p.eval(`(function(){
    return JSON.stringify({ writes: window.__WRITES || [], errs: window.__ERRS || [] });
  })()`).then(JSON.parse)
  console.log('  写请求：' + JSON.stringify(tail.writes))
  console.log('  控制台：' + JSON.stringify((errsSeen.concat(tail.errs)).slice(0, 8)))
  ok('F  全程**零写请求**（探针只读 + 只改本机列宽偏好）', (tail.writes || []).length === 0,
    JSON.stringify(tail.writes))
  ok('F  全程**零控制台报错**', (errsSeen.concat(tail.errs) || []).length === 0,
    JSON.stringify((errsSeen.concat(tail.errs)).slice(0, 5)))

  console.log('\n' + '='.repeat(90))
  console.log(`  PASS ${PASS.length}   FAIL ${FAIL.length}   SKIP ${SKIP.length}`)
  if (FAIL.length) { console.log('  FAILED:'); FAIL.forEach(f => console.log('   - ' + f)) }
  console.log('  VERDICT: ' + (FAIL.length ? 'HAS_FAIL' : 'ALL_PASS'))
  console.log('='.repeat(90))
  try { await browser.close() } catch { /* ignore */ }
  process.exit(FAIL.length ? 1 : 0)
}

main().catch(e => { console.error('探针异常：', e); process.exit(2) })
