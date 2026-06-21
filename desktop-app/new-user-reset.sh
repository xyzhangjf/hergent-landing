#!/bin/bash
# Hergent 模拟新用户重置脚本
# 用途: 完全清除 Hergent 所有痕迹, 模拟新用户第一次使用
# 安全: 会自动备份到桌面

echo "=== Hergent 新用户模拟重置 ==="
echo ""

BACKUP_DIR=~/Desktop/hergent-backup-$(date +%Y%m%d-%H%M%S)

# 1. 备份现有数据
echo "📦 备份现有数据到 $BACKUP_DIR ..."
mkdir -p "$BACKUP_DIR"

[ -d ~/Library/Application\ Support/hergent ] && cp -r ~/Library/Application\ Support/hergent "$BACKUP_DIR/hergent" 2>/dev/null && echo "  已备份: hergent"
[ -d ~/Library/Application\ Support/hergent-credits ] && cp -r ~/Library/Application\ Support/hergent-credits "$BACKUP_DIR/hergent-credits" 2>/dev/null && echo "  已备份: hergent-credits"
[ -d ~/.hermes ] && cp -r ~/.hermes "$BACKUP_DIR/.hermes" 2>/dev/null && echo "  已备份: .hermes"

echo ""
echo "🗑️ 清除所有 Hergent 数据..."

# 2. 删除 App
rm -rf /Applications/Hergent.app 2>/dev/null && echo "  已删除: /Applications/Hergent.app"

# 3. 删除用户数据
rm -rf ~/Library/Application\ Support/hergent 2>/dev/null && echo "  已删除: hergent"
rm -rf ~/Library/Application\ Support/hergent-credits 2>/dev/null && echo "  已删除: hergent-credits"

# 4. 删除 Hermes 引擎
rm -rf ~/.hermes/hergent-gateway 2>/dev/null && echo "  已删除: hergent-gateway"
rm -rf ~/.hermes/venv 2>/dev/null && echo "  已删除: hermes venv"
rm -rf ~/.hermes/skills 2>/dev/null && echo "  已删除: hermes skills"
rm -rf ~/.hermes/hermes-agent 2>/dev/null && echo "  已删除: hermes-agent"

# 5. 删除日志
rm -f ~/.hermes/payment.log 2>/dev/null
rm -f ~/.hermes/hergent-crash.log 2>/dev/null
rm -rf ~/Library/Caches/hergent 2>/dev/null

# 6. 清除 macOS Gatekeeper 对 app 的记录
# (让系统忘记之前打开过)

echo ""
echo "✅ 清理完成！"
echo ""
echo "📁 备份位置: $BACKUP_DIR"
echo ""
echo "恢复命令:"
echo "  cp -r $BACKUP_DIR/hergent ~/Library/Application\ Support/"
echo "  cp -r $BACKUP_DIR/hergent-credits ~/Library/Application\ Support/"
echo "  cp -r $BACKUP_DIR/.hermes ~/"
echo ""
echo "现在打开 https://hergent.cn 下载 DMG 安装即可测试"

