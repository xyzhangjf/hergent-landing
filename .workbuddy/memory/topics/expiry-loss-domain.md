# 货损 / 效期域（expiry & wastage）

> 范围：`inventory` 效期分档、报损单、临期成本、`/api/ai/loss-card` 卡片、日报货损段、AI 副驾的货损回答。
> 涉及前端页面（临期看板 / 库存）时另见 `frontend-ui.md`；涉及副驾回复格式另见 `ai-copilot.md`。

## 1. 数据模型与代码位置

| 角色 | 位置 | 说明 |
|---|---|---|
| 库存批次 | `tenant_N.db::inventory` | 列：`id, product_id, warehouse_id, quantity, cost_price, batch_no, expiry_date, updated_at, bin_location, production_date`。**效期 = `expiry_date`（TEXT `YYYY-MM-DD`）** |
| 报损单 | `wastage_orders` / `wastage_order_items` | `wastage_orders` 列：`id, order_no, type, warehouse_id, total_loss, note, operator_id, status, journal_id, created_at` |
| 分档引擎 | `server/domain/batch_tracker.py` | `EXPIRY_TIERS` / `classify_expiry(days, threshold_days)` / `scan_expiry(wh, threshold_days=None)` / `generate_discount_suggestions()`；v157 新增 **`load_threshold_days()`**（读租户配方，fail-safe 回 7）、**`clamp_threshold_days()`**（1~90）、**`tier_label(tier, threshold_days)`**（标签动态化）、常量 `RISK_TIERS`/`WATCH_TIERS`/`RED_DAYS`/`WATCH_DAYS` |
| 卡片接口 | `server/server.py::ai_loss_card`（`@app.get("/api/ai/loss-card")`） | 前端识别到货损意图时并行 fetch；只读、绝不 500 |
| 日报推送 | `server/scheduler.py::copilot cards brief`（货损段 L765~794） | 走企微推送给老板 |
| 配方 | `tenant_N.db::workflow_recipes['loss_recipe']` | JSON：`{dimension, threshold_days, pricing, near_loss_pct, expired_coefficient}` |
| 技能 | `/root/.hermes/skills/hergent-milk-expiry/SKILL.md` | 文末 `AUTO_RECIPE` 区块由 `server/recipe_sync.py` 在**配方保存时**自动重写，AI 以该区块为准 |

## 2. ✅ 口径已统一为「读货损配方阈值」（v157，2026-09-13，commit `2f89492`）

**修前**：`batch_tracker` 把 `红≤3 / 橙≤7 / 黄≤14` **硬编码**，且 `total_at_risk_value`
把 `yellow(≤14 天)` 也算进去；而 AI 对外声明、用户在配方面板里配的口径是
`workflow_recipes['loss_recipe'].threshold_days`（tenant_1 实配 **7**）→ 同屏两个「临期风险值」
会差出 8~14 天那批的钱。当前未显形只是因为 `expiry_date` 全空（两边都是 0）。

**修后（方案 ①，已拍板上线）**：

| 来源 | 临期界定 | 用途 |
|---|---|---|
| **代码 = 配方**（唯一口径） | `red ≤3 天 / orange ≤ threshold_days / yellow = threshold+1 ~ 14 天（仅关注）` | 全模块（`scan_expiry` / `shelf_life_analytics` / 卡片 / 日报 / AI） |
| 配方 `threshold_days` | tenant_1 = **7**（2026-09-07 用户自己配的） | 唯一权威来源 |

- **`total_at_risk_value` 只含 `expired/red/orange`**；`yellow` 降级为「仅关注」，
  **单独**回传 `total_watch_value` / `watch_items` —— 降级 ≠ 让数字消失（否则同屏仍对不上）。
- 返回体新增 **`threshold_days` / `risk_tiers` / `watch_tiers`**：下游（loss_card / 日报 /
  ai_insight_llm / 前端）**原样引用**，不许再各自写一份档位字面量。
- `tier_label` 改为**动态生成**：配方改成 14 天时标签跟着变，不再写死「橙色临期(7天内)」。
- `yellow` 的 `discount_pct` 由 5 → **0**（「仅关注」+「建议打 5% 折」自相矛盾），
  `generate_discount_suggestions` 白名单收窄为 `RISK_TIERS`。
- 边界收敛 `clamp_threshold_days`（1~90）必须与 `routers/loss_workflow._sanitize_recipe`
  **逐字一致**，否则「面板里存的值」与「扫描时用的值」会再次分叉。

**为什么改在 domain 层（`scan_expiry` 自己读配方）而不是让各调用方传参**：
调用方有 5+ 个（loss_card / scheduler / ai_insight_llm / datasource_adapter / profit_reporter /
`/api/batch/expiry-scan`），漏一个就再分叉。`scan_expiry` 默认自读配方 = 同源的唯一实现；
需要临时试算的（`loss_workflow` 用 body 覆盖阈值）显式传 `threshold_days=`。

**验收判据（照抄，别用「有没有报错」）**：
- 同一份数据下：旧口径 ¥4,000（含 yellow）→ 新口径 **风险 ¥3,000 + 仅关注 ¥1,000**；
- `scan_expiry()["threshold_days"] == load_threshold_days()`，且 `== 配方面板显示值`；
- `unscanned_batches > 0` 时仍必须出现「未录效期 / 查不出来」字样（v156 判据不许被 v157 冲掉）。

## 3. 🔴 「零值即健康」陷阱与 v156 修复（2026-09-13，已上线）

**根因**：`scan_expiry` 的 SQL 带 `WHERE i.quantity > 0 AND i.expiry_date != ''` —— 未录效期的批次被**整体排除**，于是「效期全空」反而算出 `at_risk = 0`，被判成「库存健康」。
**修法（四层同时改，缺一层就会漏）**：

1. `batch_tracker.scan_expiry`：另算 `total_batches`（**不带 `expiry_date != ''`**），返回体加 **`total_batches` + `unscanned_batches = max(0, total - len(items))`**。
2. `server.py::ai_loss_card`：`expiry_complete = (unscanned == 0)`；**三态 tone** —— `有风险→warn / 缺数据→neutral / 数据全且无风险→才 good`；`unscanned>0` 时**追加**「未录效期批次」metric（否则数据缺失会伪装成安全）。顺带修口径 bug：`risk_batches` 由 `total_items`（全部纳扫批次）改为**四档风险 count 之和**，避免「临期 54 个、风险值 ¥0」自相矛盾。
3. `scheduler.py` 货损段：同样三态 —— 有损失/风险→报数+缺口提示；**无报损但 `unscanned>0`→「无已审批报损，但 N 批未录到期日，临期风险查不出来」**；`else` 才说「效期数据完整」。
4. 对话层（Hermes）：靠技能第 5 节「没有效期的批次不算临期，但应提醒用户补录效期，否则预警失效」兜住。

