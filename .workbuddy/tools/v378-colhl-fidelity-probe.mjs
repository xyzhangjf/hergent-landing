/* v378 高亮保真度探针：预报汇总表编辑网格 —— 「高亮范围必须 == 实际选中区域」。
 *
 * 用法：
 *   PROBE_LABEL=BEFORE PROBE_BASE=http://127.0.0.1:8876 PROBE_TOKEN_FILE=/tmp/v378-token.txt \
 *     node v378-colhl-fidelity-probe.mjs
 *   PROBE_LABEL=AFTER  PROBE_BASE=http://127.0.0.1:8877 PROBE_TOKEN_FILE=/tmp/v378-token.txt \
 *     node v378-colhl-fidelity-probe.mjs
 * ---------------------------------------------------------------------------
 * 核心判据（一句话）：**高亮的数据格数 == 被选中的数据格数**（selArea）。
 *
 * 数据区按「选择通道」计数（互不重叠地合并成一个 selArea）：
 *   colOverlay  列覆盖通道（inset 阴影的大 spread）—— 旧实现「点一格 ⇒ 整列点亮」走这条
 *   rangeCells  矩形通道（td.range-sel）
 *   selCells    活动格通道（td.selected）
 *   rowStrong   行强态通道（tr.row-sel > td）
 * 另加两条**只在表头 / 行号**的定位通道：hdrWeak / nrWeak（按定义不得出现在数据区）。
 *
 * 🔴 两条「恒假判据」已在本轮修正（首跑实测抓到，见交付文档 §9）：
 *   ① `100vmax` 在 **computed value 里被解析成 px**（本机实测 1600px）⇒ 用
 *      `boxShadow.indexOf('100vmax')` 当判据**两侧恒 0**（假绿/假红各一次）。
 *      改为**运行时校准**：注入一个同款阴影的探针 div，读出真实 spread 作阈值。
 *   ② 「无通道解释的青色底」在本表**本来就有 154 格** —— `TD.num.calc.final`（最终合计列）
 *      永久使用 `var(--p-bg)` 6% 青底（设计如此）。若直接计数，基线态就会被判成「有假高亮」。
 *      改为**基线相对**：P1 冷启动时把青底格登记为基线集，之后只统计「基线之外新增的青底」。
 *
 * 四态断言模型（照 v377 探针，避免四类「自己骗自己」的写法）：
 *   guard(name, got, want)                  两侧必须相同
 *   disc(name, got, wantAfter, wantBefore)  两侧期望值不同 ⇒ 这才是反例对照
 *   rel(name, okAfter, okBefore, detail)    关系式断言（避免猜旧实现的精确数字）
 *   afterOnly(name, got, want)              ONLY AFTER 可达；BEFORE 侧 SKIP 而不谎报
 *
 * 🔴 本文件里的 HELPERS 整体是模板字符串 ⇒ 注释里**禁止出现反引号**（v377 踩过三次）。
 * 🔴 只读：不点新建/保存/删除，不调写接口；令牌只复用生产**已有**活跃会话（mode=ro 取号）。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:5289'
const LABEL = process.env.PROBE_LABEL || 'AFTER'
/* 🔴 v378 修正（2026-10-05 实测踩到）：原写法 `LABEL === 'AFTER'` 让**第三个标签**
   （如 LIVE / 生产直打）**静默落回 BEFORE 侧期望** ⇒ 改造后的正确行为被判成 19 条红，
   而实测值其实与 AFTER 逐项相同 —— 又是一条「判据的观测口径与被测对象不匹配」的假红。
   语义应当是「**只有显式 BEFORE 才是改造前**」，其余标签一律按改造后期望判。
   ⚠️ 注意 `afterOnly`（BEFORE 侧不可达）也随之生效，否则会白白多出 10 条 skip。 */
const IS_AFTER = LABEL !== 'BEFORE'
const TOK = fs.readFileSync(process.env.PROBE_TOKEN_FILE || '/tmp/v378-token.txt', 'utf8').trim()
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

