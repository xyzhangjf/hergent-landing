# Hergent 项目开发规范

> 踩坑总结 · 每次修改前必读

## 铁律

### 1. 改 JS 永远不要用 sed 批量替换

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
