/**
 * v446「新建采购订单」界面**视觉参数提取**探针（生产 https://hergent.cn）
 *
 * 目的：规范文档要写「标准参考：新建采购订单界面」，其中的每个数值都必须是
 * **真机 computed style 的实测值**，不是读 CSS 推算的。
 *
 *   为什么不能读 CSS 推算：
 *     · `--fs-base` 之类的变量有兜底值、也可能被页面 scoped 覆盖；
 *     · 继承链上的 font-size / line-height 只能靠 computed 拿；
 *     · `.ipn-hd-box .ipn-f .input` 这类 (0,3,0) 覆盖会改掉宽度而不改源码那一行；
 *     · 行高（td 的真实高度）受 padding + 内层控件高度共同决定，源码里没有这个数。
 *
 *   量测面（对应规范的「标准参考」章节）：
 *     A 页面标题与页头
 *     B 表单头字段框（框本身 / 标签 / 必填星 / 框内控件 / 各控件宽）
 *     C 表单头布局（一行几格、各格占宽、格间距）
 *     D 读数条（供应商信息条）
 *     E 明细工具条 + 明细表（表头行高 / 数据行高 / 各列实测宽 / 表宽与容器宽）
 *     F 明细格控件（`.ipn-v` 文本态 / `.ipn-in` 输入态）
 *     G 底部动作条
 *     H 垂直节奏（各区块 top/height ⇒ 区块间距）
 *     I 一屏疏密（明细滚动区高度 ÷ 行高 = 首屏可见行数）
 *     J 汇总：本次量到的全部数值以 JSON 落盘，供规范文档直接引用
 *
 * 运行：
 *   V446_TOKEN=<boss 会话 token> \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v446-psi-visual-spec-probe.mjs
 *
 * 🔴 本探针**只读**：全程零写请求、不改任何 DOM 属性（连 class 都不加）。
 * 🔴 模板串内禁止反引号；正则的反斜杠要双写 —— 踩过，报 SyntaxError 且只显示空 {}。
 */
import { launch } from './lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TOKEN = process.env.V446_TOKEN || ''
const TENANT = process.env.V446_TENANT || '1'
const USER_JSON = process.env.V446_USER_JSON ||
  JSON.stringify({ id: 2, username: 'boss', role: 'boss', roles: ['boss'], name: 'boss' })
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v446-visual-spec'
try { fs.mkdirSync(OUT, { recursive: true }) } catch { /* ignore */ }

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const section = (t) => console.log('\n' + '─'.repeat(96) + '\n' + t + '\n' + '─'.repeat(96))

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

