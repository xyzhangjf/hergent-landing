/**
 * v625 复现／回归：副驾「兜底经营卡」的角色署名
 *
 * 用户报障（2026-10-19）："让会计帮我算工资，大秘突然发了一条消息
 *   「顺手把本月工资提成核算拉出来了：」，我没有问，AI 主动出来答"
 *
 * 待证伪的机制（两处叠加，任一处成立都足以产生该现象）：
 *   ① useCardTrigger.pushCard 只写 role/content/card/created_at，**不写 roleMeta**
 *      ⇒ 模板署名 `m.roleMeta?.name || currentRole.name` 回落到**当前角色**
 *      ⇒ 在「会计」下问工资、切到「大秘」，那条卡就改署「大秘」。
 *   ② 卡是异步补的（triggerCards 不 await）⇒ 回来时若已切角色/切会话，
 *      仍 push 进当前 messages ⇒ 落进别的上下文，看着就是"AI 主动开口"。
 *
 * 桩：拦 /api/ai/copilot/chat 返回固定 SSE（不依赖真 LLM，秒回、可复跑）。
 *     /api/ai/payroll-card 走真实后端（只读聚合，零写库）。
 *
 * 判据：
 *   PASS = 切到「大秘」后，那条卡仍署「会计」
 *   FAIL = 切到「大秘」后，那条卡变成「大秘」（= 用户看到的现象）
 *
 * 用法：HG_BASE=https://erp.hergent.cn node v625-card-role-attribution-probe.mjs
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import { freshChat } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cp-fresh.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TAG = process.env.HG_TAG || 'run'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

const STUB = `(() => {
  const orig = window.fetch.bind(window)
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : ((input && input.url) || '')
    if (url.indexOf('/api/ai/copilot/chat') > -1) {
      const mk = (txt) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: txt }, index: 0, finish_reason: null }] }) + '\\n\\n'
      // 🔴 v627：前端不再按关键词补卡，「问工资就出卡」这条路已经不通了。
      //   本探针要测的是「卡消息的署名」，所以必须让 AI 自己表态要卡（cards 围栏）。
      const body = mk('好的，本月工资提成我核对了，数据见卡。\\n\\n\`\`\`cards\\n{"show":["wage"]}\\n\`\`\`') + 'data: [DONE]\\n\\n'
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

/** 副驾状态：有哪些消息、各自署名
 *  🔴 v627 改：卡消息**不再带正文**（「顺手把…拉出来了」已删），
 *     所以不能再用文案匹配来找卡 —— 改用 DOM 事实「这条助手消息里有 .rc（ResultCard）」。 */
const JS_STATE = `(() => {
  const aside = document.querySelector('.copilot')
  if (!aside) return JSON.stringify({ open: false })
  const msgs = [...document.querySelectorAll('.cp-body .msg')]
  const list = msgs.map((m, i) => {
    const r = m.querySelector('.msg-role')
    const tx = (m.innerText || '').replace(/\\s+/g, ' ').trim()
    return { i, role: r ? r.textContent.trim() : '', isSwitch: m.classList.contains('is-switch'),
      hasCard: !!m.querySelector('.rc'),
      isUser: m.classList.contains('user'), tx: tx.slice(0, 46) }
  })
  const cards = list.filter(o => !o.isUser && o.hasCard)
  return JSON.stringify({ open: true, count: list.length, cards, tail: list.slice(-4) })
})()`

const JS_OPEN_MENU = `(() => { const p = document.querySelector('.cp-role'); if (!p) return 'no-pill'; p.click(); return 'ok' })()`

const pickRole = (name) => `(() => {
  const items = [...document.querySelectorAll('.cp-role-item')]
  const hit = items.find(x => { const n = x.querySelector('.cp-role-item-name'); return n && n.textContent.trim() === ${JSON.stringify(name)} })
  if (!hit) return 'missing; have=' + items.map(x => (x.querySelector('.cp-role-item-name')||{}).textContent).join('/')
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
for (let i = 0; i < 30; i++) {
  const s = JSON.parse(await page.eval(JS_STATE))
  if (s.open) break
  await sleep(400)
}

// ---- 步骤 0：空白新对话（demo 账号会自动恢复上次那段，历史卡会污染基线） ----
log('新对话:', await freshChat(page, sleep))

// ---- 步骤 1：切到「会计」 ----
log('展开团队菜单:', await page.eval(JS_OPEN_MENU))
await sleep(500)
log('选「会计」:', await page.eval(pickRole('会计')))
await sleep(700)

// ---- 步骤 2：问工资（命中 PAYROLL_RE ⇒ 兜底卡拉取） ----
log('发送问题:', await page.eval(ask('帮我算一下这个月的工资和提成')))
let card0 = null
for (let i = 0; i < 30; i++) {
  await sleep(600)
  const s = JSON.parse(await page.eval(JS_STATE))
  if (s.cards && s.cards.length) { card0 = s; break }
}
if (!card0) {
  log('✗ 卡片未出现 —— 探针前置不成立', await page.eval(JS_STATE))
} else {
  log('【步骤1】会计提问后的卡：', JSON.stringify(card0.cards))
}

// ---- 步骤 3：切到「大秘」，看那条卡署谁 ----
log('展开团队菜单:', await page.eval(JS_OPEN_MENU))
await sleep(500)
log('选「大秘」:', await page.eval(pickRole('大秘')))
await sleep(1200)

const s1 = JSON.parse(await page.eval(JS_STATE))
const cards = s1.cards || []
log('【步骤2】切到大秘后：', JSON.stringify(cards))

// 判据二条：
//  ① 切角色前后每张卡的署名**逐条不变**（不漂移）—— 这是用户报障的直接症状
//  ② 本次新产生的卡署「经营数据」（系统自动补的数，不冒充任何角色）
const before = (card0 && card0.cards) || []
const stable = before.length === cards.length && before.every((c, i) => c.role === cards[i].role)
const lastIsAuto = cards.length > 0 && cards[cards.length - 1].role === '经营数据'
const ok = stable && lastIsAuto
log('判据① 切角色前后署名稳定:', stable, before.map(c => c.role), '→', cards.map(c => c.role))
log('判据② 最新卡为「经营数据」:', lastIsAuto, '→', cards.length ? cards[cards.length - 1].role : '(无卡)')
log(ok ? '✅ PASS —— 自动经营卡不再随当前角色改口'
       : '❌ FAIL —— 署名漂移或仍署角色名')
log('控制台错误:', await page.eval(JS_ERRS))

try {
  await page.screenshot(`/Users/zhangjunfeng/Documents/laozhangai-product/outputs/v625/card-role-${TAG}.png`)
} catch (_) { /* 截图失败不影响判据 */ }
await browser.close()
process.exit(ok ? 0 : 1)
