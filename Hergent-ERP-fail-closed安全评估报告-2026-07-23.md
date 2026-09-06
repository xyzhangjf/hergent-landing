# Hergent Web ERP — Fail-Closed 安全评估报告

> 评估日期：2026-07-23 ｜ 评估人：Senior Developer（高级开发工程师）
> 评估对象：生产运行代码（与 git `upgrade/v84-international` 一致，md5 已校验）
> 评估目的：逐点审查系统的"失败安全"行为——当某个安全检查**失败/缺失/异常**时，是**拒绝访问（fail-closed，安全）**还是**悄悄放行（fail-open，危险）**。

---

## 一、评估方法论

Fail-closed 的定义：**安全控制点失效时，系统应进入"安全状态"（拒绝/报错），而非"开放状态"（放行）**。
本报告对以下控制点逐一审计：

| 控制点 | 审计要点 |
|--------|----------|
| 认证 Authentication | 未登录请求是否会被强制拦截 |
| 租户隔离 Tenant Isolation | 缺失/伪造租户上下文时是否泄漏他人数据 |
| RBAC 角色权限 | 无权限角色是否会被拦截 |
| CSRF | 跨站伪造请求是否被拦截 |
| B1 数据级隔离 | 业务员能否看到他人经手数据 |
| B2 文件上传 | 非法文件是否被拒 |
| 密钥/配置 | 缺失时是否 fail-closed |
| 默认 DB 上下文 | 缺失租户上下文时查询落到哪个库 |

**程序化审计方法**：用脚本扫描 `routers/*.py` 全部 587 个已注册路由，与 `_TENANT_REQUIRED_PREFIXES`（82 前缀）、`_PATH_MODULE_MAP`（79 映射）、`_PUBLIC_PATHS`（11 前缀）做精确 diff，量化覆盖缺口。

---

## 二、各控制点现状与定级

| # | 控制点 | 当前行为 | Fail 语义 | 严重度 |
|---|--------|----------|-----------|--------|
| 1 | 认证（端点级） | `_auth()` 未登录 → 401；但**无全局 auth 中间件**，依赖每个端点手动调 `_auth` | **fail-open（依赖规范）** | 🔴 高 |
| 2 | 租户隔离（中间件） | 已登录跨租户 → 403；但白名单仅 82 前缀，**235 个路由漏隔离** | **fail-open（设计）** | 🔴 高 |
| 3 | RBAC 角色权限 | `if user and not _check_perm` → 403；但 **user=None 时跳过**；且 **37 路由缺映射→默认 dashboard** | **fail-open（设计）** | 🔴 高 |
| 4 | CSRF | cookie 鉴权缺 token → 403；Bearer 豁免（正确） | fail-closed ✓ | 🟢 低 |
| 5 | B1 业务员隔离 | 强制 operator_id 过滤 + 防伪造 | fail-closed ✓ | 🟢 已验证 |
| 6 | B2 文件上传 | 非白名单/超大/伪装的 400 拒 | fail-closed ✓ | 🟢 已验证 |
| 7 | 密钥/配置 | ERP_SECRET/AI_API_KEY 未设直接报错 | fail-closed ✓ | 🟢 低 |
| 8 | 默认 DB 上下文 | `set_tenant_context(None)` → 主库 erp.db（空表） | 保守但有隐患 | 🟠 中 |

---

## 三、程序化审计结果（关键证据）

```
ROUTE_COUNT: 587
TENANT_REQ_PREFIXES: 82   ← 仅这些前缀被强制租户隔离
PUBLIC_PREFIXES: 11
RBAC_KEYS: 79
[A] 漏租户隔离（不在白名单、非 public）: 235 条
[B] 租户隔离内但 RBAC 模块映射缺失（默认 dashboard）: 37 条
```

### 3.1 A 类：漏租户隔离的高危子集（节选）

以下路由**读写真实业务数据**却不在 `_TENANT_REQUIRED_PREFIXES`，中间件会走到 `else: set_tenant_context(None)` 走主库——

- **专属价/客户**：`/api/customer-prices`、`/api/customer-frequent`、`/api/statements`（对账单）、`/api/contracts`
- **商品体系**：`/api/product-variants`、`/api/product-suppliers`、`/api/product-categories`、`/api/product-barcodes`
- **价格/促销**：`/api/price-lists`、`/api/price-schemes`、`/api/volume-discounts`、`/api/promotions`
- **供应商**：`/api/supplier-prices`、`/api/supplier-ratings`、`/api/supplier-scorecard`
- **发票/对账**：`/api/invoice-scan/*`、`/api/invoice-auto/*`、`/api/reconciliation/*`
- **单据/审批流**：`/api/documents/*`、`/api/approval-workflows`、`/api/approval-steps`、`/api/bpm/*`
- **智能/分析**：`/api/bi/*`、`/api/forecast/*`、`/api/ai-learning/*`、`/api/reports/designer/*`
- **导入（B2 落地处）**：`/api/import/*`（preview/execute 均漏隔离）

