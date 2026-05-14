#!/bin/bash
# Hergent 启动脚本（macOS 26.3 兼容方案）
# 用旧版 Electron Framework + 当前最新代码

OLD_APP="/Users/zhangjunfeng/Documents/laozhangai-product/release/mac-arm64/Hermes AI.app"
TMP_APP="/tmp/Hergent-latest.app"

# 1. 复制旧版能跑的框架
cp -r "$OLD_APP" "$TMP_APP"
rm -f "$TMP_APP/Contents/Resources/app.asar"*

# 2. 打包最新代码
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# 复制预设头像到 Resources/avatars/
mkdir -p "$TMP_APP/Contents/Resources/avatars"
cp "$SCRIPT_DIR"/avatars/*.png "$TMP_APP/Contents/Resources/avatars/" 2>/dev/null

PKG_DIR="/tmp/her-pkg-latest"
rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR/js"
cp "$SCRIPT_DIR"/main.js "$SCRIPT_DIR"/preload.js "$SCRIPT_DIR"/index.html "$SCRIPT_DIR"/styles.css "$SCRIPT_DIR"/package.json "$PKG_DIR/"
cp "$SCRIPT_DIR"/icon.png "$SCRIPT_DIR"/tray-icon.png "$PKG_DIR/" 2>/dev/null
cp "$SCRIPT_DIR"/js/config.js "$SCRIPT_DIR"/js/app.js "$PKG_DIR/js/"

cd "$PKG_DIR"
npx asar pack . "$TMP_APP/Contents/Resources/app.asar" 2>/dev/null

# 3. 更新应用名
plutil -replace CFBundleName -string "Hergent" "$TMP_APP/Contents/Info.plist" 2>/dev/null
plutil -replace CFBundleDisplayName -string "Hergent" "$TMP_APP/Contents/Info.plist" 2>/dev/null

# 4. 启动
xattr -cr "$TMP_APP"
open "$TMP_APP"
echo "Hergent 已启动"
