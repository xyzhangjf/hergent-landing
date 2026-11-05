/* ㊾ v773 建立 / v774 修订：导购（guide）只进「面向全体报单人的广播」，
 *   催单类（含无收件人的兜底广播）一律不进；经营/账务类同样不许放开。
 *
 * 背景（2026-11-05 生产核查）：v330 收口受众时导购还是 web 端，v333 才收紧成 mini
 *   （「导购报单要用小程序」），两条改动没对上 ⇒ 生产 21,704 条通知里 5 个在职导购
 *   有 3 个可见 0 条（含马耀秀），本人会话实测 total=0。v773 补 guide 修好了「漏给」。
 *
 * 🔴 v774（老板追问「唐成的预报催单怎么发给马耀秀了」）：v773 把 8 条规则**一锅端**
 *   补 guide，导购可见 0→31，其中 11 条是 `预报催单 · 报单期次` 的**兜底广播** ——
 *   未绑定负责人的单元（生产实测「唐成」`report_mapping.employee_id=0`）写端发
 *   `recipients=''`，本意只给管理端，正文含**别人的单元名＋本期订量/金额**。
 *   同一个 `预报催单` 前缀同时服务「定向催单」和「管理兜底」两种意图，是结构病根。
 *   本次只撤 3 条催单规则的 guide，保留 5 条开放类 ⇒ 马耀秀 31→20（只剩期次开放）。
 *
 * 🔴 为什么定向催单撤了 guide 也不会漏给导购：`forecast_remind_emp_<id>` 落库带
 *   `recipients=<账号id>`，`message_visible` 定向优先 ⇒ 受众表根本不参与判定。
 *   点名给马耀秀的催单照收（由运行态真判据 `.workbuddy/tools/v773-guide-notice-check.py`
 *   真跑 `message_visible` 验证）；受众表里写 guide 纯属冗余且误导。
 *
 * 🔴 反向硬判据：经营结果 / 账务 / 洞察 / 客户流失 / 库存效期 / DEFAULT 一概不含 guide
 *    —— 那些正文带客户名与欠款金额，放开就是重演 v330 修掉的泄密（坏样本 m2/m3 专防）。
 * 🔴 不许「删键凑数」：判据既要数含 guide 的条数，也要断言 8 个键**都存在**、
 *    且 3 条催单规则**恰好**是原六角色名单（防只查上限不查存在的空白支票，m9 专防）。
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
const GUIDE_ON_EXACT = ['本期报单已开放', '预报·新期次']
const GUIDE_OFF_EXACT = ['预报催单']
const GUIDE_ON_PREFIX = ['预报·新期次', 'forecast_period_open_', 'forecast_extra_alloc']
const GUIDE_OFF_PREFIX = ['预报催单', 'forecast_remind_emp_']
const SENSITIVE = ['盈亏快报', '经营日报', '经营卡简报', '应收逾期提醒', '异常支出预警',
  '合同到期提醒', 'AI 经营洞察', '今日经营洞察', '档案健康检查', '客户流失预警',
  '库存预警', '效期预警·紧急', '效期预警·提醒', '定时任务·']
/* 🔴 必须含生产真实落库的兜底 event_key：只测 `预报催单` 会漏掉它（v773 就是这么滑过去的）。 */
const GUIDE_VISIBLE = ['本期报单已开放', '预报·新期次',
  'forecast_period_open_43', 'forecast_extra_alloc|43|1']
const GUIDE_HIDDEN = ['预报催单', '预报催单 · 报单期次', 'forecast_remind_emp_23']

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

