// v209 真机验收：全屏态「改单 / 编辑组」进驻表格工具行（生产 hergent.cn）
//
// 用户诉求（原话）：
//   ①「将『改单』按钮及其点击后弹出的所有功能按钮统一移动到表格工具栏中，使改单及改单后出现的
//      功能按钮能够在一屏内完整展示，同时确保工具栏内所有内容仅占一行，不出现横向滚动条。」
//   ②（澄清）「因为用户大概率会用全屏功能来查看和修改预报订单，所以要把这些按钮放在表格工具栏，
//      便于用户在全屏模式下直接操作，不需要退出全屏模式才能进行操作。」
//   ⇒ 采「方案 A：全屏专属」（非全屏落点实测放不下，见 artifacts/预报页-改单按钮全屏落点评估-2026-09-20.md）
//
// 🔴 本探针**绝不点「保存」**：saveEdits() 没有「无改动就短路」分支，点下去 = 真实生产写入 +
//    一条「实际什么都没改」的save_changes 假记录。生产环境不跑写入型冒烟。
//    进出编辑态走「改单 → 取消」，与保存共用同一个 leaveEdit() 收口（离线护栏已断言同源）。
//
// 用法：
//   cd .workbuddy/tools && NODE_PATH=<ws>/node_modules node v209-fs-toolbar-prod-probe.js
//   环境变量：HG_SHOT_DIR 覆盖截图目录
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOT_DIR = process.env.HG_SHOT_DIR || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/预报工具栏全屏落点-2026-09-20';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VPS = [1280, 1366, 1440, 1680, 1920];

let pass = 0, fail = 0;
const fails = [];
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra !== undefined ? '  ' + extra : '')); }
  else { fail++; fails.push(label + (extra !== undefined ? '  ' + extra : '')); console.log('  ❌ ' + label + (extra !== undefined ? '  ' + extra : '')); }
}

/* ---------- 页面内表达式（模板字面量，避免嵌套引号陷阱）---------- */
const JS_MEASURE = (sel) => `(() => {
  const row = document.querySelector(${JSON.stringify(sel)})
  if (!row) return JSON.stringify({ err: 'no row ' + ${JSON.stringify(sel)} })
  const vis = (el) => { const st = getComputedStyle(el); const r = el.getBoundingClientRect(); return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0.5 }
  const cs = getComputedStyle(row)
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
  const gap = parseFloat(cs.columnGap) || 0
  const kids = Array.from(row.children).filter(vis)
  const need = kids.reduce((s, c) => { const s2 = getComputedStyle(c); return s + c.getBoundingClientRect().width + (parseFloat(s2.marginLeft) || 0) + (parseFloat(s2.marginRight) || 0) }, 0) + gap * Math.max(0, kids.length - 1)
  const avail = row.clientWidth - padX
  const tops = kids.map((c) => Math.round(c.getBoundingClientRect().top))
  const uniq = []
  tops.forEach((t) => { if (!uniq.some((x) => Math.abs(x - t) <= 6)) uniq.push(t) })
  const fsBtn = document.querySelector('.grid-fs-btn')
  const fr = fsBtn ? fsBtn.getBoundingClientRect() : null
  const maxKidRight = kids.length ? Math.max.apply(null, kids.map((c) => c.getBoundingClientRect().right)) : 0
  return JSON.stringify({
    rows: uniq.length,
    avail: Math.round(avail),
    need: Math.round(need),
    slack: Math.round(avail - need),
    hScroll: Math.round(row.scrollWidth - row.clientWidth),
    docHScroll: Math.round(document.documentElement.scrollWidth - window.innerWidth),
    maxKidRight: Math.round(maxKidRight),
    fsBtnLeft: fr ? Math.round(fr.left) : null,
    overlap: fr ? Math.max(0, Math.round(maxKidRight - fr.left)) : null,
    kids: kids.map((c) => (String(c.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 10) || String(c.className).split(' ')[0]) + '[' + Math.round(c.getBoundingClientRect().width) + ']'),
  })
})()`

