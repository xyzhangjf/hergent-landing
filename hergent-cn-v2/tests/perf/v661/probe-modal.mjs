/**
 * v661 只读探针：分摊弹窗里「加单(箱)」列到底显示了什么。
 *
 * 用户 2026-10-24（第二次）「还是没有回填」。
 * 库事实：forecast_extra_qty[1475]=10；forecast_extra_alloc 4 行 alloc_box=2.5（合计 10）。
 * 后端 setup/preview 实测全对（每店 2.5，final 5.5/5.5/2.5/8.5）。
 * ⇒ 本探针**只读**：只打开/关闭弹窗、读 DOM、截图。不填数、不点保存、不点应用。
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://localhost:8901'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOKEN = process.argv[3] || fs.readFileSync(path.join(HERE, '.tmp-token-v661'), 'utf8').trim()
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

const udd = path.join(os.tmpdir(), 'hg-p661-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--no-proxy-server',
  '--window-size=1600,1000', 'about:blank',
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
  const shoot = async (name) => {
    const r = await S('Page.captureScreenshot', { format: 'png' })
    const f = path.join(HERE, name)
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'))
    log('截图 ' + f)
  }

  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'p661' + Date.now(), false],
  ]) {
    // 只给 url、不给 domain（两者同时给时 CDP 会按 domain 匹配而落不上）
    const r = await S('Network.setCookie', { name, value, url: BASE + '/', path: '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
    if (!r || r.success !== true) log('!! setCookie 失败 ' + name + ' => ' + JSON.stringify(r))
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' })
  // 判据用 body 文本（生产 #app 的 innerHTML 长度可能为 0，见 v661 探针日志）
  await waitFor(`document.body && document.body.innerText.trim().length > 50`, 60000)
  await sleep(1500)
  R.cookies = '(skipped)'
  R.allCookies = (await S('Network.getAllCookies')).cookies.map(x => x.name + '@' + x.domain)
  log('cookies=' + JSON.stringify(R.allCookies))
  R.me = await evalJS(`fetch('/api/auth/me',{credentials:'include'}).then(r=>r.status+' '+r.statusText).catch(e=>'ERR '+e.message)`, true)
  log('auth/me => ' + R.me)
  R.gotAuth = await evalJS(`!String(location.hash||'').startsWith('#/login')`)
  log('登录态=' + R.gotAuth + ' hash=' + await evalJS(`location.hash`))
  await evalJS(`(()=>{ const h=location.hash||''; if(!h.startsWith('#/forecast')){ location.hash='#/forecast' } })()`)
  await sleep(2500)
  R.hrefAfter = await evalJS(`location.href`)
  R.bodySnip = await evalJS(`(document.body?document.body.innerText:'').slice(0,300)`)
  log('href=' + R.hrefAfter)
  log('body=' + JSON.stringify(R.bodySnip))
  try { await waitFor(`!!document.querySelector('.cross-tbl')`, 20000) }
  catch (e) {
    R.dbg = await evalJS(`JSON.stringify({hash:location.hash, tbls:document.querySelectorAll('table').length, cross:document.querySelectorAll('.cross-tbl').length, txt:(document.body.innerText||'').slice(0,500)})`)
    log('DBG=' + R.dbg)
    throw e
  }
  await sleep(2000)
  R.build = await evalJS(`window.__HG_BUILD__ || document.documentElement.getAttribute('data-build')`)
  log('build=' + R.build)

  // 进编辑态
  await evalJS(`(()=>{const c=[...document.querySelectorAll('button,a,span,div')].filter(el=>/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim())&&el.offsetParent!==null); if(!c.length) return false; c[0].click(); return true})()`)
  await waitFor(`!!document.querySelector('.cross-tbl.edit-tbl')`, 20000)
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length > 200`)
  await sleep(2500)
  log('编辑态就绪')

  const F = JSON.stringify(PRODUCT)
  const findRow = `(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${F} })
    if (!tr) return null
    const qty = tr.querySelector('td.pt-xmtd input.cell-qty')
    const btn = tr.querySelector('td.pt-xmtd button.pt-alloc-btn')
    return { qty: qty ? qty.value : null, hasBtn: !!btn }
  })()`
  R.gridRow = await evalJS(findRow)
  log('汇总表该行：加单格=' + JSON.stringify(R.gridRow && R.gridRow.qty) + ' 有分摊按钮=' + (R.gridRow && R.gridRow.hasBtn))
  await shoot('v661-1-grid.png')

  // 打开分摊弹窗（只读）
  await evalJS(`(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${F} })
    const btn = tr.querySelector('td.pt-xmtd button.pt-alloc-btn')
    if (!btn) return false
    btn.click(); return true
  })()`)
  await waitFor(`!!document.querySelector('.alloc-num')`, 20000)
  await sleep(2500)
  log('弹窗已打开')
  await shoot('v661-2-modal.png')

  // 逐行 dump：把每个单元格的文本与 input 值都拿出来（不依赖类名猜列）
  R.modal = await evalJS(`(() => {
    const total = document.querySelector('.alloc-num')
    const box = document.querySelector('.alloc-modal')
    if (!box) return { err: 'no .alloc-modal' }
    const trs = [...box.querySelectorAll('tbody tr')]
    const rows = trs.map((tr, i) => {
      const tds = [...tr.querySelectorAll('td')]
      return {
        i,
        cells: tds.map(td => {
          const inp = td.querySelector('input')
          if (inp) return { input: inp.value, cls: inp.className, type: inp.type, checked: inp.checked === true ? true : undefined }
          return { text: (td.textContent || '').trim().slice(0, 20) }
        }),
      }
    })
    return {
      totalInput: total ? total.value : null,
      headers: [...box.querySelectorAll('thead th')].map(th => (th.textContent||'').trim()),
      rows,
      summaryText: (box.querySelector('.alloc-sum, .imp-ft, .alloc-foot') || {}).textContent?.trim().slice(0, 300) || '',
      buttons: [...box.querySelectorAll('button')].map(b => ({ t: (b.textContent||'').trim(), disabled: b.disabled })),
    }
  })()`)
  log('弹窗 totalInput=' + JSON.stringify(R.modal.totalInput) + ' 行数=' + (R.modal.rows || []).length)
  console.log('\n表头: ' + JSON.stringify(R.modal.headers))
  for (const r of (R.modal.rows || [])) console.log('  行' + r.i + ': ' + JSON.stringify(r.cells))
  console.log('\n按钮: ' + JSON.stringify(R.modal.buttons))

  // 关闭（不保存）
  await evalJS(`(()=>{const x=document.querySelector('.imp-x'); if(x){x.click();return true} return false})()`)
  await sleep(800)
  R.closed = await evalJS(`!document.querySelector('.alloc-num')`)
  log('已关闭（未保存）=' + R.closed)

  console.log('\n==== RESULT ====')
  console.log(JSON.stringify({ build: R.build, gridRow: R.gridRow, totalInput: R.modal.totalInput, rows: R.modal.rows, buttons: R.modal.buttons }, null, 2))
} catch (e) {
  console.error('PROBE ERROR: ' + e.message)
  console.log(JSON.stringify(R, null, 2))
  process.exitCode = 1
} finally {
  cleanup()
}
