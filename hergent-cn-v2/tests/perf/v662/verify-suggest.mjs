/**
 * v662 只读探针：补货建议（审核台）改口径后的真机验收。
 *
 * 背景：用户 2026-10-24「补单建议明细不合理，数字大得吓死人」。
 * 生产实测旧口径 = 日均 × 9 天覆盖 + 日均×7 安全库存 = 16 天量，且 1841（桶）标成「件」。
 * 本版改为：建议 = 日均 × 到货间隔 2 天 − 库存；安全库存只作下限；按件显示 + 括注小单位；
 *           「到货前缺口」单独一列，不计入建议量。
 *
 * 本探针**只读**：导航、点「补货建议」、读 DOM、截图、关闭。不填数、不定稿、不保存。
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://127.0.0.1:8901'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOKEN = process.argv[3] || fs.readFileSync(path.join(HERE, '.tmp-token-v662'), 'utf8').trim()
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

const udd = path.join(os.tmpdir(), 'hg-p662-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--no-proxy-server', '--window-size=1600,1000', 'about:blank',
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
    ['hergent_tenant', '1', false], ['csrf_token', 'p662' + Date.now(), false],
  ]) {
    const r = await S('Network.setCookie', { name, value, url: BASE + '/', path: '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
    if (!r || r.success !== true) log('!! setCookie 失败 ' + name + ' => ' + JSON.stringify(r))
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`document.body && document.body.innerText.trim().length > 50`, 60000)
  await sleep(1500)
  await waitFor(`!!document.querySelector('.cross-tbl')`, 30000)
  await sleep(2000)
  R.build = await evalJS(`window.__HG_BUILD__ || document.documentElement.getAttribute('data-build')`)
  log('build=' + R.build)
  const hash = await evalJS(`location.hash`)
  log('hash=' + hash)

  // ① 主表「建议(件)」列改前状态
  R.suggestBefore = await evalJS(`(() => {
    const th = [...document.querySelectorAll('.cross-tbl thead th')].find(t => (t.textContent||'').includes('建议'))
    const tds = [...document.querySelectorAll('.cross-tbl tbody tr td.suggest')].slice(0, 5).map(td => (td.textContent||'').trim())
    return { thLabel: th ? (th.textContent||'').trim() : null, first5: tds }
  })()`)
  log('建议列表头=' + JSON.stringify(R.suggestBefore))

  // ② 点「补货建议」
  const clicked = await evalJS(`(() => {
    const els = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null && (b.textContent||'').includes('补货建议'))
    if (!els.length) return 'NOT_FOUND'
    els[0].click(); return els[0].textContent.trim()
  })()`)
  log('点击「补货建议」=> ' + clicked)
  await waitFor(`!!document.querySelector('.audit-modal')`, 40000)
  await waitFor(`!document.querySelector('.audit-modal .imp-tip') || !!document.querySelector('.audit-modal .audit-sum')`, 40000)
  await sleep(1200)

  // ③ 弹窗读数
  R.dialog = await evalJS(`(() => {
    const m = document.querySelector('.audit-modal')
    if (!m) return null
    const sum = m.querySelector('.audit-sum')
    const fml = m.querySelector('.audit-formula')
    const cells = [...m.querySelectorAll('.audit-sum span')].map(s => (s.textContent||'').trim())
    const rows = [...m.querySelectorAll('table.tbl tbody tr')].map(tr => {
      const tds = [...tr.querySelectorAll('td')]
      return tds.map(td => {
        const inp = td.querySelector('input')
        return inp ? '[' + inp.value + ']' : (td.innerText || '').replace(/\\s+/g, ' ').trim()
      })
    })
    const heads = [...m.querySelectorAll('table.tbl thead th')].map(th => (th.textContent||'').trim())
    return {
      title: (m.querySelector('.imp-hd b')||{}).textContent || '',
      sumText: sum ? sum.innerText.replace(/\\s+/g, ' ').trim() : null,
      sumItems: cells,
      formula: fml ? fml.innerText.replace(/\\s+/g, ' ').trim() : null,
      heads, rows,
      fresh: (m.querySelector('.audit-fresh')||{}).innerText ? m.querySelector('.audit-fresh').innerText.replace(/\\s+/g,' ').trim() : null,
    }
  })()`)
  log('弹窗标题=' + JSON.stringify(R.dialog?.title))
  log('汇总=' + JSON.stringify(R.dialog?.sumText))
  log('公式=' + JSON.stringify(R.dialog?.formula))
  log('表头=' + JSON.stringify(R.dialog?.heads))
  for (const r of (R.dialog?.rows || [])) log('  行: ' + JSON.stringify(r))
  await shoot('v662-1-dialog.png')

  // ④ 关闭弹窗后回读主表建议列（应已由 audited 事件回填）
  await evalJS(`(() => { const b=[...document.querySelectorAll('.audit-modal .imp-x')]; if(b.length) b[0].click(); return true })()`)
  await sleep(1500)
  R.suggestAfter = await evalJS(`(() => {
    const th = [...document.querySelectorAll('.cross-tbl thead th')].find(t => (t.textContent||'').includes('建议'))
    // 按商品名定位本期有报单的 3 个 SKU（前 5 行是"全部商品"里的别的货，恒为「—」是正确行为）
    const names = ['蒙牛红枣酸牛奶1000g*10桶', '简爱酸奶滑滑100g*6杯*8组', '蒙牛大果粒草莓三角杯260g*24杯']
    const out = []
    const trs = [...document.querySelectorAll('.cross-tbl tbody tr')]
    for (const n of names) {
      const tr = trs.find(r => (r.innerText || '').includes(n))
      if (!tr) { out.push({ name: n, found: false }); continue }
      const s = tr.querySelector('td.suggest')
      out.push({ name: n, found: true, suggestText: s ? (s.innerText || '').trim() : null, title: s ? s.getAttribute('title') : null })
    }
    return { thLabel: th ? (th.textContent||'').trim() : null, rows: out,
             first5: [...document.querySelectorAll('.cross-tbl tbody tr td.suggest')].slice(0, 5).map(td => (td.textContent||'').trim()) }
  })()`)
  log('回填后建议列=' + JSON.stringify(R.suggestAfter))
  await shoot('v662-2-grid.png')

  console.log('\n===== RESULT JSON =====')
  console.log(JSON.stringify(R, null, 2))
} catch (e) {
  console.error('ERR: ' + e.message)
  console.log(JSON.stringify(R, null, 2))
  process.exitCode = 1
} finally {
  cleanup()
}
