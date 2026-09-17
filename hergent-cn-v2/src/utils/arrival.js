/* 「到货周期」的**唯一实现** —— 字段 `products.arrival_lead_days`
   （= 该单品**下单后第几天到货**的提前天数，整数；0 = 未设置）。

   五个消费面共用本文件，谁都不许再写第二份（含注释里的「照抄版」）：
     · 「本期预报」主表列（Forecast.vue 的 MASTER_COL_DEFS fmt）与商品档案弹层
     · 「商品档案」页的列表列、只读详情弹层、新增表单、导出（ProductArchive.vue）
   两处各写一份格式化 = 第二份拷贝 = 静默漂移（改了主表忘了档案页，同一商品两处显示不一致）。

   ⚠️ 它**不是** `products.lead_time_days`（补货算法的提前期，默认 7，进安全库存/补货点公式），
      也**不是**品牌级的 `rebate_target_rules.order_cadence_days`（每几天到货一次的**频率**）。
      三者是三个量，别混用。

   值的写入口有两个（都要走同一套校验）：
     ① 预报订单导入的「到货周期」列（后端 `import_router._re_rhythm`，落 `arrival_lead_days`）；
     ② 「商品档案」页该列的行内编辑 / 新增表单（本文件 parseArrivalDays → PUT /api/products/{id}）。 */

/* 上界 365：低温奶实际 1~7 天，留 365 只为挡住「把售价/数量填到这一格」这类误操作。
   🔴 前后端必须同值 —— 后端 `routers/data.py::update_product` 与
      `db/queries/products.py::_ATD_MAX`。改了这里不改那里，就会出现「前端放行、后端 400」。 */
export const ARRIVAL_MAX = 365

/** 展示口径：3 → '+3天'；0 / 空 / 非法 → '—'（= 未设置）。 */
export function arrivalCycleText(v) {
  const n = Number(v)
  return n > 0 ? '+' + n + '天' : '—'
}

/**
 * 解析用户输入 → 整数天数。
 *
 * 合法写法：`3` / `'3'` / `'+3'` / `'+3天'` / `'3天'` / `'+3到货'` / `'＋3天'`（全角加号）
 * 空输入（`''` / null / undefined）→ `empty=true`，语义是**取消设置**（提交 0）。
 * 返回 `{ ok, value, empty }`：`ok=false` 时调用方应提示用户、**不要提交**。
 *
 * ⚠️ 与预报导入的 `_re_rhythm` **有意不同**，不是不一致：
 *   导入那一列是**自由文本列**，同表里还有「+1」加单标记、备注等，裸数字会被误判，
 *   故那边**要求**「加号 + 天/到货」收尾；本函数的输入是**已被列头认领的专用格**，
 *   裸数字无歧义，接受它才不会让用户在编辑框里还必须打「+」和「天」。
 *   两条规则的**结果**都是同一个整数、落同一列，展示也是同一个 `arrivalCycleText`。
 */
export function parseArrivalDays(raw) {
  if (raw == null) return { ok: true, value: 0, empty: true }
  if (typeof raw === 'boolean') return { ok: false, value: 0, empty: false }
  if (typeof raw === 'number') {
    if (!isFinite(raw) || Math.floor(raw) !== raw) return { ok: false, value: 0, empty: false }
    if (raw < 0 || raw > ARRIVAL_MAX) return { ok: false, value: 0, empty: false }
    return { ok: true, value: raw, empty: false }
  }
  const s = String(raw).trim()
  if (s === '') return { ok: true, value: 0, empty: true }
  // 半角/全角加号 + 数字 + 可选「天/到货」收尾；其余一律不认（避免把 '3天保质期' 之类的自由文本吞掉）
  const m = /^[+＋]?\s*(\d{1,4})\s*(?:天到货|到货|天)?$/.exec(s)
  if (!m) return { ok: false, value: 0, empty: false }
  const n = parseInt(m[1], 10)
  if (n > ARRIVAL_MAX) return { ok: false, value: 0, empty: false }
  return { ok: true, value: n, empty: false }
}
