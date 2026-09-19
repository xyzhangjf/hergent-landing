// 复现「改单 → 删掉最后一列（报单单元）→ 保存失败」——**带选区**的决定性实验
//
// 背景（用户 2026-09-18 二次澄清）：
//   用户说「我只删了报单单元最后一列『永诺旗舰店』那一列」，即**只删一列**。
//   但 up-to-date 的 tenant_1 有 21 个客户列（all_units 跨期名册，2026-08-31 才上线）
//   ⇒ 删 1 列剩 20 列，customers 非空，不该 400。
//   ⇒ 所以「删一列就失败」必然另有路径。本轮专测**用户没说但一定会发生的那一步**：
//     **删列之前，用户通常已经用鼠标框选了一片区域**（覆盖到最后一列）。
//
// 已知无保护点（Forecast.vue:3806-3823 `selStats` computed）：
//   ```js
//   else { const ui = c - visibleCols.value.length; v = rw.qtyByUnit[cross.value.units[ui].name] }
//   ```
//   `units[ui]` 在 `ui >= units.length` 时是 undefined ⇒ 读 `.name` **抛 TypeError**。
//   而 `ctxDeleteCol` / `hdrDeleteCol` 删列后**都不清 `selRange`** ⇒ 选区仍指向已删列 ⇒ 必抛。
//   （对照：`cellText`(5024) / `commitCell`(4649) / `cellVal`(4621) 都有 `if (ui < units.length) return` ✅）
//
// 本探针逐案取证（记录**真实请求载荷 + 状态 + 响应体 + 耗时 + toast/banner 原文**）：
//   G0 建立选区（覆盖最后一列）→ 断言 .sel-stat 出现
//   G1 在**有选区**的情况下，右键最后一列表头 → 删除列
//   G2 删后是否出现 console/page error（selStats 越界）
//   G3 ★点保存 → 抓 banner / toast **原文**（这是判定「用户看到的就是这个」的直接证据）
//   H  对照组：**无选区**时删最后一列并保存（应正常 200）
//
// 用法: NODE_PATH=<managed>/node_modules node forecast-delcol-with-selection-verify.js <TOKEN> <TENANT>

const puppeteer = require('puppeteer-core');
const TOKEN = process.argv[2];
const TENANT = process.argv[3] || '9997';
const EXEC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://hergent.cn';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
const ok = (n, p, d) => { out.push({ n, pass: !!p, d: d === undefined ? '' : String(d) }); };

let rec = [];
let STEP = 0;

async function clickSave(page) {
  rec = [];
  await page.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); });
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .filter(x => x.offsetParent !== null && x.getBoundingClientRect().width > 0)
      .find(x => /^(保存|重试保存)$/.test(x.textContent.replace(/\s+/g, '')));
    if (!b) return 'no-button';
    const t = b.textContent.replace(/\s+/g, '');
    b.click();
    return t;
  });
  if (clicked === 'no-button') return { clicked: false };
  let last = null;
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    last = await page.evaluate(() => {
      const banner = document.querySelector('.save-fail-banner');
      const b = [...document.querySelectorAll('button')]
        .filter(x => x.offsetParent !== null)
        .find(x => /^(保存|重试保存|保存中…)$/.test(x.textContent.replace(/\s+/g, '')));
      return {
        banner: banner ? banner.textContent.replace(/\s+/g, ' ').trim() : '',
        btn: b ? b.textContent.replace(/\s+/g, '') : '',
        toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent.replace(/\s+/g, ' ').trim()),
      };
    });
    if (last.banner || (last.btn && !/保存中/.test(last.btn))) break;
  }
  await sleep(700);
  const fin = await page.evaluate(() => ({
    banner: (document.querySelector('.save-fail-banner') || {}).textContent || '',
    toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent.replace(/\s+/g, ' ').trim()),
  }));
  return {
    clicked: clicked,
    banner: String(fin.banner).replace(/\s+/g, ' ').trim(),
    toasts: (fin.toasts || []).filter(Boolean),
    reqs: rec.slice(),
  };
}

