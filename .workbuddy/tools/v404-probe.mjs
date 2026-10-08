/**
 * v404 采购订单详情页三页签（采购订单详情 / 货款 / 入库单）—— 只读真机探针
 * 目标：生产 https://hergent.cn  ·  租户 1  ·  角色 boss
 *
 * 本轮做了什么（对照舟谱三张截图）：
 *   ① 详情页从「单页」重做成 **三页签**（舟谱有「详情页 / 货款 / 入库单」三张）
 *   ② 后端补两条聚合端点：`/payments`（应付 + 付款流水）、`/inbound`（到货入库明细）
 *   ③ 新增付款登记 POST（自建 `purchase_payment_create`，**不是**复用 `fi.payment_create`
 *      —— 后者的 `ref_id` 语义是 `receivables.id`，传采购单 id 会改到**另一张应收行**）
 *
 * 🔴 判别力自证（缺一不可，否则「全绿」没有意义）：
 *   ① **P4 是本探针的命门**：vue-router 对「同 route record、只有 params 变化」会
 *      **复用组件实例、不重跑 setup**。若 `oid` 写成一次性常量，从单 9 点到单 10
 *      页面会**仍显示单 9**，且控制台**零报错**。所以 P4 走「只改 hash、不 reload」，
 *      断言内容**必须变**，并另加一条「必须 ≠ 旧值」的反向对照。
 *   ② **P1.10/1.11 是业务口径命门**：「没有」≠「是零」。
 *      历史导单只存表头、零明细 ⇒ 入库金额/应付金额必须显示 `—`，**不是** `¥0.00`。
 *      反例由 P3.5（有入库单但零明细时明细区仍是空态）与本条互补。
 *   ③ **P6.1** 反向对照：`?tab=zzz` 必须**回落 detail**，证明「页签确实受 query 驱动」，
 *      而不是「无论传什么都渲染同一个 pane」。
 *   ④ **P7 零写入**：整轮只允许 GET/HEAD，出现任何写请求即失败（本探针是只读的）。
 *
 * 运行：
 *   V404_TOKEN=$(ssh root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v404-probe.mjs
 */
import { launch } from './lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.V404_BASE || 'https://hergent.cn'
const TOKEN = process.env.V404_TOKEN || ''
const TENANT = '1'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v404'

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

/* ── 页面结构采样 ── */
const PAGE = `(function(){
  var q = function(s){ return document.querySelector(s) };
  var qa = function(s){ return Array.prototype.slice.call(document.querySelectorAll(s)) };
  var txt = function(el){ return el ? el.textContent.replace(/\\s+/g,' ').trim() : '' };
  var tabs = qa('.main-tabs .main-tab');
  var on = tabs.filter(function(b){ return b.classList.contains('on') });
  /* 金额行：label -> value */
  function rows(sel){
    var out = {};
    qa(sel).forEach(function(r){
      var lb = r.querySelector('.ipd-lb'), v = r.querySelector('span:nth-child(2), b');
      if (lb && v) out[txt(lb)] = txt(v);
    });
    return out;
  }
  return JSON.stringify({
    hash: location.hash,
    root: !!q('.inv-page.ipd'),
    h2: txt(q('.page-hd h2')),
    sub: txt(q('.page-sub')),
    statusTag: txt(q('.page-sub .tag')),
    tabCount: tabs.length,
    tabTexts: tabs.map(txt),
    activeTab: on.length ? txt(on[0]) : '',
    activeCount: on.length,
    paneCount: qa('.tab-pane').length,
    /* detail pane */
    detailHd: !!q('.ipd-hd'),
    money: rows('.ipd-money .ipd-m'),
    hint: txt(q('.ipd-hint')),
    emptyDetail: txt(q('.tab-pane .state-empty')),
    /* payments pane */
    payRoot: !!q('.ipd-pay'),
    payInfo: rows('.ipd-info .ipd-row'),
    payEmpty: txt(q('.ipd-flows .ipd-empty')),
    payBtn: (function(){ var b = q('.ipd-paybtn'); return b ? { disabled: !!b.disabled, text: txt(b) } : null })(),
    payHint: txt(q('.ipd-payhint')),
    /* 未结金额的染色（真欠钱才该红）—— 用「临时探针元素」把 --danger 解析成同口径 rgb 再比。
       ⚠️ 这里**返回对象**，不要再 JSON.stringify 一次：外层 PAGE 已经统一序列化了，
          套两层会让读到的 duePaint 变成**字符串** ⇒ duePaint.color 恒 undefined，
          判据静默恒真/恒假（本轮真踩过，两条判据因此误报 FAIL）。
       ⚠️ 注意本段在**模板串**里：注释中不可出现裸反引号（会把模板串截断，报 SyntaxError）。 */
    duePaint: (function(){
      var el = qa('.ipd-row-b .ipd-amt')[0];
      if (!el) return { present: false };
      var probe = document.createElement('span');
      probe.style.color = 'var(--danger)';
      document.body.appendChild(probe);
      var dangerRgb = getComputedStyle(probe).color;
      probe.parentNode.removeChild(probe);
      return {
        present: true,
        hasDueClass: el.classList.contains('ipd-amt-due'),
        color: getComputedStyle(el).color,
        dangerRgb: dangerRgb,
        text: txt(el)
      };
    })(),
    /* inbound pane */
    inbNote: txt(q('.ipd-inbnote')),
    inbFields: rows('.ipd-hd .ipd-f'),
    inbEmpty: txt(q('.tab-pane .ipd-empty')),
    /* 错误态 */
    errBox: txt(q('.state-error')),
    loading: !!q('.state-loading, .state-empty') && /加载中/.test(txt(q('.state-empty'))),
    writes: window.__WRITES || []
  });
})()`

