# 天气预报面板 — 交付概述

## 本次变更（2026-08-27 晚）
用户参考墨迹天气截图，提出三点优化：
1. **日期标签**：用「昨天 / 今天 / 明天 / 周X」替代纯「周X」
2. **日期显示**：在「周几」下面加 MM/DD 日期
3. **温度折线图**：弹窗顶部加最高温/最低温曲线

### 后端
无改动，继续沿用已部署的 16 天预报接口（`/api/weather`）。

### 前端（`hergent-cn-v2/src/components/WeatherWidget.vue`）
- 新增 `dayLabel(dateStr)` 函数：
  - 与今天差值 `-1` → 昨天；`0` → 今天；`1` → 明天；其余 → 周X。
  - 同时返回 `{text, date}`，`date` 为 `MM/DD`，供列表两行显示。
- 预报列表改为两行标签：`.wx-d-day`（昨天/今天/明天/周X）+ `.wx-d-date`（MM/DD）。
- 新增 `.wx-chart` 区域（弹窗顶部）：
  - SVG 折线图，viewBox `320×100`。
  - 两条 `<polyline>`：高温线 `#ff6b6b`、低温线 `#339af0`。
  - 取前 7 天数据，x 轴等分、y 轴按温度范围线性映射。
  - 每个点标温度数字，底部标日期简写（昨天/今天/明天/周X）。

## 验证
- `npm run build` 通过（Shell 55.45 kB）。
- 前端 rsync/chown 部署完成。
- 生产 SSH：`/api/health` ok；后端仍返回 `days:16`。
- 折线图与日期标签为纯前端渲染，建议硬刷新（Cmd+Shift+R）后在浏览器实测（本机无头浏览器在代理环境下不稳）。

## 累计功能（本会话）
- 顶栏「下午好」与「问 AI 副驾」之间显示天气胶囊。
- 城市按访问者 IP 自动定位（反查中文），可手动搜索任意城市（全汉字），选中存 `localStorage`，「我的位置」按钮恢复 IP 定位。
- 点击弹窗外空白关闭弹窗。
- 预报默认 7 天一屏显示，超过 7 天横向滚动（数据源为 16 天）。
- 弹窗顶部带最高温/最低温 SVG 折线图；列表显示「昨天/今天/明天/周X」+ MM/DD。

## 文件
- `hergent-cn-v2/src/components/WeatherWidget.vue`（前端组件，已部署）
- `hergent-erp/server/routers/weather.py`（后端接口，已部署）
- 注：weather.py / WeatherWidget.vue 仍在未提交工作树，与既有 11 个未推送 commit 同批暂缓推送。
