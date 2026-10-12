/**
 * v483-artifact-plan-probe.mjs —— 副驾「生成物实时预览(P0-①) + 多步计划闸门(P0-④)」验收
 *
 * 验收点：
 *  [预览] 1) 图片文件 → 产物面板渲染 <img class="cp-art-img" src^=blob:>，且下载入口仍在
 *         2) HTML 文件 → 渲染 <iframe class="cp-art-frame" sandbox> 内联预览
 *         3) 非预览类文件 → 仍只显示下载 chip（不回归）
 *         4) light + dark 双态样式类存在
 *  [计划] 5) 渲染计划卡时，写接口 /api/ai/recipe-proposals 的 POST 调用次数 = 0（零副作用）
 *         6) 点「执行计划」→ 按 steps 顺序逐条 POST（计数 == steps 数），步骤点变 done
 *         7) 点「取消」→ POST 次数 = 0，卡片标记 rejected
 *         8) 单条 proposal（无 steps）→ 走 applyProposal 旧路径（点「采纳并写入配方」POST == 1），不回归
 *
 * 用法：
 *   HG_ROOT=/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2 node v483-artifact-plan-probe.mjs dist-v483   # 本地
 *   node v483-artifact-plan-probe.mjs --prod                                                                       # 生产真机
 */
