# 品牌数据源 与 小程序「小赫智体报单助手」（细节存档）

> 从 MEMORY.md 下沉。核心结论已留在主记忆，本文件保留完整细节。
> ⚠️ 小程序**现名「小赫智体报单助手」**（2026-09-15 备案驳回后改定）；旧名「小赫 AI 报单助手」**已作废**
> —— 备案明确「名称不能有 AI 字样」，材料里写的"含 AI 可由经营范围背书"已被驳回证明不成立。
> 主体 = **湖北省小赫智体数字科技有限公司**（企业，法人张俊峰），AppID `wxf8ce9b8e4b5693be`。

## 品牌数据源两套（v130）
- **规范层** `brands` 表（品牌档案） vs **派生层** `products.brand` 自由文本（预报品牌筛选用，去重派生，随期次变）→ 两者数量不一致**是设计使然**，非 bug。
- 品牌目标/达成实际落在 `rebate_target_rules` / `rebate_achievements`，不是 `rebate_rules`（后者在所有租户库均为 0 行，别拿它排查品牌口径）。tenant_1 的 `scope_key` 只有 `蒙牛低温` / `简爱` → 归并脏值不破坏返利。
- 品牌待审 UI **早已存在**（`BrandArchive.vue` 待审卡片 + `resolve()` create/merge/dismiss）；`dismiss` 只标记 resolved，**不改 `products.brand`**，脏值仍会出现在预报品牌筛选中。
- 待审队列需**显式回填**才有数据：`track_brand` 只在商品保存/导入时触发，历史商品不会自动入队（v130 已用 `source='backfill'` 灌入 13 组）。
- v130 建表修复：`brand_pending` 曾在 tenant_1 缺表致 `/api/brands/pending` 500。

## 小程序（forecast-order-miniprogram）
- AppID=`wxf8ce9b8e4b5693be`；类目「商业服务→企业管理」（首选「工具→效率」以绕开食品证与电商商家自营审核）；企业内部订货工具（销售/主管用，不对外）。
- 提审测试账号：sales=`mptest/Mptest@1`、supervisor=`mptestsp/Mpsup@1`（绑定永诺旗舰店）。Web 与小程序共享同一后端，**11 个接口被小程序调用** → 后端改动必须避免破坏性兼容。
- **订单落库 `order_date` = 期次 `order_start`**（非提交当天）→ 必须按期次窗口查询。`pending`=已提交、`approved`=已定稿；「审批预报单」已下线。报单提交即计入汇总。
- 后端已知缺陷：(1) `_hpw` 密码哈希因 ERP_SECRET 占 64 字节 → 密码实际最长仅 8 字符；(2) `_DEFAULT_PERMS` 缺少 supervisor 角色，需手工补 `role_permissions`。
- 🔴 **报单「修改日志」现状（2026-09-15；纠正：是 Web 端，不是小程序）**：
  - 用户诉求 = Web 端「本期预报」**汇总表**的修改留痕，要能看到**修改人**（文员改的 vs 业务经理改的）。小程序一人一账号，不需要。
  - ✅ **功能已存在**：`Forecast.vue:819` 汇总表工具箱「更多」组已有**「审计」按钮** → 打开 `P9-6 改动留痕审计` 面板（`Forecast.vue:941-947`）；后端 `GET/POST /api/forecast/audit`（`routers/forecast_config.py:443-465`），数据存在租户库 KV `audit:{period_id}`（`_get/_put`），**已持久化**。
  - ❌ **核心缺口 = 无"修改人"**：`forecast_config.py:432 _append_audit()` 第437行 `"by": "system"` **硬编码** → 每条留痕的人恒为 system。正确取法见同文件 `auth_user_name(request)`（:396）与 `who = u.get("username") or ...`（:96/:137/:197）。
  - ⚠️ 覆盖面窄：前端仅 `Forecast.vue:2511` 一处 `recordAudit('save_changes', ...)`；后端另有 6 处 `_append_audit`（factory_price_gate / approval / connector_writeback / purchase_order_push / intervention / hermes_analyze）。
  - ⚠️ 可见性弱：按钮藏在「更多」折叠组、名为「审计」（用户认不出=日志）；面板只渲染 `at · action · detail`，**不显示 by**。
  - **推荐位置 = 汇总表页头工具栏**（日志是 per period 整表级、非单行级，故工具栏对、行操作区不对）。实施 = 后端 `_append_audit` 加 `who` 参数 + 7 个调用点传真实人 + 前端面板显示 `by` + 按钮改名「修改日志」并从「更多」提升。
  - （附带事实，与本需求无关）小程序 `forecast_submissions` 无 updated_at、提交是"删旧建新"覆盖，**小程序侧无修改留痕**——若将来小程序也要，才需另建表。

## ⭐ 小程序报单 → Web「本期预报」数据链核查（2026-09-12 实测）
- **接口层通**：`POST /api/forecast-submissions` 写 `forecast_submissions`+`_items`，`order_date = period.order_start`；Web `GET /api/forecast-submissions/summary?start=period.order_start&end=period.order_end` 按**日期区间**读（**不按 period_id**），过滤 `status NOT IN ('rejected','recalled')`。活体实测 mptestsp(tenant 1) 取回 4 行且 `sources=永诺旗舰店` ✅。
- 🔴 **断点 1（最易被误判成"没同步"）**：`/api/forecast/periods` 的 `current=None`（期次全 closed 时）→ 前端 `curPeriod=0` → `loadCrossGrid()/loadEditGrid()` 兜底成 `{order_start: 今天, order_end: 今天}` → 报单落期次窗口、视窗停在今天 → **默认视图空表**（实测 `summary?date=2026-09-12` rows=0）。必须手选期次才可见。
- 🔴 **断点 2**：`/api/products/grid` → `product_list()` 默认 `include_inactive=False` → 只回 `is_active=1`（tenant_1：269/430）。而 `Forecast.vue` 交叉表与编辑网格的行**严格由 `prods.items.map()` 生成、无兜底追加** → **报单里停用商品的数量与合计被静默丢弃**（期次 9 实测 4 个报单商品中 1160/1196 停用 → 2 行消失）。
- ⚠️ **跨期重复计入**：汇总只按日期区间，期次窗口可重叠（期次 9 `08-30~09-15` 包住期次 10 `09-03`）→ 同一笔在多个期次视图重复出现。
  ✅ **2026-09-15 已收敛**：全站改双口径 `(period_id=? OR (period_id=0 AND order_date BETWEEN ? AND ?))`，覆盖 7 处调用点（报单幂等键 / save-matrix 解析+清理 / 催单 / 首页 TOP3 / 看板 `_agg` / 期次默认兜底 / **级联删除**）。后端 `d223e38`、前端 `31eb8da`。详见 `forecast-order-domain.md`。
- ⚠️ 幂等键 = `(user_id, store_id, order_date)`，**不含 period_id**；同一 order_start 的两个期次会互相覆盖。
  ✅ **2026-09-15 已加 period_id**（同上 commit）。
- 报告：`核查-小程序报单落Web本期预报-2026-09-12.md`。

