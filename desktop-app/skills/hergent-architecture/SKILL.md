---
name: hergent-architecture
description: Hergent 多平台多角色架构 — 独立Gateway、Session共享、消息同步的完整方案
tags: [architecture, gateway, multi-platform, session, feishu, wecom]
---

# Hergent 多平台多角色架构

## 核心成果

在 Hermes Agent v0.14.0 基础上构建了一套**每角色独立 Gateway + 双向 Session 共享 + 消息实时同步**的多平台连接架构。飞书、企微、钉钉、QQ 四平台全部支持。

## 架构全景

```
主 Gateway (18765)
  ├─ API Server → App 聊天 (hermes chat CLI)
  └─ Cron 定时任务

角色 Gateway (无 API端口，纯平台连接)
  ├─ 大秘 → 飞书 WebSocket → 独立 HERMES_HOME + SOUL.md
  ├─ 程序员 → 飞书 WebSocket → 独立 HERMES_HOME + SOUL.md
  ├─ 会计 → 飞书 WebSocket → 独立 HERMES_HOME + SOUL.md
  └─ ... 每个角色每平台一个独立进程
```

## 关键技术决策

### 1. 为什么多 Gateway 实例而不是单实例多连接

Hermes Gateway 通过环境变量读取平台凭证（`FEISHU_APP_ID` 等），每次只能连一个平台实例。多个角色配同一个平台（如飞书）时，需要不同的 App ID/Secret，单实例无法同时支持。

**方案**：为每个 `(角色, 平台)` 组合启动独立 Gateway 进程，各自拥有独立的 `HERMES_HOME`、SOUL.md 和平台凭证。

**代码位置**：`main.js:spawnRoleGateways()`

### 2. 平台定义表

```javascript
const PLATFORM_DEFS = {
  feishu:   { label: '飞书', credField: 'app_id',    envVars: { app_id: 'FEISHU_APP_ID', app_secret: 'FEISHU_APP_SECRET' } },
  wecom:    { label: '企微', credField: 'bot_id',    envVars: { bot_id: 'WECOM_BOT_ID', secret: 'WECOM_SECRET' } },
  dingtalk: { label: '钉钉', credField: 'client_id', envVars: { client_id: 'DINGTALK_CLIENT_ID', client_secret: 'DINGTALK_CLIENT_SECRET' } },
  qq:       { label: 'QQ',   credField: 'app_id',    envVars: { app_id: 'QQ_APP_ID', app_secret: 'QQ_APP_SECRET' } },
};
```

新增平台只需在此表加一行，`spawnRoleGateways()` 自动处理。

### 3. Session 共享：飞书 ↔ App 双向上下文

**问题演进**：
- 初版：飞书和 App 完全隔离，互相看不到消息
- 尝试注入：用 `hermes chat` 后台注入消息，造成 AI 额外回复和消息重复
- 最终方案：App 聊天直接 `--resume` 飞书 Session，两边读写同一文件

**实现**：`chat:send` 中优先 `getLatestPlatformSession(roleId)` 作为 resume 目标。飞书 Gateway 写完消息后，App 下次聊天自动接续。

### 4. 消息同步：飞书消息显示在 App

前端每 4 秒轮询 `feishu:poll-messages` IPC，读所有角色 Gateway 的 `sessions.json`，找到飞书 Session 中的新消息，调用 `addChatMessage` 显示。消息存入对应角色的 localStorage，不串。

### 5. Gateway 重启策略

`channels:save` → `restartGateway()` → `stopHermesGateway()` 杀所有进程 → `startHermesGateway()` 启动主 Gateway + `spawnRoleGateways()` 启动所有角色 Gateway。

**主 Gateway 已运行时**也要执行 `spawnRoleGateways()`，否则新增角色不会启动。

### 6. 模型配置修复

Gateway 冷启动需要 `model.base_url` 和 `model.default` 配置项，仅设 `model.name` 和 `model.provider` 不够。Platform Session 创建时如果找不到这些配置会 fallback 到 `provider=custom` 导致 "Empty response from model"。

## 踩过的坑

| 问题 | 原因 | 修复 |
|------|------|------|
| 飞书"已保存"不显示"已连接" | Gateway 靠环境变量读凭证，非 config.yaml | `spawnRoleGateways` 注入 env vars |
| 两个 Gateway 抢端口 18765 | Agent 注册了 launchd 服务自动重启 | 卸载 `ai.hermes.gateway` 服务 |
| `hermes config set` 写到错误位置 | 没设 `HERMES_HOME` 环境变量 | `hermesCLI()` 加 `HERMES_HOME` |
| 角色 Gateway 未启动 | `Already running` 提前 return | 无论主 Gateway 是否运行都执行 spawn |
| 飞书消息串角色 | `addChatMessage` 写到当前角色而非目标角色 | 临时切换 `currentAction` 再写入 |
| AI 回复 "我扮演" | 提示词用了 `你扮演"X"角色` | 改为 `你是用户的私人X`，去元指令 |
| 冷启动 Gateway 崩溃 | `...platformEnv` 未定义 | 移除展开，函数已返回空对象 |

## 关键文件

- `desktop-app/main.js` — Gateway 管理、IPC 处理、`spawnRoleGateways()`、`getPlatformRoleConfigs()`
- `desktop-app/js/app.js` — 前端轮询 `pollFeishuMessages()`、消息显示、模型切换
- `desktop-app/preload.js` — IPC 桥接
- `desktop-app/styles.css` — 消息面板、模型选择器、技能页样式
