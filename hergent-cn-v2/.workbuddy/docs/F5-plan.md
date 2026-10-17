# F5 侦察 + 方案文档：AllocPanel + PeriodOps

> 依据既定节奏「先确认方案文档 + 当前代码状态，再动手」。
> 侦察基准：`Forecast.vue` 当前 **12241 行**（v558 后）。护栏：`forecast-split-guard.py`（96 API + 74 函数）。
> 🔴 **先修后动**：F5 侦察途中发现并修复了 F4 的两个遗留真 bug（v557 漏 import Icon、v558 样式作用域回归），均已上线。

---

## 零、前置：两个新沉淀的硬判据（影响 F5 及以后所有抽离）

| # | 判据 | 来源 |
|---|---|---|
| 1 | 抽离子组件时，**模板里的组件引用必须逐个 import**（本项目无 `unplugin-vue-components`、`main.js` 也不全局注册） | v557 血案 |
| 2 | **从 `scoped` 父组件抽离子组件时，样式必须一起搬** —— scoped 的 data-v 只打在子组件根元素上，内部后代拿不到 ⇒ 等于「抽走 DOM、留下 CSS」，内部样式静默失效 | v558 血案 |

> 验证手段：改完后必须在**编译产物**里确认子组件自身 chunk 含所需样式规则，且父 chunk 对应规则残留 = 0。

---

## 一、侦察结论（当前代码状态）

### 1. AllocPanel（按比例分摊弹窗）—— **控制器型，非 F4 式干净叶子**
- **模板** 2157–2302：`<Teleport>` + overlay + `.imp-modal.alloc-modal`。含前置缺失分流（`no_members` / `no_target`）、总量输入、占比表、合计校验、三个操作按钮。
- **脚本** 9869–10240（~370 行，**52 个顶层定义**）：
  `allocMembers`/`allocBasis`/`ptAlloc`/`hasAlloc`/`allocRowRef`/`syncAllocAllocsFromRows`/`runAllocPreview`/`allocPreviewSoon`/`openAlloc`/`closeAlloc`/`onAllocTotal*`/`onAllocRatio*`/`onAllocAlloc*`/`loadAllocArchivedRatiosIfEmpty`/`allocSplitEven`/`allocResetRatios`/`allocRatiosChanged`/`allocTotalNum`/`allocAllocNum`/`applyAlloc`/`allocClearOverride` …
- **耦合点（关键）**：
  - `_allocPid()` → 读 `cross.value.period.id`
  - `allocRowRef(r)` → 读 `cross.value.rows`
  - `applyAlloc()` → **回写网格行**（`allocRow.value`），属写操作
  - 依赖 `ptAlloc`（`product_id → extra-alloc item`）
- **判定**：会写中央网格 ⇒ 与**搁置的 CtxMenu 同类**。但不同点在于：AllocPanel 的写是**弹窗内一次性、结尾单次回填**，而 CtxMenu 是高频多入口直改选区 ⇒ AllocPanel **可通过 emit 干净解耦**，CtxMenu 不行。

### 2. PeriodOps（期次操作）
- **模板** 2304–2386：关闭期次确认弹窗（`.del-modal.close-modal`），含定稿推送明细预览（`.close-nf`）。
- **脚本** 9367–9430+：`closeOpen`/`closeTarget`/`closing`/`closeDetail`/`closeDetailErr`/`closeExpandPid`/`loadCloseDetail`/`askClose`/`onHistoryClose`/`confirmClose`。
- **耦合点**：`openNewPeriod` 在本页有 **5 处入口**（56/57、98、239、553…），是页面级操作；`confirmClose` 调 `forecastApi.closePeriod` 后需重载全表。
- **判定**：`openNewPeriod` 多入口 + 关闭后全表重载 ⇒ 若抽离，父级仍需保留入口分发，收益被削弱。

### 3. 与 F4 对比（为什么 F5 风险更高）

| | F4（AuditPanel / RebateSprint） | F5（AllocPanel / PeriodOps） |
|---|---|---|
| 对 `cross` | **只读** | **读写都有**（applyAlloc 回填） |
| 边界 | 极小（props 只读 + close/reload emit） | 需要 emit 携带回填数据 |
| 模板规模 | 66 / 99 行 | 146 / 83 行 |
| 脚本规模 | 99 / 355 行 | ~370 / ~65 行 |
| 风险 | 低 | **中-高**（控制器型） |

---

## 二、提取方案（若确认推进）

