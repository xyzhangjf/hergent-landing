import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const URL_BASE = process.env.PROBE_URL || 'http://127.0.0.1:5199'
const LABEL = process.env.PROBE_LABEL || 'v375'
const TOK = fs.readFileSync('/tmp/v375-token.txt', 'utf8').trim()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const INSTRUMENT =
  '(function(){' +
  '  window.__pc = 0; window.__nc = 0; window.__qc = 0;' +
  '  var _pi = window.parseInt;' +
  '  window.parseInt = function(){ window.__pc++; return _pi.apply(this, arguments) };' +
  '  var _nm = String.prototype.normalize;' +
  '  String.prototype.normalize = function(){ window.__nc++; return _nm.apply(this, arguments) };' +
  '  var _qs = document.querySelectorAll.bind(document);' +
  '  document.querySelectorAll = function(){ window.__qc++; return _qs.apply(document, arguments) };' +
  '})()'

const HELPERS =
  '(function(){' +
  '  if (window.__effBg) return 1;' +
  '  window.__effBg = function(el){' +
  '    var stack = [], n = el;' +
  '    while (n && n.nodeType === 1) {' +
  '      var bg = getComputedStyle(n).backgroundColor;' +
  '      if (bg && bg.indexOf("(") > -1) {' +
  '        var parts = bg.slice(bg.indexOf("(") + 1, bg.indexOf(")")).split(",").map(Number);' +
  '        var a = parts.length > 3 ? parts[3] : 1;' +
  '        if (a > 0) stack.push({ c: parts.slice(0, 3), a: a });' +
  '        if (a >= 1) break;' +
  '      }' +
  '      n = n.parentElement;' +
  '    }' +
  '    var r = 255, g = 255, b = 255;' +
  '    for (var i = stack.length - 1; i >= 0; i--) {' +
  '      var s = stack[i];' +
  '      r = s.c[0] * s.a + r * (1 - s.a); g = s.c[1] * s.a + g * (1 - s.a); b = s.c[2] * s.a + b * (1 - s.a);' +
  '    }' +
  '    return [Math.round(r), Math.round(g), Math.round(b)];' +
  '  };' +
  '  window.__lum = function(rgb){' +
  '    var f = function(v){ v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) };' +
  '    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);' +
  '  };' +
  '  window.__cr = function(a, b){' +
  '    var la = window.__lum(a), lb = window.__lum(b);' +
  '    var hi = Math.max(la, lb), lo = Math.min(la, lb);' +
  '    return (hi + 0.05) / (lo + 0.05);' +
  '  };' +
  '  return 1;' +
  '})()'

const MAIN_TBL = '[].slice.call(document.querySelectorAll("table.edit-tbl")).filter(function(x){return x.querySelectorAll("thead th").length>0})[0]'

let browser = null
const results = []
const rec = (n, v) => { results.push({ n: n, v: v }); console.log('  ' + n + ' = ' + JSON.stringify(v)) }

