/**
 * v625b 竞态复现：兜底卡**异步回来时**是否落进切换后的上下文
 *
 * 机制：`triggerCards(q)` 不 await，卡请求飞在路上时老板很可能已经切走。
 *   旧实现回来无脑 `store.chat.messages.push(...)` ⇒ 卡落进**当前**那段对话
 *   （甚至已经换成人/换了会话），视觉上就是"我没问，它自己冒出一条"。
 *
 * 桩：copilot/chat 秒回；**payroll-card 延迟 3s**。发问后 0.5s 立刻切角色，
 *     然后等 6s 看会不会冒卡。
 * 判据：切走后不产生任何新卡消息（PASS）；冒出 1 张（FAIL）。
 *
 * 用法：HG_BASE=https://hergent.cn node v625b-card-race-probe.mjs
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import { freshChat } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cp-fresh.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TAG = process.env.HG_TAG || 'run'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

const STUB = `(() => {
  const orig = window.fetch.bind(window)
  const json = (o) => Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : ((input && input.url) || '')
    if (url.indexOf('/api/ai/copilot/chat') > -1) {
      const mk = (txt) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: txt }, index: 0, finish_reason: null }] }) + '\\n\\n'
      return Promise.resolve(new Response(mk('好的。') + 'data: [DONE]\\n\\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    }
    if (url.indexOf('/api/ai/payroll-card') > -1) {
      // 延迟 3s：模拟"老板手快、卡还在路上"
      return new Promise((resolve) => setTimeout(() => resolve(new Response(JSON.stringify({
        card: { type: 'payroll', title: '本月工资提成核算（竞态桩）', summary: '桩数据',
                metrics: [{ label: '本月提成', value: '¥0', tone: 'neutral' }], points: [] }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })), 3000))
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
    return JSON.stringify({ok:true})
  })`

const JS_OPEN = `(() => { const b = document.querySelector('.tb-copilot'); if (!b) return 'no-btn'; b.click(); return 'ok' })()`
const JS_HOOK = `(() => { if (window.__HG_ERRS__) return 1; window.__HG_ERRS__ = [];
  window.addEventListener('error', e => window.__HG_ERRS__.push('err:' + (e.message||'')));
  window.addEventListener('unhandledrejection', e => window.__HG_ERRS__.push('rej:' + (e.reason && e.reason.message || e.reason)));
  return 1 })()`
const JS_ERRS = `(() => JSON.stringify(window.__HG_ERRS__ || []))()`

const JS_CARDS = `(() => {
  const msgs = [...document.querySelectorAll('.cp-body .msg')]
  const cards = msgs.filter(m => (m.innerText || '').indexOf('顺手把本月工资') > -1)
    .map(m => { const r = m.querySelector('.msg-role'); return { role: r ? r.textContent.trim() : '' } })
  return JSON.stringify({ count: msgs.length, cards })
})()`

const JS_OPEN_MENU = `(() => { const p = document.querySelector('.cp-role'); if (!p) return 'no-pill'; p.click(); return 'ok' })()`
const pickRole = (name) => `(() => {
  const items = [...document.querySelectorAll('.cp-role-item')]
  const hit = items.find(x => { const n = x.querySelector('.cp-role-item-name'); return n && n.textContent.trim() === ${JSON.stringify(name)} })
  if (!hit) return 'missing'
  hit.click(); return 'ok'
})()`
const ask = (q) => `(() => {
  const t = document.querySelector('.cp-input')
  if (!t) return 'no-input'
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(t, ${JSON.stringify(q)})
  t.dispatchEvent(new Event('input', { bubbles: true }))
  t.focus()
  t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
  return 'ok'
})()`

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
for (let i = 0; i < 30; i++) { if (JSON.parse(await page.eval(JS_CARDS)).count >= 0) break; await sleep(400) }
await sleep(1200)

// 空白新对话（否则基线取在历史恢复之前，历史卡会被算成本次增量 ⇒ 假 FAIL）
log('新对话:', await freshChat(page, sleep))

// 基线（干净会话应为 0）
const base = JSON.parse(await page.eval(JS_CARDS))
log('基线:', JSON.stringify(base))

log('展开团队菜单:', await page.eval(JS_OPEN_MENU))
await sleep(400)
log('选「会计」:', await page.eval(pickRole('会计')))
await sleep(600)
log('问工资:', await page.eval(ask('帮我算一下这个月的工资和提成')))
await sleep(500)
log('★ 立刻切到「大秘」（卡还在路上）:', await page.eval(JS_OPEN_MENU))
await sleep(400)
log('  ', await page.eval(pickRole('大秘')))

await sleep(6000)   // 等那张延迟 3s 的卡回来
const after = JSON.parse(await page.eval(JS_CARDS))
log('切走后:', JSON.stringify(after))

const added = after.cards.length - base.cards.length
const ok = added === 0
log(added === 0 ? '✅ PASS —— 归属已变，迟到的卡被丢弃，没有凭空冒出'
                : `❌ FAIL —— 切角色后仍冒出了 ${added} 张卡，署名=` + JSON.stringify(after.cards.map(c => c.role)))
log('控制台错误:', await page.eval(JS_ERRS))

try {
  await page.screenshot(`/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v625/card-race-${TAG}.png`)
} catch (_) {}
await browser.close()
process.exit(ok ? 0 : 1)
