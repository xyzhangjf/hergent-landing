/**
 * 注册表单（邀请码）真机验收 —— 打生产 https://hergent.cn
 *
 * 为什么值得跑：后端 26 项断言只能证明接口对；「前端到底把邀请码传出去了没有、
 * 用户看到的是不是邀请码输入框而不是短信框、登录卡切页签会不会跳高」只有真机能证明。
 * 顺带用一个**不存在的邀请码**走一次真实提交，看前端是否把后端文案原样呈现
 * （这条同时验证了两端字段名没写错 —— 写错了会得到「操作过于频繁」或 422 而不是「邀请码无效」）。
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');

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
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  console.log('='.repeat(76));
  console.log('注册表单（邀请码）真机验收 · ' + URL);
  console.log('='.repeat(76));

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 800));

  // ── 1. 登录态（默认页签）
  const loginFields = await page.$$eval('.login-card .field-label', els => els.map(e => e.textContent.trim()));
  check('默认展示登录页签（用户名 / 密码）',
    loginFields.includes('用户名') && loginFields.includes('密码'), loginFields.join(','));

  const h1 = await page.$eval('.login-card', el => el.getBoundingClientRect().height);
  check('登录卡高度已锁定（min-height 生效）', h1 >= 500, `${h1.toFixed(0)}px`);
  await page.screenshot({ path: `${OUT}/reg-login-1440.png` });

  // ── 2. 切到注册页签
  await page.evaluate(() => {
    [...document.querySelectorAll('.lg-tab')].find(b => b.textContent.includes('免费注册')).click();
  });
  await new Promise(r => setTimeout(r, 600));

  const labels = await page.$$eval('.login-card .field-label', els => els.map(e => e.textContent.trim()));
  check('注册页签字段：公司名 / 手机号 / 邀请码 / 密码',
    ['公司名', '手机号', '邀请码', '密码'].every(x => labels.includes(x)) && labels.length === 4,
    labels.join(' / '));
  check('邀请码模式：不再显示「短信验证码」字段', !labels.includes('短信验证码'), labels.join(' / '));

  const hint = await page.$eval('.login-card .field-hint', el => el.textContent.trim()).catch(() => '');
  check('邀请码下方有说明文案', hint.includes('邀请码'), `"${hint}"`);

  const ph = await page.evaluate(() => {
    const l = [...document.querySelectorAll('.login-card .field-label')].find(e => e.textContent.trim() === '邀请码');
    return l && l.parentElement.querySelector('input') ? l.parentElement.querySelector('input').placeholder : '';
  });
  check('邀请码输入框有示例占位', ph.includes('HG'), `"${ph}"`);

  const req = await page.evaluate(() => {
    const l = [...document.querySelectorAll('.login-card .field-label')].find(e => e.textContent.trim() === '邀请码');
    const i = l && l.parentElement.querySelector('input');
    return i ? { required: i.required, auto: i.getAttribute('autocapitalize') } : {};
  });
  check('邀请码为必填且自动大写（handheld 抄写友好）', req.required === true && req.auto === 'characters', JSON.stringify(req));

  const h2 = await page.$eval('.login-card', el => el.getBoundingClientRect().height);
  check('切页签不跳高（注册卡高度未超出锁定值）', Math.abs(h2 - h1) <= 2,
    `登录 ${h1.toFixed(0)}px → 注册 ${h2.toFixed(0)}px`);

  await page.screenshot({ path: `${OUT}/reg-register-1440.png` });

  const box = await page.$eval('.login-card', el => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  });
  await page.screenshot({ path: `${OUT}/reg-register-card.png`, clip: box });

  // ── 3. 空邀请码：两道防线（原生 required + JS 兜底）
  // 注意：`<form @submit.prevent>` + 各 input 的 required → 空字段会让**浏览器原生校验**
  // 先拦下，submit 事件根本不触发，doRegister 也不会跑。所以这里分两步测：
  //   (a) 原生防线：邀请码为空时该 input 自身 checkValidity()=false，且点提交不发请求；
  //   (b) JS 防线：绕过原生（直接对 form 派发 submit 事件）时，doRegister 的兜底提示生效。
  let netHits = 0;
  page.on('request', rq => { if (rq.url().includes('/api/auth/register')) netHits++; });
  await page.evaluate(() => {
    const cb = document.querySelector('.login-agree input');
    if (cb && !cb.checked) cb.click();
  });
  await new Promise(r => setTimeout(r, 400));
  const btnOn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.login-card button')].find(x => x.textContent.includes('注册并开始使用'));
    return b ? !b.disabled : false;
  });
  check('勾选协议后提交按钮解禁', btnOn);

  const fill = async (obj) => {
    await page.evaluate((o) => {
      const set = (label, v) => {
        const l = [...document.querySelectorAll('.login-card .field-label')].find(e => e.textContent.trim() === label);
        if (!l) return;
        const i = l.parentElement.querySelector('input');
        i.value = v;
        i.dispatchEvent(new Event('input', { bubbles: true }));
      };
      Object.entries(o).forEach(([k, v]) => set(k, v));
    }, obj);
    await new Promise(r => setTimeout(r, 250));
  };
  const submit = async () => {
    await page.evaluate(() => {
      [...document.querySelectorAll('.login-card button')].find(b => b.textContent.includes('注册并开始使用')).click();
    });
    await page.waitForFunction(
      () => { const e = document.querySelector('.login-error'); return e && e.textContent.trim().length > 2; },
      { timeout: 30000 }
    ).catch(() => {});
    await new Promise(r => setTimeout(r, 300));
    return page.$eval('.login-error', el => el.textContent.trim()).catch(() => '');
  };
  const inviteInputState = () => page.evaluate(() => {
    const l = [...document.querySelectorAll('.login-card .field-label')].find(e => e.textContent.trim() === '邀请码');
    const i = l.parentElement.querySelector('input');
    return { valid: i.checkValidity(), empty: i.value.trim() === '' };
  });

  await fill({ 公司名: 'ZZ前端真机验收', 手机号: '13100000000', 密码: 'Test12345', 邀请码: '' });
  const st3 = await inviteInputState();
  check('邀请码留空 → 原生 required 判定为无效（第一道防线）',
    st3.empty && st3.valid === false, JSON.stringify(st3));
  await page.evaluate(() => {
    [...document.querySelectorAll('.login-card button')].find(b => b.textContent.includes('注册并开始使用')).click();
  });
  await new Promise(r => setTimeout(r, 700));
  check('原生校验拦下后不发任何注册请求', netHits === 0, `网络请求=${netHits}`);

  // (b) 绕过原生校验，验证 JS 兜底
  await page.evaluate(() => {
    const f = document.querySelector('.login-card form');
    f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await new Promise(r => setTimeout(r, 600));
  const err1 = await page.$eval('.login-error', el => el.textContent.trim()).catch(() => '');
  check('绕过原生校验后 → JS 兜底提示「请填写邀请码」，仍不发请求',
    err1.includes('请填写邀请码') && netHits === 0, `提示="${err1}" 网络请求=${netHits}`);

  // ── 4. 无效邀请码：真实提交，看后端文案是否原样呈现
  await fill({ 邀请码: 'HGNOSUCH99' });
  let err2 = await submit();
  if (err2.includes('频繁')) {
    // 注册限流是 60s 冷却，且时间戳在**校验之前**记录 —— 上一轮联调刚打过这个 IP。
    // 等一个窗口再打一次，避免把限流误判成产品问题。
    console.log('  · 命中 60s 注册限流，等 65s 后重试一次…');
    await new Promise(r => setTimeout(r, 65000));
    err2 = await submit();
  }
  check('无效邀请码 → 后端文案原样呈现（证明字段名两端对齐）',
    err2.includes('邀请码无效'), `提示="${err2}"`);
  await page.screenshot({ path: `${OUT}/reg-error-1440.png` });

  await browser.close();
  console.log('='.repeat(76));
  console.log(`通过 ${PASS.length} / 共 ${PASS.length + FAIL.length}`);
  if (FAIL.length) {
    console.log('失败项：');
    FAIL.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log('全部通过 ✅');
})();
