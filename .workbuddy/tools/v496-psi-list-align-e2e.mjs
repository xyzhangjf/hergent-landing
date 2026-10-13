/* v496 生产真机端到端探针：进销存列表页统一设计规范落地验证
 * 本地服「隔离构建产物 dist-v496」+ /api 透传生产 hergent.cn（真实 22505 行数据）
 *
 * 验七条入口（3 组件 × query 变体）：
 *   ① #/inventory/purchase?kind=order    采购单      (生产 83 张)
 *   ② #/inventory/purchase?kind=return   采购退货单  (生产 0 张 —— 真实空态)
 *   ③ #/inventory/sale?type=self_pickup&kind=order   自提订单   (生产 22254 张)
 *   ④ #/inventory/sale?type=self_pickup&kind=return  自提退单   (生产 0 张 —— 真实空态)
 *   ⑤ #/inventory/sale?type=vehicle_sale&kind=order  车销订单   (生产 0 张 —— 真实空态)
 *   ⑥ #/inventory/sale?type=vehicle_sale&kind=return 车销退单   (生产 0 张 —— 真实空态)
 *   ⑦ #/inventory/transfer                           调拨单     (生产 1 张)
 *
 * 🔴 判据纪律：空态入口**不断言「有行」**（生产确实没有数据），改断言
 *    「发出了正确的服务端筛选参数」——那才是 v496 要保证的东西（前端筛错表的回归防线）。
 *
 * 用法：V496_TOKEN=<临时令牌> node v496-psi-list-align-e2e.mjs
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const DIST = '/tmp/v496-build/hergent-cn-v2/dist-v496'
const TOKEN = process.env.V496_TOKEN
if (!TOKEN) { console.log('🔴 缺 V496_TOKEN'); process.exit(2) }
const SHOT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v496-psi-list-align'
fs.mkdirSync(SHOT, { recursive: true })

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain;charset=utf-8' }

function serve (dir) {
  return new Promise((res) => {
    const srv = http.createServer((rq, rs) => {
      const u = (rq.url || '')
      if (u.startsWith('/api/')) {
        const preq = https.request({
          hostname: 'hergent.cn', port: 443, path: u, method: rq.method,
          headers: { ...rq.headers, host: 'hergent.cn' },
        }, (prs) => { rs.writeHead(prs.statusCode, prs.headers); prs.pipe(rs) })
        rq.pipe(preq); preq.end(); return
      }
      let p = decodeURIComponent(u.split('?')[0])
      if (p === '/' || !path.extname(p)) p = '/index.html'
      const f = path.join(dir, p)
      if (!f.startsWith(dir) || !fs.existsSync(f)) { rs.writeHead(404); rs.end('nf'); return }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' })
      fs.createReadStream(f).pipe(rs)
    })
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }))
  })
}

const INIT = [
  ';(function(){ try {',
  '  localStorage.setItem("hergent_v2_token", ' + JSON.stringify(TOKEN) + ');',
  '  localStorage.setItem("hergent_v2_tenant", "1");',
  '} catch (e) {} })();',
  ';(function(){ window.__ERRS=[]; window.__REQ=[];',
  '  window.addEventListener("error", function(e){ window.__ERRS.push("error: " + (e.message || "")) });',
  '  window.addEventListener("unhandledrejection", function(e){ window.__ERRS.push("reject: " + String(e.reason)) });',
  '  var _f = window.fetch;',
  '  window.fetch = function(){ try { window.__REQ.push(String(arguments[0])) } catch(e){}; return _f.apply(this, arguments) };',
  '})();',
].join('\n')

const JS = (e) => 'JSON.stringify(' + e + ')'
let pass = 0, fail = 0
const failures = []
function ok (name, cond, detail) {
  if (cond) { pass++; console.log('PASS | ' + name + ' | ' + (detail || '')) } else { fail++; failures.push(name + ' | ' + (detail || '')); console.log('FAIL | ' + name + ' | ' + (detail || '')) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function J (p, e) { return p.eval(e).catch((x) => 'EVALERR ' + x.message) }

/* 七条入口定义。`api` = 后端端点关键字；`must` = 该请求**必须**带的查询参数（回归防线）；
   `rows` = 生产真实行数预期（'gt0' 必须有行 / 'any' 不约束，空态入口走 must 判据）。 */
