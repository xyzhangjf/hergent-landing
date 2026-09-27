// v289 线上只读真机探针：两个站点（hergent.cn / erp.hergent.cn）健康度 + 文案
// 只读：不登录、不点按钮、不提交表单。
const { chromium } = require('playwright');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TARGETS = [
  { name: 'hergent.cn（新前端）', url: 'https://hergent.cn/' },
  { name: 'erp.hergent.cn（旧前端）', url: 'https://erp.hergent.cn/' },
];

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  let bad = 0;
  for (const t of TARGETS) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 160)));
    let status = 0;
    try {
      const resp = await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      status = resp ? resp.status() : 0;
      await page.waitForTimeout(2500);
    } catch (e) {
      errs.push('goto: ' + String(e).slice(0, 160));
    }
    const title = await page.title().catch(() => '');
    const bodyLen = (await page.evaluate(() => document.body ? document.body.innerText.length : 0).catch(() => 0));
    console.log('='.repeat(66));
    console.log(t.name + '  ' + t.url);
    console.log('='.repeat(66));
    console.log('  HTTP 状态        : ' + status + (status === 200 ? '  ✅' : '  🔴'));
    console.log('  页面标题         : ' + title);
    console.log('  可见文字长度     : ' + bodyLen + (bodyLen > 20 ? '  ✅ 有渲染' : '  🔴 疑似空白'));
    console.log('  控制台报错       : ' + errs.length + (errs.length === 0 ? '  ✅' : '  🔴'));
    errs.slice(0, 4).forEach((e) => console.log('      · ' + e));
    if (status !== 200 || bodyLen <= 20 || errs.length) bad++;
    await ctx.close();
  }

  // 新前端：未登录深链应被守卫拦到登录页（证明路由守卫仍在工作）
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
  await page.goto('https://hergent.cn/#/archive/employees', { waitUntil: 'domcontentloaded', timeout: 45000 })
    .catch(() => {});
  await page.waitForTimeout(2500);
  const href = page.url();
  console.log('='.repeat(66));
  console.log('新前端：未登录深链 /#/archive/employees');
  console.log('='.repeat(66));
  const kicked = /#\/login/.test(href);
  console.log('  最终地址   : ' + href);
  console.log('  被守卫拦下 : ' + (kicked ? '✅ 已跳登录页' : '🔴 未拦截'));
  console.log('  JS 异常    : ' + errs.length + (errs.length === 0 ? '  ✅' : '  🔴'));
  if (!kicked || errs.length) bad++;
  await ctx.close();
  await browser.close();

  console.log('');
  console.log(bad === 0 ? '✅ 探针全绿' : '🔴 探针有 ' + bad + ' 项异常');
  process.exit(bad === 0 ? 0 : 1);
})();
