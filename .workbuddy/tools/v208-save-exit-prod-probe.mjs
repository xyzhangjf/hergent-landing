/**
 * v208-save-exit-prod-probe.mjs —— 生产真机验证「保存后退出编辑态」的**可达路径**。
 *
 * 用户要求（原话，2026-09-19）：
 *   「点击『保存』后，页面应回到带有『改单』按钮的状态，此行为与关闭期次无关……
 *     可继续点击『改单』，改完再次点击『保存』，支持反复修改，
 *     且每次修改都需记录并体现在修改日志中。」
 *
 * 🔴 本探针**刻意不点「保存」**，理由不是偷懒：
 *    `saveEdits()` 没有「无改动就短路」的分支 ⇒ 点下去 = 一次**真实生产写入**
 *    （save_matrix 幂等重建整期矩阵 + 落一条 `save_changes` 修改日志）。
 *    在没改任何东西的情况下点它，只会给用户留一条**看不懂的假记录**
 *    （「谁在几点保存了汇总表」，而实际什么都没改）。生产环境不该跑写入型冒烟。
 *
 *    ⇒ 覆盖策略是「真机 + 离线」组合，合起来是完整证明：
 *      · 真机（本文件）：走「改单 → 取消」，它和「保存成功」**共用同一个
 *        `leaveEdit()` 收口**（离线护栏 A1–A6 已断言二者实现同一）。验证
 *        「能不能来回切、切回来有没有『改单』按钮、有没有卡死/报错」。
 *      · 离线（.workbuddy/tools/v208-save-exit-verify.mjs D1–D9）：断言
 *        `saveEdits` 成功分支尾部确实调 `exitEditAfterSave()`、失败分支不调。
 *      两段拼起来 = 用户那条路径被完整覆盖。
 *
 * 用法：node .workbuddy/tools/v208-save-exit-prod-probe.mjs
 *   HG_USER / HG_PASS / HG_PERIOD / HG_SHOT_DIR 可覆盖
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptestsp'
const PASS = process.env.HG_PASS || 'Mpsup@1'
const PERIOD = process.env.HG_PERIOD || '14'
const SHOT_DIR = process.env.HG_SHOT_DIR || '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/保存后退出编辑态-2026-09-19'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const fails = []
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra !== undefined ? '  ' + extra : '')) }
  else { fail++; fails.push(label + (extra !== undefined ? '  ' + extra : '')); console.log('  ❌ ' + label + (extra !== undefined ? '  ' + extra : '')) }
}

/* ---------- 页面内表达式（模板字面量，避免嵌套引号陷阱）---------- */
const JS_LOGIN = (u, p) => 'fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({username:' + JSON.stringify(u) + ',password:' + JSON.stringify(p) + '})})'
  + '.then(r=>r.json().then(d=>({s:r.status,d:d})))'
  + '.then(r=>{var d=r.d;if(!d.token)return JSON.stringify({ok:false,status:r.s,detail:d.detail||d.message||""});'
  + 'localStorage.setItem("hergent_v2_token",d.token);'
  + 'if(d.csrf_token)localStorage.setItem("hergent_v2_csrf",d.csrf_token);'
  + 'if(d.user)localStorage.setItem("hergent_v2_user",JSON.stringify(d.user));'
  + 'if(d.tenant_id)localStorage.setItem("hergent_v2_tenant",String(d.tenant_id));'
  + 'return JSON.stringify({ok:true,status:r.s,user:(d.user&&d.user.username)||"",role:(d.user&&d.user.role)||"",tenant:d.tenant_id})})'

const JS_SET_PERIOD = (pid) => '(()=>{var s=document.querySelector("select.sel-period");'
  + 'if(!s)return JSON.stringify({ok:false,why:"找不到期次下拉 select.sel-period"});'
  + 'var opts=Array.from(s.options).map(o=>({v:o.value,t:(o.textContent||"").trim()}));'
  + 'var hit=opts.filter(o=>String(o.v)===String(' + JSON.stringify(pid) + '))[0];'
  + 'if(!hit)return JSON.stringify({ok:false,why:"下拉里没有这个期次",opts:opts.slice(0,20)});'
  + 's.value=hit.v;s.dispatchEvent(new Event("change",{bubbles:true}));'
  + 'return JSON.stringify({ok:true,picked:hit,nOpts:opts.length})})()'

