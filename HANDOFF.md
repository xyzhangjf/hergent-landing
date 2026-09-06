# Hergent 项目交接文档（2026-08-16 更新）

> 本文件是**接手人的第一入口**：产品现状、代码位置、部署真相、踩坑记录、待办清单。
> 之前的 CLAUDE.md 内容（Electron 桌面版规范）已归档到 `backup/`，**桌面版已冻结非主产品**，勿再按它开发。
>
> **本次更新（2026-08-16）**：补齐「金蝶/畅捷通 OAuth 数据源适配」全链路 —— T7 批次效期映射、T8 定时同步、T9 引擎适配（销售单/采购单/库存同步）后端已上线，连接中心新增**金蝶卡片**。详见第五节「数据源适配器」与第七节待办。

---

## 一、产品现状（一句话）

**Hergent = 低温奶经销商的 AI 经营副驾（B2B SaaS）**，Web 版为主产品，预报小程序为移动端补充。不做厚 ERP——解决老板高频痛点：预报订货、货损、工资、对账+催收、指标达成、返利。

## 二、代码位置（两套独立代码，勿混）

| 部分 | 位置 | 说明 |
|------|------|------|
| **后端（主）** | `/Users/zhangjunfeng/Documents/hergent-erp/server/` | FastAPI + SQLite，分支 `upgrade/v84-international` |
| **Web 前端（主）** | `/Users/zhangjunfeng/Documents/laozhangai-product/hergent-cn-v2/` | Vite + Vue3 + 原生 JS，13 个页面 |
| **预报小程序** | `/Users/zhangjunfeng/Documents/laozhangai-product/forecast-order-miniprogram-20260812T023419087Z/miniprogram/` | 原生微信小程序（4 页面） |
| 桌面版（冻结） | `desktop-app/` | Electron「AI 员工操控电脑」，**已暂缓，非主产品** |
| 行业技能 | `hergent-industry-skills/` | 4 个行业技能的源（部署到 Hermes） |

## 三、生产部署真相（必读，血泪教训）

- **生产**：`hergent.cn`（Web）+ `erp.hergent.cn` 同源，nginx root=`/opt/hergent-cn-v2`（前端）/ `/api/` → 8700（后端）。
- **后端部署**：git 仓库 `server/` 是源，须 **flatten** 进 `/opt/hergent-erp/`：
  ```bash
  rsync -a --no-owner --no-group --exclude=static --exclude=__pycache__ \
    --exclude='*.pyc' --exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' \
    server/ root@47.113.224.140:/opt/hergent-erp/
  ssh ... "chown -R hergent:hergent /opt/hergent-erp && rm -rf __pycache__ && systemctl restart hergent-erp"
  ```
- **⚠️ 致命陷阱**：`server/` 含本地开发期 DB 快照（`erp.db/tenant_1..8.db`），**rsync 绝不带 `*.db`**，否则覆盖生产主库 → `database disk image is malformed` 崩溃。恢复源=每日备份 `/opt/hergent-erp/backups/tenant_N_YYYYMMDD.db`。
- **前端部署**：`cd hergent-cn-v2 && VITE_BASE=/ node_modules/.bin/vite build` → `rsync -a --delete --exclude=avatars --exclude=dist dist/ root@47.113.224.140:/opt/hergent-cn-v2/` → chown。
- **健康自查**：`curl -s --noproxy '*' http://127.0.0.1:8700/api/health`（localhost 走代理返 000）；restart 后 sleep 8 等迁移。
- **SSH**：`ssh -i ~/.ssh/id_ed25519 root@47.113.224.140`（服务器无 sqlite3 CLI，用 python3）。
- ⚠️ `/opt/hergent/server/` 是无关另一应用，非 8700 目标；`/opt/hergent-erp-prod` 是旧 frappe 部署可忽略。

## 四、数据库拓扑

