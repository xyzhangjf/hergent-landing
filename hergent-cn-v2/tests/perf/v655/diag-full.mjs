import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.HG_BASE || 'http://127.0.0.1:8901'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class PipeCDP {
  constructor(w, r) {
    this.w = w; this.seq = 0; this.pending = new Map(); this.buf = ''
    r.setEncoding('utf8')
    r.on('data', (c) => {
      this.buf += c
      let i
      while ((i = this.buf.indexOf('\0')) >= 0) {
        const s = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1)
        if (!s) continue
        let m; try { m = JSON.parse(s) } catch { continue }
        if (m.id && this.pending.has(m.id)) {
          const p = this.pending.get(m.id); this.pending.delete(m.id)
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
        }
      }
    })
  }
  send(method, params = {}, sessionId, timeout = 120000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)) }, timeout)
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v) }, reject: (e) => { clearTimeout(t); reject(e) } })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

const TOKEN = fs.readFileSync(path.join(process.env.HOME, 'WorkBuddy/Worktrees/laozhangai-product/main-75f152be/hergent-cn-v2/tests/perf/.tmp-token-v655'), 'utf8').trim()
const udd = path.join(os.tmpdir(), 'hg-full-' + Date.now())
const chrome = spawn(CHROME, ['--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1440,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })

try {
  const cdp = new PipeCDP(chrome.stdio[3], chrome.stdio[4])
  let created = null
  for (let i = 0; i < 30; i++) { try { created = await cdp.send('Target.createTarget', { url: 'about:blank' }, undefined, 8000); break } catch { await sleep(400) } }
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const S = (m, p = {}, t = 120000) => cdp.send(m, p, sessionId, t)
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable')
  const evalJS = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true })
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result?.value
  }
  for (const [name, value, httpOnly] of [['erp_token', TOKEN, true], ['hergent_auth', '1', false], ['hergent_tenant', '1', false], ['csrf_token', 'fl' + Date.now(), false]])
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await sleep(10000)

  const r = await evalJS(`(() => {
    const el = document.querySelector('#app')
    const nm = (t) => (t && (t.__name || t.name)) || (typeof t === 'function' ? 'fn' : String(t && t.type || t))
    const seen = []
    const visit = (v, depth, pathStr) => {
      if (!v || depth > 40) return
      if (v.component) {
        const inst = v.component
        const ss = inst.setupState
        const ssKeys = ss ? Object.keys(ss) : null
        seen.push({
          path: pathStr, name: nm(inst.type),
          ssN: ssKeys ? ssKeys.length : null,
          ssHead: ssKeys && ssKeys.length ? ssKeys.slice(0, 8) : null,
          hasRender: typeof inst.render === 'function',
          hasSub: !!inst.subTree,
        })
        if (inst.subTree) visit(inst.subTree, depth + 1, pathStr + '/' + nm(inst.type))
      }
      const kids = v.children
      if (Array.isArray(kids)) {
        let k = 0
        for (const c of kids) visit(c, depth + 1, pathStr + '/[' + k++ + ']')
      }
    }
    visit(el._vnode, 0, 'root')
    return {
      total: seen.length,
      withSS: seen.filter(s => s.ssN > 0).length,
      names: seen.map(s => s.name + '(' + s.ssN + ')'),
      forecastEntry: seen.find(s => /Forecast/.test(s.name) && !/Row|Agg|Head|History|QtyOptions/.test(s.name)) || null,
      firstNonEmptySS: seen.find(s => s.ssN > 0) || null,
    }
  })()`)
  console.log(JSON.stringify(r, null, 1))
} catch (e) {
  console.error('FAILED:', e && e.message)
} finally {
  chrome.kill('SIGKILL')
  fs.rmSync(udd, { recursive: true, force: true })
}
