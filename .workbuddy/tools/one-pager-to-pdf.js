// 把一页纸 HTML 渲染成 A4 单页 PDF，并导出一张 PNG 供肉眼复核
// 用法: node one-pager-to-pdf.js <in.html> <out.pdf> <out.png>
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  const src = path.resolve(process.argv[2]);
  const outPdf = path.resolve(process.argv[3]);
  const outPng = process.argv[4] ? path.resolve(process.argv[4]) : null;

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  // 190mm 内容宽 @96dpi ≈ 718px，留一点余量
  await page.setViewport({ width: 736, height: 1100, deviceScaleFactor: 2 });
  await page.goto('file://' + encodeURI(src), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts && document.fonts.ready);

  const m = await page.evaluate(() => {
    const el = document.querySelector('.page');
    const r = el.getBoundingClientRect();
    // A4 内容区高度：297 - 9 - 7 = 281mm  ->  281mm @96dpi
    const MM = 96 / 25.4;
    return {
      contentW_mm: +(r.width / MM).toFixed(1),
      contentH_mm: +(r.height / MM).toFixed(1),
      A4_budget_mm: 281.0,
      tables: document.querySelectorAll('table').length,
      text_len: document.body.innerText.length
    };
  });
  console.log(JSON.stringify(m, null, 2));

  await page.pdf({
    path: outPdf,
    format: 'A4',
    printBackground: true,
    margin: { top: '9mm', bottom: '7mm', left: '10mm', right: '10mm' }
  });

  if (outPng) {
    await page.screenshot({ path: outPng, fullPage: true });
    console.log('png ->', outPng);
  }
  await browser.close();
})();
