// v203「报单配置对象类型收敛」真机 E2E
// 判据（全部真机取证，不看源码）：
//   ① 新建配置弹窗：类型分段控件 == ['门店','本人仓']，**没有「客户」**；默认选中「门店」
//   ② 该弹窗内 label == 「门店全称」、对象下拉 placeholder == 「搜索门店名称…」
//   ③ 切到「本人仓」→ label 变「本人仓全称」且出现「源仓/目标仓」（该分支未被误伤）
//   ④ 列表 3 行的类型标签 ∈ {门店, 本人仓}，**无「客户」**
//   ⑤ 页面上**不存在**「门店/客户」字样（本项目多处文案已统一）
//   ⑥ Excel 导入弹窗说明 == 「对象类型填 store（门店）或 self_warehouse（本人仓）」
//   ⑦ 全程无 pageerror / console.error / 业务 404-5xx（防 v199b 那类整页崩）
// 🔴 本脚本**绝不点「保存」** —— saveEdits/create 无「无改动短路」分支，点下去就是真实写入。
//    所有弹窗一律用「取消 / 关闭」退出。
// 用法：
//   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
//   HG_PASS='<密码>' node v203-cp-type-e2e.js
// 页面归属：报单配置 = /forecast 页内嵌 <ReportMapping />，不是独立路由（Forecast.vue 内）。
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.HG_BASE || 'https://hergent.cn';
const USER = process.env.HG_USER || 'mptest';
const PASS = process.env.HG_PASS;
const OUT = '/tmp/v203-e2e';
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
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,1100'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  await page.setCacheEnabled(false);   // 防拿到上一轮的 chunk

  const pageErrors = [], consoleErrors = [], badReqs = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/\b403\b|status of 403/.test(t)) return;   // 权限语义，不算异常
    consoleErrors.push(t);
  });
  page.on('response', r => {
    const u = r.url();
    if (!u.includes('/api/')) return;
    const s = r.status();
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
    // 🔴 登录按钮文案是「登 录」（中间有空格）；且页顶有「登录/免费注册」两个 tab 按钮，
    //    按文本找「含登录的第一个按钮」会点到 tab ⇒ 判据落在 .btn-primary + 去空白比较。
    const clicked = await page.evaluate(() => {
      const norm = x => (x.textContent || '').replace(/\s/g, '');
      const cands = [...document.querySelectorAll('form button.btn-primary, button.btn-primary')];
      const hit = cands.find(x => /^登录/.test(norm(x)));
      if (!hit) return { ok: false, list: [...document.querySelectorAll('button')].map(b => norm(b)) };
      hit.click();
      return { ok: true, text: norm(hit) };
    });
    if (!clicked.ok) throw new Error('未找到登录提交按钮；按钮 = ' + JSON.stringify(clicked.list));
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    await sleep(2500);
    // hash 路由 ⇒ 判「是否还在登录页」只能看 hash（pathname 恒为 /login）
    const token = await page.evaluate(() => localStorage.getItem('hergent_v2_token') || '');
    const hash = (page.url().split('#')[1] || '');
    check(!/^\/login/.test(hash) || !!token, '登录成功（hash=#' + hash + '）');

    // ---------- 进入报单配置 ----------
    console.log('\n[2] 报单配置 /forecast（内嵌 ReportMapping）');
    await page.goto(BASE + '/#/forecast', { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(3000);
    const tabClicked = await page.evaluate(() => {
      const cands = [...document.querySelectorAll('button,a,[role="tab"],.tab,li')];
      const hit = cands.find(x => /报单配置/.test((x.textContent || '').trim()));
      if (hit) { hit.click(); return (hit.textContent || '').trim().slice(0, 20); }
      return null;
    });
    if (tabClicked) { console.log('      已点击入口: ' + tabClicked); await sleep(2500); }
    await page.screenshot({ path: OUT + '/01-报单配置.png', fullPage: true });

    const pageProbe = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      // ⚠️ 体检条用 .health-bar 的 textContent 再压空白 —— 用 innerText + [^\n]*
      //    会被元素间插入的换行截断（实测拿到光秃秃的「配置体检：」而误判失败）。
      const hb = document.querySelector('.health-bar');
      const norm = s => (s || '').replace(/\s+/g, ' ').trim();
      return {
        crashed: /页面出错了|页面出错/.test(txt),
        hasCross: /门店\/客户|门店 \/ 客户/.test(txt),
        hasConfig: /报单配置/.test(txt),
        healthLine: norm(hb ? hb.textContent : ''),
      };
    });
    check(!pageProbe.crashed, '页面未出现「页面出错了」（ErrorBoundary 未触发）');
    check(pageProbe.hasConfig, '已进入「报单配置」区');
    check(!pageProbe.hasCross, '🔴 页面**不含**「门店/客户」字样（文案已统一为「门店」）');
    console.log('      体检条: ' + pageProbe.healthLine);
    check(/个门店未配置|全部正常/.test(pageProbe.healthLine),
      '🔴 体检条文案已改为「N 个门店未配置」：' + pageProbe.healthLine.slice(0, 50));

    // ---------- ① 新建配置弹窗：类型只有两项 ----------
    console.log('\n[3] 新建配置弹窗 —— 对象类型');
    const opened = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => /新建配置/.test((x.textContent || '').trim()));
      if (!b) return false;
      b.click(); return true;
    });
    check(opened, '找到并点击「+ 新建配置」');
    await sleep(1200);
    await page.screenshot({ path: OUT + '/02-新建配置弹窗.png' });

    const mapProbe = await page.evaluate(() => {
      const modal = document.querySelector('.df-modal.edit-modal');
      if (!modal) return { noModal: true };
      const txt = modal.innerText || '';
      const segBtns = [...modal.querySelectorAll('.seg .seg-btn')].map(b => (b.textContent || '').trim());
      const labels = [...modal.querySelectorAll('.field > label')].map(l => (l.textContent || '').trim());
      const combo = modal.querySelector('.combo-input');
      return {
        noModal: false,
        title: (modal.querySelector('.df-modal-hd b') || {}).textContent ? modal.querySelector('.df-modal-hd b').textContent.trim() : '',
        segBtns, labels,
        placeholder: combo ? combo.getAttribute('placeholder') : null,
        onBtn: (modal.querySelector('.seg .seg-btn.on') || {}).textContent ? modal.querySelector('.seg .seg-btn.on').textContent.trim() : '',
        hasCustomerWord: /客户/.test(txt.replace(/客户档案/g, '')),   // 排除「客户档案」这类正当用法
        txt: txt.replace(/\n+/g, ' | ').slice(0, 260),
      };
    });
    if (mapProbe.noModal) throw new Error('新建配置弹窗未出现（.df-modal.edit-modal 找不到）');
    console.log('      弹窗标题: ' + mapProbe.title);
    console.log('      类型按钮: ' + JSON.stringify(mapProbe.segBtns));
    console.log('      字段标签: ' + JSON.stringify(mapProbe.labels));
    console.log('      placeholder: ' + JSON.stringify(mapProbe.placeholder));

    check(mapProbe.title === '新建配置', '弹窗标题 = 新建配置');
    check(JSON.stringify(mapProbe.segBtns) === JSON.stringify(['门店', '本人仓']),
      '🔴 类型分段控件 == ["门店","本人仓"]（.includes("客户")? ' + mapProbe.segBtns.includes('客户') + '）');
    check(!mapProbe.segBtns.includes('客户'), '🔴 **没有**「客户」选项');
    check(mapProbe.onBtn === '门店', '默认选中「门店」（on = ' + mapProbe.onBtn + '）');
    // ⚠️ label 里含「*」（必填星号，如「门店全称 *」）⇒ 必须用 startsWith 而不是精确相等。
    check(mapProbe.labels.some(l => l.startsWith('门店全称')),
      'label == 「门店全称 *」（typeLabel 已归一）：' + JSON.stringify(mapProbe.labels.filter(l => /全称/.test(l))));
    check(mapProbe.placeholder === '搜索门店名称…', '对象下拉 placeholder == 搜索门店名称…');
    check(!mapProbe.hasCustomerWord, '弹窗内**无**「客户」（已排除「客户档案」正当用法）');

    // ---------- ③ 切「本人仓」：该分支未被误伤 ----------
    console.log('\n[4] 切到「本人仓」再切回 —— 分支完整性');
    await page.evaluate(() => {
      const modal = document.querySelector('.df-modal.edit-modal');
      const b = [...modal.querySelectorAll('.seg .seg-btn')].find(x => (x.textContent || '').trim() === '本人仓');
      if (b) b.click();
    });
    await sleep(700);
    const whProbe = await page.evaluate(() => {
      const modal = document.querySelector('.df-modal.edit-modal');
      const txt = modal.innerText || '';
      return {
        labels: [...modal.querySelectorAll('.field > label')].map(l => (l.textContent || '').trim()),
        hasSrcDst: /源仓/.test(txt) && /目标仓/.test(txt),
        onBtn: (modal.querySelector('.seg .seg-btn.on') || {}).textContent ? modal.querySelector('.seg .seg-btn.on').textContent.trim() : '',
      };
    });
    check(whProbe.onBtn === '本人仓', '切换生效（on = ' + whProbe.onBtn + '）');
    check(whProbe.labels.some(l => l.startsWith('本人仓全称')),
      'label 随类型变「本人仓全称 *」：' + JSON.stringify(whProbe.labels.filter(l => /全称/.test(l))));
    check(whProbe.hasSrcDst, '出现「源仓 / 目标仓」（本人仓分支未被误伤）');
    await page.screenshot({ path: OUT + '/03-切本人仓.png' });

    // 切回「门店」并按「取消」关闭（🔴 绝不点保存）
    await page.evaluate(() => {
      const modal = document.querySelector('.df-modal.edit-modal');
      const b = [...modal.querySelectorAll('.seg .seg-btn')].find(x => (x.textContent || '').trim() === '门店');
      if (b) b.click();
    });
    await sleep(500);
    const closed = await page.evaluate(() => {
      const modal = document.querySelector('.df-modal.edit-modal');
      const b = [...modal.querySelectorAll('.df-modal-ft button')].find(x => /取消/.test((x.textContent || '').trim()));
      if (!b) return false;
      b.click(); return true;
    });
    check(closed, '弹窗以「取消」关闭（未触发任何写入）');
    await sleep(800);
    const gone = await page.evaluate(() => !document.querySelector('.df-modal.edit-modal'));
    check(gone, '弹窗已关闭');

    // ---------- ④⑤ 列表类型标签 + 导入说明 ----------
    console.log('\n[5] 列表类型标签 & Excel 导入说明');
    const listProbe = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.tbl tbody tr')];
      const items = rows.map(tr => {
        const tds = tr.querySelectorAll('td');
        const tag = tds[1] ? (tds[1].querySelector('.tag') || {}).textContent : null;
        return { tag: tag ? tag.trim() : null, cells: tds.length };
      }).filter(x => x.cells > 3);
      return { n: items.length, items, emptyHint: /暂无报单配置/.test(document.body.innerText || '') };
    });
    console.log('      列表行: ' + JSON.stringify(listProbe.items));
    if (listProbe.n) {
      const tags = listProbe.items.map(i => i.tag);
      check(tags.every(t => t === '门店' || t === '本人仓'),
        '🔴 全部类型标签 ∈ {门店, 本人仓}：' + JSON.stringify(tags));
      check(!tags.includes('客户'), '🔴 列表中**没有**「客户」标签');
    } else {
      check(true, '列表无数据（本账号可见范围为空）⇒ 类型标签断言不适用');
    }

    const impOpened = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => /Excel 批量导入/.test((x.textContent || '').trim()));
      if (!b) return false;
      b.click(); return true;
    });
    check(impOpened, '打开「Excel 批量导入」弹窗');
    await sleep(1000);
    const impProbe = await page.evaluate(() => {
      const modals = [...document.querySelectorAll('.df-modal')];
      const m = modals.map(x => x.innerText || '').find(t => /模板表头/.test(t)) || '';
      return { txt: m.replace(/\n+/g, ' | ').slice(0, 240), hasOld: /store \/ customer/.test(m), hasNew: /store（门店）或 self_warehouse（本人仓）/.test(m) };
    });
    console.log('      导入说明: ' + impProbe.txt);
    check(!impProbe.hasOld, '🔴 旧的「store / customer / self_warehouse」说明已消失');
    check(impProbe.hasNew, '🔴 新说明 == 「store（门店）或 self_warehouse（本人仓）」');
    // ⚠️ 截图必须在**关闭弹窗之前** —— 首次写成关闭后截图，拍到的是一张与页面截图
    //    字节数完全相同的空页面（弹窗已消失），白留一张废证据。
    await page.screenshot({ path: OUT + '/04-导入说明.png' });
    await page.evaluate(() => {
      const modals = [...document.querySelectorAll('.df-modal')];
      const m = modals.find(x => /模板表头/.test(x.innerText || ''));
      if (!m) return;
      const b = [...m.querySelectorAll('.df-modal-ft button')].find(x => /关闭/.test((x.textContent || '').trim()));
      if (b) b.click();
    });
    await sleep(600);

    // ---------- ⑦ 运行时健康度 ----------
    console.log('\n[6] 运行时健康度');
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
