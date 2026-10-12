/**
 * v474-nav-role-perm-relocate-verify.mjs —— 「角色权限」侧栏归位（设置 → 档案管理 › 组织相关）
 *
 * 老板指令（2026-10-12 原话）：
 *   「现在的角色权限在系统--权限管理里，把这个移到侧边栏"档案管理--组织相关"分组」
 *
 * 🔴 为什么不能只在 node 里改一遍 NAV 数组然后断言：
 *   侧栏条目能不能**渲染出来**要过 `resolveNavItem` → `canSee(x.path)`，而
 *   `canSee` 又读 `store.perms`（来自 `/api/auth/permissions`）。任何只在源码层
 *   复算的断言都绕过了这三层。本探针在**真浏览器里真渲染**，登录态与权限接口打桩。
 *
 * 🔴 本轮最容易漏、也最该验的三件事（都不是"条目挪过去"本身）：
 *   ① **高亮有没有跟着走**：`isCur` 走 `effTab` 归一化、`areaCur` 靠 `some(isCur)`。
 *      停在权限页时，亮的一定要是**档案管理**区而不是「系统」区；
 *      若判据写成"路径前缀匹配"，系统区会同时亮两个 —— 那是"一个功能两处高亮"。
 *   ② **非 boss 会不会露出半截**：非 boss 看不到「角色权限」时，「组织相关」列
 *      必须仍有「员工档案」⇒ 否则是**空列**（resolveNavItem 会整列丢掉，用户报
 *      "档案管理里组织相关不见了"）。
 *   ③ **门禁是真门禁还是探针恒 false**：把 `/settings` 那一行就地还原成
 *      「业务角色可进 + 无锁」，断言立刻变 true ⇒ 证明隐藏是判据干的。
 *
 * 用法：先起 vite dev（默认 5199），再 `node v474-nav-role-perm-relocate-verify.mjs`
 */
import { readFileSync } from 'node:fs'
import { chromium } from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/playwright/index.mjs'

const BASE = process.env.HG_DEV || 'http://127.0.0.1:5199'
const SRC = '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src'

let pass = 0, fail = 0
const ok = (c, n, e) => {
  if (c) { pass++; console.log('  ✅ ' + n + (e !== undefined ? '　→ ' + e : '')) }
  else { fail++; console.log('  ❌ ' + n + (e !== undefined ? '　→ ' + e : '')) }
}

/* 最坏情况：非 boss 角色**拿满所有模块**且**本租户改过它的权限**（触发让位前置条件）。
   拿满模块仍看不到，才谈得上是角色门禁在挡。 */
const ALL_MODULES = ['dashboard', 'data', 'sales', 'buying', 'stock', 'loss', 'accounts', 'crm',
  'hr', 'payroll', 'projects', 'goals', 'reports', 'chat', 'tasks', 'cron', 'bid', 'messages',
  'forecast', 'forecast-audit', 'inventory', 'funds']

const NON_BOSS = [
  { role: 'sales',      custom: ['sales'] },
  { role: 'accountant', custom: ['accountant'] },
  { role: 'supervisor', custom: ['supervisor'] },
  { role: 'admin',      custom: ['admin'] },     // 对照：admin **应该**看得见（正向）
]

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-gpu'],
})

/** 🔴 只拦**真 API**（pathname 以 `/api/` 开头）。
 *  写成 `**\/api/**` 会把 vite 的模块请求 `/src/api/client.js` 一起拦掉（路径里含 `/api/`），
 *  返回 JSON 后浏览器按 MIME 拒绝加载 ⇒ 整页白屏 = 假故障。 */
const isRealApi = (u) => { try { return new URL(u).pathname.startsWith('/api/') } catch { return false } }

async function newSession(role, custom) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
  await page.route(isRealApi, async (route) => {
    const url = route.request().url()
    if (url.includes('/api/auth/permissions')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          permissions: ALL_MODULES,
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
    /* 🔴 其余一律 **500**（不是 `{}`）：页面各自的 catch 是为失败设计的；
       回 `{}` 会让「读 d.xxx.yyy」的页面抛异常，被 App 级 ErrorBoundary 接住
       ⇒ 整棵树（含侧栏）被换成错误卡片，探针会把白屏误读成"区块被正确隐藏"。 */
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"probe"}' })
  })
  await page.addInitScript(() => {
    localStorage.setItem('hergent_v2_token', 'probe-token')
    localStorage.setItem('hergent_v2_tenant', '1')
    localStorage.setItem('hergent_v2_user', JSON.stringify({ username: 'probe', display_name: '探针' }))
  })
  return { ctx, page, errs }
}

