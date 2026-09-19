// 工具栏改造方案宽度实测：V0 现状 / V1 双行 / V2 单行收敛(非编辑) / V3 单行收敛(编辑)
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CSS = 'file:///Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/styles/variables.css';
const I = '<span class="ico"></span>';

const BASE = `
  html,body{margin:0;padding:0}
  body{font-family:-apple-system,'PingFang SC',sans-serif;-webkit-font-smoothing:antialiased;background:#f5f5f7}
  .stage{padding:24px 0}
  .card.toolbar{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;flex-wrap:wrap;gap:12px;background:#fff;border:1px solid #e5e5ea;border-radius:16px}
  .tb-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:0 0 100%;flex-wrap:wrap}
  .tb-group,.tb-right{display:flex;align-items:center;gap:8px;flex:0 0 auto}
  .tb-group .btn,.tb-right .btn{flex:0 0 auto;white-space:nowrap}
  .sel-period{width:auto;max-width:220px;height:32px;padding:0 8px;flex-shrink:0;border:1px solid #e5e5ea;border-radius:8px;font-size:13px;background:#fff;color:#1c1c1e}
  .tb-search{display:inline-flex;align-items:center;gap:6px;padding:0 10px;height:32px;background:#fafafa;border:1px solid #e5e5ea;border-radius:8px;flex:0 0 auto}
  .tb-search .fld{border:none;background:transparent;outline:none;font-size:13px;width:150px}
  .tb-toggle{display:inline-flex;align-items:center;gap:5px;font-size:12px;background:#fafafa;border:1px solid #e5e5ea;border-radius:8px;height:32px;padding:0 10px;white-space:nowrap;flex:0 0 auto}
  .tb-toggle input{width:14px;height:14px;margin:0}
  .tb-sep{display:inline-block;width:1px;height:20px;background:#e5e5ea;margin:0 5px;flex:0 0 auto;opacity:.65;align-self:center}
  .tb-status-row{display:flex;align-items:center;gap:8px;flex:0 0 auto}
  .tb-status-row.block{flex:0 0 100%;margin-top:10px;justify-content:flex-end}
  .tb-pop{position:relative;display:inline-flex}
  .tb-more{min-width:32px;padding:0 9px;font-size:15px;line-height:1}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 16px;border:none;border-radius:12px;font-size:14px;font-weight:500}
  .btn-sm{height:32px;padding:0 12px;font-size:13px;border-radius:8px}
  .btn-icon{width:32px;height:32px;padding:0;border:1px solid #e5e5ea;background:transparent;border-radius:8px;display:inline-flex;align-items:center;justify-content:center}
  .btn-primary{background:#0891b2;color:#fff}
  .btn-ghost{background:transparent;color:#1c1c1e;border:1px solid #e5e5ea}
  .btn .ico,.tb-search .ico,.btn-icon .ico{width:16px;height:16px;display:inline-block;flex:0 0 auto}
  .btn-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#e5e5ea;font-size:11px;font-weight:600}
  .btn-badge.err{background:#ff3b30;color:#fff}
  .confirm-badge{display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 10px;border-radius:8px;font-weight:500;white-space:nowrap}
  .confirm-badge.draft{background:#fafafa;color:#8e8e93}
`;

const periodGroup = `<div class="tb-group">
  <select class="sel-period"><option>— 选择期次 —</option></select>
  <div class="tb-pop"><button class="btn btn-sm btn-ghost tb-more">⋯</button></div>
  <button class="btn btn-sm btn-ghost">${I} 新建期次</button></div>`;

const status = (cls, t) => `<span class="confirm-badge ${cls}">${t}</span>`;