**验收判据（务必用这套，别看「有没有报错」）**：
- `scan_expiry()` 返回里 `unscanned_batches == 0` 才允许出现 `good` 色调；
- 效期全空时，卡片/推送**必须**出现「未录效期 / 查不出来」字样，且**不得**出现「健康」；
- `unscanned > 0` 时 `total_at_risk_value == 0` 是**正常**的（扫不到风险），不代表没风险。

## 4. 取数路径（诊断时注意两者会分叉）

- **AI 副驾（Hermes）**：**自己 SQL 直连 `tenant_N.db` 只读查**（`file:...?mode=ro`），因此能算出系统卡片没有的「在库成本上限」（如 tenant_1 的 ¥113,357.58）；同时**另调** `/api/ai/loss-card` 交叉验证。服务器**没有 `sqlite3` CLI**，AI 一律走 `python3 - <<PY`。
- **系统卡片 / 日报**：走 `datasource_adapter` → `get_wastage_summary(30)`（**近 30 天**）+ `get_expiry_scan(0)`。注意：卡片是**近 30 天**口径，而 AI 常按「**本月**」说 —— 当前因报损单恒 0 无差异，将来有数据会对不上。

## 5. tenant_1 数据现状（2026-09-13 实测，诊断基线）

- `inventory` **54 行 / 27,855 件 / 成本 ¥113,357.58**，`expiry_date` 与 `batch_no` **全部为空**；
- 54 行**全部 `warehouse_id=1`「临期仓」**（`总仓` id=3 为 0 行）→ 仓归属本身可疑，疑似导入时未分仓；
- `updated_at` 全 = `2026-06-29 16:01`（**库存快照 6-29**）；`sale_orders` `MAX(order_date)` = `2026-06-15`；
- `wastage_orders` / `wastage_order_items` **整表 0 行**（系统**从未录入过**报损单，不是「本月没有」）→ AI 说「本月报损 0 张」措辞不准；
- 结论：**用 6 月快照算「9 月货损」口径不成立** —— 正确表述是「库存数据停在 6-29，无法支撑本月核算」。

## 6. Hermes 会话原文怎么查（别再翻 `sessions/`）

网页副驾（主网关 `/root/.hermes`）的对话落在 **`/root/.hermes/state.db` 的 `messages` 表**（`sessions` 表配套；`sessions/` 目录只有 8 月的旧 dump）。
```python
import sqlite3
c = sqlite3.connect("file:/root/.hermes/state.db?mode=ro", uri=True)
c.execute("SELECT id,role,tool_name,content,timestamp FROM messages WHERE session_id=? ORDER BY id", (sid,))
```
平台 `api_server` = 网页端；`gateway.log` 只记「入站/响应就绪」，**拿不到回复原文**，必须查 `state.db`。

## 7. 🔴 改「临期口径」必须同步的消费点清单（v157 实测漏一个就分叉）

改 `scan_expiry` 的口径会影响下面**全部**位置 —— 每处都必须跟随后端返回的
`risk_tiers` / `watch_tiers` / `threshold_days`，**不许再写字面量**：

| # | 位置 | 同步内容 |
|---|---|---|
| 1 | `server.py::ai_loss_card` | 「临期风险值/批次」按 `risk_tiers`；增「仅关注」metric + 口径 hint；summary 写明配方天数 |
| 2 | `scheduler.py` 日报货损段 | `risk_items` 收窄；新增 `loss_watch_items` 日指标；行文案带阈值与「仅关注」段 |
| 3 | `ai_insight_llm.py` | 增 `expiry_watch_value` / `expiry_threshold_days`（否则模型只看到变小的风险值，不知道少掉的那批去哪了） |
| 4 | `routers/loss_workflow.py::_compute_loss` | 试算时**显式**传 `threshold_days=recipe["threshold_days"]`，否则标签用库里的值、过滤用 body 的值 |
| 5 | `datasource_adapter.py` / `profit_reporter.py` | 透传，无需改（只读 `total_at_risk_value`，语义自动跟随） |
| 6 | hergent-cn-v2 `Workbench.vue::loadData()` | `items` 含**全部档位**，必须过滤成 `['expired','red','orange']` —— 否则「近效期预警」会把正常批次也算进来（旧版直接全量塞，效期一录全就报「预警 54 条」） |
| 7 | hergent-cn-v2 `Workbench.vue::loadTodo()` | 旧版按 `status==='near' \|\| is_near` 过滤，**后端从不返回这两个字段** → 这条待办永不出现（死判据） |
| 8 | hergent-cn-v2 `DataFill.vue::loadInvStats()` | 未录效期批次数用 `unscanned_batches`（v156 就有），别拿 `total_items` 反推、更别硬编码 428 |
| 9 | hergent-erp `static/js/modules/dashboard/cold-chain-zone.js` | tier key 必须与后端一致（`expired/red/orange/yellow/green`）；**旧版写的是 `safe/watch/warning/critical` → 横幅长期全 0**（该站点当前 404，见 `deploy-ops.md`） |
| 10 | hergent-erp `static/js/modules/expiry-dashboard.js` / `expiry-traffic-light.js` | 「共 N 项」「风险金额」不含关注档；summary 卡标题跟随阈值 |

**下次改动自检**：`grep -rn "total_at_risk\|expired.*red.*orange\|14 days\|within 14" server/ static/ ../hergent-cn-v2/src/`
—— 凡出现**并列写死的三个档位名或 14**，就是要同步的点。

## 8. 🔴 货损**核算**（期间流水口径）≠ 货损**预测**（批次效期口径）（2026-09-17）

**系统里会有两个"货损"，必须先分清是哪一种：**

| | 货损**预测**（已有） | 货损**核算**（待建） |
|---|---|---|
| 页面 | `LossWorkflow.vue`（`/loss`） | 新页 `货损核算（月度）` |
| 数据源 | `inventory` 批次效期（**存量快照**） | 舟谱导出流水（**期间发生额**） |
| 产物 | 「**预计**货损金额」 | 「货损**率**」+ 月度历史 |
| 配置 | `workflow_recipes['loss_recipe']` | ⭐ **必须共用同一份 `pricing` 计价口径** |

⇒ **老页应改名「临期预警与预计损耗」**；否则一个产品里两个"货损"不同口径，用户必然拿去对比。

### 8.1 🔴 核算口径的四条铁律（需求评审实测得出）

