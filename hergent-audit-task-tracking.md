# 赫金特 × WorkBuddy 对比报告 — 任务与功能项完成度分析

> 分析对象：`hergent-audit-workbuddy-comparison.md`（审计基准 2026-07-22 生产实测）
> 分析日期：2026-07-23
> 重要说明：本报告写于 2026-07-22，而我们（Senior Developer）在之后已落地 Phase L→O。下文**已把实际完成情况与报告建议状态对齐**，凡报告列为"待做"但已落地的，均标注为「已完成（报告滞后）」。

---

## 一、报告基线速览（实测指标）

| 维度 | 实测值 | 对照 WorkBuddy |
|---|---|---|
| 前端代码 | index.html 2059 / styles.css 5334 / app.js 4265 / 各模块合计 ~12.6k 行 | 模块化组件库 |
| 前端构建 | **无构建系统**（无 package.json/vite/webpack） | 托管运行时 + 资源优化 |
| 可访问性 | 全站仅 **30** 处 a11y 标注 | WCAG 2.1 AA 全覆盖 |
| 响应式 | styles.css 仅 **7** 个 `@media` | mobile-first + 断点系统 |
| 状态管理 | app.js 中 **87** 处 localStorage + 全局 window | 集中 store + 记忆/任务 |
| CSP | index.html **0** 处 CSP | CSP + 沙箱 + 最小权限 |
| ERP 后端 | server.py **2949 行 / 289 路由** 单文件平铺 | 按域模块化 |
| 后端校验 | Pydantic/BaseModel **0** 处（报告时） | typed schema + 版本化 |
| 错误处理 | **14** 处 `except Exception` 宽捕获 | 结构化错误 + 可观测 |
| 数据库 | SQLite 单文件；无连接池；迁移非幂等 | 连接池 + 幂等迁移 |
| 主题切换 | ✅ 实测存在 system/light/dark + `setTheme()` | 统一设计令牌 |

---

## 二、已完成项（✅）

报告正面清单 + 我们后续补完的部分，共 **7 类**：

| # | 功能项 | 来源/阶段 | 说明 |
|---|---|---|---|
| 1 | 右栏 Artifacts 交付物面板 | 报告正面清单（Phase A/B） | 对标 WorkBuddy Artifacts |
| 2 | 提示词增强按钮 | 报告正面清单 | 对标 WorkBuddy Enhance |
| 3 | 三栏布局 + 连接中心 | 报告正面清单（Phase D–G） | 产品形态已同频 |
| 4 | 连接器 manifest + `IServiceConnector` 抽象 | 报告正面清单（Phase J） | 可插拔雏形已落地 |
| 5 | 主题切换 system/light/dark | 报告正面清单 | 实测 `setTheme()` 存在 |
| 6 | `ERP_SECRET`/AI key **fail-closed** + 连接器凭据 Fernet 加密落库 | 报告正面清单（Phase J） | 安全底层已达标 |
| 7 | **错误不吞（分层异常 + trace_id）** | **报告 P0#3，Phase L 已落地** | 全局异常处理器改写安全信封 + `X-Trace-Id` 头；散落 `str(e)` 改为 `_err()` 助手。**报告滞后，实际已完成** |

> 说明：报告把"错误不吞"列为 P0 待办，但我们在 Phase L 已实施（全局 `register_exception_handler` 去 `str(exc)` 外泄 + `X-Trace-Id`；`_err` 替换 4 处 `return {success:False, error:str(e)}`）。这是与报告状态的**关键偏差**。

---

## 三、未完成项 — 按优先级分类

### 🔴 高优先级（High / 报告 P0：先止血防坑）

