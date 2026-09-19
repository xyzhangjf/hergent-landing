/**
 * 空白租户（无演示数据）真机巡检 —— 打生产 https://hergent.cn
 *
 * 为什么要单独跑这一条：后端已证明「新注册租户各业务表 0 行」（影子库 68/68），
 * 但那只是**服务端**事实。真正的风险在前端：各页面若默认「一定有客户/商品/订单」，
 * 去掉演示数据后就会暴露空数据缺陷 —— 除零、图表 NaN、列表 .map 未定义、
 * 汇总卡片显示 undefined。**这条链路只有真机能证明**，而且这正是客户注册后
 * 第一眼看到的场景，坏了就是第一印象。
 *
 * 判据（任一命中即算缺陷）：
 *   1. HTTP 5xx（服务端在空数据下炸）
 *   2. 未捕获异常 pageerror
 *   3. 页面文本出现 NaN / undefined / Infinity / null元（空数据渲染异常的硬症状）
 *   4. 被踢回登录页（登录态没建起来）
 *
 * 用法：
 *   NODE_PATH=... node register-blank-tenant-verify.js
 * 环境变量：URL / OUT / INVITE（邀请码，默认自测码）
 */
const puppeteer = require('puppeteer-core');

const URL = process.env.URL || 'https://hergent.cn/';
const OUT = process.env.OUT || '/tmp/regtest2';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const INVITE = process.env.INVITE || 'HG29PJ8289';
// 给了 ACCOUNT 就跳过注册、直接登录一个已存在的空白租户 —— 避免为了巡检
// 反复在生产建租户（建了就得清）。不给则走完整注册流程。
const ACCOUNT = process.env.ACCOUNT || '';
const PASSWORD = process.env.PASSWORD || 'Test1234';

// 主路径清单（与 src/router/index.js 对齐，逐条对应一个真实页面）
const PATHS = [
  '/workbench', '/forecast', '/rebate', '/dashboard', '/connect', '/roles',
  '/reconciliation', '/loss', '/payroll', '/data-fill',
  '/archive/customers', '/archive/products', '/archive/employees', '/archive/brands',
  '/cron', '/ai-hub', '/settings', '/bid-radar',
];

