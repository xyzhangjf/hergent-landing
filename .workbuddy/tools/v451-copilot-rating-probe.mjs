/**
 * v451-copilot-rating-probe.mjs —— 副驾「点赞 / 点踩」按钮对齐 WorkBuddy 的真机验收
 *
 * 判据来源不是"看着像"，而是从 WorkBuddy.app → app.asar → renderer/assets/lib-chat-ui-*.css
 * （2026-10-11 逐条读出的真实规则）：
 *   `_ratingButton_` / `_shareButton_` / `_actionButton_` 是**同一套规格**：
 *   24×24 · border:none · radius 8px · padding:0 · color var(--cb-text-secondary)
 *   · hover **只换背景** var(--cb-bg-primary-hover) 且**不改字色** · :focus outline:none
 *   · 图标 16px · 按钮间距 8px · 选中态**不改颜色**、只把图标从线框换成实心
 *
 * 跑法：本地 dist 静态服务 ＋ 把 `/api` 反代到真实生产后端（**不打桩** —— 打桩的空对象会让
 *       Workbench 等页面读 undefined 而触发 ErrorBoundary，整个页面被换掉、副驾根本不渲染，
 *       表现为"所有断言全 FAIL"，极具迷惑性）。
 *
 * 用法：
 *   node v451-copilot-rating-probe.mjs                  # 打 dist-v451（期望全绿）
 *   node v451-copilot-rating-probe.mjs dist-v449        # 判别力自证（旧产物，期望关键断言 FAIL）
 */
import { launch } from './lib/cdp-lite.mjs'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2'
/* `--prod` ⇒ 不跑本地 dist，直接打**生产公网**（hergent.cn）。用于部署后的真机验收：
   同一条判据、同一套断言，跑在真实站点上 ⇒ 证不了"本地产物对"，才谈得上交付。 */
const PROD = process.argv.includes('--prod')
const PROD_URL = 'https://hergent.cn/'
const DIST = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'dist-v451'
const DIR = path.join(ROOT, DIST)
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v451-rating' + (PROD ? '-prod' : '')
const API_TARGET = 'https://erp.hergent.cn'
const ACCT = { username: 'mptestsp', password: 'Mpsup@1' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try { fs.mkdirSync(SHOT_DIR, { recursive: true }) } catch { /* ignore */ }
const LABEL = PROD ? 'PROD hergent.cn' : DIST

let pass = 0, fail = 0
const ok = (c, n, e) => {
  if (c) { pass++; console.log('  PASS  ' + n + (e !== undefined ? '   -> ' + e : '')) }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '   -> ' + e : '')) }
}

const MIME = {
  '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.json': 'application/json', '.map': 'application/json',
}

/** 静态文件服务 + /api 反代到真实后端（等价于 vite.config.js 里的 proxy 配置） */
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
      const clean = decodeURIComponent(url.split('?')[0])
      let f = path.join(dir, clean)
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dir, 'index.html')
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' })
      fs.createReadStream(f).pipe(res)
    })
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}

async function login() {
  const r = await fetch(API_TARGET + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ACCT),
  })
  const d = await r.json()
  if (!d.token) throw new Error('登录失败：' + JSON.stringify(d).slice(0, 200))
  return d
}

const stubSrc = (d, theme) => [
  "localStorage.setItem('hergent_v2_token'," + JSON.stringify(d.token) + ");",
  "localStorage.setItem('hergent_v2_csrf'," + JSON.stringify(d.csrf_token || '') + ");",
  "localStorage.setItem('hergent_v2_user'," + JSON.stringify(JSON.stringify(d.user || {})) + ");",
  "localStorage.setItem('hergent_v2_tenant'," + JSON.stringify(String(d.tenant_id || 1)) + ");",
  "localStorage.setItem('hergent_theme','" + theme + "');",
  /* 只桩掉 /api/ai/feedback 一个端点：生产上 supervisor 角色对该端点返回 403
     （「AI功能（消耗积分）」未开通）⇒ 前端乐观高亮会被 catch 回滚 ⇒ 观察不到实心态。
     那是**权限配置**问题，不是本轮 UI 行为，桩掉以免污染判据；其余请求一律真实透传。 */
  "(function(){var of=window.fetch;window.fetch=function(u,o){",
  "var s=(typeof u==='string')?u:((u&&u.url)||'');",
  "if(s.indexOf('/api/ai/feedback')>=0){",
  "  window.__fb=(window.__fb||0)+1;",
  "  try{window.__fbVals=(window.__fbVals||[]).concat([JSON.parse((o&&o.body)||'{}').feedback])}catch(e){}",
  "  return Promise.resolve(new Response(JSON.stringify({success:true}),{status:200,headers:{'Content-Type':'application/json'}}));}",
  "return of.apply(this,arguments);};})();",
].join('')

