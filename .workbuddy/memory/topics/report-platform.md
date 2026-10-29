# 报表平台（配置驱动报表）· v723/v724

**触发场景**：动 `/reports/*` 任一条、要加/改一张报表、怀疑"报表数据不对"、想给报表加筛选。

## 结构（一句话）

一张报表 = `report_definitions` 里的一行（`sql` + `columns_json` + `filters_json` + `total_row_json` + `note`）。
前端只有一个 `src/pages/reports/GenericReport.vue` 服务 29 条路由，按 `route.meta.reportName` 取数。**加一张报表 = 插一行定义 + 在 `constants/pages.js::REPORT_PAGES` 插一行**，不改 Python、不改 Vue。

端点（`routers/report_engine.py`，`/api/reports` 前缀 ⇒ RBAC 自动归 `reports` 模块）：
- `GET /defs` 清单（**不含 SQL**）
- `GET /def/{name}` 元数据（列/筛选/note/max_rows，**不含 SQL**）
- `GET /def/{name}/data` 执行

## 六层防护（改执行器必读）

1. 只读连接 `mode=ro` → 回落 `mode=ro&immutable=1`（WAL 缺 `-shm` 时前者必失败）。
2. 单条 SELECT/WITH：去尾分号、正文出现 `;` 拒、首词必须 select/with。
3. 关键字黑名单：insert/update/delete/drop/alter/create/attach/detach/pragma/vacuum/reindex/analyze/load_extension/writefile/readfile/fts3_tokenizer。
4. **敏感表禁访必须逐标识符**（表会藏在 JOIN / 子查询 / 逗号连接 / CTE 里，不能按位置判）：`sessions/users/api_tokens/…` 精确名 + `token|password|secret|credential` 子串。生产 13 张禁表里真实存在 8 张 —— 判据要对着真库断言，别假设。
5. 参数绑定：SQL 里出现未声明的 `:name` 直接拒。
6. `MAX_ROWS=5000` + `set_progress_handler` 10s deadline。

## 口径铁律（与账务域共用）

- 收入 = **`SUM(soi.amount)`**（明细成交额），**不是** `so.total_amount`（在"订单 LEFT JOIN 明细"行粒度上聚合会重复累加，生产实测虚增 1241.8%）。
- **行级绝不做 `ROUND(...,2)`**：先舍入再求和 = 第二套数字。实测三张销售报表给出 8786106.89/8786107.64/8786107.65，而 BI 是 **8786107.59**。全精度存，SQL 对完整结果集求和一次。
- 排除 `order_type='transfer'`（251 张，金额 0 成本 55.16 万）。
- **合计由后端算**（`SELECT COUNT(*), SUM(col) FROM (原SQL)` 子查询），前端绝不自己对 `rows` 求和 —— 截断时会静默变成"本页合计"，界面看不出差别。

## 三态必须分开（前端）

| 态 | 表现 | 判据 |
|---|---|---|
| 未配置（404） | 「这张报表还没有配数据口径」+ 明写「**不是"没有数据"，而是"还没定义怎么取数"**」，**不渲染表格** | `notConfigured` |
| 截断（>5000） | 橙色横幅「共 N 行，只显示前 5,000 行，**合计是全部 N 行算出来的**」 | `truncated` |
| 空数据 | 「当前日期范围内没有数据，换一个区间试试」 | rows.length=0 且非前两态 |

## 两个已踩过的坑

1. 🔴 **组件复用 29 条路由 ⇒ 必须按页面重置全部展示态**。v723 只重置了 columns/rows/totals，没重置 `title` ⇒ 从「客户销额排名」切到未配置的「汇总报表」，未配置卡片写的是**上一张报表的名字**。只在"上一张配了、下一张没配"路径出现，配了的那张会被服务端 title 覆盖回来盖住问题。修法：`resetForRoute()` 清 title/subtitle/columns/rows/totals/filters/note/elapsedMs/maxRows/日期。
2. 🔴 **枚举值列先 `GROUP BY` 再决定显不显示**。销售订单汇总的「状态」列 WHERE 已写死 `status IN ('delivered','signed')`，生产 22,505 张里 22,504 张是 `signed` ⇒ 这一列**永远同一串英文**，纯噪音；已整列删掉并在 note 说明。仓库列同理：原来是 `warehouse_id`（显示"3"），已改 `LEFT JOIN warehouses` 出名称，取不到写 `仓#id`、都无写「未指定」。

## 生产现状（2026-10-28）

