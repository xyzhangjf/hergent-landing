# Hergent 版本史（v232 → v223）+ 起号 / 改号规程

> **本页从 `MEMORY.md` 第三节下沉而来**（2026-09-21 瘦身：**15252 B → 10446 B**，已达标 ≤10.5KB）。
> `MEMORY.md` 只回答「**该读哪一份**」；本页存「**每一版具体做了什么 + commit hash + 编号撞车的处置**」。
> 更早版本（**v222 及以前**）见 `.workbuddy/memory/YYYY-MM-DD.md` 当日日志。

## 一、版本史（新 → 旧）

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
