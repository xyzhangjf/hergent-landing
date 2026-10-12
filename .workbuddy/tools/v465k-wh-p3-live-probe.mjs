/**
 * v465k-wh-p3-live-probe.mjs —— 仓配管理 P3（配送作业 3 页落真身）**生产真机**只读探针
 *
 * 与 P2 探针（v465h-wh-p2-live-probe.mjs）同构，本轮三处差异：
 *
 * ① 反例自证换页：P2 用的是 `/wh/delivery`（当时还是占位），**本轮它已落真身** ⇒
 *    反例必须换成仓配区**以外**的占位页，否则判据没判别力。
 *    用数据报表区的 `/reports/sales-order`（未开发，仍占位）——它同时天然是"无配送数据"
 *    的干净页，适合做基线。
 *
 * ② 基线页**第一个**跑：把「全局既有坏接口」减掉，否则那类失败会把 3 个真页全判红。
 *
 * ③ 本轮相关接口清单：/api/delivery*（board/tasks/routes/stops）+/api/vehicles
 *    + /api/sale-orders。⚠️ 配送单页「全部视图」会打 /api/sale-orders，
 *    它是**多模块共用**端点 —— 若它坏了，不能算本轮 P3 的锅，单独豁免记录。
 *
 * 鉴权：1 次 POST /api/auth/demo-login（演示租户，只读）。零写请求、零表单提交。
 */
import { launch } from './lib/cdp-lite.mjs'
import https from 'node:https'
import fs from 'node:fs'

const BASE = 'https://hergent.cn/'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v465k-wh-p3-live'
fs.mkdirSync(SHOT_DIR, { recursive: true })