#### H1. API 请求校验（Pydantic）— **✅ 已完成（2026-07-23 续推收尾：所有活跃写接口已校验，详见第七节）**
- **报告建议**：289 路由全部接入 Pydantic/FastAPI 依赖注入，做校验 + 文档自动生成；统一响应信封；`/api/v1` 版本前缀。
- **⚠️ 重大发现（2026-07-23 推进 H1a 时核对生产真相）**：先前声称的「~79 个写接口已接入 Pydantic」**实际全部丢失**——生产 `/opt/hergent-erp/routers/{workflow,sales,inventory,finance}.py` 经核对 Pydantic 标记均为 **0**。根因：(1) 先前的部署 `&&` 链断裂，部分 router 编辑从未落到线上根目录；(2) 即使落地的 edits，后续也被回滚成原始文件（`.bak` 备份里仍能看到 sales 13 标记 / finance 25 标记的历史已部署版本，但线上当前为 0）；(3) H1b 改写 `core.py` 时**误删了 `pydantic_error_detail` 函数**，导致依赖它的 router 一旦重新部署会 `ImportError`——本回已补回该函数。
- **当前实际（本轮回补后）**：生产已重新具备 Pydantic 校验的写接口：
  - **本轮回补（已部署生产并验证 markers 持久化）**：
    - `routers/sales.py`：恢复 13 标记版本（4 写接口：batch-deliver / batch-sign / quotations / 等）
    - `routers/finance.py`：恢复 25 标记版本（~25 写接口：payments / prepayments / expense / income / writeoffs / 等）
    - `routers/consignment.py`（新增，3 模型 / 4 写接口：agreements / receive / consume / settle）
    - `routers/subcontracting.py`（新增，3 模型 / 3 写接口：orders / issue / receive）
    - `routers/assembly.py`（新增，3 模型 / create 校验 + /{aid}/confirm·void 走 FastAPI 路径 int 校验）
  - **发现为死代码（未注册，编辑无效，已还原原始）**：`routers/disassembly.py`、`routers/scrap.py` —— `server.py` 从未 `include_router`，与早前 `doc_ops.py` 同属休眠高危代码。是否激活待用户决定。
  - **本回合（2026-07-23 晚）再次补回并落库（关键）**：`routers/workflow.py`(21 标记)、`routers/inventory.py`(17 标记)、`routers/purchase.py`(采购单/分批/收货校验)、`routers/crm.py`(拜访/漏斗/合同/专属价等 contact_id 必填) 均已重新部署并 **commit 进 git**（详见下方「H1a 续」批量部署冲掉未提交改动根因）。
  - **已落地的防护模式**：`amount>0` / `quantity>0` / 名称必填 / 负值拦截 / 凭证 entries 非空 / 批量 `table+ids` 校验 / cost-center `ref_type` 防 500（在已恢复的 sales/finance 中生效）
  - **统一响应信封（H1b 错误路径已完成 2026-07-23；成功响应包裹待前端协同迁移）、`/api/v1` 版本前缀未做、未知 `/api/*` 返 404（H1b 已完成）**。
- **关键缺失点**：
  1. 写接口已覆盖：sales/finance/consignment/subcontracting/assembly/workflow/inventory/purchase/crm（共 9 路由 + core H1b）。**剩余裸奔 ACTIVE 路由**：hr/recruitment/forecast/forecast_router/tax/payment_run/salary_send/platform/projects/consolidation/bpm/gl_dimensions/rfq/auth/bi/reconciliation/sso/print_templates/voucher_templates/vehicles 等（~289 路由多数仍无校验）。读接口仍无校验。
  2. 逐端点仍返回 `200 + {success:False}` 而非 `4xx`（契约不一致）→ 属 H1b；
  3. 未知 `/api/*` 被 SPA 兜底路由吞成 200/405 HTML（路由黑洞）→ 属 H1b；
  4. 无 API 版本前缀，未来破坏性变更无法灰度。
- **预期目标**：核心写接口 100% 校验；统一响应信封；`@app.exception_handler` 把业务异常映射为规范 `4xx`；未知 `/api/*` 返回 404 JSON 而非 HTML。

#### H2. 前端 CSP + 限流中间件 + CORS 白名单 — **✅ 已完成（已部署生产并验证 2026-07-23，详见第七节）**
- **报告建议**：nginx 层加 CSP（兼容内联 SVG 用 nonce/hash）；引入 slowapi 限流；CORS 显式白名单；统一认证中间件。
- **当前实际**：前端 index.html 仍 **0 处 CSP**；限流仅 10 处零散、CORS 仅 3 处无白名单、无 helmet。
- **关键缺失点**：内联 SVG 可视化卡存在 XSS 面；无刷接口防护；跨域无白名单易越权；明文密钥文档风险（`企业微信API.docx` 存多种 key）。
- **预期目标**：部署 CSP（nonce 兼容内联 SVG）、全局限流中间件、CORS 白名单、密钥移出明文文档进密钥管理器，降低 XSS/注入/刷接口面。

#### H3. DB 连接池 + 迁移幂等（去 duplicate column 刷屏）— **✅ 已完成（2026-07-23 上线，详见第七节 H3 小节）**
- **报告建议**：迁移框架（Alembic）或把 `_safe_migrate` 全量落地为幂等；引入连接池；补索引。
- **改动 2 文件**（`server/erp_db.py` + `server/db/connection.py`，均 commit 进 git + 部署生产根）：
  1. **H3.1 幂等迁移**（commit `1c37c3c`）：`_safe_migrate`/`_safe_migrate_script` 先查 `_migrations` 表 `status='ok'` 跳过；遇 `duplicate column name`/`already exists`/`duplicate index` 等幂等型 DDL 报错 → 静默记 `ok`、不打印错误，启动刷屏根除。
  2. **H3.1b 历史 ALTER 路径**（commit `2711490`）：~40 个 `_migrate_vXX` 旧函数用裸 `executescript`/`ALTER` + 各自 `except: print("[Migration] FAILED: ...")`，未走 `_safe_migrate`；新增 `_migration_log_error(e, name)` 统一吞掉幂等型报错、只打真实失败。
  3. **H3.2 连接池**（commit `3be2e19`）：`db/connection.py` 新增**按线程缓存的 SQLite 连接池**（key=`(thread_ident, db_path)`，默认 `check_same_thread=True` 合法、不跨线程共享）；`get_db()`/`get_db_tx()` 不再每次 `connect`，回调用 `_sqlite_return(conn)`（缓存连接留用/复用连接计数递减并关闭）；重入安全（同线程嵌套 → 一次性连接，不污染缓存）。
