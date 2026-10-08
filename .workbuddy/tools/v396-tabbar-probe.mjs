/**
 * v396 全局标签栏（对齐舟谱）+ 模块内页签退役 —— 只读真机探针（生产 https://hergent.cn）
 *
 * 老板拍板（2026-10-08，Q1–Q6）：
 *   Q1 A 刷新按钮在名称**左侧**（舟谱那个圆环确认就是刷新）
 *   Q2 B 关掉最后一个标签 ⇒ **回首页**
 *   Q3 A 模块内页签**退役**（本轮 5 处：进销存容器 / 档案 / 打印 / 目标与返利 / 货损核算）
 *   Q4 A 刷新浏览器后只还原当前那一个（内存态）
 *   Q5 B 放不下收进「更多」下拉；上限 18 个
 *   Q6 A 手机端维持现状（不出标签栏）
 *
 * 🔴 判别力自证（缺一不可，否则"全绿"没有意义）：
 *   ① 核心判据是**标签条数**：点击前 n0 ⇒ 点击后必须**恰好 n0+1**。
 *      若旧行为还在（点一条把整组页签铺出来），条数会不符 ⇒ 判据能抓到。
 *   ② 反向对照：断言目标页**没有** `.main-tabs`（退役前那里有一条固定页签条）。
 *   ③ 溢出判据看**真实几何**：标签多到放不下时，`.tab-more` 必须真的出现
 *      （不是"我写了 overflow 就当它会生效"）。
 *   ④ 零写入：整轮只允许 GET/HEAD，出现任何写请求即失败（本探针是只读的）。
 *
 * 运行：
 *   V396_TOKEN=$(ssh root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v396-tabbar-probe.mjs
 */
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.V396_TOKEN || ''
const TENANT = '1'