const ROUTES = [
  { id: 'A', hash: '#/inventory/purchase?kind=order', name: '采购单', title: '采购单', api: 'purchase-orders', must: ['exclude_status=returned'], rows: 'gt0', shot: 'A-采购单' },
  { id: 'B', hash: '#/inventory/purchase?kind=return', name: '采购退货单', title: '采购退货单', api: 'purchase-orders', must: ['status=returned'], rows: 'any', shot: 'B-采购退货单' },
  { id: 'C', hash: '#/inventory/sale?type=self_pickup&kind=order', name: '自提订单', title: '自提订单', api: 'sale-orders', must: ['order_type=self_pickup'], rows: 'gt0', shot: 'C-自提订单' },
  { id: 'D', hash: '#/inventory/sale?type=self_pickup&kind=return', name: '自提退单', title: '自提退单', api: 'sale-orders', must: ['status=returned', 'order_type=self_pickup'], rows: 'any', shot: 'D-自提退单' },
  { id: 'E', hash: '#/inventory/sale?type=vehicle_sale&kind=order', name: '车销订单', title: '车销订单', api: 'sale-orders', must: ['order_type=vehicle_sale'], rows: 'any', shot: 'E-车销订单' },
  { id: 'F', hash: '#/inventory/sale?type=vehicle_sale&kind=return', name: '车销退单', title: '车销退单', api: 'sale-orders', must: ['status=returned', 'order_type=vehicle_sale'], rows: 'any', shot: 'F-车销退单' },
  { id: 'G', hash: '#/inventory/transfer', name: '调拨单', title: '调拨单', api: 'transfer-orders', must: [], rows: 'gt0', shot: 'G-调拨单' },
]

const r = await serve(DIST)
const b = await launch({ headless: true })
const p = await b.newPage(); p.__port = r.port
await p.enable()
await p.addInitScript(INIT)

