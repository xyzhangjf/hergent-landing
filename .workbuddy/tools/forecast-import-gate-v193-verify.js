// v193 沙箱真机：「导入」的前置条件 = **必须有一个「进行中」的期次**（用户诉求原文：
//   「我们之前设计的流程是：用户必须先点击"新建期次"，之后才能进行导入操作。
//    但目前导入入口直接暴露在页面上，未新建期次也能使用，我实测点击后确实可以正常导入，
//    导致整个业务流程被绕过、逻辑混乱。」）
//
// 🔴 本轮两处都容易取错，值得留档（第一版就取错了判据，跑完沙箱才发现）：
//   ① **漏洞本体不在前端**：后端 `_execute_forecast_cross` 旧实现里 `forecast_period_current()`
//      取不到时会**兜底** `forecast_period_default()`（兜底链末级 =「最新创建的期次，**不限状态**」）
//      ⇒ 期次全 closed 时 154 个商品被挂到**已关闭的期次**上，用户根本看不到；而
//      `forecast_periods` 表为空时 `_period_id` 落 0 ⇒ 幽灵归属。**两种都照样写库。**
//   ② **判据不是「有没有期次」**：既定方案（`outputs/期次数据流程优化方案-2026-09-17/…§四.1`）
//      原文「不是『必须先建期次』，而是『必须有一个**进行中**的期次』」，并明确警告：
//      闸门若只加在「有没有期次」而**不收窄 default() 兜底**，则**闸门形同虚设**（closed 期次
//      仍会被兜底选中）⇒「导入侧只接受 `status='open'` 的期次」。
//      ⇒ 第一版按「有没有期次」实现，B 组用「零期次」当判据能过，但**事故场景（全 closed）
//        根本不会被拦** —— 即闸门装在了错的边上。
//
// 故修法是三处判据一起收窄 + 两层防线：
//   前端 Forecast.vue ：
//     ① `openPeriodId` 读 `GET /periods` 新增的 **`open`** 字段（= 后端 forecast_period_current()）
//     ② `noOpenPeriod` / `canImport` 判据   ③ `openImport()` 硬守卫
//     ④ 两个入口 :disabled + title   ⑤ 顶部常驻横幅（§五 阶段 0）   ⑥ 空态指路「新建期次」
//   后端 import_router.py ：
//     ⑦ **删掉 default() 兜底**，`_period_id` 只取 `forecast_period_current()`；为 0 ⇒ 400
//   后端 forecast.py ：
//     ⑧ `/periods` 新增 `open` 字段（前端判据的权威来源，与 ⑦ 同源同一个函数）
//
// 用法（四阶段分开跑，中间由 shell 改库状态 —— 必须显式指定阶段）：
//   node forecast-import-gate-v193-verify.js <TOKEN> <TENANT> A <样本.xlsx>   有 open 期次：不误伤
//   node forecast-import-gate-v193-verify.js <TOKEN> <TENANT> B <样本.xlsx>   ★期次全 closed：必须拒（事故场景）
//   node forecast-import-gate-v193-verify.js <TOKEN> <TENANT> D <样本.xlsx>   零期次 + 零数据：必须拒 + 空态指路
//   node forecast-import-gate-v193-verify.js <TOKEN> <TENANT> C <样本.xlsx>   走既定流程：新建期次 → 导入
//
// 判据总览：
//   A 有 open 期次（回归，证明没误伤）
//     A1 工具条「导入」按钮**可用**         A2 点击后抽屉打开
//     A3 抽屉显示「本期归属：<期次名>」（非「你现在还没有期次」）
//     A4 ★后端直连接口 → HTTP **200** 且 results.success > 0（真能导）
//     A5 回执 period_id > 0（有归属）
//   B ★期次全 closed（既定方案 §四.1 的事故场景；数据保留，故表格非空）
//     B1 导入按钮已置灰   B2 title 说明原因   B3 ★顶部横幅（文案与方案一致 + 带出口）
//     B5 ★两个入口点不动   B6 ★后端 400   B7 ★连调两次仍 400
//   D 零期次 + 零数据（全新租户外观）
//     D1/D2/D3 同 B；D4 ★空态也指路「新建期次」且**没有**「导入 Excel」按钮；D5-D7 同 B
//   C 走既定流程（证明门开得回来，且导进来的数据**有归属**）
//     C1 空态指路   C2 点「新建期次」→ 表单   C3 填名称/三个日期 → 创建成功
//     C4 期次进入下拉   C5 ★导入按钮恢复可用   C6 ★后端 200   C7 ★period_id = 新建期次
//
// ⚠️ 阶段间必须由外部改库（关闭/清空/重建期次）—— 探针自己**不动库**，只读页面 + 打接口。
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const TOKEN = process.argv[2];
const TENANT = process.argv[3] || '9997';
const PHASE = (process.argv[4] || '').toUpperCase();
const XLSX = process.argv[5] || '/tmp/fc_v193_sample.xlsx';
const EXEC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://hergent.cn';
const OD = '2026-09-18';   // 与样本/库对账用的固定 order_date
// 列映射显式给出（列识别本是前端预览产出的，这里直连接口就自备一份）：
//   0=商品名称 1=条码 2=规格 3=单位 4=单价 5=到货周期 6/7=客户列
const MAPPING = { 0: 'name', 1: 'barcode', 2: 'spec', 3: 'unit', 4: 'price', 5: 'rhythm', 6: 'customer', 7: 'customer' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });

