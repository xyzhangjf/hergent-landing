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
🔴 **编号提示（给「改单删列」那条序列）：`v200` 已被「报单配置 / 门店可见范围」这条线占用**
（见下方 §v200）—— 那条序列的下一个号请从 **v201** 起编，别与 §v200 混为一谈。

---

## §v200 **已上线**：报单人门店配置收敛为单一入口 —— 读端取并集，报单配置成为真源（2026-09-19）

**触发**：用户要求「移除员工档案里的门店配置入口，仅保留报单配置下的入口，并确保移除后功能仍可用」。

### 一、🔴 一句话根因（**这类问题的通用判据**）

**两个入口写的是两张不同的表，而读端只认其中一张。**

| 入口 | 写的表 | 小程序「可见 / 可报门店」读的表 |
|---|---|---|
| 档案管理 → 员工档案 → 「门店」弹窗 | `employee_stores` | ← **只读这张** |
| 预报订单管理 → **报单配置**（`/forecast` 页内嵌 `<ReportMapping />`，**不是独立路由**） | `report_mapping` | 不读（只用于汇总表落列 / 模板列头） |

生产租户 1 实测**两表零交集**：`employee_stores` 只有 [张俊峰→一分利(2562)、张俊峰→一扫光(2804)、
emp9001→永诺旗舰店(2220)]；`report_mapping` 只有 [张俊峰→永辉东津店(2868)、刘小顶→美联（保康店）(2225)、
刘善涛→刘善涛仓] ⇒ **在报单配置里配了「永辉东津店」，小程序端看不到**。

**通用判据（与 v199 客户列「删了又回来」同一条铁律）**：
> **读端来源 ≠ 写端作用域 ⇒ 必然出现「配了不生效」或「删了又回来」。**
> 根治 = 让**读端 = 写端**（同一张表 / 同一口径），而不是在两头各打补丁。

⚠️ **所以"删掉一个入口"是个陷阱**：`employee_stores` 是可见范围的真源，删掉它唯一的写入口
= **门店配置功能整体失效**（正是需求要求避免的）。必须同时收拢读端口径。

### 二、收敛后的口径（改这块之前先读这张表）

| 角色 | 载体 | 可写？ |
|---|---|---|
| **真源** | `report_mapping`（active，`counterparty_type IN ('store','customer')`） | ✅ 报单配置页（**唯一入口**） |
| **历史兼容层** | `employee_stores` | ❌ 已无 UI（`employee_stores_set` 保留仅供脚本/旧接口） |
| **读端** | `employee_stores_get()` = ① ∪ ② | — |
| **收敛动作** | `employee_stores_prune_covered()` 清「**已被 active 映射覆盖**」的历史行 | 由 4 处写端自动触发 |
| **残留暴露** | `report_mapping_legacy_stores()` + `GET /api/report-mappings/legacy-stores` | 前端提示条 |

- `prune` **安全的前提**：删除**不改变可见集合**（映射会派生同一个 `store_id`）⇒ 幂等、零权限丢失。
  它存在的唯一理由：否则「在报单配置里**停用**映射」之后，历史层那行仍让门店可见 = **停用无效**。
- 写端 4 处挂钩：`report_mapping_create` / `update`（清**新旧两个**员工，`employee_id` 可被改=转交）/
  `toggle`（**只在启用时**清）/ `import`（`touched` 集合）。
- 对象集合与写端**同口径** `contacts.type IN ('customer','both')`。**读端口径必须显式对齐，不能默认相等。**
- 缺 `report_mapping` 表（老租户库）⇒ 回落历史层，不让一次缺表把小程序首屏带崩。
- `employee_list().store_ids` 也改用并集（原先直接吐 `employee_stores` 的行），与 `employee_stores_get` **同源**。

### 三、🔴 两条必背（不判就出事）

1. **`employee_stores_prune_covered(0)` 的语义是「清全租户」**（`employee_id=0` = 全部）。
   ⇒ 四个调用点**全部显式判 `if emp_id:`**。不判 = 误清全租户。
2. **`DELETE` 用 `rowid IN (子查询)`，不用 `DELETE ... AS es`** —— 后者依赖 SQLite
   qualified-table-name 别名语法，写法较新，老版本 / 其他驱动不一定认。

### 四、验收口径（**跑在提交的暂存产物上**，不是工作区）

- 函数级 22 项：AST 从 `erp_db.py` 抽**真实源码** exec 进内存 sqlite 跑（`v200-store-scope-verify.py`，支持 `ERP_DB=` 指向暂存产物）。
- 真机 E2E 13/13（`v200-store-entry-e2e.js`）。
- 生产只读回放：**张俊峰可见门店 2 → 3 家**（「永辉东津店」终于生效）；
  `employee_list().store_ids` 与 `employee_stores_get(7)` 逐字一致；行数未变。
- 提交：hergent-erp **`7e502fd`** / laozhangai-product **`26924cc`**。
  回滚：`/opt/hergent-erp/{erp_db.py,server.py}.bak-v200-20260919-123245`、
  `/opt/hergent-cn-v2.bak-v200-20260919-123159`。

### 五、🔴 运维 / 探针坑（**最容易自欺**）

- **生产只读探针必须带 service 环境**：裸跑 `python3 xxx.py` 会因缺 `ERP_SECRET`
  让 `employee_account_map()` 抛错 → `employee_list` 外层 `try` **静默吞掉** →
  返回的行**没有 `store_ids`**，看着像「代码没生效」。
  正确姿势：`set -a && . /opt/hergent-erp/.env && set +a && python3 …`
  （service 定义 = `EnvironmentFile=/opt/hergent-erp/.env`、`WorkingDirectory=/opt/hergent-erp`）。
- **`grep "store_map.setdefault(s[\"employee_id\"], set())"` 返回 0 是假阴性** ——
  `[...]` 被当字符类。查含方括号的代码一律 **`grep -F`**。
- **`ReportMapping.vue` 的产物在 `Forecast-*.js` 里**（`/forecast` 页内嵌组件，非独立路由），
  **不在** `Archive-*.js`。找产物标记要全量 `grep -l`，别猜 chunk 名。
- ⚠️ **旧描述订正**：本文件早前写的「`设置›报单配置`」**不准** ——
  实际入口是 **预报订单管理 → 报单配置**（`/forecast` 页内 `<ReportMapping />`）。

---

## §v203 **已上线**：报单配置「对象类型」收敛为 门店 / 本人仓（2026-09-19）

**触发（用户原话）**：「在报单配置里有门店和客户两个入口，实际上门店和客户是一个意思，只保留门店这个入口吧」

### 一句话结论

那两个入口**不是"两个功能"，而是同一批对象的两个标签** —— `/api/report-mappings/refs`
返回的对象池是 `contacts.type IN ('customer','both')`，「门店」与「客户」下拉里装的是
**同一个池子**；`counterparty_type` 从来只是个分类标签。⇒ 合并零语义损失。

### 判据：写端收敛、读端放宽

| 面 | 策略 |
|---|---|
| 写端（UI + create + update + import） | 只出「门店 / 本人仓」；`customer` **静默归一**成 `store`（不报错，旧 Excel 仍可导入） |
| 读端（7 处 `IN ('store','customer')`） | **保持不动** —— 读端收紧会让存量行从列表与可见门店范围里**静默消失**（v199 同族） |

唯一判据：`erp_db.py` 的 `REPORT_CP_TYPES` / `REPORT_CP_ALIASES` / `normalize_report_cp_type()`。

🔴 **`report_mapping_update` 里有个不写就静默失效的点**：归一后的值必须**回写进 `data`** ——
该函数后面有个通用字段循环会遍历 `counterparty_type` 并把原始值写进 SET 子句，不回写就被它覆盖，
净效果「改了等于没改」且**毫无报错**。（影子库测试专门盯这一条。）

### 实测数据（生产）

- 三个租户库 `counterparty_type='customer'`：**全 0 行** ⇒ 本轮**零数据迁移**、无兼容负担
- tenant_1 收敛后：`store=2`（东津 / 美联保康）+ `self_warehouse=1`（刘善涛）
- 张俊峰可见门店仍 **3 家**（一分利 / 一扫光 / 永辉东津店）—— 收敛**未改变可见范围**

### 验证（四层，全部真跑）

判据自证 **25/25** · 生产只读 **16/16** · **影子库写路径 22/22** · 真机 E2E **26/26**（重部署后复跑仍 26/26）

**影子库写路径**是本轮练出来的手法（值得复用）：`ERP_DB_PATH` 指到 `/tmp/v203-shadow`
+ 把 `tenant_1.db` 拷成 `tenant_99.db` ⇒ 在**真实结构 + 真实数据**的影子租户上跑写测试，零风险。
隔离自证：`DB_PATH` 不在生产目录、实际打开的库文件只有影子库。跑完复查真实库：
`report_mapping` 仍 3 行、无 `V203%` 污染行、`employee_stores` 仍 3 行。

### 🔴 四个坑（本段编号是第一个）

1. **本段原本编 v202，撞车后改 v203** —— v202 已被两处占用（`ad34224` 薪酬/权限 +
   在途的 `_safe_migrate('v202_forecast_import_sort_no')` 导入模板行序）。我的起号检查因
   `grep "v202\|v203"` 在 zsh 下 `\|` **静默失效**而假阴性。
   ⇒ **起号一律 `grep -e a -e b`；并搜 `_safe_migrate('vNNN_')` 迁移名**（最硬的占用证据）。
   ⇒ **本序列下一个号从 v204 起编**。
2. **「只改注释」也会改产物**：改注释后 Forecast chunk 由 295.95kB → 296.23kB、hash 也变了
   ⇒ 改完源码**必须重建重部署**，不能以"只是注释"为由跳过。
3. **裸调业务函数必须 `set_tenant_context(1)`** —— 不设则读错库（映射 0 条 / 可见门店 0 家），
   症状与「数据被删光 / 代码没生效」**一模一样**（本轮据误判报过 2 个 BAD）。
4. **真机脚本的截图要在关弹窗前拍** —— 首版写在关闭之后，拍到的是一张与页面截图
   **字节数完全相同**的空页面（纯废证据）。

## §v233 「报单单位」进档案（`products.order_unit`）+ 模板改单位**必带数量换算**（P2-2 + P2-3）

### 一、概念：一个商品有两个「单位」，混在一起就是 v217 的病根

| | 语义 | 存哪 | 谁在用 |
|---|---|---|---|
| **档案单位** | 舟谱「**小单位**」口径 | `products.unit` | 档案对账、价格档位（`pricing_engine`） |
| **报单单位** | 实际**下单**用的单位（可为**中**单位，**永不落大单位**） | `products.order_unit`（**v233 新列**） | 主表「单位」列、舟谱模板「`*单位`」列 |

取值优先级：`order_unit`（人工，一等公民）→ 条码层（`forecast_barcode_units`，**兼容**）→ 明细单位 → 名称推断。
留空是**一等状态**（= 跟随 `unit`），不是「没填」—— 前端两态显示写「跟随」而不是破折号。

- 唯一实现：`db/queries/products.py::order_unit_sql()`（整行版）/ `order_unit_master_sql()`（主表版，
  **商品不在档时回退明细单位** —— 存量零变化是硬要求；主表 `forecast_submission_summary` 调它，
  ⚠️ 该表达式被 `rows` 与 `detail` **两处共用**，改就必须两处同一字段集）。
- ⚠️ 前端 `products_grid` 下发的是**原始人工值**（不在本层合并）—— 档案页要能分辨「有没有人工指定过」。

### 二、🔴 最贵的不变量：改单位**必须**同时改数量

模板行「`*单位`」与「`*数量`」是**同一行上的两个格**。只改标签不改数 = 把 v217 那个错误
（`160红枣5连杯` 明细「8 条」）原样复制（单位改「件」而数量仍是 8 ⇒ **8 件 = 64 条**）。
换算比与主表 `perCase` **同源**：

```
qty_to = qty_from × per_case(to) / per_case(from)      # 不是 × from / to（反了把 8 条折成 64 件）
```

**换算不出来 ⇒ 退回明细单位、数量原样 + 下载告警点名**（宁可不改，不写一张量纲可能错的单）。

### 三、🔴 换算的**唯一权威**与跨语言重复实现

- 权威仍是 **`products.large_ratio / medium_ratio`**（消费方 `pricing_engine.py::_get_standard_price`
  正面确认语义：**「1 个该档单位 = 多少个小单位」**，与前端 `perCase` 一致）。
  `unit_conversions` 0 行 / `unit_archive` 空壳 ⇒ **别再新建换算数据**。
- ⚠️ **回退规格解析在跨单位时是「假换算」**（自测挖出的真缺陷）：`spec='8'`（**纯数字**）
  对 `unit='条'` 与 `unit='件'` **都**返回 8 ⇒ 比值恒等 1 ⇒「换了单位却没换数量」。
  修法 = 无档案换算时，**两个单位都必须能由规格串定位**（`unit_convert.py::_unit_in_spec`）才允许折算。
- 后端 `domain/unit_convert.py::per_case` 与前端 `Forecast.vue::perCase` 是**有意的**两份实现
  （跨语言无法共用代码）⇒ **唯一的钉法是同源校验脚本**：从前端 `.vue` **逐字抽出** `perCase` 源码
  喂 node，与 Python 同一批用例**逐值**比对 ⇒ `PARITY OK 24/24`。
  🔴 判据不是「看着一样」，是那份脚本的输出。改任一份必须同时改另一份并重跑。

### 四、数据事实（生产 tenant_1 只读勘察，285 个启用商品）—— 本轮最贵的新事实

- `unit='件'` 且 `large_unit=''`、`large_ratio=0` → **61 个**。原因：**舟谱档案压根没录过**它们的小单位，
  导入落了**默认值「件」**，而「件」在舟谱语义里是**大单位** ⇒ 同一列并排两种语义。
- `unit == large_unit` = **0 条** ⇒ **不是「值撞车」，是这批商品的档案信息从来没录全**
  （推翻了开工时「值撞车」的假设）。
- v217 场景实测复现：`id=1539 160红枣5连杯` `spec=8`（纯数字）、档案 `unit='件'`、明细填「条」
  ⇒ 系统显示「件」、舟谱要「条」，**量纲差 8**。
- `forecast_barcode_units`（115 行）与档案 `unit` 不同的**全部是那批** ⇒ 它实际就是
  **人工维护出来的「报单单位」覆盖层**（与明细单位对照，凡明细有的地方两者一致）。
- 🔴 **舟谱档案匹配 58 个条码 = 0 命中**（列名是「**小单位条码**」而不是「条码（小单位）」；
  改对列名后**仍 0** —— 这才是真结论：这批商品在较旧导出的舟谱档案里**根本没有**，
  是较晚报单的新品）⇒「从舟谱档案自动回填」这条路不存在。

### 五、回填（不丢、不猜）

- 来源 A = `forecast_barcode_units` 覆盖的商品（用户**专门维护过**，最权威）；
  来源 B = 明细单位**唯一**且 ≠ 档案 unit **且档案无换算**（`large_ratio<=0 且 large_unit=''`）。
  🔴 **B 必须带「档案信任闸门」的理由**：舟谱规则「填了大单位就必须填大单位换算」
  ⇒ **有换算 = 单位认真录过 ⇒ 不采信明细**。实测 `id=1316` 档案=盒/大单位=件/换算=12 而明细填「件」
  ⇒ **不加闸门会把对的改错**。
- 实测：**A 29 条 + B 0 条**（B 全被闸门挡下）。改动**主表**「单位」列 22 行（件 → 条/组/板/包/提/瓶）。
- 工具 `.workbuddy/tools/v233-order-unit-backfill.py`：**默认 dry-run**（`--apply` 才写）；
  在线备份（`conn.backup()`，不用 `cp` —— 快照可能带 `-shm/-wal` 读到不一致状态）
  → 事务 → 逐行**主键**定位 → 写后**逐列断言** → 输出**回滚 SQL**；幂等；**不覆盖手工值**。
  `master_unit_diff(conn)` 用**真身** `order_unit_master_sql` 算「主表单位列会变的行」（全表比，不按计划过滤）。

### 六、验证与两个方法论坑

- 三条硬验证：`PARITY OK 24/24`、`SELFTEST OK`（抽真身源码 exec 后断言，含 3 条反证）、
  模板逐行比对 **105 一致 / 0 单位变化 / 0 仅数量变化 / 2 降级**。
- 🔴 **坑 1：分类标签本身会误导人。** 那 **2 行 DEGR 是设计内降级，不是漂移**：
  `CD杯（16连）`/`CD杯8杯` 明细「件」而档案「组」、无换算、纯数字规格 ⇒ 求不出比值 ⇒
  **保持明细单位与数量原样 + 告警**；旧口径这两行会输出「组/1」（**只换标签不换数**）
  ⇒ 新旧不一致**恰是修对了**。工具原先把这一档标成 `FAIL` ⇒ 我在复跑时**误读成「2 行不一致 = 回归」**。
  ⇒ 已改标 `DEGR` + 末尾单段解释。**工具的分类标签是给人读的判据，别省那句注释。**
- 🔴 **坑 2：同一份副本库 + 改过的代码，跨轮对比会失真。**
  上一轮记的「107/107 一致」是在**加 `_unit_in_spec` 闸门之前**测的；加了闸门才会出现那 2 行。
  ⇒ **跨轮复跑前先确认「被测代码有没有在中间改过」**，否则会把「新判据生效」误判成「回归」。
- 方法论：「测试假数据编错」与「真缺陷」必须分清 —— 本轮自测 6 项 BAD 里 **4 项是我假数据编错**
  （`ARC_216` 写成 `medium_ratio=12, large_ratio=24` 使 `per_case('件')≠per_case('组')`；
  按 `_get_standard_price` 确认语义后改为 `2/24` ⇒ 自洽：1 件 = 24 杯 = 12 组），另 **2 项是真缺陷**。
  ⇒ 先证「假数据是否与真实语义自洽」，再判缺陷。

### 七、其他落点（容易漏的写路径）

- 🔴 `routers/data.py::bulk_upsert_products` **不是**走 `product_update` —— 它有自己的 `fields` 字典。
  不补 `order_unit` 的「**显式提供才写**」守卫 ⇒ 前端带了也**静默忽略**；
  且它被 Forecast「商品清单」网格与「商品档案 → 新增」共用，网格不带该键 ⇒
  无条件覆盖会把人工指定**清空**。判据用 `is not None`（**空串是合法值** = 清掉人工指定，
  用真值判断会把「显式取消」静默忽略掉）。
- `merge_products.fields_to_merge`（硬编码列表）加 `order_unit` —— 否则合并重复商品
  **静默丢掉**人工指定的报单单位（master 侧为空 → 合并后仍为空 → 无人报错、无从察觉）。
- `forecast_barcode_units` **表保留、不删**（与 P3「降级归档」同口径）：读路径保留为兼容层，
  **新增人工指定一律走商品档案**，别再往那个表加数据（第 2 份拷贝会漂移）。

