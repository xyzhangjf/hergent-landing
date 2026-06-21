# Hergent 项目开发规范

> 踩坑总结 · 每次修改前必读

---

## 铁律（防回归）

### 1. 一次只改一件事

改品牌色就不要同时改支付，修技能就不要同时调图标。改完 → 构建 → 测通 → **打快照** → 再做下一件。

> 教训：本轮我们同时改了品牌色、充值流程、CSS 精简、图标统一、角色名称、技能修复。一个改坏极难定位是哪个改动导致的。

### 2. 改完必须用打包版测，不能只用源码测

`npx electron .` 跑的是源码，asar 打包后的行为不同——
- `fs.cpSync` 从 asar 复制目录会静默失败
- `__dirname` 路径在 asar 内指向不同位置
- `process.resourcesPath` 在打包版和源码版不同

**改完 = 构建 DMG → 安装到 `/Applications/` → 打开测。** 不要偷懒只跑 `npx electron .`。

> 教训：技能页面在源码版正常，打包后为空。排查了整整 3 轮才发现是 asar 不支持 cpSync。

### 3. App 和落地页共享的数据，改一处必须同时改另一处

| 共享数据 | 位置 |
|----------|------|
| 邮箱/admin@ | `index.html`、落地页 |
| 官网域名 | `index.html`、落地页 |
| 角色名称/头像 | `main.js` BUILTINS、落地页 |
| 技能数量 | `styles.css`/`index.html`、落地页 |
| 品牌色 | `styles.css`、落地页 CSS |
| 图标 | `icon.png`、落地页 `favicon.png`、标题栏 |

改完 App 里的某个值 → 立即 `grep` 确认落地页也改了。

> 教训：邮箱从 `admin@her-agent.com` 改成 `admin@hergent.cn`，App 改了但落地页漏了。

### 4. 不改 CLIENT 端代码时，重启 server.py 即可，不用重新打包

`server.py` 在 Repos 里，App 启动时从磁盘加载。改了积分倍率、充值逻辑 → 重启 App 即可生效，**不需要重新构建 DMG**。

### 5. 不要在内联 base64 大图，用 `extraResources` 放磁盘

一张 582KB 的 `icon.png` 转 base64 后 794KB，塞进 HTML 导致单文件无法正常读取。用于 App 内部的图标统一走 `avatar://` 协议或 `process.resourcesPath`。

> 教训：启动页图标改 base64 后 HTML 涨到近 200KB，文件太大无法正常编辑，且图标在 48px 下模糊。最终改用 `extraResources` + `avatar://` 引用 256px 原图才解决。

---

## 已有铁律（继续遵守）

### 6. 改 JS 永远不要用 sed 批量替换

sed 不理解 JavaScript 上下文。单引号字符串、模板字符串、正则——sed 全当纯文本改，必定引入语法错误。

**正确方式**：用 Edit 工具逐处手动修改，每次改完立即跑：
```bash
node -c desktop-app/js/app.js && node -c desktop-app/main.js && echo "OK"
```

### 2. 发布前四件套一起验证

`app.js` / `main.js` / `index.html` / `styles.css` 相互依赖。改了任何一个必须确认其他三个是配套版本。

### 3. 回滚时同一版本四件套全回

备份文件命名格式 `*.bak-v1.0.XX`。回滚时四个文件**同时**恢复同一个版本的备份，绝不混搭。

### 4. Electron ≠ Node.js 本机版本

Electron 内置的 Node.js 版本和本机安装的不同。以下模块不可用：
- `node:sqlite` (Electron 39 禁用)
- `better-sqlite3` (需预编译 native 模块，跨平台复杂)
- `worker_threads` (部分场景受限)

需要 SQLite 时用系统 `sqlite3` 命令行工具（`execSync` 调用）。

### 5. v0.15.x 特殊注意事项

Hermes v0.15.x 有以下破坏性变更：

| 变更 | 影响 |
|------|------|
| `config set` 写字典格式 `'0':/ '1':` | **永远不要用 hermes config set 写 custom_providers**，直接写 YAML 文件 |
| `custom_providers` 必须列表格式 | 写 `- name: xxx` 格式，不能写 `'0':` 格式 |
| provider 名只能用已知值 | 用 `openai` 而不是 `hergent`/`bailian` |
| 需要 `.env` 文件里有 `OPENAI_API_KEY` | 每个角色目录下写入 `.env` |
| session 存储从 JSON 改为 SQLite | `state.db` 替代 `session_xxx.json` |
| API_SERVER_KEY 必填 | 否则 Gateway 拒绝启动 |

### 6. 构建命令

```bash
cd desktop-app
# macOS
cp -f ../engines/hermes/hermes.tar.gz hermes.tar.gz
npm run dist:mac

# Windows（必须用 Windows tarball）
cp -f ../engines/hermes-win/hermes.tar.gz hermes.tar.gz
npm run dist:win
# 记得恢复 macOS tarball
cp -f ../engines/hermes/hermes.tar.gz hermes.tar.gz
```

