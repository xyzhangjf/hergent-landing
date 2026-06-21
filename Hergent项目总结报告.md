# Hergent 项目总结报告

> 日期：2026-05-19 | 版本：v1.0 | 状态：macOS 已发布

---

## 一、项目定位

**Hergent** 是一款面向普通用户的 AI 数字员工桌面应用。将 Hermes Agent（Nous Research 开源的 AI Agent 框架）包装成双击即用的 Electron 桌面软件，定位"数字员工"而非"聊天机器人"，让不懂命令行的用户也能使用 AI Agent。

核心差异化：对标 QClaw/OpenClaw 的 Agent 能力（L1-L8），在用户侧增值层（客户端/支付/国内平台）做差异化（L9-L12）。

---

## 二、代码规模

| 文件 | 行数 | 职责 |
|------|------|------|
| `desktop-app/main.js` | ~1770 | Electron 主进程：引擎生命周期、Gateway管理、IPC通信、积分扣减、激活校验 |
| `desktop-app/js/app.js` | ~3330 | 渲染进程：聊天界面、8角色切换、技能展示、设置面板、流式渲染 |
| `desktop-app/preload.js` | — | contextBridge 安全桥接，暴露有限 API 给渲染进程 |
| `server/server.py` | ~820 | 服务端：积分计费、API Key 代理转发、用户识别 |
| `landing-page/index.html` | ~730 | 落地页：下载引导、功能介绍 |

---

## 三、架构总览（13层模型）

```
┌─────────────────────────────────────────┐
│  L12  桌面客户端 (Electron)             │  ← Hergent 独占
├─────────────────────────────────────────┤
│  L11  积分 / 支付体系                    │  ← Hergent 独占商业层
├─────────────────────────────────────────┤
│  L10  安全架构（Key仅存服务端）          │
├─────────────────────────────────────────┤
│  L9   消息平台（飞书/企微/钉钉/QQ）     │
├─────────────────────────────────────────┤
│  L8   定时任务 (cronjob)                │
│  L7   多 Agent 委托 (delegate_task)     │
│  L6   工具系统 (terminal/file/web等)    │
│  L5   技能系统 (SKILL.md, 50+内置)      │
│  L4   记忆系统 (SOUL.md+USER.md+FTS5)   │
│  L3   Agent 循环 (chat→tool_calling)    │
│  L2   消息网关 (Gateway, port 18765)    │
│  L1   底层框架 (Hermes Agent v0.14.0)   │
└─────────────────────────────────────────┘
```

- **L1-L8**：与 QClaw/OpenClaw 完全对等
- **L9-L12**：Hergent 差异化优势层

---

## 四、三条核心路径

### 4.1 引擎自解压（首启体验）

用户首次打开 App 无需安装任何依赖：

```
hermes.tar.gz (python-build-standalone 3.11.10 + Hermes CLI + 所有依赖)
  → extractBundledEngine()  解压到 ~/Library/Application Support/hergent/hermes-engine/
  → ensureEngineConfig()    写入 config.yaml（provider 指向服务端）
  → ensureBuiltinSkills()   写入内置技能（如 Karpathy 编程指南）
  → run.sh 驱动引擎，HERMES_HOME 指向 engineDir/.hermes/
```

关键设计：
- 版本 sentinel 文件（`.extracted-version`）避免重复解压
- **sentinel + 关键文件双重验证**：防止 sentinel 存在但解压不完整（如 Gatekeeper 删除了 dylib）
- 解压后立即 `xattr -cr` 清除隔离属性

### 4.2 对话链路（双路径容错）

```
用户输入
  ├─ 优先：Gateway (127.0.0.1:18765) → /v1/chat/completions → SSE 流式返回
  └─ 回退：hermes chat -q → spawn 直接调用 CLI → 解析输出
```

- 两条路径都经过 `server.py → DeepSeek API`
- API Key 仅存服务端 `.env`，客户端不持有
- 客户端通过 `device_id` 指纹识别用户

