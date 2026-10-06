/**
 * v383 真机验收 v2 —— 「新建员工点保存后姓名被清空」修复的端到端复现与验证。
 *
 * 环境：生产前端（hergent.cn 线上压缩产物）+ **隔离沙箱租户 9997**（克隆自 tenant_1）。
 *   · 写操作全部落在 `tenant_9997.db`，验完 `sandbox_tenant.py down --id 9997` 销毁；
 *   · 探针**自带安全断言**：凡写请求的 `X-Tenant-Id` 必须是 9997，否则判红（拒绝在真租户上写）。
 *
 * v2 修正（v1 的锅，与产品无关）：
 *   ① `ok()` 一律**四个实参**（v1 有几处把 id 与 label 并成一个参数 ⇒ 实参整体前移、
 *       label 位置收到布尔值 ⇒ 读数错位、把 PASS 报成 FAIL）；
 *   ② toast 只活约 3 秒 ⇒ 点击后**轮询读取**，不能等 3 秒再读一次；
 *   ③ `C4` 选择器收窄到项目真实的 `.toast`（v1 的 `.err` 命中了别处元素）。
 *
 * 用法：SBX_TOKEN=<token> node tools/v383-e2e-probe.mjs
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const TOKEN = process.env.SBX_TOKEN
const TENANT = '9997'
const BASE = 'https://hergent.cn'
const EMP_NAME = '沙箱验收员工v383'
const ACC_USER = '13800009997'
const ACC_PWD = 'Abcd1234'

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
    if (url.indexOf('/api/') >= 0 && rec.method !== 'GET') {
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

/** 点击后轮询 toast，命中任一片段即返回该 toast 文本 */
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
  ok('P2', '「＋ 添加员工」按钮存在且可见（= 沙箱 boss 有 hr/create 权限）', addBtn, addBtn)
  if (!addBtn) throw new Error('前置失败：进不了员工档案页，后续断言无意义')

  await page.eval("(function(){ window.__h.btn('＋添加员工').click(); return 1 })()")
  await sleep(900)

  const nameEl = await page.eval("(function(){ return !!window.__h.field('姓名') })()")
  ok('P3', '弹窗已打开且找到「姓名」输入框', nameEl, nameEl)

  const title0 = await page.eval("(function(){ var b=document.querySelector('.df-modal-hd b'); return b?b.textContent.trim():null })()")
  ok('P4', '弹窗标题处于「新建员工」态（前置）', title0 === '新建员工', title0)

  await page.eval("(function(){ window.__h.set(window.__h.field('姓名'), " + JSON.stringify(EMP_NAME) + "); return 1 })()")
  await sleep(400)
  const typed = await page.eval("(function(){ return window.__h.field('姓名').value })()")
  ok('P5', '姓名已填进输入框（前置）', typed === EMP_NAME, typed)

  const saveBtnEnabled = await page.eval("(function(){ var b=window.__h.btn('保存'); return !!b && !b.disabled })()")
  ok('P6', '「保存」按钮可用（前置）', saveBtnEnabled, saveBtnEnabled)

  // ---------- 点保存，并立刻轮询 toast ----------
  await page.eval("(function(){ window.__h.btn('保存').click(); return 1 })()")
  const saveToast = await pollToast(page, ['已创建员工', '保存失败', '请先点击', '请输入员工姓名'])
  ok('A0', '保存后出现「已创建员工」回执', !!saveToast && saveToast.indexOf('已创建员工') >= 0, saveToast)

  await sleep(1200)

  // ---------- 核心断言 ----------
  const afterName = await page.eval("(function(){ var el=window.__h.field('姓名'); return el?el.value:'<无输入框>' })()")
  ok('A1', '【核心】保存后姓名仍在输入框里（修复前为空串）', afterName === EMP_NAME, JSON.stringify(afterName))

  const title1 = await page.eval("(function(){ var b=document.querySelector('.df-modal-hd b'); return b?b.textContent.trim():null })()")
  ok('A2', '弹窗标题已切到「编辑员工 · <姓名>」', title1 === ('编辑员工 · ' + EMP_NAME), JSON.stringify(title1))

  const accCreate = await page.eval("(function(){ return !!document.querySelector('.df-acc-create') })()")
  ok('A3', '已渲染「开通账号」表单（= editTarget 带上了列表派生的 has_account）', accCreate, accCreate)

  const guardFired = await pollToast(page, ['请先点击'], 2, 100)
  ok('A4', '此阶段未出现我方守卫提示（= openEdit 收到的是完整档案，empId 可用）', guardFired === null, guardFired)

  // ---------- 直接为同一员工开通账号 ----------
  await page.eval("(function(){ window.__h.set(window.__h.field('手机号'), " + JSON.stringify(ACC_USER) + "); return 1 })()")
  await sleep(300)
  await page.eval("(function(){ window.__h.set(window.__h.field('初始密码'), " + JSON.stringify(ACC_PWD) + "); return 1 })()")
  await sleep(500)

  const openBtn = await page.eval("(function(){ var b=window.__h.btn('开通账号'); return b ? {found:true, disabled:b.disabled} : {found:false} })()")
  ok('A5', '「开通账号」按钮出现且可用', openBtn && openBtn.found && openBtn.disabled === false, JSON.stringify(openBtn))

  await page.eval("(function(){ window.__h.btn('开通账号').click(); return 1 })()")
  const accToast = await pollToast(page, ['账号已开通', '开通失败', '请先点击'])
  ok('C1', '开通账号后出现「账号已开通」回执', !!accToast && accToast.indexOf('账号已开通') >= 0, accToast)

  await sleep(1500)

  const tap = await page.eval('JSON.stringify(window.__tap.calls)')
  const calls = JSON.parse(tap || '[]')
  const empPost = calls.filter((c) => c.method === 'POST' && /\/api\/employees$/.test(c.url))
  const accPost = calls.filter((c) => c.method === 'POST' && c.url.indexOf('/api/forecast-submissions/staff-accounts') >= 0)

  ok('B1', '捕获到 1 次 POST /api/employees（新建员工）', empPost.length === 1, empPost.length + ' 次')
  ok('B2', '捕获到 1 次 POST /api/forecast-submissions/staff-accounts（开通账号）', accPost.length === 1, accPost.length + ' 次')

  const newId = empPost[0] && empPost[0].resp && Number(empPost[0].resp.employee_id)
  ok('B3', '后端返回了 employee_id（>0）', Number.isFinite(newId) && newId > 0, newId)

  const accBody = accPost[0] ? JSON.parse(accPost[0].body || '{}') : {}
  ok('B4', '【核心】开通账号请求的 employee_id == 新建返回的 id（不是 undefined / 0）',
    Number(accBody.employee_id) > 0 && Number(accBody.employee_id) === newId,
    'employee_id=' + accBody.employee_id + '，新建返回=' + newId)
  ok('B5', '开通账号请求的显示名 == 输入的姓名', accBody.display_name === EMP_NAME, JSON.stringify(accBody.display_name))
  ok('B6', '开通账号请求成功（200）', accPost[0] && accPost[0].status === 200, accPost[0] && accPost[0].status)

  // ---------- 沙箱安全断言 ----------
  const writes = calls.filter((c) => c.method !== 'GET' && c.method !== 'HEAD' && c.method !== 'OPTIONS')
  const wrong = writes.filter((c) => String(c.tenant) !== TENANT)
  ok('S1', '【安全】所有写请求都带 X-Tenant-Id=' + TENANT + '（未触碰真实租户）',
    writes.length > 0 && wrong.length === 0,
    '写请求 ' + writes.length + ' 条，越界 ' + wrong.length + ' 条' + (wrong.length ? '：' + JSON.stringify(wrong.map((c) => c.url)) : ''))

  // ---------- 最终态 ----------
  const bodyTxt = await page.eval('document.body.innerText.slice(0, 1500)')
  ok('C2', '页面仍显示该员工姓名（姓名未被清空的界面证据）', String(bodyTxt).indexOf(EMP_NAME) >= 0, '')
  ok('C3', '页面无 JS 异常', page.errors.length === 0, JSON.stringify(page.errors.slice(0, 3)))

  const errToasts = await page.eval("(function(){ return window.__h.toasts().filter(function(t){ return t.indexOf('失败')>=0 || t.indexOf('请输入')>=0 }) })()")
  ok('C4', '无错误 toast 残留', Array.isArray(errToasts) && errToasts.length === 0, JSON.stringify(errToasts))

  ok('C5', '全程只写入 2 次（新建员工 + 开通账号），无额外意外写', writes.length === 2, writes.length)

  await page.screenshot('/tmp/v383-e2e.png')
  await page.screenshot('/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v383-新建员工保存后姓名保留-真机验收.png')
} catch (e) {
  ok('FATAL', '探针执行异常：' + (e && e.message), false, '')
} finally {
  if (BROWSER) await BROWSER.close()
}

console.log('== v383 真机验收 v2（线上产物 + 沙箱租户 9997）==')
for (const r of R) console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.id} ${r.label}${r.got ? '  ← 实际: ' + r.got : ''}`)
const nFail = R.filter((r) => !r.ok).length
console.log(`RESULT pass=${R.length - nFail} fail=${nFail}`)
process.exit(nFail === 0 ? 0 : 1)