/* 全屏态工具行「入口唯一性 + 结构」快照 */
const JS_ROWLIVE = `(() => {
  const tx = (el) => String(el ? el.textContent : '').trim()
  const vis = (el) => !!el && el.offsetParent !== null
  const allBtn = Array.from(document.querySelectorAll('button'))
  const editBtns = allBtn.filter((b) => /^改单$/.test(tx(b)))
  const gridRow = document.querySelector('.grid-ctl-row')
  const tbToolbar = document.querySelector('.card.toolbar')
  const tbg = document.querySelector('.tb-edit-group')
  const inRow = (el) => !!el && !!gridRow && gridRow.contains(el)
  const inTb = (el) => !!el && !!tbToolbar && tbToolbar.contains(el)
  const rowGroup = document.querySelector('.grid-ctl-row > .tb-edit-group')
  const lead = document.querySelector('.grid-ctl-row .tb-sep-lead')
  const badges = Array.from(document.querySelectorAll('.grid-ctl-row .confirm-badge'))
  const zl = document.querySelector('.grid-ctl-row .zb-label')
  return JSON.stringify({
    nEditBtn: editBtns.length,
    editBtnInRow: editBtns.some(inRow),
    editBtnInToolbar: editBtns.some(inTb),
    editBtnVisible: editBtns.some(vis),
    fullscreen: !!document.querySelector('.grid-area.is-fs'),
    rowInFullscreenLayer: !!document.querySelector('.grid-area.is-fs .grid-ctl-row'),
    nEditGroup: document.querySelectorAll('.tb-edit-group').length,
    editGroupInRow: !!rowGroup,
    editGroupInToolbar: !!(tbg && inTb(tbg)),
    editGroupKids: rowGroup ? Array.from(rowGroup.children).filter(vis).map((c) => tx(c)) : [],
    leadSepDisplay: lead ? getComputedStyle(lead).display : null,
    badges: badges.map((b) => ({ slim: b.classList.contains('badge-slim'), w: Math.round(b.getBoundingClientRect().width), text: tx(b).slice(0, 24), title: (b.getAttribute('title') || '').slice(0, 40) })),
    zoomLabelDisplay: zl ? getComputedStyle(zl).display : null,
    saveStateText: tx(document.querySelector('.grid-ctl-row .save-state')),
  })
})()`

/* 状态条最坏宽度投影：克隆后换成更长的文案量一遍（不动任何状态） */
const JS_STATE_WORST = `(() => {
  const st = document.querySelector('.grid-ctl-row .save-state')
  if (!st) return JSON.stringify({ err: 'no save-state' })
  const probe = st.cloneNode(true)
  probe.style.position = 'absolute'; probe.style.visibility = 'hidden'; probe.style.left = '-9999px'; probe.style.top = '0'
  st.parentNode.appendChild(probe)
  const w = {}
  ;[['尚未修改', 'clean'], ['有未保存的改动', 'dirty'], ['已保存 12:34', 'saved']].forEach((p) => {
    while (probe.firstChild) probe.removeChild(probe.firstChild)
    const i = document.createElement('i'); i.className = 'ss-dot'; probe.appendChild(i)
    probe.appendChild(document.createTextNode(p[0]))
    w[p[1]] = Math.round(probe.getBoundingClientRect().width)
  })
  const cur = Math.round(st.getBoundingClientRect().width)
  probe.remove()
  return JSON.stringify({ cur, widths: w, worst: Math.max(w.clean, w.dirty, w.saved) })
})()`

const dumpRow = async (p, label, sel) => {
  console.log('\n===== ' + label + ' =====');
  console.log('视口   行数  可用   所需   余量  横向溢出  与全屏按钮重叠  控件明细');
  const rows = [];
  for (const vw of VPS) {
    await p.setViewport({ width: vw, height: 900, deviceScaleFactor: 1 });
    await sleep(820);
    const m = JSON.parse(await p.evaluate(JS_MEASURE(sel)));
    rows.push({ vw, m });
    if (m.err) { console.log(vw + '  ' + m.err); continue; }
    console.log(
      String(vw).padEnd(6) + ' ' + String(m.rows).padStart(4) + ' ' + String(m.avail).padStart(6) + ' ' +
      String(m.need).padStart(6) + ' ' + String(m.slack).padStart(6) + ' ' + String(m.hScroll).padStart(8) + ' ' +
      String(m.overlap).padStart(14) + '   ' + m.kids.join(' ')
    );
  }
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await sleep(650);
  return rows;
}

