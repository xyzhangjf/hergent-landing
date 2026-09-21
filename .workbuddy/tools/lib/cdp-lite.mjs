/**
 * cdp-lite.mjs —— 极简 CDP 驱动（零第三方依赖）
 *
 * 为什么自己写（2026-09-19 实测）：
 *   本机 Chrome 是 **153.0.8010.50**，而 `puppeteer-core` 在 **23.11.1 与 25.11.0 两个版本**下
 *   都报同一个错：`Requesting main frame too early!` —— launch + newPage 都正常，
 *   一 `page.goto()` 就炸；headless / 有头 / 全新 profile / 重试 / CDP Page.navigate 全试过。
 *   ⇒ 与其继续赌某个驱动版本，不如直接说协议：**只依赖 Node 22 内置的全局 `WebSocket`**
 *     与系统已装的 Chrome，没有版本兼容面。
 *
 * 🔴 另一个实测坑：**不要走 browser 级 WebSocket + `Target.attachToTarget(flatten)`** ——
 *   `createTarget` / `attachToTarget` 都能返回答复，但随后带 `sessionId` 发 `Page.enable`
 *   **永远超时**（45s 无任何响应）。改成**直连页面自己的调试端点**（`/json/list` 里每个
 *   page target 都带 `webSocketDebuggerUrl`）后一切正常：命令不需要 sessionId，响应直接回来。
 *
 * 能力：launch() → browser.newPage() → page.enable() / goto() / eval() / screenshot() → close()
 *   `eval()` 可在页面里执行任意 JS（含 `await fetch(...)`）⇒ 点击 / 填表 / 登录 / 读 DOM 全走它。
 *   console.error 与未捕获异常自动收集进 `page.errors`。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'

/* 🔴 必须用成熟的 `ws` 包，**不能用 Node 内置的全局 WebSocket**：
   实测（Chrome 153）browser 端点还能收到答复，但**页面端点一连上就被 Chrome 主动关闭**
   （`open → send` 之后立刻 `closed`，命令永远收不到响应）。这是内置实现与 devtools
   之间的帧级/扩展协商问题；换 `ws` 并显式关掉 `permessage-deflate` 后一切正常。 */
const require = createRequire(import.meta.url)
const WSImpl = require('/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules/ws')

export const CHROME_DEFAULT = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/** 连一条 CDP WebSocket，返回 { send, onEvent, close } */
async function connect(wsUrl) {
  const ws = new WSImpl(wsUrl, { perMessageDeflate: false })
  await new Promise((res, rej) => {
    ws.once('open', () => res())
    ws.once('error', (e) => rej(new Error('CDP WebSocket 连接失败：' + ((e && e.message) || e))))
  })
  let seq = 0
  const pending = new Map()
  const handlers = []
  ws.on('message', (data) => {
    let msg
    try { msg = JSON.parse(data.toString()) } catch { return }
    if (msg.id && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id)
      pending.delete(msg.id)
      resolve(msg)
    } else if (msg.method) {
      handlers.forEach(h => { try { h(msg) } catch { /* ignore */ } })
    }
  })
  return {
    onEvent: (h) => handlers.push(h),
    send(method, params) {
      const id = ++seq
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve })
        ws.send(JSON.stringify({ id, method, params: params || {} }))
        setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); reject(new Error('CDP 超时：' + method)) }
        }, 45000)
      })
    },
    close() { try { ws.close() } catch { /* ignore */ } },
  }
}

export async function launch({ chromePath = CHROME_DEFAULT, headless = true, port = 0, extraArgs = [] } = {}) {
  const p = port || (9300 + Math.floor(Math.random() * 600))
  const profile = '/tmp/hg-cdp-' + Date.now() + '-' + Math.floor(Math.random() * 1000)
  const args = [
    '--remote-debugging-port=' + p,
    '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-gpu', '--disable-dev-shm-usage', '--window-size=1600,1000',
    '--remote-allow-origins=*',
    /* 🔴🔴 这两个必须有。本机的 Bash 运行在**沙箱**里，Chrome 自身的沙箱与它冲突 ⇒
       **renderer 一被调试就崩**：现象是页面的 WebSocket 被 `CLOSED by server`、紧接着
       Chrome 进程整个消失，而且**全程没有任何报错**（输出被 stdio:ignore 吞掉了）。
       加上之后，同样的命令立刻返回正常结果。定位它的唯一办法是把 Chrome 的 stderr 接出来看。 */
    '--no-sandbox', '--disable-setuid-sandbox',
    ...(headless ? ['--headless=new'] : []),
    ...extraArgs,
    'about:blank',
  ]
  const child = spawn(chromePath, args, { stdio: 'ignore' })

  let ok = false
  for (let i = 0; i < 80; i++) {
    try {
      const j = await (await fetch('http://127.0.0.1:' + p + '/json/version')).json()
      if (j && j.webSocketDebuggerUrl) { ok = true; break }
    } catch { /* 还没起来 */ }
    await sleep(250)
  }
  if (!ok) {
    try { child.kill('SIGKILL') } catch { /* ignore */ }
    throw new Error('Chrome 的 devtools 端点未就绪（端口 ' + p + '）')
  }

  const browser = {
    /* 🔴 用 `PUT /json/new` **新建**一个 target，不要复用 `/json/list` 里那个启动页 ——
       启动参数里的 about:blank 一被调试就 `CLOSED by server`（同为沙箱相关问题）。
       ⚠️ 方法必须是 **PUT**（Chrome 111+ 起 GET /json/new 会被拒绝）。 */
    async newPage() {
      const r = await fetch('http://127.0.0.1:' + p + '/json/new?about:blank', { method: 'PUT' })
      const t = await r.json()
      if (!t || !t.webSocketDebuggerUrl) throw new Error('PUT /json/new 未返回 webSocketDebuggerUrl')
      return makePage(await connect(t.webSocketDebuggerUrl))
    },
    async close() {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      await sleep(200)
    },
  }
  return browser
}

function makePage(c) {
  const page = {
    errors: [],
    async enable() {
      await c.send('Page.enable')
      await c.send('Runtime.enable')
      c.onEvent((msg) => {
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
          const txt = (msg.params.args || [])
            .map(a => (a.value !== undefined ? String(a.value) : (a.description || a.type || '')))
            .join(' ')
          page.errors.push('[console.error] ' + txt)
        } else if (msg.method === 'Runtime.exceptionThrown') {
          const d = msg.params.exceptionDetails || {}
          const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text || ''
          page.errors.push('[exception] ' + String(desc).split('\n')[0])
        }
      })
      return page
    },
    async eval(expression, awaitPromise = true) {
      const r = await c.send('Runtime.evaluate', {
        expression, awaitPromise, returnByValue: true, allowUnsafeEvalBlockedByCSP: true,
      })
      const res = r.result || {}
      if (res.exceptionDetails) {
        const d = res.exceptionDetails
        const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text || 'unknown'
        throw new Error('页面内异常：' + String(desc).split('\n')[0])
      }
      return res.result ? res.result.value : undefined
    },
    /** 导航后固定等待（SPA 上轮询 readyState 不可靠：旧文档也是 complete） */
    async goto(url, settleMs = 4000) {
      await c.send('Page.navigate', { url })
      await sleep(settleMs)
      return page.eval('location.href').catch(() => url)
    },
    async screenshot(path) {
      const r = await c.send('Page.captureScreenshot', { format: 'png' })
      const data = r.result && r.result.data
      if (!data) return ''
      fs.writeFileSync(path, Buffer.from(data, 'base64'))
      return path
    },
    raw: c,
  }
  return page
}