### 决策与落地（2026-09-12 晚，用户选 1a / 2b；3 待定；4 不做）
- **1a 已上线（断点 1 消除）**：新增 `erp_db.forecast_period_default()`，**不动** `forecast_period_current()`——后者被 `forecast_audit.py:449`（Web 补录自动挂期次）与 `hermes_core.py:711`（AI 工具）两处**写路径**依赖，放宽会静默改落库归属。优先级：窗口内 open → 最新 open → **最近有报单数据的期次** → 最新创建。`GET /api/forecast/periods` 的 `current` 改用它。生产实测：`current` 由 `None` → 期次 9，默认视图 `summary` rows 由 0 → 4。
- **2b 已上线**：两处选品接口（`/products/fill-search`、`/forecast-audit/products`）**本就过滤 is_active**；真缺口在**提交接口不校验** + 「一键带入上次报单」会带进后来被停用的商品。已在 `routers/forecast_submissions.py` 落库前剔除停售明细并回传 `skipped_inactive`；全被剔除则 `400 所选商品已停售：…`；主档查询失败则**不剔除**（防误杀整单）。小程序 `fill.js`：弹窗提示跳过项 + 从「上次报单」快照剔除（避免下次带入又被拦）。
- **b 的固有残留（须告知用户）**：① 已入库的停售商品（1160/1196）**仍不显示**（选 b 即不做"追加标记行"）；② **报单之后**才被停用的商品，那笔数据在交叉表里消失。
- **3 已上线（2026-09-12 晚，用户选「做」）**：汇总口径改**双口径** —— `(s.period_id=? OR (s.period_id=0 AND s.order_date BETWEEN ? AND ?))`，新数据按期次号精确命中、历史 `period_id=0`（tenant_1 共 60 条 Excel 导入）回退日期窗口；**不传 period_id 则行为与改动前完全一致**。口径**刻意复用** `routers/forecast_config.py::accuracy` 的 A7 双口径，保证多处统计同源。改动 5 处：`erp_db.forecast_submission_summary(+period_id)`、`/forecast-submissions/summary(+period_id 查询参)`、`/forecast-audit/audit-period(读 body.period_id)`、`api/modules.js::forecastApproveApi.summary(第4参)`、`Forecast.vue` 5 处 summary + 1 处 auditPeriod 传 `.id`。`all_units` 与 `forecast_audit_decisions`/`forecast_extra_qty`（日期键）**未动**。
- 🔴 **顺带修掉一个「侥幸正确」隐患**：`summary_params = list(date_params) + decision_params` 顺序**反了** —— `decision_join` 的 ON 条件在 `FROM/JOIN` 段、位于 `WHERE` 之前，参数应先 decision 后 date。此前两者值恰好都是 `[start,end]` 所以侥幸正确；`date_params` 变 3 个后错位暴露（带 `period_id` 查询返回 **0 行**，活体测试抓到）。已改为 `list(decision_params) + list(date_params)`。**教训：活体调用是唯一能抓到这类"参数顺序依赖巧合"的手段，SQL 级对照实验抓不到。**
- **验证证据**：副本对照（构造 `qty=7/period_id=10/order_date=2026-09-03`）→ 旧口径 期次9=11+期次10=7=**18（重复 7）** vs 新口径 期次9=**4**+期次10=7=**11（准确）**；完整 SQL（含 JOIN，真实拼接顺序）复跑 PASS。活体三方式（不带/带/只带 period_id）均 4 行 4 件一致。`audit-period` 带 period_id → `success:true`（`supervisor` 403 属既有 stock 模块权限，与本次无关）。前端 `Forecast-Ck9cJS7j.js`/`modules-DlXuIktL.js` 含 `r.push("period_id="+i)`，已上线、无旧 chunk；浏览器 0 console 错误；后端 health 200。
- **遗留（未改）**：① `datasource_adapter.py` 首页「本期待报 TOP3」仍按 `order_date BETWEEN`（用途不同，若将来重叠期次 TOP3 偏差则同款双口径修）；② `save-matrix` 期次解析按 `order_start+order_end+status='open'` 匹配，窗口完全相同的两期次取 id 最大者；③ 幂等键 `(user_id, store_id, order_date)` 不含 `period_id`。
- 报告：`期次精确归属-修复跨期重复计入-2026-09-12.md`。
- **4 未做**：不重开期次 9（测试阶段）。E2E 验证改用**临时建/删期次**（关闭→删除，用完即清，期次数与状态均已复原）。
- 报告：`本期预报默认期次与停售拦截-2026-09-12.md`。

## 报单域口径与「本期预报主表 / 导入模版」设计（2026-09-13，实读 4 份真实附件）
> 完整设计与证据索引见 `本期预报主表与报单导入模版设计-2026-09-13.md`。

### 口径三条（跨模块通用，勿混）
1. **报单数量 = 最小销售单位**（桶/组/条/瓶/包/杯…），**件数 = 数量 ÷ 规格**。实锤：附件3 刘善涛仓 `*订单数量` 合计 **1881** = 附件1 刘善涛列合计 **1881** → 下游单据要的就是最小单位数量；件数只是下单环节的中间换算量（可为小数，如 3.625）。
2. **渠道价按客户身份取，不是固定一列**：附件4（自提订单）168 行 100% 可解释 —— 分销客户（唐成/谢总/易胜玲/朱青峰/胡奎奎）取附件2 **G 分销价**、永辉门店（东津/吾悦/民发店）取 **H 永辉价**、美联（保康）店取 **J 美联价**。**下单环节完全不用渠道价**（附件1 的 I/J/K 三列整列 0 值）。
3. **「最终下单」必须取整**：`取整(件数, 方向) + 加单`，方向按商品配置（默认向上）。厂商不拆零发货。附件1 现实里 **116 行是 `=SUM(件数,加单)` 保留小数 + 43 行人工敲入**（偏差 −14~+198，第21/62/64/70 行 件数>0 但最终下单直接填 0）→ **该规则应做未做**。

### 附件1 的列结构（宽表 = 报单矩阵）
- 商品区 `A–K`（11 列）：厂家编码 / 永辉编码 / 条码 / 规格 / 简称 / **单位（整列空）** / 品牌 / **分销价格（公式 `=(厂价/规格)/0.9`）** / 永辉价(空) / 沃尔玛价(空) / 美联价(空)。
- 报单区 `L–AF`（**21 列，列头是人名/门店名**，格 = 该对象报给该商品的数量）。
- 下单区 `AG–AM`（7 列，**全部派生**）：`合计（最小数量）`（含换行）/ 件数 / 加单 / 最终下单 / 厂价 / 下单金额 / 订单排期。
- 🔴 **别信这张表的合计行**：`L161=SUM(L2:L109)` 只求到第 109 行而明细到第 160 行 → 王琴列显示 0、实际 136；7 个对象合计全偏小。**但附件3/4 的数量合计与明细实算 8/8、9/9 全吻合** → 拆分逻辑是对的，错的只有合计行。

### 建模陷阱
- **条码不唯一**：`6934665094026`/`6934665093944`/`6934665091254` 各 2 次（恒滋下单 / 福宝下单 共码）→ 唯一键须 `(period_id, barcode, brand)`。
- **附件2（价格表）没有「厂价」列** → 厂价独立维护，且**不能用「分销价 × 规格 × 0.9」反推**（该式仅 108/159 行成立，简爱系列完全不成立）。
- **17 个条码拿不到有效分销价**（10 个查无商品 + 7 个有商品无价）；附件2 单位无空值。
- **21 个报单对象里 4 个无下游单据**：黄家伟(0)、沃尔玛(0)、**美联檀溪(887)**、**汴河(345)**。

### 系统已有 vs 缺口（设计前必查，别另起一套）
- 已有：`report_mapping(report_alias / counterparty_type('store'|'customer'|'self_warehouse') / system_name / src_wh / dst_wh / order_template)`（`erp_db.py:609`，**就是 L–AF 列头字典**）；`routers/forecast.py:403 ZT_HEADERS / :409 DB_HEADERS / :421 _UNIT_HINTS / :468 _fetch_submissions`（**舟谱模板生成引擎**）；`forecast_barcode_units`（条码→单位）；`forecast_submissions/_items`；`products.purchase_price / dist_price / product_code`。
- 缺口仅 3：① 新增 `product_channel_prices(barcode, channel∈{dist,yh,walmart,meilian}, price)`；② `products` 补 `yh_code` + `order_rounding`；③ `forecast_extra_qty` 键由日期窗口改 `period_id`。（**第 4 个缺口 `products.factory_price` 已于 2026-09-13 晚补列并上线**，见下「厂价字段与付款口径」。）
- **表结构定稿**：主表 `forecast_period_items`（粒度 = **期次 × 商品** = 附件1 一行）+ 子表 `forecast_period_reports`（粒度 = **期次 × 商品 × 报单对象** = 一格）。**存储用长表、展示/导出用宽表**；附件3/4 是导出视图不落表。
- **导入模版定稿（宽表 · 三态标记，已上线 2026-09-13 晚）**：形态 = **宽表**（一行商品 × 一列报单对象，与附件1 同形），长表版已**废弃归档**。7 列三态：`商品条码(*)` 硬必填 / `商品名称(☆)`·`规格(☆)`·`单位(☆)`·`厂价(☆)` 条件必填 / `品牌`·`分销价` 选填（`*`=`C0392B` 白字、`☆`=`FFF2CC` 深黄字）。**条件必填的依据是附件1 自己单位列 159 行全空、渠道价三列全空** —— 连做了一年的人都不填的字段不要求新用户填；**但规格缺失会导致建档后算不出件数是例外**。**模版内刻意不含公式**（派生列由导入时算）。
  - **客户列不落静态清单**：由 `db.report_mapping_list()` 的 `report_alias` **下载时动态生成**（空则回退「示例客户1~10」）。生产实测末两列 = tenant_1 真实对象「美联保康 / 刘善涛」。
  - 实体样例：`~/Documents/舟谱导入模版/报单导入模版-系统生成样例-20260913.xlsx`（6628 字节，从生产取回）。已废弃的长表版在 `.本期预报-报单导入模版-v1.ref/`。
- ✅ **厂价字段与付款口径（2026-09-13 晚已修复上线）**：曾发现 `products` 建表 + 全部 `ALTER TABLE products` 都**没有** `factory_price`（只有 `purchase_price`/`sale_price`/`wholesale_price`），而 `routers/forecast.py:290,341` 注释写「×出厂价」、代码取 `COALESCE(p.sale_price,0)` → 「本期需付款」偏大且已推企微。**修复已落地**：`erp_db.py` 建表加 `factory_price REAL DEFAULT 0 CHECK(factory_price>=0)` + 迁移 `v132_products_factory_price`；`payments_compute`/`payments_preview` **两处同口径**改 `COALESCE(p.factory_price,0) AS fp, COALESCE(p.sale_price,0) AS sp`，Python 侧**厂价优先、缺则回退销售价并计数**。
  - 🔴 **回退行必须显式回报**：返回体 `price_stat = {factory_rows, fallback_rows, fallback_qty, caliber}` + 企微文案「N 个商品未录厂价，订单金额暂按销售价估算」。**若无回退则存量 SKU 厂价全 0 时「本期需付款」静默归零 —— 比偏大更危险。**

