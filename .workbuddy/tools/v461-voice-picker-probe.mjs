/**
 * v461-voice-picker-probe.mjs —— 副驾工具栏「朗读声音」选择器的真机验收
 *
 * 判据来源：
 *   ① 「可选项来源」的**真实性**由 `v456-tts-probe.py`（服务器侧、读库取 boss token）证明：
 *      `GET /api/ai/tts/voices` 返回 5 个音色 + `default=zh-CN-XiaoxiaoNeural`。
 *      本探针不重复那一层，只记录**前端到底打了哪个 URL**（证明"清单来自后端接口"这条链路存在），
 *      并用「**变异 payload**」场景证明界面**不是硬编码**的名单。
 *   ② 本探针只验**前端行为**：胶囊放置位置 → 点开 → 清单渲染 → 当前项/默认项标记 → 选中落
 *      localStorage + 提示 + 胶囊文案跟随 → **后续朗读真的换了音色** → **不打断正在念的那条**
 *      → 存档非法音色时**自愈回落默认**。
 *
 * 🔴 三个必须的桩/开关（同 v456；缺任一条会得到**误导性全红**，让人误判"实现错了"）：
 *   1) `/api/ai/*` 打桩 —— 探针账号 mptestsp 是 supervisor，对模块 `chat` **必然 403**
 *      （这是权限设计，已由 `v456-tts-probe.py` 的 RBAC 用例单独证明）。不打桩 ⇒ 清单拉不到、
 *      朗读走"回落浏览器内置朗读"分支 ⇒ 与音色相关的断言全红。桩里返回**真实 payload**。
 *   2) `--autoplay-policy=no-user-gesture-required` —— headless 里程序化 click 不算用户手势，
 *      默认策略下 `audio.play()` 抛 NotAllowedError ⇒ "正在播放"断言假红。
 *   3) hook `window.Audio` —— `new Audio()` **不插入 DOM**，没有钩子就无法观测"到底播没播"。
 *
 * 用法：
 *   node v461-voice-picker-probe.mjs                       # 打本地 dist-v461（期望全绿）
 *   node v461-voice-picker-probe.mjs --prod                # 打生产公网真机
 *   HG_ROOT=/private/tmp/hergent-build-v461/hergent-cn-v2 \
 *     node v461-voice-picker-probe.mjs dist-prodcheck      # 判别力自证（改动前产物，期望 FAIL）
 */
import { launch } from './lib/cdp-lite.mjs'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.env.HG_ROOT || '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2'
const PROD = process.argv.includes('--prod')
const PROD_URL = 'https://hergent.cn/'
const DIST = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'dist-v461'
const SHOT_DIR = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v461-voice' + (PROD ? '-prod' : '')
const API_TARGET = 'https://erp.hergent.cn'
const ACCT = { username: 'mptestsp', password: 'Mpsup@1' }
const MP3 = '/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v456-voice/edge-1-晓晓-女-亲和.mp3'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try { fs.mkdirSync(SHOT_DIR, { recursive: true }) } catch { /* ignore */ }
const LABEL = PROD ? 'PROD hergent.cn' : (process.env.HG_ROOT ? DIST + ' @HG_ROOT' : DIST)

/* 真实名单：与后端 `hergent-erp/server/routers/ai_tts.py::tts_voices` 逐字一致（含 default） */
const REAL_PAYLOAD = {
  ok: true,
  default: 'zh-CN-XiaoxiaoNeural',
  voices: [
    { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', gender: '女', style: '亲和通用' },
    { id: 'zh-CN-XiaoyiNeural', name: '晓伊', gender: '女', style: '活泼' },
    { id: 'zh-CN-YunxiNeural', name: '云希', gender: '男', style: '年轻' },
    { id: 'zh-CN-YunjianNeural', name: '云健', gender: '男', style: '浑厚' },
    { id: 'zh-CN-YunyangNeural', name: '云扬', gender: '男', style: '播报' },
  ],
}
/* 变异名单：**只换名字/加一条**。若界面照实渲染 ⇒ 证明它不是硬编码；若界面仍显示"云希"
   或只有 5 项 ⇒ 说明前端自带一份名单（这正是本轮要避免的缺陷）。 */
const MUT_PAYLOAD = {
  ok: true,
  default: 'zh-CN-XiaoxiaoNeural',
  voices: [
    { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', gender: '女', style: '亲和通用' },
    { id: 'zh-CN-XiaoyiNeural', name: '晓伊', gender: '女', style: '活泼' },
    { id: 'zh-CN-YunxiNeural', name: '云希·改', gender: '男', style: '探针变异' },
    { id: 'zh-CN-YunjianNeural', name: '云健', gender: '男', style: '浑厚' },
    { id: 'zh-CN-YunyangNeural', name: '云扬', gender: '男', style: '播报' },
    { id: 'zh-CN-XiaomoNeural', name: '晓墨', gender: '女', style: '探针新增' },
  ],
}

const MIME = {
  '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.json': 'application/json', '.map': 'application/json',
}

let pass = 0, fail = 0
const ok = (c, n, e) => {
  if (c) { pass++; console.log('  PASS  ' + n + (e !== undefined ? '   -> ' + e : '')) }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '   -> ' + e : '')) }
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

