// v187/v188 真机探针：验证「改单态编辑网格」的汇总列序与口径与只读汇总表对齐
//   ① 合计(小单位) 紧挨各报单单元，且 = 各报单单元数量之和
//   ② 最终下单(箱) / 单价(厂价/箱) / 下单金额(厂价) 三列可见（此前编辑网格完全没有）
//   ③ 最终下单 = 合计(箱) + 加单(箱)；下单金额(厂价) = 最终下单 × 单价(厂价/箱)
//   ④ 表尾与顶部汇总同源
//   v188（2026-09-18）：列名带单位 —— 「合计」→「合计(小单位)」、「件数(箱)」→「合计(箱)」，
//     只读表与编辑网格两态同步。⚠️ 探针按文案匹配，改列名必须同步改 WANT/B 段，否则报的是
//     探针自身的失败、不是产品缺陷。H 段为 v188 新增：**查看态（只读汇总表）表头**此前完全没验过。
// ⚠️ 断言必须带「非空守卫」：编辑网格 0 行时逐行断言会静默变绿（技能点名的「断言消失」坑）
// 用法: NODE_PATH=<managed workspace>/node_modules node forecast-edit-grid-v187-verify.js <TOKEN> [TENANT] [PERIOD_ID]
const puppeteer = require('puppeteer-core');
const TOKEN = process.argv[2];
const TENANT = process.argv[3] || '1';
const FORCE_PERIOD = process.argv[4] || null;
const EXEC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://hergent.cn';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = s => { if (s == null) return NaN; const m = String(s).replace(/[, ¥%]/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };

const WANT = ['合计(小单位)', '合计(箱)', '配方建议', '加单(箱)', '最终下单(箱)', '单价(厂价/箱)', '下单金额(厂价)'];

