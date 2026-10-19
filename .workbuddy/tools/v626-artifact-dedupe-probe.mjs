/**
 * v626 复现／回归：右栏「本次产物」里同类自动经营卡只留最新一张
 *
 * 用户报障（2026-10-19）："反复问工资，右栏产物就堆一屏一样的卡"
 * 用户裁定：只留最新一张。
 *
 * 桩：拦 /api/ai/copilot/chat 返回固定 SSE（秒回、可复跑、不烧真 LLM）；
 *     /api/ai/*-card 走真实后端（只读聚合，零写库）。
 *     第 6 次提问时 SSE 带 ```card 围栏 —— 用来守反向红线：
 *     **AI 主回复自己出的卡不许被折叠**（它是结论交付物，不是系统补的数据）。
 *
 * 判据：
 *   A 连问 3 次工资 → 产物区工资项 = 1（且指向最后那条）
 *   B 再问 2 次货损 → 工资 1 + 货损 1 = 2
 *   C 再问 1 次（AI 自己出 ```card）→ = 3，AI 那张仍在（未被当成自动卡折叠）
 *
 * 用法：HG_BASE=https://hergent.cn node v626-artifact-dedupe-probe.mjs
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TAG = process.env.HG_TAG || 'run'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

const STUB = `(() => {
  window.__STUB_N = 0
  const orig = window.fetch.bind(window)
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : ((input && input.url) || '')
    if (url.indexOf('/api/ai/copilot/chat') > -1) {
      window.__STUB_N++
      const n = window.__STUB_N
      let txt = '好的，我核对了一下，数据如下。'
      if (n === 6) {
        txt = '好的，这是本期工资卡。\\n\\n\`\`\`card\\n' +
          JSON.stringify({ type: 'payroll', title: '本月工资提成（AI 结论）', summary: '测试用 AI 自出卡',
            metrics: [{ label: '合计', value: '¥10,000' }], points: [] }) + '\\n\`\`\`'
      }
      const mk = (t) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: t }, index: 0, finish_reason: null }] }) + '\\n\\n'
      const body = mk(txt) + 'data: [DONE]\\n\\n'
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    }
    return orig(input, init)
  }
  return 1
})()`

const JS_LOGIN_DEMO = `fetch('/api/auth/demo-login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
  .then(r=>r.json()).then(d=>{
    if(!d.token) return JSON.stringify({ok:false})
    localStorage.setItem('hergent_v2_token', d.token)
    localStorage.setItem('hergent_v2_tenant', String(d.tenant_id))
    localStorage.setItem('hergent_v2_user', JSON.stringify(d.user))
    return JSON.stringify({ok:true, tenant:d.tenant_id})
  })`

const JS_OPEN = `(() => { const b = document.querySelector('.tb-copilot'); if (!b) return 'no-btn'; b.click(); return 'ok' })()`
const JS_HOOK = `(() => { if (window.__HG_ERRS__) return 1; window.__HG_ERRS__ = [];
  window.addEventListener('error', e => window.__HG_ERRS__.push('err:' + (e.message||'')));
  window.addEventListener('unhandledrejection', e => window.__HG_ERRS__.push('rej:' + (e.reason && e.reason.message || e.reason)));
  return 1 })()`
const JS_ERRS = `(() => JSON.stringify(window.__HG_ERRS__ || []))()`

/** 打开右栏产物面板（幂等） */
const JS_OPEN_ART = `(() => {
  const aside = document.querySelector('.cp-artifacts')
  if (!aside) return 'no-aside'
  if (aside.classList.contains('show-art')) return 'already'
  const b = document.querySelector('.cp-art-toggle')
  if (!b) return 'no-toggle'
  b.click(); return 'clicked'
})()`

/** 开一段**空白新对话**（demo 账号会被自动恢复上次会话，不重置就把上次的卡也算进来） */
const JS_OPEN_HIST = `(() => {
  const b = document.querySelector('.copilot [title="历史会话"]')
  if (!b) return 'no-btn'
  b.click(); return 'ok'
})()`
const JS_NEW_CHAT = `(() => {
  const bs = [...document.querySelectorAll('.cp-hist button')]
  const hit = bs.find(b => (b.textContent || '').indexOf('新对话') > -1)
  if (!hit) return 'missing; have=' + bs.map(b => b.textContent.trim()).join('/')
  hit.click(); return 'ok'
})()`

/** 产物区快照：每项的文本 + 计数 */
const JS_ART = `(() => {
  const items = [...document.querySelectorAll('.cp-artifacts .cp-art-item')]
  const badge = document.querySelector('.cp-art-badge')
  return JSON.stringify({
    n: items.length,
    badge: badge ? badge.textContent.trim() : '',
    items: items.map(el => (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 48))
  })
})()`

const ask = (q) => `(() => {
  const t = document.querySelector('.cp-input')
  if (!t) return 'no-input'
  if (t.disabled || t.readOnly) return 'busy'
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(t, ${JSON.stringify(q)})
  t.dispatchEvent(new Event('input', { bubbles: true }))
  t.focus()
  t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
  return 'ok'
})()`

const JS_MSG_N = `(() => document.querySelectorAll('.cp-body .msg').length)()`