> 当前单租户（仅 `tenant_1` 在用）下，主库 `erp.db` 业务表为空 → 这些路由主要表现为**功能失效（返回空/错）**，暂未造成跨租户泄漏。但架构是 fail-open：**一旦启用第二个租户，这 235 个路由立即成为跨租户数据通道。**

### 3.2 B 类：RBAC 模块映射缺失（37 条完整清单）

这些路由已在租户隔离内（不跨租户），但 `_PATH_MODULE_MAP` 无对应项 → 模块默认 `"dashboard"` → **任何拥有 dashboard 读权限的角色（几乎所有角色都有）都能越权访问**：

```
/api/assembly/{create,list,{aid},{aid}/confirm,{aid}/void}
/api/backorders
/api/barcode/{history,product/{barcode},scan-in,scan-out}
/api/document-archive/{index/{period},retention/check,search,stats,tags,upload,{aid}}
/api/payment-import/{import,imports,match}
/api/print/{direct/{doc_type}/{record_id},output/{tid}/{record_id},paper-sizes,preview/{tid},templates,templates/{tid},templates/{tid}/duplicate}
/api/safety-stock/calculate/{product_id}
/api/salary-send/{channels,history,preview/{employee_id},send}
/api/timeline/generate
/api/voucher-templates/{events,seed,test,{tid}}
```

> **B 类是当前即可被利用的越权**：与租户无关，任何已登录用户只要 role 有 dashboard 权限即可访问上述接口（如打印单据、扫描条码、发工资）。

---

## 四、Fail-Closed 改造优先级

### 🔴 P0 — 必须改（收益大、改动小）

**P0-1：新增全局认证中间件**
对所有 `/api/`（除 `_PUBLIC_PATHS`）强制：若 `_get_user()` 返回 None → 401。
- 根除"端点忘记调 `_auth`"的 fail-open。
- 成本：低（一个中间件 + 复用已有 `_PUBLIC_PATHS`）。
- 风险：需核对 `_PUBLIC_PATHS` 覆盖所有真公开端点（登录、健康检查、bot、webhook 等）。

**P0-2：RBAC 默认拒绝（修 B 类）**
将 `_PATH_MODULE_MAP` 的默认模块从 `"dashboard"` 改为**未映射即 403**。
- 37 个路由立即被保护；迫使每个路由显式声明模块。
- 成本：中（需补全合法模块的映射，避免误杀正常功能）。

**P0-3：租户隔离默认拒绝（修 A 类）**
将 tenant 中间件逻辑从"白名单放通、其余走主库"改为：**所有 `/api/` 业务路由必须显式在 `_TENANT_REQUIRED_PREFIXES`，否则 403**（public 例外）。
- 235 个漏隔离路由立即被保护。
- 成本：中（需在测试环境验证功能不被误伤，业务路由应全部纳入白名单）。

### 🟠 P1 — 应改（纵深防御）

- **P1-1**：RBAC 中间件对 `user=None` 显式返回 401（而非 `if user and ...` 跳过），与 P0-1 形成纵深。
- **P1-2**：收窄 CSRF 对 `/api/v1/` 的整前缀豁免——确认 v1 路由全部用 Bearer，否则按具体路径豁免。
- **P1-3**：tenant 中间件未登录分支简化（P0-1 上线后，未登录请求在 auth 中间件即 401，tenant 中间件无需再处理未登录分支）。

### 🟢 P2 — 建议

- **P2-1**：`set_tenant_context(None)`（缺失租户上下文）改为返回 403 而非静默走主库，让隔离真正 fail-closed。
- **P2-2**：静态兜底路由 `/{path:path}` 对未知 `/api/*` 路径返回 404 而非 index.html，避免混淆。

---

## 五、当前风险定级（单租户现状）

| 风险类型 | 当前是否可利用 | 说明 |
|----------|----------------|------|
| B 类角色越权（P0-2） | **✅ 现在就可利用** | 任何登录用户可越权访问 /api/print、/api/barcode、/api/salary-send 等，与租户无关 |
| A 类跨租户泄漏（P0-3） | ⏸ 暂未暴露 | 单租户下主库空表→功能失效；启用第二租户后立刻升级为高危 |
| 端点漏认证（P0-1） | ⚠️ 取决于代码 | 未全量审计 587 端点，但架构无兜底，存在匿名可访问风险 |

**结论**：在最关键的"多租户数据隔离"维度，系统目前是 **fail-open 设计**（依赖前缀白名单完整性）。B1/B2 已完成的部分是 fail-closed 的典范，但租户隔离与 RBAC 两个核心控制点仍是 fail-open，需按 P0 改造。

---

## 六、下一步建议

1. **立即实施 P0-1 + P0-2**：这两个改动小、收益大，能堵住最大的越权面（角色越权现在就可利用）。
2. **P0-3 在测试环境先行**：改动租户白名单可能影响功能，建议先在 staging 验证 235 个路由纳入隔离后的行为。
3. **全量端点认证审计**：配合 P0-1，确认无端点绕过认证（可用脚本静态扫描端点是否调用 `_auth/_admin/_auth_perm`）。

> 注：本报告仅评估"失败安全"语义，未涉及 SQL 注入、XSS、SSRF 等其他漏洞类别，也未做渗透测试。
