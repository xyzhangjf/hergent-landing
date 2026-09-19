// 导入弹窗层级修复的交互回归
// 用法：NODE_PATH=<ws>/node_modules node import-modal-zindex-regress.js [baseUrl]
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = process.argv[2] || 'https://hergent.cn';
const OUT = [];
const ok = (n, c, d) => OUT.push(`${c ? '✔' : '✘'} ${n}${d !== undefined ? '  → ' + d : ''}`);

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });   // 1200 = 遮挡区间内
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });

  await p.goto(BASE + '/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3500);
  await p.evaluate(() => { const a = [...document.querySelectorAll('a')].find(x => /预报订货|预报/.test(x.textContent)); a && a.click(); });
  await sleep(4500);
  await p.evaluate(() => {
    const sel = document.querySelector('select.sel-period');
    if (sel && sel.value === '0') {
      const opt = [...sel.options].find(o => o.value && o.value !== '0');
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }
  });
  await sleep(4000);

  // ---- 1. 打开导入弹窗，确认层级 ----
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /导入/.test(x.textContent) && !x.disabled); b && b.click(); });
  await sleep(900);
  let r = await p.evaluate(() => {
    const m = document.querySelector('.imp-modal'), o = document.querySelector('.imp-overlay'), t = document.querySelector('.grid-ctl-row .tb-pop');
    return { has: !!m, mz: m ? getComputedStyle(m).zIndex : null, oz: o ? getComputedStyle(o).zIndex : null, tz: t ? getComputedStyle(t).zIndex : null };
  });
  ok('弹窗打开', r.has === true);
  ok('弹窗层级 > 工具栏 .tb-pop', parseInt(r.mz) > parseInt(r.tz), `.imp-modal=${r.mz} vs .tb-pop=${r.tz}`);
  ok('遮罩层级 > 工具栏 .tb-pop', parseInt(r.oz) > parseInt(r.tz), `.imp-overlay=${r.oz} vs .tb-pop=${r.tz}`);

  // ---- 2. 交互回归①：点弹窗内部（标题栏）→ 弹窗应仍开着 ----
  await p.evaluate(() => { const hd = document.querySelector('.imp-modal .imp-hd b'); const r = hd.getBoundingClientRect(); document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)).click(); });
  await sleep(500);
  ok('回归① 点弹窗内部 → 弹窗仍开', await p.evaluate(() => !!document.querySelector('.imp-modal')));

  // ---- 3. 交互回归②：点弹窗内真实按钮（下载模板不下载，改测「选择文件…」的存在与可点性）----
  r = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.imp-modal button')].find(x => /选择文件/.test(x.textContent));
    if (!btn) return { found: false };
    const rr = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(rr.left + rr.width / 2), Math.round(rr.top + rr.height / 2));
    return { found: true, hitInModal: !!hit.closest('.imp-modal'), hitTag: hit.tagName + '.' + (hit.className || '').toString().split(' ')[0] };
  });
  ok('回归② 弹窗内按钮可命中（未被压住）', r.found && r.hitInModal, JSON.stringify(r));

  // ---- 4. 交互回归③：点品牌按钮坐标（被弹窗整体盖住的区域）----
  // 正解不是"关闭弹窗"：弹窗宽 560px 会把该按钮整段盖住 → 命中弹窗内容本身，
  // 点击被弹窗吞掉（既不误触品牌、也不穿透关闭）。判据 = 命中 inModal + 面板未弹出。
  r = await p.evaluate(() => {
    const t = document.querySelector('.grid-ctl-row .tb-pop');
    const rr = t.getBoundingClientRect();
    const x = Math.round(rr.left + rr.width / 2), y = Math.round(rr.top + rr.height / 2);
    const hit = document.elementFromPoint(x, y);
    hit.click();
    return { hitTag: hit.tagName + '.' + (hit.className || '').toString().split(' ')[0], hitInModal: !!hit.closest('.imp-modal'), x, y };
  });
  await sleep(700);
  const afterTap = await p.evaluate(() => ({ modal: !!document.querySelector('.imp-modal'), brandPanel: !!document.querySelector('.tb-pop-panel.brand-pop') }));
  ok('回归③ 品牌按钮区被弹窗盖住（命中弹窗内部）', r.hitInModal === true, JSON.stringify(r));
  ok('回归③ 该点击未误触品牌面板', afterTap.brandPanel === false);
  ok('回归③ 该点击未穿透关闭弹窗', afterTap.modal === true);

  // ---- 4b. 交互回归③-b：点遮罩区（弹窗之外）→ 应关闭弹窗 ----
  r = await p.evaluate(() => {
    const m = document.querySelector('.imp-modal').getBoundingClientRect();
    // 取弹窗左侧的空白带（视口内、弹窗之外）
    const x = Math.max(4, Math.round(m.left / 2)), y = Math.round(m.top + m.height / 2);
    const hit = document.elementFromPoint(x, y);
    hit.click();
    return { hitTag: hit.tagName + '.' + (hit.className || '').toString().split(' ')[0], isOverlay: hit.className.toString().includes('imp-overlay'), x, y };
  });
  await sleep(700);
  ok('回归③-b 遮罩区命中 .imp-overlay 且点击可关闭弹窗', r.isOverlay && (await p.evaluate(() => !document.querySelector('.imp-modal'))), JSON.stringify(r));

  // ---- 5. 交互回归④：弹窗关后，品牌按钮恢复可点（1120 行为未破坏）----
  await p.evaluate(() => { const t = document.querySelector('.grid-ctl-row .tb-pop button'); t && t.click(); });
  await sleep(700);
  ok('回归④ 弹窗关闭后品牌面板可正常打开', await p.evaluate(() => !!document.querySelector('.tb-pop-panel.brand-pop')));
  // 关闭品牌面板
  await p.evaluate(() => { const o = document.querySelector('.pop-overlay'); o && o.click(); });
  await sleep(600);
  ok('回归④ 品牌面板可关闭', await p.evaluate(() => !document.querySelector('.tb-pop-panel.brand-pop')));

  // ---- 6. 交互回归⑤：副驾抽屉共存（弹窗应压过 .copilot 950）----
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /AI$|问AI|AI副驾|AI 副驾/.test(x.textContent.trim())); b && b.click(); });
  await sleep(1500);
  const copilotOpen = await p.evaluate(() => !!document.querySelector('.copilot'));
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /导入/.test(x.textContent) && !x.disabled); b && b.click(); });
  await sleep(900);
  r = await p.evaluate(() => {
    const m = document.querySelector('.imp-modal'), c = document.querySelector('.copilot');
    if (!m) return { has: false };
    const rr = m.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(rr.left + rr.width / 2), Math.round(rr.top + rr.height / 2));
    return { has: true, mz: getComputedStyle(m).zIndex, cz: c ? getComputedStyle(c).zIndex : null, hitInModal: !!hit.closest('.imp-modal') };
  });
  ok(`回归⑤ 副驾抽屉共存（抽屉open=${copilotOpen}）`, r.has && r.hitInModal, JSON.stringify(r));

  // ---- 7. 别名弹窗层级（同根因一并修）----
  await p.evaluate(() => { const o = document.querySelector('.imp-overlay'); o && o.click(); });
  await sleep(600);
  r = await p.evaluate(() => {
    const sheets = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules] } catch (e) { return [] } });
    const pick = sel => { const x = sheets.find(r => r.selectorText && r.selectorText.includes(sel)); return x ? x.style.zIndex : null; };
    return { alOverlay: pick('.al-overlay'), alModal: pick('.al-modal'), impOverlay: pick('.imp-overlay'), impModal: pick('.imp-modal') };
  });
  ok('CSSOM 层级：.al-* 与 .imp-* 同层', r.alOverlay === r.impOverlay && r.alModal === r.impModal, JSON.stringify(r));

  console.log('\n===== 交互回归结果 =====');
  OUT.forEach(x => console.log(x));
  console.log('\nPAGE/CONSOLE ERRORS:', errs.length ? JSON.stringify(errs.slice(0, 6)) : '（无）');
  await p.screenshot({ path: '/tmp/imp-regress.png' });
  await b.close();
})();
