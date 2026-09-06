# hergent.cn AI 层 · 提示词增强 & MCP 连接器 设计方案

> 文档定位：为「提示词增强」「MCP 连接器」两个核心功能给出**可落地的模块划分、接口定义、交互方式**。
> 设计基线：hergent.cn 现有架构（Web 版 `desktop-app/` 源码 + `server.py` API 网关 + Hermes 内核）。
> 关键约束：**复用既有能力，不重复造轮子**（详见 §2.3 / §3.1）。

---

## 0. 总体架构：两个功能如何接入现有系统

```
┌─────────────────────────────────────────────────────────────────────┐
│  UI 层 (desktop-app/index.html + app.js)                              │
│   chat-input-area ──[✨增强按钮]── sendMessage()                      │
│   连接/Channels 页 ──[连接器卡片]                                     │
└───────────┬───────────────────────────────────┬─────────────────────┘
            │ 原始 prompt                         │ 连接器配置/状态
            ▼                                     ▼
┌──────────────────────────┐        ┌──────────────────────────────────┐
│  server.py (FastAPI 网关) │        │  Connector Manager (新增模块)      │
│  POST /api/prompt/enhance │        │  - 动态注册 / 配置 / 生命周期      │
│  POST /v1/chat/completions│        │  - 统一接口 IServiceConnector      │
└───────────┬──────────────┘        └───────────┬──────────────────────┘
            │                                     │ manifest 驱动
            ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Hermes 内核 (engines/hermes-*/libs)                                   │
│   · call_hermes_chat()  ── 增强后的 prompt 进入对话                    │
│   · mcp_tool.py  ──【已存在】MCP 客户端：发现并注册工具到 agent 工具表 │
└───────────┬───────────────────────────────────┬─────────────────────┘
            │                                     │ stdio / HTTP(SSE)
            ▼                                     ▼
   上游 LLM (DeepSeek/内置)          ┌────────────────────────────────────┐
                                    │  连接器 MCP Adapter Servers (新增)   │
                                    │   hergent-mcp-qqmail  (QQ邮箱)       │
                                    │   hergent-mcp-wecom   (企业微信)     │
                                    │   hergent-mcp-feishu  (飞书)         │
                                    │   未来任意服务 = 新增一个 adapter     │
                                    └────────────────────────────────────┘
```

**核心结论先行**：
- **提示词增强**是「对话前的预处理中间件」，挂在 `sendMessage()` 与 `call_hermes_chat()` 之间，对 Hermes 透明。
- **MCP 连接器**是「Hermes 工具表的动态扩展层」，**直接复用内核已有的 `mcp_tool.py` 客户端**，我们只需补一层 Connector Manager + 三个第三方服务的 adapter server。不必自己实现 MCP 协议。

---

# 一、功能一：提示词增强（Prompt Enhancement）

## 1.1 产品定位与对标 WorkBuddy

WorkBuddy 的「Enhance」本质：用户写完一句话，点一下 → 系统把它扩写成**结构化、带约束、带输出格式**的优质 prompt，再让用户「一键应用」。我们完全对标这个交互，但加入 **hergent 专属的领域智能**（低温奶 / 经销商角色）。

目标效果：
- 用户输入「帮我写个发给客户的降价通知」
- 增强后 → 「你是低温奶经销商的【订单文员】。请起草一封发给零售终端客户的降价通知：① 背景（临期品清仓/促销）；② 新价格与生效时间；③ 语气专业、简短；④ 输出 Markdown，含标题+正文+署名。保留客户名占位符 [客户名]。」
- 用户可对比原文/增强文，**应用 / 重生成 / 取消**。

**保留意图原则**：增强只补充「上下文、约束、格式、拆解」，绝不篡改用户原始目标。返回字段含 `intent_preserved: true` 作为硬约束校验。

## 1.2 模块划分

| 模块 | 位置 | 职责 |
|---|---|---|
| **PromptEnhancer 服务** | `server/prompt_enhancer.py`（新增） | 接收原始 prompt + 上下文，调用 LLM 元提示（meta-prompt）生成结构化增强结果 |
| **领域策略层** | `server/prompt_enhancer.py` 内 `DOMAIN_PROFILES` | 按 `role_id` 注入角色口吻与低温奶行业实体（临期/批次/专属价/损耗） |
| **前端交互模块** | `app.js` 内 `enhancePrompt()` + `renderEnhanceCard()` | 增强按钮、请求、渲染 before/after 对比卡、应用回填 |
| **增强缓存**（可选） | 内存/短期 | 同一原文 60s 内复用，省积分 |

## 1.3 接口定义

