/**
 * v456-copilot-read-probe.mjs —— 副驾「朗读」改走**服务端合成**后的真机验收
 *
 * 判据来源：
 *   ① 后端 `/api/ai/tts` 已由 `v456-tts-probe.py` **在生产服务器上**验过 11 项
 *      （合成成功 / Content-Type / mp3 头 / 边界 400·413 / 音色清单 / 缓存 / RBAC 拒绝 supervisor）；
 *   ② 本探针只验**前端行为**：点朗读 → 发 POST（含 text + voice）→ 播 blob 音频 → 可停止 →
 *      后端 503 时**回落**浏览器内置朗读（不是静默哑掉）。
 *
 * 🔴 三个必须的桩/开关（否则探针会给出**误导性的全红**，让人误判"实现错了"）：
 *   1) `/api/ai/tts` —— 探针账号 mptestsp 是 supervisor，对 `/api/ai/*`（模块 `chat`）
 *      **必然 403**（这是权限设计，不是缺陷；已由后端的 RBAC 用例单独证明）。
 *      不打桩 ⇒ 前端走"回落分支" ⇒ "播音频"这一整组断言全红。⇒ 桩成返回**真实 mp3**，
 *      并在桩里**校验请求体字段名**（这样前后端契约也一并验了）。
 *   2) `--autoplay-policy=no-user-gesture-required` —— headless 下程序化 click **不算用户手势**，
 *      默认策略会让 `audio.play()` 抛 NotAllowedError ⇒ 又是一组假红。
 *   3) `window.Audio` / `speechSynthesis.speak` 打钩子 —— `new Audio()` **不插入 DOM**，
 *      没有钩子就无法从外部观察到"到底播没播"。
 *
 * 用法：
 *   node v456-copilot-read-probe.mjs                    # 打本地 dist-v456（期望全绿）
 *   node v456-copilot-read-probe.mjs --prod             # 打生产公网真机
 *   node v456-copilot-read-probe.mjs dist-v456-head-v1  # 判别力自证（旧产物，期望关键断言 FAIL）
 */
import { launch } from './lib/cdp-lite.mjs'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2'
const PROD = process.argv.includes('--prod')
const PROD_URL = 'https://hergent.cn/'
const DIST = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'dist-v456'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v456-read' + (PROD ? '-prod' : '')
const API_TARGET = 'https://erp.hergent.cn'
const ACCT = { username: 'mptestsp', password: 'Mpsup@1' }
/* 桩返回的音频：用**真实生成**的晓晓配音（16.5 秒）——够长，保证"播放中"可稳定观测；
   同时它本身就是"服务端应当产出的东西"的真实样本，不是伪造的字节。 */
const MP3 = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v456-voice/edge-1-晓晓-女-亲和.mp3'
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

const stubSrc = (d, theme, b64) => [
  "localStorage.setItem('hergent_v2_token'," + JSON.stringify(d.token) + ");",
  "localStorage.setItem('hergent_v2_csrf'," + JSON.stringify(d.csrf_token || '') + ");",
  "localStorage.setItem('hergent_v2_user'," + JSON.stringify(JSON.stringify(d.user || {})) + ");",
  "localStorage.setItem('hergent_v2_tenant'," + JSON.stringify(String(d.tenant_id || 1)) + ");",
  "localStorage.setItem('hergent_theme','" + theme + "');",
  "window.__TTS_B64=" + JSON.stringify(b64) + ";",
  "(function(){",
  /* 钩子 ①：Audio 实例（`new Audio()` 不入 DOM，没有它就无法观测"播没播"） */
  "window.__audios=[];var _A=window.Audio;",
  "function _A2(u){var a=new _A(u);window.__audios.push(a);return a}",
  "_A2.prototype=_A.prototype;window.Audio=_A2;",
  /* 钩子 ②：内置朗读调用（验"回落分支"是否真的走了） */
  "window.__speakCalls=[];",
  "if(window.speechSynthesis){var _sp=window.speechSynthesis.speak.bind(window.speechSynthesis);",
  "window.speechSynthesis.speak=function(u){window.__speakCalls.push(String((u&&u.text)||''));return _sp(u)};}",
  /* 桩 ③：/api/ai/tts —— 返回真实 mp3；同时记录请求，供**契约**断言 */
  "window.__ttsMode='ok';window.__ttsCalls=[];",
  "var _f=window.fetch;window.fetch=function(u,o){",
  "var s=(typeof u==='string')?u:((u&&u.url)||'');",
  "if(s.indexOf('/api/ai/tts')>=0&&s.indexOf('/voices')<0){",
  "  window.__ttsCalls.push({method:(o&&o.method)||'GET',body:(o&&o.body)||null});",
  "  if(window.__ttsMode==='fail'){return Promise.resolve(new Response('{\"detail\":\"合成不可用\"}',",
  "    {status:503,headers:{'Content-Type':'application/json'}}));}",
  "  var b=atob(window.__TTS_B64),n=b.length,u8=new Uint8Array(n);",
  "  for(var i=0;i<n;i++)u8[i]=b.charCodeAt(i);",
  "  return Promise.resolve(new Response(u8,{status:200,headers:{'Content-Type':'audio/mpeg'}}));}",
  "return _f.apply(this,arguments)};",
  "})();",
].join('')

