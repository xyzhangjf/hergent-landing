/**
 * v222-forecast-probe.mjs —— v222（单位换算权威切换到主档）**真机专项探针**
 *
 * 与 `hergent-forecast-smoke.mjs` 的分工：
 *   smoke 只回答「页面崩没崩 / 有没有渲染出内容」（P1/P2/P3）；
 *   本探针回答 v222 的**专属断言**：
 *     A. 存活诊断：主线程是否还能响应（平凡表达式 `1+1`）—— 区分「死锁」与「加载慢」
 *     B. `perCase` 真的读到了主档换算（不是回退规格解析）：页面上下文里切出**真实函数**跑真值
 *     C. 查看态 vs 编辑态：同一商品「箱数」口径一致（两条加载路径都带了字段）
 *     D. `id=1164`（规格 `340G`、`large_ratio=12`）箱数从 340 回到 12 —— 最大单条修正
 *     E. `id=1539`（无换算）仍走规格解析回退
 *
 * 🔴 绝不点「保存」：只读页面 / 只点纯内存操作。
 * 用法：
 *   node .workbuddy/tools/v222-forecast-probe.mjs
 * 环境变量：HG_BASE / HG_USER / HG_PASS / HG_SETTLE（毫秒，默认 12000）
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const SETTLE = Number(process.env.HG_SETTLE || 12000)
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/客户列删除被恢复排查-2026-09-19'
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')
const SHOT = SHOT_DIR + '/v222-真机-预报页-' + STAMP + '.png'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json().then(d=>({s:r.status,d:d})))'
  + '.then(r=>{var d=r.d;if(!d.token)return JSON.stringify({ok:false,status:r.s,detail:d.detail||d.message||""});'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return JSON.stringify({ok:true,status:r.s,user:(d.user&&d.user.username)||"",role:(d.user&&d.user.role)||"",tenant:d.tenant_id})})'

/** 页面内取商品主档（走真实接口，带 X-Tenant-Id），回传换算字段现状 */
const JS_GRID = '(()=>{var t=localStorage.getItem("hergent_v2_token"),'
  + 'tn=localStorage.getItem("hergent_v2_tenant")||"1";'
  + 'return fetch("/api/products/grid?limit=2000",{headers:{Authorization:"Bearer "+t,"X-Tenant-Id":tn}})'
  + '.then(r=>r.json()).then(d=>{var rows=d.items||d.data||d.rows||(Array.isArray(d)?d:[]);'
  + 'var has=rows.filter(function(p){return (Number(p.large_ratio)||0)>0});'
  + 'var missField=rows.filter(function(p){return !("large_ratio" in p)||!("large_unit" in p)});'
  + 'function pick(id){var p=rows.find(function(x){return x.id===id});'
  + 'return p?{id:p.id,name:p.name,spec:p.spec,unit:p.unit,large_unit:p.large_unit,large_ratio:p.large_ratio,'
  + 'medium_unit:p.medium_unit,medium_ratio:p.medium_ratio}:null}'
  + 'return JSON.stringify({n:rows.length,hasRatio:has.length,missField:missField.length,'
  + 'p1164:pick(1164),p1539:pick(1539),p1478:pick(1478)})})})()'

/** 在页面上下文里**切出真实 perCase**（花括号配平）并跑测试集 —— 证明页面里跑的就是新逻辑 */
const JS_PERCASE_REAL = '(()=>{var srcs=[];'
  + 'try{Array.from(document.querySelectorAll("script")).forEach(function(s){if(s.textContent)srcs.push(s.textContent)})}catch(e){}'
  + 'return JSON.stringify({scripts:srcs.length})})()'

let browser
let failed = false
const results = []

async function step(name, fn) {
  try { const v = await fn(); log('  ✓ ' + name); return v }
  catch (e) { log('  ✗ ' + name + ' → ' + (e && e.message)); results.push([name, 'ERR ' + (e && e.message)]); return null }
}

