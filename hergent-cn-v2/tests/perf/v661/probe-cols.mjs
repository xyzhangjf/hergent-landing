/**
 * v661b 只读：汇总表编辑态里，「门店列」到底是什么（input？值？）+ 「加单」列的值。
 * 目的：确认「分摊结果该回填到哪个格子」——不猜。
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

const udd = path.join(os.tmpdir(), 'hg-p661b-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--no-proxy-server', '--window-size=1600,1000', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }
const log = (s) => console.log('· ' + s)

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
    ['hergent_tenant', '1', false], ['csrf_token', 'p661b' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', path: '/', httpOnly, secure: false, sameSite: 'Lax' })
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`document.body && document.body.innerText.trim().length > 50`, 60000)
  await sleep(2000)
  await waitFor(`!!document.querySelector('.cross-tbl')`, 60000)
  await sleep(1800)
  log('build=' + await evalJS(`window.__HG_BUILD__`))

  await evalJS(`(()=>{const c=[...document.querySelectorAll('button,a,span,div')].filter(el=>/^(改单|编辑报单|修改)$/.test((el.textContent||'').trim())&&el.offsetParent!==null); if(!c.length) return false; c[0].click(); return true})()`)
  await waitFor(`!!document.querySelector('.cross-tbl.edit-tbl')`, 20000)
  await waitFor(`document.querySelectorAll('.cross-tbl.edit-tbl tbody tr').length > 200`)
  await sleep(2500)
  log('编辑态就绪')

  const F = JSON.stringify(PRODUCT)

  // ① 表头：所有 th 的 class + 文本（找出哪些是门店列）
  const heads = await evalJS(`(() => {
    const tbl = document.querySelector('.cross-tbl.edit-tbl')
    const ths = [...tbl.querySelectorAll('thead tr th')]
    return ths.map((th, i) => ({
      i, cls: th.className, text: (th.textContent || '').trim().slice(0, 16),
      colspan: th.colSpan, data: Object.fromEntries([...th.attributes].filter(a=>a.name.startsWith('data')).map(a=>[a.name,a.value])),
    }))
  })()`)
  console.log('\n=== 表头 ===')
  for (const h of heads) console.log('  ' + JSON.stringify(h))

  // ② 目标行：每个 td 的 class + 内容结构
  const cells = await evalJS(`(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${F} })
    if (!tr) return null
    const tds = [...tr.children]
    return {
      ri: tr.getAttribute('data-r'),
      cellCount: tds.length,
      cells: tds.map((td, i) => {
        const inp = td.querySelector('input')
        return {
          i, tag: td.tagName, cls: td.className,
          text: (td.textContent||'').trim().slice(0, 14),
          input: inp ? { v: inp.value, cls: inp.className, type: inp.type } : null,
          btn: !!td.querySelector('button'),
        }
      }),
    }
  })()`)
  if (!cells) throw new Error('没找到目标行')
  console.log('\n=== 目标行 ri=' + cells.ri + ' 单元格数=' + cells.cellCount + ' ===')
  for (const c of cells.cells) console.log('  ' + JSON.stringify(c))

  // ③ 加单格角标与悬停全文
  console.log('\n=== 加单格角标/悬停 ===')
  console.log(JSON.stringify(await evalJS(`(() => {
    const rows = [...document.querySelectorAll('.cross-tbl.edit-tbl tbody tr')]
    const tr = rows.find(r => { const n = r.querySelector('input.cell-name'); return n && (n.value||'').trim() === ${F} })
    const td = tr.querySelector('td.pt-xmtd')
    const b = td.querySelector('.pt-xm-b')
    const tips = [...td.querySelectorAll('.pt-tip i')].map(i => (i.textContent||'').trim())
    const inp = td.querySelector('input.cell-qty')
    return { badge: b ? (b.textContent||'').trim() : null, badgeCls: b ? b.className : null,
             tipLines: tips, inputVal: inp ? inp.value : null, inputTitle: inp ? (inp.title||'') : null,
             tdClass: td.className }
  })()`), null, 2))
  console.log('\n=== 行对象 key（若能取到） ===')
  console.log(JSON.stringify(await evalJS(`(()=>{const t=document.querySelector('.cross-tbl.edit-tbl'); return t? t.className : ''})()`)))
} catch (e) {
  console.error('PROBE ERROR: ' + e.message)
  process.exitCode = 1
} finally {
  cleanup()
}