- 已配 8 张：sales-order / purchase / transfer / ar-summary / receipt-detail / payment-detail / customer-rank / goods-sales。其余 21 张显示未配置态。
- 对账：销售订单汇总 22,254 行 / **8,786,107.59**（= BI 基准）；9 月 2,343 行 / 1,128,410.51；客户排名 426 行；商品销售 229 行；采购 13 供应商；应收 181；调拨 1。
- 🔴 **生产 10 月 0 张销售单**（舟谱数据只到 9 月）⇒ 验筛选别用「本月」，0 行也能 PASS，会把"筛选没绑上"伪装成通过。用 9 月。
- 🔴 **调拨有两套入口**：`transfer_orders`（模块表，生产仅 **1 张草稿**）vs `sale_orders.order_type='transfer'`（舟谱导入 **251 张**）。报表读前者、与 `GET /api/reports/transfer-summary` 一致；合并与否是业务口径决定，**未擅自改**。
- 迁移：`0006` 建表 + 种子；`0007` 修正 sales-order / transfer 的显示口径（绝对值 UPDATE，副本连跑三遍逐字节不变）。**改种子 SQL 必须出新 patch，别原地改 `0006`**（checksum 会拒）。执行器对定义**零缓存** ⇒ 改数据即时生效、不用重启。

## 验证工具

- `hergent-cn-v2/tools/v723-reports-e2e.mjs` —— 真机 41 项（CDP 驱动真实 Chrome，生产前端 + 生产租户只读）。跑法：`PROBE_TOKEN=<token> PROBE_TENANT=1 node tools/v723-reports-e2e.mjs`。
- `hergent-erp/server/tools/hergent/v724/verify_0007.py` —— 副本上验迁移（幂等三遍 + 反向对照）。跑法：`ERP_SECRET=x ERP_DB_PATH=<副本> python3 tools/hergent/v724/verify_0007.py <副本>`。**不要在生产库路径上跑**（会 `import erp_db` 触发 389 条迁移）。

## v725（2026-10-28 晚）：全配 21 条 + 调拨合并 + 报表设计器 —— **本段取代上文「已配 8 张」**

**生产现状**：三库 `report_definitions` 均 **29 条**（`kind` = sql 26 / unavailable 3）、`is_seed=1` 全 29。前端 **v658**。交付文档 `hergent-erp/docs/v725-全配21条报表与报表设计器-2026-10-28.md`（含 5 张验收截图）。

### 从 ERPNext 借的三件事（`~/frappe-bench/apps/frappe/frappe/desk/query_report.py`，940 行）

1. **`add_total_row` 是整表一个布尔**（`query_report.py:572`），合计哪些列由 **fieldtype** 自动定：只累加 `Currency/Int/Float/Percent/Duration`。别做逐列勾选框。
2. 🔴 **百分比求算术平均不求和**（`query_report.py:588` `total_row[i] / len(result)`）。我们第一版按 SUM 加总 ⇒ `customer-profit` 毛利率合计 **6,299.55%**、`customer-profit-analysis` **113,413.81%**。改 `_agg_fn()`（Percent→AVG）后 14.79% / 10.9%。**这条数字一上屏报表公信力就没了。**
3. **fieldtype 体系**（Data/Int/Float/Currency/Percent/Date/Datetime/Select/Link/Check/Duration）+ 旧土名别名映射（`_TYPE_ALIAS`），老定义不改也能跑。对齐/格式化/合计三处全由类型推。

### 自动合计造出的假数字（6 张改显式 `total_row_json`）

`other-inout` 结存加总 389,861｜`online-receipt` 余额加总 12,951（真实 11,402.41）｜`staff-profit` 客户数 590（真实 426）｜`presale-goods` 报单数 307（真实 168）｜`visit-achv` 客户数虚高｜`account-flow` 干脆不出合计行。
根因只三类：**结存快照跨行相加无意义**、**去重数可加就重复算**、**已平均过的列再加一次**。
⇒ 判据：算出来的合计要跟「业务上可能的值」对，不能只看有没有合计行。互补断言：14 条「不该合计的列必须真的没进合计」+ 4 条反向对照（否则「没合计」和「压根没配合计」无法区分）。

### 三态变四态

新增 `kind='unavailable'`（200 + `reason`）≠ 404。「本产品没有这个模块」与「还没配口径」是两件事，文案必须分开：前者写「入口是预留的，等模块上线自动出数」。现有 3 条：`material-data` / `material-usage` / `stock-upload`（本产品无物料表、无门店库存上报表）。

### 调拨合并（老板拍板「合并」）

`transfer_orders`（1 张草稿）UNION ALL `sale_orders where order_type='transfer'`（251 张 / 3,440 行），加 `source` 列。🔴 **舟谱那批只有 `warehouse_id`（调入仓，分布 3/9/7）、没有调出仓** ⇒ 调出仓写死「未记录」**绝不拿仓号冒充**；装卸费 ¥0.00 是原系统真实值（写进 note），不是漏配。

### 报表设计器 `/reports/builder`（「要」）

