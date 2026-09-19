// 生成「修复前 / 修复后」视觉对照图（同一页面同一时刻，用 CSS 注入回退模拟修复前）
// 用法：NODE_PATH=<ws>/node_modules node import-modal-zindex-shot.js [baseUrl]
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = process.argv[2] || 'https://hergent.cn';
const OUTDIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs';

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 2 });   // 1200 = 实测遮挡区间
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
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /导入/.test(x.textContent) && !x.disabled); b && b.click(); });
  await sleep(1000);

  const CLIP = { x: 300, y: 400, width: 900, height: 300 };

  // ---- AFTER（当前生产 = 修复后）----
  await p.screenshot({ path: `${OUTDIR}/导入弹窗层级-AFTER-修复后-20260913.png`, clip: CLIP });
  const after = await p.evaluate(() => {
    const m = document.querySelector('.imp-modal'), o = document.querySelector('.imp-overlay'), t = document.querySelector('.grid-ctl-row .tb-pop');
    const rr = t.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(rr.left + rr.width / 2), Math.round(rr.top + rr.height / 2));
    return { mz: getComputedStyle(m).zIndex, oz: getComputedStyle(o).zIndex, tz: getComputedStyle(t).zIndex, hit: hit.tagName + '.' + (hit.className || '').toString().split(' ')[0], hitInModal: !!hit.closest('.imp-modal') };
  });

  // ---- BEFORE（注入 CSS 回退到 980/990，模拟修复前）----
  const vid = await p.evaluate(() => {
    const m = document.querySelector('.imp-modal');
    const attr = [...m.attributes].map(a => a.name).find(n => n.startsWith('data-v-'));
    return attr;
  });
  await p.addStyleTag({ content: `.imp-modal[${vid}]{z-index:990 !important}.imp-overlay[${vid}]{z-index:980 !important}` });
  await sleep(500);
  await p.screenshot({ path: `${OUTDIR}/导入弹窗层级-BEFORE-修复前-20260913.png`, clip: CLIP });
  const before = await p.evaluate(() => {
    const m = document.querySelector('.imp-modal'), o = document.querySelector('.imp-overlay'), t = document.querySelector('.grid-ctl-row .tb-pop');
    const rr = t.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(rr.left + rr.width / 2), Math.round(rr.top + rr.height / 2));
    return { mz: getComputedStyle(m).zIndex, oz: getComputedStyle(o).zIndex, tz: getComputedStyle(t).zIndex, hit: hit.tagName + '.' + (hit.className || '').toString().split(' ')[0], hitInTbPop: !!hit.closest('.tb-pop') };
  });

  console.log('BEFORE（回退 980/990）:', JSON.stringify(before));
  console.log('AFTER （修复 1125/1130）:', JSON.stringify(after));
  console.log('数据属性:', vid);
  console.log('截图 →', OUTDIR);
  await b.close();
})();
