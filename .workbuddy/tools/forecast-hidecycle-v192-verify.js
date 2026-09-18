// v192 沙箱真机：「到货周期」由「固定列 = 不可隐藏」改为 **可隐藏**（用户诉求原文：
//   「请把"到货周期"设置成可隐藏列」）。
//
// 🔴 本轮改动是**纯 UI 层**（列显隐只写 localStorage `forecast_cols_v1`，一个字节都不落库），
//   但仍然走隔离沙箱 —— 因为探针要对生产站点发真实请求，且要切期次、进改单。
//
// 改动的四条（Forecast.vue）：
//   ① frozenLeftOf / frozenRight 改按**实际渲染的固定列**累加（隐藏的固定列不再占位）
//   ② MASTER_COL_DEFS 的到货周期条目加 `hideable: true`
//   ③ isLockedCol 认 `hideable`（固定列**默认**仍不可隐藏，只对它开口）
//   ④ canDeleteMaster 尊重内置列的 `deletable:false`（堵掉「右键删列→刷新复活」的死路）
//   （另有改单态列设置菜单改读 isLockedCol —— 与查看态同源，本轮**行为中性**，见交付说明）
//
// 用法: NODE_PATH=<managed workspace>/node_modules node forecast-hidecycle-v192-verify.js <TOKEN> <TENANT=9997>
//
// 判据总览：
//   A 基线（什么都没隐藏）：列在、紧跟商品名称、sticky、left == 序号宽+商品名称宽（**与改动前逐字相同**）
//   B 列设置菜单（查看态）：到货周期复选框**可用**；对照「商品名称」仍 locked+disabled（没把整组放开）
//   C 勾掉复选框 → 只读表表头/表体都没有它；冻结区**不留空缺**（商品名称 left 回到序号宽）；localStorage 落 vis=false
//   D 【判别点】手动冻结列（冻结列下拉选「厂家编码」）的 left 跟随收缩：
//       到货周期可见时 = 序号+名称+到货周期；隐藏后必须 = 序号+名称（旧实现恒含到货周期 ⇒ 留 92px 空缺）
//   E 右键菜单两个入口一致：「隐藏此列」在且可用；**「删除列」不再出现**（对照「品牌」仍有删除列）
//   F 隐藏**持久**：刷新后仍隐藏（不被 loadCols 的「合并新增主档列」复活）；再勾回来位置复原
//   G 改单态：编辑网格同样没有该列；改单态列设置菜单的锁定判定与查看态一致
//   H 全程 console/page error == 0
const puppeteer = require('puppeteer-core');
const TOKEN = process.argv[2];
const TENANT = process.argv[3] || '9997';
const EXEC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://hergent.cn';
const CYC = '到货周期';
const NAME = '商品名称';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });

// ── 页面内取数（page.evaluate 只序列化函数自身 ⇒ helper 必须内联）──
const READ_TBL = `[...document.querySelectorAll('table.cross-tbl')].find(tb => tb.getAttribute('role') === 'grid')`;

