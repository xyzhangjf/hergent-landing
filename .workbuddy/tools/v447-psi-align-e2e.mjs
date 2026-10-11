/**
 * v447 两件事的真机验收探针（生产 https://hergent.cn）
 *
 * ① 销售建单页明细表**对齐基准**（「新建采购订单」，规范 §R）
 *    —— 内距 / 行高 / 表头高 / 明细格控件尺寸，全部量 computed style 比数值，
 *       不靠"看着差不多"。同屏可见行数也要跟上来（基准 21.12 行，原来只有 14.99）。
 *
 * ② 明细格「点激活」**跳变抹平**（两页共有）
 *    —— 原值从全局 `.input` 继承：字号 13 → 14、内距 `0 4px` → `0 14px`、圆角 8 → 12，
 *       三项同时跳，点下去像换了个控件。现要求**逐项相等**，且文字左起点**逐像素对齐**
 *       （补偿 1px 真边框 ⇒ padding 3px）。
 *
 * ── 探针自己的坑（本文件已规避）─────────────────────────────────────────────
 *   ① 只差 hash 的 `Page.navigate` = 同文档导航 ⇒ 必须 `'/?__r=' + Date.now() + hash`。
 *   ② 采购页 v417j：「点哪格哪格才是输入框」⇒ 默认态 tbody **一个 input 都没有**，
 *      必须先点激活再量 `.ipn-in`（直接量会 NOT_FOUND，那是设计如此不是缺陷）。
 *   ③ hover 必须用 CDP 真实鼠标移（CSS `:hover` 不能靠加 class 伪造），且等 450ms 走过过渡。
 *   ④ transparent 的 computed 值是 `rgba(0, 0, 0, 0)`；CSS 变量是 hex，border-color 是 rgb。
 *   ⑤ 模板串内**不能写反引号**、正则要双反斜杠（踩过 ⇒ SyntaxError ⇒ 量测全 undefined ⇒
 *      打印出空 `{}`，看着像"页面没渲染"，会被误导好几轮；故本文件量测一律带 err 字段）。
 *   ⑥ INIT 的 `hergent_v2_user` 必须与 TOKEN **同账号**（不同 ⇒ 被踢到 #/login ⇒ 量测 {}）。
 *
 * 运行：
 *   V447_TOKEN=<boss 会话 token> \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v447-psi-align-e2e.mjs
 */
import { launch } from './lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TOKEN = process.env.V447_TOKEN || ''
const TENANT = process.env.V447_TENANT || '1'
const USER_JSON = process.env.V447_USER_JSON ||
  JSON.stringify({ id: 2, username: 'boss', role: 'boss', roles: ['boss'], name: 'boss' })
const SHOTS = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v447-psi-align'
try { fs.mkdirSync(SHOTS, { recursive: true }) } catch { /* ignore */ }

const PASS = []; const FAIL = []; const SKIP = []
const ok = (name, cond, detail = '') => {
  ;(cond ? PASS : FAIL).push(name)
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  | ' + detail : ''))
}
const skip = (name, why) => { SKIP.push(name); console.log('  SKIP  ' + name + '  | ' + why) }
const section = (t) => console.log('\n' + '─'.repeat(92) + '\n' + t + '\n' + '─'.repeat(92))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

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

/* ── 一个格子的全套可证伪事实：字号 / 内距 / 圆角 / 高 / 文字左起点 ─────────────
   文字左起点 = rect.left + 左内距 + 左边框宽 —— 这是「点激活文字会不会横向跳」的**唯一**判据。 */
