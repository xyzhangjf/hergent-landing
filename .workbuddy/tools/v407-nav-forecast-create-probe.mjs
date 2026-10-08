/**
 * v407 —— 「预报订单管理」弹窗撤掉重复「创建」按钮 · 只读真机探针
 *
 * 被验改动（v407，2026-10-08）：
 *   老板原话：「该按钮点击后会跳转到『本期预报』页面，而弹窗中已存在『本期预报』按钮，
 *              功能重复，因此无需保留此『创建』按钮。」
 *   改动 = `Shell.vue::NAV` 的「历史期次」条目删掉
 *          `create: { to: '/forecast', module: 'data', title: '新建本期预报（期次）' }`
 *          （它的 `to` 与上一行「本期预报」条目**同是 `/forecast`**）。
 *
 * 🔴 判别力自证（缺一不可，否则"零个按钮"可能只是选择器写错）：
 *   ① **插桩反证**：往弹窗里手插一个 `.sb-pop-new` ⇒ 计数必须变 1（证明选择器真能选中）。
 *   ② **同屏反例**：同一个侧栏里，进销存区的「＋创建」**必须仍在**（7 条）——
 *      证明「撤掉」是本区**数据**变了，不是 `.sb-pop-new` 选择器/模板/样式被一并删掉。
 *   ③ **跳转回归**：撤按钮不能连带条目 —— 「历史期次 / 本期预报」两条仍必须能点、且落到正确 URL。
 *   ④ **两个面都收敛**：桌面 `.sb-pop-new` 与手机抽屉 `.md-item-new` 同读 `x.create`
 *      ⇒ 桌面 0 条时手机该组也必须 0 条。
 *   ⑤ 零写入：整轮只允许 GET/HEAD。
 *
 * 运行：
 *   V407_BASE=https://hergent.cn \
 *   V407_TOKEN=$(ssh root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v407-nav-forecast-create-probe.mjs
 */
import { launch } from './lib/cdp-lite.mjs'

const BASE = process.env.V407_BASE || 'https://hergent.cn'
const TOKEN = process.env.V407_TOKEN || ''
const TENANT = '1'

const PASS = [], FAIL = []
const ok = (name, cond, detail = '') => {
  ;(cond ? PASS : FAIL).push(name)
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' | ' + detail : ''))
}
const note = (t) => console.log('    · ' + t)
const section = (t) => console.log('\n' + '─'.repeat(78) + '\n' + t + '\n' + '─'.repeat(78))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const INIT = `
;(function(){
  try {
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(TENANT)});
    localStorage.setItem('hergent_v2_csrf', 'probe-csrf');
    localStorage.setItem('hergent_v2_user', JSON.stringify({ id: 2, username: 'boss', role: 'boss', roles: ['boss'], name: '老板' }));
  } catch (e) {}
})();
;(function(){
  window.__WRITES = [];
  function log(m, u){
    try {
      if (String(u).indexOf('/api/') >= 0 && String(m).toUpperCase() !== 'GET' && String(m).toUpperCase() !== 'HEAD')
        window.__WRITES.push(String(m).toUpperCase() + ' ' + String(u).replace(/^https?:\\/\\/[^/]+/, ''));
    } catch (e) {}
  }
  var f = window.fetch;
  window.fetch = function(a, b){
    try { log((b && b.method) || (a && a.method) || 'GET', (typeof a === 'string') ? a : ((a && a.url) || '')); } catch (e) {}
    return f.apply(this, arguments);
  };
  var xo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u){ try { log(m, u); } catch (e) {} return xo.apply(this, arguments); };
})();
`

/* 打开某个一级区（按按钮文本） */
const clickArea = (name) => `(function(){
  var btns = Array.prototype.slice.call(document.querySelectorAll('.sb-area-btn'));
  var hit = btns.filter(function(b){ return b.textContent.indexOf(${JSON.stringify(name)}) >= 0 });
  if (!hit.length) return JSON.stringify({ ok: false, seen: btns.map(function(b){ return b.textContent.trim() }) });
  hit[0].click();
  return JSON.stringify({ ok: true });
})()`

/* 点弹窗里某个条目（按文本精确匹配） */
const clickItem = (text) => `(function(){
  var as = Array.prototype.slice.call(document.querySelectorAll('.sb-pop-item'));
  var hit = as.filter(function(a){ return a.textContent.trim() === ${JSON.stringify(text)} });
  if (!hit.length) return JSON.stringify({ ok: false, seen: as.map(function(a){ return a.textContent.trim() }) });
  hit[0].click();
  return JSON.stringify({ ok: true });
})()`

