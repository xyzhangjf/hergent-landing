/* v290 编辑员工弹窗 · 保存机制与布局 · 本地预检探针
 *
 * 为什么用「本地托管 dist + 拦截 /api/**」而不是打生产：
 *   ① 生产上唯一能登录的账号是提审用的 supervisor，只有 data/dashboard/chat，
 *      /api/employees 直接 403，进不去这个页面；
 *   ② 更重要：验证「保存后不关窗」需要点保存 = **真实生产写入**。
 *      生产环境不该跑写入型冒烟（v208 探针同款纪律）。
 *      ⇒ 改为纯前端动作验证：展开/收起、改下拉、点遮罩。
 *        这些都**不提交**任何东西，但恰好覆盖本次全部行为改动。
 *
 * 反例对照（本项目最硬的验证手法）：
 *   同一份探针跑**新旧两个 dist** —— 新产物应出现以下事实，旧产物应给出相反事实：
 *     · 底部按钮文案 保存基本信息 / 保存（旧）
 *     · 展开区几何：在新产物里必须落在**操作行下方**；旧产物里在**上方**
 *     · 有未保存改动时点遮罩：新产物关不掉；旧产物直接关掉且丢改动
 *   用法：
 *     HG_DIST=<dist 路径> HG_TAG=new|old node v290-...-probe.mjs
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const DIST = process.env.HG_DIST || '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/dist'
const TAG = process.env.HG_TAG || 'new'
const OUT = process.env.HG_OUT || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/编辑员工页-保存机制与布局评审-2026-09-27'
const PORT = Number(process.env.HG_PORT || 8899)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
}

let pass = 0, fail = 0
const fails = []
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra !== undefined ? '  [' + extra + ']' : '')) }
  else { fail++; fails.push(label + '  [' + extra + ']'); console.log('  ❌ ' + label + (extra !== undefined ? '  [' + extra + ']' : '')) }
}
function fact(label, v) { console.log('  ·  ' + label + ' = ' + JSON.stringify(v)) }

function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0])
    if (p === '/' || !path.extname(p)) p = '/index.html'
    const f = path.join(DIST, p)
    if (!f.startsWith(DIST) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
      res.writeHead(404); res.end('nf'); return
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' })
    fs.createReadStream(f).pipe(res)
  })
  return new Promise(r => srv.listen(PORT, '127.0.0.1', () => r(srv)))
}

/* ---------- 注入桩：登录态 + /api/** 假响应 ---------- */
const INIT = `(() => {
  try {
    localStorage.setItem('hergent_v2_token', 'V290-PROBE-TOKEN-NOT-REAL')
    localStorage.setItem('hergent_v2_user', JSON.stringify({ id: 1, username: 'probe', display_name: '探针', role: 'boss', roles: ['boss'] }))
    localStorage.setItem('hergent_v2_tenant', '1')
  } catch (e) {}

  var EMP = [
    { id: 101, name: '张某某', employee_no: 'EMP001', position: '业务员', hire_date: '2026-03-01',
      is_active: 1, has_account: 1, account_username: '13800000001', account_role: 'sales',
      account_roles: 'sales,accountant', account_active: 1, account_user_id: 9001,
      store_ids: [1, 2], salary_structure: '{"base_salary":6000}' },
    { id: 102, name: '李某某', employee_no: 'EMP002', position: '会计',
      is_active: 1, has_account: 0, store_ids: [], salary_structure: '{"base_salary":5000}' }
  ]
  function perm() {
    return { user: { id: 1, username: 'probe', display_name: '探针', role: 'boss', roles: ['boss'] },
             permissions: ['archive', 'data', 'dashboard', 'chat', 'stock', 'finance', 'marketing', 'settings', 'ai', 'hr', 'payroll'],
             tenant_id: 1, plan: 'free', capabilities: { view: true, export: true } }
  }
  var RULES = [
    [/\\/api\\/auth\\/permissions/, perm],
    [/\\/api\\/auth\\/me/, perm],
    [/\\/api\\/employees/, function () { return EMP }]
  ]
  var orig = window.fetch.bind(window)
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : ((input && input.url) || '')
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i][0].test(url)) {
        return Promise.resolve(new Response(JSON.stringify(RULES[i][1]()), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        }))
      }
    }
    /* 其余 /api/** 一律回空数组：JS 里 [].anyProp === undefined，比 {} 更不容易炸 */
    if (/\\/api\\//.test(url)) {
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    return orig(input, init)
  }
})()`

