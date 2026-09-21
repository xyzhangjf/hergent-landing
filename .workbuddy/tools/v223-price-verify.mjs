/* v223 真机验收（只读，绝不点「保存」）
   目标：证明线上预报页「单价(厂价/箱)」列 = 商品档案的厂价本身（不再被乘每箱数），
        且「下单金额 = 最终下单(箱) × 单价」这条链在真实渲染里逐行自洽。
   纪律：① 编辑态单元格多为 <input> ⇒ 必须读 input.value / placeholder，不能只读 innerText
        ② 汇总表是视口渲染、编辑态是全量渲染 ⇒ 用「改单」态取全量
        ③ 绝不点任何写按钮 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BASE = 'https://hergent.cn'

const LOGIN = [
  'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},',
  'body:JSON.stringify({username:"mptestsp",password:"Mpsup@1"})}).then(r=>r.json()).then(function(d){',
  'localStorage.setItem("hergent_v2_token",d.token);',
  'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);',
  'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));',
  'localStorage.setItem("hergent_v2_tenant",String(d.tenant_id||1));return "OK"})',
].join('')

/* 取「改单」网格：表头 + 逐行（单元格文本 / input.value / placeholder） */
const DUMP = `
(function(){
  var t=document.querySelectorAll('table')[0]; if(!t) return JSON.stringify({err:'NO_TABLE'});
  var th=t.querySelector('thead tr'); var heads=[];
  if(th){var hc=th.querySelectorAll('th,td'); for(var k=0;k<hc.length;k++)heads.push((hc[k].innerText||'').trim())}
  var trs=t.querySelectorAll('tbody tr'); var out=[];
  for(var ri=0;ri<trs.length;ri++){
    var tds=trs[ri].querySelectorAll('td'); var cells=[];
    for(var ci=0;ci<tds.length;ci++){
      var c=tds[ci]; var inp=c.querySelector('input,textarea');
      cells.push({
        h: heads[ci]||('c'+ci),
        v: inp?String(inp.value!==undefined?inp.value:''):null,
        ph: inp?String(inp.placeholder||''):null,
        t: (c.innerText||'').trim().replace(/\\s+/g,' ')
      })
    }
    out.push(cells)
  }
  return JSON.stringify({heads:heads,rows:out}).slice(0,900000)
})()`

const b = await launch()
const p = await b.newPage()
await p.enable()
await p.goto(BASE, 3500)
await p.eval(LOGIN)
await p.goto(BASE + '/#/forecast', 6000)
await sleep(5000)

/* 选期次 14（v222 真机验收同款，含 27 行真实报单） */
console.log('选期次14：' + await p.eval(`(function(){
  var s=document.querySelector('select.sel-period')||document.querySelector('select');
  if(!s) return 'NO_SELECT';
  for(var j=0;j<s.options.length;j++){ if(String(s.options[j].value)==='14'){
    s.value='14'; s.dispatchEvent(new Event('change',{bubbles:true})); return 'OK' } }
  return 'NO_P14'})()`))
await sleep(7000)

/* 点「改单」进入全量编辑网格 */
console.log('点改单：' + await p.eval(`(function(){
  var bs=Array.from(document.querySelectorAll('button'));
  var x=bs.find(function(e){return (e.innerText||'').trim()==='改单'});
  if(!x) return 'NF'; x.click(); return 'OK'})()`))
await sleep(9000)

const raw = await p.eval(DUMP)
let d
try { d = JSON.parse(raw) } catch (e) { console.log('解析失败：' + String(raw).slice(0, 300)); await b.close(); process.exit(1) }
if (d.err) { console.log('ERR ' + d.err); await b.close(); process.exit(1) }

console.log('表头（' + d.heads.length + ' 列）：' + d.heads.join(' | '))
console.log('数据行 = ' + d.rows.length)

/* 建「商品名 → 档案厂价/每箱数」映射（页面内 fetch，带 token） */
const mapRaw = await p.eval(`(function(){
  var t=localStorage.getItem('hergent_v2_token'), tn=localStorage.getItem('hergent_v2_tenant')||'1';
  return fetch('/api/products/grid?limit=2000',{headers:{Authorization:'Bearer '+t,'X- Tenant-Id':tn}})
    .then(function(r){return r.json()}).then(function(d){
      var m={}; (d.items||[]).forEach(function(x){ m[String(x.name)]={
        fp:(Number(x.factory_price)||0)>0?(Number(x.factory_price)||0):(Number(x.purchase_price)||0),
        raw_fp:Number(x.factory_price)||0, lr:Number(x.large_ratio)||0, unit:x.unit||'', spec:x.spec||'' } });
      return JSON.stringify(m) })})()`.replace('X- Tenant-Id', 'X-Tenant-Id'))
