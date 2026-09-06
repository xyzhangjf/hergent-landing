# AI 副驾项目（Hergent）代码评审报告

> 评审日期：2026-08-22 ｜ 评审对象：前端 `hergent-cn-v2`（Vue3+Vite+Pinia）/ 后端 `hergent-erp`（FastAPI+SQLite）｜ 对标基准：WorkBuddy（artifact 一等公民、流式健壮重连、错误边界、MCP/工具模块化、任务进度可见）
> 方法：关键文件逐行精读 + 子代理全仓扫描 + **4 条最致命论断实地核验**（均已确认成立）

---

## 0. 总览

**总体判断**：产品的功能完整度、交互设计（双栏产物沉淀、角色团队、进度步骤、静默读表）已具备 SaaS 雏形，且后端**安全骨架其实不错**（fail-closed 租户隔离、统一错误信封、幂等键、双引擎连接层）。但存在 **2 个上帝文件 + 1 处跨进程脆弱耦合 + 4 颗会随"开新租户 / 换服务器 / AI key 缺失 / 长任务"触发的隐性炸弹**，以及**前端 3 处会直接导致"AI 胡言 / 显示离线 / 白屏"的隐患**。这些是"单兵非技术创始人"最该先排的雷。

### 已验证的优点（与 WorkBuddy 范式对齐，请保持）
| 优点 | 证据 | 对标 WB |
|---|---|---|
| 产物双栏沉淀（Artifact 一等公民） | `CopilotDrawer.vue:208-233` 右侧 `cp-artifacts` | ✅ WB 的 artifact 面板 |
| 任务进度可见 | `ProgressSteps.vue` + `msg.progress` | ✅ WB 任务进度条 |
| 静默读表（方案 A，强制走工具、杜绝预览误导） | `CopilotDrawer.vue:638-667` + 生产 MCP | ✅ WB 工具/数据解耦 |
| 复用后端计算核心，零重写 | 生产 `spreadsheet MCP` → `routers/chat_attachment._run_query` | ✅ WB 复用既有能力层 |
| 租户隔离默认拒绝 | `server.py` 中间件 | ✅ 安全范式 |
| 统一错误信封 + 全局异常 | `core.py` `err()`/`register_exception_handler` | ✅ |

---

## 1. 分维度评审（核心交付）

