# WorkBuddy「提示词功能」调研 · Hergent AI 副驾引入评估与实施方案

> 调研日期：2026-09-13
> 调研方法：**实地勘察 WorkBuddy 桌面端解包资源**（`/Applications/WorkBuddy.app/Contents/Resources/`），不依赖官网文案与推测。
> 交付内容：① WorkBuddy 提示词功能的真实机制与范围 ② Hergent 是否引入的判断依据与结论 ③ 若引入的具体实施方案。

---

## 〇、结论先行（三句话）

1. **WorkBuddy 的「提示词」不是一个功能，是四个不同层级的东西** —— 场景提示词卡（L1）、模式与场景的系统提示词追加（L2）、用户自定义斜杠命令模板（L3）、增强提示词按钮（L4）。四层各有独立的载体、写入方与生效点，混为一谈必然做错。
2. **Hergent 需要做的是 L1（改形态）+ L2（配置化），明确不做 L3 的用户侧，L4 降级缓做。** 判断依据不是「WorkBuddy 有我们也要有」，而是：我们的用户是**不会写提示词的经销商老板**，他的痛点是「不知道该问什么」，不是「问得不够好」。
3. **项目根那份《AI层-提示词增强与MCP连接器设计方案.md》把「提示词功能」等同于 L4 的 Enhance 按钮 —— 方向没错，但只覆盖了四分之一，且是最不该先做的那一层。** 该方案未落地，本轮建议按本报告的优先级重排。

---

# 一、WorkBuddy 提示词功能调研

## 1.1 四层结构总览（核心机制）

| 层 | 名称 | 载体（真实文件/接口） | 谁写 | 生效点 |
|---|---|---|---|---|
| **L1** | 场景提示词卡 | `scenes.json` / `scenes-new.json`（市场下发）+ 内置设计 skill 的 `scenes.json` | 官方运营 | 首屏「我能问什么」 |
| **L2** | 模式/场景系统提示词追加 | `welcomemode-*/prompt.tpl`、`agents/*.md`、`interactionmode-*/fragments/*.md`、`prompt-common/fragments/*.md` | 官方 / 行业协议下发 | 系统提示词组装 |
| **L3** | 自定义提示词模板（斜杠命令） | `.codebuddy/commands/*.md`、`~/.codebuddy/commands/*.md`、插件 `commands/`、MCP `prompts/list` | 用户 / 第三方 | 输入框 `/` 唤起 |
| **L4** | 增强提示词（Enhance） | 守护进程 RPC `llm:enhancePrompt` → sidecar `/api/v1/llm/completions` | 官方（元提示词内置） | 草稿一键改写 |
| **辅助** | 提示建议 | 协议消息 `codebuddy.ai/promptSuggestion` + 设置项 `promptSuggestionEnabled`（「提示建议」） | 模型 | 回答之后追加下一步建议 |

## 1.2 L1：场景提示词卡（最接近日常说的「提示词功能」）

**数据模型**（`normalizeSceneEntry`，见 `app.asar` 场景归一化函数）：

```jsonc
{
  "id": 4, "unified_id": 100,
  "name": "文档处理", "icon": "documentation",
  "mode": "working",                       // working | coding | design
  "interactionModes": ["craft", "plan"],   // 该场景允许的交互模式
  "plugins": [{ "name": "tencent-docx", "marketplaceName": "workbuddy-builtin" }],
  "prompts":      ["帮我下载腾讯2025中期报告完整财报 PDF，…"],
  "promptTitles": ["财报分析全流程"],       // 卡片标题（点选时显示这个）
  "target": "all",
  "minWbVersion": "...", "maxWbVersion": "...",  // 版本门控，可分灰度下发
  "insertSceneTag": true,                  // 是否把场景以 chip 形式插入输入框
  "expert": { "id": "...", "name": "...", "avatarUrl": "..." },  // 场景可直接绑专家
  "skills": [ { "id": "...", "source": "builtin", "sourceId": "..." } ]
}
```

**实际规模**（本地实测量化）：

| 来源 | 场景数 | 提示词条数 |
|---|---|---|
| 市场文件 `cb_teams_marketplace/scenes.json` | 29（工作 14 / 设计 9 / 编程 6） | 120 |
| 内置设计 skill `skill-ardot-design-core/scenes.json` | 11 | 46 |
| **首屏合并后实际展示** | **31** | **136** |

> 合并逻辑在 `getProductScenes()`：**取内置设计场景（11，且强制清空其 plugins）+ 市场场景中非 design 的 20 条**。市场文件里那 9 条 design 场景会被丢弃、由内置版本接管（`readBuiltinDesignScenes` 里 `filter(mode === "design")` + `forceClearPlugins=true`）。

**行业协议模式（更关键）**：`industry-home-content.ts` 揭示了 B 端形态 —— 整个首页由**远端下发的行业协议**驱动：

