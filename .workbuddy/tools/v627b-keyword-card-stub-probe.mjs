/**
 * v627b：证明「前端关键词兜底」会覆盖 AI 已按协议做出的判断
 *
 * 不需要真模型 —— 要验证的是**前端逻辑**，所以用确定性桩控制 AI 输出。
 *
 * 协议事实（已核对线上 `/root/.hermes/SOUL.md` 第 71 行 + `server/reply_protocol.py` 108-118）：
 *   SOUL.md（Web 端实际生效）：「没有卡要展示时，就**完全不要输出**这个围栏（不要写 {"show":[]}）」
 *   reply_protocol.py        ：「纯文字回复写 {"show":[]}」（与上条相反）
 *   前端 CopilotDrawer 3192：
 *     `if (cardIntent) fireCards(...) else if (!aiCarded && !DENY_RE.test(q)) triggerCards(q)`
 *     ⇒ **无围栏 = 判成"AI 没表态"**，于是用 4 条正则扫用户原话补卡。
 *
 *   ⇒ AI 越守 SOUL（该不出卡就不出围栏），前端越要硬插一条「顺手把…拉出来了：」。
 *
 * 场景（都含"工资"关键词，但都属于"AI 应判断为不需要卡"）：
 *   S1 桩：纯文字、无任何围栏（= SOUL 的正确产出）      → 预期：0 条兜底插话
 *   S2 桩：纯文字 + ```cards {"show":[]}（= reply_protocol 的写法） → 预期：0 条
 *   S3 桩：纯文字、无围栏，用户问"写一段解释工资晚发的话"   → 预期：0 条
 *
 * 用法：node v627b-keyword-card-stub-probe.mjs
 */
import { launch } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cdp-lite.mjs'
import { freshChat } from '/Users/zhangjunfeng/Documents/laozhangai-product/.workbuddy/tools/lib/cp-fresh.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const TAG = process.env.HG_TAG || 'run'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

