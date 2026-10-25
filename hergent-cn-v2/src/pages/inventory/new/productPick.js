/* ============================================================
   productPick.js — 商品搜索候选的「可辨识 + 可用优先」（唯一实现）
   ------------------------------------------------------------
   为什么需要它（v685 生产事实）：
     老板在采购页搜商品，搜索列表里 **同名档案一模一样**，只显示「名称 + 条码」。
     生产 tenant_1 实测：1270 个商品里 800 个是「单档且无采购价」的档案，
     130 组重名（916 条），其中 **119 组是「同名但一条多档、其余单档」**。
     ⇒ 用户搜「简爱裸酸奶」，列表里 1 条是杯/组/件、价格齐全，
       另外几条同名但只有「件」1 档、价格 0。点错了，单位下拉就只有一项，
       用户看到的现象就是「**单位不能选**」—— 功能没坏，是"选中了没用的档案"。

   本模块只做两件事，都在**选择层**，不碰任何业务口径（价格/数量仍由后端算）：
     1. `pickBadge(p)`    每行追加档位徽标，让同名商品一眼可分：
                          多档 → `杯·组·件`；单档 → `仅件`（灰）；无价再加红标。
     2. `pickMatches()`   候选排序：**能用的排前面**
                          （有价+多档 → 有价单档 → 无价多档 → 无价单档），
                          同分保持后端原顺序（稳定排序，不靠 id 大小猜）。
   ------------------------------------------------------------
   🔴 不要在这里判「采购用采购价、销售用售价」的严格口径：
      这里只回答「这条档案是不是配好了能用」，任一种价 > 0 就算有价。
      真正的取价在 `unitPricing.js` / 后端 `product_pricing.py`。
   ============================================================ */

/* 🔴 `refs` 的 limit 必须大于「商品 / 客户 / 供应商」的最大条数 —— 建单页是
   **本地过滤**（下拉里现搜），拉不全就等于搜不到。
   生产实测 2026-10-25：tenant_1 商品 1270 条，而四建单页一直传 `limit=500`；
   后端 `product_list` 是 `ORDER BY id DESC LIMIT ?` ⇒ 只拿到 **id 最大的 500 条**
   （后导入的档案），老板搜老商品时它根本不在列表里，命中的全是同名垃圾档案。
   这个 500 同时截断了客户（702 条）。改动前现象 = 「商品搜不到 / 单位不能选」，
   而接口 200、界面无报错 —— 又一个静默失效。留 4 倍余量，破万再换后端搜索。 */
export const REF_LIMIT = 5000

/** 档案里配了哪几档单位（去重、保序、丢掉空名）。最小档 ratio 恒为 1。 */
export function unitTierNames(p) {
  const out = []
  const push = (name, ratio) => {
    const n = String(name || '').trim()
    if (!n || out.includes(n)) return
    out.push(n)
  }
  push(p && p.unit)
  push(p && p.medium_unit)
  push(p && p.large_unit)
  return out
}

/** 有没有价（元/小单位的采购价或售价，任一 > 0）。 */
export function hasAnyPrice(p) {
  return Number(p && p.purchase_price) > 0 || Number(p && p.sale_price) > 0
}

/**
 * 下拉里那一小段辅助文字。
 * @returns {{text: string, muted: boolean, warn: boolean}}
 *   text  档位说明（多档 `杯·组·件` / 单档 `仅件` / 没配 `无单位`）
 *   muted 灰字（单档 / 没配 —— 选它多半是选错了）
 *   warn  红字（无价，选了也带不出价格，须手填）
 */
export function pickBadge(p) {
  const tiers = unitTierNames(p)
  const priced = hasAnyPrice(p)
  if (tiers.length >= 2) return { text: tiers.join('·'), muted: false, warn: !priced }
  if (tiers.length === 1) return { text: '仅' + tiers[0], muted: true, warn: !priced }
  return { text: '无单位', muted: true, warn: !priced }
}

/** 可辨识的一行摘要（给 title / tooltip 用，鼠标停留能看到全貌）。 */
export function pickSummary(p) {
  const b = pickBadge(p)
  const bits = [String((p && p.name) || '').trim() || '(无名称)']
  if (p && p.spec) bits.push('规格 ' + p.spec)
  bits.push('单位 ' + b.text)
  if (!hasAnyPrice(p)) bits.push('档案里没有价格')
  if (p && p.barcode) bits.push('条码 ' + p.barcode)
  else bits.push('无条码')
  return bits.join(' ｜ ')
}

/**
 * 可用度打分（越小越该排前面）。
 *   0 有价 + 多档（最该选的那条）
 *   1 有价 + 单档
 *   2 无价 + 多档（能选单位，但得手填价）
 *   3 无价 + 单档（基本是重复/废弃档案）
 */
export function pickScore(p) {
  const priced = hasAnyPrice(p) ? 0 : 1
  const multi = unitTierNames(p).length >= 2 ? 0 : 1
  return priced * 2 + multi
}

/**
 * 搜索候选：过滤 + 可用优先排序 + 截断。
 *
 * @param list   全量商品（来自 `psiApi.refs('products')`）
 * @param kw     关键词（名称或条码，包含式；空 = 全部）
 * @param limit  最多返回多少条（默认 50，与改动前一致）
 */
export function pickMatches(list, kw, limit = 50) {
  const arr = Array.isArray(list) ? list : []
  const q = String(kw || '').trim().toLowerCase()
  const hit = q
    ? arr.filter((p) =>
      String((p && p.name) || '').toLowerCase().includes(q) ||
      String((p && p.barcode) || '').toLowerCase().includes(q))
    : arr

  /* 稳定排序：手写下标兜底，不依赖 Array.prototype.sort 的引擎稳定性 */
  return hit
    .map((p, i) => ({ p, i, s: pickScore(p) }))
    .sort((a, b) => (a.s - b.s) || (a.i - b.i))
    .slice(0, limit)
    .map((x) => x.p)
}

/** 只有 1 档（或没配单位）时，给用户的解释文案；多档返回空串。 */
export function singleUnitNote(p) {
  const tiers = unitTierNames(p)
  if (tiers.length === 0) return '这个商品档案里没配单位，开单前请先到「商品档案」补上。'
  if (tiers.length === 1) {
    return `这个商品档案只配了「${tiers[0]}」1 个单位，所以没有别的可选；`
      + '想按其他单位开单，请先到「商品档案」里补上中/大包装单位。'
  }
  return ''
}