let pmap = {}
try { pmap = JSON.parse(mapRaw) } catch (e) { console.log('商品映射解析失败：' + String(mapRaw).slice(0, 200)) }
console.log('商品档案映射 = ' + Object.keys(pmap).length + ' 个')

const col = (heads, ...kw) => heads.findIndex((h) => kw.some((k) => h && h.indexOf(k) >= 0))
const hName = col(d.heads, '商品名称', '商品')
const hQty = col(d.heads, '合计(小单位)')
const hBox = col(d.heads, '合计(箱)')
const hPrice = col(d.heads, '单价')
const hFinal = col(d.heads, '最终下单')
const hAmount = col(d.heads, '下单金额')
console.log('列定位：名称=' + hName + ' 合计(小单位)=' + hQty + ' 合计(箱)=' + hBox + ' 单价=' + hPrice + ' 最终下单=' + hFinal + ' 下单金额=' + hAmount)

const get = (row, i) => (i >= 0 && row[i] ? (row[i].v !== null && row[i].v !== '' ? row[i].v : (row[i].ph || row[i].t)) : '')
const num = (s) => { const v = parseFloat(String(s == null ? '' : s).replace(/[,，¥\s/箱]/g, '')); return isNaN(v) ? null : v }

let seen = 0, okPrice = 0, badPrice = [], okAmt = 0, badAmt = [], miss = []
const shown = []
for (const row of d.rows) {
  const name = String(get(row, hName) || '').trim()
  if (!name) continue
  const qty = num(get(row, hQty))
  const box = get(row, hBox)
  const price = num(get(row, hPrice))
  const final = num(get(row, hFinal))
  const amt = num(get(row, hAmount))
  const meta = pmap[name]
  seen++
  if (price != null && meta && meta.fp > 0) {
    if (Math.abs(price - meta.fp) < 0.02) okPrice++
    else badPrice.push({ name: name.slice(0, 26), shown: price, archive_fp: meta.fp, lr: meta.lr, inflated: Math.round(meta.fp * meta.lr * 100) / 100 })
    if (shown.length < 12) shown.push({ name: name.slice(0, 24), qty, box, price, archive_fp: meta.fp, lr: meta.lr, final, amt })
  } else if (price != null && (!meta || meta.fp <= 0)) {
    miss.push({ name: name.slice(0, 24), price })
  }
  if (price != null && final != null && amt != null) {
    if (Math.abs(final * price - amt) < 0.02) okAmt++
    else badAmt.push({ name: name.slice(0, 24), final, price, amt, should: Math.round(final * price * 100) / 100 })
  }
}

console.log('\n--- 单价抽样（页面显示 vs 档案厂价 vs 「乘过」的错值）---')
shown.forEach((r) => console.log(
  '  ' + String(r.name).padEnd(26) + ' 数量=' + String(r.qty).padStart(6) +
  ' 箱=' + String(r.box).padStart(7) + ' 单价=' + String(r.price).padStart(8) +
  ' | 档案厂价=' + String(r.archive_fp).padStart(8) + ' lr=' + String(r.lr).padStart(4) +
  ' 错值(×lr)=' + String(r.inflated).padStart(10)))

console.log('\n★ 单价 == 档案厂价 ：' + okPrice + ' 行通过 ／ ' + badPrice.length + ' 行不符')
badPrice.slice(0, 8).forEach((r) => console.log('   ✗ ' + r.name + ' 显示=' + r.shown + ' 档案=' + r.archive_fp + ' lr=' + r.lr + ' 若乘过应为=' + r.inflated))
console.log('★ 下单金额 == 最终下单 × 单价 ：' + okAmt + ' 行通过 ／ ' + badAmt.length + ' 行不符')
badAmt.slice(0, 8).forEach((r) => console.log('   ✗ ' + r.name + ' 最终=' + r.final + ' 单价=' + r.price + ' 金额=' + r.amt + ' 应为=' + r.should))
if (miss.length) console.log('（无档案厂价 / 映射未命中 ' + miss.length + ' 行，如：' + miss.slice(0, 3).map((x) => x.name + '@' + x.price).join(' , ') + '）')

console.log('\n页面错误数 = ' + p.errors.length)
if (p.errors.length) console.log(p.errors.slice(0, 3).join('\n'))
const shot = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/客户列删除被恢复排查-2026-09-19/v223-真机-单价列-20260921.png'
try { await p.screenshot(shot); console.log('截图：' + shot) } catch (e) { console.log('截图失败：' + e.message) }
await b.close()
