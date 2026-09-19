// 天气面板特写截图（2x）：仅截图，不做断言
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = process.argv[2] || 'shot';
const OUT = '/tmp/wx-audit';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(4000);
  await p.screenshot({ path: `${OUT}/${TAG}-btn.png`, clip: { x: 700, y: 4, width: 180, height: 44 } });
  await p.click('.wx-now');
  await sleep(1200);
  const box = await p.evaluate(() => {
    const el = document.querySelector('.wx-pop');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: Math.max(0, r.left - 8), t: Math.max(0, r.top - 6), w: r.width + 16, h: Math.min(r.height + 12, 320) };
  });
  if (!box) { console.log('✘ 面板未展开'); await b.close(); return; }
  await p.screenshot({ path: `${OUT}/${TAG}-pop.png`, clip: { x: box.l, y: box.t, width: box.w, height: box.h } });
  // 首行特写（2x 放大观感）
  await p.screenshot({ path: `${OUT}/${TAG}-head.png`, clip: { x: box.l, y: box.t, width: 420, height: 74 } });
  console.log('✔ 截图完成', JSON.stringify(box));
  await b.close();
})();