### ⭐ 零档案建档（2026-09-13 晚上线，用户核心诉求）
> 用户原话：「从新用户的角度出发…它可能只想用预报订单功能，所以就不想档案管理里去录入档案，直接到预报订单汇总表里点击『导入』下载导入模版，我们要做的是用户填好必填字段后，对应信息**直接落到商品档案**，且**要以条码为口径去重**。」

- **锚点 = 条码**，依据是**已有**的部分唯一索引 `idx_products_barcode ON products(barcode) WHERE barcode!=''`（v89）→ **不新增约束**。
- **`db.product_ensure_from_import()` 四态**（`server/db/queries/products.py`）：
  | 态 | 触发 | 行为 |
  |---|---|---|
  | `created` | 条码查无 | 新建，`source='forecast_import'` |
  | `reused` | 条码命中 | 只**回填空字段**（spec/unit/brand/factory_price/dist_price），**绝不覆盖已有值** |
  | `conflict` | 条码命中 + 名称不同 + 两边品牌都非空且不同 | **只报不建**，落 `db.log_barcode_conflict()` |
  | `skipped` | 无条码 / 新条码但缺名称 | 无条码时**只按名称精确复用、绝不新建** |
- 🔴 **「只补空」只有一份实现：`db.product_backfill_from_import(pid, …)`**（2026-09-13 晚修）。
  它只动 `spec/unit/brand/factory_price/dist_price`，**绝不碰 `barcode`/`name`**（条码是去重锚点，
  自动填会撞 `barcode!=''` 部分唯一索引）。两条路都必须走它：① `ensure_from_import` 的 `reused` 分支；
  ② **报单导入执行体在 `_match_product` 命中已有档案时**。
  ⚠️ 修之前路径 ② 只 `_prod_reused += 1` 就往下走 → **「老商品档案没厂价、这次导入行带了厂价」这个
  最常见的补价场景永远补不进去**，回执却显示「复用 N 个」（不报错、不提示）。回执现另有
  `products_backfilled` / `products_backfilled_count`。
  ⚠️ 单位 `'件'` 是建表默认值 → 属「已有值」，`只补空` 规则下**不会被导入行覆盖**（保守，正确）。
- 🔴 **建档/回填用的厂价只认「厂价列 → 通用单价列」，绝不用分销价顶厂价**（分销价 ≠ 厂价，误写进档案会让付款金额整体偏高）；行内金额估算仍保留三级回退（厂价→单价→分销价）。
- 配套：`db.product_get_by_barcode()`（精确查）；`product_create/product_update` 白名单加 `factory_price`（create 另加 `source`/`source_id`）。
- 导入返回体新增 `products_created_count` / `products_reused_count` / `products_backfilled(_count)` / `unmatched_products` / `barcode_conflicts`。**前端 `Forecast.vue` 导入弹窗已展示**（「自动建档 N / 复用已有 N / 补进已有档案 N」+ 新建与补录明细各前 5 条 + 未建档与条码冲突提示；四项全 0 时不渲染空块）。
- **用户第 3 点口径**：「**允许存，到报单导入时才拦**」—— 商品档案保存**不校验厂价**，只在报单导入时按「行级 `??` 档案」判定，缺则拒行。
- 🔴 **顺手修掉的两个既有 bug**（列识别）：① `name` 与 `barcode` 同指第 0 列（`name` 关键词含**泛词「商品」**会吞掉「商品条码/商品编码」，且旧实现允许同列归多字段）→ 改 `assigned` 集合做**列级唯一** + `name` 移到最后并去掉「商品」；② `_match_product` 条码精确未命中仍 `return rows[0]["id"]` **张冠李戴** → 改精确查 + 名称**完全相等**。**教训：「一列可归多字段」靠 dict 顺序隐式表达优先级，泛词一出现就静默错位；列级唯一是底线。**
- **报单对象维护入口 = 已有「报单配置」页（不新建）**：前端 `src/pages/ReportMapping.vue`（504 行）、后端 `/api/report-mapping*`（含 `/health` 查别名重复、**`/import` Excel 批量导入**）、表 `report_mapping`（v109）。⚠️ **`counterparty_type` 只有 `store`/`customer`/`self_warehouse` —— 自提 = `customer`，调拨 = `self_warehouse`**。模版 Sheet3 改为**下载时按 `/api/report-mapping` 动态生成**。
- **防漏单闸门**：导入时报单对象不在 `report_mapping` 里 → 直接报错拒收该行（正对美联檀溪 887 / 汴河 345 漏单；这两个已确认**走自提**，由用户在报单配置页自行配置）。
- ⚠️ **「系统里彻底不存合计行」= 数据库不存 `total_*` 列，合计一律渲染时按明细现算**（导出的 Excel 合计也是导出那一刻的静态值，不回流）。目的：从根上消灭附件1 那种「公式只求到第 109 行 → 王琴合计显示 0 实际 136」的错误。

## 导入校验的真实现状（2026-09-13 审核，未改代码）
> 结论：**「必须用我们模版 + 填全必填字段才能导入」并未实现**。三道关卡里只有第一道会硬拒，而它只看文件格式、不问内容。

- **关卡清单**（全在 `routers/import_router.py`）：
  | 关卡 | 位置 | 实际行为 |
  |---|---|---|
  | ① 文件级 `_validate_import_file()` | :48 | 扩展名 ∈{.xlsx,.xls,.csv} / ≤10MB / 魔数（`PK\x03\x04`、`D0CF11E0`）/ CSV 无 NUL → **唯一会 HTTP 400 硬拒的一关** |
  | ② 预览级 `_detect_forecast_cross()` :288 + `/preview` 的 `validation` :622 | `/preview` | 表头**关键词模糊匹配**；其余非空表头一律当客户列。**只写 `warnings`，不阻断** |
  | ③ 执行级 `_execute_forecast_cross()` | :344 | 硬校验只有一条 `if not customers: raise 400`（:364）。其余全部**静默跳过** |
- 🔴 **没有任何「必须用我们模版」的校验**：无表头白名单、无列数比对、无模版版本号。`grep` 全文件的「模版/模板」字样**全是文案标签**（`_TPL_LABEL` / 填写说明）。任何 Excel 只要表头碰巧含「条码/规格/单位/品牌/厂价/分销价/单价/名称」就能导入。
- 🔴 **模版 5 项必填承诺 → 代码只兑现 1 项**：`_TEMPLATE_FIELDS["forecast_cross"]`（:1077）标 `商品条码*`(True) + `商品名称/规格/单位/厂价☆`("cond")。但
  - 条码**不校验**：唯一判据 `if not name and not barcode: continue`（:436）→ **名称或条码有一个就行**；「不能重复」也无检测（批次内重复靠 `_pid_cache` 天然归并，不报错）。
  - 名称/规格/单位**不校验**：缺名称 → 走 `skipped` 不建档（但该行**仍 `items.append(product_id=0)`**，:530 → 落库垃圾明细、界面上永远看不见）；缺规格/单位 → 建档留空/默认「件」。
  - 厂价**是唯一真闸门，但默认关闭**：`db.factory_price_gate_enabled()`（`db/queries/products.py:174`）表缺失/无键/解析失败**一律 False 放行**。
- 🔴 **必填缺失 ≠ 报错，而是「导入成功 0 个客户」**。实测（`/api/import/preview`，只读）表头 `[数量,张三,李四]`：HTTP **200** / `cross.identity={}` / `customers` 3 个（**连「数量」列都被当客户列**，`_CROSS_SKIP_KEYWORDS` 里没有「数量」）/ `validation.warnings=["未识别到「商品名称」列…所有商品行会被跳过"]`。执行时每行 name+barcode 皆空 → `continue` → `items` 空 → `results.success=0` / `errors=[]` → 前端 `impState='done'` 渲染「**导入成功：0 个客户**」。
- 🔴 **后端给了警告，前端不展示**：`Forecast.vue::onImportFile`（:5302-5334）只取 `headers/preview/cross/suggestions`，**完全没读 `validation`**。所以那句「所有商品行会被跳过」用户在界面上永远看不到。
- 「确认导入」按钮禁用条件只有一条：`impCanExec = customers.length > 0`（`Forecast.vue:5254`）。
- **闸门真实状态（生产实测 2026-09-13）**：`tenant_1`（真实租户）`forecast_config` **无 `factory_price_gate` 键 → 关闭**；`tenant_10`（演示）有该键且为 `{"enabled": false}`（audit 显示 20:54–20:58 反复开关测试）。开关入口在**商品档案页** `ProductArchive.vue:197`（不在预报页），接口 `GET/PUT /api/forecast/factory-price-gate`（`routers/forecast_config.py:119/135`）。
- 小程序报单侧同闸门：`routers/forecast_submissions.py:118` —— 小程序无厂价列 → 判据的「行内厂价」恒为 0，实际只看档案。

