// 节假日「远端自动更新」验收脚本
//   场景 A：正常 → 接口 200、写入本地缓存、标注正确
//   场景 B：接口中断 + 清空本地缓存 → 内置静态表兜底，标注不丢（关键降级验证）
// 用法：NODE_PATH=<ws>/node_modules node weather-holiday-remote-verify.js [tag]
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = process.argv[2] || 'now';
const OUT = '/tmp/wx-remote';
fs.mkdirSync(OUT, { recursive: true });
const LS_KEY = 'hergent_cn_holidays_v1';

// 面板标注 + 本地缓存
const probe = () => {
  const pop = document.querySelector('.wx-pop');
  if (!pop) return { err: 'no pop' };
  const rows = [...pop.querySelectorAll('.wx-day')].map((c) => {
    const day = c.querySelector('.wx-d-day');
    const dt = c.querySelector('.wx-d-dt');
    const hb = c.querySelector('.wx-hb');
    return {
      day: day ? day.textContent.trim() : '',
      date: dt ? dt.textContent.trim() : '',
      hb: hb ? hb.textContent.trim() : null,
      tip: c.getAttribute('title'),
    };
  });
  const marked = rows.filter((r) => r.hb || /[^\d/]/.test(r.date));   // 有徽标，或日期被节日名替换
  let ls = null;
  try {
    // ⚠️ 必须写字面量：probe 会被序列化注入页面执行，闭包里的 LS_KEY 拿不到（ReferenceError）
    const o = JSON.parse(localStorage.getItem('hergent_cn_holidays_v1') || 'null');
    if (o) ls = { at: o.at, years: Object.keys(o.years || {}), days: Object.keys((o.years || {})['2026']?.days || {}).length };
  } catch (e) { ls = { parseError: String(e) }; }
  return {
    n: rows.length,
    span: rows.length ? rows[0].day + ' ' + rows[0].date + ' … ' + rows[rows.length - 1].day + ' ' + rows[rows.length - 1].date : null,
    marked: marked.map((m) => `${m.day} ${m.date}${m.hb ? ' +' + m.hb : ''}  「${m.tip}」`),
    markedN: marked.length,
    ls,
  };
};

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  const apiHits = [];
  p.on('response', (res) => {
    if (res.url().includes('/api/weather/holidays')) apiHits.push({ url: res.url(), status: res.status() });
  });

  async function toForecast() {
    await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2200);
    await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find((x) => /演示/.test(x.textContent)); el && el.click(); });
    await sleep(4500);
  }
  async function openPanel() {
    if (!(await p.$('.wx-now'))) await toForecast();
    await p.click('.wx-now');
    await sleep(1800);
  }

  // ---------------- 场景 A ----------------
  console.log('===== 场景 A：正常路径 =====');
  await toForecast();
  await p.evaluate((k) => localStorage.removeItem(k), LS_KEY);   // 从干净状态开始
  await p.reload({ waitUntil: 'domcontentloaded' });
  await sleep(5000);
  await openPanel();
  const A = await p.evaluate(probe);
  if (A.err) { console.log(A.err); await b.close(); return; }
  console.log(`  日卡片 ${A.n} 张  ${A.span}`);
  console.log(`  标注日 ${A.markedN} 个:`);
  A.marked.forEach((m) => console.log('    ' + m));
  console.log(`  接口请求: ${apiHits.length} 次  ` + apiHits.map((h) => h.status).join(', '));
  console.log(`  本地缓存: ${A.ls ? `at=${A.ls.at} years=${JSON.stringify(A.ls.years)} 2026.days=${A.ls.days}` : '无'}`);
  await p.screenshot({ path: `${OUT}/${TAG}-A-normal.png`, clip: { x: 0, y: 0, width: 1440, height: 300 } });

  // 面板上的实际文本形如「周日 09/20班」——日期元素内联了徽标，故不带空格匹配
  const has = (arr, s) => arr.some((m) => m.includes(s));
  const badgeN = (arr, b) => arr.filter((m) => m.includes('+' + b)).length;
  const expect4 = ['09/20', '中秋节', '09/26', '09/27'];
  const okA = A.markedN === 4 && expect4.every((e) => has(A.marked, e))
    && badgeN(A.marked, '班') === 1 && badgeN(A.marked, '休') === 3;
  console.log(`  ${okA ? '✔' : '✘'} 标注与改造前一致（09/20 一个「班」+ 中秋三天「休」）`);
  const okApi = apiHits.some((h) => h.status === 200) && !!(A.ls && A.ls.years && A.ls.years.includes('2026'));
  console.log(`  ${okApi ? '✔' : '✘'} 接口 200 且写入本地缓存（${A.ls ? JSON.stringify(A.ls) : '无'}）`);

  // ---------------- 场景 B：接口中断 + 清缓存 ----------------
  console.log('\n===== 场景 B：接口中断 + 清空本地缓存 → 内置表兜底 =====');
  apiHits.length = 0;
  await p.setRequestInterception(true);
  p.on('request', (req) => {
    if (req.url().includes('/api/weather/holidays')) return req.abort('failed');
    req.continue();
  });
  await p.evaluate((k) => localStorage.removeItem(k), LS_KEY);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await sleep(5000);
  await openPanel();
  const B = await p.evaluate(probe);
  console.log(`  日卡片 ${B.n} 张  ${B.span}`);
  console.log(`  标注日 ${B.markedN} 个:`);
  B.marked.forEach((m) => console.log('    ' + m));
  console.log(`  本地缓存: ${B.ls ? JSON.stringify(B.ls) : '无（预期：接口被拦截，写不进去）'}`);
  await p.screenshot({ path: `${OUT}/${TAG}-B-degraded.png`, clip: { x: 0, y: 0, width: 1440, height: 300 } });

  const okB = B.markedN === 4 && expect4.every((e) => has(B.marked, e))
    && badgeN(B.marked, '班') === 1 && badgeN(B.marked, '休') === 3;
  console.log(`  ${okB ? '✔' : '✘'} 接口中断后标注仍然完整（内置静态表兜底，面板不退化）`);

  console.log(`\n  JS 报错: ${errs.length ? errs.join(' | ') : '无'}`);
  console.log(`\n截图 → ${OUT}`);
  await b.close();
  process.exit(okA && okApi && okB && !errs.length ? 0 : 1);
})();
