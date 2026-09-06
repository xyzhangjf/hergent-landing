# P1 其余项 + P2 — 交付报告（2026-08-22）

承接 P1 前端 HTTP 层收编后，用户确认「两个都做」推进 **P1 其余项**（后端禁 `{"error"}` / 抽 `spreadsheet_query` / store 收口 / hermesChat 分级超时）**与 P2**（拆上帝文件 / 强制幂等 / 白名单反转 / Alembic）。

## 一、核心发现（实查纠正评审假设）

| 评审项 | 实查结论 | 处置 |
|---|---|---|
| `return {"error"}` 150 处 | 实际 **103 处**（形态含 `{"error":"x"}` 与 `{"error":"x","type":"error"}`） | 用中间件归一化，不逐个改 |
| 统一信封脆弱 | **真 bug**：`error_envelope`（core.py:306）返回 `{ok,success,data,error,code,error_code}` **无 `detail`/`message`**，前端 `api()` 只读 `detail||message` → 所有信封错误文案丢失 | 修 `error_envelope` + 补 2 处硬编码 401 |
| 白名单反转（默认拒绝） | **已落地**：server.py G2 机制（`_TENANT_REQUIRED_PREFIXES` + 未知 /api → 403，2026-07-25） | 核验，不重做 |
| store 收口（Pinia） | **已落地**：store/index.js 已是 Pinia setup store（A5 迁移），20+ 调用点经兼容单例无需改 | 核验，不重做 |
| 幂等仅可选启用 | **已默认开启**：`check_dupes` 默认 "1"（import products/contacts）+ P0 预报导入/提交幂等 | 核验，不重做 |
| 拆上帝文件 | `erp_db.py` 13478 行 / `server.py` 4521 行属实 | 抽 `spreadsheet_query.py` 为首个实际抽取，全量拆分 staged |

## 二、落地改动（全部已部署 + 生产验证）

### 后端（hergent-erp）
1. **`core.py` `error_envelope`**：增加 `detail`/`message` 字段（= message）。31 处信封调用点 + 中间件错误全部受益；前端 `api()` 不再退化成"请求失败 (status)"。
2. **`server.py` 新增归一化中间件** `error_envelope_normalize_middleware`：把 4xx/5xx 的 legacy `{"error": ...}`（缺 `success`/`error_code`）统一改写为信封 + `LEGACY_ERROR` + detail。**兼容 Starlette 1.x**（生产 Starlette 1.0.0：`call_next` 返回 `_StreamingResponse` 无 `response.body`，改用 `body_iterator` 消费重建；非改写路径恢复原字节避免空 body）。
3. **`server.py` 2 处硬编码 401 信封**补齐 `detail`/`message`（API 卫生）。
4. **抽 `server/spreadsheet_query.py`**（132 行）：`_load_sheets/_to_float/_run_query` 从 `routers/chat_attachment.py` 迁出为共享模块；chat_attachment import 复用。生产 spreadsheet MCP server 复用为后续（独立部署）。

### 前端（hergent-cn-v2）
5. **hermesChat 分级超时**：`client.js` 导出 `CHAT_TIMEOUT_NORMAL=180000` / `CHAT_TIMEOUT_LONG=300000`；`CopilotDrawer.streamReply` 按任务轻重（对账/复盘/汇总/报表/经营分析正则）传 timeout。

### 脚手架（不接线）
6. **Alembic**：**核实已有 v88 脚手架**（`server/alembic/`，env.py 已接 `erp_db._safe_migrate/_connect` + `001_initial_stamp` 基线，`alembic.ini` URL 为占位符=未接线）。本轮补 `server/alembic/README.md`（S1 基线→S2 并行→S3 切换受控接入策略，含双迁移路径与 fail-closed 要求）。**未接线**（防误当迁移入口）。注：曾误建 repo 根 `migrations/` 重复脚手架，已删除收敛到既有 v88 目录。

## 三、部署与 E2E（生产）

- 后端：flatten rsync（**不带 --delete**，防删 `/opt/hergent-erp/static/role-avatars` 等运行期产物）+ chown + 清 `__pycache__` + restart；`health=200`，服务 active。`py_compile` 4 文件 ✓；`spreadsheet_query` 本地功能冒烟（summary/sum/groupby）✓。
- 前端：`vite build` 通过 → rsync dist → chown；新 chunk `Settings-CFdI8Wq_.js` / `modules-DCKdIkR7.js` / `Shell-6CjBMFYL.js` / `index-Kujt_PYQ.js` 全部在线。
- **中间件本地 TestClient 5/5 PASS**（legacy / legacy+type / envelope不动 / 200不动 / detail-only不动）——本地 Starlette 1.3.1 与生产 1.0.0 同 API 家族。
- **生产实测**：
  - `error_envelope` 带 detail：`X-Tenant-Id: abc` → 400 `{...,"detail":"无效的租户ID",...}` ✓
  - legacy 归一化：`GET /api/portal/<无效token>` → 403 `{...,"detail":"链接无效或已过期","error_code":"LEGACY_ERROR"}` ✓（portal 是公开路径，真实触发中间件）
  - 401 带 detail：`GET /api/products` 未认证 → 401 `{...,"detail":"未认证：请先登录",...}` ✓
  - 前端 Shell bundle 含分级超时正则（"经营分析"×2）✓

## 四、残留 / 后续（staged）
- **拆上帝文件全量**：本轮抽 1 个模块（spreadsheet_query）；`erp_db.py` 13478 行按"新功能写对地方、旧代码慢慢搬"继续抽（资产/采购/RFQ/发票等 cohesive 组）。
- **Alembic 接线**：按 `server/alembic/README.md` S1→S3 受控推进（v88 脚手架已存在），需技术合伙人/专职 DBA 评审基线。
- **200-with-error 语义**：部分路由仍 `return {"error":...}`（200），中间件按设计只处理 4xx/5xx；200 态逐站点转换属后续清理。
- **store 直改内部字段**（20+ 处 `store.chat.x=` 绕过 action）：已 Pinia 化但未全量收口到 actions，属样式级优化，低风险低收益，暂缓。

## 五、交付物
- 后端：`server/core.py`、`server/server.py`、`server/routers/chat_attachment.py`、`server/spreadsheet_query.py`（新）、`server/alembic/README.md`（策略补录，v88 脚手架已存在）
- 前端：`src/api/client.js`、`src/components/CopilotDrawer.vue`
- 本报告 + MEMORY/日志更新
- ⚠️ 已部署**未提交**（两个仓库工作区含历史未提交改动，避免混合提交；如需按文件拆分提交请告知）
- ⚠️ 生产 `.env` 已核验完好（md5 与备份一致）；本轮后端部署全程未用 `--delete`（防误删运行期产物，与 deploy.sh 的 `--exclude='.env'` 硬化逻辑一致）
