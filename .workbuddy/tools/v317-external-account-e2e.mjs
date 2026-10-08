/**
 * v317 外部客户账号 · 端到端只读探针（v2，含真根因回归）
 * ================================================================
 * 验的是什么（老板原话的四条子意图）：
 *   ① 员工档案「外部客户账号」**与员工同风格**（有「＋ 新建外部客户」按钮）
 *   ② 已开通的账号**必须展示出来**（现状：一个都看不到）
 *   ③ 报单配置的「报单人」下拉里**能选到外部客户**
 *   ④ 界面简洁美观（几何断言：按钮/表格/下拉不是隐形、不是 0 高）
 *
 * 🔴 真根因（v2 新增回归）：② 的直接原因是**数据源本身取不到**——
 *    `/api/users` 线上由 `routers/platform.py` 命中（`server.py` 那份是死路由），
 *    它返回 `{success,data:[…],total}`（经 `api()` 解包 = **裸数组**）且 **SELECT 里没有
 *    `external_ref`` ⇒ 前端「读 `d.users` + 按 `external_ref` 过滤」两个前提同时不成立 ⇒ 恒空。
 *    ⇒ 本探针必须**同时**证明：「新数据源被调用」**且**「旧数据源不再被调用」。
 *
 * 🔴 只读纪律：唯一写动作 = 页面内种 token（本地沙箱）。
 *    全程装非 GET 哨兵；相位 B 只**打开**表单抽屉读控件、读完即关，**绝不提交**。
 */
import fs from 'node:fs'
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.PROBE_TOKEN || ''
const OUT = process.env.PROBE_OUT
  || '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/outputs/v317-external'
if (!TOKEN) { console.error('缺少 PROBE_TOKEN'); process.exit(2) }
fs.mkdirSync(OUT, { recursive: true })

