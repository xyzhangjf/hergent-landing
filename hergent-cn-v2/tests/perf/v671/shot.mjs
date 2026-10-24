/**
 * v671 交付截图：采销三列表的**半选态**（全选复选框的核心视觉）。
 * 只负责拍照，不做判据 —— 判据在 verify-selectall.mjs。
 * 用法：node shot.mjs [base] [w] [h]
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
const TOKEN = fs.readFileSync(path.join(OUT_DIR, '.tmp-token-v671'), 'utf8').trim()
const udd = path.join(os.tmpdir(), 'hg-v671shot-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  `--window-size=${VW},${VH + 120}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

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
  send (method, params = {}, sessionId) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

try {
  const cdp = new PipeCDP(chrome.stdio[3], chrome.stdio[4])
  let created = null
  for (let i = 0; i < 30; i++) { try { created = await cdp.send('Target.createTarget', { url: 'about:blank' }); break } catch { await sleep(400) } }
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const S = (m, p = {}) => cdp.send(m, p, sessionId)
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable')
  await S('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false })
  const ev = async (e) => (await S('Runtime.evaluate', { expression: e, returnByValue: true, userGesture: true })).result?.value
  const realClick = async (x, y) => {
    await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 })
    await S('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'fl' + Date.now(), false],
  ]) await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })

  await S('Page.navigate', { url: BASE + '/#/inventory/purchase' })
  await sleep(6000)
  // 点 3 行 ⇒ 表头进入半选
  const boxes = await ev(`[...document.querySelectorAll('tbody tr td.ipl-c-chk input, tbody tr td.psi-chk input')].slice(0,3).map(b=>{const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),hit:document.elementFromPoint(Math.round(r.left+r.width/2),Math.round(r.top+r.height/2))===b}})`)
  for (const b of boxes) { if (b.hit) { await realClick(b.x, b.y); await sleep(250) } }
  await sleep(700)
  const shot = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(OUT_DIR, `v671-half-${VW}x${VH}.png`), Buffer.from(shot.data, 'base64'))
  const st = await ev(`({h: (()=>{const b=document.querySelector('thead th.ipl-c-chk input');return b?{checked:b.checked,indet:b.indeterminate}:null})(), rows: [...document.querySelectorAll('tbody tr td.ipl-c-chk input')].filter(b=>b.checked).length})`)
  console.log('半选态:', JSON.stringify(st))
  // 复原
  const h = await ev(`(()=>{const b=document.querySelector('thead th.ipl-c-chk input');if(!b)return null;const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`)
  if (h) { await realClick(h.x, h.y); await sleep(400); await realClick(h.x, h.y); await sleep(300) }
  console.log('已复原:', await ev(`[...document.querySelectorAll('tbody tr td.ipl-c-chk input')].filter(b=>b.checked).length`))
} catch (e) { console.error(e.message); process.exitCode = 1 } finally { cleanup() }
