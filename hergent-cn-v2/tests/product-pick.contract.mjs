/**
 * 契约组 ⑳ —— 商品候选「可辨识 + 可用优先」+ refs 拉全量
 * ==========================================================================
 * 为什么要有这一组（v685 老板原话）：
 *   「我刚试了一下新建采购订单页面，商品单位还是不能选择」
 *
 * 真因不是一个 bug，是两条叠在一起、而且**都不报错**：
 *   ① 四建单页 `psiApi.refs(..., 500)`，而后端 `product_list` 是
 *      `ORDER BY id DESC LIMIT ?` ⇒ 生产 1270 个商品里只拿到 **id 最大的 500 条**，
 *      老板要搜的老商品**压根没在列表里**，命中的全是同名的后导入垃圾档案。
 *      同一个 500 还把客户（702 条）也截断了。
 *   ② 候选只显示「名称 + 条码」，同名档案长得一模一样，且垃圾档案排在前面
 *      （生产 800 条「单档无价」档案）⇒ 点错了，单位下拉自然只有一项。
 *
 * 本组钉住三件事，任一条被改回去都要在 CI 里判红：
 *   A. `REF_LIMIT` 存在且足够大，四建单页的 refs 调用都走它（不许再出现小数字）
 *   B. 商品候选必须走 `pickMatches` 唯一实现（不许页面各自抄一份 filter）
 *   C. 候选行必须有档位徽标；单位格 title 必须能解释「为什么只有一项」
 * 另加 D：`pickScore` / `pickBadge` 的行为自证（含**坏样本**：把垃圾档案排第一必须判红）。
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const NEW = path.join(ROOT, 'src/pages/inventory/new')

let pass = 0
let fail = 0
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + label) } else {
    fail++; console.log('  ❌ ' + label + (extra !== undefined ? '  ← ' + JSON.stringify(extra) : ''))
  }
}
const read = (p) => fs.readFileSync(p, 'utf8')
const stripComments = (s) => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const PICK = path.join(NEW, 'productPick.js')
const pickSrc = read(PICK)

/* ── A. refs 必须拉全量 ───────────────────────────────────────────────── */
console.log('\nA. refs 拉全量（截断 = 搜不到商品，且界面无任何报错）')
ok(/export const REF_LIMIT\s*=\s*(\d+)/.test(pickSrc), '导出常量 REF_LIMIT')
const limitVal = Number((pickSrc.match(/export const REF_LIMIT\s*=\s*(\d+)/) || [])[1] || 0)
ok(limitVal >= 2000, `REF_LIMIT ≥ 2000（现 ${limitVal}；生产在售商品 1159、客户 702）`, limitVal)

const PAGES = ['PurchaseOrderForm.vue', 'PurchaseReturnForm.vue', 'SaleDocForm.vue', 'TransferDocForm.vue']
for (const f of PAGES) {
  const s = stripComments(read(path.join(NEW, f)))
  /* 🔴 按**整行**取调用，不要用 `\(([^)]*)\)` —— SaleDocForm 是
     `refs(kinds.join(','), '', REF_LIMIT)`，括号里还有一层 `join(...)`，
     非贪婪到第一个 `)` 就截断，会把正确的调用误判成"写死小数字"。 */
  const lines = s.split('\n').filter((ln) => /psiApi\.refs\(/.test(ln))
  const withProducts = lines.filter((c) => /products/.test(c) || /kinds\.join/.test(c))
  ok(withProducts.length > 0, `${f}：确实调用了 refs（含商品）`, lines.length)
  /* 核心判据：凡是可能带 products 的 refs 调用，limit 必须是 REF_LIMIT */
  const bad = withProducts.filter((c) => !/REF_LIMIT/.test(c))
  ok(bad.length === 0, `${f}：refs 的 limit 用 REF_LIMIT（不许写死小数字）`, bad)
  ok(/import\s*\{[^}]*REF_LIMIT[^}]*\}\s*from\s*'\.\/productPick\.js'/.test(s),
    `${f}：从 productPick.js 引入 REF_LIMIT`)
}

/* 历史遗留的死页面（`InvPurchaseNew.vue` / `InvSaleNew.vue` 无路由）不在判据里 ——
   它们还写着 limit=500，但线上永远走不到。这条只做记录，不判红。 */
const deadPath = path.join(ROOT, 'src/pages/inventory/InvPurchaseNew.vue')
if (fs.existsSync(deadPath)) console.log('  ℹ️  死页面 InvPurchaseNew.vue 仍在仓里（无路由，不作判据）')

