/* v379 探针：预报汇总表编辑网格 —— 4 项「Excel 对标」P0 修补的 A/B 取证
 *
 *   T1 粘贴跳过空单元格（C-2）
 *   T2 Ctrl+Home / Ctrl+End / Ctrl+方向键 可达 ＋ 裸键不回归（B-1/B-2）
 *   T3 Shift+方向键 / Shift+Home·End 扩选 ＋ 扩选后 Ctrl+D 联动（B-3/B-4）
 *   T4 打印走仓内 printable.js（E-13/G-10）
 *
 * 用法（🔴 必须与静态代理压进**同一个** Bash 调用 —— Bash 工具起的后台进程会随该次调用被回收）：
 *   PROBE_LABEL=BEFORE PROBE_BASE=http://127.0.0.1:8876 PROBE_TOKEN_FILE=/tmp/v379-token.txt \
 *     node v379-excel-gap-probe.mjs
 *   PROBE_LABEL=AFTER  PROBE_BASE=http://127.0.0.1:8877 PROBE_TOKEN_FILE=/tmp/v379-token.txt \
 *     node v379-excel-gap-probe.mjs
 * ---------------------------------------------------------------------------
 * 🔴 本轮纪律（前几轮反复踩到，逐条自查）：
 *   ① 每条判据必须先在不改代码那一侧（BEFORE）跑并确认为**红** —— 恒真判据比没有判据更危险。
 *   ② 标签语义：`IS_AFTER = LABEL !== 'BEFORE'`。第三态标签（LIVE / 生产直打）**不许**静默落回
 *      BEFORE 侧期望 —— v378 因 `LABEL === 'AFTER'` 吃过 19 条假红，别再犯。
 *   ③ 键盘判据一律**真派发 KeyboardEvent**（带 ctrlKey / shiftKey / altKey），不直接调内部函数
 *      —— 只调内部函数会绕过「分支顺序」这类真病（本轮 T2 的病根正是顺序）。
 *   ④ 粘贴判据真派发 ClipboardEvent，并**先自证** clipboardData 能被页面读到（否则 T1 整组恒真）。
 *   ⑤ 零写入取证：猴补 fetch / XHR 记录非 GET 的 /api/ 请求。本探针会**改格子内容**，
 *      但只落内存 + localStorage 草稿（`saveDraftNow` 仅写 localStorage），**绝不点保存**；
 *      用取证件证明，不靠「我没点」这句话（v210 纪律）。
 *   ⑥ 打印判据先把 `window.print` / `window.open` 换成记账桩 —— headless 里真开打印预览会挂住。
 *   ⑦ 只读生产数据：令牌 = `mode=ro` 取到的**已有**活跃会话，仅用于 localStorage 注入。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:5289'
const LABEL = process.env.PROBE_LABEL || 'AFTER'
const IS_AFTER = LABEL !== 'BEFORE'
const TOK = fs.readFileSync(process.env.PROBE_TOKEN_FILE || '/tmp/v379-token.txt', 'utf8').trim()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const waitFor = async (p, expr, ms, what) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    let ok = false
    try { ok = !!(await p.eval('!!(' + expr + ')')) } catch (e) { ok = false }
    if (ok) return Date.now() - t0
    await sleep(400)
  }
  console.log('  ⚠️ waitFor 超时(' + ms + 'ms): ' + what)
  return -1
}

/* ===================== 注入页面的探针工具 =====================
   ⚠️ 本串是**模板字面量**：正则里的反斜杠必须双写；注释里**禁止出现反引号**。 */
