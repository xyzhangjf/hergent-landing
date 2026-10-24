/**
 * v660 复现探针 C：**名册态**（用户 14:35 的走法）。
 *
 * 路径：格子填 100 → 点分摊 → 点「选择承接门店（含没报单的）」→ 勾/取消一家 → 应用
 * 判据：
 *   A  进入名册态后，表格「加单(箱)」列应仍有数（= 100 × 占比）
 *   B  勾一家后，加单列应按新占比重算（不是全 0）
 *   C  应用后汇总表加单格应仍是 100
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

const udd = path.join(os.tmpdir(), 'hg-p660c-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--no-proxy-server', '--proxy-server=direct://', '--proxy-bypass-list=*',
  '--window-size=1440,900', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

const R = { steps: [] }
const log = (s) => { R.steps.push(s); console.log('· ' + s) }

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
    ['hergent_tenant', '1', false], ['csrf_token', 'p660c' + Date.now(), false],
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
  const snapTable = `(() => {
    const trs = [...document.querySelectorAll('.alloc-modal tbody tr')]
    return trs.map(tr => {
      const tds = [...tr.querySelectorAll('td')]
      const ins = [...tr.querySelectorAll('input.alloc-mini')]
      const cb = tr.querySelector('input[type=checkbox]')
      const nameTd = tds.find(td => !td.querySelector('input') && (td.textContent||'').trim())
      return {
        name: nameTd ? (nameTd.textContent||'').trim().replace(/\\s+/g,'').slice(0, 16) : '',
        chk: cb ? (cb.checked ? 1 : 0) : -1,
        ratio: ins[0] ? ins[0].value : null,
        alloc: ins[1] ? ins[1].value : null,
      }
    })
  })()`

  // 填 100
  await evalJS(`(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${F} })
    const qty = tr.querySelector('td.pt-xmtd input.cell-qty')
    qty.focus(); qty.value = '100'
    qty.dispatchEvent(new Event('input', { bubbles: true }))
    qty.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(800)
  log('填 100：' + JSON.stringify(await evalJS(findRow)))

  // 开分摊
  await evalJS(`(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${F} })
    const btn = tr.querySelector('td.pt-xmtd button.pt-alloc-btn')
    btn.click()
  })()`)
  await waitFor(`!!document.querySelector('.alloc-num')`, 20000)
  await sleep(1600)
  R.total0 = await evalJS(`document.querySelector('.alloc-num').value`)
  R.normalRows = await evalJS(snapTable)
  log('普通模式：总量=' + R.total0 + ' 行数=' + R.normalRows.length)
  console.log('   普通: ' + JSON.stringify(R.normalRows.slice(0, 13)))

  // 进入名册态
  const entered = await evalJS(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => /选择承接门店/.test(x.textContent||''))
    if (!b) return false
    b.click(); return true
  })()`)
  log('点「选择承接门店」=' + entered)
  await sleep(2200)
  R.total1 = await evalJS(`document.querySelector('.alloc-num').value`)
  R.pickRows = await evalJS(snapTable)
  log('名册态：总量=' + R.total1 + ' 行数=' + R.pickRows.length)
  console.log('   名册: ' + JSON.stringify(R.pickRows.slice(0, 15)))
  R.pickAllocNonZero = (R.pickRows || []).filter(r => Number(r.alloc) > 0).length
  log('名册态加单列非 0 的行数 = ' + R.pickAllocNonZero)

  // 勾一个没勾的门店
  const toggled = await evalJS(`(() => {
    const trs = [...document.querySelectorAll('.alloc-modal tbody tr')]
    for (const tr of trs) {
      const cb = tr.querySelector('input[type=checkbox]')
      if (cb && !cb.checked) { cb.click(); return true }
    }
    return false
  })()`)
  log('勾一家=' + toggled)
  await sleep(2200)
  R.total2 = await evalJS(`document.querySelector('.alloc-num').value`)
  R.pickRows2 = await evalJS(snapTable)
  R.pickAllocNonZero2 = (R.pickRows2 || []).filter(r => Number(r.alloc) > 0).length
  log('勾选后：总量=' + R.total2 + ' 行数=' + (R.pickRows2 || []).length + ' 加单非0行数=' + R.pickAllocNonZero2)
  console.log('   勾后: ' + JSON.stringify(R.pickRows2.slice(0, 15)))

  // 应用
  const clicked = await evalJS(`(() => {
    const bs = [...document.querySelectorAll('button')].filter(b => /保存本期占比并回填|应用到汇总表/.test((b.textContent||'')))
    if (!bs.length) return 'no-btn'
    const b = bs[0]
    if (b.disabled) return 'disabled'
    b.click(); return 'clicked'
  })()`)
  log('点应用：' + clicked)
  await sleep(2800)
  R.modalGone = await evalJS(`!document.querySelector('.alloc-num')`)
  R.after = await evalJS(findRow)
  log('弹窗关闭=' + R.modalGone + ' 回填后格子=' + JSON.stringify(R.after && R.after.qty))

  console.log('\n==== RESULT ====')
  console.log(JSON.stringify(R, null, 2))
} catch (e) {
  console.error('PROBE ERROR: ' + e.message)
  console.log(JSON.stringify(R, null, 2))
  process.exitCode = 1
} finally {
  cleanup()
}
