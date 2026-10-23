/**
 * v654 隔离度探针：输一个字符后，到底有多少行 DOM 被真正改动？
 *
 * 判据：拆行组件的目的就是「改一格只 patch 那一行」。若 MutationObserver 统计到
 * 只有 1 个 <tr> 下的节点变动 ⇒ 隔离成立；若是几十上百行 ⇒ 仍有跨行依赖。
 * 同时用 performance.now() 在页面内量 flush 耗时（含 debounce 落值后的那次更新）。
 *
 * 用法：node tests/perf/v654/mutation-count.mjs [base]
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

const udd = path.join(os.tmpdir(), 'hg-mut-' + Date.now())
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

  const TOKEN = fs.readFileSync(path.join(OUT_DIR, '..', '.tmp-token'), 'utf8').trim()
  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'mut' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`!!document.querySelector('.cross-tbl')`)
  await sleep(1800)
  await evalJS(`(()=>{const c=[...document.querySelectorAll('button,a,span,div')].filter(el=>/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim())&&el.offsetParent!==null); if(!c.length) return false; c[0].click(); return true})()`)
  await waitFor(`!!document.querySelector('.cross-tbl.edit-tbl')`)
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length > 200`)
  await sleep(2500)

  console.log('build:', await evalJS(`window.__HG_BUILD__`))
  console.log('行数:', await evalJS(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length`))

  console.log('\n=== DOM 事实 ===')
  console.log(await evalJS(`(()=>{
    const t=document.querySelector('.cross-tbl.edit-tbl');
    const dls=[...t.querySelectorAll('datalist')];
    const byId={};
    for(const d of dls){ byId[d.id]=(byId[d.id]||0)+1 }
    const rowsWithDl=new Set(dls.map(d=>[...d.closest('tr').parentElement.children].indexOf(d.closest('tr'))));
    return JSON.stringify({
      表格数: document.querySelectorAll('.cross-tbl.edit-tbl').length,
      datalist总数: dls.length,
      按id计数: byId,
      含datalist的行: [...rowsWithDl].join(','),
      option总数: t.querySelectorAll('option').length,
    }, null, 1) })()`))

  // 在页面内装好 observer 与计时器，然后模拟一次真实输入
  const result = await evalJS(`(async () => {
    const tbl = document.querySelector('.cross-tbl.edit-tbl')
    const tbody = tbl.querySelector('tbody')
    const rows = [...tbody.querySelectorAll('tr')]
    const target = rows[5]
    const input = target.querySelector('input.cell-qty')
    if (!input) return { error: '找不到第 6 行的数量输入框' }

    // 🔴 先聚焦并等稳定：onFocusCell 会改全局 qtyOptKey（datalist 只允许一个所有者），
    //    那本身就是一次全表重渲染。不等稳定就观察，量到的是「换格成本」而不是「打字成本」。
    input.focus()
    await new Promise(r => setTimeout(r, 350))

    const touched = new Set()
    let mutations = 0
    const attrHist = {}
    const byTime = {}
    const samples = []
    const obs = new MutationObserver((list) => {
      for (const m of list) {
        mutations++
        const key = m.type === 'attributes' ? 'attr:' + m.attributeName
          : m.type === 'characterData' ? 'text' : 'childList'
        attrHist[key] = (attrHist[key] || 0) + 1
        const dt = Math.round((performance.now() - t0) / 50) * 50
        byTime[dt] = (byTime[dt] || 0) + 1
        if (samples.length < 8) {
          const t = m.target
          const el = t.nodeType === 1 ? t : t.parentElement
          const tr = el && el.closest ? el.closest('tr') : null
          const dl = el && el.closest ? el.closest('datalist') : null
          const rows = tr ? [...tr.parentElement.children].indexOf(tr) : -1
          samples.push(key + ' <' + (t.tagName || t.nodeName) + '> row=' + rows
            + ' datalist=' + (dl ? dl.id : '-') + ' parents=' + (el ? [el.parentElement?.tagName, el.parentElement?.className].join('.') : ''))
        }
        let n = m.target
        if (n.nodeType !== 1) n = n.parentElement
        const tr = n && n.closest ? n.closest('tr') : null
        if (tr) touched.add(tr)
      }
    })
    obs.observe(tbody, { subtree: true, childList: true, characterData: true, attributes: true })

    // 清零组件级计数器（只在 instrumented 构建里存在）
    window.__rowUpd = 0; window.__rowSet = new Set(); window.__trig = {}
    const t0 = performance.now()
    // 走真实输入路径：改 value 并派发 input 事件（与键盘输入同一处理链路）
    input.value = String((parseInt(input.value || '0', 10) || 0) + 1)
    input.dispatchEvent(new Event('input', { bubbles: true }))

    // 分别量「立即 flush」与「防抖落值后」两段
    const immediate = performance.now() - t0
    await new Promise(r => setTimeout(r, 400))   // 越过 150ms 防抖
    const afterDebounce = performance.now() - t0
    await new Promise(r => requestAnimationFrame(() => r()))
    obs.disconnect()
    return {
      componentUpdates: window.__rowUpd || 0,
      componentRows: window.__rowSet ? window.__rowSet.size : -1,
      触发依赖: window.__trig || {},
      mutations,
      attrHist,
      byTime,
      samples,
      touchedRows: touched.size,
      totalRows: rows.length,
      immediateMs: +immediate.toFixed(1),
      afterDebounceMs: +afterDebounce.toFixed(1),
    }
  })()`, true)

  console.log('\n=== 一次输入后的 DOM 改动 ===')
  console.log(JSON.stringify(result, null, 2))
  if (result && !result.error) {
    console.log(`\n改动行数 ${result.touchedRows} / 共 ${result.totalRows} 行 —— ${result.touchedRows <= 3 ? '✅ 隔离成立（只动本行）' : '❌ 仍在多行重渲染'}`)
  }
} catch (e) {
  console.error('FAILED:', e && e.message)
  process.exitCode = 1
} finally {
  cleanup()
}