1. **分子内不许混币值。** 实测证据：舟谱 `退货订单` 的 `订单金额` = `退货价（折后价）× 数量`
   → **售价口径**；而 `调拨单明细` **根本没有金额列**（只有数量）→ 金额只能按 `purchase_price`
   折算 → **成本口径**。两者相加出来的"金额"**没有任何经济含义**。
   - **实算（毛利率 20%）**：混用 **6.75%** vs 一致口径 **7.63%** → **偏低 0.88 个百分点（相对 11.5%）**，
     且偏差随毛利率变化、**事后无法修正**。
   - ⭐ **反直觉但关键**：一致口径下**选"全售价"或"全成本"结果完全相同**（同比缩放，分母一起变）。
     **错只来自混用，不来自选哪个价。**
2. **抵扣项与被抵扣项必须同币值** —— 2026-09-17 用户**已定案按售价**（理由「代表给公司**挽回了多少金额**」）。
   ⭐ **关键：按售价抵扣 ⇒ `pricing` 必须同时切 `sale`**，否则就是「组合 C 混用」：
   多扣的正好是**临期销售那批货的毛利**。
   实算（毛利率 20%、抵扣额 12,000、成本分母 100,000）：**C = −2.00% vs B = 0.40% → 差 2.4 个百分点**；
   而 A（全成本）与 B（全售价）**只差 0.4 个百分点** ⇒ **混用偏差比口径选择本身大 6 倍**。
   ⇒「选哪个口径」可听用户的，**「是否混用」不能听** —— 必须按自洽落地。
   - 必配护栏：**「临期货折扣率 = 销售均价 ÷ 进货价」列，≥ 95% 标红**
     （售价口径独有的刷数路径 = 把好货当临期正价卖）
   - ⚠️ **负值必须原样显示**（绿色）+ **同屏并列「毛率」让用户自证**，**不许 clamp 到 0**
3. **三个率的分母各不相同 ⇒ 不可加总/平均/比大小**。本域实测：
   门店退货率 ÷**门店销售额** ｜ 业务员调拨货损率 ÷**良品仓发货额** ｜ 公司综合货损率 ÷**公司销售额**。
   ⇒ 名字里必须带口径、列头必须标分母、公司率行必须注明"**不是上面几行的合计**"。
   **能加总的只有金额，不是率。**
4. **没有分母的行不许给"率"。** 「良品仓直调临期仓」（未出公司即临期）与「报损」都没有分母，
   给率等于**凭空造分母** ⇒ 只给金额 + 占公司销售额的百分比；要给率须先由用户指定分母。

### 8.2 🔴 「月账 + 日更 + 留痕」必须三件并存

用户说「以月度为核算单位、支持每日更新、保留历史」—— 三个要求叠加会产生歧义（一个月出现 30 条
互相矛盾的"9月货损率"，用户必然拿错）。**唯一自洽的解**：

| 载体 | 粒度 | 语义 |
|---|---|---|
| `loss_monthly` | **period 一月一行**（每主体） | 当前值，未结账时**可日更覆盖** |
| `loss_daily` | period × 日期 | **只读留痕**，回答"9 月 10 日当时是多少" |
| `loss_import_batch` | 每次导入 | 谁/何时/哪个文件/覆盖哪段时间；可撤销 |

⚠️ **页头必须常显「本期未结账 · 数据截至 X 月 X 日」** —— 否则用户拿月中的数和上月**已结账**数对比，
会得出错误结论。**结账后 `is_closed=1` 锁定**，写操作一律 409，反结账要 boss + 留痕。

### 8.3 率必须与两个操作数**一起存**

`loss_monthly` 里 `rate_num` / `rate_den` / `loss_rate` **三者同存**，并冻结当时的 `pricing`。
只存 `loss_rate` ⇒ 历史月账永远解释不清"这个数是怎么来的"（同族铁律：同屏数字口径必须同源）。

### 8.4 缺分母显示「—」而非 0

`分母缺失 → 货损率显示「—（缺销售额）」`，**绝不显示 0.00%** —— 这是「零值即健康」陷阱在本域的实例。
同族：**报损为 0 但库存有临期批次时，必须提示「本期无报损记录，是否漏录」**（`wastage_orders` 在
tenant_1 实测**整表 0 行** —— 是"从未录入"而非"本月没有"）。

### 8.5 ⭐ 仓位 / 单据的「叫法」必须可配（2026-09-17 用户要求）

用户原话：「不同的经销商叫法不一样，**默认总仓**，但**要支持用户自己改名字**」。

🔴 **判据：任一硬编码在代码里的舟谱字面值 = 一个「只能卖给一家客户」的暗桩。**
（仓名：本客户 `总仓`，别家 `成品仓`；单据名：本客户 `自提订单`，别家 `销售单`。
Hergent 是要卖给多个经销商的，而**你只有一家客户的数据可验证** ⇒ 硬编码的坑要等客户现场才炸。）

| 概念 | 载体 | 规则 |
|---|---|---|
| `role` 稳定键 | `loss_roles.role` | 代码里永不变（`good_wh` / `store_sale_doc` …） |
| `role_label` **显示名** | `loss_roles.role_label` | **用户可改**；🔴 **拿它当识别依据 = 错**（换导出就崩） |
| `alias` **别名** | `loss_role_aliases.alias`（`UNIQUE`） | **识别唯一来源**；一个名称只能属一个角色 |

**四条配套（缺一即不成立）**：
1. **未认领的名称必须带量告警** → `未归类：王琴仓 · 12 行 · 3,240 元` + 「指定角色」下拉，**不静默丢**
2. **改别名必须给「重算本期」路径** ⇒ 硬前提：**事实表存仓名原文**（`src_wh_name` / `dst_wh_name`）。
   只存判定结果 ⇒ 别名一改**永久不可重建**，模块退化成一次性的
3. **命中计数**（`hit_count` / `last_hit_at`）界面可见 ⇒ 反「假旋钮」，用户自己看出生效没生效
4. **单据类型别名 ≠ 判定依据**：别名只管入口文案 + 预选；**最终分流看表头结构**（结构是客观事实，别名是用户输入）

⭐ **预置种子**：`good_wh ← 总仓`（本客户）、`loss_wh ← 临期仓`、`store_sale_doc ← 自提订单`、
`store_return_doc ← 自提退单`；**业务员仓不预置** —— 由 `report_mapping.src_wh/dst_wh` 动态认领，
避免出现「两份清单互相不一致」的经典漂移。

### 8.6 🔴 自提版式（退货单 / 订单）的三个解析坑（2026-09-17 实测）

- 🔴 **必须只取 `状态=已完成`** —— 该版式有 `待审核` / `已取消`，全取会让分子**虚高**（已列为第 4 道闸）
- 🔴 **`仓库` 列在两个版式里语义相反**：退货单 = **退到哪个仓**；销售单 / 订单 = **从哪个仓发货**。
  同名不同义 ⇒ 必须**版式分流之后分别映射**，不可复用同一段逻辑
