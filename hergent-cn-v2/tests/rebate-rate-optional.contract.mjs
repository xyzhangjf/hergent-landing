/* v769 契约：品牌目标的「返利率」允许留空，且不能因此把别的月的费率套过来。
 *
 * 起因：v126 把 12 行月表当「返利配置表」，save() 里有一条
 *   「请至少填写一个月的返利率」硬拦 ⇒ 厂家本身没返利时，用户被迫编一个费率。
 *
 * 🔴 只删那一行是**假修复**：后端 `resolve_month_rate` 对「该月不在 monthly_rates 里」
 *    会向前找最近有值的月。1 月填过 10%、2 月留空 ⇒ 2 月静默套成 10%，
 *    凭空多算返利、零报错。所以「有目标金额 + 费率留空」的月必须**显式落 0**。
 *
 * 判据两层：① 真跑 buildMonthlyPayloads，断言 6 种月表形态（空/混合/0/非空/无金额/两种空形状）；
 *          ② 前后端同源静态判据 + 4 个坏样本自证。
 *    🔴 静态判据必须先剥注释：本轮改动在 TargetFormModal.vue 的注释里**逐字抄了**
 *       「请至少填写一个月的返利率」这句反例，不剥会自撞，然后被人删掉。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildMonthlyPayloads, emptyMonthlyRows,
} from '../src/components/rebate/useRebateTargetForm.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const PROJ = path.resolve(ROOT, '..')
const FILES = {
  form: path.join(ROOT, 'src/components/rebate/TargetFormModal.vue'),
  payload: path.join(ROOT, 'src/components/rebate/useRebateTargetForm.js'),
  split: path.join(ROOT, 'src/components/rebate/MonthlySplitBlock.vue'),
  py: path.join(PROJ, '.workbuddy/remote-erp/routers/rebate_rules.py'),
}

let failed = 0
const ok = (cond, label, extra = '') => {
  if (cond) console.log('  ✅ ' + label + (extra ? ' ' + extra : ''))
  else {
    console.log('  ❌ ' + label + (extra ? ' ' + extra : ''))
    failed++
  }
}

/* 剥注释但**保留行数**（v766 踩过：删掉 \n 会让报出来的行号集体前移）。 */
const stripJs = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^\S\n])\/\/[^\n]*/g, '$1')

function readAll(map) {
  return Object.fromEntries(Object.entries(map).map(([k, p]) => [k, fs.readFileSync(p, 'utf8')]))
}

function audit(s) {
  const errs = []
  const A = (cond, label) => { if (!cond) errs.push(label) }
  const form = stripJs(s.form)
  const payload = stripJs(s.payload)
  const split = stripJs(s.split)
  const py = s.py

  /* ① 前端：硬拦撤销，且没有换个马甲回来 */
  A(!form.includes('请至少填写一个月的返利率'), '硬拦句「请至少填写一个月的返利率」已撤')
  A(!/monthlyRates\)\.length\)\s*\{?\s*toast/.test(form), '没有「月表返利率为空就 toast」的变体')
  A((s.form.match(/if \(!Object\.keys\(monthly\.monthlyAmounts\)\.length\)/g) || []).length === 1,
    '目标金额校验只留一份（原来被复制了两遍）')

  /* ② 前端：留空必须显式落 0，且只给有目标金额的月份 */
  A(payload.includes('if (hasAmt && rateBlank) monthlyRates[r.mm] = 0'),
    '留空月显式落 0（防后端向前继承）')
  A(payload.includes('const hasAmt = r.amtWan != null && Number(r.amtWan) > 0'),
    '落 0 限定在「有目标金额」的月')
  A(split.includes('返利率留空 = 该月无返利'), 'UI 文案说清留空的含义')

  /* ③ 后端：同源放开，但只放开「品牌月度目标 + 真空值」 */
  A(py.includes('_brand_monthly = (dimension == "brand"'), '后端放行限定品牌 + 月度分解')
  A(/if _brand_monthly and _rr_blank:\s*\n\s*pass/.test(py), '后端空值放行分支')
  A(/elif not _is_num_like\(_rr_raw\):/.test(py), '🔴 非数字仍拦（不能顺手全放行）')
  A(/elif not \(0 <= rebate_rate <= 1\):/.test(py), '🔴 负数 / 越界仍拦')
  A(py.includes('for d in range(1, 13)'),
    'resolve_month_rate 的「向前找」仍在（落 0 方案依赖它存在，不许顺手改核心计算）')

  return errs
}

console.log('── v769 品牌目标返利率可留空 ──')

/* ① 真树静态判据 */
const real = audit(readAll(FILES))
ok(real.length === 0, '真树静态判据全过', real.length ? '\n     - ' + real.join('\n     - ') : '')

