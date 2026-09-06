# 预报页「仅显示有报单」筛选 — 交付概览

## 交付
为本期预报交叉表新增"仅显示有报单"筛选：勾选后隐藏**填报数量为 0** 的商品行，仅保留数量 > 0 的记录，方便用户对结果查看、复制、导出。

## 变更（hergent-cn-v2/src/pages/Forecast.vue）
- 新增 `hideZeroReport`（ref，默认 false）与 `zeroReportCount`（computed：全量行中 `rowSum(r)<=0` 的数量）。
- 复选框置于「表格设置 ⚙」弹层，与"显示AI建议"并列：`<input type="checkbox" v-model="hideZeroReport"> 仅显示有报单`。
- 过滤逻辑三处统一生效：
  1. `rowVisible()` —— 网格渲染（核心过滤入口，`renderModel` 已依赖追踪 `hideZeroReport`，实时生效）。
  2. `filteredRowsForExport()` —— 导出 Excel。
  3. `copyAll()` —— 复制下单文本。
  → 筛选后「复制下单 / 导出 Excel」只含筛选后结果。
- 工具栏新增青色状态徽标：`仅显示有报单 · 已隐藏 N 项`（实时显示隐藏数量）。

## 构建 / 部署
`npm run build` → `rsync -a --no-owner --no-group --delete dist/ root@47.113.224.140:/opt/hergent-cn-v2/` → `chown -R hergent:hergent`。新产物 `Forecast-BPZhVM8j.js`。产物核对 `hideZeroReport` / `仅显示有报单` / `已隐藏` 均已落地。

## 对齐效果
- **实时生效**：勾选/取消立即重算表格，不影响其它列（只按行级 `rowSum<=0` 过滤，不改动任何列）。
- **"填报数量"语义** = 该商品行在所有报单单元的合计 `rowSum(r)`；合计 = 0 即"无报单/未报单"，与「复制下单」按单元跳过 0 的既有逻辑一致。
- **便于后续操作**：复制下单、导出 Excel 均尊重该筛选，可直接对筛选结果复制粘贴厂家系统。

## 需确认事项
⚠️ 沙箱未做浏览器真机验证（代理连不上 hergent.cn）。请**硬刷新（Cmd+Shift+R）**确认：
1. 「表格设置⚙」弹层出现"仅显示有报单"复选框；
2. 勾选后零报单商品行消失，工具栏出现青色过滤徽标（含已隐藏数量）；
3. 复制下单 / 导出 Excel 仅含筛选后有报单的商品。

---

## 🐞 修复记录（2026-08-29 第二轮）
**现象**：用户硬刷新后反馈"勾选后零报单商品行没有消失"。
**根因**：预报页存在**两套渲染表格**，靠 `editMode` 切换：
- 只读表（line 460 `<table class="cross-tbl">`）：行源 `vsWindow.items` → `flatItems` → `renderModel` → `rowVisible()`。首轮补丁只改了 `rowVisible`，**只读态生效**。
- 编辑表（line 622 `<table class="cross-tbl edit-tbl">`）：行源 `cross.rows` + `v-show="rowShown(ri)"`。首轮**漏改 `rowShown`**，致编辑态完全不过滤。用户在编辑态测试 → 看似无效。
**修复**：在 `rowShown(ri)`（line 3155）加入与 `rowVisible` 同款的判定 `if (hideZeroReport.value && rowSum(cross.value.rows[ri]) <= 0) return false`，覆盖编辑表。现两种模式均实时过滤。
**部署**：`npm run build` → rsync → chown；新产物 `Forecast-CLfaJBXm.js`。产物核对 `仅显示有报单`/`已隐藏` 各 1 处（编辑表路径已补；`hideZeroReport` 因 esbuild 压缩为短名，源码 line 3155 已确认）。
**教训**：凡涉及"行级过滤/显隐"，必须同时核对只读表（`renderModel`/`rowVisible`）与编辑表（`rowShown`）两条渲染链，缺一不可。
