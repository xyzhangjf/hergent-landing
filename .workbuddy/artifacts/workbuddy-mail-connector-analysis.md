# WorkBuddy 邮箱连接与邮件同步机制分析
### 附：经销商场景可借鉴性评估

> 分析对象：WorkBuddy（macOS 桌面端）QQ 邮箱连接器
> 证据来源：本机安装文件 + 授权凭据元数据 + 真实 API 调用（非推测）
> 分析日期：2026-09-11

---

## 结论速览

1. **WorkBuddy 没有"邮箱同步引擎"** —— 它不做 IMAP 收取、不做后台轮询。邮件是**按需拉取**的：Agent（或定时任务）调用工具时才读。这是理解一切的前提。
2. **连接方式 = 授权，不是配置** —— 走标准 **MCP OAuth 2.0**（动态客户端注册 + 深链回调），拿 `access_token`/`refresh_token`，**从不接触邮箱密码或授权码**。
3. **接入范式有三条，不止一条** —— 远程 MCP（156 个）、本地命令型 MCP（11 个）、本地 CLI 套件（37 个）。选哪条决定了分发和运维成本。
4. **读写分级有硬闸门** —— 读操作直接执行；发信/回复/转发/删除**必须两阶段令牌确认**（服务端返回 `confirmation_token`，经确认卡片二次提交）。
5. **对经销商：思路可复用 5 条，硬限制 6 条，风险 5 类** —— 最大硬伤是**附件 1MB / 3 个 / 总量 3MB**，直接挡住厂家对账单类大表；最大机会是"**入口用邮件、出口用企微**"的通道分工。

---

## 一、它到底是什么

**不是邮箱客户端，是「远程 MCP 服务 + 云端托管授权」。**

| 维度 | 实测值 | 说明 |
|---|---|---|
| 服务地址 | `https://api.mail.qq.com/mcp` | 腾讯云端托管，非本地 IMAP/Exchange 客户端 |
| 协议 | MCP over Streamable HTTP | 超时 600 秒 |
| 认证 | OAuth 2.0（Bearer） | 动态注册客户端 `client_id = 002e8cd14071aad2` |
| 回调 | `workbuddy://workbuddy/mcp/connector%3Aqq-mail/oauth/callback` | 桌面端自定义 URL Scheme 深链，非本地端口回环 |
| 令牌存储 | `.credentials.v3.json` | **AES-256-GCM + HKDF-SHA256** 加密，密钥在 `.master.key`（32 字节） |
| 授权粒度 | scope | 实测 `alias:read` / `mail:read` / `mail:send`（**无** `mail:delete`） |
| 账号绑定 | 单账号 + 可多别名 | 实测 1 个别名 `1186761329@qq.com`（`is_primary`） |
| 配额 | 10 次/分 · 200 次/时 · 2000 封/天 | 服务端强制 |
| 附件上限 | **3 个 · 单个 1MB · 合计 3MB** | 服务端强制 |
| 工具面 | 12 个工具 | GetMe / ListMessages / GetMessage / SearchMessages / ListAttachments / DownloadAttachment / SendMessage / ReplyMessage / ForwardMessage / DeleteMessage / ClearTrash / PermanentDeleteMessage |

**关键结构判断**：WorkBuddy 把这个能力拆成**三层**，互不耦合。

```
连接器定义（云端下发）      →  凭据与令牌（本地加密）      →  技能说明（注入 Agent 上下文）
mcp.json（地址+超时）          .credentials.v3.json           SKILL.md（怎么用/边界/格式）
connectors.json（名称+示例）    connector-states.json（启用态）
```

换邮箱服务商 = 改一个 URL；换 Agent 行为 = 改一份 SKILL.md。**这是整个方案最值得抄的地方。**

---

## 二、连接流程（一次性，5 步）

| 步 | 动作 | 落点 |
|---|---|---|
| ① | 客户端拉取连接器市场清单 | `https://static.workbuddy.cn/connectors-config-v2/connectors-config.zip`（200 个连接器定义） |
| ② | 用户点"连接" → 客户端发起 OAuth | 动态客户端注册（DCR），`client_name = "CodeBuddy Code (qq-mail)"` |
| ③ | 浏览器/深链授权 → 回调 `workbuddy://…` | 用户在 QQ 侧完成授权，**不输入密码** |
| ④ | 换令牌 → **加密落盘** | `access_token` + `refresh_token`，逐字段 `iv/tag/ct` 密文 |
| ⑤ | 写启用态 | `connector-states.json`：`qq-mail: {bound: true, enabled: true}` |