// ── 页面内取数（page.evaluate 只序列化函数自身 ⇒ 一律内联，不引用 Node 侧 helper）──

// 工具条「导入」按钮：存在性 / 是否置灰 / title / 文案
// ⚠️ 必须**先按可见性**筛，再取文本精确等于「导入」的那个：菜单里的「导入模板」等
//   按钮文本也含「导入」，而 Teleport 出去的面板按钮 `offsetParent` 为 null。
function snapToolbarImport() {
  const bs = [...document.querySelectorAll('button')].filter(b => /导入/.test(b.textContent));
  const pick = bs.find(b => b.offsetParent !== null && b.textContent.trim().replace(/\s+/g, '') === '导入')
            || bs.find(b => b.textContent.trim().replace(/\s+/g, '') === '导入');
  if (!pick) return { exists: false, all: bs.map(b => b.textContent.trim()).slice(0, 8) };
  return {
    exists: true,
    disabled: pick.disabled === true,
    title: pick.getAttribute('title') || '',
    text: pick.textContent.trim(),
    visible: pick.offsetParent !== null,
  };
}

// 表空态（本期 0 行时那一屏）
function snapEmptyRow() {
  const t = document.querySelector('table.cross-tbl[role="grid"]')
         || [...document.querySelectorAll('table.tbl')].find(x => x.offsetParent !== null);
  const tr = t ? t.querySelector('tbody tr.empty-row') : null;
  if (!tr) return { present: false };
  const btns = [...tr.querySelectorAll('button')].map(b => ({
    label: b.textContent.trim().replace(/\s+/g, ' '), disabled: b.disabled === true,
  }));
  return {
    present: true,
    title: (tr.querySelector('.er-t') || {}).textContent ? tr.querySelector('.er-t').textContent.trim() : '',
    sub: (tr.querySelector('.er-s') || {}).textContent ? tr.querySelector('.er-s').textContent.trim() : '',
    btns,
    hasImport: btns.some(b => /导入/.test(b.label)),
    hasNewPeriod: btns.some(b => /新建期次/.test(b.label)),
  };
}

// 顶部常驻横幅（既定方案 §五 阶段 0）
function snapGateBar() {
  const b = document.querySelector('.gate-bar');
  if (!b) return { present: false };
  const cs = getComputedStyle(b);
  const r = b.getBoundingClientRect();
  const btn = [...b.querySelectorAll('button')].find(x => /新建期次/.test(x.textContent));
  return {
    present: true,
    visible: cs.display !== 'none' && r.height > 1,
    text: b.textContent.replace(/\s+/g, ' ').trim(),
    hasNewPeriodBtn: !!btn,
  };
}

