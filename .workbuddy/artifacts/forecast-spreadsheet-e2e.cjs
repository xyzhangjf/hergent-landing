const puppeteer = require('puppeteer-core');
const BASE = 'https://hergent.cn', USER = 'boss', PASS = 'boss123';
const checks = [];
function check(name, ok, extra) { checks.push({ name, ok: !!ok, extra: extra || '' }); }
const log = (...a) => console.log(...a);

(async () => {
  const b = await puppeteer.launch({ headless: 'new', executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', e => log('PAGEERR', e.message));
  try {
    // 登录
    await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('input[placeholder="用户名"]');
    await page.type('input[placeholder="用户名"]', USER);
    await page.type('input[placeholder="密码"]', PASS);
    await page.focus('input[placeholder="密码"]');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 2500));
    // 进预报
    await page.goto(`${BASE}/#/forecast`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2500));
    const entered = await page.evaluate(() => {
      const x = [...document.querySelectorAll('button')].find(b => /编辑/.test(b.textContent));
      if (x) { x.click(); return true; }
      return false;
    });
    check('进入编辑模式', entered);
    await new Promise(r => setTimeout(r, 2500));

    // 1) 单元格选中
    const sel = await page.evaluate(async () => {
      const inp = document.querySelector('td.qty-cell input[data-r]');
      if (!inp) return { ok: false };
      inp.focus();
      await new Promise(r => setTimeout(r, 180));
      const td = document.querySelector('td.selected');
      return { ok: !!td, dr: td && td.getAttribute('data-r'), dc: td && td.getAttribute('data-c') };
    });
    check('单元格点击/聚焦后高亮选中', sel.ok, `data-r=${sel.dr} data-c=${sel.dc}`);

    // 2) 键盘导航 Tab 右移
    const nav = await page.evaluate(async () => {
      const inp = document.querySelector('td.qty-cell input[data-r]');
      inp.focus();
      const before = document.querySelector('td.selected');
      const bc = before && before.getAttribute('data-c');
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const after = document.querySelector('td.selected');
      const ac = after && after.getAttribute('data-c');
      return { bc, ac, moved: bc !== ac };
    });
    check('Tab 键右移选中单元格', nav.moved, `c:${nav.bc}->${nav.ac}`);

    // 3) 右键上下文菜单 + 插入行
    const rowsBefore = await page.evaluate(() => document.querySelectorAll('.edit-tbl tbody tr').length);
    const ctx = await page.evaluate(async () => {
      const td = document.querySelector('.edit-tbl tbody tr td.qty-cell');
      const r = td.getBoundingClientRect();
      td.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 }));
      await new Promise(r => setTimeout(r, 180));
      return !!document.querySelector('.ctx-menu');
    });
    check('右键弹出上下文菜单', ctx);
    const inserted = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.ctx-menu button')].find(b => /在下方插入行/.test(b.textContent));
      if (!btn) return false;
      btn.click();
      return true;
    });
    await new Promise(r => setTimeout(r, 300));
    const rowsAfter = await page.evaluate(() => document.querySelectorAll('.edit-tbl tbody tr').length);
    check('上下文菜单「在下方插入行」生效', inserted && rowsAfter === rowsBefore + 1, `${rowsBefore}->${rowsAfter}`);
    // 删掉刚插入的空行，恢复
    await page.evaluate(() => {
      const trs = document.querySelectorAll('.edit-tbl tbody tr');
      const last = trs[trs.length - 1];
      const del = last.querySelector('.btn-del'); if (del) del.click();
    });

    // 4) 填充柄：写入值→拖拽填充下方两行
    const fill = await page.evaluate(async () => {
      const inp = document.querySelector('td.qty-cell input[data-r]');
      inp.focus();
      await new Promise(r => setTimeout(r, 180));
      inp.value = '7';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
      const srcTd = inp.closest('td');
      const handle = srcTd.querySelector('.fill-handle');
      if (!handle) return { ok: false, why: 'no handle' };
      const dc = srcTd.getAttribute('data-c');
      const allRows = [...document.querySelectorAll('.edit-tbl tbody tr')];
      const targetInp = allRows[2] && allRows[2].querySelector('td.qty-cell input[data-c="' + dc + '"]');
      if (!targetInp) return { ok: false, why: 'no target', rows: allRows.length, dc };
      const hr = handle.getBoundingClientRect();
      const tr = targetInp.getBoundingClientRect();
      const cx = tr.x + tr.width / 2, cy = tr.y + tr.height / 2;
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: hr.x + 2, clientY: hr.y + 2 }));
      const el = document.elementFromPoint(cx, cy);
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy }));
      await new Promise(r => setTimeout(r, 220));
      return { ok: targetInp.value === '7', val: targetInp.value };
    });
    check('填充柄拖拽填充下方单元格', fill.ok, `target值=${fill.val} ${fill.why || ''}${fill.rows ? 'rows=' + fill.rows : ''}`);

    // 5) 只读视图复制按钮仍存在
    const copy = await page.evaluate(() => {
      const cancel = [...document.querySelectorAll('button')].find(b => /取消/.test(b.textContent));
      if (cancel) cancel.click();
      return new Promise(res => setTimeout(() => {
        const btn = [...document.querySelectorAll('th button')].find(b => /⧉/.test(b.textContent));
        res(!!btn);
      }, 2000));
    });
    check('只读视图复制(⧉)按钮仍存在', copy);

  } catch (e) {
    log('ERR', e.message);
    check('脚本异常', false, e.message);
  }
  await b.close();
  const pass = checks.filter(c => c.ok).length;
  console.log('\n=== 结果 ' + pass + '/' + checks.length + ' ===');
  checks.forEach(c => console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.extra ? '  [' + c.extra + ']' : '')));
  process.exit(pass === checks.length ? 0 : 1);
})();
