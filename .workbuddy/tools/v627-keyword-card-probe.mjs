/**
 * v627 复现／回归：前端「关键词正则兜底补卡」是否在 AI 已经判断过的场景里硬塞卡
 *
 * 用户报障（2026-10-19）：
 *   "关键词触发这个感觉挺奇怪的，只要打了关键词就出卡，给人感觉非常突兀"
 *
 * 机制现状（CopilotDrawer 第 3192-3197 行）：
 *   ① AI 输出 ```cards 意图围栏 → 按 show 执行；
 *   ② AI 已出 ```card 单卡 → 不兜底；
 *   ③ **以上都没有** → 前端用 4 条正则（工资/货损/返利/预报）扫**用户原话**，
 *      命中就额外 push 一条"顺手把…拉出来了："——**不 await、不看 AI 说了什么**。
 *
 * 而 SOUL.md（Web-only 段，线上 `/root/.hermes/SOUL.md` 第 71 行）明确要求：
 *   「没有卡要展示时，就完全不要输出这个围栏（不要写 {"show":[]}）」
 *   ⇒ AI 越守协议（不该出卡就不出围栏），前端越判成"AI 没表态"而补卡。**协议互相打架。**
 *
 * 本探针走**真链路真模型**（不拦 fetch），用三个边界问题看兜底会不会自作主张：
 *   Q1 写一段跟员工解释工资晚发的话     —— 纯文字请求，含"工资" ⇒ 预期：**不该有卡**
 *   Q2 这个月工资多少                   —— 数据请求              ⇒ 预期：该有卡（AI 自己出 或 兜底）
 *   Q3 工资是怎么核算的、提成规则是什么 —— 制度咨询              ⇒ 预期：**不该有卡**
 *
 * 判据：每条问题后统计「助手侧自动卡消息」（正文含"拉出来了"且以"顺手"开头）。
 *   Q1/Q3 出现 = FAIL（突兀）；Q2 无卡 = 也要记（说明 AI 判定不覆盖，需另议）
 *
 * 用法：node v627-keyword-card-probe.mjs            # 生产
 *      HG_BASE=http://127.0.0.1:5173 node ...        # 本地 dev
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import { freshChat, JS_OPEN_ART } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cp-fresh.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TAG = process.env.HG_TAG || 'run'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

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

/** 副驾状态：助手消息列表 + 自动卡清单 + 卡片数 */
const JS_STATE = `(() => {
  const aside = document.querySelector('.copilot')
  if (!aside) return JSON.stringify({ open: false })
  // 🔴 消息根类是 msg + m.role（user / assistant），不是 is-user / is-assistant
  //   卡片根类是 ResultCard 的 .rc，不是 res-card —— 上一版这两处都写错，
  //   导致"AI 回复首句"取到的是用户提问、卡片数恒 0（假阴性）。
  const msgs = [...document.querySelectorAll('.cp-body .msg')]
  const list = msgs.map((m, i) => {
    const r = m.querySelector('.msg-role')
    const tx = (m.innerText || '').replace(/\\s+/g, ' ').trim()
    return {
      i,
      role: r ? r.textContent.trim() : '',
      isUser: m.classList.contains('user'),
      tx: tx.slice(0, 90),
      hasCard: !!m.querySelector('.rc')
    }
  })
  // 系统自动补的经营卡：正文以「顺手」开头且含「拉出来了」
  const auto = list.filter(o => !o.isUser && o.tx.indexOf('顺手') === 0 && o.tx.indexOf('拉出来了') > -1)
  const asst = list.filter(o => !o.isUser)
  return JSON.stringify({
    open: true,
    typing: aside.classList.contains('is-typing'),
    total: list.length, asst: asst.length,
    auto: auto.map(o => ({ role: o.role, tx: o.tx })),
    cards: document.querySelectorAll('.cp-body .rc').length,
    last: asst.length ? asst[asst.length-1].tx : ''
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

/** 等一轮真模型回复结束：**必须**先看到新的助手消息，且 `.copilot.is-typing` 落回 false，
 *  再连续 2 次文本不变。上一版只等「文本不变」，用户提问刚上屏就稳定 3.6s ⇒ 提前判定，
 *  拿到的是用户自己那句话（生产实测：3 个问题 24 秒跑完，全是假阴性）。 */
async function waitTurn(page, prevAsst, budgetMs = 180000) {
  const t0 = Date.now()
  let lastLen = -1, stable = 0, st = null, sawNew = false, sawIdle = false
  while (Date.now() - t0 < budgetMs) {
    await sleep(1200)
    st = JSON.parse(await page.eval(JS_STATE))
    if (!st.typing) sawIdle = true
    if (st.asst > prevAsst) sawNew = true
    if (!sawNew) { stable = 0; continue }
    if (st.typing) { stable = 0; lastLen = st.last.length; continue }
    if (st.last.length === lastLen) stable++
    else { stable = 0; lastLen = st.last.length }
    if (stable >= 2) return st
  }
  log('  ⏱ 超时（' + Math.round(budgetMs/1000) + 's）：sawNew=' + sawNew + ' sawIdle=' + sawIdle)
  return st
}

const browser = await launch({})
const page = await browser.newPage()
await page.enable()
await page.goto(BASE, 2500)
log('演示登录:', await page.eval(JS_LOGIN_DEMO))
await page.goto(BASE + '/#/forecast', 2500)
await page.eval(JS_HOOK)
log('构建号:', await page.eval(`(() => (window.__HG_BUILD__||'?'))()`))

log('打开副驾:', await page.eval(JS_OPEN))
for (let i = 0; i < 30; i++) {
  const s = JSON.parse(await page.eval(JS_STATE))
  if (s.open) break
  await sleep(400)
}

log('新对话:', await freshChat(page, sleep))
log('展开团队菜单:', await page.eval(JS_OPEN_MENU))
await sleep(500)
log('选「会计」:', await page.eval(pickRole('会计')))
await sleep(700)

const QUESTIONS = [
  { k: 'Q1', q: '帮我写一段跟员工解释这个月工资晚几天发的话', expect: 'no-card', why: '纯文字请求（含"工资"关键词）' },
  { k: 'Q2', q: '这个月工资多少', expect: 'card', why: '数据请求' },
  { k: 'Q3', q: '工资是怎么核算的，提成规则是什么', expect: 'no-card', why: '制度咨询（含"工资/提成"关键词）' },
]

const results = []
let prev = JSON.parse(await page.eval(JS_STATE)).asst
for (const item of QUESTIONS) {
  log('\n── ' + item.k + ' ' + item.why + ' ──')
  log('  问：' + item.q)
  const before = JSON.parse(await page.eval(JS_STATE))
  log('  发问:', await page.eval(ask(item.q)))
  const st = await waitTurn(page, before.asst)
  const autoBefore = before.auto.length
  const cardBefore = before.cards
  const newAuto = st.auto.slice(autoBefore)
  const cardInc = st.cards - cardBefore
  log('  助手消息 ' + before.asst + ' → ' + st.asst + '，兜底插话增量 ' + newAuto.length + '，卡片增量 ' + cardInc)
  log('  AI 回复：' + (st.last || '').slice(0, 80))
  if (newAuto.length) log('  ⚠ 兜底插话：' + JSON.stringify(newAuto.map(a => a.role + '｜' + a.tx.slice(0, 30))))

  // 判据：
  //   no-card → **兜底插话必须为 0**（AI 自己决定出不出卡不管，关键是别凭空多一条）
  //   card    → 卡片必须有（AI 自己出也算）
  const pass = item.expect === 'no-card' ? newAuto.length === 0 : cardInc > 0
  results.push({ k: item.k, expect: item.expect, autoInc: newAuto.length, cardInc, pass })
  log('  判据（预期 ' + item.expect + '）：' + (pass ? '✅ PASS' : '❌ FAIL'))
  prev = st.asst
}

log('\n===== 汇总 =====')
for (const r of results) log(r.k + '  预期 ' + r.expect + '  兜底插话 ' + r.autoInc + '  卡片增量 ' + r.cardInc + '  ' + (r.pass ? '✅' : '❌'))
const allPass = results.every(r => r.pass)
log(allPass ? '\n✅ 全部符合预期' : '\n❌ 有不符合预期的场景（见上）')
log('页面报错:', await page.eval(JS_ERRS))
await browser.close()
process.exit(allPass ? 0 : 1)