const initSrc = (d, theme, b64, payload, presetVoice) => [
  "localStorage.setItem('hergent_v2_token'," + JSON.stringify(d.token) + ");",
  "localStorage.setItem('hergent_v2_csrf'," + JSON.stringify(d.csrf_token || '') + ");",
  "localStorage.setItem('hergent_v2_user'," + JSON.stringify(JSON.stringify(d.user || {})) + ");",
  "localStorage.setItem('hergent_v2_tenant'," + JSON.stringify(String(d.tenant_id || 1)) + ");",
  "localStorage.setItem('hergent_theme','" + theme + "');",
  presetVoice
    ? "localStorage.setItem('hg_copilot_tts_voice'," + JSON.stringify(presetVoice) + ");"
    : "localStorage.removeItem('hg_copilot_tts_voice');",
  "window.__VOICES=" + JSON.stringify(payload) + ";",
  "window.__TTS_B64=" + JSON.stringify(b64) + ";",
  "(function(){",
  /* 钩子 ①：Audio 实例 */
  "window.__audios=[];var _A=window.Audio;",
  "function _A2(u){var a=new _A(u);window.__audios.push(a);return a}",
  "_A2.prototype=_A.prototype;window.Audio=_A2;",
  /* 钩子 ②：内置朗读（验"回落分支"，本轮正常情况下不该被走到） */
  "window.__speakCalls=[];",
  "if(window.speechSynthesis){var _sp=window.speechSynthesis.speak.bind(window.speechSynthesis);",
  "window.speechSynthesis.speak=function(u){window.__speakCalls.push(String((u&&u.text)||''));return _sp(u)};}",
  /* 桩 ③：/api/ai/tts/voices（清单）与 /api/ai/tts（合成）。voices 必须先判，否则被前缀吞掉 */
  "window.__voicesCalls=[];window.__ttsCalls=[];window.__ttsMode='ok';",
  "var _f=window.fetch;window.fetch=function(u,o){",
  "var s=(typeof u==='string')?u:((u&&u.url)||'');",
  "if(s.indexOf('/api/ai/tts/voices')>=0){",
  "  window.__voicesCalls.push({url:s,method:((o&&o.method)||'GET')});",
  "  return Promise.resolve(new Response(JSON.stringify(window.__VOICES),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));}",
  "if(s.indexOf('/api/ai/tts')>=0){",
  "  window.__ttsCalls.push({method:((o&&o.method)||'GET'),body:((o&&o.body)||null)});",
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
  "var app=el.__vue_app__;var pinia=app.config.globalProperties.$pinia;if(!pinia)return 'no-pinia';",
  "var st=pinia._s.get('app');if(!st)return 'no-store';",
  "st.ui.copilotOpen=true;st.chat.streaming=false;",
  "st.chat.messages=[{role:'user',content:'探针问题'},{role:'assistant',content:'这是一条用于验收朗读声音选择器的副驾回复文本。'}];",
  "return 'ok';})()",
].join('')

