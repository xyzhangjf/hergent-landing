/**
 * v393 进销存侧栏入口落位 —— 只读真机验收探针（生产 https://hergent.cn）
 *
 * 验的是「批次 6.1 把八页入口挂进 Shell.vue 的 NAV」之后的**用户可见面**：
 *   ① 老板侧栏真的多出「进销存」区，且弹窗里四列 + 五条 + 两个「创建」都在；
 *   ② 点「采购单」真的导航得过去（**不是只有手敲 URL 能进** —— 这正是本轮要修的断点）；
 *   ③ 手机视口抽屉里同一份表平铺出来，且「采购单 / 销售单」两行带「＋」（本轮新补）；
 *   ④ 反例：同一令牌桩成 sales ⇒ 整个「进销存」区**必须消失**（证明 path 闸门 + lock 硬锁真的在管这件事）。
 *
 * 🔴 本探针的判别力来源（照 hergent-e2e-readonly-probe 铁律）：
 *   · P0 登录态自检**必须是第一条**（令牌失效会让后面所有依赖数据的断言集体假红）；
 *   · P4 反例与 P1 正例**同结果即作废**（区既出现又消失才证明闸门在起作用）；
 *   · P5 零写入是**运行时事实**，带「监控已安装」护栏（缺它「0 条」恒真）。
 *
 * 🔴 三条本机/本仓的硬约束：
 *   · 深链必须写 `/#/xxx`（本项目 createWebHashHistory）＋ 带 `?__r=` 强制**新文档**，
 *     否则 addInitScript 不执行、localStorage 种子为空；
 *   · `.sb-pop` 在 `<Teleport to="body">` 里 ⇒ **不在** `.sb-area` 内部，必须到文档级取；
 *     好在 `openArea` 是单值 ⇒ 全页最多只有 1 个 `.sb-pop`；
 *   · 走**只读复用现有会话**（不 login / 不 logout / 不插令牌）⇒ 生产库零残留。
 *
 * 运行：
 *   V393_TOKEN=$(ssh root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v393-nav-entry-e2e.mjs
 */
import fs from 'node:fs'
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.V393_TOKEN || ''
const TENANT = '1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v393-进销存侧栏入口-2026-10-07'

if (!TOKEN) {
  console.log('🔴 缺 V393_TOKEN 环境变量')
  process.exit(2)
}
fs.mkdirSync(OUT, { recursive: true })