/* ===================== 注入页面的探针工具 ===================== */
const HELPERS = `
window.__tbl = function () {
  var ts = [].slice.call(document.querySelectorAll('table.edit-tbl'))
  for (var i = 0; i < ts.length; i++) if (ts[i].querySelectorAll('thead th').length > 0) return ts[i]
  return null
}
window.__rows = function () { var t = window.__tbl(); return t ? [].slice.call(t.querySelectorAll('tbody tr')) : [] }
window.__td = function (ri, ci) { return window.__tbl().querySelector('tbody td[data-r="' + ri + '"][data-c="' + ci + '"]') }
window.__seq = function (ri) { return window.__rows()[ri].querySelector('td.seq-cell') }
window.__hasCls = function (el, c) { return !!(el && el.classList && el.classList.contains(c)) }
/* 统一列号 -> 表头元素。⚠️ thead 里**还夹着 7 个计算列的 th**（无统一列号），
   但它们排在数据列之后 ⇒ ci 在 0..maxC 范围内时下标对齐；越界即视为没有。 */
window.__ths = function () {
  var t = window.__tbl(); if (!t) return []
  return [].slice.call(t.querySelectorAll('thead th')).filter(function (x) {
    return !x.classList.contains('seq-th') && !x.classList.contains('op-th') && !x.classList.contains('calc-th')
  })
}
window.__th = function (ci) { return window.__ths()[ci] }
/* ---- 运行时校准「列覆盖」判据（100vmax 会被解析成 px，不能按字面匹配）---- */
window.__calOverlay = function () {
  var d = document.createElement('div')
  d.style.cssText = 'position:absolute;left:-9999px;top:0;width:8px;height:8px;box-shadow:inset 0 0 0 100vmax rgba(6,182,212,.06)'
  document.body.appendChild(d)
  var raw = getComputedStyle(d).boxShadow
  d.parentNode.removeChild(d)
  var m = /([\\d.]+)px\\s+inset/.exec(String(raw))
  window.__ovRaw = raw
  window.__ovThr = m ? parseFloat(m[1]) * 0.5 : null
  return { raw: raw, thr: window.__ovThr }
}
window.__bigInset = function (bs) {
  if (window.__ovThr === null || window.__ovThr === undefined) return false
  var re = /([\\d.]+)px\\s+inset/g, mm
  while ((mm = re.exec(String(bs)))) { if (parseFloat(mm[1]) >= window.__ovThr) return true }
  return false
}
/* ---- 青色分类器 + 自证（技能 §9：断言之前先自证判别力）---- */
window.__cls = function (css) {
  var m = /^rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)$/.exec(String(css).trim())
  if (!m) return 'other'
  var r = +m[1], g = +m[2], b = +m[3]
  var a = m[4] === undefined ? 1 : parseFloat(m[4])
  if (a <= 0.03) return 'transparent'
  if ((g - r) > 100 && (b - r) > 100) return 'cyan'
  return 'other'
}
window.__clsSelfTest = function () {
  var T = [
    ['rgba(6, 182, 212, 0.06)', 'cyan'],
    ['rgba(6, 182, 212, 0.10)', 'cyan'],
    ['rgba(6, 182, 212, 0.05)', 'cyan'],
    ['rgb(159, 225, 203)', 'other'],
    ['rgb(225, 245, 238)', 'other'],
    ['rgb(29, 158, 117)', 'other'],
    ['rgb(93, 202, 165)', 'other'],
    ['rgb(233, 248, 251)', 'other'],
    ['rgba(255, 255, 251, 1)', 'other'],
    ['rgba(255, 59, 48, 0.10)', 'other'],
    ['rgba(0, 0, 0, 0)', 'transparent']
  ]
  var bad = []
  for (var i = 0; i < T.length; i++) { var got = window.__cls(T[i][0]); if (got !== T[i][1]) bad.push(T[i][0] + ' => ' + got) }
  return { n: T.length, bad: bad }
}
/* 事件派发：几何用 getBoundingClientRect 真值（clientX 为 0 会把右键菜单定位到 (0,0)） */
window.__ev = function (el, type, opt) {
  var r = el.getBoundingClientRect()
  var o = { bubbles: true, cancelable: true, clientX: Math.round(r.left + (r.width || 20) / 2), clientY: Math.round(r.top + (r.height || 16) / 2) }
  if (opt) for (var k in opt) o[k] = opt[k]
  el.dispatchEvent(new MouseEvent(type, o)); return 1
}
window.__md = function (el) { return window.__ev(el, 'mousedown', { button: 0, buttons: 1 }) }
window.__mo = function (el) { return window.__ev(el, 'mouseover', { button: 0, buttons: 0 }) }
/* onCellUp 绑在 window 上（onMounted addEventListener('mouseup')）⇒ 必须派在 window 上 */
window.__mup = function () { window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 })); return 1 }
window.__key = function (el, k) { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: k })); return 1 }
window.__reset = function () {
  var t = window.__tbl()
  if (t) { window.__key(t, 'Escape'); window.__key(t, 'Escape'); window.__key(t, 'Escape') }
  return 1
}
window.__click = function (el) { window.__md(el); window.__mup(); return 1 }
window.__drag = function (a, b) { window.__md(a); window.__mo(b); window.__mup(); return 1 }
/* 视觉指纹：底色 + 阴影 + **背景图**一起看。
   🔴 首版只读 backgroundColor + boxShadow —— 而 v378 的弱指示器是 background-image 渐变叠层，
   这两项**一个都不变** ⇒ 该指纹对弱指示器**永久失明**，「有视觉差异」这条断言在 AFTER 侧**恒假**
   （首跑实测：P2 与 P7 共 3 条假红，见交付文档 §9）。补上 backgroundImage 才恢复判别力。 */
window.__sig = function (el) { if (!el) return null; var s = getComputedStyle(el); return s.backgroundColor + ' | ' + s.boxShadow + ' | ' + s.backgroundImage }
/* 有效绘制色：把 background-color 与 background-image 渐变的首个色标按 alpha 合成，
   得到「用户眼睛看到的这一格到底是什么颜色」。比单读某个属性更接近事实，且与后台是
   background 还是 background-image 实现无关 —— 专治「属性没变但其实看得见 / 属性变了但其实看不见」。 */
window.__eff = function (el) {
  if (!el) return null
  var s = getComputedStyle(el)
  function rgba(c) {
    /* 🔴 HELPERS 是**模板字面量**：正则里的反斜杠必须**双写**（\\( \\) \\d \\s）。
       单写会被求值阶段吃掉 —— 「\\(」 变 「(」，于是 /rgba?\\(([^)]+)\\)/ 变成 /rgba?(([^)]+))/，
       m[1] 拿到的是 "(250, 250, 250"（带左括号）⇒ parseFloat = NaN ⇒ 有效色算成 "NaN,250,250"。
       本文件同族既有写法见 __bigInset / __esc（都用的双反斜杠）。 */
    var m = /rgba?\\(([^)]+)\\)/.exec(String(c))
    if (!m) return null
    var p = m[1].split(',').map(function (x) { return parseFloat(x) })
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  var bg = rgba(s.backgroundColor) || { r: 255, g: 255, b: 255, a: 0 }
  var ov = rgba(s.backgroundImage)
  if (ov && ov.a > 0) bg = { r: Math.round(bg.r * (1 - ov.a) + ov.r * ov.a), g: Math.round(bg.g * (1 - ov.a) + ov.g * ov.a), b: Math.round(bg.b * (1 - ov.a) + ov.b * ov.a) }
  return bg.r + ',' + bg.g + ',' + bg.b
}
/* 感知亮度（sRGB 近似）—— 用来断言弱指示器的**方向**正确：
   浅色主题下应当**更暗**（浅灰压白底），深色主题下应当**更亮**（浅灰压深底）。
   只断言「不一样」不够 —— 一个黑色的叠加在深色主题里也叫「不一样」，但用户看不见。 */
window.__lum = function (rgb) {
  if (!rgb) return null
  var p = String(rgb).split(',').map(function (x) { return parseFloat(x) })
  return Math.round(0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2])
}
/* 元素中心点的视口坐标 + 视口/DPR —— 供**渲染像素采样**（独立第三通道）用。
   像素通道不看任何 CSS 属性，直接读屏幕上的字节，因此无法被「属性对不对」这类论证绕过去。 */
window.__rect = function (el) {
  if (!el) return null
  var r = el.getBoundingClientRect()
  return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }
}
window.__vp = function () { return { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio } }
window.__dark = function (on) {
  var el = document.documentElement
  if (on) { if (!window.__oldCls) window.__oldCls = el.className; el.className = 'dark' } else { el.className = window.__oldCls || '' }
  return getComputedStyle(el).getPropertyValue('--p').trim()
}
/* 某列上「带列覆盖通道的格」占该列全部格的**比例**（自引用安全的「整列覆盖」判据） */
window.__colRatio = function (ci) {
  var all = [].slice.call(window.__tbl().querySelectorAll('tbody td[data-c="' + ci + '"]'))
  if (!all.length) return -1
  var hit = all.filter(function (td) { return window.__bigInset(getComputedStyle(td).boxShadow) }).length
  return Math.round(hit * 1000 / all.length) / 1000
}
/* 单元格轴的入口列 = **数量列**（td.qty-cell）——
   🔴 首版按「td 里有 input」找，结果把 0,2..27 全列进去了：商品属性列里也有 input，
   但 isInputColIdx() 走的是**列元数据**（edit==='text'|'num'）不是 DOM ⇒ 点上去其实是**行轴**。
   数量列一定满足 ci < n + unitCount()（源码 isInputColIdx 的第二分支）⇒ 是可靠入口。 */
window.__cellCols = function () {
  var tr = window.__rows()[2]
  if (!tr) return []
  return [].slice.call(tr.querySelectorAll('td.qty-cell[data-c]')).map(function (td) { return +td.getAttribute('data-c') })
}
window.__cellKey = function (td) {
  var tr = td.parentElement
  var idx = [].slice.call(tr.children).indexOf(td)
  return td.getAttribute('data-r') + ':' + (td.getAttribute('data-c') === null ? 'x' + idx : td.getAttribute('data-c'))
}
/* 基线集：冷启动（零选区）时**本来就**是青底的格（本表 = 最终合计列的 6% 青底，设计如此） */
window.__setBase = function () {
  var t = window.__tbl(), s = {}
  var tds = [].slice.call(t.querySelectorAll('tbody td[data-r]'))
  for (var i = 0; i < tds.length; i++) if (window.__cls(getComputedStyle(tds[i]).backgroundColor) === 'cyan') s[window.__cellKey(tds[i])] = 1
  window.__BASE = s
  return Object.keys(s).length
}
window.__fid = function (tag) {
  var t = window.__tbl()
  if (!t) return { tag: tag, err: 'no-table' }
  var tds = [].slice.call(t.querySelectorAll('tbody td[data-r]'))
  var ths = [].slice.call(t.querySelectorAll('thead th'))
  var firstTr = t.querySelector('tbody tr')
  var base = window.__BASE || {}
  var o = {
    tag: tag, rowTotal: t.querySelectorAll('tbody tr').length, tbodyTd: tds.length, thTotal: ths.length,
    firstRowTd: firstTr ? firstTr.querySelectorAll('td').length : 0,
    selArea: 0, colOverlay: 0, rangeCells: 0, selCells: 0, rowStrong: 0,
    bgCyan: 0, extraCyan: 0, lostBase: 0,
    hdrStrong: 0, hdrWeak: 0, nrWeak: 0, nrStrong: 0
  }
  for (var i = 0; i < tds.length; i++) {
    var td = tds[i], s = getComputedStyle(td), ch = []
    if (window.__bigInset(s.boxShadow)) { o.colOverlay++; ch.push('col') }
    if (td.classList.contains('range-sel')) { o.rangeCells++; ch.push('rect') }
    if (td.classList.contains('selected')) { o.selCells++; ch.push('active') }
    var tr = td.parentElement
    if (tr && tr.classList.contains('row-sel')) { o.rowStrong++; ch.push('row') }
    var isCyan = window.__cls(s.backgroundColor) === 'cyan'
    if (isCyan) o.bgCyan++
    var k = window.__cellKey(td)
    if (isCyan && ch.length === 0 && !base[k]) o.extraCyan++
    if (!isCyan && base[k]) o.lostBase++
    if (ch.length) o.selArea++
  }
  for (var j = 0; j < ths.length; j++) {
    if (ths[j].classList.contains('sel-col')) o.hdrStrong++
    if (ths[j].classList.contains('cur-col-hd')) o.hdrWeak++
  }
  /* 🔴 v378 的类在 **tr** 上（<tr :class="{'cur-row-hd':...}">），CSS 是 tr.cur-row-hd > td.seq-cell。
     首版写成 td.seq-cell.cur-row-hd（在 td 上找）⇒ 计数**恒 0**，与 CSS 对错无关 —— 又一条无判别力的判据。 */
  o.nrWeak = t.querySelectorAll('tbody tr.cur-row-hd > td.seq-cell').length
  o.nrStrong = t.querySelectorAll('tbody tr.row-sel > td.seq-cell').length
  o.nrWeakSig = window.__sig(t.querySelector('tbody tr.cur-row-hd > td.seq-cell'))
  o.nrWeakEff = window.__eff(t.querySelector('tbody tr.cur-row-hd > td.seq-cell'))
  o.hdrBaseSig = window.__sig(window.__th(1))
  o.hdrStrongSig = window.__sig(t.querySelector('thead th.sel-col'))
  o.hdrWeakSig = window.__sig(t.querySelector('thead th.cur-col-hd'))
  o.hdrWeakEff = window.__eff(t.querySelector('thead th.cur-col-hd'))
  return o
}
`
/* ===================== 断言记账 ===================== */
const R = []
const rec = (name, ok, want, got) => {
  R.push({ name, ok: !!ok, want, got })
  if (!ok) console.log('  ❌ ' + name + '  期望=' + JSON.stringify(want) + ' 实测=' + JSON.stringify(got))
}
const guard = (name, got, want) => rec(name, got === want, want, got)
const disc = (name, got, wantAfter, wantBefore) => rec(name, got === (IS_AFTER ? wantAfter : wantBefore), IS_AFTER ? wantAfter : wantBefore, got)
const rel = (name, okAfter, okBefore, detail) => rec(name, IS_AFTER ? okAfter : okBefore, IS_AFTER ? 'after' : 'before', detail)
const afterOnly = (name, got, want) => {
  if (!IS_AFTER) { R.push({ name, ok: true, skip: true, want, got }); return }
  rec(name, got === want, want, got)
}

