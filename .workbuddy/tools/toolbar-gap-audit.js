// 工具栏行1 间距审计：逐控件输出坐标 + 相邻间距 + 行尾余量 + 搜索框是否截断
// 用法: node gap-audit.js <tag>   例: node gap-audit.js base
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = '/tmp/fc-verify';
const TAG = process.argv[2] || 'run';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const audit = (p) => p.evaluate(() => {
  const tb = document.querySelector('.card.toolbar');
  if (!tb) return { err: 'no toolbar' };
  const head = tb.querySelector('.tb-head');
  const tbBox = tb.getBoundingClientRect();
  const nm = el => {
    if (el.classList.contains('tb-group')) return '期次组';
    if (el.classList.contains('tb-search')) return '搜索框';
    if (el.classList.contains('tb-toggle')) return '仅显示有报单';
    if (el.classList.contains('tb-status-row')) return '状态徽标';
    if (el.classList.contains('tb-sep')) return '│';
    return (el.className || '').split(' ')[0] || el.tagName;
  };
  const kids = [...head.children].map(el => {
    const r = el.getBoundingClientRect();
    return { name: nm(el), l: Math.round(r.left - tbBox.left), r: Math.round(r.right - tbBox.left), w: Math.round(r.width), t: Math.round(r.top) };
  });
  const rows = [];
  for (const k of kids) {
    let row = rows.find(rw => Math.abs(rw.t - k.t) <= 10);
    if (!row) { row = { t: k.t, items: [] }; rows.push(row); }
    row.items.push(k);
  }
  rows.sort((a, b) => a.t - b.t);
  const layout = rows.map((row, i) => {
    row.items.sort((a, b) => a.l - b.l);
    const gaps = [];
    for (let j = 1; j < row.items.length; j++)
      gaps.push({ from: row.items[j - 1].name, to: row.items[j].name, gap: row.items[j].l - row.items[j - 1].r });
    const last = row.items[row.items.length - 1];
    return {
      row: i + 1,
      items: row.items.map(x => `${x.name}[${x.l}~${x.r}]`),
      gaps,
      tailSlack: Math.round(tbBox.width - 16 - last.r),
    };
  });
  const si = head.querySelector('.tb-search .fld');
  const sb = head.querySelector('.tb-search');
  let phNeed = null;
  if (si && si.placeholder) {
    const cs = getComputedStyle(si);
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    phNeed = Math.ceil(c.measureText(si.placeholder).width);
  }
  return {
    toolbarW: Math.round(tbBox.width),
    toolbarH: Math.round(tbBox.height),
    headRowCount: rows.length,
    layout,
    searchBoxW: sb ? Math.round(sb.getBoundingClientRect().width) : null,
    searchInputW: si ? Math.round(si.clientWidth) : null,
    phNeed,
    placeholderClipped: si ? (phNeed + 4 > si.clientWidth) : null,
  };
});

const report = (label, w, m) => {
  if (m.err) { console.log(`${label} ${w}: ${m.err}`); return; }
  console.log(`\n--- ${label} · 视口 ${w}（工具栏 ${m.toolbarW}px / 高 ${m.toolbarH}px / 行1 ${m.headRowCount} 行）---`);
  for (const rw of m.layout) {
    console.log(`  行${rw.row}: ${rw.items.join('  ')}   行尾余 ${rw.tailSlack}px`);
    for (const g of rw.gaps) console.log(`        间距 ${g.from} → ${g.to} = ${g.gap}px`);
  }
  if (m.searchBoxW) console.log(`  搜索框 ${m.searchBoxW}px（输入区 ${m.searchInputW}px）placeholder 截断: ${m.placeholderClipped ? '是 ❌' : '否 ✅'}`);
};

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('a')].find(x => x.getAttribute('href') === '#/forecast'); el && el.click(); });
  await sleep(3000);
  console.log('URL:', p.url());

  console.log(`\n########## ${TAG} · 非编辑态 ##########`);
  for (const w of [1280, 1440, 1920]) {
    await p.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
    await sleep(900);
    report(TAG, w, await audit(p));
  }

  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await sleep(800);
  await p.screenshot({ path: `${OUT}/${TAG}-view.png` });

  console.log(`\n########## ${TAG} · 编辑态 ##########`);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button')].find(x => /改单/.test(x.textContent)); el && el.click(); });
  await sleep(3500);
  for (const w of [1280, 1440, 1920]) {
    await p.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
    await sleep(900);
    report(TAG + '(编辑)', w, await audit(p));
  }
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await sleep(800);
  await p.screenshot({ path: `${OUT}/${TAG}-edit.png` });
  await b.close();
})();
