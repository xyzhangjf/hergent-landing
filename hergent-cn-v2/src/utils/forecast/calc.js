import { fmtBox } from './format.js'

// v184d：**报单金额的计价基准 = 进价（元/箱）**。
// 🔴 v226b 收紧：只认 `factory_price`，**不再回退 `purchase_price`**。为什么必须收紧：
//   · 量纲：`purchase_price` 是**元/小单位**（生产实测 `factory_price = pp × perCase × 0.9`，46/46 成立），
//     而本函数返回值要乘 `rowFinalQty`（**箱数**）⇒ 回退会让金额**差一个 perCase 倍**（10~36 倍）。
//   · 语义：`purchase_price` 生产实测 **56/56 == `sale_price`**（其中 46/46 还 == `dist_price`）
//     ⇒ 它存的是「卖给门店的价」，压根不是进货成本；拿它当进价是在说假话。
//   · 生产影响：命中 10 个商品，而它们 `pp == sp` 逐个全等 ⇒ **金额数值零变化**
//     （回退 pp 与回退售价本就等价），只是界面从「缺规格」如实改成「缺价」。
// ⚠️ 与「档案完整性」口径的区别（**别把两件事混成一件事**）：
//   `ProductArchive.fpEff()` 与后端 `db.factory_price_sql` **仍保留**回退 —— 它们回答的是
//   「这个商品档案里有没有录过价格信息」（用于列表展示与缺价计数/闸门），**不是**「算金额用多少钱」。
//   同一个词「进价」在两个问题下答案不同，是有意的；改任意一处前先想清问的是哪一个。
export function factoryPrice(r) {
  return Number(r?.factory_price || 0)
}

/* v189：规格 → **每箱小单位数**（「合计(箱) = 合计(小单位) ÷ 规格」里那个「规格」的唯一实现）。
   🔴 原四处都写 parseFloat(spec)，取到的是**净含量**、不是每箱数：
        parseFloat('200g*12') = 200（克）、parseFloat('1500ML*6桶') = 1500 ⇒ 箱数被缩小 250 倍。
        生产只读实测（期次 9）：规格 200g*12 的 24 件 → 算出 **0 箱**（正确应为 2；该期合计 0 → 3）。
   🔴 为什么不能「先合计小单位、再除以某个规格」：生产档案 288 个商品里 **192 个规格是描述串**
        （'250g*24瓶' / '90g*8杯*12组' / '210g*10瓶*6提手提装'）、**30 个为空** —— 规格异构时
        该式**没有定义**。成立的唯一定义是**逐行除、再相加**（见 rowBoxes），本函数只负责那一「除」。
   规则（对全量档案逐一验过）：
     ① 取规格串里**最后一个**数字 = 每箱小单位数（250g*24瓶→24、100g*8杯*12组→12、1500ML*6桶→6）；
     ② 报单单位(unit)也在规格里出现、且比末位更靠前（更细）时按层级相乘：
        100g*8杯*12组 且 unit=杯 → 8×12 = 96（1 箱 = 12 组 = 96 杯）；
     ③ 纯数字规格（'12'）即其本身；
     ④ 不含任何数字 → 0（缺规格 ⇒ 不换算，界面走「缺规格」分支，**不静默当 1**）。 */
/* v222（2026-09-21）：换算的**数据源**改为「商品档案优先 → 规格解析回退」——尺度与语义**完全不变**
   （仍返回「1 个大单位 = 多少个小单位」= 每箱小单位数；报单单位落在中/大单位层时按层级折算）。
   🔴 为什么改：规格串是**自由文本**，生产实测三类翻车 ——
      · 净含量被当成装箱数：'340G' ⇒ 340 瓶（与真值 12 差 **28.3 倍**）；
      · 末位数字不是装箱数：'195g×24盒（130g+65g）' 被末位抓成 **65**；
      · 空规格 28 个 ⇒ 连箱数都算不出（界面显示「缺规格」）。
     而 `products.large_ratio/medium_ratio` **结构化、有来源**（import_zhoupu.py 读舟谱「大单位换算」，
      与本轮舟谱档案逐值比对 **96.8% 一致**），且**已被定价引擎消费**（domain/pricing_engine.py）。
   🔴 权威唯一性：这是「1 件 = 24 瓶」在本系统的**唯一权威**；`unit_conversions` / `unit_archive`
      在生产上都是 **0 行空表**、**不得反向写入**（同一事实存两份必然漂移）。
   🔴 判据是 `large_ratio > 0`，**不是** `has_multi_unit` —— 实测该标志位漏标 9 条，拿它当判据会静默漏商品。
   🔴 三级尺度以**档案**为准（规格串只是兜底）：报单单位 == 大单位 ⇒ 1；== 中单位 ⇒ lr/mr；
      其余（更细/未知名）⇒ lr。**回退只在档案无换算时发生**，逐字保留 v189 规则，不做「先猜再看」。
   参数 `arc` = 行对象（含 large_unit/large_ratio/medium_unit/medium_ratio，由 /api/products/grid 下发）；
      **不传 ⇒ 完全回到 v189 行为**（供测试与未配套升级的调用方，不静默按 1 算）。 */