- **验证证据（生产实测 47.113.224.140:8700）**：
  - 启动 `[Migration] FAILED` 行数：**171 行/次 → 2 行/次**（仅剩 2 条真实非刷屏错误，见下）。
  - 健康 `GET /api/health` = 200；`_migrations` 表 `ok=205` / `failed=17`。
  - 连接池冒烟：6 次健康读 200 + 真实建联系人写 `{"success":true,"id":2926}` 200 + 列表 200，**零**池错误（无 `database is locked` / 无 `check_same_thread` / 无 traceback）；测试联系人已清理。
- **🔴 残留 2 条真实迁移错误（非刷屏，建议跟进）**：
  1. `v89_products_barcode_unique: UNIQUE constraint failed: products.barcode` —— 业务**数据**里存在重复条码值（真数据冲突，值得告警而非忽略）。
  2. `default value of column [created_at] is not constant` —— 旧版 SQLite 不支持非常量 `DEFAULT` DDL 的历史遗留限制（环境相关，非代码缺陷）。
- **关键缺失点（报告中其余项仍未做）**：高频查询补索引（26→更多）未做；Alembic 迁移框架未引入（按需幂等改写已达标，不必强上框架）；并发写仍受 SQLite 文件锁限制（L1 Postgres 方向）。
- **预期目标达成度**：启动稳定（刷屏消除 ✅）、连接复用/池化 ✅、迁移失败仅 warn 不中断 ✅；补索引待 H3 后续或并入 L1。

#### H4. 订单明细导入（解领域引擎）— **✅ 已完成（2026-07-24 上线，详见第七节 H4 小节 + `H4-订单明细导入完成报告-2026-07-24.md`）**
- **报告建议**：补齐 `sale_order_items` 导入，解锁 M1/M3/M4 领域引擎（盈亏/专属价/预测卡填真值）。
- **当前实际（本轮回补后）**：三子任务全部落地并生产验证：
  - **H4.1 订单明细导入**：新增 `sale_order_item_create(order_id, product_id, quantity, unit_price, db_conn=None)`，导入事务内写 `sale_order_items` 并**自动重算 `total_amount`（保留 discount）**；实测导入 2 行 → `success=1`、`total_amount=17.5`。
  - **H4.2 gl_dimensions 完整 CRUD**：从零补齐此前 500 的 `/api/gl/*`——新建 `db/queries/gl_dimensions.py`（维度+维度值 CRUD + 维度试算 + 扩展科目表），重写 `routers/gl_dimensions.py`（Pydantic 必填校验 + 补回缺失 `PUT` + 清晰 400/404/409）。
  - **H4.3 重复条码冲突检测与告警**：批次内重复 + 已存在库冲突双检测；新建专用 `barcode_conflicts` 表存完整明细（修复首版误写 `alert_history` 真实 schema 外列导致的 500）；支持 `detect`(预览) / 扫库 `barcode-duplicates` / `list` / `export`(CSV) / `resolve`(标记已处理)；生产扫库发现 **9 组**真实重复条码（含 v89 椰乳冲突）。
- **提交**：`0ccf972`（主）、`6c77d76`（H4.3 修复冲突专用表）。
- **验证证据**：health 200；gl CRUD 200/409/404；order_items 导入 `total=17.5`；条码冲突 list/export/resolve 全通；正常商品导入回归 `success=1` 无回归；临时 token/测试数据零残留。
- **关键缺失点（数据层，非代码）**：生产库 `sale_order_items` 仍 **0 行**——导入通道已通，需用户侧导入真实订单明细，领域引擎才能跑真值。
- **预期目标达成度**：导入通道 ✅、gl CRUD ✅、条码冲突告警 ✅；领域引擎真值待用户导数据。

---

### 🟡 中优先级（Medium / 报告 P1：体验与可维护）

#### M1. 前端 Vite 构建（minify / code-split / 缓存破坏）— **未实现**
- **关键缺失点**：无构建系统，CSS/JS 未 minify、未 hash 缓存破坏、未 code-split；发版依赖用户"硬刷清缓存"。
- **预期目标**：引入 Vite 做打包 + minify + `?v=hash` 缓存破坏（替代手工 bump 版本戳）；按路由/组件 code-split；首屏关键 CSS 内联；首屏目标 <1.5s，Lighthouse 性能分↑。

