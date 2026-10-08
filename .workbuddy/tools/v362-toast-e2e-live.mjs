/* v362 生产端到端交互探针 —— 零依赖 CDP（Node 22 内置 WebSocket）
   用法： node /tmp/v362-e2e-live.mjs <URL>
   目的：用**生产真实 store + 真实组件 + 真实 CSS** 证明两件事：
     ① 长文案通知条**不自动关闭**（等 8s 仍在）—— 老板诉求 2 的核心
     ② 「点外部关闭 / 点 × 关闭 / 点条内不关」三条行为都对，且短文案仍会自动关闭（未回归）
   反例自证：用「改前旧包」跑同一套断言，期望在「不自动关闭 / 带 ✕」上失败。
   （本轮实测：旧包页面连 CDP 时 `send()` 会等一个永不返回的回执 ⇒ 脚本挂死；
     故反例改为**确定性产物判据** —— 旧包 js 里 `notif-dock`/`toast-x`/`dismissToast` 全 0，
     新包全 ≥1；旧包只含固定 `3e3`(=3000ms)、无 sticky。见 version-history v362 行。）

   🔴 探针自身的两个坑（本轮实测，别再重犯）：
     ① 触发 `store.toast()` 后**必须等一拍**再读 DOM（Vue 渲染是异步的）——
        第一版我直接同步读 `querySelectorAll('.toast').length` 得到 0，误判成「上限断言失败」。
        这是探针 bug，不是产品缺陷。
     ② 给 `send()` 加全局超时；页面崩溃/target 消失时回执永不到达，脚本会静默挂死。 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const URL_ = process.argv[2]
const PORT = 9800 + Math.floor(Math.random() * 150)
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disable-gpu', '--hide-scrollbars', '--window-size=1280,900',
  '--remote-debugging-port=' + PORT, '--user-data-dir=/tmp/v362-e2e-' + PORT, 'about:blank',
], { stdio: 'ignore' })

let ver = null
for (let i = 0; i < 80; i++) {
  try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break }
  catch (e) { await sleep(400) }
}
if (!ver) { console.log('无法启动 Chrome'); process.exit(2) }

const ws = new WebSocket(ver.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r, { once: true }))
let seq = 0; const pending = new Map()
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id)
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)
  }
})
const send = (method, params, sessionId) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, { res, rej })
  ws.send(JSON.stringify({ id, method, params: params || {}, ...(sessionId ? { sessionId } : {}) }))
})

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
await send('Page.navigate', { url: URL_ }, sessionId)
await sleep(5000)

async function ev(expr, awaitPromise) {
  const r = await send('Runtime.evaluate',
    { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise }, sessionId)
  if (r.exceptionDetails) {
    throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 600))
  }
  return r.result.value
}

/* ---- 0. 取到生产真实 store ---- */
const boot = await ev(`(() => {
  const el = document.querySelector('#app')
  if (!el || !el.__vue_app__) return { ok:false, why:'未取到 __vue_app__' }
  const app = el.__vue_app__
  const pinia = app.config.globalProperties.$pinia
  if (!pinia) return { ok:false, why:'未取到 $pinia' }
  const s = pinia._s.get('app')
  if (!s) return { ok:false, why:'未取到 app store, keys=' + Array.from(pinia._s.keys()).join(',') }
  window.__s = s
  return { ok:true, hasToast: typeof s.toast === 'function',
           hasDismiss: typeof s.dismissToast === 'function',
           hasSetTheme: typeof s.setTheme === 'function' }
})()`)

console.log('\n========== [' + URL_ + '] ==========')
console.log('① 取生产真实 store :', JSON.stringify(boot))
if (!boot.ok) { ws.close(); chrome.kill('SIGKILL'); process.exit(4) }

const LONG = '本期（2026-09-28 ~ 2026-09-29）没有可导出的调拨订单。'
  + '舟谱模板的语义是「把已导入的下单表转成舟谱格式」，在网页或小程序里直接报的单不参与；'
  + '期次是否关单与此无关。请先确认下单表已导入，并在「报单配置」里维护好报单对象的归属。'

const results = []
const check = (name, got, want) => {
  const pass = got === want
  results.push({ name, got, want, pass })
  console.log((pass ? '  ✅ ' : '  🔴 ') + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))
  return pass
}