/* ---------- 页面内表达式 ---------- */
const JS_OPEN_EDIT = `(()=>{
  function tx(el){ return el ? String(el.textContent||'').trim() : '' }
  var hit=null
  Array.from(document.querySelectorAll('button')).forEach(function(b){ if(!hit && tx(b)==='编辑') hit=b })
  if(!hit) return JSON.stringify({ok:false,why:'找不到「编辑」按钮'})
  hit.click()
  return JSON.stringify({ok:true})
})()`

const JS_DIALOG = `(()=>{
  function tx(el){ return el ? String(el.textContent||'').trim() : '' }
  function q(s){ return document.querySelector(s) }
  var dlg=q('.df-modal.edit-modal')
  if(!dlg) return JSON.stringify({open:false})
  var btns=Array.from(dlg.querySelectorAll('button')).map(tx)
  var ft=dlg.querySelector('.df-modal-ft')
  var ftBtns=ft?Array.from(ft.querySelectorAll('button')).map(tx):[]
  var card=q('.df-acc-card')
  return JSON.stringify({
    open:true,
    footerBtns:ftBtns,
    allBtns:btns,
    hasCard:!!card,
    cardTitle:card?tx(card.querySelector('.df-acc-card-t')):null,
    cardTip:card?tx(card.querySelector('.df-acc-card-tip')):null,
    dirtyTag:card?tx(card.querySelector('.df-dirty-tag')):null,
    opsBtns:Array.from((q('.df-acc-ops')||document.createElement('div')).querySelectorAll('button')).map(tx),
    legend:tx(dlg.querySelector('.df-acc-sum')),
    bodyText:String(dlg.innerText||'').slice(0,400)
  })
})()`

/* 触发按钮按**文案**找，不依赖 .df-acc-ops —— 旧产物没有那个容器，
   本探针要能在新旧两个 dist 上跑出可对照的事实。 */
const JS_TOGGLE_RESET = `(()=>{
  function tx(el){ return el ? String(el.textContent||'').trim() : '' }
  var hit=null
  function scan(root){ Array.from((root||document).querySelectorAll('button')).forEach(function(b){ if(!hit && tx(b)==='重置密码') hit=b }) }
  var scope=document.querySelector('.df-acc-ops')
  if(scope) scan(scope)
  if(!hit) scan(document)
  if(!hit) return JSON.stringify({ok:false,why:'找不到「重置密码」按钮'})
  hit.click()
  return JSON.stringify({ok:true,clicked:tx(hit),via:scope?'ops-row':'global'})
})()`

/* 🔴 本次最核心的布局修复：**展开出的输入行，相对触发按钮在哪个方向**。
   判据写成「事实」而不是「断言」，才能同时跑旧产物做反例对照。
   新产物：inputIsBelowTrigger=true（紧贴下方 11px）
   旧产物：inputIsAboveTrigger=true（长在上方，中间还隔着「兼任角色」整块） */
const JS_GEO_COMPAT = `(()=>{
  function tx(el){ return el ? String(el.textContent||'').trim() : '' }
  function rect(e){ if(!e) return null; var b=e.getBoundingClientRect()
    return {top:Math.round(b.top),bottom:Math.round(b.bottom),h:Math.round(b.height)} }
  var trigger=null, pwBtn=null
  /* ⚠️ 点击后按钮文案会变：新版 →「收起」；**旧版 →「取消重置」**。
     漏掉「取消重置」会让旧产物上 trigger=null、几何判据拿不到方向
     （实测踩过：D3 只报出 inputRow.top=790、trigger.bottom=?）。
     断言失败先回读断言本身 —— 这次错的是选择器，不是被测代码。 */
  Array.from(document.querySelectorAll('button')).forEach(function(b){
    if(!trigger && /^(重置密码|收起|取消重置)$/.test(tx(b)) && b.closest('.df-acc-ops')) trigger=b
  })
  if(!trigger) Array.from(document.querySelectorAll('button')).forEach(function(b){ if(!trigger && /^(重置密码|取消重置)$/.test(tx(b))) trigger=b })
  Array.from(document.querySelectorAll('button')).forEach(function(b){ if(!pwBtn && tx(b)==='保存密码') pwBtn=b })
  var pwRow = pwBtn ? (pwBtn.closest('.df-acc-expand') || pwBtn.closest('.df-acc-row')) : null
  var rT=rect(trigger), rR=rect(pwRow)
  return JSON.stringify({
    triggerText: trigger?tx(trigger):null, trigger:rT, inputRow:rR,
    inputRowClass: pwRow?pwRow.className:null,
    inputIsAboveTrigger: (rT&&rR) ? (rR.bottom <= rT.top+2) : null,
    inputIsBelowTrigger: (rT&&rR) ? (rR.top >= rT.bottom-2) : null,
    gapPx: (rT&&rR) ? (rR.top>=rT.bottom ? rR.top-rT.bottom : rT.top-rR.bottom) : null
  })
})()`