```
routeConfig（行业模板，远端下发，挂在 ui.nav.items 的 builtin:new_task 上）
 ├─ header { title, slogan, visible }
 └─ modes.items[]
     ├─ modeId / title / icon
     ├─ systemPromptAppend          ← 整个模式追加一段系统提示词
     ├─ plugins[] / skills[] / expert{}
     └─ scenes[]
         ├─ title / icon
         ├─ systemPromptAppend      ← 单个场景再追加一段
         ├─ plugins[] / skills[] / expert{}
         ├─ templates[] { id, title, icon, prompt }   ← 提示词卡片
         └─ inspirationIds[]        ← 灵感卡（封面图）
```

**三个关键联动机制**（全部在代码里实现，不是文案）：

1. **选场景 = 自动启用插件/技能**：`buildIndustryPluginSessionSettings()` 把场景的 plugins 转成新会话的 `sessionSettings.enabledPlugins` + `extraKnownMarketplaces` —— 选了「文档处理」场景，`tencent-docx` 就自动在位。
2. **选场景 = 自动注入系统提示词**：`scenePromptAppendBySceneId` 把 `scene.systemPromptAppend` 按场景 id 挂到运行时。
3. **选场景 = 自动挂专家**：`pickSceneExpert()` 优先取场景的 expert，回退取 mode 的 expert。

**一句话本质**：场景是「**一次点击同时配置好：问什么 + 用哪些能力 + 谁来答 + 回答偏什么风格**」的组合拳。这是它最有价值的地方，也是「提示词功能」这个名字最误导的地方。

## 1.3 L2：提示词如何被组装（工程实现）

`welcomemode-work/prompt.tpl` 是模板骨架，用类 Liquid 语法拼装：

```
This conversation is powered by {% if modelId == "fast-model" … %}Auto{% else %}{{ modelName }}{% endif %}
Your main goal is to follow the USER's instructions at each message, denoted by the <user_query> tag.
{% if workMode == "ask" %}{% include "interactionmode-ask/fragments/interaction.md" %}
{% elif workMode == "plan" %}…{% else %}{% include "interactionmode-craft/fragments/interaction.md" %}{% endif %}
… {% if not productFeatures.DisableMultimodalGeneration %} … {% endif %}
```

代码侧对应三个函数：

| 函数 | 职责 |
|---|---|
| `buildTemplateVariables()` | **从插件名反推变量** —— 插件名 `welcomemode-work` → 变量 `welcomeMode=work`；`interactionmode-plan` → `interactionMode=plan` / `workMode=plan` |
| `renderPluginTemplate()` | 渲染 `{% if %}` / `{% include %}` / `{{ var }}`，含嵌套 include |
| `isComposePluginRef()` | 识别「组装型插件」（前缀 `welcomemode-` / `interactionmode-` + `prompt-common`） |

**片段库**（`prompt-common/fragments/`）是跨模式复用的提示词单元，例如 `workbuddy-memory-system.md` 定义三层记忆规则、`wecom-forwarded-chat-archive.md` 定义企微转发聊天归档的处理规则、`memory-context.md` 只有三个 `{{ }}` 变量占位。

**工具的可用清单也写在片段里** —— `interactionmode-craft/fragments/interaction.md` 的 frontmatter 直接列出该模式允许的工具（Read / Write / Bash / Skill / show_widget …）。**模式 = 提示词 + 工具白名单，一体两面。**

> ⚠️ 一个必须知道的事实：**我们此刻正在吃的就是这套机制。** 本会话系统提示词里的 `<memory_system>`（三层记忆）、`<working_modes>`（Agent / Plan / Ask 三模式）、`<wecom_forwarded_chat_archive>`（企微归档规则）三块，分别来自 `prompt-common/fragments/workbuddy-memory-system.md`、`interactionmode-*/fragments/current-mode.md`、`prompt-common/fragments/wecom-forwarded-chat-archive.md`。所以这不是推测，是可直接比对的现场。

## 1.4 L3：用户自定义提示词模板（斜杠命令）

**定义载体**：`.codebuddy/commands/*.md`（项目级）、`~/.codebuddy/commands/*.md`（全局）、插件 `commands/` 目录、以及 MCP 服务暴露的 prompts。支持子目录分组 → `/frontend:build`。

**frontmatter 字段**（全部验证存在）：

| 字段 | 作用 |
|---|---|
| `description` | 自动补全时显示的描述 |
| `argument-hint` | 参数提示，如 `[pr-number] [priority]` |
| `allowed-tools` | 细粒度工具权限，如 `Bash(git add:*), Read`。**指定后只能用列出的工具** |
| `model` | 该命令强制使用的模型 |
| `disable-model-invocation` | `true` 时模型看不到此命令，只能手动 `/` 触发 |

**模板能力**（`CustomCommandRenderer.processContent` / `render`）：