#### M2. 组件化 + 集中状态 store — **未实现**
- **关键缺失点**：纯 vanilla JS IIFE，`app.js` 4265 行巨石，7 个 JS 靠 `window.xxx` 全局挂载；87 处 localStorage 直接读写无集中 store；Phase C 仅实现"半套"状态归一。
- **预期目标**：按 Alpine.js/Lit Web Components 拆组件；跨组件通信用中央 EventBus/Alpine store 替代散挂 `window.*`；把"当前角色/聊天历史/连接器状态/主题"归一为单一状态树，竞态 bug↓。

#### M3. 响应式系统化（断点 token / 容器查询）— **未实现**
- **关键缺失点**：styles.css 仅 7 个 `@media` 块，对 5000+ 行样式覆盖薄；移动端靠 `max-width` 退单栏，无系统断点/容器查询。
- **预期目标**：建立断点 token（sm/md/lg/xl）；移动优先重写核心布局；`clamp()`/容器查询替代魔法值；"≤1024 右栏转抽屉、≤768 隐藏右栏"沉淀为统一规则，移动/平板体验↑。

#### M4. 可访问性全量标注（aria-live / focus trap）— **未实现**
- **关键缺失点**：全站仅 30 处 a11y 标注；无 skip-link、无 focus 管理、无 `aria-live`（AI 流式回复应被读屏播报）、对比度未系统验证。
- **预期目标**：全量标注交互元素（button/input/dialog/tab 的 role+aria）；AI 回复区加 `aria-live="polite"`；对话框 focus trap；跑 WCAG 2.1 AA 对比度检查，合规风险↓。

---

### 🟢 低优先级（Low / 报告 P2：规模化）

#### L1. Postgres + 读写分离 / 无状态化 — **未实现**
- **关键缺失点**：SQLite 文件锁限制并发写；会话/记忆未外置为无状态。
- **预期目标**：评估 Postgres + 读写分离应对并发；会话/记忆外置，支持水平扩展。

#### L2. AI 流式（SSE）+ 结果缓存 — **未实现**
- **关键缺失点**：AI 路径同步阻塞调用 Hermes CLI 子进程，无超时/无缓存，30s 客户端超时打到外部 LLM；报表 N+1 风险。
- **预期目标**：AI 响应改 SSE/WebSocket 流式；相似 query 结果缓存；Hermes 子进程加超时 + 队列；热点读加 Redis/内存缓存，对话延迟↓、并发↑。

#### L3. 技能/连接器插件化市场 — **未实现**
- **关键缺失点**：连接器已有 manifest + 抽象（做得好），但 API 未标准化为可插拔市场；无插件注册/分发机制。
- **预期目标**：仿 WorkBuddy 技能即插即用，新连接器零改核心，建插件市场。

#### L4. 多租户隔离 — **未实现**
- **关键缺失点**：多租户靠 `tenant_id` 字段未隔离；租户中间件 `except` 后**静默放行（fail-open）**——我们 Phase 系列已标记为安全风险。
- **预期目标**：租户数据隔离 + 中间件 fail-closed（鉴权失败拒绝而非放行），消除越权面。

---

## 四、报告与现状的偏差说明（重要）

| 报告原文定位 | 实际状态 | 偏差原因 |
|---|---|---|
| P0#3 错误不吞 = 待做 | ✅ **已完成** | Phase L 已实施全局异常 + trace_id |
| API 校验（P0#1）= 0 处 | 🟡 **部分完成（23/289）** | Phase L/M/N/O 已接 23 个写接口 |
| 租户中间件 fail-open | ⚠️ **仍风险未解** | 报告未单列，我们在会话中额外发现并标记 |

> 结论：报告判断的"工程化中台欠账"整体成立；我们已补上**错误可观测**与**核心写接口校验**两块，但**安全加固（CSP/限流/CORS）、DB 池化与幂等迁移、前端工程化（构建/状态/响应式/a11y）**仍是空白，需按 H→M→L 推进。

---

## 五、建议跟进顺序（基于本报告 + 已落地情况）

1. **收尾 H1**：把 Pydantic 推广到剩余写接口 + 统一响应信封（解 `200+success:False` 契约 + 未知 `/api/*` 返 404）。
2. **启动 H2**：前端 CSP + 限流 + CORS 白名单（安全止血，成本低收益高）。
3. **H3/H4**：DB 连接池 + 幂等迁移 + 订单明细导入（解启动刷屏 + 领域引擎真值）。
4. **M1–M4**：前端工程化（构建/组件/响应式/a11y）提升可维护与体验。
5. **L1–L4**：规模化（Postgres/流式/插件市场/多租户隔离）。

> 最快见效路径：**H1 收尾 + H2 安全加固**，可在不动用户已认可 UI 范式的前提下，把"能跑的原型"升级为"可规模化的产品"。