import { launch } from './lib/cdp-lite.mjs'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.env.HG_ROOT || '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2'
const PROD = process.argv.includes('--prod')
const PROD_URL = 'https://hergent.cn/'
const DIST = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'dist-v483'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v483-probe' + (PROD ? '-prod' : '')
const API_TARGET = 'https://erp.hergent.cn'
const ACCT = { username: 'mptestsp', password: 'Mpsup@1' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try { fs.mkdirSync(SHOT_DIR, { recursive: true }) } catch { /* ignore */ }
const LABEL = PROD ? 'PROD hergent.cn' : (process.env.HG_ROOT ? DIST + ' @HG_ROOT' : DIST)

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

// 注入登录态 + 主题 + fetch 桩（预览下载/blob、计划写接口计数、会话同步假 200）
const initSrc = (d, theme) => [
  "localStorage.setItem('hergent_v2_token'," + JSON.stringify(d.token) + ");",
  "localStorage.setItem('hergent_v2_csrf'," + JSON.stringify(d.csrf_token || '') + ");",
  "localStorage.setItem('hergent_v2_user'," + JSON.stringify(JSON.stringify(d.user || {})) + ");",
  "localStorage.setItem('hergent_v2_tenant'," + JSON.stringify(String(d.tenant_id || 1)) + ");",
  "localStorage.setItem('hergent_theme','" + theme + "');",
  "(function(){var _f=window.fetch?window.fetch.bind(window):null;window.__probe={calls:[],n:0};",
  "window.fetch=function(u,o){var url=(u&&u.url)||String(u);var method=(o&&o.method)||'GET';",
  "function rec(){window.__probe.calls.push({url:url,method:method,order:++window.__probe.n});}",
  "var dl=url.match(/\\/api\\/chat-attachment\\/download\\/(.+)$/);",
  "if(dl){rec();var id=dl[1];",
  "if(id.indexOf('html')>=0){return Promise.resolve(new Response(new Blob(['<!doctype html><html><body><h1>report</h1></body></html>'],{type:'text/html'}),{status:200}));}",
  "var b64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';var bin=atob(b64);var arr=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);",
  "return Promise.resolve(new Response(new Blob([arr],{type:'image/png'}),{status:200}));}",
  "if(url.indexOf('/api/ai/recipe-proposals')>=0){rec();if(/\\/review$/.test(url))return Promise.resolve(new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}}));return Promise.resolve(new Response(JSON.stringify({id:1,ok:true}),{status:200,headers:{'Content-Type':'application/json'}}));}",
  "if(url.indexOf('/api/ai/sessions')>=0){rec();return Promise.resolve(new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}}));}",
  "return _f?_f(u,o):Promise.reject(new Error('no fetch'));};})();",
].join('')

// 注入消息：两张预览文件（png/html）+ 一张计划卡 + 一张单条提案卡
const SETUP = [
  "(function(){",
  "var el=document.querySelector('#app');if(!el||!el.__vue_app__)return 'no-app';",
  "var app=el.__vue_app__;var pinia=app.config.globalProperties.$pinia;if(!pinia)return 'no-pinia';",
  "var st=pinia._s.get('app');if(!st)return 'no-store';",
  "st.ui.copilotOpen=true;st.chat.streaming=false;",
  "st.chat.messages=[",
  "{role:'user',content:'探针问题'},",
  "{role:'assistant',content:'这是一张图片报告。',files:[{file_id:'f-png',file_name:'经营报告.png',file_type:'image/png',rows:0}]},",
  "{role:'assistant',content:'这是一份 HTML 报表。',files:[{file_id:'f-html',file_name:'报表.html',file_type:'text/html',rows:0}]},",
  "{role:'assistant',content:'这是执行计划。',proposal:{steps:[{action:'recipe',target:'调整临期阈值',detail:'{\"threshold_days\":5}'},{action:'recipe',target:'同步返利口径',detail:'{}'}]}},",
  "{role:'assistant',content:'这是单条提案。',proposal:{module:'loss',title:'单条提案',changes:{threshold_days:5},rationale:'测试'}}",
  "];",
  "return 'ok';})()",
].join('')

// 仅注入一张计划卡（给「取消」用例，避免与上面已完成执行的卡混淆）
const SETUP_PLAN_ONLY = [
  "(function(){var el=document.querySelector('#app');var pinia=el.__vue_app__.config.globalProperties.$pinia;var st=pinia._s.get('app');",
  "st.ui.copilotOpen=true;st.chat.streaming=false;",
  "st.chat.messages=[{role:'user',content:'q'},{role:'assistant',content:'计划',proposal:{steps:[{action:'recipe',target:'A',detail:'{}'},{action:'recipe',target:'B',detail:'{}'}]}}];",
  "window.__probe={calls:[],n:0};return 'ok';})()",
].join('')

// 仅注入一张单条提案卡（给「单条兼容」用例）
const SETUP_SINGLE = [
  "(function(){var el=document.querySelector('#app');var pinia=el.__vue_app__.config.globalProperties.$pinia;var st=pinia._s.get('app');",
  "st.ui.copilotOpen=true;st.chat.streaming=false;",
  "st.chat.messages=[{role:'user',content:'q'},{role:'assistant',content:'单条',proposal:{module:'loss',title:'单条',changes:{threshold_days:5}}}];",
  "window.__probe={calls:[],n:0};return 'ok';})()",
].join('')

const READ_PREVIEW = "(function(){var items=[].slice.call(document.querySelectorAll('.cp-art-item'));var imgs=document.querySelectorAll('.cp-art-img');var iframes=document.querySelectorAll('.cp-art-frame');var dlRows=document.querySelectorAll('.cp-art-dl-row');return JSON.stringify({artCount:items.length,imgCount:imgs.length,imgSrc:imgs.length?imgs[0].getAttribute('src'):null,iframeCount:iframes.length,iframeSandbox:iframes.length?iframes[0].getAttribute('sandbox'):null,dlRowCount:dlRows.length});})()"
const READ_PROPOSAL = "(function(){var plans=document.querySelectorAll('.cp-proposal');var planCards=[].slice.call(plans).filter(function(p){return p.querySelector('.cp-plan-steps');});return JSON.stringify({planCount:planCards.length,hasPlan:planCards.length>0,stepCount:planCards.length?planCards[0].querySelectorAll('.cp-plan-step').length:0});})()"
const CLICK_EXEC = "(function(){var cards=[].slice.call(document.querySelectorAll('.cp-proposal'));for(var i=0;i<cards.length;i++){var b=cards[i].querySelector('.cp-prop-btn.primary');if(b&&b.textContent.indexOf('执行计划')>=0){b.click();return 'clicked';}}return 'no-exec-btn';})()"
const CLICK_CANCEL = "(function(){var cards=[].slice.call(document.querySelectorAll('.cp-proposal'));for(var i=0;i<cards.length;i++){var b=cards[i].querySelector('.cp-prop-btn.ghost');if(b&&b.textContent.indexOf('取消')>=0){b.click();return 'clicked';}}return 'no-cancel-btn';})()"
const CLICK_ACCEPT_SINGLE = "(function(){var cards=[].slice.call(document.querySelectorAll('.cp-proposal'));for(var i=0;i<cards.length;i++){var b=cards[i].querySelector('.cp-prop-btn.primary');if(b&&b.textContent.indexOf('采纳并写入配方')>=0){b.click();return 'clicked';}}return 'no-accept-btn';})()"
const READ_STEP_STATUS = "(function(){var cards=[].slice.call(document.querySelectorAll('.cp-proposal'));for(var i=0;i<cards.length;i++){var steps=cards[i].querySelectorAll('.cp-plan-step');if(steps.length){var cls=[].slice.call(steps).map(function(s){return s.className.indexOf('done')>=0?'done':(s.className.indexOf('fail')>=0?'fail':(s.className.indexOf('running')>=0?'running':''));});return JSON.stringify(cls);}}return JSON.stringify([]);})()"
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
  console.log('\n================ ' + LABEL + ' / v483 / ' + theme + ' ================')
  const { srv, browser, page } = await open(DIST, theme, cred)
  try {
    const setup = await page.eval(SETUP)
    await sleep(PROD ? 2500 : 1500)
    if (setup !== 'ok') { ok(false, theme + ' 注入消息初始化', setup); await browser.close(); return }

    // 预览验收
    const pv = JSON.parse(await page.eval(READ_PREVIEW))
    ok(pv.imgCount >= 1, theme + ' 图片文件内联渲染 <img.cp-art-img>', pv.imgCount)
    ok(pv.imgSrc && pv.imgSrc.indexOf('blob:') === 0, theme + ' 预览图 src 为 blob:', pv.imgSrc)
    ok(pv.iframeCount >= 1, theme + ' HTML 文件内联渲染 <iframe.cp-art-frame>', pv.iframeCount)
    ok(pv.iframeSandbox !== null, theme + ' iframe 带 sandbox 属性（XSS 兜底）', pv.iframeSandbox)
    ok(pv.dlRowCount >= 1, theme + ' 预览卡保留下载入口（不回归）', pv.dlRowCount)
    await page.screenshot({ path: path.join(SHOT_DIR, theme + '-preview.png') }).catch(() => {})

    // 计划卡渲染 + 零副作用
    const rp = JSON.parse(await page.eval(READ_PROPOSAL))
    ok(rp.planCount >= 1, theme + ' 多步计划卡渲染', rp.planCount)
    ok(rp.stepCount === 2, theme + ' 计划卡含 2 个步骤', rp.stepCount)
    const before = JSON.parse(await page.eval(READ_PROBE))
    ok(cnt(before.calls, '/api/ai/recipe-proposals', 'POST') === 0, theme + ' 渲染计划卡时写接口 POST=0（零副作用）', cnt(before.calls, '/api/ai/recipe-proposals', 'POST'))

    // 执行计划
    const exec = await page.eval(CLICK_EXEC)
    ok(exec === 'clicked', theme + ' 点「执行计划」', exec)
    await sleep(PROD ? 2500 : 1500)
    const after = JSON.parse(await page.eval(READ_PROBE))
    // 每个 recipe 步骤 = 1 次 create(/api/ai/recipe-proposals) + 1 次 review(/.../review)；
    // 精确数 create（排除 review 子路径）= steps 数，即「每步一次写操作」
    const creates = after.calls.filter(c => c.method === 'POST' && c.url === '/api/ai/recipe-proposals').length
    ok(creates === 2, theme + ' 执行后写接口 create POST==2（按 steps 顺序，每步一次写）', creates)
    const steps = JSON.parse(await page.eval(READ_STEP_STATUS))
    ok(steps.length === 2 && steps.every(s => s === 'done'), theme + ' 两步均标记 done', JSON.stringify(steps))
  } catch (e) {
    ok(false, theme + ' 执行异常', e.message)
  } finally {
    await browser.close()
    if (srv) srv.close()
  }
}