const probeState = async (p) => JSON.parse(await p.evaluate(JS_ROWLIVE));

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  const consoleErrs = [];
  p.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 160)); });
  p.on('pageerror', (e) => consoleErrs.push('pageerror: ' + String(e.message).slice(0, 160)));
  // enterEdit 在「角色可能无填报权限」时会先 confirm；只影响弹窗，不改数据
  p.on('dialog', (d) => d.accept());

  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = Array.from(document.querySelectorAll('button,a')).find((x) => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3200);
  await p.evaluate(() => { const el = Array.from(document.querySelectorAll('a')).find((x) => x.getAttribute('href') === '#/forecast'); el && el.click(); });
  await sleep(3400);
  const picked = await p.evaluate(() => {
    const sel = document.querySelector('.sel-period');
    if (!sel) return null;
    const opt = Array.from(sel.options).find((o) => o.value && o.value !== '0');
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.text;
  });
  await sleep(2800);
  console.log('URL: ' + p.url() + '   期次: ' + (picked || '(无)'));

  const setFs = (on) => p.evaluate((want) => {
    const has = !!document.querySelector('.grid-area.is-fs');
    if (has !== want) { const btn = document.querySelector('.grid-fs-btn'); btn && btn.click(); }
    return !!document.querySelector('.grid-area.is-fs');
  }, on);

  /* ============ S0. 非全屏基线（方案 A 承诺：非全屏零改动） ============ */
  console.log('\n########## S0. 非全屏（方案 A：非全屏必须与改前一致）##########');
  {
    const s = await probeState(p);
    console.log('  状态: ' + JSON.stringify({ nEditBtn: s.nEditBtn, editBtnInToolbar: s.editBtnInToolbar, editBtnInRow: s.editBtnInRow, nEditGroup: s.nEditGroup, leadSep: s.leadSepDisplay, zoomLabel: s.zoomLabelDisplay }));
    ok('S0-1 非全屏：「改单」恰一个，且在主工具栏', s.nEditBtn === 1 && s.editBtnInToolbar && !s.editBtnInRow);
    ok('S0-2 非全屏：表格工具行**没有**「改单」（方案 A 的核心承诺）', !s.editBtnInRow);
    ok('S0-3 非全屏：行首装饰分隔条**显示**（未触发全屏收紧）', s.leadSepDisplay !== 'none', s.leadSepDisplay);
    ok('S0-4 非全屏：缩放控件「缩放」二字**显示**（未触发 compact）', s.zoomLabelDisplay !== 'none', s.zoomLabelDisplay);
    ok('S0-5 非全屏：徽标为完整文案（未 slim）', s.badges.every((b) => !b.slim), JSON.stringify(s.badges.map((b) => b.w)));
    const rows = await dumpRow(p, 'S0. 非全屏 · 只读 · 表格工具行（应与改前一致）', '.grid-ctl-row');
    ok('S0-6 非全屏无横向滚动', rows.every((r) => !r.m.err && r.m.hScroll <= 0 && r.m.docHScroll <= 0));
  }

  /* ============ S1. 全屏 · 只读 ============ */
  console.log('\n########## S1. 全屏 · 只读（痛点应已解除）##########');
  await setFs(true);
  await sleep(1200);
  {
    const s = await probeState(p);
    console.log('  状态: ' + JSON.stringify({ fullscreen: s.fullscreen, nEditBtn: s.nEditBtn, editBtnInRow: s.editBtnInRow, editBtnInToolbar: s.editBtnInToolbar, leadSep: s.leadSepDisplay, badges: s.badges }));
    ok('S1-1 已在全屏层内', s.fullscreen && s.rowInFullscreenLayer);
    ok('S1-2 🔴 全屏：「改单」恰一个（无双份控件）', s.nEditBtn === 1, 'n=' + s.nEditBtn);
    ok('S1-3 🔴 全屏：「改单」在**表格工具行内**（用户在表格旁就能点到）', s.editBtnInRow);
    ok('S1-4 全屏：主工具栏那份已让位（不留下被盖住的重复 DOM）', !s.editBtnInToolbar);
    ok('S1-5 全屏：行首装饰分隔条已隐藏（收紧项①）', s.leadSepDisplay === 'none', s.leadSepDisplay);
    ok('S1-6 全屏：徽标已收成图标形态且文案进了 title', s.badges.length === 0 || s.badges.every((b) => b.slim && b.w < 60 && b.title.length > 4), JSON.stringify(s.badges));
    ok('S1-7 全屏：缩放控件已 compact（省 30px）', s.zoomLabelDisplay === 'none', s.zoomLabelDisplay);

    const rows = await dumpRow(p, 'S1. 全屏 · 只读 · 表格工具行', '.grid-ctl-row');
    rows.forEach((r) => { if (!r.m.err) ok('S1-8@' + r.vw + ' 单行 + 无横向滚动', r.m.rows === 1 && r.m.hScroll <= 0, 'rows=' + r.m.rows + ' slack=' + r.m.slack); });

    /* 痛点复现/解除：命中测试打在表格工具行那颗「改单」中心 */
    const hit = JSON.parse(await p.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => /^改单$/.test(String(b.textContent).trim()))
      if (!btn) return JSON.stringify({ err: 'no 改单' })
      const r = btn.getBoundingClientRect()
      const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
      return JSON.stringify({
        box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        topEl: top ? (typeof top.className === 'string' ? top.className : top.tagName).toString().slice(0, 50) : null,
        hitIsBtn: top === btn || (btn.contains && btn.contains(top)),
        inRow: !!document.querySelector('.grid-ctl-row') && document.querySelector('.grid-ctl-row').contains(btn),
      })
    })()`));
    console.log('  全屏命中测试: ' + JSON.stringify(hit));
    ok('S1-9 🔴 全屏下点「改单」坐标，最上层就是它自己（原痛点是命中外层空元素）', hit.hitIsBtn === true, JSON.stringify(hit));
  }

  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(900);
  await p.screenshot({ path: SHOT_DIR + '/真机-全屏只读-改单已进表格工具行.png' });

  /* ============ S2. 从全屏内的新入口进入编辑态 ============ */
  console.log('\n########## S2. 全屏 · 编辑（从表格工具行那颗「改单」进入）##########');
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const clicked = await p.evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => /^改单$/.test(String(b.textContent).trim()))
    if (!btn) return false
    const row = document.querySelector('.grid-ctl-row')
    const fromRow = !!row && row.contains(btn)
    btn.click()
    return fromRow
  })()`);
  await sleep(4800);
  {
    const s = await probeState(p);
    console.log('  进入路径=表格工具行内按钮: ' + clicked);
    console.log('  状态: ' + JSON.stringify({ fullscreen: s.fullscreen, nEditGroup: s.nEditGroup, editGroupInRow: s.editGroupInRow, editGroupInToolbar: s.editGroupInToolbar, kids: s.editGroupKids }));
    ok('S2-0 确实是从**表格工具行内**那颗按钮进入的（= 用户在全屏下的真实路径）', clicked === true);
    ok('S2-1 🔴 全屏编辑态：编辑组恰一个（无双份）', s.nEditGroup === 1, 'n=' + s.nEditGroup);
    ok('S2-2 🔴 全屏编辑态：编辑组在**表格工具行内**', s.editGroupInRow);
    ok('S2-3 全屏编辑态：主工具栏那份编辑组已让位', !s.editGroupInToolbar);
    ok('S2-4 编辑组 6 件齐（取消/回退/查错/补录商品/保存/状态条）',
      s.editGroupKids.length === 6 && /取消/.test(s.editGroupKids[0]) && /保存/.test(s.editGroupKids[4]),
      JSON.stringify(s.editGroupKids));
    ok('S2-5 🔴 全屏编辑态：整表工具行仍是一行 + 无横向滚动（各视口见下表）', true);

    const rows = await dumpRow(p, 'S2. 全屏 · 编辑 · 表格工具行', '.grid-ctl-row');
    rows.forEach((r) => { if (!r.m.err) ok('S2-6@' + r.vw + ' 单行 + 无横向滚动 + 不被全屏按钮压住', r.m.rows === 1 && r.m.hScroll <= 0 && r.m.overlap === 0, 'rows=' + r.m.rows + ' slack=' + r.m.slack + ' overlap=' + r.m.overlap); });

    /* 状态条最坏宽度投影：真实状态可能是「尚未修改」，必须证明最坏文案下也放得下 */
    await p.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await sleep(800);
    const sw = JSON.parse(await p.evaluate(JS_STATE_WORST));
    const m1280 = JSON.parse(await p.evaluate(JS_MEASURE('.grid-ctl-row')));
    console.log('  状态条宽度: 当前=' + sw.cur + '  三态=' + JSON.stringify(sw.widths) + '  最坏=' + sw.worst);
    const projected = m1280.slack + sw.cur - sw.worst;
    console.log('  1280 投影余量（按最坏文案）= ' + projected + 'px');
    ok('S2-7 🔴 1280 全屏编辑态在**最坏状态条文案**下仍放得下（投影余量 ≥ 0）', projected >= 0, 'projected=' + projected);
    await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await sleep(900);
    await p.screenshot({ path: SHOT_DIR + '/真机-全屏编辑-编辑组已进表格工具行.png' });
  }

  /* ============ S3. 从全屏编辑态点「取消」回到只读 ============ */
  console.log('\n########## S3. 取消 → 回只读（不得卡死/不得丢入口）##########');
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await sleep(500);
  const back = await p.evaluate(`(() => {
    const g = document.querySelector('.grid-ctl-row > .tb-edit-group')
    if (!g) return JSON.stringify({ err: 'no group' })
    const btn = Array.from(g.querySelectorAll('button')).find((b) => String(b.textContent).trim() === '取消')
    if (!btn) return JSON.stringify({ err: 'no 取消' })
    btn.click()
    return JSON.stringify({ ok: true })
  })()`);
  await sleep(3200);
  {
    const s = await probeState(p);
    console.log('  状态: ' + JSON.stringify({ fullscreen: s.fullscreen, nEditBtn: s.nEditBtn, editBtnInRow: s.editBtnInRow, nEditGroup: s.nEditGroup }));
    ok('S3-1 已回到只读态（编辑组消失）', s.nEditGroup === 0, 'n=' + s.nEditGroup);
    ok('S3-2 🔴 仍在全屏 + 「改单」重新出现在表格工具行内（可反复改单）', s.fullscreen && s.nEditBtn === 1 && s.editBtnInRow);
    ok('S3-3 无双份控件', s.nEditBtn === 1);
  }

  /* ============ S4. 退出全屏 → 非全屏回归 ============ */
  console.log('\n########## S4. 退出全屏（非全屏必须恢复原样）##########');
  await setFs(false);
  await sleep(1400);
  {
    const s = await probeState(p);
    console.log('  状态: ' + JSON.stringify({ fullscreen: s.fullscreen, nEditBtn: s.nEditBtn, editBtnInToolbar: s.editBtnInToolbar, editBtnInRow: s.editBtnInRow, leadSep: s.leadSepDisplay, zoomLabel: s.zoomLabelDisplay, badges: s.badges.map((b) => b.w) }));
    ok('S4-1 已退出全屏', !s.fullscreen);
    ok('S4-2 🔴 退出全屏后「改单」回到主工具栏（表格工具行内不再有）', s.nEditBtn === 1 && s.editBtnInToolbar && !s.editBtnInRow);
    ok('S4-3 行首装饰分隔条恢复显示', s.leadSepDisplay !== 'none', s.leadSepDisplay);
    ok('S4-4 缩放控件恢复完整形态（「缩放」二字回来）', s.zoomLabelDisplay !== 'none', s.zoomLabelDisplay);
    ok('S4-5 徽标恢复完整文案（非 slim）', s.badges.every((b) => !b.slim), JSON.stringify(s.badges.map((b) => b.w)));
  }

  /* ============ S5. 控制台 / 回归 ============ */
  console.log('\n########## S5. 运行期异常 ##########');
  ok('S5-1 无 console.error / pageerror', consoleErrs.length === 0, JSON.stringify(consoleErrs.slice(0, 5)));

  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(600);
  await p.screenshot({ path: SHOT_DIR + '/真机-非全屏-改单仍在主工具栏.png' });

  await b.close();

  console.log('\n==================================================');
  if (fail) {
    console.log('❌ 失败 ' + fail + ' 项 / 共 ' + (pass + fail) + ' 项');
    fails.forEach((f) => console.log('   · ' + f));
    process.exit(1);
  }
  console.log('✅ 全部通过：' + pass + ' 项断言');
  console.log('截图目录: ' + SHOT_DIR);
})();
