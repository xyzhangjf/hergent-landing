# 返利域细节存档（从 MEMORY.md 下沉）

> 核心结论留在主记忆，本文件保留完整实现细节。需要排查返利口径时读本文件。

## 判重（v125 铁律）
- **判重维度 = 覆盖月份集合，不是 period_type**。单期(month)与年度(year) 口径不同但覆盖同月 = 重复目标（会导致目标/达成/返利三处翻倍）。
- 实现：`server/domain/rebate_period.py::covered_months()`（只依赖标准库，**必须放 domain 层**，放路由模块会被 erp_db 迁移回填触发循环 import）；`detect_conflicts()` 按月份交集判重。
- DB 兜底：`rebate_rule_month_lock` + `UNIQUE(dimension,target_type,scope_key,ym)`，停用/删除即释放；`IntegrityError → 409`。
- `POST /api/rebate-rules/precheck` 供前端保存前提示（两个入口共用）。
- ⚠️ `rebate_achievements` **不绑 rule_id**（按 period_month+dimension+scope_key）→ 停用/删除返利规则不影响达成填报；`rebate_tier_versions/calculations` 需先查引用数。

## 月度模型（v126，已废弃"年度/单期"双口径）
- 品牌目标=**一张 12 行月表**，年度=12 格全填、单期=只填 1 格；顶层 `target_value/rebate_rate/tiers_json` 降级为"未配置月份的回退值"。
- 三张月表：`monthly_amounts`(元) / `monthly_rates`(小数) / `monthly_tiers`(`{"08":[...]}`)。
- 核心函数 `domain/rebate_period.monthly_view(rule, ym)`，注入点 `rebate_calc.compute_rule_rebate` 首行（试算+计提同时按月取值）。
- 前端 `MonthlySplitBlock.vue`=统一月表；`BrandTargetForm.vue` 已无年度/单期切换；「计算维度」下拉已删、维度锁定不可改（后端 `update_rule` pop dimension）。
- 新建时若同年同对象已有启用规则 → 蓝底提示条 +「编辑这条」，**不自动带出**。

## 报单 / 到货节奏（2026-09-08 定稿）
- 主序列=最密品牌节奏；品牌归属=提前窗口 `[C_X−E_X, C_X]` 取 max；零漏报 iff `cadence_main ≤ min(E_X)+1`（蒙牛 cad=2/E=1→0 漏）。**只提前不延后**。
- 三时点：T_open=报单日前一日 20:00 / T_close=当日 10:00 / T_supplier=当日 12:00（仅提醒不代下单）。错过→admin/boss 重开。
- 引擎 `server/domain/arrival_schedule.py`；预览 `GET /api/rebate-rules/auto-period-preview`（须在 `/{rule_id}` 前定义）。
- 到货日**不落库**（只存 `order_lead_days` 反推）；日期一律 `Date.UTC`；不跳周末节假日。

## 前端组件与坑
- `src/components/rebate/` = `useRebateTargetForm.js`(纯逻辑) + `TargetFormModal.vue`(按 dimension 分流) + `Brand/ProductTargetForm.vue` + `MonthlySplitBlock/ArrivalRhythmBlock/RebateValueBlock.vue`；`Rebate.vue` 退化宿主。子组件依赖走 props/emits，禁复用父页作用域变量。
- ⚠️ **前端 `api()` 自带 `JSON.stringify`**，body 必须传对象（传字符串＝二次序列化 → 后端「规则必须是对象」）。
- 已有可复用图表：`components/rebate/MonthlyAchvChart.vue` + `useMonthlyAchv.js`。

## ⭐ 目标 / 达成口径一致性（2026-09-12 v150 修复，`72d9192`）
- **规则表是 `rebate_target_rules`**（`Server.DB: tenant_<id>.db`）；品牌目标 `period_type='year'`、`target_value`=**全年总额**，真实月度口径在 **`monthly_amounts`（JSON `{"01":600000,...}`）**；`monthly_rates` 覆盖当月返利率；`monthly_tiers` 覆盖当月阶梯。
- 🔴 **任何"目标 vs 月度达成"的同屏展示，分母必须取当月分解，不能取 `target_value`**。前端统一用 `useMonthlyAchv.monthTargetOf(rule, y, m)`（年度规则取 `monthly_amounts[MM]`，单期规则取 `target_value` 且只落在生效起始月；本月无分解 → **0，不臆测均分 → 该规则的该月不进排行/KPI**）。`buildYearMatrix` 与本函数同源，避免同屏两套目标。
- 🔴 **`simulate-batch` 必须逐条传 `ref_date`（= 该月月末 ISO，用 `monthEndISO(y,m)`）**。后端 `domain/rebate_period.monthly_view(rule, ym)` 才会把规则投影到「那个月那一格」；**缺 `ref_date` → 回退年度总额 + 顶层费率** → 年度规则恒不触发、返利恒 ¥0、10 月 15% 费率被顶层 10% 覆盖。（`/simulate` 单条接口自己会做投影，`/simulate-batch` **不会**，别以为两边一样。）
- 实测对照（tenant_1 真实规则 `蒙牛低温2026年目标`，9 月达成 323,776）：旧 `target_value` 8,684,000 → **3.7%**；新 `monthly_amounts["09"]` 674,000 → **48.0%**。12 个月分解合计 = 8,684,000 = 年度总额（**口径等价，无需动数据**）。
- 校验脚本：`.workbuddy/tools/rebate-month-target-verify.js`（生产真机：切月断言 `9月目标 ¥900,000` / `8月目标 ¥1,100,000` / 10 月无分解则整条不出现）。

## ⭐ 达成填报的「桶」口径 —— **v173 已收口为「一个月度桶」**（2026-09-15 实施，前端 `c92afa2` / 后端 `06ae645`）
- 🔴 **现状（唯一权威口径）**：`rebate_achievements.period_month` **只有一个合法形态 = `YYYY-MM`**。
  写入端三条路全部收口：① 页面只留「填报月份」（`type=month`）；② 接口显式传季/年键 → **422**（`_norm_month_strict`），
  Excel 导入逐行跳过并进 `errors`；③ 省略 `period_month` 仍回落当月（保留既有便利约定）。
  读取端 `rebate_calc.period_key_for()` **恒返月键**（原按 `period_type` 返 3 种键是 v125/v126 之前的遗留）。
  ⇒ **消费方矩阵从 3 行塌成 1 行**：月桶 `2026-09` → 4 个消费方（仪表盘全年月度 / 达成填报全年对比 / 预报页冲刺看板 / 返利合同计提）**全 ✅**。
- 规则自身的 `period_type`（月/季/年）**现在只决定「该月目标怎么取」**，与存储键无关：
  年度规则 → `monthly_amounts[MM]` 分解额（缺该月分解 → 该月目标为空，不臆测均分）；单期规则 → `effective_start` 所在月取整额。
  页面新增的「**周期**」列是**读数**（`ACHV_PERIOD_LABELS` = 月度/季度/年度/自定义 + `achvPeriodTip()` hover 说明取数逻辑与为空原因），**不是选项**。
- 🔴 **判据（已写进技能 `hergent-rebate-caliber-consistency`）**：判断一个选择器该不该存在，只问
  「用户选它是为了表达业务意图，还是为了让数据落进系统要的那个键？」后者 = 把实现细节变成用户负担 → 删掉，改读数。
- **历史（v173 之前的旧状态，供理解存量代码与告警）**：原「周期口径」下拉让用户自选抽屉，GET 是**精确等值**
  （`WHERE period_month=?`），三键 `2026-09` / `2026-Q3` / `2026` 互不相通，连「已填报 N 行」都只数当前抽屉；
  三个图表消费方全部硬编码月键（`useMonthlyAchv.js:109/134`、`Forecast.vue` 强制 `^\d{4}-\d{2}$`），
  季/年桶即便被返回也会在归集时**静默丢弃**；季/年桶唯一消费方是返利合同（全仓仅 3 处调用，都在合同上下文，
  无合同的租户 ⇒ 零消费方）。实测（沙箱 9997）注入季桶 ¥999,999 + 年桶 ¥888,888 → 图表达成合计 **Δ=¥0**。
- 🔴 **两个静默缺陷已在 v173 一并修好**（都**不报错**，是「用户会以为自己填错了」那类）：
  ① `ruleEffectiveInMonth('2026-09' > '2026')` 恒真 ⇒ 年口径下**任何带 `effective_start` 的规则都从表格消失**
  （简爱规则实测）→ 月份恒为 `YYYY-MM` 后比较恢复正确（2026-10 下正确消失、2026-09 正确出现）。
  ② `period_key_for` 返回 `'2026'` ⇒ 拿它查月键列**必然落空** → `_contract_year_achieved` **恒为 0 且不报错**；
  本地内存库实测修前 `('2026','brand','蒙牛低温')` → `None`，修后 = 324000 + 512000 = **836,000**。
- 验证：接口层 10 项（A–J，含 3 种非法键 422、省略回落当月）+ 真机 22/22 × 2 视口 ALL_GREEN + console 0 错误；
  生产桶分布复核 `TOTAL month=4 quarter=0 year=0 other=0`（**业务数据一行未改**）。交付说明见
  `outputs/周期口径方案A-2026-09-15/`。
- ⚠️ **`Rebate.vue` 的提交现实**：该页自 2026-09-13 起在途的 v156「月度目标口径 + 全年月度对比」块与本改动
  **hunk 级深度混合**（同一行 `<td>` 同时被本轮加「周期」列、被在途改名 `fmtAchvTarget`），故 v173 提交
  **整文件落地**，并在提交信息里如实标注；**该文件提交内容 == 线上内容（逐字节）**。

## 🔴 仪表盘审查（v185，2026-09-18，纯审查未改码）

> 该页 **09-12 已有一轮完整精简审查**（`outputs/目标与返利-仪表盘-精简审查报告-2026-09-12.md`，A–G 20+ 项），
> 绝大多数已由 **v154–v164** 落地。**同一页面被再次要求"精简"时，第一步必须读旧报告**，否则重提已落地项。

### 实测基线（1560 视口，线上）
卡片 **937px** ＝ 页头 40 ＋ KPI 100 ＋ **图表 562（占 60%）** ＋ 列表 138（1 行×104）；
文本节点 81 / 455 字，其中**说明性文案 10 条 / 148 字**；单行 **9 个数字组、4 个零值**。

### 🔴 一：页面主语缺失 —— 「实际返利仪表盘」没有实际返利 KPI
同屏 4 个返利数字，标签只差一个字，经销商分不清哪个是**到账**：

| 数字 | 来源 | 性质 |
|---|---|---|
| KPI「本月**预估**返利」 | `simulate-batch` 按**当前填报达成**试算 | 推算 |
| 列表「**预计**返利」 | 同上逐行 | 推算 |
| 图表「**实际**返利」柱（填充） | `rebate_achievements.actual_rebate` | **实际** |
| 图表灰轨道「预估应返」 | `simulate-batch` 按 **100% 目标** | 推算 |

**修法（零新接口）**：`achievements[].actual_rebate` 已在手（`/api/rebate-achievements?month=` 已按统计月份加载）。
🔴 **口径红线**：必须在「本月生效规则」集合内求和，与同页其余 KPI 同分母；
现成范式是达成填报侧 `buildAchvRows()` 的 `aRebate`（`Rebate.vue:1678`）⇒ **提到共用纯函数，别写第二份口径**。