/* 同一组判据跑在任意一份（可能被改坏的）源码上 —— 坏样本自证靠它。 */
function probe(fin, sched) {
  const e = stripPy(fin)
  const b = blocks(e)
  const all = { ...b.exact, ...b.prefix }
  const c = {}

  // ── A 正向结构：5 条含 guide、3 条不含，且 8 个键一个不少 ──
  // 🔴 两个表里有同名键（预报催单 / 预报·新期次），用 {...exact, ...prefix} 合并会
  //    把它们算成 6 个唯一键 ⇒ 不能拿合并后的对象数条数。必须按两张表分别数。
  const forecastAll = new Set([...GUIDE_ON_EXACT, ...GUIDE_OFF_EXACT,
    ...GUIDE_ON_PREFIX, ...GUIDE_OFF_PREFIX])
  c['恰好 5 条规则含 guide（2 精确 + 3 前缀）'] =
    Object.values(b.exact).filter((v) => v.includes(',guide')).length === 2 &&
    Object.values(b.prefix).filter((v) => v.includes(',guide')).length === 3
  c['报单线 8 条规则键都存在（不许删键凑数）'] =
    [...GUIDE_ON_EXACT, ...GUIDE_OFF_EXACT].every((k) => !!b.exact[k]) &&
    [...GUIDE_ON_PREFIX, ...GUIDE_OFF_PREFIX].every((k) => !!b.prefix[k])
  c['含 guide 的 5 条都恰好是七角色名单'] =
    GUIDE_ON_EXACT.every((k) => b.exact[k] === SEVEN) &&
    GUIDE_ON_PREFIX.every((k) => b.prefix[k] === SEVEN)
  c['催单类 3 条都恰好是原六角色名单'] =
    Object.entries(b.exact).filter(([, v]) => v === SIX).length === 1 &&
    b.exact['预报催单'] === SIX &&
    Object.entries(b.prefix).filter(([, v]) => v === SIX).length === 2 &&
    GUIDE_OFF_PREFIX.every((k) => b.prefix[k] === SIX)
  c['除报单线外没有任何规则含 guide'] =
    Object.entries(b.exact).filter(([k]) => !forecastAll.has(k)).every(([, v]) => !v.includes('guide')) &&
    Object.entries(b.prefix).filter(([k]) => !forecastAll.has(k)).every(([, v]) => !v.includes('guide'))

  // ── B 反向：敏感类 / 兜底一个都不许沾 guide ──
  c['经营/账务/洞察/执行面 14 条规则均不含 guide'] =
    SENSITIVE.every((k) => !(all[k] || '').includes('guide'))
  c['DEFAULT_AUDIENCE 仍是 admin,boss'] =
    /DEFAULT_AUDIENCE\s*=\s*"admin,boss"/.test(e)
  c['未登记事件兜底不因本次改动放宽'] = !/DEFAULT_AUDIENCE\s*=\s*"[^"]*guide/.test(e)
  // 🔴 finance.py 里现在**故意**有 3 条六角色名单（催单类），所以这条正则只能查
  //    scheduler —— 查 fin 会把正确实现判成错，护栏就成了挡路的假阳性。
  c['scheduler 注释没抄回第二份旧六角色名单'] =
    !/admin,boss,sales,supervisor,distributor,staff(?!,guide)/.test(sched)

  // ── C 判定内核与「只有一份名单」──
  c['定向优先未被拆（recipients 非空时只看它）'] =
    /if rc:\s*\n\s*return rc in user_ids/.test(e)
  c['读端仍调唯一实现 message_visible'] = /def message_visible\(/.test(e)

  // ── D 规则表仿真：按真实前缀优先级算 guide / 对照组可见性 ──
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
  c['仿真：guide 不可见 3 个催单类（含真实兜底 event_key）'] =
    GUIDE_HIDDEN.every((k) => !visible(k, ['guide']))
  c['仿真：guide 不可见经营/账务类'] =
    SENSITIVE.every((k) => !visible(k, ['guide']))
  c['仿真：原六角色仍可见全部 7 个生产事件键（含兜底广播）'] =
    ['admin', 'boss', 'sales', 'supervisor', 'distributor', 'staff']
      .every((r) => [...GUIDE_VISIBLE, ...GUIDE_HIDDEN].every((k) => visible(k, [r])))
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

console.log('A–D. 修订后源码判据（对照组：原样必须全绿）')
for (const [k, v] of Object.entries(base)) ok(v, k)
ok(Object.values(base).every(Boolean), '对照组全绿',
  `实测 ${Object.values(base).filter(Boolean).length}/${Object.values(base).length}`)

console.log('\nE. 坏样本自证（每条都必须被判否，否则护栏是空白支票）')
const splitAt = SRC.fin.indexOf('_AUDIENCE_PREFIX_RAW = {')
const head = SRC.fin.slice(0, splitAt)
const tail = SRC.fin.slice(splitAt)
const backToGuide = (key) => tail.replace('"' + key + '": "' + SIX + '"',
  '"' + key + '": "' + SEVEN + '"')
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
    head + backToGuide('预报催单'), SRC.sched],
  ['m8 `forecast_remind_emp_` 加回 guide（冗余规则复发）',
    head + backToGuide('forecast_remind_emp_'), SRC.sched],
  ['m9 删掉「预报催单」前缀键凑数（只查上限不查存在的空白支票）',
    head + tail.replace('    "预报催单": "' + SIX + '",\n', ''), SRC.sched],
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
  ? '✓ v774 导购通知受众分流契约全部通过'
  : `✗ v774 契约 FAILED ${failed}`))
process.exit(failed === 0 ? 0 : 1)
