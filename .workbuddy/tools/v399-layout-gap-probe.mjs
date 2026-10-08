/**
 * v399 统一留白规范 —— 只读真机探针（生产 https://hergent.cn）
 *
 * 要回答的问题（老板原话）：
 *   「在进销存模块中创建各类单据时，界面左右两侧存在大量留白。」
 *   ⇒ 留白到底是多少？是不是结构性的（页级限宽）？基准页「本期预报」是多少？
 *
 * 🔴 判据（可量化、非观感）：
 *   ① 占宽比 = 页面实际宽 / 内容区可用宽。**<100% 即存在结构性留白**
 *      （差额就是被 max-width 挡掉的那部分 + 居中分出的左右空隙）。
 *   ② 左右空隙 gapL / gapR 应近似相等（差 ≤8px 记为滚动条/亚像素）；
 *      **同时**大于几像素 ⇒ 是"居中留白"，不是"没留白"。
 *   ③ 因果事实：直接读 `.page` 的 computed `max-width`。
 *      基准页应为 `none`；进销存修复前应为 `1200px`。
 *
 * 🔴 判别力自证（缺一不可，否则"跑通了"没有意义）：
 *   ① 本探针必须在**同一轮**里同时量到两组**预期相反**的数：
 *      /forecast（预期 ratio≈100、maxW=none）vs /inventory/*（预期 ratio≈71、maxW=1200px）。
 *      若两组数一模一样 ⇒ 探针没有区分力（例如 `.page` 选错、或页面没渲染出来），
 *      脚本会**主动 FAIL** 而不是给出一张好看的假表。
 *   ② 视口必须 ≥1600：1280 下 1200px 限宽只差 42px（≈3%），量不出问题；
 *      1920 下差 366px（≈24%）。所以主视口固定 1920，并另跑一次 1440 作对照。
 *   ③ 零写入：整轮只允许 GET/HEAD，出现任何写请求即失败（本探针是只读的）。
 *
 * 运行：
 *   V399_TOKEN=$(ssh -o BatchMode=yes root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   V399_EXPECT=after \        # before = 改前基线（进销存应被限宽）；after = 改后（应与基准同构）。缺省 after
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v399-layout-gap-probe.mjs
 */
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.V399_TOKEN || ''
const TENANT = '1'
/* 相位：before（改前基线）/ after（改后）。同一脚本跑两相位 = 真 A/B 对照。
   两相位的**期望是相反的** ⇒ 判据不可能恒真。 */
const EXPECT = process.env.V399_EXPECT || 'after'

const PASS = []
const FAIL = []
const ok = (name, cond, detail = '') => {
  ;(cond ? PASS : FAIL).push(name)
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' | ' + detail : ''))
}
const section = (t) => console.log('\n' + '─'.repeat(86) + '\n' + t + '\n' + '─'.repeat(86))
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

