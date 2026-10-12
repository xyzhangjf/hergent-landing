/* v473 生产真机端到端探针：本地服「HEAD 隔离构建产物」+ /api 透传生产 hergent.cn
 * 验：真实构建 × 真实生产 API × 22505 行真实数据下，销售单列表的
 *   渲染 / 总数 / 表头排序（order_by 三态）/ 筛选折叠 / 翻页 offset / 零报错
 * 用法：V473_TOKEN=<临时令牌> node v473-prod-e2e-live.mjs
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const DIST = '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tmp/v473-archive/hergent-cn-v2/dist-v473'
const TOKEN = process.env.V473_TOKEN
if (!TOKEN) { console.log('🔴 缺 V473_TOKEN'); process.exit(2) }
const SHOT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v473-sale-list'

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain;charset=utf-8' }

function serve(dir) {
  return new Promise((res) => {
    const srv = http.createServer((rq, rs) => {
      const u = (rq.url || '/')
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
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('PASS | ' + name + ' | ' + (detail || '')) }
  else { fail++; console.log('FAIL | ' + name + ' | ' + (detail || '')) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function J(p, e) { return p.eval(e).catch((x) => 'EVALERR ' + x.message) }

const r = await serve(DIST)
const b = await launch({ headless: true })
const p = await b.newPage(); p.__port = r.port
await p.enable()
await p.addInitScript(INIT)
await p.goto('http://127.0.0.1:' + r.port + '/?__r=' + Date.now() + '#/inventory/sale', 15000)
await sleep(3500)

const url = await J(p, 'location.href')
ok('A  页面到达销售单列表（未被踢回登录页）', String(url).includes('#/inventory/sale'), String(url))

const tbl = await J(p, JS('Array.from(document.querySelectorAll("table.isl-tbl tbody tr")).length'))
ok('B  表格渲染出真实数据行（生产 22505 张单）', Number(tbl) > 0, '行数=' + tbl)

const cnt = await J(p, 'document.body.innerText.match(/共[\\s\\S]{0,12}?张/)?.[0] || ""')
ok('C  计数文案含「共 … 张」', /张/.test(String(cnt)), String(cnt))

const row1 = await J(p, '(document.querySelector("table.isl-tbl tbody tr td:nth-child(2)")||{}).textContent || ""')
const pg = await J(p, 'document.body.innerText.match(/第\\s*1[–-]50\\s*张/)?.[0] || ""')
ok('D  分页器显示第 1–50 张区间', /第\s*1[–-]50\s*张/.test(String(pg)), String(pg))

/* 排序三态：点「金额」→ order_by；再点 → desc */
await J(p, 'Array.from(document.querySelectorAll("table.isl-tbl thead th")).find(t=>t.textContent.includes("金额")).click()')
await sleep(1600)
const q1 = await J(p, JS('(window.__REQ.filter(function(u){return String(u).includes("/api/psi/sale-orders")}).pop()||"")'))
ok('E  点「金额」表头发出 order_by=total_amount', /order_by=total_amount/.test(String(q1)), String(q1))
const chip = await J(p, '(document.querySelector(".isl-sortinfo")||{}).textContent || ""')
ok('F  排序 chip 出现且含列名', /金额/.test(String(chip)), String(chip))
const row2 = await J(p, '(document.querySelector("table.isl-tbl tbody tr td:nth-child(2)")||{}).textContent || ""')
ok('G  排序后表格内容真的变了（首行单号不同）', String(row1) !== String(row2) && String(row2).length > 0, row1 + ' → ' + row2)

await J(p, 'Array.from(document.querySelectorAll("table.isl-tbl thead th")).find(t=>t.textContent.includes("金额")).click()')
await sleep(1600)
const q2 = await J(p, JS('(window.__REQ.filter(function(u){return String(u).includes("/api/psi/sale-orders")}).pop()||"")'))
ok('H  再点一次切换到 asc（三态：无→降→升）', /order_dir=asc/.test(String(q2)), String(q2))

/* 第三下回到「无」：请求不带 order_by */
await J(p, 'Array.from(document.querySelectorAll("table.isl-tbl thead th")).find(t=>t.textContent.includes("金额")).click()')
await sleep(1600)
const q2b = await J(p, JS('(window.__REQ.filter(function(u){return String(u).includes("/api/psi/sale-orders")}).pop()||"")'))
ok('H2 第三下回到无排序（请求不带 order_by）', !/order_by/.test(String(q2b)), String(q2b))

/* 翻页 offset（分页器用 ‹ › 符号按钮） */
await J(p, 'Array.from(document.querySelectorAll("button.isl-pg")).filter(function(b){return b.textContent.trim()==="›"})[0].click()')
await sleep(1800)
const q3 = await J(p, JS('(window.__REQ.filter(function(u){return String(u).includes("/api/psi/sale-orders")}).pop()||"")'))
ok('I  翻页发出 offset=50（死链修复的真机取证）', /offset=50/.test(String(q3)), String(q3))

/* 筛选折叠 */
const more = await J(p, 'Array.from(document.querySelectorAll("button")).find(function(b){return b.textContent.includes("更多选项")}) ? "y" : "n"')
ok('J  「更多选项」折叠按钮在', more === 'y', more)
if (more === 'y') {
  await J(p, 'Array.from(document.querySelectorAll("button")).find(function(b){return b.textContent.includes("更多选项")}).click()')
  await sleep(600)
  const vis = await J(p, JS('Array.from(document.querySelectorAll(".isl-frow-sub")).filter(function(e){return e.offsetParent!==null}).length'))
  ok('K  展开后出现更多筛选项（isl-frow-sub 可见）', Number(vis) > 0, '可见行=' + vis)
}

const errs = await J(p, JS('window.__ERRS||[]'))
ok('L  零未捕获错误', String(errs) === '[]', String(errs))

try { await p.screenshot(SHOT + '/H1-生产真机端到端.png') } catch (e) {}
console.log('---')
console.log('PASS=' + pass + ' FAIL=' + fail + ' VERDICT: ' + (fail === 0 ? 'ALL_PASS' : 'HAS_FAIL'))
await b.close(); r.srv.close(); process.exit(fail === 0 ? 0 : 1)
