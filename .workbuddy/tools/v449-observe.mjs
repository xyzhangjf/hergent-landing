/**
 * v449 观测探针（**只读**）—— 先把真机 DOM 事实原样打出来，再写断言。
 *
 * 为什么必须先观测：本轮把「2 个共用页面」拆成「7 个独立页面」，
 * 每页的**表单头类名 / 标签文案 / 字段格数量**都不一样（采购侧 `.ipn-`、
 * 销售侧 `.isn-`、调拨侧同销售）。凭印象写断言 ⇒ 必然假红（v444~v448 共踩过四次）。
 *
 * 跑法：
 *   V449_TOKEN=$(cat /tmp/v449-token.txt) \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v449-observe.mjs
 */
import { launch } from './lib/cdp-lite.mjs'

const BASE = process.env.HG_BASE || 'http://127.0.0.1:5199'
const TOKEN = process.env.V449_TOKEN || ''
const TENANT = process.env.V449_TENANT || '1'
const USER_JSON = process.env.V449_USER_JSON ||
  JSON.stringify({ id: 1, username: 'admin', role: 'admin', roles: ['admin'], name: 'admin' })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const ROUTES = [
  ['采购订单',    '/#/inventory/purchase/new'],
  ['采购退货单',  '/#/inventory/purchase/return/new'],
  ['自提订单',    '/#/inventory/sale/self-pickup/new'],
  ['自提退单',    '/#/inventory/sale/self-pickup/return/new'],
  ['车销订单',    '/#/inventory/sale/vehicle/new'],
  ['车销退单',    '/#/inventory/sale/vehicle/return/new'],
  ['调拨单',      '/#/inventory/transfer/new'],
  ['旧·销售新建(无参)',  '/#/inventory/sale/new'],
  ['旧·销售新建(车销退)', '/#/inventory/sale/new?type=vehicle_sale&kind=return'],
  ['旧·销售新建(调拨退)', '/#/inventory/sale/new?type=transfer&kind=return'],
  ['旧·采购新建(kind=return+from_po)', '/#/inventory/purchase/new?kind=return&from_po=12'],
  ['旧·采购新建(copy=1)', '/#/inventory/purchase/new?copy=1']
]

/* 观测脚本：只读 DOM，不点任何按钮。返回 JSON 字符串（CDP returnByValue 对 object 会退化）。 */
const JS_PROBE = [
  '(function(){',
  '  try {',
  '    var out = {};',
  '    out.href = location.href;',
  '    out.hash = location.hash;',
  '    var q = document.querySelector(".page-hd h2, .page-hd-box h2, h2");',
  '    out.h2 = q ? (q.textContent || "").trim() : null;',
  '    var sub = document.querySelector(".page-sub");',
  '    out.sub = sub ? (sub.textContent || "").trim() : null;',
  '    /* 表单头容器：取所有 class 里含 -hd 的元素，看挂了哪个前缀 */',
  '    var hds = [];',
  '    [].forEach.call(document.querySelectorAll("[class*=-hd]"), function(e){',
  '      if (hds.length < 12) hds.push(e.className);',
  '    });',
  '    out.hdClasses = hds;',
  '    /* 表单头里的标签文案（标签类名按前缀不同：ipn-lb / isn-lb，故按 -lb 后缀找） */',
  '    var lbs = [];',
  '    [].forEach.call(document.querySelectorAll("[class$=-lb], [class*=-lb ]"), function(e){',
  '      var t = (e.textContent || "").replace(/\\s+/g, "").trim();',
  '      if (t && lbs.indexOf(t) < 0 && lbs.length < 30) lbs.push(t);',
  '    });',
  '    out.labels = lbs;',
  '    /* 顶部按钮文案（判「保存草稿 / 保存并过账」这类两步动作） */',
  '    var btns = [];',
  '    [].forEach.call(document.querySelectorAll("button"), function(b){',
  '      var t = (b.textContent || "").replace(/\\s+/g, "").trim();',
  '      if (t && btns.indexOf(t) < 0 && btns.length < 24) btns.push(t);',
  '    });',
  '    out.buttons = btns;',
  '    out.tables = document.querySelectorAll("table").length;',
  '    out.inputs = document.querySelectorAll("input").length;',
  '    out.selects = document.querySelectorAll("select").length;',
  '    /* 明细表头 */',
  '    var ths = [];',
  '    [].forEach.call(document.querySelectorAll("table thead th"), function(t){',
  '      if (ths.length < 24) ths.push((t.textContent || "").replace(/\\s+/g, "").trim());',
  '    });',
  '    out.thead = ths;',
  '    /* 空态 / 错误态文案 */',
  '    var emp = document.querySelector(".state-empty");',
  '    out.empty = emp ? (emp.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120) : null;',
  '    out.errBoundary = !!document.querySelector(".state-error, .app-error, .eb-wrap");',
  '    out.sidebarItems = document.querySelectorAll(".sb-item").length;',
  '    out.appChildren = (document.querySelector("#app") || {}).children',
  '      ? document.querySelector("#app").children.length : -1;',
  '    return JSON.stringify(out);',
  '  } catch (e) { return JSON.stringify({ err: String(e) }); }',
  '})()'
].join('\n')

const main = async () => {
  if (!TOKEN) { console.log('缺少 V449_TOKEN'); process.exit(2) }
  const b = await launch({ headless: true })
  const p = await b.newPage()
  await p.enable()

  const INIT = 'try{localStorage.setItem("hergent_v2_token",' + JSON.stringify(TOKEN) + ');'
    + 'localStorage.setItem("hergent_v2_tenant",' + JSON.stringify(TENANT) + ');'
    + 'localStorage.setItem("hergent_v2_csrf","probe-csrf");'
    + 'localStorage.setItem("hergent_v2_user",' + JSON.stringify(USER_JSON) + ');}catch(e){}'
  const idInit = await p.addInitScript(INIT)

  let n = 0
  for (const [name, path] of ROUTES) {
    const url = BASE + '/?__r=' + (++n) + '_' + Date.now() + path
    p.errors.length = 0
    await p.goto(url, 4200)
    let o
    try { o = JSON.parse(await p.eval(JS_PROBE)) } catch (e) { o = { err: String(e) } }
    console.log('\n' + '='.repeat(96))
    console.log('【' + name + '】  期望: ' + path)
    console.log('  hash      = ' + (o.hash || '(none)'))
    console.log('  h2        = ' + JSON.stringify(o.h2) + '   sub = ' + JSON.stringify(o.sub))
    console.log('  hdClasses = ' + JSON.stringify(o.hdClasses))
    console.log('  labels    = ' + JSON.stringify(o.labels))
    console.log('  buttons   = ' + JSON.stringify(o.buttons))
    console.log('  tables=' + o.tables + ' inputs=' + o.inputs + ' selects=' + o.selects
      + ' sidebarItems=' + o.sidebarItems + ' appChildren=' + o.appChildren)
    console.log('  thead     = ' + JSON.stringify(o.thead))
    console.log('  empty     = ' + JSON.stringify(o.empty) + '  errBoundary=' + o.errBoundary)
    if (o.err) console.log('  🔴 err    = ' + o.err)
    console.log('  errors    = ' + JSON.stringify(p.errors.slice(0, 6)))
  }

  await p.removeInitScript(idInit)
  console.log('\n观测完毕。')
  await b.close()
  process.exit(0)
}

main().catch(async (e) => { console.log('探针崩溃：' + e.message); process.exit(1) })