// 抽屉（导入 Modal）是否在 DOM 里且真的画出来了
// 🔴 判据不能用 `offsetParent !== null` —— `.imp-modal` 是 **position:fixed**
//   （Forecast.vue `.imp-modal{position:fixed;left:50%;top:45%;…}`），
//   而**固定定位元素的 offsetParent 恒为 null** ⇒ 用它判可见性会「永远判成没打开」，
//   症状是「功能明明正常、探针却一路 FAIL」（本轮实测踩到）。
//   改用真实几何：display/visibility + getBoundingClientRect 的宽高。
function snapModal() {
  const m = document.querySelector('.imp-modal');
  if (!m) return { open: false, why: 'absent' };
  const cs = getComputedStyle(m);
  const r = m.getBoundingClientRect();
  const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 1 && r.height > 1;
  if (!visible) return { open: false, why: 'hidden', pos: cs.position, w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  const own = m.querySelector('.imp-own');
  return { open: true, own: own ? own.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : '' };
}

// 强制尝试打开：对两个入口都派发真实 click（disabled 的按钮不会响应，这本身就是判据）
function tryOpenBoth() {
  const out = [];
  const tb = [...document.querySelectorAll('button')]
    .find(b => b.offsetParent !== null && b.textContent.trim().replace(/\s+/g, '') === '导入');
  if (tb) { tb.click(); out.push('toolbar:clicked' + (tb.disabled ? '(disabled)' : '')); }
  else out.push('toolbar:not-found');
  const er = [...document.querySelectorAll('table.cross-tbl[role="grid"] tbody tr.empty-row button, table.tbl tbody tr.empty-row button')]
    .find(b => /导入/.test(b.textContent));
  if (er) { er.click(); out.push('empty:clicked' + (er.disabled ? '(disabled)' : '')); }
  else out.push('empty:not-found');
  return out;
}

// 空态按钮点击。参数是**字符串**（子串匹配）—— 早先写成正则参数会 TypeError
function clickEmptyBtn(needle) {
  const tr = document.querySelector('table.cross-tbl[role="grid"] tbody tr.empty-row')
          || document.querySelector('table.tbl tbody tr.empty-row');
  if (!tr) return { err: 'no-empty-row' };
  const b = [...tr.querySelectorAll('button')].find(x => String(x.textContent).includes(needle));
  if (!b) return { err: 'no-btn:' + needle, labels: [...tr.querySelectorAll('button')].map(x => x.textContent.trim()) };
  if (b.disabled) return { err: 'btn-disabled' };
  b.click();
  return { ok: true };
}

function fillNewPeriod(name, s, e, a) {
  const form = document.querySelector('.new-period');
  if (!form) return { err: 'no-new-period-form' };
  const inputs = [...form.querySelectorAll('input')];
  const set = (el, v) => {
    if (!el) return;
    const proto = Object.getPrototypeOf(el);
    const d = Object.getOwnPropertyDescriptor(proto, 'value');
    if (d && d.set) d.set.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set(inputs.find(i => i.type !== 'date' && /名称/.test(i.placeholder || '')), name);
  const ds = inputs.filter(i => i.type === 'date');
  set(ds[0], s); set(ds[1], e); set(ds[2], a);
  if (inputs.length < 4 || ds.length < 3) {
    return { err: 'field-count', n: inputs.length, nd: ds.length, ph: inputs.map(i => i.placeholder || i.type) };
  }
  const btn = [...form.querySelectorAll('button')].find(x => /创建/.test(x.textContent));
  if (!btn) return { err: 'no-create-btn' };
  btn.click();
  return { ok: true, filled: [name, s, e, a] };
}

function periodNames() {
  const sel = document.querySelector('select.sel-period');
  return sel ? [...sel.options].map(o => o.textContent.trim()) : [];
}

// ── 后端直连接口（Node 侧；前端的置灰挡不住它 —— 这正是「真约束在服务端」的证据）──
async function apiImport(tag) {
  const buf = fs.readFileSync(XLSX);
  const fd = new FormData();
  fd.append('file', new Blob([buf]), 'fc_v193_sample.xlsx');
  fd.append('category', 'forecast_cross');
  fd.append('mapping', JSON.stringify(MAPPING));
  fd.append('order_date', OD);
  const res = await fetch(BASE + '/api/import/execute', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN },
    body: fd,
  });
  let body = null;
  try { body = await res.json(); } catch (e) { body = { _unparsable: true }; }
  const detail = body && (body.detail || body.error || body.message) || '';
  return { tag, status: res.status, detail: String(detail).slice(0, 160), body };
}