/* ── 留白量测：页面宽 / 内容区可用宽 / 左右空隙 / 占宽比 / max-width ── */
const MEASURE = `(function(){
  var out = { hash: location.hash, vp: window.innerWidth };
  var view = document.querySelector('.view-wrap');
  if (!view) { out.err = 'no .view-wrap'; return JSON.stringify(out); }
  var vs = getComputedStyle(view);
  var padL = parseFloat(vs.paddingLeft) || 0;
  var padR = parseFloat(vs.paddingRight) || 0;
  var vr = view.getBoundingClientRect();
  /* clientWidth 不含滚动条 ⇒ 内容区可用宽 = clientWidth - 左右内距 */
  var innerW = Math.round(view.clientWidth - padL - padR);
  out.viewW = Math.round(vr.width);
  out.padL = Math.round(padL);
  out.padR = Math.round(padR);
  out.innerW = innerW;

  var page = document.querySelector('.view-wrap .page');
  if (!page) {
    /* 兜底：有些页面**根本没有 .page**（自拍宽度的独立根容器，如 ZhoupuImport 的 .zp-wrap）。
       这不是"页面没渲染"，而是一种偏离规范的结构 ⇒ 用第一个元素子节点当"页根"来量，
       并打 viaFallback 标记，好让判据能区分「合规全宽 / 限宽 / 无容器」三种状态。 */
    var wrap = document.querySelector('.view-wrap');
    page = wrap ? wrap.firstElementChild : null;
    out.viaFallback = true;
  }
  if (!page) { out.err = 'no root element under .view-wrap'; return JSON.stringify(out); }
  var ps = getComputedStyle(page);
  var pr = page.getBoundingClientRect();
  out.pageTag = page.tagName.toLowerCase();
  out.pageCls = String(page.className).trim();
  out.pageW = Math.round(pr.width);
  out.pageH = Math.round(pr.height);
  out.painted = pr.height > 40;
  out.maxW = ps.maxWidth;
  out.marginL = Math.round(parseFloat(ps.marginLeft) || 0);
  var contentLeft = vr.left + padL;
  var contentRight = vr.left + view.clientWidth - padR;
  out.gapL = Math.round(pr.left - contentLeft);
  out.gapR = Math.round(contentRight - pr.right);
  out.ratio = innerW ? Math.round((pr.width / innerW) * 1000) / 10 : 0;

  /* 内层业务容器（进销存 .inv-page / 档案 .archive-panel …），看是否已铺满页容器 */
  var inv = document.querySelector('.view-wrap .inv-page');
  if (inv) out.invW = Math.round(inv.getBoundingClientRect().width);

  /* 页头是否渲染（判"页面真的画出来了"，避免把白屏量成 100%） */
  var h2 = document.querySelector('.view-wrap .page-hd h2');
  out.h2 = h2 ? h2.textContent.trim().slice(0, 24) : '';
  out.stateErr = !!document.querySelector('.state-error');
  return JSON.stringify(out);
})()`

const PAGES = [
  { hash: '#/forecast',                 label: '本期预报（基准）' },
  { hash: '#/inventory/purchase',       label: '进销存·采购单列表' },
  { hash: '#/inventory/purchase/new',   label: '进销存·新建采购单' },
  { hash: '#/inventory/sale/new',       label: '进销存·新建销售单' },
  { hash: '#/inventory/stock',          label: '进销存·库存查询' },
  { hash: '#/print',                    label: '打印（阅读型·拟保留限宽）' },
  { hash: '#/zhoupu-import',            label: '舟谱导入（自拍 960px）' }
]

const hardGo = async (p, hash, ms = 11000) => p.goto(BASE + '/?__r=' + Date.now() + hash, ms)
const gotoHash = async (p, hash, ms = 2600) => { await p.eval('location.hash = ' + JSON.stringify(hash)); await sleep(ms) }

const fmt = (m) => {
  if (m.err) return 'ERR ' + m.err
  return 'vp=' + m.vp + ' inner=' + String(m.innerW).padStart(4) +
    ' root=' + String(m.pageCls).padStart(22) +
    ' page=' + String(m.pageW).padStart(4) +
    ' maxW=' + String(m.maxW).padStart(6) +
    ' gapL=' + String(m.gapL).padStart(3) + ' gapR=' + String(m.gapR).padStart(3) +
    ' ratio=' + String(m.ratio).padStart(5) + '%' +
    (m.invW != null ? ' inv=' + m.invW : '') +
    (m.viaFallback ? ' ⚠无.page' : '') + (m.h2 ? ' h2=' + m.h2 : '') + (m.stateErr ? ' ⚠state-error' : '')
}

