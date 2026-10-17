# F3b 方案文档：CtxMenu（上下文菜单系统）抽离懒加载

> ## 🔴 STATUS: SHELVED（搁置）— 2026-10-17 老板拍板 B
> ImportPanel 半已交付 F3 实打实收益（独立 13.76KB chunk）。CtxMenu 抽离对首屏体积
> 贡献边际（估 5–9KB gzip vs 主 chunk 143KB gzip），却要动 13000 行菜单区 + 搭 props 桥，
> ROI 偏低 → 搁置。F3 以 ImportPanel-only 收口。本文件保留为侦察结论记录，后续若需重提据此即可。
> 若未来重提，走方案 A（只搬菜单自身 + props 桥，护栏零影响）而非方案 C（全量 composable，改动面极大）。

> 依据 F3 既定节奏「先确认方案文档 + 当前代码状态，再动手」。
> 侦察日期：2026-10-17（F3 ImportPanel 半已上线 v549）。
> 当前 `Forecast.vue` = 12912 行，HEAD = `43eb2e6` (v549)。

## 一、当前代码状态（侦察结论，重要更新）

「CtxMenu」其实**不是一套，是两套耦合的上下文菜单系统**：

### 1. 表体右键菜单 `ctx`（模板 1813–1901，约 90 行 DOM）
- 状态：`ctx` ref (5294) + `ctxMode`/`ctxFillVal` refs + 3 个 computed（`ctxRows` 7058 / `ctxRowFiltered` 7072 / `ctxRowOffPage` 7078）+ `ctxNumCell`(5319) / `ctxHasRangeSel`(5326) / `ctxColOpsOk`(7050) / `selAxisLabel`(7038)
- 动作函数（21 个）：`openCtx`/`closeCtx`/`openCtxFill`/`applyCtxBatchFill`/`applySelFill`/`ctxCopy`/`ctxPaste`/`ctxInsertRow`/`ctxDeleteRow`/`ctxInsertCol`/`ctxDeleteCol`/`ctxSelectAll`/`ctxFillSafety`/`ctxCopyRow`/`ctxFillDown`/`ctxFillRight`/`ctxColStats`/`ctxCopyCsv`/`ctxCopyMd`/`ctxSetNote`/`ctxCancelRowSel`/`toggleCondWarn`

### 2. 表头右键菜单 `hdrCtx`（模板 1923–2040，约 120 行 DOM，比表体大）
- 状态：`hdrCtx` ref (5340) + `hdrCtxStyle` computed (5497)
- 动作函数（~15 个）：`openHdrCtx`/`closeHdrCtx`/`openHdrCtxAt`/`hdrDeleteCol`/`hdrFreezeCol`/`hdrGroupBy`/`hdrCopyName`/`startHdrWidth`/`applyHdrWidth`/`startHdrRename`/`applyHdrRename`/`applyHdrAdd`/`applyHdrFilter`/`clearColFilter`/`hdrColSelect` + 列筛选/唯一值/宽度等内联模式
- 还有 `hdrCtxColIndex`(7086) 等辅助

### 3. 两套菜单都直接调用中央网格操作
`copyRegion`(7272) / `fillSelectionWith`(6071) / `clearSel`(7327) / `recomputeTotals`(3199) / `setRowNote`(8509) / `editColDescAt`(5576) / `sortByCol`(6442) / `rowBaseShown`(6966) / `rowShown`(6976) / `visibleCols`(3693) / `selCol` / `startFill` / `pasteRegion`(7537) + 增删行列辅助。

**这些网格操作同时被「选区工具栏 / 填充手柄 / 表头点击 / 键盘快捷键」共用，不是菜单独占。**

### 4. 护栏影响（已验证）
- 护栏 74 函数白名单、96 API 锚点**均不含任何 `ctx*`/`hdrCtx*`** → 把菜单函数整体搬进 `CtxMenu.vue` 是**护栏零影响**（全树扫描名字仍在）。
- `ctxSelectAll` / `closeCtx` **没有父组件脚本调用方**（只在菜单模板与 `ctx*` 内部互调）→ 可整体搬出，不留悬空引用。

---

## 二、三种抽法（关键决策）

