// 「改单 + 编辑组」下移到表格工具行（含**全屏态**）—— 容量实测
//
// 背景（用户诉求）：「用户大概率会用全屏功能来查看和修改预报订单，所以要把这些按钮放在
//   表格工具栏，便于用户在全屏模式下直接操作，不需要退出全屏模式才能进行操作」
//
// 源码级佐证：全屏层 `.grid-area.is-fs{position:fixed;inset:0;z-index:1000}`
//   会**盖住主工具栏**（`toggleGridFullscreen()` 上方 v129 注释已自陈）⇒
//   全屏时主工具栏上的「改单」「保存」点不到。解法方向 = 搬进 `.grid-ctl-row`
//   （它在 `.grid-area` 内部，全屏时仍可见）。
//
// 量：
//   ① 只读/编辑 × 非全屏/全屏 的表格工具行容量（可用宽 / 所需宽 / 余量 / 行数）
//   ② 把「改单」/「编辑组」塞进表格工具行后是否折行（编辑组用**真实元素克隆**，宽度 100% 准确）
//   ③ 全屏下主工具栏的「改单」位置命中谁（elementFromPoint 命中测试 = 痛点复现/证伪）
//   ④ 编辑组各控件真实宽度（供方案试算）
//
// 用法：NODE_PATH=<ws>/node_modules node v209-forecast-toolbar-fs-fit.js [tag]
// 全程只读：仅 DOM 克隆 / inline style / 切全屏（纯前端状态）；进编辑态只读、不保存。
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAG = process.argv[2] || 'v209';
const OUT = '/tmp/fc-fs-fit';
fs.mkdirSync(OUT, { recursive: true });
const VPS = [1280, 1366, 1440, 1680, 1920];

