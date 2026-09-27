# Hergent 版本史（v233 → v223）+ 起号 / 改号规程

> **本页从 `MEMORY.md` 第三节下沉而来**（2026-09-21 瘦身：**15252 B → 10446 B**，已达标 ≤10.5KB）。
> `MEMORY.md` 只回答「**该读哪一份**」；本页存「**每一版具体做了什么 + commit hash + 编号撞车的处置**」。
> 更早版本（**v222 及以前**）见 `.workbuddy/memory/YYYY-MM-DD.md` 当日日志。

## 一、版本史（新 → 旧）

### v233 = 「报单单位」进商品档案 + 舟谱模板改单位**必带数量换算**（v218 §10.7 P2-2 + P2-3）

**两半是一个耦合特性，不可拆** —— `order_unit` 一旦生效，模板「`*单位`」就会变，
「`*数量`」**必须**跟着变；只改标签不改数 = 把 v217 那个错误（`160红枣5连杯` 明细 8 条）原样复制
（单位改「件」而数量仍是 8 ⇒ 8 件 = 64 条）。

- `db/queries/products.py`：新列 `order_unit` + `order_unit_sql()`（整行版）/ `order_unit_master_sql()`
  （主表版，**商品不在档时回退明细单位** —— 存量零变化是硬要求）/ `normalize_order_unit()`
  （🔴 `None` = 不带该字段「不动」；**`''` 是合法值**「清掉人工指定」—— 两者语义相反，别混）。
- `domain/unit_convert.py`（新）：`per_case` / `convert_qty` —— **后端换算唯一实现，与前端
  `Forecast.vue::perCase` 规则逐字相同**（跨语言无法共用代码，只能共用规则）。
- `routers/forecast.py`：`_fetch_product_units`（批量；`order_unit` 列缺失时**降级查询**不让模板 500）、
  `_resolve_template_unit`（`order_unit` → 条码层 → 明细单位 → 名称推断，返回 `src`）、
  `_align_row_unit`（换算不出来 ⇒ 退回明细单位 + 数量原样）、`_unit_stat_warnings`（回报到下载告警）。
  ⚠️ 取价必须挪到 align **之后**（渠道价按单位名选档，v231）。
- `routers/data.py`：`products_grid` 下发 `order_unit`（下发原始人工值、不在本层合并）；
  `update_product` 加长度校验；🔴 `bulk_upsert_products` 补「**显式提供才写**」守卫
  （该函数**不是**走 `product_update`，是有自己的 `fields` 字典 —— 不补 = 前端带了也**静默忽略**）。
- `erp_db.py`：迁移 `v233_products_order_unit`；主表「单位」改调真身 `order_unit_master_sql("i")`；
  `merge_products.fields_to_merge` 加 `order_unit`（否则合并重复商品**静默丢掉**人工指定）；
  `forecast_barcode_units` 段加**降级说明**（表保留、只读兼容、别再往里加）。

**数据事实（生产 tenant_1 只读勘察，285 个启用商品）——本轮最贵的新事实**

- `unit='件'` 且 `large_unit=''`、`large_ratio=0` → **61 个**（舟谱档案压根没录它们的小单位，
  导入落了默认值「件」，而「件」在舟谱语义里是**大单位**）；`unit == large_unit` = **0 条**
  ⇒ **不是「值撞车」，是这批商品的档案信息从来没录全**。
- `forecast_barcode_units`（115 行）与档案 `unit` 不同的**全是那批** ⇒ 它实际就是人工维护出来的
  「报单单位」覆盖层 ⇒ **回填**进 `order_unit`（不丢、不猜）。实测命中 **29 个商品**（100% 来自该表）；
  另一候选源（明细单位 ≠ 档案单位且档案无换算）**实测 0 条** —— 全被「档案信任闸门」挡下
  （`id=1316` 档案=盒/大单位=件/换算=12 而明细填「件」⇒ **不加闸门会把对的改错**）。
- 回填会改动**主表**「单位」列 22 行（件 → 条/组/板/包/提/瓶）。工具：
  `.workbuddy/tools/v233-order-unit-backfill.py`（默认 dry-run；在线备份 → 事务 → 逐主键定位 →
  写后逐列断言 → 输出回滚 SQL；幂等；不覆盖手工值）。
- 🔴 **舟谱档案匹配 58 个条码 = 0 命中**（列名是「小单位条码」而非「条码（小单位）」；改对列名后仍 0）
  ⇒ 这批商品在较旧导出的舟谱档案里**根本没有**（较晚报单的新品）⇒「从舟谱档案自动回填」这条路不存在。

**自测挖出的真缺陷（已修）**：`spec='8'`（纯数字）对 `unit='条'` 与 `unit='件'` **都**返回 8
⇒ 比值恒等 1 ⇒「换了单位却没换数量」（v217 那个错误的形状）。修法 = 无档案换算时，
**两个单位都必须能由规格串定位**才允许折算（`unit_convert.py::_unit_in_spec`），否则一律折不出来。

**三条硬验证**

- `PARITY OK 24/24` —— 从前端 `.vue` **逐字抽出** `perCase` 源码喂 node，与 Python `per_case`
  同一批 24 用例逐值比对（含 v217 真实商品：单位「件」→「条」而换算比**同为 8** ⇒ 这是敢回填的判据）。
