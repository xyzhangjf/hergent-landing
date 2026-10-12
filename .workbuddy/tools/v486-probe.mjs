/**
 * v486-probe.mjs —— 副驾三处增强验收（P1-② 代码复制 / P1-⑥ 多组澄清 / P1-⑤ 待办面板）
 *
 * 验收点：
 *  [复制] 1) 代码块渲染出「复制」按钮 .md-code-copy，且 data-code 携带正确源码
 *         2) 点击按钮 → 出现「已复制」反馈（copied 类 + 文案切换），证明点击委托链路通
 *  [多组澄清] 3) 注入 questions 数组 → 渲染出 N 个 .cp-clarify-grp（N=组数），表头「需要你定 N 件事」
 *             4) 每组带序号 + 各自 ask + 各自选项（旧单组协议不被破坏）
 *  [待办面板] 5) 产物面板头部出现 产物/待办 双 tab（.cp-art-tabs 且含 2 个 .cp-art-tab）
 *             6) 点「我的待办」→ 调 /api/ai/reminders 拉取并渲染 .cp-todo 列表
 *             7) 点某个待办的「完成」→ PATCH 该 id 且该项从列表消失
 *
 * 用法：
 *   node v486-probe.mjs dist-v486          # 本地构建
 *   node v486-probe.mjs --prod             # 生产真机
 */
import { launch } from './lib/cdp-lite.mjs'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.env.HG_ROOT || '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2'
const PROD = process.argv.includes('--prod')
const PROD_URL = 'https://hergent.cn/'
const DIST = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'dist-v486'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v486-probe' + (PROD ? '-prod' : '')
const API_TARGET = 'https://erp.hergent.cn'
const ACCT = { username: 'mptestsp', password: 'Mpsup@1' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try { fs.mkdirSync(SHOT_DIR, { recursive: true }) } catch { /* ignore */ }

const MIME = {
  '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.json': 'application/json', '.map': 'application/json',
}

let pass = 0, fail = 0
const ok = (c, n, e) => {
  if (c) { pass++; console.log('  PASS  ' + n + (e !== undefined ? '   -> ' + e : '')) }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '   -> ' + e : '')) }
}
const cnt = (calls, sub, method) => calls.filter(c => c.url.indexOf(sub) >= 0 && (!method || c.method === method)).length

function serve(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = req.url || '/'
      if (url.startsWith('/api')) {
        const pr = https.request({
          hostname: 'erp.hergent.cn', port: 443, path: url, method: req.method,
          headers: { ...req.headers, host: 'erp.hergent.cn' },
        }, (pres) => { res.writeHead(pres.statusCode || 502, pres.headers); pres.pipe(res) })
        pr.on('error', (e) => { res.writeHead(502); res.end('proxy error: ' + e.message) })
        req.pipe(pr)
        return
      }
      let f = path.join(dir, url.split('?')[0])
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dir, 'index.html')
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' })
      fs.createReadStream(f).pipe(res)
    })
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}

async function login() {
  const r = await fetch(API_TARGET + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ACCT),
  })
  const d = await r.json()
  if (!d.token) throw new Error('登录失败：' + JSON.stringify(d).slice(0, 200))
  return d
}

// 登录态 + 主题 + fetch 桩（待办列表 GET 返回假数据；完成 PATCH 返回 ok；会话同步假 200）
const initSrc = (d, theme) => [
  "localStorage.setItem('hergent_v2_token'," + JSON.stringify(d.token) + ");",
  "localStorage.setItem('hergent_v2_csrf'," + JSON.stringify(d.csrf_token || '') + ");",
  "localStorage.setItem('hergent_v2_user'," + JSON.stringify(JSON.stringify(d.user || {})) + ");",
  "localStorage.setItem('hergent_v2_tenant'," + JSON.stringify(String(d.tenant_id || 1)) + ");",
  "localStorage.setItem('hergent_theme','" + theme + "');",
  "(function(){var _f=window.fetch?window.fetch.bind(window):null;window.__probe={calls:[],n:0};",
  "window.fetch=function(u,o){var url=(u&&u.url)||String(u);var method=(o&&o.method)||'GET';",
  "function rec(){window.__probe.calls.push({url:url,method:method,order:++window.__probe.n});}",
  "var rm=url.match(/\\/api\\/ai\\/reminders\\/(\\d+)$/);",
  "if(url.indexOf('/api/ai/reminders')>=0 && !rm){rec();return Promise.resolve(new Response(JSON.stringify({items:[{id:1,title:'周五前完成回款对账',status:'pending',created_by:'boss'},{id:2,title:'冷库盘点一次',status:'pending',created_by:'boss'}]}),{status:200,headers:{'Content-Type':'application/json'}}));}",
  "if(rm){rec();return Promise.resolve(new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}}));}",
  "if(url.indexOf('/api/ai/sessions')>=0){rec();return Promise.resolve(new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}}));}",
  "return _f?_f(u,o):Promise.reject(new Error('no fetch'));};})();",
].join('')

