/**
 * v669 诊断 ③：用**真实鼠标事件**（CDP Input.dispatchMouseEvent）点列设置里的复选框，
 * 对齐用户实际操作路径。JS 的 el.click() 不等于鼠标点（拖拽属性 / label 转发 / 焦点）。
 * 用法：node diag-mouse.mjs [base] [w] [h]
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'https://hergent.cn'
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
const udd = path.join(os.tmpdir(), 'hg-v669m-' + Date.now())
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

  await evalJS(`(async () => {
    const g = [...document.querySelectorAll('.col-cfg.gear')].filter(el => el.offsetParent !== null)[0]
    g.click(); await new Promise(r => setTimeout(r, 500))
  })()`, true)

  // 页面内：装监听 + 采样器
  await evalJS(`
    window.__mk = (idx) => {
      const menu = document.querySelector('.col-menu')
      const boxes = [...menu.querySelectorAll('input[type=checkbox]')].filter(b => !b.disabled && b.checked)
      const box = boxes[idx || 0]
      const li = box.closest('li')
      const r = box.getBoundingClientRect()
      window.__box = box
      window.__log = []
      window.__ev = []
      const push = (tag) => window.__log.push({ t: Math.round(performance.now()), tag, checked: box.checked, hidden: li.classList.contains('hidden') })
      push('start')
      window.__timer = setInterval(() => push('tick'), 40)
      for (const ev of ['pointerdown','mousedown','click','pointerup','mouseup','dragstart']) {
        box.addEventListener(ev, () => window.__ev.push({ ev, t: Math.round(performance.now()) }), true)
      }
      document.addEventListener('click', (e) => window.__ev.push({ ev: 'doc:click', target: e.target.tagName + '.' + [...e.target.classList].join('.'), t: Math.round(performance.now()) }), true)
      return { label: (li.innerText||'').replace(/\\s+/g,' ').trim(), x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), checked: box.checked }
    }`)

  const t1 = await evalJS(`window.__mk(0)`)
  console.log('=== 真实鼠标点复选框 ===', JSON.stringify(t1))
  await realClick(t1.x, t1.y)
  await sleep(60)
  const mid = await evalJS(`({ log: window.__log, ev: window.__ev })`)
  await sleep(700)
  const fin = await evalJS(`(async () => {
    clearInterval(window.__timer)
    const box = window.__box, li = box.closest('li')
    const th = [...document.querySelectorAll('.cross-tbl thead th')].map(t => (t.innerText||'').trim()).filter(Boolean)
    return { final: { checked: box.checked, hidden: li.classList.contains('hidden') },
             log: window.__log, ev: window.__ev,
             menuOpen: !!document.querySelector('.col-menu'),
             hasCol: th.includes(document.querySelector('.col-menu') ? 'x' : 'x') ? null : th.filter(Boolean).length,
             thCount: th.length, th }
  })()`, true)
  console.log('点后 60ms 采样:', JSON.stringify(mid.log.slice(0, 8)))
  console.log('事件序列:', JSON.stringify(mid.ev))
  console.log('700ms 后最终:', JSON.stringify({ final: fin.final, menuOpen: fin.menuOpen, thCount: fin.thCount }))
  console.log('完整采样(前 20):', JSON.stringify(fin.log.slice(0, 20)))
  console.log('是否出现 checked 由 false→true 回弹:', JSON.stringify(fin.log.filter((x, i) => i > 0 && x.checked === true && fin.log[i-1].checked === false).length))
} catch (e) {
  console.error('ERR', e.message)
} finally {
  cleanup()
}