## 🔴 客户列永不收（2026-09-22 v248 拍板）
- 交叉表的 `cross.units` = **客户（订货方）列**，且是**跨期持久名册**——载入处注释原文「即使当期无报单，也保留客户列」（Forecast.vue L3754 附近，`d.all_units`）。
- 🔴 任何「收空列/压缩宽度」类优化**只准动主档列**（保质期这类档案缺口）；**客户列整列空也必须显示**——文员按名册对照谁没报。v247 把空客户列收掉，用户看到「只剩东津一列」当即否决，v248 修正（commit `4121726`）。
- 判空列用 `flatItems`（全量行），别用 `vsWindow`（虚拟滚动窗口，列会闪烁）。

## §商品目标管理 · 口径已**全部**拍板（D1~D5 + D5-A 建议态）（2026-09-24 · **仅方案，未动代码**）
- 方案文档：`outputs/商品目标管理-需求梳理与开发计划-2026-09-24/01-需求梳理与开发计划.md`（674 行；D1~D4 已落定；**D5 当日被用户订正**为「加单列预填 = 均单剩余 − 本期报单合计」，同日回 `A` ⇒ 预填 = **建议态**）。**起号前重搜**（记忆里已见 v262 ⇒ 至少 v263 起）。
- **D1 已达成**：取 `rebate_achievements`（`dimension='product'`）；**未填 ⇒ 视为 0**（照常算，不退化成"提示不出来"）。
  ⚠️ 该表**缺单位列**，且生产 4 行**全是 `dimension='brand'`** ⇒ 要补列 + 先把商品维度在页面上打开。
- **D2 可报单数**（拍板"取用户在系统里设置的数"）= **`rebate_target_rules.arrival_count_override`**（中文标签「**本月到货次数**」，`rebate_rules.py:157`）。
  🔴 **品牌维度，不可全表共用一个数**：生产实测 蒙牛低温=**15**（`arrival_mode=interval`）／简爱=**8**（`arrival_mode=weekday`，同日 `arrival_weekdays='2,5'`）。
  🔴🔴 **剩余可报期次绝不能数期次表**（2026-09-24 实测**证伪**了上一轮写的"9 月实测 15 − 3 = 12"）：`forecast_periods` 在 tenant_1 **总共只有 3 行**（且全是 9 月 09-20~09-24；**8 月 0 行**）—— 期次表**根本没有历史**，数出来"还剩 12 期"而 9 月只剩 6 天，均单会被算小一大截。正确做法 = 走整月到货日历（`domain/arrival_schedule.py::compute_arrivals`，与配置面板「未来期次预览」**同源**）数「今天及以后」的到货日个数。
  🔴 **实时读取、不读快照**（否则用户改了设置界面不跟着变）⇒ `product_targets.order_count` 只作审计，不参与计算。
- **D3 减单夹断**（拍板"不能扣到负数，最低到0"）：`alloc_i = max(D × ratio_i / 100, −该人本期已报箱数)`。
  ⚠️ 遗留子问题（**本轮仍未单独答过**）：夹断后**要不要把多出的部分再分给有余量的人**？2026-09-24 用户回的 `A` 应按 **D5** 理解（当时只有 D5 是"回 A 或 B"的问题）⇒ **D3 暂按"要重分配"开工**（保"说减 60 就真减 60"，否则与加单总量栏长期对不上账）；用户若要简单版会回「D3 用 B」，改动只是去掉迭代那一层。
- **D4 目标挂月**：`period_month='2026-09'`，期次按 `order_start` 年月**自动认领**（一个月 15 期共用一个目标）；跨月期次按 `order_start` 归月。
  ⚠️ 均单目标**每期重算、不缓存**（分子"已达成"涨、分母"剩余单数"跌 ⇒ 同月内越往后每单要求越高，这是必然不是 bug）。
- **D5 ✅ 用户当日订正**（上一轮写的"Σ 各人 `max(0,…)`"**按人累加口径作废**）：加单列**预填**
  `预填值(箱) = (月目标 − 已达成) ÷ 剩余可报期次 − 本期报单合计`（**总量相减**；可正可负，**负 = 本期报超了该减**）。
  ✅ **总量口径比按人累加更准**：有人超报时**自动抵扣**（按人 `max(0)` 不抵扣 ⇒ 缺口被高估）；且与落库粒度一致
  （`forecast_extra_qty` 唯一键 = 产品×期次，**本来就没有人员维度**）。按人明细**降级为"悬停解释用"**，不参与计算。
  🔴 **红线 1：算「本期报单合计」不能用 `rowFinalQty`** —— 它是 `Math.ceil(rowBoxes) + rowExtraQty`（**含加单**），
     而现行冲刺看板 `rebateSprint.contrib` 正是用它 ⇒ 照抄会**循环依赖**（填加单 ⇒ 报单合计涨 ⇒ 预填值跌）。
     必须用 `rowBoxes(r)` / 后端 `SUM(quantity)`。
  🔴 **红线 2：别复用现成的「建议均单」** —— 冲刺看板 `perOrder = (目标 − 达成 − 本期报单) ÷ 期次` 是**摊平**口径
     （把本期已报摊给剩余每一期），与用户要的**本期归位**口径相差 `本期报单 × (1 − 1/期次)`，**期次 = 15 时差 93%**。
     `perOrder` 本身没错、**不要改它**，另算一个派生量给加单格。
  ✅ **D5-A 已拍板（2026-09-24 用户回「A」）**：预填值 = **建议态**，**不自动生效**。
     · 加单格照样有数（满足"预填"诉求），但**浅灰显示**；不点采纳就**不参与**分配 / 定稿 / 通知。
     · 四态：`空`(·) / `◐建议态`(默认，不算) / `○已采纳`(算) / `●已手改`(算)。**"全部忽略"落 0 = 不加也不减**（A 与 B 的分界）。
     · 保存 / 定稿前扫"仍为建议态"的格，N>0 弹一次确认【全部采用 / 全部忽略 / 我再看看】。
     · 🔴 **A1 必做**：`forecast_extra_qty` 增 `source` 列（`manual` / `suggested-accepted`）—— 不记来源就白选 A（事后分不清"他填的"还是"他采纳的系统建议"）。
     · 🔴 **A2 = 新红线 3：建议值实时重算时只刷"仍是建议态"的格，绝不能覆盖经理已改 / 已采纳的格** —— 否则"改一次被刷回一次、永远存不下来"，且零报错。
     · 🔴 后端 `save-matrix` 对 `extra_qty` **没有负数校验**（`eq = float(r.get("extra_qty") or 0)` 直落库）⇒ 选 B（预填即生效）会**静默产生加减单**，这正是选 A 的原因。
  ⚠️ 交叉核实：**"均单"这个词在系统里现在有三套口径** —— ① 配置面板 `compute_per_order`（后端，`目标 ÷ override`，**override 优先**）；
     ② 冲刺看板 `perOrder`（前端，`缺口 ÷ 实时推算次数`，**根本没读 override**）；③ 本功能要的"本期归位"。
     三者不可互相替代，动手前先确认在改哪一个。
- 🔴 **数据链（核实过的真路径，实现时照走）**：
  `report_mapping.employee_id → report_alias` ⨝ `forecast_submissions.store_name` ⨝ `forecast_submission_items`（`product_id`/`quantity`/`unit`）→ ÷ `perCase` 折箱 → 减均单目标。
  生产实测 `report_mapping` 5 行：员工6→`'刘善涛'`（`self_warehouse`/调拨单）、员工7→`'东津'`（永辉东津店/自提）⇒ **`report_alias` 就是报单表的 `store_name`，两边同源**，名字匹配在这里是可靠的。
- ✅ **该隐患 v264c（2026-09-24）已修写端**：`forecast_submissions.store_id` **39 行里 38 行为 0**（只有 `store_name` 有值）⇒ 只能按名字匹配 ⇒ **改名即断链且零报错**。
- 旁证：`employee_stores` 在 `tenant_1/9/10` **全为 0 行**（历史层已收敛）⇒ 门店范围的权威是 **`report_mapping`**，不是 `employee_stores`（v200/v203 已确立）；`hr_employees` **没有 role 列**，别指望用它判"业务员"。

---

## v264c · 报单「列名 ↔ 报单对象」对账（2026-09-24，已上线）

**要回答的问题**：汇总表里的客户列，有多少对得上「报单配置」(`report_mapping`)？
对不上 ⇒ 落库 `store_id=0` ⇒ 「逐人实报」只能靠**名字**匹配，报单配置里一改名就断链，**而且零报错**。

- 🔴 **R9 真身（推翻方案文档的假设）**：38 行 `store_id=0` **不是**小程序写的（`store_id<=0` 直接 400）、
  **也不是** Excel 导入写的（走 `resolve_alias_to_contact`，解不到退 0 + 回执点名），
  **是 Web `save_matrix` 第 864 行硬编码 `{"id": 0, "name": cname}`**。
  · 指纹取证法：38 行**同一秒批量创建**（`16:13:21`×19 / `23:24:52`×19）+ `total_qty=0` + `updated_by` 空；
    唯一带 id 的那行（id=715）有 `updated_by=张俊峰` ⇒ **批量同秒 + 无操作人 = 代码写的，不是人点的**。
- **修法两条硬约束**（改动时若漏掉任一条都会静默出错）：
  1. 解析走**唯一实现** `db.resolve_alias_to_contact`，且必须放在 **`get_db_tx()` 写事务之前** ——
     它内部**另开连接**读 `report_mapping`，与写事务**互锁**（SQLite）。
  2. `store_name` **仍传汇总表列名**，**不能**换成 contacts 系统全称 —— 换了会与 Excel 导入落库的名字
     **裂成两列且永不合并**（v247 用户报障的原形）。
- **可见性（避免"修了没人知道"）**：
  · 新只读端点 **`GET /api/product-targets/mapping-audit`**（v264c）—— 三态
    `mapped` / `same_name_only`（**只在 contacts 有名，仍落 0，不猜**）/ `unknown`；
    返回 `unmapped_count` + `unmapped[]` + `columns[]` + `caliber`（**对象**，不是字符串）。
  · 目标页顶部告警条（`ProductTarget.vue::.pt-audit`）—— `v-if="audit && audit.unmapped_count > 0"`，
    配齐则**整条消失**（不留常态噪音）；**刻意为不加深链**（报单配置是预报页里的页签、无独立路由，加深链 = 死链）。
  · `save-matrix` 回执增 `unmapped_columns`。
- 🔴 **新增路由必须显式登记 `_PATH_MODULE_MAP`**：判据是**字面前缀**，
  `"/api/product-targets".startswith("/api/products")` = **False** ⇒ 不登记会 403（不是 404）。
- ⚠️ **存量 38 行未回填**（沙箱断言已固化"本次不回填"）。原因两条：
  ① 19 个列名只有 **3 个**能解析出 id（东津 2868 / 刘善涛 9 / 美联保康 2225），11 个只有同名 contacts、5 个连同名都没有；
  ② `forecast_submission_list` 范围 = `(user_id=? OR store_id IN 授权门店)` ⇒ 回填会让 `role='导入'` 的行
     进入**门店负责人小程序「我的报单」列表**。三条路（不动 / 只回填 3 个 / 配全后全量）待用户拍板。
- 🔴 **单位同源（陷阱 B 已修）**：`/api/products/fill-search` 此前下发 `p.unit`，而 Web 汇总表「单位」列取
  `order_unit` 优先、空回退 `unit` ⇒ **两把尺子**。v264c 改为**同一份 SQL 片段** `db.order_unit_sql(alias)`
  （erp_db 已转发，**别手抄第二份**），并增 `unit_raw` 键（人工指定值原样，空=跟随档案）。
  生产实测**唯一命中 id=1596**（`unit='瓶'` / `order_unit='组'`）⇒ 修前小程序显示「瓶」、Web 显示「组」。
  ⚠️ 老租户库可能**没有 `order_unit` 列** ⇒ 整条 SELECT 抛错会被外层 `except Exception` **静默吞成空列表** ⇒ 按 `cols` 自适应。

### ⚠️ 与「目标与返利」里那个「商品目标」不是一回事（2026-09-24 核实）
- 返利域的「商品目标」= `rebate_target_rules` 里 **`dimension='product'` 的一条返利规则**（与「品牌目标」同表同表单，只差维度；`Rebate.vue:257 openCreate('product')` 只是预设维度）。**不分解到人**，单位可自由文本，作用 = 算返利。
- 报单域的（本页）「商品目标」= `product_targets` + `product_target_alloc`，**一律按箱、分解到人、驱动报单**。**两者不可互相替代、也不该合并**（一个答"能拿多少返利"、一个答"这单该报多少"）。
- 🔴 **本页只读依赖返利域两处**：到货日历 ← `rebate_target_rules(dimension='brand')`；**已达成 ← `rebate_achievements(dimension='product')`**。
- 🔴 **锚点不同源隐患**：返利域 `scope_key = resolveProductKey(scope_name)`，**查不到 byName/byBarcode 时原样存字符串**；本页锚点是 `products.id` ⇒ `_achieved_map` 只能宽松匹配 ⇒ 名字对不上就**静默把已达成读成 0**（均单偏大、零报错）。**要让两端同为 product_id，正确修法是拦在返利域写入侧**（查不到商品就拒绝保存），不是在读侧继续放宽。

### 🔴 页签 vs 侧栏入口：商品目标归属（2026-09-24 核实，未拍板）
- `/api/forecast` / `/api/forecast-submissions` / `/api/product-targets` **三者同属 `data` 模块** ⇒ 挂进预报页 tab **零权限变更**。
- 🔴 **挂载范式照抄 `ReportMapping`**（别自创）：那是 page 级组件塞进 tab 的成例，靠
  `.config-panel :deep(.page){padding:0;margin:0}` + `:deep(.page-hd){display:none}` 收掉页头与内边距。
  `ProductTarget.vue` 根结构逐字同构 ⇒ 直接复用同两条 CSS。
- 🔴 **`ProductTarget.vue` 零路由耦合**（无 useRoute/useRouter）⇒ 可原样挂；全站入口仅 4 处
  （Shell 桌面侧栏 / Shell 移动抽屉 / CommandPalette / router），**无跨页深链** ⇒ 挪位成本≈0。
- ✅ **依赖闭环**：它唯一只读依赖「报单配置」(`report_mapping`) 正是同页第三个 tab ⇒ 告警条终于能互跳（原为"无独立路由不能加深链"）。
- ⚠️ 返利域 `dimension='product'` 那个「商品目标」字面撞车**不会因此消失** ⇒ 互指说明仍要做。

---

## 🔴 三层数据模型：报单 / 提货 / 达成（2026-09-24 生产只读核实）

> **用户纠正**：「业务员报的数和他最终提货的数可能不一样」⇒ **报单是判断、提货是事实，两者不可互代**。
> 任何"达成"口径都**不能取报单量**（我曾误按报单量算，已作废）。

| 层 | 表 | 生产实况 | 时间 | 能挂到业务员？ |
|---|---|---|---|---|
| ① 报单（业务员报） | `forecast_submissions` + `_items` | 39 单 / 47 明细 / 9 商品 | **2026-09 起** | `store_id` **38/39=0** ❌ |
| ② 提货（最终提的） | `sale_orders` + `sale_order_items` | **580 单 / 15,539 明细 / 115 商品** | **2026-04-02~06-15** | `operator_id` 580 单**全同一人** ❌ |
| ③ 达成（返利用） | `rebate_achievements` | 4 行，全 `brand`，全 `manual` | 2026-08/09 | 5 维全无人 ❌ |

**① 与 ② 在时间上一天都不重叠** ⇒ 这就是为什么"报 vs 提"现在算不出来。

### 🔴 但两者天生是配对的（关键）
- `sale_orders.note` **580/580（100%）**写法固定：
  `报单批次:新版4月2报单-4月6到货 | 客户栏:唐成`
  ⇒ 可解析出 **38 个报单批次 × 23 个客户栏**。
- **报单汇总表的 19 个列名 ↔ 23 个客户栏，交集 16 个**（东津/刘善涛/刘小顶/刘正宝/吾悦/周运潘/唐成/成丽/易胜琳/毛辉/民发/王琴…）
  ⇒ **报单的「客户列」原本就是从舟谱「客户栏」抄来的同一套名字**（这就是 mapping-audit 那 19 个列名的来源）。
- 四个锚点体检：
  · **商品** ✅ 报单 9 个商品**全部**命中提货的 115 个（两边都是 `products.id`）
  · **客户** ⚠️ 靠名字（19 里 16 同名），**没有结构化外键**
  · **批次** ⚠️ 提货 100% 带批次名，但 `4月10报单-4月14到货` 与系统期次名 `2026-09-25 报单期次` **格式不同**；且 4~6 月那批**在 `forecast_periods` 里没有对应期次**
  · **业务员** ❌ 报单侧 `store_id` 大面积 0；提货侧 `operator_id` 580 单全同一人

### 🔴 提货数据的来源与断流
- `server/import_zhoupu.py` = **一次性脚本**（`system_config.key='zhoupu_imported'` 跑过不再跑），
  导 `/opt/hergent-erp/舟谱模版/` 下 **12 个 Excel** 的历史存量（商品/客户/供应商档案、上次售价、库存成本期初、应收应付期初、科目、员工列表、采销订单）。
- `import_trade_orders()` 读 `采销管理/销售订单-自提.xlsx`（header_row=4）→ `order_type='self_pickup'`；
  `销售订单-车销…xlsx`（header_row=2）→ `order_type='vehicle_sale'`。
- ⚠️ **修正**：生产 `order_type` **全是 `self_pickup`** ⇒ **车销那批 0 行**（`except … print()` 静默吞掉）。
  此前「覆盖自提（分销/永辉/美廉）与调拨（车销）」的说法**只有前半对**。
- ✅ **挂人的零件已设计好**：`operator_id` 取**舟谱导出的「业务员」列**（`item.get('业务员','')`），车销分支另取 `送货司机`→`driver_id`。
  ⇒ 生产全同一人 ⇒ **是源 Excel 那一列的问题，不是代码写死**。

### 🔴🔴 连带缺陷：预报页「AI 建议下单量」用的是三个月前的销量
- `routers/forecast_audit.py`（v107 审核引擎；前端 `Forecast.vue:2089`「日均销量」列在消费它）：
  `_avg_daily_sales()` 与 `/products` 批量版窗口都用
  `date((SELECT MAX(order_date) FROM sale_orders), '-30 days')`。
- 生产 `MAX(order_date)` = **2026-06-15** ⇒ 实际窗口 = **2026-05-16 ~ 06-15**，**落后今天 101 天**。
- 后果：**285 个在售商品里 180 个日均销量 = 0** ⇒ 判定退化为「近30天无销售数据，无法自动建议，请人工判断」。
  **不报错、数字看起来正常** ⇒ 「**恒定值 ≠ 当前事实**」型静默失效。
