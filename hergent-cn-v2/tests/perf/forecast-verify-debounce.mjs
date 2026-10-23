/* v652 数字格防抖 —— 真机功能验证（不是性能采样，是**行为**验证）
   必须证明三件事，否则「变快了」可能是「根本没在算」：
     ① 打字过程中**不**落值（防抖确实延后）——避免把「没反应」误当性能提升；
     ② 停手 150ms 后值落进响应式，且行合计随之变化（合计没坏）；
     ③ 打完立刻失焦（点别处 / Tab 走）→ **立刻**落值（不丢最后一次输入）。
   ⚠️ 全程不点「保存」，不产生任何写接口调用；测完关闭浏览器。
   ⚠️ 与 forecast-profile.mjs 同款：Chrome 155 + pipe + --no-sandbox（原因见该文件头注释）。
   用法：node tests/perf/forecast-verify-debounce.mjs
*/
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.HG_BASE || 'https://hergent.cn'
const OUT_DIR = path.dirname(new URL(import.meta.url).pathname)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const out = { checks: [], logs: [], errors: [], badResponses: [] }
const pushErr = (s) => out.errors.push(String(s).slice(0, 300))
const check = (name, pass, detail) => { out.checks.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`) }

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
        if (m.method === 'Log.entryAdded') out.logs.push({ level: m.params.entry.level, text: String(m.params.entry.text).slice(0, 200) })
        if (m.method === 'Network.responseReceived') {
          const r = m.params.response
          if (r && r.status >= 400) out.badResponses.push({ status: r.status, url: String(r.url).slice(0, 160) })
        }
        if (m.method === 'Runtime.exceptionThrown') pushErr(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text)
        if (m.id && this.pending.has(m.id)) {
          const p = this.pending.get(m.id); this.pending.delete(m.id)
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
        }
      }
    })
  }
  send(method, params = {}, sessionId, timeout = 30000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)) }, timeout)
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v) }, reject: (e) => { clearTimeout(timer); reject(e) } })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

const udd = path.join(os.tmpdir(), 'hg-vfy-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new',
  '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--user-data-dir=${udd}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--window-size=1440,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })

let chromeErr = ''
chrome.stderr.on('data', d => { chromeErr += String(d) })

try {
  const cdp = new PipeCDP(chrome.stdio[3], chrome.stdio[4])
  let created = null
  for (let i = 0; i < 30; i++) {
    try { created = await cdp.send('Target.createTarget', { url: 'about:blank' }, undefined, 8000); break } catch { await sleep(400) }
  }
  if (!created) throw new Error('Chrome 未就绪: ' + chromeErr.slice(-200))
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const S = (m, p = {}, t = 30000) => cdp.send(m, p, sessionId, t)

  await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable')
  await S('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

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

  /* ---------- 登录（临时会话，tenant 1） ---------- */
  const TOKEN_FILE = path.join(OUT_DIR, '.tmp-token')
  const TOKEN = (process.env.HG_TOKEN || (fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8') : '')).trim()
  if (!TOKEN) throw new Error('缺 tests/perf/.tmp-token（本次验证需要 tenant 1 的真实 294 行）')
  await S('Network.enable')
  const csrf = 'vfy' + Date.now()
  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', csrf, false],
  ]) await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })

  await S('Page.navigate', { url: BASE + '/#/forecast' }, 60000)
  await waitFor(`document.readyState==='complete'`, 60000, 'readyState')
  await waitFor(`document.querySelector('.cross-tbl')`, 90000, '.cross-tbl')
  await sleep(2000)
  out.build = await evalJS('window.__HG_BUILD__ || null')
  console.log('build =', out.build)

  /* ---------- 进编辑态 ---------- */
  /* 忠实路径优先（点「改单」走完整守卫链）；演示租户可能没有进行中的期次
     （enterEdit 的 noOpenPeriod 守卫提前 return）⇒ 回落 setupState 直驱
     （editMode=true + loadEditGrid()，与 enterEdit 内部同一个函数同一条数据流，
     绕过的只是 UX 守卫）。判据同 tests/perf/v655/parent-rerender.mjs 的回落段。 */
  const clicked = await evalJS(`(()=>{const el=[...document.querySelectorAll('button')].find(e=>/改单/.test((e.textContent||'').trim())&&e.offsetParent!==null);if(!el)return false;el.click();return true})()`)
  if (!clicked) throw new Error('找不到「改单」按钮')
  let inEdit = false
  try {
    await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl .cell-qty').length>50`, 12000, 'qty inputs')
    inEdit = true
  } catch { /* 忠实路径没进编辑态 ⇒ 回落 */ }
  if (!inEdit) {
    const bypass = await evalJS(`(async () => {
      const trEl = document.querySelector('.cross-tbl:not(.edit-tbl) tbody tr') || document.querySelector('.cross-tbl tbody tr')
      if (!trEl || !trEl.__vueParentComponent) return { error: '找不到只读网格行' }
      let p = trEl.__vueParentComponent, guard = 0
      while (p && guard++ < 30) {
        const nm = (p.type && (p.type.name || p.type.__name)) || 'anon'
        if (/Forecast/.test(nm) && !/Row|Agg|History|Head|QtyOptions/.test(nm)) break
        p = p.parent
      }
      if (!p || !p.setupState || typeof p.setupState.loadEditGrid !== 'function') return { error: '找不到预报页组件实例' }
      p.setupState.editMode = true
      await p.setupState.loadEditGrid()
      return { ok: true }
    })()`, true)
    if (!bypass || bypass.error) throw new Error('回落失败: ' + (bypass && bypass.error || '无返回'))
  }
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl .cell-qty').length>50`, 120000, 'qty inputs')
  await sleep(800)

  /* ---------- 探针读取器 ---------- */
  const READ = `(()=>{
    const tbl=document.querySelector('.cross-tbl.edit-tbl');
    const tr=tbl.querySelectorAll('tbody tr')[0];
    if(!tr) return {err:'no row'};
    const sumTd=tr.querySelector('td.calc.sum');
    const qty=[...tr.querySelectorAll('input.cell-qty')].find(i=>i.offsetParent!==null);
    return {
      sumText: sumTd?sumTd.textContent.trim():null,
      qtyVal: qty?qty.value:null,
      qtyC: qty?qty.getAttribute('data-c'):null,
      dirtyAll: tbl.querySelectorAll('.cell-dirty-dot').length,
      dirtyRow: tr.querySelectorAll('.cell-dirty-dot').length
    }
  })()`

  const before = await evalJS(READ)
  check('准备：取到首行数量格与行合计', !!(before && before.qtyVal !== undefined && before.sumText !== null), before)

  /* ---------- ① 打字过程中不落值 ---------- */
  const focusOK = await evalJS(`(()=>{const tbl=document.querySelector('.cross-tbl.edit-tbl');const tr=tbl.querySelectorAll('tbody tr')[0];const q=[...tr.querySelectorAll('input.cell-qty')].find(i=>i.offsetParent!==null);if(!q)return false;q.focus();return document.activeElement===q})()`)
  check('准备：数量格获得焦点', focusOK === true, { focusOK })

  /* 🔴 在**页面内**每 10 毫秒采一次输入框真实值（不走 CDP 往返，避免探针自身竞态）。
     目的不只是"防抖有没有延后"，还要排掉一个更坏的可能：
     **防抖期间若发生重渲染，Vue 会不会把 DOM 里的字符刷回旧值**（用户会看到"打完字闪一下没了"）。
     采样里一旦出现「先变成 9，之后又变回 0」⇒ 就是这个缺陷，必须修。 */
  await evalJS(`(()=>{
    const tbl=document.querySelector('.cross-tbl.edit-tbl');
    const tr=tbl.querySelectorAll('tbody tr')[0];
    const q=[...tr.querySelectorAll('input.cell-qty')].find(i=>i.offsetParent!==null);
    window.__qSamples=[];
    const t0=performance.now();
    const iv=setInterval(()=>{window.__qSamples.push([Math.round(performance.now()-t0), q.value])},10);
    setTimeout(()=>{clearInterval(iv); window.__qDone=true}, 700);
    return true;
  })()`)
  await S('Input.insertText', { text: '9' })
  await sleep(60)   // 远小于 150ms 防抖窗口
  const early = await evalJS(READ)
  await sleep(700)
  const samples = await evalJS('window.__qSamples || []')
  const firstNine = samples.findIndex(s => s[1] === '9')
  const flippedBack = firstNine >= 0 && samples.slice(firstNine).some(s => s[1] !== '9')
  const nineAtMs = firstNine >= 0 ? samples[firstNine][0] : null
  out.phase1 = { samples: samples.slice(0, 40), firstNine, nineAtMs, flippedBack }

  check('①-1 字符进 DOM 后未被重渲染刷回旧值（样本里没有「先 9 又回 0」）',
    firstNine >= 0 && !flippedBack,
    { firstNine, nineAtMs, flippedBack, 前12个样本: samples.slice(0, 12) })
  check('①-2 字符进 DOM 后的那段时间里合计仍是旧值（防抖确实延后，不是"没在算"）',
    samples.slice(0, firstNine < 0 ? 1 : firstNine + 1).length > 0 && early.sumText === before.sumText,
    { sumBefore: before.sumText, sumEarly: early.sumText, earlyQty: early.qtyVal, dirty: early.dirtyAll })

  /* ---------- ② 停手后自动落值 ---------- */
  await sleep(500)
  const settled = await evalJS(READ)
  check('② 停手 500ms：行合计已变化（值已落进响应式，合计链路正常）',
    settled.sumText !== before.sumText,
    { sumBefore: before.sumText, sumSettled: settled.sumText, qtyVal: settled.qtyVal })
  check('② 改过角标亮起（cellDirty 链路正常）', settled.dirtyAll > 0, { dirtyAll: settled.dirtyAll })
  out.afterDebounce = { before, early, settled }

  /* ---------- ③ 失焦立刻落值（不丢最后一次输入） ---------- */
  await S('Input.insertText', { text: '0' })        // 值变 90
  // 等字符真的进 DOM（CDP 的 insertText 不保证在下一轮 evaluate 前已派发完 input）
  let typed2 = null
  for (let i = 0; i < 20; i++) {
    typed2 = await evalJS(READ)
    if (typed2.qtyVal === '90') break
    await sleep(10)
  }
  await evalJS(`(()=>{const a=document.activeElement;if(a&&a.blur)a.blur();return true})()`)
  await sleep(80)                                    // 远小于 150ms
  const blurred = await evalJS(READ)
  check('③ 打成 90 后立刻失焦：80ms 内行合计已按 90 更新（无 150ms 延迟、不丢值）',
    typed2.qtyVal === '90' && blurred.sumText !== settled.sumText,
    { qty900: typed2.qtyVal, sumBeforeBlur: settled.sumText, sumAfterBlur: blurred.sumText })

  await sleep(400)
  const stable = await evalJS(READ)
  check('③ 失焦后再等 400ms 无二次变化（防抖定时器没有重复写）',
    stable.sumText === blurred.sumText && stable.qtyVal === '90',
    { sumStable: stable.sumText, qtyVal: stable.qtyVal })
  out.afterBlur = { typed2, blurred, stable }

  /* ---------- ④ 面板内即时写入旁路（softWarnCfg 特例）---------- */
  out.panelImmediate = await evalJS(`(()=>{
    const tbl=document.querySelector('.cross-tbl.edit-tbl');const tr=tbl.querySelectorAll('tbody tr')[0];
    const q=[...tr.querySelectorAll('input.cell-qty')].find(i=>i.offsetParent!==null);
    return { note:'softWarnCfg 走 immediate 分支，由代码审查保证；此处仅记录未做面板交互', qtyC:q?q.getAttribute('data-c'):null };
  })()`)

  /* ---------- ④ 价格格：不走 numCommit 的 @change 也必须先落值 ----------
     这一格是「防抖反向覆盖」的高危点：`onCasePriceChange` 会把 `"12."` 收敛成 12，
     若 150ms 后挂着的定时器又把原始 `"12."` 写回去，后端 `_NUM_RE` 会判非数字拒收
     （用户看到的红框 = 明明填了 12）。 */
  const PRICE = `(()=>{const tbl=document.querySelector('.cross-tbl.edit-tbl');const tr=tbl.querySelectorAll('tbody tr')[0];const p=tr.querySelector('input.cell-price');if(!p)return null;p.focus();return {before:p.value}})()`
  const priceInit = await evalJS(PRICE)
  if (priceInit) {
    await S('Input.insertText', { text: '12.' })
    await sleep(60)
    const typedP = await evalJS(`(()=>{const p=document.querySelector('.cross-tbl.edit-tbl tbody tr input.cell-price');return p?p.value:null})()`)
    await evalJS(`(()=>{const a=document.activeElement;if(a&&a.blur)a.blur();return true})()`)
    await sleep(90)
    const afterBlurP = await evalJS(`(()=>{const p=document.querySelector('.cross-tbl.edit-tbl tbody tr input.cell-price');return p?p.value:null})()`)
    await sleep(450)   // 越过 150ms 防抖窗口
    const settledP = await evalJS(`(()=>{const p=document.querySelector('.cross-tbl.edit-tbl tbody tr input.cell-price');return p?p.value:null})()`)
    check('④ 价格格：失焦收敛成 12，且 450ms 后未被防抖定时器改回 "12."（防反向覆盖）',
      typedP === '12.' && afterBlurP === '12' && settledP === '12',
      { before: priceInit.before, typedP, afterBlurP, settledP })
    out.priceCell = { before: priceInit.before, typedP, afterBlurP, settledP }
  } else {
    check('④ 价格格：当前视图无价格输入框，跳过', true, { skipped: true })
  }

  out.consoleErrors = out.logs.filter(l => l.level === 'error').slice(0, 20)
  check('无 JS 异常', out.errors.length === 0, { errors: out.errors.slice(0, 3) })
  check('无 console error', out.consoleErrors.length === 0, out.consoleErrors.slice(0, 3))
} catch (e) {
  pushErr(e && e.stack || e)
  console.log('EARLY EXIT:', String(e && e.message || e))
} finally {
  try { chrome.kill('SIGKILL') } catch {}
  try { fs.rmSync(udd, { recursive: true, force: true }) } catch {}
  const f = path.join(OUT_DIR, 'forecast-verify-debounce.json')
  fs.writeFileSync(f, JSON.stringify(out, null, 1))
  const failed = out.checks.filter(c => !c.pass).length
  console.log(`\n=== ${out.checks.length} 项检查，失败 ${failed} 项；错误 ${out.errors.length} 条；写入 ${f} ===`)
  process.exitCode = (failed || out.errors.length) ? 1 : 0
}
