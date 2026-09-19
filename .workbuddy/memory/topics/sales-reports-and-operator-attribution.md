# 员工业绩 / 提成 / 龙虎榜 —— 「按人归属」口径

> 2026-09-15 立。**改任何「按业务员/经手人统计」的功能之前必读。**

## 唯一实现（v168，`erp_db.py`，`employee_account_map` 之后）

```
SO_ACTIVE_STATUSES = ('delivered', 'signed')   口径常量（与 profit/sales/BI 报表同一套）
sales_roster()          名单：**主库** users ⨝ user_tenants（带租户收口），同名账号合并
sales_roster_index()    匹配索引（by_name / by_username / by_uid / by_key）
sales_operator_owner()  operator_id 任意存法 → (归组键, 是否绑定账号)
sales_operator_stats()  唯一数据源：按人聚合 sales/orders/customers/order_received/cash_income
```

消费方（全部走它，别再自己写 SQL）：

| 端点 | 函数 | 文件 |
|---|---|---|
| `/api/reports/salesperson` | `get_salesperson_report()` | `erp_db.py` |
| `/api/reports/sales-leaderboard` | `get_sales_leaderboard(month)` | `erp_db.py` |
| `/api/reports/commissions` | `calculate_commissions(month)` | `erp_db.py` |
| `/api/dashboard/full` 的 `leaderboard` | `get_sales_leaderboard(month)` | `db/queries/reports.py`（**惰性委托** erp_db） |

> `db/queries/reports.py::get_sales_leaderboard` 曾是**第二份拷贝**（同 bug 独立演化）。
> 它被 `db/queries/finance.py::get_dashboard_full()` 调用 —— 即 `/dashboard/full` 的龙虎榜
> 走那条路。现已委托，两条路径恒等。**反向 import 会成环**
> （erp_db → db.queries.finance → db.queries.reports），所以必须函数体内惰性 import。

## 匹配序（`sales_operator_owner`）

① 精确 `display_name` → ② 精确 `username` → ③ 纯数字 → `uid` → ④ 都命中不了 → **原样返回**。

第 ④ 类 **bound=False 单列一行**（`（未填写经手人）` 用于空串），**绝不丢弃**。
因此 **Σ(sales) 恒等于该期间全量订单金额** —— 改这块必须复跑这条断言。

## 三个必踩的坑

1. 🔴 **名单不能读租户库的 `users`**。那是主库 `users` 的历史副本：`tenant_1.db` 里 6 行，
   含 4 个主库根本没有的幽灵账号（`accountant`/`sales`/`warehouse`/`driver`）——
   它们**永远登不进去**（登录走 `/api/auth`，属 `_TENANT_PUBLIC_PREFIXES` →
   中间件强制 `set_tenant_context(None)` → 读主库）。真实的 boss/mptest 反而不在里面。
   → 名单一律 `core._master_db()` + `user_tenants.tenant_id` 收口。
2. 🔴 **`operator_id` 存的是人名，不是 id**。`sale_orders` 580 单全为 `'张俊峰'`；
   `routers/sales.py::_operator_for_role()` 注释明写「用 display_name，与历史订单/RMA 一致」。
   任何 `operator_id = CAST(users.id AS TEXT)` / `str(users.id)` 的写法**必然恒为 0**。
   （注意 `purchase_orders.operator_id` 存的是 `'1'` 这种数字 —— **逐表确认，别推广**。）
3. 🔴 **客户去重必须「按 key 合并后单查」**，不能把各 raw `operator_id` 行的
   `COUNT(DISTINCT customer_id)` 相加 —— 一个 key 可能由「人名」与「数字 id」两行合并而来
   （实测同一客户被算成 2）。

## 口径细节（别无意改掉）

- `salesperson` 是**全时段**（无 month 参数），`leaderboard` / `commissions` 是**月度**，
  缺省 = **当月**（不是「最近有数据的月份」）。当月无单 → 榜单为空 + `has_data=False`，
  这是**正确**的，不是 bug。要看历史月传 `?month=YYYY-MM`。
- `leaderboard` 的三个 top 榜**过滤 0 值**（「本月无单」时返回 `[]`，而不是「🥇某某 ¥0」）；
  `commissions` **不过滤 0**（是工资表，全员列出更有信息量）。
- `received`（订单级 `SUM(received_amount)`）与 `payments`（`cash_flow` income）是**两个来源**，
  别合并：tenant_1 的 `sale_orders.received_amount` 全 0 且 `cash_flow.operator_id` 全为空串
  → 回款率/回款冠军为 0 **是数据缺口，不是计算错误**。

## 生产基线（tenant_1，2026-09-15 修复后）

```
Σ报表 = ¥2,141,396.50（580 单，与 sale_orders 全量逐分相等）
2026-06 销售冠军 = 张俊峰 ¥455,352.92；提成命中金牌(3%) = ¥13,660.59
2026-04/05/06 有单；2026-07 起无单（故当月榜为空）
```

## 提交与部署

- commit `6a3def9`（backend，2 文件 +227/−61）；生产 md5
  `erp_db.py=a934a81652536f95ee009048a05320e2`、`db/queries/reports.py=6839a986a44e486555cafb7cb4955bd5`
- 验证：隔离副本树（`cp` 全树，DB_PATH 自动落副本）E2E **39/39 全绿**；生产只读核验 ALL_GREEN