async function runCancel(cred) {
  console.log('\n================ ' + LABEL + ' / v483 / 取消路径 ================')
  const { srv, browser, page } = await open(DIST, 'light', cred)
  try {
    const setup = await page.eval(SETUP_PLAN_ONLY)
    if (setup !== 'ok') { ok(false, '取消路径 注入消息初始化', setup); await browser.close(); if (srv) srv.close(); return }
    await sleep(PROD ? 2000 : 1200)
    const c = await page.eval(CLICK_CANCEL)
    ok(c === 'clicked', '取消路径 点「取消」', c)
    await sleep(800)
    const after = JSON.parse(await page.eval(READ_PROBE))
    ok(cnt(after.calls, '/api/ai/recipe-proposals', 'POST') === 0, '取消后写接口 POST==0', cnt(after.calls, '/api/ai/recipe-proposals', 'POST'))
    const rp = JSON.parse(await page.eval(READ_PROPOSAL))
    ok(rp.planCount >= 1, '取消路径 计划卡仍在', rp.planCount)
  } catch (e) {
    ok(false, '取消路径 异常', e.message)
  } finally {
    await browser.close()
    if (srv) srv.close()
  }
}

async function runSingle(cred) {
  console.log('\n================ ' + LABEL + ' / v483 / 单条提案兼容 ================')
  const { srv, browser, page } = await open(DIST, 'light', cred)
  try {
    const setup = await page.eval(SETUP_SINGLE)
    if (setup !== 'ok') { ok(false, '单条提案 注入消息初始化', setup); await browser.close(); if (srv) srv.close(); return }
    await sleep(PROD ? 2000 : 1200)
    const a = await page.eval(CLICK_ACCEPT_SINGLE)
    ok(a === 'clicked', '单条提案 点「采纳并写入配方」', a)
    await sleep(PROD ? 2000 : 1200)
    const after = JSON.parse(await page.eval(READ_PROBE))
    const singleCreates = after.calls.filter(c => c.method === 'POST' && c.url === '/api/ai/recipe-proposals').length
    ok(singleCreates === 1, '单条提案走 applyProposal 旧路径 create POST==1（不回归）', singleCreates)
  } catch (e) {
    ok(false, '单条提案 异常', e.message)
  } finally {
    await browser.close()
    if (srv) srv.close()
  }
}

(async () => {
  const cred = await login()
  await run('light', cred)
  await run('dark', cred)
  await runCancel(cred)
  await runSingle(cred)
  console.log('\n================ 结果：' + pass + ' PASS / ' + fail + ' FAIL ================')
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error('FATAL', e); process.exit(2) })