**令牌生命周期（实测推算）**：凭据文件写入时间 `21:06` → `expiresAt = 22:06`，即 **access token 有效期约 1 小时**；`refresh_token` 长期有效，由客户端自动续期。撤销 = 删除凭据条目，非删邮箱侧应用。

---

## 三、读取流程（每次会话，5 步）

```
① 技能匹配    SKILL.md 的 description 命中"看邮箱/有没有新邮件/找邮件"等 → 注入上下文
② 握手        GetMe        → 拿到 alias_id、scopes、rate_limits、constraints
③ 列表        ListMessages → 游标分页（limit ≤ 50，默认 10）
                            筛选：dir(inbox/sent/trash/spam) · after/before ·
                                  has_attachments · is_read
④ 正文        GetMessage   → 返回正文 + 附件**元数据**（不含内容）
⑤ 取附件      ListAttachments → DownloadAttachment（Base64 返回，再落本地）
```

**呈现层是强约束的**——SKILL.md 明确规定中文标签、正文与附件缩进、时间格式 `YYYY-MM-DD HH:MM:SS`、无附件写"附件：无"。**输出格式属于技能契约，不由模型即兴发挥。**

**"接收邮件"的真相**：没有任何 push / webhook / IMAP IDLE。所谓"新邮件"只能靠两种方式：

| 方式 | 机制 | 触发者 |
|---|---|---|
| 按需 | 用户问 → Agent 调 ListMessages(`is_read=false`) | 人 |
| 定时 | 自动化/定时任务周期性调用同一批工具 | 调度器 |

**两种都是拉。** 这不影响体验，但决定了它**不适合做"实时收件引擎"**。

---

## 四、写入流程：两阶段确认（安全闸门）

这是整个设计里**最有产品价值的一环**，涉及发信、回复、转发、删除。

```
Phase 1  调用工具（不带令牌）
         ↓
服务端拒绝：HTTP 428 / 业务码 42801
         { confirmation_token: "ctk_xxx",
           expires_at: <约 5 分钟后>,
           operation_summary: { from, to, subject, attachment_count } }
         ↓
Phase 2  必须用【确认卡片】展示 operation_summary 并取得用户明确选择
         （明文回复"确认"不算数）
         ↓
Phase 3  带 confirmation_token 二次调用 → 才真正执行
```

硬规则：令牌 ~5 分钟过期、**不跨操作复用**、**无确认绝不自动重试**、用户取消即整体放弃。

> **对照启发**：这套"服务端强制确认令牌"的做法，比"靠提示词让 AI 记得问一下"可靠得多 —— **闸门在服务端，不在模型侧**。

---

## 五、三条接入范式（选型依据）

从 200 个连接器定义中实测统计：

| 范式 | 数量 | 代表 | 授权方式 | 适合谁 |
|---|---|---|---|---|
| 远程 MCP（HTTP） | 156 | QQ邮箱、乐享 | OAuth / 静态 Header | 有云服务能力的厂商，**零安装** |
| 本地命令型 MCP | 11 | 各 `npx`/`uvx` 包 | 环境变量 / OAuth | 需要本地文件或私有网络访问 |
| **本地 CLI 套件** | 37 | 企业微信、钉钉、飞书、柠檬云、智慧记 | **CLI 自带 `auth init`（扫码）** | 已有多平台 SDK 的大厂 |

**本地 CLI 范式值得单独注意**（`cli.json` 字段）：声明运行时（node ≥18）、安装命令、版本下限、授权命令、**状态判据**、以及授权二维码弹窗开关。

```json
{ "init": "npm install -g @wecom/cli",
  "auth": "wecom-cli auth init --noninteractive --no-browser",
  "status": "wecom-cli auth show",
  "statusMatch": "\\bauthorized\\b" }
```

**注意 `statusMatch` 用正则匹配 stdout** —— 与之前 Hermes 配对踩的坑（`hermes pairing` 恒 `exit 0`，只能看 stdout 判成败）**完全同构**。这说明"**CLI 类工具成败判据只能取 stdout，不能信退出码**"是行业通行的现实约束，不是个例。

---

## 六、经销商能否借鉴

### 6.1 可复用的 5 个思路 ★

