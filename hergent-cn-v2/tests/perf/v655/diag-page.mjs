/** v655 一次性诊断：只读网格行 / __vueParentComponent / 构建号 / 控制台错误 */
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
      this.pending.set(id, { resolve, reject: (e) => { clearTimeout(t); reject(e) } })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

const TOKEN = fs.readFileSync(path.join(process.env.HOME, 'WorkBuddy/Worktrees/laozhangai-product/main-75f152be/hergent-cn-v2/tests/perf/.tmp-token-v655'), 'utf8').trim()
const udd = path.join(os.tmpdir(), 'hg-diag-' + Date.now())
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

  await S('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__errs = []
    window.addEventListener('error', e => window.__errs.push('window.error: ' + (e.message || e)))
    window.addEventListener('unhandledrejection', e => window.__errs.push('unhandled: ' + (e.reason && e.reason.message || e.reason)))
    const _ce = console.error; console.error = (...a) => { window.__errs.push('console.error: ' + a.map(x => x && x.message || String(x)).join(' ')); _ce(...a) }
    const _cw = console.warn; console.warn = (...a) => { window.__errs.push('console.warn: ' + a.map(x => x && x.message || String(x)).join(' ')); _cw(...a) }
  ` })

  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'diag' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: false, sameSite: 'Lax' })
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' })
  for (let i = 0; i < 40; i++) {
    const n = await evalJS(`document.querySelectorAll('.cross-tbl tbody tr').length`)
    if (n > 100) break
    await sleep(500)
  }
  await sleep(2000)
  const st = await evalJS(`(() => {
    const ro = [...document.querySelectorAll('.cross-tbl:not(.edit-tbl) tbody tr')]
    const all = [...document.querySelectorAll('.cross-tbl tbody tr')]
    const tr = ro[0] || all[0]
    return {
      build: window.__HG_BUILD__ || null,
      readonlyRows: ro.length,
      allRows: all.length,
      hasVueParent: tr ? !!tr.__vueParentComponent : null,
      firstRowCells: tr ? tr.querySelectorAll('td').length : null,
      errs: (window.__errs || []).slice(0, 8),
      bodyText: document.body.innerText.slice(0, 200),
    }
  })()`)
  console.log(JSON.stringify(st, null, 2))
} catch (e) {
  console.error('FAILED:', e && e.message)
  process.exitCode = 1
} finally {
  cleanup()
}
