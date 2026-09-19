// v196 复验：① 用 MutationObserver 抓 toast（**不删 DOM**，验证 insertBefore 异常是不是探针自己造成的）
//                ② 21 秒慢请求的完整证据（P0-3）
//
// 上一轮 6/7 里 P3 判 FAIL，但**请求实测 200 / 21079ms** —— 这本身已证明 60 秒超时生效
// （若仍是默认 20 秒，AbortController 会在 20 秒 abort ⇒ fetch 被取消 ⇒ 不可能拿到 200）。
// 唯一缺的是 toast 原文。而那 4 条 `insertBefore` 异常高度可疑地来自上一轮探针的
// `document.querySelectorAll('.toast').forEach(t => t.remove())` —— 手删 Vue 管理的节点
// 会让 vnode 与真实 DOM 脱同步，下一次 patch 找不到 anchor 的 parentNode。
// 本轮**完全不碰 DOM**，只用观察器读取，以此做单变量对照。
//
// 用法: NODE_PATH=<managed>/node_modules node v196-rerun.js <TOKEN> <TENANT>

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
const WRITE_URLS = ['/api/products/bulk-upsert', '/api/forecast-submissions/save-matrix', '/api/products/extra-values'];

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
    errs.push(`[${STEP}] ` + parts.join(' ').slice(0, 220));
  });
  page.on('pageerror', e => errs.push(`[${STEP}] PAGEERROR ${e.message}`.slice(0, 220)));
  page.on('request', r => {
    const u = r.url();
    if (r.method() !== 'GET' && WRITE_URLS.some(x => u.includes(x))) {
      rec.push({
        url: u, method: r.method(), t0: Date.now(),
        reqBody: (() => { try { return JSON.parse(r.postData() || '{}'); } catch (e) { return null; } })(),
        status: 0, respBody: '', ms: 0,
      });
    }
  });
  page.on('response', async r => {
    const hit = rec.filter(x => x.url === r.url() && !x.status).pop();
    if (!hit) return;
    hit.status = r.status();
    try { hit.respBody = (await r.text()).slice(0, 300); } catch (e) {}
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
    return t ? { rows: t.querySelectorAll('tbody tr').length } : null;
  });
  ok('2 已进入改单态', !!g0 && g0.rows > 0, g0 ? `rows=${g0.rows}` : 'no-edit-table');
  if (!g0) { await browser.close(); report(); return; }

  // ★ 装观察器：只读不删。此后所有 toast 都会被记下来（哪怕只闪 1 秒）
  await page.evaluate(() => {
    window.__toastLog = [];
    const grab = () => {
      document.querySelectorAll('.toast').forEach(t => {
        const s = t.textContent.replace(/\s+/g, ' ').trim();
        if (s && !window.__toastLog.includes(s)) window.__toastLog.push(s);
      });
    };
    grab();
    new MutationObserver(grab).observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  // ── R1 正常保存（不延迟）：验证「不删 DOM 时零前端异常」+ 抓到 toast 原文 ──
  STEP = 'R1-normal';
  const chg1 = await page.evaluate(() => {
    const inp = document.querySelector('table.edit-tbl tbody input.cell-name');
    if (!inp) return null;
    const old = inp.value;
    const nv = old + '（v196复验）';
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, nv);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return { old, nv };
  });
  await sleep(900);
  rec = [];
  const errsBeforeR1 = errs.length;
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .filter(x => x.offsetParent !== null && x.getBoundingClientRect().width > 0)
      .find(x => /^(保存|重试保存)$/.test(x.textContent.replace(/\s+/g, '')));
    if (b) b.click();
  });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const done = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')]
        .filter(x => x.offsetParent !== null)
        .find(x => /^(保存|重试保存|保存中…)$/.test(x.textContent.replace(/\s+/g, '')));
      return b && !/保存中/.test(b.textContent);
    });
    if (done) break;
  }
  await sleep(1200);
  const tl1 = await page.evaluate(() => window.__toastLog.slice());
  const b1 = rec.filter(q => q.url.includes('bulk-upsert'));
  ok('R1 正常保存成功且抓到 toast 原文', (tl1 || []).some(t => /已保存/.test(t)),
    `改行="${chg1 ? chg1.nv : '?'}"\n    toastLog=${JSON.stringify(tl1)}\n` +
    b1.map(q => `    → bulk-upsert [${q.status}] ${q.ms}ms rows=${((q.reqBody || {}).rows || []).length}`).join('\n'));

  ok('R2 保存全程零前端异常（对照：上一轮探针手删 .toast 节点）', errs.length === errsBeforeR1,
    errs.length === errsBeforeR1 ? `本段 0 条（累计 ${errs.length} 条，均来自装载阶段）`
      : `本段新增 ${errs.length - errsBeforeR1} 条:\n` + errs.slice(errsBeforeR1).map(e => '      ' + e).join('\n'));

  // ── R3 P0-3：拦截 bulk-upsert 延迟 21 秒 ⇒ 期望 200 且 toast 仍「已保存」──
  STEP = 'R3-slow21s';
  const DELAY = 21000;
  await page.setRequestInterception(true);
  page.on('request', async r => {
    try {
      if (r.url().includes('/api/products/bulk-upsert')) await sleep(DELAY);
      await r.continue();
    } catch (e) { /* 前端已 abort 时会抛，忽略 */ }
  });
  const chg3 = await page.evaluate(() => {
    const inp = document.querySelector('table.edit-tbl tbody input.cell-name');
    if (!inp) return null;
    const nv = inp.value + '·超时';
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(inp, nv);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return nv;
  });
  await sleep(900);
  await page.evaluate(() => { window.__toastLog = []; });
  rec = [];
  const errsBeforeR3 = errs.length;
  const wallT0 = Date.now();
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .filter(x => x.offsetParent !== null && x.getBoundingClientRect().width > 0)
      .find(x => /^(保存|重试保存)$/.test(x.textContent.replace(/\s+/g, '')));
    if (b) b.click();
  });
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    const done = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')]
        .filter(x => x.offsetParent !== null)
        .find(x => /^(保存|重试保存|保存中…)$/.test(x.textContent.replace(/\s+/g, '')));
      return b && !/保存中/.test(b.textContent);
    });
    if (done) break;
  }
  await sleep(1200);
  const wall = Date.now() - wallT0;
  const tl3 = await page.evaluate(() => window.__toastLog.slice());
  const b3 = rec.filter(q => q.url.includes('bulk-upsert'));
  const ms3 = b3.length ? b3[0].ms : -1;
  const st3 = b3.length ? b3[0].status : 0;
  const banner3 = await page.evaluate(() => (document.querySelector('.save-fail-banner') || {}).textContent || '');
  ok('R3 60 秒超时生效：21 秒慢请求 200 且提示「已保存」（20 秒下必超时）',
    ms3 >= 20000 && st3 === 200 && (tl3 || []).some(t => /已保存/.test(t)),
    `延迟=${DELAY}ms 实测=${ms3}ms status=${st3} 墙钟=${wall}ms\n    toastLog=${JSON.stringify(tl3)}\n    banner=${JSON.stringify(String(banner3).replace(/\s+/g, ' ').trim() || '(无)')}`);

  ok('R4 慢请求段同样零前端异常', errs.length === errsBeforeR3,
    errs.length === errsBeforeR3 ? '0 条' : `新增 ${errs.length - errsBeforeR3} 条:\n` + errs.slice(errsBeforeR3).map(e => '      ' + e).join('\n'));

  await browser.close();
  report();

  function report() {
    console.log('\n==================== v196 复验 ====================');
    let pass = 0;
    out.forEach(r => {
      if (r.pass) pass++;
      console.log(`\n${r.pass ? '✅' : '❌'} ${r.n}`);
      if (r.d) console.log('   ' + r.d);
    });
    console.log(`\n---- ${pass}/${out.length} PASS ----`);
    console.log(`\n全部前端异常（共 ${errs.length}）:`);
    errs.slice(0, 10).forEach(e => console.log('   ' + e));
    if (!errs.length) console.log('   （无）');
  }
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
