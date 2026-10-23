import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://127.0.0.1:8899'
const TOKEN = process.env.HG_TOKEN || ''
const udd = os.tmpdir() + '/chk' + Date.now()
const chrome = spawn(CHROME, ['--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--user-data-dir=${udd}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
class P {
  constructor(w, r) { this.w = w; this.seq = 0; this.pending = new Map(); this.buf = ''; r.setEncoding('utf8'); r.on('data', (d) => { this.buf += d; let i; while ((i = this.buf.indexOf('\0')) >= 0) { const s = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1); if (!s) continue; let m; try { m = JSON.parse(s) } catch { continue } if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result) } }) }
  send(m, p = {}, s, t = 120000) { const id = ++this.seq; return new Promise((res, rej) => { const to = setTimeout(() => { this.pending.delete(id); rej(new Error('TO ' + m)) }, t); this.pending.set(id, { resolve: (v) => { clearTimeout(to); res(v) }, reject: (e) => { clearTimeout(to); rej(e) } }); this.w.write(JSON.stringify({ id, method: m, params: p, ...(s ? { sessionId: s } : {}) }) + '\0') }) })
}
try {
  const cli = new P(chrome.stdio[3], chrome.stdio[4])
  let cr = null
  for (let i = 0; i < 30; i++) { try { cr = await cli.send('Target.createTarget', { url: 'about:blank' }, undefined, 8000); break } catch { await sleep(400) } }
  const { sessionId } = await cli.send('Target.attachToTarget', { targetId: cr.targetId, flatten: true })
  const S = (m, p = {}, t = 120000) => cli.send(m, p, sessionId, t)
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable')
  const ev = async (x) => { const r = await S('Runtime.evaluate', { expression: x, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value }
  const wf = async (x) => { const t0 = Date.now(); while (Date.now() - t0 < 90000) { if (await ev(`(()=>{try{return !!(${x})}catch(e){return false}})()`) === true) return; await sleep(150) } throw new Error('timeout ' + x) }
  for (const [n, v, h] of [['erp_token', TOKEN, true], ['hergent_auth', '1', false], ['hergent_tenant', '1', false], ['csrf_token', 'c' + Date.now(), false]]) await S('Network.setCookie', { name: n, value: v, url: BASE + '/', httpOnly: h, secure: false, sameSite: 'Lax' })
  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await wf(`!!document.querySelector('.cross-tbl')`); await sleep(1800)
  await ev(`(()=>{const c=[...document.querySelectorAll('button,a,span,div')].filter(el=>/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim())&&el.offsetParent!==null);if(!c.length)return false;c[0].click();return true})()`)
  await wf(`!!document.querySelector('.cross-tbl.edit-tbl')`); await sleep(2500)
  console.log('只读网格(.cross-tbl:not(.edit-tbl)) 行数:', await ev(`document.querySelectorAll('.cross-tbl:not(.edit-tbl) tbody tr').length`))
  console.log('编辑网格(.edit-tbl) 行数:', await ev(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length`))
  console.log('只读网格是否可见(offsetParent!=null):', await ev(`(()=>{const e=document.querySelector('.cross-tbl:not(.edit-tbl)');return e?(e.offsetParent!==null):'无该元素'})()`))
  console.log('只读网格 display:', await ev(`(()=>{const e=document.querySelector('.cross-tbl:not(.edit-tbl)');if(!e)return '无';return getComputedStyle(e).display})()`))
} catch (e) { console.error('ERR', e.message) } finally { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }
