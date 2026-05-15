#!/bin/bash
# Hergent 服务端一键部署脚本
# 用法: bash deploy.sh

set -e

echo "🚀 Hergent 积分服务 — 部署"
echo ""

# 检查 Python
if ! command -v python3 &>/dev/null; then
    echo "❌ 需要 Python 3.10+，请先安装"
    exit 1
fi

# 检查 .env
if [ ! -f .env ]; then
    if [ -z "$DEEPSEEK_API_KEY" ]; then
        echo "❌ 请先创建 .env 文件或设置 DEEPSEEK_API_KEY 环境变量"
        echo "   cp .env.example .env && vim .env"
        exit 1
    fi
fi

# 安装依赖
echo "→ 安装 Python 依赖..."
python3 -m pip install -r requirements.txt -q

# 生成 JWT 密钥（如未设置）
if ! grep -q "HERMES_JWT_SECRET" .env 2>/dev/null && [ -z "$HERMES_JWT_SECRET" ]; then
    echo "→ 生成 JWT 密钥..."
    echo "HERMES_JWT_SECRET=$(python3 -c 'import secrets;print(secrets.token_hex(32))')" >> .env
fi

# 创建数据目录
mkdir -p ~/Library/Application\ Support/hergent-credits/

# 启动服务
echo ""
echo "✅ 部署完成！启动方式："
echo ""
echo "  开发/测试:"
echo "    python3 server.py"
echo ""
echo "  生产环境 (systemd):"
echo "    sudo cp Hergent-server.service /etc/systemd/system/"
echo "    sudo systemctl enable --now Hergent-server"
echo ""
echo "  生产环境 (screen/tmux):"
echo "    screen -S Hergent"
echo "    python3 server.py"