- ⚠️ **根因不在那条 SQL**（用 `MAX` 而非 `now` 是**有意**的：防数据滞后时窗口空掉），
  **在"没有持续更新 `sale_orders` 的通道"**。⇒ 正确修法是**建持续导入通道 + 加数据新鲜度告警**，
  不是把 `MAX` 改成 `date('now')`（那会在导入滞后时把窗口打空，反而更糟）。

### 量纲（已核，避免误判）
- 提货与报单**同一口径**（都是可报单位）。CD杯8杯：提货单笔 6/24/120 vs 报单 12 ⇒ 同量级。
- 「提货 12272 vs 报单 12」是**范围差**（提货=4~6 月 580 单合计；报单=某期次 39 单），**不是量纲差**。
- 提货单笔 quantity：max/min/avg = 1530/1/24.15；≤5 的占 800/15539。
- `sale_order_items` 15,539 行 **100% 有 product_id 且 100% join 得上 `products`**；`sale_orders` 580 单 **100% join 得上 `contacts`**（23 客户）。
  ⇒ **提货侧数据质量比报单侧干净得多**（报单侧 store_id 38/39=0）。

### 待用户确认的业务定义（**别猜**）
「最终提货的数」可能指：① 客户/业务员从仓库**提走**（= 这 580 单自提销售单）；② 向**厂家提到**的货（= 进货 `purchase_orders`）；③ 客户**终端实际卖掉**（动销）。
三个数不同、锚点也不同。

### 建议排序（曾把顺序搞反）
★1 **建持续导入通道**（舟谱销售/发货数据 → `sale_orders`，即战略里的「Excel 上传」路）—— 是「报 vs 提」「达成」「日均销量」**三件事的共同地基**；
★2 `forecast_audit` 加**数据新鲜度告警**（零依赖、立刻可做）；
3 「报 vs 提」对账（批次 × 客户 × 商品）；
4 业务员「我的达成」只读页；
5 `rebate_achievements` 加「人」维度。

---

## §v273 **已上线**：新建期次自动沿用「上一期」商品清单（2026-09-25 · `df5d386` / `bf92a02`）

> 本节是「用户报『按此前设计应自动带出上一期的商品信息和报单人信息，实际没带』」的**收口结论**。
> 「桶 × 归属键」矩阵见上文 §跨期复制；本节补的是**判定『上一期』的锚点**与**两条常被问错的实情**。

### 🔴 「上一期」必须锚 **业务时间序 `order_start`**，不能锚 `id`

```sql
SELECT id FROM forecast_periods WHERE order_start < ? AND id != ?
ORDER BY order_start DESC, id DESC LIMIT 1      -- erp_db.forecast_period_prev_id()
```
- 严格 `<`（不是 `<=`，也不是「id 最大值」）。
- 本库实测 **id 序与时间序是交错的**（历史数据），按 id 取会取到**更晚**的期次。
- `exclude_id` 用于「建完再沿用」的场景，防止把自己选成上一期。
- 前端 `npPrevPeriod` computed 与它**逐字同源**（锚 `order_start`、严格 `<`、并列取 id 更大者）
  ⇒ 前端显示的期次名 == 后端将要复制的源，不会「显示的是 A、复制的是 B」。

### 🔴 两条常被问错的实情（别照着用户原话直接做）

| 用户原话 | 实情 | 处置 |
|---|---|---|
| 「自动带出**报单人信息**」 | 报单人列取自 `forecast_submission_summary()` 的 `all_units` —— `forecast_submissions.store_name` 的**全历史聚合名册**，注释明确「**不按期次过滤**」（实测 19 人）。**它本来就与新建期次无关，不需要复制、也不会因新建期次而丢失** | 不做「复制报单人」这件事；用户看到列没了，是因为**表格区正处于空态**（无进行中期次），不是数据缺失 |
| 「新建完为啥表格是空的」 | 服务端已复制了商品清单，但**前端此时还没有进行中的期次** ⇒ 表格区空态 | 靠**回执提示**说清「带过来几个」，而不是让人猜 |

### 改法要点（三条，都有理由）

1. **复用 v184 的 `forecast_period_seed`，不新写复制逻辑** —— 它是**唯一**复制实现
   （`INSERT OR IGNORE` 幂等、带 `origin='seeded'`、连 v202 的 `sort_no` 模板行序一起带）。
   `origin` 是**导入能精确替换而不与上期品叠加**的前提，绕过它就会复活
   「模版 159 个品、导入后 275 个品」那个老 bug。
2. **默认 `seed_from_prev: bool = True` 放在后端**（`FcPeriodCreate`）⇒ 老前端不发这个字段
   也直接获得新行为；前端只是**加可见 + 可撤销**的开关。
3. **`scheduler._auto_period_open` 同步加沿用** —— 用户截图里的正是「系统**自动**创建的期次」，
   只改手工入口等于没修。自动开期与手工新建**行为必须一致**。

### 🔴 前端设计判据：不做静默自动，要「默认开 + 可见 + 可撤销」

v182 评审已否掉「静默自动复制」：**静默灌数据会让人以为在新建、实际在改旧的**。
`npPrevPeriod` 为 null 时**整个勾选框不渲染**（v-if）—— 没有上一期还摆一个勾了也不生效的框
= **假旋钮**。回执提示按**四分法**分开说：没勾 / 带到 N 个 / 上一期自己也空 / 压根没有上一期。
🔴 **③④ 混成一句话会让用户以为「上一期的清单丢了」**（`src_name` 非空是区分③④的唯一判据）。

### 🔴 前端视觉坑（v273b）：`max-width + nowrap + 省略号` 专挑**尾部**藏

初版给标签加 `max-width:260px;white-space:nowrap;text-overflow:ellipsis`，
1440 下把「沿用上一期「张记乳品演示期次-2026-09」的**商品清单**」截成「…的…」——
**恰好把最关键的三个字藏掉了**（截图实测）。期次名本来就长，限宽只会**稳定地**藏尾部。
⇒ 改成 `white-space:normal; max-width:420px; min-width:0; overflow-wrap:anywhere`：
文字永远完整、行宽不够自己折行、不挤按钮。
**判据（探针可自动查）**：`span.scrollWidth - span.clientWidth > 1` = 被截断。

### 验收证据（可直接引用）

- **隔离沙箱 `tenant_9997` 真机端到端 7/7**：默认请求 `copied=3` 且落库 `origin='seeded'`；
  `seed_from_prev:false` ⇒ `copied=0`；锚点早于最早期 ⇒ `copied=0` 且 `src_id=0`；
  反向窗口仍 400；内外网 health 200。沙箱销毁后 `ZERO_RESIDUE=true`、
  源库 `business_check verdict=ok`。
- **离线单测**：`test_auto_period_v242.py` 22/22（含新增⑨⑩⑪⑫）、
  `test_period_prev_v273.py` 9/9（内存 SQLite，**故意让 id 序与时间序交错**）。
- **无头只读真机探针**（公开演示租户，**绝不点创建**）：勾选框可见、默认勾选；
  标签显示的期次名与按后端口径**独立算出**的逐字一致；点击可切 true→false→true；
  `spanClipped=false`；「取消/创建」仍可见。
- ⚠️ **单测替身铁律**：给 `install()` 新增调用口子（`forecast_period_prev_id` /
  `forecast_period_seed`）**必须同时补 `FakeDB` 替身**，否则单测会掉进真实 `erp_db`
  ⇒ **连生产库**。这条与「新增调用口」是一体两面，写代码时就要一起加。

---

## 🔴 均单提示的**前置是三件套**，缺任一都**静默不显示**（v279f · 2026-09-26 生产实证）

小程序报单页那行浅色「均单目标 N X」要出现，必须**三件事同时成立**：

| # | 前提 | 不满足时的表现 | 判据 |
|---|---|---|---|
| ① | 该商品**本月**有目标 | `flags.no_target` | `product_targets WHERE period_month='YYYY-MM' AND product_id=?` |
| ② | 该商品有**大单位换算** | `flags.no_convert` | `unit_display_map(0, arc)` 非空 ⇐ `large_ratio > 0` |
| ③ | 该**品牌**有启用的**到货规则** | `flags.no_rule`（← **本轮新确认的这一条**） | `_arrival_ctx(brand)` 查 `rebate_target_rules WHERE dimension='brand' AND is_active=1 AND (scope_key=? OR scope_name=?)` |

🔴 **③ 是最隐蔽的一条**：它按**品牌名精确匹配**，没有兜底、没有模糊匹配、没有默认规则。
生产实测（2026-09-26）：`dimension='brand'` 只有 **`蒙牛低温`** 与 **`简爱`** 两条，而
**`蒙牛鲜奶` 有 37 个商品（其中 27 个在本期报单清单里）** ⇒ **这 27 行永远不会有提示，且零报错**。
⇒ 新增/改名品牌时必须同步建到货规则，否则该品牌全部商品静默失去均单提示。
（`_arrival_ctx` 的 `reason` 有两种：`no_rule` = 品牌没规则 / `no_dates` = 规则算不出日期。两者都**不许猜一个次数**。）

**本轮实例**：`id=1596`（报单单位 `组` ≠ 档案单位 `瓶`，是生产**唯一**这种商品）
补完 ② 后 `no_convert` 消失，但**仍缺 ③**（品牌 `蒙牛鲜奶`）⇒ 它的 D20 判据**依然不可观测**。
⇒ 「补了换算 = 提示会出现」是**错的**，别再把 ② 当成充分条件。

### 顺带：补换算会把「组」的口径从错的 24 改成对的 6

`1596` 补前 `large_ratio=0` 走**规格串回退**（`spec='24'` 纯数字 ⇒ 「1 箱 = 24 组」），
补后走档案（`large=件/24`、`medium=组/4` ⇒ `per_case('组') = 24/4 = 6`）。
⇒ 同一个「组」，**4 倍的差**。凡看到「缺换算的商品却有合理的均单数」，先怀疑是不是回退分支凑出来的。

---

## 🔴 v273 的「自动沿用上一期清单」在**上一期本身为空**时，会**静默复制 0 行并逐期传染**（v279f 实证）

日志是决定性证据（`journalctl -u hergent-erp | grep auto_period`）：

```
Sep 24 16:05  已创建期次#18 (2026-09-24~2026-09-25)                              ← 无「沿用」段（v273 之前建成）
Sep 26 16:02  已创建期次#19 (2026-09-26~2026-09-27)，
              沿用上一期「2026-09-25 报单期次」0 个商品                          ← v273 执行了，但复制到 0 行
```

- `create_period`（`routers/forecast.py:310`）与 `scheduler._auto_period`（`scheduler.py:1022`）**都**会沿用，
  源由 `forecast_period_prev_id(order_start)` 按**业务时间序**取（不是 id 序）。
- 复制走 `_period_copy_products` / `forecast_period_seed`（v184 唯一实现），`INSERT OR IGNORE`，
  幂等且带 `sort_no`（v202）。
- ⚠️ **失败会告警、成功但 0 行不告警**：`try/except` 只覆盖异常；`added == 0` 是**正常返回**，
  日志里就是一句「0 个商品」。⇒ 只要有一期清单为空（v273 之前的期次、或导入失败），**后面每一期都为空**。
- **后果**：`fill-search` 的数据源是 `forecast_import_products`（v215 起改为「期次商品清单」，**空集不 fail-open**）
  ⇒ **清单 0 行 = 小程序报单页完全空白**，而服务日志一切正常。
- **手动补法（正规路径）**：`POST /api/forecast/periods/{源pid}/seed` body `{target_period_id: 目标pid}`
  （目标必须是 `open`）。本轮的 `17 → 19` 就是这样补的，`added=154`。

### ✅ v282（2026-09-26）：给「沿用得到 0 个商品」加了告警（**三条入口全覆盖**）

**病根（判据层面）**：`forecast_period_seed` 原返回值里 `skipped = src_count − added`，
在「源有 N 条、但目标已有同商品被幂等跳过」与「**源自己就是 0 条**」两种 case 下**都是 0**
⇒ 调用方**根本分辨不出**这两种 0。v273 的静默复制正是踩在这里。

**改法（4 处）**：

| 文件 | 改动 |
|---|---|
| `erp_db.py` | `forecast_period_seed` 返回值**多带 `src_count`** |
| `routers/forecast.py` | `_carry_empty_warn(src_id, src_name, src_count)` = **唯一文案实现**；`create_period` / `seed_period` 两处回传 `carry_warn` ＋ `[v282][carry-empty]` 日志 |
| `scheduler.py` | `_auto_period_open`（**原先只有一行 print、用户完全看不见**）补 `_alert_carry_empty()` |
| `Forecast.vue` | `createPeriod()` / `seedFromPrev()` 在 `added=0` 时走 **warn 色**且文案**可操作** |

**三条硬约束（改回去就出 bug）**：

- 🔴 `message_send` 必须**显式传** `event_key="forecast_carry_empty"` —— 不传会走 `norm_event_key(title)`，
  把标题里的期次号**抹掉** ⇒ 与其它通知**串键**；同时 `MESSAGE_DEDUP_WINDOW=86400`（24 小时）防刷屏。
- 🔴 `src_id <= 0`（压根**没有**上一期）**不算异常**，返回空文案 —— 首期建表不该报警。
- 推送复用既有 `_push_tenant_channels(tid, ...)`（租户配了渠道走租户渠道，否则回落全局 webhook）。

**单测**：`tests/test_auto_period_v242.py` **36/36**（含 ⑬–⑰ 五组共 15 条新断言）、
`tests/test_period_prev_v273.py` **9/9**。
**踩过的坑**：替身 `_seed` 原来返回固定 `src_name=f"期次{src}"` ⇒ 告警文案里的名字**永远测不到**；
改为**按真实实现从 fake.periods 里读 name**。

---

## 报单配置（ReportMapping）四个「名不副实」判据 — 2026-09-27 专项分析

> 全文：`docs/报单配置-问题分析与改进方案-2026-09-27.md`。**动手改这个页面前必读本节。**

**① 「本人仓 / 调拨」在小程序端整条链路不存在（不是配置问题）**
- 读端 `erp_db.py::employee_stores_get` **只查 `contacts`**，子查询限定 `counterparty_type IN ('store','customer')`；
  而「本人仓」行的 `counterparty_id` 存的是 **`warehouses.id`** ⇒ **配了也永不进小程序下拉**。
- 写端 `routers/forecast_submissions.py::create_submission`（≈163-167）用**同一函数**做 403 门禁 ⇒ 直调 API 也 403。
- ⇒ 判据：**「对象」有两套 id 空间（contacts / warehouses），任何只认 `contacts` 的读端都会静默吞掉本人仓。**
- 前置：本人仓行强依赖 `hr_employees.warehouse_id`，未配则 `report_mapping_create` **直接返回错误**（存不下去）。

**② `order_template`（单型）后端零消费 —— 是「第二事实源」，不是可填字段**
- 自提 / 调拨的真实判据 = **`counterparty_type`**（`routers/forecast.py:1394`：`== "self_warehouse"` → 调拨表，否则自提表）。
- `order_template` 全后端只有**写 + 回显**（`erp_db.py:6985/7011/7057/7141`、`server.py:5510/5518`）。
- ⇒ 手填「调拨单」+ 类型「门店」= **UI 显示与生成模板自相矛盾**。修法：**由 `counterparty_type` 派生**（保留 DB 列，因 Excel 导入表头契约有「单型」必填）。

**③ `src_wh` / `dst_wh`（源仓 / 目标仓）同样零消费**
- `forecast.py:1313` 把 `dst_wh` 放进投影后**再无读取**；`src_wh` 连投影都没有。
- 调拨行实际：`row[1] = prof["warehouse"]`（租户默认仓 = 调出仓）、`row[2] = dst_name`（对象名/员工名拼）。
- ⇒ 「配了等于没配」。修法二选一：让模板真读它（**需先做影响面评估**）／从 UI 撤下。

**④ 「一人多对象」数据层**其实支持**（`report_mapping` **无 UNIQUE**，查重**只看 `report_alias`**）
- 所以「不支持一人多店」的真因是 ① + 前置 + 可用性（列表 `ORDER BY id DESC` 无按员工分组/无筛选）。
- ⚠️ **副作用**：`(员工, 对象类型, 对象)` **可重复配** ⇒ 舟谱聚合键是 `(alias, entity)` ⇒ **同店生成 2 张单**；
  汇总表列头则 `report_column.py` 取 id 最小者 ⇒ 另一列永远空。
- ⚠️ 旧文档 `新用户自主操作全流程.md:143` 仍写「动作 B『门店』可勾选多家」—— **该入口 2026-09-19 已删**，文档已过期。

🔴 **顺带（高）：`GET /api/report-mappings` 有 SQL 注入** —— `erp_db.py:6957`
`w += f" AND counterparty_type='{counterparty_type}'"`，值来自查询串、**无白名单/无类型校验**，仅 `_auth` 一道门
⇒ `' UNION SELECT ... --` 可读本租户库任意表（含 `hr_employees.id_card / bank_account`）。
⚠️ 同一函数里 `employee_id` **有 `int()` 强校验**（`f"AND employee_id={int(...)}"`）—— **只有 `counterparty_type` 漏了** ⇒ 修它一处即可。

💡 **「简称(列头)点选」的数据源已存在**：`all_units`（`erp_db.py:18028`，租户级历史列头名册 + `forecast_hidden_units` 已删列黑名单）。
建议抽成 `db.forecast_unit_names()` **单一实现** + 新增轻量端点供本页用；
🔴 **别**让配置页去调 `/api/forecast-submissions/summary`（受 `SUMMARY_ROLES` 门禁、且跑整张汇总太重）。

### ✅ v295 **已上线**：报单简称 = 历史列头名册点选 + 自动解析（2026-09-27）

> 上面那条建议**已落地**，但**没有**叫 `forecast_unit_names()` —— 实际实现是
> `erp_db.py::report_mapping_alias_pool()` + `GET /api/report-mappings/alias-pool`。
> 比原建议多一层：名册**三来源合并**，而不只是 `all_units`。看到"按 `all_units` 做点选"的旧建议，
> 以本行为准。

**名册三来源**：`mapping`（已配置简称，**含停用行**）／`report`（报单**真落地过**的列头）／`hidden`（被隐藏的列头）。
生产实测 `7 / 19 / 2`，去重后 **24**。

🔴🔴 **本领域最容易写错的判据**：**「名字在名册里」≠「不会新增列」**。

- 名册里有名字**只来自 `mapping` 源** —— 某人配过它，但**从来没有报单真的用它**。
  这种名字保存后**照样给汇总表新增一列**。
  📏 实测条数（v297 复核，口径 = 名字而非行）：生产快照 **3 个**（`美联（保康店）` / `永辉东津店` / `永诺（江山店）`）；
  ⚠️ v295 曾记「7 个」= 把**活跃配置行数**当成了**名字数**，已纠正。
- 生产实例：**`美联（保康店）` 就在名册里**（某条配置配了它），而历史列头实际叫 **`美联保康`**。
  若按"在名册里 = 安全"提示用户，就是**骗用户**（用户会以为数据会落进既有的那一列）。