- ⭐ 自提版**自带 `业务员` 列**（调拨单没有）⇒ 业务员维度拆分可行；且 r3/r4 筛选条件行可**自动读出**
  用户导出时筛的时间段（免费的重叠 / 缺口检测依据）
- ⚠️ 「自提**订单**」版式**尚未实测**（上一轮只读了「自提**退单**」）⇒ 订单侧设计目前是**同构假设**，
  开工前先拿一份真导出核对列名

---

## 9. 🔴 核算页落地时固化的四条判据（2026-09-17，`/loss-accounting`）

> 代码：前端 `hergent-cn-v2/src/pages/LossAccounting.vue`（新）＋ 后端
> `hergent-erp/server/routers/loss_accounting.py`（新，含 9 张表 / 18 个端点）。
> 🔴 与 `LossWorkflow.vue` + `loss_workflow.py`（批次效期**预测**）**是两套东西**，别互相改。

### 9.1 ⭐ 列定义必须由后端**单源下发**，前端零硬编码

后端 `LOSS_COL_DEFS`（14 列）＋ `LOSS_SLOTS`（8 个列位的中文表头）随
`GET /api/loss/accounting/bootstrap` 一并下发；前端**不写任何列名 / 列序 / 可否编辑的第二份定义**。

- 每条列定义带四个字段决定渲染：`slot`（列位）· `scope`（对该行类不适用 → 不渲染）·
  `role`（denominator / numerator / deduction / derived，决定列头附注与是否给输入框）· `editable`。
- 🔴 判据：**前端出现任何列字面量（列名数组、列序数组、可编辑列名单）＝ 第二份拷贝**（项目铁律
  「第二份拷贝 ＝ 静默漂移」）⇒ 加列时后端改一处、前端零改动。
- 同源要求下沉到后端内部：`_EDITABLE_COLS` / `_COL_LABEL` 一律由 `LOSS_COL_DEFS` **派生**，不手写第二份。
- `slot` 的作用是**让四类行竖向可比**：`den`/`num`/`ded`/`gross`/`net`/`rate_gross`/`rate_net`/`extra`
  八个列位被四类行共用 ⇒ 同一张表里行与行能横向对齐看。各 row_kind 的 slot **不得重复**（有断言锁）。

### 9.2 🔴 「停用主体」的写权限必须分三支，且**虚拟主体必须无条件放行**

`PUT /api/loss/accounting/manual` 的主体校验矩阵：

| 主体状态 | 本期有没有存量值 | 处置 |
|---|---|---|
| 启用中 | — | 允许写 |
| 已停用 | **有** | **允许写** —— 这是「修正历史」，不是「新增数据」（否则上期的数永远改不了） |
| 已停用 | 无 | **拒** —— 它根本不在表上显示，写进去＝静默成功但用户看不见 ⇒ **比拒绝更糟** |
| ③直调 / ④报损 / 公司行 | — | **无条件允许** —— 它们是**固定虚拟主体**，不存在于 `loss_subjects` 表 |

- 🔴 第三行最容易漏：`("direct","")` / `("wastage","")` / `("company","")` 必须
  `known |= virtual; active |= virtual`。漏掉的后果是**这三类行永远填不进去**，且报错说"主体已停用"
  （端点层测试才抓到，静态读代码看不出来）。
- 「本期有没有存量值」的集合 `grace` 从 `loss_manual_inputs` 按 `period` 查。

### 9.3 🔴 万元 ↔ 元换算必须 round 到「分」

项目口径：**存储元，录入与展示统一万元**（金额精确到元）。

- 反例：`0.8333 万 × 10000 = 8332.999999999999` ⇒ 浮点残差进库，显示时又被四舍五入成"看起来对"的数
  ⇒ **最难查的一类对账差异**（数字对、账不平）。
- 唯一实现：`wanToYuan()` = `Math.round(n * 10000 * 100) / 100`；`wanText()` 反向走**同一常量**
  `YUAN_PER_WAN`（换算率只此一份）。
- 用 `tests/loss-accounting-money.contract.mjs` 从 SFC **eval 真实实现**锁住往返（元→万元 / 万元→元 /
  往返 / 边界），不是在测试里重写一遍换算。

### 9.4 ⭐ 新路由可**零登记**落进已有 RBAC 模块（靠前缀匹配）

`server.py` 的 `_PATH_MODULE_MAP` 是**前缀**匹配（首个命中者胜）：已有 `"/api/loss": "stock"` ⇒
`APIRouter(prefix="/api/loss/accounting")` **自动归 stock 模块，无需新增登记**。

- 反之：前缀落不进任何已有键时必须显式登记，否则 fail-closed **403 `MODULE_NOT_CONFIGURED`**。
- 判据仍是老规矩：**不信 grep，打印路由表** —— 静态（AST）18 条 = 运行时 import 18 条 ／ 无同
  method+path 重复 ／ 参数路由不在同形静态路由之前（否则吞静态路径返 422）。

### 9.5 本轮还落地的两个可复用形态

- **月账 vs 日快照语义不同**：`loss_monthly` 用 `INSERT OR REPLACE`（语义＝"这期当前是多少"，覆盖式快照）；
  `loss_daily` 按 `(period, snap_date, row_kind, subject_key)` 主键（语义＝"变化轨迹"）。
- **结账状态唯一权威是 `loss_config.closed:<period>`**；`loss_monthly.is_closed` 只是**快照副本**，
  所有判定一律走 `_closed_map()`，不读副本列。

---

## 10. 入口收口 + 按月仪表盘设计（2026-09-18，v185）

### 10.1 🔴 「删掉重复入口」必须先把**所有**出口扫出来 —— 侧栏从来不止一处

删「货损计算」时实际命中 **3 处出口**（用户只看到侧栏那 1 处）：

| 出口 | 处置 |
|---|---|
| `Shell.vue` 桌面 `.sb-item` + 移动 `.md-item`（**各 1 行 ⇒ 侧栏其实是 2 行**） | 删 |
| `CommandPalette.vue` ⌘K 面板项（`id:'loss'`，`/loss`） | 改指 `/loss-accounting`，图标 `flame`→`receipt` |
| `api/modules.js` / router 等 | 未动（见下） |

**判据**：改导航前先扫五类出口 —— ① `Shell.vue` 桌面 `sb-item` ② `Shell.vue` 移动 `md-item`
③ `CommandPalette.vue` ④ 工作台/首页**待办卡深链** ⑤ AI 建议卡 `TYPE_MAP` 类型标签。
④⑤ **多数不该改**（它们是**内容深链 / 类型标签**，不是导航）。⚠️ 用 `grep -e 'to="/loss"' -e "path: '/loss'" -e '"/loss"'` 三形式都扫，
只扫 `to=` 会漏掉命令面板的 `path:`。

