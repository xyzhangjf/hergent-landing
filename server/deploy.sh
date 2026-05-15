#!/bin/bash
# Hergent 服务端一键部署脚本
# 用法: bash deploy.sh [--prod]
#   --prod  生产环境部署（systemd + Nginx）
#   无参数  开发/测试启动

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Hergent 积分服务 — 部署"
echo ""

# ===== 环境检查 =====
if ! command -v python3 &>/dev/null; then
    echo "❌ 需要 Python 3.10+，请先安装"
    exit 1
fi

# ===== 加载 .env =====
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "⚠️  未找到 .env，从 .env.example 复制..."
        cp .env.example .env
    fi
    if [ -z "$DEEPSEEK_API_KEY" ]; then
        echo ""
        echo "❌ 请编辑 .env 文件，填入 DEEPSEEK_API_KEY"
        echo "   vim .env"
        exit 1
    fi
fi

# 加载环境变量
set -a
source .env
set +a

# ===== 安装依赖 =====
echo "→ 安装 Python 依赖..."
python3 -m pip install -r requirements.txt -q

# ===== 生成 JWT 密钥 =====
if [ -z "$HERMES_JWT_SECRET" ]; then
    echo "→ 生成 JWT 密钥..."
    HERMES_JWT_SECRET=$(python3 -c 'import secrets;print(secrets.token_hex(32))')
    if grep -q "^HERMES_JWT_SECRET=" .env 2>/dev/null; then
        sed -i.bak "s/^HERMES_JWT_SECRET=.*/HERMES_JWT_SECRET=$HERMES_JWT_SECRET/" .env
    else
        echo "HERMES_JWT_SECRET=$HERMES_JWT_SECRET" >> .env
    fi
    echo "   JWT 密钥已写入 .env"
fi

# ===== 创建数据目录 =====
mkdir -p ~/Library/Application\ Support/hergent-credits/

# ===== 生产/开发模式分支 =====
if [ "$1" = "--prod" ]; then
    echo ""
    echo "━━━ 生产环境部署 ━━━"

    # Nginx 配置
    if command -v nginx &>/dev/null; then
        echo "→ 配置 Nginx..."
        sudo cp nginx-hergent.conf /etc/nginx/sites-available/hergent
        sudo ln -sf /etc/nginx/sites-available/hergent /etc/nginx/sites-enabled/
        sudo nginx -t && sudo systemctl reload nginx
        echo "   Nginx 配置完成"
    else
        echo "⚠️  Nginx 未安装，跳过。安装: apt install nginx"
    fi

    # SSL 证书（Let's Encrypt）
    if command -v certbot &>/dev/null && [ -n "$HERMES_BASE_URL" ]; then
        DOMAIN=$(echo "$HERMES_BASE_URL" | sed 's|https\?://||')
        echo "→ 申请 SSL 证书: $DOMAIN"
        sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email admin@${DOMAIN#*.} || echo "⚠️  SSL 证书申请失败，请手动运行"
    fi

    # systemd 服务
    echo "→ 配置 systemd 服务..."
    sudo mkdir -p /opt/hergent/server
    sudo cp server.py auth.py requirements.txt gen_activation_code.py /opt/hergent/server/
    sudo cp .env /opt/hergent/server/
    sudo cp hergent-server.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now hergent-server
    echo "   systemd 服务已启动"

    # 防火墙
    if command -v ufw &>/dev/null; then
        sudo ufw allow 80/tcp 2>/dev/null || true
        sudo ufw allow 443/tcp 2>/dev/null || true
        echo "   防火墙已配置"
    fi

    echo ""
    echo "✅ 生产环境部署完成！"
    echo ""
    echo "检查状态:"
    echo "  sudo systemctl status hergent-server"
    echo "  curl http://localhost:8765/health"

else
    echo ""
    echo "━━━ 开发/测试模式 ━━━"
    echo ""
    echo "✅ 依赖安装完成！启动方式："
    echo ""
    echo "  直接启动:"
    echo "    python3 server.py"
    echo ""
    echo "  或使用启动脚本:"
    echo "    bash start.sh"
fi
