/**
 * v395 侧栏弹窗横向分列 + 销售单据拆分 + 打印入口 —— 只读真机探针（生产 https://hergent.cn）
 *
 * 本轮改了三件事，探针逐条验（**不验"我以为改了"，只验浏览器里真实渲染出来的**）：
 *   ① 弹窗从「纵向堆叠」改成「分组横向并排成列」（对齐舟谱）；
 *   ② 销售拆 自提/车销 × 订单/退单 四个入口 + 采购加退货单 + 调拨独立成列；
 *   ③ 系统区新增「打印」列（打印模板 / 打印设置 / 打印记录 → 同一个 `/print` 页的页签）。
 *
 * 🔴 判别力自证（缺一不可）：
 *   ① 横向判据不能只看 `flex-direction` —— 还得看**真实几何**：列与列必须 y 相近、x 递增。
 *      （`row` 但被 `flex-wrap` 折成上下两排，也满足 flexDirection=row，却是我们要抓的失败态。）
 *   ② 反例对照：把 `.sb-pop` 强行改成 `flex-direction:column`，探针**必须**报横向失败。
 *   ③ 零写入：整轮只允许 GET/HEAD，出现任何写请求即失败（本探针是只读的）。
 *
 * 运行：
 *   V395_TOKEN=$(ssh root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   NODE_PATH=/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v395-nav-popover-cols-probe.mjs
 */
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.V395_TOKEN || ''
const TENANT = '1'

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
  XMLHttpRequest.prototype.open = function(m, u){ try { log(m, u); } catch (e) {} return o.apply(this, arguments); };
})();
`

/* 弹窗结构采样：列标题、列几何、列内条目文本 */
const POP = `(function(){
  var pop = document.querySelector('.sb-pop');
  if (!pop) return JSON.stringify({ open: false });
  var cs = getComputedStyle(pop);
  var cols = Array.prototype.slice.call(pop.querySelectorAll('.sb-pop-col'));
  return JSON.stringify({
    open: true,
    dir: cs.flexDirection,
    wrap: cs.flexWrap,
    cols: cols.map(function(c){
      var r = c.getBoundingClientRect();
      var hd = c.querySelector('.sb-pop-hd');
      return {
        x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width),
        title: hd ? hd.textContent.trim() : '',
        items: Array.prototype.slice.call(c.querySelectorAll('.sb-pop-item')).map(function(a){ return a.textContent.trim() })
      };
    })
  });
})()`

/* 点某个一级区（按按钮文本） */
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

/* 当前页状态：URL、页头 h2、是否兜底错误页、写入日志 */
const pageState = `(function(){
  var h2 = document.querySelector('.page-hd h2');
  return JSON.stringify({
    hash: location.hash, search: location.search,
    h2: h2 ? h2.textContent.trim() : '',
    err: !!document.querySelector('.state-error'),
    writes: window.__WRITES || []
  });
})()`

const hardGo = async (p, hash, ms = 9000) => p.goto(BASE + '/?__r=' + Date.now() + hash, ms)

const main = async () => {
  const browser = await launch({ headless: true, extraArgs: ['--no-proxy-server'] })
  const p = await browser.newPage()
  await p.enable()
  await p.addInitScript(INIT)

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

  /* ───────── P1 进销存弹窗：横向分列 + 销售四单据 ───────── */
  section('P1 进销存弹窗 —— 分组横向并排 + 销售拆 自提/车销 × 订单/退单')
  await hardGo(p, '#/inventory')
  await sleep(600)
  let r1 = JSON.parse(await p.eval(clickArea('进销存')))
  await sleep(500)
  const psi = JSON.parse(await p.eval(POP))
  console.log('  弹窗列：' + JSON.stringify(psi.cols && psi.cols.map(c => c.title + '(' + c.items.join('/') + ')')))
  ok('P1 弹窗已打开', !!psi.open)
  ok('P1 flex-direction = row（横向）', psi.dir === 'row', 'dir=' + psi.dir)

  const cols = psi.cols || []
  /* 横向几何判据：至少 4 列「顶部同高（±12px）且 x 递增」 ⇒ 真的并排，不是折行堆叠 */
  const sameRow = cols.filter(c => Math.abs(c.y - cols[0].y) <= 12)
  let xAsc = true
  for (let i = 1; i < sameRow.length; i++) if (!(sameRow[i].x > sameRow[i - 1].x)) xAsc = false
  ok('P1 ★横向几何：同排列数 ≥ 4 且 x 递增', sameRow.length >= 4 && xAsc,
    '同排 ' + sameRow.length + ' 列 / xAsc=' + xAsc + ' / y=' + JSON.stringify(cols.map(c => c.y)))

  const titles = cols.map(c => c.title)
  ok('P1 列标题含 采购/销售/调拨/库存/其他',
    ['采购', '销售', '调拨', '库存', '其他'].every(t => titles.indexOf(t) >= 0), JSON.stringify(titles))
  ok('P1 空列「往来」不出现（resolveNavItem 收口）', titles.indexOf('往来') < 0, JSON.stringify(titles))

  const sale = (cols.find(c => c.title === '销售') || {}).items || []
  ok('P1 ★销售列 = 自提订单/自提退单/车销订单/车销退单',
    JSON.stringify(sale) === JSON.stringify(['自提订单', '自提退单', '车销订单', '车销退单']), JSON.stringify(sale))
  const buy = (cols.find(c => c.title === '采购') || {}).items || []
  ok('P1 采购列 = 采购单/采购退货单',
    JSON.stringify(buy) === JSON.stringify(['采购单', '采购退货单']), JSON.stringify(buy))
  const tr = (cols.find(c => c.title === '调拨') || {}).items || []
  ok('P1 调拨列 = 调拨单', JSON.stringify(tr) === JSON.stringify(['调拨单']), JSON.stringify(tr))

  /* 反例对照：强行改成 column ⇒ 横向判据必须失败（证明判据不是恒真） */
  await p.eval(`(function(){
    var pop = document.querySelector('.sb-pop');
    if (pop) pop.style.flexDirection = 'column';
    return '1';
  })()`)
  const neg = JSON.parse(await p.eval(POP))
  const negSame = (neg.cols || []).filter(c => Math.abs(c.y - neg.cols[0].y) <= 12)
  ok('P1 反例自证：改成 column 后横向判据必须失败', !(negSame.length >= 4), '同排 ' + negSame.length + ' 列')
  await p.eval(`(function(){ var pop=document.querySelector('.sb-pop'); if(pop) pop.style.flexDirection=''; return '1' })()`)

  /* ───────── P2 系统区：打印列 ───────── */
  section('P2 系统弹窗 —— 新增「打印」列')
  await hardGo(p, '#/workbench')
  await sleep(600)
  await p.eval(clickArea('系统'))
  await sleep(500)
  const sys = JSON.parse(await p.eval(POP))
  console.log('  弹窗列：' + JSON.stringify((sys.cols || []).map(c => c.title + '(' + c.items.join('/') + ')')))
  const pr = (sys.cols || []).find(c => c.title === '打印')
  ok('P2 打印列存在', !!pr, JSON.stringify((sys.cols || []).map(c => c.title)))
  ok('P2 打印列 = 打印模板/打印设置/打印记录',
    !!pr && JSON.stringify(pr.items) === JSON.stringify(['打印模板', '打印设置', '打印记录']),
    JSON.stringify(pr && pr.items))

  /* ───────── P3 点「自提订单」：URL 带筛选 + 页头跟着变 ───────── */
  section('P3 入口直达 —— 点「自提订单」')
  await hardGo(p, '#/inventory')
  await sleep(600)
  await p.eval(clickArea('进销存'))
  await sleep(400)
  const c1 = JSON.parse(await p.eval(clickItem('自提订单')))
  await sleep(900)
  const s1 = JSON.parse(await p.eval(pageState))
  console.log('  → ' + JSON.stringify(s1))
  ok('P3 点击成功', c1.ok === true, JSON.stringify(c1))
  /* ⚠️ 本站是 **hash 路由** ⇒ query 在 `location.hash` 里，`location.search` 只有
     探针自己加的 `?__r=`（第一次跑就栽在这：hash 里明明是对的，却拿 search 去比）。 */
  ok('P3 URL 带 type=self_pickup&kind=order',
    /type=self_pickup/.test(s1.hash) && /kind=order/.test(s1.hash), s1.hash)
  ok('P3 页头 = 自提订单（筛选真的生效）', s1.h2 === '自提订单', 'h2=' + s1.h2)

  /* ───────── P4 点「车销退单」 ───────── */
  section('P4 入口直达 —— 点「车销退单」')
  await hardGo(p, '#/inventory')
  await sleep(600)
  await p.eval(clickArea('进销存'))
  await sleep(400)
  await p.eval(clickItem('车销退单'))
  await sleep(900)
  const s2 = JSON.parse(await p.eval(pageState))
  console.log('  → ' + JSON.stringify(s2))
  ok('P4 URL 带 type=vehicle_sale&kind=return',
    /type=vehicle_sale/.test(s2.hash) && /kind=return/.test(s2.hash), s2.hash)
  ok('P4 页头 = 车销退单', s2.h2 === '车销退单', 'h2=' + s2.h2)

  /* ───────── P5 打印页可达 ───────── */
  section('P5 打印页可达（占位骨架）')
  await hardGo(p, '#/print?tab=templates')
  await sleep(900)
  const s3 = JSON.parse(await p.eval(pageState))
  console.log('  → ' + JSON.stringify(s3))
  ok('P5 /print 打开且页头 = 打印', s3.h2 === '打印' && !s3.err, 'h2=' + s3.h2)
  const tabOn = JSON.parse(await p.eval(`(function(){
    var t = document.querySelector('.main-tab.on');
    return JSON.stringify({ on: t ? t.textContent.trim() : '' });
  })()`))
  ok('P5 页签「打印模板」为选中态', tabOn.on === '打印模板', JSON.stringify(tabOn))
  const hasNote = JSON.parse(await p.eval(`(function(){
    return JSON.stringify({ dev: document.body.textContent.indexOf('开发中') >= 0 });
  })()`))
  ok('P5 页面明写「开发中」（占位，不装作已完成）', hasNote.dev === true)

  /* ───────── P6 零写入 ───────── */
  section('P6 只读自证')
  const w = JSON.parse(await p.eval(`JSON.stringify(window.__WRITES || [])`))
  ok('P6 全程零写请求', (w || []).length === 0, JSON.stringify(w))

  console.log('\n' + '═'.repeat(78))
  console.log('PASS ' + PASS.length + ' / FAIL ' + FAIL.length)
  if (FAIL.length) console.log('失败项：\n  - ' + FAIL.join('\n  - '))
  console.log('═'.repeat(78))
  await browser.close()
  process.exit(FAIL.length ? 1 : 0)
}

main().catch(e => { console.log('🔴 探针异常：' + (e && e.stack || e)); process.exit(3) })