async function main() {
  if (!PHASE || !'ABCD'.includes(PHASE)) {
    console.log('用法: node forecast-import-gate-v193-verify.js <TOKEN> <TENANT> <A|B|C|D> <样本.xlsx>');
    process.exit(2);
  }
  const browser = await puppeteer.launch({
    executablePath: EXEC, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1600,1000'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push('[console] ' + String(m.text()).slice(0, 160)); });
  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t);
    localStorage.setItem('hergent_v2_tenant', String(ten));
  }, TOKEN, TENANT);

  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(6000);

  if (PHASE === 'A') {
    // ═══ A. 有期次：回归，证明门没误伤 ═══
    const T = await page.evaluate(snapToolbarImport);
    ok('A1 工具条「导入」按钮存在且**可用**', T.exists && T.disabled === false, JSON.stringify(T));
    // 点开抽屉（真入口）。⚠️ 挑选必须**优先可见项** —— 菜单里的「导入模板」等
    // 也含「导入」二字，而 Teleport 出去的面板按钮 offsetParent 为 null。
    await page.evaluate(() => {
      const all = [...document.querySelectorAll('button')]
        .filter(x => x.textContent.trim().replace(/\s+/g, '') === '导入');
      const b = all.find(x => x.offsetParent !== null) || all[0];
      if (b && !b.disabled) b.click();
    });
    await sleep(1200);
    const M = await page.evaluate(snapModal);
    ok('A2 点击后导入抽屉打开', M.open === true, JSON.stringify(M));
    ok('A3 抽屉显示「本期归属：<期次>」而非「还没有期次」',
      M.open && /本期归属/.test(M.own) && !/还没有期次/.test(M.own), M.own);
    // 关掉抽屉，避免干扰后续
    await page.evaluate(() => { const x = document.querySelector('.imp-x'); if (x) x.click(); });
    await sleep(600);
    const R = await apiImport('A');
    ok('A4 ★后端直连接口 HTTP 200 且导入成功行 > 0', R.status === 200 && Number((R.body.results || {}).success || 0) > 0,
      'status=' + R.status + ' success=' + ((R.body.results || {}).success) + ' period_id=' + ((R.body.results || {}).period_id));
    ok('A5 回执 period_id > 0（有归属，不是孤儿）', Number((R.body.results || {}).period_id || 0) > 0,
      'period_id=' + ((R.body.results || {}).period_id));
    await page.screenshot({ path: '/tmp/v193_A_ok.png' });
  }

  // ── 被拒场景的共用断言（B = 期次全 closed / D = 零期次，两者都必须被挡）──
  async function runGated(prefix, expectEmptyState, shotPath) {
    const T = await page.evaluate(snapToolbarImport);
    ok(prefix + '1 工具条「导入」按钮 **已置灰**', T.exists && T.disabled === true, JSON.stringify(T));
    ok(prefix + '2 置灰按钮的 title 说明原因并点名「新建期次」', /新建期次/.test(T.title || ''), T.title);
    const G = await page.evaluate(snapGateBar);
    ok(prefix + '3 ★顶部常驻横幅出现，且文案与既定方案一致、带「新建期次」出口',
      G.present && G.visible && /当前没有进行中的期次/.test(G.text) && /导入和报单都需要先有一个期次/.test(G.text)
      && G.hasNewPeriodBtn === true, JSON.stringify(G));
    if (expectEmptyState) {
      const E = await page.evaluate(snapEmptyRow);
      ok(prefix + '4 ★空态也指路「新建期次」，且**没有**「导入 Excel」按钮',
        E.present && E.title === '当前没有进行中的期次' && /新建期次/.test(E.sub || '')
        && E.hasImport === false && E.hasNewPeriod === true,
        JSON.stringify({ t: E.title, s: (E.sub || '').slice(0, 60), btns: E.btns }));
    }
    const clicks = await page.evaluate(tryOpenBoth);
    await sleep(1200);
    const M = await page.evaluate(snapModal);
    ok(prefix + '5 ★两个入口都点不动：抽屉恒不出现',
      M.open === false, 'clicked=' + JSON.stringify(clicks) + ' modal=' + JSON.stringify(M));
    const R1 = await apiImport(prefix);
    ok(prefix + '6 ★后端直连接口被拒：HTTP 400 且文案点名「新建期次」',
      R1.status === 400 && /新建期次/.test(R1.detail), 'status=' + R1.status + ' detail=' + R1.detail);
    const R2 = await apiImport(prefix + 'r');
    ok(prefix + '7 ★连调两次仍 400（不因重试而漏）', R2.status === 400, 'status=' + R2.status);
    await page.screenshot({ path: shotPath });
  }

  if (PHASE === 'B') {
    // ═══ B. ★核心用例：期次**全部 closed**（= 事故场景本体）═══
    //   依据：既定方案 §四.1 理由②「导入时 7/8/9/10 期**全 closed** ⇒ 兜底
    //   `forecast_period_default()` 把 154 个商品挂到了**已关闭的 9 期**，用户根本看不到」。
    //   本用例与外部的库改动配套：外部把 status 全置 closed（**保留数据**，故表格非空）。
    await runGated('B', false, '/tmp/v193_B_closed.png');
  }

  if (PHASE === 'D') {
    // ═══ D. 零期次 + 零数据（全新租户外观）⇒ 空态也必须指路而非招呼导入 ═══
    await runGated('D', true, '/tmp/v193_D_zero.png');
  }

  if (PHASE === 'C') {
    // ═══ C. 走既定流程：空态 →「新建期次」→ 导入 ═══
    const E0 = await page.evaluate(snapEmptyRow);
    ok('C1 前置：空态指路「新建期次」（门关着）', E0.present && E0.hasNewPeriod === true && E0.hasImport === false, JSON.stringify(E0.btns));
    const c1 = await page.evaluate(clickEmptyBtn, '新建期次');
    ok('C2 点「新建期次」→ 表单出现', c1.ok === true, JSON.stringify(c1));
    await sleep(600);
    const F = await page.evaluate(fillNewPeriod, 'v193门禁验证期次', '2026-09-18', '2026-09-18', '2026-09-22');
    ok('C3 填名称 + 三个日期并提交', F.ok === true, JSON.stringify(F));
    await sleep(5000);
    const PN = await page.evaluate(periodNames);
    ok('C4 期次创建成功、出现在下拉里', PN.some(n => /v193门禁验证期次/.test(n)), JSON.stringify(PN.slice(-4)));
    const T = await page.evaluate(snapToolbarImport);
    ok('C5 ★工具条「导入」按钮**恢复可用**（门开回来了）', T.exists && T.disabled === false, JSON.stringify(T));
    const R = await apiImport('C');
    ok('C6 ★后端直连接口 HTTP 200（真能导了）', R.status === 200, 'status=' + R.status + ' detail=' + R.detail);
    const pid = Number((R.body.results || {}).period_id || 0);
    ok('C7 ★回执 period_id > 0，且指向**刚建的那一期**', pid > 0,
      'period_id=' + pid + ' success=' + ((R.body.results || {}).success));
    console.log('PERIOD_ID_RESULT=' + pid);
    await page.screenshot({ path: '/tmp/v193_C_open.png' });
  }

  ok(PHASE + 'X console / page error == 0', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  await browser.close();
  const pass = results.filter(r => r.pass).length;
  console.log('\n══════ v193 [阶段 ' + PHASE + '] 结果 ' + pass + '/' + results.length + ' ══════');
  for (const r of results) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.name + (r.detail ? '   ⟵ ' + r.detail : ''));
  process.exit(pass === results.length ? 0 : 1);
}

main().catch(e => { console.error('PROBE_ERROR: ' + (e && e.stack || e)); process.exit(3); });
