/**
 * v680 契约：六个建单页（采购退货 / 自提订单 / 自提退单 / 车销订单 / 车销退单 / 调拨单）
 * 的商品行**行高与 UI 规范**必须与基准页「采购订货单」一致。
 *
 * 现象（老板反馈 + 生产真机实测 v680）：
 *   基准页「采购订货单」数据行高 **29.8px**（紧凑档），而**六页全部是 56.6px**（≈ 翻倍）。
 *   根因不是字号/行距/控件高，而是**操作列的固定宽写小了**：
 *   行内两个 26×26 图标按钮 + 4px 间距 = **56px 净宽**，加 td 左右各 8px 内距 ⇒ 列宽须 ≥ 72px；
 *   v449 拆页时新页把操作列写成 `width: 64px`（净宽只剩 48px）⇒ 按钮**换行成两行**
 *   ⇒ 行高 26+26+4+2 = **56.6px**。基准页此前不限宽、按内容自适应，所以一直是单行。
 *   🔴 这跟 v447 踩过的坑是同一族：行高由**行内最高控件**决定，而「删行按钮」是行高决定者。
 *
 * 本契约钉死（每条都配「已知坏样本」判别力自证）：
 *   A 操作列宽 ≥ 72px 且 nowrap（四页一致，76px）
 *   B sticky 操作列必须有底色 + 左侧分割线（否则横向滚动时透底）
 *   C 换算小字必须是**绝对定位浮层**，不得占行高
 *   D 同名同义列的列宽地板值四页一致
 *   E 表格内距与行内控件高度四页一致（防连带回归）
 *   F 共享件 ProductCombo 的文本态高度对齐 §R.2（18px / 紧凑 16px）
 *
 * 只读源码，不连网、不跑浏览器。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NEW = join(ROOT, 'src/pages/inventory/new')

/** 四个承载组件：基准 + 三个被统一的（六个入口落在后三个里） */
const COMPONENTS = {
  base: { file: 'PurchaseOrderForm.vue', p: 'ipn', label: '采购订货单(基准)' },
  ret: { file: 'PurchaseReturnForm.vue', p: 'ipn', label: '采购退货单' },
  sale: { file: 'SaleDocForm.vue', p: 'isn', label: '自提/车销(订单+退单)' },
  trf: { file: 'TransferDocForm.vue', p: 'isn', label: '调拨单' },
}

let pass = 0, fail = 0
const errors = []
function ok (name, cond, detail = '') {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; errors.push(name + (detail ? ' :: ' + detail : '')); console.log('  ❌ ' + name + (detail ? ' :: ' + detail : '')) }
}

/** 读文件的 <style scoped> 块 */
function styleBlock (file) {
  const src = readFileSync(join(NEW, file), 'utf8')
  const i = src.indexOf('<style scoped>')
  if (i < 0) return ''
  const j = src.indexOf('</style>', i)
  return src.slice(i + '<style scoped>'.length, j)
}

/** 极简 CSS 规则解析：抽出 [选择器, 声明体] */
function rules (css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  let depth = 0, buf = ''
  for (const ch of clean) {
    buf += ch
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const k = buf.indexOf('{')
        if (k > 0) out.push([buf.slice(0, k).trim().replace(/\s+/g, ' '), buf.slice(k + 1, -1).trim().replace(/\s+/g, ' ')])
        buf = ''
      }
    }
  }
  return out
}

/**
 * 找「提到 selector 且**声明了 prop**」的那条规则的声明体。
 * 🔴 为什么必须带 prop 过滤：同一个类名常出现在多条规则里
 *    （例：`.ipn-c-qty` 既在 `.ipn-c-unit, .ipn-c-price, .ipn-c-qty{position:relative}`
 *    又在 `.ipn-c-price, .ipn-c-qty{width:86px}`）——
 *    只按选择器取第一条会拿到**不含该属性**的那条 ⇒ 假阴性。
 * 找不到返回 null。
 */
function declOf (css, selector, prop) {
  for (const [sel, body] of rules(css)) {
    const parts = sel.split(',').map((s) => s.trim())
    if (!parts.includes(selector)) continue
    if (prop && !new RegExp('(?:^|;|\\s)' + prop + '\\s*:').test(body)) continue
    return body
  }
  return null
}
function num (body, prop) {
  if (!body) return null
  const m = new RegExp('(?:^|;|\\s)' + prop + '\\s*:\\s*([0-9.]+)px').exec(body)
  return m ? parseFloat(m[1]) : null
}
function has (body, needle) {
  return !!body && body.includes(needle)
}
/**
 * 找「选择器**以 suffix 结尾**且声明了 prop」的规则。
 * 🔴 为什么需要它：sticky 操作列的选择器在两套文件里写法不同 ——
 *    基准/退货页是 `.ipn-tbl td.ipn-c-op`（**没有** `table.` 前缀），
 *    销售/调拨页是 `table.isn-tbl td.isn-c-op`（有前缀）——
 *    按整串精确匹配会两边都找不到（假阴性）。按**后缀**匹配才与前缀写法无关。
 */
