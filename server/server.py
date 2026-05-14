"""
Hergent — 积分计费服务端
OpenAI兼容API转发 + 充值制积分管理
支持 CLI 工具增强（文件/浏览器/对账/记忆）
端口: 8765
"""

import sqlite3
import json
import os
import time
import uuid
import hashlib
import subprocess
import shutil
from datetime import datetime
from contextlib import contextmanager

import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
import uvicorn

# 认证模块
from auth import send_sms, make_jwt, verify_jwt, store_code, verify_code
from auth import get_wechat_login_url, get_wechat_user_info, WECHAT_APP_ID

# Hermes CLI 路径（工具增强引擎）
HERMES_CLI = shutil.which("hermes") or os.path.expanduser(
    "~/.hermes/hermes-agent/venv/bin/hermes")
HERMES_AVAILABLE = os.path.exists(HERMES_CLI)

# ============================================================
# 配置
# ============================================================
DB_PATH = os.path.expanduser("~/Library/Application Support/hergent-credits/credits.db")
DEEPSEEK_BASE = "https://api.deepseek.com"
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
if not DEEPSEEK_API_KEY:
    print("⚠️  DEEPSEEK_API_KEY 未设置。API 代理功能禁用，仅 hermes CLI 模式可用。")

# 充值档位: {金额(元): 积分}
RECHARGE_TIERS = {
    10: 1000,
    30: 3000,
    50: 5500,   # 送500
}

# 新用户赠送积分（总额，不限时）
WELCOME_CREDITS = 200

# DeepSeek 实际定价 (元/百万token)
PRICING = {
    "deepseek-chat":     {"input": 1.0, "output": 2.0},
    "deepseek-reasoner": {"input": 4.0, "output": 16.0},
    "deepseek-v3":       {"input": 1.0, "output": 2.0},
}

# 积分消耗倍数（含毛利）
CREDIT_MULTIPLIER = 1.5  # 用户消耗 = API实际成本 × 1.5

