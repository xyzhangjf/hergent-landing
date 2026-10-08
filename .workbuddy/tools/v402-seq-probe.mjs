/**
 * v402 全站「序号列」只读真机探针（生产 https://hergent.cn）
 *
 * 背景：v401 只给进销存采购/销售两页接了序号列；v402 按 UI-SPEC §2.6.1 判据把
 * 序号列铺到全站「会被说成第几行那个」的清单表（档案 / 库存 / 单据明细 / 返利 / 工资 /
 * 货损 / 雷达 / 定时 / 渠道价 / 目标），并把全局唯一源从 `table.tbl .seq-*` 扩到
 * `table.seq-host .seq-*`（给非 .tbl 的自定义表复用）。
 *
 * 本探针逐个走生产页面，回答三问（全部是 DOM + 几何事实，不靠读代码的印象）：
 *   ① 这一页**有没有**一张带 .seq-th 的表（序号列铺上了没）；
 *   ② 若铺了：表头首列是不是「序号」、列宽是否 ≈46px（全局唯一源生效）、是否居中、
 *      表体首个 .seq-num 是否 = 1（首页 1 基，跨页连续的分页页首页也是 1）；
 *   ③ 这一页有没有发生**任何写请求**（本探针是只读的，出现写即 FAIL）。
 *
 * ⚠️ 打不开 / 没数据 / 需先点按钮才渲染的页面（算工资、货损工作流、新建单据录入表）
 *    会报 **SKIP**（不算失败），并打印该页实际找到的表清单，供人工确认「跳过的原因合理」。
 *    SKIP 不是通过 —— 汇总里单独计数。
 *
 * 运行：
 *   V402_TOKEN=$(ssh -o BatchMode=yes root@47.113.224.140 'python3 /tmp/v392-probe-tokens.py boss' | cut -f3) \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v402-seq-probe.mjs
 */
import { launch } from './lib/cdp-lite.mjs'

const BASE = 'https://hergent.cn'
const TOKEN = process.env.V402_TOKEN || ''
const TENANT = '1'

const PASS = []; const FAIL = []; const SKIP = []
const ok = (name, cond, detail = '') => {
  ;(cond ? PASS : FAIL).push(name)
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' | ' + detail : ''))
}
const skip = (name, detail = '') => { SKIP.push(name); console.log('  SKIP  ' + name + (detail ? ' | ' + detail : '')) }
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

/* 通用量测：遍历页内所有 <table>，找出**第一张带 thead th.seq-th 的表**并度量。
   同时把每一张表的 [class / 列数 / 首列文本 / 是否带序号] 带回来，便于人工判断 SKIP 是否合理。 */
const MEASURE_SEQ = `(function(){
  var out = { hash: location.hash, tables: [] };
  var seqTable = null, seqTh = null;
  var all = document.querySelectorAll('table');
  for (var ti = 0; ti < all.length; ti++) {
    var t = all[ti];
    var ths = t.querySelectorAll('thead > tr > th');
    var first = ths[0];
    var s = t.querySelector('thead th.seq-th');
    out.tables.push({
      cls: String(t.className).trim(),
      n: ths.length,
      th0: first ? first.textContent.trim().replace(/\\s+/g, ' ') : null,
      hasSeq: !!s
    });
    if (!seqTable && s) { seqTable = t; seqTh = s; }
  }
  if (!seqTable) { out.err = 'no-table-with-seq-th'; return JSON.stringify(out); }
  out.seqTableCls = String(seqTable.className).trim();
  out.th0Cls = String(seqTh.className).trim();
  out.th0Text = seqTh.textContent.trim().replace(/\\s+/g, ' ');
  var a = getComputedStyle(seqTh);
  out.th0Align = a.textAlign;
  out.th0W = Math.round(seqTh.getBoundingClientRect().width);
  var nums = seqTable.querySelectorAll('tbody td.seq-cell .seq-num');
  out.numCount = nums.length;
  out.nums = [];
  for (var i = 0; i < Math.min(4, nums.length); i++) out.nums.push(nums[i].textContent.trim());
  var sc = seqTable.querySelector('tbody td.seq-cell');
  if (sc) {
    var cs = getComputedStyle(sc);
    out.cellAlign = cs.textAlign;
    out.cellW = Math.round(sc.getBoundingClientRect().width);
  }
  return JSON.stringify(out);
})();`