/* 打开副驾并塞一条 assistant 消息 —— 走真实 store / 真实组件 / 真实 CSS，不伪造 DOM */
const SETUP = [
  "(function(){",
  "var el=document.querySelector('#app');if(!el||!el.__vue_app__)return 'no-app';",
  "var app=el.__vue_app__;var pinia=app.config.globalProperties.$pinia;",
  "if(!pinia)return 'no-pinia';",
  "var st=pinia._s.get('app');if(!st)return 'no-store';",
  "st.ui.copilotOpen=true;st.chat.streaming=false;",
  "st.chat.messages=[{role:'user',content:'探针问题'},{role:'assistant',content:'这是一条用于验收朗读的副驾回复文本。'}];",
  "return 'ok';})()",
].join('')

const MEASURE = [
  "(function(){",
  "var q=function(s){return [].slice.call(document.querySelectorAll(s))};",
  "var acts=q('.cp-msg-actions .cp-act');",
  /* 按 **title 文案** 定位朗读按钮（不硬编码下标 —— 操作栏顺序将来可能调整） */
  "var rb=acts.filter(function(b){return (b.getAttribute('title')||'').indexOf('朗读')>=0})[0]||null;",
  "var as=window.__audios||[],a0=as[0]||null,calls=window.__ttsCalls||[],last=calls[calls.length-1]||null;",
  "var body=null;try{body=last&&last.body?JSON.parse(last.body):null}catch(e){}",
  "return JSON.stringify({",
  "  actCount:acts.length,hasReadBtn:!!rb,",
  "  readTitle:rb?rb.getAttribute('title'):null,",
  "  readOn:rb?/(^|\\s)on(\\s|$)/.test(rb.className):null,",
  "  ttsCalls:calls.length,ttsMethod:last?last.method:null,ttsBody:body,",
  "  audios:as.length,audioPaused:a0?a0.paused:null,",
  "  audioSrc:a0?String(a0.src||'').slice(0,5):null,",
  "  audioDur:a0?(isFinite(a0.duration)?a0.duration:null):null,",
  "  speakCalls:(window.__speakCalls||[]).length,",
  "  ttsMode:window.__ttsMode",
  "});})()",
].join('')

/* 按 title 文案点朗读（点后 title 变「停止朗读」，仍含"朗读"二字 ⇒ 同一定位式可复用） */
const CLICK_READ =
  "(function(){var b=[].slice.call(document.querySelectorAll('.cp-msg-actions .cp-act'))" +
  ".filter(function(x){return (x.getAttribute('title')||'').indexOf('朗读')>=0})[0];" +
  "if(!b)return 'no';b.click();return 'ok'})()"
