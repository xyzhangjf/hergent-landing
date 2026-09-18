// v191b 沙箱端到端：「单价(厂价/箱)」留空 = **自动沿用上一期录入的价**（2026-09-18 用户拍板：
//   「直接延用上一期，不加按钮」）。
//
// 🔴 必须在**隔离沙箱租户**（id ≥ 9997）上跑 —— 本脚本会真的保存报单数据。
//   前置夹具（沙箱库天然没有可沿用的历史行，见夹具脚本注释）：
//     ssh root@<prod> 'cd /opt/hergent-erp && python3 /tmp/sandbox_extra_qty_fixture.py \
//        --db tenant_9997.db seed --name 红桶 --price 88'
//   ⇒ 往期(2026-08-30~2026-09-15) 对「红桶（甲户下单）」录了 88.00 元/箱；
//     该商品档案厂价 4.5、规格 10 ⇒ **档案自动价 = 45.00 元/箱**。
//     88 vs 45 相差一倍 ⇒ 「页面显示/金额到底吃哪个」有判别力（不是那种两边都对的假断言）。
//
// ⚠️ 分三段跑（`--phase 1|2|3`），因为每段之间要在**库层**取证（ssh 直查 tenant_9997.db）：
//      phase 1 只读 + 一次「不动单价」的保存 → 库里不该多出本期价行（「没填」不得变「填过」）
//      phase 2 填 99 → 保存 → 库里本期行 case_price = 99
//      phase 3 清空 → 保存 → 库里本期行 case_price 回 NULL，且页面回落**沿用值 88**（不是档案价 45）
//
// 判据总览：
//   P1a 沿用值**只进灰字占位**（input.value 为空、无 manual-price 类）—— 不实填、不像本期填的
//   P1b 占位 == 88.00（沿用值），而不是 45.00（档案自动价）
//   P1c title 说明来源：含「沿用」+ 88.00 + 来源期次 8/30–9/15 + 并列出档案自动价
//   P1d **对照行**（另一行有自动价的商品）占位 == 它自己的自动价、title 无「沿用」
//       ⇒ 沿用是**逐商品**的，不是全表铺（否则这条判据会假绿）
//   P1e 金额真的吃沿用价：金额 == 最终下单(箱) × 88（按档案价会是 × 45）
//   P1f 保存（未动单价）→ 载荷 case_price = null；且全程无 batch-factory-price 请求
//   P2a/P2b 本期填 99 → manual-price 标记 + 金额改用 99
//   P2c 保存 → 载荷 case_price = 99
//   P3a 重载回读：value == 99
//   P3b 清空 + 保存 → 载荷 case_price = null
//   P3c 保存后占位回落 88.00（**沿用值**，不是 45.00）= 清空只撤销「本期另行指定」
//
//   用法: NODE_PATH=<managed workspace>/node_modules node forecast-caseprice-inherit-v191b-verify.js <TOKEN> <TENANT=9997> <phase 1|2|3>
const puppeteer = require('puppeteer-core');
const TOKEN = process.argv[2];
const TENANT = process.argv[3] || '9997';
const PHASE = String(process.argv[4] || '1');
const EXEC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://hergent.cn';
const TARGET = '红桶（甲户下单）';
const INHERIT = 88;      // 夹具里的往期录入价
const AUTO = 45;         // 档案厂价 4.5 × 规格 10
const QTY_UNIT = 20;     // 给该行第一个报单单元填的量（÷规格10 = 2 箱；⚠️ 该行本有导入量，最终箱数不写常量）
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
const num = s => Number(String(s == null ? '' : s).replace(/[^\d.-]/g, ''));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--window-size=1800,1150'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1800, height: 1150 });
  const pageErrors = [], badResp = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  /* 🔴 真实路径 = `/api/forecast-submissions/summary` / `-submissions/save-matrix`
     （api/modules.js::forecastApproveApi）—— 写成 `/api/forecast/...` 永远匹配不到（v191 踩过）。 */
  let sumRows = [], sumUrl = '';
  page.on('response', async r => {
    if (r.status() >= 400 && r.url().includes('/api/')) badResp.push(r.status() + ' ' + r.url());
    if (!r.url().includes('/api/forecast-submissions/summary')) return;
    try { sumRows = (await r.json()).rows || []; sumUrl = r.url().replace(BASE, ''); } catch (e) {}
  });
  /* 沙箱的 `POST /api/products/bulk-upsert` 会超 20s 被前端 abort（沙箱库特性，本轮没碰它）⇒ 只回壳放行。
     其余一律真发：save-matrix 是核心通道（且要抓载荷），batch-factory-price 只**观察**（P1f 判据）。 */
  let capturedFp = null, capturedMatrix = null;
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (u.includes('/api/products/batch-factory-price')) {
      try { capturedFp = JSON.parse(r.postData() || '{}'); } catch (e) { capturedFp = { parseErr: String(e) }; }
      return r.continue().catch(() => {});
    }
    if (u.includes('/api/forecast-submissions/save-matrix')) {
      try { capturedMatrix = JSON.parse(r.postData() || '{}'); } catch (e) { capturedMatrix = { parseErr: String(e) }; }
      return r.continue().catch(() => {});
    }
    if (u.includes('/api/products/bulk-upsert')) {
      return r.respond({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, inserted: 0, updated: 0, skipped: 0 }) }).catch(() => {});
    }
    return r.continue().catch(() => {});
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
        const m = document.querySelector('.sf-msg'), p = document.querySelector('.sf-partial');
        return { btn: b ? (b.textContent || '').trim() : 'none', msg: m ? m.textContent : '', part: p ? p.textContent : '' };
      });
      last = st.btn;
      if (st.msg || st.part) failMsg = JSON.stringify(st);
      if (last === '保存') return { clicked: c, done: true, last, failMsg };
      if (last === '重试保存') return { clicked: c, done: false, last, failMsg };
    }
    return { clicked: c, done: false, last, failMsg };
  };
  const open = async () => {
    await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('table.tbl', { timeout: 30000 }).catch(() => {});
    await sleep(4000);
    return enterEdit();
  };
  // 读目标行 + 一行对照行（另一行有自动价、但不是目标商品）
  const readRows = () => page.evaluate((target) => {
    /* ⚠️ `page.evaluate` 跑在浏览器上下文里 —— Node 侧的 `num()` 在这里**不存在**
       （本轮实测踩到：`ReferenceError: num is not defined`。探针工具层又一个坑，已记入技能）。 */
    const n = (s) => Number(String(s == null ? '' : s).replace(/[^\d.-]/g, ''));
    const t = document.querySelector('table.tbl.edit-tbl');
    if (!t) return { err: '找不到编辑网格' };
    const rows = [];
    t.querySelectorAll('tbody tr').forEach(x => {
      const pi = x.querySelector('td.calc.price input');
      const ni = x.querySelector('input.cell-name');
      if (!pi || !ni) return;
      const fin = x.querySelector('td.calc.final');
      const amt = x.querySelector('td.calc.amount span');
      rows.push({
        name: (ni.value || '').trim(), val: pi.value, ph: String(pi.placeholder || '').trim(),
        title: String(pi.title || ''), manual: pi.classList.contains('manual-price'),
        final: fin ? (fin.textContent || '').trim() : '', amount: amt ? (amt.textContent || '').trim() : '',
      });
    });
    const me = rows.find(r => r.name === target) || null;
    const ctrl = rows.find(r => r.name !== target && n(r.ph) > 0) || null;
    return { count: rows.length, me, ctrl };
  }, TARGET);
  // 给目标行第一个报单单元填量（走原生 setter + input/change，Vue v-model 才吃）
  const setQty = (v) => page.evaluate((target, val) => {
    const t = document.querySelector('table.tbl.edit-tbl');
    for (const x of Array.from(t.querySelectorAll('tbody tr'))) {
      const ni = x.querySelector('input.cell-name');
      if (!ni || (ni.value || '').trim() !== target) continue;
      const qi = x.querySelector('td.qty-cell input');
      if (!qi) return { err: '该行没有报单单元输入框' };
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(qi, String(val));
      qi.dispatchEvent(new Event('input', { bubbles: true }));
      qi.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, val: qi.value };
    }
    return { err: '找不到目标行' };
  }, TARGET, v);
  const setPrice = (v) => page.evaluate((target, val) => {
    const t = document.querySelector('table.tbl.edit-tbl');
    for (const x of Array.from(t.querySelectorAll('tbody tr'))) {
      const ni = x.querySelector('input.cell-name');
      if (!ni || (ni.value || '').trim() !== target) continue;
      const pi = x.querySelector('td.calc.price input');
      if (!pi) return { err: '该行没有单价框' };
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(pi, val === null ? '' : String(val));
      pi.dispatchEvent(new Event('input', { bubbles: true }));
      pi.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, val: pi.value, manual: pi.classList.contains('manual-price') };
    }
    return { err: '找不到目标行' };
  }, TARGET, v);
  const matrixRow = () => {
    const rs = (capturedMatrix && Array.isArray(capturedMatrix.rows)) ? capturedMatrix.rows : [];
    return { n: rs.length, row: rs.find(r => String(r.product_name || '').trim() === TARGET) || null };
  };

  // ================= phase 1：沿用可见 + 不动单价保存 =================
  if (PHASE === '1') {
    const e = await open();
    ok('P0 已进入改单态且有行（沙箱令牌有效）', e.clicked && e.rows > 0, JSON.stringify(e));

    const r1 = await readRows();
    ok('P1a 沿用值**只进灰字占位**：input.value 为空、无 manual-price 标记（不像「本期填过」）',
      !!r1.me && r1.me.val === '' && r1.me.manual === false, JSON.stringify(r1.me));
    ok('P1b 占位 == 88.00（**沿用上一期录入价**），而不是 45.00（档案自动价）——两者差一倍，有判别力',
      !!r1.me && Math.abs(num(r1.me.ph) - INHERIT) < 1e-6 && Math.abs(num(r1.me.ph) - AUTO) > 1e-6,
      '占位=' + (r1.me ? r1.me.ph : 'null') + ' 期望沿用=' + INHERIT + ' 档案自动价=' + AUTO);
    ok('P1c title 讲清来源：含「沿用」「88.00」「08/30–09/15」，且同时列出档案自动价',
      !!r1.me && /沿用/.test(r1.me.title) && /88\.00/.test(r1.me.title) && /0?8\/30[–-]0?9\/15/.test(r1.me.title)
      && /自动价/.test(r1.me.title), JSON.stringify(r1.me && r1.me.title));
    ok('P1d **对照行**（另一个有自动价的商品）占位 == 它自己的自动价、title 无「沿用」'
      + ' ⇒ 沿用是逐商品的，不是全表铺（否则本判据会假绿）',
      !!r1.ctrl && Math.abs(num(r1.ctrl.ph) - INHERIT) > 1e-6 && !/沿用/.test(r1.ctrl.title),
      '对照=' + JSON.stringify(r1.ctrl && { name: r1.ctrl.name, ph: r1.ctrl.ph, title: r1.ctrl.title.slice(0, 40) }));

    // P1e 金额真的吃沿用价
    /* ⚠️ 探针自己的坑（本轮实测）：别把「最终下单箱数」写成常量 —— 沙箱里该行**本来就有导入量**，
       我预设的「填 20 ÷ 规格 10 = 2 箱」当场对不上（实际 47 箱）。断言只能建立在**同一时刻页面上的
       两个读数**之间（金额 ∝ 单价），而不是我脑内算出来的期望值。判别性来自 88 vs 45 差一倍。 */
    const q = await setQty(QTY_UNIT);
    await sleep(1200);
    const r2 = await readRows();
    const fq = num(r2.me && r2.me.final), amt = num(r2.me && r2.me.amount);
    ok('P1e 金额真的吃**沿用价**：下单金额 == 最终下单(箱) × 88，且明显不等于 × 45（按档案价算会差一倍）',
      !q.err && fq > 0 && Math.abs(amt - fq * INHERIT) < 0.01 && Math.abs(amt - fq * AUTO) > 1,
      JSON.stringify({ setQty: q, final箱: fq, amount: amt, 期望: fq * INHERIT, 按档案价会是: fq * AUTO }));

    // P1f 不动单价 → 保存：载荷必须 null（「没填」不得被记成「填过」）
    capturedMatrix = null; capturedFp = null;
    const s = await clickSave();
    const mr = matrixRow();
    ok('P1f 保存（**未动单价**）成功完成', s.done, JSON.stringify(s));
    ok('P1g save-matrix 载荷里该行 case_price = **null**（沿用值**不落库** ⇒「没填」不会被记成「填过」，'
      + '否则清空后又被写回，用户永远清不掉）',
      !!mr.row && mr.row.case_price === null, 'matrixRows=' + mr.n + ' sent=' + JSON.stringify(mr.row && { n: mr.row.product_name, cp: mr.row.case_price }));
    ok('P1h 全程**没有**调用 /api/products/batch-factory-price（不写商品档案）', capturedFp === null,
      'captured=' + JSON.stringify(capturedFp).slice(0, 160));
    await page.screenshot({ path: '/tmp/fc_inherit_v191b_phase1.png' });
  }

  // ================= phase 2：本期手工覆盖 =================
  if (PHASE === '2') {
    const e = await open();
    ok('P2-0 已进入改单态', e.clicked && e.rows > 0, JSON.stringify(e));
    const before = await readRows();
    ok('P2-0b 上一段保存后：占位仍是沿用值 88.00（库里没有本期价 ⇒ 没被顺手写进去）',
      !!before.me && before.me.val === '' && Math.abs(num(before.me.ph) - INHERIT) < 1e-6, JSON.stringify(before.me));

    const sp = await setPrice(99);
    await sleep(1000);
    const r = await readRows();
    ok('P2a 本期填 99 → 框内回显 99 且带 manual-price 标记（与沿用态**视觉可区分**）',
      !sp.err && String(r.me && r.me.val) === '99' && r.me.manual === true, JSON.stringify(r.me));
    const fq = num(r.me && r.me.final), amt = num(r.me && r.me.amount);
    ok('P2b 金额改用本期手工价：== 最终下单(箱) × 99', fq > 0 && Math.abs(amt - fq * 99) < 0.01,
      JSON.stringify({ final箱: fq, amount: amt, 期望: fq * 99 }));

    capturedMatrix = null;
    const s = await clickSave();
    const mr = matrixRow();
    ok('P2c 保存 → save-matrix 载荷该行 case_price = 99（本期手工价**落库**）',
      s.done && !!mr.row && Math.abs(Number(mr.row.case_price) - 99) < 1e-6,
      'done=' + s.done + ' sent=' + JSON.stringify(mr.row && { n: mr.row.product_name, cp: mr.row.case_price }));
    await page.screenshot({ path: '/tmp/fc_inherit_v191b_phase2.png' });
  }

  // ================= phase 3：清空可撤销（回落沿用值） =================
  if (PHASE === '3') {
    const e = await open();
    ok('P3-0 已进入改单态', e.clicked && e.rows > 0, JSON.stringify(e));
    const back = await readRows();
    ok('P3a 重载回读：本期手工价 99 仍在框里（保存后刷新不丢）',
      !!back.me && Math.abs(num(back.me.val) - 99) < 1e-6, JSON.stringify(back.me));

    const cl = await setPrice(null);
    capturedMatrix = null;
    const s = await clickSave();
    const mr = matrixRow();
    ok('P3b 清空 + 保存 → 载荷 case_price = null（写回 NULL，可撤销）',
      s.done && !!mr.row && mr.row.case_price === null,
      'done=' + s.done + ' sent=' + JSON.stringify(mr.row && { n: mr.row.product_name, cp: mr.row.case_price }));

    await sleep(1500);
    const r2 = await readRows();
    ok('P3c 清空后占位回到 **88.00（沿用值）**，而不是 45.00（档案自动价）'
      + ' ⇒ 清空只撤销「本期另行指定」，默认仍是沿用上一期', !!r2.me && Math.abs(num(r2.me.ph) - INHERIT) < 1e-6,
      JSON.stringify(r2.me));
    ok('P3d 清空后该行恢复「无 manual-price 标记」', !!r2.me && r2.me.manual === false && r2.me.val === '',
      JSON.stringify(r2.me && { val: r2.me.val, manual: r2.me.manual }));
    await page.screenshot({ path: '/tmp/fc_inherit_v191b_phase3.png' });
  }

  ok('X1 无 pageerror', pageErrors.length === 0, JSON.stringify(pageErrors).slice(0, 300));
  ok('X2 无 4xx/5xx 接口响应', badResp.length === 0, JSON.stringify(badResp).slice(0, 300));

  await browser.close();
  const pass = results.filter(r => r.pass).length;
  console.log('=== phase ' + PHASE + ' === (' + pass + '/' + results.length + ')');
  results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.detail ? '\n       ' + r.detail : '')));
  console.log('SUMMARY ' + JSON.stringify({ phase: PHASE, pass, total: results.length }));
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('PROBE_FATAL', e && e.stack || e); process.exit(2); });
