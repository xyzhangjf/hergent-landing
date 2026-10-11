/**
 * v449 进销存建单页「拆成 7 个独立页面」端到端验收探针（**只读**）
 *
 * 验收对象：
 *   ① 7 条新路径各自渲染**自己的**页面（标题 / 表单头字段 / 明细列 精确匹配）；
 *   ② 7 页之间的**真实业务差异**（车销有送货司机、自提没有；订单=销售仓库、退单=退货仓库…）；
 *   ③ 2 条旧路径（`/inventory/sale/new`、`/inventory/purchase/new?kind=`）改道正确、
 *      且**不撒谎**（该留的 `from_po` 留、该剥的 `kind`/`type` 剥）；
 *   ④ 全程零业务写入（含「监控已安装」护栏，否则那条断言恒真）；
 *   ⑤ **低权限对照**：`distributor` 深链必须被拦（证明门禁由角色驱动，不是"深链永远被拒"）。
 *
 * ── 探针自身的坑（本文件已按技能里 10+ 条教训规避）────────────────────────────
 *   ① 只差 hash 的导航 = 同文档 ⇒ 必须 `/?__r=<n>_<ts>#/<hash>`（真加载）。
 *   ② CDP `returnByValue` 对 object 会退化 ⇒ 页面内一律 `JSON.stringify` 后再解析。
 *   ③ 模板串内**不能写反引号**；正则反斜杠要双写。
 *   ④ 断言读的是「标签集合 / 明细列集合」的**全等**，不是"包含"——
 *      拆页的价值就在"字段不一样"，用包含判据等于没验。
 *   ⑤ `errors` 只收 console.error 与未捕获异常；HTTP 非 2xx **不进** errors
 *      ⇒ 零报错 ≠ 接口都成功，两条分开断言。
 *   ⑥ 低权限相位必须**换新文档**载入新身份（Pinia 单例跨文档才清），故也用 `hardGo`。
 *
 * 跑法：
 *   V449_TOKEN=<admin 令牌> V449_DIST_TOKEN=<distributor 令牌> HG_LABEL=DEV \
 *   HG_BASE=http://127.0.0.1:5199 \
 *   NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
 *   /Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-6/bin/node \
 *     .workbuddy/tools/v449-psi-split-e2e.mjs
 */
import { launch } from './lib/cdp-lite.mjs'
import fs from 'node:fs'

const BASE = process.env.HG_BASE || 'http://127.0.0.1:5199'
const LABEL = process.env.HG_LABEL || 'DEV'
const TOKEN = process.env.V449_TOKEN || ''
const DIST_TOKEN = process.env.V449_DIST_TOKEN || ''
const TENANT = process.env.V449_TENANT || '1'
const ADMIN_USER = process.env.V449_USER_JSON ||
  JSON.stringify({ id: 1, username: 'admin', role: 'admin', roles: ['admin'], name: 'admin' })
const DIST_USER = process.env.V449_DIST_USER_JSON ||
  JSON.stringify({ id: 999908, username: '15391599966', role: 'distributor', roles: ['distributor'], name: '唐成' })

const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v449-psi-split'
try { fs.mkdirSync(OUT, { recursive: true }) } catch { /* ignore */ }

/* ── 断言账本 ─────────────────────────────────────────────────────────────── */
const R = []
const rec = (name, cond, want, got) => {
  R.push({ name, ok: !!cond, want, got })
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + name
    + (cond ? '' : '  期望=' + JSON.stringify(want) + ' 实测=' + JSON.stringify(got)))
}
const guard = (name, cond, want, got) => rec(name, cond, want, got)
const skip = (name, why) => { R.push({ name, ok: true, skip: true }); console.log('  SKIP  ' + name + '  | ' + why) }
const section = (t) => console.log('\n' + '─'.repeat(98) + '\n' + t + '\n' + '─'.repeat(98))

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const hasTxt = (arr, s) => (arr || []).some(x => String(x).indexOf(s) >= 0)