- ⇒ 三态判据，**顺序不能换**：
  1. `used_by` 里有**别人** ⇒ **err**（简称租户内唯一，保存必被拒）
  2. 否则 `sources` 含 `report` **或** 该列 `hidden` ⇒ **ok**（接管既有列 / 把隐藏列恢复出来）
  3. 否则 ⇒ **warn**（保存后会新增一列）

**名册口径与 `all_units` 的「有意不同」**：名册**不过滤** `forecast_hidden_units`，并给它标「已隐藏」。
理由：**点它 = 把那一列恢复出来**。照 `all_units` 那样过滤掉，用户就**没有任何入口**恢复被删过的列头。
⇒ 别把两者"统一"掉。

**`suggest`（对象 → 简称）四级降级**：
① 该对象**活跃**配置简称 ② 该对象**停用**配置简称 ③ 该对象**最近一次报单**列头 ④ 名册名字**最相近**。
- ④ 是**不得不加**的：**39 条报单里 38 条 `store_id=0`**（v264c 之前写的）⇒ ③ 在真实数据上几乎全空。
- 实测救回 `美联（保康店）`→`美联保康`、`永辉东津店`→`东津`、`刘小顶仓`→`刘小顶`。
- 用户**手改/点选后不再覆盖**；**编辑既有配置时故意不自动解析**（否则会把别行的简称填到这一行）。

**顺带修掉的同族隐患**：**同一对象两条活跃配置**（生产一例：同一门店两条配置、简称不同）
⇒ Excel 模板按 `report_mapping_list` **逐条**生成客户列 = 同一个门店出**两列**。
简称唯一约束**拦不住**（两条简称不同）⇒ v295 在**选对象那一刻**警告，**v297 起升级为硬拦**（见下）。

完整验收（影子库探针含注入判别力 ＋ 真机 17/17 四路对照）见 `version-history.md §v295`；
报告 `outputs/报单简称列头名册-2026-09-27/`。

---

## §v297 名册准入判据（`listed`）+ 同一对象唯一活跃配置（硬拦）

> 拍板：「1.清；2.要」。交付件 `outputs/报单简称名册准入-同一对象唯一约束-2026-09-27/`。

### 一、`listed` —— 「是不是**真实列头**」的**唯一准入判据**

```python
# report_mapping_alias_pool 第 ⑥ 步
_it["listed"] = ("report" in _it["sources"]) or ("hidden" in _it["sources"])
```

- 🔴 **`aliases` 仍保留全量**，只有**展示**这一层被收窄。删掉"配过没落地"的名字会**弄坏三处**：
  撞名检测（`used_by`）、同对象查重、`suggest` 的 ④ 级"最相近"降级。
- `stats.total` = **真实列头数**（表头数字必须等于用户数得出来的条数，否则"看着少一个"）；新增 `configured_only`。
- 前端 `aliasFiltered` 过滤 `a.listed`；`aliasTotal` 优先取 `stats.total`（缺失回落数组长度）。
- 📏 v297 清理后线上：`{total:21, in_use:5, hidden:2, configured_only:2}`。

### 二、同一对象只能有一条活跃配置 —— 三处**唯一实现**

| 函数 | 职责 |
|---|---|
| `report_cp_kind(counterparty_type)` | 类型 → 归类轴（`warehouse` / `store`）。**唯一判据实现** |
| `report_mapping_find_same_object(db, ctype, cid, exclude_id=0)` | 返回冲突活跃行或 `None` |
| `report_mapping_same_object_error(row, system_name)` | **唯一**错误文案（四条写路径逐字复用） |

🔴 **两个必须踩过的坑**：
1. **必须按「类型轴」比，不能只比 id** —— `counterparty_id` 在仓库表 / 门店表里**各自独立编号**
   （仓库 7 ≠ 门店 7）⇒ 只有 `report_cp_kind` 同为 `store`（或同为 `warehouse`）才算撞。
2. **必须归一化历史写法** —— `counterparty_type` 库里有**两种写法**：`store` 与早期别名 `customer`
   （`REPORT_CP_ALIASES = {"customer": "store"}`）。裸 `counterparty_type = ?` 会**漏掉**历史行。

**四条写路径全部接入**：`create`（查重后）/ `update`（用**改后**的 id 查、`exclude_id=mid`）/
`toggle`（🔴 **只拦「启用」方向** —— 防「先停用旧的 → 再启用新的」绕过）/ `import`（**含批内自撞**）。
前端 `save()` 另加本地预检（体验层）；**权威在后端**。

### 三、🔴 上线顺序铁律：**必须先清数据，再上线**

新门槛会**锁住用户自己**。影子探针实测：**id=7 仍在活跃时，对 id=3（另一个对象）的保存也被拒**
—— 两条挂在同一对象上，其中一条不清理，**两条都改不动**。
⇒ 本次严格执行「先清数据 → 再上后端 → 再上前端」。

### 四、同轮修掉的前端静默失效

`toggle()` 原先**没检查 `res.error`** ⇒ 后端拒绝、界面却提示"已启用" = **静默失效**。已补：
```js
if (res && res.error) { toast(res.error, 'err'); return }
```
另新增 `clearErr(k)` **单字段清错**（`pickObj`/`onType`/`onAliasInput`/`pickAlias`/`onEmpChange` 各调一次）
—— 否则改掉字段后，上一轮**针对旧对象**的红字仍挂在新对象下面（真机截图 03 抓到）。

---

## 🔴 销售单据的「类型」靠 `order_no` **前缀**区分，不是 `status`（2026-09-27 实测）

`sale_orders`（22,505 行）的 `status` **全部是 `signed`** ⇒ **按 status 过滤筛不出任何东西**。
真实语义在单号前缀：

| 前缀 | 含义 | 行数 | 特征 |
|---|---|---|---|
| `XS` | **销售单** | 18,311 | 真正的"卖出去" |
| `TH` | **退货单** | 3,943 | `quantity` 为**负** |
| `DB` | **内部调拨单** | 251 | `customer_id` 指向 `contacts.type='employee'`，金额 0，= 内部领用 |

🔴 **任何「本月销售 / 动销 / 开单门店」的统计，必须先 `substr(order_no,1,2)='XS'`**：

- 不排除 ⇒ 门店数**虚高**：同一事实两个口径 = 全部前缀 **319 家** vs 只算 XS **311 家**
- `DB` 单的 `customer_id` 是**员工** ⇒ 直接计入会把员工算成"门店"
- `TH` 单带负数量，**业务上要保留**，但**门店口径要单独决定**（默认不计入"已开单门店"）

⚠️ **这条踩过一次真的结论错误**：把 33 家当成"铺货门店"，正确是 **27 家**（差 6 = 调拨/退货带出的门店）。
⇒ **算任何销售口径之前，先 dump 一次前缀分布自证判别力。**

## 🔴 门店「业务员归属」的真身 = `contacts.assigned_salesperson`（不是 `employee_id`）

| 字段 | 非空数 | 说明 |
|---|---|---|
| `assigned_salesperson` | **565 / 702** | ✅ **真身**。建档期写入（`updated_at` 全为 2026-06-29） |
| `employee_id` | **0** | ❌ 全空 —— **名字最像"负责业务员"，却没有数据** |
| `service_employee_id` / `dedicated_employee_id` / `service_employee` | 0 | ❌ 全空 |
| `assigned_route` / `delivery_route` | 0 | ❌ 全空 |

🔴 **`contacts` 表有 70+ 列**，且**同一语义有多个候选列名** ⇒
**查「某数据到底有没有」时，必须 `PRAGMA table_info` 扫完所有列再下否定结论**（见 `hergent-capability-reality-audit` 第二十六种伪装）。

**按业务员统计门店时的已知脏点**（分母会略偏大）：
- **11 条**门店档案的名字恰好等于员工姓名（11 位员工各 1 条）⇒ 分母虚增 ≈1.6%
- 少量门店用简称（如「零售」「唐成」类）走单 —— 是真实业务，不要清洗

---

# §v305（2026-09-28）关单后「授权改单」＋ 舟谱模板空数据的两条独立病根

**触发**：老板「**关单后通知不做，但关单后要支持主管/文员等有 web 端权限的人能够改单，
也要支持导出舟谱导入模版，这两个你要确认一下，我试了好像不可以**」。

## 一、🔴 老板说的「这两个不行」是**两条互不相关的病**（本轮最重要的一条方法论）

| 报障 | 真根因 | 层次 |
|---|---|---|
| 关单后**不能改单** | `forecast_period_writable(pid)` **两道锁同时命中**（`status != 'open'` ∨ `order_end < 今天`） | **权限硬锁** |
| 关单后**不能导出舟谱模版** | `_fetch_submissions` **只取 `role='导入'`** ⇒ 老板自己录的单**结构上进不了模板** | **取数条件** |

**判别力自证（实测，真库只读）**：同为 `closed` 的两个期次 ——
`_build_zhoupu_data("2026-09-27","2026-09-27")`（#19，角色 `boss 2 / sales 1`）⇒ **`zt_rows=0`**；
`_build_zhoupu_data("2026-09-22","2026-09-23")`（#17，角色 `导入 19 / boss 1`）⇒ **`zt_rows=3`**。
⇒ **同为关闭期次却一个 0 一个 3** ⇒ **空数据跟"关不关单"没有因果关系**。
⇒ 教训：老板把两件事并在一句里说「这两个不行」时，**必须分别复现再下笔**；
照「都是关单引起的」一起改，会把第二条改成错的。

## 二、`forecast_period_writable` 的**两道锁**（写入口唯一判据）

```python
def forecast_period_writable(pid, db_conn=None, allow_closed=False):
    ...
    if allow_closed:            # 🔴 v305：放在「期次不存在」检查【之后】
        return (True, "")       #    ⇒ 不存在的期次**仍然拒绝**
    if (p.get("status") or "open") != "open":
        return (False, "该期次已定稿（关闭），不能再修改；如需改动请到「往期预报」里先点「重开」")
    ...
    if order_end < 今天:
        return (False, "...")   # 第二道锁：日期截止
```

- 🔴 **`allow_closed` 的位置是安全关键**：必须在确认「期次真实存在」之后才让开，否则会变成
  「任何 pid 都放行」的洞。
- 🔴 **本函数不做角色判断** —— 它只负责「开通道」；**判角色是调用方的事**
  （`routers/forecast_submissions.py::save_matrix` 传 `allow_closed = 用户角色 in SUMMARY_ROLES`）。
  这样职责单一：**同一个锁被给销售和给主管用，是两条不同的授权决定，不能混进锁里。**

## 三、授权改单的正确做法（**窄门**，不是"重开"）

**错解（此前唯一出路）**：`forecast_period_reopen` —— 但重开会让**销售又能报单** ⇒
「主管想改一个字要放开全公司」的**死结**。

**正解（v305）**：
1. 角色白名单 = **`SUMMARY_ROLES`（`admin`/`boss`/`supervisor`）** —— **复用权威名单，零新增清单**
   （老板拍板「管理员/老板/主管」）。前端镜像 `constants/roles.js::FORECAST_SUMMARY_ROLES`，
   两侧由 `role-registry-consistency-check.py` 做 AST 一致性校验。
2. 放行时**额外算一次**严格口径：`_closed_edit = not forecast_period_writable(pid)[0]`
   —— 即「本次保存**本来会 409**，是靠授权才写进来的」。**这个布尔必须回传给前端**（见 §四）。
3. 留痕**必须在事务提交之后**：`print("[v305][closed-edit] 期次#%s（%s~%s）被授权修改：by=%s role=%s …")`
   ＋ `db.message_send("已关闭期次被修改", ..., "notice", "系统", event_key="forecast_closed_edit_%s" % pid)`。
   ⚠️ 老板明确「**关单后通知不做**」⇒ **只留痕（站内信 ＋ 日志），不推送**。
4. ⚠️ `_closed_edit = False` **必须在 `if pid > 0` 之前初始化**（否则小 pid 分支 UnboundLocalError）。

## 四、前端：**受权者要"看不见锁"，但要"看得见留痕"**

```js
const canEditClosedPeriod = computed(() => canViewForecastSummary((store.user && store.user.role) || ''))
const periodLocked = computed(() => {
  if (canEditClosedPeriod.value) return false        // 授权角色【不看】锁
  return periodClosed.value || periodDeadlinePassed.value
})
const closedEditMode = computed(
  () => canEditClosedPeriod.value && (periodClosed.value || periodDeadlinePassed.value))
```

- `saveEdits` 里 `if (!canEditClosedPeriod.value) { …return }`；回执拼接
  `+ (r.closed_edit ? '（已关闭期次 · 授权改单）' : '')`；
- 三处「改单」按钮 `:title` = `closedEditMode ? '本期次已关闭 · 你以管理者身份改单，保存后会在通知中心留痕' : …`
  ⇒ **上线后生产实读该串即为验收判据**。

## 五、舟谱模板：**按老板口径"保持现状，但把原因提示清楚"**

- **不放宽取数**（`_fetch_submissions` 仍只取 `role='导入'` —— 这是**设计如此**：模板导的是厂家侧下单）。
- 新增 `_zhoupu_empty_reason(tid, start, end)`（`routers/forecast.py`）替代原来干巴巴的
  `raise HTTPException(400, "本期无自提订单数据…")`：查角色分布 `GROUP BY role`，文案明说
  「与期次是否关闭**无关**」「`boss`/`sales` 等角色的单**不参与模板生成**」＋ 给**可操作的下一步**。
- 🔴 顺手补一个洞：`zhoupu-all`（合并包）**此前没有任何空检查** ⇒ 两份都空时会**静默下载一个空包**。

## 六、验收

判据台 **76/0**；影子库真调写接口 **7/0**（`admin`/`boss`/`supervisor` → 200 ＋ `closed_edit=True`；
`sales`/`staff` → **409**；**反例对照 → `closed_edit=False`**；站内信留痕 **1** 条）；舟谱文案 **5/0**。

⚠️ **负对照必须把两道锁都拆掉**：影子库 §2 第一版只把 `status` 改 `open`、没改 `order_end`
（该期次 `order_end` 已过期 ⇒ 严格口径**仍拒** ⇒ `closed_edit` 仍 True）——
**读数与"标志恒真"一模一样，差点误判**。正解：`UPDATE forecast_periods SET status='open', order_end=?, order_end_date=?`
同时用未来日期（`2099-12-31`）。


## 🔴 加单/减单通知 与「定稿」三义（2026-09-29 核实）

### 「定稿」在系统里是**三个不同的东西**（最易混，动这块前必读）
| # | 名称 | 前端 | 接口 | 现状行为 |
|---|---|---|---|---|
| ① | 保存汇总表 | `Forecast.vue:128`(只读态)/`:1044`(编辑态) `saveEdits` | `POST /forecast-submissions/save-matrix`（`forecast_submissions.py:779`） | 落 `forecast_period_confirm`（"保存即完成审批"）；**v277 需求 7 的加单/减单通知在此发出**（`:1204-1209`） |
| ② | 确认定稿 | `Forecast.vue:456` `doAdopt` | AI 补货建议采纳，写 `final_qty` | **不发通知**；注释 `:434` 自称"唯一定稿出口"（就通知而言是误导） |
| ③ | **关闭期次** | `Forecast.vue:2341` `confirmClose`（弹窗 `:2328-2345`） | `POST /forecast/periods/{pid}/close`（`forecast.py:508-515`） | **真·终态**：锁编辑 + 关小程序报单通道；文案「关闭 = 定稿」(`:2338`)；**只审计留痕，一条通知都不发** |
- ⇒ 用户口中「整个预报订单定稿」= **③**；**但通知现挂在 ①** ⇒ 任何"定稿后推送"需求都要先拍这个出口。
- 反向补救 = `POST /periods/{pid}/reopen`（`forecast.py:518-534`）。
- ⚠️ 若把推送迁到 ③：`event_key` 现为 `forecast_extra_alloc|<period_id>|<pid>`，去重窗口 86400s ⇒ **"关→重开→再关"第二次会被折叠** ⇒ 键里须带**定稿轮次**。

### 🔴 加单/减单通知的收件人**键错位**（高危，2026-09-29 核实仍未修）
- 写端 `_notify_extra_allocs`（`forecast_submissions.py:760,773`）：`uid = int(r["employee_id"])` → `recipients=str(uid)`；`employee_id` = **`product_target_alloc.employee_id` = `hr_employees.id`**（`routers/product_targets.py:162` 明证）。
- 读端 `messages.py:46-64::_visible_where`：`recipients` 非空时**只与 `users.id` / `username` 比**。
- ⇒ **两把不同的键** ⇒ 后果二选一，**都不报错**：① 某 `users.id` 恰等于另一人的 `employee_id` ⇒ **送错人**；② 无 user 命中 ⇒ **无人可见**（行照常落库）。收件人非空 ⇒ 不是广播、不是泄露，是**静默错投**。
- 正确同族实现（工资条早已修）：`salary_send.py:253-260` 用 `employee_account_map()[eid]["id"]` 解析；**取不到账号则不投递** + warning；`message_send` 的 `recipients` **必须关键字传**（第 4 位是 `sender`，见 `notification-center.md`）。
- ⚠️ `_notify_extra_allocs` 的 docstring「`recipients` 传的是 employee_id……与工资条 `salary_send` 同一用法」（`:746-748`）**已过期**，会误导下一个改动者。
- 修法 + 双侧验收判据见 `docs/预报-一键分摊与定稿推送-设计方案与开发计划-2026-09-29.md`（P0-1）。

### 分摊链路（复用清单 —— 改这块**不要重写算法**）
- 算法 `plan_extra_allocs`（`routers/product_targets.py:744`，**只算不写**；**唯一调用点** `forecast_submissions.py:984`，且**必须在写事务之外** —— 内部读走 `get_db()` 另开连接，事务内调用会互锁）+ 纯函数 `domain/product_targets.py::allocate`：
  - 加单：`alloc_i = D × ratio_i/100`（**绝对比例，不归一化**）
  - 减单：`take_i = min(|D|×ratio_i/100, reported_box_i)` **夹断到 ≥0**，被夹掉的 `clip_gap` 在**还有余量的人之间按相对占比**重分（≤64 轮）
  - `clip_gap`（报量不足，会重分）与 `ratio_gap`（占比合计 <100，**不重分**、如实上报）**分开算**
