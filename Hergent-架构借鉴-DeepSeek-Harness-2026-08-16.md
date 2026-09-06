# DeepSeek Harness 对 Hergent 的架构借鉴清单

> 日期：2026-08-16
> 依据：`deepseek-ai/deepseek-harness`（v0.1，MIT 开源，115k+ star）源码研读
> 重点拆解：`packages/skill`（技能）、`packages/core/tools`（工具）、`packages/core/session`（会话）、`docs/subsystems/*`

---

## 一、一句话结论

Harness 用 "Everything is a Plugin" 把 Agent 拆成**可插拔的接缝（seam）**：模型、工具、技能、会话、存储、沙箱、UI 全是插件，通过 `ctx.*` 服务键注册/替换。对 Hergent 的核心启示：**我们一直在做的"引擎 + 配方 + 技能"正是 Harness 的 Harness 层**——模型层人人都有，②③④ 层才是护城河（见上轮四层图）。

---

## 二、三块核心规范拆解（可直接借鉴）

### 1. Skills —— 技能 = 有 frontmatter 的 Markdown 指令包

**Harness 的做法**（`packages/skill/skill/src/index.ts`）：

```
SkillDefinition = SkillSummary + content(Markdown正文) + metadata(frontmatter)
SkillSummary   = name(kebab-case) + description + invocation策略
发现路径分层（rank 越小越优先）：
  project-dsh (<项目>/.dsh/skills) → project-agents (.agents/skills)
  → custom(用户配置目录) → user-dsh (~/.dsh/skills) → bundled(内置)
加载形式：目录包 <name>/SKILL.md 或 扁平 <name>.md
模型可见面：只有 name + description（modelInvocable 控制），正文/路径永不进模型上下文
```

**样例 SKILL.md**（frontmatter 极简）：
```markdown
---
name: dsh-prose-standard
description: Use when writing, reviewing, restoring ... prose ...
---
# 正文（指令、边界、输入要求、排除项）
```

**对 Hergent 的借鉴**：
- ✅ 我们的 Hermes/WorkBuddy 技能体系与它**同构**（SKILL.md + frontmatter + 分层发现）——方向已被行业验证
- 🎯 具体落地：把"低温奶行业规则"沉淀为技能包（7 天临期、冷链断货、提成按回款到账、蒙牛返利口径），每包一个 SKILL.md，`description` 写成"什么时候用"，让 Hermes 自动选择
- 🎯 **模型只见 name+description**：这提醒我们——技能正文要写得"自包含"，不能依赖 AI 提前看过；description 要精准，否则 Hermes 不会主动调用

### 2. Tools —— 工具 = 模型可见 schema + 执行函数 + 输出契约 三者分离

**Harness 的做法**（`packages/core/tools/src/index.ts`）：

```
ToolDefinition:
  - 模型可见：name / description / parameters（白名单，其余绝不外泄）
  - 执行端：execute(args, exec) — 必须响应 exec.signal 取消信号
  - 输出契约：output.schema(JSON Schema 校验) + render(纯函数投影)
  - 元数据（不进模型）：timeoutMs / isConcurrencySafe / 调度信息
```

**关键设计**：`schemas()` 用**显式白名单**组装模型可见的 schema——`output/execute/finalizeContent/timeoutMs` 等执行细节永远不会泄漏给模型。

**对 Hergent 的借鉴**：
- ✅ 我们的 6 大工具引擎（预报/货损/工资/对账/指标/返利）本质就是 ToolDefinition——现在是 Python 函数，未来若要接 Harness 生态，需补"输出 JSON Schema + render"两层
- 🎯 **输出契约先行**：每个引擎返回结构应该先定 JSON Schema 再实现，这样前端展示（render）、审计、AI 读取三处共用一份契约，避免"前端猜字段"
- 🎯 **取消信号**：长任务（跑工资、扫效期）应支持中断——我们生产工资跑算目前同步阻塞，未来加异步任务队列时是硬要求

### 3. Sessions —— 会话 = append-only 事件日志，消息历史是"派生物"

**Harness 的做法**（`packages/core/session/src/types.ts`）：

```
Session = 只追加的事件日志（turn/start, step/start, user/message,
          assistant/chunk, assistant/message, tool/call, tool/result, step/end, turn/end）
关键点：
  - 消息历史从不单独存储，由事件日志重放派生（replay = re-derivation）
  - 每个事件都是无损 JSON，序号连续（含原始 chunk，可逐 token 重放）
  - 事件类型可插件扩展（compaction/hook 等通过 declaration merging 加）
```

**对 Hergent 的借鉴**：
- ✅ 我们"AI 只建议不擅自下单"的铁律，天然需要一个 append-only 动作日志：**每一步（读了什么、算了什么、建议了什么、谁确认了）都留痕**
- 🎯 具体落地：给"AI 审核大脑"加一张 `ai_actions` 表（event-sourced 风格：action_type、input 快照、output 快照、status、operator、created_at），既是审计追踪，也是将来"复盘为什么 AI 这么建议"的数据源
- 🎯 日志驱动 UI：Harness 的 UI 直接从事件日志渲染——我们未来的"副驾时间线"也应从日志派生，而不是前端各存各的

---

## 三、可直接落地的 4 个动作（按性价比排序）

| # | 动作 | 借鉴来源 | 价值 | 工作量 |
|---|---|---|---|---|
| 1 | **行业技能包**：把低温奶规则写成 3-5 个 SKILL.md（临期/断货/提成/返利），挂到 Hermes 技能目录 | Skills | 护城河，AI 回答立刻变准 | 小（半天） |
| 2 | **AI 动作日志表**：`ai_actions` 追加式审计表，审核大脑每步留痕 | Sessions | 信任 + 审计 + 复盘数据源 | 小 |
| 3 | **引擎输出契约化**：6 大引擎先定 JSON Schema 再改前端，三处共用 | Tools | 消除"前端猜字段"，为插件化铺路 | 中 |
| 4 | **工作流插件化**：工作流清单后端化（名称/描述/开关/是否启用），客户按需装 | Everything-is-a-Plugin | 直接支撑 B2B 分版本定价 | 中 |

**不建议现在做**：换 Harness 当底座（Hermes 已跑稳生产）、上"画布式"技能编排 UI（ComfyUI 那种，过度设计）。

---

## 四、附：源码位置备忘（已 clone 在 /tmp/dsh-src，可随时深读）

```
/tmp/dsh-src
├── docs/subsystems/skills.md      # 技能规范（发现优先级/加载/调用策略）
├── docs/subsystems/tools.md       # 工具规范（ToolDefinition/输出契约/并发）
├── docs/subsystems/session.md     # 会话规范（事件类型/重放/持久化）
├── docs/agent-lifecycle.md        # Turn/Step 生命周期时序图
├── packages/skill/                # 技能实现（skill/skill-filesystem/tool-skill）
├── packages/core/tools/           # 工具注册表 + 守卫执行
└── packages/core/session/         # 会话事件模型
```

（源码是临时 clone，占 ~几十 MB；如需长期参考可移到项目目录或删掉。）
