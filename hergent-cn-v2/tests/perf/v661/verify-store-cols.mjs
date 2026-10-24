/**
 * v661c 验收：分摊结果是否叠加到「门店列」。
 *
 * 用户 2026-10-24：「还是没有回填」→ 补问确认 = **各门店列要显示最终量**
 * （东津报 3 箱 + 分到 2.5 箱 ⇒ 那格显示 5.5 箱 = 55 桶）。
 *
 * 只读：只打开页面 + 读 DOM，不改任何数据。
 * 判据：
 *   A 门店列：该商品分到量的门店，格子值 = 报量 + 分摊（按 perCase 换算）
 *   B 合计(小单位) 含分摊（= 各门店列之和）
 *   C 合计(箱) 含分摊
 *   D 最终下单 **不重复**计加单（= 合计(箱)，而不是 合计(箱)+加单）
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://127.0.0.1:8901'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOKEN = fs.readFileSync(path.join(HERE, '.tmp-token-v661'), 'utf8').trim()
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

const udd = path.join(os.tmpdir(), 'hg-p661c-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--no-proxy-server', '--window-size=1600,1000', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }
const log = (s) => console.log('· ' + s)
let FAIL = 0
const chk = (cond, name, detail = '') => {
  console.log((cond ? '  ✅ ' : '  🔴 ') + name + (detail ? '  —— ' + detail : ''))
  if (!cond) FAIL++
}

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
    fs.writeFileSync(path.join(HERE, name), Buffer.from(r.data, 'base64'))
    log('截图 ' + name)
  }

  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'p661c' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', path: '/', httpOnly, secure: false, sameSite: 'Lax' })
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`document.body && document.body.innerText.trim().length > 50`, 60000)
  await sleep(2000)
  await waitFor(`!!document.querySelector('.cross-tbl')`, 60000)
  await sleep(2500)
  log('build=' + await evalJS(`window.__HG_BUILD__`))

  await evalJS(`(()=>{const c=[...document.querySelectorAll('button,a,span,div')].filter(el=>/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim())&&el.offsetParent!==null); if(!c.length) return false; c[0].click(); return true})()`)
  await waitFor(`!!document.querySelector('.cross-tbl.edit-tbl')`, 20000)
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length > 200`)
  await sleep(3000)

  // 表头门店名（qty-th 那一排，取 footer 的 th 文案或第一行表头的 data-c 映射）
  const F = JSON.stringify(PRODUCT)
  const snap = await evalJS(`(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${F} })
    if (!tr) return null
    const tds = [...tr.children]
    const qtyCells = tds.filter(td => td.classList.contains('qty-cell')).map((td, i) => {
      const inp = td.querySelector('input')
      return { i, c: td.getAttribute('data-c'), v: inp ? inp.value : null }
    })
    const extraTd = tr.querySelector('td.pt-xmtd')
    const finalTd = tr.querySelector('td.calc.final')
    const sumTd = tr.querySelector('td.calc.sum')
    const boxTd = tr.querySelector('td.calc.boxes')
    return {
      qtyCells,
      extra: extraTd ? (extraTd.querySelector('input') || {}).value : null,
      sum: sumTd ? (sumTd.textContent||'').trim() : null,
      boxes: boxTd ? (boxTd.textContent||'').trim() : null,
      final: finalTd ? (finalTd.textContent||'').trim() : null,
      badge: (tr.querySelector('.pt-xm-b') || {}).textContent || null,
    }
  })()`)
  if (!snap) throw new Error('没找到目标行')
  console.log('\n=== 目标行 ===')
  console.log('  门店列: ' + JSON.stringify(snap.qtyCells))
  console.log('  加单=' + snap.extra + '  合计(小单位)=' + snap.sum + '  合计(箱)=' + snap.boxes + '  最终下单=' + snap.final + '  角标=' + snap.badge)

  // 门店名：从表头 th 取（qty-th 的 title/文本，或 footer）
  const heads = await evalJS(`(() => {
    const ths = [...document.querySelectorAll('.cross-tbl.edit-tbl thead th')]
    return ths.filter(th => th.classList.contains('qty-th')).map((th,i) => ({ i, txt: (th.textContent||'').trim(), title: th.title||'', c: th.getAttribute('data-c') }))
  })()`)
  console.log('  门店表头: ' + JSON.stringify(heads))
  await shoot('v661c-grid.png')

  // 判据
  const nonzero = snap.qtyCells.filter(x => Number(x.v) > 0)
  chk(snap.qtyCells.length > 0, 'A1 门店列存在', snap.qtyCells.length + ' 列')
  chk(/^5\.5|^55/.test(String(snap.qtyCells.find(x => x.v === '55') ? '55' : '')), 'A2 有门店格显示 55（3箱+2.5箱）',
      '非零格：' + JSON.stringify(nonzero))
  chk(Number(String(snap.sum).replace(/,/g, '')) === 220, 'B 合计(小单位)=220（120 报量 + 100 分摊）', '实际 ' + snap.sum)
  chk(Number(String(snap.boxes).replace(/,/g, '')) === 22, 'C 合计(箱)=22', '实际 ' + snap.boxes)
  chk(Number(String(snap.final).replace(/,/g, '')) === 22, 'D 最终下单=22（加单不重复计）', '实际 ' + snap.final)

  console.log(FAIL === 0 ? '\n==== ALL PASS ====' : `\n==== ${FAIL} 项未过 ====`)
  if (FAIL) process.exitCode = 1
} catch (e) {
  console.error('PROBE ERROR: ' + e.message)
  process.exitCode = 1
} finally {
  cleanup()
}
