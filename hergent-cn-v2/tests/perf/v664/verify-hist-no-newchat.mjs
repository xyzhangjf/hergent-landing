/**
 * v664 真机验收：历史会话面板里那个重复的「＋ 新对话」按钮已删除，标题栏入口仍在。
 *
 * 用户 2026-10-24：「历史会话里的那个"新对话"按钮可以删掉了」。
 * 前情：v663 把「新对话」做成标题栏常驻按钮后，历史面板头部还留着 v488 时代那个
 *       同一动作的 `＋ 新对话` ⇒ 两个入口做同一件事 = 冗余。
 *
 * 判据全部是 DOM 事实（不看文案、不看 class 名以外的猜测）：
 *   A 打开历史面板：`.cp-hist-hd` 内 button 数 = 0，且 .cp-hist 内无任何按钮文案含「新对话」
 *   B 历史面板里按钮总数 == 历史条数（每条只有 1 个删除按钮），没有多余按钮
 *   C 标题栏 `.cp-new-btn` 仍在 `.cp-actions` 内、唯一、可见（v663 能力不被误伤）
 *   D 标题栏按钮仍能开新对话（点后 msgs 0 → 落到空白引导页）
 *   E ⌘/Ctrl+Shift+O 仍可用（历史面板开着时按也能换新对话）
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://127.0.0.1:8904'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOKEN = process.argv[3] || fs.readFileSync(path.join(HERE, '.tmp-token-v664'), 'utf8').trim()
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

const udd = path.join(os.tmpdir(), 'hg-p664-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--no-proxy-server', '--window-size=1600,1000', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const cleanup = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

const R = { pass: [], fail: [] }
const log = (s) => console.log('· ' + s)
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
  const key = async (k, code, vk, modifiers) => {
    await S('Input.dispatchKeyEvent', { type: 'keyDown', modifiers, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: k })
    await S('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
    await sleep(900)
  }

  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'p664' + Date.now(), false],
  ]) {
    const r = await S('Network.setCookie', { name, value, url: BASE + '/', path: '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
    if (!r || r.success !== true) log('!! setCookie 失败 ' + name)
  }

  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`document.body && document.body.innerText.trim().length > 50`, 60000)
  await sleep(2000)
  const build = await evalJS(`window.__HG_BUILD__ || document.documentElement.getAttribute('data-build')`)
  log('build=' + build)
  ok(String(build) === 'v664', '构建号 = v664', String(build))

  // ---- 打开副驾 ----
  await key('k', 'KeyK', 75, 2)
  await waitFor(`!!document.querySelector('.cp-new-btn')`, 20000)
  await sleep(800)

  // ---- C 标题栏入口仍在（v663 能力未误伤）----
  const C = await evalJS(`(() => {
    const b = document.querySelector('.cp-new-btn')
    if (!b) return { exists: false }
    const r = b.getBoundingClientRect()
    return {
      exists: true, inActions: !!b.closest('.cp-actions'), inHist: !!b.closest('.cp-hist'),
      visible: b.offsetParent !== null && r.width > 0 && r.height > 0,
      count: document.querySelectorAll('.cp-new-btn').length,
      text: (b.textContent || '').trim(),
    }
  })()`)
  log('C=' + JSON.stringify(C))
  ok(C.exists === true && C.count === 1, '标题栏「新对话」按钮仍存在且唯一', 'count=' + C.count)
  ok(C.inActions === true, '仍在标题栏 .cp-actions 内')
  ok(C.inHist === false, '仍不在历史面板 .cp-hist 内')
  ok(C.visible === true, '仍可见')

  // ---- A 打开历史面板，检查面板里没有新对话按钮 ----
  await evalJS(`(()=>{const b=[...document.querySelectorAll('.cp-icon-btn')].find(x=>x.getAttribute('title')==='历史会话'); if(b){b.click();return true} return false})()`)
  await sleep(1500)

  const A = await evalJS(`(() => {
    const hist = document.querySelector('.cp-hist')
    if (!hist) return { histOpen: false }
    const hd = hist.querySelector('.cp-hist-hd')
    const hdBtns = hd ? [...hd.querySelectorAll('button')] : []
    const allBtns = [...hist.querySelectorAll('button')]
    const items = hist.querySelectorAll('.cp-hist-item')
    return {
      histOpen: true,
      hdText: hd ? (hd.textContent || '').trim() : null,
      hdBtnCount: hdBtns.length,
      hdBtnTexts: hdBtns.map(b => (b.textContent || '').trim()),
      allBtnCount: allBtns.length,
      allBtnTexts: allBtns.map(b => (b.textContent || '').trim()),
      anyNewChatText: allBtns.some(b => /新对话/.test(b.textContent || '')),
      itemCount: items.length,
      delBtnCount: hist.querySelectorAll('.cp-hist-del').length,
      hasCpNewBtn: !!hist.querySelector('.cp-new-btn'),
    }
  })()`)
  log('A=' + JSON.stringify(A))
  ok(A.histOpen === true, '历史面板已打开')
  ok(A.hdBtnCount === 0, '历史面板头部 .cp-hist-hd 内没有任何按钮（v664 已删）', 'count=' + A.hdBtnCount + ' ' + JSON.stringify(A.hdBtnTexts))
  ok(A.hdText === '历史会话', '面板头部只剩标题文字', JSON.stringify(A.hdText))
  ok(A.anyNewChatText === false, '历史面板内无任何按钮文案含「新对话」')
  ok(A.hasCpNewBtn === false, '历史面板内没有 .cp-new-btn')
  ok(A.allBtnCount === A.delBtnCount, '面板内按钮数 == 历史条数（只剩每条删除按钮）', `${A.allBtnCount} / items=${A.itemCount} del=${A.delBtnCount}`)
  await shoot('v664-1-history-panel.png')

  /* 判别力说明：若历史会话为 0 条，上面「按钮数==条数」退化为 0==0，
     判别力不足。此时用示例经营卡无关，改从结构上再确认：面板头部 DOM 里
     子元素只有 <b>。这条与条数无关，始终有判别力。 */
  const hdChildren = await evalJS(`(() => {
    const hd = document.querySelector('.cp-hist-hd'); if (!hd) return null
    return [...hd.children].map(e => e.tagName.toLowerCase())
  })()`)
  log('面板头部子元素=' + JSON.stringify(hdChildren))
  ok(Array.isArray(hdChildren) && hdChildren.length === 1 && hdChildren[0] === 'b', '面板头部只剩 1 个子元素 <b>（与历史条数无关的硬判据）', JSON.stringify(hdChildren))

  // ---- D 标题栏按钮仍能开新对话 ----
  await evalJS(`(()=>{const b=document.querySelector('.cp-demo'); if(b){b.click();return true} return false})()`)
  await sleep(1200)
  const dBefore = await evalJS(`document.querySelectorAll('.cp-body .msg').length`)
  ok(dBefore > 0, '【前置】已有消息（D 才有判别力）', 'msgs=' + dBefore)
  await evalJS(`(()=>{const b=document.querySelector('.cp-new-btn'); if(!b) return false; b.click(); return true})()`)
  await sleep(1500)
  const dAfter = await evalJS(`({msgs: document.querySelectorAll('.cp-body .msg').length, hist: !!document.querySelector('.cp-hist'), welcome: !!document.querySelector('.cp-welcome')})`)
  log('D 后=' + JSON.stringify(dAfter))
  ok(dAfter.msgs === 0, '点标题栏「新对话」⇒ 消息清空', 'msgs=' + dAfter.msgs)
  ok(dAfter.hist === false, '点后历史面板收起')
  ok(dAfter.welcome === true, '落到空白引导页')
  await shoot('v664-2-after-newchat.png')

  // ---- E 快捷键仍可用 ----
  await evalJS(`(()=>{const b=document.querySelector('.cp-demo'); if(b){b.click();return true} return false})()`)
  await sleep(1000)
  const eBefore = await evalJS(`document.querySelectorAll('.cp-body .msg').length`)
  ok(eBefore > 0, '【前置】E 之前已有消息', 'msgs=' + eBefore)
  await key('o', 'KeyO', 79, 10)   // Ctrl+Shift
  const eAfter = await evalJS(`({msgs: document.querySelectorAll('.cp-body .msg').length, open: !!document.querySelector('.cp-new-btn')})`)
  log('E 后=' + JSON.stringify(eAfter))
  ok(eAfter.msgs === 0, '⌘/Ctrl+Shift+O 仍能换到空白新对话', 'msgs=' + eAfter.msgs)
  ok(eAfter.open === true, '快捷键后抽屉仍开着')
  await shoot('v664-3-shortcut.png')

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
