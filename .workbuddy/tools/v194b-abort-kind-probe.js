/* v194b · 实测浏览器 AbortError 的 name/message，并按 Forecast.vue:3447 的分类器逐一比对。
   目的：确认「20 秒超时中止」在界面上到底落哪个 kind 文案（不靠推理）。 */
const { chromium } = require('playwright');

const KIND_RULES = [
  { name: '无权限', re: /403|权限|forbidden|未授权|无权限/i },
  { name: '网络超时', re: /超时|timeout|network|fetch/i },
  { name: '数据校验未通过', re: /不合法|校验|invalid/i },
];

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--ignore-certificate-errors'],
  });
  const page = await browser.newPage();
  await page.goto('https://hergent.cn/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  const out = await page.evaluate(async () => {
    const grab = async (mk) => {
      try {
        const c = new AbortController();
        const p = fetch('/api/products/grid', { signal: c.signal });
        mk(c);
        await p;
        return { reached: 'resolved' };
      } catch (e) {
        return {
          reached: 'threw',
          ctor: (e && e.constructor && e.constructor.name) || String(e),
          name: (e && e.name) || '',
          message: (e && e.message) || '',
          string: String(e),
        };
      }
    };
    const sync = await grab((c) => c.abort());                    // 立即中止
    const timed = await grab((c) => setTimeout(() => c.abort(), 30)); // 30ms 后中止
    return { sync, timed };
  });

  const judge = (r) => {
    const msg = String((r && r.message) || '');
    const hit = KIND_RULES.filter((k) => k.re.test(msg)).map((k) => k.name);
    return { ...r, msg_used_for_match: msg, matched: hit, kind: hit[0] || '网络或服务器异常 (兜底)' };
  };

  console.log(JSON.stringify({ sync: judge(out.sync), timed: judge(out.timed) }, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
