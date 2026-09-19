# 技能路由（38 条 user-level）

> 由 `MEMORY.md` 迁出（2026-09-19，为压索引页长度）。
> `-frontend-*` 一律指**新前端 hergent-cn-v2**；旧前端 `static/`（erp.hergent.cn）另有标注。

## 上线 / 构建 / 提交

- `hergent-frontend-deploy-verify` —— 前端（hergent-cn-v2）构建 + rsync + **双侧 md5** 验收
- `hergent-prod-deploy-e2e` —— 后端部署（flat `/opt/hergent-erp` 布局 + rsync 展平 + 权限）
- `hergent-scoped-commit` —— **脏工作区**里只提交本轮改动（先读文首「🧭 导航」）

## 新增页面 / 模块

- `hergent-cn-v2-add-module` —— 在 hergent.cn 新增业务模块（后端路由 + 前端页 + 三处接线）
- 旧前端 `static/`：`hergent-frontend-add-module` · `hergent-vite-landing` · `hergent-frontend-fetch-consolidation`

## 预报主表 / Excel

- `hergent-forecast-column-registry` —— 主表增删一列；删列前核查「会不会连同功能一起删掉」
- `hergent-import-mapping-confirm` —— Excel 导入加「列映射确认」界面并**改判真生效**
- `hergent-forecast-import-verify` —— 端到端验证导入（真实接口 + 隔离沙箱 + 逐列对账）

## 前端故障

- `-frontend-layout-capacity` —— 工具栏/表单/页头「能否单行」实测与控件间距
- `-dom-structure-diagnosis` —— 主内容空白 / 布局塌陷 / 侧栏不见
- `-zindex-diagnosis` —— 浮层被压 / 元素凭空浮在上面
- `-dead-control-diagnosis` —— 控件看得见但点了没反应
- `hergent-chart-render-verify` —— 图表柱子几何与颜色；证明前端没镜像后端算法

## 样式治理

- `-css-globalize` —— scoped 样式上提为全局层 + 死 CSS 甄别
- `hergent-workbuddy-ui-align` —— 按 WorkBuddy **真实 CSS** 对齐规格
- `hergent-emoji-to-icon-sweep` —— 全站 emoji/符号 → 统一 `<Icon>` 线性 SVG

## 小程序

- `hergent-miniprogram-privacy-audit` —— 隐私申报 ↔ 代码调用 ↔ 弹窗 ↔ 平台申报 四处一致性；改名同步；提审前自查

## 数据与库

- `hergent-authorized-prod-data-write` —— 用户显式授权的生产库改写（直连 DB / 走真实 API 两路）
- `hergent-tenant-schema-sync` —— 租户库 vs 主库 schema 对账（补表 / FTS5 / 回填索引）
- `hergent-sqlite-table-rebuild` —— SQLite 改列类型/约束（官方 12 步重建表）
- ⭐ `.workbuddy/tools/sandbox_tenant.py` —— 隔离租户沙箱真机验证（**id ≥ 9997**，只能在服务器跑）

## 诊断族

- `hergent-tenant-isolation-audit` —— 自注册链路 + 租户隔离 + 越权向量
- `hergent-data-staleness-diagnosis` —— 数据不更新 / 页面没刷新 / UI 语义缺陷
- `hergent-capability-reality-audit` —— 某能力/配置「到底有没有真的到用户面前」
- `hergent-write-failure-diagnosis` —— 写操作报「失败」（三轴：几个请求 / 文案谁写的 / 后端全部失败点）
- `hergent-rebate-caliber-consistency` —— 口径不一致（分子分母不同源 / 归组键错配 / 阈值硬编码）
- `hergent-page-change-log` —— 给业务页加字段级「修改日志」
- ⭐ `.workbuddy/tools/role-registry-consistency-check.py` —— **清单一致性回归护栏**（角色/权限清单 vs
  后端 `core.py::_DEFAULT_PERMS` **AST** 权威源；`ROLE_REG_EMPARCHIVE=/tmp/broken.vue` 指向副本做判别力自证）
- ⭐ `.workbuddy/tools/employee-supervisor-role-verify.js` —— 员工档案角色**真机探针**（沙箱 9997，真实 UI 建号）

## 门禁 / 协议 / 网关 / 外部数据

- `hergent-write-entry-gate` —— 给写入口加「前置条件门禁」（服务端硬拒 + 前端禁用并说明原因）
- `hergent-ai-card-protocol` —— 副驾卡片/fence 协议排障
- `hergent-hermes-tenant-diagnosis` —— Hermes 多租户网关（IM 渠道 / LLM key 继承）
- `hergent-external-data-source` —— 接外部数据源并做成「每年自动更新」（三层降级）

## 对账 / 资金流水

- `hergent-recon-engine-build` —— **构建 + 验收确定性对账算子**（上传 A vs 上传 B）。
  含：七步分工红线（算归代码、AI 禁止比对）· 🔴 **用报告自己给的组数反推人工算法** ·
  两类列布局 · 导出文件元信息行/合计行陷阱 · 符号不可翻转 · `bisect` 有序性事故 + 规模回归 ·
  **单测全绿 ≠ 引擎对** · 「人工报告自己就有错」的验收口径 · MCP 复用后端与生产 importlib 坑

## 文档 / 表格 / 流程

- `hergent-excel-attachment-to-schema-design` —— 业务 Excel → 主表/模版设计
- `local-xlsx-xml-minimal-write` —— 往既有 xlsx 补值**不破公式**（zipfile 原位最小写）
- `product-dev-sop` —— 产品开发 SOP（立项 / 大改动 / 事故复盘）
- `workbuddy-*-internals` —— WorkBuddy 连接器 / 提示词系统勘察

---

**技能库待整理**：`hergent-prod-deploy-e2e` 已成杂物箱；巨型技能全无 `references/`；诊断族命名不统一。
