/**
 * v485-connectcenter-avatar-probe.mjs —— 「AI 引擎/能力中心」角色头像统一（去掉 🚀 回落）验收
 *
 * 背景：v322 立过规矩 —— AI 角色头像必须走 `RoleAvatar.vue` **唯一渲染口**，
 *   因为历史上同一个头像被 5 处各写一遍 v-if，其中 2 处漏了 custom_avatar ⇒ 有的地方显示 🚀。
 *   v484 修好了 RoleAvatar 的判据（有 role_id 就请求），但 `ConnectCenter.vue` **没走组件**，
 *   它自己写了两遍 `<img v-if="r.custom_avatar">`：
 *     · :86  渠道卡上的「已绑定角色」小头像（.cc-role-av）
 *     · :438 渠道配置弹窗里的角色勾选块（.cc-chip-av）
 *   ⇒ 未上传头像的租户，在能力中心依然看到 emoji。v485 把它俩改为复用 RoleAvatar。
 *
 * 验收点：
 *   1) 渠道卡角色标签渲染 <img class="cc-role-av">（不再是 emoji span）
 *   2) src 指向 /api/ai/roles/{role_id}/avatar
 *   3) 图片**真实加载成功** naturalWidth>0（不是裂图）
 *   4) 不出现 emoji 回落分支 .cc-role-av-em
 *   5) 四个角色的头像**字节指纹两两不同**（对齐老板「4 个角色是 4 张不同 3D 头像」的事实）
 *   6) 打开渠道配置弹窗 → .cc-chip-av 同样渲染 img 且加载成功
 *   7) 页面内无 🚀 文案
 *
 * 构造手���：桩 /api/ai/roles（返回 4 个 custom_avatar=0 的角色，模拟未上传头像的租户）
 *   + 桩 /api/ai/roles/{id}/channels（返回已绑定）⇒ 渠道卡才会渲染 .cc-roles 区块。
 *   头像走 <img> 不经 fetch ⇒ 仍真实打后端，验证「无自有头像 → 回落 tenant 1 的 3D PNG」。
 *
 * 用法：
 *   HG_ROOT=/…/hergent-cn-v2 node v485-connectcenter-avatar-probe.mjs dist-v485
 *   node v485-connectcenter-avatar-probe.mjs --prod
 */
import { launch } from './lib/cdp-lite.mjs'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.env.HG_ROOT || '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2'
const PROD = process.argv.includes('--prod')
const DIST = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'dist-v485'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v485-probe' + (PROD ? '-prod' : '')
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
        }, (p) => {
          res.writeHead(p.statusCode || 502, p.headers)
          p.pipe(res)
        })
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

// 四个内置角色（tenant 1 素材的字节数，用于对账）
const ROLES = [
  { role_id: 'copilot',    name: '经营副驾', avatar: '\uD83D\uDE80', len: 96928, custom_avatar: 0, is_active: 1 },
  { role_id: 'accountant', name: '会计',     avatar: '\uD83E\uDDEE', len: 89033, custom_avatar: 0, is_active: 1 },
  { role_id: 'cs',         name: '客服助手', avatar: '\uD83D\uDCAC', len: 95862, custom_avatar: 0, is_active: 1 },
  { role_id: 'secretary',  name: '大秘',     avatar: '\uD83D\uDCDD', len: 98690, custom_avatar: 0, is_active: 1 },
]

