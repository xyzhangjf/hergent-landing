#!/bin/bash
# Hergent 安全热修复 — 在服务器 47.113.224.140 上执行
# 用法: bash deploy-hotfix.sh

set -e
echo "🔒 Hergent 充值安全加固"

# 1. 下载最新 server.py（从 dpaste 解码）
echo "→ 下载更新..."
python3 -c "
import json, base64, urllib.request

# 从 dpaste 获取
resp = urllib.request.urlopen('https://dpaste.com/EQWLDMSJJ.txt', timeout=15)
data = json.loads(resp.read().decode())
b64 = data['server_py_b64']

with open('/tmp/server_new.py', 'wb') as f:
    f.write(base64.b64decode(b64))
print('  下载完成')
"

# 2. 备份 + 替换
echo "→ 替换服务端..."
sudo cp /opt/hergent/server/server.py /opt/hergent/server/server.py.bak.$(date +%Y%m%d%H%M%S)
sudo cp /tmp/server_new.py /opt/hergent/server/server.py

# 3. 验证语法
python3 -c "import ast; ast.parse(open('/opt/hergent/server/server.py').read()); print('  ✅ 语法正确')"

# 4. 重启服务
echo "→ 重启服务..."
sudo systemctl restart hergent-server
sleep 2

# 5. 验证
echo ""
echo "━━━ 验证结果 ━━━"
echo -n "健康检查: "
curl -s http://localhost:8765/health
echo ""

echo -n "充值接口（无密钥→应403）: "
curl -s -X POST http://localhost:8765/api/recharge \
  -H 'Content-Type: application/json' \
  -d '{"amount":10}'
echo ""

echo -n "对话API: "
curl -s -X POST http://localhost:8765/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: test' -H 'Accept-Language: zh-CN' \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"回复OK"}],"stream":false,"max_tokens":5}' \
  --max-time 15 | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['choices'][0]['message']['content'], '| 积分:', d.get('_hermes',{}).get('credits_remaining','?'))"

echo ""
echo "✅ 热修复完成！"
echo ""
echo "管理充值命令（需替换完整 ADMIN_SECRET）："
echo "  curl -H 'X-Admin-Secret: <从 /opt/hergent/server/server.py 获取>' -X POST http://localhost:8765/api/recharge -H 'Content-Type: application/json' -d '{\"amount\":10,\"device_id\":\"XXX\"}'"
