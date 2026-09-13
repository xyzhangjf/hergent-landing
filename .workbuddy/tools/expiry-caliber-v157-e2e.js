// v157 真机 E2E：hergent.cn 加载回归 + 临期接口按新口径返回
// 用法：NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
//       node expiry-caliber-v157-e2e.js [baseUrl]
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'https://hergent.cn';
const OUT = '/tmp/v157-e2e';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const USER = 'mptest';
const PASS = 'Mptest@1';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleErrors = [];
  const pageErrors = [];
  const scanResponses = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 220)); });
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 220)));
  page.on('response', async res => {
    const u = res.url();
    if (u.includes('/api/batch/expiry-scan') || u.includes('/api/ai/loss-card')) {
      let body = null;
      try { body = JSON.parse(await res.text()); } catch (e) { body = '<non-json>'; }
      scanResponses.push({ url: u.split('?')[0], status: res.status(), body });
    }
  });

  console.log('# 1) 打开登录页');
  await page.goto(BASE + '/?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);

  const loginFields = await page.$$eval('.login-card .field-label',
    els => els.map(e => e.textContent.trim())).catch(() => []);
  console.log('   登录字段:', loginFields.join(', '));
  await page.screenshot({ path: OUT + '/01-login.png' });

  const needLogin = loginFields.includes('用户名');
  if (needLogin) {
    console.log('# 2) 走「先看看演示效果（免注册）」进入演示租户（tenant 10，10 批带效期）');
    const clickedDemo = await page.evaluate(() => {
      const cands = [...document.querySelectorAll('.login-card button, .login-card a, button, a')];
      const b = cands.find(x => /演示/.test(x.textContent || ''));
      if (!b) return false;
      b.click();
      return true;
    });
    console.log('   点击演示入口:', clickedDemo);
    await sleep(6000);

    if (await page.$('.login-card')) {
      console.log('   演示入口未生效，回退测试账号登录（%s）', USER);
      const fill = async (label, val) => page.evaluate((lb, v) => {
        const l = [...document.querySelectorAll('.login-card .field-label')]
          .find(e => e.textContent.trim() === lb);
        if (!l) return false;
        let inp = l.parentElement.querySelector('input');
        if (!inp) inp = document.querySelector('.login-card input');
        if (!inp) return false;
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(inp, v);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, label, val);
      await fill('用户名', USER);
      await fill('密码', PASS);
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('.login-card button')]
          .find(x => /登录|登 录/.test(x.textContent) && !/注册/.test(x.textContent));
        if (b) b.click();
      });
      await sleep(5000);
    }
  } else {
    console.log('   已是登录态，跳过登录');
  }

  console.log('# 3) 等待工作台加载并抓取接口');
  await sleep(3500);
  await page.screenshot({ path: OUT + '/02-workbench.png', fullPage: false });

  const url = page.url();
  const hasLoginCard = await page.$('.login-card');
  const bodyText = (await page.evaluate(() => document.body.innerText || '')).slice(0, 400);

  console.log('   当前 URL     :', url);
  console.log('   仍在登录页?  :', !!hasLoginCard);
  console.log('   页面文本前 200:', JSON.stringify(bodyText.slice(0, 200)));

  console.log('# 4) 抓到的临期/货损接口响应');
  if (!scanResponses.length) {
    console.log('   (无) —— 可能是 sales 角色未触发这些模块');
  }
  let sawNewCaliber = false;
  for (const r of scanResponses) {
    console.log('   %s -> %s', r.url, r.status);
    if (r.body && typeof r.body === 'object') {
      const keys = Object.keys(r.body);
      if (r.url.endsWith('/expiry-scan')) {
        console.log('      threshold_days=%s risk_tiers=%s watch_tiers=%s watch_items=%s total_watch_value=%s',
          r.body.threshold_days, JSON.stringify(r.body.risk_tiers),
          JSON.stringify(r.body.watch_tiers), r.body.watch_items, r.body.total_watch_value);
        if (r.body.threshold_days === 7 && Array.isArray(r.body.risk_tiers)
            && r.body.risk_tiers.join() === 'expired,red,orange') sawNewCaliber = true;
      } else {
        const labels = (r.body.card?.metrics || []).map(m => m.label);
        const hints = (r.body.card?.metrics || []).map(m => m.hint).filter(Boolean);
        console.log('      metrics=%s', JSON.stringify(labels));
        console.log('      hints  =%s', JSON.stringify(hints));
        if (hints.some(h => h.includes('7 天内到期'))) sawNewCaliber = true;
      }
      void keys;
    }
  }

  console.log('# 5) 页面 JS 异常');
  console.log('   pageerror  :', pageErrors.length ? pageErrors : '无');
  console.log('   console.err:', consoleErrors.length ? consoleErrors.slice(0, 5) : '无');

  console.log('# 6) 判据');
  const pass = !pageErrors.length && !hasLoginCard && sawNewCaliber;
  console.log('   pageerror 为空 :', !pageErrors.length);
  console.log('   进入应用内页  :', !hasLoginCard);
  console.log('   接口带新口径  :', sawNewCaliber);
  console.log('   =>', pass ? 'PASS' : 'CHECK / FAIL（见上）');
  console.log('   截图:', OUT);

  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('E2E ERROR:', e); process.exit(2); });
