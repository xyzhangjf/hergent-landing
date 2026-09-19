// v184e 真机探针：验证只读汇总表「箱口径」四规则 + 系统建议列位置。
const puppeteer = require('puppeteer-core');
const TOKEN = process.argv[2];
const EXEC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://hergent.cn';
const num = s => { if (s == null) return NaN; const m = String(s).replace(/[, ¥]/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
const specNum = s => { const n = parseFloat(String(s).replace(/[^\d.\-]/g, '').match(/-?\d+(\.\d+)?/)); return isNaN(n) ? NaN : n; };

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXEC, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1700,1100'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1700, height: 1100 });
  const consoleErrors = [], pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(t => { localStorage.clear(); localStorage.setItem('hergent_v2_token', t); }, TOKEN);
  await page.goto(BASE + '/forecast#/forecast', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('table.tbl.cross-tbl thead th', { timeout: 25000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3500));

  // 滚动加载全部虚拟行，按商品名称去重收集
  const collect = async () => page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('table.tbl.cross-tbl thead th')).map(th => (th.innerText||'').replace(/\s+/g,' ').trim());
    const trs = Array.from(document.querySelectorAll('table.tbl.cross-tbl tbody tr.data-row'));
    const rows = trs.map(tr => {
      const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.innerText||'').replace(/\s+/g,' ').trim());
      const row = {}; headers.forEach((h,i)=> row[h] = tds[i]!==undefined ? tds[i] : '(无)'); return row;
    });
    const sc = document.querySelector('table.tbl.cross-tbl').closest('[style*="overflow"]') || document.querySelector('.grid-area');
    return { headers, rows, scTop: sc ? sc.scrollTop : 0, scH: sc ? sc.scrollHeight : 0, scC: sc ? sc.clientHeight : 0 };
  });
  let all = {}, lastTop = -1, guard = 0;
  while (guard++ < 40) {
    const d = await collect();
    d.rows.forEach(r => { if (r['商品名称'] && r['商品名称'] !== '(无)') all[r['商品名称']] = r; });
    if (d.scH <= d.scC + 5 || d.scTop === lastTop) break;
    lastTop = d.scTop;
    await page.evaluate(() => { const sc = document.querySelector('table.tbl.cross-tbl').closest('[style*="overflow"]') || document.querySelector('.grid-area'); if (sc) sc.scrollTop += 800; });
    await new Promise(r => setTimeout(r, 400));
  }
  const rows = Object.values(all);
  const headers = rows[0] ? Object.keys(rows[0]) : [];

  // 列序：系统建议 必须在 加单 之前
  const aiIdx = headers.findIndex(h => h === '系统建议');
  const extraIdx = headers.findIndex(h => h === '加单(箱)');
  const orderOK = aiIdx >= 0 && extraIdx >= 0 && aiIdx < extraIdx;

  // 表尾 + 口径说明
  const footTds = await page.evaluate(() => Array.from(document.querySelectorAll('.col-total-bar table.tbl.cross-tbl tbody tr.col-total td')).map(td => (td.innerText||'').replace(/\s+/g,' ').trim()));
  const note = await page.evaluate(() => { const n = document.querySelector('.cross-amt-note'); return n ? (n.innerText||'').replace(/\s+/g,' ').trim() : null; });

  // 逐行断言四条规则
  const checks = rows.map(r => {
    const qty = num(r['合计']), sp = specNum(r['规格']), boxes = num(r['件数(箱)']);
    const extra = num(r['加单(箱)']), fin = num(r['最终下单(箱)']);
    const price = num(r['单价(厂价/箱)']), amt = num(r['下单金额(厂价)']);
    const res = { hasPrice: !isNaN(price), hasAmt: !isNaN(amt) };
    // 规则1：件数 = round(合计 / 规格)
    if (!isNaN(qty) && !isNaN(sp)) {
      if (sp > 0) res.rule1 = (boxes === Math.round(qty / sp)) ? 'OK' : ('FAIL qty='+qty+' sp='+sp+' boxes='+boxes+' exp='+Math.round(qty/sp));
      else res.rule1 = (boxes === 0) ? 'OK(no-spec)' : ('FAIL boxes='+boxes);
    }
    // 规则3：最终下单 = 件数 + 加单
    if (!isNaN(boxes) && !isNaN(extra) && !isNaN(fin)) {
      res.rule3 = (fin === boxes + extra) ? 'OK' : ('FAIL fin='+fin+' boxes='+extra+' exp='+(boxes+extra));
    }
    // 规则4：下单金额 = 最终下单 × 单价(厂价/箱)
    if (res.hasPrice && res.hasAmt && !isNaN(fin)) {
      const exp = fin * price;
      res.rule4 = (Math.abs(exp - amt) < 1) ? 'OK' : ('FAIL exp='+exp+' got='+amt);
    }
    return res;
  });

  const summary = {
    headers: headers,
    labels: {
      hasJinjia: headers.includes('进价'),
      hasUnits: ['件数(箱)','加单(箱)','最终下单(箱)','单价(厂价/箱)'].every(l => headers.includes(l)),
      hasOldPrice: headers.includes('单价(厂价)'),
      orderOK,
    },
    rowsCount: rows.length,
    ruleStats: {
      rule1: checks.filter(c=>c.rule1==='OK'||c.rule1==='OK(no-spec)').length,
      rule3: checks.filter(c=>c.rule3==='OK').length,
      rule4: checks.filter(c=>c.rule4==='OK').length,
    },
    ruleFails: checks.filter(c => /FAIL/.test(c.rule1||'') || /FAIL/.test(c.rule3||'') || /FAIL/.test(c.rule4||'')),
    note: note,
    consoleErrors, pageErrors,
  };
  console.log(JSON.stringify({ summary, ruleFails: summary.ruleFails, footTds, sampleRows: rows.filter(r => num(r['合计']) > 0).slice(0,8) }, null, 2));
  await browser.close();
})().catch(e => { console.error('PROBE_ERROR', e); process.exit(1); });
