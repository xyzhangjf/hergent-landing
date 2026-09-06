# 预报订单模块 × 舟谱订单汇总表 产品结构对齐方案

> 分析对象：`/Users/zhangjunfeng/Documents/舟谱导入模版/最新26年8月下单表8.18.xlsx`
> 目标：让 Web 端「预报订单模块」用与这份表**完全相同的数据结构**实现，做到"打开即所见、粘贴即所得、保存即落库"。
> 日期：2026-08-22（基于当日对话上下文：AI 层战略 / 已上线 Excel 式可编辑网格 + 粘贴）

---

## 一、源表产品结构分析（实测结论）

### 1.1 整体形态：多 sheet 的"报单-到货"周期滚动表
- 整个工作簿 = **一个周期一张 sheet**，sheet 名即周期，如 `8月14报单-8月18到货`。
- 命名规律 = `报单日 ~ 到货日`，业务节奏是 **提前 4 天报单、每 2 天到货一批**（与模块 `period.order_start / order_end / arrival_date` 完全对应）。
- 本表 69 个周期 sheet（4月→8月历史滚动）+ 1 个 `Sheet1`（空/模板）。

### 1.2 单 sheet 的列结构（行=商品，列=客户，单元格=数量）
以 `8月14报单-8月18到货` 为例，表头（第 0 行）分三段：

| 区段 | 列 | 含义 | 对应模块字段 |
|---|---|---|---|
| **商品主档（冻结列）** | `条码`(col1)、`规格`(col2)、`简称`(col3)、`分销价格`(col4)、`永辉代码`(col5) | 商品身份 + 指导分销价 + 客户系统代码 | `products.barcode / spec / name / sale_price(分销口径) / external_code` |
| **客户数量列（核心交叉区）** | `唐成`(col6)…`美联保康`(col26)，共 **21 个客户** | 每个客户对该商品的报单数量 | `cross.units[]` + `r.qtyByUnit[客户名]` |
| **汇总/计算列** | `合计`(col27)、`件数`(col28)、`枣阳`(col29)、`成丽`(col30)、`加单`(col31)、`最终下单`(col32)、`单价`(col33)、`下单金额`(col34)、`订单排期`(col35) | 行级聚合 + 人工调整 + 金额 | `交叉表自动合计` + `最终下单(可调) + 单价 + 金额` |

### 1.3 关键字段语义（实测校验）
- **`合计`(col27) = 各客户列之和**（已校验：row2 客户列和 170 = 合计 170）。
- **`件数`(col28) = 合计 ÷ 规格**（row2：170 ÷ 10 = 17 件）。
- **`最终下单`(col32) = 人工调整后的实际下单量**（默认 = 件数，可改；是真正下单依据）。
- **`单价`(col33) ≠ `分销价格`(col4)**：分销价格是给下游客户的指导价；单价是**最终对内成交口径**（含利润/运费等）。row5 实际成交单价 110 远高于分销价 12.2。
- **`下单金额`(col34) = 单价 × 最终下单**（已校验：99×17=1683、78.6×80=6288 全部吻合）。
- **`\n合计\n\n（最小数量）`**：列名带换行，语义是"各客户取最小数量汇总"的经验算法（低温奶按最小陈列量保底）。
- **行尾 `总合计` 行**（row152）：跨商品再按客户列求和 + 全局合计/件数/金额，是 sheet 级汇总。

### 1.4 商品行的特殊结构：按"下单人"拆子行
同一 `条码` 会出现多行，靠 `简称` 后缀区分，如：
- `红桶（恒滋下单）` / `红桶（福宝下单）` — 同一商品不同报单人各一行
- 含义：一个 SKU 由不同业务人员分别报单，拆成独立行方便追责/统计，但**底层是同一个商品**。

### 1.5 客户列是**动态演化**的（关键约束 ⚠️）
- 4月 sheet：20 个客户（含 `秦小芳`、`电商`、`檀溪美联`）
- 8月 sheet：21 个客户（客户名微调：`美联檀溪`、`汴河`、`美联保康`；新增 `刘小顶`；尾部多 `枣阳/成丽` 两列）
- **结论：客户集合随周期变化，模块绝不能硬编码客户列，必须按"当前周期实际出现的客户"动态渲染。**

### 1.6 数据结构归纳（一张图）