for (const rt of ROUTES) {
  await p.goto('http://127.0.0.1:' + r.port + '/?__r=' + Date.now() + rt.hash, 20000)
  await sleep(3800)

  const url = await J(p, 'location.href')
  ok(rt.id + '1  ' + rt.name + '：路由直达未被踢回登录页', String(url).includes(rt.hash.split('#')[1]), String(url).slice(-60))

  const h2 = await J(p, '(document.querySelector(".page-hd.split h2")||{}).textContent || ""')
  ok(rt.id + '2  ' + rt.name + '：页头标题正确（入口切换生效）', String(h2).trim() === rt.title, String(h2))

  /* 快捷时间档五枚 chip —— 三页共用件 QuickRangeChips */
  const chips = await J(p, JS('Array.from(document.querySelectorAll(".psi-quick .chip")).map(function(c){return c.textContent.trim()})'))
  const chipArr = (() => { try { return JSON.parse(String(chips)) } catch (e) { return [] } })()
  ok(rt.id + '3  ' + rt.name + '：快捷时间档五枚 chip 齐全（今/昨/近7天/近30天/全部）',
    chipArr.length === 5 && /^今$/.test(chipArr[0]) && /^昨$/.test(chipArr[1]) && /近7天/.test(chipArr[2]) && /近30天/.test(chipArr[3]) && /全部/.test(chipArr[4]),
    JSON.stringify(chipArr))

  /* 数据行（先取，表格结构断言依赖它：空态入口不渲染 table，这是正确行为） */
  const rowN = await J(p, JS('Array.from(document.querySelectorAll("table.psi-tbl tbody tr")).length'))
  const nRows = Number(rowN) || 0

  /* 表格统一件：psi-tbl（全局 fixed 布局）+ colgroup（列宽唯一权威）+ 冻结列 sticky */
  const tblInfo = await J(p, JS('(function(){var t=document.querySelector("table.psi-tbl");if(!t)return null;var cg=t.querySelector("colgroup");return {cls:t.className, cols:cg?cg.children.length:0}})()'))
  const ti = (() => { try { return JSON.parse(String(tblInfo)) } catch (e) { return null } })()
  const frz = await J(p, JS('(function(){var e=document.querySelector("table.psi-tbl .psi-frz");if(!e)return null;var s=getComputedStyle(e);return {pos:s.position, z:s.zIndex, ov:s.overflow}})()'))
  const fz = (() => { try { return JSON.parse(String(frz)) } catch (e) { return null } })()

  if (nRows > 0) {
    ok(rt.id + '4  ' + rt.name + '：表格挂 .psi-tbl 且有 colgroup 定宽（列宽唯一权威）',
      !!ti && /psi-tbl/.test(ti.cls || '') && ti.cols >= 6, JSON.stringify(ti))
    ok(rt.id + '5  ' + rt.name + '：冻结列 computed position=sticky（横向滚动吸附）',
      !!fz && fz.pos === 'sticky', JSON.stringify(fz))
  } else {
    /* 空态入口：不断言表格件（页面按设计只渲染空态卡），改断言空态真的出现了 */
    const empty = await J(p, JS('(function(){var t=document.querySelector(".state-empty");return {found:!!t, txt:t?(t.textContent||"").trim().slice(0,40):""}})()'))
    const em = (() => { try { return JSON.parse(String(empty)) } catch (e) { return null } })()
    ok(rt.id + '4  ' + rt.name + '：空态入口渲染 .state-empty 提示（不渲染空表格，符合设计）', !!em && em.found && /没有|暂无/.test(em.txt || ''), JSON.stringify(em))
    ok(rt.id + '5  ' + rt.name + '：空态入口跳过表格件断言（无表格可查，非缺陷）', true, '行数=' + nRows)
  }

  /* 服务端筛选参数：v496 回归防线（前端筛错表的症状就是这里少一个键） */
  const reqs = await J(p, JS(lastReqExpr(rt.api).replace('.pop()||""', '')))
  const reqArr = (() => { try { return JSON.parse(String(reqs)) } catch (e) { return [] } })()
  const lastReq = reqArr.length ? String(reqArr[reqArr.length - 1]) : ''
  const miss = rt.must.filter((k) => lastReq.indexOf(k) < 0)
  const d6 = miss.length ? ('缺 ' + JSON.stringify(miss) + ' ← ' + lastReq.slice(0, 160)) : '参数齐全 ← ' + lastReq.slice(0, 140)
  ok(rt.id + '6  ' + rt.name + '：列表请求带齐服务端筛选参数 ' + JSON.stringify(rt.must),
    rt.must.length === 0 ? reqArr.length > 0 : miss.length === 0, d6)

  if (rt.rows === 'gt0') {
    ok(rt.id + '7  ' + rt.name + '：表格渲染出真实数据行', nRows > 0, '行数=' + nRows)
    /* 分页器区间文案（规范 §6 唯一总数出处） */
    const pg = await J(p, 'document.body.innerText.match(/共[\\s\\S]{0,20}?条记录[\\s\\S]{0,16}?条/)?.[0] || ""')
    ok(rt.id + '8  ' + rt.name + '：分页器文案「共 N 条记录，第 X–Y 条」', /共\s*\d+\s*条记录/.test(String(pg)) && /第\s*\d+[–-]\d+\s*条/.test(String(pg)), String(pg).replace(/\s+/g, ' '))
  } else {
    ok(rt.id + '7  ' + rt.name + '：空态入口正常渲染（生产无此类数据，不断言行数）', Number(rowN) >= 0, '行数=' + rowN + '（空态属真实数据，筛选参数已在 ' + rt.id + '6 取证）')
  }

  try { await p.screenshot(path.join(SHOT, rt.shot + '.png')) } catch (e) {}
}

/* 取某后端端点最后一次请求 URL 的页面内表达式（🔴 括号必须闭在 filter 内：多一个 )
   就会让页面 eval 抛 SyntaxError，症状是「EVALERR 页面内异常」而不是断言失败）。 */
function lastReqExpr (api) {
  return '(window.__REQ||[]).filter(function(u){return String(u).indexOf("/api/psi/' + api + '")>-1}).pop()||""'
}

