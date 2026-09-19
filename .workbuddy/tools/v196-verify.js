// v196 真机验收探针：条码判据放宽 + P0-2 只发改动行 + P0-3 超时真正放宽到 60 秒
//
// 用户 2026-09-19 三条指令对应的待验行为：
//   ①「多规格本就允许共用条码」⇒ 沙箱里那 2 处（芭乐菠萝/青提牛油果 的 10瓶×6组 vs 24瓶）
//      必须从「存在 2 处需要修正」变成「当前没有需要修正的录入」。
//   ②「接着做」= 乙档 ⇒ P0-2：不动任何东西时**不该**再发全量 156 行的 bulk-upsert；
//      只改 1 行时该请求体里应当**只有 1 行**。
//   ③ P0-3：bulk-upsert 单独 60 秒超时 —— 用**延迟 21 秒**的请求来区分：
//      若仍是默认 20 秒，会在 21 秒前被 AbortController 掐断 ⇒ 文案「保存超时」；
//      若 60 秒生效 ⇒ 21 秒后正常 200 ⇒「已保存」。
//
// 用法: NODE_PATH=<managed>/node_modules node v196-verify.js <TOKEN> <TENANT>

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

function clickSave(page) {
  return (async () => {
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
    for (let i = 0; i < 130; i++) {
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
    await sleep(900);
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
  })();
}

function clickCheck(page) {
  return (async () => {
    await page.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); });
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')]
        .filter(x => x.offsetParent !== null && x.getBoundingClientRect().width > 0)
        .find(x => /^查错/.test(x.textContent.replace(/\s+/g, '')));
      if (!b) return 'no-button';
      b.click();
      return b.textContent.replace(/\s+/g, '');
    });
    await sleep(1600);
    const fin = await page.evaluate(() => ({
      toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent.replace(/\s+/g, ' ').trim()),
      items: [...document.querySelectorAll('.err-panel .err-list li')].map(li => li.textContent.replace(/\s+/g, ' ').trim()).slice(0, 14),
      badge: (() => {
        const b = [...document.querySelectorAll('button')].find(x => /^查错/.test(x.textContent.replace(/\s+/g, '')));
        return b ? b.textContent.replace(/\s+/g, '') : '';
      })(),
    }));
    return { clicked, ...fin };
  })();
}

function changedEdit(page, tag) {
  return page.evaluate(t => {
    const inp = document.querySelector('table.edit-tbl tbody input.cell-name');
    if (!inp) return null;
    const old = inp.value;
    const nv = old + t;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, nv);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return { old, nv };
  }, tag);
}

