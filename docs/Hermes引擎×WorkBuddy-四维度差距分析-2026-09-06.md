# Hermes AI 引擎 × WorkBuddy · 四维度差距分析与优化路线图

> 日期：2026-09-06　|　方法：逐文件阅读真实代码（前端 `hergent-cn-v2/src` 20,264 行、后端 `hergent-erp/server` 85 个 router + `hermes_core.py` 等）＋ Hermes v0.19.0 生产契约核查
> 对比对象：WorkBuddy（通用 AI 工作平台）在**能力层/产品层**的可观察实践
> 本文定位：不照搬通用平台，只借工程化与呈现层的方法；**行业深度是我们的护城河，通用能力是 WorkBuddy 的护城河**

---

## 0. 结论先行

**一句话：我们在"行业深度 + 场景人格 + 交付范式"上已不输甚至领先；差距集中在"呈现层（可视化）"与"工程化底座（流式/异步/记忆/可观测）"两端。**

| 维度 | 差距定级 | 一句话判断 |
|---|---|---|
| 功能能力 | **中偏大** | 行业能力（配方/工具/触达）是优势；但**图表可视化≈0、工具调用过程不可见、记忆弱、多模型与推理不可见** |
| UI/UX 设计 | **中** | 三栏 + 副驾抽屉 + 产物右栏 + 经营卡范式已对标；缺**命令面板/快捷键/空态/思考过程**等"最后一公里" |
| 前端实现 | **中** | Vue3+Vite+Pinia 底座正确、HTTP 层已收口；但**巨石组件（Forecast.vue 6564 行）**、零图表库、无 TS、无单测 |
| 后端架构 | **中偏大** | 多租户 + RBAC fail-closed + 配方引擎扎实；但**AI 主链路同步阻塞非流式**、无连接池、多租户简报未闭环、Adapter 为桩 |

**最重要的一条**：前端 `useCardTrigger.js:144` 的图表数据是**硬编码假数据** `series:[210,380,150,420,290,510,320]`——这是当前最刺眼的短板，也是 ROI 最高的单点修复。

---

## 1. 功能能力对比

### 1.1 现状清单（真实代码证据）

| 能力 | hergent 现状 | 代码证据 |
|---|---|---|
| 主链路 | **双链路**：① Web 副驾 → SSE `/hermes/v1/chat/completions` → Hermes v0.19.0(18765)；② `/api/ai/chat` → `hermes_core.py` 自有 loop → DeepSeek | `CopilotDrawer.vue:695`、`hermes_core.py:1166 call_hermes_agent` |
| 工具集 | 自有 loop **~40 个业务工具**（建客户/建单/查应收/毛利/库存/工资/税报…）；Hermes 侧 4 个行业 skill 包 + spreadsheet MCP | `hermes_core.py:78 TOOLS`、`/root/.hermes/skills/hergent-milk-*` |
| 记忆 | `dami_memory.db` 三表（corrections / patterns / interaction_log），**非向量、非分层、无跨会话画像** | `server/memory.py:21-40`、`hermes_core.py:32-76` |
| 自动化 | 8:05 经营卡简报 / 9·16 点催单 / 周一档案体检 / 低库存·逾期应收·费用异常·沉睡客户告警；企微+飞书 webhook | `scheduler.py:104-113, 212-300`、`notify/wecom_notify.py:63` |
| 多模态 | 语音输入、图片/Excel 上传、OCR、表格对账（MCP 精确计算，禁模型写脚本） | `useVoiceInput.js`、`ocr.py`、`CopilotDrawer.vue:633` |
| 产出形态 | ResultCard 经营卡（货损/工资/返利/预报）+ artifacts 右栏「本次产物」+ 自研 markdown 渲染 | `ResultCard.vue`、`CopilotDrawer.vue:209-226`、`utils/md.js` |
| 人格 | 3 角色（大秘/会计/运营）+ 回复格式协议 + `cards` 意图围栏（**AI 判断出不出卡，用户无感**） | `hermes_core.py:1042 ROLE_SYSTEMS`、`useCardTrigger.js` |

