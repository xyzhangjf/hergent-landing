#!/usr/bin/env node
/**
 * v493 生产真机端到端探针（只读）—— 本轮「客户销额排行 + 毛利图诚实提示」的真数据验收
 * ============================================================================
 * 为什么不能只跑本地假数据：这一轮的改动**全部由真实数据触发**（成本恒 0 ⇒ 不能叫"利润"、
 * 毛利三图必须吐出"价没录"而不是"没数据"）。假数据造不出这个形状，只能打真后端。
 *
 * 做法（沿用 v473 范式）：本地服 dist-v493 → `/api` 透传 https://hergent.cn →
 * 注入 boss 令牌 → 进 #/dashboard → 断言 → 截图。
 *
 * 用法：V493_TOKEN=<令牌> node .workbuddy/tools/v493-prod-realdata-probe.mjs
 * 产物：outputs/v493-dashboard/*.png + measure.json
 * 🔴 只读：只发 GET，不写任何东西；令牌不落盘、不打印。
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { fileURLToPath } from 'node:url'
import { launch } from './lib/cdp-lite.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const DIST = path.join(ROOT, 'hergent-cn-v2/dist-v493')
const OUT = path.join(ROOT, 'outputs/v493-dashboard')

const TOKEN = process.env.V493_TOKEN
if (!TOKEN) { console.log('🔴 缺 V493_TOKEN'); process.exit(2) }
if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.log('🔴 dist-v493 不存在，先构建'); process.exit(2) }

const MIME = {
  '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
  '.txt': 'text/plain;charset=utf-8', '.webp': 'image/webp',
}

/* ---------------- 本地静服 + /api 透传生产 ---------------- */
function serve(dir) {
  return new Promise((res) => {
    const srv = http.createServer((rq, rs) => {
      const u = rq.url || '/'
      if (u.startsWith('/api/')) {
        const preq = https.request({
          hostname: 'hergent.cn', port: 443, path: u, method: rq.method,
          headers: { ...rq.headers, host: 'hergent.cn' },
        }, (prs) => { rs.writeHead(prs.statusCode, prs.headers); prs.pipe(rs) })
        rq.pipe(preq)
        preq.on('error', (e) => { rs.writeHead(502); rs.end('proxy: ' + e.message) })
        return
      }
      let p = decodeURIComponent(u.split('?')[0])
      if (p === '/' || !path.extname(p)) p = '/index.html'
      const f = path.join(dir, p)
      if (!f.startsWith(dir) || !fs.existsSync(f)) { rs.writeHead(404); rs.end('nf'); return }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' })
      fs.createReadStream(f).pipe(rs)
    })
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }))
  })
}

const INIT = `
;(function(){ try {
  localStorage.setItem("hergent_v2_token", ${JSON.stringify(TOKEN)});
  localStorage.setItem("hergent_v2_tenant", "1");
} catch (e) {} })();
;(function(){ window.__ERR=[]; window.__API=[];
  window.addEventListener("error", function(e){ window.__ERR.push("error: " + (e.message||"")) });
  window.addEventListener("unhandledrejection", function(e){ window.__ERR.push("reject: " + String(e.reason)) });
  var _f = window.fetch;
  window.fetch = function(){ try { window.__API.push(String(arguments[0])) } catch(e){};
    return _f.apply(this, arguments) };
})();
`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 轮询直到条件为真（CDP 原生 evaluate，不走 rAF，避免无头下不触发） */
async function until(page, expr, timeoutMs = 25000, step = 400) {
  const t0 = Date.now()
  for (;;) {
    let v = false
    try { v = await page.eval(`(()=>{try{return !!(${expr})}catch(e){return false}})()`) } catch { /* 导航中 */ }
    if (v) return true
    if (Date.now() - t0 > timeoutMs) return false
    await sleep(step)
  }
}

