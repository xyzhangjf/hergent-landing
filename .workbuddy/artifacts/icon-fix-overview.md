# 图标规范修复（P1）完成

## 做了什么
按先前图标审查结论，修复了两项 P1 问题并部署到生产（hergent.cn）。

### 1. Forecast 迷你折线硬编码色
- **文件**：`src/pages/Forecast.vue`
- **改动**：SKU 历史趋势迷你折线原 `stroke="#0F6E56"`（硬编码墨绿，不跟随主题、不对应语义）改为按趋势方向着色 —— 新增 `sparkColor(r)`：末值 ≥  ＝→ 涨 → 红 `var(--dan)`，否则 → 跌 → 绿 `var(--suc)`，遵循中国「涨红跌绿」约定。
- 同时修正了编辑过程中的一处笔误（`v - * min` → `v - min`）。

### 2. 图标尺寸归一（对齐 .ico 规范 16px）
- **文件**：`src/components/Shell.vue`、`src/components/CopilotDrawer.vue`
- Shell.vue 顶部主题切换图标 `18px → 16px`；aibar「问 AI 副驾」入口 `15px → 16px`；CopilotDrawer.vue 发送按钮 `17px → 16px`。
- 移动端抽屉 `md-item`（18px，触摸目标）按惯例保留未动。

## 验证
- 构建成功（Shell-DG2Whv8v / Forecast-Bi8-Aprl），已 rsync 至 `/opt/hergent-cn-v2/` 并 chown。
- 生产核对：Forecast 块 `0F6E56` 已无残留、`--dan/--suc` 动态 stroke 已生效；Shell 块主题/aibar 已为 `width:"16"`。

## 其余 P1（架构层）
- 通用图标收口到统一 `Icon.vue` 图标库（消除零散内联 SVG 风格漂移）属更大重构，本次未做，可后续按需推进。

## 备注
- 桌面端 `desktop-app`、小程序 `forecast-order-miniprogram` 不在本次范围（未改动）。