- `SELFTEST OK`（约 30 项，含 3 条反证：纯数字规格 / 无档案换算 / `arc=None`）。
- 模板逐行比对（真身函数、副本库 107 行）：**105 一致 / 0 单位变化 / 0 仅数量变化 / 2 降级**。
  🔴 **2 行 DEGR 不是漂移**：`CD杯（16连）`/`CD杯8杯` 明细「件」而档案「组」、无换算、纯数字规格
  ⇒ 求不出比值 ⇒ **保持明细单位与数量原样 + 告警**；旧口径这两行会输出「组/1」（**只换标签不换数**）
  ⇒ 新旧不一致**恰是修对了**。
  ⚠️ 影响试算工具曾把这一档标成 `FAIL` ⇒ 复跑时被我误读成「107 行里 2 行不一致 = 回归」
  ⇒ 已改标 `DEGR` + 末尾单段解释。**分类标签本身会误导人，别省这句注释。**
  ⚠️ 也因此：**上一轮记的「107/107 一致」是在 `_unit_in_spec` 闸门加上之前测的** —— 加了闸门才会出现这 2 行。

**提交 / 上线**
- 后端 `80d8f92`（5 文件，branch `upgrade/v84-international`）→ **已部署到生产**（scp 具名单文件 + 重启）；
  前端 `df20a0c`（`laozhangai-product`）→ ⚠️ **未部署**（dist 会带走并发会话的「催收跟进下架」在途改动）。
- 文档/工具 `005eefd`。
- **部署前置比对全绿**：生产 4 个文件 md5 逐一 == 本地 **HEAD~1**、`domain/unit_convert.py` 生产不存在
  ⇒ 差异 100% 属本轮。备份 `/root/backup_v233_20260921_174700/`。
- **生产回填 tenant_1：29 个商品**（100% 来自条码人工层）。备份
  `tenant_1.db.bak-v233-20260921-174813` + 回滚 SQL（已做**往返自证**）。tenant_10 / tenant_9 **0 候选**。
- **真机验收（生产只读跑真身函数，看行内容）**：
  `forecast_submission_summary` 91 行里命中 22 行、**仍为「件」的 0**；
  `_build_zhoupu_data` **567 行与回填前库逐行相同（0 差异）** ⇒ **存量零变化**；告警 6→7（只多一条说明行）。
  **负例对照**：同一脚本跑回填前库 ⇒ R1 FAIL（22 行仍「件」）⇒ 探针有判别力。
- 🔴 **生产上不存在那 2 行 DEGR**（生产这两款明细单位全是「组」）⇒ 生产**无需**该决策。
  生产上「报单单位 ≠ 明细单位」的明细行**只有 1 条**（`id=1316` 档案=盒/明细=件）= 正是闸门保护的那种。

**顺带发现的既有缺陷（未修，独立待办）**：生产 `promotions` 表**无 `promo_type` 列**
⇒ `_calculate_promotion_uplift` 的查询被两层 `except` 吞成 `uplift=1.0`
⇒ **AI 建议量静默丢掉活动加成**。A/B 公平对照（PRE 40 / POST 23，两侧都有、且出现在
import 初始化阶段）证明**与 v233 无关**；差数源于汇总分组集合变化。

### v232 = 舟谱模板单价改取渠道价（v218 §10.7 P2-1）—— 顺带修一个**在产缺陷**

「进价」被写进了舟谱的「`*单价(折后价)`」列：明细价 = **进价（元/箱）**，而该列与「`*单位`」
成对 = **元/单位** ⇒ 旧模板单价**一直偏大「规格 × 0.9」倍（实测 10~24 倍）**。

- `db/queries/prices.py`：**新增 `channel_price_detail(pid, ch, unit)`**（唯一实现）——
  把「价以什么单位计价」作为返回值的一部分（大/小/中单位名；`matrix` 退回主列 ⇒ `''`）。
  `resolve_channel_price` 降级为其 3 元组视图（**既有调用方零影响**）；`resolve_for_report` 加键 `price_unit`。
- `routers/forecast.py`：`_template_price()` = **渠道价优先 → 明细价兜底** + **`_reject_reason()` 量纲闸门**；
  另存 `raw_map[alias] = 整行 report_mapping`（取价要 `channel_id`/`counterparty_id`，
  `alias_map` 只是给模板列的 **4 键投影**，**不扩它**）。
- `erp_db.py`：门面补导出 `channel_price_detail`。
- **影响面（只读试算，`tenant_1` 593 行）**：会变 **521**、回退 60、不变 3、新增单价 9。
- **验收**：`tools/v232-p2-1-selftest.py` 43 项全绿 + 生产只读跑真身 `_build_zhoupu_data`
  （期次 14：`11.0/桶、17.56/组、8.78/组、4.31/杯`，全为**元/单位**）。
- **已上线**（与 v231 合并，backend commit `0e7c6de`）：补列 `glob tenant_*.db` 已跑 + 双侧 md5 全等。
- 🔴 **判据教训**：报告原文的「存量行为零变化」**是错的** —— `resolve_report_channel()` 有
  默认渠道兜底（v159 有意设计）⇒「没配渠道」≠ `missing` ⇒ 照样改输出。详见 `deploy-ops.md §v232`。

### v231 = 渠道价补「三级单位价」三列（v218 §10.7 P1-3）

`product_channel_prices` 补 `small/medium/large_unit_price`，与 `customer_prices` **逐列同构**
（舟谱「价格方案」范式：**单位写在列名里** ⇒ 从根上消灭「这个 99 是元/箱还是元/桶」的量纲歧义）。

- **三处零变化保证**：① 生产该表 **0 行** ⇒ 零迁移；② **只 `ADD COLUMN`**（不重建、不动 `price`）；
  ③ `price` 仍是取价主列，三档缺省 0 = 「未录该档」。
