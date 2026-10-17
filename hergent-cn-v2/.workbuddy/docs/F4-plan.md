# F4 方案文档：AuditPanel + RebateSprint 抽离懒加载

> 依据 F3 既定节奏「先确认方案文档 + 当前代码状态，再动手」。
> 侦察基准：`Forecast.vue` 当前 **12912 行**（F1/F2/F3 后）。护栏：`forecast-split-guard.py`（96 API + 74 函数）。
> 结论先行：**F4 两个面板都是干净叶子（非 CtxMenu 控制器陷阱），可同 ImportPanel 抽成懒加载叶子，低风险。**

---

## 一、侦察结论（当前代码状态）

### 1. AuditPanel（补货建议 / AI 审核台）—— 模态弹窗，干净可搬
- **模板** 277–342：`<div v-if="auditOpen" class="imp-modal audit-modal">` + overlay。内容：`auditState`(loading/done/empty) / `auditData`(summary+items 表) / `auditFresh`(销量新鲜度常显) / `erpLinked`/`goConnect`(未连 ERP 提示) / `auditPaged`(分页，auditPage++ 加载更多) / `doAdopt`(确认定稿) / close。
- **脚本** 9446–9544：`auditOpen`/`auditState`/`auditData`/`adopting`/`auditPage`/`AUDIT_PAGE_SIZE`/`auditPaged`(9447–9453) + `auditFresh`/`auditFreshAgo`(9463–9473) + `erpLinked`/`chanjetLinked`/`kingdeeLinked`/`probeErp`/`goConnect`(9476–9491) + `openAudit`(9493) + `verdictCls`(9512) + `doAdopt`(9520)。
- **不写编辑网格**：`doAdopt` 只调后端 `auditApi.adoptAudit` + `recordAudit('adopt',…)` 留痕 + `loadCross()` 重载；`openAudit` 只调 `auditApi.auditPeriod`。它对 `cross` 的访问是**只读** `cross.value.period`。
- **唯一耦合点**：按钮 `onSuggest`(7813) = `openAudit()` + `genSuggestions()`(7800)；`genSuggestions` 遍历 `cross.value.rows` 写 `r.suggest`（动网格）。→ **`genSuggestions` 与 `onSuggest` 留在父组件**，子组件只负责弹窗本体。

### 2. RebateSprint（返利冲刺看板）—— 常显卡片，干净叶子
- **模板** 348–446：`.sprint-card.is-pinned`（选到期次即显示，不绑子视图）。含达成率表 / 时间进度 / 缺口 / 均单建议 / `rebateSprintOpen` 折叠。
- **脚本** 9546–9901（~355 行）：`rebateGlobalCadence`/`rebateRules`/`rebateRulesErr`/`rebateSprintOpen`/`loadRebateRules` + `rebateAchievements`/`loadRebateAchievements` + `rebateSprintMonth`/`sprintAchvMonth`/watch + `rebateSprintMonthEnd`/`rebateCampaignEnd`/`rebateSprintOrders` + `rebateSprint`(computed) + `sprintTotalGap`/`sprintTotalGapPerOrder`/`sprintOverrideNames`/`unmetSprintCount` + `sprintTimeProgress`/`sprintPaceOf`/`sprintAchText`/`sprintBarClass`/`sprintPaceMap`/`measureSprintPace`/watch。
- **自含只读看板**：自有 API `/api/rebate-rules` + `/api/rebate-achievements`；对 `cross` 仅只读 `cross.period`/`cross.value.period`；`measureSprintPace` 用 `querySelectorAll('.sprint-card .sp-pace')` 量自己的 DOM（留子组件内）。**零网格写入**。

### 3. 与 CtxMenu 对比（为什么 F4 不是陷阱）
CtxMenu 的 `ctx*` 全部**直接改中央网格状态**（选区/复制粘贴/增删行列）；F4 两个面板对 `cross` 都是**只读**（读 period/rows 展示），写操作全走后端 API 或留在父组件的 `genSuggestions`。所以 F4 的 prop/emit 边界很小、很清晰，不需要先抽 grid-ops composable。

---

## 二、提取方案

