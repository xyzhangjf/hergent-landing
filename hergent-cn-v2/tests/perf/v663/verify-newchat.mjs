/**
 * v663 真机验收：AI 副驾「新对话」按钮必须常驻在标题栏，不再藏在历史会话面板里。
 *
 * 用户 2026-10-24：「AI副驾新对话按键藏在历史会话里，当时已经修复了，但现在又回退了」。
 * 查实：那版修复（2026-10-21 构建 Shell-BLfJ9bAV.js）从未进 git，源码里没有 ⇒
 *       2026-10-24 我们整份 assets 同步（v661/v662）把它覆盖回了旧实现。
 *
 * 本探针判据全部是 DOM 事实，不看文案猜测：
 *   A 按钮存在于 `.cp-actions`（标题栏）、`.closest('.cp-hist')` 必须为 null、可见、文案「新对话」
 *   B 点它 ⇒ 消息清空（.msg 数 0）且历史面板关闭
 *   C 副驾已开着时按 Ctrl+Shift+O ⇒ 同样落到空白新对话
 *   D 副驾关着时按 Ctrl+Shift+O ⇒ 抽屉打开且是空白新对话（不恢复历史）
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://127.0.0.1:8903'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOKEN = process.argv[3] || fs.readFileSync(path.join(HERE, '.tmp-token-v663'), 'utf8').trim()
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

const udd = path.join(os.tmpdir(), 'hg-p663-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--no-proxy-server', '--window-size=1600,1000', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

const R = { pass: [], fail: [], steps: [] }
const log = (s) => { R.steps.push(s); console.log('· ' + s) }
const ok = (cond, name, extra) => {
  if (cond) { R.pass.push(name); console.log('  ✅ ' + name + (extra ? '  ' + extra : '')) }
  else { R.fail.push(name + (extra ? '  ' + extra : '')); console.log('  ❌ ' + name + (extra ? '  ' + extra : '')) }
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
  const waitFor = async (expr, timeout = 60000) => {
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
  /* 发真实按键：Ctrl(2) + Shift(8) = 10 */
  const key = async (k, code, vk, modifiers) => {
    await S('Input.dispatchKeyEvent', { type: 'keyDown', modifiers, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: k })
    await S('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
    await sleep(900)
  }

  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'p663' + Date.now(), false],
  ]) {
    const r = await S('Network.setCookie', { name, value, url: BASE + '/', path: '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
    if (!r || r.success !== true) log('!! setCookie 失败 ' + name)
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`document.body && document.body.innerText.trim().length > 50`, 60000)
  await sleep(2000)
  const build = await evalJS(`window.__HG_BUILD__ || document.documentElement.getAttribute('data-build')`)
  log('build=' + build)
  ok(String(build) === 'v663', '构建号 = v663', String(build))

  // ---- 打开副驾：Ctrl+K ----
  await key('k', 'KeyK', 75, 2)
  await waitFor(`!!document.querySelector('.cp-drawer, .cp-root, [class*="cp-"]')`, 20000).catch(() => {})
  await waitFor(`!!document.querySelector('.cp-new-btn')`, 20000)
  await sleep(600)

  // ---- A 按钮位置与可见性（DOM 事实，不看文案）----
  const A = await evalJS(`(() => {
    const b = document.querySelector('.cp-new-btn')
    if (!b) return { exists: false }
    const r = b.getBoundingClientRect()
    return {
      exists: true,
      inHist: !!b.closest('.cp-hist'),
      inActions: !!b.closest('.cp-actions'),
      visible: b.offsetParent !== null && r.width > 0 && r.height > 0,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      text: (b.textContent || '').trim(),
      title: b.getAttribute('title') || '',
      histPanelOpen: !!document.querySelector('.cp-hist'),
      btnCount: document.querySelectorAll('.cp-new-btn').length,
    }
  })()`)
  log('A=' + JSON.stringify(A))
  ok(A.exists === true, '标题栏存在「新对话」按钮')
  ok(A.inActions === true, '按钮在标题栏 .cp-actions 内')
  ok(A.inHist === false, '按钮不在历史会话面板 .cp-hist 内')
  ok(A.visible === true, '按钮可见（有宽高、offsetParent 非空）')
  ok(A.text === '新对话', '按钮文案 = 新对话', JSON.stringify(A.text))
  ok(/另起一段新对话/.test(A.title), 'title 带「另起一段新对话」', JSON.stringify(A.title))
  ok(A.histPanelOpen === false, '打开副驾时历史面板默认不展开（按钮就该在这时可用）')
  await shoot('v663-1-header.png')

  // ---- B 打开一个历史会话，再点按钮 ⇒ 空白新对话 ----
  await evalJS(`(()=>{const b=[...document.querySelectorAll('.cp-icon-btn')].find(x=>x.getAttribute('title')==='历史会话'); if(b){b.click();return true} return false})()`)
  await sleep(1200)
  const histCount = await evalJS(`document.querySelectorAll('.cp-hist-item').length`)
  log('历史会话条数=' + histCount)
  if (histCount > 0) {
    await evalJS(`(()=>{const it=document.querySelector('.cp-hist-item'); it && it.click(); return true})()`)
    await sleep(2500)
  }
  const before = await evalJS(`({msgs: document.querySelectorAll('.cp-body .msg').length, hist: !!document.querySelector('.cp-hist')})`)
  log('点按钮前=' + JSON.stringify(before))

  /* B 的判别力补强：历史会话如果是空的（演示租户常见），上面那一步其实是在「空对话」上
     点按钮 —— 清不清都一样，测不出东西。这里用「查看示例经营卡」在**本地**压两条消息
     （showDemo 只 push 进 store，不请求服务端），再点按钮，才有真正的「有→无」对照。 */
  await evalJS(`(()=>{const b=document.querySelector('.cp-demo'); if(b){b.click();return true} return false})()`)
  await sleep(1200)
  const demoMsgs = await evalJS(`document.querySelectorAll('.cp-body .msg').length`)
  log('压入示例消息后 msgs=' + demoMsgs)
  ok(demoMsgs > 0, '【前置】示例经营卡已压入消息（B 才有判别力）', 'msgs=' + demoMsgs)

  // 按钮在标题栏，历史面板打开时也还在 ⇒ 直接点它
  const clicked = await evalJS(`(()=>{const b=document.querySelector('.cp-new-btn'); if(!b) return false; b.click(); return true})()`)
  await sleep(1500)
  const after = await evalJS(`({
    msgs: document.querySelectorAll('.cp-body .msg').length,
    hist: !!document.querySelector('.cp-hist'),
    welcome: !!document.querySelector('.cp-welcome'),
    focusInInput: !!document.activeElement && document.activeElement.tagName === 'TEXTAREA',
  })`)
  log('点按钮后=' + JSON.stringify(after))
  ok(clicked === true, '标题栏按钮可点击')
  ok(after.msgs === 0, '点「新对话」后消息清空', 'msgs=' + after.msgs)
  ok(after.hist === false, '点「新对话」后历史面板自动收起')
  ok(after.welcome === true, '落到空白引导页（.cp-welcome）')
  await shoot('v663-2-after-click.png')

  // ---- C 已开着时按 Ctrl+Shift+O ----
  if (histCount > 0) {
    await evalJS(`(()=>{const b=[...document.querySelectorAll('.cp-icon-btn')].find(x=>x.getAttribute('title')==='历史会话'); b&&b.click(); return true})()`)
    await sleep(1000)
    await evalJS(`(()=>{const it=document.querySelector('.cp-hist-item'); it&&it.click(); return true})()`)
    await sleep(2200)
  }
  // 同样先压消息，让「有→无」可观察
  await evalJS(`(()=>{const b=document.querySelector('.cp-demo'); if(b){b.click();return true} return false})()`)
  await sleep(1000)
  const cBefore = await evalJS(`document.querySelectorAll('.cp-body .msg').length`)
  ok(cBefore > 0, '【前置】C 之前已有消息（快捷键才有判别力）', 'msgs=' + cBefore)
  await key('o', 'KeyO', 79, 10)   // Ctrl+Shift
  const cAfter = await evalJS(`({msgs: document.querySelectorAll('.cp-body .msg').length, open: !!document.querySelector('.cp-new-btn')})`)
  log('C 前=' + cBefore + ' 后=' + JSON.stringify(cAfter))
  ok(cAfter.msgs === 0, '⌘/Ctrl+Shift+O（抽屉已开）⇒ 换到空白新对话', 'msgs=' + cAfter.msgs)
  ok(cAfter.open === true, '快捷键后抽屉仍开着')

  // ---- D 关着时按 Ctrl+Shift+O ----
  await evalJS(`(()=>{const b=[...document.querySelectorAll('.cp-icon-btn')].find(x=>x.getAttribute('title')==='关闭'); b&&b.click(); return true})()`)
  await sleep(1200)
  const dClosed = await evalJS(`!document.querySelector('.cp-new-btn')`)
  log('D 抽屉已关=' + dClosed)
  await key('o', 'KeyO', 79, 10)
  const dAfter = await evalJS(`({open: !!document.querySelector('.cp-new-btn'), msgs: document.querySelectorAll('.cp-body .msg').length})`)
  log('D 后=' + JSON.stringify(dAfter))
  ok(dAfter.open === true, '抽屉关着时按快捷键 ⇒ 直接打开')
  ok(dAfter.msgs === 0, '快捷键从关闭态打开 ⇒ 空白新对话（不恢复历史）', 'msgs=' + dAfter.msgs)
  await shoot('v663-3-shortcut.png')

  // 窄屏：文案收起、按钮仍在
  await S('Emulation.setDeviceMetricsOverride', { width: 700, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(700)
  const narrow = await evalJS(`(() => {
    const b = document.querySelector('.cp-new-btn'); if (!b) return { exists: false }
    const r = b.getBoundingClientRect()
    const tx = b.querySelector('.cp-new-tx')
    return { exists: true, w: Math.round(r.width), visible: b.offsetParent !== null && r.width > 0, txHidden: tx ? getComputedStyle(tx).display === 'none' : null }
  })()`)
  log('窄屏=' + JSON.stringify(narrow))
  ok(narrow.exists === true && narrow.visible === true, '窄屏下按钮仍可见（收成图标）', 'w=' + narrow.w)
  ok(narrow.txHidden === true, '窄屏下文案收起（space 不够）')
  await shoot('v663-4-narrow.png')
  await S('Emulation.clearDeviceMetricsOverride')

  console.log('\n================ 结果 ================')
  console.log('PASS ' + R.pass.length + ' / FAIL ' + R.fail.length)
  R.fail.forEach((f) => console.log('  ❌ ' + f))
  process.exitCode = R.fail.length ? 1 : 0
} catch (e) {
  console.error('探针异常:', e.message)
  process.exitCode = 2
} finally {
  cleanup()
}