### 🔴 二：图表「说明书三重重复」（v159–v164 拆图时新引入）
「柱高/灰轨道/深色段」在同一张图内说了 **3 遍**：
`mac-sub` 副标题（574px 常驻）＋ 图例①**逐字相同**（`灰轨道＝目标 / 预估应返`）＋
图例④同义（`深色段＝超出目标的部分`）＋ 两张图 `sec-note`（`柱高＝实际销量/实际返利金额`）。
⇒ 图表内说明 **5 条 → 2 条**（只留"两图量程各自独立、柱高不可跨图比较"＋绿红/虚线两条图例）。
⚠️ **改图表的"拆分/语义"时最易新引入这类冗余**，改完要数一遍"同一件事说了几次"。

### 三：零消费字段与死 CSS
- **写得有、没人读**：`buildYearMatrix().months[].byBrand`、返回的 `totals`（`applySimResults` 还专门回填
  `matrix.totals.rebateTarget`）、`summary.noData`、`items[].effectiveRate` / `.triggered`。
- **死 CSS**：`MonthlyAchvChart.vue` 的 `.mac-seg / .seg-btn / .seg-btn.on`（4 条，"达成率/金额"视图切换器已删）。
- ⚠️ `byBrand` / `totals` **不要删** —— 正是「品牌分解」「年度累计 YTD」的现成数据源 ⇒ **保留计算、补消费**。

### 四：列表行的两处语义问题
- **序号圈 `rr-rank`**：v151 已判定"不构成同质可排名集合"并改名「返利目标达成」，但序号仍在，
  且 `.rank-row.risk .rr-rank` 把它**染红** ⇒ 风险优先排序下"红色 1"＝**最危险**却像第一名；筛选后还会重排。
- **未达标行的「距目标」＝第三次表达**（目标 − 已填报，两操作数就在左边紧邻）。
  ⚠️ 只删 `gapLabel==='距目标'`；v154 G5 换出的「超出 ¥X」**必须保留**。

### 五：控件面的两个缺口
- **品牌筛选候选集** `chartBrandList` 取 `/api/brands?include_inactive=1` **全部档案**（含已停用）∪ 规则品牌
  ⇒ 选中本期无目标的品牌 → 图表/列表全空而 KPI 不变，用户以为页面坏了。
- **跨页链接丢上下文**：`goSprint()` 只做 `location.hash='#/forecast'`，不带正在生效的品牌筛选
  ⇒ 预报页看到的是全品牌口径，与刚筛的对不上。

### 六：两个遗留未做
- **E5 口径免责声明已从 UI 消失**：09-12 结论是「**保留**、只挪到 KPI 旁」，但现在 `grep 非实际到账` = **0**。
  填充柱换成"实际返利"后该声明对填充柱不再必要，但**对灰轨道与 KPI 的推算值仍然必要**。
- **G9 序号列**当时标"可选项"，至今仍在（见四）。

### 七：09-12 那轮已落地、勿重提
副标题 3 分句→1 句、删「单月视图/全年视图」双徽标、品牌筛选提到页头（删 KPI 作用域说明）、
时间进度并入 KPI 行（删 44px 琥珀横幅）、异常区收窄为只报「列表看不出来的」（现仅规则重复 1 类）、
判语降级为 chip（行高 148→**104**）、页脚三条脚注合一条、图例 note 长句拆解归属、达成率统一加权口径。

## ⭐ v185 实施（2026-09-18 当天落地，commit `c6fa22a` + 归档 `e9ca5b9`）

**用户 5 条拍板 → 7 项落地**（编号与上一节审查的 R1–R7 对应）：

| 拍板 | 落地 | 关键判据 |
|---|---|---|
| ① 本月实际返利 = **本月全部填报** | hero 位换「本月实际返利」，口径 = `achievements[].actual_rebate` 合计 | **与「达成填报」页同源同字段**；零填报显示 `—` +「本月尚未填报」（**不是 ¥0**） |
| ② 「距目标」位 → **距下一档绝对金额** | `hasTiers ? '距下一档' : '距达标'`，值 = `fmtByType(nextTierBasis − reported, r.target_type)` | 🔴 **标签必须随 `trigger_mode` 自证** —— 生产 4 条规则（tenant_1 + tenant_10）**全 `on_target`**、`trigger_threshold` 全 1.0 ⇒ 无分档时写「距下一档」是假话 |
| ③ **保留 12 月 + 紧凑档切换** | 密度切换：柱高 200→132、刻度 5→3 段、画布 563→427px | 🔴 **不裁尾部空月**；持久化 `localStorage('hergent_achv_density')`；复用 v154 遗留的 `.mac-seg / .seg-btn` 死 CSS（原"有名无实"） |
| ④ 跨页带品牌 | `goSprint()` → `#/forecast?brand=<逗号分隔>`；Forecast 侧 watcher 承接 | 选中才带；**词表对不上静默降级**（不筛 / 不弹错）—— 品牌词表来自行底聚合，可能滞后于来源页 |
| ⑤ 口径免责声明接受现状 | 不补回 | — |

**R1–R4 一并落地**：删 4 条重复说明（副标题 574→252px、两条 `sec.note` 连 CSS 一起删、图例 4→3）｜
删序号圈 `.rr-rank` + 风险态变体｜删死字段 `dashboardModel.triggered` / `effectiveRate` / `summary.noData`
（⚠️ **保留** `simResult.triggered` 与 `accrueResult[].details[].triggered` —— **是另一个对象**）｜
`byBrand` / `totals` **保留计算待补消费**（是「品牌分解」「YTD」的现成数据源）。

### 🔴 本轮踩到的新判据（两条）

1. **`gone` 名单不能用「旧文案」当判据** —— 新写的注释里**故意**提到了旧名
   （`<!-- v185 R1：原 .sec-note「柱高＝实际销量…」已删 -->`、`/* v185 R2：.rr-rank 与它的风险态变体… */`）
   ⇒ 拿旧文案当 gone **必然误报**。改用**不被注释引用**的精确串：
   `<span class="sec-note">` / `sec.note` / `"note":`、`<span class="rr-rank">`（**不是** `.rr-rank`，注释里也写了）。
   **先 `grep -c` 验证为 0 再写进 spec。**
2. **跨页参数打桩必须同时覆盖「行底上游接口」** —— `brandCandidates` 来自 `cross.rows` 的 `rowBrand(r)`
   （行内值优先、`prodMeta[pid].brand` 兜底，v178），而 `prodMeta` 来自 `/api/products/grid`。
   只打桩 `summary` 时 `brandCandidates` 恒空 ⇒ 走静默降级分支 ⇒ **命中路假失败**。
   → 同时打桩 `/api/products/grid` + `/api/forecast-submissions/summary`。

**实测（本地 dev 直连真实后端 + 生产真机，逐项一致）**：
文本节点 81 / 455 → **83 / 421**（净减 34 字）；说明性文案 10 条 / 148 字 → **7 条 / 93 字**；
图表卡 563 → **427px**（紧凑档，−136，12 个月份全保留）；KPI 4 → **6 张**；图例 4 → **3**；
行内第 3 格 `距目标 ¥900,000` → **`距达标 ¥900,000`**；序号圈消失。
**跨页品牌 A/B/C/D 四路全绿**（打桩命中路 + 真实空数据降级路；演示租户无品牌目标，命中路只能打桩取证）。

### ⭐ v185 R7 补做（同日，commit `de41bd6`）—— 品牌筛选候选收窄为「本年度确有品牌目标」

**改前**：候选 = 「品牌档案全量（含已停用）∪ 规则里出现过的品牌名」⇒ 档案里那些**本年度
没有目标**的品牌被选中后，图表与「返利目标达成」列表全空、而顶部 KPI 照常显示
（KPI 口径是全部品牌合计）⇒ 用户以为页面坏了。

**改后判据**（与图表消费方 `buildYearMatrix:127-130` **逐字同源**）：
```
∃ m ∈ 1..12 使  achvRuleActiveInMonth(r, y, m) && monthTargetOf(r, y, m) > 0
```
⇒ **候选里出现的品牌，图表必然画得出至少一根柱** —— 用「同源」把「选中后整页空白」直接消掉。

**配套两件（都不可省）**：
1. **watch 剔除隐形筛选**：候选随「年份切换 / 规则增删」变化后，把已选中但已不在候选里的
   品牌剔掉 + toast。不剔会留下**看不见的筛选**（chip / 徽标都不显示它、图表却空着）——
   比原痛点更难排查。
2. **`emptyText` prop**（`BrandFilter.vue`）：区分「搜索无结果」（「没有匹配的品牌」）与
   「候选本身就是空」（「本年度暂无品牌目标」）—— 同一条文案会让后者看起来像搜索坏了。

#### 🔴 三条新判据（动手前必读）

1. **判据不得依赖「被筛选对象」** —— `buildYearMatrix` 的 `measure` / `kept` 随选中品牌变化
   （`inScope` 由 `selSet` 派生）⇒ 若候选依赖 measure，就成环「候选 → 选中 → measure → 候选」。
   **候选只许依赖 `rules` + `chartYear`。**
2. **同名函数遮蔽**：`Rebate.vue:2165` 已有一份本地 `ruleActiveInMonth(r, 'YYYY-MM')`
   （走本地时区 `new Date(y, m-1, 1)`），与 hook 版 `(r, year, m)`（走 `Date.UTC`）是**两份口径**。
   直接 `import { ruleActiveInMonth }` 会 `Identifier 'ruleActiveInMonth' has already been
   declared` **编译失败**；而改用它又会与图表错配 ⇒ **必须 import 起别名**（本轮用
   `achvRuleActiveInMonth`）。⚠️ 页内同一语义两份实现是**既有技术债**（本轮只登记未统一，
   统一会改动 `dashboardModel` 的口径）。
3. **「本年度」不看 `target_year`** —— 只看 `ruleActiveInMonth` 的 `effective_start/end`。
   年度规则若不填日期（tenant 10 的「测试品牌」：`period_type=year`、日期空、
   `monthly_amounts={'08','09'}`），则**任何年份**都算有目标 ⇒ 候选在所有年份都出现。
   **刻意不加 `target_year` 过滤**：加了会把这类规则整个滤掉、候选直接变空。
   ⚠️ 另：`scope_name` 为空的规则（tenant 10 的 id=1）没有品牌归属 ⇒ 判据里 `!nm` 跳过。

**实测（本地打桩五场景 + 生产真机两路）**：档案 3 个（A 有 2026 目标 / B 只有 2025 / C 无任何规则）
⇒ 2026 候选 = `['有目标品牌A']`（B / C 被收窄掉）；选中 A 后切到 2025 → 候选变 `['无目标品牌B']`
+ A 被剔除 + toast「已取消筛选：有目标品牌A（2025 年无品牌目标）」；规则全空 → 「本年度暂无品牌目标」。
生产打桩路**逐项复现**，真实数据路候选 = `['测试品牌']`（= tenant 10 唯一品牌规则）。

---

### 🔴 v186（2026-09-18）：生效期门禁的「唯一实现」与「有目标就必须画柱」

> ⚠️ 上面那条判据 2「页内同一语义两份实现是既有技术债（本轮只登记未统一）」
> **已被 v186 消除** —— 三份本地实现 + hook 版全部删掉，现在只有 **1 处实现**。照上面那条动手会踩空。

**症状 → 根因链（别停在渲染层）**
用户报「目标柱子不该被隐藏」。真因**不在渲染**，在**上游门禁**：
`tenant_1` 规则 id=10「蒙牛低温2026年目标」`period_type='year'`、`monthly_amounts` 12 个月全填
（868.4 万），但 `effective_start/end = 2026-09-01/09-30`。旧口径「覆盖月份 = 月度分解 ∩ 生效期」
⇒ 只剩 9 月：① 图表 11 个月目标柱整根不画（`barOf` 里 `hasTarget` 为假 ⇒ `trackH = 0`）；
② `covered_months()` 只认 9 月；③ 试算 `as_of_date` 不在生效期 ⇒ **返利恒 0**。
8 月已填报的达成 32.4 万 / 实际返利 13.1 万被整个系统丢弃。

