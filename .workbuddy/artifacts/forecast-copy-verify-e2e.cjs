const puppeteer = require('puppeteer-core');
const BASE = 'https://hergent.cn';
const USER = 'boss', PASS = 'boss123';
const checks = [];
function check(n, ok, extra='') { checks.push({n, ok, extra}); console.log((ok?'PASS':'FAIL')+' '+n+(extra?'  '+extra:'')); }

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args:['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  try {
    await page.goto(`${BASE}/#/login`, { waitUntil:'networkidle2', timeout:30000 });
    await page.waitForSelector('input[placeholder="用户名"]', { timeout:10000 });
    await page.type('input[placeholder="用户名"]', USER);
    await page.type('input[placeholder="密码"]', PASS);
    await page.focus('input[placeholder="密码"]');
    await page.keyboard.press('Enter');
    await new Promise(r=>setTimeout(r,2500));
    const logged = await page.evaluate(()=>location.hash.includes('forecast') || !!document.querySelector('.sidebar') || !location.hash.includes('login'));
    check('登录进入应用', logged);

    // 进预报模块
    await page.goto(`${BASE}/#/forecast`, { waitUntil:'networkidle2', timeout:20000 });
    await new Promise(r=>setTimeout(r,2500));
    // 尝试切到交叉表
    const switched = await page.evaluate(()=>{
      const btns=[...document.querySelectorAll('button')];
      const b=btns.find(x=>/交叉|cross/i.test(x.textContent));
      if(b){ b.click(); return true; }
      return false;
    });
    check('切到交叉表视图', switched);
    await new Promise(r=>setTimeout(r,2500));

    // 抓取表头与商品行首列（厂家编码/分销价）
    const head = await page.evaluate(()=>{
      const ths=[...document.querySelectorAll('table th')].map(t=>t.textContent.trim());
      return ths;
    });
    check('交叉表含「厂家编码」列', head.some(h=>/厂家编码|永辉代码/.test(h)), head.filter(h=>/厂家编码|永辉代码|分销/.test(h)).join(','));
    check('交叉表含「分销价」列', head.some(h=>/分销价/.test(h)));

    // 测试复制按钮：在页面内直接覆盖 clipboard.writeText 捕获内容
    await page.evaluate(() => {
      window.__clip = [];
      try {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: (t) => { window.__clip.push(String(t)); return Promise.resolve(); } }
        });
      } catch(e) { window.__clip.push('[define fail '+e.message+']'); }
    });
    const copyResult = await page.evaluate(async ()=>{
      const btn=[...document.querySelectorAll('th button')].find(b=>/⧉/.test(b.textContent));
      if(!btn) return {found:false};
      window.__clip = [];
      btn.click();
      await new Promise(r=>setTimeout(r,600));
      return {found:true, clip: (window.__clip||[]).join('\\n')};
    });
    check('客户列复制按钮存在', copyResult.found);
    if(copyResult.found){
      const clip = copyResult.clip || '';
      const hasTab = /[\t]/.test(clip);
      check('复制文本为 TSV(含Tab)', hasTab, clip.slice(0,120).replace(/\n/g,'\\n').replace(/\t/g,'<TAB>'));
      const looksLikeCode = /^\d+\t\d+$/m.test(clip);
      check('复制行格式 编码\\t数量', looksLikeCode, clip.split('\\n')[0] ? clip.split('\\n')[0].replace(/\t/g,'<TAB>') : '');
    }
  } catch(e){ console.log('ERR', e.message); }
  await browser.close();
  const passed = checks.filter(c=>c.ok).length;
  console.log(`\n结果: ${passed}/${checks.length} PASS`);
  process.exit(passed===checks.length?0:1);
})();
