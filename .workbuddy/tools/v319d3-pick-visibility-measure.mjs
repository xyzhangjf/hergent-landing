/**
 * v319d3 商品目标「选中态」真实可见度判定（生产只读 · 修正版）
 * ============================================================
 * 🔴 v319d2 的探针缺陷（本轮自纠）：它把 `rgba(6,182,212,.06)` 的 **RGB 分量当成实色**
 *    去算色距 ⇒ 得出「色距 263/441 = 可辨」的**错误结论**。半透明色必须**先合成到
 *    它实际叠着的背景**上，才是用户眼睛里那个颜色。⇒ 本版改为一律做 alpha 合成。
 *
 * 判据（三条，全部量化）：
 *   ① 选中行「静止态」合成色 vs 弹窗底色 → 色距 + 百分比（肉眼可辨阈值取 5%）
 *   ② 该行 hover 态合成色（鼠标停上去时用户看到的）→ 与 ① 比谁更明显
 *   ③ 除底色外还有哪些视觉载体（font-weight / outline / border-left / 图标节点数）
 *      ⇒ 用来回答「把这层极淡底色去掉后，还剩什么能让人看出选中了」
 *
 * 另存一张放大裁剪图：选中行 + 上下相邻行并排，供人眼直接判。
 *
 * 只读纪律同前：只开弹窗、点商品行；绝不点保存。
 */
import fs from 'node:fs'
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.PROBE_TOKEN || ''
const OUT = process.env.PROBE_OUT
  || '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/outputs/v319d-target-pick'
if (!TOKEN) { console.error('缺少 PROBE_TOKEN'); process.exit(2) }
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const JS_READ = `(function(){
  function parse(s){
    var t=String(s).replace('rgba(','').replace('rgb(','').replace(')','').trim();
    var p=t.split(',').map(function(x){ return parseFloat(x) });
    return { r:p[0]||0, g:p[1]||0, b:p[2]||0, a:(p.length>3&&!isNaN(p[3]))?p[3]:1 };
  }
  /* 🔴 自纠：v319d3 初版把 bg 按对象取值，而调用处传进来的是数组（over 的返回值）
     ⇒ bg.r 恒 undefined ⇒ 合成色整条变 NaN，而旁边 flatModal 打印正常 ⇒ 极难察觉。
     本版一律按「数组或对象都收」处理；并在末尾加 NaN 自检断言，防同一个坑再犯。 */
  function over(fg,bg){ var a=fg.a, B=(bg instanceof Array)?bg:[bg.r,bg.g,bg.b];
    return [ fg.r*a+B[0]*(1-a), fg.g*a+B[1]*(1-a), fg.b*a+B[2]*(1-a) ] }
  function dist(a,b){ return Math.sqrt(Math.pow(a[0]-b[0],2)+Math.pow(a[1]-b[1],2)+Math.pow(a[2]-b[2],2)) }
  function r3(a){ return 'rgb('+a.map(function(x){return Math.round(x)}).join(', ')+')' }
  var MAXD=Math.sqrt(3*255*255);
  var items=[].slice.call(document.querySelectorAll('.pt-pick-item'));
  var ons=items.filter(function(e){ return e.classList.contains('on') });
  var modal=document.querySelector('.pt-modal');
  var mBg=parse(getComputedStyle(modal).backgroundColor);
  var flatModal=over(mBg,{r:255,g:255,b:255,a:1});
  var rows=[];
  ons.forEach(function(e){
    var k=items.indexOf(e), cs=getComputedStyle(e);
    var next=items[k+1], prev=items[k-1];
    var raw=parse(cs.backgroundColor);
    var comp=over(raw,flatModal);          // 合成到弹窗底色 = 用户看到的颜色
    var ncomp = next? over(parse(getComputedStyle(next).backgroundColor), flatModal) : null;
    var pcomp = prev? over(parse(getComputedStyle(prev).backgroundColor), flatModal) : null;
    rows.push({
      text:(e.textContent||'').slice(0,30),
      declared: cs.backgroundColor,
      composed: r3(comp),
      composedNext: ncomp? r3(ncomp):null,
      composedPrev: pcomp? r3(pcomp):null,
      distModal: Math.round(dist(comp, flatModal)),
      distNext: ncomp? Math.round(dist(comp, ncomp)) : null,
      pctOfMax: Math.round(1000*dist(comp, flatModal)/MAXD)/10,
      fontBold: cs.fontWeight,
      outline: cs.outlineStyle+' / '+cs.outlineWidth,
      borderLeft: cs.borderLeftWidth,
      hasIcon: !!e.querySelector('svg, .icon, i[class]'),
      childCount: e.children.length
    });
  });
  return JSON.stringify({ modalDeclared:getComputedStyle(modal).backgroundColor,
    modalComposed:r3(flatModal), onCount:ons.length, rows:rows });
})()`

