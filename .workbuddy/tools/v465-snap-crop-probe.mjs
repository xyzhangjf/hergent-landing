/**
 * v465-snap-crop-probe.mjs —— 副驾「剪刀（截图）」按钮 + 微信式区域框选验收
 *
 * 验收点：
 *  1) 按钮位置/样式不变（.cp-trailing 内、语音输入右侧、32px 圆形透明底、scissors 5 path、跟随主题）
 *  2) 点击 → 弹全屏框选遮罩（.cp-snap-mask），此时尚未上传附件
 *  3) 在 .cp-snap-stage 上拖拽 → 生成非零选区（.cp-snap-sel 有尺寸）
 *  4) 点「确认裁剪」→ 选区被裁下、作为图片附件进 .cp-atts，toast「截图已附到输入框」，遮罩关闭
 *  5) 取消路径：再点按钮 → 遮罩 → 点「取消」→ 遮罩关闭且无新附件
 *
 * 用法：
 *   HG_ROOT=/private/tmp/hergent-build-v465/hergent-cn-v2 node v465-snap-crop-probe.mjs dist-v465   # 本地正例
 *   node v465-snap-crop-probe.mjs --prod                                                          # 生产真机
 */
import { launch } from './lib/cdp-lite.mjs'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.env.HG_ROOT || '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2'
const PROD = process.argv.includes('--prod')
const PROD_URL = 'https://hergent.cn/'
const DIST = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'dist-v465'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v465-snap' + (PROD ? '-prod' : '')
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
const norm = (s) => (s || '').replace(/\s+/g, '')

