# Hergent AI 经营副驾 vs WorkBuddy — 系统性代码级差距比对

> 比对日期：2026-09-24
> 比对对象：
> - **我们 AI** = `hergent-cn-v2`（Vue3 前端）+ `hergent-erp`（FastAPI 后端）+ 外部 **Hermes** 推理大脑 + `hergent-milk-*`（领域技能包）
> - **WorkBuddy** = 本机 `/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/`（Electron + Web UI 构建产物 + Skills + MCP + 原生模块）
> 方法：两个 Explore 子代理逐文件核查两仓库 + 本人对最高影响断言直接复核（file:line 见正文）。仅分析产品代码/UI/Skills/特性，**未触及任何内部隐藏提示词**。

---

## 0. 先看清架构本质差异（理解后面所有差距的前提）

| 维度 | 我们 AI | WorkBuddy |
|---|---|---|
| 大脑数量 | **两个互相独立的大脑** | 单一集成 Agent Loop |
| Web 副驾路径 | 前端**直连外部 Hermes**（`client.js:286` `fetch('/hermes/v1/chat/completions')`） | 统一走宿主 Agent Loop |
| IM 机器人路径 | 本仓库 `hermes_core.call_hermes_agent`（`server.py:1359` `/api/chat`） | 同上宿主 |
| 领域算法归属 | `hergent-milk-*` 技能包在**外部 Hermes 租户目录**（`recipe_sync.py:11`），本仓库只同步"算法口径"（确定性管道，`recipe_sync.py:29`） | 技能即 SKILL.md，随产品分发 |
| 模型切换 | 前端**硬编码** `model:'hermes-agent'`（`client.js`） | 35+ 模型目录，用户/按任务可切（`product.json`） |

**结论**：我们 AI 的真实推理与工具调用能力在**外部 Hermes**；本仓库提供的是「ERP 集成层 + IM 机器人大脑 + 经验闭环 + 角色/渠道/定时任务管理」。WorkBuddy 则是「单一可插拔 Agent + 多模型 + 技能市场 + MCP + 原生模块」。

---

## 1. 分维度差距对比（第一部分）

### 1.1 核心功能

| 功能 | 我们 AI（证据） | WorkBuddy（证据） | 差距判断 |
|---|---|---|---|
| 对话式推理 | 外部 Hermes（流式 SSE，`client.js:278-362`） | 宿主 Agent Loop（SSE/EventSource 26 处，`lazy-lite-wb`） | 持平（都流式） |
| 业务工具 ~30 个 | `hermes_core.execute_tool` 硬编码 if/elif（`hermes_core.py:265-725`：建客户/建销售单/收款/发工资/损益表…） | 通用工具靠 MCP：`ListTools` 52 / `callTool` 27（`cli/dist`） | **我们更深（垂直），但不可插拔** |
| 表格精确计算 | 外部 spreadsheet MCP（`client.js:391` 注释） | 通用 file/code 工具 | 我们更专精 |
| 多模态**生成**（文生图/视频/3D） | **完全没有**（全仓 grep 仅 OCR 消费图片 `ocr.py`） | `buddy-multimodal-generation`（ImageGen/VideoGen/3D/video-fx）+ 混元图像模型 | **我们缺失（重大）** |
| 技能市场 / 插件 | 无市场；领域包在外部 Hermes，本仓库不可见 | `marketplace-skill-installer` + 30+ SKILL.md（`wb-finance`、`tencent-docx/pptx`、`ardot-*`、`miora-*`…） | **我们缺失（重大）** |
| 连接器 / OAuth 市场 | 仅数据同步连接器（`chanjet_connector`/`kingdee_connector`/`bank_connectors`），非用户可装 | `recommend-connectors` + OAuth 39 处 + 扩展（Feishu/WeCom/邮箱） | **我们弱（重大）** |
| 浏览器/计算机使用 | 无 | `native/computer-use-launcher` + `browser-computer-use.md` | **我们缺失** |
| 内容发布 | 无 | `sites`（发布网站/小程序） | 我们缺失 |
| 经验闭环（自进化） | **有**，分桶+红线+自动提案（`experience_loop.py`，本次 P2-4 已闭环） | 无对应（memory 是上下文记忆，非行业口径共享） | **我们独有（护城河）** |
| 领域深度（低温奶） | **有**：货损/预报/提成/返利 4 个技能包映射（`recipe_sync.py:61-64`） | 无 | **我们独有（护城河）** |

