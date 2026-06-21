# Hergent Alpha 测试计划

> 目标：用一台 Mac 和一台 Windows 笔记本，把安装→打开→对话→扣分→充值→Hermes 原生能力完整跑通。

---

## 一、启动方式

不要用 `npx electron .`（Claude 环境有 ELECTRON_RUN_AS_NODE 冲突）。

```bash
cd /Users/zhangjunfeng/Documents/laozhangai-product/desktop-app
./start.sh
```

或手动：
```bash
env -u ELECTRON_RUN_AS_NODE npx electron .
```

---

## 二、当前状态（测前确认）

| 模块 | 状态 | 说明 |
|------|------|------|
| 登录 | DEV跳过 | 启动直接进主界面，不需要短信验证 |
| 积分系统 | 可用 | server.py 自动启动，积分扣减走本地 |
| 充值 | DEV模式 | 选金额→确认→扫码页→点「一键充值（测试）」到账 |
| 角色切换 | 可用 | 大秘/会计/程序员/作家/编剧/私教/健康顾问/投资顾问 |
| 文件上传 | 可用 | 支持拖拽和点击上传 |
| Hermes引擎 | 首次安装 | 第一次打开有引导安装流程 |
| 对话历史 | 可用 | 关闭重开后恢复 |

### 打包版本

| 平台 | 文件 | 路径 |
|------|------|------|
| macOS | Hergent-1.0.75-mac-arm64.dmg | release/ |
| Windows | Hergent-1.0.75-setup.exe | release/ |

---

## 三、Mac 测试（本文电脑）

### 准备：模拟新用户

```bash
# 备份现有数据（不要删！）
cp -r ~/Library/Application\ Support/hergent ~/Desktop/hergent-backup-$(date +%Y%m%d) 2>/dev/null
cp -r ~/Library/Application\ Support/hergent-credits ~/Desktop/hergent-credits-backup-$(date +%Y%m%d) 2>/dev/null

# 清空数据（新用户状态）
rm -rf ~/Library/Application\ Support/hergent
rm -rf ~/Library/Application\ Support/hergent-credits
rm -rf ~/.hermes/hergent-gateway 2>/dev/null
```

测试完想恢复：
```bash
cp -r ~/Desktop/hergent-backup-* ~/Library/Application\ Support/hergent
cp -r ~/Desktop/hergent-credits-backup-* ~/Library/Application\ Support/hergent-credits
```

### 测试清单

| # | 测试项 | 操作 | 预期结果 |
|---|--------|------|---------|
| 1 | 安装 | 打开 DMG → 拖到 Applications | 正常复制 |
| 2 | 首次启动 | 双击 Hergent.app | 出现引导安装界面（Hermes引擎安装） |
| 3 | 引擎安装 | 等进度条走完 | 安装成功，自动进入主界面 |
| 4 | 主界面 | 看侧边栏 | 角色列表完整显示，红绿灯正常 |
| 5 | 对话-大秘 | 输入"你好，帮我写一份周报模板" | AI回复，积分扣减显示在标题栏 |
| 6 | 对话-会计 | 切换到会计，问"帮我对一下这个月收支" | 正确切换，对话独立不混淆 |
| 7 | 上传文件 | 上传一个 PDF 或 Excel | 文件显示在输入栏上方，AI 能读取内容 |
| 8 | 历史恢复 | 关闭 App → 重新打开 | 之前的对话还在，角色状态不变 |
| 9 | 充值-选择 | 点击标题栏积分 → 选 10 元 → 确认 | 进入二维码页面 |
| 10 | 充值-到账 | 点「一键充值（测试）」 | 显示"充值成功！到账 1,000 积分"，积分增加 |
| 11 | 充值后对话 | 再发一条消息 | 积分继续正常扣减 |
| 12 | 定时任务 | 侧边栏→定时任务→新建 | 创建成功，列表显示 |
| 13 | 我的成果 | 侧边栏→我的成果 | 页面正常加载 |
| 14 | 浅色/深色 | 设置→切换主题 | 界面正常切换 |
| 15 | 连接手机 | 侧边栏→连接手机 | 卡片正常显示 |

---

## 四、Windows 测试（Windows 10 笔记本）

### 准备
1. 把 `Hergent-1.0.75-setup.exe` 复制到 Windows 笔记本（U盘或局域网共享）
2. 安装 → 打开

### Windows 特别注意
- 首次启动先确认 Hermes 引擎安装（Windows 需要额外 Python 环境）
- 测试项目同 Mac 清单 #1-#15
- 观察 Windows 下 UI 是否正常（字体、间距、窗口圆角）

---

## 五、测完后的数据恢复

```bash
# 先关闭 App
# 恢复 Mac 数据
rm -rf ~/Library/Application\ Support/hergent
cp -r ~/Desktop/hergent-backup-* ~/Library/Application\ Support/hergent
```

---

## 六、已知可能的问题

| 问题 | 现象 | 排查方式 |
|------|------|---------|
| server.py 没启动 | 发消息报错、积分不显示 | `curl localhost:8765/api/credits` 看是否响应 |
| 引擎安装失败 | 引导页卡住或报错 | 看终端日志，hermes.tar.gz 是否解压成功 |
| 充值卡在"创建订单中" | 按钮一直转圈 | `tail -f ~/.hermes/payment.log` 看错误 |
| Windows 打不开 | 双击没反应 | 右键→以管理员身份运行 |

---

## 七、测完后的下一步

- [ ] 修复测出来的 bug
- [ ] 打包 v1.0.76
- [ ] 提交给 2-3 个朋友使用
- [ ] 收集反馈，决定下一步改进方向