- `_tier_of_unit(unit, u_small, u_medium, u_large)`：**按单位名**对齐档位
  （与 v223「三级商品用中单位、两级用小单位」的报单单位铁律同源）；🔴 **空名永不匹配**。
- `resolve_channel_price(…, unit="")` / `resolve_for_report(…, unit="")`：命中且该档 `>0` 才用，
  **否则退回主列** ⇒ 不传 `unit` 的调用方**零变化**。
- `set_channel_matrix` 维持 **`price` ≡ `small_unit_price`** 不变量（否则会产生半残行，
  而 `channel_price_summary` 按 `price>0` 计「已录价」）。

**验证**：内存库自测 **28 项断言全绿**（含 3 项档位反证 + **5 项「部分更新不得误清其余档」**）。
提交 `2b2ab31`。**刻意不单独部署**（零用户可见变化）⇒ 与 P2-1/P2-2 合并部署，
且部署时必须另跑 **`glob tenant_*.db` 补列**（见 `topics/deploy-ops.md §v231`）。

🔴 **结构性发现**：`resolve_for_report()` 只返回**一个** `price` ⇒
P1-3（三档）+ P2-1/P2-2（按单位取价）+ P2-3（`order_unit`）**是一个耦合特性**；
**P1-3 单独做本是死 schema**（0 行 + 无界面的表加三列 = 加了没人用），
本轮把**选档钩子**一并做进去，它才成立。

### v230 = 受控提交工具两项能力重建 + 三条操作纪律入库

🔴 **事故背景**：`git checkout -- .workbuddy` 抹掉 `tools/scoped_stage_by_marker.py` **619 行**
未提交改动（v224 的 `drop_plus_lines` + `dropped`），git 对象库里**无副本**
（`git fsck` 的 13 个悬空 blob 都不是；`__pycache__/*.pyc` 只是字节码）
⇒ 按技能 `§5.29` 语义**重建为可单测函数**并补回操作纪律。

新增（提交 `4934328`）：

- `apply_drop_plus_lines(plus, idx, os_)` —— 挖 `+` 侧**中间**若干行；三条硬约束（越界 / **一段连续** / **不贴两端**）
  🔴 **索引口径 0-based**（判据 = 技能 §5.29 示例注释编号「（0）…（6）」；第一版按 1-based 写，**被自测当场抓住**）
- `dropped_ok(staged, wt)` —— **暂存 = 0 且工作区 > 0**（"我故意没交的别人的东西"）
  ⚠️ **不适用条件**：待断言的串若在 HEAD 里**本就存在**（如"搬家"的删那半在别的 hunk）⇒ 改由 `trim_plus_head` 内置不变式覆盖
- 两个**指向自身**的回归 spec：`SPEC_SELF`（看门狗）+ `SPEC_SELF_DROP`（让 `dropped` 真的求值）
  🔴 **spec 自指陷阱**：`markers` 串若写进 spec 自身 ⇒ 本文件出现第二处命中 ⇒ 报「命中 2 个 hunk」⇒ 只能用 `own_hunks`
  🔴 **`py_compile` 过了 ≠ 代码是活的**：老 spec 的 `os` 在基线漂移后全部失效 ⇒ 断言段根本执行不到
- 新增自测 `tools/drop-plus-lines-selftest.py`（**12 项全 PASS**：1 正例 + 5 反证 + 1 端到端 + 6 项 `dropped_ok`）

**三条操作纪律**（血泪，全文 → `topics/deploy-ops.md §v230`）：
① 临时索引提交后**必须复位共享索引**（取路径须 `-z`，否则中文路径带引号 ⇒ `git reset` **静默 no-op**）
② **绝不用 `git checkout -- <目录>`** 收索引（连带抹掉该目录下**所有**已跟踪文件的未提交改动）
③ **只交「已改的跟踪文件」= 坏提交**（`app.json`/`require` 指向未入库文件，三个检查器**全不报**）

### v229 = 客户专属价「三档价联动」

中/大单位价 = **小单位价 × 换算比**（用户拍板：**它们之间的价是联动的**，可反推）。
⇒ **别再给每档各存一份独立数**（第 2 份拷贝必漂移）。前端 `df852b8`。

### （批）把「已部署、从未提交」的积压入库（2026-09-21，无版本号）

判据 = **批量「本地 == 生产」**：① md5 **逐文件全等**（非抽样）**且** ② **无源码文件 mtime 晚于构建时刻**
⇒ 满足即**整文件**入库，不必逐 hunk 切分。判据全文 → `topics/deploy-ops.md §v230`。

| 提交 | 仓库 | 内容 | 规模 |
|---|---|---|---|
| `7b0910d` | hergent-erp | 后端同步（md5 13/13 == `/opt/hergent-erp/`） | 13 files, +1526/−147 |
| `ded93a7` | laozhangai-product | 前端同步（dist vs 生产 **57/57 全等**） | 25 files, +2563/−394 |
| `af51e12` | laozhangai-product | 小程序入库（含 **19 个新文件**） | 35 files, +1183/−67 |
| `e0cdc51` | laozhangai-product | 小程序提审材料 | 11 files, +229/−51 |
| `4934328` | laozhangai-product | 工具两项能力重建（= v230） | 2 files, +282 |

🔴 **教训**：上一轮判 `Forecast.vue`「含别人的**未部署**在途改动，故不提交」**是错的**
（HEAD 9213 行 → 工作区 10934 行、**186 个 hunk**，**已随 16:00 构建全量上线**）
⇒ **判「哪些 hunk 属于我」之前，先判「这个文件整体是否已上线」。**

