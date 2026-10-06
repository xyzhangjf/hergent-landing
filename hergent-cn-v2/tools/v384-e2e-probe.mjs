/**
 * v384 真机验收 —— 「开通账号选了『导购』、点完却跳回『员工』」修复的端到端验证。
 *
 * 环境：生产前端（hergent.cn 线上压缩产物）+ **隔离沙箱租户 9998**（克隆自 tenant_1）。
 *   · 写操作全部落在 `tenant_9997.db`，验完 `sandbox_tenant.py down --id 9997` 销毁；
 *   · 探针**自带安全断言**（S1）：凡写请求的 `X-Tenant-Id` 必须是 9997，否则判红。
 *
 * 与 v383 探针的区别（本轮的焦点换了）：
 *   v383 验的是「保存后姓名不被清空」；本轮验的是**开通账号后的角色回显**。
 *   故本探针在点「开通账号」**之前**把角色下拉改成 `guide`（导购），
 *   开通后再读**同一位置**的下拉 —— 修复前它会是 `staff`（员工）。
 *
 * 用法：SBX_TOKEN=<token> node tools/v384-e2e-probe.mjs
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const TOKEN = process.env.SBX_TOKEN
const TENANT = process.env.SBX_ID || '9998'
const BASE = 'https://hergent.cn'
const EMP_NAME = '沙箱验收员工v384'
const ACC_USER = '13800009999'
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
    /** v384 修正：两个下拉同名（class 都是 acc-role），必须按**容器**精确定位 ——
     *  「开通账号」表单在 .df-acc-create、「已有账号」态在 .df-acc-manage。
     *  原实现取「可见的第一个」⇒ 界面没切换时会读到开通表单那个下拉，
     *  而它的值恰好也是用户刚选的 guide ⇒ 假绿（v1 就是这样把 C1/C2 判成 PASS 的）。 */
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
    /** 「已有账号」态是否已渲染 —— C1/C2 的**守门断言**，防"界面没切换却读到旧下拉"的假绿。 */
    hasManageBox: function(){ return !!document.querySelector('.df-acc-manage') },
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
      // v384：GET **也**记 —— B6 要证明「新建的员工真的落库了」，
      //   而不是只凭 POST 返回 200（沙箱踩过"写入落到已删除 inode"的坑，
      //   表现就是 POST 200 但列表读不到）。
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

