/**
 * v666 专项：**补齐还没完成时**按行号跳转，能不能落到目标格。
 *
 * 为什么单独测：分批渲染最大的回归风险就在这儿 —— `focusCell` 用
 * `querySelector('input[data-r][data-c]')` 找元素，未挂载的行找不到时 **静默无操作**。
 * 若 `ensureRowsRendered` 漏在某个入口上，用户按 Ctrl+End / 点「查错」跳转就会「按了没反应」，
 * 而且没有任何报错 —— 这种缺陷只有在这种「首帧刚出来就跳远」的时序下才暴露。
 *
 * 判据：
 *   ① 跳转前数据行数应 ≈ 首批（24），即补齐确实还没走完
 *   ② 跳转后焦点必须落在 r > 首批（证明目标行被即时撑开并聚焦）
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://127.0.0.1:8906'
const OUT_DIR = path.dirname(new URL(import.meta.url).pathname)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  send(method, params = {}, sessionId, timeout = 180000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)) }, timeout)
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v) }, reject: (e) => { clearTimeout(t); reject(e) } })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

const TOKEN = fs.readFileSync(path.join(OUT_DIR, '.tmp-token-v666'), 'utf8').trim()
const udd = path.join(os.tmpdir(), 'hg-v666j-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1440,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }

try {
  const cdp = new PipeCDP(chrome.stdio[3], chrome.stdio[4])
  let created = null
  for (let i = 0; i < 30; i++) {
    try { created = await cdp.send('Target.createTarget', { url: 'about:blank' }, undefined, 8000); break } catch { await sleep(400) }
  }
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const S = (m, p = {}, t = 180000) => cdp.send(m, p, sessionId, t)
  await S('Page.enable'); await S('Runtime.enable')
  const evalJS = async (expr, awaitPromise = false) => {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise, userGesture: true })
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result?.value
  }
  const waitFor = async (expr, timeout = 180000) => {
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
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: false, sameSite: 'Lax' })
  }
  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`!!document.querySelector('.cross-tbl')`)
  await waitFor(`window.__hgProductsGridReady > 0`, 90000)
  await sleep(1200)
  console.log('build:', await evalJS(`window.__HG_BUILD__`))

  const r = await evalJS(`(async () => {
    const btn = [...document.querySelectorAll('button,a')]
      .filter(el => el.offsetParent !== null && /^(改单|编辑报单|修改)$/.test((el.textContent||'').trim()))[0]
    btn.click()
    await new Promise(res => {
      const tick = () => {
        const inp = document.querySelector('.cross-tbl.edit-tbl input.cell-qty')
        if (inp && inp.offsetParent !== null) return res()
        requestAnimationFrame(tick)
      }
      tick()
    })
    const rowsBefore = document.querySelectorAll('.cross-tbl.edit-tbl tbody tr:not(.render-pending):not(.foot-row)').length
    const pendingBefore = (document.querySelector('.render-pending') || {}).textContent || ''
    // 首帧刚出、补齐远未完成时就跳 —— 这正是会暴露「查不到 DOM ⇒ 静默无反应」的时序
    const first = document.querySelector('.cross-tbl.edit-tbl input[data-r="0"][data-c="0"]')
    if (!first) return { error: '首行输入框不存在' }
    first.focus()
    await new Promise(x => setTimeout(x, 80))
    const ae0 = document.activeElement
    ;(ae0 || document.body).dispatchEvent(new KeyboardEvent('keydown', {
      key: 'End', code: 'End', ctrlKey: true, bubbles: true, cancelable: true,
    }))
    await new Promise(x => setTimeout(x, 500))
    const ae = document.activeElement
    return {
      rowsBefore, pendingBefore,
      focusTag: ae && ae.tagName,
      focusR: ae && ae.getAttribute && ae.getAttribute('data-r'),
      focusC: ae && ae.getAttribute && ae.getAttribute('data-c'),
      rowsAfter: document.querySelectorAll('.cross-tbl.edit-tbl tbody tr:not(.render-pending):not(.foot-row)').length,
    }
  })()`, true)
  if (r.error) throw new Error(r.error)

  console.log('\n=== 首帧刚出就跳远 ===')
  console.log(`  跳转前数据行数: ${r.rowsBefore}（占位：「${r.pendingBefore}」）`)
  console.log(`  跳转后焦点: <${r.focusTag}> r=${r.focusR} c=${r.focusC}，此时数据行 ${r.rowsAfter}`)
  ok(r.rowsBefore < 100, `跳转前确实还没补齐（${r.rowsBefore} 行 < 100）⇒ 这个时序才有判别力`)
  ok(r.focusTag === 'INPUT' && Number(r.focusR) > r.rowsBefore,
    `Ctrl+End 落在 r=${r.focusR}，超出跳转前已挂载的 ${r.rowsBefore} 行 ⇒ ensureRowsRendered 生效`)

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'}  (${pass} 通过 / ${fail} 失败)`)
  if (fail) process.exitCode = 1
} catch (e) {
  console.error('FAILED:', e && e.message)
  process.exitCode = 1
} finally {
  cleanup()
}
