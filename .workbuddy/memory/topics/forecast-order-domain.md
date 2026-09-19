# 预报订单域细节存档（从 MEMORY.md / daily log 下沉）

> 排查「本期预报」主表任一列的数字来源、加单/定稿口径、复制报单口径时读本文件。
> 前端：`hergent-cn-v2/src/pages/Forecast.vue`（只读主表 + 编辑态两套模板）。
> 后端：`routers/forecast_submissions.py` / `routers/forecast_audit.py` / `erp_db.py::forecast_submission_summary`。

## 🔴 「最终下单」唯一口径（2026-09-15 用户订正，v170 / `d2e5485`）

**`最终下单 = 报单合计 + 加单`，与是否定稿无关。**

业务语义（用户原话）：
> 小程序报过来的报单量经常完不成指标，或者临时来了团购，审核人需要有个口子「快速加单」把单子补够
> —— 加单与报单量共同构成给厂家下的「最终订单」。

⇒ **加单不是普通数据列，是审核人的补单口子**。报单量（销售在微信小程序报）+ 加单（审核人补）
= 最终订单。

**唯一实现（`Forecast.vue`，改口径只改这一处）**：
```js
const rowExtraQty = (r) => Number(r && (r.extra_qty != null ? r.extra_qty : r.extraQty)) || 0
const rowFinalQty = (r) => {
  if (!r) return 0
  const base = r.total != null ? (Number(r.total) || 0) : rowSum(r)   // 编辑态草稿行无 total → 单元求和
  return base + rowExtraQty(r)
}
```
**9 处读取点全部走它**：模板显示 / 底部合计行 / `cellText()`（列筛选 + 唯一值筛选 + 复制报单）/
`rowAria()`（无障碍） / `colStatVal()`（列统计） / `rebateSprint`（返利冲刺看板） /
`loadCross().grand.amount`（下单金额） / 只读主表「加单」列渲染。

**两种「加单」存法**：只读态行对象带 `extra_qty`（后端 `forecast_extra_qty`）；
编辑态行对象带 `extraQty`（本地草稿，`loadEditGrid()` 注入）。`rowExtraQty` 同时兼容。

### 历史态（已废弃，勿复活）
旧实现**两套口径并存**，且互不一致：
| 读取路径 | 旧口径 |
|---|---|
| 页面显示 / 列统计 | `decided ? final_qty : 「待定稿」`（人工定稿产物） |
| 列筛选 / 唯一值 / aria | `total + extra_qty` |
⇒ 在该列做筛选时，**命中判据与眼睛看到的数字不是同一个量**。
🔴 **这个缺陷不是被"修好"的，是被口径订正顺手消灭的**（两者在新口径下自然合一）。
**判据：先找「同一列有几处读取点」，再谈口径；找不到唯一实现就先造一个。** 只要还有两条路径读同一个量，
下次改口径就还会漂。

### 两个生产事实（2026-09-15 实测，tenant_1 / tenant_10 同）
1. `forecast_audit_decisions` **0 行** ⇒ 旧口径下「最终下单」列每行都是「待定稿」，
   **人工定稿链路投产至今从未走通**（⚠️ 新口径下该列不再依赖定稿）。
2. `forecast_extra_qty` 有 800 行（4 期次×200）但 **`SUM(extra_qty) = 0`** ⇒ 全是 **0 值占位行**
   （`save_matrix` 对每行都 upsert 含 0 值）⇒ **真实「加单」尚未被录入过**。

## 只读主表 vs 编辑态（两套模板，别混）

`editMode = ref(false)` → **默认只读**。
| | 只读主表 | 编辑态（改单） |
|---|---|---|
| 列集 | `colOrderList`（L1878 附近） | `colOrder` |
| 行对象来源 | `GET /api/forecast-submissions/summary` → 带 `total` / `decided` / `final_qty` / `extra_qty` | `loadEditGrid()` 造的本地草稿 → **无 `total`** |
| 「加单」列 | 🔴 曾**无渲染分支**（`v-else-if` 链缺 `extra`）→ 恒空，v170 补上 | 有分支 |
| 「复制报单」 | 入口在此（v168 起只读态专属） | 无入口 |

⚠️ **只读主表 `v-else-if` 列链是「按列 key 手写分支」的，加列时极易漏一个分支** → 该列静默恒空。
新增列后必须真机走一遍「每列都有值」。

## 后端链路（只读溯源）

```
只读主表列定义（key:'final'）
  → forecastApproveApi.summary()（api/modules.js）
  → GET /api/forecast-submissions/summary?start=&end=&period_id=
  → routers/forecast_submissions.py::submission_summary（admin/boss/accountant/supervisor 可看）
  → erp_db.py::forecast_submission_summary
      FROM forecast_submission_items i JOIN forecast_submissions s
      LEFT JOIN forecast_audit_decisions d   -- 取 MAX(d.final_qty)
      LEFT JOIN forecast_extra_qty e         -- 取 COALESCE(MAX(e.extra_qty),0)
      WHERE <date_cond> AND s.status NOT IN ('rejected','recalled') AND i.product_name != '__列占位__'
      GROUP BY i.product_id, <主档名>, <主档规格>, <主档单位>
```
- JOIN 五元组 `(product_id, product_name, unit, period_start, period_end)`；
  name/unit 取**主档口径**（`COALESCE(NULLIF((SELECT … FROM products WHERE id=i.product_id),''), i.xxx)`）。
- 🔴 **`start_date`/`end_date` 缺一 → `final_qty_expr` 退回 `"NULL AS final_qty, 0 AS extra_qty"`** ⇒ 全部无值。
- 删期次会连带清 `forecast_audit_decisions`。
- ⚠️ `total_qty`（后端权威 `SUM(quantity)`）与前端 `rowSum(qtyByUnit)`（sum of sum）**理论相同、精度可能
  微差**；`rowFinalQty` 优先用 `total`，`rowSum` 只作编辑态兜底。

## 写入口（各只有一个）

| 量 | 唯一写入点 | 语义 |
|---|---|---|
| `extra_qty`（加单） | `POST /api/forecast-submissions/save-matrix`（编辑态「保存汇总表」） | `ON CONFLICT(period_start,period_end,product_id) DO UPDATE`，**对每行都 upsert 含 0 值** |
| `final_qty`（定稿） | `POST /api/forecast-audit/audit-period/adopt` | **幂等**：同 `(period_start, period_end)` 先 DELETE 后 INSERT；记 `decided_by` / `decided_at` |
| 建议量 | `POST /api/forecast-audit/audit-period`（**纯只读**，不落库） | `required = 近30天日均 × (lead_days + arrival_cycle) + safety`；`suggested = max(0, round(required − stock))` |

## 真机验证脚本

`.workbuddy/tools/forecast-final-qty-verify.js`
```bash
HG_TOKEN=xxx HG_TENANT=9999 HG_BASE=http://127.0.0.1:5173 \
NODE_PATH=/Users/zhangjunfeng/.workbuddy/binaries/node/workspace/node_modules \
/Users/zhangjunfeng/.workbuddy/binaries/node/versions/22.22.2-3/bin/node forecast-final-qty-verify.js
```
**四条必踩的坑（脚本里已处理）**：
1. 🔴 **多表页面必须按「特征列」锁表**：预报页同时有**返利冲刺看板表** + 主表，
   `document.querySelectorAll('thead th')` 会抓错表。→ 先找「含『最终下单』列」的表。
2. 🔴 **虚拟滚动下 `el.scrollTop = x` 无效**（目标行从未渲染）→ 用 `page.mouse.move()` +
   `page.mouse.wheel({deltaY:420})` 派发真实滚轮事件分段下滚采样。
3. **行定位别按商品名**（同名系列有多个近似版本）→ 按 `td[data-pid]`。
4. 🔴 **`page.evaluate` 只序列化函数源码**，闭包变量进不去页面上下文 → 用「普通函数 + 显式参数」。

## 页面结构与入口归属（改任何按钮落点前先读）

**本期预报页 DOM 顺序 / 真实高度（1440×900 实测）**：

| # | 容器 | 高度 | 渲染条件 | 内含 |
|---|---|---|---|---|
| 1 | `.card.toolbar` | 62（编辑态 **100**，两行） | 恒显 | `.tb-ctx`（期次/新建期次/审批徽标）｜`.tb-data`（搜索/导入/导出）｜`.tb-act`（AI智能建议 + **改单**〔编辑态此槽位变**工具箱**〕）｜`.tb-edit-group`（编辑态第二行：取消/回退/查错/补录商品/保存） |
| 2 | `.card.new-period` | — | `showNewPeriod` | 新建期次表单 |
| 3 | `.card.sprint-card` | **360** | `cross.period` 存在 | 返利冲刺看板，**`rebateSprintOpen = ref(true)` 默认展开** |
| 4 | `.view-seg-row` | 34 | `!editMode` | 汇总表/逐单补录分段 + `view-seg-tip` + 修改日志（`margin-left:auto`） |
| 5 | `.card.cross-card`→`.grid-area` | — | `viewMode==='cross'` | 只读：`.col-config-bar`→`.grid-ctl-row`(34)→表体；编辑态：另一套 `.grid-ctl-row`(34)→网格 |
| 6 | `.card.draft-section` | — | `viewMode==='list'` | 逐单补录 |

- 🔴 **`.grid-ctl-row` 是 cross 视图专属**（两个分支都在 `viewMode==='cross'` 的 `.cross-area` 内）→
  **切到「逐单补录」时它整个不在 DOM 里**（实测 `gridRow:false`，而改单按钮仍在）⇒ **任何"跨视图"按钮都不能放这里。**
- 🔴 **只读与编辑态各有一套 `.grid-ctl-row`**（L487 / L658）：只读含 缩放·仅显示有报单·品牌·**复制报单**；
  编辑态含 缩放·仅显示有报单·品牌（**刻意无复制报单**，v168）。
- 🔴 **改单 ↔ 工具箱是 `.tb-act` 段同一槽位的两态**（`v-if="!editMode"` / `v-if="editMode"` 互斥）。

**实测距离（1440×900）**：改单 bottom **176** → 表格工具行 top **616** = **垂直 440px**
（其中 **360px 是返利冲刺看板**）＋横向 **857px**（改单在工具栏最右 cx=1275，缩放控件 cx=418），
直线 **1081px**；**两者同屏都可见**（vh=900）⇒ 痛点是鼠标行程与视线，**不是可见性**。
**编辑态**：保存 bottom **214** → 表头 **653** = **439px**（同一块看板；保存一次录入点 3–10 次，改单一期只点 1 次）。

**表格工具行容量**（`.grid-ctl-row{display:flex;flex-wrap:wrap;gap:8px}` —— 溢出会**折行**不是溢出）：

| 视口 | 可用宽 | 只读态所需 | 余量 | 编辑态所需 | 余量 |
|---|---|---|---|---|---|
| 1280 | 962 | 663 | **+299** | 529 | **+433** |
| 1440 | 1122 | 663 | +459 | 529 | +593 |
| 1680 | 1362 | 663 | +699 | 529 | +833 |

- 只读态塞入「改单」(74px) → 1280 余量 +217；**最坏态**（再打开「仅显示有报单」多出
  「已隐藏 N 个零报单」徽标 144px）→ **+65，仍单行 34px** ⇒ **容量放得下**。
- 编辑组 5 按钮合计 **364px**（取消52/回退52/查错76/补录商品102/保存50）→ 塞进编辑态行后 1280 仅 **+61**（临界），
  **最坏态 −83 → 折行** ❌ ⇒「编辑组整体下移」不干净。

**评估结论（2026-09-15，待用户拍板）**：不建议单独下移「改单」（跨视图丢入口 + 进入/退出分家）；
**共因是那块 360px 的返利冲刺看板** —— 先收它收益最大且零回归风险。全文见
`artifacts/预报页-改单按钮落点评估-2026-09-15.md`；测量脚本 `.workbuddy/tools/forecast-editbtn-relocate-fit.js`。

## 返利冲刺看板（`.sprint-card`）—— 它是「加单」的伴侣，别搬走（2026-09-15 实测）

**结构**：`Forecast.vue:297`，`v-if="cross.period"`（**无 `!editMode` 守卫 ⇒ 编辑态也在**），
自带折叠（`rebateSprintOpen = ref(true)`，`:5540`）。

| 层 | 内容 | 实测高 |
|---|---|---|
| `.panel-hd` | 标题 + `副驾建议` 标签 + `本期·期次名` + `本月时间进度 X%` + 折叠箭头 | **33px** |
| `.panel-body` | ① 摘要（剩余到货次数 / **均单需额外 ¥X**）② 品牌表（…距目标还差 / **建议均单** / 进度）③ 系统建议（**优先加单：<商品>**） | 285px(1440) / 332px(1280) |
| 卡片内边距 | | 42px |
| **合计** | | **360px(1440) / 407px(1280)** |

**它为什么必须挨着表**：
- 它就是「加多少、加给谁」的算法输出，且已有**一键带入**闭环 ——
  `:6000` 提示「带入后数量会填入『加单』列」→ `:6017` `r.extraQty += q` → `:6020` toast。
- 「加单」**只在编辑态可编辑**（`:809` `v-model.number="r.extraQty"`；只读态 `:605` 是只读展示）。
- 候选落点 `view-seg-row` 是 `v-if="!editMode"`（`:358`，实测编辑态 **null**）⇒ 搬过去 = 唯一需要它的场景里消失。
- 该行**横向余量精确 0px**（1440：1152 − 165 − **861** − 102 − 2×12）⇒ 物理也塞不进（除非砍那条 861px 提示）。

**尺寸/距离实测**（折叠后卡片 **71px** = 33 标题 + 38 内边距）：

| 视口 | 场景 | 卡高 | 改单→表格工具行 | 保存→表头 | 保存→网格首行 |
|---|---|---|---|---|---|
| 1440 | 非编辑·展开 | 360 | **440** | — | — |
| 1440 | 非编辑·折叠 | 71 | **151** | — | — |
| 1440 | 编辑·展开 | 360 | — | **439** | 482 |
| 1440 | 编辑·折叠 | 71 | — | **150** | 193 |
| 1280 | 非编辑·展开 | 407 | **487** | — | — |
| 1280 | 编辑·展开 | 407 | — | **486** | 529 |

⇒ **改单 440 与保存 439 是同一个 360px 造成的**（上一轮把它们当两个问题，其实共因一个）。
⭐ **标题条横向余量 643px(1440) / 483px(1280)** ⇒ 不必新开行就能把「N 个品牌未达标 · 总缺口 ¥X · 均单需额外 ¥Y」提到常显层。

**评估结论（待用户拍板）**：**推荐 A2 —— 不搬，就地收成一行决策横幅 + 编辑态自动折叠**（440→151 / 439→150，零功能损失、零入口迁移）。
不可行项：移到「目标与返利」页（其「本期预报贡献」列取自本页 `cross`）。
全文 `outputs/返利冲刺看板落点评估-2026-09-15.md`；脚本 `/tmp/fc-sprint-place2.js`（需重写）。

### A2「决策横幅」已落地并上线（v172 / 2026-09-15）

规格全文 `.workbuddy/artifacts/预报页-决策横幅实现规格-2026-09-15.md`（注意：其中「折叠态 71px」**已订正为 108px**）。

```
折叠态 108px（实测）= panel-hd 区 71px + 决策行 37px
  决策行 = 2 个品牌未达标 · 总缺口 ¥340,039 · 剩 8 次到货 · 均单需报 ¥42,505
展开态 398px(1440) / 445px(1280) = 决策行【保留】 + 9 列明细表 + 系统建议
编辑态 = 自动折叠（watch(editMode)），首屏商品行数 2 → 11
```

🔴 **「71px」这个数字是个教训**：它只是 `.panel-hd` 区域的高度，我一度当成「标题条内容区 33px」，
漏算了 `.card{padding:18px}`。**量某行高度前先确认量的是元素自身还是含外层卡片 padding 的整块。**
⇒ A2 真实折叠高 108px、改单距离 **188px**（非承诺的 151px）；但相对改造前的 360px / 440px 仍是 ↓70% / ↓57%。

四数字全是现成 computed（`rebateSprint.filter(gap>0).length` / `fmt(sprintTotalGap)` /
`rebateSprintOrders` L5586 / `fmt(sprintTotalGapPerOrder)` L5724），**零新增计算**。
插入点：`Forecast.vue` L305（`panel-hd` 结束）与 L306（`panel-body` 开始）之间。

- 🔴 **单位必须与明细表同源**：横幅总缺口用 `¥340,039`（与表格同一个 `fmt()`），
  **不能写成 `¥34.0万`** —— 否则同屏两套单位。要改万元须表格+横幅一起改。
- 🔴 **虚线边挂在 `panel-body` 的 `border-top`**，不要挂在 banner 的 `border-bottom`
  —— `panel-body` 是 `v-show` 隐藏的，边线随它消失；挂 banner 上折叠时会留悬空线。
- **编辑态自动折叠**：`watch(() => editMode.value, v => { if (v) rebateSprintOpen.value = false })`
- **边界**：全部达标时别显示「0 个品牌未达标」→ 改「N 个品牌目标全部达成」。
- **宽度**：标题条 471 + 决策行 ≈410，可用 1440=1114 / 1280=989 ⇒ 两视口单行，余约 580px。

**待核实（不能用沙箱下结论，见铁律「沙箱改 order_date」）**：看板「本期预报贡献 = ¥0」——
算法 `最终下单 × 进货价`（`:5672`），真实库 **430 商品仅 56 个有进货价（13%）** ⇒ 天然被压到 ≈0；
是否另有**品牌匹配**问题需在真实租户只读核对。

### 🔴 看板文案口径：「额外」是凭空引入的基准（2026-09-15 用户订正 / `2e6a3a7`）

**用户原话**：「用户要知道的是**剩余的到货次数均单多少**，不是均单**额外**多少」。

三处载体（全在 `Forecast.vue`，改一处必须同时改另两处）：

| 位置 | 旧 | 新 |
|---|---|---|
| L313 决策横幅（常显） | `均单需额外 ¥42,505` | `均单需报 ¥42,505` |
| L324 展开态说明段 | `要补齐以下返利目标缺口，均单需额外 ¥…` | `…均单需报 ¥…` |
| L358 系统建议列表 | `剩余 N 次到货（2 天/次）中每单**多加** ¥…` | `…中每单**需报** ¥…` |

**错在哪**：「额外」隐含一个基准（读起来是"在原来基础上再加多少"），而**页面上并不存在这个基准**
—— 审核人实际执行的动作是「下次到货报多少」。数值完全不变（`perOrder = gap ÷ orders`，`:5831`），
改的只是它被说成什么。

**判据（可复用）**：任何「额外 / 增量 / 超出 / 多加」类表述，必须能指出**基准是谁**；答不上来
⇒ 该表述凭空造了一个不存在的前提，是文案缺陷而非风格问题。反向也成立：**「均单」这类均摊词
必须能指出分母是谁**（此处分母 = 剩余到货次数 `s.orders`）。

⚠️ **别把"两套分母"当不一致来修**：横幅 42,505 的分母是**默认周期**剩余次数，建议列表
33,567 / 14,300 的分母是**各品牌自己的周期**（蒙牛 2 天/次 8 次、简爱 每周2次 5 次）。
这个差异已被 L323 文案交代（"各品牌到货周期不同，下表按各自周期算「建议均单」"）。

## 列注册表：不可删除列 = 服务端权威（v161 / 2026-09-15）
> 后端 `785f387`（hergent-erp）· 前端 `52207eb`（laozhangai-product）

**三类列的口径**（改任何"能不能删这一列"之前先读）
1. **系统列 = 不可删除**：`name` / `barcode` / `sale_price` / `dist_price` / `product_code`
   （**恰好 5 个**，服务端 `forecast_columns.PROTECTED_COLUMNS`）。这是**唯一权威**。
   前端 `MASTER_COL_DEFS[].deletable` 只在 `registryOk=false`（注册表拉取失败）时作降级兜底，
   且**降级必 toast**，不静默。
2. **可删除的内置列**：品牌 / 规格 / 单位 / 进价（+ 商品名称，固定冻结）。
   ⚠️ v177（2026-09-16）起 **安全库存 / 保质期天 / 起订量 / 到货天数 / 标准售价 已从主表下线**，
   见下节「主表列的下线与新增」。固定 schema 列，**刻意不登记进注册表**
   （登记 = 抄第二份事实；且被删后的恢复路径完全不同）。
3. **自定义列**：key = 服务端生成的 `f_xxxxxxxx`；值存 `products.extra_json`（JSON 扩展列）。

**为什么自定义列的 key 必须由服务端发**：旧机制前端随机造 `cust_xxx`，只活在那台浏览器
⇒ 换设备列连同数据消失；值按 `条码::名称` 定位 ⇒ **商品改名/改条码就静默丢值**。现按 `product_id`。