### 4.3 积分计费

```
客户端 → httpPost(SERVER_URL/api/credits/deduct?device_id=xxx)
       → server.py 验证 + 扣减积分 → 转发 DeepSeek → 返回结果
```

- 积分按设备隔离（`device_id` 显式传递，不再依赖 UA 指纹）
- 新用户注册赠送 500 积分
- 扣费粒度：按输入+输出总字数 / 500 字符向上取整

---

## 五、部署分布

| 组件 | 方案 | 位置 |
|------|------|------|
| 下载分发 | GitHub Releases | `xyzhangjf/hergent-landing` |
| 落地页 | GitHub Pages | `xyzhangjf/hergent-landing` |
| API 服务 | 阿里云 ECS | `api.hergent.cn:8765` |
| 更新服务 | 阿里云 | `/var/www/hergent-updates/` |
| 服务端代码 | Python Flask | `server/server.py` |

---

## 六、已完成 & 进行中

| 项 | 状态 |
|----|------|
| macOS DMG (arm64) | ✅ 已发布 |
| Windows EXE (x64) | 🔄 待构建 |
| 飞书消息通道 | ✅ 已通 |
| 企微 / 钉钉 / QQ 通道 | 📋 规划中 |
| 微信 / 支付宝支付 | 🔄 等营业执照 |
| Apple 代码签名 + 公证 | 🔄 等开发者账号 |
| ICP 备案 | 🔄 进行中 |
| 8角色 + 50+内置技能 | ✅ 已上线 |
| 文件拖拽上传 | ✅ 已上线 |
| 积分实时显示 | ✅ 已上线 |

---

## 七、踩过的坑

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| DMG 安装后显示"已损坏" | 无代码签名 | `codesign --force --deep --sign -` 临时签名 |
| Apple 无法验证 python3.11 | Gatekeeper 隔离属性从 DMG 传播到解压文件 | 解压后立即 `xattr -cr engineDir` |
| 引擎未安装（sentinel 在但 dylib 丢） | Gatekeeper 静默删除 `libpython3.11.dylib`，但 sentinel 文件认为解压完整 | sentinel + 关键文件双重验证 |
| hdiutil convert 崩溃 | macOS 26.3 的 hdiutil 与 electron-builder 不兼容 | 手动 `hdiutil create -fs APFS -srcfolder` |
| spawnSync 未定义 | 添加 xattr 清理时忘记引入 `spawnSync` | 补全 require: `const { execSync, exec, spawn, spawnSync }` |
| 积分不扣 | 之前只在 Gateway 路径扣了积分，CLI fallback 路径漏了 | 两条路径都加 `httpPost(/api/credits/deduct)` |
| 技能页空白 | `skills:list` IPC handler 数据源为空 | 改为从已有 ROLES + ROLE_SCENES 动态构建 |

---

## 八、不做的事

- ❌ 自研 Agent 框架（用 Hermes Agent 就够）
- ❌ Linux 客户端
- ❌ 移动端 App
- ❌ 多语言国际化（中文优先）
- ❌ 技能市场 / 插件商店

---

## 九、竞品借鉴（QClaw / OpenClaw）

### 9.1 竞品定位

| 维度 | OpenClaw | QClaw (腾讯) | Hergent |
|------|----------|-------------|---------|
| 底层框架 | 自研 Agent 框架 | OpenClaw 封装 | Hermes Agent |
| 分发方式 | CLI / 托管云 | 桌面 GUI + 微信小程序 | Electron 桌面 App |
| 消息通道 | 50+（WhatsApp/Telegram/Discord/Slack/iMessage等） | 微信 + QQ | 飞书为首，企微/钉钉/QQ 规划中 |
| 技能生态 | ClawHub 5000+ 社区技能 | 继承 ClawHub | 50+ 内置技能，无社区机制 |
| 商业模式 | 开源 MIT + getclaw 托管 | 免费 Beta | 积分计费 |
| 目标用户 | 全球开发者/技术用户 | 中国普通用户（微信入口） | 中国办公/个人用户 |