**v186 口径（用户拍板）**
- 年度规则（带 `monthly_amounts`）的适用月份 = **月度分解本身**；`effective_start/end` 只表示
  「这条规则整体启用/停用的时间窗」，**不再逐月裁剪**。
- 单期规则（无分解）**仍**按生效期过滤。
- 颜色：灰色只表示「未生效 / 未填报」；**已生效但未达标仍用系列色 + 本月红绿**（不因 <100% 改灰）。

**唯一实现（改这一块前先看这里，别再造第 N 份）**

| 层 | 函数 | 粒度 |
|---|---|---|
| 后端 | `domain/rebate_period.covered_months(r)` | 规则覆盖的**月份集合**（判重/锁表依据） |
| 后端 | `domain/rebate_period.rule_covers_month(r, year, month_no)` | 月粒度门禁 |
| 后端 | `domain/rebate_period.rule_covers_date(r, as_of_date)` | 日粒度门禁（试算用） |
| 后端 | `erp_db._rule_active_in_month(rule, year, month_no)` | **仅保留函数名**，内部委托 `rule_covers_month` |
| 前端 | `useMonthlyAchv.ruleCoversMonth(rule, year, m)` | 与后端 `rule_covers_month` 同源 |
| 前端 | `useMonthlyAchv.ruleYear(rule)` | `target_year` > 生效期年份 > 当前年 |

消费方（全部已改）：`useMonthlyAchv.buildYearMatrix` · `Rebate.vue` 的 `chartYearOptions` /
`chartBrandList` / `buildAchvRows` / `dashBase` · `Forecast.vue` 的 `rebateSprint` ·
后端 `rebate_calc.compute_rebate_unified`（`as_of_date` 校验）/ `erp_db.accrue_rebate`。

**三条实现红线（都踩过）**
1. 🔴 **`monthly_view` 会回退顶层 `target_value`** ⇒ 把某月纳入却**没有**该月分解值时，后端会拿
   年度总额（868.4 万）当该月目标，该月**永不触发**。故谓词必须在前后端**都判「该月有分解键」**；
   没分解的 `period_type='year'` 才能退回按生效期展开。
2. 🔴 **`rule_covers_date` 的年份必须取自日期自身**（`s[:4]`），不能拿 `rule_year(r)` 拼 ——
   `covered_months` 内部已用规则自身年份，再用规则年份拼 ym = 「任何年份只要月份对上就放行」，
   而 `monthly_view` 只看月份数字 ⇒ 2027 年会被静默套上 2026 年的目标。
3. 🔴 **裸 `'YYYY-MM'` 必须走月粒度**：`'2026-08' < '2026-08-01'` 恒成立 ⇒ 单期规则的整个生效月
   被误判为「不在生效期」、返利静默为 0，而同路径上游门禁却说这个月适用（同屏自相矛盾）。

**图表侧的两行（「始终可见」+「灰色状态」）**
- `MonthlyAchvChart.vue`：`const MIN_TRACK_PX = 2`；
  `trackH = hasTarget ? Math.max(MIN_TRACK_PX, hAmt(target, max)) : 0` —— 有目标就至少 2px，
  不会被判成「没画」；`trackCount` 与 `tracksVisible` 在真机断言里必须**相等**。
- `.track { fill: #cbd5e1 }`（原 `var(--border-subtle, #e2e8f0)` 太浅、与背景几乎同色，
  灰色「状态」读不出来）。⚠️ 编译后是 `.track[data-v-704b3da6]`，生产核验就 grep 这个。

**验证资产（都在 `.workbuddy/tools/`，可复跑）**
- `rebate-rule-covers-month-check.mjs`：前后端口径一致性（8 组 / 40+ 条），与后端
  `tests/test_rebate_period_v186.py`（51 条断言）跑**同一组**输入。
- `rebate-chart-render-harness.py`：`dump → gen → probe → clean` 四步。只读导出真实租户数据，
  返利金额由**已部署的后端函数**算（前端不镜像算法），无头 Chromium 量 `rect.track` 根数/色值/高度。
  🔴 `clean` 必须执行 —— 生成的三份文件含租户数据，不能留在仓库。
- fixtures `tests/fixtures/rebate_cases.json` 新增 C22~C25（年度分解齐全但生效期只写 9 月 /
  该月无分解 / 单期裸年月在生效月内 / 在生效月外）。
- ⭐ **护栏写法**：用 `git show HEAD:` 导出**改动前**的 domain 跑同一份 fixtures，旧代码下
  C22/C24 返利须为 0（期望 95000 / 19500）—— 否则新用例只是同义反复。

---

## 🔴 「生效期」字段的**真实作用面**（2026-09-27 排查 → 当天 v292 实施完毕）

用户报：「目标填了 10 月，生效截止却填 9/30 —— 会不会挡掉 10 月？」以及
「生效截止改成 12/31 后，预报页**返利冲刺面板**的『返利周期截止』也变 12/31，剩余到货次数跟着变」。

### 一、生效期到底影响什么（分层，**别一概而论**）

| 规则形态 | 生效期的作用 | 依据 |
|---|---|---|
| **有月度分解**（年度目标，本租户 3 条全是）| 🔴 **完全无作用** —— 适用月份 = `monthly_amounts` 的键 | `covered_months()` 首个分支直接 `return`，**根本不读** `effective_*` |
| `period_type='year'` 但无分解 | **有作用**：12 个月按生效期展开 | 否则会把年度总额当每月目标 |
| 单期规则（无分解）| **有作用**：`month_in_range(ym, s, e)`；且 `effective_start` **决定目标落在哪个月** | `monthTargetOf`：单期额归位到 `effective_start` 所在月 |

⇒ **结论：对「年度 + 有分解」的规则，生效期只是个"启用/停用"标记，不裁剪任何月份。**
用户场景①（10 月目标 + 截止 9/30）⇒ **10 月的目标 / 达成 / 返利 / 排行 / 图表全部正常**，实测
`rule_covers_month(rule11, 2026, 10) = True`（规则 11 分解 = `['09','10']`，生效期却只写到 09-30）。
⚠️ **副作用**：用户以为"截止 9/30 就停用了 10 月" —— **这个字段做不到**；要停用只能改 `is_active`。

### 二、唯一被污染的消费点：冲刺面板把生效期当「返利周期截止」

`hergent-cn-v2/src/pages/Forecast.vue:9209-9216`：
```js
const rebateCampaignEnd = computed(() => {
  const rules = (rebateRules.value || []).filter(x => x.is_active !== 0 && x.effective_end)
  if (rules.length) return rules.map(r => String(r.effective_end)).sort().slice(-1)[0]  // ← 全局字符串 max
  const p = cross.value.period; return p && p.order_end ? p.order_end : null
})
```
**两个错**：① 取**全部**活跃规则的 max（不过滤 `ruleCoversMonth`、不过滤品牌）⇒ 别的品牌/别的月份的
生效期会把窗口拉长；② 语义上它根本不是"本月返利周期"。消费点三处全吃这个值：
`rebateSprintOrders`(9219) / 逐行 `orders`(9334 及 `countWeekdayArrivalsInWindow` 9329) / 文案(486)。

**生产实测（tenant_1，今天 2026-09-27，3 条规则生效期全 = 2026-09-30；冲刺月 = 期次19 到货月 = 2026-10）**：

| 口径 | 截止日 | 剩余天数 | 剩余到货次数 |
|---|---|---|---|
| ① 当前代码 `max(effective_end)` | 2026-09-30 | 4 | **2** |
| ② 用户改成 12-31 | 2026-12-31 | 96 | **48** |
| ③ **应有**：冲刺月(2026-10)月末 | 2026-10-31 | 35 | **18** |

⇒ 当前 **2 次** vs 应有 **18 次** ⇒ **均单建议被放大 9 倍**；改 12-31 则反向摊薄。**两个都错。**
⇒ 同屏自相矛盾：`sprintTimeProgress`(9369) 按**月**算时间进度，同比的"返利周期"却按**全局 max**。

### 三、正确口径（用户明确）：「返利按月算 ⇒ 周期截止 = 冲刺月的月末」

冲刺月 = `rebateSprintMonth`（v116 L1：期次的 `arrival_date` 优先，即**到货月**）⇒ 截止日 = 该月最后一天。
⚠️ 边界：冲刺月已过（补报场景）时 `daysLeft ≤ 0`，当前代码硬兜底 `return 1`
（`9224` / `9334` 都是 `: 1`）会**掩盖"到货窗口已关"**这一事实，应改成显式文案而非假装还有 1 次。

### 四、附带发现（同一次排查）

- 🔴 **`arrival_count_override`（「本月到货次数」，品牌维度，如蒙牛低温=15）在冲刺面板零消费**
  —— `Forecast.vue` 里出现 **0 次**；后端只在 CRUD/校验/`auto-period-preview` 用到。
  ⇒ 用户配的「本月 15 次」与面板显示的「剩余 N 次」是**两套互不相干的数**。
- 🔴 **兼容版试算仍按日粒度拦生效期**：`routers/rebate_rules.py:1984` 的
  `_effective_contains(...)` 在**不传 `rule_id`** 的旧契约路径上仍在跑；
  主契约（传 `rule_id`）已在 `2016` 行把生效期清空。前端只用传 `rule_id` 的 `/simulate-batch`，
  但**外部/脚本/旧前端**走旧契约时会重现「10 月试算恒 0」。

### 五、✅ v292 已实施（2026-09-27 当天落地，用户一句「全做」，四项全做）

| # | 改动 | 落点 | 关键实现 |
|---|---|---|---|
| P0-1 | 截止日 = 冲刺月月末 | `Forecast.vue` | 新增 `rebateSprintMonthEnd`：`new Date(y, m, 0)` 取月末。🔴 **禁 `toISOString()`**（那是 UTC ⇒ 月初/月末各差一天）；取不到冲刺月时兜底回 `cross.period.order_end` |
| P0-2 | 撤掉假兜底 | `Forecast.vue` | `rebateSprintOrders` 两处 `return 1` → `return 0`；并把 `windowClosed` **提到 `mode` 分支之前** —— 否则 weekday 分支 `Math.max(1, 0) = 1` 依旧是"还有 1 次" |
| P1 | 面板吃配置值 | `Forecast.vue` | `arrival_count_override` 从该文件 **0 次出现** → 真消费：`orders = min(ov, max(1, round(ov × daysLeft / daysInSprintMonth)))`，与 `arrival_schedule.arrival_summary` 的「override **覆盖整月次数**」语义同源；新增 `ovFromConfig` / `sprintOverrideNames`，摘要点名「**X 按你在「到货节奏」里配置的本月到货次数折算**」 |
| P2-1 | 文案正名 | `TargetFormModal.vue` / `Rebate.vue` / `rebate_rules.py::RULE_FIELD_LABELS` | 「生效开始/结束」→「**规则启用日 / 规则停用日**」，详情区标题「生效区间」→「**规则启停区间**」；加提示「这两个日期只管整条规则启停，**不决定它在哪几个月生效**；某月是否参与请看「月度分解」；要整条停用请改「启用」开关」 |
| P2-2 | 撤第二实现 | `rebate_rules.py:1984` | **删掉本地 `_effective_contains`**（v186 收敛时漏网的最后一处），换成同源 `rule_covers_date(rule, ref)` —— 注意它**只吃 dict**，旧路径的 `r` 是 sqlite Row ⇒ 必须**先 `_row_to_dict(r)`** 再判 |

