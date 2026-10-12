/**
 * v472-prod-sidebar-shots.mjs —— 生产侧栏「四区只给 boss」的可视化取证
 *
 * 打真 https://hergent.cn（1 次公开 demo-login，租户只读），只截侧栏：
 *   · boss  → 四区全在
 *   · sales → 四区全无
 * 两张同尺寸对比图即是最直观的交付物。
 */
import { launch } from './lib/cdp-lite.mjs'
import https from 'node:https'
import fs from 'node:fs'

const BASE = 'https://hergent.cn/'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v472-prod'
fs.mkdirSync(OUT, { recursive: true })

const login = await new Promise((resolve, reject) => {
  const body = '{}'
  const req = https.request(BASE + 'api/auth/demo-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
  }, res => { let t = ''; res.on('data', c => (t += c)); res.on('end', () => resolve(JSON.parse(t))) })
  req.on('error', reject); req.end(body)
})
console.log(`demo-login ok：tenant=${login.tenant_id} user=${login.user && login.user.username} role=${login.user && login.user.role}`)

const init = (role) => `
(function(){
  try{
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(login.token)});
    localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(String(login.tenant_id))});
  }catch(e){}
  var of = window.fetch;
  window.fetch = function(input, init){
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    var path = url.replace(/^https?:\\/\\/[^/]+/, '').split('?')[0];
    var p = of.apply(this, arguments);
    if (path === '/api/auth/permissions') {
      return p.then(function(res){ return res.text().then(function(t){
        var j = null; try { j = JSON.parse(t); } catch(e){}
        if (j && j.user) { j.user.role = ${JSON.stringify(role)}; j.user.roles = [${JSON.stringify(role)}]; }
        return new Response(JSON.stringify(j), { status: res.status, headers: { 'content-type':'application/json' } });
      }); });
    }
    return p;
  };
})();
`

const browser = await launch({ headless: true })
for (const role of ['boss', 'sales']) {
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(init(role))
  await page.goto(BASE + '#/workbench', 7000)
  const names = JSON.parse(await page.eval(
    `JSON.stringify(Array.prototype.slice.call(document.querySelectorAll('.sb-nav .sb-item span')).map(function(e){return e.textContent.trim()}))`))
  console.log(`  ${role} 侧栏一级项：${names.join(' / ')}`)
  const box = JSON.parse(await page.eval(`(function(){var n=document.querySelector('.sb-nav');var r=n.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)})})()`))
  /* 🔴 直接走 CDP 并带 `captureBeyondViewport`：`cdp-lite.screenshot({clip})` 不带这个参数时，
     clip 一旦超出可视区（本机 headless=new 下的可视高常小于 window-size）CDP 会返回 error，
     而 `screenshot()` 只认 `r.result.data` ⇒ **静默返回空串、文件根本没写**（本次实测踩到）。 */
  const shot = await page.raw.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 900), scale: 2 },
  })
  const b64 = shot && shot.result && shot.result.data
  const dst = `${OUT}/sidebar-${role}.png`
  if (!b64) { console.log(`     !! 截图未返回数据（CDP error: ${JSON.stringify(shot && shot.error)}）`) }
  else {
    fs.writeFileSync(dst, Buffer.from(b64, 'base64'))
    console.log(`     已截图 ${dst}  (${Math.min(box.height, 900)}×${box.width} @2x, ${fs.statSync(dst).size} 字节)`)
  }
}
await browser.close()
