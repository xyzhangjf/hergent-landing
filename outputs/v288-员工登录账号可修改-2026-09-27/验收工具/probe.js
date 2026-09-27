// v286 前端上线后的只读真机探针。
// 只读：不登录、不点任何按钮、不提交任何表单、不改任何数据。
//
// 判据四条：
//   ① 首页 200、SPA 正常挂载、console 零 error
//   ② index.html 引用的三个关键 chunk（含本轮改的 Archive）都能被浏览器取到
//   ③ 本轮新增文案确实在 Archive chunk 里（产物级证据，不靠"我改完了"）
//   ④ 未登录直接敲 hash 深链 /archive/employees —— 应被路由守卫拦下且**不报错**
//      （本轮改的正是这个页面；若深链会崩，说明我引入了运行时错误）
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

  console.log('===== ① 首页 =====');
  console.log('http_status    = ' + (resp && resp.status()));
  console.log('title          = ' + (await page.title()));
  const info = await page.evaluate(() => {
    const app = document.querySelector('#app') || document.querySelector('#root');
    return {
      appChildCount: app ? app.children.length : -1,
      bodyText: ((document.body && document.body.innerText) || '').slice(0, 200),
    };
  });
  console.log('app_children   = ' + info.appChildCount);
  console.log('body_text      = ' + JSON.stringify(info.bodyText));

  console.log('');
  console.log('===== ② 关键 chunk 可加载 =====');
  const chunkResult = await page.evaluate(async () => {
    const urls = [
      '/assets/index-C7Lw83l-.js',
      '/assets/Archive-PCH8g8K-.js',
      '/assets/index-CSOmVdY6.css',
    ];
    const out = [];
    for (const u of urls) {
      try {
        const r = await fetch(u, { cache: 'no-store' });
        const t = await r.text();
        out.push({ url: u, status: r.status, bytes: t.length });
      } catch (e) {
        out.push({ url: u, status: 'ERR', bytes: 0, err: String(e) });
      }
    }
    return out;
  });
  chunkResult.forEach((c) => console.log('  ' + c.status + '  ' + c.bytes + 'B  ' + c.url));

  console.log('');
  console.log('===== ③ 本轮新文案是否在 Archive chunk 里 =====');
  const textProbe = await page.evaluate(async () => {
    const r = await fetch('/assets/Archive-PCH8g8K-.js', { cache: 'no-store' });
    const t = await r.text();
    const keys = ['改账号', '取消改账号', '保存账号', '该员工下次登录请用新账号', '登录账号需 2-32 个字符'];
    const hit = {};
    keys.forEach((k) => { hit[k] = t.indexOf(k) >= 0; });
    return hit;
  });
  Object.keys(textProbe).forEach((k) => console.log('  ' + (textProbe[k] ? 'OK  ' : 'MISS') + '  ' + k));

  console.log('');
  console.log('===== ④ 未登录深链到本轮改的页面 =====');
  const errsBefore = errs.length;
  try {
    await page.goto('https://hergent.cn/#/archive/employees', { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    console.log('  深链 goto 失败: ' + e.message);
  }
  await page.waitForTimeout(2000);
  const deep = await page.evaluate(() => ({
    url: location.href,
    bodyText: ((document.body && document.body.innerText) || '').slice(0, 160),
  }));
  console.log('  final_url  = ' + deep.url);
  console.log('  body_text  = ' + JSON.stringify(deep.bodyText));
  console.log('  深链期间新增 error = ' + (errs.length - errsBefore));

  console.log('');
  console.log('===== 汇总 =====');
  console.log('console_errors = ' + errs.length);
  errs.slice(0, 20).forEach((e) => console.log('    ' + e));
  console.log('console_warns  = ' + warns.length);
  warns.slice(0, 6).forEach((e) => console.log('    ' + e));

  await browser.close();
  process.exit(errs.length === 0 ? 0 : 1);
})();