| 能力 | 实现 |
|---|---|
| 位置参数 | `$1 $2 $3 … $N`（按用到的最大 N 逐位替换） |
| 全量参数 | `$ARGUMENTS`；超出 N 的剩余参数会以 `ARGUMENTS: ...` 追加在末尾 |
| 内联 shell | `` !`git status` `` 执行并把 stdout 注入上下文 |
| 文件引用 | `@src/utils/helpers.js` 自动读文件注入 |
| 会话变量 | `${CODEBUDDY_SESSION_ID}` |
| 参数解析 | 空格分隔，支持单/双引号包裹含空格参数 |

**两个工程细节值得抄**：

1. **命令信封**：调用时在用户消息前插入 `<command-message>…</command-message> <command-name>/xxx</command-name> <command-args>…</command-args>` —— 让模型明确知道「这是一次模板调用」，而非自由提问。
2. **预算截断**：`DEFAULT_SLASH_COMMAND_TOOL_CHAR_BUDGET` 限制注入模型的命令清单总字符数，超限只注入前 N 条并打警告（`truncateCommandsByCharBudget`）—— **防止用户装了几十个命令把上下文吃满**。这个坑我们必须提前防。

**MCP prompts 也是同一入口**：`McpPromptRenderer.parsePromptName()` 认 `mcp__<server>__<prompt>` 命名，MCP 服务定义的 prompt 会被拉平成一等斜杠命令。

**菜单构成**：`CommandCategory = { command, skill }` —— `/` 菜单同时列出内置命令、自定义命令与**技能**（技能带 `_meta.type='skill'`，并受 `menuVisible` 可见性控制）。

## 1.5 L4：增强提示词（Enhance）

**交互**（i18n 文案与状态机实测）：

| 状态 | 文案 |
|---|---|
| 常态 | 「增强提示词」（tooltip）+ 双星火花图标 |
| 生成中 | 「增强中…」 |
| 成功 | 「恢复原文」（`revert`） |
| 失败 | 「增强失败」 |

**实现要点**：

- Hook `useEnhancePrompt`，按会话 id 维护状态（`stateMap`），支持多会话并发。
- 增强前把输入框内容存进 `backupBlocks`，成功后**原地替换**编辑器内容（Slate `blocks`），「恢复原文」即还原。
- 用 `pendingApply` + `ack seq` 解决**程序化写入的回声问题**（`editor-reconcile.ts` 注释明确：光标闪回、`apply → 回声 → setBlocks → apply` 死循环、IME 合成期必须 defer）。
- 调用链：`daemonClient.enhancePrompt({text, sessionId, model})` → 通道 `llm:enhancePrompt` → sidecar `/api/v1/llm/completions`，**必须带 gateway secret**（否则 401，代码里专门有回归守护）。
- 错误码：`empty_input` / `sidecar_unavailable` / `llm_error`。

**元提示词全文**（`DEFAULT_ENHANCE_PROMPT_SYSTEM_TEMPLATE` + `_USER_TEMPLATE`，可直接借鉴）：

系统侧要求扮演「Prompt Engineering Expert」，分析流程为：识别主目标 → 标注歧义与缺口 → 检查指令清晰度 → 补必要上下文 → 套用 prompt 工程原则（明确指令 / 设参数与约束 / 结构化输出格式 / 加相关示例 / 匹配场景语气 / 去冗余）→ 生成增强版且**维持原目标**。

用户侧模板更值得抄的三点：

1. **语言一致性是 CRITICAL PRIORITY 第一条**：必须检测用户输入语言并用同语言输出；中英混输保持自然混合。**（与我们的中文环境铁律完全一致。）**
2. **只返回增强后的提示词正文**，不加解释、不加前言、不加 markdown 围栏、不加语言标签。
3. 给了 `GOOD OUTPUT EXAMPLE` 做少样本锚定；返回后用 `stripWrappingQuotes()` 剥掉包裹引号。

## 1.6 交互方式汇总（用户视角的完整动线）

```
① 首屏
   模式切换（work / code / design，或行业协议自定义 modeId）
     → 选场景（31 个）
       → 场景下的提示词卡片（标题 + 图标，正文含【上传的 Markdown 文件】这类占位符）
         → 点击 = 填充输入框 + 插入场景 chip（编辑器里是 sceneTag 类型的 phrase 节点）
         → 副作用：自动启用该场景插件/技能、注入 systemPromptAppend、可绑专家

② 输入框中
   /  唤起命令与技能菜单（CommandCategory: command | skill）
   @  唤起引用（文件 / 场景 / 技能 / 腾讯文档）
   权限确认条 / 模型选择 / 上下文用量环（systemPrompt / conversation / tools / mcp / skills 分项）

③ 草稿不满意
   ✨ 增强提示词 → 原地改写 → 可「恢复原文」

④ 回答之后
   提示建议（promptSuggestion）自动追加下一步建议
```

## 1.7 使用场景分布（31 个场景的实测分类）