### 1.2 与 WorkBuddy 对照

| 能力域 | WorkBuddy 做法 | hergent 差距 | 定级 |
|---|---|---|---|
| **可视化呈现** | 内联 Visualizer 自绘 SVG/HTML/Chart，数据即时成图 | **几乎为零**（唯一 chart 是假数据） | **大** |
| **工具调用可视化** | 工具调用过程在对话流内可见（进行中/完成/结果） | 无，AI "黑箱干活" | **大** |
| **记忆体系** | 三层（云画像 / 用户级 MEMORY.md / 工作区日志）+ 跨会话检索 | 单层 SQLite 三表，无画像、无检索 | **大** |
| **专家与技能生态** | 100+ 专家、SKILL.md 渐进加载、技能市场安装 | 仅 3 角色 + 4 个自研 skill，无市场、无对外 | 中 |
| **子代理/并行** | 多子代理并行（探索/计划/专用 agent） | 无 | 中（**不建议照做**） |
| **多模型/推理可见** | 模型可选、思考过程可展开 | 单模型 deepseek-chat，无推理可见 | 中 |
| **多模态生成** | 文生图/视频/3D | 无 | 低（**不建议做**） |
| **流程/任务编排** | 任务清单 + 自动化 + 记忆文件 | 有 scheduler/cron，无任务清单 | 中 |

### 1.3 我们的差异化优势（**不要丢，也不必追平对方**）

| # | 优势 | 为什么 WorkBuddy 不会做 |
|---|---|---|
| ① | **4 套配方引擎**（货损/返利/工资/预报），参数化 + 版本链，一家客户一套口径 | 通用平台不可能沉淀低温奶 know-how |
| ② | **垂直人格与话语体系**：禁术语、结论先行、经营卡、红涨绿跌 ¥ | 通用助手讲通用语言 |
| ③ | **微信/企微/小程序触达**——经销商主战场在微信 | 通用平台无行业触达链路 |
| ④ | **无 API 也能用**：Excel/CSV + 舟谱模板 + 金蝶/畅捷通连接器 | 通用平台依赖开放 API |
| ⑤ | **表格对账 MCP**：强制走工具精确计算，禁模型自行写脚本 | 通用平台倾向让模型写 Python |

---

## 2. UI/UX 设计对比

| 项 | hergent 现状 | WorkBuddy 参照 | 差距 |
|---|---|---|---|
| 布局 | 三栏（Shell 侧栏 + 主区 + 副驾抽屉）+ artifacts 右栏，可拖宽/全屏 | 主区 + 产物面板 | ✅ 已对齐 |
| 设计令牌 | `variables.css` 双主题 + 品牌青 `--p=#06b6d4` | 统一令牌体系 | ✅ 基本对齐 |
| 图标 | Lucide 风格 `Icon.vue` 线性 SVG，已完成 emoji 清理 | currentColor 线性图标 | ✅ 已对齐 |
| 经营卡 | ResultCard 范式 + `cards` 意图围栏（用户无感） | 卡片化交付 | ✅ **领先**（AI 判断出卡，无需用户决策） |
| 富文本 | 自研 `md.js`（零依赖、先转义后渲染，防 XSS） | 富呈现 | ✅ 已补（8-31 上线） |
| **命令面板 ⌘K** | 无 | 模糊命令面板 | ❌ 缺 |
| **快捷键体系** | 无文档化快捷键 | 快捷键 + hint | ❌ 缺 |
| **思考过程可见** | 无 | thinking 折叠 | ❌ 缺 |
| **停止/重生成/复制** | 有 streaming，停止与重生成待确认 | 三件套齐全 | ⚠️ 待补 |
| **空态/骨架屏** | 有 `state-empty`，未系统化 | 系统空态引导 | ⚠️ 待补 |
| **a11y** | 弱（未系统标注 aria-live / focus trap） | WCAG 基线 | ⚠️ 待补 |
| **响应式** | 副驾有 `isNarrow` 降级 | 断点系统 | ⚠️ 中等 |

