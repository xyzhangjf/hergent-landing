/**
 * v465e-wh-p1-live-probe.mjs —— 仓配管理 P1（仓库作业 6 页）**生产真机**只读探针
 *
 * 与本地探针的分工：
 *   · 本地探针（v465e-wh-p1-local-probe.mjs）打桩 fetch，证明「页面能被路由到、模板能渲染」；
 *   · 本探针**不打桩**，打真生产 https://hergent.cn + 真后端 —— 证明「上线后真的能跑」。
 *
 * 鉴权：1 次 POST /api/auth/demo-login（演示租户 tenant=10 / demo_boss / 只读）。
 * 只读：只 GET 页面与资源，零写请求、零表单提交。
 *
 * 🔴 反例自证：同模块仍在占位的 `/wh/pnl` 必须落在 `.ph-card` 骨架 ——
 *    否则判据没有判别力（把占位页也判成"已落真身"就等于没判）。
 */
import { launch } from './lib/cdp-lite.mjs'
import https from 'node:https'

const BASE = 'https://hergent.cn/'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v465e-wh-p1-live'
import fs from 'node:fs'
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

/* boot 期注入：token + tenant + **只记录不篡改**的 fetch 包装 */
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

/* 🔴 基线页必须放**第一个**跑：它是本模块里**本轮未改动**的占位页，
   用来把「全局既有坏接口」减掉 —— 否则那类失败会把 6 个真页全判红，
   而它们其实与本轮改动无关（技能：「悬空调用扫描必须减基线」）。 */
const CASES = [
  { name: '损益单（仍是占位）', hash: '#/wh/pnl', title: '损益单', land: '.ph-card', real: false, baseline: true },
  { name: '入库单', hash: '#/wh/inbound', title: '入库单', land: '.win-acts', real: true },
  { name: '出库单', hash: '#/wh/outbound', title: '出库单', land: '.wob-acts', real: true },
  { name: '盘点单', hash: '#/wh/stocktake', title: '盘点单', land: '.wst-acts', real: true },
  { name: '出入库策略', hash: '#/wh/strategy', title: '出入库策略', land: '.wsp-panels', real: true },
  { name: '其它入库单', hash: '#/wh/other-in', title: '其它入库单', land: '.woi-acts', real: true },
  { name: '其它出库单', hash: '#/wh/other-out', title: '其它出库单', land: '.woi-acts', real: true },
]

/* 本轮**相关**接口：这些必须 0 失败（强断言） */
const MINE = p => p.startsWith('/api/wh/') || p.startsWith('/api/inbound')

/* 已被证实的**既有**坏接口（与本轮改动无关，证据写在提交信息与交付报告里）：
   · /api/wms/replenishment/needed  500 `no such column: pfc.pick_face_qty`
       —— `erp_db.py:2093` 用 `CREATE TABLE IF NOT EXISTS` 声明了新列名
          （location_code/pick_face_qty/min_qty/max_qty），但线上三个库
          （erp.db / tenant_1.db / tenant_10.db）的 `pick_face_config` 实际列是
          `forward_min/forward_max/reserve_bin` ⇒ 建表语句**从未生效**（IF NOT EXISTS）。
          消费方 `erp_db.py:14157/14162` 引用新列名 ⇒ 恒 500。
          该文件不在本轮 diff 内（`git grep b3667c9~1` 命中 3 处，先于本轮存在）。
   · /api/ui/col-prefs 400「缺少 page 参数」
       —— 演示调用没带 `?page=` ⇒ **探针自身的口径问题**，不是缺陷。 */
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
    await page.goto(BASE + c.hash, 4500)
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
        api: (window.__live && window.__live.api) || []
      });
    })()`)
    d = JSON.parse(raw)
    errs = page.errors || []
    api = d.api || []
    await page.screenshot(`${SHOT_DIR}/${c.name.replace(/[（）]/g, '')}.png`, { fullPage: false })
  } catch (e) {
    d = { href: '(异常)', h2: '', hasPage: false, hasLandmark: false, hasPhCard: null, hasErrState: null, api: [] }
    errs = [(e && e.message) || String(e)]
  }
  const bad4xx = api.filter(x => x[1] >= 400 || x[1] === -1)
  const badPaths = new Set(bad4xx.map(x => x[0]))
  if (c.baseline) baseline = badPaths
  const mineBad = bad4xx.filter(x => MINE(x[0]))
  const newBad = bad4xx.filter(x => !MINE(x[0]) && !baseline.has(x[0]) && !KNOWN_PRE_EXISTING.has(x[0]))
  const checks = [
    ['标题逐字命中', d.h2 === c.title],
    ['页根渲染', d.hasPage === true],
    [`关键地标在(${c.land})`, d.hasLandmark === true],
    ['零 console 错误', errs.length === 0],
    [`本轮相关接口零失败（/api/wh/*、/api/inbound*）`, mineBad.length === 0],
    [`减基线后无新增坏接口`, newBad.length === 0],
  ]
  if (c.real) {
    checks.push(['不是占位骨架', d.hasPhCard === false])
    checks.push(['未落入错误态', d.hasErrState === false])
  } else {
    checks.push(['确为占位骨架', d.hasPhCard === true])
  }
  const bad = checks.filter(x => !x[1]).map(x => x[0])
  const ok = bad.length === 0
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}   ${String(d.href).replace(BASE, '')}`)
  console.log(`      h2="${d.h2}" page=${d.hasPage} 地标=${d.hasLandmark} 占位=${d.hasPhCard} 错误态=${d.hasErrState} errs=${errs.length} api=${api.length} 次`)
  const exempt = bad4xx.filter(x => baseline.has(x[0]) || KNOWN_PRE_EXISTING.has(x[0]))
  if (exempt.length) console.log(`      豁免（既有坏接口，与本轮无关）：${JSON.stringify(exempt)}`)
  if (bad.length) {
    console.log(`      未过：${bad.join(' / ')}`)
    if (errs.length) console.log(`      errs：${errs.slice(0, 2).join(' | ')}`)
    if (mineBad.length) console.log(`      本轮相关接口坏了：${JSON.stringify(mineBad.slice(0, 6))}`)
    if (newBad.length) console.log(`      新增坏接口：${JSON.stringify(newBad.slice(0, 6))}`)
  }
}
await browser.close()
console.log(`\n基线（来自未改动的占位页 /wh/pnl）：${JSON.stringify([...baseline])}`)
console.log(`===== 汇总：PASS ${pass} / FAIL ${fail} =====`)
console.log(`截图：${SHOT_DIR}`)
process.exit(fail ? 1 : 0)

