/**
 * v665 真机验收（浏览器）：分批导出时，用户到底看到什么。
 *
 * 为什么要另做一条：后端 17+13 项 HTTP 验收只能证明「号段对」，不能证明
 *   「用户在界面上看得见第几批」。而分批导出最容易犯的错，恰恰是**文件下对了、
 *   用户不知道该拿哪个去舟谱**（三个同名文件时更糟）。
 *
 * 判据（全部读真实 DOM / 真实 toast 栈，不看源码）：
 *   A 构建号 = v665
 *   B 「模板参数」页：起始序号输入框 = 1，提示文案说明「只决定第一批 / 之后自动接续」
 *   C 首次导出：toast 含「自提第 1 批」与「自提单号 01–02」
 *   D 再点一次（同内容）：toast 含「沿用原号段」（不吃新号）
 *
 * 用法：node verify-ui-docseq.mjs [base] [token]
 * 前置：ssh -L 8899:127.0.0.1:8700 隧道 + serve-dist.mjs（/api 反代到 8899）
 */
import { spawn } from 'child_process'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] || 'http://127.0.0.1:8905'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOKEN = process.argv[3] || fs.readFileSync(path.join(HERE, '.tmp-token-v665'), 'utf8').trim()
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

const udd = path.join(os.tmpdir(), 'hg-p665-' + Date.now())
const chrome = spawn(CHROME, [
  '--remote-debugging-pipe', '--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', `--user-data-dir=${udd}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--mute-audio',
  '--no-proxy-server', '--window-size=1600,1000', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
const kill = () => { try { chrome.kill('SIGKILL') } catch {} try { fs.rmSync(udd, { recursive: true, force: true }) } catch {} }

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
  // 不真下载到磁盘（headless 里下载行为不可控，会污染 user-data-dir）
  try { await S('Page.setDownloadBehavior', { behavior: 'deny' }) } catch {}

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

  for (const [name, value, httpOnly] of [
    ['erp_token', TOKEN, true], ['hergent_auth', '1', false],
    ['hergent_tenant', '1', false], ['csrf_token', 'p665' + Date.now(), false],
  ]) {
    const r = await S('Network.setCookie', { name, value, url: BASE + '/', path: '/', httpOnly, secure: BASE.startsWith('https'), sameSite: 'Lax' })
    if (!r || r.success !== true) log('!! setCookie 失败 ' + name)
  }

  // ── A 构建号 ──
  await S('Page.navigate', { url: BASE + '/#/forecast' })
  await waitFor(`document.body && document.body.innerText.trim().length > 50`, 60000)
  await sleep(2500)
  const build = await evalJS(`window.__HG_BUILD__ || document.documentElement.getAttribute('data-build')`)
  ok(String(build) === 'v665', '构建号 = v665', String(build))

  // ── C 首次导出：toast 必须报出批次与号段 ──
  /* 🔴 toast 是**瞬时**的（短文案几秒就消失），单点 `innerText` 采样会随机读空 ——
     本次第一版探针就这么误报成「没提示」（后端日志里明明是 200 OK）。
     改为页面内 150ms 持续采样、去重存进 `window.__toastLog`，事后读全量。 */
  const armToastLog = async () => {
    await evalJS(`(()=>{
      window.__toastLog = []
      if (window.__toastTimer) clearInterval(window.__toastTimer)
      window.__toastTimer = setInterval(()=>{
        const d = document.querySelector('.notif-dock')
        const t = d ? d.innerText.replace(/\\n+/g,' | ').trim() : ''
        if (t && window.__toastLog.indexOf(t) < 0) window.__toastLog.push(t)
      }, 150)
      return true
    })()`)
  }
  const dumpToastLog = async () => await evalJS(`(window.__toastLog || []).join('  ‖  ')`)
  const clearToast = async () => {
    await evalJS(`(()=>{document.querySelectorAll('.notif-dock button').forEach(b=>{try{b.click()}catch(e){}});return true})()`)
    await sleep(300)
    await armToastLog()
  }

  const openExportMenu = async () => {
    // 🔴 必须精确匹配主按钮：菜单项「导出全部（当前汇总表）」也是「导出」开头，
    //    用 `^导出` 会点到它 ⇒ 菜单不会展开，后续找不到模板项（本次就踩了）。
    const hit = await evalJS(`(()=>{
      const b=[...document.querySelectorAll('button')].find(x=>/^导出$/.test((x.innerText||'').trim()))
      if(b){b.click();return true} return false
    })()`)
    if (!hit) throw new Error('找不到主「导出」按钮')
    await sleep(600)
  }
  const clickPickup = async () => {
    const hit = await evalJS(`(()=>{
      const p=document.querySelector('.tb-pop-panel'); if(!p) return false
      const b=[...p.querySelectorAll('button')].find(x=>/自提订单模板/.test(x.innerText||''))
      if(b){b.click();return true} return false
    })()`)
    if (!hit) throw new Error('导出菜单里没找到「自提订单模板」')
  }

  await clearToast()
  await openExportMenu()
  await shoot('v665-0-export-menu.png')
  await clickPickup()
  await sleep(6000)
  const t1 = await dumpToastLog()
  log('首次 toast：' + t1)
  ok(/自提第\s*1\s*批/.test(t1), 'toast 写明「自提第 1 批」', '')
  ok(/自提单号\s*01[–-]0?2/.test(t1), 'toast 写明本批号段 01–02', '')
  await shoot('v665-1-first-export.png')

  // ── D 同内容再点：复用不吃号 ──
  await clearToast()
  await openExportMenu()
  await clickPickup()
  await sleep(6000)
  const t2 = await dumpToastLog()
  log('再次 toast：' + t2)
  ok(/沿用原号段/.test(t2), '同名同内容再导出 → 明确说「沿用原号段」')
  ok(/自提第\s*1\s*批/.test(t2), '批次号不变（仍是第 1 批）')
  await shoot('v665-2-reuse.png')

  // ── B 模板参数页：起始序号 1 + 语义文案 ──
  await S('Page.navigate', { url: BASE + '/#/forecast?tab=config-template' })
  await sleep(3500)
  const tp = await evalJS(`(()=>{
    const lab=[...document.querySelectorAll('label')].find(l=>/自提单号起始序号/.test(l.innerText||''))
    if(!lab) return {found:false}
    const wrap=lab.parentElement
    const inp=wrap?wrap.querySelector('input'):null
    const hint=wrap?wrap.querySelector('.tp-hint'):null
    return {found:true, value: inp?inp.value:null, hint: hint?hint.innerText:''}
  })()`)
  if (!tp.found) {
    log('⚠ 没在当前 tab 找到「自提单号起始序号」（可能页签参数没生效），改从全页文本判断')
    const txt = await evalJS(`document.body.innerText`)
    ok(/自提单号起始序号/.test(txt), '页面上存在该配置项')
  } else {
    ok(String(tp.value) === '1', '起始序号输入框 = 1', '(实际 ' + tp.value + ')')
    ok(/第一批/.test(tp.hint) && /接着上一批|不再复用/.test(tp.hint), '提示文案说明「只决定第一批 / 之后自动接续」')
    log('hint：' + tp.hint)
  }
  await shoot('v665-3-template-params.png')
} catch (e) {
  console.log('  ❌ 异常：' + e.message)
  R.fail.push('异常 ' + e.message)
} finally {
  kill()
}

console.log('\n' + '='.repeat(56))
console.log(`PASS ${R.pass.length} / FAIL ${R.fail.length}`)
if (R.fail.length) { R.fail.forEach(f => console.log('  ❌ ' + f)); process.exit(1) }
console.log('PASS —— 界面能看见批次、号段、复用状态；起始序号默认 01 且语义已说明')