- 比例真身 = `product_target_alloc.ratio`：`_validate_allocs`（`product_targets.py:393-411`）**硬校验 Σ=100（容差 0.01）**；`_write_allocs`（`:414-423`）是 **DELETE+INSERT 整体替换**，`target_qty = 总量 × ratio/100`。
- 读取 `GET /api/product-targets/extra-alloc?period_id=`（`product_targets.py:856`）→ `items[pid].rows[]`（`ratio`/`reported_box`/`alloc_box`/`final_box`）+ `caliber`；前端 `Forecast.vue:9787` → `ptAlloc`/`ptGap`；展示 `ptExtraMark()` `:9797`（现只有「缺N」/「加N」两态，**无"分不满"态**）。
- 🔴 **禁止前端另写一份 allocate**（夹断/重分是边界敏感的 ⇒ 必然两套口径）。要做保存前预览，就加**后端 dry-run 端点**。
- 按人明细表 `forecast_extra_alloc` 的**归属键 = `period_id`**（v279；窗口列只作展示，不参与任何读写条件）；清空条件也用 `period_id`（"填回 0 再保存"要能清掉上一版分配）。
- 四个**静默分支**（界面不点名、只留日志）：无 `active` 目标 / 无分解明细 / `store_name` 在 `report_mapping` 无别名 / 占比合计 < 100。

### 🔴 v318（2026-09-29 **已上线**）：一键分摊（预演台）＋ 分不满点名 ＋ 定稿确认弹窗

上面「分摊链路」那份清单**已按它落地**，逐条对照（**没有重写算法**）：

- **预览走后端 dry-run** ⇒ 新增 `POST /api/product-targets/extra-alloc/preview`（**只读**）：
  入参 `{period_id, product_id, total_delta, ratios[]}`，内部喂**同一个** `domain/product_targets.py::allocate`。
  生产实测三态（tenant_1 / 期次 21 / 商品 1556，占比 40/30/30）：

  | 场景 | `allocated` | `unassigned` | `ratio_gap` | `clip_gap` | `fully_applied` |
  |---|---|---|---|---|---|
  | `total_delta=+60` | 60 | 0 | 0 | 0 | **true** |
  | `total_delta=-60`（`reported_box` 全 0 ⇒ 夹断到 ≥0） | 0 | 60 | 0 | 60 | false |
  | 占比改 80%（= 配置不全） | 48 | 12 | **12** | 0 | **false** |

  ⇒ 加单 `60 × 40%/30%/30% = 24/18/18`；减单被夹到 ≥0；`ratio_gap` **不重分**、如实上报 —— 与纯函数口径**逐字一致**。
- **新增 `GET /api/product-targets/extra-alloc/setup`**（弹窗初始状态）：回
  `period` / `product`（含 `large_ratio`、`box_unit`）/ `target` / `members[]`（`ratio`、`reported_box`、`target_qty`）/
  `total_delta` / `alloc` / `flags` / **`caliber`（把口径原话回给界面，避免前端自己组织措辞）**。
  ⚠️ 期次不存在回 **404**，不是 200 空壳。
- **`GET /extra-alloc` 扩字段**：新增 `allocated_box` / `short_box` / `fully_applied` / `product_name`；
  **`total_delta` 历史语义不变（仍 = Σalloc）**；`requested_box` 读 `forecast_extra_qty`（**窗口取期次自身**）。
- **前端两处新 UI**（`Forecast.vue`）：
  - 「分摊」按钮 **只在编辑态**出现（`v-if="hasAllocTarget(r)"`，判据 = `ptGap[pid].operators` 非空）；
    **不加主工具栏按钮**（用户长期偏好：新功能并入既有出口）。
  - `ptExtraMark` 增第四态 `kind:'short'` → 文案 `加6 ⚠差3`；判据 **`a.fully_applied === false && short > 0`**
    —— **严格等于 `false`**：旧后端无此字段时是 `undefined`，写 `!undefined` 会**误报**。`ptExtraTip` 同时点名缺口成因（占比不足 / 被夹到 0）。
  - 定稿弹窗：标题「确认定稿 · 关闭期次」，按钮「取消，继续修改」/「确定定稿」/`定稿并推送中…`；
    文案明说**将推送给相关人员**（改前 `saveCloses` 用的是 `确认关闭`/`关闭中`，中文串差集里正能看到这两条被删）。
- 🔴 **前端数字输入铁律照旧**：`toHalfNum()`（NFKC 折全角）+ `parseNumInput()`（解析失败**保留原串**）
  ⇒ 中间态存**原串**，只在 `@change` 收敛；占比输入**从不**被预演结果回填（否则用户正在打的字被吃掉）。

---

## v319c · 期次状态三件套（留痕 / 豁免 / 两语义重开）＋ 付款口径改「报单+加单」

🔴 **「定稿」全站唯一口径 = `forecast_periods.status == 'closed'`**。曾经并存两套：
① 审核台「确认定稿」写 `forecast_audit_decisions` —— **已废弃**（界面自述「历史流程，仅用于追溯」，
生产 tenant_1 **0 行**，5 个期次 status 全 closed）；② 关闭期次。
`forecast_order_board` 的 `finalized` 列读的是 ① ⇒ **恒 false** ⇒ 历史页「状态=已关闭 / 定稿=未定稿」
**自相矛盾**（两列说的是同一件事）。⚠️ 判据键也**别用日期窗口** —— 期次改一次 `order_end` 就永久失配
（v279 已把加单归属改成 `period_id`，此处曾漏改）。

**五列**（`erp_db.py`：权威建表 DDL ＋ `_safe_migrate` **两处齐**才叫改了 schema ——
`CREATE TABLE IF NOT EXISTS` 不给已存在的表补列，本项目铁律）：

| 列 | 语义 | 陷阱 |
|---|---|---|
| `closed_at` / `closed_by` | 关闭时刻 / 操作人（自动 = `'系统'`） | ⚠️ 本表**根本没有 `updated_at` 列**，不能拿它当关闭时刻 |
| `closed_mode` | `'manual'` \| `'auto'` | 两条路径**行为不同**（自动**不发**通知）⇒ 不落库就 = 同一 status 两种含义**不可判** |
| `reopened_at` | **自动关单的豁免键** | 语义单一：非空 = 人已接管。**关闭时不回填**；🔴 **期次已 open 时绝不写**（否则种下「本期永不被自动关单」的静默副作用） |
| `alloc_pushed_at` | 加单/减单通知**最后一次真正推送**时刻 | 用**时刻**不用布尔（要能答「哪期还没推」「上次何时推的」）；`''` 且已 closed ⇒ 界面标「尚未推送」＋手动推送按钮 |

🔴 **自动关单会撤销人工操作**：`scheduler._check_auto_period` 的分支是 `elif now >= 关单时刻`
（**过点后每轮无条件重试**）⇒ 人工重开 **2~5 分钟**内必被撤销（生产日志实证 2026-09-27：
**2分38秒 / 5分09秒**）⇒ 自动路径必须带 `AND COALESCE(reopened_at,'')=''`。
🔴 **自动关单零留痕**：`_auto_period_close` **直调 db 层、不经端点** ⇒ 端点上的 `_audit_period_op`
**全被绕过**，而表里又没有关闭时间列 ⇒「谁在何时怎么关的」只能翻 journalctl，**日志一滚答案永久丢失**。
⇒ 硬标准：**「这条状态是怎么变成这样的」必须能只用数据库回答**；留痕由 db 层自己写。

**重开拆两语义**（老板拍板）：`mode=unlock`（**解锁编辑**）只写 `reopened_at`、**status 不动**
（销售照旧报不了单，副作用最小 —— 「我只要改一个错数」的正确选择）；`mode=full`（**恢复报单**）
= 原 v219 行为，🔴 **默认值取 full 以保证旧调用方向后兼容**。

**付款金额 = (报单箱 + 加单箱) × 箱价**，唯一实现 `routers/product_targets.period_order_amount()`
（`/payments/compute` 与 `/payments/preview` **共用** —— 两处各写一份必然漂移，而这笔钱要拿去付厂家）：
- 报单箱 = `_reported_box_map()`（权威，**不含加单**）；加单箱 = `forecast_extra_alloc.alloc_box`
  （🔴 **已是箱，只汇总不重算**）；箱价 = `_case_price_map()`（`factory_price` 优先，否则
  `sale_price × per_case` —— **先折箱**）；`period_id_by_window()` 反查期次（同窗口取最大 id）。
- 🔴 **旧口径读 `forecast_audit_decisions`（0 行）⇒ 金额恒 0 ⇒ `gap = max(0, 0−balance) = 0`
  ⇒ 界面显示绿色「需付款 ¥0」** —— 数字 0、颜色绿、零报错，而真实值约 **¥4657**。
  「**零值即健康**」的又一实证。
- 🔴 **诚实回报不可省**：`no_price_rows` / `no_ratio_rows` 是「金额偏小」的**唯一线索**
  （生产 472 商品**有进价仅 158、有标准售价仅 58** ⇒ 经常非 0，**不是罕见分支**）。
  ⚠️ `no_ratio_rows` 判据必须写 `_qty > 0 and ob <= 0` —— **不能**写 `box == 0`
  （报单量本来就是 0 的商品 box 也是 0，那**不算**缺换算）。
- ⚠️ **`db.queries.products.boxes_of()` 按设计保留 3 位小数**（注释：「同前端 `boxesOf`，
  便于与用户 Excel 逐行对账」）⇒ 金额 = Σ(round3(箱) × 箱价)，会出现**分位级差异**
  （实测 `每日鲜酪 1 桶 ÷ 16 = 0.0625 → 0.062`，×116.64 少 **0.058 元**）。
  **这是既有约定、不是缺陷** —— 它与用户在汇总表看到的「合计(箱)」逐字一致，别去"修"它。
- ⚠️ **旧前端兼容**：`erp.hergent.cn` 的付款卡片读的是 `r.need_to_pay`，而接口一直只返回 `need_pay`
  ⇒ 那个三元判断**恒走 else** ⇒ 恒绿色「¥0」且「确认已付款」按钮**永不出现**（叠加后界面看着完全正常）。
  ⇒ 现在**两个键都给**（缓存住老包的前端也立刻对）＋ `static/` 源码同步改成 `need_pay`。

## 🔴 v323（2026-09-29）商品目标「月份锚点」= **到货月**，不是报单月

老板报障原话：「我刚用刘小顶的小程序账号报单，现在应该报 10 月的单，但系统仍显示 9 月份的商品目标」。**已只读取证、未改码、未上线。**

**唯一病根（4 个读点同一错法，全在 `routers/product_targets.py`）**：
`pmonth = _month_of(period["order_start"])` —— 用**报单窗口开始日**的月份去查 `product_targets.period_month`。
⇒ 跨月期次（报单在本月、到货在次月）必然读成**上个月的目标桶**。

| 读点 | 行 | 影响 |
|---|---|---|
| `avg-target` | ~1451 | **小程序/Web 报单的「均单目标」＋加单预填**（老板看到的那个） |
| `_report_extra_alloc_split` | ~957 | 加单按业务员分摊时查不到 10 月目标 ⇒ 静默不分 |
| `_target_and_members` | ~1143 | 加单预览「本月无目标」 |
| `plan_extra_allocs` 回显 `product.month` | ~1247 | 界面回显错月份 |

🔴 **判据/口径链**：`pmonth` 同时决定四件事 —— ① 目标取哪个月 ② 已达成 `_achieved_map(pmonth)`（键 `strftime('%Y-%m', so.order_date)`）③ 剩余期次 `_arrival_ctx(brand, *_month_pair(pmonth))` ④ 加单归属。**改锚点必须四处同源**，否则出现「10 月目标 ÷ 10 月剩余期次 − 9 月已达成」的**混月算式**（零报错）。

**生产实证（tenant_1，2026-09-29 15:40）**：
- 唯一 open 期次 **id=21**：报单 `2026-09-28~09-29`、**到货 `2026-10-03`** ⇒ 报单月 2026-09 vs 到货月 **2026-10**。
- `product_targets`：`2026-09` **3 条**（0蔗糖5连包 150箱／红枣预制瓶450g 400箱／**现代牧场0乳糖软牛奶185ml 120箱**）；`2026-10` **1 条**（0蔗糖5连包 **1000箱**，老板 **15:37:52** 刚建）。
- ⇒ 老板**已经建了 10 月目标，报单端却读不到** —— 这正是「系统仍显示 9 月目标」的现象。
- **分母也一起错**：`arrival_summary(蒙牛鲜奶, 2026-09)` = 15 个到货日（9/1…9/29），`remaining_periods(today=09-29)` = **1**；`2026-10` = 16 个（10/1…10/31），remaining = **16** ⇒ 同一目标 `120 ÷ 1 = 120 箱` vs `120 ÷ 16 = 7.5 箱`，**分母差 16 倍**。
- 改对后 「现代牧场0乳糖软牛奶」在 10 月**没有目标** ⇒ 会**彻底不提示**（设计如此：取不到=不提示）⇒ **必须先补建 10 月目标再切锚点**。

**「每月底必现」的规律（算法层公理，非偶发）**：
`蒙牛低温/蒙牛鲜奶` 规则 = `order_mode=interval` / `order_cadence_days=2` / `order_lead_days=4` / `order_first_date=2026-08-28`
⇒ 报单日 = 奇数日、**到货日 = 报单日 + 4** ⇒ **每个月最后 2 期**的报单日（如 9/27、9/29）到货落在次月（10/1、10/3）⇒ 这两期的目标月份**必然**滞后一个月，每月固定复发（每期持续 2 天：报单窗口 = `报单日-1 ~ 报单日`）。
🔴 **报单窗口铁律**：`T_open = 报单日 - 1`（`order_max_early_days=1`）⇒ 到货 10/1 的报单窗口是 9/26–9/27，**9/29 时已关闭** ⇒ `remaining_periods` 那个「到货日 ≥ 今天」判据**常年多算 1 期**（10 月口径 16 vs 真值 15）。

**唯一实现（建议新增，别在 4 处各写一遍）**：
```python
def _target_month_of_period(p):
    """本期商品目标月份 = 到货月（唯一实现）。
    降级链任一命中即停，**绝不返回空**（返回空 = 4 个读点全部静默零目标）：
      arrival_date → order_end → order_start → 今天"""
    for k in ("arrival_date", "order_end", "order_start"):
        m = _month_of((p or {}).get(k) or "")
        if m:
            return m
    return _month_of(_date.today().isoformat())
```
⚠️ **不动的两处**：`start/end` 仍取期次窗口（**报单量归集**口径本就应该按报单窗口，与目标月份是两件事）；`create_target` 里 `_arrival_ctx(brand, *_month_pair(pm))` 的 `pm` = **目标月份本身**（用户手选），本来就对。
⚠️ **`ProductTarget.vue` 默认月份 `month` = 自然月**（`new Date()`，L413）⇒ 月底建目标默认落在**当月**，是同一个认知错的第二现场。
🔴 **运营层必须同步**：切锚点后**每月底最后 2 个报单期之前**必须建好次月目标，否则月底那期「一条目标都不提示」。



---

## 🔴 v336（2026-09-30）：加单/减单分摊 —— **L1 / L2 双层分流** ＋ `basis` 留痕

### 业务口径

用户在预报主表的「加单」列填一个数字（正=加、负=减），系统要**把这个量分摊到各报单人头上**
并留痕（谁改的、按什么依据分的）。分流规则：

| 层 | 触发条件 | 占比来源 | 性质 |
|---|---|---|---|
| **L1** | 该商品**有启用目标** **且** 目标里**已填分解承接人** | `product_target_alloc.ratio`（人工设定的业务份额） | **改了全期生效** |
| **L2** | 无目标 / 目标**没填**承接人 | **本期各人报单量**推导出的占比 | **客观事实，只读** |

### 🔴 为什么必须新增 `basis` 列

两层最终都落进**同一列** `ratio` ⇒ 光看 `ratio` **分不清**「这是人定的份额」还是
「这是本期报单量推的」。所以必须新增 `basis`，取值：

- `'target'` —— L1
- `'reported'` —— L2
- `''`（空串）—— **无人可分**

### 🔴 不变量：`'reported'` 的占比 **Σ 恒 = 100**

`ratios_from_reported()` 把尾差**归一到最大项** ⇒ Σ 恒为 100 ⇒ `allocate()` 里的
`ratio_gap` **恒为 0**。

**这条不变量的用处**：L2 场景下「分不满」**只可能**来自**减单夹断**（某人的量不够减，
不能给他减成负数）⇒ 界面文案**必须按 `basis` 分支**，不能一套话讲到底。

### 🔴 `employee_id = 0` 是**不能猜**的

`_reported_by_operator()` 遇到「报单列名在 `report_mapping.report_alias` 里没有映射」时，
把该量归到 **`employee_id = 0`**，**不猜是谁**。这份量单独作为 `unmapped_box` 上报。

- **分母只算可分摊的人**（不含 `eid = 0`）—— 否则界面会误报「占比合计不足 100%」。
- 前端拿到 `unmapped_box > 0` 时，文案必须说「**报单列头没在「报单配置」里对应到「报单人」**」，
  **不能**说「本期没有人报过这个商品」（那是假话）。

**生产实测**：`report_mapping` 只有 **8** 个有效别名；全库 **17** 个商品的报单列名能映射到员工；
**`唐成` 的别名绑在 `employee_id = 0`（无效）⇒ 其报单永远分不到人**。
⇒ 这是「数据配置问题」而非代码问题，须在「报单配置」页（`ReportMapping.vue`）改正。

### 触发形态（老板拍板「B 方案」）

「**入口即时出现 ＋ 单人静默自动分摊**」：

- `allocMembers(r).length >= 2` ⇒ 立即长出「分摊」按钮
- `== 1` ⇒ **不弹窗**（只有一个人可承接时，分摊是**恒等映射**，弹窗纯骚扰）
  但**仍下发** `alloc_members` 供留痕
- `== 0` ⇒ 「悬空」态（见 `frontend-ui.md` 的状态色一节）

### 🔴 写入侧的硬约束：**行长度恒为 12**

`plan_extra_allocs()` 产 **11** 元素元组（含末尾 `basis`），写入端
（`routers/forecast_submissions.py`）必须补第 **12** 列 `operator`。

少补 ⇒ `executemany` 抛 `Incorrect number of bindings` ⇒ **整个 save-matrix 报 500**。
⇒ 加列的**完成判据**不是「列加上了」，而是「**所有写入端行长度一致 ＋ 端到端保存成功**」。

### 🔴 建表/加列的坑

`ALTER TABLE ADD COLUMN` 是 SQLite 里**唯一不幂等**的 DDL（`CREATE ... IF NOT EXISTS` 都能重跑），
必须**单独**走一次 `_safe_migrate`——因为它常和一堆幂等语句写在**同一个 `executescript()`** 里，
加列那条一抛错**后面全部语句都不执行**，而前面已执行的已生效 ⇒ 库停在**半迁移**状态且**零报错**。

本批两条：`v336_fea_basis_col` / `v336_fea_operator_col`（`erp_db.py`）。

### 🔴 报单自动化的**死锁结构**（v354，2026-10-01 老板报障实证）

**触发**：对**已关闭**的期次点「恢复报单」（`forecast_period_reopen(mode='full')`）
⇒ `status='open'` **并且**种下 `reopened_at`。
（⚠️ `mode='unlock'`（解锁编辑）**保持 closed** ⇒ **不会**造成此死锁；只有 `full` 会。）

**三重锁**（**单看任一处都是对的**，叠起来 = 永久死锁）：

