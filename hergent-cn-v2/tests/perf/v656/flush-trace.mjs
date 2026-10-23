/**
 * v656 flush 溯源探针：量「停手后那次 flush」的耗时构成。
 *
 * 背景：v654/v655 已把「改一格」收敛到 parentRenders=0 + 只改 1 行，但停手后
 * （numInput 150ms 防抖落定后）仍有一次 ~60ms 的全 flush。本探针回答三个问题：
 *   ① 这次 flush 到底多久（所有组件 render 调用的外包络）？
 *   ② 哪些组件类型在重渲染、各几次（ForecastRow 应按 1 行，ForecastAgg 按汇总条）？
 *   ③ 哪些 computed 被失效（Dep.notify 里带 computed 的全局清单，按 fn 源码聚合）？
 *
 * 环境：可读 dev 构建（--minify false）+ 本地 8902（静态 dist-dev + /api 反代）。
 *      编辑态走 setupState 直驱（dev 构建 setupState 可用），零生产写入。
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || process.env.HG_BASE || 'http://127.0.0.1:8902'
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

const TOKEN = fs.readFileSync(path.join(OUT_DIR, '.tmp-token-v656'), 'utf8').trim()
const udd = path.join(os.tmpdir(), 'hg-flush-' + Date.now())
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
    ['hergent_tenant', '1', false], ['csrf_token', 'fl' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: false, sameSite: 'Lax' })
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`!!document.querySelector('.cross-tbl')`)
  await sleep(1800)

  /* 进编辑态：**忠实路径优先**（点「改单」走完整守卫链，生产/本地均适用；
     需演示租户有进行中的期次）。无开放期次时回落 setupState 直驱
     （dev 构建可用：loadEditGrid 与 enterEdit 内部同一个函数同一条数据流）。 */
  let entry = 'ui'
  await evalJS(`(()=>{const c=[...document.querySelectorAll('button,a,span,div')].filter(el=>/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim())&&el.offsetParent!==null); if(!c.length) return false; c[0].click(); return true})()`)
  let inEdit = false
  try {
    await waitFor(`!!document.querySelector('.cross-tbl.edit-tbl')`, 10000)
    inEdit = true
  } catch { /* 无开放期次 ⇒ 回落 */ }
  if (!inEdit) {
    entry = 'setupState-bypass'
    const bypass = await evalJS(`(async () => {
      const trEl = document.querySelector('.cross-tbl:not(.edit-tbl) tbody tr') || document.querySelector('.cross-tbl tbody tr')
      if (!trEl || !trEl.__vueParentComponent) return { error: '找不到只读网格行（生产构建无 __vueParentComponent，需开放期次走忠实路径）' }
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
    if (bypass.error) throw new Error('进编辑态失败: ' + bypass.error)
  }
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length > 200`)
  await sleep(2500)
  console.log('编辑网格行数:', await evalJS(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length`))
  console.log('build:', await evalJS(`window.__HG_BUILD__`))

  /* 阶段 A：枚举全部组件实例 ⇒ 包 render 计数（按类型名 + 行号）；
     hook Dep.prototype.notify 全局记录 computed 失效（fn 源码聚合）。 */
  const setup = await evalJS(`(() => {
    const root = document.querySelector('#app')._vnode.component
    if (!root) return { error: '找不到根实例' }
    const insts = []
    const seen = new Set()
    const walkV = (v) => {
      if (!v || typeof v !== 'object' || seen.has(v)) return
      seen.add(v)
      if (v.component) {
        if (!seen.has(v.component)) { seen.add(v.component); insts.push(v.component) }
        walkV(v.component.subTree)
        return
      }
      if (Array.isArray(v.children)) for (const c of v.children) walkV(c)
    }
    walkV(root.subTree)
    const nameOf = (i) => (i.type && (i.type.name || i.type.__name)) || 'anon'
    window.__rend = {}      // 类型名 -> 次数
    window.__rendRow = {}   // 行号 -> 次数（ForecastRow）
    window.__flush = { minStart: Infinity, maxEnd: -Infinity, n: 0 }
    window.__inv = {}       // computed fn 源码 -> 失效次数
    window.__invN = 0
    let wrapped = 0
    for (const i of insts) {
      if (!i.render || i.__v656w) continue
      i.__v656w = true
      const nm = nameOf(i)
      const ri = (nm === 'ForecastRow' && i.props && typeof i.props.ri === 'number') ? i.props.ri : null
      const _r = i.render
      i.render = function (...a) {
        window.__rend[nm] = (window.__rend[nm] || 0) + 1
        if (ri !== null) window.__rendRow[ri] = (window.__rendRow[ri] || 0) + 1
        const t0 = performance.now()
        const out = _r.apply(this, a)
        const t1 = performance.now()
        window.__flush.n++
        if (t0 < window.__flush.minStart) window.__flush.minStart = t0
        if (t1 > window.__flush.maxEnd) window.__flush.maxEnd = t1
        return out
      }
      wrapped++
    }
    // Dep 类：从任一 render effect 的 deps 链表取
    let DepClass = null
    for (const i of insts) {
      if (i.effect && i.effect.deps && i.effect.deps.dep) { DepClass = i.effect.deps.dep.constructor; break }
    }
    if (!DepClass) return { error: '找不到 Dep 类', instCount: insts.length }
    const _notify = DepClass.prototype.notify
    DepClass.prototype.notify = function () {
      window.__invN++
      if (this.computed) {
        try {
          const s = (this.computed.fn && this.computed.fn.toString()) || 'computed'
          const key = s.slice(0, 110).replace(/\\n/g, ' ')
          window.__inv[key] = (window.__inv[key] || 0) + 1
        } catch {}
      }
      return _notify.apply(this, arguments)
    }
    return { ok: true, instCount: insts.length, wrapped }
  })()`)
  console.log('阶段A:', JSON.stringify(setup))
  if (setup.error) throw new Error(setup.error)

  /* 阶段 B：聚焦一格 → 等聚焦渲染落定 → 清零计数 → 改一格（+1）→ 等防抖+flush 落定 → 读数 */
  const res = await evalJS(`(async () => {
    const reset = () => {
      window.__rend = {}; window.__rendRow = {}
      window.__flush = { minStart: Infinity, maxEnd: -Infinity, n: 0 }
      window.__inv = {}; window.__invN = 0
    }
    const tbl = document.querySelector('.cross-tbl.edit-tbl')
    const rows = [...tbl.querySelectorAll('tbody tr')]
    const target = rows[5]
    const input = target.querySelector('input.cell-qty')
    if (!input) return { error: '第 6 行无数量输入框' }
    input.focus()
    await new Promise(r => setTimeout(r, 400))
    const rowBefore = input.value
    reset()
    const tDisp = performance.now()
    input.value = String((parseInt(input.value || '0', 10) || 0) + 1)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 500))
    const tEnd = performance.now()
    const rowAfter = input.value
    // 🔴 必须先读数再还原：还原本身会触发第二次 flush，混进来计数就脏了
    // 🔴 且必须浅拷贝：window.__rend/inv 是活对象，还原后仍会继续累加
    const f = window.__flush
    const snap = {
      rowBefore, rowAfter,
      wallMs: +(tEnd - tDisp).toFixed(1),
      flushMs: f.n > 0 ? +(f.maxEnd - f.minStart).toFixed(1) : 0,
      flushN: f.n,
      rend: { ...window.__rend },
      rendRow: { ...window.__rendRow },
      invN: window.__invN,
      inv: { ...window.__inv },
      footAfter: (document.querySelector('.edit-summary .es-txt') || {}).textContent || '',
    }
    // 还原（防生产落库 +1）
    input.value = rowBefore
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    return snap
  })()`, true)

  console.log('\n=== v656 flush 溯源 ===')
  console.log('入口:', entry, '| 格子值:', res.rowBefore, '->', res.rowAfter, '（已还原）')
  console.log('总墙钟:', res.wallMs, 'ms（含 150ms 防抖）')
  console.log('flush 包络:', res.flushMs, 'ms | render 调用总数:', res.flushN)
  console.log('汇总条:', res.footAfter)
  console.log('\n按组件类型的 render 次数:')
  Object.entries(res.rend).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ', k, '×', v))
  const rowKeys = Object.keys(res.rendRow)
  console.log('ForecastRow 重渲染行号（', rowKeys.length, '行）:', rowKeys.slice(0, 20).join(','), rowKeys.length > 20 ? '…' : '')
  console.log('\ncomputed 失效次数（总 notify', res.invN, '次）:')
  Object.entries(res.inv).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ×', v, ':', k))
} catch (e) {
  console.error('FAILED:', e && e.message)
  process.exitCode = 1
} finally {
  cleanup()
}
