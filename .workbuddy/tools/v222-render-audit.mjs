/**
 * v222-render-audit.mjs —— 渲染层对账：页面上「合计(箱)」是否 = 「合计(小单位)」÷ perCase
 *
 * 做法：① 真机打开期次 14，把所有渲染行逐格导出到 /tmp/v222-rendered.json
 *       ② 用线上产物里的真实 perCase + 真实主档换算，逐行独立算一遍
 *       ③ 两者比对（容差 0.05，页面显示保留 1 位小数）
 * 只读。不点保存。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const API = process.env.HG_API || 'https://erp.hergent.cn'
const CHUNK = BASE + '/assets/Forecast-B293RISQ.js'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)

function extractFn(src, anchor) {
  const i = src.indexOf(anchor); const j = src.lastIndexOf('function ', i)
  let k = src.indexOf('{', j); let d = 0, end = -1, inS = null
  for (let p = k; p < src.length; p++) {
    const c = src[p]
    if (inS) { if (c === '\\') { p++; continue } if (c === inS) inS = null; continue }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { end = p; break } }
  }
  return src.slice(j, end + 1)
}

const JS_LOGIN = [
  'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},',
  'body:JSON.stringify({username:"mptestsp",password:"Mpsup@1"})})',
  '.then(r=>r.json()).then(function(d){if(!d.token)return "NO";',
  'localStorage.setItem("hergent_v2_token",d.token);',
  'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);',
  'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));',
  'localStorage.setItem("hergent_v2_tenant",String(d.tenant_id||1));return "OK"})',
].join('')

const JS_PICK14 = [
  '(function(){var s=document.querySelector("select.sel-period")||document.querySelector("select");',
  'if(!s)return "NO_SELECT";',
  'for(var j=0;j<s.options.length;j++){if(String(s.options[j].value)==="14"){s.value="14";',
  's.dispatchEvent(new Event("change",{bubbles:true}));return "OK"}}return "NOT_FOUND"})()',
].join('')

/* 把每一行的「商品名/规格/单位/合计(小单位)/合计(箱)」抠出来 */
const JS_ROWS = `(function(){
  var heads=[]; var th=document.querySelector('table thead tr');
  if(th){ var hc=th.querySelectorAll('th,td'); for(var k=0;k<hc.length;k++){ heads.push((hc[k].innerText||'').trim()); } }
  var iName=heads.indexOf('商品名称'), iSpec=heads.indexOf('规格'), iUnit=heads.indexOf('单位');
  var iSum=head_index('合计(小单位)'), iBox=head_index('合计(箱)'), iFinal=head_index('最终下单(箱)');
  var iPc=head_index('单价(厂价/箱)');
  function head_index(s){ return heads.indexOf(s); }
  var out=[];
  var trs=document.querySelectorAll('table tbody tr');
  for(var ri=0; ri<trs.length; ri++){
    var tds=trs[ri].querySelectorAll('td');
    function cell(i){ if(i<0||i>=tds.length) return ''; return (tds[i].innerText||'').trim().replace(/\\s+/g,' '); }
    var name=cell(iName); if(!name) continue;
    out.push({name:name, spec:cell(iSpec), unit:cell(iUnit),
      sumSmall:cell(iSum), sumBox:cell(iBox), finalBox:cell(iFinal), priceCase:cell(iPc)});
  }
  return JSON.stringify({heads:heads, rows:out});
})()`

let browser
try {
  /* ---- 1. 线上产物 → 真实 perCase ---- */
  const txt = await (await fetch(CHUNK)).text()
  const perCase = new Function('return (' + extractFn(txt, 'Number(n.large_ratio)||0;if(') + ')')()
  log('从线上产物切出 perCase（形参 ' + perCase.length + ' 个）')

  /* ---- 2. 真实主档 ---- */
  const ld = await (await fetch(API + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'mptestsp', password: 'Mpsup@1' }),
  })).json()
  const prods = (await (await fetch(API + '/api/products/grid?limit=2000', {
    headers: { Authorization: 'Bearer ' + ld.token, 'X-Tenant-Id': '1' },
  })).json()).items || []
  const byName = {}
  prods.forEach(p => { byName[String(p.name || '').trim()] = p })
  log('主档 ' + prods.length + ' 条')

  /* ---- 3. 真机渲染行 ---- */
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()
  await page.goto(BASE, 3500)
  await page.eval(JS_LOGIN)
  await page.goto(BASE + '/#/forecast', 6000)
  await sleep(5000)
  log('选期次 14：' + await page.eval(JS_PICK14))
  await sleep(7000)
  const dump = JSON.parse(await page.eval(JS_ROWS))
  fs.writeFileSync('/tmp/v222-rendered.json', JSON.stringify(dump, null, 2))
  log('渲染行数 = ' + dump.rows.length + '（已存 /tmp/v222-rendered.json）')

  /* ---- 4. 逐行独立核算 ---- */
  const num = (s) => { const m = String(s || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null }
  log('')
  log('名称                                     | 规格    | 单位 | 合计小单位 | 页面箱 | 独立算箱 | 主档换算')
  let checked = 0, matched = 0, mismatched = []
  for (const r of dump.rows) {
    const ss = num(r.sumSmall), pb = num(r.sumBox)
    if (ss === null || pb === null || ss === 0) continue
    const arc = byName[r.name.trim()] || null
    const pc = arc ? perCase(arc.spec, arc.unit, arc) : perCase(r.spec, r.unit, undefined)
    if (!(pc > 0)) continue
    const expect = ss / pc
    checked++
    const ok = Math.abs(expect - pb) < 0.06
    if (ok) matched++; else mismatched.push({ ...r, ss, pb, expect, pc, arc: arc ? arc.large_unit + '=' + arc.large_ratio : '（无）' })
    if (checked <= 14 || !ok) {
      log('  ' + String(r.name).slice(0, 36).padEnd(38) + ' | ' + String(r.spec).padEnd(7) + ' | '
        + String(r.unit).padEnd(4) + ' | ' + String(ss).padStart(10) + ' | ' + String(pb).padStart(6) + ' | '
        + expect.toFixed(2).padStart(8) + ' | ' + (arc ? arc.large_unit + '=' + arc.large_ratio : '（无换算）') + (ok ? '' : '  ← 不一致'))
    }
  }
  log('')
  log('可核算行 = ' + checked + '｜一致 = ' + matched + '｜不一致 = ' + mismatched.length)
  if (mismatched.length) {
    log('--- 不一致明细 ---')
    mismatched.forEach(m => log('  ' + m.name + ' 规格=' + m.spec + ' 单位=' + m.unit
      + ' 小单位=' + m.ss + ' 页面箱=' + m.pb + ' 独立算=' + m.expect.toFixed(3) + ' perCase=' + m.pc + ' 主档=' + m.arc))
  }
  const errs = page.errors.slice()
  log('页面错误 ' + errs.length + ' 条')

  const bad = mismatched.length
  log('')
  log(bad === 0 && checked > 0 ? '结论：✅ 渲染层口径一致（' + checked + ' 行可核算）' : '结论：' + (checked === 0 ? '⚠️ 无可核算行' : '❌ 有 ' + bad + ' 行不一致'))
} catch (e) { log('异常：' + (e && e.message)) }
finally { if (browser) { try { await browser.close() } catch { } } }