/** 桩：按 window.__STUB_TXT__ 指定的正文回 SSE（只拦 copilot/chat） */
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
  .then(r=>r.json()).then(d=>{
    if(!d.token) return JSON.stringify({ok:false})
    localStorage.setItem('hergent_v2_token', d.token)
    localStorage.setItem('hergent_v2_tenant', String(d.tenant_id))
    localStorage.setItem('hergent_v2_user', JSON.stringify(d.user))
    return JSON.stringify({ok:true, tenant:d.tenant_id})
  })`

const JS_OPEN = `(() => { const b = document.querySelector('.tb-copilot'); if (!b) return 'no-btn'; b.click(); return 'ok' })()`

const JS_STATE = `(() => {
  const aside = document.querySelector('.copilot')
  if (!aside) return JSON.stringify({ open: false })
  const els = [...document.querySelectorAll('.cp-body .msg')]
  const list = els.map((m) => {
    const tx = (m.innerText || '').replace(/\\s+/g, ' ').trim()
    return {
      isUser: m.classList.contains('user'),
      hasCard: !!m.querySelector('.rc'),
      hasBubble: !!m.querySelector('.msg-bubble'),
      tx
    }
  })
  const asst = list.filter(o => !o.isUser)
  const cardMsgs = asst.filter(o => o.hasCard)
  return JSON.stringify({
    open: true,
    typing: aside.classList.contains('is-typing'),
    asst: asst.length,
    cardMsgs: cardMsgs.length,
    // 卡消息的文本：v627 起应只剩「经营数据 + 时间」（无正文）；含"拉出来了"= 还在替 AI 说话
    cardTexts: cardMsgs.map(o => o.tx.slice(0, 50)),
    // 卡消息里还渲染着空气泡的数量（应为 0：有卡无正文时整个 .msg-bubble 不渲染）
    cardWithBubble: cardMsgs.filter(o => o.hasBubble).length,
    cards: document.querySelectorAll('.cp-body .rc').length,
    last: asst.length ? asst[asst.length-1].tx.slice(0, 60) : ''
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

/** 桩是秒回，等流式结束即可 */
async function waitDone(page, prevAsst, budgetMs = 30000) {
  const t0 = Date.now()
  let st = null
  while (Date.now() - t0 < budgetMs) {
    await sleep(500)
    st = JSON.parse(await page.eval(JS_STATE))
    if (st.asst > prevAsst && !st.typing) {
      await sleep(900)   // 给兜底卡一个落地窗口（它不 await）
      return JSON.parse(await page.eval(JS_STATE))
    }
  }
  return st
}

const BROWSER = await launch({})
const page = await BROWSER.newPage()
await page.enable()
await page.goto(BASE, 2500)
log('演示登录:', await page.eval(JS_LOGIN_DEMO))
const sid = await page.addInitScript(STUB)
await page.goto(BASE + '/#/forecast', 1800)
await page.raw.send('Page.reload', {})
await sleep(6000)
await page.removeInitScript(sid)
log('构建号:', await page.eval(`(() => (window.__HG_BUILD__||'?'))()`))

log('打开副驾:', await page.eval(JS_OPEN))
for (let i = 0; i < 30; i++) {
  const s = JSON.parse(await page.eval(JS_STATE))
  if (s.open) break
  await sleep(400)
}
log('新对话:', await freshChat(page, sleep))
log('展开菜单:', await page.eval(JS_OPEN_MENU))
await sleep(500)
log('选「会计」:', await page.eval(pickRole('会计')))
await sleep(700)

/* 桩正文：三种"AI 已按协议判断为不需要卡"的产出 */
const CASES = [
  {
    k: 'S1', why: '纯文字、无围栏（SOUL 的正确产出）',
    q: '工资最近怎么样，帮我写一段跟员工解释晚几天发的话',
    txt: '【结论】本月工资表还在核对，预计 25 号发。\n【下一步】需要的话我可以帮你起个通知稿。'
  },
  {
    k: 'S2', why: '纯文字 + {"show":[]}（reply_protocol 的写法）',
    q: '这个月工资大概什么情况，写个说明给我',
    txt: '【结论】工资明细已核对。\n\n```cards\n{"show":[]}\n```'
  },
  {
    k: 'S3', why: '纯文字、无围栏，纯写作请求',
    q: '帮我写一段跟员工解释这个月工资晚几天发的话',
    txt: '【结论】可以这样跟员工说：本月工资因对账延后，预计 25 号前发放。'
  },
  // S4 反向红线：AI **主动要卡**时必须照出（删兜底不能把正常出卡一起删掉）
  // 注意用「这个月发多少」—— 原话里没有"工资"二字，旧版 makeFetcher 的正则前置会把它拦掉，
  // 这一条同时守着「AI 意图被前端正则吞掉」那个缺陷。
  {
    k: 'S4', why: 'AI 明确要工资卡（原话不含"工资"，守反向红线）',
    q: '这个月发多少',
    txt: '【结论】本月应发合计见卡。\n\n```cards\n{"show":["wage"]}\n```',
    expectCard: true
  }
]

const results = []
for (const c of CASES) {
  await page.eval(`(() => { window.__STUB_TXT__ = ${JSON.stringify(c.txt)}; return 1 })()`)
  const before = JSON.parse(await page.eval(JS_STATE))
  log('\n── ' + c.k + ' ' + c.why + ' ──')
  log('  问：' + c.q)
  await page.eval(ask(c.q))
  const st = await waitDone(page, before.asst)
  const asstInc = st.asst - before.asst
  const cardInc = st.cards - before.cards
  log('  助手消息 ' + before.asst + ' → ' + st.asst + '（+' + asstInc + '），卡片增量 ' + cardInc)
  if (st.cardMsgs > before.cardMsgs) {
    const added = st.cardTexts.slice(before.cardMsgs)
    log('  新卡消息正文：' + JSON.stringify(added))
    log('  卡消息气泡数（应为 0）：' + (st.cardWithBubble - before.cardWithBubble))
  }
  let pass, expect
  if (c.expectCard) {
    // AI 主动要卡：必须出卡；消息 +2（AI 回复 + 卡消息）；卡消息**不得有正文/气泡**
    expect = '出卡 + 卡消息无正文无气泡'
    const noText = st.cardTexts.every(t => t.indexOf('拉出来了') < 0)
    pass = cardInc > 0 && noText && (st.cardWithBubble - before.cardWithBubble) === 0
    if (!noText) log('  ⚠ 卡消息仍带拟人开场白')
  } else {
    // 不该出卡的场景：助手消息只 +1（只有 AI 那句话），且不出卡
    expect = '只 +1 条 AI 回复、不出卡'
    pass = asstInc === 1 && cardInc === 0
    if (asstInc > 1) log('  ⚠ 凭空多出 ' + (asstInc - 1) + ' 条助手消息')
  }
  results.push({ k: c.k, asstInc, cardInc, pass })
  log('  判据（预期 ' + expect + '）：' + (pass ? '✅ PASS' : '❌ FAIL'))
}

log('\n===== 汇总 =====')
for (const r of results) log(r.k + '  助手消息 +' + r.asstInc + '  卡片增量 ' + r.cardInc + '  ' + (r.pass ? '✅' : '❌'))
const allPass = results.every(r => r.pass)
log(allPass ? '\n✅ 前端未越权补卡' : '\n❌ 前端在 AI 已判断的情况下仍硬插了消息')
await BROWSER.close()
process.exit(allPass ? 0 : 1)
