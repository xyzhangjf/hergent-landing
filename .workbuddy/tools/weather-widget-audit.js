// 天气组件改版验收：按钮瘦身（图标+温度）+ 位置信息迁入面板首行
// 用法：NODE_PATH=<ws>/node_modules node weather-widget-audit.js [tag]
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = process.argv[2] || 'now';
const OUT = '/tmp/wx-audit';
fs.mkdirSync(OUT, { recursive: true });
const VPS = [1280, 1440, 1920];

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  // 量按钮与面板几何 + 用「克隆旧结构」得到改造前对照宽度
  const probe = () => p.evaluate(() => {
    const R = el => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), l: Math.round(r.left), t: Math.round(r.top) }; };
    const btn = document.querySelector('.wx-now');
    if (!btn) return { err: 'no .wx-now' };
    const kids = [...btn.children].map(c => ({
      cls: (c.className || '').toString().split(' ')[0],
      txt: (c.textContent || '').trim(),
      ...R(c),
    }));
    // 改造前对照：克隆按钮并追加 城市名 + 天气描述，离屏量宽后移除
    const city = (document.querySelector('.wx-where-city') || {}).textContent || '—';
    const desc = ((document.querySelector('.wx-where-desc') || {}).textContent || '').split(' ')[0] || '多云';
    const tempTxt = kids.find(k => k.cls === 'wx-temp');
    const ghost = btn.cloneNode(true);
    ghost.style.cssText += ';position:absolute;left:-9999px;top:0;visibility:hidden';
    const c1 = document.createElement('span'); c1.className = 'wx-city'; c1.textContent = city;
    const c2 = document.createElement('span'); c2.className = 'wx-desc'; c2.textContent = desc;
    const kids2 = [...ghost.children];
    ghost.insertBefore(c1, kids2[1] || null);   // 城市名插在图标之后
    ghost.appendChild(c2);                      // 描述在末尾
    document.body.appendChild(ghost);
    const ghostW = Math.round(ghost.getBoundingClientRect().width + 24); // + padding 24（克隆未继承 border-box? 兜底）
    ghost.remove();

    const pop = document.querySelector('.wx-pop');
    let where = null;
    if (pop) {
      const w = pop.querySelector('.wx-where');
      const wk = w ? [...w.children].map(c => ({ cls: (c.className || '').toString().split(' ')[0], txt: (c.textContent || '').trim(), ...R(c) })) : [];
      // 行数：按 top 容差 8px 聚类（图标 14px / 城市名 13px / 徽标 10px 的 top 天然差 1–2px）
      const tops = [];
      for (const k of wk) if (!tops.some(t => Math.abs(t - k.t) <= 8)) tops.push(k.t);
      // 相邻间隙：> 40px 即视为「空洞」
      const gaps = wk.slice(0, -1).map((k, i) => Math.round(wk[i + 1].l - (k.l + k.w)));
      where = {
        exists: !!w,
        popW: R(pop).w, popH: R(pop).h, popL: R(pop).l, popR: Math.round(R(pop).l + R(pop).w),
        rows: tops.length,
        kids: wk,
        gaps,
        maxGap: gaps.length ? Math.max(...gaps) : 0,
        span: wk.length ? Math.round((wk[wk.length - 1].l + wk[wk.length - 1].w) - wk[0].l) : 0,
      };
    }
    // 顶栏：天气按钮变窄后，AI 按钮左移了多少 / 是否仍单行
    const ai = document.querySelector('.tb-copilot');
    return {
      btn: { ...R(btn), kids },
      btnText: (btn.textContent || '').trim(),
      btnAria: btn.getAttribute('aria-label'),
      btnTitle: btn.getAttribute('title'),
      ghostW,
      tempTxt: tempTxt ? tempTxt.txt : null,
      pop: where,
      aiLeft: ai ? R(ai).l : null,
    };
  });

  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(4000);

  console.log('=== 收起态按钮 ===');
  const closed = await probe();
  if (closed.err) { console.log(closed.err); await b.close(); return; }
  console.log(`按钮 ${closed.btn.w}×${closed.btn.h}px  文本="${closed.btnText}"  aria="${closed.btnAria}"`);
  console.log(`子元素: ` + closed.btn.kids.map(k => `${k.cls}"${k.txt}"[${k.w}×${k.h}]`).join('  '));
  console.log(`改造前对照（含城市名+描述）: ${closed.ghostW}px  →  现 ${closed.btn.w}px  (省 ${closed.ghostW - closed.btn.w}px)`);

  await p.screenshot({ path: `${OUT}/${TAG}-1-btn-closed.png`, clip: { x: 0, y: 0, width: 720, height: 60 } });

  // 展开
  await p.click('.wx-now');
  await sleep(900);
  const open = await probe();
  console.log('\n=== 展开面板 ===');
  if (open.pop && open.pop.exists) {
    const w = open.pop;
    console.log(`面板 ${w.popW}×${w.popH}px  行=${w.rows}  左 ${w.popL} 右 ${w.popR}`);
    console.log(`首行: ` + w.kids.map(k => `${k.cls}"${k.txt}"[${k.w}px@x${k.l}]`).join('  '));
    console.log(`首行内容跨度 ${w.span}px / 面板内宽 ${w.popW - 24}px；相邻间隙 [${w.gaps.join(', ')}]px，最大 ${w.maxGap}px ${w.maxGap > 40 ? '← 存在空洞 ✘' : '✔ 连续'}`);
  } else {
    console.log('✘ 面板未展开或首行缺失', JSON.stringify(open.pop));
  }
  await p.screenshot({ path: `${OUT}/${TAG}-2-pop-1440.png`, clip: { x: 0, y: 0, width: 1440, height: 260 } });

  // 多视口：面板是否溢出视口
  console.log('\n=== 多视口 ===');
  for (const w of VPS) {
    await p.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
    await sleep(700);
    const r = await probe();
    const ov = r.pop && r.pop.popL < 0;
    console.log(`${w}px: 按钮 ${r.btn.w}px | 面板 ${r.pop ? r.pop.popW + 'px@L' + r.pop.popL + ' 首行' + r.pop.rows + '行' : '—'} | 溢出 ${ov ? '✘ 左侧超出' : '否'}`);
    if (w === 1280) await p.screenshot({ path: `${OUT}/${TAG}-3-pop-1280.png`, clip: { x: 0, y: 0, width: 1280, height: 240 } });
  }
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(600);
  await p.screenshot({ path: `${OUT}/${TAG}-4-pop-1440-2x.png`, clip: { x: 600, y: 0, width: 460, height: 250 } });

  await b.close();
  console.log('\n截图 → ' + OUT);
})();
