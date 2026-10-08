/**
 * v400 「列设置齿轮 + 序号」可视取证（只读真机 https://hergent.cn）
 *
 * 产出两张放大图：
 *   01-序号列-齿轮在表头-序号在下方.png   —— 裁剪「序号列」上下一条（表头齿轮 → 表体序号）
 *   02-列设置菜单-压在齿轮上.png          —— 点开齿轮后，菜单**盖住**齿轮的实况
 *
 * 判据不是"看着像"：裁剪范围由**实测几何**（齿轮 rect ∪ 序号 rects）算出来，
 * 并打印注入前后的几何，供与 v400-col-cfg-probe.mjs 的数字互相对照。
 *
 * 运行：
 *   V400_TOKEN=$(ssh -o BatchMode=yes root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v400-col-cfg-shot.mjs
 */
import { launch } from './lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.V400_TOKEN || ''
const OUT = process.env.V400_OUT || 'outputs/列设置与序号-v400-2026-10-08'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const INIT = `
;(function(){
  try{
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant','1');
    localStorage.setItem('hergent_v2_csrf','probe-csrf');
    localStorage.setItem('hergent_v2_user', JSON.stringify({id:2,username:'boss',role:'boss',roles:['boss'],name:'老板'}));
  }catch(e){}
})();
`

const GEO = `(function(){
  var tbl = document.querySelector('.view-wrap .cross-tbl');
  if (!tbl) return JSON.stringify({err:'no .cross-tbl'});
  var R = function(el){ var r = el.getBoundingClientRect(); return {l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom),w:Math.round(r.width),h:Math.round(r.height)}; };
  var out = {};
  var th0 = tbl.querySelector('thead th');
  out.th0 = R(th0);
  var gear = tbl.querySelector('thead .col-cfg.gear');
  out.gear = gear ? R(gear) : null;
  var nums = tbl.querySelectorAll('tbody td.seq-cell .seq-num');
  out.nums = [];
  for (var i=0;i<Math.min(6,nums.length);i++){ var o=R(nums[i]); o.text=nums[i].textContent.trim(); out.nums.push(o); }
  out.numCount = nums.length;
  return JSON.stringify(out);
})();`

const OPEN = `(async function(){
  var tbl = document.querySelector('.view-wrap .cross-tbl');
  var gear = tbl && tbl.querySelector('thead .col-cfg.gear');
  if (!gear) return JSON.stringify({err:'no gear'});
  gear.click();
  await new Promise(function(r){setTimeout(r,400);});
  var menu = document.querySelector('.col-menu');
  var R = function(el){ var r = el.getBoundingClientRect(); return {l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom),w:Math.round(r.width),h:Math.round(r.height)}; };
  var g = gear.getBoundingClientRect();
  return JSON.stringify({
    menu: menu ? R(menu) : null,
    gear: { l: Math.round(g.left), t: Math.round(g.top), r: Math.round(g.right), b: Math.round(g.bottom), w: Math.round(g.width), h: Math.round(g.height) },
    covers: menu ? (menu.getBoundingClientRect().top <= g.bottom && menu.getBoundingClientRect().bottom >= g.top) : null
  });
})();`

const main = async () => {
  if (!TOKEN) { console.error('缺 V400_TOKEN'); process.exit(2) }
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch({ headless: true })
  const p = await browser.newPage()
  await p.enable()
  const id = await p.addInitScript(INIT)
  try {
    await p.raw.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await p.goto(BASE + '/#/forecast', 5000)
    let g = JSON.parse(await p.eval(GEO))
    for (let i = 0; i < 4 && (g.err || !g.gear || !g.numCount); i++) { await sleep(2500); g = JSON.parse(await p.eval(GEO)) }
    if (g.err) throw new Error('页面没量到：' + g.err)
    console.log('实测几何 = ' + JSON.stringify(g))

    /* ① 序号列上下一条：齿轮（表头）→ 前 6 个序号（表体） */
    const x0 = Math.min(g.gear.l, g.nums[0].l) - 22
    const x1 = Math.max(g.gear.r, g.nums[0].r) + 22
    const y0 = g.gear.t - 26
    const y1 = g.nums[Math.min(5, g.nums.length - 1)].b + 22
    await p.screenshot(OUT + '/01-序号列-齿轮在表头-序号在下方.png', {
      clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0, scale: 3 },
    })
    console.log('① 裁 ' + [x0, y0, x1 - x0, y1 - y0].join(',') + ' scale=3')

    /* ② 点开齿轮：菜单压在齿轮上的实况 */
    const o = JSON.parse(await p.eval(OPEN))
    console.log('菜单 = ' + JSON.stringify(o))
    if (o.menu) {
      const mx0 = Math.min(o.menu.l, o.gear.l) - 20
      const mx1 = Math.max(o.menu.r, o.gear.r) + 20
      const my0 = Math.min(o.menu.t, o.gear.t) - 20
      const my1 = Math.max(o.menu.b, o.gear.b) + 20
      await p.screenshot(OUT + '/02-列设置菜单-压在齿轮上.png', {
        clip: { x: mx0, y: my0, width: mx1 - mx0, height: Math.min(my1 - my0, 1000), scale: 2 },
      })
      console.log('② 裁 ' + [mx0, my0, mx1 - mx0, my1 - my0].join(',') + ' scale=2  覆盖齿轮=' + o.covers)
    }
    console.log('\n落盘：' + OUT)
  } finally {
    await p.removeInitScript(id)
    await browser.close()
  }
}
main().catch(e => { console.error('截图异常：' + e.message); process.exit(1) })