/* ── 单元素量测：把要的属性名数组一次带过去，避免多轮往返 ────────────────────── */
const JS_M = (sel, keys) => `(function(){
  try {
    var el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return JSON.stringify({ err: 'NOT_FOUND', sel: ${JSON.stringify(sel)} });
    var cs = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    var o = { err: '', tag: el.tagName, cls: String(el.className) };
    o.rect = { w: +r.width.toFixed(1), h: +r.height.toFixed(1), top: +r.top.toFixed(1), left: +r.left.toFixed(1) };
    var ks = ${JSON.stringify(keys)};
    for (var i = 0; i < ks.length; i++) { o[ks[i]] = cs[ks[i]] || ''; }
    return JSON.stringify(o);
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

/* ── 多元素量测（表头各列 / 表单头各格）────────────────────────────────────── */
const JS_MA = (sel, keys, n) => `(function(){
  try {
    var els = document.querySelectorAll(${JSON.stringify(sel)});
    var ks = ${JSON.stringify(keys)};
    var out = [];
    for (var i = 0; i < els.length && i < ${n}; i++) {
      var el = els[i], cs = getComputedStyle(el), r = el.getBoundingClientRect();
      var o = { i: i, cls: String(el.className), txt: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 18) };
      o.rect = { w: +r.width.toFixed(1), h: +r.height.toFixed(1), top: +r.top.toFixed(1), left: +r.left.toFixed(1) };
      for (var j = 0; j < ks.length; j++) { o[ks[j]] = cs[ks[j]] || ''; }
      out.push(o);
    }
    return JSON.stringify({ err: '', n: out.length, items: out });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

/* ── 采购页：点「采购价」格激活成 input（v417j 默认态 tbody 无 input）───────── */
const JS_ACTIVATE = `(async function(){
  var td = document.querySelector('table.ipn-tbl:not(.ipn-ret-tbl) tbody td.ipn-c-price');
  if (!td) return JSON.stringify({ err: 'no-price-cell' });
  td.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise(function(r){ setTimeout(r, 700) });
  var inp = td.querySelector('input.ipn-in');
  return JSON.stringify({ err: inp ? '' : 'no-input', ok: !!inp });
})()`

/* ── 明细滚动区可容纳的行数（疏密量化）────────────────────────────────────── */
const JS_DENSITY = (tsel, bodySel) => `(function(){
  try {
    var body = document.querySelector(${JSON.stringify(bodySel)});
    var wrap = document.querySelector(${JSON.stringify(bodySel)} + ' .table-wrap');
    var tbl  = document.querySelector(${JSON.stringify(tsel)});
    if (!tbl) return JSON.stringify({ err: 'no-table' });
    var thead = tbl.querySelector('thead tr');
    var rows  = tbl.querySelectorAll('tbody>tr');
    var hRow  = rows.length ? rows[0].getBoundingClientRect().height : 0;
    var hHead = thead ? thead.getBoundingClientRect().height : 0;
    var viewH = wrap ? wrap.clientHeight : 0;
    var usable = viewH - hHead;
    return JSON.stringify({ err: '',
      vh: +viewH.toFixed(1), hHead: +hHead.toFixed(1), hRow: +hRow.toFixed(2),
      rows: rows.length,
      fitRows: hRow > 0 ? +(usable / hRow).toFixed(2) : 0,
      bodyH: body ? +body.getBoundingClientRect().height.toFixed(1) : -1,
      tblW: +tbl.getBoundingClientRect().width.toFixed(1),
      wrapW: wrap ? +wrap.clientWidth.toFixed(1) : -1,
      scrollX: wrap ? wrap.scrollWidth > wrap.clientWidth : null
    });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

/* ── 表单头：一行放几格（按 top 分行）─────────────────────────────────────── */
const JS_HD_ROWS = (sel, fcls, lbcls) => `(function(){
  try {
    var hd = document.querySelector(${JSON.stringify(sel)});
    if (!hd) return JSON.stringify({ err: 'no-hd' });
    var fs = hd.querySelectorAll(${JSON.stringify(fcls)});
    var out = [], tops = {};
    for (var i = 0; i < fs.length; i++) {
      var r = fs[i].getBoundingClientRect();
      var key = Math.round(r.top);
      if (!tops[key]) tops[key] = [];
      var lb = fs[i].querySelector(${JSON.stringify(lbcls)});
      tops[key].push({ lb: lb ? (lb.textContent || '').trim() : '', w: +r.width.toFixed(1), left: +r.left.toFixed(1) });
    }
    var lines = Object.keys(tops).sort(function(a,b){ return a-b; }).map(function(k){ return tops[k]; });
    var hdR = hd.getBoundingClientRect();
    return JSON.stringify({ err: '', lines: lines,
      lineCount: lines.length,
      hdRect: { w: +hdR.width.toFixed(1), h: +hdR.height.toFixed(1), top: +hdR.top.toFixed(1) },
      sumW: +lines.map(function(l){ return l.reduce(function(a,c){ return a + c.w; }, 0); })
                   .reduce(function(a,c){ return a + c; }, 0).toFixed(1)
    });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

/* ── 垂直节奏：各区块的 top/height ⇒ 相邻间距 ─────────────────────────────── */
const JS_RHYTHM = `(function(){
  try {
    var sels = ['.page-hd', '.ipn-hd', '.ipn-strip', '.ipn-bar', '.ipn-body', '.ipn-bottom'];
    var out = [];
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      if (!el) { out.push({ sel: sels[i], miss: true }); continue; }
      var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      out.push({ sel: sels[i], top: +r.top.toFixed(1), h: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1),
        mb: cs.marginBottom, mt: cs.marginTop, pt: cs.paddingTop, pb: cs.paddingBottom });
    }
    for (var k = 0; k < out.length - 1; k++) {
      if (!out[k].miss && !out[k+1].miss) out[k].gapToNext = +(out[k+1].top - out[k].bottom).toFixed(1);
    }
    return JSON.stringify({ err: '', blocks: out, doc: { vw: window.innerWidth, vh: window.innerHeight } });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

/* ── CSS 变量取值（规范里引用的设计令牌必须能溯源到真实值）────────────────── */
const JS_VARS = `(function(){
  try {
    var ns = ['--fs-xs','--fs-sm','--fs-base','--fs-md','--fs-lg','--fs-xl','--fs-h2','--fs-h3','--fs-h4',
              '--sp-1','--sp-2','--sp-3','--sp-4','--sp-5','--sp-6',
              '--radius-xs','--radius-sm','--radius-md','--radius-lg',
              '--bd','--bg','--bg2','--bg3','--bg4','--p-dark','--p-bg','--p-border','--p-ink',
              '--t1','--t2','--t3','--dan','--dan-bg','--border-subtle','--shadow-sm','--shadow-md'];
    var cs = getComputedStyle(document.documentElement);
    var o = {};
    for (var i = 0; i < ns.length; i++) o[ns[i]] = cs.getPropertyValue(ns[i]).trim();
    o.zoom = (window.devicePixelRatio || 1);
    o.density = document.documentElement.getAttribute('data-density') || '(none)';
    return JSON.stringify({ err: '', vars: o });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

const JS_READY = `(function(){
  var t = document.title || '';
  var tbl = document.querySelector('table.ipn-tbl:not(.ipn-ret-tbl), table.isn-tbl:not(.isn-ret-tbl)');
  return JSON.stringify({ title: t, rows: tbl ? tbl.querySelectorAll('tbody>tr').length : 0 });
})()`

const J = (p, expr) => p.eval(expr).then(JSON.parse)

async function hardLoad (p, hash, wait0 = 7500) {
  let m = null
  for (let i = 0; i < 5; i++) {
    await p.goto(BASE + '/?__r=' + Date.now() + hash, i === 0 ? wait0 : 4500)
    m = await J(p, JS_READY)
    if (m && m.title && m.rows > 0) break
    await sleep(1200)
  }
  return m
}

/* 量测结果总集 —— 最后落盘成 JSON，规范文档直接引用这些数 */
const SPEC = {}

const main = async () => {
  if (!TOKEN) { console.error('缺少 V446_TOKEN'); process.exit(2) }
  const browser = await launch({ headless: true })
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(INIT)
  await p.raw.send('Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })

  const errsSeen = []
  p.raw.on && p.raw.on('Runtime.consoleAPICalled', () => {})

  /* ══ 打开采购建单页 ══════════════════════════════════════════════════════ */
  section('打开「创建采购订单」（1600×1000 视口）')
  const m = await hardLoad(p, '#/inventory/purchase/new?kind=order')
  console.log('  页面就绪：' + JSON.stringify(m))
  console.log('  路由：' + (await J(p, `(function(){ return JSON.stringify({ hash: location.hash, url: location.href.slice(0,90) }) })()`)).hash)

  /* ══ 设计令牌 ═══════════════════════════════════════════════════════════ */
  section('设计令牌（规范里引用的变量必须能溯源真实值）')
  const V = await J(p, JS_VARS)
  SPEC.vars = V.vars
  const vv = V.vars || {}
  console.log('  字号  xs=' + vv['--fs-xs'] + '  sm=' + vv['--fs-sm'] + '  base=' + vv['--fs-base'] +
    '  md=' + vv['--fs-md'] + '  lg=' + vv['--fs-lg'] + '  h2=' + vv['--fs-h2'])
  console.log('  间距  ' + ['--sp-1','--sp-2','--sp-3','--sp-4','--sp-5','--sp-6'].map(k => k + '=' + vv[k]).join('  '))
  console.log('  圆角  sm=' + vv['--radius-sm'] + '  md=' + vv['--radius-md'] + '  lg=' + vv['--radius-lg'])
  console.log('  主题标记  data-density=' + vv.density + '  dpr=' + vv.zoom)

  /* ══ A 页面标题 ═════════════════════════════════════════════════════════ */
  section('A 页面标题 / 页头')
  const A1 = await J(p, JS_M('.page-hd h2', ['fontSize', 'fontWeight', 'lineHeight', 'color', 'margin']))
  const A2 = await J(p, JS_M('.ipn-hd-t', ['display', 'gap', 'alignItems', 'fontSize']))
  SPEC.pageTitle = A1; SPEC.pageHeadRow = A2
  console.log('  .page-hd h2  ' + JSON.stringify(A1.rect) + '  font=' + A1.fontSize + '/' + A1.fontWeight + ' lh=' + A1.lineHeight + ' ' + A1.color)
  console.log('  .ipn-hd-t    gap=' + A2.gap + ' align=' + A2.alignItems)

  /* ══ B 表单头字段框 ═════════════════════════════════════════════════════ */
  section('B 表单头字段框（`.ipn-hd-box .ipn-f`）与其内部件')
  const K_BOX = ['display', 'height', 'padding', 'gap', 'backgroundColor', 'borderTopWidth', 'borderTopColor', 'borderRadius', 'alignItems', 'flexWrap']
  const B1 = await J(p, JS_M('.ipn-hd-box .ipn-f', K_BOX))
  const B2 = await J(p, JS_M('.ipn-hd-box .ipn-f .ipn-lb', ['fontSize', 'color', 'whiteSpace', 'flex', 'lineHeight']))
  const B3 = await J(p, JS_M('.ipn-hd-box .ipn-f .ipn-req', ['fontSize', 'color', 'marginRight', 'lineHeight']))
  const B4 = await J(p, JS_M('.ipn-hd-box .ipn-f input.input', ['height', 'padding', 'borderTopWidth', 'borderTopColor', 'backgroundColor', 'fontSize', 'width', 'boxShadow']))
  const B5 = await J(p, JS_M('.ipn-hd-box .ipn-f .ipn-sel', ['width', 'minWidth', 'height', 'padding', 'fontSize']))
  const B6 = await J(p, JS_M('.ipn-hd-box .ipn-f .ipn-date', ['width', 'height', 'padding', 'fontSize']))
  SPEC.hdBox = B1; SPEC.hdLabel = B2; SPEC.hdReq = B3; SPEC.hdInput = B4; SPEC.hdSel = B5; SPEC.hdDate = B6
  console.log('  字段框  ' + JSON.stringify(B1.rect) + '  padding=' + B1.padding + ' gap=' + B1.gap +
    ' bg=' + B1.backgroundColor + ' border=' + B1.borderTopWidth + ' ' + B1.borderTopColor + ' radius=' + B1.borderRadius)
  console.log('    └ wrap=' + B1.flexWrap + ' align=' + B1.alignItems)
  console.log('  标签    font=' + B2.fontSize + ' ' + B2.color + ' lh=' + B2.lineHeight + ' nowrap=' + B2.whiteSpace + ' flex=' + B2.flex)
  console.log('  必填星  font=' + B3.fontSize + ' ' + B3.color + ' mr=' + B3.marginRight)
  console.log('  框内 input  ' + JSON.stringify(B4.rect) + '  h=' + B4.height + ' pad=' + B4.padding +
    ' border=' + B4.borderTopWidth + ' ' + B4.borderTopColor + ' bg=' + B4.backgroundColor + ' font=' + B4.fontSize + ' w=' + B4.width)
  console.log('  下拉    ' + JSON.stringify(B5.rect) + '  w=' + B5.width + ' minW=' + B5.minWidth + ' h=' + B5.height + ' pad=' + B5.padding)
  console.log('  日期    ' + JSON.stringify(B6.rect) + '  w=' + B6.width + ' h=' + B6.height + ' pad=' + B6.padding)

  /* ══ C 表单头布局 ═══════════════════════════════════════════════════════ */
  section('C 表单头布局（一行几格 / 各格占宽 / 格间距）')
  const C1 = await J(p, JS_HD_ROWS('.ipn-hd-box', '.ipn-f', '.ipn-lb'))
  SPEC.hdLayout = C1
  console.log('  共 ' + C1.lineCount + ' 行；各格合计宽 ' + C1.sumW + 'px；容器 ' + JSON.stringify(C1.hdRect))
  ;(C1.lines || []).forEach((l, i) => {
    console.log('   行 ' + (i + 1) + '（' + l.length + ' 格）: ' +
      l.map(c => c.lb + '(' + c.w + ')').join('  |  '))
    if (l.length > 1) {
      const gaps = []
      for (let k = 1; k < l.length; k++) gaps.push(+(l[k].left - (l[k - 1].left + l[k - 1].w)).toFixed(1))
      console.log('       格间距: ' + gaps.join(', ') + 'px')
    }
  })
  const C2 = await J(p, JS_M('.ipn-hd', ['display', 'gap', 'flexWrap', 'marginBottom', 'alignItems']))
  SPEC.hdContainer = C2
  console.log('  表单头容器  gap=' + C2.gap + ' wrap=' + C2.flexWrap + ' mb=' + C2.marginBottom + ' align=' + C2.alignItems)

  /* ══ D 读数条 ═══════════════════════════════════════════════════════════ */
  section('D 供应商信息条（`.ipn-strip`）')
  const D1 = await J(p, JS_M('.ipn-strip', ['height', 'padding', 'gap', 'fontSize', 'color', 'backgroundColor', 'borderTopWidth', 'borderTopColor', 'borderRadius', 'marginBottom']))
  const D2 = await J(p, JS_M('.ipn-strip .ipn-sk', ['fontSize', 'color']))
  const D3 = await J(p, JS_M('.ipn-strip .ipn-strip-amt', ['color', 'fontVariantNumeric', 'fontSize']))
  SPEC.strip = D1; SPEC.stripKey = D2; SPEC.stripAmt = D3
  if (D1.err) { console.log('  （本页无读数条：' + D1.err + '，销售/退货页才有 — 跳过）') }
  else {
    console.log('  读数条  ' + JSON.stringify(D1.rect) + '  pad=' + D1.padding + ' gap=' + D1.gap +
      ' font=' + D1.fontSize + ' bg=' + D1.backgroundColor + ' radius=' + D1.borderRadius + ' mb=' + D1.marginBottom)
    console.log('    └ 键 ' + D2.fontSize + ' ' + D2.color + '；金额 ' + D3.fontSize + ' ' + D3.color)
  }

  /* ══ E 明细工具条 + 明细表 ══════════════════════════════════════════════ */
  section('E 明细工具条 + 明细表（表头/行高/列宽/表宽）')
  const E0 = await J(p, JS_M('.ipn-bar', ['display', 'gap', 'alignItems', 'marginBottom', 'flexWrap']))
  const E0b = await J(p, JS_M('.ipn-bar b', ['fontSize', 'fontWeight', 'color']))
  const E0c = await J(p, JS_M('.ipn-btn-add', ['height', 'padding', 'fontSize', 'borderRadius']))
  SPEC.toolbar = E0; SPEC.toolbarTitle = E0b; SPEC.addBtn = E0c
  console.log('  工具条  gap=' + E0.gap + ' mb=' + E0.marginBottom + ' align=' + E0.alignItems)
  console.log('  标题    font=' + E0b.fontSize + '/' + E0b.fontWeight + ' ' + E0b.color)
  if (!E0c.err) console.log('  加一行  h=' + E0c.height + ' pad=' + E0c.padding + ' font=' + E0c.fontSize + ' radius=' + E0c.borderRadius)

  const E1 = await J(p, JS_M('table.ipn-tbl:not(.ipn-ret-tbl)', ['width', 'minWidth', 'fontSize', 'borderCollapse', 'tableLayout']))
  const E2 = await J(p, JS_MA('table.ipn-tbl:not(.ipn-ret-tbl) thead th', ['fontSize', 'fontWeight', 'color', 'padding', 'textAlign', 'backgroundColor'], 20))
  const E3 = await J(p, JS_MA('table.ipn-tbl:not(.ipn-ret-tbl) tbody tr:first-child td', ['fontSize', 'color', 'padding', 'textAlign', 'height'], 20))
  const E4 = await J(p, JS_M('table.ipn-tbl:not(.ipn-ret-tbl) thead tr', ['height']))
  const E5 = await J(p, JS_M('table.ipn-tbl:not(.ipn-ret-tbl) tbody tr', ['height']))
  SPEC.detailTable = E1; SPEC.thCells = E2; SPEC.tdCells = E3; SPEC.theadRow = E4; SPEC.tbodyRow = E5
  console.log('  表  ' + JSON.stringify(E1.rect) + '  minW=' + E1.minWidth + ' font=' + E1.fontSize + ' layout=' + E1.tableLayout + ' collapse=' + E1.borderCollapse)
  console.log('  表头行高 = ' + E4.rect.h + 'px；数据行高 = ' + E5.rect.h + 'px')
  if (E2.items && E2.items[0]) console.log('  表头文字  font=' + E2.items[0].fontSize + '/' + E2.items[0].fontWeight + ' ' + E2.items[0].color + ' pad=' + E2.items[0].padding)
  if (E3.items && E3.items[0]) console.log('  单元格    font=' + E3.items[0].fontSize + ' ' + E3.items[0].color + ' pad=' + E3.items[0].padding)
  console.log('  各列实测宽：')
  ;(E2.items || []).forEach(c => {
    const w = c.rect.w
    if (w >= 0) console.log('    ' + String(c.txt || '(空)').padEnd(12, ' ') + ' w=' + String(w).padStart(7, ' ') + '  ' + c.cls.slice(0, 46))
  })
  SPEC.colWidths = (E2.items || []).map(c => ({ txt: c.txt, w: c.rect.w, cls: c.cls, align: c.textAlign, pad: c.padding }))

  /* ══ F 明细格控件 ═══════════════════════════════════════════════════════ */
  section('F 明细格控件（`.ipn-v` 文本态 / `.ipn-in` 输入态）')
  const F0 = await J(p, JS_M('table.ipn-tbl:not(.ipn-ret-tbl) tbody tr:first-child .ipn-v', ['fontSize', 'lineHeight', 'minHeight', 'height', 'padding', 'color', 'backgroundColor', 'boxShadow', 'textAlign']))
  SPEC.cellTextView = F0
  console.log('  .ipn-v 文本态  ' + JSON.stringify(F0.rect) + '  font=' + F0.fontSize + ' lh=' + F0.lineHeight + ' minH=' + F0.minHeight + ' pad=' + F0.padding + ' bg=' + F0.backgroundColor + ' shadow=' + F0.boxShadow)
  const act = await J(p, JS_ACTIVATE)
  console.log('  激活「采购价」格 → ' + JSON.stringify(act))
  const F1 = await J(p, JS_M('table.ipn-tbl:not(.ipn-ret-tbl) tbody td.ipn-c-price input.ipn-in', ['fontSize', 'height', 'padding', 'textAlign', 'fontVariantNumeric', 'color']))
  SPEC.cellInput = F1
  if (F1.err) console.log('  .ipn-in 输入态 未取到：' + F1.err)
  else console.log('  .ipn-in 输入态  ' + JSON.stringify(F1.rect) + '  h=' + F1.height + ' pad=' + F1.padding + ' font=' + F1.fontSize + ' align=' + F1.textAlign)
  const F2 = await J(p, JS_M('.ipn-ic', ['width', 'height', 'borderTopWidth', 'borderRadius', 'backgroundColor']))
  SPEC.rowIconBtn = F2
  if (!F2.err) console.log('  行内图标按钮  ' + JSON.stringify(F2.rect) + '  ' + F2.width + '×' + F2.height + ' radius=' + F2.borderRadius + ' bg=' + F2.backgroundColor)
  const F3 = await J(p, JS_M('table.ipn-tbl:not(.ipn-ret-tbl) td.seq-cell', ['width', 'minWidth', 'padding', 'fontSize', 'color', 'textAlign']))
  SPEC.seqCell = F3
  if (!F3.err) console.log('  序号列  ' + JSON.stringify(F3.rect) + '  w=' + F3.width + ' minW=' + F3.minWidth + ' pad=' + F3.padding + ' font=' + F3.fontSize + ' ' + F3.color)

  /* ══ G 底部动作条 ═══════════════════════════════════════════════════════ */
  section('G 底部动作条（`.ipn-bottom`）')
  const G1 = await J(p, JS_M('.ipn-bottom', ['display', 'gap', 'padding', 'margin', 'borderTopWidth', 'borderTopColor', 'backgroundColor', 'alignItems', 'flexWrap']))
  const G2 = await J(p, JS_M('.ipn-total', ['fontSize', 'color']))
  const G3 = await J(p, JS_M('.ipn-total b', ['fontSize', 'fontVariantNumeric']))
  const G4 = await J(p, JS_M('.ipn-save button.btn, .ipn-bottom button.btn', ['height', 'padding', 'fontSize', 'borderRadius', 'fontWeight']))
  SPEC.bottom = G1; SPEC.total = G2; SPEC.totalNum = G3; SPEC.saveBtn = G4
  console.log('  动作条  ' + JSON.stringify(G1.rect) + '  gap=' + G1.gap + ' pad=' + G1.padding + ' margin=' + G1.margin + ' borderTop=' + G1.borderTopWidth + ' ' + G1.borderTopColor)
  if (!G2.err) console.log('  「合计」  font=' + G2.fontSize + ' ' + G2.color)
  if (!G3.err) console.log('  金额数字  font=' + G3.fontSize + ' ' + G3.fontVariantNumeric)
  if (!G4.err) console.log('  保存按钮  ' + JSON.stringify(G4.rect) + '  h=' + G4.height + ' pad=' + G4.padding + ' font=' + G4.fontSize + ' radius=' + G4.borderRadius)

  /* ══ H 垂直节奏 ═════════════════════════════════════════════════════════ */
  section('H 垂直节奏（区块 top/height ⇒ 相邻间距）')
  const H1 = await J(p, JS_RHYTHM)
  SPEC.rhythm = H1
  console.log('  视口 ' + JSON.stringify(H1.doc))
  ;(H1.blocks || []).forEach(b => {
    if (b.miss) { console.log('  ' + b.sel.padEnd(14) + ' (本页无)'); return }
    console.log('  ' + b.sel.padEnd(14) + ' top=' + String(b.top).padStart(6) + ' h=' + String(b.h).padStart(6) +
      ' mb=' + b.mb + '  → 与下一块间距 ' + (b.gapToNext === undefined ? '—' : b.gapToNext + 'px'))
  })

  /* ══ I 一屏疏密 ═════════════════════════════════════════════════════════ */
  section('I 一屏疏密（明细滚动区能容纳几行）')
  const I1 = await J(p, JS_DENSITY('table.ipn-tbl:not(.ipn-ret-tbl)', '.ipn-body'))
  SPEC.density = I1
  console.log('  ' + JSON.stringify(I1))
  console.log('  ⇒ 表头 ' + I1.hHead + 'px + 数据行 ' + I1.hRow + 'px；可视高 ' + I1.vh + 'px ⇒ 首屏约 ' + I1.fitRows + ' 行')
  console.log('  ⇒ 表宽 ' + I1.tblW + 'px vs 容器 ' + I1.wrapW + 'px ⇒ 横向滚动=' + I1.scrollX)

  /* ══ K 补充量测（首轮取到的是序号列 / 需溯源字号继承链）═════════════════ */
  section('K 补充量测：常规数据格 / 字号继承链 / 文本对齐 / 表头 sticky')
  const K_head = await J(p, JS_M('table.ipn-tbl:not(.ipn-ret-tbl) thead', ['position', 'top', 'zIndex', 'backgroundColor']))
  const K_td = await J(p, JS_MA('table.ipn-tbl:not(.ipn-ret-tbl) tbody tr:first-child td:not(.seq-cell)', ['fontSize', 'color', 'padding', 'textAlign', 'lineHeight', 'height'], 6))
  const K_thnum = await J(p, JS_MA('table.ipn-tbl:not(.ipn-ret-tbl) thead th.num', ['textAlign', 'padding', 'fontSize'], 4))
  const K_inp = await J(p, JS_M('table.ipn-tbl:not(.ipn-ret-tbl) tbody td.ipn-c-price input.ipn-in', ['boxSizing', 'padding', 'fontSize', 'lineHeight', 'height', 'width', 'borderTopWidth', 'borderRadius']))
  const K_body = await J(p, `(function(){
    var b = getComputedStyle(document.body), h = getComputedStyle(document.documentElement);
    var ct = document.querySelector('.content'), sh = document.querySelector('.view-wrap');
    function box(el){ if(!el) return null; var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return { w:+r.width.toFixed(1), pad: cs.padding, mb: cs.marginBottom, bg: cs.backgroundColor, radius: cs.borderRadius }; }
    return JSON.stringify({ err:'', bodyFs: b.fontSize, bodyLh: b.lineHeight, htmlFs: h.fontSize,
      fontSans: b.fontFamily.slice(0, 60), content: box(ct), viewWrap: box(sh) });
  })()`)
  const K_hd1 = await J(p, JS_M('.ipn-hd-box .ipn-f.ipn-f-sup', ['minWidth', 'width', 'flexBasis', 'flexGrow', 'flexShrink']))
  const K_note = await J(p, JS_M('.ipn-hd-box .ipn-f .ipn-note-in', ['width', 'minWidth', 'flexGrow', 'height', 'padding']))
  const K_bar = await J(p, JS_MA('.ipn-bar > *', ['fontSize', 'color', 'height', 'padding', 'borderRadius'], 6))
  SPEC.headSticky = K_head; SPEC.tdCellsNormal = K_td; SPEC.thNumCells = K_thnum
  SPEC.cellInputDetail = K_inp; SPEC.fontChain = K_body; SPEC.hdSupField = K_hd1
  SPEC.hdNoteField = K_note; SPEC.toolbarChildren = K_bar
  console.log('  thead  position=' + K_head.position + ' top=' + K_head.top + ' z=' + K_head.zIndex + ' bg=' + K_head.backgroundColor)
  console.log('  字号继承链  html=' + K_body.htmlFs + '  body=' + K_body.bodyFs + ' lh=' + K_body.bodyLh)
  console.log('  字体栈  ' + K_body.fontSans)
  console.log('  内容容器  ' + JSON.stringify(K_body.content))
  console.log('  视口容器  ' + JSON.stringify(K_body.viewWrap))
  console.log('  常规数据格（非序号列）：')
  ;(K_td.items || []).forEach(c => console.log('    ' + c.cls.slice(0, 30).padEnd(30) + ' font=' + c.fontSize + ' ' + c.color + ' pad=' + c.padding + ' align=' + c.textAlign + ' lh=' + c.lineHeight))
  console.log('  数值列表头：' + (K_thnum.items || []).map(c => c.textAlign + '/' + c.padding).join('  '))
  console.log('  .ipn-in 细节  box-sizing=' + K_inp.boxSizing + ' pad=' + K_inp.padding + ' font=' + K_inp.fontSize + ' lh=' + K_inp.lineHeight + ' border=' + K_inp.borderTopWidth + ' radius=' + K_inp.borderRadius)
  console.log('  供应商格  ' + JSON.stringify(K_hd1))
  if (!K_note.err) console.log('  备注格  ' + JSON.stringify(K_note.rect) + ' flexGrow=' + K_note.flexGrow + ' minW=' + K_note.minWidth + ' h=' + K_note.height)
  console.log('  工具条子元素：' + (K_bar.items || []).map(c => c.txt + '(' + c.fontSize + '/' + c.rect.h + ')').join('  |  '))

  /* ══ L 销售建单页对照（证明同一基准在另一页成立）═══════════════════════ */
  section('L 销售建单页对照（同基准是否在两页一致）')
  const ms = await hardLoad(p, '#/inventory/sale/new?kind=order')
  console.log('  销售页就绪：' + JSON.stringify(ms))
  const L1 = await J(p, JS_M('.isn-hd-box .isn-f', K_BOX))
  const L2 = await J(p, JS_M('.isn-hd-box .isn-f .isn-lb', ['fontSize', 'color']))
  const L3 = await J(p, JS_M('.isn-hd-box .isn-f input.input', ['height', 'borderTopWidth', 'fontSize']))
  const L4 = await J(p, JS_MA('table.isn-tbl:not(.isn-ret-tbl) thead th', ['fontSize', 'color', 'padding', 'textAlign'], 12))
  const L5 = await J(p, JS_MA('table.isn-tbl:not(.isn-ret-tbl) tbody tr', ['height'], 3))
  const L5b = await J(p, JS_M('table.isn-tbl:not(.isn-ret-tbl) tbody td input.isn-in, table.isn-tbl:not(.isn-ret-tbl) tbody td select.isn-in', ['height', 'fontSize', 'padding', 'borderRadius', 'borderTopWidth']))
  const L5c = await J(p, JS_MA('table.isn-tbl:not(.isn-ret-tbl) tbody tr:first-child > td', ['padding', 'height', 'fontSize', 'verticalAlign'], 8))
  const L5d = await J(p, JS_MA('table.isn-tbl:not(.isn-ret-tbl) thead th.isn-c-prod, table.isn-tbl:not(.isn-ret-tbl) tbody tr:first-child td.isn-c-prod', ['padding', 'height'], 2))
  const L6 = await J(p, JS_HD_ROWS('.isn-hd-box', '.isn-f', '.isn-lb'))
  const L7 = await J(p, JS_DENSITY('table.isn-tbl:not(.isn-ret-tbl)', '.isn-body'))
  SPEC.sale = { hdBox: L1, hdLabel: L2, hdInput: L3, thead: L4, rows: L5, cellCtl: L5b, tds: L5c, prodCells: L5d, hdLayout: L6, density: L7 }
  console.log('  字段框  ' + JSON.stringify(L1.rect) + ' pad=' + L1.padding + ' gap=' + L1.gap + ' bg=' + L1.backgroundColor + ' radius=' + L1.borderRadius)
  console.log('  标签  ' + L2.fontSize + ' ' + L2.color + '；框内 input h=' + L3.height + ' border=' + L3.borderTopWidth + ' font=' + L3.fontSize)
  console.log('  数据行高 = ' + (L5.items || []).map(c => c.rect.h).join(' / ') + 'px；表头 pad=' + ((L4.items || [])[0] || {}).padding + ' font=' + ((L4.items || [])[0] || {}).fontSize)
  console.log('  明细格控件  ' + (L5b.err ? L5b.err : ('h=' + L5b.height + ' font=' + L5b.fontSize + ' pad=' + L5b.padding + ' radius=' + L5b.borderRadius + ' border=' + L5b.borderTopWidth)))
  console.log('  各格  ' + (L5c.items || []).map(c => c.cls.slice(0,18) + '(' + c.rect.h + '/' + c.padding + ')').join('  '))
  console.log('  商品格 ' + (L5d.items || []).map(c => c.cls.slice(0,10) + ' h=' + c.rect.h + ' pad=' + c.padding).join(' | '))
  console.log('  表单头 ' + L6.lineCount + ' 行 ' + JSON.stringify((L6.lines || []).map(l => l.length)))
  ;(L6.lines || []).forEach((l, i) => console.log('    行 ' + (i+1) + '：' + l.map(c => c.lb + '(' + c.w + ')').join('  |  ')))
  console.log('  疏密  ' + JSON.stringify(L7))

  /* ══ J 落盘 ═════════════════════════════════════════════════════════════ */
  section('J 落盘量测结果')
  const tail = await J(p, `(function(){ return JSON.stringify({ writes: window.__WRITES || [], errs: window.__ERRS || [] }); })()`)
  SPEC.probe = { writes: tail.writes || [], errs: (errsSeen.concat(tail.errs || [])).slice(0, 8), at: new Date().toISOString(), viewport: '1600x1000' }
  const jsonPath = OUT + '/measurements.json'
  fs.writeFileSync(jsonPath, JSON.stringify(SPEC, null, 2), 'utf8')
  console.log('  JSON → ' + jsonPath)
  console.log('  零写请求=' + ((tail.writes || []).length === 0) + '  零报错=' + (((errsSeen.concat(tail.errs || []))).length === 0))
  console.log('  ' + JSON.stringify((errsSeen.concat(tail.errs || [])).slice(0, 4)))

  try { await p.screenshot(OUT + '/A-采购建单页-全貌.png') } catch { /* ignore */ }

  console.log('\n' + '='.repeat(96))
  console.log('  量测完成（本探针只读：零写请求 / 零 DOM 改动）')
  console.log('='.repeat(96))
  try { await browser.close() } catch { /* ignore */ }
  process.exit(0)
}

main().catch(e => { console.error('探针异常：', e); process.exit(2) })
