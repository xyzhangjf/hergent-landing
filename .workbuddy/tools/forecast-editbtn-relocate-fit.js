// 「改单」按钮是否应下移到表格工具行（.grid-ctl-row）—— 容量实测
// 量：① 表格工具行当前余量 ② 强行塞入「改单」后是否折行（含 3 个最坏态）
//     ③ 备选落点 .view-seg-row 的余量 ④ 逐单补录视图下 .grid-ctl-row 是否存在（跨视图回归证据）
//     ⑤ 把「改单」移出主工具栏后主工具栏是否仍单行
// 用法：NODE_PATH=<ws>/node_modules node forecast-editbtn-relocate-fit.js [tag]
// 全程只读：仅做 DOM 克隆 / inline style / 点击「仅显示有报单」开关（纯前端状态，不落库）
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAG = process.argv[2] || 'editbtn';
const OUT = '/tmp/fc-editbtn';
fs.mkdirSync(OUT, { recursive: true });
const VPS = [1280, 1366, 1440, 1680, 1920];

const probe = () =>
  new Promise((res) => res());

(async () => {
  const b = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  // —— 单行容器通用量测（need 公式逐字抄自 toolbar-newperiod-fit.js：含 marginL/R + gap×（n−1））——
  const measure = (rowSel) =>
    p.evaluate((sel) => {
      const row = document.querySelector(sel);
      if (!row) return { err: 'no ' + sel };
      const vis = (el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0.5;
      };
      const cs = getComputedStyle(row);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const gap = parseFloat(cs.columnGap) || 0;
      const kids = [...row.children].filter(vis);
      const need =
        kids.reduce((s, c) => {
          const s2 = getComputedStyle(c);
          return (
            s +
            c.getBoundingClientRect().width +
            (parseFloat(s2.marginLeft) || 0) +
            (parseFloat(s2.marginRight) || 0)
          );
        }, 0) + gap * Math.max(0, kids.length - 1);
      const avail = row.clientWidth - padX;
      const tops = kids.map((c) => Math.round(c.getBoundingClientRect().top));
      const rows = [
        ...new Set(tops.filter((t, i, a) => !a.some((x, j) => j < i && Math.abs(x - t) <= 6))),
      ].length;
      const rr = row.getBoundingClientRect();
      const fsb = document.querySelector('.grid-fs-btn');
      const lastRight = kids.length
        ? Math.max(...kids.map((c) => c.getBoundingClientRect().right))
        : null;
      return {
        avail: Math.round(avail),
        need: Math.round(need),
        slack: Math.round(avail - need),
        rows,
        h: Math.round(rr.height),
        gap,
        padX,
        wrap: cs.flexWrap,
        fsbLeft: fsb ? Math.round(fsb.getBoundingClientRect().left) : null,
        lastRight: lastRight != null ? Math.round(lastRight) : null,
        kids: kids.map((c) => ({
          n:
            (c.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 14) ||
            (c.className || '').toString().split(' ')[0],
          w: Math.round(c.getBoundingClientRect().width),
        })),
      };
    }, rowSel);

  await p.goto('https://hergent.cn/?cb=' + Date.now(), {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await sleep(2200);
  await p.evaluate(() => {
    const el = [...document.querySelectorAll('button,a')].find((x) => /演示/.test(x.textContent));
    el && el.click();
  });
  await sleep(3200);
  await p.evaluate(() => {
    const el = [...document.querySelectorAll('a')].find((x) => x.getAttribute('href') === '#/forecast');
    el && el.click();
  });
  await sleep(3400);
  console.log('URL:', p.url(), `[${TAG}]`);

  // —— 选一个期次（让表格工具行处于真实使用态）——
  const picked = await p.evaluate(() => {
    const sel = document.querySelector('.sel-period');
    if (!sel) return null;
    const opt = [...sel.options].find((o) => o.value && o.value !== '0');
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.text;
  });
  await sleep(3000);
  console.log('已选期次:', picked || '(无可选期次 — 演示账号无期次)');

  // —— 量「改单」按钮自身宽（主工具栏原位）——
  const editBtn = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.card.toolbar button')].find((x) => /^改单$/.test(x.textContent.trim()));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    const cs = getComputedStyle(btn);
    return {
      w: Math.round(r.width),
      cls: btn.className,
      bg: cs.backgroundColor,
      color: cs.color,
      fs: cs.fontSize,
      fw: cs.fontWeight,
      aria: btn.getAttribute('title') || '',
    };
  });
  console.log('主工具栏「改单」按钮:', JSON.stringify(editBtn));

  const gridRow = () => measure('.grid-ctl-row');
  const viewSeg = () => measure('.view-seg-row');

  const dumpGrid = async (label) => {
    console.log(`\n===== ${label} =====`);
    console.log('视口   工具行行数  行高  可用宽  所需宽   余量   控件明细');
    const store = [];
    for (const vw of VPS) {
      await p.setViewport({ width: vw, height: 900, deviceScaleFactor: 1 });
      await sleep(950);
      const m = await gridRow();
      if (m.err) {
        console.log(`${vw}  ${m.err}`);
        continue;
      }
      console.log(
        `${String(vw).padEnd(6)} ${String(m.rows).padStart(7)} ${String(m.h).padStart(6)} ${String(m.avail).padStart(7)} ${String(m.need).padStart(6)} ${String(m.slack).padStart(7)}   ` +
          m.kids.map((k) => `${k.n}[${k.w}]`).join(' ')
      );
      store.push([vw, m]);
    }
    return store;
  };

  const A = await dumpGrid('A. 表格工具行 · 现状');

  // —— B. 模拟：把「改单」克隆进表格工具行 ——
  const injected = await p.evaluate(() => {
    const row = document.querySelector('.grid-ctl-row');
    const src = [...document.querySelectorAll('.card.toolbar button')].find((x) => /^改单$/.test(x.textContent.trim()));
    if (!row || !src) return false;
    const c = src.cloneNode(true);
    c.id = '__sim_edit';
    row.appendChild(c);
    return true;
  });
  console.log(`\n[模拟] 把「改单」克隆到表格工具行末尾: ${injected}`);
  const B = await dumpGrid('B. 表格工具行 · 塞入「改单」后');

  // —— C. 最坏态 1：期次名撑满（影响主工具栏，不直接影响表格行；作为上下文）——
  // —— C. 最坏态 2：打开「仅显示有报单」→ 多一个「已隐藏 N 个零报单」徽标 ——
  const toggled = await p.evaluate(() => {
    const cb = document.querySelector('.grid-ctl-row input[type=checkbox]');
    if (!cb) return false;
    if (!cb.checked) cb.click();
    return true;
  });
  await sleep(700);
  console.log(`\n[最坏态] 打开「仅显示有报单」: ${toggled}`);
  const C = await dumpGrid('C. 表格工具行 · 塞入「改单」+ 已隐藏徽标（最坏）');

  await p.evaluate(() => {
    const cb = document.querySelector('.grid-ctl-row input[type=checkbox]');
    if (cb && cb.checked) cb.click();
  });
  await sleep(600);

  // —— D. 移走「改单」后主工具栏是否仍单行 ——
  await p.evaluate(() => {
    const c = document.getElementById('__sim_edit');
    if (c) c.remove();
    const btn = [...document.querySelectorAll('.card.toolbar button')].find((x) => /^改单$/.test(x.textContent.trim()));
    if (btn) btn.style.display = 'none';
  });
  await sleep(600);
  console.log('\n===== D. 主工具栏 · 把「改单」移走后（5 视口）=====');
  for (const vw of VPS) {
    await p.setViewport({ width: vw, height: 900, deviceScaleFactor: 1 });
    await sleep(900);
    const m = await p.evaluate(() => {
      const tb = document.querySelector('.card.toolbar');
      const cs = getComputedStyle(tb);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const vis = (el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0.5;
      };
      const kids = [...tb.children]
        .filter(vis)
        .filter((c) => !/pop-overlay/.test((c.className || '').toString()));
      const tops = kids.map((c) => Math.round(c.getBoundingClientRect().top));
      const rows = [
        ...new Set(tops.filter((t, i, a) => !a.some((x, j) => j < i && Math.abs(x - t) <= 8))),
      ].length;
      return {
        rows,
        h: Math.round(tb.getBoundingClientRect().height),
        kids: kids.length,
        padX,
      };
    });
    console.log(`${String(vw).padEnd(6)} 行数 ${m.rows}  高 ${m.h}px  子元素 ${m.kids} 个`);
  }
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.card.toolbar button')].find((x) => /^改单$/.test(x.textContent.trim()));
    if (btn) btn.style.display = '';
  });

  // —— E. 备选落点：.view-seg-row ——
  const E = await measure('.view-seg-row');
  console.log('\n===== E. 备选落点 .view-seg-row（非编辑态常显行）=====');
  console.log('可用宽', E.avail, '所需宽', E.need, '余量', E.slack, '行数', E.rows, '行高', E.h);
  console.log('控件:', E.kids.map((k) => `${k.n}[${k.w}]`).join(' '));
  await p.evaluate(() => {
    const row = document.querySelector('.view-seg-row');
    const src = [...document.querySelectorAll('.card.toolbar button')].find((x) => /^改单$/.test(x.textContent.trim()));
    if (row && src) {
      const c = src.cloneNode(true);
      c.id = '__sim_edit2';
      row.appendChild(c);
    }
  });
  await sleep(700);
  const E2 = await measure('.view-seg-row');
  console.log(`塞入「改单」后: 所需宽 ${E2.need}  余量 ${E2.slack}  行数 ${E2.rows}  行高 ${E2.h}`);
  await p.evaluate(() => {
    const c = document.getElementById('__sim_edit2');
    if (c) c.remove();
  });

  // —— F. 🔴 跨视图回归证据：切到「逐单补录」看 .grid-ctl-row 与「改单」还在不在 ——
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await sleep(600);
  const beforeSwitch = await p.evaluate(() => ({
    gridRow: !!document.querySelector('.grid-ctl-row'),
    editBtn: !!([...document.querySelectorAll('.card.toolbar button')].find((x) => /^改单$/.test(x.textContent.trim()))),
    viewSegRow: !!document.querySelector('.view-seg-row'),
    view: [...document.querySelectorAll('.view-seg button')].find((x) => /on/.test(x.className))?.textContent?.trim(),
  }));
  console.log('\n===== F. 跨视图验证 =====');
  console.log('切视图前（汇总表）:', JSON.stringify(beforeSwitch));
  const switched = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.view-seg button')].find((x) => /逐单补录/.test(x.textContent));
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(2500);
  const afterSwitch = await p.evaluate(() => ({
    gridRow: !!document.querySelector('.grid-ctl-row'),
    editBtn: !!([...document.querySelectorAll('.card.toolbar button')].find((x) => /^改单$/.test(x.textContent.trim()))),
    viewSegRow: !!document.querySelector('.view-seg-row'),
    view: [...document.querySelectorAll('.view-seg button')].find((x) => /on/.test(x.className))?.textContent?.trim(),
  }));
  console.log(`切到「逐单补录」(${switched}):`, JSON.stringify(afterSwitch));
  console.log(
    afterSwitch.gridRow
      ? '  → 表格工具行在两种视图下都存在'
      : '  🔴 表格工具行在「逐单补录」下不存在 —— 这是「下移 = 丢掉该视图入口」的硬证据'
  );

  // —— 截图：现状 / 模拟后 ——
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.view-seg button')].find((x) => /汇总表/.test(x.textContent));
    if (btn) btn.click();
  });
  await sleep(2200);
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await sleep(800);
  const shot = async (name, inject) => {
    if (inject) {
      await p.evaluate(() => {
        const row = document.querySelector('.grid-ctl-row');
        const src = [...document.querySelectorAll('.card.toolbar button')].find((x) => /^改单$/.test(x.textContent.trim()));
        if (row && src && !document.getElementById('__sim_shot')) {
          const c = src.cloneNode(true);
          c.id = '__sim_shot';
          row.appendChild(c);
        }
      });
      await sleep(500);
    } else {
      await p.evaluate(() => {
        const c = document.getElementById('__sim_shot');
        if (c) c.remove();
      });
      await sleep(300);
    }
    const r = await p.evaluate(() => {
      const el = document.querySelector('.grid-ctl-row');
      const rr = el.getBoundingClientRect();
      return [Math.max(0, Math.round(rr.left) - 16), Math.max(0, Math.round(rr.top) - 30), Math.round(rr.width) + 32, Math.round(rr.height) + 46];
    });
    await p.screenshot({ path: `${OUT}/${TAG}-${name}.png`, clip: { x: r[0], y: r[1], width: r[2], height: r[3] } });
  };
  await shot('grid-row-now', false);
  await shot('grid-row-with-editbtn', true);
  console.log(`\n截图: ${OUT}/${TAG}-grid-row-{now,with-editbtn}.png`);

  await b.close();
})();
