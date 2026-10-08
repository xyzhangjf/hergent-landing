/**
 * v293-sprint-discriminating-e2e.mjs —— 返利冲刺看板「有判别力」的真机只读验收
 *
 * 为什么要另写一个（v292 那个探针的实测缺陷）：
 *   v292 探针把**接口返回的首个期次**当成「页面正在看的期次」来算期望值，但页面选中的是
 *   `curPeriod`（期次下拉）指定的那一期 —— 两者可能不是同一期。实测就撞上了：
 *   接口首个 = id 19（到货月 2026-10），页面选中 = 「2026-09-23 报单期次」（到货月 2026-09）。
 *   更糟的是**生产两条返利规则的停用日恰好也是 2026-09-30** ⇒ 该场景下
 *   旧口径（取 effective_end 的最大值）与正确口径（取到货月月末）**算出同一个日期**
 *   ⇒ 那一次真机验收对 P0-1 **完全没有判别力**，却被误读成 FAIL/OK。
 *
 * 本探针的做法：
 *   ① 主动把期次下拉（`select.sel-period`）切到**到货月 ≠ 规则停用日月**的那一期；
 *   ② **先自证判别力**：若目标期次的月末恰好等于规则停用日，直接失败退出（不硬凑 PASS）；
 *   ③ 再断言截止日 == 到货月月末，且 **≠ 旧口径的错值**。
 *
 * 🔴 全程只读：只种 token 到 localStorage、切一次期次下拉（纯前端状态，等价于点开某一期看看）。
 *    不点保存 / 新建 / 删除，不改任何服务端数据。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v293-主管权限与看板取证-2026-09-27'
/** 旧口径的错值来源：生产全部活跃规则里最大的 `effective_end`（修前 rebateCampaignEnd 取的就是它） */
const OLD_STALE_END = process.env.HG_OLD_END || '2026-09-30'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)