- **主库** `erp.db`：认证（users/sessions/user_tenants）、RBAC、种子数据。
- **租户库** `tenant_1..N.db`：业务数据（tenant_1=真实业务：430商品/730客户/580订单/15539订单项/181应收/81采购单）。
- **⚠️ 新表必须惰性建表兜底**（`_ensure_xxx_tables(db)` + 各函数开头调用）——init_db 迁移只在主库跑，v107 前的旧租户库不会自动获得新表（8-16 真实事故：预报表缺失导致填报 500）。

## 五、核心功能地图（2026-08-16 状态）

### Web 端 13 页面（`hergent-cn-v2/src/pages/`）
| 页面 | 路由 | 功能 |
|------|------|------|
| Workbench | /workbench | 经营工作台（KPI/今日/临期/趋势/AI晨报） |
| Forecast | /forecast | 预报订货（AI 建议+草稿+别名配置） |
| ForecastApprove | /forecast-approve | **预报审批**（通过→转采购申请/驳回） |
| Reconciliation | /reconciliation | 对账工作流 + **催收跟进**（新） |
| LossWorkflow | /loss | 货损计算 |
| PayrollWorkflow | /payroll | 算工资 |
| Rebate | /rebate | 目标与返利 |
| DataFill | /data-fill | 数据补录（员工档案+小程序账号/门店+库存导入） |
| ConnectCenter | /connect | **能力中心**（连接器/AI技能库/工作流） |
| Dashboard | /dashboard | 数据看板 |
| CronJobs | /cron | 定时任务 |
| Settings | /settings | 设置 |
| Login | /login | 登录 |

### 后端关键 router（`hergent-erp/server/routers/`）
- `collections.py` — **催收跟进引擎**（新）：分级提醒（到期前3天→逾期14天+）、大额≥3000自动升级、承诺/争议/解决闭环。
- `forecast_submissions.py` — 小程序预报：员工账号/门店绑定/填报/我的/汇总(AI建议)/审批/转采购。
- `forecast_audit.py` — 智能审核大脑。
- `ai_skills.py` — Hermes 技能列表代理（读 .env 的 HERMES_API_BASE/KEY）。
- `data.py` — 商品列表 + **fuzzy-match 黑话匹配** + 别名设置（新）。
- `forecast.py` / `loss` / `hr(payroll)` / `finance(reconciliation)` / `rebate_rules`。

### 小程序 4 页面（`miniprogram/pages/`）
login（手机号+密码）/ fill（填报：门店选择+搜索+别名匹配+加减+提交）/ mine（我的提交）/ summary（汇总总表：AI 建议对比+一键复制）。
老板在 Web DataFill 开账号绑门店 → 员工登录填报 → 老板 Web 审批 → 转采购申请。

### Hermes AI 引擎（生产 v0.19.0）
- systemd `hermes-gateway.service`，api_server 仅 loopback `127.0.0.1:18765`，nginx `/hermes/` 代理注入 Bearer key。
- **工具入口**：Hermes 动态发现 `/opt/hergent-erp/erp_db.py` 的函数——新增 AI 可调用能力=在该文件加薄封装函数（如 `cash_overview()`）。
- **curator** 已激活（每 7 天自动审查 agent-created 技能）。
- 模型 `deepseek-v4-flash`；.env 的 `DEEPSEEK_API_KEY` 是生产 LLM key（新，旧 AI_API_KEY 已吊销）。

### 数据源适配器（金蝶 / 畅捷通 OAuth 同步 · 2026-08-16 上线）

让 Hergent 完整对接金蝶云星空 / 畅捷通 T+（OAuth + OpenAPI 型 ERP），多租户隔离、凭据加密、数据真正落到租户库并被 6 大引擎消费。

