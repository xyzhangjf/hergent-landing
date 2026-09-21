// v210 诊断⑥：编辑网格的「拖框选」到底能不能用？从输入框里起拖 vs 从单元格空白处起拖。
// 假设（待证）：从 <input> 上起拖时浏览器进入**原生文本选择**，期间不再向其它元素派发 mouseover
//   ⇒ onCellOver 永不触发 ⇒ selRange 永远是 0。
//   而 onCellDown 里 `_dragEditing = (target.tagName === 'INPUT')` 时不 preventDefault —— 正是这一点放行了原生拖选。
// 目的：拿到「mouseover 到底有没有派发」的硬证据，再决定这是真缺陷还是探针姿势不对。
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
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

  /* 装计数器：捕获阶段监听 mouseover / mousemove / selectstart，记到 window.__cnt */
  await p.evaluate(`(() => {
    window.__cnt = { over: 0, overTd: 0, move: 0, select: 0, overTargets: [] }
    document.addEventListener('mouseover', (e) => {
      window.__cnt.over++
      const td = e.target.closest && e.target.closest('td')
      if (td) window.__cnt.overTd++
      if (window.__cnt.overTargets.length < 6) window.__cnt.overTargets.push((e.target.tagName || '') + '.' + String(e.target.className || '').slice(0, 20))
    }, true)
    document.addEventListener('mousemove', () => { window.__cnt.move++ }, true)
    document.addEventListener('selectstart', () => { window.__cnt.select++ }, true)
  })()`);

  /* 把 (5,8) 数量列的 td 与 input 几何量出来：input 居中，两侧各约 7px 空白 */
  const geo = JSON.parse(await p.evaluate(`(() => {
    const el = document.querySelector('.edit-tbl input[data-r="5"][data-c="8"]')
    if (!el) return JSON.stringify({ err: 'no cell' })
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' })
    const wrap = el.closest('.table-wrap'), td = el.closest('td')
    const wr = wrap.getBoundingClientRect(), er = el.getBoundingClientRect()
    const contentX = er.left - wr.left + wrap.scrollLeft
    wrap.scrollLeft = Math.max(0, Math.min(wrap.scrollWidth - wrap.clientWidth, contentX + er.width / 2 - wrap.clientWidth / 2))
    const e2 = el.getBoundingClientRect(), t2 = td.getBoundingClientRect()
    return JSON.stringify({
      inputCenter: [Math.round(e2.left + e2.width / 2), Math.round(e2.top + e2.height / 2)],
      inputRect: [Math.round(e2.left), Math.round(e2.top), Math.round(e2.width), Math.round(e2.height)],
      tdRect: [Math.round(t2.left), Math.round(t2.top), Math.round(t2.width), Math.round(t2.height)],
      padLeftX: Math.round(t2.left + 3),
      rowBelowY: Math.round(t2.top + t2.height + 20),
      tdBelowRect: (() => { const td2 = document.querySelector('.edit-tbl input[data-r="7"][data-c="8"]'); if (!td2) return null; const r = td2.closest('td').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] })(),
    })
  })()`))
  console.log('几何: ' + JSON.stringify(geo));

  const state = async () => p.evaluate(`(() => ({
    selRange: document.querySelectorAll('.range-sel').length,
    selTd: document.querySelectorAll('.edit-tbl td.selected').length,
    active: (document.activeElement ? document.activeElement.tagName + '.' + String(document.activeElement.className || '').slice(0, 18) : null),
    nativeSel: (() => { const s = window.getSelection(); return s ? String(s).slice(0, 12) : null })(),
    cnt: window.__cnt,
  }))()`);
  const reset = () => p.evaluate(`(() => { window.__cnt = { over: 0, overTd: 0, move: 0, select: 0, overTargets: [] } })()`);

  /* ---- 实验 A：从**输入框内**起拖 ---- */
  await reset();
  await p.mouse.move(geo.inputCenter[0], geo.inputCenter[1]);
  await p.mouse.down();
  await sleep(150);
  await p.mouse.move(geo.inputCenter[0] + 30, geo.inputCenter[1] + 12, { steps: 4 });
  await sleep(200);
  const aMid = await state();
  await p.mouse.move(geo.tdBelowRect ? geo.tdBelowRect[0] + 45 : geo.inputCenter[0], geo.tdBelowRect ? geo.tdBelowRect[1] + 20 : geo.inputCenter[1] + 82, { steps: 8 });
  await sleep(250);
  const aEnd = await state();
  await p.mouse.up();
  await sleep(250);
  const aUp = await state();
  console.log('\n[A] 从输入框内起拖')
  console.log('   移动中: ' + JSON.stringify(aMid))
  console.log('   到端点: ' + JSON.stringify(aEnd))
  console.log('   抬起后: ' + JSON.stringify(aUp))

  /* ---- 实验 B：从**单元格左侧空白（非输入框）**起拖 ---- */
  await reset();
  await p.mouse.move(geo.padLeftX, geo.inputCenter[1]);
  await p.mouse.down();
  await sleep(150);
  await p.mouse.move(geo.padLeftX + 40, geo.inputCenter[1] + 12, { steps: 4 });
  await sleep(200);
  const bMid = await state();
  await p.mouse.move(geo.tdBelowRect ? geo.tdBelowRect[0] + 45 : geo.padLeftX + 45, geo.tdBelowRect ? geo.tdBelowRect[1] + 20 : geo.inputCenter[1] + 82, { steps: 8 });
  await sleep(250);
  const bEnd = await state();
  await p.mouse.up();
  await sleep(250);
  const bUp = await state();
  console.log('\n[B] 从单元格空白处（非输入框）起拖')
  console.log('   移动中: ' + JSON.stringify(bMid))
  console.log('   到端点: ' + JSON.stringify(bEnd))
  console.log('   抬起后: ' + JSON.stringify(bUp))

  await b.close();
})();