### ⭐ v158 厂价闸门全栈（2026-09-13 落地，后端 `3cb7bd9` / 前端 `3b5813f`）
- **判据唯一实现在 `db.factory_price_verdict(row_fp, archive_fp)`**（纯函数、无 IO；行内优先、缺则档案；**>0 才算已录**；解析往宽认 `"1,234.5"`，异常不抛）。前端**不得另造一份**。
- **fail-safe 方向 = 朝放行**：`factory_price_gate_enabled()` 表缺/无键/脏 JSON/值非法 **一律 False（放行）**。误拒（拦住正常报单）远比漏拦危险。
- **拒收位置必须在「无 pid」判定之前**（`import_router.py::_execute_forecast_cross`）—— 否则无 pid 行会先被别的分支 `continue` 掉，闸门形同不存在。回执：`products_rejected_no_factory`（≤50 条，点名「名称（条码）」）+ `_count` + `factory_price_gate_on`（前端**只在这个 flag 为真时**渲染被拒区块）。
- ⭐ **待补厂价清单 = 后端生成，前端不用 SheetJS 造**：
  - `GET /api/import/factory-price-template?brand&category`（openpyxl；「厂价」列黄底 `FFF3CD` + 独立「填写说明」sheet）
  - `POST /api/import/factory-price-apply`（导回；表头定位容忍列序；回报 `updated/skipped/unfilled/nokey/total_rows`）
  - 🔴 **钥匙 = 商品编号（id）优先、条码兜底**。理由：实测演示租户 11 个待补商品**全部无条码**（只认条码永远补不回）；且本域存在「同一商品条码被两个品牌共用」（恒滋/福宝共码）→ 只认条码会把厂价**写到错的商品上**。
  - **商品导入路径不能用来补厂价**：它只 INSERT 新档（撞 `products.barcode` 唯一索引即报错），且 handler 根本不读 `factory_price`（静默丢弃）。
- 🔴 **「商品档案保存不校验厂价」≠「没有任何拦截」**：档案页只在报单导入/小程序报单两处拦，与用户原口径一致。
- 🔴 **小程序侧顺带修掉一处数据丢失**：原「先删旧单 → 再校验新单」，整单被拒时**用户上一次的报单已被删**。改 `_prev_sub_id`：只校验不删，新明细校验通过后才删旧单。
- 🔴 **「代码里没有的行为，文案不许无条件承诺」**：闸门存在前，有 **8 处**文案无条件写「会被拒收」而代码里根本没有拒收逻辑。修法是让文案**按开关实际状态分叉**（含模版「填写说明」sheet 也按开关分叉）。

## 本期预报汇总表「固定字段」（2026-09-13 审核）
- **行不由导入文件产生，而由商品档案产生**：`Forecast.vue::loadCross()`（:5803）`prods.items.map(pd => …)`，`prods` = `GET /api/products/grid`（`routers/data.py:373`，`product_list(limit=100000)` 全量在售）。导入只往这些行里**填数量**。
- **100% 固定的列**（取值只来自档案，`matrixRows` 里逐字取自 `pd.*`）：
  `商品名称 name` · `条码 barcode` · `规格 spec` · `单位 unit`(默认件) · `厂家编码 product_code` · `分销价 dist_price` · `标准售价 sale_price` · `进价 purchase_price` · `安全库存 safety_stock` · `保质期天 expiry_days` · `品牌 brand` · `分类 category` · `序号 seq`(渲染索引)。
  `/api/products/grid` 只返回这 13 个字段（无 moq / lead_days / factory_price / ordering_entity）。
- **随导入变化的**：客户列 `qtyByUnit[客户名]`、`合计 total`、`件数 boxes`（=`round(total/spec)`）、`最终下单 final`（=`total+extra`）、`下单金额 amount`（=`Σ(total+extra)×**purchase_price 进价**`，注意不是厂价）。
- ⚠️ **客户列（列头）本身反而受导入文件影响**：导入列名经 `db.resolve_alias_to_contact()`（`erp_db.py:6083`）解析 —— 命中活跃 `report_mapping` 用 `system_name`，**未命中则直接用原列名** → 导入文件里写个新列名，汇总表就多出一列。
- ⚠️ **三条「导入反向改档案」的例外**（所以「固定」要限定为「档案里已非空的值」）：① 新条码建档 → **新增行**（`source='forecast_import'`）；② 「只补空」回填 → 档案里**原本为空**的 spec/unit/brand/dist_price/factory_price 会被填；③ 商品名含「（恒滋/福宝）下单」或「订单排期 +N到货」→ 直接 `UPDATE products SET ordering_entity/arrival_lead_days`（`import_router.py:518-529`）。
- **顺带发现的两个小缺陷（未修）**：① `MASTER_COL_DEFS` 声明了 `moq`(起订量)/`lead_days`(到货天数) 两列，但 `matrixRows` 从不赋值、`/api/products/grid` 也不返回 → 勾选后整列「—」；② 汇总表 name 列渲染 `it.r.ordering_entity` 徽标（:521），但 matrixRows 无该字段 → 徽标**永不显示**（尽管导入会写这个字段）。③ 「单价(厂价)」列表头写厂价，`displayPrice()`（:3685）实际取 `dist_price`/`sale_price`（按 `priceBasis`）—— **label 与口径不符**，又一例。

## ⭐ 舟谱模板引擎 / 导入模版的现状核实（2026-09-14，为「模版设计 + 取价配置」任务实读代码）
> 设计文档：`预报订单导入模版与自提取价配置-设计-2026-09-14.md`

- 🔴 **舟谱模板生成引擎「已完成但前端零入口」**：后端 `routers/forecast.py` 有完整的 `_build_zhoupu_data()`（自提 22 列 `ZT_HEADERS` / 调拨 13 列 `DB_HEADERS`，`_render_zhoupu_xlsx`，`POST /api/forecast/import-templates/{tid}/generate` + `GET /import-templates` 清单），但 **`hergent-cn-v2/src/` 全库搜 `zhoupu` / `import-templates` / `舟谱` = 0 命中**，hermes_core 也没调用。→ **用户完全够不着的孤儿能力**。任何"给自提模板做配置"的讨论都要先补这一步。
- 🔴 **自提模板单价 = 行级单一价，与报单对象无关**（这是"渠道价取错"的根因）：
  - 导入侧 `import_router.py:441-443`：`fp_row = num_cell(row,"factory") or num_cell(row,"price")`；`price = fp_row or dist_row` → **厂价 → 通用单价 → 分销价**，**行级**，同一商品当期所有客户必然同价。
  - 生成侧 `forecast.py:601`：`price = _round_price(it.get("price"))` 直接取上面那个值 → 写进 `*单价(折后价)`。
  - 对比真实业务（附件4 口径）：渠道价应**按客户身份取**（永辉门店→永辉价、美联→美联价、分销客户→分销价）。**该规则应做未做。**
- 🔴 **`report_mapping.order_template`（"单型"）只写不读**：UI 有输入框（`ReportMapping.vue:139`，placeholder「如：调拨单 / 自提订单 / 访销单」），DDL 有列（`erp_db.py:617`），但生成引擎判自提/调拨**只看 `counterparty_type=='self_warehouse'`**（`forecast.py:615`），全库无任何业务读取。→ **已存在的"填了不生效"死配置**，设计新配置面板时的前车之鉴。
- 🔴 **自提模板 `*业务员` 列硬编码**：`ZT_SALESMAN = "张俊峰"`（`forecast.py:467`，用于 `:634`）。**多租户下每家租户的业务员都会写成张俊峰**。调拨模板已用配置的 `employee_name`（`:651`）→ 自提侧遗漏。
- **导入模版字段 = 7 列**（`import_router.py:1077 _TEMPLATE_FIELDS["forecast_cross"]`）：`商品条码*` + `商品名称☆` + `规格☆` + `单位☆` + `厂价☆` + `品牌` + `分销价`，其后客户列动态追加（读 `report_mapping.report_alias`）。
- **识别器字段 = 9 个**（`import_router.py:121 COLUMN_PATTERNS["forecast_cross"]`）：`barcode/spec/unit/brand/factory/dist/rhythm/price/name` —— 比模版**多一个 `rhythm`（订单排期）**。⚠️ **dict 顺序 = 优先级（先命中者赢）**，新增字段必须插在 `price` 之前（`price` 关键词含「价格」「单价」，会把「永辉价格」抢走）。`_CROSS_IDENTITY_FIELDS` 从 `COLUMN_PATTERNS` 派生（`:149`），加字段自动跟随。
- `_CROSS_SKIP_KEYWORDS`（`:258`）含 `永辉/商品编码/编码/分销价格/订单排期/合计/件数/最终下单/下单金额` 等 → **附件1 的 A 列「厂家系统商品编码」、B 列「永辉系统商品编码」会被当编码列跳过、值丢弃**（不会被误判成客户列，安全）。
- 字段存在性：`products.product_code`（厂家编码）**已存在**（`db/queries/products.py:15` 白名单）→ 加进模版+识别器即可；`products.yh_code`（永辉编码）**不存在**（全库 0 命中）→ 需迁移；渠道价**只有 `dist_price` 一列**，`product_channel_prices` 表**不存在** → 存不下永辉价/沃尔玛价/美联价。
- **导入模版无指纹/版本号、无表头白名单** → 任何 Excel 只要表头含关键词就能导入（与「必须用我们模版」的承诺不符）。
- 报单配置面板 = `src/pages/ReportMapping.vue`（504 行，**嵌在 `Forecast.vue:1586` 里，非独立页**），字段 = 业务员 / 归属类型 / 对象全称 / 报单简称 / 单型 / 调出仓·调入仓。

