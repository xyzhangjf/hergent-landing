// 天气面板节假日标记特写：3x 放大截取日卡片行（重点看 09/20 班、09/25-27 休）
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = process.argv[2] || 'zoom';
const OUT = '/tmp/wx-hd';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 3 });
  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(4500);
  await p.click('.wx-now');
  await sleep(1500);

  const box = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('.wx-day')];
    const pick = cls => cards.find(c => c.querySelector('.wx-hb.' + cls));
    const R = e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const work = pick('work'), off = pick('off');
    const all = [...(work ? [work] : []), ...(off ? [off] : [])];
    if (!all.length) return null;
    const L = Math.min(...all.map(e => R(e).l)) - 6;
    const Rr = Math.max(...all.map(e => R(e).r)) + 6;
    const T = Math.min(...all.map(e => R(e).t)) - 4;
    const B = Math.max(...all.map(e => R(e).b)) + 4;
    return { x: Math.max(0, L), y: Math.max(0, T), width: Rr - L, height: B - T };
  });
  if (!box) { console.log('未找到标记卡片'); await b.close(); return; }
  console.log('特写区域 ' + JSON.stringify(box));
  await p.screenshot({ path: `${OUT}/${TAG}-daybadges-3x.png`, clip: box });

  // 单独放大「班」「休」「中秋节」三处
  const singles = await p.evaluate(() => {
    const out = {};
    const cards = [...document.querySelectorAll('.wx-day')];
    const g = sel => { const c = cards.find(x => x.querySelector(sel)); if (!c) return null; const r = c.getBoundingClientRect(); return { x: Math.max(0, r.left - 3), y: Math.max(0, r.top - 3), width: r.width + 6, height: r.height + 6 }; };
    out.work = g('.wx-hb.work');
    out.name = g('.wx-d-dt.is-name');
    const offs = cards.filter(x => x.querySelector('.wx-hb.off'));
    if (offs.length) { const r = offs[offs.length - 1].getBoundingClientRect(); out.last = { x: Math.max(0, r.left - 3), y: Math.max(0, r.top - 3), width: r.width + 6, height: r.height + 6 }; }
    return out;
  });
  for (const k of Object.keys(singles)) {
    if (singles[k]) await p.screenshot({ path: `${OUT}/${TAG}-${k}-3x.png`, clip: singles[k] });
  }
  console.log('单卡特写: ' + Object.keys(singles).filter(k => singles[k]).join(', '));

  // 暗色主题下的对比度检查
  await p.evaluate(() => { document.documentElement.classList.remove('light'); document.documentElement.classList.add('dark'); });
  await sleep(600);
  const darkBox = await p.evaluate(() => { const e = document.querySelector('.wx-pop'); const r = e.getBoundingClientRect(); return { x: Math.max(0, r.left - 6), y: Math.max(0, r.top - 6), width: Math.min(r.width + 12, 1400), height: r.height + 12 }; });
  await p.screenshot({ path: `${OUT}/${TAG}-dark-pop-3x.png`, clip: darkBox });
  console.log('暗色面板 → ' + OUT + '/' + TAG + '-dark-pop-3x.png');

  await b.close();
  console.log('\n截图 → ' + OUT);
})();
