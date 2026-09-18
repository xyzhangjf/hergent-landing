// v191 沙箱端到端：「单价(厂价/箱)」手工录入 → 保存 → **只在本期生效**（2026-09-18 用户拍板）
//   🔴 必须在**隔离沙箱租户**（id ≥ 9997）上跑 —— 保存会真的写本期报单数据。
//      起沙箱：scp .workbuddy/tools/sandbox_tenant.py root@<prod>:/tmp/ 后
//        ssh root@<prod> 'cd /opt/hergent-erp && set -a && . ./.env && set +a && \
//          runuser -u hergent --preserve-environment -- python3 /tmp/sandbox_tenant.py up --id 9997 --src 10'
//      销毁：同命令把 up 换 down（**验完必须销毁**，否则沙箱账号是幽灵残留）。
//
// 🔴 判据只用**页面真实发出的请求/响应**，探针**不自己另发 summary 查询**。
//    实测教训（2026-09-18）：自建 `fetch('/api/forecast/summary?start=..&end=..&period_id=..')`
//    （Authorization + X-Tenant-Id 都带齐、试了四种参数组合）**恒返回 0 行**，
//    而页面同期次明明渲染出 26 行；同一时刻 `/api/products/grid` 同样 header 却完全正常。
//    ⇒ 探针自建查询会给出**与事实相反**的结论。用页面那份才是事实（也顺带抓下它的 URL，
//    参数格式一目了然）。
//
// 判据（逐条对应「只在本期生效」的四种含义）：
//   A1 保存过程中 **没有** 调用 /api/products/batch-factory-price ← 写档案通道已摘除
//   A2 save-matrix 载荷里该行 case_price == 录入值              ← 前端真的把本期价传出去了
//   B1 页面拿到的本期 summary 里该行 case_price == 录入值        ← **落本期**
//   B2 商品档案 factory_price **一字未变**（全表逐项比）          ← **不改档案**
//   C1 重载进改单网格 → 单价框回填手工价（不是自动价占位）        ← **回读**：保存后刷新不丢
//   B4 清空单价再保存 → 页面拿到的 summary 该行 case_price 回 null ← 可撤销
//   （期次隔离由库层直接查证：SELECT ... FROM forecast_extra_qty WHERE case_price IS NOT NULL
//     应只有本期窗口那一行 —— 见交付说明里的库层取证，不塞进本脚本。）
//
//   用法: NODE_PATH=<managed workspace>/node_modules node forecast-caseprice-periodonly-v191-verify.js <TOKEN> [TENANT=9997]
const puppeteer = require('puppeteer-core');
const TOKEN = process.argv[2];
const TENANT = process.argv[3] || '9997';
const EXEC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://hergent.cn';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });

const apiGet = async (path) => {
  const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + TOKEN, 'X-Tenant-Id': String(TENANT) } });
  return r.json();
};