### 10.2 🔴 「收口」收的是**入口**，不是**能力** —— `/loss` 路由必须留着

删侧栏/面板入口后，`router/index.js` 的 `/loss` 路由**刻意保留**：旧书签、外部链接、
其它页深链仍要能进去（`LossWorkflow.vue` 是批次效期页，还在用）。**404 不是收口，是事故**。

判断某个 `/loss` 引用该不该跟着改：**看用户点过去之后能不能干成他想干的那件事**。
- `Workbench.vue:357` 待办卡「N 批已过期」→ `/loss` = **批次清单深链** ⇒ **不改**（核算页按月看流水，
  没有批次清单，改过去等于把用户送到一个答非所问的页面）。
- `AdvicePanel.vue:47` `TYPE_MAP.loss_calc='货损计算'` = AI 建议卡的**类型标签** ⇒ **不改**。

### 10.3 ✅ 多期端点 `GET /trend` 已落地（09-18 当日 #2 轮，v185-trend）

`loss_accounting.py` 原有 18 个端点都是**单期**口径（吃一个 `period`）⇒ **画不出趋势**。
新增 `GET /api/loss/accounting/trend?from=&to=&limit=`，**逐期复用 `_compute(c, p)`**
（不许在 trend 里第二遍实现算法 —— 项目铁律「第二份拷贝＝静默漂移」）。
落进已有 `"/api/loss": "stock"` 前缀 ⇒ RBAC **零登记**（线上 200 无 403，实测）。
🔴 **本端点刻意不接受 `pricing` 入参**（原设计的 `?pricing=` 是假旋钮）：
计价口径按模块铁律①是**全期唯一**的配置 ⇒ 传了也不会变数，那种"切了没反应"的旋钮不接。
参数 `from`（含）/ `to`（含，不传=当前期次）都是 `YYYY-MM`；`limit` 与 `from` 二选一，
上限 `_TREND_MAX_MONTHS=36`，越界/起始晚于结束 → **422**。
`/trend` 的**合同细则**见 §11。

### 10.4 按月页面/仪表盘的设计判据（设计稿见 `outputs/货损核算-2026-09-18/`）

- **字段一律对齐既有 DDL，不新造字段、不改 DDL**（`loss_monthly` 已有期次/行分组/主体/金额/结账态）。
  `loss_daily` 是「变化轨迹」，`loss_monthly` 是「这期当前是多少」，两者语义不同不合并。
- 🔴 **`loss_monthly` 只在结账时物化**：每次保存都写 = 同期两份口径 ⇒ 静默漂移。
- 仪表盘 = 主图（**双柱 + 净率折线，双轴各自带刻度**）+ 构成堆叠 + 抵扣对比 + 主体排行（4 图）
  ＋ 5 指标卡 ＋ 6 筛选（期段 · 计价口径 · 主指标 · 主体维度 · 含未结账月开关）。
- **空月不画 0**：虚线框占 `未录入`，**折线必须在空月断开**（连起来＝凭空造一段趋势）。
- 沿用域内三态：`—`（无分母，率算不出）/ `未录入`（没填过）/ `0`（确实填了 0）；
  ③良品仓直调临期仓、④报损**没有分母 ⇒ 不给率**。
- ⚠️ **设计稿自己也要过项目铁律**：本轮原型首版就踩了「双轴图右轴忘刻度」「轴上限非整值」
  「工具栏按钮是死控件」三条 —— 出稿前按自家铁律自检一遍。


## 11. 🔴 跨期趋势（`/trend`）的合同 —— 09-18 实现时固化，改前必读

> 位置：`server/routers/loss_accounting.py`；前端 `components/LossDashboard.vue`（纯展示）+
> `pages/LossAccounting.vue`（取数/筛选/月列表）。本地断言脚本
> `.workbuddy/tools/loss-trend-local-verify.py`（68 条）+ `.workbuddy/tools/loss-dashboard-local-preflight.js`（33 条）。

### 11.1 ⭐ 率的唯一实现抽成 `_agg(kind, num, ded, den)` —— 单期与跨期共用

三个**已求和**的操作数进去，金额与率出来。`_subtotal`（单期分组小计）与跨期累计**都调它**
⇒ 「先求和再相除」只有一份代码。
`_KIND_NUM_COL` / `_KIND_DEN_COL` / `_KIND_DED_COL` 三张表决定**给不给率**（`has_rate`）—— 只此一份。
⚠️ `company` 在 `_KIND_DEN_COL` 里但**不在** `_KIND_NUM_COL` 里：它的分子是四组之和，不由列求和得到。
**重构等价性必须自证**：把 HEAD 版模块 `exec` 进内存，逐期对比 `_compute` 输出，唯一允许差异 = 新增
`ded_sum`（本轮实测六期逐字相同 ⇒ 对既有输出零影响）。

### 11.2 🔴 跨期合计只累加**操作数**，率最后相除

`Σrate_num_gross ÷ Σrate_den`、`Σded_sum`、`Σrate_den`、`Σrate_num`。
**累加「率」本身无意义**（各行分母不同）。⚠️ 这与「各月率的算术平均」极易混淆，
构造数据实测差得很远（加权 **0.7506** vs 平均 **0.5305**）—— 断言里必须有一个能区分两者的用例。
另报 `months_with_den`（**率的实际基数**）：缺分母的月不计入，否则率的分母来路不明。

### 11.3 🔴 空月 = 全字段 `null`，**分组小计也要一并置空**

`has_data=false` ⇒ 公司行各字段 `null`（**不是 0**）；**并且** `groups` 里凡是求和的字段一并 `null`
（常量 `_NULL_SUM_KEYS`）。
⚠️ **只把公司行置空不够**：任何直读 `groups` 的图都会把空月画成 0 柱 —— 「零值即健康」陷阱的又一入口。
🔴 **无数据的月必须留在序列里**（`_month_seq`）：抽掉空月会把「中间 3 个月没录」画成「连续下降」。

### 11.4 🔴 「整月未录入」≠「漏了一项」：`gaps` 在整月未录入时返回**空清单**

`_month_gaps(..., has_data=False)` 直接 `return []`。否则该月报「缺 6 项」，
用户看到满屏红字**分不清"整月没填"与"漏了一个格"**（本轮实测踩到，是真实缺陷）。

### 11.5 🔴 抵扣求和 `ded_sum` 与「区间零抵扣」的诚实性

