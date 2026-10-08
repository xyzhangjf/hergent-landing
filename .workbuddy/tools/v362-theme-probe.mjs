/* v362 深色模式渲染探针 —— 零依赖 CDP（Node 22 内置 WebSocket）
   用法： node /tmp/v362-theme-probe.mjs <标签> <URL> [额外CSS相对路径]
   测量：color-scheme、.toast 背景/文字、.toast.err 左边框、.upd-tip 背景 —— 浅色/深色两态 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const LABEL = process.argv[2]
const URL_ = process.argv[3]
const EXTRA = process.argv[4] || ''
const PORT = 9333 + Math.floor(Math.random() * 200)
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-setuid-sandbox',
  '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=/tmp/v362-chrome-' + PORT,
  'about:blank',
], { stdio: 'ignore' })

let ver = null
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    ver = await r.json(); break
  } catch (e) { await sleep(400) }
}
if (!ver) { console.log('无法启动 Chrome'); process.exit(2) }

const ws = new WebSocket(ver.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pending = new Map()
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id)
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
  }
})
function send(method, params, sessionId) {
  const id = ++seq
  return new Promise((res, rej) => {
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params: params || {}, ...(sessionId ? { sessionId } : {}) }))
  })
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)

await send('Page.navigate', { url: URL_ }, sessionId)
await sleep(4000)

if (EXTRA) {
  // 懒加载的 chunk CSS 首页不加载 ⇒ 手动插 link 并等它生效
  await send('Runtime.evaluate', {
    expression: `(()=>{const l=document.createElement('link');l.rel='stylesheet';
      l.href=${JSON.stringify(EXTRA)};document.head.appendChild(l);return 1})()`,
  }, sessionId)
  await sleep(1800)
}

const MEASURE = `(() => {
  const de = document.documentElement
  let cssText = ''
  for (const sh of Array.from(document.styleSheets)) {
    const href = sh.href || ''
    if (href && !href.startsWith(location.origin)) continue
    try { for (const r of Array.from(sh.cssRules)) cssText += r.cssText + '\\n' } catch (e) {}
  }
  const scopeOf = (cls) => { const m = cssText.match(new RegExp('\\\\.' + cls + '\\\\[data-v-([a-z0-9]+)\\\\]')); return m ? m[1] : null }
  const hasRule = (re) => new RegExp(re).test(cssText)
  function snap(theme, cls) {
    de.className = theme
    const el = document.createElement('div')
    el.className = cls
    const s = scopeOf(cls.split(' ')[0])
    if (s) el.setAttribute('data-v-' + s, '')
    el.textContent = '测试文案'
    document.body.appendChild(el)
    const cs = getComputedStyle(el)
    const o = { bg: cs.backgroundColor, fg: cs.color, blw: cs.borderLeftWidth, blc: cs.borderLeftColor, cs: getComputedStyle(de).colorScheme }
    el.remove()
    return o
  }
  const out = {
    url: location.href,
    toastScope: scopeOf('toast'),
    zpScope: scopeOf('zp-card'),
    hasToastErrRule: hasRule('\\\\.toast\\\\.err'),
    hasToastOkRule: hasRule('\\\\.toast\\\\.ok'),
    hasToastWarnRule: hasRule('\\\\.toast\\\\.warn'),
    hasToastBlock: hasRule('\\\\.notif-dock'),
    light: { toast: snap('light', 'toast'), err: snap('light', 'toast err'), tip: snap('light', 'upd-tip') },
    dark:  { toast: snap('dark',  'toast'), err: snap('dark',  'toast err'), tip: snap('dark',  'upd-tip') },
  }
  if (scopeOf('zp-card')) out.dark.zpCard = snap('dark', 'zp-card')
  de.className = 'light'
  return out
})()`

const r = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true, awaitPromise: false }, sessionId)
const v = r.result.value

function hex(rgb) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || '')
  if (!m) return rgb
  return '#' + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, '0')).join('')
}
const lum = (rgb) => {
  const m = /rgba?\((\d+),\s*(\d+),?\s*(\d+)?/.exec(rgb || '')
  if (!m) return null
  return (Number(m[1]) + Number(m[2]) + Number(m[3] || m[2])) / 3
}

console.log('\n========== [' + LABEL + '] ' + v.url + ' ==========')
console.log('toast 的 scoped id =', v.toastScope, '| zp-card scoped id =', v.zpScope)
console.log('.toast.err 规则存在 =', v.hasToastErrRule, '| .toast.ok =', v.hasToastOkRule,
            '| .toast.warn =', v.hasToastWarnRule, '| .notif-dock =', v.hasToastBlock)
for (const th of ['light', 'dark']) {
  const t = v[th]
  console.log('\n-- ' + th + ' --  color-scheme = ' + t.toast.cs)
  console.log('   .toast        bg=' + hex(t.toast.bg).padEnd(9) + ' fg=' + hex(t.toast.fg))
  console.log('   .toast.err    bg=' + hex(t.err.bg).padEnd(9) + ' 左边框=' + t.err.blw + ' ' + hex(t.err.blc))
  console.log('   .upd-tip      bg=' + hex(t.tip.bg).padEnd(9) + ' fg=' + hex(t.tip.fg))
  if (t.zpCard) console.log('   .zp-card      bg=' + hex(t.zpCard.bg))
}
console.log('\n判定：')
const dToast = lum(v.dark.toast.bg), lToast = lum(v.light.toast.bg)
console.log('   深色下 .toast 背景亮度 = ' + (dToast === null ? '?' : dToast.toFixed(1)) +
            '  ⇒ ' + (dToast !== null && dToast < 110 ? '✅ 是深色面（不再白底）' : '🔴 仍是浅色/白底'))
console.log('   浅色下 .toast 背景亮度 = ' + (lToast === null ? '?' : lToast.toFixed(1)) +
            '  ⇒ ' + (lToast !== null && lToast < 110 ? '✅ 仍是深色条（未回归）' : '🔴 变了'))
console.log('   深色下 .upd-tip 背景亮度 = ' + lum(v.dark.tip.bg) +
            '  ⇒ ' + (lum(v.dark.tip.bg) < 110 ? '✅ 深色面' : '🔴 白条'))
console.log('   .toast.err 左边框宽度 = ' + v.dark.err.blw +
            '  ⇒ ' + (parseFloat(v.dark.err.blw) > 0 ? '✅ 语义色生效' : '🔴 无语义色（落到中性）'))
if (v.dark.zpCard) console.log('   深色下 .zp-card 背景亮度 = ' + lum(v.dark.zpCard.bg) +
            '  ⇒ ' + (lum(v.dark.zpCard.bg) < 110 ? '✅ 深色卡' : '🔴 白卡'))
console.log('   color-scheme 跟随 = ' + v.light.toast.cs + ' / ' + v.dark.toast.cs +
            '  ⇒ ' + (v.light.toast.cs === 'light' && v.dark.toast.cs === 'dark' ? '✅' : '🔴'))

ws.close(); chrome.kill('SIGKILL')
await sleep(300)
process.exit(0)