export function perCase(spec, unit, arc) {
  // ① 档案换算优先（唯一权威）
  const lr = arc ? (Number(arc.large_ratio) || 0) : 0
  if (lr > 0) {
    const u0 = String(unit == null ? '' : unit).trim()
    const lu = String(arc.large_unit == null ? '' : arc.large_unit).trim()
    const mu = String(arc.medium_unit == null ? '' : arc.medium_unit).trim()
    const mr = Number(arc.medium_ratio) || 0
    if (u0 && lu && u0 === lu) return 1                    // 按大单位（件/箱）报单 ⇒ 1 个 = 1 箱
    if (u0 && mu && u0 === mu && mr > 0) return lr / mr    // 按中单位报单 ⇒ 1 箱 = lr/mr 个中单位
    return lr                                              // 按小单位报单（当前生产全部命中此支）
  }
  // ② 回退：规格串解析（v189 规则，逐字保留）
  const s = String(spec == null ? '' : spec)
  // 「数字 + 紧随其后的单位字串」分段（'*' / 'x' / '×' 只作分隔）
  const segs = []
  const re = /(\d+(?:\.\d+)?)\s*([^\d\s*×xX·]*)/g
  let m
  while ((m = re.exec(s))) {
    const n = parseFloat(m[1])
    if (n > 0) segs.push({ n, u: String(m[2] || '').trim() })
  }
  if (!segs.length) return 0                        // ④ 无数字
  const last = segs[segs.length - 1]
  if (segs.length === 1 && !last.u) return last.n    // ③ 纯数字规格
  if (!last.u) return last.n                         // 末位无单位（'500g*12'）⇒ 它就是每箱数
  const u0 = String(unit == null ? '' : unit).trim()
  if (!u0 || u0 === last.u) return last.n            // ① 同单位 / 报单单位缺失
  const i = segs.findIndex(x => x.u === u0)
  if (i >= 0 && i < segs.length - 1) {               // ② 报单单位更细 ⇒ 层级相乘
    return segs.slice(i).reduce((p, x) => p * x.n, 1)
  }
  return last.n
}

/* v207：箱数换算的**唯一实现**（不含取整）—— rowBoxes / 只读表行构造 / 编辑格子回写共用这一处。
   🔴 为什么去掉 Math.round（原 v184e 写法。用户 2026-09-19 报障：期次 14 / 永辉东津店
       的报单「合计(小单位)」有 9、「合计(箱)」却是 0）：
       报单数量按**最小销售单位**录入（瓶/杯/组/袋），「合计(箱)」= 数量 ÷ 每箱小单位数
       **可以是小数** —— 这是用户 2026-09-13 已拍板的口径（`件数 = 数量 ÷ 规格`，明确可为小数）。
       旧实现先 Math.round ⇒ 不足半箱的行被抹成 **0**；更贵的是连带
       `下单金额 = 最终下单(箱) × 单价(进价/箱)` 一起变 0，而「单价(进价/箱)」列本身不为 0
       ⇒ 用户只看到金额栏凭空归零，看不出是哪一步丢的。
   🔴 取整**只发生在「最终下单」**（见 rowFinalQty），理由：厂商不拆零发货。
   ⚠️ 保留 **3** 位小数（不是 2 位）：185ml×24瓶 报 3 瓶 = 0.125，2 位会显示成 0.13。
      用户自己的报单 Excel 里「件数」就是 3 位（实锤：3.625）⇒ 同精度便于逐行对账。 */
export function boxesOf(total, spec, unit, arc) {
  const pc = perCase(spec, unit, arc)
  const t = Number(total) || 0
  if (!(pc > 0) || !t) return 0
  return Math.round(t / pc * 1000) / 1000
}

