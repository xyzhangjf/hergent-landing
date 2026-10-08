import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const URL_BASE = process.env.PROBE_URL || 'http://127.0.0.1:5211'
const LABEL = process.env.PROBE_LABEL || 'v375'
const TOK = fs.readFileSync('/tmp/v375-token.txt', 'utf8').trim()
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// 全部用数组记录，避免对象字面量在 eval 里的丢键问题
const SNAP = '(function(){' +
  'var tables=[].slice.call(document.querySelectorAll("table.edit-tbl"));' +
  'var t=tables.filter(function(x){return x.querySelectorAll("thead th").length>0})[0];' +
  'var foot=tables.filter(function(x){return !x.querySelectorAll("thead th").length})[0];' +
  'var labels=[].slice.call(t.querySelectorAll("thead th")).map(function(x){return x.textContent.trim()});' +
  'var trs=[].slice.call(t.querySelectorAll("tbody tr"));' +
  'var rows=trs.map(function(tr){' +
  '  var tds=[].slice.call(tr.children);' +
  '  var sumTd=null; for (var i=0;i<tds.length;i++){ if(tds[i].classList.contains("calc")&&tds[i].classList.contains("sum")){sumTd=tds[i];break} }' +
  '  var q=tr.querySelector("td.qty-cell");' +
  '  var nameTd=tr.querySelector("td[data-c=\'0\']");' +
  '  var s=sumTd?sumTd.textContent.trim():"";' +
  '  var sc=sumTd?String(sumTd.className):"";' +
  '  var qc=q?String(q.className):"";' +
  '  var rc=String(tr.className);' +
  '  var nm=nameTd?nameTd.textContent.trim().slice(0,14):"";' +
  '  return [nm,s,sc,qc,rc]' +
  '});' +
  'return JSON.stringify([labels, rows.length, rows, foot?foot.textContent.replace(/[ \\t\\n\\r]+/g," ").trim().slice(0,200):""])' +
  '})()'

let browser = null
try {
  browser = await launch()
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript("localStorage.setItem('hergent_v2_token', " + JSON.stringify(TOK) + ");localStorage.setItem('hergent_v2_tenant','1');")
  await p.goto(URL_BASE + '/#/forecast', 9000)
  const url = await p.eval('location.href')
  if (/#\/login/.test(url)) { console.log('NOT_LOGGED_IN'); process.exit(2) }
  await p.eval('(function(){var bs=[].slice.call(document.querySelectorAll("button"));var b=bs.filter(function(x){return (x.textContent||"").trim()==="改单"})[0];if(b)b.click();return 1})()')
  await sleep(6000)
  const raw = await p.eval(SNAP)
  fs.writeFileSync('/tmp/grid-snap-' + LABEL + '.json', raw)
  const d = JSON.parse(raw)
  console.log('[' + LABEL + '] 行数=' + d[1] + ' 列数=' + d[0].length + ' 快照字节=' + raw.length)
  console.log('[' + LABEL + '] 表尾 = ' + JSON.stringify(d[3]))
  console.log('[' + LABEL + '] 第1行 = ' + JSON.stringify(d[2][0]))
  console.log('[' + LABEL + '] 第2行 = ' + JSON.stringify(d[2][1]))
} finally {
  if (browser) await browser.close()
}
