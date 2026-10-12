/**
 * v484-role-avatar-probe.mjs —— 「经营副驾」复用 boss 3D 人物头像（去掉 🚀 回落）验收
 *
 * 背景：后端 GET /api/ai/roles/{role_id}/avatar 的回落链 =
 *         本租户自定义头像 → 主租户(tenant 1) 的内置 3D 人物头像 → 404
 *       但前端 RoleAvatar 只在 custom_avatar=1 时才去请求该接口
 *       ⇒ 未上传头像的租户一律显示 emoji 🚀（老板实测）。v484 去掉该门槛。
 *
 * 验收点：
 *   1) 角色 custom_avatar=0（本租户无自有头像）→ 顶栏渲染 <img class="cp-ai-img-png">，不再是 emoji
 *   2) 该 img 的 src 指向 /api/ai/roles/copilot/avatar
 *   3) 图片**真实加载成功** naturalWidth>0（= 拿到 boss 那张 3D PNG，不是裂图）
 *   4) 抽屉内不再出现 🚀 文案
 *   5) 「将由 X 回答」行同样渲染 3D 头像（.cp-who-av-img）
 *   6) 消息头像也走 img 通道（.msg-av-img）
 *   7) 回归：custom_avatar=1（boss 自己）→ 仍渲染 img，行为不变
 *
 * 用法：
 *   HG_ROOT=/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2 node v484-role-avatar-probe.mjs dist-v484
 *   node v484-role-avatar-probe.mjs --prod
 */
import { launch } from './lib/cdp-lite.mjs'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.env.HG_ROOT || '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2'
const PROD = process.argv.includes('--prod')
const PROD_URL = 'https://hergent.cn/'
const DIST = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'dist-v484'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v484-probe' + (PROD ? '-prod' : '')
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

// 注入登录态 + 桩 /api/ai/roles。
// 🔴 为什么要桩：组件挂载后会**异步拉取真实角色列表并覆盖** store.chat.roles
//    （store/index.js:538-544），直接注入 Pinia 会被随后的真实数据冲掉（探针实测踩到）。
//    桩掉它 ⇒ 顶栏/将由X回答/消息三处都拿到我们指定的角色。
// 头像走 <img>，不经过 fetch ⇒ 仍真实打后端，验证「无自有头像 → 回落 boss 3D PNG」链路。
const initSrc = (d, theme, customAvatar) => [
  "localStorage.setItem('hergent_v2_token'," + JSON.stringify(d.token) + ");",
  "localStorage.setItem('hergent_v2_csrf'," + JSON.stringify(d.csrf_token || '') + ");",
  "localStorage.setItem('hergent_v2_user'," + JSON.stringify(JSON.stringify(d.user || {})) + ");",
  "localStorage.setItem('hergent_v2_tenant'," + JSON.stringify(String(d.tenant_id || 1)) + ");",
  "localStorage.setItem('hergent_theme','" + theme + "');",
  "(function(){var _f=window.fetch?window.fetch.bind(window):null;",
  "var META={role_id:'copilot',name:'经营副驾',avatar:'🚀',custom_avatar:" + customAvatar + ",is_active:1};",
  "window.__probeMeta=META;",
  "window.fetch=function(u,o){var url=(u&&u.url)||String(u);",
  "if(url.indexOf('/api/ai/roles')>=0&&url.indexOf('/avatar')<0&&url.indexOf('/channels')<0){",
  "return Promise.resolve(new Response(JSON.stringify({roles:[META],ok:true,success:true}),",
  "{status:200,headers:{'Content-Type':'application/json'}}));}",
  "return _f?_f(u,o):Promise.reject(new Error('no fetch'));};})();",
].join('')

