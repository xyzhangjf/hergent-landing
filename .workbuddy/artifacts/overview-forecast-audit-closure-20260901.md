# 预报订单管理板块审核 — 收尾与 35 项全覆盖映射

> 日期：2026-09-01 ｜ 执行：Senior Developer（高级开发工程师）
> 衔接：2026-07-24 审核报告 + 2026-07-24 端到端修复部署（#208-#215）

## 〇、本轮收尾范围

上一轮已端到端完成 P0×9 + 大部分 P1 并部署验证。本轮补齐审核报告中**剩余的唯一 P1 缺口 B6** 与 **P2 设计令牌违规 C4/C5**，重新构建部署并做生产验证。

| 任务 | 内容 | 状态 |
|---|---|---|
| #217 | B6 加「重置列宽」按钮 + `resetColWidths()` | ✅ |
| #216 | C4+C5 严重度/状态色令牌化（variables.css 新增 `--sev-*`/`--st-*` 等 19 个语义令牌，浅+深双套） | ✅ |
| #218 | 干净 rebuild + rsync 部署 + 生产验证 | ✅ |

## 一、具体改动

### B6（P1）— 列宽记忆重置
- `Forecast.vue` 工具栏新增「重置列宽」幽灵按钮（始终可见，不限于编辑态）。
- 新增 `resetColWidths()`：删除 `localStorage['hergent-forecast-col-widths']` 并清空 `colWidths` ref，toast「已恢复默认列宽」。
- 解决「列宽记忆无法重置、多端布局不一致」的易用性缺陷（报告 B6）。

### C4+C5（P2）— 设计令牌合规
- `variables.css` 新增语义令牌（浅/深双套）：
  - 严重度：`--sev-risk/warn/info/expired` + 对应 `-bg`
  - 报单状态：`--st-draft/submitted/approved/rejected/revised`（bg+txt）
  - 通用：`--ok-green`、`--info-blue`、`--warn-amber`、`--confirm-green`、`--violet`（+`-bg`）
- `Forecast.vue` 替换全部散点硬编码：`#A32D2D / #BA7517 / #9A6B00 / #FBEEDA / #7C3AED / #F3E8FF / #FFF3D6 / #DDF5E7 / #FBE0E0 / #E6EAF2 / #E6F1FB / #2f9e44 / #0e7490 / #e0f2fe / #dc2626` → 对应令牌（覆盖 `.loss-badge / .moq-below / .sev-* / .rt-badge / .tag.st-* / .tag.ok|info|warn / .mini-msg / .heal-row / .oe-福宝 / .confirm-badge / .warn-badge / .delta.down / .range-sel / .bi-num.warn`）。
- 深色主题下所有严重度/状态色自动适配（背景加深、文字提亮），消除原浅底色刺眼问题。

## 二、生产验证（47.113.224.140 / hergent.cn）

| 项 | 结果 |
|---|---|
| hergent.cn 首页 | ✅ HTTP 200 |
| Forecast 分包 JS/CSS 可达 | ✅ 均 200 |
| 重置列宽逻辑（localStorage 键 + toast 文案） | ✅ 生产构建内确认 |
| 令牌引用 `var(--sev-risk)` | ✅ 生产 CSS 内确认 |
| Forecast 组件 CSS 旧硬编码色数 | ✅ **0**（仅 variables.css 令牌声明含原 hex，符合设计） |
| 后端 | 本轮未改，无需重启 |

> 构建真相：Vite 对 Forecast 组件的 JS（BPwc9wz3）与 CSS（CVHt5inP）按各自内容生成不同哈希，属正常分块；全局 index CSS 中的 14 处旧 hex 实为 variables.css 的令牌定义声明，非使用处。

## 三、35 项审计问题 终极覆盖映射

