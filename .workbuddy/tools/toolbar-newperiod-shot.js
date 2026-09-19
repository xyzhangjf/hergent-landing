// 「新建期次」按钮上线后的工具栏截图：1280 / 1366 / 1440 三档 × 真实态/最坏态，另附编辑态 1440。
// 用法：NODE_PATH=<ws>/node_modules node toolbar-newperiod-shot.js [tag]
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = process.argv[2] || 'shot';
const OUT = '/tmp/fc-row';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('a')].find(x => x.getAttribute('href') === '#/forecast'); el && el.click(); });
  await sleep(3200);

  const shot = async (vw, name) => {
    await p.setViewport({ width: vw, height: 900, deviceScaleFactor: 2 });
    await sleep(900);
    const r = await p.evaluate(() => { const x = document.querySelector('.card.toolbar').getBoundingClientRect(); return [Math.round(x.left), Math.round(x.top), Math.round(x.width), Math.round(x.height)]; });
    await p.screenshot({ path: `${OUT}/${TAG}-${name}.png`, clip: { x: r[0], y: r[1], width: r[2], height: r[3] } });
    console.log(`${name}: ${r[2]}x${r[3]}`);
  };

  for (const vw of [1280, 1366, 1440]) await shot(vw, `real-${vw}`);
  // 最坏态：期次名撑满选择器限宽
  await p.evaluate(() => { document.querySelectorAll('.sel-period').forEach(s => { s.style.width = '260px'; }); });
  await sleep(500);
  for (const vw of [1280, 1366, 1440]) await shot(vw, `worst-${vw}`);
  // 编辑态 1440（截整块含第二行编辑组）
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await sleep(700);
  await p.evaluate(() => { const btn = [...document.querySelectorAll('.card.toolbar button')].find(x => /改单/.test(x.textContent)); btn && btn.click(); });
  await sleep(3500);
  await shot(1440, 'edit-1440');
  await b.close();
})();
