/**
 * v445 明细表输入框「**默认无框 → 悬浮浮框 → 聚焦高亮**」真机探针（生产 https://hergent.cn）
 *
 * 验的是可证伪事实，不是「读代码觉得对」：
 *
 *   A 默认态：明细表输入框（采购页 `.ipn-v` 文本态 / 销售页 `.isn-in`）**既无框也无底**
 *     —— border-color 必须是 transparent 的计算值 `rgba(0, 0, 0, 0)`，`.ipn-v` 的
 *     box-shadow 必须是 `none`，背景必须透明（与所在行一致、不留空白断层）
 *   B 悬浮：真实鼠标移到该格 ⇒ 浮出 `--bd` 淡灰描边；且**整行一起浮起**（行级）
 *   C 聚焦：描边变 `--p-dark` 品牌青 **+ 3px 外发光**；且与悬浮态是**颜色 + 发光双重区分**
 *     （只靠深浅区分在深色/浅色两套主题下总有一边看不出来）
 *   D 零抖动：悬浮前后元素 w/h/top/left **与**所在 tr 的高度**逐像素完全相同**
 *     （这是「不得引起尺寸抖动或行位移」唯一的机械判据）
 *   E 禁用 / 只读：`disabled` / `readonly` 的输入框**悬浮也不浮框**（假承诺比没有更糟）
 *   F 校验错误：注入 `.err` 后**红框默认就可见**，且聚焦外发光也是红色（不能被青光盖住）
 *   G 零控制台报错 + 零写请求
 *
 * ── 探针自己会判错的坑（本文件已规避）────────────────────────────────────
 *   ① 只差 hash 的 `Page.navigate` 是**同文档导航** ⇒ 必须加 `'/?__r=' + Date.now() + hash`。
 *   ② **hover 必须用 CDP `Input.dispatchMouseEvent` 真实移动鼠标**：CSS `:hover` 不是
 *      能靠加 class 伪造的状态，用 JS 加 class 等于自己骗自己。
 *   ③ 过渡有 `.2s` ⇒ 移动/聚焦后必须**等 400ms 再量**，否则量到过渡中间值（既不是
 *      transparent 也不是目标色，看着像"没实现"）。
 *   ④ transparent 的 computed 值是 `rgba(0, 0, 0, 0)`，不是字符串 `transparent`。
 *   ⑤ CSS 变量取出来是 hex（`#e5e5ea`），而 border-color 是 `rgb(...)` ⇒ 必须**换算后**
 *      再比，否则永远不等，会误判成"边框没生效"。
 *   ⑥ 🔴 采购页「点哪格哪格才是输入框」（v417j）：默认态 tbody **一个 input 都没有**，
 *      且激活成 input 时行高从 18px 变 22px —— 那是**既有设计**，不是本轮引入的抖动。
 *      所以「零抖动」的硬判据放在**销售页**（常驻 input，三态切换盒模型一字不变）；
 *      采购页只验「悬浮前后**同一个 `.ipn-v`** 尺寸不变」。
 *   ⑦ 模板串内**禁止出现反引号**，正则的 `\\s` 要双写 —— 踩过，报 `SyntaxError`。
 *
 * 运行：
 *   V445_TOKEN=<boss 会话 token> \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v445-psi-border-e2e.mjs
 */
import { launch } from './lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TOKEN = process.env.V445_TOKEN || ''
const TENANT = process.env.V445_TENANT || '1'
/* 🔴 必须与 TOKEN 是同一个账号：前端拿 localStorage 的 role 判路由权限，API 用 token，
   两者不一致会被踢到 #/login，表现为「量测 {}」—— 极具迷惑性。 */
const USER_JSON = process.env.V445_USER_JSON ||
  JSON.stringify({ id: 2, username: 'boss', role: 'boss', roles: ['boss'], name: 'boss' })
const SHOTS = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v445-psi-border'
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