```
Workbook (下单表)
 └─ Sheet = 一个报单周期 (period)
      ├─ 冻结列: [条码, 规格, 简称, 分销价格, 永辉代码]   → 商品主档
      ├─ 客户列×N: [唐成, 黄家伟, ...]                    → 交叉数量矩阵 (units × rows)
      ├─ 计算列:   [合计, 件数, 最终下单, 单价, 下单金额]  → 行级聚合 (前端实时算)
      └─ 总合计行:  跨商品再按客户汇总                       → grand total
```

---

## 二、与现有预报模块的字段映射

现有模块数据模型（实测 `Forecast.vue`）：
`cross = { period, units[], rows[], colTotals[], grand{} }`
- `units` = 报单单元（**= Excel 客户列**）
- `rows` = 商品行，`r = { product_id, name, barcode, spec, unit, sale_price, purchase_price, safety_stock, expiry_days, qtyByUnit{} }`
- `r.qtyByUnit[unitName]` = 交叉单元格（**= Excel 某客户列某商品行的值**）

| Excel 列 | 模块字段 | 说明 |
|---|---|---|
| `条码` | `r.barcode` | 商品唯一标识（与 `products.barcode` 关联） |
| `规格` | `r.spec` | 件规（用于 合计÷规格=件数） |
| `简称` | `r.name`（含"XX下单"后缀） | 显示名；下单人后缀可拆为 `r.order_by` 子属性 |
| `分销价格` | `r.sale_price`（分销口径） | 注意：≠ 模块现有"标准售价"，需区分口径 |
| `永辉代码` | `r.external_code`（新增字段） | 客户系统商品代码，落 `products` 扩展列 |
| `唐成`…`美联保康` | `cross.units[].name` + `r.qtyByUnit[name]` | 动态客户列 |
| `合计` | 前端 `sum(r.qtyByUnit)` | **实时计算**，不存储 |
| `件数` | `合计 ÷ spec` | 实时计算 |
| `最终下单` | `r.final_qty`（新增，可编辑） | 默认 = 件数，人工覆写 |
| `单价` | `r.unit_price`（新增，对内成交价） | 默认取 `sale_price` 或历史，可编辑 |
| `下单金额` | `r.unit_price × r.final_qty` | 实时计算 |
| `订单排期` | `r.schedule`（新增，可选） | 备注类 |

---

## 三、层级组织方案（与现有结构保持一致）

### 3.1 三层对齐
1. **周期层 (period)** — 对应 sheet。模块已有 `periods` + `curPeriod`，无需改；sheet 名解析为 `order_start/order_end/arrival_date` 即可一键建周期。
2. **商品层 (rows)** — 对应冻结列 + 商品主档。继续走已上线的 `productsApi.bulkUpsert`（粘贴/录入商品名/条码/规格/售价/进价）。
3. **客户交叉层 (units × qtyByUnit)** — 对应客户列。这是本次对齐的核心：把 Excel 的客户列直接映射为 `units`，单元格映射为 `qtyByUnit`。

### 3.2 动态客户列渲染（对齐 1.5 的演化约束）
- 进入某周期编辑时，`units` 由**该周期已存在的数据 + 用户新增**决定，不写死。
- 编辑表顶部保留「＋客户」按钮（复用现有 `addUnit()`），输入客户名即新增一列——与 Excel 加列等价。
- 粘贴 Excel 时，若表头含未知客户名，自动追加为 `units`（复用现有 `importApi.preview` 的 `customer` 兜底识别）。

### 3.3 计算列实时化（对齐 1.3）
- `合计 / 件数 / 下单金额` 全部改为**前端 computed**，不落库（避免和 Excel 一样存冗余值导致不一致）。
- `最终下单 / 单价` 作为**可编辑覆盖字段**落库（`final_qty`、`unit_price`）；未填时前端回退到 `件数 / sale_price`。

---

## 四、具体实现步骤

### 步骤 0：后端补商品扩展字段（1 次性迁移）
`server/erp_db.py` tenant 补丁循环给 `products` 加：
- `external_code TEXT`（永辉代码）
- `dist_price REAL`（分销价格口径，与 `sale_price` 标准售价区分）
> 注：`sale_price` 现有语义是"标准售价"，与 Excel「分销价格」不同维度；保留两者，UI 标注清楚。

