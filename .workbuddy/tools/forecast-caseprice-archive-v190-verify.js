// v190 沙箱端到端：改单网格「单价(厂价/箱)」手工录入 → 保存 → **写回商品档案的厂价**（含留痕）
//   🔴 必须在**隔离沙箱租户**（id ≥ 9997）上跑 —— 保存会真的改商品档案，生产真租户绝不能碰。
//      起沙箱：scp .workbuddy/tools/sandbox_tenant.py root@<prod>:/tmp/ 后
//        ssh root@<prod> 'cd /opt/hergent-erp && set -a && . ./.env && set +a && \
//          runuser -u hergent --preserve-environment -- python3 /tmp/sandbox_tenant.py up --id 9997 --src 10'
//      销毁：同命令把 up 换 down（**验完必须销毁**，否则沙箱账号是幽灵残留）。
//   判据设计（不重实现 perCase）：`录入箱价 ÷ 新厂价 == 规格` 直接反推规格，与接口给的 spec 比对。
//   用法: NODE_PATH=<managed workspace>/node_modules node forecast-caseprice-archive-v190-verify.js <TOKEN> [TENANT=9997]
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
  // ---- 保存前快照 ----
  const before = await apiGet('/api/products/grid');
  const fpBefore = {};
  (before.items || []).forEach(p => { fpBefore[p.id] = { name: p.name, fp: Number(p.factory_price) || 0, spec: p.spec, pp: Number(p.purchase_price) || 0 }; });
  ok('K0 沙箱商品档案可读', Object.keys(fpBefore).length > 0, '商品数=' + Object.keys(fpBefore).length);

  const browser = await puppeteer.launch({
    executablePath: EXEC, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--window-size=1800,1150'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1800, height: 1150 });
  const consoleErrors = [], pageErrors = [], badResp = [];
  // 保存是「多步串联」（商品 upsert → 厂价写回 → 矩阵保存 → 自定义列 → 重载），
  //   任一步 abort 都会让整轮停在「重试保存」。记时序才能定位是哪一步。
  const reqLog = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('response', r => { if (r.status() >= 400 && r.url().includes('/api/')) badResp.push(r.status() + ' ' + r.url().replace(BASE, '')); });
  /* 🔴 沙箱环境的 `POST /api/products/bulk-upsert` 会超过 20s 被 abort（前端 api() 默认
     timeout=20000）—— 这是**沙箱库**的特性（该接口本轮没碰；生产上保存是日常操作、一直正常）。
     若不处理，保存会在第一步断掉，永远走不到「厂价写回」，本轮核心链路就没法验。
     故：只拦下 bulk-upsert 回成功壳放行；**其它请求一律真发** —— 尤其 batch-factory-price
     必须真发出去，这样才能同时验「前端发了什么参数」+「沙箱档案是否真的变了」。
     另：setRequestInterception(true) 后所有请求都必须显式 continue/respond，否则会挂住。 */
  let capturedFp = null, capturedBulk = null;
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (u.includes('/api/')) reqLog.push({ ph: '→', m: r.method(), u: u.replace(BASE, '').slice(0, 90) });
    if (u.includes('/api/products/batch-factory-price')) {
      try { capturedFp = JSON.parse(r.postData() || '{}'); } catch (e) { capturedFp = { parseErr: String(e) }; }
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
  page.on('requestfinished', r => {
    if (!r.url().includes('/api/')) return;
    const rs = r.response();
    reqLog.push({ ph: '✓', s: rs ? rs.status() : '?', u: r.url().replace(BASE, '').slice(0, 90) });
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

  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 });
  ok('K0b 未被守卫踢回登录页（沙箱令牌有效）', !/#\/login/.test(page.url()), page.url());
  await page.waitForSelector('table.tbl', { timeout: 30000 }).catch(() => {});
  await sleep(4000);

  const clicked = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find(x => /改单/.test(x.textContent) && !/取消/.test(x.textContent) && x.offsetParent !== null);
    if (!b) return false; b.click(); return true;
  });
  await sleep(3500);
  const editRows = await page.evaluate(() => document.querySelectorAll('table.tbl.edit-tbl tbody tr').length);
  ok('K1 已进入改单态且有行', clicked && editRows > 0, 'clicked=' + clicked + ' editRows=' + editRows);

  // ---- 录入一个箱价（≠ 自动价，便于识别）----
  const pick = await page.evaluate(async () => {
    const t = document.querySelector('table.tbl.edit-tbl');
    if (!t) return { err: '找不到编辑网格' };
    for (const x of Array.from(t.querySelectorAll('tbody tr'))) {
      const pi = x.querySelector('td.calc.price input');
      const ni = x.querySelector('input.cell-name');
      if (!pi || !ni) continue;
      const ph = Number(String(pi.placeholder || '').replace(/[^\d.]/g, ''));
      if (ph > 0) {
        const nv = Math.round(ph * 1.7 * 100) / 100;
        pi.value = String(nv);
        pi.dispatchEvent(new Event('input', { bubbles: true }));
        pi.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 700));
        return { name: ni.value, auto: ph, nv, val: pi.value, manualCls: pi.classList.contains('manual-price') };
      }
    }
    return { err: '没有「有自动价」的行' };
  });
  ok('K2 已录入一个箱价（且框内回显一致）', !pick.err && String(pick.val) === String(pick.nv), JSON.stringify(pick));

  // ---- 点保存并等完成 ----
  if (!pick.err) {
    const c2 = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button.btn-primary'))
        .find(x => /^(保存|重试保存)$/.test((x.textContent || '').trim()) && x.offsetParent !== null);
      if (!b) return false; b.click(); return true;
    });
    ok('K3 已点「保存」', c2, 'clicked=' + c2);
    let last = '', ok2 = false, failMsg = '';
    for (let i = 0; i < 45; i++) {
      await sleep(1000);
      const st = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button.btn-primary')).find(x => /保存/.test(x.textContent || '') && x.offsetParent !== null);
        // 失败时把面板上的原因一起抓回来 —— 只看按钮状态无法定位是哪一步炸的
        const m = document.querySelector('.sf-msg');
        const p = document.querySelector('.sf-partial');
        return { btn: b ? (b.textContent || '').trim() : 'none', msg: m ? (m.textContent || '') : '', part: p ? (p.textContent || '') : '' };
      });
      last = st.btn;
      if (st.msg || st.part) failMsg = JSON.stringify(st);
      if (last === '保存') { ok2 = true; break; }
      if (last === '重试保存') break;
    }
    ok('K4 保存完成（未停在「保存中…」）且无重试态', ok2, '末态按钮=' + last + (failMsg ? ' | 失败原因=' + failMsg : ''));
  }
  await page.screenshot({ path: '/tmp/fc_caseprice_archive_v190.png' });
  await browser.close();

  // ---- 保存后：找厂价变化的商品 ----
  const after = await apiGet('/api/products/grid');
  const changed = [];
  (after.items || []).forEach(p => {
    const b = fpBefore[p.id];
    if (!b) return;
    if (Math.abs((Number(p.factory_price) || 0) - b.fp) > 1e-9) {
      changed.push({ id: p.id, name: p.name, before: b.fp, after: Number(p.factory_price) || 0, spec: p.spec });
    }
  });
  ok('K5 恰好 1 个商品的厂价被写回（不多不少）', changed.length === 1, JSON.stringify(changed).slice(0, 400));

  // ---- 拦截取证：前端到底往「写回厂价」接口发了什么 ----
  ok('K5b 前端确实调用了写回接口（POST /api/products/batch-factory-price）', !!capturedFp,
    JSON.stringify(capturedFp).slice(0, 300));
  if (capturedFp && Array.isArray(capturedFp.items)) {
    ok('K5c 该请求**只带手工录价的行**（未录价的行绝不带，否则会冲掉档案原值）',
      capturedFp.items.length === 1, '条数=' + capturedFp.items.length + ' body=' + JSON.stringify(capturedFp.items).slice(0, 240));
    const it = capturedFp.items[0] || {};
    ok('K5d 载荷形如 {id, factory_price} 且厂价为正数', (it.id > 0 || it.barcode) && Number(it.factory_price) > 0,
      JSON.stringify(it));
  }
  ok('K5e 商品主档 upsert 也走了（保存第 1 步，行数 = 网格可保存行）',
    !!(capturedBulk && Array.isArray(capturedBulk.rows)) && capturedBulk.rows.length > 0,
    capturedBulk ? 'rows=' + capturedBulk.rows.length : 'null');

  const hit = changed[0];
  if (hit && !pick.err) {
    ok('K6 被改的正是我录价的那个商品', hit.name === pick.name, '改的=' + hit.name + ' | 录的=' + pick.name);
    const m = String(hit.spec || '').match(/(\d+(?:\.\d+)?)(?!.*\d)/);
    const pc = m ? parseFloat(m[1]) : 0;
    ok('K7 新厂价 = 录入箱价 ÷ 规格（元/件，口径自洽）',
      pc > 0 && Math.abs(pick.nv / hit.after - pc) < 0.02,
      `录入箱价=${pick.nv} → 新厂价=${hit.after}；规格=${hit.spec}(perCase=${pc})，用「录入÷新厂价」反推规格=${(pick.nv / hit.after).toFixed(4)}`);
  }
  if (hit) {
    const ch = await apiGet('/api/products/' + hit.id + '/changes');
    ok('K8 档案改动留下字段级痕迹（factory_price 改前→改后）', /factory_price/.test(JSON.stringify(ch)),
      JSON.stringify(ch).slice(0, 600));
  }

  const realErr = consoleErrors.filter(e => !/403/.test(e));
  ok('K9 无 console error / pageerror', realErr.length === 0 && pageErrors.length === 0,
    JSON.stringify({ realErr: realErr.slice(0, 3), pageErrors: pageErrors.slice(0, 2) }));

  const pass = results.filter(r => r.pass).length;
  console.log(JSON.stringify({
    pick, changed, capturedFp, bulkRows: capturedBulk ? (capturedBulk.rows || []).length : null,
    assertions: results,
    summary: pass + '/' + results.length + ' 通过' + (pass === results.length ? ' ✅' : ' ❌'),
    reqLog: reqLog.slice(-45),
    consoleErrors: realErr.slice(0, 4), pageErrors: pageErrors.slice(0, 2), badResp: [...new Set(badResp)].slice(0, 5),
  }, null, 2));
  process.exit(pass === results.length ? 0 : 2);
})().catch(e => { console.error('PROBE_ERROR', e); process.exit(1); });
