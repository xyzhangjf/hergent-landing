// 「新建期次」提为常显按钮的功能验收：
//  1) 工具栏不再有「⋯」触发按钮（含 .tb-more / 文本为 ⋯ 的按钮）
//  2) 点击「新建期次」→ 新建期次表单(.card.new-period)出现，且「创建」按钮可点
//  3) 「历史期次」页每行的「关闭 / 删除」按钮仍在（承接原 ⋯ 菜单的低频操作）
// 用法：NODE_PATH=<ws>/node_modules node toolbar-newperiod-func.js
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('a')].find(x => x.getAttribute('href') === '#/forecast'); el && el.click(); });
  await sleep(3200);

  const r = {};

  // 1) ⋯ 是否彻底移除
  r.moreBtnGone = await p.evaluate(() => {
    const tb = document.querySelector('.card.toolbar');
    const dots = [...tb.querySelectorAll('button')].filter(x => (x.textContent || '').trim() === '⋯' || x.classList.contains('tb-more'));
    return { count: dots.length, tbPopCount: tb.querySelectorAll('.tb-pop').length };
  });

  // 2) 点击「新建期次」
  r.clickNewPeriod = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.card.toolbar button')].find(x => /新建期次/.test(x.textContent));
    if (!btn) return { found: false };
    const info = { found: true, left: Math.round(btn.getBoundingClientRect().left), w: Math.round(btn.getBoundingClientRect().width), title: btn.getAttribute('title'), aria: btn.getAttribute('aria-label') };
    btn.click();
    return info;
  });
  await sleep(900);
  r.formAppeared = await p.evaluate(() => {
    const f = document.querySelector('.card.new-period');
    if (!f) return { ok: false };
    const inputs = [...f.querySelectorAll('input')].map(i => i.getAttribute('placeholder'));
    const createBtn = [...f.querySelectorAll('button')].find(x => /创建/.test(x.textContent));
    return { ok: true, inputs, hasCreate: !!createBtn };
  });
  // 再点一次应可收起（openNewPeriod 为 toggle）—— 记录下来避免误判
  r.toggleBack = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.card.toolbar button')].find(x => /新建期次/.test(x.textContent));
    btn.click(); return true;
  });
  await sleep(600);
  r.formClosedAfterToggle = await p.evaluate(() => !document.querySelector('.card.new-period'));

  // 工具栏单行 + 该按钮位置（在第 2 个控件位）
  r.toolbarOrder = await p.evaluate(() => {
    const tb = document.querySelector('.card.toolbar');
    return [...tb.children].filter(c => getComputedStyle(c).display !== 'none' && !c.className.toString().match(/pop-overlay/))
      .map(c => ({ cls: (c.className || '').toString().split(' ').filter(x => /^tb-/.test(x)).join('.') || c.className.toString().split(' ')[0], txt: (c.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 46), h: Math.round(c.getBoundingClientRect().height), top: Math.round(c.getBoundingClientRect().top) }));
  });

  // 3) 历史期次页的关闭/删除入口
  await p.evaluate(() => { const el = [...document.querySelectorAll('.module-tabs button')].find(x => /历史期次/.test(x.textContent)); el && el.click(); });
  await sleep(2200);
  r.history = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('table tbody tr')];
    const acts = rows.map(tr => [...tr.querySelectorAll('button')].map(x => (x.textContent || '').trim()));
    return { rows: rows.length, acts: acts.slice(0, 6) };
  });

  console.log(JSON.stringify(r, null, 2));
  await b.close();
})();