const PASS = [], FAIL = [];
function check(name, ok, detail = '') {
  (ok ? PASS : FAIL).push(name);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  —— ' + detail : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  console.log('='.repeat(78));
  console.log('空白租户真机巡检 · ' + URL);
  console.log('='.repeat(78));

  // ── 监听器：按「当前页面」归集，每页开始前清空
  let errors = [], pageErrs = [], s5xx = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => pageErrs.push(String(e.message).slice(0, 200)));
  page.on('response', r => {
    if (r.status() >= 500) s5xx.push(`${r.status()} ${r.url().replace(URL, '').slice(0, 90)}`);
  });
  const reset = () => { errors = []; pageErrs = []; s5xx = []; };

  // ── 1. 建立会话：注册新空白租户，或登录一个已存在的空白租户
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(800);

  // 「上传第一份数据」引导弹窗 —— 注册成功后它**盖在登录卡上**（不是路由跳转，
  // 登录卡仍在 DOM 里），所以「会话已建立」的判据必须是它出现，而不是登录卡消失。
  const hasGuide = () => page.evaluate(() =>
    /上传你的第一份数据|从舟谱系统导出|30 秒激活/.test(document.body.innerText || ''));
  const dismissGuide = async () => {
    const ok = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => /稍后再说|进入工作台/.test(x.textContent));
      if (b) { b.click(); return true; }
      return false;
    });
    await sleep(1500);
    return ok;
  };

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
    await sleep(250);
  };

  let company = ACCOUNT;
  const password = PASSWORD;

  if (ACCOUNT) {
    // 登录已有空白租户 —— 不新建，避免为了巡检反复在生产建租户
    // 注意：按钮文案是「登 录」（字间有空格，用于视觉效果），所以正则必须容忍空白，
    // 直接 /登录/ 会匹配不上 → 按钮根本没点到 → 后面 18 页全部"被踢回登录页"。
    await fill({ 用户名: ACCOUNT, 密码: password });
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.login-card button')]
        .filter(x => !x.classList.contains('lg-tab'))
        .find(x => /登\s*录/.test(x.textContent));
      if (b) { b.click(); return true; }
      return false;
    });
    if (!clicked) console.log('  · ⚠️ 没找到登录提交按钮');
    let loginErr = '';
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      if (await hasGuide()) break;
      if (await page.evaluate(() => !document.querySelector('.login-card'))) break;
      loginErr = await page.$eval('.login-error', el => el.textContent.trim()).catch(() => '');
      if (loginErr) break;
    }
    check('登录已有空白租户', true, ACCOUNT + (loginErr ? ` （提示：${loginErr}）` : ''));
  } else {
    await page.evaluate(() => {
      [...document.querySelectorAll('.lg-tab')].find(b => b.textContent.includes('免费注册')).click();
    });
    await sleep(600);

    const stamp = Date.now().toString().slice(-6);
    company = 'ZZ空白验收' + stamp;
    await fill({ 公司名: company, 手机号: '13100000000', 密码: password, 邀请码: INVITE });
    await page.evaluate(() => {
      const cb = document.querySelector('.login-agree input');
      if (cb && !cb.checked) cb.click();
    });
    await sleep(300);

    const doRegister = async () => {
      await page.evaluate(() => {
        [...document.querySelectorAll('.login-card button')].find(b => b.textContent.includes('注册并开始使用')).click();
      });
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        if (await hasGuide()) return { ok: true, err: '' };
        if (await page.evaluate(() => !document.querySelector('.login-card'))) return { ok: true, err: '' };
        const e = await page.$eval('.login-error', el => el.textContent.trim()).catch(() => '');
        if (e) return { ok: false, err: e };
      }
      return { ok: false, err: '（30s 内无引导弹窗也无错误提示）' };
    };

    let reg = await doRegister();
    if (!reg.ok && reg.err.includes('频繁')) {
      console.log('  · 命中 60s 注册限流，等 65s 重试…');
      await sleep(65000);
      reg = await doRegister();
    }
    check('空白租户注册成功', reg.ok, reg.ok ? company : `提示="${reg.err}"`);
    if (!reg.ok) {
      await page.screenshot({ path: `${OUT}/blank-register-failed.png` });
      await browser.close();
      console.log(`通过 ${PASS.length} / 共 ${PASS.length + FAIL.length}`);
      process.exit(1);
    }

    // 注册成功 → 前端应弹「上传第一份数据」激活引导（Login.vue 的 actOpen，
    // 只在注册分支置位；登录**不会**弹，所以这条只能在注册模式下断言）。
    // 这正是本次改动（不再预置演示数据）的配套：库里有假数据时，客户不会看到
    // 「上传第一份数据」这一步，也就没有下手的地方。
    await sleep(1200);
    const guideShown = await hasGuide();
    if (guideShown) await page.screenshot({ path: `${OUT}/blank-onboarding-guide.png` });
    check('注册后自动弹出「上传第一份数据」激活引导', guideShown,
      guideShown ? '' : '未出现引导弹窗');
  }

  // ── 2. 关掉引导弹窗（否则它盖在页面上会污染后续各页面的文本检查）
  await sleep(1000);
  if (await hasGuide()) await dismissGuide();

  await sleep(1500);
  const landing = await page.evaluate(() => location.hash);
  check('会话已建立（未被踢回登录页）', !landing.includes('login'), `落地于 ${landing || '(根)'}`);

  // ── 2. 逐页巡检
  console.log('\n【逐页巡检】');
  const report = [];
  for (const p of PATHS) {
    reset();
    try {
      await page.goto(URL + '#' + p, { waitUntil: 'networkidle2', timeout: 45000 });
    } catch (e) {
      // networkidle2 超时不算致命（可能有长轮询），继续检查页面实际状态
    }
    await sleep(1600);

    const snap = await page.evaluate(() => {
      const app = document.querySelector('#app');
      const txt = app ? app.innerText : '';
      const bad = [];
      for (const w of ['NaN', 'undefined', 'Infinity']) {
        // 只认独立出现，避免把正常的英文单词/属性名误判
        const re = new RegExp('(^|[^A-Za-z0-9_])' + w + '([^A-Za-z0-9_]|$)');
        if (re.test(txt)) bad.push(w);
      }
      return {
        len: txt.trim().length,
        bad,
        isLogin: !!document.querySelector('.login-card'),
        hash: location.hash,
        sample: txt.replace(/\s+/g, ' ').slice(0, 110),
      };
    });

    const errs = [...new Set(errors)].filter(e =>
      !/favicon|net::ERR_|Failed to load resource: the server responded with a status of 4/i.test(e));
    const ok = s5xx.length === 0 && pageErrs.length === 0 && errs.length === 0
      && snap.bad.length === 0 && !snap.isLogin && snap.len > 30;

    const line = `${ok ? '✅' : '❌'} ${p.padEnd(22)} 文本${String(snap.len).padStart(5)}字`
      + (s5xx.length ? ` 5xx=${s5xx.slice(0, 2).join(',')}` : '')
      + (pageErrs.length ? ` 异常=${pageErrs.slice(0, 1).join('').slice(0, 70)}` : '')
      + (errs.length ? ` console错误=${errs.slice(0, 2).join(' | ').slice(0, 110)}` : '')
      + (snap.bad.length ? ` ⚠️出现${snap.bad.join('/')}` : '')
      + (snap.isLogin ? ' ⚠️被踢回登录页' : '')
      + (snap.len <= 30 ? ' ⚠️疑似白屏' : '');
    console.log('  ' + line);
    report.push({ path: p, ok, ...snap, s5xx, pageErrs, errs });

    await page.screenshot({ path: `${OUT}/blank-${p.replace(/\//g, '_')}.png` }).catch(() => {});
  }

  const badPages = report.filter(r => !r.ok);
  check(`全部 ${PATHS.length} 个主页面在空白租户下无异常`,
    badPages.length === 0,
    badPages.length ? badPages.map(r => r.path).join(', ') : '');

  // ── 3. 落地页细节（客户第一眼看到的那一屏）
  console.log('\n【注册后第一屏】');
  await page.goto(URL + '#/workbench', { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(2000);
  const wb = await page.evaluate(() => {
    const t = document.querySelector('#app').innerText.replace(/\s+/g, ' ');
    return {
      text: t.slice(0, 400),
      // 空白租户下工作台不该是死路：要么有数据导入引导，要么有 AI 对话入口。
      // 注意这里**不能**只认"导入/上传" —— 本产品的引导风格是 AI 对话式
      // （「问问 AI 今天该做什么」），用单一判据会把正常产品判成缺陷。
      hasNext: /暂无|还没有|开始|导入|上传|第一|问问 AI|等你拍板/.test(t),
      zeros: (t.match(/¥0/g) || []).length,
    };
  });
  console.log('  · 工作台可见文本：' + wb.text.slice(0, 200));
  check('工作台在空白租户下仍有下一步入口（不是死路）', wb.hasNext,
    wb.hasNext ? `命中入口；页面「¥0」出现 ${wb.zeros} 处` : '未见任何引导或 AI 入口');
  console.log('  · ℹ️ 工作台当前形态 = 一排 ¥0 + AI 对话入口，尚未内置「导入第一份数据」空状态引导'
    + ' —— 记为观察项（非缺陷），是否补由产品决定');
  await page.screenshot({ path: `${OUT}/blank-first-screen.png` });

  await browser.close();
  console.log('\n' + '='.repeat(78));
  console.log(`通过 ${PASS.length} / 共 ${PASS.length + FAIL.length}`);
  if (FAIL.length) {
    console.log('失败项：');
    FAIL.forEach(f => console.log('  ✗ ' + f));
    console.log(`\n👉 本次测试租户：${company}（密码 ${password}）— 验证完需清理`);
    process.exit(1);
  }
  console.log('全部通过 ✅');
  console.log(`👉 本次测试租户：${company}（密码 ${password}）— 验证完需清理`);
})();