function declEnding (css, suffix, prop) {
  for (const [sel, body] of rules(css)) {
    const parts = sel.split(',').map((s) => s.trim())
    if (!parts.some((x) => x.endsWith(suffix))) continue
    if (prop && !new RegExp('(?:^|;|\\s)' + prop + '\\s*:').test(body)) continue
    return body
  }
  return null
}

const css = {}
for (const [k, c] of Object.entries(COMPONENTS)) css[k] = styleBlock(c.file)

/* ═══════════════ 判别力自证框架 ═══════════════
   每条检测器都必须：真样本判「过」+ 已知坏样本判「红」。
   假阴性（检测器恒过）比假红危险得多 —— 检测器自己先证伪。 */
let provePass = 0, proveFail = 0
function prove (name, detector, good, bad) {
  const g = detector(good)
  const b = detector(bad)
  if (g === true && b === false) { provePass++; console.log('  🔎 自证通过: ' + name) }
  else { proveFail++; errors.push('判别力自证失败: ' + name + ' good=' + g + ' bad=' + b); console.log('  ❌ 判别力自证失败: ' + name + ' good=' + g + ' bad=' + b) }
}

console.log('\n══ A. 操作列宽（行高根因）══')
{
  const detWidth = (body) => { const w = num(body, 'width'); return w !== null && w >= 72 }
  prove('操作列宽检测器', detWidth, 'width: 76px; min-width: 76px', 'width: 64px')
  for (const [k, c] of Object.entries(COMPONENTS)) {
    const body = declOf(css[k], '.' + c.p + '-c-op', 'width')
    ok(`[${c.label}] 操作列宽 ≥ 72px`, detWidth(body), `实际: ${body}`)
    ok(`[${c.label}] 操作列宽四页一致 = 76px`, num(body, 'width') === 76, `实际: ${body}`)
  }
}
{
  // sticky 操作列规则：用 td 选择器定位（唯一带 position:sticky 的那条）
  const detNowrap = (body) => has(body, 'white-space: nowrap')
  prove('操作列 nowrap 检测器', detNowrap,
    'position: sticky; background: var(--bg); white-space: nowrap;',
    'position: sticky; background: var(--bg);')
  for (const [k, c] of Object.entries(COMPONENTS)) {
    const body = declEnding(css[k], 'td.' + c.p + '-c-op', 'position')
    ok(`[${c.label}] 操作列禁止换行（nowrap）`, detNowrap(body), `实际: ${body}`)
  }
}
{
  let bad = []
  for (const [k, c] of Object.entries(COMPONENTS)) {
    const body = declOf(css[k], '.' + c.p + '-c-op', 'width')
    if (num(body, 'width') === 64) bad.push(c.label)
  }
  ok('无任何组件把操作列写成 64px', bad.length === 0, bad.join(','))
}

console.log('\n══ B. sticky 操作列配色（底色 + 左侧分割线）══')
{
  const detBg = (body) => has(body, 'background: var(--bg)')
  const detLine = (body) => has(body, 'box-shadow: inset 1px 0 0 var(--border-subtle)')
  prove('操作列底色检测器', detBg, 'background: var(--bg);', 'background: transparent;')
  prove('操作列分割线检测器', detLine, 'box-shadow: inset 1px 0 0 var(--border-subtle);', '')
  for (const [k, c] of Object.entries(COMPONENTS)) {
    const body = declEnding(css[k], 'td.' + c.p + '-c-op', 'position')
    ok(`[${c.label}] sticky 操作列有底色（不透底）`, detBg(body), `实际: ${body}`)
    ok(`[${c.label}] sticky 操作列有左侧分割线`, detLine(body), `实际: ${body}`)
  }
}

console.log('\n══ C. 换算小字必须是不占行高的浮层 ══')
{
  const detFloat = (body) => has(body, 'position: absolute') && has(body, 'display: none')
  prove('换算小字浮层检测器', detFloat,
    'display: none; position: absolute; z-index: 6;',
    'font-size: 11px; color: var(--t3); white-space: nowrap')
  for (const [k, c] of Object.entries(COMPONENTS)) {
    const body = declOf(css[k], '.' + c.p + '-conv', 'position')
    ok(`[${c.label}] 换算小字是绝对定位浮层（不占行高）`, detFloat(body), `实际: ${body}`)
    const rel = declOf(css[k], '.' + c.p + '-c-unit', 'position')
    ok(`[${c.label}] 浮层锚点格 position: relative`, has(rel, 'position: relative'), `实际: ${rel}`)
  }
}