# ============================================================
# 数据库
# ============================================================
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                device_id TEXT UNIQUE NOT NULL,
                phone TEXT DEFAULT NULL,        -- 手机号（登录后绑定）
                wechat_openid TEXT DEFAULT NULL, -- 微信 openid（微信登录绑定）
                nickname TEXT DEFAULT NULL,      -- 昵称
                avatar_url TEXT DEFAULT NULL,    -- 头像
                credits INTEGER NOT NULL DEFAULT 0,
                total_used INTEGER NOT NULL DEFAULT 0,
                total_recharged INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                last_active TEXT
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                token TEXT UNIQUE NOT NULL,       -- JWT token
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS recharge_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                amount_yuan INTEGER NOT NULL,  -- 充值金额(元)
                credits_added INTEGER NOT NULL,  -- 到账积分
                payment_ref TEXT  -- 支付流水号
            );

            CREATE TABLE IF NOT EXISTS usage_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                model TEXT NOT NULL,
                prompt_tokens INTEGER DEFAULT 0,
                completion_tokens INTEGER DEFAULT 0,
                cost_fen INTEGER DEFAULT 0,  -- API费用(分)
                credits_deducted INTEGER DEFAULT 0  -- 扣除积分
            );

            CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_log(user_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_recharge_user ON recharge_log(user_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
            CREATE INDEX IF NOT EXISTS idx_users_wechat ON users(wechat_openid);
            CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
        """)
        db.commit()

# ============================================================
# 设备指纹
# ============================================================
def get_device_fingerprint(request: Request) -> str:
    """从请求头提取设备指纹"""
    ua = request.headers.get("User-Agent", "")
    lang = request.headers.get("Accept-Language", "")
    raw = f"{ua}|{lang}"
    return hashlib.md5(raw.encode()).hexdigest()[:16]

# ============================================================
# 用户管理
# ============================================================
def get_or_create_user(db, device_id: str) -> dict:
    """获取或创建用户（首次自动送200积分）"""
    cur = db.execute("SELECT * FROM users WHERE device_id=?", (device_id,))
    row = cur.fetchone()
    if row:
        # 更新最后活跃时间
        db.execute("UPDATE users SET last_active=? WHERE id=?", (datetime.now().isoformat(), row["id"]))
        db.commit()
        return dict(row)

    # 新用户：送200积分
    uid = uuid.uuid4().hex[:16]
    now = datetime.now().isoformat()
    db.execute("""
        INSERT INTO users (id, device_id, credits, total_used, total_recharged, created_at, last_active)
        VALUES (?, ?, ?, 0, 0, ?, ?)
    """, (uid, device_id, WELCOME_CREDITS, now, now))
    db.commit()
    return {"id": uid, "device_id": device_id, "credits": WELCOME_CREDITS,
            "total_used": 0, "total_recharged": 0, "created_at": now, "last_active": now}

# ============================================================
# 积分计算
# ============================================================
def calculate_credits(model: str, prompt_tokens: int, completion_tokens: int) -> int:
    """计算积分消耗（API成本 × 倍数，向上取整）"""
    pricing = PRICING.get(model, PRICING["deepseek-chat"])
    cost_yuan = (prompt_tokens / 1_000_000) * pricing["input"] + \
                (completion_tokens / 1_000_000) * pricing["output"]
    cost_fen = cost_yuan * 100  # API实际成本(分)
    credits = int(cost_fen * CREDIT_MULTIPLIER + 0.9999)
    return max(1, credits)  # 最低1积分

# ============================================================
# FastAPI 应用
# ============================================================
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Hergent - 积分服务", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

http_client = httpx.AsyncClient(timeout=120.0)

# ============================================================
# Hermes CLI 调用（工具增强路径）
# ============================================================
import asyncio as _asyncio

async def call_hermes_chat(user_message: str, system_prompt: str = "") -> str:
    """调用 hermes CLI 获取工具增强回复"""
    prompt = user_message
    if system_prompt:
        prompt = f"{system_prompt}\n\n{user_message}"
    
    try:
        proc = await _asyncio.create_subprocess_exec(
            HERMES_CLI, "chat", "-q", prompt, "-Q", "--max-turns", "30",
            stdout=_asyncio.subprocess.PIPE,
            stderr=_asyncio.subprocess.PIPE
        )
        stdout, stderr = await _asyncio.wait_for(proc.communicate(), timeout=300)
        
        if proc.returncode != 0:
            err = stderr.decode()[:300] if stderr else "未知错误"
            raise RuntimeError(f"Hermes CLI 退出码 {proc.returncode}: {err}")
        
        output = stdout.decode().strip()
        # 跳过 session_id 行，返回所有剩余行
        lines = output.split("\n")
        response_lines = [l for l in lines if not l.startswith("session_id:")]
        return "\n".join(response_lines)
    except _asyncio.TimeoutError:
        raise HTTPException(504, "Hermes 处理超时")
    except FileNotFoundError:
        raise HTTPException(500, "Hermes CLI 未安装")

@app.on_event("startup")
async def startup():
    init_db()
    print("✅ 积分服务启动 — 端口 8765")

@app.on_event("shutdown")
async def shutdown():
    await http_client.aclose()

# ---- 积分查询 ----
@app.get("/api/credits")
async def get_credits(request: Request):
    device_id = get_device_fingerprint(request)
    with get_db() as db:
        user = get_or_create_user(db, device_id)
        return {
            "credits": user["credits"],
            "total_used": user["total_used"],
            "total_recharged": user["total_recharged"],
            "is_new": user["total_recharged"] == 0 and user["total_used"] == 0,
            "message": f"余额 {user['credits']} 积分" if user["credits"] > 0 else "积分已用完，请充值"
        }

# ---- 积分扣减（本地Hermes CLI调用后扣费）----
@app.post("/api/credits/deduct")
async def deduct_credits(request: Request):
    """扣减积分：{ "credits": 5 } → 从用户余额扣除"""
    body = await request.json()
    credits = body.get("credits", 0)
    if credits <= 0:
        raise HTTPException(400, "扣减积分数必须大于0")

    device_id = get_device_fingerprint(request)
    with get_db() as db:
        user = get_or_create_user(db, device_id)

        if user["credits"] < credits:
            raise HTTPException(402, {
                "error": "积分不足",
                "credits": user["credits"],
                "needed": credits,
                "message": f"需要 {credits} 积分，余额 {user['credits']}"
            })

        db.execute("UPDATE users SET credits = credits - ?, total_used = total_used + ? WHERE id = ?",
                  (credits, credits, user["id"]))
        db.execute("""
            INSERT INTO usage_log (user_id, timestamp, model, prompt_tokens, completion_tokens, credits_deducted)
            VALUES (?, ?, ?, 0, 0, ?)
        """, (user["id"], datetime.now().isoformat(), body.get("model", "hermes"), credits))
        db.commit()

        new_balance = user["credits"] - credits
        return {"success": True, "credits_remaining": new_balance, "credits_used": credits}

# ---- 充值 ----
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
        }

# ---- 充值档位查询（App 展示用）----
@app.get("/api/recharge/tiers")
async def get_tiers():
    return {
        "tiers": [{"amount_yuan": k, "credits": v} for k, v in RECHARGE_TIERS.items()],
        "welcome_credits": WELCOME_CREDITS
    }

# ---- OpenAI兼容代理 ----
@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    if not (DEEPSEEK_API_KEY or HERMES_AVAILABLE):
        raise HTTPException(500, "API Key 未配置且 Hermes CLI 未安装")

    device_id = get_device_fingerprint(request)

    with get_db() as db:
        user = get_or_create_user(db, device_id)
        if user["credits"] <= 0:
            raise HTTPException(402, {
                "error": "积分不足",
                "credits": 0,
                "message": "积分已用完，请充值（10元起）"
            })

        body = await request.json()

        # 优先走 Hermes CLI（工具增强），降级到直调 DeepSeek
        if HERMES_AVAILABLE:
            messages = body.get("messages", [])
            system_prompt = ""
            user_msgs = []
            for m in messages:
                if m.get("role") == "system":
                    system_prompt = m.get("content", "")
                elif m.get("role") == "user":
                    user_msgs.append(m.get("content", ""))
            user_message = "\n".join(user_msgs)
            
            CREDITS_PER_HERMES_CALL = 3
            if user["credits"] < CREDITS_PER_HERMES_CALL:
                raise HTTPException(402, {
                    "error": "积分不足",
                    "credits": user["credits"],
                    "needed": CREDITS_PER_HERMES_CALL,
                    "message": f"Hermes 需要 {CREDITS_PER_HERMES_CALL} 积分，余额 {user['credits']}"
                })
            
            try:
                response_text = await call_hermes_chat(user_message, system_prompt)
            except HTTPException:
                raise
            except Exception:
                # Hermes 失败，降级到 DeepSeek 直调
                pass
            else:
                # Hermes 成功
                db.execute("UPDATE users SET credits = credits - ?, total_used = total_used + ? WHERE id = ?",
                      (CREDITS_PER_HERMES_CALL, CREDITS_PER_HERMES_CALL, user["id"]))
                db.execute("""
                    INSERT INTO usage_log (user_id, timestamp, model, prompt_tokens, completion_tokens, credits_deducted, cost_fen)
                    VALUES (?, ?, 'hermes-cli', 0, 0, ?, 0)
                """, (user["id"], datetime.now().isoformat(), CREDITS_PER_HERMES_CALL))
                db.commit()
            
                new_balance = user["credits"] - CREDITS_PER_HERMES_CALL
            
                if body.get("stream", False):
                    async def stream_hermes():
                        import json as _json
                        yield f"data: {_json.dumps({'choices': [{'delta': {'content': response_text}}]})}\n\n"
                        yield "data: [DONE]\n\n"
                    return StreamingResponse(stream_hermes(), media_type="text/event-stream")
                else:
                    import json as _json2
                    return JSONResponse({
                        "choices": [{"message": {"role": "assistant", "content": response_text}}],
                        "_hermes": {"credits_remaining": new_balance, "credits_used": CREDITS_PER_HERMES_CALL}
                    })

        model = body.get("model", "deepseek-chat")
        stream = body.get("stream", False)

        headers = {
            "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
            "Content-Type": "application/json"
        }

        if stream:
            # 流式转发
            async def stream_proxy():
                total_prompt = 0
                total_completion = 0
                async with httpx.AsyncClient(timeout=120.0) as client:
                    async with client.stream("POST", f"{DEEPSEEK_BASE}/v1/chat/completions",
                                              json=body, headers=headers) as resp:
                        if resp.status_code != 200:
                            err = await resp.aread()
                            yield err
                            return
                        async for chunk in resp.aiter_bytes():
                            yield chunk
                            try:
                                text = chunk.decode()
                                if '"usage"' in text:
                                    for line in text.split("\n"):
                                        if line.startswith("data: ") and '"usage"' in line:
                                            data = json.loads(line[6:])
                                            usage = data.get("usage", {})
                                            total_prompt = usage.get("prompt_tokens", 0)
                                            total_completion = usage.get("completion_tokens", 0)
                            except:
                                pass

                # 流结束后扣费
                if total_prompt or total_completion:
                    credits = calculate_credits(model, total_prompt, total_completion)
                    with get_db() as db2:
                        db2.execute("UPDATE users SET credits = MAX(0, credits - ?), total_used = total_used + ? WHERE id = ?",
                                   (credits, credits, user["id"]))
                        db2.execute("""
                            INSERT INTO usage_log (user_id, timestamp, model, prompt_tokens, completion_tokens, credits_deducted)
                            VALUES (?, ?, ?, ?, ?, ?)
                        """, (user["id"], datetime.now().isoformat(), model, total_prompt, total_completion, credits))
                        db2.commit()

            return StreamingResponse(stream_proxy(), media_type="text/event-stream")

        else:
            # 非流式
            resp = await http_client.post(f"{DEEPSEEK_BASE}/v1/chat/completions",
                                           json=body, headers=headers)
            if resp.status_code != 200:
                raise HTTPException(resp.status_code, detail=resp.text[:500])

            result = resp.json()
            usage = result.get("usage", {})
            prompt_tokens = usage.get("prompt_tokens", 0)
            completion_tokens = usage.get("completion_tokens", 0)

            credits = calculate_credits(model, prompt_tokens, completion_tokens)

            if user["credits"] < credits:
                raise HTTPException(402, {
                    "error": "积分不足",
                    "credits": user["credits"],
                    "needed": credits,
                    "message": f"本次需要 {credits} 积分，余额 {user['credits']}"
                })

            db.execute("UPDATE users SET credits = credits - ?, total_used = total_used + ? WHERE id = ?",
                      (credits, credits, user["id"]))
            db.execute("""
                INSERT INTO usage_log (user_id, timestamp, model, prompt_tokens, completion_tokens, credits_deducted)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (user["id"], datetime.now().isoformat(), model, prompt_tokens, completion_tokens, credits))
            db.commit()

            new_balance = user["credits"] - credits
            result["_hermes"] = {"credits_remaining": new_balance, "credits_used": credits}
            return JSONResponse(result)

# ---- 健康检查 ----
@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}