### 1.3.1 REST 接口

```
POST /api/prompt/enhance
Content-Type: application/json
Authorization: Bearer hermes_<device_id>

请求体 (EnhanceRequest):
{
  "raw_prompt": "帮我写个发给客户的降价通知",   // 必填，用户原文
  "role_id": "sales_clerk",                     // 可选，当前角色（领域偏好）
  "context": {                                  // 可选
    "history": ["上一条消息…"],                 // 最近 3 轮，用于消歧
    "domain": "dairy"                           // 固定 dairy
  },
  "mode": "on_demand"                           // on_demand | auto | strict
}

响应体 (EnhanceResult):
{
  "original": "帮我写个发给客户的降价通知",
  "enhanced": "你是低温奶经销商的订单文员……（完整结构化 prompt）",
  "sections": {                                 // 结构化拆解，供 UI 分块展示
    "goal": "起草降价通知",
    "context": "临期品清仓 / 促销场景",
    "constraints": ["语气专业", "简短", "保留客户名占位符"],
    "output_format": "Markdown：标题+正文+署名",
    "steps": ["明确降价幅度", "说明生效时间", "附联系人"]
  },
  "intent_preserved": true,                     // 意图保全校验
  "language": "zh",
  "tokens_estimate": 240,
  "model": "hermes-enhance"
}
```

### 1.3.2 服务内部接口（Python 签名）

```python
# server/prompt_enhancer.py
@dataclass
class EnhanceRequest:
    raw_prompt: str
    role_id: str | None = None
    context: dict = field(default_factory=dict)
    mode: str = "on_demand"

@dataclass
class EnhanceResult:
    original: str
    enhanced: str
    sections: dict            # goal/context/constraints/output_format/steps
    intent_preserved: bool
    language: str
    tokens_estimate: int

class PromptEnhancer:
    async def enhance(self, req: EnhanceRequest) -> EnhanceResult:
        """调用 LLM 元提示生成结构化增强结果。"""
        meta_prompt = self._build_meta_prompt(req)   # 含角色口吻 + 低温奶实体
        raw = await self._llm_complete(meta_prompt)  # 复用 call_hermes_chat 通道
        return self._parse(raw)                       # 解析 sections + 意图校验

    def _build_meta_prompt(self, req) -> str:
        profile = DOMAIN_PROFILES.get(req.role_id, DOMAIN_PROFILES["default"])
        return TEMPLATE.format(
            role_voice=profile.voice,
            entities=profile.entities,      # 临期/批次/专属价/损耗
            user_input=req.raw_prompt,
            history=req.context.get("history", []),
        )
```

**元提示模板要点**（TEMPLATE）：
- 角色：`你是一个 prompt 优化器，服务于低温奶经销商的 AI 数字员工。`
- 指令：扩写用户原始意图，补充「背景上下文 / 明确约束 / 输出格式 / 执行步骤」，但**不得改变用户的核心目标**。
- 输出：严格 JSON（`{"enhanced": "...", "sections": {...}, "intent_preserved": bool}`），便于解析。
- 领域注入：`profile.entities` 强制模型认知「专属价、临期、批次、损耗、FEFO」等术语。

## 1.4 与对话流程的交互

**挂接点**：`app.js` 的 `sendMessage()` 内部，构造请求体后、调用 `POST /v1/chat/completions` 之前。

两种触发模式：
1. **on_demand（默认·对标 WorkBuddy）**：用户输入后点 `✨增强` 按钮 → 异步请求 → 弹出对比卡 → 用户点「应用」才把 `enhanced` 填入发送体。原文不强制改变，用户始终可控。
2. **auto（可选开关）**：在设置里开启后，发送前自动增强（低延迟场景用缓存）；仍保留「查看增强内容」入口。

**关键设计**：增强是「增强后替换发送内容」，**Hermes 内核无感知**——零侵入，不改动 `mcp_tool.py` / `call_hermes_chat()`。这保证与功能二完全解耦。

## 1.5 UI 设计方案

### 布局（对标 WorkBuddy 简洁专业风）
在 `chat-input-bar` 中、提醒按钮与模型指示器之间插入 **✨ 增强按钮**（`.chat-enhance-btn`，与 `.chat-file-btn` 同尺寸同风格，线性图标，不花哨）：

```
[📎文件] [⏰提醒] [✨增强]      [模型▾]        [发送➤]
─────────────────────────────────────────────
textarea#chatInput  (placeholder: "说说你想做什么…（点 ✨ 可智能增强）")
```