const HELPERS = `
window.__tbl = function () {
  var ts = [].slice.call(document.querySelectorAll('table.edit-tbl'))
  for (var i = 0; i < ts.length; i++) if (ts[i].querySelectorAll('thead th').length > 0) return ts[i]
  return null
}
window.__rows = function () { var t = window.__tbl(); return t ? [].slice.call(t.querySelectorAll('tbody tr')) : [] }
window.__td = function (ri, ci) { return window.__tbl().querySelector('tbody td[data-r="' + ri + '"][data-c="' + ci + '"]') }
/* 可见行数：网格用 v-show 藏行 ⇒ DOM 行数 = **全部**数据行，不等于用户眼前看到的行数。
   打印走 filteredRowsForExport()（受 搜索/列筛选/仅显示有报单 影响）⇒ 判据必须比**可见**行，
   比 DOM 行会在「开了筛选」时假红。 */
window.__rowsVisible = function () {
  return window.__rows().filter(function (tr) {
    var w = tr.ownerDocument.defaultView
    return (w.getComputedStyle(tr).display || '') !== 'none'
  }).length
}
window.__ths = function () {
  var t = window.__tbl(); if (!t) return []
  return [].slice.call(t.querySelectorAll('thead th')).filter(function (x) {
    return !x.classList.contains('seq-th') && !x.classList.contains('op-th') && !x.classList.contains('calc-th')
  })
}
/* 数量列 = 单元格轴的可靠入口（isInputColIdx 走列元数据，数量列一定满足 data-c >= visibleCols.length） */
window.__cellCols = function () {
  var tr = window.__rows()[2]
  if (!tr) return []
  return [].slice.call(tr.querySelectorAll('td.qty-cell[data-c]')).map(function (td) { return +td.getAttribute('data-c') })
}
/* ---- 事件派发（几何用 getBoundingClientRect 真值） ---- */
window.__ev = function (el, type, opt) {
  var r = el.getBoundingClientRect()
  var o = { bubbles: true, cancelable: true, clientX: Math.round(r.left + (r.width || 20) / 2), clientY: Math.round(r.top + (r.height || 16) / 2) }
  if (opt) for (var k in opt) o[k] = opt[k]
  el.dispatchEvent(new MouseEvent(type, o)); return 1
}
window.__md = function (el) { return window.__ev(el, 'mousedown', { button: 0, buttons: 1 }) }
window.__mup = function () { window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 })); return 1 }
window.__click = function (el) { window.__md(el); window.__mup(); return 1 }
/* 键盘：**一律派在 table 上**（onGridKey 绑在 table）。
   真机上焦点在输入框里时 e.target.tagName=INPUT、editing=true，但 onGridKey 的输入态早退判据是
   cellTyping && editing —— 本探针每次点击后 cellTyping 均为 false（selectCell 走 doSelect=true），
   故派在 table 上与被输入框捕获**走同一条分支**，且不受「合成事件不触发默认 focus」影响。 */
window.__key = function (k, mods) {
  var o = { bubbles: true, cancelable: true, key: k }
  if (mods) { o.ctrlKey = !!mods.ctrl; o.metaKey = !!mods.meta; o.shiftKey = !!mods.shift; o.altKey = !!mods.alt }
  window.__tbl().dispatchEvent(new KeyboardEvent('keydown', o)); return 1
}
window.__reset = function () { window.__key('Escape'); window.__key('Escape'); window.__key('Escape'); window.__mup(); return 1 }
/* ---- 真正把焦点放进某格输入框（模拟用户点完就位；也用于让「焦点被谁拿走」可观测） ---- */
window.__focusCell = function (r, c) {
  var t = window.__tbl(), el = t && t.querySelector('input[data-r="' + r + '"][data-c="' + c + '"]')
  if (!el) return 0
  el.focus(); return 1
}
/* ---- 选中态（**只看 DOM**：td.selected / td.range-sel / tr.row-sel，不碰组件内部状态） ---- */
window.__sel = function () {
  var t = window.__tbl(); if (!t) return null
  var num = function (el, a) { var v = el ? el.getAttribute(a) : null; return (v === null || v === undefined) ? -1 : +v }
  var act = t.querySelector('tbody td.selected')
  var rs = [].slice.call(t.querySelectorAll('tbody td.range-sel'))
  var o = { activeR: num(act, 'data-r'), activeC: num(act, 'data-c'), selCells: t.querySelectorAll('tbody td.selected').length,
    rowStrong: t.querySelectorAll('tbody tr.row-sel').length, rangeCells: rs.length, r0: -1, c0: -1, r1: -1, c1: -1, h: 0, w: 0,
    focusR: num(document.activeElement, 'data-r'), focusC: num(document.activeElement, 'data-c') }
  for (var i = 0; i < rs.length; i++) {
    var r = num(rs[i], 'data-r'), c = num(rs[i], 'data-c')
    if (o.r0 < 0 || r < o.r0) o.r0 = r
    if (r > o.r1) o.r1 = r
    if (o.c0 < 0 || c < o.c0) o.c0 = c
    if (c > o.c1) o.c1 = c
  }
  if (o.r0 >= 0) { o.h = o.r1 - o.r0 + 1; o.w = o.c1 - o.c0 + 1 }
  return o
}
window.__cellVal = function (r, c) {
  var t = window.__tbl(), el = t && t.querySelector('input[data-r="' + r + '"][data-c="' + c + '"]')
  return el ? String(el.value == null ? '' : el.value) : null
}
/* ---- 「已用区」镜像（= lastDataPos 的 DOM 版判据；用于 T2 的期望值，不写死数字） ---- */
window.__lastUsed = function () {
  var t = window.__tbl(), ins = [].slice.call(t.querySelectorAll('tbody input[data-r]'))
  var lr = -1, lc = -1
  for (var i = 0; i < ins.length; i++) {
    var v = String(ins[i].value == null ? '' : ins[i].value).trim()
    if (v === '' || v === '0') continue
    var r = +ins[i].getAttribute('data-r'), c = +ins[i].getAttribute('data-c')
    if (r > lr) lr = r
    if (c > lc) lc = c
  }
  return { r: lr, c: lc }
}
/* ---- Ctrl+方向键 的期望值：从 r0 沿该列向下走到连续数据的最后一格（遇空/0 停） ---- */
window.__runEnd = function (r0, c) {
  var t = window.__tbl(), r = r0
  for (;;) {
    var el = t.querySelector('input[data-r="' + (r + 1) + '"][data-c="' + c + '"]')
    if (!el) break
    var v = String(el.value == null ? '' : el.value).trim()
    if (v === '' || v === '0') break
    r++
  }
  return r
}
/* ---- 从**真实数据**里挑一条合格的连续段当基准（别写死行列：首跑写死 (10, 第一数量列)，
   而那一列在 10 行以下没有连续数据 ⇒ 前置判据自己先红 —— 这正是「探针先自证判别力」要防的）。
   约束 minRow：起始行太小会让 Ctrl+Home 的期望 (0,0) 与 BEFORE 落点重合 ⇒ 判据失去判别力。 */
window.__pickRun = function (minLen, minRow) {
  var cs = window.__cellCols(), rows = window.__rows().length, best = null
  for (var ci = 0; ci < cs.length; ci++) {
    var c = cs[ci], r = minRow || 0
    while (r < rows) {
      var e = window.__runEnd(r, c), len = e - r
      if (len >= minLen && (!best || len > best.len)) best = { r0: r, c: c, end: e, len: len }
      r = e + 1
    }
  }
  return best
}
/* ---- 诊断（只打印、不断言）：解释「data-r 与 tbody 行数对不上 / 有两个 edit-tbl」 ---- */
window.__diag = function () {
  var ts = [].slice.call(document.querySelectorAll('table.edit-tbl'))
  var out = []
  for (var i = 0; i < ts.length; i++) {
    var t = ts[i], ins = [].slice.call(t.querySelectorAll('tbody input[data-r]')), mx = -1
    for (var j = 0; j < ins.length; j++) { var r = +ins[j].getAttribute('data-r'); if (r > mx) mx = r }
    out.push({ i: i, tbodyTr: t.querySelectorAll('tbody tr').length, theadTh: t.querySelectorAll('thead th').length,
      inputs: ins.length, maxDataR: mx, visible: t.getBoundingClientRect().height > 0,
      cls: (t.className || '').slice(0, 40) })
  }
  return { firstPicked: (function () { var t = window.__tbl(); return t ? (t.className || '').slice(0, 40) : null })(), rowsFn: window.__rows().length, tables: out }
}
/* ---- 推进端是否落在视口里（T3 的「视口跟随」判据） ---- */
/* 推进端是否「在用户眼前」：窗口与滚动容器**两者取其一**成立即可 ——
   .table-wrap 未必是真正的滚动约束者（实测页面有 2 个，其中一个高度可撑出视口、由窗口滚动）。
   只看容器会在「窗口滚动」型布局下恒假；只看窗口会在「容器滚动」型布局下恒假。 */
window.__edgeVisible = function (r, c) {
  var t = window.__tbl(), td = t && t.querySelector('tbody td[data-r="' + r + '"][data-c="' + c + '"]')
  if (!td) return null
  var el = td.querySelector('input') || td
  var b = el.getBoundingClientRect()
  if (!(b.height > 0)) return false
  var vh = window.innerHeight || document.documentElement.clientHeight
  var vw = window.innerWidth || document.documentElement.clientWidth
  var inWin = b.top >= -1 && b.bottom <= vh + 1 && b.right > 0 && b.left < vw
  var wrap = td.closest('.table-wrap')
  var inWrap = false
  if (wrap) {
    var wr = wrap.getBoundingClientRect()
    inWrap = wr.height > 0 && b.top >= wr.top - 2 && b.bottom <= wr.bottom + 2
  }
  return inWin || inWrap
}
/* ---- 粘贴：真派发 ClipboardEvent，并**返回页面能否读到内容**（自证，防整组判据恒真） ---- */
window.__paste = function (el, text, mods) {
  var dt = new DataTransfer()
  dt.setData('text', text)
  var o = { bubbles: true, cancelable: true }
  if (mods) { o.ctrlKey = !!mods.ctrl; o.shiftKey = !!mods.shift; o.altKey = !!mods.alt }
  var ev
  try { ev = new ClipboardEvent('paste', Object.assign({ clipboardData: dt }, o)) } catch (e) { ev = new Event('paste', o) }
  if (!ev.clipboardData) { try { Object.defineProperty(ev, 'clipboardData', { value: dt }) } catch (e) {} }
  el.dispatchEvent(ev)
  return !!(ev.clipboardData && ev.clipboardData.getData('text') === text)
}
/* ---- 打印记账桩（headless 里真开打印预览会挂住 ⇒ 必须先换掉） ---- */
window.__printStub = function () {
  window.__pr = { open: 0, print: 0, html: '', url: null }
  if (!window.__origPrint) window.__origPrint = window.print
  if (!window.__origOpen) window.__origOpen = window.open
  window.print = function () { window.__pr.print++ }
  window.open = function (u, n) {
    window.__pr.open++; window.__pr.url = String(u)
    var doc = { _h: '', open: function () {}, close: function () {}, write: function (h) { doc._h += String(h); window.__pr.html += String(h) } }
    return { document: doc, focus: function () {}, print: function () { window.__pr.print++ } }
  }
  return 1
}
window.__printRestore = function () {
  if (window.__origPrint) window.print = window.__origPrint
  if (window.__origOpen) window.open = window.__origOpen
  return 1
}
window.__printStats = function () {
  var h = (window.__pr && window.__pr.html) || ''
  var tb = /<tbody>([\\s\\S]*)<\\/tbody>/.exec(h)
  var th = /<thead>([\\s\\S]*?)<\\/thead>/.exec(h)
  return {
    len: h.length,
    tr: tb ? (tb[1].match(/<tr>/g) || []).length : 0,
    th: th ? (th[1].match(/<th>/g) || []).length : 0,
    landscape: /@page[^{]*\\{[^}]*landscape/.test(h),
    headerGroup: h.indexOf('table-header-group') >= 0,
    title: /预报订单汇总表/.test(h),
    trRowsAreHtml: /<tr><td>/.test(h)
  }
}
/* ---- 按钮：按文案找（Icon 是内联 svg，textContent 只剩文字） ---- */
window.__btn = function (txt) {
  var bs = [].slice.call(document.querySelectorAll('button'))
  for (var i = 0; i < bs.length; i++) if ((bs[i].textContent || '').trim() === txt) return bs[i]
  return null
}
window.__clickText = function (txt) { var b = window.__btn(txt); if (!b) return 0; b.click(); return 1 }
window.__writes = function () {
  var w = window.__WRITES || []
  var RISK = /save|matrix|bulk|upsert|import|execute|close|delete|create|submit|update/i
  return { all: w.length, risky: w.filter(function (x) { return RISK.test(x) }) }
}
`