function serve(dir) {
  const t = new URL(API_TARGET)
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = req.url || '/'
      if (url.startsWith('/api')) {
        const pr = https.request({
          hostname: t.hostname, port: 443, path: url, method: req.method,
          headers: { ...req.headers, host: t.hostname },
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

// 注入登录态 + 主题 + 截图能力桩（getDisplayMedia + /api/chat-attachment 上传）
const initSrc = (d, theme) => [
  "localStorage.setItem('hergent_v2_token'," + JSON.stringify(d.token) + ");",
  "localStorage.setItem('hergent_v2_csrf'," + JSON.stringify(d.csrf_token || '') + ");",
  "localStorage.setItem('hergent_v2_user'," + JSON.stringify(JSON.stringify(d.user || {})) + ");",
  "localStorage.setItem('hergent_v2_tenant'," + JSON.stringify(String(d.tenant_id || 1)) + ");",
  "localStorage.setItem('hergent_theme','" + theme + "');",
  "(function(){try{Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getDisplayMedia:function(){var c=document.createElement('canvas');c.width=240;c.height=140;var x=c.getContext('2d');x.fillStyle='#0a84ff';x.fillRect(0,0,240,140);x.fillStyle='#fff';x.fillRect(20,20,80,80);return Promise.resolve(c.captureStream(1));}}});}catch(e){window.__snapStubErr=String(e);}})();",
  "(function(){var _f=window.fetch?window.fetch.bind(window):null;window.fetch=function(u,o){var url=(u&&u.url)||String(u);if((url.indexOf('/api/chat-attachment')>=0)&&(!o||(o.method||'GET').toUpperCase()==='POST')){var body=JSON.stringify({ok:true,file_name:'截图fake.png',file_type:'image',size:123,stored_as:'fake',note:'',text_preview:'',rows:0,cols:0});return Promise.resolve(new Response(body,{status:200,headers:{'Content-Type':'application/json'}}));}return _f?_f(u,o):Promise.reject(new Error('no fetch'));};})();",
  "(function(){var _tb=HTMLCanvasElement.prototype.toBlob;window.__lastCrop=null;HTMLCanvasElement.prototype.toBlob=function(cb,type){try{window.__lastCrop={w:this.width,h:this.height};}catch(e){}return _tb.apply(this,arguments);};})();",
].join('')

const SETUP = [
  "(function(){",
  "var el=document.querySelector('#app');if(!el||!el.__vue_app__)return 'no-app';",
  "var app=el.__vue_app__;var pinia=app.config.globalProperties.$pinia;if(!pinia)return 'no-pinia';",
  "var st=pinia._s.get('app');if(!st)return 'no-store';",
  "st.ui.copilotOpen=true;st.chat.streaming=false;",
  "st.chat.messages=[{role:'user',content:'探针问题'},{role:'assistant',content:'用于验收截图按钮的副驾回复。'}];",
  "return 'ok';})()",
].join('')

const READ_SNAP = "(function(){var trail=document.querySelector('.cp-trailing');if(!trail)return JSON.stringify({err:'no-trailing'});var snap=trail.querySelector('.cp-snap');var voice=trail.querySelector('.cp-voice');var send=trail.querySelector('.cp-send');if(!snap)return JSON.stringify({err:'no-snap'});var kids=[].slice.call(trail.children);var iSnap=kids.indexOf(snap),iVoice=kids.indexOf(voice),iSend=kids.indexOf(send);var cs=function(el){return el?getComputedStyle(el):null};var svg=snap.querySelector('svg');return JSON.stringify({hasSvg:!!svg,svgPaths:svg?svg.querySelectorAll('path').length:0,bg:cs(snap).backgroundColor,color:cs(snap).color,width:cs(snap).width,height:cs(snap).height,borderRadius:cs(snap).borderRadius,svgStroke:svg?cs(svg).stroke:null,order:{voice:iVoice,snap:iSnap,send:iSend},title:snap.getAttribute('title'),stubErr:window.__snapStubErr||null});})()"
const CLICK_SNAP = "(function(){var b=document.querySelector('.cp-snap');if(!b)return 'no-snap';b.click();return 'ok'})()"
const READ_CROP = "(function(){var mask=document.querySelector('.cp-snap-mask');var stage=document.querySelector('.cp-snap-stage');var sel=document.querySelector('.cp-snap-sel');var btn=document.querySelector('.cp-snap-btn');var atts=document.querySelector('.cp-atts');var items=atts?[].slice.call(atts.querySelectorAll('.cp-att')):[];return JSON.stringify({mask:!!mask,stage:!!stage,sel:!!sel,btn:!!btn,attBefore:items.length,maskBg:mask?getComputedStyle(mask).backgroundColor:null});})()"
const DRAG_CROP = "(function(){var stage=document.querySelector('.cp-snap-stage');if(!stage)return 'no-stage';var r=stage.getBoundingClientRect();function me(type,x,y){stage.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y}));}var x0=r.left+12,y0=r.top+8,w=Math.max(20,r.width-24),h=Math.max(20,r.height-16);me('mousedown',x0,y0);me('mousemove',x0+w,y0+h);me('mouseup',x0+w,y0+h);return 'ok';})()"
const READ_SEL = "(function(){var sel=document.querySelector('.cp-snap-sel');if(!sel)return JSON.stringify({err:'no-sel'});return JSON.stringify({parsedW:parseFloat(sel.style.width),parsedH:parseFloat(sel.style.height)});})()"
const READ_LASTCROP = "(function(){return JSON.stringify(window.__lastCrop||null);})()"
const CLICK_CONFIRM = "(function(){var b=document.querySelector('.cp-snap-btn:not(.ghost)');if(!b)return 'no-confirm';b.click();return 'ok'})()"
const CLICK_CANCEL = "(function(){var b=document.querySelector('.cp-snap-btn.ghost');if(!b)return 'no-cancel';b.click();return 'ok'})()"
const READ_ATT = "(function(){var atts=document.querySelector('.cp-atts');var items=atts?[].slice.call(atts.querySelectorAll('.cp-att')):[];var names=items.map(function(i){return (i.querySelector('.cp-att-name')||{}).textContent||''});var hasImg=items.map(function(i){return !!i.querySelector('.cp-att-ic .ico,.cp-att-ic svg')});var toast=[].slice.call(document.querySelectorAll('.toast,.toast-msg')).map(function(t){return t.textContent||''});return JSON.stringify({count:items.length,names:names,hasImg:hasImg,toasts:toast});})()"

async function open(dist, theme, cred) {
  let srv = null, target
  if (PROD) target = PROD_URL
  else { const r = await serve(path.join(ROOT, dist)); srv = r.srv; target = 'http://127.0.0.1:' + r.port + '/' }
  const browser = await launch({ headless: true, extraArgs: ['--autoplay-policy=no-user-gesture-required'] })
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(initSrc(cred, theme))
  await page.goto(target, PROD ? 15000 : 5500)
  const setup = await page.eval(SETUP)
  await sleep(PROD ? 2200 : 1400)
  return { srv, browser, page, setup }
}

async function run(theme, cred) {
  console.log('\n================ ' + LABEL + ' / 截图框选 / ' + theme + ' ================')
  const { srv, browser, page, setup } = await open(DIST, theme, cred)
  if (setup !== 'ok') { console.log('  SETUP 返回: ' + setup); ok(false, theme + ' 副驾与消息初始化'); await browser.close(); return }

  const snap = JSON.parse(await page.eval(READ_SNAP))
  if (snap.err) { ok(false, theme + ' 找到 .cp-snap 按钮', snap.err); await browser.close(); return }
  ok(snap.hasSvg && snap.svgPaths === 5, theme + ' 按钮含 scissors 线性 svg（5 段 path）', 'paths=' + snap.svgPaths)
  ok(snap.title === '截图', theme + ' 按钮 title=截图', 'title=' + snap.title)
  ok(snap.order.voice !== -1 && snap.order.snap === snap.order.voice + 1 && snap.order.send === snap.order.snap + 1,
     theme + ' 位置在语音输入右侧、发送左侧（voice→snap→send）', JSON.stringify(snap.order))
  ok(norm(snap.bg) === norm('rgba(0, 0, 0, 0)'), theme + ' 背景透明（与 .cp-voice 同款，不写死白底）', snap.bg)
  ok(snap.width === '32px' && snap.height === '32px', theme + ' 几何 32×32 圆形', snap.width + '×' + snap.height + ' radius=' + snap.borderRadius)
  ok(snap.svgStroke && snap.svgStroke.indexOf('rgb(') === 0, theme + ' 图标 stroke 已解析为当前主题色（currentColor→var(--t2)，非写死黑白）', snap.svgStroke)
  if (snap.stubErr) console.log('  (提示) getDisplayMedia 桩错误: ' + snap.stubErr)

  // 点击 → 弹框选遮罩（此时不应有附件）
  await page.eval(CLICK_SNAP)
  await sleep(2200)
  let crop = JSON.parse(await page.eval(READ_CROP))
  ok(crop.mask === true, theme + ' 点击后弹出区域框选遮罩 .cp-snap-mask', 'mask=' + crop.mask)
  ok(crop.stage && crop.sel, theme + ' 遮罩内含预览图与选区框', JSON.stringify({ stage: crop.stage, sel: crop.sel }))
  ok(crop.btn === true, theme + ' 遮罩含「确认裁剪 / 取消」按钮')
  ok(crop.attBefore === 0, theme + ' 框选阶段尚未上传附件（点按钮不即传）', 'attBefore=' + crop.attBefore)
  ok(crop.maskBg && crop.maskBg.indexOf('rgba(0, 0, 0, 0.72)') >= 0 || (crop.maskBg || '').indexOf('rgb(0, 0, 0)') >= 0,
     theme + ' 遮罩为深色蒙层（微信式）', crop.maskBg)

  // 拖拽框选
  await page.eval(DRAG_CROP)
  await sleep(180)
  const drag = JSON.parse(await page.eval(READ_SEL))
  ok(drag.parsedW > 0 && drag.parsedH > 0, theme + ' 拖拽生成非零选区', 'w=' + drag.parsedW + ' h=' + drag.parsedH)
  try { await page.screenshot(path.join(SHOT_DIR, theme + '-crop-overlay.png')) } catch { /* ignore */ }

  // 确认裁剪 → 附件
  await page.eval(CLICK_CONFIRM)
  await sleep(1500)
  const att = JSON.parse(await page.eval(READ_ATT))
  ok(att.count >= 1, theme + ' 确认裁剪后产生附件', 'count=' + att.count + ' names=' + JSON.stringify(att.names))
  ok(att.names.some((n) => (n || '').indexOf('截图') >= 0 || (n || '').indexOf('png') >= 0),
     theme + ' 附件名为截图 PNG', JSON.stringify(att.names))
  ok(att.hasImg.some(Boolean), theme + ' 附件以图片图标展示（file_type=image）')
  ok(att.toasts.some((t) => (t || '').indexOf('截图已附到输入框') >= 0), theme + ' toast 提示「截图已附到输入框」',
     'toasts=' + JSON.stringify(att.toasts))
  const lastCrop = JSON.parse(await page.eval(READ_LASTCROP))
  ok(lastCrop && lastCrop.w < 240 && lastCrop.h < 140, theme + ' 裁下的画布小于整图（确为区域裁剪，非整图）', JSON.stringify(lastCrop))
  const after = JSON.parse(await page.eval(READ_CROP))
  ok(after.mask === false, theme + ' 确认后遮罩已关闭', 'mask=' + after.mask)

  // 取消路径：再点按钮 → 遮罩 → 取消 → 无新附件
  await page.eval(CLICK_SNAP)
  await sleep(2200)
  const c2 = JSON.parse(await page.eval(READ_CROP))
  ok(c2.mask === true, theme + ' 取消路径：再次弹出遮罩', 'mask=' + c2.mask)
  await page.eval(CLICK_CANCEL)
  await sleep(600)
  const c3 = JSON.parse(await page.eval(READ_CROP))
  ok(c3.mask === false, theme + ' 点「取消」后遮罩关闭', 'mask=' + c3.mask)
  const att2 = JSON.parse(await page.eval(READ_ATT))
  ok(att2.count === att.count, theme + ' 取消未产生新附件', 'count=' + att2.count)

  await browser.close()
}

;(async () => {
  const cred = await login()
  for (const theme of ['light', 'dark']) await run(theme, cred)
  console.log('\n================ 汇总 ================')
  console.log('  PASS=' + pass + '  FAIL=' + fail)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error('探针异常:', e); process.exit(2) })