# ============================================================
# 认证 API
# ============================================================

def get_user_from_token(request: Request) -> dict | None:
    """从请求头 X-Hermes-Token 中获取用户"""
    token = request.headers.get("X-Hermes-Token") or request.headers.get("Authorization", "").removeprefix("Bearer ")
    if not token:
        return None
    payload = verify_jwt(token)
    if not payload:
        return None
    # 校验 session 表中 token 存在
    with get_db() as db:
        row = db.execute("SELECT user_id FROM sessions WHERE token=? AND expires_at > ?",
                        (token, datetime.now().isoformat())).fetchone()
        if not row:
            return None
        user = db.execute("SELECT * FROM users WHERE id=?", (payload["uid"],)).fetchone()
        return dict(user) if user else None


# ---- 发送短信验证码 ----
@app.post("/api/auth/send-code")
async def auth_send_code(request: Request):
    """发送短信验证码：{ "phone": "13800138000" }"""
    body = await request.json()
    phone = body.get("phone", "").strip()

    # 简单校验手机号
    if not phone or not phone.isdigit() or len(phone) != 11:
        raise HTTPException(400, "请输入正确的11位手机号")

    # 生成并存储验证码
    code = store_code(phone)

    # 发送短信
    ok = send_sms(phone, code)
    if not ok:
        raise HTTPException(500, "短信发送失败，请稍后重试")

    return {"success": True, "message": "验证码已发送"}


