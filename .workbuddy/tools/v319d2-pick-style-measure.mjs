/**
 * v319d2 商品目标「选中态」真实配色精确测量（生产只读）
 * ============================================================
 * 起因：v319d 探针在点击后用 CDP 派发过 `mouseMoved` ⇒ 鼠标仍停在该行上，
 *       读到的 background 是 **:hover 色**（`--bg2 = #f5f5f7`），不是真正的选中色。
 *
 * 🔴 本项目 CSS 层叠优先级实测（ProductTarget.vue）：
 *     `.pt-pick-item.on`                = (0,2,0)
 *     `.pt-pick-item:hover:not(.dis)`   = (0,3,0)   ← **更高**
 *   ⇒ 鼠标停在选中行上时，**hover 色盖住选中色**；语义还倒置了：
 *     选中色 = `rgba(6,182,212,.06)`（6% 透明青），hover 色 = `#f5f5f7`（实心浅灰）。
 *   ⇒ 本探针必须**把鼠标移开**再读，才是用户真正看到的那个颜色。
 *
 * 只读纪律同 v319d：只开弹窗、点商品行；绝不点保存。
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

/* 读「选中行 / 相邻行 / 列表容器 / 弹窗」四层底色，并计算与背景的色距 */
const JS_READ = `(function(){
  function rgb(s){ var m=String(s).match(/[\\d.]+/g)||[]; return m.slice(0,3).map(Number) }
  function dist(a,b){ return Math.round(Math.sqrt((a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2)) }
  var items=[].slice.call(document.querySelectorAll('.pt-pick-item'));
  var ons=items.filter(function(e){return e.classList.contains('on')});
  var modal=document.querySelector('.pt-modal');
  var list=document.querySelector('.pt-pick-list');
  var mBg=getComputedStyle(modal).backgroundColor, lBg=getComputedStyle(list).backgroundColor;
  var out={ modalBg:mBg, listBg:lBg, onCount:ons.length, rows:[] };
  ons.forEach(function(e){
    var k=items.indexOf(e), cs=getComputedStyle(e);
    var prev=items[k-1], next=items[k+1];
    out.rows.push({
      text:(e.textContent||'').slice(0,30),
      bg:cs.backgroundColor, fw:cs.fontWeight, outline:cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor,
      borderLeft:cs.borderLeftWidth+' '+cs.borderLeftColor,
      prevBg: prev? getComputedStyle(prev).backgroundColor : null,
      nextBg: next? getComputedStyle(next).backgroundColor : null,
      distToModal: dist(rgb(cs.backgroundColor), rgb(mBg)),
      distToNext: next? dist(rgb(cs.backgroundColor), rgb(getComputedStyle(next).backgroundColor)) : null,
    });
  });
  return JSON.stringify(out)
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

  /* 点第一个可点行（用真实鼠标，与用户操作一致） */
  const info = JSON.parse(await page.eval(`(function(){
    var e=document.querySelector('.pt-pick-item:not(.dis)');
    e.scrollIntoView({block:'center'});
    var r=e.getBoundingClientRect();
    return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,cy:r.top+r.height/2,
      text:(e.textContent||'').slice(0,40)})
  })()`))
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: info.x, y: info.cy })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.cy, button: 'left', clickCount: 1 })
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.cy, button: 'left', clickCount: 1 })
  await sleep(500)
  console.log('点了：' + info.text)

  /* ① 鼠标仍停在行上 → hover 色 */
  const hovered = JSON.parse(await page.eval(JS_READ))
  await page.screenshot(OUT + '/05-on-hover.png')

  /* ② 把鼠标移到窗口左上角空白 → 真正的选中色 */
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 })
  await sleep(500)
  const resting = JSON.parse(await page.eval(JS_READ))
  await page.screenshot(OUT + '/06-on-resting.png')

  const show = (tag, s) => {
    console.log('\n【' + tag + '】选中行数=' + s.onCount)
    s.rows.forEach(r => console.log('   行「' + r.text + '」'
      + '  bg=' + r.bg + '  font-weight=' + r.fw
      + ' ｜ 与弹窗底色(' + s.modalBg + ')色距=' + r.distToModal
      + ' ｜ 与相邻行色距=' + r.distToNext))
  }
  show('鼠标停在选中行上（hover 态）', hovered)
  show('鼠标移开（用户真正看到的静止选中态）', resting)

  console.log('\n──────────────────────────────────────')
  const r0 = resting.rows[0]
  if (r0) {
    console.log('结论：选中行的真实底色 = ' + r0.bg
      + '，与弹窗白底色距仅 ' + r0.distToModal + '/441 ⇒ '
      + (r0.distToModal < 25 ? '肉眼几乎不可辨（这就是“点了没反应”的主因）' : '可辨'))
    console.log('对照：hover 底色 = ' + (r0.prevBg || '') + '，色距 '
      + (hovered.rows[0] ? hovered.rows[0].distToModal : '?') + '/441')
    console.log('继承样式：outline=' + r0.outline + '  border-left=' + r0.borderLeft
      + '  font-weight=' + r0.fw)
  }
  console.log('截图：' + OUT + '/05-on-hover.png（hover 态）、06-on-resting.png（静止选中态）')
} finally {
  await browser.close()
}
