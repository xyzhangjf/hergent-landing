// 「新建期次」提为常显按钮后的容量复核：逐视口报告 真实态 / 最坏态（期次名撑满）的行数、
// 段宽、以及「所需内容宽 vs 可用内容宽」的溢出量（px）。负数=已溢出。
// 用法：NODE_PATH=<ws>/node_modules node toolbar-newperiod-fit.js [tag]
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = process.argv[2] || 'fit';
const OUT = '/tmp/fc-row';
fs.mkdirSync(OUT, { recursive: true });
const VPS = [1280, 1366, 1440, 1512, 1680, 1920];

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const probe = () => p.evaluate(() => {
    const tb = document.querySelector('.card.toolbar');
    if (!tb) return { err: 'no .card.toolbar' };
    const cs = getComputedStyle(tb);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const gap = parseFloat(cs.columnGap) || 0;
    const vis = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0.5; };
    // 只取 toolbar 的直接子元素（.tb-group / .tb-edit-group / .tb-sep / .pop-overlay）
    const kids = [...tb.children].filter(vis).filter(c => !/pop-overlay/.test((c.className || '').toString()));
    // 所需内容宽 = Σ(子元素宽 + 左右外边距) + gap×(子元素数−1)
    // ⚠️ 必须算上 .tb-sep 的 margin:0 5px/3px，否则会少算 12~20px 而误判「放得下」
    const need = kids.reduce((s, c) => {
      const s2 = getComputedStyle(c);
      return s + c.getBoundingClientRect().width + (parseFloat(s2.marginLeft) || 0) + (parseFloat(s2.marginRight) || 0);
    }, 0) + gap * Math.max(0, kids.length - 1);
    const avail = tb.clientWidth - padX;
    // 行数：按子元素 top 聚类
    const tops = kids.map(c => Math.round(c.getBoundingClientRect().top));
    const rows = [...new Set(tops.filter((t, i, a) => !a.some((x, j) => j < i && Math.abs(x - t) <= 8)))].length;
    const sel = document.querySelector('.sel-period');
    const selR = sel.getBoundingClientRect();
    const opts = sel ? [...sel.options].map(o => o.text) : [];
    // 量测最长选项的自然宽（放进临时 span）
    let longest = '';
    if (opts.length) {
      const span = document.createElement('span');
      span.style.cssText = 'position:absolute;left:-9999px;white-space:nowrap;font:500 13px system-ui';
      span.textContent = opts.reduce((a, o) => (o.length > a.length ? o : a), '');
      document.body.appendChild(span);
      longest = span.textContent + ' (' + Math.round(span.getBoundingClientRect().width) + 'px)';
      span.remove();
    }
    return {
      avail: Math.round(avail), need: Math.round(need), slack: Math.round(avail - need),
      rows, h: Math.round(tb.getBoundingClientRect().height),
      selW: Math.round(selR.width),
      opts: opts.length, longest,
      kids: kids.map(c => ({
        cls: (c.className || '').toString().split(' ').filter(x => x.startsWith('tb-')).join('.') || (c.className || '').toString().split(' ')[0],
        w: Math.round(c.getBoundingClientRect().width),
        txt: (c.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      })),
    };
  });

  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('a')].find(x => x.getAttribute('href') === '#/forecast'); el && el.click(); });
  await sleep(3200);
  console.log('URL:', p.url(), `[${TAG}]`);

  const dump = async (label) => {
    console.log(`\n===== ${label} =====`);
    console.log('视口   工具行数 工具栏高  可用内容宽  所需内容宽  余量  选择器宽  选项数');
    const store = [];
    for (const vw of VPS) {
      await p.setViewport({ width: vw, height: 900, deviceScaleFactor: 1 });
      await sleep(950);
      const m = await probe();
      if (m.err) { console.log(vw, m.err); continue; }
      console.log(`${String(vw).padEnd(6)} ${String(m.rows).padStart(8)} ${String(m.h).padStart(8)} ${String(m.avail).padStart(11)} ${String(m.need).padStart(11)} ${String(m.slack).padStart(6)} ${String(m.selW).padStart(10)} ${String(m.opts).padStart(8)}`);
      store.push([vw, m]);
    }
    return store;
  };

  const A = await dump('真实态（演示账号当期实际数据）');
  console.log('\n最长选项文本:', (A[0] && A[0][1].longest) || '-');
  for (const [vw, m] of A) {
    if (m.slack < 0) console.log(`  ⚠️ ${vw}: 溢出 ${-m.slack}px  → ` + m.kids.map(k => `${k.cls}[${k.w}]`).join(' '));
  }

  await p.evaluate(() => { document.querySelectorAll('.sel-period').forEach(s => { s.style.width = '260px'; }); });
  await sleep(600);
  console.log('\n[最坏情况模拟] 期次选择器内联宽置 260px（仍受 max-width 约束）');
  const B = await dump('最坏态（期次名撑满限宽）');
  for (const [vw, m] of B) {
    console.log(`  ${vw}: 余量 ${m.slack >= 0 ? '+' : ''}${m.slack}px  选择器 ${m.selW}px` + (m.slack < 0 ? '  ⚠️ 折行' : ''));
  }
  console.log('\n最坏态 1280 明细:', B[0] ? B[0][1].kids.map(k => `${k.cls}[${k.w}]`).join(' ') : '-');
  console.log('最坏态 1440 明细:', (B.find(r => r[0] === 1440) || [])[1] ? (B.find(r => r[0] === 1440))[1].kids.map(k => `${k.cls}[${k.w}]`).join(' ') : '-');
  await b.close();
})();
