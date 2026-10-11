/**
 * v448 退单模式视觉诊断与验收探针（生产 https://hergent.cn）
 *
 * 目的：把「退单模式」—— 采购退货单 / 自提退单 / 车销退单 / 调拨退单
 *       （都在 `?kind=return`，销售页另有 `?type=`）—— 与基准
 *       「新建采购订单」（规范 §R）**逐项量 computed style 比数值**，
 *       拿到一份可证伪的差异清单，而不是"看着不一样"。
 *
 * 为什么必须实测：框式与否、标签在框内还是框外、只读格的虚框 —— 这些**都是 class 与
 * 伪元素**（`-hd-box .‹pfx›-lb::after{content:'：'}`），读源码只能看出"挂了哪个类"，
 * 看不出渲染出来的字号 / 内距 / 高 / 背景，更看不出两页是否逐值相等。
 *
 * ── 探针自己的坑（本文件已按 v444~v447 的教训规避）──────────────────────────
 *   ① 只差 hash 的 `Page.navigate` = 同文档导航 ⇒ 必须 `'/?__r=' + Date.now() + hash`。
 *   ② 采购退货页**选不到可退明细**：生产 79 张已入库单**全部 0 明细行**
 *      （`purchase_order_items` 总量仅 11）⇒ 该页只能量表头与空态，明细表量不到，
 *      这是**数据**如此，不是代码缺陷 —— 探针据此 SKIP 而不是 FAIL。
 *   ③ 销售退货页要**先选一张原销售单**才渲染明细表；选单是 `change` 事件（GET 预览），
 *      不产生写请求。选单用的选择器必须走 `.isn-pick`（退货模式专属容器）——
 *      订单模式表单头里**也有** `.isn-sel`（出货方式），不加限定会选错控件。
 *   ④ `::after` 生成的内容**不在 textContent 里** ⇒ 判「标签带不带冒号」必须读
 *      `getComputedStyle(label, '::after').content`。
 *   ⑤ 模板串内**不能写反引号**；量测一律带 err 字段（曾因空 `{}` 被误导四轮）。
 *   ⑥ INIT 的 `hergent_v2_user` 必须与 TOKEN **同账号**（否则被踢到 #/login ⇒ 量测 {}）。
 *
 * 运行：
 *   V448_TOKEN=<boss 会话 token> \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v448-psi-return-probe.mjs
 */
import { launch } from './lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TOKEN = process.env.V448_TOKEN || ''
const TENANT = process.env.V448_TENANT || '1'
const USER_JSON = process.env.V448_USER_JSON ||
  JSON.stringify({ id: 2, username: 'boss', role: 'boss', roles: ['boss'], name: 'boss' })
const SHOTS = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v448-psi-return'
try { fs.mkdirSync(SHOTS, { recursive: true }) } catch { /* ignore */ }

const PASS = []; const FAIL = []; const SKIP = []
const ok = (name, cond, detail = '') => {
  ;(cond ? PASS : FAIL).push(name)
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  | ' + detail : ''))
}
const skip = (name, why) => { SKIP.push(name); console.log('  SKIP  ' + name + '  | ' + why) }
const section = (t) => console.log('\n' + '─'.repeat(94) + '\n' + t + '\n' + '─'.repeat(94))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const J = (p, expr) => p.eval(expr).then(JSON.parse)

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

/* ── 表单头量测 ───────────────────────────────────────────────────────────────
   量三样：① 头容器挂没挂框式类（`-hd-box`）；② 每个字段格自身的框（宽/高/内距/
   边框/底色/圆角）；③ 标签（字号 + `::after` 的冒号）与只读值（虚框？底色？）。
   `fSel` 必须按页传（采购 `.ipn-f` / 销售 `.isn-f`），不能写死。 */
