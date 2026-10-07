/**
 * v394 进销存深色模式回归 —— 只读真机探针（生产 https://hergent.cn）
 *
 * 覆盖计划 §八 6.3 的剩余项：批次 5/6.1 只做了**桌面 + 手机**两相（v392 44/0、v393 32/32），
 * **深色模式从未验过**。本探针补这一相。
 *
 * 🔴 先分族（技能 hergent-dark-mode-adaptation §0）—— 本仓两族状态不同、不要混为一谈：
 *   · 族①（原生控件弹窗：日历/月份/时间/`<select>`/滚动条）＝ 浏览器画，页面 CSS 够不到，
 *     唯一手段是 `color-scheme`。本仓 **v321 已修**（`variables.css:12` / `:197` 各一行）
 *     ⇒ 本探针只需把它当**护栏**验（切深色后 `colorScheme` 必须变 `dark`），不再排查。
 *   · 族②（通知条/卡片/表格/徽标**白底或亮斑**）＝ 页面自己画，`getComputedStyle` 读得到
 *     ⇒ **本探针的主体**。
 *
 * 🔴 判据为什么用「有效亮度」而不是 `backgroundColor` 字面量：
 *   页面大量用**半透明**色（如 `--p-bg:rgba(6,182,212,.10)`）。直接读 `backgroundColor`
 *   会得到 `rgba(...,0.10)` —— 单看它像是"透明"，但**合成到深色底上就是一块可见的亮斑**。
 *   所以必须沿祖先链做 **alpha 合成**，把「元素实际呈现的底色」算出来再取亮度。
 *
 * 🔴 判别力怎么自证（三条，缺一不可 —— 缺任何一条，全绿都不算数）：
 *   ① **浅色侧基线**：同一批采样点在浅色下必须**大面积亮**（`lum >= 200`）。
 *      若浅色下也报"无亮块" ⇒ 采样选择器根本没落在实物上（例如整页没渲染出来）。
 *   ② **深色侧亮块计数**：所有采样点 `lum >= 100` 的个数必须为 **0**。
 *   ③ **反向自证（最硬的一条）**：在深色态下**注入**一个 `background:#fff` 的方块，
 *      探针**必须**把它报成亮块（期望 ≈ 255）。漏了这条，"0 个亮块"可能只是探针瞎了。
 *
 * 运行：
 *   V394_TOKEN=$(ssh root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v394-dark-mode-probe.mjs
 */
import fs from 'node:fs'
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.V394_TOKEN || ''
const TENANT = '1'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v394-进销存深色回归-2026-10-07'

/* 采样的进销存页面（覆盖「容器 + 三件套」三种形态） */
const PAGES = [
  ['工作台', '#/inventory'],
  ['采购列表', '#/inventory/purchase'],
  ['新建采购单', '#/inventory/purchase/new'],
  ['销售列表', '#/inventory/sale'],
  ['库存查询', '#/inventory/stock'],
]

/* 采样选择器：全部取自**真实存在**的全局件与进销存页面前缀（见 UI-SPEC §8.4） */
const SELS = [
  '.page', '.card', '.table-wrap', '.tbl thead th', '.tbl tbody td',
  '.tag', '.kpi-strip', '.kpi-val', '.main-tabs', '.main-tab.on',
  '.btn-primary', '.btn-ghost', '.input', '.fld',
  '.inv-page', '.ip-filter, .isl-filter, .is-filter', '.btn-sm', '.state-empty', '.state-error',
]

if (!TOKEN) { console.log('🔴 缺 V394_TOKEN 环境变量'); process.exit(2) }
fs.mkdirSync(OUT, { recursive: true })

