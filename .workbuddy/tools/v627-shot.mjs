/**
 * v627 截图：复现用户截图里的场景 —— 带序号的 AI 回复 + AI 主动要卡
 * 目的：确认「卡消息无气泡」后，署名与卡之间的间距、对齐没有塌。
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import { freshChat } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cp-fresh.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TAG = process.env.HG_TAG || 'shot'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const STUB = `(() => {
  if (window.__STUB_ON__) return 1
  window.__STUB_ON__ = true
  window.__STUB_TXT__ = '好的，我看了一下。'
  const orig = window.fetch.bind(window)
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : ((input && input.url) || '')
    if (url.indexOf('/api/ai/copilot/chat') > -1) {
      const mk = (t) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: t }, index: 0, finish_reason: null }] }) + '\\n\\n'
      const body = mk(String(window.__STUB_TXT__ || '')) + 'data: [DONE]\\n\\n'
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    }
    return orig(input, init)
  }
  return 1
})()`

const JS_LOGIN_DEMO = `fetch('/api/auth/demo-login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
  .then(r=>r.json()).then(d=>{ if(!d.token) return '{"ok":false}';
    localStorage.setItem('hergent_v2_token', d.token);
    localStorage.setItem('hergent_v2_tenant', String(d.tenant_id));
    localStorage.setItem('hergent_v2_user', JSON.stringify(d.user));
    return '{"ok":true}' })`

const JS_OPEN = `(() => { const b = document.querySelector('.tb-copilot'); if (!b) return 'no-btn'; b.click(); return 'ok' })()`
const JS_OPEN_MENU = `(() => { const p = document.querySelector('.cp-role'); if (!p) return 'no-pill'; p.click(); return 'ok' })()`
const pickRole = (n) => `(() => { const it=[...document.querySelectorAll('.cp-role-item')];
  const h=it.find(x=>{const t=x.querySelector('.cp-role-item-name');return t&&t.textContent.trim()===${JSON.stringify(n)}});
  if(!h) return 'missing'; h.click(); return 'ok' })()`
const ask = (q) => `(() => {
  const t = document.querySelector('.cp-input')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(t, ${JSON.stringify(q)})
  t.dispatchEvent(new Event('input', { bubbles: true }))
  t.focus()
  t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
  return 'ok'
})()`
const JS_N = `(() => document.querySelectorAll('.cp-body .msg').length)()`

const browser = await launch({})
const page = await browser.newPage()
await page.enable()
await page.goto(BASE, 2500)
await page.eval(JS_LOGIN_DEMO)
const sid = await page.addInitScript(STUB)
await page.goto(BASE + '/#/forecast', 1800)
await page.raw.send('Page.reload', {})
await sleep(6000)
await page.removeInitScript(sid)
console.log('构建号:', await page.eval(`(() => (window.__HG_BUILD__||'?'))()`))
await page.eval(JS_OPEN)
await sleep(1200)
await freshChat(page, sleep)
await page.eval(JS_OPEN_MENU)
await sleep(500)
await page.eval(pickRole('会计'))
await sleep(700)

// 1) 带序号的回复（用户截图那种）
await page.eval(`(() => { window.__STUB_TXT__ = '【结论】本月工资的核算分三步：\\n\\n1. 先按门店汇总销量\\n2. 再乘各人的提成系数\\n3. 最后扣减借支与罚款\\n\\n10. 特殊情况下按上月的实际发放额兜底\\n\\n【依据】数据来自 10 月工资表。'; return 1 })()`)
let n = await page.eval(JS_N)
await page.eval(ask('工资是怎么核算的'))
for (let i = 0; i < 40; i++) { await sleep(500); const m = await page.eval(JS_N); if (m > n) break }
await sleep(1500)

// 2) AI 主动要卡：看「无正文卡消息」的间距
await page.eval(`(() => { window.__STUB_TXT__ = '【结论】本月应发合计见卡。\\n\\n\`\`\`cards\\n{"show":["wage"]}\\n\`\`\`'; return 1 })()`)
n = await page.eval(JS_N)
await page.eval(ask('这个月发多少'))
for (let i = 0; i < 40; i++) { await sleep(500); const m = await page.eval(JS_N); if (m >= n + 2) break }
await sleep(2000)

// 量一下「署名行」与「卡」的间距、以及卡消息里有没有残留空 bubble
console.log('布局体检:', await page.eval(`(() => {
  const msgs = [...document.querySelectorAll('.cp-body .msg')]
  const last = msgs[msgs.length - 1]
  const head = last.querySelector('.msg-head')
  const rc = last.querySelector('.rc')
  const bub = last.querySelector('.msg-bubble')
  const r = (el) => el ? el.getBoundingClientRect() : null
  const h = r(head), c = r(rc)
  return JSON.stringify({
    bubbleExists: !!bub,
    gapHeadToCard: (h && c) ? Math.round(c.top - h.bottom) : null,
    cardW: c ? Math.round(c.width) : null,
    sortN: msgs.length
  })
})()`))
await page.eval(`(() => { const b = document.querySelector('.cp-body'); if (b) b.scrollTop = b.scrollHeight; return 1 })()`)
await sleep(600)
await page.raw.send('Page.captureScreenshot', { format: 'png' }).then(async (r) => {
  const fs = await import('node:fs')
  // raw.send 可能回 {result:{data}} 或 {data}，两种都兜住（上一版只认 r.data ⇒ undefined）
  const b64 = (r && r.data) || (r && r.result && r.result.data)
  if (!b64) { console.log('截图失败，返回结构:', JSON.stringify(r).slice(0, 200)); return }
  fs.writeFileSync('/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v627/reply-' + TAG + '.png', Buffer.from(b64, 'base64'))
})
console.log('已截图 outputs/v627/reply-' + TAG + '.png')
await browser.close()