async function ready(page, hash) {
  await page.goto(BASE + '/' + (hash || '#/workbench'), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.sb-nav .sb-item', { timeout: 20000 })
  await page.waitForTimeout(700)     // 等 /api/auth/permissions 往返 + 重渲染
}

/** 打开某个职能区的弹窗，读出「列标题 → 条目名」与每条的 href。 */
async function readArea(page, areaName) {
  const btn = page.locator('.sb-area-btn', { hasText: areaName }).first()
  await btn.click()
  await page.waitForSelector('.sb-pop', { timeout: 8000 })
  await page.waitForTimeout(250)
  const out = await page.evaluate(() => {
    const cols = []
    document.querySelectorAll('.sb-pop-col').forEach(col => {
      const hd = col.querySelector('.sb-pop-hd')
      const items = []
      col.querySelectorAll('.sb-pop-item').forEach(a => {
        items.push({ name: (a.textContent || '').trim(), href: a.getAttribute('href') || '' })
      })
      cols.push({ label: hd ? hd.textContent.trim() : '', items })
    })
    return cols
  })
  await page.keyboard.press('Escape').catch(() => {})
  await page.evaluate(() => {
    /* 收起弹窗：点一次同一个按钮即可（openArea === key 切换）*/
    const b = [...document.querySelectorAll('.sb-area-btn')].find(x => x.getAttribute('aria-expanded') === 'true')
    if (b) b.click()
  })
  await page.waitForTimeout(200)
  return out
}

/* ==================== A. boss：档案管理 › 组织相关 含「角色权限」 ==================== */
console.log('\nA. boss —— 侧栏「档案管理 › 组织相关」列含「角色权限」')
{
  const { ctx, page } = await newSession('boss', [])
  await ready(page)
  const arch = await readArea(page, '档案管理')
  const orgCol = arch.find(c => c.label === '组织相关')
  ok(!!orgCol, '「档案管理」弹窗里有「组织相关」列', arch.map(c => c.label).join('、'))
  if (orgCol) {
    const names = orgCol.items.map(i => i.name)
    ok(names.includes('角色权限'), '「组织相关」列含「角色权限」', names.join('、'))
    ok(names.includes('员工档案'), '「组织相关」列仍含「员工档案」', names.join('、'))
    const rp = orgCol.items.find(i => i.name === '角色权限')
    ok(!!rp && /#\/settings\?tab=perm$/.test(rp.href), '「角色权限」指向 #/settings?tab=perm', rp ? rp.href : '（缺条目）')
  }
  /* 对照：侧栏一级项渲染出来了（防空断言） */
  const top = await page.$$eval('.sb-nav > * .sb-item span, .sb-nav .sb-item span', els => els.map(e => e.textContent.trim()))
  ok(top.includes('档案管理') && top.includes('系统'), '对照组：一级项「档案管理」「系统」都在',
    [...new Set(top)].join(' / '))
  await ctx.close()
}

/* ==================== B. boss：系统 › 系统设置 已不含它 ==================== */
console.log('\nB. boss —— 「系统 › 系统设置」列已不含「角色权限」')
{
  const { ctx, page } = await newSession('boss', [])
  await ready(page)
  const sys = await readArea(page, '系统')
  const setCol = sys.find(c => c.label === '系统设置')
  ok(!!setCol, '「系统」弹窗里有「系统设置」列', sys.map(c => c.label).join('、'))
  if (setCol) {
    const names = setCol.items.map(i => i.name)
    ok(!names.includes('角色权限'), '「系统设置」列**不再**含「角色权限」（归位生效）', names.join('、'))
    ok(names.length === 4, '「系统设置」列剩 4 项（账号与组织/AI 配置/AI 运维/数据与系统）', names.join('、'))
  }
  const allSysNames = sys.flatMap(c => c.items.map(i => i.name))
  ok(!allSysNames.includes('角色权限'), '整个「系统」区任何一列都没有「角色权限」', allSysNames.join('、'))
  await ctx.close()
}

/* ==================== C. 非 boss：门禁 + 不露空列 ==================== */
console.log('\nC. 非 boss —— 「角色权限」不可见，且「组织相关」列不空')
for (const c of NON_BOSS) {
  const { ctx, page } = await newSession(c.role, c.custom)
  await ready(page)
  const arch = await readArea(page, '档案管理')
  const orgCol = arch.find(x => x.label === '组织相关')
  const expectSee = c.role === 'admin'
  if (orgCol) {
    const names = orgCol.items.map(i => i.name)
    ok(names.includes('角色权限') === expectSee,
      `${c.role}（持全模块 + 权限被改过）「角色权限」${expectSee ? '**可见**' : '**不可见**'}`,
      names.join('、'))
    ok(names.includes('员工档案'), `${c.role} 「组织相关」列仍非空（仍有员工档案）`, names.join('、'))
  } else {
    ok(expectSee === false, `${c.role} 「组织相关」列因无可见项被整列丢掉（resolveNavItem 行为）`,
      '列不存在')
  }
  await ctx.close()
}

/* ==================== D. 深链守卫 ==================== */
console.log('\nD. 深链守卫 —— 非 boss 敲 #/settings?tab=perm 必须被弹回')
for (const c of NON_BOSS.filter(x => x.role !== 'admin')) {
  const { ctx, page } = await newSession(c.role, c.custom)
  await ready(page, '#/settings?tab=perm')
  await page.waitForTimeout(900)
  const hash = await page.evaluate(() => location.hash)
  ok(hash !== '#/settings?tab=perm', `${c.role} 深链被守卫弹回`, '当前 hash=' + hash)
  await ctx.close()
}
{   /* 反例对照：boss 敲同一条深链必须留在原地（证明"弹回"是角色闸门干的，不是路由坏了） */
  const { ctx, page } = await newSession('boss', [])
  await ready(page, '#/settings?tab=perm')
  await page.waitForTimeout(900)
  const hash = await page.evaluate(() => location.hash)
  ok(hash === '#/settings?tab=perm', '对照：boss 深链留在原地（证明弹回是闸门干的）', 'hash=' + hash)
  await ctx.close()
}

/* ==================== E. 高亮归位 + 标签栏标题 ==================== */
console.log('\nE. 高亮归位 —— 停在权限页时亮的是「档案管理」，不是「系统」')
{
  const { ctx, page, errs } = await newSession('boss', [])
  await ready(page, '#/settings?tab=perm')
  await page.waitForTimeout(900)
  const areas = await page.evaluate(() => [...document.querySelectorAll('.sb-area')].map(a => ({
    name: (a.querySelector('.sb-area-btn span') || {}).textContent?.trim() || '',
    cur: a.classList.contains('cur'),
  })))
  const cur = areas.filter(a => a.cur).map(a => a.name)
  ok(cur.includes('档案管理'), '「档案管理」区高亮（cur）', '高亮区: ' + (cur.join('、') || '（无）'))
  ok(!cur.includes('系统'), '「系统」区**不**高亮（否则"一个功能两处高亮"）', '高亮区: ' + (cur.join('、') || '（无）'))
  ok(cur.length === 1, '恰好一个区高亮', '高亮区: ' + (cur.join('、') || '（无）'))

  const tabTitle = await page.evaluate(() => {
    const el = document.querySelector('.tab-item.on .tab-title') || document.querySelector('.tab-title')
    return el ? el.textContent.trim() : ''
  })
  ok(tabTitle === '角色权限', '标签栏标题 = 角色权限（与侧栏逐字一致）', '实际: ' + tabTitle)

  const cardTitle = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.panel-hd b')].find(x => /角色/.test(x.textContent))
    return el ? el.textContent.trim() : ''
  })
  ok(cardTitle === '角色权限', '页面内卡片标题 = 角色权限（三处同名）', '实际: ' + cardTitle)
  /* 🔴 过滤本探针**自己造的**噪音：`newSession` 对一切非 auth 端点故意回 HTTP 500，
     浏览器必然记一条 "Failed to load resource: ... status of 500"。把它算进"零 console 错误"
     就是**探针把自己的桩当成产品缺陷**（v472 那支没踩到，是因为它没在打桩页上做这条断言）。
     过滤口径：只丢掉资源加载类报错，**真实 JS 异常（pageerror / 普通 console.error）仍会红**。 */
  const realErrs = errs.filter(e => !/Failed to load resource|status of 5\d\d|ERR_FAILED/i.test(e))
  ok(realErrs.length === 0, '零真实 console 错误（已排除探针自身 500 桩）',
    realErrs.length ? realErrs.slice(0, 2).join(' | ') : `0（原始 ${errs.length} 条全是本探针打的 500 桩）`)
  await ctx.close()
}

