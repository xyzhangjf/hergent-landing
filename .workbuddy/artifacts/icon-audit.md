# Hergent 前端图标规范审查报告 · 2026-08-28

## 审查方法
对照 `src/styles/variables.css` 的设计令牌，核心图标规范为：
- **统一组件 `.ico`**：尺寸 16px、线性（`fill:none`、`stroke:currentColor`、`stroke-width:2`、`stroke-linecap/linejoin:round`）。
- 颜色必须跟随 IDE 主题（深色用浅色、浅色用深色），禁用与主题无关的硬编码颜色。
- 图标库集中在 `src/components/Icon.vue`（Lucide 风格线性图标，24 视窗，`currentColor`）。

## 总体结论
品牌图标（H ergent SVG）已全站统一（顶栏/登录/副驾/favicon），无问题。但**图标尺寸与国际统一度存在不一致**，且有 1 处明显硬编码颜色违规。整体不阻塞，建议按下列清单收敛。

## 问题清单

### 🔴 P1 — 硬编码颜色（必须修）
- **`src/pages/Forecast.vue:686`**：表格内 SKU 历史趋势迷你折线图
  `<polyline ... stroke="#0F6E56" stroke-width="1.5"/>`
  - 问题：`#0F6E56` 是写死的墨绿，不跟随主题、不对应任何语义 token；也不符合「涨红跌绿」中国习惯。深色/浅色下都难以自适应。
  - 建议：改用主题变量（如 `var(--p-dark)` 中性趋势，或按涨跌用 `var(--dan)`/`var(--suc)`），或走语义 token。

### 🟠 P1 — 尺寸不统一（建议收敛）
规范 `.ico` 为 16px，实际全站出现多档：
- 标准 16px：侧边栏、工具栏按钮、CopilotDrawer 多数图标 ✓
- **18px**：`Shell.vue:12` 顶部主题切换按钮（`tb-btn`）
- **15px**：`Shell.vue:29` aibar「问 AI 副驾」入口（与上面是同一类雷达/太阳图标，尺寸却不同）
- **17px**：`CopilotDrawer.vue:189`
- **12px / 11px**：caret 箭头（`Shell.vue:14`、`CopilotDrawer.vue:83`、`CopilotDrawer.vue:157`）— 下拉三角可接受
- **20px**：移动端 `mnav-item`（`Shell.vue:66-69`）— 移动端合理
- **22px**：空态 `.se-ic`（`Rebate.vue:32`、`Forecast.vue:1468`、`Workbench.vue:96` 等）— 空态装饰图标，可接受
- **28px**：`CopilotDrawer.vue:60` 装饰性加载图标（`stroke="var(--p-dark)"`，用主题变量，合规）
- **84×18**：`Forecast.vue:686` 迷你趋势图（数据 viz，非图标）

最高信号：**顶部主题图标（18px）与 aibar 副驾入口（15px）同类却不同尺寸**，以及 17px 这种非标档，建议归一到 16px（或明确 14/20 two-tier）。

### 🟠 P1 — 未复用统一图标库（架构层面）
- 仅 `Forecast.vue` 用过 `<Icon name=...>`，其余页面（Shell / Dashboard / Rebate / CronJobs / ConnectCenter / CustomerArchive / EmployeeArchive / Workbench / CopilotDrawer）均**手写内联 SVG**，导致：
  - 部分缺 `stroke-linecap/linejoin="round"`（如 `Rebate.vue:32`、`CronJobs.vue:59/65`、`ConnectCenter.vue` 多数），与 `.ico`/Icon.vue 规范不一致（线条图标视觉略糙）。
  - 尺寸、风格无法集中管控，易漂移。
- 建议：已在 Icon.vue 覆盖的图标（refresh/edit/download/search 等）统一改为 `<Icon>`；新增图标沉淀进 Icon.vue，避免散落。

### 🟢 P2 — 合规但需注意
- 多数内联 SVG 使用 `stroke="currentColor"`，跟随主题，符合规范 ✓。
- Dashboard 折线/环形图、ResultCard sparkline 用 `var(--t1/t3/p-dark/suc/bg4)` 等显式主题变量，属于数据可视化，合理 ✓。
- Dashboard donut 用 `:stroke="r.color"`（数据驱动分类色），合理 ✓。

## 优先修复建议
1. 修 `Forecast.vue:686` 的 `#0F6E56` 硬编码（P0 视觉风险）。
2. 顶部主题图标与 aibar 副驾入口统一为 16px（或 14/20 two-tier），消除 17px 非标。
3. 逐步把通用图标收口到 `<Icon>`，下线手写 SVG 以减少漂移。

## 已验证
- 品牌图标（H）已被 favicon + 顶栏 + 登录 + 副驾抽屉统一，符合「单一品牌视觉入口」目标。
- 无 `fill="#ffffff"/rgb()` 等字体色硬编码（仅上文提到的 `#0F6E56` 一处）。