---

## 六、执行进展（Phase P 起，2026-07-23 起）

按计划从 H1 开始推进。累计 Pydantic 校验接口：**23（L/M/N/O）→ 44（截至 Phase P 三批）**。

### Phase P 批次 1：`routers/workflow.py`（✅ 已部署）
- 校验模型覆盖 **10 个状态变更写接口**：`documents/{ref_type}/{ref_id}/submit`、`/approve`、`signatures`、`archive-approvals`(submit/review)、`batch-archive`、`batch-delete`、`approval-workflows`(create)、`approval-delegates`(create)、`doc-templates`(create)。
- 冒烟：7 项非法→422 全绿；健康 + 列表回归 200。
- 备份：`routers/workflow.py.bak-20260723153915`。

### Phase P 批次 2：`routers/sales.py`（✅ 已部署）
- 新增 `SaleOrderIds` / `QuotationCreate` 模型，校验 **4 个写接口**：`batch-deliver`、`batch-sign`、`quotations`(create)（延续 Phase M/O 既有模型）。
- 冒烟：4 项非法→422 全绿；健康 + sale-orders/quotations 列表回归 200。
- 备份：`routers/sales.py.bak-20260723154349`。

### Phase P 批次 3：`server.py`（✅ 已部署）
- 新增 6 个模型（`OrderIdsPayload`/`OrderTransition`/`PartialDeliver`/`OrderApprove`/`CopyOrder`/`RolePermsSave`），校验 **7 个订单生命周期写接口**：`batch-approve`、`batch-cancel`、`transition`、`partial-deliver`、`approve`、`copy`、`role-permissions/detail`(save)。
- 冒烟：6 项非法→422 全绿（approve 的 comment 非 str 被 Pydantic 强制转字符串后走业务层→404，符合预期）。
- 备份：`server.py.bak-20260723154654`。

### ⚠️ 重要发现 1：`doc_ops.py` 是死代码
- 该文件定义了 GL 红冲/反审核/批量删单等**高危接口**，但 **`server.py` 从未 `include_router` 注册**（全项目搜不到第二处引用）。
- 我对它加的校验因此**对运行服务无效**，已还原文件（保持原状，避免"改了但未注册"的混淆）。
- 线上这些路径实际命中 SPA 兜底 `GET /{path:path}` → 返回 **405 Method Not Allowed**（正是报告 H1b 记的"未知 `/api/*` 被兜底吞掉"问题）。
- 决策：本次不激活 doc_ops（激活休眠的高危 GL 接口属范围外且高风险）。记为后续评估项。

### ⚠️ 重要发现 2：两个既有 500 bug（与本次无关）
- `GET /api/dashboard/kpis` → `AttributeError: erp_db 无 get_dashboard_kpis`
- `POST /api/sale-orders/{oid}/transition` → `AttributeError: erp_db 无 transition_order`
- 二者都是 `erp_db.py` 函数缺失，旧代码同样会 500，**非本次 Pydantic 改动引入**。记为独立待修项（不在 H1a 校验范围内）。

### H1b：统一响应信封 + 路由黑洞修复（✅ 已完成，2026-07-23）
- 改动 2 文件（生产根 `/opt/hergent-erp/`）：`core.py`（新增 `error_envelope` 助手 + 重写 `register_exception_handler` 为统一信封 `{ok,data,error,code}` + 500 加 `X-Trace-Id` + 新增 `RequestValidationError` 422 处理器）+ `server.py`（rate-limit/tenant/CSRF 中间件错误统一信封；新增 `/api/{path:path}` 全方法 catch-all + `/api` GET → 404 JSON，插在 SPA 兜底前）。
- **信封形状（错误）**：`{ok:false, success:false, data:null, error:<msg>, code:<http>[, error_code]}`。`success:false` 保留以向后兼容前端（`app.js` 读 `r.success`/`r.error`）；`ok`/`code` 为规范字段。
- **成功响应未包裹**：包裹成功响应会破坏线上前端，故仅统一错误路径；完整成功包裹需前端协同迁移（列为后续可选项）。
- **路由黑洞修复验证**：GET/POST 未知 `/api/*` → 404 JSON 信封（此前 GET 被 SPA 兜底吞成 200 HTML）；`GET /` 仍 200 HTML（SPA 正常）。
- **冒烟全绿**：404(未知api)/401(无鉴权)/422(参数校验)/429(限流) 均走统一信封；`/api/health` 200 无回归；临时 token 残留 0。
- **部署教训（重要）**：本地仓库 `server/X` 与线上根布局错位，首轮误部署到死掉的 `server/` 子目录，经 `/proc/$PID/cwd` 定位线上=根 `/opt/hergent-erp/server.py` 后纠正。详见 MEMORY.md「部署路径真相」。