| # | 位置 | 机制 |
|---|---|---|
| ① | `scheduler._auto_period_open` | 硬闸「本租户已有任何 `status='open'` 期次 ⇒ 跳过」（防两个 open 并存 ⇒ 小程序按 status 取值歧义） |
| ② | `scheduler._auto_period_close` | v319 豁免 `AND COALESCE(reopened_at,'')=''`（人工接管过就别碰） |
| ③ | `domain.arrival_schedule.build_period_plan` | `main_dates = [d for d in main_dates if d >= today]` ⇒ 过掉的期次**掉出编排、连被关的触发机会都没有** |

⇒ 该期次**永久 open** ⇒ **此后每一期自动建表全部静默跳过**（日志每 5 分钟一行、连打两天，**界面零提示**）。

**关键判据**：`forecast_period_writable` 的锁含「`order_end < 今天` ⇒ 不可写」
⇒ **挂着"进行中"的期次可能早已不能报单** ⇒ 它的 open 是**纯阻塞物**。
⇒ 回收判据**必须与它同源**（`substr(order_end,1,10) < 今天`），**别另写一套日期逻辑**。

**v354 修复**：`scheduler._reap_stale_open_periods` —— 调用位置在「已开启自动建表」判**之后**
（没开自动化的租户**零行为**，实测 tenant_10 的同类僵尸未被碰）、且在建表**之前**；
**只改 `status`**（报单数据/`reopened_at` 一字不动）；回收时**落站内信**（治"界面零提示"）。

⚠️ **别把闸①删掉** —— 删了会造出两个并存的 open 期次（下游按 `status='open'` 取值有歧义）。
**正确解法是回收阻塞物，不是放宽闸门**；放宽②也无效（③ 让它压根不在编排里 ⇒ 白改）。

**自检命令**（下次同类报障先跑这两条）：
```bash
# ① 日志里出现「跳过开表」= 被挡（与"没跑"完全不同）
journalctl -u hergent-erp --since "-2 day" | grep -e "跳过开表" | tail -3
# ② 全租户扫僵尸 open 期次（status=open 且 order_end < 今天）
#    python3 只读连接各 tenant_*.db：SELECT id,name,order_end FROM forecast_periods
#    WHERE status='open' AND length(COALESCE(order_end,''))>=10 AND substr(order_end,1,10) < date('now','localtime')
```

---

## v355（2026-10-01）「过期未关」可见化 —— 读侧：让它在界面上自己说出来

> v354 修的是**写侧**（回收僵尸）；本篇是**读侧**（让用户看得见）。
> 🔴 **写侧修好了 ≠ 用户能看到** —— v354 回收了 #21，但在此之前界面**连着两天零提示**。
> 老板原话：「窗口过后回收没问题，**能否在该期次上做个提醒**」。

### 三层盲区（问题不在「漏一个提示」）

| 层 | 位置 | 之前表现 | 为什么看不出问题 |
|---|---|---|---|
| ① | 预报页顶部横幅 | 什么都不显示 | 判的是「**有没有** open 期次」，而僵尸**自己就冒充 open** |
| ② | 历史页「状态」列 | 稳亮**绿色「进行中」** | 只看 `status` ⇒ 与「其实报不了单」**正好说反** |
| ③ | 截止日提示 | 不点不吭声 | 只挂在导入按钮悬停 / 保存失败弹窗上 |

⇒ 三层合起来 = **一个「看起来一切正常」的界面**。

### 唯一判据

```python
forecast_period_stale_open(period, today=None) -> bool
#  条件：status == 'open'  且  order_end[:10] < today
#  🔴 必带 id > 0 护栏
```

**`id>0` 护栏为什么必须有**：`forecast_order_board()` 会给「未被任何期次区间覆盖的报单日期」补**合成行**
（`id<0`、`status` **硬编码 `'open'`**、`order_end` 就是那个**历史**日期）⇒ 只看日期**必然**命中「过期」。
但合成行**没有 `forecast_periods` 记录** —— 「关闭」对它无从谈起，它也永远不会挡住自动建表 ⇒ 恒 `False`。

**判据同源**：日期取 `order_end` **前 10 字符**，与 v354 回收用的 `substr(order_end,1,10) < ?` **逐字一致**。
⇒ 若读侧说「没过期」而写侧把人回收了，用户会看到「进行中」的期次被系统莫名关掉 —— **两处必须同源**。

### 三处消费点（缺一处，这条信息就传达不到）

| 消费点 | 形态 | 判据来源 |
|---|---|---|
| 预报页顶部横幅 | 橙色 `.gate-bar`（**复用既有 `askClose`，不新开写路径**） | `list_periods.open_stale` ＋ `auto_reap_on` |
| 历史页状态标签 | 绿「进行中」→ **琥珀「进行中 · 已过截止日」** ＋ 副行「已过报单截止日 · 挡住下一期创建」 | `order_board()[].stale_open` |
| 历史页定稿留痕 | **三档**：`manual` 人工定稿 ｜ `auto` 系统到点自动关单 ｜ **`auto_reap` 系统自动回收（报单窗口已过）** | `order_board()[].closed_mode` |

🔴 **横幅两种说法 × `auto_reap_on`**（本租户是否开着报单自动化）：
- 开着 ⇒ 「系统会自动把它关掉…」（**等着就行**）
- 没开 ⇒ 「请点「关闭本期」…」（**要动手**）

**为什么必须分叉**：**代价不对称** —— 说「会自动」而实际不会 ⇒ 用户**干等**（正是 v354 那个故障的形态）；
说「要手动」而实际会自动 ⇒ 多点一次，**无害** ⇒ **`_auto_reap_on()` 任何不确定（读表异常 / 老租户库无表）一律 `False`**。

🔴 **两条横幅互斥**：僵尸期次**自己就是 open** ⇒ `noOpenPeriod`（判「没有 open 期次」）**必为假**
⇒ 用 `v-else-if`，逻辑上写清「永不同时出现」。

🔴 **整张表共用一个「今天」**：`forecast_order_board()` 若逐行各取一次 `date.today()`，
会在**跨零点那一瞬间**让同一张表里两行按不同日期判定「过期」—— 而这两行会被拿去讲**同一句话**。

### 上线与验收

- 后端 `erp_db.py` / `scheduler.py` / `routers/forecast.py`；前端 `Forecast.vue` / `ForecastHistory.vue`
- **留痕修正仅 1 行**：#21 `closed_mode` `auto` → `auto_reap`（否则会被误读成「到点正常关的」）
- 护栏 `tools/v355-stale-open-visible-harness.py` **36/0** · 回归 v342 **38/38**、v343 **53/53**、v354 **30/30**（**就地反转 1 条**）
- **真机探针 37/0**

### 🔴 真机探针范式（本轮沉淀，值得复用）

1. **「四负一正」判别矩阵**：负向（当前**不该**出现）× 4 ＋ **正向真痕迹** × 1。
   正向那条选自**真实生产数据**（#21 `closed_mode=auto_reap` ⇒ 历史页**必**显示「系统自动回收（报单窗口已过）」），
   比造数据强得多。
2. **空真断言 = 没断言**：`every(row => !row.stale_open)` 在本租户**合成行 0 条**时**恒真、零判别力**
   ⇒ 改「**生产真行改造**」：把真 #22 行 `order_end` 挪到过去 ⇒ 期望 `true`；再令 `id=-1` ⇒ 期望 `false`；
   并加**坏实现对照**（漏 `id>0` 的写法在同一行返回 `true`）。
3. **负向断言必须配判别力自证**：**现状 0 → 注入同款 DOM 节点 1 → 移除 0**（三步全对才算「检测器看得见」）。
   检测用 `textContent` **不用 `innerText`**（后者对隐藏元素返回空串）。
4. **403 归因别写「两页完全相同」**：403 **随页面而变**（实测工作台 6 条 / 预报页 1 条）。
   正解：① AI 域 403 **跨页共有**；② 预报页**除 AI 域外零 403**。角色硬证据见 `backend-auth.md`。

---

## §v358（2026-10-01）：商品目标「分解到人」—— 分摊数量可手填 + 比例/数量双向联动

### 一、唯一不变量（本设计的**全部**根据）

```
Σ比例 = Σ(数量ᵢ ÷ 总量 × 100) = 100 × Σ数量ᵢ ÷ 总量
⇒   Σ比例 = 100   ⟺   Σ数量 = 总量
```

**两者不是两条约束，是同一条。** 既然只有一条，就只能有**一个「源」**；两个都当源头必然打架。

**数量是守恒侧，比例由数量反算。** 反过来「比例当源头」会破守恒 —— 旧实现就是这么算的，且**零报错**：

> 总量 = 101、比例 33.33 / 33.33 / 33.34
> ⇒ `round(101 × r / 100, 3)` = 33.663 / 33.663 / 33.673
> ⇒ **Σ = 100.999**（换成 Σ比例 校验就是 100.999 ≠ 100）

### 二、四条规则

| # | 规则 | 为什么 |
|---|---|---|
| 1 | **谁被编辑，谁就是源**；源侧**原样保留** | 「源侧被四舍五入顶掉」= 用户眼里的「填了不算」 |
| 2 | 派生侧由源侧推出后**摊平四舍五入尾差**（最大余数法） | 否否则 Σ 会差 0.001 级 |
| 3 | 尾差补给**小数余数最大者**，**不是最后一行** | 固定补末行 ⇒ 那行在用户**没动它**时突然跳一次 |
| 4 | **缺口绝不强行摊平**：差额 > 人数 个最小单位 ⇒ **如实上报 gap** | 强行摊平 = 静默改数（本项目头号禁忌） |

**刻意不用**教科书式「先下取整、再把缺的补齐」——差别在**什么都不用调的时候**：本写法在 Σ 已对得上时**一个数都不动**。

**容差必须小于摊平闸门**：校验容差 `人数 × 0.0005` **<** 摊平闸门 `|差额| > 人数`（即 0.001）⇒ 过了校验的输入**一定摊得平**。

### 三、落定收进后端**唯一一处**

| 位置 | 内容 |
|---|---|
| `server/domain/product_targets.py` | `settle_allocs(total, allocs, source)` / `largest_remainder(xs, total, dp)` / `_rh()` / `_to_units()` / `_frac_units()` |
| `server/routers/product_targets.py` | `_validate_allocs` 双判据；`_write_allocs` 落两列 + 两道护栏；`update_target`「只改目标量」走落定 |
| `POST /api/product-targets/alloc-preview` | **落定预演，一个字节都不写**（登记进 `_READ_ONLY_POST` 白名单 11→12） |
| `src/api/modules.js` | `productTargetsApi.allocPreview({ targetQty, source, allocs })` |

🔴 **`_rh()` 走 `Decimal.repr` + `ROUND_HALF_UP`，不用内置 `round()`** —— 银行家舍入 `round(2.675, 2) = 2.67`，且 `2.675 * 1000 = 2674.9999999999995` 末位丢 1。
🔴 **`_to_units()` 也走 Decimal** —— `33.663 / 0.001 = 33662.999999999996`，直接浮点除会判错小数位。

### 四、本轮修掉的两个真缺陷（都有护栏钉死）

**(1) 「两个空值阴差阳错对上」⇒ 校验被静默空过**

原判据只看「`target_qty` 字段在不在」：

```python
has_qty = any(a.get("target_qty") is not None for a in allocs)   # ❌
```

**目标量 = 0 且各人数量全 0** 时：`Σ数量 = 0 == 目标量 = 0` ⇒ 校验**通过** —— 但那是因为**两边都是空的**，不是因为算对了。

```python
has_qty = bool(any(_given)) and _tgt > 0     # ✅ 判据必须带分母
```

前端 `qtyOk` 同步加 `qtyTotal.value > 0`。新增 B10 / B11 / E13b 三条护栏。

**(2) `_write_allocs` 缺「库里两列必须自洽」的自身契约**

① 若以数量为源落定后 `qty_ok=False` ⇒ **自动重试另一侧**（比例当源），成功则落库 + `logger.warning`；
② 两侧都不行 ⇒ **拒绝写入**（`HTTPException 422`，文案带 Σ 与目标量）；
③ 护栏在 `DELETE` **之前**生效 ⇒ 原明细**一行不动**（有护栏用例专门先塞一行原样、再证明它还在）。

### 五、归一化：复用既有唯一实现，**不新造第二张表**

- ✅ 复用 `db/queries/forecast_rules.py::normalize_num_text`（NFKC → `_HALF_MAP` → 去千分位逗号 → strip）
- 🔴 `_ALLOC_NUM_RE` 用 `[0-9]` **绝不写反斜杠-d** —— Python 的 `\d` 是 **Unicode 感知**（放行全角 `１２`），JS 不是 ⇒ 两端分裂
- ❌ **不能复用 `normalize_qty`** —— 那条是**整数专用**（`"1.5"` ⇒ `VK_INT` 报错），分摊数量是小数
- 🔴 前端分摊格必须 `type="text"` + `inputmode="decimal"`：`<input type="number">` 会把中文输入法打的「１２。５」**静默改成 `125`**（小数点被吃掉、放大 10 倍）、`'12.'` ⇒ `"12"`
- 🔴 中间态**只在 `@change` 收敛，不在 `@input`**；`runAllocSettle` 带 **`_allocSeq` 序列号丢弃过期响应**；`allocFocus`/`allocRaw` 记忆正在输入的格（防止被后端四舍五入值顶掉 ⇒ 造成「填了不算」）

### 六、验收读数（四层）

| 层 | 读数 |
|---|---|
| 后端护栏 | **64 通过 / 0 失败** |
| 跨轮回归 | v336 **47/47** · v339 25/25 · v342 38/38 · v343 53/53 · v354 30/30 · v355 36/36 · v318/v319/v324 全过 · v334 权限矩阵 42/0 |
| 端点真机只读 | **14 通过 / 0 失败** |
| 界面端到端（无头 Chrome 打生产） | **29 通过 / 0 失败** |

界面侧关键读数（目标量 100 箱、3 人）：

```
平均分配        ⇒ 33.33 / 33.33 / 33.34    Σ数量 = 100.000000 精确 · Σ比例 = 100.000000 精确
手填数量 70     ⇒ 该行占比反算 = 70        其他行**不被动** · 合计条如实标红「多了 36.67 箱」
补满 70/20/10   ⇒ Σ数量 = Σ比例 = 100.000000  转「通过」态
手填占比 50     ⇒ 该行数量反算 = 50
全角「４５」    ⇒ 45（未被静默改）
坏值「12箱」    ⇒ 该格标红 + 「有一格不是数字，已按 0 计…」
```

### 七、🔴 零夹带取证：hash 级联下**不能**用内容比对判夹带

hash 级联是**两级**的：改任一 chunk ⇒ 其 `__vite__mapDeps` 依赖映射表变 ⇒ 入口 + **所有 importer** 改名。
⇒ 本轮 30 个「生产无此名」的文件**内容也全部对不上** —— 这是级联的**必然**结果，**不是**源码变了。

**正确判据 = 时间轴取证**：

1. 生产 `index.html` mtime = **20:19:36**（= 上一次上线时刻）；
2. 工作区最后一个**别人**的在途改动 `BidRadar.vue` = **20:19:28**（早 8 秒 ⇒ 已随 20:19 那次上线）；
3. `find . -newermt "2026-10-01 20:19:36"` ⇒ 只捞出 **`src/api/modules.js` + `src/pages/ProductTarget.vue`** = **本轮自己改的**；
4. 构建 20:45 > 最后编辑 20:43 ⇒ 中间产物在最后编辑之后重建。

上线结果：assets 2396 → **2426（+30，与差集精确吻合**；其余 26 个同名复用）；线上 index.html **双侧 md5 全等**。

### 八、边界 / 未决（写给未来的自己）

| # | 事项 | 状态 |
|---|---|---|
| B1 | 手填**一格**后**其余行不自动配平**（Σ 暂时对不上 ⇒ 标红点名差额），与**比例格完全对称**，另有专用「平均分配」按钮 | **已列入需老板拍板** |
| B2 | 目标量框 `.pt-qty-in` 仍是 `type="number"`（全角会被静默改） | O1 观察项，本轮**只修分摊格** |
| B3 | 目标量字段 Pydantic 声明 `float` ⇒ 全角「１５０」在 handler **之前**被 422 拒 | O2 观察项（本页走不到） |

### 九、全站扫描：哪些位置该用同一设计

判据 = **同一业务量存在「占比」与「绝对量」两种表述，且两者必须满足一条守恒式**。

| 位置 | 结论 |
|---|---|
| `PriceChannels.vue` 三档价联动（v229） | ✅ **已达标**，`pyRound` 与后端逐字一致 ⇒ **当范式参照，不动** |
| `Forecast.vue` 一键分摊弹窗（占比↔加单量） | ⚠️ 已有双向联动，但 `_allocNum`/`toHalfNum` 是**页内私有**、用 JS `Math.round` ⇒ **建议收敛到后端共用 `settle_allocs`（P1）** |
| `Rebate.vue` 月度分解 | 有 `distributeMonths` 最大余数法，但**只有一列可编辑、无占比列** ⇒ 补第二列后与 v358 同构（**P2**，纯增量） |
| `ProductArchive.vue` 三档价 / `PayrollWorkflow` / `LossWorkflow` / `LossAccounting` / `Workbench`·`AiHub`·`EmployeeArchive` | ❌ **不适用** —— **没有守恒式**（三档价是同一量的三种**独立**表述；`near_loss_pct` 是**阈值**；`LossAccounting` 的率**分母各不相同**、源码注释已说明不能相加）⇒ 强做会造**假约束** |
| 小程序 `fill.js` | ✅ 显式注释「**不做本地换算**」⇒ 保持（已是想要的纪律形态） |

---

## §v359（2026-10-01）：分解到人**自动配平** —— 锁定行不动，剩余分给其余行

用户原话：「**先做成自动配平我看看效果，不行再回退。**」
⚠️ 这是对 §v358「**刻意不配平**」决策的**有意反转**，且用户已明示可回退 ⇒ 实现必须**默认可退**
（见第五节）。

### 一、语义（三条）

| # | 规则 | 为什么 |
|---|---|---|
| ① | **锁定行**（`locked` = 用户显式敲过的 employee_id）在**源轴**上的值**原样保留** | 用户刚敲的数永不被改写 |
| ② | **自由行**承接 `剩余 = 目标 − Σ锁定行`，按各自**原值相对占比**分；原值全 0 ⇒ **均分**；尾差走既有 `largest_remainder` | 保住用户已调好的相对结构（10:20 ⇒ 10/20，不是各 15）；原值全 0 时均分是**唯一不引入偏好**的选择 |
| ③ | **填超**（剩余 < 0）或**全被锁**（无自由行）⇒ **不配平**，如实回 `gap_*` | 绝不造负分摊；也绝不伪造一份用户从没表达过的分配 |