### 1.2 交互体验

| 体验项 | 我们 AI（证据） | WorkBuddy（证据） | 差距判断 |
|---|---|---|---|
| 输入框结构 | 右侧抽屉 `CopilotDrawer.vue` | composer（卡片+子卡+chip+箭头+portal，CSS 变量证实） | 形态不同，持平 |
| 文本+文件+图片+语音 | 文件 `accept` 含图片（`CopilotDrawer.vue:263`），语音按钮 `:295` | composer 支持文本/文件图片/语音/截图（`audio` 194、`screenshot` 10、`attach` 49） | **我们缺截图** |
| **图片真喂给模型** | ❌ **伪多模态**：只把 `xlsx|csv` 转发 Hermes（`:1129`），图片仅传文件名 | ✅ `supportsImages:true` 34 个模型 | **我们重大缺陷** |
| 流式 | Web 端 SSE 流式；IM 端大脑在外部 Hermes 网关（:18765），本仓 `hermes_core` 不服务 IM 对话 | SSE 流式（EventSource 26） | IM 端待核实网关侧 |
| Markdown/代码块 | ✅（`CopilotDrawer.vue:93` `renderMd` + code 样式） | ✅（codeBlock 5 / markdown） | 持平 |
| 卡片协议 | ✅ ```` ```cards ````→ResultCard（`:1207-1281`） | 产物卡片 Artifacts（3） | 持平/各异 |
| 内联可视化 widget | ❌ 仅 Markdown 表格，无 chart/diagram | ✅ 图表/示意图/原型 widget（show_widget） | **我们缺失** |
| 角色/团队切换 | ✅ AI 团队胶囊（`CopilotDrawer.vue:266-286` 取 `/api/ai/roles`） | 交互模式 ask/craft/expert/plan/quick（5 种） | 我们偏业务角色，持平 |
| **斜杠命令** | ❌ 无（`CommandPalette.vue` 是命令面板，非对话内 `/`） | 有 slash command 体系 | **我们缺失** |
| 动作护栏 | ⚠️ **软护栏**：仅系统提示注入 `AI_GUARD_HINT`（`:1165`），状态存 `localStorage`（`:741`），**无后端硬门禁** | 后端权限/确认闸门（连接器两阶段确认） | **我们弱（安全）** |
| 会话持久+搜索 | ✅ `/api/ai/sessions` + `/search-chat`（`ai_assist.py:179-253`） | 有 memory 层 | 持平 |
| 用量计量 | ✅ `/api/ai/usage`（`CopilotDrawer.vue:1288`） | per-model credits（`product.json`） | 持平 |

### 1.3 技术能力

| 能力 | 我们 AI（证据） | WorkBuddy（证据） | 差距判断 |
|---|---|---|---|
| 多模型 | ❌ 硬编码 `hermes-agent` | ✅ 35+ 模型，多厂商（DeepSeek/GLM/Kimi/混元），`supportsToolCall` 35 / `supportsReasoning` 25，最高 1M 上下文 | **我们缺失** |
| 工具注册表 | ❌ 硬编码 if/elif（约 30 工具） | ✅ MCP 客户端 + 3 内置 MCP（`agently-cli`/`ardot-mcp-app`/`miora-mcp`） | **我们弱** |
| MCP 框架 | 仅外部 Hermes 用 spreadsheet MCP；**本仓库无 MCP 客户端/服务端** | ✅ 完整 MCP 客户端 | **我们缺失** |
| 技能系统 | 领域包在外部，本仓库不可审计 | ✅ SKILL.md + 市场安装器 | **我们弱** |
| 自动化 | 内部 cron：`scheduler.py:119-123` 每日 7:30/7:35 跑洞察，`:1134-1203` 提醒 | ✅ 用户态 RRULE（一次性/循环，`automation_update`） | **我们偏后台，缺用户态** |
| 记忆 | 模式记忆 `hermes_core._load_memory_patterns`（`:38-65`）+ 会话持久 | ✅ 云+本地多层 memory，自动用户画像 | 我们偏业务，持平 |
| 多 Agent/子代理 | ❌ 无（仅外部 Hermes 内部） | ✅ subagent/agentType（Plan/Explore 等） | **我们缺失** |
| 多模态生成 | ❌ 无 | ✅ 图/视频/3D | **我们缺失** |
| 计算机使用 | ❌ 无 | ✅ 原生 launcher | **我们缺失** |
| 安全护栏 | 写工具拦截 `HERMES_WRITE_TOOLS`（`hermes_core.py:262`，仅 IM 路径有效） | RBAC + 两阶段确认 + 沙箱 | 我们 Web 路径有缺口 |

### 1.4 适用场景

| 场景 | 我们 AI | WorkBuddy |
|---|---|---|
| 低温奶经销商经营决策（预报/返利/货损/提成） | ✅ 深 | ❌ 无 |
| 基于自家 ERP 数据的对话式分析 | ✅（锚定 ERP） | ⚠️ 需接连接器 |
| 跨租户经验复利（行业口径共享） | ✅（经验闭环） | ❌ |
| 写代码/建站/自动化办公 | ❌ | ✅ 强 |
| 设计/海报/幻灯片/文生视频 | ❌ | ✅ 强 |
| 金融研究/行情 | ⚠️ 仅有 `wb-finance` 对标，我们无 | ✅ |
| 浏览器/桌面自动化 | ❌ | ✅ |
| 个人生产力/通用问答 | ⚠️ IM 兜底 200 字（`server.py:1408`） | ✅ |

**判断**：两者**不是纯粹竞争关系**——我们是「垂直纵深 + ERP 锚定 + 自进化」，WorkBuddy 是「横向广度 + 多模态 + 工具生态」。我们的护城河在 1.1/1.4 的右两列（经验闭环、领域深度），短板在 1.2/1.3 的通用能力层。

### 1.5 性能与可观测性

| 项 | 我们 AI | WorkBuddy |
|---|---|---|
| 运行时 | FastAPI + SQLite 多租户；Web 流式靠外部 Hermes | Electron + Vite 代码分割（单 chunk ≤490KB）+ 原生 `perf-metrics` |
| 流式延迟 | Web 端 OK；IM 端大脑在外部 Hermes 网关（:18765），本仓 `hermes_core` 不服务 IM，是否流式需核实网关侧 | SSE 流式 |
| 单点依赖 | ⚠️ **外部 Hermes 是单点**（Web 副驾直连） | 多模型可降级 |
| 可观测 | 仅 usage 计量；无原生 perf 模块 | `native/perf-metrics` |
| 构建优化 | Vite 常规；Workbench chunk ~19KB | 重度哈希分块 + headless 模式 |

---

## 2. 我们 AI 最关键的真实短板（代码定位）

1. **副驾绕过服务端 AI 模式管控**（安全/正确性）— Web 副驾直连 Hermes（`client.js:286`），而 `disabled/readonly` 只在 `/api/chat` 检查（`server.py:1368-1388`）。**管理员在后台关 AI / 只读，对 Web 副驾无效**。
2. **"允许执行"是软护栏**（`CopilotDrawer.vue:1165` 仅注入提示词，`:741` 存 localStorage）— 无后端第二道硬门禁，写操作是否真发生取决于外部 Hermes，本仓库副驾路径无校验。
3. **伪多模态**（`CopilotDrawer.vue:1129` 只转发 `xlsx|csv`）— UI 接受图片但模型看不到图，用户以为能"发照片问 AI"实际失效。
4. **模型硬编码 `hermes-agent`**（`client.js`）— 无法按成本/质量切换，也无本仓库可审计的模型层。
5. **IM 大脑归属纠正**：经代码核查，企微/飞书/钉钉的对话大脑在**外部 Hermes 网关引擎（:18765）**，本仓 `server/hermes_core.call_hermes_agent` 仅服务 `/api/chat`（小程序/Web 早期）、`routers/bot.py`（桌面 Agent）、`scheduler`（定时），**不参与 IM 对话**（本仓库无 IM webhook 接收端点，推送走 Hermes CLI `send`）。故"IM 非流式"不能依据 `hermes_core:1211` 论断——IM 是否流式取决于网关引擎侧，需另核实。
6. **无技能市场 / 无 MCP 框架 / 无连接器市场** — 能力扩展靠改代码，不可由运营/客户自助。
7. **外部 Hermes 单点依赖** — Web 副驾直连，自托管/容灾弱。
8. **领域技能包不可在本仓库审计**（`recipe_sync.py:11`）— 算法口径确定性同步，但技能原文在外部，复盘/合规难。

---

## 3. 改进方案（第二部分，按优先级）

> 原则：**先补"会害人的正确性/安全缺口"与"用户已感知的失效功能"，再补通用能力层；不盲目做成 WorkBuddy 克隆，护城河（经验闭环+领域深度）保持并加固。**

### 🔴 高优先级（伤害正确性/安全/已失效体验，必须做）

**H1 — 副驾接入本仓库后端代理 + 统一网关**
- **目标**：Web 副驾不再直连外部 Hermes，改走本 FastAPI 新增 `/api/ai/copilot/chat` 代理；代理内强制校验 AI 模式（`disabled`/`readonly`）与写工具硬门禁（复用 `hermes_core.HERMES_WRITE_TOOLS` 思路），并统一计量/审计。
- **预期效果**：① 后台"关闭 AI / 只读"对 Web 副驾**真正生效**；② "允许执行"从软提示变**后端硬拦截**；③ 计量/会话/审计一致；④ 为去 Hermes 单点打基础。修复了短板 #1/#2/#7 的部分。

**H2 — 真多模态输入（图片真正喂给模型）**
- **目标**：`CopilotDrawer.send()` 把图片转为 `image_url`/多模态 content 块随消息发给 Hermes（Hermes 本身支持视觉）；UI 增加"图片已附，AI 可见"明确提示。
- **预期效果**：用户可发**货架照片/报表截图/进货单照片**让 AI 直接解读，伪多模态→真视觉问答。修复短板 #3。

**H3 — 对话大脑流式化（分两部分，边界已厘清）**
- **本仓可控部分（✅ 已部署并生产验证）**：把 `/api/chat` 改造成兼容式真流式端点——`server.py` 新增 `stream` 分支返回 `StreamingResponse`，`hermes_core.stream_chunks_for` 把整段回复按句切片逐 yield。默认仍返回 `{"reply":...}` JSON，**现有客户端零影响**。惠及**小程序/Web 端**对话逐字呈现。这是视觉级流式（先整段生成再切），零 agent loop / LLM 改动，软回退，零回归风险。触发兼容两种传参：body `{"stream":true}` 或 query `?stream=true/1/yes`。
- **IM（企微/飞书/钉钉）端（受架构限制，本仓库改不了）**：IM 对话大脑在外部 Hermes 网关引擎（:18765），不在本仓库。要让企微/飞书"逐字回复"，需在该网关引擎侧改造（确认其是否已流式 / 增加分段 `send`），或重构让网关复用本仓 `/api/chat` 流式端点。列为 **H3-IM**，需单独评估与排期（详见下）。
- **预期效果（本仓部分）**：小程序/Web 端 AI 回复从"整段蹦出"变为"逐句流出"，体验对齐 WorkBuddy 流式；修复短板 #5 中"本仓可控"的那一半。

### 🟡 中优先级（补通用能力层、提效）

**M1 — 对话内斜杠命令（/ 快捷指令）　✅ 已上线**
- **目标**：在 composer 内实现 `/` 触发指令面板（复用现有 `CommandPalette` 能力），预置高频操作：`/报单` `/查库存` `/今日洞察` `/生成日报` `/审批提案`。
- **预期效果**：老板少打字、少点菜单，常用动作一步触发，提升日活与黏性。
- **实现（2026-09-24）**：`CopilotDrawer.vue` 内新增输入框**上方的内联浮层**（非全屏模态 —— 斜杠命令的标准形态，不打断输入）。复用 `CommandPalette` 的范式：分组（快捷提问 / 跳转页面）+ `Icon` + `store.canModule` 权限过滤 + ↑↓/Enter/Esc 键盘导航。13 条命令 = 8 条预置提问（选中即发：报单/查库存/今日洞察/生成日报/审批提案/催款/返利/货损）+ 5 条页面跳转（工作台/预报/返利政策/商品目标/算工资）。
- **验收（真机只读探针 `tools/m1-slash-e2e.mjs`，26 项断言全绿）**：输入 `/` 出浮层且几何可见；**命令集 = 权限接口现算的预期集**（本账号 perms=`["data","dashboard"]` ⇒ 精确过滤到 8 条，stock/accounts/sales/payroll 系命令如期隐藏）；子串过滤；↑↓ 高亮移动；Esc 关浮层且**不吞草稿**；反例对照（普通文本／含空格 `/xx yy` 不弹）；Enter 命中跳转命令 ⇒ 真跳页 + 收起抽屉；全程 0 控制台报错。

**M2 — 内联图表/看板 widget　✅ 已上线（含一处结论修正）**
- **目标**：在 `CopilotDrawer` 产物栏支持图表渲染（趋势折线/达成率环形/货龄分布），把"经营一页纸"从静态四宫格升级为可交互图。
- 🔴 **结论修正（2026-09-24 核实）**：图表基建**其实早已存在** —— `ResultCard.vue` 一直支持 `chart.kind = mini/bar/donut` 三种自绘 SVG，且 4 张确定性经营卡（货损/工资/返利/预报）**都已挂图**。真正的缺口只有两条：① `donut`（环形/构成）**从未被任何后端产出**；② `/api/chat` 那条 ` ```viz ` 路径是**死代码**（前端全仓无 `viz` 解析器、且前端从不调 `/api/chat`）。
- **本轮实做**：`ResultCard` 升级为**一卡多图**（`card.chart` 可为对象或数组，几何按图对象现算）；后端货损卡加「货损构成（环形，Top4 商品 + 其他 ⇒ 恒 100% 且与总额自洽）」；示例卡改为双图；并把死路径注释改为准确说明（不再误导后人）。
- **验收**：真机只读探针 `tools/m2-chart-e2e.mjs` **16 项断言全绿**（折线 7 点仍在、环形 3 段弧 + 图例 3 项、两图均有尺寸、双 caption、图例与指标口径自洽、0 报错）。截图 → `outputs/M2-一卡双图-2026-09-24/`。

