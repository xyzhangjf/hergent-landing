#!/usr/bin/env node
/**
 * v494 生产真机端到端探针（只读）—— 「毛利图空态讲真话·第二档」验收
 * ============================================================================
 * 背景：v493 晚「以舟谱档案为准补价」把 purchase_price（进货价）补到 190/232 个
 * 有销量商品，但「标准售价」（sale_price）未录 ⇒ /reports/profit-breakdown 现在
 * 返回 收入=0 / 成本=¥779.9万 / 毛利=-¥779.9万。旧判据 pbZero（收入成本双 0）
 * 恒假 ⇒ 三张毛利图的空态文案退回「这段时间还没有数据」这句**假话**，且负毛利
 * 有被读成「亏 780 万」的风险。v494 把判据收紧为「只看收入是否为 0」并分档文案。
 *
 * 做法（沿用 v473/v493 范式）：本地服 dist-v494 → `/api` 透传 https://hergent.cn
 * → 注入 boss 只读令牌 → 进 #/dashboard → 逐卡断言 → 截图。
 *
 * 用法：V494_TOKEN=<令牌> node .workbuddy/tools/v494-dashboard-empty-state-probe.mjs
 * 产物：outputs/v494-dashboard-empty/*.png + measure.json
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
const DIST = path.join(ROOT, 'hergent-cn-v2/dist-v494')
/* V494_BASE 存在 ⇒ 跑「生产真机」（部署后验收）；否则跑本地 dist-v494 + /api 透传。 */
const PROD = (process.env.V494_BASE || '').replace(/\/$/, '')
const OUT = path.join(ROOT, PROD ? 'outputs/v494-dashboard-empty-prod' : 'outputs/v494-dashboard-empty')

const TOKEN = process.env.V494_TOKEN
if (!TOKEN) { console.log('🔴 缺 V494_TOKEN'); process.exit(2) }
if (!PROD && !fs.existsSync(path.join(DIST, 'index.html'))) { console.log('🔴 dist-v494 不存在，先构建'); process.exit(2) }

const MIME = {
  '.html': 'text/html;charset=utf-8', '.js': 'text/javascript',
  '.css': 'text/css;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
  '.txt': 'text/plain;charset=utf-8', '.webp': 'image/webp',
}

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