### ⭐ 价格渠道可配置模型（2026-09-14，用户定调「不要写死」）
- 🔴 **用户定调原话**：「设计功能时要从用户角度出发，而不是从我个人或单一客户的角度考虑。我的客户包括永辉、沃尔玛、美联，但其他客户的情况并不相同，因此**不要把价格写死在代码里**，应改为让客户可以自行配置。」
  → 我 v1 设计把「永辉价/沃尔玛价/美联价」当**固定列**，本质是**把单一客户的客户结构写进产品** —— 已推翻，v2 改为渠道可配置模型。**这是产品级设计原则，不只报单域**。
- **核心抽象：渠道 = 一套外部对接契约 = 一套商品编码 + 一套价格 + 一个下单出口**（编码与价同属"这个渠道"）。
  - **用户原话（用途的定义，2026-09-14 背景描述）**：「厂商系统商品编码：用于用户到厂家系统下单；永辉系统商品编码：用于用户到永辉系统下单」→ **编码 = "到哪个系统下单"的货号**，不是给人看的编号。
  - ⚠️ **用户口语「门店商品编码」= 本节的「渠道商品编码 / {门店}系统商品编码」**（全仓 grep「门店商品编码」零命中，是他的叫法不是字段名；日后听到别再全仓搜不到就说没记录）。
  - **编码的三处实际用途**：① 下单凭证货号（舟谱模版 `{col_prefix}系统商品编码` 列；用户下单表 A 厂家系统商品编码 / B 永辉系统商品编码）；② 渠道×商品矩阵（`PriceChannels.vue`「该渠道商品编码」）；③ 价格表↔下单表**匹配钥匙**（主键 A↔A，条码 C↔B 兜底；⚠️ 匹配前两边编码必须转字符串，int/str 混存大量漏匹配）。
  - **编码未拍板的遗留（2026-09-15）**：商品导入模版填「厂家商品编码」→ 被当**品牌**写进 `products.brand`（命中关键词「厂家」conf=high）；填「永辉商品编码」→ **静默丢弃**（`_all_fields["products"]` 12 字段不含 `product_code`）。已给 A 收紧 brand 关键词 / B 商品导入正式支持编码列 / C 前端列映射确认 UI。
  - ✅ **已拍板并落地（2026-09-16，用户选 C）**：识别器补 `COLUMN_PATTERNS["products"]["product_code"]`（**插在 `brand` 之前**，不动 `brand` 的泛词「厂家」—— 真实档案里确有把品牌列头写成「厂家」的），四处导入加**可编辑列映射确认界面**（`ImportMapping.vue`）。实测：`厂家系统商品编码` → `product_code`；全表 `brand` 含编码串的行 **3 → 0**；被改判「不导入」的编码在 69 个列里 0 命中（**改判真生效**）。**A 与 B 未做**。
  - ⚠️ **「永辉系统商品编码」也会判成 `product_code`**（关键词里有泛词「商品编码」）—— 这是**刻意的**，靠界面改判兜住；要让渠道编码分列区分需另开一轮（`products.yh_code` 仍不存在，渠道专属编码只能进 `product_channel_prices.external_code`）。
  - 另一条能写 `product_code` 的通道 = `POST /api/products/bulk-upsert`（报单页商品清单网格），别名 `厂家编码/永辉代码/客户代码/产品编码/货号` 5 个全指向 `product_code`。
  两张表：`price_channels`（租户级字典，`code/name/col_prefix/kind/price_source/code_source/is_default/sort/is_active`）+ `product_channel_prices(product_id, channel_id, external_code, price)`。
  **加一个渠道 = 插一行数据，零 DDL 零代码改动**；三个租户共用同一份代码。
- 🔴 **厂家渠道不进矩阵**（防第二份拷贝）：`products.factory_price`/`product_code` 已被 v158 闸门+补价面板+付款口径全链依赖 → 继续做权威值，渠道记录只持**指针** `price_source='products_factory'`。`price_source`/`code_source` 用**有限枚举 token** 而非原始列名（避免注入面 + 改 schema 静默失效）。
- **渠道绑定三层（后者覆盖前者）**：客户/门店档案 `channel_id`（权威，固有属性）→ `report_mapping.channel_id`（覆盖位，0=继承）→ `price_channels.is_default`（兜底，通常是分销）。🔴 **绝不靠客户名关键词猜渠道**（门店会新开、名字可含两字）；名字是"人的标签"，渠道是"业务的属性"。
- **唯一实现三函数**（放 `db/queries/prices.py`，前端不得另造）：`resolve_report_channel(mapping)` / `resolve_channel_price(pid, channel)` / `resolve_channel_code(pid, channel)`。判决顺序：`mapping.channel_id>0` → `self_warehouse`(调拨不取价) → 客户渠道 → `is_default`。
- 🔴 **缺价必须显式回报**（第三次踩同族坑的预防）：返回体加 `channel_fallback[]` / `channel_fallback_count` / `channel_missing_cells`，前端展示「N 处渠道价缺失，已按分销价生成，请核对」。**绝不静默取错价写进下单凭证。**
- 🔴 **价格字段与描述字段的合并语义相反**：描述类（名称/规格/单位/品牌）「只补空」是对的；**价格类必须「非空即覆盖」** —— 价格表每月更新，"只补空"= 第一次导入的价永远改不掉（`products.dist_price` 正吃这个亏）。两者**分列回报** `products_backfilled` / `prices_updated`。
- **模版动态列**：商品区 = 固定基础列（条码*/名称☆/规格（箱入）☆/单位☆/品牌/厂价☆）+ 按渠道字典生成 `{col_prefix}系统商品编码` / `{col_prefix}价`。你的租户 13 列、只做永辉的 9 列、不分渠道的 7 列。→ 顺带废除 v1 那个荒唐约束「新价格列必须叫『永辉价』不能叫『永辉价格』」（那是被 `price` 泛词逼出来的脆弱约定）。
- **识别器改两阶段**：① 动态精确匹配（读渠道字典生成 `{col_prefix}价`/`{col_prefix}价格`/`{col_prefix}系统商品编码` 规则，优先）② 静态关键词兜底（现 `COLUMN_PATTERNS`）。新渠道加字典自动支持，不改代码。
- **配置面板落点**：❌ 不建「导出配置面板」（渠道是**导入+导出共用**的一份配置，挂导出侧=制造第二份拷贝）；✅ 新建**独立「渠道与价格」页**（产品级、跨域复用）+ 矩阵在商品档案（复用 v158 面板机制）+ **客户→渠道绑定并入现有报单配置面板**（增一下拉，默认"自动"）。
  ⚠️ **前车之鉴**：`report_mapping.order_template`（"单型"）至今是「填了不生效」的死配置 → 渠道配置**必须同批打通「能配→能存→生成时真读→界面能看到用了哪条渠道」**，少一环就是第 2 个死配置。**不要先上面板再补引擎。**
- 🔴 **`routers/forecast.py:455-470` 硬编码清单（单一客户视角铁证）**：`ZT_SALESMAN="张俊峰"`(:467) / `ZT_DEPT="湖北福宝商贸有限公司"`(:468) / `ZT_WAREHOUSE`·`DB_SRC_WAREHOUSE="总仓"`(:469-470) / 单据号起始 `seq=21`(:617) → 全部要改成租户配置「单据默认值」。
  ⚠️ **必须区分两类"固定"**：`ZT_HEADERS`/`DB_HEADERS`(:455/461) 是**舟谱格式契约 = 保留正确**；业务员/公司名/仓库/渠道清单是**业务配置 = 硬编码错误**。混为一谈会误改对接格式。
- **与 Hermes 边界不变**：舟谱模板是下单凭证，主流程必须确定性（`forecast.py:442` 明写「零 LLM 零 token」）；agent 只做例外解释与对账，**不得决定取哪个价**。


### 价格渠道 v159 —— 落地状态（2026-09-14 已上线，后端 002e24a / 前端 f0dec38）
- **数据**：`price_channels`（渠道字典）+ `product_channel_prices`（商品×渠道矩阵），**租户级**、惰性补种 2 条普适渠道（厂家系统 / 分销价），**不预置任何零售商名**。
- **取价唯一实现** = 后端 `db/queries/prices.py`：`resolve_report_channel`（三层判决：报单对象 channel_id>0 > 客户档案渠道 > is_default 兜底；`self_warehouse` 返 None）/ `resolve_channel_price` / `resolve_channel_code`；厂价一律走 `factory_price_sql()`。**前端不得另算一份**（试算调的就是它）。
- **接口** = `routers/price_channels.py`（7 条路由，prefix `/api/price-channels`，RBAC→`data`）。静态路径 `/sources`、`/resolve` 在 `/{cid}` 之前。
- **界面** = 独立一级入口 `#/price-channels`（`PriceChannels.vue`）+ 报单配置新增「取价渠道」列/下拉（默认「自动」＝0，调拨不显示）。
- 🔴 **尚未接线**：取价函数**还没接进正式模板生成**（属设计 P0-b）→ 真实租户行为未变。接线时唯一闸门是「零渠道 → 按需补种默认渠道」，否则价会一路传成 0（＝静默取错价）。
- 🔴 **枚举取值**：`price_source` 只认 `products_factory / products_dist / matrix`（**没有 none**）；`code_source` 才有 `none`。「只对编码、价共用分销价」= `products_dist` + `code_source:none`。非法值现在**抛 400**，不再静默改写。
- 🔴 **「非空即覆盖」的空 = `""/None`，不含 `0`**：空 → 跳过保原值；显式 `0` 会写入（＝未录价，`channel_price_summary` 按 `price>0` 计已录）。