/* 采样当前弹窗：每行是否有「＋」，以及全弹窗「＋」条数 */
const POP_NEW = `(function(){
  var pop = document.querySelector('.sb-pop');
  if (!pop) return JSON.stringify({ open: false });
  var news = Array.prototype.slice.call(pop.querySelectorAll('.sb-pop-new'));
  return JSON.stringify({
    open: true,
    n: news.length,
    labels: news.map(function(a){ return a.getAttribute('aria-label') || a.textContent.trim() }),
    rows: Array.prototype.slice.call(pop.querySelectorAll('.sb-pop-row')).map(function(r){
      var it = r.querySelector('.sb-pop-item');
      return { name: it ? it.textContent.trim() : '', hasNew: !!r.querySelector('.sb-pop-new') };
    })
  });
})()`

/* 判别力自证：往当前弹窗第一行手插一个 .sb-pop-new，读计数后移除 */
const INJECT_ONE = `(function(){
  var pop = document.querySelector('.sb-pop');
  if (!pop) return JSON.stringify({ ok: false, why: 'no pop' });
  var row = pop.querySelector('.sb-pop-row');
  if (!row) return JSON.stringify({ ok: false, why: 'no row' });
  var before = pop.querySelectorAll('.sb-pop-new').length;
  var a = document.createElement('a');
  a.className = 'sb-pop-new'; a.textContent = '创建'; a.setAttribute('aria-label', 'ZZ_PROBE_INJECTED');
  row.appendChild(a);
  var injected = pop.querySelectorAll('.sb-pop-new').length;
  a.remove();
  var after = pop.querySelectorAll('.sb-pop-new').length;
  return JSON.stringify({ ok: true, before: before, injected: injected, after: after });
})()`

/* 当前页状态：URL + 标签栏标题 + 写入日志 */
const pageState = `(function(){
  return JSON.stringify({
    hash: location.hash,
    tabs: Array.prototype.slice.call(document.querySelectorAll('.tabbar .tab-item')).map(function(e){
      var t = e.querySelector('.tab-title'); return t ? t.textContent.trim() : '';
    }).filter(Boolean),
    writes: window.__WRITES || []
  });
})()`

const hardGo = async (p, hash, ms = 9000) => p.goto(BASE + '/?__r=' + Date.now() + hash, ms)

