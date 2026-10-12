/**
 * v472-dev-boss-gate-verify.mjs —— 「四区开发期只给 boss」的**真机验收探针**
 *
 * 覆盖对象（老板原话）：「侧边栏『仓配管理、资金管理、市场营销、数据报表』这几个模块
 *   还在开发阶段，请把他设置成只有我这个 boss 账号可见」。
 *
 * 🔴 为什么不是"在 node 里重抄一份判据来测"：
 *   抄一份就变成"测的是我写的那份副本，不是产品里跑的那份" —— 本项目反复栽在这上面。
 *   本脚本用 `import('/src/constants/pages.js')` **加载产品真文件**（vite dev 直接服务 ESM），
 *   并在**真浏览器里真渲染侧栏**（伪造登录态 + 打桩 `/api/auth/permissions`）——
 *   判据与渲染两层都是产品自己的实现。
 *
 * 三层断言：
 *   A. **真机 DOM**：7 种非 boss 角色下，侧栏四个区名**一个都不出现**；boss 下四个都在。
 *      （含反例对照：`经营工作台` 必须始终在 ⇒ 证明"页面确实渲染了"，不是空断言。）
 *   B. **深链守卫**：非 boss 直接敲 `#/wh/inbound` 被弹回 `/workbench`
 *      —— 这条专治「入口藏了、URL 还能进」的**假封锁**。
 *   C. **判据穷举**（产品真文件）：四区全部登记行 × 角色 × 模块集；
 *      并校验不变量「入口可见 ⇒ 守卫必放行」。
 *   D. **静态护栏**：四个区都声明了准入锚点 `path`（`Shell.vue`），
 *      且锚点路径本身在 `PAGE_RULES` 里是 boss 硬锁
 *      —— 少了锚点，区内的**跨区共享条目**（`/inventory/stock`、`/data-fill`、
 *      `/rebate`、`/dashboard`、`/funds/*`）会把整区对别人露出来。
 *
 * 用法：先起 vite dev（默认 5199），再 `node v472-dev-boss-gate-verify.mjs`
 */
import { readFileSync } from 'node:fs'
import { chromium } from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/playwright/index.mjs'

const BASE = process.env.HG_DEV || 'http://127.0.0.1:5199'
const SHELL_VUE = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/components/Shell.vue'

let pass = 0, fail = 0
const ok = (c, n, e) => {
  if (c) { pass++; console.log('  ✅ ' + n + (e !== undefined ? '　→ ' + e : '')) }
  else { fail++; console.log('  ❌ ' + n + (e !== undefined ? '　→ ' + e : '')) }
}

/* 后端 `core._ALL_MODULES`（22 项）—— 故意用"全模块"当最坏情况：
   若某个非 boss 角色**拿满所有模块**都看不到四区，那模块少的人更不可能看到。 */
const ALL_MODULES = ['dashboard', 'data', 'sales', 'buying', 'stock', 'loss', 'accounts', 'crm',
  'hr', 'payroll', 'projects', 'goals', 'reports', 'chat', 'tasks', 'cron', 'bid', 'messages',
  'forecast', 'forecast-audit', 'inventory', 'funds']

const AREAS = ['仓配管理', '资金管理', '市场营销', '数据报表']
const ANCHORS = { 仓配管理: '/wh/inbound', 资金管理: '/funds/receipt', 市场营销: '/mkt/display', 数据报表: '/reports/sales-order' }
const AREA_PREFIX = ['/wh/', '/funds/', '/mkt/', '/reports/']
const CONTROL = '经营工作台'          // 反例对照：它必须始终可见

/* 非 boss 用例：`custom: [...]` 里带上自己 ⇒ 触发 `roleGateOpen` 第 ③ 档「让位」的前置条件。
   这正是 v345 `/cron` 活洞的复现姿势（本租户改过该角色权限 ⇒ 名单被越过）。
   例：会计持 `funds` + 被改过权限 ⇒ **v472 之前他会看到整个资金管理区**。 */
const CASES = [
  { role: 'admin',       custom: ['admin'] },
  { role: 'accountant',  custom: ['accountant'] },
  { role: 'sales',       custom: ['sales'] },
  { role: 'supervisor',  custom: ['supervisor'] },
  { role: 'staff',       custom: ['staff'] },
  { role: 'guide',       custom: ['guide'] },
  { role: '库管',        custom: ['库管'] },   // 真·未知角色（v296 起应收紧）
]

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-gpu'],
})

/** 只拦**真 API**（pathname 以 `/api/` 开头）。
 *  🔴 不能写成 `**\/api/**` —— 那会把 vite 的模块请求 `/src/api/client.js` 一起拦掉
 *     （路径里含 `/api/`），返回 JSON 后浏览器按 MIME 拒绝加载 ⇒ 整页白屏、假故障。 */