| # | 思路 | 为什么对经销商重要 | 落到 Hergent 怎么做 |
|---|---|---|---|
| ① | **授权即连接，永不接触密码** | 经销商最怕"给你邮箱密码"，也不会配 IMAP 服务器地址 | 所有第三方接入（邮箱/ERP/网盘）一律 OAuth 或客户自建应用授权；提供"随时撤销"入口 |
| ② | **声明与行为两层解耦** | 客户用的 ERP 五花八门（T+/金蝶/用友/舟谱） | 一个 `DataSourceAdapter` 声明层（地址+凭据）+ 一份"怎么用"的技能说明；**换数据源不改业务逻辑** |
| ③ | **读写分级 + 服务端强制确认** | 涉及"给厂家发订单/给客户发对账单"的动作容错率为零 | 读随便读；**写动作（发信/回写/改单）必须服务端发令牌 + 卡片确认**，闸门在服务端 |
| ④ | **能力边界写成契约** | 非技术老板不关心实现，只关心"能不能做、做几次、多大" | 对外明确声明配额与限制（几条/分钟、附件多大），**不能做的一开始就说清楚** |
| ⑤ | **令牌加密落盘 + scope 最小化** | 客户数据安全是"能不能卖"的前提 | 凭据按租户隔离加密存储；默认只给读权限，写权限按需单独授予 |

### 6.2 硬限制（照搬会翻车的 6 条）⚠️

| # | 限制 | 对经销商的现实影响 | 应对 |
|---|---|---|---|
| 1 | **附件 3 个 / 单 1MB / 总 3MB** | **最致命**。厂家对账单、回款表、库存报表 Excel/PDF 常有数 MB | 走"链接"而非附件；或自建收件邮箱（IMAP）绕过该限制 |
| 2 | **无推送、无订阅** | 想要"早上自动收厂家邮件"必须自己挂定时任务 | 用 Hergent `scheduler.py` / cron 定时拉取（**架构上别指望邮件推送**） |
| 3 | **限速 10 次/分 · 200 次/时** | 批量收 500 封邮件 ≈ 50 分钟 | 只拉"新邮件 + 带附件 + 指定发件人"，服务端筛选，别全量扫 |
| 4 | **通道为"会话按需"设计** | 不适合长时、断点续传的批处理 | 批量化场景走独立摄取管道，MCP 只留给"问答式"交互 |
| 5 | **数据经第三方云服务** | 邮件正文进 LLM 上下文 = 客户经营数据出域 | 客户协议写清；提供脱敏后再入模的选项 |
| 6 | **依赖云端下发定义** | 连接器定义从腾讯云端更新，**你无法锁定版本** | 关键通道自建自控，别把命脉放在别人的下发清单里 |

### 6.3 风险（5 类）

| 风险 | 场景 | 缓解 |
|---|---|---|
| **凭据集中** | 一个工作台装多家客户邮箱令牌，本机被入侵 = 批量失控 | 租户级隔离存储 + 最小 scope（只读不给发） |
| **误发** | AI 回错人、发错附件、群发 | 两阶段确认 + 收件人白名单 + 发送前 dry-run |
| **数据出域** | 邮件正文/附件进模型 | 协议告知 + 敏感字段脱敏 + 可切换本地模型 |
| **凭证幻觉** | 拿邮件当对账凭证（邮件可伪造、可撤回） | 邮件只作**线索**，最终以 ERP/厂家系统为准 |
| **过度自动化** | 自动读邮件→自动改单据 | 已明确冻结的订单 CRUD 方向，**不要碰**；一律"进待审队列 + 人工确认" |

### 6.4 适合经销商场景的 6 个改进方向 ★

1. **不做"邮箱客户端"，做"单据入口"**
   邮件只是信封，价值在附件里的**对账单/回款表/返利政策**。目标形态：
   `邮件 → 附件 → 解析（品牌/期次/省份/金额）→ 待确认单据 → 人工确认 → 落库`
   与 Hergent 已有的"待审队列 + 二次确认弹窗"交互完全一致，**可直接复用同一套 UI 范式**。

2. **双通道分工：MCP 走问答，自建收件走批量**
   - **MCP/连接器** → 老板问"厂家上周发了什么政策"，按需看 2-3 封。
   - **自建收件邮箱（IMAP 直连企业邮箱）** → 文员/厂家把大表发过来，服务端定时拉，**不受 1MB 限制**。
   两条腿走路，别用一条通道干两件事。