let pass = 0
let fail = 0
const fails = []
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '   → ' + detail : '')) }
  else { fail++; fails.push(name); console.log('  ❌ ' + name + (detail ? '   → ' + detail : '')) }
}
const rz = (s) => String(s == null ? '' : s).replace(/\s+/g, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 页面内带鉴权读接口（只读）。 */
const JS_GET = (path) => `(function(){var t=localStorage.getItem('hergent_v2_token')||'';`
  + `var tn=localStorage.getItem('hergent_v2_tenant')||'';`
  + `return fetch('${path}',{headers:{Authorization:'Bearer '+t,'X-Tenant-Id':tn}})`
  + `.then(function(r){return r.text().then(function(x){return JSON.stringify({status:r.status,body:x.slice(0,300000)})})})})()`

/* ---- 页面内：只记录不拦截（对照「调了谁」） ---- */
const JS_RECORDER = `(function(){
  window.__reqs = [];
  if (!window.__origFetch) window.__origFetch = window.fetch;
  window.fetch = function(u,o){
    var s = (typeof u === 'string') ? u : ((u && u.url) || '');
    var pr = window.__origFetch.apply(this, arguments);
    if (pr && pr.then) { pr = pr.then(function(r){ window.__reqs.push({u:s, s:r.status}); return r }); }
    return pr;
  };
  return 'recorder-installed';
})()`

/* ---- 页面内：记录 + 把 refs 桩成空名册（反例） ---- */
const JS_STUB_REFS = `(function(){
  window.__reqs = []; window.__stubCalls = 0;
  if (!window.__origFetch) window.__origFetch = window.fetch;
  window.fetch = function(u,o){
    var s = (typeof u === 'string') ? u : ((u && u.url) || '');
    if (s.indexOf('/api/report-mappings/refs') >= 0) {
      window.__stubCalls++;
      window.__reqs.push({u:s, s:200, stub:true});
      return Promise.resolve(new Response(
        JSON.stringify({success:true, employees:[], contacts:[], warehouses:[], externals:[]}),
        {status:200, headers:{'Content-Type':'application/json'}}));
    }
    var pr = window.__origFetch.apply(this, arguments);
    if (pr && pr.then) { pr = pr.then(function(r){ window.__reqs.push({u:s, s:r.status}); return r }); }
    return pr;
  };
  return 'stub-installed';
})()`

const JS_READ_REQS = 'JSON.stringify(window.__reqs || [])'
const JS_READ_EXT = `(function(){
  var panels = [].slice.call(document.querySelectorAll('.card.df-panel'));
  var ext = null;
  for (var i=0;i<panels.length;i++){ var b=panels[i].querySelector('.panel-hd.df-ph b');
    if (b && (b.innerText||'').trim()==='外部客户账号'){ ext=panels[i]; break } }
  var res = { found: !!ext, href: location.href, sbItems: document.querySelectorAll('.sb-item').length };
  if (!ext) return JSON.stringify(res);
  var btns = [].slice.call(ext.querySelectorAll('button'));
  var btn = null;
  for (var j=0;j<btns.length;j++){ if ((btns[j].innerText||'').indexOf('新建外部客户')>=0){ btn=btns[j]; break } }
  res.hasCreateBtn = !!btn;
  res.createBtnText = btn ? (btn.innerText||'').replace(/\\s+/g,' ').trim() : '';
  if (btn) { var br=btn.getBoundingClientRect(); res.btnGeom={w:Math.round(br.width),h:Math.round(br.height)} }
  res.phRightHasTag = !!(ext.querySelector('.df-ph-right .tag'));
  var tbl = ext.querySelector('table.tbl');
  res.hasTable = !!tbl;
  if (tbl) {
    res.headers = [].slice.call(tbl.querySelectorAll('thead th')).map(function(t){return (t.innerText||'').replace(/\\s+/g,' ').trim()});
    res.rows = [].slice.call(tbl.querySelectorAll('tbody tr')).map(function(tr){
      return [].slice.call(tr.querySelectorAll('td')).map(function(td){return (td.innerText||'').replace(/\\s+/g,' ').trim()});
    });
    var rr = tbl.getBoundingClientRect();
    res.tableGeom = {w:Math.round(rr.width), h:Math.round(rr.height)};
  } else {
    var e0 = ext.querySelector('.state-empty');
    res.emptyText = e0 ? (e0.innerText||'').trim() : '';
  }
  return JSON.stringify(res);
})()`

const JS_OPEN_DRAWER = `(function(){
  var bs = [].slice.call(document.querySelectorAll('button')).filter(function(b){
    return (b.innerText||'').replace(/\\s+/g,'') === '+新建配置' });
  if (bs.length !== 1) return JSON.stringify({cands: bs.length});
  bs[0].click();
  return JSON.stringify({cands: 1});
})()`

const JS_READ_SUBJECT = `(function(){
  var m = document.querySelector('.df-modal.edit-modal');
  var res = { modal: !!m };
  if (!m) { res.h2 = (document.querySelector('.page-hd h2')||{}).innerText || ''; return JSON.stringify(res) }
  var lbls = [].slice.call(m.querySelectorAll('label'));
  var lbl = null;
  for (var i=0;i<lbls.length;i++){
    if ((lbls[i].innerText||'').replace(/\\s+/g,'').indexOf('报单人') === 0) { lbl = lbls[i]; break } }
  res.labelFound = !!lbl;
  var sel = lbl ? lbl.parentNode.querySelector('select') : null;
  res.selFound = !!sel;
  if (sel) {
    res.groups = [].slice.call(sel.querySelectorAll('optgroup')).map(function(g){
      return { label: g.getAttribute('label')||'', opts: [].slice.call(g.querySelectorAll('option')).map(function(o){
        return { v:o.value, t:(o.innerText||'').replace(/\\s+/g,' ').trim() } }) } });
    res.attrNote = (m.querySelector('.al-note')||{}).innerText || '';
    var sr = sel.getBoundingClientRect();
    res.selGeom = { w:Math.round(sr.width), h:Math.round(sr.height) };
  }
  return JSON.stringify(res);
})()`

const JS_CLOSE_DRAWER = `(function(){
  var m = document.querySelector('.df-modal.edit-modal');
  if (!m) return 'no-modal';
  var x = m.querySelector('.df-x');
  if (!x) return 'no-close';
  x.click();
  return 'closed';
})()`

async function main() {
  const browser = await launch({ headless: true })
  const page = await browser.newPage()
  await page.enable()

  // 🔴 零写入哨兵（第一条就装）
  const writes = []
  try {
    await page.raw.send('Network.enable')
    page.raw.onEvent((msg) => {
      if (msg.method === 'Network.requestWillBeSent') {
        const r = msg.params.request || {}
        const m = String(r.method || '').toUpperCase()
        if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') writes.push(m + ' ' + String(r.url).slice(0, 120))
      }
    })
  } catch (e) { console.log('  (Network.enable 失败：' + e.message + ')') }

  const init = await page.addInitScript(
    "(function(){try{"
    + "localStorage.setItem('hergent_v2_token','" + TOKEN + "');"
    + "localStorage.setItem('hergent_v2_tenant','1');"
    + "localStorage.setItem('hergent_v2_user',JSON.stringify({id:1,username:'admin',display_name:'管理员',role:'admin'}));"
    + "}catch(e){}})()"
  )
  const t = () => Date.now()

  /* ================= 相位 A：员工档案（深链直进） ================= */
  console.log('\n【相位 A】员工档案「外部客户账号」区块（admin，深链直进）')
  await page.goto(BASE + '/?__probe=' + t() + '#/archive/employees', 10000)
  const A = JSON.parse(await page.eval(JS_READ_EXT))
  console.log('  href=' + A.href)
  ok(String(A.href).indexOf('#/archive/employees') >= 0, '深链真的落在 #/archive/employees', String(A.href))
  ok(A.sbItems > 0, '外壳正常（侧栏存在，未被 ErrorBoundary 顶掉）', 'sbItems=' + A.sbItems)
  ok(A.found === true, '找到「外部客户账号」面板')
  ok(A.hasCreateBtn === true, '面板内有「＋ 新建外部客户」按钮（与员工同风格）', 'btn=' + A.createBtnText)
  ok(!!(A.btnGeom && A.btnGeom.h > 0 && A.btnGeom.w > 0), '按钮几何非隐形', JSON.stringify(A.btnGeom))
  ok(A.phRightHasTag === true, '页头右侧保留说明标签（简洁口径）')
  ok(A.hasTable === true,
    '🔴 已开通账号**常驻展示**（零点击即渲染出表格 = 撤销了默认收起）',
    '表格几何=' + JSON.stringify(A.tableGeom))
  if (A.headers) ok(A.headers.indexOf('可报门店') >= 0, '表头含「可报门店」列', JSON.stringify(A.headers))
  if (A.tableGeom) ok(A.tableGeom.w >= 600, '表格宽度铺满（非塌陷）', 'w=' + A.tableGeom.w)
  await page.screenshot(OUT + '/01-员工档案-外部客户账号.png')

  /* ---- 期望值从**新数据源**现算（不写死） ---- */
  const refsRaw = JSON.parse(await page.eval(JS_GET('/api/report-mappings/refs')))
  const refs = JSON.parse(refsRaw.body || '{}')
  const extApi = Array.isArray(refs.externals) ? refs.externals : []
  ok(refsRaw.status === 200, 'GET /api/report-mappings/refs 对 admin 可达', 'status=' + refsRaw.status)
  ok(extApi.length >= 1, '本租户确有已开通的外部客户账号（否则本相位无判别力）', 'n=' + extApi.length)
  ok(extApi.every((x) => 'report_mapping_count' in x),
    '🔴 名册带上 `report_mapping_count`（v317 后端新增；缺了本相位判别力不足）',
    JSON.stringify(extApi.map((x) => x.report_mapping_count)))

  const domRows = A.rows || []
  ok(domRows.length === extApi.length,
    '🔴🔴 页面行数 == 接口条数（**这条就是老板报的「已开通账号没展示」**）',
    'DOM=' + domRows.length + ' API=' + extApi.length)
  const domAcc = domRows.map((r) => rz(r[1])).sort()
  const apiAcc = extApi.map((u) => rz(u.username)).sort()
  ok(JSON.stringify(domAcc) === JSON.stringify(apiAcc),
    '🔴 每行「登录账号」与接口逐字一致', 'DOM=' + JSON.stringify(domAcc) + ' API=' + JSON.stringify(apiAcc))
  const domName = domRows.map((r) => rz(r[0])).sort()
  const apiName = extApi.map((u) => rz(u.name)).sort()
  ok(JSON.stringify(domName) === JSON.stringify(apiName),
    '🔴 每行「客户名」与接口逐字一致（名字取不到也不回落空串）',
    'DOM=' + JSON.stringify(domName) + ' API=' + JSON.stringify(apiName))

  let mapOk = true
  const mapDetail = []
  for (const u of extApi) {
    const row = domRows.find((r) => rz(r[1]) === rz(u.username))
    if (!row) { mapOk = false; mapDetail.push(u.username + ':缺行'); continue }
    const c = u.report_mapping_count
    const want = (c === null || c === undefined) ? '—' : (Number(c) > 0 ? String(c) + '家' : '未配·去配置')
    if (rz(row[3]) !== rz(want)) { mapOk = false; mapDetail.push(u.username + ':DOM=' + rz(row[3]) + ' 期望=' + rz(want)) }
  }
  ok(mapOk, '「可报门店」与接口逐项一致（>0 → N 家 / =0 → 未配·去配置 / null → —）',
    mapDetail.length ? mapDetail.join('; ') : '全部一致')
  console.log('  实测行数据: ' + JSON.stringify(domRows))

  /* ============ 相位 A2：数据源归属（新源被调、旧源不再被调） ============ */
  console.log('\n【相位 A2】数据源归属 —— 证明修的是**取值源头**，不是把界面糊了一层')
  await page.goto(BASE + '/?__probe=' + t() + '#/workbench', 9000)
  await page.eval(JS_RECORDER)
  await page.eval("location.hash = '#/archive/employees'")
  await sleep(6500)
  const reqs = JSON.parse(await page.eval(JS_READ_REQS))
  const nRefs = reqs.filter((r) => r.u.indexOf('/api/report-mappings/refs') >= 0).length
  const nUsers = reqs.filter((r) => /\/api\/users(\?|$)/.test(r.u)).length
  const A2 = JSON.parse(await page.eval(JS_READ_EXT))
  console.log('  请求：refs=' + nRefs + '  users=' + nUsers + '  总 ' + reqs.length)
  ok(nRefs >= 1, '🔴 新数据源 `/api/report-mappings/refs` **真的被调用**', 'n=' + nRefs)
  ok(nUsers === 0, '🔴🔴 旧数据源 `/api/users` **一次都没被调用**（证明根因真被切掉）', 'n=' + nUsers)
  ok((A2.rows || []).length === extApi.length, 'SPA 内导航进入后行数同样正确', 'rows=' + (A2.rows || []).length)

  /* ============ 相位 A3（反例）：桩成空名册 ⇒ 应显示空态 ============ */
  console.log('\n【相位 A3-反例】把 refs 桩成空名册（证明列表是**数据驱动**而非模板写死）')
  await page.goto(BASE + '/?__probe=' + t() + '#/workbench', 9000)
  await page.eval(JS_STUB_REFS)
  await page.eval("location.hash = '#/archive/employees'")
  await sleep(6500)
  const A3 = JSON.parse(await page.eval(JS_READ_EXT))
  const stubInfo = JSON.parse(await page.eval(
    'JSON.stringify({calls: window.__stubCalls||0, hasTable: !!(document.querySelector(\'table.tbl\'))})'))
  ok(stubInfo.calls >= 1, '🔴 桩**真的被调用过**（否则「消失」可能只是页面没渲染）', 'calls=' + stubInfo.calls)
  ok(A3.hasTable === false, '空名册 ⇒ 表格消失', 'hasTable=' + A3.hasTable)
  ok(String(A3.emptyText || '').indexOf('还没有外部客户账号') >= 0, '空名册 ⇒ 显示引导空态', 'empty=' + A3.emptyText)
  await page.screenshot(OUT + '/02-反例-空名册显示空态.png')

  /* ================= 相位 B：报单配置 · 报单人下拉 ================= */
  console.log('\n【相位 B】预报订单管理 → 报单配置 · 报单人下拉（打开抽屉只读，绝不提交）')
  await page.goto(BASE + '/?__probe=' + t() + '#/forecast?tab=config', 11000)
  const B0 = JSON.parse(await page.eval(JS_READ_SUBJECT))
  ok(String((await page.eval('location.href'))).indexOf('tab=config') >= 0, '深链真的落在 ?tab=config')
  ok(B0.h2 === '报单配置', '页面标题 = 报单配置', 'h2=' + B0.h2)
  ok(B0.modal === false, '（前置）抽屉初始是关着的 —— 下面的读数才算「打开后才出现」', 'modal=' + B0.modal)
  const opened = JSON.parse(await page.eval(JS_OPEN_DRAWER))
  ok(opened.cands === 1, '「+ 新建配置」按钮在页面上**唯一**（容器级定位，不靠裸文字撞运气）', JSON.stringify(opened))
  await sleep(1200)
  const B = JSON.parse(await page.eval(JS_READ_SUBJECT))
  ok(B.modal === true, '抽屉已打开（新建配置）')
  ok(B.selFound === true, '抽屉内找到「报单人」下拉', 'labelFound=' + B.labelFound)
  const grp = (B.groups || []).find((g) => g.label.indexOf('外部客户') >= 0)
  ok(!!grp, '🔴 下拉里出现「外部客户（分销商）」分组',
    '分组=' + JSON.stringify((B.groups || []).map((g) => g.label)))
  if (grp) {
    const apiOpts = extApi.map((x) => rz(x.name)).sort()
    const domOpts = grp.opts.map((o) => rz(o.t)).sort()
    ok(JSON.stringify(domOpts) === JSON.stringify(apiOpts),
      '🔴 分组内选项与 `refs.externals` **逐字一致**',
      'DOM=' + JSON.stringify(domOpts) + ' API=' + JSON.stringify(apiOpts))
    const vals = grp.opts.map((o) => String(o.v)).sort()
    const expV = extApi.map((x) => 'external:' + x.id).sort()
    ok(JSON.stringify(vals) === JSON.stringify(expV),
      '🔴 选项值 = `external:<id>`（与员工 `employee:<id>` 同轴不同前缀）', JSON.stringify(vals))
  }
  const empGrp = (B.groups || []).find((g) => g.label === '员工')
  ok(!!empGrp && empGrp.opts.length > 0, '回归：原有「员工」分组仍在',
    empGrp ? 'n=' + empGrp.opts.length : 'missing')
  ok(B.selGeom && B.selGeom.h > 0, '下拉几何非隐形', JSON.stringify(B.selGeom))
  await page.screenshot(OUT + '/03-报单配置-报单人下拉.png')
  const closeRes = await page.eval(JS_CLOSE_DRAWER)
  ok(closeRes === 'closed', '抽屉已关闭（只读纪律：打开只为读控件，读完即关）', closeRes)

  const hdrs = JSON.parse(await page.eval(
    'JSON.stringify([].slice.call(document.querySelectorAll("table.tbl thead th")).map(function(t){return (t.innerText||"").replace(/\\s+/g," ").trim()}).slice(0,6))'))
  ok(hdrs.indexOf('报单人') >= 0, '列表表头已用「报单人」口径', JSON.stringify(hdrs))

  /* ================= 相位 C：干净度 ================= */
  console.log('\n【相位 C】干净度')
  const errs = page.errors.filter((e) => !/favicon|ResizeObserver/i.test(e))
  ok(errs.length === 0, '全程控制台 0 报错', errs.slice(0, 4).join(' | '))
  ok(writes.length === 0, '🔴 全程 0 个非 GET 请求（零写入）', writes.slice(0, 5).join(' | '))

  await page.removeInitScript(init)
  await browser.close()

  console.log('\n================ 结果 ================')
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  if (fail) console.log('失败项: ' + fails.join(' / '))
  console.log('截图目录: ' + OUT)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('探针异常：' + (e && e.stack || e)); process.exit(3) })
