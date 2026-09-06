# 汇总表全屏缩放条

## 需求
汇总表（交叉表 cross-tbl）在全屏模式时，加一个按比例放大 / 缩小的进度条，便于查看数据。

## 改动（hergent-cn-v2 / src/pages/Forecast.vue）
- **状态与函数**：新增 `gridZoom` ref（默认 100），`zoomIn / zoomOut / zoomReset`（范围 50%–200%，步长 10%）；`toggleGridFullscreen` 在退出全屏时自动把缩放重置回 100%，避免下次进入残留。
- **缩放实现**：用 CSS `zoom` 作用在表格上（Chromium 完全支持、滚动不错位）。主表 `.cross-tbl`、合计条 `.col-total-bar`、编辑模式 `.edit-tbl` 都绑定 `:style="{ zoom: gridZoom + '%' }"`，保证列宽同步、对齐不歪。
- **控制条**：工具条内新增 `.zoom-group`（`v-if="gridFullscreen"`），含「－ 滑块 百分比 ＋ ⟲重置」。仅全屏时显示。
- **避让**：全屏时给 `.tbl-toolbar` 加 `padding-right:44px`，避免右上角全屏按钮遮挡缩放条（顺带也修了既有「提示文字被全屏按钮盖住」的问题）。

## 交互
- 全屏后工具条右侧出现缩放组：拖滑块或点 ＋/－ 实时缩放 50%–200%；⟲ 一键回 100%。
- 退出全屏缩放自动归位。
- 汇总表（只读视图）与编辑模式两套全屏都接入。

## 部署与验证
- `npm run build` → `rsync` 至 `/opt/hergent-cn-v2/` → `chown hergent:hergent`。
- 生产产物 `Forecast-BqAJbD5d.js` / `Forecast-C-HgkfYe.css` 已确认含 `zoom-group` / `zb-range` / `gridZoom` / `padding-right:44px` / `accent-color`。

## 备注
- `zoom` 在 Chromium 内核（Chrome/Edge）与较新 Safari 完美支持；Firefox 会忽略（表格按 100% 显示，滑块无效但不报错）。目标用户使用系统 Chrome，符合要求。
- 本次为纯加法 UI（控制条 + CSS zoom），构建/部署/打包均已验证。
