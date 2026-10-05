/* v377 真机 A/B 探针：预报汇总表编辑网格的「行选中 / 列选中」三轴交互。
 *
 * 用法：PROBE_PORT=5288 PROBE_LABEL=BEFORE node v377-rowcol-axis-probe.mjs
 *       PROBE_PORT=5289 PROBE_LABEL=AFTER  node v377-rowcol-axis-probe.mjs
 *
 * 设计要点（与 v376 探针同源，两处刻意不同）：
 *   ① 同一套交互序列跑两侧，**期望值按 LABEL 镜像** —— BEFORE 侧断言的正是「新特性不存在」，
 *      这才叫反例对照：不是「跑通了」，而是「同一动作在旧包上得到不同结果」。
 *   ② 每相开始先 Esc 复位到「无选区」，并断言复位成功 —— 否则上一相残留的选区会把下一相
 *      的读数污染成假绿（v362 已记过「探针读空 DOM 假红」的同族坑）。
 *
 * 观测口径全部走 DOM（class / aria / 菜单文案），不 import 页面内部状态：
 * 探针能证明的是「用户看得见的东西」，不是「我以为的状态对」。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const PORT = process.env.PROBE_PORT || '5289'
const LABEL = process.env.PROBE_LABEL || 'AFTER'
/* v377 上线后补：允许把 BASE 指到「已部署产物」的本地托管地址（PROBE_BASE），
   从而对**上线的那份产物字节**跑一次真机 —— 而不是只跑 dev 按需编译版。
   用法：PROBE_LABEL=AFTER PROBE_BASE=http://127.0.0.1:8877 node v377-rowcol-axis-probe.mjs */
const BASE = process.env.PROBE_BASE || ('http://127.0.0.1:' + PORT)
const TOK = fs.readFileSync(process.env.PROBE_TOKEN_FILE || '/tmp/v377-token.txt', 'utf8').trim()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
/* 🔴 等条件、不等固定时长（本轮踩过）：Vite 是**按需编译**的，`Forecast.vue` 编译后 ~5.2MB，
   服务器第一次收到该模块请求时要现场编译 13k 行 SFC —— 首跑远超 5.5s，于是「没进编辑态」
   被误读成「旧包没有这个功能」（假反例）。改成轮询 DOM 条件，两侧都公平。 */
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
window.__vrows = function () { return window.__rows().filter(function (tr) { return tr.style.display !== 'none' }) }
window.__hrows = function () { return window.__rows().filter(function (tr) { return tr.style.display === 'none' }) }
window.__td = function (ri, ci) { return window.__tbl().querySelector('tbody td[data-r="' + ri + '"][data-c="' + ci + '"]') }
window.__seq = function (ri) { return window.__rows()[ri].querySelector('td.seq-cell') }
window.__ths = function () {
  var t = window.__tbl()
  if (!t) return []
  var all = [].slice.call(t.querySelectorAll('thead th'))
  return all.filter(function (x) { return !x.classList.contains('seq-th') && !x.classList.contains('op-th') })
}
window.__th = function (ci) { return window.__ths()[ci] }
/* 🔴 探针自坑（本轮踩过）：thSelColIdx 是在**全部** thead th 上算的（序号列是第 0 个），
   而 __th(k) 是**去掉序号列/操作列后**的第 k 个 ⇒ 两者差一个基数。
   手写 +1 会写漂，改成把「期望的全表下标」也由同一函数算出来，判据与元素同源。
   ⚠️ 本块整体位于模板字符串内 ⇒ 注释里禁止出现反引号。 */