- 跨期累计**不能**用 `gross − net` 反推：四舍五入后有分位残差 ⇒「看起来对的错数」。
- 区间内**一次都没录抵扣** ⇒ `ded_sum = null`（不是 `0.00`，否则被读成"临期货一分钱没卖"）；
  `net_amt` 照留（= 毛额，算术上唯一诚实），由 `months_with_ded` 让前端提示「净额偏大」。

### 11.6 🔴 两个筛选开关的语义**必须互不重叠**（本轮定的规则）

| 开关 | 作用 |
|---|---|
| 跳过未录入月 | 无数据的月**整列拿掉** |
| 只看已结账月 | 未结账月**留在时间轴上，只有灰占位** |

两者同开：有数据但未结账 → 灰占位；无数据 → 整列拿掉。
⚠️ 我一度写成「隐藏的空月既不属于甲也不属于乙」，两边都不认领 ⇒ 真歧义。**定成互斥两条规则**后才能断。
（影响取数的是**区间**，两个开关只影响**显示**；但无论如何都必须在界面上明说这一屏看的是哪几个月。）

### 11.7 🔴 环比纪律 + 单位

只跟**上一个自然月**比，**不跨缺口**；上月未录入显示「上月未录入」（不是 `—`，也不是拿更早的月来比）。
**金额环比用 `%`；率的变化用「个百分点」** —— 两个单位不可互换（见 `cross-domain-iron-laws.md`
与 user-level 记忆）。首次月显示「首次」。

### 11.8 前端的派生全在 `LossDashboard.vue` 之外

`LossDashboard.vue` **纯展示**（props 进、emit 出，不取数、不定义业务语义）：
组名/组序来自后端 `row_groups`，前端只按顺序配色。
筛选（区间/两开关）与月列表在 `pages/LossAccounting.vue`；联动刷新点 = `reload` / `saveManual` /
`toggleClose` / `onChangePricing` / `doRecompute` / `onMounted` —— **任何一个写路径都要顺带刷图**，
漏一个就出现「数改了图没变」。
折线在空月/缺分母月**必须断开**（`rateSegs` 分段 polyline）；**双轴各自带刻度**；
**刻度小数位由步长决定**（`decimalsFor`），避免同轴同时出现 `1.0%` 与 `0.50%` 两种精度。

### 11.9 ⭐ 页内主 Tab：「仪表盘 / 数据填报」分屏（2026-09-18 v185，改前必读）

**触发**：用户「请参照目标与返利模块，把仪表盘和数据填报页面分开」。

**形态**：`pages/LossAccounting.vue` 页头下方一组 `.main-tabs` ——
**「仪表盘」/「数据填报」**，`mainTab` 默认 `'dashboard'`，
用 `<template v-if="mainTab === 'dashboard'|'fill'">` 分成两块（**不是 `display:none`** —— 对方 DOM 真的不存在，
断言据此判定「已移除」）。

| tab | 内容 | 可写? |
|---|---|---|
| `dashboard` | 区间筛选条 + 按月一览（`.la-ml-tbl`）+ `<LossDashboard>` | ❌ 全只读 |
| `fill` | 工具条 `.la-bar` + 编辑条 `.la-editbar` + 公司卡 + 主表 `.la-tbl` + `la-footnote` | ✅ **唯一能写的地方** |

- 🔴 **`.main-tabs` / `.main-tab` 的样式在 `styles/variables.css`（全局层），全站唯一一份** ——
  原在 `Rebate.vue` 的 scoped 里，因两页要共用而**上提**（否则逐轮漂移）。
  `Rebate.vue` 里那句「本页 @media print 隐藏 .main-tabs」**保留**（只作用本页）。**本页不得再定义一份。**
- 🔴 **两 tab 共享同一个 `period` ref**（对齐返利页月份双向同步）⇒ 不存在"两个 tab 各有一个月份"的错配。
  **切 tab 不重新取数**：两 tab 读的是同一份 `trend` + `bootstrap`，刷新点仍是 §11.8 那 6 个写路径。
  （返利页按需拉取是因为它两 tab 数据集**不同**；本页再拉一次只会造出"同一份数据两条刷新路径"。）
- 🔴 **点柱子 ≠ 去填报**：图上 `@pick` → `pickMonth(p)` = 切期次 + **留在仪表盘**（要能连续比各月）；
  月列表操作列 `goFill(p)` = 切该月 + **跳填报 tab**（文案 `查看` → **`去填报`**）。
- 🔴 **分 tab 引入的诚实性缺口（最容易误解的一处）**：仪表盘只读**已保存**的数据，草稿在那一屏**不可见**
  ⇒ 必备两条：① 顶部 `v-if="dirtyCount"` 的 `.la-tabnote`
  「当前有 N 格录入改动尚未保存 —— 本页读的是已保存的数据，切到「数据填报」保存后才会更新」；
  ② `blockIfDirty(what)`：**凡从仪表盘发起的换期次一律拒绝** + `switchTab('fill')` 把人送回能保存的地方
  （点一下柱子就无声丢掉半天录入，是最难自查的一类数据损失）。
  ⚠️ **填报页自己的期次下拉切月仍不拦草稿**（v184 既有行为，尚未统一）。
- **`const mainTab = ref('dashboard')` 声明位置**：放在 `loading` 之前（最前）。`switchTab`/`goFill`
  虽是函数无 TDZ 风险，但一旦后续有顶层求值引用它，定义靠后会直接抛
  `Cannot access before initialization`（返利页 v123 踩过）。
- **删掉的旧补丁**：原「录入态整段收起趋势」的 `v-if="!editMode"` + 编辑条里那句
  「趋势图与月列表已在录入态收起」—— 分 tab 后不再需要，**别再加回来**。
- ⚠️ **探针要跟着 DOM 归属走**（分 tab 是「探针偏航」的第五形态）：`# 2 ~ # 6` 段（公司卡/主表/工具条/
  录入态）必须先切到填报 tab；`# 6.5` 再切回。本地预检里 `.la-sel`（期次下拉）只在填报 tab
  ⇒ 改读 `.la-ml-tbl tbody tr.la-ml-cur > .la-ml-m b`。类名一律**精确**，禁用 `[class*=]`。
- 断言：`tools/loss-dashboard-local-preflight.js`（本地）+ `tools/loss-accounting-prod-verify.js`（生产只读，44 条）。



## 12. 🔴 ③「良品仓 → 临期仓」的抵扣与公司行是**包含关系**（2026-09-18 v186，改口径前必读）

**触发**：用户「请给『良品仓 → 临期仓』加一个『临期销售抵扣』填报入口，同时把
『临期销售抵扣』改成『临期销售』」。（原文「抵抗」按上下文判定为「抵扣」错字。）

### 12.1 新增的可填列