(async () => {
  // ---- 保存前快照：商品档案厂价全表（/api/products/grid 用同一套 header 是**正常**的，
  //      B2 用它做「一字未变」逐项比对；这也反证了「取不到 summary」不是授权问题）----
  const before = await apiGet('/api/products/grid');
  const fpBefore = {};
  (before.items || []).forEach(p => { fpBefore[p.id] = { name: p.name, fp: Number(p.factory_price) || 0, spec: p.spec }; });
  ok('K0 沙箱商品档案可读', Object.keys(fpBefore).length > 0, '商品数=' + Object.keys(fpBefore).length);

  const browser = await puppeteer.launch({
    executablePath: EXEC, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--window-size=1800,1150'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1800, height: 1150 });
  const consoleErrors = [], pageErrors = [], badResp = [];
  const reqLog = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e)));

  // 页面真实发出的 summary：既抓 URL（看清参数格式），也存响应体（B1/B4 的判据来源）
  let sumRows = null, sumUrl = '';
  page.on('response', async r => {
    if (r.status() >= 400 && r.url().includes('/api/')) badResp.push(r.status() + ' ' + r.url());
    /* 🔴 真实路径 = `/api/forecast-submissions/summary`（见 api/modules.js::forecastApproveApi.summary）。
       写成 `/api/forecast/summary` **永远匹配不到** ⇒ 断言退化成「未捕获」，而页面明明有数据
       （本轮实跑踩到，白跑两轮 —— 这是「探针偏航」的又一形态：**先核对真实请求路径**）。
       save-matrix 同理 = `/api/forecast-submissions/save-matrix`。 */
    if (!r.url().includes('/api/forecast-submissions/summary')) return;
    try {
      const j = await r.json();
      sumRows = j.rows || [];
      sumUrl = r.url().replace(BASE, '');
    } catch (e) { /* 响应体不可读时忽略，不影响其它断言 */ }
  });
  /* 🔴 沙箱环境的 `POST /api/products/bulk-upsert` 会超过 20s 被 abort（前端 api() 默认
     timeout=20000）—— 这是**沙箱库**的特性（该接口本轮没碰；生产上保存是日常操作、一直正常）。
     若不处理，保存会在第一步断掉，永远走不到本轮要验的 save-matrix。
     故：只拦下 bulk-upsert 回成功壳放行；**其它请求一律真发** —— 尤其
     ① `/api/forecast/save-matrix` 必须真发（本轮核心通道），
     ② 只**观察**是否出现 `/api/products/batch-factory-price`（A1 判据：不该出现）。
     另：setRequestInterception(true) 后所有请求都必须显式 continue/respond，否则会挂住。 */
  let capturedFp = null, capturedBulk = null, capturedMatrix = null;
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (u.includes('/api/')) reqLog.push({ ph: '→', m: r.method(), u: u.replace(BASE, '').slice(0, 90) });
    if (u.includes('/api/products/batch-factory-price')) {
      try { capturedFp = JSON.parse(r.postData() || '{}'); } catch (e) { capturedFp = { parseErr: String(e) }; }
      return r.continue().catch(() => {});
    }
    if (u.includes('/api/forecast-submissions/save-matrix')) {
      try { capturedMatrix = JSON.parse(r.postData() || '{}'); } catch (e) { capturedMatrix = { parseErr: String(e) }; }
      return r.continue().catch(() => {});
    }
    if (u.includes('/api/products/bulk-upsert')) {
      try { capturedBulk = JSON.parse(r.postData() || '{}'); } catch (e) { capturedBulk = null; }
      const n = capturedBulk && Array.isArray(capturedBulk.rows) ? capturedBulk.rows.length : 0;
      return r.respond({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, inserted: 0, updated: n, skipped: 0 }) }).catch(() => {});
    }
    return r.continue().catch(() => {});
  });
  page.on('requestfailed', r => {
    if (!r.url().includes('/api/')) return;
    reqLog.push({ ph: '✗', e: ((r.failure() || {}).errorText || '').slice(0, 60), u: r.url().replace(BASE, '').slice(0, 90) });
  });
  page.on('dialog', async d => { try { await d.accept(); } catch (e) {} });

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t);
    localStorage.setItem('hergent_v2_tenant', String(ten));
  }, TOKEN, TENANT);

  const enterEdit = async () => {
    const clicked = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find(x => /改单/.test(x.textContent) && !/取消/.test(x.textContent) && x.offsetParent !== null);
      if (!b) return false; b.click(); return true;
    });
    await sleep(3500);
    const n = await page.evaluate(() => document.querySelectorAll('table.tbl.edit-tbl tbody tr').length);
    return { clicked, rows: n };
  };
  const clickSave = async () => {
    const c = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button.btn-primary'))
        .find(x => /^(保存|重试保存)$/.test((x.textContent || '').trim()) && x.offsetParent !== null);
      if (!b) return false; b.click(); return true;
    });
    let last = '', failMsg = '';
    for (let i = 0; i < 45; i++) {
      await sleep(1000);
      const st = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button.btn-primary')).find(x => /保存/.test(x.textContent || '') && x.offsetParent !== null);
        const m = document.querySelector('.sf-msg');
        const p = document.querySelector('.sf-partial');
        return { btn: b ? (b.textContent || '').trim() : 'none', msg: m ? (m.textContent || '') : '', part: p ? (p.textContent || '') : '' };
      });
      last = st.btn;
      if (st.msg || st.part) failMsg = JSON.stringify(st);
      if (last === '保存') return { clicked: c, done: true, last, failMsg };
      if (last === '重试保存') return { clicked: c, done: false, last, failMsg };
    }
    return { clicked: c, done: false, last, failMsg };
  };
  // val=null ⇒ 清空
  const setPrice = async (val) => page.evaluate(async (v) => {
    const t = document.querySelector('table.tbl.edit-tbl');
    if (!t) return { err: '找不到编辑网格' };
    for (const x of Array.from(t.querySelectorAll('tbody tr'))) {
      const pi = x.querySelector('td.calc.price input');
      const ni = x.querySelector('input.cell-name');
      if (!pi || !ni) continue;
      const ph = Number(String(pi.placeholder || '').replace(/[^\d.]/g, ''));
      if (ph > 0) {
        const nv = v === null ? '' : Math.round(ph * v * 100) / 100;
        pi.value = String(nv);
        pi.dispatchEvent(new Event('input', { bubbles: true }));
        pi.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 700));
        return { name: ni.value, auto: ph, nv, val: pi.value, manualCls: pi.classList.contains('manual-price') };
      }
    }
    return { err: '没有「有自动价」的行' };
  }, val);

  // ============ 阶段 1：录价 + 保存 ============
  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 });
  ok('K0b 未被守卫踢回登录页（沙箱令牌有效）', !/#\/login/.test(page.url()), page.url());
  await page.waitForSelector('table.tbl', { timeout: 30000 }).catch(() => {});
  await sleep(4000);

  const e1 = await enterEdit();
  ok('K1 已进入改单态且有行', e1.clicked && e1.rows > 0, JSON.stringify(e1));

  const pick = await setPrice(1.7);
  ok('K2 已录入一个箱价（框内回显一致 + 带手工价标记）',
    !pick.err && String(pick.val) === String(pick.nv) && pick.manualCls, JSON.stringify(pick));

  // A1 的静态前提：无论保存成功与否，都不该出现写档案请求
  let save1 = { done: false };
  if (!pick.err) {
    capturedMatrix = null; capturedFp = null;
    save1 = await clickSave();
    ok('K3 保存完成（未停在「保存中…」/「重试保存」）', save1.done, JSON.stringify(save1));
  }
  await page.screenshot({ path: '/tmp/fc_caseprice_period_v191.png' });

  ok('A1 保存过程中**没有**调用 /api/products/batch-factory-price（写商品档案的通道已摘除）',
    capturedFp === null, 'captured=' + JSON.stringify(capturedFp).slice(0, 200));

  const mRows = (capturedMatrix && Array.isArray(capturedMatrix.rows)) ? capturedMatrix.rows : [];
  const sent = mRows.find(r => String(r.product_name || '').trim() === String(pick.name || '').trim()) || null;
  ok('A2 save-matrix 载荷里该行带了 case_price = 录入值（前端真的传出去了）',
    !!sent && Math.abs(Number(sent.case_price) - Number(pick.nv)) < 1e-6,
    'matrixRows=' + mRows.length + ' sent=' + JSON.stringify(sent && { product_name: sent.product_name, case_price: sent.case_price })
    + ' 样例=' + JSON.stringify(mRows.slice(0, 2).map(x => ({ n: x.product_name, cp: x.case_price }))));

  // ============ 阶段 2：B1 落本期（用页面真实响应的 rows）+ B2 不改档案 ============
  await sleep(1200);   // 等保存后那次 loadEditGrid 的 summary 落地
  const rowB1 = (sumRows || []).find(r => String(r.product_name || '').trim() === String(pick.name || '').trim());
  ok('B1 页面拿到的本期 summary 里该行 case_price = 录入值（**落本期**）',
    !!rowB1 && Math.abs(Number(rowB1.case_price) - Number(pick.nv)) < 1e-6,
    'rows=' + ((sumRows || []).length) + ' summary.case_price=' + (rowB1 ? rowB1.case_price : 'null')
    + ' 录入=' + pick.nv + ' url=' + sumUrl);

  const after = await apiGet('/api/products/grid');
  const changed = [];
  (after.items || []).forEach(p => {
    const b = fpBefore[p.id];
    if (!b) return;
    if (Math.abs((Number(p.factory_price) || 0) - b.fp) > 1e-9) changed.push({ id: p.id, name: p.name, before: b.fp, after: Number(p.factory_price) || 0 });
  });
  ok('B2 商品档案 factory_price **一字未变**（**不改档案**：改了会影响所有期次的金额）',
    changed.length === 0, '变化数=' + changed.length + ' ' + JSON.stringify(changed).slice(0, 300));

  // ============ 阶段 3：重载回读（保存后刷新不丢）============
  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(4000);
  const e2 = await enterEdit();
  const back = await page.evaluate(() => {
    const t = document.querySelector('table.tbl.edit-tbl');
    if (!t) return { err: '找不到编辑网格' };
    const out = [];
    t.querySelectorAll('tbody tr').forEach(x => {
      const pi = x.querySelector('td.calc.price input');
      const ni = x.querySelector('input.cell-name');
      if (pi && ni) out.push({ name: ni.value, val: pi.value, ph: String(pi.placeholder || '').trim() });
    });
    return { rows: out };
  });
  const backRow = (back.rows || []).find(r => String(r.name || '').trim() === String(pick.name || '').trim());
  ok('C1 重载进改单网格 → 单价框**回填手工价**（不是自动价占位）—— 保存后刷新不丢',
    e2.clicked && !!backRow && Math.abs(Number(backRow.val) - Number(pick.nv)) < 1e-6,
    '回填=' + JSON.stringify(backRow) + ' 期望=' + pick.nv);

  // ============ 阶段 4：清空 + 保存 → 回 NULL（可撤销）============
  sumRows = null;
  const clr = await setPrice(null);
  let save2 = { done: false };
  if (!clr.err) {
    capturedMatrix = null;
    save2 = await clickSave();
  }
  await sleep(1500);
  const rowB4 = (sumRows || []).find(r => String(r.product_name || '').trim() === String(pick.name || '').trim());
  ok('B4 清空单价再保存 → 页面拿到的 summary 该行 case_price 回 null（撤销后回到「按档案厂价自动算」）',
    save2.done && !!rowB4 && rowB4.case_price == null,
    '保存=' + JSON.stringify(save2) + ' case_price=' + (rowB4 ? String(rowB4.case_price) : 'null(无行)'));

  await browser.close();

  const realErr = consoleErrors.filter(e => !/403/.test(e));
  ok('K9 无 console error / pageerror', realErr.length === 0 && pageErrors.length === 0,
    JSON.stringify({ realErr: realErr.slice(0, 3), pageErrors: pageErrors.slice(0, 2) }));

  const pass = results.filter(r => r.pass).length;
  console.log(JSON.stringify({
    summaryUrl: sumUrl,
    pick, sentCasePrice: sent ? sent.case_price : null, capturedFp,
    matrixRowSample: mRows.slice(0, 3).map(x => ({ n: x.product_name, cp: x.case_price, eq: x.extra_qty })),
    reloaded: backRow || null, bulkRows: capturedBulk ? (capturedBulk.rows || []).length : null,
    assertions: results,
    summary: pass + '/' + results.length + ' 通过' + (pass === results.length ? ' ✅' : ' ❌'),
    reqLog: reqLog.slice(-40),
    consoleErrors: realErr.slice(0, 4), pageErrors: pageErrors.slice(0, 2), badResp: [...new Set(badResp)].slice(0, 5),
  }, null, 2));
  process.exit(pass === results.length ? 0 : 2);
})().catch(e => { console.error('PROBE_ERROR', e); process.exit(1); });
