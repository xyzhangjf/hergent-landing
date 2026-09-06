# 预报汇总表 · 表体工程化增强（T1–T8）交付总览

**日期**：2026-08-23
**范围**：纯前端（`hergent-cn-v2/src/pages/Forecast.vue`），后端无需改动
**产物**：`Forecast-CAemnkEU.js`（442.26 kB / gzip 142.68 kB）
**部署**：`rsync` → `root@47.113.224.140:/opt/hergent-cn-v2/` + `chown hergent:hergent` ✓
**构建**：`npm run build` ✓（built 1.34s）

---

## 一、增强清单落地（用户给出的 8 维，全部实现）

| 维度 | 能力 | 关键实现 |
|------|------|----------|
| **T1 行交互** | 悬停高亮 / 行选中 / 只读内联编辑 | `.data-row:hover`、点击选中 `selectedPid`、双击单元格 `editingCell`+`commitCell` 重算合计/件数/金额 |
| **T2 行展开** | 行首 ▶ 展开明细 | `expandedRows`+`toggleExpand`；展开行渲染 `det-row/det-grid`（品类/品牌/AI建议/备注/风险/各单元报单量） |
| **T3 虚拟滚动** | 大数据量渲染 | `flatItems` 扁平列表（group/row/detail）+ `vsWindow` 窗口切片 + 上下 `vs-spacer` 占位；行数 > 80 启用；`cross-viewport` 滚动容器 + 吸顶表头 |
| **T4 行内状态** | 加载中/报错/禁用 | `rowStates` 映射 + `.row-loading/.row-error/.row-disabled`；删除走软删 `r._deleted` + `recomputeTotals`（不破坏物理索引，兼容旧 `setRowNote`） |
| **T5 行操作** | 查看/编辑/删除 | 名称列 hover 显 `row-ops`（🔍✎🗑）；`viewRow/editRow/delRowSoft` |
| **T6 排序+冻结** | 表头排序 / 冻结列 | `colOrderList` 表头（合计/下单金额/商品 可点排序，`ariaSort` 指示）；`frozenKey` 冻结列下拉（商品名称/厂家编码/不冻结），复用 `.frozen` sticky |
| **T7 空/加载态** | 骨架屏 + 空态占位 | 三段式：加载中 `tbl-skeleton`（8 行 `sk-bar` 动画）/ 空态 `tbl-empty`（📭+补录按钮）/ 汇总 `pin` 条 |
| **T8 键盘 a11y** | 键盘导航 + 屏幕阅读器 | `role="grid"/"gridcell"`、`aria-selected/aria-sort/aria-label`、`tabindex` 漫游；`onBodyKey` 方向键移动 + Enter 编辑 + Space 展开；`vFocus` 指令自动聚焦 |

---

## 二、修复的两个构建阻断（重要）

1. **函数名冲突**：新增键盘处理函数原名 `onGridKey`，与编辑矩阵既有 `onGridKey`（绑定在编辑表格 `@keydown`）重名 → 改名 `onBodyKey`，只读表体单元格 `@keydown` 改绑 `onBodyKey`。
2. **`v-if` 链失衡**（二次构建报 1087 行 `v-else` 无配对）：重构把原三分支（只读 `v-if` / 编辑 `v-else-if` / `state-empty` `v-else`）扩成四分支（loading/empty/readonly/edit），使 1087 的 `state-empty` 成为第二个 `v-else` 孤儿。修复：① 空态条件加 `&& !editMode`（编辑模式恒显网格，空网格可粘贴补录）；② 删除孤儿 `state-empty` 块（功能已被新 `tbl-empty` 覆盖）。

---

## 三、部署与产物核验

- **构建**：`npm run build` ✓（1.34s，无错误）
- **部署**：`rsync -a --no-owner --no-group --delete dist/` + `chown -R hergent:hergent` → `RSYNC_FRONTEND_OK`
- **服务端产物核验**（生产 `/opt/hergent-cn-v2/assets/Forecast-CAemnkEU.js`）：
  - `cross-viewport:1`、`vs-spacer:2`、`row-ops:2`、`tbl-skeleton:1`、`tbl-empty:1`、`exp-chev:1`、`aria-sort:2`、`role:"grid":1`、`role:"gridcell":1` —— 全部编入
  - 入口 `index-*.js` 引用 `Forecast-CAemnkEU.js`（懒加载路由生效）

---

## 四、限制与待验证

- 虚拟滚动、行展开、键盘导航、单元格内联编辑均为 **Vue 运行时交互**，无头环境无法真机点击验证，已通过「编译通过 + 产物字面量核验 + 部署可达」三级确认。
- **建议**：登录 hergent.cn → 预报模块 → 选一期次进入汇总视图，实测：①上下滚动超 80 行时是否只渲染可视区；②点行首 ▶ 展开明细；③方向键移动 + Enter 编辑数量；④表头「合计/下单金额/商品」点排序；⑤冻结列下拉；⑥空态/加载态占位。

---

## 五、任务闭环

`#125` T1 行交互 · `#126` T2 展开 · `#127` T3 虚拟滚动 · `#128` T5 行操作 · `#129` T6 排序冻结 · `#130` T4 行状态 · `#131` T7 空加载态 · `#132` T8 键盘 a11y · `#133` 构建部署验证 —— **全部 completed**。