(async () => {
  const b = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const p = await b.newPage();
  p.on('dialog', (d) => d.accept()); // enterEdit 的 entryRoleWarn confirm
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
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

  const picked = await p.evaluate(() => {
    const sel = document.querySelector('.sel-period');
    if (!sel) return null;
    const opt = [...sel.options].find((o) => o.value && o.value !== '0');
    if (!opt) return null;
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt.text;
  });
  await sleep(2600);
  console.log('期次:', picked || '(演示账号无期次)');

  /* ---------- 量测器（need 含 margin + gap，逐字抄自 forecast-editbtn-relocate-fit.js） ---------- */
  const measure = (sel) =>
    p.evaluate((s) => {
      const row = document.querySelector(s);
      if (!row) return { err: 'no ' + s };
      const vis = (el) => {
        const st = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0.5;
      };
      const cs = getComputedStyle(row);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const gap = parseFloat(cs.columnGap) || 0;
      const kids = [...row.children].filter(vis);
      const need =
        kids.reduce((sum, c) => {
          const s2 = getComputedStyle(c);
          return sum + c.getBoundingClientRect().width + (parseFloat(s2.marginLeft) || 0) + (parseFloat(s2.marginRight) || 0);
        }, 0) + gap * Math.max(0, kids.length - 1);
      const avail = row.clientWidth - padX;
      const tops = kids.map((c) => Math.round(c.getBoundingClientRect().top));
      const rows = [...new Set(tops.filter((t, i, a) => !a.some((x, j) => j < i && Math.abs(x - t) <= 6)))].length;
      const rr = row.getBoundingClientRect();
      return {
        avail: Math.round(avail),
        need: Math.round(need),
        slack: Math.round(avail - need),
        rows,
        h: Math.round(rr.height),
        gap: Math.round(gap),
        kids: kids.map((c) => ({
          n: (c.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 12) || (c.className || '').toString().split(' ')[0],
          w: Math.round(c.getBoundingClientRect().width),
        })),
      };
    }, sel);

  const dump = async (label, sel) => {
    console.log('\n===== ' + label + ' =====');
    console.log('视口   行数  行高  可用宽  所需宽   余量   控件明细');
    for (const vw of VPS) {
      await p.setViewport({ width: vw, height: 900, deviceScaleFactor: 1 });
      await sleep(880);
      const m = await measure(sel);
      if (m.err) {
        console.log(vw + '  ' + m.err);
        continue;
      }
      console.log(
        String(vw).padEnd(6) +
          ' ' + String(m.rows).padStart(4) +
          ' ' + String(m.h).padStart(5) +
          ' ' + String(m.avail).padStart(7) +
          ' ' + String(m.need).padStart(7) +
          ' ' + String(m.slack).padStart(7) + '   ' +
          m.kids.map((k) => k.n + '[' + k.w + ']').join(' ')
      );
    }
    await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await sleep(700);
  };

  const setFs = (on) =>
    p.evaluate((want) => {
      const has = !!document.querySelector('.grid-area.is-fs');
      if (has !== want) {
        const btn = document.querySelector('.grid-fs-btn');
        btn && btn.click();
      }
      return !!document.querySelector('.grid-area.is-fs');
    }, on);

  /* ================= A. 只读态 ================= */
  await dump('A1. 只读 · 非全屏 · 表格工具行', '.grid-ctl-row');

  await setFs(true);
  await sleep(1100);
  await dump('A2. 只读 · 全屏 · 表格工具行', '.grid-ctl-row');

  const inj1 = await p.evaluate(() => {
    const row = document.querySelector('.grid-ctl-row');
    const src = [...document.querySelectorAll('.card.toolbar button')].find((x) => /^改单$/.test(x.textContent.trim()));
    if (!row || !src) return false;
    const c = src.cloneNode(true);
    c.id = '__sim_edit';
    row.appendChild(c);
    return true;
  });
  console.log('\n[模拟] 只读 · 全屏 · 塞入「改单」: ' + inj1);
  await dump('A3. 只读 · 全屏 · 塞入「改单」后', '.grid-ctl-row');
  await p.evaluate(() => {
    const c = document.getElementById('__sim_edit');
    c && c.remove();
  });

  /* ---- A4. 痛点复现：全屏下主工具栏的「改单」位置，命中谁？ ---- */
  const hit = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.card.toolbar button')].find((x) => /^改单$/.test(x.textContent.trim()));
    if (!btn) return { err: 'no 改单' };
    const r = btn.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    const tcls = top ? (typeof top.className === 'string' ? top.className : top.tagName).toString().slice(0, 70) : null;
    return {
      btnBox: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      topEl: tcls,
      hitIsBtn: top === btn || (btn.contains && btn.contains(top)),
      fsLayerOn: !!document.querySelector('.grid-area.is-fs'),
    };
  });
  console.log('\n===== A4. 痛点复现：全屏下点「改单」所在坐标，最上层是谁 =====');
  console.log(JSON.stringify(hit, null, 1));

  await setFs(false);
  await sleep(900);

  /* ================= B. 编辑态 ================= */
  const entered = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('.card.toolbar button')].find((x) => /^改单$/.test(x.textContent.trim()));
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(4500);
  const isEdit = await p.evaluate(() => ({
    editGroup: !!document.querySelector('.tb-edit-group'),
    gridRow: !!document.querySelector('.grid-ctl-row'),
    rowCount: document.querySelectorAll('.grid-ctl-row').length,
  }));
  console.log('\n[进编辑态] clicked=' + entered + ' state=' + JSON.stringify(isEdit));

  if (isEdit.editGroup) {
    const grp = await p.evaluate(() =>
      [...document.querySelectorAll('.tb-edit-group > *')].map((c) => ({
        n: (c.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 14),
        w: Math.round(c.getBoundingClientRect().width),
      }))
    );
    const sum = grp.reduce((s, x) => s + x.w, 0);
    console.log('\n===== B0. 编辑组各控件真实宽度（主工具栏原位） =====');
    console.log(grp.map((x) => x.n + '[' + x.w + ']').join('  '));
    console.log('合计（不含 gap）= ' + sum + 'px；含 ' + (grp.length - 1) + ' 个 gap(8px) = ' + (sum + 8 * (grp.length - 1)) + 'px');

    await dump('B1. 编辑 · 非全屏 · 表格工具行', '.grid-ctl-row');

    await setFs(true);
    await sleep(1100);
    await dump('B2. 编辑 · 全屏 · 表格工具行', '.grid-ctl-row');

    const inj2 = await p.evaluate(() => {
      const row = document.querySelector('.grid-ctl-row');
      const g = document.querySelector('.tb-edit-group');
      if (!row || !g) return false;
      [...g.children].forEach((c, i) => {
        const k = c.cloneNode(true);
        k.id = '__sim_grp' + i;
        row.appendChild(k);
      });
      return true;
    });
    console.log('\n[模拟] 编辑 · 全屏 · 塞入编辑组（克隆真实元素）: ' + inj2);
    await dump('B3. 编辑 · 全屏 · 塞入编辑组后', '.grid-ctl-row');

    await setFs(false);
    await sleep(1000);
    await dump('B4. 编辑 · 非全屏 · 塞入编辑组后', '.grid-ctl-row');
  } else {
    console.log('⚠️ 未能进入编辑态，B 段测量跳过');
  }

  /* ================= 截图 ================= */
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await setFs(true);
  await sleep(1200);
  await p.screenshot({ path: OUT + '/' + TAG + '-edit-fs-withgrp.png' });
  console.log('\n截图: ' + OUT + '/' + TAG + '-edit-fs-withgrp.png');

  await b.close();
})();