// ── V0 现状：左组 / 右组 / 状态行（三行） ─────────────────
function V0(edit) {
  const editBtns = edit
    ? `<button class="btn btn-sm btn-ghost">取消</button><button class="btn btn-sm btn-ghost">回退</button>
       <button class="btn btn-sm btn-ghost">查错<span class="btn-badge err">12</span></button>
       <button class="btn btn-sm btn-ghost">${I} 补录商品</button><button class="btn btn-sm btn-primary">保存</button>`
    : `<button class="btn btn-sm btn-primary">${I} 改单</button>`;
  return `<div class="card toolbar">
  ${periodGroup}
  <div class="tb-group tb-right">
    <div class="tb-search">${I}<input class="fld" placeholder="搜索商品名 / 条码（后 4 位也行）…"></div>
    <label class="tb-toggle"><input type="checkbox"> 仅显示有报单</label>
    <span class="tb-sep"></span>
    <button class="btn btn-sm btn-ghost">${I} 导入</button>
    <div class="tb-pop"><button class="btn btn-sm btn-ghost">${I} 导出 ${I}</button></div>
    <div class="tb-pop"><button class="btn btn-sm btn-ghost">${I} 复制报单 ${I}</button></div>
    <span class="tb-sep"></span>${editBtns}<span class="tb-sep"></span>
    <button class="btn btn-sm btn-ghost">${I} AI智能建议</button>
    <span class="tb-sep"></span>
    <div class="tb-pop"><button class="btn btn-sm btn-ghost">${I} 品牌<span class="btn-badge">3</span> ${I}</button></div>
    ${edit ? `<div class="tb-pop"><button class="btn btn-sm btn-ghost">工具箱 ${I}</button></div>` : ''}
  </div>
  <div class="tb-status-row block">${status('draft', '待审核')}</div>
</div>`;
}

// ── V1 双行：行1=期次+搜索+筛选+状态；行2=操作区 ──────────
function V1(edit) {
  const editBtns = edit
    ? `<button class="btn btn-sm btn-ghost">取消</button><button class="btn btn-sm btn-ghost">回退</button>
       <button class="btn btn-sm btn-ghost">查错<span class="btn-badge err">12</span></button>
       <button class="btn btn-sm btn-ghost">${I} 补录商品</button><button class="btn btn-sm btn-primary">保存</button>`
    : `<button class="btn btn-sm btn-primary">${I} 改单</button>`;
  return `<div class="card toolbar">
  <div class="tb-row">
    ${periodGroup}
    <div class="tb-group">
      <div class="tb-search">${I}<input class="fld" placeholder="搜索商品名 / 条码（后 4 位也行）…"></div>
      <label class="tb-toggle"><input type="checkbox"> 仅显示有报单</label>
      <span class="tb-sep"></span>
      <div class="tb-status-row">${status('draft', '待审核')}</div>
    </div>
  </div>
  <div class="tb-row">
    <div class="tb-group">
      <button class="btn btn-sm btn-ghost">${I} 导入</button>
      <div class="tb-pop"><button class="btn btn-sm btn-ghost">${I} 导出 ${I}</button></div>
      <div class="tb-pop"><button class="btn btn-sm btn-ghost">${I} 复制报单 ${I}</button></div>
    </div>
    <div class="tb-group">
      <span class="tb-sep"></span>${editBtns}<span class="tb-sep"></span>
      <button class="btn btn-sm btn-ghost">${I} AI智能建议</button>
      <span class="tb-sep"></span>
      <div class="tb-pop"><button class="btn btn-sm btn-ghost">${I} 品牌<span class="btn-badge">3</span> ${I}</button></div>
      ${edit ? `<div class="tb-pop"><button class="btn btn-sm btn-ghost">工具箱 ${I}</button></div>` : ''}
    </div>
  </div>
</div>`;
}