const JS_COLLAPSE = `(()=>{
  function tx(el){ return el ? String(el.textContent||'').trim() : '' }
  var hit=null
  Array.from(document.querySelectorAll('.df-acc-ops button')).forEach(function(b){ if(!hit && tx(b)==='收起') hit=b })
  if(!hit) Array.from(document.querySelectorAll('button')).forEach(function(b){ if(!hit && tx(b)==='取消重置') hit=b })
  if(!hit) return JSON.stringify({ok:false,why:'没有可收起的按钮'})
  hit.click()
  return JSON.stringify({ok:true})
})()`

/* 「点了有没有反应」用**出现含『保存密码』的行**判定 —— 两版都成立；
   新产物额外报告它是否落在 .df-acc-expand 容器里（那是本次新增的结构）。 */
const JS_EXPAND_EXISTS = `(()=>{
  function tx(el){ return el ? String(el.textContent||'').trim() : '' }
  var pw=null
  Array.from(document.querySelectorAll('button')).forEach(function(b){ if(!pw && tx(b)==='保存密码') pw=b })
  return JSON.stringify({
    exists: !!pw,
    inExpandBox: !!(pw && pw.closest('.df-acc-expand')),
    inOpsRow: !!(pw && pw.closest('.df-acc-ops'))
  })
})()`

const JS_CHANGE_ROLE = `(()=>{
  var s=document.querySelector('.df-acc-row select.acc-role') || document.querySelector('select.acc-role')
  if(!s) return JSON.stringify({ok:false,why:'找不到角色下拉'})
  var before=s.value
  var opts=Array.from(s.options).map(function(o){return o.value})
  var pick=opts.filter(function(v){return v!==s.value})[0]
  if(!pick) return JSON.stringify({ok:false,why:'下拉只有一个选项'})
  s.value=pick; s.dispatchEvent(new Event('change',{bubbles:true}))
  return JSON.stringify({ok:true,from:before,to:pick})
})()`

const JS_DIRTY_TAG = `(()=>{
  var c=document.querySelector('.df-dirty-tag')
  return JSON.stringify({present:!!c,text:c?String(c.textContent||'').trim():null})
})()`

const JS_HOOK_CONFIRM_FALSE = `(()=>{ window.__origConfirm=window.confirm; window.__confirmCalls=[]; window.confirm=function(m){ window.__confirmCalls.push(String(m||'')); return false }; return JSON.stringify({ok:true}) })()`
const JS_HOOK_CONFIRM_TRUE = `(()=>{ window.confirm=function(m){ window.__confirmCalls=window.__confirmCalls||[]; window.__confirmCalls.push(String(m||'')); return true }; return JSON.stringify({ok:true}) })()`
const JS_CONFIRM_LOG = `JSON.stringify({calls:(window.__confirmCalls||[])})`

const JS_CLICK_OVERLAY = `(()=>{
  var o=document.querySelector('.df-overlay')
  if(!o) return JSON.stringify({ok:false,why:'没有遮罩'})
  o.click()
  return JSON.stringify({ok:true})
})()`

const JS_DIALOG_OPEN = `JSON.stringify({open: !!document.querySelector('.df-modal.edit-modal')})`

function assertExpr(name, expr) {
  try { new Function('return ' + expr) } catch (e) {
    console.error('❌ 探针自检失败：' + name + ' 语法错：' + e.message); process.exit(2)
  }
}
;['JS_OPEN_EDIT', 'JS_DIALOG', 'JS_TOGGLE_RESET', 'JS_GEO_COMPAT', 'JS_COLLAPSE', 'JS_EXPAND_EXISTS',
  'JS_CHANGE_ROLE', 'JS_DIRTY_TAG', 'JS_HOOK_CONFIRM_FALSE', 'JS_CLICK_OVERLAY', 'JS_DIALOG_OPEN']
  .forEach(k => assertExpr(k, eval(k)))