const snaps = {}
const snap = async (p, tag) => {
  const s = JSON.parse(await p.eval('JSON.stringify(window.__fid(' + JSON.stringify(tag) + '))'))
  snaps[tag] = s
  console.log('  [' + tag + '] ' + JSON.stringify(s))
  return s
}
const probe = async (p, expr) => JSON.parse(await p.eval('JSON.stringify(' + expr + ')'))
const shot = async (p, tag) => { try { await p.screenshot('/tmp/v378-' + LABEL + '-' + tag + '.png') } catch (e) {} }

let browser = null
try {
  browser = await launch()
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(
    "localStorage.setItem('hergent_v2_token', " + JSON.stringify(TOK) + ");" +
    "localStorage.setItem('hergent_v2_tenant', '1');" +
    /* ---- v378 零写入取证（2026-10-05，为「在生产上跑」而加；**只监控、不改任何测量逻辑**）----
       在页面上下文里包一层 fetch / XMLHttpRequest.open，把**非 GET 的 /api/ 请求**记进 window.__WRITES。
       🔴 为什么不靠「我没点保存」这句话：本探针会点「改单」进编辑态并在格子上拖选，
          只有**取证**才能证明一次写接口都没发出（v210 纪律）。
       ⚠️ 用 indexOf('/api/') 而不是正则，避免模板/字符串转义踩坑。 */
    "window.__WRITES=[];" +
    "(function(){function log(m,u){try{if(String(u).indexOf('/api/')>=0&&String(m).toUpperCase()!=='GET')window.__WRITES.push(String(m).toUpperCase()+' '+String(u))}catch(e){}}" +
    "var f=window.fetch;window.fetch=function(a,b){try{log((b&&b.method)||(a&&a.method)||'GET',(typeof a==='string')?a:(a&&a.url)||'')}catch(e){}return f.apply(this,arguments)};" +
    "var o=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){log(m,u);return o.apply(this,arguments)}})();"
  )
  /* 冷启动：URL 与上一次不同 ⇒ 新文档 ⇒ addInitScript 才生效（同 URL 的 hash 变更不换文档） */
  await p.goto(BASE + '/?__v378=' + Date.now() + '#/forecast', 9000)
  const url = await p.eval('location.href')
  console.log('[' + LABEL + '] url = ' + url)
  /* 🔴 第一条断言固定为「登录态自检」：令牌失效会让所有依赖数据的断言一起红，像「产品坏了一片」。 */
  const logged = await p.eval('!!localStorage.getItem("hergent_v2_token") && !/#\\/login/.test(location.href)')
  rec('P-1 登录态自检（令牌可用、未落登录页）', logged, true, { url })

  await waitFor(p, 'document.querySelector("table.cross-tbl, table.edit-tbl")', 90000, '预报页 chunk 挂载')
  await waitFor(p, '[].slice.call(document.querySelectorAll("button")).some(function(b){return (b.textContent||"").trim()==="改单"})', 60000, '改单按钮出现')
  const ent = await p.eval('(function(){var bs=[].slice.call(document.querySelectorAll("button"));var b=bs.filter(function(x){return (x.textContent||"").trim()==="改单"})[0];if(b){b.click();return 1}return 0})()')
  await sleep(1200)
  await waitFor(p, 'document.querySelector("table.edit-tbl thead th")', 90000, '编辑网格出现')
  await p.eval(HELPERS)
  const inj = await p.eval('typeof window.__fid + "," + typeof window.__cls + "," + typeof window.__calOverlay')
  rec('P-2 探针工具已注入', inj === 'function,function,function', 'function,function,function', inj)
  rec('P-3 进入编辑态', ent === 1, 1, ent)

  const geo = await probe(p, '{rows: window.__rows().length, ths: window.__ths().length, tds: window.__tbl().querySelectorAll("tbody td[data-r]").length, cellCols: window.__cellCols()}')
  console.log('[' + LABEL + '] 网格几何 = ' + JSON.stringify(geo))
  rec('P-4 网格有行有列（探针有判别力）', geo.rows > 8 && geo.ths > 3, 'rows>8 && ths>3', geo)
  rec('P-5 找到数量列（单元格轴的可靠入口）', geo.cellCols.length >= 3, '>=3 个数量列', geo.cellCols)
  const IC = geo.cellCols

  /* ---------- P0 两条判据自证（必须先绿，否则后面所有读数作废） ---------- */
  const cal = await probe(p, 'window.__calOverlay()')
  console.log('  [校准] 100vmax 在 computed 里 = ' + JSON.stringify(cal))
  rec('P0a 运行时校准拿到正阈值（100vmax 被解析成 px）', typeof cal.thr === 'number' && cal.thr > 0, '>0', cal)
  const ov = await probe(p, '{' +
    /* 正例用**校准时读到的真实字符串**（不写死 px，换环境/换 viewport 仍然成立） */
    'pos_ctrl: window.__bigInset(window.__ovRaw),' +
    'neg_border: window.__bigInset(' + JSON.stringify('rgb(229, 229, 234) 1px 0px 0px 0px') + '),' +
    'neg_underline: window.__bigInset(' + JSON.stringify('rgb(6, 182, 212) 0px -2px 0px 0px inset') + '),' +
    'neg_newrow: window.__bigInset(' + JSON.stringify('rgb(6, 182, 212) 3px 0px 0px 0px inset') + ')' +
    '}')
  rec('P0b 列覆盖判据：正例命中（1600px inset）', ov.pos_ctrl, true, ov)
  rec('P0c 列覆盖判据：反例不命中（1px 边框 / 2px 下划线 / 3px 新行竖条）', !ov.neg_border && !ov.neg_underline && !ov.neg_newrow, true, ov)
  const st = await probe(p, 'window.__clsSelfTest()')
  rec('P0d 青色分类器自证（' + st.n + ' 个合成色，含 4 热力色/1 暖黄/1 危险色/new-row 混色）', st.bad.length === 0, [], st.bad)

  /* ============ P1 冷启动「零选中」+ 登记青底基线 ============
     🔴 顺序要紧：`__setBase()` 必须在**取 P1 快照之前**跑 —— 首版写在之后，
     于是 P1 快照里 `__BASE` 还是空的，154 格设计性青底全被判成「新增高亮」（假红）。 */
  const baseN = await p.eval('window.__setBase()')
  console.log('  [基线] 冷启动本来就青底的格 = ' + baseN)
  rec('P1 基线非空（否则后面的基线相对判据恒真）', baseN > 0, '>0', baseN)
  let s = await snap(p, 'P1_cold_no_sel')
  const sigColdCC = await p.eval('window.__sig(window.__th(' + IC[0] + '))')
  /* 冷启动基准：**同一批元素**（用 P2 将要点的同一列 / 同一行）在无选区时的有效绘制色。
     断言用「同元素前后差异」而不是「拿旁边元素当基准」，可避免冻结列 1px 边线一类的假差异。 */
  const effColdCC = await p.eval('window.__eff(window.__th(' + IC[0] + '))')
  const effColdNR = await p.eval('window.__eff(window.__seq(2))')
  console.log('  [P1] 冷启动时 __th(' + IC[0] + ') 的视觉指纹 = ' + JSON.stringify(sigColdCC))
  console.log('  [P1] 冷启动有效色 表头=' + JSON.stringify(effColdCC) + ' 行号=' + JSON.stringify(effColdNR))
  /* 冷启动截图 + 采样坐标 —— 供像素级第三通道与本轮 AFTER 的 P2 截图逐点比对 */
  await shot(p, 'P1-cold')
  const rectCold = await probe(p, '{' +
    'vp: window.__vp(),' +
    'th: window.__rect(window.__th(' + IC[0] + ')),' +
    'nr: window.__rect(window.__seq(2))' +
    '}')
  console.log('  [P1] 像素采样坐标(冷) ' + JSON.stringify(rectCold))
  const PX = { label: LABEL, cold: rectCold, after: null }
  fs.writeFileSync('/tmp/v378-px-' + LABEL + '.json', JSON.stringify(PX, null, 2))
  guard('P1 冷启动：无任何选择通道', s.selArea, 0)
  guard('P1 冷启动：无列覆盖', s.colOverlay, 0)
  guard('P1 冷启动：无行强态', s.rowStrong, 0)
  guard('P1 冷启动：无矩形底', s.rangeCells, 0)
  guard('P1 冷启动：无活动格', s.selCells, 0)
  guard('P1 冷启动：基线外无新增青底', s.extraCyan, 0)
  guard('P1 冷启动：表头零高亮（强）', s.hdrStrong, 0)
  guard('P1 冷启动：表头零高亮（弱定位也不许有）', s.hdrWeak, 0)
  guard('P1 冷启动：行号零高亮', s.nrWeak + s.nrStrong, 0)

  /* ============ P2 ★核心：单击一个**输入格** ============ */
  await p.eval('window.__reset()'); await sleep(400)
  const CR = 2, CC = IC[0]
  await p.eval('window.__click(window.__td(' + CR + ',' + CC + '))'); await sleep(500)
  s = await snap(p, 'P2b_cell_click')
  /* 🔴 场景判别力前置：单击必须真的进的是**单元格轴**。首版用了非输入列 ⇒ 实际进的是行轴，
     整个 P2 量到的是「行选中」而不是「单击一格」（12 条断言全部无意义）。 */
  rec('P2 前置：单击进入的是**单元格轴**（不是行轴）', s.rowStrong === 0 && s.rangeCells === 0, 'rowStrong=0 且 rangeCells=0', { rowStrong: s.rowStrong, rangeCells: s.rangeCells })
  const c2 = await probe(p, '{' +
    'th_same_hd: window.__hasCls(window.__th(' + CC + '),"cur-col-hd"),' +
    'th_same_sc: window.__hasCls(window.__th(' + CC + '),"sel-col"),' +
    'th_other_hd: window.__hasCls(window.__th(' + (CC + 3) + '),"cur-col-hd"),' +
    'th_other_sc: window.__hasCls(window.__th(' + (CC + 3) + '),"sel-col"),' +
    'nr_same: window.__hasCls(window.__seq(' + CR + ').parentElement,"cur-row-hd"),' +
    'nr_other: window.__hasCls(window.__seq(' + (CR + 3) + ').parentElement,"cur-row-hd"),' +
    'colRatio_same: window.__colRatio(' + CC + '),' +
    'eff_th_cc: window.__eff(window.__th(' + CC + ')),' +
    'eff_nr_cr: window.__eff(window.__seq(' + CR + ')),' +
    'sig_th_cc: window.__sig(window.__th(' + CC + '))' +
    '}')
  console.log('  [P2 classes] ' + JSON.stringify(c2))
  await shot(p, 'P2-cell-click')
  const rectAfter = await probe(p, '{' +
    'vp: window.__vp(),' +
    'th: window.__rect(window.__th(' + CC + ')),' +
    'nr: window.__rect(window.__seq(' + CR + '))' +
    '}')
  console.log('  [P2] 像素采样坐标(选) ' + JSON.stringify(rectAfter))
  PX.after = rectAfter
  fs.writeFileSync('/tmp/v378-px-' + LABEL + '.json', JSON.stringify(PX, null, 2))
  guard('P2 单击一格：只有 1 格是活动格', s.selCells, 1)
  guard('P2 单击一格：单击不产生矩形选区', s.rangeCells, 0)
  disc('★P2 单击一格：整列**不再**被点亮（列覆盖格数）', s.colOverlay, 0, s.rowTotal)
  disc('★P2 单击一格：被点那列的覆盖比例（1 = 整列）', c2.colRatio_same, 0, 1)
  rel('★P2 单击一格：整行**不再**被点亮（基线外新增青底格数）', s.extraCyan === 0, s.extraCyan > 0, s.extraCyan)
  disc('★P2 单击一格：表头不再是「列选中」强态', s.hdrStrong, 0, 1)
  disc('★P2 单击一格：表头只有 1 个「定位」弱态', s.hdrWeak, 1, 0)
  disc('★P2 单击一格：行号格有 1 个「定位」弱态', s.nrWeak, 1, 0)
  rel('★P2 一句话判据：高亮格数 == 选中格数 == 1', s.selArea === 1, s.selArea > 1, s.selArea)
  disc('P2 弱指示器落在**被点的那一列**（且不是强态）', c2.th_same_hd && !c2.th_same_sc, true, false)
  guard('P2 弱指示器**不**落在别的列', c2.th_other_hd || c2.th_other_sc, false)
  disc('P2 行号弱指示器落在**被点的那一行**', c2.nr_same, true, false)
  guard('P2 行号弱指示器**不**落在别的行', c2.nr_other, false)
  /* 🔴 对照物必须是**同一个元素的历史状态**（冷启动时的同一列表头），不能拿旁边的列当基准 ——
     首版拿 __th(CC+3) 比：若 CC 落在冻结列上，差异来自 .frozen 的 1px 边线而不是弱指示器 ⇒ 恒真。 */
  afterOnly('P2 弱指示器与**该列表头自身**的冷启动态有视觉差异（不是隐形）', c2.sig_th_cc !== sigColdCC, true)
  /* 🔴 新增独立通道「有效绘制色」：与「用 background 还是 background-image 实现」无关。
     它回答的是用户真正关心的问题 —— **眼睛看得见吗**。属性读不到不代表看不见（首版假红），
     属性读到了也不代表看得见（可能是被覆盖的声明），所以这条必须独立存在。 */
  afterOnly('★P2 表头有效色**真的变了**（不是只挂了个类）', c2.eff_th_cc !== effColdCC, true)
  afterOnly('★P2 行号格有效色**真的变了**（不是只挂了个类）', c2.eff_nr_cr !== effColdNR, true)

  /* ============ P3 ★核心：单元格矩形拖选（跨行跨列） ============ */
  await p.eval('window.__reset()'); await sleep(400)
  const R0 = 3, R1 = 6, C0 = IC[0], C1 = IC[Math.min(2, IC.length - 1)]
  const wantArea = (R1 - R0 + 1) * (C1 - C0 + 1)
  await p.eval('window.__drag(window.__td(' + R0 + ',' + C0 + '), window.__td(' + R1 + ',' + C1 + '))'); await sleep(500)
  s = await snap(p, 'P3_cell_drag')
  await shot(p, 'P3-rect-drag')
  console.log('  [P3] 拖选 ' + R0 + '..' + R1 + ' 行 × 列 ' + C0 + '..' + C1 + ' ⇒ 期望面积 ' + wantArea)
  rec('P3 前置：矩形拖选进入的是**单元格轴**', s.rowStrong === 0, 'rowStrong=0', s.rowStrong)
  guard('P3 矩形拖选：矩形内有底（' + wantArea + ' 格）', s.rangeCells, wantArea)
  disc('★P3 矩形拖选：矩形外**不**点亮整列', s.colOverlay, 0, s.rowTotal)
  rel('★P3 矩形拖选：矩形外**不**点亮整行', s.extraCyan === 0, s.extraCyan > 0, s.extraCyan)
  rel('★P3 一句话判据：高亮格数 == 选区格数（' + wantArea + '）', s.selArea === wantArea, s.selArea > wantArea, s.selArea)
  disc('P3 表头弱指示器覆盖矩形跨的 ' + (C1 - C0 + 1) + ' 列', s.hdrWeak, C1 - C0 + 1, 0)
  disc('P3 行号弱指示器覆盖矩形跨的 ' + (R1 - R0 + 1) + ' 行', s.nrWeak, R1 - R0 + 1, 0)

  /* ============ P4 ★核心：点列头（列轴） ============ */
  await p.eval('window.__reset()'); await sleep(400)
  await p.eval('window.__click(window.__th(' + CC + '))'); await sleep(500)
  s = await snap(p, 'P4_col_click')
  const c4 = await probe(p, '{' +
    'th2_sc: window.__hasCls(window.__th(' + CC + '),"sel-col"),' +
    'th2_hd: window.__hasCls(window.__th(' + CC + '),"cur-col-hd"),' +
    'th5_sc: window.__hasCls(window.__th(' + (CC + 3) + '),"sel-col"),' +
    'th5_hd: window.__hasCls(window.__th(' + (CC + 3) + '),"cur-col-hd"),' +
    'colRatio2: window.__colRatio(' + CC + '),' +
    'nrWeakAny: window.__tbl().querySelectorAll("tbody tr.cur-row-hd > td.seq-cell").length,' +
    'sig_strong: window.__sig(window.__tbl().querySelector("thead th.sel-col"))' +
    '}')
  console.log('  [P4 classes] ' + JSON.stringify(c4))
  await shot(p, 'P4-col-click')
  guard('P4 点列头：被点的那一列全高覆盖（比例 = 1）', c4.colRatio2, 1)
  guard('P4 点列头：表头强态恰好 1 个', s.hdrStrong, 1)
  guard('P4 点列头：强态落在被点的列', c4.th2_sc, true)
  guard('P4 点列头：被点的列**不**再叠弱态（强取代弱，不叠加）', c4.th2_hd, false)
  guard('P4 点列头：别的列表头不跟着亮', c4.th5_sc || c4.th5_hd, false)
  rel('★P4 点列头：**选的是列，就不许有行被点亮**（基线外新增青底）', s.extraCyan === 0, s.extraCyan > 0, s.extraCyan)
  guard('★P4 点列头：行号格**不**出现定位弱指示（Excel 同款：选列不动行号）', c4.nrWeakAny, 0)
  guard('P4 点列头：行号格不出现强态', s.nrStrong, 0)
  /* 列轴下「整列就是选区」⇒ 高亮格数两侧都该 == 整列格数（旧实现的假行带由 extraCyan 单独抓） */
  guard('★P4 一句话判据：高亮格数 == 整列格数', s.selArea, s.rowTotal)
  afterOnly('P4 弱指示器（定位）与强态（列选中）**不是同一视觉**', c4.sig_strong !== c2.sig_th_cc, true)

  /* ============ P5 列轴 -> 单元格轴：强态必须**回落**为弱态，不留整列底 ============ */
  await p.eval('window.__click(window.__td(4,' + CC + '))'); await sleep(500)
  s = await snap(p, 'P5_col_to_cell')
  disc('★P5 切回单元格轴：整列底消失', s.colOverlay, 0, s.rowTotal)
  disc('★P5 切回单元格轴：表头强态清空', s.hdrStrong, 0, 1)
  disc('★P5 切回单元格轴：表头回落为 1 个弱态', s.hdrWeak, 1, 0)
  rel('★P5 切回单元格轴：高亮格数收敛为 1', s.selArea === 1, s.selArea > 1, s.selArea)

  /* ============ P6 点行号（行轴） ============ */
  await p.eval('window.__reset()'); await sleep(400)
  await p.eval('window.__click(window.__seq(3))'); await sleep(500)
  s = await snap(p, 'P6_row_click')
  const c6 = await probe(p, '{' +
    'rowSel: window.__rows()[3].classList.contains("row-sel"),' +
    'rowSelTds: window.__rows()[3].querySelectorAll("td").length,' +
    'hdrAny: window.__tbl().querySelectorAll("thead th.sel-col, thead th.cur-col-hd").length,' +
    'nrWeakAny: window.__tbl().querySelectorAll("tbody td.seq-cell.cur-row-hd").length' +
    '}')
  console.log('  [P6 classes] ' + JSON.stringify(c6))
  await shot(p, 'P6-row-click')
  guard('P6 点行号：整行进入强态', c6.rowSel, true)
  guard('P6 点行号：整行所有格都在选区内', s.rowStrong, c6.rowSelTds)
  guard('P6 点行号：行号格有强态（3px 竖条）', s.nrStrong, 1)
  guard('★P6 点行号：**选的是行，就不许有列被点亮**（列覆盖格数）', s.colOverlay, 0)
  guard('★P6 点行号：表头**零**高亮（弱定位也不许有）', c6.hdrAny, 0)
  guard('P6 点行号：行号格**不**再叠弱指示（避免弱强同时出现）', c6.nrWeakAny, 0)
  /* 🔴 首版把这条写成判别点（期望 BEFORE>0）⇒ 假红：行轴下整行**本来就**带 row-sel 通道，
     那 37 格被通道解释掉了 ⇒ extraCyan 两侧同为 0。这条是**护栏**。 */
  guard('★P6 点行号：没有「无通道解释」的青底（整行底由 row-sel 承担）', s.extraCyan, 0)

  /* ============ P7 深色模式：弱指示器必须仍然可测（不能隐形） ============
     四读数全部取自**同一个元素**（__th(CC)），两两比较只在「有无弱指示器」这一维上不同 ——
     首版拿旁边的列当基准，差异可能来自 .frozen 的 1px 边线（恒真判据）。 */
  await p.eval('window.__reset()'); await sleep(400)
  /* 节点侧亮度换算 —— 与页面内 __lum 同一公式，用于「方向」断言 */
  const lumOf = (rgb) => { if (!rgb) return null; const p = String(rgb).split(',').map(Number); return Math.round(0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) }
  const sigL0 = await p.eval('window.__sig(window.__th(' + CC + '))')
  const effL0 = await p.eval('window.__eff(window.__th(' + CC + '))')
  const nrEffL0 = await p.eval('window.__eff(window.__seq(2))')
  await p.eval('window.__click(window.__td(2,' + CC + '))'); await sleep(500)
  const sigL1 = await p.eval('window.__sig(window.__th(' + CC + '))')
  const effL1 = await p.eval('window.__eff(window.__th(' + CC + '))')
  const nrEffL1 = await p.eval('window.__eff(window.__seq(2))')
  const pL = await p.eval('getComputedStyle(document.documentElement).getPropertyValue("--p").trim()')
  await p.eval('window.__dark(true)'); await sleep(600)
  const sigD1 = await p.eval('window.__sig(window.__th(' + CC + '))')
  const effD1 = await p.eval('window.__eff(window.__th(' + CC + '))')
  const nrEffD1 = await p.eval('window.__eff(window.__seq(2))')
  const pD = await p.eval('getComputedStyle(document.documentElement).getPropertyValue("--p").trim()')
  await shot(p, 'P7-dark')
  await p.eval('window.__reset()'); await sleep(400)
  const sigD0 = await p.eval('window.__sig(window.__th(' + CC + '))')
  const effD0 = await p.eval('window.__eff(window.__th(' + CC + '))')
  const nrEffD0 = await p.eval('window.__eff(window.__seq(2))')
  await p.eval('window.__dark(false)'); await sleep(300)
  const darkApplied = pL !== pD
  console.log('  [P7] 浅色 表头 冷=' + JSON.stringify(sigL0) + '\n        选=' + JSON.stringify(sigL1))
  console.log('  [P7] 深色 表头 冷=' + JSON.stringify(sigD0) + '\n        选=' + JSON.stringify(sigD1))
  console.log('  [P7] 有效色 表头 浅冷=' + effL0 + ' 浅选=' + effL1 + ' 深冷=' + effD0 + ' 深选=' + effD1)
  console.log('  [P7] 有效色 行号 浅冷=' + nrEffL0 + ' 浅选=' + nrEffL1 + ' 深冷=' + nrEffD0 + ' 深选=' + nrEffD1)
  console.log('  [P7] 亮度 表头 浅冷=' + lumOf(effL0) + ' 浅选=' + lumOf(effL1) + ' 深冷=' + lumOf(effD0) + ' 深选=' + lumOf(effD1))
  console.log('  [P7] --p ' + pL + ' -> ' + pD + ' darkApplied=' + darkApplied)
  if (!darkApplied) { R.push({ name: 'P7 深色下弱指示器仍可辨', ok: true, skip: true, want: 'dark applied', got: 'dark 未生效（--p 未变）' }) }
  else { afterOnly('★P7 深色下弱指示器仍可辨（同一列表头：有/无指示器有差异）', sigD1 !== sigD0, true) }
  afterOnly('★P7 浅色下弱指示器可辨（同一列表头：有/无指示器有差异）', sigL1 !== sigL0, true)
  /* 🔴 「不一样」还不够 —— 深色主题里叠一层**黑色**也叫不一样，但用户看不见。
     必须断言**方向**：浅色下更暗（浅灰压白底）、深色下更亮（浅灰压深底）。 */
  afterOnly('★P7 浅色下弱指示器朝**更暗**方向（浅灰压白底 = 看得见）', lumOf(effL1) < lumOf(effL0), true)
  afterOnly('★P7 深色下弱指示器朝**更亮**方向（浅灰压深底 = 看得见）', darkApplied ? lumOf(effD1) > lumOf(effD0) : true, true)
  afterOnly('★P7 行号格弱指示器浅色也可辨', nrEffL1 !== nrEffL0, true)
  afterOnly('★P7 行号格弱指示器深色朝更亮方向', darkApplied ? lumOf(nrEffD1) > lumOf(nrEffD0) : true, true)
  guard('P7 dark 开关自证（--p 确实变了）', darkApplied, true)

  /* ============ P8 收尾全表扫描 ============ */
  await p.eval('window.__reset()'); await sleep(400)
  s = await snap(p, 'P8_final_sweep')
  guard('P8 全表扫描：无通道解释的青底 = 0', s.extraCyan, 0)
  guard('P8 全表扫描：表头强/弱态不同时出现', (s.hdrStrong > 0 && s.hdrWeak > 0) ? 'both' : 'ok', 'ok')
  guard('P8 全表扫描：基线青底格未被抹掉（合计列仍是设计态）', s.lostBase, 0)

  /* ---- v378 零写入取证（**生产上跑的硬门槛**）----
     本探针会点「改单」进编辑态 + 在格子上拖选，必须能证明「一次业务写请求都没发出」。
     ⚠️ 只把「业务写」判红（保存/落库/导入/关闭/删除类）；登录态自检等非业务 POST 仅记录不判红。 */
  const WRITE_RISK = /save|matrix|bulk|upsert|import|execute|close|delete|create|submit|update/i
  const writes = JSON.parse(await p.eval('JSON.stringify(window.__WRITES || [])'))
  const armed = await p.eval('Array.isArray(window.__WRITES)')
  const risky = writes.filter(function (w) { return WRITE_RISK.test(w) })
  console.log('[' + LABEL + '] 零写入取证：监控已安装=' + armed + '  非 GET 的 /api/ 请求(' + writes.length + ') = ' + JSON.stringify(writes))
  guard('P9 写监控已安装（缺它本判据恒真）', armed, true)
  rec('★P9 零写入：全程未发出任何业务写请求（保存/落库/导入/关闭/删除类）', risky.length === 0, '0 条', risky)

  if (p.errors && p.errors.length) console.log('[' + LABEL + '] 页面报错(' + p.errors.length + '): ' + JSON.stringify(p.errors.slice(0, 5)))
  else console.log('[' + LABEL + '] 页面报错: 0')

  console.log('[' + LABEL + '] 关键信号 = ' + JSON.stringify({
    cellClick: snaps.P2b_cell_click && { sel: snaps.P2b_cell_click.selArea, col: snaps.P2b_cell_click.colOverlay, extra: snaps.P2b_cell_click.extraCyan, hs: snaps.P2b_cell_click.hdrStrong, hw: snaps.P2b_cell_click.hdrWeak, nrw: snaps.P2b_cell_click.nrWeak },
    rectDrag: snaps.P3_cell_drag && { sel: snaps.P3_cell_drag.selArea, rect: snaps.P3_cell_drag.rangeCells, col: snaps.P3_cell_drag.colOverlay, extra: snaps.P3_cell_drag.extraCyan, hw: snaps.P3_cell_drag.hdrWeak, nrw: snaps.P3_cell_drag.nrWeak },
    colClick: snaps.P4_col_click && { sel: snaps.P4_col_click.selArea, col: snaps.P4_col_click.colOverlay, extra: snaps.P4_col_click.extraCyan, hs: snaps.P4_col_click.hdrStrong, hw: snaps.P4_col_click.hdrWeak },
    rowClick: snaps.P6_row_click && { row: snaps.P6_row_click.rowStrong, extra: snaps.P6_row_click.extraCyan, col: snaps.P6_row_click.colOverlay, nrw: snaps.P6_row_click.nrWeak },
    baseline: { baseN: baseN, rowTotal: snaps.P1_cold_no_sel.rowTotal, cellCols: IC }
  }))

  const fail = R.filter(x => !x.ok)
  const skipped = R.filter(x => x.skip)
  const judged = R.length - skipped.length
  console.log('[' + LABEL + '] 断言 ' + (judged - fail.length) + '/' + judged + ' 通过' + (skipped.length ? '（另有 ' + skipped.length + ' 项侧不可达，跳过）' : ''))
  fs.writeFileSync('/tmp/v378-probe-' + LABEL + '.json', JSON.stringify({ label: LABEL, base: BASE, pass: judged - fail.length, total: judged, skipped: skipped.length, results: R, snaps }, null, 1))
  console.log('DUMP /tmp/v378-probe-' + LABEL + '.json')
  if (fail.length) { console.log('FAILED: ' + JSON.stringify(fail.map(x => x.name))); process.exit(1) }
} finally {
  if (browser) await browser.close()
}
