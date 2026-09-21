/**
 * v222-view-vs-edit.mjs —— 「查看态 / 编辑态」箱数是否同口径（同屏两个数字是本轮最怕的回归）
 *
 * 背景：箱数由 `perCase` 决定，而 perCase 的**数据来源**是行对象上的换算字段；
 *   两条加载路径（loadCross / loadEditGrid）各自构造行对象 —— 漏一处就出现
 *   「查看态 1 箱、编辑态 0.035 箱」。本探针在真机上把两个态的同一个商品读出来比。
 *
 * 期望（pid=1164，主档 件=12，期次 14 报单 12 瓶）：
 *   查看态 合计(箱) = 1 ；编辑态同商品箱数也应为 1（而非 0.035/0）
 * 🔴 只进「改单」看，**绝不点保存**。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)

const JS_LOGIN = [
  'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},',
  'body:JSON.stringify({username:"mptestsp",password:"Mpsup@1"})})',
  '.then(r=>r.json()).then(function(d){if(!d.token)return "NO";',
  'localStorage.setItem("hergent_v2_token",d.token);',
  'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);',
  'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));',
  'localStorage.setItem("hergent_v2_tenant",String(d.tenant_id||1));return "OK"})',
].join('')

const JS_SETUP = [
  '(function(){var s=document.querySelector("select.sel-period")||document.querySelector("select");',
  'for(var j=0;j<s.options.length;j++){if(String(s.options[j].value)==="14"){s.value="14";',
  's.dispatchEvent(new Event("change",{bubbles:true}));break}}return "period14"})()',
].join('')

const JS_HIDE_ZERO = `(function(){
  var ls=Array.from(document.querySelectorAll('label.tb-toggle'));
  for(var i=0;i<ls.length;i++){ if((ls[i].innerText||'').indexOf('仅显示有报单')>=0){
    var cb=ls[i].querySelector('input'); if(cb){ if(!cb.checked) cb.click(); return 'CHK='+cb.checked } } }
  return 'NOT_FOUND'})()`

/* 通用：读指定关键词所在行的关键列（按表头定位，兼容两张表） */
const JS_READ = (kw) => `(function(){
  var kw=${JSON.stringify(kw)}; var tables=document.querySelectorAll('table');
  for(var ti=0; ti<tables.length; ti++){
    var t=tables[ti]; var th=t.querySelector('thead tr'); if(!th) continue;
    var hc=th.querySelectorAll('th,td'); var heads=[];
    for(var k=0;k<hc.length;k++){ heads.push((hc[k].innerText||'').trim()); }
    var trs=t.querySelectorAll('tbody tr');
    for(var ri=0; ri<trs.length; ri++){
      var tr=trs[ri]; if((tr.innerText||'').indexOf(kw)<0) continue;
      var tds=tr.querySelectorAll('td'); var out={heads:heads,cells:[]};
      for(var ci=0; ci<tds.length; ci++){
        var c=tds[ci]; var inp=c.querySelector('input,textarea');
        out.cells.push({h:heads[ci]||('col'+ci),
          t:(c.innerText||'').trim().replace(/\\s+/g,' ').slice(0,40),
          v:inp?String(inp.value===undefined?'':inp.value):null}); }
      return JSON.stringify({found:true,table:ti,cells:out.cells});
    }
  }
  return JSON.stringify({found:false})})()`

const JS_CLICK_EDIT = [
  '(function(){var bs=Array.from(document.querySelectorAll("button"));',
  'var b=bs.find(function(x){return (x.innerText||"").trim()==="改单"});',
  'if(!b)return "NOT_FOUND";b.click();return "OK"})()',
].join('')

const show = (label, raw) => {
  const d = JSON.parse(raw)
  log('--- ' + label + ' ---')
  if (!d.found) { log('  （未找到含关键词的行）'); return null }
  const keep = ['商品名称', '规格', '单位', '合计(小单位)', '合计(箱)', '最终下单(箱)', '箱数', '数量(箱)', '单价(厂价/箱)']
  const pick = {}
  d.cells.forEach(c => { if (keep.includes(c.h) || c.v !== null) pick[c.h] = c.v !== null ? c.v + ' <input>' : c.t })
  log('  ' + JSON.stringify(pick))
  return pick
}

let browser
try {
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()
  await page.goto(BASE, 3500)
  log('登录 ' + await page.eval(JS_LOGIN))
  await page.goto(BASE + '/#/forecast', 6000)
  await sleep(5000)
  await page.eval(JS_SETUP)
  await sleep(7000)
  log('勾「仅显示有报单」：' + await page.eval(JS_HIDE_ZERO))
  await sleep(4000)

  const view = show('查看态（汇总表）pid=1164', await page.eval(JS_READ('340G')))

  log('')
  log('进「改单」：' + await page.eval(JS_CLICK_EDIT))
  await sleep(7000)
  log('改单中再勾一次「仅显示有报单」：' + await page.eval(JS_HIDE_ZERO).catch(() => 'n/a'))
  await sleep(4000)

  const edit = show('编辑态（改单网格）pid=1164', await page.eval(JS_READ('340G')))

  log('')
  log('--- 判定 ---')
  if (view && edit) {
    const parse = (s) => { if (s === null || s === undefined) return null; const m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null }
    const bv = parse(view['合计(箱)']); const be = parse(edit['合计(箱)'] ?? edit['箱数'] ?? edit['数量(箱)'])
    log('  查看态 合计(箱) = ' + bv)
    log('  编辑态 箱数     = ' + be)
    if (bv !== null && be !== null) log('  ' + (Math.abs(bv - be) < 0.06 ? '✅ 两态同口径（' + bv + ' ≈ ' + be + '）' : '🔴 两态不一致：' + bv + ' vs ' + be))
    else log('  ⚠️ 编辑态未取到箱数列，见上文明细')
  } else log('  ⚠️ 缺一侧数据，无法比对')

  const errs = page.errors.slice()
  log('错误 ' + errs.length + ' 条'); errs.slice(0, 6).forEach(e => log('   ' + e.slice(0, 160)))
} catch (e) { log('异常：' + (e && e.message)) }
finally { if (browser) { try { await browser.close() } catch { } } }