四道门：`_require_boss()` 只 boss/admin（菜单 `lock:true`）｜`_prepare_definition()` **强制试跑**，错 SQL 转 400 而非 500（`if e.status_code>=500: raise HTTPException(400,...)`）｜列 key 用 `cur.description` 真实输出列比对（用 `res["columns"]` 比对**必然通过 = 判据形同虚设**）｜`db.audit_log()` 哈希链留痕。
接口：`GET /api/reports/def/{name}/raw`（唯一吐 SQL 的接口，`_meta()` 永远不含 sql）、`POST /api/reports/preview`、`PUT /api/reports/def/{name}`（置 `is_seed=0` 后 patch 不再覆盖）、`POST /api/reports/def`（name `^[a-z][a-z0-9-]{1,40}$`，重名 409）。

### 真机逼出来的两个 UI 缺陷

1. **KPI 卡按后端顺序取前 4 会把「毛利」挤掉**（客户利润列序 订单数/销量/销售额/成本/毛利/毛利率）⇒ 按 `KPI_RANK = {Currency:0, Percent:1, Float:2, Int:3}` 排序后取 4，顺带让「明细行 139,419」这种条数沉底。
2. 🔴 **日期/金额被压成两行**（9 列挤：「2026-09-\n23」、金额断在逗号前后）⇒ `nowrapOf(c)`：Date/Datetime/数值 `white-space:nowrap`，文本列保持可换行。**th / td / tfoot 三处都要加**。
   - 附：C5 判据第一版漏减 padding，拿 `getBoundingClientRect().height` 直接比 `lineHeight` ⇒ 40 行全报折行而截图明明一行。**假 FAIL 比不判更坏**（会让人去改没坏的代码）。正解：`height - paddingTop - paddingBottom` 比 `lineHeight*1.3`。

### 超时与性能

`TIMEOUT_S` 10.0 → **20.0**：`customer-profit-analysis` 实测 8.4 秒（主查询 + 合计各约 4 秒，10,407 组），10s 会随机超时 ⇒ 用户看到「有时能看有时报错」。

### 验证三层（都过）

副本 `tools/hergent/v725/verify_0009.py` **58/58**（刻意不 import `report_engine`：会连带 import `erp_db`，模块导入期就跑 389 条迁移=写生产）｜真实 API **63/63**（抓到 2 个真 bug，见上）｜真机 `tools/v725-reports-e2e.mjs` **59/59**（29 页逐条 + fieldtype 生效 + 调拨合并 + 未启用态 + 设计器 E1–E9 + 控制台 0 错误）。

## v726（2026-10-28 深夜）：报表图表化 —— 6 张报表出图 + 设计器可配图

**生产现状**：三库均 29 条定义、其中 **6 条配了图**（`chart_json` 非空）。前端 **v663**。交付文档 `hergent-erp/docs/v726-报表图表化-2026-10-28.md`。验证：副本 28/28、写路径 14/14、真机 23/23。

### 照 ERPNext `dashboard_chart.py` 借的三样

1. 输出结构 `{"labels":[...], "datasets":[{"name":...,"values":[...]}]}`（:283-286）
2. 分组语义 `AGG(取值) GROUP BY 分组 ORDER BY 值 DESC`、`Sum/Count/Average→SUM/COUNT/AVG`（:269-280, :290）。**横轴非日期列按值排名，日期列按时间排**（两条路）。
3. 🔴 **时间序列必须补零**（:300）：没卖货的那天画 0，不能跳过日期 —— 跳过去看起来像"数据丢了"。**有意偏离**：ERPNext 按筛选起止铺满，我们只按结果 min/max 之间补（筛选常给整年、数据只有两月，铺满会画出 300 个 0，那才是误导）。

### 🔴 图表必须跑独立聚合，不能用 rows

`rows` 被 `MAX_ROWS=5000` 截断 ⇒ 拿它聚合 = 画「前 5000 行」的图而标题写全量。独立查：`SELECT x, AGG(y) FROM (原SQL) GROUP BY x ORDER BY ... LIMIT n`。
判据（副本）：全量 8,786,107.59 / 前3行 1,723,886.22 ⇒ **不限组时图合计逐分等于全量**才算证成。
护栏：图表自己 8 秒预算（`TIMEOUT_CHART_S`），失败只降级 `chart.error` 不拖垮表；主查询耗掉 55% 预算（`_CHART_SKIP_RATIO`）就放弃出图并说明。

### 图的诚实性（唯一需要判断而非照抄的地方）

| 图形 | 纵轴 | 理由 |
|---|---|---|
| 折线 | **不从 0 起，图注必须写明「纵轴未从 0 起」** | 61万→112万 从 0 起是一条水平直线，图白画 |
| 柱/条/环 | **必须从 0 起** | 长度与角度编码必须从 0，否则"两倍长"是假话 |

### 🔴 同一个 bug 可能有两层（本轮最贵的教训）

