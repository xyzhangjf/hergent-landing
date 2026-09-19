// 定点探针：erp.hergent.cn 登录后主壳为何视觉为空（侧边栏/内容区）
// 用法：NODE_PATH=... node erp-shell-probe.js
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'https://erp.hergent.cn';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => console.log('   [pageerror]', String(e).slice(0, 200)));
  page.on('response', async res => {
    const u = res.url().split('?')[0];
    if (/\/api\/(dashboard|sale-orders|products|params)/.test(u)) {
      console.log('   [api]', res.status(), u.replace(BASE, ''));
    }
  });

  await page.goto(BASE + '/index.html?cb=' + Date.now(), { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);
  await page.type('#loginUser', 'mptest', { delay: 15 });
  await page.type('#loginPass', 'Mptest@1', { delay: 15 });
  await page.waitForFunction(() => !document.getElementById('loginBtn').disabled, { timeout: 8000 }).catch(() => {});
  await page.click('#loginBtn');
  await sleep(4000);
  for (let i = 0; i < 8; i++) {
    const hit = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button,a')].find(x =>
        /^(知道了|下一步|跳过|完成|开始使用|关闭)$/.test(x.textContent.trim()) && x.offsetParent !== null);
      if (!b) return null; b.click(); return b.textContent.trim();
    });
    if (!hit) break;
    await sleep(600);
  }
  await sleep(1500);

  const info = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, missing: true };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        sel,
        rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        display: cs.display, position: cs.position, vis: cs.visibility, tf: cs.transform,
        flex: cs.flexDirection, pos: `${cs.left}/${cs.right}/${cs.top}`,
        margin: cs.margin, pad: cs.padding, overflow: cs.overflow, dir: cs.direction,
        textLen: (el.innerText || '').length, kids: el.children.length,
        scroll: el.scrollWidth + 'x' + el.scrollHeight,
      };
    };
    const sels = ['html', 'body', '#appLayout', '#sidebar', '#sidebarNav',
      '#contentArea', '#pgDashboard', '#dashboardContent', '#topBar', '#aiModeBar', '#mobileNav'];
    const doc = document.scrollingElement || document.documentElement;
    return {
      rows: sels.map(rect),
      win: window.innerWidth + 'x' + window.innerHeight,
      scrollTop: doc.scrollTop, scrollLeft: doc.scrollLeft,
      docSize: doc.scrollWidth + 'x' + doc.scrollHeight,
      bodyDir: getComputedStyle(document.body).direction + '/' + getComputedStyle(document.body).display,
      bodyClass: document.body.className,
      htmlClass: document.documentElement.className,
      hash: location.hash,
    };
  });
  console.log('\n=== 布局 ===', 'win=' + info.win, 'doc=' + info.docSize,
    'scroll=', info.scrollLeft + ',' + info.scrollTop, 'dir=' + info.bodyDir);
  console.log('body.class =', JSON.stringify(info.bodyClass), 'html.class =', JSON.stringify(info.htmlClass));
  console.log('hash =', JSON.stringify(info.hash));
  info.rows.forEach(r => {
    if (r.missing) { console.log('  ' + r.sel + ' → (不存在)'); return; }
    console.log(`  ${r.sel.padEnd(16)} rect=${r.rect.padEnd(22)} ${r.display}/${r.position} flexdir=${r.flex}`
      + ` 子${r.kids} 文本${r.textLen} 滚动${r.scroll}`);
  });

  const cas = await page.evaluate(() => {
    const el = document.querySelector('#appLayout');
    const out = { inline: el.getAttribute('style') || '(无内联)', cls: el.className || '(无class)',
      computed: (() => { const c = getComputedStyle(el); return `display=${c.display} flexDir=${c.flexDirection} h=${c.height}`; })(),
      rules: [] };
    for (const ss of document.styleSheets) {
      let rules; try { rules = ss.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        if (r.selectorText && /appLayout/.test(r.selectorText)) out.rules.push(r.selectorText + ' { ' + r.style.cssText.slice(0, 160) + ' }');
      }
    }
    return out;
  });
  console.log('\n=== #appLayout 级联 ===');
  console.log('  内联 style :', cas.inline);
  console.log('  class      :', cas.cls);
  console.log('  计算值     :', cas.computed);
  console.log('  命中规则   :');
  cas.rules.forEach(x => console.log('    ' + x));
  console.log('\n=== #sidebar 祖先链 ===');
  const chain = await page.evaluate(() => {
    const out = [];
    let el = document.querySelector('#sidebar');
    while (el && el.tagName !== 'HTML') {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      out.push(`${(el.tagName + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '')).slice(0, 42)}`
        + ` | ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`
        + ` | ${cs.display} fd=${cs.flexDirection} w=${cs.width} ml=${cs.marginLeft} mr=${cs.marginRight}`
        + ` jc=${cs.justifyContent} ov=${cs.overflow} pos=${cs.position} tf=${cs.transform} box=${cs.boxSizing}`);
      el = el.parentElement;
    }
    return out;
  });
  chain.forEach((l, i) => console.log('  ' + '  '.repeat(i) + l));
  await browser.close();
})().catch(e => { console.error('探针异常:', e); process.exit(1); });