/* ===================== 断言记账 ===================== */
const R = []
const rec = (name, ok, want, got) => {
  R.push({ name, ok: !!ok, want, got })
  if (!ok) console.log('  ❌ ' + name + '  期望=' + JSON.stringify(want) + ' 实测=' + JSON.stringify(got))
  else console.log('  ✅ ' + name)
}
const guard = (name, got, want) => rec(name, got === want, want, got)
const disc = (name, got, wantAfter, wantBefore) => rec(name, got === (IS_AFTER ? wantAfter : wantBefore), IS_AFTER ? wantAfter : wantBefore, got)
const afterOnly = (name, got, want) => {
  if (!IS_AFTER) { R.push({ name, ok: true, skip: true, want, got }); console.log('  ⏭  ' + name + '（BEFORE 侧不可达，跳过）'); return }
  rec(name, got === want, want, got)
}

/* 🔴 派发文本一律用 `String.fromCharCode` 拼，**不做字符串转义** ——
   本轮踩过：`JSON.stringify(SEED.join('\\n'))` 会经历「probe 源码 → 注入源码 → 页面求值」三层，
   `\\n` 到页面手里变成**字面的反斜杠+n**（不是换行）⇒ parseTSV 只切出 1 行、整条基准段铺不进去，
   症状是「粘贴好像没执行」而实际写进了一格垃圾值。转义层级越多越容易错，直接绕开。 */
