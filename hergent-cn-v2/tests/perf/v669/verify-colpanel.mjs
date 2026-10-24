/**
 * v669 验收（B）：共享组件 ColMenuPanel（16 个表格页共用）的列设置 —— 真实鼠标勾选必须同步。
 * 只验一处代表页（进销存采购单列表），因为缺陷在**共享组件**里，改的是它。
 * 用法：node verify-colpanel.mjs [base] [w] [h]
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://127.0.0.1:8910'
const VW = Number(process.argv[3] || 1440)
const VH = Number(process.argv[4] || 780)
const PAGE = process.argv[5] || '#/inventory/purchase-list'
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
const udd = path.join(os.tmpdir(), 'hg-v669p-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  `--window-size=${VW},${VH + 120}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅', msg) } else { fail++; console.log('  ❌', msg) } }

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
  const waitFor = async (expr, timeout = 60000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (await evalJS(`(()=>{try{return !!(${expr})}catch(e){return false}})()`) === true) return true
      await sleep(150)
    }
    return false
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
  await S('Page.navigate', { url: BASE + '/' + PAGE })
  const hasGear = await waitFor(`!!document.querySelector('.col-cfg.gear')`, 45000)
  console.log('[page]', PAGE, '齿轮存在:', hasGear, 'build:', await evalJS(`window.__HG_BUILD__`))
  if (!hasGear) { console.log('  ⚠️ 该页没有列设置齿轮，跳过（换一个用 ColMenuPanel 的页再跑）'); process.exit(0) }
  await sleep(1500)

  const opened = await evalJS(`(async () => {
    const g = [...document.querySelectorAll('.col-cfg.gear')].filter(el => el.offsetParent !== null)[0]
    g.click(); await new Promise(r => setTimeout(r, 600))
    const m = document.querySelector('.col-menu')
    if (!m) return { error: '面板没开' }
    const mr = m.getBoundingClientRect()
    return { rect: { top: Math.round(mr.top), left: Math.round(mr.left), h: Math.round(mr.height) },
             z: getComputedStyle(m).zIndex, items: m.querySelectorAll('li').length }
  })()`, true)
  console.log('  面板:', JSON.stringify(opened))
  ok(!!opened && !opened.error, '列表页列设置面板能打开')
  ok(opened.z === '1101', `面板 z = ${opened.z}（共享样式同样生效）`)

  const pick = await evalJS(`(() => {
    const m = document.querySelector('.col-menu')
    const boxes = [...m.querySelectorAll('input[type=checkbox]')].filter(b => !b.disabled)
    for (const box of boxes) {
      const r = box.getBoundingClientRect()
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2)
      if (document.elementFromPoint(cx, cy) !== box) continue
      window.__box = box
      const li = box.closest('li')
      return { label: (li.innerText || '').replace(/\\s+/g, ' ').trim(), x: cx, y: cy, checked: box.checked }
    }
    return { error: '没有可点条目' }
  })()`)
  console.log('  目标:', JSON.stringify(pick))
  if (pick.error) { ok(false, pick.error) } else {
    await realClick(pick.x, pick.y)
    await sleep(600)
    const s1 = await evalJS(`({ checked: window.__box.checked })`)
    ok(s1.checked === !pick.checked, `真实鼠标点后 checked = ${s1.checked}（期望 ${!pick.checked}）`)
    await realClick(pick.x, pick.y)
    await sleep(600)
    const s2 = await evalJS(`({ checked: window.__box.checked })`)
    ok(s2.checked === pick.checked, `再点回原值 checked = ${s2.checked}（期望 ${pick.checked}）`)
  }

  console.log(`\n================ RESULT: ${fail === 0 ? 'ALL PASS' : 'FAILED(' + fail + ')'}  pass=${pass} fail=${fail} ================`)
} catch (e) {
  console.error('ERR', e.message)
  fail++
} finally {
  cleanup()
  process.exit(fail === 0 ? 0 : 1)
}