// 注入两条消息：① 含代码块（验复制）② 多组澄清（验 groups）
const SETUP = [
  "(function(){",
  "var el=document.querySelector('#app');if(!el||!el.__vue_app__)return 'no-app';",
  "var app=el.__vue_app__;var pinia=app.config.globalProperties.$pinia;if(!pinia)return 'no-pinia';",
  "var st=pinia._s.get('app');if(!st)return 'no-store';",
  "st.ui.copilotOpen=true;st.chat.streaming=false;",
  "var code='const total = items.reduce((s,i)=>s+i.qty,0);\\nreturn total;';",
  "st.chat.messages=[",
  "{role:'user',content:'帮我写个合计函数'},",
  "{role:'assistant',content:'好的，示例如下：\\n```js\\n'+code+'\\n```\\n直接用即可。'},",
  "{role:'user',content:'几个决策要你拍板'},",
  "{role:'assistant',content:'需要你定几件事：',clarify:{questions:[{ask:'选哪个客户？',options:[{label:'东津门店',query:'客户=东津门店'},{label:'吾悦门店',query:'客户=吾悦门店'}]},{ask:'哪天开始？',options:[{label:'下周一',query:'时间=下周一'},{label:'下周三',query:'时间=下周三'}]}]}}",
  "];",
  "return 'ok';})()",
].join('')

const READ_CODE = "(function(){var b=document.querySelector('.md-code-copy');if(!b)return JSON.stringify({has:false});return JSON.stringify({has:true,dataCode:b.getAttribute('data-code'),tx:b.querySelector('.md-code-copy-tx')?b.querySelector('.md-code-copy-tx').textContent:null});})()"
const CLICK_COPY = "(function(){var b=document.querySelector('.md-code-copy');if(!b)return 'no-btn';b.click();return 'clicked';})()"
const READ_COPY_AFTER = "(function(){var b=document.querySelector('.md-code-copy');if(!b)return JSON.stringify({});return JSON.stringify({copied:b.classList.contains('copied'),tx:b.querySelector('.md-code-copy-tx')?b.querySelector('.md-code-copy-tx').textContent:null});})()"

const READ_CLARIFY = "(function(){var grps=[].slice.call(document.querySelectorAll('.cp-clarify-grp'));var qhd=document.querySelector('.cp-clarify-qhd');var g1=grps[0];return JSON.stringify({grpCount:grps.length,qhd:qhd?qhd.textContent.trim():null,g1Ask:g1?g1.querySelector('.cp-clarify-ask')?g1.querySelector('.cp-clarify-ask').textContent.trim():null:null,g1Opts:g1?g1.querySelectorAll('.cp-clarify-opt').length:0});})()"

const READ_TABS = "(function(){var tabs=document.querySelector('.cp-art-tabs');if(!tabs)return JSON.stringify({has:false});var btns=[].slice.call(tabs.querySelectorAll('.cp-art-tab'));return JSON.stringify({has:true,tabCount:btns.length,labels:btns.map(function(b){return b.textContent.trim();})});})()"
const CLICK_TODO_TAB = "(function(){var btns=[].slice.call(document.querySelectorAll('.cp-art-tab'));for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf('我的待办')>=0){btns[i].click();return 'clicked';}}return 'no-todo-tab';})()"
const READ_TODOS = "(function(){var items=[].slice.call(document.querySelectorAll('.cp-todo'));var t=items[0];return JSON.stringify({count:items.length,firstTitle:t?t.querySelector('.cp-todo-title').textContent.trim():null});})()"
const CLICK_DONE_FIRST = "(function(){var items=[].slice.call(document.querySelectorAll('.cp-todo'));if(!items.length)return 'no-todo';var btn=items[0].querySelector('.cp-icon-btn[title=标记完成]');if(!btn)return 'no-done-btn';btn.click();return 'clicked';})()"
const READ_TODOS_AFTER = "(function(){return JSON.stringify({count:document.querySelectorAll('.cp-todo').length});})()"
const READ_PROBE = "(function(){return JSON.stringify(window.__probe||{calls:[],n:0});})()"

async function open(dist, theme, cred) {
  let srv = null, target
  if (PROD) target = PROD_URL
  else { const r = await serve(path.join(ROOT, dist)); srv = r.srv; target = 'http://127.0.0.1:' + r.port + '/' }
  const browser = await launch({ headless: true, extraArgs: ['--autoplay-policy=no-user-gesture-required'] })
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(initSrc(cred, theme))
  await page.goto(target, PROD ? 15000 : 5500)
  return { srv, browser, page }
}