| 模式 | 场景数 | 场景清单 |
|---|---|---|
| working | 14 + 6 通用 | 文档处理、金融服务、数据分析及可视化、个人工作台、幻灯片、深度研究、视频生成、产品管理；**最新新闻、帮我写作、日常翻译、生活小知识、工作技巧、旅游攻略** |
| coding | 6 | 日常开发、网站开发、Agent 应用、Skill 开发、CI/CD、文档 |
| design | 11（内置） | 网站设计、移动端 App、设计系统、Web App、PPT 设计、交互原型、品牌设计、图标&插画、视觉海报 等 |

**值得注意**：WorkBuddy 一半以上的场景是**通用/生活类**（新闻、写作、翻译、旅游）。这符合它 C 端 + 通用办公的定位，而**这正是我们不能照抄的地方** —— 见下节。

---

# 二、评估：Hergent 是否需要引入提示词功能

## 2.1 判断依据之一：产品定位

Hergent 的定位是「**趴在客户 ERP 之上的 AI 经营副驾**」，护城河是**一线经销商的领域经验编码**（配方算法 + 副驾交互），不是通用 prompt 工程能力。

| 维度 | WorkBuddy | Hergent | 对提示词功能的含义 |
|---|---|---|---|
| 用户能力 | 会写 prompt 的开发者/办公用户 | **不会写 prompt 的经销商老板** | L3（用户自定义模板）**价值为负** |
| 场景广度 | 31 场景横跨办公/编程/设计/生活 | 只有「低温奶经销经营」一域 | **不需要 136 条**，需要 12~20 条高命中 |
| 稀缺性来源 | 模型与工程能力 | **领域配方** | L2 的场景化装配才是护城河落点 |
| 交互载体 | 桌面端为主，长对话 | **手机 + 企微推送**，短问短答 | 卡片要极短，且要能在企微里复用 |

## 2.2 判断依据之二：目标用户（这条最关键）

我们的用户是**一人公司的蒙牛低温奶经销商老板**，非技术、手机为主、时间碎片化。他的真实困境按出现频率排序：

1. **不知道该问什么** ——「这玩意儿能干啥？」（首次使用流失的最大原因）
2. **问对了但看不懂回答** —— 本周刚修的两个 bug（`零值即健康` 把 54 个无到期日批次算成「库存健康」、双回复自相矛盾）都属于这一类
3. **看懂了但不知道下一步做什么** —— 缺行动指引

**关键推论**：老板的输入本来就很短（「算一下这个月货损」已经 8 个字），**L4 增强只会把他的话变长，不会变得更有用** —— 因为他不缺「结构化能力」，缺的是「知道该问什么」和「数据接得上」。

而 WorkBuddy 用户是倒过来的：他知道自己要什么，只是需要把需求写得更规范 → L4 对他价值高。

> **结论：L1 精准命中痛点 1；L2 服务痛点 2/3；L4 对我们价值最低。**

## 2.3 判断依据之三：使用场景（节律 vs 灵感）

WorkBuddy 的场景是**灵感式**（「我想做个海报」「帮我写点东西」）。
Hergent 的经营场景是**节律式**，来自经销商真实的业务时钟：

| 节律 | 老板真实会问的 | 已有数据支撑 |
|---|---|---|
| 每天 | 今天经营怎么样？该盯什么？ | 订单、应收、库存 |
| 每 2 天（到货） | 这次到货对不对？该订什么？ | 到货周期、预报 |
| 每周 | 哪些客户该催款了？销量掉了没？ | 应收账龄、客户销量 |
| 每月 | 返利拿了多少？还差多少达标？ | 返利规则、达成 |
| 随时 | 这个客户的价格/政策是什么？ | 客户档案、品牌政策 |

**推论**：我们需要的是「**按角色 × 节律组织的 12~20 条**」，不是 136 条灵感提示词。而且每条提示词都必须**声明它依赖哪些数据/技能**，否则会出现「没有报损单数据却答得头头是道」的假能力 —— 这与我们本周刚修的「零值即健康」是**同一个病根：不能让数据缺失伪装成有答案**。

## 2.4 现状盘点（我们已有什么，避免重复造）

| 层 | Hergent 现状 | 证据 |
|---|---|---|
| L1 场景卡 | ⚠️ **仅有雏形**：前端硬编码 4 条 chips，后端零配置 | `CopilotDrawer.vue:556` → `const suggestions = ['今天该订什么货？', '算一下这个月货损', '哪些客户该催款了？', '核对我该拿多少返利']`；`CopilotDrawer.vue:78` 渲染 |
| L2 提示词装配 | ⚠️ **有等价物但更重且单点**：4 个内置角色各自 `system_prompt` + 统一追加回复协议；**5 处载体需同改**；**无场景概念、无按场景追加、无技能/插件联动** | `ai_roles.py`：`_SEED_ROLES` = copilot / accountant / cs / secretary，各有 `system_prompt` + `opening`；`_apply_reply_protocol()` 统一追加 `_REPLY_FORMAT_PROTOCOL`；`hermes_core.py` 同步一份；生产真身 `/root/.hermes/SOUL.md` |
| L3 斜杠命令 | ⚠️ 技能能以 `/` 暴露（能力中心 → 技能库），但**无用户自定义模板** | 前端能力中心；无 `~/.hergent/commands/` 一类目录 |
| L4 增强 | ❌ **完全没有**。项目根有一份设计方案但未落地 | `grep -e prompt_enhancer -e prompt/enhance` 在 `hergent-erp` 无结果 |
| 辅助：提示建议 | ❌ 无（回答后不会推荐下一步） | — |

