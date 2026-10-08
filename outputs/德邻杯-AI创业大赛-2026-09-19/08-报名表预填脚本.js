// 德邻杯 2026 AI 创业大赛 · 报名表预填脚本
// 用途：无头 Chrome 打开报名页 → 识别跨域 iframe → 逐字段预填 → 截图 → 回读清单
// 🔴 本脚本只预填，**绝不点「提交」**（提交是不可逆的对外承诺，由本人执行）
//
// 运行：
//   HG_PROXY= DELIN_PHONE=<手机号> DELIN_EMAIL=<邮箱> \
//   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
//   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node "08-报名表预填脚本.js"
//
// 🔴 手机号 / 邮箱属个人信息，**不写进本文件**（本仓 outputs/ 是被 git 跟踪的），一律走环境变量，
//    也请不要把带号码的命令行存进任何脚本或文档。
//
// 🔴 本机 Chrome 启动必须带 --no-sandbox + --disable-gpu：
//    Chrome 自身沙箱在本机沙箱里会 "sandbox initialization failed: Operation not permitted"，
//    GPU 进程也会 exit_code=6 ⇒ 表现为 newPage() 超时或 setViewport 报 "Session closed"。

const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'https://delincapital.com.cn/apply.html?referrersource=track1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const V = {
  projectName: 'Hergent AI 经营副驾',
  contact: '张俊峰',
  phone: process.env.DELIN_PHONE || '',
  email: process.env.DELIN_EMAIL || '',
  refCode: '1005',                                  // 选填，但填了换专属答疑
  refChannel: 'AITOP100（德邻资本生态伙伴）',
  projectType: '纯软（Pure Software）',              // 下拉，封闭词表
  industry: '供应链与电商（Supply Chain & E-Commerce）', // 下拉 21 选 1
  industryKw: '供应链',                              // 虚拟列表要过滤才点得到
  funded: '否（No）',
  city: '湖北省（Hubei Province）',                  // 下拉是省级
  cityKw: '湖北',
};

const log = (...a) => console.log(...a);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-proxy-server', '--no-sandbox', '--disable-setuid-sandbox',
           '--disable-gpu', '--disable-software-rasterizer',
           '--disable-dev-shm-usage', '--no-first-run'],
    timeout: 45000,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1750 });
  page.setDefaultTimeout(8000);            // 关键：别让任一元素卡 30s
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(12000);                       // 给 iframe 内 SPA 充分渲染时间

  const frame = page.frames().find(f => /bp\.delincapital\.com\.cn/.test(f.url()));
  if (!frame) { log('NO FRAME —— 表单 iframe 未加载'); await browser.close(); return; }
  log('表单 frame 已定位:', frame.url().slice(0, 70));

  const safe = async (label, fn) => {
    try { return await fn(); }
    catch (e) { log('  ⚠ ' + label + ' 异常: ' + String(e.message).slice(0, 70)); return null; }
  };

  // React 虚拟列表下拉：必须真实鼠标事件，普通 el.click() 无效
  const pickByText = async (text) => {
    const handle = await safe('定位选项 ' + text, () => frame.evaluateHandle((t) => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim();
      for (const x of Array.from(document.querySelectorAll('*')).reverse()) {
        if (norm(x.textContent) !== t) continue;            // 精确等值，非 includes
        const r = x.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        const st = getComputedStyle(x);
        if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.1) continue;
        x.scrollIntoView({ block: 'center' });              // 必须先滚进视口
        return x;
      }
      return null;
    }, text));
    if (!handle || !handle.asElement) return false;
    const el = handle.asElement();
    if (!el) { await handle.dispose(); return false; }
    await safe('点选 ' + text, () => el.click());
    await sleep(1300);
    await handle.dispose();
    return true;
  };

  const textInput = async (idx, value, label) => {
    const el = await safe(label + ' 取元素',
      () => frame.$$('input[type="text"], input:not([type])').then(a => a[idx]));
    if (!el) { log('  ⚠ ' + label + ' 找不到'); return; }
    await safe(label + ' 聚焦', () => el.evaluate(e => e.focus()));
    await safe(label + ' 清空', () => el.evaluate(e => { e.value = ''; }));
    if (value) await safe(label + ' 输入', () => el.type(value, { delay: 40 }));
    await sleep(400);
    log('  ' + label + ' = ' + JSON.stringify(await el.evaluate(e => e.value).catch(() => '?')));
  };

  const dropdown = async (searchIdx, label, value, keyword) => {
    const el = await safe(label + ' 取下拉',
      () => frame.$$('input[type="search"]').then(a => a[searchIdx]));
    if (!el) { log('  ⚠ ' + label + ' 找不到下拉'); return; }
    await safe(label + ' 打开', () => el.click());
    await sleep(1600);
    if (keyword) {
      await safe(label + ' 清搜索框', () => el.evaluate(e => { e.value = ''; }));
      await safe(label + ' 输入关键字', () => el.type(keyword, { delay: 90 }));
      await sleep(2200);
    }
    await pickByText(value);
    await sleep(700);
  };

  log('【01】项目名称');    await textInput(0, V.projectName, '项目名称');
  log('【01】项目属性');    await dropdown(0, '项目属性', V.projectType);
  log('【01】行业分类');    await dropdown(1, '行业分类', V.industry, V.industryKw);
  log('【01】是否已融资');  await dropdown(2, '是否已融资', V.funded);
  log('【02】联系人');      await textInput(1, V.contact, '联系人');
  log('【02】所属城市');    await dropdown(3, '所属城市', V.city, V.cityKw);
  log('【02】联系电话');    await textInput(2, V.phone, '联系电话');
  log('【02】联系邮箱');    await textInput(3, V.email, '联系邮箱');
  log('【03】项目推荐码');  await textInput(4, V.refCode, '项目推荐码');
  log('【03】推荐人/渠道'); await textInput(5, V.refChannel, '推荐人渠道');

  // 🔴 下拉的选中值渲染在独立元素里，input.value 恒为空 ⇒ 只能取「祖先容器文本」判定
  const snap = await frame.evaluate(() => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const rows = [];
    document.querySelectorAll('input, textarea, select').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height < 5) return;                        // 跳过隐藏的后台字段
      let lab = '';
      let p = el.parentElement;
      for (let k = 0; k < 8 && p; k++) {
        const t = norm(p.innerText || '');
        if (t && t.length < 300) { lab = t.slice(0, 70); break; }
        p = p.parentElement;
      }
      rows.push({ type: el.type, lab, value: el.value });
    });
    return rows;
  });
  log('\n=== 表单当前状态（可见控件）===');
  snap.forEach((s, i) => log('  ' + (i + 1) + '. [' + s.type + '] ' + s.lab + '  →  ' + JSON.stringify(s.value)));

  await page.screenshot({ path: '/tmp/delin_filled.png', fullPage: true });
  log('\n截图 → /tmp/delin_filled.png    （未点提交）');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
