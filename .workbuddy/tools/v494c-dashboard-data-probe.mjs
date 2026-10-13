#!/usr/bin/env node
/**
 * v494c 生产真机端到端探针（只读）—— 「标准售价补完后，毛利三图确实渲染出真实数据」
 * 与 v494 探针相反：v494 验证「价没录时空态讲真话」；本探针验证「价补完后图有数据、不报错、不假象」。
 * 做法：注入 boss 只读令牌 → 进生产 #/dashboard → 三卡逐卡断言 → 截图。
 * 用法：V494C_TOKEN=<令牌> node .workbuddy/tools/v494c-dashboard-data-probe.mjs
 * 🔴 只读：只发 GET。
 */
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { fileURLToPath } from 'node:url'
import { launch } from './lib/cdp-lite.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = path.join(ROOT, 'outputs/v494c-dashboard-data')
const BASE = 'https://hergent.cn'
const TOKEN = process.env.V494C_TOKEN
if (!TOKEN) { console.log('🔴 缺 V494C_TOKEN'); process.exit(2) }

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
  const browser = await launch({})
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(INIT)

  const base = BASE + '/?__r=' + Date.now() + '#/dashboard'
  await page.goto(base, 8000)
  const okReady = await until(page, `document.querySelectorAll('.ch-fig,.ch-hb,.ch-donut').length >= 3`)
  ck('页面图表容器出现', okReady)
  await until(page, `document.querySelectorAll('.ch-hb-bar').length > 0`, 25000)

  const snap = await page.eval(`(()=>{
    const q = (s) => Array.from(document.querySelectorAll(s));
    const txt = (el) => (el ? (el.textContent||'').replace(/\\s+/g,' ').trim() : '');
    const titleOf = (card) => txt(card && card.querySelector('.ch-fig-ti b'));
    const cards = q('.card');
    const profitCards = ['品牌毛利结构','商品毛利排行','品类毛利对比'].map((t) => {
      const c = cards.find((x) => titleOf(x).includes(t));
      return {
        t, found: !!c,
        state: txt(c && c.querySelector('.ch-state')),
        bars: c ? c.querySelectorAll('.ch-hb-bar').length : -1,
        arcs: c ? c.querySelectorAll('.ch-arc').length : -1,
        vbars: c ? c.querySelectorAll('.ch-bar').length : -1,
        segs: c ? c.querySelectorAll('.ch-donut-seg,path,.seg').length : -1,
        hasMoneyHd: /合计|万元|毛利合计|元/.test(txt(c && c.querySelector('.ch-fig-hd'))),
      };
    });
    const cust = cards.find(c => titleOf(c).includes('客户销额排行'));
    return {
      profitCards,
      custBars: cust ? cust.querySelectorAll('.ch-hb-bar').length : 0,
      allStates: q('.ch-state').map(txt).filter(Boolean),
      errs: window.__ERR.slice(0, 10),
      api: Array.from(new Set(window.__API)).slice(0, 40),
    };
  })()`)

  ck('毛利三图都在页面上', snap.profitCards.every((s) => s.found),
    JSON.stringify(snap.profitCards.map((s) => s.t + ':' + (s.found ? '有' : '缺'))))
  /* 核心断言 1：三卡现在必须画出数据（弧/条 > 0）—— 价补完后空态应消失。
     Donut=arcs、Hbar=bars(.ch-hb-bar)、Bar=vbars(.ch-bar)。 */
  ck('三卡都画出数据条/弧（价补完非空态）',
    snap.profitCards.every((s) => (s.bars > 0 || s.arcs > 0 || s.vbars > 0)),
    JSON.stringify(snap.profitCards.map((s) => s.t + ':bars=' + s.bars + ',arcs=' + s.arcs + ',vbars=' + s.vbars)))
  /* 核心断言 2：三卡都不再显示「标准售价」/「这段时间还没有数据」空态文案。 */
  ck('三卡无空态假话文案',
    snap.profitCards.every((s) => !/标准售价|这段时间还没有数据|还没有数据/.test(s.state)),
    JSON.stringify(snap.profitCards.map((s) => s.state.slice(0, 24))))
  /* 核心断言 3：零 JS 异常（确认带负值/混合符号的真实数据不会让图表组件崩）。 */
  ck('零页面 JS 异常', snap.errs.length === 0, JSON.stringify(snap.errs))
  /* 回归：客户销额排行仍有真实数据。 */
  ck('客户销额排行仍有真实数据条', snap.custBars > 0, 'bars=' + snap.custBars)
  ck('调用了两个报表端点',
    snap.api.some((u) => u.includes('/api/reports/profit-breakdown')) &&
    snap.api.some((u) => u.includes('/api/reports/customer-profitability')), '')

  try {
    await page.raw.send('Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 3200, deviceScaleFactor: 1, mobile: false })
    await sleep(700)
    await page.eval('window.scrollTo(0,0)')
    await sleep(300)
  } catch (e) { console.log('（视口放大失败）', e.message) }
  await page.screenshot(path.join(OUT, 'dashboard-full.png'))

  let pass = 0
  for (const r of R) { console.log((r.ok ? '✅' : '🔴') + ' ' + r.name + (r.extra ? '  | ' + r.extra : '')); if (r.ok) pass++ }
  console.log('=== ' + pass + '/' + R.length + ' ===')
  fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify(snap, null, 1))
  process.exit(pass === R.length ? 0 : 1)
}
main().catch((e) => { console.log('FATAL', e); process.exit(3) })
