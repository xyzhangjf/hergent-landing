/**
 * v498 生产真机探针：三张进销存列表页的「状态页签」是否真的渲染、计数是否与后端一致。
 *
 * 用户反馈原文：「采购单列表里有『全部/草稿/待审核/…』这几个分类，其它几个列表页没有啊」
 * ⇒ 本探针验的是**用户能看到的那个东西**（页签条 + 计数徽章），不是"代码写了"。
 *
 * 靶点（生产 hergent.cn，boss 只读会话）：
 *   A 采购单列表 ?kind=order     → 页签 7 档（无「已退货」：订单入口 exclude_status=returned）
 *   B 销售订单 ?type=self_pickup&kind=order → 页签 7 档（同样无「已退货」）
 *   C 销售退单 ?type=self_pickup&kind=return → **没有页签**（只有 returned 一种状态）
 *   D 调拨单列表                 → 页签 4 档（全部/草稿/已过账/已取消）
 *   E 点「草稿」页签             → 请求真带 status=draft，且**各档计数不变**（不漂移）
 *   F 全程零 console.error / 零未捕获异常
 *
 * 🔴 零写入纪律（沿用 hergent-e2e-readonly-probe）：
 *   · 只点页签（= 只读查询），不点打印/导出/批量/过账；
 *   · 令牌复用 boss 既有活跃会话（SELECT sessions，不新建、不注销）。
 *
 * 运行：
 *   V498_TOKEN=$(ssh root@47.113.224.140 'python3 /tmp/v324-probe-token.py 2>/dev/null | tail -1') \
 *   node .workbuddy/tools/v498-status-tabs-probe.mjs
 */
import { launch } from '../../../.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.V498_TOKEN || ''
if (!TOKEN) { console.log('🔴 缺 V498_TOKEN'); process.exit(2) }

const PASS = [], FAIL = []
const ok = (n, c, d = '') => { (c ? PASS : FAIL).push(n); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + n + (d ? ' | ' + d : '')) }
const section = (t) => console.log('\n' + '─'.repeat(74) + '\n' + t + '\n' + '─'.repeat(74))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/* boot 期注入：localStorage 会话种子 + 全量请求记录（fetch 与 XHR 双通道）。 */
const INIT = `
(function(){
  try {
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', '1');
    localStorage.setItem('hergent_v2_csrf', 'probe-csrf');
    localStorage.setItem('hergent_v2_user', JSON.stringify({id:2,username:'boss',role:'boss',roles:['boss'],name:'张俊峰'}));
  } catch (e) {}
  window.__reqs = [];
  var of = window.fetch;
  window.fetch = function(u, o){
    try {
      var m = (o && o.method) || 'GET';
      var url = (typeof u === 'string') ? u : ((u && u.url) || '');
      window.__reqs.push(String(m).toUpperCase() + ' ' + url);
    } catch (e) {}
    return of.apply(this, arguments);
  };
  var oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u){
    try { window.__reqs.push(String(m).toUpperCase() + ' ' + u) } catch (e) {}
    return oo.apply(this, arguments);
  };
})();
`

/* 读页签：文本 + 计数徽章数字 + 哪个高亮 */
const READ_TABS = `
(function(){
  var bar = document.querySelector('.psi-tabs');
  if (!bar) return { found: false, tabs: [] };
  var out = [];
  bar.querySelectorAll('.main-tab').forEach(function(b){
    var n = b.querySelector('.psi-tabn');
    out.push({
      text: (b.textContent || '').replace((n && n.textContent) || '', '').trim(),
      count: n ? Number((n.textContent || '').trim()) : null,
      on: b.classList.contains('on')
    });
  });
  return { found: true, tabs: out };
})();
`

const browser = await launch({ headless: true })
const page = await browser.newPage()
await page.enable()
const initId = await page.addInitScript(INIT)

async function open (hashPath) {
  /* 🔴 缓存串必须按「已有 query 就用 &」来拼：写死 `'/?__r='` 会挂到 query **后面**
     ⇒ `?kind=order/?__r=123`（`kind` 的值变成 `order/?__r=123`）⇒ 页面读不到 kind，
     探针会把「产品没按入口过滤」误判成产品缺陷（本轮第一轮就踩了）。 */
  const url = BASE + '/#' + hashPath + (hashPath.indexOf('?') >= 0 ? '&' : '/?') + '__r=' + Date.now()
  await page.goto(url, 5200)
  await sleep(900)
}

async function readTabs () { return await page.eval(READ_TABS) }
async function reqs () { return await page.eval('window.__reqs.slice()') }