### 预报订单导入模版（`forecast_cross`）—— 契约与已交付文件（2026-09-14）

- **识别器** = `routers/import_router.py:121` `COLUMN_PATTERNS["forecast_cross"]`，9 字段，
  **dict 顺序 = 优先级（先命中者赢）**：`barcode → spec → unit → brand → factory → dist → rhythm → price → name`。
  ⚠️ **`rhythm`（订单排期）识别器支持、但系统下载的模版没给这一列** —— 执行体真读它
  （从文本里取 `+N到货` → 写 `products.arrival_lead_days`）。
- **不作为报单对象的列** = `_CROSS_SKIP_KEYWORDS`（`:258`）：
  合计 / 件数 / 最终下单 / 下单金额 / 分销价格 / 电商 / 加单 / 订单排期 / 排期 / 状态 / **永辉** / 商品编码 / 编码 / 序号 / 备注 / 批次。
- 🔴 **实测（真机 `/api/import/preview`，2026-09-14）**：不在关键词表里的渠道价列会被**误判为报单对象** ——
  真实下单表的「**沃尔玛价**」「**美联价**」被判成客户列（**价格被当数量写进报单**）；
  「永辉价」只因含「永辉」二字侥幸被跳过（＝靠写死单一客户名兜底，正是 v2 要根治的病）。
  → **导入模版里绝不出现带「价」的渠道列**；根治属渠道配置 **P0-d**（识别器两阶段动态精确匹配）。
- **必填三态** = `_TEMPLATE_FIELDS["forecast_cross"]`（`:1077`）：条码＝硬必填（红底 `C0392B` 白字）；
  名称/规格/单位/厂价＝条件必填（黄底 `FFF2CC` 深黄字 `7F6000`）；品牌/分销价＝选填。
  着色逻辑在 `:1113`（`download_template_file`）。
- 🔴 **主表必须是第 1 个工作表** —— `execute_import` 只读 `wb.active`（`:675`）。附加说明表放后面。
- **系统内下载入口已存在**：`Forecast.vue:5251` → `importApi.templateFile('forecast_cross')`
  （`GET /api/import/template-file/{category}`，`:1094`），下载文件名就叫「预报订单导入模板.xlsx」。
- **已交付增强版**：`~/Documents/舟谱导入模版/预报订单导入模板.xlsx`
  （3 表：预报订单 / 字段说明 / 填写规范；8 身份列 + 21 报单对象列 + 合计·件数逐行公式）。
  构建与验证脚本在同目录 `.预报订单导入模板.ref/`（`build.py` / `verify_detect.py` / `prod_preview_check.py`）。

### 品牌字段口径（2026-09-14 用户定调 —— 之前理解错了，勿再按旧说法写）

- 🔴 **品牌 ≠ 「同一商品条码被两个品牌共用时才填」**。用户原话：「品牌字段并非仅在"同一商品条码被两个品牌共用（例如恒滋/福宝共码）"时才需填写，而是用于客户还经营简爱、伊利等其他品牌时，让用户能借此**快速筛选出指定品牌**，该信息**不作为必填项**」。
- 正确口径：品牌 = **商品的品牌归属标签**（蒙牛低温 / 简爱 / 伊利…），用途是**多品牌筛选**；`_TEMPLATE_FIELDS["forecast_cross"]` 里本就是 `("品牌", False)` 选填 ✓ —— **代码是对的，错的是文案**。
- ⚠️ 该错误表述曾有**两份拷贝**，须同时改：模版「字段说明」+ `routers/import_router.py:1200` 的下载说明。
  已于 2026-09-14 一并改为「记录商品所属品牌（如蒙牛低温、简爱、伊利…）。经营多个品牌时可据此快速筛选，留空不影响导入与下单。」（commit `7ff8e3e`）
- 业务背景：用户在蒙牛低温下有**两个户头（恒滋、福宝）**，二者相当于两个独立客户。这是**他的业务事实**，但属**敏感信息**，一切交付物（模版/说明/示例）必须脱敏。

### 预报订单导入模板 = 定稿版（2026-09-14 21:50）

- 文件：`~/Documents/舟谱导入模版/预报订单导入模板.xlsx`，**结构已冻结**（31 列 = 8 身份列 + 21 报单对象列 + 2 计算列）。
- **列头已脱敏**：21 个报单对象列 = `业务员01~14` + `门店01~07`（占位名，只示意列数与结构）。真实列头由系统「下载模板」按各租户「报单配置」动态生成。
- **用前必须替换列头**：直接导入会建出「业务员01」这类假报单对象 —— 「填写规范」里已用 ⚠️ 红底写明。
- 建表脚本与验收脚本在 `.预报订单导入模板.ref/`（`build.py` / `verify_detect.py` / `verify_desensitize.py` / `prod_preview_check.py`）。
- 验收口径：`verify_desensitize.py` = xlsx 当 zip 解包逐条目搜 25 个敏感词（零命中才算过），**必须在 recalc 之后跑**。
- 与系统那份的差异：+「订单排期」列、报单对象列取自真实下单表 21 列（系统那份按报单配置生成 2 列）、+完整字段字典与填写规范。

## ⭐ 租户业务参数 v160（2026-09-14，单一客户硬编码 → 租户配置）

后端 `9623594`（9 文件 +283/−31）/ 前端 `cb10c1c`（2 文件 +108/−6）。授权前提：用户「还在自己测试阶段、没有真实用户」→ 无兼容负担，真缺陷与脏注释一次清掉。

- **唯一实现** `db/queries/business_profile.py`：五字段 `company_name`(舟谱「部门」) / `salesman`(「业务员」) / `warehouse`(「仓库」·「调出仓」) / `order_entities`(商品名内嵌下单主体标注) / `zt_seq_start`(自提单号起始序号，1~99)。存 `forecast_config` **同表不同 kind**(`kind="business_profile"`)。
- 🔴 **默认值一律中性**（不含任何真实公司名/人名/客户名）；非法值 `save_business_profile` 抛 `ValueError` → 路由 400，**绝不静默改写**；缺参数时模板生成把提示塞进 `warnings` 显式回报（舟谱对被拒列整批拒收，静默失败比明确报错贵得多）。
- 🔴 `order_entity_pattern()` **未配置返回 `None`**（不是返回「匹配一切的宽松正则」）—— 让「没配」在调用方是显式的；已配置时 `re.escape` 每个实体防正则注入。
- 🔴 **区分「舟谱格式契约」vs「业务配置」**：`ZT_HEADERS`/`DB_HEADERS`（列名与列序）、单号形态 `ZT{日期}{两位序号}` 是**对接格式，保留硬编码是对的**；只有公司名/人名/仓库/序号起点是业务配置。**混为一谈会误改对接格式。**
- **行为不变性靠「搬迁」不靠「改默认值」**：tenant_1（老板真实库）写入他原本的值 → 模板逐字不变；tenant_10（演示）写中性示例值。验证手段 = 改序号 21→77 后单号立刻跟随，证明**真读配置、无残留硬编码**。
- 配置 API：`GET/PUT /api/forecast/business-profile`（`routers/forecast_config.py`），RBAC 继承 `/api/forecast` → `data` 模块；PUT 写审计 `kind="business_profile_audit"`（留最近 50 条）。
- 前端：`ReportMapping.vue` 顶部「模板参数」卡片（`.tp-*`），**未配 `company_name`/`salesman` 时自动展开 + 红标「未设置 · 模板对应列为空」**；`api/modules.js` 新增 `businessProfileApi`。

### 🔴 本轮最值钱的修复：导入识别器把价格列当报单对象（与脱敏无关）

`import_router.py::_CROSS_SKIP_KEYWORDS` 原用**写死的零售商名**当「跳过该渠道价列」的判据 → **两个方向都错**：
① 别的经销商「甲系统价」列照样漏放 → 被当报单对象，**价格被当数量**导进报单（界面不报错）；
② 真名与之相同的报单对象列被**误杀** → 该门店整批静默丢单。
**修法**：`_is_cross_skip_header` 加通用规则 `if hh.endswith(("价格", "价")): return True` —— 报单对象是人名/门店名，不会以「价」结尾；价列一律命中。关键词表同时删零售商名、补「代码」。
验收口径：真实 41 列下单表表头跑 `_suggest_mapping_smart` → 报单对象恰好 21 个（39/39）。⚠️ 只单测 `_is_cross_skip_header` 会把条码/规格/简称/单位/品牌 5 个身份列算成报单对象，**必须复刻 `preview_import` 的完整链路**。

### 处置口径三分法（扫描类任务的铁律）

