// 用无头 Chrome 打开本地 HTML，截取其中的表格，肉眼验证样式是否真的生效
// 用法: node shot-html.js <x.html> <outPrefix>
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const src = path.resolve(process.argv[2]);
  const prefix = process.argv[3];
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 1300, deviceScaleFactor: 2 });
  await page.goto('file://' + encodeURI(src), { waitUntil: 'load' });

  const info = await page.evaluate(() => {
    const ts = Array.from(document.querySelectorAll('table'));
    return {
      title: document.title,
      tables: ts.length,
      firstTableBorder: ts[0] ? getComputedStyle(ts[0]).borderCollapse : null,
      firstThBorder: ts[0] && ts[0].querySelector('th') ? getComputedStyle(ts[0].querySelector('th')).borderTopWidth : null,
      firstThBg: ts[0] && ts[0].querySelector('th') ? getComputedStyle(ts[0].querySelector('th')).backgroundColor : null,
      bodyText: document.body.innerText.slice(0, 60)
    };
  });
  console.log(JSON.stringify(info, null, 2));

  await page.screenshot({ path: prefix + '-top.png' });

  const tables = await page.$$('table');
  for (const idx of [0, Math.min(3, tables.length - 1)]) {
    if (tables[idx]) {
      await tables[idx].screenshot({ path: prefix + '-t' + idx + '.png' });
      console.log('table shot ->', prefix + '-t' + idx + '.png');
    }
  }
  await browser.close();
})();