try {
  section('A. 采购单列表 ?kind=order —— 页签 7 档（订单入口不设「已退货」）')
  await open('/inventory/purchase?kind=order')
  let t = await readTabs()
  ok('A1 页签条存在（共享件 .psi-tabs 已渲染）', t.found, JSON.stringify(t.tabs.map(x => x.text)))
  ok('A2 档位数 == 7（全部+6 状态，无「已退货」）', t.tabs.length === 7, t.tabs.length + ' 档')
  ok('A3 档位文案与顺序正确',
     t.tabs.map(x => x.text).join('/') === '全部/草稿/待审批/已确认/已入库/部分入库/已取消',
     t.tabs.map(x => x.text).join('/'))
  ok('A4 每档都有计数徽章（数字，非 null）', t.tabs.every(x => typeof x.count === 'number'))
  ok('A5 「全部」默认高亮', t.tabs[0] && t.tabs[0].on === true)
  ok('A6 counts 与后端一致（全部 = 各档之和）',
     t.tabs.length > 1 && t.tabs[0].count === t.tabs.slice(1).reduce((s, x) => s + x.count, 0),
     '全部=' + (t.tabs[0] && t.tabs[0].count) + ' 各档和=' + t.tabs.slice(1).reduce((s, x) => s + x.count, 0))

  section('B. 销售订单 ?type=self_pickup&kind=order —— 本轮补齐的页签')
  await open('/inventory/sale?type=self_pickup&kind=order')
  t = await readTabs()
  ok('B1 页签条存在（销售页此前只有状态下拉）', t.found, JSON.stringify(t.tabs.map(x => x.text)))
  ok('B2 档位数 == 7（订单入口排除 returned）', t.tabs.length === 7, t.tabs.length + ' 档')
  ok('B3 档位文案与顺序正确',
     t.tabs.map(x => x.text).join('/') === '全部/草稿/已确认/已发货/已签收/已驳回/已取消',
     t.tabs.map(x => x.text).join('/'))
  ok('B4 计数与后端一致（全部 = 各档之和）',
     t.tabs.length > 1 && t.tabs[0].count === t.tabs.slice(1).reduce((s, x) => s + x.count, 0),
     '全部=' + (t.tabs[0] && t.tabs[0].count))

  section('C. 销售退单 ?kind=return —— 只有一种状态 ⇒ 不渲染页签条')
  await open('/inventory/sale?type=self_pickup&kind=return')
  t = await readTabs()
  ok('C1 退单入口**没有**页签条（不是摆一条只有一个按钮的条）', t.found === false)

  section('D. 调拨单列表 —— 本轮补齐的页签（3 状态）')
  await open('/inventory/transfer')
  t = await readTabs()
  ok('D1 页签条存在（调拨页此前只有状态下拉）', t.found, JSON.stringify(t.tabs.map(x => x.text)))
  ok('D2 档位数 == 4（全部 + draft/completed/cancelled）', t.tabs.length === 4, t.tabs.length + ' 档')
  ok('D3 档位文案与顺序正确',
     t.tabs.map(x => x.text).join('/') === '全部/草稿/已过账/已取消',
     t.tabs.map(x => x.text).join('/'))
  ok('D4 计数与后端一致（全部 = 各档之和）',
     t.tabs.length > 1 && t.tabs[0].count === t.tabs.slice(1).reduce((s, x) => s + x.count, 0),
     '全部=' + (t.tabs[0] && t.tabs[0].count))

  section('E. 点页签：请求真带 status，且各档计数**不漂移**')
  await open('/inventory/sale?type=self_pickup&kind=order')
  const before = await readTabs()
  const clicked = await page.eval(`
    (function(){
      var bar = document.querySelector('.psi-tabs');
      if (!bar) return false;
      var btns = bar.querySelectorAll('.main-tab');
      var target = null;
      btns.forEach(function(b){ if ((b.textContent||'').indexOf('草稿') >= 0) target = b });
      if (!target) return false;
      window.__reqs = [];
      target.click();
      return true;
    })();
  `)
  ok('E1 「草稿」页签可点击', clicked === true)
  await sleep(2200)
  const after = await readTabs()
  const rs = await reqs()
  const hit = rs.filter(u => u.indexOf('/api/psi/sale-orders') >= 0)
  ok('E2 点击后真发了列表请求', hit.length >= 1, hit.slice(-1)[0] || '(无)')
  ok('E3 请求带 status=draft', hit.some(u => /status=draft/.test(u)), hit.slice(-1)[0] || '(无)')
  /* ⚠️ 只比「档位 + 计数」，**不比** `on`（高亮当然会跟着点到哪档变）——
     把高亮算进来会让这条断言永远假红。 */
  const strip = (x) => JSON.stringify(x.tabs.map(t => t.text + ':' + t.count))
  ok('E4 🔴 各档计数**逐字不变**（服务端 counts 不随选中档漂移）',
     strip(before) === strip(after),
     'before=' + strip(before) + ' after=' + strip(after))
  ok('E5 「草稿」档高亮', after.tabs.some(x => x.text === '草稿' && x.on === true))

  section('F. 零未捕获错误 / 零 console.error')
  const errs = page.errors.slice()
  ok('F1 全程零 console.error 与零未捕获异常', errs.length === 0, errs.slice(0, 3).join(' ;; '))
} finally {
  await page.removeInitScript(initId).catch(() => {})
  await browser.close()
}

console.log('\n' + '═'.repeat(74))
console.log(`合计 ${PASS.length + FAIL.length} 项：PASS ${PASS.length} / FAIL ${FAIL.length}`)
if (FAIL.length) console.log('失败项：\n  - ' + FAIL.join('\n  - '))
console.log('═'.repeat(74))
process.exit(FAIL.length ? 1 : 0)
