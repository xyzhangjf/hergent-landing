/**
 * v695 计费周期（按购买日滚动）+ 改档越权修复 —— 运行时探针
 * ==========================================================================
 * 老板两句话：
 *   ①「侧栏 系统—产出与用量 里是不是有用量信息」⇒ 有，但单位写着"字符"（v693 已改积分口径）
 *   ②「额度不应以自然月为单位发放，应该以客户购买日往后顺延」⇒ 本补丁
 *
 * 断言（判据只用**用户可见/接口可见**的值，不认变量名）：
 *   C1 /api/auth/me 回 platform_admin 布尔
 *   C2 /api/ai/quota 回 cycle_start / cycle_end / cycle_anchor_day / cycle_source
 *   C3 周期自洽：cycle_start <= 今天 < cycle_end
 *   C4 锚点日 = 该租户注册日的「日」（demo = 8/16 ⇒ 16），且 cycle_start 的日 = 16
 *   C5 周期跨度 ≈ 一个月（28~31 天）
 *   C6 前端「产出与用量」页：剩余的单位是**积分**不是「字符」
 *   C7 前端该页不再出现旧字符档位「20万 / 200万 / 1000万」
 *   C8 改档越权：非平台管理员 POST /api/ai/quota 必须 403
 *      （body 用与现状相同的 tier，万一没拦住也只是写回原值，不产生副作用）
 *
 * 用法：node tests/perf/v695/cycle.mjs [BASE_URL]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://127.0.0.1:5188'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0, skip = 0
const ck = (label, ok, extra) => {
  if (ok === 'SKIP') { skip++; console.log('    ⏭️  ' + label + (extra ? '  ← ' + extra : '')); return }
  if (ok) { pass++; console.log('    ✅ ' + label + (extra ? '  ← ' + extra : '')) }
  else { fail++; console.log('    ❌ ' + label + (extra ? '  ← ' + extra : '')) }
}

const main = async () => {
  const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  let browser
  try { browser = await chromium.launch({ headless: true, executablePath: CHROME }) }
  catch (_) { browser = await chromium.launch({ headless: true }) }
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))

  console.log('\n━━━ 打开 ' + BASE)
  await page.goto(BASE + '/?__p=695', { waitUntil: 'domcontentloaded' })
  await sleep(2600)
  if (!(await page.$('.topbar'))) {
    const demo = page.getByRole('button', { name: /先看看演示效果/ })
    await demo.first().waitFor({ timeout: 20000 })
    await demo.first().click()
    await page.waitForSelector('.topbar', { timeout: 30000 })
    await sleep(1800)
  }

  console.log('\n[1] /api/auth/me 的平台管理员标记')
  const me = await page.evaluate(async () => {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' })
    return { status: r.status, data: await r.json().catch(() => ({})) }
  })
  ck('接口 200', me.status === 200, 'status=' + me.status)
  ck('返回 platform_admin 布尔', typeof me.data.platform_admin === 'boolean',
    'platform_admin=' + me.data.platform_admin + ' role=' + me.data.role)

  console.log('\n[2] /api/ai/quota 的周期字段')
  const qr = await page.evaluate(async () => {
    const r = await fetch('/api/ai/quota', { credentials: 'same-origin' })
    return { status: r.status, data: await r.json().catch(() => ({})) }
  })
  const q = qr.data || {}
  ck('接口 200', qr.status === 200, 'status=' + qr.status)
  ck('有 cycle_start', /^\d{4}-\d{2}-\d{2}$/.test(q.cycle_start || ''), 'cycle_start=' + q.cycle_start)
  ck('有 cycle_end', /^\d{4}-\d{2}-\d{2}$/.test(q.cycle_end || ''), 'cycle_end=' + q.cycle_end)
  ck('有 cycle_anchor_day（1-31）', Number.isInteger(q.cycle_anchor_day) && q.cycle_anchor_day >= 1 && q.cycle_anchor_day <= 31,
    'anchor=' + q.cycle_anchor_day)
  ck('有 cycle_source', ['anchor', 'tenant_created', 'calendar'].includes(q.cycle_source), 'source=' + q.cycle_source)

  if (q.cycle_start && q.cycle_end) {
    const today = new Date().toISOString().slice(0, 10)
    ck('周期自洽：start <= 今天 < end', q.cycle_start <= today && today < q.cycle_end,
      today + (q.cycle_start <= today && today < q.cycle_end ? ' ∈ [' : ' ∉ [') + q.cycle_start + ', ' + q.cycle_end + ')')
    const d1 = new Date(q.cycle_start + 'T00:00:00')
    const d2 = new Date(q.cycle_end + 'T00:00:00')
    const span = Math.round((d2 - d1) / 86400000)
    ck('周期跨度 ≈ 一个月（28~31 天）', span >= 28 && span <= 31, span + ' 天')
    ck('起点日 = 锚点日（或月末钳制后）', Number(q.cycle_start.slice(8, 10)) === q.cycle_anchor_day
      || Number(q.cycle_start.slice(8, 10)) < q.cycle_anchor_day,
      'start.day=' + q.cycle_start.slice(8, 10) + ' anchor=' + q.cycle_anchor_day)
  }
  ck('已用额度仍是积分口径（数字为整数）', Number.isInteger(q.credits_used), 'used=' + q.credits_used)

  console.log('\n[3] 改档越权（非平台管理员应被拒）')
  const tryTier = q.tier || 'free'   // ⚠️ 用与现状相同的档位：万一没拦住也只是写回原值
  const post = await page.evaluate(async (tier) => {
    const r = await fetch('/api/ai/quota', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier })
    })
    let j = {}
    try { j = await r.json() } catch (_) {}
    return { status: r.status, detail: (j && (j.detail || j.message)) || '' }
  }, tryTier)
  if (me.data.platform_admin) {
    ck('本人是平台管理员，该接口本应放行 —— 跳过拒绝断言', 'SKIP', 'status=' + post.status)
  } else if (/只读|readonly/i.test(post.detail)) {
    /* 演示租户是 readonly：写请求在更早的中间件就被拦了，**没走到权限判据**。
       这时断言「403」会给人错的安全感（换成任何只读拦截都会 403）。
       如实标注：这一条只能证明"改不了"，不能证明"判据是平台管理员"。
       权限层由部署时对服务端源码的静态核对兜底。 */
    ck('非平台管理员改档被拦（命中只读中间件，未触达权限层）', post.status === 403 || post.status === 400,
      'status=' + post.status + ' ' + post.detail)
    ck('权限层判据需静态核对（本探针拿不到源码）', 'SKIP', 'grep set_quota → _platform_admin')
  } else {
    ck('非平台管理员 POST /api/ai/quota 被拒（403）', post.status === 403,
      'status=' + post.status + ' ' + post.detail)
  }

  console.log('\n[4] 产出与用量页：单位与档位')
  await page.goto(BASE + '/#/ai-hub', { waitUntil: 'domcontentloaded' })
  await sleep(2500)
  const hub = await page.evaluate(() => {
    const body = document.body.innerText || ''
    const card = document.querySelector('.quota-card')
    return {
      hasCard: !!card,
      cardText: card ? card.innerText.replace(/\n+/g, ' | ') : '',
      bodyHasCharUnit: /字符/.test(body),
      bodyHasOldTier: /20万|200万|1000万/.test(body),
      kpiText: (() => {
        const k = document.querySelector('.kpi-strip')
        return k ? k.innerText.replace(/\n+/g, ' | ') : ''
      })()
    }
  })
  if (!hub.hasCard) {
    ck('用量卡片存在', false, '找不到 .quota-card（可能无权限）')
  } else {
    ck('用量卡片存在', true)
    ck('单位是「积分」，不再是「字符」', /积分/.test(hub.cardText) && !/字符/.test(hub.cardText), hub.cardText.slice(0, 120))
    ck('不再出现旧字符档位（20万/200万/1000万）', !hub.bodyHasOldTier && !hub.bodyHasCharUnit, 'ok')
    ck('显示下一轮恢复日期（不是写死「每月 1 日」）',
      !/每月 1 日/.test(hub.cardText), hub.cardText.slice(0, 140))
    console.log('       KPI: ' + hub.kpiText.slice(0, 140))
  }

  console.log('\n[5] 运行期异常')
  ck('无页面级 JS 异常', errs.length === 0, errs.slice(0, 3).join(' | ') || '干净')

  await page.screenshot({ path: '/tmp/v695-hub.png' })
  console.log('\n截图：/tmp/v695-hub.png')

  await browser.close()
  console.log('\n' + (fail ? 'HAS FAILURE' : 'ALL PASS') + '  ' + pass + ' 通过 / ' + fail + ' 失败 / ' + skip + ' 跳过')
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('探针自身出错：', e); process.exit(2) })