### 方案 A（推荐，中风险，完整达成「菜单懒加载」目标）
**不动中央网格状态**，只把「菜单自身」搬出去：
- 新建 `src/components/forecast/CtxMenu.vue`：含两套菜单 DOM + `.ctx-*`/`.ctx-overlay`/`.ctx-menu` 样式 + 全部 `ctx*`/`hdrCtx*` 动作函数与菜单状态。
- 父组件用 **props 桥** 把菜单需要的：
  - 状态：`ctx`/`hdrCtx` 两个 ref、6 个 computed（`ctxRows`/`ctxRowFiltered`/`ctxRowOffPage`/`ctxNumCell`/`ctxHasRangeSel`/`ctxColOpsOk`/`selAxisLabel`/`hdrCtxStyle`）
  - 网格操作函数包 `gridOps`（约 25 个共享函数：copyRegion/fillSelectionWith/clearSel/recomputeTotals/setRowNote/editColDescAt/sortByCol/rowBaseShown/rowShown/visibleCols/selCol/startFill/pasteRegion/…）
- 父组件保留：`ctx`/`hdrCtx` 状态 ref、`openCtx`/`openHdrCtx` 等触发函数（网格模板 `@contextmenu` 调用）、全部共享网格操作函数。
- 接线：`<CtxMenu v-if="ctx.show || hdrCtx.show" :ctx="ctx" :hdrCtx="hdrCtx" :grid-ops="gridOps" />`，`defineAsyncComponent` 懒加载。
- **收益**：菜单 DOM + 动作 + 样式（约 1000 行）移出首屏主 chunk，首次右键时按需加载。
- **风险**：props 桥面（10 个响应式状态 + 25 个函数）是主要出错点，须真机点验每个按钮。

### 方案 B（不抽，搁置）
- ImportPanel 半已拿到 F3 的实打实收益（独立 13.76KB gulp chunk）。
- CtxMenu 抽离对首屏体积贡献**有限**（估约 5–9 千字节 gzip，相对 143 千字节 gzip 的主 chunk 是边际改善），却要动 13000 行文件的菜单区 + 搭一套 props 桥。
- **ROI 偏低**，可搁置，把精力放更高价值处。

### 方案 C（全量 `useGridOps` composable，高风险，最干净）
- 把「网格操作 + 选区状态」整块抽成 `useGridOps` composable（F2 的 `useUndoRedo` 同套路），CtxMenu 只做薄视图。
- **收益**：代码最干净，且若其他功能也迁过去能进一步减压。
- **风险**：`selRange`(7020)/`selAxis`(7023)/`selected`(5274)、`visibleCols`(3693)、`startFill`、`colLabel`/`colW`/`canSort`/`canDeleteMaster`/`groupableCol`/`frozenLeftOf`/`isFrozen`/`colCls`/`FROZEN_COLS`/`inColSpan`/`selCol` 被**整个网格模板**（表头循环 694、填充手柄 1092/1109、选区工具栏 1216、键盘）共用，抽出来要全模板重命名引用，改动面极大、回归风险高。

---

## 三、执行纪律（无论选 A/C）
1. 先 `git fetch` 确认不落后 → 必要时合入 origin。
2. 改动前 grep 全树确认每个 `ctx*`/`hdrCtx*` 调用点，把父组件仍在调用的（如有）保留或用 `gridOps` 桥接。
3. 隔离 `dist-vNNN` 构建 + `forecast-split-guard.py verify --build` 全过（96 锚点零丢失 + 74 函数零丢失 + 构建通过）。
4. 真机点验：右键表体 / 右键表头，逐个按钮点一遍（复制/粘贴/插入删除行列/填充/统计/备注/列重命名/筛选/冻结/分组）。
5. scoped commit（仅 `Forecast.vue` + 新增 `CtxMenu.vue`）→ push → rsync（不 `--delete`）→ 生产探针（entry 切换 / md5 双侧 / 200）。

---

## 四、我的建议
F3 本意是「子组件懒加载压 chunk」，ImportPanel 已交付主收益。**CtxMenu 这套：方案 A 能完整交付 F3 的「菜单懒加载」目标、风险可控；但坦白讲 ROI 不如 ImportPanel。**

请你定：
- **A** → 按方案 A 出代码（F3b-α），护栏+构建+真机点验后部署。
- **B** → 搁置 CtxMenu，F3 到此为止（ImportPanel-only 已是完整 F3 交付），精力放别处。
- **C** → 做全量 composable（再拆成更小子批次逐步来，不一次动 13000 行）。

回 **A / B / C**。
