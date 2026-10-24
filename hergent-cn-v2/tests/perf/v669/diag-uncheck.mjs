/**
 * v669 诊断 ②：只量「取消勾选（显示→隐藏）」方向，以及「点 input 本身 vs 点 label 文字」的差别。
 * 用法：node diag-uncheck.mjs [base] [w] [h]
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
const udd = path.join(os.tmpdir(), 'hg-v669u-' + Date.now())
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

  // 打开列设置
  await evalJS(`(async () => {
    const g = [...document.querySelectorAll('.col-cfg.gear')].filter(el => el.offsetParent !== null)[0]
    g.click(); await new Promise(r => setTimeout(r, 500))
  })()`, true)

  const trace = await evalJS(`(async () => {
    const menu = document.querySelector('.col-menu')
    if (!menu) return { error: '面板没开' }
    const boxes = [...menu.querySelectorAll('input[type=checkbox]')].filter(b => !b.disabled && b.checked)
    if (!boxes.length) return { error: '没有已勾选的列' }
    const box = boxes[0]
    const li = box.closest('li')
    const labelTxt = (li.innerText || '').replace(/\\s+/g, ' ').trim()
    // 记录该 input 上真正收到几次 click（捕获阶段，先于 handler）
    let clicks = 0
    const rec = () => { clicks++ }
    box.addEventListener('click', rec, true)
    const headCols = () => [...document.querySelectorAll('.cross-tbl thead th')].map(t => (t.innerText || '').replace(/\\s+/g, '').trim()).filter(Boolean)

    const before = { checked: box.checked, liHidden: li.classList.contains('hidden'), th: headCols() }
    box.click()                                   // 点 input 本身
    const s0 = { checked: box.checked, clickCount: clicks }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const s1 = { checked: box.checked, liHidden: li.classList.contains('hidden'), clickCount: clicks, th: headCols() }
    await new Promise(r => setTimeout(r, 400))
    const s2 = { checked: box.checked, liHidden: li.classList.contains('hidden'), clickCount: clicks, th: headCols(), sameNode: document.contains(box) }
    box.removeEventListener('click', rec, true)
    return { labelTxt, before, s0, s1, s2,
             liOuter: li.outerHTML.slice(0, 260),
             thGone: before.th.filter(x => !s2.th.includes(x)) }
  })()`, true)
  console.log('=== A. 点 input 本体的取消勾选 ===')
  console.log(JSON.stringify(trace, null, 1))

  // B. 点 label 文字（用户更常见的操作路径）
  const traceB = await evalJS(`(async () => {
    const menu = document.querySelector('.col-menu')
    const boxes = [...menu.querySelectorAll('input[type=checkbox]')].filter(b => !b.disabled && b.checked)
    if (!boxes.length) return { error: '没有已勾选的列（上一次已经全部取消？）' }
    const box = boxes[0]
    const li = box.closest('li')
    const lab = li.querySelector('label')
    const before = { checked: box.checked, liHidden: li.classList.contains('hidden') }
    lab.click()                                   // 点 label 文字
    const s0 = { checked: box.checked }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const s1 = { checked: box.checked, liHidden: li.classList.contains('hidden') }
    await new Promise(r => setTimeout(r, 400))
    return { labelTxt: (li.innerText || '').replace(/\\s+/g,' ').trim(), before, s0, s1,
             final: { checked: box.checked, liHidden: li.classList.contains('hidden') } }
  })()`, true)
  console.log('\\n=== B. 点 label 文字的取消勾选 ===')
  console.log(JSON.stringify(traceB, null, 1))

  // C. 把面板关掉重开，勾选态是否与「功能实际生效」一致
  const after = await evalJS(`(async () => {
    const menu = document.querySelector('.col-menu')
    const state1 = [...menu.querySelectorAll('li')].map(li => {
      const b = li.querySelector('input[type=checkbox]')
      return { label: (li.innerText||'').replace(/\\s+/g,' ').trim(), checked: b.checked, hidden: li.classList.contains('hidden') }
    })
    menu.querySelector('.col-menu-x').click()
    await new Promise(r => setTimeout(r, 300))
    const g = [...document.querySelectorAll('.col-cfg.gear')].filter(el => el.offsetParent !== null)[0]
    g.click(); await new Promise(r => setTimeout(r, 500))
    const menu2 = document.querySelector('.col-menu')
    const state2 = [...menu2.querySelectorAll('li')].map(li => {
      const b = li.querySelector('input[type=checkbox]')
      return { label: (li.innerText||'').replace(/\\s+/g,' ').trim(), checked: b.checked, hidden: li.classList.contains('hidden') }
    })
    return { state1, state2,
             diff: state1.filter((x, i) => state2[i] && (x.checked !== state2[i].checked)).map(x => x.label) }
  })()`, true)
  console.log('\\n=== C. 关面板→重开，勾选态是否翻转 ===')
  console.log('关之前:', JSON.stringify(after.state1?.slice(0, 8)))
  console.log('重开后:', JSON.stringify(after.state2?.slice(0, 8)))
  console.log('翻转项:', JSON.stringify(after.diff))
} catch (e) {
  console.error('ERR', e.message)
} finally {
  cleanup()
}
