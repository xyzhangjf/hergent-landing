/**
 * v683 开单单位可选 + 单位×价格联动契约（⑱）
 * ===========================================================================
 * 为什么需要这一组：
 *   老板原话：「各类单据开单时的商品单位需支持手动选择，替代当前写死的"箱"」，
 *   并要「优先带出该单位的上次开单价格；首次开单取档案价」。
 *
 *   改造前的真实状况（四页各一套口径，谁也不知道别人怎么算）：
 *     · 采购订货单：三档下拉，但换档时「价×k、量÷k」一起换算（v455 口径）；
 *     · 采购退货单：要勾「按小单位」才放开，否则写死基础单位；
 *     · 销售单 / 调拨单：单位是只读文字，压根选不了；
 *     · 商品档案的 `default_*_unit` 有控件能存，但**全仓零读取**（生产非空 0 条）；
 *     · 销售/退货/调拨三张明细表 DDL 里**没有 unit 列**。
 *
 *   这类约定最典型的死法（每一条都在本项目真实发生过）：
 *   ① 前端自己乘 ratio 带价 ⇒ 把「元/小单位」的档案价当「元/大单位」，
 *      采购页 v409 起 7.22 元/板 被算成 0.72 元/板（差 10 倍，330 个商品受影响）；
 *   ② 换档顺手把数量也除了 ⇒ 老板拍板的是「数量不动、金额跟着变」，改回去就是第二份口径；
 *   ③ 切客户/供应商忘了清定价缓存 ⇒ 把上一个客户的成交价带过来，**界面看起来完全正常**；
 *   ④ 下拉能选但不提交 `unit` ⇒ 后端按老口径折小单位，用户选了「箱」却只扣 1 瓶（静默失效）；
 *   ⑤ 老单没有 `unit` 列值 ⇒ 回显空白；靠 `unit_label` 回退链兜住，删了它就一片「—」。
 *   ⇒ 必须静态钉住，且每条关键断言都带「已知坏样本」自证判别力（注回缺陷要能抓红）。
 *
 * 静态扫描纪律（踩过）：
 *   · 断言前先剥 HTML 注释（注释里写着"不要 v-model"会被当成违规命中）。
 *   · 本机 shell 的 `grep "A\|B"` 会静默失效 ⇒ 一律用 Node 正则，不用 shell。
 *   · 后端 `product_pricing.py` 不在 git ⇒ 契约钉的是 `tests/perf/v683/` 下的
 *     **归档快照**（md5 记录在 v683-e2e.py 同目录）。快照与生产漂移时本组会先红。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const SRC = path.join(ROOT, 'src')
const NEW = path.join(SRC, 'pages/inventory/new')
const SNAP = path.join(ROOT, 'tests/perf/v683/product_pricing.py')

let pass = 0
let failed = 0
function ok (cond, label, extra) {
  if (cond) { pass++; console.log('     ✅ ' + label) }
  else { failed++; console.log('     ❌ ' + label + (extra ? '  → ' + extra : '')) }
}
/** 剥掉 HTML 注释与 JS 块注释（等长替换保行号）*/
const stripComments = (s) =>
  s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
const read = (p) => stripComments(fs.readFileSync(p, 'utf8'))

/* ── 判别力自证框架 ───────────────────────────────────────────────
   每条关键断言 = 一个 detector(source) -> bool。
   对真实文件跑必须 PASS；对"已知坏样本"跑必须 FAIL。
   两者都满足才说明这条断言不是空过（v629 同族教训：注回缺陷要能抓红）。 */
function prove (name, detector, goodSample, badSamples) {
  ok(detector(goodSample), `【自证】${name}：真实样本应判过`)
  const missed = []
  for (const [label, bad] of badSamples) if (detector(bad)) missed.push(label)
  ok(missed.length === 0,
    `【自证】${name}：已知坏样本必须判红${missed.length ? '（漏抓: ' + missed.join(',') + '）' : ''}`)
}

