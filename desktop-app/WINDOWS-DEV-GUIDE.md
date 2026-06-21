# Hergent Windows 版开发指南 · 给 QClaw

## 服务器信息

| 项目 | 值 |
|------|-----|
| IP | `47.113.224.140` |
| 用户 | `root` |
| 密码 | `Txh@189zsh2` |
| 下载页 | `/var/www/hergent-landing/downloads/` |
| 更新页 | `/var/www/hergent-updates/` |

---

## 项目结构（只改 Windows，不动 Mac）

```
desktop-app/
├── main.js               ← 主进程（Windows/Mac 共用，加 Windows 分支）
├── js/app.js             ← 前端逻辑（共用）
├── index.html            ← UI（共用）
├── styles.css            ← 样式（共用）
├── package.json          ← 构建配置
├── hermes.tar.gz         ← 引擎 tarball（Windows 版）
│
├── win-patches/          ← Windows 独有补丁，构建时自动打包到 Resources/
│   ├── libs/
│   │   └── hermes_constants.py   ← 追加到引擎文件的函数
│   └── tools/
│       └── threat_patterns.py    ← 空壳模块
│
├── release/              ← 构建产物
│   └── Hergent-1.0.105-setup.exe
│
└── WINDOWS-DEV-GUIDE.md  ← 本文档
```

---

## 构建和上传

```powershell
# 1. 构建（在 desktop-app 目录下）
npm run dist:win

# 2. 上传到下载页（用户从 hergent.cn 下载）
scp release/Hergent-1.0.105-setup.exe root@47.113.224.140:/var/www/hergent-landing/downloads/

# 3. 上传到更新目录（已安装用户自动更新）
scp release/Hergent-1.0.105-setup.exe root@47.113.224.140:/var/www/hergent-updates/
```

如果没有 `scp`，用 [WinSCP](https://winscp.net) 也行。

---

## 关键注意事项

### 1. SERVER_URL
`main.js` 第 542 行，Windows 连远程服务器：
```js
const SERVER_URL = process.platform === 'win32'
  ? 'https://api.hergent.cn'
  : 'http://localhost:8765';
```

### 2. HERMES_HOME 路径
`main.js` 第 230 行等处，**必须是** `engineDir/.hermes`：
```js
const gwHome = path.join(engineDir, '.hermes');
```

### 3. win-patches 自动应用
`main.js` 第 598-616 行，引擎解压后自动把 `win-patches/` 下的：
- `.py` 文件 **追加** 到引擎已有文件末尾
- 目录 **合并**（不覆盖已有文件）
- 其余文件直接复制

### 4. JS 变量作用域
`try {}` 里声明的 `const`/`let`，`catch {}` 里访问不到。涉及 `winRoleId` / `roleId` 的地方要注意。

### 5. 不要改 Mac 相关代码
Mac 版由我（Claude）负责。如果需要在 `main.js` 加逻辑，用 `if (isWindows) { ... }` 包住。

---

## 已知问题和案例

### 案例 1：winRoleId not defined
**原因**：`const winRoleId = role || 'dami'` 写在 `try {}` 里，但 `catch {}` 和后面的 `return` 也用了它。
**修复**：移到 `try {}` 外面。

### 案例 2：引擎缺失模块
- `hermes_constants.py` 缺 `secure_parent_dir` → 放 `win-patches/libs/`，构建时自动追加
- `threat_patterns.py` 模块找不到 → 放 `win-patches/tools/`，空壳占位

### 案例 3：创建支付订单失败
**原因**：Windows 上没跑 `server.py`，`SERVER_URL` 写成 `localhost:8765` 发不出去。
**修复**：Windows 用 `https://api.hergent.cn`，服务器上 `server.py` 一直在运行。

---

有问题直接在这个文档上注明，我会更新。