window.__thAllIdx = function (ci) {
  var all = [].slice.call(window.__tbl().querySelectorAll('thead th'))
  return all.indexOf(window.__th(ci))
}
/* 事件派发：几何用 getBoundingClientRect 真值，避免 clientX 为 0 导致 ctx 菜单定位到 (0,0) */
window.__ev = function (el, type, opt) {
  var r = el.getBoundingClientRect()
  var o = { bubbles: true, cancelable: true, clientX: Math.round(r.left + (r.width || 20) / 2), clientY: Math.round(r.top + (r.height || 16) / 2) }
  if (opt) for (var k in opt) o[k] = opt[k]
  el.dispatchEvent(new MouseEvent(type, o))
  return 1
}
window.__md = function (el) { return window.__ev(el, 'mousedown', { button: 0, buttons: 1 }) }
window.__mo = function (el) { return window.__ev(el, 'mouseover', { button: 0, buttons: 0 }) }
window.__cm = function (el) { return window.__ev(el, 'contextmenu', { button: 2, buttons: 2 }) }
window.__mup = function () { document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 })); return 1 }
window.__wblur = function () { window.dispatchEvent(new Event('blur')); return 1 }
window.__key = function (el, k) { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: k })); return 1 }
/* Esc 复位：第一下退输入态、第二下清选区+轴。派发在表格本体上（@keydown 绑在 table） */
window.__reset = function () {
  var t = window.__tbl()
  if (t) { window.__key(t, 'Escape'); window.__key(t, 'Escape'); window.__key(t, 'Escape') }
  return 1
}
window.__txt = function (el) { return el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : null }
/* 单次读数：一次把本相需要看的量全读走 */
window.__read = function (tag) {
  var t = window.__tbl()
  if (!t) return { tag: tag, err: 'no-table' }
  var ths = [].slice.call(t.querySelectorAll('thead th'))
  var trs = window.__rows()
  var menu = document.querySelector('.ctx-menu')
  var btns = menu ? [].slice.call(menu.querySelectorAll('button')).map(function (b) { return window.__txt(b) }) : []
  var pending = []
  for (var i = 0; i < btns.length; i++) {
    // 菜单按钮文本里带 <kbd> 提示（Ctrl+Enter 等），去掉尾部提示是**子串匹配**，不做相等
    void i
  }
  var stat = document.querySelector('.sel-stat')
  var backBtns = [].slice.call(document.querySelectorAll('button')).filter(function (b) {
    return /放弃自上次保存/.test(b.getAttribute('title') || '')
  })
  return {
    tag: tag,
    tabIndex: t.tabIndex,
    /* 🔴 「table.tabIndex「 对**不可聚焦**的元素也返回 -1（HTML 规范：没有该属性且不可聚焦 ⇒ -1）
       ⇒ 拿它当「v377 加了 tabindex」的判据对两侧都是 -1，是个**恒真的假判据**。
       判别点必须看**属性在不在**。 */
    tabAttr: t.getAttribute('tabindex'),
    thSelCol: ths.filter(function (x) { return x.classList.contains('sel-col') }).length,
    thSelColIdx: ths.map(function (x, i) { return x.classList.contains('sel-col') ? i : -1 }).filter(function (i) { return i >= 0 }),
    tdSelCol: t.querySelectorAll('tbody td.sel-col').length,
    tdRangeSel: t.querySelectorAll('tbody td.range-sel').length,
    tdSelected: t.querySelectorAll('tbody td.selected').length,
    rowSel: trs.filter(function (x) { return x.classList.contains('row-sel') }).length,
    rowSelAria: trs.filter(function (x) { return x.getAttribute('aria-selected') === 'true' }).length,
    rowSelIdx: trs.map(function (x, i) { return x.classList.contains('row-sel') ? i : -1 }).filter(function (i) { return i >= 0 }),
    rowAriaIdx: trs.map(function (x, i) { return x.getAttribute('aria-selected') === 'true' ? i : -1 }).filter(function (i) { return i >= 0 }),
    rowTotal: trs.length,
    rowVisible: window.__vrows().length,
    rowHidden: window.__hrows().length,
    fillHandle: t.querySelectorAll('.fill-handle').length,
    menuOpen: !!menu,
    menuNote: menu ? window.__txt(menu.querySelector('.ctx-note')) : null,
    menuBtnCount: btns.length,
    menuBtnJoined: btns.join(' | '),
    statLabel: window.__txt(document.querySelector('.sel-stat-label')),
    statText: window.__txt(stat),
    backEnabled: backBtns.some(function (b) { return !b.disabled }),
    backCount: backBtns.length,
  }
}
/* 筛选：找一个「能部分命中、且能围出一个含隐藏行的区间」的关键词。
   🔴 两个坑都踩过：
      ① 候选词必须从 name 格 input.value 取（编辑态商品名是 input，value 不进 textContent）；
      ② **必须等一拍再读 DOM** —— Vue 的 DOM 更新在 microtask 里 flush，dispatch('input') 之后
         同步读 「__vrows()「 拿到的永远是旧 DOM（表现为「筛选没生效」，实为探针读早了；
         与 v362 记录过的「触发 toast 后必须等一拍」同一族）。故本函数是 async。
   返回的 hiddenAt 一律落在**当前页内**（见 __spanWithHidden）—— 否则「隐藏」可能只是分页
   把第二页藏起来了，而真实拖拽根本够不到那些行，测出来的东西不算数。 */
window.__tryFilter = async function () {
  var inp = document.getElementById('gridFind')
  if (!inp) return null
  var rows = window.__rows()
  var cands = []
  for (var i = 0; i < Math.min(rows.length, 16); i++) {
    var cell = rows[i].querySelector('td[data-c="0"]')
    var box = cell ? cell.querySelector('input') : null
    var s = box ? (box.value || '').trim() : (cell ? (cell.textContent || '').trim() : '')
    if (!s) continue
    cands.push(s)
    if (s.length > 6) cands.push(s.slice(0, 6))
    if (s.length > 4) cands.push(s.slice(0, 4))
    if (s.length > 3) cands.push(s.slice(0, 3))
    if (s.length > 2) cands.push(s.slice(0, 2))
  }
  for (var k = 0; k < cands.length; k++) {
    inp.value = cands[k]
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(function (r) { setTimeout(r, 260) })
    var v = window.__vrows().length
    if (v <= 0 || v >= rows.length) continue
    var span = window.__spanWithHidden()
    if (span) return { keyword: cands[k], visible: v, total: rows.length, hidden: rows.length - v, span: span }
  }
  inp.value = ''
  inp.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(function (r) { setTimeout(r, 260) })
  return null
}
/* 找一段「两端可见、中间夹着隐藏行」的行区间，且**隐藏行必须落在当前页内** ——
   行区间是行号连续的（与矩形选区同语义），所以可以跨过看不见的行；这里是唯一能
   在真机上造出「区间里有行被藏起来」又不掺分页噪声的办法。 */
