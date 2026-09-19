// 全局模态层修复的交互回归（v136：.pf-mask / .cmd-mask / .md-sheet 抬到 1125/1130）
// 用法：NODE_PATH=<ws>/node_modules node global-modal-zindex-regress.js [baseUrl]
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = process.argv[2] || 'https://hergent.cn';

let pass = 0, fail = 0; const errs = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✔ ' + n + (d ? '  — ' + d : '')); } else { fail++; console.log('  ✘ ' + n + (d ? '  — ' + d : '')); } };

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 160)));
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await p.goto(BASE + '/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3500);
  await p.evaluate(() => { const a = [...document.querySelectorAll('a')].find(x => /预报订货|预报/.test(x.textContent)); a && a.click(); });
  await sleep(4500);
  await p.evaluate(() => {
    const sel = document.querySelector('select.sel-period');
    if (sel && sel.value === '0') { const o = [...sel.options].find(x => x.value && x.value !== '0'); if (o) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); } }
  });
  await sleep(4000);

  const openProfile = async () => {
    await p.evaluate(() => { const u = document.querySelector('.tb-user'); u && u.click(); });
    await sleep(500);
    await p.evaluate(() => { const it = [...document.querySelectorAll('.tb-menu-item')].find(x => /修改资料/.test(x.textContent)); it && it.click(); });
    await sleep(900);
  };
  const brandRect = () => p.evaluate(() => {
    const t = document.querySelector('.grid-ctl-row .tb-pop');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  const gotoForecast = async () => {
    await p.evaluate(() => { const a = [...document.querySelectorAll('a')].find(x => /预报订货|预报/.test(x.textContent)); a && a.click(); });
    await sleep(4000);
    await p.evaluate(() => {
      const sel = document.querySelector('select.sel-period');
      if (sel && sel.value === '0') { const o = [...sel.options].find(x => x.value && x.value !== '0'); if (o) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); } }
    });
    await sleep(3500);
  };
  const state = () => p.evaluate(() => ({
    pf: !!document.querySelector('.pf-mask'), cmd: !!document.querySelector('.cmd-mask'),
    md: !!document.querySelector('.md-sheet'), brandPanel: !!document.querySelector('.tb-pop-panel.brand-pop'),
    copilot: !!document.querySelector('.copilot'),
    pfZ: (document.querySelector('.pf-mask') && getComputedStyle(document.querySelector('.pf-mask')).zIndex) || null,
    cmdZ: (document.querySelector('.cmd-mask') && getComputedStyle(document.querySelector('.cmd-mask')).zIndex) || null,
    mdZ: (document.querySelector('.md-sheet') && getComputedStyle(document.querySelector('.md-sheet')).zIndex) || null,
    copilotZ: (document.querySelector('.copilot') && getComputedStyle(document.querySelector('.copilot')).zIndex) || null,
  }));

  console.log('\n===== ① 修改资料弹窗 .pf-mask =====');
  try {
    await openProfile();
    let s = await state();
    ok('弹窗已打开', s.pf); ok('层级 = 1130', s.pfZ === '1130', 'z=' + s.pfZ);
    // 最硬判据：遮罩全域 5x5 网格取点，每点都必须命中遮罩/弹窗内部，且不得落入 .tb-pop
    const grid = await p.evaluate(() => {
      const m = document.querySelector('.pf-mask'); const r = m.getBoundingClientRect();
      const out = [];
      for (let i = 1; i <= 5; i++) for (let j = 1; j <= 5; j++) {
        const x = Math.round(r.left + r.width * i / 6), y = Math.round(r.top + r.height * j / 6);
        const t = document.elementFromPoint(x, y);
        out.push({ x, y, inPf: !!(t && t.closest('.pf-mask')), inTbPop: !!(t && t.closest('.tb-pop')),
          el: t ? t.tagName.toLowerCase() + '.' + (t.className || '').toString().split(' ')[0] : null });
      }
      return out;
    });
    const bad = grid.filter(g => !g.inPf || g.inTbPop);
    ok('遮罩全域 25 点无穿透', bad.length === 0, bad.length ? '漏点: ' + bad.map(g => `${g.el}@${g.x},${g.y}`).slice(0, 3).join(' ') : '25/25 inSelf');
    const br = await brandRect();
    // 点品牌按钮坐标（现被弹窗覆盖）→ 不得穿透到工具栏
    await p.mouse.click(br.x, br.y); await sleep(800);
    s = await state();
    ok('重叠区点击未穿透（品牌面板未弹出）', s.brandPanel === false);
    // 点遮罩空白处 → 关闭（@click.self 路径）
    await p.mouse.click(60, 860); await sleep(800);
    s = await state();
    ok('点遮罩空白处 → 弹窗关闭', s.pf === false);
    // 关闭后品牌按钮功能恢复正常
    await p.mouse.click(br.x, br.y); await sleep(900);
    s = await state();
    ok('关闭后品牌下拉恢复正常弹出', s.brandPanel === true);
    await p.mouse.click(br.x, br.y); await sleep(600);   // 互斥切换收回面板
  } catch (e) { ok('① 组执行', false, e.message); }

  console.log('\n===== ② 命令面板 .cmd-mask =====');
  try {
    const openCmd = async () => {
      await p.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true, bubbles: true })); });
      await sleep(900);
    };
    await openCmd();
    let s = await state();
    ok('命令面板已打开', s.cmd); ok('层级 = 1130', s.cmdZ === '1130', 'z=' + s.cmdZ);
    // 面板全域网格扫描（居中、top:12vh）
    const grid = await p.evaluate(() => {
      const m = document.querySelector('.cmd-mask'); const r = m.getBoundingClientRect();
      const out = [];
      for (let i = 1; i <= 5; i++) for (let j = 1; j <= 3; j++) {
        const x = Math.round(r.left + r.width * i / 6), y = Math.round(r.top + r.height * j / 4);
        const t = document.elementFromPoint(x, y);
        out.push({ x, y, inCmd: !!(t && t.closest('.cmd-mask')), inTbPop: !!(t && t.closest('.tb-pop')),
          el: t ? t.tagName.toLowerCase() + '.' + (t.className || '').toString().split(' ')[0] : null });
      }
      return out;
    });
    const bad = grid.filter(g => !g.inCmd || g.inTbPop);
    ok('面板全域 15 点无穿透', bad.length === 0, bad.length ? '漏点: ' + bad.map(g => `${g.el}@${g.x},${g.y}`).slice(0, 3).join(' ') : '15/15 inSelf');
    const br = await brandRect();
    await p.mouse.click(br.x, br.y); await sleep(700);
    s = await state();
    ok('重叠区点击未穿透（品牌面板未弹出）', s.brandPanel === false);
    // 点在面板内容上可能因选中命令而收起、点在遮罩上也会收起 —— 两种情况都必须已收起
    if (s.cmd) { await p.mouse.click(100, 820); await sleep(800); s = await state(); }
    ok('命令面板已收起', s.cmd === false);
    // 关闭后品牌按钮恢复正常（先归一到关闭态，避免上一组遗留导致 toggle 反向）
    s = await state();
    if (s.brandPanel) { await p.mouse.click(br.x, br.y); await sleep(700); s = await state(); }
    ok('进入断言前面板为关闭态', s.brandPanel === false);
    // 说明：被点中的命令可能是一条导航命令（实测会跳转离页），故先回预报页再验工具栏未被破坏
    await gotoForecast();
    const br2 = await brandRect();
    await p.mouse.click(br2.x, br2.y); await sleep(900);
    s = await state();
    ok('回到预报页后品牌下拉正常弹出（工具栏未被破坏）', s.brandPanel === true);
    await p.mouse.click(br2.x, br2.y); await sleep(600);
    await p.mouse.click(br.x, br.y); await sleep(600);
  } catch (e) { ok('② 组执行', false, e.message); }

  console.log('\n===== ③ 与 AI 副驾抽屉共存（.copilot 950）=====');
  try {
    await p.evaluate(() => { const b2 = document.querySelector('.tb-copilot'); b2 && b2.click(); });
    await sleep(1500);
    let s = await state();
    ok('副驾抽屉已打开', s.copilot, 'z=' + s.copilotZ);
    await openProfile();
    s = await state();
    ok('模态在副驾之上（1130 > 950）', s.pf && s.pfZ === '1130', `pf=${s.pfZ} copilot=${s.copilotZ}`);
    const hit = await p.evaluate(() => {
      const m = document.querySelector('.pf-mask'); const r = m.getBoundingClientRect();
      const t = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return { inPf: !!(t && t.closest('.pf-mask')), el: t ? t.tagName.toLowerCase() + '.' + (t.className || '').toString().split(' ')[0] : null };
    });
    ok('模态中心命中自身（未被副驾压住）', hit.inPf, hit.el);
    await p.mouse.click(60, 860); await sleep(700);
    await p.evaluate(() => { const b2 = document.querySelector('.tb-copilot'); b2 && b2.click(); });
    await sleep(900);
  } catch (e) { ok('③ 组执行', false, e.message); }

  console.log('\n===== ④ 移动端底部抽屉 .md-sheet =====');
  try {
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await sleep(2500);
    await p.evaluate(() => { const btn = [...document.querySelectorAll('.mnav-item,button')].find(x => /更多/.test(x.textContent)); btn && btn.click(); });
    await sleep(1000);
    let s = await state();
    ok('抽屉已打开', s.md); ok('层级 = 1130', s.mdZ === '1130', 'z=' + s.mdZ);
    await p.mouse.click(195, 120); await sleep(900);
    s = await state();
    ok('点遮罩 → 抽屉关闭', s.md === false);
    const mnavOk = await p.evaluate(() => {
      const m = document.querySelector('.mnav'); const r = m.getBoundingClientRect();
      const t = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return !!t && !!t.closest('.mnav');
    });
    ok('移动端底部 Tab 未被遮挡', mnavOk);
  } catch (e) { ok('④ 组执行', false, e.message); }

  console.log('\n===== ⑤ 控制台 =====');
  ok('0 控制台错误', errs.length === 0, errs.length ? errs.slice(0, 3).join(' | ') : '');
  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