### 1.1 状态管理（前端 `store/index.js`）
| 问题 | 证据 | 改进建议 | 对标 WB |
|---|---|---|---|
| 模块级单例 `store` 背离 Pinia 设计 | `store/index.js:151` 全局 `useAppStore(pinia)`；14 个页面直接 `import { store }` | 组件内统一 `const store = useAppStore()`；单例仅留过渡 | WB 组件只消费 store，不持有全局单例 |
| 页面/组件直接改写 store 内部字段 | `CopilotDrawer.vue:422/697/718`、`Shell.vue`、`Login.vue` 共 20+ 处 `store.chat.xxx=` | 收口为 actions（`setUser()`/`closeCopilot()`） | 页面只依赖 action/state 接口 |
| 持久化与业务强耦合 | `saveCurrentSession()` 在 6+ 处调用（含 `finally`） | 抽 `useChatPersistence()` composable 解耦 | — |
| 流式回写卡片 JSON 的响应式陷阱 | `CopilotDrawer.vue:707` `last.content = full` 把含 ```` ```card ```` 围栏的原始流文本塞回气泡 | 抽到卡片后只追加"卡片外内容"，维护 `contentWithoutCard` | — |

### 1.2 组件复用与解耦
| 问题 | 证据 | 改进建议 |
|---|---|---|
| `CopilotDrawer.vue`（982 行）上帝组件 | 单文件承担对话列表/历史/产物/角色菜单/上传/智能导入/语音/转发/拖拽分割线/SSE 发送 | 抽取 `ChatHistory`/`MessageBubble`/`ArtifactPanel`/`RoleSwitcher`/`FileUploadBar`/`SmartImportCard`/`ForwardPanel` + composables `useCopilotSend`/`useArtifacts`/`useDividerDrag`（**大**，拆 2–3 迭代） |
| `Forecast.vue`（1401 行）膨胀 + 逻辑复制 | `genZhoupu()` 与 `wizardGenZhoupu()` 体几乎完全相同（~827/804）；"余额&付款"UI 渲染两遍 | 抽 `CrossTable`/`DraftEditor`/`ForecastImportModal`/`ForecastAuditModal`/`ForecastPayModal`/`ForecastWizardModal`；删重复函数 |
| `ConnectCenter.vue`（1239 行）5 个弹窗 90% 雷同 | 企微/飞书/钉钉 IM 弹窗结构一致；畅捷通/金蝶 OAuth 弹窗一致（约 700 行复制） | 抽 `ChannelConfigModal.vue` + `useChannelConfig(channel)` |
| ✅ 已做好的范式 | `ResultCard.vue`（对话流与产物面板共用）、`AdvicePanel.vue`、`ProgressSteps.vue` 复用度高、职责清 | 作为新代码标杆推广 |

### 1.3 接口设计（前端 HTTP）
| 问题 | 证据 | 改进建议 |
|---|---|---|
| 裸 `fetch` 散落 7 处，鉴权头重复 3 套 | `client.js:19/34/48/64/103`、`modules.js:191`、`Settings.vue:213`（`_formPost` 与 `api()` 重复 401+CSRF 拼接；`Settings.vue` 裸 fetch 连统一错误处理都没有） | `login/register/demoLogin` 走 `api()`；`_formPost` 改 `api(path,{raw:true})`；`Settings.vue` 改用 `api()` |
| 401 是"全局副作用炸弹" | `client.js:74-78` 任意 401 即 `token=''` + `location.hash='#/login'` 强踢 | 区分"主动请求"与"后台轮询"：轮询失败仅静默刷新/标 `ui.expired`，仅用户主动操作失败才跳登录 |
| 错误信封解析脆弱 | `client.js:81` `data.data !== undefined ? data.data : data`：合法 `data:null` 会退回整个 envelope | 按固定字段取（如 `data.payload ?? data.data`）并文档化 |
| `hermesChat` 缺分级超时/心跳/`[DONE]` 判定 | `client.js:100` 硬编码 `setTimeout(()=>ctrl.abort(), 120000)`（**已核实**）；无多行 `data:`/断线重连续容 | 超时按场景分级（普通 60s、复杂 300s）；解析循环记录是否收到 `[DONE]`；接近超时显示"仍在思考…"而非静默杀进程 |

### 1.4 错误处理（前端）
| 问题 | 证据 | 改进建议 | 对标 WB |
|---|---|---|---|
| 🔴 SSE 链式 bug：失败仍触发卡片请求 | `CopilotDrawer.vue:716-738`：`.catch().finally().then()` 中 `catch` 不重抛 → `.then` 在**失败**时也跑 `REVIEW_RE` 分支或 `Promise.all([fetchLossCard,...])`，AI 已报错还追发 4 个卡片请求并可能再 push 气泡 | 改为 `hermesChat(...).then(onOk).catch(onErr)` 两段式；卡片触发仅在成功分支 | WB agent loop 有明确 done/error 分支 |
| 🔴 半截消息落盘 | `.finally` 在 120s 中断后把截断消息 `saveCurrentSession()`（`:719`），下次打开重现乱码气泡 | 解析循环记 `doneReceived`；未收 `[DONE]` 则不把截断消息当完整会话保存；提供"重试/继续"按钮 | WB 错误可恢复 |
| 无全局错误边界 | `main.js`/`App.vue` 无任何 `errorHandler`/`onErrorCaptured` | 注册 `app.config.errorHandler` + 顶层 `<ErrorBoundary>` 包裹 `<router-view>`，错误态"页面出错，点此重试" | ✅ WB 有错误兜底 |
| 错误提示不分级 | `store.chat.error` 只有"AI 助手暂时离线"（`:113`） | 区分网络断/登录过期/模型错误，文案分级 | — |

### 1.5 性能
| 问题 | 证据 | 改进建议 |
|---|---|---|
| 路由全量静态导入，首屏拉全部页面 | `router/index.js:6-20` 一次 `import` 全部 14 页（含 1401 行 Forecast、1239 行 ConnectCenter） | 改 `() => import('../pages/Forecast.vue')` 懒加载；`vite.config.js` 开 `manualChunks` 拆 vendor/页面 |
| 长对话整体重渲染 | `store.chat.messages` 变化触发整抽屉重渲；`artifacts` 每次全量 `reverse+filter` | 抽 `MessageBubble` 组件 + `v-memo`；产物索引用 `shallowRef` |
| 后端在 Python 内存过滤（N+1） | `routers/reconciliation.py:46-50` 取 500 行后按 `contact_id` 过滤、`:145` 取 2000 行聚合 | 下推 `WHERE contact_id=?` 或用 `db/queries/finance.py` 聚合 |
| 连接 `cache_size=-64000`（64MB/连接）偏高 | `db/connection.py:184` | 调至 `-8000`（8MB）量级观察 |

### 1.6 用户体验
| 问题 | 证据 | 改进建议 |
|---|---|---|
| 流式中断无恢复入口 | 无重试/继续按钮（见 1.4） | 加"回答中断，可重试"提示 + 重试按钮 |
| 附件"静默读表"语义不统一 | `tableFiles` 仅认 `xlsx\|csv`（`:680`），但智能识别认 `xls`（`:555`），xls 上传不进软提示 | 过滤口径统一（都认 `xls?`） |
| Toast 单值覆盖 | `store/index.js:44-47` 单个 `ui.toast` 被后发覆盖 | 改队列 |
| 语音输入仅 Chrome 支持且失败才提示 | `useVoiceInput.js:16` | 进入即给能力提示 |

### 1.7 模块解耦（后端）
| 问题 | 证据 | 改进建议 |
|---|---|---|
| 🔴 `erp_db.py` 13,473 行上帝模块 | 767 个函数/类；同时含 DDL/迁移（`init_db`/`_safe_migrate`）、业务域（`sale_order_*`/`get_pnl`）、预测算法（`exp_smoothing` 等被 `domain/forecast_engine` 反向 import） | **冻结**，新功能只进 `db/queries`/`domain`；旧函数逐步委托后删除（WB 模式：router→domain→queries） |
| `domain` 反向依赖上帝模块 | `domain/wastage_tracker.py:148`、`domain/forecast_engine.py:101` `from erp_db import ...` | 把 `generate_journal_entry`/`exp_smoothing` 下沉到 `domain/gl.py`/`domain/forecast.py`，让 domain 自洽 |
| `server.py` 4521 行 + ~400 内联路由 + import 期副作用 | `init_db()` 在模块 import 时直接跑（`:9681`） | 降级为"应用装配文件"：`lifespan.startup` 启动 `init_db`；内联路由搬进 `routers/` |
| `routers/import_router.py`（1254 行）路由内写事务 | `:334/391/1187` 直接在 router 写 `get_db_tx()` 落库 | 下沉 `domain/imports.py`，router 只"接参→调 service→返回" |
| 跨进程脆弱耦合（MCP stub `core._auth`） | `routers/chat_attachment.py:14` `from core import _auth`；MCP server 需 `sys.path` 注入 + stub 才能 import `_run_query`（无类型检查、无单测保护；且 stub 会绕过租户/权限校验） | 抽独立 `server/ai/spreadsheet_query.py`（去掉任何 `core` import），router 与 MCP 都从它 import |

### 1.8 接口设计（后端 REST）
| 问题 | 证据 | 改进建议 |
|---|---|---|
| `return {"error":...}` 绕过统一信封（默认 HTTP 200） | 约 150 处（如 `mfa.py`/`rebate_rules.py`/`import_router.py`/`sales.py`/`finance.py`…） | CI 加 ruff 规则禁 `return {"error"`；统一走 `err()`/HTTPException（**小**，高收益） |
| 分页/上限不一致 | `reconciliation.py:46` `limit=500`、`:145` `limit=2000`，部分无上限 | 抽 `Paged` 响应模型 + `paginate()` 助手 |
| 幂等仅"可选启用" | 仅 `sale_order_create` 等少数接口启用，依赖客户端传 `idempotency_key`；付款/费用/工资/对账确认无保护 | 服务端默认开启（trace-id/请求指纹自动去重） |
| 租户前缀白名单手维护 | `server.py` `_TENANT_MASTER_PREFIXES`/`_TENANT_REQUIRED_PREFIXES` 手写列表，漏加即 403 | 反转为"默认需租户 + `@public/@master` 例外"，消除"漏加即 403" |

### 1.9 错误处理（后端）
| 问题 | 证据 | 改进建议 |
|---|---|---|
| 🔴 `ai_engine.py` 导入期崩溃 | `ai_engine.py:11` `if not AI_KEY: raise RuntimeError(...)`（**已核实**）→ 模块一 import 全站 500 | 改为懒校验（首次调用报 503），副驾不应拖垮进销存 |
| `SQLITE_BUSY`/磁盘满无友好翻译 | 仅被全局 `Exception` 接住，返回泛化 500 | 全局处理器加 `sqlite3.OperationalError` 友好分支（"系统繁忙，请重试"） |
| 全局处理器被 `return {error}` 绕过 | 同 1.8 | 统一信封后方可生效 |

### 1.10 数据层与迁移
| 问题 | 证据 | 改进建议 |
|---|---|---|
| 自研迁移 + 休眠 Alembic 并存，无回滚 | 仓库有 `alembic.ini`/`env.py`/`versions/001_initial_stamp.py` 但**无任何代码调用 upgrade**；自研 DDL 与业务代码混在 `erp_db.py`，仅前进、无事务包裹多语句 | 二选一：删 Alembic 并把迁移抽到独立 `db/migrations.py`，或让 Alembic 真正接管（推荐，已有骨架） |

---

## 2. 四颗"炸弹"（对标 WorkBuddy 稳健性，最致命）

> 以下任一条出问题，都是"客户数据 / 可用性"层事故，按危险度排序。**全部已实地核实**。

1. **🟠🔴 租户库创建失败 → 静默指向空/坏租户库（数据正确性）**
   - `db/connection.py:107-108` 注释写"Continue anyway — connection will use master DB as fallback"，**但代码并未回退主库**：`set_tenant_context` 在第 72 行已 `_tenant_db.set(tp)` 指向租户路径，`_ensure_tenant_db` 失败后只是 `warning` 返回。若 `sqlite3.connect(tenant_db_path)`（:86）已建出**空文件**却后续步骤失败，则该租户连接指向一个**无 schema 的空库** → 后续查询"no such table"或写入落空。**注释与行为相反，极具迷惑性。**
   - 改造：建库失败必须**显式报错并阻断请求**，绝不可"继续"；加启动时租户库完整性自检。

2. **🟠 换服务器 → 预报功能直接崩（可移植性）**
   - `domain/forecast_engine.py:100` 与 `:352` 两次 `sys.path.insert(0, "/Users/zhangjunfeng/Documents/hergent-erp/server")`（**已核实**）。生产机路径不同 → `from erp_db import ...` 失败 → 预报挂掉。这是会随部署触发的真 bug。
   - 改造：改用包内相对 import（由启动脚本统一设置 `PYTHONPATH`）。

3. **🟠 AI key 没配 → 全站起不来（可用性）**
   - `ai_engine.py:11`（**已核实**）导入即 `raise`。副驾是"锦上添花"，不应拖垮进销存/财务。
   - 改造：懒校验，缺 key 仅 AI 类接口返回 503。

4. **🔴 前端 SSE 120s 硬杀 + 半截落盘 + 误报离线（可信度）**
   - `client.js:100` 硬编码 120s abort；`CopilotDrawer.vue:717-719` 把截断消息落盘；`:113` 唯一错误文案"AI 助手暂时离线"。合起来：长任务（如复杂对账）会中途被杀 → 读到半截 → 误报离线 → 半截乱码气泡重现。这正是你 14:10 那次"对账跑到一半掉线"的根因之一。
   - 改造：分级超时 + `[DONE]` 判定 + 中断可重试 + 半截不落盘（见 1.4）。

---

## 3. 优先级改造清单（给 owner 排期）

| 优先级 | 改造项 | 对应章节 | 工作量 | 对老板的意义 |
|---|---|---|---|---|
| **P0** | 🔴 修 `db/connection.py`：建库失败即阻断 + 租户库完整性自检 | §2.1 | 小 | 防新租户/坏库静默丢数据 |
| **P0** | 🔴 删 `forecast_engine.py` 硬编码绝对路径 | §2.2 | 小 | 防换服务器即崩 |
| **P0** | 🟠 `ai_engine` AI key 改懒校验 | §1.9 | 小 | 防副驾拖垮全站 |
| **P0** | 🔴 前端 SSE 三连修复：链式 bug（.then 误触发）+ 分级超时/`[DONE]` + 半截不落盘 + 重试按钮 | §1.4 | 中 | 根除"AI 胡话/离线" |
| **P0** | 🔴 加全局错误边界（防白屏） | §1.4 | 小 | 任一组件崩不再整页白 |
| **P0** | 路由懒加载 + chunk 拆分 | §1.5 | 小 | 首屏不再拉全部页面 |
| **P1** | 消灭裸 `fetch`、统一 `_formPost` 进 `api()` | §1.3 | 小 | 接口收口 |
| **P1** | 401 区分主动/轮询，避免误踢登录 | §1.3 | 中 | 后台轮询不致强踢老板 |
| **P1** | 后端禁 `return {"error":...}`，统一走 `err()`/HTTPException | §1.8 | 小 | 前端稳定，少莫名报错 |
| **P1** | 抽 `server/ai/spreadsheet_query.py`，斩断 MCP stub `core._auth` 耦合 | §1.7 | 小 | 解耦 + 安全升级隐患 |
| **P1** | `store` 去单例化 + 收口直接赋值 | §1.1 | 中 | 降低状态耦合 |
| **P1** | `hermesChat` 分级超时 + 心跳 + `[DONE]` | §1.3 | 中 | 长任务不再被杀 |
| **P2** | 拆分 `erp_db.py`（新功能只进 `db/queries`/`domain`） | §1.7 | 大（可增量） | 降低每次改动爆炸半径 |
| **P2** | `server.py` 拆装配文件 + lifespan；内联路由搬 `routers/` | §1.7 | 大 | 可维护性/可测试 |
| **P2** | 拆 `CopilotDrawer`/`Forecast`/`ConnectCenter` 子组件 | §1.2 | 大 | 可维护 |
| **P2** | 强制服务端幂等（默认去重写操作） | §1.8 | 中 | 防双击重复记账 |
| **P2** | 租户白名单反转为"默认需租户 + 例外" | §1.8 | 中 | 消灭"漏加即 403" |
| **P2** | 统一分页模型 `Paged` + 大导入/对账改后台任务 | §1.5/§1.8 | 中 | 扩展性 + 导入不卡全员 |
| **P2** | 迁移机制二选一（建议 Alembic 真正接管） | §1.10 | 中 | 可控 schema 演进 |

**工作量速算**：P0 ≈ 1~2 周（多数为局部小改，可单 PR）；P1 ≈ 3~5 周；P2 ≈ 4~8 周（结构性，边加功能边增量还债，勿"大爆炸重构"）。

---

## 4. 对标 WorkBuddy 的总体差距与对齐建议

**已对齐 WB 范式（继续保持）**：Artifact/产物沉淀双栏、任务进度可见、工具/MCP 模块化（spreadsheet 复用后端计算核心）。

**主要差距**：
1. **流式健壮性 / 错误可恢复**：WB 的 agent loop 有 `done` 判定与重试/续跑；Hergent 的 `hermesChat` 是 120s 硬杀 + 半截落盘 + 离线误报——这是"AI 突然胡话"口碑风险的根。
2. **错误边界**：WB 有运行时错误兜底；Hergent 无全局 errorHandler，组件崩即白屏。
3. **后端分层清晰度**：WB 工具/模块边界清晰；Hergent 有 13k 行 `erp_db.py` 上帝模块与 import 期副作用。
4. **模块粒度（单兵可维护性）**：WB 每个能力是独立可测单元；Hergent 三个超大前端文件（982/1401/1239 行）与两个超大后端文件（13k/4.5k 行）让"非技术创始人 solo 维护"风险陡增。

**一句话给老板**：代码"能跑、安全骨架不错"，但**先花 1~2 周排掉 4 颗炸弹（均为小工作量）+ 前端 3 处 SSE/白屏隐患**，再按"新功能写对地方、旧代码慢慢搬"的节奏还架构债——不必推倒重来，但绝不能在大炸弹未排时盲目加客户。