/* 打开副驾并塞一条 assistant 消息 —— 走真实 store、真实组件、真实 CSS，不伪造 DOM */
const SETUP = [
  "(function(){",
  "var el=document.querySelector('#app');if(!el||!el.__vue_app__)return 'no-app';",
  "var app=el.__vue_app__;var pinia=app.config.globalProperties.$pinia;",
  "if(!pinia)return 'no-pinia';",
  "var st=pinia._s.get('app');if(!st)return 'no-store';",
  "st.ui.copilotOpen=true;st.chat.streaming=false;",
  "st.chat.messages=[{role:'user',content:'探针问题'},{role:'assistant',content:'这是一条用于验收的副驾回复文本。'}];",
  "return 'ok';})()",
].join('')

const MEASURE = [
  "(function(){",
  "var q=function(s){return [].slice.call(document.querySelectorAll(s))};",
  "var rates=q('.cp-msg-actions .cp-act.cp-rate'),acts=q('.cp-msg-actions .cp-act');",
  "var mdl=q('.cp-msg-actions .cp-mdl');",
  "var gs=function(e,p){return e?getComputedStyle(e)[p]:null};",
  "var bx=function(e){var r=e.getBoundingClientRect();return{x:+r.left.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),cy:+(r.top+r.height/2).toFixed(1)}};",
  "var tk=function(v){var t=document.createElement('div');t.style.cssText='position:absolute;left:-9999px;background:'+v;document.body.appendChild(t);var c=getComputedStyle(t).backgroundColor;t.remove();return c};",
  "var svg=rates[0]?rates[0].querySelector('svg'):null,pd=svg?svg.querySelector('path'):null;",
  "var gap=null;if(acts.length>=2){var a=bx(acts[0]),b=bx(acts[1]);gap=+(b.x-(a.x+a.w)).toFixed(1)}",
  "return JSON.stringify({",
  " rateCount:rates.length,actCount:acts.length,",
  " w:rates[0]?bx(rates[0]).w:null,h:rates[0]?bx(rates[0]).h:null,",
  " radius:gs(rates[0],'borderTopLeftRadius'),borderW:gs(rates[0],'borderTopWidth'),",
  " bg:gs(rates[0],'backgroundColor'),color:gs(rates[0],'color'),",
  " transProp:gs(rates[0],'transitionProperty'),transDur:gs(rates[0],'transitionDuration'),",
  " gap:gap,",
  /* 判别力自证用：不带 cp-rate 的通用测量 —— 旧产物（v449）没有 cp-rate 类，
     只能靠这两项读出它"到底是 28×28/radius6/gap1/图标15"，从而证明上面那批断言
     不是"选择器一改就全绿"的恒真断言。 */
  " wA:acts[0]?bx(acts[0]).w:null,radiusA:gs(acts[0],'borderTopLeftRadius'),",
  " svgWA:(acts[0]&&acts[0].querySelector('svg'))?acts[0].querySelector('svg').getAttribute('width'):null,",
  " centers:[].concat(acts,mdl).map(function(e){return bx(e).cy}),",
  " svgW:svg?svg.getAttribute('width'):null,svgH:svg?svg.getAttribute('height'):null,",
  " vb:svg?svg.getAttribute('viewBox'):null,fillA:svg?svg.getAttribute('fill'):null,strokeA:svg?svg.getAttribute('stroke'):null,",
  /* 第二个按钮（点踩）自己的 viewBox —— 只量 rates[0] 会把「点踩变实心」误判成没变 */
  " vb2:(rates[1]&&rates[1].querySelector('svg'))?rates[1].querySelector('svg').getAttribute('viewBox'):null,",
  " pathN:svg?svg.querySelectorAll('path').length:0,",
  " pathD:pd?pd.getAttribute('d').slice(0,20):null,fillRule:pd?pd.getAttribute('fill-rule'):null,",
  " trans:pd?pd.getAttribute('transform'):null,",
  " pressed:rates.map(function(b){return b.getAttribute('aria-pressed')}),",
  " t2:tk('var(--t2)'),b2:tk('var(--b2)'),",
  " fb:(window.__fb||0),",
  " fbVals:(window.__fbVals||[]),",
  " corr:!!document.querySelector('.cp-corr-mask')",
  "});})()",
].join('')