> 判断：**范式层已同频，缺"最后一公里"的交互细节**。这些改动单点击穿成本低、体感收益高，是最佳短期标的。

---

## 3. 前端实现对比

| 项 | hergent 现状 | 参照 | 差距 |
|---|---|---|---|
| 技术栈 | Vue 3.5 + Vite 6 + Pinia + vue-router（20,264 行 / 21 页面 / 10 组件） | 现代组件化 | ✅ 底座正确 |
| HTTP 层 | `api/client.js` 单一封装 `api(path,opts)` + `hermesChat` SSE，禁裸 fetch | 统一客户端 | ✅ **已收口（做得好）** |
| 依赖 | 仅 vue/vue-router/pinia/xlsx（+playwright 开发依赖） | — | ✅ 极简，**但** |
| **图表库** | **无**（ECharts/Chart.js 全无；唯一 chart 是硬编码数组） | 可视化组件库 | ❌ **最大缺口** |
| **巨石组件** | `Forecast.vue` **6,564 行**、`Rebate.vue` 3,235 行 | 拆分 + 组合式 | ❌ 维护风险 |
| TypeScript | 无（141 个 .ts 为历史遗留） | 强类型 | ⚠️ 中 |
| 测试 | 仅 playwright 依赖，无单测体系（逻辑靠临时单测） | 单测 + E2E | ⚠️ 中 |
| 状态管理 | Pinia 单 store（`store/index.js`） | 模块化 store | ⚠️ 中 |
| 设计系统文档 | 无 Storybook/文档 | 组件文档 | ⚠️ 低 |

> 关键取舍：依赖极简是**优点**（CSP 安全、体积小），所以**图表应走自绘 inline SVG 路线**（延续 `md.js` 自研思路），不引入外部图表库。

---

## 4. 后端架构对比

| 项 | hergent 现状 | 参照 | 差距 |
|---|---|---|---|
| 框架 | FastAPI + SQLite 多租户（主库 + tenant_N.db），`server.py` 5,037 行 + **85 个 router** | 域拆分 | ✅ 已拆分到 router |
| RBAC | `_PATH_MODULE_MAP` 292 条 fail-closed，未登记即 403 | 最小权限 | ✅ **做得好** |
| 配方化 | 4 套配方引擎（GET/PUT /recipe），多客户差异化 | — | ✅ **护城河** |
| 连接器 | 金蝶 `kingdee_connector.py`、畅捷通、舟谱模板、Excel 摄入 | 连接器生态 | ✅ 雏形 |
| **AI 主链路** | `_call_llm` 用 **urllib 同步阻塞**、`timeout=20`、**非流式**、强制 `response_format:json_object`、`MAX_AGENT_TURNS=5`、`MAX_HISTORY_LEN=20` | 异步流式 + 长上下文 | ❌ **架构级短板** |
| **连接池/异步** | 每请求 connect；HTTP 用 urllib 非 httpx | 池化 + async | ❌ 中 |
| **多租户简报** | `scheduler.py:662` 自注"按默认租户聚合（**多租户需另循环**）" | — | ❌ **商业化硬阻塞** |
| **DataSourceAdapter** | `_PlannedAdapter` 全部 `NotImplementedError`，`_ENABLED={"local":True,"kingdee":False,"excel":False}` | 解耦层 | ❌ 架构债 |
| 迁移 | Alembic 已就位（v88 脚手架），历史 446 处 ALTER 非幂等 | 幂等迁移 | ⚠️ 中 |
| 可观测 | 有 `metrics.py`，无 trace_id 全链路 | 结构化日志 + trace | ⚠️ 中 |
| 错误处理 | 有统一信封（已修复），仍存宽捕获 | 分层异常 | ⚠️ 中 |

---

## 5. 优化建议（按优先级）

> 工作量单位：**人日（AI 辅助、单人开发）**。周期划分：**短期**＝1–2 周可上线；**中期**＝3–6 周；**长期**＝1–3 月能力建设。

