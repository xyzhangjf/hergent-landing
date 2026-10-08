/**
 * v324 商品目标「到货月锚点」上线 · 生产只读验收探针
 * ==================================================
 * 本轮病根（用户 2026-09-29 报障）：月底提前报单时，「商品目标月份」被按**报单月**读，
 * 于是 10 月到货的单仍在看 9 月的目标桶 —— **零报错、数字看着合理**，只有老板肉眼发现。
 * 修法：目标月锚点 = **到货日所在月份**；分母 = 「报单窗口还没关」的到货日个数。
 *
 * 🎯 判据（每条都配**反例**，证明断言不是空转）：
 *   ① 口径条已换成到货月口径（新串 `报单窗口还没关` 在、旧串 `今天及以后` 已下线）
 *   ② 锚点提示里的日期 == **接口给的期次 `arrival_date`**（证明不是前端推算）
 *   ③ 页面默认月份 == 后端 `target_month`，且 `target_month ≠ report_month`（两个口径真分离）
 *   ④ 把月份手动改回 2026-09 ⇒ 提示**翻成警示态**（证明提示是活的、不是写死的）
 *   ⑤ 分母端到端：`剩余可报` 出现 `15 / 16`（新）且**没有** `16 / 16`（旧写法会给出的值）
 *   ⑥ 每一行的「均单」与其**本行分母**自洽：(目标−已达成) ÷ 分母
 *   ⑦ 新建弹窗默认月 = 到货月 + 「目标建到 10 月」的说明
 *   ⑧ 全程 0 非 GET 请求、0 控制台报错
 *
 * 🔴 只读纪律：装「非 GET 哨兵」；只切月份、开弹窗、**绝不点保存**、绝不产生写请求。
 */
import fs from 'node:fs'
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.PROBE_TOKEN || ''
const OUT = process.env.PROBE_OUT
  || '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/outputs/v324-target-month-anchor'
if (!TOKEN) { console.error('缺少 PROBE_TOKEN'); process.exit(2) }
fs.mkdirSync(OUT, { recursive: true })

