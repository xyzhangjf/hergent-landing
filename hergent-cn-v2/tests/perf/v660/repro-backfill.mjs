/**
 * v660 复现探针：用户「分摊数量没有回填」。
 *
 * 用户实际路径（生产 access log 还原）：
 *   14:35:03 setup(37,1475)+preview → 多次 preview（勾选/改占比）
 *   → 14:36:54 PUT extra-alloc/override 200（点「保存本期占比并回填」）
 *   → 之后无 save-matrix（加单量从未落库）
 *
 * 本探针只做**读 + 一次 override（可恢复）**，绝不点汇总表「保存」。
 * 事后用 prep_v660.py restore 还原 period37/product1475 的 alloc_ratio 10 行。
 *
 * 判据：
 *   A  加单格填 100 ⇒ 分摊弹窗「本期加单总量」应等于 100
 *   B  弹窗表格「加单(箱)」列应有数（= 100 × 各自占比）
 *   C  点「保存本期占比并回填」后弹窗关闭，**汇总表该行加单格仍应是 100**
 *      —— 若变成 0/空，即复现用户报的「没有回填」
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

const udd = path.join(os.tmpdir(), 'hg-p660-' + Date.now())
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
    ['hergent_tenant', '1', false], ['csrf_token', 'p660' + Date.now(), false],
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
  R.build = await evalJS(`window.__HG_BUILD__`)
  log('build=' + R.build)

  // 进编辑态
  await evalJS(`(()=>{const c=[...document.querySelectorAll('button,a,span,div')].filter(el=>/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim())&&el.offsetParent!==null); if(!c.length) return false; c[0].click(); return true})()`)
  await waitFor(`!!document.querySelector('.cross-tbl.edit-tbl')`, 20000)
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length > 200`)
  await sleep(2500)
  log('编辑态就绪')

  // 找目标行
  const F = JSON.stringify(PRODUCT)
  const findRow = `(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${F} })
    if (!tr) return null
    const qty = tr.querySelector('td.pt-xmtd input.cell-qty')
    const btn = tr.querySelector('td.pt-xmtd button.pt-alloc-btn')
    return { hasQty: !!qty, qty: qty ? qty.value : null, hasBtn: !!btn, ri: tr.getAttribute('data-r') }
  })()`
  R.before = await evalJS(findRow)
  if (!R.before) throw new Error('网格里没找到商品：' + PRODUCT)
  log('打开前：加单格=' + JSON.stringify(R.before.qty) + ' 有分摊按钮=' + R.before.hasBtn)

  // 填 100（忠实路径：先填加单量）
  await evalJS(`(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${F} })
    const qty = tr.querySelector('td.pt-xmtd input.cell-qty')
    qty.focus(); qty.value = '100'
    qty.dispatchEvent(new Event('input', { bubbles: true }))
    qty.dispatchEvent(new Event('change', { bubbles: true }))
    return qty.value
  })()`)
  await sleep(700)
  R.afterFill = await evalJS(findRow)
  log('填 100 后：加单格=' + JSON.stringify(R.afterFill.qty) + ' 有分摊按钮=' + R.afterFill.hasBtn)

  // 点分摊
  await evalJS(`(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${F} })
    const btn = tr.querySelector('td.pt-xmtd button.pt-alloc-btn')
    if (!btn) return false
    btn.click(); return true
  })()`)
  await waitFor(`!!document.querySelector('.alloc-num')`, 20000)
  await sleep(1500)
  log('弹窗已打开')

  const snapModal = `(() => {
    const num = document.querySelector('.alloc-num')
    const trs = [...document.querySelectorAll('.alloc-modal tbody tr, [class*=alloc] tbody tr')]
    const rows = trs.map(tr => {
      const tds = [...tr.querySelectorAll('td')]
      const ins = [...tr.querySelectorAll('input.alloc-mini')]
      return {
        name: (tds[tds.length >= 5 && tr.querySelector('input[type=checkbox]') ? 1 : 0] || {}).textContent?.trim().slice(0, 14) || '',
        ratio: ins[0] ? ins[0].value : null,
        alloc: ins[1] ? ins[1].value : null,
        picked: !!tr.querySelector('input[type=checkbox]')?.checked,
      }
    })
    const btns = [...document.querySelectorAll('.alloc-modal button, [class*=alloc] button')].map(b => (b.textContent||'').trim()).filter(Boolean)
    return { total: num ? num.value : null, rows, btns }
  })()`
  R.modal = await evalJS(snapModal)
  log('弹窗：总量=' + JSON.stringify(R.modal.total) + ' 表行=' + R.modal.rows.length)
  console.log('   行明细: ' + JSON.stringify(R.modal.rows.slice(0, 12)))
  console.log('   按钮: ' + JSON.stringify(R.modal.btns))

  // 点「保存本期占比并回填」
  const clicked = await evalJS(`(() => {
    const bs = [...document.querySelectorAll('button')].filter(b => /保存本期占比并回填|应用到汇总表/.test((b.textContent||'')))
    if (!bs.length) return 'no-btn'
    const b = bs[0]
    if (b.disabled) return 'disabled'
    b.click(); return 'clicked'
  })()`)
  log('点应用：' + clicked)
  await sleep(2500)

  R.modalGone = await evalJS(`!document.querySelector('.alloc-num')`)
  R.after = await evalJS(findRow)
  log('弹窗关闭=' + R.modalGone + ' 回填后加单格=' + JSON.stringify(R.after && R.after.qty))

  console.log('\n==== RESULT ====')
  console.log(JSON.stringify(R, null, 2))
} catch (e) {
  console.error('PROBE ERROR: ' + e.message)
  console.log(JSON.stringify(R, null, 2))
  process.exitCode = 1
} finally {
  cleanup()
}