window.__spanWithHidden = function () {
  var rows = window.__rows()
  if (!rows.length) return null
  /* 当前页的 50 行（编辑态默认分页）—— 只在这一段里找，隐藏行才是**筛选**藏起来的 */
  var pageRows = Math.min(rows.length, 50)
  var vis = [], hid = []
  for (var i = 0; i < pageRows; i++) (rows[i].style.display === 'none' ? hid : vis).push(i)
  if (!hid.length || vis.length < 2) return null
  for (var j = 0; j < hid.length; j++) {
    var h = hid[j], lo = null, hi = null
    for (var m = 0; m < vis.length; m++) {
      if (vis[m] < h) lo = vis[m]
      if (vis[m] > h && hi === null) hi = vis[m]
    }
    if (lo !== null && hi !== null) return { lo: lo, hi: hi, hiddenAt: h, visibleInPage: vis.length, hiddenInPage: hid.length }
  }
  return null
}
1`

const R = []
let browser = null
const isAFTER = LABEL === 'AFTER'
const rec = (name, got, want, ok) => {
  R.push({ name, got, want, ok: !!ok })
  console.log((ok ? '  PASS ' : '  FAIL ') + name + ' | got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))
}
/* 🔴 期望语义必须**显式区分**（本轮踩过）：一开始全用「AFTER 要有 / BEFORE 要没有」一种写法，
   于是把三类根本不是判别点的断言也塞了进去 —— 「表头右键弹出菜单」在两侧都该为真、
   「按方向键后行选中归零」在 BEFORE 侧是**恒真**（旧包压根没有行轴）、
   而「列高亮」在 BEFORE 侧的正确值是 1（旧的「当前列」淡高亮）**不是 0**。
   混用会让对照结果看起来像一堆失败，实则是判据写错。四种语义各司其职：
     exists   —— 判别点：AFTER 有、BEFORE 无
     always   —— 护栏：两侧都必须成立（含「不该出现的东西两侧都不该出现」）
     afterOnly—— BEFORE 侧场景不可达（无行/列轴 ⇒ 造不出来），只算 AFTER 的分，BEFORE 侧记 SKIP
     eq/eqSide—— 定值 / 两侧各一个期望值 */
const exists = (name, got) => rec(name, got, isAFTER ? true : false, isAFTER ? !!got : !got)
const always = (name, got) => rec(name, got, true, !!got)
const afterOnly = (name, got) => {
  if (!isAFTER) { R.push({ name, got, want: '(BEFORE 不可达·跳过)', ok: true, skip: true }); console.log('  SKIP ' + name + ' | got=' + JSON.stringify(got) + ' （BEFORE 侧场景不可达）'); return }
  rec(name, got, true, !!got)
}
const eq = (name, got, want) => rec(name, got, want, got === want)
const eqSide = (name, got, after, before) => {
  const want = isAFTER ? after : before
  rec(name, got, want, JSON.stringify(got) === JSON.stringify(want))
}

const snaps = {}
const snap = async (p, tag) => { const v = JSON.parse(await p.eval('JSON.stringify(window.__read(' + JSON.stringify(tag) + '))')); snaps[tag] = v; return v }

try {
  browser = await launch()
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(
    "localStorage.setItem('hergent_v2_token', " + JSON.stringify(TOK) + ");" +
    "localStorage.setItem('hergent_v2_tenant', '1');"
  )
  await p.goto(BASE + '/#/forecast', 9000)
  const url = await p.eval('location.href')
  console.log('[' + LABEL + '] url = ' + url)
  if (/#\/login/.test(url)) { console.log('NOT_LOGGED_IN'); process.exit(2) }

  const tChunk = await waitFor(p, 'document.querySelector("table.cross-tbl, table.edit-tbl")', 90000, '预报页 chunk 编译并挂载')
  console.log('[' + LABEL + '] 首屏 chunk 就绪 = ' + tChunk + 'ms')
  const tBtn = await waitFor(p, '[].slice.call(document.querySelectorAll("button")).some(function(b){return (b.textContent||"").trim()==="改单"})', 60000, '改单按钮出现')
  console.log('[' + LABEL + '] 改单按钮就绪 = ' + tBtn + 'ms')

  const clicked = await p.eval('(function(){var bs=[].slice.call(document.querySelectorAll("button"));var b=bs.filter(function(x){return (x.textContent||"").trim()==="改单"})[0];if(b){b.click();return 1}return 0})()')
  await sleep(1200)
  const tEdit = await waitFor(p, 'document.querySelector("table.edit-tbl thead th")', 90000, '编辑网格出现（改单后）')
  console.log('[' + LABEL + '] 编辑网格就绪 = ' + tEdit + 'ms')
  await p.eval(HELPERS)
  const geo = JSON.parse(await p.eval('JSON.stringify({rows:window.__rows().length,ths:window.__ths().length,vis:window.__vrows().length,tabIndex:window.__tbl()?window.__tbl().tabIndex:null})'))
  console.log('[' + LABEL + '] 网格几何 = ' + JSON.stringify(geo))
  rec('改单按钮命中并进入编辑态', clicked === 1, 1, clicked === 1)
  rec('网格有行有列（探针有判别力）', geo.rows > 8 && geo.ths > 3, 'rows>8 && ths>3', geo.rows > 8 && geo.ths > 3)

  /* ============ S0 基线：复位后应「零选区」 ============ */
  await p.eval('window.__reset()'); await sleep(400)
  let s = await snap(p, 'S0_baseline')
  eq('S0 复位后行选中 = 0', s.rowSel, 0)
  eq('S0 复位后 th 高亮 = 0', s.thSelCol, 0)
  rec('S0 编辑网格可聚焦（tabindex="-1"，v377 新增）', s.tabAttr, isAFTER ? '-1' : '≠-1', isAFTER ? s.tabAttr === '-1' : s.tabAttr !== '-1')

  /* ============ S1 表体单击「非输入区」 ⇒ 整行 ============ */
  await p.eval('window.__reset()'); await sleep(300)
  await p.eval('window.__md(window.__td(2, 0))'); await sleep(500)
  s = await snap(p, 'S1_row_click')
  console.log('[' + LABEL + '] S1 = ' + JSON.stringify({ rowSel: s.rowSel, rowSelIdx: s.rowSelIdx, rowAria: s.rowAriaIdx, thSelCol: s.thSelCol, fill: s.fillHandle, stat: s.statLabel }))
  exists('S1 单击非输入格 ⇒ 整行高亮（tr.row-sel）', s.rowSel === 1)
  exists('S1 该行带 aria-selected=true', s.rowAriaIdx.length === 1 && s.rowAriaIdx[0] === 2)
  exists('S1 统计条认出「行选中」', s.statLabel === '行选中')
  eqSide('S1 行轴下无列高亮（互斥：不存在「行+列同时选中」）', s.thSelCol, 0, 1)

  /* ============ S2 向下拖动 ⇒ 连续多行 ============ */
  await p.eval('window.__reset()'); await sleep(300)
  await p.eval('window.__md(window.__seq(1))'); await sleep(200)
  await p.eval('window.__mo(window.__seq(2))'); await sleep(120)
  await p.eval('window.__mo(window.__seq(3))'); await sleep(120)
  await p.eval('window.__mo(window.__seq(4))'); await sleep(200)
  await p.eval('window.__mup()'); await sleep(400)
  s = await snap(p, 'S2_row_drag_down')
  console.log('[' + LABEL + '] S2 = ' + JSON.stringify({ rowSel: s.rowSel, rowSelIdx: s.rowSelIdx, stat: s.statText }))
  exists('S2 向下拖选 ⇒ 连续 4 行', s.rowSel === 4)
  eqSide('S2 行区间 = 1..4', JSON.stringify(s.rowSelIdx), JSON.stringify([1, 2, 3, 4]), JSON.stringify([]))
  eqSide('S2 行轴下无列高亮', s.thSelCol, 0, 1)
  await p.screenshot('/tmp/v377-' + LABEL + '-rowsel.png')

  /* ============ S3 反向（向上）拖动 ⇒ 区间取并集两端 ============ */
  await p.eval('window.__reset()'); await sleep(300)
  await p.eval('window.__md(window.__seq(6))'); await sleep(200)
  await p.eval('window.__mo(window.__seq(5))'); await sleep(120)
  await p.eval('window.__mo(window.__seq(4))'); await sleep(200)
  await p.eval('window.__mup()'); await sleep(400)
  s = await snap(p, 'S3_row_drag_up')
  eqSide('S3 向上拖选 ⇒ 4..6 共 3 行', JSON.stringify(s.rowSelIdx), JSON.stringify([4, 5, 6]), JSON.stringify([]))
  exists('S3 反向拖动成立（3 行）', s.rowSel === 3)

  /* ============ S4 行上右键 ⇒ 行菜单 ============ */
  await p.eval('window.__md(window.__seq(4))'); await sleep(200)
  await p.eval('window.__mo(window.__seq(6))'); await sleep(200)
  await p.eval('window.__mup()'); await sleep(300)
  await p.eval('window.__cm(window.__td(5, 1))'); await sleep(500)
  s = await snap(p, 'S4_row_ctx')
  console.log('[' + LABEL + '] S4 note=' + JSON.stringify(s.menuNote) + ' btns=' + JSON.stringify(s.menuBtnJoined.slice(0, 200)))
  always('S4 行上右键弹出菜单', s.menuOpen)
  exists('S4 菜单头写「行选中 N 行」', !!s.menuNote && /^行选中 \d+ 行/.test(s.menuNote))
  exists('S4 菜单含「复制选中行（TSV）」', s.menuBtnJoined.indexOf('复制选中行') >= 0)
  exists('S4 菜单含「清空选中行」', s.menuBtnJoined.indexOf('清空选中行') >= 0)
  exists('S4 菜单含「删除选中行（3 行）」', /删除选中行（3 行）/.test(s.menuBtnJoined))
  exists('S4 菜单含「全选所有行」「取消行选中」', s.menuBtnJoined.indexOf('全选所有行') >= 0 && s.menuBtnJoined.indexOf('取消行选中') >= 0)
  /* 这条是**判别点**不是护栏：BEFORE 的表体右键走旧的单元格菜单，里面**恰好有**「全选编辑区域」 */
  exists('S4 行菜单不再混入单元格轴入口（无「全选编辑区域」）', s.menuBtnJoined.indexOf('全选编辑区域') < 0)
  await p.screenshot('/tmp/v377-' + LABEL + '-rowctx.png')
  await p.eval('window.__reset()'); await sleep(300)

  /* ============ S5 表头单击 ⇒ 整列 ============ */
  const thAll2 = await p.eval('window.__thAllIdx(2)')
  await p.eval('window.__md(window.__th(2))'); await sleep(200)
  await p.eval('window.__mup()'); await sleep(500)
  s = await snap(p, 'S5_col_click')
  console.log('[' + LABEL + '] S5 = ' + JSON.stringify({ thSelCol: s.thSelCol, thSelColIdx: s.thSelColIdx, expectIdx: thAll2, tdSelCol: s.tdSelCol, rowTotal: s.rowTotal, rowSel: s.rowSel, stat: s.statLabel }))
  exists('S5 单击表头 ⇒ 该列表头高亮', s.thSelColIdx.length === 1 && s.thSelColIdx[0] === thAll2)
  exists('S5 整列全高覆盖（td.sel-col = 行数）', s.tdSelCol === s.rowTotal && s.rowTotal > 0)
  eq('S5 列轴下行选中 = 0（互斥的另一半）', s.rowSel, 0)
  exists('S5 统计条认出「列选中」', s.statLabel === '列选中')

  /* ============ S6 表头横向拖动 ⇒ 连续多列 ============ */
  await p.eval('window.__reset()'); await sleep(300)
  await p.eval('window.__md(window.__th(3))'); await sleep(200)
  await p.eval('window.__mo(window.__th(4))'); await sleep(120)
  await p.eval('window.__mo(window.__th(5))'); await sleep(200)
  await p.eval('window.__mup()'); await sleep(400)
  const exp345 = JSON.parse(await p.eval('JSON.stringify([3,4,5].map(function(k){return window.__thAllIdx(k)}))'))
  s = await snap(p, 'S6_col_drag')
  console.log('[' + LABEL + '] S6 = ' + JSON.stringify({ thSelCol: s.thSelCol, idx: s.thSelColIdx, expect: exp345, tdSelCol: s.tdSelCol, rows: s.rowTotal }))
  exists('S6 横向拖选 ⇒ 3 列表头高亮', s.thSelColIdx.length === 3 && JSON.stringify(s.thSelColIdx) === JSON.stringify(exp345))
  exists('S6 3 列全高覆盖', s.tdSelCol === 3 * s.rowTotal)
  eq('S6 列轴下行选中仍为 0', s.rowSel, 0)
  await p.screenshot('/tmp/v377-' + LABEL + '-colsel.png')

  /* ============ S7 表头右键（落在选区内）⇒ 列菜单「批量」块 ============ */
  await p.eval('window.__cm(window.__th(4))'); await sleep(500)
  s = await snap(p, 'S7_hdr_ctx_selected')
  console.log('[' + LABEL + '] S7 note=' + JSON.stringify(s.menuNote) + ' btns=' + JSON.stringify(s.menuBtnJoined.slice(0, 160)))
  always('S7 表头右键弹出菜单', s.menuOpen)
  exists('S7 菜单头写「列选中 3 列」', s.menuNote === '列选中 3 列')
  exists('S7 菜单含「复制选中列」「清空选中列」', s.menuBtnJoined.indexOf('复制选中列') >= 0 && s.menuBtnJoined.indexOf('清空选中列') >= 0)
  always('S7 已选中时不再出「选中整列」（负对照）', s.menuBtnJoined.indexOf('选中整列') < 0)
  await p.screenshot('/tmp/v377-' + LABEL + '-colctx.png')
  await p.eval('window.__reset()'); await sleep(300)

  /* ============ S8 未选中时表头右键 ⇒ 「选中整列」入口 ============ */
  await p.eval('window.__cm(window.__th(2))'); await sleep(500)
  s = await snap(p, 'S8_hdr_ctx_idle')
  console.log('[' + LABEL + '] S8 note=' + JSON.stringify(s.menuNote) + ' btns=' + JSON.stringify(s.menuBtnJoined.slice(0, 160)))
  always('S8 未选中时表头右键仍出菜单', s.menuOpen)
  exists('S8 菜单给「选中整列」入口', s.menuBtnJoined.indexOf('选中整列') >= 0)
  always('S8 未选中时菜单不谎报列选中', !/^列选中/.test(s.menuNote || ''))
  /* 点它应当真选中整列（「菜单里说得出来」与「点了真生效」必须一致） */
  await p.eval('(function(){var bs=[].slice.call(document.querySelectorAll(".ctx-menu button"));var b=bs.filter(function(x){return (x.textContent||"").indexOf("选中整列")>=0})[0];if(b){b.click();return 1}return 0})()')
  await sleep(500)
  s = await snap(p, 'S8b_after_sel_col_click')
  exists('S8b 菜单点「选中整列」⇒ 真选中（菜单不撒谎）', s.thSelColIdx.length === 1 && s.thSelColIdx[0] === thAll2)
  await p.eval('window.__reset()'); await sleep(300)

  /* ============ S9 表体右键（落在已选列内）⇒ 也走列菜单 ============ */
  await p.eval('window.__md(window.__th(1))'); await sleep(200); await p.eval('window.__mup()'); await sleep(400)
  await p.eval('window.__cm(window.__td(3, 1))'); await sleep(500)
  s = await snap(p, 'S9_body_ctx_in_col')
  console.log('[' + LABEL + '] S9 note=' + JSON.stringify(s.menuNote) + ' btns=' + JSON.stringify(s.menuBtnJoined.slice(0, 140)))
  exists('S9 选中列后表体右键 ⇒ 走列菜单', s.menuNote === '列选中 1 列')
  exists('S9 表体右键列菜单含「复制选中列」', s.menuBtnJoined.indexOf('复制选中列') >= 0)
  await p.eval('window.__reset()'); await sleep(300)

  /* ============ S10 表体右键（未选中列）⇒ 行菜单（Excel 心智：右键哪行管哪行） ============ */
  await p.eval('window.__cm(window.__td(7, 1))'); await sleep(500)
  s = await snap(p, 'S10_body_ctx_plain')
  console.log('[' + LABEL + '] S10 note=' + JSON.stringify(s.menuNote))
  exists('S10 表体右键（无列选中）⇒ 行菜单且只认 1 行', s.menuNote === '行选中 1 行')
  eqSide('S10 右键行号与落点一致（第 8 行）', JSON.stringify(s.rowSelIdx), JSON.stringify([7]), JSON.stringify([]))
  await p.eval('window.__reset()'); await sleep(300)

  /* ============ S11 边界：与单元格编辑输入态的冲突 ============ */
  /* 先在数量格里造一次真实编辑（input + change），再点行号切到行轴 —— 编辑不得丢失 */
  const qtySel = 'window.__tbl().querySelector("tbody td.qty-cell input.cell-qty, tbody td.qty-cell input.cell-input")'
  const edited = JSON.parse(await p.eval('JSON.stringify((function(){var i=' + qtySel + ';if(!i)return {ok:false};i.focus();var old=i.value;i.value=String((parseInt(old)||0)+7);i.dispatchEvent(new Event("input",{bubbles:true}));i.dispatchEvent(new Event("change",{bubbles:true}));return {ok:true,old:old,neu:i.value}})())'))
  await sleep(500)
  s = await snap(p, 'S11a_after_edit')
  console.log('[' + LABEL + '] S11a edit=' + JSON.stringify(edited) + ' backEnabled=' + s.backEnabled)
  rec('S11a 造出一次真实编辑（输入框可写）', edited.ok, true, edited.ok === true)
  rec('S11a 编辑点亮「有未保存的改动」', s.backEnabled, true, s.backEnabled === true)
  /* 关键动作：点行号格（行轴）—— 轴 mousedown 会 preventDefault，若无 commitPendingEdit 则 change 永不触发 */
  await p.eval('window.__md(window.__seq(0))'); await sleep(500)
  s = await snap(p, 'S11b_after_row_axis')
  console.log('[' + LABEL + '] S11b rowSel=' + s.rowSel + ' backEnabled=' + s.backEnabled + ' val=' + await p.eval('(' + qtySel + ').value'))
  rec('S11b 点行号 ⇒ 进入行轴', s.rowSel === 1, 1, isAFTER ? s.rowSel === 1 : s.rowSel === 0)
  rec('S11b 切轴没有吞掉刚才的编辑（脏标记仍在）', s.backEnabled, true, s.backEnabled === true)
  const kept = await p.eval('(' + qtySel + ').value')
  rec('S11b 编辑后的值仍在格内（未被回滚）', kept !== edited.old, '≠' + edited.old, kept !== edited.old)

  /* ============ S12 边界：行轴拖动经过输入格 ⇒ 不许变形成矩形选区 ============ */
  await p.eval('window.__reset()'); await sleep(300)
  await p.eval('window.__md(window.__seq(1))'); await sleep(200)
  await p.eval('window.__mo(window.__tbl().querySelector(\'tbody td.qty-cell[data-r="2"]\'))'); await sleep(250)
  await p.eval('window.__mo(window.__seq(3))'); await sleep(250)
  await p.eval('window.__mup()'); await sleep(400)
  s = await snap(p, 'S12_row_drag_over_input')
  console.log('[' + LABEL + '] S12 = ' + JSON.stringify({ rowSel: s.rowSel, idx: s.rowSelIdx, thSelCol: s.thSelCol, tdSelected: s.tdSelected }))
  exists('S12 行轴拖过输入格 ⇒ 仍为行轴（3 行）', s.rowSel === 3)
  eq('S12 未被改写成矩形（无列高亮）', s.thSelCol, 0)

  /* ============ S13 边界：拖动中途窗口失焦 ⇒ 拖拽必须收尾 ============ */
  await p.eval('window.__reset()'); await sleep(300)
  await p.eval('window.__md(window.__seq(1))'); await sleep(200)
  await p.eval('window.__mo(window.__seq(2))'); await sleep(200)
  await p.eval('window.__wblur()'); await sleep(250)
  await p.eval('window.__mo(window.__seq(6))'); await sleep(300)
  s = await snap(p, 'S13_blur_ends_drag')
  console.log('[' + LABEL + '] S13 = ' + JSON.stringify({ rowSel: s.rowSel, idx: s.rowSelIdx }))
  /* 收尾后不再跟随鼠标 —— 行数应停在失焦前（2 行）而不是继续涨到 6 行 */
  exists('S13 失焦即结束拖拽（不再跟随鼠标）', s.rowSel === 2)
  await p.eval('window.__mup()'); await sleep(200)
  await p.eval('window.__reset()'); await sleep(300)

  /* ============ S14 键盘：行轴下按方向键 ⇒ 回到单元格轴 ============ */
  await p.eval('window.__md(window.__seq(2))'); await sleep(200); await p.eval('window.__mup()'); await sleep(300)
  const beforeArrow = (await snap(p, 'S14a_row_axis')).rowSel
  await p.eval('window.__key(window.__tbl(), "ArrowDown")'); await sleep(500)
  s = await snap(p, 'S14b_after_arrow')
  console.log('[' + LABEL + '] S14 rowSelBefore=' + beforeArrow + ' afterRowSel=' + s.rowSel + ' tdSelected=' + s.tdSelected + ' fill=' + s.fillHandle)
  rec('S14 按方向键前处于行轴', beforeArrow === 1, 1, isAFTER ? beforeArrow === 1 : beforeArrow === 0)
  always('S14 方向键 ⇒ 行选中归零（键盘导航一律回单元格轴）', s.rowSel === 0)
  afterOnly('S14 单元格轴上选中格存在（填柄随之出现）', s.tdSelected >= 1 && s.fillHandle >= 1)

  /* ============ S15 键盘：列轴下按 Esc ⇒ 轴与选区一起复位 ============ */
  await p.eval('window.__reset()'); await sleep(300)
  await p.eval('window.__md(window.__th(2))'); await sleep(200); await p.eval('window.__mup()'); await sleep(400)
  const colOn = (await snap(p, 'S15a_col_axis'))
  rec('S15 Esc 前处于列轴', colOn.thSelColIdx.length === 1, isAFTER ? 1 : 0, isAFTER ? colOn.thSelColIdx.length === 1 : colOn.thSelColIdx.length === 0)
  await p.eval('window.__key(window.__tbl(), "Escape")'); await sleep(200)
  await p.eval('window.__key(window.__tbl(), "Escape")'); await sleep(400)
  s = await snap(p, 'S15b_after_esc')
  always('S15 Esc ⇒ 列高亮清空（轴不留错位态）', s.thSelCol === 0 && s.tdSelCol === 0)
  eq('S15 Esc 后行选中亦为 0', s.rowSel, 0)

  /* ============ S16 边界：跨行区间内含「被筛选隐藏的行」 ============ */
  const flt = await p.eval('window.__tryFilter()')
  console.log('[' + LABEL + '] S16 筛选命中 = ' + JSON.stringify(flt))
  if (flt && flt.span) {
    const span = flt.span
    console.log('[' + LABEL + '] S16 区间 = ' + JSON.stringify(span) + ' 关键词=' + flt.keyword)
    await p.eval('window.__md(window.__seq(' + span.lo + '))'); await sleep(200)
    await p.eval('window.__mo(window.__seq(' + span.hi + '))'); await sleep(250)
    await p.eval('window.__mup()'); await sleep(400)
    const mid = await snap(p, 'S16a_span_with_hidden')
    console.log('[' + LABEL + '] S16a rowSel=' + mid.rowSel + ' idx=' + JSON.stringify(mid.rowSelIdx) + ' 区间=' + span.lo + '..' + span.hi)
    exists('S16 区间横跨被藏起来的行（真造出来了）', mid.rowSel === span.hi - span.lo + 1)
    await p.eval('window.__cm(window.__seq(' + span.hi + '))'); await sleep(500)
    s = await snap(p, 'S16_ctx_hidden_rows')
    console.log('[' + LABEL + '] S16 note=' + JSON.stringify(s.menuNote))
    exists('S16 行菜单点名「已被筛选隐藏」的行数（不静默操作看不见的行）', !!s.menuNote && /已被筛选隐藏/.test(s.menuNote))
    exists('S16 隐藏行数计入菜单抬头', !!s.menuNote && /行选中 \d+ 行/.test(s.menuNote))
    await p.screenshot('/tmp/v377-' + LABEL + '-ctx-hidden.png')
    await p.eval('(function(){var i=document.getElementById("gridFind");if(i){i.value="";i.dispatchEvent(new Event("input",{bubbles:true}))}return 1})()')
    await sleep(500)
  } else {
    console.log('  SKIP S16 该页数据找不到「能围出含隐藏行的区间」的筛选词 —— 隐藏行场景未覆盖（不谎报）')
  }
  await p.eval('window.__reset()'); await sleep(300)

  /* ============ S17 边界：分页模式下「全选所有行」—— 看不见的行必须按**真实原因**报 ============
     可达路径：行菜单里的「全选所有行」（v377 新增）→ 区间 0..末行，其中不在当前页的行
     既没被筛选、也没被删除，只是**在另一页**。菜单若笼统说「已被筛选隐藏」，
     用户会去翻一个根本没开的筛选器 —— 这正是「说了话但是假话」，比不说更坏。 */
  await p.eval('window.__cm(window.__td(2, 1))'); await sleep(400)
  const selAllClicked = await p.eval('(function(){var bs=[].slice.call(document.querySelectorAll(".ctx-menu button"));var b=bs.filter(function(x){return (x.textContent||"").indexOf("全选所有行")>=0})[0];if(b){b.click();return 1}return 0})()')
  await sleep(600)
  const allSel = await snap(p, 'S17a_select_all_rows')
  console.log('[' + LABEL + '] S17 全选所有行 clicked=' + selAllClicked + ' rowSel=' + allSel.rowSel + '/' + allSel.rowTotal + ' visible=' + allSel.rowVisible)
  exists('S17 菜单「全选所有行」真作用于所有行', allSel.rowSel === allSel.rowTotal && allSel.rowTotal > 0)
  await p.eval('window.__cm(window.__td(0, 1))'); await sleep(500)
  s = await snap(p, 'S17_ctx_all_rows')
  console.log('[' + LABEL + '] S17 note=' + JSON.stringify(s.menuNote))
  exists('S17 分页藏起来的行报成「不在当前页」（真话）', /不在当前页/.test(s.menuNote || ''))
  always('S17 不把「不在当前页」谎报成「已被筛选隐藏」', !/已被筛选隐藏/.test(s.menuNote || ''))
  await p.eval('window.__reset()'); await sleep(300)

  /* ============ 判别力自证：两侧必须在关键信号上不同 ============ */
  console.log('[' + LABEL + '] 关键信号 = ' + JSON.stringify({
    rowSelClick: snaps['S1_row_click'] && snaps['S1_row_click'].rowSel,
    thSelColClickHeader: snaps['S5_col_click'] && snaps['S5_col_click'].thSelCol,
    thSelColDrag: snaps['S6_col_drag'] && snaps['S6_col_drag'].thSelCol,
    rowMenu: snaps['S4_row_ctx'] && snaps['S4_row_ctx'].menuNote,
    hdrMenuSel: snaps['S7_hdr_ctx_selected'] && snaps['S7_hdr_ctx_selected'].menuNote,
    tabIndex: snaps['S0_baseline'] && snaps['S0_baseline'].tabIndex,
  }))

  if (p.errors && p.errors.length) console.log('[' + LABEL + '] 页面报错(' + p.errors.length + '): ' + JSON.stringify(p.errors.slice(0, 6)))
  else console.log('[' + LABEL + '] 页面报错: 0')

  const fail = R.filter(x => !x.ok)
  const skipped = R.filter(x => x.skip)
  const judged = R.length - skipped.length
  console.log('[' + LABEL + '] 断言 ' + (judged - fail.length) + '/' + judged + ' 通过' + (skipped.length ? '（另有 ' + skipped.length + ' 项 BEFORE 侧不可达，跳过）' : ''))
  fs.writeFileSync('/tmp/v377-probe-' + LABEL + '.json', JSON.stringify({ label: LABEL, port: PORT, pass: judged - fail.length, total: judged, skipped: skipped.length, results: R, snaps }, null, 1))
  console.log('DUMP /tmp/v377-probe-' + LABEL + '.json')
  if (fail.length) { console.log('FAILED: ' + JSON.stringify(fail.map(x => x.name))); process.exit(1) }
} finally {
  if (browser) await browser.close()
}
