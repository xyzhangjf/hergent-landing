// 方案 A（双行）落地验证：真实结构复刻 → 多视口 × 多侧栏宽实测行数与高度
// 用法：NODE_PATH=<node_modules> node toolbar-planA-verify.js
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CSS = 'file:///Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/styles/variables.css';
const I = '<span class="ico"></span>';

const BASE = `
  html,body{margin:0;padding:0}
  body{font-family:-apple-system,'PingFang SC',sans-serif;-webkit-font-smoothing:antialiased;background:#f5f5f7}
  .stage{padding:0}
  /* ── 页面现状（与 Forecast.vue 一致） ── */
  .toolbar{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;flex-wrap:wrap;gap:12px;background:#fff;border:1px solid #e5e5ea}
  .tb-group{display:flex;align-items:center;gap:8px;flex:0 0 auto}
  .tb-group .btn{flex:0 0 auto;white-space:nowrap}
  /* ── 方案 A 新增：行1 容器（吸收期次组+搜索+筛选+状态） ── */
  .toolbar>.tb-head{display:flex;align-items:center;gap:8px;flex:1 1 auto;min-width:0}
  .toolbar>.tb-head .btn,.toolbar>.tb-head .tb-search,.toolbar>.tb-head .tb-toggle,
  .toolbar>.tb-head .sel-period,.toolbar>.tb-head .tb-pop{flex:0 0 auto;white-space:nowrap}
  .toolbar>.tb-head .tb-status-row{margin-left:auto}
  /* ── 方案 A 新增：动作组强制独占第二行 ── */
  .toolbar>.tb-right{flex:0 0 100%;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .toolbar>.tb-right .btn{flex:0 0 auto;white-space:nowrap}
  /* ── 紧凑变体（编辑态余量保护） ── */
  .toolbar.tb-dense>.tb-right{gap:6px}
  .toolbar.tb-dense .tb-sep{margin:0 3px}
  .sel-period{width:auto;max-width:220px;height:32px;padding:0 8px;flex-shrink:0;border:1px solid #e5e5ea;border-radius:8px;font-size:13px;background:#fff;color:#1c1c1e}
  .tb-search{display:inline-flex;align-items:center;gap:6px;padding:0 10px;height:32px;background:#fafafa;border:1px solid #e5e5ea;border-radius:8px;flex:0 0 auto}
  .tb-search .fld{border:none;background:transparent;outline:none;font-size:13px;width:150px}
  .tb-toggle{display:inline-flex;align-items:center;gap:5px;font-size:12px;background:#fafafa;border:1px solid #e5e5ea;border-radius:8px;height:32px;padding:0 10px;white-space:nowrap;flex:0 0 auto}
  .tb-toggle input{width:14px;height:14px;margin:0}
  .tb-sep{display:inline-block;width:1px;height:20px;background:#e5e5ea;margin:0 5px;flex:0 0 auto;opacity:.65;align-self:center}
  .tb-status-row{display:flex;align-items:center;gap:8px;flex:0 0 auto}
  .tb-pop{position:relative;display:inline-flex}
  .tb-more{min-width:32px;padding:0 9px;font-size:15px;line-height:1}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 16px;border:none;border-radius:12px;font-size:14px;font-weight:500}
  .btn-sm{height:32px;padding:0 12px;font-size:13px;border-radius:8px}
  .btn-primary{background:#0891b2;color:#fff}
  .btn-ghost{background:transparent;color:#1c1c1e;border:1px solid #e5e5ea}
  .btn .ico,.tb-search .ico{width:16px;height:16px;display:inline-block;flex:0 0 auto}
  .btn-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#e5e5ea;font-size:11px;font-weight:600}
  .btn-badge.err{background:#ff3b30;color:#fff}
  .confirm-badge{display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 10px;border-radius:8px;font-weight:500;white-space:nowrap}
  .confirm-badge.draft{background:#fafafa;color:#8e8e93}
  .confirm-badge.filter{background:#fafafa;color:#8e8e93}
`;

const U = (html) => html.replace(/^<(\w+)/, '<$1 data-u');
const status = (cls, t) => `<span class="confirm-badge ${cls}">${t}</span>`;

// 方案 A 真实结构：行1 = 期次区 + 搜索 + 筛选 + 状态徽标；行2 = 全部动作
function PLAN_A(edit, compact, filters) {
  const editBtns = edit
    ? `<button data-u class="btn btn-sm btn-ghost">取消</button>
       <button data-u class="btn btn-sm btn-ghost">回退</button>
       <button data-u class="btn btn-sm btn-ghost">查错<span class="btn-badge err">12</span></button>
       <button data-u class="btn btn-sm btn-ghost">${I} 补录商品</button>
       <button data-u class="btn btn-sm btn-primary">保存</button>`
    : `<button data-u class="btn btn-sm btn-primary">${I} 改单</button>`;
  return `<div class="card toolbar${compact ? ' tb-dense' : ''}">
  <div class="tb-head">
    <select data-u class="sel-period"><option>— 选择期次 —</option></select>
    <div data-u class="tb-pop"><button class="btn btn-sm btn-ghost tb-more">⋯</button></div>
    <button data-u class="btn btn-sm btn-ghost">${I} 新建期次</button>
    <span data-u class="tb-sep"></span>
    <div data-u class="tb-search">${I}<input class="fld" placeholder="搜索商品名 / 条码（后 4 位也行）…"></div>
    <label data-u class="tb-toggle"><input type="checkbox"> 仅显示有报单</label>
    <div data-u class="tb-status-row">${status('draft', '待审核')}${filters ? status('filter', '已隐藏 12 个零报单') : ''}</div>
  </div>
  <div class="tb-right">
    <button data-u class="btn btn-sm btn-ghost">${I} 导入</button>
    <div data-u class="tb-pop"><button class="btn btn-sm btn-ghost">${I} 导出 ${I}</button></div>
    <div data-u class="tb-pop"><button class="btn btn-sm btn-ghost">${I} 复制报单 ${I}</button></div>
    <span data-u class="tb-sep"></span>${editBtns}<span data-u class="tb-sep"></span>
    <button data-u class="btn btn-sm btn-ghost">${I} AI智能建议</button>
    <span data-u class="tb-sep"></span>
    <div data-u class="tb-pop"><button class="btn btn-sm btn-ghost">${I} 品牌<span class="btn-badge">3</span> ${I}</button></div>
    ${edit ? `<div data-u class="tb-pop"><button class="btn btn-sm btn-ghost">工具箱 ${I}</button></div>` : ''}
  </div>
</div>`;
}

