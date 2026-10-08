/* v345 审计：找出 PAGE_RULES 里「让位可达」的行 ——
   条件 = 有 roles（角色名单） + 有 module 或 moduleAny（可判） + 没有 lock。
   这些行的角色轴会在「本租户改过该角色权限」后被 `roleGateOpen` 第 ③ 档让位掉，
   由 module 轴单独裁决 ⇒ 只要该角色持有那个模块，入口就出现（看起来像权限失效）。

   同时列出「该行 module 在 _DEFAULT_PERMS 里被哪些角色持有」的对照，
   因为『名单里没有、却持有模块』的角色 = 活洞。 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { copyFileSync, mkdirSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const SRC = join(REPO, 'hergent-cn-v2', 'src')

// —— 拷贝一份源码到 /tmp 并给相对 import 补 .js（node 原生 ESM 要求显式扩展名）——
const TMP = '/tmp/v345-audit'
mkdirSync(join(TMP, 'constants'), { recursive: true })
for (const f of ['constants/pages.js', 'constants/roles.js']) {
  const dst = join(TMP, f)
  copyFileSync(join(SRC, f), dst)
  let s = readFileSync(dst, 'utf8')
  const before = s
  s = s.replace(/from '\.\/roles'/g, "from './roles.js'")
  s = s.replace(/from '\.\.\/store'/g, "from '../store.js'")
  if (f === 'constants/pages.js') {
    // pages.js import store 只为 canSee 便捷函数；审计不需要，替换为桩
    s = s.replace(/^import .*from '\.\.\/store\.js'.*$/m, "const store = { canModule: () => true, customRoles: [] }")
  }
  if (s !== before) {
    const n = before.split('\n').filter((l, i) => l !== s.split('\n')[i]).length
    console.log(`[patch] ${f} 已补/替换 import 说明符（${before !== s ? '有改动' : '无改动'}）`)
  }
  const { writeFileSync } = await import('node:fs')
  writeFileSync(dst, s)
}

const pages = await import(pathToFileURL(join(TMP, 'constants', 'pages.js')).href)

// —— 从导出的 PAGE_RULES 拿全表（若无导出，退回扫描源码文本）——
let RULES = pages.PAGE_RULES
if (!RULES) {
  console.log('⚠️ PAGE_RULES 未导出，改用文本扫描')
  RULES = {}
  const txt = readFileSync(join(SRC, 'constants/pages.js'), 'utf8')
  const re = /^\s*'([^']+)':\s*\{([^}]*)\}/gm
  let m
  while ((m = re.exec(txt))) {
    const body = m[2]
    const get = (k) => {
      const mm = body.match(new RegExp(k + "\\s*:\\s*([^,]+)"))
      return mm ? mm[1].trim() : null
    }
    RULES[m[1]] = {
      title: (get('title') || '').replace(/^'|'$/g, ''),
      module: get('module') === 'null' ? null : (get('module') || '').replace(/^'|'$/g, '') || null,
      moduleAny: get('moduleAny') || null,
      rolesRaw: get('roles'),
      lock: /lock\s*:\s*true/.test(body),
      cat: (get('cat') || '').replace(/^'|'$/g, ''),
    }
  }
}

console.log('登记行总数:', Object.keys(RULES).length)

const rows = []
for (const [path, r] of Object.entries(RULES)) {
  // 导出版：roles 已是数组或 null/undefined；文本扫描版：rolesRaw 是字符串
  const roleList = Array.isArray(r.roles) ? r.roles
    : (r.rolesRaw && r.rolesRaw !== 'null' ? [r.rolesRaw] : null)
  const hasRoles = Array.isArray(roleList) && roleList.length > 0
  const hasModule = !!r.module || !!r.moduleAny
  const lock = r.lock === true
  const delegatable = hasRoles && hasModule && !lock
  rows.push({ path, ...r, roleList, hasRoles, hasModule, lock, delegatable })
}
const roleTxt = (r) => r.roleList ? '[' + r.roleList.join(',') + ']' : '(无)'

const bad = rows.filter((r) => r.delegatable)
console.log('\n===== 🔴 让位可达（roles + module + 无 lock）共 ' + bad.length + ' 行 =====')
for (const r of bad) {
  console.log(`  ${r.path.padEnd(24)} module=${String(r.module).padEnd(9)} roles=${roleTxt(r)}`)
}

console.log('\n===== ✅ 已锁（roles + module + lock）共 ' + rows.filter(r => r.hasRoles && r.hasModule && r.lock).length + ' 行 =====')
for (const r of rows.filter((r) => r.hasRoles && r.hasModule && r.lock)) {
  console.log(`  ${r.path.padEnd(24)} module=${String(r.module).padEnd(9)} roles=${roleTxt(r)}`)
}

console.log('\n===== ⚪ 天然不让位（module 为 null ⇒ roleGateOpen 第 340 行直接 false）共 ' + rows.filter(r => r.hasRoles && !r.hasModule).length + ' 行 =====')
for (const r of rows.filter((r) => r.hasRoles && !r.hasModule)) {
  console.log(`  ${r.path.padEnd(24)} roles=${roleTxt(r)}`)
}

/* ==========================================================================
   🔴 第二判据（**缺了它会大量假阳性**）：把「静态可达」与「生产真值」交叉。

   教训（v345 实测）：只看「roles + module + 无 lock」会同时把 `/cron` 与 `/bid-radar`
   判成洞。但生产租户库真值（2026-09-30 只读查 `tenant_1.db::role_permissions`）显示：
     · supervisor（郝洋）动作字典里**含 `cron`** ⇒ `/cron` 是**真活洞**（老板亲眼看到）
     · accountant 里**不含 `bid`**  ⇒ `/bid-radar` 只是"静态可达"，**不构成活洞**
   ⇒ 静态扫描只能告诉你"**如果**该角色持有该模块就会漏"，**能不能漏要看真值**。
      "桩值能证机制，不能证存在" —— 生产探针里桩进去的 `permissions` 只能证明
      判据如何工作，**绝不能**据此断言"生产上真的有这条路"。
   ========================================================================== */
