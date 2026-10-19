/**
 * v625c 反向验证：**AI 自己出的卡**不能被误判成「自动补的经营卡」
 *
 * v625 把「系统自动补的卡」改成中性署名（📊 经营数据）。风险是误伤：
 * AI 主回复里用 ```card 围栏出的卡，是与回复**同一条消息**、带角色快照的，
 * 必须仍然署角色名（否则老板会以为 AI 的结论也是"系统自动算的"）。
 *
 * 桩：copilot/chat 直接返回「一段话 + ```card 围栏」。提问含"工资"（会命中兜底正则），
 *     但 AI 已出卡 ⇒ 兜底不该再补一张（v156 A 的既有规则，一并回归）。
 *
 * 判据：
 *   ① 带卡的那条正文消息署「会计」（不是「经营数据」）
 *   ② 全部卡消息里**没有**"顺手把…"这种兜底卡（说明 aiCarded 生效）
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TAG = process.env.HG_TAG || 'run'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

// AI 回复：一句话 + ```card 围栏（卡挂在同一条消息上）
const CARD_JSON = JSON.stringify({
  type: 'payroll', title: 'AI 自己出的工资卡',
  metrics: [{ label: '本月提成', value: '¥1000', tone: 'neutral' }], points: []
})
const AI_TEXT = '好的，这个月工资我核过了，结论在下面这张卡里。\n\n```card\n' + CARD_JSON + '\n```\n'

const STUB = `(() => {
  const orig = window.fetch.bind(window)
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : ((input && input.url) || '')
    if (url.indexOf('/api/ai/copilot/chat') > -1) {
      const mk = (txt) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: txt }, index: 0, finish_reason: null }] }) + '\\n\\n'
      return Promise.resolve(new Response(mk(${JSON.stringify(AI_TEXT)}) + 'data: [DONE]\\n\\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
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

const JS_STATE = `(() => {
  const msgs = [...document.querySelectorAll('.cp-body .msg')]
  const list = msgs.map((m, i) => {
    const r = m.querySelector('.msg-role')
    const tx = (m.innerText || '').replace(/\\s+/g, ' ').trim()
    return { i, role: r ? r.textContent.trim() : '', tx: tx.slice(0, 60) }
  })
  return JSON.stringify({
    count: list.length,
    mine: list.filter(o => o.tx.indexOf('AI 自己出的工资卡') > -1),
    fallback: list.filter(o => o.tx.indexOf('顺手把本月工资') > -1),
    tail: list.slice(-3)
  })
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
await sleep(1500)

log('展开团队菜单:', await page.eval(JS_OPEN_MENU))
await sleep(400)
log('选「会计」:', await page.eval(pickRole('会计')))
await sleep(600)

// 基线：历史会话里可能已有旧的兜底卡，只比较**本次增量**
const baseFallback = JSON.parse(await page.eval(JS_STATE)).fallback.length
log('提问（含"工资"，同时验证兜底不重复补卡）:', await page.eval(ask('帮我看一下这个月的工资')))

let st = null
for (let i = 0; i < 25; i++) {
  await sleep(600)
  st = JSON.parse(await page.eval(JS_STATE))
  if (st.mine.length) break
}
log('状态:', JSON.stringify({ mine: st.mine, fallbackDelta: st.fallback.length - baseFallback, tail: st.tail }))

const r1 = st.mine.length >= 1 && st.mine.every(x => x.role === '会计')
const r2 = (st.fallback.length - baseFallback) === 0
log('判据① AI 自己的卡仍署角色名:', r1, '→', st.mine.map(x => x.role))
log('判据② 本次未重复补兜底卡:', r2, '→ 新增', st.fallback.length - baseFallback, '张（基线', baseFallback, '）')
const ok = r1 && r2
log(ok ? '✅ PASS' : '❌ FAIL')
log('控制台错误:', await page.eval(JS_ERRS))

try {
  await page.screenshot(`/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v625/card-aicard-${TAG}.png`)
} catch (_) {}
await browser.close()
process.exit(ok ? 0 : 1)
