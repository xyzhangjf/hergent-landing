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

## 九、下一步优先级

| 优先级 | 内容 |
|--------|------|
| P0 | Windows 版构建 + 发布 |
| P1 | ICP 备案 + 切 `https://api.hergent.cn` |
| P1 | Apple 开发者账号 + 正式签名公证 |
| P1 | 微信 / 支付宝支付接入 |
| P2 | 思考过程展示、对话历史、文件预览 |
| P2 | 落地页优化、新手引导 |
| P3 | 企微 / 钉钉 / QQ 多平台接入 |
