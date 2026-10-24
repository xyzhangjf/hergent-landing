/**
 * v669 诊断（只量不改）：列设置面板的两个报告问题。
 *   ① 全屏模式下开列设置 ⇒ 面板被遮挡？
 *   ② 取消勾选某列 ⇒ 勾选状态不刷新？
 *
 * 手法：页面内实测 —— 面板 rect / elementFromPoint（谁在最上面）/ checkbox.checked 时序采样。
 * 用法：node diag-colmenu.mjs [base] [w] [h]
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'https://hergent.cn'
const VW = Number(process.argv[3] || 1440)
const VH = Number(process.argv[4] || 780)
const OUT_DIR = path.dirname(new URL(import.meta.url).pathname)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class PipeCDP {
  constructor (w, r) {
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
  send (method, params = {}, sessionId, timeout = 180000) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)) }, timeout)
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v) }, reject: (e) => { clearTimeout(t); reject(e) } })
      this.w.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }
}

const TOKEN = fs.readFileSync(path.join(OUT_DIR, '.tmp-token-v669'), 'utf8').trim()
const udd = path.join(os.tmpdir(), 'hg-v669d-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  `--window-size=${VW},${VH + 120}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

try {
  const cdp = new PipeCDP(chrome.stdio[3], chrome.stdio[4])
  let created = null
  for (let i = 0; i < 30; i++) {
    try { created = await cdp.send('Target.createTarget', { url: 'about:blank' }, undefined, 8000); break } catch { await sleep(400) }
  }
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const S = (m, p = {}, t = 180000) => cdp.send(m, p, sessionId, t)
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable')
  await S('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false })

  const evalJS = async (expr, awaitPromise = false) => {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise, userGesture: true })
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result?.value
  }
  const waitFor = async (expr, timeout = 120000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if (await evalJS(`(()=>{try{return !!(${expr})}catch(e){return false}})()`) === true) return true
      await sleep(120)
    }
    throw new Error('waitFor 超时: ' + expr)
  }

  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'fl' + Date.now(), false],
  ]) {
    await S('Network.setCookie', { name, value, url: BASE + '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
  }
  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`!!document.querySelector('.cross-tbl')`)
  await waitFor(`window.__hgProductsGridReady > 0`, 90000)
  await sleep(1500)
  console.log('[build]', await evalJS(`window.__HG_BUILD__`), '视口', VW, '×', VH)

  // 页面内工具：面板诊断
  await evalJS(`window.__diag = () => {
    const menu = document.querySelector('.col-menu')
    if (!menu) return { menu: null }
    const b = menu.getBoundingClientRect()
    const cs = getComputedStyle(menu)
    // 面板中心 / 顶部 / 底部三点命中了谁
    const hit = (x, y) => {
      const el = document.elementFromPoint(x, y)
      if (!el) return 'null'
      const inMenu = menu.contains(el)
      return (inMenu ? 'MENU:' : 'OTHER:') + el.tagName.toLowerCase() + '.' + [...el.classList].join('.')
    }
    const cx = Math.round(b.left + b.width / 2)
    return {
      rect: { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height) },
      style: { z: cs.zIndex, pos: cs.position, maxH: cs.maxHeight, overflow: cs.overflow },
      inline: menu.getAttribute('style'),
      innerH: window.innerHeight, innerW: window.innerWidth,
      hitTop: hit(cx, Math.round(b.top + 8)),
      hitMid: hit(cx, Math.round(b.top + b.height / 2)),
      hitBottom: hit(cx, Math.round(b.bottom - 8)),
      // 祖先里谁建立了 containing block / 裁剪
      ancestors: (() => {
        const out = []
        let el = menu.parentElement
        while (el && el !== document.documentElement) {
          const s = getComputedStyle(el)
          const tag = el.tagName.toLowerCase() + '.' + [...el.classList].slice(0, 2).join('.')
          const marks = []
          if (s.transform !== 'none') marks.push('transform=' + s.transform)
          if (s.filter !== 'none') marks.push('filter=' + s.filter)
          if (s.willChange !== 'auto') marks.push('willChange=' + s.willChange)
          if (s.contain !== 'none') marks.push('contain=' + s.contain)
          if (s.overflow !== 'visible') marks.push('overflow=' + s.overflow)
          if (s.position !== 'static') marks.push('pos=' + s.position + '/z=' + s.zIndex)
          if (marks.length) out.push(tag + ' { ' + marks.join(' ') + ' }')
          el = el.parentElement
        }
        return out
      })(),
    }
  }`)

  // ── ① 普通态开列设置 ──────────────────────────────────────────
  console.log('\n=========== ① 普通态（非全屏）===========')
  const openGear = `(async () => {
    const g = [...document.querySelectorAll('.col-cfg.gear')].filter(el => el.offsetParent !== null)[0]
    if (!g) return { error: '找不到齿轮' }
    g.click()
    await new Promise(r => setTimeout(r, 500))
    return { clicked: true }
  })()`
  console.log(await evalJS(openGear, true))
  console.log(JSON.stringify(await evalJS(`window.__diag()`), null, 1))

  // ── ② 勾选状态时序 ───────────────────────────────────────────
  console.log('\n=========== ② 取消勾选某列后的勾选状态时序 ===========')
  const toggleTrace = await evalJS(`(async () => {
    const menu = document.querySelector('.col-menu')
    if (!menu) return { error: '面板没开' }
    const boxes = [...menu.querySelectorAll('input[type=checkbox]')].filter(b => !b.disabled)
    if (!boxes.length) return { error: '没有可勾选的列' }
    const box = boxes[0]
    const li = box.closest('li')
    const label = li ? li.innerText.trim() : '?'
    const before = { checked: box.checked, liHidden: li ? li.classList.contains('hidden') : null }
    box.click()
    const s0 = { checked: box.checked }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const s1 = { checked: box.checked, liHidden: li ? li.classList.contains('hidden') : null }
    await new Promise(r => setTimeout(r, 400))
    const after = { checked: box.checked, liHidden: li ? li.classList.contains('hidden') : null, sameNode: document.contains(box) }
    // 列是否真的从表里消失（功能是否生效）
    const ths = [...document.querySelectorAll('.cross-tbl thead th')].map(t => (t.innerText || '').trim()).join('|')
    return { label, before, s0, s1, after, thSample: ths.slice(0, 200) }
  })()`, true)
  console.log(JSON.stringify(toggleTrace, null, 1))

  // 关掉面板，再开一次，看勾选态是否会「补上」
  await evalJS(`(async () => { document.querySelector('.col-menu-x')?.click(); await new Promise(r=>setTimeout(r,300));
    const g = [...document.querySelectorAll('.col-cfg.gear')].filter(el=>el.offsetParent!==null)[0]; g && g.click();
    await new Promise(r=>setTimeout(r,500)); })()`, true)
  const reopen = await evalJS(`(() => {
    const menu = document.querySelector('.col-menu')
    if (!menu) return { error: '重开失败' }
    const boxes = [...menu.querySelectorAll('input[type=checkbox]')].filter(b => !b.disabled)
    return boxes.slice(0, 4).map(b => ({ label: (b.closest('li')?.innerText || '').trim(), checked: b.checked }))
  })()`)
  console.log('重开后前 4 项:', JSON.stringify(reopen))
  await evalJS(`(async () => { document.querySelector('.col-menu-x')?.click(); await new Promise(r=>setTimeout(r,300)) })()`, true)

  // ── ③ 全屏态开列设置 ─────────────────────────────────────────
  console.log('\n=========== ③ 全屏态 ===========')
  const fsStep = await evalJS(`(async () => {
    const b = document.querySelector('.grid-fs-btn')
    if (!b) return { error: '找不到全屏按钮' }
    b.click()
    await new Promise(r => setTimeout(r, 900))
    const area = document.querySelector('.grid-area')
    const gs = [...document.querySelectorAll('.col-cfg.gear')].filter(el => el.offsetParent !== null)
    return { isFs: !!document.querySelector('.grid-area.is-fs'), gearCount: gs.length,
             gearRect: gs[0] ? (() => { const r = gs[0].getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), bottom: Math.round(r.bottom) } })() : null,
             areaZ: area ? getComputedStyle(area).zIndex : null }
  })()`, true)
  console.log(JSON.stringify(fsStep))

  const fsOpen = await evalJS(`(async () => {
    const g = [...document.querySelectorAll('.col-cfg.gear')].filter(el => el.offsetParent !== null)[0]
    if (!g) return { error: '全屏下找不到齿轮' }
    g.click()
    await new Promise(r => setTimeout(r, 600))
    return { ok: true }
  })()`, true)
  console.log(JSON.stringify(fsOpen))
  console.log(JSON.stringify(await evalJS(`window.__diag()`), null, 1))

  const shot = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(OUT_DIR, `diag-fs-${VW}x${VH}.png`), Buffer.from(shot.data, 'base64'))
  console.log('\n截图已存 diag-fs-' + VW + 'x' + VH + '.png')
} catch (e) {
  console.error('ERR', e.message)
} finally {
  cleanup()
}