| 项 | 值 |
|---|---|
| key | `direct_loss_sale_amt` |
| slot | `ded`（与 ② 行**同一个列位** ⟹ 表头共用「临期销售」这一个 label） |
| scope | `["direct"]` **只含 ③ 行** |
| 列位表头 | **临期销售**（本次由「临期销售抵扣」改名） |
| 该格标题 | 临期销售额 |

③ 行此前只有「直调临期仓额」一个可填格 ⟹ 净额永远 == 毛额 ⟹ 等于宣称
「直调进临期仓的货一分钱都没卖回来」。**新列一加，`_KIND_DED_COL` 也要加 `direct`**
（那是抵扣的**唯一定义处**：加一行，`_subtotal` 与 `/trend` 同时生效）。

### 12.2 ⭐ 口径：包含关系，不是重复扣减（本轮唯一的口径决定）

```
公司分子 = ①门店退货 + ②业务员仓调临期 + ③良品仓直调 + ④报损 − 临期仓销售总额
临期仓其他渠道销售 = 临期仓销售总额 − ②业务员自售 − ③直调临期销售
```

- **公司行扣的永远是「临期仓销售总额」**，故 **③ 行新增抵扣不改变公司净额**（真机 + 本地双向自证）。
- ② ③ 行的抵扣是「**行内自己认领**」的那部分；**三行相加恰好等于总额，不重不漏**。
- 前端「展开构成」必须把这三项都摆出来（② 行 / ③ 行 / 其他渠道），
  底部 `la-bd-note` 明写「是包含关系，不是重复扣减」——**这是最容易误解的一处**，
  一旦有人把它当成「重复扣了两次」去"修"，就会把公司口径改错。
- ⚠️ **`loss_wh_sale_other_amt` 必须减掉 ③ 直调临期销售**，否则同一笔钱被展示两次。

### 12.3 🔴 「零值即健康」陷阱在 ③ 组的第三形态

③ 组整组未填时，后端小计 `ded_sum` 也是 `0.0` ⟹ 显示成 `0` 会被读成
「临期货一分钱都没卖出去」。**判据放在显示层**（`subText` 的 `ded` 分支），
用前端手里已有的原始行数据 `groups[2].rows[0].values.direct_loss_sale_amt != null`。
🔴 **刻意不给后端加「填过几行」的计数字段** —— 同一件事不该说两遍
（`_subtotal` docstring 里写明了这个取舍，**别当成"漏了个字段"补回去**）。

### 12.4 连带修好：`_company_quality` 的告警原先只统计 ② 行

③ 行也能填抵扣后，那条告警会**漏报 ③ 行认领的部分**。已改为
「临期仓销售总额为 0，但 ②业务员自售与 ③直调临期销售**合计** X」。
⟹ 通用判据：**任何"某几行加总"的告警，在新开一个同类填报入口时都要跟着扩**。

### 12.5 列位改名的波及面（后端 5 处 + 前端 7 处）

后端：`LOSS_SLOTS.ded.label` / `gross_amt`·`net_amt`·`loss_wh_sale_other_amt` 三条 hint /
`ROW_GROUPS[direct].desc` / ② 行质量提示。前端：`LossDashboard.vue` 的副图标题·图例·
aria-label·tooltip·脚注 + `LossAccounting.vue` 的计价口径 hint。
⟹ 改列位名时按「`grep -c 旧词` 全仓 = 0」收口，别只改表头。

### 12.6 验证落点

- `tools/loss-trend-local-verify.py` **97/97**（隔离目录 `/tmp/loss-trend-harness`）——
  `PLAN` 的 `direct` 由标量改 `(直调额, 直调临期销售)` 元组；新增 ⑫ 段 20+ 条；
  ⑬ 段改为**变更集封印**（exec HEAD 版模块逐叶子路径比对，未登记差异 = 0 **且** 登记每一条都真变了，双向）；
  fixture 2 → 4 份（`bootstrap-2026-07` 负净额 / `bootstrap-2026-08` 只填直调额）。
- `tools/loss-dashboard-local-preflight.js` **66/66**（`# 7.8` 段 10 条）。
- `tools/loss-accounting-prod-verify.js` 生产只读 **59/59**（`# 4.5` 只读态 9 条 + `# 5.5` 录入态 6 条；
  含「② 行该列照旧可填」回归闸 —— 同 slot 的另一列别被 scope 收紧误伤）。
- 提交：`hergent-erp` `505ebe1`（42+/16−）· `laozhangai-product` `0aef57e`（11 files）。
- 只读纪律照旧：**生产 `tenant_1` 从不写入**；③ 行未填就显示「—」。

### 12.7 ⭐ 追加轮（v186-2）：三个粒度统一成「临期销售」

**用户指令**：「统一成「临期销售」」（承接 §12 那句"要统一成一个词说一声即可"）。

统一前的**三个**变体（同一笔钱）：

| 粒度 | 载体 | 原值 → 现值 |
|---|---|---|
| 列位表头 | `LOSS_SLOTS.ded.label` | 临期销售（不变） |
| ② 业务员行 | `op_loss_sale_amt.label` | **临期货销售额** → 临期销售 |
| ③ 直调行 | `direct_loss_sale_amt.label` | **临期销售额** → 临期销售 |
| ② 行传述 | `ROW_GROUPS[operator].desc` | **临期货销售额** → 临期销售 |

⚠️ ② 行的「临期货销售额」是**本轮才发现的第三个变体**（不在原提问里）—— 按"统一成一个词"
的意图一并收口。**通用判据：用户说"统一成 X"时，先 grep 出**全部**变体再动手**，
否则会漏掉用户没看见的那个（他看得到的是表头，看不到另外两个）。

#### 🔴 12.7.1 `col_defs[].label` 在页面上**不显示**（本轮最重要的技术事实）

| 落点 | 是否可见 |
|---|---|
| 列位表头 | ✅ 取 `slots.ded.label` |
| 格子悬停提示 | ❌ 用的是该列 `hint`，**不是 label** |
| 保存时的校验错误提示 | ✅ `badCols.push(c.label)`（例如填负数 → 「临期销售（不能为负）」） |
| 溯源 / 修改日志的字段名 | ✅ `_COL_LABEL` 查同一份注册表 |

⟹ **"三个粒度是否同一个词"这条判据只能在数据层取**（读 `bootstrap` payload）；
只读 DOM 会**误判成通过**。也**别误判成"改了没用"** —— 错误提示与溯源弹窗里就是用户看得到的。
⟹ 推论：**本轮前端零硬编码 ⟹ `dist` 未重建未重部署，只部署后端一个文件**（3+/3−）。
（顺带避开"共享 `dist/` 夹带他人未完工改动"，比上一轮省掉整条差集核查链。）