### 交互流程
1. 用户输入原文 → 点 `✨增强`。
2. 按钮进入 loading（spinner，沿用现有 `.chat-cancel-btn` 风格），请求 `/api/prompt/enhance`。
3. 在 `chatInput` 下方注入**增强对比卡**（复用 `live-index.html:1638` 已有的 `previewCard` 插入机制）：
   - 左栏：原文（灰，只读）；右栏：增强文（主色高亮，可滚）。
   - 底部三操作：`应用`（回填 `chatInput` 并移除卡片）/ `重生成`（换一种扩写）/ `取消`。
4. 应用后正常走 `sendMessage()`。

### 视觉规范（沿用已部署的 Web 设计令牌）
- 卡片：`var(--radius-md)` 圆角 + `1px solid var(--border-default)` + 浅底；主强调色仅用于「应用」按钮与增强文关键标记。
- 字号：卡片标题 12px、正文 14px（对齐已收敛的字号体系，不引入新值）。

---

# 二、功能二：MCP 连接器（MCP Connectors）

## 2.1 关键事实：内核已支持 MCP —— 我们只做「适配 + 管理」

`engines/hermes-*/libs/tools/mcp_tool.py` 已是**生产级 MCP 客户端**：
- 支持 stdio / HTTP(Streamable) / SSE 三种传输；
- 自动发现远端工具并注册进 Hermes agent 工具表；
- 支持 sampling（服务端反调 LLM）、并行工具调用、指数退避重连、凭据脱敏。

→ **结论**：MCP 协议本身不用我们写。我们要做的：
1. **Connector Manager**：动态注册/配置/启停/健康检查（内核没有这层「业务管理」）。
2. **三个 Adapter Server**：把 QQ邮箱 / 企业微信 / 飞书 的**原生 API 包装成 MCP 工具**（用已捆绑的 FastMCP 脚手架 `desktop-app/skills/fastmcp` 生成）。
3. **统一接入接口**：抽象出 `IServiceConnector`，使「新增一个服务 = 新增一个 adapter + 一条 manifest 记录」。

> 现状债务顺带清理：桌面端 `main.js` 里 feishu/wecom/qq 的**手写网关**与 `server.py` 的 `/api/feishu/push` 硬编码推送，应逐步迁移到本框架——统一后，「把结果发到飞书/企微/QQ邮箱」都是一次 `connector.invoke(...)` 调用。

## 2.2 整体架构

```
Connector Manager (server/connectors/manager.py)        ← 新增，业务管理层
   │  读取 connectors/manifest.yaml
   │  为每个 connector 生成 mcp_tool.py 所需的 mcp_servers 配置
   ├──► mcp_tool.py (内核已有) 启动 adapter 进程并注册工具
   │
   ├── qqmail  ──► hergent-mcp-qqmail  (stdio adapter, FastMCP)
   ├── wecom   ──► hergent-mcp-wecom   (stdio adapter, FastMCP)
   └── feishu  ──► hergent-mcp-feishu  (stdio adapter, FastMCP)
```

每个 adapter 是独立进程（stdio 启动），通过 MCP 协议把「发邮件/发消息/读邮件」暴露成 `tools`。Connector Manager 对上给 UI / 对话调度提供**统一接口**，对下把调用转给 `mcp_tool.py`。

## 2.3 统一服务接入接口（IServiceConnector）

```python
# server/connectors/base.py
from abc import ABC, abstractmethod

class IServiceConnector(ABC):
    @property
    @abstractmethod
    def service_id(self) -> str:            # "qqmail" / "wecom" / "feishu"
        ...

    @property
    @abstractmethod
    def manifest(self) -> "ConnectorManifest":
        ...

    @abstractmethod
    async def configure(self, cfg: "ConnectorConfig") -> "ConnectorStatus":
        """保存凭据/参数（加密落库），不立即连接。"""

    @abstractmethod
    async def connect(self) -> "ConnectorStatus":
        """按 manifest 启动 adapter（经 mcp_tool），建立 MCP 会话。"""

    @abstractmethod
    async def discover_capabilities(self) -> list["ToolSpec"]:
        """返回该服务暴露的 MCP 工具清单（名称/入参 schema/描述）。"""

    @abstractmethod
    async def invoke_tool(self, tool_name: str, args: dict) -> "ToolResult":
        """统一调用入口；内部转调 mcp_tool.call_tool(service_id, tool, args)。"""

    @abstractmethod
    async def health_check(self) -> "ConnectorHealth":
        ...

    @abstractmethod
    async def dispose(self) -> None:
        """断开并回收 adapter 进程。"""
```

### ConnectorManifest（动态注册元数据，YAML/JSON）