**后端代码位置**（`hergent-erp/server/`）：
- `datasource_store.py` — 统一凭据表 `datasource_bindings`（主库 `erp.db`），`save_binding/load_binding/delete_binding/list_all_bindings`；凭据 AES 加密落库。
- `kingdee_connector.py` / `chanjet_connector.py` — OAuth 授权 URL、token 交换、状态查询；各对象 mapper（`map_product/map_contact/map_inventory/map_sales_order/map_purchase_order`）。
- `sync_writer.py` — `sync_source(source, client, map_product, map_contact, objects, modified_after, tenant_id, map_inventory, map_sales_order, map_purchase_order)`：内部 `set_tenant_context(tid)` 锁定写 `tenant_{id}.db`（**零越权**）；关联解析（商品/联系人先有本地 id，经 `products/contacts` 的 `source`/`source_id` 反查）；幂等 upsert（库存去重键 `(product_id, warehouse_id, batch_no)`；订单头按 `order_no` UNIQUE，items「DELETE 旧 + INSERT 新」）。
- `routers/datasources_v2.py` — `/api/datasources/v2/{kingdee|chanjet}/{connect,callback,status,disconnect,sync}`；`sync` 默认对象 `["products","customers","suppliers","inventory","sales_orders","purchase_orders"]`。
- `scheduler.py` — `_sync_all_datasources()` 复用每分钟 loop 框架（`start_scheduler()` 启动），遍历 `list_all_bindings()` 逐租户 `set_tenant_context(tid) → sync_source(ALL_OBJECTS) → finally set_tenant_context(None)`；间隔由 `DATASOURCE_SYNC_INTERVAL`（默认 3600s）控制；单租户失败 `try/except` 不阻断其他租户。

**任务完成情况**：
| 任务 | 内容 | 状态 |
|------|------|------|
| T1/T2 | 畅捷通 connector + 路由端点 | ✅ 已完成 |
| T3 | 统一凭据表 `datasource_store`（金蝶/畅捷通重构复用） | ✅ 已完成 |
| T4 | 前端畅捷通连接卡 | ✅ 已完成 |
| T5 | 同步写租户库 + 越权守卫 `assert_tenant_write_scope` | ✅ 已完成 |
| T6 | 定时同步调度骨架 | ✅ 已完成（T8 补全真实遍历） |
| T7 | 批次/效期映射到 `inventory`（表已含 `batch_no`/`expiry_date`，**未补列**直接 upsert） | ✅ 已完成 |
| T8 | 定时同步机制（全租户遍历 + 间隔变量） | ✅ 已完成 |
| T9 | 引擎适配：销售单/采购单/库存同步到租户库 | ✅ 已完成 |
| T4b | 前端**金蝶卡片**（连接中心新增「金蝶 / 云星空」） | ✅ 已完成（2026-08-16） |

**验证**：本地 `tests/test_tenant_sync_full.py` **15 passed**（覆盖 inventory 批次效期写入、idempotent upsert、销售/采购单带 items、scheduler 全租户遍历）；生产 `rsync flatten + chown + restart`，`/api/health`=200；`/api/datasources/v2/kingdee/*` 路由存在（401=RBAC fail-closed 正确）。

**⚠️ 待补**：生产端到端真实 OAuth 同步（需配置 `KINGDEE_APP_ID/APP_SECRET` 或 `CHANJET_APP_KEY/SECRET` 真实凭据 + 某租户授权回调）。当前生产**未配置真实凭据**，故只验证了代码路径与 auth 网关，未跑真实数据落库。

## 六、踩坑记录（新增，防重复）