const SET_MODE = (m) => "window.__ttsMode='" + m + "';'ok'"

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
  /* 🔴 autoplay 策略必须放开：headless 里 `b.click()` 是程序化点击，**不算用户手势**，
     默认策略下 `audio.play()` 会抛 NotAllowedError ⇒ "正在播放"断言会假红。 */
  const browser = await launch({
    headless: true,
    extraArgs: ['--autoplay-policy=no-user-gesture-required'],
  })
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(stubSrc(cred, theme, fs.readFileSync(MP3).toString('base64')))
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

  let m = JSON.parse(await page.eval(MEASURE))
  ok(m.actCount >= 6, '操作栏渲染完整（复制/点赞/点踩/朗读/重生成/分享）', 'act=' + m.actCount)
  ok(m.hasReadBtn, '定位到朗读按钮（按 title 文案）', String(m.readTitle))
  /* 初始态：**不该**有任何合成请求/音频 —— 否则说明"一进页面就在偷偷合成" */
  ok(m.ttsCalls === 0 && m.audios === 0, '初始态：无合成请求、无音频实例',
    'calls=' + m.ttsCalls + ' audios=' + m.audios)
  ok(m.readTitle === '朗读' && !m.readOn, '初始态：按钮为「朗读」未激活', String(m.readTitle))

  console.log('  [第 1 击] 点朗读 → 期望：POST 合成 → 播 blob 音频')
  ok(await page.eval(CLICK_READ) === 'ok', '点击朗读按钮')
  await sleep(1800)
  m = JSON.parse(await page.eval(MEASURE))
  ok(m.ttsCalls === 1, '发起了 1 次合成请求', 'calls=' + m.ttsCalls)
  ok(m.ttsMethod === 'POST', '用 POST（长文本不进 URL，避免 access log 泄漏/长度限制）', String(m.ttsMethod))
  ok(!!(m.ttsBody && typeof m.ttsBody.text === 'string' && m.ttsBody.text.length > 0),
    '请求体字段名契约：含 text', JSON.stringify(m.ttsBody).slice(0, 90))
  ok(!!(m.ttsBody && m.ttsBody.voice === 'zh-CN-XiaoxiaoNeural'),
    '默认音色 = 晓晓（zh-CN-XiaoxiaoNeural）', m.ttsBody && String(m.ttsBody.voice))
  ok(m.audios === 1, '创建了 1 个音频实例（不叠加）', 'audios=' + m.audios)
  ok(m.audioSrc === 'blob:', '音源是 blob:（=服务端 mp3；若走内置语音则不会有 Audio 实例）', String(m.audioSrc))
  ok(m.audioPaused === false, '音频正在播放', 'paused=' + m.audioPaused)
  ok(m.readTitle === '停止朗读', '按钮切到「停止朗读」态', String(m.readTitle))

  console.log('  [第 2 击] 再点 → 期望：停止，且不重复请求')
  ok(await page.eval(CLICK_READ) === 'ok', '再次点击（停止）')
  await sleep(600)
  m = JSON.parse(await page.eval(MEASURE))
  ok(m.audioPaused === true, '音频已暂停（不会继续念）', 'paused=' + m.audioPaused)
  ok(m.readTitle === '朗读', '按钮复位为「朗读」', String(m.readTitle))
  ok(m.ttsCalls === 1, '停止不会多发一次合成请求', 'calls=' + m.ttsCalls)
  ok(m.audios === 1, '停止不会新建音频实例', 'audios=' + m.audios)

  console.log('  [第 3 击] 服务端 503 → 期望：回落浏览器内置朗读（不是静默哑掉）')
  await page.eval(SET_MODE('fail'))
  ok(await page.eval(CLICK_READ) === 'ok', '第三次点击朗读')
  await sleep(1500)
  m = JSON.parse(await page.eval(MEASURE))
  ok(m.ttsCalls === 2, '确实又请求了一次服务端', 'calls=' + m.ttsCalls)
  ok(m.speakCalls === 1, '服务端不可用 ⇒ **回落**浏览器内置朗读', 'speakCalls=' + m.speakCalls)
  ok(m.audios === 1, '回落路径不再创建音频实例', 'audios=' + m.audios)

  await page.screenshot(path.join(SHOT_DIR, dist + '-' + theme + '-actions.png'))
  await browser.close(); srv && srv.close()
}

const cred = await login()
await run(DIST, 'light', cred)
await run(DIST, 'dark', cred)
console.log('\n================ 汇总 ' + LABEL + ' ================')
console.log('  ' + pass + ' PASS / ' + fail + ' FAIL')
console.log('  截图目录：' + SHOT_DIR)
process.exit(fail === 0 ? 0 : 1)