```yaml
# server/connectors/manifest.yaml
connectors:
  - id: qqmail
    name: QQ邮箱
    icon: qqmail-icon
    transport: stdio
    command: "python"
    args: ["-m", "connectors.qqmail.server"]
    auth_fields:                       # 连接页动态渲染表单
      - {id: address,    label: "QQ邮箱地址",  type: email}
      - {id: auth_code,  label: "授权码",       type: password,
         hint: "QQ邮箱→设置→账户→开启IMAP/SMTP，生成授权码（非登录密码）"}
    scopes: [mail.send, mail.read]
    tools: [send_email, list_emails, read_email, search_emails]

  - id: wecom
    name: 企业微信
    icon: wecom-icon
    transport: stdio
    command: "python"
    args: ["-m", "connectors.wecom.server"]
    auth_fields:
      - {id: corp_id,    label: "企业ID",     type: text}
      - {id: agent_id,   label: "应用AgentId", type: text}
      - {id: secret,     label: "应用Secret", type: password}
    scopes: [message.send, contact.read]
    tools: [send_message, send_group_message, get_contacts, create_webhook_robot]

  - id: feishu
    name: 飞书
    icon: feishu-icon
    transport: stdio
    command: "python"
    args: ["-m", "connectors.feishu.server"]
    auth_fields:
      - {id: app_id,     label: "App ID",      type: text}
      - {id: app_secret, label: "App Secret",  type: password}
    scopes: [message.send, doc.create, calendar.read]
    tools: [send_message, upload_file, create_doc, get_events]
```

**动态注册机制**：新增服务 = 复制一个 adapter 目录 + 在 `manifest.yaml` 追加一条。Connector Manager 启动时 `register_all()` 读取清单，无需改核心代码。满足「后续扩展更多服务」诉求。

## 2.4 三个连接器设计

### 2.4.1 QQ邮箱（hergent-mcp-qqmail）
包装 IMAP/SMTP（或 QQ 邮箱 API）。工具：
| 工具 | 入参 | 说明 |
|---|---|---|
| `send_email` | `to, subject, body, cc?, html?` | 发送邮件（SMTP+授权码） |
| `list_emails` | `folder, limit, unread_only` | 列出邮件 |
| `read_email` | `mail_id` | 读正文 |
| `search_emails` | `keyword, since` | 搜索 |

**配置字段**：`address`(QQ邮箱地址) + `auth_code`(授权码，非密码)。

### 2.4.2 企业微信（hergent-mcp-wecom）
包装企业微信「应用消息 + 群机器人」API。工具：
| 工具 | 入参 | 说明 |
|---|---|---|
| `send_message` | `user_id, content` | 给成员发应用消息 |
| `send_group_message` | `chat_id/robot_key, content` | 发群/机器人 |
| `get_contacts` | `dept_id` | 读通讯录（需通讯录权限） |
| `create_webhook_robot` | `name, webhook_url` | 登记群机器人 |

**配置字段**：`corp_id` + `agent_id` + `secret`。

### 2.4.3 飞书（hergent-mcp-feishu）
包装飞书 Open API。工具：
| 工具 | 入参 | 说明 |
|---|---|---|
| `send_message` | `receive_id, msg_type, content` | 发消息（私聊/群） |
| `upload_file` | `file_path, type` | 上传素材 |
| `create_doc` | `title, folder_token` | 建飞书文档 |
| `get_events` | `start, end` | 读日历 |

**配置字段**：`app_id` + `app_secret`（与现有桌面网关字段一致，迁移零成本）。

> 飞书/企微的「接收指令」能力（用户从手机发消息给 AI）由内核已有的 gateway 处理；本连接器聚焦 **AI → 服务 的主动动作**（发消息/读邮件/建文档），二者互补。

## 2.5 Connector Manager（动态注册 / 配置 / 生命周期）

```python
# server/connectors/manager.py
class ConnectorManager:
    def __init__(self, manifest_path: str):
        self._connectors: dict[str, IServiceConnector] = {}
        self._load_manifest(manifest_path)          # 动态注册清单

    def register(self, manifest: ConnectorManifest) -> None:   # 运行时新增
        ...

    def unregister(self, service_id: str) -> None:
        ...

    async def connect_all(self) -> dict[str, ConnectorStatus]:
        # 对每个 connector：configure(从加密库取凭据) → connect()
        # connect() 内部把 manifest 翻译成 mcp_tool 的 mcp_servers 配置并启动
        ...

    async def invoke(self, service_id: str, tool: str, args: dict) -> ToolResult:
        return await self._connectors[service_id].invoke_tool(tool, args)

    def list_connectors(self) -> list[ConnectorInfo]:   # 供 UI 渲染卡片/状态
        ...

    async def health(self) -> dict[str, ConnectorHealth]:
        ...
```

