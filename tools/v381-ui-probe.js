// v381 真机只读探针（登录态）：验证「报单配置 › 新建配置 › 对象类型=本人仓」这一格
// 在生产上真的是**仓库下拉**（.combo + .combo-item），且已占用的仓带「已被 X 占用」提示。
// 只读：不点保存、不提交任何表单。
const { chromium } = require('playwright');
const U = 'mptestsp', P = 'Mpsup@1';
const jsErrors = [], failed = [], four = [];

(async () => {
  const b = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await b.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/status of 40[0-9]/.test(m.text())) jsErrors.push(m.text()); });
  page.on('pageerror', e => jsErrors.push('PAGEERROR ' + String(e)));
  page.on('response', r => { if (r.status() >= 400) { four.push(r.status() + ' ' + r.url()); if (r.status() !== 403) failed.push(r.status() + ' ' + r.url()); } });
  const log = (...a) => console.log(...a);
  try {
    await page.goto('https://hergent.cn/', { waitUntil: 'networkidle', timeout: 45000 });
    await page.fill('input[placeholder="用户名"]', U);
    await page.fill('input[placeholder="密码"]', P);
    await page.click('button.btn-primary.btn-block');
    await page.waitForTimeout(3500);
    await page.goto('https://hergent.cn/#/forecast', { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2000);
    await page.click('text=报单配置');
    await page.waitForTimeout(2000);

    // 打开「新建配置」
    await page.click('text=新建配置');
    await page.waitForTimeout(1500);
    const inModal = await page.$('.seg-btn');
    log('弹窗已开（找到 .seg-btn）:', !!inModal);

    // 选报单人：挑一个「有个人仓」的员工（报单人下拉是唯一带 optgroup 的 select）
    const subj = page.locator('select:has(optgroup)').first();
    const opts = await subj.locator('option').evaluateAll(os => os.map(o => ({ v: o.value, t: o.textContent.trim() })));
    log('报单人下拉候选:', JSON.stringify(opts.map(o => o.t).slice(0, 20)));
    const target = opts.find(o => ['王老板'].some(n => o.t.includes(n)));
    log('命中报单人:', target ? target.t : '(无)');
    if (target) { await subj.selectOption(target.v); await page.waitForTimeout(800); }

    // 点「本人仓」
    const segs = await page.$$eval('.seg-btn', bs => bs.map(b => b.textContent.trim()));
    log('.seg-btn 选项:', JSON.stringify(segs));
    if (segs.includes('本人仓')) {
      await page.click('.seg-btn:has-text("本人仓")');
      await page.waitForTimeout(1000);
    }
    // 打开对象下拉（scope 到「个人仓」那一格）
    const objField = page.locator('.field', { has: page.locator('label', { hasText: '个人仓' }) });
    const comboInput = objField.locator('.combo-input').first();
    await comboInput.click();
    await comboInput.press('Control+a'); await comboInput.press('Backspace');
    await page.waitForTimeout(900);
    const items = await objField.locator('.combo-item').evaluateAll(is => is.map(i => i.textContent.trim()));
    const notes = await objField.locator('.combo-note').evaluateAll(ns => ns.map(n => n.textContent.trim()));
    const label = await objField.innerText().catch(() => '');
    log('对象字段标签区文本:', JSON.stringify((label || '').slice(0, 160)));
    log('下拉仓库条目:', JSON.stringify(items.slice(0, 12)));
    log('「已被占用」提示:', JSON.stringify(notes));
    // 旧只读框痕迹
    const roBox = await page.$$('.ro-box');
    log('旧只读框 .ro-box 数量（应 0）:', roBox.length);

    const pass = !!inModal && items.length > 0 && roBox.length === 0 && jsErrors.length === 0 && failed.length === 0;
    log('JS 错误数:', jsErrors.length, JSON.stringify(jsErrors.slice(0, 4)));
    log('非 403 的失败请求:', failed.length, JSON.stringify(failed.slice(0, 4)));
    log('403（RBAC 预期）:', four.length);
    log(pass ? '✅ 登录态 UI 探针通过' : '🔴 登录态 UI 探针未通过');
    process.exitCode = pass ? 0 : 1;
  } catch (e) {
    log('🔴 探针异常:', e.message);
    log('JS 错误:', JSON.stringify(jsErrors.slice(0, 4)));
    process.exitCode = 2;
  } finally { await b.close(); }
})();