console.log('\n══ D. 同名同义列的列宽地板值四页一致 ══')
{
  const SPEC = { unit: 84, qty: 86, price: 86, amt: 92, stk: 78, prod: 240 }
  const detCol = (body, prop, want) => num(body, prop) === want
  prove('列宽检测器', (b) => detCol(b, 'width', 84), 'width: 84px', 'width: 76px')
  for (const [k, c] of Object.entries(COMPONENTS)) {
    const p = c.p
    ok(`[${c.label}] 单位列 = 84px`, detCol(declOf(css[k], '.' + p + '-c-unit', 'width'), 'width', SPEC.unit))
    ok(`[${c.label}] 商品列 min-width = 240px`, detCol(declOf(css[k], '.' + p + '-c-prod', 'min-width'), 'min-width', SPEC.prod))
    ok(`[${c.label}] 数量列 = 86px`, detCol(declOf(css[k], '.' + p + '-c-qty', 'width'), 'width', SPEC.qty))
    const price = declOf(css[k], '.' + p + '-c-price', 'width')
    if (price) ok(`[${c.label}] 单价列 = 86px`, detCol(price, 'width', SPEC.price))
    const amt = declOf(css[k], '.' + p + '-c-amt', 'width')
    if (amt) ok(`[${c.label}] 金额列 = 92px`, detCol(amt, 'width', SPEC.amt))
    const stk = declOf(css[k], '.' + p + '-c-stk', 'width')
    if (stk) ok(`[${c.label}] 库存列 = 78px`, detCol(stk, 'width', SPEC.stk))
  }
}

console.log('\n══ E. 表格内距与行内控件高度（防连带回归）══')
{
  const detPad = (body, want) => {
    const m = /(?:^|;|\s)padding\s*:\s*([^;]+)/.exec(body || '')
    return !!m && m[1].trim().replace(/\s+/g, ' ') === want
  }
  prove('内距检测器', (b) => detPad(b, '4px 8px'), 'padding: 4px 8px', 'padding: 10px 14px')
  for (const [k, c] of Object.entries(COMPONENTS)) {
    const p = c.p
    ok(`[${c.label}] 表头内距 4px 8px`, detPad(declOf(css[k], 'table.' + p + '-tbl th', 'padding'), '4px 8px'))
    ok(`[${c.label}] 数据格内距 2px 8px`, detPad(declOf(css[k], 'table.' + p + '-tbl td', 'padding'), '2px 8px'))
    ok(`[${c.label}] 紧凑档数据格内距 1px 8px`, detPad(declOf(css[k], '[data-density="compact"] table.' + p + '-tbl td', 'padding'), '1px 8px'))
    const inB = declOf(css[k], '.' + p + '-in', 'height')
    ok(`[${c.label}] 行内控件高 22px`, num(inB, 'height') === 22, `实际: ${inB}`)
    ok(`[${c.label}] 行内控件字号 13px`, has(inB, 'font-size: 13px'), `实际: ${inB}`)
  }
}

console.log('\n══ F. 共享件 ProductCombo 文本态（§R.2 = 18px / 紧凑 16px）══')
{
  const pc = styleBlock('ProductCombo.vue')
  const v = declOf(pc, '.ipn-v', 'min-height')
  const det = (body, want) => num(body, 'min-height') === want
  prove('文本态高度检测器', (b) => det(b, 18), 'min-height: 18px; line-height: 18px', 'min-height: 20px; line-height: 20px')
  ok('ProductCombo 文本态 min-height = 18px', det(v, 18), `实际: ${v}`)
  ok('ProductCombo 文本态 line-height = 18px', num(v, 'line-height') === 18, `实际: ${v}`)
  const vc = declOf(pc, '[data-density="compact"] .ipn-v', 'min-height')
  ok('ProductCombo 紧凑档文本态 = 16px', det(vc, 16), `实际: ${vc}`)
}

console.log('\n════════ 汇总 ════════')
console.log(`断言 ${pass} 通过 / ${fail} 失败；判别力自证 ${provePass} 通过 / ${proveFail} 失败`)
if (errors.length) {
  console.log('\n失败明细：')
  errors.forEach((e) => console.log('  - ' + e))
}
console.log(fail === 0 && proveFail === 0 ? '\nALL_PASS' : '\nFAIL')
process.exit(fail === 0 && proveFail === 0 ? 0 : 1)
