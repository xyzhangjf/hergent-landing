// 天气面板「法定节假日名称 + 休/班 徽标」验收脚本
// 用法：NODE_PATH=<ws>/node_modules node weather-holiday-audit.js [tag]
// 量：日卡片数量/宽度、日期元素宽、徽标几何、与周次行的重叠、容器溢出
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = process.argv[2] || 'now';
const OUT = '/tmp/wx-hd';
fs.mkdirSync(OUT, { recursive: true });
const VPS = [1280, 1440, 1920];

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  const probe = () => p.evaluate(() => {
    const R = el => { const r = el.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1) }; };
    const pop = document.querySelector('.wx-pop');
    if (!pop) return { err: 'no pop' };
    const daysBox = pop.querySelector('.wx-days');
    const cards = [...pop.querySelectorAll('.wx-day')];
    const wrap = pop.querySelector('.wx-days-wrap');
    const wR = R(daysBox), wrapR = R(wrap);
    const rows = cards.map(c => {
      const dayEl = c.querySelector('.wx-d-day');
      const dateEl = c.querySelector('.wx-d-date');
      const dtEl = c.querySelector('.wx-d-dt');
      const hbEl = c.querySelector('.wx-hb');
      const cR = R(c);
      return {
        day: (dayEl ? dayEl.textContent : '').trim(),
        date: (dateEl ? dateEl.textContent : '').trim(),
        cardW: cR.w,
        cardL: cR.l, cardR: cR.r,
        dateTxt: dtEl ? dtEl.textContent.trim() : null,
        dateW: dtEl ? R(dtEl).w : null,
        hb: hbEl ? hbEl.textContent.trim() : null,
        hbW: hbEl ? R(hbEl).w : null,
        hbH: hbEl ? R(hbEl).h : null,
        // 徽标相对卡片右/上边界的位置：>0 表示溢出卡片
        hbOverCardR: hbEl ? +(R(hbEl).r - cR.r).toFixed(1) : null,
        hbOverCardT: hbEl ? +(cR.t - R(hbEl).t).toFixed(1) : null,
        // 徽标与「周X / 今天」文本盒是否交叠
        hbOverlapDay: hbEl && dayEl ? +Math.max(0, Math.min(R(hbEl).r, R(dayEl).r) - Math.max(R(hbEl).l, R(dayEl).l)) *
                                     +Math.max(0, Math.min(R(hbEl).b, R(dayEl).b) - Math.max(R(hbEl).t, R(dayEl).t)) : null,
        // 徽标与「日期 / 节日名」文本盒的交叠面积（应由定位外置 → 0 或近 0）
        hbOverlapText: hbEl && dtEl ? +Math.max(0, Math.min(R(hbEl).r, R(dtEl).r) - Math.max(R(hbEl).l, R(dtEl).l)).toFixed(1) *
                                      +Math.max(0, Math.min(R(hbEl).b, R(dtEl).b) - Math.max(R(hbEl).t, R(dtEl).t)).toFixed(1) : null,
        tip: c.getAttribute('title'),
        cls: (c.className || '').toString(),
      };
    });
    const marked = rows.filter(r => r.hb || (r.dateTxt && r.dateTxt !== r.date));
    return {
      n: cards.length,
      firstDate: rows[0] ? rows[0].date : null,
      lastDate: rows[rows.length - 1] ? rows[rows.length - 1].date : null,
      cardWmin: Math.min(...rows.map(r => r.cardW)),
      cardWmax: Math.max(...rows.map(r => r.cardW)),
      gap: rows.length > 1 ? +(rows[1].cardL - rows[0].cardR).toFixed(1) : null,
      // 横向溢出：最后一张卡内的徽标是否越出滚动容器右内边
      maxHbOverCardR: Math.max(...rows.map(r => r.hbOverCardR == null ? -99 : r.hbOverCardR)),
      scrollW: daysBox.scrollWidth, clientW: daysBox.clientWidth,
      clipR: +(Math.max(...rows.map(r => r.cardR)) - wR.r).toFixed(1),
      marked: marked.map(m => `${m.date}→${m.dateTxt}/${m.hb || '—'} card[${m.cardW}] hb[${m.hbW}×${m.hbH}] 越卡右${m.hbOverCardR} 越卡上${m.hbOverCardT} 与周次重叠${m.hbOverlapDay} 与文字重叠${m.hbOverlapText}px² 提示「${m.tip}」`),
      all: rows.map(r => `${r.date}${r.hb ? '/' + r.hb : ''}`),
    };
  });

  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(4500);
  await p.click('.wx-now');
  await sleep(1500);

  const r = await probe();
  if (r.err) { console.log(r.err); await b.close(); return; }
  console.log(`日卡片 ${r.n} 张  ${r.firstDate} → ${r.lastDate}`);
  console.log(`卡宽 ${r.cardWmin}–${r.cardWmax}px  卡间距 ${r.gap}px  滚动容器 ${r.clientW}/${r.scrollW}px`);
  console.log(`全部: ` + r.all.join('  '));
  console.log(`\n标记日（${r.marked.length} 个）:`);
  r.marked.forEach(m => console.log('  ' + m));
  console.log(`\n徽标最多越出卡片右缘 ${r.maxHbOverCardR}px  末卡右缘超容器 ${r.clipR}px`);

  await p.screenshot({ path: `${OUT}/${TAG}-1440.png`, clip: { x: 0, y: 0, width: 1440, height: 300 } });
  // 面板特写（含标记日）
  const box = await p.evaluate(() => { const e = document.querySelector('.wx-pop'); const r = e.getBoundingClientRect(); return { x: Math.max(0, r.left - 6), y: Math.max(0, r.top - 6), width: r.width + 12, height: r.height + 12 }; });
  await p.screenshot({ path: `${OUT}/${TAG}-pop-2x.png`, clip: box });

  for (const w of VPS) {
    await p.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
    await sleep(700);
    const q = await probe();
    console.log(`${w}px: 卡宽 ${q.cardWmin}–${q.cardWmax} | 容器 ${q.clientW}/${q.scrollW} | 徽标越卡右 ${q.maxHbOverCardR} | 末卡超容器 ${q.clipR}`);
  }

  await b.close();
  console.log('\n截图 → ' + OUT);
})();