| 类 | 项 | 优先级 | 处置 | 状态 |
|---|---|---|---|---|
| A | A1 all_done 恒真 | P0 | submit_order 按 period_id 关联 | ✅ |
| A | A2 取最新一期误取 | P0 | 按 period_id 取期 | ✅ |
| A | A3 period_id=0 写死 | P0 | audit.save 支持真实 period_id | ✅ |
| A | A4 delete 200 伪错 | P1 | 改 404 + 统一信封 | ✅ |
| A | A5 rebate-gap 恒空 | P0 | 后端补 `balances` | ✅ |
| A | A6 合成行负 id | P1 | 前端屏蔽删除/关闭（id<0） | ✅ |
| A | A7 accuracy 口径 | P0 | 双口径关联+索引 | ✅ |
| A | A8 死代码 | P1 | 删除 forecast.py 双份端点 | ✅ |
| A | A9 payments 未建表吞错 | P1 | 幂等建表 | ✅ |
| B | B1 默认编辑态 | P1 | 默认只读+显式编辑 | ✅ |
| B | B2 软删恢复 | P1 | 删除清单物理删除 | ✅ |
| B | B3 粘贴无提示 | P1 | 模式 toast | ✅ |
| B | **B6 列宽无重置** | **P1** | **本轮加重置按钮** | ✅ |
| B | B4 移动端适配 | P2 | 需设计决策（窄屏降级卡片） | ⏸ deferred |
| B | B5 独立路由 | P2 | 报告已判可接受（标签页） | ⏸ 不处理 |
| C | C1 heatStyle 硬编码 | P1 | → `--heat-*` 令牌 | ✅ |
| C | C2 ReportMapping 独立样式 | P1 | 对齐全局令牌 | ✅ |
| C | C3 深色浅底色 | P0 | → `--sum-*`/`--danger-*` 令牌 | ✅ |
| C | **C4 散点硬编码色** | **P2** | **本轮令牌化** | ✅ |
| C | **C5 状态色语义** | **P2** | **本轮 `--st-*` 令牌** | ✅ |
| D | D1 N+1 ×4 | P0 | 批量 IN 预取 | ✅ |
| D | D2 save_matrix 事务 | P0 | 单一大事务 | ✅ |
| D | D3 reject 空 body 500 | P1 | try/except 截断 | ✅ |
| D | D4 staff stores 非数字 | P1 | 安全跳过/400 | ✅ |
| D | D5 无 Pydantic 校验 | P1 | 部分（D3/D4 已修），全量归 H1a 批次 | ⏸ deferred（部分） |
| D | D6 realtime-warn 全表扫 | P1 | LIMIT 500 | ✅ |
| D | D7 purchase-order max+1 | P1 | UUID | ✅ |
| D | D8 nl-edit 无上限 | P2 | 截断 500 | ✅ |
| D | D9 data-gaps 语义 | P1 | EXISTS 改写 | ✅ |
| D | D10 表无索引 | P2 | CREATE INDEX IF NOT EXISTS | ✅ |
| D | D11 search_products 分页 | P2 | limit=50 + {items,total} | ✅ |
| E | E1 信封混合 | P1 | 存量兼容核对通过 | ✅ |
| E | **E2 RBAC 403** | **P0** | `/api/forecast` 收口 `data` 模块 | ✅ |
| E | E3 已核对通过项 | — | 记录备查 | ✅ |

**结论：P0×9 全 ✅；P1×16 中 15 项 ✅、D5 部分改（归 H1a）；P2×10 中 C4/C5/D8/D10/D11 ✅，B4/B5/D5 余量 deferred/不处理。**

## 四、需确认事项

1. **B4 移动端适配**（P2）：ForecastHistory 固定 `min-width:900px` 无断点。建议纳入「移动端适配」专项（与小程序端协同），需设计决策，本轮未动。
2. **D5 全量 Pydantic**：仅修了 reject/staff-stores 两处，其余裸 `request.json()` 端点属 H1a 统一校验批次，建议单独排期。
3. 本轮属纯前端改动，已干净重建并重新 rsync 部署（含 `--delete` 清理上一轮残留产物），后端未动、无需重启。
