/**
 * perms-predicate-v296-verify.mjs —— 页面注册表「入口可见性」判据的**真码逻辑验证**
 *
 * 为什么要用浏览器 + vite dev、而不是在 node 里重抄一份判据：
 *   抄一份就变成"测的是我写的那份副本，不是产品里跑的那份" —— 本项目反复栽在这上面。
 *   这里用 `import('/src/constants/pages.js')` **加载产品真文件**，判据唯一实现，
 *   改动一旦漂移，本脚本立刻红。
 *
 * 覆盖五件事：
 *   A. 逐用例断言（v291 语义回归 + v296「用户配置优先」+ `lock` 硬锁
 *      + **v296 模块轴变更**（`/cron`→`cron`、`/bid-radar`→`bid`）+ **v296 真未知角色收紧**）
 *   B. 不变量：**入口可见 ⇒ 守卫必放行**（穷举 17 路径 × 10 角色 × 4 自定义集 × 4 模块集）
 *      —— 这条不变量成立 = v275 修好的「假封锁」结构上不可能回归
 *      · 角色集含 **`库管`（真未知）**、自定义集含 **`['库管']`**
 *        ⇒ 顺带证明「让位」这条路径对非内置角色也是通的（守卫与入口同源）
 *   C. 注册表自检：每行有 title；`lock` 只出现在该出现的地方；双轴页清单
 *   D. store / roles 侧接线（不需要登录）
 *   E. 🔴 **v296 修洞的反例对照**：真·未知角色（`库管`）不再对所有 `roles` 门槛页通行，
 *      且「写进自定义名单后确有页面可见」⇒ 证明 E 不是"一律 false"的空断言
 *
 * 用法：先起 vite dev（默认 5199），再 `node perms-predicate-v296-verify.mjs`
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

  /* —— 定时任务：module 轴 v296 起 = `cron`（原 `data`）—— */
  ['定时任务：会计持 cron、角色未自定义 ⇒ 不可见（v291 语义保留）',
                                        '/cron',            'accountant', ['cron'],         [],             false],
  ['定时任务：会计持 cron、角色已自定义 ⇒ 让位可见（用户配置优先）',
                                        '/cron',            'accountant', ['cron'],         ['accountant'], true],
  ['定时任务：customRoles 未知(null) ⇒ 不让位（刻意偏严）',
                                        '/cron',            'accountant', ['cron'],         null,           false],
  ['定时任务：老板始终可见',              '/cron',            'boss',       ['cron'],         [],             true],
  // 🔴 拆模块的**回归用例**：员工默认持有 `data`（报单要用）——
  //    v296 前 `/api/cron` 就归 `data`，所以这个组合在旧实现下**是可见的**（正是要修的洞）；
  //    拆出 `cron` 之后必须变为不可见。这条是可判别的：旧值 true ≠ 新值 false。
  ['🔴 定时任务：员工持 data（档案管理）而非 cron ⇒ 不可见（拆模块的效果，旧值 true）',
                                        '/cron',            'staff',      ['data'],         [],             false],

  ['AI 团队：会计已自定义但仍锁死（lock）',
                                        '/roles',           'accountant', ['chat'],         ['accountant'], false],
  ['设置：会计已自定义且全模块仍锁死（lock）',
                                        '/settings',        'accountant', ['*'],            ['accountant'], false],
  ['档案管理：员工已自定义 ⇒ 仍不可见（无 module ⇒ 不让位）',
                                        '/archive',         'staff',      ['data'],         ['staff'],      false],
  ['渠道与价格：司机已自定义+全模块 ⇒ 仍不可见（无 module ⇒ 不让位）',
                                        '/price-channels',  'driver',     ['*'],            ['driver'],     false],

  /* —— 招投标雷达：module 轴 v296 起 = `bid`（原 `reports`，见后端 `_PATH_MODULE_MAP` 注释）—— */
  ['招投标雷达：司机持 bid、角色已自定义 ⇒ 让位可见',
                                        '/bid-radar',       'driver',     ['bid'],          ['driver'],     true],
  ['招投标雷达：司机持 bid、角色未自定义 ⇒ 不可见',
                                        '/bid-radar',       'driver',     ['bid'],          [],             false],
  ['招投标雷达：业务员在名单里 ⇒ 可见',
                                        '/bid-radar',       'sales',      ['bid'],          [],             true],

  ['店铺导入：业务员始终不可见',          '/zhoupu-import',   'sales',      ['*'],            ['sales'],      false],

  /* —— 🔴 v296 修洞：真·未知角色不再享受 fail-open（详见 `roles.js::roleIn`）——
   *    判据的两种「未知」：空串 = 未加载 ⇒ 放行；非空但不在 ROLE_NAMES ⇒ 收紧。 */
  ['空串角色（权限未加载）⇒ 放行（启动竞态，v296 刻意保留）',
                                        '/cron',            '',           ['cron'],         [],             true],
  ['🔴 库管（真未知角色）持 cron、角色未自定义 ⇒ 收紧不可见（v296 修洞，旧值 true）',
                                        '/cron',            '库管',        ['cron'],         [],             false],
  ['🔴 库管 customRoles=null ⇒ 收紧不可见（不知道自定义情况也不放行）',
                                        '/cron',            '库管',        ['cron'],         null,           false],
  ['库管已被老板写进自定义名单 ⇒ 走正门让位可见（客户配置优先，非后门）',
                                        '/cron',            '库管',        ['cron'],         ['库管'],       true],
  ['🔴 库管进「预报订货管理」⇒ 入口不可见（不再造假入口；后端 SUMMARY_ROLES 必 403）',
                                        '/forecast',        '库管',        ['*'],            [],             false],
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
const SWEEP_ROLES = 10, SWEEP_CRS = 4, SWEEP_MODS = 4
const sweep = await page.evaluate(() => {
  const P = window.__P
  // v296：加入 `库管`（真未知角色）—— 修洞前它是**最大的漏点**，修洞后它必须与内置角色同规
  const roles = ['admin', 'boss', 'accountant', 'sales', 'guide', 'driver', 'staff', 'supervisor', '', '库管']
  const customSets = [null, [], ['admin', 'boss', 'accountant', 'sales', 'guide', 'driver', 'staff', 'supervisor'], ['库管']]
  // v296：模块集加入新拆的两个窄模块，让 `/cron` `/bid-radar` 也真的被穷举到
  const modSets = [[], ['dashboard', 'data', 'chat', 'payroll'], ['cron', 'bid'], ['*']]
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
ok(sweep.violCount === 0, '穷举 ' + sweep.checked + ' 组合（' + sweep.paths + ' 路径 × ' + SWEEP_ROLES + ' 角色 × ' + SWEEP_CRS + ' 自定义集 × ' + SWEEP_MODS + ' 模块集）：无「入口可见但守卫拦」',
  sweep.violCount === 0 ? '0 违例' : JSON.stringify(sweep.viol))
ok(sweep.checked === sweep.paths * SWEEP_ROLES * SWEEP_CRS * SWEEP_MODS,
  '穷举规模未被静默缩小（' + sweep.checked + ' = ' + [sweep.paths, SWEEP_ROLES, SWEEP_CRS, SWEEP_MODS].join('×') + '）',
  sweep.checked + ' / 期望 ' + (sweep.paths * SWEEP_ROLES * SWEEP_CRS * SWEEP_MODS))
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

/* ---- D. store / roles 侧接线（不需要登录）----------------------------------- */
console.log('\nD. store / roles 侧接线')
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

// 🔴 v296 `roleIn` 的两分支语义直接钉死（不经过页面轴，最小可判别的单元）
const rl = await page.evaluate(async () => {
  try {
    const m = await import('/src/constants/roles.js')
    return {
      empty: m.roleIn('', ['admin', 'boss']),
      unknown: m.roleIn('库管', ['admin', 'boss']),
      unknownSelfList: m.roleIn('库管', ['库管']),
      unknownViewToken: m.roleIn('finance', ['admin', 'accountant']),
      canonical: m.roleIn('boss', ['admin', 'boss']),
      canonicalMiss: m.roleIn('driver', ['admin', 'boss']),
    }
  } catch (e) { return 'ERR: ' + e.message }
})
ok(rl && rl.empty === true, 'roleIn(空串) = true（未加载 ⇒ 放行：拉不到 ≠ 没权限）', String(rl && rl.empty))
ok(rl && rl.unknown === false, '🔴 roleIn(库管, [admin,boss]) = false（真未知 ⇒ 收紧，v296 修洞）', String(rl && rl.unknown))
// 🎯 分工必须钉死：`roleIn` 判的是**产品内置门槛**，真未知角色在咨询名单**之前**就被收紧
//    ⇒ 即便有人把「库管」字面写进某个内置名单，本函数也返 false。
//    「让位」（客户配置优先）**不经本函数**，走 `pages.js::roleGateOpen` ③ 直接比 `customRoles`
//    （A 段那条「库管写进自定义名单 ⇒ 可见」证的是 ③ 通）。
ok(rl && rl.unknownSelfList === false, '🔴 roleIn(库管, [库管]) = false（内置门槛对真未知角色恒 false，先收紧再查名单）', String(rl && rl.unknownSelfList))
ok(rl && rl.unknownViewToken === true, 'roleIn(finance, …) = true（视图令牌经 ROLE_ALIAS 归一为 accountant ⇒ 仍按内置角色判）', String(rl && rl.unknownViewToken))
ok(rl && rl.canonical === true && rl.canonicalMiss === false, '内置角色的两条路径未被修洞影响', JSON.stringify(rl))

/* ---- E. v296 修洞的反例对照 -------------------------------------------------- */
console.log('\nE. 🔴 真·未知角色（库管）的收紧 —— 反例对照')
const unk = await page.evaluate(() => {
  const P = window.__P
  const gated = P.PAGE_PATHS.filter((p) => P.PAGE_RULES[p].roles)
  const allOpen = () => true                        // 模块轴全开 ⇒ 唯一可能的拦截者就是角色门槛
  const leaked = gated.filter((p) => P.canSeePage(p, '库管', allOpen, []))
  const viaUser = gated.filter((p) => P.canSeePage(p, '库管', allOpen, ['库管']))
  return {
    gatedCount: gated.length,
    leaked,
    viaUser,
    emptyRoleOnCron: P.canSeePage('/cron', '', allOpen, []),
    // 反向对照：内置的 boss 在同样「模块全开 + 未自定义」下应能进这些页（证明 gated 集合本身是通行的）
    bossOpen: gated.filter((p) => P.canSeePage(p, 'boss', allOpen, [])).length,
  }
})
ok(unk.gatedCount >= 10, 'roles 门槛页数量 ≥ 10（用例非空）', unk.gatedCount)
ok(unk.bossOpen > 0, '对照基线：boss 在同样条件下能进 ' + unk.bossOpen + ' 个门槛页 ⇒ 门槛集合本身是通行的', String(unk.bossOpen))
ok(unk.leaked.length === 0,
  '🔴 「库管」未自定义时对全部 ' + unk.gatedCount + ' 个 roles 门槛页均不可见（v296 修洞；修洞前会全部泄漏）',
  unk.leaked.length === 0 ? '0 泄漏' : JSON.stringify(unk.leaked))
ok(unk.viaUser.length > 0,
  '反例对照：把「库管」写进自定义名单后确有页面可见 ⇒ 上一条不是「一律 false」的空断言',
  unk.viaUser.length + ' 页可见：' + JSON.stringify(unk.viaUser))
ok(unk.emptyRoleOnCron === true,
  '空串角色仍放行（启动竞态那一档）⇒ 修洞没有误伤「未加载」', String(unk.emptyRoleOnCron))

console.log('\n' + '='.repeat(64))
console.log(`结果：${pass} 通过 / ${fail} 失败`)
await browser.close()
process.exit(fail ? 1 : 0)
