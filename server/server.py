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

# 管理密钥（用于充值接口验证）
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "")
_USER_HERMES_JWT_SECRET = os.environ.get("HERMES_JWT_SECRET", "")
if not ADMIN_SECRET and _USER_HERMES_JWT_SECRET:
    # 如果没单独配 ADMIN_SECRET，用 JWT_SECRET 作为管理密钥
    ADMIN_SECRET = _USER_HERMES_JWT_SECRET
if not ADMIN_SECRET:
    print("⚠️  ADMIN_SECRET 未设置。充值接口将被锁定，仅支付回调可用。")

# 面包多配置（支付回调需要）
MIANBAODUO_SECRET = os.environ.get("MIANBAODUO_SECRET", "")  # 面包多 webhook secret key

# 充值档位: {金额(元): 积分}
RECHARGE_TIERS = {
    10: 1000,
    30: 3000,
    50: 5500,   # 送500
}

# 新用户赠送积分（总额，不限时）
WELCOME_CREDITS = 2000

# DeepSeek 实际定价 (元/百万token)
PRICING = {
    "deepseek-chat":     {"input": 1.0, "output": 2.0},
    "deepseek-reasoner": {"input": 4.0, "output": 16.0},
    "deepseek-v3":       {"input": 1.0, "output": 2.0},
}

# 积分消耗倍数（含毛利）
# Hermes agent 每次用户消息会调用多次模型(思考→工具→处理→回复)，
# 加上系统提示词注入所有技能描述(~17,500 tokens)，单轮API成本约1.79分。
# 1.2x = 每用户消息约扣9积分，利润率约40%
CREDIT_MULTIPLIER = 1.2

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
    """从请求参数或请求头提取设备指纹。
    优先级：query param > X-Device-ID header > Authorization Bearer > UA 指纹
    """
    # 显式 device_id（客户端传递）
    device_id = request.query_params.get("device_id") or request.headers.get("X-Device-ID")
    if device_id:
        return device_id[:32]

    # Hermes CLI 客户端：从 Authorization header 提取 device_id
    # 客户端设置 api_key = "hermes_<device_id>"，服务端反向解析
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer hermes_"):
        return auth[len("Bearer hermes_"):]

    # 回退：UA 指纹
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
        raise HTTPException(status_code=504, detail="Hermes 处理超时")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Hermes CLI 未安装")

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

# ---- 用量明细 ----
@app.get("/api/usage/history")
async def usage_history(request: Request, limit: int = 20):
    """查询用户近期用量：GET /api/usage/history?limit=20"""
    device_id = get_device_fingerprint(request)
    with get_db() as db:
        user = db.execute("SELECT id, credits FROM users WHERE device_id=?", (device_id,)).fetchone()
        if not user:
            return {"records": [], "balance": 0}
        
        rows = db.execute("""
            SELECT timestamp, model, prompt_tokens, completion_tokens, credits_deducted
            FROM usage_log WHERE user_id=? ORDER BY id DESC LIMIT ?
        """, (user["id"], min(limit, 100))).fetchall()
        
        records = []
        for r in rows:
            records.append({
                "time": r["timestamp"],
                "model": r["model"],
                "prompt_tokens": r["prompt_tokens"],
                "completion_tokens": r["completion_tokens"],
                "credits": r["credits_deducted"]
            })
        
        return {"records": records, "balance": user["credits"]}

# ---- 充值（需管理密钥） ----
def _verify_admin(request: Request):
    """验证管理密钥"""
    if not ADMIN_SECRET:
        raise HTTPException(403, "管理密钥未配置，充值接口已锁定")
    secret = request.headers.get("X-Admin-Secret", "")
    if not secret or secret != ADMIN_SECRET:
        raise HTTPException(403, "管理密钥无效")

def _add_credits(db, user_id: str, amount: int, credits: int, payment_ref: str = "", remark: str = ""):
    """添加积分（内部函数，充值和管理操作共用）"""
    db.execute("""
        UPDATE users SET credits = credits + ?, total_recharged = total_recharged + ?
        WHERE id = ?
    """, (credits, credits, user_id))
    db.execute("""
        INSERT INTO recharge_log (user_id, timestamp, amount_yuan, credits_added, payment_ref)
        VALUES (?, ?, ?, ?, ?)
    """, (user_id, datetime.now().isoformat(), amount, credits, payment_ref))
    db.commit()
    user = dict(db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone())
    return {
        "success": True,
        "amount": amount,
        "credits_added": credits,
        "balance": user["credits"],
        "message": f"充值成功！到账 {credits} 积分，余额 {user['credits']}"
    }

@app.post("/api/recharge")
async def recharge(request: Request):
    """管理充值接口：{ "amount": 10, "device_id": "xxx" } → 需 X-Admin-Secret"""
    _verify_admin(request)
    body = await request.json()
    amount = body.get("amount", 0)

    if amount not in RECHARGE_TIERS:
        valid = ", ".join(f"{k}元={v}分" for k, v in RECHARGE_TIERS.items())
        raise HTTPException(400, f"无效充值金额。可选: {valid}")

    credits = RECHARGE_TIERS[amount]
    target_device = body.get("device_id") or get_device_fingerprint(request)

    with get_db() as db:
        user = get_or_create_user(db, target_device)
        return _add_credits(db, user["id"], amount, credits,
                           payment_ref=f"admin:{datetime.now().strftime('%Y%m%d%H%M%S')}")

