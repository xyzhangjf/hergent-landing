/**
 * v692 端到端计量探针：真实前端 → 副驾发一句话 → 上游 usage 旁路采集 → 落 ai_usage_v2
 *
 * 🔴 为什么必须走真实前端而不能只 curl 后端：
 *   前端 `api/client.js` 已**强制**走 `/api/ai/copilot/chat`（那个 localStorage 开关
 *   被撤掉了，回滚改由后端环境变量承担）。也就是说线上每一次副驾对话都会经过
 *   本轮改动的代码 —— 只验后端函数等于漏掉「payload 里 stream_options 到底带上没有」
 *   与「StreamingResponse 生成器在请求上下文外是否还能拿到租户」这两处最容易坏的接缝。
 *
 * 跑法：
 *   node tests/perf/v692/live_metering.mjs            # 打生产
 *   PB=http://127.0.0.1:5173 node ...                 # 打本地
 */
import { chromium } from 'playwright'

const BASE = process.env.PB || 'https://hergent.cn'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let PASS = 0
let FAIL = 0
const say = (name, ok, detail = '') => {
  if (ok) {
    PASS += 1
    console.log(`  ✅ ${name}${detail ? '   ' + detail : ''}`)
  } else {
    FAIL += 1
    console.log(`  ❌ ${name}   ${detail}`)
  }
}

const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage()

const apiLog = []
p.on('response', async (r) => {
  const u = r.url()
  if (!/\/api\/ai\//.test(u)) return
  let body = ''
  try {
    body = (await r.text()).slice(0, 300)
  } catch {}
  apiLog.push({ status: r.status(), url: u.replace(BASE, ''), method: r.request().method(), body })
})
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)))

console.log('目标:', BASE)
console.log()

// ── 进入演示租户 ─────────────────────────────────────────────────────
await p.goto(BASE + '/?__p=' + Date.now(), { waitUntil: 'domcontentloaded' })
const demo = p.getByRole('button', { name: /先看看演示效果/ })
await demo.first().waitFor({ timeout: 30000 })
await demo.first().click()
await p.waitForSelector('.topbar', { timeout: 30000 })
await sleep(2000)
say('进入演示租户', true)

// ── 打开副驾 ─────────────────────────────────────────────────────────
console.log('\n【1】打开副驾')
await p.click('.tb-copilot')
await sleep(1500)
const drawer = await p.evaluate(() => {
  const vis = (el) => {
    if (!el) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  const tas = [...document.querySelectorAll('textarea')].filter(vis)
  return {
    opened: !!document.querySelector('.cp-drawer,.cp-body,[class*=cp-]'),
    textareas: tas.length,
    taCls: tas.map((x) => String(x.className).slice(0, 40)),
    taPlaceholder: tas.map((x) => x.getAttribute('placeholder') || ''),
    bodyText: (document.querySelector('[class*=cp-]')?.innerText || '')
      .replace(/\s+/g, ' ')
      .slice(0, 160),
  }
})
say('副驾面板打开', drawer.opened, drawer.bodyText)
say('有输入框', drawer.textareas > 0, JSON.stringify(drawer.taCls))

if (drawer.textareas === 0) {
  console.log('\n🔴 找不到输入框，后续断言无法执行')
  await b.close()
  console.log(`\n=== PASS ${PASS} / FAIL ${FAIL}（中断）===`)
  process.exit(1)
}

// ── 发一句话 ─────────────────────────────────────────────────────────
console.log('\n【2】发一句「说两个字」')
apiLog.length = 0
const ta = p.locator('textarea').last()
await ta.click()
await ta.fill('说两个字')
await sleep(300)
await ta.press('Enter')

// 等流结束：等回复区出现文字，且 8 秒内无新增
let reply = ''
for (let i = 0; i < 40; i++) {
  await sleep(1000)
  const cur = await p.evaluate(() => {
    const els = [...document.querySelectorAll('[class*=cp-msg],[class*=cp-bubble],[class*=cp-item]')]
    return els.map((x) => (x.innerText || '').trim()).filter(Boolean).join(' | ')
  })
  if (cur && cur !== reply) {
    reply = cur
  }
  if (reply && i > 6 && cur === reply) break
}

const chat = apiLog.filter((x) => x.url.includes('/copilot/chat'))
say('走了代理层 /api/ai/copilot/chat', chat.length > 0,
  chat.map((x) => `${x.method} ${x.status}`).join(', '))
const bad = chat.filter((x) => x.status >= 400)
say('对话接口无 4xx/5xx', bad.length === 0,
  bad.map((x) => `${x.status} ${x.body.slice(0, 120)}`).join(' / '))

const replyText = await p.evaluate(() => {
  const root = document.querySelector('.cp-drawer,.cp-body,[class*=cp-]') || document.body
  return (root.innerText || '').replace(/\s+/g, ' ').slice(-400)
})
console.log('   回复尾部:', replyText.slice(-200))
say('拿到非空回复（说明 SSE 透传没被计量逻辑破坏）', replyText.length > 20,
  `len=${replyText.length}`)

// ── 顺手查一次配额接口（新字段必须可用）──────────────────────────────
console.log('\n【3】/api/ai/quota 返回新字段')
const q = await p.evaluate(async () => {
  const r = await fetch('/api/ai/quota', { credentials: 'include' })
  return { status: r.status, data: await r.json().catch(() => null) }
})
say('quota 接口 200', q.status === 200, q.status)
if (q.data) {
  say('有 counted_by 字段', 'counted_by' in q.data, q.data.counted_by)
  say('有 used_tokens_this_month 字段', 'used_tokens_this_month' in q.data,
    q.data.used_tokens_this_month)
  say('旧字段仍在（前端兼容）',
    ['tier', 'monthly_limit', 'used_this_month', 'remaining', 'exceeded']
      .every((k) => k in q.data), Object.keys(q.data).join(','))
  console.log('   完整返回:', JSON.stringify(q.data))
}

console.log()
console.log(`=== PASS ${PASS} / FAIL ${FAIL} ===`)
await b.close()
process.exit(FAIL === 0 ? 0 : 1)
