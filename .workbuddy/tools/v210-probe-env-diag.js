// v210 探针环境诊断：为什么期次没选中 / 编辑网格没渲染
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  p.on('dialog', (d) => d.accept());
  await p.setViewport({ width: 1600, height: 950, deviceScaleFactor: 1 });
  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2400);
  const loginBtn = await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll('button,a')).find((x) => /演示/.test(x.textContent));
    return el ? String(el.textContent).trim().slice(0, 30) : null;
  });
  console.log('登录页「演示」入口: ' + JSON.stringify(loginBtn));
  await p.evaluate(() => { const el = Array.from(document.querySelectorAll('button,a')).find((x) => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3600);
  console.log('登录后 URL: ' + p.url());
  await p.evaluate(() => { const el = Array.from(document.querySelectorAll('a')).find((x) => x.getAttribute('href') === '#/forecast'); el && el.click(); });
  await sleep(4000);
  console.log('进预报页 URL: ' + p.url());

  const d = await p.evaluate(`(() => {
    const sel = document.querySelector('.sel-period')
    const sels = Array.from(document.querySelectorAll('select')).map((s) => ({
      cls: s.className, n: s.options.length,
      opts: Array.from(s.options).slice(0, 5).map((o) => o.value + '|' + o.text.slice(0, 18)),
    }))
    const btns = Array.from(document.querySelectorAll('button')).map((b) => String(b.textContent).trim()).filter(Boolean)
    return JSON.stringify({
      hasSelPeriod: !!sel,
      selPeriodOptions: sel ? Array.from(sel.options).map((o) => o.value + '|' + o.text.slice(0, 20)) : null,
      allSelects: sels,
      btnSample: btns.slice(0, 24),
      bodyText: String(document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 300),
      inputs: document.querySelectorAll('input[data-r]').length,
      editTbl: !!document.querySelector('.edit-tbl'),
      gridArea: !!document.querySelector('.grid-area'),
      fsBtn: !!document.querySelector('.grid-fs-btn'),
    })
  })()`);
  console.log(JSON.stringify(JSON.parse(d), null, 1));
  await b.close();
})();