function fmt(reqs) {
  if (!reqs || !reqs.length) return '    （未捕获到写请求）';
  return reqs.map(q => {
    const b = q.reqBody || {};
    const rows = b.rows ? b.rows.length : (b.customers ? `customers=${b.customers.length}` : '?');
    return `    → ${q.url.replace(BASE, '')} [${q.status}] ${q.ms}ms ${q.url.includes('bulk-upsert') ? `rows=${rows}` : rows}` +
      (q.respBody && q.respBody.length < 260 ? `\n        resp=${q.respBody}` : '');
  }).join('\n');
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
    errs.push(`[${STEP}] ` + parts.join(' ').slice(0, 300));
  });
  page.on('pageerror', e => errs.push(`[${STEP}] PAGEERROR ${e.message}`.slice(0, 300)));
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
    if (!t) return null;
    return {
      rows: t.querySelectorAll('tbody tr').length,
      cols: t.querySelectorAll('thead th').length,
      names: [...t.querySelectorAll('thead th')].map(x => x.textContent.trim()).slice(0, 14),
    };
  });
  ok('2 已进入改单态且有编辑网格', !!g0 && g0.rows > 0, g0 ? `rows=${g0.rows} 表头列=${g0.cols}` : 'no-edit-table');
  if (!g0) { await browser.close(); report(); return; }

  // ── P1 条码判据放宽：改前「存在 2 处需要修正」→ 现在应「当前没有需要修正的录入」──
  STEP = 'P1-check';
  const c1 = await clickCheck(page);
  const toast1 = (c1.toasts || []).join(' | ');
  const noErr = /当前没有需要修正/.test(toast1) && !c1.items.length;
  ok('P1 条码判据放宽：多规格共码不再算错（期望 0 处）', noErr,
    `按钮=${c1.clicked} 角标=${c1.badge}\n    toast=${JSON.stringify(toast1 || '(无)')}` +
    (c1.items.length ? `\n    仍报 ${c1.items.length} 处:\n` + c1.items.map(x => '      · ' + x).join('\n') : ''));

  // ── P2a 不做任何修改直接保存 ⇒ 期望**不发** bulk-upsert（0 改动行）──
  STEP = 'P2a-nochange';
  const s2a = await clickSave(page);
  const b2 = (s2a.reqs || []).filter(q => q.url.includes('bulk-upsert'));
  ok('P2a 无改动保存：不发 bulk-upsert（0 改动行）', b2.length === 0,
    `toast=${JSON.stringify((s2a.toasts || []).slice(-1)[0] || '')}\n${fmt(s2a.reqs)}` +
    (b2.length ? `\n    ⚠️ 期望 0 行，实测 rows=${(b2[0].reqBody || {}).rows ? b2[0].reqBody.rows.length : '?'}` : ''));

  // ── P2b 只改 1 行 ⇒ bulk-upsert 请求体应只有 1 行 ──
  STEP = 'P2b-onechange';
  const chg = await changedEdit(page, '（v196改单测试）');
  await sleep(900);
  const s2b = await clickSave(page);
  const b3 = (s2b.reqs || []).filter(q => q.url.includes('bulk-upsert'));
  const n3 = b3.length ? ((b3[0].reqBody || {}).rows || []).length : -1;
  ok('P2b 只发改动行：改 1 行 ⇒ bulk-upsert rows 恰为 1', n3 === 1,
    `改前="${chg ? chg.old : '?'}" 改后="${chg ? chg.nv : '?'}"\n    toast=${JSON.stringify((s2b.toasts || []).slice(-1)[0] || '')}\n${fmt(s2b.reqs)}`);

  // ── P3 P0-3：拦截 bulk-upsert 延迟 21 秒 ⇒ 20 秒超时会失败、60 秒超时应成功 ──
  STEP = 'P3-slow21s';
  const DELAY = 21000;
  await page.setRequestInterception(true);
  page.on('request', async r => {
    try {
      if (r.url().includes('/api/products/bulk-upsert')) await sleep(DELAY);
      await r.continue();
    } catch (e) { /* 前端已 abort ⇒ continue 会抛，忽略 */ }
  });
  const chg3 = await changedEdit(page, '（v196超时测试）');
  await sleep(900);
  const t3 = Date.now();
  const s3 = await clickSave(page);
  const wall = Date.now() - t3;
  const b4 = (s3.reqs || []).filter(q => q.url.includes('bulk-upsert'));
  const ms4 = b4.length ? b4[0].ms : -1;
  const toast3 = (s3.toasts || []).slice(-1)[0] || '';
  const savedOK = /已保存/.test(toast3);
  ok('P3 60 秒超时生效：21 秒慢请求仍成功（20 秒下必失败）', ms4 >= 20000 && savedOK,
    `延迟=${DELAY}ms 实测 bulk-upsert 用时=${ms4}ms 整轮墙钟=${wall}ms\n    toast=${JSON.stringify(toast3)}\n    banner=${JSON.stringify(s3.banner || '(无)')}\n${fmt(s3.reqs)}`);

  await browser.close();
  report();

  function report() {
    console.log('\n==================== v196 真机验收 ====================');
    let pass = 0;
    out.forEach((r, i) => {
      if (r.pass) pass++;
      console.log(`\n${r.pass ? '✅' : '❌'} ${r.n}`);
      if (r.d) console.log('   ' + r.d);
    });
    console.log(`\n---- ${pass}/${out.length} PASS ----`);
    if (errs.length) {
      console.log(`\n前 8 条前端异常（共 ${errs.length}）:`);
      errs.slice(0, 8).forEach(e => console.log('   ' + e));
    } else {
      console.log('\n前端异常: 无');
    }
  }
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