const PAGES = [
  ['采购订货单', 'PurchaseOrderForm.vue'],
  ['采购退货单', 'PurchaseReturnForm.vue'],
  ['销售单/退单', 'SaleDocForm.vue'],
  ['调拨单', 'TransferDocForm.vue'],
]

/* ================================================================
   【1】前端共享定价模块：单位×价格的唯一前端入口
   ================================================================ */
console.log('\n【1】共享定价模块 unitPricing.js（唯一前端入口 · 换档不动数量）')
{
  const P = path.join(NEW, 'unitPricing.js')
  ok(fs.existsSync(P), 'src/pages/inventory/new/unitPricing.js 存在')
  const s = read(P)
  for (const fn of ['applyPricingToRow', 'applyUnitChange', 'unitOptionsOf',
    'findUnitOption', 'priceOfUnit', 'createPricingCache', 'PRICE_SOURCE_LABEL']) {
    ok(new RegExp('export (function|const) ' + fn).test(s), `导出 ${fn}`)
  }

  /* 🔴 换档「数量不动、金额跟着变」（老板拍板），与 v455 的「价×k、量÷k」相反。
     判据：applyUnitChange 函数体里不许出现 quantity 的读写或除法。 */
  /* 🔴 取函数体：不能直接找名字后面的第一个 `{` —— 默认参数 `opts = {}` 里的
     大括号会先被命中，于是"函数体"只剩 `{}`，任何坏样本都判过（这条自证当场抓过）。 */
  const bodyOf = (src, name) => {
    const start = src.indexOf('export function ' + name)
    if (start < 0) return ''
    const open = src.indexOf('(', start)
    if (open < 0) return ''
    let depth = 0
    let j = open
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++
      else if (src[j] === ')') { depth--; if (!depth) break }
    }
    const brace = src.indexOf('{', j)
    if (brace < 0) return ''
    depth = 0
    for (let k = brace; k < src.length; k++) {
      if (src[k] === '{') depth++
      else if (src[k] === '}') { depth--; if (!depth) return src.slice(brace, k + 1) }
    }
    return src.slice(brace)
  }
  const detNoQtyTouch = (src) => {
    const b = bodyOf(src, 'applyUnitChange')
    if (!b) return false
    return !/quantity/.test(b) && !/\bqty\b/.test(b)
  }
  prove('applyUnitChange 不碰数量', detNoQtyTouch, s, [
    ['v455 旧口径 量÷k', `export function applyUnitChange (row, newName, opts = {}) {
      row.quantity = row.quantity / k
      row.unit = newName
    }`],
    ['顺手把数量清零', `export function applyUnitChange (row, newName, opts = {}) {
      row.quantity = ''
      row.unit = newName
    }`],
  ])

  /* 🔴 价格来源必须 5 档可解释（无价时不许瞎猜） */
  const detSources = (src) =>
    /last_owner/.test(src) && /last_legacy/.test(src) && /archive/.test(src) && /'none'|"none"/.test(src)
  prove('价格来源 5 档齐全', detSources, s, [
    ['只剩 archive', `export const PRICE_SOURCE_LABEL = { archive: '档案价', none: '无' }`],
  ])
}

/* ================================================================
   【2】四个建单页：单位必须是「可选下拉」，且有档案配置的下拉来源
   ================================================================ */
