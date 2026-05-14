#!/bin/bash
# Hergent — 积分服务启动脚本
# 用法: bash start.sh

cd "$(dirname "$0")"

# 加载 .env 文件
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# 检查 DeepSeek API Key
if [ -z "$DEEPSEEK_API_KEY" ]; then
    echo "⚠️  未设置 DEEPSEEK_API_KEY"
    echo "   请创建 .env 文件或设置环境变量"
    echo "   cp .env.example .env && vim .env"
    echo ""
    echo "   暂以仅 CLI 模式启动..."
fi

echo "🚀 启动积分服务 (端口 8765)..."
python3 server.py