# ---- 面包多支付回调 ----
def _mbd_verify_sign(params: dict, secret: str) -> str:
    """面包多签名验证：按 ASCII 排序 → join &key=secret → MD5"""
    # 排除 sign 字段本身，只取非空值
    flat = {}
    for k, v in sorted(params.items()):
        if k == "sign" or v is None or v == "":
            continue
        flat[k] = v if not isinstance(v, (dict, list)) else json.dumps(v, separators=(",", ":"), ensure_ascii=False)
    sign_str = "&".join(f"{k}={flat[k]}" for k in sorted(flat.keys()))
    sign_str += f"&key={secret}"
    return hashlib.md5(sign_str.encode()).hexdigest()

@app.post("/api/payment/callback")
async def payment_callback(request: Request):
    """面包多Pay webhook 回调 → 自动充值积分

    面包多Pay webhook POST JSON:
    {
      "type": "charge_succeeded",          // 通知类型
      "data": {
        "description": "10元=1000积分",     // 商品描述
        "out_trade_no": "device_xxx|10",   // 商户订单号
        "amount": 1000,                     // 金额(分)
        "charge_id": "wx_xxx",              // 支付流水号
        "payway": 1                         // 1=微信 2=支付宝
      },
      "sign": "md5签名"                      // 可选，MIANBAODUO_SECRET 配置后开启验证
    }
    """
    body = await request.json()

    # 签名验证（如已配置 MIANBAODUO_SECRET）
    if MIANBAODUO_SECRET:
        sign = body.get("sign", "")
        expected = _mbd_verify_sign(body, MIANBAODUO_SECRET)
        if not sign or sign != expected:
            raise HTTPException(403, "签名验证失败")

    # 处理支付成功通知
    notif_type = body.get("type", "")
    if notif_type == "complaint":
        # 投诉通知：记录日志
        data = body.get("data", {})
        print(f"[PAYMENT] 投诉通知: {data.get('out_trade_no')} - {data.get('complaint_detail', '')}")
        return {"success": True, "message": "投诉已记录"}

    if notif_type != "charge_succeeded":
        return {"success": True, "message": f"忽略类型: {notif_type}"}

    data = body.get("data", {})
    out_trade_no = data.get("out_trade_no", "")
    charge_id = data.get("charge_id", out_trade_no)  # 支付流水号
    amount_fen = int(data.get("amount", 0))

    # 解析 out_trade_no: "device_xxx|10" 格式
    try:
        parts = dict(p.split("_", 1) for p in out_trade_no.split("|") if "_" in p)
        device_id = parts.get("device", "")
        amount_yuan = int(parts.get("amount", "0"))
    except Exception:
        raise HTTPException(400, f"out_trade_no 格式错误: {out_trade_no}")

    if amount_yuan not in RECHARGE_TIERS:
        raise HTTPException(400, f"无效充值金额: {amount_yuan} 元")

    credits = RECHARGE_TIERS[amount_yuan]

    # 防重
    with get_db() as db:
        existing = db.execute(
            "SELECT id FROM recharge_log WHERE payment_ref=?",
            (charge_id,)
        ).fetchone()
        if existing:
            return {"success": True, "message": "已处理", "duplicate": True}

        user = get_or_create_user(db, device_id)
        result = _add_credits(db, user["id"], amount_yuan, credits, payment_ref=charge_id)

        print(f"[PAYMENT] ✅ 充值成功: device={device_id[:8]}... +{credits}分 (¥{amount_yuan})")
        return result

# ---- 生成支付链接 ----
@app.get("/api/payment/url")
async def get_payment_url(amount: int = 10, device_id: str = ""):
    """生成面包多支付链接（用户扫码支付后，webhook 自动充值）

    前置条件：需在面包多后台创建对应金额的商品，并配置 webhook URL
    返回支付链接，App 打开此链接让用户支付

    参数:
        amount: 充值金额(元), 10/30/50
        device_id: 用户设备ID（用于回调时识别用户）
    """
    if amount not in RECHARGE_TIERS:
        raise HTTPException(400, f"无效金额，可选: {list(RECHARGE_TIERS.keys())}")

    out_trade_no = f"device_{device_id}|amount_{amount}"

    return {
        "amount_yuan": amount,
        "credits": RECHARGE_TIERS[amount],
        "out_trade_no": out_trade_no,
        "tip": "请在面包多后台创建商品后，使用产品链接跳转支付。out_trade_no 会随 webhook 回调返回。"
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

        # ---- 直接代理到 DeepSeek（客户端 Hermes CLI 负责 Agent 逻辑）----
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
    host = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("HERMES_HOST", "0.0.0.0")
    port = int(os.environ.get("HERMES_PORT", "8765"))
    print(f"🚀 Hergent 积分服务 v2.0.0")
    print(f"   监听: {host}:{port}")
    print(f"   DeepSeek: {'✅ 已配置' if DEEPSEEK_API_KEY else '⚠️  未配置（仅管理积分）'}")
    print(f"   Hermes CLI: {'✅ 可用' if HERMES_AVAILABLE else '⚠️  未安装（走 DeepSeek 直连）'}")
    print(f"   SMS 模式: {os.environ.get('HERMES_SMS_MODE', 'dev')}")
    print(f"   数据库: {DB_PATH}")
    uvicorn.run(app, host=host, port=port, log_level="info")
