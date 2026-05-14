#!/bin/bash
# ================================================
# Hergent 安装器
# 一键安装 Hergent + 配置环境
# ================================================

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCES="$DIR/../Resources"

function gui_msg() {
  osascript -e "display dialog \"$1\" buttons {\"$2\"} default button 1 with title \"Hergent 安装器\" with icon note" 2>/dev/null || true
}

function gui_input() {
  osascript -e "display dialog \"$1\" default answer \"\" with title \"Hergent 安装器\" with icon note" 2>/dev/null | sed 's/.*text returned://'
}

function gui_error() {
  osascript -e "display dialog \"$1\" buttons {\"知道了\"} default button 1 with title \"Hergent - 错误\" with icon stop" 2>/dev/null || true
}

# --- 欢迎 ---
gui_msg "欢迎安装 Hergent · 你的数字员工\n\n本安装器将自动完成以下步骤：\n1. 安装运行环境\n2. 配置 Hergent\n3. 开始使用\n\n预计时间：1-3分钟" "开始安装"

# --- 检查 Python ---
if ! command -v python3 &>/dev/null; then
  gui_error "未检测到 Python3，请先安装 Python\nhttps://www.python.org/downloads/"
  exit 1
fi

# --- 安装 pip 依赖 ---
if [ -f "$RESOURCES/requirements.txt" ]; then
  pip3 install -r "$RESOURCES/requirements.txt" 2>&1 | tail -3
fi

# --- 完成 ---
gui_msg "安装完成！\n\nHergent 已成功安装到你的电脑\n\n打开 Hergent.app 即可开始使用" "打开应用"

if [ -d "/Applications/Hergent.app" ]; then
  open "/Applications/Hergent.app"
fi

exit 0