let pass = 0, fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; log('  [OK] ' + name + (extra ? '  -> ' + extra : '')) }
  else { fail++; log('  [NG] ' + name + (extra ? '  -> ' + extra : '')) }
  return !!cond
}
const pad2 = (n) => (n < 10 ? '0' + n : String(n))
const monthEnd = (ym) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''))
  if (!m) return ''
  return ym + '-' + pad2(new Date(Number(m[1]), Number(m[2]), 0).getDate())
}

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json()).then(d=>{if(!d.token)return "NO:"+JSON.stringify(d).slice(0,150);'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));return "OK"})'

const JS_API = (url) => 'fetch(' + JSON.stringify(url) + ',{headers:{'
  + '"Authorization":"Bearer "+localStorage.getItem("hergent_v2_token"),'
  + '"X-CSRF-Token":(localStorage.getItem("hergent_v2_csrf")||"")}})'
  + '.then(function(r){return r.text().then(function(t){return JSON.stringify({s:r.status,t:t.slice(0,4000)})})})'

/** 切期次：直接驱动期次下拉（Vue 的 v-model 监听 change），等价于用户在下拉里选一期。 */
const JS_SWITCH = (pid) => '(function(){'
  + 'var s=document.querySelector("select.sel-period");'
  + 'if(!s)return "no-select";'
  + 'var opts=Array.prototype.slice.call(s.options);'
  + 'var hit=opts.filter(function(o){return String(o.value)==="' + pid + '"});'
  + 'if(!hit.length)return "no-option|avail="+opts.map(function(o){return o.value+"="+o.text}).join(" ; ");'
  + 's.value=String("' + pid + '");'
  + 's.dispatchEvent(new Event("change",{bubbles:true}));'
  + 'return "switched:"+s.value+"="+hit[0].text})()'

/** 读面板：用文本锚点，不依赖具体 DOM 结构 */
const JS_PANEL = '(()=>{'
  + 'var app=document.querySelector("#app")||document.body;'
  + 'var txt=(app.innerText||"");'
  + 'var m=txt.match(/返利周期截止\\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);'
  + 'var m2=txt.match(/剩\\s*([0-9]+)\\s*次到货/);'
  + 'var mc=txt.match(/每\\s*([0-9]+)\\s*天/);'
  + 'var mp=txt.match(/本期\\s*·\\s*([^\\n]{0,40})/);'
  + 'var sum=document.querySelector(".sprint-sum");'
  + 'var ban=document.querySelector(".sprint-banner");'
  + 'return JSON.stringify({url:location.href,'
  + 'periodName:mp?mp[1].trim():null,'
  + 'campaignEnd:m?m[1]:null,headOrders:m2?Number(m2[1]):null,cadence:mc?Number(mc[1]):null,'
  + 'sum:sum?(sum.innerText||"").trim().replace(/\\s+/g," "):null,'
  + 'banner:ban?(ban.innerText||"").trim().replace(/\\s+/g," "):null,'
  + 'hasManual:txt.indexOf("手动配置")>=0,'
  + 'hasSprint:txt.indexOf("返利冲刺看板")>=0,'
  + 'hasPermTip:txt.indexOf("没有查看返利规则的权限")>=0,'
  + 'bodyLen:txt.length})' + '})()'

let browser, failed = false
try {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()

  log('=== 0. 登录 ===')
  await page.goto(BASE, 3500)
  const li = await page.eval(JS_LOGIN(USER, PASS))
  ok(li === 'OK', '登录 ' + USER + '（supervisor）', li)

  log('')
  log('=== 1. 取期次清单，挑一个「到货月 ≠ 规则停用日月」的期次 ===')
  await page.goto(BASE + '/#/forecast', 6500)
  const rPer = JSON.parse((await page.eval(JS_API('/api/forecast/periods'))) || '{}')
  let list = []
  try {
    const arr = JSON.parse(rPer.t)
    list = Array.isArray(arr) ? arr : (arr.items || arr.data || arr.periods || [])
  } catch (e) { log('  期次解析失败：' + e.message) }
  ok(rPer.s === 200 && list.length > 0, 'GET /api/forecast/periods = 200 且非空', 'status=' + rPer.s + ' 条数=' + list.length)

  const monthOf = (p) => {
    const base = String((p && (p.arrival_date || p.order_start || p.name)) || '')
    const m = base.slice(0, 7)
    return /^\d{4}-\d{2}$/.test(m) ? m : ''
  }
  list.forEach(p => log('    期次 ' + (p.id || p.period_id) + '  ' + String(p.name).slice(0, 24)
    + '  到货月=' + (monthOf(p) || '?') + '  月末=' + (monthEnd(monthOf(p)) || '?')))

  // 判别力：优先选月末 ≠ 旧错值的期次
  const staleMonth = String(OLD_STALE_END).slice(0, 7)
  const target = list.find(p => monthOf(p) && monthOf(p) !== staleMonth)
    || list.find(p => monthOf(p))
  const tMonth = target ? monthOf(target) : ''
  const tEnd = monthEnd(tMonth)
  const tId = target && (target.id || target.period_id)

  log('  目标期次 = ' + tId + '（到货月 ' + tMonth + '，月末 ' + tEnd + '）')
  const discriminating = !!tEnd && tEnd !== OLD_STALE_END
  log('  判别力自证：月末(' + tEnd + ') ≠ 旧口径错值(' + OLD_STALE_END + ') => ' + discriminating)
  if (!ok(discriminating, '本场景**能区分**新旧口径（前提条件，不满足则整轮无意义）',
    '月末=' + tEnd + ' vs 旧值=' + OLD_STALE_END)) {
    log('  ⇒ 场景无判别力，直接结束（不硬凑 PASS）。')
    throw new Error('no discriminating power: month end ' + tEnd + ' equals stale end ' + OLD_STALE_END)
  }

  log('')
  log('=== 2. 切到期次 ' + tId + '，并展开看板 ===')
  const sw = await page.eval(JS_SWITCH(tId))
  ok(String(sw).indexOf('switched:') === 0, '期次下拉已切到 ' + tId, sw)
  await sleep(4000)   // 等 cross / 返利规则 / 达成三路请求回来

  const pg0 = JSON.parse((await page.eval(JS_PANEL)) || '{}')
  ok(pg0.hasSprint, '页面出现「返利冲刺看板」', 'bodyLen=' + pg0.bodyLen)
  ok(!pg0.hasPermTip, '未出现「没有查看返利规则的权限」提示（v293 授权已生效）', 'hasPermTip=' + pg0.hasPermTip)
  // 无条件点展开 —— 页面上有多个 table.tbl，别拿「行数为 0」当前提（v292 踩过）
  const clk = await page.eval('(function(){var b=document.querySelector(".imp-x");'
    + 'if(!b)return "no-btn";b.click();return "clicked"})()')
  log('  点展开 .imp-x -> ' + clk)
  await sleep(1800)

  log('')
  log('=== 3. 核心断言：截止日 == 到货月(' + tMonth + ') 的月末 ' + tEnd + ' ===')
  const pg = JSON.parse((await page.eval(JS_PANEL)) || '{}')
  log('  URL = ' + pg.url)
  log('  面板期次 = ' + pg.periodName)
  log('  截止日 = ' + pg.campaignEnd + '｜表头剩次 = ' + pg.headOrders + '｜周期 = ' + pg.cadence + ' 天')
  log('  banner = ' + String(pg.banner).slice(0, 160))
  log('  sum    = ' + String(pg.sum).slice(0, 220))
  ok(!!pg.campaignEnd, '面板读到了「返利周期截止」日期', String(pg.campaignEnd))
  ok(pg.campaignEnd === tEnd,
    '截止日 == 到货月月末 ' + tEnd + '（新口径）', '实际 ' + pg.campaignEnd)
  ok(pg.campaignEnd !== OLD_STALE_END,
    '截止日 **不是** 旧口径错值 ' + OLD_STALE_END, '实际 ' + pg.campaignEnd)
  ok(String(pg.sum || '').indexOf('当月最后一天') >= 0, '摘要里点明「即当月最后一天」')

  log('')
  log('=== 4. 剩余次数与独立复算一致 ===')
  if (pg.campaignEnd) {
    const cad = pg.cadence || 2
    const endD = new Date(pg.campaignEnd + 'T23:59:59')
    const daysLeft = Math.ceil((endD - new Date()) / 86400000)
    const expect = daysLeft <= 0 ? 0 : Math.max(1, Math.ceil(daysLeft / cad))
    log('  独立复算：截止 ' + pg.campaignEnd + '  daysLeft=' + daysLeft + '  cadence=' + cad + '  => ' + expect + ' 次')
    ok(pg.headOrders === expect, '表头「剩 N 次到货」== 独立复算（' + expect + '）', '实际 ' + pg.headOrders)
  }
  ok(pg.hasManual, 'P1：明细出现「手动配置」（确实消费了 arrival_count_override）', pg.hasManual)

  log('')
  log('=== 5. 控制台错误 ===')
  const errs = page.errors.slice()
  log('  错误 ' + errs.length + ' 条')
  errs.slice(0, 8).forEach(e => log('   ' + String(e).slice(0, 200)))
  ok(errs.length === 0, '无控制台错误', errs.length + ' 条')
  const body = await page.eval('document.body?document.body.innerText:""')
  ok(!/页面出错了/.test(body), '无兜底错误页')

  try {
    await page.screenshot(SHOT_DIR + '/sprint-panel-discriminating.png')
    log('  截图 -> ' + SHOT_DIR + '/sprint-panel-discriminating.png')
  } catch (e) { log('  截图失败：' + e.message) }

  log('')
  log('=== 结果 PASS=' + pass + ' FAIL=' + fail + ' ===')
} catch (e) {
  console.error('探针异常：' + (e && e.stack || e))
  failed = true
} finally {
  try { if (browser) await browser.close() } catch (e) { /* ignore */ }
}
process.exit(fail || failed ? 1 : 0)