// ── V2/V3 单行收敛：搜索→图标 / 仅显示→图标 / 导出+复制合并 / 状态内联 ──
function V2(edit) {
  const editBtnsFull = `<button class="btn btn-sm btn-ghost">取消</button><button class="btn btn-sm btn-ghost">回退</button>
      <button class="btn btn-sm btn-ghost">查错<span class="btn-badge err">12</span></button>
      <button class="btn btn-sm btn-ghost">${I} 补录商品</button><button class="btn btn-sm btn-primary">保存</button>`;
  const editBtnsLean = `<button class="btn btn-sm btn-ghost">取消</button><button class="btn btn-sm btn-primary">保存</button>
      <div class="tb-pop"><button class="btn btn-sm btn-ghost">更多 ${I}</button></div>`;
  const editBtns = edit ? editBtnsFull : `<button class="btn btn-sm btn-primary">${I} 改单</button>`;
  const advBtn = edit
    ? (edit ? `<div class="tb-pop"><button class="btn btn-sm btn-ghost">工具箱 ${I}</button></div>` : '')
    : '';
  return `<div class="card toolbar">
  ${periodGroup}
  <div class="tb-group tb-right">
    <button class="btn-icon" title="搜索商品">${I}</button>
    <button class="btn-icon" title="仅显示有报单（已开）">${I}</button>
    <span class="tb-sep"></span>
    <button class="btn btn-sm btn-ghost">${I} 导入</button>
    <div class="tb-pop"><button class="btn btn-sm btn-ghost">${I} 导出/复制 ${I}</button></div>
    <span class="tb-sep"></span>${editBtns}<span class="tb-sep"></span>
    <button class="btn btn-sm btn-ghost">${I} AI建议</button>
    <div class="tb-pop"><button class="btn btn-sm btn-ghost">${I} 品牌<span class="btn-badge">3</span> ${I}</button></div>
    ${advBtn}
    <span class="tb-sep"></span>
    <div class="tb-status-row">${status('draft', '待审核')}</div>
  </div>
</div>`;
}

function V4(edit) {
  const editBtns = edit
    ? `<button class="btn btn-sm btn-ghost">取消</button><button class="btn btn-sm btn-primary">保存</button>
       <div class="tb-pop"><button class="btn btn-sm btn-ghost">更多 ${I}</button></div>`
    : `<button class="btn btn-sm btn-primary">${I} 改单</button>`;
  return `<div class="card toolbar">
  ${periodGroup}
  <div class="tb-group tb-right">
    <button class="btn-icon" title="搜索商品">${I}</button>
    <button class="btn-icon" title="仅显示有报单">${I}</button>
    <span class="tb-sep"></span>
    <button class="btn btn-sm btn-ghost">${I} 导入</button>
    <div class="tb-pop"><button class="btn btn-sm btn-ghost">${I} 导出/复制 ${I}</button></div>
    <span class="tb-sep"></span>${editBtns}<span class="tb-sep"></span>
    <button class="btn btn-sm btn-ghost">${I} AI建议</button>
    <div class="tb-pop"><button class="btn btn-sm btn-ghost">${I} 品牌<span class="btn-badge">3</span> ${I}</button></div>
    ${edit ? `<div class="tb-pop"><button class="btn btn-sm btn-ghost">工具箱 ${I}</button></div>` : ''}
  </div>
</div>`;
}

function V3(edit) {
  const editBtns = edit
    ? `<button class="btn btn-sm btn-ghost">取消</button><button class="btn btn-sm btn-primary">保存</button>
       <div class="tb-pop"><button class="btn btn-sm btn-ghost">更多 ${I}</button></div>`
    : `<button class="btn btn-sm btn-primary">${I} 改单</button>`;
  return `<div class="card toolbar">
  ${periodGroup}
  <div class="tb-group tb-right">
    <button class="btn-icon" title="搜索商品">${I}</button>
    <span class="tb-sep"></span>
    <button class="btn btn-sm btn-ghost">${I} 导入</button>
    <div class="tb-pop"><button class="btn btn-sm btn-ghost">${I} 导出/复制 ${I}</button></div>
    <span class="tb-sep"></span>${editBtns}<span class="tb-sep"></span>
    <button class="btn btn-sm btn-ghost">${I} AI建议</button>
    <div class="tb-pop"><button class="btn btn-sm btn-ghost">${I} 品牌<span class="btn-badge">3</span> ${I}</button></div>
    <span class="tb-sep"></span>
    <div class="tb-status-row">${status('draft', '待审核')}</div>
  </div>
</div>`;
}

