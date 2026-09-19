// v195 决定性验收（前端真机）：删最后一列**前后**的校验错误数对照
//
// 为什么需要这个探针：
//   上一轮 forecast-delcol-with-selection-verify.js 跑出 9/10，其中
//   G3 点了保存但「未捕获到任何写请求」，toast = 「存在 2 处需要修正」。
//   ⇒ 保存被**前端预校验**（Forecast.vue:3359 validateAll()）挡在发请求之前，
//     所以这一轮没能验证「真实浏览器 → 后端」这条路。
//
//   但更要紧的问题是：**那 2 处错误是不是「删列」引入的？**
//     如果删列前是 0 处、删列后变 2 处 ⇒ 删列引入了新缺陷（严重）
//     如果删列前就是 2 处、删列后仍 2 处 ⇒ 数据固有，与删列无关（正常）
//   ⇒ 于是本探针做**同一页面内的前后对照**，并 dump 清单原文识别错误类型。
//
//   附带收益：若基线就是 0 处，则第一次保存会**真的发出写请求**，
//   于是顺手拿到「真实浏览器点保存 → HTTP 状态 + 耗时」这条闭环证据。
//
// 用例：
//   S0 进改单态
//   S1 删列**前** 点保存 → 记基线错误数 baseCount + dump 清单
//   S2 建立选区 → 右键最后一列表头 → 删除列
//   S3 删列**后** 点保存 → 记 afterCount + dump 清单
//   S4 ★断言 baseCount === afterCount（删列不引入新校验错误）
//
// 用法: NODE_PATH=<managed>/node_modules node v195-delcol-error-delta-verify.js <TOKEN> <TENANT>

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
let dialogs = [];