「折线是平的」修了两轮：
- 第一层：`yMin = zeroBase || dataMin>=0 ? 0 : niceMin(...)` —— 数据全正时**无论如何从 0 起**，`zeroBase=false` 只对含负数的图有效。
- 改完**还是平的**，才查数据源：`dataMin` 初值 `let m = 0` ⇒ `Math.min(0, v)` 对全正数据**恒为 0** ⇒ 任何"从下界起"的取法都拿到 0。
- 新增 `niceFloor()`（向下取整齐值，正数也适用；`niceMin` 对正数直接返 0 等于没改）。
- **纪律：修完判据要验链路每一环，不能只改最外层 if。** 这次是靠「用户可见结果仍然是平的」发现的，不是靠读代码。

### 另两个真 bug（真机截图逼出来的）

1. **横轴最后一个标签被裁**：`2026-09` → `2026-0`。`ChartLine` 标签全 `text-anchor="middle"`，末点在 `W-PAD.r`(18px) 处，7 字符日期宽 44px ⇒ 右半 22px 溢出。修：首标 `start`、尾标 `end`、中 `middle`。**不改 PAD.r**（会压绘图区、影响所有既有调用方：Dashboard/返利）。Dashboard 没暴露是因为标签 5 字符。
2. **横条图商品名截太狠**：`nameW` 默认 116px 只露出「蒙牛低脂高钙原味CD…」。走 **prop 放宽到 168**，不改组件默认值。

### 又是判据写错（本轮 3 次，第 22 条同族）

| 判据 | 错在哪 |
|---|---|
| 「没配图不留占位」只判 `table`+`.gr-hollow` | 漏 `.state-empty`（表在但 0 行）⇒ fee-summary 误判 FAIL |
| 「图按 SQL 顺序 3 组」 | 横轴列是 `Data` ⇒ 走按值降序排名（正确行为） |
| `sum(...) limit 3` 当截断合计 | limit 作用在聚合后单行 ⇒ 等于没截断，对照假 PASS ⇒ **核心断言失去证明力**。正解 `sum(select ... limit 3)` |

### 设计器

`/reports/builder` 新增「图表」区块（类型/横轴/纵轴多选/聚合/取前N/标题），试跑即出图预览。`_norm_chart(strict=True)` 配错 **400 并指名哪一列**（绝不静默不出图）。写路径已端到端验：建图→出图→改日期列→补零→去图→图消失→配错400→清理残留 0（`tools/hergent/v726/verify_write_path.py`，14/14）。

### 未用/未做

`donut` 类型已支持但还没人用（适合"按仓库/按品牌占比"）；多纵轴未做（同量纲族限制）；排名不做「其他」归并（会混量纲，图注已写「只显示前 N 组」）；另 20 张报表未配图（插一行 `chart_json` 即可，不改代码）。

## 2026-10-29：⑤ 状态验证（faithful 复刻执行器）

生产 `tenant_1.db` 29 条定义，faithful 复刻 `validate_sql` + `_build_params`（声明参数 + 默认值 + 只读 `mode=ro&immutable=1` 连接）逐条实跑：

- **26 张返回真实数据**：account-flow / customer-profit-analysis / sales-order 三张大表截断 5001 行。
- **3 张 `kind=unavailable`**：material-data / material-usage / stock-upload（前端显「未启用」，无 SQL，属有意预留）。
- **0 拒绝、0 报错**。
- 此前"25 张报 `Incorrect number of bindings supplied`"是**带参 SQL 用 `SELECT COUNT(*) FROM (<sql>)` 空跑、未绑定参数**的测试假象，非执行器行为——执行器 `_build_params` 必为声明过的每个 `:name` 补默认值，不会缺绑定。

**4 张返回 0 行（执行正常、源表空，疑似口径指错表）**：income-summary(`income_orders`) / receipt-detail(`payment_receipts`) / payment-detail(`period_payments`) / attendance(`attendance`) —— tenant_1 这些表无数据；真实收入来自签收单 `signed` 等。待核对重定向源表（属业务口径，不擅自改）。

**前端 ⑤ 真身已部署 hergent.cn**：modules.js 加 `reportEngineApi`、GenericReport.vue（29 路由通用渲染：三态/合计/图表/截断提示）、ReportBuilder.vue（老板门禁设计器）。本地工作树已写，待 commit。

**🔴 后端源码丢失风险（必读）**：`routers/report_engine.py` 仅在生产 `/opt/hergent-erp`（routers/ + db/ 包结构，导入 `core` / `db.connection` / `erp_db`），本地仓库 `server/` 仍是旧扁平结构（无 routers/、db/、core.py），未含执行器。需先对齐本地与生产包结构再回收源码，否则落本地无法 import（也别在生产随意 `import` 触发 389 条迁移）。