### ★ 高优先级（P0）

| # | 建议 | 目标 | 预期收益 | 技术改动范围 | 工作量 | 周期 |
|---|---|---|---|---|---|---|
| **H1** | **图表数据去假 + Inline SVG 自绘可视化** | 让经营卡/AI 回复里的趋势、对比、占比真正成图 | 信息密度↑、可信度↑、**消除假数据风险**（当前是 P0 级信任隐患） | 新增 `VizCard.vue`（自绘 sparkline/柱状/环形，零依赖）；`useCardTrigger.js:144` chart 接后端真数据；4 类卡（货损/工资/返利/预报）各出 1 张图 | **3–5** | **短期** |
| **H2** | **工具调用过程可视化** | AI "查了什么/算到哪一步"在对话流可见 | 等待焦虑↓、信任↑、出错可定位 | SSE 增加 `tool_start/tool_end` 事件（`hermes_core` + Hermes 侧各一）；前端复用 `ProgressSteps.vue` 渲染步骤条 | **4–6** | **短期** |
| **H3** | **AI 主链路流式化 + 异步化** | `hermes_core` 从同步 urllib 改 httpx 流式 | 首字延迟 20s→<2s、长回复不再超时、支持"停止生成" | `_call_llm` 改流式；`/api/ai/chat` 改 `StreamingResponse`；前端已支持 SSE 复用 | **5–8** | **短期→中期** |
| **H4** | **多租户简报循环**（商业化硬阻塞） | 8:05 简报按租户遍历推送 | **解锁第二家客户**，服务形态可变现 | `scheduler.py:657` 加租户遍历 + 各租户推送目标；缺失配置 fail-closed 跳过 | **2–3** | **短期** |
| **H5** | **配方参数 ↔ Skill 口径同步** | 改配方后 AI 说法与计算结果一致 | 护城河可信度根基（否则"说一套算一套"） | 4 个 Skill 提示词模板化（`{{threshold_days}}` 等注入）；新增 `recipe_sync.py` 渲染（该文件已存在，需接线） | **3–5** | **短期** |

### ◆ 中优先级（P1）

| # | 建议 | 目标 | 预期收益 | 范围 | 工作量 | 周期 |
|---|---|---|---|---|---|---|
| **M1** | **记忆分层**（用户画像 / 租户知识 / 会话摘要） | 从"三表 pattern"升级为分层记忆 | 越用越懂这家客户；减少重复追问 | `memory.py` 扩展 + 关键事实抽取 + 会话摘要落库；检索走关键词+时间衰减（暂不引向量库） | **6–9** | 中期 |
| **M2** | **交互三件套 + 命令面板 ⌘K** | 停止生成/重新生成/复制 + 全局模糊搜索 | 体感专业化、效率↑ | 前端：3 个按钮 + `CmdPalette.vue`；路由/页面/动作注册索引 | **4–6** | 中期 |
| **M3** | **多模型与推理可见** | 模型可选 + thinking 折叠 | 复杂问题可信度↑、成本可控 | 后端模型配置表；SSE 增加 `reasoning` 事件；前端折叠展示 | **3–5** | 中期 |
| **M4** | **巨石组件拆分** | `Forecast.vue` 6,564 行拆分为 composables + 子组件 | 回归风险↓、迭代速度↑ | 按"列定义/筛选/汇总/审核"拆 4–6 个 composable + 子组件；保持 API 不变 | **8–13** | 中期 |
| **M5** | **DataSourceAdapter 去桩** | Excel/金蝶两通道真正接线 | "只做 AI 层不造 ERP"战略在代码层成立；新客户接入零改码 | 复用 `import_router.py` + `kingdee_connector.py` 实现两个 Adapter，置 `_ENABLED=True` | **5–8** | 中期 |
| **M6** | **a11y + 响应式系统化** | aria-live/focus trap/断点 token | 合规、读屏可用、平板体验 | 全量交互元素标注；AI 回复区 `aria-live="polite"`；断点 token 落地 | **5–8** | 中期 |