/* ── 七页的期望值（逐字取自**观测探针**的真机读数，不是凭印象写）──────────────── */
const PAGES = [
  { key: '采购订单', hash: '#/inventory/purchase/new',
    h2: '新建采购订单', hdBox: 'ipn-hd-box',
    labels: ['*供应商', '经办人', '部门', '*入库仓库', '单据日期', '备注'],
    thead: ['', '*商品', '条码', '单位', '可用库存', '实际库存', '参考成本价', '*采购价', '*订单数量', '订单金额', '批次信息', '行备注', '操作'] },
  { key: '采购退货单', hash: '#/inventory/purchase/return/new',
    h2: '新建采购退货单', hdBox: 'ipn-hd-box',
    labels: ['*供应商', '*退货仓库', '单据日期', '备注'],
    thead: ['', '*商品', '*退货数量', '单位', '*退货价', '退货金额', ''] },
  { key: '自提订单', hash: '#/inventory/sale/self-pickup/new',
    h2: '新建自提订单', hdBox: 'isn-hd-box',
    labels: ['*客户', '部门', '*销售仓库', '单据日期', '交货日期', '交货地址', '备注'],
    thead: ['', '*商品', '*数量', '单位', '*销售价', '金额', ''] },
  { key: '自提退单', hash: '#/inventory/sale/self-pickup/return/new',
    h2: '新建自提退单', hdBox: 'isn-hd-box',
    labels: ['*客户', '*退货仓库', '单据日期', '备注'],
    thead: ['', '*商品', '*数量', '单位', '*退货价', '金额', ''] },
  { key: '车销订单', hash: '#/inventory/sale/vehicle/new',
    h2: '新建车销订单', hdBox: 'isn-hd-box',
    labels: ['*客户', '部门', '*销售仓库', '送货司机', '单据日期', '交货日期', '交货地址', '备注'],
    thead: ['', '*商品', '*数量', '单位', '*销售价', '金额', ''] },
  { key: '车销退单', hash: '#/inventory/sale/vehicle/return/new',
    h2: '新建车销退单', hdBox: 'isn-hd-box',
    labels: ['*客户', '*退货仓库', '送货司机', '单据日期', '备注'],
    thead: ['', '*商品', '*数量', '单位', '*退货价', '金额', ''] },
  { key: '调拨单', hash: '#/inventory/transfer/new',
    h2: '新建调拨单', hdBox: 'isn-hd-box',
    labels: ['*调出仓库', '*调入仓库', '单据日期', '备注'],
    thead: ['', '*商品', '*数量', '单位', ''] }
]

/* ── 页面内观测脚本（只读；不点任何按钮）──────────────────────────────────── */
const JS_OBS = [
  '(function(){',
  '  try {',
  '    var out = {};',
  '    out.href = location.href; out.hash = location.hash;',
  '    var q = document.querySelector(".page-hd h2, h2");',
  '    out.h2 = q ? (q.textContent || "").trim() : null;',
  '    var sub = document.querySelector(".page-sub");',
  '    out.sub = sub ? (sub.textContent || "").trim() : null;',
  '    var box = document.querySelector("[class*=hd-box], [class*=-hd-box]");',
  '    out.hdBox = box ? box.className : null;',
  '    out.hasHdBox = !!document.querySelector(".ipn-hd-box, .isn-hd-box, [class*=-hd-box]");',
  '    var lbs = [];',
  '    [].forEach.call(document.querySelectorAll("[class$=-lb], [class*=-lb ]"), function(e){',
  '      var t = (e.textContent || "").replace(/\\s+/g, "").trim();',
  '      if (t && lbs.indexOf(t) < 0) lbs.push(t);',
  '    });',
  '    out.labels = lbs;',
  '    var btns = [];',
  '    [].forEach.call(document.querySelectorAll("button"), function(b){',
  '      var t = (b.textContent || "").replace(/\\s+/g, "").trim();',
  '      if (t && btns.indexOf(t) < 0 && btns.length < 30) btns.push(t);',
  '    });',
  '    out.buttons = btns;',
  '    var ths = [];',
  '    [].forEach.call(document.querySelectorAll("table thead th"), function(t){',
  '      ths.push((t.textContent || "").replace(/\\s+/g, "").trim());',
  '    });',
  '    out.thead = ths;',
  '    out.tables = document.querySelectorAll("table").length;',
  '    out.h2count = document.querySelectorAll(".page-hd h2, h2").length;',
  '    /* 兜底错误页判据（技能 §8：读到 0 条时先判"整个 app 被换掉了"）*/',
  '    out.errCard = !!document.querySelector(".state-error, .app-error, .eb-wrap");',
  '    out.sidebar = document.querySelectorAll(".sb-item").length;',
  '    out.invEntry = [].some.call(document.querySelectorAll(".sb-item"), function(e){',
  '      return (e.textContent || "").indexOf("进销存") >= 0; });',
  '    /* 门禁拒绝痕迹：守卫回退时 Shell 会把 ?denied= 写进 query 再清掉，同时可能留提示 */',
  '    out.deniedHint = (document.body.innerText || "").indexOf("没有访问") >= 0;',
  '    return JSON.stringify(out);',
  '  } catch (e) { return JSON.stringify({ err: String(e) }); }',
  '})()'
].join('\n')

/* fetch 记录器：证明「主路径真的走通了」＋「非 2xx 长什么样」 */
const JS_REQ_READ = [
  '(function(){',
  '  var o = {};',
  '  o.armed = (typeof window.__WRITES !== "undefined") && Array.isArray(window.__WRITES);',
  '  o.writes = window.__WRITES || null;',
  '  o.gets = (window.__GETS || []).length;',
  '  o.bad = (window.__BAD || []).slice(0, 8);',
  '  o.perms = window.__PERMS_STATUS || null;',
  '  return JSON.stringify(o);',
  '})()'
].join('\n')

