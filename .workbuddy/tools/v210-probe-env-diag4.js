// 诊断④：为什么进改单后编辑网格是空的 —— 看 forecast 接口回执
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  p.on('dialog', (d) => d.accept());
  const api = [];
  p.on('response', async (r) => {
    const u = r.url();
    if (!/\/api\/forecast/.test(u)) return;
    let body = '';
    try { body = (await r.text()).slice(0, 200) } catch (e) { body = '(read err)' }
    api.push(r.status() + ' ' + r.request().method() + ' ' + u.replace(/^https?:\/\/[^/]+/, '').slice(0, 70) + '  → ' + body.replace(/\s+/g, ' '));
  });
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 200)));

  await p.setViewport({ width: 1600, height: 950, deviceScaleFactor: 1 });
  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2400);
  await p.evaluate(() => { const el = Array.from(document.querySelectorAll('button,a')).find((x) => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3600);
  await p.evaluate(() => { const el = Array.from(document.querySelectorAll('a')).find((x) => x.getAttribute('href') === '#/forecast'); el && el.click(); });
  await sleep(4000);
  await p.evaluate(() => { const el = Array.from(document.querySelectorAll('button,a')).find((x) => /^历史期次$/.test(String(x.textContent).trim())); el && el.click(); });
  await sleep(3000);
  await p.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('table tbody tr'))
    for (const tr of rows) { const btn = Array.from(tr.querySelectorAll('button,a')).find((x) => /查看/.test(String(x.textContent))); if (btn) { btn.click(); return } }
  })()`);
  await sleep(5200);
  api.length = 0;
  await p.evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^改单$/.test(String(x.textContent).trim())); b && b.click() })()`);
  await sleep(9000);

  const d = await p.evaluate(`(() => {
    const ga = document.querySelector('.grid-area') || document.querySelector('.edit-grid-wrap')
    const sk = document.querySelector('.tbl-skeleton')
    const ins = document.querySelectorAll('.edit-tbl input').length
    const allIns = document.querySelectorAll('input').length
    return JSON.stringify({
      hasEditTbl: !!document.querySelector('.edit-tbl'),
      editTblInputs: ins,
      pageInputs: allIns,
      skeleton: !!sk,
      gridText: ga ? String(ga.innerText || '').replace(/\\s+/g, ' ').slice(0, 320) : '(no grid-area)',
      tbodyRows: document.querySelectorAll('.edit-tbl tbody tr').length,
      tbodyHTML: (document.querySelector('.edit-tbl tbody') || {}).innerHTML ? String(document.querySelector('.edit-tbl tbody').innerHTML).slice(0, 300) : null,
    })
  })()`);
  console.log('=== 页面状态 ===');
  console.log(JSON.stringify(JSON.parse(d), null, 1));
  console.log('\n=== forecast 接口 ===');
  api.forEach((x) => console.log('  ' + x));
  console.log('\n=== console 错误 ===');
  errs.slice(0, 8).forEach((x) => console.log('  ' + x));
  await b.close();
})();
