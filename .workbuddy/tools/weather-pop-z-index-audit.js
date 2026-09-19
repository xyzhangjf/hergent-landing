// 天气面板 vs 预报工具栏下拉 的层叠诊断
// 用法：NODE_PATH=<ws>/node_modules node weather-pop-z-index-audit.js [tag]
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = process.argv[2] || 'now';
const OUT = '/tmp/wx-z';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3500);
  // 进预报页
  await p.evaluate(() => { const a = [...document.querySelectorAll('a')].find(x => /预报订货/.test(x.textContent)); a && a.click(); });
  await sleep(4000);

  // 展开天气面板
  await p.click('.wx-now');
  await sleep(1400);

  const r = await p.evaluate(() => {
    const R = el => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), rt: Math.round(r.right) }; };
    const pop = document.querySelector('.wx-pop');
    if (!pop) return { err: 'no .wx-pop' };
    // 祖先链：谁创建了 stacking context
    const chain = [];
    let el = pop;
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      chain.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 40),
        z: cs.zIndex, pos: cs.position,
        bf: cs.backdropFilter && cs.backdropFilter !== 'none' ? cs.backdropFilter : '',
        filter: cs.filter && cs.filter !== 'none' ? cs.filter : '',
        tf: cs.transform && cs.transform !== 'none' ? cs.transform : '',
        iso: cs.isolation !== 'auto' ? cs.isolation : '',
        op: cs.opacity !== '1' ? cs.opacity : '',
      });
      el = el.parentElement;
    }
    const popZ = getComputedStyle(pop).zIndex;
    // 页面内下拉
    const tbpops = [...document.querySelectorAll('.tb-pop')].slice(0, 3).map(x => ({
      txt: (x.textContent || '').trim().slice(0, 10),
      z: getComputedStyle(x).zIndex, ...R(x),
    }));
    const tbPanel = document.querySelector('.tb-pop-panel');
    // 重叠检测 + 命中测试
    const pr = R(pop);
    const hits = [];
    for (const tp of tbpops) {
      const overlap = !(tp.rt < pr.l || tp.l > pr.rt || tp.b < pr.t || tp.t > pr.b);
      if (!overlap) { hits.push({ txt: tp.txt, overlap: false }); continue; }
      const cx = Math.round(tp.l + tp.w / 2), cy = Math.round(tp.t + tp.h / 2);
      const top = document.elementFromPoint(cx, cy);
      hits.push({
        txt: tp.txt, overlap: true, z: tp.z,
        point: [cx, cy],
        topEl: top ? (top.tagName.toLowerCase() + '.' + (top.className || '').toString().split(' ')[0]) : null,
        topIsToolbarBtn: top ? !!top.closest('.tb-pop') : false,
        topIsWeatherPop: top ? !!top.closest('.wx-pop') : false,
      });
    }
    return { popZ, popRect: pr, chain, tbpops, tbPanelZ: tbPanel ? getComputedStyle(tbPanel).zIndex : null, hits };
  });

  if (r.err) { console.log(r.err); await b.close(); return; }
  console.log(`天气面板 z-index = ${r.popZ}   rect=${JSON.stringify(r.popRect)}`);
  console.log(`\n=== .wx-pop 祖先链（谁创建了 stacking context）===`);
  for (const c of r.chain) {
    const flags = [c.z !== 'auto' ? `z=${c.z}` : '', c.pos !== 'static' ? `pos=${c.pos}` : '', c.bf ? `backdrop-filter` : '', c.filter ? `filter` : '', c.tf ? `transform` : '', c.iso ? 'isolation' : '', c.op ? `opacity=${c.op}` : ''].filter(Boolean).join(' ');
    console.log(`  ${c.tag}.${c.cls}  →  ${flags || '(无 context 条件)'}`);
  }
  console.log(`\n=== 预报工具栏 .tb-pop 触发按钮 ===`);
  for (const t of r.tbpops) console.log(`  「${t.txt}」z=${t.z} rect=${JSON.stringify(t)}`);
  console.log(`.tb-pop-panel z-index = ${r.tbPanelZ}`);
  console.log(`\n=== 重叠区命中测试（谁在最上层）===`);
  for (const h of r.hits) {
    if (!h.overlap) { console.log(`  「${h.txt}」与天气面板无重叠`); continue; }
    console.log(`  「${h.txt}」重叠 点${JSON.stringify(h.point)} → 最上层=${h.topEl}  ${h.topIsToolbarBtn ? '✘ 工具栏按钮浮在天气面板之上' : h.topIsWeatherPop ? '✔ 天气面板在最上' : '?'}`);
  }

  await p.screenshot({ path: `${OUT}/${TAG}-full.png`, clip: { x: 0, y: 0, width: 1440, height: 400 } });
  await p.screenshot({ path: `${OUT}/${TAG}-zoom.png`, clip: { x: 600, y: 30, width: 500, height: 260 } });
  await b.close();
  console.log('\n截图 → ' + OUT);
})();
