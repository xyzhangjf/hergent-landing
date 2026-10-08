import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const TOK = process.env.HG_TOKEN || fs.readFileSync('/tmp/v373-token.txt', 'utf8').trim()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

let browser = null
const results = []
const ok = (n, pass, d) => {
  results.push({ n, pass: !!pass })
  console.log((pass ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? '  << ' + d : ''))
}

try {
  browser = await launch()
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(
    "localStorage.setItem('hergent_v2_token', " + JSON.stringify(TOK) + ");" +
    "localStorage.setItem('hergent_v2_tenant', '1');"
  )
  await p.goto('https://hergent.cn/?cb=' + Date.now() + '#/forecast', 9000)

  const url = await p.eval('location.href')
  ok('P1 已登录进预报页', !/#\/login/.test(url), url)

  await p.eval(`(function(){
    var bs=[].slice.call(document.querySelectorAll('button'));
    var b=bs.filter(function(x){return x.textContent.replace(/\\s+/g,'')==='改单'})[0];
    if(b) b.click(); return 1;
  })()`)
  await sleep(4500)

  const g = JSON.parse(await p.eval(`JSON.stringify((function(){
    var t=[].slice.call(document.querySelectorAll('table.edit-tbl')).filter(function(x){return x.querySelectorAll('thead th').length>0})[0];
    return { hasGrid: !!t, th: t? t.querySelectorAll('thead th').length:0, rows: t? t.querySelectorAll('tbody tr').length:0 };
  })())`))
  ok('P2 编辑网格已渲染（有表头 + 数据行）', g.hasGrid && g.th > 5 && g.rows > 0, JSON.stringify(g))

  // —— 单击主档列（商品名称，ci=0）：真实 mousedown ——
  await p.eval(`(function(){
    var t=[].slice.call(document.querySelectorAll('table.edit-tbl')).filter(function(x){return x.querySelectorAll('thead th').length>0})[0];
    var td=t.querySelector('tbody td[data-c="0"]');
    var r=td.getBoundingClientRect();
    td.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,buttons:1,clientX:r.left+8,clientY:r.top+8}));
    return 1;
  })()`)
  await sleep(600)

  const m = JSON.parse(await p.eval(`JSON.stringify((function(){
    var t=[].slice.call(document.querySelectorAll('table.edit-tbl')).filter(function(x){return x.querySelectorAll('thead th').length>0})[0];
    var ths=[].slice.call(t.querySelectorAll('thead th'));
    var sel=ths.filter(function(x){return x.classList.contains('sel-col')})[0];
    var cs=sel?getComputedStyle(sel):null;
    var other=ths.filter(function(x){return !x.classList.contains('sel-col') && !x.classList.contains('seq-th') && !x.classList.contains('frozen')})[0];
    var ocs=other?getComputedStyle(other):null;
    var tds=[].slice.call(t.querySelectorAll('tbody td.sel-col'));
    var tcs=tds[0]?getComputedStyle(tds[0]):null;
    var plain=t.querySelector('tbody td:not(.sel-col):not(.seq-cell):not(.frozen)');
    var pcs=plain?getComputedStyle(plain):null;
    return {
      thCount: ths.length, selTh: ths.filter(function(x){return x.classList.contains('sel-col')}).length,
      selThText: sel?sel.textContent.trim():null,
      thShadow: cs?cs.boxShadow:null, thWeight: cs?cs.fontWeight:null,
      thBg: cs?cs.backgroundColor:null, thColor: cs?cs.color:null,
      otherThShadow: ocs?ocs.boxShadow:null,
      tdSel: tds.length, rowCount: t.querySelectorAll('tbody tr').length,
      tdShadow: tcs?tcs.boxShadow:null,
      plainTdShadow: pcs?pcs.boxShadow:null
    };
  })())`))
  console.log('主档列读数:', JSON.stringify(m, null, 1))

  ok('P3 单击后恰好 1 个表头带 sel-col', m.selTh === 1, m.selTh)
  ok('P4 表头 = 商品名称列（第一数据列）', /商品|名称/.test(String(m.selThText)), m.selThText)
  ok('P5 表头底部 2px 主色下划线已生效（inset + -2px）',
     /inset/.test(String(m.thShadow)) && /-2px/.test(String(m.thShadow)), m.thShadow)
  ok('P6 表头字重 = 500（原 600）', String(m.thWeight) === '500', m.thWeight)
  ok('P7 未选中表头无下划线（负对照）',
     m.otherThShadow === 'none' || m.otherThShadow === '', m.otherThShadow)
  ok('P8 表体整列（全部数据行）都带 sel-col', m.tdSel === m.rowCount && m.tdSel > 0, m.tdSel + ' / ' + m.rowCount)
  ok('P9 整列 6% 半透明青覆盖生效（rgba(6,182,212,.06) 大扩散 inset）',
     /rgba\(6, 182, 212, 0\.06\) 0px 0px 0px \d+px inset/.test(String(m.tdShadow)), m.tdShadow)
  ok('P10 整列左右各有 1px 主色边线（含 1px 与 -1px）',
     /1px/.test(String(m.tdShadow)) && /-1px/.test(String(m.tdShadow)), m.tdShadow)
  ok('P11 未选中单元格无覆盖（负对照）',
     m.plainTdShadow === 'none' || m.plainTdShadow === '', m.plainTdShadow)

  // —— 单击数量列（有 inline 热力底色） ——
  const qc = JSON.parse(await p.eval(`JSON.stringify((function(){
    var t=[].slice.call(document.querySelectorAll('table.edit-tbl')).filter(function(x){return x.querySelectorAll('thead th').length>0})[0];
    var td=t.querySelector('tbody td.qty-cell');
    if(!td) return {err:'NO_QTY_TD'};
    var r=td.getBoundingClientRect();
    td.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,buttons:1,clientX:r.left+8,clientY:r.top+8}));
    return { c: td.getAttribute('data-c') };
  })())`))
  console.log('数量列点击:', JSON.stringify(qc))
  await sleep(600)

  const q = JSON.parse(await p.eval(`JSON.stringify((function(){
    var t=[].slice.call(document.querySelectorAll('table.edit-tbl')).filter(function(x){return x.querySelectorAll('thead th').length>0})[0];
    var ths=[].slice.call(t.querySelectorAll('thead th'));
    var sel=ths.filter(function(x){return x.classList.contains('sel-col')})[0];
    var tds=[].slice.call(t.querySelectorAll('tbody td.qty-cell.sel-col'));
    var cs=tds[0]?getComputedStyle(tds[0]):null;
    return {
      selTh: ths.filter(function(x){return x.classList.contains('sel-col')}).length,
      selThText: sel?sel.textContent.trim().slice(0,24):null,
      qtySel: tds.length,
      qtyShadow: cs?cs.boxShadow:null,
      qtyInlineBg: tds[0]?tds[0].getAttribute('style'):null,
      qtyBgColor: cs?cs.backgroundColor:null,
      masterSelColLeft: t.querySelectorAll('tbody td[data-c="0"].sel-col').length
    };
  })())`))
  console.log('数量列读数:', JSON.stringify(q, null, 1))

  ok('P12 切到数量列后仍恰好 1 个表头带 sel-col', q.selTh === 1, q.selTh)
  ok('P13 表头跟着切到该数量列（不再停在上一次的表头）', q.selThText !== m.selThText, q.selThText)
  ok('P14 数量列整列带 sel-col', q.qtySel > 0, q.qtySel)
  ok('P15 数量列覆盖层走 box-shadow（不与 inline 热力底色抢 background）',
     /rgba\(6, 182, 212, 0\.06\) 0px 0px 0px \d+px inset/.test(String(q.qtyShadow)), q.qtyShadow)
  ok('P16 上一次的主档列已释放 sel-col（单选、非叠加）',
     q.masterSelColLeft === 0, q.masterSelColLeft)

  // 全屏态再验一次（gridFullscreen 是纯布局变化）
  const shotPath = '/tmp/v373-column-select.png'
  await p.eval(`(function(){var t=[].slice.call(document.querySelectorAll('table.edit-tbl')).filter(function(x){return x.querySelectorAll('thead th').length>0})[0]; if(t) t.querySelector('thead').scrollIntoView({block:'start'}); return 1})()`)
  await sleep(800)
  await p.screenshot(shotPath)
  ok('P17 截图已产出', fs.existsSync(shotPath), shotPath)

  const pe = (p.errors || []).filter(e => !/403|401/.test(e))
  ok('P18 页面无 JS 报错', pe.length === 0, JSON.stringify(pe.slice(0, 5)))

  const bad = results.filter(r => !r.pass)
  console.log('\n汇总: ' + (results.length - bad.length) + '/' + results.length + ' PASS')
  if (bad.length) console.log('FAILED: ' + bad.map(b => b.n).join(' | '))
} catch (e) {
  console.log('FATAL:', e && e.stack ? e.stack : e)
} finally {
  if (browser) { try { await browser.close() } catch (_) {} }
}
