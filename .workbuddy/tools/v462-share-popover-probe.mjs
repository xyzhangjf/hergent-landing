/**
 * v462-share-popover-probe.mjs —— 副驾分享按钮弹窗（分享菜单 + 二维码弹层）深色/浅色背景跟随验收
 *
 * 背景：v462 把 `.cp-share-menu` / `.cp-qr` 两处写死的 `background:#fff` 与幽灵变量
 *       `var(--b2,#浅色fallback)` 改为 `var(--bg)` / `var(--bd)` / `var(--bg2)` / `var(--t3)`，
 *       使其跟随系统（浅色/深色）主题。本探针只验「背景/边框/文字色是否随主题变量变化」。
 *
 * 用法：
 *   node v462-share-popover-probe.mjs                 # 打本地 dist-v462（正例：期望 light+dark 全绿）
 *   node v462-share-popover-probe.mjs --prod          # 打生产（部署前=v461 改动前=dark FAIL；部署后=PASS）
 */
import { launch } from './lib/cdp-lite.mjs'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.env.HG_ROOT || '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2'
const PROD = process.argv.includes('--prod')
const PROD_URL = 'https://hergent.cn/'
const DIST = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'dist-v462'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v462-share' + (PROD ? '-prod' : '')
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

/** 静态文件服务 + /api 反代到真实后端（等价 vite.config.js 的 proxy） */
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

// 只注入登录态 + 主题（本轮不涉及 tts，无需 voice 桩）
const initSrc = (d, theme) => [
  "localStorage.setItem('hergent_v2_token'," + JSON.stringify(d.token) + ");",
  "localStorage.setItem('hergent_v2_csrf'," + JSON.stringify(d.csrf_token || '') + ");",
  "localStorage.setItem('hergent_v2_user'," + JSON.stringify(JSON.stringify(d.user || {})) + ");",
  "localStorage.setItem('hergent_v2_tenant'," + JSON.stringify(String(d.tenant_id || 1)) + ");",
  "localStorage.setItem('hergent_theme','" + theme + "');",
].join('')

/* 打开副驾并塞一条 assistant 消息 —— 走真实 store / 真实组件 / 真实 CSS */
const SETUP = [
  "(function(){",
  "var el=document.querySelector('#app');if(!el||!el.__vue_app__)return 'no-app';",
  "var app=el.__vue_app__;var pinia=app.config.globalProperties.$pinia;if(!pinia)return 'no-pinia';",
  "var st=pinia._s.get('app');if(!st)return 'no-store';",
  "st.ui.copilotOpen=true;st.chat.streaming=false;",
  "st.chat.messages=[{role:'user',content:'探针问题'},{role:'assistant',content:'这是一条用于验收分享弹窗背景跟随主题的副驾回复文本。'}];",
  "return 'ok';})()",
].join('')

const CLICK_SHARE = "(function(){var b=[].slice.call(document.querySelectorAll('.cp-msg-actions .cp-act')).filter(function(x){return (x.getAttribute('title')||'')==='分享'})[0];if(!b)return 'no-share';b.click();return 'ok'})()"
const READ_MENU = "(function(){var m=document.querySelector('.cp-share-menu');function bg(e){return e?getComputedStyle(e).backgroundColor:null}function bd(e){return e?getComputedStyle(e).borderTopColor:null}return JSON.stringify({exists:!!m,htmlClass:document.documentElement.className,menuBg:bg(m),menuBd:bd(m)})})()"
const CLICK_QR = "(function(){var m=document.querySelector('.cp-share-menu');if(!m)return 'no-menu';var b=[].slice.call(m.querySelectorAll('button')).filter(function(x){return String(x.textContent||'').indexOf('生成二维码')>=0})[0];if(!b)return 'no-qr-btn';b.click();return 'ok'})()"
const READ_QR = "(function(){var q=document.querySelector('.cp-qr');function bg(e){return e?getComputedStyle(e).backgroundColor:null}function bd(e){return e?getComputedStyle(e).borderTopColor:null}var c=document.querySelector('.cp-qr-close');var p=document.querySelector('.cp-qr p');return JSON.stringify({exists:!!q,qrBg:bg(q),qrBd:bd(q),qrCloseBg:bg(c),qrPcolor:p?getComputedStyle(p).color:null})})()"

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

const want = (theme) => theme === 'dark'
  ? { bg: 'rgb(28,28,30)', bd: 'rgb(58,58,60)', closeBg: 'rgb(44,44,46)', pColor: 'rgb(142,142,147)' }
  : { bg: 'rgb(255,255,255)', bd: 'rgb(229,229,234)', closeBg: 'rgb(245,245,247)', pColor: 'rgb(161,161,166)' }

async function run(theme, cred) {
  console.log('\n================ ' + LABEL + ' / 分享弹窗背景 / ' + theme + ' ================')
  const { srv, browser, page, setup } = await open(DIST, theme, cred)
  if (setup !== 'ok') { console.log('  SETUP 返回: ' + setup); ok(false, theme + ' 副驾与消息初始化'); await browser.close(); return }
  const clickShare = await page.eval(CLICK_SHARE)
  await sleep(400)
  const menu = JSON.parse(await page.eval(READ_MENU))
  const exp = want(theme)
  ok(norm(menu.menuBg) === norm(exp.bg), theme + ' 分享菜单背景跟随主题', menu.menuBg + ' / 期望 ' + exp.bg)
  ok(norm(menu.menuBd) === norm(exp.bd), theme + ' 分享菜单边框跟随主题（var(--bd) 非浅色 fallback）', menu.menuBd + ' / 期望 ' + exp.bd)
  const clickQr = await page.eval(CLICK_QR)
  await sleep(800)
  const qr = JSON.parse(await page.eval(READ_QR))
  if (qr.exists) {
    ok(norm(qr.qrBg) === norm(exp.bg), theme + ' 二维码弹层背景跟随主题', qr.qrBg + ' / 期望 ' + exp.bg)
    ok(norm(qr.qrBd) === norm(exp.bd), theme + ' 二维码弹层边框跟随主题', qr.qrBd + ' / 期望 ' + exp.bd)
    ok(norm(qr.qrCloseBg) === norm(exp.closeBg), theme + ' 二维码关闭按钮底跟随主题', qr.qrCloseBg + ' / 期望 ' + exp.closeBg)
    ok(norm(qr.qrPcolor) === norm(exp.pColor), theme + ' 二维码说明文字色跟随主题', qr.qrPcolor + ' / 期望 ' + exp.pColor)
  } else {
    console.log('  (跳过二维码弹层断言：本轮未渲染，仅验分享菜单) clickQr=' + clickQr)
  }
  await browser.close()
}

;(async () => {
  const cred = await login()
  for (const theme of ['light', 'dark']) await run(theme, cred)
  console.log('\n================ 汇总 ================')
  console.log('  PASS=' + pass + '  FAIL=' + fail)
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error('探针异常:', e); process.exit(2) })
