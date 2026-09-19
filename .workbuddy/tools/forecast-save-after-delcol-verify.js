// 复现「改单 → 删除一列 → 保存失败」（2026-09-18 用户报障）
//
// 🔴 本轮目标 = 把「可能原因」收敛成「确定原因」：
//   设计上，保存是**三阶段**：
//     ① productsApi.bulkUpsert(prodRows)         → POST /api/products/bulk-upsert      （商品档案）
//     ② forecastApproveApi.saveMatrix(payload)   → POST /api/forecast-submissions/save-matrix（数量矩阵）
//     ③ collectCustVals()                       → POST /api/products/extra-values     （自定义列，**吞异常**）
//   ③ 只 toast 不 throw ⇒ 不可能产生「保存失败」。故失败只可能来自 ①②。
//
// 后端 ② 的第一道闸门（forecast_submissions.py:336）：
//     if not start or not end or not customers or not isinstance(rows, list):
//         raise HTTPException(400, "缺少 start/end/customers/rows")
//   ⇒ **`customers` 为空数组即 400**。而前端 `customers = cross.value.units.map(u => u.name)`
//      ⇒ 把客户列全删光 ⇒ customers=[] ⇒ 400 ⇒ 前端 catch 里 kind 分类器不认这句话
//         （只认 403/超时/不合法），于是被误归成「网络或服务器异常」⇒ 页面显示「保存失败」。
//
// 本探针逐案取证（每案都记录**真实发出的请求载荷 + HTTP 状态 + 响应体 + 耗时**）：
//   A 基线：不删列直接保存
//   B 删 1 个客户列后保存
//   C 把客户列**删光**后保存           ← 决定性用例
//   D 删 1 个主档列后保存
//   另：记录每次保存后 **用户真正看到的东西**（toast 文案 + .save-fail-banner 的 kind/msg）
//       —— 这是判定「用户报的就是这个」的直接证据。
//
// ⚠️ 与 v192 探针的关键差别：**不再桩掉 /api/products/bulk-upsert**。
//    上一版探针注释里写着「沙箱的 bulk-upsert 会超 20s 被前端 abort」—— 那条本身就是一个
//    独立的「保存失败」候选原因（前端 api() 默认 timeout=20000），必须让它真跑、并把耗时记下来。
//
// 用法: NODE_PATH=<managed>/node_modules node forecast-save-after-delcol-verify.js <TOKEN> <TENANT>
const puppeteer = require('puppeteer-core');
const TOKEN = process.argv[2];
const TENANT = process.argv[3] || '9997';
const EXEC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://hergent.cn';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
const ok = (n, p, d) => { out.push({ n, pass: !!p, d: d === undefined ? '' : String(d) }); };

// 每案记录：保存期间发出的两个写请求
let rec = [];        // { url, status, ms, reqBody, respBody }
let STEP = 0;        // 供错误归因（探针打点，便于判断哪个动作抛出）

async function runCase(page, label) {
  rec = [];
  await page.evaluate(() => {
    document.querySelectorAll('.toast').forEach(t => t.remove());
  });
  // 点保存
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .filter(x => x.offsetParent !== null && x.getBoundingClientRect().width > 0)
      .find(x => /^(保存|重试保存)$/.test(x.textContent.replace(/\s+/g, '')));
    if (!b) return false;
    b.click();
    return true;
  });
  if (!clicked) { ok(label + ' 点到保存按钮', false, 'no-save-button'); return null; }
  // 等：成功 → 按钮回「保存」且无 banner；失败 → banner 出现。最多 40s（要覆盖 20s 超时）
  let settled = false;
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    const st = await page.evaluate(() => {
      const banner = document.querySelector('.save-fail-banner');
      const b = [...document.querySelectorAll('button')]
        .filter(x => x.offsetParent !== null)
        .find(x => /保存/.test(x.textContent));
      return {
        banner: banner ? banner.textContent.replace(/\s+/g, ' ').trim() : '',
        btn: b ? b.textContent.replace(/\s+/g, '') : '',
        toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent.replace(/\s+/g, ' ').trim()),
      };
    });
    if (st.banner || (!/保存中/.test(st.btn) && st.btn)) {
      if (!/保存中/.test(st.btn)) { settled = true; await sleep(600); 
        const st2 = await page.evaluate(() => ({
          banner: (document.querySelector('.save-fail-banner') || {}).textContent || '',
          btn: ([...document.querySelectorAll('button')].filter(x => x.offsetParent !== null).find(x => /保存/.test(x.textContent)) || {}).textContent || '',
        }));
        return { clicked, banner: st2.banner.replace(/\s+/g, ' ').trim(), btn: st2.btn.replace(/\s+/g, ''), toasts: st.toasts, reqs: rec.slice() };
      }
    }
  }
  return { clicked, banner: '', btn: '', toasts: [], reqs: rec.slice(), timeout: true };
}