const buildInit = (token, userJson) => [
  'try{',
  'localStorage.setItem("hergent_v2_token",' + JSON.stringify(token) + ');',
  'localStorage.setItem("hergent_v2_tenant",' + JSON.stringify(TENANT) + ');',
  'localStorage.setItem("hergent_v2_csrf","probe-csrf");',
  'localStorage.setItem("hergent_v2_user",' + JSON.stringify(userJson) + ');',
  '}catch(e){}',
  ';(function(){',
  '  window.__WRITES=[]; window.__GETS=[]; window.__BAD=[];',
  '  function note(m,u,url){',
  '    try{',
  '      var mm=String(m||"GET").toUpperCase(), uu=String(u||"");',
  '      if(uu.indexOf("/api/")<0) return;',
  '      if(mm==="GET"||mm==="HEAD"){ window.__GETS.push(uu); }',
  '      else { window.__WRITES.push(mm+" "+uu); }',
  '    }catch(e){}',
  '  }',
  '  var f=window.fetch;',
  '  window.fetch=function(a,b){',
  '    var u=(typeof a==="string")?a:((a&&a.url)||""), m=(b&&b.method)||(a&&a.method)||"GET";',
  '    note(m,u);',
  '    var pr=f.apply(this,arguments);',
  '    try{',
  '      if(pr&&pr.then) pr=pr.then(function(r){',
  '        try{',
  '          if(String(u).indexOf("/api/auth/permissions")>=0) window.__PERMS_STATUS=r.status;',
  '          if(r.status>=400) window.__BAD.push(r.status+" "+u);',
  '        }catch(e){}',
  '        return r;',
  '      });',
  '    }catch(e){}',
  '    return pr;',
  '  };',
  '  var o=XMLHttpRequest.prototype.open;',
  '  XMLHttpRequest.prototype.open=function(m,u){ note(m,u); return o.apply(this,arguments); };',
  '})();'
].join('\n')

let NAV = 0
const hardGo = (p, hash, ms) => p.goto(BASE + '/?__r=' + (++NAV) + '_' + Date.now() + hash, ms || 4600)

/* ── §R 视觉基准量测（表单头字段格 computed style）────────────────────────────
   为什么要单独量：拆页时**最容易静默漂移的就是样式**。本轮为保住 `<style scoped>`
   编译后那条 `[data-v-xxx]`（特异性 0,2,0），采用的是**按内核复制样式块**而不是抽公共 css
   ⇒ 一旦某一页漏抄/抄错一条，视觉基准就在无声地变，而 DOM 结构断言**全绿**。
   判据设计（两层，缺一层都不够）：
     · 锚点层：采购订单页的数值 == 文档 §R 里写死的那组（外部锚，防"七页一起漂"）；
     · 一致层：其余 6 页与采购订单页**逐值相同**（内部锚，防"单页漂"）。 */
const JS_SM = [
  '(function(){',
  '  try {',
  '    var box = document.querySelector(".ipn-hd-box, .isn-hd-box, [class*=-hd-box]");',
  '    if (!box) return JSON.stringify({ err: "NO_HDBOX" });',
  '    var fs = [].slice.call(box.querySelectorAll(".ipn-f, .isn-f"));',
  '    var out = [];',
  '    for (var i = 0; i < fs.length && i < 10; i++) {',
  '      var f = fs[i], cs = getComputedStyle(f), r = f.getBoundingClientRect();',
  '      var lb = f.querySelector("label");',
  '      var ro = f.querySelector("span[class$=\\"-ro\\"]");',
  '      out.push({',
  '        h: Math.round(r.height),',
  '        pad: cs.padding,',
  '        bd: cs.borderTopWidth + " " + cs.borderTopStyle + " " + cs.borderTopColor,',
  '        radius: cs.borderTopLeftRadius,',
  '        bg: cs.backgroundColor,',
  '        lbAfter: lb ? getComputedStyle(lb, "::after").content : "",',
  '        lbFs: lb ? getComputedStyle(lb).fontSize : "",',
  '        ro: ro ? {',
  '          bd: getComputedStyle(ro).borderTopWidth + " " + getComputedStyle(ro).borderTopStyle,',
  '          bg: getComputedStyle(ro).backgroundColor,',
  '          h: Math.round(ro.getBoundingClientRect().height)',
  '        } : null',
  '      });',
  '    }',
  '    return JSON.stringify({ fields: out, n: fs.length });',
  '  } catch (e) { return JSON.stringify({ err: String(e) }); }',
  '})()'
].join('\n')