**修后真实值**（期次 19「2026-09-27 报单期次」/ 到货月 2026-10 / 配置整月 15 次）：截止日 `2026-10-31`、表头剩 **18** 次、明细行 **15** 次（`整月 15 次（手动配置）`）。
**修前对照**：`2026-09-30` / **2** 次 / `2 天/次`（窗口只剩 4 天）。

**验证四层**：离线算式 34/34；P2-2 端到端 `FAIL=0`；真实输入新旧对照 12/12；夹带判据通过（53 vs 53 chunk，差异仅 `Forecast.js(+1299)/Rebate.js(+334)/index.js(+108)`）。
**线上核对（chunk 名判不了内容）**：入口 chunk 被并行会话改名（我构建的 `index-CsSaEYlO.js` → 线上 `index-DOMPut21.js`；`Forecast-BZXVdx8p` → `Forecast-Zoh5bmno`）⇒ **按 v282 判据只认特征串**：`Forecast-Zoh5bmno.js` 命中「本月到货窗口已结束 / 本期到货窗口已结束 / 手动配置 / 整月 / 剩余缺口无法再靠报单追补」，`Rebate-_xS-ofby.js` 命中「规则启停区间 / 规则启用日×2 / 规则停用日×2」且**旧文案「生效区间」= 0**，TargetFormModal 4 句提示全内联在 Rebate chunk ⇒ 判定「线上 == 我的版本，**不重部署**」。后端 md5 双侧一致 `aed811ccc1ab82be345b41e7017d67ad`，`_effective_contains` 只剩注释。

### 六、✅ 同域第二处缺陷 —— **v293 当天已修完**（用户回「1.需要；2.要」= 修法 A + 修法 B 都做）

**症状**：主管（supervisor）能进「预报订货管理」页面，但页面里的**返利冲刺看板恒空**，且**零提示**。

**机制 = 页面可见性名单 ≠ 页面内数据接口的模块权限**：

| 环节 | 判据 | supervisor 是否满足 |
|---|---|---|
| 能否进 `/forecast` | `constants/pages.js` → `FORECAST_SUMMARY_ROLES = ['admin','boss','supervisor']` | ✅ |
| 能否读 `/api/rebate-rules` | 该接口映射到 **`sales` 模块** | ❌ `403 MODULE_DENIED module=sales` |

supervisor 的实际模块授权（**租户库覆盖优先于 `_DEFAULT_PERMS`**）：`tenant_1.db::role_permissions` id=2 = `["data","dashboard","chat"]`；主库 `erp.db` 同角色 = `["data","dashboard"]` —— **两处都没有 `sales`**。

- **修法 A（业务拍板）**：给 supervisor 授 `sales`。🔴 必须**同时改两处**（`core.py::_DEFAULT_PERMS` **和** `tenant_1.db::role_permissions` 覆盖行）；只改 `_DEFAULT_PERMS` 对 tenant_1 **无效**（注释已写明「supervisor / 库管 有自定义覆盖」）。
- **修法 B（应做，与 A 无关）**：`Forecast.vue::loadRebateRules` 现为 `catch (e) { rebateRules.value = [] }` —— **静默吞 403**，用户只看到空面板，无从知道是被权限挡了。必须区分「本来就没有规则」与「没权限看」并显式提示（R8 纪律）。

#### ✅ v293 实施结果（2026-09-27，用户答「1.需要 2.要」）

| 项 | 落点 | 关键实现 |
|---|---|---|
| A-1 | `server/core.py::_DEFAULT_PERMS["supervisor"]` | 加 `sales`（原 15 行注释扩写，说明「缺 sales 的后果不是少入口，而是页面进得去、数据恒空、零报错」） |
| A-2 | `erp.db` + `tenant_1.db::role_permissions` | `supervisor` 行 `json.loads` → `append('sales')` → 复读自证。tenant_1 实际值 `["data","dashboard","chat","sales"]`（**这才是 tenant_1 生效的那份**）；`tenant_10.db` 演示租户**只盘点不改** |
| B-1 | `Forecast.vue` 新增 `rebateRulesErr` | `catch` 里按 `e.status === 403` 分流：403 → 「你的角色没有查看返利规则的权限，需要管理员在「设置 › 权限」里为该角色勾上「销售」模块」；其余 → 「返利规则读取失败：+ message」（超时/5xx 各自说清） |
| B-2 | `Forecast.vue` **常显行** | `.sprint-banner` 复用（零新增 CSS），位置在 `v-show="rebateSprintOpen"` 的 `.panel-body` **之前** ⇒ **折叠状态也可见**（否则用户看到"有标题没内容"的空卡片，与静默失效无异） |
| B-3 | `Forecast.vue` 展开态**空态分叉** | `v-else-if="rebateRulesErr"` 单列一条；`v-else` 保留原「尚未配置品牌/商品返利目标」。🔴 **403 绝不能复用那条空态** —— 那会让主管以为是自己没配目标，是把用户往错方向引 |

**实证**：`mptestsp` 的 `GET /api/rebate-rules` **403 `MODULE_DENIED module=sales` → 200 真实规则**；线上回读 v293 四条新文案各命中 1，v292 四条回归文案保留；线上 Forecast chunk 字节 = 本地 **386470 完全相同**；真机 **PASS=14 FAIL=0**（详见下）。
**备份可回滚**：`/opt/hergent-erp/backups/v293-erp.db.20260927-153653.bak`（17MB）、`v293-tenant_1.db.20260927-153653.bak`（31.6MB）。

🔴 **交付纪律（本轮实证有效）**：`core.py` 改前先 `diff` 生产 vs 本地 —— 确认**只差我这 18 行**（无他人未集成改动）才敢 scp；否则 scp 会**回退别人的在途功能**。改共享文件前先 `cp` 备份 + 记字节数。

**判别力备忘（下次别再白跑）**：提审双账号各占一半 —— `mptestsp`(supervisor) 看得到页面、v293 前接口 403；`mptest`(sales) 接口 200 但被路由守卫弹回 `#/workbench`（侧栏无「预报订货管理」）。v293 后 `mptestsp` **首次能跑完整看板真机验收**（#542 随之闭环）。

#### 🔴 真机探针的判别力自证（v292 探针缺陷，v293 修正）

v292 探针 `v292-sprint-caliber-e2e.mjs` 曾报 **FAIL=1**：「与到货月月末一致（2026-10-31）→ 实际 2026-09-30」。
**根因是探针的错，不是产品的错**：它把「接口返回的**首个**期次（id 19，到货月 2026-10）」当成「页面**正在看**的期次」，而页面 `curPeriod` 指向**期次 17**（到货月 2026-09-23）⇒ 页面算 09-30，探针拿 10-31 去比。
**更深的教训**：即使选中期次 19，若「到货月月末」**恰好等于**「规则停用日」，该场景对新旧口径也**无判别力**。本次选 17 反而安全纯属巧合。

⇒ v293 另写 `tools/v293-sprint-discriminating-e2e.mjs`，两条硬纪律：
1. **主动切期次**（驱动 `select.sel-period` 的 change 事件，等价用户手选），不再依赖"接口首个 = 页面选中"。
2. **先自证判别力再断言**：`discriminating = tEnd && tEnd !== OLD_STALE_END`（月末 ≠ 旧口径错值 `2026-09-30`）；不满足则**抛错退出，不硬凑 PASS**。

实测：期次 19 到货月 2026-10 → 月末 `2026-10-31` ≠ 旧值 `2026-09-30` ⇒ 有判别力 → 截止日 `2026-10-31`、剩次 18（独立复算一致）、明细「整月 15 次（手动配置）」、无权限提示、控制台 0 错误 = **PASS=14 FAIL=0**。



### 为什么需要它

**到货节奏只能存在 `rebate_target_rules` 表里** ⇒ 想给某品牌配节奏，就**必须建一条「规则」**。
但原校验「目标值必须大于 0」＋「比例返利率须在 (0,1]」把这条路封死
⇒ **逼用户编一个假目标**（污染返利 / 达成 / KPI）。v282 为它开了**正门**。

### 唯一判定实现

`routers/rebate_rules.py::_row_rhythm_only(row)`（**定义在 `validate_rule` 之前**，入参是规则 dict）：

```python
# 目标为 0、且没有月度分解；同时**至少有一项节奏配置**（报单或到货，日期/周期/星期几任一）
def _row_rhythm_only(row):
    if not isinstance(row, dict):
        return False
    try:
        tv = float(row.get("target_value") or 0)
    except (TypeError, ValueError):
        tv = 0.0
    if tv > 0 or _parse_monthly(row.get("monthly_amounts")):
        return False

    def _n(k):
        try:
            return int(row.get(k) or 0)
        except (TypeError, ValueError):
            return 0

    return (bool(str(row.get("order_first_date") or "").strip())
            or _n("order_cadence_days") > 0
            or bool(str(row.get("order_weekdays") or "").strip())
            or _n("arrival_cadence_days") > 0
            or bool(str(row.get("arrival_weekdays") or "").strip()))
```

**三处同时放行**：

| 位置 | 行为 | 备注 |
|---|---|---|
| `validate_rule` | 目标 0 / 返利率 0 **放行** | ⚠️ `if` 判据仍用 `_has_rhythm`，**刻意保留**原「目标 0 ＋ 无节奏」的报错文案 |
| `detect_conflicts` | **跳过节奏规则**（判重两侧都跳）| 得给 SQL **补上节奏列**，否则读不到判定依据 |
| `sync_month_lock` | **不占任何月份锁** | 见下 |

### 🔴 为什么「不占月」是铁律

年度规则若**没有月度分解**，`covered_months(rule)` 算的是 **12 个月（整年）**。
一旦参与占锁 ⇒ **把该品牌整年锁死** ⇒ 用户以后建**真实返利目标**会被 **409** 打回。

### 为什么 `target_value=0` 是安全的

`domain/rebate_calc.py:257`：
`ach = (basis / target) if target and target > 0 else None`
⇒ 达成率 `None`、**不除零**、`rebate_amount = 0`、不触发任何返利。
生产实测 `simulate` 返回 `"note": "无目标值，无法计算达成率"`。

### 单测护栏（不许被放松）

`tests/test_rhythm_only_rule_v282.py` **17/17**，必须**同时**证明两件事：

- 节奏规则占 **0** 个月份锁 ✓
- **普通目标规则照常判重** ✓、**照常占 12 个月份锁** ✓（判重/占锁**没被放松**）

E 段用 `sqlite3 :memory:` 建 `rebate_target_rules` ＋ `rebate_rule_month_lock` **真表**，
调**真实函数**（不是替身）。生产实测：`rebate_rule_month_lock` 写前 **13** → 写后 **13**（新规则占 **0**）。

### 生产实例：规则 id=11「蒙牛鲜奶到货节奏（同蒙牛低温）」

逐字段照抄 `蒙牛低温`(id=10)：`order_first_date='2026-08-28'` / `order_cadence_days=2` /
`order_lead_days=4` / `order_max_early_days=1` / `arrival_mode='interval'` /
`arrival_cadence_days=2` / `arrival_first_dom=1` / `arrival_count_override=15`
＋ `target_value=0` / `rebate_rate=0` / `is_active=1`。

🔴 **`auto_period_enabled` 必须为 0** —— `scheduler._check_auto_period` 只把**第一条**开着的规则当
`carrier`（参与排程的集合 = 所有有 `order_first_date` 的规则 ＋ carrier 兜底），
设 1 会与「蒙牛低温」**抢排程归属**、期次日期变得不确定。