// v184e / v207：合计(箱) —— 与只读表「合计(箱)」列、rowFinalQty（最终下单）、下单金额同源。
//   v188 仅改列名（原「件数(箱)」），公式与 key(`boxes`) 不变。
//   v189 修「规格」的取法：parseFloat(spec) 取的是净含量 ⇒ 改走 perCase（唯一实现）。
//   v207 去掉取整（抹零元凶）—— 见 boxesOf 上方说明。
export function rowBoxes(r) {
  if (!r) return 0
  const total = r.total != null ? (Number(r.total) || 0) : rowSum(r)
  return boxesOf(total, r.spec, r.unit, r)
}

/* v207：某一行的「合计(箱)」**换算不出来**（有报单但商品档案没规格）—— 全站**唯一判据**。
   boxText（单元格文案）、boxMissingRows（表尾未计入行数）、单元格警示样式 全部引用它。
   ⚠️ 绝不在别处再写一遍这个条件：两处判据一旦漂移，就会出现「表尾说有 2 行缺规格、
      单元格却一个都没标」这种自相矛盾的界面。 */
export function boxMissing(r) {
  if (!r) return false
  const total = r.total != null ? (Number(r.total) || 0) : rowSum(r)
  return total > 0 && !(perCase(r.spec, r.unit, r) > 0)
}

/* v207：「合计(箱)」的**显示取值** —— 把「缺规格」与「真的是 0」分开。
   缺规格时 perCase 返回 0 ⇒ 根本换算不出来；若照常显示 0，用户看到的就是「报了单却 0 箱」，
   与本次报障**长得一模一样、根因完全不同**（一个是取整抹零、一个是商品档案没规格）。
   与 perCase 规则④「缺规格 ⇒ 不换算，界面走「缺规格」分支，不静默当 1」一致。 */
export function boxText(r) {
  if (!r) return '—'
  return boxMissing(r) ? '缺规格' : fmtBox(rowBoxes(r))
}

/* 🔴 v223（2026-09-21）：**单价(进价/箱) = 商品档案的进价本身，不做任何乘除。**
   轨迹 —— 三轮都在调「乘多少」，没人质疑「该不该乘」：
     v184e 写 `进价 × parseFloat(规格)`（取到的是净含量）；v189 把「规格」换成每箱小单位数（1500ML*6桶 由 ×1500 变 ×6）；
     v222 把「每箱小单位数」的数据源从规格解析换成档案换算 —— 三次都没动那个「×」。
   🔴 事实：`products.factory_price` 的单位**就是「元/箱（大单位）」**，不是「元/小单位」。三条**互相独立**的数据逐条吻合：
     ① `进价 ÷ large_ratio` = 每小单位成本，再 `÷ 0.9` = 档案 `dist_price`
        （1494: 75÷15=5.00 → 5.5556 ✓；1454: 124.80÷24=5.20 → 5.7778 ✓；1477: 94.80÷12=7.90 → 8.7778 ✓；1539: 62÷8=7.75 → 8.6111 ✓）
     ② `sale_order_items.unit_price` **逐字等于** `dist_price`（1494 全部 389 行 = 5.5556；1454 227 行 = 5.7778；1539 343 行 = 8.6111）
     ③ 反证：若进价是「元/小单位」，1494 一箱成本 = 75 × 15 = 1125 元，而门店买一箱只付 83.33 元 ⇒ **卖一箱亏 1041 元**，不可能
   旁证（后端同口径）：`domain/pricing_engine._get_standard_price` 写 `大单位价 = sale_price × large_ratio`
     ⇒ **`sale_price` / `purchase_price` / `dist_price` 是「元/小单位」，只有 `factory_price` 是「元/大单位」**。
   ⇒ 再乘 perCase 就是把「元/箱」又乘一次每箱单位数 ⇒ **单价与金额同时被放大 perCase 倍**
     （1454 曾显示 124.80 × 24 = 2995.20，真值 124.80，放大 24 倍）。这正是 v217「价格被放大」诊断出的那个根，v223 才真正修掉。
   ⚠️ 单价**不再依赖 perCase** ⇒ 缺规格的行也照样显示单价；但箱数仍算不出来 ⇒ 金额仍走「缺规格」（见 amountValue 守卫）。
   v190：**自动价** = 换算的唯一实现，供 pricePerCase 与录入框占位提示共用。
     结果归一化到「分」：进价是浮点（`62/0.9` 这类），不归一就会出现
     「界面上写着 3840.00、金额却是 3839.9996 累出来的」——用户拿去对账差几分钱。这是**计价精度**，不是掩盖误差。
   ✅ v226b 已收紧（原遗留项）：`factoryPrice()` 不再回退 `purchase_price`（元/小单位） —— 见其定义处注释。
     命中 10 个商品、`pp == sp` 全等 ⇒ **金额数值零变化**；文案由「缺规格」改为更前置、更准确的「缺价」
     （它们既没箱价、也没规格，先缺的是价）。要让它们能算金额，须在**商品档案**按「元/箱」补一个进价。 */