function snapViewHead() {
  const t = [...document.querySelectorAll('table.cross-tbl')].find(tb => tb.getAttribute('role') === 'grid');
  if (!t) return { err: 'no-view-table' };
  const cols = [...t.querySelectorAll('colgroup col')].map(c => {
    const m = /width:\s*([\d.]+)px/.exec(c.getAttribute('style') || '');
    return m ? +m[1] : null;
  });
  const ths = [...t.querySelectorAll('thead th')].map(th => {
    const sp = th.querySelector('.th-in span');
    const cs = getComputedStyle(th);
    return {
      label: sp ? sp.textContent.trim() : (th.classList.contains('seq-th') || th.querySelector('.gear') ? '[序号]' : ''),
      cls: String(th.className),
      pos: cs.position,
      inlineLeft: th.style.left || '',
      rectLeft: +th.getBoundingClientRect().left.toFixed(1),
    };
  });
  return {
    cols, ths,
    cycleCells: t.querySelectorAll('tbody td.fc-cycle').length,
    rowCount: t.querySelectorAll('tbody tr.data-row').length,
  };
}
// 打开列设置（两态共用同一个 gear 按钮类）
function openColMenu() {
  const b = [...document.querySelectorAll('button.col-cfg.gear')].find(x => x.offsetParent !== null);
  if (!b) return false;
  b.click(); return true;
}
function closeColMenu() {
  const x = [...document.querySelectorAll('.col-menu-x')].find(b => b.offsetParent !== null);
  if (x) { x.click(); return true; }
  const o = [...document.querySelectorAll('.col-menu-overlay')].filter(x => x.offsetParent !== null).pop();
  if (o) { o.click(); return true; }
  return false;
}
function snapColMenu() {
  const m = [...document.querySelectorAll('.col-menu')].find(x => x.offsetParent !== null);
  if (!m) return { err: 'no-menu' };
  const lis = [...m.querySelectorAll('.col-menu-list > li')].map(li => {
    const lab = li.querySelector('label');
    const cb = li.querySelector('input[type=checkbox]');
    return {
      label: lab ? lab.textContent.trim() : '',
      locked: li.classList.contains('locked'),
      hidden: li.classList.contains('hidden'),
      draggable: li.getAttribute('draggable'),
      disabled: !!(cb && cb.disabled),
      checked: !!(cb && cb.checked),
    };
  });
  const sel = m.querySelector('select[aria-label="冻结列"]');
  return { mode: m.classList.contains('edit-col-menu') ? 'edit' : 'view', lis, frozenOpt: sel ? sel.value : null };
}
function clickMenuCheckbox(label) {
  const m = [...document.querySelectorAll('.col-menu')].find(x => x.offsetParent !== null);
  if (!m) return { err: 'no-menu' };
  const li = [...m.querySelectorAll('.col-menu-list > li')].find(x => {
    const l = x.querySelector('label');
    return l && l.textContent.trim() === label;
  });
  if (!li) return { err: 'no-item:' + label };
  const cb = li.querySelector('input[type=checkbox]');
  if (!cb) return { err: 'no-cb' };
  if (cb.disabled) return { err: 'disabled' };
  cb.click();
  return { ok: true };
}
function setFreezeSelect(v) {
  const m = [...document.querySelectorAll('.col-menu')].find(x => x.offsetParent !== null);
  if (!m) return { err: 'no-menu' };
  const sel = m.querySelector('select[aria-label="冻结列"]');
  if (!sel) return { err: 'no-select' };
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, String(v));
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
}
function rightClickCol(label) {
  // 🔴 表头右键菜单（`.ctx-menu`）整块挂在**编辑态分支**下（祖先链 activeTab=summary → viewMode=cross →
  //   <div v-else>），查看态右键**处理器会执行但菜单不渲染**（实测 defaultPrevented=true、.ctx-menu 数=0）
  //   ⇒ 本函数只在改单态有意义；选表时挑「可见且有 thead」的那张，两态通用。
  const t = [...document.querySelectorAll('table.cross-tbl')].find(tb => tb.offsetParent !== null && tb.querySelector('thead'));
  if (!t) return { err: 'no-table' };
  const th = [...t.querySelectorAll('thead th')].find(x => {
    const sp = x.querySelector('.th-in span');
    return sp && sp.textContent.trim() === label;
  });
  if (!th) return { err: 'no-th:' + label };
  const r = th.getBoundingClientRect();
  const ev = new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, button: 2, buttons: 2,
    clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
  });
  th.dispatchEvent(ev);
  // defaultPrevented=true = 处理器真的跑了（@contextmenu.prevent）；false = 事件根本没到 handler
  return { ok: true, prevented: ev.defaultPrevented };
}
function snapCtxMenu() {
  const m = document.querySelector('.ctx-menu');
  if (!m) return { err: 'no-ctx' };
  return {
    items: [...m.querySelectorAll('button')].map(b => (b.textContent || '').trim()),
    notes: [...m.querySelectorAll('.ctx-note')].map(n => (n.textContent || '').trim()),
  };
}
function clickCtxItem(text) {
  const m = document.querySelector('.ctx-menu');
  if (!m) return { err: 'no-ctx' };
  const b = [...m.querySelectorAll('button')].find(x => (x.textContent || '').trim() === text);
  if (!b) return { err: 'no-item:' + text };
  b.click(); return { ok: true };
}
function readColVis() {
  try {
    const p = JSON.parse(localStorage.getItem('forecast_cols_v1') || '{}');
    return { vis: p.vis || {}, order: (p.order || []).map(c => c.key) };
  } catch (e) { return { err: String(e) }; }
}
function countEditRows() {
  const t = [...document.querySelectorAll('table.cross-tbl.edit-tbl')].find(x => x.offsetParent !== null);
  return t ? t.querySelectorAll('tbody tr').length : 0;
}
function snapEditHead() {
  const t = [...document.querySelectorAll('table.cross-tbl.edit-tbl')].find(x => x.offsetParent !== null && x.querySelector('thead'));
  if (!t) return { err: 'no-edit-table' };
  return { ths: [...t.querySelectorAll('thead th')].map(th => (th.textContent || '').trim().slice(0, 14)) };
}

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-proxy-server', '--window-size=1800,1150'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1800, height: 1150 });
  const pageErrors = [], regStatus = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push('CONSOLE: ' + m.text()); });
  // 列注册表是否真加载成功（canDeleteMaster 的 registryOk 分支取决于它）
  page.on('response', r => {
    if (r.url().includes('/api/forecast/columns') && !r.url().includes('/api/forecast/columns/')) regStatus.push(r.status());
  });
  /* 沙箱的 `POST /api/products/bulk-upsert` 会超 20s 被前端 abort（沙箱库特性，本轮没碰它）
     ⇒ 只回壳放行，让「改单」能顺利进入；其余请求一律真发。 */
  await page.setRequestInterception(true);
  page.on('request', r => {
    if (r.url().includes('/api/products/bulk-upsert')) {
      return r.respond({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, inserted: 0, updated: 0, skipped: 0 }),
      }).catch(() => {});
    }
    return r.continue().catch(() => {});
  });
  await page.evaluateOnNewDocument((t, ten) => {
    localStorage.setItem('hergent_v2_token', t);
    localStorage.setItem('hergent_v2_tenant', String(ten));
  }, TOKEN, TENANT);

  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', { waitUntil: 'networkidle2', timeout: 60000 });
  ok('A0 未被踢回登录页', !/#\/login/.test(page.url()), page.url());
  await page.waitForSelector('table.tbl', { timeout: 30000 }).catch(() => {});
  await sleep(3500);

  // 挑一个「只读表真有行」的期次（空期次 → 表可能不渲染，断言会全空转）
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
    await setPeriod(v); await sleep(2600);
    const n = await page.evaluate(() => {
      const t = Array.from(document.querySelectorAll('table.tbl'))
        .find(x => !x.classList.contains('edit-tbl') && x.offsetParent !== null);
      return t ? t.querySelectorAll('tbody tr.data-row').length : 0;
    });
    if (n > 0) { chosen = String(v); roRows = n; break; }
  }
  ok('A1 找到有报单行的期次', roRows > 0, 'period=' + chosen + ' rows=' + roRows + ' opts=' + JSON.stringify(opts));

  // ═══ A. 基线：什么都没隐藏，渲染必须与改动前逐字相同 ═══
  let A = await page.evaluate(snapViewHead);
  if (A.err) { ok('A 只读汇总表存在', false, A.err); await browser.close(); report(); return; }
  const idxOf = (snap, label) => snap.ths.findIndex(x => x.label === label);
  let seqI = idxOf(A, '[序号]'), nmI = idxOf(A, NAME), cyI = idxOf(A, CYC);
  ok('A2 「到货周期」在列中', cyI >= 0, 'idx=' + cyI + ' 可见列=' + A.ths.length);
  ok('A3 位置紧跟「商品名称」', nmI >= 0 && cyI === nmI + 1, `${NAME}=${nmI} ${CYC}=${cyI}`);
  const baseLeft = (A.cols[seqI] || 0) + (A.cols[nmI] || 0);
  ok('A4 表头 sticky + .frozen', A.ths[cyI] && A.ths[cyI].pos === 'sticky' && /frozen/.test(A.ths[cyI].cls),
    A.ths[cyI] ? A.ths[cyI].pos + ' | ' + A.ths[cyI].cls : 'n/a');
  ok('A5 left == 序号宽+商品名称宽（与改动前逐字相同）',
    Math.abs(parseFloat(A.ths[cyI].inlineLeft) - baseLeft) < 0.6,
    `inline=${A.ths[cyI].inlineLeft} expect=${baseLeft}（col ${A.cols[seqI]}+${A.cols[nmI]}）`);
  ok('A6 表体有该列单元格', A.cycleCells > 0, 'td.fc-cycle=' + A.cycleCells);

  // ═══ B. 列设置菜单（查看态）：复选框可用 ═══
  await page.evaluate(openColMenu); await sleep(600);
  let B = await page.evaluate(snapColMenu);
  ok('B1 列设置菜单打开（查看态）', !B.err && B.mode === 'view', B.err || B.mode);
  const item = l => (B.lis || []).find(x => x.label === l) || {};
  ok('B2 「到货周期」复选框**可用**（本轮诉求）', item(CYC).disabled === false, 'disabled=' + item(CYC).disabled);
  ok('B3 「到货周期」不再是 locked 态', item(CYC).locked === false, 'locked=' + item(CYC).locked);
  ok('B4 「到货周期」可拖拽', item(CYC).draggable === 'true', 'draggable=' + item(CYC).draggable);
  // 对照：没把整组固定列放开
  ok('B5 对照「商品名称」仍 locked + 复选框 disabled', item(NAME).locked === true && item(NAME).disabled === true,
    `locked=${item(NAME).locked} disabled=${item(NAME).disabled}`);
  ok('B6 对照「品牌」本就可用', item('品牌').disabled === false, 'disabled=' + item('品牌').disabled);
  await page.screenshot({ path: '/tmp/v192_menu_open.png' });

  // ═══ C. 勾掉复选框 → 隐藏生效且冻结区不留空缺 ═══
  const cClick = await page.evaluate(clickMenuCheckbox, CYC);
  await sleep(900);
  await page.evaluate(closeColMenu); await sleep(900);
  let C = await page.evaluate(snapViewHead);
  ok('C0 复选框点击被接受（非 disabled）', cClick.ok === true, JSON.stringify(cClick));
  ok('C1 只读表表头已无「到货周期」', C.err ? false : idxOf(C, CYC) < 0, C.err || 'ths=' + C.ths.length);
  ok('C2 表体也无该列单元格', C.err ? false : C.cycleCells === 0, 'td.fc-cycle=' + (C.err ? 'n/a' : C.cycleCells));
  const nmLeftHidden = C.err ? NaN : parseFloat((C.ths[idxOf(C, NAME)] || {}).inlineLeft);
  ok('C3 冻结区**无空缺**：商品名称 left 回到「序号宽」', Math.abs(nmLeftHidden - (C.cols[seqI] || 0)) < 0.6,
    `name.left=${nmLeftHidden} expect=${C.cols[seqI]}`);
  const visC = await page.evaluate(readColVis);
  ok('C4 localStorage 落 vis=false（持久化的依据）', visC.vis && visC.vis.arrival_lead_days === false,
    JSON.stringify({ vis: visC.vis['arrival_lead_days'], orderHead: (visC.order || []).slice(0, 3) }));

  // ═══ D. 【判别点】手动冻结列的 left 跟随收缩（frozenRight 不再算被隐藏的列）═══
  // 先恢复显示，再在菜单里把「冻结列」下拉设为「厂家编码」（查看态的手动冻结通道，走 frozenRight()）
  await page.evaluate(openColMenu); await sleep(500);
  await page.evaluate(clickMenuCheckbox, CYC); await sleep(600);
  await page.evaluate(setFreezeSelect, 'product_code'); await sleep(600);
  await page.evaluate(closeColMenu); await sleep(1000);
  let D1 = await page.evaluate(snapViewHead);
  const pcI1 = D1.err ? -1 : idxOf(D1, '厂家编码');
  const expFull = (D1.cols[seqI] || 0) + (D1.cols[nmI] || 0) + (D1.cols[cyI] || 0);
  ok('D1 恢复显示后到货周期回到原位', pcI1 >= 0 && Math.abs(parseFloat(D1.ths[cyI].inlineLeft) - baseLeft) < 0.6,
    'cycle.left=' + (D1.ths[cyI] || {}).inlineLeft + ' expect=' + baseLeft);
  ok('D2 手动冻结列 left == 序号+名称+到货周期', pcI1 >= 0 && Math.abs(parseFloat(D1.ths[pcI1].inlineLeft) - expFull) < 0.6,
    `厂家编码.left=${pcI1 >= 0 ? D1.ths[pcI1].inlineLeft : 'n/a'} expect=${expFull}`);
  // 再隐藏 → 期望收缩掉「到货周期」那一份宽度
  await page.evaluate(openColMenu); await sleep(500);
  await page.evaluate(clickMenuCheckbox, CYC); await sleep(600);
  await page.evaluate(closeColMenu); await sleep(1000);
  let D2 = await page.evaluate(snapViewHead);
  const pcI2 = D2.err ? -1 : idxOf(D2, '厂家编码');
  const pcLeft2 = pcI2 >= 0 ? parseFloat(D2.ths[pcI2].inlineLeft) : NaN;
  ok('D3 ★判别点：隐藏后手动冻结列收缩到「序号+名称」（旧实现会停在 +到货周期 处留空缺）',
    Math.abs(pcLeft2 - baseLeft) < 0.6,
    `厂家编码.left=${pcLeft2} expect=${baseLeft}（旧实现恒为 ${expFull}）`);
  ok('D4 同时该列仍在、且到货周期确实没了', pcI2 >= 0 && idxOf(D2, CYC) < 0, `pc=${pcI2} cycle=${idxOf(D2, CYC)}`);

  // ═══ E. 进入改单态（表头右键菜单只挂在编辑态 ⇒ 右键验证必须在改单态做）═══
  // D 段结束时该列是隐藏的、且「手动冻结」还开着 ⇒ 先复位，否则右键找不到表头
  await page.evaluate(openColMenu); await sleep(600);
  await page.evaluate(setFreezeSelect, 'none'); await sleep(500);
  await page.evaluate(clickMenuCheckbox, CYC); await sleep(900);
  await page.evaluate(closeColMenu); await sleep(900);
  const E0 = await page.evaluate(snapViewHead);
  ok('E0 复位后该列回到基线（可见 + left 256）',
    E0.err === undefined && Math.abs(parseFloat(E0.ths[idxOf(E0, CYC)].inlineLeft) - baseLeft) < 0.6,
    E0.err || 'left=' + (E0.ths[idxOf(E0, CYC)] || {}).inlineLeft);
  const entered = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find(x => /改单/.test(x.textContent) && !/取消/.test(x.textContent) && x.offsetParent !== null);
    if (!b) return false; b.click(); return true;
  });
  await sleep(5500);
  const editRows = await page.evaluate(countEditRows);
  ok('E1 已进入改单态', entered && editRows > 0, 'rows=' + editRows);

  // ═══ F. 改单态表头右键：两个入口一致 ═══
  const rc = await page.evaluate(rightClickCol, CYC);
  await sleep(600);
  let Fm = await page.evaluate(snapCtxMenu);
  ok('F1 右键「到货周期」表头弹出菜单（处理器确实执行）', rc.ok === true && rc.prevented === true && !Fm.err,
    JSON.stringify(rc) + ' ' + (Fm.err || ''));
  ok('F2 菜单含「隐藏此列」（入口可用）', !Fm.err && (Fm.items || []).some(x => x === '隐藏此列'),
    JSON.stringify((Fm.items || []).filter(x => /隐藏|删除|固定/.test(x))));
  ok('F3 ★「删除列」不再出现（堵掉「删了刷新复活」的死路）',
    !Fm.err && !(Fm.items || []).some(x => x === '删除列'),
    'items=' + JSON.stringify((Fm.items || []).filter(x => /隐藏|删除|固定/.test(x))));
  ok('F4 冻结项仍是状态说明而非假旋钮', !Fm.err && (Fm.notes || []).some(x => x.includes('固定列')),
    JSON.stringify(Fm.notes));
  const fHide = await page.evaluate(clickCtxItem, '隐藏此列');
  await sleep(1200);
  const EHh = await page.evaluate(snapEditHead);
  ok('F5 走右键「隐藏此列」同样生效（第二条入口）',
    fHide.ok === true && !EHh.err && !(EHh.ths || []).some(x => x === CYC),
    JSON.stringify(fHide) + ' ths=' + JSON.stringify((EHh.ths || []).slice(0, 6)));
  // 对照：普通可删列仍有「删除列」
  const rcBrand = await page.evaluate(rightClickCol, '品牌');
  await sleep(600);
  let Fc = await page.evaluate(snapCtxMenu);
  ok('F6 对照「品牌」仍有「删除列」（证明否决只作用内置不可删列）',
    rcBrand.ok === true && !Fc.err && (Fc.items || []).some(x => x === '删除列'),
    JSON.stringify((Fc.items || []).filter(x => /删除/.test(x))));
  await page.evaluate(() => { const o = document.querySelector('.ctx-overlay'); if (o) o.click(); }).catch(() => {});
  await sleep(800);

  // ═══ G. 改单态：网格同步 + 列设置菜单判定与查看态同源 ═══
  const EH2 = await page.evaluate(snapEditHead);
  ok('G1 编辑网格也没有「到货周期」（两表同源）', !EH2.err && !(EH2.ths || []).some(x => x === CYC),
    EH2.err || JSON.stringify((EH2.ths || []).slice(0, 6)));
  await page.evaluate(openColMenu); await sleep(800);
  const GM = await page.evaluate(snapColMenu);
  const gItem = l => (GM.lis || []).find(x => x.label === l) || {};
  ok('G2 改单态列设置菜单打开', !GM.err && GM.mode === 'edit', GM.err || GM.mode);
  ok('G3 改单态下「到货周期」复选框可用、非 locked（与查看态同源）',
    gItem(CYC).disabled === false && gItem(CYC).locked === false,
    `disabled=${gItem(CYC).disabled} locked=${gItem(CYC).locked}`);
  ok('G4 改单态下「商品名称」仍 locked + disabled',
    gItem(NAME).locked === true && gItem(NAME).disabled === true,
    `locked=${gItem(NAME).locked} disabled=${gItem(NAME).disabled}`);
  await page.evaluate(clickMenuCheckbox, CYC); await sleep(1400);
  await page.evaluate(closeColMenu); await sleep(1200);
  const EH3 = await page.evaluate(snapEditHead);
  ok('G5 勾回来后编辑网格立刻恢复该列（隐藏不是「删数据」）',
    !EH3.err && (EH3.ths || []).some(x => x === CYC), EH3.err || JSON.stringify((EH3.ths || []).slice(0, 6)));

  // ═══ H. 隐藏是持久的（不被 loadCols 的「合并新增主档列」复活）═══
  await page.evaluate(openColMenu); await sleep(600);
  await page.evaluate(clickMenuCheckbox, CYC); await sleep(1200);   // 再隐藏
  await page.evaluate(closeColMenu); await sleep(900);
  const beforeReload = await page.evaluate(readColVis);
  ok('H0 刷新前 localStorage 已记为隐藏', beforeReload.vis && beforeReload.vis.arrival_lead_days === false,
    String(beforeReload.vis && beforeReload.vis.arrival_lead_days));
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(4500);
  if (chosen) { await setPeriod(chosen); await sleep(2800); }
  let H = await page.evaluate(snapViewHead);
  ok('H1 ★刷新后仍隐藏（未被自动补回）', H.err === undefined && idxOf(H, CYC) < 0,
    H.err || 'cycleIdx=' + idxOf(H, CYC) + ' ths=' + H.ths.length);
  ok('H2 刷新后冻结区仍无空缺', H.err === undefined &&
    Math.abs(parseFloat((H.ths[idxOf(H, NAME)] || {}).inlineLeft) - (H.cols[seqI] || 0)) < 0.6,
    H.err || 'name.left=' + (H.ths[idxOf(H, NAME)] || {}).inlineLeft);
  // 复原：勾回来 → 位置与基线一致（可逆）
  await page.evaluate(openColMenu); await sleep(700);
  await page.evaluate(clickMenuCheckbox, CYC); await sleep(1000);
  await page.evaluate(closeColMenu); await sleep(1000);
  let H3 = await page.evaluate(snapViewHead);
  ok('H3 勾回来后位置与基线一致（可逆、零残留）',
    H3.err === undefined && idxOf(H3, CYC) === idxOf(H3, NAME) + 1 &&
    Math.abs(parseFloat(H3.ths[idxOf(H3, CYC)].inlineLeft) - baseLeft) < 0.6,
    H3.err || `idx=${idxOf(H3, CYC)} left=${H3.ths[idxOf(H3, CYC)] ? H3.ths[idxOf(H3, CYC)].inlineLeft : 'n/a'} expect=${baseLeft}`);

  // ═══ I. 零错误 ═══
  ok('I1 console / page error == 0', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  ok('I2 列注册表接口 200（canDeleteMaster 走服务端注册表分支才有效）',
    regStatus.length > 0 && regStatus.every(s => s === 200), JSON.stringify(regStatus));
  await page.screenshot({ path: '/tmp/v192_restored.png' });

  await browser.close();
  report();

  function report() {
    const pass = results.filter(r => r.pass).length;
    console.log('\n══════════ v192 结果 ══════════');
    for (const r of results) if (!r.pass) console.log('✗ ' + r.name + '   ' + r.detail);
    for (const r of results) if (r.pass) console.log('  ✓ ' + r.name + (r.detail ? '   ' + r.detail : ''));
    console.log(`\n总计 ${pass}/${results.length}`);
    process.exit(pass === results.length ? 0 : 1);
  }
})().catch(e => { console.log('FATAL ' + e.stack); process.exit(2); });