const hardGo = async (p, hash, ms = 9000) => p.goto(BASE + '/?__r=' + Date.now() + hash, ms)
const gotoHash = async (p, hash, ms = 1500) => { await p.eval('location.hash = ' + JSON.stringify(hash)); await sleep(ms) }

/* 🔴 相位反转模式（`V404_BASE` 指向本地旧构建）**不写截图** ——
   否则反转跑会把正例的证据图覆盖掉（本轮真踩过一次，得重跑才刷回来）。 */
const REVERSAL = !!process.env.V404_BASE

const shot = async (p, name) => {
  if (REVERSAL) { console.log('  （反转模式，跳过截图 ' + name + '）'); return }
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true })
    await p.screenshot(SHOT_DIR + '/' + name + '.png')
    console.log('  截图 → ' + SHOT_DIR + '/' + name + '.png')
  } catch (e) { console.log('  截图失败 ' + name + '：' + e.message) }
}

const main = async () => {
  if (!TOKEN) { console.error('缺少 V404_TOKEN'); process.exit(2) }
  const browser = await launch({ headless: true, extraArgs: ['--no-proxy-server'] })
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(INIT)
  await p.raw.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

  /* ═══════ P0 登录态 ═══════ */
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

  /* ═══════ P1 详情页基线（单 9：已入库 / 零明细）═══════ */
  section('P1 采购单详情页基线（单 9 · 已入库 · 零明细）')
  await hardGo(p, '#/inventory/purchase/9')
  await sleep(1200)
  const d1 = JSON.parse(await p.eval(PAGE))
  console.log('  ' + JSON.stringify({ hash: d1.hash, h2: d1.h2, sub: d1.sub, tabs: d1.tabTexts, active: d1.activeTab }))
  console.log('  金额行 = ' + JSON.stringify(d1.money))
  ok('P1.1 页面根容器渲染（.inv-page.ipd）', d1.root === true)
  ok('P1.2 页头标题 = 采购单详情', d1.h2 === '采购单详情', d1.h2)
  ok('P1.3 页头副标题含单号 CD260628000002', /CD260628000002/.test(d1.sub), d1.sub)
  ok('P1.4 状态标签 = 已入库', d1.statusTag === '已入库', d1.statusTag)
  ok('P1.5 ★页签**恰好 3 个**（不是 2 也不是 4）', d1.tabCount === 3, 'tabCount=' + d1.tabCount)
  ok('P1.6 三个页签逐字 = 采购订单详情 / 货款 / 入库单',
    JSON.stringify(d1.tabTexts) === JSON.stringify(['采购订单详情', '货款', '入库单']), JSON.stringify(d1.tabTexts))
  ok('P1.7 缺省高亮 = 采购订单详情，且恰好 1 个高亮',
    d1.activeTab === '采购订单详情' && d1.activeCount === 1, 'active=' + d1.activeTab + ' n=' + d1.activeCount)
  ok('P1.8 ★同一时刻只渲染 1 个 pane（互斥，不是三个都挂着）', d1.paneCount === 1, 'paneCount=' + d1.paneCount)
  ok('P1.9 零明细空态可达（文案含「这张单没有商品明细」）', /这张单没有商品明细/.test(d1.emptyDetail), d1.emptyDetail.slice(0, 60))
  ok('P1.10 ★「没有」≠「是零」：入库金额显示 —— 而不是 ¥0.00',
    d1.money['入库金额'] === '—', '入库金额=' + JSON.stringify(d1.money['入库金额']))
  ok('P1.11 ★应付金额（无应付行）显示 —— 而不是 ¥0.00',
    d1.money['应付金额'] === '—', '应付金额=' + JSON.stringify(d1.money['应付金额']))
  ok('P1.12 订单金额正常显示 ¥150.00（对照，证明上两条不是恒 ——）',
    d1.money['订单金额'] === '¥150.00', '订单金额=' + JSON.stringify(d1.money['订单金额']))
  /* 🔴 v404b：这一单是 `received` 但库里**没有应付行**（舟谱历史导单从没走过 confirm）。
     同一屏上「应付都已生成」与「应付金额 —」自相矛盾 —— 必须两边一致。 */
  console.log('  状态提示 = ' + JSON.stringify(d1.hint))
  ok('P1.13 ★★★「已入库」不得谎称「应付已生成」：提示必须与「应付金额 —」一致',
    !/应付都已生成/.test(d1.hint), 'hint=' + JSON.stringify(d1.hint))
  ok('P1.14 ★★ 且必须把真相说出来（「没有对应的应付单」），不是删掉不提',
    /没有对应的应付单/.test(d1.hint), 'hint=' + JSON.stringify(d1.hint))
  ok('P1.15 反向对照：仍要肯定「库存已生成」那半句（不是把整句删了了事）',
    /库存已生成/.test(d1.hint), 'hint=' + JSON.stringify(d1.hint))
  await shot(p, '01-detail')

  /* ═══════ P2 货款页签 ═══════ */
  section('P2 「货款」页签')
  const r2 = JSON.parse(await p.eval(`(function(){
    var bs = Array.prototype.slice.call(document.querySelectorAll('.main-tabs .main-tab'));
    var h = bs.filter(function(b){ return b.textContent.trim() === '货款' })[0];
    if (!h) return JSON.stringify({ ok: false, seen: bs.map(function(b){ return b.textContent.trim() }) });
    h.click(); return JSON.stringify({ ok: true });
  })()`))
  ok('P2.1 能点到「货款」页签', r2.ok === true, JSON.stringify(r2))
  await sleep(1100)
  const d2 = JSON.parse(await p.eval(PAGE))
  console.log('  hash=' + d2.hash + ' / 订单信息=' + JSON.stringify(d2.payInfo))
  console.log('  付款按钮 = ' + JSON.stringify(d2.payBtn) + ' / 提示=' + JSON.stringify(d2.payHint))
  ok('P2.2 ★URL 带上 ?tab=payments（可分享 / 可后退）', /tab=payments/.test(d2.hash), d2.hash)
  ok('P2.3 货款面板渲染（.ipd-pay / .ipd-info）', d2.payRoot === true && Object.keys(d2.payInfo).length > 0, JSON.stringify(Object.keys(d2.payInfo)))
  ok('P2.4 该页签高亮 = 货款', d2.activeTab === '货款', d2.activeTab)
  ok('P2.5 ★切页签后仍只渲染 1 个 pane', d2.paneCount === 1, 'paneCount=' + d2.paneCount)
  ok('P2.6 ★应付金额仍显示 ——（与详情页同一口径）', d2.payInfo['应付金额'] === '—', JSON.stringify(d2.payInfo['应付金额']))
  ok('P2.7 未结金额 = ¥0.00（未结为 0 是「事实零」，该显示 0）',
    d2.payInfo['未结金额'] === '¥0.00', JSON.stringify(d2.payInfo['未结金额']))
  ok('P2.8 付款流水空态可达（「还没有付款记录。」）', /还没有付款记录/.test(d2.payEmpty), d2.payEmpty.slice(0, 60))
  ok('P2.9 ★未结=0 ⇒ 付款按钮 disabled（不可点空付款）',
    d2.payBtn && d2.payBtn.disabled === true, JSON.stringify(d2.payBtn))
  ok('P2.10 并给出人话原因（无应付行 ⇒ 说清是「没有应付单」，不谎称「已结清」）',
    /没有对应的应付单/.test(d2.payHint) && !/已经结清/.test(d2.payHint), d2.payHint)
  ok('P2.11 反向对照：详情页的「商品明细」空态**不在**（pane 真的切换了）',
    !/这张单没有商品明细/.test(d2.emptyDetail), JSON.stringify(d2.emptyDetail.slice(0, 40)))
  console.log('  未结金额染色 = ' + JSON.stringify(d2.duePaint))
  ok('P2.12 ★★未结=0 时**不得**把 ¥0.00 染成告急红（判据看真实计算色，不看类名）',
    d2.duePaint.present && d2.duePaint.text === '¥0.00' && d2.duePaint.color !== d2.duePaint.dangerRgb,
    JSON.stringify(d2.duePaint))
  ok('P2.13 判据自证：`--danger` 确实能解析出 rgb（否则 P2.12 恒真，形同虚设）',
    /^rgb/.test(d2.duePaint.dangerRgb || ''), 'dangerRgb=' + JSON.stringify(d2.duePaint.dangerRgb))
  await shot(p, '02-payments')

  /* ═══════ P3 入库单页签 ═══════ */
  section('P3 「入库单」页签')
  const r3 = JSON.parse(await p.eval(`(function(){
    var bs = Array.prototype.slice.call(document.querySelectorAll('.main-tabs .main-tab'));
    var h = bs.filter(function(b){ return b.textContent.trim() === '入库单' })[0];
    if (!h) return JSON.stringify({ ok: false });
    h.click(); return JSON.stringify({ ok: true });
  })()`))
  ok('P3.1 能点到「入库单」页签', r3.ok === true, JSON.stringify(r3))
  await sleep(1100)
  const d3 = JSON.parse(await p.eval(PAGE))
  console.log('  hash=' + d3.hash + ' / 单头=' + JSON.stringify(d3.inbFields))
  ok('P3.2 ★URL 带上 ?tab=inbound', /tab=inbound/.test(d3.hash), d3.hash)
  ok('P3.3 ★入库单号由源单派生：CD260628000002 → RK260628000002',
    d3.inbFields['入库单号'] === 'RK260628000002', JSON.stringify(d3.inbFields['入库单号']))
  ok('P3.4 源订单号 = CD260628000002', d3.inbFields['源订单号'] === 'CD260628000002', JSON.stringify(d3.inbFields['源订单号']))
  ok('P3.5 派生口径有可见说明（不是凭空冒一个号）',
    /入库单号由源订单号生成/.test(d3.inbNote), d3.inbNote.slice(0, 70))
  ok('P3.6 该页签高亮 = 入库单', d3.activeTab === '入库单', d3.activeTab)
  await shot(p, '03-inbound')

  /* ═══════ P4 ★★ 命门：路由参数变化不 reload，内容必须更新 ═══════ */
  section('P4 ★★ 单 9 → 单 10（只改 hash、不重载）—— 内容必须跟着变')
  ok('P4.1 切前基线确实是单 9', /CD260628000002/.test(d3.sub) && d3.inbFields['入库单号'] === 'RK260628000002',
    'sub=' + d3.sub + ' inb=' + d3.inbFields['入库单号'])
  await gotoHash(p, '#/inventory/purchase/10?tab=inbound', 1600)
  const d4 = JSON.parse(await p.eval(PAGE))
  console.log('  hash=' + d4.hash + ' / sub=' + d4.sub + ' / 入库单号=' + JSON.stringify(d4.inbFields['入库单号']))
  ok('P4.2 ★★ 页头单号已变 → CD260628000001（证明 oid 是 computed+watch，不是一次性常量）',
    /CD260628000001/.test(d4.sub), 'sub=' + d4.sub)
  ok('P4.3 ★★ 入库单号随之变 → RK260628000001（三个端点都重取了，不是只换了个标题）',
    d4.inbFields['入库单号'] === 'RK260628000001', JSON.stringify(d4.inbFields['入库单号']))
  ok('P4.4 反向对照：**不等于**旧的 RK260628000002（证明 P4.3 的判据有判别力）',
    d4.inbFields['入库单号'] !== 'RK260628000002')
  ok('P4.5 切页签语义在换单后仍生效（还停在入库单）', d4.activeTab === '入库单', d4.activeTab)
  await shot(p, '04-order10-inbound')

  /* ═══════ P5 草稿单的人话空态 ═══════ */
  section('P5 草稿单（167）入库单页签 —— 「没有」要说人话')
  await hardGo(p, '#/inventory/purchase/167?tab=inbound')
  await sleep(1400)
  const d5 = JSON.parse(await p.eval(PAGE))
  console.log('  ' + JSON.stringify({ sub: d5.sub, status: d5.statusTag, empty: d5.inbEmpty, note: d5.inbNote }))
  ok('P5.1 草稿单状态标签 = 草稿', d5.statusTag === '草稿', d5.statusTag)
  ok('P5.2 ★空态给的是人话理由「这张单还是草稿，没有入库单。」',
    /这张单还是草稿，没有入库单/.test(d5.inbEmpty), d5.inbEmpty.slice(0, 70))
  ok('P5.3 反向对照：没有入库单 ⇒ 派生说明句**不该**出现',
    !/入库单号由源订单号生成/.test(d5.inbNote), JSON.stringify(d5.inbNote.slice(0, 40)))
  await shot(p, '05-draft-inbound')
  /* 草稿单在「货款」页的应付口径 —— 必须切到货款页才读得到（单页签互斥） */
  await p.eval(`(function(){
    var bs = Array.prototype.slice.call(document.querySelectorAll('.main-tabs .main-tab'));
    var h = bs.filter(function(b){ return b.textContent.trim() === '货款' })[0];
    if (h) h.click();
  })()`)
  await sleep(1000)
  const d5b = JSON.parse(await p.eval(PAGE))
  ok('P5.4 草稿单应付金额也是 ——（没有应付行，不是 ¥0.00）',
    d5b.payInfo['应付金额'] === '—', '应付=' + JSON.stringify(d5b.payInfo['应付金额']))
  ok('P5.5 草稿单未结=0 时付款按钮 disabled（草稿不该能直接付款）',
    d5b.payBtn && d5b.payBtn.disabled === true, JSON.stringify(d5b.payBtn))

  /* ═══════ P6 判别力自证（反例）═══════ */
  section('P6 判别力自证：非法 tab 回落 + 直链可分享 + 错误态可达')
  await hardGo(p, '#/inventory/purchase/9?tab=zzz')
  await sleep(1300)
  const d6 = JSON.parse(await p.eval(PAGE))
  console.log('  ?tab=zzz → active=' + d6.activeTab + ' pane=' + d6.paneCount +
    ' payRoot=' + d6.payRoot + ' inbNote=' + JSON.stringify(d6.inbNote))
  ok('P6.1 ★非法 ?tab=zzz 必须**回落 detail**（证明页签真受 query 驱动，不是恒渲染同一页）',
    d6.activeTab === '采购订单详情' && d6.payRoot === false && !d6.inbNote, JSON.stringify({ a: d6.activeTab, pay: d6.payRoot }))
  await hardGo(p, '#/inventory/purchase/9?tab=payments')
  await sleep(1300)
  const d7 = JSON.parse(await p.eval(PAGE))
  ok('P6.2 ★硬刷新带 ?tab=payments 仍停在货款页（直链可分享语义）',
    d7.activeTab === '货款' && /tab=payments/.test(d7.hash), 'active=' + d7.activeTab + ' hash=' + d7.hash)
  await hardGo(p, '#/inventory/purchase/999999')
  await sleep(1400)
  const d8 = JSON.parse(await p.eval(PAGE))
  console.log('  不存在的单 → errBox=' + JSON.stringify(d8.errBox.slice(0, 60)) + ' h2=' + d8.h2)
  ok('P6.3 ★不存在的单进错误态（不是静默空白页）', d8.errBox.length > 0, d8.errBox.slice(0, 60))
  ok('P6.4 反向对照：错误态下页签条**不该**出现（没有单就没有页签）',
    d8.tabCount === 0, 'tabCount=' + d8.tabCount)

  /* ═══════ P7 零写入 ═══════ */
  section('P7 零写入 + 控制台')
  const fin = JSON.parse(await p.eval(PAGE))
  const raw = fin.writes || []
  const writes = raw.filter(w => !/simulate-batch/.test(w))
  console.log('  原始写请求：' + JSON.stringify(raw) + ' / 豁免后：' + JSON.stringify(writes))
  ok('P7.1 ★除已知只读计算接口外零写请求（本探针全程只读）', writes.length === 0, JSON.stringify(writes))
  const errs = (p.errors || []).filter(e => !/favicon|ResizeObserver loop/i.test(String(e)))
  console.log('  控制台错误：' + JSON.stringify(errs.slice(0, 6)))
  ok('P7.2 控制台无错误', errs.length === 0, JSON.stringify(errs.slice(0, 3)))

  await browser.close()

  console.log('\n' + '═'.repeat(78))
  console.log('PASS ' + PASS.length + ' / FAIL ' + FAIL.length)
  if (FAIL.length) { console.log('失败项：'); FAIL.forEach(f => console.log('  ✗ ' + f)) }
  process.exit(FAIL.length ? 1 : 0)
}

main().catch(e => { console.error('探针异常：', e); process.exit(3) })
