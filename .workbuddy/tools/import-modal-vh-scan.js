// 扫描视口高度，定位「品牌按钮与导入弹窗重叠」的临界区间
// 用法：NODE_PATH=<ws>/node_modules node import-modal-vh-scan.js [baseUrl]
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = process.argv[2] || 'https://hergent.cn';
const WIDTHS = [1440, 1920];
const VHS = [];
for (let h = 620; h <= 1500; h += 20) VHS.push(h);

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await p.goto(BASE + '/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3500);
  await p.evaluate(() => { const a = [...document.querySelectorAll('a')].find(x => /预报订货|预报/.test(x.textContent)); a && a.click(); });
  await sleep(4500);
  await p.evaluate(() => {
    const sel = document.querySelector('select.sel-period');
    if (sel && sel.value === '0') {
      const opt = [...sel.options].find(o => o.value && o.value !== '0');
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }
  });
  await sleep(4000);

  for (const W of WIDTHS) {
    console.log(`\n########## 视口宽 ${W} ##########`);
    console.log('视口高  弹窗rect(t-b)   品牌rect(t-b)   重叠  命中(品牌按钮中心)        遮罩是否拦住品牌按钮');
    const hits = [];
    for (const VH of VHS) {
      await p.setViewport({ width: W, height: VH, deviceScaleFactor: 1 });
      await sleep(220);
      await p.evaluate(() => {
        const open = [...document.querySelectorAll('button')].find(x => /导入/.test(x.textContent) && !x.disabled);
        if (!document.querySelector('.imp-modal') && open) open.click();
      });
      await sleep(320);
      const r = await p.evaluate(() => {
        const R = el => { const r = el.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), rt: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; };
        const modal = document.querySelector('.imp-modal');
        const brand = document.querySelector('.grid-ctl-row .tb-pop');
        if (!modal || !brand) return { err: !modal ? 'no-modal' : 'no-brand' };
        const mr = R(modal), br = R(brand);
        const overlap = !(br.rt < mr.l || br.l > mr.rt || br.b < mr.t || br.t > mr.b);
        let hit = null;
        if (overlap) {
          const cx = Math.round(br.l + br.w / 2), cy = Math.round(br.t + br.h / 2);
          const top = document.elementFromPoint(cx, cy);
          hit = { topEl: top ? (top.tagName.toLowerCase() + '.' + (top.className || '').toString().split(' ')[0]) : null, inModal: top ? !!top.closest('.imp-modal') : false, inTbPop: top ? !!top.closest('.tb-pop') : false };
        }
        // 遮罩能否拦住品牌按钮（无论是否重叠）
        const bcx = Math.round(br.l + br.w / 2), bcy = Math.round(br.t + br.h / 2);
        let ovl = 'offscreen';
        if (bcx >= 0 && bcy >= 0 && bcx < innerWidth && bcy < innerHeight) {
          const t = document.elementFromPoint(bcx, bcy);
          ovl = t ? (t.closest('.tb-pop') || t.closest('.tb-pop-panel') ? 'NO-可点穿' : (t.closest('.imp-modal') ? 'n/a(在弹窗下)' : 'ok')) : '?';
        }
        return { mr, br, overlap, hit, ovl, modalH: mr.h };
      });
      if (r.err) { console.log(`${VH}  ${r.err}`); continue; }
      const mark = r.overlap && r.hit && r.hit.inTbPop ? '  <<< 遮挡' : '';
      if (r.overlap) hits.push(VH);
      console.log(`${String(VH).padEnd(7)} ${('t' + r.mr.t + '-b' + r.mr.b).padEnd(15)} ${('t' + r.br.t + '-b' + r.br.b).padEnd(15)} ${String(r.overlap).padEnd(5)} ${(r.hit ? (r.hit.topEl + ' inTbPop=' + r.hit.inTbPop) : '-').padEnd(25)} ${r.ovl}${mark}`);
    }
    console.log(`→ 重叠视口高: ${hits.length ? hits[0] + '~' + hits[hits.length - 1] + '（共 ' + hits.length + ' 档）' : '无'}`);
  }
  await b.close();
})();
