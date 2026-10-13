/**
 * v490 探针（只读；不写任何服务端状态）
 * AI 副驾「朗读」—— 失败时是否**明确提示**（消灭静默失败）
 *
 * 背景：
 *   副驾朗读主链路 = POST /api/ai/tts（服务端 edge-tts 合成 mp3）→ <audio> 播放；
 *   失败时原代码**静默**回落到浏览器内置朗读（speakLocal），用户既听不到声、也看不到任何提示
 *   ⇒ 用户报「点了朗读没声音」，排查无门（2026-10-13 实测：微软侧 403 ⇒ 后端恒 503）。
 *   v490 加固：服务端失败时明确 toast 告知已降级；兜底也哑时（看门狗 1.5s 未 onstart）再明确提示。
 *
 * 判据（全部只看真实 DOM / 真实交互）：
 *   P0  未跳登录页
 *   A   点到了助手气泡上的「朗读」按钮
 *   B   服务端合成失败（503）⇒ 出现明确提示「在线语音服务暂不可用…」（不再静默）
 *   C   兜底（浏览器朗读）也不出声时，看门狗给出「朗读没有出声…」提示
 *   P5  全程零 console.error / 零页面异常
 *
 * 用法：
 *   V490_BASE=http://127.0.0.1:8161 node v490-tts-feedback-probe.mjs   # v490 修后（应 5/5）
 *   V490_BASE=http://127.0.0.1:8163 node v490-tts-feedback-probe.mjs   # 修前基线（B/C 应 FAIL）
 * ⚠️ 本机沙箱挡 Chrome 访问 loopback ⇒ 本地跑须在非沙箱环境执行。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.V490_BASE || 'https://hergent.cn'
const TOKEN = process.env.HG_TOKEN || 'local-dummy-token'
const TENANT = process.env.HG_TENANT || '1'
const IS_LOCAL = /127\.0\.0\.1|localhost/.test(BASE)

const SESS_KEY = 'hergent_chat_sessions_v1'
const now = Date.now()

const mkSess = () => ({
  id: '_v490_TTS_', title: '朗读', roleId: 'copilot', updated_at: now - 1000,
  messages: [
    { role: 'user', content: '帮我读一下今天的经营要点' },
    { role: 'assistant', content: '本月低温奶达成 87%，比目标差 13 个百分点，建议下周重点跟进蒙牛纯甄。' },
  ],
})

const R = []
const ok = (name, cond, detail = '') => R.push({ name, pass: !!cond, detail: String(detail) })

// 永驻 init：token + fetch 桩（tts 恒 503；兜底 speechSynthesis 桩成"不发 onstart"=不出声）
const INIT_STUB = `
(function(){
  try {
    localStorage.setItem('hergent_v2_token', ${JSON.stringify(TOKEN)});
    localStorage.setItem('hergent_v2_tenant', ${JSON.stringify(TENANT)});
  } catch(e){}
  // 兜底桩：speechSynthesis 存在但**永不 onstart**（模拟"本机无中文语音/被静音"）
  try {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak(){}, cancel(){}, pause(){}, resume(){}, getVoices(){ return []; }, addEventListener(){}, removeEventListener(){} }
    });
  } catch(e){}
  const _f = window.fetch.bind(window);
  const J = (obj, status) => new Promise(res => setTimeout(function(){
    res(new Response(JSON.stringify(obj), { status: status||200, headers:{ 'Content-Type':'application/json' } }));
  }, 60));
  window.fetch = function(u, o){
    const url = (typeof u === 'string') ? u : ((u && u.url) || '');
    if (url.indexOf('/api/ai/roles') === 0) {
      return J({ roles: [ { role_id:'copilot', name:'经营副驾', is_active:1, system_prompt:'', guard:'' } ] });
    }
    if (url.indexOf('/api/ai/tts/voices') === 0) {
      return J({ default:'zh-CN-XiaoxiaoNeural', voices:[ { id:'zh-CN-XiaoxiaoNeural', name:'晓晓', gender:'女', style:'亲和通用' } ] });
    }
    if (url.indexOf('/api/ai/tts') === 0) {
      // 🔴 核心诱发：模拟生产现状（微软侧 403 ⇒ 后端 503）
      return J({ detail: '语音合成暂不可用，请稍后重试' }, 503);
    }
    if (/\\/api\\/ai\\/sessions\\/[^/]+/.test(url)) {
      const id = url.split('/api/ai/sessions/')[1].split('?')[0];
      let msgs = [];
      try { const arr = JSON.parse(localStorage.getItem(${JSON.stringify(SESS_KEY)})||'[]'); const s = arr.find(x=>x.id===id); if (s) msgs = s.messages||[]; } catch(e){}
      return J({ session: { messages: msgs } });
    }
    if (/\\/api\\/ai\\/sessions(\\?|$)/.test(url)) return J({ sessions: [] });
    return _f(u, o);
  };
})();
`

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const browser = await launch({ extraArgs: IS_LOCAL ? ['--no-proxy-server'] : [] })
try {
  const page = await browser.newPage()
  await page.enable()
  await page.addInitScript(INIT_STUB)
  await page.addInitScript(
    `(function(){ try { localStorage.setItem(${JSON.stringify(SESS_KEY)}, ${JSON.stringify(JSON.stringify([mkSess()]))}); } catch(e){} })();`
  )

  await page.goto(BASE + '/?__r=' + Date.now() + '#/workbench', 2600)
  const url1 = await page.eval('location.href')
  ok('P0 未跳登录页', !/#\/login/.test(url1), url1)

  // 打开副驾
  await page.eval(`(() => { const b=document.querySelector('.tb-copilot'); if(b) b.click(); })()`)
  await sleep(1600)

  // 点「朗读」按钮（助手气泡上的 .cp-act）
  const clicked = await page.eval(`(() => {
    const b = [...document.querySelectorAll('.cp-body .cp-act')]
      .find(x => { const t = x.getAttribute('title')||''; return t === '朗读' || t === '停止朗读'; });
    if (!b) return false; b.click(); return true;
  })()`)
  ok('A 点到了助手气泡上的「朗读」按钮', clicked)

  // 采集 3.4s 内出现的全部 toast 文案（服务端失败提示 + 看门狗提示）
  const seen = []
  const t0 = Date.now()
  while (Date.now() - t0 < 3400) {
    const t = await page.eval(`(() => [...document.querySelectorAll('.notif-dock .toast-msg')].map(x => x.innerText.trim()).join(' ~~ '))()`)
    if (t && seen.indexOf(t) < 0) seen.push(t)
    await sleep(140)
  }
  const allToast = seen.join('  ||  ')
  console.log('\n--- 采集到的提示文案 ---\n' + (allToast || '(无任何提示)'))

  ok('B 服务端合成失败(503) ⇒ 明确提示「在线语音服务暂不可用…」（不再静默）',
     allToast.indexOf('在线语音服务暂不可用') >= 0, 'toasts=' + allToast)
  ok('C 兜底也不出声时 ⇒ 看门狗提示「朗读没有出声…」',
     allToast.indexOf('朗读没有出声') >= 0, 'toasts=' + allToast)

  const errs = (page.errors || []).filter(e => !/401|403|503|Failed to load resource|net::ERR|Load failed|ERR_/i.test(e))
  ok('P5 全程零 console.error / 零页面异常', errs.length === 0, JSON.stringify(errs).slice(0, 260))
} catch (e) {
  ok('探针执行未抛异常', false, (e && e.message) || String(e))
} finally {
  console.log('\n===== v490 朗读失败提示探针 =====  BASE=' + BASE)
  let n = 0
  for (const r of R) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   ← ' + r.detail))
    n += r.pass ? 1 : 0
  }
  console.log('---- ' + n + '/' + R.length + ' 通过 ----')
  await browser.close()
  process.exit(0)
}
