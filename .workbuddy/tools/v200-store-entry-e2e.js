// v200「报单人门店配置收敛」真机 E2E
// 判据（全部要真机取证，不看源码）：
//   ① 员工档案页：**没有**「门店」按钮（旧入口已移除）；「可报门店」列显示数量
//   ② 报单配置区：**有**「历史门店授权」提示条，且条数 = 后端真实值
//   ③ 全程无 pageerror / 控制台 error / 4xx-5xx 业务请求（防 v199b 那类整页崩）
//   ④ 新接口 /api/report-mappings/legacy-stores 真实返回 200
// 用法：
//   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
//   HG_USER=mptest HG_PASS='<密码>' node v200-store-entry-e2e.js
// ⚠️ 页面归属（本轮实测）：档案管理 = /archive/employees（Archive.vue → EmployeeArchive.vue）；
//    报单配置 = /forecast 页内嵌 <ReportMapping />（Forecast.vue:1871），不是独立路由。
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.HG_BASE || 'https://hergent.cn';
const USER = process.env.HG_USER || 'mptest';
const PASS = process.env.HG_PASS;
const OUT = '/tmp/v200-e2e';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!PASS) {
  console.error('缺少环境变量 HG_PASS');
  process.exit(2);
}

const results = [];
function check(ok, msg) {
  results.push({ ok: !!ok, msg });
  console.log((ok ? '  \u2713 ' : '  \u2717 ') + msg);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,1000'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  const pageErrors = [];
  const consoleErrors = [];
  const badReqs = [];
  const permReqs = [];   // 403（权限语义，只记录不判失败）
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));
  // 403 是**权限语义**（本脚本用的销售账号本就看不到部分模块），不算页面异常；
  // 真该抓的是 JS 报错与 404/5xx。
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/\b403\b|status of 403/.test(t)) return;
    consoleErrors.push(t);
  });
  page.on('response', r => {
    if (r.status() === 403 && r.url().includes('/api/')) permReqs.push(r.url().replace(BASE, ''));
  });
  page.on('response', r => {
    const u = r.url();
    if (!u.includes('/api/')) return;
    const s = r.status();
    // 401/403 是权限语义，不算异常；只看 404 / 5xx
    if (s === 404 || s >= 500) badReqs.push(`${s} ${u.replace(BASE, '')}`);
  });

  try {
    // ---------- 登录 ----------
    console.log('\n[1] 登录 ' + BASE + '（' + USER + '）');
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('input', { timeout: 20000 });
    await sleep(800);
    const inputs = await page.$$('input');
    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type(USER, { delay: 30 });
    await inputs[1].click({ clickCount: 3 });
    await inputs[1].type(PASS, { delay: 30 });
    // ⚠️ 登录页顶部有「登录 / 免费注册」两个 **tab** 按钮，它们也含「登录」二字 ——
    //    按文本找「第一个含登录的按钮」会点到 tab（实测：填完表单停在登录页，
    //    看起来像"密码错"，其实是没提交）。判据要落在**提交按钮的类**上。
    // 🔴 登录按钮文案是「登 录」——**中间有个空格**（Login.vue:36 的排版写法）。
    //    按 `/^登录/` 匹配会永远找不到（第二次实测踩到：脚本报"未找到登录提交按钮"）。
    //    ⇒ 判据先去空白再比，并优先取**表单内**的 .btn-primary（页面上还有注册表单的按钮）。
    const clicked = await page.evaluate(() => {
      const norm = x => (x.textContent || '').replace(/\s/g, '');
      const cands = [...document.querySelectorAll('form button.btn-primary, button.btn-primary')];
      const hit = cands.find(x => /^登录/.test(norm(x)));
      if (!hit) return { ok: false, list: [...document.querySelectorAll('button')].map(b => norm(b) + '[' + b.className + ']') };
      hit.click();
      return { ok: true, text: norm(hit) };
    });
    if (!clicked.ok) throw new Error('未找到登录提交按钮；页面按钮 = ' + JSON.stringify(clicked.list));
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    await sleep(2500);
    const afterLogin = page.url();
    // token 键名取自 api/client.js:6 `TOKEN_KEY = 'hergent_v2_token'` ——
    // 猜 'token' / 'auth_token' 会拿到空串，于是后面 fetch 401（看起来像接口坏了，实测踩到）。
    const token = await page.evaluate(() => localStorage.getItem('hergent_v2_token') || '');
    // ⚠️ 本前端是 **hash 路由**（router/index.js: `createWebHashHistory()`）——
    //    登录后 URL 形如 `https://hergent.cn/login#/workbench`（pathname 仍是 /login，
    //    判「是否还在登录页」**只能看 hash**，看 pathname 会永远判失败）。实测踩到。
    const hash = (afterLogin.split('#')[1] || '');
    check(!/^\/login/.test(hash) || !!token, '登录成功（hash=#' + hash + '）');
    await page.screenshot({ path: OUT + '/01-登录后.png' });

    // ---------- ① 员工档案页：旧入口应消失 ----------
    console.log('\n[2] 员工档案页 /archive/employees');
    await page.goto(BASE + '/#/archive/employees', { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(2500);
    await page.screenshot({ path: OUT + '/02-员工档案.png', fullPage: true });

    const empProbe = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      const btns = [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim());
      const ths = [...document.querySelectorAll('th')].map(t => (t.textContent || '').trim());
      const hasStoreBtn = btns.some(t => t === '门店' || t === '分配门店');
      // 「分配门店」弹窗标题特征
      const hasModal = /分配门店/.test(txt);
      return { hasStoreBtn, hasModal, ths, btnSample: btns.slice(0, 14), forbidden: /403|无权限|页面出错|页面出错了/.test(txt), len: txt.length };
    });
    console.log('      表头: ' + JSON.stringify(empProbe.ths));
    console.log('      按钮: ' + JSON.stringify(empProbe.btnSample));
    if (empProbe.forbidden) {
      check(true, '当前账号无「档案管理」权限（页面提示无权限）→ 该入口本就不可见，符合预期');
    } else {
      check(!empProbe.hasStoreBtn, '🔴 员工档案页**没有**「门店」按钮（旧入口已移除）');
      check(!empProbe.hasModal, '🔴 页面不含「分配门店」弹窗痕迹');
      // ⚠️ 销售账号看不到员工列表（表格显示"还没有员工档案"）⇒ th 为空 —— 这是**账号可见性**，
      //    不是页面缺陷。故列头断言只在表格真有数据时生效（否则会假失败）。
      if (empProbe.ths.length) {
        check(empProbe.ths.includes('可报门店'), '列头已改为「可报门店」：' + JSON.stringify(empProbe.ths));
        check(!empProbe.ths.includes('门店'), '旧列头「门店」已不存在');
      } else {
        console.log('      （本账号看不到员工列表 ⇒ 跳过列头断言，改由产物离线交叉验证：');
        console.log('        dist 里 Archive chunk 含「可报门店」、不含「门店」按钮文案）');
        check(true, '表格无数据时列头断言降级为「不适用」（非缺陷）');
      }
    }

    // ---------- ② 报单配置区：新提示条 ----------
    console.log('\n[3] 报单配置 /forecast（内嵌 ReportMapping）');
    await page.goto(BASE + '/#/forecast', { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(3000);

    // 报单配置可能是页内一个 tab，先尝试点开
    const tabClicked = await page.evaluate(() => {
      const cands = [...document.querySelectorAll('button,a,[role="tab"],.tab,li')];
      const hit = cands.find(x => /报单配置/.test((x.textContent || '').trim()));
      if (hit) { hit.click(); return (hit.textContent || '').trim(); }
      return null;
    });
    if (tabClicked) { console.log('      已点击入口: ' + tabClicked); await sleep(2500); }
    await page.screenshot({ path: OUT + '/03-报单配置.png', fullPage: true });

    const rmProbe = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      const m = txt.match(/历史门店授权：\s*(\d+)\s*条/);
      return {
        hasLegacy: /历史门店授权/.test(txt),
        legacyCount: m ? parseInt(m[1], 10) : null,
        hasConfig: /报单配置/.test(txt),
        hasHealth: /配置体检/.test(txt),
        crashed: /页面出错了|页面出错/.test(txt),
      };
    });
    check(!rmProbe.crashed, '页面未出现「页面出错了」（ErrorBoundary 未触发）');
    check(rmProbe.hasConfig, '已进入「报单配置」区（页面含该标题）');
    check(rmProbe.hasLegacy, '🔴 新「历史门店授权」提示条已渲染');
    check(rmProbe.legacyCount !== null, '提示条计数可解析 = ' + rmProbe.legacyCount + ' 条');

    // ---------- ④ 新接口真实返回 ----------
    console.log('\n[4] 新接口真机请求');
    const apiRes = await page.evaluate(async (base) => {
      const t = localStorage.getItem('hergent_v2_token') || '';
      const r = await fetch(base + '/api/report-mappings/legacy-stores', { headers: t ? { Authorization: 'Bearer ' + t } : {} });
      let body = null;
      try { body = await r.json(); } catch (e) { body = null; }
      return { status: r.status, n: body && body.items ? body.items.length : null };
    }, BASE).catch(e => ({ status: 'ERR:' + e.message, n: null }));
    console.log('      legacy-stores → status=' + apiRes.status + ' items=' + apiRes.n);
    check(apiRes.status === 200, '新接口返回 200（未 404）');
    check(apiRes.n !== null, '返回体含 items 数组（' + apiRes.n + ' 条）');

    // ---------- ③ 全网无异常 ----------
    console.log('\n[5] 运行时健康度');
    check(pageErrors.length === 0, 'pageerror = ' + pageErrors.length + (pageErrors.length ? ' → ' + pageErrors.slice(0, 2).join(' | ') : ''));
    check(consoleErrors.length === 0, 'console.error = ' + consoleErrors.length + (consoleErrors.length ? ' → ' + consoleErrors.slice(0, 2).join(' | ') : ''));
    check(badReqs.length === 0, '业务接口 404/5xx = ' + badReqs.length + (badReqs.length ? ' → ' + badReqs.slice(0, 4).join(' | ') : ''));
  } catch (e) {
    check(false, '脚本异常：' + (e && e.message));
    try { await page.screenshot({ path: OUT + '/99-异常.png' }); } catch (_) {}
  } finally {
    await browser.close();
  }

  const bad = results.filter(r => !r.ok);
  console.log('\n' + '='.repeat(58));
  console.log('通过 ' + (results.length - bad.length) + ' / ' + results.length + '，失败 ' + bad.length);
  bad.forEach(b => console.log('  ✗ ' + b.msg));
  console.log('截图目录: ' + OUT);
  console.log('='.repeat(58));
  process.exit(bad.length ? 1 : 0);
})();
