// v184d 真机探针（增强版）：验证只读汇总表 + 编辑网格，报单金额按厂价口径。
const puppeteer = require('puppeteer-core');
const TOKEN = process.argv[2];
const EXEC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://hergent.cn';

const num = s => { if (s == null) return NaN; const m = String(s).replace(/[, ¥]/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };

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
  await new Promise(r => setTimeout(r, 3000));

  // ---- 只读汇总表 ----
  const ro = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('table.tbl.cross-tbl thead th')).map(th => (th.innerText||'').replace(/\s+/g,' ').trim());
    const gear = document.querySelector('.col-cfg.gear'); if (gear) gear.click();
    const trs = Array.from(document.querySelectorAll('table.tbl.cross-tbl tbody tr.data-row'));
    const sample = trs.slice(0, 12).map(tr => {
      const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.innerText||'').replace(/\s+/g,' ').trim());
      const row = {}; headers.forEach((h,i)=> row[h]= tds[i]!==undefined?tds[i]:'(无)'); return row;
    });
    const footTds = Array.from(document.querySelectorAll('.col-total-bar table.tbl.cross-tbl tbody tr.col-total td')).map(td => (td.innerText||'').replace(/\s+/g,' ').trim());
    const note = document.querySelector('.cross-amt-note');
    const menu = Array.from(document.querySelectorAll('.col-menu-list li label')).map(l => (l.innerText||'').replace(/\s+/g,' ').trim());
    const x = document.querySelector('.col-menu-x'); if (x) x.click();
    return { headers, sample, footTds, note: note?(note.innerText||'').replace(/\s+/g,' ').trim():null, menu };
  });

  // 只读金额口径自检：amount ≈ 最终下单 × 单价(厂价)
  const roChecks = ro.sample.map(r => {
    const price = num(r['单价(厂价)']), amt = num(r['下单金额(厂价)']), fin = num(r['最终下单']);
    let status = 'n/a';
    if (!isNaN(price) && !isNaN(amt) && !isNaN(fin)) {
      const exp = fin * price;
      status = Math.abs(exp - amt) < 0.5 ? 'OK' : ('FAIL exp=' + exp + ' got=' + amt);
    }
    return { price, final: fin, amount: amt, status };
  });

  // ---- 进入编辑网格 ----
  await new Promise(r => setTimeout(r, 300));
  const entered = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find(x => /改单/.test(x.innerText || ''));
    if (b) { b.click(); return true; } return false;
  });
  await new Promise(r => setTimeout(r, 3500));
  const eg = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('table.tbl thead th')).map(th => (th.innerText||'').replace(/\s+/g,' ').trim());
    const trs = Array.from(document.querySelectorAll('table.tbl tbody tr.data-row'));
    const sample = trs.slice(0, 12).map(tr => {
      const tds = Array.from(tr.querySelectorAll('td')).map(td => (td.innerText||'').replace(/\s+/g,' ').trim());
      const row = {}; headers.forEach((h,i)=> row[h]= tds[i]!==undefined?tds[i]:'(无)'); return row;
    });
    const footTds = Array.from(document.querySelectorAll('.col-total-bar table.tbl tbody tr.col-total td')).map(td => (td.innerText||'').replace(/\s+/g,' ').trim());
    return { headers, sample, footTds, rowCount: trs.length };
  });
  const egChecks = eg.sample.map(r => {
    const price = num(r['单价(厂价)']), amt = num(r['下单金额(厂价)']), fin = num(r['最终下单']);
    let status = 'n/a';
    if (!isNaN(price) && !isNaN(amt) && !isNaN(fin)) {
      const exp = fin * price;
      status = Math.abs(exp - amt) < 0.5 ? 'OK' : ('FAIL exp=' + exp + ' got=' + amt);
    }
    return { price, final: fin, amount: amt, status };
  });

  await browser.close();
  console.log(JSON.stringify({
    readOnly: { headers: ro.headers, menuLabels: ro.menu, hasJinjia: ro.headers.includes('进价'), note: ro.note,
      sample: ro.sample, footTds: ro.footTds, mathChecks: roChecks },
    editGrid: { entered, headers: eg.headers, rowCount: eg.rowCount, sample: eg.sample, footTds: eg.footTds, mathChecks: egChecks },
    consoleErrors, pageErrors,
  }, null, 2));
})().catch(e => { console.error('PROBE_FAIL', e); process.exit(1); });