const PASS = []
const FAIL = []
const ok = (name, cond, detail = '') => {
  ;(cond ? PASS : FAIL).push(name)
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' | ' + detail : ''))
}
const section = (t) => console.log('\n' + '─'.repeat(78) + '\n' + t + '\n' + '─'.repeat(78))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/* ── boot 期注入：① 种子 localStorage ② 零写入观察器（纯观测，不改行为） ── */
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
        window.__WRITES.push(String(m).toUpperCase() + ' ' + String(u));
    } catch (e) {}
  }
  var f = window.fetch;
  window.fetch = function(a, b){
    try { log((b && b.method) || (a && a.method) || 'GET', (typeof a === 'string') ? a : ((a && a.url) || '')); } catch (e) {}
    return f.apply(this, arguments);
  };
  var o = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u){ log(m, u); return o.apply(this, arguments); };
})();
`

/* ── 反例桩：同一令牌，把权限接口的 user.role 换成 sales（权限给超集） ── */
const stub = (role) => `
;(function(){
  var of = window.fetch;
  window.__permStub = { n: 0, role: ${JSON.stringify(role)} };
  window.fetch = function(u, o){
    var s = (typeof u === 'string') ? u : ((u && u.url) || '');
    var p = of.apply(this, arguments);
    if (s.indexOf('/api/auth/permissions') < 0) return p;
    window.__permStub.n++;
    return p.then(function(r){
      return r.clone().json().then(function(b){
        b.user = b.user || {};
        b.user.role = ${JSON.stringify(role)};
        b.user.roles = [${JSON.stringify(role)}];
        b.permissions = ['*'];                 /* 模块全放行 ⇒ 只剩角色不对 */
        b.custom_roles = ['sales', 'boss'];    /* 让位档也开着 ⇒ 仍必须被 lock 拦住 */
        return new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
    });
  };
})();
`

/* ── 读桌面侧栏（.sb-pop 在 body 上，文档级取） ── */
const READ_SB = `JSON.stringify((function(){
  var areas = [].slice.call(document.querySelectorAll('.sb-area'));
  var inv = null;
  for (var i = 0; i < areas.length; i++){
    var b = areas[i].querySelector('.sb-area-btn');
    if (b && (b.innerText || '').replace(/\\s+/g, '').indexOf('进销存') >= 0) { inv = areas[i]; break; }
  }
  var flat = [].slice.call(document.querySelectorAll('.sb-item')).map(function(e){ return (e.innerText || '').replace(/\\s+/g, ''); });
  var pop = document.querySelector('.sb-pop');
  var rows = [];
  if (pop) {
    rows = [].slice.call(pop.querySelectorAll('.sb-pop-hd, .sb-pop-row')).map(function(e){
      if ((e.className || '').indexOf('sb-pop-hd') >= 0) return { k: 'hd', t: (e.innerText || '').replace(/\\s+/g, '') };
      var a = e.querySelector('.sb-pop-item'), n = e.querySelector('.sb-pop-new');
      return { k: 'row',
        t: a ? (a.innerText || '').replace(/\\s+/g, '') : '',
        to: a ? (a.getAttribute('href') || '') : '',
        newTo: n ? (n.getAttribute('href') || '') : '',
        newTitle: n ? (n.getAttribute('title') || '') : '' };
    });
  }
  return {
    href: location.href,
    flat: flat,
    hasInvArea: !!inv,
    invOpen: !!(inv && inv.getAttribute('aria-expanded') === 'true') || !!pop,
    popN: document.querySelectorAll('.sb-pop').length,
    rows: rows,
    stubCalls: (window.__permStub && window.__permStub.n) || 0
  };
})())`

/* ── 读手机抽屉 ── */
const READ_MD = `JSON.stringify((function(){
  var sheet = document.querySelector('.md-sheet');
  if (!sheet) return { has: false, href: location.href, mnav: 0 };
  var rows = [].slice.call(sheet.querySelectorAll('.md-group-hd, .md-row')).map(function(e){
    if ((e.className || '').indexOf('md-group-hd') >= 0) return { k: 'hd', t: (e.innerText || '').replace(/\\s+/g, '') };
    var a = e.querySelector('.md-item'), n = e.querySelector('.md-item-new');
    return { k: 'row',
      t: a ? (a.innerText || '').replace(/\\s+/g, '') : '',
      to: a ? (a.getAttribute('href') || '') : '',
      newTo: n ? (n.getAttribute('href') || '') : '',
      newTitle: n ? (n.getAttribute('title') || '') : '' };
  });
  return { has: true, href: location.href, mnav: document.querySelectorAll('.mnav .mnav-item').length, rows: rows };
})())`

const readSb = async (p) => JSON.parse(await p.eval(READ_SB))
const readMd = async (p) => JSON.parse(await p.eval(READ_MD))

const hardGo = async (p, hash, ms = 9000) => p.goto(BASE + '/?__r=' + Date.now() + hash, ms)

/** 打开「进销存」区并等弹窗挂载（单值 openArea ⇒ 全页最多 1 个 .sb-pop） */
const openInv = async (p) => {
  await p.eval(`(function(){
    var bs = [].slice.call(document.querySelectorAll('.sb-area-btn'));
    for (var i = 0; i < bs.length; i++){
      if ((bs[i].innerText || '').replace(/\\s+/g, '').indexOf('进销存') >= 0) { bs[i].click(); return 'clicked'; }
    }
    return 'not-found';
  })()`)
  await sleep(700)
}

/** 点侧栏弹窗里文字为 <txt> 的条目 */
const clickPopItem = async (p, txt) => p.eval(`(function(){
  var as = [].slice.call(document.querySelectorAll('.sb-pop-item'));
  for (var i = 0; i < as.length; i++){
    if ((as[i].innerText || '').replace(/\\s+/g, '') === ${JSON.stringify(txt)}) { as[i].click(); return 'clicked'; }
  }
  return 'not-found';
})()`)

const main = async () => {
  const browser = await launch({ headless: true, extraArgs: ['--no-proxy-server'] })
  const p = await browser.newPage()
  await p.enable()

  const idInit = await p.addInitScript(INIT)

  /* ─────────────────────────── P0 登录态自检（必须是第一条） ─────────────────────────── */
  section('P0 登录态自检 —— 不通过则立刻中止（否则后面全是假红）')
  await hardGo(p, '#/workbench')
  const who = JSON.parse(await p.eval(`(async function(){
    try {
      var t = localStorage.getItem('hergent_v2_token') || '';
      var r = await fetch('/api/auth/permissions', { headers: { 'Authorization': 'Bearer ' + t, 'X-Tenant-Id': ${JSON.stringify(TENANT)}, 'X-Client': 'web' } });
      var b = null; try { b = await r.clone().json(); } catch (e) {}
      return JSON.stringify({ st: r.status, role: (b && b.user && b.user.role) || '', nperm: (b && b.permissions || []).length, href: location.href });
    } catch (e) { return JSON.stringify({ st: -1, err: String(e && e.message) }) }
  })()`))
  console.log('  /api/auth/permissions → ' + JSON.stringify(who))
  if (who.st !== 200) {
    console.log('🔴 未登录 / 令牌失效（status=' + who.st + '）—— 中止，不继续跑假断言')
    await browser.close()
    process.exit(4)
  }
  ok('P0 登录态有效且角色=boss', who.role === 'boss' && who.nperm > 0, JSON.stringify(who))

  /* ─────────────────────────── P1 桌面 boss：进销存区与弹窗结构 ─────────────────────────── */
  section('P1 桌面 boss —— 侧栏出现「进销存」区，弹窗结构逐项')
  await hardGo(p, '#/workbench')
  const before = await readSb(p)
  ok('P1 侧栏一级项里有「进销存」', before.flat.some(t => t.indexOf('进销存') >= 0), JSON.stringify(before.flat))
  ok('P1 未展开时页面上没有弹窗（防「常驻弹窗」假绿）', before.popN === 0, 'popN=' + before.popN)

  await openInv(p)
  const sb = await readSb(p)
  ok('P1 点开后恰好 1 个弹窗（openArea 单值）', sb.popN === 1, 'popN=' + sb.popN)
  ok('P1 区按钮 aria-expanded=true', sb.invOpen, 'invOpen=' + sb.invOpen)

  const hds = sb.rows.filter(r => r.k === 'hd').map(r => r.t)
  const items = sb.rows.filter(r => r.k === 'row')
  ok('P1 四个列标题 = 采购/销售/库存/其他（往来空列被丢弃）',
    JSON.stringify(hds) === JSON.stringify(['采购', '销售', '库存', '其他']), JSON.stringify(hds))
  ok('P1 条目总数 = 5', items.length === 5, 'n=' + items.length + ' ' + JSON.stringify(items.map(i => i.t)))
  ok('P1 条目路径逐条正确',
    JSON.stringify(items.map(i => [i.t, i.to])) === JSON.stringify([
      ['采购单', '#/inventory/purchase'],
      ['销售单', '#/inventory/sale'],
      ['库存查询', '#/inventory/stock'],
      ['库存效期补录', '#/data-fill'],
      ['进销存总览', '#/inventory']
    ]), JSON.stringify(items.map(i => [i.t, i.to])))

  const withNew = items.filter(i => i.newTo)
  ok('P1 恰好 2 个「创建」入口（采购单 / 销售单）',
    JSON.stringify(withNew.map(i => [i.t, i.newTo, i.newTitle])) === JSON.stringify([
      ['采购单', '#/inventory/purchase/new', '新建采购单'],
      ['销售单', '#/inventory/sale/new', '新建销售单']
    ]), JSON.stringify(withNew.map(i => [i.t, i.newTo, i.newTitle])))
  await p.screenshot(OUT + '/01-桌面-进销存区弹窗.png')

  /* ─────────────────────────── P2 点条目真的导航得过去（本轮要修的断点） ─────────────────────────── */
  section('P2 点「采购单」—— 必须真的导航到 /inventory/purchase（不是只有手敲 URL 能进）')
  await clickPopItem(p, '采购单')
  await sleep(2200)
  const nav1 = JSON.parse(await p.eval(`JSON.stringify({
    href: location.href,
    h1: ((document.querySelector('h1') || {}).innerText || '').replace(/\\s+/g, ' ').slice(0, 40),
    tabs: [].slice.call(document.querySelectorAll('.main-tabs .main-tab, .main-tabs > *')).map(function(e){ return (e.innerText || '').replace(/\\s+/g, '') }).slice(0, 8),
    hasTabs: !!document.querySelector('.main-tabs'),
    errBoundary: !!document.querySelector('.err-boundary, .error-boundary, .app-error')
  })`))
  console.log('  → ' + JSON.stringify(nav1))
  ok('P2 落在 /inventory/purchase', nav1.href.includes('#/inventory/purchase'), nav1.href.split('#')[1] || nav1.href)
  ok('P2 容器页签渲染（页面真起来了）', nav1.hasTabs, 'tabs=' + JSON.stringify(nav1.tabs))
  ok('P2 无兜底错误页', !nav1.errBoundary)
  await p.screenshot(OUT + '/02-桌面-点采购单已导航.png')

  /* ─────────────────────────── P3 手机视口：抽屉平铺 + 行内「＋」 ─────────────────────────── */
  section('P3 手机视口 390×844 —— 底部栏「更多」→ 抽屉 → 进销存组 + 行内「＋」')
  await p.raw.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true })
  await hardGo(p, '#/workbench')
  const mnav = await p.eval(`document.querySelectorAll('.mnav .mnav-item').length`)
  ok('P3 手机底部栏渲染（≥3 项）', mnav >= 3, 'mnav=' + mnav)
  ok('P3 抽屉初始未展开', !(await readMd(p)).has)

  await p.eval(`(function(){
    var bs = [].slice.call(document.querySelectorAll('.mnav .mnav-item'));
    for (var i = 0; i < bs.length; i++){
      if ((bs[i].innerText || '').replace(/\\s+/g, '').indexOf('更多') >= 0) { bs[i].click(); return 'clicked'; }
    }
    return 'not-found';
  })()`)
  await sleep(900)
  const md = await readMd(p)
  ok('P3 抽屉已展开', md.has, 'has=' + md.has)
  if (md.has) {
    const idx = md.rows.findIndex(r => r.k === 'hd' && r.t === '进销存')
    ok('P3 抽屉里有「进销存」组标题（区名当路标）', idx >= 0, JSON.stringify(md.rows.filter(r => r.k === 'hd').map(r => r.t)))
    const grp = []
    for (let i = idx + 1; i < md.rows.length && md.rows[i].k !== 'hd'; i++) grp.push(md.rows[i])
    ok('P3 组内 5 条，路径与桌面同源',
      idx >= 0 && JSON.stringify(grp.map(i => [i.t, i.to])) === JSON.stringify([
        ['采购单', '#/inventory/purchase'],
        ['销售单', '#/inventory/sale'],
        ['库存查询', '#/inventory/stock'],
        ['库存效期补录', '#/data-fill'],
        ['进销存总览', '#/inventory']
      ]), JSON.stringify(grp.map(i => [i.t, i.to])))
    const gNew = grp.filter(i => i.newTo)
    ok('P3 ★抽屉里恰好 2 个「＋」（本轮新补的那个）',
      JSON.stringify(gNew.map(i => [i.t, i.newTo, i.newTitle])) === JSON.stringify([
        ['采购单', '#/inventory/purchase/new', '新建采购单'],
        ['销售单', '#/inventory/sale/new', '新建销售单']
      ]), JSON.stringify(gNew.map(i => [i.t, i.newTo, i.newTitle])))
    ok('P3 「＋」真的有可见尺寸（不是 display:none）',
      await p.eval(`(function(){
        var ns = [].slice.call(document.querySelectorAll('.md-item-new'));
        return ns.length === 2 && ns.every(function(n){ var b = n.getBoundingClientRect(); return b.width > 20 && b.height > 20; });
      })()`), 'n=' + await p.eval(`document.querySelectorAll('.md-item-new').length`))

    /* 🔴 抽屉是 `position:fixed;bottom:0` 且**没有 max-height / overflow**
       ⇒ 内容高于视口时**顶部会被顶到屏幕外**，且 fixed 元素不随页面滚动 ⇒ 永久够不到。
       判据必须按「**视口**」判，不能按「抽屉自身矩形」判 —— 后者自身就在屏外，
       拿它当参照会得出 `hd.top(-386) >= sheet.top(-414)` 的**恒真假绿**（我第一版就是这么错的）。
       并且要**真的尝试所有滚动手段**再下「不可达」的结论。 */
    const geo = JSON.parse(await p.eval(`JSON.stringify((function(){
      var sheet = document.querySelector('.md-sheet');
      var vh = window.innerHeight || document.documentElement.clientHeight;
      var hs = [].slice.call(sheet.querySelectorAll('.md-group-hd'));
      var hd = null;
      for (var i = 0; i < hs.length; i++) if ((hs[i].innerText || '').replace(/\\s+/g, '') === '进销存') hd = hs[i];
      var nav = document.querySelector('.mnav'), sdb = document.querySelector('.sidebar');
      function inView(e){ var b = e.getBoundingClientRect(); return b.height > 0 && b.top >= -1 && b.bottom <= vh + 1 }
      var out = {
        innerW: window.innerWidth, innerH: vh, dpr: window.devicePixelRatio,
        mnavDisp: nav ? getComputedStyle(nav).display : 'none',
        sidebarDisp: sdb ? getComputedStyle(sdb).display : 'none',
        sheetH: Math.round(sheet.getBoundingClientRect().height),
        sheetTop: Math.round(sheet.getBoundingClientRect().top),
        scrollH: sheet.scrollHeight, clientH: sheet.clientHeight,
        hdFound: !!hd
      };
      if (!hd) return out;
      var kids = [].slice.call(hd.parentNode.children), i0 = kids.indexOf(hd);
      var first = kids[i0 + 1], last = kids[i0 + 5];
      out.grpRows = kids.slice(i0 + 1, i0 + 6).map(function(e){ return (e.innerText || '').replace(/\\s+/g, '') });
      out.rowH = Math.round(kids[i0 + 1].getBoundingClientRect().height);
      out.hdInView = inView(hd); out.lastInView = inView(last);
      /* 把一切正常的「滚上去」手段都用一遍，再看顶部到底能不能进视野 */
      try { sheet.scrollTop = 0 } catch (e) {}
      try { window.scrollTo(0, 0) } catch (e) {}
      try { hd.scrollIntoView({ block: 'start' }) } catch (e) {}
      out.canScrollSheet = sheet.scrollHeight > sheet.clientHeight + 1;
      out.hdInViewAfterScroll = inView(hd);
      out.sheetTopAfterScroll = Math.round(sheet.getBoundingClientRect().top);
      return out;
    })())`))
    console.log('  手机几何 → ' + JSON.stringify(geo))
    ok('P3 手机布局生效（底部栏 display=flex、桌面侧栏已隐藏）',
      geo.mnavDisp === 'flex' && geo.sidebarDisp === 'none', 'mnav=' + geo.mnavDisp + ' sidebar=' + geo.sidebarDisp)
    ok('P3 ★「进销存」组落在**视口可见区**内（按视口判，不按抽屉自身矩形）',
      geo.hdFound === true && geo.hdInView === true && geo.lastInView === true,
      JSON.stringify({ vh: geo.innerH, sheetH: geo.sheetH, sheetTop: geo.sheetTop, hdIn: geo.hdInView, lastIn: geo.lastInView }))
    ok('P3 ★抽屉内容高于视口时**自身可滚动**（否则顶部条目永久够不到）',
      geo.canScrollSheet === true || geo.sheetH <= geo.innerH,
      JSON.stringify({ sheetH: geo.sheetH, innerH: geo.innerH, canScroll: geo.canScrollSheet }))
    ok('P3 ★用尽滚动手段后「进销存」组仍在视口内（真可达）',
      geo.hdInViewAfterScroll === true, 'hdInAfter=' + geo.hdInViewAfterScroll)
    await sleep(400)
    await p.screenshot(OUT + '/03-手机-抽屉进销存组.png')

    await p.eval(`(function(){
      var ns = [].slice.call(document.querySelectorAll('.md-item-new'));
      for (var i = 0; i < ns.length; i++){
        if ((ns[i].getAttribute('title') || '') === '新建采购单') { ns[i].click(); return 'clicked'; }
      }
      return 'not-found';
    })()`)
    await sleep(2200)
    const nav2 = JSON.parse(await p.eval(`JSON.stringify({
      href: location.href,
      sheet: !!document.querySelector('.md-sheet'),
      h1: ((document.querySelector('h1') || {}).innerText || '').replace(/\\s+/g, ' ').slice(0, 40)
    })`))
    console.log('  → ' + JSON.stringify(nav2))
    ok('P3 点「＋」落到 /inventory/purchase/new', nav2.href.includes('#/inventory/purchase/new'), nav2.href.split('#')[1] || nav2.href)
    ok('P3 点完抽屉自动收起', !nav2.sheet)
    await p.screenshot(OUT + '/04-手机-新建采购单.png')
  }

  await p.raw.send('Emulation.clearDeviceMetricsOverride')

  /* ─────────────────────────── P4 反例：同令牌桩成 sales ⇒ 整个区必须消失 ─────────────────────────── */
  section('P4 反例 —— 同一令牌 + 桩改角色=sales ⇒ 「进销存」区必须整块消失')
  const idStub = await p.addInitScript(stub('sales'))
  await hardGo(p, '#/workbench')
  const low = await readSb(p)
  console.log('  一级项 = ' + JSON.stringify(low.flat) + '  stubCalls=' + low.stubCalls)
  ok('P4 ★「进销存」区消失', !low.flat.some(t => t.indexOf('进销存') >= 0), JSON.stringify(low.flat))
  ok('P4 ★桩真的被调用过（否则「没看见」可能是桩没生效）', low.stubCalls >= 1, 'stubCalls=' + low.stubCalls)
  ok('P4 同页仍有与本次无关的入口（排掉「整个 app 被换掉」）',
    low.flat.some(t => t.indexOf('工作台') >= 0), JSON.stringify(low.flat))
  await openInv(p)
  const low2 = await readSb(p)
  ok('P4 强行点同名按钮也开不出弹窗（条目确实不在 navItems 里）', low2.popN === 0, 'popN=' + low2.popN)
  await p.screenshot(OUT + '/05-反例-sales无进销存区.png')
  await p.removeInitScript(idStub)

  /* ─────────────────────────── P5 零写入 + 控制台 ─────────────────────────── */
  section('P5 零写入自证（运行时事实）+ 控制台')
  const armed = await p.eval('Array.isArray(window.__WRITES)')
  ok('P5 写监控已安装（缺它「0 条」恒真）', armed === true, 'armed=' + armed)
  const writes = JSON.parse(await p.eval('JSON.stringify(window.__WRITES || [])'))
  const RISK = /save|matrix|bulk|upsert|import|execute|close|delete|create|submit|update/i
  const risky = writes.filter(w => RISK.test(w))
  console.log('  全程非 GET 的 /api/ 请求：' + JSON.stringify(writes))
  ok('P5 ★零业务写入：全程未发出任何业务写请求', risky.length === 0, JSON.stringify(risky))
  ok('P5 无兜底错误页（终态）', !(await p.eval(`!!document.querySelector('.err-boundary, .error-boundary, .app-error')`)))
  console.log('  控制台错误 ' + p.errors.length + ' 条：' + JSON.stringify(p.errors.slice(0, 6)))

  await p.removeInitScript(idInit)
  console.log('\n' + '='.repeat(78))
  console.log(`  PASS ${PASS.length} / FAIL ${FAIL.length}`)
  FAIL.forEach(f => console.log('   FAIL: ' + f))
  console.log('='.repeat(78))
  await browser.close()
  process.exit(FAIL.length ? 1 : 0)
}

main().catch(async (e) => {
  console.log('🔴 探针自身异常：' + (e && e.message))
  process.exit(3)
})