/* `::after` 的 content 在不同浏览器/写法下可能带引号或转义 ⇒ 归一化后再比。 */
const normAfter = (s) => String(s || '').replace(/["'\\]/g, '').trim()
const smKey = (f) => [f.h, f.pad, f.bd, f.radius, f.bg, normAfter(f.lbAfter), f.lbFs].join('~')
/* 🔴 v449 实测：**不能**把「全部格拼成一个串」再比 —— 各页的**格数本来就不同**
   （采购订单 6 格 / 调拨 4 格 / 车销订单 8 格，这正是拆页的目的）。
   拼串比对会把"每格都一致"误判成 FAIL（我第一版就是这么写的，7 条假红）。
   §R 的不变量是**每格的指标**，不是格数 ⇒ 比「去重后的指标集合」。 */
const smKeySet = (sm) => Array.from(new Set(((sm && sm.fields) || []).map(smKey))).sort()
const smUniform = (sm) => {
  const f = (sm && sm.fields) || []
  return f.length > 0 && new Set(f.map(smKey)).size === 1
}
/* 仅供打日志用（便于人眼核对"格数不同但格值相同"）。 */
const smKeyAll = (sm) => ((sm && sm.fields) || []).map(smKey).join(' | ')

const main = async () => {
  if (!TOKEN) { console.log('缺少 V449_TOKEN'); process.exit(2) }
  console.log('v449 探针 | 标签=' + LABEL + ' | BASE=' + BASE)

  const b = await launch({ headless: true })
  const p = await b.newPage()
  await p.enable()

  /* 🔴🔴 CDP 级网络监控（**跨导航存活**）—— 为什么非它不可：
     页面内 `window.fetch` 桩在 `page.goto` 换文档时**一起消失**（技能铁律 1）。
     本探针每个相位都 `hardGo`（必须真加载，否则路由不生效）⇒ 页面内计数**只覆盖最后一个文档**，
     用它做「全程零写入」自证是**严重低估**（第一版就是这么写的：读数只有 12 个 GET，
     而实际跑了 20+ 个文档）。CDP `Network.*` 事件挂在调试连接上，不受文档生命周期影响。
     ⚠️ 两条通道都留：页面内那条证明「桩装上了」，CDP 这条才是**全程**证据。 */
  const net = { writes: [], gets: 0, armed: false }
  await p.raw.send('Network.enable')
  p.raw.onEvent((msg) => {
    if (msg.method !== 'Network.requestWillBeSent') return
    net.armed = true
    const r = (msg.params && msg.params.request) || {}
    const m = String(r.method || 'GET').toUpperCase()
    const u = String(r.url || '')
    if (u.indexOf('/api/') < 0) return
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') net.gets++
    else net.writes.push(m + ' ' + u)
  })

  const idInit = await p.addInitScript(buildInit(TOKEN, ADMIN_USER))

  /* ══ 相位 0：登录态自检（技能：第一条断言固定为登录态，否则后面全是假结论）══ */
  section('相位 0 · 登录态自检')
  await hardGo(p, '#/inventory')
  const s0 = JSON.parse(await p.eval(JS_REQ_READ))
  guard('P0.1 写监控已安装（缺它 → P3 的零写入断言恒真）', s0.armed === true, true, s0.armed)
  rec('P0.2 登录态：/api/auth/permissions = 200', s0.perms === 200, 200, s0.perms)
  const o0 = JSON.parse(await p.eval(JS_OBS))
  guard('P0.3 未落到 #/login（令牌与 user 同账号）', String(o0.hash || '').indexOf('/login') < 0, 'not login', o0.hash)
  if (!(s0.perms === 200)) {
    console.log('\n🔴 登录态自检失败 ⇒ 中止，后续断言全部无意义。')
    await p.removeInitScript(idInit); await b.close(); process.exit(1)
  }
  rec('P0.4 侧栏「进销存」入口存在（门禁放行 admin）', o0.invEntry === true, true, o0.invEntry)
  rec('P0.5 无兜底错误页（先排除"整个 app 被换掉了"）', o0.errCard === false, false, o0.errCard)

  /* 现拉一个**真实**采购单号（GET，只读）：租户 1 的采购单 id 从 177 起，
     写死 1 会被服务端正确回绝（404「订单不存在」）⇒ 用假 id 测出来的只是"空表单"，
     既证明不了 `copy` 语义还活着，也量不到"原单"只读格的真值。 */
  const realId = Number(JSON.parse(await p.eval(
    '(function(){var h={"Authorization":"Bearer "+localStorage.getItem("hergent_v2_token"),'
    + '"X-Tenant-Id":"' + TENANT + '","X-Client":"web"};'
    + 'return fetch("/api/psi/purchase-orders?limit=1",{headers:h}).then(function(r){return r.json()})'
    + '.then(function(d){return JSON.stringify((d&&d.orders&&d.orders[0]&&d.orders[0].id)||0)})'
    + '.catch(function(){return "0"})})()')))
  guard('P0.6 取到真实采购单号（后续 from_po / copy 两条断言的前提）', realId > 0, '>0', realId)

  /* ══ 相位 1：七条新路径各自独立可达 ══════════════════════════════════════ */
  const obs = {}
  const sms = {}
  for (const pg of PAGES) {
    section('相位 1 · ' + pg.key + '  →  ' + pg.hash)
    p.errors.length = 0
    await hardGo(p, pg.hash)
    const o = JSON.parse(await p.eval(JS_OBS))
    obs[pg.key] = o
    sms[pg.key] = JSON.parse(await p.eval(JS_SM))
    const tag = pg.key
    rec('P1[' + tag + '].1 hash 落在自己的路径上', o.hash === pg.hash, pg.hash, o.hash)
    rec('P1[' + tag + '].2 页面标题 = 「' + pg.h2 + '」（**只剩一个** h2）',
      o.h2 === pg.h2 && o.h2count === 1, pg.h2 + ' / h2count=1', o.h2 + ' / h2count=' + o.h2count)
    rec('P1[' + tag + '].3 表单头挂了框式头类', o.hasHdBox === true, true, o.hdBox)
    rec('P1[' + tag + '].4 表单头字段**集合全等**', eq(o.labels, pg.labels), pg.labels, o.labels)
    rec('P1[' + tag + '].5 明细列**集合全等**', eq(o.thead, pg.thead), pg.thead, o.thead)
    rec('P1[' + tag + '].6 无兜底错误页', o.errCard === false, false, o.errCard)
    rec('P1[' + tag + '].7 控制台零报错', p.errors.length === 0, 0, p.errors.slice(0, 3))
    await p.screenshot(OUT + '/' + pg.key + '-页头区.png', { clip: { x: 0, y: 0, width: 1440, height: 400, scale: 1 } })
  }

  /* ══ 相位 1b：拆页的**判别力**——字段差异必须真的存在 ═══════════════════ */
  section('相位 1b · 拆页判别力：字段差异（同一批断言在"没拆"时会全红）')
  const L = (k) => obs[k].labels
  rec('P1b.1 车销订单**有**「送货司机」', hasTxt(L('车销订单'), '送货司机'), true, L('车销订单'))
  rec('P1b.2 自提订单**没有**「送货司机」（关键反例）', !hasTxt(L('自提订单'), '送货司机'), false, L('自提订单'))
  rec('P1b.3 车销退单**有**「送货司机」', hasTxt(L('车销退单'), '送货司机'), true, L('车销退单'))
  rec('P1b.4 自提退单**没有**「送货司机」（关键反例）', !hasTxt(L('自提退单'), '送货司机'), false, L('自提退单'))
  rec('P1b.5 订单页标签 = 销售仓库（不是"退货仓库"）',
    hasTxt(L('自提订单'), '销售仓库') && !hasTxt(L('自提订单'), '退货仓库'), true, L('自提订单'))
  rec('P1b.6 退单页标签 = 退货仓库（不是"销售仓库"）',
    hasTxt(L('自提退单'), '退货仓库') && !hasTxt(L('自提退单'), '销售仓库'), true, L('自提退单'))
  rec('P1b.7 采购订单标签 = 入库仓库', hasTxt(L('采购订单'), '入库仓库'), true, L('采购订单'))
  rec('P1b.8 采购退货标签 = 退货仓库', hasTxt(L('采购退货单'), '退货仓库'), true, L('采购退货单'))
  rec('P1b.9 退货页**没有**「部门」格（老板口径：退货只需供应商/客户 + 退货仓库）',
    !hasTxt(L('采购退货单'), '部门') && !hasTxt(L('自提退单'), '部门') && !hasTxt(L('车销退单'), '部门'),
    false, [L('采购退货单'), L('自提退单'), L('车销退单')])
  rec('P1b.10 订单页**有**「部门」格（v449 新增，落 sale_orders.department）',
    hasTxt(L('自提订单'), '部门') && hasTxt(L('车销订单'), '部门'), true, [L('自提订单'), L('车销订单')])
  rec('P1b.11 退单页明细列用「退货价」，订单页用「销售价」',
    hasTxt(obs['自提退单'].thead, '*退货价') && hasTxt(obs['自提订单'].thead, '*销售价')
    && !hasTxt(obs['自提订单'].thead, '*退货价'), true,
    [obs['自提订单'].thead.join(','), obs['自提退单'].thead.join(',')])
  rec('P1b.12 调拨页是**双仓**（调出仓库 + 调入仓库，各恰好一处）',
    hasTxt(L('调拨单'), '*调出仓库') && hasTxt(L('调拨单'), '*调入仓库'), true, L('调拨单'))
  rec('P1b.13 调拨页两步动作齐备（仅保存草稿 / 保存并过账）',
    hasTxt(obs['调拨单'].buttons, '仅保存草稿') && hasTxt(obs['调拨单'].buttons, '保存并过账'), true,
    obs['调拨单'].buttons.filter(x => /草稿|过账/.test(x)))
  rec('P1b.14 调拨页**没有**「退货仓库」「退货价」这类退单概念（老板拍板：调拨无退单）',
    !hasTxt(L('调拨单'), '退货') && !hasTxt(obs['调拨单'].thead, '退货'), false,
    [L('调拨单'), obs['调拨单'].thead.join(',')])

  /* ══ 相位 1c：§R 视觉基准（拆页时最容易静默漂移的东西）═══════════════════ */
  section('相位 1c · §R 视觉基准：七页表单头字段格 computed style')
  const REF = '采购订单'
  for (const pg of PAGES) {
    const sm = sms[pg.key]
    console.log('  [' + pg.key + '] 格数=' + (sm && sm.n)
      + '  去重指标数=' + smKeySet(sm).length + '  ' + smKeySet(sm).join(' ‖ '))
  }
  const refSm = sms[REF]
  const refFields = (refSm && refSm.fields) || []
  guard('P1c.0 锚点页（' + REF + '）量到了字段格（否则后面的"一致层"恒真）',
    refFields.length >= 3, '>=3', refFields.length)
  /* 锚点层：文档 §R 的写死数值（2026-09 真机实测并已由 v441~v448 连续验证） */
  const R_STD = { h: 32, pad: '0px 6px 0px 10px', bd: '1px solid rgb(229, 229, 234)', radius: '8px', bg: 'rgb(250, 250, 250)', lbAfter: '：' }
  rec('P1c.1 锚点：' + REF + ' 每格 = §R 基准（外部锚，防"七页一起漂"）',
    refFields.every(f => f.h === R_STD.h && f.pad === R_STD.pad && f.bd === R_STD.bd
      && f.radius === R_STD.radius && f.bg === R_STD.bg && normAfter(f.lbAfter) === R_STD.lbAfter),
    R_STD, refFields.map(smKey))
  /* 一致层：其余 6 页的「每格指标」与锚点页**逐值相同**（格数允许不同 —— 那是拆页的本意） */
  for (const pg of PAGES) {
    if (pg.key === REF) continue
    const sm = sms[pg.key]
    rec('P1c.2[' + pg.key + '] 每一格的指标 = 「' + REF + '」的指标（内部锚，防"单页漂"）',
      smUniform(sm) && eq(smKeySet(sm), smKeySet(refSm)), smKeySet(refSm), smKeySet(sm))
  }
  rec('P1c.2b 七页各自**内部均匀**（同页内所有格同值；混进一格异值会被 P1c.2 漏掉）',
    PAGES.every(pg => smUniform(sms[pg.key])), 'all uniform',
    PAGES.map(pg => pg.key + ':' + smKeySet(sms[pg.key]).length))
  rec('P1c.3 标签都带全角冒号 `：`（`::after` 生成，模板里没有）',
    PAGES.every(pg => ((sms[pg.key] || {}).fields || []).every(f => normAfter(f.lbAfter) === '：')),
    '：', PAGES.map(pg => normAfter(((sms[pg.key] || {}).fields || [])[0] && ((sms[pg.key] || {}).fields || [])[0].lbAfter)))

  /* ══ 相位 2：旧路径改道（该留的留、该剥的剥）════════════════════════════ */
  section('相位 2 · 旧路径兼容改道')
  const LEGACY = [
    { name: '旧·销售新建（无参）', from: '#/inventory/sale/new', want: '#/inventory/sale/self-pickup/new' },
    { name: '旧·销售新建（车销退）', from: '#/inventory/sale/new?type=vehicle_sale&kind=return', want: '#/inventory/sale/vehicle/return/new' },
    { name: '旧·销售新建（自提退）', from: '#/inventory/sale/new?type=self_pickup&kind=return', want: '#/inventory/sale/self-pickup/return/new' },
    { name: '旧·销售新建（调拨）', from: '#/inventory/sale/new?type=transfer&kind=order', want: '#/inventory/transfer/new' },
    { name: '旧·销售新建（调拨退·无落点 → 落自提订单）', from: '#/inventory/sale/new?type=transfer&kind=return', want: '#/inventory/sale/self-pickup/new' },
    { name: '旧·销售新建（脏 type 兜底）', from: '#/inventory/sale/new?type=__nope__&kind=order', want: '#/inventory/sale/self-pickup/new' }
  ]
  for (const t of LEGACY) {
    p.errors.length = 0
    await hardGo(p, t.from, 4200)
    const o = JSON.parse(await p.eval(JS_OBS))
    rec('P2[' + t.name + '] 改道到 ' + t.want, o.hash === t.want, t.want, o.hash)
    rec('P2[' + t.name + '] 改道后 URL 不带旧 `type`/`kind`（不撒谎）',
      String(o.hash).indexOf('type=') < 0 && String(o.hash).indexOf('kind=') < 0, 'clean', o.hash)
  }
  /* 采购侧两条：一条要**留** from_po，一条要**留** copy —— 与销售侧的"整体清空"口径相反 */
  p.errors.length = 0
  await hardGo(p, '#/inventory/purchase/new?kind=return&from_po=' + realId, 5600)
  const oP1 = JSON.parse(await p.eval(JS_OBS))
  const smP1 = JSON.parse(await p.eval(JS_SM))
  rec('P2[旧·采购退货转单] 改道到 /purchase/return/new',
    oP1.hash === '#/inventory/purchase/return/new?from_po=' + realId,
    '#/inventory/purchase/return/new?from_po=' + realId, oP1.hash)
  rec('P2[旧·采购退货转单] **保留** from_po（丢了可退预览就没了）',
    String(oP1.hash).indexOf('from_po=' + realId) >= 0, true, oP1.hash)
  rec('P2[旧·采购退货转单] 进入挂原单模式（有「原采购单」格）', hasTxt(oP1.labels, '原采购单'), true, oP1.labels)

  /* v448 的「只读值撤虚框 / 无底色 / 同高 30px」三条，**按新结构重测**：
     v448 当时量的是旧共用页的「原采购单」只读格；拆页后那一格只存在于**挂原单模式**
     （`?from_po=`），不挂原单的独立退货页本来就没有它。 */
  const roCell = ((smP1 || {}).fields || []).find(f => f && f.ro)
  guard('P2[挂原单·只读值] 量到只读格（否则下面三条恒真）', !!roCell, 'found', JSON.stringify(smP1 && smP1.fields))
  if (roCell) {
    rec('P2[挂原单·只读值] **已撤虚框**（不再 `dashed`）', roCell.ro.bd.indexOf('dashed') < 0, 'not dashed', roCell.ro.bd)
    rec('P2[挂原单·只读值] **无灰底**（不再是 `--bg2` 灰块）',
      roCell.ro.bg === 'rgba(0, 0, 0, 0)' || roCell.ro.bg === 'transparent', 'transparent', roCell.ro.bg)
    rec('P2[挂原单·只读值] 与框内控件**同高 30px**', roCell.ro.h === 30, 30, roCell.ro.h)
    rec('P2[挂原单模式] 字段格仍守 §R（与锚点页指标集合相同）',
      smUniform(smP1) && eq(smKeySet(smP1), smKeySet(refSm)), smKeySet(refSm), smKeySet(smP1))
  }

  /* copy 用相位 0 现拉到的**真实单号**（见那里的说明）。 */
  p.errors.length = 0
  await hardGo(p, '#/inventory/purchase/new?copy=' + realId, 5600)
  const oP2 = JSON.parse(await p.eval(JS_OBS))
  rec('P2[旧·采购新建 copy] **不误改道**，仍留在 purchase/new',
    oP2.hash === '#/inventory/purchase/new?copy=' + realId, '#/inventory/purchase/new?copy=' + realId, oP2.hash)
  rec('P2[旧·采购新建 copy] copy 语义仍生效（标题变「复制采购单」）', oP2.h2 === '复制采购单', '复制采购单', oP2.h2)
  rec('P2[旧·采购新建 copy] 复制态字段仍齐（供应商/部门/入库仓库）',
    hasTxt(oP2.labels, '*供应商') && hasTxt(oP2.labels, '部门') && hasTxt(oP2.labels, '*入库仓库'), true, oP2.labels)

  /* 顺带登记一条**既有**（非本轮）缺陷留证：`?copy=<不存在的单号>` 被服务端 404 回绝，
     而页面前端把它**静默吞掉**，照样显示「复制采购单」+ 一张空表单 ⇒ 用户分不清
     "原单是空的" 与 "原单根本不存在"。 */
  p.errors.length = 0
  await hardGo(p, '#/inventory/purchase/new?copy=1', 5200)
  const oP3 = JSON.parse(await p.eval(JS_OBS))
  rec('P2[旧·采购新建 copy] **不误改道**，仍留在 purchase/new',
    oP3.hash === '#/inventory/purchase/new?copy=1', '#/inventory/purchase/new?copy=1', oP3.hash)
  rec('**缺陷**（既有，非本轮）：`?copy=1`（单号不存在，服务端 404）时页面**仍显示「复制采购单」空表单**'
    + '、零报错、无提示 ⇒ 用户无法区分「原单为空」与「原单不存在」',
    oP3.h2 === '复制采购单' && p.errors.length === 0, '留证：现状如此', oP3.h2 + ' errors=' + p.errors.length)

  /* ══ 相位 3：零写入自证 ══════════════════════════════════════════════════ */
  section('相位 3 · 只读自证（CDP 级、跨导航 —— 运行时事实，不是口头承诺）')
  const s3 = JSON.parse(await p.eval(JS_REQ_READ))
  guard('P3.0 页面内桩已安装（第二通道；两条机制不同，互为佐证）', s3.armed === true, true, s3.armed)
  guard('P3.1 CDP 网络监控已武装且确实看到流量（缺它 P3.2 恒真）',
    net.armed === true && net.gets > 0, 'armed & gets>0', 'armed=' + net.armed + ' gets=' + net.gets)
  const RISK = /save|create|complete|return|submit|update|delete|bulk|import|execute|close/i
  const risky = net.writes.filter(w => RISK.test(w))
  rec('P3.2 全程**零业务写请求**（CDP 累计，覆盖全部 ' + net.gets + ' 个 GET 所在的所有文档）',
    net.writes.length === 0, 0, net.writes.slice(0, 6))
  rec('P3.3 主路径真的走通了（CDP 累计 GET > 20，否则"零写入"可能只是没访问）', net.gets > 20, '>20', net.gets)
  skip('P3.4 非 2xx 清点（本相位文档内读数，仅作记录）', JSON.stringify((s3.bad || []).slice(0, 6)))

  /* ══ 相位 4：低权限对照（同一构建、只换身份 ⇒ 行为必须翻转）═════════════ */
  section('相位 4 · 低权限对照（distributor：权限集不含 inventory）')
  if (!DIST_TOKEN) {
    skip('P4 全部', '未提供 V449_DIST_TOKEN')
  } else {
    const idDist = await p.addInitScript(buildInit(DIST_TOKEN, DIST_USER))
    await hardGo(p, '#/inventory/transfer/new', 5200)
    const oD = JSON.parse(await p.eval(JS_OBS))
    const sD = JSON.parse(await p.eval(JS_REQ_READ))
    guard('P4.0 低权限相位监控已安装', sD.armed === true, true, sD.armed)
    rec('P4.1 低权限**深链被拦**：没停在 /inventory/transfer/new', oD.hash !== '#/inventory/transfer/new',
      'not transfer/new', oD.hash)
    rec('P4.2 拒绝**看得见**：落到非进销存页 或 有明确拒绝提示（不许原地白屏）',
      (String(oD.hash).indexOf('/inventory') < 0) || oD.deniedHint === true, 'other-page|hint', oD.hash + ' hint=' + oD.deniedHint)
    rec('P4.3 低权限侧栏**没有**「进销存」入口（入口显隐与路由守卫是两件事，都要拦）',
      oD.invEntry === false, false, oD.invEntry)
    rec('P4.4 目标页**未渲染**（没有调拨页的双仓字段）', !hasTxt(oD.labels, '*调出仓库'), false, oD.labels)
    rec('P4.5 无兜底错误页（拦截 ≠ 崩了）', oD.errCard === false, false, oD.errCard)
    await p.screenshot(OUT + '/低权限-深链拦截.png', { clip: { x: 0, y: 0, width: 1440, height: 400, scale: 1 } })
    await p.removeInitScript(idDist)

    /* 反例 ①：同令牌、换回高权限身份 ⇒ 放行（证"拦住"由角色驱动，不是深链永远被拒） */
    const idAdmin2 = await p.addInitScript(buildInit(TOKEN, ADMIN_USER))
    await hardGo(p, '#/inventory/transfer/new', 5200)
    const oA = JSON.parse(await p.eval(JS_OBS))
    rec('P4.6 反例：换回 admin ⇒ **放行**（证明拦截由角色驱动，非深链本身被禁）',
      oA.hash === '#/inventory/transfer/new', '#/inventory/transfer/new', oA.hash)
    await p.removeInitScript(idAdmin2)
  }

  /* ══ 汇总 ════════════════════════════════════════════════════════════════ */
  const pass = R.filter(x => x.ok && !x.skip).length
  const fail = R.filter(x => !x.ok)
  const sk = R.filter(x => x.skip).length
  console.log('\n' + '='.repeat(98))
  console.log('[' + LABEL + '] 通过 ' + pass + ' 项，失败 ' + fail.length + ' 项，跳过 ' + sk + ' 项')
  if (fail.length) {
    console.log('失败清单：')
    fail.forEach(f => console.log('  ✗ ' + f.name + '  期望=' + JSON.stringify(f.want) + ' 实测=' + JSON.stringify(f.got)))
  }
  console.log('截图目录：' + OUT)
  await p.removeInitScript(idInit)
  await b.close()
  process.exit(fail.length ? 1 : 0)
}

main().catch(async (e) => { console.log('探针崩溃：' + (e && e.message)); process.exit(1) })
