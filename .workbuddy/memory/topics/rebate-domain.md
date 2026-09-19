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
