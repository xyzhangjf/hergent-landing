/* ㊾ v773 建立 / v774 修订 / v775（B 方案）拆分：
 *   导购（guide）只进「面向全体报单人的广播」；催单类与「管理兜底广播」一律不进；
 *   经营/账务类同样不许放开。v775 起兜底广播有独立 event_key + 独立（管理链）受众。
 *
 * 背景（2026-11-05 生产核查）：v330 收口受众时导购还是 web 端，v333 才收紧成 mini
 *   （「导购报单要用小程序」），两条改动没对上 ⇒ 生产 21,704 条通知里 5 个在职导购
 *   有 3 个可见 0 条（含马耀秀），本人会话实测 total=0。v773 补 guide 修好了「漏给」。
 *
 * 🔴 v774（老板追问「唐成的预报催单怎么发给马耀秀了」）：v773 把 8 条规则**一锅端**
 *   补 guide ⇒ 导购可见 0→31，其中 11 条是 `预报催单 · 报单期次` 的**兜底广播** ——
 *   未绑定负责人的单元（「唐成」`report_mapping.employee_id=0`）写端发 `recipients=''`，
 *   本意只给管理端，正文含**别人的单元名＋本期订量/金额**。v774 只撤 3 条催单规则
 *   的 guide ⇒ 31→20，堵住了导购，但结构没拆：其余一线角色仍能看到金额。
 *
 * 🔴 v775（B 方案，老板拍板）：从**写端**把管理兜底广播拆成独立事件键
 *   `forecast_reminder_unbound`，受众登记管理链 `admin,boss,supervisor`；
 *   旧 `预报催单` 精确/前缀键只为存量 11 行保留，受众必须一模一样（防两处漂移）。
 *   定向催单 `forecast_remind_emp_<id>` 带 `recipients`，走定向优先 —— 受众表不参与，
 *   撤不撤 guide 都不影响点名给本人的催单（运行态真判据另见
 *   `.workbuddy/tools/v773-guide-notice-check.py`）。
 *
 * 🔴 反向硬判据：经营结果 / 账务 / 洞察 / 客户流失 / 库存效期 / DEFAULT 一概不含 guide
 *    —— 那些正文带客户名与欠款金额，放开就是重演 v330 修掉的泄密（m2/m3 专防）。
 * 🔴 不许「删键凑数」：判据既数含 guide 的条数、也断言每个键都存在、并逐个核对
 *    名单字面值；写端常量与受众表键必须同名（防「改了一处、另一处没跟上」）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROJ = path.resolve(ROOT, '..')
const FIN = path.join(PROJ, '.workbuddy/remote-erp/db/queries/finance.py')
const SCHED = path.join(PROJ, '.workbuddy/remote-erp/scheduler.py')
const read = (p) => fs.readFileSync(p, 'utf8')

/* 剥 # 注释行后再判结构（注释里逐字抄了反例，不剥会自撞；docstring 故意保留 ——
   scheduler 的受众名单注释也是判据对象，见「不许抄第二份名单」）。 */
