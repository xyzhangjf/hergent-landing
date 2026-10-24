/**
 * v669 诊断 ④：真实鼠标点击后，按「捕获 → 目标 handler → 微任务 → rAF → 宏任务」逐点采样
 * checked / defaultPrevented / 元素身份，看是谁在什么时机把状态改回去（或根本没改）。
 * 用法：node diag-timing.mjs [base] [w] [h]
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
const udd = path.join(os.tmpdir(), 'hg-v669t-' + Date.now())
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

  const info = await evalJS(`
    (() => {
      const menu = document.querySelector('.col-menu')
      const box = [...menu.querySelectorAll('input[type=checkbox]')].filter(b => !b.disabled && b.checked)[0]
      const li = box.closest('li')
      const r = box.getBoundingClientRect()
      window.__T = []
      const snap = (tag, extra) => {
        const b = window.__box
        window.__T.push({ tag, t: Math.round(performance.now() * 10) / 10,
          checked: b.checked, hidden: b.closest('li').classList.contains('hidden'),
          sameEl: b === window.__origEl, ...(extra || {}) })
      }
      window.__box = box
      window.__origEl = box
      // 捕获阶段（document，先于目标处理）
      document.addEventListener('click', (e) => {
        if (e.target !== window.__box) return
        snap('1-capture', { prevented: e.defaultPrevented })
        queueMicrotask(() => snap('3-microtask-after-capture'))
      }, true)
      // 冒泡阶段（document，后于目标 handler）
      document.addEventListener('click', (e) => {
        if (e.target !== window.__box) return
        snap('2-bubble-doc', { prevented: e.defaultPrevented })
        queueMicrotask(() => snap('4-microtask-after-handler', { prevented: e.defaultPrevented }))
        requestAnimationFrame(() => snap('5-raf'))
        setTimeout(() => snap('6-timeout0'), 0)
      })
      // 目标自身监听（注册在 Vue 之后 ⇒ 跑在 Vue handler 之后）
      box.addEventListener('click', (e) => {
        snap('2b-target-after-vue', { prevented: e.defaultPrevented })
      })
      return { label: (li.innerText||'').replace(/\\s+/g,' ').trim(), x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), checked: box.checked }
    })()`)
  console.log('=== 目标 ===', JSON.stringify(info))
  await realClick(info.x, info.y)
  await sleep(900)
  const T = await evalJS(`(() => {
    const b = window.__box
    return { trace: window.__T,
             finalChecked: b.checked,
             finalHidden: b.closest('li').classList.contains('hidden'),
             sameElementStillInDom: document.contains(b),
             attrChecked: b.getAttribute('checked'),
             propChecked: b.checked,
             outer: b.outerHTML,
             thCount: document.querySelectorAll('.cross-tbl thead th').length }
  })()`)
  for (const row of T.trace) console.log('  ', JSON.stringify(row))
  console.log('最终:', JSON.stringify({ finalChecked: T.finalChecked, finalHidden: T.finalHidden, inDom: T.sameElementStillInDom, attr: T.attrChecked, prop: T.propChecked, thCount: T.thCount }))
  console.log('outer:', T.outer)
} catch (e) {
  console.error('ERR', e.message)
} finally {
  cleanup()
}