### AllocPanel.vue（懒加载模态）
- **props**：`open: Boolean`、`row: Object`（要分摊的编辑态行）、`ptAlloc: Object`、`numInput: Function`、`canDo: Function`、`recordAudit: Function`。
- **emits**：`close`、`applied`（把后端返回值交给父组件做**网格回填 + 重载**，子组件不直接写网格）。
- **自拥**：`allocSetup`/`allocRows`/`allocSummary`/`allocErr`/`allocFlags`/`allocRatioTotal`/`allocRatioOk`/`allocTargetId`/`allocArchiveRatios`/`allocRatiosRaw`/`allocAllocsRaw`/`allocFocusEid`/`allocBusy`/`allocPrev`/`_allocSeq`/`_allocTimer` + 全部 `onAlloc*` 处理函数 + `runAllocPreview`/`openAlloc`/`closeAlloc`/`allocSplitEven`/`allocResetRatios`/`allocClearOverride`。
- **直接 import**：`api`/`productTargetsApi`、`fmt`、`_r2`/`_r3`（若未导出则需一起搬）、`toast`/`canSee`（store）。
- **父组件保留**：`allocOpen` ref、`allocRow` ref、`ptAlloc` ref、网格**回填**逻辑、`loadCross()` 重载。
- **样式**：`.alloc-*` 规则随组件一起搬到子组件 `<style scoped>`（🔴 判据 2）。
- **接线**：`const AllocPanel = defineAsyncComponent(() => import('../components/forecast/AllocPanel.vue'))`；`<AllocPanel v-if="allocOpen" … @close="allocOpen=false" @applied="onAllocApplied" />`。

### PeriodOps.vue（懒加载模态）
- **props**：`open`、`target`（= closeTarget）、`recordAudit`。
- **emits**：`close`、`confirmed`。
- **自拥**：`closing`/`closeDetail`/`closeDetailErr`/`closeExpandPid`/`loadCloseDetail`/`confirmClose`。
- **父组件保留**：`closeOpen` ref、`closeTarget` ref、`askClose`/`onHistoryClose`（多入口分发）、`loadCross()` 重载。
- **样式**：`.close-*` 规则随组件搬。

---

## 三、护栏影响
- 护栏 96 API 锚点、74 函数白名单**不含** `alloc*`/`close*` 私有面板函数 ⇒ 移动它们**护栏零影响**（v557/v558 已实证：搬 RebateSprint 后仍 96/96 + 74/74）。
- `productTargetsApi.extraAllocSetup`/`extraAlloc`/`.../override`、`forecastApi.closePeriod` 调用点只是换文件，仍在全树 ⇒ API 锚点计数不变。

---

## 四、部署纪律（同 F3/F4）
1. 先 `git fetch` 确认不落后 → 必要时合 origin。
2. 隔离 `outDir dist-vNNN`（safe-delete 会拦 dist 清空）。
3. `forecast-split-guard.py verify --build` 全绿（96 API + 74 函数零丢失 + 构建过）。
4. rsync `dist-vNNN/` → `/opt/hergent-cn-v2/`，**无 `--delete`**；chown `hergent:hergent`。
5. 生产探针：entry 切换 / 双侧 md5 / 子组件 chunk 含其样式 / HTTP 200。
6. scoped commit + push。

---

## 五、选项

- **A（推荐）**：**只抽 AllocPanel**。它是 F5 里收益最大的一块（~370 行脚本 + 146 行模板，独立弹窗、边界可通过 emit 干净收口），且是**验证"控制器型也能安全抽离"的样板** —— 成功后 F5 剩下一半和未来的 CtxMenu 都能照此办理。
- **B**：只抽 PeriodOps（关闭期次弹窗）。块更小（~65 行脚本 + 83 行模板），但 `openNewPeriod` 的 5 处入口必须留在父级 ⇒ 抽离后父级仍有一半逻辑，**收益明显低于 A**。
- **C**：两个一起抽。一次性收益最大，但同批次改两块控制器型代码，回归面翻倍；一旦出问题定位更慢。
- **D**：**暂缓 F5**。当前 `Forecast.vue` 已从 13400 降到 12241（−1160 行），懒加载收益主要部分已拿到；转而做其它 P2 项（促销 ROI 端点重修、货架位、现金流预测页面化）。

> 我推荐 **A**：单块推进、风险可控，且能产出"控制器型抽离"的可复用范式。回 A / B / C / D 即开工。
