// v210 诊断⑤：为什么「单击数量格」点到了 `td.seq-cell` 而不是 input？
// 背景：S3 的 clickCell(5,8) 返回 {topTag:"TD", topCls:"td seq-cell", hitIsSelf:false}
//   ⇒ 鼠标点在了**粘性序号列**上（源码：.cross-tbl .seq-cell{position:sticky;left:0;z-index:6}）。
//   而 S1-6 对同一个格子的点击是成功的 —— 差别只在「之前有没有按过 End / PageDown」。
// 本诊断的目的：把几何关系量出来（谁盖住谁、容器 scrollLeft 多少），而不是靠猜。
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GEO = (r, c) => `(() => {
  const ins = Array.from(document.querySelectorAll('.edit-tbl input[data-r="${r}"][data-c="${c}"]'))
  const desc = (el) => {
    if (!el) return null
    const rc = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      tag: el.tagName, cls: String(el.className || '').slice(0, 46),
      rect: [Math.round(rc.left), Math.round(rc.top), Math.round(rc.width), Math.round(rc.height)],
      vis: cs.visibility, op: cs.opacity, pe: cs.pointerEvents, pos: cs.position, z: cs.zIndex, tr: cs.transform,
      n2: el.closest('.edit-tbl') ? Array.from(document.querySelectorAll('.edit-tbl')).indexOf(el.closest('.edit-tbl')) : null,
    }
  }
  const out = { matchCount: ins.length, inputs: ins.map(desc) }
  if (ins.length) {
    const el = ins[0]
    const rc = el.getBoundingClientRect()
    const x = Math.round(rc.left + rc.width / 2), y = Math.round(rc.top + rc.height / 2)
    out.center = [x, y]
    out.stack = document.elementsFromPoint(x, y).slice(0, 6).map((e) => {
      const r2 = e.getBoundingClientRect()
      return e.tagName + '.' + String(e.className || '').slice(0, 30) + ' @' + [Math.round(r2.left), Math.round(r2.top), Math.round(r2.width), Math.round(r2.height)].join(',')
    })
    // 祖先链上的滚动容器
    out.scrollers = []
    let n = el.parentElement
    while (n && n !== document.body) {
      const cs = getComputedStyle(n)
      if (/(auto|scroll|hidden)/.test(cs.overflowX + cs.overflowY)) {
        const r3 = n.getBoundingClientRect()
        out.scrollers.push({
          tag: n.tagName, cls: String(n.className || '').slice(0, 30),
          ox: cs.overflowX, oy: cs.overflowY,
          sl: n.scrollLeft, st: n.scrollTop, sw: n.scrollWidth, cw: n.clientWidth, sh: n.scrollHeight, ch: n.clientHeight,
          rect: [Math.round(r3.left), Math.round(r3.top), Math.round(r3.width), Math.round(r3.height)],
        })
      }
      n = n.parentElement
    }
  }
  // 粘性序号列的几何
  out.seq = Array.from(document.querySelectorAll('.cross-tbl .seq-cell')).slice(0, 3).map((e) => {
    const r4 = e.getBoundingClientRect()
    return [Math.round(r4.left), Math.round(r4.top), Math.round(r4.width), Math.round(r4.height)]
  })
  // 同行的名称格做横向参照
  const nm = document.querySelector('.edit-tbl input[data-r="${r}"][data-c="0"]')
  if (nm) { const r5 = nm.getBoundingClientRect(); out.nameCellRect = [Math.round(r5.left), Math.round(r5.top), Math.round(r5.width), Math.round(r5.height)] }
  out.tblCount = document.querySelectorAll('.edit-tbl').length
  out.qtyMaxC = (() => { let m = -1; document.querySelectorAll('.edit-tbl input.cell-qty[data-r]').forEach((e) => { const v = Number(e.getAttribute('data-c')); if (v > m) m = v }); return m })()
  out.qtyMaxCNoExtra = (() => { let m = -1; document.querySelectorAll('.edit-tbl td:not(.extra) input.cell-qty[data-r]').forEach((e) => { const v = Number(e.getAttribute('data-c')); if (v > m) m = v }); return m })()
  out.extraTdCls = (() => { const e = document.querySelector('.edit-tbl input.cell-qty[data-r]'); return e ? String(e.closest('td').className) : null })()
  return JSON.stringify(out)
})()`

process.on('unhandledRejection', (e) => { console.log('UNHANDLED_REJECTION: ' + (e && e.stack ? e.stack : String(e))) });
console.log('DIAG5 START  token=' + (process.env.HG_TOKEN ? 'set' : 'MISSING'));

(async () => {
  console.log('A: launching chrome...');
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  console.log('B: chrome up');
  const p = await b.newPage();
  console.log('C: page ready');
  p.on('dialog', (d) => d.accept());
  await p.setViewport({ width: 1600, height: 950, deviceScaleFactor: 1 });
  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2000);
  await p.evaluate((tok, tid, uname) => {
    localStorage.setItem('hergent_v2_token', tok);
    localStorage.setItem('hergent_v2_tenant', String(tid));
    localStorage.setItem('hergent_v2_user', JSON.stringify({ id: 0, username: uname, display_name: '沙箱验证账号', role: 'boss' }));
  }, process.env.HG_TOKEN, process.env.HG_TENANT, process.env.HG_USER || 'sbx_v210');
  await p.goto('https://hergent.cn/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2600);
  await p.evaluate(() => { const el = Array.from(document.querySelectorAll('a')).find((x) => x.getAttribute('href') === '#/forecast'); el && el.click() });
  await sleep(4200);
  const picked = await p.evaluate((mark) => {
    const sel = document.querySelector('.sel-period'); if (!sel) return null;
    const opts = Array.from(sel.options).filter((o) => o.value && o.value !== '0');
    const opt = (mark && opts.find((o) => String(o.text).indexOf(mark) >= 0)) || opts[0];
    if (!opt) return null; sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return opt.text;
  }, process.env.HG_PERIOD_MARK);
  await sleep(3400);
  console.log('期次: ' + picked);
  await p.evaluate(`(() => { const btn = Array.from(document.querySelectorAll('button')).find((x) => /^改单$/.test(String(x.textContent).trim())); btn && btn.click() })()`);
  await sleep(5200);
  console.log('编辑网格 input 数: ' + await p.evaluate(`document.querySelectorAll('.edit-tbl input[data-r]').length`));

  console.log('\n===== A. 刚进编辑态，原生状态下的 (5,8) =====');
  console.log(await p.evaluate(GEO(5, 8)));

  console.log('\n===== B. 复现 S2 的末尾状态（focus 一格 → End → Home → PageDown）=====');
  await p.evaluate(`(() => { const el = document.querySelector('.edit-tbl input[data-r="5"][data-c="8"]'); el && el.focus() })()`);
  await sleep(300);
  await p.keyboard.press('End'); await sleep(400);
  await p.keyboard.press('Home'); await sleep(400);
  await p.keyboard.press('PageDown'); await sleep(500);
  console.log(await p.evaluate(GEO(5, 8)));

  console.log('\n===== C. 再模拟 S3 第一步 clickCell(0,0)（scrollIntoView center）之后 =====');
  await p.evaluate(() => { const el = document.querySelector('.edit-tbl input[data-r="0"][data-c="0"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' }) });
  await sleep(300);
  console.log(await p.evaluate(GEO(5, 8)));

  await b.close();
})();