🆕 **记忆文件被 git 回退后怎么捞回来**：WorkBuddy 每轮 API 调用都会把 `working_memory_content`
（即 `memory/MEMORY.md` 全文）写进 `~/.workbuddy/traces/<session-id>/*.json`
⇒ 扫 trace、取**最长的那一份**即最完整版本（只对**已跟踪**文件有效，`topics/*.md` 多为未跟踪、不受影响）。

### v228 = 「客户专属价」上界面（v218 报告 P1-2 达成）

把 `customer_prices`（**「千店千价」的真身**，生产 `tenant_1` **8024 行/518 客户/65 商品**）
从「存在却看不见」接出来：全局列表（分页/搜索/汇总/排序）＋三级价手工录入＋导入模板。

🔴🔴 **修掉的真实缺陷**：`db/queries/sales.py::set_customer_price` 原来是**裸 `INSERT OR REPLACE`** ——
SQLite 语义 = **DELETE + INSERT** ⇒ **未写进列清单的列一律取建表 DEFAULT** ⇒
每写一次就把 `small_unit_price / medium_unit_price / large_unit_price / updated_at` **静默清零**
（8024 行里 5702 行这四列本有值）。⇒ 改 `ON CONFLICT(customer_id,product_id) DO UPDATE SET …=excluded.…`
**只覆盖显式提供的列**。内存库反证：旧写法 `(99,99,990,9900,'2026-06-20')` → `(88,0,0,0,'')`。

⚠️ 同批还定了：`price` ↔ `small_unit_price` **恒等不变量**（生产 5702 行两者相等）；
端点路径 `/api/customer-prices` **无 `/crm` 段**（`crm.py` 的 router prefix 是 `/api`）。

🔴 **部署面教训**（skill `§5.36`）：**deploy 的 staged base 必须是「生产文件」而非 HEAD** ——
生产 `import_router.py` / `erp_db.py` 含**从未提交但已部署**的 v226 改动，
按「HEAD + 我的 hunk」推会**整块抹掉且不报错**。正确判据 = `diff 生产文件 工作区文件`。

验收：真机 HTTP 端到端（含「只改一档不清零」核心断言）＋ 列表 60 行 **32 项断言** ＋ 浏览器真机（运行时错误 0）。
全文见 `topics/onboarding-and-archive-gate.md §十四` 与当日日志。

### v227 = 小程序「复制生成样单」+ 期次窗口三态

照往期做本期单。

- ① **源** = 服务端 `/my?store_id=`（**不用本机 `lastOrder`** —— 换手机就没了）
- ② **落点** = 当前期次（复用既有「切期次保留已填数量」，**不新增机制**）
- ③ **样单不落库**、只发一次读

约束：撤回/驳回单**不当源**、同店同期**取 id 最大**、源 ≤6、**覆盖必先确认**、
🔴 **越界预检只在清单全加载后下结论**（分页 ⇒ 否则把"还没翻到"误报成"不在清单"）。

顺带：**期次窗口两态→三态**（`in_window=false` 含「还没开始」，后端按 `status='open'`
**不带日期** ⇒ 未来期次本就在列、原文案**把话说反了**；判定用**本地** today）
\+ **补回 v224 误删的 `.reported-note`**（被**两处**引用、只核了一处）。

后端 `0e35c74` + 小程序 `e16613e`；单测 43 ✓

### v226b = 「进价」两条链有意分家 + 金额基准收紧

- ① 🔴「进价」下面有**两条链、口径有意分家**：**金额基准**（`Forecast.vue::factoryPrice()`
  ＋ `routers/forecast.py` `/payments/compute`·`/preview`）**只认 `factory_price`、不回退 `purchase_price`**；
  **档案完整性**（`fpEff()`／`db.factory_price_sql`／闸门 `missing_count`）**保留回退**
  ⇒ **别再把两条"对齐"回去**（判据全文见 `topics/forecast-order-domain.md`）
- ② 档案页补价口径统一 ⇒ `_rebuildFpRows()` 改走 `fpEff()` ⇒ **134→124**（徽标＝面板标题＝面板行数）
- ③ 前端 `d6a642a` + 后端 `57a8270`

🆕 **并发会话已预暂存 ⇒ 用 `GIT_INDEX_FILE` 临时索引提交**（只动 HEAD、不碰对方索引）
→ `hergent-scoped-commit §5.30`

### v226 = 「厂价」全系统统一为「进价」

295 处文案；**界面/模版合一列**、老表头「厂价」保别名（否则老文件**静默丢价**）；
🔴 **实证两列量纲不同**：`factory_price`=元/箱、`purchase_price`=元/小单位（46/46 == 分销价）
⇒ **表述统一 ≠ 两列可互换**；附**期次 0 金额重算** 94.29万 → **8.10万**；
已上线 + 真机 18 项验收 ✓

### v225 = 企微推送日志 4 处 `get_db` 未导入

`notify/wecom_notify.py`；`tenant_scope(None)` 切主库 + 读路径也建表 + 时区对齐；
已上线 `2fa60e6`

### v224 = 小程序报单一店一期一单 + 提交反馈

幂等键 `(store_id,period_id)`；覆盖**原位替换** ⇒ **单号不变**；
后端 `1158b88` + 小程序 `e11cdd1`；🔴 **与并发会话共用此号**

### v223 = 单价口径修复

**v222 及更早见当日日志。**

## 二、起号规程（⚠️ 起号前必做「三连搜」）

