/**
 * v475-prod-perm-page-shots.mjs —— 权限页「在用账号」列 + 「最近变更」区块的**生产截图**
 *
 * 打真 https://hergent.cn（演示租户 demo_boss，租户只读）：只 GET 页面 + 1 次公开 demo-login。
 * ⚠️ 本探针**不写**生产：所以「最近变更」在这张图里应当是空的 —— 那是事实，不是缺陷
 *    （该租户尚未发生过权限变更；写入路径已在影子库 = 生产数据副本上验过）。
 */
import { launch } from './lib/cdp-lite.mjs'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import https from 'node:https'

const BASE = 'https://hergent.cn/'
const OUT = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v476-prod-perm'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const login = await new Promise((res, rej) => {
  const r = https.request(BASE + 'api/auth/demo-login', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': 2 } },
    resp => { let t = ''; resp.on('data', c => t += c); resp.on('end', () => { try { res(JSON.parse(t)) } catch (e) { rej(e) } }) })
  r.on('error', rej); r.end('{}')
})
console.log('demo-login: tenant=%s role=%s', login.tenant_id, login.user && login.user.role)

mkdirSync(OUT, { recursive: true })
const browser = await launch({ headless: true })
const page = await browser.newPage()
await page.enable()
await page.addInitScript(`
  try{ localStorage.setItem('hergent_v2_token', ${JSON.stringify(login.token)});
       localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(String(login.tenant_id))}); }catch(e){}
  window.__probeInit='ok';
`)
await page.goto(BASE + '#/settings?tab=perm', 8000)
let ok = false
for (let i = 0; i < 15 && !ok; i++) { await sleep(400); ok = await page.eval(`(function(){return !!document.querySelector('.perm-role-table tbody tr')})()`) }
await sleep(1800)
const info = JSON.parse(await page.eval(`(function(){
  var rows=[].slice.call(document.querySelectorAll('.perm-role-table tbody tr')).map(function(tr){
    return [].slice.call(tr.querySelectorAll('td')).map(function(td){return (td.textContent||'').trim().replace(/\\s+/g,' ')});
  });
  var heads=[].slice.call(document.querySelectorAll('.perm-role-table thead th')).map(function(th){return th.textContent.trim()});
  var delBtns=[].slice.call(document.querySelectorAll('.perm-role-table .btn-danger')).map(function(b){return b.textContent.trim()});
  var ghost=[].slice.call(document.querySelectorAll('.perm-role-table .btn-ghost')).map(function(b){return b.textContent.trim()});
  var hasAudit=document.body.innerText.indexOf('最近变更')>=0;
  var lockedRow=[].slice.call(document.querySelectorAll('.pr-locked-row td')).map(function(td){return (td.textContent||'').trim().replace(/\s+/g,' ')});
  var renameBtns=[].slice.call(document.querySelectorAll('.perm-role-table .btn-ghost')).filter(function(b){return b.textContent.trim()==='改名'}).length;
  var heads2=[].slice.call(document.querySelectorAll('.perm-role-table thead th')).map(function(th){return th.textContent.trim()});
  var usersCells=[].slice.call(document.querySelectorAll('.perm-role-table tbody .pr-users')).map(function(td){return td.textContent.trim()});
  return JSON.stringify({heads:heads, rows:rows, delBtns:delBtns, ghostBtns:ghost, hasAudit:hasAudit, usersCells:usersCells, lockedRow:lockedRow, renameBtns:renameBtns});
})()`))
console.log('  表头:', info.heads.join(' | '))
console.log('  在用账号列:', info.usersCells.join(' / '))
console.log('  删除角色按钮:', info.delBtns.join(',') || '（本租户无自定义角色）')
console.log('  恢复默认按钮:', info.ghostBtns.join(',') || '（无角色被改过）')
console.log('  最近变更区块存在:', info.hasAudit)
console.log('  管理员只读行:', JSON.stringify(info.lockedRow))
console.log('  改名按钮个数（演示租户无自定义角色 ⇒ 应为 0）:', info.renameBtns)
console.log('  行样例:', JSON.stringify(info.rows[0] || []))
const r = await page.raw.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
const b64 = (r && r.result && r.result.data) || (r && r.data) || ''
if (b64) {
  const p = OUT + '/role-perm-page-v476.png'
  writeFileSync(p, Buffer.from(b64, 'base64'))
  console.log('  ✅ 已写 %s（%d 字节，存在=%s）', p, b64.length, existsSync(p))
} else { console.log('  ❌ 截图返回空') }
await browser.close()
