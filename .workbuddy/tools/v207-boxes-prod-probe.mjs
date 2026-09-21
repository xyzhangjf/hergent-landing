/**
 * v207-boxes-prod-probe.mjs —— 生产真机验证「合计(箱) 显示不了」是否已修。
 *
 * 用户报障原文（2026-09-19）：
 *   「我刚提交了永辉东津店的报单，报单数量在 web 端"合计（小单位）"有显示，
 *     但在"合计（箱）"没有显示」
 *
 * 本探针**只读**：登录 → 进预报页 → 钉住期次 14 → 读出那三行的「合计(箱) / 最终下单(箱)」+
 * 表尾合计，并与**从生产库存取的真实明细**逐格比对。零写入（不点保存、不动任何单元格）。
 *
 * 盘面（生产 tenant_1.db / 期次 14 / 单据 491）：
 *   pid 1161  185ml×24瓶  单位=瓶  报 3  → 每箱 24  → 合计(箱) 0.125
 *   pid 1164  340G        单位=瓶  报 3  → 每箱 340 → 合计(箱) 0.009
 *   pid 1205  135g*24杯   单位=杯  报 3  → 每箱 24  → 合计(箱) 0.125
 *   修复前：三行 合计(箱) 全 = 0（Math.round 抹零）⇒ 表尾也是 0，与「合计(小单位)=9」并存。
 *   修复后：表尾 合计(箱) = 0.259，逐行 最终下单(箱) = 1（不足一箱按一箱）。
 *
 * 🔴 三条实测坑（照抄 forecast-boxes-v189-verify.js，别踩第四次）：
 *   ① 表尾是**另一张 table** —— 在 `div.col-total-bar` 里，不在 `.cross-viewport` 的主表内；
 *   ② 只读表**虚拟滚动**（≥80 行才启用）—— 期次 14 只有 20 余行，全量渲染，逐行求和成立；
 *   ③ 读格一律用 `textContent`（`innerText` 在 v-show 隐藏行上是空串）。
 *   v207 新增第 ④：列索引**不能写死** —— 从 thead 里按列名现取，列序会随列设置变。
 *
 * 用法：node .workbuddy/tools/v207-boxes-prod-probe.mjs
 *   HG_USER / HG_PASS / HG_PERIOD / HG_SHOT_DIR 可覆盖
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const PERIOD = process.env.HG_PERIOD || '14'
const SHOT_DIR = process.env.HG_SHOT_DIR || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/预报合计箱显示修复-2026-09-19'
const SHOT = SHOT_DIR + '/真机-合计箱-期次' + PERIOD + '.png'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const fails = []
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra !== undefined ? '  ' + extra : '')) }
  else { fail++; fails.push(label + (extra !== undefined ? '  ' + extra : '')); console.log('  ❌ ' + label + (extra !== undefined ? '  ' + extra : '')) }
}

/* 期望值：来自生产只读库的真实明细 + 源码口径（boxesOf / rowFinalQty） */
const WANT = {
  1161: { box: '0.125', sum: '3', spec: '185ml×24瓶' },
  1164: { box: '0.009', sum: '3', spec: '340G' },
  1205: { box: '0.125', sum: '3', spec: '135g*24杯' },
}

const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json().then(d=>({s:r.status,d:d})))'
  + '.then(r=>{var d=r.d;if(!d.token)return JSON.stringify({ok:false,status:r.s,detail:d.detail||d.message||""});'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return JSON.stringify({ok:true,status:r.s,user:(d.user&&d.user.username)||"",role:(d.user&&d.user.role)||"",tenant:d.tenant_id})})'

/** 列出期次下拉并钉住目标期次 */
const JS_SET_PERIOD = (pid) => '(()=>{var s=document.querySelector("select.sel-period");'
  + 'if(!s)return JSON.stringify({ok:false,why:"找不到期次下拉 select.sel-period"});'
  + 'var opts=Array.from(s.options).map(o=>({v:o.value,t:(o.textContent||"").trim()}));'
  + 'var hit=opts.filter(o=>String(o.v)===String(' + JSON.stringify(pid) + '))[0];'
  + 'if(!hit)return JSON.stringify({ok:false,why:"下拉里没有这个期次",opts:opts.slice(0,20)});'
  + 's.value=hit.v;s.dispatchEvent(new Event("change",{bubbles:true}));'
  + 'return JSON.stringify({ok:true,picked:hit,nOpts:opts.length})})()'