async function run(theme, cred) {
  console.log('\n================ ' + (PROD ? 'PROD hergent.cn' : DIST + ' @HG_ROOT') + ' / v486 / ' + theme + ' ================')
  const { srv, browser, page } = await open(DIST, theme, cred)
  try {
    const setup = await page.eval(SETUP)
    await sleep(PROD ? 2500 : 1500)
    if (setup !== 'ok') { ok(false, theme + ' 初始化注入', setup); await browser.close(); return }

    // ---- ② 代码复制 ----
    const code = JSON.parse(await page.eval(READ_CODE))
    ok(code.has, theme + ' 代码块渲染「复制」按钮 .md-code-copy', code.has)
    if (code.has) {
      const expected = 'const total = items.reduce((s,i)=>s+i.qty,0);\nreturn total;'
      ok(code.dataCode === expected, theme + ' 按钮 data-code 携带正确源码', code.dataCode ? code.dataCode.slice(0, 24) + '…' : null)
      const clk = await page.eval(CLICK_COPY)
      ok(clk === 'clicked', theme + ' 点击复制按钮', clk)
      await sleep(PROD ? 1200 : 700)
      const after = JSON.parse(await page.eval(READ_COPY_AFTER))
      ok(after.copied === true, theme + ' 点击后出现「已复制」反馈(copied 类)', after.copied)
      ok(after.tx === '已复制', theme + ' 文案切换为「已复制」', after.tx)
    }

    // ---- ⑥ 多组澄清 ----
    const cl = JSON.parse(await page.eval(READ_CLARIFY))
    ok(cl.grpCount === 2, theme + ' 渲染 2 个 .cp-clarify-grp（多组）', cl.grpCount)
    ok(cl.qhd && cl.qhd.indexOf('2') >= 0, theme + ' 表头「需要你定 N 件事」', cl.qhd)
    ok(cl.g1Ask && cl.g1Ask.indexOf('选哪个客户') >= 0, theme + ' 第 1 组 ask 正确', cl.g1Ask)
    ok(cl.g1Opts === 2, theme + ' 第 1 组含 2 个选项', cl.g1Opts)

    // ---- ⑤ 待办面板 ----
    const tabs = JSON.parse(await page.eval(READ_TABS))
    ok(tabs.has, theme + ' 产物面板出现 产物/待办 双 tab', tabs.has)
    ok(tabs.tabCount === 2, theme + ' tab 数量=2', tabs.tabCount)
    const clkTab = await page.eval(CLICK_TODO_TAB)
    ok(clkTab === 'clicked', theme + ' 点击「我的待办」tab', clkTab)
    await sleep(PROD ? 1500 : 900)
    const probe1 = JSON.parse(await page.eval(READ_PROBE))
    ok(cnt(probe1.calls, '/api/ai/reminders', 'GET') >= 1, theme + ' 待办 tab 触发 GET /api/ai/reminders', cnt(probe1.calls, '/api/ai/reminders', 'GET'))
    const todos = JSON.parse(await page.eval(READ_TODOS))
    ok(todos.count === 2, theme + ' 渲染 2 条待办 .cp-todo', todos.count)
    ok(todos.firstTitle && todos.firstTitle.indexOf('回款对账') >= 0, theme + ' 首条待办标题正确', todos.firstTitle)
    const clkDone = await page.eval(CLICK_DONE_FIRST)
    ok(clkDone === 'clicked', theme + ' 点首条「完成」', clkDone)
    await sleep(PROD ? 1200 : 700)
    const probe2 = JSON.parse(await page.eval(READ_PROBE))
    ok(cnt(probe2.calls, '/api/ai/reminders/1', 'PATCH') >= 1, theme + ' 完成触发 PATCH /api/ai/reminders/1', cnt(probe2.calls, '/api/ai/reminders/1', 'PATCH'))
    const afterDone = JSON.parse(await page.eval(READ_TODOS_AFTER))
    ok(afterDone.count === 1, theme + ' 完成后该条从列表消失（剩 1 条）', afterDone.count)

    await page.screenshot(path.join(SHOT_DIR, theme + '-v486.png')).catch(() => {})
  } catch (e) {
    ok(false, theme + ' 执行异常', e.message)
  } finally {
    await browser.close()
    if (srv) srv.close()
  }
}

async function main() {
  const cred = await login()
  await run('light', cred)
  await run('dark', cred)
  console.log('\n================ 结果 ================')
  console.log('PASS=' + pass + '  FAIL=' + fail)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('FATAL', e); process.exit(2) })