function summarize(res) {
  if (!res) return '(未执行)';
  const lines = [];
  lines.push(`    按钮=${res.btn || '?'}  banner=${res.banner ? JSON.stringify(res.banner) : '(无)'}`);
  if (res.timeout) lines.push('    ⚠️ 40s 内未收敛（可能前端 20s 超时后仍在重试路径）');
  const toasts = (res.toasts || []).filter(Boolean);
  if (toasts.length) lines.push(`    toast=${JSON.stringify(toasts[toasts.length - 1])}`);
  if (!res.reqs.length) lines.push('    ⚠️ 未捕获到任何写请求');
  res.reqs.forEach(q => {
    const p = q.reqBody || {};
    const extra = q.url.includes('save-matrix')
      ? `customers=${JSON.stringify(p.customers || [])} rows=${(p.rows || []).length}`
      : `rows=${(p.rows || []).length}`;
    lines.push(`    → ${q.url.replace(BASE, '')} [${q.status}] ${q.ms}ms ${extra}`);
    if (q.respBody && q.respBody.length < 300) lines.push(`        resp=${q.respBody}`);
  });
  return lines.join('\n');
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXEC, headless: 'new',
    args: ['--no-sandbox', '--window-size=1600,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errs = [];
  // 🔴 必须把 Error 对象**取成消息**：上一版只做 m.text() ⇒ 拿到的是 `JSHandle@error`，
  //    等于没抓到（Vue 的错误是 console.error 一条 Error 对象，不是字符串）。
  page.on('console', async m => {
    if (m.type() !== 'error') return;
    const parts = [];
    for (const a of m.args()) {
      try { parts.push(await a.evaluate(e => (e && e.stack) || (e && e.message) || String(e))); }
      catch (e) { parts.push('?'); }
    }
    errs.push(`[step ${STEP}] ` + parts.join(' ').slice(0, 300));
  });
  page.on('pageerror', e => errs.push(`[step ${STEP}] PAGEERROR ${e.message}`));

  // 拦截记录（**不桩任何请求**）
  page.on('request', r => {
    const u = r.url();
    if (r.method() !== 'GET' && (u.includes('/api/products/bulk-upsert') || u.includes('/api/forecast-submissions/save-matrix'))) {
      rec.push({ url: u, method: r.method(), t0: Date.now(), reqBody: (() => { try { return JSON.parse(r.postData() || '{}'); } catch (e) { return null; } })(), status: 0, respBody: '', ms: 0 });
    }
  });
  page.on('response', async r => {
    const u = r.url();
    const hit = rec.filter(x => x.url === u && !x.status).pop();
    if (!hit) return;
    hit.status = r.status();
    try { hit.respBody = (await r.text()).slice(0, 400); } catch (e) {}
    hit.ms = Date.now() - hit.t0;
  });

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t);
    localStorage.setItem('hergent_v2_tenant', String(ten));
  }, TOKEN, TENANT);
  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 });
  ok('0 未被打回登录页', !/#\/login/.test(page.url()), page.url());
  await page.waitForSelector('table.tbl', { timeout: 30000 }).catch(() => {});
  await sleep(3500);

  // 选一个「只读表真有行」的期次
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
    await setPeriod(v); await sleep(2400);
    const n = await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('table.tbl'))
        .find(x => !x.classList.contains('edit-tbl') && x.offsetParent !== null);
      return t ? t.querySelectorAll('tbody tr.data-row').length : 0;
    });
    if (n > 0) { chosen = String(v); roRows = n; break; }
  }
  ok('1 找到有报单行的期次', roRows > 0, 'period=' + chosen + ' rows=' + roRows);

  // 进改单
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .filter(x => x.offsetParent !== null && x.getBoundingClientRect().width > 0)
      .find(x => /改单/.test(x.textContent) && !/取消|退出/.test(x.textContent));
    if (b) b.click();
  });
  await sleep(8000);
  const g0 = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.edit-tbl')].find(x => x.offsetParent !== null);
    if (!t) return null;
    return {
      rows: t.querySelectorAll('tbody tr').length,
      qty: [...t.querySelectorAll('thead th.qty-th')].map(th => th.textContent.trim()),
      master: [...t.querySelectorAll('thead th')].map(th => th.textContent.trim()).filter(Boolean),
    };
  });
  ok('2 已进入改单态且有编辑网格', !!g0 && g0.rows > 0, g0 ? `rows=${g0.rows}` : 'no-edit-table');
  ok('3 改单网格有客户列（qty-th）', !!g0 && g0.qty.length > 0, g0 ? 'qty=' + JSON.stringify(g0.qty) : 'n/a');
  if (!g0) { await browser.close(); report(); return; }

  // ── 删列助手：右键第 n 个客户列表头 → 点「删除列」──
  async function delQtyCol(idx) {
    const opened = await page.evaluate(i => {
      const t = [...document.querySelectorAll('table.edit-tbl')].find(x => x.offsetParent !== null);
      const th = t ? t.querySelectorAll('thead th.qty-th')[i] : null;
      if (!th) return 'no-th';
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 400, clientY: 300 });
      th.dispatchEvent(ev);
      return ev.defaultPrevented ? 'ok' : 'not-prevented';
    }, idx);
    if (opened !== 'ok') return opened;
    await sleep(500);
    const clicked = await page.evaluate(() => {
      const m = [...document.querySelectorAll('.ctx-menu')].filter(x => getComputedStyle(x).display !== 'none').pop();
      if (!m) return 'no-menu';
      const b = [...m.querySelectorAll('button')].find(x => /删除列/.test(x.textContent));
      if (!b) return 'no-del-btn:' + [...m.querySelectorAll('button')].map(x => x.textContent.trim()).join('|');
      b.click();
      return 'ok';
    });
    await sleep(900);
    return clicked;
  }
  async function delMasterCol(label) {
    const opened = await page.evaluate(lb => {
      const t = [...document.querySelectorAll('table.edit-tbl')].find(x => x.offsetParent !== null);
      const th = t ? [...t.querySelectorAll('thead th')].find(x => x.textContent.trim() === lb) : null;
      if (!th) return 'no-th';
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 400, clientY: 300 });
      th.dispatchEvent(ev);
      return ev.defaultPrevented ? 'ok' : 'not-prevented';
    }, label);
    if (opened !== 'ok') return opened;
    await sleep(500);
    const clicked = await page.evaluate(() => {
      const m = [...document.querySelectorAll('.ctx-menu')].filter(x => getComputedStyle(x).display !== 'none').pop();
      if (!m) return 'no-menu';
      const b = [...m.querySelectorAll('button')].find(x => /删除列/.test(x.textContent));
      if (!b) return 'no-del-btn';
      b.click();
      return 'ok';
    });
    await sleep(900);
    return clicked;
  }
  const qtyCount = () => page.evaluate(() => {
    const t = [...document.querySelectorAll('table.edit-tbl')].find(x => x.offsetParent !== null);
    return t ? t.querySelectorAll('thead th.qty-th').length : -1;
  });

  // ═══ A. 基线：不删列直接保存 ═══
  const A = await runCase(page, 'A');
  ok('A 基线保存（未删列）', A && A.reqs.length > 0, '\n' + summarize(A));

  // ═══ B. 删 1 个客户列后保存 ═══
  const bDel = await delQtyCol(0);
  const bN = await qtyCount();
  ok('B1 右键客户列 → 删除列 已执行', bDel === 'ok', `res=${bDel} 剩余qty列=${bN}/${g0.qty.length}`);
  const B = await runCase(page, 'B');
  ok('B2 删 1 个客户列后保存', B && B.reqs.length > 0, '\n' + summarize(B));

  // ═══ C. 把客户列删光后保存（决定性）═══
  // 🔴 上一版 guard 写成 8 ⇒ 21 个客户列只删掉 8 个就停了，**决定性用例根本没跑到**
  //    （断言却仍打印「已删光」的相邻结论，极易被误读为「已证伪」）。上限必须 >= 实际列数。
  STEP = 'C-delcol';
  let guard = 0, leftNow = await qtyCount();
  while (leftNow > 0 && guard++ < 40) { await delQtyCol(0); leftNow = await qtyCount(); }
  ok('C1 客户列已删光', leftNow === 0, '剩余 qty 列=' + leftNow + ' 尝试次数=' + guard);
  STEP = 'C-save';
  const C = await runCase(page, 'C');
  ok('C2 ★客户列删光后保存（决定性用例）', C && C.reqs.length > 0, '\n' + summarize(C));
  ok('C3 ★删光客户列后确实报「保存失败」', !!(C && C.banner), C ? `banner=${JSON.stringify(C.banner)}` : 'n/a');

  // ═══ D. 删 1 个主档列后保存 ═══
  let dDel = null, dLabel = null;
  for (const lb of ['品牌', '规格', '单位', '厂家编码', '分销价']) {
    const r = await delMasterCol(lb);
    if (r === 'ok') { dDel = r; dLabel = lb; break; }
  }
  ok('D1 右键主档列 → 删除列 已执行', dDel === 'ok', 'label=' + dLabel + ' res=' + dDel);
  const D = await runCase(page, 'D');
  ok('D2 删主档列后保存', D && D.reqs.length > 0, '\n' + summarize(D));

  await page.screenshot({ path: '/tmp/v194-delcol-save.png', fullPage: false });
  ok('E 全程 console/page error', errs.length === 0, errs.slice(0, 3).join(' || ') || '0');

  await browser.close();
  report();

  function report() {
    console.log('\n================ 结果 ================');
    out.forEach(x => console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.n}${x.d ? '\n' + x.d : ''}`));
    const pass = out.filter(x => x.pass).length;
    console.log(`\n合计 ${pass}/${out.length}`);
  }
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