/**
 * 读只读汇总表：
 *   - 列索引从 thead 按列名现取（列序会随列设置变，写死必错）
 *   - 逐行按 `td[data-pid]` 定位（每个 td 都带 data-pid/data-cell）
 *   - 表尾单独取 `.col-total-bar table.cross-tbl tr.col-total`
 *
 * ⚠️ 用**模板字面量**写，不要在单引号字符串里拼 `\'"[data-cell=\\""+i+"\\"]\'` ——
 *    那种嵌套引号会让 `(` 少配平一个，报 `SyntaxError: missing ) after argument list`，
 *    而且报错发生在**页面里**、Node 侧看不到生成了什么串。见文件末尾的 `assertExpr()`。
 */
const JS_READ = `(()=>{
  function tx(el){ return el ? String(el.textContent || '').trim() : null }
  var body = document.querySelector('.cross-viewport table.cross-tbl')
  if (!body) return JSON.stringify({ ok: false, why: '找不到只读汇总表 .cross-viewport table.cross-tbl' })
  var heads = Array.from(body.querySelectorAll('thead th')).map(tx)
  var iBox = heads.indexOf('合计(箱)')
  var iSum = heads.indexOf('合计(小单位)')
  var iFin = -1, iExt = -1
  heads.forEach(function (h, i) { if (/最终下单/.test(h || '')) iFin = i; if (/^加单/.test(h || '')) iExt = i })
  var trs = Array.from(body.querySelectorAll('tbody tr.data-row'))
  var rows = []
  trs.forEach(function (tr) {
    var pidTd = tr.querySelector('td[data-pid]')
    if (!pidTd) return
    function cell(i) { if (i < 0) return null; var t = tr.querySelector('[data-cell="' + i + '"]'); return tx(t) }
    rows.push({ pid: pidTd.getAttribute('data-pid'), box: cell(iBox), sum: cell(iSum), fin: cell(iFin), extra: cell(iExt) })
  })
  var ft = document.querySelector('.col-total-bar table.cross-tbl tr.col-total')
  var ftds = ft ? Array.from(ft.querySelectorAll('td')).map(tx) : []
  return JSON.stringify({
    ok: true, nRows: rows.length, heads: heads,
    idx: { box: iBox, sum: iSum, fin: iFin, extra: iExt }, rows: rows,
    foot: { box: iBox >= 0 ? ftds[iBox] : null, sum: iSum >= 0 ? ftds[iSum] : null, fin: iFin >= 0 ? ftds[iFin] : null, extra: iExt >= 0 ? ftds[iExt] : null }
  })
})()`

/**
 * 勾上「仅显示有报单」。
 *
 * 🔴 为什么必须勾：只读表挂的是**本期全部在售商品**（期次 14 = 285 个），
 *    而 `VSCROLL_MIN = 80` ⇒ 表体**虚拟滚动**，DOM 里只有首屏那二十来行。
 *    不勾的话「永辉东津店那三行」根本不在 DOM 里 —— 探针会得到
 *    「行不存在 / Σ行 = 0」的假 FAIL，而页面其实完全正常（本轮实测踩到）。
 *    勾上 ⇒ 行数降到「有报单的行」⇒ 少于 80 ⇒ 虚拟滚动关闭 ⇒ 全量渲染、可逐行求和。
 * ⚠️ 两个 `.tb-toggle` 里都叫「仅显示有报单」（只读态一个、改单态一个）⇒ 必须取**可见**的那个。
 */
const JS_FILTER_ZERO = `(()=>{
  var labels = Array.from(document.querySelectorAll('label.tb-toggle'))
  var hit = null
  labels.forEach(function (l) { if (!hit && /仅显示有报单/.test(l.textContent || '') && l.offsetParent !== null) hit = l })
  if (!hit) return JSON.stringify({ ok: false, why: '找不到「仅显示有报单」开关（可能是 offsetParent 判可见失效）' })
  var cb = hit.querySelector('input[type=checkbox]')
  if (!cb) return JSON.stringify({ ok: false, why: '开关里没有 checkbox' })
  if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })) }
  return JSON.stringify({ ok: true, checked: cb.checked })
})()`

/* 🔴 启动前自检：所有要丢进页面的表达式先在 Node 侧过一遍语法。
   否则语法错会以「页面内异常」的形式出现 —— Node 侧只看到一句
   `missing ) after argument list`，看不到自己生成的串长什么样（本轮实测白跑一轮）。 */
