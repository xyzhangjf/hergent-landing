#!/usr/bin/env node
/**
 * v499 生产真机端到端探针（只读）—— 验收「侧栏重复入口」第二处删除
 *
 * 背景：老板实测发现「目标与返利 › 目标配置」与「市场营销 › 合约管理 › 供应商返利试算」
 *       两个入口指向同一界面（同为 /rebate?tab=rules）。v499 删掉后者。
 *
 * 🔴 判别力纪律（与 v497 同）：「没看到 X」必须配**阳性对照**，
 *    否则可能只是弹窗根本没展开（trivially pass，零判别力）：
 *      - 市场营销区：阳性对照 = 同列仍能看到「供应商返利试算」「费用合同」
 *      - 目标与返利区：阳性对照 = 仍能看到「目标配置」「达成填报」
 *
 * 用法：V499_TOKEN=<令牌> node .workbuddy/tools/v499-sidebar-dedupe-probe.mjs
 * 🔴 只读：只发 GET + 点击侧栏，不做任何写操作。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './lib/cdp-lite.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = path.join(ROOT, 'outputs/v499-sidebar-dedupe')
const BASE = 'https://hergent.cn'
const TOKEN = process.env.V499_TOKEN
if (!TOKEN) { console.log('🔴 缺 V499_TOKEN'); process.exit(2) }

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
  await sleep(800)
  return await page.eval(`(()=>{
    const pop=document.querySelector('.sb-pop');
    if(!pop) return null;
    return [...pop.querySelectorAll('.sb-pop-item span')].map(s=>(s.textContent||'').trim());
  })()`)
}

const R = []
function ck(name, ok, extra) { R.push({ name, ok: !!ok, extra: extra === undefined ? '' : extra }) }
const has = (arr, t) => !!arr && arr.some((x) => x.includes(t))

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await launch({})
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(INIT)

  await page.goto(BASE + '/?__r=' + Date.now() + '#/dashboard', 8000)
  await until(page, `document.querySelectorAll('.sb-area-btn').length > 0`, 25000)
  await sleep(600)

  /* ---- ① 市场营销区 ---- */
  const mktItems = await openArea(page, '市场营销')
  ck('能展开「市场营销」区（阳性对照前提）', Array.isArray(mktItems) && mktItems.length > 0,
    'items=' + (mktItems ? mktItems.length : 'null'))
  /* 阳性对照用「返利模板」：它与被删项同列、名字同样带"返利"，
     判别力最强 —— 能证明"扫到了这一列、且过滤器没把带返利的条目一并滤掉"。 */
  ck('阳性对照：区内仍能看到「返利模板」（同列同主题，证明区真展开了）',
    has(mktItems, '返利模板'),
    JSON.stringify((mktItems || []).filter((t) => t.includes('返利'))))
  ck('阳性对照：区内仍能看到「费用合同」（同一列其余条目没被误删）',
    has(mktItems, '费用合同'),
    JSON.stringify((mktItems || []).filter((t) => t.includes('合同') || t.includes('协议'))))
  ck('阳性对照：「合约管理」列 5 项全在（预订订货单/订货模板/返利模板/费用合同/先付协议）',
    ['预订订货单','订货模板','返利模板','费用合同','先付协议'].every((x) => has(mktItems, x)),
    JSON.stringify(['预订订货单','订货模板','返利模板','费用合同','先付协议'].filter((x)=>!has(mktItems,x))))
  ck('「市场营销」区已无「供应商返利试算」（重复入口已删）',
    !has(mktItems, '供应商返利试算'),
    JSON.stringify((mktItems || []).filter((t) => t.includes('供应商'))))
  ck('全站侧栏文本已无「供应商返利试算」字样',
    await page.eval(`(()=>!document.body.innerText.includes('供应商返利试算'))()`), '')

  /* ---- ② 目标与返利区（该留的没被误删）---- */
  const rebateItems = await openArea(page, '目标与返利')
  ck('能展开「目标与返利」区', Array.isArray(rebateItems) && rebateItems.length > 0,
    'items=' + (rebateItems ? rebateItems.length : 'null'))
  ck('「目标与返利」区仍能看到「目标配置」（该留的没被误删）',
    has(rebateItems, '目标配置'), JSON.stringify(rebateItems || []))
  ck('「目标与返利」区「返利结算」仍在（老板拍板的替代页面，删占位入口的正主）',
    has(rebateItems, '返利结算'), JSON.stringify((rebateItems || []).filter((t)=>t.includes('返利'))))
  ck('「目标与返利」区其余子页仍在（仪表盘/达成填报/结算节奏）',
    has(rebateItems, '达成填报') && has(rebateItems, '结算节奏'),
    JSON.stringify((rebateItems || []).slice(0, 8)))

  /* ---- ③ 点「目标配置」真能进 /rebate?tab=rules（删的是副本，正主仍可达）---- */
  const navOk = await page.eval(`(()=>{
    const pop=document.querySelector('.sb-pop'); if(!pop) return false;
    const it=[...pop.querySelectorAll('.sb-pop-item')].find(x=>(x.textContent||'').includes('目标配置'));
    if(!it) return false; it.click(); return true })()`)
  ck('侧栏能点到「目标配置」（入口可交互）', navOk, '')
  await sleep(2200)
  const url = await page.eval(`(()=>location.hash || location.href)()`)
  ck('跳转后 URL 落到 /rebate?tab=rules', /rebate/.test(url) && /rules/.test(url), String(url).slice(0, 80))
  const rebateBody = await page.eval(`(()=>{
    const t=(document.body.innerText||'').replace(/\\s+/g,' ');
    return { len:t.length, hasRules: t.includes('目标')||t.includes('返利'), head:t.slice(0,120) } })()`)
  ck('目标配置页有内容渲染（不是空白页）', rebateBody.len > 200, JSON.stringify(rebateBody).slice(0, 240))

  const errs = await page.eval(`(()=>window.__ERR.slice(0,10))()`)
  ck('零页面 JS 异常', (errs || []).length === 0, JSON.stringify(errs))

  try {
    await page.raw.send('Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 1600, deviceScaleFactor: 1, mobile: false })
    await sleep(700); await page.eval('window.scrollTo(0,0)'); await sleep(300)
  } catch (e) { /* ignore */ }
  await page.screenshot(path.join(OUT, 'rebate-rules.png'))

  let pass = 0
  for (const r of R) { console.log((r.ok ? '✅' : '🔴') + ' ' + r.name + (r.extra ? '  | ' + r.extra : '')); if (r.ok) pass++ }
  console.log('=== ' + pass + '/' + R.length + ' ===')
  fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify({ mktItems, rebateItems, url, rebateBody, errs }, null, 1))
  process.exit(pass === R.length ? 0 : 1)
}
main().catch((e) => { console.log('FATAL', e); process.exit(3) })
