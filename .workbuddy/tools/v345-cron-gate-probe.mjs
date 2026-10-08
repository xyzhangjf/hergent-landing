/* v345 逻辑级判别力探针：`/cron` 的 `lock:true` 是否真的关掉了「让位」这条门。
 *
 * 两侧来源（**只差 v345 这一处**，故任何翻转都只能归因于它）：
 *   before = 工作区 pages.js **删掉 `/cron` 行里的 `lock: true, `**（等价于线上 v341 构建）
 *   after  = 工作区 pages.js 现状
 * 🔴 自证：打印两侧 md5 与 `/cron` 行原文，并证明两侧差异**恰好 1 行**。
 *
 * 用例设计（沿用 v341 探针的三条纪律）：
 *   ① 必须有「两侧结果不同」的用例（否则探针空转）；
 *   ② 必须有「同模块集、只换角色」或「同角色、只换 custom_roles」的单变量对照；
 *   ③ 必须有防误伤对照（老板 / 管理员必须不受影响）。
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const SRC = join(REPO, 'hergent-cn-v2', 'src')
const TMP = '/tmp/v345-gate'

const md5 = (s) => createHash('md5').update(s).digest('hex')

/* ---------- 造两侧副本 ---------- */
mkdirSync(join(TMP, 'after', 'constants'), { recursive: true })
mkdirSync(join(TMP, 'before', 'constants'), { recursive: true })

const rawPages = readFileSync(join(SRC, 'constants/pages.js'), 'utf8')

// before = 精确回退 v345 一处：把 /cron 行的 `lock: true, ` 去掉
const CRON_AFTER = rawPages.split('\n').find((l) => l.includes("'/cron':"))
if (!CRON_AFTER) throw new Error('未找到 /cron 登记行')
const CRON_BEFORE = CRON_AFTER.replace('lock: true, ', '')
if (CRON_BEFORE === CRON_AFTER) throw new Error('回退未生效：/cron 行里没有 `lock: true, `')

const beforePages = rawPages.replace(CRON_AFTER, CRON_BEFORE)

// 自证：两侧差异恰好 1 行
const dLines = []
const a = rawPages.split('\n'), b = beforePages.split('\n')
for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) dLines.push(i + 1)
console.log('===== 自证：两侧差异 =====')
console.log('  差异行数: ' + dLines.length + '（应为 1）' + (dLines.length === 1 ? ' ✅' : ' ❌'))
console.log('  before 行: ' + CRON_BEFORE.trim())
console.log('  after  行: ' + CRON_AFTER.trim())
console.log('  pages.js md5  before=' + md5(beforePages) + '  after=' + md5(rawPages))
if (dLines.length !== 1) process.exit(1)

/* node 原生 ESM 跑源码：只补说明符扩展名 / 替换 store 依赖（自证"恰好这两处"） */
const prep = (s) => s
  .replace(/from '\.\/roles'/g, "from './roles.js'")
  .replace(/^import \{ store \} from '\.\.\/store'$/m,
    'const store = { canModule: () => true, customRoles: [], user: { role: \'\' } }')

for (const side of ['before', 'after']) {
  const txt = side === 'before' ? beforePages : rawPages
  writeFileSync(join(TMP, side, 'constants/pages.js'), prep(txt))
  copyFileSync(join(SRC, 'constants/roles.js'), join(TMP, side, 'constants/roles.js'))
}

const P = {}
for (const side of ['before', 'after']) {
  P[side] = await import(pathToFileURL(join(TMP, side, 'constants/pages.js')).href)
}

/* ---------- 用例 ----------
   [id, 说明, path, role, perms(模块集), customRoles, 期望 before, 期望 after] */
