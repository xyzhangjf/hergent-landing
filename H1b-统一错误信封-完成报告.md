# H1b：统一错误信封收尾 — 完成报告

**负责人**：Senior Developer (高级开发工程师)
**日期**：2026-07-24
**状态**：✅ 已实现 + 已部署生产 + 已 git 提交 + 实弹验证通过

---

## 1. 背景

`core.py` 的 H1b（统一错误信封 `error_envelope` + 全局 500 处理器 + `X-Trace-Id`）此前已上生产，但 `server.py` 仍有两处不一致：

1. **三处中间件错误用旧 `{"detail":...}` 格式**（租户 / CSRF / 限流），与 auth/RBAC 中间件已用的 envelope 形状不统一；
2. **缺 `/api` 404 catch-all**：已知前缀但不存在的子路径（如 `/api/sale-orders/99999/widget`）会穿透到静态 catch-all，返回 SPA 的 `index.html` 并带 `200` —— 错误响应形同成功。

用户明确要求“交付包含**必要的错误处理**、可正常运行的成品”，故本次补全这两处，使全栈错误响应完全一致。

---

## 2. 改动清单（仅 `server/server.py`，commit `e5ee314`，+22/−17）

| 改动 | 说明 |
|------|------|
| 导入 `error_envelope` | `from core import ... error_envelope` |
| 租户中间件 ×4 | `TENANT_REQUIRED` / `TENANT_FORBIDDEN` / `TENANT_INVALID` / `TENANT_CONTEXT_FAILED` 改走 `error_envelope` |
| CSRF 中间件 ×2 | `CSRF_REQUIRED` / `CSRF_MISMATCH` 改走 `error_envelope` |
| 限流处理器 ×1 | `RATE_LIMITED`(429) 改走 `error_envelope` |
| `/api/{full_path:path}` 404 catch-all | 注册在全部具体 `/api` 路由之后、静态 catch-all 之前；已知前缀的未知子路径返回 `404` envelope（`error_code=NOT_FOUND`） |

**设计要点**：
- 完全未知的 `/api/*`（不匹配任何 RBAC 前缀）仍由 RBAC 中间件返回 `403 MODULE_NOT_CONFIGURED` —— 安全意识：不暴露“该路径是否存在”。
- CSRF 对 Bearer token 鉴权默认放行（浏览器不自动跨站附带 Bearer，设计如此）；CSRF envelope 仅对 cookie 会话生效，本地无法用 Bearer 触发，生产真实浏览器流才会走到该分支。
- `core.py` 全局 500 处理器（envelope + `X-Trace-Id`）此前已部署且未改动，本次仅补全中间件 / catch-all 一致性。

---

## 3. 验证结果

| 验证项 | 结果 |
|--------|------|
| 本地 TestClient smoke | catch-all `404` / RBAC `403` / auth `401` / Pydantic `422` 全部 envelope；`HTTPException(400)` 经 `http_exception_handler` 转**完整** envelope `{ok:false,success:false,data:null,error,code}` |
| pytest（仓库根） | 321 passed / 28 skipped / 1 预存失败（`test_invalid_tenant_id_rejected`，与本次无关） |
| 生产实弹 47.113.224.140:8700（临时 boss Bearer token） | prepay-refunds / bpm/definitions / salary-send/history / salary-send/channels 仍 **200**（H4 无回归） |
| 生产 404 catch-all | `/api/sale-orders/99999/widget` → **404** envelope，消息为自定义“接口不存在”→ 证明新 `server.py` 已加载 |
| 生产 RBAC | `/api/zzz` → **403** `MODULE_NOT_CONFIGURED` envelope |
| 生产 auth | 无 token → **401** `UNAUTHENTICATED` envelope |
| 生产 400 | `POST /api/prepay-refunds`(空 body) → **400** 完整 envelope（含 `ok/success/data:null`） |
| token 清理 | 临时 Bearer token 已 DELETE |

---

## 4. 铁律遵守

停止服务 → 干净 `tar` 备份（`/tmp/hergent-backup-20260724132748.tar.gz`，356MB）→ 精确 scp `server.py`（禁通配符）→ `chown hergent:hergent` → `find -name '*.pyc' -delete` → `systemctl restart hergent-erp` → 冒烟验证（含 H4 回归）。

---

## 5. 错误响应统一现状（最终）

| 场景 | HTTP | envelope / error_code |
|------|------|----------------------|
| 未认证 | 401 | `UNAUTHENTICATED` |
| 路径未配置模块 | 403 | `MODULE_NOT_CONFIGURED` |
| 角色无权限 | 403 | （角色提示） |
| 缺租户上下文 | 403 | `TENANT_REQUIRED` |
| 无权访问租户 | 403 | `TENANT_FORBIDDEN` |
| 无效租户ID | 400 | `TENANT_INVALID` |
| 租户上下文失败 | 500 | `TENANT_CONTEXT_FAILED` |
| CSRF 缺失 / 不匹配 | 403 | `CSRF_REQUIRED` / `CSRF_MISMATCH` |
| 触发限流 | 429 | `RATE_LIMITED` |
| 未知子路径 | 404 | `NOT_FOUND` |
| 参数校验失败 | 422 | （字段明细） |
| 未预期异常 | 500 | envelope + `X-Trace-Id` 响应头 |

---

## 6. 仍待办（沿用 MEMORY.md）

1. 用户拍板：guide 是否需 `data` / accountant 是否需 buying·stock / `user` 角色去留 / 真实仓管=`库管`。
2. P0-3 租户隔离默认拒绝（测试环境先行）。
3. `gl_dimensions` 功能缺口（`db.gl_dimension_*` 系列未实现，解析 500 已修但功能仍 500，独立待修）。
4. 生产库 `sale_order_items` 0 行（数据问题）。
5. GitHub `--force` 推送 `upgrade/v84-international`（已领先 origin 5 个 commit）。