### 7. 发布流程

```bash
git add desktop-app/
git commit -m "fix: xxx"
npm version patch  # 或用 sed 手动改 desktop-app/package.json
git push origin main && git tag vX.Y.Z && git push origin vX.Y.Z
# 然后构建 + gh release create
```

### 8. 未知问题先回滚再排查

遇到飞书 500 这种问题 → 先回滚到最后一个正常工作的版本 → diff 对比 → 定位根因。不要连修多个版本。

### 9. 四件套备份清单

| 文件 | 行数 | 作用 |
|------|------|------|
| `desktop-app/js/app.js` | ~5230 | 前端逻辑 |
| `desktop-app/main.js` | ~3140 | Electron 主进程 |
| `desktop-app/index.html` | ~810 | UI 结构 |
| `desktop-app/styles.css` | ~4580 | 样式 |

每次大改动前备份：`cp file file.bak-v1.0.XX`

---

## 支付对接踩坑总结

### 10. 改完代码必须重启进程，不能假定已经在跑最新版

Python 加载 .py 文件后缓存在内存里，之后修改文件不会自动生效。
- 改完 server.py → `pkill -f server.py && 重启动`
- 改完 main.js → 必须重新构建 DMG，不能只跑 `npx electron .`
- 验证方法：`ps -o lstart,pid -p $(pgrep -f server.py)` 看启动时间

> 本轮花了 3+ 小时排查，最后发现是因为 server.py 改了但进程从 18:50 跑到 22:00 没重启过。

### 11. 数据库连接不要跨 with 块使用

Python `with get_db() as db:` 退出时关闭连接。之后 `db.execute()` 报 `Cannot operate on a closed database`。
- **正确**：每个独立的数据库操作开自己的 `with get_db() as db2:`
- **错误**：在 `with` 块外面继续用 `db` 变量

### 12. 支付宝有两套独立的密钥对

| 密钥 | 来源 | 用途 |
|------|------|------|
| 应用私钥 | 我们生成 | 签名 API 请求 |
| 应用公钥 | 我们生成 | 上传给支付宝（支付宝验证我们） |
| 支付宝公钥 | 从支付宝下载 | 验证支付宝回调签名 |

- 应用私钥和应用公钥是**同一对**
- 支付宝公钥和上面两个**不是同一对**
- 回调验签失败 = 文件里存的是应用公钥，而不是支付宝公钥
- 验证方法：用自己的私钥签名 → 用公钥验证 → 如果通过，说明是同一对（应用公钥），不是支付宝公钥

### 13. 主动查询不需要支付宝公钥，也不需要公网回调

`alipay.trade.query` 只用应用私钥签名请求，返回 JSON 直接读结果，没有"对方签名需要验证"的环节。
- 适合：桌面软件、本机 server、没有公网 IP 的客户端
- 轮询间隔 2 秒以内不会被限流
- 后续加中继服务器后可切回回调模式（更实时）

### 14. 远程后台和本地数据库是独立的

- 用户积分、充值记录 → 本机 `~/Library/Application Support/hergent-credits/credits.db`
- 后台日活、充值总额 → 远程 `api.hergent.cn` 的 `credits.db`
- 每次充值成功必须**主动上报**到远程（`POST /api/telemetry/recharge`）
- 不上报 = 后台永远看不到真实数据

---

## Phase 1 重构：main.js 模块化（2026-06-21）

### 新模块结构

```
desktop-app/
  main.js                        2825行（重构中，目标<300行）
  src/main/
    constants.js                  55行  所有魔法数字/配置常量
    logger.js                     88行  集中日志系统（依赖注入）
    http-client.js               102行  统一 HTTP 客户端（4合1）
    roles.js                      33行  角色CRUD
    license.js                   102行  激活码/试用/设备ID
    engine.js                    459行  引擎解压/配置/路径解析
    role-skills.js                11行  角色→技能映射数据
    roles-data.js                 11行  8个默认角色定义数据
```

### 模块初始化顺序
```
1. constants (无依赖)
2. logger → logger.init(app, Sentry, isDev)
3. http-client → httpClient.init(tlsReject)
4. engine → engine.init(gatewayApiKey, hermesBin)
5. roles + license → rolesMgr.init(app) + licenses.init(app) in app.whenReady()
```

### 调用规范
- 所有函数通过模块调用：`licenses.getDeviceId()`, `engine.extractBundledEngine()`, `rolesMgr.loadRoles()`
- 禁止直接 `localStorage` 操作（Phase 2 state.ts 封装）
- 禁止空 `catch (_) {}` — 至少记录日志

### ESLint 状态
- 0 errors, ~151 warnings（Phase 4 前降为 warn，Phase 4 后全面收紧）
