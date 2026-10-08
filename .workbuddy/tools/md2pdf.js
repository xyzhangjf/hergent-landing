#!/usr/bin/env node
/**
 * md2pdf.js — Markdown → A4 PDF（中文排版 · 打印友好）
 *
 * 用法：
 *   HG_PROXY= NODE_PATH=<workspace>/node_modules node md2pdf.js <in.md> <out.pdf> ["页脚标题"]
 *
 * 设计要点（都是踩过的坑）：
 *   1) 无头 Chrome 在本机必须 --no-sandbox --disable-gpu，否则 newPage 超时 / Session closed
 *   2) HG_PROXY= 空串必须显式传，否则会读本机代理变量
 *   3) 打印前清理内部标记（🔴 💡 ⚠️ ✅ ❌ 👉）—— 这些是给自己看的，投到大屏很业余
 *   4) 封面单独一页：第一个 h2 之前强制分页；此后每个 h1 起新页
 */
const fs = require('fs');
const { marked } = require('marked');
const puppeteer = require('puppeteer-core');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const [, , inPath, outPath, footerTitle = ''] = process.argv;
if (!inPath || !outPath) {
  console.error('用法: node md2pdf.js <in.md> <out.pdf> ["页脚标题"]');
  process.exit(2);
}

// ── 1. 读 + 打印前清理（只影响 PDF，不改源文件）
let md = fs.readFileSync(inPath, 'utf8');
const STRIP = ['\u{1F534}', '\u{1F4A1}', '\u26A0\uFE0F', '\u2705', '\u274C', '\u{1F449}', '\u{1F4CC}'];
for (const s of STRIP) {
  md = md.split(s + ' ').join('');
  md = md.split(s).join('');
}
md = md.split('\u{1F7E1} ').join('');

// ── 2. Markdown → HTML
let html = marked.parse(md, { gfm: true, breaks: false });

// 分页策略：不在这里插断页 —— 封面段（标题 + 元信息 + 一句话定位）自然连排，
// 封面之后的第一章（第 2 个 h1）起新页，其余章节连续排（由 CSS 控制）。
// 注意：别在第一个 h2 前插 pb —— 定位句很短，会留出大半页空白，像排版事故。
// 也注意：给「每个 h1」都强制分页，会让每章尾页剩 60%~90% 空白（实测某页仅 17% 填充）。

// 章节分页策略：默认「连续排」（每章尾页不会剩大片空白）；
// 设 MD2PDF_CHAPTER_BREAK=page 可回到「每个 h1 都起新页」。
const CHAPTER_BREAK = process.env.MD2PDF_CHAPTER_BREAK || 'auto';

const CSS = `
@page { size: A4; margin: 17mm 15mm 16mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 10.4pt; line-height: 1.75; color: #1f2937; margin: 0;
  -webkit-font-smoothing: antialiased; text-align: justify;
}

/* 封面 */
h1:first-of-type {
  font-size: 26pt; line-height: 1.25; margin: 30mm 0 0; letter-spacing: .5px;
  color: #0f172a; break-before: auto; border: 0; padding: 0;
}
h1 + h3 { font-size: 13pt; font-weight: 600; color: #2563eb; margin: 10px 0 26px; }
h1 + h3 + p { font-size: 10pt; color: #64748b; margin: 0 0 22px; letter-spacing: 3px; }

/* 章节 */
h1 {
  break-before: ${CHAPTER_BREAK}; break-after: avoid;
  font-size: 18pt; line-height: 1.4; color: #0f172a;
  margin: 13mm 0 14px; padding: 0 0 8px; border-bottom: 2.5px solid #2563eb;
  letter-spacing: .3px;
}
/* 封面之后的第一章：起新页，让封面独立成一页 */
h1:nth-of-type(2) { break-before: page; margin-top: 0; }
h2 {
  font-size: 13.4pt; color: #0f172a; margin: 22px 0 9px; padding-left: 9px;
  border-left: 4px solid #2563eb; line-height: 1.45; break-after: avoid;
}
h3 { font-size: 11.6pt; color: #1e3a8a; margin: 17px 0 7px; break-after: avoid; }
h4 { font-size: 10.8pt; color: #334155; margin: 13px 0 6px; break-after: avoid; }
.pb { break-before: page; }

p { margin: 8px 0; }
strong { color: #0f172a; font-weight: 700; }
a { color: #2563eb; text-decoration: none; }

ul, ol { margin: 8px 0 8px 4px; padding-left: 20px; }
li { margin: 4px 0; }
li > ul, li > ol { margin: 3px 0; }

blockquote {
  margin: 12px 0; padding: 11px 15px; background: #f8fafc;
  border-left: 3.5px solid #94a3b8; border-radius: 0 6px 6px 0; color: #334155;
}
blockquote > :first-child { margin-top: 0; }
blockquote > :last-child { margin-bottom: 0; }
blockquote h2, blockquote h3 {
  border: 0; padding: 0; margin: 0 0 7px; color: #0f172a; font-size: 14pt; line-height: 1.4;
}
blockquote p { margin: 5px 0; }

table {
  width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9.7pt;
  break-inside: avoid; page-break-inside: avoid;
}
th, td { border: 1px solid #dbe2ea; padding: 6px 9px; text-align: left; vertical-align: top; line-height: 1.6; }
/* 第一列不给最小宽度的话，Chrome 的自动列宽会把它压到 ~3 个字宽：
   两列表格里第二列是长段落时尤其明显，短标签会被拆成「交付测/量」「定价校/准」这种三行碎片。
   min-width 只设下限、不禁换行，所以长标签仍可正常折行，不会撑破页面。 */
th:first-child, td:first-child { min-width: 6.6em; }
th { background: #eef2f7; font-weight: 700; color: #0f172a; }
tr:nth-child(even) td { background: #fafbfd; }

hr { border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0; }
code {
  font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 9.2pt;
  background: #f1f5f9; padding: 1px 4px; border-radius: 3px; color: #b91c1c;
}
`;

const doc = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${footerTitle || 'document'}</title><style>${CSS}</style></head>
<body>${html}</body></html>`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-proxy-server', '--no-sandbox', '--disable-setuid-sandbox',
           '--disable-gpu', '--disable-software-rasterizer',
           '--disable-dev-shm-usage', '--no-first-run'],
    timeout: 45000,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(doc, { waitUntil: 'load', timeout: 60000 });
    await page.emulateMediaType('print');
    const foot = `<div style="width:100%;font-family:-apple-system,'PingFang SC',sans-serif;
      font-size:7.4pt;color:#94a3b8;padding:0 15mm;display:flex;justify-content:space-between;">
      <span>${footerTitle}</span>
      <span>第 <span class="pageNumber"></span> / <span class="totalPages"></span> 页</span>
      </div>`;
    await page.pdf({
      path: outPath, format: 'A4', printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: foot,
      margin: { top: '17mm', right: '15mm', bottom: '16mm', left: '15mm' },
    });
    const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
    console.log('OK  ' + outPath + '  (' + kb + ' KB)');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('FATAL ' + String(e.message).slice(0, 300)); process.exit(1); });