console.log('\n【2】四个建单页单位一律可选下拉（不许只读文字）')
for (const [label, file] of PAGES) {
  const s = read(path.join(NEW, file))
  /* 判据：存在一个 <select>，它的 option 来自 unitOptionsOf(row)，
     并且 change 事件落到 onUnitChange(row, ...)（= applyUnitChange 链路）。 */
  const detUnitSelect = (src) =>
    /<select[^>]*[\s\S]{0,600}?<option v-for="o in unitOptionsOf\(row\)"/.test(src) &&
    /@change="onUnitChange\(row/.test(src) &&
    /from '\.\/unitPricing\.js'/.test(src)
  ok(detUnitSelect(s), `${label}：单位下拉（option 源自 unitOptionsOf + @change→onUnitChange + 共享模块）`)

  /* 🔴 判别力自证：只读 <span>{{ row.unit }}</span> 的老实现必须判红 */
  const badReadonly = `<td><span v-if="row.unit" class="isn-unit">{{ row.unit }}</span></td>
    <script setup>import { unitOptionsOf } from './unitPricing.js'</script>`
  ok(!detUnitSelect(badReadonly), `${label}：【自证】只读文字的老实现必须判红`)

  /* 🔴 单位下拉里不许再用 v-model（v-model 在 change 派发前改掉 row.unit，
     事件里拿不到"从哪档到哪档"）。采购页有编辑态特例，但必须 force 重算。 */
  const seg = (s.match(/<select[^>]*isn?-unit-sel[\s\S]{0,400}?>/) || [''])[0] ||
    (s.match(/<select[^>]*ipn-unit-sel[\s\S]{0,400}?>/) || [''])[0]
  if (seg) {
    ok(!/v-model="row\.unit"/.test(seg) || /force/.test(s),
      `${label}：单位下拉不用 v-model 直接绑（或已用 force 重算，摆脱事件顺序依赖）`)
  }
}

/* ================================================================
   【3】提交体必须带 unit，否则后端按老口径折小单位（选了箱却只扣 1 瓶）
   ================================================================ */
console.log('\n【3】提交体逐行带 unit（漏带 = 用户选了「箱」只扣 1 瓶，静默失效）')
{
  const detPostsUnit = (src) => /unit:\s*[A-Za-z_$][\w$]*\.unit\s*\|\|\s*''/.test(src)
  for (const [label, file] of PAGES) {
    const s = read(path.join(NEW, file))
    prove(`${label} 提交 unit`, detPostsUnit, s, [
      ['漏带 unit（老实现）', `items: rows.map(x => ({ product_id: x.product_id, quantity: Number(x.quantity), unit_price: Number(x.unit_price) }))`],
    ])
  }
}

/* ================================================================
   【4】切客户/供应商必须清定价缓存
   ================================================================ */
