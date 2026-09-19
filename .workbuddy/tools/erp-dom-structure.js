// 查明 index.html 少一个 </div> 后，浏览器实际把 DOM 收成了什么结构
const puppeteer = require('puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://erp.hergent.cn';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  // 不加载 JS，只看 HTML 解析结果
  await page.setJavaScriptEnabled(false);
  await page.goto(BASE + '/index.html?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(500);

  const out = await page.evaluate(() => {
    const path = (el) => {
      const segs = [];
      while (el && el.tagName !== 'HTML') {
        segs.unshift(el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''));
        el = el.parentElement;
      }
      return segs.join(' > ');
    };
    const descendants = (id) => {
      const root = document.getElementById(id);
      if (!root) return '(不存在)';
      return [...root.querySelectorAll('*')].map(e => e.id || e.tagName.toLowerCase())
        .filter(x => /appLayout|topBar|sidebar|contentArea|aiCopilotBar|login/.test(x)).join(', ');
    };
    const kids = (id) => {
      const el = document.getElementById(id);
      return el ? [...el.children].map(c => c.tagName.toLowerCase() + (c.id ? '#' + c.id : '.anon')).slice(0, 12).join(' ') : '(不存在)';
    };
    return {
      appLayoutPath: path(document.getElementById('appLayout')),
      topBarPath: path(document.getElementById('topBar')),
      sidebarPath: path(document.getElementById('sidebar')),
      loginPath: path(document.getElementById('loginOverlay')),
      loginKids: kids('loginOverlay'),
      topBarKids: kids('topBar'),
      appLayoutKids: kids('appLayout'),
      loginDescendants: descendants('loginOverlay'),
      dividerCount: document.querySelectorAll('#loginOverlay div').length,
      bodyKids: [...document.body.children].map(c => c.tagName.toLowerCase() + (c.id ? '#' + c.id : '.anon')).join(' '),
    };
  });

  const keys = ['loginPath', 'loginKids', 'topBarKids', 'appLayoutKids', 'sidebarPath', 'appLayoutPath', 'loginDescendants', 'bodyKids'];
  keys.forEach(k => console.log(k.padEnd(18) + ':', out[k]));
  await browser.close();
})().catch(e => { console.error('异常:', e); process.exit(1); });