const R = []
function ck(name, ok, extra) { R.push({ name, ok: !!ok, extra: extra === undefined ? '' : extra }) }

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const { srv, port } = PROD ? { srv: null, port: 0 } : await serve(DIST)
  const base = PROD || ('http://127.0.0.1:' + port)
  const browser = await launch({})
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(INIT)

  await page.goto(base + (PROD ? '/?__r=' + Date.now() + '#/dashboard' : '/#/dashboard'), 5000)
  const okReady = await until(page, `document.querySelectorAll('.ch-fig,.ch-hb,.ch-donut').length >= 3`)
  ck('页面图表容器出现', okReady)
  // 等客户销额的条画出来（证明 reports 两个端点都回来了）
  await until(page, `document.querySelectorAll('.ch-hb-bar').length > 0`, 25000)

  const snap = await page.eval(`(()=>{
    const q = (s) => Array.from(document.querySelectorAll(s));
    const txt = (el) => (el ? (el.textContent||'').replace(/\\s+/g,' ').trim() : '');
    const titleOf = (card) => txt(card && card.querySelector('.ch-fig-ti b'));
    const cards = q('.card');
    /* 毛利三图**逐卡**取空态文案与合计栏。逐卡而不是全页取：
       本页折线图（近 7 天）是真的没有数据，显示默认「这段时间还没有数据」是对的，
       全页取会把它们混进来、断言就没判别力了。 */
    const profitCards = ['品牌毛利结构','商品毛利排行','品类毛利对比'].map((t) => {
      const c = cards.find((x) => titleOf(x).includes(t));
      const sub = c ? c.querySelector('.ch-fig-sub') : null;
      const hd = c ? txt(c.querySelector('.ch-fig-hd')) : '';
      return {
        t, found: !!c,
        state: txt(c && c.querySelector('.ch-state')),
        sub: txt(sub),
        hd,
        /* 合计栏为空时 .ch-fig-sub 是 v-if 掉不渲染的；防呆：再取整个头部文本 */
        hdHasMoney: /合计|万|元/.test(hd),
        /* 🔴 v494 补抓的假毛利形态：退货负数量 × 正进价 = 正「毛利」。
           Donut/Hbar 只绑 :empty-text 没绑 :empty 时，这些假正值会画出
           弧/条（妙奇 ¥238、¥136.61…）。绑了 :empty 后必须一个不剩。 */
        bars: c ? c.querySelectorAll('.ch-hb-bar').length : -1,
        arcs: c ? c.querySelectorAll('.ch-arc').length : -1,
      };
    });
    const cust = cards.find(c => titleOf(c).includes('客户销额排行'));
    return {
      title: document.title,
      profitCards,
      custCard: !!cust,
      custBars: cust ? cust.querySelectorAll('.ch-hb-bar').length : 0,
      note: txt(cust && cust.querySelector('.ch-note')),
      allStates: q('.ch-state').map(txt).filter(Boolean),
      errs: window.__ERR.slice(0, 10),
      api: Array.from(new Set(window.__API)).slice(0, 40),
    };
  })()`)

  ck('毛利三图都在页面上', snap.profitCards.every((s) => s.found),
    JSON.stringify(snap.profitCards.map((s) => s.t + ':' + (s.found ? '有' : '缺'))))
  /* 核心断言 1：三卡空态必须是**第二档新文案** —— 同时含「标准售价」与「不是真亏」。
     「标准售价」把「只缺售价」与「两个价都缺」的老文案区分开；
     「不是真亏」是防 -779.9 万被读成真亏损的那句人话。 */
  ck('三卡空态 = 第二档文案（含「标准售价」且含「不是真亏」）',
    snap.profitCards.every((s) => /标准售价/.test(s.state) && /不是真亏/.test(s.state)),
    JSON.stringify(snap.profitCards.map((s) => s.state.slice(0, 30))))
  /* 核心断言 2：三卡**谁都不许**说「这段时间还没有数据」—— 那是假话
     （本页确有好几百万真实销售，只是目录价没录齐）。 */
  ck('三卡无一说「这段时间还没有数据」',
    snap.profitCards.every((s) => !/这段时间还没有数据/.test(s.state)),
    JSON.stringify(snap.profitCards.map((s) => s.state.slice(0, 20))))
  /* 核心断言 3：合计栏必须是空的 —— 不许显示 -779.9 万（会被读成亏 780 万）。
     判据只看头部文本里有没有金额特征（合计|万|元）：「前 8 名」这种静态副标题
     不是金额，不能连坐。 */
  ck('三卡头部无金额合计（不显示负毛利合计数）',
    snap.profitCards.every((s) => !s.hdHasMoney),
    JSON.stringify(snap.profitCards.map((s) => s.t + ' → ' + s.hd.slice(0, 26))))
  /* 核心断言 4：价没录时三卡**一个数据条/弧都不许画** —— 退货负数量 × 正进价
     会产出正「毛利」（实测妙奇 ¥238/¥136.61/¥122.23），画出来就是把退货当赚钱。 */
  ck('三卡不画任何数据条/弧（退货假毛利不漏出）',
    snap.profitCards.every((s) => s.bars === 0 && s.arcs === 0),
    JSON.stringify(snap.profitCards.map((s) => s.t + ':bars=' + s.bars + ',arcs=' + s.arcs)))
  /* 回归保护：客户销额排行仍是真数据（这次只许改空态，不许碰好的）。 */
  ck('客户销额排行仍有真实数据条', snap.custCard && snap.custBars > 0, 'bars=' + snap.custBars)
  ck('注脚已更新为「标准售价还没录」口径', /标准售价/.test(snap.note), snap.note.slice(0, 60))
  ck('调用了两个报表端点',
    snap.api.some((u) => u.includes('/api/reports/profit-breakdown')) &&
    snap.api.some((u) => u.includes('/api/reports/customer-profitability')), '')
  ck('零页面 JS 异常', snap.errs.length === 0, JSON.stringify(snap.errs))

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
    const c=q('.card').find(x=>txt(x.querySelector('.ch-fig-ti b')).includes('品牌毛利结构'));
    if(!c) return null; const r=c.getBoundingClientRect();
    return { x:Math.max(0,r.x-8), y:Math.max(0,r.y+window.scrollY-8), width:r.width+16, height:r.height+16, scale:1 };
  })()`).catch(() => null)
  if (box) await page.screenshot(path.join(OUT, 'brand-empty.png'), { clip: box })

  fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify({ snap, results: R }, null, 1))

  const pass = R.filter((r) => r.ok).length
  for (const r of R) console.log((r.ok ? '✅' : '🔴') + ' ' + r.name + (r.extra ? '  (' + r.extra + ')' : ''))
  console.log(`\n通过 ${pass}/${R.length}`)
  console.log('毛利三图空态 =', JSON.stringify(snap.profitCards.map((s) => s.t + ' → ' + s.state.slice(0, 34))))
  console.log('客户销额条数 =', snap.custBars, '| 全页空态卡 =', snap.allStates.length)

  await browser.close()
  if (srv) srv.close()
  process.exit(pass === R.length ? 0 : 1)
}
main().catch((e) => { console.error('探针崩溃：', e); process.exit(3) })
