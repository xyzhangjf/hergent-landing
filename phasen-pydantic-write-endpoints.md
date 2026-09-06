# Phase N：Pydantic 推广到核心高危写接口（建采购单 / 收发货 / 收付款）

> 延续 Phase L（/api/chat、/api/correct 试点）与 Phase M（建单/建商品/建客户），本阶段把入参校验扩展到另一批**真正写库**的核心接口。

## 改动概览

| 接口 | 路由文件 | 校验模型 | 拦住的风险 |
|---|---|---|---|
| 建采购单 | `routers/purchase.py:create_purchase` | `PurchaseItem` + `PurchaseOrderCreate` | 行项缺 `quantity`/`unit_price` → 旧代码 `it['quantity']` KeyError→500 |
| 入库 | `routers/inbound.py:create_inbound` | `StockItem` + `InboundOrderCreate` | `quantity` 缺/非法静默成 0 入库 |
| 出库 | `routers/outbound.py:create_outbound` | `StockItem` + `OutboundOrderCreate` | 同上（出库方向） |
| 收付款 | `routers/finance.py:create_payment` | `PaymentCreate` | `amount` 默认 0 → 生成脏现金流行并动账户余额 |
| 预付款 | `routers/finance.py:create_prepayment` | `PrepaymentCreate` | `amount` 默认 0 |

## 设计要点（与 Phase M 一致）

- **`model_config = ConfigDict(extra="allow")` + `model_dump(exclude_unset=True)`**：精确保留旧 `**d` 透传语义——未发的字段不插 NULL、前端多发的列/extra 全部保留。
- **付款/预付款 `amount: float = Field(gt=0)`**：必填且 > 0，直接挡住"0 元/负数付款"这类会污染财务账的脏数据。
- **收发货 `quantity: float = Field(gt=0)` 无 default**：缺或非法（如 `"abc"`）→ 422；旧代码 `it.get('quantity',0)` 缺字段会静默成 0。
- 校验失败：`raise HTTPException(422, detail=pydantic_error_detail(e))` → 走 Phase L 全局处理器 → 安全信封 `{success:False, error, trace_id}` + `X-Trace-Id` 头，**内部错误零泄露**。
- 非法 JSON（`request.json()` 异常）→ 400。

## 验证结果（直连生产 `:8700`）

```
采购单 quantity=0      → 422 参数校验失败: items.0.quantity Input should be greater than 0  (trace_id 无泄露) ✓
采购单 缺 items        → 422 参数校验失败: items Field required                                    ✓
入库 quantity=0        → 422 参数校验失败: items.0.quantity Input should be greater than 0        ✓
出库 quantity="abc"    → 422 参数校验失败: items.0.quantity ... unable to parse string as a number  ✓
付款 amount=0          → 422 参数校验失败: amount Input should be greater than 0                  ✓
预付款 缺 amount       → 422 参数校验失败: amount Field required                                   ✓
受控有效采购单(draft)  → 200 (oid=167, total 7.0)，清理后残留=0                                     ✓
四类 viz 回归          → 全部 200                                                                ✓
```

本地 pydantic 模型测试（`/tmp/test_models_n.py`）全 PASS：5 个模型均 非法→ValidationError、合法→`model_dump(exclude_unset=True)` 正确（含 `type` 字段、extra 透传、quantity 强转浮点）。

> 说明：**付款/预付款的有效路径不在生产执行**（会动账户余额并生成凭证，风险高），其校验正确性由本地模型测试 + 生产 422 测试覆盖；DB 调用本身与旧代码逐字相同。

## 部署资产

- 备份：`routers/{purchase,inbound,outbound,finance}.py.bak-<ts>`（4 文件）
- 改动：`routers/purchase.py` / `routers/inbound.py` / `routers/outbound.py` / `routers/finance.py`（新增 BaseModel 校验）；`core.py` 未改（Phase M 已加 `pydantic_error_detail`）
- 服务：`systemctl restart hergent-erp` → active

## 累计覆盖

Phase L(2) + M(3) + N(5) = **10 个接口**已接 Pydantic 校验。剩余 ~270 路由多为读接口或低频写接口，按需推广。

## 仍待解（跨阶段一致）

1. 逐端点仍返 `200+success:False` 而非 `4xx`（契约问题）。
2. 未知 `/api/*` 被 SPA 兜底吞成 200 HTML。
3. 租户中间件 `except` 后静默放行（fail-open，需评估安全策略）。
4. `tags`/list 等复合字段前端须传字符串（DB 不支持 list 绑定，既有约束）。