```bash
grep -rn -e "v20X" -e "V20X" <repo>/          # ① 源码（多模式**必须 `-e`**）
grep -rn "v20X" .workbuddy/memory/            # ② 记忆（含**当日日志**）
ls .workbuddy/tools/ | grep v20X              # ③ 工具目录（脚本名里的号最不会撒谎）
```

### 🔴 为什么 `MEMORY.md` 里的「已用到 vNNN」**不可信**

v224 时代按**会话开始时的快照**取号，而**并发会话**已用掉同一号
⇒ 只能**改号重来**（含**生产重新同步**）。
⇒ **真源 = 当日日志 + 工具目录 + 工作区源码**（三者都要查，缺一必撞）。

**改号流程** → `hergent-scoped-commit §5.29.0` 的可复用四步
（🔴 软回退后**必须 `git reset -q HEAD -- <文件…>` 还原索引**，否则 hunk 全消失）。

### 🔴 技能 / 文档的**章节号同样会撞**

v227 实测：`hergent-scoped-commit` 的 `§5.30`–`§5.33` 已被并发会话占走
（我落 `§5.34`，v226b 落 `§5.30`–`§5.33`，双方都靠先 grep 才没撞）。

⇒ **追加章节前先数一遍**：

```bash
grep -n -e "^## §5\." -e "^### §5\." <skill>/SKILL.md | tail -12
```

（🔴 多模式**必须用 `-e`** —— `grep "A\|B"` 在本机**静默失效**，见 `local-machine-pitfalls.md`）

---

## v283–v286 版本史（2026-09-26 晚 ~ 2026-09-27 早）

- **v283 / v284 / v285** —— 均为**生产数据操作**（不占代码改动，但**占号**）：
  · **v283** 20:33 提审账号清理（用户授权「备案已下来，审核专用号不需要了」）→ 删除 `mptest`/`mptestsp`；
  · **v284** 21:11 撤下「永诺旗舰店 / 永诺（江山店）」两条**报单配置**（用户更正「不是我真实的门店」；
    只撤配置、**不动客户档案**与 37 张舟谱单据）；
  · **v285** 21:24 **重建**微信提审账号（用户回「**要提审**」，与 v283 刚删相冲）⇒ 账号名不变、口令新发。
  · 交付物 `outputs/v285-重建微信提审账号-2026-09-26/`，脚本双份归档 `backups/v285-review-acct/scripts/`。
- **v286**（2026-09-27 08:0x）**代码一致性归零（第二次）** —— `.workbuddy/memory/MEMORY.md` 那条
  「代码一致性基线 = 0」被本日巡检判成 🔴 高危（总判定 **5 ≥ 1**），本轮把 5 个「已部署、但从未提交」的
  文件受控入库：`erp_db.py` / `routers/forecast.py` / `routers/rebate_rules.py` / `scheduler.py` / `soul_sync.py`。
  提交 `1942144`（`5 files changed, 249 insertions(+), 23 deletions(-)`），已推 `origin/upgrade/v84-international`。
  🔴 **本轮可复用的两条判据**：
  (a) 这类「让 git 追上生产」的提交，**前置必须是「工作区 md5 == 生产 md5」逐文件比对**（5/5 逐字一致）；
      同时确认**其余在途文件「生产 == HEAD」** ⇒ 才能断言「提交后 HEAD ≡ 生产」，不会造出坏 HEAD（→ §5.36b）。
  (b) **提交后重跑 `pss-check.py audit`，总判定必须由 5 降到 0** —— 这是本类修复唯一的端到端验收；
      「三方一致 205 → 210」正好等于入库的 5 个。**生产无需部署**（该批代码本就在线上跑）。
- **v287**（2026-09-27 08:45）**平台开通租户时同时配好登录账号与初始密码** —— 用户问
  「新增租户是不是应该给新租户配账号和密码呀？」⇒ 确认缺失 ⇒ 前端接上 `/platform/onboard`、
  后端 `routers/platform.py`（提交 `2fc1677` / 前端 `d506978`）。
  🔴 **它复用了 v288 的 `core.validate_username`（3 处引用）** ⇒ 两轮改动落在**同一份校验实现**上，
  这是「判据只有一份」这条纪律**第一次跨会话生效**。
  ⚠️ 它的前端是旧后台 `views/Tenants.vue`（hergent-admin），**不是 hergent-cn-v2 的 `pages/`**
  ⇒ 与 v288 前端**不是同一份产物**，两边不会互相覆盖。

## v288 版本史（2026-09-27 08:40–09:0x）

