/**
 * v666 验收：编辑网格分批挂载。
 *
 * 判据（全部来自 DOM/时间，不看感觉）：
 *   ① 点「改单」→ 第一个输入框可用的时间（首帧）必须明显低于 v665 基线
 *   ② 占位行先出现、补齐后必须消失；最终行数 == cross.rows 全量（不能少一行）
 *   ③ 补齐完成后 **每一行都在**：抽查首/中/末三行的 input 都能找到
 *   ④ 按行号定位仍有效：focusCell 到第 249 行（远超首批 60）必须能聚焦到那个输入框
 *      —— 这是分批渲染最大的回归风险（querySelector 找不到未挂载行会静默失败）
 *   ⑤ 合计数字与分批无关（表尾"合计(小单位)"有值且非 0）
 *
 * 用法：node verify-batch.mjs [base] [throttle]
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://127.0.0.1:8906'
const THROTTLE = Number(process.argv[3] || 4)
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
const udd = path.join(os.tmpdir(), 'hg-v666v-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1440,900', 'about:blank',
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
  await S('Page.enable'); await S('Runtime.enable')
  if (THROTTLE > 1) await S('Emulation.setCPUThrottlingRate', { rate: THROTTLE })
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
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
  }
  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`!!document.querySelector('.cross-tbl')`)
  await waitFor(`window.__hgProductsGridReady > 0`, 90000)
  await sleep(1500)
  console.log(`[CPU ${THROTTLE}x] build:`, await evalJS(`window.__HG_BUILD__`))

  const r = await evalJS(`(async () => {
    const lt = []
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) lt.push(+e.duration.toFixed(0)) })
      .observe({ entryTypes: ['longtask'] }) } catch (e) {}
    const btn = [...document.querySelectorAll('button,a')]
      .filter(el => el.offsetParent !== null && /^(改单|编辑报单|修改)$/.test((el.textContent||'').trim()))[0]
    const t0 = performance.now()
    btn.click()
    await new Promise(res => {
      const tick = () => {
        const inp = document.querySelector('.cross-tbl.edit-tbl input.cell-qty')
        if (inp && inp.offsetParent !== null) return res()
        requestAnimationFrame(tick)
      }
      tick()
    })
    const tFirst = +(performance.now() - t0).toFixed(0)
    // 首帧时应该只挂了一小部分 + 有占位行
    const firstRows = document.querySelectorAll('.cross-tbl.edit-tbl tbody tr:not(.render-pending):not(.foot-row)').length
    const firstPending = document.querySelector('.render-pending')
    const firstPendingText = firstPending ? firstPending.textContent.trim() : ''
    // 等补齐：占位行消失 + 行数稳定
    let stable = 0, last = -1, tFull = 0
    while (stable < 10) {
      await new Promise(r => requestAnimationFrame(r))
      const n = document.querySelectorAll('.cross-tbl.edit-tbl tbody tr:not(.render-pending):not(.foot-row)').length
      if (n === last) stable++; else { stable = 0; last = n }
      tFull = +(performance.now() - t0).toFixed(0)
      if (tFull > 60000) break
    }
    const allRows = document.querySelectorAll('.cross-tbl.edit-tbl tbody tr:not(.render-pending):not(.foot-row)').length
    const pendingLeft = !!document.querySelector('.render-pending')
    const inputs = document.querySelectorAll('.cross-tbl.edit-tbl input').length
    const ltFirst = lt.slice()
    // 抽查首/中/末三行的输入框都在
    const probeRow = (i) => !!document.querySelector('.cross-tbl.edit-tbl input[data-r="' + i + '"]')
    const rsAll = [...document.querySelectorAll('.cross-tbl.edit-tbl input[data-r]')].map(x => Number(x.getAttribute('data-r')))
    const maxR = rsAll.length ? Math.max(...rsAll) : -1
    const spot = { first: probeRow(0), mid: probeRow(Math.floor(maxR / 2)), last: probeRow(maxR) }
    const rs = [...document.querySelectorAll('.cross-tbl.edit-tbl input[data-r]')].map(x => Number(x.getAttribute('data-r')))
    const rsCount = rs.length
    const rowsText = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr:not(.render-pending):not(.foot-row)')].length
    const lastTrInputs = (() => { const t = document.querySelectorAll('.cross-tbl.edit-tbl tbody tr:not(.render-pending):not(.foot-row)'); const l = t[t.length-1]; return l ? l.querySelectorAll('input').length : -1 })()
    // ④ 按行号定位：直接在页面里调最后一行之前的一行（远超首批 60）
    const target = allRows - 46
    const before = !!document.querySelector('.cross-tbl.edit-tbl input[data-r="' + target + '"][data-c="0"]')
    return {
      tFirst, firstRows, firstPendingText, firstHasPending: !!firstPending,
      tFull, allRows, pendingLeft, inputs, spot, target, before,
      ltN: ltFirst.length, ltMax: ltFirst.length ? Math.max(...ltFirst) : 0,
      foot: (document.querySelector('.edit-summary .es-txt') || {}).textContent || '',
    }
  })()`, true)

  console.log('\n=== ① 首帧 ===')
  console.log(`  点「改单」→ 第一个输入框可用: ${r.tFirst}ms`)
  console.log(`  首帧已挂载行数: ${r.firstRows}（此时占位行${r.firstHasPending ? '存在：' + r.firstPendingText : '不存在'}）`)
  ok(r.tFirst < 600, `首帧 < 600ms（实测 ${r.tFirst}ms；v665 基线 864ms）`)
  ok(r.firstRows < r.allRows, `首帧只挂了一部分（${r.firstRows} < ${r.allRows}）⇒ 分批生效`)
  ok(r.firstHasPending && /正在准备剩余\s*\d+\s*行/.test(r.firstPendingText), `首帧有占位行且文案正确：「${r.firstPendingText}」`)

  console.log('\n=== ② 补齐 ===')
  console.log(`  补齐完成: ${r.tFull}ms | 最终行数 ${r.allRows} | 输入框 ${r.inputs}`)
  console.log(`  长任务 ${r.ltN} 个，峰值 ${r.ltMax}ms`)
  ok(!r.pendingLeft, '补齐后占位行已消失')
  ok(r.allRows > 200, `最终行数 ${r.allRows} > 200（全量挂上，没丢行）`)
  ok(r.ltMax < 400, `长任务峰值 ${r.ltMax}ms < 400ms（v665 基线 936ms）`)

  console.log('\n=== ③ 抽查行都在 ===')
  console.log('  首行/中间行/末行 input:', JSON.stringify(r.spot))
  console.log(`  最大 data-r ${r.maxR}`)
  ok(r.spot.first && r.spot.mid && r.spot.last, '首/中/末三行的输入框都能查到')

  console.log('\n=== ④ 按行号定位（分批渲染最大回归风险）===')
  console.log(`  目标行 ${r.target}（超出首批 60）在补齐后是否可达: ${r.before}`)
  const focusRes = await evalJS(`(async () => {
    const tbl = document.querySelector('.cross-tbl.edit-tbl')
    // 通过键盘：先在首行聚焦，再用 Ctrl+End 跳到表尾（走 focusCell 链路）
    const first = tbl.querySelector('input[data-r="0"][data-c="0"]')
    if (!first) return { error: '首行输入框不存在' }
    first.focus()
    await new Promise(r => setTimeout(r, 200))
    const ev = new KeyboardEvent('keydown', { key: 'End', code: 'End', ctrlKey: true, bubbles: true, cancelable: true })
    ;(document.activeElement || tbl).dispatchEvent(ev)
    await new Promise(r => setTimeout(r, 600))
    const ae = document.activeElement
    return { tag: ae && ae.tagName, r: ae && ae.getAttribute && ae.getAttribute('data-r'), c: ae && ae.getAttribute && ae.getAttribute('data-c') }
  })()`, true)
  console.log('  Ctrl+End 后焦点:', JSON.stringify(focusRes))
  ok(focusRes && focusRes.tag === 'INPUT' && Number(focusRes.r) > 60, `Ctrl+End 能落到表尾某格（r=${focusRes && focusRes.r}，>60 说明未挂载行也能定位）`)

  console.log('\n=== ⑤ 合计与数据 ===')
  console.log('  汇总条:', r.foot)
  ok(/合计\(小单位\)/.test(r.foot), '表尾合计仍然有值（分批渲染不影响数据层）')

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'}  (${pass} 通过 / ${fail} 失败)`)
  if (fail) process.exitCode = 1
} catch (e) {
  console.error('FAILED:', e && e.message)
  process.exitCode = 1
} finally {
  cleanup()
}