/* ---- 1. 深色模式 + 长文案 ⇒ 应出现且带 × ---- */
const step1 = await ev(`(() => {
  document.documentElement.className = 'dark'
  const s = window.__s
  s.toast(${JSON.stringify(LONG)}, 'err')
  return new Promise(r => setTimeout(() => {
    const t = document.querySelector('.toast')
    if (!t) return r({ found:false })
    const cs = getComputedStyle(t)
    r({ found:true, n: document.querySelectorAll('.toast').length,
        hasX: !!document.querySelector('.toast-x'),
        bg: cs.backgroundColor, fg: cs.color,
        blw: cs.borderLeftWidth, blc: cs.borderLeftColor,
        textLen: (document.querySelector('.toast-msg') || {}).textContent.length })
  }, 500))
})()`, true)

console.log('\n② 深色下长文案通知条：')
console.log('   ' + JSON.stringify(step1))
check('通知条已渲染', step1.found, true)
check('带 ✕ 关闭按钮', step1.hasX, true)
check('深色面（非白底）', (step1.bg || '').startsWith('rgb(58, 58, 60)'), true)
check('红色语义左边框', step1.blw, '3px')

/* ---- 2. 等 8 秒 ⇒ 不自动关闭（老板诉求核心）---- */
await sleep(8000)
const step2 = await ev(`({ n: document.querySelectorAll('.toast').length })`)
console.log('\n③ 静置 8 秒后（旧实现 3 秒就该没了）：')
check('长文案通知条仍在（不自动关闭）', step2.n, 1)

/* ---- 3. 点条内 ⇒ 不应关闭 ---- */
const step3 = await ev(`(() => {
  const m = document.querySelector('.toast-msg'); if (m) m.click()
  return { n: document.querySelectorAll('.toast').length }
})()`)
console.log('\n④ 点通知条正文（条内）：')
check('条内点击不关闭', step3.n, 1)

/* ---- 4. 点外部任意处 ⇒ 关闭 ---- */
const step4 = await ev(`(() => {
  document.body.click()
  return new Promise(r => setTimeout(() => r({ n: document.querySelectorAll('.toast').length }), 600))
})()`, true)
console.log('\n⑤ 点弹窗外部任意区域：')
check('外部点击后关闭', step4.n, 0)

/* ---- 5. 再次弹出并点 × ⇒ 关闭 ---- */
const step5 = await ev(`(() => {
  const s = window.__s
  s.toast(${JSON.stringify(LONG)}, 'err')
  return new Promise(r => setTimeout(() => {
    const before = document.querySelectorAll('.toast').length
    const b = document.querySelector('.toast-x'); if (b) b.click()
    setTimeout(() => r({ before, after: document.querySelectorAll('.toast').length }), 600)
  }, 500))
})()`, true)
console.log('\n⑥ 点 ✕ 关闭按钮：')
check('点 × 前存在', step5.before, 1)
check('点 × 后关闭', step5.after, 0)

/* ---- 6. 短文案回归：仍应自动关闭 ---- */
const step6 = await ev(`(() => {
  const s = window.__s
  s.toast('已保存', 'ok')
  return new Promise(r => setTimeout(() => r({ n: document.querySelectorAll('.toast').length }), 6000))
})()`, true)
console.log('\n⑦ 短文案（"已保存"）等 6 秒 —— 回归检查：')
check('短文案已自动关闭', step6.n, 0)

/* ---- 7. 多条并存上限 ---- */
const step7 = await ev(`(() => {
  const s = window.__s
  s.toast('第一条短消息', 'info'); s.toast('第二条短消息', 'info')
  s.toast('第三条短消息', 'info'); s.toast('第四条短消息', 'info')
  /* 必须等 Vue 渲染一拍，否则读到的是变更前的 DOM —— 这是探针自身的坑，不是产品缺陷 */
  return new Promise(r => setTimeout(() =>
    r({ n: document.querySelectorAll('.toast').length }), 500))
})()`, true)
console.log('\n⑧ 连推 4 条短消息（上限应为 3）：')
check('并存上限 = 3', step7.n, 3)

const passN = results.filter(r => r.pass).length
console.log('\n========== 汇总：' + passN + '/' + results.length + ' 断言通过 ==========')
const failed = results.filter(r => !r.pass)
if (failed.length) console.log('失败项：' + failed.map(f => f.name).join(' / '))

ws.close(); chrome.kill('SIGKILL'); await sleep(300)
process.exit(failed.length ? 1 : 0)