const CLICK_RATE = (i) =>
  "(function(){var b=[].slice.call(document.querySelectorAll('.cp-msg-actions .cp-act.cp-rate'))[" + i + "];" +
  "if(!b)return 'no';b.click();return 'ok'})()"

async function hover(page, sel) {
  const raw = await page.eval(
    "(function(){var e=document.querySelector('" + sel + "');if(!e)return null;var r=e.getBoundingClientRect();" +
    "return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)})})()"
  )
  if (!raw) return false
  const { x, y } = JSON.parse(raw)
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
  await sleep(500)
  return true
}
async function unhover(page) {
  await page.raw.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2, buttons: 0 })
  await sleep(300)
}

/** 操作栏 4× 局部放大图 —— 全页图缩放后看不出几像素差（skill §五） */
async function zoom(page, dist, tag) {
  const raw = await page.eval(
    "(function(){var e=document.querySelector('.cp-msg-actions');if(!e)return null;var r=e.getBoundingClientRect();" +
    "return JSON.stringify({x:Math.max(0,r.left-10),y:Math.max(0,r.top-10),width:r.width+20,height:r.height+20})})()"
  )
  if (!raw) return
  const c = JSON.parse(raw)
  await page.screenshot(path.join(SHOT_DIR, dist + '-zoom-' + tag + '.png'),
    { clip: { x: c.x, y: c.y, width: c.width, height: c.height, scale: 4 } })
}

async function open(dist, theme, cred) {
  let srv = null
  let target
  if (PROD) {
    target = PROD_URL
  } else {
    const r = await serve(path.join(ROOT, dist))
    srv = r.srv
    target = 'http://127.0.0.1:' + r.port + '/'
  }
  const browser = await launch({ headless: true })
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(stubSrc(cred, theme))
  await page.goto(target, PROD ? 15000 : 5500)
  const setup = await page.eval(SETUP)
  await sleep(PROD ? 2000 : 1000)
  return { srv, browser, page, setup }
}