**一个必须承认的发现**：`ai_roles.opening`（角色开场白）已经是「入口提示」的原始形态 ——「我是你的经营副驾，可以聊经营分析、订货、货损、返利。试试说『今天经营怎么样』？」。**我们缺的不是从零造，而是把这条原始形态升级成「配置化 + 场景化 + 与能力联动」。**

## 2.5 评估结论

> ### ✅ 结论：需要做，但要做的是「L1 场景提示词卡（改形态）+ L2 场景化提示词装配（配置化）」
> ### ❌ 明确不做：L3 的用户自定义提示词模板
> ### ⏸️ 降级缓做：L4 增强提示词（且只做「口语 → 结构化问法」，不做通用 prompt 工程）

**理由汇总**：

| 判断项 | 结论 | 依据 |
|---|---|---|
| 做 L1？ | **必做，P0** | 命中「不知道该问什么」= 首次使用流失主因；是唯一被用户**天天看**的界面元素 |
| 做 L2？ | **必做，P0** | 场景化 `systemPromptAppend` 是「recipe-driven 每客户差异化」的直接落点 = 护城河；且能顺手解决「5 处载体同改」的历史负担 |
| 做 L3？ | **不做用户侧** | 目标用户不会写 prompt；开放自由文本后，出问题无法区分「配方错」还是「用户写错」→ 支持成本不可控（违反运维成本红线） |
| 做 L4？ | **降级缓做，P2** | 老板输入已足够短，增强收益低；且会增加一次 LLM 调用延迟与 token 成本 |
| 做「提示建议」？ | **顺手做，P1** | 回答后给下一步建议，直接命中「看懂了不知道做什么」；实现成本最低 |

**门面判断（项目铁律：谁付费、谁天天看）**：
- 场景卡 → **老板天天看**，且直接决定「第一次打开有没有用」✅ 进客户门面
- 场景 systemPromptAppend → 老板无感知，但决定回答质量 ✅ 属于配方层（护城河）
- 增强按钮 → 老板偶尔点，改了也未必更好 ⏸️ 缓
- 自定义模板 → 老板不会用 ❌ 不进客户门面

---

# 三、实施方案

## 3.1 功能设计（三个模块，按优先级）

### 模块 A：场景提示词卡（P0）

**目标**：把现在 4 条硬编码 chips，升级为「按角色 × 业务节律组织、后端可配置、可门控」的场景卡。

**数据模型** `ai_scenes`（租户级）：

```sql
CREATE TABLE ai_scenes (
  id            INTEGER PRIMARY KEY,
  tenant_id     INTEGER NOT NULL,
  scene_id      TEXT    NOT NULL,      -- 稳定标识，如 "daily_check"
  role_id       TEXT,                  -- 绑定角色（NULL = 全角色可见）
  name          TEXT    NOT NULL,      -- "每天该盯什么"
  icon          TEXT,                  -- Lucide 图标名（前端 <Icon> 组件）
  sort_order    INTEGER DEFAULT 0,
  cadence       TEXT,                  -- daily | arrival | weekly | monthly | adhoc
  system_append TEXT DEFAULT '',       -- 场景级提示词追加（≤200 字）
  requires      TEXT DEFAULT '[]',     -- 依赖声明 JSON: ["orders","receivables"]
  prompts       TEXT NOT NULL,         -- JSON 数组（正文，含【】占位符）
  prompt_titles TEXT NOT NULL,         -- JSON 数组（卡片标题，与 prompts 等长）
  is_active     INTEGER DEFAULT 1,
  built_in      INTEGER DEFAULT 1,
  min_app_ver   TEXT, max_app_ver TEXT, -- 版本门控（对齐 WorkBuddy 做法）
  created_at    TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(tenant_id, scene_id)
);
```

**种子内容（首批 15 条，按节律分组）**：

