/**
 * v401 「两处偏差已修」可视取证（只读真机 https://hergent.cn）
 *
 * 与 v400-col-cfg-shot.mjs 是**同一机位的改后对照**：v400 那两张拍的是「坏」，
 * 本脚本拍的是「好」。产出三张：
 *   01-序号列-齿轮已居中.png        —— 序号列上下一条 + **注入红色中轴线**
 *                                      证明齿轮 cx 与序号 cx **同轴**（改前偏 4px）
 *   02-列设置菜单-在齿轮下方.png    —— 点开齿轮后，菜单 t > 齿轮 b（**不遮挡**）
 *   03-试点页-采购单列表-序号列.png —— 进销存采购单列表的序号列（v401 新接入）
 *
 * 判据不是"看着像"：
 *   01 的中轴线画在「表头单元格（th0）的水平中点」，齿轮与序号**都应当被它平分**。
 *   02 直接量 menu.t 与 gear.b 并打印，供与 v400-col-cfg-probe.mjs 的 spec 相位互证。
 *   03 同时验「表头首列文字=序号」「表体序号=1,2,3…」「本页未写库」。
 *
 * 运行：
 *   V401_TOKEN=$(ssh -o BatchMode=yes root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v401-col-cfg-shot.mjs
 */
import { launch } from './lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.V401_TOKEN || ''
const OUT = process.env.V401_OUT || 'outputs/列设置与序号-v401-2026-10-08'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const INIT = `
;(function(){
  try{
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant','1');
    localStorage.setItem('hergent_v2_csrf','probe-csrf');
    localStorage.setItem('hergent_v2_user', JSON.stringify({id:2,username:'boss',role:'boss',roles:['boss'],name:'老板'}));
    window.__WRITES = [];
    var of = window.fetch;
    window.fetch = function(u, o){
      try{
        var m = (o && o.method ? o.method : 'GET').toUpperCase();
        var s = (typeof u === 'string') ? u : (u && u.url ? u.url : '');
        if (m !== 'GET' && m !== 'HEAD' && s.indexOf('/api/') >= 0) window.__WRITES.push(m + ' ' + s);
      }catch(e){}
      return of.apply(this, arguments);
    };
  }catch(e){}
})();
`

/* ---- Forecast 查看态几何 + 注入中轴线 ---- */
const GEO_FORECAST = `(function(){
  var tbl = document.querySelector('.view-wrap .cross-tbl');
  if (!tbl) return JSON.stringify({err:'no .cross-tbl'});
  var R = function(el){ var r = el.getBoundingClientRect(); return {l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom),w:Math.round(r.width),h:Math.round(r.height),cx:Math.round((r.left+r.right)/2),cy:Math.round((r.top+r.bottom)/2)}; };
  var out = {};
  var th0 = tbl.querySelector('thead th');
  out.th0 = R(th0);
  var gear = tbl.querySelector('thead .col-cfg.gear');
  out.gear = gear ? R(gear) : null;
  var nums = tbl.querySelectorAll('tbody td.seq-cell .seq-num');
  out.nums = [];
  for (var i=0;i<Math.min(6,nums.length);i++){ var o=R(nums[i]); o.text=nums[i].textContent.trim(); out.nums.push(o); }
  out.numCount = nums.length;
  out.gearCx = out.gear ? out.gear.cx : null;
  out.numCx = out.nums.length ? out.nums[0].cx : null;
  out.deltaCx = (out.gearCx !== null && out.numCx !== null) ? (out.gearCx - out.numCx) : null;
  return JSON.stringify(out);
})();`

/* 注入可视判据（仅供截图，不影响生产）：
   ① 在「表头单元格水平中点」画一条红色中轴线；
   ② 给齿轮与每个 .seq-num 画 1px 红框。
   若三者同轴 ⇒ 红线**同时平分**齿轮框与每个数字框（改前齿轮框会整体偏在红线左侧）。 */