**A/B 对照（`排程A-B对照.py`，5/5）**：加规则前后自动开表排程**期次日期逐条不变**
（去掉显示层 `brands` / `brand_detail` 后 JSON **全等**；`main_brand` 仍是 `蒙牛低温`；`missed` 为空）。
唯一差异 = 每条期次的 `brands` 多一个 `蒙牛鲜奶`，其 `(early_days, arrival_date)` 与 `蒙牛低温` **逐字相同**。

### 业务后果（这才是建它的目的）

到货规则是**均单提示「三件套」的第 ③ 条**（① 本月有目标 ② 有大单位换算 ③ 品牌有到货规则）。
建完这条后，`蒙牛鲜奶` 的 **37 个商品**（本期清单内 **27 个**）的均单提示**第一次真正可显示**。
实测 `avg-target?period_id=19&product_ids=1596,...`：
`蒙牛鲜奶 reason='' effective_count=15 remaining=2` ⇒ `1596` 的
`no_target` / `no_convert` / `no_rule` / `no_dates` **四类 flag 全清**。

---

## 🔴 v360（2026-10-01）：比例返利**允许填 0** —— 「区分『空』与『0』」是动手前提

**用户诉求**：目标与返利模块创建品牌目标 / 商品目标时，返利框填 `0`（含 `0.00`）应能保存，
表达「**当月确实没有返利**」；空值 / 负数 / 非数字的拦截**保持不变**。

### 一、🔴 难点不是「改边界」，而是「区分三者」

```
_coerce_num('')    → 0
_coerce_num('abc') → 0     ← 三者完全同形
float('0')         → 0
```

⇒ 只把 `0 <` 放宽成 `0 <=`，会**同时放行空值与非数字**（用户明确要求这两者继续拦）
⇒ 判据必须**两段式**：先判「**是不是显式给出的数字**」，再判「在不在 `[0,1]`」。

**新增 `_is_num_like(v)`（`server/routers/rebate_rules.py`，紧跟 `_coerce_num` 之后）**
```python
def _is_num_like(v):
    if v is None or isinstance(v, bool):
        return False          # 🔴 bool 是 int 子类 ⇒ float(True)=1，不显式挡会被当合法 100% 放行
    if isinstance(v, (int, float)):
        return True
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return False      # 空串 / 纯空白 ⇒ False
        try:
            float(s); return True
        except ValueError:
            return False
    return False
```
实测取值：`0` / `0.0` / `'0'` / `'0.00'` / `-0.1` / `1` ⇒ **True**；
`''` / `'   '` / `None` / `'abc'` / `True` / `False` / dict / list ⇒ **False**。
🔴 **负数是数字**（返回 True）⇒ 落在**范围**那一段 ⇒ 仍然被拦 —— 这正是「负数校验不变」的实现方式。

**判据本体（原一行 → 两段式）**
```python
if rebate_basis == "rate" and not _has_mr and not rhythm_only:
    if not _is_num_like(r.get("rebate_rate")):
        errors.append("比例返利(rebate_rate)必须是数字（本月确实没有返利请填 0，不要留空或填非数字）")
    elif not (0 <= rebate_rate <= 1):
        errors.append("比例返利(rebate_rate)须在 [0,1] 之间(如 0.03=3%；填 0 = 本月无返利)")
```

### 二、三处同病（本轮一并收敛）

| # | 位置 | 症状 |
|---|---|---|
| ① | `hergent-cn-v2/src/components/rebate/useRebateTargetForm.js` 月表过滤 | `Number(r.ratePct) > 0` 把用户填的 0 当「没填」**丢掉** |
| ② | `server/routers/rebate_rules.py` `validate_rule` | `not (0 < rebate_rate <= 1)` 判 0 非法（且**分不清空与 0**） |
| ③ | `hergent-cn-v2/src/pages/Rebate.vue` 两处展示 | truthy 判定把**已合法保存的 0** 显示成「—」（看起来像"没填"） |

### 三、🔴 ① 才是真金白银的那条 —— `resolve_month_rate` 的「向前找」陷阱

`monthly_rates` = `{}`（9 月被丢掉）⇒ `resolve_month_rate` 取 9 月返利率时会
**向前回绕找最近有值的月**（既有语义）⇒ **把 10 月的 10% 静默套到 9 月**，
**凭空多出返利、且零报错**。比「填 0 存不了」贵得多。

**修法**（两行过滤条件**故意不对称**，注释里写明「别顺手统一」）：
```js
// 金额：金额 0 万元 = 该月没有目标 = 留空 ⇒ 0 绝不能落库 ⇒ truthy 是对的
if (r.amtWan != null && Number(r.amtWan) > 0) monthlyAmounts[r.mm] = Math.round(Number(r.amtWan) * 10000)
// 返利率：0 = 有效业务事实（该月无返利）⇒ 显式给出的数字一律落库
if (r.ratePct != null && r.ratePct !== '' && !isNaN(Number(r.ratePct))) {
  monthlyRates[r.mm] = Math.round(Number(r.ratePct) * 1000) / 100000
}
```
🔴 **`ratePct` 单位是「百分数」**（界面框「返利率（%）」placeholder「如 10」= 10%）
⇒ 换算 `Math.round(pct * 1000) / 100000`，`10 ⇒ 0.1`。
**写成 `0.1` 表示的是 0.1% ⇒ `0.001`**（本轮护栏踩过这个坑，是护栏自己写错、不是代码错）。

### 四、🔴 「空值」这条判据**只能落在前端**

后端分不清「空」与「0」（经 `_coerce_num` 完全同形）⇒ 前端补：

1. `defaultForm().rebate_rate` 初值 `0` ⇒ **`''`**
   （否则用户什么都不动、初值 0 也会被当成"填了 0"）。
2. `TargetFormModal.vue` `save()`：
```js
if (f.trigger_mode === 'on_target' && f.rebate_basis === 'rate') {
  const _rr = f.rebate_rate
  const _rrBlank = (_rr === '' || _rr == null)
  if (!monthlyOn.value && (_rrBlank || isNaN(Number(_rr)))) {
    toast('请填写返利值 —— 本月确实没有返利请填 0，不要留空', 'error'); return
  }
  if (!_rrBlank && (Number(_rr) < 0 || Number(_rr) > 1)) {
    toast('返利比例须 0~1（如 0.02 = 2%；填 0 = 本月无返利）', 'error'); return
  }
}
```
🔴 必须有 `!monthlyOn.value` 守卫 —— 月度分解下 `f.rebate_rate` 是「**最早非零月**」的
投影值（`rebate_rules.py` 约 1127-1131 行兜底逻辑），在那里判空会**误报**。

### 五、月份锁：**只认 `monthly_amounts`**

`covered_months()` 有 `amounts` 就**只按它的键**展开 ⇒ 只填了返利率的月**不占锁**，
`monthly_rates` 里放 0 **不会白占月份、挡别的规则**。
反过来，金额侧的 `> 0` 过滤**必须保留**（金额 0 万元 = 该月没有目标 = 留空）。

### 六、刻意未动（**观察项 O**）

- `fixed` 模式 `rebate_amount = 0` **仍拦**（固定金额 0 存不进库）。用户没提，**不动**。
- `rhythm_only`（只配节奏不设目标，见上文 §v282）路径不动。
- **返利试算侧零改动**：`domain/rebate_calc.py` 早有
  `if basis <= 0 or rate <= 0: return 0.0, False` ⇒ 不除零、不产生返利。**无需改**。

### 七、连带确认的既有契约

`update_rule` **先 merge 现有行**（白名单逐字段覆盖 `merged = dict(existing)`）
⇒ `Rebate.vue` 的**局部更新** `update(r.id, { is_active })` **不会被新判据误伤**（已实测钉住）。

### 八、验收读数（四层）

- **护栏 39 条全绿**（`server/tools/v360-rebate-zero-harness.py`）：
  A 0 放行 · B 仍拦 · C 月度语义 · D 兼容 · E **真跑前端函数** · F 坏法对照。
  🔴 **E 组价值**：`useRebateTargetForm.js` 是**零依赖纯 ESM**（文件头写明「可在 node 下直接跑单测」）
  ⇒ 用 `node --input-type=module` **直接 import 前端函数**，比源码字符串钉强得多。
- **真机端点**：`POST /api/rebate-rules/validate`（`rebate_rules.py:1968`，**仅校验不落库**，零写入入口）
  `0` / `0.0` / `'0'` / `'0.00'` 全放行；`''` / `'abc'` / `-0.1` / `1.5` 全被拦，
  且报错文案分别落在「必须是数字」与「须在 [0,1]」**两段**。
- **构建归因**：56 对 asset 全配对，**54 个归一化后逐字节相同**，只有
  `Rebate-*.js +271 B` / `Rebate-*.css +0 B` 真变（后者是 Vue scoped CSS 的 scopeId 随内容变）⇒ **零夹带**。
- **界面端到端 18 通过 / 0 失败**：真实写库 + `DELETE ...?hard=1` 硬删除自清理
  ⇒ 生产规则数 **3 → 4 → 5 → 3** 自证零残留。

### 九、🔴 两条「假绿」教训（探针纪律，跨域通用）

1. **`closed === false` 在「弹窗**从未打开**」时也成立** ⇒ 把"从没打开"误判成"创建成功后关闭"。
   ⇒ 纪律：**凡是「某事之后状态应为 X」的断言，都必须先证明「某事之前状态不是 X」**。
2. **探针漏传参数** ⇒ 4 条对照全用默认值 `rebate_rate=0` 在跑 ⇒ 全部报"无错误"（假绿）。
   ⇒ 纪律：**对照组必须至少有一条报错，否则先怀疑参数没传进去**。

### 十、业务测试用「空闲品牌」

生产 `tenant_1` 4 个品牌里**只有「新希望」2026 年无任何目标**
（`蒙牛低温` 12 个月全占、`蒙牛鲜奶` / `简爱` 各占 9/10）
⇒ 测试**必须换品牌或换年份**，否则撞月份锁 409。

### 十一、上线记录

- 后端 `hergent-erp` commit **`15825fc`**（2 files / +401 −2，含护栏）
- 前端 `hergent-cn-v2` commit **`e01dea5`**（3 files / +49 −5）
- 生产入口 `index-1ZfsDoC9.js`；assets **2456 → 2486（+30，与差集精确吻合）**；
  线上 `index.html` md5 双侧全等；备份 `/root/backup/v360/`
- 生产现状取证（改动前）：`tenant_1.rebate_target_rules` 共 **3 条**
  （全 `brand` + `rate`），**0 条含 `monthly_rates=0`**、**0 条** `rebate_rate=0 且有目标值`、
  `fixed` 模式 **0 条** ⇒ **缺陷今天还看不出，用户正要开始用**（这也是本轮值得修的原因）。

## 🔴 v364（2026-10-02）：到货节奏**按月停单** —— 「本月到货次数」不再是规则上的永久标量

### 业务公理（老板确认，改到货算法前先读这一段）

1. **节奏配一次就无限延续**：跨月不重置；**停单也不改节奏** —— 停单只是「这一次不进货」，
   下一个到货日照旧（10-05 停一单，下一次仍是 **10-07**）。
2. **手动调整只保留到本月**，下个月自动以系统推算为准。
3. 停单同时改变「到货次数」与「均单分母」，且**日历与次数必须同口径**。

⇒ 因此停单**必须按月存**，绝不能是规则上的一个标量。旧实现
`rebate_target_rules.arrival_count_override` 正是永久列，两处错：
- 10 月填的次数会一路生效到 11/12 月（生产实测：蒙牛鲜奶长期填 16，而 11 月系统推算只有 15
  ⇒ **均单分母偏大、均单偏小**）；
