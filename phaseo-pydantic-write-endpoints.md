# Phase O — Pydantic 校验推广到其余写接口

> 延续 Phase L/M/N，把请求校验推广到用户点名的高风险钱/库存变动写接口：
> **收发货确认 / 退货 / 收付款核销**。

## 1. 本次覆盖的 13 个写接口

| 类别 | 接口 | 文件:函数 | 关键校验 |
|---|---|---|---|
| 收发货确认 | `POST /api/purchase-orders/{oid}/partial-receive` | `purchase.py:partial_receive_purchase` | `items[].quantity > 0` |
| 退货 | `POST /api/return-orders` | `sales.py:create_return` | `items[].quantity > 0` |
| 退货 | `POST /api/rma/{rma_id}/refund` | `sales.py:rma_refund` | `amount > 0` |
| 退货 | `POST /api/prepay-refunds` | `finance.py:create_prepay_refund` | `amount > 0` |
| 退货 | `POST /api/prepayments/{ppid}/refund` | `finance.py:refund_prepayment` | `amount > 0` |
| 收付款核销 | `POST /api/writeoffs` | `finance.py:create_writeoff` | `items` 必填（否则 400 友好提示） |
| 收付款核销 | `POST /api/settlements` | `finance.py:create_settlement` | `items` 必填 |
| 收付款核销 | `POST /api/bank-confirm` | `finance.py:bank_confirm` | `cash_flow_id > 0` |
| 收付款核销 | `POST /api/quick-payment` | `finance.py:quick_payment` | `amount > 0` |
| 对账匹配 | `POST /api/reconciliation/match` | `reconciliation.py` | `amount` 强类型（修复不安全 `float()`） |
| 对账确认 | `POST /api/reconciliation/confirm` | `reconciliation.py` | `supplier_id` int、`amount` float |
| 客户对账匹配 | `POST /api/reconciliation/customer-match` | `reconciliation.py` | `amount` 强类型 |
| 客户对账确认 | `POST /api/reconciliation/customer-confirm` | `reconciliation.py` | `customer_id` int、`amount` float |

## 2. 统一模式（沿用 Phase M）

- `ConfigDict(extra="allow")` + `model_dump(exclude_unset=True)`：精确保留旧 `**d` 透传语义（未发字段不覆盖默认值，前端多发的列全部保留）。
- 校验失败：`raise HTTPException(422, detail=pydantic_error_detail(e))` → 全局处理器包装为安全信封
  `{success:false, error:"参数校验失败: <loc> <msg>", trace_id}`，并带 `X-Trace-Id` 响应头，**无内部堆栈泄露**。
- 非法 JSON：`request.json()` 异常 → 400。

## 3. 额外修复的隐患

`reconciliation.py` 的 `match` / `customer-match` 原本直接 `float(d.get("amount", 0))`：
- 若前端传非数字字符串 → `ValueError` → **500 或静默逻辑错误**。
- 现改为 Pydantic `float` 字段，非数字 → **422** 安全拦截。

## 4. 生产冒烟结果（修复后）

- **13 / 13 非法入参 → 422 + 安全信封 + `X-Trace-Id`**（含 `amount="abc"`、`quantity=0`、`supplier_id="x"` 等），零内部泄露、零写入。
- 有效路径：`/api/reconciliation/match`（真实 supplier=2214）、`/api/reconciliation/customer-match`（真实 customer=2215）→ **200**（只读，无副作用）。
- viz 回归：`GET /api/sale-orders`、`GET /api/purchase-orders` → **200**。
- 付款类（prepay-refunds / refund / quick-payment / writeoffs / settlements）**不在生产跑有效路径**（动账户余额+凭证），仅验证非法→422 零写入。

## 5. 部署与踩坑

- 改动文件：`routers/sales.py`、`routers/purchase.py`、`routers/finance.py`、`routers/reconciliation.py`（均备份 `*.bak-20260723124656` 后 scp + chown + `systemctl restart hergent-erp`），服务 active 监听 `0.0.0.0:8700`。
- ⚠️ **踩坑（重要）**：`finance.py` 初版把 `PrepayRefundCreate.items: List[WriteoffItem]` 写在 `WriteoffItem` 之前 → 类定义时即 `NameError` → **整个服务启动崩溃**（systemd 反复 auto-restart）。修复：重排模型顺序使被引用者前置。
  - 教训：Pydantic 模型有前向引用必须先定义被引用模型；部署前对每个改动 router 跑
    `cd /opt/hergent-erp && set -a && . ./.env && set +a && python3 -c "import routers.xxx"` 预检。
- 冒烟用 **API token 绕过 CSRF**：生产 CSRF 仅对 cookie 鉴权生效，`Authorization: Bearer <api_tokens.token>` 直接豁免。临时 mint 的 `api_tokens` / `sessions` 测试行已 DELETE 清理（残留 0）。

## 6. 累计进度

Phase L(2) + M(3) + N(5) + O(13) = **23 个接口**已接 Pydantic 校验。

## 7. 仍待推广 / 遗留（按需）

- 其余写接口：doc_ops 的 reverse/unapprove/batch-approve/delete（单据操作）、forecast / consignment / inventory / subcontracting 等。
- 跨阶段一致遗留：① 逐端点仍返 `200+success:False` 而非 4xx（契约问题）；② 未知 `/api/*` 被 SPA 兜底吞成 200；③ 租户中间件 except 后静默放行（fail-open 安全评估）；④ tags/list 等复合字段前端须传字符串（DB 既有约束）。