console.log('\n【4】切客户/供应商必须清定价缓存（否则把上个客户的价带过来，界面看着完全正常）')
{
  const detClear = (src) =>
    /watch\(\(\) => form\.value\.(customer_id|supplier_id)[\s\S]{0,300}?pricingCache\.clear\(\)/.test(src)
  prove('销售页切客户清缓存', detClear, read(path.join(NEW, 'SaleDocForm.vue')), [
    ['只重算余额不清缓存', `watch(() => form.value.customer_id, (v) => { loadBalance(v) })`],
    ['清了别的缓存', `watch(() => form.value.customer_id, (v) => { stockCache.clear() })`],
  ])
  prove('采购页切供应商清缓存', detClear, read(path.join(NEW, 'PurchaseOrderForm.vue')), [
    ['只算余额', `watch(() => form.value.supplier_id, (v) => { loadSupplierBalance(v) })`],
  ])
  /* 销售页换退/销类型也必须清（sale ⇄ sale_return 是两个价格口径） */
  ok(/watch\(pricingKind[\s\S]{0,80}?pricingCache\.clear\(\)/.test(read(path.join(NEW, 'SaleDocForm.vue'))),
    '销售页换单据类型（sale ⇄ sale_return）也清缓存')
}

/* ================================================================
   【5】采购页档案价必须读「当前档位价」——不许把 purchase_price 当大单位价
   ================================================================ */
console.log('\n【5】采购页档案价按档取（v409 的 10 倍错价不许回来）')
{
  const s = read(path.join(NEW, 'PurchaseOrderForm.vue'))
  const detRefPrice = (src) => {
    const i = src.indexOf('function refPriceOf')
    if (i < 0) return false
    const b = src.slice(i, i + 400)
    return /findUnitOption\(row, row\.unit\)/.test(b) && /\.price/.test(b)
  }
  prove('refPriceOf 读当前档价', detRefPrice, s, [
    ['直接把档案价当大单位价（v409 错价）', `function refPriceOf (row) {
      const p = products.value.find(x => Number(x.id) === Number(row.product_id)) || {}
      return Number(p.purchase_price) || 0
    }`],
    ['拿第一个档位的价', `function refPriceOf (row) {
      return Number(unitOptionsOf(row)[0].price) || 0
    }`],
  ])
  /* 全页不许再出现"自己乘 ratio 算价" */
  ok(!/unit_price\s*=\s*[^;\n]*\*\s*(Number\()?(row\.)?(ratio|r\b)/.test(s),
    '采购页无「自己乘 ratio 算价」')
}

/* ================================================================
   【6】后端唯一实现快照：档案价 × ratio、只采购回大包装
   ================================================================ */
console.log('\n【6】后端唯一实现快照（tests/perf/v683/product_pricing.py）')
{
  ok(fs.existsSync(SNAP), '归档快照存在（后端不在 git，快照即契约对象）')
  const s = fs.readFileSync(SNAP, 'utf8')

  const detRatioMul = (src) => /_round4\(archive \* ratio\)/.test(src)
  prove('档案价按档折算 = archive × ratio', detRatioMul, s, [
    ['v409 10 倍错价（不乘 ratio）', 'price, src = _round4(archive), "archive"'],
    ['错乘成除法', 'price, src = _round4(archive / ratio), "archive"'],
  ])

  const detFallback = (src) =>
    /_FALLBACK_LARGE\s*=\s*\{\s*"purchase"\s*:\s*True\s*\}/.test(src)
  prove('只有采购回退到大包装', detFallback, s, [
    ['销售也回退大包装（全站变箱）', '_FALLBACK_LARGE = {"purchase": True, "sale": True}'],
    ['谁都不回退（采购默认变小单位）', '_FALLBACK_LARGE = {}'],
  ])

  ok(/def resolve_pricing\(/.test(s) && /def default_unit_of\(/.test(s) && /def price_of_unit\(/.test(s),
    '三个入口齐（resolve_pricing / default_unit_of / price_of_unit）')
  ok(/default_purchase_unit/.test(s) && /order_unit/.test(s),
    '默认档优先读档案 default_*_unit，其次 order_unit')
}

/* ================================================================
   【7】详情回显：unit_label 回退链 + 折小量
   ================================================================ */
console.log('\n【7】单据详情回显（老单无 unit 值也要显示得出来）')
{
  const s = read(path.join(SRC, 'pages/inventory/InvSaleDetail.vue'))
  const detLabel = (src) => /it\.unit_label\s*\|\|\s*it\.unit/.test(src)
  prove('单位列走 unit_label 回退链', detLabel, s, [
    ['直接用 it.unit（老单一片空白）', '<td>{{ it.unit }}</td>'],
  ])
  ok(/it\.base_qty/.test(s) && /it\.base_unit/.test(s), '显示折小单位量（= 48 瓶）')
}

/* ================================================================
   【8】商品档案「默认开单单位」
   ================================================================ */
console.log('\n【8】商品档案「默认开单单位」（配置项真的被读，界面上说清作用）')
{
  const s = read(path.join(SRC, 'pages/ProductArchive.vue'))
  ok(/默认开单单位/.test(s), '字段名已改为「默认开单单位」（不是含混的「默认单位」）')
  for (const k of ['default_sale_unit', 'default_purchase_unit', 'default_gift_unit']) {
    ok(new RegExp('editForm\\.' + k).test(s), `${k} 有可编辑控件`)
  }
  const detStale = (src) => /const staleUnitWarning\s*=\s*computed/.test(src) && /pa-warn/.test(src)
  prove('配了已不存在的单位要告警', detStale, s, [
    ['没有失效单位告警（静默空白）', 'const unitOptions = computed(() => [])'],
  ])
}

/* ================================================================ */
console.log('\n' + '-'.repeat(66))
console.log(`  ${failed === 0 ? '✅ 全部通过' : '❌ 失败 ' + failed + ' 条'}   （通过 ${pass} 条）`)
process.exit(failed === 0 ? 0 : 1)