const page = (body) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${CSS}"><style>${BASE}</style></head><body><div class="stage">${body}</div></body></html>`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=1'] });
  const p = await browser.newPage();

  const measure = async (html, viewportW) => {
    await p.setViewport({ width: viewportW, height: 900, deviceScaleFactor: 1 });
    await p.setContent(page(html), { waitUntil: 'load' });
    return p.evaluate(() => {
      const tb = document.querySelector('.toolbar');
      const items = [...tb.querySelectorAll('[data-u]')].map(u => {
        const b = u.getBoundingClientRect(); return { t: b.top, l: b.left, r: b.right };
      });
      const tops = [];
      for (const t of items.map(i => i.t).sort((a, b) => a - b))
        if (!tops.length || t - tops[tops.length - 1] > 12) tops.push(t);
      const rowOf = t => tops.findIndex(u => Math.abs(t - u) <= 12) + 1;
      const perRow = tops.map((u, i) => {
        const g = items.filter(x => rowOf(x.t) === i + 1);
        return Math.round(Math.max(...g.map(x => x.r)) - Math.min(...g.map(x => x.l)));
      });
      const box = tb.getBoundingClientRect();
      return { rows: tops.length, perRow, h: Math.round(box.height), inner: Math.round(tb.clientWidth - 32) };
    });
  };

  const CASES = [
    ['A 双行 · 非编辑', PLAN_A(false, false, false)],
    ['A 双行 · 非编辑+筛选徽标', PLAN_A(false, false, true)],
    ['A 双行 · 编辑', PLAN_A(true, false, false)],
    ['A 双行 · 编辑+筛选徽标', PLAN_A(true, false, true)],
    ['A 紧凑(dense) · 编辑', PLAN_A(true, true, false)],
    ['A 紧凑(dense) · 编辑+筛选徽标', PLAN_A(true, true, true)],
  ];

  console.log('=== 各视口实测（行数 / 高度 / 各行内容宽）| 侧栏 248px（默认）===');
  console.log('变体'.padEnd(26) + ['1280', '1366', '1440', '1680', '1920'].map(v => v.padStart(16)).join(''));
  const SIDEBAR = 248, PAD = 40;
  const over = [];
  for (const [name, html] of CASES) {
    const cells = [];
    for (const vw of [1280, 1366, 1440, 1680, 1920]) {
      const r = await measure(html, vw - SIDEBAR - PAD);
      const last = r.perRow[r.rows - 1];
      const ok = last <= r.inner;
      if (!ok) over.push(`${name} @${vw}: 末行 ${last} > 可用 ${r.inner}`);
      cells.push(`${r.rows}行/${r.h}px/${last}${ok ? '' : '!'}`.padStart(16));
    }
    console.log(name.padEnd(26) + cells.join(''));
  }

  console.log('\n=== 侧栏拖宽后（1440 视口）===');
  console.log('变体'.padEnd(26) + ['180', '248', '300', '360', '420'].map(v => ('侧栏' + v).padStart(14)).join(''));
  for (const [name, html] of CASES) {
    const cells = [];
    for (const sb of [180, 248, 300, 360, 420]) {
      const r = await measure(html, 1440 - sb - PAD);
      const last = r.perRow[r.rows - 1];
      const breakPx = last > r.inner ? '溢出' : '';
      cells.push(`${r.rows}行/${r.h}px${breakPx}`.padStart(14));
    }
    console.log(name.padEnd(26) + cells.join(''));
  }

  // 关键余量：编辑态行2 需要多少内宽才不折行
  console.log('\n=== 编辑态行2 的宽度余量（1440 视口）===');
  for (const [name, html] of CASES) {
    if (!name.includes('编辑')) continue;
    const need = [];
    for (const sb of [248]) {
      const r = await measure(html, 1440 - sb - PAD);
      need.push(`末行内容 ${r.perRow[r.rows - 1]}px / 可用 ${r.inner}px → 余量 ${r.inner - r.perRow[r.rows - 1]}px`);
    }
    console.log(`  ${name}: ${need.join('')}`);
  }
  if (over.length) { console.log('\n⚠️ 溢出项：'); over.forEach(o => console.log('  - ' + o)); }
  else console.log('\n✅ 所有场景无溢出');
  await browser.close();
})();