3. **每客户一个专用收件地址**
   给每个租户分配 `k1@in.<域名>`，类似"每客户托管隔离实例"路线在邮件侧的对应物：
   厂家/文员照旧发邮件 → 服务端拉取解析 → 进入该租户待审队列。**客户零学习成本**。

4. **入口用邮件，出口用企微（不要用邮件做推送）**
   Hergent 侧的主动通知能力已经现成：企微 home channel + `hermes send`（上一轮刚打通并验证）。
   **邮件是入口，企微是出口** —— 这条分工比"用邮件推报表"可靠得多，也符合经销商真实工作流。

5. **凭证模型下沉到租户级**
   抄 WorkBuddy 的"加密落盘 + scope + 可撤销"三件套，但**存储位置按租户隔离**。
   ⚠️ 注意 Hergent 现状：LLM key 是所有租户共享继承的（上一轮 401 静默降级故障正源于此）。**邮件授权不能再走同一条错路。**
   对应改造：`/opt/hermes-tenants/<tenant>/` 下独立凭据，而不是全局 `.env` 继承。

6. **先做最窄 MVP 验证付费意愿**
   只做一件事：
   > **厂家邮件进来 → AI 摘要 + 提取关键数字 → 企微推给老板 → 老板回复"确认/驳回"**
   选它的理由：命中北极星（愿意加微信/愿意付费的经销商人数）、不触碰订单 CRUD、一天能演示、失败成本极低。

### 6.5 一个必须知道的行业事实

WorkBuddy 连接器市场里**已经有一批经销商 ERP / 进销存连接器**（实测存在）：

| 连接器 | 覆盖 |
|---|---|
| **畅捷通 T+**（`tplus-api`） | 销售/采购订单、库存单据、生产工单、财务凭证、报表、基础档案 |
| 智慧记 AI 进销存（`ailit`） | 对账、开单、商品创建、库存、经营分析 |
| 柠檬云（`lemonclaw`） | 财务、进销存、业财、发票 |
| 领星 ERP（`lingxing-mcp`） | 店铺、库存、Listing、销售、利润、广告 |
| 乐檬零售（`lemon-agi`） | 零售、批发、进销存、WMS |
| 用友智能服务（`shanglv-mcp-gateway`） | 银企联、税企联、商旅云财务服务 |

**这对 Hergent 的含义（战略级）**：

- 用户之前点名的**畅捷通 T+ 已被官方接通**，说明"MCP 连接器"正在成为 ERP 侧的**标准接口**，而非独家能力。
- 因此 Hergent **不必重复造 ERP 对接**，应把力气放在**别人没有的东西**上：低温奶行业的配方算法（临期/返利/报单/回款）+ 副驾交互。
- 更值得考虑的反向打法：**把 Hergent 自己的行业算法做成 MCP Server**（我是**提供方**，不是消费方），让 WorkBuddy 这类 Agent 来调用 —— 这比自建邮箱同步更贴合"Hergent = AI 层"的定位，也天然规避了交易一致性的重活。

---

## 附：证据清单

| 证据 | 路径 |
|---|---|
| 连接器运行时配置（含 qq-mail 条目） | `~/.workbuddy/connectors/<id>/mcp.json` |
| 加密凭据（AES-256-GCM，逐字段密文） | `~/.workbuddy/connectors/<id>/.credentials.v3.json` |
| 启用状态 | `~/.workbuddy/connectors/<id>/connector-states.json` |
| 连接器技能契约 | `~/.workbuddy/connectors/skills/connector-qq-mail/SKILL.md` |
| 市场定义（200 个连接器） | `~/.workbuddy/connectors-marketplace/.codebuddy-connector/connectors.json` |
| 单个连接器 MCP 定义 | `~/.workbuddy/connectors-marketplace/connectors/qq-mail/mcp.json` |
| CLI 范式定义 | `~/.workbuddy/connectors-marketplace/connectors/wecom/cli.json` |
| OAuth 客户端实现 | `/Applications/WorkBuddy.app/…/cli/dist/codebuddy.js` → `McpOAuthManager` / OAuthClientProvider |
| 真实配额与 scope | 实际调用 `GetMe` 返回（`alias:read`/`mail:read`/`mail:send`；10/分·200/时·2000 发/天；附件 3×1MB/3MB） |