/* ── 量测：一个元素在**当前**状态下的全部可证伪事实 ───────────────────────── */
const JS_M = (sel) => `(function(){
  try {
    var el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return JSON.stringify({ err: 'NOT_FOUND', sel: ${JSON.stringify(sel)} });
    var cs = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    var tr = el.closest('tr');
    var root = getComputedStyle(document.documentElement);
    function toRgb(v){
      v = String(v).trim();
      if (v.charAt(0) === '#') {
        var h = v.slice(1);
        if (h.length === 3) h = h.charAt(0)+h.charAt(0)+h.charAt(1)+h.charAt(1)+h.charAt(2)+h.charAt(2);
        return 'rgb(' + parseInt(h.slice(0,2),16) + ', ' + parseInt(h.slice(2,4),16) + ', ' + parseInt(h.slice(4,6),16) + ')';
      }
      return v;
    }
    return JSON.stringify({
      err: '', tag: el.tagName, cls: String(el.className),
      borderColor: cs.borderTopColor, borderWidth: cs.borderTopWidth,
      boxShadow: cs.boxShadow, bg: cs.backgroundColor,
      w: +r.width.toFixed(2), h: +r.height.toFixed(2),
      top: +r.top.toFixed(2), left: +r.left.toFixed(2),
      trh: tr ? +tr.getBoundingClientRect().height.toFixed(2) : -1,
      disabled: !!el.disabled, readonly: !!el.readOnly,
      vBd: toRgb(root.getPropertyValue('--bd')),
      vPDark: toRgb(root.getPropertyValue('--p-dark')),
      vDan: toRgb(root.getPropertyValue('--dan'))
    });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

/* 行内第二格（用于证明 hover 是**行级**而非格级） */
const JS_ROW_N = (n) => `(function(){
  try {
    var tbl = document.querySelector('table.ipn-tbl:not(.ipn-ret-tbl)')
           || document.querySelector('table.isn-tbl:not(.isn-ret-tbl)');
    if (!tbl) return JSON.stringify({ err: 'no-table' });
    var row = tbl.querySelectorAll('tbody>tr')[0];
    if (!row) return JSON.stringify({ err: 'no-row' });
    var cells = row.querySelectorAll('.ipn-v, input.isn-in, select.isn-in');
    var out = [];
    for (var i = 0; i < Math.min(${n}, cells.length); i++) {
      var cs = getComputedStyle(cells[i]);
      out.push({ shadow: cs.boxShadow, bc: cs.borderTopColor });
    }
    return JSON.stringify({ err: '', n: out.length, cells: out });
  } catch (e) { return JSON.stringify({ err: String((e && e.message) || e) }) }
})()`

const JS_RECT = (sel) => `(function(){
  var el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return JSON.stringify({ err: 'NOT_FOUND' });
  var r = el.getBoundingClientRect();
  return JSON.stringify({ err: '', cx: Math.round(r.left + r.width/2), cy: Math.round(r.top + r.height/2) });
})()`

/* 采购页：点「采购价」格激活成 input（v417j：默认态 tbody 里没有 input） */
const JS_ACTIVATE = `(async function(){
  var td = document.querySelector('table.ipn-tbl:not(.ipn-ret-tbl) tbody td.ipn-c-price');
  if (!td) return JSON.stringify({ err: 'no-price-cell' });
  td.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise(function(r){ setTimeout(r, 600) });
  var inp = td.querySelector('input.ipn-in');
  return JSON.stringify({ err: inp ? '' : 'no-input', ok: !!inp });
})()`

/* 注入：把某个 input 改成 disabled / readonly / .err（构造态，用于验例外分支） */
const JS_SET = (sel, what, on) => `(function(){
  var el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return JSON.stringify({ err: 'NOT_FOUND' });
  if (${JSON.stringify(what)} === 'disabled') el.disabled = ${on ? 'true' : 'false'};
  else if (${JSON.stringify(what)} === 'readonly') el.readOnly = ${on ? 'true' : 'false'};
  else if (${JSON.stringify(what)} === 'err') { el.classList.toggle('err', ${on ? 'true' : 'false'}); }
  else if (${JSON.stringify(what)} === 'focus') { el.focus(); }
  else if (${JSON.stringify(what)} === 'blur') { el.blur(); }
  return JSON.stringify({ err: '', done: ${JSON.stringify(what)} });
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

/* 真实鼠标移动 —— CSS :hover 只能靠真鼠标触发 */
async function moveTo (p, x, y) {
  await p.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
  await sleep(450)          /* 等 .2s 过渡走完，否则量到中间值 */
}
async function hoverSel (p, sel) {
  const r = await J(p, JS_RECT(sel))
  if (r.err) return r
  await moveTo(p, r.cx, r.cy)
  return { err: '' }
}
async function unhover (p) { await moveTo(p, 3, 3) }

const TRANSP = 'rgba(0, 0, 0, 0)'
const isTransp = (c) => String(c).replace(/\s/g, '') === 'rgba(0,0,0,0)'
const has = (s, sub) => String(s).indexOf(sub) >= 0

const main = async () => {
  const browser = await launch({ headless: true })
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(INIT)
  await p.raw.send('Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })

  const errsSeen = []

  /* ══ 采购建单页（`.ipn-v` 文本态即默认态）════════════════════════════════ */
  section('A/B/C/D 采购建单页 · 商品明细（`.ipn-v` 文本态三态）')
  const V = 'table.ipn-tbl:not(.ipn-ret-tbl) tbody tr:first-child .ipn-v'
  let m = await hardLoad(p, '#/inventory/purchase/new?kind=order')
  console.log('  [采购] title=' + JSON.stringify(m.title) + ' 明细行数=' + m.rows)
  await p.screenshot(SHOTS + '/A-采购-默认态.png').catch(() => {})

  await unhover(p)
  const a0 = await J(p, JS_M(V))
  if (a0.err) { ok('A  采购页取到 `.ipn-v`', false, a0.err) }
  else {
    console.log('  默认态: shadow=' + JSON.stringify(a0.boxShadow) + ' bg=' + a0.bg + ' bd=' + a0.borderColor)
    ok('A  采购页默认态 `.ipn-v` **无描边**（box-shadow: none）', a0.boxShadow === 'none', String(a0.boxShadow))
    ok('A  采购页默认态 `.ipn-v` **背景透明**（与所在行一致、无空白断层）', isTransp(a0.bg), a0.bg)
  }

  /* B 悬浮 —— 真实鼠标移到该格 */
  const hb = await hoverSel(p, V)
  if (!hb.err) {
    const b1 = await J(p, JS_M(V))
    const rn = await J(p, JS_ROW_N(3))
    console.log('  悬浮态: shadow=' + JSON.stringify(b1.boxShadow) + ' 期望含 --bd ' + b1.vBd)
    await p.screenshot(SHOTS + '/B-采购-悬浮.png').catch(() => {})
    ok('B  采购页悬浮 ⇒ **浮出描边**（box-shadow 由 none 变 inset）',
      b1.boxShadow !== 'none' && has(b1.boxShadow, 'inset'), String(b1.boxShadow))
    ok('B  采购页悬浮描边用的是 `--bd` 淡灰（不是主色 —— 主色留给聚焦）',
      has(b1.boxShadow, b1.vBd), b1.boxShadow + ' ⊃ ' + b1.vBd)
    const lit = (rn.cells || []).filter(c => c.shadow !== 'none').length
    ok('B  采购页悬浮是**整行一起浮起**（行级，不是只有鼠标那一格）',
      lit >= 2, '行内浮起格数 ' + lit + ' / 取样 ' + (rn.cells || []).length)
    /* D 零抖动：悬浮前后**同一个 .ipn-v** 逐像素不变 */
    ok('D  采购页悬浮前后 `.ipn-v` **尺寸逐像素不变**（w/h/top/left 全等）',
      a0.w === b1.w && a0.h === b1.h && a0.top === b1.top && a0.left === b1.left,
      JSON.stringify({ 默认: [a0.w, a0.h, a0.top, a0.left], 悬浮: [b1.w, b1.h, b1.top, b1.left] }))
    ok('D  采购页悬浮前后**所在行高度不变**（无行位移）', a0.trh === b1.trh,
      a0.trh + ' → ' + b1.trh)
  } else { skip('B  采购页悬浮', hb.err) }

  /* C 聚焦：点激活成 input */
  const act = await J(p, JS_ACTIVATE)
  if (!act.err) {
    const c1 = await J(p, JS_M('table.ipn-tbl:not(.ipn-ret-tbl) tbody td.ipn-c-price input.ipn-in'))
    console.log('  聚焦态: border=' + c1.borderColor + ' 期望 --p-dark ' + c1.vPDark +
      ' | shadow=' + JSON.stringify(c1.boxShadow))
    await p.screenshot(SHOTS + '/C-采购-聚焦.png').catch(() => {})
    ok('C  采购页聚焦 ⇒ 描边变 **`--p-dark` 品牌青**', c1.borderColor === c1.vPDark,
      c1.borderColor + ' vs ' + c1.vPDark)
    ok('C  采购页聚焦 ⇒ **叠了 3px 外发光**（悬浮态没有 ⇒ 双重区分，不是深浅之分）',
      has(c1.boxShadow, '3px'), String(c1.boxShadow))
    ok('C  采购页聚焦色 ≠ 悬浮色（两态**颜色**上就不同）', c1.vPDark !== c1.vBd,
      c1.vPDark + ' vs ' + c1.vBd)
  } else { skip('C  采购页聚焦', act.err) }
  errsSeen.push(...((await J(p, `(function(){return JSON.stringify(window.__ERRS||[]);})()`)) || []))

  /* ══ 销售建单页（常驻 input —— 零抖动的硬判据在这里）══════════════════════ */
  section('A/B/C/D 销售建单页 · 商品明细（常驻 `input.isn-in` 三态）')
  const I = 'table.isn-tbl:not(.isn-ret-tbl) tbody tr:first-child input.isn-in.num'
  m = await hardLoad(p, '#/inventory/sale/new?type=self_pickup&kind=order')
  console.log('  [销售] title=' + JSON.stringify(m.title) + ' 明细行数=' + m.rows)

  await unhover(p)
  const s0 = await J(p, JS_M(I))
  if (s0.err) { ok('A  销售页取到 `input.isn-in`', false, s0.err) }
  else {
    console.log('  默认态: border=' + s0.borderColor + ' bg=' + s0.bg + ' 边框宽=' + s0.borderWidth)
    ok('A  销售页默认态输入框**边框透明**（默认完全不显示边框）', isTransp(s0.borderColor), s0.borderColor)
    ok('A  销售页默认态**边框宽度仍是 1px**（预留占位 ⇒ 切换时不改盒模型、零抖动）',
      s0.borderWidth === '1px', String(s0.borderWidth))
    ok('A  销售页默认态输入框**背景透明**（与所在行一致）', isTransp(s0.bg), s0.bg)
  }

  let s1 = null
  const hs = await hoverSel(p, I)
  if (!hs.err) {
    s1 = await J(p, JS_M(I))
    console.log('  悬浮态: border=' + s1.borderColor + ' 期望 --bd ' + s1.vBd)
    await p.screenshot(SHOTS + '/B-销售-悬浮.png').catch(() => {})
    ok('B  销售页悬浮 ⇒ 边框变 **`--bd` 淡灰**', s1.borderColor === s1.vBd,
      s1.borderColor + ' vs ' + s1.vBd)
    ok('B  销售页悬浮**没有**外发光（发光是聚焦专属）', !has(s1.boxShadow, '3px'), String(s1.boxShadow))
  } else { skip('B  销售页悬浮', hs.err) }

  await J(p, JS_SET(I, 'focus', true))
  await sleep(450)
  const s2 = await J(p, JS_M(I))
  console.log('  聚焦态: border=' + s2.borderColor + ' 期望 --p-dark ' + s2.vPDark +
    ' | shadow=' + JSON.stringify(s2.boxShadow))
  await p.screenshot(SHOTS + '/C-销售-聚焦.png').catch(() => {})
  ok('C  销售页聚焦 ⇒ 边框变 **`--p-dark` 品牌青**', s2.borderColor === s2.vPDark,
    s2.borderColor + ' vs ' + s2.vPDark)
  ok('C  销售页聚焦 ⇒ **叠了 3px 外发光**（与悬浮明显区分）', has(s2.boxShadow, '3px'), String(s2.boxShadow))
  ok('C  销售页聚焦色 ≠ 悬浮色', s2.vPDark !== s2.vBd, s2.vPDark + ' vs ' + s2.vBd)

  /* D 零抖动（硬判据）：三态下 w/h/top/left 与行高必须逐像素全等 */
  if (!s1) { skip('D  销售页三态零抖动', '悬浮态未取到量测值') }
  else {
  ok('D  销售页 **默认 → 悬浮 → 聚焦** 三态元素尺寸逐像素不变',
    s0.w === s1.w && s1.w === s2.w && s0.h === s1.h && s1.h === s2.h &&
    s0.top === s1.top && s1.top === s2.top && s0.left === s1.left && s1.left === s2.left,
    JSON.stringify({ 默认: [s0.w, s0.h], 悬浮: [s1.w, s1.h], 聚焦: [s2.w, s2.h] }))
  ok('D  销售页三态**所在行高度不变**（零行位移）',
    s0.trh === s1.trh && s1.trh === s2.trh, [s0.trh, s1.trh, s2.trh].join(' / '))
  }

  /* ══ E 禁用 / 只读：悬浮也不浮框 ══════════════════════════════════════════ */
  section('E 禁用 / 只读的输入框**不出现悬浮边框**')
  for (const what of ['disabled', 'readonly']) {
    await J(p, JS_SET(I, 'focus', false))
    await J(p, JS_SET(I, what, true))
    await unhover(p)
    const d0 = await J(p, JS_M(I))
    await hoverSel(p, I)
    const d1 = await J(p, JS_M(I))
    console.log('  [' + what + '] 默认=' + d0.borderColor + ' 悬浮=' + d1.borderColor)
    ok('E  ' + what + ' 输入框**默认无框**', isTransp(d0.borderColor), d0.borderColor)
    ok('E  ' + what + ' 输入框**悬浮也不浮框**（不给"这格能填"的假承诺）',
      isTransp(d1.borderColor), d1.borderColor)
    ok('E  ' + what + ' 输入框悬浮**无外发光**', !has(d1.boxShadow, '3px'), String(d1.boxShadow))
    await J(p, JS_SET(I, what, false))
  }

  /* ══ F 校验错误：红框必须默认可见、且聚焦发光也是红 ═══════════════════════ */
  section('F 校验错误提示不被「默认无框」吃掉')
  await unhover(p)
  await J(p, JS_SET(I, 'err', true))
  await sleep(300)
  const e0 = await J(p, JS_M(I))
  console.log('  [err] 默认 border=' + e0.borderColor + ' 期望 --dan ' + e0.vDan)
  ok('F  `.err` 输入框**默认就显示红框**（错误提示是提示，不是装饰）',
    e0.borderColor === e0.vDan, e0.borderColor + ' vs ' + e0.vDan)
  await J(p, JS_SET(I, 'focus', true))
  await sleep(400)
  const e1 = await J(p, JS_M(I))
  console.log('  [err] 聚焦 border=' + e1.borderColor + ' shadow=' + JSON.stringify(e1.boxShadow))
  ok('F  `.err` 聚焦仍是**红框**（没被聚焦态改成主色）', e1.borderColor === e1.vDan, e1.borderColor)
  ok('F  `.err` 聚焦的外发光也是**红色**（不是青光 ⇒ 不会出现"红框配青光"的错配）',
    has(e1.boxShadow, 'rgba(255, 59, 48') || has(e1.boxShadow, 'rgba(255, 69, 58'),
    String(e1.boxShadow))
  await J(p, JS_SET(I, 'err', false))
  await J(p, JS_SET(I, 'blur', true))

  /* ══ G 零报错 + 零写请求 ══════════════════════════════════════════════════ */
  section('G 零控制台报错 + 零写请求')
  const tail = await p.eval(`(function(){
    return JSON.stringify({ writes: window.__WRITES || [], errs: window.__ERRS || [] });
  })()`).then(JSON.parse)
  console.log('  写请求：' + JSON.stringify(tail.writes))
  console.log('  控制台：' + JSON.stringify((errsSeen.concat(tail.errs)).slice(0, 8)))
  ok('G  全程**零写请求**（探针只读，改的都是内存里的 DOM 属性）', (tail.writes || []).length === 0,
    JSON.stringify(tail.writes))
  ok('G  全程**零控制台报错**', (errsSeen.concat(tail.errs) || []).length === 0,
    JSON.stringify((errsSeen.concat(tail.errs)).slice(0, 5)))

  console.log('\n' + '='.repeat(92))
  console.log(`  PASS ${PASS.length}   FAIL ${FAIL.length}   SKIP ${SKIP.length}`)
  if (FAIL.length) { console.log('  FAILED:'); FAIL.forEach(f => console.log('   - ' + f)) }
  console.log('  VERDICT: ' + (FAIL.length ? 'HAS_FAIL' : 'ALL_PASS'))
  console.log('='.repeat(92))
  try { await browser.close() } catch { /* ignore */ }
  process.exit(FAIL.length ? 1 : 0)
}

main().catch(e => { console.error('探针异常：', e); process.exit(2) })
