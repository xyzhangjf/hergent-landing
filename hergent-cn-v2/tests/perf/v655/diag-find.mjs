/** 一次性：调试 FIND_PAGE 遍历（本地） */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.HG_BASE || 'http://127.0.0.1:8899'
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
const udd = path.join(os.tmpdir(), 'hg-find-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1440,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

try {
  const cdp = new PipeCDP(chrome.stdio[3], chrome.stdio[4])
  let created = null
  for (let i = 0; i < 30; i++) {
    try { created = await cdp.send('Target.createTarget', { url: 'about:blank' }, undefined, 8000); break } catch { await sleep(400) }
  }
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const S = (m, p = {}, t = 120000) => cdp.send(m, p, sessionId, t)
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable')
  const evalJS = async (expr, awaitPromise = false) => {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise, userGesture: true })
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result?.value
  }

  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'find' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await sleep(9000)
  const st = await evalJS(`(() => {
    const app = document.querySelector('#app')
    const out = { hasAppEl: !!app, hasVueApp: !!(app && app.__vue_app__), rootType: null, chain: [], caps: [] }
    const root = app && app.__vue_app__ && app.__vue_app__._instance
    out.hasRoot = !!root
    if (root) {
      out.rootType = (root.type && (root.type.name || root.type.__name)) || 'anon'
      const byCap = (inst) => {
        const ss = inst && inst.setupState
        return ss && typeof ss.loadEditGrid === 'function' && typeof ss.saveEdits === 'function' && typeof ss.enterEdit === 'function'
      }
      const walk = (inst, depth) => {
        if (!inst || depth > 80) return null
        const nm = (inst.type && (inst.type.name || inst.type.__name)) || 'anon'
        out.chain.push(depth + ':' + nm + (byCap(inst) ? ' ★CAP' : ''))
        if (byCap(inst)) return inst
        const sub = inst.subTree
        if (sub) {
          if (sub.component) { const r = walk(sub.component, depth + 1); if (r) return r }
          const kids = sub.children || []
          if (Array.isArray(kids)) { for (const c of kids) { if (c && c.component) { const r = walk(c.component, depth + 1); if (r) return r } } }
        }
        return null
      }
      const p = walk(root, 0)
      out.found = !!p
      if (p) out.foundType = (p.type && (p.type.name || p.type.__name)) || 'anon'
    }
    return out
  })()`)
  console.log(JSON.stringify(st, null, 1).slice(0, 3000))
} catch (e) {
  console.error('FAILED:', e && e.message)
  process.exitCode = 1
} finally {
  cleanup()
}