const PASS = [], FAIL = []
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
  XMLHttpRequest.prototype.open = function(m, u){ log(m, u); return o.apply(this, arguments); };
})();
`

/* ── 采样：沿祖先链 alpha 合成得到「元素实际呈现的底色」→ 感知亮度 ── */
const SAMPLER = (sels) => `JSON.stringify((function(){
  function eff(el){
    var chain = [], n = el;
    while (n) { chain.unshift(n); n = n.parentElement; }
    var r = 255, g = 255, b = 255;                    /* 浏览器默认底 = 白 */
    for (var i = 0; i < chain.length; i++){
      var bg = getComputedStyle(chain[i]).backgroundColor;
      var m = bg.match(/rgba?\\(([^)]+)\\)/);
      if (!m) continue;
      var p = m[1].split(',').map(Number);
      var a = (p.length > 3) ? p[3] : 1;
      r = p[0] * a + r * (1 - a);
      g = p[1] * a + g * (1 - a);
      b = p[2] * a + b * (1 - a);
    }
    return [Math.round(r), Math.round(g), Math.round(b)];
  }
  function lum(rgb){ return Math.round(0.299*rgb[0] + 0.587*rgb[1] + 0.114*rgb[2]) }
  var SELS = ${JSON.stringify(sels)};
  var out = {
    scheme: getComputedStyle(document.documentElement).colorScheme,
    htmlCls: (document.documentElement.className || '').trim(),
    href: location.href,
    errBoundary: !!document.querySelector('.err-boundary, .error-boundary, .app-error'),
    pts: []
  };
  for (var i = 0; i < SELS.length; i++){
    var els = [].slice.call(document.querySelectorAll(SELS[i])).filter(function(e){
      var b = e.getBoundingClientRect(); return b.width > 4 && b.height > 4;
    });
    if (!els.length) { out.pts.push({ sel: SELS[i], n: 0 }); continue; }
    var info = els.map(function(e){
      var c = eff(e);
      var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
      return { lum: lum(c), sat: mx - mn };
    });
    /* 🔴 白块判据 = **亮 且 近灰**（lum >= 100 且 sat < 40）。
       第一版只判 lum >= 100 ⇒ 把 .btn-primary（品牌青底 #06b6d4，亮度 133、
       色度 206）误报成白块 —— 那是有意的彩色实底，不是「反色写法」造成的白块。
       加饱和度一维后：纯白/近灰（sat≈0）被抓，品牌色/语义色（sat 高）被放过。 */
    out.pts.push({
      sel: SELS[i], n: els.length,
      max: Math.max.apply(null, info.map(function(o){ return o.lum; })),
      bright:   info.filter(function(o){ return o.lum >= 100; }).length,
      whiteish: info.filter(function(o){ return o.lum >= 100 && o.sat < 40; }).length,
      colored:  info.filter(function(o){ return o.lum >= 100 && o.sat >= 40; }).length,
      white:    info.filter(function(o){ return o.lum >= 200; }).length,
    });
  }
  return out;
})())`

const setTheme = (p, t) => p.eval(`(function(){
  var de = document.documentElement;
  de.classList.remove('light', 'dark'); de.classList.add(${JSON.stringify(t)});
  return de.className;
})()`)

const hardGo = async (p, hash, ms = 9000) => p.goto(BASE + '/?__r=' + Date.now() + hash, ms)

const main = async () => {
  const browser = await launch({ headless: true, extraArgs: ['--no-proxy-server'] })
  const p = await browser.newPage()
  await p.enable()
  const idInit = await p.addInitScript(INIT)

  /* ───────────────── P0 登录态自检（必须第一条，否则后面全是假红） ───────────────── */
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
  if (who.st !== 200) {
    console.log('🔴 未登录 / 令牌失效（status=' + who.st + '）—— 中止')
    await browser.close(); process.exit(4)
  }
  ok('P0 登录态有效且角色=boss', who.role === 'boss', JSON.stringify(who))

  /* ───────────────── P1 逐页：浅色基线 vs 深色亮块 ───────────────── */
  section('P1 逐页采样 —— 浅色必须「大面积亮」（判别力基线），深色必须「零亮块」')
  let allLight = 0, allDarkWhite = 0, allColored = 0, darkDetail = []

  for (const [name, hash] of PAGES) {
    await hardGo(p, hash)
    await setTheme(p, 'light')
    await sleep(500)
    const L = JSON.parse(await p.eval(SAMPLER(SELS)))
    const Llive = L.pts.filter(x => x.n > 0)
    const Lwhite = Llive.reduce((s, x) => s + x.white, 0)
    const Ltotal = Llive.reduce((s, x) => s + x.n, 0)

    await setTheme(p, 'dark')
    await sleep(500)
    const D = JSON.parse(await p.eval(SAMPLER(SELS)))
    const Dlive = D.pts.filter(x => x.n > 0)
    const Dbright = Dlive.reduce((s, x) => s + x.bright, 0)
    const Dwhite = Dlive.reduce((s, x) => s + (x.whiteish || 0), 0)
    const Dcolored = Dlive.reduce((s, x) => s + (x.colored || 0), 0)
    const Dtotal = Dlive.reduce((s, x) => s + x.n, 0)

    allLight += Lwhite
    allDarkWhite += Dwhite
    allColored += Dcolored
    const worst = Dlive.map(x => [x.sel, x.max, (x.whiteish || 0)]).sort((a, b) => b[1] - a[1]).slice(0, 3)
    darkDetail.push({ page: name, whiteish: Dwhite, colored: Dcolored, total: Dtotal, worst })

    console.log(`  [${name}] 浅色 采样 ${Ltotal} 个元素 / 其中 ≥200 亮度 ${Lwhite} 个`
      + ` ｜ 深色 采样 ${Dtotal} ｜ 近白块 ${Dwhite} ｜ 彩色亮底 ${Dcolored} ｜ scheme=${D.scheme} cls=${D.htmlCls}`)

    ok(`P1 [${name}] 深色态 color-scheme=dark（族①护栏，v321）`, D.scheme === 'dark', 'scheme=' + D.scheme)
    ok(`P1 [${name}] 无兜底错误页`, !D.errBoundary)
    ok(`P1 [${name}] ★深色下零白块（近白 ${Dwhite}；彩色亮底 ${Dcolored} 不计）`, Dwhite === 0, 'worst=' + JSON.stringify(worst))

    if (name === '采购列表' || name === '库存查询') await p.screenshot(OUT + `/深色-${name}.png`)
  }

  ok('P1 ★浅色基线：确有元素是亮的（判别力前提；若为 0 ⇒ 采样没落在实物上）', allLight > 0, 'lightWhite=' + allLight)
  ok('P1 ★深色汇总：全 5 页、全采样点零白块（近白判据；彩色亮底不计）',
    allDarkWhite === 0, 'darkWhiteish=' + allDarkWhite + ' / colored=' + allColored)
  console.log('  深色各页最亮三处 [sel, maxLum, 近白数]：' + JSON.stringify(darkDetail))

  /* ───────────────── P2 反向自证：注入 #fff 方块，探针必须报它亮 ───────────────── */
  section('P2 判别力自证（最硬的一条）—— 深色下注入白块，探针必须抓到')
  await hardGo(p, '#/inventory/stock')
  await setTheme(p, 'dark')
  await sleep(400)
  await p.eval(`(function(){
    var d = document.createElement('div');
    d.id = '__probe_white';
    d.style.cssText = 'position:fixed;left:0;top:0;width:48px;height:48px;background:#ffffff;z-index:99999';
    document.body.appendChild(d);
  })()`)
  await sleep(300)
  const W = JSON.parse(await p.eval(SAMPLER(['#__probe_white', '.card'])))
  const wpt = W.pts.find(x => x.sel === '#__probe_white')
  const cpt = W.pts.find(x => x.sel === '.card')
  console.log('  注入白块 → ' + JSON.stringify(wpt) + ' ；同页 .card → ' + JSON.stringify(cpt))
  ok('P2 ★注入的 #fff 方块被报为白块（探针有判别力，否则 P1 的「零白块」不算数）',
    !!wpt && wpt.n === 1 && wpt.whiteish === 1 && wpt.max >= 250,
    JSON.stringify(wpt))
  ok('P2 同一次采样里 .card 仍是暗的（隔离出「探针抓的是真实合成色」）',
    !!cpt && cpt.n > 0 && cpt.whiteish === 0, JSON.stringify(cpt))
  await p.eval(`(function(){ var d = document.getElementById('__probe_white'); if (d) d.remove(); return 'ok'; })()`)

  /* ───────────────── P3 零写入 + 控制台 ───────────────── */
  section('P3 零写入自证（运行时事实）+ 控制台')
  const armed = await p.eval('Array.isArray(window.__WRITES)')
  ok('P3 写监控已安装（缺它「0 条」恒真）', armed === true, 'armed=' + armed)
  const writes = JSON.parse(await p.eval('JSON.stringify(window.__WRITES || [])'))
  const risky = writes.filter(w => /save|matrix|bulk|upsert|import|execute|close|delete|create|submit|update/i.test(w))
  console.log('  全程非 GET 的 /api/ 请求：' + JSON.stringify(writes))
  ok('P3 ★零业务写入', risky.length === 0, JSON.stringify(risky))
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
