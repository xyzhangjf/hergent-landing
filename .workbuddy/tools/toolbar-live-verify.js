const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fs = require('fs');
const OUT = '/tmp/fc-verify';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const probe = () => p.evaluate(() => {
    const tb = document.querySelector('.card.toolbar');
    if (!tb) return { err: 'no toolbar' };
    const right = tb.querySelector('.tb-right');
    const units = [...tb.querySelectorAll('.tb-right > *')];
    const tops = [];
    for (const t of units.map(u => u.getBoundingClientRect().top).sort((a, b) => a - b))
      if (!tops.length || t - tops[tops.length - 1] > 10) tops.push(t);
    const rightRows = tops.length;
    const lastRowUnits = units.filter(u => Math.abs(u.getBoundingClientRect().top - tops[tops.length - 1]) <= 10);
    const spanW = Math.round(Math.max(...lastRowUnits.map(u => u.getBoundingClientRect().right)) - Math.min(...lastRowUnits.map(u => u.getBoundingClientRect().left)));
    const head = tb.querySelector('.tb-head');
    const headTops = [];
    for (const t of [...head.children].map(u => u.getBoundingClientRect().top).sort((a, b) => a - b))
      if (!headTops.length || t - headTops[headTops.length - 1] > 10) headTops.push(t);
    const tbBox = tb.getBoundingClientRect();
    const headKids = [...head.children].map(k => ({ c: k.className.split(' ')[0], x: Math.round(k.getBoundingClientRect().left - tbBox.left) }));
    return {
      w: Math.round(tbBox.width), inner: Math.round(tb.clientWidth - 32), h: Math.round(tbBox.height),
      headRows: headTops.length, rightRows,
      total: headTops.length + rightRows,
      spanW, dense: tb.classList.contains('tb-dense'),
      headLayout: headKids.map(k => `${k.c}@${k.x}`).join(' '),
    };
  });

  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('a')].find(x => x.getAttribute('href') === '#/forecast'); el && el.click(); });
  await sleep(3000);
  console.log('URL:', p.url());

  console.log('\n=== 真机实测（演示环境）· 非编辑态 ===');
  console.log('视口      工具栏宽  内宽   行数  总高   行2内容跨度  余量');
  for (const vw of [1280, 1366, 1440, 1680, 1920]) {
    await p.setViewport({ width: vw, height: 900, deviceScaleFactor: 1 });
    await sleep(900);
    const m = await probe();
    if (m.err) { console.log(vw, m.err); continue; }
    const slack = m.inner - m.spanW;
    console.log(`${vw}      ${String(m.w).padStart(5)}   ${String(m.inner).padStart(5)}   ${m.total}     ${String(m.h).padStart(3)}px   ${String(m.spanW).padStart(5)}px    ${slack}px`);
    if (vw === 1440) console.log('   行1 元素定位:', m.headLayout);
  }

  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await sleep(900);
  await p.screenshot({ path: OUT + '/06-final-view.png' });

  // 编辑态
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await sleep(600);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button')].find(x => /改单/.test(x.textContent)); el && el.click(); });
  await sleep(3500);
  console.log('\n=== 真机实测 · 编辑态（tb-dense）===');
  console.log('视口      工具栏宽  内宽   行数  总高   行2内容跨度  余量');
  for (const vw of [1280, 1366, 1440, 1680, 1920]) {
    await p.setViewport({ width: vw, height: 900, deviceScaleFactor: 1 });
    await sleep(900);
    const m = await probe();
    if (m.err) { console.log(vw, m.err); continue; }
    console.log(`${vw}      ${String(m.w).padStart(5)}   ${String(m.inner).padStart(5)}   ${m.total}     ${String(m.h).padStart(3)}px   ${String(m.spanW).padStart(5)}px    ${m.inner - m.spanW}px   ${m.dense ? 'dense✅' : 'dense✗'}`);
  }

  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await sleep(700);
  await p.screenshot({ path: OUT + '/05-final-edit.png' });
  await b.close();
})();