/** 对话流里工资卡的消息条数 —— 用来区分「去重了」和「卡压根没生成」 */
const JS_MSG_PAY = `(() => {
  const ms = [...document.querySelectorAll('.cp-body .msg')]
  return String(ms.filter(el => (el.innerText || '').indexOf('本月工资提成核算') > -1).length)
})()`

/** 发一问并等到「消息数增加 + 卡出现（可选）」 */
async function turn(page, q, { expectCard = true } = {}) {
  const before = Number(await page.eval(JS_MSG_N))
  for (let i = 0; i < 15; i++) {
    const r = await page.eval(ask(q))
    if (r === 'ok') break
    await sleep(400)
  }
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    const n = Number(await page.eval(JS_MSG_N))
    if (n < before + 2) continue
    if (!expectCard) return n
    const art = JSON.parse(await page.eval(JS_ART))
    if (art.n) return n
  }
  return Number(await page.eval(JS_MSG_N))
}

const browser = await launch({})
const page = await browser.newPage()
await page.enable()
await page.goto(BASE, 2500)
log('演示登录:', await page.eval(JS_LOGIN_DEMO))
const sid = await page.addInitScript(STUB)
await page.goto(BASE + '/#/forecast', 1800)
await page.raw.send('Page.reload', {})
await sleep(9000)
await page.removeInitScript(sid)
await page.eval(JS_HOOK)
log('构建号:', await page.eval(`(() => (window.__HG_BUILD__||'?'))()`))
log('打开副驾:', await page.eval(JS_OPEN))
for (let i = 0; i < 30; i++) {
  const s = await page.eval(`(() => !!document.querySelector('.cp-body'))()`)
  if (s === true) break
  await sleep(400)
}
await sleep(800)
log('打开产物区:', await page.eval(JS_OPEN_ART))
await sleep(400)
// 空白新对话（demo 账号会被自动恢复到上次那段，含上次跑出来的卡）
log('打开历史:', await page.eval(JS_OPEN_HIST))
await sleep(900)
log('新对话:', await page.eval(JS_NEW_CHAT))
await sleep(900)
log('产物区重置后:', await page.eval(JS_ART))
log('打开产物区:', await page.eval(JS_OPEN_ART))
await sleep(400)

const has = (arr, kw) => arr.filter(t => t.indexOf(kw) > -1)

// ---- A：连问 3 次工资 ----
const qsA = ['帮我算一下这个月的工资', '再看下工资提成', '工资到底多少']
for (let i = 0; i < qsA.length; i++) {
  await turn(page, qsA[i])
  await sleep(700)
  const s = JSON.parse(await page.eval(JS_ART))
  log(`  第 ${i + 1} 问后产物数 = ${s.n}`)
  // 首问 = v626 第二个修复点的守门：新对话第一次提问的卡**不许被归属校验误丢**
  if (i === 0) log('  判据A0 首问即出卡:', s.n === 1 ? 'true' : 'false', '→', s.n)
}
let a = JSON.parse(await page.eval(JS_ART))
const inFlow = Number(await page.eval(JS_MSG_PAY))
log('【A】连问 3 次工资后产物区:', JSON.stringify(a), '｜对话流里工资卡', inFlow, '张')
const aPay = has(a.items, '工资')
const okA = aPay.length === 1 && a.n === 1
const okA0 = inFlow === 3
log('判据A 工资项只留 1 张:', okA, '→ 实际', aPay.length, '/ 产物总数', a.n)
log('判据A0 三张卡都落进了对话流（去重而非丢卡）:', okA0, '→ 对话流', inFlow, '张')

// ---- B：再问 2 次货损 ----
for (const q of ['看一下这个月的货损', '货损情况怎么样']) {
  await turn(page, q)
  await sleep(700)
}
let b = JSON.parse(await page.eval(JS_ART))
log('【B】再问 2 次货损后产物区:', JSON.stringify(b))
const bPay = has(b.items, '工资')
const bLoss = has(b.items, '货损')
const okB = bPay.length === 1 && bLoss.length === 1 && b.items.length === 2
log('判据B 工资 1 + 货损 1 = 2:', okB, '→', JSON.stringify({ pay: bPay.length, loss: bLoss.length, total: b.items.length }))

// ---- C：AI 主回复自己出 ```card（不能被折叠） ----
await turn(page, '工资给我出张卡', { expectCard: true })
await sleep(900)
let c = JSON.parse(await page.eval(JS_ART))
log('【C】AI 自己出 ```card 后产物区:', JSON.stringify(c))
const cAi = has(c.items, 'AI 结论')
const okC = cAi.length === 1 && c.items.length === 3
log('判据C AI 自出卡未被折叠（总 3 张）:', okC, '→', JSON.stringify({ ai: cAi.length, total: c.items.length }))

const ok = okA && okA0 && okB && okC
log(ok ? '✅ PASS —— 同类自动卡只留最新一张；AI 的卡与文件产物不参与折叠'
       : '❌ FAIL —— 见上方判据')
log('控制台错误:', await page.eval(JS_ERRS))

try {
  await page.screenshot(`/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v626/artifact-${TAG}.png`)
} catch (_) { /* 截图失败不影响判据 */ }
await browser.close()
process.exit(ok ? 0 : 1)