const NL = 'String.fromCharCode(10)'
const TAB = 'String.fromCharCode(9)'
const arr = (a) => '[' + a.map(x => JSON.stringify(x)).join(',') + ']'
const snaps = {}
const snap = async (p, tag) => {
  const s = JSON.parse(await p.eval('JSON.stringify(window.__sel())'))
  snaps[tag] = s
  console.log('  [' + tag + '] ' + JSON.stringify(s))
  return s
}
const probe = async (p, expr) => JSON.parse(await p.eval('JSON.stringify(' + expr + ')'))
const shot = async (p, tag) => { try { await p.screenshot('/tmp/v379-' + LABEL + '-' + tag + '.png') } catch (e) {} }

/* ---- 自检：HELPERS 是**模板字面量**，注释里一旦出现反引号就会把它提前截断。
   症状不是语法错（Node 仍能 --check 通过），而是跑到一半报 `xxx is not defined`，
   或更糟：注入到页面的工具少了一半、判据集体恒真。故在此显式点名清点。 ---- */
for (const need of ['window.__tbl', 'window.__rows', 'window.__rowsVisible', 'window.__td',
  'window.__ths', 'window.__cellCols', 'window.__key', 'window.__paste', 'window.__sel',
  'window.__cellVal', 'window.__lastUsed', 'window.__pickRun', 'window.__diag',
  'window.__edgeVisible', 'window.__pr', 'window.__printStub', 'window.__printStats', 'window.__writes']) {
  if (HELPERS.indexOf(need) < 0) {
    console.log('🔴 HELPERS 模板字面量被截断：缺少 ' + need + '（检查注释里是否混进了反引号）')
    process.exit(2)
  }
}