export function priceAuto(r) {
  const fp = factoryPrice(r)
  if (fp <= 0) return null                      // 缺价
  return Math.round(fp * 100) / 100
}

/* v190：「单价(进价/箱)」取值 = **手工录入优先**，否则自动价。
   录入值是权威 —— 直接用它（同样归一到分，钱只到分位），不再经进价回算，
   免得「填 100、保存后显示 99.9996」。
   🔴 2026-09-18 口径变更（用户拍板「**只在本期生效**」）：手工价随报单落进
   `forecast_extra_qty.case_price`（唯一键含 产品×期次）⇒ 只影响本期；
   **不再反推写回商品档案** —— 写档案会改掉**所有期次**的金额。
   要在别期也用这个价，就在那一期自己再填一次。
   🔴 v191b（同日稍晚，用户拍板「**直接延用上一期，不加按钮**」）⇒ 取值链由两级变**三级**：
       ① 本期手工录入（`r.casePrice`，随 save-matrix 落库、只在本期生效）
       ② **沿用**：本期之前**最近一次录入**过的价（`r.casePriceInherit`，后端随 summary 下发）
       ③ 都没有 ⇒ 按商品档案进价自动算（`priceAuto`）
   ②是**只读参考值，绝不落库** —— 不碰档案、也不写本期记录 ⇒「没填」不会被保存成「填过」，
   清空输入框即可撤销（回落到 ②/③）。 */
export function priceInherit(r) {
  const iv = Number(r && r.casePriceInherit)
  return iv > 0 ? Math.round(iv * 100) / 100 : null
}

/* v191b：沿用来源的期次标签（后端下发 last_case_period_start/end，形如 2026-08-30 / 2026-09-15）。
   纯展示，不参与任何计算；同一年只给「月/日」，跨年或非本年带上年份。 */
export function inheritPeriodLabel(ps, pe) {
  const p = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''))
    return m ? { y: m[1], t: m[2] + '/' + m[3] } : null
  }
  const a = p(ps)
  const b = p(pe) || a
  if (!a) return '上一期'
  if (b.y === a.y && a.y === String(new Date().getFullYear())) return a.t + '–' + b.t
  return a.y + '/' + a.t + '–' + b.t
}

export function pricePerCase(r) {
  const cv = Number(r && r.casePrice)
  if (cv > 0) return Math.round(cv * 100) / 100   // ① 本期手工录入
  const iv = priceInherit(r)
  if (iv != null) return iv                        // ② 沿用上一期录入的价（不落库）
  return priceAuto(r)                              // ③ 按商品档案进价自动算
}

/* v190：录入框灰字占位 —— 未手工录入时显示「**当前实际生效的价**」，让用户一眼知道现在按多少算；
   缺价则直接说明，而不是留一个空白框让人猜。
   ⚠️ v191b：占位值改用 `pricePerCase`（= 生效值）而不是只给 `priceAuto`（自动价）——
   生效值还可能是「沿用上一期录入的价」，只显示自动价会与旁边「下单金额」列对不上（同屏两个口径）。
   来源差异放在 `title` 里说清（见 priceTitle），灰字本身不区分来源。
   ⚠️ v223：单价已不依赖 perCase ⇒ 空态**只剩「缺价」一种**（原「缺规格」分支成了死代码，已删）；
     缺规格的提示仍在「合计(箱)」列（boxText）与金额列（amountValue 守卫）里出现，没有丢信息。 */
export function pricePh(r) {
  const eff = pricePerCase(r)
  if (eff != null) return eff.toFixed(2)
  return '缺价，请填'
}

/* v190：来源必须可自证 —— 手工价与自动价不得长得一样。
   v191b：三级来源各一句，且「沿用」态要点名**是哪一期的**录入价（否则老板会以为是自己本期填的）。
   沿用态同样只进灰字占位：不实填、不加粗 ⇒ 一眼能与「本期手工录入」区分开。 */