/* 兜住可能弹出的原生 confirm —— 点「改单」时若角色被判为「可能无填报权限」会先问一句 */
const JS_HOOK_CONFIRM = `(()=>{ if(!window.__origConfirm) window.__origConfirm = window.confirm
  window.confirm = function(){ return true }; return JSON.stringify({ok:true}) })()`
const JS_UNHOOK_CONFIRM = `(()=>{ if(window.__origConfirm) window.confirm = window.__origConfirm
  return JSON.stringify({ok:true}) })()`

/**
 * 读「当前是哪一态」。判据全部落在**容器类**上，不靠按钮文案：
 *   · 编辑态 ⇔ `.tb-edit-group` 在（模板里 `v-if="editMode"`）
 *   · 只读态的「改单」⇔ `.tb-act` 里那颗（模板里 `v-if="!editMode"`）
 */
const JS_STATE = `(()=>{
  function tx(el){ return el ? String(el.textContent || '').trim() : '' }
  function vis(el){ return !!el && el.offsetParent !== null }
  var editGroup = document.querySelector('.tb-edit-group')
  var actGroup = document.querySelector('.tb-act')
  var btnEdit = null, btnCancel = null, btnSave = null
  if (actGroup) {
    Array.from(actGroup.querySelectorAll('button')).forEach(function(b){ if(/改单/.test(tx(b))) btnEdit = b })
  }
  if (editGroup) {
    Array.from(editGroup.querySelectorAll('button')).forEach(function(b){
      var t = tx(b)
      if (t === '取消') btnCancel = b
      if (/^(保存|保存中…|重试保存)$/.test(t)) btnSave = b
    })
  }
  var st = document.querySelector('.save-state')
  return JSON.stringify({
    editMode: !!editGroup,
    btnEdit: !!btnEdit, btnEditVisible: vis(btnEdit),
    btnCancel: !!btnCancel, btnSave: !!btnSave,
    btnSaveText: btnSave ? tx(btnSave) : null,
    saveState: st ? tx(st) : null,
    readonlyTbl: !!document.querySelector('.cross-viewport table.cross-tbl'),
    editGrid: !!document.querySelector('.edit-grid-wrap table')
  })
})()`

/** 点「改单」（只读态工具栏里那颗） */
const JS_CLICK_EDIT = `(()=>{
  function tx(el){ return el ? String(el.textContent || '').trim() : '' }
  var scope = document.querySelector('.tb-act')
  if (!scope) return JSON.stringify({ ok: false, why: '找不到只读工具栏 .tb-act' })
  var hit = null
  Array.from(scope.querySelectorAll('button')).forEach(function(b){ if (!hit && /改单/.test(tx(b))) hit = b })
  if (!hit) return JSON.stringify({ ok: false, why: '只读工具栏里没有「改单」按钮' })
  if (hit.disabled) return JSON.stringify({ ok: false, why: '「改单」被禁用（loadingEdit？）' })
  hit.click()
  return JSON.stringify({ ok: true, clicked: tx(hit) })
})()`

/** 点「取消」（编辑组里那颗）—— 走的就是与「保存成功」同一个 leaveEdit() */
const JS_CLICK_CANCEL = `(()=>{
  function tx(el){ return el ? String(el.textContent || '').trim() : '' }
  var scope = document.querySelector('.tb-edit-group')
  if (!scope) return JSON.stringify({ ok: false, why: '当前不在编辑态（找不到 .tb-edit-group）' })
  var hit = null
  Array.from(scope.querySelectorAll('button')).forEach(function(b){ if (!hit && tx(b) === '取消') hit = b })
  if (!hit) return JSON.stringify({ ok: false, why: '编辑组里没有「取消」按钮' })
  if (hit.disabled) return JSON.stringify({ ok: false, why: '「取消」被禁用' })
  hit.click()
  return JSON.stringify({ ok: true, clicked: tx(hit) })
})()`

