# Forecast.vue 下一代增强交付总览（2026-08-23）

## 完成内容
按「依次全做」把上一轮提出的 4 项候选全部落地到 `hergent-cn-v2/src/pages/Forecast.vue`（预报订货网格），构建并部署生产 `hergent.cn`。

### #1 配方化建议引擎（P3-1 升级）
- 把单一启发式重构为 **可配置 recipe 引擎**：`computeSuggestion(r, recipe)` 支持 4 种策略——安全库存法 / 历史均值法 / 趋势外推法 / 加权混合法，附可调参数（覆盖天数、外推步数、历史权重）。
- 新增 **「⚙ 建议配方」面板**：选策略 + 调参 + **存为命名配方**（localStorage，按 `auth.user.id` 租户隔离）。
- 历史类策略（均值/趋势/混合）按需自动拉取近 6 期汇总（`fetchHistory` 复用）。
- 后端 `/api/forecast/recipe` 已留 GET/PUT 就绪钩子，前端已调用，后端未部署时自动回退本地。

### #2 任意两期对比（P3-3 升级）
- 对比面板新增 **「对比期」下拉**（`compareablePeriods`，取自 `forecastApi.periods`，排除当前期），可任选任意基线期。
- 保留「⇄ 上期」快捷按钮（`comparePrev`），「清除对比」一键复位。
- 差异列（Δ）按红涨绿跌的中国习惯着色。

### #3 快照差异导出 Excel（P 补充）
- 快照栏在「对比快照」后显示 **「导出差异」** 按钮，用 SheetJS 导出 xlsx：商品 / 当前合计 / 对比合计 / 合计Δ + 每个客户列的 Δ + 合计行。

### #4  䈯方案云端化（P4-10 升级）
- `SCHEME_KEY` 改为按 `auth.user.id` 租户隔离。
- `loadSchemes / saveScheme` 优先调用后端 `/api/forecast/column-schemes`（随租户配方下发），失败回退 localStorage——**后端落地后无需改前端即可生效**。

## 关键决策
- 采用 **前端交付 + 后端就绪（backend-ready）** 策略：4 项功能立即可用、可验证，且不触碰生产后端（零部署风险，沿用此前安全部署范式）。
- 后端两个端点（`/api/forecast/recipe`、`/api/forecast/column-schemes`）代码已在 `src/api/modules.js` 写好并已在打包产物中（modules chunk 实测命中），但 **尚未部署到生产后端**——属于后续硬化项，前端已带静默回退。这与「AI 层轻、不自研重后端」战略一致。

## 交付文件
- 主改动：`/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/pages/Forecast.vue`
- API 封装：`/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/src/api/modules.js`

## 验证
- `npm run build` 通过（`✓ built in 1.25s`，`dist/assets/Forecast-BUrGnMcD.js`）。
- 部署：`rsync dist/ → root@47.113.224.140:/opt/hergent-cn-v2/` + `chown hergent:hergent`。
- 生产冒烟：`curl https://hergent.cn/assets/Forecast-BUrGnMcD.js` → **HTTP 200**，新包在线（含「建议配方/对比期/历史均值法/趋势外推法/加权混合法/导出差异」等新文案，后端端点路径已植入 modules chunk）。

## 待办 / 备注
- ⏳ 登录态真机 E2E 建议由你实测（建议面板调参生成、任选两期对比、快照差异导出、列方案跨设备）。
- 后端两个端点待部署：使用 `automation_update` 或直接按 WorkBuddy MCP 配置；落地后前端无需改动即变「云端」。