### ▽ 低优先级（P2，长期能力建设）

| # | 建议 | 目标 | 预期收益 | 范围 | 工作量 | 周期 |
|---|---|---|---|---|---|---|
| **L1** | **对外 MCP server + 技能/配方市场** | 把"低温奶货损测算"等只读能力做成对外工具获客 | 低成本获客（**非收入项**） | 复用 `/opt/hergent-mcp-spreadsheet/server.py` 范式；**只暴露计算，绝不暴露配方全文** | **10–20** | 长期 |
| **L2** | **Postgres + 连接池 + 迁移幂等** | 撑住并发与多租户规模 | 写锁与启动刷屏问题根治 | 迁移评估（`pg_migrate.py` 已存在）+ 连接池 + Alembic 全量幂等 | **10–15** | 长期 |
| **L3** | **全链路可观测**（trace_id + 结构化日志） | 故障可诊断 | 同类"假无数据"bug 不再复现 | 中间件注入 trace_id；日志结构化；关键路径埋点 | **5–8** | 长期 |
| **L4** | **子代理/并行任务**（谨慎） | 复杂分析多步并行 | 长任务提速 | 仅在"月度经营分析"等单一高频场景试点，**不建通用子代理框架** | **15–25** | 长期（可选） |

### ⛔ 明确不建议做的（避免偏离定位）

| 项 | 理由 |
|---|---|
| 多模态生成（文生图/视频/3D） | 与"经营副驾"无关，纯成本 |
| 通用代码沙箱 / 文件操作代理 | 目标用户是老板不是开发者；且增大安全面 |
| 通用专家市场（100+ 角色） | 我们的护城河是**一个行业的深度**，不是角色数量 |
| 追 Hermes 大版本升级 | 今日监控结论＝**维持 v0.19.0**（v0.21.0 有 cron bridge 断裂 + config 迁移 + 进程模型重架构）；AI 层已与引擎解耦 |

---

## 6. 建议执行顺序（依赖排序）

```
Step 1（本周）H4 多租户简报 → H5 口径同步 → H1 图表去假
        ↓ 解锁变现 / 夯实护城河 / 消除假数据风险
Step 2（2-3 周）H2 工具可视化 → H3 流式化
        ↓ 体感与性能双提升
Step 3（1 月）M1 记忆分层 → M2 交互三件套 → M3 多模型
        ↓ 产品成熟度
Step 4（1-2 月）M4 组件拆分 → M5 Adapter 去桩 → M6 a11y
        ↓ 工程化还债
Step 5（季度）L1 对外 MCP / L2 Postgres / L3 可观测
```

**一句话**：先修「变现阻塞 + 假数据 + 护城河可信度」，再做「呈现与流式」，最后还「工程化中台」的债；通用平台能力一律不追。

---

## 附：关键代码位置索引

| 事项 | 位置 |
|---|---|
| 图表（真实卡已带 chart.series，前端自绘 SVG sparkline） | `ResultCard.vue:101` chartGeom；后端 `server.py:1171` loss-card 等 4 张卡 |
| 示例引导卡（demoCard 硬编码数组，仅首屏演示，非真实业务数据） | `hergent-cn-v2/src/composables/useCardTrigger.js:127 demoCard()` |
| 副驾主链路（Hermes SSE 流式，已流式） | 前端 `hergent-cn-v2/src/api/client.js:207 hermesChat` → `/hermes/v1/chat/completions` |
| 遗留二级路径（非流式，副驾不走） | `hergent-erp/server/hermes_core.py:1303 _call_llm`（仅 `/api/ai` 旧路径用） |
| 工具集（~40 个） | `hermes-erp/server/hermes_core.py:78 TOOLS` |
| 角色人格 + 格式协议 | `hermes_core.py:1042 ROLE_SYSTEMS` / `:1138 _REPLY_FORMAT_PROTOCOL` |
| 记忆（三表） | `server/memory.py:21-40` |
| 多租户简报（已修复并部署） | `server/scheduler.py:657 _push_copilot_cards_brief` |
| Adapter 桩 | `server/datasource_adapter.py:122-167` |
| 副驾主组件 | `hergent-cn-v2/src/components/CopilotDrawer.vue` |
| 巨石组件 | `pages/Forecast.vue`（6,564 行）、`pages/Rebate.vue`（3,235 行） |
| 统一 HTTP 层 | `hergent-cn-v2/src/api/client.js` |

