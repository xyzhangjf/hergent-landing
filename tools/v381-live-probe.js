// v381 真机只读探针：加载 hergent.cn，断言 console/pageerror/请求失败 均为 0
// 只读：不登录、不点按钮、不提交表单。
const { chromium } = require('playwright');

(async () => {
  const URL = 'https://hergent.cn/';
  const errors = [], pageErrors = [], failed = [];
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, args: ['--no-sandbox', '--disable-gpu'],
  });
  let page;
  try {
    page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => pageErrors.push(String(e)));
    page.on('requestfailed', r => failed.push(r.url() + ' :: ' + (r.failure() && r.failure().errorText)));
    page.on('response', r => { if (r.status() >= 400) failed.push('HTTP ' + r.status() + ' ' + r.url()); });
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2500);
    const title = await page.title();
    const bodyLen = (await page.evaluate(() => document.body.innerText || '')).length;
    const hasLogin = await page.evaluate(() => !!document.querySelector('input[type=password], .login, form'));
    console.log('标题:', JSON.stringify(title));
    console.log('body 文本长度:', bodyLen, ' 有登录控件:', hasLogin);
    console.log('console errors:', errors.length, JSON.stringify(errors.slice(0, 5)));
    console.log('page errors:', pageErrors.length, JSON.stringify(pageErrors.slice(0, 5)));
    console.log('failed/4xx+ 请求:', failed.length, JSON.stringify(failed.slice(0, 8)));
    const ok = errors.length === 0 && pageErrors.length === 0 && failed.length === 0;
    console.log(ok ? '✅ 探针通过（零错误）' : '🔴 探针失败');
    process.exitCode = ok ? 0 : 1;
  } catch (e) {
    console.log('🔴 探针异常:', e.message);
    process.exitCode = 2;
  } finally { await browser.close(); }
})();
