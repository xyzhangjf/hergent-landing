#!/usr/bin/env node
/**
 * v497 生产真机端到端探针（只读）—— 两件事一起验收
 * ① 侧栏不再有「实时概览」（它与经营分析区的「经营趋势」同指 /dashboard ⇒ 两个入口同一界面）
 *    🔴 必须带**阳性对照**：展开「数据报表」区后要能看到「个性化报表」，
 *       否则「没看到实时概览」可能只是区根本没展开（trivially pass，零判别力）。
 * ② 后端 P0 修完后（收入改实际成交金额），三张毛利图仍正常渲染。
 * 用法：V497_TOKEN=<令牌> node .workbuddy/tools/v497-sidebar-and-profit-probe.mjs
 * 🔴 只读：只发 GET。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './lib/cdp-lite.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = path.join(ROOT, 'outputs/v497-sidebar-profit')
const BASE = 'https://hergent.cn'
const TOKEN = process.env.V497_TOKEN
if (!TOKEN) { console.log('🔴 缺 V497_TOKEN'); process.exit(2) }

const INIT = `
;(function(){ try {
  localStorage.setItem("hergent_v2_token", ${JSON.stringify(TOKEN)});
  localStorage.setItem("hergent_v2_tenant", "1");
} catch (e) {} })();
;(function(){ window.__ERR=[];
  window.addEventListener("error", function(e){ window.__ERR.push("error: " + (e.message||"")) });
  window.addEventListener("unhandledrejection", function(e){ window.__ERR.push("reject: " + String(e.reason)) });
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

/* 展开某个职能区并读取它的全部条目名（.sb-pop 是 Teleport 到 body 的浮层） */
async function openArea(page, areaName) {
  const clicked = await page.eval(`(()=>{
    const btns=[...document.querySelectorAll('.sb-area-btn')];
    const b=btns.find(x=>(x.textContent||'').includes(${JSON.stringify(areaName)}));
    if(b){ b.click(); return true } return false })()`)
  if (!clicked) return null
  await sleep(700)
  return await page.eval(`(()=>{
    const pop=document.querySelector('.sb-pop');
    if(!pop) return null;
    return [...pop.querySelectorAll('.sb-pop-item span')].map(s=>(s.textContent||'').trim());
  })()`)
}

const R = []
function ck(name, ok, extra) { R.push({ name, ok: !!ok, extra: extra === undefined ? '' : extra }) }

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch({})
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(INIT)

  await page.goto(BASE + '/?__r=' + Date.now() + '#/dashboard', 8000)
  await until(page, `document.querySelectorAll('.ch-fig,.ch-hb,.ch-donut').length >= 3`)
  await until(page, `document.querySelectorAll('.ch-hb-bar').length > 0`, 25000)

  /* ---- ① 侧栏 ---- */
  const reportsItems = await openArea(page, '数据报表')
  ck('能展开「数据报表」区（阳性对照前提）', Array.isArray(reportsItems) && reportsItems.length > 0,
    JSON.stringify((reportsItems || []).slice(0, 8)))
  /* 阳性对照：区内应当还能看到「个性化报表」—— 证明区真的展开了、下面的"没有实时概览"有判别力 */
  ck('阳性对照：区内仍能看到「个性化报表」',
    !!reportsItems && reportsItems.some((t) => t.includes('个性化报表')),
    JSON.stringify((reportsItems || []).filter((t) => t.includes('个性化'))))
  ck('「数据报表」区已无「实时概览」（重复入口已删）',
    !!reportsItems && !reportsItems.some((t) => t.includes('实时概览')),
    JSON.stringify((reportsItems || []).filter((t) => t.includes('实时'))))

  const analyticsItems = await openArea(page, '经营分析')
  ck('「经营分析」区仍能看到「经营趋势」（该留的没被误删）',
    !!analyticsItems && analyticsItems.some((t) => t.includes('经营趋势')),
    JSON.stringify(analyticsItems || []))

  /* ---- ② 三张毛利图（后端改口径后仍要有数）---- */
  const snap = await page.eval(`(()=>{
    const q=(s)=>Array.from(document.querySelectorAll(s));
    const txt=(el)=>(el?(el.textContent||'').replace(/\\s+/g,' ').trim():'');
    const titleOf=(card)=>txt(card&&card.querySelector('.ch-fig-ti b'));
    const cards=q('.card');
    const profitCards=['品牌毛利结构','商品毛利排行','品类毛利对比'].map((t)=>{
      const c=cards.find((x)=>titleOf(x).includes(t));
      return { t, found:!!c, state:txt(c&&c.querySelector('.ch-state')),
        bars:c?c.querySelectorAll('.ch-hb-bar').length:-1,
        arcs:c?c.querySelectorAll('.ch-arc').length:-1,
        vbars:c?c.querySelectorAll('.ch-bar').length:-1, hd:txt(c&&c.querySelector('.ch-fig-hd')) };
    });
    return { profitCards, errs: window.__ERR.slice(0,10) };
  })()`)
  ck('毛利三图都在页面上', snap.profitCards.every((s) => s.found))
  ck('三卡都画出数据条/弧（后端改口径后仍非空态）',
    snap.profitCards.every((s) => (s.bars > 0 || s.arcs > 0 || s.vbars > 0)),
    JSON.stringify(snap.profitCards.map((s) => s.t + ':bars=' + s.bars + ',arcs=' + s.arcs + ',vbars=' + s.vbars)))
  ck('三卡合计栏显示金额（收入已改为真值，不再是空的）',
    snap.profitCards.some((s) => /合计|万|元/.test(s.hd)),
    JSON.stringify(snap.profitCards.map((s) => s.hd.slice(0, 28))))
  ck('零页面 JS 异常', snap.errs.length === 0, JSON.stringify(snap.errs))

  try {
    await page.raw.send('Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 2400, deviceScaleFactor: 1, mobile: false })
    await sleep(700); await page.eval('window.scrollTo(0,0)'); await sleep(300)
  } catch (e) { /* ignore */ }
  await page.screenshot(path.join(OUT, 'dashboard-full.png'))

  let pass = 0
  for (const r of R) { console.log((r.ok ? '✅' : '🔴') + ' ' + r.name + (r.extra ? '  | ' + r.extra : '')); if (r.ok) pass++ }
  console.log('=== ' + pass + '/' + R.length + ' ===')
  fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify({ reportsItems, analyticsItems, snap }, null, 1))
  process.exit(pass === R.length ? 0 : 1)
}
main().catch((e) => { console.log('FATAL', e); process.exit(3) })
