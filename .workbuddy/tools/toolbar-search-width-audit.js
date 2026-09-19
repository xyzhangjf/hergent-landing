// 工具栏搜索框宽度审计：量胶囊/输入区宽度、placeholder 截断、行1 折行与行尾余量
// 用法：NODE_PATH=<ws>/node_modules node toolbar-search-width-audit.js [tag]
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = process.argv[2] || '';

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const probe = () => p.evaluate(() => {
    const inp = document.querySelector('#gridFind');
    if (!inp) return { err: 'no #gridFind' };
    const cap = inp.closest('.tb-search');
    const head = document.querySelector('.card.toolbar .tb-head');
    if (!head) return { err: 'no .tb-head' };

    // placeholder 实际像素宽（不能用 input.scrollWidth —— 空值时不反映 placeholder）
    const ci = getComputedStyle(inp);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = ci.font;
    const phW = Math.ceil(ctx.measureText(inp.placeholder || '').width);
    const padW = parseFloat(ci.paddingLeft) + parseFloat(ci.paddingRight);
    const innerW = inp.clientWidth - padW;

    // 行1 折行：子元素 top 聚类
    const tops = [];
    for (const t of [...head.children].map(c => c.getBoundingClientRect().top).sort((a, b) => a - b))
      if (!tops.length || t - tops[tops.length - 1] > 10) tops.push(t);
    const kids = [...head.children].map(k => k.getBoundingClientRect());
    const spanW = Math.round(Math.max(...kids.map(k => k.right)) - Math.min(...kids.map(k => k.left)));

    return {
      capW: Math.round(cap.getBoundingClientRect().width),
      inputW: inp.clientWidth,
      phW, innerW,
      phTrunc: phW > innerW,
      needInputW: phW + padW,          // 完整显示 placeholder 所需输入区宽
      headRows: tops.length,
      tailSlack: Math.round(head.clientWidth - spanW),
      headKids: [...head.children].map(k => k.className.split(' ')[0]).join(' | '),
    };
  });

  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('a')].find(x => x.getAttribute('href') === '#/forecast'); el && el.click(); });
  await sleep(3000);
  console.log('URL:', p.url(), TAG ? `[${TAG}]` : '');
  console.log('\n视口  胶囊宽  输入区宽  placeholder宽  截断?  完整所需输入区宽  行1行数  行尾余量');
  for (const vw of [1280, 1366, 1440, 1680, 1920]) {
    await p.setViewport({ width: vw, height: 900, deviceScaleFactor: 1 });
    await sleep(900);
    const m = await probe();
    if (m.err) { console.log(vw, m.err); continue; }
    console.log(`${vw}  ${String(m.capW).padStart(5)}   ${String(m.inputW).padStart(7)}   ${String(m.phW).padStart(12)}   ${(m.phTrunc ? '是' : '否').padStart(4)}   ${String(m.needInputW).padStart(14)}   ${String(m.headRows).padStart(6)}   ${String(m.tailSlack).padStart(6)}px`);
    if (vw === 1440) console.log(`  行1 元素: ${m.headKids}`);
  }
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(700);
  const cap = await p.evaluate(() => { const r = document.querySelector('#gridFind').closest('.tb-search').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
  await p.screenshot({ path: `/tmp/fc-focus/width-${TAG || 'now'}-search.png`, clip: { x: Math.max(0, cap[0] - 16), y: Math.max(0, cap[1] - 16), width: cap[2] + 32, height: cap[3] + 32 } });
  const tbR = await p.evaluate(() => { const r = document.querySelector('.card.toolbar').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
  await p.screenshot({ path: `/tmp/fc-focus/width-${TAG || 'now'}-toolbar.png`, clip: { x: tbR[0], y: tbR[1], width: tbR[2], height: tbR[3] } });
  console.log(`截图: /tmp/fc-focus/width-${TAG || 'now'}-{search,toolbar}.png`);
  await b.close();
})();
