/* v347 逻辑级判别力探针：`/forecast` 改挂窄模块 `forecast` ＋ `/bid-radar` 名单加主管。
 *
 * 两侧来源（**只差 v347 这两处**，故任何翻转都只能归因于它们）：
 *   before = 工作区 pages.js 精确回退 v347 的两处改动（等价于线上 v345 构建）
 *   after  = 工作区 pages.js 现状
 * 🔴 自证：打印两侧 md5，并证明两侧差异**恰好 2 行**。
 *
 * 用例设计（沿用 v341 / v345 探针的三条纪律）：
 *   ① 必须有「两侧结果不同」的用例（否则探针在空转）；
 *   ② 必须有单变量对照（同角色只换 customRoles / 同模块集只换角色）；
 *   ③ 必须有防误伤对照（老板 / 会计 / 主管自己该看的仍看得见）。
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const SRC = join(REPO, 'hergent-cn-v2', 'src')
const TMP = '/tmp/v347-probe'

const md5 = (s) => createHash('md5').update(s).digest('hex')

/* ---------- 造两侧副本 ---------- */
mkdirSync(join(TMP, 'after', 'constants'), { recursive: true })
mkdirSync(join(TMP, 'before', 'constants'), { recursive: true })

const rawPages = readFileSync(join(SRC, 'constants/pages.js'), 'utf8')

const line = (needle) => {
  const l = rawPages.split('\n').find((x) => x.includes(needle) && x.trim().startsWith("'/"))
  if (!l) throw new Error('未找到登记行: ' + needle)
  return l
}

const FC_AFTER = line("'/forecast':")
const BR_AFTER = line("'/bid-radar':")

if (!FC_AFTER.includes("module: 'forecast'")) throw new Error('/forecast 行未挂 forecast 模块')
if (!BR_AFTER.includes("'supervisor'")) throw new Error('/bid-radar 行未含 supervisor')

// before = 精确回退这两处
const FC_BEFORE = FC_AFTER.replace("module: 'forecast'", "module: 'data'")
const BR_BEFORE = BR_AFTER.replace(", 'supervisor'", '')
if (FC_BEFORE === FC_AFTER) throw new Error('回退未生效：/forecast')
if (BR_BEFORE === BR_AFTER) throw new Error('回退未生效：/bid-radar')

let beforePages = rawPages.replace(FC_AFTER, FC_BEFORE).replace(BR_AFTER, BR_BEFORE)

const a = rawPages.split('\n'), b = beforePages.split('\n')
const dLines = []
for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) dLines.push(i + 1)

console.log('===== 自证：两侧差异 =====')
console.log('  差异行数: ' + dLines.length + '（应为 2）' + (dLines.length === 2 ? ' ✅' : ' ❌'))
console.log('  before /forecast: ' + FC_BEFORE.trim())
console.log('  after  /forecast: ' + FC_AFTER.trim())
console.log('  before /bid-radar: ' + BR_BEFORE.trim())
console.log('  after  /bid-radar: ' + BR_AFTER.trim())
console.log('  pages.js md5  before=' + md5(beforePages) + '  after=' + md5(rawPages))
if (dLines.length !== 2) process.exit(1)

/* node 原生 ESM 跑源码：只补说明符扩展名 / 替掉 store 依赖 */
const prep = (s) => s
  .replace(/from '\.\/roles'/g, "from './roles.js'")
  .replace(/^import \{ store \} from '\.\.\/store'$/m,
    "const store = { canModule: () => true, customRoles: [], user: { role: '' } }")

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
const TOUCHED = ['supervisor', '库管']   // 生产实测 custom_roles 真值
const NONE = []

const KU = ['dashboard', 'stock', 'data', 'messages']                       // 库管真实权限
const SV_OLD = ['dashboard', 'data', 'sales', 'stock', 'cron', 'bid', 'messages', 'forecast-audit'] // 迁移前
const SV_NEW = ['dashboard', 'data', 'sales', 'stock', 'bid', 'messages', 'forecast', 'forecast-audit'] // 迁移后（撤 cron、加 forecast）
const AC_NEW = ['dashboard', 'data', 'sales', 'accounts', 'reports', 'stock', 'messages', 'forecast']
const BOSS = ['dashboard', 'data', 'sales', 'buying', 'stock', 'accounts', 'crm', 'hr', 'payroll',
  'projects', 'goals', 'reports', 'chat', 'tasks', 'cron', 'bid', 'messages', 'forecast', 'forecast-audit']
const SALES = ['dashboard', 'sales', 'buying', 'stock', 'crm', 'data', 'messages']
const DIST = ['data']

