# Hermes v0.20.6 升级兼容性评估报告

> 生成时间：2026-08-31
> 评估对象：生产 Hermes v0.19.0（/usr/local/lib/hermes-agent/）→ 目标 v0.20.6（GitHub tag v2026.8.27，已克隆至 /tmp/hermes-206-src）
> 方法：对照 hergent-erp 真实调用点（grep 源码）与 v0.20.6 源码，逐条判定 6 个契约点

## 结论（先讲结论）

**v0.20.6 不是 v0.19.0 的平替升级，是破坏性升级。**

已确认 **3 处契约点会断裂**（hergent 不改动就无法工作），1 处兼容，2 处需进一步验证。
这与最初"升级会不会连带出问题"的担忧完全吻合——**会**，除非同时改 hergent-erp 的 3 个调用点并上 staging 验证。

---

## 6 个契约点逐条判定

### ① 对话 SSE：`POST /hermes/v1/chat/completions` —— ✅ 兼容
- hergent 调用点：`server/routers/forecast_config.py:880` `base + "/v1/chat/completions"`；`hermes_core.py` 直连 DeepSeek（与 Hermes 进程解耦，不受影响）。
- v0.20.6：proxy 层 `hermes_cli/proxy/server.py:241` `app.router.add_route("*", "/v1/{tail:.*}", handle_proxy)` —— 仍捕获 `/v1/*` 并转发。
- 判定：**兼容**，无需改动。

### ② Skills 代理：`GET /v1/skills` —— ❌ 断裂（404）
- hergent 调用点（确凿）：`server/routers/ai_skills.py:5` 注释"转发 Hermes GET /v1/skills"；`:26` `url = base.rstrip("/") + "/v1/skills"`。
- v0.20.6：skills 路由已改为 **`/api/skills`**（CRUD，见 `hermes_cli/web_routers/skills.py:430` `@router.get("/api/skills")`）与 `/api/skills/hub/*`。**全仓无任何 `/v1/skills` 路由**（proxy 仅转发 `/v1/*` 到后端，skills 不在 `/v1/` 下）。
- 影响：hergent 的"AI 能力/技能"面板会 404，副驾的 skills 列表拉不到。
- 修复（若升级）：hergent `ai_skills.py:26` 路径改为 `/api/skills`。

### ③ Forecast 根因：`POST /v1/chat/completions` —— ✅ 兼容（同 ①，走 proxy）
- 判定：**兼容**。

### ④ Cron / Memory bridge：`sudo /usr/local/lib/hermes-agent/hermes_cron_bridge.py` —— ❌ 断裂（文件消失）
- hergent 调用点（确凿）：`server/routers/cron_tasks.py:13` `BRIDGE = "/usr/local/lib/hermes-agent/hermes_cron_bridge.py"`。
- v0.20.6：全仓搜不到 `hermes_cron_bridge` 或 `cron_bridge` 任何痕迹（已 `grep -rln` 确认）。cron 机制重构为 `hermes_cli/web_routers/cron.py`。
- 影响：hergent 的定时任务（如每日简报 8:05 推送）走 sudo 调该文件，升级后文件不存在 → 定时任务全挂。
- 修复（若升级）：改 `cron_tasks.py:13` 指向 v0.20.6 的新 cron 入口，或改为调 HTTP `/api/...` cron 接口。

### ⑤ Spreadsheet MCP（std::io server）—— ⚠️ 待验证（取决于 config 迁移）
- hergent 的 spreadsheet MCP 是**自有服务**（`/opt/hergent-mcp-spreadsheet/server.py`），经 Hermes `config.yaml` 的 `mcp_servers.spreadsheet.stdio` 接入。
- v0.20.6 全仓无内置 "spreadsheet" MCP；该契约本质是 **config.yaml 的 mcp_servers schema**。
- 风险点：v0.20.6 配置 schema 已变（见 ⑥），若 `mcp_servers` 键结构被重命名，此映射会失效。

### ⑥ config.yaml schema（`cors_origins` / `api_server` / `platforms` / `mcp_servers`）—— ⚠️ 待验证（高概率需迁移）
- 生产 config 使用 `cors_origins`、`api_server.port/key`、`platforms`、`mcp_servers`。
- v0.20.6：**新增 `hermes_cli/config_migrations.py` 自动迁移系统**（有 `SUPPORT_FLOOR_VERSION`，过旧配置会被拒绝重建）。但新代码 `.py` 中**搜不到 `cors_origins` / `api_server` 旧键名** → 大概率已被重命名。
- 需进一步读 `config_migrations.py` 确认 v0.19→v0.20 是否有覆盖我们旧键的迁移步骤；否则需手改 config.yaml。

---

## 额外发现：架构形态变化
- v0.20.6 新增 **`hermes_cli/proxy/`** 代理子系统（含 nous_portal / xai adapters），部署形态与 v0.19.0 不同，启动方式/监听端口可能变化，nginx 反代（/hermes/ → 18765）需重新核对。
- 仓库体量 259M / 10488 文件 / 4666 .py，远大于 v0.19.0，含 agent/apps/web/plugins 等大量模块——升级本质是换一套更大的运行时。

---

