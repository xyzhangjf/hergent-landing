/**
 * v660 验收：总量为 0 时**不再静默回填 0**。
 *
 * 判据：
 *   A  打开弹窗（格子 0）⇒ 光标自动落在「本期加单总量」、顶部黄条出现、按钮文案 = 只保存占比
 *   B  此时点按钮 ⇒ 弹窗**不关闭** + warn toast 说明「没有任何数量可回填」+ 格子仍 0
 *   C  在总量框填 100 ⇒ 按钮文案变回「保存本期占比并回填」
 *   D  再点 ⇒ 弹窗关闭 + 格子 = 100（回填真正生效）
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://localhost:8901'
const HERE = path.dirname(new URL(import.meta.url).pathname)
const TOKEN = fs.readFileSync(path.join(HERE, '.tmp-token-v660'), 'utf8').trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PRODUCT = '蒙牛红枣酸牛奶1000g*10桶'
const FAIL = []
const ok = (cond, name, detail = '') => {
  console.log((cond ? '  ✅ ' : '  🔴 ') + name + (detail ? '  —— ' + detail : ''))
  if (!cond) FAIL.push(name)
}

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

const udd = path.join(os.tmpdir(), 'hg-p660d-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--no-proxy-server', '--proxy-server=direct://', '--proxy-bypass-list=*',
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
    ['hergent_tenant', '1', false], ['csrf_token', 'p660d' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', domain: 'localhost', path: '/', httpOnly, secure: false, sameSite: 'Lax' })
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`(!!document.querySelector('#app') && document.querySelector('#app').children.length>0) || !!window.__HG_BUILD__`, 60000)
  await sleep(1500)
  await evalJS(`(()=>{ const h=location.hash||''; if(!h.startsWith('#/forecast')){ location.hash='#/forecast' } })()`)
  await sleep(2500)
  await waitFor(`!!document.querySelector('.cross-tbl')`, 60000)
  await sleep(1800)
  const build = await evalJS(`window.__HG_BUILD__`)
  ok(build === 'v660', 'A0 构建号 = v660', String(build))

  await evalJS(`(()=>{const c=[...document.querySelectorAll('button,a,span,div')].filter(el=>/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim())&&el.offsetParent!==null); if(!c.length) return false; c[0].click(); return true})()`)
  await waitFor(`!!document.querySelector('.cross-tbl.edit-tbl')`, 20000)
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length > 200`)
  await sleep(2500)

  const F = JSON.stringify(PRODUCT)
  const findRow = `(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${F} })
    if (!tr) return null
    const qty = tr.querySelector('td.pt-xmtd input.cell-qty')
    return { qty: qty ? qty.value : null }
  })()`
  const btnText = `(() => { const b=[...document.querySelectorAll('button')].find(x=>/保存本期占比并回填|应用到汇总表|只保存占比/.test(x.textContent||'')); return b?(b.textContent||'').trim():null })()`

  // 格子清 0（模拟用户没填加单量）
  await evalJS(`(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${F} })
    const qty = tr.querySelector('td.pt-xmtd input.cell-qty')
    qty.focus(); qty.value = '0'
    qty.dispatchEvent(new Event('input', { bubbles: true }))
    qty.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(600)
  const zero = await evalJS(findRow)
  ok(zero && zero.qty === '0', 'A1 格子已清 0', JSON.stringify(zero))

  // 开弹窗
  await evalJS(`(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${F} })
    tr.querySelector('td.pt-xmtd button.pt-alloc-btn').click()
  })()`)
  await waitFor(`!!document.querySelector('.alloc-num')`, 20000)
  await sleep(1800)

  const d1 = await evalJS(`(() => {
    const warns = [...document.querySelectorAll('.alloc-modal .warn-text')].map(e => (e.textContent||'').replace(/\\s+/g,''))
    const ae = document.activeElement
    return {
      total: (document.querySelector('.alloc-num')||{}).value,
      warn: warns.join(' || '),
      focused: ae ? (ae.className||'') : '',
      focusedIsTotal: !!(ae && /alloc-num/.test(ae.className||'')),
    }
  })()`)
  ok(d1.warn.includes('不会产生任何分摊数量'), 'A2 顶部黄条提示「不会产生任何分摊数量」', d1.warn.slice(0, 60))
  ok(d1.focusedIsTotal, 'A3 光标自动落在「本期加单总量」框', d1.focused)
  const t1 = await evalJS(btnText)
  ok(/只保存占比/.test(t1 || ''), 'A4 按钮文案 = 只保存占比（未填数量）', String(t1))

  // B：总量 0 点保存 ⇒ 不关窗 + warn toast
  await evalJS(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => /只保存占比|保存本期占比并回填/.test(x.textContent||''))
    if (b && !b.disabled) b.click()
  })()`)
  await sleep(2000)
  const b1 = await evalJS(`(() => {
    const modal = !!document.querySelector('.alloc-num')
    const toasts = [...document.querySelectorAll('[class*=toast],[class*=Toast],[class*=msg]')].map(e=>(e.textContent||'').replace(/\\s+/g,'')).join(' || ')
    return { modal, toasts: toasts.slice(0, 300) }
  })()`)
  ok(b1.modal === true, 'B1 总量 0 点保存后弹窗**不关闭**', 'modal=' + b1.modal)
  ok(/没有任何数量可回填/.test(b1.toasts), 'B2 出现 warn 提示「没有任何数量可回填」', b1.toasts.slice(0, 80))
  const gridStill0 = await evalJS(findRow)
  ok(gridStill0 && gridStill0.qty === '0', 'B3 汇总表格子仍是 0（没有写脏值）', JSON.stringify(gridStill0))

  // C：总量填 100
  await evalJS(`(() => {
    const el = document.querySelector('.alloc-num')
    el.focus(); el.value = '100'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(1800)
  const t2 = await evalJS(btnText)
  ok(/保存本期占比并回填/.test(t2 || ''), 'C1 填 100 后按钮文案恢复「保存本期占比并回填」', String(t2))
  const allocVals = await evalJS(`[...document.querySelectorAll('input.alloc-mini')].map(i=>i.value)`)
  ok(allocVals.filter(v => Number(v) > 0).length >= 3, 'C2 表格「加单(箱)」列出现数字', JSON.stringify(allocVals.slice(0, 12)))

  // D：再点 ⇒ 关窗 + 回填 100
  await evalJS(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => /保存本期占比并回填/.test(x.textContent||''))
    if (b && !b.disabled) b.click()
  })()`)
  await sleep(3000)
  const gone = await evalJS(`!document.querySelector('.alloc-num')`)
  const after = await evalJS(findRow)
  ok(gone === true, 'D1 弹窗已关闭', 'gone=' + gone)
  ok(after && after.qty === '100', 'D2 汇总表加单格回填 100（回填真正生效）', JSON.stringify(after))
} catch (e) {
  console.error('PROBE ERROR: ' + e.message)
  FAIL.push('EXCEPTION: ' + e.message)
} finally {
  cleanup()
  console.log('\nRESULT: ' + (FAIL.length ? 'FAILED 🔴 ' + JSON.stringify(FAIL) : 'ALL PASS ✅'))
  process.exitCode = FAIL.length ? 1 : 0
}