const isRealApi = (u) => { try { return new URL(u).pathname.startsWith('/api/') } catch { return false } }

/** 造一个"已登录"的会话：伪造 token + 打桩权限接口。 */
async function newSession(role, modules, custom) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.route(isRealApi, async (route) => {
    const url = route.request().url()
    if (url.includes('/api/auth/permissions')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          permissions: modules,
          user: { role, roles: [role], display_name: '探针', username: 'probe' },
          custom_roles: custom,
          permissions_detail: { '*': ['read', 'create', 'update', 'delete'] },
          plan: 'pro', capabilities: {}, perms_rev: 'probe-rev',
        }),
      })
    }
    if (url.includes('/api/auth/perms-rev')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rev: 'probe-rev' }) })
    }
    /* 🔴 其余一律 **500**（不是 `{}`）：页面各自的 `catch` 都是为失败设计的，
       会渲染空态；而回 `{}` 会让「读 `d.xxx.yyy`」的页面**抛异常**，
       被 App 级 `ErrorBoundary` 接住 ⇒ 整棵树（含侧栏）被换成「页面出错了」卡片，
       探针会把"白屏"误读成"区块被正确隐藏"。这是本探针唯一的假故障来源。 */
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"probe"}' })
  })
  await page.addInitScript(() => {
    localStorage.setItem('hergent_v2_token', 'probe-token')
    localStorage.setItem('hergent_v2_tenant', '1')
    localStorage.setItem('hergent_v2_user', JSON.stringify({ username: 'probe', display_name: '探针' }))
  })
  return { ctx, page }
}

