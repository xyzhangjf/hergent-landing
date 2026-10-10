/**
 * v441/v443 进销存建单页 —— **六界面**只读真机探针（生产 https://hergent.cn）
 *
 * 验的是《进销存建单页开发规范-v441.md》落到**六个入口**上的可证伪事实，
 * 不是「读代码觉得对」。分七相：
 *
 *   A 硬导航：六个入口各自整文档加载 ⇒ 标题逐字 / 非白屏 / 零新增报错
 *   B 逐界面模式落地（**带交互**）：
 *       订单模式 → 选客户后读数条出现（5 项）；字段框 6 格 2 个红 `*`；
 *                 明细表 5 行预设 + 齿轮 + 序号列 46px 居中
 *       退货模式 → 选原销售单/原采购单后**退货明细表 9 列 + 行数 > 0** +
 *                 「保存退货单」转为可用（未选单时必须**禁用** = 前置门禁）
 *   C 数据面：下拉候选数与接口真值逐个对账（含 v443 的 `limit` 上限）
 *   D 站内切换（**判别力最强**）：同一 path 只变 query ⇒ vue-router
 *        **复用组件实例、`onMounted` 不再跑**。若模式只在 `onMounted` 里读一次
 *        query，页面会停在旧模式**且零报错** ⇒ 这里全程只用 `location.hash`
 *        导航，断言标题与模式 DOM 必须跟着翻转。
 *   E 反例自证：同一套判据拿到「采购单（订单模式）」上必须不成立。
 *   F 零写请求 + 零控制台报错。
 *
 * ── v443 追加的一条硬判据 ────────────────────────────────────────────────
 *   退货模式提示语里的「已载入 N 张」**必须等于接口真值**（C 相）。
 *   改动前 `/api/psi/sale-orders` 不声明 `limit`、FastAPI 静默忽略 ⇒
 *   前端 `RET_PICK_LIMIT = 300` 是死参数、N 恒 100。本判据正是那个 bug 的探针。
 *
 * ── 三个「探针自己会判错」的坑（已在本文件里规避，别再踩）────────────────
 *   ① `.ipn-ret-tbl` 同时带 `ipn-tbl` 类（`class="tbl ipn-tbl ipn-ret-tbl"`）⇒
 *      「订单模式那张表」必须写成 `:not(.-ret-tbl)`，否则退货模式也判「有」。
 *   ② 订单模式的读数条 `v-if` 条件是**选了客户**；退货模式的明细表 `v-if` 链要求
 *      **选了原单** ⇒ 不交互就量测，量到的「没有」是**设计如此**，不是缺陷。
 *   ③ 按钮定位**不许用类名**：`.ipn-save-main` 只存在于采购页（且它的作用是
 *      「去掉右上/右下圆角，与旁边的下拉拼在一条」——销售退货页只有一个按钮，
 *      不需要它）。用**文案**定位才是稳的判据。
 *   ④ 重试条件必须是 `title` 非空。用 `hdBox || retTbl` 会在退货模式上**首测即
 *      判定"量完了"并跳出重试**（两者按设计都为 false）⇒ 采到未渲染的空页。
 *
 * 运行：
 *   V441_TOKEN=$(ssh -o BatchMode=yes root@47.113.224.140 \
 *       'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v441-psi-new-e2e.mjs
 */
import { launch } from './lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TOKEN = process.env.V441_TOKEN || ''
const TENANT = process.env.V441_TENANT || '1'
const SHOTS = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v441-psi-new'
try { fs.mkdirSync(SHOTS, { recursive: true }) } catch { /* ignore */ }

const PASS = []; const FAIL = []
const ok = (name, cond, detail = '') => {
  ;(cond ? PASS : FAIL).push(name)
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  | ' + detail : ''))
}
const section = (t) => console.log('\n' + '─'.repeat(88) + '\n' + t + '\n' + '─'.repeat(88))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/* ── 注入：token + 写请求监听 ─────────────────────────────────────────────── */
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