# ---- 短信验证码登录 ----
@app.post("/api/auth/verify-code")
async def auth_verify_code(request: Request):
    """验证码登录：{ "phone": "13800138000", "code": "123456" }"""
    body = await request.json()
    phone = body.get("phone", "").strip()
    code = body.get("code", "").strip()

    if not verify_code(phone, code):
        raise HTTPException(400, "验证码错误或已过期")

    device_id = get_device_fingerprint(request)

    with get_db() as db:
        # 查找或创建用户
        cur = db.execute("SELECT * FROM users WHERE phone=?", (phone,))
        user = cur.fetchone()

        if user:
            # 已有用户：绑定设备
            uid = user["id"]
            db.execute("UPDATE users SET device_id=?, last_active=?, nickname=COALESCE(nickname, ?) WHERE id=?",
                      (device_id, datetime.now().isoformat(), f"用户{phone[-4:]}", uid))
        else:
            # 新用户：创建并送200积分
            uid = uuid.uuid4().hex[:16]
            now = datetime.now().isoformat()
            db.execute("""
                INSERT INTO users (id, device_id, phone, nickname, credits, total_used, total_recharged, created_at, last_active)
                VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
            """, (uid, device_id, phone, f"用户{phone[-4:]}", WELCOME_CREDITS, now, now))

        db.commit()

        # 重新查用户
        user = dict(db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone())

    # 生成 JWT
    token = make_jwt({"uid": user["id"], "phone": phone})

    # 存 session
    with get_db() as db:
        now = datetime.now().isoformat()
        expires = (datetime.now() + timedelta(days=30)).isoformat()
        db.execute("INSERT INTO sessions (user_id, token, created_at, expires_at) VALUES (?, ?, ?, ?)",
                  (user["id"], token, now, expires))
        db.commit()

    return {
        "success": True,
        "token": token,
        "user": {
            "id": user["id"],
            "phone": user.get("phone"),
            "nickname": user.get("nickname"),
            "avatar_url": user.get("avatar_url"),
            "credits": user["credits"],
            "is_new": user["total_recharged"] == 0 and user["total_used"] == 0,
        }
    }