| 节律 | 场景名 | 卡片示例（标题 → 正文） |
|---|---|---|
| daily | 每天该盯什么 | 「今天经营快报」→ 帮我看看今天的到货、订单和应收情况，有异常的直接说 |
| daily | 库存健康 | 「哪些货要过期了」→ 看看哪些批次快到期了，给我处理建议 |
| arrival | 订货决策 | 「这次该订什么」→ 按我的历史销量和库存，告诉我这次要订哪些货、订多少 |
| arrival | 到货核对 | 「这次到货对不对」→ 我上传了到货单，帮我对一下有没有少发错发 |
| weekly | 催款 | 「哪些客户该催款」→ 哪些客户欠款超期了？按欠多久排个序 |
| weekly | 客户流失预警 | 「谁不进货了」→ 哪些客户最近没下单了，要重点回访 |
| monthly | 返利核对 | 「返利拿到多少」→ 这个月返利应该拿多少？还差多少到下一档 |
| monthly | 毛利体检 | 「哪个品不赚钱」→ 按渠道和品项帮我算算毛利，哪些是在赔钱卖 |
| adhoc | 应急 | 「临期怎么办」→ 有客户要退临期货，帮我算算损失并给处理方案 |
| adhoc | 对账 | 「银行对账」→ 我要对账，告诉我要上传什么 |
| … | 共 15 条 | 覆盖 4 类角色（经营副驾 / 会计 / 客服 / 大秘） |

**关键设计：`requires` 门控（必须做）**
卡片在渲染前检查依赖的数据/技能是否就绪；缺失则该卡**不展示**（或展示为灰态 + 「先补数据」引导）。
> 依据：本周刚修的「零值即健康」事故 —— 54 个批次效期全空，系统却渲染绿色「库存健康」并推送到老板手机。**场景卡的 `requires` 是同一原则在入口层的应用：宁可少给一张卡，也不给一张会答错的卡。**

### 模块 B：场景级提示词装配（P0）

**目标**：把 `system_prompt` 的组装从「多处写死」收成「单点组装」。

**新的组装链（唯一入口）**：

```
最终 system prompt
 = 角色 system_prompt（ai_roles）
 + _REPLY_FORMAT_PROTOCOL（既有，不动）
 + 场景 system_append（选中场景时，≤200 字）
 + 数据上下文（既有 Hermes 注入）
```

**必须遵守的红线：不要新增第 6 处提示词载体。**

当前提示词有 5 处载体（生产真身 `/root/.hermes/SOUL.md`、`ai_roles.py`、`hermes_core.py`、`/opt/hermes-tenants/_seed/SOUL.md`、`/opt/hermes-tenants/hergent_t1/SOUL.md`），历史上饱受「改了 Python 常量但网页副驾没改」之苦。

→ **场景 append 必须在「组装期」动态拼接，绝不能写进 SOUL.md**。落地方式：在 `ai_roles.py::_apply_reply_protocol` 旁新增 `_compose_system_prompt(role, scene_row)`，作为唯一组装点，并由 `hermes_core` 复用同一函数。

### 模块 C：「我的常用问法」（P1，替代 L3）

不做自由文本模板编辑器，改为**零学习成本的收藏机制**：

- 每条 AI 回答旁边一个「收藏问法」按钮 → 存入 `ai_prompt_favorites(tenant_id, user_id, text, title, created_at)`
- 空态卡片下方多一行「我的常用」（最多 6 条，可删可置顶）
- 系统另提供「最近问过」（自动记录，不占用户操作）

**为什么这样替代 L3**：用户不需要「学写模板」，只需要「把用过的好问题留下来」—— 同样的复用价值，零学习成本，且**内容天然是我们的领域问法**（不会跑偏成通用 prompt）。

### 模块 D：口语一键改写（P2，缓做）

若要落地，严格限定范围：

- 接口 `POST /api/ai/prompt/enhance`，入参 `{ text, role_id, scene_id }`，出参 `{ enhanced, intent_preserved }`
- 元提示词照 WorkBuddy 骨架，但**领域化改写**：
  - 硬约束 1：**保留原始意图，不得改变用户想做的事**（返回 `intent_preserved` 校验）
  - 硬约束 2：**必须输出简体中文**
  - 硬约束 3：**不得编造任何数字**；缺数据时只能用 `【】` 占位
  - 硬约束 4：单位一律中文（「万元」「个百分点」），禁用 `pp` / `mo` / `avg`
  - 硬约束 5：只返回改写后的正文，不加解释与 markdown 围栏
- **不做** before/after 对比卡（老板看不懂哪个更好）；改为**直接原地替换 + 「恢复原文」**（对齐 WorkBuddy 的 revert 交互）

## 3.2 关键模块与文件落点

| 模块 | 位置 | 职责 | 新增/改动 |
|---|---|---|---|
| 场景注册表 | `server/ai_scenes.py` | 建表 + 种子 + 查询/更新；**镜像 `ai_roles.py` 的租户隔离与播种范式** | 新增 |
| 场景种子 | `ai_scenes.py::_SEED_SCENES` | 首批 15 条 | 新增 |
| 提示词单点组装 | `ai_roles.py::_compose_system_prompt()` | 角色 + 协议 + 场景 append | 新增函数 |
| 依赖门控 | `server/ai_scenes.py::resolve_scene_availability()` | 检查 `requires` → 过滤卡片 | 新增 |
| 路由 | `server/routers/ai_scenes.py` | `GET/POST/PUT /api/ai/scenes` | 新增（**须登记 RBAC**） |
| 收藏 | `server/ai_scenes.py`（同表族） | `ai_prompt_favorites` + 3 个端点 | 新增 |
| 前端空态 | `hergent-cn-v2/src/components/CopilotDrawer.vue` | 角色切换 + 节律分组 + 卡片渲染 | 改动（替换 `suggestions` 硬编码） |
| 前端收藏 | 同上 + `useCardTrigger.js` 附近 | 收藏按钮 + 「我的常用」行 | 改动 |
| 增强（P2） | `server/routers/ai_prompt.py` | `/api/ai/prompt/enhance` | 新增 |

