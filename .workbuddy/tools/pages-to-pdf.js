// 把多页 HTML 渲染成 A4 分页 PDF，逐页量高度（防静默溢出），并每页导一张 PNG 供肉眼复核
// 用法: node pages-to-pdf.js <in.html> <out.pdf> [pngDir]
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MM = 96 / 25.4;               // 96dpi 下 1mm 的 CSS px
const BUDGET = 281.0;               // A4 297 - 上 9 - 下 7

(async () => {
  const src = path.resolve(process.argv[2]);
  const outPdf = path.resolve(process.argv[3]);
  const pngDir = process.argv[4] ? path.resolve(process.argv[4]) : null;
  if (pngDir && !fs.existsSync(pngDir)) fs.mkdirSync(pngDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 736, height: 1100, deviceScaleFactor: 2 });
  await page.goto('file://' + encodeURI(src), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts && document.fonts.ready);

  const rows = await page.evaluate((MM) => {
    return [...document.querySelectorAll('.page')].map((el, i) => {
      const r = el.getBoundingClientRect();
      const h = el.querySelector('.pg-hd .tt, .cv h1');
      return {
        i: i + 1,
        title: (h ? h.textContent : '(封面)').slice(0, 24),
        w_mm: +(r.width / MM).toFixed(1),
        h_mm: +(r.height / MM).toFixed(1),
        svg: el.querySelectorAll('svg').length,
        tables: el.querySelectorAll('table').length,
        chars: el.innerText.replace(/\s/g, '').length
      };
    });
  }, MM);

  let bad = 0;
  console.log('页 | 高度mm | 余量mm | 图 | 表 | 字数 | 标题');
  for (const r of rows) {
    const slack = +(BUDGET - r.h_mm).toFixed(1);
    const over = r.h_mm > BUDGET;
    if (over) bad++;
    console.log(
      `${String(r.i).padStart(2)} | ${String(r.h_mm).padStart(6)} | ${String(slack).padStart(6)} | ` +
      `${r.svg} | ${r.tables} | ${String(r.chars).padStart(4)} | ${r.title}${over ? '   <<< 溢出' : ''}`
    );
  }
  console.log(`\n合计 ${rows.length} 页｜溢出 ${bad} 页｜宽度 ${rows[0] ? rows[0].w_mm : '?'}mm（应 190）`);

  await page.pdf({
    path: outPdf,
    format: 'A4',
    printBackground: true,
    margin: { top: '9mm', bottom: '7mm', left: '10mm', right: '10mm' }
  });
  console.log('pdf ->', outPdf);

  if (pngDir) {
    const els = await page.$$('.page');
    for (let i = 0; i < els.length; i++) {
      const f = path.join(pngDir, 'p' + (i + 1) + '.png');
      await els[i].screenshot({ path: f });
    }
    console.log('png ->', els.length, '张 @', pngDir);
  }
  await browser.close();
})();
