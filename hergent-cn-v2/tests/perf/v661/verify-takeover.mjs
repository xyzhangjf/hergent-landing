/**
 * v661d 边界：门店格被手动编辑后的"接管"行为。
 * 用户在有分摊的门店格里填 60 ⇒ 应显示 60（而不是 60 + 分摊 25 = 85）。
 * 只改前端草稿（localStorage），不落库；探针结束即丢弃临时 profile。
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://127.0.0.1:8901'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOKEN = fs.readFileSync(path.join(HERE, '.tmp-token-v661'), 'utf8').trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PRODUCT = '蒙牛红枣酸牛奶1000g*10桶'

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
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v) }, reject: (e) => { clearTimeout(t); reject(e) } })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

const udd = path.join(os.tmpdir(), 'hg-p661d-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--no-proxy-server', '--window-size=1600,1000', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }
let FAIL = 0
const chk = (c, n, d = '') => { console.log((c ? '  ✅ ' : '  🔴 ') + n + (d ? '  —— ' + d : '')); if (!c) FAIL++ }

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
  const waitFor = async (expr, timeout = 90000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (await evalJS(`(()=>{try{return !!(${expr})}catch(e){return false}})()`) === true) return true
      await sleep(150)
    }
    throw new Error('waitFor 超时: ' + expr)
  }

  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'p661d' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', path: '/', httpOnly, secure: false, sameSite: 'Lax' })
  }
  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`document.body && document.body.innerText.trim().length > 50`, 60000)
  await sleep(2000)
  await waitFor(`!!document.querySelector('.cross-tbl')`, 60000)
  await sleep(2200)
  await evalJS(`(()=>{const c=[...document.querySelectorAll('button,a,span,div')].filter(el=>/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim())&&el.offsetParent!==null); if(!c.length) return false; c[0].click(); return true})()`)
  await waitFor(`!!document.querySelector('.cross-tbl.edit-tbl')`, 20000)
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length > 200`)
  await sleep(3000)

  const F = JSON.stringify(PRODUCT)
  // 找一个"含分摊"的门店格（data-c=12，原 30 + 分摊 25 = 55）
  const probe = `(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${F} })
    if (!tr) return null
    const td = tr.querySelector('td.qty-cell[data-c="12"]')
    const inp = td ? td.querySelector('input') : null
    return { before: inp ? inp.value : null }
  })()`
  const b = await evalJS(probe)
  chk(b && b.before === '55', '前置：该格显示 55（30 报量 + 25 分摊）', '实际 ' + (b && b.before))

  // 手动填 60
  await evalJS(`(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${F} })
    const td = tr.querySelector('td.qty-cell[data-c="12"]')
    const inp = td.querySelector('input')
    inp.focus(); inp.value = '60'
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    inp.blur()
    return true
  })()`)
  await sleep(1200)
  const a = await evalJS(probe)
  chk(a && a.before === '60', '接管：填 60 后显示 60（不是 60+25=85）', '实际 ' + (a && a.before))

  // 合计应变成 225（原 220 - 55 + 60）
  const sums = await evalJS(`(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${F} })
    const g = k => { const td = tr.querySelector('td.' + k); return td ? (td.textContent||'').trim() : null }
    return { sum: g('calc.sum'), boxes: g('calc.boxes'), final: g('calc.final') }
  })()`)
  console.log('  改动后: 合计=' + sums.sum + ' 箱=' + sums.boxes + ' 最终=' + sums.final)
  chk(Number(String(sums.sum).replace(/,/g, '')) === 225, '合计跟着变 225', '实际 ' + sums.sum)

  console.log(FAIL === 0 ? '\n==== ALL PASS ====' : `\n==== ${FAIL} 项未过 ====`)
  if (FAIL) process.exitCode = 1
} catch (e) {
  console.error('PROBE ERROR: ' + e.message)
  process.exitCode = 1
} finally {
  cleanup()
}