const MEASURE = [
  "(function(){",
  "var q=function(s){return [].slice.call(document.querySelectorAll(s))};",
  "var btn=document.querySelector('.cp-ttsv-btn'),box=document.querySelector('.cp-ttsv');",
  "var guard=document.querySelector('.cp-guard'),tools=document.querySelector('.cp-tools');",
  "var items=q('.cp-ttsv-menu .cp-role-item');",
  "var acts=q('.cp-msg-actions .cp-act');",
  "var rb=acts.filter(function(b){return (b.getAttribute('title')||'').indexOf('朗读')>=0})[0]||null;",
  "var as=window.__audios||[],a0=as[0]||null,calls=window.__ttsCalls||[];",
  "var last=calls[calls.length-1]||null,body=null;",
  "try{body=last&&last.body?JSON.parse(last.body):null}catch(e){}",
  "var vc=window.__voicesCalls||[],vlast=vc[vc.length-1]||null;",
  "var ls=null;try{ls=localStorage.getItem('hg_copilot_tts_voice')}catch(e){}",
  "return JSON.stringify({",
  "  hasBtn:!!btn,hasBox:!!box,",
  "  inTools:!!(tools&&box&&tools.contains(box)),",
  "  afterGuard:!!(guard&&box&&(guard.compareDocumentPosition(box)&4)),",
  "  btnText:btn?String(btn.textContent||'').trim():null,",
  "  menuOpen:!!document.querySelector('.cp-ttsv-menu'),",
  "  itemCount:items.length,",
  "  itemNames:items.map(function(e){var n=e.querySelector('.cp-role-item-name');return n?String(n.textContent||'').trim():''}),",
  "  onNames:items.filter(function(e){return (' '+e.className+' ').indexOf(' on ')>=0})",
  "    .map(function(e){var n=e.querySelector('.cp-role-item-name');return n?String(n.textContent||'').trim():''}),",
  "  defMarked:items.filter(function(e){var d=e.querySelector('.cp-role-item-desc');return d&&String(d.textContent||'').indexOf('（默认）')>=0})",
  "    .map(function(e){var n=e.querySelector('.cp-role-item-name');return n?String(n.textContent||'').trim():''}),",
  "  voicesCalls:vc.length,voicesMethod:vlast?vlast.method:null,voicesUrl:vlast?vlast.url:null,",
  "  lsVoice:ls,toasts:q('.toast .toast-msg').map(function(e){return String(e.textContent||'').trim()}),",
  "  ttsCalls:calls.length,ttsMethod:last?last.method:null,ttsBody:body,",
  "  audios:as.length,audioPaused:a0?a0.paused:null,audioSrc:a0?String(a0.src||'').slice(0,5):null,",
  "  speakCalls:(window.__speakCalls||[]).length,readTitle:rb?rb.getAttribute('title'):null",
  "});})()",
].join('')

const CLICK_BTN = "(function(){var b=document.querySelector('.cp-ttsv-btn');if(!b)return 'no';b.click();return 'ok'})()"
const PICK = (name) => (
  "(function(){var it=[].slice.call(document.querySelectorAll('.cp-ttsv-menu .cp-role-item'))" +
  ".filter(function(e){var n=e.querySelector('.cp-role-item-name');" +
  "return n&&String(n.textContent||'').trim()===" + JSON.stringify(name) + "})[0];" +
  "if(!it)return 'no';it.click();return 'ok'})()")
const CLICK_READ =
  "(function(){var b=[].slice.call(document.querySelectorAll('.cp-msg-actions .cp-act'))" +
  ".filter(function(x){return (x.getAttribute('title')||'').indexOf('朗读')>=0})[0];" +
  "if(!b)return 'no';b.click();return 'ok'})()"

async function open(dist, theme, cred, payload, presetVoice) {
  let srv = null, target
  if (PROD) target = PROD_URL
  else { const r = await serve(path.join(ROOT, dist)); srv = r.srv; target = 'http://127.0.0.1:' + r.port + '/' }
  const browser = await launch({ headless: true, extraArgs: ['--autoplay-policy=no-user-gesture-required'] })
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(initSrc(cred, theme, fs.readFileSync(MP3).toString('base64'), payload, presetVoice))
  await page.goto(target, PROD ? 15000 : 5500)
  const setup = await page.eval(SETUP)
  await sleep(PROD ? 2200 : 1400)
  return { srv, browser, page, setup }
}

/** 场景 A：真实名单 —— 放置位置 / 渲染 / 默认标记 / 切换 / 生效 / 不打断 */
async function scenarioA(cred, theme) {
  console.log('\n================ ' + LABEL + ' / 场景A 真实名单 / ' + theme + ' ================')
  const { srv, browser, page, setup } = await open(DIST, theme, cred, REAL_PAYLOAD, null)
  ok(setup === 'ok', '副驾打开 + 注入一条 assistant 消息', setup)
  if (setup !== 'ok') { await page.screenshot(path.join(SHOT_DIR, DIST + '-' + theme + '-A-FAILED.png')); await browser.close(); srv && srv.close(); return }

  let m = JSON.parse(await page.eval(MEASURE))
  console.log('  [A1] 放置位置与初始态')
  ok(m.hasBtn, '工具栏存在「朗读声音」胶囊（.cp-ttsv-btn）')
  ok(m.inTools, '胶囊在**左侧工具组** .cp-tools 内（不是 .cp-trailing）', 'inTools=' + m.inTools)
  ok(m.afterGuard, '胶囊位于「AI 可以怎么做」(.cp-guard) **之后**', 'afterGuard=' + m.afterGuard)
  ok(m.btnText === '晓晓', '胶囊显示**当前声音名**（默认晓晓）', String(m.btnText))
  ok(!m.menuOpen, '初始态菜单未展开')
  ok(m.voicesCalls >= 1, '打开即向 /api/ai/tts/voices 取清单（可选项来源=后端接口）', 'calls=' + m.voicesCalls)
  ok(m.voicesMethod === 'GET', '用 GET 拉清单', String(m.voicesMethod))
  ok(!!(m.voicesUrl && m.voicesUrl.indexOf('/api/ai/tts/voices') >= 0), 'URL 命中 /api/ai/tts/voices', String(m.voicesUrl))
  ok(m.ttsCalls === 0 && m.audios === 0, '初始态：无合成请求、无音频实例', 'calls=' + m.ttsCalls + ' audios=' + m.audios)

  console.log('  [A2] 点开菜单 → 清单渲染 / 当前项 / 默认标记')
  ok(await page.eval(CLICK_BTN) === 'ok', '点击胶囊')
  await sleep(400)
  m = JSON.parse(await page.eval(MEASURE))
  ok(m.menuOpen, '菜单已展开')
  ok(m.itemCount === 5, '清单 5 项（= 后端名单条数）', 'n=' + m.itemCount)
  ok(JSON.stringify(m.itemNames) === JSON.stringify(['晓晓', '晓伊', '云希', '云健', '云扬']),
    '名称与后端名单**逐项同序**', JSON.stringify(m.itemNames))
  ok(m.onNames.length === 1 && m.onNames[0] === '晓晓', '当前声音项带选中态(.on)', JSON.stringify(m.onNames))
  ok(m.defMarked.length === 1 && m.defMarked[0] === '晓晓', '默认声音项带「（默认）」标记', JSON.stringify(m.defMarked))
  await page.screenshot(path.join(SHOT_DIR, DIST + '-' + theme + '-A-menu.png'))

  console.log('  [A3] 选中「云希」→ 落盘 + 提示 + 胶囊跟随 + 菜单关闭')
  ok(await page.eval(PICK('云希')) === 'ok', '点击「云希」')
  await sleep(500)
  m = JSON.parse(await page.eval(MEASURE))
  ok(m.lsVoice === 'zh-CN-YunxiNeural', '写入 localStorage[hg_copilot_tts_voice]', String(m.lsVoice))
  ok(!m.menuOpen, '选择后菜单自动收起')
  ok(m.btnText === '云希', '胶囊文案跟随为「云希」', String(m.btnText))
  ok(m.toasts.some((t) => t.indexOf('云希') >= 0 && t.indexOf('生效') >= 0),
    '有 toast 明确告知「已切换…下次朗读生效」', JSON.stringify(m.toasts))

  console.log('  [A4] 选后朗读 → 合成请求带**新音色**')
  ok(await page.eval(CLICK_READ) === 'ok', '点击朗读按钮')
  await sleep(1800)
  m = JSON.parse(await page.eval(MEASURE))
  ok(m.ttsCalls === 1, '发起 1 次合成请求', 'calls=' + m.ttsCalls)
  ok(m.ttsMethod === 'POST', '用 POST', String(m.ttsMethod))
  ok(!!(m.ttsBody && m.ttsBody.voice === 'zh-CN-YunxiNeural'),
    '**请求体 voice = 新选的云希**（切换对后续朗读生效）', m.ttsBody && String(m.ttsBody.voice))
  ok(m.audioPaused === false, '音频正在播放', 'paused=' + m.audioPaused)
  ok(m.readTitle === '停止朗读', '按钮切到「停止朗读」', String(m.readTitle))

  console.log('  [A5] 正在念时再切音色 → **不打断**')
  ok(await page.eval(CLICK_BTN) === 'ok', '朗读中再次点开胶囊')
  await sleep(300)
  ok(await page.eval(PICK('晓伊')) === 'ok', '朗读中改选「晓伊」')
  await sleep(400)
  m = JSON.parse(await page.eval(MEASURE))
  ok(m.lsVoice === 'zh-CN-XiaoyiNeural', '新选择已落盘', String(m.lsVoice))
  ok(m.audioPaused === false, '**正在念的那条没被打断**（仍在播）', 'paused=' + m.audioPaused)
  ok(m.ttsCalls === 1 && m.audios === 1, '切换不触发重新合成、不新建音频', 'calls=' + m.ttsCalls + ' audios=' + m.audios)
  ok(m.readTitle === '停止朗读', '朗读态未被重置', String(m.readTitle))

  console.log('  [A6] 停 → 再念 → 用最新音色')
  ok(await page.eval(CLICK_READ) === 'ok', '点击停止')
  await sleep(500)
  m = JSON.parse(await page.eval(MEASURE))
  ok(m.audioPaused === true && m.readTitle === '朗读', '已停止并复位', 'paused=' + m.audioPaused)
  ok(await page.eval(CLICK_READ) === 'ok', '再次点击朗读')
  await sleep(1800)
  m = JSON.parse(await page.eval(MEASURE))
  ok(m.ttsCalls === 2, '新增 1 次合成请求', 'calls=' + m.ttsCalls)
  ok(!!(m.ttsBody && m.ttsBody.voice === 'zh-CN-XiaoyiNeural'),
    '这次用了**最新的晓伊**', m.ttsBody && String(m.ttsBody.voice))
  await page.screenshot(path.join(SHOT_DIR, DIST + '-' + theme + '-A-actions.png'))
  await browser.close(); srv && srv.close()
}

