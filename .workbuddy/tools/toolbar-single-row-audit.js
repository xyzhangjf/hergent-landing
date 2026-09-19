// 主工具栏单行可行性审计：量每个控件的真实宽度 + 强制单行所需总宽 vs 可用宽
// 用法：NODE_PATH=<ws>/node_modules node toolbar-single-row-audit.js [tag]
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = process.argv[2] || 'now';
const OUT = '/tmp/fc-row';
fs.mkdirSync(OUT, { recursive: true });

const VPS = [1280, 1366, 1440, 1680, 1920];

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const probe = () => p.evaluate(() => {
    const tb = document.querySelector('.card.toolbar');
    if (!tb) return { err: 'no .card.toolbar' };
    const vis = el => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0.5;
    };
    const items = [];
    const push = (el, group) => {
      if (!vis(el)) return;
      const r = el.getBoundingClientRect();
      let cls = (el.className || '').toString().trim();
      cls = cls.split(' ').filter(c => !/^(btn|input|fld|on|btn-sm|btn-ghost|btn-primary)$/.test(c)).slice(0, 2).join('.');
      items.push({
        group,
        cls: cls || el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 18),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    };
    const walk = (container, group) => {
      for (const c of container.children) {
        if (!vis(c)) continue;
        const cls = (c.className || '').toString();
        if (/(^|\s)tb-group(\s|$)/.test(cls)) { walk(c, group); continue; }
        push(c, group);
      }
    };
    const head = tb.querySelector(':scope > .tb-head');
    const right = tb.querySelector(':scope > .tb-right');
    if (head) walk(head, 'head');
    if (right) walk(right, 'right');

    // 当前（未模拟）行数与高度
    const tops = [];
    for (const t of items.map(i => 0)) { /* noop */ }
    const rowTops = [];
    for (const c of tb.querySelectorAll(':scope > * > *')) {
      if (!vis(c)) continue;
      const t = Math.round(c.getBoundingClientRect().top);
      if (!rowTops.some(x => Math.abs(x - t) <= 8)) rowTops.push(t);
    }
    const curH = Math.round(tb.getBoundingClientRect().height);

    // 强制单行模拟：nowrap + 子组不收缩
    const sim = (() => {
      const rec = [];
      const set = (el, prop, val) => { if (!el) return; rec.push([el, prop, el.style[prop]]); el.style[prop] = val; };
      set(tb, 'flexWrap', 'nowrap');
      set(head, 'flexWrap', 'nowrap'); set(head, 'flex', '0 0 auto');
      set(right, 'flexWrap', 'nowrap'); set(right, 'flex', '0 0 auto');
      const needW = tb.scrollWidth;
      const availW = tb.clientWidth;
      const h = Math.round(tb.getBoundingClientRect().height);
      for (const [el, prop, old] of rec.reverse()) el.style[prop] = old;
      return { needW, availW, deficit: needW - availW, oneRowH: h };
    })();

    const sumW = items.reduce((a, i) => a + i.w, 0);
    const seps = items.filter(i => /tb-sep/.test(i.cls)).length;
    return { items, curH, curRows: rowTops.length, sumW, seps, ...sim };
  });

  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('a')].find(x => x.getAttribute('href') === '#/forecast'); el && el.click(); });
  await sleep(3200);
  console.log('URL:', p.url(), TAG ? `[${TAG}]` : '');

  const dump = (mode) => {
    console.log(`\n===== ${mode} =====`);
    console.log('视口    可用宽  单行所需  差额    当前行数  当前高  单行高');
    const store = [];
    return (async () => {
      for (const vw of VPS) {
        await p.setViewport({ width: vw, height: 900, deviceScaleFactor: 1 });
        await sleep(900);
        const m = await probe();
        if (m.err) { console.log(vw, m.err); continue; }
        console.log(`${vw}  ${String(m.availW).padStart(6)}  ${String(m.needW).padStart(8)}  ${String(m.deficit).padStart(6)}  ${String(m.curRows).padStart(8)}  ${String(m.curH).padStart(6)}  ${String(m.oneRowH).padStart(6)}`);
        store.push([vw, m]);
      }
      return store;
    })();
  };

  const rowsA = await dump('非编辑态');
  const at1440 = rowsA.find(r => r[0] === 1440);
  if (at1440) {
    const m = at1440[1];
    console.log(`\n控件清单（1440 非编辑态，${m.items.length} 项，控件宽合计 ${m.sumW}px，含 ${m.seps} 个分隔条）:`);
    console.log('  #  组    宽度   类名                     文案');
    m.items.forEach((it, i) => console.log(`  ${String(i + 1).padStart(2)}  ${it.group === 'head' ? '行1' : '行2'}  ${String(it.w).padStart(5)}  ${it.cls.padEnd(24)} ${it.text}`));
  }

  await p.screenshot({ path: `${OUT}/${TAG}-1-nonedit-1440.png`, fullPage: false })
    .catch(() => {});
  const tbRect = async () => p.evaluate(() => { const r = document.querySelector('.card.toolbar').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(800);
  let r = await tbRect();
  await p.screenshot({ path: `${OUT}/${TAG}-1-nonedit-1440.png`, clip: { x: r[0], y: r[1], width: r[2], height: r[3] } });

  // 进编辑态
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await sleep(700);
  const entered = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.card.toolbar button')].find(b => /改单/.test(b.textContent));
    if (!btn) return false; btn.click(); return true;
  });
  await sleep(3500);
  console.log(`\n进入编辑态: ${entered}`);
  const rowsB = await dump('编辑态');
  const at1440b = rowsB.find(r => r[0] === 1440);
  if (at1440b) {
    const m = at1440b[1];
    console.log(`\n控件清单（1440 编辑态，${m.items.length} 项，控件宽合计 ${m.sumW}px）:`);
    m.items.forEach((it, i) => console.log(`  ${String(i + 1).padStart(2)}  ${it.group === 'head' ? '行1' : '行2'}  ${String(it.w).padStart(5)}  ${it.cls.padEnd(24)} ${it.text}`));
  }

  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(800);
  r = await tbRect();
  await p.screenshot({ path: `${OUT}/${TAG}-2-edit-1440.png`, clip: { x: r[0], y: r[1], width: r[2], height: r[3] } });
  console.log(`\n截图: ${OUT}/${TAG}-{1-nonedit,2-edit}-1440.png`);
  await b.close();
})();