/* ==================== F. 判据自证 + 文案静态核对 ==================== */
console.log('\nF. 判别力自证 + 文案核对')
{
  const { ctx, page } = await newSession('boss', [])
  await ready(page)
  await page.evaluate(async () => { window.__P = await import('/src/constants/pages.js') })
  const cf = await page.evaluate(() => {
    const P = window.__P
    const box = () => true
    const r = P.PAGE_RULES['/settings']
    const before = P.canSeePage('/settings', 'sales', box, ['sales'])
    const base = { roles: r.roles, lock: r.lock }
    /* 反例 ①：还原成"业务角色可进、无锁" ⇒ sales 应当立刻看得见 */
    r.roles = ['admin', 'boss', 'accountant', 'sales', 'supervisor']; delete r.lock
    const afterNoLock = P.canSeePage('/settings', 'sales', box, ['sales'])
    /* 反例 ②：只摘 lock、保留 ADMIN_ROLES ⇒ 仍不可见（module:null ⇒ 让位第③档本就不触发） */
    r.roles = base.roles
    const afterUnlockOnly = P.canSeePage('/settings', 'sales', box, ['sales'])
    r.roles = base.roles; r.lock = base.lock
    const restored = P.canSeePage('/settings', 'sales', box, ['sales'])
    return {
      before, afterNoLock, afterUnlockOnly, restored,
      moduleIsNull: r.module === null, lock: base.lock,
      bossSees: P.canSeePage('/settings', 'boss', box, []),
    }
  })
  ok(cf.before === false, '现行档位：sales 看不到角色权限', String(cf.before))
  ok(cf.afterNoLock === true, '反例①：还原成"业务角色可进 + 无锁" ⇒ sales **立刻看得见**',
    '（证明隐藏是判据干的，不是探针恒 false）')
  ok(cf.afterUnlockOnly === false, '反例②：只摘 lock 仍不可见 ⇒ `module:null` 已让"让位"第③档无从触发',
    String(cf.afterUnlockOnly))
  ok(cf.restored === false, '自证后已复位（探针不污染真文件）', String(cf.restored))
  ok(cf.moduleIsNull === true && cf.lock === true, '/settings 仍是 module:null + lock:true（未被本轮改动）')
  ok(cf.bossSees === true, 'boss 自己看得到（没把自己关在门外）', String(cf.bossSees))
  await ctx.close()
}
{
  /* 文案：用户可见的 4 处必须是简写「档案管理 › 角色权限」；旧的「设置 › 权限」必须 0 处。 */
  const files = ['pages/EmployeeArchive.vue', 'pages/Forecast.vue']
  let old = 0, short = 0
  for (const f of files) {
    const t = readFileSync(SRC + '/' + f, 'utf8')
    old += (t.match(/设置 › 权限/g) || []).length
    short += (t.match(/档案管理 › 角色权限/g) || []).length
  }
  ok(old === 0, '用户可见文案里已无「设置 › 权限」', '残留 ' + old + ' 处')
  ok(short === 4, '用户可见文案 4 处已改成「档案管理 › 角色权限」', '实测 ' + short + ' 处')
}

await browser.close()
console.log(`\n==== v474 角色权限侧栏归位验收：${pass} 通过 / ${fail} 失败 ====`)
process.exit(fail ? 1 : 0)