30 处真名命中**不是一类东西**，先分三类再动手 —— **别把「命中数」当「问题数」**：
1. **真功能缺陷 → 改租户配置**（上述四常量 + `seq=21`、下单主体正则、关键词表里的零售商名）
2. **错误注释 → 订正口径**（`products.py`「条码被两个品牌共用」→「被两个**下单主体（户头）**共用」——恒滋/福宝是两个独立客户，不是品牌）
3. **无害地名 → 不动**（`bid_region.py` 的「保康」= 湖北保康县）

⚠️ **注释同样会随产品交付到客户机器** → 我新写的注释里也不得引用真名举例。

### 前端终扫补获 5 处（v160-d，commit `3ac8250`）—— 后端扫完不等于扫完

同一轮对 `hergent-cn-v2/src/` 做同样终扫，补获 5 处命中，**3 清 2 留**：

- 🔴 **`.oe-<真实户头名>` ×2（`Forecast.vue`）= 真缺陷 + 真名双料**：下单主体徽标的配色类**按主体名动态拼**（`:class="'oe-' + it.r.ordering_entity"`），却只给两个真实户头名写了规则 → ① 真名进交付物；② **其它租户的主体徽标匹配不到任何类 → 永远没有配色**（只有裸徽标）。与「主体由租户自己定义」的方向相悖。
  **修法**：通用色板 `oe-c0..oe-c5` + `oeColorIdx(name)`（31 进制散列 mod 6，同名恒定同色），模板 `:class="'oe-c'+oeColorIdx(...)"`。
- 注释 2 处：`variables.css`（`/* 客户紫/福宝 */`）、`ProductArchive.vue`（「恒滋/福宝共用条码」→「两个下单主体共用同一商品条码」）。
- **保留**：`PriceChannels.vue:17/132` 的「有人只做永辉」是**产品文案举例**（同句已写「系统不预置任何零售商名」—— 文案 ≠ 预置，两者不矛盾）；`Forecast.vue:2603` 的粘贴列名别名 `'永辉代码'` 改它会动用户粘贴识别行为，**正解是「渠道列名别名从渠道配置生成」（P0-b 口径数据驱动）**，不塞进脱敏提交。

### ⚠️ 验证两个真坑（前端 CSS / 数据触发）

1. 🔴 **`<style scoped>` 会让「注入裸元素测样式」全部失效**：规则编译成 `.oe-c0[data-v-0deecc4c]`，注入的裸 `<span class="oe-c0">` 不带该属性 → 全部 `rgba(0,0,0,0)`、`height:auto`，**看起来像「规则没生效/没部署」，实为验证方法错**。
   **修法**：从 CSSOM 捞含 `oe-badge` 的规则，用 `\[data-v-[0-9a-f]+\]` 正则取出属性名，给注入元素 `setAttribute` 后再测。修完实测 6 色全非透明且互不相同。
2. ⚠️ **徽标元素需要提报数据才渲染**（`forecast_submission_summary` 按 `product_id` 关联 products 取 `ordering_entity`）→ 演示库无对应提报时 `oeCount=0`。此时用「CSSOM 规则存在 + scoped 计算样式生效」作**等价证据**，**不要宣称端到端看到了徽标**（诚实标注覆盖边界）。

### 演示库也是交付物（同轮净化）

`tenant_10.products` 里那件早期从真实下单表导入的商品，**名称与 `ordering_entity` 都含真实户头名** → 改为中性示例（`红桶（甲户下单）`/`甲户`），改前 `shutil.copy2` 备份。
- 判据：**演示空间是给客户看的**，真实户头名与测试残留（该库另有 2 条 `Hergent_测试_*` / `【E2E测试】*`，待定夺）都在客户视野内。
- ⚠️ `seed_demo.py` grep **零命中** `ordering_entity` → 这行是历史导入残留、**种子里没有、重建不出来**，只能一次性 UPDATE 生产库。
- ⚠️ 生产**无 `sqlite3` CLI** → 用 `ssh root@<prod> 'python3 -' <<'PY'`（stdin heredoc）跑只读/写脚本；SQL 里**用参数绑定传空串**，别写 `ifnull(col,char(39),char(39))`（那是 3 参 `ifnull`，必然 `syntax error`）。

## 🔴 报单页「建议」名号下**两个引擎**（2026-09-14 侦察 + 改名落地）

同一个「建议」标签背后是两套实现，**实测不同屏、不同口径**，且**互不同源**：

| | **系统建议** | **配方建议** |
|---|---|---|
| 实现 | 后端 `forecast_audit.py::_audit_items` | 前端 `computeSuggestion`（读「建议算法」面板） |
| 算法来源 | **硬编码 7 / 2 / 4 天**，**不读配方** | 读前端「建议算法」面板配置 |
| 呈现位置 | **只读态**汇总表 | **编辑态**网格 |

- 2026-09-14 处置：**改名 + 标作用域**，让用户能区分两者（不是把两者合并）。
- ⚠️ **真正同源属 P0-b 未做**（`P0-a 隔离批1 → P0-b 口径全数据驱动 → …`）。
- 判据：看到报单页「建议」数字与手工算的不一致时，**先问是哪个引擎**（屏不同 → 引擎不同），别当 bug 修。

---

## 🔴 小程序隐私申报审计 + 登录页品牌名（2026-09-18）

### 权威依据（唯一可信源，别再靠博客）
微信官方《小程序用户隐私保护指引内容介绍》
`https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/miniprogram-intro.html`
内含**「处理的信息 ↔ 接口或组件」完整映射表**，且平台明确：**未在指引中声明的接口/组件将被直接禁用**。
社区公告：`developers.weixin.qq.com/community/develop/doc/00042e3ef54940ce8520e38db61801`

### 全量 `wx.*` 核对结果（判据 = 该映射表逐条比对）
| 接口 | 位置 | 用途 | 是否需向微信声明 |
|---|---|---|---|
| `wx.setClipboardData` | `summary.js:49` | 汇总表复制 | ✅ **需要**（映射表项＝「读取你的剪切板」） |
| `wx.getNetworkType` | `fill.js:37` | 断网提示 | ❌ 不在必填清单 |
| `wx.onNetworkStatusChange` | `fill.js:44` | 网络恢复后续传 | ❌ 不在必填清单 |
| `wx.reportAnalytics` | `track.js:19` | 微信原生统计 | ❌ 不在必填清单 |
| `wx.getUpdateManager` | `app.js:22` | 版本更新提示 | ❌ 不在必填清单 |

**不存在**（已 grep 确认）：`wx.login`、`wx.getUserProfile`、`wx.getUserInfo`、`wx.getSystemInfo`、定位/相册/摄像头/麦克风/通讯录/蓝牙/手机号、`wx.onError`（无崩溃捕获）。
⇒ **平台侧只勾「剪切板」，备案材料无需改动。**

### 🔴 两条方向相反、都会被判风险的错误（本轮已修）
1. **多申报（over-declare）** —— `login.wxml` 隐私弹窗原写「**以及微信 OpenID、设备与崩溃日志**」，三项代码全无。
   **多申报 ≠ 安全**：会被判「误导用户」，且与平台已申报口径矛盾。**必须删。**
2. **少申报（under-declare）** —— 两处隐私文本都漏了 `getNetworkType`（读网络类型）与 `reportAnalytics`（上报业务事件）。
   二者**虽不在微信必填清单**，但**自己写的隐私声明里说谎同样是风险**（PIPL 要求真实、准确、完整）。
   ⇒ 正确处置不是删代码，是**如实描述**：网络类型"仅本机判断、不上传不存储"；统计"仅事件名/角色/门店名/数量合计，不含账号密码与商品明细"。

⚠️ **踩坑**：`track.js:19` 的上报字段要**逐个读调用点**才能写准 —— `fill.js:602` 传了 `{store: store.name}`（**门店名会上报**），
首版我按印象写成"不含门店名称"，属自造的不实陈述，已改正。**写隐私文本前必须把每个 `track(...)` 调用点看一遍。**

### 登录页品牌名（改前仍是旧名）
| 位置 | 改前 | 改后 |
|---|---|---|
| `login.wxml` 品牌名 | `Hergent 预报订单` | `小赫智体报单助手` |
| `login.wxml` 副标题 | `… · 一键订货` | `… · 内部使用` |
| `login.wxml` 底部 | `账号由老板在 Hergent 后台开通` | `账号由管理员在「小赫智体」后台开通` |
| `app.json` `navigationBarTitleText` | `预报订单` | `小赫智体报单助手` |
| `project.config.json` `description` | `Hergent 预报订单小程序` | `小赫智体报单助手小程序` |

- 🔴 **副标题去掉「一键订货」是备案口径问题**：《电子商务情况说明书》已声明「不涉及在线交易」，登录页写「订货」会诱导审核员往电商类目联想 —— 那正是上次被要求补说明书的那条线。
- 🔴 **`private.config.json` 的 `projectname` 不要改** —— 改了开发者工具会当成新项目、丢绑定。只改 `description`。
- ⚠️ 改名不会自动重排布局：`brand-name` 40rpx × 8 字 = 320rpx < 可用 654rpx，无换行风险。
- ⚠️ wxml/json 是**运行时加载**，改完在开发者工具点一次「**编译**」即可见，不必重新上传。
- ⚠️ 小程序端改动**无法从 CLI 构建/部署/验证** —— 只能静态核对 + 用户在开发者工具点编译。这是与 Web 前端的核心差别。

