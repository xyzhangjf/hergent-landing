// 诊断③：从「历史期次 → 查看」进入某期汇总表，再进改单（全程零写入）
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
  await p.evaluate(() => { const el = Array.from(document.querySelectorAll('button,a')).find((x) => /^历史期次$/.test(String(x.textContent).trim())); el && el.click(); });
  await sleep(3000);

  /* 点第一行的「查看」 */
  const clicked = await p.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('table tbody tr'))
    for (const tr of rows) {
      const btn = Array.from(tr.querySelectorAll('button,a')).find((x) => /查看/.test(String(x.textContent)))
      if (btn) { btn.click(); return String(tr.innerText || '').replace(/\\s+/g, ' ').slice(0, 80) }
    }
    return null
  })()`);
  console.log('点了「查看」: ' + JSON.stringify(clicked));
  await sleep(5000);
  console.log('URL: ' + p.url());

  const d = await p.evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button')).map((x) => String(x.textContent).trim()).filter(Boolean)
    const editBtn = Array.from(document.querySelectorAll('button')).find((x) => /^改单$/.test(String(x.textContent).trim()))
    const sel = document.querySelector('.sel-period')
    return JSON.stringify({
      hasEditBtn: !!editBtn, editBtnDisabled: editBtn ? editBtn.disabled : null,
      selPeriod: sel ? Array.from(sel.options).map((o) => o.value + '|' + o.text) : null,
      inputs: document.querySelectorAll('input[data-r]').length,
      buttons: btns.slice(0, 22),
      bodyText: String(document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 240),
    })
  })()`);
  console.log(JSON.stringify(JSON.parse(d), null, 1));

  /* 进改单并数可编辑格 */
  await p.evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /^改单$/.test(String(x.textContent).trim())); b && b.click() })()`);
  await sleep(5600);
  const d2 = await p.evaluate(`(() => {
    const ins = Array.from(document.querySelectorAll('.edit-tbl input[data-r]'))
    const qty = ins.filter((e) => e.className.indexOf('cell-qty') >= 0)
    const nz = qty.filter((e) => { const v = String(e.value || '').trim(); return v !== '' && Number(v) > 0 })
    const nm = ins.filter((e) => e.className.indexOf('cell-name') >= 0)
    return JSON.stringify({
      editTbl: !!document.querySelector('.edit-tbl'),
      inputs: ins.length, qty: qty.length, qtyNonZero: nz.length,
      nameCells: nm.length, firstNameLen: nm.length ? String(nm[0].value).length : 0,
      rows: document.querySelectorAll('.edit-tbl tbody tr').length,
      bodyText: String(document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 160),
    })
  })()`);
  console.log('进入改单后: ' + d2);
  console.log('非 GET 请求: ' + JSON.stringify(reqs));
  await b.close();
})();