const GUIDE = `(function(){
  var tbl = document.querySelector('.view-wrap .cross-tbl');
  if (!tbl) return 'no table';
  var olds = document.querySelectorAll('[id^="v401-g"]');
  for (var k=0;k<olds.length;k++) olds[k].remove();
  var th0 = tbl.querySelector('thead th');
  var r = th0.getBoundingClientRect();
  var cx = (r.left + r.right) / 2;
  var nums0 = tbl.querySelectorAll('tbody td.seq-cell .seq-num');
  /* 中轴线从表头往上一点，一直贯穿到第 2 个序号的下沿 —— 让「齿轮与数字同轴」在一屏内可见 */
  var y0 = r.top - 14, y1 = r.bottom + 26;
  if (nums0.length > 1) y1 = nums0[1].getBoundingClientRect().bottom + 14;
  var line = document.createElement('div');
  line.id = 'v401-gline';
  line.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;left:' + (cx-0.5) + 'px;top:' + y0 + 'px;width:1px;height:' + (y1 - y0) + 'px;background:#e11';
  document.body.appendChild(line);
  function box(el, tag){
    var b = el.getBoundingClientRect();
    var d = document.createElement('div');
    d.id = 'v401-g' + tag;
    d.style.cssText = 'position:fixed;z-index:99998;pointer-events:none;left:' + b.left + 'px;top:' + b.top + 'px;width:' + b.width + 'px;height:' + b.height + 'px;border:1px solid rgba(221,17,17,.85);box-sizing:border-box';
    document.body.appendChild(d);
  }
  var gear = tbl.querySelector('thead .col-cfg.gear');
  if (gear) box(gear, 'gear');
  var nums = tbl.querySelectorAll('tbody td.seq-cell .seq-num');
  for (var i=0;i<Math.min(2,nums.length);i++) box(nums[i], 'n' + i);
  return JSON.stringify({cx: Math.round(cx), boxes: 1 + Math.min(2, nums.length)});
})();`

/* ---- 点开齿轮：量菜单与齿轮的相对位置 ---- */
const OPEN = `(async function(){
  var tbl = document.querySelector('.view-wrap .cross-tbl');
  var gear = tbl && tbl.querySelector('thead .col-cfg.gear');
  if (!gear) return JSON.stringify({err:'no gear'});
  gear.click();
  await new Promise(function(r){setTimeout(r,400);});
  var menu = document.querySelector('.col-menu');
  var R = function(el){ var r = el.getBoundingClientRect(); return {l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom),w:Math.round(r.width),h:Math.round(r.height)}; };
  var g = gear.getBoundingClientRect();
  var gr = { l: Math.round(g.left), t: Math.round(g.top), r: Math.round(g.right), b: Math.round(g.bottom), w: Math.round(g.width), h: Math.round(g.height) };
  var mr = menu ? R(menu) : null;
  return JSON.stringify({
    menu: mr,
    gear: gr,
    pos: menu ? (getComputedStyle(menu).position) : null,
    inlineTop: menu ? (menu.style.top || '') : '',
    inlineLeft: menu ? (menu.style.left || '') : '',
    /* 契约：菜单顶 > 齿轮底 ⇒ 不遮挡；Δl 越接近 0 越贴齿轮左缘 */
    belowNotCover: mr ? (mr.t > gr.b) : null,
    deltaL: mr ? (mr.l - gr.l) : null,
    deltaList: mr ? (mr.b - gr.b) : null
  });
})();`

/* ---- 试点页（进销存列表）序号列几何 ---- */
const PILOT_GEO = `(function(){
  var tbl = document.querySelector('table.tbl');
  if (!tbl) return JSON.stringify({err:'no table.tbl'});
  var R = function(el){ var r = el.getBoundingClientRect(); return {l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom),w:Math.round(r.width),h:Math.round(r.height)}; };
  var ths = tbl.querySelectorAll('thead tr:last-child th');
  var out = { thCount: ths.length, th0Text: ths[0] ? ths[0].textContent.trim() : '', th0: ths[0] ? R(ths[0]) : null, th0Cls: ths[0] ? ths[0].className : '' };
  var cells = tbl.querySelectorAll('tbody td.seq-cell');
  out.numCount = cells.length;
  out.cell0 = cells[0] ? R(cells[0]) : null;
  out.cell0Pos = cells[0] ? getComputedStyle(cells[0]).position : null;
  out.nums = [];
  for (var i=0;i<Math.min(4,cells.length);i++){
    var s = cells[i].querySelector('.seq-num');
    out.nums.push(s ? s.textContent.trim() : '');
  }
  return JSON.stringify(out);
})();`