let pass = 0, fail = 0
const fails = []
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '   → ' + detail : '')) }
  else { fail++; fails.push(name); console.log('  ❌ ' + name + (detail ? '   → ' + detail : '')) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/* ═══════════ 页面内：口径条 / 锚点 / 月份 / 弹窗 快照 ═══════════ */
const JS_HEAD = `(function(){
  function vis(el){ if(!el) return false;
    var cs=getComputedStyle(el), r=el.getBoundingClientRect();
    return cs.display!=='none' && cs.visibility!=='hidden' && r.width>0 && r.height>0 }
  function txt(el){ return el ? (el.textContent||'').replace(/\\s+/g,' ').trim() : null }
  var cal=document.querySelector('.pt-caliber');
  var an=document.querySelector('.pt-anchor');
  var mon=document.querySelector('.pt-tbar .pt-fld-m');
  var per=document.querySelector('.pt-tbar .pt-fld-p');
  var modal=document.querySelector('.pt-modal');
  var mmon=modal? modal.querySelector('.pt-fld-m') : null;
  var tip=document.querySelector('.pt-md-tip');
  var body=(document.body.innerText||'');
  return JSON.stringify({
    caliber: txt(cal),
    anchorVisible: vis(an),
    anchorText: txt(an),
    anchorWarn: an? an.classList.contains('pt-anchor-warn') : null,
    month: mon? mon.value : null,
    periodVal: per? per.value : null,
    periodText: per? (per.options[per.selectedIndex]? per.options[per.selectedIndex].textContent : '').trim() : null,
    modalOpen: !!modal,
    modalMonth: mmon? mmon.value : null,
    tipVisible: vis(tip),
    tipText: txt(tip),
    bodyHasOldCaliber: body.indexOf('今天及以后') >= 0,
    bodyHasWarnPhrase: body.indexOf('当前看的是') >= 0,
    bodyHasMilk: body.indexOf('现代牧场') >= 0,
    bodyLen: body.length,
    emptyState: txt(document.querySelector('.state-empty')),
    rowCount: document.querySelectorAll('.pt-tbl tbody tr:not(.pt-detail-row)').length
  })
})()`

/* ═══════════ 页面内：目标表逐行取值（列序照抄 thead） ═══════════
   列序：商品 / 品牌 / 目标(箱) / 已达成(箱) / 差额(箱) / 本期报单(箱) / 剩余可报 / 均单(箱) / 分解 / 操作 */
const JS_TABLE = `(function(){
  var trs=[].slice.call(document.querySelectorAll('.pt-tbl tbody tr'))
    .filter(function(tr){ return !tr.classList.contains('pt-detail-row') });
  return JSON.stringify(trs.map(function(tr){
    var td=[].slice.call(tr.children);
    function g(i){ return td[i] ? (td[i].textContent||'').replace(/\\s+/g,' ').trim() : '' }
    return { prod:g(0).slice(0,60), brand:g(1), target:g(2), achieved:g(3),
             gap:g(4), reported:g(5), rem:g(6), avg:g(7), alloc:g(8) }
  }))
})()`

/* ═══════════ 页面内：只读回读接口事实（证明前端没自己推算） ═══════════ */
const JS_API_FACTS = `(async function(){
  var t=localStorage.getItem('hergent_v2_token')||'';
  var h={'Authorization':'Bearer '+t,'X-Tenant-Id':'1','X-Client':'web'};
  var a=await (await fetch('/api/forecast/periods',{headers:h})).json();
  var open=a.open||a.current||null;
  var pid=open? open.id : null;
  var inList=null;
  (a.periods||[]).forEach(function(x){ if(String(x.id)===String(pid)) inList=x.arrival_date||'' });
  var b=null;
  if(pid) b=await (await fetch('/api/product-targets/avg-target?period_id='+pid,{headers:h})).json();
  return JSON.stringify({
    openId: pid,
    openName: open? (open.name||'') : '',
    openArrival: open? (open.arrival_date||'') : '',
    listArrival: inList,
    targetMonth: b? b.target_month : null,
    reportMonth: b? b.report_month : null,
    anchorBy: (b&&b.target_month_anchor)? b.target_month_anchor.by : null,
    anchorArrival: (b&&b.target_month_anchor)? b.target_month_anchor.arrival_date : null,
    arrivals: b? b.arrivals : null
  })
})()`

/* ═══════════ 页面内：改月份（走真实 v-model + @change） ═══════════ */
async function setMonth(page, ym) {
  return page.eval(`(function(){
    var el=document.querySelector('.pt-tbar .pt-fld-m'); if(!el) return 'no-input';
    var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(el, ${JSON.stringify(ym)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return el.value
  })()`)
}

/* fmtMd 的等价实现（前端 '2026-10-03' → '10-03'） */
const fmtMd = (iso) => {
  const s = String(iso || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(5) : (s || '')
}
const numOf = (s) => {
  const n = Number(String(s == null ? '' : s).replace(/[^\d.\-]/g, ''))
  return isFinite(n) ? n : null
}

const browser = await launch({ headless: true })
const page = await browser.newPage()
await page.enable()

/* ---- 🔴 零写入哨兵 ---- */
const writes = []
try {
  await page.raw.send('Network.enable')
  page.raw.onEvent((msg) => {
    if (msg.method === 'Network.requestWillBeSent') {
      const r = msg.params.request || {}
      const m = String(r.method || '').toUpperCase()
      if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') writes.push(m + ' ' + String(r.url).slice(0, 130))
    }
  })
} catch (e) { console.log('  (Network.enable 失败：' + e.message + ')') }

await page.addInitScript(
  "(function(){try{"
  + "localStorage.setItem('hergent_v2_token','" + TOKEN + "');"
  + "localStorage.setItem('hergent_v2_tenant','1');"
  + "localStorage.setItem('hergent_v2_user',JSON.stringify({id:1,username:'boss',display_name:'老板',role:'boss'}));"
  + "}catch(e){}})()"
)

try {
  /* ════════════════ 相位 0 ════════════════ */
  console.log('\n【相位 0】深链进「商品目标」页签')
  await page.goto(BASE + '/#/forecast?tab=target', 7000)
  let H = JSON.parse(await page.eval(JS_HEAD))
  ok(!!H.caliber, '落到「商品目标」页签（口径条存在）', 'hash=' + await page.eval('location.hash'))
  ok(page.errors.length === 0, '进页面全程控制台零报错', page.errors.slice(0, 3).join(' / ') || '无')

  /* ════════════════ 相位 1：口径条换口径 ════════════════ */
  console.log('\n【相位 1】口径条：目标月 = 到货月（新串在 / 旧串下线）')
  const cal = String(H.caliber || '')
  ok(cal.includes('到货日所在月份'), '新口径「月目标 = 到货日所在月份的目标」已上线', cal.slice(0, 130))
  ok(cal.includes('报单月 ≠ 到货月'), '明说了「报单月 ≠ 到货月」', '')
  ok(cal.includes('报单窗口还没关'), '剩余期次口径改为「报单窗口还没关」', '')
  ok(H.bodyHasOldCaliber === false,
    '★反例：旧口径串「今天及以后」**已下线**（证明上一条不是两边都有）',
    'bodyHasOldCaliber=' + H.bodyHasOldCaliber)

  /* ════════════════ 相位 2：锚点提示 = 接口事实 ════════════════ */
  console.log('\n【相位 2】锚点提示：内容必须等于接口给的期次到货日（不是前端推算）')
  const F = JSON.parse(await page.eval(JS_API_FACTS))
  console.log('      ↳ 接口事实：openId=' + F.openId + ' 名称=' + F.openName
    + ' arrival_date=' + F.openArrival + ' target_month=' + F.targetMonth + ' report_month=' + F.reportMonth)
  ok(!!F.openId, '拿到「进行中」期次', 'openId=' + F.openId + ' / ' + F.openName)
  ok(F.targetMonth && F.reportMonth && F.targetMonth !== F.reportMonth,
    '后端两个月份口径**真分离**（target_month ≠ report_month）',
    'target_month=' + F.targetMonth + ' vs report_month=' + F.reportMonth)
  ok(F.anchorBy === 'arrival_date', '后端自报锚点依据 = arrival_date', 'by=' + F.anchorBy)

  const md = fmtMd(F.openArrival)
  ok(H.anchorVisible === true, '工具栏出现锚点提示 `.pt-anchor`', 'text=' + H.anchorText)
  ok(String(H.anchorText || '').includes(md),
    '★锚点提示里的日期 == 接口的 `arrival_date`（' + F.openArrival + '）',
    '提示=' + H.anchorText + ' / 接口=' + md)
  ok(String(H.anchorText || '').includes('按到货月'),
    '一致态文案 = 「按到货月 · 本期到货 ' + md + '」', H.anchorText)
  ok(H.anchorWarn === false && H.bodyHasWarnPhrase === false,
    '一致态下**没有**警示色与警示短语（说明提示是条件渲染，不是常驻）',
    'warn=' + H.anchorWarn + ' phrase=' + H.bodyHasWarnPhrase)
  ok(H.month === F.targetMonth,
    '★页面默认月份 == 后端 `target_month`（自动对齐到到货月，未手动触碰）',
    'month=' + H.month + ' / target_month=' + F.targetMonth)
  ok(H.month === '2026-10' && H.month !== F.reportMonth,
    '默认月份是 **2026-10**（次月），不是报单月 ' + F.reportMonth,
    'month=' + H.month)
  ok(String(H.periodVal) === String(F.openId),
    '均单期次默认选中「进行中」那一期（与接口 open 同源）',
    'periodVal=' + H.periodVal + ' / ' + H.periodText)
  await page.screenshot(OUT + '/01-anchor-ok.png')

  /* ════════════════ 相位 3：分母端到端 ════════════════ */
  console.log('\n【相位 3】分母端到端：剩余可报 = 「报单窗口还没关」的期次数')
  const rows10 = JSON.parse(await page.eval(JS_TABLE))
  console.log('      ↳ 2026-10 桶共 ' + rows10.length + ' 行：')
  rows10.forEach(r => console.log('         ' + r.prod + ' | 品牌 ' + r.brand + ' | 目标 ' + r.target
    + ' | 已达成 ' + r.achieved + ' | 剩余可报 ' + r.rem + ' | 均单 ' + r.avg))
  ok(rows10.length > 0, '2026-10 桶里有目标行（不是空表）', rows10.length + ' 行')
  const rems = rows10.map(r => r.rem)
  ok(rems.includes('15 / 16'),
    '★出现新分母 `15 / 16`（报单窗口还没关的 15 期，总 16 期）', 'rems=' + JSON.stringify(rems))
  ok(!rems.includes('16 / 16'),
    '★反例：**没有** `16 / 16` —— 旧写法（到货日 ≥ 今天）会给出的值，新实现不再产出',
    'rems=' + JSON.stringify(rems))

  /* ⑥ 每行「均单」与其本行分母自洽 */
  const mismatch = []
  rows10.forEach(r => {
    const m = /^(\d+)\s*\/\s*(\d+)$/.exec(r.rem || '')
    const avg = numOf(r.avg)
    const tgt = numOf(r.target)
    const ach = numOf(r.achieved)
    if (!m || avg == null || tgt == null || ach == null) return
    const N = Number(m[1])
    const want = (tgt - ach) / N
    if (Math.abs(avg - want) > 0.002) mismatch.push(r.prod + ': 显示 ' + avg + ' vs (目标−已达成)/分母 = ' + want)
  })
  ok(mismatch.length === 0,
    '★每行「均单」与**本行分母**自洽 ⇒ 页面显示的均单确实用了显示的那个分母',
    mismatch.length ? mismatch.join(' | ') : '全部自洽')
  ok(rows10.some(r => numOf(r.avg) != null),
    '反例自证：至少一行的均单是**真数字**（否则上一条因 rows 全为 — 而空转）',
    rows10.map(r => r.avg).join(' , '))

  /* ════════════════ 相位 4：翻转 —— 手动改回报单月，提示必须变警示态 ════════════════ */
  console.log('\n【相位 4】判别力翻转：手动把月份改回 ' + F.reportMonth + ' ⇒ 提示必须翻成警示态')
  const set9 = await setMonth(page, F.reportMonth)
  ok(set9 === F.reportMonth, '月份已改写为 ' + F.reportMonth, 'value=' + set9)
  await sleep(2600)
  const H9 = JSON.parse(await page.eval(JS_HEAD))
  ok(H9.anchorVisible === true && H9.anchorWarn === true,
    '★提示转为**警示态**（`.pt-anchor-warn`）—— 证明提示随月份活变，不是写死一句话',
    'warn=' + H9.anchorWarn + ' text=' + H9.anchorText)
  ok(String(H9.anchorText || '').includes('当前看的是'),
    '警示态说清了「你现在看的不是本期目标月」', H9.anchorText)
  ok(String(H9.anchorText || '').includes(fmtMd(F.openArrival)),
    '警示态里仍带真实到货日 ' + md, H9.anchorText)
  const rows9 = JSON.parse(await page.eval(JS_TABLE))
  console.log('      ↳ ' + F.reportMonth + ' 桶共 ' + rows9.length + ' 行：')
  rows9.forEach(r => console.log('         ' + r.prod + ' | 目标 ' + r.target + ' | 剩余可报 ' + r.rem + ' | 均单 ' + r.avg))
  ok(H9.bodyHasMilk === true,
    '★' + F.reportMonth + ' 桶里仍有「现代牧场…」那条目标 ⇒ **A 方案「数据不动」已被现场证实**',
    'bodyHasMilk=' + H9.bodyHasMilk)
  await page.screenshot(OUT + '/02-anchor-warn.png')

  /* 改回 2026-10 */
  const set10 = await setMonth(page, F.targetMonth)
  await sleep(2600)
  const H10 = JSON.parse(await page.eval(JS_HEAD))
  ok(set10 === F.targetMonth && H10.month === F.targetMonth && H10.anchorWarn === false,
    '改回 ' + F.targetMonth + ' ⇒ 警示态消失（一次往返，证明是双向活变）',
    'month=' + H10.month + ' warn=' + H10.anchorWarn)

  /* ════════════════ 相位 5：新建弹窗默认月 = 到货月 ════════════════ */
  console.log('\n【相位 5】新建弹窗：默认月必须是到货月，且有一句说明')
  const nb = await page.eval(`(function(){
    var b=document.querySelector('.pt-tbar .btn-primary'); if(!b) return null;
    b.click(); return (b.textContent||'').trim()
  })()`)
  ok(nb === '新建目标', '点到「新建目标」', '文本=' + nb)
  await sleep(1800)
  const Hm = JSON.parse(await page.eval(JS_HEAD))
  ok(Hm.modalOpen === true, '弹窗已渲染', 'modalOpen=' + Hm.modalOpen)
  ok(Hm.modalMonth === F.targetMonth,
    '★弹窗里「目标月份」默认 = ' + F.targetMonth + '（= 到货月，不是报单月）',
    'modalMonth=' + Hm.modalMonth)
  ok(Hm.tipVisible === true, '弹窗里出现「目标建到哪个月」的说明 `.pt-md-tip`', 'tip=' + Hm.tipText)
  const tip = String(Hm.tipText || '')
  ok(tip.includes('本期到货 ' + md), '说明里点出了本期到货日', tip)
  ok(tip.includes('提前报单，报单月 ≠ 到货月'), '说明里给了依据（提前报单）', tip)
  await page.screenshot(OUT + '/03-modal-tip.png')
  /* 🔴 绝不点「保存」；只点「取消」 */
  const cx = await page.eval(`(function(){
    var m=document.querySelector('.pt-modal'); if(!m) return 'no-modal';
    var bs=[].slice.call(m.querySelectorAll('.pt-modal-ft button'));
    var b=bs.filter(function(x){return (x.textContent||'').trim()==='取消'})[0];
    if(!b) return 'no-cancel';
    b.click(); return 'clicked'
  })()`)
  ok(cx === 'clicked', '点「取消」关掉弹窗（**未点保存**）', cx)
  await sleep(700)
  const Hc = JSON.parse(await page.eval(JS_HEAD))
  ok(Hc.modalOpen === false, '弹窗已关闭', 'modalOpen=' + Hc.modalOpen)

  /* ════════════════ 相位 6：纪律 ════════════════ */
  console.log('\n【相位 6】控制台与写入纪律')
  ok(page.errors.length === 0, '全程控制台零报错', page.errors.slice(0, 3).join(' / ') || '无')
  ok(writes.length === 0, '零写入：全程无非 GET 请求（未点保存、未提交）',
    writes.slice(0, 3).join(' / ') || '无')
  await page.screenshot(OUT + '/04-final.png')
} finally {
  await browser.close()
}

console.log('\n──────────────────────────────────────')
console.log('PASS ' + pass + ' / FAIL ' + fail)
if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '))
console.log('截图目录：' + OUT)
process.exit(fail ? 1 : 0)
