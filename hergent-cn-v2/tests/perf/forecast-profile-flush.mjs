/* 定位「停手/换格后那一次全表重算」的 CPU 花在哪个函数上。
   为什么不用猜：v652 已证明「猜 DOM 规模 / 表格紧凑」全错，必须拿到 self-time 分布。
   方法：CDP Profiler（采样间隔 50µs）覆盖「打一个字符 → 等防抖落值 → 整表 flush」窗口，
        按 callFrame 聚合 self time，把 (idle)/(program)/GC 单列出来。
   纪律：只读；临时 token 由外部创建与删除，本脚本不写业务数据。
   用法：node tests/perf/forecast-profile-flush.mjs [tag]
*/
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
/* HG_BASE：默认打生产；排查「哪个函数热」时指向本地未压缩构建（vite dev，5173），
   否则线上产物经 minify 后函数名不可读（v652b 实测只有 bt/sc/hn 这类短名）。 */
const BASE = process.env.HG_BASE || 'https://hergent.cn'
const OUT_DIR = path.dirname(new URL(import.meta.url).pathname)
const TAG = process.argv[2] || 'flush'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

class PipeCDP {
  constructor(w, r) {
    this.w = w; this.seq = 0; this.pending = new Map(); this.buf = ''
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
        }
      }
    })
  }
  send(method, params = {}, sessionId, timeout = 60000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)) }, timeout)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

/* Profile → 按 callFrame 聚合 self time。samples[i] 的权重 = timeDeltas[i]（µs）。
   ⚠️ 必须带 columnNumber：线上产物经 minify 后整文件只有几十行、每行几十万字符，
   只靠 lineNumber 无法回溯到具体函数；行+列才能在 chunk 里切出那一段源码。 */
function aggregate(profile) {
  const byId = new Map()
  for (const n of profile.nodes) byId.set(n.id, n)
  const self = new Map()
  const { samples, timeDeltas } = profile
  for (let i = 0; i < samples.length; i++) {
    const n = byId.get(samples[i])
    if (!n) continue
    const cf = n.callFrame
    const name = cf.functionName || '(anonymous)'
    const url = (cf.url || '').split('/').pop() || ''
    const key = `${name}\t${url}\t${cf.lineNumber}\t${cf.columnNumber}`
    const dt = Math.max(0, timeDeltas[i] || 0)
    self.set(key, (self.get(key) || 0) + dt)
  }
  const arr = [...self.entries()]
    .map(([k, us]) => {
      const [fn, loc, ln, col] = k.split('\t')
      return { fn, loc, line: +ln, col: +col, ms: +(us / 1000).toFixed(2) }
    })
    .sort((a, b) => b.ms - a.ms)
  const total = arr.reduce((s, x) => s + x.ms, 0)
  return { total: +total.toFixed(1), top: arr.slice(0, 45) }
}