/** 场景 B：变异名单 + 预置非法音色 —— 证明"清单来自接口、不是硬编码"且"存档非法则自愈" */
async function scenarioB(cred) {
  console.log('\n================ ' + LABEL + ' / 场景B 变异名单 + 非法存档 ================')
  const { srv, browser, page, setup } = await open(DIST, 'light', cred, MUT_PAYLOAD, 'zh-CN-BogusNeural')
  ok(setup === 'ok', '副驾打开（预置非法音色 zh-CN-BogusNeural）', setup)
  if (setup !== 'ok') { await browser.close(); srv && srv.close(); return }

  let m = JSON.parse(await page.eval(MEASURE))
  ok(m.btnText === '晓晓', '存档音色不在后端名单内 ⇒ **自愈回落到默认晓晓**', String(m.btnText))
  ok(await page.eval(CLICK_BTN) === 'ok', '点击胶囊')
  await sleep(400)
  m = JSON.parse(await page.eval(MEASURE))
  ok(m.itemCount === 6, '清单条数跟随接口（变异后 6 项 ⇒ **非硬编码**）', 'n=' + m.itemCount)
  ok(m.itemNames.indexOf('云希·改') >= 0 && m.itemNames.indexOf('晓墨') >= 0,
    '渲染的是接口返回的**变异名称/新增项**', JSON.stringify(m.itemNames))
  ok(m.onNames.length === 1 && m.onNames[0] === '晓晓', '选中态落在自愈后的默认项', JSON.stringify(m.onNames))
  await page.eval("(function(){var b=document.querySelector('.cp-ttsv-btn');b&&b.click();return 'ok'})()")
  await sleep(200)
  ok(await page.eval(CLICK_READ) === 'ok', '点击朗读（未主动改选）')
  await sleep(1800)
  m = JSON.parse(await page.eval(MEASURE))
  ok(!!(m.ttsBody && m.ttsBody.voice === 'zh-CN-XiaoxiaoNeural'),
    '朗读用的是**自愈后的默认晓晓**（而不是那个非法值）', m.ttsBody && String(m.ttsBody.voice))
  await page.screenshot(path.join(SHOT_DIR, DIST + '-B-mutated.png'))
  await browser.close(); srv && srv.close()
}

const cred = await login()
await scenarioA(cred, 'light')
await scenarioA(cred, 'dark')
await scenarioB(cred)
console.log('\n================ 汇总 ' + LABEL + ' ================')
console.log('  ' + pass + ' PASS / ' + fail + ' FAIL')
console.log('  截图目录：' + SHOT_DIR)
process.exit(fail === 0 ? 0 : 1)
