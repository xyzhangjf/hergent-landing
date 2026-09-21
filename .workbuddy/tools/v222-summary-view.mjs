/**
 * v222-summary-view.mjs —— 切到「汇总表」视图读真实渲染的「合计(箱)」
 *
 * 上一轮踩的坑：默认视图是**逐单补录**（行名带「导入 … · N 人报」后缀），
 * 我误当成了汇总表 ⇒ 一直读到 0 行报单数据。工具栏有独立的「汇总表」按钮。
 *
 * 目标：期次 14 中 pid=1164（规格 340G / 单位 瓶 / 主档 件=12 / total_qty=12）
 *   · v222 后 perCase=12 ⇒ 合计(箱) 应为 12/12 = **1**
 *   · v222 前 perCase=340 ⇒ 合计(箱) 会是 12/340 ≈ 0.04
 * 只读。
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

const JS_PICK14 = [
  '(function(){var s=document.querySelector("select.sel-period")||document.querySelector("select");',
  'if(!s)return "NO_SELECT";',
  'for(var j=0;j<s.options.length;j++){if(String(s.options[j].value)==="14"){s.value="14";',
  's.dispatchEvent(new Event("change",{bubbles:true}));return "OK"}}return "NOT_FOUND"})()',
].join('')

const JS_CLICK_SUMMARY = [
  '(function(){var bs=Array.from(document.querySelectorAll("button,a,[role=button]"));',
  'var b=bs.find(function(x){return (x.innerText||"").trim()==="汇总表"});',
  'if(!b)return "NOT_FOUND";b.click();return "OK"})()',
].join('')

/* 只读「汇总表」那张表：按表头定位列索引，精确取 商品名称/规格/单位/合计(小单位)/合计(箱)/最终下单(箱) */
const JS_TABLE = `(function(){
  var tables=document.querySelectorAll('table');
  for(var ti=0; ti<tables.length; ti++){
    var t=tables[ti];
    var th=t.querySelector('thead tr'); if(!th) continue;
    var hc=th.querySelectorAll('th,td'); var heads=[];
    for(var k=0;k<hc.length;k++){ heads.push((hc[k].innerText||'').trim()); }
    if(heads.indexOf('合计(箱)')<0) continue;
    var iName=heads.indexOf('商品名称'), iSpec=heads.indexOf('规格'), iUnit=heads.indexOf('单位');
    var iSm=heads.indexOf('合计(小单位)'), iBx=heads.indexOf('合计(箱)');
    var iFn=heads.indexOf('最终下单(箱)'), iPr=heads.indexOf('单价(厂价/箱)');
    var trs=t.querySelectorAll('tbody tr'); var out=[];
    for(var ri=0; ri<trs.length; ri++){
      var tds=trs[ri].querySelectorAll('td');
      function cell(i){ return (i<0||i>=tds.length)?'':(tds[i].innerText||'').trim().replace(/\\s+/g,' '); }
      var nm=cell(iName); if(!nm) continue;
      out.push({name:nm, spec:cell(iSpec), unit:cell(iUnit),
        sm:cell(iSm), bx:cell(iBx), fn:cell(iFn), pr:cell(iPr)});
    }
    return JSON.stringify({tableIndex:ti, heads:heads, rows:out});
  }
  return JSON.stringify({tableIndex:-1, heads:[], rows:[]});
})()`

let browser
try {
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()
  await page.goto(BASE, 3500)
  log('登录 ' + await page.eval(JS_LOGIN))
  await page.goto(BASE + '/#/forecast', 6000)
  await sleep(5000)
  log('选期次 14：' + await page.eval(JS_PICK14))
  await sleep(6000)

  log('点「汇总表」：' + await page.eval(JS_CLICK_SUMMARY))
  await sleep(6000)

  const d = JSON.parse(await page.eval(JS_TABLE))
  log('命中表 index=' + d.tableIndex + '，行数 = ' + d.rows.length)
  fs.writeFileSync('/tmp/v222-summary-table.json', JSON.stringify(d, null, 2))

  const num = (s) => { const m = String(s || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null }
  log('')
  log('  # | 商品名称                                  | 规格    | 单位 | 合计小单位 | 合计箱 | 最终下单箱')
  d.rows.forEach((r, i) => {
    if (i < 30) log('  ' + String(i).padStart(2) + ' | ' + r.name.slice(0, 38).padEnd(40) + ' | ' + String(r.spec).padEnd(7) + ' | '
      + String(r.unit).padEnd(4) + ' | ' + String(r.sm).padStart(10) + ' | ' + String(r.bx).padStart(6) + ' | ' + r.fn)
  })

  /* 定点：1164 */
  log('')
  const target = d.rows.find(r => /340G/.test(r.name) || /新希望/.test(r.name))
  if (target) {
    const ss = num(target.sm), bx = num(target.bx)
    log('★ 目标行：' + JSON.stringify(target))
    log('  perCase（主档 件=12）应为 12 ⇒ 合计(箱) = ' + ss + '/12 = ' + (ss / 12).toFixed(3))
    log('  页面渲染 合计(箱) = ' + target.bx + '  ⇒ ' + (Math.abs(bx - ss / 12) < 0.06 ? '✅ 与 v222 口径一致' : '🔴 与 v222 口径不一致'))
    log('  对照：v222 前口径 perCase=340 ⇒ 合计(箱) 会是 ' + (ss / 340).toFixed(3) + '（即旧值）')
  } else {
    log('⚠️ 汇总表里仍未出现 340G 行；行数 = ' + d.rows.length)
  }

  const body = await page.eval('document.body?document.body.innerText:""')
  log('正文含「新希望」= ' + /新希望/.test(body) + '｜含「340G」= ' + /340G/.test(body))
  const errs = page.errors.slice()
  log('错误 ' + errs.length + ' 条'); errs.slice(0, 6).forEach(e => log('   ' + e.slice(0, 170)))
  try {
    const SHOT = SHOT_DIR + '/v222-汇总表-期次14-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '.png'
    await page.screenshot(SHOT); log('截图：' + SHOT)
  } catch { }
} catch (e) { log('异常：' + (e && e.message)) }
finally { if (browser) { try { await browser.close() } catch { } } }
