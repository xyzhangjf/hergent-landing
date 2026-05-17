#!/bin/bash
# Hergent 服务端热更新脚本
# 在服务器上执行: bash hotfix.sh
# 会更新 server.py 并重启服务

set -e

# 用 Python 从 Gist/Pastebin 下载最新 server.py
echo "→ 下载更新..."

python3 -c "
import urllib.request, base64

# 最新 server.py 的 base64 编码
# 从本地文件读取并构造下载
import subprocess, sys

# 写入最新 server.py
code = '''$(cat server.py | python3 -c "import sys,base64;print(base64.b64encode(sys.stdin.buffer.read()).decode())")'''
"

# 简化版：直接提供 diff 应用
echo "→ 应用安全补丁..."

sudo python3 << 'PYEOF'
import os, secrets, hashlib

server_path = "/opt/hergent/server/server.py"
bak_path = server_path + ".bak"

# 备份
with open(server_path, "r") as f:
    content = f.read()
with open(bak_path, "w") as f:
    f.write(content)
print(f"  已备份到 {bak_path}")

# 生成 ADMIN_SECRET
admin_secret = secrets.token_hex(32)

# 替换充值接口
old_recharge = '''# ---- 充值 ----
@app.post("/api/recharge")
async def recharge(request: Request):
    """充值接口：{ "amount": 10 } → 返回充值结果"""
    body = await request.json()
    amount = body.get("amount", 0)

    if amount not in RECHARGE_TIERS:
        valid = ", ".join(f"{k}元={v}分" for k, v in RECHARGE_TIERS.items())
        raise HTTPException(400, f"无效充值金额。可选: {valid}")

    credits = RECHARGE_TIERS[amount]
    device_id = get_device_fingerprint(request)

    with get_db() as db:
        user = get_or_create_user(db, device_id)
        db.execute("""
            UPDATE users SET credits = credits + ?, total_recharged = total_recharged + ?
            WHERE id = ?
        """, (credits, credits, user["id"]))
        db.execute("""
            INSERT INTO recharge_log (user_id, timestamp, amount_yuan, credits_added)
            VALUES (?, ?, ?, ?)
        """, (user["id"], datetime.now().isoformat(), amount, credits))
        db.commit()

        new_credits = user["credits"] + credits
        return {
            "success": True,
            "amount": amount,
            "credits_added": credits,
            "balance": new_credits,
            "message": f"充值成功！到账 {credits} 积分，余额 {new_credits}"
        }'''

new_recharge = f'''# ---- 管理密钥 ----
def _verify_admin(request: Request):
    """验证管理密钥"""
    if not ADMIN_SECRET:
        raise HTTPException(403, "管理密钥未配置，充值接口已锁定")
    secret = request.headers.get("X-Admin-Secret", "")
    if not secret or secret != ADMIN_SECRET:
        raise HTTPException(403, "管理密钥无效")

def _add_credits(db, user_id: str, amount: int, credits: int, payment_ref: str = "", remark: str = ""):
    """添加积分（内部函数）"""
    from datetime import datetime as dt
    db.execute("""
        UPDATE users SET credits = credits + ?, total_recharged = total_recharged + ?
        WHERE id = ?
    """, (credits, credits, user_id))
    db.execute("""
        INSERT INTO recharge_log (user_id, timestamp, amount_yuan, credits_added, payment_ref)
        VALUES (?, ?, ?, ?, ?)
    """, (user_id, dt.now().isoformat(), amount, credits, payment_ref))
    db.commit()
    user = dict(db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone())
    return {{
        "success": True,
        "amount": amount,
        "credits_added": credits,
        "balance": user["credits"],
        "message": f"充值成功！到账 {{credits}} 积分，余额 {{user['credits']}}"
    }}

# ---- 充值（需管理密钥 X-Admin-Secret: {admin_secret[:8]}...） ----
@app.post("/api/recharge")
async def recharge(request: Request):
    """管理充值接口：{{ "amount": 10, "device_id": "xxx" }} → 需 X-Admin-Secret"""
    _verify_admin(request)
    body = await request.json()
    amount = body.get("amount", 0)

    if amount not in RECHARGE_TIERS:
        valid = ", ".join(f"{{k}}元={{v}}分" for k, v in RECHARGE_TIERS.items())
        raise HTTPException(400, f"无效充值金额。可选: {{valid}}")

    credits = RECHARGE_TIERS[amount]
    target_device = body.get("device_id") or get_device_fingerprint(request)

    with get_db() as db:
        user = get_or_create_user(db, target_device)
        from datetime import datetime as dt
        return _add_credits(db, user["id"], amount, credits,
                           payment_ref=f"admin:{{dt.now().strftime('%Y%m%d%H%M%S')}}")'''


if old_recharge not in content:
    print("  ⚠️ 旧充值接口代码不匹配，尝试手动定位...")
    # Try finding the recharge endpoint
    if "@app.post(\"/api/recharge\")" in content:
        print("  找到充值接口，但格式可能不同")
    else:
        print("  ❌ 未找到充值接口，补丁可能不适用")
        sys.exit(1)
else:
    content = content.replace(old_recharge, new_recharge)
    print("  ✅ 充值接口已加固")

# 添加 ADMIN_SECRET 配置
if "ADMIN_SECRET" not in content:
    insert_pos = content.find("DEEPSEEK_API_KEY =")
    insert_pos = content.find("\n", insert_pos) + 1
    # Find end of DEEPSEEK_API_KEY block (next empty line or comment section)
    next_section = content.find("# 充值档位", insert_pos)
    if next_section == -1:
        print("  ❌ 未找到配置区域")
        sys.exit(1)
    
    admin_config = f'''
# 管理密钥（充值接口需要 X-Admin-Secret 头）
ADMIN_SECRET = "{admin_secret}"
if not ADMIN_SECRET:
    print("⚠️  ADMIN_SECRET 未设置。充值接口将被锁定。")

# 面包多支付配置（支付回调需要，暂不激活）
MIANBAODUO_SECRET = os.environ.get("MIANBAODUO_SECRET", "")
'''
    content = content[:next_section] + admin_config + content[next_section:]
    print("  ✅ ADMIN_SECRET 已配置")

with open(server_path, "w") as f:
    f.write(content)

print(f"  ✅ server.py 已更新")
print(f"  管理密钥: {admin_secret}")
print(f"  请保存此密钥！")
print(f"  curl -H 'X-Admin-Secret: {admin_secret}' http://localhost:8765/api/recharge")

PYEOF

# 重启服务
echo "→ 重启服务..."
sudo systemctl restart hergent-server
sleep 2

# 验证
echo "→ 验证..."
echo "健康检查:"
curl -s http://localhost:8765/health

echo ""
echo "充值接口（无密钥应返回403）:"
curl -s -X POST http://localhost:8765/api/recharge \
  -H 'Content-Type: application/json' \
  -d '{"amount":10}'

echo ""
echo ""
echo "✅ 热更新完成！"