/* 🔴 启动前语法自检（v207 的教训：语法错只会在页面里炸，Node 侧看不到生成的串） */
function assertExpr(name, expr) {
  try { new Function('return ' + expr) } catch (e) {
    console.error('❌ 探针自检失败：' + name + ' 语法错：' + e.message)
    console.error('   生成的表达式 = ' + expr)
    process.exit(2)
  }
}
;['JS_LOGIN', 'JS_SET_PERIOD', 'JS_STATE', 'JS_CLICK_EDIT', 'JS_CLICK_CANCEL', 'JS_HOOK_CONFIRM']
  .forEach(k => assertExpr(k, eval(k + (k === 'JS_LOGIN' ? '(USER,PASS)' : k === 'JS_SET_PERIOD' ? '(PERIOD)' : ''))))

let browser
try {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  console.log('=== v208 真机验证：改单 ⇄ 只读 来回切换（生产 hergent.cn，零写入）===')
  console.log('    覆盖说明：与「保存成功后退出」共用同一个 leaveEdit() 收口；')
  console.log('    保存分支本身由离线护栏 v208-save-exit-verify.mjs 的 D1–D9 断言覆盖。\n')

  browser = await launch()
  const page = await browser.newPage()
  await page.enable()

  /* ---- 1. 登录 ---- */
  await page.goto(BASE, 3500)
  const li = JSON.parse(await page.eval(JS_LOGIN(USER, PASS)))
  console.log('登录：' + JSON.stringify(li))
  ok('S0 登录成功', li.ok, JSON.stringify(li))

  /* ---- 2. 进预报页 ---- */
  await page.goto(BASE + '/?cb=' + Date.now() + '#/forecast', 4500)
  await sleep(3500)
  const url = await page.eval('location.href')
  ok('S0b 没被踢回登录页', !/#\/login/.test(url), url)
  const boundary = await page.eval('/页面出错了/.test(document.body?document.body.innerText:"")')
  ok('S1 正文不含 ErrorBoundary「页面出错了」', boundary === false)

  /* ---- 3. 钉住期次 ---- */
  const sp = JSON.parse(await page.eval(JS_SET_PERIOD(PERIOD)))
  ok('S2 期次下拉可选中期次 ' + PERIOD, sp.ok === true, sp.why || JSON.stringify(sp.picked))
  await sleep(3500)

  await page.eval(JS_HOOK_CONFIRM)   // 兜住「改单」可能弹的角色确认

  /* ---- 4. 起点：必须是只读态，且带「改单」按钮 ---- */
  const s0 = JSON.parse(await page.eval(JS_STATE))
  console.log('\n[起点] ' + JSON.stringify(s0))
  ok('S3 起点是只读态（无 .tb-edit-group）', s0.editMode === false)
  ok('S3b 只读态**有**「改单」按钮且可见（v-if="!editMode"）',
     s0.btnEdit === true && s0.btnEditVisible === true, 'btnEdit=' + s0.btnEdit + ' visible=' + s0.btnEditVisible)
  ok('S3c 只读态**没有**「保存」按钮', s0.btnSave === false)

  /* ---- 5. 第一轮：改单 → 取消（= 与保存成功后同一个 leaveEdit() 收口）---- */
  const c1 = JSON.parse(await page.eval(JS_CLICK_EDIT))
  ok('E1 点「改单」成功', c1.ok === true, c1.why || c1.clicked)
  await sleep(4500)
  const s1 = JSON.parse(await page.eval(JS_STATE))
  console.log('[改单后] ' + JSON.stringify(s1))
  ok('E2 进入编辑态（.tb-edit-group 出现）', s1.editMode === true)
  ok('E3 编辑态**有**「保存」按钮', s1.btnSave === true, '文案=' + s1.btnSaveText)
  ok('E4 编辑态**有**「取消」按钮', s1.btnCancel === true)
  ok('E4b 编辑态**没有**「改单」按钮（两态互斥，v-if="!editMode"）', s1.btnEdit === false)
  /* ⚠️ 编辑态的表格容器**不是** `.cross-viewport` —— 那是只读态的（源码 :657），
     编辑态是 `.edit-grid-wrap`（源码 :893）。两态是**两张不同的表**，判据不能混用。
     本条初版就写错了容器名，实测拿到 `readonlyTbl=false` 的**假 FAIL**
     （页面其实完全正常）。又一次印证：断言失败先回读实现，别先怀疑代码。 */
  ok('E5 编辑态网格已加载（.edit-grid-wrap 表在）', s1.editGrid === true,
     'editGrid=' + s1.editGrid + '（只读容器 readonlyTbl=' + s1.readonlyTbl + '）')

  const x1 = JSON.parse(await page.eval(JS_CLICK_CANCEL))
  ok('E6 点「取消」成功', x1.ok === true, x1.why || x1.clicked)
  await sleep(4000)
  const s2 = JSON.parse(await page.eval(JS_STATE))
  console.log('[取消后] ' + JSON.stringify(s2))
  ok('E7 退出编辑态（.tb-edit-group 消失）', s2.editMode === false)
  ok('E8 🔴 回到只读态**且「改单」按钮重新出现**（用户要的正是这个状态）',
     s2.btnEdit === true && s2.btnEditVisible === true, 'btnEdit=' + s2.btnEdit)
  ok('E9 只读汇总表仍在（未白屏）', s2.readonlyTbl === true)

  /* ---- 6. 第二轮：再改单 → 再取消（用户要求「支持反复修改」）---- */
  const c2 = JSON.parse(await page.eval(JS_CLICK_EDIT))
  ok('E10 第二轮点「改单」成功（可反复进入）', c2.ok === true, c2.why || c2.clicked)
  await sleep(4500)
  const s3 = JSON.parse(await page.eval(JS_STATE))
  ok('E11 第二轮进入编辑态', s3.editMode === true)
  ok('E12 第二轮编辑态「保存」按钮在', s3.btnSave === true, '文案=' + s3.btnSaveText)
  const x2 = JSON.parse(await page.eval(JS_CLICK_CANCEL))
  ok('E13 第二轮点「取消」成功', x2.ok === true, x2.why || x2.clicked)
  await sleep(4000)
  const s4 = JSON.parse(await page.eval(JS_STATE))
  ok('E14 🔴 第二轮同样回到只读态 + 「改单」按钮（反复切换不退化）',
     s4.editMode === false && s4.btnEdit === true, JSON.stringify({ editMode: s4.editMode, btnEdit: s4.btnEdit }))

  /* ---- 7. 保存状态条仍在编辑态可用（v201 保留，勿删）---- */
  const c3 = JSON.parse(await page.eval(JS_CLICK_EDIT))
  await sleep(4500)
  const s5 = JSON.parse(await page.eval(JS_STATE))
  console.log('\n[第三轮进入后] saveState=' + JSON.stringify(s5.saveState))
  ok('E15 编辑态有常驻保存状态条（v201 保留项，本次未删）', s5.saveState !== null, '文案=' + s5.saveState)
  await page.eval(JS_CLICK_CANCEL)
  await sleep(3500)
  await page.eval(JS_UNHOOK_CONFIRM)

  /* ---- 8. 零运行期错误 ---- */
  ok('S5 无运行期异常/console.error', page.errors.length === 0, JSON.stringify(page.errors.slice(0, 3)))
  const stack = await page.eval('/Maximum call stack/.test(document.body?document.body.innerText:"")')
  ok('S5b 无「Maximum call stack」整页崩', stack === false)
  const finalState = JSON.parse(await page.eval(JS_STATE))
  ok('S6 收尾停在只读态（带「改单」按钮）', finalState.editMode === false && finalState.btnEdit === true)

  const SHOT = SHOT_DIR + '/真机-改单往返-收尾只读态.png'
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
