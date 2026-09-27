/**
 * perms-predicate-v292-verify.mjs —— 页面注册表「入口可见性」判据的**真码逻辑验证**
 *
 * 为什么要用浏览器 + vite dev、而不是在 node 里重抄一份判据：
 *   抄一份就变成"测的是我写的那份副本，不是产品里跑的那份" —— 本项目反复栽在这上面。
 *   这里用 `import('/src/constants/pages.js')` **加载产品真文件**，判据唯一实现，
 *   改动一旦漂移，本脚本立刻红。
 *
 * 覆盖三件事：
 *   A. 逐用例断言（v291 语义回归 + v292「用户配置优先」+ `lock` 硬锁）
 *   B. 不变量：**入口可见 ⇒ 守卫必放行**（穷举 17 路径 × 8 角色 × 3 自定义集 × 3 模块集）
 *      —— 这条不变量成立 = v275 修好的「假封锁」结构上不可能回归
 *   C. 注册表自检：每行有 title；`lock` 只出现在该出现的地方
 *
 * 用法：先起 vite dev（默认 5199），再 `node perms-predicate-v292-verify.mjs`
 */
import { chromium } from '/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/node_modules/playwright/index.mjs'

const BASE = process.env.HG_DEV || 'http://127.0.0.1:5199'
let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  ✅ ' + n + (e !== undefined ? '　→ ' + e : '')) } else { fail++; console.log('  ❌ ' + n + (e !== undefined ? '　→ ' + e : '')) } }

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message))
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })

// 加载产品真文件（vite dev 直接服务 ESM 源码）
const modOk = await page.evaluate(async () => {
  try {
    const m = await import('/src/constants/pages.js')
    window.__P = m
    return typeof m.canSeePage === 'function' && typeof m.pageRoleAllowed === 'function' && typeof m.canSee === 'function'
  } catch (e) { return 'ERR: ' + e.message }
})
ok(modOk === true, '加载 /src/constants/pages.js（产品真文件）', modOk)
if (modOk !== true) { await browser.close(); process.exit(1) }

/* ---- A. 逐用例断言 ---------------------------------------------------------- */
console.log('\nA. 逐用例断言')
const cases = [
  // [名称, path, role, 授权模块, customRoles, 期望]
  ['未登记路径 ⇒ 放行',                 '/nope',            'staff',      [],               [],             true],
  ['首页不挂 module ⇒ 员工可见',        '/workbench',       'staff',      ['data'],         [],             true],
  ['经营趋势：员工没 dashboard ⇒ 不可见', '/dashboard',       'staff',      ['data','chat'],  [],             false],
  ['经营趋势：勾上 dashboard ⇒ 可见',    '/dashboard',       'staff',      ['dashboard'],    [],             true],
  ['算工资：会计勾上 payroll ⇒ 可见',    '/payroll',         'accountant', ['payroll'],      [],             true],
  ['算工资：会计没勾 payroll ⇒ 不可见',  '/payroll',         'accountant', [],               [],             false],
  ['定时任务：会计有 data、未自定义 ⇒ 不可见（v291 语义保留）',
                                        '/cron',            'accountant', ['data'],         [],             false],
  ['定时任务：会计有 data、已自定义 ⇒ 让位可见（用户配置优先）',
                                        '/cron',            'accountant', ['data'],         ['accountant'], true],
  ['定时任务：customRoles 未知(null) ⇒ 不让位（刻意偏严）',
                                        '/cron',            'accountant', ['data'],         null,           false],
  ['定时任务：老板始终可见',              '/cron',            'boss',       ['data'],         [],             true],
  ['AI 团队：会计已自定义但仍锁死（lock）',
                                        '/roles',           'accountant', ['chat'],         ['accountant'], false],
  ['设置：会计已自定义且全模块仍锁死（lock）',
                                        '/settings',        'accountant', ['*'],            ['accountant'], false],
  ['档案管理：员工已自定义 ⇒ 仍不可见（无 module ⇒ 不让位）',
                                        '/archive',         'staff',      ['data'],         ['staff'],      false],
  ['渠道与价格：司机已自定义+全模块 ⇒ 仍不可见（无 module ⇒ 不让位）',
                                        '/price-channels',  'driver',     ['*'],            ['driver'],     false],
  ['招投标雷达：司机已自定义+有 data ⇒ 让位可见',
                                        '/bid-radar',       'driver',     ['data'],         ['driver'],     true],
  ['招投标雷达：司机有 data、未自定义 ⇒ 不可见',
                                        '/bid-radar',       'driver',     ['data'],         [],             false],
  ['招投标雷达：业务员在名单里 ⇒ 可见',
                                        '/bid-radar',       'sales',      ['data'],         [],             true],
  ['店铺导入：业务员始终不可见',          '/zhoupu-import',   'sales',      ['*'],            ['sales'],      false],
]
for (const [n, p, r, mods, cr, exp] of cases) {
  const got = await page.evaluate(([p, r, mods, cr]) => {
    const canM = (m) => mods.includes('*') || mods.includes(m)
    return window.__P.canSeePage(p, r, canM, cr)
  }, [p, r, mods, cr])
  ok(got === exp, n, '期望 ' + exp + '，实得 ' + got)
}