### H1a 续：被回滚/裸奔 ACTIVE 路由补回（✅ 本回合完成 + 发现批量部署冲掉未提交改动根因）

**本回合（2026-07-23 晚，续推 H1a）交付 + 关键根因发现：**

**🔴 关键发现 — 批量部署冲掉未提交改动（同类 H1a 灾难复发根因）**：
- 本回合初核对线上发现：`sales/finance/consignment/subcontracting/assembly/inventory/workflow` 的 Pydantic 标记**全部回到 0**，且 `core.py` 的 H1b 信封也被冲掉。根因 = 这些改动此前只 scp 到线上、**从未 commit 进 git 仓库**；用户在 ~20:45 用 `git archive` 批量部署（只含已提交版本）把仓库里的 B1 基线/旧 core 重新铺到线上，把我没进 git 的 H1a/H1b 整体覆盖。
- **修复 + 防复发**：从本回合起，**每改一个路由就 commit 进本地 git**（`upgrade/v84-international` 分支），让 git 成为耐久真源。本回合已提交：
  - `d168ed4` H1a：sales/finance/consignment/subcontracting/assembly/inventory/workflow 落库
  - `8d5d21c` H1b：core.py 统一信封 + pydantic_error_detail 落库
  - `ef235e9` H1a：purchase + crm 校验
  - `e291ac3` H1a fix：身份/数量字段改必填（见下）

**本回合新增/补回的路由（全部已部署 + commit + 冒烟验证）：**
1. **恢复 7 个此前被冲掉的路由**：sales(13标记+B1隔离4)/finance(25)/consignment(3)/subcontracting(3)/assembly(3)/inventory(17)/workflow(21) —— 线上标记、B1 隔离、health 200 全部复核通过；core.py H1b 信封恢复（非法请求返 `{ok:false,...,code:401}` 已验证）。
2. **`routers/purchase.py`（采购核心写接口）**：9 模型，覆盖 采购单创建 / 分批收货 / 批量建单 / 简易批量建单 的 supplier_id·product_id·quantity·unit_price 必填校验（含 `gt=0`/`ge=0`）。
3. **`routers/crm.py`（客户面写接口）**：18 模型、17 处校验接线，覆盖 拜访/带定位拜访/签到/漏斗/合同/专属价/竞品/陈列/返利/联系人/送货地址/地址/促销/价表/价方案/信用方案/佣金 等所有带 `contact_id/customer_id` 的写入（防零/负 ID 挂错客户）。

**🔧 校验缺陷修复（重要）**：初版模型误用 `Field(0, gt=0)`（默认 0），而 Pydantic **默认不校验默认值** → 缺字段静默变 0 溜过校验（冒烟曾见 `visits` 缺 contact_id 返回 200）。已将身份/数量字段改为**必填** `Field(..., gt=0)`，复测：缺 contact_id → 422 `Field required`、contact_id=0 → 422 `gt=0`、合法 → 200，不误伤。

**冒烟（真实 422，Bearer token）全绿**：
- crm visits 缺 contact_id → 422 `Field required`；contact_id=0 → 422 `gt 0`；contact_id=1 → 200
- crm customer-prices 缺 customer_id → 422；合法 → 200
- purchase 缺 supplier_id → 422 `Field required`（说明 purchase 实际未被租户网关拦截，校验可达）
- 临时 token 已清理。

**部署铁律（本回合固化）**：① 改完 **必须 commit 进 git**（防批量部署冲掉）；② backup→精确 scp（**禁用通配符**，曾因 `sales_*.py` 多匹配导致 scp 全失败）→chown hergent→`IMPORT_OK` 预检→restart→grep 标记+health；③ 冒烟脚本须 `cd /opt/hergent-erp` 再连 erp.db（曾因漏 cd 连到 /root/erp.db 致 401 假阴性）。

### disassembly / scrap 死代码处置（维持原决议）
二者未注册（404），本回合未激活。选项待用户决定：(a) 激活并加校验；(b) 保持休眠。

### 其余活跃写接口仍未覆盖（H1a 后续）
hr/recruitment/forecast/forecast_router/tax/payment_run/salary_send/platform/projects/consolidation/bpm/gl_dimensions/rfq/auth/bi/reconciliation/sso/print_templates/voucher_templates/vehicles 等（共 ~289 路由，绝大多数写接口仍无校验）。

**下一步建议**：H1a 余下活跃路由分批补校验（风险优先级：hr/forecast/tax/payment_run/platform 等）；或转 **H2**：前端 CSP + slowapi 限流 + CORS 白名单。

---

## 七、H1a / H2 最终收尾状态（2026-07-23 续推完成）

> 本节为对上文"进行中/未实现"断言的**权威校正**。本回合通过生产实测（SSH 直连 47.113.224.140:8700）逐路由核对，结论以下为准。