- 只有「几次」、没有「哪一天」⇒ **「停一单」无处表达**；而到货日历仍按含停单日的排程算
  ⇒ **日历 / 次数 / 均单分母三处口径互不相同**（同屏两把尺子）。

### 数据模型

```
rebate_arrival_skips(id, rule_id, ym, skip_dates, count_override, updated_at, updated_by)
唯一索引 ux_rebate_arrival_skip(rule_id, ym)
```

- **存「停单日」而不是「少几次」**：只有日期级信息才能让三处同口径。
- `count_override` 只为承接存量迁移（旧值没有日期，凭空编一个"被停的日子"= 造假数据）。
- 🔴 **为什么按 `ym` 存就等于「下月自动以系统推算为准」**：记录自带 ym，查下个月自然查不到
  ⇒ **不需要任何"月初重置"动作**。**数据模型自带的性质 > 定时任务**（后者会漏跑、要监控）。

### 引擎口径（`domain/arrival_schedule.py`）

```
arrival_summary(rule, year, month, skips=None)
  ├ order_first_date 存在 → source='order'（绝对日期锚点，跨月连续；跨年也对）
  └ 否则               → source='arrival'（旧『月内日』锚点，**每月重置 ⇒ 跨月会错位 1 天**）
                                         例：10-31 的下一次会算成 11-01，应为 11-02
  count        = 系统日历 − 当月停单日
  system_count = 未剔停单的系统推算
  effective_count = 显式次数 else count        ← **均单分母**
  count_source / count_mismatch：显式次数与日历不一致时**两个都不静默取**，显式回传
```

🔴 **`count_mismatch` 的处理纪律**：不一致时保留显式次数作为分母（尊重用户配置），
但必须回传冲突让**界面当面告警**并给一键「按日历对齐」。
**不要自动选一个** —— 那是静默丢弃其中一个输入。

### 接口

| 接口 | 说明 |
|---|---|
| `GET /api/rebate-rules/{id}/arrival-skips?year&month` | 该月到货安排；**含 `skip_dates_stored`（库里原样那串）** |
| `PUT /api/rebate-rules/{id}/arrival-skips` | **只写这一个月**；`count_override` **未传 = 不动**（哨兵） |
| `DELETE /api/rebate-rules/{id}/arrival-skips` | 删该月记录 ⇒ 立刻恢复系统推算；**其它月不受影响** |
| `GET /api/rebate-rules?arrival_ym=YYYY-MM` | 随每条 brand 规则带回 `arrival_month`（**冲刺看板专用**） |

🔴 **`skip_dates_stored` 不能拿 `summary.skipped` 代替**：后者只保留「确实落在**当前**系统日历里」
的日期；越月的、或用户后来改了报单周期导致已不存在的那些会被剔到 `skip_not_in_schedule`
⇒ 前端再存一次就**把它们悄悄抹掉**（用户会看到自己停的那天凭空消失）。

🔴 **`arrival_ym` 必须由调用方传"它自己那个月"**：`arrival_month` 缺省按**今天所在月**算。
10 月里打开 11 月的看板，若用今天所在月回答 ⇒ 把 10 月的 16 次当成 11 月的。
前端保留 `am.ym === sprintMonth` 护栏：宁可退回按周期估算，也不拿别个月的次数冒充本月。

### 迁移（`erp_db.py`，import 期执行）

旧永久列 → 当月一条 `count_override` 记录（`updated_by='v364-migrate'`）→ **清空旧列**。
生产实测回执：`tenant_1: 永久「本月到货次数」→ 单月记录 2026-10，共 3 条 [(9,8),(10,15),(11,16)]`。
**天然幂等**（迁完列即 NULL ⇒ 条件不再成立；二次启动不重复插入，断言 B7）。
⚠️ 迁移会改用户已配值的**口径**（永久 → 只对当月），故记 **WARNING** 不静默。

### 三处「同口径」的落点（缺一即两把尺子）

1. 配置面板 ② 区：**系统推算 / 本月实到 / 均单** 三数字 + 出货日 chips（次数由日历数出来）；
2. 商品目标页 `product_targets.py::_arrival_ctx` 的「剩余期次」= 该月到货日历里报单窗口未关的个数；
3. 冲刺看板 `Forecast.vue` 的「剩余到货次数」= `arrival_month.effective_count` 折算。

### 现网真实配置（tenant_1，可在侦察时直接对照）

| 规则 | 品牌 | 报单锚 | cadence | lead | 迁移来的当月次数 |
|---|---|---|---|---|---|
| 9 | 简爱 | 空（走旧到货排程 weekday 2,5） | — | 4 | 8 |
| 10 | 蒙牛低温 | `2026-08-28` | 2 | 4 | 15（vs 日历 16 ⇒ 告警） |
| 11 | 蒙牛鲜奶 | `2026-08-28` | 2 | 4 | 16（= 日历 ⇒ 无告警） |

系统推算（cadence=2）：09 月 15 / **10 月 16**（10-01→10-31）/ 11 月 15（**11-02**→11-30）/ 12 月 15。

---

## §v365 停单 ⇒ 该期次不再自动新建（2026-10-02，承接 §v364）

**一句话**：`rebate_arrival_skips.skip_dates` 里那一天，若正是某期次的 `arrival_date`，
那一期**不再被自动建出来** —— 货不来，建出期次 = 让业务员白报一轮单。
（§v364 只做到「停单影响 到货次数 / 均单分母 / 到货日历」，本轮补上**期次编排**这一层。）

### 三条硬约束（改这块之前先读）

1. **「到货日」等值比较，不是「同月」** —— 判据是 `期次.arrival_date == 停单日`。
   为什么不能用月份：`arrival_date = 报单日 + 基准品牌 order_lead_days`，
   到货 **10-05** 的期次报单窗口在 **9 月底**（生产实证期次#22：`order_start=2026-09-30 /
   order_end=2026-10-01`）。顺带一个好处：每条停单记录**自带 `ym`**（= 到货日所属月），
   而每个到货日全局唯一 ⇒ §v364 那条「只保留到本月」的公理在这里**自动成立**，
   不需要任何月份运算。
2. **判定必须写在 `build_period_plan` 里** —— 它是**预览与调度器的唯一共享实现**。
   写到别处（或让前端自己推）必然分叉出「预览说会建、实际不建」。
3. **排除 = 全停才排除**（`excluded = 有命中 and 非部分`）—— 代价不对称：
   漏建一整期 = 报不了单且要手工补救；多建一期 = 用户手动关掉即可。取保守侧，
   但**部分品牌停时必须把冲突报出来**（`exclude_partial`），不静默。

### 界面层（「不静默」是硬要求）

被排除的期次**仍留在 `periods` 里**带 `excluded=True`（不是消失），
`/api/forecast/auto-period` 返回顶层 `excluded_count`；报单自动化预览里该行**划线** +
挂「不到货 · 不会建」标记 + 顶部一条说明条。

### 回执的三条语义（v365 修掉的三个缺陷，全是「界面与事实相反」类）

| 缺陷 | 现象 | 修法 |
|---|---|---|
| 按**取消前**算 | 取消停单时结论**反过来**（界面说"不再自动新建"，事实是照建） | `restore` 走 `_cur - set(days)`，**按改动之后**算结论 |
| 只看「被打中」 | 「被打中的期次」≠「被排除的期次」 | 回执元素必须带**最终** `excluded` |
| 不叠加他品牌 | 只注入 `{rid: days}` ⇒ 永远是"部分品牌停" ⇒ 结论恒为「照建」 | 先读库里**全量**停单日再算 |

另：PUT 写的是**本月全量** ⇒ 必须用 `prev_days`「先摘本月旧值、再并新值」，
否则会抹掉该规则其它月份的停单日。
⚠️ 界面上的「取消停单」走的是 **`PUT + skip_dates=''`**（不是 DELETE）——
此时该月记录被删、`skip_dates_stored` 为空，若还按 `effect=skip` 算会直接 return「无影响」
⇒ 把「恢复自动新建」**整个瞒掉**。清空分支必须走 `restore` 语义。

### 边界（本轮明确不做）

- **手动建表不受影响** —— 停单只干预自动编排。
- **已存在的期次不删不关** —— 只阻止新建（是否给「一键作废」待拍板）。
- **部分品牌停 ⇒ 照建**（保守侧，可解释）。

### §v368（2026-10-02，老板拍板**推翻**上面最后两条）

**① 任一品牌停 ⇒ 整期不建**（`_apply_period_exclusions`：`excluded = bool(hit)`）。
🔴 保守侧**换边**了 —— v365 取「全停才排除」的理由是"漏建一整期要手工补救、多建一期无害"，
老板反过来判：**多建一期才是真麻烦**（业务员照着它白报一轮单，货不来），而少建一期有
「手动建表」与「一键作废」两条兜底。
⇒ `exclude_partial`（那天照常到货的品牌）**不再影响结论**，但**必须保留**：它交代
"谁其实有货、跟着一起不建"。不说这句 ⇒ 用户以为"另一个品牌也不到货" = 界面与事实相反。
⇒ 回执新增 **`skipped_brands`**（还在停的是谁）：取消停单后若仍不建，界面要点名它 ——
   只有 `still_arriving`（谁有货）答不了"到底是谁不来了"。

**② 手动建表**`POST /api/forecast/periods`**不读停单**（刻意，已写成代码注释）：
停单管的是「**系统别替我建**」，不是「**我不许建**」。
验收必须做**正反两侧**（同一天两个相反结论）：自动 ⇒ 不建／手动 ⇒ 建得出来。

**③ 已存在期次给一键作废** `POST /periods/{pid}/void` —— 「关闭 + 留痕」而非删除：
(a) `forecast_period_delete` **只删已 closed 期次**，而误建的**恰恰总是 open**；
(b) 真删会级联删掉报单/订单/付款（不可恢复）；
(c) 自动建表硬闸是「同一时间只能有一个 open 期次」⇒ **关掉它 = 让开路**（这才是本需求本体）。
⇒ `forecast_period_close(mode='void')`：与人工定稿可区分、数据全留可恢复、
**走 db 函数不经端点 ⇒ 不发加单通知**（撤销 ≠ 定稿）、幂等、不存在 ⇒ 404。
🔴 `closed_mode='void'` 与 `status` **要一起判**：`reopen` 只把 status 改回 open、**不清留痕**
⇒ 只看 closed_mode 会让"已恢复报单"的期次继续显示「已作废」。

---

## v373（2026-10-04）：**结算真实口径 = 按月核销、次月上账**（用户口述，一级事实）

用户原话：「**结算是以月为单位，本月提交上月核销资料，本月上账，不同厂家不一样，但大部分如此。**」

**两个结构性特征（设计任何结算功能前必须先满足）**：
1. **逐月滚动** —— 不是年度一结。
2. **核销月份 ≠ 上账月份** —— 本月提交的是**上月**的核销资料，返利在**本月**上账（差约一个月）；**每个厂家节奏不同**。

🔴 **与现行 `rebate_*` 实现的四处差距**（`rebate_contracts` 按「年度合同 + 12 月分解」建模，主体搞反了）：

| 真实要素 | 现状 | 缺口 |
|---|---|---|
| 主体是「月度核销批次」 | `rebate_contracts` 是**年度**对象 | 年度合同应降级为**可选外框** |
| 核销月 ≠ 上账月 | `rebate_accruals` 只有**一个** `month` | 需拆成两个字段 |
| 每厂家节奏不同 | **无任何**结算节奏配置 | 对照：到货节奏已有 `arrival_*` 全套，结算节奏**无对等物** |
| 「提交上月核销资料」这个动作 | 无 | 缺动作 + 凭证 |

🔴 **页签结构结论（对应 `docs/返利页签整合评估-2026-10-04.md`）**：
- 「目标与返利」（配置面）与「返利结算」（执行面）**不合并** —— 两件事、两个人、两个时点。
- ⚠️ 「返利结算」页**不能当下线处理** —— 它是**每月必做**的真业务，问题只是**建错了模型**（按年度建，应按月度核销建）。
- 📌 潜在**更近的亲缘**：「核销」= 厂家确认的达成，与页内「**达成填报**」（自报达成）是同一条业务链的两端；`rebate_achievements.source` 目前**无"厂家确认"档** ⇒ 缺「自报 vs 厂家确认」的对账环。

🔴 **`rebate_target_rules.contract_id` 是半成品集成（不是设计冗余）**：列存在 + 后端 `_contract_rules()` 在读它，
但**前端没有任何写入"归属合同"的入口**（`components/rebate/` 搜不到 `contract`）⇒ 全库挂接 **0 条**、
页签 A 那个「全部合同」筛选下拉**恒空 = 假功能**。⇒ 修法是**接线**，不是合并界面。
（2026-09-06《返利阶段2》已拍板「品牌目标(金额) = 厂家年度合同的月度分解，同一数据源」；
阶段2 已落地在用，**阶段3（结算引用品牌目标）未做** —— 这就是那条断链。）

---

## v375（2026-10-04）：页签改名「目标与返利」→「目标配置」＋ 新建**结算节奏配置页**（两条用户指令，均已上线）

用户原话：`1.「目标与返利」改成「目标配置」；2.结算节奏提供配置页，让用户自己配置`

### 一、命名撞车：**页签名 ≠ 侧栏页面名**（改名只动页签，不动侧栏）
`Rebate.vue` 的页签 A 名与侧栏页面名**同为**「目标与返利」⇒ 同屏出现两个同名之物，用户无法区分"我在哪个层面"。
🔴 **改名范围必须精确**：只改 `Rebate.vue` 页签名 + **页内 3 处自我指代提示**（`请先在「目标配置」创建品牌 / 商品目标。` 等）；
**侧栏唯一源（`Shell.vue` / `constants/pages.js` / `CommandPalette.vue` / `CopilotDrawer.vue` / `permView.js`）保持「目标与返利」不改** —— 改了会连带影响导航/搜索/权限页。

### 二、结算节奏：**零实现 → 新建**（不是"改现有的"）
侦察结论：到货节奏有 `arrival_*` 全套（`rebate_target_rules` + `domain/arrival_schedule.py` + `rebate_arrival_skips` + `tenant_params.default_arrival_cadence_days`），
**结算节奏在返利语境下 grep「核销/上账」= 0 命中** ⇒ 照抄三范式新建：`routers/commitments.py`（页内页签＋独立路由＋懒建表）、`CommitmentsTab.vue`（组件结构）、`tenant_params`（全局默认）。

| 层 | 文件 | 要点 |
|---|---|---|
| 后端 | `server/routers/rebate_settlement.py`（新，14234B · md5 `8e1384534c504e539317c3ad345995e8`） | 前缀 `/api/rebate-settlement`；懒建表 `rebate_settlement_schedules` + 索引 `idx_rsched_active`；纯函数月份工具 + 派生日历 |
| 登记 | `server/server.py` 三处 | import（L1030）／`include_router`（L1126）／`_PATH_MODULE_MAP` 加 `"/api/rebate-settlement": "sales"`（L414） |
| 前端 | `src/components/rebate/SettlementScheduleTab.vue`（新，~460 行） | 顶部业务口径说明 + **本月结算日历**（配置的真实消费者）+ 列表 + 新增/编辑弹窗（含实时预览句）+ 空态 |
| API | `src/api/modules.js` | `rebateSettlementApi`（list/create/update/remove） |

🔴 **配置的唯一源 = `rebate_settlement_schedules`**（`scope_type` brand/all · `scope_key` · `cycle` month/quarter/year · `submit_offset`/`submit_day` · `post_offset`/`post_day` · `need_doc` · `is_active`）。
`created_at`/`updated_at` 默认 `datetime('now','localtime')`；`scope_key` 带 `COLLATE NOCASE`。

🔴 **月份算术是本域最容易写错的一处**（已逐条验算 PASS）：
```python
def _ym_add(ym, n):                       # ym='YYYY-MM'，n 可负
    t = int(ym[:4]) * 12 + (int(ym[5:7]) - 1) + int(n)
    return f"{t // 12:04d}-{t % 12 + 1:02d}"