### 步骤 1：后端交叉表保存支持 `final_qty` / `unit_price`
- `routers/data.py` 的 `save_matrix` 入参 `rows[].final_qty`、`rows[].unit_price` 落 `forecast_cross` 表（已有表结构，加两列即可）。
- `forecast_submission_summary` 已能返回 `sale_price/purchase_price`，追加 `unit_price/dist_price` 用于金额计算。

### 步骤 2：前端 `Forecast.vue` 数据模型扩展
`r` 行对象增加：`external_code, dist_price, final_qty, unit_price, schedule, order_by`（从 name 后缀解析）。
新增 computed：
```js
rowTotal(r)  = sum(Object.values(r.qtyByUnit))        // 合计
rowJianshu(r)= rowTotal(r) / (parseFloat(r.spec)||1)  // 件数
rowAmount(r) = (r.unit_price||r.sale_price) * (r.final_qty ?? rowJianshu(r))
```

### 步骤 3：编辑表模板扩展（复用现有 Excel 式网格）
在已上线的可编辑表里，冻结区加 `external_code / dist_price / unit_price / final_qty / schedule` 输入框；客户列右侧加「合计 / 件数 / 最终下单 / 下单金额」只读计算列（CSS 用 `.calc` 样式，已存在）。

### 步骤 4：粘贴识别增强（`onPaste`）
现有 `HEADER_KEYS` 追加：`'永辉代码':'external_code'`、`'分销价格':'dist_price'`、`'最终下单':'final_qty'`、`'单价':'unit_price'`、`'订单排期':'schedule'`。
> 这样用户直接把整张舟谱表（含客户列）复制进来，表头自动识别、客户列自动建、数量自动填。

### 步骤 5：列表/只读视图增加计算列
`cross-area` 只读表（line 302+）在客户列后追加 `合计 / 件数 / 最终下单 / 下单金额` 四列，与 Excel 视觉一致；`总合计` 行复用现有 `colTotals` + `grand` 渲染。

### 步骤 6：导入器对齐（`import_router.py` `forecast_cross`）
- 客户列识别逻辑已能兜底为 `customer`；确认 `分销价格/永辉代码/最终下单/单价` 映射到上述新字段。
- 导入后 `loadCross()` 自然呈现完整交叉表。

### 步骤 7：一键"从舟谱表建周期"
新增：解析 sheet 名 `8月14报单-8月18到货` → 自动建 `period`（order_start=8/14, arrival=8/18），或上传整 xlsx 时按 sheet 批量建周期+导入。
> 这是"与现有结构保持一致"的最后一公里——让历史 69 个周期 sheet 一键迁移进系统。

### 步骤 8：真机 E2E 验证（沿用今日已验证的 puppeteer 无头方案）
登录 boss → 预报模块 → 编辑 → 粘贴一张含客户列的小表 → 保存 → 断言 `products` + `forecast_cross` 落库、`合计/件数/金额` 计算正确。

---

## 五、需要你拍板的两个口径问题

1. **「分销价格」vs「标准售价」**：Excel 的 `分销价格` 是给下游客户的指导价，模块现有 `sale_price` 是标准售价。两者是否都保留？建议**保留双字段**（分销价 + 成交单价），UI 标注清楚。
2. **「XX下单」子行**：同一条码多行（恒滋/福宝下单）是否合并为一行、用 `order_by` 区分？还是保持拆行（与 Excel 一致）？**建议保持拆行**，最贴合你现有习惯、零迁移成本。

---

## 六、与战略的一致性
- 本方案**只动 AI 层预报模块**，不碰交易系统；数据仍经 `products`（商品主档）+ `forecast_cross`（交叉数量）两张表，符合"AI 层不造 ERP"基线。
- 粘贴/录入的商品主档继续走 `productsApi.bulkUpsert`（`source='web_grid'`），与现有 Excel 导入并存。
- 客户列动态化 = 配方化差异（不同经销商客户集合不同），正是护城河所在。

---

## 附：源表字段速查表（直接给开发用）
```
冻结列: 条码(barcode) | 规格(spec) | 简称(name+order_by) | 分销价格(dist_price) | 永辉代码(external_code)
客户列: 唐成..美联保康 (动态, → units + qtyByUnit)
计算列: 合计(=Σ客户) | 件数(=合计/spec) | [枣阳/成丽/加单 特殊调整列] | 最终下单(final_qty,可编) | 单价(unit_price,可编) | 下单金额(=单价×最终下单) | 订单排期(schedule)
汇总行: 总合计 (跨商品按客户再求和)
```
