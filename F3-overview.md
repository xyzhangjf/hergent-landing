# F3 按角色裁剪导航 — 完成报告

**日期**：2026-07-23 ｜ **提交**：`5bfb889`(前端) + `50c1809`(后端权限) ｜ **状态**：已部署生产，验证全绿

## 做了什么
为 Hergent Web ERP 实现按角色裁剪侧边栏导航：每个角色只看到自己最核心的模块，导航从"全量 12 项"收敛到精简集。

| 角色 | 可见模块（设计值） |
|---|---|
| admin | 全部 12 项（不变） |
| boss | 采销管理、仓配管理、资金管理、数据报表、客户关系（5） |
| accountant | 资金管理、数据报表、总账凭证、费用管理（4） |
| sales | 采销管理、仓配管理、客户关系（3） |
| guide | 采销管理、客户关系、仓配管理（3） |
| driver | 仓配管理（1） |

## 关键决策（两处差点翻车，已堵住）
1. **缺失声明会崩溃**：实现中 `buildSidebar()` 引用了 `ROLE_NAV`/`AI_TEAM_ROLES` 但声明没真正落到文件 → 会导致整个侧边栏 `ReferenceError` 崩溃。部署前核对 grep 发现，已补声明。
2. **裁剪导航必须同步后端权限**：后端 `server.py:327` 有 rbac 中间件按"路径→模块名"强制 `_check_perm`。前端导航 id `trade` 在后端**没有对应模块**（采销管理拆成 `sales`+`buying` 两套 API）。旧 `_DEFAULT_PERMS` 用 stale id 且缺 `guide`/`driver`，导致 sales/driver/guide 点了会 403。已同步修正 `core.py:_DEFAULT_PERMS`（sales 补 buying+crm；新增 guide/driver），纯增量授权。

## 验证（四层）
- `f3_verify.js`：用**生产库真实权限**跑过滤逻辑 → 各角色模块数符合设计
- `python _check_perm` 模拟：nav→后端模块映射 → 五角色 `ALL_NAV_USABLE`（无 403）
- vm 加载真实 app.js（浏览器 stub）→ 无 LOAD_ERROR
- 服务器 curl：`/`→200、app.js?v=203 含 ROLE_NAV、core.py 新 perms 落盘、service active

## 顺手修掉的既存 bug
旧 `_DEFAULT_PERMS` 用 `sales`/`buying` 导致 boss/accountant/sales 在生产环境**根本看不到「采销管理 trade」/「总账凭证 ledger」/「客户关系 crm」**。F3 + 权限对齐后这些模块正确可见。

## 部署
`git archive HEAD` → scp → 解压 + chown + 清 pyc → `systemctl restart hergent-erp` → 验证全绿。版本戳 `app.js?v=202→?v=203`。`server/server.py` 与 `hergent_cli.py` 为无关 WIP，未纳入。

## 后续可选
- B1+B2（业务员数据隔离 + 文件上传校验）— 安全快赢
- P1（FEFO/临期/专属价）、P2（企业微信 Bot）— 战略项
- `role_permissions` 表仅 `库管` 1 行，boss/accountant/sales 的权限靠 `_DEFAULT_PERMS` 兜底；如需细粒度可在表里配