submit_cover = _ym_add(ym, -so)           # 本月该提交哪个月的核销资料（so=submit_offset）
post_cover   = _ym_add(ym, -(so + po))    # 本月上账的是【哪个月核销】的返利（po=post_offset）
```
🔴 **`post_cover` 是复合偏移**（`-(so+po)`），不是 `-po` —— 漏掉 `-so` 会把「核销月」当「上账月」，两句文案只差一个月、肉眼极难发现。
🔴 **offset 落库前 clamp**：`so ∈ [0,2]`、`po ∈ [0,1]`，标签 `OFFSET_LABELS = {0:"本月",1:"上月",2:"上上月"}`。

🔴 **本轮真抓到过的一个 bug（"界面与事实相反"类）**：`sentence` 起初**未按 `need_doc` 分支**，
勾「不用交资料」时仍生成「每月 N 号前提交核销资料」⇒ 配置与文案**相反**。修法：
```python
if need_doc: sent = f"{cyc}结算：每月 {submit_day} 号前提交{上月}的核销资料，{post_day} 号上账（上账的是{上月}核销的返利）"
else:        sent = f"{cyc}结算：不用交核销资料，{post_day} 号直接上账"
```
⇒ **凡是"用户可配 + 文案由配置拼出"的功能，必须为每个布尔开关准备一条反例探针**（本轮正是逻辑探针而非肉眼发现的）。

### 三、为什么挂在「返利结算」后面的**页内页签**而不是新侧栏
结算节奏是「返利结算」的**前置配置**（月初配一次、可逆），与「返利结算」（期末执行、不可逆、落账改不回来）**同域两时点** ⇒ 页内页签比侧栏更贴语义，也避免侧栏再膨胀。
最终页签序：`仪表盘 / 目标配置 / 达成填报 / 返利结算 / 结算节奏 / 厂家承诺`（真机实测一致）。

### 四、🔴 并发夹带分析（本轮最重的分析，方法论可复用）
上线时刻线上 **22:20 批次是另一个会话的 v373（Forecast 列高亮）部署**。逐**逻辑名**比字节（不看 hash 名）：

| 差异项 | Δ字节 | 定性 |
|---|---|---|
| `Rebate.js` / `Rebate.css` / `modules.js` | +12831 / +4418 / +284 | **我的改动**（预期） |
| `Forecast.js` / `AdvicePanel.js` / `LossWorkflow.js` | +896 / −5 / −5 | **纯压缩变量重命名**（中文文案集合差 **0 条**）⇒ 零影响 |
| `Forecast.css` | −752 | 线上多 8 个**死样式**（`.btn-copy`/`.tbl-empty`/`.filter-input`/`.cell-spec`/`.panel-sep`/`.empty-ops`/`.empty-s`/`.empty-t`），**线上 JS 里也 0 次使用**，且已被那个会话的审核报告确证为死 CSS |
| `index.css` | +32 | 别人的 `--p-ink` 对比度修复（1 定义 + 1 用法，**自洽**；不存在幽灵变量） |

⇒ **48/56 逐字节相同**，8 项差异**全部有归属**，**无一是我漏带或误带**。并复核我的 `Forecast.css` 含 `sel-col` ×4 + `inset 0 -2px 0 var(--p)` 特征 ⇒ **v373 列高亮完好保留**。

### 五、🔴 撞号处理：**v374 已被占用**
`styles/variables.css` 有他人未提交改动注释写 `P0(v374)`（`--p-ink:#0e7490` + `Forecast.vue:12525` 用法）⇒ 我的 4 个文件（`server.py` / `rebate_settlement.py` / `modules.js` / `Rebate.vue`）**全部 v374→v375**；**别人的 v374 原样保留**。
⇒ 起号前"实搜两仓 + 工作区（含**未提交**文件）"是必须的，只搜 git log 不够。

### 六、上线读数（可复核）
- 后端 `server.py` md5 `9a46ea53d5b6305a4f2000597a449555`、路由 md5 `8e1384534c504e539317c3ad345995e8`，**本地 == 生产**；`active`；内网/外网 health 均 200。
- 路由已注册：`GET /api/rebate-settlement` = **200**、无 token = **401（非 404）** ⇒ 未被路由遮蔽。
- 前端生产 `index.html` md5 `431da42f1860935870fbb3da94ca8cc7` == 本地；入口 `index-CHznNFH-.js` → `Rebate-VKKeUdH7.js`。
- 真机探针 `.workbuddy/tools/v375-settlement-tab-probe.mjs` = **9/9 PASS**（页签实测六项一字不差）。
- 回滚点：`index.html.bak-v375-20261004-2245`（另有 `index.html.bak-v373-20261004-222152`）。
- 逻辑验算：按月结算 →「每月 5 号前提交上月的核销资料，20 号上账（上账的是上月核销的返利）」；次月上账 `2026-08`；不交资料 →「不用交核销资料，20 号直接上账」。

### 七、⚠️ 未验证项（如实记录，不当作通过）
**写路径（新增/编辑/删除结算节奏）未端到端验证** —— 演示租户只读闸门（写操作 403「这是演示环境，数据为只读」）⇒ 建议用户用**真实账号**手试一条。
读路径（列表 + 派生日历 + 预览句）已验证。

### 八、⚠️ 本轮遗留（仅报告未处理）
生产 `/tmp` 下 9 个历史会话遗留脚本（`rebate357_*`、`rebate_rules_v292.py`、`v350-*.txt`、`v350-migrate-rollback.sh`、`v350z-alias-count.py`），非本轮产物故未删，建议人工统一清。

📄 交付报告：`docs/结算节奏配置页与页签改名-交付报告-2026-10-04.md`

### 九、🔴 承接：`docs/返利页签整合评估-2026-10-04.md §六` 建议动作的落地状态（2026-10-04 23:0x 复核 → 该报告**附录 C**）
**6 条建议动作 = 完成 2 / 作废 1 / 未做 4**：

| 动作 | 状态 | 硬证据（可复查） |
|---|---|---|
| #2 页签 A 改名「目标配置」 | ✅ v375 | `Rebate.vue:6` |
| #5① 结算节奏配置 | ✅ v375 | `rebate_settlement_schedules` 已建 |
| #4 下线页签 B | ⛔ 作废 | 用户口径推翻 |
| #1(a) B 引用 A 目标/分解、取消重复录入 | ❌ | 页签 B 仍在（`Rebate.vue:515`）+ 仍带「+ 录入年度合同」（`:525`）；`rebate_contracts` 仍 `year+target_amount+12月分解` |
| #1(b) 补 `contract_id` 写入口 | ❌ | `components/rebate/*.vue` 搜 `contract` **零命中**；3 条规则 `contract_id` **全 0** |
| #3 恒空「全部合同」下拉 | ❌ | `Rebate.vue:240` 选项 + `:1359` 筛选逻辑都在，后端 0 合同 ⇒ **仍假功能**（打通/撤掉两选项都没选） |
| #5② 核销月/上账月拆两字段 | ❌ | `rebate_accruals` 列仍只有单个 `month` |
| #5③ 「提交上月核销资料」动作+凭证 | ❌ | 无表/端点/按钮；`need_doc` 仅"要不要交"开关 |
| #5④ 年度合同降级为可选外框 | ❌ | `rebate_contracts` 仍是主体 |