## 升级成本 vs 收益
- **收益**：v0.20.6 新能力（skills hub、proxy、新模型适配等）。但 hergent 近期优化 90% 已与 Hermes 进程解耦（自有 AI loop 直连 DeepSeek），这些新能力对当前业务**直接增益有限**。
- **成本**：至少改 hergent-erp 3 个文件（ai_skills.py、cron_tasks.py、config 适配）+ 全量 staging 验证 + 回滚预案。
- **风险**：配置 schema 重命名若迁移不全，可能连 Hermes 自身都起不来。

## 深度核查补充（2026-08-31 续）：升级规模远超预期

> 用户已确认"想升级"。进一步读 v0.20.6 源码后，发现这**不是版本号替换，而是一次运行时重架构**。

### A. 配置 schema 结构性变更
- 生产 config 用 `platforms.api_server.port/key/cors_origins`（HTTP API server 配置）。
- v0.20.6 中 `api_server` **已被重新定义为一种聊天平台适配器**（`hermes_cli/platforms.py:42` `"api_server" → PlatformInfo(label="🌐 API Server")`）。
- HTTP 端口配置挪到 `platforms.api_server.extra.port`（`hermes_cli/service_manager.py:655`：`API_SERVER_PORT (or platforms.api_server.extra.port)`）。
- 即：旧 `platforms.api_server.port` → 新 `platforms.api_server.extra.port`，且 `key`/`cors_origins` 是否仍被读取**未确认**。配置迁移系统（`config_migrations.py`，`SUPPORT_FLOOR_VERSION=12`）存在，但 grep 未见专门把 `platforms.api_server.*` 旧键迁到 `extra.*` 的步骤 → **生产 config.yaml 大概率需手改 + 验证，不能靠自动迁移。**

### B. cron 机制彻底重构（最危险的断裂）
- 旧：hergent `cron_tasks.py:13` `sudo /usr/local/lib/hermes-agent/hermes_cron_bridge.py <action>`（本地子进程桥接）。
- 新：v0.20.6 **无 bridge 脚本**，cron 改为 **gateway 进程的 HTTP API**（`hermes_cli/web_routers/cron.py`：`/api/cron/jobs` 的 list/create/pause/resume/trigger/delete，挂在 gateway/api_server 上）。
- 修复不是"改路径"，而是**把 hergent 的 subprocess 桥接整个改写成对 Hermes gateway 的 HTTP 调用**，且要求 gateway 常驻 + api_server 绑定 + 可能 JWT。复杂度高。

### C. 进程模型疑似拆分
- v0.19.0 单进程 `hermes serve`（nginx→18765 直连）。
- v0.20.6 出现 `hermes gateway install --system`（systemd 服务）、`gateway/run.py`、gateway + dashboard 多进程 + 可能 s6 监管。部署形态变化，原 nginx→18765 反代需重新核对端口/进程。

### D. 生产机无外网 = 部署硬阻塞（最关键）
- 生产机 `curl github.com` 无响应、无代理 → **无法 `pip install` v0.20.6 依赖**。
- v0.20.6 源码 259MB / 4666 个 .py，依赖需在 **Linux** 环境构建 venv；Mac 上建的 venv 含 macOS 原生 wheel，rsync 到 Linux 生产机**不可用**。
- 落地依赖的可行路径（需择一）：
  1. **临时给生产机开外网** `pip install`（需你授权/操作服务器网络）；
  2. **本地 Docker 起 Linux 容器**构建 v0.20.6 venv + 依赖，再 rsync 整个 venv+源码到生产机（需本机有 Docker，约数 GB）；
  3. 独立 Linux 构建机。

## 升级真实成本重估
| 维度 | 预估 |
|---|---|
| hergent 代码改动 | 3 文件：ai_skills.py（路径）、cron_tasks.py（subprocess→HTTP 重写）、config 适配 |
| Hermes 配置改动 | config.yaml 手改（port→extra.port、key/cors_origins 迁移）+ 迁移验证 |
| 部署 | 需先破解无外网阻塞（Docker 构建 或 临时开网）|
| 进程/反代 | 核对 gateway 多进程 + nginx 端口 |
| 验证 | staging 独立端口跑 6 探针 → 生产切换 + 回滚锚点 |
| 风险 | 高（cron 重写 + config 迁移 + 无外网部署任一环节出错即影响线上副驾/每日简报/Excel对账）|
| 收益 | 低（hergent 90% AI 走自有 hermes_core，v0.20.6 新能力对当前业务直接增益有限）|

## 建议（基于真实规模修订）
1. **维持 v0.19.0（强烈推荐）**：收益/风险严重失衡，且"升级"实为运行时重架构 + 无外网部署工程，不值得为边际收益冒线上中断风险。
2. **若确有 v0.20.6 专属需求**，则升级是**独立工程项目**（非一键升级）：先破部署阻塞 → staging 全绿 → 改 3 文件 → 切生产 + 回滚。预计数小时且需你配合（服务器网络/Docker）。
3. **长期可考虑"去 Hermes 化"**：把 4 个契约点用 hergent 自有代码重写，彻底摆脱外部引擎版本耦合——这是另一项战略工程，与本次"升版本"无关。

## 下一步
- [ ] **待你基于真实规模重新拍板**：维持 v0.19.0，还是启动升级工程（若升，需确认部署阻塞解法：临时开网 / 本地 Docker 构建）
- [ ] 若启动升级：先破部署阻塞（Docker 构建 Linux venv 或临时外网），再建 staging
- [ ] 删除安全隐患：`/tmp/hergent-erp-pre-filter.bundle`（含旧 DeepSeek key，用户未确认）