const cases = [
  // ===== 🔴 核心翻转 ①：库管不再看见「预报订货管理」=====
  ['C01', '库管 + 本租户改过权限 + 持 data ⇒ 预报订货管理',
    '/forecast', '库管', KU, TOUCHED, true, false],
  ['C02', '同一角色、**没被改过权限**（单变量对照）⇒ 本来就不该显示',
    '/forecast', '库管', KU, NONE, false, false],

  // ===== 🔴 核心翻转 ②：分销商同理（它是内置角色、也不在名单里）=====
  ['C03', '分销商 + 改过权限 + 持 data ⇒ 预报订货管理',
    '/forecast', 'distributor', DIST, ['distributor'], true, false],

  // ===== 🔴 核心翻转 ③：主管看「招投标雷达」由**隐式**改**显式** =====
  ['C04', '主管 + **没被改过权限** ⇒ 招投标雷达（旧路径要靠"被改过"才亮）',
    '/bid-radar', 'supervisor', SV_NEW, NONE, false, true],
  ['C05', '主管 + 改过权限 ⇒ 招投标雷达（两种机制都亮，故两侧相同）',
    '/bid-radar', 'supervisor', SV_NEW, TOUCHED, true, true],

  // ===== 防误伤：名单内的人该看的仍看得见 =====
  ['C06', '主管（迁移后）⇒ 预报订货管理仍可见（他在 FORECAST_SUMMARY_ROLES）',
    '/forecast', 'supervisor', SV_NEW, TOUCHED, true, true],
  ['C07', '会计 ⇒ 预报订货管理仍可见', '/forecast', 'accountant', AC_NEW, TOUCHED, true, true],
  ['C08', '老板 ⇒ 预报订货管理仍可见', '/forecast', 'boss', BOSS, NONE, true, true],
  ['C09', '管理员 ⇒ 预报订货管理仍可见', '/forecast', 'admin', ['*'], NONE, true, true],

  // ===== 反向对照：一线角色本来就不该看见 =====
  ['C10', '业务员（未被改过权限）⇒ 预报订货管理不可见（旧侧也不可见）',
    '/forecast', 'sales', SALES, NONE, false, false],
  ['C11', '业务员 + 改过权限 ⇒ 旧侧**会漏**（模块轴判 data）、新侧不漏',
    '/forecast', 'sales', SALES, ['sales'], true, false],

  // ===== 回归防护：v345 的 /cron lock 不许被本轮弄坏 =====
  ['C12', '库管 + 改过权限 ⇒ 定时任务仍不可见（v345 的 lock 未被破坏）',
    '/cron', '库管', KU, TOUCHED, false, false],
  ['C13', '主管（迁移后已无 cron）⇒ 定时任务不可见',
    '/cron', 'supervisor', SV_NEW, TOUCHED, false, false],

  // ===== 库管看招投标雷达（他不持 bid，两侧都不该看见）=====
  ['C14', '库管 ⇒ 招投标雷达不可见（不持 bid）',
    '/bid-radar', '库管', KU, TOUCHED, false, false],
]

let pass = 0, fail = 0
const rows = []
console.log('\n===== 逐用例 =====')
for (const [id, desc, path, role, perms, cr, expB, expA] of cases) {
  const got = (side) => P[side].canSeePage(path, role, (m) => perms.includes(m) || perms.includes('*'), cr)
  const gB = got('before'), gA = got('after')
  const okB = gB === expB, okA = gA === expA
  const ok = okB && okA
  ok ? pass++ : fail++
  const flip = gB !== gA ? '  ⚡翻转' : ''
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + desc)
  console.log('        ' + path + '  before=' + gB + '(期望' + expB + ') after=' + gA +
    '(期望' + expA + ')' + flip)
  if (!ok) console.log('        🔴 期望不符')
  rows.push({ id, path, gB, gA, ok })
}

/* ---------- 判别力自证 ---------- */
const flipped = rows.filter((r) => r.gB !== r.gA).map((r) => r.id)
const same = rows.filter((r) => r.gB === r.gA).map((r) => r.id)
console.log('\n===== 判别力自证 =====')
console.log('  两侧结果不同的用例: ' + (flipped.length ? flipped.join(', ') : '（无 ⇒ 探针在空转）'))
console.log('  两侧结果相同的用例: ' + same.length + ' 条（' + same.join(', ') + '）')
if (!flipped.length) { console.log('  🔴 判别力不足：修复前后无差异，探针无法证明任何事'); fail++ }

/* ---------- 单变量对照自证：C01 vs C02 只差 customRoles ---------- */
const c01 = rows.find((r) => r.id === 'C01'), c02 = rows.find((r) => r.id === 'C02')
console.log('\n===== 单变量对照（证明"翻转来自哪条轴"）=====')
const ctrl1 = c01.gB === true && c02.gB === false && c01.gA === false && c02.gA === false
console.log('  ' + (ctrl1 ? 'PASS' : 'FAIL') +
  '  C01 vs C02：同角色同模块集，**只换 customRoles** ⇒ before 侧 true/false 分化')
console.log('        ⇒ 证明 before 的那个 true 确实来自「让位」，不是角色在名单里；')
console.log('          而 after 侧两者皆 false ⇒ 证明新模块轴把它挡住了。')
if (!ctrl1) fail++
const c04 = rows.find((r) => r.id === 'C04')
const ctrl2 = c04.gB === false && c04.gA === true
console.log('  ' + (ctrl2 ? 'PASS' : 'FAIL') +
  '  C04：主管**未被改过权限**时，招投标雷达 before=false → after=true')
console.log('        ⇒ 证明"补进名单"确实把隐式路径变成了对任何租户都成立的显式路径。')
if (!ctrl2) fail++

console.log('\n总判定: ' + (fail === 0 ? '✅ 全绿' : '❌ 有失败项') +
  '（' + pass + ' 通过 / ' + fail + ' 失败 / 共 ' + cases.length + '）')
process.exit(fail ? 1 : 0)