🔴 **功能上线 ≠ 已被使用**（本域通用判据）：`rebate_settlement_schedules` 生产库**行数 = 0** ⇒ 新页零配置。

⚠️ ~~附带发现（未查证）~~ → ✅ **已查证，非问题**，见下 §v376。

---

## §v376（2026-10-05）：**规则启停日不裁剪月份** —— 核查结论「无需改动」＋查出一个真问题

**缘起**：§v375 九 里我标了「疑似口径错位」：3 条规则 `effective_end` 全止于 2026-09-30，而 `monthly_amounts` 里 10 月仍有金额。
用户回「C」= 先查清楚再决定动不动数据。**结论：不是问题，不必动数据；而且是同一现象的第二次发现（v186 已修）。**

### 一、口径（一句话）
**对有月度分解的规则，「哪几个月有目标」= 月度分解本身，启停日完全不参与**。
唯一实现 `domain/rebate_period.py::covered_months()`：有 `monthly_amounts` 就 `return` 分解的键，**根本不读 `effective_*`**；
`rule_covers_month()` / `rule_covers_date()` 均委托它。启停日的真实含义 = **整条规则的启用/停用窗口**，不是月份门禁。

**为什么必须这样**：`monthly_view()` 对"分解里没有的月份"会**回退到顶层 `target_value`（年度总额）** ⇒ 那个月拿"全年目标"比"单月达成"，达成率恒失真。
⇒ 所以"分解里没有的月份"必须在门禁处判**不适用**，不能交给下游兜底。

### 二、证据链（真实源码 md5 双核 + 真实数据 + 真实入口，纯只读）
| 层 | 工具 | 读数 |
|---|---|---|
| 源码身份 | `md5 -q` vs `ssh md5sum` | `domain/rebate_period.py` = **`c27bc11917faaf65bd2abf1f0702a492` 本地==生产** |
| 数据 | 生产库只读导出 | 3 条规则，md5 `68923e121e59bc935b6958bda1bf1af9` |
| 月/日粒度复算 | `tools/v376-effective-window-diagnosis.py` | **13/13 PASS**（含判别力自证 6 条：无分解+窄窗口 ⇒ 10/11 月均 False） |
| 端到端实算 | `tools/v376-effective-window-e2e.py` | **10/10 PASS**（走真实 API 链） |
| 回归测试 | `tests/test_rebate_period_v186.py` | **全部通过** |

🔴 **核心读数 —— 新旧口径差异 3/3**：现行实现放行 10 月（3 条全 True）；
**v186 之前的「交集」口径会把 3 条规则的 10 月目标全部挡掉**。
⇒ 这个修复不是理论优化，是**本租户每天在跑的业务正靠它成立**。

**端到端实算（真实目标值，非年度总额）**：蒙牛低温 10 月目标 **400,000**、达成率 112.5%、返利 **67,500**（=45万×15%）；
9 月目标 674,000、返利 70,000；简爱 10 月目标 80,000、返利 9,000。
**决定性反证**：把简爱的 `effective_end` 放宽到 12-31，11 月**仍不触发**（`detail` = 「规则的月度分解里没有 2026-11-15 所在这一月」）
⇒ 「裁不裁剪只看月度分解，启停日改大改小都不影响」运行时成立。

### 三、消费点普查（"还有谁拿启停日当月份门禁？"）
| 消费点 | 现状 |
|---|---|
| 后端判重/试算/计提 | 全走 `covered_months` / `rule_covers_month` / `rule_covers_date` ✅ |
| `routers/rebate_rules.py` 旧本地 `_effective_contains` | **已删**（v292），只剩注释；改调 `rule_covers_date`（该函数只吃 dict ⇒ 先 `_row_to_dict()`） |
| `domain/rebate_calc.py:280-291` 读 `effective_end` | **仅用于拼"为什么不适用"的说明句**，且已按「分解里没有这一月 / 不在生效期内」分支 ⇒ 非裁剪路径 |
| `domain/rebate_calc.py:168-173` | v186 已把 `period_type`/`target_year`/**`monthly_amounts`** 下传到 `spec` |
| 前端共享谓词 `useMonthlyAchv.js::ruleCoversMonth` | 与后端**逐字同源**；v186 已收敛原先分散 5 处的本地实现 |
| 前端旧反模式「取全部活跃规则 `effective_end` 的 max」 | grep `sort`/`max`/`reduce` **零命中** ⇒ 绝迹 |
| 冲刺面板「返利周期截止」 | v292 已改为 `rebateSprintMonthEnd`（冲刺月月末，本地时间构造，**禁 `toISOString`**）+ 撤掉 `return 1` 假兜底 ✅ |
| 阶梯**版本**的 `effective_start/end`（`erp_db.py:12014 _pick_tier_version`） | **另一个对象**（`rebate_rule_tier_versions` 自己的版本窗口），按设计就是逐月生效的版本历史 ⚠️ |

### 四、🔴 核查顺带查出的**真问题**（这才是本轮该行动的事）
| 规则 | 月度分解覆盖 | 2026-11 | 2026-12 |
|---|---|---|---|
| 简爱9月目标 | 只有 09、10 | ❌ | ❌ |
| 蒙牛低温2026年目标 | 01~12 齐全 | ✅ | ✅ |
| 蒙牛鲜奶到货节奏 | 只有 09、10 | ❌ | ❌ |

⇒ **2026-11-01 起这两条规则会自动"消失"**：前端「达成填报」的月份矩阵用
`rules.value.filter(x => x.is_active && ruleCoversMonth(x, yy, mm))` ⇒ 那两行**根本不渲染**；后端试算同判"不适用"、返利为 0。
🔴 **与"停用"不是一回事**：`is_active` 仍是 **1**（界面不显示任何异常）⇒ 是**静默空白**，命中本项目已知高危形态
（对照：预报「沿用上一期清单得 0 个商品」的静默空白告警）。
**建议**：现在就补 11/12 月分解额，或在页面上加"该规则在 11 月已无适用月份"的显式提示。

### 五、🔴 探针自身踩的两处错（方法论，跨域通用）
| # | 错 | 后果 | 修正 |
|---|---|---|---|
| 1 | 断言期望写成「新旧口径差异 = 0」 | 报 1 个 FAIL，且**恰好是反的**（真实差异 3/3）⇒ 差点把最重要的读数当成"没问题" | 改期望为 3 |
| 2 | 直接调 `compute_rebate_unified`，**跳过 `monthly_view()` 投影** | 报 **6 个假 FAIL**（10 月目标读成年度 838.4 万、达成率 5.4%）⇒ 差点误报"10 月被启停日挡掉" | 改走真实入口 `compute_rule_rebate`（内部第 539 行第一步就是 `monthly_view`） |

🔴 **铁律（已折进技能 `hergent-realdata-ab-proof`）**：内核函数只做**门禁 + 算式**，"投影到当月"是**调用方的职责**
⇒ **复算必须从 API 真正调用的那个函数进入**，否则会造出一个"看起来当月没目标"的假象。

📄 报告：`docs/规则停用日口径核查-2026-10-05.md`

---

## 方案（2026-10-05）：**返利结算按月度核销重做** —— 待拍板（纯设计，**零代码、不取版本号**）

📄 `docs/返利结算按月度核销重做-方案-v1-2026-10-05.md`（= 整合评估报告 §六 动作 **B**，覆盖 #5②③④ + #1(a)）
⇒ 是 §v373「四处缺口」的**实施方案**，此处只留**不可从代码推断**的结论。

🔴 **病根 = 换主体，不是改界面**：主体应从 `rebate_contracts`（**年度**）换成**月度结算批次**。
四处错位：① 粒度（`settle_rebate(contract_id)` 一次结整年）② 月份语义（`rebate_accruals` **一个** `month`＝达成月；缺"提交月/上账月"）③ 动作（`rebate_claims` 是**内部审批** submitted→approved，**无凭证** ⇒ 与"对厂家交核销资料"是两件事，被混成一个状态机）④ 主体（合同必填；且 `rebate_contract_months` 与 `monthly_amounts` **两套年度目标**）。

🔴 **零迁移窗口（只读实测，2026-10-05）**：`rebate_contracts` / `rebate_contract_months` / `rebate_accruals` / `rebate_claims` / `rebate_tier_versions` / `rebate_rules`(旧) / `rebate_calculations` **全 0 行** ⇒ 新老并存、不停机、不搬数据。真数据只有 `rebate_target_rules` **3**（`contract_id` 全 0）／`rebate_achievements` **4**／`rebate_rule_month_lock` **16**。
⇒ ⚠️ **这个窗口会关闭**（一旦开用，重构成本立刻上升）。

🔴 **凭证不必新造**：`attachments` 表 + `POST /api/attachments`（`ref_type`/`ref_id`/`filename`/`data_b64`）+ `GET /api/attachments/{ref_type}/{ref_id}` + download/delete；`/api/upload` 已归 `sales`。⇒ 结算凭证用 `ref_type='rebate_settlement'`。
🔴 `receivables` 共 181 行，其中 `ref_type='rebate'` **0 行** ⇒ 上账生单口径无历史包袱。

**目标模型**：新表 `rebate_settlements`，唯一键 `(brand_key, settle_month)`；五态 `draft→submitted→confirmed→posted→reversed`。
🔴 **关键复用**：§v375 的 `rebate_settlement_schedules` **不是死配置** —— 它驱动批次 `submit_due`/`post_due`（`_ym_add` **复合偏移**）⇒ 必须把纯函数抽到 `domain/settle_calendar.py` 两侧共享，**禁止写第二份月份算术**（本域最易错处）。

🔴 **新发现的路由坑（P0 必避，勿照抄直觉命名）**：`_PATH_MODULE_MAP` **首个 startswith 命中即停** ⇒ 新路径若叫 `/api/rebate-settlements`，会被已有的 `/api/rebate-settlement`（**单数**，v375 结算节奏）**吃掉**。当前两条同归 `sales` 故**无害**，但**日后一拆模块就静默走错权限域**（同 v317 路由遮蔽族）⇒ 定名 **`/api/rebate-settle-batches`**（不构成前缀嵌套）。

**分期**：P0 模型+流转（可独立上线，推荐先单独试跑）｜P1 引用打通（去重复录入 + 修恒空「全部合同」下拉）｜P2 节奏驱动（按月自动提名待办 + 通知中心提醒）。
**兼容**：`rebate_contracts`/`_months`/`_accruals`/`_claims` **保留表、不动数据、新流程不再写**；旧 20 个 `/api/rebate-contracts/*` P0 **不删**（避免"删了才发现某处在用"）。

🔴 **5 个待拍板点**（用户拍板前**不要开工**）：① **两套年度目标谁留**（推荐 `monthly_amounts` 唯一源）② **上账落点**（A 每批一张 ar 应收单 / B 只标记不生单 / C 维持按年汇总）③ 页签 B 新名（月度核销 / 核销与上账 / 保持）④ 旧接口去留 ⑤ 节奏（推荐 P0 单独试跑）。
⚠️ **战略张力（已如实写进方案 §八）**：结算/上账属**财务交易域**，若日后对外卖，与「只做 AI 层、交易交给客户既有 ERP」的定位冲突 ⇒ 自用可继续，对外建议重估为"台账 + 提醒"而非"记账"。



