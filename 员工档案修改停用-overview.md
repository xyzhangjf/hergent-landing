# 员工档案「修改 + 停用」功能 — 交付概述

## 完成内容
员工档案管理新增「修改」与「停用/启用」能力并已在生产上线。

### 后端（`hergent-erp/server`）
- `server.py`
  - 列表端点 `GET /api/employees` 增加 `include_inactive` 参数，支持含停用员工。
  - `PUT /api/employees/{eid}` 放开 `name` 字段修改（此前不允许改姓名）。
  - 新增 `POST /api/employees/{eid}/toggle`：软停用/启用，联动 `users` 表（按 `employee_code` 同步 `is_active`，禁用小程序账号）。
- `erp_db.py`：`employee_list(department_id, include_inactive)` 在 `include_inactive` 为真时不再过滤 `is_active=1`。

### 前端（`hergent-cn-v2`）
- `src/api/modules.js`：`employeeApi` 重写 `list(params)` 手动拼查询串（`api()` 请求层不支持 `params`），新增 `update`、`toggle`。
- `src/pages/EmployeeArchive.vue`：
  - 操作列加「编辑」「停用」「启用」按钮；停用行灰化 + 「已停用」标签；账户列标示「小程序已禁用」。
  - 新增「编辑员工」完整弹窗（12 字段：姓名/工号/岗位/入职日期/身份证/开户行/银行账号/社保城市/社保基数/公积金基数/底薪）。
  - 新增「停用确认」弹窗（提示停用后果：不计入工资 + 小程序账号禁用）。
  ­ `loadEmployees` 改为拉取全部（含停用）。

## 关键决策
- 用户确认：先做员工档案（推荐），客户档案「修改+停用」留作 P1（待客户真实列表页建成，复用 `contacts.store_status`）。
- 「修改」采用完整编辑弹窗（非行内轻改）。
- 底层 `hr_employees.is_active` 已存在，无需改表结构。

## 验证
- 后端 `py_compile` 通过；`bash deploy.sh` 后 `GET /api/health` 返回 200。
- 前端 `npm run build` 成功（新 chunk `EmployeeArchive-DE66U0Nr.js`），rsync + chown 已上线；`https://hergent.cn/assets/EmployeeArchive-DE66U0Nr.js` 返回 200。
- ⚠️ 浏览器真机 e2e（编辑改名 / 停用灰化 / 启用恢复 / 小程序账号连带禁用）尚未执行 —— 需要线上登录态（token），沙箱无凭据。

## 后续 / 注意
- 用户需硬刷新（Cmd+Shift+R）后在「档案管理 → 员工档案」实测。
- 真实数据在 tenant_1；演示登录进入 tenant_10。
- P1：客户档案真实列表页 + 修改/停用（复用 `contacts.store_status`）。
- 若需我跑真机 e2e，请确认登录凭据（或允许我加载浏览器技能 + 提供账号）。
