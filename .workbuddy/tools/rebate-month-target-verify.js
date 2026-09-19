// 返利仪表盘「目标口径 = 月度」真机验收（生产 hergent.cn，演示租户 张记乳品）
// 断言：
//  ① 2026-09：年度规则「测试月度品牌目标」(target_value 200 万 / monthly_amounts.09=90 万)
//     排行里目标必须显示 ¥900,000（月度分解）而不是 ¥2,000,000（年度总额）
//  ② 2026-08：同规则 → ¥1,100,000（08 月分解）
//  ③ 2026-10：该规则本月无分解 → 整条不进排行（本月无目标不臆测均分）
//  ④ 行内文案显性标注「9月目标」；图例注明「目标与达成同为所选月份口径」
//  ⑤ KPI 生效目标数 = 本月确有目标的规则数
// 用法：NODE_PATH=<ws>/node_modules node rebate-month-target-verify.js
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const readRows = (p) => p.evaluate(() => {
  const dash = document.querySelector('.dash-rank');
  if (!dash) return { err: 'no .dash-rank' };
  return [...dash.querySelectorAll('.rank-row')].map(r => ({
    name: (r.querySelector('.rr-name') || {}).textContent?.trim(),
    scope: (r.querySelector('.rr-scope') || {}).textContent?.trim(),
    ach: (r.querySelector('.rr-ach') || {}).textContent?.trim(),
    meta: [...r.querySelectorAll('.rr-meta > span')].map(s => s.textContent.trim().replace(/\s+/g, ' ')),
    est: (r.querySelector('.rr-est') || {}).textContent?.trim().replace(/\s+/g, ' '),
  }));
});

const setMonth = async (p, v) => {
  await p.evaluate((val) => {
    const i = document.querySelector('.achv-month');
    i.value = val;
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
  }, v);
  await sleep(3000);
};

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3500);
  await p.goto('https://hergent.cn/#/rebate', { waitUntil: 'domcontentloaded' });
  await sleep(4000);

  const out = { url: p.url() };
  out.tab = await p.evaluate(() => (document.querySelector('.main-tab.on') || {}).textContent?.trim());
  out.month0 = await p.evaluate(() => document.querySelector('.achv-month')?.value);
  out.legend = await p.evaluate(() => document.querySelector('.dash-legend-note')?.textContent?.trim());
  out.kpi = await p.evaluate(() => [...document.querySelectorAll('.dash-kpi > div')].map(x => x.textContent.trim().replace(/\s+/g, ' ')));
  out.m09 = await readRows(p);

  await setMonth(p, '2026-08');
  out.month08 = await p.evaluate(() => document.querySelector('.achv-month')?.value);
  out.r08 = await readRows(p);

  await setMonth(p, '2026-10');
  out.month10 = await p.evaluate(() => document.querySelector('.achv-month')?.value);
  out.r10 = await readRows(p);
  out.empty10 = await p.evaluate(() => (document.querySelector('.state-empty') || {}).textContent?.trim().slice(0, 80) || '');

  await setMonth(p, '2026-09');
  await p.screenshot({ path: '/tmp/rebate/rebate-month-target-1440.png', clip: { x: 0, y: 0, width: 1440, height: 900 } });

  console.log(JSON.stringify(out, null, 2));
  await b.close();
})();
