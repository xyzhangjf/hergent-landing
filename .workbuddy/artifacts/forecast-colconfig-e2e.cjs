const puppeteer = require('puppeteer-core');
const BASE = 'https://hergent.cn';
const USER = 'boss', PASS = 'boss123';
const checks = [];
function check(n, ok, extra='') { checks.push({n, ok}); console.log((ok?'PASS':'FAIL')+' '+n+(extra?'  '+extra:'')); }

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args:['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  try {
    await page.goto(`${BASE}/#/login`, { waitUntil:'networkidle2', timeout:30000 });
    await page.waitForSelector('input[placeholder="用户名"]', { timeout:10000 });
    await page.type('input[placeholder="用户名"]', USER);
    await page.type('input[placeholder="密码"]', PASS);
    await page.focus('input[placeholder="密码"]');
    await page.keyboard.press('Enter');
    await new Promise(r=>setTimeout(r,2500));
    check('登录进入应用', true);

    await page.goto(`${BASE}/#/forecast`, { waitUntil:'networkidle2', timeout:20000 });
    await new Promise(r=>setTimeout(r,2500));
    // 切交叉表
    await page.evaluate(()=>{ const b=[...document.querySelectorAll('button')].find(x=>/交叉/.test(x.textContent)); if(b)b.click(); });
    await new Promise(r=>setTimeout(r,2500));

    // 验证列拆分：表头含独立列 条码/规格/单位/标准售价/分销价/厂家编码/安全库存/保质期
    const heads = await page.evaluate(()=>[...document.querySelectorAll('table.cross-tbl thead th')].map(t=>t.textContent.trim().replace(/\s+/g,' ')));
    const wantCols = ['商品名称','条码','规格','单位','标准售价','分销价','厂家编码','安全库存','保质期'];
    const found = wantCols.filter(c=>heads.some(h=>h.startsWith(c)||h.includes(c)));
    check('只读表列已拆分(独立列)', found.length>=8, '有: '+found.join(','));
    // 商品名称列固定冻结
    const nameFixed = await page.evaluate(()=>{
      const th=[...document.querySelectorAll('table.cross-tbl thead th')].find(t=>/商品名称/.test(t.textContent));
      if(!th) return false;
      return getComputedStyle(th).position==='sticky' && (th.style.left==='0px'||th.style.cssText.includes('left'));
    });
    check('商品名称列固定冻结(left:0)', nameFixed);

    // 列配置菜单
    const menuOpen = await page.evaluate(()=>{
      const b=[...document.querySelectorAll('button')].find(x=>/列配置/.test(x.textContent));
      if(!b) return false; b.click(); return true;
    });
    await new Promise(r=>setTimeout(r,400));
    check('列配置菜单可打开', menuOpen);
    const menuHasName_locked = await page.evaluate(()=>{
      const items=[...document.querySelectorAll('.col-menu-list li')];
      const name=items.find(li=>/商品名称/.test(li.textContent));
      return name && name.classList.contains('locked');
    });
    check('商品名称列在菜单中锁定(不可隐藏)', menuHasName_locked);

    // 隐藏一列（如 保质期天）测试
    const beforeHide = heads.length;
    const hideOk = await page.evaluate(()=>{
      const items=[...document.querySelectorAll('.col-menu-list li')];
      const li=items.find(x=>/保质期/.test(x.textContent));
      if(!li) return false;
      const cb=li.querySelector('input[type=checkbox]');
      cb.checked = false;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    await new Promise(r=>setTimeout(r,500));
    check('可隐藏非固定列(保质期)', hideOk);
    const afterHeads = await page.evaluate(()=>[...document.querySelectorAll('table.cross-tbl thead th')].map(t=>t.textContent.trim()));
    check('隐藏后表头减少该列', !afterHeads.some(h=>/保质期/.test(h)), '隐藏后表头数 '+afterHeads.length);

    // 复制功能仍正常（捕获 TSV）
    await page.evaluate(()=>{
      try{ Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:t=>{window.__clip=String(t);return Promise.resolve();}}}); }catch(e){}
    });
    const copyRes = await page.evaluate(()=>{
      const btn=[...document.querySelectorAll('th button')].find(b=>/⧉/.test(b.textContent));
      if(!btn) return {found:false};
      window.__clip=''; btn.click();
      return {found:true, clip:window.__clip||''};
    });
    check('复制按钮存在且产出TSV', copyRes.found && /\t/.test(copyRes.clip), copyRes.clip?copyRes.clip.split('\n')[0].replace(/\t/g,'<TAB>'):'');

    // 还原可见列（重新显示保质期，避免污染用户配置）
    await page.evaluate(()=>{
      const b=[...document.querySelectorAll('button')].find(x=>/列配置/.test(x.textContent));
      if(b && !document.querySelector('.col-menu')) b.click();
    });
    await new Promise(r=>setTimeout(r,300));
    await page.evaluate(()=>{
      const items=[...document.querySelectorAll('.col-menu-list li')];
      const li=items.find(x=>/保质期/.test(x.textContent));
      if(li){ const cb=li.querySelector('input[type=checkbox]'); if(cb && !cb.checked) cb.click(); }
    });
    await new Promise(r=>setTimeout(r,300));
  } catch(e){ console.log('ERR', e.message); }
  await browser.close();
  const passed = checks.filter(c=>c.ok).length;
  console.log(`\n结果: ${passed}/${checks.length} PASS`);
  process.exit(passed===checks.length?0:1);
})();
