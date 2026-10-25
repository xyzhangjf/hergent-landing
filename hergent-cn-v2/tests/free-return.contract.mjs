/**
 * v684 自由退货 + 「商品不在该伙伴历史记录里」提醒契约（⑲）
 * ===========================================================================
 * 老板原话（2026-10-25）：
 *   「采购退货页不再以『按原单退货』作为主入口，改为默认支持用户自由退货。当用户选择的
 *    产品不在该供应商的采购记录中时，系统仅给出提醒，但仍允许其继续完成退货。自提退单和
 *    车销退单需采用相同的自由退货逻辑与提醒机制，确保各渠道退货流程一致。」
 *
 * 这三句话拆成三条**可机械判定**的约束，本组逐条钉住：
 *   ① 「仅提醒、仍允许继续」⇒ 提醒用的状态**不得**出现在任何 validate / disabled 里。
 *      这是本组最重要的一条：一旦有人"顺手"在 validate 里加一句 `if (histCount) return`，
 *      老板的功能就变成了拦截，而界面上**看不出区别**（提示条照旧显示）。
 *   ② 「默认自由退货」⇒ 列表行「退货」不得再带 `?from_po=`（那是挂原单通道）。
 *      ⚠️ 挂原单通道**没有删**：它在采购单详情页「转单为 → 采购退货」，是唯一带
 *      服务端可退上限的护栏（同一批货防超退）。只是不再是主入口。
 *   ③ 「各渠道一致」⇒ 采购退货与销售退单必须共用同一个前端模块
 *      （`partnerHistory.js`）与同一个后端实现（`partner_history.py`），不许各写一份。
 *
 * 同类功能的死法（本项目真实发生过，见 MEMORY 的⑰⑱两组）：
 *   · 两个页面各写一份 SQL ⇒ 「什么算历史」分岔且零报错；
 *   · 接口失败当成"全都没有历史" ⇒ 每一行挂假警告，比不提醒更糟；
 *   · 把「没选供应商」当成"全都没有历史" ⇒ 刚打开页面就一片警告；
 *   · 提醒条写成行内第二行 ⇒ 数据行高 29.8 → 40+（契约 ⑰ 的判据）。
 *
 * 静态扫描纪律：断言前先剥 HTML 注释；一律用 Node 正则，不用 shell（`grep "A\|B"` 会静默失效）。
 * 后端 `partner_history.py` 不在 git ⇒ 契约钉的是 `tests/perf/v684/` 的归档快照。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const SRC = path.join(ROOT, 'src')
const NEW = path.join(SRC, 'pages/inventory/new')
const SNAP = path.join(ROOT, 'tests/perf/v684/partner_history.py')

let pass = 0
let failed = 0
function ok (cond, label, extra) {
  if (cond) { pass++; console.log('     ✅ ' + label) }
  else { failed++; console.log('     ❌ ' + label + (extra ? '  → ' + extra : '')) }
}
/** 剥 HTML 注释（等长替换保行号） */
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
const read = (p) => stripComments(fs.readFileSync(p, 'utf8'))

/* ── 判别力自证框架（与⑱同族）：每条关键断言给真实样本 + 已知坏样本 ── */
function prove (name, detector, goodSample, badSamples) {
  ok(detector(goodSample), `【自证】${name}：真实样本应判过`)
  const missed = []
  for (const [label, bad] of badSamples) if (detector(bad)) missed.push(label)
  ok(missed.length === 0,
    `【自证】${name}：已知坏样本必须判红${missed.length ? '（漏抓: ' + missed.join(',') + '）' : ''}`)
}

/** 取 JS/Python 函数体（`function name` / `def name`，先配平参数括号再找函数体大括号）。
 *  🔴 不能"找到名字后第一个 `{` 就当函数体开头"：默认参数 `opts = {}` 会先命中，
 *     函数体只剩 `{}` ⇒ 坏样本全部漏抓（v683 当场抓出过这个缺陷）。 */
