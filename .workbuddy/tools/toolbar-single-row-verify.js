// 工具栏单行布局验收：量行数/高度/控件序列 + 表格工具行是否单行
// 用法：NODE_PATH=<ws>/node_modules node toolbar-single-row-verify.js [tag]
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
    const vis = el => { const cs = getComputedStyle(el), r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0.5; };
    const leaves = [];
    const walk = (el) => {
      for (const c of el.children) {
        if (!vis(c)) continue;
        const cls = (c.className || '').toString();
        if (/pop-overlay/.test(cls)) continue;
        if (/(^|\s)(tb-group|tb-edit-group)(\s|$)/.test(cls)) { walk(c); continue; }
        leaves.push({ el: c, cls, r: c.getBoundingClientRect(), t: (c.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 16) });
      }
    };
    walk(tb);
    const rows = [];
    for (const l of leaves) {
      const t = Math.round(l.r.top);
      let row = rows.find(x => Math.abs(x.top - t) <= 8);
      if (!row) { row = { top: t, w: 0, items: [] }; rows.push(row); }
      row.w += l.r.width;
      row.items.push({ n: l.t || l.cls.split(' ')[0], w: Math.round(l.r.width), left: Math.round(l.r.left) });
    }
    rows.forEach(r => r.items.sort((a, b) => a.left - b.left));
    const gc = document.querySelector('.grid-ctl-row');
    let gcInfo = null;
    if (gc) {
      const kids = [...gc.children].filter(vis).map(c => { const r = c.getBoundingClientRect(); return { n: (c.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 14) || (c.className || '').toString().split(' ')[0], w: Math.round(r.width), top: Math.round(r.top) }; });
      const tops = [...new Set(kids.map(k => k.top).filter((t, i, a) => !a.some(x => Math.abs(x - t) <= 8 && a.indexOf(x) < i)))];
      gcInfo = { rows: tops.length, h: Math.round(gc.getBoundingClientRect().height), kids };
    }
    return {
      curH: Math.round(tb.getBoundingClientRect().height),
      availW: tb.clientWidth,
      rows: rows.map(r => ({ n: r.items.length, w: Math.round(r.w), items: r.items })),
      gc: gcInfo,
      viewSegH: (() => { const v = document.querySelector('.view-seg-row'); return v ? Math.round(v.getBoundingClientRect().height) : null; })(),
    };
  });

  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('a')].find(x => x.getAttribute('href') === '#/forecast'); el && el.click(); });
  await sleep(3200);
  console.log('URL:', p.url(), TAG ? `[${TAG}]` : '');

  const dump = async (label) => {
    console.log(`\n===== ${label} =====`);
    console.log('视口    可用宽  工具栏高  工具栏行数   表格工具行行数  表格工具行高');
    const store = [];
    for (const vw of VPS) {
      await p.setViewport({ width: vw, height: 900, deviceScaleFactor: 1 });
      await sleep(900);
      const m = await probe();
      if (m.err) { console.log(vw, m.err); continue; }
      console.log(`${vw}  ${String(m.availW).padStart(6)}  ${String(m.curH).padStart(7)}  ${String(m.rows.length).padStart(9)}   ${String(m.gc ? m.gc.rows : '-').padStart(13)}   ${String(m.gc ? m.gc.h : '-').padStart(12)}`);
      store.push([vw, m]);
    }
    return store;
  };

  const A = await dump('非编辑态（未选期次）');

  // 最坏情况模拟：选中期次后 select 显示期次名，宽度由 126px 撑到 max-width 上限（220；<1440 时为 170）
  const widened = await p.evaluate(() => {
    const list = document.querySelectorAll('.sel-period');
    list.forEach(s => { s.style.width = '260px'; });
    return list.length;
  });
  await sleep(600);
  console.log(`\n[最坏情况模拟] 期次选择器内联宽置 260px（仍受各自 max-width 约束），命中 ${widened} 个`);
  const A2 = await dump('非编辑态（最坏：期次名撑满）');

  for (const vw of [1280, 1366, 1440]) {
    const mm = (A2.find(r => r[0] === vw) || [])[1];
    if (!mm) continue;
    console.log(`\n—— 最坏情况 ${vw} ——`);
    mm.rows.forEach((r, i) => console.log(`  行${i + 1}（${r.n} 项，控件宽合计 ${r.w}px）: ` + r.items.map(x => `${x.n}[${x.w}]`).join('  ')));
    if (mm.gc) console.log(`  表格工具行（${mm.gc.rows} 行，高 ${mm.gc.h}px）: ` + mm.gc.kids.map(x => `${x.n}[${x.w}]`).join('  '));
  }
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(800);
  const tbR = await p.evaluate(() => { const r = document.querySelector('.card.toolbar').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
  await p.screenshot({ path: `${OUT}/${TAG}-1-nonedit-1440.png`, clip: { x: tbR[0], y: tbR[1], width: tbR[2], height: tbR[3] } });
  const gcR = await p.evaluate(() => { const r = document.querySelector('.grid-ctl-row').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
  await p.screenshot({ path: `${OUT}/${TAG}-2-gridrow-1440.png`, clip: { x: Math.max(0, gcR[0] - 20), y: Math.max(0, gcR[1] - 14), width: gcR[2] + 40, height: gcR[3] + 28 } });

  // 编辑态
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await sleep(700);
  const entered = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.card.toolbar button')].find(x => /改单/.test(x.textContent));
    if (!btn) return false; btn.click(); return true;
  });
  await sleep(3500);
  console.log(`\n进入编辑态: ${entered}`);
  const B = await dump('编辑态');
  for (const vw of [1280, 1366, 1440]) {
    const mm = (B.find(r => r[0] === vw) || [])[1];
    if (!mm) continue;
    console.log(`\n—— 编辑态 ${vw} ——`);
    mm.rows.forEach((r, i) => console.log(`  行${i + 1}（${r.n} 项，控件宽合计 ${r.w}px）: ` + r.items.map(x => `${x.n}[${x.w}]`).join('  ')));
    if (mm.gc) console.log(`  表格工具行（${mm.gc.rows} 行，高 ${mm.gc.h}px）: ` + mm.gc.kids.map(x => `${x.n}[${x.w}]`).join('  '));
  }
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(800);
  const tbR2 = await p.evaluate(() => { const r = document.querySelector('.card.toolbar').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
  await p.screenshot({ path: `${OUT}/${TAG}-3-edit-1440.png`, clip: { x: tbR2[0], y: tbR2[1], width: tbR2[2], height: tbR2[3] } });
  console.log(`\n截图: ${OUT}/${TAG}-{1-nonedit,2-gridrow,3-edit}-1440.png`);
  await b.close();
})();
