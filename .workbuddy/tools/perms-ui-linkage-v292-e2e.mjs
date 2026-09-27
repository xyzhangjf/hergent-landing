/**
 * perms-ui-linkage-v292-e2e.mjs —— 「权限变更 ⇒ UI 同步调整」真机验收（生产 hergent.cn）
 *
 * 设计要点（为什么这样测才算数）：
 *  1. 打**生产真站**、用**真账号登录**（mptest = sales / tenant 1），走真构建产物。
 *  2. **零写入生产**：整条链只读 `/api/auth/permissions` 与 `/api/auth/perms-rev`；
 *     "权限被改过"这件事用 Playwright 的**响应改写**模拟（只改交给前端的那份 JSON），
 *     绝不 POST `/api/role-permissions`。这样才敢在老板的生产租户上跑。
 *  3. **反例对照**：先证明"权限没变时**不**重拉"（否则"每次都在重拉"也能让正例通过，
 *     等于什么都没证明）。
 *  4. 三个层次各有一项断言：① 保存后即时（设置页代码，另测）② 导航时比对 ③ 切回标签页比对。
 */
import { chromium } from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/playwright/index.mjs'

const BASE = process.env.HG_BASE || 'https://hergent.cn'
const USER = process.env.HG_USER || 'mptest'
const PASS = process.env.HG_PASS || 'Mptest@1'
let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  ✅ ' + n + (e !== undefined ? '　→ ' + e : '')) } else { fail++; console.log('  ❌ ' + n + (e !== undefined ? '　→ ' + e : '')) } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message))

/* ---- 请求记账：区分两个端点，记录正文 ---- */
const hits = { rev: [], perms: [] }
page.on('response', async (res) => {
  const u = res.url()
  try {
    if (/\/api\/auth\/perms-rev(\?|$)/.test(u)) hits.rev.push({ rev: (await res.json()).perms_rev })
    else if (/\/api\/auth\/permissions(\?|$)/.test(u)) hits.perms.push(await res.json())
  } catch (_) {}
})
/* 零写入自证：全程监听**非 GET** 请求（登录 POST 本身是探针自己发的，排除掉）。
   ⚠️ 必须在这一行就开始记 —— 之前放在脚本末尾，只能证明"最后 300ms 没写"，等于没证。 */
const writes = []
page.on('request', (r) => {
  if (r.method() === 'GET') return
  if (/\/api\/auth\/login(\?|$)/.test(r.url())) return
  writes.push(r.method() + ' ' + r.url())
})

/* ---- 登录（把凭证写进 localStorage，与真前端同一套键） ---- */
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
const loginRes = await page.evaluate(async ([u, p]) => {
  const r = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  })
  const d = await r.json()
  if (!d.token) return 'NO:' + JSON.stringify(d).slice(0, 120)
  localStorage.setItem('hergent_v2_token', d.token)
  if (d.csrf_token) localStorage.setItem('hergent_v2_csrf', d.csrf_token)
  if (d.user) localStorage.setItem('hergent_v2_user', JSON.stringify(d.user))
  if (d.tenant_id) localStorage.setItem('hergent_v2_tenant', String(d.tenant_id))
  return 'OK:' + d.user.role + ':' + d.tenant_id
}, [USER, PASS])
ok(String(loginRes).startsWith('OK:'), '真账号登录（' + USER + '）', loginRes)
if (!String(loginRes).startsWith('OK:')) { await browser.close(); process.exit(1) }

/* ---- 抓侧栏：桌面 .sb-item 的文案数组 ---- */
const SIDEBAR = '(()=>[].slice.call(document.querySelectorAll(".sb-item")).map(e=>e.innerText.replace(/\\s+/g,"").trim()))()'

await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForSelector('.sb-item', { timeout: 20000 })
await sleep(1200)
const base = await page.evaluate(SIDEBAR)
console.log('  基线侧栏（' + base.length + ' 项）：' + base.join(' / '))
ok(hits.perms.length >= 1, '启动即拉过 /api/auth/permissions', hits.perms.length + ' 次')
ok(hits.rev.length >= 1, '启动那次导航已做过版本比对（层次②接线在）', hits.rev.length + ' 次')
const full = hits.perms[hits.perms.length - 1] || {}
ok(typeof full.perms_rev === 'string' && /^[0-9a-f]{12}$/.test(full.perms_rev),
   '/permissions 带 perms_rev（12 位十六进制）', JSON.stringify(full.perms_rev))
ok(Array.isArray(full.custom_roles), '/permissions 带 custom_roles 数组', JSON.stringify(full.custom_roles))
ok(full.user && full.permissions && full.tenant_id && full.plan && full.capabilities,
   '既有键一个没少（小程序共用红线：只加不改）',
   'user/permissions/tenant_id/plan/capabilities 齐')
ok(hits.rev[hits.rev.length - 1].rev === full.perms_rev,
   '两个端点给出的版本号一致（同一份实现，不可能漂移）',
   hits.rev[hits.rev.length - 1].rev + ' == ' + full.perms_rev)

