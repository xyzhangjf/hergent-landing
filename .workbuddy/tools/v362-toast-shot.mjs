/* v362 深色模式 · 通知条前后对照截图（零依赖 CDP）
   用法： node /tmp/v362-shot.mjs <标签> <URL> <输出PNG> */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { writeFileSync } from 'node:fs'

const LABEL = process.argv[2], URL_ = process.argv[3], OUT = process.argv[4]
const PORT = 9555 + Math.floor(Math.random() * 200)
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disable-gpu', '--hide-scrollbars', '--window-size=880,420',
  '--remote-debugging-port=' + PORT, '--user-data-dir=/tmp/v362-shot-' + PORT, 'about:blank',
], { stdio: 'ignore' })

let ver = null
for (let i = 0; i < 80; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break } catch (e) { await sleep(400) } }
const ws = new WebSocket(ver.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r, { once: true }))
let seq = 0; const pending = new Map()
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result) } })
const send = (method, params, sessionId) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params: params || {}, ...(sessionId ? { sessionId } : {}) })) })

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
await send('Emulation.setDeviceMetricsOverride', { width: 880, height: 420, deviceScaleFactor: 2, mobile: false }, sessionId)
await send('Page.navigate', { url: URL_ }, sessionId)
await sleep(4000)

/* 在页面上如实重建「导出为调拨订单导入模版 → 本期无调拨数据」那条提示：
   文案逐字取自后端 _zhoupu_empty_reason 的形态（长说明型 ⇒ 新实现会附关闭按钮）。 */
const MSG = '本期（2026-09-28 ~ 2026-09-29）没有可导出的调拨订单。'
  + '舟谱模板的语义是「把已导入的下单表转成舟谱格式」，在网页或小程序里直接报的单不参与；'
  + '期次是否关单与此无关。请先确认下单表已导入，并在「报单配置」里维护好报单对象的归属。'

const EVAL = `(() => {
  const de = document.documentElement; de.className = 'dark'
  let cssText = ''
  for (const sh of Array.from(document.styleSheets)) {
    try { for (const r of Array.from(sh.cssRules)) cssText += r.cssText + '\\n' } catch (e) {}
  }
  let scope = null
  const i0 = cssText.indexOf('.toast[data-v-')
  if (i0 >= 0) { const j0 = i0 + '.toast[data-v-'.length; scope = cssText.slice(j0, cssText.indexOf(']', j0)) }
  const hasDock = cssText.indexOf('.notif-dock') >= 0
  const hasX = cssText.indexOf('.toast-x') >= 0
  const dock = document.createElement('div')
  dock.className = 'notif-dock'
  if (hasDock) dock.setAttribute('data-v-' + scope, '')
  const t = document.createElement('div')
  t.className = 'toast err'
  if (scope) t.setAttribute('data-v-' + scope, '')
  const s = document.createElement('span'); s.className = 'toast-msg'
  if (scope) s.setAttribute('data-v-' + scope, '')
  s.textContent = ${JSON.stringify(MSG)}
  t.appendChild(s)
  if (hasX) {
    const b = document.createElement('button'); b.className = 'toast-x'
    if (scope) b.setAttribute('data-v-' + scope, '')
    b.textContent = '✕'; t.appendChild(b)
  }
  if (hasDock) { dock.appendChild(t); document.body.appendChild(dock) }
  else { document.body.appendChild(t) }
  return { bg: getComputedStyle(t).backgroundColor, fg: getComputedStyle(t).color,
           blw: getComputedStyle(t).borderLeftWidth, blc: getComputedStyle(t).borderLeftColor, hasX: hasX }
})()`

const r = await send('Runtime.evaluate', { expression: EVAL, returnByValue: true }, sessionId)
if (r.exceptionDetails || !r.result || !r.result.value) {
  console.log('注入失败，原始回执：', JSON.stringify(r).slice(0, 1200))
  ws.close(); chrome.kill('SIGKILL'); process.exit(3)
}
console.log('[' + LABEL + '] 通知条计算样式：', JSON.stringify(r.result.value))
await sleep(700)
const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
console.log('已保存 ' + OUT)
ws.close(); chrome.kill('SIGKILL'); await sleep(300)
process.exit(0)
