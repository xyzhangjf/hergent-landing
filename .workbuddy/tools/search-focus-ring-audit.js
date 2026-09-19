// 搜索框聚焦光圈审计：量化 .tb-search 胶囊内层无边框 input 的 focus 光晕几何
// 用法：NODE_PATH=<ws>/node_modules node search-focus-ring-audit.js before|after
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fs = require('fs');
const OUT = '/tmp/fc-focus';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = process.argv[2] || 'before';

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  const probe = (sel) => p.evaluate((sel) => {
    const inp = document.querySelector(sel);
    if (!inp) return { err: 'no input: ' + sel };
    const cap = inp.closest('.tb-search') || inp.parentElement;
    const ci = getComputedStyle(inp), cc = getComputedStyle(cap);
    const r = inp.getBoundingClientRect(), rc = cap.getBoundingClientRect();
    const innerCapH = rc.height - 2; // border-box 减去上下 1px 边框 = 内容区
    return {
      inputRect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      capRect: [Math.round(rc.left), Math.round(rc.top), Math.round(rc.width), Math.round(rc.height)],
      inputShadow: ci.boxShadow === 'none' ? '(none)' : ci.boxShadow,
      capShadow: cc.boxShadow === 'none' ? '(none)' : cc.boxShadow,
      capBorder: cc.borderColor,
      inputBorder: ci.borderStyle + ' ' + ci.borderWidth,
      focused: document.activeElement === inp,
      haloInsetLeft: Math.round(r.left - rc.left - 1),   // 光晕左边界相对胶囊内缘
      haloInsetTop: Math.round(r.top - rc.top - 1),      // 光晕上边界相对胶囊内缘（负=顶出胶囊）
      inputOvH: Math.round((r.height - innerCapH) / 2),  // input 相对胶囊内容区的高度溢出（每侧 px）
    };
  }, sel);

  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('a')].find(x => x.getAttribute('href') === '#/forecast'); el && el.click(); });
  await sleep(3000);
  console.log('URL:', p.url());

  const sel = '#gridFind';
  const s0 = await probe(sel);
  if (s0.err) { console.log('ERR', s0.err); await b.close(); return; }

  await p.click(sel);
  await sleep(600);
  const s1 = await probe(sel);

  console.log(`\n=========== [${TAG}] 工具栏商品搜索框聚焦光圈 ===========`);
  console.log(`胶囊  : ${s0.capRect[2]}x${s0.capRect[3]}  边框 ${s1.capBorder}`);
  console.log(`input : ${s1.inputRect[2]}x${s1.inputRect[3]}  border: ${s1.inputBorder}`);
  console.log(`未聚焦 input box-shadow : ${s0.inputShadow}`);
  console.log(`聚焦后 input box-shadow : ${s1.inputShadow}`);
  console.log(`聚焦后 胶囊 box-shadow  : ${s1.capShadow}`);
  console.log(`光晕相对胶囊内缘偏移    : 左 ${s1.haloInsetLeft}px / 上 ${s1.haloInsetTop}px  (负值=已顶出胶囊边框)`);
  console.log(`input 高度溢出胶囊内容区: ${s1.inputOvH}px/侧`);
  console.log(`聚焦态判定              : ${s1.focused ? 'focused ✅' : 'not focused ✗'}`);

  const rc = s1.capRect, pad = 16;
  const file = `${OUT}/${TAG}-search-focus.png`;
  await p.screenshot({
    path: file,
    clip: { x: Math.max(0, rc[0] - pad), y: Math.max(0, rc[1] - pad), width: rc[2] + pad * 2, height: rc[3] + pad * 2 },
  });
  // 同时截整条工具栏，便于看整体观感
  const tb = await p.evaluate(() => { const t = document.querySelector('.card.toolbar'); const r = t.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
  await p.screenshot({ path: `${OUT}/${TAG}-toolbar.png`, clip: { x: tb[0], y: tb[1], width: tb[2], height: tb[3] } });
  console.log(`截图: ${file} / ${OUT}/${TAG}-toolbar.png`);
  await b.close();
})();