const R = []  // 断言结果
function ck(name, ok, extra) { R.push({ name, ok: !!ok, extra: extra === undefined ? '' : extra }); }

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const { srv, port } = await serve(DIST)
  const base = 'http://127.0.0.1:' + port
  const browser = await launch({})
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(INIT)

  await page.goto(base + '/#/dashboard', 5000)
  const okReady = await until(page, `document.querySelectorAll('.ch-fig,.ch-hb,.ch-donut').length >= 3`)
  ck('页面图表容器出现', okReady)
  // 等「客户销额排行」这张新卡的条画出来
  await until(page, `document.querySelectorAll('.ch-hb-bar').length > 0`, 25000)

  const snap = await page.eval(`(()=>{
    const q = (s) => Array.from(document.querySelectorAll(s));
    const txt = (el) => (el ? (el.textContent||'').replace(/\\s+/g,' ').trim() : '');
    const titleOf = (card) => txt(card && card.querySelector('.ch-fig-ti b'));
    const cards = q('.card');
    const cust = cards.find(c => titleOf(c).includes('客户销额排行'));
    const bars = cust ? cust.querySelectorAll('.ch-hb-bar') : [];
    const names = cust ? Array.from(cust.querySelectorAll('.ch-hb-name')).map(txt) : [];
    const vals  = cust ? Array.from(cust.querySelectorAll('.ch-hb-val')).map(txt) : [];
    const states = q('.ch-state').map(txt).filter(Boolean);
    /* 🔴 名称「在 DOM 里」不等于「看得见」——v493 修掉的那个缺陷正是如此：
       文本存在、文本正确、但被画在 viewBox 左侧之外（x=-2，anchor=end）。
       所以这里按**屏幕盒**判：必须落在 svg 的左右边界之内且宽度 > 0。 */
    let namesVisible = 0;
    if (cust) {
      const svg = cust.querySelector('.ch-svg');
      const sr = svg ? svg.getBoundingClientRect() : null;
      Array.from(cust.querySelectorAll('.ch-hb-name')).forEach((t) => {
        const r2 = t.getBoundingClientRect();
        if (sr && r2.width > 0 && r2.left >= sr.left - 1 && r2.right <= sr.right + 1) namesVisible++;
      });
    }
    /* 毛利三图**逐卡**取空态文案。为什么要逐卡而不是全页取：
       本页的折线图（近 7 天销售 / 收支趋势）现在是**真的**没有数据，它们用默认
       「这段时间还没有数据」是**对的** —— 全页取会把它们混进来，断言就没判别力了。 */
    const profitStates = ['品牌毛利结构','商品毛利排行','品类毛利对比'].map((t) => {
      const c = cards.find((x) => titleOf(x).includes(t));
      return { t, found: !!c, state: txt(c && c.querySelector('.ch-state')) };
    });
    return {
      title: document.title,
      custCard: !!cust,
      custTitle: titleOf(cust),
      barCount: bars.length,
      names, vals,
      note: txt(cust && cust.querySelector('.ch-note')),
      namesVisible,
      states, profitStates,
      errs: window.__ERR.slice(0, 10),
      api: Array.from(new Set(window.__API)).slice(0, 40),
    };
  })()`)

  ck('「客户销额排行」卡片存在', snap.custCard, snap.custTitle)
  ck('横向条已绘出（>0 根）', snap.barCount > 0, 'bars=' + snap.barCount)
  ck('榜首名称与真数据一致（多多买菜）', (snap.names[0] || '').includes('多多买菜'), 'top=' + snap.names[0])
  ck('条数 = 前 10 名', snap.barCount === 10, 'bars=' + snap.barCount)
  ck('客户名可见（落在画布内，不是被画到框外）',
    snap.namesVisible === snap.barCount && snap.barCount > 0,
    'visible=' + snap.namesVisible + ' / rows=' + snap.barCount)
  ck('注脚说明了"只排销额"的原因', /进货价/.test(snap.note), snap.note.slice(0, 60))
  ck('毛利三图都在页面上', snap.profitStates.every((s) => s.found),
    JSON.stringify(snap.profitStates.map((s) => s.t + ':' + (s.found ? '有' : '缺'))))
  ck('毛利三图给出「价未录」解释而非「没有数据」',
    snap.profitStates.every((s) => /进货价/.test(s.state)),
    JSON.stringify(snap.profitStates.map((s) => s.state.slice(0, 26))))
  ck('调用了客户经营明细端点', snap.api.some((u) => u.includes('/api/reports/customer-profitability')), '')
  ck('零页面 JS 异常', snap.errs.length === 0, JSON.stringify(snap.errs))

  /* 🔴 截图前先把视口放大到能装下整页。
     为什么必须：`Page.captureScreenshot` 的 `clip` 是**文档坐标**，而
     `captureBeyondViewport` 默认为 false ⇒ 落在当前视口之外的部分**根本不绘制**，
     落盘是一张纯白图 —— 它与「元素没渲染」长得**一模一样**（本轮踩过两次，
     第一次是漏了 window.scrollY，第二次就是没放大视口）。 */
  try {
    await page.raw.send('Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 3200, deviceScaleFactor: 1, mobile: false })
    await sleep(700)
    await page.eval('window.scrollTo(0,0)')
    await sleep(300)
  } catch (e) { console.log('（视口放大失败，截图可能不完整）', e.message) }

  await page.screenshot(path.join(OUT, 'dashboard-full.png'))
  const box = await page.eval(`(()=>{
    const q=(s)=>Array.from(document.querySelectorAll(s));
    const txt=(e)=>(e?(e.textContent||'').replace(/\\s+/g,' '):'');
    const c=q('.card').find(x=>txt(x.querySelector('.ch-fig-ti b')).includes('客户销额排行'));
    if(!c) return null; const r=c.getBoundingClientRect();
    return { x:Math.max(0,r.x-8), y:Math.max(0,r.y+window.scrollY-8), width:r.width+16, height:r.height+16, scale:1 };
  })()`).catch(() => null)
  if (box) await page.screenshot(path.join(OUT, 'cust-rank.png'), { clip: box })

  fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify({ snap, results: R }, null, 1))

  const pass = R.filter((r) => r.ok).length
  for (const r of R) console.log((r.ok ? '✅' : '🔴') + ' ' + r.name + (r.extra ? '  (' + r.extra + ')' : ''))
  console.log(`\n通过 ${pass}/${R.length}`)
  console.log('榜首 =', snap.names.slice(0, 3).join(' / '), '| 值 =', snap.vals.slice(0, 3).join(' / '))
  console.log('空态文案 =', JSON.stringify(snap.states).slice(0, 200))
  console.log('毛利三图空态 =', JSON.stringify(snap.profitStates.map((s) => s.state.slice(0, 30))))

  await browser.close()
  srv.close()
  process.exit(pass === R.length ? 0 : 1)
}
main().catch((e) => { console.error('探针崩溃：', e); process.exit(3) })
