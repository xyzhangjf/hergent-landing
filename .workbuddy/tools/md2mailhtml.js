// Markdown -> 邮件友好 HTML（表格带内联样式，供粘贴进 QQ 邮箱富文本编辑器）
// 用法: node md2mailhtml.js <input.md> <output.html> [标题]
const fs = require('fs');
const { marked } = require('marked');

const src = process.argv[2];
const dst = process.argv[3];
const title = process.argv[4] || '邮件正文';

const md = fs.readFileSync(src, 'utf8');
let body = marked.parse(md, { gfm: true, breaks: false });

// 1) 给表格类元素注入内联样式（富文本编辑器对 <style> 支持不稳定，内联最稳）
body = body.replace(/<table(\s[^>]*)?>/g, function (m, a) {
  return '<table style="border-collapse:collapse;width:100%;margin:12px 0;font-size:13px;line-height:1.6;">';
});
body = body.replace(/<thead(\s[^>]*)?>/g, function () { return '<thead>'; });
body = body.replace(/<th(\s[^>]*)?>/g, function () {
  return '<th style="border:1px solid #c8ced8;background:#f2f5f9;padding:6px 9px;text-align:left;font-weight:600;vertical-align:top;">';
});
body = body.replace(/<td(\s[^>]*)?>/g, function () {
  return '<td style="border:1px solid #c8ced8;padding:6px 9px;vertical-align:top;">';
});

// 2) 标题 / 段落 / 列表保持邮件正文字号
body = body.replace(/<h1(\s[^>]*)?>/g, function () { return '<h1 style="font-size:19px;font-weight:700;margin:20px 0 10px;line-height:1.45;">'; });
body = body.replace(/<h2(\s[^>]*)?>/g, function () { return '<h2 style="font-size:16px;font-weight:700;margin:20px 0 9px;line-height:1.45;">'; });
body = body.replace(/<h3(\s[^>]*)?>/g, function () { return '<h3 style="font-size:14px;font-weight:700;margin:16px 0 8px;line-height:1.45;">'; });
body = body.replace(/<h4(\s[^>]*)?>/g, function () { return '<h4 style="font-size:13.5px;font-weight:700;margin:14px 0 7px;">'; });
body = body.replace(/<p>/g, '<p style="margin:9px 0;font-size:13.5px;line-height:1.75;">');
body = body.replace(/<li>/g, '<li style="margin:4px 0;font-size:13.5px;line-height:1.75;">');
body = body.replace(/<blockquote>/g, '<blockquote style="margin:10px 0;padding:8px 12px;border-left:3px solid #c8ced8;background:#f7f9fc;color:#4a5568;font-size:13px;line-height:1.7;">');
body = body.replace(/<code>/g, '<code style="background:#f2f5f9;padding:1px 4px;border-radius:3px;font-family:Consolas,Monaco,monospace;font-size:12.5px;">');
body = body.replace(/<hr(\s*\/)?>/g, '<hr style="border:none;border-top:1px solid #dde3ea;margin:16px 0;">');

const html = [
  '<!DOCTYPE html>',
  '<html lang="zh-CN"><head><meta charset="utf-8">',
  '<title>' + title + '</title>',
  '</head>',
  '<body style="margin:0;padding:24px 28px;background:#ffffff;color:#1a202c;">',
  '<div style="max-width:900px;font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;">',
  body,
  '</div></body></html>'
].join('\n');

fs.writeFileSync(dst, html, 'utf8');
console.log('OK ->', dst);
console.log('bytes', Buffer.byteLength(html, 'utf8'));
console.log('tables', (html.match(/<table/g) || []).length);
console.log('---head900---');
console.log(html.slice(html.indexOf('<div style="max-width'), html.indexOf('<div style="max-width') + 900));