# ---- 微信登录：获取扫码 URL ----
@app.get("/api/auth/wechat/login-url")
async def auth_wechat_url():
    """获取微信扫码登录 URL"""
    url = get_wechat_login_url()
    if not url:
        raise HTTPException(400, "微信登录暂未配置（需要微信开放平台账号）")
    return {"url": url}


# ---- 微信 OAuth 回调 ----
@app.get("/api/auth/wechat/callback")
async def auth_wechat_callback(code: str, state: str = ""):
    """微信 OAuth 回调，用 code 换取用户信息并登录"""
    user_info = get_wechat_user_info(code)
    if not user_info:
        raise HTTPException(400, "微信登录失败，请重试")

    openid = user_info["openid"]

    with get_db() as db:
        cur = db.execute("SELECT * FROM users WHERE wechat_openid=?", (openid,))
        user = cur.fetchone()

        if user:
            uid = user["id"]
            db.execute("UPDATE users SET last_active=?, nickname=COALESCE(nickname, ?), avatar_url=COALESCE(avatar_url, ?) WHERE id=?",
                      (datetime.now().isoformat(), user_info.get("nickname"), user_info.get("avatar"), uid))
        else:
            uid = uuid.uuid4().hex[:16]
            now = datetime.now().isoformat()
            db.execute("""
                INSERT INTO users (id, device_id, wechat_openid, nickname, avatar_url, credits, total_used, total_recharged, created_at, last_active)
                VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
            """, (uid, uid, openid, user_info.get("nickname"), user_info.get("avatar"), WELCOME_CREDITS, now, now))

        db.commit()
        user = dict(db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone())

    # 生成 JWT
    token = make_jwt({"uid": user["id"], "wechat_openid": openid})

    # 存 session
    with get_db() as db:
        now = datetime.now().isoformat()
        expires = (datetime.now() + timedelta(days=30)).isoformat()
        db.execute("INSERT INTO sessions (user_id, token, created_at, expires_at) VALUES (?, ?, ?, ?)",
                  (user["id"], token, now, expires))
        db.commit()

    # 返回重定向页面（微信扫码后关闭）
    from fastapi.responses import HTMLResponse
    return HTMLResponse(f"""
    <html><head><meta charset="utf-8"><title>登录成功</title>
    <style>body{{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5}}
    .card{{background:#fff;border-radius:20px;padding:48px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08)}}
    h2{{margin:0 0 8px;color:#333}}p{{color:#999;font-size:14px}}</style></head>
    <body><div class="card"><h2>✅ 登录成功</h2><p>请回到 Hergent 应用</p></div>
    <script>window.opener?.postMessage({{type:'wechat_login',token:'{token}'}},'*');</script></body></html>
    """)


# ---- 获取当前用户信息 ----
@app.get("/api/auth/me")
async def auth_me(request: Request):
    """获取当前登录用户信息"""
    user = get_user_from_token(request)
    if not user:
        raise HTTPException(401, "请先登录")

    return {
        "id": user["id"],
        "phone": user.get("phone"),
        "nickname": user.get("nickname"),
        "avatar_url": user.get("avatar_url"),
        "credits": user["credits"],
        "total_used": user["total_used"],
        "total_recharged": user["total_recharged"],
    }


# ---- 登出 ----
@app.post("/api/auth/logout")
async def auth_logout(request: Request):
    """登出，删除 session"""
    token = request.headers.get("X-Hermes-Token") or request.headers.get("Authorization", "").removeprefix("Bearer ")
    if token:
        with get_db() as db:
            db.execute("DELETE FROM sessions WHERE token=?", (token,))
            db.commit()
    return {"success": True}


# ============================================================
# 启动
# ============================================================
if __name__ == "__main__":
    import sys, os
    host = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("HERMES_HOST", "127.0.0.1")
    port = int(os.environ.get("HERMES_PORT", "8765"))
    uvicorn.run(app, host=host, port=port, log_level="info")