- **v288** 员工「登录账号」可修改 —— **老板代改入口**
  （用户原话：「已创建的账号可以改密码，但不能改账号，能否支持账号也可修改」）
  · **病根 = 只做了一半**：后端 `PUT /api/auth/profile`（`routers/auth.py:243`）**早就能**改用户名，
    但 `WHERE id = 当前登录用户` ⇒ **只能改自己**；员工档案弹窗账号区有「重置密码 / 禁用账号 /
    生成重置码」，**唯独没有改账号** ⇒ 账号名建错了只能**删账号重建**（而删账号会连带丢掉报单配置与工资条链路）。
  · **实现（唯一校验 + 唯一写入）**：
    `core.validate_username()` ＋ `USERNAME_IMMUTABLE=("admin",)`｜
    `erp_db.user_rename()`（三处副作用：`phone` **仅当逐字等于旧名**时跟随 / 未用完的重置码同步 /
    审计记「旧名 → 新名」）｜`PUT /api/users/{uid}/username`（薄端点，复用 `_assert_user_manageable`）｜
    `routers/auth.py` 改调同一实现（`conn=` 同一事务 ⇒ 与显示名改动一起提交/回滚）｜
    前端 `EmployeeArchive.vue` 加「改账号」（**预填当前名** + 成功提示点名「该员工下次登录请用新账号」）。
  · 🔴 **`admin` 本体也不可改**（不只是"不能改成 admin"）：改掉后 `core._init_users()` 查不到
    `username='admin'` ⇒ **重启凭空再造一个随机密码的管理员**（密码只打进日志、谁也不知道）。
    **单测 C13 挡下的真缺陷**；`erp_db.py:4881` 也按 `username='admin'` 绑 tenant 1。
  · 🔴 `_conn_is_master()` 必须用 **`os.path.realpath`**（不是 `abspath`）：SQLite 的 `PRAGMA database_list`
    回的是**解析过 symlink** 的路径（macOS `/var` → `/private/var`）⇒ `abspath` 不解析 ⇒
    同一文件被判成「不是主库」⇒ 改动被**静默挪到另一条连接**。
  · **验证四层**：单测 **35/35** ｜ **影子库 13/13**（真实数据快照 ＋ 生产同一份代码 ＋ 零写入生产库）｜
    直读 `server.app.routes` 确认端点已注册 ｜ 真机探针 console error **0**。
  · 🔴 **两条可复用判据**：
    (a) **「用 HTTP 返回码判端点是否注册」是假判据** —— 未登录打 `/api/users/4/nonexistent` 同样回 **401**
        （`/api/{full_path:path}` 兜底路由 ＋ 认证中间件在**路由匹配之前**拦截）⇒ 唯一判据 = **直读 `server.app.routes`**。
    (b) **分块部署**：`server.py` diff 出 3 块、其中 2 块是**别人的在途改动**
        （`os.popen` → `subprocess.check_output`）而生产上没有 ⇒ 整文件 `scp` 会**夹带**
        ⇒ 正解 = `awk` 切出自己的 hunk → `patch` 到生产文件副本 → 再 diff 确认「只剩别人的那两块」⇒ 才上传。
  · 🔴 **起号被抢（本轮最贵的教训）**：实搜两仓 ＋ 生产 ＋ `memory/` ＋ `tools/` **零命中**才取 v286，
    结果 **v286 已被 08:0x 会话占用**（受控提交 `1942144`）⇒ 再撞 v287（平台租户会话）⇒ 改 **v288**。
    📌 **实搜的边界要收紧**：必须把 **`version-history.md` 当天新增段**也算进去 ——
    别人的号常只活在**文档 / commit message** 里，源码里一个字都没有。
  · 🔴 **前端「只改注释 ⇒ 产物不变」**：v288 重构建后与已上传的 53 个产物**逐字节相同**、
    `index.html` md5 不变 ⇒ 与生产 `md5sum -c` 全数一致（本地 54 项 vs 生产 309 项**并集**）
    ⇒ **前端无需重新上传**。**先证明"没变"，再决定要不要传**；无差别重传只是凭空引入风险。
  · 交付物 `outputs/v288-员工登录账号可修改-2026-09-27/`。

## v282 版本史（2026-09-26 晚）

- **v282** 「沿用上一期得到 0 个商品」加告警 ＋ 给「**只配节奏、不设返利目标**」开正门（老板拍板「1.同节奏；2.要」）——
  · **① 同节奏**：生产建 `蒙牛鲜奶` 到货节奏规则（**id=11**，逐字段照抄 `蒙牛低温`，`target_value=0`；
    🔴 `auto_period_enabled=0` 避免与 `蒙牛低温` 抢排程归属）⇒ **均单提示「三件套」首次凑齐**，
    该品牌 **37 个商品**（本期清单内 **27 个**）的均单提示**第一次真正可显示**。
    排程 A/B 对照 5/5：加规则前后**期次日期逐条不变**。
  · **② 告警**：`erp_db.py::forecast_period_seed` 返回值补 **`src_count`**（区分「源为空」vs「全跳过」）
    ＋ `routers/forecast.py::_carry_empty_warn` 唯一文案 ＋ `scheduler.py::_alert_carry_empty`
    （站内通知 **`event_key=forecast_carry_empty`** ＋ 复用 `_push_tenant_channels` 推企微）
    ＋ 前端 warn 色可操作提示。**三条入口全覆盖**（手工新建 / 自动建表 / 手动填入）。
  · **③ 顺带**：`rebate_rules.py::_row_rhythm_only()` = 节奏规则唯一判定 ⇒ 校验放行 ＋ **不判重** ＋
    **不占月份锁**（否则年度无分解的 `covered_months` = 整年 ⇒ 品牌整年锁死、以后建真目标被 409）；
    单测同时证明「普通目标规则照常判重 / 照常占 12 锁」**没被放松**。
  · 单测 **62/62**（36 ＋ 9 ＋ 17）；前端上线**零夹带**（**51/53 逐字节相同**，差异只有我改的 2 个 chunk：+172B / +471B）。
  🔴 **两条新教训（已固化进技能）**：
  (a) **chunk 文件名连「夹带」都判不了** —— 只改 2 个源文件却让 **29/53** 个 chunk 改名（rollup hash 级联）
      ⇒ 唯一判据是**按逻辑名前缀比字节大小**（→ `hergent-parallel-session-safety` §八）；
  (b) **绝不用 `git stash` 做「去掉我的改动」的对照构建** —— 共享文件里叠着别人**已上线**的在途改动
      （本轮 `Forecast.vue` 里躺着 v265 的 ~28 KB，险被一起移走回退线上功能）。

## v278–v279 版本史（2026-09-26）