// 注入登录态 + 桩接口。三个桩各自解决一个"进不去/渲染不出"的卡点：
//   ① /api/auth/permissions —— 路由守卫判 role（pages.js:411 `/connect` roles:ADMIN_ROLES=['admin','boss']），
//      而 loadPerms() 会用响应里的 d.user.role **覆盖** store.user.role ⇒ 光改 localStorage 没用，
//      必须在这里把角色伪装成 boss，探针账号（supervisor）才不会被拦回 /workbench。
//   ② /api/auth/perms-rev —— refreshPermsIfChanged() 的版本比对，返回同值即可，避免它再去真拉权限。
//   ③ /api/ai/roles + /api/ai/roles/{id}/channels —— ConnectCenter 的 roles / roleChannels 数据源；
//      把任意渠道标成 connected ⇒ 渠道卡才会渲染 `.cc-roles`（"已绑定角色"小头像）区块。
//   头像走 <img> 不经 fetch ⇒ 仍真实打后端，验证「无自有头像 → 回落 tenant 1 的 3D PNG」。
const initSrc = (d, theme) => [
  "localStorage.setItem('hergent_v2_token'," + JSON.stringify(d.token) + ");",
  "localStorage.setItem('hergent_v2_csrf'," + JSON.stringify(d.csrf_token || '') + ");",
  "localStorage.setItem('hergent_v2_user'," + JSON.stringify(JSON.stringify(d.user || {})) + ");",
  "localStorage.setItem('hergent_v2_tenant'," + JSON.stringify(String(d.tenant_id || 1)) + ");",
  "localStorage.setItem('hergent_theme','" + theme + "');",
  "(function(){var _f=window.fetch?window.fetch.bind(window):null;",
  "var ROLES=" + JSON.stringify(ROLES) + ";",
  "var J=function(o){return Promise.resolve(new Response(JSON.stringify(o),",
  "{status:200,headers:{'Content-Type':'application/json'}}))};",
  "window.fetch=function(u,o){var url=(u&&u.url)||String(u);",
  "if(url.indexOf('/api/auth/permissions')>=0){",
  "return J({permissions:['*'],user:{role:'boss',roles:['boss'],display_name:'探针老板',username:'probe'},",
  "plan:'pro',capabilities:{},permissions_detail:{},custom_roles:[],perms_rev:'probe-rev'});}",
  "if(url.indexOf('/api/auth/perms-rev')>=0) return J({perms_rev:'probe-rev'});",
  "if(url.indexOf('/api/ai/roles/')>=0&&url.indexOf('/channels')>=0){",
  "return J({channels:[{channel:'wecom',connected:true}],ok:true});}",
  "if(url.indexOf('/api/ai/roles')>=0&&url.indexOf('/channels')<0&&url.indexOf('/avatar')<0){",
  "return J({roles:ROLES,ok:true});}",
  "return _f?_f(u,o):Promise.reject(new Error('no fetch'));};})();",
].join('')

const CHECK = `(function(){
  var q=function(s){return Array.prototype.slice.call(document.querySelectorAll(s))};
  var tags=q('.cc-role-tag');
  var avs=q('.cc-role-tag .cc-role-av');
  var imgs=avs.filter(function(e){return e.tagName==='IMG'});
  var spans=avs.filter(function(e){return e.tagName==='SPAN'});
  var ems=q('.cc-role-av-em');
  var nws=imgs.map(function(i){return i.naturalWidth||0});
  var alld=imgs.map(function(i){return i.complete});
  var page=document.querySelector('.cc-wrap,.cc-root,.connect,#__nuxt,body');
  return {
    tags:tags.length, imgs:imgs.length, spans:spans.length, ems:ems.length,
    nws:nws, complete:alld,
    srcs:imgs.map(function(i){return i.getAttribute('src')}),
    rocket:(document.body.innerText||'').indexOf('\\uD83D\\uDE80')>=0
  };
})()`

const CHECK_CHIP = `(function(){
  var q=function(s){return Array.prototype.slice.call(document.querySelectorAll(s))};
  var avs=q('.cc-chip-av');
  var imgs=avs.filter(function(e){return e.tagName==='IMG'});
  var ems=q('.cc-chip-av-em');
  return {
    avs:avs.length, imgs:imgs.length, ems:ems.length,
    nws:imgs.map(function(i){return i.naturalWidth||0}),
    srcs:imgs.map(function(i){return i.getAttribute('src')})
  };
})()`

// 对一组 src 逐个取字节指纹（FNV-1a + 长度），证明彼此不是同一张图
const mkFingerprints = (sel) => `(function(){
  var nodes=Array.prototype.slice.call(document.querySelectorAll('${sel}'));
  var imgs=nodes.filter(function(e){return e.tagName==='IMG'});
  return Promise.all(imgs.map(function(i){
    return fetch(i.getAttribute('src'),{credentials:'include'}).then(function(r){
      if(!r.ok) return {src:i.getAttribute('src'),len:-1,fp:'http'+r.status};
      return r.arrayBuffer().then(function(b){
        var u=new Uint8Array(b),h=0x811c9dc5;
        for(var k=0;k<u.length;k++){h^=u[k];h=(h+((h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)))>>>0;}
        return {src:i.getAttribute('src'),len:u.length,fp:h.toString(16)};
      });
    });
  }));
})()`

async function waitSel(page, sel, min, ms = 12000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const n = await page.eval(`document.querySelectorAll('${sel}').length`)
    if (n >= min) return n
    await sleep(400)
  }
  return await page.eval(`document.querySelectorAll('${sel}').length`)
}

