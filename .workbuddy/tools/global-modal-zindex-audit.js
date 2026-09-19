// 全局模态层（.pf-mask / .cmd-mask / .md-sheet）vs 预报页工具栏 .tb-pop(1120) 的层叠诊断
// 用法：NODE_PATH=<ws>/node_modules node global-modal-zindex-audit.js [tag] [baseUrl]
// 判据：浮层打开后，其矩形内取点的 elementFromPoint 应命中浮层内部元素，
//       而不是工具栏 .tb-pop / .tb-pop-panel。
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = process.argv[2] || 'now';
const BASE = process.argv[3] || 'https://hergent.cn';
const OUT = '/tmp/gm-z';
fs.mkdirSync(OUT, { recursive: true });

const RECT = `const R = el => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), rt: Math.round(r.right) }; };
const ov = (a, b) => !(a.rt < b.l || a.l > b.rt || a.b < b.t || a.t > b.b);
const nm = el => el ? (el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0]) : null;`;

// 通用：给定浮层选择器（容器 / 内容），输出层级 + 与所有 .tb-pop 的重叠与命中
function probeScript(containerSel, innerSel) {
  return `(() => {
  ${RECT}
  const c = document.querySelector(${JSON.stringify(containerSel)});
  const inner = document.querySelector(${JSON.stringify(innerSel)});
  if (!c) return { err: 'no ' + ${JSON.stringify(containerSel)} };
  const cr = R(c);
  const probes = [
    ['中心', Math.round(cr.l + cr.w / 2), Math.round(cr.t + cr.h / 2)],
    ['上部', Math.round(cr.l + cr.w / 2), Math.round(cr.t + 20)],
    ['左上内', Math.round(cr.l + 8), Math.round(cr.t + 8)],
  ];
  const pOut = probes.map(([name, x, y]) => {
    const top = document.elementFromPoint(x, y);
    return { name, pt: [x, y], topEl: nm(top),
      inSelf: !!(top && top.closest(${JSON.stringify(containerSel)})),
      inTbPop: !!(top && top.closest('.tb-pop')),
      inTbPanel: !!(top && top.closest('.tb-pop-panel')) };
  });
  const tbpops = [...document.querySelectorAll('.tb-pop')].map(x => {
    const rr = R(x), z = getComputedStyle(x).zIndex;
    const overlap = ov(rr, cr);
    let hit = null;
    if (overlap) {
      const cx = Math.round(rr.l + rr.w / 2), cy = Math.round(rr.t + rr.h / 2);
      const top = document.elementFromPoint(cx, cy);
      hit = { pt: [cx, cy], topEl: nm(top),
        inSelf: !!(top && top.closest(${JSON.stringify(containerSel)})),
        inTbPop: !!(top && top.closest('.tb-pop')) };
    }
    return { txt: (x.textContent || '').trim().slice(0, 12), z, rect: rr, overlap, hit };
  });
  // 祖链：找最近的非 auto z-index 祖先（等效全局 z 的线索）
  const chain = []; let el = c;
  while (el && el !== document.documentElement) {
    const cs = getComputedStyle(el);
    chain.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 28),
      z: cs.zIndex, pos: cs.position,
      bf: (cs.backdropFilter && cs.backdropFilter !== 'none') ? 'bf' : '',
      tf: cs.transform !== 'none' ? 'tf' : '', iso: cs.isolation !== 'auto' ? 'iso' : '' });
    el = el.parentElement;
  }
  return { selfZ: getComputedStyle(c).zIndex, innerZ: inner ? getComputedStyle(inner).zIndex : null,
    rect: cr, parentTag: c.parentElement ? c.parentElement.tagName : null, probes: pOut, tbpops, chain };
})()`;
}