- **v279** 加/减单归属键「窗口 → **`period_id`**」（v277 遗留缺陷 5，老板拍板「选 A」）
  ＋ **小程序侧需求 2/3 核实与数据面验证**（老板拍板「做完以上就开工」）——
  · ⭐ **归属键换 `period_id`**：表加列 + **DROP 旧唯一索引** + 建新唯一索引 + 写/读/删/通知四处口径统一
    （详见 `backend-invariants.md`「洞二」✅ 段）。🔴 两个易错点：`ADD COLUMN` **必须单独走 `_safe_migrate`**
    （`executescript` 一句错就断掉后续全部语句，而它是唯一不幂等的那条）；**DROP 旧索引必须进 `INDEX_SQLS`**
    （那是唯一覆盖全部 `tenant_*.db` 的通道，否则新旧两套约束并存 ⇒ 旧键误拒新键允许的行）
  · ⭐ **三处`period_id` 化**：`save_matrix` 的 `DELETE ... WHERE period_id=?`、`_notify_extra_allocs` 的
    `event_key='forecast_extra_alloc|<period_id>|<product_id>'`、`plan_extra_allocs()` 开头**锚定期次窗口**
  · ⭐ **新铁律「幽灵 inode」**（详见 `backend-invariants.md`）：服务运行中删库文件并重建 ⇒
    `_sqlite_cache` 句柄指向**已删 inode**；🔴 **`conn.execute("SELECT 1")` 对已删句柄照样成功** ⇒ 测不出来
  · ⭐ **小程序侧结论：需求 2/3 早由 v264c 实现**（v277 交付说明误记「未开工」⇒ 漏因是**只查后端没翻小程序源码**，已订正）
    ⇒ 判据台用**真实 `fill.js` 的函数体**（括号配平提取，不手抄）＋ 真实后端响应回放 ⇒ **40/40**，
    硬标准 D19/D20/D21 全 P
  · ⭐ **D20 在生产真实数据下不可观测**：471 商品里唯一 `order_unit≠unit` 的 `id=1596` **没有换算**
    ⇒ `no_convert` ⇒ 永不显示 ⇒ 后端 `_per_unit_map()` 兜底分支**在生产从未被触发过**，只能造沙箱样本
  · 验收：DDL 迁移链 **20/20** · 后端 E2E **36/36** · 小程序判据 **40/40** · **生产零污染**（11 业务表逐表 vs 改前备份全等）
  · 上线：4 文件双侧 md5 全等；启动日志 `[schema-sync] … 补列(+1): ['forecast_extra_alloc.period_id']`，**告警 0 条**；
    5 库终态 `period_id=有 / 旧索引残留=无 / probe=OK`；沙箱销毁后 `tenants=[1,10]`、health 200

- **v278** 副驾输入框对齐 WorkBuddy + 企微会话进 Web 历史 + SOUL 单一权威源 ——
  · 前端 `b342c03`（19 files, +2492/−32）：工具自动收起 / 尺寸 / 权限 chip / ＋菜单 / 提示内联 + 6 探针 + 10 截图
  · 后端 `52ee18b`（4 files, +587）：`_sync_im_sessions` + `soul_sync.py` / 端点 + 代理白名单 fail-safe
  · 🔴 **归属判定是重度混合**（`CopilotDrawer.vue` hunk 总 64、本轮仅 22）⇒ 走 `own_hunks` 正向认领；
    三个混合块整块认领并**在提交信息里披露**
  · 🔴 **两个受控提交新坑**（→ 技能 `hergent-scoped-commit §5.39`）：① 守卫五条自证全绿、
    提交里仍混进别人 3 行 CSS —— **工具的自证是「块级 + 我声明什么就验什么」，我 hunk 内部夹带 = 零覆盖**
    ⇒ 补做「拿在途 `+` 侧逐行比提交版 vs 基线**计数**」的提交后审计（只比 `+` 侧；用计数而非字符串出现过）
    ② **`--amend` 会撞上并行会话的预暂存** ⇒ 改用**临时索引 amend**
  · 提交未推送；工作区仍脏

## v276–v277 版本史（2026-09-25）

- **v277** 商品目标「加单/减单按占比分配到人」全链闭环（用户七条需求的 #4/#5/#6/#7）——
  · ⭐ **加单列角标 + 悬停算路**（`ptExtraMark` / `ptExtraTip`，只读态与编辑态都有）
  · ⭐ **`forecast_extra_alloc` 表真建**（v264 文档写「已建」实为**从未建过**；本次 `_safe_migrate_script('v277_forecast_extra_alloc')`
    ＋ **索引登记 `db/indexes.py::INDEX_SQLS`** —— 租户库只下发表不下发索引，不登记就 `index_list` 为空且零报错）
  · ⭐ **`save_matrix` 事务外算 → 事务内落 → 提交后通知**（`plan_extra_allocs` / `_notify_extra_allocs`）：
    `get_db_tx()` 持写事务时另开连接读同一 SQLite 会互锁；通知必须放提交后
  · ⭐ **`_achieved_from_sales`** 从销售单明细补「已达成（箱）」（人工填报优先）—— 生产
    `rebate_achievements` **只有 brand 维度 4 行、product 维度全库 0 行**，这才是「已达成恒为 0」的根因
  · ⭐ **顺带修 3 个静默族缺陷**：`can_target` 用 `lr>0` 判而唯一实现 `per_case()` 有**规格串回退分支**
    ⇒ 86 个算得出来的商品被灰显禁选；`product_update`/`product_create` 白名单**漏 `large_ratio`** ⇒ 填了静默不写；
    `save_matrix` 写**请求体窗口**、`GET /extra-alloc` 读**期次窗口** ⇒ 写成功/读为空/零报错（待拍板改 `period_id` 归属）
  · 验收：后端 `e2e.py` **50/50**、前端 `fe-probe.mjs` **22/22**；沙箱 `tenant_9997` 销毁零残留
  · 另一条上线纪律：**线上生效入口被并行会话接管**（我 22:44 的 `index-CrgMJlhB.js` → 线上 23:00 换成
    `index-BT1dOmCB.js`）⇒ 判「我的改动在不在线上」不能看 chunk 名，要用特征串 + CSS 逐字节 + **scopeId 反推**；
    三条全过 ⇒ **不重部署**（`deploy-ops.md §v277`）

