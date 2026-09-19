// 全局模态层（.pf-mask）修复前后同页对照截图
// 用法：NODE_PATH=<ws>/node_modules node global-modal-zindex-shot.js [baseUrl]
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = process.argv[2] || 'https://hergent.cn';
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await p.goto(BASE + '/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3500);
  await p.evaluate(() => { const a = [...document.querySelectorAll('a')].find(x => /预报订货|预报/.test(x.textContent)); a && a.click(); });
  await sleep(4500);
  await p.evaluate(() => {
    const sel = document.querySelector('select.sel-period');
    if (sel && sel.value === '0') { const o = [...sel.options].find(x => x.value && x.value !== '0'); if (o) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); } }
  });
  await sleep(4000);

  const openProfile = async () => {
    await p.evaluate(() => { const u = document.querySelector('.tb-user'); u && u.click(); });
    await sleep(500);
    await p.evaluate(() => { const it = [...document.querySelectorAll('.tb-menu-item')].find(x => /修改资料/.test(x.textContent)); it && it.click(); });
    await sleep(1000);
  };
  const hitAt = (x, y) => p.evaluate((x, y) => {
    const t = document.elementFromPoint(x, y);
    return t ? t.tagName.toLowerCase() + '.' + (t.className || '').toString().split(' ').slice(0, 2).join('.') : null;
  }, x, y);
  const brandR = () => p.evaluate(() => {
    const t = document.querySelector('.grid-ctl-row .tb-pop');
    if (!t) return null; const r = t.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });

  await openProfile();
  const br = await brandR();
  const zAfter = await p.evaluate(() => getComputedStyle(document.querySelector('.pf-mask')).zIndex);
  const hitAfter = await hitAt(br.x, br.y);
  await p.screenshot({ path: `${OUT}/全局模态层级-AFTER-修复后-20260913.png` });
  console.log(`AFTER  .pf-mask z=${zAfter}  品牌按钮坐标${JSON.stringify([br.x, br.y])} 命中=${hitAfter}`);

  // 同页回退到修复前的 1000（只覆盖 z-index，其余不动）
  await p.addStyleTag({ content: '.pf-mask{z-index:1000 !important}' });
  await sleep(600);
  const zBefore = await p.evaluate(() => getComputedStyle(document.querySelector('.pf-mask')).zIndex);
  const hitBefore = await hitAt(br.x, br.y);
  await p.screenshot({ path: `${OUT}/全局模态层级-BEFORE-修复前-20260913.png` });
  console.log(`BEFORE .pf-mask z=${zBefore}  品牌按钮坐标${JSON.stringify([br.x, br.y])} 命中=${hitBefore}`);

  await b.close();
})();
