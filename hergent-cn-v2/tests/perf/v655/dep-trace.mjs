/**
 * v655 依赖溯源探针：精确找出「父组件 Forecast 在改一格时重渲染」到底订阅了哪些会变的 Dep。
 *
 * 手法：在编辑表稳定后、改格前，快照父组件 render effect 当前订阅的所有 Dep（effect.deps 链表）。
 *       然后 hook Dep.prototype.notify：凡是「 firing 的 Dep 在父订阅集合里」就记录它（带 computed 标签 + 调用栈）。
 *       再做「聚焦 + 改一格」，读取 window.__trace（父订阅 Dep 中哪些被 notify）+ parentRenders。
 *
 * 这能无歧义地给出真凶清单（foot / qtyOptKey / 其它），避免凭经验猜。
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

const TOKEN_PATH = path.join(OUT_DIR, '..', '.tmp-token-v655')
const TOKEN = fs.readFileSync(TOKEN_PATH, 'utf8').trim()
const udd = path.join(os.tmpdir(), 'hg-dep-' + Date.now())
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

  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'dep' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: false, sameSite: 'Lax' })
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`!!document.querySelector('.cross-tbl')`)
  await sleep(1800)
  await evalJS(`(()=>{const c=[...document.querySelectorAll('button,a,span,div')].filter(el=>/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim())&&el.offsetParent!==null); if(!c.length) return false; c[0].click(); return true})()`)
  await waitFor(`!!document.querySelector('.cross-tbl.edit-tbl')`)
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length > 200`)
  await sleep(2500)
  console.log('只读网格行数:', await evalJS(`document.querySelectorAll('.cross-tbl:not(.edit-tbl) tbody tr').length`))
  console.log('只读网格可见:', await evalJS(`(()=>{const e=document.querySelector('.cross-tbl:not(.edit-tbl)');return e?(e.offsetParent!==null):'无'})()`))
  console.log('编辑网格行数:', await evalJS(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length`))

  // 安装 hook + 快照父订阅 Dep
  const setup = await evalJS(`(() => {
    const trEl = document.querySelector('.cross-tbl.edit-tbl tbody tr')
    if (!trEl) return { error: '找不到行' }
    const rowInst = trEl.__vueParentComponent
    if (!rowInst) return { error: '行无 __vueParentComponent' }
    let p = rowInst.parent, guard = 0
    while (p && guard++ < 30) {
      const nm = (p.type && (p.type.name || p.type.__name)) || ''
      if (/Forecast/.test(nm) && !/Row|Agg|History/.test(nm)) break
      p = p.parent
    }
    if (!p || !p.effect) return { error: '找不到父 effect', chain: p && (p.type.name||p.type.__name) }
    const eff = p.effect
    const depSet = new Set()
    let link = eff.deps
    while (link) { if (link.dep) depSet.add(link.dep); link = link.nextDep }
    const DepClass = (eff.deps && eff.deps.dep) ? eff.deps.dep.constructor : null
    if (!DepClass) return { error: '找不到 Dep 类', depCount: depSet.size }
    window.__depSet = depSet
    window.__parentRenders = 0
    const _pr = p.render
    p.render = function (...a) { window.__parentRenders++; return _pr.apply(this, a) }
    window.__trace = []
    const ss = p.setupState || (p.ctx && p.ctx.setupState) || {}
    const ssKeys = Object.keys(ss)
    const ownerOf = (dep) => {
      for (const k of ssKeys) {
        const o = ss[k]
        try {
          if (o && o.__v_isRef && o.dep === dep) return 'ref:' + k
          if (o && o.__v_isComputed && o.dep === dep) return 'computed:' + k
        } catch {}
      }
      if (dep.computed) {
        try { const s = (dep.computed.fn && dep.computed.fn.toString()) || ''; return 'computed:' + (s.slice(0, 300).replace(/\\n/g, ' ')) } catch { return 'computed' }
      }
      return 'ref/other'
    }
    const depLabel = (dep) => ownerOf(dep)
    const ownerNames = {}
    for (const d of depSet) { const nm = ownerOf(d); ownerNames[nm] = (ownerNames[nm] || 0) + 1 }
    window.__depNames = ownerNames
    // 增强：扫描 setupState 里所有 reactive 对象的属性 Dep（嵌套 ref.value 也算）
    function scanReactive (obj, base, out) {
      try {
        let raw = obj
        if (obj && obj.__v_isRef) { raw = obj.value }
        if (raw && raw.__v_isReactive) {
          const r = raw.__v_raw || raw
          const dm = r.__v_deps
          if (dm && dm instanceof Map) {
            for (const [k, d] of dm) if (d === out) return base + '.' + k
          }
        }
      } catch {}
      return null
    }
    window.__scanReactive = scanReactive
    const _notify = DepClass.prototype.notify
    const _knownRefs = {}
    for (const k of ['selected', 'selAnchor', 'selRange', 'selAxis']) {
      const o = ss[k]
      if (o && o.__v_isRef) _knownRefs[k] = o.dep
    }
    window.__knownRefDepCount = Object.keys(_knownRefs).length
    DepClass.prototype.notify = function () {
      if (window.__depSet.has(this)) {
        let lbl = depLabel(this)
        let explicit = ''
        for (const k in _knownRefs) { if (_knownRefs[k] === this) { explicit = k; break } }
        if (lbl === 'ref/other') {
          for (const k of ssKeys) { const r = scanReactive(ss[k], k, this); if (r) { lbl = 'reactive:' + r; break } }
        }
        const st = (new Error().stack || '').split('\\n').slice(1, 6)
        window.__trace.push({ label: lbl, explicit, stack: st })
      }
      return _notify.apply(this, arguments)
    }
    return { ok: true, parentType: (p.type.name||p.type.__name), depCount: depSet.size, depNames: window.__depNames, knownRefDepCount: window.__knownRefDepCount, hasSelectedKey: Object.keys(ss).includes('selected') }
  })()`)
  console.log('阶段A:', JSON.stringify(setup))
  if (setup.error) throw new Error(setup.error)

  // 聚焦 + 改一格
  const res = await evalJS(`(async () => {
    const tbl = document.querySelector('.cross-tbl.edit-tbl')
    const tbody = tbl.querySelector('tbody')
    const rows = [...tbody.querySelectorAll('tr')]
    const target = rows[5]
    const input = target.querySelector('input.cell-qty')
    if (!input) return { error: '第 6 行无数量输入框' }
    input.focus()
    await new Promise(r => setTimeout(r, 350))
    input.value = String((parseInt(input.value || '0', 10) || 0) + 1)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 400))
    return {
      parentRenders: window.__parentRenders || 0,
      trace: window.__trace || [],
    }
  })()`, true)

  console.log('\n=== v655 依赖溯源 ===')
  console.log('parentRenders:', res.parentRenders)
  console.log('父订阅 Dep 总数:', setup.depCount)
  console.log('改格期间被 notify 的父订阅 Dep 次数:', res.trace.length)
  const byLabel = {}
  for (const t of res.trace) byLabel[t.label] = (byLabel[t.label] || 0) + 1
  console.log('按标签聚合:', JSON.stringify(byLabel, null, 2))
  console.log('\n--- 每条 trace 的调用栈（前 9 行）---')
  res.trace.forEach((t, i) => {
    console.log('#' + i, '[' + t.label + ']', t.explicit ? ('EXPLICIT_REF=' + t.explicit) : '')
    t.stack.forEach((l) => console.log('   ' + l.trim()))
  })
  console.log('knownRefDepCount:', setup.knownRefDepCount, ' selectedKeyInSetupState:', setup.hasSelectedKey)
} catch (e) {
  console.error('FAILED:', e && e.message)
  process.exitCode = 1
} finally {
  cleanup()
}
