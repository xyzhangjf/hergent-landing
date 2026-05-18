# Hergent 技术架构路径 v1

> 日期：2026-05-18
> 用途：QClaw (OpenClaw) vs Hergent (Hermes Agent) 逐层对齐参照。每层有固定编号，后续讨论直接引用编号即可。
> 原则：Hergent 架构对标 QClaw，只在用户侧增值层（客户端/支付/国内平台）做差异化。

---

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│  Hergent 桌面客户端 (差异化层)                        │
│  Electron + React + 首启引导 + 积分UI                │
├─────────────────────────────────────────────────────┤
│  Hermes Agent Core (对齐 QClaw/OpenClaw)             │
│  Gateway → Agent Loop → Memory → Skills → Tools     │
├─────────────────────────────────────────────────────┤
│  服务端 (差异化层)                                    │
│  server.py + 积分计费 + Key管理 + 支付回调            │
├─────────────────────────────────────────────────────┤
│  消息平台 (差异化层)                                   │
│  飞书 / 企微 / 钉钉 / QQ 网关                         │
└─────────────────────────────────────────────────────┘
```

---

## L1 — 底层框架

| 项目 | 选型 | 说明 |
|------|------|------|
| QClaw | OpenClaw | 自研 Agent 框架 |
| Hergent | **Hermes Agent v0.14.0** | 同级别 Agent 框架，功能对等 |

**对齐状态：✅ 完全对齐**

Hergent 直接使用 Hermes Agent 作为底层，不需要自研框架。QClaw 的 OpenClaw 和 Hermes Agent 在以下维度对等：
- 多 Provider 支持（DeepSeek/OpenAI/Claude/本地模型）
- Tool Calling 机制
- 配置文件驱动
- 会话管理

---

## L2 — 消息网关 (Gateway)

| 项目 | 实现 | 说明 |
|------|------|------|
| QClaw | Gateway（中央路由） | 统一入口，接收消息 → 路由到 Agent |
| Hergent | Gateway（`gateway/run.py`） | 同架构，中央路由模式 |

**对齐状态：✅ 完全对齐**

两者都是 Gateway 作为中央消息路由：
- 接收外部消息（HTTP/WebSocket）
- 路由到对应 Agent 实例
- 返回响应到消息源

Hergent 当前 Gateway 已运行，飞书通道已通。

---

## L3 — Agent 循环 (Agent Loop)

| 项目 | 流程 | 说明 |
|------|------|------|
| QClaw | `Brain → think → execute` | 思考→决策→执行 循环 |
| Hergent | `run_agent.py → chat → tool_calling` | 同模式：接收输入→推理→工具调用→返回 |

**对齐状态：✅ 完全对齐**

核心循环逻辑一致：
1. 接收用户消息
2. LLM 推理（可能产生工具调用）
3. 执行工具调用
4. 结果反馈给 LLM 继续推理
5. 最终生成回复

Hergent 通过 `hermes chat` 命令驱动，与 QClaw 的 Brain 循环等价。

---

## L4 — 记忆系统 (Memory)

| 项目 | 组成 | 说明 |
|------|------|------|
| QClaw | `SOUL.md + USER.md + MEMORY.md` | 三层记忆：角色灵魂、用户画像、长期记忆 |
| Hergent | `Memory + USER.md + FTS5 搜索` | 对等：持久记忆、用户画像、全文搜索 |

**对齐状态：✅ 完全对齐**

三层记忆对等关系：
- **SOUL.md ↔ 角色 Profile（SOUL.md）**：定义 Agent 的行为风格和角色设定
- **USER.md ↔ USER PROFILE**：记录用户偏好、习惯、约束
- **MEMORY.md ↔ Memory FTS5**：持久化关键事实，支持全文检索

Hergent 额外优势：FTS5 全文搜索 + session_search 跨会话检索。

---

## L5 — 技能系统 (Skills)

| 项目 | 实现 | 说明 |
|------|------|------|
| QClaw | `Skills + Cla...` | 可加载的技能模块，按需注入 prompt |
| Hergent | `Skills（SKILL.md + skill_view）` | 对等：模块化技能，YAML frontmatter + markdown |

**对齐状态：✅ 完全对齐**

技能系统功能对等：
- 模块化技能定义（SKILL.md）
- 按需加载（skill_view）
- 支持 references/templates/scripts 子文件
- 技能分类管理

Hergent 当前已有 50+ 内置技能，涵盖开发、数据科学、生产力、创意等。

---

## L6 — 工具系统 (Tools)

| 项目 | 实现 | 说明 |
|------|------|------|
| QClaw | 工具集（Toolset） | 可组合的工具模块 |
| Hergent | Tools（terminal/file/web/browser等） | 对等：工具模块化，可按需启用 |

**对齐状态：✅ 完全对齐**

Hergent 工具集包括：
- 终端执行（terminal）
- 文件读写（read_file/write_file/patch）
- 网页搜索（web_search/web_extract）
- 浏览器交互（browser_navigate/click/type）
- 代码执行（execute_code）
- 子任务委托（delegate_task）
- 定时任务（cronjob）
- 消息发送（send_message）

---

## L7 — 多 Agent / 子 Agent 委托

| 项目 | 实现 | 说明 |
|------|------|------|
| QClaw | 子 Agent 委托 | 复杂任务拆分给子 Agent 并行执行 |
| Hergent | `delegate_task` | 对等：支持单任务和批量并行（最多3并发） |

**对齐状态：✅ 完全对齐**

Hergent delegate_task 能力：
- 单任务委托（goal 模式）
- 批量并行（tasks 数组，最多3并发）
- 独立上下文、独立终端会话
- 支持 toolsets 限定

---

## L8 — 定时任务 (Cron/Scheduled Tasks)

| 项目 | 实现 | 说明 |
|------|------|------|
| QClaw | 定时任务系统 | 周期性自动执行任务 |
| Hergent | `cronjob` | 对等：支持 cron 表达式、script 模式、通知投递 |

**对齐状态：✅ 完全对齐**

Hergent cronjob 能力：
- Cron 表达式调度
- Script-only 模式（no_agent=true，零 token 消耗）
- 多平台投递（飞书/企微/钉钉/QQ）
- 任务链（context_from 串联）

---

## L9 — 消息平台集成

| 平台 | QClaw | Hergent | 状态 |
|------|-------|---------|------|
| 飞书 (Feishu) | 支持 | ✅ 已接入 | 已通 |
| 企业微信 | 支持 | ✅ 计划中 | Phase 9 |
| 钉钉 | 支持 | ✅ 计划中 | Phase 9 |
| QQ | 支持 | ✅ 计划中 | Phase 9 |
| 桌面客户端 | 无 | ✅ **Hergent 独占** | 已发布 |

**对齐状态：🔄 部分对齐（平台接入进行中）**

Hergent 差异化：**桌面客户端（Electron）是 QClaw 没有的**。小白用户双击即用，不需要接触命令行。

---

## L10 — 安全架构 (API Key 管理)

| 项目 | 方案 | 说明 |
|------|------|------|
| QClaw | 推测：本地配置或服务端管理 | — |
| Hergent | **服务端代理模式** | Key 仅存服务端 `.env`，客户端不持有 |

**对齐状态：✅ 已实现（Hergent 方案更安全）**

架构：
```
客户端 → OPENAI_BASE_URL=https://api.hergent.cn/v1 → server.py → DeepSeek API
```

- 客户端不持有任何 API Key
- 服务端通过 UA 指纹 + token 识别用户
- 积分扣减在服务端完成

---

## L11 — 积分 / 支付体系

| 项目 | QClaw | Hergent |
|------|-------|---------|
| 积分系统 | 无（开源产品） | ✅ server.py 积分计费 |
| 支付接入 | 无 | 🔄 微信/支付宝（等营业执照） |
| 充值链路 | 无 | 🔄 设计完成，等支付接入 |

**对齐状态：N/A（Hergent 独有商业层）**

这是 Hergent 的商业化差异化层，QClaw 作为开源产品没有这个层级。

---

## L12 — 桌面客户端

| 项目 | QClaw | Hergent |
|------|-------|---------|
| macOS 客户端 | 无 | ✅ DMG 安装包，已发布 |
| Windows 客户端 | 无 | ✅ EXE 安装包，已发布 |
| 首启引导 | 无 | ✅ Hermes CLI 自动检测安装 |
| GUI 聊天界面 | 无 | ✅ 流式响应、Markdown 渲染、8角色 |
| 文件拖拽上传 | 无 | ✅ 支持 |
| 积分显示 | 无 | ✅ 实时余额 |

**对齐状态：N/A（Hergent 独占）**

这是 Hergent 的核心差异化优势。QClaw 是纯 CLI/消息平台产品，Hergent 提供桌面 GUI 体验。

---

## L13 — 部署架构

| 组件 | Hergent 方案 |
|------|-------------|
| 落地页 | GitHub Pages（`xyzhangjf/hergent-landing`） |
| API 服务 | 阿里云 ECS（`api.hergent.cn:8765`） |
| 下载分发 | GitHub Releases（DMG/EXE） |
| 更新服务 | 阿里云（`/var/www/hergent-updates/`） |

---

## 开发优先级（严格按此顺序）

| 编号 | 阶段 | 内容 | 优先级 |
|------|------|------|--------|
| P6 | Phase 6 | 服务端部署 & 支付（server.py 上云、Key 管理、支付接入） | P0 |
| P7 | Phase 7 | Windows 版完成 | P1 |
| P8 | Phase 8 | 体验补完（思考过程展示、消息编辑、对话历史、文件预览、自动更新） | P2 |
| P9 | Phase 9 | 规模上线（落地页优化、新手引导、错误监控、CI/CD） | P2 |
| P10 | Phase 10 | 多平台接入（企微/钉钉/QQ） | P3 |

---

## 不做的事

- ❌ Linux 客户端
- ❌ 移动端 App
- ❌ 多语言国际化（中文优先）
- ❌ 技能市场/插件商店
- ❌ 自研 Agent 框架（用 Hermes Agent 就够了）
