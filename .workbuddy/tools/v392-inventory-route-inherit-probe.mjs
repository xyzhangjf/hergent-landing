/* ============================================================
   v392 探针：进销存 8 条子路由**是否真的继承** `/inventory` 那一行的门禁
   ------------------------------------------------------------
   为什么必须实测而不是"看一眼代码"：计划 §七 细节 3 的硬约束是
     「**不改 `pages.js`** —— 8 条路由全部继承 `/inventory` 那一行」。
   这条约束成立与否完全取决于 `ruleFor()` 的**逐级去尾匹配**实现。
   若哪天有人把 `ruleFor` 改成精确匹配，8 个页面会**同时失去角色门禁**
   （手敲 URL 能进）—— 而界面上完全看不出异常。所以要有常驻判据。

   用法：
     node .workbuddy/tools/v392-inventory-route-inherit-probe.mjs
   ============================================================ */
/* ⚠️ 必须在 import `pages.js` **之前**铺好最小 DOM 桩：`pages.js` 静态 import 了 `store`
   （`store/index.js` 里 `createPinia()` + `api/client.js` 读 `localStorage`），
   原生 node 没有 `localStorage` ⇒ 不铺桩会在 import 期就抛 ReferenceError。
   桩**只补"读不到就崩"的那一个 API**，不模拟任何业务行为 —— 否则探针看到的不再是真身。
   因为需要"先铺桩再 import"，所以下面用**动态 import**（静态 import 会被提升到最前面）。 */
const _mem = new Map()
globalThis.localStorage = {
  getItem: k => (_mem.has(k) ? _mem.get(k) : null),
  setItem: (k, v) => { _mem.set(k, String(v)) },
  removeItem: k => { _mem.delete(k) },
  clear: () => _mem.clear(),
}

/* `ADMIN_ROLES` 的**唯一源**在 `pages.js:152`（`roles.js` 里没有它）—— 这里从同一处取，
   不另抄一份名单，否则探针就变成"用第二份名单去验第一份名单"。 */
const { ruleFor, pageRoleAllowed, ADMIN_ROLES } = await import('../../hergent-cn-v2/src/constants/pages.js')

const SUBS = [
  '/inventory',
  '/inventory/purchase',
  '/inventory/purchase/new',
  '/inventory/purchase/123',
  '/inventory/sale',
  '/inventory/sale/new',
  '/inventory/sale/456',
  '/inventory/stock',
]

const PASS = [], FAIL = []
function ok (name, cond, detail = '') {
  ;(cond ? PASS : FAIL).push(name)
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' | ' + detail : ''}`)
}

console.log('\n── ① `/inventory` 基准行 ──')
const base = ruleFor('/inventory')
console.log('   base =', JSON.stringify(base))
ok('①.1 `/inventory` 已登记（非 null）', !!base)
ok('①.2 module = inventory', base && base.module === 'inventory', base && base.module)
ok('①.3 lock = true（窄名单必须锁，否则让位会让自定义角色拿到进销存）',
  base && base.lock === true, base && base.lock)
ok('①.4 roles = ADMIN_ROLES', base && Array.isArray(base.roles)
  && base.roles.join(',') === ADMIN_ROLES.join(','), base && base.roles.join(','))

console.log('\n── ② 8 条子路由逐条继承（逐字相同） ──')
for (const p of SUBS) {
  const r = ruleFor(p)
  const same = !!r && !!base
    && r.module === base.module
    && r.lock === base.lock
    && r.title === base.title
    && JSON.stringify(r.roles) === JSON.stringify(base.roles)
  ok(`② ${p} 继承 /inventory`, same, r ? `module=${r.module} lock=${r.lock}` : 'null')
}

console.log('\n── ③ 角色判据一致性（8 条路径 vs /inventory，逐角色比对） ──')
const ROLES = ['boss', 'admin', 'accountant', 'sales', 'supervisor', 'staff', 'driver', '']
let mismatch = []
for (const role of ROLES) {
  for (const p of SUBS) {
    const a = pageRoleAllowed(p, role, null)
    const b = pageRoleAllowed('/inventory', role, null)
    if (a !== b) mismatch.push(`${p}@${role || '<空>'}: ${a} vs ${b}`)
  }
}
ok('③.1 8 条路径与 /inventory 的角色判据**逐角色一致**', mismatch.length === 0, mismatch.join('; '))

console.log('\n── ④ 判别力自证（反例必须与原行为不同，否则本探针是空转） ──')
ok('④.1 反例 `/inventoryx` **不**继承（证明判据不是"任何路径都命中"）',
  ruleFor('/inventoryx') === null, JSON.stringify(ruleFor('/inventoryx')))
ok('④.2 反例 `/inventory-fake` 不继承',
  ruleFor('/inventory-fake') === null, JSON.stringify(ruleFor('/inventory-fake')))
ok('④.3 反例 `/purchase` 命中的**不是** inventory（旧壳路径另有归属）',
  (ruleFor('/purchase') || {}).module !== 'inventory',
  JSON.stringify(ruleFor('/purchase')))
ok('④.4 老板能进 /inventory（正例）', pageRoleAllowed('/inventory', 'boss', null) === true)
ok('④.5 业务员进不去 /inventory（正例：门禁真的在拦）',
  pageRoleAllowed('/inventory', 'sales', null) === false)
ok('④.6 业务员也进不去 /inventory/purchase（继承后仍然拦住）',
  pageRoleAllowed('/inventory/purchase', 'sales', null) === false)
/* ④.7：不带 `lock` 的对照 —— 自定义角色判据应"让位"。
   用 `/archive/prices` 之外的路径不好找普适例子，这里直接验 `lock` 字段的语义：
   有 lock ⇒ customRoles 无法让位；无 lock ⇒ 可让位。 */
const withLock = pageRoleAllowed('/inventory', 'custom_role_x', ['custom_role_x'])
ok('④.7 lock=true 时自定义角色**不能**通过让位进入进销存',
  withLock === false, String(withLock))

console.log('\n' + '='.repeat(70))
console.log(`PASS ${PASS.length} / FAIL ${FAIL.length}`)
if (FAIL.length) { for (const f of FAIL) console.log('  ❌ ' + f) } else { console.log('  全绿 ✅') }
console.log('='.repeat(70))
process.exit(FAIL.length ? 1 : 0)