// [标签, hash 路径]
const PAGES = [
  ['品牌档案', '/#/archive/brands'],
  ['客户档案', '/#/archive/customers'],
  ['员工档案', '/#/archive/employees'],
  ['商品档案', '/#/archive/products'],
  ['仓库档案', '/#/archive/warehouses'],
  ['供应商档案', '/#/archive/suppliers'],
  ['渠道与价格', '/#/archive/prices'],
  ['库存查询', '/#/inventory/stock'],
  ['采购单列表', '/#/inventory/purchase'],
  ['销售单列表', '/#/inventory/sale'],
  ['新建采购单', '/#/inventory/purchase/new'],
  ['新建销售单', '/#/inventory/sale/new'],
  ['目标与返利', '/#/rebate'],
  ['货损计算工作流', '/#/loss'],
  ['货损核算', '/#/loss-accounting'],
  ['算工资', '/#/payroll'],
  ['招投标雷达', '/#/bid-radar'],
  ['定时任务', '/#/cron'],
  ['历史期次', '/#/forecast?tab=history'],
  ['报单配置', '/#/forecast?tab=config'],
  ['商品目标', '/#/forecast?tab=target'],
]

const main = async () => {
  if (!TOKEN) { console.error('缺 V402_TOKEN'); process.exit(2) }
  const browser = await launch({ headless: true })
  const p = await browser.newPage()
  p.pageErrors = []
  await p.enable()
  await p.addInitScript(INIT)
  try {
    await p.raw.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })

    for (const [label, url] of PAGES) {
      section('页面：' + label + '  ' + url)
      let m = null
      for (let i = 0; i < 4; i++) {
        await p.goto(BASE + url, i === 0 ? 4500 : 3000)
        try { m = JSON.parse(await p.eval(MEASURE_SEQ)) } catch (e) { m = { err: String(e.message) } }
        if (m && !m.err) break
        await sleep(1500)
      }
      const allW = JSON.parse(await p.eval('JSON.stringify(window.__WRITES || [])'))
      /* 🔴 排除 `rebate-rules/simulate-batch`：它是**纯试算**（批量返利试算，不落库），
         Shell 在多个页面预取它 ⇒ 不是「写」，会污染零写断言。
         ⚠️ 但**必须说清一个既有瑕疵**（2026-10-08 取证，**非 v402 引入**）：它**没有**登记进
         后端 `server.py::_READ_ONLY_POST`（该名单里只有名字相近的 `/api/rebate-contracts/simulate`，
         路径不同）⇒ 后端仍按 `create` 动作鉴权 ⇒ 若某角色的 `sales` 无 create 会 403。
         这不影响本探针（不落库就是读），但值得单独立项。
         排除时**显式报出条数**，免得把"白名单"用成"眼罩"。 */
      const RO_POST = /rebate-rules\/simulate-batch/
      const w = allW.filter(x => !RO_POST.test(x))
      if (allW.length - w.length) console.log('     （已排除只读 POST rebate-rules/simulate-batch ×' + (allW.length - w.length) + '）')

      if (!m || m.err) {
        const tbls = (m && m.tables) ? m.tables : []
        skip(label + ' 未找到带 .seq-th 的表',
          '页内表数=' + tbls.length + ' ' + JSON.stringify(tbls.slice(0, 4)))
        ok(label + ' ★零写请求', w.length === 0, w.length ? w.join(' ; ') : '0')
        continue
      }

      ok(label + ' ★表头首列 = 「序号」', m.th0Text === '序号', 'th0=' + JSON.stringify(m.th0Text))
      ok(label + ' 序号列表头带 .seq-th', /seq-th/.test(String(m.th0Cls)), 'cls=' + m.th0Cls)
      ok(label + ' ★列宽 ≈46px（全局唯一源生效）', m.th0W != null && Math.abs(m.th0W - 46) <= 5, 'w=' + m.th0W)
      ok(label + ' 表头居中', m.th0Align === 'center', 'align=' + m.th0Align)
      if (m.numCount > 0) {
        ok(label + ' ★首个序号 = 1（首页 1 基）', m.nums[0] === '1', 'nums=' + m.nums.join(','))
        ok(label + ' 序号格居中（.seq-cell text-align:center）', m.cellAlign === 'center', 'align=' + m.cellAlign)
        ok(label + ' 序号格宽 ≈46px', m.cellW != null && Math.abs(m.cellW - 46) <= 6, 'w=' + m.cellW)
      } else {
        ok(label + ' 当前无数据行 ⇒ 只验表头（行断言自动跳过）', true, 'numCount=0')
      }
      ok(label + ' ★零写请求', w.length === 0, w.length ? w.join(' ; ') : '0')
      console.log('     （本页表 ' + m.tables.length + ' 张，序号表 class=' + m.seqTableCls + '，行数=' + m.numCount + '）')
    }
  } finally {
    await browser.close?.()
  }

  section('汇总')
  console.log('PASS=' + PASS.length + '  FAIL=' + FAIL.length + '  SKIP=' + SKIP.length)
  if (FAIL.length) { console.log('\nFAIL 明细：'); FAIL.forEach(f => console.log('  · ' + f)) }
  if (SKIP.length) { console.log('\nSKIP 明细（需人工确认原因合理）：'); SKIP.forEach(s => console.log('  · ' + s)) }
  process.exit(FAIL.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(3) })
