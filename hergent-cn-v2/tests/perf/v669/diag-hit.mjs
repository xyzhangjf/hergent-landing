/**
 * v669 诊断 ⑤：真实鼠标点复选框时，坐标上到底是哪个元素？事件有没有到 input？
 * 用法：node diag-hit.mjs [base] [w] [h]
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
const udd = path.join(os.tmpdir(), 'hg-v669h-' + Date.now())
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
  const realClick = async (x, y) => {
    await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 })
    await S('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
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
  console.log('[build]', await evalJS(`window.__HG_BUILD__`))

  await evalJS(`(async () => {
    const g = [...document.querySelectorAll('.col-cfg.gear')].filter(el => el.offsetParent !== null)[0]
    g.click(); await new Promise(r => setTimeout(r, 500))
  })()`, true)

  const rows = await evalJS(`(() => {
    const m = document.querySelector('.col-menu')
    return [...m.querySelectorAll('li')].map((li, i) => {
      const b = li.querySelector('input')
      const r = b.getBoundingClientRect()
      const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
      return { i, label: (li.innerText || '').replace(/\\s+/g,' ').trim(), disabled: b.disabled, checked: b.checked,
               x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
               w: Math.round(r.width), h: Math.round(r.height),
               hit: el ? el.tagName.toLowerCase() + '.' + [...el.classList].join('.') : 'null',
               hitIsBox: el === b }
    })
  })()`)
  console.log('面板条目（坐标命中谁）:')
  for (const r of rows) console.log('  ', JSON.stringify(r))

  // 对第一个「可勾选且已勾选」的条目做真实点击，并记录事件
  const t = rows.find(r => !r.disabled && r.checked)
  console.log('\n点击目标:', JSON.stringify(t))
  await evalJS(`(() => {
    const m = document.querySelector('.col-menu')
    const li = [...m.querySelectorAll('li')][${t.i}]
    window.__box = li.querySelector('input')
    window.__ev = []
    for (const ev of ['pointerdown','mousedown','click','change','mouseup']) {
      window.__box.addEventListener(ev, (e) => window.__ev.push({ ev, checked: window.__box.checked, prevented: e.defaultPrevented }), true)
    }
  })()`)
  await realClick(t.x, t.y)
  await sleep(700)
  const res = await evalJS(`(() => {
    const b = window.__box, li = b.closest('li')
    return { ev: window.__ev, checked: b.checked, hidden: li.classList.contains('hidden'),
             thCount: document.querySelectorAll('.cross-tbl thead th').length,
             menuOpen: !!document.querySelector('.col-menu'),
             toast: (document.querySelector('.toast, .toast-wrap, [class*=toast]') || {}).innerText || null }
  })()`)
  console.log('事件序列:', JSON.stringify(res.ev))
  console.log('结果:', JSON.stringify({ checked: res.checked, hidden: res.hidden, thCount: res.thCount, menuOpen: res.menuOpen, toast: res.toast }))
} catch (e) {
  console.error('ERR', e.message)
} finally {
  cleanup()
}
