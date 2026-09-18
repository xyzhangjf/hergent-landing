// v192 出图：「到货周期」可隐藏 前/后对照（沙箱租户，红框标出被改的那一行）
// 用法: NODE_PATH=<managed workspace>/node_modules node v192-hidecycle-shots.js <TOKEN> <TENANT> <OUT_DIR>
const puppeteer = require('puppeteer-core');
const TOKEN = process.argv[2];
const TENANT = process.argv[3] || '9997';
const OUT = process.argv[4] || '/tmp';
const EXEC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--no-proxy-server', '--window-size=1500,940'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 940, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t);
    localStorage.setItem('hergent_v2_tenant', String(ten));
  }, TOKEN, TENANT);
  await page.goto('https://hergent.cn/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(4500);
  // 挑一个只读表真有行的期次
  const setPeriod = v => page.evaluate(val => {
    const sel = document.querySelector('select.sel-period');
    if (!sel) return false;
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, String(val));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, v);
  const opts = await page.$$eval('select.sel-period option', os => os.filter(o => Number(o.value) > 0).map(o => o.value)).catch(() => []);
  for (const v of opts) {
    await setPeriod(v); await sleep(2600);
    const n = await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('table.tbl')).find(x => !x.classList.contains('edit-tbl') && x.offsetParent !== null);
      return t ? t.querySelectorAll('tbody tr.data-row').length : 0;
    });
    if (n > 0) break;
  }

  // ① 列设置菜单打开 + 红框标「到货周期」那一行（复选框可用，不再灰）
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button.col-cfg.gear')].find(x => x.offsetParent !== null);
    if (b) b.click();
  });
  await sleep(900);
  await page.evaluate(() => {
    const li = [...document.querySelectorAll('.col-menu-list > li')].find(x => x.textContent.includes('到货周期'));
    if (!li) return;
    li.style.outline = '2px solid #e11d48';
    li.style.outlineOffset = '2px';
    li.style.borderRadius = '4px';
    li.style.background = 'rgba(225,29,72,.06)';
    const cb = li.querySelector('input[type=checkbox]');
    if (cb) { cb.style.outline = '2px solid #e11d48'; cb.style.outlineOffset = '1px'; }
  });
  await sleep(400);
  await page.screenshot({ path: OUT + '/01-列设置-到货周期复选框可用（沙箱）.png' });
  console.log('shot 1 ok');

  // ② 勾掉 → 关闭菜单 → 表头里「商品名称」后直接是「品牌」
  await page.evaluate(() => {
    const li = [...document.querySelectorAll('.col-menu-list > li')].find(x => x.textContent.includes('到货周期'));
    if (li) { const cb = li.querySelector('input[type=checkbox]'); if (cb) cb.click(); }
  });
  await sleep(1200);
  await page.evaluate(() => {
    const x = [...document.querySelectorAll('.col-menu-x')].find(b => b.offsetParent !== null);
    if (x) x.click();
  });
  await sleep(1400);
  // 红框标出「商品名称」相邻的两列（原本中间夹着到货周期）
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.cross-tbl')].find(tb => tb.getAttribute('role') === 'grid');
    if (!t) return;
    [...t.querySelectorAll('thead th')].slice(1, 3).forEach(th => {
      th.style.outline = '2px solid #e11d48';
      th.style.outlineOffset = '-2px';
    });
  });
  await sleep(400);
  await page.screenshot({ path: OUT + '/02-隐藏后-商品名称后直接是品牌（沙箱）.png' });
  console.log('shot 2 ok');

  await browser.close();
})().catch(e => { console.log('FATAL ' + e.stack); process.exit(2); });