let browser = null
try {
  browser = await launch()
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(
    "localStorage.setItem('hergent_v2_token', " + JSON.stringify(TOK) + ");" +
    "localStorage.setItem('hergent_v2_tenant', '1');" +
    /* 零写入取证：只监控、不改任何测量逻辑 */
    "window.__WRITES=[];" +
    "(function(){function log(m,u){try{if(String(u).indexOf('/api/')>=0&&String(m).toUpperCase()!=='GET')window.__WRITES.push(String(m).toUpperCase()+' '+String(u))}catch(e){}}" +
    "var f=window.fetch;window.fetch=function(a,b){try{log((b&&b.method)||(a&&a.method)||'GET',(typeof a==='string')?a:(a&&a.url)||'')}catch(e){}return f.apply(this,arguments)};" +
    "var o=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){log(m,u);return o.apply(this,arguments)}})();" +
    /* 打印记账桩必须**页面脚本最早**装上：headless 里真开打印预览会让页面挂住 */
    "(function(){window.__pr={open:0,print:0,html:'',url:null};window.__origPrint=window.print;window.__origOpen=window.open;" +
    "window.print=function(){window.__pr.print++};" +
    "window.open=function(u,n){window.__pr.open++;window.__pr.url=String(u);" +
    "var doc={_h:'',open:function(){},close:function(){},write:function(h){doc._h+=String(h);window.__pr.html+=String(h)}};" +
    "return {document:doc,focus:function(){},print:function(){window.__pr.print++}}}})();"
  )
  await p.goto(BASE + '/?__v379=' + Date.now() + '#/forecast', 9000)
  const url = await p.eval('location.href')
  console.log('[' + LABEL + '] url = ' + url)
  const logged = await p.eval('!!localStorage.getItem("hergent_v2_token") && !/#\\/login/.test(location.href)')
  rec('G0 登录态自检（令牌可用、未落登录页）', logged, true, { url })

  await waitFor(p, 'document.querySelector("table.cross-tbl, table.edit-tbl")', 90000, '预报页 chunk 挂载')
  await waitFor(p, '[].slice.call(document.querySelectorAll("button")).some(function(b){return (b.textContent||"").trim()==="改单"})', 60000, '改单按钮出现')
  const ent = await p.eval('(function(){var bs=[].slice.call(document.querySelectorAll("button"));var b=bs.filter(function(x){return (x.textContent||"").trim()==="改单"})[0];if(b){b.click();return 1}return 0})()')
  await sleep(1200)
  await waitFor(p, 'document.querySelector("table.edit-tbl thead th")', 90000, '编辑网格出现')
  await p.eval(HELPERS)
  const inj = await p.eval('typeof window.__sel + "," + typeof window.__paste + "," + typeof window.__printStub')
  guard('G1 探针工具已注入', inj, 'function,function,function')
  guard('G2 进入编辑态', ent, 1)

  const geo = await probe(p, '{rows: window.__rows().length, ths: window.__ths().length, tds: window.__tbl().querySelectorAll("tbody td[data-r]").length, cellCols: window.__cellCols()}')
  console.log('[' + LABEL + '] 网格几何 = ' + JSON.stringify(geo))
  guard('G3 网格有行有列（探针有判别力）', geo.rows > 8 && geo.ths > 3, true)
  guard('G4 找到数量列（单元格轴的可靠入口）', geo.cellCols.length >= 3, true)
  const IC = geo.cellCols
  const C0 = IC[0], C1 = IC[1], MAXC = IC[IC.length - 1]
  console.log('[' + LABEL + '] 列坐标 = { C0:' + C0 + ', C1:' + C1 + ', maxC:' + MAXC + ' }')

  /* 粘贴自证：clipboardData 读不到的话 T1 整组恒真（探针先自证判别力） */
  const pasteOK = await p.eval('window.__paste(window.__tbl(), "SELFTEST", null)')
  guard('G5 粘贴事件自证：页面能读到 clipboardData（否则 T1 整组恒真）', pasteOK, true)
  const armed = await p.eval('Array.isArray(window.__WRITES) && !!(window.__pr && window.__pr.open === 0)')
  guard('G6 写监控 + 打印桩已安装（缺它两条判据恒真）', armed, true)

  /* ================= T1 粘贴跳过空单元格（C-2） ================= */
  const T1R = 2
  await p.eval('window.__reset()'); await sleep(250)
  await p.eval('window.__click(window.__td(' + T1R + ',' + C0 + '))'); await sleep(350)
  const s1 = await snap(p, 'T1a_before_paste')
  rec('T1 前置：点击进入单元格轴（不是行轴）', s1.rowStrong === 0 && s1.activeR === T1R && s1.activeC === C0, true, { rowStrong: s1.rowStrong, a: [s1.activeR, s1.activeC] })
  await p.eval('window.__paste(window.__td(' + T1R + ',' + C0 + '), "4242\\t4343", null)'); await sleep(450)
  const vA = await p.eval('window.__cellVal(' + T1R + ',' + C0 + ')')
  const vB = await p.eval('window.__cellVal(' + T1R + ',' + C1 + ')')
  guard('T1b 前置：非空块能写进去（4242/4343）', vA === '4242' && vB === '4343', true)
  console.log('  [T1] 铺设完成 (' + C0 + '=' + vA + ', ' + C1 + '=' + vB + ')')

  await p.eval('window.__paste(window.__td(' + T1R + ',' + C0 + '), "\\t5555", null)'); await sleep(450)
  const keptA = await p.eval('window.__cellVal(' + T1R + ',' + C0 + ')')
  const newB = await p.eval('window.__cellVal(' + T1R + ',' + C1 + ')')
  console.log('  [T1] 粘贴「空格+5555」后：' + C0 + '=' + JSON.stringify(keptA) + ' ' + C1 + '=' + JSON.stringify(newB))
  disc('★T1c 粘贴含空格的块：空格处**原值保留**（不再被清零）', keptA === '4242', true, false)
  guard('T1d 同一块里的非空格照常写入（证明这次粘贴真的执行了）', newB, '5555')

  await p.eval('window.__reset()'); await sleep(200)
  await p.eval('window.__click(window.__td(' + T1R + ',' + C0 + '))'); await sleep(300)
  await p.eval('window.__paste(window.__td(' + T1R + ',' + C0 + '), "\\t6666", { alt: true })'); await sleep(450)
  const altA = await p.eval('window.__cellVal(' + T1R + ',' + C0 + ')')
  const altB = await p.eval('window.__cellVal(' + T1R + ',' + C1 + ')')
  console.log('  [T1] 带 alt 修饰的粘贴后：' + C0 + '=' + JSON.stringify(altA) + ' ' + C1 + '=' + JSON.stringify(altB))
  /* v379 决策记录：曾设计「Alt 覆盖空值」出口，实测 `'altKey' in new ClipboardEvent('paste') === false`
     ⇒ 真实 paste 事件读不到修饰键，那个分支永不进（假旋钮）；macOS 的 Option+V 在 Chrome 里是输入「√」。
     ⇒ 已撤除，只保留**唯一**语义「跳过空格」。本条判据锁住这个决策：带 alt 也必须跳过。 */
  disc('★T1e 不存在「覆盖空值」第二语义：带 alt 修饰同样跳过空格（要清空请先选中→Delete 再粘）',
    altA === '4242' && altB === '6666', true, false)

  /* ================= T2 Ctrl 组合键可达 + 裸键不回归（B-1/B-2） ================= */
  const diag = await probe(p, 'window.__diag()')
  console.log('  [诊断] ' + JSON.stringify(diag))
  const longest = await probe(p, 'window.__pickRun(1, 0)')
  console.log('  [诊断] 全表最长连续数量段 = ' + JSON.stringify(longest) + '（说明当期数据是稀疏的，判据不能靠它）')
  /* 🔴 基准数据**自己铺**，不依赖当期分布：首跑写死 (10, 第一数量列)，而那一列在 10 行以下
     没有连续数据 ⇒ 「Ctrl+↓ 有判别力」的前置判据自己先红（探针自证判别力的意义就在这里）。
     也不改成「从数据里找一段」—— 实测全表**没有长度 ≥ 2 的连续段**（稀疏报单），找不到就用不上。
     ⇒ 在第 60 行起铺一条 5 格连续段（区块粘贴对非空格两侧行为一致，属**两侧同构**的准备动作）。 */
  const T2R = 60, T2C = C0, SEED = ['1101', '1102', '1103', '1104', '1105']
  await p.eval('window.__reset()'); await sleep(250)
  await p.eval('window.__click(window.__td(' + T2R + ',' + T2C + '))'); await sleep(350)
  await p.eval('window.__paste(window.__td(' + T2R + ',' + T2C + '), ' + arr(SEED) + '.join(' + NL + '), null)'); await sleep(500)
  const seeded = await probe(p, '{a: window.__cellVal(' + T2R + ',' + T2C + '), b: window.__cellVal(' + (T2R + 4) + ',' + T2C + ')}')
  guard('T2 前置：连续段铺设成功（1101 … 1105）', seeded.a === '1101' && seeded.b === '1105', true)
  const runEnd = T2R + SEED.length - 1
  const lu = await probe(p, 'window.__lastUsed()')
  console.log('  [T2] 基准段 = 行 ' + T2R + '..' + runEnd + ' @列 ' + T2C + '；已用区镜像 = ' + JSON.stringify(lu))
  guard('T2 前置：基准段长度 5（否则 Ctrl+↓ 判据与「只往下一格」分不开）', runEnd - T2R + 1, 5)

  await p.eval('window.__reset()'); await sleep(200)
  await p.eval('window.__click(window.__td(' + T2R + ',' + T2C + '))'); await sleep(300)
  await p.eval('window.__key("End", { ctrl: true })'); await sleep(500)
  const sEnd = await snap(p, 'T2b_ctrl_end')
  console.log('  [T2] Ctrl+End 落点 = (' + sEnd.activeR + ',' + sEnd.activeC + ') 期望≈(' + lu.r + ',' + lu.c + ')')
  disc('★T2a Ctrl+End 跳到整表已用区最后一行（旧码被裸 End 抢走 ⇒ 只动到本行末列）',
    sEnd.activeR >= lu.r - 5 && sEnd.activeR > T2R + 3, true, false)
  afterOnly('★T2a2 Ctrl+End 的列也是「已用区末列」而非本行末列', Math.abs(sEnd.activeC - lu.c) <= 1, true)

  await p.eval('window.__reset()'); await sleep(200)
  await p.eval('window.__click(window.__td(' + T2R + ',' + T2C + '))'); await sleep(300)
  await p.eval('window.__key("End", null)'); await sleep(400)
  const sEnd2 = await snap(p, 'T2c_plain_end')
  guard('T2d 裸 End 仍在「本行末列」（未回归）', sEnd2.activeR === T2R && sEnd2.activeC === MAXC, true)

  await p.eval('window.__key("Home", { ctrl: true })'); await sleep(500)
  const sHome = await snap(p, 'T2e_ctrl_home')
  console.log('  [T2] Ctrl+Home 落点 = (' + sHome.activeR + ',' + sHome.activeC + ')')
  disc('★T2e Ctrl+Home 回整表左上角（旧码被裸 Home 抢走 ⇒ 只到本行首列）',
    sHome.activeR === 0 && sHome.activeC === 0, true, false)

  await p.eval('window.__reset()'); await sleep(200)
  await p.eval('window.__click(window.__td(' + T2R + ',' + T2C + '))'); await sleep(300)
  await p.eval('window.__key("ArrowDown", { ctrl: true })'); await sleep(500)
  const sRun = await snap(p, 'T2f_ctrl_down')
  console.log('  [T2] Ctrl+↓ 落点行 = ' + sRun.activeR + ' 期望 = ' + runEnd)
  disc('★T2f Ctrl+↓ 跳到本列连续数据末尾（旧码只往下一格）', sRun.activeR === runEnd, true, false)

  await p.eval('window.__reset()'); await sleep(200)
  await p.eval('window.__click(window.__td(' + T2R + ',' + T2C + '))'); await sleep(300)
  await p.eval('window.__key("ArrowDown", { ctrl: true, shift: true })'); await sleep(500)
  const sCs = await snap(p, 'T2g_ctrl_shift_down')
  console.log('  [T2] Ctrl+Shift+↓ 选区 = ' + JSON.stringify({ h: sCs.h, cells: sCs.rangeCells, r0: sCs.r0, r1: sCs.r1 }))
  disc('★T2g Ctrl+Shift+↓ 真能扩选（旧码连分支都走不到，rangeCells 恒 0）',
    sCs.rangeCells >= 4 && sCs.r1 === runEnd && sCs.r0 === T2R, true, false)

  /* ================= T3 Shift 扩选（B-3/B-4） ================= */
  const T3R = 30
  await p.eval('window.__reset()'); await sleep(250)
  await p.eval('window.__click(window.__td(' + T3R + ',' + C0 + '))'); await sleep(350)
  const sT3a = await snap(p, 'T3a_anchor_only')
  rec('T3 前置：锚点单格、无选区', sT3a.rangeCells === 0 && sT3a.activeR === T3R && sT3a.activeC === C0, true, { rangeCells: sT3a.rangeCells, a: [sT3a.activeR, sT3a.activeC] })

  for (let i = 0; i < 3; i++) { await p.eval('window.__key("ArrowDown", { shift: true })'); await sleep(300) }
  const sT3b = await snap(p, 'T3b_shift_down_x3')
  disc('★T3a Shift+↓×3 得到 4 行选区（旧码四个 Arrow 分支都不判 shiftKey ⇒ 只是移动）',
    sT3b.h === 4 && sT3b.r0 === T3R && sT3b.r1 === T3R + 3 && sT3b.rangeCells === 4, true, false)
  disc('★T3b Shift 扩选时活动格留在锚点（Excel 口径：不跟着跑）',
    sT3b.activeR === T3R && sT3b.activeC === C0 && sT3b.selCells === 1, true, false)
  await shot(p, 'T3-shift-down')

  await p.eval('window.__key("ArrowRight", { shift: true })'); await sleep(280)
  await p.eval('window.__key("ArrowRight", { shift: true })'); await sleep(280)
  const sT3c = await snap(p, 'T3c_shift_right_x2')
  disc('★T3c Shift+→×2 横向扩到 3 列', sT3c.w === 3, true, false)
  afterOnly('★T3d 选区是 4×3 矩形（不塌成一条 / 不是越括越小）', sT3c.rangeCells === 12 && sT3c.h === 4 && sT3c.w === 3, true)

  await p.eval('window.__key("ArrowUp", { shift: true })'); await sleep(350)
  const sT3d = await snap(p, 'T3d_shift_up_shrink')
  console.log('  [T3] Shift+↑ 回缩后 = ' + JSON.stringify({ h: sT3d.h, r0: sT3d.r0, r1: sT3d.r1 }))
  disc('★T3e Shift+↑ 从推进端**回缩**一格（推进端语义；从锚点+1 重算的实现会得到 2 行而非 3 行）',
    sT3d.h === 3 && sT3d.r0 === T3R && sT3d.r1 === T3R + 2, true, false)

  /* 视口跟随：扩 15 行后推进端必须在视口里（v210 教训：选区在长、屏幕不动 = 用户以为键盘坏了） */
  await p.eval('window.__reset()'); await sleep(200)
  await p.eval('window.__click(window.__td(' + T3R + ',' + C0 + '))'); await sleep(300)
  for (let i = 0; i < 15; i++) { await p.eval('window.__key("ArrowDown", { shift: true })'); await sleep(140) }
  const sT3e = await snap(p, 'T3e_shift_down_x15')
  const edgeVis = await p.eval('window.__edgeVisible(' + sT3e.r1 + ',' + C0 + ')')
  console.log('  [T3] 15 行扩选后推进端可见性 = ' + edgeVis + ' 选区 = (' + sT3e.r0 + '..' + sT3e.r1 + ')')
  afterOnly('★T3f 扩选 15 行后推进端仍在视口内（视口跟随推进端）', sT3e.h === 16 && edgeVis === true, true)

  /* Shift+End 扩选到行末（B-4） */
  await p.eval('window.__reset()'); await sleep(200)
  await p.eval('window.__click(window.__td(' + T3R + ',' + C0 + '))'); await sleep(300)
  await p.eval('window.__key("End", { shift: true })'); await sleep(450)
  const sT3f = await snap(p, 'T3f_shift_end')
  disc('★T3g Shift+End 扩选到本行末列', sT3f.w === MAXC - C0 + 1 && sT3f.r0 === T3R, true, false)

  /* 扩选后 Ctrl+D 联动（验证「活动格 = 锚点」这条设计真的有用） */
  await p.eval('window.__reset()'); await sleep(200)
  await p.eval('window.__click(window.__td(' + T3R + ',' + C0 + '))'); await sleep(300)
  await p.eval('window.__paste(window.__td(' + T3R + ',' + C0 + '), "7777", null)'); await sleep(400)
  const anchorVal = await p.eval('window.__cellVal(' + T3R + ',' + C0 + ')')
  guard('T3 前置：锚点值铺设成功（7777）', anchorVal, '7777')
  for (let i = 0; i < 3; i++) { await p.eval('window.__key("ArrowDown", { shift: true })'); await sleep(240) }
  await p.eval('window.__key("d", { ctrl: true })'); await sleep(500)
  const fill = await probe(p, '{a: window.__cellVal(' + (T3R + 1) + ',' + C0 + '), b: window.__cellVal(' + (T3R + 2) + ',' + C0 + '), c: window.__cellVal(' + (T3R + 3) + ',' + C0 + '), beyond: window.__cellVal(' + (T3R + 4) + ',' + C0 + ')}')
  console.log('  [T3] 扩选后 Ctrl+D 填充 = ' + JSON.stringify(fill))
  afterOnly('★T3h 扩选后 Ctrl+D 从**选区首行**向下填（锚点=活动格口径）', fill.a === '7777' && fill.b === '7777' && fill.c === '7777', true)
  afterOnly('★T3i Ctrl+D 不越出选区（不会一路填到底）', fill.beyond !== '7777', true)

  /* ================= T4 打印走 printable.js（E-13/G-10） ================= */
  await p.eval('window.__reset()'); await sleep(250)
  await p.eval('window.__printStub()')
  const domRows = await p.eval('window.__rows().length')
  const visRows = await p.eval('window.__rowsVisible()')
  /* 前置：证明「打印不受分页约束」这条判据**有内容** —— 分页关着时 可见==全部，判据恒真。 */
  guard('T4 前置：编辑态分页开着（可见行 < 全部行，否则 ★T4d 恒真）', visRows < domRows, true)
  const name0 = await p.eval('(function(){var t=window.__tbl();var rs=[].slice.call(t.querySelectorAll("tbody tr"));for(var i=0;i<rs.length;i++){var inp=rs[i].querySelector("input");if(inp&&inp.value&&inp.value.trim())return inp.value.trim()}return ""})()')
  const opened = await p.eval('window.__clickText("工具箱")'); await sleep(600)
  rec('T4 前置：工具箱面板打开', opened === 1, 1, opened)
  const clicked = await p.eval('window.__clickText("打印")'); await sleep(900)
  rec('T4 前置：打印按钮点到', clicked === 1, 1, clicked)
  const pr = await probe(p, 'window.__pr')
  const st = await probe(p, 'window.__printStats()')
  console.log('  [T4] 记账 = open:' + pr.open + ' print:' + pr.print + ' html长度:' + pr.html.length)
  console.log('  [T4] 文档统计 = ' + JSON.stringify(st) + ' （网格可见行 ' + visRows + ' / DOM 行 ' + domRows + '、数据列 ' + geo.ths + '）')
  disc('★T4a 打印走可打印页基建（打开新窗口），不再裸 window.print()', pr.open === 1 && pr.print === 0, true, false)
  afterOnly('★T4b 生成的文档含横向 A4 规则（@page landscape）', st.landscape, true)
  afterOnly('★T4c 生成的文档含跨页重复表头规则', st.headerGroup, true)
  /* 🔴 ★T4d 口径（v379 实测修正，原写成「== 网格可见行数」是**错的**）：
     打印与「导出 Excel」共用 `filteredRowsForExport()` —— 它套**筛选**（搜索/列筛选/仅显示有报单），
     **不套分页**。编辑态默认开分页（pageSize=50，:4621「Q7」），故可见 50 行而打印 155 行。
     这是**有意**的：分页是「看」的便利，打印/导出要的是**整张单子**，否则用户只会拿到第 1 页却看不出来。
     因此正确期望 = **全部数据行数**（无筛选时），并与导出保持同口径。 */
  disc('★T4d 打印行数 == 全部数据行（与「导出 Excel」同口径：受筛选约束、不受分页约束）',
    st.tr === domRows, true, false)
  afterOnly('★T4e 表头列数 == 数据列(含单位列) + 2（金额/建议）', st.th === geo.ths + 2, true)
  afterOnly('★T4f 文档标题含「预报订单汇总表」', st.title, true)
  {
    /* 空壳表也能满足「行数/列数对」，故必须再证**带的是真数据**：正文含网格某商品的名称。
       转义与 printGrid 内的 esc 同序（& 先、再 < >），否则带 & 的商品名会假红。 */
    const esc0 = String(name0).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    disc('★T4g 打印正文含商品名（证明带的是真数据、不是空壳表）',
      String(name0).length > 0 && pr.html.indexOf(esc0) >= 0, true, false)
  }
  await p.eval('window.__printRestore()')
  await shot(p, 'T4-print')

  /* ================= 收尾：零写入取证 ================= */
  await p.eval('window.__reset()'); await sleep(300)
  const wr = await probe(p, 'window.__writes()')
  console.log('[' + LABEL + '] 零写入取证：监控已安装=' + armed + '  非 GET 的 /api/ 请求 = ' + wr.all + ' 条；业务写类 = ' + JSON.stringify(wr.risky))
  rec('★G7 零写入：全程未发出任何业务写请求（本探针改了格子内容，只落内存 + localStorage 草稿）', wr.risky.length === 0, '0 条', wr.risky)
  console.log('[' + LABEL + '] 非 GET 请求清单 = ' + JSON.stringify(JSON.parse(await p.eval('JSON.stringify(window.__WRITES||[])'))))

  if (p.errors && p.errors.length) console.log('[' + LABEL + '] 页面报错(' + p.errors.length + '): ' + JSON.stringify(p.errors.slice(0, 5)))
  else console.log('[' + LABEL + '] 页面报错: 0')

  const fail = R.filter(x => !x.ok)
  const skipped = R.filter(x => x.skip)
  const judged = R.length - skipped.length
  console.log('[' + LABEL + '] 断言 ' + (judged - fail.length) + '/' + judged + ' 通过' + (skipped.length ? '（另有 ' + skipped.length + ' 项本侧不可达，跳过）' : ''))
  fs.writeFileSync('/tmp/v379-probe-' + LABEL + '.json', JSON.stringify({ label: LABEL, base: BASE, pass: judged - fail.length, total: judged, skipped: skipped.length, results: R, snaps }, null, 1))
  console.log('DUMP /tmp/v379-probe-' + LABEL + '.json')
  if (fail.length) { console.log('FAILED(' + fail.length + '): ' + JSON.stringify(fail.map(x => x.name))); process.exit(1) }
} finally {
  if (browser) await browser.close()
}
