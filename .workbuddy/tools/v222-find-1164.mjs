/**
 * v222-find-1164.mjs —— 用「仅显示有报单」把 pid=1164 逼进视口，读它真实渲染的「合计(箱)」
 *
 * 前情：汇总表行底 ≈160 行（154 登记 ∪ 6 有报单），但 DOM 只渲染 28 个 <tr>
 *   ⇒ 表体是增量/视口渲染，1164（新希望，按导入行序排在后面）压根没进 DOM。
 *   勾上「仅显示有报单」后行数骤减，目标行必然落在渲染窗口内。
 *
 * 期望：期次 14 / pid=1164：规格 340G、单位 瓶、主档 件=12、total_qty=12
 *   v222 后 perCase=12 ⇒ 合计(箱) = **1**
 *   v222 前 perCase=340 ⇒ 合计(箱) = 0.04（页面会显示 0）
 * 只读（勾选框是纯视图状态，不写库）。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/客户列删除被恢复排查-2026-09-19'
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
  '(function(){',
  'var s=document.querySelector("select.sel-period")||document.querySelector("select");',
  'for(var j=0;j<s.options.length;j++){if(String(s.options[j].value)==="14"){s.value="14";',
  's.dispatchEvent(new Event("change",{bubbles:true}));break}}',
  'var bs=Array.from(document.querySelectorAll("button"));',
  'var x=bs.find(function(e){return (e.innerText||"").trim()==="汇总表"});if(x)x.click();',
  'return "done"})()',
].join('')

/* 勾「仅显示有报单」 */
const JS_HIDE_ZERO = `(function(){
  var ls=Array.from(document.querySelectorAll('label.tb-toggle'));
  for(var i=0;i<ls.length;i++){
    if((ls[i].innerText||'').indexOf('仅显示有报单')>=0){
      var cb=ls[i].querySelector('input');
      if(!cb) return 'NO_CHECKBOX';
      if(!cb.checked){ cb.click() }
      return 'CHECKED='+cb.checked;
    }
  }
  return 'NOT_FOUND'})()`

/* 读表：按表头定位，返回全部行 + 单独标注目标 */
const JS_READ = `(function(){
  var tables=document.querySelectorAll('table');
  for(var ti=0; ti<tables.length; ti++){
    var t=tables[ti];
    var th=t.querySelector('thead tr'); if(!th) continue;
    var hc=th.querySelectorAll('th,td'); var heads=[];
    for(var k=0;k<hc.length;k++){ heads.push((hc[k].innerText||'').trim()); }
    if(heads.indexOf('合计(箱)')<0) continue;
    var iName=heads.indexOf('商品名称'),iSpec=heads.indexOf('规格'),iUnit=heads.indexOf('单位');
    var iSm=heads.indexOf('合计(小单位)'),iBx=heads.indexOf('合计(箱)'),iFn=heads.indexOf('最终下单(箱)');
    var iPr=heads.indexOf('单价(厂价/箱)'),iBr=heads.indexOf('品牌');
    var trs=t.querySelectorAll('tbody tr'); var all=[]; var target=null;
    for(var ri=0; ri<trs.length; ri++){
      var tds=trs[ri].querySelectorAll('td');
      function cell(i){ return (i<0||i>=tds.length)?'':(tds[i].innerText||'').trim().replace(/\\s+/g,' '); }
      var nm=cell(iName); if(!nm) continue;
      var row={name:nm,spec:cell(iSpec),unit:cell(iUnit),brand:cell(iBr),
        sm:cell(iSm),bx:cell(iBx),fn:cell(iFn),pr:cell(iPr)};
      all.push(row);
      if(/340G|新希望|轻食/.test(nm)) target=row;
    }
    return JSON.stringify({table:ti,rowCount:all.length,target:target,all:all});
  }
  return JSON.stringify({table:-1,rowCount:0,target:null,all:[]});
})()`

let browser
try {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
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
  await sleep(5000)

  const d = JSON.parse(await page.eval(JS_READ))
  log('汇总表行数 = ' + d.rowCount)
  fs.writeFileSync('/tmp/v222-filtered.json', JSON.stringify(d, null, 2))

  log('')
  log('  # | 商品名称                                | 规格  | 单位 | 合计小单位 | 合计箱 | 最终下单箱')
  d.all.forEach((r, i) => log('  ' + String(i).padStart(2) + ' | ' + r.name.slice(0, 36).padEnd(38) + ' | '
    + String(r.spec).padEnd(6) + ' | ' + String(r.unit).padEnd(4) + ' | ' + String(r.sm).padStart(10) + ' | '
    + String(r.bx).padStart(6) + ' | ' + r.fn))

  log('')
  if (d.target) {
    const num = (s) => { const m = String(s || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null }
    const ss = num(d.target.sm), bx = num(d.target.bx)
    log('★ 目标行 = ' + JSON.stringify(d.target))
    log('  主档：件=12 ⇒ 期望 合计(箱) = ' + ss + ' / 12 = ' + (ss / 12).toFixed(3))
    log('  页面渲染 合计(箱) = ' + d.target.bx)
    log('  旧口径（perCase=340）会是 ' + (ss / 340).toFixed(3))
    log('  判定：' + (Math.abs(bx - ss / 12) < 0.06 ? '✅ 与 v222 口径一致（读主档）' : '🔴 不一致'))
  } else {
    log('⚠️ 仍未在渲染窗口内找到 340G 行（行数 ' + d.rowCount + '）')
  }

  const errs = page.errors.slice()
  log('错误 ' + errs.length + ' 条'); errs.slice(0, 6).forEach(e => log('   ' + e.slice(0, 160)))
  try {
    const SHOT = SHOT_DIR + '/v222-仅显示有报单-期次14-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '.png'
    await page.screenshot(SHOT); log('截图：' + SHOT)
  } catch { }
} catch (e) { log('异常：' + (e && e.message)) }
finally { if (browser) { try { await browser.close() } catch { } } }