### 隐私文本改动的连带影响
`logout` / 清缓存 **不重置** `fs_privacy_agreed`（`mine.js` 只清 `fs_token`/`fs_user`/`fs_tenant_id`）。
本次文本变更涉及实质内容，但小程序**尚未提审、无真实用户** ⇒ 无需强制重新同意。
**规则（供以后用）**：若已上线后再改隐私文本的实质内容，应升 `fs_privacy_agreed` 的 key 版本（如 `fs_privacy_agreed_v2`）强制用户重新确认。

### 对外联系邮箱统一（2026-09-18，同日追加）

**唯一值 = `postmaster@hergent.cn`**（备案/微信认证材料里「截图证实」的登录邮箱）。
此前活应用/活文档里同时散着 **`privacy@`（小程序侧）** 与 **`admin@`（网页端 + 后端文档）** 两个旧值。

| 位置 | 改前 | 改后 |
|---|---|---|
| `miniprogram/pages/login/login.wxml` 隐私弹窗 | `privacy@` | `postmaster@` |
| `隐私保护指引.md` 头部「联系邮箱」+ 第八节 | `privacy@` | `postmaster@` |
| `备案等待期并行清单-2026-09-15.md` 申报对照表 | `privacy@` | `postmaster@` |
| `hergent-cn-v2/src/pages/Login.vue`（显示文本 + `mailto:`） | `admin@` | `postmaster@` |
| `hergent-cn-v2/public/legal/privacy.html` / `terms.html` | `admin@` | `postmaster@` |
| `hergent-erp/docs/PRIVACY_POLICY.md` ×2 / `TERMS_OF_SERVICE.md` | `admin@` | `postmaster@` |

- 🔴 **别一把替换**：`desktop-app/build/CODE_SIGNING_GUIDE.md` 里的 `"appleId": "admin@hergent.cn"`
  是 **Apple 公证（notarize）的账号标识**，不是联系邮箱 —— 替换会破坏公证配置。
  `desktop-app/`（含 backups）已冻结、`CLAUDE.md` 的邮箱沿革是历史记录，**均不动**。
  ⇒ 全仓扫 `@hergent.cn` 后**必须按文件性质分类**再决定改哪些。
- 顺带填掉 `legal/privacy.html` 线上残留的占位符 `[请填写负责人姓名/职务，或删除本条]`
  → 「张俊峰（法定代表人）」（线上法律页留中括号占位符本身是缺陷）。
- **口径一并统一**：`隐私保护指引.md` 的「订货预报数据」→「商品与数量预报数据」、
  「老板/管理员审批与一键订货」→「管理员审批与内部汇总」（同「去电商联想」那条线）。
- 判据：用户口述为 `postmater@`（少一个 s），与材料里的 `postmaster@` 冲突 ⇒
  **以截图证实的材料值为准，并先向用户确认**（对外公示的联系方式写错 = 投诉/删号请求收不到，
  而这类请求有法规响应时限）。

### 🔴 协议合规审计（2026-09-19，用户问「登录页看不到用户协议和隐私协议」）

**先纠正一个前提**：小程序**有**隐私弹窗（`login.wxml:19-30`），但**只在首次未同意时出现**
（`login.js:34` 判 `fs_privacy_agreed`，`login.js:64` 写入后永不再弹）。而登录页**除弹窗外无任何常驻协议入口**
⇒ 已同意用户（含**审核员体验账号**）**无处可查**。另有一个真实缺陷：`fs_privacy_agreed` 只被写入、**永不可撤销**。

**两类文档的强制力不同（不要混为一谈）**：

| 文档 | 是否强制 | 依据 |
|---|---|---|
| 隐私政策（＝平台《用户隐私保护指引》） | **必须** | PIPL 17 条 + 微信平台强制（未声明接口直接禁用） |
| 用户协议（服务协议） | **应当有** | 《移动互联网应用程序信息服务管理规定》16 条：应「制定并公开管理规则，**与注册用户签订服务协议**」 |

⚠️ 小程序是否直接适用该规定**有解释空间**（其定义指向「预装、下载」的应用软件），但监管实践已把小程序纳入 App 治理框架 ⇒ 如实标注，**不说死**。

**八项逐条核对结论**（代码位置可复核）：

| 项 | 现状 | 判定 |
|---|---|---|
| 首启弹窗提示阅读 | `login.wxml:19` | ✅ |
| 同意/拒绝双选项、无默认勾选 | `login.wxml:26-27` | ✅（未命中微信"弹窗仅提供同意选项"违规案例） |
| 只收集必要信息 | 全量 `wx.*` 已核 | ✅ |
| 多申报项已删（OpenID/设备/崩溃日志） | 已删 | ✅ |
| 平台侧已申报《指引》 | `隐私保护指引.md` | ✅ |
| **《用户协议》** | **全站零存在** | ❌ |
| **同意后协议查阅入口** | 无 | ❌（命中《认定方法》一.3「难以访问」） |
| **撤回同意入口** | 无（`fs_privacy_agreed` 不可撤销） | ❌（PIPL 15 + 认定方法三.8） |
| 界内投诉/客服入口 | 无（仅弹窗文案里的邮箱） | ⚠️ |

**已有可复用素材**：网页端 `hergent-cn-v2/public/legal/terms.html`（6635 字节，即用户服务协议）
+ `privacy.html`（7541 字节）已存在 ⇒ 小程序侧不必从零起草。

**同时发现两个既有风险**：
1. **页内自写文案 ≠ 平台申报版**：`login.wxml:23` 是一整段自写文本，平台侧另有《隐私保护指引》
   —— 微信官方明确要求两者一致、避免「双版本」矛盾。
2. **一揽子同意**：弹窗把「登录账号密码」（必要）与「微信原生统计 + 网络类型」（非必要）打包，
   拒绝即无法进入 ⇒ PIPL 16 与微信官方指引三（用户拒绝非必要授权时不得拒绝提供全部服务）
   下存在被认定「强迫授权」的空间。
3. **首页使用范围说明**：微信官方「小程序账号登录规范」要求仅供特定人员使用的小程序
   **需在首页有明显使用范围说明** —— 我们要复核（现有「账号由管理员在…后台开通」是否足够）。

**整改方向 → 已于 2026-09-19 落地**（用户回「需要」后执行）。交付 `outputs/小程序协议合规P0整改-2026-09-19/`，
校验工具 `.workbuddy/tools/miniprogram-legal-consistency-check.py`（六组 36 项）。

### 🔴 落码时验出的三条新事实（比"该怎么改"更重要）

1. **弹窗从来就没有样式** —— `login.wxml` 引用了 `privacy-mask` / `privacy-box` / `privacy-body` / `p-btn`，
   而**整个 `miniprogram/` 无一处 CSS 定义它们**（Grep 只命中 wxml 自身）⇒ 弹窗渲染成登录卡片下方的
   **一坨裸文字**。**这才是用户说「看不到协议」的直接原因**（不止是"同意后无处可查"）。
   ⇒ 已补样式，并写成防回归断言「wxml 引用的每个 class 是否在 wxss 有定义」。
2. **「保存期限」三份文本同时漏**（平台申报版 / 弹窗版 / 网页端版）。PIPL 17 条明文列举，
   而三份都只写「注销后删除」= **删除触发条件 ≠ 保存期限**。
   已补：账号存续期保存；注销或要求删除后 **30 日**内删除或匿名化（待用户确认取值）。
3. **小程序 ≠ 网页端，协议不可互相搬**：小程序 `小赫智体报单助手`（仅填报）
   vs 网页端 `Hergent · AI 经营副驾`（Excel 上传 / 连接器 / 登录 IP / 浏览器类型 / 传数据给 Hermes+DeepSeek）。
   网页端 `privacy.html` 描述的行为**小程序一样都不做** ⇒ 照搬 = **多申报**（与"少申报"同为风险）。

### ⚠️ 修正上一节「已有可复用素材 → 小程序侧不必从零起草」这条判断

网页端两份协议**不能复用**，只能当**结构参考**。本轮实际做法：
隐私政策**以平台申报版 `隐私保护指引.md` 为唯一源**逐句承接；
用户服务协议**新写**（小程序专用，服务内容不同）。网页端两份**保持不动**（它们服务网页端、本身准确）。

### 🔴 非必要项拆分的关键判据：**能不能真的关掉**

只把文案标成「非必要」是**假拆分** —— 用户点「同意并继续」后依然关不掉。
判据 = **`track()` 上报前是否真的查了开关**。已实现 `statDisabled()`（读 `fs_stat_opt_out`），
**并用 node 模拟 `wx` 跑真实逻辑验证**「默认上报 → 关后不上报 → 重开恢复」= 4/4。
⚠️ 只 grep「代码里有没有写开关」只能证明写了，不能证明生效。

**当前位置**：代码已落地、静态校验 **36/36** 全绿，但 **未 git 提交**
（协议是法律文本，等用户确认：保存期限取值 / 答复时限 / 注销途径 / 是否加界内客服 共 4 处）。
平台侧仍待用户：点一次「编译」+ 后台《用户隐私保护指引》同步本轮 4 处改动。

