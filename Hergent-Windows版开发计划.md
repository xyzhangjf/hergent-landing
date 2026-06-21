# Hergent Windows 版开发计划

> 日期：2026-05-20 | 基于：归位计划 + 竞品分析 + Kimi K2.6 分析
> 原则：Hergent = Hermes + GUI + 一键安装 + 积分计费

---

## 一、目标

在 macOS 版基础上，**2 周内**交付可用的 Windows 版 Hergent，同时借 Windows 版构建的机会完成"归位"重构（技能外置、减少重复代码）。

---

## 二、构建前重构（归位 P0，1-2 天）

> 理由：Windows 版构建脚本和 macOS 版大量共享。先把代码归位，两版同时受益。

### 2.1 技能文件外置（删 ~586 行）

**现状**：`ensureBuiltinSkills()` 把 11 个 SKILL.md 写成 JS 内联字符串。

**操作**：
```
desktop-app/
  └── skills/                  ← 新建
        ├── karpathy-coding/
        │     └── SKILL.md
        ├── file-processing/
        │     └── SKILL.md
        ├── feishu-integration/
        │     └── SKILL.md
        └── ... (11 个技能)
```

- `ensureBuiltinSkills()` 缩减为：检查 `skills/` 目录 → 复制到引擎 skills 目录 → 调 `hermes skills audit`
- 构建时 skills/ 目录打入 app.asar

### 2.2 修复 pairing 空桩

`channels:pairing-approve` → `spawnSync('hermes', ['pairing', 'approve', code])`

---

## 三、Windows 引擎包构建（2-3 天）

### 3.1 构建脚本

文件：`desktop-app/build-engine-win.sh`（在 macOS 上交叉准备）

```bash
#!/bin/bash
# 在 macOS 上准备 Windows 引擎包
# 产物：engines/hermes-win/hermes.tar.gz

set -e

# 1. 下载 python-build-standalone for Windows
PYTHON_URL="https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.11.10-x86_64-pc-windows-msvc-shared-install_only.tar.gz"
BUILD_DIR="engines/hermes-win/build"

rm -rf "$BUILD_DIR" && mkdir -p "$BUILD_DIR"
curl -L "$PYTHON_URL" -o "$BUILD_DIR/python.tar.gz"
tar xzf "$BUILD_DIR/python.tar.gz" -C "$BUILD_DIR"

# 2. 下载 Windows 版 Hermes 依赖（用 macOS Python 的 --platform 安装）
#    注意：纯 Python 包可以直接安装，C 扩展包需要下载 Windows wheel
pip3 install --platform win_amd64 --only-binary=:all: \
  --target="$BUILD_DIR/libs" \
  hermes-agent==0.14.0 aiohttp httpx cryptography

# 3. 写 hermes.bat 启动器
cat > "$BUILD_DIR/hermes.bat" << 'BATEOF'
@echo off
set PYTHONHOME=
set PYTHONPATH=%~dp0libs
set PYTHONIOENCODING=utf-8
set PATH=%~dp0python;%PATH%
"%~dp0python\python.exe" -m hermes_cli.main %*
BATEOF

# 4. 写构建元数据
cat > "$BUILD_DIR/.build-meta.json" << JSONEOF
{
  "platform": "windows",
  "arch": "x86_64",
  "bundled_python_version": "3.11.10",
  "hermes_version": "0.14.0",
  "build_time": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSONEOF

# 5. 打包
cd "$BUILD_DIR"
tar czf ../../hermes-win/hermes.tar.gz .
echo "Done: engines/hermes-win/hermes.tar.gz"
```

### 3.2 Windows 特有注意事项

| 问题 | 处理 |
|------|------|
| `pip --platform win_amd64` 对 C 扩展包有限制 | `cryptography`、`psutil`、`aiohttp` 的 C 扩展需要下载预编译 Windows wheel。可以用 `pip download --platform win_amd64 --only-binary=:all:` 下载 wheel 再解压到 libs/ |
| Python 路径空格处理 | `hermes.bat` 中所有路径用双引号包裹 ✅ |
| cmd 默认 GBK 编码 | `hermes.bat` 设 `PYTHONIOENCODING=utf-8` |
| 杀毒软件误报 | `hermes.bat` 无 Powershell 下载代码，纯本地调用；首版不签名 |

### 3.3 备选方案

如果交叉 `pip install --platform win_amd64` 遇到 C 扩展问题：

**方案 B**：在 Windows 虚拟机上一键构建
```powershell
# Windows 上执行
pip install hermes-agent==0.14.0 aiohttp --target=build/libs
# 后续打包步骤同上
```

---

## 四、Electron 构建配置（0.5 天）

### 4.1 package.json 添加 Windows 引擎包

```json
"extraResources": [
  { "from": "avatars", "to": "avatars" },
  { "from": "skills", "to": "skills" },
  { "from": "hermes.tar.gz", "to": "hermes.tar.gz" },           // macOS
  { "from": "../engines/hermes-win/hermes.tar.gz", "to": "hermes-win.tar.gz" }  // Windows
]
```

### 4.2 main.js 按平台选引擎包