const page = (body) => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${CSS}"><style>${BASE}</style></head><body><div class="stage">${body}</div></body></html>`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-device-scale-factor=1'] });
  const p = await browser.newPage();
  await p.setViewport({ width: 3200, height: 900, deviceScaleFactor: 1 });

  const measure = async (html) => {
    await p.setContent(page(html), { waitUntil: 'load' });
    return p.evaluate(() => {
      const tb = document.querySelector('.toolbar');
      // 展开「行容器」到其子分组，保证量到的是真实内容宽度
      const units = [];
      for (const k of tb.children) {
        if (k.classList.contains('tb-row')) {
          for (const c of k.children) units.push(c);
        } else units.push(k);
      }
      const items = units.map(k => { const b = k.getBoundingClientRect(); return { t: b.top, w: b.width }; });
      const tops = [];
      for (const t of items.map(i => i.t).sort((a, b) => a - b))
        if (!tops.length || t - tops[tops.length - 1] > 6) tops.push(t);
      const rowOf = t => tops.findIndex(u => Math.abs(t - u) <= 6) + 1;
      const perRow = tops.map((u, i) => {
        const g = items.filter(x => rowOf(x.t) === i + 1);
        return Math.round(g.reduce((s, x) => s + x.w, 0) + (g.length - 1) * 12);
      });
      return { rows: tops.length, need1: perRow[0], perRow, h: Math.round(tb.getBoundingClientRect().height) };
    });
  };

  const V = [
    ['V0 现状 · 非编辑', V0(false)], ['V0 现状 · 编辑', V0(true)],
    ['V1 双行 · 非编辑', V1(false)], ['V1 双行 · 编辑', V1(true)],
    ['V2 单行收敛 · 非编辑', V2(false)], ['V2 单行收敛 · 编辑', V2(true)],
    ['V3 单行极简 · 编辑', V3(true)],
    ['V4 单行+状态外移 · 非编辑', V4(false)], ['V4 单行+状态外移 · 编辑', V4(true)],
  ];
  console.log('方案                        行数  高度   单行需内宽  各行宽度');
  const res = {};
  for (const [name, html] of V) {
    const r = await measure(html);
    res[name] = r;
    console.log(`${name.padEnd(24)}  ${r.rows}   ${String(r.h).padStart(4)}px  ${String(r.need1).padStart(5)}px     [${r.perRow.join(', ')}]`);
  }
  console.log('\n=== 换算到视口（工具栏内宽 = 视口 - 侧栏 - 内容padding40 - 卡片padding32）===');
  for (const [k, r] of Object.entries(res)) {
    const vp248 = r.need1 + 248 + 72, vp180 = r.need1 + 180 + 72;
    console.log(`${k.padEnd(24)} 侧栏248 → 需视口 ${vp248}px | 侧栏180 → 需视口 ${vp180}px`);
  }

  // ── 在你的实际视口下：工具栏可用宽度 = 视口 - 侧栏 - 40 - 32 ──
  console.log('\n=== 实际视口下的渲染结果（工具栏宽 = 视口 - 侧栏248 - 内容padding40）===');
  console.log('方案                        | 1440×900 | 1680  | 1920');
  for (const [name, html] of V) {
    const cells = [];
    for (const vw of [1440, 1680, 1920]) {
      await p.setViewport({ width: vw - 248 - 40, height: 900, deviceScaleFactor: 1 });
      await p.setContent(page(html), { waitUntil: 'load' });
      const r = await p.evaluate(() => {
        const tb = document.querySelector('.toolbar');
        const units = [];
        for (const k of tb.children) {
          if (k.classList.contains('tb-row')) { for (const c of k.children) units.push(c); } else units.push(k);
        }
        const tops = [];
        for (const t of units.map(u => u.getBoundingClientRect().top).sort((a, b) => a - b))
          if (!tops.length || t - tops[tops.length - 1] > 6) tops.push(t);
        return { rows: tops.length, h: Math.round(tb.getBoundingClientRect().height) };
      });
      cells.push(`${r.rows}行/${String(r.h).padStart(3)}px`);
    }
    console.log(`${name.padEnd(26)} | ${cells[0]} | ${cells[1]} | ${cells[2]}`);
  }
  await browser.close();
})();
