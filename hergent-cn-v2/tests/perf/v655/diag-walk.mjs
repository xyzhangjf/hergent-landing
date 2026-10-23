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
const udd = path.join(os.tmpdir(), 'hg-walk-' + Date.now())
const chrome = spawn(CHROME, ['--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1440,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })

const nm = (t) => (t && (t.name || t.__name)) || (typeof t === 'function' ? 'fn' : String(t && t.type || t))

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
  for (const [name, value, httpOnly] of [['erp_token', TOKEN, true], ['hergent_auth', '1', false], ['hergent_tenant', '1', false], ['csrf_token', 'wk' + Date.now(), false]])
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await sleep(9000)

  const r = await evalJS(`(() => {
    const el = document.querySelector('#app')
    const app = el && el.__vue_app__
    const root = el && el._vnode && el._vnode.component
    const lines = []
    const dumpInst = (inst, depth, tag) => {
      if (!inst || depth > 6) return
      const ss = inst.setupState
      lines.push('  '.repeat(depth) + tag + ' type=' + (nm(inst.type)) +
        ' ssKeys=' + (ss ? Object.keys(ss).length : 'null') +
        ' subTree=' + (inst.subTree ? nm(inst.subTree.type) : 'null') +
        ' kids=' + (inst.subTree && Array.isArray(inst.subTree.children) ? inst.subTree.children.filter(c => c && c.component).length : '-'))
    }
    const nm = (t) => (t && (t.name || t.__name)) || (typeof t === 'function' ? 'fn' : String(t && t.type || t))
    dumpInst(root, 0, 'root')
    let cur = root
    for (let d = 0; d < 6 && cur; d++) {
      const sub = cur.subTree
      if (!sub) break
      const next = sub.component || (Array.isArray(sub.children) && sub.children.find(c => c && c.component) && sub.children.find(c => c && c.component).component)
      if (!next) break
      cur = next
      dumpInst(cur, d + 1, '↓')
    }
    // 宽搜：找 setupState 里带 loadEditGrid 的实例（vnode 级 DFS：element 的 children 也要穿透）
    const found = []
    const dfs = (v, depth) => {
      if (!v || depth > 60) return null
      if (v.component) {
        const ss = v.component.setupState
        if (ss && typeof ss.loadEditGrid === 'function') { found.push({ type: nm(v.component.type), ssKeys: Object.keys(ss).length, hasSaveEdits: typeof ss.saveEdits === 'function' }); return v.component }
        if (v.component.subTree) { const r = dfs(v.component.subTree, depth + 1); if (r) return r }
      }
      const kids = v.children
      if (Array.isArray(kids)) for (const c of kids) { const r = dfs(c, depth + 1); if (r) return r }
      return null
    }
    dfs(el._vnode, 0)
    // setupState 内容抽样（第一个 ssKeys>3 的实例）
    const ssSample = []
    const dfs2 = (v, depth) => {
      if (!v || depth > 60) return
      if (v.component) {
        const ss = v.component.setupState
        if (ss && Object.keys(ss).length > 3) { ssSample.push({ type: nm(v.component.type), keys: Object.keys(ss).slice(0, 12) }); return }
        if (v.component.subTree) { dfs2(v.component.subTree, depth + 1); return }
      }
      const kids = v.children
      if (Array.isArray(kids)) for (const c of kids) dfs2(c, depth + 1)
    }
    dfs2(el._vnode, 0)
    return { lines, found, ssSample, hasApp: !!app, rootHasRender: typeof (root && root.render) }
  })()`)
  console.log(JSON.stringify(r, null, 1))
} catch (e) {
  console.error('FAILED:', e && e.message)
} finally {
  chrome.kill('SIGKILL')
  fs.rmSync(udd, { recursive: true, force: true })
}