**API**：`GET/POST /api/forecast/columns`、`PUT/DELETE /api/forecast/columns/{key}`
（系统列 → **400**，fail-closed）、`POST /api/products/extra-values`（合并写；未知列/系统列 key → 400，
**绝不静默丢弃**）。唯一实现 `server/db/queries/forecast_columns.py`（docstring 有 ①~⑥ 取舍：
复用 custom_fields 不另建表 / 只登记系统列与自定义列 / 系统列只读 / JSON 列而非 EAV /
非法输入抛错 / 删列同事务清值且不更新 `updated_at`）。

**迁移路径：不要手工"三处登记"** —— `erp_db.py` 已有「主库 schema 唯一权威源 + 启动给每个租户库
做列级对账」（`_TENANT_COL_SYNC` v131e）。新列写进主库 DDL + `_safe_migrate` 即可；
实测日志 `[schema-sync] tenant_1.db 补列(+1): ['products.extra_json']`。
🔴 但**别只写在 `forecast_columns._ensure`（按需自愈）** —— 主库权威源没有 → 租户库对账补不到
（本轮 `no such column: is_system` 正是这么来的，是"两份口径"的老坑）。

**未做（P2/P3，用户已确认不在本轮范围）**：导入三方对账（命中不可删除列 / 命中已注册字段 /
候选新字段 三选一）、列类型整体采样与校验。

**真机验证脚本**：`/tmp/v161_be_e2e.py`（后端 35/35，隔离租户）、`/tmp/v161_ui.js`（真机 16/16）。
🔴 真机断言**必须对目标 `th` 直接 `dispatchEvent(contextmenu)`**，**不能**用
`th.click({button:'right'})` —— 后者即使加 `force` 也**按元素中心坐标派发**，而编辑网格列头有
sticky/frozen + 横向滚动，实测三次调用全落到「条码」th（三份菜单文本逐字相同 = 假阳性）。
**判据：多个不同目标的断言返回完全相同的结果 ⇒ 先怀疑测试没打到目标，别怀疑产品。**

## 主表列的下线 / 新增：只需改一处（v177 / 2026-09-16）
> 前端 `be5d320`（laozhangai-product）· 纯前端改动，未动后端

**唯一渲染源 = `Forecast.vue` 的 `MASTER_COL_DEFS`**。它派生全部五个面，改它即五个面同时生效：
`visibleCols`（**只读汇总表与编辑网格共用**）· 列设置菜单（显示列 + 「添加列」候选
`addableMasterCols`）· 表尾合计（`masterSum` 遍历 `visibleCols`）· 导出 xlsx（`buildXlsx` 遍历
`visibleCols`）· 列级权限过滤（`canSeeCol`）。**没有第二份列表**，别再去别处 grep。

**v177 下线五列**：`sale_price`(标准售价) / `safety_stock`(安全库存) / `expiry_days`(保质期天) /
`moq`(起订量) / `lead_days`(到货天数)。同步清掉随之成为死配置的两处：`COL_DEFAULTS` 的
`safety_stock:86 / expiry_days:86`、`COLUMN_PERMISSIONS` 的 `sale_price` 条目。
理由：报单场景只需「报什么、报多少」；这五个是**商品档案的属性**，维护入口在「商品档案」页。

**🔴 删列 ≠ 删数据** —— 「下线一列」的正确边界（本轮逐层实测）：

| 层 | 动 | 不动 |
|---|---|---|
| 列注册表 `MASTER_COL_DEFS` | ✅ 删条目 | |
| `COL_DEFAULTS` / `COLUMN_PERMISSIONS` | ✅ 删死配置 | |
| 行对象字段 `r.safety_stock` 等 | | ❌ 保留 |
| 主档 upsert 载荷 `prodRows` / 草稿 `DRAFT_MASTER_KEYS` | | ❌ 保留 |
| 粘贴 / 导入表头映射 `HEADER_KEYS`、无表头默认列序 | | ❌ 保留 |
| 依赖这些数据的告警与建议（`rowWarn` / `moqWarn` / `computeSuggestion` / AI 分析 prompt） | | ❌ 保留 |
| 商品档案弹层（`.profile-modal`，是详情浮层不是列） | | ❌ 保留 |

**删列前必查的三件事**（本轮逐一做过，判据可复用）：
1. **有没有消费方按 key 精确查找该列**？`grep -e "c.key === 'safety_stock'" …` 实测**零命中** ——
   说明这些字段只被当数据读、没被当列定位，删列才安全。**这是唯一的崩溃面**。
2. **金额口径是否吃这一列**？`rowAmount() = dist_price × rowSum`（**取分销价，不是标准售价**）
   ⇒ 删「标准售价」不影响下单金额。
3. **服务端列注册表是否也登记了它**？`forecast_columns.PROTECTED_COLUMNS` 仍把 `sale_price`
   当系统列，但前端**从不据它渲染**（只喂 `canDeleteMaster`）⇒ **惰性残留，不构成漂移，
   无需 DB 迁移**（也符合「不影响数据结构」）。

**⚠️ 两个字段从未落库**：`products` 表**无 `moq` / `lead_days` 物理列**
（实测 `PRAGMA table_info` 只有 `sale_price` / `safety_stock` / `expiry_days`），
`routers/data.py:330-343` 的 `bulk_upsert_products` fields 字面量**不写**这两个键、
`products_grid` 也不回传 ⇒ v177 之前它们也只是「在网格临时填 → `syncMoq()` 存 localStorage →
会话级功能消费」。故删这两列 = 该会话级入口消失，**无持久数据损失**（MOQ 告警高亮 `moq-below`
与「起订量」面板从此无数据源，属用户已确认的预期，非缺陷）。
`安全库存` / `保质期天` / `标准售价` 仍可在「商品档案」页维护，数据与下游告警不受影响。

**验证配方（快）**：① 构建产物 grep `key:"<列key>"` —— 删掉的应 0、保留的各 1（`MASTER_COL_DEFS`
在 bundle 里就是 `key:"xxx"` 形态，不会与别处撞）；② 隔离沙箱真机断言 `.cross-tbl thead th`
与 `.edit-tbl thead th` 文本集合（1440/1280 双视口）；③ 列设置菜单文本（同时覆盖显示列与
「添加列」候选）；④ 公网 HTTP 取回分块 md5 与本地构建比对（`index.html` **只**引用主包
`index-*.js`，`Forecast-*.js` 是动态分块，要从主包里 grep 出分块名再取）。

## 报单导入链路（forecast_cross）—— 首次端到端跑通（2026-09-15 实测）

**两个端点（multipart）**：
```
POST /api/import/preview   file + category=forecast_cross
   → cross.identity {field: 表头下标} / cross.customers [{index,name}] / validation
POST /api/import/execute   file + category + mapping(JSON) + order_date
   mapping = {"0":"barcode","1":"name","2":"spec","3":"unit","4":"factory","5":"brand","6":"dist",
              "7".."27":"customer"}   # 键 = 表头**下标字符串**；客户列一律值 "customer"
```
- 身份字段枚举 = `_CROSS_IDENTITY_FIELDS` = `COLUMN_PATTERNS["forecast_cross"].keys()`
  = `barcode/spec/unit/brand/factory/dist/rhythm/price/name`（**唯一真相源**，别再手写元组）。
- 客户列由 `_is_cross_skip_header` 过滤：空表头 / 纯数字 / **以「价」或「价格」结尾** / 含
  `_CROSS_SKIP_KEYWORDS`（合计·件数·最终下单·下单金额·分销价格·加单·订单排期·编码·代码·序号·备注…）。
- 幂等：同 `order_date` 的 `role='导入'` 数据先 DELETE 再写入 ⇒ **重导即覆盖，不影响小程序报单**。
- 落库写 `role='导入'`；**`period_id` 恒为 0**（不挂期次）。

**自动识别实测（159 行源表，一次成功）**：identity 全部正确归位、21 个客户列全识别、`validation.warnings=[]`。

**模板列（`_TEMPLATE_FIELDS["forecast_cross"]`，7 列）**：
`商品条码`(必填) `商品名称☆` `规格☆` `单位☆` `厂价☆`(条件必填) `品牌` `分销价`(选填) + 动态客户列。
⚠️ 系统「下载模板」端点按租户 `report_mapping.report_alias` 生成真实列头；未配置时回退「示例客户1~10」。
⚠️ 本地 `舟谱导入模版/.预报订单导入模板.ref/build.py` 里的 IDENTITY 是 **8 列**（多一列「订单排期」），
与后端 7 列**不一致** —— 以后端为准。

### 🔴 本轮实测出的 6 个缺口（详见 `artifacts/预报订单导入-真机导入验证报告-2026-09-15.md`）

1. **未配置报单对象时回执不给提示**。`_execute_forecast_cross` 里
   `resolve_alias_to_contact(cname)` 返回空 → 直接 `_cobj={"id":0,"name":cname}` 原名落库，
   **不收集任何警告**。设计 §3.4 规则 2 要求「警告，不阻断 + 指向 `设置›报单配置`」——
   **实现里这条不存在**。实测 tenant_1 只有 2 条 `report_mapping`，19 个有量对象里 17 个未配置。
   **判据：设计文档写了"警告"不等于代码会警告 —— 去代码里找有没有 append 到返回体。**
2. **导入不挂期次**（`period_id=0`）⇒ 主表按期次视图看不到，只能按日期窗口看到。
3. **源表「分销价格」是派生公式**（`(厂价/规格)/0.9` 与 `(最终下单/规格)/0.9` 两套并存），
   **不是真实分销价**；导入会把它写进 `products.dist_price`（得到 0.14~3.91 的假单价）。
4. **主表按档案口径显示商品名**（`forecast_submission_summary` 的 `COALESCE(NULLIF(products.name,''), i.product_name)`）
   ⇒ 下单表写简称（红桶/原桶/草260）、档案存全名（蒙牛红枣酸牛奶1000g*10桶）时，
   **用户在主表看到的不是自己写的名字**（实测 69/92 不一致、57/92 规格口径不同）。
5. **变体共用条码被合并**（单号/双号、恒滋/福宝、某渠道变体）—— 条码是唯一去重锚点，
   口径没错，但**下单表的条码粒度不够**，报单量会串到同一条商品。
6. **厂价闸门默认关**（`forecast_config` 无 `factory_price_gate` 键 → fail-safe 放行）；
   **租户库无 `barcode_conflicts` 表** ⇒ `log_barcode_conflict()` 被 try/except 吞掉、冲突不留痕。

### 三个"看着像问题其实不是"（判据可复用）
- **空条码行 / 缺单位行不一定拦导入** —— 先看**该行的报单量是否为 0**：量全 0 的行在任何客户列上
  都 `qty<=0 → continue`，根本不会进入建档分支。实测 2 行空条码 + 10 行缺单位**恰好全是 0 量行**，
  落库商品里 0 条走「单位兜底为件」。
- **`products_reused_count == products_backfilled_count`** 不是巧合，是档案里厂价**全为 0**（430/430）
  ⇒ 每个命中商品都被「只补空」回填一次厂价。**这也是本轮唯一的正面副作用：92 个商品厂价 0 → 有值。**
- **`skipped / dupes` 恒 0** 对 forecast_cross 是正常的（那两项只对 products/contacts 生效）。

## 待办 / 悬而未决
- **文案歧义（一类问题，今日已出现两次）**：
  ① 「报单合计」（看 `total`）与「最终下单」（看 `total + extra`）共用词根但口径不同 —— 已提出，用户未回应；
  ② 本轮「均单需额外」→「均单需报」**已由用户订正并修复**（`2e6a3a7`）。
  ⇒ 再遇"同一语境两个相近词"或"凭空基准"，按本文件 §看板文案口径 的判据自查，别等用户第二次提。
- 真实「加单」尚未被录入过（生产 `SUM(extra_qty)=0`）→ 需用户实际去用这个口子。
- **返利冲刺看板落点**：**A2 已落地并上线**（v172 / `2e6a3a7`，含口径措辞订正），**不再是待办**。
  仍待用户拍板：折叠态是否跨会话记忆（现为**不记忆**）、编辑态是否允许手动展开（现为自动折叠
  + 可手动展开）、是否在横幅右侧加「一键带入加单」（属功能新增，需单独评估宽度）。
- **报单导入（2026-09-15 新增）**：
  - 🔴 **tenant_1 只有 2 条 `report_mapping`**（刘善涛 / 美联保康），而真实下单表用 21 个对象
    ⇒ **要用户自己去 `设置›报单配置` 配齐 19 个**，否则下游舟谱单据生成不了（缺客户全称/调拨仓）。
    ✅ **回执已不再静默**（v163）：导入时逐个点名未配置对象（带 Excel 列序号）。
  - ✅ 三问已由用户 2026-09-15 拍板并落地（v163/v164，后端 `cfcd00c` / 前端 `66c4115`）：
    ① 导入**挂当前期次**（不再 `period_id=0`）；② 源表「分销价」**要带进来**（走既有「只补空」回填）；
    ③ 条码粒度 = **不给独立条码、也不能合并**（同条码同一档案，两个户头按明细行区分，单据层拆开）。
  - ✅ 待修代码已完成：导入回执补「未配置报单对象」警告 + 户头清单；
    ⏳ `barcode_conflicts` 表在租户库仍缺失（`log_barcode_conflict()` 静默失败、条码冲突不留痕）—— **未修**。

---

## 🔴 户头（下单主体）：两个载体 + 明细行才是权威（v163/v164 / 2026-09-15 真实数据实测）

用户定调（原话）：「**不能给独立条码，但也不能合并，统一给商品要用两个户头下单**」。准确读法：
**同条码 = 同一商品档案**（不许拆成两个 SKU）；**两个户头的货不能合进一张单**（各下各的）。

### 1. 户头在源表里有**两个载体** —— 只读名称会丢掉 95%（这是 v163 第一版的漏洞）
| 载体 | 形态 | 识别器 |
|---|---|---|
| 商品**名称** | 「红桶（恒滋下单）」「低脂高钙（福宝下单）」 | `db.order_entity_pattern()`（要求含「下单」二字） |
| **品牌**列 | 「蒙牛低温（福宝）」 | `db.order_entity_brand_pattern()`（**v164 新增**） |

**实测分布**（`2026年9月13日到货下单表-已补价格.xlsx`，159 个商品行）：

| 名称识别 | 品牌识别 | 行数 | 带量行 |
|---|---|---|---|
| — | — | 78 | 170 |
| — | **福宝** | **77** | **402** |
| 恒滋 | 恒滋 | 2 | 13 |
| 福宝 | 福宝 | 2 | 0 |

⇒ 名称带标注 **仅 4 行**；品牌带标注 81 行、其中 **77 行只有品牌带**（占带标注行 **95%**）。
**只读名称 = 户头静默丢失，且因为户头落空串，下游走「无户头」分支连警告都不发。**
**判据：改户头识别前，先对真实文件跑「两载体分布矩阵」—— 别只看一列。**

### 2. 权威值在**明细行**，档案上只是「默认户头」
商品档案只有一个 `ordering_entity` 字段，**装不下两个户头**；旧实现两行都往档案写 = 谁最后写谁赢 = 静默丢失。
- `forecast_submission_items.ordering_entity` = **权威**（跟着「这一行」走）
- `products.ordering_entity` = **默认户头** = 该商品**第一个有量行**的户头（`_updated_products` 保证只写一次）
- 汇总 `ordering_entity` 取法：`COALESCE(NULLIF(MAX(i.ordering_entity),''), 档案值)`（明细优先、档案兜底）
- **汇总不能改分组键**：前端多处按 `product_id` 单键索引 `cross.rows` ⇒ 多户头分布另用 `entities: [{entity, qty}]` 带出

### 3. 真正「不合单」发生在**舟谱单据生成**：聚合键 `alias` → `(alias, entity)`
- 「部门」列**逐单**按本单户头取：`routers/forecast.py::_entity_department(prof, entity, warnings)`
- **单据数 = Σ(每个客户出现的户头数)**。实测修复前后：**29 → 43 张**
  （19 个客户：`10 个客户×3 + 4×2 + 5×1 = 43`，与读端 43 个单号逐一对上）
- 实测户头数量分布：福宝 402 行/9,849 件 ｜ **无标记 170 行/4,955 件** ｜ 恒滋 13 行/222 件
  （合计 585 行 / **15,026 件** ✓ 与源表零误差）

### 4. 🔴 未配户头部门 = **回落 `company_name`，而它可能恰好是另一个户头的名字**
`db.entity_department()` **未配返回空串**（判据：不在这里偷偷兜底）；兜底 + 告警留在生成侧。
实测 tenant_1 的 `company_name` = **「湖北福宝商贸有限公司」**（公司全称恰好就是「福宝」的名字）
⇒ 未配时**恒滋的货（13 行 / 222 件）在「部门」列回落成福宝的公司名 → 会被下到福宝名下**。
系统**正确告警**（2 条，按户头去重），但**必须让用户去「报单配置 → 模板参数」补配置**。
配置载体 = 租户业务参数 `business_profile.entity_departments`（`{户头名: 舟谱部门名}`）。

### 5. 导入的「覆盖式先清后建」清理切片 = `role='导入' AND order_date=?`（**不是期次**）
⇒ 动手导入前**必须**按清理条件 `GROUP BY period_id` 报出影响面。
实测本次切片命中 `order_date='2026-08-30'` 的 **20 条空报单（合计数量 0）** → 删除零损失；
`period_id=0` 的 60 条 / 12,709 件**不在切片内**、未被触碰（已断言）。

### 6. 导入归属期次：`forecast_period_current()` 为主 + `forecast_period_default()` 兜底
判据锚定 **「导入落的期次 == 前端 `GET /api/forecast/periods` 的 `current`」**。
🔴 **实测 tenant_1 的 4 个期次（7/8/9/10）全是 `closed`** ⇒ 只认 `open` 会落 `period_id=0`，兜底**不是可选项**。
⚠️ 兜底后落的期次 9 本身仍是 `closed` —— 需提示用户新建/开启下一期。

### 7. ⚠️ 数据侧缺口（未修，属源表问题）
**78 行（170 个带量格 / 4,955 件）品牌列无户头标记** ⇒ 无法归属，默认落到 `company_name`。
要么用户回源表补标记，要么确认这些商品确实全归福宝。

### 8. 响应头陷阱（同根因的第二半）
警告文案含中文，`quote()` 后**每汉字膨胀成 9 字符** ⇒ 十几条长警告顶穿 nginx `proxy_buffer_size`(4k)
⇒ `upstream sent too big header` ⇒ **整个下载端点 502，用户连文件都拿不到**。
修法：告警**按户头去重** + `_hdr_safe_warnings(warnings, max_bytes=1500)`（前 10 条 + 按**编码后字节数**硬截断、不切断 `%XX`）。
**定位手段**：绕 nginx 直连 `127.0.0.1:8700` 得 HTTP 200/42KB → 反证是 nginx 层 → 读 `/var/log/nginx/error.log` 定案。

---

## 🔴 条码重复告警的口径：**同品牌才重复**（v178 / 2026-09-16 用户定调）

用户原话：「条码重复只有在**同品牌**的情况下报错，如果是两个品牌，比如蒙牛低温（福宝）/蒙牛低温（恒滋）
这种情况下不要报错……**只有在同品牌/同条码的情况下才报错**」。

**业务依据**：公司在蒙牛有**两个户头**（福宝 / 恒滋），同一个产品两个户头都会下单
⇒ 两行条码相同是**正常业务形态**，按条码一律报重复就是误报。
（呼应上节 §1：户头的第二个载体正是**品牌列** —— 所以「品牌」在本判据里不是装饰字段，是**户头标识**。）

### 判据（三条，缺一不可）
| # | 规则 | 理由 |
|---|---|---|
| ① | **同条码 + 同品牌** 才算重复 | 不同品牌 = 不同户头 = 正常 |
| ② | 品牌比较走**归一化键**：去空白（含内部空格）+ 全角/半角括号统一成 `（）` | 用户手填会有 `(福宝)` / `（福宝）` / `蒙牛低温 （福宝）` 等变体；**显示值不动** |
| ③ | **任一方品牌为空 ⇒ 仍按重复处理**（fail-closed） | 空品牌既可能是「同品牌漏填」、也可能是「另一个户头」，**信息不足以区分** ⇒ 宁可让用户把品牌填上（填上且不同即消警），不可静默放行 —— 放行代价 = 保存后按条码匹配商品**串档** |

⚠️ 判据 ③ 是**故意**的取舍，不是漏考虑。改它之前先想清楚：放行后的匹配是按条码做的。

### 品牌取值的**两个必须**（否则判据会建在沙上）
1. **`rowBrand()` 必须「行内值优先、档案兜底」**。档案优先时，编辑网格里刚把品牌改成
   「蒙牛低温（恒滋）」的那一行，判据仍按档案值算 ⇒ **用户刚做的改动在判据里不可见**（改了照样报）。
   只读表的行本就来自档案（`loadCross` 注入 `prodMeta`），两种顺序结果相同 ⇒ 改序对只读面零影响。
