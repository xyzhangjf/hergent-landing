// 检测每页的水平溢出：page 自身、页头副标题、页脚、表格、SVG 的右边界是否越出内容区
const path = require('path');
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MM = 96 / 25.4;

(async () => {
  const src = path.resolve(process.argv[2]);
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 736, height: 1100, deviceScaleFactor: 1 });
  await page.goto('file://' + encodeURI(src), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts && document.fonts.ready);

  const out = await page.evaluate((MM) => {
    const res = [];
    const pages = [...document.querySelectorAll('.page')];
    pages.forEach((el, i) => {
      const pr = el.getBoundingClientRect();
      const right = pr.right;
      const bad = [];
      const check = (sel, label) => {
        el.querySelectorAll(sel).forEach((n, k) => {
          const r = n.getBoundingClientRect();
          if (r.right > right + 0.8) {
            bad.push(`${label}[${k}] 右溢 ${((r.right - right) / MM).toFixed(1)}mm :: ${(n.innerText || '').slice(0, 26).replace(/\n/g, ' / ')}`);
          }
        });
      };
      check('.sb', '页头副标题'); check('.tt', '页头标题'); check('.pg-ft', '页脚');
      check('table', '表格'); check('svg', '图'); check('.card', '卡片'); check('.band', '强调条');
      const scroll = { sw: el.scrollWidth, cw: el.clientWidth };
      res.push({
        i: i + 1,
        pageW_mm: +(pr.width / MM).toFixed(1),
        scrollW_mm: +(scroll.sw / MM).toFixed(1),
        over: bad
      });
    });
    return res;
  }, MM);

  let n = 0;
  for (const r of out) {
    if (r.over.length) { n += r.over.length; }
    console.log(`第 ${r.i} 页 | 宽 ${r.pageW_mm}mm | scrollWidth ${r.scrollW_mm}mm | 越界 ${r.over.length}`);
    r.over.forEach((b) => console.log('     - ' + b));
  }
  console.log(n === 0 ? '\n水平溢出：0 处 ✅' : `\n水平溢出：${n} 处 ❌`);
  await browser.close();
})();