const PASS = []
const FAIL = []
const ok = (name, cond, detail = '') => {
  ;(cond ? PASS : FAIL).push(name)
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' | ' + detail : ''))
}
const section = (t) => console.log('\n' + '─'.repeat(78) + '\n' + t + '\n' + '─'.repeat(78))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

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
  XMLHttpRequest.prototype.open = function(m, u){ try { log(m, u); } catch (e) {} return o.apply(this, arguments); };
})();
`

/* ── 标签栏采样：条数 / 标题序列 / 激活项 / 三要素（⟳ 左、× 右）/ 溢出 ── */
const TABS = `(function(){
  var bar = document.querySelector('.tabbar');
  if (!bar) return JSON.stringify({ present: false });
  var items = Array.prototype.slice.call(document.querySelectorAll('.tb-strip .tab-item'));
  var titles = items.map(function(b){
    var t = b.querySelector('.tab-title');
    return t ? t.textContent.trim() : '';
  });
  var active = items.filter(function(b){ return b.classList.contains('on') });
  var refreshLeft = items.every(function(b){
    var kids = Array.prototype.slice.call(b.children);
    var r = b.querySelector('.tab-refresh'), t = b.querySelector('.tab-title');
    return r && t && kids.indexOf(r) >= 0 && kids.indexOf(r) < kids.indexOf(t);
  });
  return JSON.stringify({
    present: true,
    n: items.length,
    titles: titles,
    active: active.length ? (active[0].querySelector('.tab-title') || {}).textContent : '',
    activeCount: active.length,
    refreshLeft: refreshLeft,
    hasRefresh: items.every(function(b){ return !!b.querySelector('.tab-refresh') }),
    hasClose: items.every(function(b){ return !!b.querySelector('.tab-close') }),
    more: !!document.querySelector('.tab-more'),
    moreN: (document.querySelector('.tab-more-n') || {}).textContent || '',
    hidden: document.querySelectorAll('.tb-strip .tab-item').length
  });
})()`

/* 点侧栏某个一级区（点击固定展开，无需 hover） */
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

/* 弹窗里有哪些条目（用于验证"目标与返利"升级成职能区后 6 条齐全） */
const POP_ITEMS = `(function(){
  var pop = document.querySelector('.sb-pop');
  if (!pop) return JSON.stringify({ open: false, items: [] });
  var cols = Array.prototype.slice.call(pop.querySelectorAll('.sb-pop-col'));
  return JSON.stringify({
    open: true,
    cols: cols.map(function(c){
      var hd = c.querySelector('.sb-pop-hd');
      return { title: hd ? hd.textContent.trim() : '',
               items: Array.prototype.slice.call(c.querySelectorAll('.sb-pop-item')).map(function(a){ return a.textContent.trim() }) };
    })
  });
})()`

/* 当前页状态：hash / 页头 / 页内是否有 .main-tabs / 写入日志 */
const pageState = `(function(){
  var h2 = document.querySelector('.page-hd h2');
  return JSON.stringify({
    hash: location.hash,
    h2: h2 ? h2.textContent.trim() : '',
    mainTabs: document.querySelectorAll('.main-tabs').length,
    err: !!document.querySelector('.state-error'),
    writes: window.__WRITES || []
  });
})()`

const clickTabAt = (i) => `(function(){
  var items = document.querySelectorAll('.tb-strip .tab-item');
  if (!items[${i}]) return JSON.stringify({ ok: false, n: items.length });
  items[${i}].click();
  return JSON.stringify({ ok: true });
})()`

const closeTabAt = (i) => `(function(){
  var items = document.querySelectorAll('.tb-strip .tab-item');
  if (!items[${i}]) return JSON.stringify({ ok: false, n: items.length });
  var x = items[${i}].querySelector('.tab-close');
  if (!x) return JSON.stringify({ ok: false, why: 'no close btn' });
  x.click();
  return JSON.stringify({ ok: true, title: items[${i}].querySelector('.tab-title').textContent.trim() });
})()`

/* 按**标题**关标签 —— 比按索引稳（索引会随"上一个断言是否成立"漂移，
   本轮第一版就是因为把 index 写死成 1/0 而误报 4 条 FAIL）。 */
const closeTabByTitle = (title) => `(function(){
  var items = Array.prototype.slice.call(document.querySelectorAll('.tb-strip .tab-item'));
  var hit = items.filter(function(b){ return b.querySelector('.tab-title').textContent.trim() === ${JSON.stringify(title)} });
  if (!hit.length) return JSON.stringify({ ok: false, seen: items.map(function(b){ return b.querySelector('.tab-title').textContent.trim() }) });
  var x = hit[0].querySelector('.tab-close');
  if (!x) return JSON.stringify({ ok: false, why: 'no close btn' });
  x.click();
  return JSON.stringify({ ok: true, title: ${JSON.stringify(title)}, wasActive: hit[0].classList.contains('on') });
})()`

const rowCount = `JSON.stringify({ n: document.querySelectorAll('.tab-more-row').length })`

const clickMore = `(function(){
  var b = document.querySelector('.tab-more-btn');
  if (!b) return JSON.stringify({ ok: false });
  b.click();
  return JSON.stringify({ ok: true, rows: document.querySelectorAll('.tab-more-row').length });
})()`

const hardGo = async (p, hash, ms = 9000) => p.goto(BASE + '/?__r=' + Date.now() + hash, ms)
const gotoHash = async (p, hash, ms = 900) => { await p.eval('location.hash = ' + JSON.stringify(hash)); await sleep(ms) }

const main = async () => {
  const browser = await launch({ headless: true, extraArgs: ['--no-proxy-server'] })
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(INIT)
  await p.raw.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

  /* ───────── P0 登录态（必须第一条，否则后面全假红） ───────── */
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
  ok('P0 登录态有效且角色=boss', who.role === 'boss', JSON.stringify(who))

  /* ───────── P1 标签栏存在 + 初始恰好 1 个标签 + 三要素 ───────── */
  section('P1 标签栏：初始状态与三要素')
  await sleep(700)
  const t1 = JSON.parse(await p.eval(TABS))
  console.log('  标签栏 = ' + JSON.stringify(t1))
  ok('P1 标签栏存在（.tabbar 已渲染）', t1.present === true)
  ok('P1 ★初始**恰好 1 个**标签（打开历史语义，不是"模块整组"）', t1.n === 1, 'n=' + t1.n)
  ok('P1 初始标签标题 = 经营工作台', t1.titles && t1.titles[0] === '经营工作台', JSON.stringify(t1.titles))
  ok('P1 每个标签都有 ⟳ 刷新（Q1）', t1.hasRefresh === true)
  ok('P1 ★刷新在名称**左侧**（Q1 A）', t1.refreshLeft === true)
  ok('P1 每个标签都有 × 关闭', t1.hasClose === true)
  ok('P1 当前标签恰好一个高亮', t1.activeCount === 1, 'activeCount=' + t1.activeCount)

  /* ───────── P2 ★核心：点弹窗里一个字段 ⇒ 只开一个标签 ───────── */
  section('P2 点「档案管理 › 商品档案」—— 只开**一个**标签')
  const n0 = t1.n
  let r = JSON.parse(await p.eval(clickArea('档案管理')))
  ok('P2 侧栏「档案管理」区可展开', r.ok === true, JSON.stringify(r).slice(0, 120))
  await sleep(450)
  const popA = JSON.parse(await p.eval(POP_ITEMS))
  console.log('  弹窗列：' + JSON.stringify((popA.cols || []).map(c => c.title + '[' + c.items.join('、') + ']')))
  r = JSON.parse(await p.eval(clickItem('商品档案')))
  ok('P2 弹窗里能点到「商品档案」', r.ok === true, JSON.stringify(r).slice(0, 160))
  await sleep(1400)
  const t2 = JSON.parse(await p.eval(TABS))
  const s2 = JSON.parse(await p.eval(pageState))
  console.log('  标签 = ' + JSON.stringify(t2.titles) + ' / hash=' + s2.hash)
  ok('P2 ★标签数 = 之前 + 1（不是把整组页签铺出来）', t2.n === n0 + 1, n0 + ' → ' + t2.n + ' ' + JSON.stringify(t2.titles))
  ok('P2 新标签标题 = 商品档案', t2.active === '商品档案', 'active=' + t2.active)
  ok('P2 URL 落在 /archive/products', /#\/archive\/products/.test(s2.hash), s2.hash)
  /* 反向对照：退役前这里有一条固定页签条（.module-tabs / .main-tabs） */
  ok('P2 ★该页**没有**页内页签条（退役生效）', s2.mainTabs === 0 && !(await p.eval('!!document.querySelector(".module-tabs")')),
    'mainTabs=' + s2.mainTabs)

  /* ───────── P3 再点另一个字段 ⇒ 累积第二个标签 ───────── */
  section('P3 再点「客户档案」—— 标签**累积**（舟谱语义）')
  const n3base = t2.n
  await p.eval(clickArea('档案管理'))
  await sleep(400)
  r = JSON.parse(await p.eval(clickItem('客户档案')))
  ok('P3 弹窗里能点到「客户档案」', r.ok === true, JSON.stringify(r).slice(0, 160))
  await sleep(1400)
  const t3 = JSON.parse(await p.eval(TABS))
  console.log('  标签 = ' + JSON.stringify(t3.titles))
  ok('P3 ★标签数 = 之前 + 1（累积，不是替换）', t3.n === n3base + 1,
    n3base + ' → ' + t3.n + ' ' + JSON.stringify(t3.titles))
  ok('P3 三个标签 = 经营工作台 / 商品档案 / 客户档案',
    JSON.stringify(t3.titles) === JSON.stringify(['经营工作台', '商品档案', '客户档案']), JSON.stringify(t3.titles))
  ok('P3 当前标签 = 客户档案', t3.active === '客户档案', 'active=' + t3.active)

  /* ───────── P4 点已打开的字段 ⇒ 切过去，不重复开 ───────── */
  section('P4 再点「商品档案」—— 不重复开，切过去')
  await p.eval(clickArea('档案管理'))
  await sleep(400)
  await p.eval(clickItem('商品档案'))
  await sleep(1200)
  const t4 = JSON.parse(await p.eval(TABS))
  const s4 = JSON.parse(await p.eval(pageState))
  ok('P4 ★标签数不变（同一条目重开 = 切过去）', t4.n === t3.n, t3.n + ' → ' + t4.n + ' ' + JSON.stringify(t4.titles))
  ok('P4 当前标签切回 商品档案', t4.active === '商品档案', 'active=' + t4.active)
  ok('P4 URL 回到 /archive/products', /#\/archive\/products/.test(s4.hash), s4.hash)

  /* ───────── P5 关**非当前**标签 ⇒ 只移除，不导航 ───────── */
  section('P5 关掉非当前标签（客户档案）—— 只移除它')
  const before5 = JSON.parse(await p.eval(pageState))
  r = JSON.parse(await p.eval(closeTabByTitle('客户档案')))
  await sleep(900)
  const t5 = JSON.parse(await p.eval(TABS))
  const s5 = JSON.parse(await p.eval(pageState))
  ok('P5 关掉的确是「客户档案」，且它当时**不是**当前标签',
    r.ok === true && r.wasActive === false, JSON.stringify(r))
  ok('P5 ★标签数减 1', t5.n === t4.n - 1, t4.n + ' → ' + t5.n + ' ' + JSON.stringify(t5.titles))
  ok('P5 ★当前位置**没有**被踢走（关别人的标签不导航）', s5.hash === before5.hash,
    before5.hash + ' → ' + s5.hash)

  /* ───────── P6 关**当前**标签 ⇒ 去邻居 ───────── */
  section('P6 关掉当前标签（商品档案）—— 自动去邻居')
  r = JSON.parse(await p.eval(closeTabByTitle('商品档案')))
  await sleep(1300)
  const t6 = JSON.parse(await p.eval(TABS))
  const s6 = JSON.parse(await p.eval(pageState))
  console.log('  标签 = ' + JSON.stringify(t6.titles) + ' / hash=' + s6.hash)
  ok('P6 关的是**当前**标签「商品档案」', r.ok === true && r.wasActive === true, JSON.stringify(r))
  ok('P6 ★自动切到邻居并高亮它', t6.n === 1 && t6.active === t6.titles[0],
    JSON.stringify(t6.titles) + ' active=' + t6.active)
  ok('P6 URL 离开 /archive/products', !/#\/archive\/products/.test(s6.hash), s6.hash)

  /* ───────── P7 ★关掉最后一个 ⇒ 回首页（Q2 B） ───────── */
  section('P7 关掉最后一个标签 —— 回首页（Q2 B）')
  await p.eval('location.hash = "#/print?tab=settings"')
  await sleep(1200)
  const t7a = JSON.parse(await p.eval(TABS))
  ok('P7 预备：已开出第 2 个标签（打印设置）', t7a.n === 2 && t7a.active === '打印设置',
    'n=' + t7a.n + ' ' + JSON.stringify(t7a.titles))
  /* 先关掉「经营工作台」，只剩「打印设置」 */
  await p.eval(closeTabAt(0))
  await sleep(700)
  const t7b = JSON.parse(await p.eval(TABS))
  ok('P7 预备：只剩 1 个标签（打印设置）', t7b.n === 1 && t7b.active === '打印设置',
    'n=' + t7b.n + ' ' + JSON.stringify(t7b.titles))
  /* 关掉最后一个 ⇒ 必须回首页并**立刻开出**「经营工作台」标签（不会出现空白的 0 标签态） */
  await p.eval(closeTabAt(0))
  await sleep(1500)
  const t7c = JSON.parse(await p.eval(TABS))
  const s7 = JSON.parse(await p.eval(pageState))
  console.log('  关最后一个之后 → 标签 ' + JSON.stringify(t7c.titles) + ' / hash=' + s7.hash)
  ok('P7 ★关掉最后一个 ⇒ URL 回首页 /workbench', /#\/workbench/.test(s7.hash), s7.hash)
  ok('P7 ★并立刻开出「经营工作台」标签（不会停在 0 标签空白态）',
    t7c.n === 1 && t7c.titles[0] === '经营工作台', 'n=' + t7c.n + ' ' + JSON.stringify(t7c.titles))

  /* ───────── P8 目标与返利：升级为职能区 + 6 条直达 + 页内无页签 ───────── */
  section('P8「目标与返利」升级为职能区（退役页签的必需配套）')
  await hardGo(p, '#/rebate')
  await sleep(900)
  const s8a = JSON.parse(await p.eval(pageState))
  const t8a = JSON.parse(await p.eval(TABS))
  ok('P8 直达 /rebate 时标签标题 = 仪表盘（_default 归一）', t8a.active === '仪表盘', 'active=' + t8a.active)
  ok('P8 ★/rebate 页内**没有**页签条（退役生效）', s8a.mainTabs === 0, 'mainTabs=' + s8a.mainTabs)

  await p.eval(clickArea('目标与返利'))
  await sleep(500)
  const pop8 = JSON.parse(await p.eval(POP_ITEMS))
  const flat8 = (pop8.cols || []).reduce((a, c) => a.concat(c.items), [])
  console.log('  目标与返利弹窗：' + JSON.stringify(pop8.cols))
  ok('P8 ★弹窗 6 条子页齐全', ['仪表盘', '目标配置', '达成填报', '返利结算', '结算节奏', '厂家承诺'].every(x => flat8.indexOf(x) >= 0),
    JSON.stringify(flat8))
  const r8 = JSON.parse(await p.eval(clickItem('返利结算')))
  ok('P8 能点到「返利结算」', r8.ok === true, JSON.stringify(r8).slice(0, 160))
  await sleep(1600)
  const t8b = JSON.parse(await p.eval(TABS))
  const s8b = JSON.parse(await p.eval(pageState))
  console.log('  标签 = ' + JSON.stringify(t8b.titles) + ' / hash=' + s8b.hash)
  ok('P8 ★URL 带 ?tab=contracts', /tab=contracts/.test(s8b.hash), s8b.hash)
  ok('P8 ★标签标题 = 返利结算', t8b.active === '返利结算', 'active=' + t8b.active)
  ok('P8 ★标签数 = 2（仪表盘 + 返利结算，同 path 不同子页各一个标签）', t8b.n === 2,
    'n=' + t8b.n + ' ' + JSON.stringify(t8b.titles))
  ok('P8 返利结算页内也没有页签条', s8b.mainTabs === 0, 'mainTabs=' + s8b.mainTabs)

  /* ───────── P9 URL 归一：/rebate 与 /rebate?tab=dashboard 同一个标签 ───────── */
  section('P9 归一：省略 tab 与 ?tab=dashboard 视为**同一个**标签')
  const nBefore9 = t8b.n
  await gotoHash(p, '#/rebate?tab=dashboard', 1400)
  const t9 = JSON.parse(await p.eval(TABS))
  console.log('  标签 = ' + JSON.stringify(t9.titles))
  const dashCount = t9.titles.filter(x => x === '仪表盘').length
  ok('P9 ★「仪表盘」标签**只有一条**（无重复）', dashCount === 1, 'count=' + dashCount + ' ' + JSON.stringify(t9.titles))
  ok('P9 ★标签总数未增加', t9.n === nBefore9, nBefore9 + ' → ' + t9.n)

  /* ───────── P10 进销存：退役 + 4 条入口可达 ───────── */
  section('P10 进销存：页内页签已退役，4 条入口各自可达')
  await hardGo(p, '#/inventory/purchase')
  await sleep(1200)
  const s10 = JSON.parse(await p.eval(pageState))
  const t10 = JSON.parse(await p.eval(TABS))
  ok('P10 ★进销存列表页**没有**页签条', s10.mainTabs === 0, 'mainTabs=' + s10.mainTabs)
  ok('P10 标签标题取自路由 meta = 采购单', t10.active === '采购单', 'active=' + t10.active)

  /* ───────── P11 溢出：标签多到放不下 ⇒ 「更多」下拉（Q5 B） ───────── */
  section('P11 溢出收进「更多」下拉（Q5 B）')
  const routeSeq = [
    '#/print?tab=templates', '#/print?tab=settings', '#/print?tab=logs',
    '#/loss-accounting?tab=fill', '#/loss-accounting?tab=dashboard',
    '#/rebate?tab=rules', '#/rebate?tab=achv', '#/rebate?tab=settle',
    '#/rebate?tab=promises', '#/dashboard', '#/crm-none', '#/archive/brands',
    '#/archive/warehouses', '#/archive/suppliers'
  ]
  for (const h of routeSeq) await gotoHash(p, h, 620)
  const t11 = JSON.parse(await p.eval(TABS))
  console.log('  标签数 = ' + t11.n + ' / more=' + t11.more + ' / 隐藏 ' + t11.moreN + ' 条')
  ok('P11 标签已累积到 12 条以上', t11.n >= 12, 'n=' + t11.n)
  ok('P11 ★溢出时「更多」按钮真的出现（看真实几何，不是假设 CSS 生效）', t11.more === true,
    'more=' + t11.more + ' n=' + t11.n)
  if (t11.more) {
    const m = JSON.parse(await p.eval(clickMore))
    await sleep(350)          // ⚠️ 必须等一帧：Vue 渲染下拉要时间，立刻查会得到 0 行
    const rows = JSON.parse(await p.eval(rowCount))
    ok('P11 ★「更多」下拉里有被收起的标签', m.ok === true && rows.n > 0, JSON.stringify({ m, rows }))
    await p.eval('document.body.click()')
  }

  /* ───────── P12 手机端：标签栏不出（Q6 A） ───────── */
  section('P12 手机端（≤768px）标签栏隐藏（Q6 A）')
  await p.raw.send('Emulation.setDeviceMetricsOverride', { width: 414, height: 896, deviceScaleFactor: 2, mobile: true })
  await sleep(600)
  const mob = JSON.parse(await p.eval(`(function(){
    var bar = document.querySelector('.tabbar');
    var disp = bar ? getComputedStyle(bar).display : '(no bar)';
    return JSON.stringify({ exists: !!bar, display: disp });
  })()`))
  ok('P12 ★窄屏下标签栏 display:none', mob.display === 'none', JSON.stringify(mob))
  await p.raw.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(400)
  const desk = JSON.parse(await p.eval(`(function(){
    var bar = document.querySelector('.tabbar');
    return JSON.stringify({ display: bar ? getComputedStyle(bar).display : '(no bar)' });
  })()`))
  ok('P12 宽屏恢复显示（对照，证明上面不是恒真）', desk.display !== 'none', JSON.stringify(desk))

  /* ───────── P13 零写入 + 控制台 ───────── */
  section('P13 零写入 + 控制台')
  const fin = JSON.parse(await p.eval(pageState))
  const raw = fin.writes || []
  /* 🔴 唯一豁免：`POST /api/rebate-rules/simulate-batch`。
     它是**只读语义的计算接口**（后端 `_READ_ONLY_POST` 早把它列为只读，v335 处理过），
     由「目标与返利」页 `onMounted` 自动触发 —— 不是本轮改动引入的，也不写库。
     除它以外**任何**写请求都算失败（本探针是只读的）。 */
  const writes = raw.filter(w => !/simulate-batch/.test(w))
  console.log('  原始写请求：' + JSON.stringify(raw) + ' / 豁免后：' + JSON.stringify(writes))
  ok('P13 ★除已知只读计算接口外零写请求', writes.length === 0, JSON.stringify(writes))
  const errs = (p.errors || []).filter(e => !/favicon|ResizeObserver loop/i.test(String(e)))
  console.log('  控制台错误：' + JSON.stringify(errs.slice(0, 6)))
  ok('P13 控制台无错误', errs.length === 0, JSON.stringify(errs.slice(0, 3)))

  await browser.close()

  console.log('\n' + '═'.repeat(78))
  console.log('PASS ' + PASS.length + ' / FAIL ' + FAIL.length)
  if (FAIL.length) { console.log('失败项：'); FAIL.forEach(f => console.log('  ✗ ' + f)) }
  process.exit(FAIL.length ? 1 : 0)
}

main().catch(e => { console.error('探针异常：', e); process.exit(3) })