## 3.3 集成方式（必须遵守的既有约束）

| 约束 | 具体要求 | 违反后果 |
|---|---|---|
| **RBAC 登记** | 新路由必须加进 `server.py::_PATH_MODULE_MAP`；只有 `_PUBLIC_PATHS` 前缀下才免登记 | 未命中 fail-closed → 恒 403 |
| **建表机制化** | 新表**只能**进 `master_ddl`（= 主库全部业务表 − `_TENANT_TABLE_SYNC_SKIP`），禁止手工表名清单、禁止自建第二条 DDL 路径 | 老租户库缺表 → 500 |
| **建库唯一入口** | 任何建库/建表委托 `erp_db.tenant_db_init()` | 历史上出现过 `sqlite3.backup()` 把主库 users 密码哈希搬进新租户库的严重事故 |
| **平台级操作** | 若做场景下发/官方种子，走 `core._platform_admin()`（独立名单表），**绝不复用 `_admin`** | 每个自注册用户都是 `boss` → 权限扩散 |
| **路由定义顺序** | 静态路径（如 `/api/ai/scenes/presets`）必须定义在路径参数（`/{scene_id}`）之前 | 静态路径被吃掉 → 恒 422（未登录给 422 而非 401 就是铁证） |
| **迁移** | ALTER 必须逐条独立 `_safe_migrate`，且一并评估「种子回填」副作用 | 块首 `duplicate column` 中断整块 → 块尾建表永远轮不到 |
| **前端构建** | `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run build` → rsync（`--delete`）→ `chown hergent:hergent` → 双侧 md5 核对 | 构建失败或产物不落盘 |
| **不碰 order CRUD** | 场景只做「问问题」，不新增任何写操作 | 违反「订单 CRUD 冻结」战略 |

## 3.4 潜在难点与缓解（逐条对真实风险）

| # | 难点 | 真实风险 | 缓解措施 |
|---|---|---|---|
| 1 | **假能力**：场景 append 让副驾对没数据的场景「演」出结论 | 与「零值即健康」同源，会直接误导经营决策 | `requires` 硬门控：数据/技能不就绪则该卡不展示；回答中若数据缺失必须显式说明「该项暂无数据」 |
| 2 | **Token 成本失控** | 场景 append 常驻 system prompt，15 条 × 200 字会推高每次调用成本 | 只注入**当前选中场景**的 append；空态不注入；单条 append ≤200 字（对齐 WorkBuddy 的预算截断思路） |
| 3 | **提示词载体扩散成第 6 处** | 「改了 Python 但网页副驾没改」的历史坑重演 | 场景 append 只在 `_compose_system_prompt()` 组装期拼接，禁止写进任何 SOUL.md |
| 4 | **两层协议打架** | 场景上下文与既有 `_REPLY_FORMAT_PROTOCOL` / ```` ```cards ```` 围栏冲突，导致格式退化 | 场景**只作为输入侧上下文**，不新增任何输出协议；出卡仍走既有 ```` ```cards ```` 单链路 |
| 5 | **与历史会话列表抢位** | CopilotDrawer 空态同时承载新建与历史 | 保持现有条件（`!sessions.length && !histHits.length` 才显示场景卡），场景卡与历史列表互斥 |
| 6 | **「常用问法」的隐私/合规** | 收藏内容是租户经营数据，若做「热门问题」跨租户聚合 = 数据转售风险 | **禁止任何跨租户聚合**；收藏严格 tenants 隔离；不做全站热榜 |
| 7 | **锚定偏差**：卡片长期只有 15 条，用户以为「只会这些」 | 场景卡会限制探索 | 空态保留一个「想聊别的就直接说」的输入提示；每张卡下方保留自由输入 |

## 3.5 实施优先级

| 优先级 | 项目 | 价值 | 工作量 | 风险 | 依据 |
|---|---|---|---|---|---|
| **P0** | **A. 场景提示词卡配置化**（表 + 15 条种子 + 前端空态） | ★★★★★ | 中 | 低 | 命中「不知道该问什么」；唯一天天看的界面 |
| **P0** | **B. 场景级 system append + `_compose_system_prompt()` 单点组装** | ★★★★☆ | 中 | 中（须带 `requires` 门控） | 护城河落点；顺手收编 5 处载体负担 |
| **P1** | **C. 「我的常用问法」收藏 + 最近问过** | ★★★☆☆ | 小 | 低 | 以零学习成本替代 L3 自定义模板 |
| **P1** | **E. 回答后「提示建议」** | ★★★☆☆ | 小 | 低 | 命中「看懂了不知道做什么」；实现最轻 |
| **P2** | **D. 口语一键改写（增强）** | ★★☆☆☆ | 中 | 中 | 对标 WorkBuddy L4；老板输入已短，收益有限 |