export function priceTitle(r) {
  const a = priceAuto(r)
  const cv = Number(r && r.casePrice)
  const iv = priceInherit(r)
  let head
  if (cv > 0) {
    head = '本期手工录入价（只在本期生效：本次报单按这个价算金额，不写回商品档案，也不影响其他期次）'
  } else if (iv != null) {
    head = '沿用「' + (r.casePriceInheritPeriod || '上一期') + '」录入的价 ¥' + iv.toFixed(2)
      + '/箱 —— 本期不用重填；直接填数即可改，清空则回到档案自动价'
  } else {
    head = '按商品档案的进价：进价本身就是「元/箱」，直接作为单价(进价/箱)。可直接录入覆盖。'
  }
  return head + (a != null ? `\n自动价 ¥${a.toFixed(2)}/箱` : '')
}

/* v184e：下单金额(进价)（元）= 最终下单(箱) × 单价(进价/箱)；缺价或缺规格返回 null（界面显示「缺价/缺规格」）。
   🔴 v223 补第二道守卫：单价改回「进价本身」后**不再依赖 perCase**，若这里仍只看 `pricePerCase`，
      缺规格的行会算出 `rowFinalQty(=0) × 单价 = 0.00` —— 与旁边「合计(箱)」写着「缺规格」自相矛盾，
      而且会被当成本期真的一分钱没有。⇒ 与 `perCase` 规则④「缺规格不静默当 1」同判据，显式返回 null。 */
export function amountValue(r) {
  const pc = pricePerCase(r)
  if (pc == null) return null
  if (!(perCase(r.spec, r.unit, r) > 0)) return null   // v223：缺规格 ⇒ 箱数无从换算 ⇒ 金额也谈不上
  return rowFinalQty(r) * pc
}

export function rowSum(r) {
  return Object.values(r.qtyByUnit || {}).reduce((s, v) => s + (parseInt(v) || 0), 0)
}

// 「最终下单」唯一口径（用户口径 2026-09-15 订正）：**报单合计 + 加单**，不区分是否定稿。
//   - 基准：只读主表行带后端权威 total（=SUM(quantity)）；编辑态草稿行无 total → 回退 rowSum（单元求和）。
//   - 加单兼容两种存法：只读态 extra_qty（后端 forecast_extra_qty）/ 编辑态 extraQty（本地草稿）。
//   ⚠️ 本函数是全站唯一实现 —— 模板显示 / 列统计 / 列筛选 / aria / 复制报单 / 下单金额 全部走它。
//      改口径只改这里一处。（旧实现按「已定稿取 final_qty、未定稿取 0」分支，与显示口径并不一致。）
export const rowExtraQty = (r) => Number(r && (r.extra_qty != null ? r.extra_qty : r.extraQty)) || 0
export const rowFinalQty = (r) => {
  if (!r) return 0
  /* v184e：最终下单 = 合计(箱) + 加单(箱)（此前是 合计 + 加单（按件），与「合计(箱)」列脱节）。
     v207：补上**取整** —— 用户 2026-09-13 拍板「取整只发生在最终下单」，方向 = 商品级、默认**向上**。
       理由：**厂商不拆零发货** ⇒ 报了 3 瓶（=0.125 箱）实际下单就是 1 箱。
       不取整会有两个说不通的后果：① 「最终下单」出现小数箱，而这列是要拿去厂家系统下单的；
       ② `下单金额 = 最终下单(箱) × 单价(元/箱)` 会按 0.125 箱算钱 —— 现实中收不到这种货。
       ⚠️ `- 1e-9` 是浮点护栏：24/24 可能算成 1.0000000000000002，Math.ceil 会直接跳到 2 箱。
       ⚠️ 「按商品配置取整方向」**暂未实现** —— 商品档案里没有这个字段（`products` 无取整方向列），
          所以一律按默认向上。将来要支持，就在此处读 `r.round_dir`（'ceil' 向上 / 'floor' 向下）。
       ⚠️ 本函数是全站唯一实现（模板 / 列统计 / 列筛选 / aria / 复制报单 / 下单金额 / 返利达成 全走它）
          ⇒ 改口径只改这一处；但也意味着**改一次，全站一起动**。 */
  return Math.ceil(rowBoxes(r) - 1e-9) + rowExtraQty(r)
}
