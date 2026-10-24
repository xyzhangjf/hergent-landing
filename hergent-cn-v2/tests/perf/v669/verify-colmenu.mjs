/**
 * v669 验收：预报页列设置面板的两个缺陷。
 *   ① 全屏模式下开列设置，面板必须**浮在全屏层之上**且完整落在视口内；
 *   ② 真实鼠标取消勾选某列后，勾选状态必须**当帧**就与列显隐一致（不再需要重开面板）。
 *
 * 两个问题的根因（production v668 实测，详见 diag-*.mjs）：
 *   ① `.col-menu` 挂在 `.cross-card` 里，而全屏层 `.grid-area.is-fs` 是 `position:fixed;inset:0;z-index:1000`
 *      ⇒ 面板的 610/611 被整块盖住（elementFromPoint 三点全命中 `div.pname`）。改为变量表的 1100/1101 档。
 *   ② Chrome 的 pre-click activation：真实鼠标点击时 `checked` 在派发 click **之前**就被翻转，
 *      `@click.prevent` 让浏览器在派发结束后把翻转**还原**——而 Vue 的 patch 只写翻转前的值，
 *      还原之后再无 patch ⇒ `input.checked` 恒为旧值，只有重开面板（v-if 重建节点）才对。
 *      改 `@change`（不 prevent）+ nextTick 按状态回写。
 *
 * ⚠️ 探针自身两个坑（第一版踩过，别再踩）：
 *   · 必须挑「坐标上真的命中 input」的条目 —— 列清单是 `overflow:auto`，行滚出可视区后
 *     rect 仍算得出来但点击会落到下面的 `.col-menu-add`（实测命中 `span.cm-label`，事件 0 条）。
 *   · 首次访问会自动展开快捷键浮层 `.kbd-pop`（z 1250）盖住面板 ⇒ 量之前先把它关掉，
 *     否则会把「用户自己打开的帮助浮层」误判成「列设置被遮挡」。
 *
 * 用法：node verify-colmenu.mjs [base] [w] [h]
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://127.0.0.1:8910'
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
const udd = path.join(os.tmpdir(), 'hg-v669v-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  `--window-size=${VW},${VH + 120}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅', msg) } else { fail++; console.log('  ❌', msg) } }

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
  const realClick = async (x, y) => {
    await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 })
    await S('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
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

  // ── 页面内工具 ───────────────────────────────────────────────
  await evalJS(`
    window.__hit = () => {
      const m = document.querySelector('.col-menu')
      if (!m) return { exists: false }
      const b = m.getBoundingClientRect()
      const cx = Math.round(b.left + b.width / 2)
      const at = (y) => { const el = document.elementFromPoint(cx, Math.round(y)); return el ? (m.contains(el) ? 'MENU' : 'OTHER:' + el.tagName.toLowerCase() + '.' + [...el.classList].join('.')) : 'null' }
      const cs = getComputedStyle(m)
      return { exists: true,
        rect: { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) },
        inViewport: b.left >= 0 && b.top >= 0 && b.right <= window.innerWidth && b.bottom <= window.innerHeight,
        z: cs.zIndex, maxH: cs.maxHeight,
        top: at(b.top + 8), mid: at(b.top + b.height / 2), bot: at(b.bottom - 8) }
    }
    window.__ov = () => {
      const o = document.querySelector('.col-menu-overlay')
      return o ? { exists: true, z: getComputedStyle(o).zIndex } : { exists: false }
    }
    /** 关掉首次自动展开的快捷键浮层（它的 z 1250，会盖住面板，属"用户自己打开的帮助层"） */
    window.__killKbd = () => {
      const p = document.querySelector('.kbd-pop')
      if (!p) return false
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
    }
    /** 挑一个「已勾选/未勾选、未禁用、且坐标真的命中 input」的条目 */
    window.__pick = (wantChecked) => {
      const m = document.querySelector('.col-menu')
      if (!m) return { error: '面板没开' }
      const list = m.querySelector('.col-menu-list')
      if (list) list.scrollTop = 0
      const boxes = [...m.querySelectorAll('input[type=checkbox]')].filter(b => !b.disabled && b.checked === wantChecked)
      const usable = []
      for (const box of boxes) {
        const r = box.getBoundingClientRect()
        const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2)
        if (document.elementFromPoint(cx, cy) !== box) continue
        const li = box.closest('li')
        const lab = li.querySelector('label')
        const lr = lab.getBoundingClientRect()
        // label 文字落点也要在可视区内（否则点击会落到别的层）
        const tx = Math.round(lr.right - 14), ty = Math.round(lr.top + lr.height / 2)
        const hitT = document.elementFromPoint(tx, ty)
        usable.push({ box, li, cx, cy, tx, ty, labelHitOk: !!(hitT && lab.contains(hitT)) })
      }
      if (!usable.length) return { error: '没有可用条目 wantChecked=' + wantChecked + ' 候选=' + boxes.length }
      const u = usable[0]
      window.__box = u.box
      return { label: (u.li.innerText || '').replace(/\\s+/g, ' ').trim(),
               x: u.cx, y: u.cy, lx: u.tx, ly: u.ty, labelHitOk: u.labelHitOk,
               checked: u.box.checked, hidden: u.li.classList.contains('hidden'),
               thCount: document.querySelectorAll('.cross-tbl thead th').length }
    }
    window.__state = () => {
      const b = window.__box, li = b.closest('li')
      return { checked: b.checked, hidden: li.classList.contains('hidden'),
               inDom: document.contains(b),
               thCount: document.querySelectorAll('.cross-tbl thead th').length }
    }`)

  const openMenu = () => evalJS(`(async () => {
    const g = [...document.querySelectorAll('.col-cfg.gear')].filter(el => el.offsetParent !== null)[0]
    if (!g) return { error: '没有齿轮' }
    g.click(); await new Promise(r => setTimeout(r, 500))
    window.__killKbd(); await new Promise(r => setTimeout(r, 300))
    return window.__hit()
  })()`, true)
  const closeMenu = () => evalJS(`(async () => { document.querySelector('.col-menu-x')?.click(); await new Promise(r => setTimeout(r, 320)) })()`, true)

  // ── ① 非全屏回归 ─────────────────────────────────────────────
  console.log('\n=== ① 非全屏：面板姿态（回归）===')
  const g1 = await openMenu()
  console.log('  ', JSON.stringify(g1))
  ok(g1.exists === true, '面板已打开')
  ok(g1.top === 'MENU' && g1.mid === 'MENU' && g1.bot === 'MENU', `三点命中均为面板（top=${g1.top} mid=${g1.mid} bot=${g1.bot}）`)
  ok(g1.inViewport === true, `面板完整落在视口内 ${JSON.stringify(g1.rect)}`)
  ok(g1.z === '1101', `面板 z-index = ${g1.z}（期望 1101 = --z-page-menu）`)
  ok((await evalJS(`window.__ov()`)).z === '1100', '遮罩 z-index = 1100（--z-page-overlay）')

  // ── ② 反向：先勾上（未勾选 → 勾选）──────────────────────────
  console.log('\n=== ② 真实鼠标「勾上」：状态同步 ===')
  const p1 = await evalJS(`window.__pick(false)`)
  console.log('  目标列:', p1.label, '→ 点前', JSON.stringify({ checked: p1.checked, hidden: p1.hidden, thCount: p1.thCount }))
  ok(p1.checked === false && p1.hidden === true, '候选列初始为「未勾选 + 已隐藏」')
  await realClick(p1.x, p1.y)
  await sleep(120)
  const m2 = await evalJS(`window.__state()`)
  await sleep(500)
  const s2 = await evalJS(`window.__state()`)
  ok(m2.checked === true && s2.checked === true, `点击后 120ms/620ms 的 checked = ${m2.checked}/${s2.checked}（必须 true）`)
  ok(s2.hidden === false, `li.hidden = ${s2.hidden}（列已显示）`)
  ok(s2.thCount === p1.thCount + 1, `表头列数 ${p1.thCount} → ${s2.thCount}（+1）`)
  ok((await evalJS(`!!document.querySelector('.col-menu')`)) === true, '点复选框后面板保持打开')

  // ── ③ 正向：取消勾选（用户报的那一步）──────────────────────
  console.log('\n=== ③ 真实鼠标「取消勾选」：状态必须立刻同步 ===')
  await realClick(p1.x, p1.y)
  await sleep(120)
  const m3 = await evalJS(`window.__state()`)
  await sleep(500)
  const s3 = await evalJS(`window.__state()`)
  ok(m3.checked === false && s3.checked === false, `点击后 120ms/620ms 的 checked = ${m3.checked}/${s3.checked}（必须 false）`)
  ok(s3.hidden === true, `li.hidden = ${s3.hidden}（列确实被隐藏 = 功能生效）`)
  ok(s3.checked === !s3.hidden, `勾选态与显隐一致（checked=${s3.checked} / hidden=${s3.hidden}）`)
  ok(s3.thCount === p1.thCount, `表头列数回到 ${s3.thCount}（列真的从表里消失）`)

  // ── ④ 点 label 文字（热区更大，用户更常走这条）──────────────
  console.log('\n=== ④ 点 label 文字：同样同步 ===')
  await realClick(p1.lx, p1.ly)
  await sleep(620)
  const s4 = await evalJS(`window.__state()`)
  ok(s4.checked === true && s4.hidden === false, `点文字勾上：checked=${s4.checked} hidden=${s4.hidden}`)
  await realClick(p1.lx, p1.ly)
  await sleep(620)
  const s5 = await evalJS(`window.__state()`)
  ok(s5.checked === false && s5.hidden === true, `点文字取消：checked=${s5.checked} hidden=${s5.hidden}`)
  ok(s5.thCount === p1.thCount, `表头列数 ${s5.thCount}`)

  // ── ⑤ 全屏：面板浮在全屏层之上 ──────────────────────────────
  console.log('\n=== ⑤ 全屏：面板不被全屏层遮挡 ===')
  await closeMenu()
  const fs1 = await evalJS(`(async () => {
    const b = document.querySelector('.grid-fs-btn')
    b.click(); await new Promise(r => setTimeout(r, 900))
    const g = [...document.querySelectorAll('.col-cfg.gear')].filter(el => el.offsetParent !== null)
    if (!g.length) return { error: '全屏下没有齿轮' }
    g[0].click(); await new Promise(r => setTimeout(r, 600))
    window.__killKbd(); await new Promise(r => setTimeout(r, 300))
    return { isFs: !!document.querySelector('.grid-area.is-fs'), gears: g.length }
  })()`, true)
  const g5 = await evalJS(`window.__hit()`)
  console.log('  ', JSON.stringify(fs1), JSON.stringify(g5))
  ok(fs1.isFs === true, '已进入全屏（.grid-area.is-fs 存在）')
  ok(g5.exists === true, '全屏下点击齿轮能打开面板')
  ok(g5.top === 'MENU' && g5.mid === 'MENU' && g5.bot === 'MENU', `全屏下三点命中均为面板（top=${g5.top} mid=${g5.mid} bot=${g5.bot}）`)
  ok(g5.inViewport === true, `全屏下面板完整在视口内 ${JSON.stringify(g5.rect)}`)
  ok(g5.z === '1101', `全屏下面板 z = ${g5.z} 高于全屏层 1000`)

  // ── ⑥ 判别力自证：遮罩+面板一起打回旧值 610/611 ─────────────
  console.log('\n=== ⑥ 判别力自证（遮罩/面板 z 打回 610/611 = 修复前）===')
  const neg = await evalJS(`(() => {
    const m = document.querySelector('.col-menu')
    const o = document.querySelector('.col-menu-overlay')
    m.style.zIndex = '611'
    if (o) o.style.zIndex = '610'
    const b = m.getBoundingClientRect()
    const cx = Math.round(b.left + b.width / 2)
    const at = (y) => { const el = document.elementFromPoint(cx, Math.round(y)); return el ? (m.contains(el) ? 'MENU' : 'OTHER:' + el.tagName.toLowerCase() + '.' + [...el.classList].join('.')) : 'null' }
    const r = { top: at(b.top + 8), mid: at(b.top + b.height / 2), bot: at(b.bottom - 8) }
    m.style.zIndex = ''
    if (o) o.style.zIndex = ''
    return r
  })()`)
  console.log('  ', JSON.stringify(neg))
  ok(neg.mid !== 'MENU' && neg.top !== 'MENU', `回注 610/611 后中点/顶部不再命中面板（mid=${neg.mid}）⇒ 探针量得出遮挡`)

  // ── ⑦ 全屏下点空白处关闭（遮罩也抬升了）────────────────────
  console.log('\n=== ⑦ 全屏下点空白处关闭面板 ===')
  await sleep(200)
  ok((await evalJS(`window.__ov()`)).z === '1100', '全屏下遮罩 z = 1100')
  await realClick(Math.round(VW - 30), Math.round(VH - 24))
  await sleep(450)
  ok((await evalJS(`!!document.querySelector('.col-menu')`)) === false, '点空白处面板已关闭（遮罩生效）')

  // ── ⑧ 全屏下勾选同步 ────────────────────────────────────────
  console.log('\n=== ⑧ 全屏下勾选同步 ===')
  const p8 = await evalJS(`(async () => {
    document.querySelector('.col-menu') || [...document.querySelectorAll('.col-cfg.gear')].filter(el => el.offsetParent !== null)[0].click()
    await new Promise(r => setTimeout(r, 600))
    window.__killKbd(); await new Promise(r => setTimeout(r, 200))
    return window.__pick(false)
  })()`, true)
  if (p8.error) { ok(false, '全屏下取不到可点条目：' + p8.error) } else {
    await realClick(p8.x, p8.y)
    await sleep(620)
    const s8 = await evalJS(`window.__state()`)
    ok(s8.checked === true && s8.hidden === false, `全屏下勾上：checked=${s8.checked} hidden=${s8.hidden}`)
    ok(s8.thCount === p8.thCount + 1, `全屏下表头列数 ${p8.thCount} → ${s8.thCount}`)
    await realClick(p8.x, p8.y)
    await sleep(620)
    const s8b = await evalJS(`window.__state()`)
    ok(s8b.checked === false && s8b.hidden === true, `全屏下取消勾选：checked=${s8b.checked} hidden=${s8b.hidden}`)
    ok(s8b.thCount === p8.thCount, `表头列数回到 ${s8b.thCount}`)
  }

  // 截图（全屏 + 面板打开）
  const shot = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(OUT_DIR, `v669-fs-${VW}x${VH}.png`), Buffer.from(shot.data, 'base64'))

  // ── ⑨ 改单态面板（另一份 .col-menu）─────────────────────────
  console.log('\n=== ⑨ 改单态面板（.edit-col-menu）勾选同步 ===')
  await closeMenu()
  await evalJS(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await new Promise(r => setTimeout(r, 1000))
    const btn = [...document.querySelectorAll('button,a')].filter(el => el.offsetParent !== null && /^改单$/.test((el.textContent || '').trim()))[0]
    if (btn) btn.click()
    await new Promise(r => setTimeout(r, 2600))
    window.__killKbd(); await new Promise(r => setTimeout(r, 300))
  })()`, true)
  const inEdit = await evalJS(`!!document.querySelector('.cross-tbl.edit-tbl')`)
  if (inEdit) {
    const g9 = await evalJS(`(async () => {
      const g = [...document.querySelectorAll('.col-cfg.gear')].filter(el => el.offsetParent !== null)
      if (!g.length) return { error: '改单态没有齿轮' }
      g[0].click(); await new Promise(r => setTimeout(r, 700))
      window.__killKbd(); await new Promise(r => setTimeout(r, 300))
      return window.__hit()
    })()`, true)
    console.log('  ', JSON.stringify(g9))
    ok(g9.exists === true, '改单态能打开面板')
    ok(g9.top === 'MENU' && g9.mid === 'MENU' && g9.bot === 'MENU', `改单态三点命中均为面板（${g9.top}/${g9.mid}/${g9.bot}）`)
    const p9 = await evalJS(`window.__pick(false)`)
    if (p9.error) { ok(false, '改单态取不到可点条目：' + p9.error) } else {
      await realClick(p9.x, p9.y)
      await sleep(620)
      const s9 = await evalJS(`window.__state()`)
      ok(s9.checked === true && s9.hidden === false, `改单态勾上：checked=${s9.checked} hidden=${s9.hidden}`)
      await realClick(p9.x, p9.y)
      await sleep(620)
      const s9b = await evalJS(`window.__state()`)
      ok(s9b.checked === false && s9b.hidden === true, `改单态取消勾选：checked=${s9b.checked} hidden=${s9b.hidden}`)
    }
    await closeMenu()
    await evalJS(`(async () => {
      const c = [...document.querySelectorAll('button,a')].filter(el => el.offsetParent !== null && /^(取消|取消改单)$/.test((el.textContent || '').trim()))[0]
      if (c) c.click()
      await new Promise(r => setTimeout(r, 1200))
      const d = [...document.querySelectorAll('button')].filter(el => el.offsetParent !== null && /^(放弃|不保存|确定)$/.test((el.textContent || '').trim()))[0]
      if (d) d.click()
      await new Promise(r => setTimeout(r, 900))
    })()`, true)
  } else {
    console.log('  ⚠️ 未进入改单态，跳过该段')
  }

  // ── ⑩ 收尾：全表一致性 + 恢复默认可见性 ─────────────────────
  console.log('\n=== ⑩ 收尾：面板内一致性 + 恢复默认（全勾）===')
  const fin = await evalJS(`(async () => {
    if (!document.querySelector('.col-menu')) {
      const g = [...document.querySelectorAll('.col-cfg.gear')].filter(el => el.offsetParent !== null)
      if (g.length) { g[0].click(); await new Promise(r => setTimeout(r, 600)) }
    }
    const m = document.querySelector('.col-menu')
    if (!m) return { error: '打不开面板' }
    const rows = () => [...m.querySelectorAll('li')].map(li => { const b = li.querySelector('input'); return { label: (li.innerText||'').replace(/\\s+/g,' ').trim(), checked: b.checked, hidden: li.classList.contains('hidden') } })
    // 恢复默认：把所有未禁用的条目都勾上（= 默认全显示）
    for (const li of [...m.querySelectorAll('li')]) {
      const b = li.querySelector('input')
      if (b.disabled || b.checked) continue
      b.click()
      await new Promise(r => setTimeout(r, 120))
    }
    await new Promise(r => setTimeout(r, 500))
    const rs = rows()
    return { rows: rs,
             inconsistent: rs.filter(r => r.checked === r.hidden).map(r => r.label),
             unchecked: rs.filter(r => !r.checked && !/商品名称/.test(r.label)).map(r => r.label),
             thCount: document.querySelectorAll('.cross-tbl thead th').length }
  })()`, true)
  console.log('  条目:', JSON.stringify((fin.rows || []).map(r => r.label + (r.checked ? '✓' : '✗'))))
  ok((fin.inconsistent || []).length === 0, `所有条目「勾选态 == 显隐」（不一致 ${JSON.stringify(fin.inconsistent || fin.error)}）`)
  ok((fin.unchecked || []).length === 0, `已恢复为默认（全部勾选）… 未勾: ${JSON.stringify(fin.unchecked)}`)

  console.log(`\n================ RESULT: ${fail === 0 ? 'ALL PASS' : 'FAILED(' + fail + ')'}  pass=${pass} fail=${fail} ================`)
} catch (e) {
  console.error('ERR', e.message)
  fail++
} finally {
  cleanup()
  process.exit(fail === 0 ? 0 : 1)
}