---
## 执行记录与更正（2026-09-06 续）

> 上文发布后，按"P0→P1→P2 顺序执行"推进。执行中通过生产实测**更正了两条原报告的误判**，并落地了实际改动（与"只读分析"的初版声明不同，本续节为执行记录）。

### ⚠️ 两条误判更正
1. **"图表≈0 / 硬编码假数据信任隐患"不成立。** 四张真实经营卡（货损/工资/返利/预报）后端均返回 `chart.series`（来自 `daily_trend`），前端 `ResultCard.vue` 已用自绘 SVG sparkline 渲染；空数据静默隐藏。`useCardTrigger.js:144` 的 `[210,380,...]` 仅存在于 `demoCard()`（首屏"示例经营卡"引导演示，代码注释已标明"让老板先看懂价值再开口问"），**不是生产真实业务数据**。唯一真实改进：真实卡无趋势数据时由静默隐藏改为显式"暂无趋势数据"。
2. **"AI 主链路同步非流式"不成立。** 副驾对话实际走前端 `hermesChat` → `/hermes/v1/chat/completions` 的 **Hermes SSE 流式**（OpenAI 格式 `delta.content`），并非 `server.py/hermes_core` 的二级路径。`hermes_core.py` 的 urllib 同步实现仅服务于遗留 `/api/ai` 旧路径，副驾主链路不走，非阻塞，无需重写。

### 已落地改动（均已部署生产）
| 项 | 改动 | 验证 |
|---|---|---|
| **H4 多租户简报**（变现硬阻塞，真实 bug） | `domain/wastage_tracker.py` 新增 `_ensure_wastage_tables(db)` 惰性建表，修复 `init_db` 只在主库跑迁移、租户库缺 `wastage_orders` 导致 7/8 租户简报货损段缺失；另补建 tenant_2 空 `users` 表 | 生产只读验证：货损段覆盖 **1/8 → 8/8**，三段齐全 8/8；已 commit |
| **H2 工具调用过程可视化**（新能力） | `client.js hermesChat` 增加 `event:` 行解析 + `onTool` 回调（匹配生产 Hermes v0.19.0 的 `response.output_item.added/done` Responses 风格事件）；`CopilotDrawer.vue` 每个助手消息增 `tools[]` 并渲染步骤（运行中转圈/完成打勾 + 工具名 + 参数预览） | 生产 Hermes 源码只读核查确认事件格式；前端已构建部署，`cp-tool` 已入生产 bundle |
| **H1 空数据降级**（小改进） | `ResultCard.vue` 真实卡无趋势数据时显式"暂无趋势数据"替代静默隐藏 | 已部署 |

### 结论更新
- 原 P0 五项中：**H4 是真实 bug 已修**（最高价值）；**H5 配方同步此前已落地**（dry-run 验证通过）；**H1 图表与 H3 流式均早已具备**，本轮回填了唯一缺口（空数据降级 + 工具过程可视化）。
- **当前 P0 实际剩余缺口 ≈ 0**。建议下一步按业务价值而非"补报告清单"推进：优先 P1 中**最高 ROI 的两项**——M2 命令面板/快捷键（交互效率，前端为主）与 M4 `Forecast.vue` 巨石拆分（可维护性，降低改 UI 的风险成本）。M1 记忆分层、M3 多模型、M5 Adapter 去桩可视情况后做。

---
*初版为只读分析（2026-09-06）；续节为执行记录与更正（2026-09-06 同日内），含生产部署改动。指标来自对本地源码与生产机的实测。*