**M3 — 领域技能包可审计中台　✅ 已上线（审核台部分）**
- **目标**：算法口径版本化 + 提供"提案审核台"UI（经验闭环生成的 `recipe_proposals` pending 让运营可看/批）。
- **本轮实做**：后端 `/api/ai/recipe-proposals`（list）+ `/{pid}/review`（accept/reject）**本就存在**；本轮补上前端 —— AI 中心新增「口径提案审核台」卡片：模块徽标 / 状态徽标（待审批·已采纳·已驳回）/ 理由 / 改动行（`字段 = 值`）/ 来源与时间 / 采纳·驳回（**仅管理员可点**，非管理员按钮 disabled + 提示）。
- 🔴 **顺带修掉一个口径缺陷**：该卡对 `/api/ai/*` **403 时原本会显示「暂无待审提案」** —— 把「没权限」说成「没数据」（违反本项目「降级即抹掉」铁律）。已改为单独提示「没有『AI 对话』模块权限…」。
- **验收**：探针 `tools/m3-proposal-e2e.mjs` **23 项断言全绿**（真机卡片渲染 + 403 文案正确 + 桩造 2 条提案验列表/徽标/按钮禁用/几何整行铺开 `fill=100%`）。截图 → `outputs/M3-提案审核台-2026-09-24/`。
- **未做**：`hergent-milk-*` SKILL.md 与本仓版本化目录（技能包在**外部 Hermes 租户目录**，本仓无副本；需先确认技能包来源与归属再入库）。