const TOUCHED = ['supervisor']      // 本租户真实改过主管权限（生产实测 cr=["supervisor","库管"]）
const NONE = []
const cases = [
  // —— 主判据：让位 + 持有 cron ⇒ 修复前漏、修复后不漏 ——
  ['C01', '主管 + 改过权限 + 持 cron ⇒ 定时任务（本行只给 admin/boss）',
    '/cron', 'supervisor', ['dashboard', 'stock', 'cron'], TOUCHED, true, false],
  // —— 单变量对照：同角色、同 custom_roles，只去掉 cron ——
  ['C02', '主管 + 改过权限 + 无 cron（只换模块轴）',
    '/cron', 'supervisor', ['dashboard', 'stock'], TOUCHED, false, false],
  // —— 单变量对照：同模块集，只把 custom_roles 清空（= 没改过权限）——
  ['C03', '主管 + **未**改过权限 + 持 cron（让位条件不成立）',
    '/cron', 'supervisor', ['dashboard', 'stock', 'cron'], NONE, false, false],
  // —— 防误伤：名单内的人必须照旧看得见 ——
  ['C04', '老板 + 未改过权限 + 持 cron ⇒ 仍看得见', '/cron', 'boss', ['dashboard', 'cron'], NONE, true, true],
  ['C05', '老板 + 改过权限 + 持 cron ⇒ 仍看得见', '/cron', 'boss', ['dashboard', 'cron'], ['boss'], true, true],
  ['C06', '管理员 + 持 cron ⇒ 仍看得见', '/cron', 'admin', ['dashboard', 'cron'], NONE, true, true],
  // —— 同族已锁行：它们本来就不让位（护栏一致性）——
  ['C07', '主管 + 改过权限 + 持 chat ⇒ AI 团队仍不可见（lock 同族）',
    '/roles', 'supervisor', ['dashboard', 'chat'], TOUCHED, false, false],
  ['C08', '主管 + 改过权限 + 持 chat ⇒ 设置仍不可见（module 为 null）',
    '/settings', 'supervisor', ['dashboard', 'chat'], TOUCHED, false, false],
  ['C09', '老板 + 持 chat ⇒ AI 团队可见', '/roles', 'boss', ['dashboard', 'chat'], NONE, true, true],
  // —— 记录事实：同族**未修**行（/bid-radar 会计可见）——
  ['C10', '会计 + 改过权限 + 持 bid ⇒ 招投标雷达可见（本轮未改，记录事实）',
    '/bid-radar', 'accountant', ['dashboard', 'reports', 'bid'], ['accountant'], true, true],
  // —— v341 的修复不得被本轮动到 ——
  ['C11', '主管 + 改过权限 + 无 data ⇒ 档案管理不可见（v341 成果保持）',
    '/archive', 'supervisor', ['dashboard', 'stock'], TOUCHED, false, false],
  ['C12', '老板 + 持 data ⇒ 档案管理可见', '/archive', 'boss', ['dashboard', 'data'], NONE, true, true],
]

/* 路由守卫层（深链）：`pageRoleAllowed` 只判角色门槛 */
const guard = [
  ['C13', '守卫：主管深链 /cron（改过权限）—— 入口消失后**深链也被拦**',
    '/cron', 'supervisor', TOUCHED, true, false],
  ['C14', '守卫：老板深链 /cron 照常放行', '/cron', 'boss', NONE, true, true],
  ['C15', '守卫：主管深链 /archive（module 轴不在守卫内 ⇒ 两侧都放行）',
    '/archive', 'supervisor', TOUCHED, true, true],
]

let pass = 0, fail = 0
const diffCases = []

const run = (side, c) => {
  const [id, desc, path, role, perms, cr, expBefore, expAfter] = c
  // 第 7 个元素 = before 期望；第 8 个（可选）= after 期望（用于「翻转」型用例）
  const exp = side === 'before' ? expBefore : (expAfter === undefined ? expBefore : expAfter)
  const got = P[side].canSeePage(path, role, (m) => perms.includes(m), cr)
  const okk = got === exp
  if (side === 'after') { okk ? pass++ : fail++ }
  return { got, exp, okk }
}

console.log('\n===== 入口判据 canSeePage =====')
for (const c of cases) {
  const [id, desc, path] = c
  const rB = run('before', c)
  const rA = run('after', c)
  const flipped = rB.got !== rA.got
  if (flipped) diffCases.push(id)
  const mark = rA.okk ? 'PASS' : 'FAIL'
  console.log('  ' + mark + '  ' + id + ' ' + desc)
  console.log('        path=' + path + '  before=' + rB.got + '(期望' + rB.exp + (rB.okk ? ' ✓' : ' ✗') + ')'
    + '  after=' + rA.got + '(期望' + rA.exp + (rA.okk ? ' ✓' : ' ✗') + ')'
    + (flipped ? '   ← 两侧不同' : ''))
}

console.log('\n===== 路由守卫 pageRoleAllowed（深链）=====')
for (const c of guard) {
  const [id, desc, path, role, cr, expB, expA] = c
  const gotB = P.before.pageRoleAllowed(path, role, cr)
  const gotA = P.after.pageRoleAllowed(path, role, cr)
  const okk = (gotB === expB) && (gotA === expA)
  okk ? pass++ : fail++
  if (gotB !== gotA) diffCases.push(id)
  console.log('  ' + (okk ? 'PASS' : 'FAIL') + '  ' + id + ' ' + desc)
  console.log('        before=' + gotB + '(期望' + expB + ')  after=' + gotA + '(期望' + expA + ')'
    + (gotB !== gotA ? '   ← 两侧不同' : ''))
}

console.log('\n===== 判别力自证 =====')
console.log('两侧结果不同的用例: ' + (diffCases.length ? diffCases.join(', ') : '（无 ⇒ 探针在空转）'))
console.log('两侧结果相同的用例: ' + (cases.length + guard.length - diffCases.length) + ' 条（含单变量对照与防误伤）')
if (!diffCases.length) { console.log('\n🔴 判别力不足：修复前后无差异'); fail++ }

console.log('\n总判定: ' + pass + ' 通过 / ' + fail + ' 失败' + (fail === 0 ? '　✅ 全绿' : '　❌ 有失败项'))
process.exit(fail === 0 ? 0 : 1)