const main = async () => {
  if (!TOKEN) { console.error('缺 V401_TOKEN'); process.exit(2) }
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch({ headless: true })
  const p = await browser.newPage()
  await p.enable()
  const id = await p.addInitScript(INIT)
  try {
    await p.raw.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })

    /* ============ ① Forecast：齿轮居中（带中轴） ============ */
    await p.goto(BASE + '/#/forecast', 5000)
    let g = JSON.parse(await p.eval(GEO_FORECAST))
    for (let i = 0; i < 4 && (g.err || !g.gear || !g.numCount); i++) { await sleep(2500); g = JSON.parse(await p.eval(GEO_FORECAST)) }
    if (g.err) throw new Error('Forecast 没量到：' + g.err)
    console.log('【①】Forecast 几何 = ' + JSON.stringify({
      th0: g.th0, gear: g.gear, gearCx: g.gearCx, numCx: g.numCx, deltaCx: g.deltaCx, numCount: g.numCount,
    }))
    console.log('    ★齿轮居中判据：齿轮 cx − 序号 cx = ' + g.deltaCx + 'px（v400 改前 = −4px ⇒ 序号右偏 4px）')

    const gi = JSON.parse(await p.eval(GUIDE))
    console.log('    注入中轴线 cx = ' + gi.cx + '（画在表头单元格水平中点）')

    const x0 = Math.min(g.th0.l, g.gear.l) - 18
    const x1 = Math.max(g.th0.r, g.nums[0].r) + 18
    const y0 = g.gear.t - 22
    const y1 = g.nums[Math.min(2, g.nums.length - 1)].b + 20
    await p.screenshot(OUT + '/01-序号列-齿轮已居中.png', {
      clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0, scale: 4 },
    })
    console.log('    ① 裁 ' + [x0, y0, x1 - x0, y1 - y0].join(',') + ' scale=4')

    /* ============ ② Forecast：菜单在齿轮下方 ============ */
    const o = JSON.parse(await p.eval(OPEN))
    console.log('【②】菜单 = ' + JSON.stringify(o))
    console.log('    ★不遮挡判据：menu.t(' + (o.menu && o.menu.t) + ') > gear.b(' + o.gear.b + ') ⇒ ' + o.belowNotCover +
      '；Δl=' + o.deltaL + 'px；菜单高=' + (o.menu && o.menu.h) + '（v400 改前 543、压住齿轮）')
    await p.eval(`(function(){var ds=document.querySelectorAll('[id^="v401-g"]');for(var i=0;i<ds.length;i++)ds[i].remove();return 'ok'})()`)
    if (o.menu) {
      const mx0 = Math.min(o.menu.l, o.gear.l) - 16
      const mx1 = Math.max(o.menu.r, o.gear.r) + 16
      const my0 = Math.min(o.menu.t, o.gear.t) - 16
      const my1 = Math.max(o.menu.b, o.gear.b) + 16
      await p.screenshot(OUT + '/02-列设置菜单-在齿轮下方.png', {
        clip: { x: mx0, y: my0, width: mx1 - mx0, height: Math.min(my1 - my0, 1020), scale: 2 },
      })
      console.log('    ② 裁 ' + [mx0, my0, mx1 - mx0, Math.min(my1 - my0, 1020)].join(',') + ' scale=2')
    }

    /* ============ ③ 试点页：进销存采购单列表 序号列 ============ */
    await p.goto(BASE + '/#/inventory/purchase', 5000)
    let q = JSON.parse(await p.eval(PILOT_GEO))
    for (let i = 0; i < 4 && (q.err || !q.thCount); i++) { await sleep(2500); q = JSON.parse(await p.eval(PILOT_GEO)) }
    if (q.err) throw new Error('试点页没量到：' + q.err)
    const writes = await p.eval('JSON.stringify(window.__WRITES || [])')
    console.log('【③】采购单列表 = ' + JSON.stringify({
      thCount: q.thCount, th0Text: q.th0Text, th0Cls: q.th0Cls, th0W: q.th0.w,
      cell0W: q.cell0 && q.cell0.w, cell0Pos: q.cell0Pos, numCount: q.numCount, nums: q.nums,
    }))
    console.log('    ★试点接入判据：表头首列文字="序号"(' + (q.th0Text === '序号') + ')｜列宽 46px(' + (q.th0.w === 46) + ')｜' +
      '表体非 sticky(' + (q.cell0Pos !== 'sticky') + ')｜序号=' + JSON.stringify(q.nums) + '｜本页写请求=' + writes)

    if (q.cell0) {
      const px0 = Math.min(q.th0.l, q.cell0.l) - 18
      const px1 = Math.max(q.th0.r, q.cell0.r) + 18
      const py0 = q.th0.t - 20
      /* 高 = 表头 + 前 6 行（用表体首格到第 6 行的实测底边，避免估行高） */
      const rowH = (q.cell0 && q.numCount > 1) ? Math.max(1, q.cell0.h) : 34
      const py1 = Math.min(q.th0.b + rowH * 6 + 20, 1080)
      await p.screenshot(OUT + '/03-试点页-采购单列表-序号列.png', {
        clip: { x: px0, y: py0, width: px1 - px0, height: py1 - py0, scale: 4 },
      })
      console.log('    ③ 裁 ' + [px0, py0, px1 - px0, py1 - py0].join(',') + ' scale=4')
    }

    console.log('\n落盘：' + OUT)
  } finally {
    await p.removeInitScript(id)
    await browser.close()
  }
}
main().catch(e => { console.error('截图异常：' + e.message); process.exit(1) })