const stripPy = (s) => s.split('\n').map((l) => l.replace(/^\s*#.*$/, '')).join('\n')

const SEVEN = 'admin,boss,sales,supervisor,distributor,staff,guide'
const SIX = 'admin,boss,sales,supervisor,distributor,staff'
const MGMT = 'admin,boss,supervisor'
const UNBOUND = 'forecast_reminder_unbound'
const GUIDE_ON_EXACT = ['本期报单已开放', '预报·新期次']
const GUIDE_ON_PREFIX = ['预报·新期次', 'forecast_period_open_', 'forecast_extra_alloc']
/* v775：管理兜底 3 条规则（2 精确 + 1 前缀）必须同口径 MGMT。 */
const MGMT_EXACT = ['预报催单', UNBOUND]
const MGMT_PREFIX = ['预报催单']
const SIX_PREFIX = ['forecast_remind_emp_']
const SENSITIVE = ['盈亏快报', '经营日报', '经营卡简报', '应收逾期提醒', '异常支出预警',
  '合同到期提醒', 'AI 经营洞察', '今日经营洞察', '档案健康检查', '客户流失预警',
  '库存预警', '效期预警·紧急', '效期预警·提醒', '定时任务·']
/* 🔴 必须含生产真实落库的存量兜底 event_key，以及 v775 新键 —— 只测 `预报催单`
   会漏掉它（v773 就是这么滑过去的）。 */
const UNBOUND_KEYS = ['预报催单', '预报催单 · 报单期次', UNBOUND]
const GUIDE_VISIBLE = ['本期报单已开放', '预报·新期次',
  'forecast_period_open_43', 'forecast_extra_alloc|43|1']
const GUIDE_HIDDEN = [...UNBOUND_KEYS, 'forecast_remind_emp_23']
const ALL_ROLES = ['admin', 'boss', 'supervisor', 'sales', 'staff', 'distributor', 'guide']
const MGMT_ROLES = ['admin', 'boss', 'supervisor']
const FRONT_ROLES = ['sales', 'staff', 'distributor', 'guide']

function blocks(src) {
  const out = { exact: {}, prefix: {} }
  for (const [key, marker] of [['exact', '_AUDIENCE_EXACT = {'], ['prefix', '_AUDIENCE_PREFIX_RAW = {']]) {
    const i = src.indexOf(marker)
    if (i < 0) return out
    const body = src.slice(i + marker.length, src.indexOf('\n}', i))
    for (const m of body.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g)) out[key][m[1]] = m[2]
  }
  return out
}

/* 兜底广播写端的结构化位置：从 `if unbound and _inapp:` 到「② 企业微信」注释之间。
   不全文 grep —— 全文里还有一条定向 message_send，会被误当成兜底。 */
function unboundBlock(sched) {
  const i = sched.indexOf('if unbound and _inapp:')
  const j = sched.indexOf('# ② 企业微信', i)
  return i >= 0 && j > i ? sched.slice(i, j) : ''
}

/* 同一组判据跑在任意一份（可能被改坏的）源码上 —— 坏样本自证靠它。 */
function probe(fin, sched) {
  const e = stripPy(fin)
  const b = blocks(e)
  const all = { ...b.exact, ...b.prefix }
  const ub = unboundBlock(sched)
  const c = {}

  // ── A 正向结构：5 条含 guide、3 条管理兜底、1 条定向兜底，键一个不少 ──
  // 🔴 两个表里有同名键（预报催单 / 预报·新期次），用 {...exact, ...prefix} 合并会
  //    把它们算成 6 个唯一键 ⇒ 不能拿合并后的对象数条数。必须按两张表分别数。
  const forecastAll = new Set([...GUIDE_ON_EXACT, ...GUIDE_ON_PREFIX,
    ...MGMT_EXACT, ...MGMT_PREFIX, ...SIX_PREFIX])
  c['恰好 5 条规则含 guide（2 精确 + 3 前缀）'] =
    Object.values(b.exact).filter((v) => v.includes(',guide')).length === 2 &&
    Object.values(b.prefix).filter((v) => v.includes(',guide')).length === 3
  c['报单线 9 个键都存在（不许删键凑数）'] =
    [...GUIDE_ON_EXACT, ...MGMT_EXACT].every((k) => !!b.exact[k]) &&
    [...GUIDE_ON_PREFIX, ...MGMT_PREFIX, ...SIX_PREFIX].every((k) => !!b.prefix[k])
  c['含 guide 的 5 条都恰好是七角色名单'] =
    GUIDE_ON_EXACT.every((k) => b.exact[k] === SEVEN) &&
    GUIDE_ON_PREFIX.every((k) => b.prefix[k] === SEVEN)
  c['管理兜底 3 条恰好都是管理链名单'] =
    Object.values(b.exact).filter((v) => v === MGMT).length === 2 &&
    MGMT_EXACT.every((k) => b.exact[k] === MGMT) &&
    Object.values(b.prefix).filter((v) => v === MGMT).length === 1 &&
    MGMT_PREFIX.every((k) => b.prefix[k] === MGMT)
  c['定向催单前缀仍是原六角色（异常态兜底）'] =
    b.prefix['forecast_remind_emp_'] === SIX &&
    Object.values(b.prefix).filter((v) => v === SIX).length === 1
  c['除报单线外没有任何规则含 guide'] =
    Object.entries(b.exact).filter(([k]) => !forecastAll.has(k)).every(([, v]) => !v.includes('guide')) &&
    Object.entries(b.prefix).filter(([k]) => !forecastAll.has(k)).every(([, v]) => !v.includes('guide'))
  c['新键只登记精确项，前缀表没有冗余副本'] = !b.prefix[UNBOUND]

  // ── A2 写端与受众表：两处必须同名，且兜底广播必须显式带 event_key ──
  const mConst = sched.match(/FORECAST_REMINDER_UNBOUND_EVENT\s*=\s*"([^"]+)"/)
  c['写端常量与受众表键同名（不许两处漂移）'] =
    !!mConst && mConst[1] === UNBOUND && !!b.exact[UNBOUND]
  c['兜底广播写端显式传独立 event_key'] =
    ub.length > 0 &&
    /db\.message_send\([\s\S]*?event_key=FORECAST_REMINDER_UNBOUND_EVENT/.test(ub) &&
    !ub.includes('db.message_send(title, "\\n".join(lines), "warning", "经营副驾")')
  c['定向催单写端仍带 recipients 与 forecast_remind_emp_ 键'] =
    sched.includes('recipients=str(acct["id"])') &&
    sched.includes('event_key=f"forecast_remind_emp_{eid}"')

  // ── B 反向：敏感类 / 兜底一个都不许沾 guide ──
  c['经营/账务/洞察/执行面 14 条规则均不含 guide'] =
    SENSITIVE.every((k) => !(all[k] || '').includes('guide'))
  c['DEFAULT_AUDIENCE 仍是 admin,boss'] =
    /DEFAULT_AUDIENCE\s*=\s*"admin,boss"/.test(e)
  c['未登记事件兜底不因本次改动放宽'] = !/DEFAULT_AUDIENCE\s*=\s*"[^"]*guide/.test(e)
  // 🔴 finance.py 里现在**故意**有 1 条六角色名单（定向催单异常态兜底），所以这条
  //    正则只能查 scheduler —— 查 fin 会把正确实现判成错，护栏就成了挡路的假阳性。
  c['scheduler 注释没抄回第二份旧六角色名单'] =
    !/admin,boss,sales,supervisor,distributor,staff(?!,guide)/.test(sched)

  // ── C 判定内核与「只有一份名单」──
  c['定向优先未被拆（recipients 非空时只看它）'] =
    /if rc:\s*\n\s*return rc in user_ids/.test(e)
  c['读端仍调唯一实现 message_visible'] = /def message_visible\(/.test(e)

  // ── D 规则表仿真：按真实前缀优先级算各角色可见性 ──
  const prefixes = Object.keys(b.prefix).sort((a, z) => z.length - a.length)
  const audienceOf = (ek) => {
    if (b.exact[ek]) return b.exact[ek]
    const hit = prefixes.find((p) => ek.startsWith(p))
    return hit ? b.prefix[hit] : 'admin,boss'
  }
  const visible = (ek, roles, rc = '') => {
    if (rc) return false                          // 仿真只看广播；定向优先另有真判据
    const bag = ',' + audienceOf(ek) + ','
    return roles.some((r) => bag.includes(',' + r + ','))
  }
  c['仿真：guide 可见 4 个开放类广播'] =
    GUIDE_VISIBLE.every((k) => visible(k, ['guide']))
  c['仿真：guide 不可见 4 个催单/兜底类'] =
    GUIDE_HIDDEN.every((k) => !visible(k, ['guide']))
  c['仿真：guide 不可见经营/账务类'] =
    SENSITIVE.every((k) => !visible(k, ['guide']))
  c['仿真：管理链可见兜底（新键 + 存量键）'] =
    MGMT_ROLES.every((r) => UNBOUND_KEYS.every((k) => visible(k, [r])))
  c['仿真：一线/外部角色不可见兜底（v775 收窄）'] =
    FRONT_ROLES.every((r) => UNBOUND_KEYS.every((k) => !visible(k, [r])))
  c['仿真：开放类仍全员可见（含导购，不许误伤）'] =
    ALL_ROLES.every((r) => GUIDE_VISIBLE.every((k) => visible(k, [r])))
  c['仿真：会计仍可见应收逾期（对照组别写反）'] = visible('应收逾期提醒', ['accountant'])
  return c
}

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else { console.log('  ❌ ' + label + (extra ? ' ' + extra : '')); failed++ }
}