let browser, srv
try {
  fs.mkdirSync(OUT, { recursive: true })
  console.log('=== v290 编辑员工弹窗探针 [' + TAG + '] ===')
  console.log('    dist = ' + DIST)
  console.log('    零写入：全程不点任何保存按钮\n')

  srv = await serve()
  browser = await launch()
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(INIT)

  await page.goto('http://127.0.0.1:' + PORT + '/#/archive/employees', 5000)
  await sleep(2500)

  /* ---- A 页面可达 ---- */
  const href = await page.eval('location.href')
  ok('A1 停在员工档案页（未被踢回登录）', !/#\/login/.test(href), href)
  const crashed = await page.eval('/页面出错了/.test(document.body?document.body.innerText:"")')
  ok('A2 正文无 ErrorBoundary「页面出错了」', crashed === false)
  const rows = await page.eval('document.querySelectorAll("table.tbl tbody tr").length')
  ok('A3 假数据渲染出 2 行员工', rows === 2, 'rows=' + rows)

  /* ---- B 打开编辑弹窗 ---- */
  const oe = JSON.parse(await page.eval(JS_OPEN_EDIT))
  ok('B1 点「编辑」打开弹窗', oe.ok === true, oe.why || '')
  await sleep(1200)
  const d = JSON.parse(await page.eval(JS_DIALOG))
  ok('B2 编辑弹窗已打开', d.open === true)
  fact('底部按钮', d.footerBtns)
  fact('操作行按钮', d.opsBtns)
  fact('卡片标题', d.cardTitle)
  fact('脏标记', d.dirtyTag)

  /* ---- C 文案与结构（D4/D5/D7/D8）---- */
  ok('C1 底部按钮 = 「保存基本信息」（不再是含糊的「保存」）',
     (d.footerBtns || []).indexOf('保存基本信息') >= 0, JSON.stringify(d.footerBtns))
  ok('C2 账号区有边框卡片 .df-acc-card', d.hasCard === true)
  ok('C3 卡片标题 = 「账号与权限」', d.cardTitle === '账号与权限', String(d.cardTitle))
  ok('C4 有「各自独立保存」说明句', /各自独立保存/.test(d.cardTip || ''), String(d.cardTip).slice(0, 60))
  ok('C5 操作行有「改登录名」', (d.opsBtns || []).indexOf('改登录名') >= 0, JSON.stringify(d.opsBtns))
  ok('C6 操作行有「重置密码」', (d.opsBtns || []).indexOf('重置密码') >= 0)
  ok('C7 「禁用账号」仍在（危险操作保留）', (d.opsBtns || []).some(x => /禁用账号|启用账号/.test(x)))
  ok('C8 旧文案「取消改账号」已消失', (d.allBtns || []).indexOf('取消改账号') < 0, JSON.stringify(d.allBtns))
  ok('C9 旧文案「取消重置」已消失', (d.allBtns || []).indexOf('取消重置') < 0)
  ok('C10 旧文案「保存账号」已消失', (d.allBtns || []).indexOf('保存账号') < 0)
  ok('C11 初始无「有未保存的改动」标记', !d.dirtyTag, String(d.dirtyTag))

  /* ---- D 展开落点几何（D3：修复前输入框长在按钮上方）---- */
  const tr = JSON.parse(await page.eval(JS_TOGGLE_RESET))
  ok('D1 点「重置密码」成功', tr.ok === true, tr.why || (tr.clicked + ' / ' + tr.via))
  await sleep(600)
  const ex = JSON.parse(await page.eval(JS_EXPAND_EXISTS))
  ok('D2 点完出现密码输入行（点了有反应）', ex.exists === true, JSON.stringify(ex))
  const g = JSON.parse(await page.eval(JS_GEO_COMPAT))
  console.log('  ·  几何: ' + JSON.stringify(g))
  ok('D3 🔴 输入行落在触发按钮**下方**（修复前在上方）', g.inputIsBelowTrigger === true,
     'inputRow.top=' + (g.inputRow ? g.inputRow.top : '?') + ' trigger.bottom=' + (g.trigger ? g.trigger.bottom : '?'))
  ok('D4 输入行紧贴按钮（缝隙 ≤ 60px）', typeof g.gapPx === 'number' && g.gapPx <= 60, 'gap=' + g.gapPx + 'px')
  ok('D4b 输入行包在本次新增的 .df-acc-expand 容器里', ex.inExpandBox === true, 'inExpandBox=' + ex.inExpandBox)
  const expBtns = await page.eval(`(()=>{
    function tx(el){ return el ? String(el.textContent||'').trim() : '' }
    var box=document.querySelector('.df-acc-expand')
    var scope=box||document
    var list=Array.from(scope.querySelectorAll('button')).map(tx).filter(function(t){return /保存密码/.test(t)})
    return JSON.stringify({container: box ? '.df-acc-expand' : '(无容器·旧版)', btns: list})
  })()`)
  fact('展开区内按钮', expBtns)
  ok('D5 展开区内有「保存密码」按钮', /保存密码/.test(expBtns))
  await page.eval(JS_COLLAPSE)
  await sleep(500)
  const ex2 = JSON.parse(await page.eval(JS_EXPAND_EXISTS))
  ok('D6 点「收起」后展开区消失', ex2.exists === false)

  /* ---- E 脏标记 + 关窗闸门（D1/D2 行为面，零写入）---- */
  const cr = JSON.parse(await page.eval(JS_CHANGE_ROLE))
  fact('改角色下拉', cr)
  ok('E1 能改角色下拉（纯前端，不提交）', cr.ok === true, cr.why || (cr.from + '→' + cr.to))
  await sleep(600)
  const dt = JSON.parse(await page.eval(JS_DIRTY_TAG))
  ok('E2 出现「有未保存的改动」标记', dt.present === true && /未保存/.test(dt.text || ''), String(dt.text))

  await page.eval(JS_HOOK_CONFIRM_FALSE)
  await page.eval(JS_CLICK_OVERLAY)
  await sleep(700)
  const stillOpen = JSON.parse(await page.eval(JS_DIALOG_OPEN))
  ok('E3 🔴 有未保存改动时点遮罩**关不掉**（弹窗仍在）', stillOpen.open === true, 'open=' + stillOpen.open)
  const clog = JSON.parse(await page.eval(JS_CONFIRM_LOG))
  fact('弹过的确认框', clog.calls)
  ok('E4 确实弹了确认，且文案点明有未保存改动', clog.calls.length >= 1 && /未保存/.test(clog.calls[0] || ''), JSON.stringify(clog.calls))

  await page.eval(JS_HOOK_CONFIRM_TRUE)
  await page.eval(JS_CLICK_OVERLAY)
  await sleep(700)
  const closedNow = JSON.parse(await page.eval(JS_DIALOG_OPEN))
  ok('E5 确认后可以正常关闭（不是关不掉）', closedNow.open === false, 'open=' + closedNow.open)

  /* ---- F 零错误 ---- */
  const errs = page.errors.filter(e => !/favicon|ERR_FILE_NOT_FOUND/i.test(e))
  ok('F1 无运行期异常 / console.error', errs.length === 0, JSON.stringify(errs.slice(0, 3)))

  fs.writeFileSync(OUT + '/探针-' + TAG + '-原始输出.txt', [
    'dist=' + DIST,
    'dialog=' + JSON.stringify(d, null, 1),
    'geo=' + JSON.stringify(g, null, 1),
    'confirmCalls=' + JSON.stringify(clog.calls),
    'errors=' + JSON.stringify(errs, null, 1),
  ].join('\n'), 'utf8')
  console.log('\n原始输出: ' + OUT + '/探针-' + TAG + '-原始输出.txt')
} catch (e) {
  fail++; fails.push('FATAL ' + (e && e.message))
  console.log('❌ FATAL: ' + (e && e.message))
} finally {
  if (browser) await browser.close()
  if (srv) srv.close()
}

console.log('\n' + '='.repeat(64))
console.log(fail === 0 ? `✅ [${TAG}] 全部通过：${pass} 项` : `❌ [${TAG}] ${fail} 项失败 / 共 ${pass + fail} 项`)
fails.forEach(f => console.log('   ✗ ' + f))
process.exit(fail === 0 ? 0 : 1)