const JS_HEAD = (hdSel, fSel) => `(function(){
  try {
    var hd = document.querySelector(${JSON.stringify(hdSel)});
    if (!hd) return JSON.stringify({ err: 'NOT_FOUND', sel: ${JSON.stringify(hdSel)} });
    var hcs = getComputedStyle(hd);
    var hdR = hd.getBoundingClientRect();
    var fs = hd.querySelectorAll(${JSON.stringify(fSel)});
    var out = [];
    for (var i = 0; i < fs.length & i < 8; i++) {
      var f = fs[i], cs = getComputedStyle(f), r = f.getBoundingClientRect();
      var lb = f.querySelector('label');
      var ro = f.querySelector('span[class$="-ro"]');
      var inp = f.querySelector('input, select');
      out.push({
        i: i, cls: String(f.className).slice(0, 36),
        w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        pad: cs.padding,
        bd: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
        radius: cs.borderTopLeftRadius, bg: cs.backgroundColor,
        dir: cs.flexDirection,
        lbText: lb ? String(lb.textContent).slice(0, 14) : '',
        lbFont: lb ? getComputedStyle(lb).fontSize : '',
        lbColor: lb ? getComputedStyle(lb).color : '',
        lbAfter: lb ? getComputedStyle(lb, '::after').content : '',
        roBg: ro ? getComputedStyle(ro).backgroundColor : '',
        roBd: ro ? (getComputedStyle(ro).borderTopWidth + ' ' + getComputedStyle(ro).borderTopStyle + ' ' + getComputedStyle(ro).borderTopColor) : '',
        roH: ro ? +ro.getBoundingClientRect().height.toFixed(1) : -1,
        inpW: inp ? +inp.getBoundingClientRect().width.toFixed(1) : -1,
        inpH: inp ? +inp.getBoundingClientRect().height.toFixed(1) : -1
      });
    }
    return JSON.stringify({
      err: '', cls: String(hd.className), boxed: String(hd.className).indexOf('-hd-box') >= 0,
      pad: hcs.padding, gap: hcs.gap, bg: hcs.backgroundColor,
      bd: hcs.borderTopWidth + ' ' + hcs.borderTopStyle + ' ' + hcs.borderTopColor,
      h: +hdR.height.toFixed(1), w: +hdR.width.toFixed(1),
      nField: fs.length, fields: out
    });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

/* 表格几何（同 v447，供退单明细表与基准对照） */
const JS_TABLE = (tsel, bodySel) => `(function(){
  try {
    var tbl = document.querySelector(${JSON.stringify(tsel)});
    if (!tbl) return JSON.stringify({ err: 'no-table' });
    var seqTh = tbl.querySelector('thead th.seq-th');
    var tr = tbl.querySelector('tbody>tr');
    var td = tbl.querySelectorAll('tbody>tr:first-child > td');
    var seqTd = tbl.querySelector('tbody>tr:first-child > td.seq-cell');
    var th2 = tbl.querySelector('thead th:nth-child(2)');
    var body = document.querySelector(${JSON.stringify(bodySel)});
    var wrap = body ? body.querySelector('.table-wrap') : null;
    var norm = null;
    for (var i = 0; i < td.length; i++) { if (!td[i].classList.contains('seq-cell')) { norm = td[i]; break } }
    var hRow = tr ? tr.getBoundingClientRect().height : -1;
    var hHead = seqTh ? seqTh.getBoundingClientRect().height : -1;
    var vh = wrap ? wrap.clientHeight : -1;
    return JSON.stringify({
      err: '',
      thPad: th2 ? getComputedStyle(th2).padding : '',
      tdPad: norm ? getComputedStyle(norm).padding : '',
      seqTdPad: seqTd ? getComputedStyle(seqTd).padding : '',
      hRow: +hRow.toFixed(2), hHead: +hHead.toFixed(2),
      wrapH: vh, fitRows: (hRow > 0 && vh > 0) ? +(vh / hRow).toFixed(2) : -1,
      rows: tbl.querySelectorAll('tbody>tr').length,
      minW: getComputedStyle(tbl).minWidth
    });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

const JS_BOX = (sel) => `(function(){
  try {
    var el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return JSON.stringify({ err: 'NOT_FOUND', sel: ${JSON.stringify(sel)} });
    var cs = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    return JSON.stringify({
      err: '', tag: el.tagName, cls: String(el.className).slice(0, 40),
      fontSize: cs.fontSize, pad: cs.padding,
      radius: cs.borderTopLeftRadius, h: +r.height.toFixed(2),
      borderColor: cs.borderTopColor, bdW: parseFloat(cs.borderTopWidth) || 0,
      bg: cs.backgroundColor, color: cs.color
    });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

/* 表头的「谁是那个撑高的东西」—— 用来给「退货表头比订单表矮 9px」**归因**。
   订单表头第一格是列设置齿轮（`.col-cfg`，30px 高按钮），退货表没有列设置 ⇒ 天然矮。
   这条把"矮"从"待解释的差异"变成"可证伪的断言"。 */
const JS_HEADGEAR = (tsel) => `(function(){
  try {
    var tbl = document.querySelector(${JSON.stringify(tsel)});
    if (!tbl) return JSON.stringify({ err: 'no-table' });
    var gear = tbl.querySelector('thead .col-cfg');
    var th = tbl.querySelector('thead th');
    var kids = th ? th.querySelectorAll('*') : [];
    var mx = 0, which = '';
    for (var i = 0; i < kids.length; i++) {
      var r = kids[i].getBoundingClientRect();
      if (r.height > mx) { mx = r.height; which = kids[i].tagName + '.' + String(kids[i].className).slice(0, 20); }
    }
    return JSON.stringify({ err: '', hasGear: !!gear,
      gearH: gear ? +gear.getBoundingClientRect().height.toFixed(1) : -1,
      thKidH: +mx.toFixed(1), thKid: which });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

/* 选一张原销售单（GET 预览，不产生写请求）。`.isn-pick` 是退货模式专属容器。 */
const JS_PICK_SO = `(async function(){
  var sel = document.querySelector('.isn-pick .isn-sel');
  if (!sel) return JSON.stringify({ err: 'no-sel', opts: 0 });
  var opts = Array.prototype.filter.call(sel.options, function(o){ return !o.disabled & Number(o.value) > 0 });
  if (!opts.length) return JSON.stringify({ err: 'no-options', opts: sel.options.length });
  sel.value = opts[0].value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(function(r){ setTimeout(r, 3000) });
  var tbl = document.querySelector('table.isn-ret-tbl');
  return JSON.stringify({ err: '', picked: opts[0].value, nOpt: opts.length,
    rows: tbl ? tbl.querySelectorAll('tbody>tr').length : 0 });
})()`

const JS_READY = `(function(){
  var t = document.title || '';
  var h = document.querySelector('.inv-page');
  return JSON.stringify({ title: t, hasPage: !!h,
    retHd: !!document.querySelector('.ipn-hd-flat, .isn-hd-flat') });
})()`

const TRANSP = 'rgba(0, 0, 0, 0)'
const isTransp = (c) => String(c).replace(/\s/g, '') === 'rgba(0,0,0,0)'

async function hardLoad (p, hash, wait0 = 7000) {
  let m = null
  for (let i = 0; i < 5; i++) {
    await p.goto(BASE + '/?__r=' + Date.now() + hash, i === 0 ? wait0 : 4500)
    m = await J(p, JS_READY)
    if (m && m.title) break
    await sleep(1200)
  }
  return m
}

/* 打印一个表单头的可读摘要 */
function dumpHead (label, h) {
  if (!h || h.err) { console.log('  [' + label + '] 量测失败: ' + ((h && h.err) || 'null')); return }
  console.log('  [' + label + '] cls=' + h.cls)
  console.log('    容器: pad=' + h.pad + ' gap=' + h.gap + ' bg=' + h.bg + ' bd=' + h.bd +
    ' 高=' + h.h + ' 宽=' + h.w + ' 格数=' + h.nField)
  ;(h.fields || []).forEach(f => {
    console.log('    格' + f.i + ' ' + f.cls.padEnd(26) +
      ' w=' + f.w + ' h=' + f.h + ' pad=' + f.pad +
      ' bd=[' + f.bd + '] r=' + f.radius + ' bg=' + f.bg + ' dir=' + f.dir)
    console.log('         标签 "' + f.lbText + '" font=' + f.lbFont + ' color=' + f.lbColor +
      ' ::after=' + f.lbAfter +
      ' | 只读 bg=' + f.roBg + ' bd=[' + f.roBd + '] h=' + f.roH +
      ' | 控件 w=' + f.inpW + ' h=' + f.inpH)
  })
}

const main = async () => {
  const browser = await launch({ headless: true })
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(INIT)
  await p.raw.send('Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })

  const P_TBL = 'table.ipn-tbl:not(.ipn-ret-tbl)'
  const S_TBL = 'table.isn-tbl:not(.isn-ret-tbl)'
  const SPEC = {}

  /* ══════════════════════════════════════════════════════════════════════════
     A 基准：采购建单页（订单模式，框式头）
     ══════════════════════════════════════════════════════════════════════ */
  section('A 基准 · 采购建单页 `?kind=order`（规范 §R 的框式头）')
  await hardLoad(p, '#/inventory/purchase/new?kind=order')
  const A_head = await J(p, JS_HEAD('.ipn-hd-box', '.ipn-f'))
  dumpHead('采购订单 表单头', A_head)
  SPEC.baseHead = A_head
  await p.screenshot(SHOTS + '/A0-基准-采购订单-表单头.png').catch(() => {})

  /* ══════════════════════════════════════════════════════════════════════════
     B 采购退货单（`?kind=return`）
     ══════════════════════════════════════════════════════════════════════ */
  section('B 采购退货单 `?kind=return` · 表单头 + 空态')
  const mb = await hardLoad(p, '#/inventory/purchase/new?kind=return')
  console.log('  title=' + JSON.stringify(mb.title))
  await p.screenshot(SHOTS + '/B0-采购退货单-全貌.png').catch(() => {})
  const B_head = await J(p, JS_HEAD('.ipn-hd-flat', '.ipn-f'))
  dumpHead('采购退货 表单头', B_head)
  SPEC.purchaseReturn = B_head

  const B_state = await p.eval(`(function(){
    var el = document.querySelector('.ipn-body .state-empty');
    return JSON.stringify({ err: '', text: el ? String(el.textContent).slice(0, 60) : '' });
  })()`).then(JSON.parse)
  console.log('  明细区状态文本: ' + JSON.stringify(B_state.text))
  if (B_state.text) skip('B  采购退货**明细表**量测', '生产无可退明细（79 张已入库单 0 明细行）⇒ 该页显示空态')

  /* ══════════════════════════════════════════════════════════════════════════
     C 销售退单（自提 / 车销 / 调拨 —— 同一组件，只验逐值相同）
     ══════════════════════════════════════════════════════════════════════ */
  section('C 销售退单 · 三个入口（自提 / 车销 / 调拨）表单头 + 明细表')
  const types = ['self_pickup', 'vehicle_sale', 'transfer']
  const heads = {}
  for (const t of types) {
    const m = await hardLoad(p, '#/inventory/sale/new?type=' + t + '&kind=return')
    console.log('  [' + t + '] title=' + JSON.stringify(m.title))
    const h = await J(p, JS_HEAD('.isn-hd-flat', '.isn-f'))
    dumpHead('销售退单 ' + t, h)
    heads[t] = h
    if (t === 'self_pickup') {
      await p.screenshot(SHOTS + '/C0-自提退单-表单头.png').catch(() => {})
      SPEC.saleReturn = h
    }
  }
  const hp = (k) => { const h = heads[k]; return h && !h.err ? h : null }
  const a = hp('self_pickup'); const b = hp('vehicle_sale'); const c = hp('transfer')
  /* v448：说明行（`.‹pfx›-hint`）已从「原单」格里**移到表单头外** ⇒ 那一格从 78~120px
     回到 32px，**四格等高**。所以这里不再剔掉它，只排除宽度（原单格 420px，其余由
     只读值宽度决定）—— 判据因此比上一版更严。 */
  const norm = (h) => (h.fields || [])
    .map(f => [f.h, f.pad, f.bd, f.radius, f.bg, f.lbAfter].join('~')).join('|')
  const heights = (h) => ((h && h.fields) || []).map(f => f.h)
  const fourEven = (h) => { const hs = heights(h); return hs.length === 4 && hs.every(x => x === 32) }
  if (a && b && c) {
    ok('C  三个退单入口的表单头**逐值相同**（同一组件 ⇒ 不该有差异）',
      a.cls === b.cls && b.cls === c.cls && norm(a) === norm(b) && norm(b) === norm(c),
      [a.cls, b.cls, c.cls].join(' / ') + ' || ' + norm(a))
    /* v448 的核心观感：说明行移到框外后，表单头是**四个 32px 等高的框**
       （留在框里时「原销售单」格是 120px、其余三格 32px，永远不齐）。 */
    ok('C  退单表单头**四格全部 32px 等高**（说明行在框外，不再把原单格撑高）',
      fourEven(a) && fourEven(b) && fourEven(c),
      [a, b, c].map(h => heights(h).join('/') + 'px').join('  |  '))
  }

  /* 选一张原销售单 ⇒ 渲染退货明细表 */
  const pick = await J(p, JS_PICK_SO)
  console.log('  选原销售单: ' + JSON.stringify(pick))
  if (pick.err || !pick.rows) {
    skip('C  销售退货**明细表**量测', '选单失败或无明细：' + JSON.stringify(pick))
  } else {
    await p.screenshot(SHOTS + '/C1-销售退货单-明细表.png').catch(() => {})
    const rt = await J(p, JS_TABLE('table.isn-ret-tbl', '.isn-body'))
    const rin = await J(p, JS_BOX('table.isn-ret-tbl tbody td.isn-c-qty input.isn-in'))
    const rgear = await J(p, JS_HEADGEAR('table.isn-ret-tbl'))
    console.log('  [退货明细表] th=' + rt.thPad + ' td=' + rt.tdPad + ' seqTd=' + rt.seqTdPad +
      ' 表头高=' + rt.hHead + ' 行高=' + rt.hRow + ' 行数=' + rt.rows + ' minW=' + rt.minW)
    console.log('  [退货明细格控件] ' + JSON.stringify(rin))
    SPEC.saleReturnTable = rt
    SPEC.saleReturnInput = rin
    SPEC.saleReturnGear = rgear
  }

  /* ══════════════════════════════════════════════════════════════════════════
     D 对照：销售订单模式（框式头 + 明细表）
     ══════════════════════════════════════════════════════════════════════ */
  section('D 对照 · 销售建单页 `?type=self_pickup&kind=order`')
  await hardLoad(p, '#/inventory/sale/new?type=self_pickup&kind=order')
  const D_head = await J(p, JS_HEAD('.isn-hd-box', '.isn-f'))
  dumpHead('销售订单 表单头', D_head)
  SPEC.saleOrderHead = D_head
  const D_tbl = await J(p, JS_TABLE(S_TBL, '.isn-body'))
  const D_gear = await J(p, JS_HEADGEAR(S_TBL))
  console.log('  [销售订单明细表] th=' + D_tbl.thPad + ' td=' + D_tbl.tdPad +
    ' 表头高=' + D_tbl.hHead + ' 行高=' + D_tbl.hRow + ' 行数=' + D_tbl.rows)
  console.log('  [订单表头第一格] 含列设置齿轮=' + D_gear.hasGear + '（齿轮高 ' + D_gear.gearH +
    'px）｜格内最高子元素 ' + D_gear.thKidH + 'px（' + D_gear.thKid + '）')
  SPEC.saleOrderTable = D_tbl
  SPEC.saleOrderGear = D_gear

  /* ══════════════════════════════════════════════════════════════════════════
     F 核心判据：退单模式表单头 ⇄ 订单模式表单头（**逐值**，不是"差不多"）
     ══════════════════════════════════════════════════════════════════════ */
  section('F 退单模式表单头 ⇄ 订单模式表单头（框体 / 标签冒号 / 只读值，逐值比对）')
  /* 「参考格」取**基准订单模式头的第一格**：它是框式的既定样本，颜色 / 圆角 / 内距
     都从**同一次运行**量出来（不硬编码色值 —— 换主题就误判）。 */
  const ref = ((SPEC.baseHead && SPEC.baseHead.fields) || [])[0] || null
  const fld = (h, pred) => ((h && h.fields) || []).find(pred) || null
  const roOf = (h) => fld(h, f => f.roH > 0)
  /* 🔴 比对的是**每一格的框体**，不是"先筛出一个普通格"：退单那排除掉「原单」格外
     全是**只读格**（`.‹pfx›-ro`），压根不存在"无控件的普通格"—— 首轮拿 `inpW < 0`
     当筛子，筛出 `null`，把一条本该 PASS 的判据判成 FAIL 并连锁抛异常。 */
  const boxOk = (h) => {
    const fs = ((h && h.fields) || [])
    if (!fs.length || !ref) return false
    return fs.every(f => f.pad === ref.pad && f.bd === ref.bd &&
      f.radius === ref.radius && f.bg === ref.bg && f.lbAfter === ref.lbAfter)
  }
  const boxDump = (h) => ((h && h.fields) || [])
    .map(f => f.pad + ' | ' + f.bd + ' | r=' + f.radius + ' | ' + f.bg + ' | ' + f.lbAfter).join(' || ')
  const badBox = (h) => ((h && h.fields) || [])
    .filter(f => (f.pad !== ref.pad || f.bd !== ref.bd || f.radius !== ref.radius ||
      f.bg !== ref.bg || f.lbAfter !== ref.lbAfter))
    .map(f => f.cls + ' → ' + f.pad + ' | ' + f.bd + ' | r=' + f.radius + ' | ' + f.bg + ' | ' + f.lbAfter)

  console.log('  [基准·采购订单 参考格] ' + (ref
    ? ref.pad + ' | ' + ref.bd + ' | r=' + ref.radius + ' | ' + ref.bg + ' | ::after=' + ref.lbAfter
    : 'null'))

  /* ── F1 采购退货 ⇄ 采购订单 ── */
  console.log('  [待验·采购退货 每格]   ' + boxDump(SPEC.purchaseReturn))
  ok('F  采购退货**头容器**挂上了框式类',
    SPEC.purchaseReturn && SPEC.purchaseReturn.boxed === true,
    String(SPEC.purchaseReturn && SPEC.purchaseReturn.boxed))
  ok('F  采购退货**每一格**的框与订单模式**逐值相同**（内距 / 边框 / 圆角 / 底色 / 标签冒号）',
    boxOk(SPEC.purchaseReturn), badBox(SPEC.purchaseReturn).join(' ; ') || '全格一致')
  ok('F  采购退货表单头**四格全部 32px 等高**（说明行在框外）',
    fourEven(SPEC.purchaseReturn), heights(SPEC.purchaseReturn).join('/') + 'px')

  /* 只读值：撤虚框、进框成为「值」—— 与框内控件同款（30px 高 / 无边框 / 无底色） */
  const roP = roOf(SPEC.purchaseReturn)
  console.log('  [采购退货·只读值] ' + (roP ? 'h=' + roP.roH + ' bd=[' + roP.roBd + '] bg=' + roP.roBg + ' ::after=' + roP.lbAfter : 'null'))
  ok('F  采购退货**只读值已撤虚框**（不再是 `1px dashed`）',
    !!roP && /^0px/.test(String(roP.roBd)), roP && roP.roBd)
  ok('F  采购退货**只读值无底色**（与框内控件同款，不再是 `--bg2` 灰块）',
    !!roP && isTransp(roP.roBg), roP && roP.roBg)
  ok('F  采购退货只读值与框内控件**同高 30px**',
    !!roP && roP.roH === 30, String(roP && roP.roH))

  /* ── F2 销售退单 ⇄ 销售订单 ── */
  console.log('  [待验·自提退单 每格]   ' + boxDump(SPEC.saleReturn))
  ok('F  销售退单**头容器**挂上了框式类',
    SPEC.saleReturn && SPEC.saleReturn.boxed === true,
    String(SPEC.saleReturn && SPEC.saleReturn.boxed))
  ok('F  销售退单**每一格**的框与订单模式**逐值相同**',
    boxOk(SPEC.saleReturn), badBox(SPEC.saleReturn).join(' ; ') || '全格一致')

  const roS = roOf(SPEC.saleReturn)
  console.log('  [销售退单·只读值] ' + (roS ? 'h=' + roS.roH + ' bd=[' + roS.roBd + '] bg=' + roS.roBg : 'null'))
  ok('F  销售退单**只读值已撤虚框且无底色**',
    !!roS && /^0px/.test(String(roS.roBd)) && isTransp(roS.roBg),
    roS && (roS.roBd + ' / ' + roS.roBg))

  /* ── F3 退货明细表 ⇄ 订单明细表（内距必须同基准；控件已共用 `.‹pfx›-in`） ── */
  if (SPEC.saleReturnTable && !SPEC.saleReturnTable.err) {
    const rt = SPEC.saleReturnTable; const dt = SPEC.saleOrderTable
    console.log('  [退货明细表] th=' + rt.thPad + ' td=' + rt.tdPad + ' seqTd=' + rt.seqTdPad +
      ' 行高=' + rt.hRow + ' 行数=' + rt.rows)
    console.log('  [订单明细表] th=' + dt.thPad + ' td=' + dt.tdPad + ' seqTd=' + dt.seqTdPad + ' 行高=' + dt.hRow)
    ok('F  退货明细表**内距**与订单表逐值相同（th / td / 序号列）',
      rt.thPad === dt.thPad && rt.tdPad === dt.tdPad && rt.seqTdPad === dt.seqTdPad,
      [rt.thPad, rt.tdPad, rt.seqTdPad].join(' | '))
    /* 🔴 表头高**本来就该不同**：订单表头第一格是「列设置」齿轮（30px 的按钮），
       退货表列是固定的（不做列设置）⇒ 结构上就矮一截。判据落在**归因**（哪边有齿轮、
       齿轮多高）而不是硬凑高度 —— 把 29px 拉到 38px 只是往空的地方塞像素。 */
    const dg = SPEC.saleOrderGear; const rg = SPEC.saleReturnGear
    ok('F  退货表头高差异**已归因**（订单表头含列设置齿轮按钮 ⇒ 撑高；退货表列固定、无齿轮）',
      !!dg && !!rg && dg.hasGear === true && dg.gearH >= 28 && rg.hasGear === false &&
      Math.abs(rt.hHead - dt.hHead) <= 12,
      '订单 gear=' + (dg && dg.gearH) + 'px 表头=' + dt.hHead +
      '｜退货 hasGear=' + (rg && rg.hasGear) + ' 表头=' + rt.hHead)
    ok('F  退货明细表 `min-width` **真的生效**（900px —— 原先被通用表格规则静默覆盖）',
      rt.minW === '900px', rt.minW)
    const rin = SPEC.saleReturnInput
    ok('F  退货明细格控件 = 基准 22px / 13px / radius 8 / `0 3px`（v447 口径自动生效）',
      !!rin && !rin.err && rin.h === 22 && rin.fontSize === '13px' && rin.radius === '8px' &&
      rin.pad === '0px 3px',
      rin && [rin.h + 'px', rin.fontSize, rin.radius, rin.pad].join(' / '))
    ok('F  退货明细格默认**无框无底**（v445 三态口径自动生效）',
      !!rin && !rin.err && isTransp(rin.borderColor) && isTransp(rin.bg) && rin.bdW === 1,
      rin && (rin.borderColor + ' / ' + rin.bg + ' / bdW=' + rin.bdW))
  } else {
    skip('F  退货明细表对齐', '本次未选到可退明细')
  }

  /* ══════════════════════════════════════════════════════════════════════════
     E 零写请求 + 零报错
     ══════════════════════════════════════════════════════════════════════ */
  section('E 零控制台报错 + 零写请求')
  const tail = await J(p, `(function(){
    return JSON.stringify({ writes: window.__WRITES || [], errs: window.__ERRS || [] });
  })()`)
  console.log('  写请求：' + JSON.stringify(tail.writes))
  console.log('  控制台：' + JSON.stringify((tail.errs || []).slice(0, 6)))
  ok('E  全程**零写请求**（只读探针）', (tail.writes || []).length === 0, JSON.stringify(tail.writes))
  ok('E  全程**零控制台报错**', (tail.errs || []).length === 0, JSON.stringify((tail.errs || []).slice(0, 5)))

  try {
    fs.writeFileSync(SHOTS + '/measurements.json',
      JSON.stringify({ probe: 'v448', at: new Date().toISOString(), spec: SPEC }, null, 2))
    console.log('\n  量测原始数据 → outputs/v448-psi-return/measurements.json')
  } catch { /* ignore */ }

  console.log('\n' + '='.repeat(94))
  console.log(`  PASS ${PASS.length}   FAIL ${FAIL.length}   SKIP ${SKIP.length}`)
  if (FAIL.length) { console.log('  FAILED:'); FAIL.forEach(f => console.log('   - ' + f)) }
  console.log('  VERDICT: ' + (FAIL.length ? 'HAS_FAIL' : 'ALL_PASS'))
  console.log('='.repeat(94))
  try { await browser.close() } catch { /* ignore */ }
  process.exit(FAIL.length ? 1 : 0)
}

main().catch(e => { console.error('探针异常：', e); process.exit(2) })