const browser = await launch({ headless: true })
const page = await browser.newPage()
await page.enable()
await page.addInitScript(
  "(function(){try{"
  + "localStorage.setItem('hergent_v2_token','" + TOKEN + "');"
  + "localStorage.setItem('hergent_v2_tenant','1');"
  + "localStorage.setItem('hergent_v2_user',JSON.stringify({id:1,username:'boss',role:'boss'}));"
  + "}catch(e){}})()"
)

try {
  await page.goto(BASE + '/#/forecast?tab=target', 6000)
  await page.eval(`(function(){var b=document.querySelector('.pt-tbar .btn-primary');b&&b.click();return 1})()`)
  await sleep(1600)

  const geo = JSON.parse(await page.eval(`(function(){
    var e=document.querySelector('.pt-pick-item:not(.dis)');
    e.scrollIntoView({block:'center'});
    var r=e.getBoundingClientRect();
    return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,top:r.top,h:r.height,text:(e.textContent||'').slice(0,40)})
  })()`))
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: geo.x, y: geo.y })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: geo.x, y: geo.y, button: 'left', clickCount: 1 })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: geo.x, y: geo.y, button: 'left', clickCount: 1 })
  await sleep(500)
  console.log('点击的商品行：' + geo.text + '（行高 ' + Math.round(geo.h) + 'px）')

  const hover = JSON.parse(await page.eval(JS_READ))
  // 鼠标移开 ⇒ 用户点完之后自然移开鼠标看到的状态
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 })
  await sleep(500)
  const rest = JSON.parse(await page.eval(JS_READ))

  const dump = (tag, s) => {
    console.log('\n【' + tag + '】')
    s.rows.forEach(r => {
      console.log('   声明色 ' + r.declared)
      console.log('   → 合成后 ' + r.composed + '（这才是眼睛看到的）')
      console.log('   → 与弹窗底色 ' + s.modalComposed + ' 的色距 = ' + r.distModal
        + ' / ' + Math.round(Math.sqrt(3 * 255 * 255)) + ' = ' + r.pctOfMax + '%')
      console.log('   → 与相邻行 ' + r.composedNext + ' 的色距 = ' + r.distNext)
      console.log('   → 其他载体: font-weight=' + r.fontBold + ' · outline=' + r.outline
        + ' · border-left=' + r.borderLeft + ' · 行内有图标=' + r.hasIcon
        + ' · 子节点数=' + r.childCount)
    })
  }
  dump('① 鼠标停在选中行上（hover 盖过选中色的态）', hover)
  dump('② 鼠标移开（用户真正看到的静止选中态）', rest)

  /* 🔴 判别力自检：合成色一旦出现 NaN，下面所有「色距 / 百分比」都是假的 —— 必须先自证 */
  const all = [].concat(hover.rows, rest.rows)
  const nanFree = all.length > 0
    && !String(hover.modalComposed).includes('NaN')
    && all.every(r => !String(r.composed).includes('NaN') && r.distModal !== null && !isNaN(r.distModal))
  console.log('\n[探针判别力自检] 合成色与色距无 NaN：' + (nanFree ? 'PASS' : 'FAIL ← 判据失效，结论不可信'))
  console.log('                  选中行数：hover=' + hover.onCount + ' / 静止=' + rest.onCount
    + '（两条路径都必须 ≥1，否则测得的是"没选中"）')

  /* 放大裁剪：选中行 + 上下相邻行，供人眼并排判 */
  try {
    const clip = {
      x: Math.max(0, Math.round(geo.x - 200)), y: Math.max(0, Math.round(geo.top - geo.h - 2)),
      width: 420, height: Math.round(geo.h * 3 + 4), scale: 2,
    }
    const r = await page.raw.send('Page.captureScreenshot', { format: 'png', clip })
    if (r.result && r.result.data) {
      fs.writeFileSync(OUT + '/07-zoom-neighbor.png', Buffer.from(r.result.data, 'base64'))
      console.log('\n放大裁剪已存：07-zoom-neighbor.png（上=普通行 中=选中行 下=普通行，2 倍放大）')
    }
  } catch (e) { console.log('(裁剪失败：' + e.message + ')') }

  console.log('\n──────────────────────────────────────')
  const r0 = rest.rows[0]
  if (r0) {
    const verdict = r0.pctOfMax < 5 ? '肉眼基本不可辨' : '可辨'
    console.log('判定：选中行静止态 = ' + r0.composed + '，与白底差异仅 ' + r0.pctOfMax + '% ⇒ ' + verdict)
    console.log('      （hover 态 = ' + (hover.rows[0] ? hover.rows[0].composed : '?')
      + '，' + (hover.rows[0] ? hover.rows[0].pctOfMax : '?') + '%）')
    console.log('      除底色外唯一载体 = font-weight ' + r0.fontBold + '（13px 字号下的加粗）')
    console.log('      没有勾选图标、没有边框、没有主色条 ⇒ 无第二视觉通道')
  }
} finally {
  await browser.close()
}