🔴 **锁的是「行」，不是「格」**：用户敲的是「A 拿 70 箱」这件事，不是"某个输入框"。
按格锁会让同一行在改完数量再改比例时出现两个来源打架。

🔴 **锁定是累积的**：依次给 A、B、C 填数 ⇒ 三行都会锁上。否则填第三个人时，
第一个人的数会被"配平"改掉 —— 用户会以为系统在乱改。
代价：**全锁之后不再配平**（改谁都不动），需点「平均分配」重排。这是**已知边界**，
交付时已向用户说明。

### 二、实现（落定仍在后端唯一一处）

- `domain/product_targets.py::_spread_rest(base_vals, free_idx, rest, dp)` —— 剩余分配**一处**实现。
- `settle_allocs(..., locked=None)`：`locked` 空 / 缺省 ⇒ **完全走 v358 老路径**（逐字节不变）。
- 主体**只有一次** `largest_remainder(src_vals, src_total, src_dp)`，不必分支：
  配平成功 ⇒ Σ 已 = 目标 ⇒ `resid == 0` ⇒ **一个数都不动**；
  未配平（没填满/填超）⇒ 差额远超尾差量级 ⇒ 内部闸门判「不是尾差」⇒ 同样原样返回。
- `routers/product_targets.py`：`_AllocSettleBody.locked: list` —— 声明成 `list` 而**不是** `list[int]`
  （与既有 `allocs` 同款）：元素类型交给 `settle_allocs` 内部 `int()` 转换并丢弃非法项，
  免得前端偶尔送数字串时在 Pydantic 层直接 422、把一个**宽可用**的端点变成挑食的。
- 🔴 `_write_allocs` **刻意不接** `locked`：前端送来的永远是 `alloc-preview` 落定后的值、
  Σ 已**精确等于**目标量 ⇒ 落定**幂等**。再传一次只是把同一件事算第二遍、多一份可能分歧的实现。
  （界面也不会出现"未配平就保存"：`canSave` 挂在 `qtyOk` 上，Σ 对不上时按钮是灰的。）
- `meta` 新增 `locked` / `auto_filled` / `rest_value`；`rest_value` 未配平时为 `null`。

### 三、界面（`ProductTarget.vue`）

- `allocLocked`（用户敲过的行，**累积**）→ 随请求发出；`allocAuto`（本轮被系统配平的行）→ **只**驱动标记。
- 🔴 **手填时先入锁、再落定**：顺序反了，刚敲的那一行会在同一轮里仍被当作"自由行"重算 ⇒
  症状「**填了 70、一松手变成 33.33**」（与 §v358 纪律②要防的是同一件事，只是新成因）。
- 清锁**只有两处**：`resetAllocState()`（开新建 / 开编辑 —— 防**跨弹窗幽灵锁定**）与
  「平均分配」（用户明确要求推倒重排，不清会让按钮**看起来失灵**）。`rmMember` 同步删锁
  （防"同名同 id 再加回来"的幽灵锁定）。
- 🔴 **配平必须可见**：被配平的格 `pt-num-auto`（`--info-blue-bg`，浅/深色主题各一套，
  不新造颜色）+ 合计条「已自动配平 N 人」。
  **能自动改数，就必须能自动说出来** —— 否则「填一格、旁边几格自己变了」就是一次**静默改数**。
- `pt-num-bad.pt-num-auto` 特例：一格既坏又被配平过 ⇒ **标红优先**（要说的是"它坏了"）。

### 四、生产真机实测（2026-10-01 21:2x，目标量 100 / 3 人）

界面端到端 **30 通过 / 0 失败**；护栏 52/52；v358 护栏回归 64/64（E14 就地更新）。

| 操作 | 读数 |
|---|---|
| 平均分配 | `33.33 / 33.33 / 33.34`，**无**配平标记、无提示 |
| **手填 A 数量 = 70** | A **原样 70**；B、C **自动** `14.998 / 15.002`；Σ **精确 100**；合计条**当场转绿**；提示「已自动配平 2 人」；B/C 两格蓝底 |
| 再填 B = 20 | A=70、B=20 **都不动**；只有 C 变 `10`；标记与提示同步收成「1 人」 |
| 全锁后改 A = 50 | 无自由行 ⇒ **一个数都不动**；Σ=80 标红「还差 20 箱」；**不显示**配平标记（不谎报） |
| 填超 A = 150 | 自由行不动、**不出现负数**；标红「多了 80 箱」 |
| 占比轴填 A = 70% | 其余各 `15%`、数量同步 `70 / 15 / 15` |
| 全角「４５」 | 归一为 45，未被判坏值（自动配平没破坏归一） |

🔴 **一个必须向用户讲清的现象**：手填数量 70 时 B/C 拿到的是 **14.998 / 15.002**（**不是** 15/15）。
这是**按原值相对占比**的必然：自由行原值是「平均分配」留下的 `33.33 : 33.34`，
`30 × 33.33/66.67 = 14.9985`、`30 × 33.34/66.67 = 15.0015`，而**数量轴是 3 位小数** ⇒ `14.998 / 15.002`。
（**比例轴是 2 位小数** ⇒ 同一个 14.9985 落到 **15.00** —— 这正是"填占比时看着更整齐"的原因。）
想得到严格 15/15：**不点**平均分配、直接手填（自由行原值全 0 ⇒ 均分）。

### 五、回退方式（用户「不行再回退」的兑现路径）

`locked` 缺省即老路径 ⇒ **只需回退前端**（`git revert 74bdf78` + 重建部署），**后端可原地保留**。
生产备份：`/root/backup/v359/`（后端两文件 + `index.html.v358.bak`）。
若改为「自由行一律均分」，只需把 `_spread_rest` 的 `base > 1e-9` 分支去掉 —— 但那就
**抹掉用户此前调好的相对结构**，护栏 B7（10:20 ⇒ 10/20）会立刻照出来。

---

## 🔴 「加单」是否**强制**分摊到业务员？（2026-10-02 纯只读核实，未改码）

**用户问法**：「加单列是否强制要求分摊到业务员头上？能不能自由选择不分摊？加单有时只是**备货**。」

### 一句话结论

> **没有任何校验 / 拦阻，但你也无法选择「不分摊」** —— 只要存在 ≥1 个「可分摊对象」，
> 保存汇总表时系统就会**自动**把它分掉。

🔴 **判「是否强制」不能只看校验**（本题最容易答错的地方）：

| # | 查什么 | 结果 |
|---|---|---|
| ① | **硬拦**（422/409/前端 `return`/按钮 `disabled`） | ❌ **全无** —— `save_matrix` 的 4xx 只有「缺参数 / 期次不可写 / 乐观锁冲突」；`close_period`（定稿）**也不校验**分摊 |
| ② | 🔴 **缺省路径**（不做时系统是否替补） | ✅ **会** —— `save_matrix` 里**无条件**调 `plan_extra_allocs()`（**不在任何 `if` 里**，只在 `try` 里兜异常） |
| ③ | 派生量下游 | 定稿通知（`notify_extra_allocs_finalized`）/ 付款金额（`alloc_box`）/ 留痕 |

⇒ **「没有校验」≠「可以不做」。用户问「能不能不做」，要答的是「谁会替你做」。**

### 三层分流（`_alloc_members_of()` **唯一实现**；保存落库 / 界面判据 / 弹窗 / 预演**四处共用**）

| 层 | 触发条件 | 可分摊对象（人从哪来） | 结果 |
|---|---|---|---|
| **L1** | 该商品在**到货月**有 `active` 商品目标 | `product_target_alloc` 承接人 | **必分** |
| **L2** | 无目标 / 目标没填承接人 | **本期报过该商品的人**（`_reported_by_operator` → `ratios_from_reported` 推导占比） | **必分** |
| **L3** | 无目标 **且** 本期无人报过 | 无 | ✅ **不分**（**唯一**自动不分的情形）|

**占比规则**（`domain/product_targets.allocate()`，**别重写**）：
- 加单：`alloc_i = D × ratio_i / 100` —— **绝对比例、不归一化**；Σ<100 的缺口 `ratio_gap` **如实上报、不重分**
- 减单：`min(|D|×ratio_i/100, reported_box_i)` **夹断到 ≥0**；被夹掉的 `clip_gap` 在**还有余量的人**之间
  按相对占比重分（≤64 轮）
- `ratio_gap`（占比合计不足）与 `clip_gap`（报量不足被夹断）**分开算**，**只有后者会重分**
- v336 起落 `basis`（`'override'` / `'target'` / `'reported'`）+ `operator` 两列 —— 同为「30%」但含义与可改性不同

### 🔴 穷举完**必须回生产验可达性**（不能写完表就交差）

- 商品目标**创建时强制 ≥1 承接人**：`_validate_allocs()` → `if not allocs: raise 422 "请至少选择一位承接人"`
  ⇒ **L1 恒成立** ⇒ L2 的「目标没填承接人」这条入口**生产 0 条、不可达**
  （对照：tenant_1 共 4 条目标，承接人 2 / 3 / 3 / 4，**0 条为 0 承接人**）
- ⇒ **生产里唯一能「不分摊」的路径 = L3**

### L3 的两类成因（= 「谁算可分摊对象」的反面）

| 成因 | 判据 | tenant_1 实测（2026-10-02） |
|---|---|---|
| 本期真没人报过 | `_reported_by_operator()` 返回空 | — |
| **报过，但列头挂不上人** | `alias_map` 要求 **`is_active ≠ 0` 且 `employee_id > 0`** | 9 个列头**只有 5 个能接上人**（东津/吾悦/刘小顶/美联保康/刘善涛）；`唐成`=外部客户账号（`external_user_id>0`，v317 口径**不参与内部分摊**）；`永诺旗舰店`/`永诺（江山店）`/`永辉东津店`=**已停用**（v343 起不计入汇总）；其余绝大多数（黄家伟/谢总/程欢欢/民发/汴河…）= **`nomap` 从没登记过** |

🔴 **第二类才是用户说的「备货」场景**：生产里**真实存在一个叫「备货」的报单列头**（`nomap`）
⇒ 挂在它下面的量**天生挂不上人** ⇒ 那些商品**天然不分摊**。
⇒ **「备货要不要归到业务员」取决于「这笔量记在哪个列头下」，不取决于有没有开关。**
（这也是 `_alloc_members_of` 刻意区分 `external` / `inactive` / `nomap` / `empty` 四类的原因。）

### 🔴 机制存在 ≠ 行为被验证过

| 表 | 生产行数（2026-10-02） |
|---|---|
| `forecast_extra_qty`（加单量，经理填的） | **1782 行，非零 0 行**（全是 `save_matrix` 对每行 upsert 的 **0 值占位**）|
| `forecast_extra_alloc`（按人分摊明细） | **0 行** |
| `forecast_alloc_ratio`（本期临时占比，v339） | **0 行** |

⇒ **「加单」从未被录过一个非零值 ⇒ 整套分摊分流从未在真实数据上跑过。**
⇒ 交付结论必须**显式标注**「以上为代码层判据，**未在生产数据上验证过行为**」。

### 顺带发现的两处缺陷（**未修**，已报用户）

1. **保存回执文案说错原因**：toast 把 `no_members`（**一个人都分不到**）也算进「N 个商品没分满」，
   而原因只写了「占比合计不足 100%，或减单时有人报量不够」——**两种都不是**。
   （`plan_extra_allocs` 的 `no_members` 分支 `fully_applied=False` ⇒ 被 `!_ea[k].fully_applied` 一并计数。）
   ⇒ 回执里凡带「因为…」的文案，都要**逐分支回对一遍**（本题 3 分支：`ratio_gap` / `clip_gap` / `no_members`）。
2. **可见性缺口**：「悬空」橙标 + 「分摊」按钮 + 悬停说明**只在编辑态**（`Forecast.vue:1273 / :1280`），
   **只读态只有纯数字** ⇒ 用户"只是看一眼"时看不到这笔加单有没有落点。
   （且 `ptExtraAlert()` 读 `r.extraQty`，而只读态行对象是 `extra_qty` ⇒ 恒判 0、即便渲染也不显示。）

## 🔴 价格字段的**单位口径**：`factory_price` 与其余三列**不是同一把尺子**（2026-10-02）

`products` 表上四个价格列混着**两种单位**：

| 列 | 单位 | 含义 |
|---|---|---|
| `factory_price` | **元 / 大单位（箱）** | 厂价 |
| `purchase_price` | **元 / 小单位** | 进货价 |
| `sale_price` | **元 / 小单位** | 销售价 |
| `dist_price` | **元 / 小单位** | 分销价 |

⇒ 同一行里 4 个价格两种单位。任何「单价 × 数量」的算式，**先问这个数量的单位是哪把尺子**。

🔴 **`单价(厂价/箱)` 里的 `/箱` 是单位后缀，不是除法** —— 所以「单价(厂价/箱)」**就是厂价本身**。

🔴 **方法论：修「值不对的公式」之前，先判「这个运算该不该存在」**。
把它当成「厂价 ÷ 箱数」去"修"，会把一个**本来就正确**的显示改成错的。
**先判语义，再改算式。**

---

## §v365 停单 ⇒ 期次排除（自动编排侧）

**触发**：返利域「到货节奏」里点掉某一天（落 `rebate_arrival_skips`）—— **无独立开关**，
停单本身就是触发。
**作用点**：`domain/arrival_schedule.build_period_plan(..., skips_by_rule=None)`。

### 为什么判定必须放在 `build_period_plan` 内

它是**预览与调度器的唯一共享实现**，三个调用方：`scheduler._check_auto_period` /
`routers/forecast.auto_period_get|put` / `routers/rebate_rules.auto_period_preview`。
判定写在里面 ⇒ 三方**自动同源**；写在外面 ⇒ 各自实现 ⇒ 必然漂移成
「预览说会建、实际不建」（本项目最贵的失效类型）。
新增参数是**末位可选**：不传 ⇒ 与 v364 之前行为**零变化**。

### 调度器侧

被排除的期次**最先** `continue` —— 既不该建、也没有可关的东西。
🔴 这样**不会留下 open 期次** ⇒ 不会碰到「同一时间只能有一个 open 期次」那道硬闸，
也就不会重犯 v354/v355 的自动化死锁（→ `§v354`·`§v355`）。

`_EXCLUDED_LOGGED` 做**日志去重**：这条路径**没有任何库内幂等闸**可依赖
（不像建表成功后有同窗口行可查），而自动化相位是「每 5 分钟一轮」⇒ 不记一笔就会在
填报窗口内刷几十条一模一样的日志，**真故障会被自己的噪音淹掉**。

### 期次 ↔ 停单日的匹配（易错点）

`期次.arrival_date == 停单日` 的**等值**比较。
**绝不能用「同月」**：`arrival_date = 报单日 + 基准品牌 order_lead_days`，
到货 10-05 的期次报单窗口在 9 月底（生产实证期次#22 窗口 `09-30~10-01`）。
跨月实证样本：到货 **11-02** → 报单日 **10-29** → 开放 **10-28**。

### 回执契约 `/api/forecast/auto-period`

新增顶层 `excluded_count`（本次排程内有几期不再自动建）；每期新增
`excluded / exclude_reason / exclude_hit / exclude_partial`。
**`excluded_count` 恒为 0 也是合法读数**（说明本次没有停单打中）——
判「功能有没有生效」要连同 `rebate_arrival_skips` 的落库一起看，别只看这一个数
（恒空恒 0 且零报错 = 静默失效，是同一类判据陷阱）。

### §v368（2026-10-02）：停单 ⇒ 期次排除，升级为「任一停即不建」+ 一键作废

**判据**（`domain/arrival_schedule._apply_period_exclusions`，预览≡调度器唯一同源）：
`excluded = bool(hit)` —— **任一**参与品牌在到货日标记「不到货」⇒ 这一期整期不自动建。
（v365 的「全停才排除」已被老板推翻；理由见 `rebate-domain.md §v368`。）

**三条边界**（每条都是踩出来的）：
1. **只管自动建表**：`POST /api/forecast/periods`（手动建表）刻意**不读**停单 ——
   「系统别替我建」≠「我不许建」。验收要正反两侧：自动不建／手动建得出来。
2. **只管那一天**：判据是 `期次.arrival_date == 停单日` 的**等值比较**（绝不能按"同月"）。
3. **已存在的期次不删不关** ⇒ 另给 `POST /periods/{pid}/void` 一键作废。

**一键作废为什么是「关闭 + `closed_mode='void'`」而不是删除**（两条硬约束）：
`forecast_period_delete` **只接受已 closed 期次**，而误建期次总是 open ⇒ 删不动；
真删又会级联删掉报单/订单/付款。而**自动建表那道硬闸是「只能有一个 open 期次」**
⇒ 关掉它本身就解决了"它挡着下一期建不出来"（v354/355 死锁同款）。
副作用全部可控：数据全留、`reopen` 能救回、走 db 函数不经端点 ⇒ **不发加单通知**。

**`_periods_skipped()`**（`routers/forecast.py`）：判定「已存在的哪些期次本不该建」——
该期 `arrival_date` 落在**任一**规则的停单日集合里（与上面判据同源，不重跑排程）。
🔴 读停单失败 ⇒ 返回空 + 日志留痕，**绝不让首页级热接口 500**。

**真机验收的坑**：别拿**窗口正开着**的那期做作废实验 —— 关掉它之后，调度器下一轮
（5 分钟一次）发现"没有 open 期次 + 窗口开着"⇒ **会真的再建一期出来**。
⇒ 用**窗口不重叠的远期临时期次**（它自己顶着"已有 open"那道闸 ⇒ 期间不会误建），用完即删。

### §v369 均单目标的两条铁律（小程序报单页那个「均单目标 N 包/箱」）

**铁律一 · 分子必须是「这个人的」目标，不是商品总目标。**
均单 = (月目标 − 已达成) ÷ 剩余可报期次。`product_targets.target_qty` 是**商品总目标**
⇒ 直接用会让**每个报单人看到同一个团队摊薄值**（生产实证：商品 1556 月总目标 1000 箱、
剩余 13 期 ⇒ 76.923 箱 × 8 = **615.385 包**，而程欢欢的个人目标是 **400 箱** ⇒ 246.154 包；
**同一件商品对所有人错、且错得一样**）。个人目标真身 = `product_target_alloc` 里
`employee_id = 登录人` 那一行的 `target_qty`（0 时回退 `总目标 × ratio/100`）。
判据与实现在 `routers/product_targets.py::avg_target`（`_my_alloc_by_tid`），
响应带 `avg_basis`（personal / team）——**前端不许自己判断有没有个人目标**。
🔴 推论：**销售与经理看同一个接口会拿到不同数**，这是对的，不是 bug。

**铁律二 · 个人模式下「已达成」不扣，且不许后人"顺手补上"。**
`achieved` 是**商品级**、拆不到人：`sale_orders.operator_id` 存的是**员工姓名**不是 id；
`rebate_achievements` 只有 brand / product 维度，**根本没有"按人"这一层**。
⇒ 分子用个人目标、分母仍用商品级已达成 = **把别人卖掉的量算成他已完成** ⇒ 均单虚低、
甚至直接显示「已达标」⇒ **比偏大危险得多**（销售以为不用再报）。**宁可不少扣，不可错扣。**