// 注入「经营副驾」角色：customAvatar=0 模拟未上传头像的租户；=1 模拟 boss 自己
const mkSetup = (customAvatar) => [
  "(function(){",
  "var el=document.querySelector('#app');if(!el||!el.__vue_app__)return 'no-app';",
  "var app=el.__vue_app__;var pinia=app.config.globalProperties.$pinia;if(!pinia)return 'no-pinia';",
  "var st=pinia._s.get('app');if(!st)return 'no-store';",
  "st.ui.copilotOpen=true;st.chat.streaming=false;",
  "var meta={role_id:'copilot',name:'经营副驾',avatar:'🚀',custom_avatar:" + customAvatar + ",is_active:1};",
  "st.chat.roles=[meta];",
  "st.chat.currentRole='copilot';",
  "st.chat.messages=[{role:'user',content:'今天经营怎么样？'},",
  "{role:'assistant',content:'今日待办 3 项，风险 1 项。',roleMeta:meta}];",
  "return 'ok';})()",
].join('')

const CHECK = `(function(){
  var img=document.querySelector('.cp-ai-img-png');
  var who=document.querySelector('.cp-who-av-img');
  var msgAvs=document.querySelectorAll('.msg-av-img');
  var co=document.querySelector('.copilot')||document.body;
  return {
    tag: img?img.tagName:null,
    src: img?img.getAttribute('src'):null,
    nw: img?(img.naturalWidth||0):0,
    whoTag: who?who.tagName:null,
    whoNw: who?(who.naturalWidth||0):0,
    msgAvs: msgAvs.length,
    msgNw: msgAvs.length?(msgAvs[0].naturalWidth||0):0,
    rocket: (co.innerText||'').indexOf('\\uD83D\\uDE80')>=0
  };
})()`

async function waitImg(page, sel, ms = 8000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const r = await page.eval(`(function(){var i=document.querySelector('${sel}');return i?(i.complete?(i.naturalWidth||0):0):-1})()`)
    if (r > 0) return r
    await sleep(300)
  }
  return 0
}

async function runCase(browser, url, customAvatar, tag) {
  console.log('\n--- 场景 ' + tag + '（custom_avatar=' + customAvatar + '）---')
  const page = await browser.newPage()
  await page.enable()
  const d = await login()
  await page.addInitScript(initSrc(d, tag.includes('dark') ? 'dark' : 'light', customAvatar))
  await page.goto(url, 5000)
  const setupRes = await page.eval(mkSetup(customAvatar))
  ok(setupRes === 'ok', 'Pinia 注入角色成功', setupRes)
  await sleep(600)
  const nw = await waitImg(page, '.cp-ai-img-png')
  const r = await page.eval(CHECK)
  console.log('  DOM: ' + JSON.stringify(r))
  ok(r.tag === 'IMG', '顶栏渲染 <img>（不再是 emoji）', r.tag)
  ok((r.src || '').indexOf('/api/ai/roles/copilot/avatar') >= 0, 'src 指向头像接口', r.src)
  ok(nw > 0 && r.nw > 0, '图片真实加载成功（boss 3D PNG，非裂图）', r.nw + 'px')
  ok(!r.rocket, '抽屉内已无 🚀 文案', r.rocket)
  ok(r.whoTag === 'IMG' && r.whoNw > 0, '「将由 X 回答」行渲染 3D 头像', r.whoTag + '/' + r.whoNw + 'px')
  ok(r.msgAvs > 0 && r.msgNw > 0, '消息头像也走 img 通道', r.msgAvs + '个/' + r.msgNw + 'px')
  await page.screenshot(path.join(SHOT_DIR, tag + '.png')).catch(() => {})
}

async function main() {
  let url
  let srv = null
  if (PROD) {
    url = PROD_URL
    console.log('=== v484 经营副驾 3D 头像验收 · PROD（hergent.cn）===')
  } else {
    const dir = path.join(ROOT, DIST)
    if (!fs.existsSync(path.join(dir, 'index.html'))) throw new Error('构建产物不存在：' + dir)
    const s = await serve(dir)
    srv = s.srv
    url = 'http://127.0.0.1:' + s.port + '/'
    console.log('=== v484 经营副驾 3D 头像验收 · LOCAL（' + dir + '）===')
  }
  const browser = await launch()
  try {
    await runCase(browser, url, 0, 'no-own-avatar')
    await runCase(browser, url, 1, 'boss-has-avatar')
  } finally {
    await browser.close().catch(() => {})
    if (srv) srv.close()
  }
  console.log('\n=== 结果：' + pass + ' PASS / ' + fail + ' FAIL ===')
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('探针异常：', e); process.exit(2) })
