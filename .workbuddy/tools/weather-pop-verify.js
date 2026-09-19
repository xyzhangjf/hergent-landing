// 天气面板层级修复验收：层叠命中 + 定位 + Teleport 后交互回归
// 用法：NODE_PATH=<ws>/node_modules node weather-pop-verify.js [tag]
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
  await p.evaluate(() => { const a = [...document.querySelectorAll('a')].find(x => /预报订货/.test(x.textContent)); a && a.click(); });
  await sleep(4000);
  await p.click('.wx-now');
  await sleep(1400);

  const probe = () => p.evaluate(() => {
    const R = el => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), rt: Math.round(r.right) }; };
    const pop = document.querySelector('.wx-pop');
    const btn = document.querySelector('.wx-now');
    if (!pop) return { open: false, btn: R(btn) };
    const cs = getComputedStyle(pop);
    const pr = R(pop), br = R(btn);
    const tbpops = [...document.querySelectorAll('.tb-pop')].map(x => ({ txt: (x.textContent || '').trim().slice(0, 8), z: getComputedStyle(x).zIndex, ...R(x) }));
    const hits = [];
    for (const tp of tbpops) {
      const overlap = !(tp.rt < pr.l || tp.l > pr.rt || tp.b < pr.t || tp.t > pr.b);
      if (!overlap) continue;
      const cx = Math.round(tp.l + tp.w / 2), cy = Math.round(tp.t + tp.h / 2);
      const top = document.elementFromPoint(cx, cy);
      hits.push({
        txt: tp.txt,
        topEl: top ? (top.tagName.toLowerCase() + '.' + (top.className || '').toString().split(' ')[0]) : null,
        weatherOnTop: top ? !!top.closest('.wx-pop') : false,
        toolbarOnTop: top ? !!top.closest('.tb-pop') : false,
      });
    }
    return {
      open: true,
      popRect: pr, btnRect: br,
      popZ: cs.zIndex, popPos: cs.position,
      parentIsBody: pop.parentElement === document.body,
      overlayZ: cs.zIndex,
      centering: Math.round((pr.l + pr.w / 2) - (br.l + br.w / 2)),
      gapBelowBtn: pr.t - br.b,
      vw: document.documentElement.clientWidth,
      overflowLeft: pr.l < 0, overflowRight: pr.rt > document.documentElement.clientWidth,
      hits,
    };
  });

  const r = await probe();
  if (!r.open) { console.log('✘ 面板未打开'); await b.close(); return; }
  console.log(`面板 z-index=${r.popZ} position=${r.popPos} 挂载在 body：${r.parentIsBody ? '✔' : '✘'}`);
  console.log(`面板 rect=${JSON.stringify(r.popRect)}  按钮 rect=${JSON.stringify(r.btnRect)}`);
  console.log(`水平居中偏差=${r.centering}px（0 = 与按钮中心对齐）；按钮下沿间距=${r.gapBelowBtn}px`);
  console.log(`视口 ${r.vw}：左溢出=${r.overflowLeft} 右溢出=${r.overflowRight}`);
  console.log(`\n=== 重叠区命中测试 ===`);
  if (!r.hits.length) console.log('  （无重叠）');
  for (const h of r.hits) console.log(`  「${h.txt}」→ 最上层=${h.topEl}  ${h.weatherOnTop ? '✔ 天气面板在最上' : h.toolbarOnTop ? '✘ 工具栏按钮仍浮在上' : '?'}`);

  // 交互回归 ①：点面板内部（搜索框）不应关闭
  await p.click('.wx-input');
  await sleep(500);
  const afterInner = await p.evaluate(() => !!document.querySelector('.wx-pop'));
  console.log(`\n点面板内部（搜索框）→ 面板${afterInner ? '仍打开 ✔' : '被误关 ✘'}`);

  // 交互回归 ②：面板内搜索可用
  await p.type('.wx-input', '北京', { delay: 60 });
  await sleep(1600);
  const res = await p.evaluate(() => {
    const inp = document.querySelector('.wx-input');
    const box = document.querySelector('.wx-results');
    const none = document.querySelector('.wx-res-none');
    const els = [...document.querySelectorAll('.wx-res')];
    return {
      inputValue: inp ? inp.value : null,
      hasResultsBox: !!box,
      noneText: none ? none.textContent.trim() : null,
      n: els.length,
      first: els[0] ? els[0].textContent.trim().replace(/\s+/g, ' ') : null,
    };
  });
  console.log(`面板内搜索诊断: ${JSON.stringify(res)}`);
  console.log(`  → ${res.n ? '✔ 有结果' : res.noneText ? '✘ 接口返回空' : res.inputValue ? '✘ 结果区未渲染' : '✘ 输入未进入 v-model'}`);

  // 交互回归 ③：点外部关闭
  await p.mouse.click(60, 700);
  await sleep(500);
  const afterOuter = await p.evaluate(() => !!document.querySelector('.wx-pop'));
  console.log(`点面板外部 → 面板${afterOuter ? '未关闭 ✘' : '已关闭 ✔'}`);

  await p.click('.wx-now');
  await sleep(1200);
  await p.screenshot({ path: `${OUT}/${TAG}-fix-full.png`, clip: { x: 0, y: 0, width: 1440, height: 400 } });
  await p.screenshot({ path: `${OUT}/${TAG}-fix-zoom.png`, clip: { x: 620, y: 30, width: 500, height: 260 } });

  console.log('\n=== 多视口 ===');
  for (const w of [1280, 1440, 1920]) {
    await p.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
    await sleep(900);
    const m = await probe();
    console.log(`${w}px: 面板 ${m.popRect ? m.popRect.w + 'px@L' + m.popRect.l + ' RT' + m.popRect.rt : '—'} | 居中偏差 ${m.centering}px | 溢出 ${m.overflowLeft || m.overflowRight ? '✘' : '否'}`);
  }
  // 副驾抽屉（z-index:950）打开时天气面板应让位到 900，避免压住抽屉
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await sleep(600);
  const openNow = await p.evaluate(() => !!document.querySelector('.wx-pop'));
  if (openNow) { await p.click('.wx-now'); await sleep(400); }
  await p.click('.tb-copilot');
  await sleep(1400);
  const drawerOpen = await p.evaluate(() => !!document.querySelector('.copilot'));
  await p.click('.wx-now');
  await sleep(1000);
  const z = await p.evaluate(() => {
    const pop = document.querySelector('.wx-pop');
    const drawer = document.querySelector('.copilot');
    return {
      open: !!pop,
      popZ: pop ? getComputedStyle(pop).zIndex : null,
      drawerZ: drawer ? getComputedStyle(drawer).zIndex : null,
    };
  });
  console.log(`\n=== 与副驾抽屉的层级 ===`);
  console.log(`抽屉已打开=${drawerOpen} 天气面板已打开=${z.open} → 面板 z=${z.popZ}（应 900）抽屉 z=${z.drawerZ} ${Number(z.popZ) < Number(z.drawerZ) ? '✔ 抽屉在上' : '✘ 面板压住抽屉'}`);
  await p.screenshot({ path: `${OUT}/${TAG}-drawer.png`, clip: { x: 0, y: 0, width: 1440, height: 420 } });

  await b.close();
  console.log('\n截图 → ' + OUT);
})();