/* ---- 层次②：导航时比对（权限无变化 ⇒ 只比对、不重拉）----
   🔴 为什么必须等 >20 秒再点：`refreshPermsIfChanged()` 有 **20 秒节流**（见 store/index.js），
   启动那次导航已经把节流计时器点着了 ⇒ 紧接着点菜单会被节流挡掉，看起来像"没接线"。
   —— 这正是"测之前先读被测代码"的价值：这类失败是**探针的错**，不是产品的错。 */
console.log('\n层次② 导航时比对 —— 反例对照：权限没变时不该重拉（等 21 秒过掉节流）')
const nRev0 = hits.rev.length, nPerm0 = hits.perms.length
await sleep(21000)
await page.click('a[href="#/archive"]')          // 真换页（不能点当前页，同路由 push 会被 vue-router 短路掉、根本不进守卫）
await sleep(1600)
ok(hits.rev.length > nRev0, '导航触发了 /api/auth/perms-rev 比对', hits.rev.length - nRev0 + ' 次')
ok(hits.perms.length === nPerm0, '**反例对照**：版本一致 ⇒ 不重拉 /permissions', hits.perms.length - nPerm0 + ' 次')

/* ---- 层次③ + 正例：权限「被改过」⇒ 重拉 ⇒ 菜单同步重排 ------------------- */
console.log('\n层次③/正例：模拟权限被改过（响应改写，零写入生产）')
let FAKE_REV = 'deadbeef0000'
/* 🔴 用「基线 ⊕ 增量」来表达模拟，而不是每次拿上一次的结果继续改 ——
   前两版探针就栽在这：第二次 `filter` 是作用在**真实**权限上的，于是把第一次追加的
   `payroll` 一起抹掉了，条数变化从 -1 变成 -2，看起来像产品"连带串改"。
   探针的状态机写错，会把好产品报成坏产品 —— 和"把坏产品放过"一样贵。 */
const EXTRA = ['payroll']        // 追加
const DROP = []                  // 回收
const MUTATE = (perms) => perms.filter((m) => !DROP.includes(m)).concat(EXTRA.filter((m) => !perms.includes(m)))
await ctx.route('**/api/auth/perms-rev*', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ perms_rev: FAKE_REV, tenant_id: full.tenant_id }) })
})
await ctx.route('**/api/auth/permissions*', async (route) => {
  const res = await route.fetch()
  const body = await res.json()
  body.perms_rev = FAKE_REV
  body.permissions = MUTATE(Array.isArray(body.permissions) ? body.permissions : [])
  await route.fulfill({ response: res, body: JSON.stringify(body) })
})
const nPerm1 = hits.perms.length
// 触发"切回标签页"那条路（Shell 的 visibilitychange 用 force=true，绕过 20 秒节流）
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
await sleep(2000)
ok(hits.perms.length > nPerm1, '版本不同 ⇒ 自动重拉 /permissions', hits.perms.length - nPerm1 + ' 次')
const after = await page.evaluate(SIDEBAR)
console.log('  追加 payroll 后侧栏（' + after.length + ' 项）：' + after.join(' / '))
ok(after.includes('算工资') && !base.includes('算工资'), '菜单**新增**「算工资」', '基线无 → 现在有')
ok(after.length === base.length + 1, '条数恰好 +1（没有连带串改别处）', base.length + ' → ' + after.length)

console.log('\n正例：模拟权限被回收（在「已追加 payroll」的基础上撤销 chat）')
FAKE_REV = 'deadbeef1111'
DROP.push('chat')
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
await sleep(2000)
const after2 = await page.evaluate(SIDEBAR)
console.log('  撤销 chat 后侧栏（' + after2.length + ' 项）：' + after2.join(' / '))
ok(!after2.includes('AI中心') && after.includes('AI中心'), '菜单**移除**「AI 中心」', '有 → 无')
ok(after2.includes('算工资'), '上一轮新增的「算工资」**不受牵连**（回收项与新增项互不串改）', '仍在')
ok(after2.length === after.length - 1, '条数恰好 -1', after.length + ' → ' + after2.length)

/* ---- 守卫回归：产品硬锁的页面，非 admin/boss **深链**也必须被拦 ----
   🔴 为什么专门测深链：入口靠 `v-if` 藏起来是**藏不住**深链的（书签/历史/手敲 URL）。
      这正是 v275 修过的「假封锁」——"看起来权限做过了，其实没有"。`lock: true` 是本轮
      新加的字段，必须证明它真的进了守卫路径（而不只是文档里的一句话）。 */
console.log('\n守卫回归：深链进受锁页面（sales 身份）')
for (const p of ['/settings', '/cron', '/roles']) {
  await page.goto(BASE + '/#' + p, { waitUntil: 'networkidle' })
  await sleep(1600)
  const hash = await page.evaluate(() => location.hash)
  ok(!hash.startsWith('#' + p), p + ' 深链被守卫挡回（未进入该页）', '落到 ' + hash)
}

/* ---- 收尾：确认全程没有写操作 ---- */
console.log('\n零写入自证（从脚本第一行起就已在记）')
ok(writes.length === 0, '全程未发出任何非 GET 请求（登录 POST 已剔除）',
   writes.length ? JSON.stringify(writes) : '0 个')

console.log('\n' + '='.repeat(64))
console.log(`结果：${pass} 通过 / ${fail} 失败`)
await browser.close()
process.exit(fail ? 1 : 0)