```js
// extractBundledEngine() 中
const tarballName = isWindows ? 'hermes-win.tar.gz' : 'hermes.tar.gz';
const tarballPath = path.join(__dirname, '..', tarballName);
```

### 4.3 已就绪的代码（确认即可）

main.js 以下位置已正确处理 Windows，不需要改：

- L278: `const isWindows = process.platform === 'win32'`
- L279: `const HERMES_CMD = isWindows ? 'hermes.exe' : 'hermes'`
- L295-297: 关键文件双验证（Windows: `python.exe`）
- L311-313: tar 解压命令
- L434: `isWindows ? 'hermes.bat' : 'run.sh'`
- L1412-1420: `findHermesInVenv()` 处理 `hermes.exe` / `hermes.cmd`
- L1532: venv 中 Python 路径 `Scripts/python.exe`

---

## 五、Windows 构建 + 测试（2-3 天）

### 5.1 构建命令

```bash
cd desktop-app
npm run dist:win

# 输出：release/Hergent-1.0.0-setup.exe
```

### 5.2 真机测试清单

| # | 测试项 | 验证方式 |
|---|--------|----------|
| 1 | NSIS 安装 → 桌面快捷方式 | 安装到默认路径 + 自定义路径 |
| 2 | 首次启动 → 引擎自解压 | 检查 `%LOCALAPPDATA%/hergent/hermes-engine/` 下有正确文件 |
| 3 | Python 下载引导（引擎包未找到时） | 断网/弱网下的降级体验 |
| 4 | Gateway 启动 → 对话正常 | 发一条消息，检查流式返回 |
| 5 | CLI fallback 路径 | 关掉 Gateway，验证 spawn hermes.bat 正常工作 |
| 6 | 中文输入输出 | 输入中文消息，检查无乱码 |
| 7 | 文件拖拽上传 | 拖入 PDF/图片 |
| 8 | 积分扣减 | 发消息 → 检查余额变化 |
| 9 | 角色切换 | 切换 8 个角色，各发一条消息 |
| 10 | 技能注入 | 验证各角色对话中技能生效 |
| 11 | 杀毒软件兼容 | Windows Defender 至少不拦截 |
| 12 | 路径含空格 | 安装到 `C:\Program Files\Hergent\` 验证 |

---

## 六、Windows 独占坑位

| 坑 | 预期现象 | 对策 |
|----|----------|------|
| cmd.exe spawn 编码 | 中文变 ??? | `hermes.bat` 设 `PYTHONIOENCODING=utf-8`；main.js spawn 时 `env: { PYTHONIOENCODING: 'utf-8' }` |
| 杀毒软件误报 | EXE 下载被拦截、hermes.bat 被杀 | 首版不签名，README 加说明；等用户量上来后再买代码签名证书 |
| 长路径限制 | 引擎解压到深层嵌套目录失败 | `userData` 路径 (`%LOCALAPPDATA%`) 通常够短 |
| electron-builder NSIS 签名 | 未签名的安装器 Windows SmartScreen 会警告 | 首版接受警告，后续买 EV 代码签名证书 |
| tar 命令不存在 | Windows 10 1803 之前版本无内置 tar | 最低要求 Windows 10 1803+（2018年发布，覆盖 95%+ 用户） |
| 路径反斜杠 | spawn 用 `\` 分隔的路径可能被误解 | JS 中全部用 `path.join()`，不用字符串拼接 ✅ |

---

## 七、借 Windows 版同步做的增值项

> 这些不是 Windows 构建的前提，但可以并行做。

| 项 | 来源 | 工作量 |
|----|------|--------|
| WebBridge SKILL.md（零成本浏览器自动化） | Kimi 借鉴 | 0.5 天 |
| server.py 加 Kimi K2.6 provider | Kimi 借鉴 | 0.5 天 |
| 文件空间 Tab（本地目录索引） | QClaw 借鉴 | 1 天 |
| 社区技能 GitHub repo | QClaw 借鉴 | 0.5 天 |

---

## 八、时间线

```
Day 1-2:  归位重构（技能外置 + pairing 修复）
Day 3-4:  Windows 引擎包构建 + 调试
Day 5:    Electron 构建配置 + 首次构建尝试
Day 6-7:  Windows 真机测试 + 修坑
Day 8-10: 增值项并行开发（WebBridge、Kimi provider、文件空间）
Day 11-12: 打包、签名（临时）、发布 GitHub Release + 落地页更新
```

---

## 九、交付物

| 产物 | 说明 |
|------|------|
| `Hergent-1.0.0-setup.exe` | NSIS 安装包，x64 |
| `hermes-win.tar.gz` | Windows 引擎包（可独立用于手动安装） |
| `desktop-app/skills/` | 技能文件目录（归位重构产出） |
| `desktop-app/build-engine-win.sh` | Windows 引擎构建脚本 |
| `Hergent项目总结报告.md` | 更新版（含 Windows 版状态） |

---

## 十、不做的事

- ❌ Windows 7/8 兼容（最低 Win10 1803+）
- ❌ 32 位 Windows 支持
- ❌ Microsoft Store 上架
- ❌ Windows 代码签名证书购买（首版不签）
- ❌ Windows 自动更新（electron-updater 先做 macOS）