async function run(dist, theme, cred) {
  console.log('\n================ ' + LABEL + ' / ' + theme + ' ================')
  const { srv, browser, page, setup } = await open(dist, theme, cred)
  ok(setup === 'ok', '副驾打开 + 注入一条 assistant 消息', setup)
  if (setup !== 'ok') {
    await page.screenshot(path.join(SHOT_DIR, dist + '-' + theme + '-FAILED.png'))
    await browser.close(); srv && srv.close(); return
  }

  const m = JSON.parse(await page.eval(MEASURE))

  console.log('  [原始测量] 通用 .cp-act: ' + m.wA + 'px / radius ' + m.radiusA + ' / 图标 ' + m.svgWA +
    'px / gap ' + m.gap + ' ｜ cp-rate 数 ' + m.rateCount)
  ok(m.rateCount === 2, '点赞/点踩按钮各 1 个', 'rateCount=' + m.rateCount)
  /* 🔴 判别力自证：这两条**不用 .cp-rate 选择器**（旧产物没有该类，靠它失败只能证明"类名不存在"，
     证明不了"值不对"）。用通用 .cp-act 量第一个按钮 ⇒ 旧产物必须报出 28px/6px/15px 才算真判据。 */
  ok(m.wA === 24 && m.radiusA === '8px',
    '整行按钮统一 24×24 / radius 8px（WorkBuddy _actionButton_ 同规格）', m.wA + 'px / ' + m.radiusA)
  ok(m.svgWA === '16', '整行图标统一 16px（WorkBuddy _icon_）', m.svgWA + 'px')
  ok(m.w === 24 && m.h === 24, '按钮 24×24（WorkBuddy _ratingButton_）', m.w + '×' + m.h)
  ok(m.radius === '8px', '圆角 8px', m.radius)
  ok(m.borderW === '0px', '无边框（WorkBuddy border:none）', m.borderW)
  ok(m.bg === 'rgba(0, 0, 0, 0)', '默认底透明', m.bg)
  ok(m.color === m.t2, '默认字色 = --t2（映射 WorkBuddy --cb-text-secondary）', m.color + ' == ' + m.t2)
  ok(m.transProp === 'background-color' && m.transDur === '0.15s',
    '过渡只有 background-color .15s（WorkBuddy 同款）', m.transProp + ' ' + m.transDur)
  ok(m.gap === 8, '相邻按钮间距 8px（WorkBuddy gap:8px）', String(m.gap))
  ok(new Set(m.centers).size === 1, '整行同一中线（模型徽标 + 全部按钮）', 'centers=' + JSON.stringify(m.centers))
  ok(m.svgW === '16' && m.svgH === '16', '图标 16×16（WorkBuddy _icon_）', m.svgW + '×' + m.svgH)
  ok(m.vb === '0 0 15 14' && m.fillRule === 'evenodd' && m.strokeA === 'none' && m.fillA === 'currentColor' && m.pathN === 1,
    '默认 = WorkBuddy 线框图标（15×14 / fill evenodd / 单路径）',
    'vb=' + m.vb + ' fr=' + m.fillRule + ' stroke=' + m.strokeA + ' pathN=' + m.pathN)
  ok(m.pressed[0] === 'false' && m.pressed[1] === 'false', '未选中时 aria-pressed=false', JSON.stringify(m.pressed))

  const hv = await hover(page, '.cp-msg-actions .cp-act.cp-rate')
  const mh = JSON.parse(await page.eval(MEASURE))
  ok(hv && mh.bg === mh.b2, 'hover 背景 = --b2（映射 WorkBuddy --cb-bg-primary-hover）', mh.bg + ' == ' + mh.b2)
  ok(mh.bg !== 'rgba(0, 0, 0, 0)', 'hover 确实出现背景（非恒真）', mh.bg)
  ok(mh.color === m.color, 'hover 不改字色（WorkBuddy hover 只动 background）', mh.color + ' == ' + m.color)
  await unhover(page)
  const mu = JSON.parse(await page.eval(MEASURE))
  ok(mu.bg === 'rgba(0, 0, 0, 0)', '移出后背景复原', mu.bg)

  await page.screenshot(path.join(SHOT_DIR, dist + '-' + theme + '-idle.png'))
  await page.eval(CLICK_RATE(0))
  await sleep(600)
  const mg = JSON.parse(await page.eval(MEASURE))
  ok(mg.pressed[0] === 'true', '点赞后 aria-pressed=true', JSON.stringify(mg.pressed))
  ok(mg.vb === '0 0 16 16' && !mg.fillRule,
    '点赞后图标变实心（WorkBuddy 双态：线框→实心）', 'vb=' + mg.vb + ' fillRule=' + mg.fillRule)
  ok(mg.color === mg.t2, '点赞后**不改颜色**（WorkBuddy 选中态不靠变色）', mg.color + ' == ' + mg.t2)
  await page.screenshot(path.join(SHOT_DIR, dist + '-' + theme + '-liked.png'))
  await zoom(page, dist, theme + '-liked')

  await page.eval(CLICK_RATE(0))
  await sleep(600)
  const mc = JSON.parse(await page.eval(MEASURE))
  ok(mc.pressed[0] === 'false' && mc.vb === '0 0 15 14', '再点一次取消 → 回线框', 'vb=' + mc.vb)

  await page.eval(CLICK_RATE(1))
  await sleep(700)
  const md = JSON.parse(await page.eval(MEASURE))
  ok(md.corr === true, '点踩先弹出结构化纠错面板（v426 闭环未回归）', String(md.corr))
  ok(md.pressed[1] === 'false',
    '面板未确认前不抢跑高亮（反映 v426 时序：点踩要等纠正提交才落库；若将来改乐观高亮需同步此断言）',
    JSON.stringify(md.pressed))
  await page.screenshot(path.join(SHOT_DIR, dist + '-' + theme + '-disliked.png'))
  await page.eval("(function(){var m=document.querySelector('.cp-corr-mask');if(m)m.click();return 'ok'})()")
  await sleep(800)
  const cm = JSON.parse(await page.eval(MEASURE))
  ok(cm.corr === false, '点遮罩（等于「不用了」）关闭面板', String(cm.corr))
  console.log('        [诊断] feedback 请求次数=' + cm.fb + ' 类型=' + JSON.stringify(cm.fbVals) +
    ' pressed=' + JSON.stringify(cm.pressed) + ' 点赞vb=' + cm.vb + ' 点踩vb=' + cm.vb2)
  ok(cm.pressed[1] === 'true' && cm.vb2 === '0 0 16 16', '确认后面板落库 → 点踩图标变实心', 'vb2=' + cm.vb2)
  ok(cm.color === cm.t2, '点踩后同样不改色', cm.color)

  ok(page.errors.length === 0, '控制台零报错', page.errors.slice(0, 2).join(' | ') || 'none')

  await browser.close()
  srv && srv.close()
}