const results = [];
const ok = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXEC, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--window-size=1800,1150'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1800, height: 1150 });
  const consoleErrors = [], pageErrors = [], badResp = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('response', r => { if (r.status() >= 400 && r.url().includes('/api/')) badResp.push(r.status() + ' ' + r.url()); });
  // 角色不在填报白名单时 enterEdit 会 window.confirm —— 不接 dialog 会整轮卡死
  page.on('dialog', async d => { try { await d.accept(); } catch (e) {} });

  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t);
    localStorage.setItem('hergent_v2_tenant', String(ten));
    // v188：测「表头是否折行」—— 对元素内第一个非空文本节点做 Range 测量，行盒数 >1 即折行。
    //   ⚠️ 不能用 th.getBoundingClientRect().height 横向比较：表格同一行内所有单元格高度被强制相同
    //   （折行的那个只会把整行撑高）⇒ 那种判据恒真 = 空断言假 PASS。
    window.__linesOf = (el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n; while ((n = walker.nextNode())) { if (n.nodeValue && n.nodeValue.trim()) break; }
      if (!n || !n.nodeValue || !n.nodeValue.trim()) return null;
      const r = document.createRange(); r.selectNodeContents(n);
      const rs = Array.from(r.getClientRects()).filter(x => x.height > 0);
      if (!rs.length) return null;
      return new Set(rs.map(x => Math.round(x.top))).size;
    };
  }, TOKEN, TENANT);

  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 });
  ok('A0 未被守卫踢回登录页', !/#\/login/.test(page.url()), page.url());
  await page.waitForSelector('table.tbl', { timeout: 30000 }).catch(() => {});
  await sleep(3500);

  const countReadonlyRows = () => page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('table.tbl')).find(x => !x.classList.contains('edit-tbl'));
    return t ? t.querySelectorAll('tbody tr.data-row').length : 0;
  });
  const setPeriod = v => page.evaluate(val => {
    const sel = document.querySelector('select.sel-period');
    if (!sel) return false;
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, String(val));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, v);

  const opts = await page.$$eval('select.sel-period option', os => os.filter(o => Number(o.value) > 0).map(o => o.value));
  ok('A1 期次下拉存在', opts.length > 0, 'opts=' + JSON.stringify(opts));

  // 挑一个「只读表真有行」的期次（空期次进编辑网格会 0 行 → 断言全空转）
  let chosen = null, roRows = 0;
  const order = FORCE_PERIOD ? [FORCE_PERIOD, ...opts.filter(v => String(v) !== String(FORCE_PERIOD))] : opts;
  for (const v of order) {
    await setPeriod(v); await sleep(2600);
    const n = await countReadonlyRows();
    if (n > 0) { chosen = String(v); roRows = n; break; }
  }
  ok('A2 找到有报单行的期次', roRows > 0, 'period=' + chosen + ' readonlyRows=' + roRows);

  // ---- H: 查看态（只读汇总表）表头 —— v188 新增。此前探针只验改单态，查看态列名无人管。----
  //   必须在「点改单」之前抓：之后只读表会被 v-else 换成编辑网格。
  const roHead = await page.evaluate(() => {
    const cands = Array.from(document.querySelectorAll('table.tbl')).filter(x => !x.classList.contains('edit-tbl'));
    const t = cands.find(x => x.querySelectorAll('tbody tr.data-row').length > 0) || cands[0];
    if (!t) return null;
    const ths = Array.from(t.querySelectorAll('thead th'));
    return ths.map(x => ({
      t: (x.innerText || '').replace(/\s+/g, ' ').trim(),
      c: x.className,
      lines: window.__linesOf(x),
      w: Math.round(x.getBoundingClientRect().width),
    }));
  });
  if (!roHead) { ok('H0 读到查看态表头', false, 'null'); }
  else {
    const rt = roHead.map(x => x.t);
    const ri = k => rt.indexOf(k);
    ok('H1 查看态表头含「合计(小单位)」与「合计(箱)」', ri('合计(小单位)') >= 0 && ri('合计(箱)') >= 0, JSON.stringify(rt));
    const rqty = roHead.map((x, i) => /qty/.test(x.c) ? i : -1).filter(i => i >= 0);
    const rlast = rqty.length ? Math.max(...rqty) : -1;
    ok('H2 查看态「合计(小单位)」紧挨最后一个报单单元', rlast >= 0 && ri('合计(小单位)') === rlast + 1,
      'lastQtyThIdx=' + rlast + ' sumThIdx=' + ri('合计(小单位)'));
    const rbare = rt.filter(x => x === '合计' || x === '件数(箱)');
    ok('H3 查看态无裸「合计」/「件数(箱)」表头（防回退）', rbare.length === 0, rbare.length ? '仍存在: ' + JSON.stringify(rbare) : 'ok');
    const si = ri('合计(小单位)');
    const cell = si >= 0 ? roHead[si] : null;
    ok('H4 查看态「合计(小单位)」表头单行不折行（列宽足够）', cell && cell.lines === 1,
      cell ? JSON.stringify({ text: cell.t, w: cell.w, lines: cell.lines }) : '列不存在');
    await page.screenshot({ path: '/tmp/fc_ro_v188.png' });
  }

  // 进改单态
  const clicked = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find(x => /改单/.test(x.textContent) && !/取消/.test(x.textContent) && x.offsetParent !== null);
    if (!b) return false; b.click(); return true;
  });
  await sleep(3000);
  const editRows = await page.evaluate(() => document.querySelectorAll('table.tbl.edit-tbl tbody tr').length);
  ok('A3 已进入改单态且编辑网格有行', clicked && editRows > 0, 'clicked=' + clicked + ' editRows=' + editRows);

  const snap = await page.evaluate(() => {
    const t = document.querySelector('table.tbl.edit-tbl');
    if (!t) return null;
    const thList = Array.from(t.querySelectorAll('thead th'));
    const ths = thList.map(th => (th.innerText || '').replace(/\s+/g, ' ').trim());
    const thInfo = thList.map(th => ({ t: (th.innerText || '').replace(/\s+/g, ' ').trim(), w: Math.round(th.getBoundingClientRect().width), lines: window.__linesOf(th) }));
    const qtyIdx = thList.map((th, i) => th.classList.contains('qty-th') ? i : -1).filter(i => i >= 0);
    // 编辑网格不虚拟滚动（159 行全在 DOM），必须全量读 —— 只采样前 N 行会让表尾断言假 FAIL
    const rows = Array.from(t.querySelectorAll('tbody tr')).map(tr => {
      const qty = Array.from(tr.querySelectorAll('td.qty-cell')).map(td => { const i = td.querySelector('input'); return i ? i.value : (td.innerText || '').trim(); });
      const g = cls => { const td = tr.querySelector('td.' + cls); if (!td) return null; const i = td.querySelector('input'); return i ? i.value : (td.innerText || '').replace(/\s+/g, ' ').trim(); };
      return { qty, sum: g('calc.sum'), boxes: g('calc.boxes'), extra: g('calc.extra'), final: g('calc.final'), price: g('calc.price'), amount: g('calc.amount') };
    });
    const foot = document.querySelector('.col-total-bar');
    const fg = cls => { const td = foot ? foot.querySelector('td.' + cls) : null; return td ? (td.innerText || '').replace(/\s+/g, ' ').trim() : null; };
    const sum = document.querySelector('.edit-summary');
    return {
      ths, thInfo, qtyIdx, rows, qtyCellCount: rows.length ? rows[0].qty.length : 0,
      foot: { sum: fg('calc.sum'), boxes: fg('calc.boxes'), extra: fg('calc.extra'), final: fg('calc.final'), amount: fg('calc.amount') },
      summaryText: sum ? (sum.innerText || '').replace(/\s+/g, ' ').trim() : null,
    };
  });
  ok('A4 读到编辑网格 DOM', !!snap, snap ? 'ths=' + snap.ths.length + ' rows=' + snap.rows.length + ' qtyCells=' + snap.qtyCellCount : 'null');
  if (!snap) { console.log(JSON.stringify({ results, summary: results.filter(r => r.pass).length + '/' + results.length, consoleErrors, pageErrors, badResp }, null, 2)); await browser.close(); process.exit(1); }

  // ---- B: 列序 ----
  const ths = snap.ths;
  const present = WANT.filter(w => ths.includes(w));
  const idx = {}; present.forEach(w => { idx[w] = ths.indexOf(w); });
  const seq = present.map(w => idx[w]);
  ok('B1 汇总段列序 = 合计(小单位) → 合计(箱) → 配方建议 → 加单(箱) → 最终下单(箱) → 单价(厂价/箱) → 下单金额(厂价)',
    seq.every((v, i) => i === 0 || v > seq[i - 1]) && present.length >= 6, present.join(' → '));
  const lastQty = snap.qtyIdx.length ? Math.max(...snap.qtyIdx) : -1;
  ok('B2 合计(小单位) 紧挨各报单单元（= 最后一个报单单元的下一列）', idx['合计(小单位)'] === lastQty + 1, 'lastQtyThIdx=' + lastQty + ' sumThIdx=' + idx['合计(小单位)']);
  ok('B3 合计(小单位) 不在最右', idx['合计(小单位)'] < ths.length - 1, 'sumIdx=' + idx['合计(小单位)'] + ' thTotal=' + ths.length);
  ok('B4 三列均存在（此前编辑网格完全没有）', ['最终下单(箱)', '单价(厂价/箱)', '下单金额(厂价)'].every(k => k in idx),
    ['最终下单(箱)', '单价(厂价/箱)', '下单金额(厂价)'].map(k => k + '@' + (idx[k] != null ? idx[k] : '缺失')).join(' '));
  // v188：裸「合计」/「件数(箱)」都必须消失（防回退到无单位列名）
  const bare = ths.filter(x => x === '合计' || x === '件数(箱)' || x === '金额');
  ok('B5 无遗留的裸「金额」/「合计」/「件数(箱)」表头', bare.length === 0, bare.length ? '仍存在: ' + JSON.stringify(bare) : JSON.stringify(ths));
  const sumTh = (snap.thInfo || []).find(x => x.t === '合计(小单位)');
  ok('B6 编辑网格「合计(小单位)」表头单行不折行（列宽足够）', !!sumTh && sumTh.lines === 1, sumTh ? JSON.stringify(sumTh) : '列不存在');

  // ---- C/D/E: 逐行口径（带非空守卫）----
  const real = snap.rows.filter(r => r.sum != null);
  let cOK = 0, cN = 0, dOK = 0, dN = 0, eOK = 0, eN = 0;
  const fails = [];
  real.forEach((r, i) => {
    const units = r.qty.reduce((a, v) => a + (Number(v) || 0), 0);
    cN++; if (Number(num(r.sum)) === units) cOK++; else fails.push({ i, rule: 'C 合计=Σ报单单元', got: r.sum, units, qty: r.qty });
    if (r.boxes != null && r.extra != null && r.final != null) {
      dN++; if (Number(num(r.final)) === Number(num(r.boxes)) + Number(num(r.extra))) dOK++; else fails.push({ i, rule: 'D 最终下单=合计(箱)+加单(箱)', boxes: r.boxes, extra: r.extra, final: r.final });
    }
    if (r.price != null && r.final != null && r.amount != null && /[\d.]/.test(r.price) && /[\d.]/.test(r.amount)) {
      const p = num(r.price), f = Number(num(r.final)), a = num(r.amount); eN++;
      if (Math.abs(p * f - a) < 1) eOK++; else fails.push({ i, rule: 'E 下单金额=最终下单×单价', p, f, a, exp: p * f });
    }
  });
  ok('C 逐行 合计 == Σ各报单单元数量（非空守卫）', cN > 0 && cOK === cN, cOK + '/' + cN);
  ok('D 逐行 最终下单(箱) == 合计(箱) + 加单(箱)（非空守卫）', dN > 0 && dOK === dN, dOK + '/' + dN);
  ok('E 逐行 下单金额(厂价) == 最终下单(箱) × 单价(厂价/箱)（非空守卫）', eN > 0 && eOK === eN, eOK + '/' + eN);

  // ---- F: 表尾 / 顶部汇总同源（同样带非空守卫）----
  const rowsSum = real.reduce((a, r) => a + (Number(num(r.sum)) || 0), 0);
  const rowsAmt = real.reduce((a, r) => a + (Number(num(r.amount)) || 0), 0);
  const rowsFinal = real.reduce((a, r) => a + (Number(num(r.final)) || 0), 0);
  ok('F1 表尾「合计」== Σ行合计', real.length > 0 && Math.abs(Number(num(snap.foot.sum)) - rowsSum) < 0.5, 'foot=' + snap.foot.sum + ' Σ行=' + rowsSum);
  ok('F2 表尾「最终下单(箱)」== Σ行最终下单', real.length > 0 && Math.abs(Number(num(snap.foot.final)) - rowsFinal) < 0.5, 'foot=' + snap.foot.final + ' Σ行=' + rowsFinal);
  ok('F3 表尾「下单金额(厂价)」== Σ行下单金额', real.length > 0 && Math.abs(Number(num(snap.foot.amount)) - rowsAmt) < 1, 'foot=' + snap.foot.amount + ' Σ行=' + rowsAmt);
  const sumTxt = (snap.summaryText || '').replace(/\s/g, '');
  ok('F4 顶部汇总口径自证（写「下单金额(厂价)」而非裸「金额」）', /下单金额\(厂价\)/.test(sumTxt), snap.summaryText);
  // ⚠️ 必须取 ¥ 之后的数字：裸 num() 会抓到前面的「合计 4 件」的 4（探针自身的坑）
  const sumAmt = (() => { const m = sumTxt.match(/¥\s*([\d,.]+)/); return m ? Number(m[1].replace(/,/g, '')) : NaN; })();
  ok('F5 顶部汇总金额 == 表尾下单金额(厂价)', real.length > 0 && !isNaN(sumAmt) && Math.abs(sumAmt - Number(num(snap.foot.amount))) < 1,
    '汇总金额=' + sumAmt + ' 表尾=' + snap.foot.amount + ' 原文=' + snap.summaryText);

  // ---- G ----
  const realErr = consoleErrors.filter(e => !/403/.test(e));
  ok('G1 无 console error / pageerror', realErr.length === 0 && pageErrors.length === 0, JSON.stringify({ realErr: realErr.slice(0, 3), pageErrors: pageErrors.slice(0, 3) }));

  await page.screenshot({ path: '/tmp/fc_edit_v187.png' });
  const pass = results.filter(r => r.pass).length;
  console.log(JSON.stringify({
    period: chosen, readonlyRows: roRows, editRows,
    headers: ths, footRow: snap.foot, summaryText: snap.summaryText,
    assertions: results,
    summary: pass + '/' + results.length + ' 通过' + (pass === results.length ? ' ✅' : ' ❌'),
    sampleRows: real.slice(0, 5), fails: fails.slice(0, 10),
    consoleErrors: realErr.slice(0, 5), pageErrors: pageErrors.slice(0, 3), badResp: [...new Set(badResp)].slice(0, 6),
  }, null, 2));
  await browser.close();
  process.exit(pass === results.length ? 0 : 2);
})().catch(e => { console.error('PROBE_ERROR', e); process.exit(1); });