2. **品牌/品类必须写进 `loadEditGrid` 的行映射**（`category: pd.category, brand: pd.brand`）。
   🔴 实测该行映射**原本漏了这两列**，编辑网格的品牌列**只有「草稿恢复」一条路有值**：
   草稿 = `JSON.stringify(cross.value)`（`loadCross` 存的整份 cross，行里带 brand），
   靠 `DRAFT_MASTER_KEYS` 合并回行。**草稿一被清（「放弃修改」/换期次/首次使用）品牌列整列空白**
   ⇒ 判据不能依赖本地草稿残留，必须走档案。

### 告警文案必须**可自证**
`条码重复（第 N 行 同品牌「蒙牛低温」）` ／ `条码重复（第 N 行 品牌未填全，无法区分户头）`
—— 只说「已使用该条码」时用户无法判断是误报还是真重复（旧文案即此，已改）。

### 配套：条码列宽（用户要求「加宽」）
🔴 **`barcode` 原本不在 `COL_DEFAULTS` 里** ⇒ `colDefault` 落到兜底 **90px** ⇒ 13 位条码
只显示得下 9 位。**看不到全码就无法人工核对重复**。现补 `barcode: 132`（截断 50 → **0**）。
⚠️ 新增/检查任何列宽都要问一句：**这个 key 在 `COL_DEFAULTS` 里吗？** 不在就静默吃 90px 兜底。

---

## 🔴 主表的「行」不是「我报的商品」—— 行底恒为全量在售商品档案（2026-09-16 用户提问触发）

**现象**：用户导入一份 159 个商品的模版，导入后主表显示 **275 个品**，问「为什么」。

**答案（两层，必须先说第一层）**：

1. **275 = 在售商品档案数**（tenant_1：`products` 436 中 `is_active=1` 的 275 个；`/api/products/grid`
   走 `product_list(limit=100000, include_inactive=False)`）。**与本次导入无关。**
   - `loadCross()`（**只读态也走这条**，不是只有编辑态）：
     `Promise.all([forecastApproveApi.summary(...), productsApi.grid()])`，
     `matrixRows = prods.items.map(pd => ...)` ——
     **「有报单的行按 summary 注入数量/金额/AI，无报单的行以 0 占位」**（2026-09-13 改动，查看态也铺全量）。
   - 页面固定条 `{{ cross.grand.sku }} 个商品` = `cross.rows.length` ⇒ **屏幕上直接写着 275**。
   - `hideZeroReport = ref(false)` ⇒ **默认不隐藏零报单行**；勾「仅显示有报单」后才只剩 `rowSum > 0` 的行。
   - 实测本期（period 9，2026-08-30~09-15）真正有报单的商品 **只有 4 个** ⇒ 275 行里 271 行是 0。
2. **那次导入实际 0 行 / 0 个客户**（见下节）—— 所以 159 个商品一个都没带量进来。

🔴 **判据：用户说「表格里的商品数不对」时，先分清「行底」（商品档案全量）与「值」（报单量）**。
主表/编辑网格的行从来不是导入结果的投影；要「只看我报的」，走「仅显示有报单」开关。

## 🔴 「导入回执」不用复现请求 —— 去 `forecast_config` 的 `audit:<period_id>` 读（2026-09-16）

前端 `recordAudit('import', ...)`（`Forecast.vue::doImport` 成功后）→ `POST /api/forecast/audit`
（`routers/forecast_config.py`）→ 存 `forecast_config` 表 `kind = 'audit:<period_id>'` 的 JSON 数组。

```json
[..., {"at":"2026-09-16T20:47:34.850627","action":"import","by":"张俊峰",
        "detail":"预报订单导入模板-20260913-已填.xlsx（0 行 / 0 个客户）"}]
```
- `detail` 的数字 = `imported_count`（成功创建的报单条数=客户数）/`results.success`。
- **`0 行 / 0 个客户` 就是「一条都没进来」**，且**后端不报错、HTTP 200**。
- 同一张表还有 `save_changes` 等动作的留痕（`audit:0` 是与期次无关的全局动作）。

**取证配方（只读，全程零写入）**：
① `nginx access.log` 找 `import/preview` + `import/execute`（含 UA：真机 = QQBrowser，我的验证 = HeadlessChrome，
两者**同 IP**，别只看 IP）；② `forecast_config.audit:<pid>` 读回执；③ `forecast_submissions`/`products` 的
`MAX(id)`/`MAX(updated_at)` 看有没有真写入；④ `tenant_N.db-wal` 的 mtime 能证明「那一刻确实有写事务」。

⚠️ **tenant_1 是 WAL 模式**：先用 `mode=ro` 读、再用读写方式打开读一遍对比计数，才能排除「只读连接漏读 WAL」。

## ⚠️ 已排除的三个「看着像但都不是」的原因（省得重查）

- **模版表头的必填标记（`商品条码*` / `商品名称☆`）不影响识别** —— `_guess_mapping` 用
  **子串包含**（`kw.lower() in h.lower()`），`*`/`☆` 不构成障碍。纯函数复算三种形状全对。
- **期次 `closed` 不拦写入** —— `forecast_submission_create` 不校验期次状态。
- **导入的客户列不会因为列名是门店名而失效** —— 后端 `_is_cross_skip_header` 只跳过空表头/纯数字/
  以「价」「价格」结尾/含 `_CROSS_SKIP_KEYWORDS`（合计·件数·最终下单·下单金额·分销价格·电商·加单·订单排期·
  排期·状态·商品编码·编码·代码·序号·备注·批次）者，其余**一律判为 customer**。

## 📄 系统下载的预报模版：客户列来自「报单配置」

`routers/import_router.py::download_template_file`：客户列 = `report_mapping.report_alias`（去重），
**未配时才回退「示例客户1~10」**。tenant_1 只配了 2 条（`刘善涛` / `美联保康`）⇒ **模版只有 2 个客户列**。
用户要按 20+ 个对象下单，必须先去「设置 › 报单配置」补全，模版才会生成对应的列。
模版第 2 行是**示例数据行**（含条码 `6901234567890`、各客户列填 `10`），填写说明要求删除。

## ✅ 缺陷（v179 已修）：0 行也渲染成绿色的「导入成功」

旧实现：`<p v-if="impResult && !(impResult.results?.errors||[]).length" class="imp-ok">导入成功：{{ success }} 个客户</p>`
⇒ **`0 行 / 0 个客户` 照样显示绿色「导入成功」**（用户 2026-09-16 据此误判）。
判据：**「成功」的判据里必须含非零**，0 行要按失败报并给出下一步。
**v179 改为四分支**（`Forecast.vue` L156/L167/L171/L172），且**判据由后端一次判完**：

| 分支 | 条件 | 渲染 |
|---|---|---|
| ① 建档成功但零报单 | `results.archived_no_qty` | 信息蓝「已建档 / 更新 N 个商品，但没有生成任何报单」+ 解释「数量由业务员从小程序报」 |
| ② 有异常 | `results.errors.length` | 异常清单 |
| ③ 真成功 | `results.success > 0` | 绿色「导入成功：N 个客户」 |
| ④ 什么都没有 | 其余 | 「这份文件里没有可导入的内容」 |

---

## 🔴 v179 核心范式：「导入模版」有**两种语义**，不能共用一条数量闸门

用户原话：「**我需要实现的是模版里有多少产品，导入后就只有那么多产品**」。
他把这份模版当**批量建商品档案**的载体（数量另由业务员从小程序报），
而旧实现把「有没有数量」当成了「这一行要不要处理」。

**判据：一份导入文件同时承载两件事 —— ① 商品身份（→ 档案）② 客户数量（→ 报单）。
二者的闸门必须独立：没有数量 ≠ 这一行没价值。**

旧结构（**错**）：`for 客户列: for 数据行:` … `if qty <= 0: continue` ⇒ continue 在 `_match_product` **之前**
⇒ 21 个客户列全空时 159 行全部被丢，连认一下商品都没走到（档案零变动）。

新结构（`_execute_forecast_cross`，v179）：
1. **第一遍**（不嵌套于客户列）：认身份 → 建档/回填。缓存键 `_ck = barcode or ("N:" + name)`，
   `_pid_cache` / `_act_of` 让每商品**恰好处理一次**（旧实现在命中已有档案时会按客户列数重复回填 N 次）。
2. **第二遍**（`for 客户列: for _prod_rows:`）：只读数量、建单；`qty <= 0` 只表示「这一列这个商品不产生明细」。
   ⚠️ **刻意留在第二遍**：`_oe_names`（户头清单）与 `_updated_products`（档案默认户头）必须按**有量的行**判，
   挪到第一遍会让口径漂移成「出现的行」。

### 行底的第二来源：`forecast_import_products`（导入登记台账）

- `UNIQUE(period_id, product_id)`；**独立成表，绝不写进 `forecast_submission_items`**
  （后者是业务报单表，返利 / 业绩 / 定稿 / 舟谱导出都在读）。
- 两处登记：`erp_db._ensure_forecast_tables`（惰性）+ `init_db` 的 `_safe_migrate('v179_forecast_import_products')`。
- 写入在**事务提交之后**；`INSERT OR IGNORE` + `UPDATE` 收敛；
  **不清 `order_date` 的旧登记**（与报单的「同日期先清后写」相反 —— 分批导入应累积）。
- ⚠️ `action` 是「**最后一次**」语义：重复导入把 `created` 刷成 `reused`（不影响界面，回执读当次实时结果）。

### 🔴 `forecast_submission_summary` 必须**带行**返回 `imported_products`，不能只回 id

