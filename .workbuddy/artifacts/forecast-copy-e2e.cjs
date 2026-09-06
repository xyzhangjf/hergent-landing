const puppeteer = require('puppeteer-core');

const BASE = 'https://hergent.cn';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const USER = 'boss';
const PASS = 'boss123';

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));

  const log = (...a) => console.log(...a);
  let pass = 0, fail = 0;
  const check = (name, cond) => { if (cond) { pass++; log('PASS', name); } else { fail++; log('FAIL', name); } };

  try {
    // 1) 登录
    await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('input[placeholder="用户名"]', { timeout: 10000 });
    await page.type('input[placeholder="用户名"]', USER);
    await page.type('input[placeholder="密码"]', PASS);
    // 登录走 fetch，password 上按 Enter 提交（"登 录"按钮含 NBSP，form 无 submit）
    await page.focus('input[placeholder="密码"]');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 2500));
    const token = await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (/token|auth|jwt|session/i.test(k)) return localStorage.getItem(k);
      return '';
    });
    // 若 localStorage 无 token，检查是否仍停留在 login 页（未登录）
    const stillLogin = await page.evaluate(() => location.hash.includes('login'));
    check('登录成功(有token或已离开login页)', !!token || !stillLogin);

    // 2) 进预报订货管理
    await page.goto(`${BASE}/#/forecast`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));
    // 选期次（若有下拉）
    const hasPeriod = await page.$('.sel-period');
    if (hasPeriod) {
      // 尝试选第一个非「选择期次」的 option
      await page.evaluate(() => {
        const sel = document.querySelector('.sel-period');
        if (sel && sel.options.length > 1) { sel.selectedIndex = 1; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      await new Promise(r => setTimeout(r, 1500));
    }

    // 3) 切交叉表视图
    const crossTab = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find(x => x.textContent.includes('交叉表视图'));
      if (b) { b.click(); return true; }
      return false;
    });
    check('可切交叉表视图', crossTab);
    await new Promise(r => setTimeout(r, 1500));

    // 4) 验证新列存在（厂家编码/分销价/标准售价）
    const headers = await page.evaluate(() => [...document.querySelectorAll('.cross-tbl thead th')].map(t => t.textContent.trim()));
    log('表头:', headers.join(' | '));
    check('含「厂家编码」列', headers.some(h => h.includes('厂家编码')));
    check('含「分销价」列', headers.some(h => h.includes('分销价')));
    check('含「标准售价」列', headers.some(h => h.includes('标准售价')));

    // 5) 复制全部下单按钮存在
    const hasCopyAll = await page.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('复制全部下单')));
    check('「复制全部下单」按钮存在', hasCopyAll);

    // 6) 复制列按钮(⧉)存在
    const hasColCopy = await page.evaluate(() => !!document.querySelector('.col-copy'));
    check('列复制按钮(⧉)存在', hasColCopy);

    // 7) 编辑模式：验证厂家编码/分销价输入框
    const enteredEdit = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find(x => x.textContent.includes('编辑'));
      if (b) { b.click(); return true; }
      return false;
    });
    check('可进编辑模式', enteredEdit);
    await new Promise(r => setTimeout(r, 2500));
    const editInfo = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('.edit-tbl .prod-cell input')];
      const phs = inputs.map(i => i.placeholder);
      return { phs };
    });
    log('编辑模式商品单元格占位符(prefix):', editInfo.phs.slice(0, 12).join(' | '));
    // 结构顺序: 商品名称|条码|规格|件|售价|进价|分销价|永辉代码|安全库存|保质期
    const ph = editInfo.phs;
    const codeIdx = ph.indexOf('永辉代码');
    const hasCodeInput = codeIdx >= 0;
    check('编辑模式含厂家编码输入框', hasCodeInput);
    // 分销价位于「永辉代码」前一位（0 占位），且其前是进价(0)、前前是售价(0)
    const hasDistInput = codeIdx >= 2 && ph[codeIdx - 1] === '0' && ph[codeIdx - 2] === '0' && ph[codeIdx - 3] === '0';
    check('编辑模式含分销价输入框(永辉代码前)', hasDistInput);

    log(`\n结果: ${pass} 通过 / ${fail} 失败`);
    if (errors.length) log('控制台错误:', errors.slice(0, 8).join('\n'));
  } catch (e) {
    log('E2E 异常:', e.message);
    fail++;
  } finally {
    await browser.close();
    process.exit(fail ? 1 : 0);
  }
})();
