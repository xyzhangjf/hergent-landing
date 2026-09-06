# 预报单 · 移动端录入契约（P13-9）

> 配套 `forecast-order-miniprogram`：在既有「审批」能力（见 `forecast-miniprogram-approval-contract.md`）之上，扩展**销售现场录单**。
> 战略边界：Hergent 不造 ERP、不拥有交易系统，仅做 AI 经营副驾层；移动端录入经已有 `POST /api/forecast/orders` 落到预报交叉表，回写 ERP 仍走连接器（P10-9）。

## 1. 角色与权限
- **销售（sales）**：现场录入/修改本人名下预报单。
- **督导（supervisor）**：查看所辖销售录入、可修正。
- **经销商（dealer）**：本页 Web 端实时可见所有录入，最终确认提交审批（复用 P9-4 状态机）。

## 2. 录入接口（复用已有）
- `POST /api/forecast/orders`
  - body：`{ period_id, submitter_name, submitter_type:'sales', product_name, quantity, unit, unit_price, notes }`
  - 落库 `forecast_orders`（与 Web 端 `submitOrder` 同源）。
- `GET /api/forecast/orders/{period_id}`：拉取本期全部录入（Web 端 `periodOrders`，本页实时可见）。
- `GET /api/forecast/periods`：拉可选期次（与 Web 端 `periods` 同源）。

## 3. 与 Web 端的数据一致性
- 小程序录入 → `forecast_orders` → Web 端「✅ 审批」看到的 `reportedUnits` 实时增加。
- Web 端编辑网格（`products/bulk-upsert` 主档）与小程序录入互不覆盖：主档是商品字典，录入是期次量。
- 提交审批后状态机：`draft→submitted→approved/rejected→revised`，两端共用 `forecast_config` 的 `approval:{period_id}`。

## 4. 录入页字段（MVP）
- 期次选择（下拉，来自 periods）
- 商品搜索（模糊匹配 `products.name`）
- 数量（箱）+ 单位（默认「箱」）
- 备注（选填，如「竞品促销，少报」）
- 提交即写 `forecast_orders`，并 Toast 成功。

## 5. 待办（不在本期范围）
- 小程序工程内实际新增录入页 + 调用上述接口（本期仅定契约 + Web 端「📱 移动端录单」入口按钮）。
- 录入冲突校验：同销售同商品同期的去重/合并策略。
- 离线录入缓存（弱网门店）——二期。

## 6. 验收
- 小程序录入一条 → Web 端该期次 `reportedUnits` +1 且可在「审批」面板看到。
- 与 P10-10 审批契约共用同一状态机，无重复实现。
