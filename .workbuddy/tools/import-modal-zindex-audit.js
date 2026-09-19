// 导入弹窗 vs 预报工具栏浮层 的层叠诊断
// 用法：NODE_PATH=<ws>/node_modules node import-modal-zindex-audit.js [tag] [baseUrl]
// 判据：导入弹窗打开后，其矩形内任一取点的 elementFromPoint 应命中弹窗内部元素，
//       而不是工具栏 .tb-pop / .tb-pop-panel / 其他 fixed 高 z 元素。
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = process.argv[2] || 'now';
const BASE = process.argv[3] || 'https://hergent.cn';
const OUT = '/tmp/imp-z';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await p.goto(BASE + '/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2200);
  await p.evaluate(() => { const el = [...document.querySelectorAll('button,a')].find(x => /演示/.test(x.textContent)); el && el.click(); });
  await sleep(3500);
  // 进预报页
  await p.evaluate(() => { const a = [...document.querySelectorAll('a')].find(x => /预报订货|预报/.test(x.textContent)); a && a.click(); });
  await sleep(4500);

  // 若期次未选，先选第一个有效期次，确保表格与品牌按钮渲染
  await p.evaluate(() => {
    const sel = document.querySelector('select.sel-period');
    if (sel && sel.value === '0') {
      const opt = [...sel.options].find(o => o.value && o.value !== '0');
      if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }
  });
  await sleep(4000);

  // 记录弹窗打开前的工具栏状态
  const before = await p.evaluate(() => ({
    tbPops: [...document.querySelectorAll('.tb-pop')].map(x => ({
      txt: (x.textContent || '').trim().slice(0, 12), z: getComputedStyle(x).zIndex,
    })),
    hasBrandBtn: !!document.querySelector('.grid-ctl-row .tb-pop'),
    hasImportBtn: [...document.querySelectorAll('button')].some(x => /导入/.test(x.textContent)),
  }));
  console.log('=== 打开导入弹窗前 ===');
  console.log(JSON.stringify(before, null, 1));

  // 点「导入」
  const clicked = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(x => /导入/.test(x.textContent) && !x.disabled);
    if (!btn) return 'no-import-btn';
    btn.click();
    return 'clicked:' + (btn.textContent || '').trim().slice(0, 10);
  });
  console.log('点击结果:', clicked);
  await sleep(1200);

  const r = await p.evaluate(() => {
    const R = el => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), rt: Math.round(r.right) }; };
    const modal = document.querySelector('.imp-modal');
    const ovl = document.querySelector('.imp-overlay');
    if (!modal) return { err: 'no .imp-modal（弹窗未出现）' };
    const pr = R(modal);

    // ① 弹窗内四个取点做命中测试（中心 / 标题栏 / 底部 / 四角内缩）
    const probePts = [
      ['中心', Math.round(pr.l + pr.w / 2), Math.round(pr.t + pr.h / 2)],
      ['标题栏', Math.round(pr.l + 60), Math.round(pr.t + 16)],
      ['左上内', Math.round(pr.l + 8), Math.round(pr.t + 8)],
      ['右上内', Math.round(pr.rt - 8), Math.round(pr.t + 8)],
      ['底部', Math.round(pr.l + pr.w / 2), Math.round(pr.b - 12)],
    ];
    const probes = probePts.map(([name, x, y]) => {
      const top = document.elementFromPoint(x, y);
      return {
        name, pt: [x, y],
        topEl: top ? (top.tagName.toLowerCase() + '.' + (top.className || '').toString().split(' ')[0]) : null,
        inModal: top ? !!top.closest('.imp-modal') : false,
        inTbPop: top ? !!top.closest('.tb-pop') : false,
        inTbPanel: top ? !!top.closest('.tb-pop-panel') : false,
      };
    });

    // ② 工具栏各 .tb-pop 与弹窗的重叠 + 命中
    const tbpops = [...document.querySelectorAll('.tb-pop')].map(x => {
      const rr = R(x), z = getComputedStyle(x).zIndex;
      const overlap = !(rr.rt < pr.l || rr.l > pr.rt || rr.b < pr.t || rr.t > pr.b);
      let hit = null;
      if (overlap) {
        const cx = Math.round(rr.l + rr.w / 2), cy = Math.round(rr.t + rr.h / 2);
        const top = document.elementFromPoint(cx, cy);
        hit = { pt: [cx, cy], topEl: top ? (top.tagName.toLowerCase() + '.' + (top.className || '').toString().split(' ')[0]) : null, inModal: top ? !!top.closest('.imp-modal') : false, inTbPop: top ? !!top.closest('.tb-pop') : false };
      }
      return { txt: (x.textContent || '').trim().slice(0, 12), z, rect: rr, overlap, hit };
    });

    // ③ 全屏范围内所有「fixed + z-index 高于弹窗」的元素 —— 完整遮挡清单
    const modalZ = parseInt(getComputedStyle(modal).zIndex, 10) || 0;
    const higher = [];
    document.querySelectorAll('*').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return;
      const z = parseInt(cs.zIndex, 10);
      if (!z || z <= modalZ) return;
      const rr = R(el);
      if (rr.w === 0 || rr.h === 0) return;
      const overlap = !(rr.rt < pr.l || rr.l > pr.rt || rr.b < pr.t || rr.t > pr.b);
      if (!overlap) return;
      higher.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().split(' ').slice(0, 2).join('.'), z, rect: rr, txt: (el.textContent || '').trim().slice(0, 14) });
    });

    // ④ 祖先链（谁给弹窗定位上下文）
    const chain = []; let el = modal;
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      chain.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 30), z: cs.zIndex, pos: cs.position, bf: cs.backdropFilter && cs.backdropFilter !== 'none' ? 'yes' : '', tf: cs.transform !== 'none' ? 'yes' : '', filter: cs.filter !== 'none' ? 'yes' : '' });
      el = el.parentElement;
    }

    return {
      modalZ: getComputedStyle(modal).zIndex, overlayZ: ovl ? getComputedStyle(ovl).zIndex : null,
      modalRect: pr, parent: modal.parentElement.tagName,
      probes, tbpops, higher, chain,
    };
  });

  if (r.err) { console.log('✘', r.err); await b.screenshot({ path: `${OUT}/${TAG}-nomodal.png` }); await b.close(); return; }
  console.log(`\n=== 层级 ===\n.imp-modal z=${r.modalZ}  .imp-overlay z=${r.overlayZ}  挂载父=${r.parent}`);
  console.log(`弹窗 rect=${JSON.stringify(r.modalRect)}`);
  console.log(`\n=== 弹窗内取点命中测试（应全部 inModal=true）===`);
  for (const x of r.probes) console.log(`  ${x.name}${JSON.stringify(x.pt)} → ${x.topEl}  inModal=${x.inModal}${x.inTbPop ? '  ✘ 被 .tb-pop 遮挡' : ''}${x.inTbPanel ? '  ✘ 被 .tb-pop-panel 遮挡' : ''}`);
  console.log(`\n=== 工具栏 .tb-pop（触发按钮）===`);
  for (const t of r.tbpops) console.log(`  「${t.txt}」z=${t.z} overlap=${t.overlap}${t.hit ? `  ${JSON.stringify(t.hit.pt)} → ${t.hit.topEl}  inModal=${t.hit.inModal} ${t.hit.inTbPop ? '✘ 工具栏按钮浮在弹窗之上' : ''}` : ''}`);
  console.log(`\n=== 全屏范围内 z 高于弹窗且与之重叠的元素（完整遮挡清单）===`);
  if (!r.higher.length) console.log('  （无）');
  for (const h of r.higher) console.log(`  ${h.tag}.${h.cls} z=${h.z} rect=${JSON.stringify(h.rect)} txt="${h.txt}"`);
  console.log(`\n=== .imp-modal 祖先链 ===`);
  for (const c of r.chain) console.log(`  ${c.tag}.${c.cls} z=${c.z} pos=${c.pos} ${c.bf ? 'backdrop-filter ' : ''}${c.tf ? 'transform ' : ''}${c.filter ? 'filter' : ''}`);

  await p.screenshot({ path: `${OUT}/${TAG}-full.png` });
  await b.close();
  console.log('\n截图 → ' + OUT);
})();