const main = async () => {
  if (!TOKEN) { console.error('!! 缺 V407_TOKEN'); process.exit(2) }
  console.log('目标：' + BASE + ' | 角色：boss | 浏览器：无头 Chrome')

  const browser = await launch({ headless: true, extraArgs: ['--no-proxy-server'] })
  const p = await browser.newPage()
  await p.enable()
  const sid = await p.addInitScript(INIT)

  // 固定桌面视口，避免侧栏被窄视口藏掉（`.sb-pop` 只在桌面渲染）
  await p.raw.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  })

  /* ═══ P0 登录态（不通过则后面全假红）═══ */
  section('P0 登录态自检')
  await hardGo(p, '#/workbench')
  const who = JSON.parse(await p.eval(`(async function(){
    try {
      var t = localStorage.getItem('hergent_v2_token') || '';
      var r = await fetch('/api/auth/permissions', { headers: { 'Authorization': 'Bearer ' + t, 'X-Tenant-Id': ${JSON.stringify(TENANT)}, 'X-Client': 'web' } });
      var b = null; try { b = await r.clone().json(); } catch (e) {}
      return JSON.stringify({ st: r.status, role: (b && b.user && b.user.role) || '' });
    } catch (e) { return JSON.stringify({ st: -1, err: String(e && e.message) }) }
  })()`))
  console.log('  /api/auth/permissions → ' + JSON.stringify(who))
  if (who.st !== 200) { console.log('🔴 未登录（status=' + who.st + '）—— 中止'); await browser.close(); process.exit(4) }
  ok('P0 登录态有效且角色 = boss', who.role === 'boss', JSON.stringify(who))

  /* ═══ P1 预报订单管理弹窗：零「＋创建」═══ */
  section('P1 「预报订单管理」弹窗 —— 「创建」按钮已撤')
  const c1 = JSON.parse(await p.eval(clickArea('预报订单管理')))
  ok('P1a 弹窗可打开', c1.ok === true, JSON.stringify(c1))
  await sleep(500)
  const fc = JSON.parse(await p.eval(POP_NEW))
  note('4 行：' + (fc.rows || []).map((r) => r.name + (r.hasNew ? '[有＋]' : '')).join(' · '))
  ok('P1b ★弹窗内 `.sb-pop-new`（「＋创建」）条数 = 0', fc.n === 0, 'n=' + fc.n + ' labels=' + JSON.stringify(fc.labels))
  ok('P1c ★逐行核对：4 行**没有任何一行**带「＋」',
    (fc.rows || []).length === 4 && fc.rows.every((r) => !r.hasNew), JSON.stringify(fc.rows))
  ok('P1d 4 个条目本身仍在（撤的是按钮，不是条目）',
    JSON.stringify((fc.rows || []).map((r) => r.name)) === JSON.stringify(['本期预报', '历史期次', '报单配置', '商品目标']),
    JSON.stringify((fc.rows || []).map((r) => r.name)))

  /* ═══ P2 判别力自证：插桩 + 反例对照 ═══ */
  section('P2 判别力自证（防"零个"来自选择器写错）')
  const inj = JSON.parse(await p.eval(INJECT_ONE))
  note('插桩前/插桩后/移除后 = ' + inj.before + ' / ' + inj.injected + ' / ' + inj.after)
  ok('P2a 自证①：手插一个 `.sb-pop-new` ⇒ 计数 0 → 1（选择器有判别力）',
    inj.ok === true && inj.before === 0 && inj.injected === 1, JSON.stringify(inj))
  ok('P2b 自证①续：移除后回到 0（证明 P1b 的 0 是真的）', inj.after === 0, String(inj.after))

  /* 反例对照：同一个侧栏、同一个模板下的进销存区，7 条「＋」必须还在 */
  await p.eval(clickArea('进销存'))   // 预报区仍开着 ⇒ 这次点击把它切到进销存
  await sleep(500)
  let psi = JSON.parse(await p.eval(POP_NEW))
  if (!psi.open) { await p.eval(clickArea('进销存')); await sleep(500); psi = JSON.parse(await p.eval(POP_NEW)) }
  note('进销存「＋」= ' + psi.n + '：' + JSON.stringify(psi.labels))
  ok('P2c ★反例对照：进销存区「＋创建」**仍在**（≥1 ⇒ 机制/模板/样式都没被删）',
    psi.open === true && psi.n >= 1, 'n=' + psi.n)
  ok('P2d 进销存「＋」= 7 条（采购2 / 自提2 / 车销2 / 调拨1）', psi.n === 7, 'n=' + psi.n + ' ' + JSON.stringify(psi.labels))

  /* ═══ P3 跳转逻辑未受影响 ═══ */
  section('P3 跳转逻辑回归（撤按钮不能连带条目）')
  await hardGo(p, '#/workbench')
  await sleep(900)
  await p.eval(clickArea('预报订单管理'))
  await sleep(400)
  const c3a = JSON.parse(await p.eval(clickItem('历史期次')))
  ok('P3a 「历史期次」条目可点', c3a.ok === true, JSON.stringify(c3a))
  await sleep(1800)
  const s3a = JSON.parse(await p.eval(pageState))
  note('落点：' + s3a.hash + ' | 标签栏：' + JSON.stringify(s3a.tabs))
  ok('P3b 点「历史期次」→ URL 带 tab=history', /tab=history/.test(String(s3a.hash)), String(s3a.hash))
  ok('P3c 点「历史期次」→ 标签栏标题 = 「历史期次」（URL 是唯一真相）',
    s3a.tabs.includes('历史期次'), JSON.stringify(s3a.tabs))

  await p.eval(clickArea('预报订单管理'))
  await sleep(400)
  const c3d = JSON.parse(await p.eval(clickItem('本期预报')))
  ok('P3d 「本期预报」条目可点（= 主表的唯一桌面入口）', c3d.ok === true, JSON.stringify(c3d))
  await sleep(1600)
  const s3d = JSON.parse(await p.eval(pageState))
  note('落点：' + s3d.hash + ' | 标签栏：' + JSON.stringify(s3d.tabs))
  ok('P3e 点「本期预报」→ URL 归一到 `#/forecast`（不带 tab）',
    /#\/forecast$/.test(String(s3d.hash)) && !/tab=/.test(String(s3d.hash)), String(s3d.hash))
  ok('P3f 点「本期预报」→ 标签栏标题 = 「本期预报」', s3d.tabs.includes('本期预报'), JSON.stringify(s3d.tabs))

  /* ═══ P4 手机 375：抽屉该组也必须零「＋」═══ */
  section('P4 手机 375px —— 抽屉「预报订单管理」组零「＋」（与桌面同一份数据源）')
  await p.raw.send('Emulation.setDeviceMetricsOverride', {
    width: 375, height: 812, deviceScaleFactor: 2, mobile: true,
  })
  /* 🔴 踩坑记录（首轮 P4 两条假红）：切 `mobile:true` 会触发**一次异步页面重载** ——
     重载会把 Pinia 的 `store.ui.mobileDrawer` 打回 false ⇒ 刚点开的抽屉被冲掉。
     故必须**重载之后再点**（下面 hardGo 把这一步显式化），不能"resize 完就点"。 */
  await sleep(600)
  await hardGo(p, '#/workbench')
  await sleep(1200)

  const openDrawer = `(function(){
    var b = Array.prototype.slice.call(document.querySelectorAll('.mnav-item')).filter(function(x){ return x.textContent.indexOf('更多') >= 0 });
    if (!b.length) return JSON.stringify({ ok: false, why: 'no mnav' });
    b[0].click(); return JSON.stringify({ ok: true });
  })()`
  const DRAW = `(function(){
    var sheet = document.querySelector('.md-sheet');
    if (!sheet) return JSON.stringify({ open: false });
    var rows = Array.prototype.slice.call(sheet.querySelectorAll('.md-row'));
    return JSON.stringify({
      open: true,
      rows: rows.map(function(r){
        var it = r.querySelector('.md-item');
        return { name: it ? it.textContent.trim() : '', hasNew: !!r.querySelector('.md-item-new') };
      })
    });
  })()`
  await p.eval(openDrawer)
  await sleep(900)
  let md = JSON.parse(await p.eval(DRAW))
  if (!md.open) { await p.eval(openDrawer); await sleep(900); md = JSON.parse(await p.eval(DRAW)) }
  const mdRows = md.rows || []
  const fcRows = mdRows.filter((r) => ['历史期次', '报单配置', '商品目标'].includes(r.name))
  const psiRows = mdRows.filter((r) => ['采购单', '采购退货单', '自提订单', '自提退单', '车销订单', '车销退单', '调拨单'].includes(r.name))
  note('抽屉行数 = ' + mdRows.length + ' | 预报三子页：' + JSON.stringify(fcRows))
  note('进销存条目：' + psiRows.length + ' 条，其中带「＋」' + psiRows.filter((r) => r.hasNew).length + ' 条')
  ok('P4a 手机抽屉可打开且含预报三子页', md.open === true && fcRows.length === 3, JSON.stringify(mdRows.map((r) => r.name)))
  /* ⚠️ 判据带上「恰好 3 条」—— 否则空数组会让 `every` 恒真 = 假绿 */
  ok('P4b ★手机端这三个子页**零「＋」**（与桌面同源，不存在"桌面撤了手机还在"）',
    fcRows.length === 3 && fcRows.every((r) => !r.hasNew), JSON.stringify(fcRows))
  ok('P4c 反例对照：手机端进销存条目仍有「＋」', psiRows.length > 0 && psiRows.some((r) => r.hasNew),
    JSON.stringify(psiRows))

  /* ═══ P5 零写入 + 零 console error ═══ */
  section('P5 零写入 + 运行期错误')
  const writes = await p.eval('window.__WRITES || []')
  note('全部非 GET 请求：' + (writes.length ? JSON.stringify(writes) : '（无）'))
  const KNOWN_READONLY = []
  const unexpected = writes.filter((w) => !KNOWN_READONLY.some((re) => re.test(w)))
  ok('P5a 无非预期写请求（只读探针）', unexpected.length === 0, JSON.stringify(unexpected))

  const errs = p.errors || []
  note('错误条数：' + errs.length)
  if (errs.length) errs.slice(0, 5).forEach((e) => note(String(e).slice(0, 200)))
  ok('P5b 无 console.error / 未捕获异常', errs.length === 0, errs.slice(0, 2).join(' ;; '))

  await p.removeInitScript(sid)
  await browser.close()

  section('汇总')
  console.log('PASS ' + PASS.length + ' / FAIL ' + FAIL.length)
  if (FAIL.length) { console.log('失败项：'); FAIL.forEach((f) => console.log('  - ' + f)) }
  process.exit(FAIL.length ? 1 : 0)
}

main().catch(async (e) => {
  console.error('探针异常：' + (e && e.message))
  process.exit(3)
})