async function pollToast(page, needles, tries = 12, gap = 250) {
  for (let i = 0; i < tries; i++) {
    const list = await page.eval('JSON.stringify(window.__h.toasts())').catch(() => '[]')
    const arr = JSON.parse(list || '[]')
    const hit = arr.find((t) => needles.some((n) => t.indexOf(n) >= 0))
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
  ok('P2', '「＋ 添加员工」按钮存在且可见（沙箱 boss 有 hr/create 权限）', addBtn, addBtn)
  if (!addBtn) throw new Error('前置失败：进不了员工档案页，后续断言无意义')

  await page.eval("(function(){ window.__h.btn('＋添加员工').click(); return 1 })()")
  await sleep(900)

  await page.eval("(function(){ window.__h.set(window.__h.field('姓名'), " + JSON.stringify(EMP_NAME) + "); return 1 })()")
  await sleep(400)
  const typed = await page.eval("(function(){ return window.__h.field('姓名').value })()")
  ok('P3', '姓名已填进输入框（前置）', typed === EMP_NAME, typed)

  // ---------- ① 点保存（v383 路径，本轮不回归） ----------
  await page.eval("(function(){ window.__h.btn('保存').click(); return 1 })()")
  const saveToast = await pollToast(page, ['已创建员工', '保存失败', '请先点击', '请输入员工姓名'])
  ok('P4', '保存后出现「已创建员工」回执', !!saveToast && saveToast.indexOf('已创建员工') >= 0, saveToast)
  await sleep(1200)

  const afterName = await page.eval("(function(){ var el=window.__h.field('姓名'); return el?el.value:'<无输入框>' })()")
  ok('P5', '保存后姓名仍在（v383 未回归）', afterName === EMP_NAME, JSON.stringify(afterName))

  const accCreate = await page.eval('window.__h.hasCreateForm()')
  ok('P6', '已渲染「开通账号」表单', accCreate, accCreate)

  // ---------- ② 填账号 + **选角色 = 导购** ----------
  await page.eval("(function(){ window.__h.set(window.__h.field('手机号'), " + JSON.stringify(ACC_USER) + "); return 1 })()")
  await sleep(300)
  await page.eval("(function(){ window.__h.set(window.__h.field('初始密码'), " + JSON.stringify(ACC_PWD) + "); return 1 })()")
  await sleep(500)

  const roleBefore = await page.eval('window.__h.roleVal("create")')
  await page.eval("(function(){ return window.__h.setRole(" + JSON.stringify(WANT_ROLE) + ") })()")
  await sleep(400)
  const rolePicked = await page.eval('window.__h.roleVal("create")')
  ok('A1', '开通前角色下拉默认 = staff（起点，与缺陷描述一致）', roleBefore === 'staff', JSON.stringify(roleBefore))
  ok('A2', '已把角色下拉改为 guide（导购）', rolePicked === WANT_ROLE, JSON.stringify(rolePicked))

  // ---------- ③ 点开通账号 ----------
  await page.eval("(function(){ window.__h.btn('开通账号').click(); return 1 })()")
  const accToast = await pollToast(page, ['账号已开通', '开通失败', '请先点击'])
  ok('A3', '开通账号后出现「账号已开通」回执', !!accToast && accToast.indexOf('账号已开通') >= 0, accToast)
  await sleep(1500)

  const tap = await page.eval('JSON.stringify(window.__tap.calls)')
  const calls = JSON.parse(tap || '[]')
  const empPost = calls.filter((c) => c.method === 'POST' && /\/api\/employees$/.test(c.url))
  const accPost = calls.filter((c) => c.method === 'POST' && c.url.indexOf('/api/forecast-submissions/staff-accounts') >= 0)
  const accBody = accPost[0] ? JSON.parse(accPost[0].body || '{}') : {}

  ok('B1', '捕获到 1 次 POST /api/employees', empPost.length === 1, empPost.length + ' 次')
  ok('B2', '捕获到 1 次 POST …/staff-accounts', accPost.length === 1, accPost.length + ' 次')
  ok('B3', '【核心】开通请求带的 role == guide（不是 staff）', accBody.role === WANT_ROLE, JSON.stringify(accBody.role))
  ok('B4', '开通请求的 employee_id 有效（≠0）', Number(accBody.employee_id) > 0, accBody.employee_id)
  ok('B5', '开通请求成功（200）', accPost[0] && accPost[0].status === 200, accPost[0] && accPost[0].status)

  // B6：**证明员工真的落库**（列表接口读得回），而不是只凭 POST 返回 200 ——
  //     沙箱踩过"写入落到已删除 inode"的坑，表现正是 POST 200 但列表读不到。
  const listGets = calls.filter((c) => c.method === 'GET' && c.url.indexOf('/api/employees') >= 0)
  const lastList = listGets[listGets.length - 1]
  const listed = !!(lastList && lastList.resp && JSON.stringify(lastList.resp).indexOf(EMP_NAME) >= 0)
  ok('B6', '员工真的落库：最后一次 GET /api/employees 响应里能找到该员工', listed,
    listed ? '找到' : ('未找到（共 ' + listGets.length + ' 次列表请求）'))

  // ---------- ④ 核心：界面必须回显「导购」 ----------
  // 🔴 守门断言：先证明界面**真的切到了「已有账号」态**。否则下面两条会读到
  //    `.df-acc-create` 里那个下拉（值恰好也是刚选的 guide）⇒ **假绿**。
  const manageShown = await page.eval('window.__h.hasManageBox()')
  ok('C0', '守门：开通后已渲染「已有账号」态容器（.df-acc-manage）', manageShown === true, manageShown)
  const roleAfter = await page.eval('window.__h.roleVal("manage")')
  const roleAfterTxt = await page.eval('window.__h.roleTxt("manage")')
  ok('C1', '【核心】开通后「已有账号」态角色下拉 value == guide（修复前为 staff）', roleAfter === WANT_ROLE, JSON.stringify(roleAfter))
  ok('C2', '【核心】开通后角色下拉显示「导购」', !!roleAfterTxt && roleAfterTxt.indexOf(WANT_ROLE_CN) >= 0, JSON.stringify(String(roleAfterTxt).slice(0, 40)))

  const dirty = await page.eval('window.__h.dirtyTag()')
  ok('C3', '【核心】开通后**无**「有未保存的改动」标记（= 不会顺手把导购改回员工）', dirty === false, dirty)

  const stillCreate = await page.eval('window.__h.hasCreateForm()')
  ok('C4', '开通后已切到「已有账号」态（开通表单消失）', stillCreate === false, stillCreate)

  const bodyTxt = await page.eval('document.body.innerText.slice(0, 2000)')
  ok('C5', '页面仍显示该员工姓名', String(bodyTxt).indexOf(EMP_NAME) >= 0, '')

  const errToasts = await page.eval("(function(){ return window.__h.toasts().filter(function(t){ return t.indexOf('失败')>=0 || t.indexOf('请输入')>=0 }) })()")
  ok('C6', '无错误 toast 残留', Array.isArray(errToasts) && errToasts.length === 0, JSON.stringify(errToasts))

  const writes = calls.filter((c) => c.method !== 'GET' && c.method !== 'HEAD' && c.method !== 'OPTIONS')
  const wrong = writes.filter((c) => String(c.tenant) !== TENANT)
  ok('S1', '【安全】所有写请求都带 X-Tenant-Id=' + TENANT,
    writes.length > 0 && wrong.length === 0,
    '写请求 ' + writes.length + ' 条，越界 ' + wrong.length + ' 条' + (wrong.length ? '：' + JSON.stringify(wrong.map((c) => c.url)) : ''))
  ok('S2', '全程只写入 2 次（新建员工 + 开通账号）', writes.length === 2, writes.length)
  ok('S3', '页面无 JS 异常', page.errors.length === 0, JSON.stringify(page.errors.slice(0, 3)))

  await page.screenshot('/tmp/v384-e2e.png')
  await page.screenshot('/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v384-开通账号后角色保留导购-真机验收.png')
} catch (e) {
  ok('FATAL', '探针执行异常：' + (e && e.message), false, '')
} finally {
  if (BROWSER) await BROWSER.close()
}

console.log('== v384 真机验收（线上产物 + 沙箱租户 9998）==')
for (const r of R) console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.id} ${r.label}${r.got ? '  ← 实际: ' + r.got : ''}`)
const nFail = R.filter((r) => !r.ok).length
console.log(`RESULT pass=${R.length - nFail} fail=${nFail}`)
process.exit(nFail === 0 ? 0 : 1)
