/**
 * v222-gridcells.mjs —— 把期次 14 的汇总表**逐格**读出来（含 input.value）
 * 目的：确认「合计(小单位) / 合计(箱)」两列的真实数值与 perCase 的关系。
 * 只读：不写、不点保存。
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

const JS_PICK = [
  '(function(){var s=document.querySelector("select.sel-period")||document.querySelector("select");',
  'if(!s)return "NO_SELECT";',
  'for(var j=0;j<s.options.length;j++){',
  'if(String(s.options[j].value)==="14"){s.value="14";',
  's.dispatchEvent(new Event("change",{bubbles:true}));return "OK"}}',
  'return "NOT_FOUND"})()',
].join('')

/* 逐格：文本 / input 值 / 标签名，全部取出。用模板字面量避免拼接笔误。 */
const JS_ALL = `(function(){
  var out=[];
  var tables=document.querySelectorAll('table');
  for(var ti=0; ti<tables.length; ti++){
    var t=tables[ti];
    var th=t.querySelector('thead tr');
    var heads=[];
    if(th){ var hc=th.querySelectorAll('th,td');
      for(var k=0;k<hc.length;k++){ heads.push((hc[k].innerText||'').trim()); } }
    var trs=t.querySelectorAll('tbody tr');
    for(var ri=0; ri<trs.length; ri++){
      var tds=trs[ri].querySelectorAll('td');
      var cells=[]; var anyText=false; var anyVal=false;
      for(var ci=0; ci<tds.length; ci++){
        var c=tds[ci];
        var inp=c.querySelector('input,textarea');
        var txt=(c.innerText||'').trim().replace(/\\s+/g,' ');
        var val=inp?String(inp.value===undefined?'':inp.value):null;
        if(txt) anyText=true;
        if(val!==null && val!=='') anyVal=true;
        cells.push({t:txt, v:val, tag:inp?inp.tagName:''});
      }
      if(anyText||anyVal){
        out.push({table:ti, row:ri, nTd:tds.length, heads:ti===0?heads:[], cells:cells});
      }
    }
  }
  return JSON.stringify({n:out.length, rows:out.slice(0,4)}).slice(0,7000);
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
  log('选期次 14：' + await page.eval(JS_PICK))
  await sleep(7000)

  /* 先自检表达式本身没有语法错 */
  const chk = await page.eval('typeof (function(){return 1})()')
  log('表达式自检 = ' + chk)

  const raw = await page.eval(JS_ALL)
  const o = JSON.parse(raw)
  log('有内容行数 = ' + o.n)
  for (const r of o.rows) {
    log('')
    log('【table ' + r.table + ' / row ' + r.row + '】td 数 = ' + r.nTd)
    if (r.heads.length) log('  表头 = ' + JSON.stringify(r.heads))
    r.cells.forEach((c, i) => {
      const h = r.heads[i] || ('col' + i)
      if (c.t || (c.v !== null && c.v !== '')) {
        log('   [' + h + '] text="' + c.t + '"' + (c.v !== null ? ' value="' + c.v + '"(' + c.tag + ')' : ''))
      }
    })
  }
  const errs = page.errors.slice()
  log('')
  log('错误 ' + errs.length + ' 条'); errs.slice(0, 6).forEach(e => log('   ' + e.slice(0, 170)))
} catch (e) { log('异常：' + (e && e.message)) }
finally { if (browser) { try { await browser.close() } catch { } } }