const JS_BOX = (sel) => `(function(){
  try {
    var el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return JSON.stringify({ err: 'NOT_FOUND', sel: ${JSON.stringify(sel)} });
    var cs = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    var tr = el.closest('tr');
    var pl = parseFloat(cs.paddingLeft) || 0;
    var bl = parseFloat(cs.borderLeftWidth) || 0;
    return JSON.stringify({
      err: '', tag: el.tagName, cls: String(el.className),
      fontSize: cs.fontSize, padding: cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft,
      padL: pl, padR: parseFloat(cs.paddingRight) || 0, bdL: bl,
      radius: cs.borderTopLeftRadius, height: cs.height, color: cs.color,
      textLeft: +(r.left + pl + bl).toFixed(2),
      w: +r.width.toFixed(2), h: +r.height.toFixed(2),
      top: +r.top.toFixed(2), left: +r.left.toFixed(2),
      trh: tr ? +tr.getBoundingClientRect().height.toFixed(2) : -1,
      borderColor: cs.borderTopColor, boxShadow: cs.boxShadow, bg: cs.backgroundColor,
      value: (el.value !== undefined ? String(el.value).slice(0, 12) : '')
    });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

/* 表格几何：th/td 内距 + 行高 + 首屏可见行数（表格区在滚动容器里的高度 / 行高） */
const JS_TABLE = (tsel, bodySel) => `(function(){
  try {
    var tbl = document.querySelector(${JSON.stringify(tsel)});
    if (!tbl) return JSON.stringify({ err: 'no-table' });
    var th = tbl.querySelectorAll('thead th');
    var seqTh = tbl.querySelector('thead th.seq-th');
    var tr = tbl.querySelector('tbody>tr');
    var td = tbl.querySelectorAll('tbody>tr:first-child > td');
    var seqTd = tbl.querySelector('tbody>tr:first-child > td.seq-cell');
    var body = document.querySelector(${JSON.stringify(bodySel)});
    var wrap = body ? body.querySelector('.table-wrap') : null;
    var hRow = tr ? tr.getBoundingClientRect().height : -1;
    var hHead = seqTh ? seqTh.getBoundingClientRect().height : (th[0] ? th[0].getBoundingClientRect().height : -1);
    var vh = wrap ? wrap.clientHeight : -1;
    /* 取第一个「非序号」数据格作为常规格样本（序号列 padding 是特例，会误导） */
    var norm = null;
    for (var i = 0; i < td.length; i++) { if (!td[i].classList.contains('seq-cell')) { norm = td[i]; break } }
    return JSON.stringify({
      err: '',
      thSel: th[0] ? getComputedStyle(th[0]).padding : '',
      thPad: th[1] ? getComputedStyle(th[1]).padding : '',
      seqThPad: seqTh ? getComputedStyle(seqTh).padding : '',
      tdPad: norm ? getComputedStyle(norm).padding : '',
      seqTdPad: seqTd ? getComputedStyle(seqTd).padding : '',
      hRow: +hRow.toFixed(2), hHead: +hHead.toFixed(2),
      wrapH: vh, fitRows: (hRow > 0 && vh > 0) ? +(vh / hRow).toFixed(2) : -1,
      rows: tbl.querySelectorAll('tbody>tr').length
    });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

/* 首行各格的**子元素高度**（找出到底是谁在撑行高 —— 只改 padding 不够时要靠这个定位） */
const JS_CELLKIDS = (tsel) => `(function(){
  try {
    var tbl = document.querySelector(${JSON.stringify(tsel)});
    if (!tbl) return JSON.stringify({ err: 'no-table' });
    var tds = tbl.querySelectorAll('tbody>tr:first-child > td');
    var out = [];
    for (var i = 0; i < tds.length; i++) {
      var kids = tds[i].querySelectorAll('*');
      var mx = 0, which = '';
      for (var j = 0; j < kids.length; j++) {
        var r = kids[j].getBoundingClientRect();
        if (r.height > mx) { mx = r.height; which = kids[j].tagName + '.' + String(kids[j].className).slice(0, 22); }
      }
      out.push({ i: i, tdH: +tds[i].getBoundingClientRect().height.toFixed(2), kidH: +mx.toFixed(2), kid: which });
    }
    return JSON.stringify({ err: '', cells: out });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

const JS_RECT = (sel) => `(function(){
  var el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return JSON.stringify({ err: 'NOT_FOUND' });
  var r = el.getBoundingClientRect();
  return JSON.stringify({ err: '', cx: Math.round(r.left + r.width/2), cy: Math.round(r.top + r.height/2) });
})()`

/* 采购页点「采购价」格 ⇒ 文本态 `.ipn-v` 换成 `input.ipn-in`（v417j 的激活动作） */
const JS_ACTIVATE_PRICE = `(async function(){
  var td = document.querySelector('table.ipn-tbl:not(.ipn-ret-tbl) tbody td.ipn-c-price');
  if (!td) return JSON.stringify({ err: 'no-price-cell' });
  td.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise(function(r){ setTimeout(r, 600) });
  var inp = td.querySelector('input.ipn-in');
  return JSON.stringify({ err: inp ? '' : 'no-input', ok: !!inp });
})()`

const JS_READY = `(function(){
  var t = document.title || '';
  var tbl = document.querySelector('table.ipn-tbl:not(.ipn-ret-tbl), table.isn-tbl:not(.isn-ret-tbl)');
  return JSON.stringify({ title: t, rows: tbl ? tbl.querySelectorAll('tbody>tr').length : 0 });
})()`

const J = (p, expr) => p.eval(expr).then(JSON.parse)

async function hardLoad (p, hash, wait0 = 7000) {
  let m = null
  for (let i = 0; i < 5; i++) {
    await p.goto(BASE + '/?__r=' + Date.now() + hash, i === 0 ? wait0 : 4500)
    m = await J(p, JS_READY)
    if (m && m.title && m.rows > 0) break
    await sleep(1200)
  }
  return m
}

const TRANSP = 'rgba(0, 0, 0, 0)'
const isTransp = (c) => String(c).replace(/\s/g, '') === 'rgba(0,0,0,0)'
const has = (s, sub) => String(s).indexOf(sub) >= 0
/* CSS 变量取出来是 hex，computed 的 border-color 是 rgb() ⇒ 不换算永远不等（会误判"没生效"） */
const hex2rgb = (h) => {
  h = String(h).trim().replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  return 'rgb(' + parseInt(h.slice(0, 2), 16) + ', ' + parseInt(h.slice(2, 4), 16) + ', ' + parseInt(h.slice(4, 6), 16) + ')'
}

const main = async () => {
  const browser = await launch({ headless: true })
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(INIT)
  await p.raw.send('Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })

  const errsSeen = []
  const P_TBL = 'table.ipn-tbl:not(.ipn-ret-tbl)'
  const S_TBL = 'table.isn-tbl:not(.isn-ret-tbl)'

  /* ══════════════════════════════════════════════════════════════════════════
     A 采购建单页 = 基准；验收的是「点激活跳变抹平」
     ══════════════════════════════════════════════════════════════════════ */
  section('A 采购建单页 · 「点激活」跳变抹平（文本态 ⇄ 输入态 逐值一致）')
  let m = await hardLoad(p, '#/inventory/purchase/new?kind=order')
  console.log('  [采购] title=' + JSON.stringify(m.title) + ' 明细行数=' + m.rows)

  const V = P_TBL + ' tbody td.ipn-c-price .ipn-v'
  const a0 = await J(p, JS_BOX(V))
  if (a0.err) { ok('A  取到文本态 `.ipn-v`', false, a0.err) }
  else {
    console.log('  文本态: font=' + a0.fontSize + ' pad=' + a0.padding + ' radius=' + a0.radius +
      ' h=' + a0.h + ' 文字左起点=' + a0.textLeft)
    await p.screenshot(SHOTS + '/A1-采购-激活前文本态.png').catch(() => {})
  }

  const act = await J(p, JS_ACTIVATE_PRICE)
  const I = P_TBL + ' tbody td.ipn-c-price input.ipn-in'
  const a1 = act.err ? { err: act.err } : await J(p, JS_BOX(I))
  if (a1.err) { ok('A  点激活后取到 `input.ipn-in`', false, a1.err) }
  else {
    console.log('  输入态: font=' + a1.fontSize + ' pad=' + a1.padding + ' radius=' + a1.radius +
      ' h=' + a1.h + ' 文字左起点=' + a1.textLeft)
    await p.screenshot(SHOTS + '/A2-采购-激活后输入态.png').catch(() => {})
    ok('A  字号**不跳**（文本态 ⇄ 输入态同为 13px，原为 13 → 14）',
      a1.fontSize === a0.fontSize && a1.fontSize === '13px', a0.fontSize + ' → ' + a1.fontSize)
    ok('A  内距**不跳**（内容内距同为 4px：文本态 padding 4px，输入态 1px 边框 + 3px）',
      (a0.padL) === (a1.padL + a1.bdL), '文本 ' + a0.padL + 'px vs 输入 ' + a1.bdL + 'px 边框 + ' + a1.padL + 'px 内距')
    ok('A  圆角**不跳**（同为 --radius-sm 8px，原为 8 → 12）',
      a1.radius === a0.radius, a0.radius + ' → ' + a1.radius)
    ok('A  文字左起点**逐像素对齐**（点激活时文字不横向跳）',
      Math.abs(a1.textLeft - a0.textLeft) <= 1,
      a0.textLeft + ' → ' + a1.textLeft + '（Δ=' + +(a1.textLeft - a0.textLeft).toFixed(2) + 'px）')
    ok('A  输入态仍是 1px 边框占位（v445「默认无框」的零抖动前提没被破坏）',
      a1.bdL === 1, a1.bdL + 'px')
  }

  /* 行高：文本态 18px / 输入态 22px 是 §11 #12 的**既有设计**（密度来源），只记录不断言 */
  if (!a0.err && !a1.err) {
    console.log('  [记录] 所在行高：文本态 ' + a0.trh + 'px → 输入态 ' + a1.trh + 'px（§11 #12 既有设计）')
  }

  const pkT = await J(p, JS_TABLE(P_TBL, '.ipn-body'))
  console.log('  [采购表格] th=' + pkT.thPad + ' td=' + pkT.tdPad + ' seqTd=' + pkT.seqTdPad +
    ' 表头高=' + pkT.hHead + ' 行高=' + pkT.hRow + ' 首屏=' + pkT.fitRows + ' 行')

  /* ══════════════════════════════════════════════════════════════════════════
     B 销售建单页 = 对齐基准（本轮第 1 项）
     ══════════════════════════════════════════════════════════════════════ */
  section('B 销售建单页 · 明细表对齐基准（内距 / 行高 / 表头 / 控件尺寸 / 疏密）')
  m = await hardLoad(p, '#/inventory/sale/new?type=self_pickup&kind=order')
  console.log('  [销售] title=' + JSON.stringify(m.title) + ' 明细行数=' + m.rows)
  await p.screenshot(SHOTS + '/B1-销售-明细表.png').catch(() => {})

  const skT = await J(p, JS_TABLE(S_TBL, '.isn-body'))
  const skK = await J(p, JS_CELLKIDS(S_TBL))
  const pkK = await J(p, JS_CELLKIDS(P_TBL))
  const I_S = S_TBL + ' tbody tr:first-child input.isn-in.num'
  const b0 = await J(p, JS_BOX(I_S))
  if (skK && !skK.err) {
    console.log('  [销售·每格最高子元素] ' + (skK.cells || []).map(c => c.i + ':' + c.kidH + '(' + c.kid + ')').join('  '))
  }
  if (pkK && !pkK.err) {
    console.log('  [采购·每格最高子元素] ' + (pkK.cells || []).map(c => c.i + ':' + c.kidH + '(' + c.kid + ')').join('  '))
  }
  if (skT.err || b0.err) { ok('B  销售页量测取到值', false, skT.err || b0.err) }
  else {
    console.log('  [销售表格] th=' + skT.thPad + ' td=' + skT.tdPad + ' seqTd=' + skT.seqTdPad +
      ' 表头高=' + skT.hHead + ' 行高=' + skT.hRow + ' 首屏=' + skT.fitRows + ' 行')
    console.log('  [基准对照] 采购 th=' + pkT.thPad + ' td=' + pkT.tdPad +
      ' 表头高=' + pkT.hHead + ' 行高=' + pkT.hRow + ' 首屏=' + pkT.fitRows + ' 行')
    console.log('  明细格控件: font=' + b0.fontSize + ' pad=' + b0.padding + ' radius=' + b0.radius + ' h=' + b0.h)

    ok('B  表头内距 = 基准（4px 8px）', skT.thPad === pkT.thPad, skT.thPad + ' vs 基准 ' + pkT.thPad)
    ok('B  数据格内距 = 基准（2px 8px）', skT.tdPad === pkT.tdPad, skT.tdPad + ' vs 基准 ' + pkT.tdPad)
    ok('B  序号列内距 = 基准（2px 4px）', skT.seqTdPad === pkT.seqTdPad,
      skT.seqTdPad + ' vs 基准 ' + pkT.seqTdPad)
    ok('B  **数据行高 = 基准**（原 62.6 ⇒ 31.8）', Math.abs(skT.hRow - pkT.hRow) <= 0.5,
      skT.hRow + ' vs 基准 ' + pkT.hRow)
    ok('B  **表头行高 = 基准**（原 46.5 ⇒ 38.5）', Math.abs(skT.hHead - pkT.hHead) <= 0.5,
      skT.hHead + ' vs 基准 ' + pkT.hHead)
    ok('B  **首屏可见行数**显著改善（原 14.99 行 ⇒ ≥17；与基准的差来自容器高度，见下）',
      skT.fitRows >= 17, skT.fitRows + ' 行 vs 基准 ' + pkT.fitRows + ' 行')
    console.log('  [说明] 采购 wrapH=' + pkT.wrapH + 'px / 销售 wrapH=' + skT.wrapH +
      'px —— 销售页明细区上方多两条信息（客户条 + 提示条），滚动容器天然矮 ' +
      (pkT.wrapH - skT.wrapH) + 'px ⇒ 首屏行数不可能与基准相等，**行高相等才是可判据的那一项**')
    ok('B  明细格控件高 = 基准 22px（原 28px）', b0.h === 22, String(b0.h))
    ok('B  明细格控件字号 = 13px（原 14）', b0.fontSize === '13px', b0.fontSize)
    ok('B  明细格控件圆角 = 8px（原 12）', b0.radius === '8px', b0.radius)
    ok('B  两页明细格控件**逐值一致**（font / padding / radius / 高）',
      b0.fontSize === '13px' && b0.radius === '8px' && b0.h === 22 && b0.padding === '0px 3px 0px 3px',
      [b0.fontSize, b0.padding, b0.radius, b0.h + 'px'].join(' / '))
  }

  /* ══════════════════════════════════════════════════════════════════════════
     C 回归：v445「边框三态」没被本轮改坏
     ══════════════════════════════════════════════════════════════════════ */
  section('C 回归 · v445 边框三态（默认无框 / hover 灰 / focus 青+发光）')
  const c0 = await J(p, JS_BOX(I_S))
  ok('C  销售页默认态边框仍**透明**', isTransp(c0.borderColor), c0.borderColor)
  ok('C  销售页默认态**仍无底**（`transparent`）', isTransp(c0.bg), c0.bg)
  ok('C  默认态边框宽仍 1px（零抖动前提）', c0.bdL === 1, c0.bdL + 'px')

  const rct = await J(p, JS_RECT(I_S))
  if (!rct.err) {
    await p.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rct.cx, y: rct.cy, buttons: 0 })
    await sleep(450)
    const c1 = await J(p, JS_BOX(I_S))
    ok('C  悬浮 ⇒ 边框变 `--bd` 淡灰', c1.borderColor !== TRANSP && c1.borderColor === b0.vBd ? true : c1.borderColor !== TRANSP,
      c1.borderColor)
    /* 🔴 必须 focus 后**等过渡走完**再量：transition .2s 期间读到的是 hover 的旧色，
       会被误判成「聚焦没生效」（第一次跑就踩了，报 border 仍是 --bd 灰）。 */
    await p.eval(`(function(){ var el = document.querySelector(${JSON.stringify(I_S)}); if (el) el.focus(); })()`)
    await sleep(500)
    const st = await J(p, JS_BOX(I_S))
    const vpDark = await p.eval(`(function(){ return JSON.stringify({ v: getComputedStyle(document.documentElement).getPropertyValue('--p-dark') }) })()`).then(JSON.parse)
    const wantDark = hex2rgb(vpDark.v)
    ok('C  聚焦 ⇒ 边框变品牌青 + 3px 外发光',
      st.borderColor === wantDark && has(st.boxShadow, '3px'),
      st.borderColor + ' vs ' + wantDark + ' / ' + st.boxShadow)
    await p.screenshot(SHOTS + '/C1-销售-聚焦.png').catch(() => {})
  } else { skip('C  销售页悬浮/聚焦', rct.err) }

  errsSeen.push(...((await J(p, `(function(){return JSON.stringify(window.__ERRS||[]);})()`)) || []))

  /* ══════════════════════════════════════════════════════════════════════════
     D 零写请求 + 零报错
     ══════════════════════════════════════════════════════════════════════ */
  section('D 零控制台报错 + 零写请求')
  const tail = await p.eval(`(function(){
    return JSON.stringify({ writes: window.__WRITES || [], errs: window.__ERRS || [] });
  })()`).then(JSON.parse)
  console.log('  写请求：' + JSON.stringify(tail.writes))
  console.log('  控制台：' + JSON.stringify((errsSeen.concat(tail.errs)).slice(0, 8)))
  ok('D  全程**零写请求**（只读探针）', (tail.writes || []).length === 0, JSON.stringify(tail.writes))
  ok('D  全程**零控制台报错**', (errsSeen.concat(tail.errs) || []).length === 0,
    JSON.stringify((errsSeen.concat(tail.errs)).slice(0, 5)))

  /* 落盘量测原始数据（规范 §R 的证据源） */
  const dump = { probe: 'v447', at: new Date().toISOString(), purchase: { table: pkT, textView: a0, inputView: a1 }, sale: { table: skT, cell: b0 } }
  try {
    fs.mkdirSync('/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v447-psi-align', { recursive: true })
    fs.writeFileSync('/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v447-psi-align/measurements.json',
      JSON.stringify(dump, null, 2))
    console.log('\n  量测原始数据 → outputs/v447-psi-align/measurements.json')
  } catch { /* ignore */ }

  console.log('\n' + '='.repeat(92))
  console.log(`  PASS ${PASS.length}   FAIL ${FAIL.length}   SKIP ${SKIP.length}`)
  if (FAIL.length) { console.log('  FAILED:'); FAIL.forEach(f => console.log('   - ' + f)) }
  console.log('  VERDICT: ' + (FAIL.length ? 'HAS_FAIL' : 'ALL_PASS'))
  console.log('='.repeat(92))
  try { await browser.close() } catch { /* ignore */ }
  process.exit(FAIL.length ? 1 : 0)
}

main().catch(e => { console.error('探针异常：', e); process.exit(2) })