const udd = path.join(os.tmpdir(), 'hg-flush-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new',
  '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--user-data-dir=${udd}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1440,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })

let chromeErr = ''
chrome.stderr.on('data', d => { chromeErr += String(d) })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

const out = { tag: TAG, build: null, profile: {}, samples: {}, errors: [] }

try {
  const cdp = new PipeCDP(chrome.stdio[3], chrome.stdio[4])
  let created = null
  for (let i = 0; i < 30; i++) {
    try { created = await cdp.send('Target.createTarget', { url: 'about:blank' }, undefined, 8000); break } catch { await sleep(400) }
  }
  if (!created) throw new Error('Chrome 未就绪: ' + chromeErr.slice(-200))
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const S = (m, p = {}, t = 60000) => cdp.send(m, p, sessionId, t)

  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable')

  const evalJS = async (expression, awaitPromise = false) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true })
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result?.value
  }
  const waitFor = async (expr, timeout = 60000, label = '') => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      try { if (await evalJS(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true } catch {}
      await sleep(120)
    }
    throw new Error('waitFor 超时: ' + (label || expr))
  }

  const TOKEN_FILE = path.join(OUT_DIR, '.tmp-token')
  const TOKEN = (process.env.HG_TOKEN || (fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8') : '')).trim()
  if (!TOKEN) throw new Error('缺少 tests/perf/.tmp-token（需 tenant 1 临时会话）')

  const csrf = 'flushprobe' + Date.now()
  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true],
    ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false],
    ['csrf_token', csrf, false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' }, 60000)
  await waitFor(`document.readyState==='complete'`, 60000, 'load')
  await waitFor(`!!document.querySelector('.cross-tbl, table')`, 90000, '页面表格')
  await sleep(1500)

  out.build = await evalJS(`(window.__HG_BUILD__||'-') + ' / ' + (document.documentElement.getAttribute('data-build')||'-')`)

  /* 进改单 */
  const opened = await evalJS(`(()=>{
    const cands=[...document.querySelectorAll('button,a,span,div')].filter(el=>/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim())&&el.offsetParent!==null);
    if(!cands.length) return false; cands[0].click(); return true
  })()`)
  if (!opened) throw new Error('未找到「改单」按钮')
  await waitFor(`!!document.querySelector('.cross-tbl.edit-tbl')`, 90000, '编辑表')
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length > 200`, 90000, '294 行')
  await sleep(2500)

  /* 逐项测三段时间：① 只改值②落值 flush③模板 patch。
     办法：页面内用 performance.now() + nextTick 包住，并在每段跑前后各采一次 Profiler。 */
  const focusOK = await evalJS(`(()=>{
    const tbl=document.querySelector('.cross-tbl.edit-tbl');
    const tr=tbl.querySelectorAll('tbody tr')[0];
    const q=[...tr.querySelectorAll('input.cell-qty')].find(i=>i.offsetParent!==null);
    if(!q) return false; q.focus(); return document.activeElement===q
  })()`)
  if (!focusOK) throw new Error('数量格未获得焦点')

  /* 窗口 A：打字后等 150ms 防抖落值 + 整表 flush（这就是用户感觉的那一卡） */
  await S('Profiler.enable')
  await S('Profiler.setSamplingInterval', { interval: 50 })
  await S('Profiler.start')
  await S('Input.insertText', { text: '7' })
  await sleep(700)
  const p1 = await S('Profiler.stop')
  out.profile.flushAfterType = aggregate(p1.profile)

  /* 窗口 B：只做「再打一个字符」—— 应当几乎不耗时（防抖生效的对照） */
  await S('Profiler.start')
  await S('Input.insertText', { text: '8' })
  await sleep(60)          // 远小于 150ms，不触发落值
  const p2 = await S('Profiler.stop')
  out.profile.typeOnly = aggregate(p2.profile)

  /* 窗口 C：换格（失焦）→ 立即落值 + flush */
  await S('Profiler.start')
  await evalJS(`(()=>{const i=document.querySelector('.cross-tbl.edit-tbl input.cell-qty'); if(i) i.blur(); const b=document.querySelector('.cross-tbl.edit-tbl input.cell-name, .cross-tbl.edit-tbl input'); if(b) b.focus(); return true})()`)
  await sleep(700)
  const p3 = await S('Profiler.stop')
  out.profile.blurFlush = aggregate(p3.profile)

  /* 页面内计时（不依赖 CDP 往返）：直接改一行值 → await nextTick，量真实 flush 时长 */
  out.samples.nextTickFlush = await evalJS(`(async()=>{
    const tbl=document.querySelector('.cross-tbl.edit-tbl');
    const inputs=[...tbl.querySelectorAll('input.cell-qty')].filter(i=>i.offsetParent!==null);
    const el=inputs[5]; if(!el) return null;
    const arr=[]; 
    for(let k=0;k<5;k++){
      el.focus();
      const t0=performance.now();
      /* 触发一次真实的 input 事件（走 numInput → 防抖 → 落值 → flush 全链） */
      el.value=String(20+k);
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(r=>setTimeout(r,0));
      const t1=performance.now();
      arr.push(+(t1-t0).toFixed(1));
      await new Promise(r=>setTimeout(r,320));
    }
    return arr
  })()`, true)

  out.samples.rows = await evalJS(`(()=>{const t=document.querySelector('.cross-tbl.edit-tbl');return{tr:t.querySelectorAll('tbody tr').length,td:t.querySelectorAll('td').length,inputs:t.querySelectorAll('input').length}})()`)

  fs.writeFileSync(path.join(OUT_DIR, `flush-${TAG}.json`), JSON.stringify(out, null, 1))

  const fmt = (label, agg) => {
    console.log(`\n### ${label}  总耗时 ${agg.total} ms`)
    agg.top.slice(0, 16).forEach(x => console.log(`   ${String(x.ms).padStart(8)} ms  ${x.fn}  ${x.loc}:${x.line}:${x.col}`))
  }
  console.log('build:', out.build, '| rows:', JSON.stringify(out.samples.rows))
  console.log('页面内 nextTick flush 采样(ms):', JSON.stringify(out.samples.nextTickFlush))
  fmt('窗口A 打字后落值+flush', out.profile.flushAfterType)
  fmt('窗口B 仅打字(防抖期内)', out.profile.typeOnly)
  fmt('窗口C 失焦立即落值', out.profile.blurFlush)
} catch (e) {
  out.errors.push(String(e && e.message || e))
  fs.writeFileSync(path.join(OUT_DIR, `flush-${TAG}.json`), JSON.stringify(out, null, 1))
  console.error('FAILED:', e && e.message)
  if (chromeErr) console.error('chrome stderr tail:', chromeErr.slice(-400))
  process.exitCode = 1
} finally {
  cleanup()
}