const TENANT_PERMS_20260930 = {
  // 出处：ssh 生产只读 `sqlite3 file:/opt/hergent-erp/tenant_1.db?mode=ro`
  //      SELECT role_name, permissions FROM role_permissions
  //      动作字典格式（= 本租户真实改过的角色）；数组格式 = 走产品默认值
  supervisor: ['dashboard', 'sales', 'stock', 'cron', 'bid', 'messages', 'forecast-audit'],
  accountant: ['data', 'sales', 'stock', 'accounts', 'reports', 'messages', 'forecast-audit'],
  '库管': ['dashboard', 'stock', 'data', 'messages'],
  // 以下为数组格式（未被本租户改过，走 _DEFAULT_PERMS）
  sales: ['dashboard', 'sales', 'buying', 'stock', 'crm', 'data', 'messages'],
  boss: ['dashboard', 'data', 'sales', 'buying', 'stock', 'accounts', 'crm', 'hr', 'payroll',
    'projects', 'goals', 'reports', 'chat', 'tasks', 'cron', 'bid', 'messages', 'forecast-audit'],
}
// 本租户「被真实改过权限」的角色（= 会触发让位）—— 出处同上
const TOUCHED_ROLES_20260930 = Object.keys(TENANT_PERMS_20260930).filter(
  (r) => !['sales', 'boss'].includes(r))

console.log('\n===== 🔴 交叉判定：窄名单（未覆盖满 BIZ_ROLES 5 个） + 让位可达 + **真值持有** =====')
console.log('（本租户被改过权限的角色 = ' + TOUCHED_ROLES_20260930.join('/') + '，只有它们会触发让位）')
const BIZ_SIZE = 5                         // BIZ_ROLES = admin/boss/accountant/sales/supervisor
const WEB_OTHER = ['supervisor', 'accountant', 'sales', 'staff', 'guide', 'driver', 'distributor', '库管']
let liveHoles = 0
for (const r of bad) {
  const listed = (r.roleList || []).map((x) => String(x))
  if (listed.length >= BIZ_SIZE) continue   // 宽名单（覆盖满业务岗）⇒ 让位是给自定义角色开的正门
  const outsiders = WEB_OTHER.filter((x) => !listed.includes(x))
  const leaked = outsiders.filter((x) =>
    TOUCHED_ROLES_20260930.includes(x) && (TENANT_PERMS_20260930[x] || []).includes(r.module))
  if (leaked.length) liveHoles++
  console.log(`  ${leaked.length ? '🔴' : '✅'} ${r.path.padEnd(16)} module=${String(r.module).padEnd(8)} 名单=${roleTxt(r)}`)
  console.log(`        名单外且**已被改过权限**的角色: ${outsiders.filter(x => TOUCHED_ROLES_20260930.includes(x)).join('/') || '（无）'}`
    + `  ⇒ 其中持有本模块的: ${leaked.length ? leaked.join('/') + ' 🔴 会漏' : '（无）'}`)
}
console.log('\n⇒ 真活洞 ' + liveHoles + ' 个。'
  + (liveHoles ? '（v345 已对 `/cron` 加 `lock: true` 修掉）' : ''))
console.log('⚠️ `/bid-radar` 判 ✅ 不等于"没风险" —— 它只是**当前**没漏（会计不持有 `bid`）；'
  + '一旦谁给会计勾上 `bid`，它立刻变成活洞。窄名单 + 无 lock 的形态本身就是脆弱点。')

