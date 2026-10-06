/**
 * v385 真机验收 —— 「新建员工 / 选角色 / 开账号 **一屏一次完成**」的端到端验证。
 *
 * 环境：生产前端（hergent.cn 线上压缩产物）+ **隔离沙箱租户**（克隆自真实库）。
 *   · 探针**自带安全断言**（S1）：凡写请求的 `X-Tenant-Id` 必须等于沙箱号，否则判红；
 *   · 验完由 `sandbox_tenant.py down --id <号>` 销毁，并独立复核零残留。
 *
 * 本轮要看的三件事（前两件是**新增能力**，第三件是防回归）：
 *   ① 新建弹窗一打开，「登录账号」那块表单就**在**（不必先保存一次）；
 *   ② 右下角**唯一**那个按钮的文案会随账号草稿变：没填=「创建员工」，填了=「创建并开通账号」；
 *      点它 ⇒ **一次点击发出两个写请求**（建档案 + 开账号），而不是只建档案。
 *   ③ v384 的修复不回归：开号后角色下拉停在所选角色、且没有「有未保存的改动」标记。
 *
 * 用法：SBX_TOKEN=<token> SBX_ID=<沙箱号> node tools/v385-e2e-probe.mjs
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const TOKEN = process.env.SBX_TOKEN
const TENANT = process.env.SBX_ID || '10085'
const BASE = 'https://hergent.cn'
const EMP_NAME = '沙箱验收员工v385'
const ACC_USER = '13800008585'
const ACC_PWD = 'Abcd1234'
const WANT_ROLE = 'guide'          // 界面选「导购」
const WANT_ROLE_CN = '导购'

if (!TOKEN) { console.error('缺 SBX_TOKEN'); process.exit(2) }

const R = []
const ok = (id, label, cond, got) => R.push({ id, label, ok: !!cond, got: got === undefined ? '' : String(got) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const HELPER = `(function(){
  window.__h = {
    vis: function(el){ return !!el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== 'none'; },
    btn: function(t){ return [].slice.call(document.querySelectorAll('button')).filter(function(e){ return window.__h.vis(e) && e.textContent.replace(/\\s+/g,'') === t })[0] || null; },
    field: function(pre){
      var fs = [].slice.call(document.querySelectorAll('.df-field')).filter(function(e){
        var s = e.querySelector('span'); return window.__h.vis(e) && s && s.textContent.trim().indexOf(pre) === 0 });
      return fs.length ? fs[0].querySelector('input') : null;
    },
    set: function(el, v){
      var s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      s.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true}));
    },
    /** 两个下拉同名（class 都是 acc-role），必须按**容器**定位：
     *  「未开通」表单在 .df-acc-create、「已有账号」态在 .df-acc-manage。
     *  取"可见的第一个"会在界面没切换时读到另一块 ⇒ 假绿（v384 踩过）。 */
    roleSel: function(scope){
      var box = document.querySelector(scope === 'create' ? '.df-acc-create' : '.df-acc-manage');
      if (!box) return null;
      return box.querySelector('select.acc-role');
    },
    roleVal: function(scope){ var s = window.__h.roleSel(scope); return s ? s.value : null; },
    roleTxt: function(scope){ var s = window.__h.roleSel(scope); return (s && s.options[s.selectedIndex]) ? s.options[s.selectedIndex].textContent : null; },
    setRole: function(v){
      var s = window.__h.roleSel('create'); if (!s) return null;
      var st = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      st.call(s, v); s.dispatchEvent(new Event('change', {bubbles:true})); return s.value;
    },
    dirtyTag: function(){ return !!document.querySelector('.df-dirty-tag') },
    hasCreateForm: function(){ return !!document.querySelector('.df-acc-create') },
    hasManageBox: function(){ return !!document.querySelector('.df-acc-manage') },
    /** 弹窗右下角那个按钮的文案（v385 的核心：它叫什么是承诺）。 */
    footerBtnText: function(){
      var ms = [].slice.call(document.querySelectorAll('.df-modal-ft')).filter(window.__h.vis);
      if (!ms.length) return null;
      var bs = [].slice.call(ms[0].querySelectorAll('button')).filter(window.__h.vis);
      return bs.length ? bs[bs.length - 1].textContent.replace(/\\s+/g,'') : null;
    },
    clickFooter: function(){
      var ms = [].slice.call(document.querySelectorAll('.df-modal-ft')).filter(window.__h.vis);
      if (!ms.length) return false;
      var bs = [].slice.call(ms[0].querySelectorAll('button')).filter(window.__h.vis);
      if (!bs.length) return false;
      bs[bs.length - 1].click(); return true;
    },
    toasts: function(){ return [].slice.call(document.querySelectorAll('.toast')).map(function(e){ return e.textContent.replace(/\\s+/g,' ').trim() }) }
  };
  return 'helper-ok';
})()`

const TAP = `(function(){
  window.__tap = { calls: [] };
  var _f = window.fetch;
  window.fetch = function(u, opt){
    var url = (typeof u === 'string') ? u : ((u && u.url) || '');
    var o = opt || {};
    var h = o.headers || {};
    var rec = { url: url, method: String(o.method || 'GET').toUpperCase(),
                body: (typeof o.body === 'string' ? o.body : null),
                tenant: h['X-Tenant-Id'] || h['x-tenant-id'] || null, status: null, resp: null };
    var i = window.__tap.calls.push(rec) - 1;
    var p = _f.apply(this, arguments);
    if (url.indexOf('/api/') >= 0) {
      // GET 也记 —— 要证明"员工真的落库"（POST 200 不等于读得回，沙箱踩过幽灵 inode）
      p.then(function(r){
        window.__tap.calls[i].status = r.status;
        r.clone().json().then(function(j){ window.__tap.calls[i].resp = j }).catch(function(){});
      }).catch(function(){});
    }
    return p;
  };
  return 'tap-ok';
})()`

const AUTH = `(function(){
  localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
  localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(TENANT)});
  localStorage.setItem('hergent_v2_user', JSON.stringify({ username:'sbx_verify', role:'boss', display_name:'沙箱验收' }));
  return 'auth-ok';
})()`

async function allToasts(page) {
  return JSON.parse((await page.eval('JSON.stringify(window.__h.toasts())').catch(() => '[]')) || '[]')
}

// v385 修：原来按「任一 needle 命中即返回」轮询 —— 但 saveAll 会**先后**弹两条
// （saveEmployeeCore 的中间提示「已创建员工」→ 合并提示「员工已创建，登录账号已开通」），
// 先命中的那条被提前返回，导致断言读到中间态 ⇒ B7 假红。
// 改成「按谓词轮询」：一直等到**真正要判的那条**出现（或超时），语义上就是「这次提交最终报了哪句」。
async function pollToastWhere(page, pred, tries = 24, gap = 250) {
  for (let i = 0; i < tries; i++) {
    const hit = (await allToasts(page)).find(pred)
    if (hit) return hit
    await sleep(gap)
  }
  return null
}

let BROWSER = null
try {
  BROWSER = await launch({ headless: true })
  const page = await BROWSER.newPage()
  await page.enable()
  await page.addInitScript(AUTH)
  await page.addInitScript(TAP)

  const url = BASE + '/?cb=' + Date.now() + '#/archive/employees'
  await page.goto(url, 7000)
  const landed = await page.eval('location.href')
  ok('P1', '停在员工档案页（未被守卫踢回登录页）', /archive\/employees/.test(String(landed)), landed)
  await page.eval(HELPER)

  const addBtn = await page.eval("(function(){ return !!window.__h.btn('＋添加员工') })()")
  ok('P2', '「＋ 添加员工」按钮存在（沙箱 boss 有 hr/create）', addBtn, addBtn)
  if (!addBtn) throw new Error('前置失败：进不了员工档案页，后续断言无意义')

  // ---------- ① 打开新建弹窗：**账号表单应当已经在** ----------
  await page.eval("(function(){ window.__h.btn('＋添加员工').click(); return 1 })()")
  await sleep(900)
  const createFormAtOpen = await page.eval('window.__h.hasCreateForm()')
  ok('P3', '【核心·本轮新增】新建弹窗一打开，登录账号表单**已渲染**（不必先保存一次）',
    createFormAtOpen === true, createFormAtOpen)

  await page.eval("(function(){ window.__h.set(window.__h.field('姓名'), " + JSON.stringify(EMP_NAME) + "); return 1 })()")
  await sleep(350)

  // ---------- ② 账号留空时，按钮只承诺「创建员工」 ----------
  const labelEmpty = await page.eval('window.__h.footerBtnText()')
  ok('P4', '【核心】账号没填 ⇒ 右下角按钮文案 =「创建员工」',
    labelEmpty === '创建员工', JSON.stringify(labelEmpty))

  // ---------- ③ 同一屏里把账号填上 ----------
  await page.eval("(function(){ window.__h.set(window.__h.field('手机号'), " + JSON.stringify(ACC_USER) + "); return 1 })()")
  await sleep(300)
  await page.eval("(function(){ window.__h.set(window.__h.field('初始密码'), " + JSON.stringify(ACC_PWD) + "); return 1 })()")
  await sleep(300)
  const rolePicked = await page.eval("(function(){ return window.__h.setRole(" + JSON.stringify(WANT_ROLE) + ") })()")
  await sleep(500)
  ok('P5', '已把角色下拉选为 guide（导购）', rolePicked === WANT_ROLE, JSON.stringify(rolePicked))

  const labelFilled = await page.eval('window.__h.footerBtnText()')
  ok('P6', '【核心】账号填了 ⇒ 同一个按钮文案变成「创建并开通账号」',
    labelFilled === '创建并开通账号', JSON.stringify(labelFilled))

  const nonCreateBtns = await page.eval("(function(){ return [].slice.call(document.querySelectorAll('.df-acc-create button')).filter(function(b){ return window.__h.vis(b) }).map(function(b){ return b.textContent.replace(/\\s+/g,'') }) })()")
  ok('P7', '新建态**不出现**第二个「开通账号」按钮（同屏两个会让人不知道点哪个）',
    Array.isArray(nonCreateBtns) && nonCreateBtns.indexOf('开通账号') < 0, JSON.stringify(nonCreateBtns))

  // 提交**前**先留一张：这才是「一屏一次完成」的原貌（员工 + 角色 + 账号同框）。
  // 弹窗体在 .df-edit-body 里独立滚动（头尾固定），滚到底才能把账号区三个字段一起收进镜头。
  await page.eval("(function(){ var b = document.querySelector('.df-edit-body'); if (b) b.scrollTop = b.scrollHeight; return b ? b.scrollTop : -1 })()")
  await sleep(400)
  await page.screenshot('/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v385-新建员工一屏一次完成-提交前.png')
  await page.eval("(function(){ var b = document.querySelector('.df-edit-body'); if (b) b.scrollTop = 0; return 1 })()")
  await sleep(300)

  // ---------- ④ 点**一个**按钮 ⇒ 两个写请求 ----------
  const clicked = await page.eval('window.__h.clickFooter()')
  ok('P8', '右下角按钮可点', clicked === true, clicked)
  // 等**最终**那条合并提示（「员工已创建，登录账号已开通」），不是 saveEmployeeCore 的中间态
  const t = await pollToastWhere(page, (x) => x.indexOf('员工已创建') >= 0, 24)
  await sleep(1500)

  const calls = JSON.parse((await page.eval('JSON.stringify(window.__tap.calls)')) || '[]')
  const empPost = calls.filter((c) => c.method === 'POST' && /\/api\/employees$/.test(c.url))
  const accPost = calls.filter((c) => c.method === 'POST' && c.url.indexOf('/api/forecast-submissions/staff-accounts') >= 0)
  const accBody = accPost[0] ? JSON.parse(accPost[0].body || '{}') : {}

  ok('B1', '【核心】一次点击 ⇒ 建了员工档案（1 次 POST /api/employees）', empPost.length === 1, empPost.length + ' 次')
  ok('B2', '【核心】同一次点击 ⇒ **把账号也开了**（1 次 POST …/staff-accounts）', accPost.length === 1, accPost.length + ' 次')
  ok('B3', '开通请求带的 role == guide（不是 staff）', accBody.role === WANT_ROLE, JSON.stringify(accBody.role))
  ok('B4', '开通请求的 employee_id 有效（≠0，即挂在了刚建的档案上）', Number(accBody.employee_id) > 0, accBody.employee_id)
  ok('B5', '开通请求成功（200）', accPost[0] && accPost[0].status === 200, accPost[0] && accPost[0].status)
  ok('B6', '员工真的落库：最后一次 GET /api/employees 响应里能找到该员工',
    (function () {
      const gs = calls.filter((c) => c.method === 'GET' && c.url.indexOf('/api/employees') >= 0)
      const last = gs[gs.length - 1]
      return !!(last && last.resp && JSON.stringify(last.resp).indexOf(EMP_NAME) >= 0)
    })(), '')
  ok('B7', '提示语说明了两件事都成了（含「员工已创建」）',
    !!t && t.indexOf('员工已创建') >= 0, JSON.stringify(t) + ' / 全部toast=' + JSON.stringify(await allToasts(page)))

  // ---------- ⑤ v384 不回归 ----------
  const manageShown = await page.eval('window.__h.hasManageBox()')
  ok('C0', '守门：已切换到「已有账号」态容器（.df-acc-manage）', manageShown === true, manageShown)
  const roleAfter = await page.eval('window.__h.roleVal("manage")')
  const roleAfterTxt = await page.eval('window.__h.roleTxt("manage")')
  ok('C1', '【v384 未回归】角色下拉 value == guide', roleAfter === WANT_ROLE, JSON.stringify(roleAfter))
  ok('C2', '【v384 未回归】角色下拉显示「导购」',
    !!roleAfterTxt && roleAfterTxt.indexOf(WANT_ROLE_CN) >= 0, JSON.stringify(String(roleAfterTxt).slice(0, 40)))
  const dirty = await page.eval('window.__h.dirtyTag()')
  ok('C3', '【v384 未回归】无「有未保存的改动」标记', dirty === false, dirty)

  // ---------- ⑥ 安全与收尾 ----------
  const writes = calls.filter((c) => c.method !== 'GET' && c.method !== 'HEAD' && c.method !== 'OPTIONS')
  const wrong = writes.filter((c) => String(c.tenant) !== TENANT)
  ok('S1', '【安全】所有写请求都带 X-Tenant-Id=' + TENANT,
    writes.length > 0 && wrong.length === 0,
    '写请求 ' + writes.length + ' 条，越界 ' + wrong.length + ' 条' + (wrong.length ? '：' + JSON.stringify(wrong.map((c) => c.url)) : ''))
  ok('S2', '全程只写 2 次（建档案 + 开账号），没有多余的写', writes.length === 2, writes.length)
  ok('S3', '页面无 JS 异常', page.errors.length === 0, JSON.stringify(page.errors.slice(0, 3)))

  await page.screenshot('/tmp/v385-e2e.png')
  await page.screenshot('/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v385-新建员工一屏一次完成-真机验收.png')
} catch (e) {
  ok('FATAL', '探针执行异常：' + (e && e.message), false, '')
} finally {
  if (BROWSER) await BROWSER.close()
}

console.log('== v385 真机验收（线上产物 + 沙箱租户 ' + TENANT + '）==')
for (const r of R) console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.id} ${r.label}${r.got ? '  ← 实际: ' + r.got : ''}`)
const nFail = R.filter((r) => !r.ok).length
console.log(`RESULT pass=${R.length - nFail} fail=${nFail}`)
process.exit(nFail === 0 ? 0 : 1)