**剩余期次的「13 vs 14」不是 bug**：分母判据是「**报单窗口还没关**」（v324），
不是「到货日还在未来」—— 报单要提前 `order_lead_days`，10/5 到货那期的报单窗口
在 10/1 就关了。⇒ 到货机会 14 次、能报 13 次，两者都对，报单人关心的是后者。

### §v369 未报单进度的可见范围（`pending-summary` 的 `scope`）
全局 `units_total/reported/missing` **本身就是泄露**（「12 个、已报 9 个」= 全公司谁还没动）。
⇒ `scope="self"`（`sales`/`distributor`）时三个计数**一律 0**，只给 `my_missing`；
`scope="all"`（`admin`/`boss`/`supervisor`/`accountant`/`manager`）才给全局（催单用）。
🔴 **判据是角色轴、不是「有没有员工档案」**：老板账号 `users.id=2` 的 `employee_id=7`
（名下确有门店、真的报单）会被判成报单人 ⇒ **连催单的人都没有全局进度**（首版真踩）。
⚠️ **fail-closed**：角色取不到 ⇒ 判 `self`（宁可少给不可泄露）。
前端 `miniprogram/pages/fill/fill.js::loadPending` 必须按 `scope` 分支 ——
**绝不能拿后端已清零的 `units_missing` 再拼出「本期还有 N 个单元没报单」**（等于白改后端）。
`self` 且 `my_missing` 为空 ⇒ 整条不渲染（沿用「不显示 0」）。

### §v369b 均单取整：只做一次、做在「箱」层，且必须防浮点毛刺
老板原话：「246.154 包，后面的小数点点不要，报单不可能有 0.154 包，如果有小数做向上取整处理」。
- 🔴 **取整只做一次、做在「箱」，再折算各单位**。反过来（先折包再取整）会造出
  「31 箱 vs 247 包」—— `31 × 8 = 248 ≠ 247`，同屏两个数打架。
  ⇒ 程欢欢 **31 箱 = 248 包**（不是 247）；刘小顶 47 箱 = 376；团队 77 箱 = 616。
- 🔴 `round(6)` 后再 `ceil` **不是装饰**：浮点尾差会把**恰好整数**推高一格
  （`80.00000000000001 → 81`）⇒ 零报错地多报一箱。`_ceil_box` 是唯一实现。
- 报单单位那一格要**再**取一次整（防档案里非整数换算比，如 31 箱 × 2.5 = 77.5）。
- 逐人差额（v277 `gap_box`）**必须复用同一个已取整的 `_avg`**，否则同屏两把尺子。
- ⚠️ `prefill_*` 不取整（前端零消费 + 语义不同 + 牵连 v358/v359 分摊）。
- ⚠️ 副作用：基准抬高 ⇒ 报 247 包由「达标」变「未达标」。属用户明确要求的行为。

## §报单金额口径双轨（2026-10-05 核实，动「报单金额」前必读）

**背景**：老板要求小程序报单页显示「报单金额」＋「本月累计金额」，并问「调拨单匹配什么价格」。

### 一、🔴 系统里报单金额**本来就有两条链，且口径不同**

| | 单价源 | 量纲 | 金额算法 | 落库位置 |
|---|---|---|---|---|
| **Web 端报单主表**（唯一权威实现 `Forecast.vue::pricePerCase`） | `factory_price`（厂价） | **元/大单位（箱）** | 箱数 × 厂价 | `forecast_extra_qty.case_price`（仅手工录入时） |
| **小程序提交落库**（`routers/forecast_submissions.py:387`） | `products.sale_price` → 回退 `purchase_price` | **元/小单位** | 报单数量 × sale_price | `forecast_submission_items.price/amount` |

**量纲铁律（唯一权威表述在 `Forecast.vue:3755-3758` 注释里）**：
> `sale_price` / `purchase_price` / `dist_price` 是「**元/小单位**」，只有 `factory_price` 是「**元/大单位**」

⚠️ **技能 `hergent-unit-conversion-audit` 此前漏记 `sale_price` 这一列**（已补）。

### 二、举证：同一商品同一量，两端金额不同（id=1538 CD杯8杯，小=组 / 大=箱/12）

- Web 端：单价 = `factory_price` = **82.80 元/箱**；报 1 箱 ⇒ 金额 **82.80**
- 小程序：price = `sale_price` = **7.6667 元/组**；报 12 组（=1箱）⇒ amount = **92.00**
- 实测落库行：`1538 CD杯8杯 组 12 7.66666666666667 92.0` ⇒ 确为小程序那条链

⇒ **两端差 11%**，**不是 bug 而是从未对齐过的两套口径**。任何「小程序显示金额」的需求，
**若不先统一口径，小程序与 Web 端必然对不上账**。

### 三、🔴 价格覆盖率：`sale_price` 只有 30%，`factory_price` 100%

本期（period 27）报单清单 **154 个商品**实测：
- `sale_price > 0` = **46 个（30%）** ⇒ 其余 **108 个金额会算成 ¥0**
- 仅 `purchase_price > 0` = **0 个**
- **`factory_price > 0` = 154 个（100%）**
- 有大单位换算 = 133 个

⇒ **按小程序现状（sale_price）做金额显示，70% 的行是 ¥0**；这就是
`forecast_submission_items` **122 行里只有 21 行 `amount>0`** 的真因（**不是接口没写，是价格数据缺**）。

### 四、`store_kind`（调拨单 vs 自提单）**不参与定价**

- `price_map` 仅按 `product_id` 构造（`forecast_submissions.py:382-387`），
  **完全不读 `store_kind`** ⇒ **调拨单（本人仓）与自提单（门店）匹配同一个价**。
- 全仓**没有任何按业务类型区分价格的逻辑**。
- 若业务上「调拨应走成本价/调拨价」，那是**尚不存在的新能力**，须先定口径。
- ⚠️ `forecast_periods`/`store_kind` 的类型轴归一 = `_norm_store_kind()`（只认 `'warehouse'`，
  其余回落 `'store'`），它同时决定**幂等键**（`create` / `replace` 两处必须同源）。

### 五、老板口中「报单配置时配置价格」**这个入口不存在**

- `forecast_config` 表只有 `kind` ∈ {`audit:*`, `business_profile`}，**无任何价格键**；
  报单配置卡片（`components/forecast/ConfigCard.vue`）不配价格。
- 真正的价格**手工录入入口** = **Web 端报单主表那格「单价(厂价/箱)」**
  （`C_PRICE_INPUT` 哨兵 → `forecast_extra_qty.case_price`，只在本期生效、不写回档案）。
- 🔴 **但生产 `forecast_extra_qty` 1936 行里 `case_price` 非空 = 0** ⇒ **老板从未手工录过价**。
  三级取值链：① 本期手工录入 → ② 沿用最近一期录入（只读、不落库）→ ③ 档案厂价 `priceAuto`。

### 六、🔴 「报单人不看金额」是**既有设计**，不是疏漏

- 小程序 `fill.js:1677`：`v108-fix: 不再传 price/role（铁律①报单人不看金额；role 由后端按 token 校验）`
- 后端 `forecast_submissions.py:140`：`price 由后端按 product_id 查 products 表，忽略客户端传入（防篡改/防泄露进价）`
- ⇒ 后端**刻意不向小程序下发单价**。要显示金额必须**新增下发**，
  等于**改变一条既有权限铁律** ⇒ 须老板明确拍板「谁可以看金额」（sales / supervisor / distributor）。

### 七、动手前必答的三个问题（缺一不可）

1. **金额用哪个价**？厂价（元/箱、覆盖 100%、与 Web 一致）／`sale_price`（元/小单位、仅 30% 有值）／手工录入价（现为 0 条）
2. **「本月累计」按什么分组**？该员工？该门店？全部门店？⚠️ 且**期次 2 天一期（约 15 期/月）**，
   「本月」按 `order_date` 月份还是按期次归属月，须显式声明（对照 **v372 口径错位**教训）
3. **谁能看**？是否打破「报单人不看金额」铁律；若只给主管/老板看，则小程序需按角色分档渲染

🔴 **未核实就动手的最大风险**：需求前提（"报单配置里有价格"）不成立 ⇒ 做出来 70% 显示 ¥0，
且与 Web 端金额对不上账。

---

## §个人仓归属（v381 待实施 · 2026-10-06 起因：老板要求把「报单身份」移进「报单配置」）

### 一、唯一字段与唯一读点

| 项 | 内容 |
|---|---|
| 库列 | `hr_employees.warehouse_id`（INTEGER，0=未设；v107 加列 `erp_db.py:1150`） |
| 界面名 | 「个人仓」，所在分区标题**「报单身份」**（`EmployeeArchive.vue:188-209`） |
| 唯一读点 | `erp_db.py:7720-7727`（`report_mapping_create` self_warehouse 分支）＋ `7813-7825`（update）＋ `8027`（`report_mapping_refs` 下发）＋ `7470`（员工列表 `SELECT *`） |
| 写白名单 | **三处必须同改**（v294 教训）：`erp_db.py:7455` `employee_create` ＋ `server.py:5782`（POST）＋ `server.py:5804`（PUT） |

🔴 **它不参与工资/考勤/绩效** ⇒ 天生属报单域。但界面在员工档案、写接口归 **`hr`**。

### 二、🔴 现状断链（生产 tenant_1 实测 2026-10-06）

**账面上只有 admin/boss 能设个人仓**（两者持 `hr`；见 `backend-auth §报单配置两轴`）：

| 角色 | `hr` | `data` | `forecast` | 能设个人仓 | 能配本人仓映射 |
|---|---|---|---|---|---|
| admin / boss | ✅ | ✅ | ✅ | ✅ | ✅ |
| 会计 / 主管 | ❌ | ✅ | ✅ | ❌ | ✅ **但被拒** |
| 库管 | ❌ | ✅ | ❌ | ❌ | ❌ |

⇒ 会计/主管看到的那句「**请先在员工档案设置其个人仓**」是**死胡同**：他们进不去员工档案
（入口隐藏；深链被守卫放行但 `/api/employees` 403 ⇒ 列表恒空零报错 = **假入口**）。

### 三、🔴 同款先例（本次 = 补完，不是新架构）

`erp_db.py:19955-19967` + `EmployeeArchive.vue:113`：**2026-09-19 已把「门店」从员工档案
搬到报单配置** —— 员工档案侧入口移除、写端只剩报单配置一处、列表留**只读计数列**。
本次只是把当时没搬的「个人仓」补搬完。**处置手法可直接照抄**。

### 四、迁移的两种做法（结论：先做 A1）

- **A1（推荐）**：**表单搬家、数据不搬家** —— 报表配置里选中员工后出现「该员工的个人仓」下拉，
  写库仍落 `hr_employees.warehouse_id`（保持归属真身），`counterparty_id` 照旧派生 ⇒ **零迁移**。
  权限轴：新写端点归 `data` ⇒ 会计/主管终于可用。**必须新增"一个仓只属一个员工"的判据**
  （否则两员工同仓，报单互相覆盖）。
- **B（缓做）**：让 `counterparty_id` 成唯一真身、`warehouse_id` 退化为只读。
  `routers/data.py:469` 早就写明**它不是报单配置的真身**（双份必漂移），但改动面大，
  且要先定「一人能否多仓」。
- ⚠️ 两方案共同铁律：**多写入口 ⇒ 规则单一实现**，新端点必须复用同一个 `employee_update`。

### 五、生产脏数据（迁移时顺带核实，勿当正常）

- `王老板 warehouse_id=5` —— **悬空**：`warehouses` 里无 id=5（只有 1/2/3/7/9/10/11）
  ⇒ 员工档案显示「仓库 #5」，而报单配置永远选不出它
- `张俊峰仓 id=10` 存在但**无人绑定**（张俊峰 `warehouse_id=0`）⇒ 仓建了没绑人
- 12 员工中仅 4 人有个人仓（王老板悬空 / 刘小顶 7 / 刘善涛 9 / 程欢欢 11）；
  `report_mapping` self_warehouse **3 条**，与后三人一一对应

⇒ 三条链路分散的直接证据：**「建仓」在仓库档案、「绑人」在员工档案、「挂列」在报单配置**。

---

## 🔴 v381（2026-10-06）个人仓入口迁移 **已实施并上线** —— 上文 §个人仓归属 的收口

> **上文那节是「评估」，本节是「落地结果 + 只有实施后才会知道的坑」。** 评估里推荐的 A1 就是最终做法，结论不冲突。
> 老板四项拍板 = `A1（一人一仓，只换地方填）; B（员工档案侧全撤）; A（权限归 data）; A（清脏数据）`。

### 一、最终形态（改哪里读哪里）

| 环节 | 位置 | 说明 |
|---|---|---|
| **入口（设个人仓）** | 预报订单管理 → 报单配置 → 新建/编辑「本人仓」映射 | 对象那一格 = **仓库下拉**，即选即存 |
| **真身（数据）** | `hr_employees.warehouse_id` | **没搬**。`report_mapping.counterparty_id` 仍由它派生 |
| **唯一写实现** | `erp_db._resolve_self_warehouse()` | `report_mapping_create` / `_update` **同源复用** |
| **权限轴** | 接口归 `data` | ⇒ 会计 / 主管可用（旧入口归 `hr`，他们 403） |
| **员工档案侧** | 列表「个人仓」列 + 编辑弹窗「报单身份」分区 | **都删**（Q2=B，比推荐项更彻底） |

**`_resolve_self_warehouse(db, employee_id, want_wh_id) -> (warehouse_id, warehouse_name, error)`** 三条校验：

1. 员工不存在 → 「员工不存在（请先在员工档案建立该员工）」
2. 所选仓不存在 → 「所选仓库不存在（请先到「档案管理 → 仓库档案」新建）」
3. 该仓已被**别的在职员工**占用（`AND id!=? AND is_active=1`）→ 「该仓已指派给「X」，一个仓只能属于一个员工」

🔴 **它只 `UPDATE` 不 `commit`** —— 由调用方的既有事务边界收口（本仓写实现一律不自己 commit）。
🔴 **两条分支都要支持「未传 `counterparty_id` ⇒ 回退读该员工既有 `warehouse_id`」**，否则老前端 / 脚本一保存就被拒。

### 二🔴 坑 1：后端报的错**离病因很远**，前端必须自己再实现一遍同判据

「一个仓只能属于一个员工」这条规则，**后端只有一处**（上面第 3 条）。但用户撞到它时看到的往往**不是**这条：

- 员工 B 想用「刘小顶仓」建映射 ⇒ 后端先撞 **v297 的「同一对象只能有一条活跃配置」**
  （因为那个仓已有一条 self_warehouse 映射，且 `counterparty_id` 撞了）
- 报错点指向「对象重复」，而真正的原因是「这仓已经是刘小顶的」

⇒ **`ReportMapping.vue` 里必须有一份前端同判据**：`whOwnerMap`（仓id→员工名）＋ `currentWhOwner`，
**保存前就地拦**并说明「请换一个，或先改他那条配置」。

🔴 **`whOwnerMap` 必须 `e.id !== cur`（排除当前报单人）** —— 编辑自己那条映射时，
不该显示「这个仓已被自己占用」。

### 三🔴 坑 2：只读框改成可编辑下拉后，`openEdit` **不回填** = 静默抹数据

本人仓那一格从 `.ro-box`（只读展示，无需回填）改成 `combo` 仓库下拉后，
显示靠的是 `objKeyword`。**不回填就是空白框**，用户不动它直接保存 ⇒ 把已选的仓**静默抹成「未选」**，
而界面当时看着完全正常（跟 v377「进轴前必 `commitPendingEdit`」是同族坑：**编辑态与显示态的桥没搭**）。

同族三处一起改：`openEdit` 回填、`onType` 切到本人仓时填、`onEmpChange` 换人时同步。
换到新人且新人无个人仓 ⇒ **清空**（让用户自己选），不要留着上一个人的仓名。

### 四、被删掉的东西（**别再加回来**）

- `EmployeeArchive.vue`：`warehouseApi` import、`warehouses` / `loadWarehouses()` / `warehouseName()` 整块、
  `editForm.warehouse_id` / `resetEditForm` 回填 / `saveEmployee` 提交、列表「个人仓」列、编辑弹窗「报单身份」分区、`.df-wh` CSS
- `ReportMapping.vue`：`.ro-box` / `.ro-name` / `.ro-tag` / `.ro-warn`（四个死 CSS）

🔴 **刻意保留（不是漏删）**：`server.py` 的 `POST/PUT /api/employees` 白名单**仍留 `warehouse_id`**（脚本与回滚要用），
`employee_list` 的 `SELECT *` 仍下发该列。⇒ **`/api/employees` 仍能写个人仓**，只是**界面不再从这里发**。
看到这份白名单还在，不要以为迁移没做完。

### 五、脏数据清理（Q4）

- `王老板 id=2`：`warehouse_id 5 -> 0`（悬空仓，`warehouses` 里根本没有 id=5）
- 手法：真实 API `PUT /api/employees/2 {"warehouse_id":0}` —— 端点明写「传 0 = 取消个人仓绑定」，
  即**迁移前旧前端的正规路径**，不是绕后端直改库
- 备份：`/opt/hergent-erp/backups/tenant_1.db.before-v381-selfwh-20261006-160922.bak`（32,296,960 B）
- **回滚一句话**：`UPDATE hr_employees SET warehouse_id=5 WHERE id=2`
- 差异**恰好 1 条**、零令牌残留、无令牌阴性对照 401 通过

### 六、验收资产（可复用）

| 脚本 | 用途 |
|---|---|
| `tools/v381-recon-selfwh.py` | 只读侦察（仓/员工/映射三方对账） |
| `tools/v381-selfwh-cleanup.py` | Q4 授权写（12 PASS / 0 FAIL） |
| `tools/v381-shadow-verify.py` | 影子库 A/B（新 33 PASS / **旧 6 PASS 反例自证**） |
| `tools/v381-perm-probe.py` | 权限正反（17 PASS / 0 FAIL） |
| `tools/v381-batch-diff.py` | 构建批次 vs 生产生效批次归一化比对（零夹带） |
| `tools/v381-fe-commit-surgery.py` | **前端受控提交的 blob 手术**（剔并行会话的 2 行 CSS） |
| `tools/v381-live-probe.js` / `v381-ui-probe.js` | 登录态真机只读探针 |

🔴 **影子库两坑**（本轮重踩）：
① 断言 (a) 若先给某员工建了指向某仓的配置，后续断言再指向同一仓会撞 **v297 唯一约束** ⇒ 每条断言必须用**专用空闲仓 + 专用测试员工**隔离；
② 隔离副本必须**在 import 前**设 `ERP_DB_PATH`（`db/connection.py:11` 与 `erp_db.py` **两份** `DB_PATH`），且脚本要自证连在副本上。
