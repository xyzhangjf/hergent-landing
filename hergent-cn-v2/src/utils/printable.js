// 自包含可打印 / 可下载成品页 —— 让 AI 报告、货损 / 工资 / 对账结果能一键带走
// （打印或另存 PDF），不依赖任何外部 CDN，全部样式内联、离线可用。
// 用法：openPrintable({ title, subtitle, bodyHtml, filename, generatedAt })
//       downloadPrintable({ ... })  // 直接下载 .html

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const BASE_CSS = `
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;color:#1f2733;background:#f4f6f8;line-height:1.7;}
  .doc{max-width:820px;margin:24px auto;background:#fff;padding:48px 56px;box-shadow:0 1px 4px rgba(0,0,0,.08);border-radius:8px;}
  .doc-hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #06b6d4;padding-bottom:16px;margin-bottom:24px;}
  .brand{font-size:13px;color:#0a4a55;font-weight:600;letter-spacing:.5px;}
  .doc-hd h1{font-size:22px;margin:6px 0 0;color:#1f2733;}
  .meta{font-size:12px;color:#6b7785;text-align:right;white-space:nowrap;}
  .doc-body{font-size:15px;}
  .doc-body h1,.doc-body h2,.doc-body h3{color:#0a4a55;line-height:1.35;margin:1.4em 0 .6em;}
  .doc-body h1{font-size:20px;}.doc-body h2{font-size:17px;}.doc-body h3{font-size:15px;}
  .doc-body p{margin:.7em 0;}
  .doc-body ul,.doc-body ol{margin:.6em 0;padding-left:1.4em;}
  .doc-body li{margin:.3em 0;}
  .doc-body blockquote{margin:.8em 0;padding:.4em 1em;border-left:3px solid #06b6d4;background:rgba(6,182,212,.06);color:#6b7785;}
  .doc-body pre{background:#0f172a;color:#e2e8f0;padding:14px 16px;border-radius:6px;overflow:auto;font-size:13px;}
  .doc-body code{background:#eef2f5;padding:1px 5px;border-radius:4px;font-size:13px;}
  .doc-body table{border-collapse:collapse;width:100%;margin:.8em 0;font-size:14px;}
  .doc-body th,.doc-body td{border:1px solid #e6e9ee;padding:7px 10px;text-align:left;}
  .doc-body th{background:#f7fafc;font-weight:600;}
  .doc-body hr{border:none;border-top:1px solid #e6e9ee;margin:1.4em 0;}
  .doc-body button{display:none;}
  .doc-ft{margin-top:32px;padding-top:14px;border-top:1px solid #e6e9ee;font-size:12px;color:#6b7785;text-align:center;}
  .toolbar{position:sticky;top:0;background:#fff;border-bottom:1px solid #e6e9ee;padding:10px 16px;text-align:right;z-index:10;max-width:820px;margin:0 auto;}
  .toolbar button{margin-left:8px;padding:6px 14px;border:1px solid #06b6d4;background:#06b6d4;color:#fff;border-radius:6px;cursor:pointer;font-size:13px;display:inline-block;}
  .toolbar button.ghost{background:#fff;color:#06b6d4;}
  @media print{
    body{background:#fff;}
    .doc{box-shadow:none;margin:0;max-width:none;padding:0 8mm;}
    .toolbar{display:none;}
    .doc-body h1,.doc-body h2,.doc-body h3,.doc-body blockquote{break-after:avoid;}
    .doc-body table,.doc-body pre{break-inside:avoid;}
  }
`

export function buildPrintableHtml({ title = 'Hergent 交付物', subtitle = '', brand = 'Hergent AI 经营副驾', bodyHtml = '', filename, generatedAt } = {}) {
  const stamp = generatedAt || new Date().toLocaleString('zh-CN')
  const safeTitle = escapeHtml(title)
  const safeBrand = escapeHtml(brand)
  const safeSub = escapeHtml(subtitle)
  const safeFname = escapeHtml(filename || title || 'hergent')
  const dlHandler = `(function(){var h='<!doctype html>'+document.documentElement.outerHTML;var b=new Blob([h],{type:'text/html;charset=utf-8'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='${safeFname}.html';a.click();URL.revokeObjectURL(a.href);})()`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<style>${BASE_CSS}</style>
</head><body>
<div class="toolbar">
  <button onclick="window.print()">打印 / 保存为 PDF</button>
  <button class="ghost" onclick="${dlHandler}">下载 HTML</button>
</div>
<div class="doc">
  <div class="doc-hd">
    <div>
      <div class="brand">${safeBrand}</div>
      <h1>${safeTitle}</h1>
    </div>
    <div class="meta">${safeSub ? safeSub + '<br>' : ''}${escapeHtml(stamp)}</div>
  </div>
  <div class="doc-body">${bodyHtml}</div>
  <div class="doc-ft">本交付物由 Hergent AI 经营副驾生成 · 仅供内部经营参考</div>
</div>
</body></html>`
}

export function openPrintable(opts = {}) {
  const html = buildPrintableHtml(opts)
  const w = window.open('', '_blank')
  if (!w) { alert('浏览器拦截了弹出窗口，请允许后重试'); return }
  w.document.open(); w.document.write(html); w.document.close()
}

export function downloadPrintable(opts = {}) {
  const html = buildPrintableHtml(opts)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = (opts.filename || opts.title || 'hergent') + '.html'
  a.click()
  URL.revokeObjectURL(a.href)
}