### 配置存储（修复既有明文密钥风险）
凭据经 `ConnectorConfig` 落库时**加密存储**（沿用 Web ERP 的 `ERP_SECRET` fail-closed 模式，密钥缺失即报错，绝不明文）。替代当前 `企业微信API.docx` 明文存密钥的做法，满足合规审查（呼应之前发现的隐私文案隐患）。

### REST 接口（供 UI 连接页）
```
GET  /api/connectors                  → 列出已注册连接器 + 状态
POST /api/connectors/{id}/configure   → 保存凭据（加密）
POST /api/connectors/{id}/connect     → 启动并注册工具
POST /api/connectors/{id}/disconnect  → 断开
GET  /api/connectors/{id}/health      → 健康
POST /api/connectors/{id}/invoke      → 直接调试工具（开发/排查用）
```

## 2.6 与对话 / 推送流程的交互

1. **工具自动可用**：连接器连上后，其 tools 出现在 Hermes 工具表 → 用户说「把这份周报发我QQ邮箱」，内核自动调用 `qqmail.send_email`。用户无感，无需写集成代码。
2. **替代硬编码推送**：`server.py` 的 `/api/feishu/push` 改为 `manager.invoke("feishu", "send_message", ...)`，并天然支持 wecom/qqmail 同构调用。
3. **可视化调用（接上一轮设计）**：AI 回复中调用连接器工具时，按上一轮「工具调用卡」规范渲染（让用户看见「AI 正在发邮件」），并在右栏 Artifacts 留下「已发送邮件」交付物。

---

# 三、两功能的协同与系统级交互

```
用户输入 "把本月盈亏快报发给王经理的QQ邮箱"
        │
        ├─[增强]─► PromptEnhancer 扩写为结构化指令（含「用表格、发QQ邮箱」约束）
        │            │
        ▼            ▼
   sendMessage() ──► POST /v1/chat/completions ──► Hermes 内核
                                                  │
                        ┌─────────────────────────┤
                        ▼                         ▼
              调用 profit_reporter       调用 connector.invoke
              （领域引擎，已有）         ("qqmail","send_email",{to:…})
                        │                         │
                        └─────────┬───────────────┘
                                  ▼
                        AI 回复 + 工具调用卡 + 右栏「已发送邮件」交付物
```

两个功能在「对话核心」两侧对称：
- **提示词增强**在进内核**之前**提升「问的质量」；
- **MCP 连接器**在内核**之中/之后**扩展「做的能力」。

---

# 四、实施建议与风险

## 4.1 推荐落地顺序
1. **提示词增强**（独立、零侵入，先做）：`server/prompt_enhancer.py` + 前端 `✨增强` 按钮 + 对比卡。1–2 天可验收。
2. **Connector Manager + Feishu adapter**（复用最多既有代码）：先打通框架与飞书，验证「对话→发飞书」闭环。
3. **QQ邮箱 / 企业微信 adapter**：套用同一模板，工量主要在各自 API 适配。

## 4.2 复用清单（避免返工）
- MCP 协议 → 复用 `mcp_tool.py`，不上新协议实现。
- adapter 脚手架 → 复用 `desktop-app/skills/fastmcp`。
- 增强 UI 插入点 → 复用 `live-index.html:1638` 的 `previewCard` 机制。
- 凭据加密 → 复用 `ERP_SECRET` fail-closed 模式。

## 4.3 风险与阻塞
- **数据缺口仍是硬阻塞**（重申）：生产库 `sale_order_items = 0`，导致领域引擎（预测/效期）无数据。提示词增强的「领域智能」依赖角色口吻尚可跑，但连接器若要让 AI「基于真实订单发邮件」，需先打通订单明细导入。
- **桌面手写网关迁移**：`main.js` 的 feishu/wecom/qq 网关与新增 MCP 框架并存期会有双实现，需明确废弃时间表，避免长期分叉（呼应此前 web/桌面分叉的技术债）。
- **凭据合规**：连接器集中存储第三方凭据，必须在这一版就把加密落库 + 权限隔离做对，否则扩大攻击面。

## 4.4 与上一轮优化设计的衔接
- 连接器工具调用 → 走「工具调用卡」可视化（上一轮 §2）。
- 连接器「已发送/已建文档」→ 落入右栏 Artifacts 面板（上一轮 §3）。
- 连接页 UI → 沿用「简洁专业、不花哨」基调与既有设计令牌。
```
