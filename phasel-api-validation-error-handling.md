# Phase L — P0：API 请求校验（Pydantic）+ 错误不吞

> 目标：按审核报告 P0 建议，堵住「注入/越权」与「假成功 / 信息泄露」类坑。纯增量改动，已生产验证。

## 改了什么

### 1. 统一错误信封 + 全局异常处理器（`core.py`）
- `register_exception_handler` 重写：未捕获异常**不再**回传 `str(exc)[:200]`（信息泄露），改为返回
  `{success:false, error:"internal_error", detail:"服务器内部错误…", trace_id}`，完整 traceback 仅留服务端日志。
- 响应头追加 `X-Trace-Id` / `X-Request-ID`，便于前后端关联排障。
- HTTPException 处理器同样加 `trace_id`，保留 `{success, error}` 形状兼容前端。

### 2. `_err()` 安全错误助手（`server.py`）
- 任何内部错误只回通用文案 + `trace_id`，绝不外泄内部路径/栈。
- 替换 4 处散落的 `return {"success":False,"error":str(e)}`（品牌图标保存 / 备份状态 / 备份触发 / 日志读取）→ `return _err("…", log_exc=e)`，服务端记录完整异常。

### 3. Pydantic 入参校验（试点 2 个接口）
- `/api/chat`：`ChatRequest{ text:str(≤4000), role:str(≤32), model:str(≤64) }`
- `/api/correct`：`CorrectRequest{ original:str(≤8000), params:dict }`
- 非法入参 → `422` + 安全信封，不再畸形负载穿透到下游。

## 验证结果（直连生产 `:8700`）

| 场景 | HTTP | 结果 |
|---|---|---|
| 四类 viz（盈亏/专属价/预测/临期） | 200 | ✅ 回归无碍 |
| `/api/chat` text=数字 | 422 | ✅ 拒绝，无泄露 |
| `/api/chat` text=5000 字（超长） | 422 | ✅ 拒绝 |
| `/api/chat` text=list（类型错） | 422 | ✅ 拒绝 |
| 未捕获 500 | 200→500 信封 | ✅ `internal_error`+`trace_id`，无 `str(exc)` |
| backup 等错误接口 | 200 信封 | ✅ 不再外泄内部路径 |

## 踩坑记录
- `_err` 初版误用 `core.err_dict`，但 `server.py` 仅 `from core import …` 未绑定 `core` 名 → `NameError` 把本应 422 变成 500。改为显式 `from core import err_dict` 后修复。

## 遗留（非本次 P0 范围，建议后续）
1. 未知 `/api/*` 被 SPA 兜底路由返回 `200 HTML` 而非 `404 JSON`（应返回 404 JSON）。
2. 租户中间件 `except` 后静默放行（隔离可能失效）——存在「错误吞掉→安全绕过」风险，需谨慎评估 fail-open/closed。
3. 逐端点的错误仍返 `200 + success:false` 而非 `4xx/5xx`（契约问题）。
4. Pydantic 仅试点 2 接口，其余 ~280 路由待推广（建议按写接口优先级推进）。

## 部署资产
- 改动：`/opt/hergent-erp/server.py`、`/opt/hergent-erp/core.py`
- 备份：`server.py.bak-*` / `core.py.bak-*` / `hergent_core.py.bak-*`（本轮）
- 本机编辑副本：`/tmp/prod_server_phaseL.py`、`/tmp/prod_core_phaseL.py`
- 服务：`systemctl restart hergent-erp` → active
