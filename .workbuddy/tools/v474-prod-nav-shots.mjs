/**
 * v474-prod-nav-shots.mjs —— 「角色权限」归位后的**生产侧栏对比截图**
 *
 * 两张图，都取自真 https://hergent.cn（演示租户 demo_boss，租户只读）：
 *   · boss.png  —— 真 boss 登录，「档案管理 › 组织相关」列 = 员工档案 + **角色权限**
 *   · sales.png —— 同一 token / 同一租户 / 同一模块集，只把 `user.role` 改写成 sales
 *                  ⇒ 该列只剩「员工档案」（且「系统」区整区消失，因为它五列全是管理岗页）
 *
 * 🔴 工具坑（v472 已踩过一次，写在这里免得再踩）：
 *   `cdp-lite.screenshot({clip})` 不带 `captureBeyondViewport` 时，clip 超出可视区会被 CDP 拒，
 *   而该函数只认 `r.result.data` ⇒ **静默返回空串、文件根本没写**（日志却说"已截图"）。
 *   所以这里直接 `page.raw.send('Page.captureScreenshot', …)` + 自写文件 + **断言文件真存在**。
 *
 * 🔴 注入脚本里**不得出现单反斜杠**（模板字面量会把 `\/` 折叠成 `/`，正则提前闭合 ⇒
 *   整段脚本语法错误被丢弃 ⇒ 连 token 都没写进去 ⇒ 页面未登录 ⇒ 截图里只有登录页）。
 *   这里与 `v474-prod-role-perm-relocate-verify.mjs` 同款：用 indexOf 手撕，不用正则。
 */
import { launch } from './lib/cdp-lite.mjs'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import https from 'node:https'

const BASE = 'https://hergent.cn/'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v474-prod-nav'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function demoLogin() {
  return new Promise((resolve, reject) => {
    const req = https.request(BASE + 'api/auth/demo-login', {
      method: 'POST', headers: { 'content-type': 'application/json', 'content-length': 2 },
    }, r => { let t = ''; r.on('data', c => (t += c)); r.on('end', () => { try { resolve(JSON.parse(t)) } catch (e) { reject(e) } }) })
    req.on('error', reject); req.end('{}')
  })
}

const login = await demoLogin()
console.log('demo-login：tenant=%s user=%s role=%s', login.tenant_id, login.user && login.user.username, login.user && login.user.role)

function initScript(role) {
  return `
(function(){
  try{
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(login.token)});
    localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(String(login.tenant_id))});
  }catch(e){}
  var of = window.fetch;
  window.fetch = function(input, init){
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    var path = url;
    var h = path.indexOf('://');
    if (h >= 0) { var s = path.indexOf('/', h + 3); path = (s >= 0) ? path.slice(s) : '/'; }
    var q = path.indexOf('?');
    if (q >= 0) path = path.slice(0, q);
    var p = of.apply(this, arguments);
    if (path === '/api/auth/permissions') {
      return p.then(function(res){
        return res.text().then(function(t){
          var j = null; try { j = JSON.parse(t); } catch(e){}
          ${role ? `if (j && j.user) { j.user.role = ${JSON.stringify(role)}; j.user.roles = [${JSON.stringify(role)}]; }` : ''}
          return new Response(JSON.stringify(j), { status: res.status, headers: { 'content-type':'application/json' } });
        });
      });
    }
    return p;
  };
  window.__probeInit = 'ok';
})();
`
}

mkdirSync(OUT, { recursive: true })
const browser = await launch({ headless: true })

async function shot(role, file) {
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(initScript(role))
  await page.goto(BASE + '#/workbench', 8000)
  let up = false
  for (let i = 0; i < 12 && !up; i++) { await sleep(400); up = await page.eval(`(function(){return !!document.querySelector('.sb-area-btn span')})()`) }
  await sleep(1500)
  const initOk = await page.eval(`(function(){return window.__probeInit === 'ok'})()`)
  if (!initOk) { console.log('  ❌ %s：注入脚本未执行（页面未登录）', role || 'boss'); return }
  // 打开「档案管理」弹窗并等它渲染
  await page.eval(`(function(){var b=[].slice.call(document.querySelectorAll('.sb-area-btn')).filter(function(x){return (x.textContent||'').indexOf('档案管理')>=0})[0]; if(b) b.click();})()`)
  let cols = 0
  for (let i = 0; i < 12; i++) { await sleep(300); cols = await page.eval(`(function(){return document.querySelectorAll('.sb-pop-col').length})()`); if (cols) break }
  const info = JSON.parse(await page.eval(`(function(){
    var cols=[]; [].slice.call(document.querySelectorAll('.sb-pop-col')).forEach(function(c){
      var hd=c.querySelector('.sb-pop-hd');
      cols.push({label: hd?hd.textContent.trim():'', items:[].slice.call(c.querySelectorAll('.sb-pop-item')).map(function(a){return a.textContent.trim()})});
    });
    var areas=[].slice.call(document.querySelectorAll('.sb-area-btn span')).map(function(e){return e.textContent.trim()});
    return JSON.stringify({cols:cols, areas:areas});
  })()`))
  const org = (info.cols || []).find(c => c.label === '组织相关')
  console.log('  %s → 侧栏区: %s ｜ 组织相关列: %s', role || 'boss(真实)', (info.areas || []).join('/'), org ? org.items.join('、') : '(无该列)')

  const r = await page.raw.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const b64 = (r && r.result && r.result.data) || (r && r.data) || ''
  if (!b64) { console.log('  ❌ %s：captureScreenshot 返回空（工具坑）', role || 'boss'); return }
  const path = OUT + '/' + file
  writeFileSync(path, Buffer.from(b64, 'base64'))
  console.log('  ✅ 已写 %s （%d 字节，断言存在=%s）', path, b64.length, existsSync(path))
}

await shot(null, 'boss.png')
await shot('sales', 'sales.png')
await browser.close()
console.log('完成 →', OUT)