/* ============================ A + B. 真机 DOM ============================ */
console.log('\nA. 真机 DOM —— 侧栏四个区对谁可见')
console.log('  --- 反例对照：boss 应看到全部四区 ---')
{
  const { ctx, page } = await newSession('boss', ALL_MODULES, [])
  await page.goto(BASE + '/#/workbench', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sb-nav .sb-item', { timeout: 15000 })
  await page.waitForTimeout(600)      // 等 /api/auth/permissions 往返 + 重渲染
  const names = await page.$$eval('.sb-nav .sb-item span', els => els.map(e => e.textContent.trim()))
  const missing = AREAS.filter(a => !names.includes(a))
  ok(missing.length === 0, 'boss 侧栏含全部四区', missing.length ? '缺: ' + missing.join('、') : AREAS.join('、'))
  ok(names.includes(CONTROL), 'boss 侧栏含对照组「' + CONTROL + '」')
  console.log('      侧栏一级项: ' + names.join(' / '))
  await ctx.close()
}

for (const c of CASES) {
  const { ctx, page } = await newSession(c.role, ALL_MODULES, c.custom)
  await page.goto(BASE + '/#/workbench', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sb-nav .sb-item', { timeout: 15000 })
  await page.waitForTimeout(600)
  const names = await page.$$eval('.sb-nav .sb-item span', els => els.map(e => e.textContent.trim()))
  const leaked = AREAS.filter(a => names.includes(a))
  ok(leaked.length === 0, `${c.role}（持全模块 + 权限被改过）侧栏无四区任一`,
    leaked.length ? '泄漏: ' + leaked.join('、') : '侧栏: ' + names.join(' / '))
  ok(names.includes(CONTROL), `${c.role} 对照组「${CONTROL}」在（证明页面真渲染了）`)

  /* --- B. 深链守卫：直接敲 URL 必须被弹回 --- */
  await page.goto(BASE + '/#/wh/inbound', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  const hash = await page.evaluate(() => location.hash)
  ok(!hash.startsWith('#/wh/'), `${c.role} 深链 #/wh/inbound 被守卫弹回`, '当前 hash=' + hash)
  await ctx.close()
}

/* ==================== C + D. 判据穷举与静态护栏（产品真文件） ==================== */
console.log('\nC. 判据穷举（加载产品真文件 /src/constants/pages.js）')
{
  const { ctx, page } = await newSession('boss', ALL_MODULES, [])
  await page.goto(BASE + '/#/workbench', { waitUntil: 'domcontentloaded' })
  const modOk = await page.evaluate(async () => {
    try {
      const m = await import('/src/constants/pages.js')
      window.__P = m
      return typeof m.canSeePage === 'function' && typeof m.pageRoleAllowed === 'function'
    } catch (e) { return 'ERR: ' + e.message }
  })
  ok(modOk === true, '加载产品真文件 pages.js', modOk)
  if (modOk !== true) { await browser.close(); process.exit(1) }

  const R = await page.evaluate(({ AREA_PREFIX_MOD, AREAS_MOD, ROLES_MOD }) => {
    const P = window.__P
    const allP = Object.keys(P.PAGE_RULES)
    const area = allP.filter(p => AREA_PREFIX_MOD.some(x => p.startsWith(x)))
    const allMod = m => () => true                       // 模拟"拿满所有模块"
    const res = { area, notBossOnly: [], notLocked: [], bossHidden: [], leaked: [], guardBleak: [] }
    for (const p of area) {
      const r = P.PAGE_RULES[p]
      if (!(Array.isArray(r.roles) && r.roles.length === 1 && r.roles[0] === 'boss')) res.notBossOnly.push(p)
      if (r.lock !== true) res.notLocked.push(p)
      if (!P.canSeePage(p, 'boss', allMod, [])) res.bossHidden.push(p)
      for (const role of ROLES_MOD) {
        for (const cr of [[], [role]]) {
          const see = P.canSeePage(p, role, allMod, cr)
          if (see) res.leaked.push(`${p} @ ${role} customRoles=${JSON.stringify(cr)}`)
          /* 不变量：入口可见 ⇒ 守卫必放行（反向即"假封锁"） */
          if (see && !P.pageRoleAllowed(p, role, cr)) res.guardBleak.push(`${p} @ ${role}`)
        }
      }
    }
    return res
  }, {
    AREA_PREFIX_MOD: AREA_PREFIX,
    AREAS_MOD: AREAS,
    ROLES_MOD: [...CASES.map(c => c.role), 'distributor', 'driver'],
  })

  ok(R.area.length >= 90, `四区登记行数 ≥ 90（实测 ${R.area.length}）`, R.area.length)
  ok(R.notBossOnly.length === 0, '四区每一行的 roles 都恰为 [\'boss\']', R.notBossOnly.slice(0, 5).join('、'))
  ok(R.notLocked.length === 0, '四区每一行都带 lock: true（防「让位」活洞）', R.notLocked.slice(0, 5).join('、'))
  ok(R.bossHidden.length === 0, '四区对 boss 全部可见（没把自己关在门外）', R.bossHidden.slice(0, 5).join('、'))
  ok(R.leaked.length === 0, '四区对 9 类非 boss 角色零泄漏（含"权限被改过"）', R.leaked.slice(0, 5).join('、'))
  ok(R.guardBleak.length === 0, '不变量：入口可见 ⇒ 守卫放行（无假封锁）', R.guardBleak.slice(0, 5).join('、'))

  /* 锚点本身必须是 boss 硬锁 —— 否则区内共享条目会把整区露出来 */
  await ctx.close()
}

console.log('\nD. 静态护栏 —— 四区准入锚点（Shell.vue）')
{
  const shell = readFileSync(SHELL_VUE, 'utf8')
  for (const [area, anchor] of Object.entries(ANCHORS)) {
    const key = { 仓配管理: 'wh', 资金管理: 'funds', 市场营销: 'mkt', 数据报表: 'reports' }[area]
    const line = shell.split('\n').find(l => l.includes(`key: '${key}',`))
    ok(!!line && line.includes(`path: '${anchor}'`),
      `区「${area}」声明了准入锚点 ${anchor}`,
      line ? line.trim().slice(0, 80) : '未找到该区声明行')
  }
}

console.log('\nE. 反例对照 —— 证明"藏起来"是闸门干的，不是探针恒 false')
{
  const { ctx, page } = await newSession('boss', ALL_MODULES, [])
  await page.goto(BASE + '/#/workbench', { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => { window.__P = await import('/src/constants/pages.js') })
  const cf = await page.evaluate(() => {
    const P = window.__P
    const box = () => true
    const before = P.canSeePage('/wh/inbound', 'sales', box, ['sales'])
    /* 就地还原成 v472 **之前**的档位（`BIZ_ROLES` + 无锁）：销售应当看得见 */
    const r = P.PAGE_RULES['/wh/inbound']
    const oldRoles = r.roles, oldLock = r.lock
    r.roles = ['admin', 'boss', 'accountant', 'sales', 'supervisor']; delete r.lock
    const after = P.canSeePage('/wh/inbound', 'sales', box, ['sales'])
    r.roles = oldRoles; r.lock = oldLock
    const restored = P.canSeePage('/wh/inbound', 'sales', box, ['sales'])
    return { before, after, restored, lock: oldLock }
  })
  ok(cf.before === false, '对照：现行档位下 sales 看不到入库单', String(cf.before))
  ok(cf.after === true, '对照：还原成 v472 前的 BIZ_ROLES 无锁档位 ⇒ sales **看得见**',
    '（证明差异由本次改动造成，不是探针恒 false）')
  ok(cf.restored === false, '对照后已复位（探针不污染真文件）', String(cf.restored))
  await ctx.close()
}

await browser.close()
console.log(`\n==== v472 四区 boss 闸门验收：${pass} 通过 / ${fail} 失败 ====`)
process.exit(fail ? 1 : 0)