/* ── B. 候选过滤唯一实现 ───────────────────────────────────────────────── */
console.log('\nB. 商品候选过滤只走 pickMatches（不许页面各自抄一份 filter）')
for (const f of ['PurchaseOrderForm.vue', 'ProductCombo.vue']) {
  const s = stripComments(read(path.join(NEW, f)))
  ok(/pickMatches\s*\(/.test(s), `${f}：调用了 pickMatches`)
  /* 坏味道：自己写 name.includes(q) 的过滤 = 第二套实现 */
  const dup = /\.filter\(\s*\(?\s*p\s*\)?\s*=>[\s\S]{0,120}?\.name[\s\S]{0,40}?includes\(\s*q\s*\)/.test(s)
  ok(!dup, `${f}：没有自抄一份「按名字 includes」的过滤`)
}

/* ── C. 界面可辨识性 ─────────────────────────────────────────────────── */
console.log('\nC. 同名档案可分辨 + 单位格能解释「为什么只有一项」')
for (const f of ['PurchaseOrderForm.vue', 'ProductCombo.vue']) {
  const s = read(path.join(NEW, f))
  ok(/ipn-prod-tier/.test(s), `${f}：候选行有档位徽标 .ipn-prod-tier`)
  ok(/pickBadge\(p\)/.test(s), `${f}：徽标文案来自 pickBadge（唯一实现）`)
  ok(/pickSummary\(p\)/.test(s), `${f}：候选行 title 有完整摘要（鼠标停留可看全貌）`)
}
for (const f of PAGES) {
  const s = stripComments(read(path.join(NEW, f)))
  ok(/unitCellTitle\s*\(/.test(s), `${f}：单位格 title 走 unitCellTitle（单档时会解释原因）`)
}

const unitSrc = read(path.join(NEW, 'unitPricing.js'))
ok(/export function unitCellTitle/.test(unitSrc), 'unitPricing.js 导出 unitCellTitle')
ok(/只配了/.test(unitSrc) && /商品档案/.test(unitSrc), 'unitCellTitle 文案包含「只配了…去商品档案补」')

/* ── D. 纯函数行为自证（含坏样本）──────────────────────────────────────── */
console.log('\nD. pickScore / pickBadge 行为自证')
const { pickScore, pickBadge, pickMatches, unitTierNames, REF_LIMIT } = await import(PICK)

const P_GOOD = { id: 1, name: '简爱裸酸奶', unit: '杯', medium_unit: '组', medium_ratio: 12, large_unit: '件', large_ratio: 48, purchase_price: 1.9, sale_price: 2.1 }
const P_PRICED_ONE = { id: 2, name: '简爱裸酸奶', unit: '件', purchase_price: 50, sale_price: 60 }
const P_MULTI_NOPRICE = { id: 3, name: '简爱裸酸奶', unit: '杯', medium_unit: '组', medium_ratio: 12, large_unit: '件', large_ratio: 48, purchase_price: 0, sale_price: 0 }
const P_JUNK = { id: 4, name: '简爱裸酸奶', unit: '件', purchase_price: 0, sale_price: 0 }

ok(unitTierNames(P_GOOD).join('/') === '杯/组/件', '三档单位名按 小→中→大 去重保序', unitTierNames(P_GOOD))
ok(unitTierNames(P_JUNK).join('/') === '件', '单档商品只有 1 个档位名', unitTierNames(P_JUNK))

ok(pickBadge(P_GOOD).text === '杯·组·件' && !pickBadge(P_GOOD).muted && !pickBadge(P_GOOD).warn,
  '多档有价 ⇒ 徽标「杯·组·件」、不灰不红', pickBadge(P_GOOD))
ok(pickBadge(P_JUNK).text === '仅件' && pickBadge(P_JUNK).muted && pickBadge(P_JUNK).warn,
  '单档无价 ⇒ 徽标「仅件」+ 灰 + 红（warn）', pickBadge(P_JUNK))
ok(pickBadge(P_PRICED_ONE).text === '仅件' && pickBadge(P_PRICED_ONE).muted && !pickBadge(P_PRICED_ONE).warn,
  '单档有价 ⇒ 灰度保留、不标无价', pickBadge(P_PRICED_ONE))

ok(pickScore(P_GOOD) === 0, '有价+多档 = 0（最该排第一）', pickScore(P_GOOD))
ok(pickScore(P_PRICED_ONE) === 1, '有价+单档 = 1', pickScore(P_PRICED_ONE))
ok(pickScore(P_MULTI_NOPRICE) === 2, '无价+多档 = 2', pickScore(P_MULTI_NOPRICE))
ok(pickScore(P_JUNK) === 3, '无价+单档 = 3（最该排最后）', pickScore(P_JUNK))

const MIXED = [P_JUNK, P_PRICED_ONE, P_MULTI_NOPRICE, P_GOOD]
const sorted = pickMatches(MIXED, '简爱', 10).map((p) => p.id)
ok(sorted.join(',') === '1,2,3,4', '搜索结果按可用度升序（能用的排前面）', sorted)

/* 坏样本自证：如果排序函数退化成"保持原顺序"，上面这条必须判红 */
const naive = (list) => list
const naiveOrder = naive(MIXED).map((p) => p.id).join(',')
ok(naiveOrder === '4,2,3,1', '坏样本（不排序 = 原顺序）确实是 4,2,3,1 ⇒ 上面那条有判别力', naiveOrder)

/* 关键词过滤仍然只看 名称/条码，不能被排序逻辑顺带改坏 */
ok(pickMatches([{ id: 9, name: '完全没有关系的商品', barcode: 'X1' }], '简爱').length === 0,
  '关键词不命中 ⇒ 不返回（排序不能把无关商品带出来）')
ok(pickMatches([{ id: 10, name: '甲', barcode: '69MOO' }], '69moo').length === 1,
  '条码匹配大小写不敏感')
ok(pickMatches(MIXED, '', 2).length === 2, 'limit 生效（空关键词也有上限）')

ok(REF_LIMIT >= 2000, `REF_LIMIT 常量值被真正导出（${REF_LIMIT}）`)

/* ── 汇总 ───────────────────────────────────────────────────────────── */
console.log(`\n---------------- 契约组⑳: ${pass} PASS / ${fail} FAIL ----------------`)
process.exit(fail ? 1 : 0)