### H1a：Pydantic 写接口校验 — ✅ 完成（所有活跃写接口已校验）

- **覆盖基础（前批次已部署）**：hr / recruitment / forecast(`forecast.py`) / tax / payment_run / salary_send / platform / projects / consolidation / bpm / auth / bi / reconciliation / sso / print_templates / voucher_templates / vehicles / rfq / zhoupu_gap / tasks / bot / mfa / import_router，及 batch-1 的 sales/finance/consignment/subcontracting/assembly/workflow/inventory/purchase/crm。提交：`b7f4429` / `5f82c34` / `0f36ff4`。
- **本回合收尾**：以"已挂载(`from routers.X import`) × 含写接口 × 无 Pydantic 信号"三条件做权威生产扫描，确认唯一真实活跃缺口 `routers/gl_dimensions.py`（挂载名 `gl_dims_router`）已修复并部署（提交 `b5c9721`）：
  - 将 3 处 `json.loads(request.body.read())` 潜在 500 bug（coroutine 无 `.read` 属性）改为 `await request.json()`，handler 改 `async`，并加零 coercion `_Base/GlDimPayload` + `_v()` 信封门；
  - 部署：`IMPORT_OK` 预检通过 → `systemctl restart` → health 200 → 复扫 **无残留活跃缺口**。
- **复扫结果**：`REMAINING LIVE-GAPS: routers/timeline.py routers/today.py`（二者 POST 无 JSON body，正确排除）。
- **422 回归全绿**：`POST /api/auth/register` 空 body → `{"ok":false,"success":false,"data":null,"error":"参数校验失败: company: Field required; phone: Field required; password: Field required","code":422}`。
- **刻意未覆盖（非活跃路径，维持"不碰死代码"决议）**：`check` / `doc_ops` / `erp_connect` / `export_ops` / `search_notify` / `disassembly` / `scrap` / `demo_data` 及孤儿 `forecast_router.py` —— 均未 `include_router` 注册，改了不生效。

### 🔴 新发现：gl_dimensions 是半成品功能（预存在，非本次引入）

- `routers/gl_dimensions.py` 调用的 `db.gl_dimension_*` 系列（`create` / `delete` / `value_create` / `value_update` / `value_delete` / `list` / `value_list`）**在 `erp_db.py` 中全部不存在**（grep `gl_dimension` 0 匹配）。即该路由挂载但 db 层缺实现，任意 GET/POST/PUT/DELETE 均 500（`AttributeError: erp_db 无 gl_dimension_*`）。
- 本回合修的是其 **JSON 解析 500 bug + 校验门**；功能本身仍因缺 db 实现而 500。属**预存在功能缺口**，超出 H1a 校验范围，列为独立待修项（需补 `gl_dimensions` / `gl_dimension_values` 的 CRUD 函数；表结构已在 `tenant_1` 存在：`dimension_tags` / `gl_dimensions` / `gl_dimension_values`）。

### H2：CSP + 限流 + CORS 白名单 — ✅ 完成且已上线

生产 `/opt/hergent-erp/server.py` 已含三项并验证：
1. `security_headers_middleware` 注入 `Content-Security-Policy`（`default-src 'self'`、`script-src` 含 jsdelivr CDN 白名单、`frame-ancestors 'none'`、`report-uri`）+ `X-Frame-Options: DENY` + `X-Content-Type-Options: nosniff` + HSTS + Permissions-Policy；
2. slowapi `Limiter(default_limits=["300/minute"])` 中间件（生产日志 `[RateLimit] Enabled: 300 req/min default`，slowapi 已安装）；
3. `CORS_ORIGINS` 环境变量白名单（默认 localhost，**非 `*`**）。

**验证证据**：`curl /api/health -I` 响应含 `content-security-policy: default-src 'self'; ...`；恶意 origin 请求**无** `access-control-allow-origin` 头（证非通配），localhost origin 正确回显；限流日志确认启用。

### H3：DB 连接池 + 幂等迁移 — ✅ 完成且已上线（2026-07-23）

> 本节为对上文"未实现"断言的权威校正，依据生产实测（SSH 直连 47.113.224.140:8700）结论。

- **改动文件**：`server/erp_db.py`（H3.1 幂等 `_safe_migrate` + H3.1b 历史 ALTER 路径统一日志）、`server/db/connection.py`（H3.2 按线程连接池）。均已 commit（`1c37c3c` / `2711490` / `3be2e19`）并 scp 到生产根 `/opt/hergent-erp/` + `chown hergent` + `IMPORT_OK` 预检 + `systemctl restart`。
- **H3.1 / H3.1b 幂等迁移**：
  - 新增 `_migration_applied(name)`（查 `_migrations.status='ok'` 跳过已应用）、`_is_idempotent_migration_error(err)`（识别 `duplicate column name`/`already exists`/`duplicate index`）、`_record_migration(name, status, error)`（幂等 `INSERT OR REPLACE`，不再触发 `UNIQUE constraint failed`）、`_migration_log_error(e, name)`（吞幂等型报错、只打真实失败）。
  - `_safe_migrate`/`_safe_migrate_script` 重写为：已应用则跳过；幂等型报错 → 静默记 `ok`、不刷屏；真实报错 → 记 `failed` + 打印。
  - 全局替换 ~40 处旧 `_migrate_vXX` 的 `print("[Migration] FAILED: ...")` → `_migration_log_error(e[, name])`。