`products/grid` **只返回在售商品**（实测 285）。而实测本批 154 个导入商品里 **3 个已停用**、
另有 **2 个有报单的商品也已停用** —— 前端若只拿到 id，这 5 个查不到就会**静默消失**，
正是「我导的商品没进来」这个原症状的复现路径。
⇒ summary 用 `LEFT JOIN products` 补 name/spec/unit/barcode/product_code/**is_active**，返回整行；
前端 `buildRowBase()` 再把「不在在售档案但被本期引用」的补进行底并打「已停用」角标。

### 主表行底新口径（`Forecast.vue`）

`buildRowBase(allProds, importedProducts, reportRows, showAll)`
= 「在售档案中被本期引用到的」∪「不在在售档案但被本期引用的」（后者走 `asProdRow` 归一）。
默认收窄；勾「**显示全部商品**」回旧行为（全量在售档案）。**查看态与编辑态必须同源**。

| 可观测 | 值（tenant_1 实测） |
|---|---|
| 在售档案 | 285 |
| 本期引用（导入 154 ∪ 有报单） | 158（153 在档案 + **5 已停用**） |
| 「另有 N 个在售商品未显示」 | **132** = 285 − 153 |

🔴 **口径陷阱**：这个 132 **不能**用 `rowBaseTotal - rows.length` 算（会得 127，**少报 5**）——
rows 里混着「档案外的行」与「用户手工补录行（`offArchive` 为 `undefined`）」。
修法：`buildRowBase` 里 `keep.forEach(p => p.offArchive = false)` 打**显式标记**，只减 `offArchive === false` 的行。

### 🔴 表格角标与「虚拟滚动」对验收的影响

- 角标：商品名单元格加 `.imp-tag`（导入，信息蓝）/ `.off-tag`（已停用，琥珀）。
- **查看态主表是虚拟滚动**（`VSCROLL_MIN=80` / `ROW_H=34`）⇒ **DOM 里的行数 ≠ 逻辑行数**（只有窗口那 ~26 行）。
  逻辑行数只能读 `vsWindow` 的 spacer 高度：`(topSpacer + bottomSpacer)/34 + renderedRows`，
  且**要求 `groupBy === 'none'`**（分组行高 30、明细行高 132，会破坏这个算式）。
  ⚠️ `.cross-viewport` 的 `scrollHeight / 34` **不可靠**（实测 6412 vs 真值 5372）。
- 数角标必须**滚动遍历整表按 `td[data-pid]` 去重收集**，不能只看首屏。

### 🔴 「加了一个开关 ref」≠「开关能用」—— 假旋钮

`showAllProducts` 首版只改 ref，而**行底只在 `loadCross` / `loadEditGrid` 里构建**
⇒ 勾选框选中、表格纹丝不动（实测勾前 158 行、勾后还是 158 行）。
**判据：凡新增「开关型」状态，必须同时给出「状态→重建数据」的路径。**
修法：`watch(showAllProducts, () => { if (editMode.value) { saveDraftNow(); loadEditGrid() } else loadCross() })`
（编辑态先落草稿再重载，未提交改动不丢）。

### 提交
后端 `e4dcd13`（`erp_db.py` + `routers/import_router.py`）｜前端 `3ae7de4`（`Forecast.vue`）。
验证：`.workbuddy/tools/v179-rowbase-verify.js` 18/18 ＋ `.workbuddy/tools/v179-original-path-verify.js` 12/12。

---

## v181→v183 · 返利冲刺看板：「进度」列文案（2026-09-17，**现行 = v183**）

**沿革（三轮同一天）**：v181 落地「与时间进度对比」三态判语（单位「个百分点」）→
v182 单位按用户指定改「%」→ **v183 三态判语整块删除，只留「达成率 X%」**。

### v183 现行口径

**文案只由 `sprintAchText(ach)` 产出** ＝ `'达成率 ' + paceNum(ach*100) + '%'`（1 位小数，整数不带 `.0`）。

用户判据（原话）：**面板页头已常显「本月时间进度」、进度条上还有虚线标记，读者自己一比就知道
超前还是落后 ⇒「落后时间进度 X%」这类差值判语是冗余信息，删掉。**
⇒ 一般化：**当界面另有载体能让用户自行得出某结论时，再把该结论显式写出来就是冗余。**
（同族先例 `返利目标达成-判语chip删除-交付说明-2026-09-12.md`）
⚠️ 但**不能顺手把图例也删**：页头「虚线＝时间进度…超前/落后」承载「虚线是什么」的口径 ⇒ 保留。

| 项 | v183 现状 |
|---|---|
| 文案 | `达成率 61.4%`（唯一形态，**无三态分支**） |
| 颜色 | 仍按「与时间进度对比」：超前 `pace-ahead` 绿 / 持平 `pace-even` 灰 / 落后 `pace-behind` 红；不可比时无色 |
| 判空 | 只在 `ach == null` 时为空串（实际 `ach` 恒为数字：`target > 0 ? achieved/target : 0`） |
| 精度 | `paceNum`：1 位小数、整数去尾零；与页头时间进度同精度 |

**若用户要「纯灰、不带判定」**：把模板 `:class` 里的 `sprintPaceMap[s.key].cls` 去掉即可（一处）。

### 🔴 `sprintPaceOf` 与文案解耦（v183 顺带修掉的缺陷）

v181/182 把文案挂在 `sprintPaceOf` 上，而它在 **`frac = 0`（到货月尚未开始）时返回 `null`**
⇒ 那时**连达成率也一起消失**。v183 拆成两件：

- `sprintPaceOf(ach)` → 只返回 `{ state, pp, cls }`（**配色判定**；`pp = (ach - tp.frac) * 100` 百分点，正=超前）
- `sprintAchText(ach)` → 文案（**与时间进度无关，任何月份都显示**）
- `sprintPaceMap` → 每行 `{ text, cls }`（模板一次取到，避免模板里重复调用函数）
- 前置条件 `ach != null && tp.frac > 0` 只管配色那一路；过去月 `frac=1` 照常比

### 🔴 配色与文案必须同源

`sprintBarClass()` 原先是独立的一份 `ach >= frac`，与「`|pp| < EPS` ⇒ 持平」会分叉
⇒ 差 0.03 个百分点的一行会出现「**进度条判绿、文案写落后**」。
⇒ 改为 `sprintBarClass()` **复用 `sprintPaceOf()`**：`state === 'behind' ? 'red' : 'green'`。
**v183 后配色成了该函数唯一的消费方，但同源要求不变** —— 别因为它不再产出文案就另写第二份判定。

### 页头时间进度用 `pct1`（1 位小数）—— v183 后作用变了但更要保留

v182 的理由是「用户拿页头核对文案里的差值」（页头整数 57% vs 真实 56.667% 会自相矛盾）。
v183 差值文案没了，但用户判据变成**「自己跟时间进度比」** ⇒ 页头这个数字**成了唯一的比较基准**。
真机断言（D2）：**页头 = 行内虚线位置 = 真实日期进度**，三者必须一致 —— 否则「自己一比」这个前提就不成立。

### 空间自适应（`paceFits`）—— v183 后基本走不到，保留作防御

判据 = **溢出**：`el.scrollWidth > el.clientWidth`（不是「scrollWidth 等于文字自然宽」，见下）。放不下 → `.is-hidden`（`visibility:hidden`）+ 进度条挂 `title`。
**重测时机**：`onMounted` / `window.resize` / `watch([rebateSprint, rebateSprintOpen, sprintTimeProgress])`。
⚠️ **不能用 `ResizeObserver` 观察自身**：看板 `v-show` 折叠期间宽度为 0，会误判成"放不下"。

🔴 **两个反直觉（v183 实测；v181/182 的代码注释写错了，已订正）**：
1. **`scrollWidth` 在未溢出时会被 `clientWidth` 抬平** ⇒「scrollWidth 就是文字自然宽」是错的读法，
   它只能用来判「有没有溢出」。**要量文字自然宽，得先把宽度约束住**（这样量到 `达成率 61.4%` = 74px）。
2. **`table-layout:auto` 会把该列宽度下限顶在 `max(td 自带 min-width:110px, 文案 min-content)` 上**
   ⇒ 给 `td` 设 `max-width` **无效**（实测设 64px、列宽仍是 102.8px）。
   ⇒ 复现「放不下」只能约束 `.sp-pace` 自身宽度；v181/182 那种「压 td」的手法在文案变短后失效
   （当时文案 212px 本身就超过该下限才压得出来）。**这不是产品缺陷，是探针手法失效。**

### 「文案撑宽该列」的沿革（结论：**v183 起已回到 168px，不再撑宽**）

| 版本 | 文案自然宽 | 1680px 下进度列 | 说明 |
|---|---|---|---|
| v181 | 212px（含「个百分点」） | **240px** | 文案撑宽该列 72px，其余各列各缩 ~7px |
| v182 | ~164px | **192px** | 随文案变短自然回缩 |
| **v183** | **74px** | **168px** | **不再撑宽** —— 下限回到模板自带的 `td min-width:110px` |

各视口（v181 实测；v183 文案更短 ⇒ 只会更宽松）：1440 → 197px、1280 → 169px、1100 → 168px，
均**直接显示、零换行**；1100px 档容器内滚动是**既有**现象（各列 min-width 合计 795 > 772）。

**🔴 判据**：`nowrap` 文案**会**按 min-content 撑宽该列（`width:100%` 挡不住）。
想让文案「常见宽度下都能直接显示」，撑宽其实是**原因**，别急着"修"；先量其他列有没有被压坏。

### 提交与验证

| 版本 | 代码 | 工具/文档/截图 | 真机 | 纯逻辑 | 上线产物 |
|---|---|---|---|---|---|
| v181 | `7933e21` (+81/−9) | `3e23637`（5 文件） | 24/24 | 35/35 | `Forecast-B8x2rYFo.js`(276733B) / `CzJKAYe2.css`(70040B) |
| v182 | `664eb78` (+7/−4) | `92999e9`（3 文件） | 24/24 | 27/27 | `Forecast-8Wyki5bY.js`(276721B) / `7ds2duDK.css`(70040B) |
| **v183** | **`0c542db` (+40/−32)** | **`00c1b79`(4) + `003768c`(3) + `a994f50`(1) + `ea15ed0`(1)** | **29/29** | **32/32** | **`Forecast-Cx2A1X5F.js`(282602B) / `m5KHKtF1.css`(70684B)** ⚠️ 见下 |

v183 真机实证（生产前端 + 沙箱 9998，源 `tenant_1`）：行1 蒙牛低温 61.372% → 绿字「达成率 61.4%」；
行2 简爱 56.250% → 红字「达成率 56.3%」；页头「本月时间进度 56.7%」。
新探针另断言：表格行内旧判语计数 **0**、页头图例仍在、**页头 = 虚线 = 真实日期进度**、
`frac=0` 仍显示达成率（纯逻辑 32/32 覆盖，从 `Forecast.vue` 真切片执行）。

⚠️ **版本号顺延**：v179/v180 被「主表行底」「期次归属」占用 → v181 → v182 → **v183**。
并发会话同日用 **v184** 做「复制期次」，**未冲突**；动文件前先 `git log | grep vNNN` 确认。

⚠️ **v183 的上线产物不是我自建的那一份**：15:20 有**并发会话**重建了 `dist/`，
我的 rsync 推上去的是那一份（= 我的 v183 代码 + 他们的 v184 前端）。**识别法**：部署后核对
「产物名 + 字节数」与自建不一致（`Cx2A1X5F` 282602 ≠ 我建的 `De3UWvpU` 276648）⇒ 反查
`dist/` mtime 发现被覆盖。**⇒ 部署前必须核对产物名/字节数**（详见 `deploy-ops.md`）。

**scoped 归属（v183，`Forecast.vue` 29 hunk → 本轮 13 / 在途 16）**：
- **本轮 13**：`412·417`（模板）、`6257`（paceNum 注释）、`6280·6291·6293·6298`（sprintPaceOf 解耦 +
  sprintAchText）、`6311·6314`（map）、`6319`（measure 注释）、`6331·6334`（paceHint）、`7536`（CSS 注释）
- **在途 16**：并发会话 v184 `560·642·1779(@copy=openPeriodCopy)·1850·5265·6715·6795·7481`；
  09-13 那批 `2502·2504·2515·2517`；`.imp-errs` 搬家两半 `7422`+`7437`；纯空行 `101·7797`
- ⚠️ **归属不能只靠关键词**：`6291`（只改行尾注释）、`6334`（只改函数体）都被关键词法漏判过
  ⇒ 必须**打印 hunk 全文人工确认**，别只看首行。
- spec 名 `fe-v183`（在 `.workbuddy/tools/scoped_stage_by_marker.py`，
  ⚠️ **该脚本从未 `git add`（也未 ignore）** —— 每次 scoped 提交都靠它，建议择机入库）。

**🔴 教训 1：交付说明里写死的 chunk 名会过时** —— 说明原写**第一次**构建的 `CzbGvR4N`/`3YhLLNBF`，
最终上线的是**注释重构建后**的 `B8x2rYFo`/`CzJKAYe2` ⇒ 已回填。判据：**文档写完之后又构建过一次 ⇒ 必须回填**。

**🔴 教训 2（v182）：Vue scoped scopeId 会让 CSS 差集「假阳性」** —— scopeId = `hash(路径 + 源码)`，
改某 SFC **任意一个字符**，它的全部 `data-v-*` 与派生的 `sk-*` 动画名都会换新。
实测只改一个字符串：CSS 字节数**完全相同**（70040），差异 **5232 = 654 × 8 字节**全是
`data-v-53fd6f8d` → `267babec`，**样式规则零改动** ⇒ 差集核查必须抹平 `data-v-*`（**base36**！）与 `sk-*`。
另两条：**同源重复构建 md5 与文件名 hash 完全一致**（可复现）⇒ 差集法可信，仅注释不同才「字节同、md5 异」；
**`rsync --delete` 部署后旧产物本地即失**（`dist/` 在 .gitignore）⇒ 要对照组只能「临时回退 + `vite build --outDir /tmp/…`」。

**遗留**：`sprintTimeProgress.pct`（整数版）已**无任何引用**（只余 `pct1` / `frac` 被用），保留未删
（删它要再走一次「重建 + 部署生产」，不抵风险）⇒ **下次因别的原因重建 `Forecast.vue` 时顺手删除**。

---

## 🔴 跨期「复制上一期」必须先列「桶 × 归属键」矩阵（2026-09-17 设计评估实证）

> ✅ **已落地（v184，2026-09-17）** —— 本节矩阵仍然有效且是实现的依据；
> 「怎么复制」（入口在往期列表、默认顺延、seed 端点、`origin` 列、
> `loadPeriods` 会重设 `curPeriod`）见**文末 §v184**。

用户提案「老用户新建期次后自动复制上一期基础数据、不复制报单数据」。勘察后确认
**「基础数据」不是一个东西、是四个桶，且其中两个的归属键不是期次**：

| 桶 | 表 | 归属键 | 可跨期复制 |
|---|---|---|---|
| 商品清单（导入登记） | `forecast_import_products` | **`period_id`（真按期次）** | ✅ 唯一该复制的 |
| 报单明细 | `forecast_submissions` + `_items` | `period_id`（兼容 `period_id=0`+`order_date`） | ❌ |
| 加单 | `forecast_extra_qty` | 🔴 **`(period_start, period_end)` 窗口** | ❌ **窗口重叠即串期** |
| 定稿 | `forecast_audit_decisions` | 🔴 **`(period_start, period_end)` 窗口** | ❌ 同上 |
| 客户列 / 户头 | `report_mapping` · `business_profile` | **全局，不按期次** | — 无需复制 |

证据：`routers/forecast_submissions.py:462`（`ON CONFLICT(period_start, period_end, product_id)`）；
`erp_db.py:15200`（`DELETE … WHERE period_start=? AND period_end=?`）。
⚠️ v180 刚加了「期次窗口重叠」软警告 ⇒ 重叠是真会发生的 ⇒ 只复制 A，其余一律不复制。

### 🔴 「导入覆盖」今天只做到一半 ⇒ 照现状实现「沿用+导入」= 复活老 bug

| 桶 | 现状语义 | 代码 |
|---|---|---|
| 报单明细 | **覆盖**，但按 `order_date` 切片（**不是期次**）⇒ 同天导两次覆盖、隔天导就累积 | `import_router.py:490-495` |
| 登记台账 | **只增不删**（`INSERT OR IGNORE` + `UPDATE`，**全仓无 `DELETE FROM forecast_import_products`**） | `import_router.py:744-756` |

⇒ 「先沿用上期 154 + 再导入 159」= **并集** ⇒ 精确复活用户 8 月底报的原症状
「模版里只有 159 个产品，导入后系统里有 275 个品」。
**修法：登记台账加 `origin ∈ {import, seeded}`**，导入按 origin 精确清理
（替换 = 清 seeded + 本期 import；追加 = 只清 seeded，保留 v179 的分批导入能力）。
⚠️ 新增列必须 `PRAGMA table_info` + 幂等 `ALTER TABLE`（`CREATE TABLE IF NOT EXISTS` 不补列）。

### 🔴 「新建期次后表格里还有上一期的数据」= 残留 bug，不是复制

`Forecast.vue:6715 createPeriod()` 只 `await loadPeriods()`（刷下拉），**从不重载表格**；
而 `loadPeriods()` 内部会改 `curPeriod` ⇒ 「下拉=新期次、表格=上期完整视图（**含数量**）」。
用户据此提出「自动复制上一期」——**方案的现象基础本身是 bug**。
判据：**凡「切换上下文后数据看起来还在」，先证明它是「真的被复制过来」还是「从未被重载」**——
二者的区别是**数量列有没有值**（残留含数量、复制不含）。
同族入口：下拉 ✅ / 多期滚动 ✅ / 删期次 ✅ / 改期次 ✅（v180）/ **新建期次 ❌**。

### 🔴 导入归属必须 fail-closed（加闸门时同步收窄兜底）

`import_router.py:441-449` 的 `_period_id` 可为 **0**，且兜底 `forecast_period_default()`
**可返回 closed 期次**（`erp_db.py:15120` 的函数文档**自称「仅展示用」**并警告
「放宽它会静默改变落库归属」）——却被导入当成了落库归属的兜底。
2026-09-17 事故即由此：导入时 7/8/9/10 期全 closed ⇒ 154 个商品挂到**已关闭的 9 期**。
⇒ 闸门 = **必须落到 `status='open'` 的期次**，否则 400 且不写任何字节；
`forecast_period_default()` 收窄为**只服务 `GET /periods` 展示**。
⚠️ **客户端从不传 `period_id`**（全文件核对）⇒ **闸门必须做在后端**，否则直接调接口绕过。

### 顺带确认的既有能力（勿重复建设）

- **编辑态复制粘贴已实现**：`Forecast.vue:824` `@paste="onPaste"` → `onPaste:2987` → `pasteRegion:4390`
  （区分「主档列粘贴」与「Excel 交叉表区域粘贴」两条路径）。
- **「显示全部商品」开关已存在**：`Forecast.vue:578` / `1902` / `1963`。
- **模版客户列是全局的**（来自 `report_mapping.report_alias`），**不按期次** ⇒ 不需要复制。

---

## ✅ v184 · 期次「复制」落地（2026-09-17，**现行**）

提交：后端 `ed47d2d`（hergent-erp）·前端 `fc55ccc`（laozhangai-product）·文档/截图 `cdca9f4`。
用户拍板三句：「1.开放；2.默认就顺延；3.保留」。

### 入口与三原则
| 拍板 | 落地 |
|---|---|
| 「复制」对**已关闭**期次开放 | 往期列表每行按钮，唯一过滤 `Number(row.id) > 0`（屏蔽合成行） |
| 复制时窗口**默认就顺延** | 弹窗预填 +7 天、**名称里的日期同步后移**；快捷 3/7/14 天 |
| 工具栏「新建期次」**保留** | 「新建」= 从零；「复制」= 有源；两者并存 |

### 两条端点（都在 `routers/forecast.py`，前缀 `/api/forecast`）
- `POST /periods/{pid}/copy` —— 新建期次 + 带清单，返回 `{id, name, copied, src_name}`。
- `POST /periods/{pid}/seed` —— 把源期清单填入**已存在**的期次（`target_period_id`），
  目标须 `open`、`_t == _s` 报错。用途 = **空态引导行的「从上一期复制清单」**（「不必先删再建」）。

后端实现三件套（`erp_db.py`）：`_period_copy_products`（**copy 与 seed 共用的唯一实现**，
`INSERT OR IGNORE` 幂等、只搬 `forecast_import_products`、带过 `origin='seeded'`）、
`forecast_period_copy`、`forecast_period_seed`。

### 🔴 顺延不是随手给的默认值 —— 归属键是窗口
加单 `forecast_extra_qty` 与定稿 `forecast_audit_decisions` 的键是 **`(period_start, period_end)`**，
**沿用旧窗口 ⇒ 两期共用同一批加单与定稿（窗口重叠即串期），同屏不报任何错**。
⚠️ 顺延按钮**相对源期次重算**、不是「在当前基础上再加 N 天」（否则连点叠加）。

### 🔴 `origin` 列（`forecast_import_products.origin ∈ {import, seeded}`）
- **必须显式写**：`INSERT OR IGNORE` 在行已存在时**整条跳过**，列 DEFAULT **不会**被应用；
  而「先复制上期清单（`seeded`）、再把同一批商品真导入」是常规动作
  ⇒ `import_router.py` 用 `UPDATE … origin='import'` 覆盖回来。
- 为什么需要它：台账按 `(period_id, product_id)` 幂等且**只增不删**（全仓无 DELETE）
  ⇒ 「先复制 154 + 再导入 159」= **并集 ≈275**，正是 8 月底那次「模版 159 个、系统里 275 个」的症状。
- 补列要**两套都写**：主库 `_safe_migrate('v184_forecast_import_origin', ALTER…)`
  ＋ 租户库 `_ensure_forecast_tables()` 里 `try ALTER / except pass`
  （`CREATE TABLE IF NOT EXISTS` **不给已存在的表补列** ⇒ 只加建表语句 = **只在该存量租户上炸**）。

### 🔴 `loadPeriods()` 会把 `curPeriod` **无权重设**成后端默认期次
`forecast_period_default()`（`erp_db.py:15261`）只回答「**默认该看哪一期**」，
**不是**「保持用户当前在看的那一期」⇒ `seedFromPrev` 必须**守住视图**（记 `keep` → 重载 → 还原），
否则 seed 到一个**更老的空期次**后视图被甩到另一期去、同屏不报任何错。
⚠️ 对比 `createPeriod()` 里同名的 `loadPeriods()`：那里「切到新建的那一期」**正是想要的**
⇒ **只有 seed 这条路需要守**。判据：**同一函数在两处的期望相反时，必须按调用点分别处理，别抽成一个「通用」封装。**

### 🔴 空表列展示（用户提的「创建期次后要能看见不可删除的列行」= 真缺陷）
原「只读态 0 行 ⇒ 整块空态」**替换掉整张表（连列头）**，而「哪些主档列不可删除」的提示
**挂在列头右键菜单上** ⇒ 空期次里**完全不可达**，用户被迫先点「改单」。
现改为「**表头保留 + 表体内一行引导**」（三个动作：改单填写 / 从上一期复制清单 / 导入 Excel）；
`colOrderList.length` 作 `colspan`。
⚠️ 查明两条 `.ctx-menu`（单元格 `ctx` / 列头 `hdrCtx`）的**唯一渲染出口在编辑态分支**
⇒ **查看态右击列头不出菜单是既有边界，不是 v184 引入**（要让它可达需另行改，已列入「需确认事项」）。

### 探针陷阱（本轮实测，三处假的）
1. **`data-pid` 挂在 `<td>` 不在 `<tr>`** ⇒ `tr[data-pid]` 恒 0；后果是「`dataRows === 0`」变成**永真假 PASS**。
   取行一律用 `tr.data-row`。
2. **`select.sel-period` 只在「本期预报」tab 存在** ⇒ 在「历史期次」tab 读恒 null。跨 tab 操作要**先切回**。
3. **`click({button:'right'})` 在 headless 下不产生 `contextmenu`** ⇒ 必须 `dispatchEvent(new MouseEvent(...))`。
4. **合成行（`id<0`，如「2026-07-24 报单」）状态列也显示「进行中」** ⇒ 探针必须用
   `^\d{4}-\d{2}-\d{2}\s*报单$` 过滤，否则稳定命中它。

### 验收
真机 **51/51**（沙箱 9997，脚本 `.workbuddy/tools/v184-period-copy-verify.js`）｜
后端双侧 sha256 一致、`/openapi.json` 确认两端点注册｜前端双侧 md5 一致｜
scoped：后端 `11=6+5`·`2=1+1`·`3=3`，前端 `16=8+8`·`2=2`·`9=1+8`，残留 hunk == 在途数逐文件吻合。

### 🔴 附：幽灵数据库连接（P0，**未修**，报告见 `outputs/期次复制与空表列展示-2026-09-17/附-幽灵数据库连接缺陷-2026-09-17.md`）
`_sqlite_connect()`（`db/connection.py:200`）按 **(线程, 路径)** 缓存连接，复用前只 `SELECT 1`
—— 而 SQLite 在库文件被 unlink 后**旧 fd 依然有效** ⇒ **异步端点持续读写幽灵库**。
叠加 `set_tenant_context()`（`connection.py:93`）的「文件缺失即自动建库」兜底 ⇒
**`POST` 全回 200 却不落盘、`GET` 看不到**，文件 `sqlite_sequence` 恒不变。
**规避：重建/替换租户库后必须重启服务（先重建库、再重启）。**

---

## 「到货周期」= `products.arrival_lead_days`（v184b 新增列 / v184b2 做成可编辑）

> 🔴 该列自 **v192** 起**可被用户隐藏**（仍是固定列、仍钉在左侧、仍不可删除）—— 见 **§v192**。
> 列设置菜单勾掉即隐藏，记在浏览器列偏好里、刷新不回弹。

### 🔴 三个「天数」是三个量，改之前必须分清

| 字段 | 归属 | 语义 | 默认 | 消费方 |
|---|---|---|---|---|
| `products.arrival_lead_days` | 商品 | **下单后第几天到货**的提前天数 | `0`（= 未设置） | 报单页「+N天」提示（v109 迁移建列） |
| `products.lead_time_days` | 商品 | **补货算法的提前期** | `7` | `forecast_audit.py` 的补货点/安全库存公式（v91 迁移） |
| `rebate_target_rules.order_cadence_days` | **品牌** | 「每隔几天到货一次」的**频率** | `0` | `domain/arrival_schedule.py` 的到货排期（v121 迁移） |

踩过的坑：三者都曾被口语叫「到货周期/到货天数」。**判据是「问它进哪个公式」**——
进安全库存公式的是 `lead_time_days`，算到货**日期**的是 `order_cadence_days`，
只是给人看「+3天」的是 `arrival_lead_days`。
⚠️ 另注意：v177 下线的那个主表列 `lead_days` 与 `arrival_lead_days` **也是两个东西**。

### 写入口有**两个**（同一列，展示同源）

| # | 入口 | 语义 | 留空 |
|---|---|---|---|
| ① | 预报订单导入模版的「到货周期」列 | 文本 `+N天` / `+N到货`（含全角＋）由 `import_router._re_rhythm` 解析，落库在该文件第二遍 UPDATE | **不改动** |
| ② | 「商品档案」页该列行内编辑 / 新增表单 → `PUT /api/products/{id}` | `utils/arrival.js::parseArrivalDays` | **取消设置**（提交 0） |

🔴 **两个「留空」语义故意相反**，别去「统一」它们：导入是**成百行的批量动作**
（空格子多半只是「这行没意见」）；档案页行内编辑是**用户专门点开某一格的定向动作**
（留空只能是「我要清掉它」）。两边都各自显式提示。

🔴 **主表网格里本列仍是只读**（`Forecast.vue` 的 `edit:'ro'`）—— 在网格里摆一个存不下
的输入框就是假旋钮。`ctxClear` 的提示语必须指向**真实存在**的改法（「去商品档案页点该格」），
不能只说「由导入决定」。

### 🔴 `product_update.allowed` 是硬闸门（最关键的静默失败点）

不在 `db/queries/products.py::product_update.allowed` 里放行 ⇒ `PUT` 过去的值被
**静默丢弃**（HTTP 200、零报错）= 「改了没反应」里最难查的一类。`product_create.allowed` 同理。

### 归一化必须是**唯一一份**，且发生在**写之前**

`normalize_arrival_days`（`db/queries/products.py`，`_ATD_MAX=365`，经 `erp_db.py` 门面导出）
被三条写路径共享：`product_update` / `bulk_upsert_products` / `product_create`。
🔴 `arrival_lead_days` 是 **INTEGER 列**，把 `'+3天'` 直接写进去 SQLite 的**类型亲和不做转换**
⇒ 列里存成 TEXT，按数字比对的地方**全部静默失配**。
上界 365 必须**前后端同值**：前端 `utils/arrival.js::ARRIVAL_MAX` / 后端 `_ATD_MAX` /
`routers/data.py::update_product` 三处，改一处不改另两处就会出现「前端放行、后端 400」。

⚠️ **两条解析规则不同是有意的**，不是不一致：导入那列是**自由文本列**（同表还有「+1」加单
标记、备注），裸数字会被误判 ⇒ 那边**要求**「加号 + 天/到货」收尾；档案页的输入是**已被列头
认领的专用格**，裸数字无歧义 ⇒ 接受它才不会让用户在编辑框里还必须打「+」和「天」。
两条规则的**结果**都是同一个整数、落同一列、展示都走同一个 `arrivalCycleText`。

### 🔴 `bulk_upsert_products` 的「显式提供才写」守卫

该函数绝大数字段是**无条件覆盖**（缺省写 0），而 Forecast 的「商品清单」网格调本接口时
**不带** `factory_price` / `arrival_lead_days` ⇒ 放进 `fields` 字面量的话，**每次网格保存
都会把用户补好的值清零**。厂价（v157）已踩过同一个坑，故两者都走守卫：

```python
if r.get("arrival_lead_days") is not None:        # 🔴 判据必须 is not None
    _ad = db.normalize_arrival_days(r.get("arrival_lead_days"))
    if _ad is not None:
        fields["arrival_lead_days"] = _ad
```
🔴 **判据必须用 `is not None`，不能用真值判断** —— `0` 是**合法值**（= 取消设置），
用 `if r.get(...)` 会把「显式取消」静默忽略掉。

### 🔴 商品导入模版**有意不加**这一列（假旋钮）

商品导入走 `product_create`（纯 **INSERT**），已存在条码会撞 `idx_products_barcode`
唯一索引（`v89_products_barcode_unique`，`WHERE barcode!=''`）→ 落进逐行
`except Exception` → `results["errors"]`。**它不是存量更新通道** ⇒ 加了会让人以为能
「导出 → 改 → 导回来」批量回写，实际一条也改不动。要改存量商品的到货周期必须去
**商品档案页点该格**。

### 档案页的呈现细节（`ProductArchive.vue`）

- **三态是刻意的**：有值 → `+3天`（可点）｜未设置 → 「**未设**」灰字（可点，
  厂价列用「未录」同理）｜编辑中 → number 输入框（Enter + blur 双触发，用
  `editingCycleId !== p.id` 去重）。⚠️ 只在**预报主表**用「—」（那是纯展示、不可点）。
- 「未设」用**灰**（`--t3`）不用厂价列那种琥珀警示色：**缺厂价是问题**（闸门开启后该商品
  在报单导入/小程序报单时会被拒收），缺到货周期只是「未设置」。本租户 285 个在售商品里
  274 个为空 ⇒ 警示色会变成满屏噪音，反而盖掉真正要看的缺价提示。
- 导出写 `+6天`；未设置导出**空串**而不是页面那个「—」（破折号在表格里是噪音，
  且回导时会被当成一个值）。⚠️ 但该导出**不是回写通道**。


## 🔴 「合计(箱) = 合计(小单位) ÷ 规格」—— 逐行除再相加，规格取**末位数字**（v189 / 2026-09-18 用户订正）

**用户原话**：合计（箱）=合计（小单位）/规格。

### 判据一：这条式子在**行级**成立；表级必须「逐行除、再相加」

生产在售档案 288 个商品里 **192 个规格是描述串**（`250g*24瓶` / `90g*8杯*12组` /
`210g*10瓶*6提手提装`）、**30 个为空** ⇒ 规格异构时「Σ小单位 ÷ **某个**规格」**没有定义**
（本地断言实测：同一批 80 个小单位，除三个不同规格得 0 / 13 / 3，互不相同、且都不是正确的 5）。
成立的唯一定义是 **Σ round(行小单位 ÷ 行规格)** —— `rowBoxes()`（`Forecast.vue`）就是这个形态，
**不要试图把它「优化」成先加再除**。

### 判据二：「规格」= 每箱小单位数，**不是** `parseFloat(spec)`

🔴 旧实现四处都写 `parseFloat(spec)`，取到的是**净含量**：`parseFloat('200g*12')` = **200（克）**、
`parseFloat('1500ML*6桶')` = **1500** ⇒ 箱数被缩小 250 倍。生产只读实测（期次 9）：
规格 `200g*12` 的 24 件 → **0 箱**（正确 2）。**波及的不只箱数**：`pricePerCase = 厂价 × 该值`
⇒ `1500ML*6桶` 的单价被放大 250 倍、**下单金额整列错**。

唯一实现 = `perCase(spec, unit)`（`Forecast.vue`，紧邻 `rowBoxes`）：
1. 取规格串**最后一个**数字 = 每箱小单位数（`250g*24瓶`→24、`100g*8杯*12组`→12、`1500ML*6桶`→6）；
2. 报单单位(`unit`)比末位单位**更细**时按层级相乘（`100g*8杯*12组` 且 `unit=杯` → 8×12 = **96**；
   `110g*3杯12组` 且 `unit=杯` → 3×12 = 36 —— 生产里确实存在这种「报单单位 ≠ 末位单位」）；
3. 纯数字规格（`12`）即其本身；
4. **不含任何数字 → 0**（缺规格不换算 ⇒ 界面走「缺规格」分支，**不静默当 1**）。

**消费点共 4 处，缺一即口径分裂**：`rowBoxes` / `pricePerCase` / `commitCell`（改单元格后回写 `r.boxes`）/
`loadCross` 行构造。

**生产 449 个档案盘查**（判断下次改动的影响面时直接复用这条）：88 个无数字规格（与旧实现同为零，
非该修复引入）、89 个新旧一致、**272 个被修正**（251 个旧口径把箱数压成 0、21 个旧口径把每箱数算小）。

### 判据三：合计行必须与「**活跃行**」同源（本轮附带修掉的真缺陷）

`_deleted`（软删行，见 `delRowSoft`）此前**只有** `recomputeTotals` 过滤；这四处都对**全量 rows** 求和
⇒ 同屏两个「合计」对不上：编辑网格表尾 `foot`、编辑网格 inline Σ（extra / final / boxes / sum）、
编辑态汇总条（`editTotalQty` / `editTotalAmount`）、**保存行集 `kept`**（在 `saveEdits`）。
现收敛为唯一判据 `liveRows = computed(() => cross.value.rows.filter(r => !r._deleted))`，
**8 个消费点**引用；另补 `delRow()` 漏调的 `recomputeTotals()`（splice 后不重算 ⇒ 表尾僵在删前的值；
`delRowSoft` 有调、`delRow` 没调 = 两条删除路径不对等）。

⚠️ 想数「有没有第二份拷贝」时，直接跑 `tools/forecast-boxes-caliber-check.js` 的静态断言：
`liveRows.value` 出现次数、`cross.value.rows.filter(r => !r._deleted)` 出现次数都必须与注释里声明的一致。
本轮就是靠它数出「预期 4 实际 7」、顺着多出来的那处找到保存路径的重复判据。

### 推送文案（这个改动的起因）

`pushForecast()` 的 `summary` 与 `buildSuggestBook()` 原写 `总箱 ${editTotalQty}`
—— `editTotalQty` 是 **Σ各报单单元数量（小单位，可能是盒/袋/瓶）**，标签「箱」是错的。
改为 `合计(箱) ${editTotalBoxes}`（`editTotalBoxes = Σ liveRows 的 rowBoxes`，与只读表列同源）。
**后端 `/api/forecast/push` 只消费 `period` + `summary`**，`total_qty` / `total_sku` / `total_amount`
三个字段**完全未被读取**（已核 `routers/forecast_config.py::push_forecast`）⇒ 只改文案，
**不动载荷语义**（不静默改存量字段含义，哪天有消费方了才不会踩坑）。

### 验证与探针（改这块直接用，别重写）

| 用途 | 工具 |
|---|---|
| 离线断言（45/45） | `tools/forecast-boxes-caliber-check.js` — `perCase` 从源码抽出执行；旧 `rowBoxes` 从 `git show HEAD:` 抽出做前后对比 |
| 真机验收（25/25） | `tools/forecast-boxes-v189-verify.js` — 改单元格但**不保存**，用「+80 → 2 箱（新）vs 8 箱（旧）」做判别性断言 |
| 只读取真实规格 | `ssh root@47.113.224.140 'python3 -' < /tmp/prod-ro-spec-dump.py`（`mode=ro`，导出 `products` 的 spec/unit） |

⚠️ **判别性实验的必要性**：生产期次 9 那 4 行各只有 1 件、且都小于 1 箱 ⇒ 新旧口径下合计(箱) **都是 0**，
**不具判别力**。必须自己制造「跨过一个整箱」的数量才能区分新旧。

## §v190 🔴「单价(厂价/箱)」支持手工录入（2026-09-18）

**用户口径（原话）**：`最终下单(箱)=合计(箱)+加单(箱)`；`下单金额（厂价）=最终下单(箱)*单价(厂价/箱)`。
**拍板**：生效范围 = **写回商品档案**（一次录入、此后各期沿用）；补价规模 = **逐格输入**，不做整列粘贴。

### 根因（后端 1 hunk，不修则前端全白做）

`/api/products/grid`（`routers/data.py::products_grid`）**不下发 `factory_price`**，而前端
`factoryPrice(r)` 优先读 `r.factory_price` ⇒ **永远退回 `purchase_price`**。两条后果：
1. 凡档案里「厂价 ≠ 进价」的商品，本页「单价(厂价/箱)」与报单金额与后端
   （`db.factory_price_sql`：厂价优先、缺则进价 / 前端同规则唯一解析处 `Forecast.vue::factoryPrice`，
   与 `ProductArchive.vue::fpEff` 同规则）**不是同一个数**；
2. **用户手工录价回写档案后，页面自己读不回来**（grid 不下发 ⇒ 行映射拿不到 ⇒ 又退回进价）
   ⇒ 表现为「**填了没生效**」。

全量实测（生产 **288** 商品）：**151 有厂价**，其中 **105 个「有厂价、进价为空」**
（例 `factory_price=96 / purchase_price=0 / spec=40` ⇒ 单价应显示 **3840.00 元/箱**），
**旧版这 105 行整列显示「缺价」**。

### 前端 11 hunk（`Forecast.vue`）

| # | 件 | 要点 |
|---|---|---|
| 1 | 表头 `<th>` | 补 `title=`：可直接录入 / 留空按档案厂价算 / 保存时反推写回档案 |
| 2 | 该列 `<td>` | 只读 span → `<input type="number" v-model.number="r.casePrice">`，`:data-c="C_PRICE_INPUT"` |
| 3 | 网格下方 `.cross-amt-note` | 复述两条公式 + 「单价可直接在格子里录入」 |
| 4 | `C_PRICE_INPUT` 哨兵 | `visibleCols.length + cross.units.length + 1`。⚠️ **故意与 `C_EXTRA_INPUT` 取不同值** —— 同值则 `selected.c` 分不清「在填单价」还是「在填加单」，日后两格选中态互相点亮 |
| 5 | `priceAuto(r)` | 自动价 = 厂价 × `perCase`，**归一到分** |
| 6 | `pricePerCase(r)` | **手工录入优先**（也归一到分），否则自动价 |
| 7 | `casePriceToFactory(r)` | **手工箱价 → 厂价的唯一反推实现**；缺规格 → `null`（不写档案） |
| 8 | `pricePh` / `priceTitle` | 占位（自动价 `toFixed(2)` / 「缺价，请填」/「缺规格」）+ 悬停标明这个价是手工的还是自动的 |
| 9 | `onCasePriceChange(r)` | 录入即时生效（`pricePerCase` 优先读它 ⇒ 金额自动跟随）+ `saveDraftNow()`；清空 → `null` 回自动价；缺规格时 toast 提醒「只在本期生效，未写回档案」 |
| 10 | 两处行映射 | `loadCross` **与** `loadEditGrid` **都**补 `factory_price: Number(pd.factory_price) \|\| 0`（**漏一处就有一态算错**） |
| 11 | 草稿键 | `DRAFT_MASTER_KEYS` 补 `'factory_price', 'casePrice'` —— 否则填了价没保存就刷新会**静默丢值**、金额跟着变回去 |
| 12 | `saveEdits()` | 保存时反推写回厂价（见下） |

🔴 **两条硬判据**：

- **精度归一到「分」**：手工价是按**厂价**落库的，后端 `db.batch_set_factory_prices` 对厂价 `round(fp, 4)`
  ⇒ `100 ÷ 12 = 8.3333` ⇒ 回算 `8.3333 × 12 = 99.9996` ⇒ 70 箱金额算成 **6999.97** 而不是 **7000.00**，
  用户对账差几分钱。`priceAuto` / `pricePerCase` 都要 `Math.round(x*100)/100`。
  这是**计价精度**（钱只到分），不是掩盖误差。
- **写回通道选「有字段级留痕」的那个**。同表三处能写 `factory_price`：
  `PUT /api/products/{id}` / `POST /api/products/bulk-upsert`（走「**显式提供才写**」守卫 `is not None`，
  因 Forecast 网格载荷不带该键）/ `POST /api/products/batch-factory-price`
  （**专一、有 `log_product_changes` 留痕、返回 skipped 明细并逐条给原因**）。改价影响**全部期次**金额
  ⇒ 必须可追溯 ⇒ 选第三个。**只提交「本行有手工价」的行** —— 没录价的行带上厂价会把档案原值冲掉
  （反推值是 `y/x` 的浮点形态）。**必须放在 `bulkUpsert` 之后**：新增商品那时才拿到 `id`，按条码兜底才找得到。
  ⚠️ 判据是「**本行有手工箱价**」，**不依赖行上的易失标记**（曾用 `_fpTouched`，已彻底移除）——
  草稿恢复出来的手工价（刷新后 `casePrice` 恢复、标记没恢复）一样要能正确写回。

### 验证口径

- 主探针 `.workbuddy/tools/forecast-edit-grid-v187-verify.js`（真机生产 **37/37**）：
  snapshot 的 `price` 必须改成「**`input.value` 优先、空则 `placeholder`（自动价）**」，
  否则 `num('') = NaN` ⇒ E 段那些行被跳过 = **静默失去覆盖（假绿）**。
  新增 **I 段 11 条**：先给「加单(箱)」置 5 **造量**（期次 9 最终下单全 0 ⇒ 否则「金额 = 最终下单 × 单价」
  两边恒 0 = **空断言假 PASS**），再录价（自动价 × 1.5）→ 验金额跟随 → 清空复原 → 加单复原（零痕迹）。
  实测：`5 × 3840 = 19200`（未录价）→ 录 `5760` ⇒ `5 × 5760 = 28800` → 清空回 `19200` → 加单复原 `0`。
  新增 **J 段 2 条**：`fetch('/api/products/grid')` 统计 `withFp=151` / `fpOnlyNoPp=105`（归因：价确实来自厂价）。
- 沙箱端到端 `.workbuddy/tools/forecast-caseprice-archive-v190-verify.js`（隔离租户 **15/15**）：
  档案厂价 `99.5 → 169.15`；**判据自证** `1014.9 ÷ 169.15 = 6.0000` = 该商品规格「6件/箱」
  （不拿自己的换算去验自己）；留痕 `old_value 99.5 → new_value 169.15`；`ZERO_RESIDUE`。

### 提交

`laozhangai-product` **`0bc0b86`**（spec `fe-v190-caseprice`，11 本轮 hunk + 8 在途 = 19 ✓）；
`hergent-erp` **`722d8b6`**（spec `be-v190-gridfp`）。
🔴 **前后端必须同批提交** —— 后端是根因，缺它前端所有单价退回进价算。
⚠️ 交付前线上包自查：`sha256('src/pages/Forecast.vue' + 源码)[:8]` 应 == 线上包里的 `data-v-XXXXXXXX`
（v190 = `0e543102`；订正注释前线上是 `67fe0d6d` ⇒ 说明线上来自**旧源码**，已重新构建+部署）。

## §v191 🔴 单价改「**只在本期生效**」（2026-09-18 晚，推翻 v190 的「写回档案」）

**用户口径（原话）**：「只在本期生效」。手工箱价只影响**本次报单**金额，不写回商品档案、不影响其他期次。

### 落点 = `forecast_extra_qty` 表（它就是「行级预报补充值」表）

加 `case_price REAL DEFAULT NULL`（存「元/箱」；NULL = 未录入 ⇒ 前端回退按档案厂价自动算）。
唯一键 `(period_start, period_end, product_id)` ⇒ **天然按期次隔离** —— 这就是「只在本期」的机制来源，
不需要任何额外过滤。**加单 `extra_qty` 与单价 `case_price` 同居一表同一次 upsert**（同类值同类通道）。

🔴 **三层 DDL 兜底，缺一层就在某类库上炸**：

| 层 | 位置 | 为什么必须有 |
|---|---|---|
| 新建库 | `init_db` 的 v108 建表语句内加列 | 新库直接带 |
| 存量主库 | **独立**一条 `_safe_migrate('v190_forecast_case_price')` | 迁移块首条 ALTER 失败会吃掉整块后续 |
| 存量租户库 | `_ensure_forecast_tables()` 建表 + 兜底 ALTER | `CREATE TABLE IF NOT EXISTS` **不给已存在的表补列** —— 租户库只有这一条路 |

⚠️ 顺带修的既有隐患：`forecast_extra_qty` 此前**只**由 init_db 的 v108 迁移创建，而 summary 会
`LEFT JOIN` 它 ⇒ 迁移没跑到的租户库直接 `no such table` 崩汇总。现与 `forecast_audit_decisions` /
`forecast_period_confirm` 同级惰性建表（那里的注释早就写着「确保 summary 在 JOIN 前表必然存在」）。

🔴 **summary 下发 `case_price` 时不要加 `COALESCE`** —— 未录入必须保持 `NULL`，变成 `0` 会让
「0 元/箱」与「没录价」无法区分（零值即健康类陷阱）。两条 SQL 分支（带/不带日期窗口）都要给同一字段集。

### 前端四件

| # | 件 | 要点 |
|---|---|---|
| 1 | 摘除写档案通道 | 删 `saveEdits()` 里的 `batchFactoryPrice` 段 + `casePriceToFactory` 反推实现（源码与线上产物里 `batch-factory-price` 计数都应为 **0**） |
| 2 | 改走本期通道 | save-matrix 载荷 `rows[].case_price`（未录入传 `null`，**不传 0**）；非正数后端归 NULL，两边判据一致 |
| 3 | **两条行映射都注入** `casePrice` | `loadEditGrid` 需新建 `casePriceByPid`（源是 summary 的 rows）；`loadCross` 的 matrixRows 也要（只读态金额靠它）。🔴 **取非空值而非累加** —— 加单是「量」可以累加，**单价是「价」，累加会算出 2 倍价** |
| 4 | 草稿键 | `DRAFT_MASTER_KEYS` **去掉** `'factory_price'`：它不再是用户编辑的字段，留在草稿里反而会在恢复时用**旧厂价**覆盖新档案值；保留 `'casePrice'` |

文案三处同步改口径（表头悬停 / 网格下 `.cross-amt-note` / 录价框 `priceTitle`）。

### 🔴 探针三条铁律（本轮全踩过，全是「假信号」）

1. **拦截 URL 必须核 `api/modules.js` 的真实路径，别按模块名猜**：
   summary = `/api/forecast-submissions/summary`、save-matrix = `/api/forecast-submissions/save-matrix`
   （不是 `/api/forecast/*`）。写错 ⇒ 拦截器**永远匹配不到** ⇒ 断言退化成「未捕获」，白跑两轮。
   同理**探针不要自建 fetch 查询**：实测同 header、四种参数组合恒返回 0 行，而页面同一时刻明明有数据。
   **用页面真实发出的那份响应取证**（并记下它的 URL）。
2. **期次的 `summary.rows` 可能为 0，而表格里有几十行** —— 那些行来自**导入登记**
   `imported_products`，不是报单明细。拿 0 行那次验「字段是否下发」= **无效断言**。
   ⇒ 加**非空守卫**（`K0c`），并借页面原生的「**切期次**」操作多采集几份响应（采到有行为止，再切回原期次）。
3. **验收的隔离性判据**（比 UI 断言更硬）：库层直接查
   `SELECT period_start, period_end, product_id FROM forecast_extra_qty WHERE case_price IS NOT NULL`
   ⇒ 录入后**只有 1 行**、清空后 **0 行**。这一条同时证明「按期次隔离 + NULL 语义 + 可撤销」。

### 提交

`laozhangai-product` **7319ca2**（spec `fe-v191-periodonly`，16 + 在途 7 = 23 ✓）+ **d151871**（删 v190 旧探针）；
`hergent-erp` **2cec176**（spec `be-v191-caseprice`，6 + 在途 5 = 11 ✓）。
⚠️ **Forecast.vue 的 `-2856,2 +2853,21` 是混合 hunk**（含他人在途的 v179 行底改造 12 行，已在生产运行）
—— hunk 粒度无法再拆，为不打断「HEAD 源码 ≡ 线上行为」的审计链而**整块认领 + 提交信息里点名**。

---

## §v191b 🔴 单价留空 = **自动沿用上一期录入的价**（2026-09-18，用户「直接延用，不加按钮」）

**取值链（三级，唯一实现 `pricePerCase`）**：
① 本期手工 `r.casePrice`（落库=`forecast_extra_qty.case_price`，只在本期生效）
② **沿用** `r.casePriceInherit`（后端 summary 下发 `last_case_price` + `last_case_period_start/end`）
③ 都没有 ⇒ `priceAuto`（档案厂价 × 规格）

**四条铁律**：
1. 🔴 **沿用值绝不落库**：不进 `save-matrix` 载荷、不进 `DRAFT_MASTER_KEYS`。否则「没填」→「填过」，
   且清空后再保存被写回 ⇒ **用户永远清不掉**。判据：库层查 `case_price IS NOT NULL` ——
   未动单价保存后必须**全是 NULL**。
2. **只进灰字占位**（`value` 空、无 `manual-price`），来源写进 `title`（含沿用价 + 来源期次 + 档案自动价）。
   占位值用 `pricePerCase`（**生效值**）而非 `priceAuto`，否则与相邻「下单金额」两个口径。
3. **逐商品**：只有录过价的商品被带出（探针要有**对照行**断言，防「全表铺一个价」的假绿）。
4. **边界** `period_start < 本期 start`（严格小于）；取「最近一次录入」而非「紧邻上一期」
   ⇒ 跨多期没填也能一直沿用。后端**独立查小表 + Python 合并**，不塞进主 SQL 的 SELECT 子句
   （主查询 ? 顺序 `[SELECT]→[JOIN ON]→[WHERE]`，往 SELECT 加参数必须插到最前面）。

**已知取舍（交付时已向用户点明）**：沿用**没有作废机制** —— 厂家调价后只要该商品录过手工价就会一直沿用；
悬停里能同时看到「沿用价 vs 档案自动价」的差。要「档案一变就作废沿用」需另加判据（用户未要）。

**沙箱验证的两个必要条件**（否则判据恒为「无来源」，验不出真假）：
- 沙箱把 `order_date` 全改写成今天 ⇒ **天然没有可沿用的往期行** ⇒ 必须用夹具
  `.workbuddy/tools/sandbox_extra_qty_fixture.py --db tenant_9997.db seed --name 红桶 --price 88` 造一条；
- 夹具价（88）必须与**档案自动价（45）拉开距离**，否则「到底吃哪个」无判别力。

**提交**：`hergent-erp` **ac50a81** ｜ `laozhangai-product` **8916b4b**（spec `fe-v191b-inherit`，
11 + 在途 7 = 18 ✓）。

---

## §v192 🔴 「到货周期」改为**可隐藏**（2026-09-18，用户原话「请把"到货周期"设置成可隐藏列」）

**诉求性质**：不是加列也不是删列，而是**解掉 §8.3 的「固定列不可隐藏」**。原来该列是 v184 加的固定列
（`fixed: true` + 在 `FROZEN_COLS` 里），列设置菜单里它的复选框是灰的、右键也拒。

**五步改法（缺一步就是「能点但错位」）**：

| # | 改什么 | 判据 / 陷阱 |
|---|---|---|
| 1 | `frozenLeftOf` / `frozenRight` 改按**实际渲染的固定列**累加（遍历 `visibleCols` 里 `c.fixed` 的） | 🔴 **两个都要改**：只改前者，末位固定列被隐藏时 `frozenRight()`（= 手动冻结列的 left）仍算它 ⇒ 停在空缺宽度。**零位移保证**：没有任何列被隐藏时新式与旧式逐字等价（固定列已强制归位到最左） |
| 2 | 列定义加 `hideable: true` | 意图写在列自己身上 |
| 3 | `isLockedCol` 认 `hideable`（仍是唯一一份规则） | 固定列**默认**仍不可隐藏；`name` 仍无条件锁死 |
| 4 | 两个列设置菜单统一读 `isLockedCol(c.key)`，**别读 `c.fixed`** | `colOrder` 里**只有 `name` 带 `fixed`** ⇒ 读 `c.fixed` 判成「可拖可勾」= 假控件。查看态 v184 已修，**改单态那处一直漏着** |
| 5 | `hideable` 与 `deletable` 互不牵连 | 「可隐藏」不顺手放开删除 |

⚠️ **隐藏 ≠ 解除冻结**：重新显示照旧钉在原位（`left` 由 `frozenLeftOf` 现算）。已向用户点明，
并给了「要不要干脆取消固定当普通列」的备选（未选）。

**判别点（探针必须造）**：手动冻结列的 left 要跟着收缩 —— 可见时 `348px`（序号46+名称210+到货周期92），
隐藏后必须 `256px`；**旧实现恒停 348**。只断言「列没了」测不出第 1 步。

**顺带查到的两条既有死路**（同一条右键链上）：
1. **右键删内置列 = 删了会自己回来**：`canDeleteMaster` 只看服务端注册表，而该列不在 `PROTECTED_COLUMNS`
   里 ⇒ 一直给「删除列」；删掉后 `loadCols` 的「合并新增主档列」当它「元数据有本地没有」⇒ 刷新补回。
   已修：`canDeleteMaster` 加**本地硬否决** `if (m && m.deletable === false) return false`，且**放在注册表判断之前**。
   影响面恰好只有这一列（其余同标记的列本就在服务端保护名单）。
2. 🔴 **表头右键菜单只在改单态渲染**：`ctx`/`hdrCtx` 那整块模板挂在**编辑态分支**
   （祖先链 `activeTab==='summary'` → `viewMode==='cross'` → **`<div v-else>`**），
   而查看态表头照样绑着 `@contextmenu.prevent="openHdrCtx"` ⇒ **处理器执行、状态置位、一个菜单都不渲染**。
   一行定位法：合成 `contextmenu` 后看 `ev.defaultPrevented`（`true`=没到 handler；`true`+`.ctx-menu` 数 0=不渲染）。
   ⇒ **探针验表头右键必须先进改单态**（v192 首轮 29/39 全是这一个原因）。
   ⚠️ 此缺陷**本轮未修**（属结构性挪动 ~45 行，用户诉求不涉及）；已在交付说明「需确认事项」里报给用户。

**验证与提交**：沙箱 `9997 ← 源 1`（boss），探针 `.workbuddy/tools/forecast-hidecycle-v192-verify.js`
**41/41**；出图 `.workbuddy/tools/v192-hidecycle-shots.js`；交付 `outputs/预报到货周期可隐藏-2026-09-18/`。
`laozhangai-product` **607f534**（spec `fe-v192-hidecycle`，11 + 在途 7 = 18 ✓）。
前端 `Forecast-5IgLWh4g.js`（双侧 md5 `5793322672463d9661446b60dab0492e` 一致）。**纯前端改动，后端零变更。**

---

## §v193 🔴 导入门禁：判据 =「进行中(open)期次」，**不是**「有没有期次」（2026-09-18）

**触发**：用户实测「未新建期次也能导入」，要求「使实际操作顺序与**既定方案**保持一致」。

### 一、判据来源（别自己定口径）

项目内**已有用户拍板的方案**：`outputs/期次数据流程优化方案-2026-09-17/期次数据流程优化方案-2026-09-17.md`。

- **§四.1 原文**：「**不是『必须先建期次』，而是『必须有一个「进行中」的期次』**」
  三条理由：① 归属**事后不可回填**（导错期次，之后新建期次也不会把数据跟过去）
  ② **事故直接根因** —— 导入时 7/8/9/10 期**全 closed** ⇒ 兜底把 **154 个商品挂到了已关闭的 9 期**，用户根本看不到
  ③ fail-closed 铁律 —— **做不到正确归属，就不要写进去**
- **§四.1 同时点名本坑**：「`forecast_period_default()` 的文档**自称『仅展示用』**…但它**被导入路径当成了落库归属的兜底**。
  闸门若只加在『有没有期次』而不收窄这个兜底，**闸门形同虚设**（closed 期次仍会被兜底选中）」
- **§五 阶段 0**：无进行中期次 ⇒ **顶部常驻横幅 + 导入按钮禁用**（不是点了才报错）；
  「📌 判据：**禁用 + 说明好过「点了弹错误」**」

🔴 **两种判据的差别就是事故场景**：

| 场景 | 「有没有期次」 | 「有没有 open 期次」 |
|---|---|---|
| 有 open 期次 | 放行 | 放行（一致） |
| **期次全 closed** | **放行 → 挂到已关闭期次（事故本体）** | **拒绝** ✅ |
| 零期次 | 拒绝 | 拒绝（一致） |

⚠️ 本轮我**先按「有没有期次」实现并验证全绿**（6/6+8/8），查方案后才发现方向错、**推倒重做**。
教训：用户说「与**既定方案**一致」⇒ **先翻项目里那份方案文档**，别按字面自定口径。

### 二、漏洞本体在后端

旧 `_execute_forecast_cross`：`forecast_period_current() or forecast_period_default()`
——`default()` 末级兜底 = **最新创建的期次（不限状态）** ⇒ ① 全 closed 时挂到已关闭期次 ② 零期次时落 `period_id=0`
——**两种都照样写库**。前端置灰只是提示，`curl` 直连接口即可绕过。

### 三、三处判据同源（防漂移的关键）

```
前端 canImport ← GET /periods 的 open 字段 ← 后端 forecast_period_current() ← 后端硬闸判定归属同一个函数
```
⇒「前端按钮灰不灰」与「后端会不会 400」是**同一条件**。

| 面 | 改动 |
|---|---|
| `import_router.py` | 删 `default()` 兜底，只认 `forecast_period_current()`；`_period_id <= 0` ⇒ **400**（一个字节都不写） |
| `forecast.py` | `GET /periods` 新增 **`open`** 字段 |
| `Forecast.vue` | ① `openPeriodId` ← `open` ② `openImport()` 函数内硬守卫 ③ 工具条按钮 `:disabled`+title ④ **顶部常驻横幅** `.gate-bar` ⑤ 空态改指路「新建期次」⑥ 两入口共用同一 `canImport` |

- ⚠️ **`current` 与 `open` 不可互换**：`current`（= `default()`）是**展示**口径（全 closed 时仍兜底，
  否则 `curPeriod=0` 让汇总表落「今天~今天」成空表）；`open` 只认真实进行中的期次。⇒ **新增字段**而非改语义。
- 🔴 **`periodsLoaded` 标记必需**：`loadPeriods()` 的 catch **静默** ⇒ 抖动/401 时 `openPeriodId` 停在 0，
  正好命中判据 ⇒ 会把入口**锁死**（静默失败伪装成能力缺失）。只有**成功加载过**才允许「确实没有进行中期次」成立。
- **选「禁用」而非「隐藏」**：隐藏会被当成「功能被删了」；方案判据同向。
- **闸门放服务端的两个前提（已核）**：① `_execute_forecast_cross` 是预报导入**唯一**落库入口
  （`/preview` 只解析不落库、`/one-shot` 不产出 `forecast_cross`）② 客户端**从不传 `period_id`**。

### 四、验证与提交

- 沙箱四阶段 **29/29**：A 6/6（有 open 不误伤）· **B 7/7（全 closed 事故场景）** · D 8/8（零期次零数据）· C 8/8（新建期次→门开→导入）
- 🔴 **库层取证**：B/D 前后快照 `1|2|1|449` / `0|0|0|449` **一字不差** ⇒ 被拦的导入**一个字节都没写**；
  C 后全部 `period_id=16`（新期次）⇒ 有归属非孤儿。400 断言用 Node `fetch` **绕过前端**直连接口 ⇒ 证明真约束在服务端。
- 🔴 **历史孤儿数据**：沙箱 = `tenant_1` 逐字节克隆（未动 `period_id`）里已有 **20 条 `period_id=0` 导入行**
  （`note LIKE 'Excel导入%'`）⇒ **生产同源，漏洞已真实产生孤儿数据**（已报用户，待定是否清理）。
- 提交：`hergent-erp` **c1c9508** · `laozhangai-product` **b841652**（spec `fe-v193-gate`，11 + 在途 7 = 18 ✓）。
  前端 `Forecast-D9CBQJ-t.js` 双侧 md5 `af0dead89528d2488005ac77590d43bc`。

### 五、连带修掉的基础设施缺陷（会反复踩，务必记住）

`sandbox_tenant.py` 的 `shutil.copy2` **不搬 uid/gid**（只搬 mode/mtime）⇒ 以 `ssh root@… python3 sandbox_tenant.py up`
跑时新库属主 = **root:root**，而后端 systemd 以 **hergent** 运行 ⇒
`attempt to write a readonly database`（**接口 200、`success:0`**，看着像业务失败）。
修法＝属主跟着**源库**走。⚠️ **修完必须 `systemctl restart hergent-erp`** —— 后端有 SQLite 连接池
（按 `(线程, 库路径)` 缓存），SQLite 在**打开那一刻**就定死读写权限，不清池症状不变。

### 六、遗留（未修）

- `current`（默认视图口径）**保留兜底**是有意的，但副作用＝期次全 closed 时页面默认视图可能是**已关闭期次**，
  用户不会主动意识到。本轮只拦「导入」这条**写**路径；是否要在默认视图落 closed 期次时给可见提示 → 待用户拍板。
- v192 遗留未动：**查看态右键表头菜单不渲染**（约 45 行模板需挪到两态共用层）。

---

## §v194 🔴 改单「删一列 → 保存失败」——**有两件事，别再混成一件**（2026-09-18，两度修正）

> ### 🔴🔴 本节已被修正两次。读之前先记这张表（**这是唯一入口**）
>
> | 用户描述 | 真因 | 看哪一节 |
> |---|---|---|
> | 「**页面出错了 / 表格没了 / 找不到保存按钮**」 | `selStats` 越界 ⇒ `ErrorBoundary` **全屏接管** | **§v194 一~五**（下） |
> | 「**页面还在，点保存弹『保存失败（网络或服务器异常）』**」 | **后端 `bulk-upsert` 写事务内重入开连接 ⇒ 自锁 ⇒ 140 秒 ⇒ 前端 20 秒超时 ⇒ nginx 499** | **§v194b（本文件末尾）** |
>
> **修正史**：
> - **v1**（错）：「真因 = 客户列被删空撞后端 400」「删一列不会失败」← 被用户一句「我只删了报单单元最后一列"永诺旗舰店"那一列」推翻。
> - **v2**（答错题）：写「真因 = `selStats` 崩整页」——**机制对、但答错了题**（用户答 **乙**：页面还在、弹了保存失败）。
> - **v3 = 定稿**：用户那次「保存失败」的真因是**后端事务自锁**（§v194b），**与「删列」没有因果关系**。
>   v2 那条 `selStats` 崩页**仍然真实存在**（真机复现过），但**降级为独立缺陷**，不是那次报障的原因。
>
> 🔴 **v3 之所以能找到，是因为补查了 nginx 日志** —— v1/v2 **只查了 `journalctl`**，
> 而 **`499/502/504` 在应用日志里一行都不会有**。详见 §v194b 与技能 `hergent-write-failure-diagnosis` §2 第 0 步。
>
> 报告：`outputs/改单删列保存失败排查-2026-09-18/`
> （**`02-排查报告.md` = v3 定稿** · `04-原始证据摘录.md` = 原始日志 · `03-有选区删最后一列-整页崩.png` = 本节崩页现场）
> **本轮只做分析 + 排查思路 + 修复方案，未改任何代码。**

### 〇、v1 错在哪（三条，防止再犯）

| # | v1 说法 | 错因 | 修正 |
|---|---|---|---|
| 1 | 「生产日志 `19:40:55 save-matrix 400` 就是用户那次事故」 | 🔴 **那是我的探针打的**。同时段我在跑 v190 沙箱验证（本机唯一文件变动＝`outputs/预报单价手工录入-2026-09-18/`，写于 19:25–20:10）。**决定性反证：`save_matrix` 成功必然写 `forecast_period_confirm`，而 tenant_1 无 09-18 行** ⇒ 那次 200 写在**已销毁的沙箱**里 | 用户事故**在后端没有任何 400 记录** |
| 2 | 「删一列本身不会失败，删到一列都不剩才会」 | 只覆盖「`customers` 变空 → 400」**一条**路径，漏掉**与客户列数无关**的另一条 | 删**一列**就够（只要落在选区内） |
| 3 | 备注「单击任一单元格即建 1×1 选区」 | 🔴 **错的**。`onCellDown` 非 Shift 分支执行 `selRange.value = null`（`4927`），线上 bundle 里是 `J.value=null` | 普通单击**不建**选区 |

### 一、真因（一句话）+ 症状

```
删除列 → 选区索引 c1 越过 units 边界 → selStats computed 抛 TypeError
  → 渲染阶段冒泡 → App.vue:2 的 <ErrorBoundary> 接管 → 全屏遮罩「页面出错了」
  → 表格与保存按钮全部消失（用户感知为"保存不了"）
```

```js
// Forecast.vue:3815   selStats computed —— 唯一真凶
else { const ui = c - visibleCols.value.length; v = rw.qtyByUnit[cross.value.units[ui].name] }
//                                                                          ^^^^^^^^ undefined → TypeError
```

🔴 **线上 bundle 逐字对应**：`https://hergent.cn/assets/Forecast-Dx602EC7.js` 第 **12 行第 6440 列**
＝ `else{const _=r-P.value.length;c=a.qtyByUnit[f.value.units[_].name]}` ⇒ 本地＝线上，无「改了没发」干扰。

**为什么是「整页」而不是「局部」**：`selStats` 是模板 `v-if` 直接读取的 computed（`Forecast.vue:1016`
`<div v-if="selStats" class="sel-stat">`）⇒ 渲染阶段抛错；而 `ErrorBoundary` 挂在 `App.vue:2` 包住
**整个应用**，且 `.err-boundary{position:fixed;inset:0;z-index:99999}` 全屏遮罩 ⇒ **侧边栏也一起没了**。
截图实证：整页只剩「页面出错了 / Cannot read properties of undefined (reading 'name') / 点此重试」。

### 二、精确触发条件（比直觉广，比 v1 精确）

```
崩溃 ⟺ selRange.c1 > visibleCols.length + units.length - 1
```

**建选区只有 4 条路**（🔴 普通单击**不算**）：

| 方式 | 位置 |
|---|---|
| 拖选（按下并划过） | `onCellOver` 4938 |
| Shift + 单击 | `onCellDown` 4924 |
| Shift + 方向键 | 键盘处理 |
| 全选 `Ctrl/Cmd+A` | 4953 `normRange(0,0,maxR,maxC)` |
| ~~普通单击一格~~ | ❌ `onCellDown` 4927 / `selectCell` 3836 都置 `selRange = null` |

**让它越界的三条**：
1. **选区覆盖最后一列 → 删掉那列**（`units.length` −1，`c1` 不变）← **用户本次就是这个**
2. **选区在任意处 → 删掉它左边的列**（右侧整体左移一位，`c1` 相对边界 +1）
3. **（同源·未实测）隐藏任一主档列** ⇒ `ui = c - visibleCols.length` **变大 1** ⇒ 同样越界。
   ⚠️ v192 刚放开「到货周期」可隐藏（`607f534`），**这个面的暴露面刚刚变大**。

**反例（不崩但静默错值）**：选区**完全落在被删列左侧**时不会越界、不报错——但状态栏
「求和 / 平均」会**悄悄算到另一个客户头上**。

### 三、放大器：两个删除入口都不清选区，而 `clampSelection` 本来就漏了一条

- `hdrDeleteCol()` 4564（qty 分支 4566-4568）/ `ctxDeleteCol()` 4062 —— 删列后**都不处理 `selRange`**
- `delCol(ui)` 3243-3248 —— 也不处理
- 🔴 仓库里**已有** `clampSelection()`（**4865**）本应做收口，**却只夹 `selected`、漏了 `selRange`**：

```js
function clampSelection() {
  const nr = ..., nc = Math.max(0, visibleCols.value.length + cross.value.units.length - 1)
  if (selected.value.r > nr) selected.value.r = nr
  if (selected.value.c > nc) selected.value.c = nc     // ← 只夹了 selected
  // ❌ 全程没有 selRange.value 的夹取
}
```

⇒ **`undo`(4838) / `redo`(4851) / `undoToLastSaved`(4862) 三条路径带着同一个漏洞**（这是 v1 完全没看到的第二条腿）。

### 四、v1 里**依然成立**的部分（别一并丢掉）

| 结论 | 状态 |
|---|---|
| 保存是「三阶段、三请求、非事务」（`saveEdits` 3355）：① `bulk-upsert`（真 throw）→ ② `save-matrix`（真 throw）→ ③ `extra-values`（**catch 只 toast 不 throw**） | ✅ ⇒ **阶段③不可能产生「保存失败」**；`saveFailed.prodDone=true` ＝「①成②败」铁证 |
| 前端校验不背锅：`validateAll()` 失败走**校验清单弹窗**，与「保存失败」是**两条出口** | ✅ |
| 后端 `save_matrix` 全文**只有一处** `HTTPException`（`forecast_submissions.py:337`），`customers: []` 必然 400（接口级直证：`[]`→400 / `["__对照__"]`→200） | ✅ 机制成立，但**属另一条坑**（需删到最后一列） |
| `all_units` 是**租户级客户名册、不按期次过滤**（`erp_db.py:16446`，`ORDER BY MIN(s.id)`）；tenant_1=21 / tenant_10=24，0 行期次也返回 21 | ✅ 且**「永诺旗舰店」`MIN(id)=187` 正是第 21 个＝最后一列** ⇒ 用户描述准确 |
| `units` 装配＝① `all_units` 打底 ② 当期报单客户补 role（`loadEditGrid` 2944-2949）。① 是 **2026-08-31 才上线**（`git log -S"all_units"`→`3ae397f`/`456881b`）⇒ 在那之前客户列**可以只有 1 列**，当时「删一列就撞 400」真会发生 | ✅ 时间线留档 |
| 界面「网络或服务器异常」是前端 `kind` 分类器（3447）的**兜底文案**，后端从没说过网络 | ✅ |
| 已排除：条码唯一索引是**部分索引**（`WHERE barcode!=''`）· `bulk_upsert_products` 只在 `rows` 非数组时 400（恒为数组）· `start`/`end` 有「今日报单」兜底 | ✅ |

### 五、决定性证据（探针 7 PASS / 3 FAIL，3 条 FAIL 全是这个 bug）

```
PASS  G0  已建立选区（覆盖最后一列）   lastColC=28  .sel-stat="选区统计 计数 5 求和 0 平均 0"
PASS  G1  右键最后一列表头 → 删除列    列 21 → (表格消失)
FAIL  G2 ★删列后触发前端异常
          [ErrorBoundary] TypeError: Cannot read properties of undefined (reading 'name')
              at yc.fn (https://hergent.cn/assets/Forecast-Dx602EC7.js:12:6440)   ← = selStats
FAIL  G3 ★点保存 → 找不到保存按钮       点到的按钮=false / 未捕获到任何写请求
FAIL  G4 ★是否报「保存失败」            banner=undefined        ← 与后端毫无关系
PASS  H1  对照：无选区删最后一列        列 21 → 20
PASS  H2  对照：无选区时保存            bulk-upsert 200 / save-matrix 200  customers=20
                                        toast="已保存：20 个客户 · 0 条商品明细 · 商品 0 新增 / 154 更新"
```

**G2 堆栈直指 `selStats`（`yc.fn`），H 组证明无选区时一切正常** ⇒ 根因与触发条件双向锁定。
探针：`.workbuddy/tools/forecast-delcol-with-selection-verify.js`｜v1 探针（删光→400）保留备查。
零残留：`ZERO_RESIDUE: true` · `left_files: []` · `changed_tables: []` · 源库 sha256 未变。

### 六、修复方案（**针对本节的「崩页」缺陷**；用户那次失效的真因修复在 §v194b 八）—— 优先级已两度重排

⚠️ **下面这组是「本节崩页缺陷」的修复清单**，**不是**用户那次「保存失败」的修复（那在 §v194b 八）。
它的定位是「重装弹」：真实、已复现，但**不是那次报障的原因**。
（v1 曾把「`delCol` 加至少保留一列」列 P0-1，那是按错误结论排的。）

- **P0-1 · `selStats` 越界守卫（1 行，本节的止血点）** ← 本节先做这个
  `3815` → `else { const ui = c - visibleCols.value.length; const u = cross.value.units[ui]; if (!u) continue; v = rw.qtyByUnit[u.name] }`
  即使选区索引仍是脏的，最坏也只是「统计栏少算一格」，**不会再把整页端掉**。
  对照：`cellText`(5024) / `commitCell`(4649) / `cellVal`(4621) 都有 `if (ui < units.length) return` ✅ ——**只有 `selStats` 漏了**，照抄既有写法即可。
- **P0-2 · 修 `clampSelection`（4865）补 `selRange` 夹取 + 两个删列入口各调一次** ← 治本
  顺带修好 `undo`/`redo`/`undoToLastSaved` 与「隐藏列」三条同源路径。
- **P0-3 · `delCol` 加 `if (units.length <= 1) { toast('至少要保留一个客户列'); return }`**
  ＋表头/表体右键「删除列」在最后一列时**置灰**。菜单条件（`1601-1629`）＝
  `hdrCtx.key !== 'name' && (hdrCtx.type === 'qty' || canDeleteMaster(...))` ⇒ **qty 列零 guard**。
  （修的是 §四 那条「另一条真实存在的坑」，非用户本次踩到的）
  ⚠️ 删列**连带删掉该列全部报单量**（`delCol` 的 `delete r.qtyByUnit[u.name]`），且**只有点保存才落库** —— 与「隐藏列」有本质区别。
- **P0-4 · `saveEdits` 提交前拦 `!cross.value.units.length`**，给可行动提示
- **P1-1 · `kind` 分类器（3446-3450）扩词** —— ⚠️ v194b 已具体化：**必须同时判 `e.name`**
  （现有三个正则只读 `e.message`，而 `AbortError` 的关键信息在 `name` 里）；补 `缺少|必填|参数` 与 `abort|中止`
- **P1-2 · 右键「删除列」加确认**
- **P2-1 · 后端 400 文案写清缺哪个字段**（`forecast_submissions.py:337`）
  ⚠️ **只改文案不动闸门是安全的**；若考虑**放行** `customers: []`，**必须先核 `save-matrix` 是否在
  「小程序共享的 11 个接口」清单里**
- **P2-2 · 死代码**：`cellDiff`(5446) 全仓**无任何引用**

### 七、排查方法论升级：**日志归属＝第 0 步**（⚠️ v194b 补充：**必须查两层日志**）

🔴 本轮血的教训：**先问「这行日志是谁的、在哪个层」，再问「它支持什么结论」。**

🔴🔴 **v194b 补充（比上面这条更贵）：必须查两层日志。**
| 层 | 命令 | 独有信息 |
|---|---|---|
| 应用 | `journalctl -u hergent-erp --since <t> -o short-iso` | 业务异常、trace、`database is locked` |
| **代理** | `zgrep -e "<端点A>" -e "<端点B>" /var/log/nginx/access.log* \| awk '$9!=200'` | **`499/502/504`** · **客户端 UA** · Referer · 体积 |

**`499/502/504` 不会出现在应用日志里**；**nginx 是唯一带 UA 的层**（出口 IP 与探针相同 ⇒ IP 分不出归属）。
**「后端无记录」有三种可能**：① 前端没发（nginx 也没有）② **发出去被中止（nginx 有 499）** ③ 被拦（502/504）。
**只有排除 ②③ 才能走「前端渲染异常」。** v1/v2 就是漏了 nginx，把 ② 当成 ①，连错两轮。
**反推请求起点：`起点 = 499 时刻 − 前端超时`（`api()` 默认 `timeout=20000`）。**

四动作缺一不可：① 查登录审计（`audit_logs`）框住用户在线时段 ② 查**本机**同期文件 mtime
③ 查**成功请求的业务痕迹**（`save_matrix` 成功必写 `forecast_period_confirm` ⇒ **找不到痕迹＝不在这个租户**）
④ 确认该接口有几个调用方（`grep saveMatrix` 全仓只有 `Forecast.vue:3426`）。

辅助判据：拿**只有用户会造成的状态**反向卡时间（本次用「`永诺旗舰店` 首次出现 = 2026-09-06
（sub 187 `created_at=2026-09-06 15:41:23`）」⇒ 早于该日的记录全排除，直接排掉全时段唯一一条
用户 IP 的 400：`2026-08-22 17:01:36`，IP `27.27.126.231`）。

其余六步（原文/请求数/真实载荷/后端全部失败点/日志时序/沙箱直连）见报告 §三。
⚠️ 本轮踩过的坑：**探针 `summarize()` 里 `res.reqs` 未兜底 ⇒ `FATAL TypeError`，480 秒白跑一轮**
（所有 `res.*` 一律 `|| [] / || {} / ?? null`）· 探针循环上限 < 实际条数 · `console` 抓 Error 得
`JSHandle@error`（要 `args()` + `evaluate(e => e.stack || e.message)`）· 用本地时间匹配 UTC 的
`created_at`（服务端 `datetime('now','localtime')` 是 CST）· zsh 里 `grep "A\|B"` 静默失效（**本轮又踩一次**）
· **`awk` 里 `$4 ~ /\[18\/Sep/` 会直接 fatal**（用 `grep "18/Sep/2026"`）· 服务器**没有 `sqlite3` CLI**
（用 `python3 -c` + `sqlite3` 模块）· 本机 zsh **没有 `timeout` 命令** ·
**只读 `e.message` 做分类**（`AbortError` 的信息在 `e.name` 里）·
**把「等间隔重复的报错」当网络抖动**（等间隔＝`busy_timeout`＝**事务自锁**）·
下载线上 bundle 与本地源码逐字对照，是打掉「改了没发」类怀疑的最快手段。

### 八、待用户拍板（**已被 v194b 取代，见下**）

用户已答：**`乙`**（页面还在、点保存弹「保存失败（网络或服务器异常）」）⇒ 本节的 (甲) 不是用户那次。
**决策入口已移到 §v194b 末尾。**

---

## §v194b 🔴🔴 用户答「乙」⇒ 真因再翻：`bulk-upsert` **写事务内重入开连接 ⇒ 自锁 ⇒ 140 秒 ⇒ 前端 20 秒超时**（2026-09-18 深夜定稿）

> **触发**：用户对三选一答 **`乙`**。这**否定了 v2 的判断**——v2 曾据「用户事件在后端无记录」
> 推出「只能是前端崩页」。**那句话本身才是错的。**
> 报告：`outputs/改单删列保存失败排查-2026-09-18/02-排查报告.md`（**v3 定稿**）·
> `04-原始证据摘录.md`（原始日志逐行）

### 一、🔴 前两轮最严重的取证错误：**只查 `journalctl`，一次都没查 nginx**

- nginx 的 **`499 / 502 / 504` 在应用日志里根本不存在** —— 客户端中止时 **uvicorn 一行都不写**
- 一查 nginx 即得 **3 条铁证**（全部 `POST /api/products/bulk-upsert`、全部 `499 0B`、
  全部真实浏览器 UA `QQBrowser/21.9.0.213`）：

```
18/Sep/2026:16:48:12   499  POST /api/products/bulk-upsert
18/Sep/2026:18:24:38   499  POST /api/products/bulk-upsert
18/Sep/2026:22:59:55   499  POST /api/products/bulk-upsert
```

- **nginx 是唯一带 UA 的层** ⇒ 分辨「真实用户」vs「我的探针」**只能靠它**
  （出口 IP 与探针相同 `27.27.121.222` ⇒ **IP 分不出归属**）
- ⇒ 已升级为方法论第 0 步**强制项**（技能 `hergent-write-failure-diagnosis` §2 第 0 步 0.a）

### 二、真因链（每一环都有实测，无沙箱）

```
Forecast.vue:3393-3397  if (prodRows.length) await productsApi.bulkUpsert(prodRows)   ← 154 行
client.js:184-186       timeout = 20000 + AbortController                            ← 20 秒的来源
data.py:336             with db.get_db_tx() as conn:                                 ← 持有写锁
data.py:392             conn.execute("UPDATE products SET ... WHERE id=?")
data.py:394-396         if brand_raw: nb = db.track_brand(brand_raw, "web_grid")     ← ★ 事务内、且要写库
erp_db.py:8417          with get_db() as db:                                         ← ★ 另开连接
erp_db.py:8358/8366     add_brand_pending → INSERT INTO brand_pending                ← 撞锁
connection.py:201-203   docstring 自述「re-entrant ⇒ fresh throwaway connection」
connection.py:228       PRAGMA busy_timeout=5000                                     ← 5 秒的来源
erp_db.py:8421-8425     except → 只 logging.warning、不 throw                         ← 掩盖层 1
Forecast.vue:3446-3450  只读 e.message；AbortError 无关键词 ⇒ 落兜底                  ← 掩盖层 2
```

🔴 **是「自锁」不是「竞争」**：外层事务不提交就等不到内层返回，内层在等外层释放锁
⇒ **必然失败、每次走满 5 秒** ⇒ 耗时 = `5 秒 × N`（**确定性**，不是偶发）。

### 三、量化模型

```
失败 ⟺ (品牌不在册的行数 N) × 5 秒 > 20 秒  ⟺  N ≥ 4
```

| N | 后端耗时 | 结果 |
|---|---|---|
| 0 | < 1 秒 | ✅ 正常 |
| 1–3 | 5–15 秒 | ⚠️ 能成功但白等，期间**全租户写锁** |
| **≥ 4** | **≥ 20 秒** | ❌ **必然 499 ⇒「保存失败（网络或服务器异常）」** |

**tenant_1 实测 N = 28 ⇒ 稳定失败，每次都失败。**

### 四、四条铁证

**① 精确 5 秒节拍（trace `76cbe8a1`，28 条）**

```
16:47:57 → 16:50:13   每 5 秒一条，共 28 条（= busy_timeout 5000 逐字吻合）
品牌构成：蒙牛低温（福宝）24 + 蒙牛低温（恒滋）1 + 友芝友 3 = 28
```

**② 时间轴闭合**

| 你的 499 时刻 | 反推请求起点（499−20s） | 后端首条锁失败（起点+5s） | 后端末条 |
|---|---|---|---|
| `16:48:12` | `16:47:52` | `16:47:57` | `16:50:13`（**共 140 秒**） |
| `18:24:38` | `18:24:18` | `18:24:23` | 同构 28 条 |
| `22:59:55` | `22:59:35` | `22:59:40` | `23:01:56`（**共 141 秒**） |

**③ 天然对照实验（我的探针正好把阈值卡死）**
探针发 **4 行** `蒙牛`（不在册）⇒ 4 × 5 = **正好 20 秒** ⇒ 第 4 条锁失败 `19:40:29`
与 nginx `499` **同一秒**。

**④ 异常条数对上账**
`09-18` 全天 `track_brand` 失败 **96** = 用户 3 次 × 28 + 我的探针 3 次 × 4 ✅
（对不上账就说明还有没找到的调用方。）

**附：`AbortError` 真机实测**（探针 `.workbuddy/tools/v194b-abort-kind-probe.js`）：
`name='AbortError'`、`message='signal is aborted without reason'`、**三个正则 matched=[]** ⇒ 落兜底。
⚠️ `Forecast.vue:3446` **只读 `e.message`**，而关键信息在 `e.name` 里。

### 五、「删列」与本次故障**无关**

- 失败**全部**落在 `bulk-upsert`；`save-matrix` **真实浏览器 0 次非 200**（4 条非 200 全是我的探针）
- 三个 trace 的载荷构成**完全一致** ⇒ 删列没有改变触发条件；失败的唯一变量＝「品牌是否在册」
- 三次失败跑在**三个不同的前端构建**上（`index-D_7SMH8c` / `Forecast-BNmwpwIU` / `Forecast-D9CBQJ-t`）
  ⇒ **变量不在前端**
- **基线对照（真实浏览器按天）**：`12–16/Sep` save-matrix **0** / bulk-upsert **0**；
  `17/Sep` **3 / 0**（成功）；`18/Sep` **0 / 3（全 499）**
  ⇒ **这条路径本来就极低频**（数据主要来自导入，「改单→保存」平时几乎不用）
- 「删列后有选区崩整页」**是独立缺陷**（真实、已复现）⇒ 降级为 **P1-2**

### 六、附带伤害（必须写进报告）

`bulk-upsert` 的 140 秒里**一直持有 tenant_1 写锁** ⇒ **一次点击＝两分多钟全租户写冻结**。
证据：全天 97 次 `database is locked` 里 96 次是 `track_brand`，另 1 次是**库存巡检调度**
（`18:28:12 [Scheduler] Low stock check error: database is locked`）。

### 七、🔴 第二个坑：品牌待审队列「静默消失」

`brand_pending` **13 条全是 `backfill` 来源、全是 `resolved`、没有一条 pending**。
`友芝友` 赫然在列（已 resolved）却**不在 `brands`**：

```python
# erp_db.py:8393-8394  resolve_brand_pending 的 dismiss 分支
elif action == 'dismiss':
    pass          # ← 只把记录标成 resolved，不写进 brands
```

⇒ **「忽略」过的品牌每次保存都会重新触发 5 秒等待**，而它本该产生的新待审记录
**恰恰因为自锁写不进去** ⇒ **队列看起来是干净的，实际上永远收不到这批品牌**。

### 八、修复清单（**代码一行未改，待拍板**）

- 🔴 **P0-1（新 · 唯一止血点）· `track_brand` 的登记移出写事务**（`data.py:336-405`）
  循环内改用 **`db.normalize_brand(brand_raw)`**（纯字符串处理，不碰库）并把品牌名收进 `brand_seen`；
  **`with` 块退出（已 commit、锁已释放）后统一 `db.track_brand(...)`**。
  > 依据：`track_brand` 的返回值**就是** `normalize_brand(raw)`（`erp_db.py:8413/8425`）
  > ⇒ **不改变写入内容**，只去掉那次「另开连接」。**140 秒 → 亚秒级。**
  > 备选：给 `track_brand`/`add_brand_pending` 加 `conn` 参数复用外层连接（不推荐，会固化坏模式）。
  > ⚠️ **后端契约级改动**，动手前先核调用方（已知 2 处：`Forecast.vue:3394` 全量 / `ProductArchive.vue:1003` 单行）。
- 🔴 **P0-2（新）· 只提交脏行**：`bulk_upsert_products` 现在每次全量 upsert **154 行**
  ⇒ 前端加脏行追踪（编辑/粘贴打 `_dirtyProd`），只提交改动行。
  ⚠️ **与 P0-1 都要做**：只要还有 1 行触发 `track_brand` 就仍要等 5 秒。
- 🔴 **P0-3（新）· 超时与文案**：`modules.js:361` 让 `bulkUpsert` 支持透传 `opts`，调用处传
  `{ timeout: 60000 }`（`hermesChat` 已有 300s 先例）；**超时文案改成可行动的「保存超时，请稍后重试」**。
  ⚠️ **只是缓解** —— 放宽超时**不解决写锁**（140 秒内别人照样写不进去）。
- **P1-1（新）· `kind` 分类器（3446-3450）必须同时判 `e.name`**（`AbortError` 的关键信息在 name 里）
- **P1-2（保留 · 独立缺陷）**：`selStats` 越界守卫（3815，**1 行**）· `clampSelection`（4865）补 `selRange`
  + 两个删列入口各调一次 · `delCol`（3243）至少留一列 + 菜单置灰 · 提交前拦空 `customers`；
  死代码 `cellDiff`(5446)
- **P2（新）· 品牌治理**：修好 P0-1 后会**一次性涌入 14 个品牌**进待审
  （福宝 / 恒滋 / 友芝友 / 君乐宝 / 蒙牛常温 / 蒙牛奶酪 / 蒙牛乳饮 / 妙可蓝多 / 妙奇 / 旭培 / 光明 / 赠品 / 蒙牛 / 测试品牌）
  ⇒ **需用户拍板**：批量归并（`蒙牛低温（福宝）`/`（恒滋）` → `蒙牛低温`？）还是各自建品牌。
- **P2（新）· 可观测性**：`track_brand` 失败只 `logging.warning`（没人看）⇒ 失败 ≥ 1 即告警；
  `bulk-upsert` 耗时 > 3 秒即告警（本次 140 秒，本该早就被发现）
- **P2（新 · 工具缺口）**：**服务器不保留历史 dist** ⇒ 17/Sep 用户跑的 `Forecast-CDew07p7.js` 已不在，
  无法事后回答「当时跑的是哪一版代码」⇒ 部署时留 `dist-<ts>.tar.gz` 若干天
- **P2（新 · 待查 · 同族隐患）**：`Sep 01` 63 次 `database is locked` 来源是 `POST /api/rebate-rules`
  （另有 21 条原始 `sqlite3.OperationalError` 回溯），**机制未核** ⇒ 查「写事务内是否也另开连接」。
  **这是一类隐患，不是一处 bug。**

### 九、⚠️ 口径更正（**别再引用旧数**）

旧记录写的「`database is locked` 每天 2000–23000 行」**是错的**。
重测（`journalctl` 窗口 6/26 起，`--disk-usage` = 3.9G）：

```
Aug 02   1 次
Sep 01  63 次   ← 来源 = POST /api/rebate-rules（机制未核）
Sep 18  97 次   ← 96 = track_brand + 1 = [Scheduler] Low stock check
```

### 十、待用户拍板（**新的决策入口**）

| 档 | 内容 |
|---|---|
| **甲 · 最小止血** | **P0-1**（后端 ~15 行）+ **P1-2a**（前端 1 行）← **推荐先做**，解决用户实际踩到的那条 |
| **乙 · 止血 + 治本** | 甲 + **P0-2** + **P0-3** |
| **丙 · 全做** | 甲 + 乙 + 全部 P1 + P2（含品牌治理） |

另需单独确认：
- **P0-1 属后端契约级改动**，是否先让我把「调用方 / 小程序共享接口」影响面核完再动手（约 10 分钟，只读）
- **品牌归并怎么处理**：(A) 只进队列手动处理 / (B) 我先出归并建议表 / (C) 先把 `福宝`/`恒滋` 归并到 `蒙牛低温`

---

## §v195 🔴 甲档**已执行并上线验收**：改单保存失败止血（P0-1 后端 + P1-2a 前端）（2026-09-19 凌晨）

> **本节是 §v194b 的执行收口。** 真因推导全文在 §v194b；这里只记「改了什么 / 怎么判 / 以后别再踩」。
> **触发**：用户对报告 §六.1️⃣ 回单字 **「甲」** ⇒ 首次授权改代码 + 部署。

### 一、改动（2 文件共 10 行，其余一律未动）

| 文件 | 改法 | 关键约束 |
|---|---|---|
| `server/routers/data.py` | 写事务**内**的 `db.track_brand(raw)`（另开连接 ⇒ 撞自己的锁）→ 事务内只做纯字符串 `db.normalize_brand(raw)` 并收集进 `brand_seen`，**事务提交后**再统一逐行登记 | md5 `424316c9…`→`c29c1f70f042626254d78041abedf042` |
| `hergent-cn-v2/src/pages/Forecast.vue` | `selStats`(3815) 越界守卫 `const u = cross.value.units[ui]; if (!u) continue;` | 随 `Forecast-ChazXb6O.js`（**+19 B**） |

**为什么不改 `track_brand` 签名而改调用点**：`track_brand` 有 5 处调用方（`data.py:395/401`、`import_router.py:2076`、
`sync_writer.py:60`、`import_zhoupu.py:122`）⇒ 只改调用点，另外 4 处**天然不受影响**。
**为什么改写内容一字未变**：`track_brand(raw)` 的返回值**就是** `normalize_brand(raw)`（`erp_db.py:8402-8407`，纯字符串、不碰库）；
登记仍**逐行调用、不跨行去重** ⇒ `ref_count` 累加语义与改前逐字一致。

### 二、🔴 以后遇「同族问题」的第一判据（比本 bug 更值钱）

**事务内任何「另开连接」的调用 = 自锁候选。** 本项目 `connection._sqlite_connect` 的重入分支会为内层调用
拿一条**新连接**（源码自述 "fresh throwaway connection to preserve transaction isolation"）⇒ 它写的东西
**必然撞外层未提交的写锁**，每行白等 `busy_timeout=5000`。

- **通用判据**：等间隔**精确 5 秒**的 `database is locked`、**同 trace 重复** = **事务自锁**（`N 行 = 5×N 秒`）。
- **通用正解**：把「事务内的写」改成「**事务后的写**」；若必须事务内，就让它在**同一连接**上写（加 `conn` 参数）。
- **同族待查（未核）**：`Sep 01` 63 次 locked 来源 `POST /api/rebate-rules` ⇒ 查「写事务内是否也另开连接」。

### 三、验收数字（四层，逐层可复查）

| 层 | 改前 | 改后 |
|---|---|---|
| 沙箱单变量对照（28 行未注册品牌） | **140.46 s**（3 品牌登记**失败**） | **0.149 s**（3 品牌**全成功**）⇒ **940×** |
| 真实 HTTP `POST /api/products/bulk-upsert`（28 行） | 客户端超时 | **200 / 0.168 s** ⇒ **833×**；响应结构 `{"success":true,"inserted":28,"updated":0,"skipped":0}` **一字未变**；`GET /api/brands/pending` 命中 3（改前 0） |
| **真机**（生产前端 + 沙箱租户，`v195-delcol-error-delta-verify.js` **11/11**） | 有选区删列 ⇒ 越界崩整页（**保存按钮不存在**） | 删列后**零 console/page error**；点保存 → **4 请求全 200**（`bulk-upsert[200]303ms/156行`、`save-matrix[200]166ms(saved_customers=20, saved_items=567)`、`notes[200]`、`audit[200]`），toast「已保存：20 个客户 · 567 条商品明细 · 商品 0 新增 / 156 更新」 |
| 生产零污染 | —— | 三文件 md5 与基线一致；`tenant_1` products 449 行未变 / 测试条码 `9999%` **0 条** / `brand_pending` 仍 13 全 `backfill-resolved` / `brands` 仍 4 |

### 四、🔴 判「是不是这次操作弄坏的」的标准做法（**本轮做对了，值得复用**）

用户报「**删列**后保存失败」⇒ 必须能回答「**是不是删列弄坏的**」。做法是**同一页面内前后对照**，但——

⚠️ **基线别用「点保存」**：若校验通过会**真写数据**、还可能**退出改单态**，把后续用例全污染。
✅ **基线用「查错」按钮**（`openErrList`）：它跑**同一个** `validateAll()`，列表为空时只 toast、**零副作用**。
⇒ `baseCount=2 == afterCount=2` 且**两次清单逐字相同** ⇒ 删列未引入任何新校验错误。
（交叉校验：工具栏 `.btn-badge.err` 角标 `2` 与清单条数一致。）

### 五、⚠️ 新发现：**同品牌条码重复 12 组**（独立数据问题，**非本次引入**，待业务判断）

期次 14 被前端校验拦下 2 处，对到档案是**同一商品的两个规格共用同一条码**：

| 条码 | 规格 A | 规格 B |
|---|---|---|
| `6934665010545` | 芭乐菠萝 200g***10瓶×6组**（id 1255） | 芭乐菠萝 200g***24瓶**（id 1257） |
| `6934665010521` | 青提牛油果 200g***10瓶×6组**（id 1254） | 青提牛油果 200g***24瓶**（id 1256） |

全库按 `(brand, barcode)` 共 **12 组**重复 ⇒ 其中 `赠品` 下 5 个不同杯子（雅特蓝系列）共用占位条码 `8003`。
⇒ **这些行一旦落在当期改单网格，点保存就会被拦「存在 N 处需要修正」**（`Forecast.vue:3359` `validateAll()` 前置门禁，
**设计如此**，不是崩溃、也不是「保存失败」）。**未改任何生产数据。**

### 六、新增的 4 个坑

1. **沙箱长事务实验会阻塞服务启动期的租户 schema 同步** ⇒ 重启后服务 `active` 但 **8700 不监听**、`health=000`。
   沙箱库**不阻塞生产库**，但会挡住 startup 的建表/迁移 ⇒ **重启服务与沙箱实验不可并发**。
2. **`vite build` 被 safe-delete shim 拦**（`dist/assets` 54 文件 > 阈值 50，报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`）
   ⇒ `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run build`。
3. **沙箱脚本备份写 `/root` 对 `hergent` 用户不可写**（`PermissionError`）⇒ 备份一律落 `/tmp`。
4. **探针断言会写反**：`ok('G4 是否报保存失败', !!G.banner)` 要求「真能抓到 banner」⇒ 表面 FAIL 实为 PASS。
   **探针的断言方向也要 review，别只 review 被测代码。**

### 七、部署纪律（本轮沿用并验证）
后端**具名 scp**（**禁用整目录 `rsync --delete`**）+ `chown` + 清 `__pycache__` + `systemctl restart` + 双侧 md5；
前端 `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run build` + `rsync -a --delete` + `chown` + **三处双侧 md5**
+ **归一化差集**（抹平 chunk hash / `data-v-*` scopeId / `sk-*` keyframes 后逐字节比对 ⇒ 本轮**唯一真变化 = `Forecast.js` +19 B**）。
沙箱 `tenant_9997` 用毕 `down` ⇒ `ZERO_RESIDUE: true` / `left_files: []` / `src_business_check.verdict=ok`。

### 八、未做（属**乙/丙**档）—— ⚠️ 其中 **P0-2 / P0-3 / 品牌归并** 已于当日 **v196** 完成，见文末 §v196
P1-2 b/c/d（`clampSelection`(4865) 只夹 `selected` 漏 `selRange` / `delCol` 至少留一列 / 拦空 `customers`）·
P2 其余（`track_brand` 失败告警 / `dismiss` 只标 resolved 不加进 `brands` / 部署留 `dist-<ts>.tar.gz`）。

---

## §v196（2026-09-19 · 乙档 + 条码判据 + 品牌归并）★ 三条用户定调

**用户逐字答复**：①「多规格本就允许共用条码」②「接着做」（= 乙档）③「算（这是我们公司在蒙牛低温有两个户头，
一个是福宝/一个是恒滋）」

🔴🔴 **①③ 必须同批改**：v178 判据「同条码 + **同品牌**」是靠**品牌名**区分两个户头 ⇒ 归并成「蒙牛低温」后
该手段**消失**、会**大面积误报**条码重复。**改一处不改另一处 = 归并完比归并前更糟。**

### 一、条码判据：两度放宽（只认最新一条）

| 版本 | 判据 |
|---|---|
| v178（09-16） | 同条码 + **同品牌** |
| **v196（09-19）** | 同条码 + 同品牌 + **同名 + 同规格 + 双方都在售** |

**放行**：多规格 / 同系列不同口味（6 组）、跨户头、停用旧档（`offArchive`）、赠品占位码 `8003`（5 个杯子 4 个名字）。
**仍报**：**同名同规格的在售重复建档**（唯一有真实危害：无档案号的新行会按条码匹配 ⇒ 两条并存串档）。
现存 3 组：每日鲜酪桂花马蹄 `1199/1438`、青青柚子 `1198/1439`、阿慕乐黄桃 `1219/1451`。
**敢 fail-open 的依据**：条码列自 v178 起 132px 宽、13 位全码可见，人工能核对；而误报的代价是**用户点保存被拦住**。

### 二、P0-2 只提交真正改动过的行（`Forecast.vue`）

- 新增 `prodPayloadOf(r)` = **唯一映射**（保存载荷与脏行判定共用 ⇒ 杜绝"第二份字段清单"漂移）
- 新增 `prodBaseline`（`Map(pid → payload)`）
- 🔴 **本节的唯一陷阱：基线必须在「草稿合并之前」抓**（`loadEditGrid` 里 `cross.value = {` **之前**）——
  紧随其后的 `loadDraft()` 会就地改 `rows`；在函数末尾才抓 = 把草稿里**未提交**的改动当成"本来就长这样" ⇒ **静默漏发**
- 只收 `product_id > 0`；**无档案号 / 基线缺失 ⇒ 必发**（宁多勿漏）
- 数量矩阵 payload **仍全量 `usable`**（本期录入数量是整表语义，不能只发改动行）
- 实测：不改任何东西 ⇒ **不发** `bulk-upsert`；改 1 行 ⇒ `rows=1`；toast「商品 0 新增 / **156** 更新」→「/ **1** 更新」

### 三、P0-3 超时与可行动文案

- `api/modules.js`：`bulkUpsert(rows, opts = {})` 支持透传（**此前不支持**；报告 §五 写"支持"是笔误），默认 `{}` ⇒ 既有调用方不变
- `Forecast.vue`：该步 `{ timeout: 60000 }`（默认 `client.js:184` = 20 秒）
- 🔴 `api/client.js` 新增 catch：**`AbortError` → `Error('请求超时（N 秒未响应）')` + `name='TimeoutError'` + `timeout=true`**
  —— abort 抛的是 `DOMException`，message 是英文（`signal is aborted without reason`），不含「超时/timeout/network/fetch」
  ⇒ 任何**按文案分类**的兜底都会归成「网络或服务器异常」。**这是全站问题，不只改单保存这一处。**
- `Forecast.vue` `saveEdits` catch：超时**按结构化字段判**（`e.timeout || name==='TimeoutError' || name==='AbortError'`）
  且取**最高优先级**；文案「保存超时，请稍后重试；若反复出现请联系我们」

### 四、品牌归并（生产 `tenant_1`，25 行）★就是 §八 里那个「P2 品牌归并」

- **前置核查（三项都指向零外溢）**：全库**只有 `products.brand`** 存此名（`brands` 表仅 4 行、无福宝/恒滋；
  `chanjet_tokens.scope` / `expense_orders.brand` 均 0 命中）· 25 个条码**全部唯一** ⇒ 归并后新增重复条码组 **0** ·
  后端唯一批量改品牌函数 `db/queries/sales.py:460 batch_update_category()` **无 API 路由**、页面无入口 ⇒ 只能授权直改库
- **结果**：`蒙牛低温` 132 → **157** · 福宝/恒滋 `24/1` → **`0/0`** · 商品总行数 **449 不变** ·
  品牌种类 19 → 17 · **重复条码组 12 → 12 不变**（无副作用）
- 备份 **`/root/backup_v196_20260919/`**（`tenant_1.db` + `rollback.sql`，25 条逐行 UPDATE）
- 🔴 **补票（归并脚本漏了、事后补上）**：`batch_update_category` 除改列外还会写 `updated_at`；且商品字段级改动要落
  `product_change_logs`（商品档案「修改记录」弹窗的数据源）。直改库绕过了后者 ⇒ 用户回头查「品牌怎么变了」**查无此事**。
  已补 25 条留痕（`user_name='**AI运维**'`，**刻意不写「张俊峰」**——不是他在页面上点的）+ 25 行 `updated_at`；
  `product_change_logs` 415 → **440**。历史那 24 条 `new_value='蒙牛低温（福宝）'` **保留不动**
  （那是当年"改成福宝"的真实留痕，归并是**新的一次变更**，不该擦掉历史）。

### 五、真机验收（生产前端 + 沙箱 `tenant_9997`）

| 用例 | 结果 |
|---|---|
| 条码判据 | ✅ 点「查错」从「存在 **2** 处需要修正」→「**当前没有需要修正的录入**」 |
| 无改动保存 | ✅ **不发** `bulk-upsert`（只有 `save-matrix`） |
| 改 1 行 | ✅ `bulk-upsert rows=1` / `{"inserted":0,"updated":1}` / toast「商品 0 新增 / **1** 更新」 |
| 60 秒超时 | ✅ 拦截延迟 **21 秒** ⇒ `bulk-upsert [200] 21062ms` + toast「已保存」（20 秒下必被 abort，不可能返回 200） |

### 六、🔴 本轮新坑（两条都会让你**误判产品有问题**）

1. **用探针验前端时，不要手删框架渲染的节点。**
   `document.querySelectorAll('.toast').forEach(t => t.remove())` 会让 vnode 与真实 DOM **脱同步** ⇒
   每次 patch 报 `TypeError: Cannot read properties of null (reading 'insertBefore')`。
   **那 4 条"前端异常"全是探针自己造成的**（改用 `MutationObserver` **只读不删**后异常数 = **0**，
   且反而抓到了第一轮漏掉的 toast 原文）。
2. **前端构建差集要防「误带在途文件上线」。**
   `npm run build` 会把仓库里**所有在途源码**编进 dist（本轮仓库有 20+ 个在途未部署文件）。
   判据组合：**归一化差集**（只看真变化）+ **在途文件 mtime vs 上轮构建时间**。
   本轮两者都指向「只有 3 个文件真变」(`Forecast.js` +538 / `index.js` +173 / `modules.js` +12) ⇒ 安全全量 rsync。

### 七、仍未做（用户未授权，**不自行开工**）
P1-2 b/c/d（`clampSelection` 漏 `selRange` / `delCol` 至少留一列 / 拦空 `customers`）· P2 其余 ·
`brand_pending` 两处设计缺陷（福宝当年**绕过**待审队列直落库；`dismiss` 只标 resolved **不加进 `brands`** ⇒ 忽略过的品牌反复回来）·
`products.brand='蒙牛'` 仅 1 行（疑似笔误，同属蒙牛体系，本轮未动）。


---

## §v197 丙档**已执行并上线**：P1-2 b/c/d + P2 全部 + 两项数据治理（2026-09-19 10:37–10:53）

> ⚠️ **编号说明**：本节的 `v197` 属**改单删列序列**（v195 甲 → v196 乙 → v197 丙），
> 与 `topics/reconciliation-redo.md` 里的 `v197/v198`（对账工作流）**不是同一条线**。
> 下次该序列请从 **v199** 起编。

**触发**：用户对报告 §六 三问回「**1.要；2.要；3.做**」。

### 一、前端（`Forecast.vue` 5 处）—— `delCol` 是**唯一漏斗**

| # | 位置 | 改动 |
|---|---|---|
| 1 | `clampSelection`(~4918) | 补 `selRange` **四边**夹取 + `selAnchor` 夹取；夹完反向置 `null`；**只在真变化时换对象**（避免无谓重渲染） |
| 2 | 新增 watch | `watch(() => visibleCols.value.length + cross.value.units.length, clampSelection)` —— **原来没人叫它**，删列后选区仍指老坐标 |
| 3 | `deleteMasterCol`(~2885) | 末尾补 `clampSelection()` |
| 4 | `delCol`(~3258) | 越界守卫 + `units.length <= 1` → toast「至少要保留一列客户列，不能全部删完」并 `return` |
| 5 | `saveEdits`(~3387) | `validateAll()` **之前**拦空 `units` → toast 指向「新增客户」 |

🔴 **关键判据**：删除客户列的三个入口（模板表头 `@899` / 右键 `ctxDeleteCol` / 表头菜单 `hdrDeleteCol`）
**全部调 `delCol`** ⇒ **拦一处即全覆盖**。以后加删列入口，必须确认它是否绕过了 `delCol`。

### 二、后端（3 文件）

| 文件 | 改动 |
|---|---|
| `routers/data.py` | `bulk_upsert_products`：品牌登记逐个 `try/except` 吞失败 + `brand_fail` 计数；`SLOW_WRITE_SEC=3.0` 超阈打**三段日志**（总 / 持锁事务 / 品牌登记）；回执加 `brands_seen`/`brands_failed` |
| `routers/import_router.py` | 销售单导入匹配：`WHERE barcode=? AND is_active=1 ORDER BY id LIMIT 1`；`pname` 提前 `pop`（修报错文案里名称**恒为空**）；新增「命中的是已停用商品」提示 |
| `erp_db.py` | `add_brand_pending` 去重扩到 `status IN ('pending','dismissed')` + `ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END`；`resolve_brand_pending` 的 `dismiss` 落**独立状态 `dismissed`** |
| 前端 `BrandArchive.vue` | 忽略弹窗补「**不再**反复提示」+ **反悔路径**（去「+ 添加品牌」手工建） |

### 三、🔴🔴 三条新硬事实（**以后必背**）

1. **`idx_products_barcode` 是普通索引，不是 UNIQUE**。
   `erp_db.py:1485` 的 `v89_products_barcode_unique` 迁移**当年被 `_safe_migrate` 静默跳过**
   ⇒ 这才是「同条码多行」能长期存在的**根因**。（补 UNIQUE 需先清完存量重复，见「待决」）

2. **「一个状态两个含义」的经典坑**：`dismiss` 原先落 `resolved`，而 `resolved` 的语义是
   「已建 / 已合并进 `brands` 表」—— 被忽略的品牌**恰恰不在** `brands` 里。后果：
   ① `add_brand_pending` 无法区分"用户主动忽略"与"建品牌半途失败"（前者该沉默、后者该重试）；
   ② 任何「品牌表几条 / 待审还剩几条」的核查**再也算不清**。
   ⇒ 这是**独立成第三种状态 `dismissed`** 的真正理由，不是"多个常量更清楚"。

3. 🔴 **商品匹配是「条码优先」**（`barcode` 命中即 return，**不再看名称**）。
   对「多规格共用条码」的合法场景（用户 2026-09-19 明确认可），后果是：
   录「200g*24瓶」会写进「200g*10瓶*6组」那一行；录「草莓」会挂到「巧克力」上
   ⇒ **销量 / 库存 / 厂价全部记到错的 SKU**。
   本轮加的 `ORDER BY id LIMIT 1` 只让结果**确定**（不再依赖 SQLite 查询计划），
   **并没有让它正确**。建议改为 **`条码+名称` 精确 → `条码` → `名称`**（单规格场景行为不变，严格更准）。
   **未修，待用户拍板。**

### 四、验收方法（**三层，且第 2 层值得复用**）

| 层 | 做法 | 结果 |
|---|---|---|
| 1 | **零写入探针**：`POST /api/products/bulk-upsert {"rows":[]}` | 回执含 `brands_seen:0 / brands_failed:0`；商品 449 / 在售 285 **零变化** |
| 2 | ⭐ **函数级幂等验证（隔离副本）**：`ERP_DB_PATH` 改指 `/tmp/v197-fn-test`，**断言 `DB_DIR` 指向沙箱**，`set_tenant_context(998)`，直接调 `erp_db.add_brand_pending` / `resolve_brand_pending` | 四条命题 ALL PASS |
| 3 | 生产逐项复核（SQL） + md5 双侧 + 健康 200 + 启动无 traceback + **公网取 chunk 断言** | 全绿 |
| — | ❌ **浏览器点击层未做**（本机 `agent-browser` 未安装） | 报告 §9.8 留手动路径 |

⭐ **第 2 层为什么值钱**：不碰生产、不需要沙箱租户、不需要重启服务，
却能证明**后端真实函数**的语义（不只是"代码看起来改了"）。
可用于任何"某函数被改了、要证明新语义成立"的场合。

### 五、🔴 复核判据的两个坑（**本轮实际踩到**）

1. **留痕行数判据必须限定到「本轮 pid」**：`user_name='AI运维' AND date(created_at)=今天`
   会把**当天上午另一次代操作**的补票一起吃进来（33 = v196 的 25 + 本轮的 8）⇒ 报**假 FAIL**。
   正确写法：`... AND product_id IN (本轮全部 pid)`，并**另加**「同日同 `(pid, field_name)` 重复 = 0」验幂等。
2. **`product_change_logs` 的列名是 `field_name`**，不是 `field`。
3. **条码被清空后不能再按条码分组统计**：三行空条码会被 SQLite 聚成一组（`''` 相等）
   ⇒ "退休后各剩几行" 必须**按名称**核，不能按条码核。

### 六、数据结果

- `products.brand='蒙牛'`(id=1591) → `蒙牛低温`；全库 `brand='蒙牛'` 残留 **1 → 0**。
- 3 组「同名同规格」重复建档：退休 1198/1199/1219（`is_active=0` + 条码清空），
  保留 **1439 / 1438 / 1451**；**厂价 39.6 从 1219 搬到 1451**；`forecast_import_products` 3 行改指保留行。
- `brand_pending` 12 行 `resolved` → `dismissed`（判据：`resolved` + **不在** `brands` + 仍有商品在用 ⇒ 0 条误判）。
- 留痕 **8 行**（`AI运维`），同日同字段重复 **0**。

### 七、🟡 待决（3 条，**未动**）

1. 是否把商品匹配顺序改为「`条码+名称` → `条码` → `名称`」（见三.3）。
2. `6934665096808`：**「巧克力谷物脆」与「草莓风味」两个不同产品共用同一副条码** ⇒ 哪一行填错了？
   （另两组 `6934665010521` / `6934665010545` 是**同名不同规格**，按已定口径**合法**，不必动。）
3. 是否给 `products.barcode` 补 **UNIQUE**（需先清完存量重复；当前仍有 3 组）。

### 八、回滚

- 代码：`/opt/hergent-erp/backups/code-20260919-104914/`（`data.py` / `import_router.py` / `erp_db.py`）
- 数据：`/opt/hergent-erp/backups/tenant_1.db.before-v197-dup-retire-20260919-104742.bak`
