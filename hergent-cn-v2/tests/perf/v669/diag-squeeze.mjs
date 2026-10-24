/**
 * v669 诊断 ⑥：列设置面板内容是否被 flex 压扁 / 子块相互交叠（"完整可见"的几何判据）。
 * 用法：node diag-squeeze.mjs [base] [w] [h]
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://127.0.0.1:8910'
const VW = Number(process.argv[3] || 1440)
const VH = Number(process.argv[4] || 780)
const OUT_DIR = path.dirname(new URL(import.meta.url).pathname)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class PipeCDP {
  constructor (w, r) {
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
  send (method, params = {}, sessionId, timeout = 180000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)) }, timeout)
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v) }, reject: (e) => { clearTimeout(t); reject(e) } })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

const TOKEN = fs.readFileSync(path.join(OUT_DIR, '.tmp-token-v669'), 'utf8').trim()
const udd = path.join(os.tmpdir(), 'hg-v669q-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  `--window-size=${VW},${VH + 120}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

try {
  const cdp = new PipeCDP(chrome.stdio[3], chrome.stdio[4])
  let created = null
  for (let i = 0; i < 30; i++) {
    try { created = await cdp.send('Target.createTarget', { url: 'about:blank' }, undefined, 8000); break } catch { await sleep(400) }
  }
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const S = (m, p = {}, t = 180000) => cdp.send(m, p, sessionId, t)
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable')
  await S('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false })
  const evalJS = async (expr, awaitPromise = false) => {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise, userGesture: true })
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result?.value
  }
  const waitFor = async (expr, timeout = 120000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (await evalJS(`(()=>{try{return !!(${expr})}catch(e){return false}})()`) === true) return true
      await sleep(120)
    }
    throw new Error('waitFor 超时: ' + expr)
  }
  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'fl' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
  }
  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`!!document.querySelector('.cross-tbl')`)
  await waitFor(`window.__hgProductsGridReady > 0`, 90000)
  await sleep(1500)

  const MEASURE = `(() => {
    const m = document.querySelector('.col-menu')
    if (!m) return { error: '面板没开' }
    const mr = m.getBoundingClientRect()
    const kids = [...m.children].map(el => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return { cls: [...el.classList].join('.') || el.tagName.toLowerCase(),
               top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
               flex: cs.flexShrink + '/' + cs.flexBasis, overflow: cs.overflow,
               scrollH: el.scrollHeight, clientH: el.clientHeight,
               squeezed: el.scrollHeight > el.clientHeight + 1 }
    })
    let overlap = []
    for (let i = 0; i < kids.length - 1; i++) if (kids[i].bottom > kids[i + 1].top + 1) overlap.push(kids[i].cls + ' ↔ ' + kids[i + 1].cls)
    return { rect: { top: Math.round(mr.top), bottom: Math.round(mr.bottom), h: Math.round(mr.height) },
             scrollH: m.scrollHeight, clientH: m.clientHeight, kids, overlap }
  })()`

  const open = `(async () => {
    const g = [...document.querySelectorAll('.col-cfg.gear')].filter(el => el.offsetParent !== null)[0]
    g.click(); await new Promise(r => setTimeout(r, 600))
    const p = document.querySelector('.kbd-pop'); if (p) document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
  })()`

  console.log('=== 非全屏 ===')
  await evalJS(open, true)
  const a = await evalJS(MEASURE)
  console.log(JSON.stringify({ rect: a.rect, scrollH: a.scrollH, clientH: a.clientH, overlap: a.overlap }, null, 1))
  for (const k of a.kids) console.log('  ', JSON.stringify(k))

  console.log('\n=== 全屏 ===')
  await evalJS(`(async () => {
    document.querySelector('.col-menu-x')?.click(); await new Promise(r => setTimeout(r, 300))
    document.querySelector('.grid-fs-btn').click(); await new Promise(r => setTimeout(r, 900))
    const g = [...document.querySelectorAll('.col-cfg.gear')].filter(el => el.offsetParent !== null)[0]
    g.click(); await new Promise(r => setTimeout(r, 600))
    const p = document.querySelector('.kbd-pop'); if (p) document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
  })()`, true)
  const b = await evalJS(MEASURE)
  console.log(JSON.stringify({ rect: b.rect, scrollH: b.scrollH, clientH: b.clientH, overlap: b.overlap }, null, 1))
  for (const k of b.kids) console.log('  ', JSON.stringify(k))
} catch (e) {
  console.error('ERR', e.message)
} finally {
  cleanup()
}
