/**
 * 邀请码管理入口的「不可见」验证 —— 用公开演示会话（无需任何凭据）打生产。
 *
 * 为什么要单独测这个：后端 26 项断言证明了 demo 账号拿 /api/platform/* 会 403；
 * 但**前端到底有没有把「客户开通」页签藏起来**是另一回事 —— 藏不住的后果是普通客户
 * 在设置页看到一个点进去全是报错的入口。这条同时验证 /api/platform/whoami 的
 * 前端接线（whoami 挂了 → isPlatformAdmin 恒 false → 页签消失，属 fail-closed）。
 */
const puppeteer = require('puppeteer-core');

const URL = process.env.URL || 'https://hergent.cn/';
const OUT = process.env.OUT || '/tmp/regtest2';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const PASS = [], FAIL = [];
function check(name, ok, detail = '') {
  (ok ? PASS : FAIL).push(name);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  —— ' + detail : ''}`);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  const platformCalls = [];
  page.on('request', rq => {
    if (rq.url().includes('/api/platform/')) platformCalls.push(rq.url().split('/api/')[1]);
  });

  console.log('='.repeat(76));
  console.log('邀请码管理入口对普通用户不可见 · ' + URL);
  console.log('='.repeat(76));

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 600));

  // 公开演示入口
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('先看看演示效果'));
    if (b) b.click();
  });
  await page.waitForFunction(() => !location.hash.includes('login'), { timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  check('演示入口可进入（公开，无凭据）', !page.url().includes('login'), page.url());

  // 直达设置页
  await page.goto(URL + '#/settings', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));

  const tabs = await page.$$eval('.module-tabs button, .module-tabs a', els => els.map(e => e.textContent.trim()));
  check('设置页已渲染标签页', tabs.length > 0, tabs.join(' / '));
  check('普通用户看不到「客户开通」页签', !tabs.some(t => t.includes('客户开通')), tabs.join(' / '));

  const who = platformCalls.filter(u => u.includes('whoami'));
  check('whoami 被调用过（判定链路有接线）', who.length > 0, `platform 调用：${[...new Set(platformCalls)].join(', ')}`);
  const codes = platformCalls.filter(u => u.includes('invite-codes') || u.includes('registrations'));
  check('未发起任何邀请码/流水请求（不触发 403 噪音）', codes.length === 0, codes.join(', ') || '无');

  if (tabs.some(t => t.includes('客户开通'))) {
    await page.evaluate(() => {
      [...document.querySelectorAll('.module-tabs button')].find(b => b.textContent.includes('客户开通')).click();
    });
    await new Promise(r => setTimeout(r, 1200));
    const p = await page.screenshot({ path: `${OUT}/reg-settings-onboard-as-demo.png` });
    check('（异常）演示账号竟能看到邀请码面板', false, '已截图 ' + p);
  }

  await browser.close();
  console.log('='.repeat(76));
  console.log(`通过 ${PASS.length} / 共 ${PASS.length + FAIL.length}`);
  if (FAIL.length) {
    FAIL.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log('全部通过 ✅');
})();
