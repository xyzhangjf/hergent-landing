/* ㊾ v773 契约：导购（guide）补进报单线通知受众，且不顺手放开经营/账务类。
 *
 * 背景（2026-11-05 生产核查）：v330 收口受众时导购还是 web 端，v333 才收紧成 mini
 *   （「导购报单要用小程序」），两条改动没对上 ⇒ 生产 21,704 条通知里 5 个在职导购
 *   有 3 个可见 0 条（含马耀秀），用他本人会话实测 total=0。
 *
 * 🔴 补全范围必须**恰好**是报单线 8 条规则：
 *    精确键 3（本期报单已开放 / 预报催单 / 预报·新期次）
 *    前缀键 5（预报·新期次 / 预报催单 / forecast_remind_emp_ /
 *             forecast_period_open_ / forecast_extra_alloc）
 *    生产实际落库的 20 条「本期报单已开放」走的是 `forecast_period_open_` **前缀**，
 *    11 条催单广播走「预报催单」前缀 ⇒ 只补精确键 = 修了个寂寞（坏样本 m6 专防）。
 *
 * 🔴 反向硬判据：经营结果 / 账务 / 洞察 / 客户流失 / 库存效期 / DEFAULT 一概不含 guide
 *    —— 那些正文带客户名与欠款金额，放开就是重演 v330 修掉的泄密（坏样本 m2/m3 专防）。
 * 🔴 定向优先不能被拆：补了 guide 之后若把 `recipients` 判定拆掉，别人的定向催单
 *    会广播给全部导购（坏样本 m4 专防）。
 *
 * 运行态真判据另有 `.workbuddy/tools/v773-guide-notice-check.py`（AST 抠生产源码真跑
 * `message_visible`）；本契约负责每次 npm test 都能被 runner **真正执行**的静态判据。
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

const FORECAST_EXACT = ['本期报单已开放', '预报催单', '预报·新期次']
const FORECAST_PREFIX = ['预报·新期次', '预报催单', 'forecast_remind_emp_',
  'forecast_period_open_', 'forecast_extra_alloc']
const SENSITIVE = ['盈亏快报', '经营日报', '经营卡简报', '应收逾期提醒', '异常支出预警',
  '合同到期提醒', 'AI 经营洞察', '今日经营洞察', '档案健康检查', '客户流失预警',
  '库存预警', '效期预警·紧急', '效期预警·提醒', '定时任务·']

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

  // ── A 正向：8 条报单线规则全含 guide，且一个不多 ──
  // 🔴 两个表里有两个同名键（预报催单 / 预报·新期次），用 {...exact, ...prefix} 合并会
  //    把它们算成 6 个唯一键 ⇒ 不能拿合并后的对象数「8」。必须按两张表分别数。
  const forecastAll = new Set([...FORECAST_EXACT, ...FORECAST_PREFIX])
  c['恰好 8 条规则含 guide（3 精确 + 5 前缀）'] =
    Object.values(b.exact).filter((v) => v.includes(',guide')).length === 3 &&
    Object.values(b.prefix).filter((v) => v.includes(',guide')).length === 5
  c['除报单线外没有任何规则含 guide'] =
    Object.entries(b.exact).filter(([k]) => !forecastAll.has(k)).every(([, v]) => !v.includes('guide')) &&
    Object.entries(b.prefix).filter(([k]) => !forecastAll.has(k)).every(([, v]) => !v.includes('guide'))
  c['精确键 3 条报单线都含 guide'] =
    FORECAST_EXACT.every((k) => (b.exact[k] || '').includes(',guide'))
  c['前缀键 5 条报单线都含 guide'] =
    FORECAST_PREFIX.every((k) => (b.prefix[k] || '').includes(',guide'))
  c['报单线受众是同一份完整名单'] =
    [...FORECAST_EXACT, ...FORECAST_PREFIX].every(
      (k) => (all[k] || '') === 'admin,boss,sales,supervisor,distributor,staff,guide')

  // ── B 反向：敏感类 / 兜底一个都不许沾 guide ──
  c['经营/账务/洞察/执行面 14 条规则均不含 guide'] =
    SENSITIVE.every((k) => !(all[k] || '').includes('guide'))
  c['DEFAULT_AUDIENCE 仍是 admin,boss'] =
    /DEFAULT_AUDIENCE\s*=\s*"admin,boss"/.test(e)
  c['未登记事件兜底不因本次改动放宽'] = !/DEFAULT_AUDIENCE\s*=\s*"[^"]*guide/.test(e)

  // ── C 判定内核与「只有一份名单」──
  c['定向优先未被拆（recipients 非空时只看它）'] =
    /if rc:\s*\n\s*return rc in user_ids/.test(e)
  c['读端仍调唯一实现 message_visible'] = /def message_visible\(/.test(e)
  c['旧六角色名单在后端源码/注释里已绝迹'] =
    !/admin,boss,sales,supervisor,distributor,staff(?!,guide)/.test(fin) &&
    !/admin,boss,sales,supervisor,distributor,staff(?!,guide)/.test(sched)

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
  c['仿真：guide 可见 6 个报单线事件键'] =
    ['本期报单已开放', '预报催单', '预报·新期次', 'forecast_period_open_43',
      'forecast_remind_emp_23', 'forecast_extra_alloc|43|1'].every((k) => visible(k, ['guide']))
  c['仿真：guide 不可见经营/账务类'] =
    SENSITIVE.every((k) => !visible(k, ['guide']))
  c['仿真：原六角色仍可见报单线'] =
    ['admin', 'boss', 'sales', 'supervisor', 'distributor', 'staff']
      .every((r) => visible('forecast_period_open_43', [r]))
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

console.log('A–D. 补全后源码判据（对照组：原样必须全绿）')
for (const [k, v] of Object.entries(base)) ok(v, k)
ok(Object.values(base).every(Boolean), '对照组全绿',
  `实测 ${Object.values(base).filter(Boolean).length}/${Object.values(base).length}`)

console.log('\nE. 坏样本自证（每条都必须被判否，否则护栏是空白支票）')
const splitAt = SRC.fin.indexOf('_AUDIENCE_PREFIX_RAW = {')
const mutants = [
  ['m1 退回 v330 旧口径（8 条全撤 guide）',
    SRC.fin.replace(/,staff,guide"/g, ',staff"'), SRC.sched],
  ['m2 把 guide 塞进「应收逾期提醒」（客户欠款泄密）',
    SRC.fin.replace('"应收逾期提醒": "admin,boss,accountant"',
      '"应收逾期提醒": "admin,boss,accountant,guide"'), SRC.sched],
  ['m3 把 DEFAULT_AUDIENCE 改成含 guide（未登记事件全放行）',
    SRC.fin.replace('DEFAULT_AUDIENCE = "admin,boss"', 'DEFAULT_AUDIENCE = "admin,boss,guide"'), SRC.sched],
  ['m4 拆掉定向优先（别人的催单广播给所有导购）',
    SRC.fin.replace('    if rc:\n        return rc in user_ids',
      '    if rc and False:\n        return rc in user_ids'), SRC.sched],
  // 只在前缀块里撤 guide：精确键看着"已修好"，生产 20 条开放通知却仍全走前缀 ⇒ 假修复
  ['m5 只补精确键、漏掉 5 条前缀（生产实际全走前缀）',
    SRC.fin.slice(0, splitAt) + SRC.fin.slice(splitAt).replace(/,staff,guide"/g, ',staff"'), SRC.sched],
  ['m6 scheduler 注释又抄回旧六角色名单（第二份口径）',
    SRC.fin, SRC.sched.replace('v773 起 `guide`（导购）也在内',
      '＝ `admin,boss,sales,supervisor,distributor,staff`')],
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
  ? '✓ v773 导购通知受众补全契约全部通过'
  : `✗ v773 契约 FAILED ${failed}`))
process.exit(failed === 0 ? 0 : 1)
