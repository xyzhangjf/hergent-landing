/**
 * v655 隔离度探针：把「表尾 + 汇总条」的聚合值抽到 ForecastAgg 子组件后，
 * 父组件（Forecast）在「改一格」时是否还重渲染？
 *
 * 判据：直接包裹 Forecast 组件实例的 render 函数，数它被调用几次。
 *   - 改一格前聚焦并等稳定（换格成本不算），再包 render。
 *   - 输入一格 ⇒ 期望 parentRenders === 0（父不重渲染），touchedRows === 1（只动本行）。
 *   - 同时核对 foot / 汇总条数字确实变化（证明 ForecastAgg 子组件在工作）。
 *
 * 用法：node tests/perf/v655/parent-rerender.mjs [base]
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || process.env.HG_BASE || 'http://127.0.0.1:8901'
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
const udd = path.join(os.tmpdir(), 'hg-p655-' + Date.now())
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
    ['hergent_tenant', '1', false], ['csrf_token', 'p655' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: false, sameSite: 'Lax' })
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`!!document.querySelector('.cross-tbl')`)
  await sleep(1800)

  /* 进入编辑态：**忠实路径优先**（点「改单」走完整守卫链）。
     演示租户可能当前没有进行中的期次（enterEdit 的 noOpenPeriod 守卫会提前 return、
     只 toast 不报错）⇒ 回落 setupState 直驱（**仅 dev 构建可用**，见下）。
     🔴 找组件实例（三条路，按可用性排序）：
       ① 行元素 `__vueParentComponent` 向上走 —— 仅 dev 构建暴露；
       ② **vnode DFS**（`#app._vnode` 起）—— dev/prod 通用，`render()` 无条件写
          `container._vnode`（runtime-core esm-bundler 无门禁）；
       ③ vue-router `matched[].instances.default`。
     类型判据用 `type.__name`（plugin-vue 生成的 `__name:"Forecast"` 选项，**prod 也保留**；
     而 `type.name` 会被 minify 抹掉，`setupState` 在 prod 构建下恒为 EMPTY_OBJ、
      其 key 亦被 mangle —— 两者都不可做判据）。 */
  const FIND_PAGE = `(() => {
    const isForecast = (t) => {
      const nm = t && (t.__name || t.name)
      return nm === 'Forecast'
    }
    // 路①：行元素向上走（dev）
    const trEl0 = document.querySelector('.cross-tbl:not(.edit-tbl) tbody tr') || document.querySelector('.cross-tbl tbody tr')
    if (trEl0 && trEl0.__vueParentComponent) {
      let p = trEl0.__vueParentComponent, guard = 0
      while (p && guard++ < 30) {
        if (isForecast(p.type)) return p
        p = p.parent
      }
    }
    // 路②：vnode DFS（dev/prod 通用）—— element vnode 的 children 也要穿透
    try {
      const el = document.querySelector('#app')
      const dfs = (v, depth) => {
        if (!v || depth > 60) return null
        if (v.component) {
          if (isForecast(v.component.type) && typeof v.component.render === 'function') return v.component
          if (v.component.subTree) { const r = dfs(v.component.subTree, depth + 1); if (r) return r }
        }
        const kids = v.children
        if (Array.isArray(kids)) for (const c of kids) { const r = dfs(c, depth + 1); if (r) return r }
        return null
      }
      if (el && el._vnode) { const r = dfs(el._vnode, 0); if (r) return r }
    } catch (e) { /* 落到路③ */ }
    // 路③：vue-router 的 matched[].instances
    try {
      const app = document.querySelector('#app')
      const router = app && app.__vue_app__ && app.__vue_app__._context && app.__vue_app__._context.config && app.__vue_app__._context.config.globalProperties && app.__vue_app__._context.config.globalProperties.$router
      const matched = router && router.currentRoute && router.currentRoute.value && router.currentRoute.value.matched
      if (matched) {
        for (let i = matched.length - 1; i >= 0; i--) {
          const inst = matched[i].instances && matched[i].instances.default
          if (inst && isForecast(inst.type)) return inst
        }
      }
    } catch (e) { /* null */ }
    return null
  })()`
  let entry = 'ui'
  await evalJS(`(()=>{const c=[...document.querySelectorAll('button,a,span,div')].filter(el=>/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim())&&el.offsetParent!==null); if(!c.length) return false; c[0].click(); return true})()`)
  let inEdit = false
  try {
    await waitFor(`!!document.querySelector('.cross-tbl.edit-tbl')`, 10000)
    inEdit = true
  } catch { /* 忠实路径没进编辑态 ⇒ 回落 */ }
  if (!inEdit) {
    entry = 'setupState-bypass'
    const bypass = await evalJS(`(async () => {
      const p = ${FIND_PAGE}
      if (!p) return { error: '找不到预报页组件实例' }
      // 🔴 prod 构建下 setupState 恒为 EMPTY_OBJ（key 亦被 mangle）⇒ bypass 仅 dev 可用；
      //    prod 上必须走「开放期次 + 忠实路径」，这里明确报错而不是静默失败。
      const ss = p.setupState
      if (!ss || typeof ss.loadEditGrid !== 'function') return { error: 'setupState 不可用（prod 构建不暴露）；需要开放期次走忠实路径' }
      ss.editMode = true
      await ss.loadEditGrid()
      return { ok: true }
    })()`, true)
    if (bypass.error) throw new Error('回落失败: ' + bypass.error)
  }
  await waitFor(`!!document.querySelector('.cross-tbl.edit-tbl')`)
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length > 200`)
  await sleep(2500)

  console.log('build:', await evalJS(`window.__HG_BUILD__`))
  console.log('entry:', entry)
  console.log('行数:', await evalJS(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length`))

  // 阶段 A：找到父组件实例，包裹其 render，置零计数器
  const setup = await evalJS(`(() => {
    const p = ${FIND_PAGE}
    if (!p || typeof p.render !== 'function') return { error: '找不到预报页组件' }
    const chain = [(p.type && (p.type.name || p.type.__name)) || 'anon']
    window.__parentRenders = 0
    const _pr = p.render
    p.render = function (...a) { window.__parentRenders++; return _pr.apply(this, a) }
    // 顺带包裹所有 ForecastAgg 子组件，确认它们确实在重渲染（sanity）
    // 🔴 用 vnode DFS（element 的 children 也要穿透）—— ForecastAgg 在表尾 fragment 里，
    //    实例级「只走 subTree.component + 一层 children」会漏（v655 实测踩过）。
    let aggRenders = 0, aggFound = 0
    const dfsAgg = (v, depth) => {
      if (!v || depth > 60) return
      if (v.component) {
        const nm = v.component.type && (v.component.type.__name || v.component.type.name)
        if (nm === 'ForecastAgg') { aggFound++; const _r = v.component.render; v.component.render = function (...a) { aggRenders++; return _r.apply(this, a) } }
        if (v.component.subTree) dfsAgg(v.component.subTree, depth + 1)
      }
      const kids = v.children
      if (Array.isArray(kids)) for (const c of kids) dfsAgg(c, depth + 1)
    }
    dfsAgg(p.subTree, 0)
    window.__aggRenders0 = aggRenders
    return { ok: true, parentType: (p.type.__name || p.type.name), aggFound, chain }
  })()`)
  console.log('阶段A:', JSON.stringify(setup))
  if (setup.error) throw new Error(setup.error)

  // 阶段 B：聚焦稳定 → 抓基线文本 → 输入一格 → 抓后文本 + 计数器
  const res = await evalJS(`(async () => {
    const tbl = document.querySelector('.cross-tbl.edit-tbl')
    const tbody = tbl.querySelector('tbody')
    const rows = [...tbody.querySelectorAll('tr')]
    const target = rows[5]
    const input = target.querySelector('input.cell-qty')
    if (!input) return { error: '第 6 行无数量输入框' }
    input.focus()
    await new Promise(r => setTimeout(r, 350))

    const touched = new Set()
    let mutations = 0
    const obs = new MutationObserver((list) => {
      for (const m of list) {
        mutations++
        let n = m.target
        if (n.nodeType !== 1) n = n.parentElement
        const tr = n && n.closest ? n.closest('tr') : null
        if (tr) touched.add(tr)
      }
    })
    obs.observe(tbody, { subtree: true, childList: true, characterData: true, attributes: true })

    const footBefore = (document.querySelector('.edit-summary .es-txt') || {}).textContent || ''
    const rowBefore = input.value
    const sumBefore = (document.querySelector('.cross-tbl.edit-tbl .foot-row .num.calc.sum') || {}).textContent || ''

    const t0 = performance.now()
    input.value = String((parseInt(input.value || '0', 10) || 0) + 1)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 400))
    const dt = performance.now() - t0
    obs.disconnect()

    // 先抓 +1 后的后快照（汇总数字应随编辑更新），再做还原
    const footAfter = (document.querySelector('.edit-summary .es-txt') || {}).textContent || ''
    const rowAfter = input.value
    const sumAfter = (document.querySelector('.cross-tbl.edit-tbl .foot-row .num.calc.sum') || {}).textContent || ''

    // 🔴 生产数据保护：无论是否存在自动保存（v652 防抖/失焦兜底），测完立即把值改回原值，
    //    再等一个防抖周期 ⇒ 即使落库也是原值，不留下 +1。
    input.value = rowBefore
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 400))

    return {
      parentRenders: window.__parentRenders || 0,
      footBefore, footAfter,
      rowBefore, rowAfter,
      sumBefore, sumAfter,
      touchedRows: touched.size,
      totalRows: rows.length,
      mutations,
      dt: +dt.toFixed(1),
    }
  })()`, true)

  console.log('\n=== v655 测量结果 ===')
  console.log(JSON.stringify(res, null, 2))
  if (res && !res.error) {
    console.log('\n' + (res.parentRenders === 0 ? '✅ 父组件未重渲染（parentRenders=' + res.parentRenders + '）' : '❌ 父组件仍重渲染 ' + res.parentRenders + ' 次'))
    console.log(res.touchedRows <= 3 ? '✅ 只改本行（touchedRows=' + res.touchedRows + '）' : '❌ 多行被改（touchedRows=' + res.touchedRows + '）')
    console.log(res.footBefore !== res.footAfter ? '✅ 汇总条数字随编辑更新（ForecastAgg 在工作）' : '⚠️ 汇总条数字未变（可能该格不影响合计，或子组件失效）')
  }
} catch (e) {
  console.error('FAILED:', e && e.message)
  process.exitCode = 1
} finally {
  cleanup()
}