**M4 — 模型可切换 + 成本栏　⛔ 受架构限制（需先做 H1 代理层）**
- **目标**：copilot 代理层支持按角色/租户选模型 + 前端每次对话显示消耗。
- 🔴 **为什么本轮没做**：Web 副驾是**直连外部 Hermes**（`client.js:286`），模型由 Hermes 侧决定，**本仓库改不动它的模型选择**。要让 M4 真正生效，必须先落地「副驾走后端代理」这层（即 H1 里我刻意没做的那部分，因为动正在跑的 SSE 通道风险高）。**建议顺序：先做代理层 → M4 才有落点。**
- 本仓**可**先做的部分（若要做）：`/api/chat` 那条链的模型是可配的（`hermes_core.py:1382` 硬编码 `deepseek-chat`），可加「按租户/角色选模型 + 回执带 `usage` 成本」。但那不覆盖 Web 副驾主路径，收益有限。

### 🟢 低优先级（战略扩展，按需）

**L1 — 连接器市场雏形　⏳ 未做（本轮）**
- **目标**：把已有的 `chanjet/kingdee/bank` 数据连接器封装为用户可装/可授权的连接器入口。
- **现状**：本仓确有连接器地基（`chanjet_tokens` 表、能力中心页）。但"可装/可授权"入口要先摸清各连接器的真实授权流程（OAuth？填 key？），否则只是把静态清单摆出来、用户点不动。**建议先做只读「连接器清单 + 状态」再上授权。**