function report(title, r) {
  console.log(`\n########## ${title} ##########`);
  if (!r || r.err) { console.log('  ✘', r ? r.err : 'null'); return; }
  console.log(`  浮层 z=${r.selfZ}  内容 z=${r.innerZ}  挂载父=${r.parentTag}  rect=${JSON.stringify(r.rect)}`);
  console.log('  -- 浮层内取点命中（应全部 inSelf=true）--');
  for (const x of r.probes)
    console.log(`    ${x.name}${JSON.stringify(x.pt)} → ${x.topEl}  inSelf=${x.inSelf}${x.inTbPop ? '  ✘ 被 .tb-pop 遮挡' : ''}${x.inTbPanel ? '  ✘ 被 .tb-pop-panel 遮挡' : ''}`);
  console.log('  -- 工具栏 .tb-pop（1120）--');
  for (const t of r.tbpops)
    console.log(`    「${t.txt}」z=${t.z} overlap=${t.overlap}${t.hit ? `  ${JSON.stringify(t.hit.pt)} → ${t.hit.topEl}  inSelf=${t.hit.inSelf}${t.hit.inTbPop ? '  ✘ 按钮浮在浮层之上' : ''}` : ''}`);
  console.log('  -- 祖链（z / pos / 各 context 触发项）--');
  for (const c of r.chain)
    console.log(`    ${c.tag}.${c.cls} z=${c.z} pos=${c.pos} ${c.bf} ${c.tf} ${c.iso}`.trimEnd());
}

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await p.goto(BASE + '/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3500);
  await p.evaluate(() => { const a = [...document.querySelectorAll('a')].find(x => /预报订货|预报/.test(x.textContent)); a && a.click(); });
  await sleep(4500);
  await p.evaluate(() => {
    const sel = document.querySelector('select.sel-period');
    if (sel && sel.value === '0') {
      const opt = [...sel.options].find(o => o.value && o.value !== '0');
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }
  });
  await sleep(4000);

  const env = await p.evaluate(() => ({
    tbPopCount: document.querySelectorAll('.tb-pop').length,
    tbPopZ: [...new Set([...document.querySelectorAll('.tb-pop')].map(x => getComputedStyle(x).zIndex))],
    brandBtn: !!document.querySelector('.grid-ctl-row .tb-pop'),
    mnavVisible: getComputedStyle(document.querySelector('.mnav') || document.body).display,
  }));
  console.log('=== 环境 ===', JSON.stringify(env));

  // ---------- 场景 A：修改资料弹窗 .pf-mask ----------
  try {
    await p.evaluate(() => {
      const u = document.querySelector('.tb-user'); u && u.click();
    });
    await sleep(600);
    await p.evaluate(() => {
      const it = [...document.querySelectorAll('.tb-menu-item')].find(x => /修改资料/.test(x.textContent));
      it && it.click();
    });
    await sleep(1200);
    report('A. 修改资料弹窗 (.pf-mask / .pf-modal) @预报页 1440x900', await p.evaluate(probeScript('.pf-mask', '.pf-modal')));
    await p.screenshot({ path: `${OUT}/${TAG}-A-pfmask.png` });
    await p.evaluate(() => { const m = document.querySelector('.pf-mask'); m && m.click(); });
    await sleep(700);
  } catch (e) { console.log('A 场景异常:', e.message); }

  // ---------- 场景 B：命令面板 .cmd-mask ----------
  try {
    await p.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK', metaKey: true, shiftKey: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true, bubbles: true }));
    });
    await sleep(1200);
    report('B. 命令面板 (.cmd-mask / .cmd-panel) @预报页 1440x900', await p.evaluate(probeScript('.cmd-mask', '.cmd-panel')));
    await p.screenshot({ path: `${OUT}/${TAG}-B-cmdmask.png` });
    await p.evaluate(() => { const m = document.querySelector('.cmd-mask'); m && m.click(); });
    await sleep(700);
  } catch (e) { console.log('B 场景异常:', e.message); }

  // ---------- 场景 D：用户菜单 .tb-menu / .tb-menu-mask（顶栏内，等效 z = .topbar 的 10）----------
  try {
    await p.evaluate(() => { const u = document.querySelector('.tb-user'); u && u.click(); });
    await sleep(700);
    const d = await p.evaluate(() => {
      const R = el => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), rt: Math.round(r.right) }; };
      const nm = el => el ? (el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0]) : null;
      const menu = document.querySelector('.tb-menu');
      const mask = document.querySelector('.tb-menu-mask');
      if (!menu) return { err: 'no .tb-menu（菜单未打开）' };
      const mr = R(menu);
      const menuHit = document.elementFromPoint(Math.round(mr.l + mr.w / 2), Math.round(mr.t + 18));
      const topbar = document.querySelector('.topbar');
      // mask 理论覆盖全屏：取样工具栏 .tb-pop 中心，看 mask 是否还能收到点击
      let maskProbe = null;
      const tbp = document.querySelector('.tb-pop');
      if (tbp) {
        const rr = R(tbp);
        const x = Math.round(rr.l + rr.w / 2), y = Math.round(rr.t + rr.h / 2);
        const top = document.elementFromPoint(x, y);
        maskProbe = { pt: [x, y], topEl: nm(top), isMask: top === mask, inTbPop: !!(top && top.closest('.tb-pop')) };
      }
      return { menuZ: getComputedStyle(menu).zIndex, maskZ: mask ? getComputedStyle(mask).zIndex : null,
        topbarZ: topbar ? getComputedStyle(topbar).zIndex : null, menuRect: mr,
        menuHit: { topEl: nm(menuHit), inMenu: !!(menuHit && menuHit.closest('.tb-menu')) }, maskProbe };
    });
    console.log('\n########## D. 用户菜单 (.tb-menu / .tb-menu-mask) @预报页 1440x900 ##########');
    if (d.err) console.log('  ✘', d.err); else {
      console.log(`  .tb-menu z=${d.menuZ}（父 .topbar z=${d.topbarZ}，context 内）  .tb-menu-mask z=${d.maskZ}  rect=${JSON.stringify(d.menuRect)}`);
      console.log(`  菜单中心命中 → ${d.menuHit.topEl}  inMenu=${d.menuHit.inMenu}${d.menuHit.inMenu ? '' : '  ✘ 菜单被页面元素压住'}`);
      if (d.maskProbe) console.log(`  遮罩取样${JSON.stringify(d.maskProbe.pt)} → ${d.maskProbe.topEl}  isMask=${d.maskProbe.isMask}${d.maskProbe.inTbPop ? '  ✘ 工具栏按钮压住遮罩（点它不会关菜单）' : ''}`);
    }
    await p.screenshot({ path: `${OUT}/${TAG}-D-tbmenu.png` });
    await p.evaluate(() => { const m = document.querySelector('.tb-menu-mask'); m && m.click(); });
    await sleep(600);
  } catch (e) { console.log('D 场景异常:', e.message); }

  // ---------- 场景 C：移动端底部抽屉 .md-sheet ----------
  try {
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await sleep(2500);
    const mob = await p.evaluate(() => ({ mnav: getComputedStyle(document.querySelector('.mnav') || document.body).display, tbPopCount: document.querySelectorAll('.tb-pop').length }));
    console.log('\n=== 移动端环境 ===', JSON.stringify(mob));
    await p.evaluate(() => {
      const btn = [...document.querySelectorAll('.mnav-item,button')].find(x => /更多/.test(x.textContent));
      btn && btn.click();
    });
    await sleep(1200);
    report('C. 移动端更多抽屉 (.md-sheet) @预报页 390x844', await p.evaluate(probeScript('.md-sheet', '.md-sheet')));
    await p.screenshot({ path: `${OUT}/${TAG}-C-mdsheet.png` });
  } catch (e) { console.log('C 场景异常:', e.message); }

  await b.close();
  console.log('\n截图 → ' + OUT);
})();