- **H3.2 连接池**：`_sqlite_connect()` 按 `(thread_ident, db_path)` 缓存连接（保留默认 `check_same_thread=True` 合法性，连接不跨线程）；`get_db()`/`get_db_tx()` 回调用 `_sqlite_return(conn)`（缓存连接留用、重入一次性连接计数追踪）；12 线程压测 `cache_size` 有界、事务提交隔离、死连接自动重建均通过。
- **验证证据**：启动 `[Migration] FAILED` 从 **171 行/次 → 2 行/次**；`GET /api/health` = 200；`_migrations` `ok=205`/`failed=17`；连接池冒烟（6 读 + 1 真实写 + 列表）零错误，测试数据已清理。
- **残留 2 条真实迁移错误（建议跟进，非刷屏）**：
  1. `v89_products_barcode_unique: UNIQUE constraint failed: products.barcode` — 业务数据重复条码值，值得告警。
  2. `default value of column [created_at] is not constant` — 旧版 SQLite 非常量 DEFAULT DDL 限制（环境相关）。
- **刻意未做**：高频查询补索引（报告其余项）、Alembic 框架（按需幂等改写已达标）。并发写 SQLite 文件锁限制仍属 L1（Postgres）方向。

### H4：订单明细导入 + gl_dimensions 完整 CRUD + 重复条码冲突检测告警 — ✅ 完成且已上线（2026-07-24）

> 本报告「第三节 🔴 H4」原为「未实现」；本回合（2026-07-24）完整落地并生产验证。详见 `H4-订单明细导入完成报告-2026-07-24.md`。

- **改动 6 文件**（`server/`）：`db/queries/gl_dimensions.py`(新建) / `routers/gl_dimensions.py`(重写) / `db/queries/sales.py`(编辑) / `routers/import_router.py`(扩展) / `db/queries/products.py`(编辑) / `erp_db.py`(facade 接线)。提交：`0ccf972` + `6c77d76`。
- **H4.1 订单明细导入**：`sale_order_item_create(order_id, product_id, quantity, unit_price, db_conn=None)` 复用导入事务连接写 `sale_order_items`，自动重算 `total_amount`（保留 discount）；实测导入 2 行 → `success=1`、`total=17.5`。
- **H4.2 gl_dimensions 完整 CRUD**：从零补齐此前 500 的 `/api/gl/*`；维度+维度值 create/read/update/delete + Pydantic 必填校验 + 清晰 400/404/409；补回缺失 `PUT /api/gl/dimensions/{code}`。
- **H4.3 重复条码冲突检测与告警**：批次内 + 库内双检测；新建专用 `barcode_conflicts` 表（首版误写 `alert_history` 外列导致 500，已改用专用表 + 真实 schema 轻量镜像修复）；端点 `detect-barcode-conflicts` / `barcode-duplicates`(扫库) / `barcode-conflicts`(list) / `barcode-conflicts/{cid}/resolve` / `barcode-conflicts/export`(CSV)；生产扫库发现 **9 组**真实重复条码。
- **验证证据（生产实测 47.113.224.140:8700）**：health 200；gl CRUD 200/409/404；order_items 导入 `total=17.5`；条码冲突 list/export/resolve 全通；正常商品导入回归 `success=1` 无回归；路由挂载复检 = 401 envelope（非 500）；临时 token/测试数据零残留。
- **关键限制（数据层，非代码）**：生产库 `sale_order_items` 仍 0 行，导入通道已通，需用户侧导入真实明细；订单导入当前解析 master `erp.db`（既有 import 行为）。

### 结论

H1（写接口校验）+ H2（安全加固：CSP / 限流 / CORS 白名单）+ **H3（DB 连接池 + 幂等迁移）+ H4（订单明细导入 + gl_dimensions CRUD + 重复条码告警）** 均已**完成并上线**。剩余项：① 死代码路由器（不碰）；② 生产库 `sale_order_items` 0 行（数据问题，等用户导入）；③ 高频查询补索引（可并入 L1 或 H3 后续）；④ gl 维度试算为结构预览（`journal_entries` 尚未带维度标签）。符合"先止血防坑"目标。下一步可转 **M1–M4**（前端工程化：构建/组件/响应式/a11y）或 **L1–L4**（规模化：Postgres/流式/插件市场/多租户隔离）。