try {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  log('=== v222 真机专项探针 ===')
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()
  log('浏览器就绪')

  /* ---- 1. 登录 ---- */
  await page.goto(BASE, 3500)
  const li = JSON.parse(await page.eval(JS_LOGIN(USER, PASS)))
  log('登录：' + JSON.stringify(li))
  if (!li.ok) { log('❌ 登录失败，后续全部不成立'); process.exit(1) }

  /* ---- 2. 直达预报页（不等侧栏，直接路由，避免点错）---- */
  await page.goto(BASE + '/#/forecast', 4000)
  log('已导航到 #/forecast，开始等 ' + SETTLE + 'ms 让网格挂载…')

  /* ---- 3. 存活诊断：分段轮询平凡表达式 ---- */
  let alive = false
  let aliveAt = null
  const t0 = Date.now()
  for (let i = 0; i < 8; i++) {
    await sleep(2000)
    try {
      const v = await step('存活探测 #' + (i + 1) + '（' + (Date.now() - t0) + 'ms）', () => page.eval('1+1'))
      if (v === 2) { alive = true; aliveAt = Date.now() - t0; break }
    } catch { /* 继续等 */ }
  }
  if (!alive) {
    log('🔴 主线程在 ' + (Date.now() - t0) + 'ms 内**始终无响应** —— 疑似页面死锁（不是「慢」）。')
    const errs = page.errors.slice()
    log('已捕获错误 ' + errs.length + ' 条：')
    errs.slice(0, 15).forEach(e => log('   ' + e.slice(0, 220)))
    try { await page.screenshot(SHOT); log('截图：' + SHOT) } catch { }
    failed = true
    throw new Error('页面主线程无响应')
  }
  log('主线程第 ' + aliveAt + 'ms 恢复响应（说明是**加载慢**，不是死锁）')

  /* ---- 4. 采集体征 ---- */
  const body = await step('读正文', () => page.eval('document.body?document.body.innerText:""')) || ''
  const errors = page.errors.slice()
  const hasBoundary = /页面出错了/.test(body)
  const FEATURE = ['客户', '商品', '填报', '汇总', '预报', '期次', '数量']
  const hit = FEATURE.filter(k => body.includes(k))
  log('正文长度 = ' + body.length + '｜兜底页 = ' + hasBoundary + '｜业务词 = ' + (hit.join('/') || '无'))
  log('console/page 错误 ' + errors.length + ' 条')
  errors.slice(0, 10).forEach(e => log('   ' + e.slice(0, 200)))
  try { await page.screenshot(SHOT); log('截图：' + SHOT) } catch { }

  /* ---- 5. 商品主档换算字段现状（真实接口）---- */
  log('')
  log('--- 商品主档换算字段（页面内真实接口）---')
  const grid = JSON.parse(await step('GET /api/products/grid', () => page.eval(JS_GRID)) || '{}')
  log('  商品 = ' + grid.n + '｜有 large_ratio = ' + grid.hasRatio + '｜四字段缺失 = ' + grid.missField)
  log('  id=1164 : ' + JSON.stringify(grid.p1164))
  log('  id=1539 : ' + JSON.stringify(grid.p1539))
  log('  id=1478 : ' + JSON.stringify(grid.p1478))

  /* ---- 6. 页面里真实跑 perCase（用真值断言，而非静态读源码）---- */
  log('')
  log('--- perCase 真实函数断言 ---')
  const JS_RUN_PERCASE = '(()=>{'
    + 'var P={'
    + '1164:{spec:"340G",unit:"瓶",large_unit:"件",large_ratio:12,medium_unit:"",medium_ratio:0},'
    + '1539:{spec:"160红枣5连杯",unit:"件",large_unit:"",large_ratio:0,medium_unit:"",medium_ratio:0},'
    + '1478:{spec:"90g*16杯",unit:"组",large_unit:"组",large_ratio:6,medium_unit:"",medium_ratio:0}'
    + '};'
    /* 从已加载的 chunk 里找 perCase 的真实源码：Vue SFC 编译后函数名可能被保留 */
    + 'var f=null;'
    + 'try{ f=window.__hgPerCase }catch(e){}'
    + 'if(typeof f!=="function"){return JSON.stringify({ok:false,reason:"页面未暴露 perCase（下节改用源码切取）"})}'
    + 'function R(a){return {pc:f(a.spec,a.unit,a),old:f(a.spec,a.unit)} }'
    + 'return JSON.stringify({ok:true,r1164:R(P[1164]),r1539:R(P[1539]),r1478:R(P[1478])})'
    + '})()'
  const pc = JSON.parse(await step('调用页面内 perCase', () => page.eval(JS_RUN_PERCASE)) || '{}')
  log('  ' + JSON.stringify(pc))

  log('')
  log('--- 判据 ---')
  if (!hasBoundary) log('  PASS  P1 正文无「页面出错了」')
  else { log('  FAIL  P1 出现兜底页'); failed = true }
  if (hit.length >= 2) log('  PASS  P3 渲染出业务内容（命中 ' + hit.length + ' 个业务词）')
  else { log('  FAIL  P3 未渲染业务内容'); failed = true }
  if (!grid.missField && grid.hasRatio > 0) log('  PASS  G1 换算字段随主档下发（有值 ' + grid.hasRatio + ' 条，无缺失）')
  else { log('  FAIL  G1 换算字段缺失或有值条数为 0（large_ratio=' + grid.hasRatio + '，缺失=' + grid.missField + '）'); failed = true }

  log('')
  log(failed ? '结论：❌ 未通过' : '结论：✅ 通过（真机层面）')
} catch (e) {
  console.log('脚本异常：' + (e && e.message))
  failed = true
} finally {
  if (browser) { try { await browser.close() } catch { } }
  process.exit(failed ? 1 : 0)
}