1. **SQLite 默认值必须用 `CURRENT_DATE`/`CURRENT_TIMESTAMP`**，`date('now')` 报 "default value is not constant"。
2. **租户库无 users 表**（在主库）——跨库 JOIN 会报 "no such table"，人名等主库数据在 router 层单独查补。
3. **sqlite3.Row 不可赋值**（`r["x"]=1` 报错）——遍历时先 `dict(r)`。
4. **新角色必须加进 RBAC**（core.py `_DEFAULT_PERMS`），否则 403（staff 角色 = data/chat/stock）。
5. **urllib 带 data 默认 POST**——测 PUT 端点必须显式 `method='PUT'`，否则 404 误判。
6. **新表惰性建表兜底**（见四），`get_db()` 只读语义——写完必须 `db.commit()` 或 `get_db_tx()`。
7. **前端规范**：app.js 只读不写、新功能走 js/modules/IIFE；Vite 构建后 contenthash 自动失效缓存。
8. **微信小程序**：project.config.json appid=touristappid 可直接导入开发者工具；app.js 里 apiBase 可切本地调试。
9. **sync_writer 多租户写库铁律**：`sync_source()` 内部必须 `set_tenant_context(tid)` 后才能写业务表；**绝不**直接写主库 `erp.db`（否则越权 + 6 引擎读不到）。越权守卫 `assert_tenant_write_scope(source=...)` 在路由层前置校验。
10. **pytest 跨用例状态污染**：SQLite 连接缓存（`db.connection._sqlite_cache`）+ 模块全局 `DB_PATH/DB_DIR` 被前序测试改后未彻底清理，会导致后续测试 `_reset()` 只删 `tenant_*.db` 而主库 test.db 残留 → 新测试 `total` 全 0。**修复**：`_reset()` 必须关闭并清空 `_sqlite_cache`/`_sqlite_in_use` 后，**glob 删除 DB_DIR 下所有 `*.db/*.db-wal/*.db-shm`（含主库）**再 `db.init_db()` 重建。单跑通过≠全集通过，改测试务必全集 `pytest` 验证。
11. **inventory 表已含 `batch_no`/`expiry_date`**（erp_db.py）：货损引擎按 `product_id` JOIN 读取，T7 直接 upsert 即可，**勿补列**（避免存量租户库 schema 分叉）。

## 七、待办清单（2026-08-16）

- [x] **金蝶/畅捷通 OAuth 数据源适配（T1–T9 + 金蝶卡 UI）**：全链路后端 + 前端已上线，本地 pytest 15 passed、生产 health 200、路由 401 fail-closed 验证通过。
- [ ] **生产真实 OAuth 同步验证**：配置 `KINGDEE_APP_ID/APP_SECRET` 或 `CHANJET_APP_KEY/SECRET` 真实凭据 + 某租户授权回调，跑一遍 inventory/销售单/采购单真实落库，确认 6 引擎（预报/货损/工资/对账/指标/返利）能消费。
- [ ] **GitHub 推送**：本地 13 个 commit 未推（企业微信API.docx 里两个 ghp_ PAT 已失效，需用户提供新 PAT 或修代理节点）。
- [ ] **商业验证**（最高优先级）：找 2-3 个经销商朋友演示产品（用真实数据：126 万应收/预报小程序/工资），验证付费意愿。
- [ ] 生产真实走一遍小程序填报→审批→转采购（留真实 AI 留痕）。
- [ ] 预报审批加"当前库存 vs 预报量"对比列（P1，小改进）。
- [ ] 对账引擎催收的"消息触达"（企微/微信推送）——当前仅系统内队列，通道未启用。
- [ ] 产品叙事：六引擎拟人化命名（"6 个 AI 员工"），对齐 Hermes 品牌。

## 八、关键凭据位置（勿外泄）

- 生产 .env：`/opt/hergent-erp/.env`（ERP_SECRET/DeepSeek key/Hermes key，权限 600）。
- GitHub PAT / 阿里云 AK / 企微 Secret：`/Users/zhangjunfeng/Documents/企业微信API.docx`（**PAT 已失效待更新**）。
- Hermes 生产 key：`hergent-prod-gateway-key-2026`（nginx 注入，不暴露前端）。

---

*交接人：AI 协作开发（2026-08-16）· 项目记忆详见 `.workbuddy/memory/2026-08-16.md`（日更）与 MEMORY.md（长期）*