**L2 — 去 Hermes 强耦合（自托管 chat 端点）　🔴 结论修正：对 `/api/chat` 已存在；真缺口在副驾主路径**
- **目标**：本仓库内 LLM 直接应答兜底，外部大脑不可用时降级。
- 🔴 **复核发现**：`/api/chat` 的第 2 级**本来就是本仓直连 DeepSeek**（`hermes_core.call_hermes_agent`），不依赖外部 Hermes —— 也就是说"自托管应答"对 `/api/chat` **已经存在**。真正没有任何兜底的是 **Web 副驾主路径**（直连外部 Hermes，它挂即挂）。
- ⇒ **L2 的实质与 M4/H1 是同一件事**：给副驾加「后端代理层 + 兜底」。**单独做 L2 没有落点**，应与 H1 代理层合并立项。

**L3 — 多 Agent 编排（subagent）　⛔ 建议单独立项**
- **目标**：复杂任务（如"月度经营复盘"）拆子任务并发。
- **评估**：需新增编排器 + 任务状态机 + 结果合并，且现有 `scheduler` 是**定时**语义、不是**并发编排**语义 —— 属**架构级改动**，与 H3-IM 同级别的风险面。**不建议在"顺手做"的批次里动它。**

**L4 — 构建与可观测优化　⏳ 未做（本轮）**
- **目标**：前端 chunk 进一步拆分 + 轻量 perf 埋点。
- **现状**：当前已按路由 code-split（最大 chunk：Forecast 375KB / roles 284KB / Rebate 169KB）。再往下拆**收益有限且有回归风险**（动态 import 拆错会白屏）；perf 埋点需先定"埋到哪"（本仓目前无 perf 接收端点）。**建议按真实卡顿数据驱动再做，不预先雕花。**

