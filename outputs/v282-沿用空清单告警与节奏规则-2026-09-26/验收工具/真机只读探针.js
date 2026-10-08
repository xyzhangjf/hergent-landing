// v282 前端上线后的只读真机探针：确认 SPA 能正常启动、无致命 JS 报错、新 chunk 可加载。
// 只读：不登录、不点任何按钮、不提交任何表单。
const { chromium } = require('playwright');

(async () => {
  const errs = [];
  const warns = [];
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error') errs.push('[console.error] ' + m.text());
    else if (t === 'warning') warns.push('[console.warn] ' + m.text());
  });
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('requestfailed', (r) => {
    const f = r.failure();
    errs.push('[reqfail] ' + r.url() + ' -- ' + (f && f.errorText));
  });

  let resp = null;
  try {
    resp = await page.goto('https://hergent.cn/', { waitUntil: 'networkidle', timeout: 45000 });
  } catch (e) {
    console.log('goto 失败: ' + e.message);
  }
  await page.waitForTimeout(1500);

  console.log('http_status   = ' + (resp && resp.status()));
  console.log('final_url     = ' + page.url());
  console.log('title         = ' + (await page.title()));
  const info = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script[src]')).map((s) => s.src);
    const links = Array.from(document.querySelectorAll('link[rel=stylesheet]')).map((l) => l.href);
    const app = document.querySelector('#app') || document.querySelector('#root');
    return {
      scripts: scripts,
      links: links,
      appChildCount: app ? app.children.length : -1,
      bodyText: (document.body && document.body.innerText || '').slice(0, 300),
    };
  });
  console.log('scripts       = ' + JSON.stringify(info.scripts));
  console.log('stylesheets   = ' + JSON.stringify(info.links));
  console.log('app_children  = ' + info.appChildCount);
  console.log('body_text     = ' + JSON.stringify(info.bodyText));
  console.log('console_errors= ' + errs.length);
  errs.slice(0, 20).forEach((e) => console.log('    ' + e));
  console.log('console_warns = ' + warns.length);
  warns.slice(0, 6).forEach((e) => console.log('    ' + e));

  // 直接验新 chunk 可被浏览器取到并解析（用 fetch，不执行）
  const chunkProbe = await page.evaluate(async () => {
    const urls = [
      '/assets/index-HO4f0L3a.js',
      '/assets/Forecast-C90Aw5BU.js',
      '/assets/Rebate-BYcamHN2.js',
    ];
    const out = [];
    for (const u of urls) {
      try {
        const r = await fetch(u, { cache: 'no-store' });
        const t = await r.text();
        out.push(u + ' -> ' + r.status + ' ' + t.length + 'B');
      } catch (e) {
        out.push(u + ' -> ERR ' + e.message);
      }
    }
    return out;
  });
  console.log('chunk_probe:');
  chunkProbe.forEach((x) => console.log('    ' + x));

  await browser.close();
})().catch((e) => {
  console.error('FATAL ' + e.message);
  process.exit(1);
});