function summarize(res) {
  if (!res) return '    (未执行)';
  const L = [];
  const reqs = res.reqs || [];
  L.push(`    点到的按钮=${res.clicked}`);
  L.push(`    banner=${res.banner ? JSON.stringify(res.banner) : '(无)'}`);
  if ((res.toasts || []).length) L.push(`    toast=${JSON.stringify(res.toasts[res.toasts.length - 1])}`);
  if (!reqs.length) L.push('    ⚠️ 未捕获到任何写请求（= 前端在发请求前就抛了？）');
  reqs.forEach(q => {
    const p = q.reqBody || {};
    L.push(`    → ${q.url.replace(BASE, '')} [${q.status}] ${q.ms}ms customers=${(p.customers || []).length} rows=${(p.rows || []).length}`);
    if (q.respBody && q.respBody.length < 300) L.push(`        resp=${q.respBody}`);
  });
  return L.join('\n');
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, headless: 'new', args: ['--no-sandbox', '--window-size=1600,1000'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errs = [];
  page.on('console', async m => {
    if (m.type() !== 'error') return;
    const parts = [];
    for (const a of m.args()) {
      try { parts.push(await a.evaluate(e => (e && e.stack) || (e && e.message) || String(e))); }
      catch (e) { parts.push('?'); }
    }
    errs.push(`[step ${STEP}] ` + parts.join(' ').slice(0, 400));
  });
  page.on('pageerror', e => errs.push(`[step ${STEP}] PAGEERROR ${e.message}`.slice(0, 400)));
  page.on('request', r => {
    const u = r.url();
    if (r.method() !== 'GET' && (u.includes('/api/products/bulk-upsert') || u.includes('/api/forecast-submissions/save-matrix') || u.includes('/api/products/extra-values'))) {
      rec.push({ url: u, method: r.method(), t0: Date.now(), reqBody: (() => { try { return JSON.parse(r.postData() || '{}'); } catch (e) { return null; } })(), status: 0, respBody: '', ms: 0 });
    }
  });
  page.on('response', async r => {
    const hit = rec.filter(x => x.url === r.url() && !x.status).pop();
    if (!hit) return;
    hit.status = r.status();
    try { hit.respBody = (await r.text()).slice(0, 400); } catch (e) {}
    hit.ms = Date.now() - hit.t0;
  });

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t);
    localStorage.setItem('hergent_v2_tenant', String(ten));
  }, TOKEN, TENANT);

  STEP = 'goto';
  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 });
  ok('0 未被打回登录页', !/#\/login/.test(page.url()), page.url());
  await page.waitForSelector('table.tbl', { timeout: 30000 }).catch(() => {});
  await sleep(3500);

  // 选一个有报单行的期次
  const setPeriod = v => page.evaluate(val => {
    const sel = document.querySelector('select.sel-period');
    if (!sel) return false;
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, String(val));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, v);
  const opts = await page.$$eval('select.sel-period option', os => os.filter(o => Number(o.value) > 0).map(o => o.value)).catch(() => []);
  let chosen = null, roRows = 0;
  for (const v of opts) {
    await setPeriod(v); await sleep(2200);
    const n = await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('table.tbl')).find(x => !x.classList.contains('edit-tbl') && x.offsetParent !== null);
      return t ? t.querySelectorAll('tbody tr.data-row').length : 0;
    });
    if (n > 0) { chosen = String(v); roRows = n; break; }
  }
  ok('1 找到有报单行的期次', roRows > 0, `period=${chosen} rows=${roRows}`);

  // 进改单
  STEP = 'enterEdit';
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .filter(x => x.offsetParent !== null && x.getBoundingClientRect().width > 0)
      .find(x => /改单/.test(x.textContent) && !/取消|退出/.test(x.textContent));
    if (b) b.click();
  });
  await sleep(9000);
  const g0 = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.edit-tbl')].find(x => x.offsetParent !== null);
    if (!t) return null;
    const ths = [...t.querySelectorAll('thead th.qty-th')];
    const lastTh = ths[ths.length - 1];
    return {
      rows: t.querySelectorAll('tbody tr').length,
      qty: ths.map(x => x.textContent.trim()),
      lastQtyColIdx: ths.length - 1,
      lastQtyName: lastTh ? lastTh.textContent.trim() : '',
    };
  });
  ok('2 已进入改单态且有编辑网格', !!g0 && g0.rows > 0, g0 ? `rows=${g0.rows} 客户列=${g0.qty.length} 最后一列=「${g0.lastQtyName}」` : 'no-edit-table');
  if (!g0) { await browser.close(); report(); return; }

  // ── 建立选区：覆盖「最后一列」的 0..4 行（mousedown → mouseover → mouseup）──
  STEP = 'select';
  const selInfo = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.edit-tbl')].find(x => x.offsetParent !== null);
    const ths = [...t.querySelectorAll('thead th.qty-th')];
    const lastC = Number(ths[ths.length - 1].getAttribute('data-c') || (function () {
      const td = t.querySelector('tbody td.qty-cell'); return td ? td.getAttribute('data-c') : 0;
    })());
    // 取最后一列的 data-c：从 tbody 里找 class 含 qty-cell 且 data-c 与表头同序的最后一个
    const tds = [...t.querySelectorAll('tbody td.qty-cell')];
    const cs = [...new Set(tds.map(x => Number(x.getAttribute('data-c'))))].sort((a, b) => a - b);
    const lastColC = cs[cs.length - 1];
    const pick = (r, c) => tds.find(x => Number(x.getAttribute('data-r')) === r && Number(x.getAttribute('data-c')) === c);
    const a = pick(0, lastColC), b = pick(4, lastColC);
    if (!a || !b) return { ok: false, reason: 'cell-not-found', lastColC: lastColC, cs: cs };
    const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100 });
    const mo = new MouseEvent('mouseover', { bubbles: true, cancelable: true, button: 0 });
    a.dispatchEvent(md);
    b.dispatchEvent(mo);
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return { ok: true, lastColC: lastColC };
  });
  await sleep(900);
  const selStat = await page.evaluate(() => {
    const el = document.querySelector('.sel-stat');
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  ok('G0 已建立选区（覆盖最后一列）', !!selStat, `lastColC=${selInfo.lastColC} .sel-stat=${selStat ? JSON.stringify(selStat) : '(无 → 选区没建起来)'}`);

  const errBefore = errs.length;

  // ── G1 删除「最后一列」（有选区） ──
  STEP = 'G-delcol';
  const delRes = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.edit-tbl')].find(x => x.offsetParent !== null);
    const ths = [...t.querySelectorAll('thead th.qty-th')];
    const th = ths[ths.length - 1];
    if (!th) return 'no-th';
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 400, clientY: 300 });
    th.dispatchEvent(ev);
    return ev.defaultPrevented ? 'ok' : 'not-prevented';
  });
  await sleep(600);
  const delClicked = await page.evaluate(() => {
    const m = [...document.querySelectorAll('.ctx-menu')].filter(x => getComputedStyle(x).display !== 'none').pop();
    if (!m) return 'no-menu';
    const b = [...m.querySelectorAll('button')].find(x => /删除列/.test(x.textContent));
    if (!b) return 'no-del-btn:' + [...m.querySelectorAll('button')].map(x => x.textContent.trim()).join('|');
    b.click();
    return 'ok';
  });
  await sleep(1200);
  const afterDel = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.edit-tbl')].find(x => x.offsetParent !== null);
    const n = t ? t.querySelectorAll('thead th.qty-th').length : -1;
    const el = document.querySelector('.sel-stat');
    const g = document.querySelector('.edit-grid, .grid-wrap, table.edit-tbl');
    return { qty: n, selStat: el ? el.textContent.replace(/\s+/g, ' ').trim() : '', hasGrid: !!g };
  });
  ok('G1 右键最后一列表头 → 删除列 已执行', delClicked === 'ok', `res=${delClicked} 列 21→${afterDel.qty}`);
  ok('G2 ★删列后是否触发前端异常（selStats 越界）', errs.length === errBefore,
     errs.slice(errBefore).join(' || ') || '无新错误');

  // ── G3 点保存（有选区、已删最后一列）──
  STEP = 'G-save';
  const G = await clickSave(page);
  ok('G3 ★删最后一列后保存 → 抓真实回执', !!G && G.clicked !== false, '\n' + summarize(G));
  ok('G4 ★是否报「保存失败」', !!(G && G.banner), G ? `banner=${JSON.stringify(G.banner)}` : 'n/a');

  await page.screenshot({ path: '/tmp/v194b-sel-delcol.png', fullPage: false });

  // ── H 对照：无选区，删最后一列后保存 ──
  STEP = 'H-reload';
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(4000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .filter(x => x.offsetParent !== null && x.getBoundingClientRect().width > 0)
      .find(x => /改单/.test(x.textContent) && !/取消|退出/.test(x.textContent));
    if (b) b.click();
  });
  await sleep(9000);
  const hQty = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.edit-tbl')].find(x => x.offsetParent !== null);
    return t ? t.querySelectorAll('thead th.qty-th').length : -1;
  });
  STEP = 'H-delcol';
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.edit-tbl')].find(x => x.offsetParent !== null);
    const ths = [...t.querySelectorAll('thead th.qty-th')];
    const th = ths[ths.length - 1];
    if (th) th.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 400, clientY: 300 }));
  });
  await sleep(600);
  await page.evaluate(() => {
    const m = [...document.querySelectorAll('.ctx-menu')].filter(x => getComputedStyle(x).display !== 'none').pop();
    if (!m) return;
    const b = [...m.querySelectorAll('button')].find(x => /删除列/.test(x.textContent));
    if (b) b.click();
  });
  await sleep(1200);
  const hQty2 = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.edit-tbl')].find(x => x.offsetParent !== null);
    return t ? t.querySelectorAll('thead th.qty-th').length : -1;
  });
  STEP = 'H-save';
  const H = await clickSave(page);
  ok('H1 对照：无选区删最后一列', hQty2 === hQty - 1, `列 ${hQty}→${hQty2}`);
  ok('H2 对照：无选区时保存', !!(H && H.clicked !== false), '\n' + summarize(H));

  STEP = 'end';
  await browser.close();
  report();

  function report() {
    console.log('\n================ 结果 ================');
    out.forEach(x => console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.n}${x.d ? '\n' + x.d : ''}`));
    const pass = out.filter(x => x.pass).length;
    console.log(`\n合计 ${pass}/${out.length}`);
    console.log('\n---- 全部 console/page error ----');
    errs.slice(0, 12).forEach(e => console.log('  ' + e));
  }
})().catch(e => { console.log('FATAL', (e && e.stack) || e); process.exit(1); });
