/**
 * v654 诊断：本地页面能否正常渲染编辑表。
 * 抓 console 报错 / 未捕获异常 / 请求失败，再点「改单」看 DOM 变化。
 * 用法：node tests/perf/v654/diag.mjs [base]
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || process.env.HG_BASE || 'http://127.0.0.1:8899'
const OUT_DIR = path.dirname(new URL(import.meta.url).pathname)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class PipeCDP {
  constructor(w, r) {
    this.w = w; this.seq = 0; this.pending = new Map(); this.buf = ''
    this.events = []
    r.setEncoding('utf8')
    r.on('data', (chunk) => {
      this.buf += chunk
      let i
      while ((i = this.buf.indexOf('\0')) >= 0) {
        const s = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1)
        if (!s) continue
        let m; try { m = JSON.parse(s) } catch { continue }
        if (m.id && this.pending.has(m.id)) {
          const p = this.pending.get(m.id); this.pending.delete(m.id)
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
        } else if (m.method) { this.events.push(m) }
      }
    })
  }
  send(method, params = {}, sessionId, timeout = 60000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)) }, timeout)
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v) }, reject: (e) => { clearTimeout(timer); reject(e) } })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

const udd = path.join(os.tmpdir(), 'hg-diag-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1440,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

try {
  const cdp = new PipeCDP(chrome.stdio[3], chrome.stdio[4])
  let created = null
  for (let i = 0; i < 30; i++) {
    try { created = await cdp.send('Target.createTarget', { url: 'about:blank' }, undefined, 8000); break } catch { await sleep(400) }
  }
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const S = (m, p = {}, t = 60000) => cdp.send(m, p, sessionId, t)
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable'); await S('Log.enable')

  const evalJS = async (expression, awaitPromise = false) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true })
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    return r.result?.value
  }
  const waitFor = async (expr, timeout = 60000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (await evalJS(`(()=>{try{return !!(${expr})}catch(e){return false}})()`) === true) return true
      await sleep(200)
    }
    return false
  }

  const TOKEN = fs.readFileSync(path.join(OUT_DIR, '..', '.tmp-token'), 'utf8').trim()
  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'diag' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
  }

  // 在页面任何脚本之前装错误钩子 —— Vue 内部会吞掉渲染异常，靠 console 抓不全
  await S('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__errs=[];window.addEventListener('error',e=>{window.__errs.push('ERR: '+(e.message||'')+' @'+((e.error&&e.error.stack)||''))});
window.addEventListener('unhandledrejection',e=>{window.__errs.push('REJ: '+((e.reason&&(e.reason.stack||e.reason.message))||e.reason))});`,
  })

  await S('Page.navigate', { url: BASE + '/#/forecast' })
  const okTbl = await waitFor(`document.querySelector('.cross-tbl')`, 40000)
  console.log('页面加载:', await evalJS(`document.readyState`), '| 表格出现:', okTbl)
  await sleep(2500)
  console.log('build:', await evalJS(`window.__HG_BUILD__ || '-'`))
  console.log('查看表行数:', await evalJS(`document.querySelectorAll('.cross-tbl tbody tr').length`))
  console.log('编辑态:', await evalJS(`!!document.querySelector('.edit-tbl')`))

  // 控制台错误
  const errs = cdp.events
    .filter((e) => e.method === 'Runtime.consoleAPICalled' || e.method === 'Runtime.exceptionThrown' || e.method === 'Log.entryAdded')
    .map((e) => {
      if (e.method === 'Runtime.exceptionThrown') return 'EXCEPTION: ' + (e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text)
      if (e.method === 'Log.entryAdded') return 'LOG[' + e.params.entry.level + ']: ' + e.params.entry.text
      const a = e.params.args || []
      return 'CONSOLE[' + e.params.type + ']: ' + a.map((x) => x.value ?? x.description ?? x.type).join(' ')
    })
    .filter((s) => /error|warn|EXCEPTION/i.test(s))
  console.log('\n控制台报错/警告', errs.length, '条:')
  for (const s of errs.slice(0, 15)) console.log('  ' + String(s).slice(0, 400))

  // 失败请求
  const failed = cdp.events
    .filter((e) => e.method === 'Network.loadingFailed' || (e.method === 'Network.responseReceived' && e.params.response.status >= 400))
    .map((e) => e.method === 'Network.loadingFailed'
      ? 'FAIL ' + e.params.errorText + ' ' + (e.params.blockedReason || '')
      : 'HTTP ' + e.params.response.status + ' ' + e.params.response.url)
  console.log('\n失败请求', failed.length, '条:')
  for (const s of [...new Set(failed)].slice(0, 10)) console.log('  ' + s.slice(0, 200))

  // 点改单
  const clicked = await evalJS(`(()=>{
    const c=[...document.querySelectorAll('button,a,span,div')]
      .filter(el=>/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim())&&el.offsetParent!==null);
    if(!c.length) return 'no-button'; c[0].click(); return 'clicked' })()`)
  console.log('\n改单按钮:', clicked)
  await sleep(3500)
  console.log('编辑表存在:', await evalJS(`!!document.querySelector('.cross-tbl.edit-tbl')`))
  console.log('编辑表行数:', await evalJS(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length`))
  const errs2 = await evalJS(`JSON.stringify(window.__errs || [])`)
  console.log('\n页面内捕获的异常:', errs2)
  const ctxTxt = await evalJS(`(()=>{
    const t=document.body.innerText||''; const k=t.indexOf('Cannot read');
    return k<0?'(无)':t.slice(Math.max(0,k-160),k+220) })()`)
  console.log('\n错误文案上下文:\n' + ctxTxt)
  console.log('\n当前期次/标题:', await evalJS(`(document.querySelector('.grid-ctl-row')?.innerText||'').replace(/\s+/g,' ').slice(0,180)`))

  const after = cdp.events
    .filter((e) => e.method === 'Runtime.exceptionThrown' || e.method === 'Log.entryAdded')
    .map((e) => e.method === 'Runtime.exceptionThrown'
      ? 'EXCEPTION: ' + (e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text)
      : 'LOG[' + e.params.entry.level + ']: ' + e.params.entry.text)
  console.log('\n点击后新增异常', after.length - 0, '条:')
  for (const s of after.slice(0, 10)) console.log('  ' + String(s).slice(0, 500))
} catch (e) {
  console.error('DIAG FAILED:', e && e.message)
  process.exitCode = 1
} finally {
  cleanup()
}