function demoLogin() {
  return new Promise((resolve, reject) => {
    const body = '{}'
    const req = https.request(BASE + 'api/auth/demo-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, res => {
      let t = ''
      res.on('data', c => (t += c))
      res.on('end', () => {
        try { resolve(JSON.parse(t)) } catch (e) { reject(new Error('demo-login 解析失败: ' + t.slice(0, 200))) }
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

const login = await demoLogin()
if (!login.token) { console.log('!! demo-login 未返回 token'); process.exit(2) }
console.log(`demo-login ok：tenant=${login.tenant_id} user=${login.user && login.user.username}`)

/* boot 期注入：token + tenant + 只记录不篡改的 fetch 包装 */
const INIT = `
(function(){
  try {
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(login.token)});
    localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(String(login.tenant_id))});
  } catch(e){}
  window.__live = { api: [] };
  var of = window.fetch;
  window.fetch = function(input, init){
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    var path = url.replace(/^https?:\\/\\/[^/]+/, '').split('?')[0];
    return of.apply(this, arguments).then(function(res){
      if (path.indexOf('/api/') === 0) window.__live.api.push([path, res.status]);
      return res;
    }, function(e){
      if (path.indexOf('/api/') === 0) window.__live.api.push([path, -1]);
      throw e;
    });
  };
})();
`

/* 🔴 地标 class 来自各页真实源码（不要凭印象写，写错则断言恒假）：
     DeliveryOrder.vue → .dvo-acts ｜ DriverBoard.vue → .dbd-acts ｜ RouteSetup.vue → .rts-acts */
const CASES = [
  /* 基线页：必须是占位（反例自证）且第一个跑 */
  { name: '数据报表区销售订单（仍是占位，兼基线）', hash: '#/reports/sales-order', title: '', land: '.ph-card', real: false, baseline: true },
  { name: '配送单',     hash: '#/wh/delivery',     title: '配送单',       land: '.dvo-acts', real: true },
  { name: '司机任务看板', hash: '#/wh/driver-board', title: '司机任务看板', land: '.dbd-acts', real: true },
  { name: '线路设置',   hash: '#/wh/route-setup',  title: '线路设置',     land: '.rts-acts', real: true },
]

/* 本轮**相关**接口：这些必须 0 失败（强断言）。
   🔴 /api/sale-orders 是多模块共用端点（配送单「全部视图」只是它的消费者之一），
      它若坏了不能算 P3 的锅 —— 从强断言里排除，但要在输出里单列，避免"静默豁免"。 */
const MINE_STRICT = p => p.startsWith('/api/delivery') || p.startsWith('/api/vehicles')
const MINE_SHARED = p => p.startsWith('/api/sale-orders')
const isMine = p => MINE_STRICT(p) || MINE_SHARED(p)

/* 已被证实的**既有**坏接口（证据见 v465e / v465h 探针头注释，与本轮无关） */
const KNOWN_PRE_EXISTING = new Set(['/api/wms/replenishment/needed', '/api/ui/col-prefs'])

let pass = 0, fail = 0
let baseline = new Set()
const browser = await launch({ headless: true })
for (const c of CASES) {
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(INIT)
  let d = {}, errs = [], api = []
  try {
    await page.goto(BASE + c.hash, 5000)
    const raw = await page.eval(`(function(){
      var h2 = document.querySelector('.page-hd h2');
      return JSON.stringify({
        href: location.href,
        h2: h2 ? h2.textContent.trim() : '',
        hasPage: !!document.querySelector('.page'),
        hasLandmark: !!document.querySelector(${JSON.stringify(c.land)}),
        hasPhCard: !!document.querySelector('.ph-card'),
        hasErrState: !!document.querySelector('.state-error'),
        errText: ((document.querySelector('.state-error')||{}).innerText||'').slice(0,120),
        bodyText: ((document.querySelector('.page')||{}).innerText||'').slice(0,300),
        api: (window.__live && window.__live.api) || []
      });
    })()`)
    d = JSON.parse(raw)
    errs = page.errors || []
    api = d.api || []
    await page.screenshot(`${SHOT_DIR}/${c.name.replace(/[（）]/g, '')}.png`, { fullPage: false })
  } catch (e) {
    d = { href: '(异常)', h2: '', hasPage: false, hasLandmark: false, hasPhCard: null, hasErrState: null, bodyText: '', api: [] }
    errs = [(e && e.message) || String(e)]
  }
  const bad4xx = api.filter(x => x[1] >= 400 || x[1] === -1)
  const badPaths = new Set(bad4xx.map(x => x[0]))
  if (c.baseline) baseline = badPaths
  const mineBad = bad4xx.filter(x => MINE_STRICT(x[0]))
  const sharedBad = bad4xx.filter(x => MINE_SHARED(x[0]))
  const newBad = bad4xx.filter(x => !isMine(x[0]) && !baseline.has(x[0]) && !KNOWN_PRE_EXISTING.has(x[0]))
  const checks = [
    ['页根渲染', d.hasPage === true],
    [`关键地标在(${c.land})`, d.hasLandmark === true],
    ['零 console 错误', errs.length === 0],
    ['本轮专属接口零失败（delivery*/vehicles）', mineBad.length === 0],
    ['减基线后无新增坏接口', newBad.length === 0],
  ]
  if (c.real) {
    checks.unshift(['标题逐字命中', d.h2 === c.title])
    checks.push(['不是占位骨架', d.hasPhCard === false])
    checks.push(['未落入错误态', d.hasErrState === false])
  } else {
    checks.unshift(['确为占位骨架（反例自证）', d.hasPhCard === true])
  }
  const bad = checks.filter(x => !x[1]).map(x => x[0])
  const ok = bad.length === 0
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}   ${String(d.href).replace(BASE, '')}`)
  console.log(`      h2="${d.h2}" page=${d.hasPage} 地标=${d.hasLandmark} 占位=${d.hasPhCard} 错误态=${d.hasErrState} errs=${errs.length} api=${api.length} 次`)
  console.log(`      api清单：${JSON.stringify([...new Set(api.map(x => x[0] + '=' + x[1]))])}`)
  const exempt = bad4xx.filter(x => baseline.has(x[0]) || KNOWN_PRE_EXISTING.has(x[0]))
  if (exempt.length) console.log(`      豁免（既有坏接口，与本轮无关）：${JSON.stringify(exempt)}`)
  if (sharedBad.length) console.log(`      ⚠️ 共用端点 /api/sale-orders 失败（不算 P3 的锅，但要看）：${JSON.stringify(sharedBad.slice(0, 4))}`)
  if (bad.length) {
    console.log(`      未过：${bad.join(' / ')}`)
    if (errs.length) console.log(`      errs：${errs.slice(0, 2).join(' | ')}`)
    if (mineBad.length) console.log(`      本轮专属接口坏了：${JSON.stringify(mineBad.slice(0, 6))}`)
    if (newBad.length) console.log(`      新增坏接口：${JSON.stringify(newBad.slice(0, 6))}`)
    if (d.hasErrState) console.log(`      错误态文案：${d.errText}`)
  }
}
await browser.close()
console.log(`\n基线（来自未改动的占位页 /reports/sales-order）：${JSON.stringify([...baseline])}`)
console.log(`===== 汇总：PASS ${pass} / FAIL ${fail} =====`)
console.log(`截图：${SHOT_DIR}`)
process.exit(fail ? 1 : 0)