---

## 4. 战略定位结论

| 我们 AI 应**守住/加固**（护城河） | 我们 AI 应**补齐**（短板） |
|---|---|
| 经验闭环（跨租户行业口径共享） | 副驾模式管控 + 硬护栏（H1） |
| 低温奶 4 大领域技能包深度 | 真多模态（H2） |
| ERP 数据锚定的经营决策 | 对话流式（H3；IM 端待网关侧） |
| 老板视角的"经营一页纸" | 斜杠命令/图表 widget（M1/M2） |

**一句话**：WorkBuddy 赢在"广度+多模态+工具生态"，我们赢在"垂直纵深+ERP 锚定+自进化"。改进路线不是变成另一个 WorkBuddy，而是**先堵住会害人的正确性/安全缺口与已失效的多模态，再把高频通用能力（命令/图表/技能可审计）补到老板用得爽的程度**，护城河继续保持领先。

---

## 落地进度（2026-09-24）
- ✅ **H1** 副驾服从后台 AI 模式（disabled 停用 / readonly 强制只建议）已上线。
- ✅ **H2** 真多模态（图片 base64 直传 Hermes 视觉模型）已上线。
- ✅ **H3（本仓部分）**：`/api/chat` 兼容式真流式端点**已部署并生产验证**（`server.py` 的 `stream` 分支 + `hermes_core.stream_chunks_for`）。生产直测三例全绿：默认返回 `application/json`（回归安全）、body `{"stream":true}` 与 query `?stream=true` 均返回 `text/plain` 分块。双侧 md5 一致（`server.py ae02a0a4…` / `hermes_core.py 008465f3…`）、启动无错、公网 `POST /api/chat` 仍 401 鉴权。**H3-IM（企微/飞书）**：经核查大脑在外部 Hermes 网关（:18765），本仓库改不了，需网关侧改造，列为待排期。
- ✅ **M1** 对话内斜杠命令**已上线并真机验收**（`CopilotDrawer.vue` 内联浮层 + 13 条命令 + 权限过滤；探针 26 项断言全绿，Shell 块 `cffb7fa3…` 双侧一致）。命令集随本租户权限自动收窄。
- ✅ **M2** 一卡多图（趋势折线 + 构成环形）**已上线并真机验收**（探针 `m2-chart-e2e.mjs` 16/16；示例卡即双图）。含结论修正：图表基建早已存在，本轮补的是「环形」与「一卡多图」。
- ✅ **M3** 口径提案审核台**已上线并真机验收**（AI 中心新卡；探针 `m3-proposal-e2e.mjs` 23/23）。顺带修掉「403 被显示成『暂无提案』」的口径缺陷。
- 🟢 **【专项】副驾后端代理层**已立项，**P1 已完成并验收**（新增 `POST /api/ai/copilot/chat`：字节级透传 + AI 模式后端权威判定 + 模型可选 + Hermes 挂自动降级本仓 LLM；前端 `localStorage` 开关**默认关** ⇒ 现有链路零影响）。立项书：`outputs/Hergent-副驾后端代理层专项-2026-09-24.md`。
- 🟡 **M4** 落点已备好：代理层已支持按请求/配置选模型；待 P2 放量后再接「按租户/角色」的模型配置 UI 与成本栏。
- 🟡 **L2** 降级链路已跑通（上游不可达 ⇒ 自动切本仓 DeepSeek，且**不静默**，前置「已切换备用模型」提示）；待 P2 真机演练。
- ✅ **P2 放量已完成并验收（2026-09-25）**：默认走代理；两条兜底 —— ① 无 `chat` 权限的账号代理 403 ⇒ **自动退回既有 `/hermes`**（副驾不被搞挂）② `localStorage.hergent_copilot_proxy='0'` 可整体关闭。真机 **7/7**：正常态 200 流式 / 停用态 **403 硬拒**（后端权威）/ 降级态自动切备用模型（用畸形载荷触发，**未动生产 Hermes**）/ 无权限账号自动退回且照常回复。
- 🔴 **顺带一次生产权限变更（已备份+断言）**：`tenant_1` 的 `supervisor` 权限加 `chat`（原本 `["data","dashboard"]`）。**踩到的点**：`_DEFAULT_PERMS` 里 supervisor 也缺 chat，但**租户库覆盖优先于默认值** ⇒ 只改默认值不生效，必须改租户库。
- ✅ **全员放量 + 用户自助开关（2026-09-25 追加）**：给其余角色（sales/guide/accountant/driver + tenant_1 自定义「库管」）补 `chat`；副驾输入条新增 **「自动降级 / 直连通道」** 开关，**用户自己就能开/关**（老板要求）。探针 `tools/proxy-toggle-e2e.mjs` **9/9**。
- ✅ **P3 已修复（2026-09-25）**：勘察发现拦截面**就在本仓库**（40 个工具全由 `hermes_core.execute_tool` 单一分发，不需要 Hermes 配合）。修掉两个真实缺口：① `run_payroll`（会写工资批次）漏登记为写工具；② `execute_tool` 只判 `readonly` 不判 `disabled` ⇒「停用 AI 后仍可经 `/api/bot/*` 写单」的残留口子。验证 5/5（写函数打桩，零风险）。勘察报告 → `outputs/P3-readonly硬语义-可行性勘察-2026-09-25.md`。**P4**（回收 nginx `/hermes`）**前置条件已具备**（全员有 chat、代理成主通道），建议把 `/hermes` 限制为仅后端可访问——需先确认桌面端/小程序不依赖它。
- ⛔ **L3** 多 Agent 属架构级改动，建议单独立项（不与顺手批次混做）。
- ⏳ **L1 / L4** 未做（本轮）；建议 L1 先做只读连接器清单、L4 按真实卡顿数据驱动。

### H3-IM（企微/飞书逐字回复）的两条可行路径（待用户拍板排期）
1. **确认并启用网关侧流式**：Hermes 网关引擎（:18765）是重型 LLM 框架，通常自带流式推送能力。先核实它在 IM 端是否已逐字推送（可能之前的"非流式"论断本身就不成立）；若已流式则无需改动，只需验证。
2. **重构让网关复用本仓流式端点**：让网关在生成 IM 回复时改调本仓 `/api/chat?stream=true`，再把流式分块经 Hermes CLI `send` 分段推回 IM（飞书可 update 同条消息、企微/钉钉连发多条）。这是架构改动，需动网关，单独立项。