function fnBody (src, name) {
  let start = src.indexOf('function ' + name)
  if (start < 0) start = src.indexOf('def ' + name)
  if (start < 0) return ''
  const open = src.indexOf('(', start)
  if (open < 0) return ''
  let depth = 0
  let j = open
  for (; j < src.length; j++) {
    if (src[j] === '(') depth++
    else if (src[j] === ')') { depth--; if (!depth) break }
  }
  // Python：参数括号后是 `:` 再接换行，函数体靠缩进；这里退化为"取到下一个顶层 def/EOF"
  if (src.slice(start, start + 3) === 'def') return src.slice(j + 1)
  const brace = src.indexOf('{', j)
  if (brace < 0) return ''
  depth = 0
  for (let k = brace; k < src.length; k++) {
    if (src[k] === '{') depth++
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(brace, k + 1) }
  }
  return src.slice(brace)
}

const HIST_TOKENS = ['histMissing', 'histCount', 'isHistMissing', 'histWarn', 'histNote']

/* ================================================================
   【1】后端唯一实现：谁算「有历史」，只准有一份定义
   ================================================================ */
console.log('\n【1】后端唯一实现 partner_history.py（快照 · 状态口径 · 未选伙伴不误报）')
{
  ok(fs.existsSync(SNAP), 'tests/perf/v684/partner_history.py 快照存在')
  const s = fs.existsSync(SNAP) ? fs.readFileSync(SNAP, 'utf8') : ''
  ok(/def missing_products\s*\(/.test(s), '导出 missing_products()')
  ok(/_SQL\s*=\s*\{[\s\S]*purchase[\s\S]*sale/.test(s), 'purchase / sale 两类各一条 SQL（不共用）')
  ok(/supplier_id\s*=\s*\?/.test(s), '采购侧按 supplier_id 过滤（不是按商品名/编号猜）')
  ok(/customer_id\s*=\s*\?/.test(s), '销售侧按 customer_id 过滤')
  ok(/_BATCH\s*=\s*\d+/.test(s), 'IN 查询分批（SQLite 变量上限保护）')

  /* 状态口径：草稿与作废不算「有历史」——把 draft 算进去会让"只建过草稿没真进货"
     的商品被当成有采购记录，提醒就变成假阴性。 */
  const detStatus = (src) => {
    const m = src.match(/_SKIP_STATUS\s*=\s*\(([^)]*)\)/)
    if (!m) return false
    return /['"]draft['"]/.test(m[1]) && /['"]cancelled['"]/.test(m[1])
  }
  prove('草稿/作废不计入历史', detStatus, s, [
    ['把 draft 当成有采购记录', '_SKIP_STATUS = ("cancelled", "void")'],
    ['状态口径整条缺失', '_SKIP_STATUS = ()'],
    ['干脆不排除任何状态', 'SELECT 1'],
  ])

  /* 没选伙伴/没商品 ⇒ skipped，missing 必须为空。
     写成"全部 missing"的后果：用户刚打开退货页，商品还没选、供应商还没选，
     界面就已经一片"没有历史"——比不提醒更糟。 */
  const detNoPartner = (src) => {
    const b = fnBody(src, 'missing_products')
    return /pid\s*<=\s*0/.test(b) && /skipped/.test(b) && /["']missing["']\s*:\s*\[\]/.test(b)
  }
  prove('未选伙伴/无商品 ⇒ skipped 且 missing 为空', detNoPartner, s, [
    ['未选伙伴判成"全部缺失"', `def missing_products(kind, partner_id, product_ids):
    out = {"missing": list(product_ids)}
    return out`],
    ['未选伙伴也去查库', `def missing_products(kind, partner_id, product_ids):
    pids = list(product_ids)
    return {"missing": []}`],
  ])
}

/* ================================================================
   【2】前端共享模块：三个渠道共用一个检查器
   ================================================================ */
console.log('\n【2】共享提醒模块 partnerHistory.js（唯一前端入口 · 失败不当"没历史"）')
{
  const P = path.join(NEW, 'partnerHistory.js')
  ok(fs.existsSync(P), 'src/pages/inventory/new/partnerHistory.js 存在')
  const s = fs.existsSync(P) ? read(P) : ''
  for (const fn of ['createHistoryChecker', 'historyWarnText']) {
    ok(new RegExp('export function ' + fn).test(s), `导出 ${fn}()`)
  }
  ok(/export const HISTORY_NOTE/.test(s), '导出 HISTORY_NOTE（失败/空态统一文案）')

  /* 核心：接口失败**不能**当成"全都没有历史"。
     判据：.catch 分支里不得再碰响应体（raw/missing），且必须显式标 failed。 */
  const detCatch = (src) => {
    const b = fnBody(src, 'createHistoryChecker')
    const i = b.indexOf('.catch(')
    if (i < 0) return false
    const tail = b.slice(i)
    return !/\braw\b/.test(tail) && /failed:\s*true/.test(tail)
  }
  prove('接口失败不冒充「全都没有历史」', detCatch, s, [
    ['catch 里把空数组当结果', `export function createHistoryChecker (f, cb) {
  return { check () { f().catch(() => { cb(new Set(), { checked: 0 }) }) } }
}`],
    ['catch 里仍读响应体', `export function createHistoryChecker (f, cb) {
  return { check () { f().catch((e) => { cb(new Set([...raw.missing]), {}) }) } }
}`],
  ])

  /* 没选伙伴 ⇒ 直接 skipped 返回，不打接口、不标行。
     漏了这一条的表现是"刚进页面每行都挂⚠"（partnerId=0 被当成"全部缺失"）。 */
  const detZero = (src) => {
    const b = fnBody(src, 'createHistoryChecker')
    return /!\(Number\(partnerId\)\s*>\s*0\)/.test(b) && /skipped:\s*true/.test(b)
  }
  prove('没选供应商/客户 ⇒ 不打接口、不标行', detZero, s, [
    ['partnerId=0 也去打接口', `export function createHistoryChecker (f, cb) {
  function run (kind, partnerId, ids) { f(kind, partnerId, ids) }
  return { check: run }
}`],
  ])

  ok(/仍可继续退货/.test(s) && /仍可继续退单/.test(s),
    '文案明确写「仍可继续…」（话术上就不是拦截）')
  /* 结构上的「不拦截」比文案更硬：模块不得产出任何"能不能提交"的信号。
     一旦有人加了 `blocked` / `disabled` 字段，页面迟早会去消费它。
     🔴 必须先剥 JS 注释：本模块的注释里**明写着**"别在这里加 blocked"，
        不剥就会把"禁止做某事"的声明当成"做了某事"（这是本仓反复踩的假红）。 */
  const code = s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
  ok(!/\bblocked\b/i.test(code), '检查器不返回 blocked 之类的"能否提交"信号')
  ok(!/\bdisabled\b/i.test(code), '模块不产出 disabled 语义')
}

/* ================================================================
   【3】只提醒不拦截 —— 本组最重要的一条
   ================================================================ */
console.log('\n【3】提醒不得进入校验：validate / disabled 里不许出现 hist* 标识')
{
  const cases = [
    ['采购退货单', path.join(NEW, 'PurchaseReturnForm.vue'), 'validateStandalone'],
    ['销售退单（自提/车销）', path.join(NEW, 'SaleDocForm.vue'), 'validate'],
  ]
  for (const [label, file, fn] of cases) {
    const s = read(file)
    const b = fnBody(s, fn)
    ok(b.length > 50, `${label}：找到 ${fn}() 函数体`, b.length)
    const hits = HIST_TOKENS.filter((t) => b.includes(t))
    ok(hits.length === 0,
      `${label}：${fn}() 里不含任何提醒标识（= 不拦截）`,
      hits.join(','))
    /* 坏样本自证：往函数体塞一句 histCount 必须判红 */
    const bad = s.replace(b, b.replace('{', '{ if (histCount.value) return "有商品没有历史记录" '))
    const det = (src) => HIST_TOKENS.every((t) => !fnBody(src, fn).includes(t))
    prove(`${label}：把提醒塞进校验要能抓红`, det, s, [[`${fn} 里加了 histCount 判断`, bad]])
  }

  /* disabled 绑定里也不能出现提醒标识（否则按钮会被禁用 = 另一种拦截） */
  for (const [label, file] of [['采购退货单', path.join(NEW, 'PurchaseReturnForm.vue')],
    ['销售退单', path.join(NEW, 'SaleDocForm.vue')]]) {
    const s = read(file)
    const dis = (s.match(/:disabled="[^"]*"/g) || []).join(' ')
    ok(!/hist/i.test(dis), `${label}：没有任何 :disabled 绑到提醒状态`, dis.slice(0, 80))
  }
}

/* ================================================================
   【4】三个退货渠道都接上了同一个检查器
   ================================================================ */
console.log('\n【4】采购退货 + 自提退单 + 车销退单共用同一套提醒')
{
  const pr = read(path.join(NEW, 'PurchaseReturnForm.vue'))
  ok(/from '\.\/partnerHistory\.js'/.test(pr), '采购退货单 import partnerHistory.js')
  ok(/createHistoryChecker\(psiApi\.partnerProductHistory/.test(pr), '采购退货单用共享检查器')
  ok(/history\.check\('purchase'/.test(pr), "采购退货单 kind='purchase'")
  ok(/ipn-hist-warn/.test(pr), '采购退货单有提醒条')
  ok(/isHistMissing\(row\)/.test(pr), '采购退货单有行内角标')

  const sd = read(path.join(NEW, 'SaleDocForm.vue'))
  ok(/from '\.\/partnerHistory\.js'/.test(sd), '销售退单 import partnerHistory.js（自提/车销共用本页）')
  ok(/createHistoryChecker\(psiApi\.partnerProductHistory/.test(sd), '销售退单用共享检查器')
  ok(/history\.check\('sale'/.test(sd), "销售退单 kind='sale'")
  ok(/isn-hist-warn/.test(sd), '销售退单有提醒条')
  ok(/isHistMissing\(row\)/.test(sd), '销售退单有行内角标')

  /* 销售单（正向开单）不该挂这个提醒 —— 正向单没有"历史买过没"这回事，
     挂了就是纯噪音。判据：isHistMissing 里必须有 isReturn 闸门。 */
  const detOnlyReturn = (src) => /cfg\.value\.isReturn/.test(fnBody(src, 'isHistMissing'))
  prove('提醒只在退单模式生效（正向销售单不挂）', detOnlyReturn, sd, [
    ['正向单也标"客户没买过"', `function isHistMissing (row) {
  return Number(row.product_id) > 0 && histMissing.value.has(Number(row.product_id))
}`],
  ])
}

/* ================================================================
   【5】主入口改自由退货（列表行不再挂原单）
   ================================================================ */
console.log('\n【5】采购列表「退货」主入口 = 自由退货（不再 ?from_po=）')
{
  const P = path.join(SRC, 'pages/inventory/InvPurchaseList.vue')
  const s = read(P)
  const b = fnBody(s, 'goReturn')
  ok(b.length > 20, '找到 goReturn() 函数体', b.length)
  const det = (src) => {
    const body = fnBody(src, 'goReturn')
    return body.includes('supplier_id') && !body.includes('from_po')
  }
  prove('退货入口带供应商、不带原单', det, s, [
    ['退回按原单退货', "function goReturn (r) { router.push(legacyPurchasePath('return') + '?from_po=' + r.id) }"],
    ['只跳空白页不带供应商', "function goReturn (r) { router.push(legacyPurchasePath('return')) }"],
  ])
  ok(!/function canReturnFrom/.test(s),
    '不再按原单状态过滤退货入口（`canReturnFrom` 已删，不留死代码）')
  /* 挂原单通道必须还在（详情页「转单为」用它，是唯一的服务端可退上限护栏） */
  const list = s + read(path.join(SRC, 'router/index.js'))
  ok(/from_po/.test(read(path.join(SRC, 'router/index.js'))),
    '`?from_po=` 通道仍被路由透传（挂原单入口保留在采购单详情页）')
}

/* ================================================================
   【6】布局护栏：角标不占行高
   ================================================================ */
console.log('\n【6】提示不占行高（角标绝对定位 · 商品列补定位上下文）')
{
  for (const [label, file, dot, prod] of [
    ['采购退货单', path.join(NEW, 'PurchaseReturnForm.vue'), '.ipn-hist-dot', '.ipn-c-prod'],
    ['销售退单', path.join(NEW, 'SaleDocForm.vue'), '.isn-hist-dot', '.isn-c-prod'],
  ]) {
    const s = read(file)
    const rule = (s.match(new RegExp('\\' + dot + '\\s*\\{[^}]*\\}')) || [''])[0]
    ok(/position:\s*absolute/.test(rule), `${label}：${dot} 绝对定位（不占行高、不挤列宽）`, rule)
    const prodRule = (s.match(new RegExp('\\' + prod + '\\s*\\{[^}]*\\}')) || [''])[0]
    ok(/position:\s*relative/.test(prodRule), `${label}：${prod} 是定位上下文`, prodRule)
  }
}

/* ================================================================ */
console.log('\n' + '-'.repeat(66))
console.log(`  ${failed === 0 ? '✅ 全部通过' : '❌ 失败 ' + failed + ' 条'}   （通过 ${pass} 条）`)
process.exit(failed === 0 ? 0 : 1)