- **v276** 演示租户「只读」从**文案变成服务端强制**（commit `eba0f65`，已推）——
  `POST /api/auth/demo-login` 是**公网免认证**入口（任何人可拿 demo 租户 boss token），而"只读"此前只是前端标签。
  改动：`tenants.readonly` 列 + `core.tenant_is_readonly()` + RBAC 中间件 `READONLY_TENANT` 闸门（置于 `_check_perm` **之前**）
  + nginx 限流。🔴 两条设计要点：**回落方向取宽**（读不到租户属性 ⇒ `False`，防误锁整租户不可自助恢复）；
  **租户口径与 `_check_perm` 完全一致**（用请求头判 ⇒ 不带 `X-Tenant-Id` 即绕过）。
  ⚠️ 副产物：新闸门**夺走了巡检探针的错误码**（加门禁前 403 = 权限，加后 = 只读 ⇒ 探针不再证明越权防守），
  已改为**断言 403 的原因**。

## v257–v275 版本史（2026-09 下旬，从索引迁入）

> 迁入原因：该段原占索引约 1.5KB，导致 MEMORY.md 超出注入上限被截断。

- **v275** 路由级角色守卫 —— `roles.js::roleIn()` 收敛判据 + `router` 的 `async beforeEach`
  按 `meta.roles` 拦深链，**只给 `/zhoupu-import` 加**（后端唯一「整页 403」的页）；
  真机 **50/50 全绿**，最锐一条 = 同一管理员令牌 + 桩 `role=supervisor` ⇒ 翻转为拦截。

  🔴 **撤入口 ≠ 撤路由**：`v-if` 只藏 DOM ⇒ **手敲 URL 照样进页面** = 假封锁
  （比假入口更难发现，因为**没人会来报**）。受限页必须在**路由表**挂 `meta.roles`，
  判据走 `roles.js::roleIn()`（与入口 `v-if` **同一个函数**，别各写一份）。
  守卫须 `await loadPerms()` 把「未知」消掉，但**拉取失败必须放行**；
  拒绝用 `redirect + query.denied` + 弹提示，**别用 `return false`**（原地白屏 = 死按钮变体）。
  ⚠️ **只给「后端整页 403」的页加** —— 页内某块按角色判的（如 `/forecast`）加了会**误伤**。

- **v274** 舟谱导入入口从侧栏迁进「能力中心 › ERP 数据源」第三张卡 +
  通道回执 `system_config.zhoupu_import_receipt`。
  🔴 顺带修掉两条同源真缺陷：`api()` 默认解包 `data.data` ⇒ 漏 `raw:true` 就**静默拿到空值**
  （其中 `zhoupuApi.status` 是 **v271 遗留 ⇒ 进度轮询从来没工作过**）。

  🔴 **前端「接口回信封」模块的验收铁律**：后端回 `{"success":true,"data":{…}}`
  ⇒ `api()` 默认解包 ⇒ 调用方写 `r.data` 时**漏一个 `raw:true` 就静默拿到空值**
  （不报错、不崩、界面只是读数恒空）。**curl 级验收不算数，必须落到渲染层。**

- **v273** 新建期次自动沿用上一期商品清单 —— `forecast_period_prev_id` 锚
  **`order_start` 业务时间序不是 id**，复用 v184 `forecast_period_seed`，`df5d386` / `bf92a02`。
- **v272** 匹配归一化、**v271** 舟谱导入改后台任务 —— **均被并行会话占用**。
- **v266** 角色可叠加 `users.roles` + 套餐能力 `_PLAN_CAPS`；**v265** 数据新鲜度；
  **v264** 商品目标管理（含 v264c）—— 🔴 **v264 / v265 / v266 三个号同时在用**。
- **v261** 备份 `_all_db_files` 补 4 个辅助库。
- **v260** 组合拆零同源缺陷 + P2-1 技能生态 / P0-1 租户隔离收口 / P1-2b 判层。
- **v259** 小程序「我的提交」左滑删除本人预报单 + 顺带修 `forecast_period_writable`
  裸调 `get_db()` 导致 `/recall` 500 的既有缺陷。
- **v258** P0 A2 租户 HOME 隔离 + A4 systemd 沙箱。
- **v257** hergent-admin 子站独立化受控提交。

### 🔴 这段历史的两条教训（比条目本身值钱）

1. **同一时段可能有 3 个号在被并行会话使用**（v264/v265/v266 实测）；
   也有号一输入就被别人占掉（v271/v272）。⇒ 索引里的「已用到 vNNN」**必然过期**，
   起号前**只能靠实搜**（本仓 + 生产 + `memory/` + `tools/` + 两个仓库）。
2. **"顺带修掉的缺陷"往往比主改动更值钱**（v274 的两条 `raw:true` 静默空值、
   v259 的 `/recall` 500）⇒ 改一处前先扫同源调用点，这类同源缺陷几乎总是成组出现。