async function dumpErr(page) {
  return page.evaluate(() => {
    const p = document.querySelector('.err-panel');
    if (!p) return null;
    const tag = p.querySelector('.tag');
    const items = [...p.querySelectorAll('.err-list li')].map(li => ({
      loc: ((li.querySelector('.err-loc') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
      why: ((li.querySelector('.err-why') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    }));
    const more = ((p.querySelector('.err-more') || {}).textContent || '').replace(/\s+/g, ' ').trim();
    const empty = ((p.querySelector('.err-empty') || {}).textContent || '').replace(/\s+/g, ' ').trim();
    const grps = [...p.querySelectorAll('.err-grp')].map(b => b.textContent.replace(/\s+/g, ' ').trim());
    return {
      tag: tag ? tag.textContent.replace(/\s+/g, ' ').trim() : '',
      grps, items, more, empty,
      n: items.length,
    };
  });
}

// 点「保存」并收集回执（banner / toast / 写请求）
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
  // 最多等 40 秒（真发请求时后端应在亚秒级返回）
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    const st = await page.evaluate(() => {
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
    // 有写请求且已完成 ⇒ 收工
    if (rec.length && rec.every(x => x.status)) break;
    // 按钮已恢复且已有 toast/banner ⇒ 收工
    if (st.btn && !/保存中/.test(st.btn) && (st.banner || st.toasts.length)) break;
  }
  await sleep(800);
  const fin = await page.evaluate(() => ({
    banner: ((document.querySelector('.save-fail-banner') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
    toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
  }));
  return { clicked, banner: fin.banner, toasts: fin.toasts, reqs: rec.slice() };
}

function fmtReq(reqs) {
  if (!reqs || !reqs.length) return '（无写请求）';
  return reqs.map(q => {
    const p = q.reqBody || {};
    return `→ ${q.url.replace(BASE, '')} [${q.status}] ${q.ms}ms customers=${(p.customers || []).length} rows=${(p.rows || []).length}` +
      (q.respBody && q.respBody.length < 200 ? ` resp=${q.respBody}` : '');
  }).join('\n        ');
}

function fmtErr(d) {
  if (!d) return '    (err-panel 未渲染)';
  const L = [`    tag=${JSON.stringify(d.tag)}`];
  if (d.grps && d.grps.length) L.push(`    分组=${JSON.stringify(d.grps)}`);
  d.items.forEach((it, i) => L.push(`    ${i + 1}) ${it.loc} —— ${it.why}`));
  if (d.empty) L.push(`    empty=${JSON.stringify(d.empty)}`);
  if (d.more) L.push(`    ${d.more}`);
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
  // 保存流程可能弹 window.confirm（提醒 N 行将被忽略）—— 自动接受，否则脚本挂住
  page.on('dialog', async d => { dialogs.push(`${d.type()}: ${d.message().slice(0, 160)}`); try { await d.accept(); } catch (e) {} });
  page.on('request', r => {
    const u = r.url();
    if (r.method() !== 'GET' && u.includes('/api/')) {
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
    return {
      rows: t.querySelectorAll('tbody tr').length,
      qty: ths.map(x => x.textContent.trim()),
      lastQtyName: ths.length ? ths[ths.length - 1].textContent.trim() : '',
    };
  });
  ok('2 已进入改单态且有编辑网格', !!g0 && g0.rows > 0,
     g0 ? `rows=${g0.rows} 客户列=${g0.qty.length} 最后一列=「${g0.lastQtyName}」` : 'no-edit-table');
  if (!g0) { await browser.close(); report(); return; }

  // ── S1 基线（零副作用）：点「查错」按钮 ──
  //   它跑的是**同一个** validateAll()（Forecast.vue:3347），列表为空时只 toast 不写库
  //   ⇒ 拿基线绝不会污染数据、也不会让改单态退出。工具栏 errCount 角标可交叉校验。
  STEP = 'S1-base-check';
  const badge1 = await page.evaluate(() => {
    const b = document.querySelector('.btn-badge.err');
    return b ? b.textContent.replace(/\s+/g, '').trim() : '';
  });
  const clickedCheck = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .filter(x => x.offsetParent !== null && x.getBoundingClientRect().width > 0)
      .find(x => /^查错\d*$/.test(x.textContent.replace(/\s+/g, '')));
    if (!b) return 'no-button';
    b.click();
    return b.textContent.replace(/\s+/g, '');
  });
  await sleep(1800);
  const e1 = await dumpErr(page);
  const baseCount = e1 ? (e1.items.length || 0) : 0;
  ok('S1 删列前「查错」→ 取基线', clickedCheck !== 'no-button',
     `\n    按钮=${clickedCheck} 工具栏角标=${JSON.stringify(badge1)}` +
     `\n    清单(基线 baseCount=${baseCount}):\n${fmtErr(e1)}`);
  ok('S1b 角标与清单条数一致（交叉校验）',
     !badge1 || String(badge1) === String(baseCount) || String(badge1) === '99+',
     `角标=${JSON.stringify(badge1)} 清单=${baseCount}${(!badge1 || String(badge1) === String(baseCount)) ? ' ✅' : ' ⚠️不一致（清单只渲染前若干条，见 errShown）'}`);

  await page.screenshot({ path: '/tmp/v195-delta-s1-baseline.png', fullPage: false });

  // ── S2 建立选区 → 删最后一列 ──
  STEP = 'S2-delcol';
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.edit-tbl')].find(x => x.offsetParent !== null);
    const tds = [...t.querySelectorAll('tbody td.qty-cell')];
    const cs = [...new Set(tds.map(x => Number(x.getAttribute('data-c'))))].sort((a, b) => a - b);
    const lastColC = cs[cs.length - 1];
    const pick = (r, c) => tds.find(x => Number(x.getAttribute('data-r')) === r && Number(x.getAttribute('data-c')) === c);
    const a = pick(0, lastColC), b = pick(4, lastColC);
    if (!a || !b) return;
    a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100 }));
    b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, button: 0 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await sleep(800);
  const selStat = await page.evaluate(() => {
    const el = document.querySelector('.sel-stat');
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  });
  ok('S2a 已建立选区（覆盖最后一列）', !!selStat, `.sel-stat=${selStat ? JSON.stringify(selStat) : '(无)'}`);

  const errsBeforeDel = errs.length;
  const before = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.edit-tbl')].find(x => x.offsetParent !== null);
    return t ? t.querySelectorAll('thead th.qty-th').length : -1;
  });
  const delClicked = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.edit-tbl')].find(x => x.offsetParent !== null);
    const ths = [...t.querySelectorAll('thead th.qty-th')];
    const th = ths[ths.length - 1];
    if (!th) return 'no-th';
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 400, clientY: 300 });
    th.dispatchEvent(ev);
    return ev.defaultPrevented ? 'ok' : 'not-prevented';
  });
  await sleep(600);
  await page.evaluate(() => {
    const m = [...document.querySelectorAll('.ctx-menu')].filter(x => getComputedStyle(x).display !== 'none').pop();
    if (!m) return;
    const b = [...m.querySelectorAll('button')].find(x => /删除列/.test(x.textContent));
    if (b) b.click();
  });
  await sleep(1200);
  const after = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table.edit-tbl')].find(x => x.offsetParent !== null);
    return t ? t.querySelectorAll('thead th.qty-th').length : -1;
  });
  ok('S2b 右键最后一列表头 → 删除列', delClicked === 'ok' && after === before - 1,
     `res=${delClicked} 列 ${before}→${after}`);
  ok('S2c ★删列后无前端异常（selStats 越界已修）', errs.length === errsBeforeDel,
     errs.slice(errsBeforeDel).join(' || ') || '无新错误');

  // ── S3 删列**后**点保存 ──
  STEP = 'S3-after-save';
  const S3 = await clickSave(page);
  const e3 = await dumpErr(page);
  const afterCount = e3 ? (e3.items.length || 0) : 0;
  ok('S3 删列后点保存 → 抓到回执', !!S3 && S3.clicked !== false,
     `\n    按钮=${S3.clicked} banner=${S3.banner ? JSON.stringify(S3.banner) : '(无)'}` +
     `\n    toast=${JSON.stringify(S3.toasts.length ? S3.toasts[S3.toasts.length - 1] : '')}` +
     `\n    写请求: ${fmtReq(S3.reqs)}` +
     `\n    清单(删列后 afterCount=${afterCount}):\n${fmtErr(e3)}`);

  // ── S4 决定性断言 ──
  ok('S4 ★删列是否引入新的校验错误（baseCount vs afterCount）', afterCount === baseCount,
     `baseCount=${baseCount} afterCount=${afterCount} ⇒ ${afterCount === baseCount ? '删列未引入新错误 ✅' : '⚠️ 删列改变了错误数，需追查'}`);

  const sameList = JSON.stringify((e1 || {}).items) === JSON.stringify((e3 || {}).items);
  ok('S5 ★两次清单内容是否逐字相同', sameList,
     sameList ? '两次清单完全相同 ⇒ 这 2 处是数据固有（与删列无关）' : '清单内容发生变化，需人工比对');

  await page.screenshot({ path: '/tmp/v195-delta-s3-after.png', fullPage: false });

  STEP = 'end';
  await browser.close();
  report();

  function report() {
    console.log('\n================ 结果 ================');
    out.forEach(x => console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.n}${x.d ? '\n' + x.d : ''}`));
    const pass = out.filter(x => x.pass).length;
    console.log(`\n合计 ${pass}/${out.length}`);
    console.log('\n---- 弹出的 window.confirm/dialog ----');
    dialogs.slice(0, 6).forEach(d => console.log('  ' + d));
    console.log('\n---- 全部 console/page error ----');
    errs.slice(0, 12).forEach(e => console.log('  ' + e));
  }
})().catch(e => { console.log('FATAL', (e && e.stack) || e); process.exit(1); });
