// erp.hergent.cn 站点恢复验证（真机 E2E）
// 背景：文档根 /opt/static 丢失（符号链接 /opt/hergent-erp/static -> ../static 指向空）→ 站点整站 404。
// 本脚本验证恢复后：资源全加载无 404 / 可登录 / 主壳渲染 / 接口无 401、5xx / 无 pageerror。
// 用法：NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
//       node erp-site-restore-e2e.js [baseUrl]
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'https://erp.hergent.cn';
const OUT = '/tmp/erp-restore-e2e';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 凭据不入库：提审测试账号密码见 memory/topics/deploy-ops.md
// 跑法：HG_PASS='<密码>' node erp-site-restore-e2e.js
const USER = process.env.HG_USER || 'mptest';
const PASS = process.env.HG_PASS;
if (!PASS) {
  console.error('缺少环境变量 HG_PASS（提审测试账号密码，见 memory/topics/deploy-ops.md）');
  process.exit(1);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  let consoleErrors = [];
  let pageErrors = [];
  let notFound = [];
  let api404 = [];
  let failed = [];
  let apiHits = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 200)));
  page.on('response', res => {
    const u = res.url().split('?')[0];
    const s = res.status();
    if (s === 404) { if (u.startsWith(BASE + '/api/')) api404.push(u.replace(BASE, '')); else notFound.push(u.replace(BASE, '')); }
    else if (s >= 500) failed.push(s + ' ' + u.replace(BASE, ''));
    if (u.startsWith(BASE + '/api/')) apiHits.push(s + ' ' + u.replace(BASE, ''));
  });

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail });
    console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  };
  const reset = () => { notFound = []; api404 = []; failed = []; apiHits = []; consoleErrors = []; pageErrors = []; };

  console.log('# 1) 打开 erp.hergent.cn 首页');
  const nav = await page.goto(BASE + '/?cb=' + Date.now(), { waitUntil: 'networkidle2', timeout: 60000 });
  check('首页 HTTP 200', nav && nav.status() === 200, 'status=' + (nav && nav.status()));
  await sleep(1200);
  check('页面标题为 Hergent', /Hergent/i.test(await page.title()), 'title=' + await page.title());
  await page.screenshot({ path: OUT + '/01-login.png' });

  console.log('# 2) 静态资源加载情况');
  const assets = await page.evaluate(() => ({
    cssCount: [...document.styleSheets].filter(s => s.href).length,
    bundles: [...document.scripts].filter(s => s.src).map(s => s.src),
    xlsx: typeof window.XLSX,
    chart: typeof window.Chart,
    icons: typeof window.Icons,
  }));
  check('样式表已加载', assets.cssCount > 0, assets.cssCount + ' 个');
  check('bundle 脚本已加载', assets.bundles.some(u => /\/assets\/main-/.test(u)),
    assets.bundles.filter(u => /\/assets\//.test(u)).map(u => u.replace(BASE, '')).join(' ') || '(无)');
  check('vendor XLSX 就绪', assets.xlsx !== 'undefined', 'typeof XLSX=' + assets.xlsx);
  check('vendor Chart 就绪', assets.chart !== 'undefined', 'typeof Chart=' + assets.chart);
  check('前端资源无 404', notFound.length === 0, notFound.join(' ') || '无');

  console.log('# 3) 登录（真实 /api/auth/login）');
  const hasLogin = await page.$('#loginUser');
  check('登录表单已渲染', !!hasLogin);
  if (hasLogin) {
    await page.click('#loginUser');
    await page.type('#loginUser', USER, { delay: 20 });
    await page.click('#loginPass');
    await page.type('#loginPass', PASS, { delay: 20 });
    await page.waitForFunction(() => {
      const b = document.getElementById('loginBtn');
      return b && !b.disabled;
    }, { timeout: 10000 }).catch(() => {});
    await page.click('#loginBtn');
    await page.waitForFunction(() => {
      const o = document.getElementById('loginOverlay');
      return o && getComputedStyle(o).display === 'none';
    }, { timeout: 25000 }).catch(() => {});
    await sleep(3500);
  }
  await page.screenshot({ path: OUT + '/02-after-login.png' });

  // 关掉首次引导 / 更新日志遮罩（仅影响本次无痕会话）
  for (let round = 0; round < 12; round++) {
    const hit = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button,a')].find(x =>
        /^(知道了|下一步|跳过|完成|开始使用|关闭|我知道了)$/.test(x.textContent.trim())
        && x.offsetParent !== null);
      if (!b) return null;
      b.click(); return b.textContent.trim();
    });
    if (!hit) break;
    await sleep(700);
  }
  await sleep(2000);
  await page.screenshot({ path: OUT + '/03-dashboard.png' });

  const shell = await page.evaluate(() => ({
    overlayLeft: [...document.querySelectorAll('div')]
      .filter(d => d.offsetParent !== null && d.getBoundingClientRect().width > 600
        && /试试这样说|欢迎来到/.test(d.innerText || '')).length,
    bodyLen: (document.body.innerText || '').length,
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
  }));
  check('引导遮罩已关闭', shell.overlayLeft === 0, shell.overlayLeft + ' 个残留遮罩');
  const badgeNow = await page.evaluate(() => {
    const b = document.getElementById('tenantIndicator');
    return b ? b.textContent.trim() : '(无徽标)';
  });
  check('登录后租户徽标即时更新（无需刷新）', !/未设置租户/.test(badgeNow), '徽标 = ' + badgeNow);
  check('主壳已渲染内容', shell.bodyLen > 400, 'body 文本 ' + shell.bodyLen + ' 字');
  console.log('   首屏文本:', shell.text.slice(0, 110));

  console.log('# 4) 刷新一次（模拟正常二次进入）');
  reset();
  await page.goto(BASE + '/?cb=' + Date.now(), { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3500);
  const re = await page.evaluate(() => {
    const badge = document.getElementById('tenantIndicator');
    return {
      badge: badge ? badge.textContent.trim() : '(无徽标)',
      loggedIn: !!localStorage.getItem('hergent_token'),
      bodyLen: (document.body.innerText || '').length,
    };
  });
  check('刷新后仍为登录态', re.loggedIn);
  check('租户徽标已就位', /租户#\d+|[\u4e00-\u9fa5]{2,}/.test(re.badge) && !/未设置租户/.test(re.badge),
    '徽标文本 = ' + re.badge);
  await page.screenshot({ path: OUT + '/04-reload.png' });

  console.log('# 5) 登录后的业务接口与错误');
  if (!apiHits.some(x => x.startsWith('2'))) {
    await page.evaluate(() => {
      const it = [...document.querySelectorAll('.nav-item,.menu-item,[onclick]')]
        .find(x => /工作台|数据看板|经营看板/.test(x.textContent));
      if (it) it.click();
    });
    await sleep(3000);
  }
  const apiOk = apiHits.filter(x => x.startsWith('2')).length;
  const apiBad = apiHits.filter(x => !x.startsWith('2'));
  check('登录后接口有成功响应', apiOk > 0, apiOk + ' 条 2xx');
  check('登录后无 401 未鉴权', !apiBad.some(x => x.startsWith('401')),
    apiBad.filter(x => x.startsWith('401')).join(' ') || '无');
  check('无 5xx 接口', failed.length === 0, failed.join(' ') || '无');
  check('无前端资源 404', notFound.length === 0, notFound.join(' ') || '无');
  check('无 JS 运行时报错', pageErrors.length === 0, pageErrors.join(' | ') || '无');
  if (apiBad.length) console.log('   非 2xx 接口（含 RBAC 403，需人工判读）:', apiBad.slice(0, 10).join(' | '));
  if (api404.length) console.log('   ⚠️ 接口 404（前端在调、后端已无此路由，非本次回归）:', api404.join(' '));

  await browser.close();

  const bad = results.filter(r => !r.ok);
  console.log('\n===== 汇总 =====');
  console.log(`通过 ${results.length - bad.length}/${results.length}`);
  console.log('截图:', OUT + '/01-login.png 02-after-login.png 03-dashboard.png 04-reload.png');
  if (bad.length) {
    console.log('未通过:', bad.map(b => b.name + (b.detail ? '(' + b.detail + ')' : '')).join('; '));
    process.exit(1);
  }
})().catch(e => { console.error('E2E 异常:', e); process.exit(1); });