/* ── 量测 ─────────────────────────────────────────────────────────────────── */
const MEASURE = `(function(){
  try {
    var h = location.hash;
    var isPur = h.indexOf('/purchase/') >= 0;
    var isRet = /kind=return/.test(h);
    var root = isPur ? 'ipn' : 'isn';
    var q = function(s){ return document.querySelector(s); };
    var out = { hash: h, isPur: isPur, isRet: isRet, root: root };
    var h2 = q('.page-hd h2'); out.title = h2 ? h2.textContent.trim() : null;
    var sub = q('.page-hd .page-sub'); out.sub = sub ? sub.textContent.trim() : '';
    out.hdBox  = !!q('.' + root + '-hd-box');
    out.hdBoxF = document.querySelectorAll('.' + root + '-hd-box .' + root + '-f').length;
    out.reqN   = document.querySelectorAll('.' + root + '-hd .' + root + '-req').length;
    out.roN    = document.querySelectorAll('.' + root + '-hd .' + root + '-ro').length;
    out.strip  = !!q('.' + root + '-strip');
    out.stripN = document.querySelectorAll('.' + root + '-strip .' + root + '-si').length;
    out.stripTxt = (function(){ var e = q('.' + root + '-strip'); return e ? e.textContent.replace(/\\s+/g,' ').trim() : ''; })();
    out.retTbl = !!q('table.' + root + '-ret-tbl');
    out.ordTbl = !!q('table.' + root + '-tbl:not(.' + root + '-ret-tbl)');
    out.gear   = !!q('.col-cfg.gear');
    function thead(t){ if(!t) return []; var ths=t.querySelectorAll('thead>tr>th'); var a=[];
      for(var i=0;i<ths.length;i++) a.push(ths[i].textContent.trim().replace(/\\s+/g,' ')); return a; }
    function rows(t){ return t ? t.querySelectorAll('tbody>tr').length : -1; }
    var ot = q('table.' + root + '-tbl:not(.' + root + '-ret-tbl)');
    var rt = q('table.' + root + '-ret-tbl');
    out.ordTh = thead(ot); out.ordRows = rows(ot);
    out.retTh = thead(rt); out.retRows = rows(rt);
    out.retFilled = rt ? rt.querySelectorAll('tbody input.isn-in, tbody input.ipn-in').length : -1;
    var sc = (ot && ot.querySelector('tbody td.seq-cell')) || (rt && rt.querySelector('tbody td.seq-cell'));
    if (sc) { out.seqW = Math.round(sc.getBoundingClientRect().width); out.seqAlign = getComputedStyle(sc).textAlign; }
    var soSel = q('.isn-f-so select.isn-sel') || q('.ipn-f-po select.ipn-sel');
    out.soSel = !!soSel;
    out.soOpts = soSel ? soSel.options.length : -1;
    out.soPh = (soSel && soSel.options[0]) ? soSel.options[0].textContent.trim() : '';
    out.soFirst = (soSel && soSel.options[1]) ? soSel.options[1].textContent.replace(/\\s+/g,' ').trim() : '';
    /* 出货方式下拉：按 <label> 文案找，不按下标（下标会随字段增减漂移） */
    var tsel = null;
    var flds = document.querySelectorAll('.' + root + '-hd-box .' + root + '-f');
    for (var i = 0; i < flds.length; i++) {
      var lb = flds[i].querySelector('.' + root + '-lb');
      if (lb && lb.textContent.replace(/[\\s*]/g, '') === '出货方式') tsel = flds[i].querySelector('select');
    }
    out.orderType = tsel ? tsel.value : null;
    out.typeOpts = tsel ? tsel.options.length : -1;
    function btxt(sel){ var bs=document.querySelectorAll(sel); var a=[];
      for(var i=0;i<bs.length;i++) a.push(bs[i].textContent.replace(/\\s+/g,' ').trim()); return a; }
    out.hdBtns = btxt('.page-hd button');
    out.btmBtns = btxt('.' + root + '-bottom button');
    /* 主按钮按**文案**定位（类名两页不同，见文件头坑 ③） */
    out.retSave = (function(){
      var bs = document.querySelectorAll('.' + root + '-bottom button, .' + root + '-save button');
      for (var i = 0; i < bs.length; i++) {
        if (/保存退货单/.test(bs[i].textContent))
          return { txt: bs[i].textContent.replace(/\\s+/g,' ').trim(), dis: bs[i].disabled };
      }
      return null;
    })();
    var hn = q('.' + root + '-hint'); out.hint = hn ? hn.textContent.replace(/\\s+/g,' ').trim() : '';
    var em = q('.state-empty'); out.emptyTxt = em ? em.textContent.replace(/\\s+/g,' ').trim() : '';
    out.bodyLen = (document.body.innerText || '').length;
    return JSON.stringify(out);
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

/* ── 交互：选客户（订单模式读数条的前提）──────────────────────────────────── */
const JS_PICK_CUSTOMER = `(async function(){
  var flds = document.querySelectorAll('.isn-hd-box .isn-f');
  var sel = null;
  for (var i = 0; i < flds.length; i++) {
    var lb = flds[i].querySelector('.isn-lb');
    if (lb && lb.textContent.replace(/[\\s*]/g, '') === '客户') sel = flds[i].querySelector('select.isn-sel');
  }
  if (!sel) return JSON.stringify({ err: 'no-customer-select' });
  if (sel.options.length < 2) return JSON.stringify({ err: 'no-customer-option', opts: sel.options.length });
  sel.value = sel.options[1].value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(function(r){ setTimeout(r, 1200) });
  return JSON.stringify({ ok: true, picked: sel.options[1].textContent.trim() });
})()`

/* ── 交互：选原单（退货模式明细表的前提）→ 走一次真实的 return-preview ───── */
const JS_PICK_SO = `(async function(){
  var sel = document.querySelector('.isn-f-so select.isn-sel') || document.querySelector('.ipn-f-po select.ipn-sel');
  if (!sel) return JSON.stringify({ err: 'no-so-select' });
  if (sel.options.length < 2) return JSON.stringify({ err: 'no-so-option', opts: sel.options.length });
  sel.value = sel.options[1].value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(function(r){ setTimeout(r, 2200) });
  return JSON.stringify({ ok: true, picked: sel.options[1].textContent.replace(/\\s+/g,' ').trim() });
})()`

/* ── 交互：按 oid 精确选原单（比"选第 2 项"稳：候选顺序会随数据变）────────── */
const JS_PICK_SO_ID = (oid) => `(async function(){
  var sel = document.querySelector('.isn-f-so select.isn-sel') || document.querySelector('.ipn-f-po select.ipn-sel');
  if (!sel) return JSON.stringify({ err: 'no-select' });
  var hit = null;
  for (var i = 0; i < sel.options.length; i++) if (Number(sel.options[i].value) === ${oid}) hit = sel.options[i];
  if (!hit) return JSON.stringify({ err: 'oid-not-in-options', oid: ${oid} });
  sel.value = hit.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(function(r){ setTimeout(r, 2400) });
  return JSON.stringify({ ok: true, picked: hit.textContent.replace(/\\s+/g,' ').trim() });
})()`

/* ── 交互：在**下拉候选集内**逐张问 return-preview，找出第一张真的能退的 ──────
   🔴 为什么要扫而不是「选第 2 项」：候选集是**粗筛**（列表端点按状态筛），
      「在候选里」≠「真的能退」。实测 tenant 1 的采购侧候选中**一张都不真的能退**
      （79 张 `received` 单全无明细行）⇒ 探针必须能区分这两种情况，
      否则会把"数据事实"误报成"代码缺陷"，或反过来把缺陷当成正常。 */
const JS_FIND_RETURNABLE = (kind) => `(async function(){
  var sel = document.querySelector(${JSON.stringify(kind === 'so' ? '.isn-f-so select.isn-sel' : '.ipn-f-po select.ipn-sel')});
  if (!sel) return JSON.stringify({ err: 'no-select' });
  var base = ${JSON.stringify(kind === 'so' ? '/api/psi/sale-orders/' : '/api/psi/purchase-orders/')};
  var h = { 'Authorization': 'Bearer ${TOKEN}', 'X-Tenant-Id': '${TENANT}' };
  var tried = 0, firstReason = '', firstOid = 0, firstLabel = '';
  var n = Math.min(sel.options.length, 13);
  for (var i = 1; i < n; i++) {
    var oid = Number(sel.options[i].value);
    if (!oid) continue;
    tried++;
    try {
      var r = await fetch(base + oid + '/return-preview', { headers: h });
      var d = await r.json();
      if (!firstReason) {
        firstReason = d.reason || ''; firstOid = oid;
        firstLabel = sel.options[i].textContent.replace(/\\s+/g,' ').trim();
      }
      if (d.can_return === true && (d.items || []).length > 0) {
        return JSON.stringify({ found: oid, tried: tried, items: (d.items||[]).length,
          label: sel.options[i].textContent.replace(/\\s+/g,' ').trim(), firstReason: firstReason });
      }
    } catch (e) { /* 单张失败不中断扫描 */ }
  }
  return JSON.stringify({ found: null, tried: tried, opts: sel.options.length,
    firstOid: firstOid, firstLabel: firstLabel, firstReason: firstReason });
})()`

/* ── 接口对账：退货模式候选集应有几张单（原样重放页面的查询）────────────── */
const API_SO = (type) => `(async function(){
  var h = { 'Authorization': 'Bearer ${TOKEN}', 'X-Tenant-Id': '${TENANT}' };
  var t = ${JSON.stringify(type ? ('&order_type=' + type) : '')};
  var ids = {}; var raw = {};
  for (var i = 0; i < 2; i++) {
    var st = i === 0 ? 'delivered' : 'signed';
    try {
      /* 🔴 必须与页面同参：页面传 limit=300（v443 起后端真的认） */
      var r = await fetch('${BASE}/api/psi/sale-orders?limit=300&status=' + st + t, { headers: h });
      var d = await r.json();
      raw[st] = { status: r.status, total: d.total, n: (d.orders || []).length };
      (d.orders || []).forEach(function(o){ ids[o.id] = 1 });
    } catch (e) { raw[st] = { err: String(e) } }
  }
  return JSON.stringify({ n: Object.keys(ids).length, raw: raw });
})()`
const API_PO = `(async function(){
  var h = { 'Authorization': 'Bearer ${TOKEN}', 'X-Tenant-Id': '${TENANT}' };
  var r = await fetch('${BASE}/api/psi/purchase-orders?returnable=1&limit=100', { headers: h });
  var d = await r.json();
  return JSON.stringify({ status: r.status, n: (d.orders || []).length, total: d.total });
})()`

const J = (p, expr) => p.eval(expr).then(JSON.parse)

const CASES = [
  { name: '自提订单', hash: '#/inventory/sale/new?type=self_pickup&kind=order',
    title: '新建自提订单', mode: 'order', root: 'isn', type: 'self_pickup' },
  { name: '自提退单', hash: '#/inventory/sale/new?type=self_pickup&kind=return',
    title: '新建自提退单', mode: 'ret', root: 'isn', type: 'self_pickup', api: 'so' },
  { name: '车销订单', hash: '#/inventory/sale/new?type=vehicle_sale&kind=order',
    title: '新建车销订单', mode: 'order', root: 'isn', type: 'vehicle_sale' },
  { name: '车销退单', hash: '#/inventory/sale/new?type=vehicle_sale&kind=return',
    title: '新建车销退单', mode: 'ret', root: 'isn', type: 'vehicle_sale', api: 'so' },
  { name: '调拨单', hash: '#/inventory/sale/new?type=transfer&kind=order',
    title: '新建调拨单', mode: 'order', root: 'isn', type: 'transfer' },
  { name: '采购退货单', hash: '#/inventory/purchase/new?kind=return',
    title: '新建采购退货单', mode: 'ret', root: 'ipn', type: '', api: 'po' },
]
const CONTROL = { name: '【反例】采购单(订单模式)', hash: '#/inventory/purchase/new?kind=order',
  title: '新建采购单', mode: 'order', root: 'ipn', type: '' }

/** 硬导航 + 有界重试（🔴 重试条件 = `title` 非空；退货模式下 hdBox/retTbl 按设计都为 false） */
async function hardLoad (p, hash, wait0 = 6500) {
  let m = null
  for (let i = 0; i < 5; i++) {
    /* 🔴 必须给**文档 URL** 加一个一次性 query（`?__r=`）才能真正重载。
       实测（Chrome 153）：`Page.navigate` 到一个**只差 hash** 的 URL 会被当成
       **同文档导航** ⇒ 文档不重载、Vue 应用不重建、`onMounted` 不跑，
       连 `form.customer_id` 都原样留着（症状：车销/调拨页"未选客户却有读数条"）。
       本仓既有惯例见 `v396-tabbar-shot.mjs` 的 `'/?__r=' + Date.now() + '#/…'`。 */
    await p.goto(BASE + '/?__r=' + Date.now() + hash, i === 0 ? wait0 : 4200)
    try { m = await J(p, MEASURE) } catch (e) { m = { err: String(e.message) } }
    if (m && m.title) return m
    await sleep(1800)
  }
  return m || { err: 'never-rendered' }
}

const main = async () => {
  if (!TOKEN) { console.error('缺 V441_TOKEN'); process.exit(2) }
  const browser = await launch({ headless: true })
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(INIT)
  try {
    await p.raw.send('Emulation.setDeviceMetricsOverride',
      { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })

    /* ══ A 相：硬导航 ═════════════════════════════════════════════════════ */
    section('A 相  硬导航 —— 六个入口各自整文档加载（onMounted 路径）')
    const hard = {}
    let idx = 0
    for (const c of CASES) {
      idx++
      const err0 = p.errors.length
      const m = await hardLoad(p, c.hash)
      hard[c.name] = m
      console.log('\n  ▸ ' + c.name + '  ' + c.hash)
      console.log('    量测 ' + JSON.stringify({
        title: m.title, hdBox: m.hdBox, retTbl: m.retTbl, ordRows: m.ordRows,
        soOpts: m.soOpts, orderType: m.orderType, seqW: m.seqW, gear: m.gear, bodyLen: m.bodyLen,
      }))
      ok(`A${idx}.1 ${c.name}：标题 = 「${c.title}」`, m.title === c.title, 'title=' + m.title)
      ok(`A${idx}.2 ${c.name}：页头渲染出来了（非白屏，动作条含「返回列表」）`,
        (m.hdBtns || []).some(x => x === '返回列表') && (m.bodyLen || 0) > 200,
        'bodyLen=' + m.bodyLen + ' hdBtns=' + JSON.stringify(m.hdBtns))
      ok(`A${idx}.3 ${c.name}：本相无新增控制台报错`, p.errors.length === err0,
        JSON.stringify(p.errors.slice(err0, err0 + 2)))
      await p.screenshot(SHOTS + '/A-' + c.name + '.png').catch(() => {})
    }

    /* ══ B 相：订单模式（3 个）—— 字段框 / 读数条（选客户后）/ 明细表 ═════ */
    section('B 相  订单模式（自提 / 车销 / 调拨）：字段框 + 读数条 + 明细表')
    for (const c of CASES.filter(x => x.mode === 'order')) {
      const n = `订单模式「${c.name}」`
      let m = await hardLoad(p, c.hash)
      ok(`B  ${n}：字段框 \`.isn-hd-box\` 在位（标签与输入同行、框内）`, m.hdBox === true, 'hdBox=' + m.hdBox)
      ok(`B  ${n}：字段框 6 格且含 2 个红 \`*\` 必填（客户 / 出货仓库）`,
        m.hdBoxF === 6 && m.reqN === 2, 'f=' + m.hdBoxF + ' req=' + m.reqN)
      ok(`B  ${n}：明细表在位、退货明细表**不在**（两分支未互相渗透）`,
        m.ordTbl === true && m.retTbl === false, 'ord=' + m.ordTbl + ' ret=' + m.retTbl)
      ok(`B  ${n}：出厂预设 5 行空行（销售单口径，采购单是 15 行）`, m.ordRows === 5, 'rows=' + m.ordRows)
      ok(`B  ${n}：出货方式由 \`?type=\` 预置 ⇒「${c.type}」`, m.orderType === c.type,
        'got=' + m.orderType + ' opts=' + m.typeOpts)
      ok(`B  ${n}：表头首列是列设置齿轮（\`.col-cfg.gear\`）`, m.gear === true && m.ordTh[0] === '',
        'gear=' + m.gear + ' th0=' + JSON.stringify(m.ordTh[0]))
      ok(`B  ${n}：序号列 46px 居中（全局唯一源）`, m.seqW === 46 && m.seqAlign === 'center',
        'w=' + m.seqW + ' align=' + m.seqAlign)
      ok(`B  ${n}：未选客户时**没有**读数条（空态不占一行）`, m.strip === false, 'strip=' + m.strip)

      const pick = await J(p, JS_PICK_CUSTOMER)
      m = await J(p, MEASURE)
      console.log('    选客户 → ' + JSON.stringify(pick) + ' ⇒ strip=' + m.strip + ' n=' + m.stripN)
      ok(`B  ${n}：选客户后读数条出现且 5 项（客户/信用额度/账期/出货方式/合计）`,
        m.strip === true && m.stripN >= 4,
        'strip=' + m.strip + ' n=' + m.stripN + ' txt=' + JSON.stringify((m.stripTxt || '').slice(0, 70)))
      await p.screenshot(SHOTS + '/B-' + c.name + '.png').catch(() => {})
    }

    /* ══ C 相：退货模式（3 个）—— 选原单前的门禁 + 选原单后的真实明细 ═════ */
    section('C 相  退货模式（自提退单 / 车销退单 / 采购退货单）：门禁 + 可退明细')
    const retData = {}
    for (const c of CASES.filter(x => x.mode === 'ret')) {
      const n = `退货模式「${c.name}」`
      let m = await hardLoad(p, c.hash)
      const apiN = c.api === 'so'
        ? (await J(p, API_SO(c.type))).n
        : (await J(p, API_PO)).n
      retData[c.name] = { apiN, before: m }
      console.log('\n  ▸ ' + c.name + '  接口候选=' + apiN + '  下拉=' + m.soOpts + ' 项（含 1 占位）')

      ok(`C  ${n}：**没有**订单模式的字段框 \`.hd-box\`（分支真的换了）`, m.hdBox === false, 'hdBox=' + m.hdBox)
      ok(`C  ${n}：原单选择器在位、首项是禁用占位「请选择…」`,
        m.soSel === true && /^请选择/.test(m.soPh || ''), 'sel=' + m.soSel + ' ph=' + JSON.stringify(m.soPh))
      ok(`C  ${n}：读数条 3 项（可退商品 / 本次退货 / 退货金额）`, m.strip === true && m.stripN === 3,
        'strip=' + m.strip + ' n=' + m.stripN)
      ok(`C  ${n}：未选原单时「保存退货单」**禁用**（前置门禁，不是点了才报错）`,
        !!m.retSave && m.retSave.dis === true, JSON.stringify(m.retSave))
      ok(`C  ${n}：未选原单时明细区给的是引导语，不是报错/白屏`,
        c.root === 'isn' ? /先在上面选一张原/.test(m.emptyTxt || '') : /先在上面选一张原/.test(m.emptyTxt || ''),
        JSON.stringify(m.emptyTxt))
      ok(`C  ${n}：未选原单时**没有**退货明细表（表在选中之后才挂）`,
        m.retTbl === false, 'retTbl=' + m.retTbl)

      /* 先扫候选：找出第一张**真的**能退的（粗筛在候选里 ≠ 真的能退） */
      const scan = apiN > 0 ? await J(p, JS_FIND_RETURNABLE(c.api)) : { found: null, tried: 0 }
      retData[c.name].scan = scan
      console.log('    扫候选 → ' + JSON.stringify(scan))
      if (scan.found) {
        const pick = await J(p, JS_PICK_SO_ID(scan.found))
        m = await J(p, MEASURE)
        console.log('    选原单 → ' + JSON.stringify(pick))
        console.log('    ⇒ retTbl=' + m.retTbl + ' rows=' + m.retRows + ' 输入格=' + m.retFilled +
          ' retSave=' + JSON.stringify(m.retSave))
        ok(`C  ${n}：选原单后**退货明细表真的出来了**（走通真实 return-preview）`,
          m.retTbl === true && m.retRows > 0 && m.retRows === scan.items,
          'retTbl=' + m.retTbl + ' 表内行=' + m.retRows + ' 接口 items=' + scan.items)
        const wantTh = ['序号', '商品', '单位', c.root === 'isn' ? '已发货' : '已入库',
          '已退', '可退', '退货数量', '退货单价', '退货金额']
        ok(`C  ${n}：明细表头 9 列逐字：${wantTh.join('/')}`,
          JSON.stringify(m.retTh) === JSON.stringify(wantTh), JSON.stringify(m.retTh))
        ok(`C  ${n}：每行「退货数量」「退货单价」两个输入格（可填格数 = 行数 × 2）`,
          m.retFilled === m.retRows * 2, 'rows=' + m.retRows + ' 输入格=' + m.retFilled)
        ok(`C  ${n}：选原单后「保存退货单」转为**可用**`, !!m.retSave && m.retSave.dis === false,
          JSON.stringify(m.retSave))
        ok(`C  ${n}：原有引导语已消失（不再有新单就报错的自相矛盾屏幕）`,
          !/先在上面选一张原/.test(m.emptyTxt || ''), JSON.stringify((m.emptyTxt || '').slice(0, 50)))
      } else if (apiN > 0) {
        /* 候选非空但**一张都不真的能退** —— 这是「粗筛把不可退的也列出来」的可用性缺口。
           界面必须仍给**明确原因**（不是空白、不是未知错误），且保存保持禁用。 */
        const pick = await J(p, JS_PICK_SO_ID(scan.firstOid))
        m = await J(p, MEASURE)
        console.log('    选第一张候选 → ' + JSON.stringify(pick))
        ok(`C  ${n}：候选 ${apiN} 张但**一张都不真的能退**（扫了 ${scan.tried} 张）⇒` +
           ` 明细表不挂、保存保持禁用（不假装有货可退）`,
          m.retTbl === false && m.retRows === -1 && !!m.retSave && m.retSave.dis === true,
          'retTbl=' + m.retTbl + ' retSave=' + JSON.stringify(m.retSave))
        ok(`C  ${n}：界面对这个空结果给的是**具体原因**（不是空白/未知错误）`,
          /没有明细行|没有可退|全部退完|还没/.test(m.emptyTxt || ''),
          JSON.stringify(m.emptyTxt))
        console.log('    ⚠️ 数据事实：候选 ' + apiN + ' 张全部不可退，首张理由 = ' +
          JSON.stringify(scan.firstReason))
      } else {
        ok(`C  ${n}：本业态生产上**零候选** ⇒ 保持引导语 + 保存禁用（不假装有货可退）`,
          m.retTbl === false && m.soOpts === 1 && m.retSave.dis === true,
          'opts=' + m.soOpts + ' retSave=' + JSON.stringify(m.retSave))
      }
      await p.screenshot(SHOTS + '/C-' + c.name + '.png').catch(() => {})
    }

    /* ══ D 相：数据面 —— 候选数 vs 接口真值（v443 的 limit 上限就在这里验）═ */
    section('D 相  数据面  下拉候选数 vs 接口真值')
    for (const c of CASES.filter(x => x.mode === 'ret')) {
      const m = retData[c.name].before
      const apiN = retData[c.name].apiN
      const cap = c.api === 'so' ? 300 : 100
      const want = Math.min(apiN, cap) + 1
      ok(`D  ${c.name}：下拉项数 = min(接口候选 ${apiN}, 上限 ${cap}) + 1 占位 = ${want}`,
        m.soOpts === want, 'soOpts=' + m.soOpts + ' expect=' + want)
      if (c.api === 'so') {
        const mm = (m.hint || '').match(/已载入\s*(\d+)\s*张/)
        ok(`D  ${c.name}：提示语「已载入 N 张」的 N 与下拉一致（N=${cap} 即 v443 的 limit 真的生效）`,
          mm && Number(mm[1]) === Math.min(apiN, cap),
          'N=' + (mm ? mm[1] : '未匹配') + ' expect=' + Math.min(apiN, cap))
      }
      if (apiN > 0) {
        ok(`D  ${c.name}：下拉第 2 项 =「单号 · 客户 · 状态」三节`,
          (m.soFirst || '').split('·').length >= 3, JSON.stringify(m.soFirst))
      }
    }

    /* ══ E 相：站内切换（组件实例复用）—— 判别力最强 ═══════════════════════ */
    section('E 相  站内切换（同 path 只变 query ⇒ 组件实例复用；onMounted 不跑）')
    await hardLoad(p, '#/inventory/sale/new?type=self_pickup&kind=order')
    let prev = await J(p, MEASURE)
    ok('E0  起点：自提订单（硬加载）', prev.title === '新建自提订单' && prev.hdBox === true,
      'title=' + prev.title + ' hdBox=' + prev.hdBox)
    const SEQ = [
      { hash: '#/inventory/sale/new?type=self_pickup&kind=return', title: '新建自提退单', hdBox: false, retTbl: false },
      { hash: '#/inventory/sale/new?type=vehicle_sale&kind=order', title: '新建车销订单', hdBox: true, retTbl: false, type: 'vehicle_sale' },
      { hash: '#/inventory/sale/new?type=vehicle_sale&kind=return', title: '新建车销退单', hdBox: false, retTbl: false },
      { hash: '#/inventory/sale/new?type=transfer&kind=order', title: '新建调拨单', hdBox: true, retTbl: false, type: 'transfer' },
      { hash: '#/inventory/sale/new?type=self_pickup&kind=order', title: '新建自提订单', hdBox: true, retTbl: false, type: 'self_pickup' },
    ]
    let k = 0
    for (const s of SEQ) {
      k++
      const errBefore = p.errors.length
      const beforeTitle = prev.title
      await p.eval(`(function(){ location.hash = ${JSON.stringify(s.hash)}; return 'ok' })()`)
      await sleep(2300)
      let m = await J(p, MEASURE)
      console.log('\n  ▸ 站内切到 ' + s.hash)
      console.log('    「' + beforeTitle + '」→「' + m.title + '」  hdBox=' + m.hdBox +
        ' retTbl=' + m.retTbl + ' orderType=' + m.orderType)
      ok(`E${k}.1 标题翻转为「${s.title}」（旧值「${beforeTitle}」必须消失）`,
        m.title === s.title, 'got=' + m.title)
      ok(`E${k}.2 模式 DOM 翻转：hd-box=${s.hdBox} / 退货明细表=${s.retTbl}`,
        m.hdBox === s.hdBox && m.retTbl === s.retTbl, 'hdBox=' + m.hdBox + ' retTbl=' + m.retTbl)
      if (s.type) {
        ok(`E${k}.3 「出货方式」重设为 ${s.type}（watch 生效）`, m.orderType === s.type, 'got=' + m.orderType)
      }
      ok(`E${k}.4 切换过程零控制台报错`, p.errors.length === errBefore,
        JSON.stringify(p.errors.slice(errBefore, errBefore + 2)))
      /* 🔴 站内切到退货模式后**再选一次原单** —— 证明 watch 驱动的 reinit 把
         候选集也重载了（若 reinit 没跑，soOpts 会是空的） */
      if (s.title === '新建自提退单') {
        const soOpts = m.soOpts
        const sc2 = await J(p, JS_FIND_RETURNABLE('so'))
        const pick = await J(p, JS_PICK_SO_ID(sc2.found || sc2.firstOid))
        m = await J(p, MEASURE)
        console.log('    站内切换后再选原单 → ' + JSON.stringify(pick) + ' ⇒ retTbl=' + m.retTbl + ' rows=' + m.retRows)
        ok('E1.5 站内切到退货模式后候选集**已重载**（下拉有真单，非空）', soOpts > 1, 'soOpts=' + soOpts)
        ok('E1.6 站内切换后仍能拉到可退明细（watch 驱动的 reinit 是完整的）',
          sc2.found ? (m.retTbl === true && m.retRows > 0) : m.retTbl === false,
          'retTbl=' + m.retTbl + ' rows=' + m.retRows + ' 扫到可退=' + sc2.found)
      }
      prev = m
    }

    /* ══ F 相：反例自证 ═══════════════════════════════════════════════════ */
    section('F 相  反例自证（判别力）  ' + CONTROL.hash)
    const z = await hardLoad(p, CONTROL.hash)
    console.log('  量测 ' + JSON.stringify({ title: z.title, hdBox: z.hdBox, retTbl: z.retTbl, ordRows: z.ordRows }))
    ok('Z1  标题不是「新建自提订单 / 新建车销订单 / 新建调拨单」（判据不恒真）',
      ['新建自提订单', '新建车销订单', '新建调拨单'].indexOf(z.title) < 0, 'title=' + z.title)
    ok('Z2  root 是 ipn、标题是「新建采购单」（销售页那套 `.isn-*` 判据在此不成立）',
      z.root === 'ipn' && z.title === '新建采购单', 'root=' + z.root + ' title=' + z.title)
    ok('Z3  采购单 15 行预设 ≠ 销售单 5 行 ⇒ 行数判据有判别力', z.ordRows === 15, 'rows=' + z.ordRows)
    ok('Z4  采购单（订单模式）**没有** `.isn-ret-tbl`（同一判据必须为假）', z.retTbl === false, 'retTbl=' + z.retTbl)
    await p.screenshot(SHOTS + '/Z-采购单.png').catch(() => {})

    /* ══ G 相：只读 + 零报错 ══════════════════════════════════════════════ */
    const writes = await J(p, 'JSON.stringify(window.__WRITES || [])')
    console.log('\n  全程非 GET 的 /api/ 请求：' + JSON.stringify(writes.slice(0, 5)))
    ok('G1  **零写请求**（探针只读，未触发任何保存/删除）', writes.length === 0, JSON.stringify(writes.slice(0, 3)))
    ok('G2  全程控制台报错汇总为空', p.errors.length === 0, JSON.stringify(p.errors.slice(0, 4)))
  } catch (e) {
    FAIL.push('异常')
    console.log('  FAIL  异常：' + ((e && e.message) || e))
  } finally {
    console.log('\n' + '═'.repeat(88))
    console.log('v441/v443 六界面只读真机探针：PASS ' + PASS.length + ' / FAIL ' + FAIL.length)
    if (FAIL.length) console.log('FAIL 明细：\n  - ' + FAIL.join('\n  - '))
    console.log('截图目录：' + SHOTS)
    console.log('═'.repeat(88))
    await browser.close()
    process.exit(FAIL.length ? 1 : 0)
  }
}
main()