const SRC = { fin: read(FIN), sched: read(SCHED) }
const base = probe(SRC.fin, SRC.sched)

console.log('A–D. v775 源码判据（对照组：原样必须全绿）')
for (const [k, v] of Object.entries(base)) ok(v, k)
ok(Object.values(base).every(Boolean), '对照组全绿',
  `实测 ${Object.values(base).filter(Boolean).length}/${Object.values(base).length}`)

console.log('\nE. 坏样本自证（每条都必须被判否，否则护栏是空白支票）')
const splitAt = SRC.fin.indexOf('_AUDIENCE_PREFIX_RAW = {')
const head = SRC.fin.slice(0, splitAt)
const tail = SRC.fin.slice(splitAt)
/* 把「某条规则的名单」换成另一个值。用真实当前值做 needle，坏样本才不会因
   v774→v775 名单变化而静默不改动（v774 那版写死 SIX 就踩过这个坑）。 */
const setValue = (src, key, from, to) => {
  const needle = '"' + key + '": "' + from + '"'
  const i = src.lastIndexOf(needle)
  return i < 0 ? src : src.slice(0, i) + src.slice(i).replace(needle, '"' + key + '": "' + to + '"', 1)
}
const mutants = [
  ['m1 退回 v330 旧口径（5 条含 guide 全撤）',
    SRC.fin.replace(/,staff,guide"/g, ',staff"'), SRC.sched],
  ['m2 把 guide 塞进「应收逾期提醒」（客户欠款泄密）',
    SRC.fin.replace('"应收逾期提醒": "admin,boss,accountant"',
      '"应收逾期提醒": "admin,boss,accountant,guide"'), SRC.sched],
  ['m3 把 DEFAULT_AUDIENCE 改成含 guide（未登记事件全放行）',
    SRC.fin.replace('DEFAULT_AUDIENCE = "admin,boss"', 'DEFAULT_AUDIENCE = "admin,boss,guide"'), SRC.sched],
  ['m4 拆掉定向优先（别人的催单广播给所有导购）',
    SRC.fin.replace('    if rc:\n        return rc in user_ids',
      '    if rc and False:\n        return rc in user_ids'), SRC.sched],
  // 只在前缀块里撤 guide：精确键看着「已修好」，生产 20 条开放通知却仍全走前缀 ⇒ 假修复
  ['m5 只补精确键、漏掉 3 条前缀（生产实际全走前缀）',
    head + tail.replace(/,staff,guide"/g, ',staff"'), SRC.sched],
  ['m6 scheduler 注释又抄回旧六角色名单（第二份口径）',
    SRC.fin, SRC.sched.replace('v773 起 `guide`（导购）也在内',
      '＝ `admin,boss,sales,supervisor,distributor,staff`')],
  // 🔴 v774 核心反证：兜底广播那条前缀被重新加回 guide ⇒ 马耀秀又看到「唐成」＋金额
  ['m7 前缀「预报催单」加回 guide（v773 误伤复发）',
    head + setValue(tail, '预报催单', MGMT, SEVEN), SRC.sched],
  ['m8 `forecast_remind_emp_` 加回 guide（冗余规则复发）',
    head + setValue(tail, 'forecast_remind_emp_', SIX, SEVEN), SRC.sched],
  ['m9 删掉「预报催单」前缀键凑数（只查上限不查存在的空白支票）',
    head + tail.replace('    "预报催单": "' + MGMT + '",\n', ''), SRC.sched],
  // ── v775 新增：拆键不彻底 / 受众漂移 / 泄密复发 ──
  ['m10 写端漏传 event_key（退回共用「预报催单」前缀）',
    SRC.fin, SRC.sched.replace(',\n                            event_key=FORECAST_REMINDER_UNBOUND_EVENT', '')],
  ['m11 新键受众改回原六角色（一线又看到金额）',
    setValue(SRC.fin, UNBOUND, MGMT, SIX), SRC.sched],
  ['m12 新键受众含 guide（v773 误伤换个键复发）',
    setValue(SRC.fin, UNBOUND, MGMT, SEVEN), SRC.sched],
  ['m13 存量前缀与新键受众漂移（两套口径）',
    head + setValue(tail, '预报催单', MGMT, SIX), SRC.sched],
  ['m14 写端常量改名、受众表没跟（两处漂移）',
    SRC.fin, SRC.sched.replace('FORECAST_REMINDER_UNBOUND_EVENT = "' + UNBOUND + '"',
      'FORECAST_REMINDER_UNBOUND_EVENT = "forecast_reminder_unbound_v2"')],
  ['m15 删掉新键（落 DEFAULT，主管少看兜底）',
    SRC.fin.replace('    "' + UNBOUND + '": "' + MGMT + '",  # v775 管理兜底（新行）\n', ''), SRC.sched],
]

for (const [label, fin, sched] of mutants) {
  if (fin === SRC.fin && sched === SRC.sched) {
    console.log('  ❌ ' + label + ' → 坏样本没改动源码'); failed++; continue
  }
  const c = probe(fin, sched)
  const hits = Object.entries(c).filter(([, v]) => !v).map(([k]) => k)
  ok(hits.length > 0, `${label} → 检出 ${hits.length} 条（${hits[0] || ''}）`)
}

console.log('\n' + (failed === 0
  ? '✓ v775 导购通知受众 / 管理兜底拆分契约全部通过'
  : `✗ v775 契约 FAILED ${failed}`))
process.exit(failed === 0 ? 0 : 1)