/* ---- B. 不变量穷举：入口可见 ⇒ 守卫必放行 ------------------------------------ */
console.log('\nB. 不变量穷举（入口可见 ⇒ 守卫放行）')
const sweep = await page.evaluate(() => {
  const P = window.__P
  const roles = ['admin', 'boss', 'accountant', 'sales', 'guide', 'driver', 'staff', 'supervisor', '']
  const customSets = [null, [], ['admin', 'boss', 'accountant', 'sales', 'guide', 'driver', 'staff', 'supervisor']]
  const modSets = [[], ['dashboard', 'data', 'chat', 'payroll'], ['*']]
  let checked = 0
  const viol = []
  for (const path of P.PAGE_PATHS) {
    for (const role of roles) {
      for (const cr of customSets) {
        for (const mods of modSets) {
          checked++
          const canM = (m) => mods.includes('*') || mods.includes(m)
          const vis = P.canSeePage(path, role, canM, cr)
          const guard = P.pageRoleAllowed(path, role, cr)
          if (vis && !guard) viol.push({ path, role, cr: String(cr), mods: String(mods) })
        }
      }
    }
  }
  return { checked, viol: viol.slice(0, 10), violCount: viol.length, paths: P.PAGE_PATHS.length }
})
ok(sweep.violCount === 0, '穷举 ' + sweep.checked + ' 组合（' + sweep.paths + ' 路径 × 9 角色 × 3 自定义集 × 3 模块集）：无「入口可见但守卫拦」',
  sweep.violCount === 0 ? '0 违例' : JSON.stringify(sweep.viol))
ok(sweep.paths === 17, '注册表页数 = 17', sweep.paths)

/* ---- C. 注册表自检 ---------------------------------------------------------- */
console.log('\nC. 注册表自检')
const self = await page.evaluate(() => {
  const P = window.__P
  const noTitle = Object.entries(P.PAGE_RULES).filter(([, r]) => !r.title).map(([k]) => k)
  const locked = Object.entries(P.PAGE_RULES).filter(([, r]) => r.lock === true).map(([k]) => k)
  const dual = Object.entries(P.PAGE_RULES).filter(([, r]) => r.roles && r.module).map(([k]) => k)
  const noAxis = Object.entries(P.PAGE_RULES).filter(([, r]) => !r.roles && !r.module).map(([k]) => k)
  return { noTitle, locked, dual, noAxis }
})
ok(self.noTitle.length === 0, '每行都有 title', JSON.stringify(self.noTitle))
ok(JSON.stringify(self.locked) === JSON.stringify(['/roles', '/settings']), 'lock 恰为 /roles + /settings', JSON.stringify(self.locked))
ok(JSON.stringify(self.dual) === JSON.stringify(['/bid-radar', '/cron', '/roles']),
  '同时受两轴约束的页面 = /bid-radar + /cron + /roles（决定「让位」影响面）', JSON.stringify(self.dual))

/* ---- D. store 侧接线（不需要登录）------------------------------------------- */
console.log('\nD. store 侧接线')
const wire = await page.evaluate(async () => {
  try {
    const s = await import('/src/store/index.js')
    const st = s.store
    return {
      hasFn: typeof st.refreshPermsIfChanged === 'function',
      customRolesIsNull: st.customRoles === null,
      revIsEmpty: st.permsRev === '',
      perms: st.perms,
    }
  } catch (e) { return 'ERR: ' + e.message }
})
ok(wire && wire.hasFn === true, 'store.refreshPermsIfChanged 存在', JSON.stringify(wire))
ok(wire && wire.customRolesIsNull === true, '未登录时 customRoles = null（未知，不让位）', String(wire && wire.customRolesIsNull))
ok(wire && wire.revIsEmpty === true, '未登录时 permsRev 为空', String(wire && wire.revIsEmpty))

console.log('\n' + '='.repeat(64))
console.log(`结果：${pass} 通过 / ${fail} 失败`)
await browser.close()
process.exit(fail ? 1 : 0)
