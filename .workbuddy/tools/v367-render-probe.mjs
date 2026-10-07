/* v367 渲染验证探针 —— 零依赖 CDP（Node 22 内置 WebSocket）
   用法：node /tmp/v367-render-probe.mjs <URL> <CSS_URL>
   验证：
     ① `.btn-retry` 保存失败态是否为危险实心底（此前全仓无定义 = 与正常态逐像素相同）
     ② `.spark-th` 趋势列表头是否居中（此前无定义，靠浏览器默认）
     ③ z-index 令牌化后计算值是否与迁移前逐值相同（1101/1091/1200/1130/1150/1090）

   🔴 判别力自证：同一元素**不带 `data-v-*`** 时拿不到 scoped 样式 ⇒
      `.btn-retry` 应回落成「透明」（= 改前的实际表现）。这一步证明探针真能区分「样式生效/不生效」。
   🔴 scoped id **运行时自取**（从 CSS 文本正则抓），绝不硬编码。            */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const URL_ = process.argv[2]
const CSSURL = process.argv[3]
const PORT = 9400 + Math.floor(Math.random() * 200)
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-setuid-sandbox',
  '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=/tmp/v367-chrome-' + PORT,
  'about:blank',
], { stdio: 'ignore' })

let ver = null
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); ver = await r.json(); break }
  catch (e) { await sleep(400) }
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
await sleep(3500)

async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400))
  return r.result.value
}

console.log('目标:', URL_, '| CSS:', CSSURL)

// 1) 取页面 CSS 文本并注入（同源 fetch）
const setup = await ev(`(async () => {
  const css = await (await fetch(${JSON.stringify(CSSURL)})).text()
  const st = document.createElement('style'); st.textContent = css
  document.head.appendChild(st)
  const scope = (cls) => { const m = css.match(new RegExp('\\\\.' + cls + '\\\\[data-v-([a-z0-9]+)\\\\]')); return m ? m[1] : null }
  window.__p = { css, scope }
  return { len: css.length, spark: scope('spark-th'), retry: scope('btn-retry'), colmenu: scope('col-menu') }
})()`)
console.log('注入:', JSON.stringify(setup))

// 2) 测量
const R = await ev(`(() => {
  const { scope } = window.__p
  const out = {}
  function mk(tag, cls, scopeCls) {
    const el = document.createElement(tag); el.className = cls
    if (scopeCls) { const s = scope(scopeCls); if (s) el.setAttribute('data-v-' + s, '') }
    document.body.appendChild(el); return el
  }
  // ① .btn-retry（带 / 不带 scoped = 判别力对照）
  const b1 = mk('button', 'btn btn-sm btn-primary btn-retry', 'btn-retry')
  out.retry_bg_on = getComputedStyle(b1).backgroundColor
  const b2 = mk('button', 'btn btn-sm btn-primary btn-retry', null)
  out.retry_bg_off = getComputedStyle(b2).backgroundColor
  // ② .spark-th
  const t1 = mk('th', 'spark-th', 'spark-th')
  out.spark_align_on = getComputedStyle(t1).textAlign
  out.spark_rule_in_css = /\.spark-th\[data-v-[a-z0-9]+\]/.test(window.__p.css)
  // ③ z-index 计算值
  const z = (cls) => { const e = mk('div', cls, cls); const v = getComputedStyle(e).zIndex; e.remove(); return v }
  out.z_col_menu   = z('col-menu')
  out.z_ctx_overlay= z('ctx-overlay')
  out.z_ctx_menu   = z('ctx-menu')
  out.z_imp_overlay= z('imp-overlay')
  out.z_imp_modal  = z('imp-modal')
  out.z_name_sug   = z('name-sug-pop')
  out.z_fix_mask   = z('fix-mask')
  { const e = mk('div', 'grid-area is-fs', 'is-fs'); out.z_grid_fs = getComputedStyle(e).zIndex; e.remove() }
  // ④ 令牌可用性
  const root = getComputedStyle(document.documentElement)
  out.tok_danger_solid = root.getPropertyValue('--danger-solid').trim()
  out.tok_z_page_menu  = root.getPropertyValue('--z-page-menu').trim()
  return out
})()`)

const want = {
  retry_bg_on: 'rgb(220, 38, 38)',
  retry_bg_off: null,          // 只要求 ≠ 红（判别力自证）
  spark_align_on: 'center',
  z_col_menu: '1101', z_ctx_overlay: '1090', z_ctx_menu: '1091',
  z_imp_overlay: '1125', z_imp_modal: '1130', z_name_sug: '1150',
  z_fix_mask: '1200', z_grid_fs: '1000',
  tok_danger_solid: '#dc2626', tok_z_page_menu: '1101',
}
let pass = 0, fail = 0
console.log('\n── 断言 ──')
for (const [k, v] of Object.entries(want)) {
  const got = R[k]
  let ok
  if (k === 'retry_bg_off') ok = (got !== 'rgb(220, 38, 38)')   // 判别力：不带 scoped ⇒ 拿不到红底
  else ok = (String(got) === String(v))
  ok ? pass++ : fail++
  console.log(`  ${ok ? '✅' : '❌'} ${k.padEnd(20)} got=${String(got).padEnd(22)} want=${v === null ? '≠红底' : v}`)
}
console.log(`  ℹ️  spark 规则存在于 CSS: ${R.spark_rule_in_css}`)
console.log(`\n结果: ${pass} pass / ${fail} fail`)

try { await send('Browser.close', {}) } catch (e) {}
process.exit(fail ? 1 : 0)