### 9.2 功能对比（OpenClaw vs Hermes Agent 底层）

根据 2026 年 3 月公开对比：

| 领域 | OpenClaw 优势 | Hermes Agent 优势 |
|------|-------------|------------------|
| 多通道 | 中央 Gateway，一个进程管所有通道 | Signal 支持，跨平台会话连续性 |
| 记忆 | 按助手隔离，团队共享上下文 | 多级记忆 + FTS5 全文搜索 + LLM 摘要 |
| 技能/工具 | 52+ 内置技能，文件优先级系统 | 40+ 工具，从问题解决中自动生成技能 |
| 自动化 | 心跳调度器（可配置间隔） | 自然语言 cron + 并行子代理 |
| 模型支持 | BYOK (Claude/GPT/Gemini/xAI 等) | 200+ 模型 via OpenRouter, Nous Portal |
| 部署 | getclaw 托管云 | 6 种后端含 serverless (Modal, Daytona) |
| 安全 | 设备配对、Gateway 认证、访问控制 | 零遥测、容器沙箱 |
| 学习能力 | 技能分发 + 工作区管理 | 自我改进技能、训练数据导出 (ShareGPT) |

### 9.3 QClaw 核心卖点

1. **微信直连远程控制** — 扫码绑定微信，从微信发指令操控电脑。这是 QClaw 最大的差异化，利用微信 14 亿用户降低使用门槛
2. **文件空间**（2026.5.11 上线）— 一次授权打通本地文件 + 腾讯文档 + ima 知识库，找资料→AI 加工→产出→协作，一个工作台闭环
3. **3 分钟安装** — 下载→注册→扫码，零配置
4. **三种预配置 Agent 模式** — 新手不用理解 Agent 概念，直接选模式即可
5. **Kimi 模型内置** — 国内模型开箱即用
6. **安全沙箱** — 腾讯电脑管家团队出品，权限隔离

### 9.4 Hergent 可落地的借鉴

| 借鉴项 | QClaw/OpenClaw 做法 | Hergent 怎么做 | 优先级 |
|--------|-------------------|---------------|--------|
| **文件空间** | 打通本地+腾讯文档+知识库 | 左侧加"文件"Tab，支持本地目录索引 + 飞书文档连接 | ⭐⭐⭐⭐⭐ 下周可做 |
| **社区技能** | ClawHub 5000+ skills | GitHub repo 托管 SKILL.md 合集 + App 内一键安装（先不做完整 registry） | ⭐⭐⭐⭐ 低成本高回报 |
| **心跳调度可视化** | 心跳调度器 | 设置面板加"自动任务"卡片 + 预设模板（每日简报、天气提醒、文件整理） | ⭐⭐⭐ 降低使用门槛 |
| **安装向导** | QClaw 3 步引导 | 首次启动引导：选角色→绑飞书→送积分 | ⭐⭐⭐ 提升转化 |
| **浏览器自动化** | Chrome/Chromium 实例 | 不需要捆绑浏览器——用 Hermes 已有的 browser 工具，UI 上加按钮即可 | ⭐⭐ 已有底层能力 |
| **Web UI 仪表盘** | Token 用量仪表盘 | 积分消耗可视化看板（日/周/月） | ⭐⭐ 用户感知强 |

### 9.5 短期不追的

| 功能 | 原因 |
|------|------|
| 语音唤醒 + 语音对话 | 需 ElevenLabs 等第三方 + 实时音频流，太重 |
| 交互画布 (A2UI) | 前端工程量巨大，等产品站稳 |
| 设备配对认证 | 需要账号体系，等支付上线后配套 |
| 托管云部署 | 需要运维 infra，等公司注册 + 备案完成 |
| 微信通道 | 飞书已是差异化路径；企微优先级更高 |