function assertExpr(name, expr) {
  try { new Function('return ' + expr) } catch (e) {
    console.error('❌ 探针自检失败：' + name + ' 的表达式有语法错：' + e.message)
    console.error('   生成的表达式 = ' + expr)
    process.exit(2)
  }
}
assertExpr('JS_READ', JS_READ)
assertExpr('JS_LOGIN', JS_LOGIN(USER, PASS))
assertExpr('JS_SET_PERIOD', JS_SET_PERIOD(PERIOD))
assertExpr('JS_FILTER_ZERO', JS_FILTER_ZERO)

let browser
try {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  console.log('=== v207 真机验证：合计(箱) 是否显示（生产 hergent.cn，只读）===')

  browser = await launch()
  const page = await browser.newPage()
  await page.enable()

  /* ---- 1. 登录（走页面内 fetch，别点 UI —— 登录页有两个含「登录」的元素）---- */
  await page.goto(BASE, 3500)
  const li = JSON.parse(await page.eval(JS_LOGIN(USER, PASS)))
  console.log('登录：' + JSON.stringify(li))
  ok('S0 登录成功', li.ok, JSON.stringify(li))

  /* ---- 2. 进预报页 ---- */
  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', 4500)
  await sleep(3500)
  const url = await page.eval('location.href')
  console.log('落点 URL：' + url)
  ok('S0b 没被踢回登录页', !/#\/login/.test(url), url)
  const boundary = await page.eval('/页面出错了/.test(document.body?document.body.innerText:"")')
  ok('S1 正文不含 ErrorBoundary「页面出错了」', boundary === false)

  /* ---- 3. 钉住期次 14 ---- */
  const sp = JSON.parse(await page.eval(JS_SET_PERIOD(PERIOD)))
  console.log('期次下拉：' + JSON.stringify(sp).slice(0, 400))
  ok('S2 期次下拉存在且可选中期次 ' + PERIOD, sp.ok === true, sp.why || JSON.stringify(sp.picked))
  await sleep(3500)

  /* ---- 3.5 勾「仅显示有报单」（关掉虚拟滚动，让有数据的行进 DOM）---- */
  const fz = JSON.parse(await page.eval(JS_FILTER_ZERO))
  ok('S2b 勾上「仅显示有报单」', fz.ok === true, fz.why || JSON.stringify(fz))
  await sleep(2500)

  /* ---- 4. 读只读汇总表 ---- */
  const raw = await page.eval(JS_READ)
  const d = JSON.parse(raw)
  if (!d.ok) { ok('S3 读到只读汇总表', false, d.why); throw new Error(d.why) }
  ok('S3 读到只读汇总表', true, '可见行数=' + d.nRows + '（= 本期有报单的商品行）')
  ok('S3b 找到「合计(箱)」列', d.idx.box >= 0, '列索引=' + d.idx.box + ' 表头=' + JSON.stringify(d.heads.slice(-8)))
  ok('S3c 找到「合计(小单位)」列', d.idx.sum >= 0, '列索引=' + d.idx.sum)
  ok('S3d 虚拟滚动已关闭（有报单行数 < 80 ⇒ 全量渲染，逐行求和才有意义）', d.nRows > 0 && d.nRows < 80, '可见行数=' + d.nRows)

  console.log('\n  逐行（期次 ' + PERIOD + '）：')
  const byPid = {}
  d.rows.forEach(r => { byPid[String(r.pid)] = r })
  console.log('  pid    合计(小单位)  合计(箱)   加单   最终下单')
  ;['1161', '1164', '1205'].forEach(pid => {
    const r = byPid[pid]
    if (!r) { ok('R' + pid + ' 该行存在于页面', false, '页面里没有 pid=' + pid + '（可能不在本期可见行内）'); return }
    console.log('  ' + pid + '   ' + String(r.sum).padEnd(12) + '  ' + String(r.box).padEnd(9) + '  '
      + String(r.extra).padEnd(5) + '  ' + r.fin)
    const w = WANT[pid]
    ok('R' + pid + ' 合计(小单位) = ' + w.sum, r.sum === w.sum, '实读=' + r.sum)
    ok('R' + pid + ' 合计(箱) = ' + w.box + '（修复前为 0）', r.box === w.box, '实读=' + r.box)
    ok('R' + pid + ' 最终下单(箱) = 1（不足一箱按一箱）', r.fin === '1', '实读=' + r.fin)
  })

  console.log('\n  表尾：合计(小单位)=' + d.foot.sum + '  合计(箱)=' + d.foot.box
    + '  加单=' + d.foot.extra + '  最终下单=' + d.foot.fin)
  ok('F1 表尾 合计(箱) 不再为 0', d.foot.box !== '0' && d.foot.box !== null, '实读=' + d.foot.box)
  ok('F2 表尾 合计(箱) 含小数且非零', /^0\.\d+/.test(String(d.foot.box)), '实读=' + d.foot.box)
  ok('F3 表尾 合计(小单位) 仍是 9（未被本次改动影响）', String(d.foot.sum) === '9', '实读=' + d.foot.sum)

  /* 「表尾 == Σ可见行」的前置条件：表尾 加单 必须为 0。
     理由：`hideZeroReport` 按「报单量(rowSum) > 0」筛行，而**只加单、没报单**的行会被筛掉、
     却仍计入表尾的「最终下单」⇒ 那种情况下表尾 > Σ可见行是**正确行为**，不是缺陷。
     先把前置条件断言出来，后面的等式才有意义（免得出假 FAIL）。 */
  const extraNum = parseFloat(d.foot.extra)
  ok('F0 前置条件：表尾「加单」为 0（否则「表尾 == Σ可见行」不成立）',
    extraNum === 0, '实读=' + d.foot.extra)

  const sumBox = d.rows.reduce((s, r) => s + (parseFloat(r.box) || 0), 0)
  const sumFin = d.rows.reduce((s, r) => s + (parseFloat(r.fin) || 0), 0)
  console.log('  逐行相加：合计(箱)=' + Math.round(sumBox * 1000) / 1000 + '  最终下单=' + sumFin)
  ok('F4 表尾 == 逐行和（合计(箱)）', Math.abs(sumBox - parseFloat(d.foot.box)) < 0.001,
    'Σ行=' + Math.round(sumBox * 1000) / 1000 + ' 表尾=' + d.foot.box)
  ok('F5 表尾 == 逐行和（最终下单）', sumFin === parseFloat(d.foot.fin),
    'Σ行=' + sumFin + ' 表尾=' + d.foot.fin)

  /* 「表尾与它旁边的数字必须说同一件事」：表尾那句「（缺规格 N 行未计入）」的 N
     必须**等于**可见行里显示「缺规格」的行数 —— 否则就是两处判据漂移。
     （可见行 = 全部有报单的行，所以这个等值是可判定的。） */
  const footBoxText = String(d.foot.box || '')
  const m = /缺规格\s*(\d+)\s*行未计入/.exec(footBoxText)
  const missRows = d.rows.filter(r => r.box === '缺规格').length
  if (m) {
    ok('F6 表尾「缺规格 N 行未计入」的 N == 可见行里显示「缺规格」的行数',
      Number(m[1]) === missRows, '表尾 N=' + m[1] + ' 行内=' + missRows)
  } else {
    ok('F6 无「未计入」标记时，可见行里确实没有「缺规格」行', missRows === 0, '行内缺规格=' + missRows)
  }

  /* ---- 5. 用户可见口径脚注（本次一并订正，必须已是新口径）---- */
  const note = await page.eval('(()=>{var p=document.querySelector(".cross-amt-note");return p?String(p.textContent||""):""})()')
  ok('S4 口径脚注已是新口径（含「不足一箱按一箱」）', /不足一箱按一箱/.test(note), note.slice(0, 60) + '…')
  ok('S4b 旧口径文案已不在页面上', !/取整后相加|均按箱计/.test(note))

  /* ---- 6. 零运行期错误 ---- */
  ok('S5 无运行期异常/console.error', page.errors.length === 0, JSON.stringify(page.errors.slice(0, 3)))
  const stack = await page.eval('/Maximum call stack/.test(document.body?document.body.innerText:"")')
  ok('S5b 无「Maximum call stack」整页崩', stack === false)

  await page.screenshot(SHOT)
  console.log('\n截图：' + SHOT)
} catch (e) {
  fail++
  fails.push('FATAL ' + (e && e.message))
  console.log('❌ FATAL: ' + (e && e.message))
} finally {
  if (browser) await browser.close()
}

console.log('\n' + '='.repeat(64))
console.log(fail === 0 ? `✅ 全部通过：${pass} 项断言` : `❌ ${fail} 项失败 / 共 ${pass + fail} 项`)
fails.forEach(f => console.log('   ✗ ' + f))
process.exit(fail === 0 ? 0 : 1)
