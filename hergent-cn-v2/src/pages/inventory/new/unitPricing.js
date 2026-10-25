/* ============================================================
   unitPricing.js — 建单页「单位 × 价格」联动（v683）
   ------------------------------------------------------------
   🔴 **这个文件不算价格。** 单价、默认单位、档案价折算、上次成交价全部由后端
      `GET /api/psi/product-pricing` 给出（唯一实现 = `db/queries/product_pricing.py`）。
      前端只做三件事：拉一次、按商品缓存、把结果套到行上。

   🔴 为什么严令禁止前端自己乘除：
      v680 之前采购页把 `purchase_price` 当「元/大单位」折算，用户在「板」这一档
      看到的是 0.72 元，而真实是 7.22 元 —— 差 10 倍，生产 330 个有大包装的商品
      全受影响。任何一处"顺手乘一下"都会重演这件事。要改口径，改后端那一份。

   🔴 切档时**数量不动、只重算单价**（老板 2026-10-25 拍板）：
      「10 箱 × 72 元」切到「袋」⇒「10 袋 × 6 元」，金额跟着变。
      与采购页 v680 之前的「价×k、量÷k」**不同**，这是刻意的统一决策，
      四个建单页行为必须一致，不要再给某一页开特例。
   ============================================================ */

/** 价格来源 → 界面上给用户看的中文（必须说清这个价是从哪来的，否则用户没法判断对不对） */
export const PRICE_SOURCE_LABEL = {
  last_owner: '上次本客户/供应商成交价',
  last: '该商品上次成交价',
  last_legacy: '历史成交价（旧单未记单位）',
  archive: '商品档案价',
  none: '没取到价，请手填',
}

/** 该商品在该业务下的**预选单位名**。`row.unitOptions` 为空时返回 `''`。 */
export function defaultUnitName(row) {
  const opts = unitOptionsOf(row)
  if (!opts.length) return ''
  const want = String(row && row.defaultUnit ? row.defaultUnit : '').trim()
  if (want && opts.some(o => o.name === want)) return want
  return opts[0].name
}

/** 行的可选档位（后端下发，按 小→中→大 排）。 */
export function unitOptionsOf(row) {
  return Array.isArray(row && row.unitOptions) ? row.unitOptions : []
}

/** 按单位名找档位；找不到返回 `null`。 */
export function findUnitOption(row, name) {
  const want = String(name || '').trim()
  if (!want) return null
  return unitOptionsOf(row).find(o => o.name === want) || null
}

/** 某档的单价（后端算好的）。取不到返回 0。 */
export function priceOfUnit(row, name) {
  const o = findUnitOption(row, name)
  return o ? Number(o.price) || 0 : 0
}

/**
 * 把后端定价结果套到一行上。
 *
 * @param row      单据明细行（会被就地修改）
 * @param pricing  后端 `/api/psi/product-pricing` 的返回
 * @param opts     `{forceUnit}`：forceUnit 给了且有效就强制用这个档（采购页「按小单位采购」开关用）
 *
 * 行为：
 *   · `row.unitOptions` / `row.convText` / `row.baseUnit` / `row.defaultUnit` 一律以后端为准；
 *   · 行上**已有且合法**的单位（复制旧单 / 编辑回填 / 用户先选了再换商品）**保留**，
 *     不被档案默认值顶掉 —— 这是 v680 之前采购页就有的正确行为，四页统一继承；
 *   · `row.unit_price` 只在**当前为空或 0** 时填，已有值不动（用户手填的价不能被覆盖）。
 */
export function applyPricingToRow(row, pricing, opts = {}) {
  const p = pricing || {}
  const list = Array.isArray(p.unit_options) ? p.unit_options : []
  row.unitOptions = list
  row.convText = String(p.conv_text || '')
  row.baseUnit = String(p.base_unit || '')
  row.defaultUnit = String(p.default_unit || '')
  row.archivePrice = Number(p.archive_price) || 0
  row.archiveField = p.archive_field || ''
  row.lastScoped = p.last_scoped || null

  if (!list.length) {
    // 商品没配任何单位（档案不完整）⇒ 清空，不猜一个值上去
    row.unit = ''
    row.priceSource = 'none'
    return row
  }

  const keep = String(row.unit || '').trim()
  const force = String(opts.forceUnit || '').trim()
  let target = ''
  if (force && list.some(o => o.name === force)) target = force
  else if (keep && list.some(o => o.name === keep)) target = keep
  else target = defaultUnitName(row)

  row.unit = target
  const o = findUnitOption(row, target)
  row.priceSource = o ? String(o.price_source || 'none') : 'none'

  // 只在"还没有价"时带出 —— 用户填过的价不覆盖
  if (!(Number(row.unit_price) > 0) && o && Number(o.price) > 0) {
    row.unit_price = String(o.price)
  }
  return row
}

/**
 * 切档：**只重算单价，数量不动**（四页统一口径）。
 *
 * @param {object} opts `{force}`：force=true 时**即使单位名没变也重算一次**。
 *        给"总闸全表切换""按名重算"这类场景用 —— 否则调用方必须先还原旧值再切，
 *        而"还原"依赖 `_prevUnit` 快照，`<select>` 的 v-model/change 触发顺序又没有规范，
 *        半开概率下会静默变成"下拉变了、价没变"（v455 踩过，v683 直接消灭这个依赖）。
 * @returns 本次是否真的改了价（用于页面提示）
 *
 * 🔴 切档后价是 0（该档没历史价、档案也没价）时**保留原单价不清零**：
 *    清成 0 会让用户以为"这档不要钱"，而真实情况是"这档没有价可参考"。
 *    界面上由 `priceSource === 'none'` 提示「请手填」。
 */
export function applyUnitChange(row, newName, opts = {}) {
  const name = String(newName || '').trim()
  if (!name) return false
  if (!opts.force && name === row.unit) return false
  row.unit = name
  const o = findUnitOption(row, name)
  row.priceSource = o ? String(o.price_source || 'none') : 'none'
  const price = o ? Number(o.price) || 0 : 0
  if (price > 0) {
    row.unit_price = String(price)
    return true
  }
  return false
}

/**
 * 按业务类型取每个商品的定价（带缓存）。
 *
 * 缓存的原因：同一商品在一张单里可能多行；切客户/供应商时归属价会变 ⇒ 需要 `clear()`。
 */
export function createPricingCache(fetchFn) {
  const cache = new Map()
  let inflight = new Map()

  return {
    /** 取定价（命中缓存直接返回）。失败时抛错，由调用方决定提示方式。 */
    async get(productId) {
      const id = Number(productId) || 0
      if (!id) return null
      if (cache.has(id)) return cache.get(id)
      if (inflight.has(id)) return inflight.get(id)
      const p = (async () => {
        try {
          const d = await fetchFn(id)
          cache.set(id, d || null)
          return d || null
        } finally {
          inflight.delete(id)
        }
      })()
      inflight.set(id, p)
      return p
    },
    /** 清缓存 —— 换客户/供应商后归属价变了，必须重取。 */
    clear() {
      cache.clear()
      inflight.clear()
    },
    get size() {
      return cache.size
    },
  }
}