/* ② 真跑落库组装：6 种月表形态 */
const mk = (over = {}) => {
  const r = emptyMonthlyRows()
  for (const [mm, v] of Object.entries(over)) Object.assign(r.find((x) => x.mm === mm), v)
  return r
}
const P = (over) => buildMonthlyPayloads(mk(over)).monthlyRates

const allBlank = P({ '01': { amtWan: 10 }, '02': { amtWan: 10 } })
ok(allBlank['01'] === 0 && allBlank['02'] === 0,
  'A 全留空 → 每个有金额月都落 0（不是空对象）', JSON.stringify(allBlank))

const mixed = P({ '01': { amtWan: 10, ratePct: 10 }, '02': { amtWan: 10 } })
ok(mixed['01'] === 0.1 && mixed['02'] === 0,
  'B 🔴 混合（1月10%、2月留空）→ 2月是 0，不继承 1月', JSON.stringify(mixed))

ok(P({ '01': { amtWan: 10, ratePct: 0 } })['01'] === 0,
  'C 显式填 0 → 0（v360 原场景不变）')
ok(P({ '01': { amtWan: 10, ratePct: 10 } })['01'] === 0.1,
  'D 非空 10% → 0.1（原有场景不变）')
ok(!('02' in P({ '01': { amtWan: 10 }, '02': {} })),
  'E 无目标金额的月份不落键（不制造 12 个 0）')
ok(P({ '01': { amtWan: 10, ratePct: '' } })['01'] === 0,
  'F 用户清空输入框（""）与初始 null 同形状，都落 0')
ok(P({ '01': { amtWan: 10, ratePct: 8.5 } })['01'] === 0.085,
  'G 小数费率 8.5% → 0.085（换算不变）')

/* ③ 副本 + 坏样本自证 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rebate-rate-'))
function mutate(tag, key, from, to) {
  const dst = path.join(tmp, tag)
  fs.mkdirSync(dst, { recursive: true })
  const map = {}
  for (const [k, src] of Object.entries(FILES)) {
    const t = path.join(dst, k)
    fs.copyFileSync(src, t)
    map[k] = t
  }
  const p = map[key]
  const s = fs.readFileSync(p, 'utf8')
  if (!s.includes(from)) {
    ok(false, `${tag}：锚点未命中（源码已改，需更新样本）`)
    return null
  }
  fs.writeFileSync(p, s.replace(from, to))
  return readAll(map)
}
try {
  const ctrl = mutate('ctrl', 'form', '请至少填写', '请至少填写')   // 原样对照
  ok(ctrl && audit(ctrl).length === 0, '对照组（原样复制）全绿（证明不是「见红就对」）')

  const samples = [
    ['m1', 'payload',
      'if (hasAmt && rateBlank) monthlyRates[r.mm] = 0',
      'if (false) monthlyRates[r.mm] = 0',
      '删掉落 0 ⇒ 空月被后端向前继承，凭空多算返利'],
    ['m2', 'form',
      "toast('请填写规则名称', 'error'); return",
      "toast('请至少填写一个月的返利率', 'error'); return\n  if (!Object.keys(monthly.monthlyRates).length) { toast('请至少填写一个月的返利率', 'error'); return }",
      '硬拦换个位置回来（留空又存不了）'],
    ['m3', 'py',
      'if _brand_monthly and _rr_blank:',
      'if True:',
      '后端把空值放宽成「所有输入都放行」（abc / 负数一起漏）'],
    ['m4', 'py',
      'elif not _is_num_like(_rr_raw):',
      'elif False:',
      '后端删掉非数字判据'],
    ['m5', 'form',
      "toast('请填写规则名称', 'error'); return",
      "toast('请填写规则名称', 'error'); return\n  if (!Object.keys(monthly.monthlyRates).length) { toast('返利率没填', 'error'); return }",
      '硬拦换个文案回来（只留「变体判据」能抓，证明它不是空白支票）'],
    ['m6', 'py',
      'for d in range(1, 13):',
      'for d in range(0, 0):',
      '核心计算被顺手改掉（落 0 方案的前提被破坏）'],
  ]
  for (const [tag, key, from, to, desc] of samples) {
    const src = mutate(tag, key, from, to)
    if (!src) continue
    const errs = audit(src)
    ok(errs.length > 0, `${tag} 已检出：${desc}`, errs.length ? '→ ' + errs[0] : '')
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(failed === 0 ? '\n✅ v769 契约 ALL PASS' : `\n❌ v769 契约 FAILED (${failed})`)
process.exit(failed === 0 ? 0 : 1)