async function runCase(browser, url, theme, tag) {
  console.log('\n--- 场景 ' + tag + '（theme=' + theme + '）---')
  const page = await browser.newPage()
  await page.enable()
  const d = await login()
  await page.addInitScript(initSrc(d, theme))
  await page.goto(url + '#/connect', 6000)
  const n = await waitSel(page, '.cc-role-tag', 1)
  ok(n > 0, '能力中心渲染出「已绑定角色」标签', n + ' 个')
  await sleep(1200) // 等头像 <img> 加载完成

  const r = await page.eval(CHECK)
  console.log('  DOM: tags=' + r.tags + ' img=' + r.imgs + ' span=' + r.spans + ' em=' + r.ems + ' nws=' + JSON.stringify(r.nws) + ' rocket=' + r.rocket)
  ok(r.imgs === r.tags && r.tags > 0, '全部角色标签渲染 <img>（无 emoji span 回落）', r.imgs + '/' + r.tags + ' span=' + r.spans)
  ok(r.ems === 0, '未出现 emoji 回落分支 .cc-role-av-em', r.ems + ' 个')
  ok(r.nws.length > 0 && r.nws.every((w) => w > 0), '头像真实加载成功（256px 3D PNG，非裂图）', JSON.stringify(r.nws))
  ok(!r.rocket, '页面内已无 🚀 文案', r.rocket)

  const srcs = r.srcs || []
  const expectIdx = ['copilot', 'accountant', 'cs', 'secretary']
  const allPointed = srcs.length > 0 && srcs.every((s, i) => (s || '').indexOf('/api/ai/roles/' + expectIdx[i] + '/avatar') >= 0)
  ok(allPointed, '每个标签的 src 指向自己角色的头像接口', JSON.stringify(srcs))

  // 字节指纹：证明四个角色是四张不同的图
  const fps = await page.eval(mkFingerprints('.cc-role-tag .cc-role-av'))
  fps.forEach((f) => console.log('    ' + (f.src || '').padEnd(46) + ' len=' + f.len + ' fp=' + f.fp))
  ok(fps.length === r.tags, '取到全部字节指纹', fps.length + '/' + r.tags)
  const uniq = new Set(fps.map((f) => f.fp))
  ok(uniq.size === fps.length && fps.length > 1, '四个角色头像字节指纹两两不同（一角色一图）', [...uniq].join(','))
  const lenOk = fps.length === expectIdx.length && fps.every((f, i) => f.len === ROLES[i].len)
  ok(lenOk, '字节数与 tenant 1 素材逐一吻合', fps.map((f) => f.len).join('/'))

  await page.screenshot(path.join(SHOT_DIR, tag + '.png')).catch(() => {})

  // 打开渠道配置弹窗 → 验证 cc-chip-av 分支
  const opened = await page.eval(`(function(){
    var c=document.querySelector('.cc-card');
    if(!c) return 'no-card';
    c.click(); return 'clicked';
  })()`)
  ok(opened === 'clicked', '点击渠道卡打开配置弹窗', opened)
  await waitSel(page, '.cc-chip-av', 1, 6000)
  await sleep(1000)
  const ch = await page.eval(CHECK_CHIP)
  console.log('  CHIP: avs=' + ch.avs + ' img=' + ch.imgs + ' em=' + ch.ems + ' nws=' + JSON.stringify(ch.nws))
  ok(ch.imgs === ch.avs && ch.avs > 0, '弹窗内角色勾选块同样渲染 <img class="cc-chip-av">', ch.imgs + '/' + ch.avs)
  ok(ch.ems === 0, '弹窗内未出现 emoji 回落 .cc-chip-av-em', ch.ems + ' 个')
  ok(ch.nws.length > 0 && ch.nws.every((w) => w > 0), '勾选块头像真实加载成功', JSON.stringify(ch.nws))
  await page.screenshot(path.join(SHOT_DIR, tag + '-modal.png')).catch(() => {})
}

async function main() {
  let url
  let srv = null
  if (PROD) {
    url = 'https://hergent.cn/'
    console.log('=== v485 能力中心角色头像统一 · PROD（hergent.cn/#/connect）===')
  } else {
    const dir = path.join(ROOT, DIST)
    if (!fs.existsSync(path.join(dir, 'index.html'))) throw new Error('构建产物不存在：' + dir)
    const s = await serve(dir)
    srv = s.srv
    url = 'http://127.0.0.1:' + s.port + '/'
    console.log('=== v485 能力中心角色头像统一 · LOCAL（' + dir + '）===')
  }
  const browser = await launch()
  try {
    await runCase(browser, url, 'light', 'connect-light')
    await runCase(browser, url, 'dark', 'connect-dark')
  } finally {
    await browser.close().catch(() => {})
    if (srv) srv.close()
  }
  console.log('\n=== 结果：' + pass + ' PASS / ' + fail + ' FAIL ===')
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('探针异常：', e); process.exit(2) })
