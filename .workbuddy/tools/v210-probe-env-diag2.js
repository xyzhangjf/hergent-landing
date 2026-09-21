// 诊断②：演示租户有哪些期次可用（历史期次 tab），以及「关闭期次」是否仍能进改单
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  p.on('dialog', (d) => d.accept());
  const reqs = [];
  p.on('request', (r) => { if (r.method() !== 'GET') reqs.push(r.method() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 80)); });
  await p.setViewport({ width: 1600, height: 950, deviceScaleFactor: 1 });
  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2400);
  await p.evaluate(() => { const el = Array.from(document.querySelectorAll('button,a')).find((x) => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3600);
  await p.evaluate(() => { const el = Array.from(document.querySelectorAll('a')).find((x) => x.getAttribute('href') === '#/forecast'); el && el.click(); });
  await sleep(4000);

  /* 切到「历史期次」tab 并把期次下拉的选项 dump 出来 */
  await p.evaluate(() => { const el = Array.from(document.querySelectorAll('button,a')).find((x) => /^历史期次$/.test(String(x.textContent).trim())); el && el.click(); });
  await sleep(3000);
  const d1 = await p.evaluate(`(() => {
    const sel = document.querySelector('.sel-period')
    const rows = Array.from(document.querySelectorAll('table tbody tr')).slice(0, 12).map((tr) => String(tr.innerText || '').replace(/\\s+/g, ' ').slice(0, 90))
    return JSON.stringify({
      selOptions: sel ? Array.from(sel.options).map((o) => o.value + '|' + o.text) : null,
      rowSample: rows,
      bodyText: String(document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 260),
    })
  })()`);
  console.log('=== 历史期次 tab ===');
  console.log(JSON.stringify(JSON.parse(d1), null, 1));

  /* 试：用期次下拉直接选一个（历史期次里若有） */
  const pick = await p.evaluate(`(() => {
    const sel = document.querySelector('.sel-period')
    if (!sel) return null
    const opt = Array.from(sel.options).find((o) => o.value && o.value !== '0')
    if (!opt) return null
    sel.value = opt.value
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return opt.value + '|' + opt.text
  })()`);
  console.log('\n选中: ' + JSON.stringify(pick));
  await sleep(3600);
  const d2 = await p.evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((x) => /^改单$/.test(String(x.textContent).trim()))
    return JSON.stringify({
      hasEditBtn: !!btn, editBtnDisabled: btn ? btn.disabled : null,
      inputsBefore: document.querySelectorAll('input[data-r]').length,
      bodyText: String(document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 200),
    })
  })()`);
  console.log('改单按钮: ' + d2);

  /* 试进改单 */
  await p.evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^改单$/.test(String(x.textContent).trim())); b && b.click() })()`);
  await sleep(5200);
  const d3 = await p.evaluate(`(() => {
    const ins = document.querySelectorAll('.edit-tbl input[data-r]')
    return JSON.stringify({
      editTbl: !!document.querySelector('.edit-tbl'),
      inputs: ins.length,
      firstName: ins.length ? String(ins[0].value).slice(0, 16) : null,
      qtyCells: document.querySelectorAll('.edit-tbl input.cell-qty').length,
      bodyText: String(document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 200),
    })
  })()`);
  console.log('进入改单后: ' + d3);
  console.log('\n非 GET 请求: ' + JSON.stringify(reqs));
  await b.close();
})();