**明确不做（写进来防止后人重开）**：

- ❌ 用户自由编辑提示词模板（= WorkBuddy L3 用户侧）：用户不会写，支持成本不可控
- ❌ 追求 31 场景 / 136 条那种规模：B2B 垂直域没有那么多真场景，维护成本与收益倒挂
- ❌ 多语言场景包（`scenes-en.json` 那种）：客户全中文
- ❌ before/after 增强对比卡：老板分不出哪个更好，增加决策负担

## 3.6 验收口径

| 项 | 验收标准 |
|---|---|
| 场景卡 | 15 条种子入库；4 类角色各 ≥2 条；`requires` 缺失时该卡不出现（构造无报损数据的租户实测） |
| 组装单点 | `grep -c "system_append"` 只出现在 `_compose_system_prompt()` 一处；5 处载体无需同改 |
| 路由 | `server.app.routes` 打印确认端点存在且**响应码为 401（未登录）而非 422**；`_PATH_MODULE_MAP` 命中 |
| 前端 | 空态渲染 15 张卡；点选正确填充输入框；「恢复原文」/收藏可用；真机 0 pageerror |
| 部署 | 前端双侧 md5 MATCH_OK；后端 `health` 200；生产 `grep` 新符号验落点 |

---

## 附录 A：证据索引（可复查）

| 结论 | 证据位置 |
|---|---|
| 四层结构 | `app.asar` / `cli/dist/` 各符号（下表逐条列出） |
| L1 场景模型 | `app.asar` → `normalizeSceneEntry`、`getProductScenes`、`readBuiltinDesignScenes`、`readMarketplaceScenes`、`pickNumber`（注释明示 scenes.json 为「手工维护」） |
| L1 行业协议 | `app.asar` → `industry-home-content.ts`（`resolveIndustryHomeContent` / `toTemplateScene` / `resolveModePlugins` / `buildIndustryPluginSessionSettings`） |
| L1 数据量 | `~/.workbuddy/plugins/marketplaces/cb_teams_marketplace/scenes.json`（29 条 / 120 提示词）、`~/.workbuddy/plugins/cache/workbuddy-builtin/skill-ardot-design-core/*/scenes.json`（11 条 / 46） |
| L2 模板组装 | `~/.workbuddy/plugins/cache/workbuddy-builtin/welcomemode-work/*/prompt.tpl`；`interactionmode-craft/fragments/*.md`；`prompt-common/fragments/*.md`；`codebuddy.js` → `buildTemplateVariables` / `renderPluginTemplate` / `isComposePluginRef` |
| L3 命令机制 | `cli/dist/web-ui/docs/cn/cli/slash-commands.md`；`codebuddy.js` → `CustomCommandRenderer` / `McpPromptRenderer` / `slashCommandCharBudget` / `CommandCategory` |
| L3 真实样例 | `~/.workbuddy/plugins/cache/cb_teams_marketplace/agent-sdk-dev/1.0.0/commands/new-sdk-app.md` |
| L4 增强 | `app.asar` → `useEnhancePrompt`、`createEnhanceService`、`handleEnhancePrompt`、`ENHANCE_PROMPT_AGENT_NAME`、`DEFAULT_ENHANCE_PROMPT_SYSTEM_TEMPLATE` / `_USER_TEMPLATE`；i18n `chatInput.enhance.tooltip` = 「增强提示词」 |
| 辅助：提示建议 | `cli/dist/web-ui/assets/index-CdxvHulb.js` → `codebuddy.ai/promptSuggestion`、`settings.item.promptSuggestionEnabled` = 「提示建议」 |
| Hergent 现状 | `hergent-cn-v2/src/components/CopilotDrawer.vue:78,556`；`hergent-erp/server/ai_roles.py`（`_SEED_ROLES` / `_apply_reply_protocol`） |
| 旧方案 | `laozhangai-product/AI层-提示词增强与MCP连接器设计方案.md`（仅覆盖 L4，未落地） |

## 附录 B：与既有设计文档的关系

| 文档 | 关系 |
|---|---|
| `AI层-提示词增强与MCP连接器设计方案.md` | **部分有效**。其「提示词增强」= 本报告 L4，建议降级为 P2 且按 §3.1 模块 D 重定义；其「MCP 连接器」部分与本报告无关，不受影响 |
| `Hergent-副驾回复格式优化分析-对标WorkBuddy.md` | 与本报告互补：那份解决「回答怎么呈现」（输出侧），本报告解决「用户问什么」（输入侧） |
| `副驾P0协议增补与五处载体部署-交付说明-2026-09-13.md` | 本报告 §3.1 模块 B 的「不新增第 6 处载体」原则即由此而来 |