const main = async () => {
  const browser = await launch({ headless: true, extraArgs: ['--no-proxy-server'] })
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(INIT)

  /* ───────── P0 登录态 ───────── */
  section('P0 登录态自检')
  await p.raw.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
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

  /* ───────── P1 1920 广视口逐页量测（改前基线 = A 面） ───────── */
  const A = {}
  for (const pg of PAGES) {
    section('P1 @1920  ' + pg.label + '   ' + pg.hash)
    await gotoHash(p, pg.hash)
    let m = JSON.parse(await p.eval(MEASURE))
    /* SPA 懒加载 chunk：首次进入可能还在 loading，重取一次（最多 3 次） */
    for (let i = 0; i < 3 && (m.err || !m.painted); i++) {
      await sleep(2200)
      m = JSON.parse(await p.eval(MEASURE))
    }
    console.log('  ' + fmt(m))
    A[pg.hash] = m
    ok('P1 ' + pg.label + ' 页面已渲染（页根已画出）',
      !m.err && !!m.pageW && m.painted === true, fmt(m))
  }

  /* ───────── P2 ★基准 vs 进销存：两相位的期望**相反** ⇒ 判据不可能恒真 ───────── */
  section('P2 ★相位对照（V399_EXPECT=' + EXPECT + '）')
  const base = A['#/forecast']
  const invNew = A['#/inventory/purchase/new']
  console.log('  基准 /forecast       maxW=' + base.maxW + ' ratio=' + base.ratio + '%')
  console.log('  进销存 /purchase/new  maxW=' + invNew.maxW + ' ratio=' + invNew.ratio + '%')

  /* 不随相位变化的：基准页本身 */
  ok('P2 ★基准页 .page **无** max-width（全宽）', String(base.maxW) === 'none', 'maxW=' + base.maxW)
  ok('P2 ★基准页占宽比 ≈100%（无结构性留白）', base.ratio >= 99, 'ratio=' + base.ratio + '%')

  if (EXPECT === 'before') {
    ok('P2 ★[改前] 进销存 .page **有** max-width（留白根因）', String(invNew.maxW) !== 'none', 'maxW=' + invNew.maxW)
    ok('P2 ★[改前] 进销存占宽比明显 <100%（结构性留白被量到）', invNew.ratio > 0 && invNew.ratio < 95,
      'ratio=' + invNew.ratio + '%')
    ok('P2 ★[改前] 判据有区分力：两组 ratio 不相等', base.ratio !== invNew.ratio,
      base.ratio + '% vs ' + invNew.ratio + '%')
    ok('P2 ★[改前] 进销存左右留白近似对称（居中而非偏移）',
      Math.abs(invNew.gapL - invNew.gapR) <= 8, 'gapL=' + invNew.gapL + ' gapR=' + invNew.gapR)
  } else {
    ok('P2 ★[改后] 进销存 .page **无** max-width（限宽已去掉）', String(invNew.maxW) === 'none', 'maxW=' + invNew.maxW)
    ok('P2 ★[改后] 进销存占宽比 ≈100%（结构性留白已消除）', invNew.ratio >= 99, 'ratio=' + invNew.ratio + '%')
    ok('P2 ★[改后] 进销存左右留白为 0（与基准同构）',
      invNew.gapL <= 1 && invNew.gapR <= 1, 'gapL=' + invNew.gapL + ' gapR=' + invNew.gapR)
    ok('P2 ★[改后] 进销存几何 ≡ 基准几何（maxW 与 ratio 双等）',
      String(invNew.maxW) === String(base.maxW) && Math.abs(invNew.ratio - base.ratio) <= 0.5,
      'inv ' + invNew.maxW + '/' + invNew.ratio + '% vs base ' + base.maxW + '/' + base.ratio + '%')
    /* 8 个子页（本次量 4 个代表）应**全部**与基准同构，不许漏一个 */
    const invHashes = PAGES.filter(x => x.hash.indexOf('/inventory/') >= 0)
    const bad = invHashes.filter(x => {
      const m = A[x.hash]
      return !m || m.err || String(m.maxW) !== 'none' || m.ratio < 99
    })
    ok('P2 ★[改后] 进销存**全部 4 个代表页**都已全宽（无漏网）', bad.length === 0,
      bad.map(x => x.hash + '=' + (A[x.hash] && A[x.hash].ratio) + '%').join(' ') || '4/4 全宽')
  }

  /* 第三处偏离：舟谱导入 —— 改前连 `.page` 都没有、自己拍了 960px */
  const zp = A['#/zhoupu-import']
  if (zp && !zp.err) {
    console.log('  舟谱 /zhoupu-import  根=' + zp.pageCls + ' maxW=' + zp.maxW + ' pageW=' + zp.pageW +
      ' ratio=' + zp.ratio + '%' + (zp.viaFallback ? '（无 .page）' : ''))
    if (EXPECT === 'before') {
      ok('P2 ★[改前] 舟谱导入页根**不是** `.page`（自拍宽度的第三种偏离）',
        !!zp.viaFallback || String(zp.pageCls).indexOf('page') < 0, 'root=' + zp.pageCls)
    } else {
      ok('P2 ★[改后] 舟谱导入页根已是 `.page`（不再自拍宽度）',
        !zp.viaFallback && String(zp.pageCls).indexOf('page') >= 0, 'root=' + zp.pageCls)
      ok('P2 ★[改后] 舟谱导入无 max-width、占宽比 ≈100%',
        String(zp.maxW) === 'none' && zp.ratio >= 99, 'maxW=' + zp.maxW + ' ratio=' + zp.ratio + '%')
    }
  }

  /* 白名单：Print.vue 必须**仍然**限宽（改后不许被顺手改掉） */
  const pr = A['#/print']
  if (pr && !pr.err) {
    ok('P2 ★白名单：Print 仍保留 .page-default（1200px）', String(pr.maxW) === '1200px',
      'maxW=' + pr.maxW + ' ratio=' + pr.ratio + '%')
  }

  /* ───────── P3 1440 视口对照：说明为何必须在 1920 起判 ───────── */
  section('P3 @1440 对照（为什么判据必须在 ≥1600 视口取）')
  await p.raw.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  const B = {}
  for (const pg of PAGES.slice(0, 3)) {
    await gotoHash(p, pg.hash)
    const m = JSON.parse(await p.eval(MEASURE))
    console.log('  [' + pg.label + '] ' + fmt(m))
    B[pg.hash] = m
  }
  console.log('  ⇒ 1440 下基准与进销存差额 = ' +
    Math.abs((B['#/forecast'].pageW || 0) - (B['#/inventory/purchase/new'].pageW || 0)) + 'px；' +
    '1920 下 = ' + Math.abs((base.pageW || 0) - (invNew.pageW || 0)) + 'px')
  await p.raw.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })

  /* ───────── P4 零写入审计 ───────── */
  section('P4 零写入审计')
  const writes = JSON.parse(await p.eval('JSON.stringify(window.__WRITES || [])'))
  console.log('  写请求：' + JSON.stringify(writes))
  ok('P4 ★整轮零写请求（只读审计）', writes.length === 0, JSON.stringify(writes))

  const errs = (p.errors || []).filter(e => !/favicon|ResizeObserver loop/i.test(String(e)))
  console.log('  控制台错误：' + JSON.stringify(errs.slice(0, 6)))
  ok('P4 控制台无错误', errs.length === 0, JSON.stringify(errs.slice(0, 3)))

  /* ───────── 汇总表（供 A/B 对照直接引用） ───────── */
  section('汇总（相位 ' + EXPECT + ' @1920）')
  console.log('  ' + 'hash'.padEnd(26) + 'root'.padEnd(22) + 'maxW'.padStart(8) + 'pageW'.padStart(8) + 'innerW'.padStart(8) + 'ratio'.padStart(9) + '  gapL/gapR')
  for (const pg of PAGES) {
    const m = A[pg.hash] || {}
    console.log('  ' + pg.hash.padEnd(26) + String(m.pageCls || '-').padEnd(22) + String(m.maxW || '-').padStart(8) +
      String(m.pageW || '-').padStart(8) + String(m.innerW || '-').padStart(8) +
      (m.ratio != null ? String(m.ratio + '%').padStart(9) : '        -') +
      '  ' + (m.gapL != null ? m.gapL + '/' + m.gapR : '-') + (m.viaFallback ? '  ⚠无.page' : ''))
  }
  console.log('\n  JSON=' + JSON.stringify(A))

  await browser.close()
  console.log('\n' + '═'.repeat(86))
  console.log('PASS ' + PASS.length + ' / FAIL ' + FAIL.length)
  if (FAIL.length) { console.log('失败项：'); FAIL.forEach(f => console.log('  ✗ ' + f)) }
  process.exit(FAIL.length ? 1 : 0)
}

main().catch(e => { console.error('探针异常：', e); process.exit(3) })