### AuditPanel.vue（懒加载模态）
- **props**：`open: Boolean`、`period: Object`、`recordAudit: Function`、`loadCross: Function`。
- **emits**：`close`。
- **自拥**（搬入子组件）：`auditState`/`auditData`/`adopting`/`auditPage`/`AUDIT_PAGE_SIZE`/`auditPaged`/`auditFresh`/`auditFreshAgo`/`erpLinked`/`chanjetLinked`/`kingdeeLinked`/`openAudit`(内部，watch `open` 变 true 触发)/`verdictCls`/`doAdopt`/`probeErp`/`goConnect`/`measureSprintPace`。
- **直接 import**（无需 prop）：`fmt`(utils/forecast/format)、`numInput`/`parseNumInput`(同)、`ruleCoversMonth`(components/rebate/useMonthlyAchv)；`toast`/`canSee` 走 store 全局（同 ImportPanel）。
- **父组件保留**：`auditOpen` ref、`onSuggest`(= genSuggestions + auditOpen=true)、`genSuggestions`(7800)、`adoptSuggestion`(若网格相关)。
- **接线**：`const AuditPanel = defineAsyncComponent(() => import('../components/forecast/AuditPanel.vue'))`；模板 `<AuditPanel v-if="auditOpen" :open="auditOpen" :period="cross.period" :record-audit="recordAudit" :load-cross="loadCross" @close="auditOpen = false" />`（v-if 挂 = 首次打开才载 chunk，同 ImportPanel）。

### RebateSprint.vue（懒加载常显卡片）
- **props**：`period: Object`（`cross.period`）。
- **emits**：无（纯展示，内部 `rebateSprintOpen` 折叠态）。
- **自拥**：9546–9901 整段 + 模板 348–446 + 样式 12550–12857。
- **直接 import**：`fmt`、`ruleCoversMonth`、`nextTick`。
- **接线**：`const RebateSprint = defineAsyncComponent(() => import('../components/forecast/RebateSprint.vue'))`；模板 `<RebateSprint v-if="cross.period" :period="cross.period" />`（period 存在即挂，首屏渲染时按需载 chunk）。

---

## 三、护栏影响（零风险项）
- 护栏 96 API 锚点、74 函数白名单**不含** `audit*`/`rebateSprint*`/`sprint*`（这些是面板私有函数，不在跨功能白名单）。→ 移动它们**护栏零影响**，verify 仍全绿。
- 金额口径红线（`rowFinalQty`/`factoryPrice` 等）**不碰**——F4 不动网格计算。
- `auditApi.auditPeriod`/`adoptAudit`、`/api/rebate-rules`/`/api/rebate-achievements` 调用点只是从父文件挪到子文件，仍在全树 → API 锚点计数不变。

---

## 四、部署纪律（同 F3）
1. 先 `git fetch` 确认不落后 → 必要时合 origin。
2. 隔离 `outDir dist-vNNN`（safe-delete 会拦 dist 清空）。
3. `forecast-split-guard.py verify --build` 全绿（96 API + 74 函数零丢失 + 构建过）。
4. rsync `dist-vNNN/assets/` + 覆盖 index.html，**无 `--delete`**；chown `hergent:hergent`。
5. 生产探针：entry 切换 / 双侧 md5 / ImportPanel 同款「动态 import 在 Forecast chunk」/ 旧 entry 仍在 / HTTP 200。
6. scoped commit + push。

---

## 五、选项
- **A（推荐）**：两个都抽成懒加载叶子（AuditPanel 搬弹窗本体 + genSuggestions 留父；RebateSprint 全搬）。主 chunk 再减负约 1.2KB×gzip 量级（两个独立 chunk），且 `Forecast.vue` 再降 ~700 行。低风险，护栏零影响。
- **B**：只抽 RebateSprint（最干净、零耦合），AuditPanel 暂缓（因 genSuggestions 耦合 + 弹窗含 ERP 探测/recordAudit 留痕等共享依赖，略多一道 prop 桥）。先拿一块收益、更低风险。
- **C**：同 F3b 做 composable 前置（抽 rebate 计算/audit 状态到 composable）——过度工程，不建议。

> 我推荐 **A**：两个都是干净叶子，ROI 明确，且证明 F3 的懒加载模式可复制。回 A / B / C 即开工。