#### 🔴 12.7.2 「变更集封印」的形态**随轮次演进**（别照抄上一轮）

- v186-1：`ALLOWED` = 登记 13 条叶子路径（"允许这些差异"）。
- v186-2：上一轮那批已随 `505ebe1` 进 HEAD ⟹ **照抄必报 missing**。
  **那是封印在提示"HEAD 推进了、登记集合该重写"，不是代码出错。**
  本轮的语义是"只改标签 ⟹ `_compute` 逐字零差异" ⟹ 白名单清空、**判据收紧**。
- ⭐ 新增 **⑬-2 双向封印**：每条断言都带 HEAD 反证
  （HEAD 版 = 临期货销售额 / 临期销售额）⟹ 既证明"改了"，也排除"碰巧本来就对"。
  另有「三粒度取同一个字符串」单独断言 —— 逐个"等于新词"只保证各自对，
  保不了互相一致，将来谁只改一处会漏检。
- 工具调用落点：`loss-trend-local-verify.py` ⑬ 段（**102/102**）。

#### 12.7.3 生产实测（真机只读，**65/65**）

新增 `# 4.6` 段**直读 payload**（不读 DOM）：`列位表头 / ② 行 / ③ 行 = 临期销售 / 临期销售 / 临期销售`，
三个旧变体各 **0** 处。

#### 12.7.4 别去改会让人误解成残留的地方

- `outputs/…/11-…交付说明.md` 的「八」章节**故意**保留旧变体字样（写清"从什么改成什么"）
  ⟹ 该文件在 commit spec 里 **`gone` 必须留空**，否则误报。
- 仓库根 `Hergent-货损核算模块设计方案-2026-09-17.md` 的「临期货销售额抵扣」是**历史设计决策名**，
  保留（改它 = 抹掉历史），不在本轮范围。
- `outputs/货损核算-2026-09-18/01-设计方案.md` 是活文档 ⟹ 标签表已同步
  （并补上上一轮漏登记的 `direct_loss_sale_amt` 行）。

---

## 13. ⭐ 仪表盘「视觉层」的契约与色板（2026-09-18 v187，改视觉前必读）

v187 = **纯前端视觉重做**（配色 / 图表样式 / 排版层次 / 组件间距），后端零改动。
用户点名要求「原有数据指标和功能完整保留」⇒ 交付自证必须同时证明**没丢东西**
（数据项 · 图表数量 4 张 · 筛选 · 交互全留）。

### 13.1 🔴 图表语义色板 = 在 `.dsh` 作用域内另立，**不动全局**

全站 `--war`(#ff9f0a) / `--dan`(#ff3b30) 是**警示语义**（小面积徽标、告警条）。直接铺整片柱体
既刺眼又会与「告警」混淆 ⇒ 在 `.dsh` 里另立 12 个 token：

| token | 用途 |
|---|---|
| `--c-gross` / `--c-net` / `--c-ded` / `--c-rate` | 毛额柱 / 净额柱 / 临期销售（抵扣）柱 / 净率折线 |
| `--c-g1..--c-g4` | 副图 A 堆叠的四组分色（**按后端 `row_groups` 顺序取色**；前端不定义组语义） |
| `--c-grid` / `--c-axis` | 网格线（浅实线，**不再用虚线**） / 零轴 |
| `--c-ph-bg` / `--c-ph-bd` | 「未录入」占位框底 / 边 |

- **浅色 + 深色两套**。深色 = `documentElement` 上的 `.dark` class（**不是** `data-theme`、
  也不是 `prefers-color-scheme`）⇒ 选择器写 `html.dark .dsh { … }`。
- 🔴 SVG **presentation attribute 里写 `var(--x)` 是否生效依浏览器而定** ⇒ 必须实测
  `getComputedStyle(rect).fill` 真解析出 `rgb(...)`，否则柱子可能**静默变黑**（预检已加此断言）。

### 13.2 🔴 规格必须收敛到全局层，不许各页自造

- KPI 概览条：`variables.css` 明文写「顶部概览统计统一用 `.kpi-strip`，不再各页自造」——
  仪表盘原来自造的 `.dsh-kpis/.k` 正是被点名要收口的第二种实现 ⇒ 已换掉。
  运行期把关点：`document.querySelectorAll('.dsh-kpis, .dsh .k').length === 0`。
- 卡片标题：图表卡与「按月明细」卡原本各写一份 ⇒ 上提为全局 **`.sec-hd` / `.sec-sub`**
  （`variables.css` +26 行，**只新增类、不动任何既有规则**）。
  ⚠️ `.sec-hd::before` 左竖条用 `left:-18px` 正对着 `.card` 的 `padding:18px` ⇒
  **它必须是 `.card` 的直接子元素**，否则竖条会飘出去。

### 13.3 🔴 两个「12 个月才暴露」的缺陷 —— 都是几何/布局，不是数据

1. **副图 B 三柱共用柱宽 ⇒ 柱群超出列宽**：12 个月时列宽仅 ~79px，而 `4*bw+8 >` 列宽，
   柱群会挤进相邻月份。原先是**「藏」着的** —— 以前只有最右列有数据，右边正好有 `padR` 接住。
   修法 `bw3 = min(bw, max(5, (slot-16)/4))`（按「列宽减两侧留白」反算上限），实测 43.3 vs 78.8。
   **生产默认就是 12 个月 ⇒ 必验项**（已进真机 68 项）。
2. **11 个未录入月连成一片「灰墙」**：占位框原为**整列宽** ⇒ 收成「该月柱群宽度」
   （`x = cx - bw - 2` / `w = bw*2 + 4`；副图 B 用 `w = bw3*4 + 8`）。

### 13.4 读图顺序（本轮定的布局判据）

仪表盘 tab 内：`la-tbar`(筛选) → **概览条 + 趋势图** → **按月明细（后置）**。
判据：第一眼该是概览与趋势；按月明细是「回头查证据」用的。
断言用 `compareDocumentPosition() & DOCUMENT_POSITION_FOLLOWING`（**不要**比较 y 坐标）。

### 13.5 留证据的两个坑

- 🔴 Shell 内容区是**内部滚动** ⇒ `page.screenshot({fullPage:true})` **只截一屏**。
  拍下半屏须找 `scrollHeight > clientHeight` 且 `overflowY ∈ {auto,scroll}` 的容器、
  手动设 `scrollTop`，截完**还原 0**。
- 🔴 探针断言会随视觉改动**静默失效**：`circle[r="3.2"]`（率点半径改了）、`.dsh-kpis .k`
  （KPI 结构换了）。**改视觉必同步改探针**，并在注释里写清「当前期次标记 r=4」这类易错量，
  否则下一轮又数错。