### 9.6 Hergent 的差异化护城河

相比 QClaw，Hergent 有几张独有的牌：

1. **积分计费体系** — QClaw 目前免费 Beta，商业模式不明确。Hergent 已跑通积分扣减，等支付接入即形成闭环
2. **8 角色体系** — 程序员/会计/写手/编剧/家教/健康顾问/投资顾问/大妈，每人独立 SOUL + 会话，不是通用聊天机器人
3. **独立可控** — 不依赖任何大厂生态。QClaw 背靠腾讯，但也受腾讯限制（只能用 Kimi 模型等）
4. **飞书办公场景** — 飞书用户偏企业/办公，与 Hergent 的"数字员工"定位天然契合

---

## 十、模型层 + 产品层借鉴（Kimi K2.6）

> Kimi 由月之暗面（Moonshot AI）开发，K2.6 于 2026 年 4 月 20 日开源发布，是目前 Agent 能力最强的开源模型。

### 10.1 模型规格

| 指标 | 数值 |
|------|------|
| 架构 | Mixture-of-Experts (MoE) |
| 总参数 | 1 万亿（384 专家，每 token 激活 8 个，32B 活跃参数） |
| 上下文窗口 | 256K tokens |
| 训练数据 | 15.5 万亿 tokens |
| 许可证 | 修改 MIT（商业可用，MAU>1 亿或月收入>$2000 万需标注） |
| API 价格 | $0.95/M 输入，$4.00/M 输出（比 DeepSeek 略贵但远低于 GPT/Claude） |

**关键基准测试**：
- SWE-Bench Pro: 58.6%（超过 GPT-5.4 的 57.7%、Claude Opus 4.6 的 53.4%）
- 12 小时持续执行、4000+ 工具调用不崩溃
- 代码生成准确率较 K2.5 提升 12%，长上下文稳定性提升 18%，工具调用成功率 96.60%

### 10.2 Hergent 可直接受益的

**① 把 K2.6 加为后端模型选项**

K2.6 在 Agent 任务（工具调用、长程执行）上已经超过 GPT-5.4 和 Claude Opus 4.6，价格却低得多。Hergent 目前后端是 DeepSeek，可以考虑：
- 在 `server.py` 中加 Kimi API 作为可选 provider
- 让用户在设置中切换 DeepSeek / Kimi
- K2.6 在长程 Agent 任务上的可靠性明显更好（4000 步不崩溃 vs DeepSeek 约 60 轮）

### 10.3 产品层面可借鉴的

| 借鉴项 | Kimi 做法 | Hergent 怎么做 | 优先级 |
|--------|----------|---------------|--------|
| **文档 → 可复用技能** | 上传 PDF/表格/幻灯片，自动提取结构和风格，转为 Agent 可调用的 Skill | "技能工坊"功能：用户拖入文档→AI 分析内容→自动生成 SKILL.md→一键安装到本地 | ⭐⭐⭐⭐⭐ |
| **Agent Swarm（300 子代理并行）** | 将复杂任务拆解给 300 个子代理并行执行，4.5x 加速 | 提升 delegate_task 并发上限（当前 3→目标 10+），前端加"任务拆解"可视化 | ⭐⭐⭐⭐ |
| **WebBridge 浏览器扩展** | Chrome/Edge 扩展 + 本地服务，Agent 可操作真实浏览器（点击/填表/截图），支持 Hermes | 直接适配 Kimi WebBridge：写一个 SKILL.md 让 Hergent 的 Agent 能调用 WebBridge，零开发成本 | ⭐⭐⭐⭐ |
| **工作流 → 技能录制** | WebBridge 录制浏览器操作→转为可复用 Skill | 终端命令录制→转 Skill（如"帮我每天拉取销售数据→生成日报"录一次即可） | ⭐⭐⭐ |
| **主动代理（Proactive Agents）** | Agent 不等人问，监控系统/定时执行/事件触发，已验证 5 天连续自主运行 | 心跳调度 + 事件触发：邮件来了自动处理、文件变了自动分析（比 cronjob 更智能） | ⭐⭐ |
| **Claw Groups（异构多模型协作）** | 不同设备、不同模型（Claude/Qwen/人类）在一个共享空间协作，K2.6 协调 | 远期方向：Hergent 的 8 个角色互相协作完成复杂任务 | ⭐ 远期 |

