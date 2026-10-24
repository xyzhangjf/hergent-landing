/**
 * v670 诊断：采购单列表的「序号列」到底显示什么？
 * 截图看着第 2 列是 124 / 120 / 801（像单号尾号），要用 DOM 实测确认，不能靠看。
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'https://hergent.cn'
const VW = 1440, VH = 780
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

const TOKEN = fs.readFileSync(path.join(OUT_DIR, '.tmp-token-v670'), 'utf8').trim()
const udd = path.join(os.tmpdir(), 'hg-v670d-' + Date.now())
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
  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'fl' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
  }
  await S('Page.navigate', { url: BASE + '/#/inventory/purchase' })
  for (let i = 0; i < 200; i++) { if (await evalJS(`!!document.querySelector('table.ipl-tbl')`)) break; await sleep(120) }
  await sleep(2500)

  const r = await evalJS(`(() => {
    const t = document.querySelector('table.ipl-tbl')
    const ths = [...t.querySelectorAll('thead th')]
    const rows = [...t.querySelectorAll('tbody tr')].slice(0, 3)
    const cellInfo = (tds) => tds.map(td => ({
      cls: td.className.replace(/\\s+/g,' ').trim().slice(0,40),
      txt: (td.textContent||'').trim().slice(0,14),
      seqNum: td.querySelector('.seq-num') ? td.querySelector('.seq-num').textContent.trim() : null,
      w: Math.round(td.getBoundingClientRect().width),
    }))
    return {
      th: ths.map(x => ({ txt: (x.textContent||'').trim().slice(0,12), cls: x.className.replace(/\\s+/g,' ').trim().slice(0,50), w: Math.round(x.getBoundingClientRect().width) })),
      rows: rows.map(tr => cellInfo([...tr.children])),
      seqCellIdx: [...(rows[0]||{children:[]}).children].findIndex(td => td.classList.contains('seq-cell')),
    }
  })()`)
  console.log('表头（前 4 列）:')
  ;(r.th || []).slice(0, 4).forEach((x, i) => console.log(' ', i, JSON.stringify(x)))
  console.log('seq-cell 在行内索引 =', r.seqCellIdx)
  ;(r.rows || []).forEach((row, i) => {
    console.log('行' + i + ' 前 4 格:')
    row.slice(0, 4).forEach((c, j) => console.log('  ', j, JSON.stringify(c)))
  })
  cleanup()
} catch (e) {
  console.error('异常:', e && e.message); cleanup(); process.exit(2)
}
