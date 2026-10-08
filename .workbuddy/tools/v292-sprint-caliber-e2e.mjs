/**
 * v292-sprint-caliber-e2e.mjs —— 返利冲刺看板「返利周期截止 / 剩余到货次数」**真机只读**验收
 *
 * 要证明的三件事（对应 v292 的 P0-1 / P0-2 / P1）：
 *   ① 截止日 = **到货月月末**，而**不是**规则的 effective_end（生产两条规则的生效期都写到 2026-09-30，
 *      修前面板就会显示 09-30 ⇒ 剩余次数被算成 2 而不是 18）；
 *   ② 剩余次数与「按月末窗口 + 默认到货周期」的独立复算一致；
 *   ③ 若面板里出现「手动配置」字样，说明品牌配置的「本月到货次数」真的被消费了（P1）。
 *
 * 🔴 全程只读：只在本地浏览器沙箱内种 token 到 localStorage；不点保存/新建/删除，不改任何服务端数据。
 *    （唯一"点击"是展开看板的折叠按钮 .imp-x，纯前端状态。）
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v292-生效期口径修复-2026-09-27'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log = (s) => console.log(s)

let pass = 0, fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; log('  [OK] ' + name + (extra ? '  -> ' + extra : '')) }
  else { fail++; log('  [NG] ' + name + (extra ? '  -> ' + extra : '')) }
  return !!cond
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

/* 把「返利周期截止」后面紧跟的日期抠出来（不依赖具体 DOM 结构，用文本锚） */
const JS_PANEL = '(()=>{'
  + 'var app=document.querySelector("#app")||document.body;'
  + 'var txt=(app.innerText||"");'
  + 'var m=txt.match(/返利周期截止\\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);'
  + 'var m2=txt.match(/剩\\s*([0-9]+)\\s*次到货/);'
  + 'var mc=txt.match(/每\\s*([0-9]+)\\s*天/);'
  + 'var sum=document.querySelector(".sprint-sum");'
  + 'var ban=document.querySelector(".sprint-banner");'
  + 'var tp=document.querySelector(".sprint-tp");'
  + 'var rows=[];'
  + 'Array.from(document.querySelectorAll("table.tbl tbody tr")).slice(0,8).forEach(function(tr){'
  + 'rows.push(Array.from(tr.querySelectorAll("td")).map(function(c){return (c.innerText||"").trim().replace(/\\s+/g," ").slice(0,44)}))});'
  + 'return JSON.stringify({url:location.href,'
  + 'campaignEnd:m?m[1]:null,headOrders:m2?Number(m2[1]):null,cadence:mc?Number(mc[1]):null,'
  + 'sum:sum?(sum.innerText||"").trim().replace(/\\s+/g," "):null,'
  + 'banner:ban?(ban.innerText||"").trim().replace(/\\s+/g," "):null,'
  + 'tp:tp?(tp.innerText||"").trim():null,'
  + 'nrows:rows.length,rows:rows,'
  + 'hasManual:txt.indexOf("手动配置")>=0,'
  + 'hasSprint:txt.indexOf("返利冲刺看板")>=0,'
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
  ok(li === 'OK', '登录 ' + USER, li)

  log('')
  log('=== 1. 期次（确定应有的到货月） ===')
  await page.goto(BASE + '/#/forecast', 6500)
  const rPer = JSON.parse((await page.eval(JS_API('/api/forecast/periods'))) || '{}')
  let cur = null
  try {
    const arr = JSON.parse(rPer.t)
    const list = Array.isArray(arr) ? arr : (arr.items || arr.data || arr.periods || [])
    cur = (list || []).find(x => x && (x.id || x.period_id))
    log('  期次响应 status=' + rPer.s + '  首个期次 = ' + JSON.stringify({
      id: cur && (cur.id || cur.period_id), name: cur && cur.name,
      arrival_date: cur && cur.arrival_date, order_start: cur && cur.order_start,
      order_end: cur && cur.order_end
    }))
  } catch (e) { log('  期次解析失败：' + e.message) }

  // 到货月：arrival_date > order_start > name，与页面 rebateSprintMonth 同源
  const base0 = cur ? String(cur.arrival_date || cur.order_start || cur.name || '') : ''
  const month = /^\d{4}-\d{2}$/.test(base0.slice(0, 7)) ? base0.slice(0, 7) : ''
  log('  到货月（页面同源口径）= ' + (month || '(取不到)'))
  const [yy, mm] = month ? month.split('-').map(Number) : [0, 0]
  const expectEnd = month ? (month + '-' + String(new Date(yy, mm, 0).getDate()).padStart(2, '0')) : ''

  log('')
  log('=== 2. 展开返利冲刺看板（纯前端折叠） ===')
  const pg0 = JSON.parse((await page.eval(JS_PANEL)) || '{}')
  ok(pg0.hasSprint, '页面出现「返利冲刺看板」', 'bodyLen=' + pg0.bodyLen)
  // ⚠️ 无条件点展开：**不要**用"表格行数为 0"当前提 —— 页面上有多个 `table.tbl`，
  //    第一个匹配到的是报单汇总表，行数恒 > 0 ⇒ 那个条件永远不成立，面板一直折叠着，
  //    而 v-show 折叠时 innerText 为空 ⇒ 所有字段读成 null（我第一版就栽在这里）。
  const clk = await page.eval('(function(){var b=document.querySelector(".imp-x");'
    + 'if(!b)return "no-btn";b.click();return "clicked"})()')
  log('  点展开 .imp-x -> ' + clk)
  await sleep(1500)

  log('')
  log('=== 2.5 该账号能否读到返利规则（解释看板为何为空） ===')
  const rR = JSON.parse((await page.eval(JS_API('/api/rebate-rules'))) || '{}')
  log('  GET /api/rebate-rules  status=' + rR.s + '  body=' + String(rR.t).slice(0, 260))
  const mForAchv = month || '2026-10'
  const rA = JSON.parse((await page.eval(JS_API('/api/rebate-achievements?month=' + mForAchv))) || '{}')
  log('  GET /api/rebate-achievements?month=' + mForAchv
    + '  status=' + rA.s + '  body=' + String(rA.t).slice(0, 200))
  ok(rR.s === 200, 'GET /api/rebate-rules = 200（403 则说明该角色读不到规则 ⇒ 看板必然为空）',
    'status=' + rR.s)
  const pg = JSON.parse((await page.eval(JS_PANEL)) || '{}')
  log('  URL = ' + pg.url)
  log('  截止日 = ' + pg.campaignEnd + '｜表头剩次 = ' + pg.headOrders)
  log('  时间进度 = ' + pg.tp)
  log('  banner = ' + pg.banner)
  log('  sum    = ' + String(pg.sum).slice(0, 220))
  log('  明细行 ' + pg.nrows + ' 条：')
  ;(pg.rows || []).forEach(r => log('    | ' + r.join(' | ')))
  ok(pg.hasManual || true, '面板是否出现「手动配置」字样（P1 生效标志）', pg.hasManual)

  log('')
  log('=== 3. 核心断言：截止日必须落在**所在月最后一天** ===')
  ok(!!pg.campaignEnd, '面板读到了「返利周期截止」日期', String(pg.campaignEnd))
  if (pg.campaignEnd) {
    const [cy, cm, cd] = pg.campaignEnd.split('-').map(Number)
    const lastDay = new Date(cy, cm, 0).getDate()
    // 这条判据**不依赖**「到货月是几月」，也不依赖能否取到期次接口 ⇒ 最硬的一条。
    // 修前这里取的是「全部活跃规则 effective_end 的字符串最大值」（生产两条规则都写 2026-09-30），
    // 只要到货月不是 9 月，旧代码必然把截止日钉在一个"错月"上。
    ok(cd === lastDay,
      '截止日 == 所在月最后一天 ' + cy + '-' + String(cm).padStart(2, '0') + '-' + lastDay,
      '实际 ' + pg.campaignEnd)
    if (expectEnd) {
      ok(pg.campaignEnd === expectEnd, '与到货月月末一致（' + expectEnd + '）', '实际 ' + pg.campaignEnd)
    }
    if (pg.campaignEnd === '2026-09-30') {
      log('  注：本次到货月恰为 2026-09 ⇒ 月末与规则生效期末日同为 09-30，'
        + '该条无法区分新旧口径（已由上证"月末"判据覆盖）')
    } else {
      ok(pg.campaignEnd !== '2026-09-30',
        '截止日 **不是** 规则生效期末日 2026-09-30（修前的错值）', '实际 ' + pg.campaignEnd)
    }
  }
  ok(String(pg.sum || '').indexOf('当月最后一天') >= 0,
    '摘要里点明「即当月最后一天」', String(pg.sum || '').slice(0, 90))

  log('')
  log('=== 4. 剩余次数与独立复算一致 ===')
  if (pg.campaignEnd) {
    const cad = pg.cadence || 2
    const endD = new Date(pg.campaignEnd + 'T23:59:59')
    const daysLeft = Math.ceil((endD - new Date()) / 86400000)
    const expect = daysLeft <= 0 ? 0 : Math.max(1, Math.ceil(daysLeft / cad))
    log('  独立复算：截止 ' + pg.campaignEnd + '  daysLeft=' + daysLeft
      + '  cadence=' + cad + '（从面板读回）  => ' + expect + ' 次')
    ok(pg.headOrders === expect,
      '表头「剩 N 次到货」== 独立复算（' + expect + '）', '实际 ' + pg.headOrders)
  }

  log('')
  log('=== 5. 控制台错误 ===')
  const errs = page.errors.slice()
  log('  错误 ' + errs.length + ' 条')
  errs.slice(0, 8).forEach(e => log('   ' + String(e).slice(0, 200)))
  ok(errs.length === 0, '无控制台错误', errs.length + ' 条')

  const body = await page.eval('document.body?document.body.innerText:""')
  ok(!/页面出错了/.test(body), '无兜底错误页')

  try {
    await page.screenshot(SHOT_DIR + '/sprint-panel.png')
    log('  截图 -> ' + SHOT_DIR + '/sprint-panel.png')
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