async function runDark(dist, cred) {
  console.log('\n================ ' + LABEL + ' / dark ================')
  const { srv, browser, page, setup } = await open(dist, 'dark', cred)
  if (setup !== 'ok') { fail++; console.log('  FAIL  副驾未能打开：' + setup); await browser.close(); srv && srv.close(); return }
  const m = JSON.parse(await page.eval(MEASURE))
  ok(m.w === 24 && m.radius === '8px', '深色下尺寸/圆角不变', m.w + '×' + m.radius)
  ok(m.t2 === 'rgb(174, 174, 178)' && m.color === m.t2, '深色字色 = --t2(#aeaeb2)，未硬编码浅色', m.color)
  const hv = await hover(page, '.cp-msg-actions .cp-act.cp-rate')
  const mh = JSON.parse(await page.eval(MEASURE))
  ok(hv && mh.b2 === 'rgb(58, 58, 60)' && mh.bg === mh.b2, '深色 hover 背景 = --b2(#3a3a3c)', mh.bg + ' == ' + mh.b2)
  await page.eval(CLICK_RATE(0))
  await sleep(600)
  const mg = JSON.parse(await page.eval(MEASURE))
  ok(mg.vb === '0 0 16 16' && mg.color === mg.t2, '深色下实心切换 + 不改色', 'vb=' + mg.vb + ' color=' + mg.color)
  await page.screenshot(path.join(SHOT_DIR, dist + '-dark-liked.png'))
  ok(page.errors.length === 0, '深色控制台零报错', page.errors.slice(0, 2).join(' | ') || 'none')
  await browser.close()
  srv && srv.close()
}

console.log('目标：' + (PROD ? PROD_URL + '（生产公网真机）' : '本地产物 ' + DIST) +
  '\n判据来源：WorkBuddy.app → app.asar → lib-chat-ui-*.css 实测')
const cred = await login()
console.log('已登录生产（' + cred.user.username + ' / tenant ' + cred.tenant_id + '）')
await run(DIST, 'light', cred)
await runDark(DIST, cred)
console.log('\n================ 汇总 ' + LABEL + ' ================')
console.log('PASS ' + pass + ' / FAIL ' + fail)
console.log('截图目录 ' + SHOT_DIR)
process.exit(fail === 0 ? 0 : 1)