### 10.4 WebBridge — 零成本快速接入

Kimi WebBridge（2026.5.15 发布）是一个浏览器扩展，让 AI Agent 直接操作 Chrome/Edge。它**已经原生支持 Hermes Agent**。Hergent 只需做两件事：

1. 写一个 `SKILL.md`，教 Agent 何时/如何调用 WebBridge
2. 引导用户安装 WebBridge 扩展（Chrome 商店一键安装）

这就相当于零成本获得浏览器自动化能力——不需要像 OpenClaw 那样捆绑 Chromium。

### 10.5 Kimi 桌面应用参考

Kimi 桌面应用（开源：`github.com/kimi-moonshot/kimi-moonshot`）也是 Electron 架构，支持 Mac/Windows/Linux。值得参考的点：

- **左侧功能导航**：PPT、文档、深度研究、网站、表格、Agent 集群、Kimi Code、Kimi Claw——按场景组织而非按技术概念
- **Kimi Claw (Beta)**：桌面端的 Agent 控制面板，类似 OpenClaw 的 GUI 封装
- **获取应用程序入口**：Web 端顶部常驻下载引导，降低桌面端获取门槛

### 10.6 Hergent vs Kimi 定位差异

| 维度 | Kimi | Hergent |
|------|------|---------|
| 核心能力 | 模型 + Web 应用 | Agent 框架 + 桌面客户端 |
| 分发 | Web 优先 + 桌面 App | 桌面 App 为核心 |
| 商业模式 | API 付费 + 订阅 | 积分计费（按用量） |
| 差异化 | 万亿参数模型、Agent Swarm | 8 角色、飞书集成、本地优先 |
| 关系 | 互补 > 竞争：K2.6 可作为 Hergent 的后端模型 | — |

---

## 十一、下一步优先级

| 优先级 | 内容 | 来源 |
|--------|------|------|
| P0 | Windows 版构建 + 发布 | 原计划 |
| P0 | 文件空间（本地目录索引 + 飞书文档连接） | QClaw 借鉴 |
| P1 | ICP 备案 + 切 `https://api.hergent.cn` | 原计划 |
| P1 | Apple 开发者账号 + 正式签名公证 | 原计划 |
| P1 | 微信 / 支付宝支付接入 | 原计划 |
| P1 | 社区技能 GitHub repo + App 内一键安装 | QClaw 借鉴 |
| P1 | 接入 Kimi K2.6 作为后端模型选项（server.py 加 provider） | Kimi 借鉴 |
| P1 | WebBridge 适配（SKILL.md + 用户引导，零成本获浏览器自动化） | Kimi 借鉴 |
| P2 | 文档→技能工坊（拖入 PDF/表格→自动生成 SKILL.md→一键安装） | Kimi 借鉴 |
| P2 | 安装向导（3步引导：选角色→绑飞书→送积分） | QClaw 借鉴 |
| P2 | 心跳调度可视化 + 自动任务模板 | OpenClaw 借鉴 |
| P2 | Agent Swarm 并发提升（delegate_task 上限 3→10+，任务拆解可视化） | Kimi 借鉴 |
| P2 | 思考过程展示、对话历史、文件预览 | 原计划 |
| P2 | 落地页优化、新手引导 | 原计划 |
| P2 | 积分消耗仪表盘（日/周/月） | OpenClaw 借鉴 |
| P3 | 企微 / 钉钉 / QQ 多平台接入 | 原计划 |