try {
  browser = await launch()
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(
    "localStorage.setItem('hergent_v2_token', " + JSON.stringify(TOK) + ");" +
    "localStorage.setItem('hergent_v2_tenant', '1');"
  )
  await p.addInitScript(INSTRUMENT)
  await p.goto(URL_BASE + '/#/forecast', 9000)
  await p.eval(HELPERS)

  const url = await p.eval('location.href')
  console.log('[' + LABEL + '] url = ' + url)
  if (/#\/login/.test(url)) { console.log('NOT_LOGGED_IN'); console.log(JSON.stringify({ label: LABEL, error: 'login' })); process.exit(2) }

  // ===== 进入编辑态 =====
  await p.eval('window.__pc = 0; window.__nc = 0; 1')
  const clicked = await p.eval('(function(){var bs=[].slice.call(document.querySelectorAll("button"));var b=bs.filter(function(x){return (x.textContent||"").trim()==="改单"})[0];if(b){b.click();return 1}return 0})()')
  await sleep(5200)
  const c1 = JSON.parse(await p.eval('JSON.stringify({pc:window.__pc,nc:window.__nc,inputs:document.querySelectorAll("input").length,qtyInputs:document.querySelectorAll("input.cell-qty").length,rows:(' + MAIN_TBL + ')?' + MAIN_TBL + '.querySelectorAll("tbody tr").length:-1,th:(' + MAIN_TBL + ')?' + MAIN_TBL + '.querySelectorAll("thead th").length:-1})'))
  console.log('[' + LABEL + '] 进入编辑态 = ' + JSON.stringify(c1))
  rec('改单按钮命中', clicked === 1)
  rec('进入编辑态 parseInt 次数', c1.pc)
  rec('进入编辑态 normalize 次数', c1.nc)
  rec('常驻 input 数', c1.inputs)
  rec('数量格 input 数', c1.qtyInputs)
  rec('编辑网格行数', c1.rows)
  rec('编辑网格列数', c1.th)

  // ===== 单击主档列（真实 mousedown）=====
  await p.eval('(function(){var t=' + MAIN_TBL + ';var td=t.querySelector("tbody td[data-c=\'0\']");var r=td.getBoundingClientRect();td.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true,button:0,buttons:1,clientX:r.left+8,clientY:r.top+8}));return 1})()')
  await sleep(700)
  const m = JSON.parse(await p.eval('JSON.stringify((function(){var t=' + MAIN_TBL + ';var ths=[].slice.call(t.querySelectorAll("thead th"));var sel=ths.filter(function(x){return x.classList.contains("sel-col")})[0];var cs=sel?getComputedStyle(sel):null;var tds=[].slice.call(t.querySelectorAll("tbody td.sel-col"));var tcs=tds[0]?getComputedStyle(tds[0]):null;var other=ths.filter(function(x){return !x.classList.contains("sel-col")&&!x.classList.contains("seq-th")&&!x.classList.contains("frozen")})[0];var ocs=other?getComputedStyle(other):null;var plain=t.querySelector("tbody td:not(.sel-col):not(.seq-cell):not(.frozen)");var pcs=plain?getComputedStyle(plain):null;return {selThCount:ths.filter(function(x){return x.classList.contains("sel-col")}).length,selThText:sel?sel.textContent.trim():null,selColor:cs?cs.color:null,selFontWeight:cs?cs.fontWeight:null,selShadow:cs?cs.boxShadow:null,selAriaCurrent:sel?sel.getAttribute("aria-current"):null,otherAriaCurrent:other?other.getAttribute("aria-current"):"NA",effBg:sel?window.__effBg(sel):null,tdSel:tds.length,rowCount:t.querySelectorAll("tbody tr").length,tdShadow:tcs?tcs.boxShadow:null,otherShadow:ocs?ocs.boxShadow:null,plainShadow:pcs?pcs.boxShadow:null}})())'))
  console.log('[' + LABEL + '] 主档列读数 = ' + JSON.stringify(m))
  rec('单击后恰好 1 个表头 sel-col', m.selThCount === 1)
  rec('表头选中态 color（计算值）', m.selColor)
  rec('表头选中态有效底色（合成后）', m.effBg)
  const cr = JSON.parse(await p.eval('JSON.stringify(window.__cr(' + JSON.stringify(m.selColor.replace(/[^0-9,]/g, '').split(',').map(Number)) + ', ' + JSON.stringify(m.effBg) + '))'))
  rec('表头选中态对比度', Math.round(cr * 100) / 100)
  rec('对比度 >= 4.5（UI-SPEC §5.6）', cr >= 4.5)
  rec('表头字重 = 500', String(m.selFontWeight) === '500')
  rec('表头 2px 下划线', /inset/.test(String(m.selShadow)) && /-2px/.test(String(m.selShadow)))
  rec('未选中表头无下划线（负对照）', m.otherShadow === 'none' || m.otherShadow === '')
  rec('整列全部数据行带 sel-col', m.tdSel === m.rowCount && m.tdSel > 0)
  rec('列覆盖 + 左右 1px 边线', /1px/.test(String(m.tdShadow)) && /-1px/.test(String(m.tdShadow)))
  rec('未选中单元格无覆盖（负对照）', m.plainShadow === 'none' || m.plainShadow === '')
  rec('选中表头 aria-current', m.selAriaCurrent)
  rec('P1-2 aria-current = true', m.selAriaCurrent === 'true')
  rec('负对照：未选中表头 aria-current 非 true', m.otherAriaCurrent !== 'true')

  // ===== 切到数量列 =====
  await p.eval('(function(){var t=' + MAIN_TBL + ';var td=t.querySelector("tbody td.qty-cell");var r=td.getBoundingClientRect();td.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true,button:0,buttons:1,clientX:r.left+8,clientY:r.top+8}));return 1})()')
  await sleep(700)
  const q = JSON.parse(await p.eval('JSON.stringify((function(){var t=' + MAIN_TBL + ';var ths=[].slice.call(t.querySelectorAll("thead th"));var sel=ths.filter(function(x){return x.classList.contains("sel-col")})[0];var tds=[].slice.call(t.querySelectorAll("tbody td.qty-cell.sel-col"));var cs=tds[0]?getComputedStyle(tds[0]):null;return {selThCount:ths.filter(function(x){return x.classList.contains("sel-col")}).length,selThText:sel?sel.textContent.trim().slice(0,20):null,qtySel:tds.length,qtyShadow:cs?cs.boxShadow:null,inlineStyle:tds[0]?tds[0].getAttribute("style"):null}})())'))
  console.log('[' + LABEL + '] 数量列读数 = ' + JSON.stringify(q))
  rec('切列后仍恰好 1 个表头 sel-col', q.selThCount === 1)
  rec('表头跟随切换（与主档列不同）', q.selThText !== m.selThText)
  rec('数量列整列带 sel-col', q.qtySel === m.rowCount && q.qtySel > 0)

  // ===== P0-2：选区切换触发的重渲染开销（不改任何数据）=====
  await p.eval('window.__pc = 0; window.__nc = 0; 1')
  await p.eval('(function(){var t=' + MAIN_TBL + ';var td=t.querySelectorAll("tbody td.qty-cell")[5];var r=td.getBoundingClientRect();td.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true,button:0,buttons:1,clientX:r.left+8,clientY:r.top+8}));return 1})()')
  await sleep(1200)
  const c2 = JSON.parse(await p.eval('JSON.stringify({pc:window.__pc,nc:window.__nc})'))
  console.log('[' + LABEL + '] 选区切换重渲染 = ' + JSON.stringify(c2))
  rec('重渲染 parseInt 次数', c2.pc)
  rec('重渲染 normalize 次数', c2.nc)

  // ===== P1-1 / P1-3 可访问性属性 =====
  const a11y = JSON.parse(await p.eval('JSON.stringify((function(){var t=' + MAIN_TBL + ';var foot=[].slice.call(document.querySelectorAll("table.edit-tbl")).filter(function(x){return !x.querySelectorAll("thead th").length})[0];var ths=[].slice.call(t.querySelectorAll("thead th"));return {role:t.getAttribute("role"),rowcount:t.getAttribute("aria-rowcount"),colcount:t.getAttribute("aria-colcount"),scopeCol:ths.filter(function(x){return x.getAttribute("scope")==="col"}).length,thTotal:ths.length,footFound:!!foot,footLabel:foot?foot.getAttribute("aria-label"):null,footRole:foot?foot.getAttribute("role"):null,footTbodyRole:foot&&foot.querySelector("tbody")?foot.querySelector("tbody").getAttribute("role"):null,editTblCount:document.querySelectorAll("table.edit-tbl").length}})())'))
  console.log('[' + LABEL + '] a11y 读数 = ' + JSON.stringify(a11y))
  rec('P1-1 编辑网格 role', a11y.role)
  rec('P1-1 aria-rowcount', a11y.rowcount)
  rec('P1-1 aria-colcount', a11y.colcount)
  rec('P1-1 全部 th 带 scope=col', a11y.scopeCol === a11y.thTotal && a11y.thTotal > 0)
  rec('P1-3 表尾 aria-label', a11y.footLabel)
  rec('P1-3 表尾 tbody role=rowgroup', a11y.footTbodyRole)

  await p.screenshot('/tmp/v375-probe-' + LABEL + '.png')
  console.log('[' + LABEL + '] 截图 = /tmp/v375-probe-' + LABEL + '.png')
  console.log('JSONRESULT ' + JSON.stringify({ label: LABEL, results: results }))
} finally {
  if (browser) await browser.close()
}