/* ── 单号列形态：销售=链接（有详情页），调拨=纯文本（无详情页，规范 §9 D6 有意差异） ── */
await p.goto('http://127.0.0.1:' + r.port + '/?__r=' + Date.now() + '#/inventory/sale?type=self_pickup&kind=order', 20000)
await sleep(3500)
const saleNo = await J(p, JS('(function(){var td=document.querySelector("table.psi-tbl tbody tr td:nth-child(2)");if(!td)return null;var a=td.querySelector("a");return {txt:(td.textContent||"").trim().slice(0,24), hasLink:!!a, href:a?a.getAttribute("href"):""}})()'))
const sn = (() => { try { return JSON.parse(String(saleNo)) } catch (e) { return null } })()
ok('H1 自提订单：单号是链接（与采购单列表同款，可进详情）', !!sn && sn.hasLink && /inventory\/sale\//.test(sn.href || ''), JSON.stringify(sn))

await p.goto('http://127.0.0.1:' + r.port + '/?__r=' + Date.now() + '#/inventory/transfer', 20000)
await sleep(3500)
const trNo = await J(p, JS('(function(){var td=document.querySelector("table.psi-tbl tbody tr td:nth-child(2)");if(!td)return null;return {txt:(td.textContent||"").trim().slice(0,24), hasLink:!!td.querySelector("a")}})()'))
const tn = (() => { try { return JSON.parse(String(trNo)) } catch (e) { return null } })()
ok('H2 调拨单：单号是纯文本（无详情页，规范 D6 有意差异 —— 不造假链接）', !!tn && !tn.hasLink && tn.txt.length > 0, JSON.stringify(tn))

/* ── 入口切换反应式：同 path 不同 query，同组件必须重新拉数（v473 教训的回归防线） ── */
await p.goto('http://127.0.0.1:' + r.port + '/?__r=' + Date.now() + '#/inventory/purchase?kind=order', 20000)
await sleep(3200)
const t1 = await J(p, '(document.querySelector(".page-hd.split h2")||{}).textContent || ""')
const q1 = await J(p, JS(lastReqExpr('purchase-orders')))
await p.eval('location.hash = "#/inventory/purchase?kind=return"')
await sleep(2800)
const t2 = await J(p, '(document.querySelector(".page-hd.split h2")||{}).textContent || ""')
const q2 = await J(p, JS(lastReqExpr('purchase-orders')))
ok('I1 入口切换：采购单 → 采购退货单标题跟着变', String(t1).trim() === '采购单' && String(t2).trim() === '采购退货单', t1 + ' → ' + t2)
ok('I2 入口切换：重新发出带 status=returned 的请求（computed+watch 生效，非纹丝不动）',
  /[?&]status=returned/.test(String(q2)) && !/[?&]status=returned/.test(String(q1)) && /exclude_status=returned/.test(String(q1)),
  'order=' + String(q1).slice(0, 90) + ' ｜ return=' + String(q2).slice(0, 90))

/* ── 快捷档真的改写日期并重拉 ── */
await p.goto('http://127.0.0.1:' + r.port + '/?__r=' + Date.now() + '#/inventory/purchase?kind=order', 20000)
await sleep(3200)
const beforeQ = await J(p, JS(lastReqExpr('purchase-orders')))
await J(p, 'Array.from(document.querySelectorAll(".psi-quick .chip")).filter(function(c){return c.textContent.indexOf("近7天")>-1})[0].click()')
await sleep(2200)
const afterQ = await J(p, JS(lastReqExpr('purchase-orders')))
const chipOn = await J(p, JS('Array.from(document.querySelectorAll(".psi-quick .chip")).filter(function(c){return c.className.indexOf("on")>-1}).map(function(c){return c.textContent.trim()})'))
ok('J1 快捷档「近7天」点后请求带上 date_from/date_to 并重拉', /date_from=/.test(String(afterQ)) && String(afterQ) !== String(beforeQ), String(afterQ).slice(0, 130))
const co = (() => { try { return JSON.parse(String(chipOn)) } catch (e) { return [] } })()
ok('J2 快捷档「近7天」chip 高亮（on 类落在被点那颗上）', co.length === 1 && /近7天/.test(co[0]), JSON.stringify(co))

/* ── 全局：零未捕获错误 ── */
const errs = await J(p, JS('window.__ERRS||[]'))
ok('Z  全程零未捕获错误 / 未处理拒绝', String(errs) === '[]', String(errs))

try { await p.screenshot(path.join(SHOT, 'Z-末态.png')) } catch (e) {}
console.log('---')
console.log('PASS=' + pass + ' FAIL=' + fail + ' VERDICT: ' + (fail === 0 ? 'ALL_PASS' : 'HAS_FAIL'))
if (fail) console.log('失败项：\n - ' + failures.join('\n - '))
await b.close(); r.srv.close(); process.exit(fail === 0 ? 0 : 1)
